//! Dragging a session row between the Pinned, Sessions and Parked sections of its group.

use gpui::Context;
use serde_json::{Value, json};

use super::model::NativeSidebarGroup;
use crate::GhostexGpuiApp;

/// The sections a drop can move a session into.
const DROP_SECTIONS: [&str; 3] = ["pinned", "sessions", "parked"];

/// A row in one of these can be dragged to another section.
const SOURCE_SECTIONS: [&str; 4] = ["pinned", "drafts", "sessions", "parked"];

fn section_of<'a>(group: &'a NativeSidebarGroup, session_id: &str) -> Option<&'a str> {
    group
        .sections
        .iter()
        .find(|section| section.session_ids.iter().any(|id| id == session_id))
        .map(|section| section.id.as_str())
}

/// Whether Parked exists at all (Settings > Sidebar > session parking, on by default).
pub(super) fn session_parking_enabled() -> bool {
    crate::shared_settings::shared_sidebar_settings_snapshot()
        .object()
        .get("enableSessionParking")
        .and_then(Value::as_bool)
        != Some(false)
}

impl GhostexGpuiApp {
    /// CDXC:Sidebar 2026-09-24 DECISION:
    /// User: dragging a session in the sidebar moves it between the Pinned, Sessions and Parked sections. A session dropped on another section's heading, or on any row of that section, of its own project gets that section's flags: Pinned pins it (and unparks it), Sessions unpins and unparks it, Parked parks it, which keeps a pinned session's pin so Unpark brings it back to Pinned. The row then sits where that section's own order puts it. While a session is dragged, a section its project does not show yet (nothing pinned, nothing parked) draws its heading so there is somewhere to drop.
    pub(super) fn native_sidebar_section_move_command(
        &self,
        session_id: &str,
        target_kind: &str,
        target_id: &str,
        group_id: Option<&str>,
    ) -> Option<Value> {
        let snapshot = self.native_sidebar.snapshot.as_ref()?;
        let group = snapshot.groups.iter().find(|group| {
            group
                .sessions
                .iter()
                .any(|session| session.session_id == session_id)
        })?;
        if group.is_stale || group.remote_machine_context.is_some() {
            return None;
        }
        let from = section_of(group, session_id)?;
        let to = match target_kind {
            "section" if group_id == Some(group.group_id.as_str()) => target_id,
            "session" => section_of(group, target_id)?,
            _ => return None,
        };
        if from == to
            || (from == "drafts" && to == "sessions")
            || !SOURCE_SECTIONS.contains(&from)
            || !DROP_SECTIONS.contains(&to)
            || (to == "parked" && !session_parking_enabled())
        {
            return None;
        }
        Some(json!({
            "type": "moveSessionToSection",
            "sessionId": session_id,
            "groupId": group.group_id,
            "from": from,
            "section": to,
        }))
    }

    /// The section a session drag is aimed at, for the heading's highlight.
    pub(super) fn native_sidebar_section_drop_target(&self, group_id: &str, section: &str) -> bool {
        self.native_sidebar
            .drop_command
            .as_ref()
            .is_some_and(|command| {
                command["type"] == "moveSessionToSection"
                    && command["groupId"] == group_id
                    && command["section"] == section
            })
    }

    /// Performs a section drop as the pin and park commands the row's menu sends.
    pub(super) fn move_native_sidebar_session_to_section(
        &mut self,
        command: &Value,
        cx: &mut Context<Self>,
    ) {
        let (Some(session_id), Some(from), Some(to)) = (
            command["sessionId"].as_str(),
            command["from"].as_str(),
            command["section"].as_str(),
        ) else {
            return;
        };
        let pinned = self
            .native_sidebar
            .snapshot
            .as_ref()
            .and_then(|snapshot| {
                snapshot
                    .groups
                    .iter()
                    .flat_map(|group| group.sessions.iter())
                    .find(|session| session.session_id == session_id)
            })
            .is_some_and(|session| session.is_pinned);
        let parked = from == "parked";
        let mut messages = Vec::new();
        match to {
            "pinned" => {
                if parked {
                    messages.push(json!({"type": "setSessionParked", "sessionId": session_id, "parked": false}));
                }
                if !pinned {
                    messages.push(json!({"type": "setSessionPinned", "sessionId": session_id, "pinned": true}));
                }
            }
            "sessions" => {
                if parked {
                    messages.push(json!({"type": "setSessionParked", "sessionId": session_id, "parked": false}));
                }
                if pinned {
                    messages.push(json!({"type": "setSessionPinned", "sessionId": session_id, "pinned": false}));
                }
            }
            "parked" => {
                messages.push(
                    json!({"type": "setSessionParked", "sessionId": session_id, "parked": true}),
                );
            }
            _ => {}
        }
        for message in messages {
            self.dispatch_native_sidebar_ui(json!({"type": "command", "message": message}), cx);
        }
    }

    /// The sections a session drag may land in that this group does not draw yet, between the
    /// drawn sections ranked `after` and `before` (`None` for either end).
    pub(super) fn native_sidebar_missing_drop_sections(
        &self,
        group: &NativeSidebarGroup,
        after: Option<&str>,
        before: Option<&str>,
    ) -> Vec<&'static str> {
        let Some(("session", dragged)) = self
            .native_sidebar
            .dragging
            .as_ref()
            .map(|(kind, id)| (*kind, id.as_str()))
        else {
            return Vec::new();
        };
        if group.is_stale
            || group.remote_machine_context.is_some()
            || !group
                .sessions
                .iter()
                .any(|session| session.session_id == dragged)
        {
            return Vec::new();
        }
        let low = after.map_or(-1, section_rank);
        let high = before.map_or(i32::MAX, section_rank);
        DROP_SECTIONS
            .into_iter()
            .filter(|id| *id != "parked" || session_parking_enabled())
            .filter(|id| !group.sections.iter().any(|section| section.id == *id))
            .filter(|id| {
                let rank = section_rank(id);
                rank > low && rank < high
            })
            .collect()
    }
}

/// Where a section's heading is drawn among the others (`SectionId::ORDER` in gx-core).
fn section_rank(id: &str) -> i32 {
    [
        "browser", "pinned", "drafts", "sessions", "parked", "snoozed",
    ]
    .iter()
    .position(|candidate| *candidate == id)
    .map_or(i32::MAX - 1, |rank| rank as i32)
}
