//! A click on a row of THIS computer, and everything that behaves like one: the store performs the
//! page's half itself and sends the runtime's `focusSession` straight to the runtime.
//!
//! CDXC:FocusRouting 2026-09-21 WHY:
//! Five senders in this crate posted `{type:'selectSession', mode:'focus'}` and relied on the
//! sidebar page's `selectNativeSidebarSession` to turn it into `focusSession`: a row click
//! (`native_sidebar/sessions.rs`), the project slot hotkey and the session slot hotkey (both
//! through `gx_store_focus_and_reveal_slot_row`), the session walk's hand-offs
//! (`session_walk.rs`) and the burst's landing ask (`burst.rs`). That page is being deleted, so
//! all five now end here, in ONE route: the page's half of the click (the multi-selection cleared,
//! an open app modal closed) performed in Rust, then the runtime's own message on the runtime's own
//! entry. It is the same shape the remote row's click already has
//! (`sidebar_remote_focus.rs`), and it is deliberately one interception rather than five call-site
//! changes, so a sixth sender cannot miss it.
//!
//! **The held-key hot path is not on it.** A held previous/next session walk reaches
//! `NativeSidebarClickReaction::InProcess` and sends NOTHING (`session_walk.rs`): no
//! `selectSession`, so no work here. The presses that do arrive here pay one extra
//! `close_app_modal_from_bridge`, which is two `Option` tests when no modal is open, and save the
//! page's own routing, snapshot lookup and zustand write.
//!
//! **What is deliberately not reproduced**, the same three the remote click dropped (declared
//! difference 53): `applyLocalFocus` and `clearFocusedSessionScrollSuppression` are the zustand
//! store's optimistic marks for the REACT sidebar, which the desktop does not draw (its only
//! reader was the React sidebar, deleted on 2026-09-24; Quick Access and native chat settings read
//! neither), and the store owns the highlight itself in the same frame. The runtime's own publish
//! sets them a moment later exactly as it always did.
//!
//! **Counters** ride `gxStore.sidebarActions.summary` as `localFocus`: `focuses`, `browserRows`,
//! `modalsClosed`, `declinedSource`. A run in which the user clicked a row and
//! `focuses` is zero means the click never reached here; `declinedSource` moving means a click
//! arrived before the list was ready, which is the launch window and nothing else.
//!
//! SEE-ALSO: apps/desktop/sidebar/gxserver-runtime/core.ts (`onSidebarCommand`),
//! apps/desktop/src/app/gx_store/sidebar_remote_focus.rs.

use ghostex_gx_core::SessionKey;
use serde_json::{Value, json};

use crate::GhostexGpuiApp;
use crate::app::helpers::gpui_sidebar_runtime_command_script;

/// What this app run did with local row focus. Rides `gxStore.sidebarActions.summary`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct LocalFocusRouteCounters {
    /// Local `selectSession` clicks the store routed to the runtime itself.
    pub(crate) focuses: u64,
    /// Of those, the ones naming a browser tab, which the runtime focuses its own way.
    pub(crate) browser_rows: u64,
    /// Of those, the ones that closed an open app modal (the click's `closeAppModal`).
    pub(crate) modals_closed: u64,
    /// Clicks the store dropped because the list was not ready yet (the launch window).
    pub(crate) declined_source: u64,
}

impl GhostexGpuiApp {
    /// Answers a LOCAL row's `selectSession` with `mode: focus`. Returns whether it did, in which
    /// case the command must NOT also reach the old page, which would post a second `focusSession`.
    ///
    /// A remote row never gets here: `gx_store_plan_remote_row_focus` runs first and owns it.
    pub(crate) fn gx_store_focus_local_row(
        &mut self,
        command: &Value,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        let Some(session_id) = local_focus_session_id(command) else {
            return false;
        };
        if !self.gx_store_sidebar_list_ready() {
            self.gx_store.local_focus_route.declined_source += 1;
            return false;
        }
        // `selectNativeSidebarSession` cleared the multi-selection before it posted; the store's
        // own selection intent is that clear.
        self.gx_store_note_sidebar_command(command, cx);
        // `closeAppModal('SettingsDismissal:focusSession')`, through the same function the bridge's
        // own `close` arm reaches. Before the focus, as the TypeScript had it.
        let had_modal = self.app_modal_window.is_some() || self.native_app_modal.is_some();
        self.close_app_modal_from_bridge(cx);
        // The runtime must hear the newest local selection before a message that moves its focus.
        self.gx_store_flush_old_runtime_tell(cx);
        let sent = self.gx_store_send_sidebar_runtime_command(
            json!({ "type": "focusSession", "sessionId": session_id }),
            cx,
        );
        let browser = session_id.starts_with("gpui-browser:");
        let counters = &mut self.gx_store.local_focus_route;
        counters.focuses += 1;
        if browser {
            counters.browser_rows += 1;
        }
        if had_modal {
            counters.modals_closed += 1;
        }
        // Answered either way: with no runtime there is nothing to send it on to, and the old page
        // is inside that same runtime.
        let _ = sent;
        true
    }

    /// Sends the sidebar runtime one message it still owns, on its own entry. Returns whether the
    /// script ran; `false` means no runtime exists yet, and the message is parked on the bridge by
    /// the script itself when one appears later.
    pub(crate) fn gx_store_send_sidebar_runtime_command(
        &mut self,
        message: Value,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        let Some(sidebar) = self.sidebar.clone() else {
            return false;
        };
        let script = gpui_sidebar_runtime_command_script(&message);
        sidebar.update(cx, |surface, _| surface.execute_app_owned_script(&script))
    }

    /// The counters, for the periodic summary in `sidebar_remote.rs`.
    pub(super) fn gx_store_local_focus_route_counters(&self) -> LocalFocusRouteCounters {
        self.gx_store.local_focus_route
    }
}

/// The session a LOCAL row click names. `selectSession` is a RENDERER command and arrives at the
/// top level; only `mode: focus` posts anything, and a remote id is not this path's.
fn local_focus_session_id(command: &Value) -> Option<String> {
    if command.get("type").and_then(Value::as_str) != Some("selectSession") {
        return None;
    }
    if command.get("mode").and_then(Value::as_str) != Some("focus") {
        return None;
    }
    let session_id = command.get("sessionId").and_then(Value::as_str)?;
    if SessionKey::parse_remote_scoped_session_id(session_id).is_some() {
        return None;
    }
    Some(session_id.to_string())
}

/// The counters as the summary carries them: 4 keys at depth 2.
pub(super) fn local_focus_route_counters_json(counters: &LocalFocusRouteCounters) -> Value {
    json!({
        "focuses": counters.focuses,
        "browserRows": counters.browser_rows,
        "modalsClosed": counters.modals_closed,
        "declinedSource": counters.declined_source,
    })
}
