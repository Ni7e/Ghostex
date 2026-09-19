//! Previous and next session (`focusPreviousSession`, `focusNextSession`): the walk over the
//! rendered sidebar rows, done in Rust so a held key moves one row per key repeat without a
//! round trip through the sidebar runtime.

use std::time::Instant;

use serde_json::json;

use crate::GhostexGpuiApp;
use crate::app::helpers::gpui_combined_presentation_session_key;
use crate::app::native_sidebar::model::{
    NativeSidebarRevealRequest, NativeSidebarSession, NativeSidebarSnapshot,
};
use crate::app::sidebar_direct_focus::NativeSidebarClickReaction;
use crate::support_logs;

/// One rendered row, reduced to what the walk needs.
struct WalkRow<'a> {
    session: &'a NativeSidebarSession,
    is_sleeping: bool,
}

/// CDXC:Hotkeys 2026-09-19 DECISION:
/// User: holding the previous or next session hotkey must fly through sessions.
/// The rendered row order, ported from `renderedNativeSidebarSessionIds` (apps/desktop/sidebar/native-sidebar/selection.ts): the snapshot's top-level `order`, where a project item is its group and any other item is a collection that contributes its groups unless it is collapsed; a group that is missing or collapsed contributes nothing; an open group contributes the session ids of its sections that are not collapsed, in section order. An id without a row in the group is left out, as the runtime left out ids missing from its store.
/// SEE-ALSO: apps/desktop/sidebar/native-sidebar/hotkeys.ts (`focusSessionSlot` with slot 0 and -1 still serves the numbered slots there), packages/core-ui/sidebar-visible-session-slots.ts (`resolveAdjacentRenderedSidebarSessionSlotId`).
fn rendered_rows(snapshot: &NativeSidebarSnapshot) -> Vec<WalkRow<'_>> {
    let mut rows = Vec::new();
    for item in &snapshot.order {
        let collection_group_ids;
        let group_ids: &[String] = if item.kind == "project" {
            std::slice::from_ref(&item.id)
        } else {
            collection_group_ids = snapshot
                .collections
                .iter()
                .find(|collection| collection.collection_id == item.id && !collection.collapsed)
                .map(|collection| collection.group_ids.as_slice())
                .unwrap_or_default();
            collection_group_ids
        };
        for group_id in group_ids {
            let Some(group) = snapshot
                .groups
                .iter()
                .find(|group| group.group_id == *group_id)
                .filter(|group| !group.collapsed)
            else {
                continue;
            };
            for section in group.sections.iter().filter(|section| !section.collapsed) {
                for session_id in &section.session_ids {
                    if let Some(session) = group
                        .sessions
                        .iter()
                        .find(|session| session.session_id == *session_id)
                    {
                        rows.push(WalkRow {
                            session,
                            is_sleeping: session.lifecycle_state.as_deref() == Some("sleeping"),
                        });
                    }
                }
            }
        }
    }
    rows
}

/// The row next to `current`, ported from `resolveAdjacentRenderedSidebarSessionSlotId`: sleeping
/// rows are candidates unless the setting skips them; with no current row among the rendered
/// ones, next is the first candidate and previous the last; otherwise the walk steps from the
/// current row in the direction, wraps at the ends, passes rows that are no candidates, and may
/// come back to the current row when it is the only candidate.
fn adjacent_row<'a>(
    rows: &'a [WalkRow<'a>],
    current: Option<&str>,
    reverse: bool,
    skip_sleeping: bool,
) -> Option<&'a NativeSidebarSession> {
    let is_candidate = |row: &WalkRow<'_>| !skip_sleeping || !row.is_sleeping;
    let current_index =
        current.and_then(|id| rows.iter().position(|row| row.session.session_id == id));
    let Some(current_index) = current_index else {
        let mut candidates = rows.iter().filter(|row| is_candidate(row));
        return if reverse {
            candidates.next_back()
        } else {
            candidates.next()
        }
        .map(|row| row.session);
    };
    let count = rows.len();
    (1..=count)
        .map(|step| {
            if reverse {
                (current_index + count - step % count) % count
            } else {
                (current_index + step) % count
            }
        })
        .map(|index| &rows[index])
        .find(|row| is_candidate(row))
        .map(|row| row.session)
}

impl GhostexGpuiApp {
    /// One step of the previous or next session hotkey.
    ///
    /// The target is selected the way a click on its row is. A local session of the active
    /// project whose tab has a live terminal is selected in process and nothing is sent to the
    /// sidebar runtime for the step (the coalesced tell follows the burst). One without a live
    /// terminal gets its staged tab at once; the runtime, which still owns wake and attach, is
    /// asked for it when the key is released, so a hold does not wake every session it passes (a
    /// single press asks at once, as a click does). A session of another project, a remote
    /// session and a browser tab keep the runtime's route for that step, because the runtime
    /// still owns project switches, remote machines and browser rows.
    pub(crate) fn walk_native_sidebar_sessions(
        &mut self,
        reverse: bool,
        cx: &mut gpui::Context<Self>,
    ) {
        let started = Instant::now();
        let Some(snapshot) = self.native_sidebar.snapshot.clone() else {
            return;
        };
        let rows = rendered_rows(&snapshot);
        let current = self.gx_store_focused_sidebar_row_id(&snapshot);
        let skip_sleeping =
            snapshot.hud["settings"]["sidebarSessionCycleSkipsSleeping"].as_bool() == Some(true);
        let Some(target) = adjacent_row(&rows, current.as_deref(), reverse, skip_sleeping) else {
            return;
        };
        let target_id = target.session_id.clone();
        let held = self.gx_store_key_is_held();
        let local_key = gpui_combined_presentation_session_key(&target_id).filter(|key| {
            !target.is_browser()
                && self.agents_workspace_project_id.as_deref() == Some(key.project_id.as_str())
        });
        let select = json!({"type": "selectSession", "sessionId": target_id, "mode": "focus"});
        let route = match &local_key {
            None => {
                self.dispatch_native_sidebar_ui(select, cx);
                "runtime"
            }
            Some(key) => match self.react_to_native_sidebar_session_click(&target_id, cx) {
                NativeSidebarClickReaction::InProcess => {
                    // No request follows, so none is expected back.
                    self.gx_store_forget_expected_echo(key);
                    if let Some(shell_session_id) =
                        self.local_workspace_session_mappings.get(key).copied()
                    {
                        self.dispatch_gpui_workspace_session_attention_acknowledge(
                            shell_session_id,
                            cx,
                        );
                    }
                    if !held && rows.iter().any(|row| row_is_multi_selected(row.session)) {
                        // A row click clears the multi-selection in the runtime; so does a press.
                        self.dispatch_native_sidebar_ui(
                            json!({"type": "selectSession", "sessionId": target_id, "mode": "clear"}),
                            cx,
                        );
                    }
                    "inProcess"
                }
                NativeSidebarClickReaction::Staged if held => {
                    self.gx_store_ask_runtime_for_landing_row(&target_id);
                    "stagedAskAtSettle"
                }
                NativeSidebarClickReaction::Staged => {
                    // The tell goes out first, so the runtime's request follows the payload that
                    // echoes this selection's stamp.
                    self.gx_store_expect_request_after_tell(key);
                    self.dispatch_native_sidebar_ui(select, cx);
                    "staged"
                }
                NativeSidebarClickReaction::NotApplied => {
                    self.dispatch_native_sidebar_ui(select, cx);
                    "runtime"
                }
            },
        };
        self.gx_store_reveal_walk_row(&target_id);
        cx.notify();
        support_logs::append(
            support_logs::GpuiSupportLog::TerminalFocus,
            "gpui.terminalFocus.sessionStep",
            json!({
                "elapsedUs": started.elapsed().as_micros() as u64,
                "route": route,
                "held": held,
                "reverse": reverse,
                "rows": rows.len(),
                "heavyWorkDeferred": self.gx_store_selection_is_settling(),
            }),
        );
    }

    /// Scrolls the row into view. While the selection is still moving the scroll is instant (see
    /// `reveal_native_session_bounds`) and the landing row is revealed again at the settle, which
    /// flashes it as a reveal of a visible row always did; a single press animates at once.
    fn gx_store_reveal_walk_row(&mut self, row_id: &str) {
        self.native_sidebar.scroll_animation = None;
        self.native_sidebar.pending_reveal = Some(NativeSidebarRevealRequest {
            session_id: row_id.to_string(),
            // Only reveal requests of the sidebar snapshot are numbered.
            request_id: 0,
        });
        self.gx_store_note_walk_reveal(row_id);
    }
}

fn row_is_multi_selected(session: &NativeSidebarSession) -> bool {
    session
        .details
        .get("isMultiSelected")
        .and_then(serde_json::Value::as_bool)
        == Some(true)
}
