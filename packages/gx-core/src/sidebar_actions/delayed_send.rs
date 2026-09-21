//! A row's Delayed Send item (`sessionAction: delayedSend`): open the Delayed Send dialog seeded
//! with what the row already shows.
//!
//! CDXC:DelayedSend 2026-09-21 WHY:
//! Followed to its last function, the old path is ONE app-modal-host message and nothing else:
//! `runNativeSessionAction` (sidebar-page-frozen/session-actions.ts) calls `openAppModal` with eleven
//! fields read off the sidebar store's session, and `openAppModal` is `postAppModalHostMessage`,
//! whose `open` arm is `open_app_modal_from_bridge`. Unlike Rename and Note there is NO close
//! first, and the dialog forwards this payload VERBATIM (the Delayed Send kind is not on the
//! bridge's flat-field allowlist), so every field, including the booleans and the specific-agent
//! reference object, reaches the dialog exactly as built here. The arming the user then does comes
//! back as its own `scheduleDelayedSend` message and never passes through the sidebar's funnel.
//!
//! The seeds are the row's: the title Rename would show, the daemon's Delayed Send when it
//! published one and the host's own timer otherwise (the projection's `serverDelayedSend ??
//! resolveDelayedSend` precedence, reproduced in `sidebar_view/rows.rs`), and the host's Close
//! After Done. The two `supports…` flags are constants in the TypeScript and are here too; the
//! bridge's own enrichment recomputes the project-scope one for a local pane after this.
//!
//! SEE-ALSO: tooling/gx-core/sidebar-page-frozen/session-actions.ts (`runNativeSessionAction`),
//! apps/desktop/src/app/remote_conn/app_modal_bridge.rs (`open_app_modal_from_bridge`),
//! apps/desktop/src/app/gx_store/sidebar_state_actions.rs, tooling/gx-core/state-action-parity.ts.

use serde_json::{Map, Value};

use crate::sidebar_view::SidebarView;

use super::modals::rename_seed_title;
use super::plan::{ActionEffect, SidebarActionPlan};
use super::resolve::{drawn_row, text_field};

/// Whether this renderer command is the Delayed Send item, without resolving the row.
pub fn owns_delayed_send_command(command: &Value) -> bool {
    text_field(command, "type") == Some("sessionAction")
        && text_field(command, "action") == Some("delayedSend")
}

/// The dialog the item opens, or `None` when the row is not drawn.
///
/// `None` is a hand-off, not an answer: the TypeScript reads the FULL sidebar store and the store
/// reads the drawn list, so a row the list is not drawing goes to the old runtime, the same
/// decline Rename and Note make (a context menu can only be opened on a drawn row).
pub fn plan_delayed_send_action(view: &SidebarView, command: &Value) -> Option<SidebarActionPlan> {
    if !owns_delayed_send_command(command) {
        return None;
    }
    let sidebar_session_id = text_field(command, "sessionId")?;
    let row = drawn_row(view, sidebar_session_id)?;
    let title = rename_seed_title(
        row.menu_facts.primary_title.as_deref(),
        row.menu_facts.terminal_title.as_deref(),
        &row.alias,
    );
    let delayed = row.delayed_send.as_ref();
    let mut open = Map::new();
    let mut text = |key: &str, value: &str| {
        open.insert(key.to_string(), Value::String(value.to_string()));
    };
    text("type", "open");
    text("modal", "delayedSend");
    text("title", &title);
    text("sessionId", sidebar_session_id);
    // Every optional field below is ABSENT when the TypeScript's value is `undefined`, because
    // `JSON.stringify` drops the key and the dialog tells an absent key from a null one.
    if let Some(agent_icon) = &row.agent_icon {
        text("agentIcon", agent_icon);
    }
    if let Some(deadline_at) = delayed.and_then(|delayed| delayed.deadline_at.as_deref()) {
        text("delayedSendDeadlineAt", deadline_at);
    }
    if let Some(label) = delayed.and_then(|delayed| delayed.remaining_label.as_deref()) {
        text("delayedSendRemainingLabel", label);
    }
    let mut flag = |key: &str, value: bool| {
        open.insert(key.to_string(), Value::Bool(value));
    };
    flag(
        "closeAfterDoneActive",
        row.close_after_done
            .as_ref()
            .is_some_and(|close| close.armed),
    );
    flag(
        "sendWhenAllProjectSessionsStopActive",
        delayed.is_some_and(|delayed| delayed.send_when_all_project_sessions_stop_active),
    );
    flag(
        "sendWhenAgentStopsActive",
        delayed.is_some_and(|delayed| delayed.send_when_agent_stops_active),
    );
    flag("supportsSendWhenAgentStops", true);
    flag("supportsSendWhenAllProjectSessionsStop", true);
    // Passed on as the daemon sent it. A daemon `null` is the one shape that differs: the protocol
    // reads it as absent while the TypeScript copies `null` through (declared difference 40).
    if let Some(agent) =
        delayed.and_then(|delayed| delayed.send_when_specific_agent_finishes.as_ref())
    {
        open.insert("sendWhenSpecificAgentFinishes".to_string(), agent.clone());
    }
    Some(SidebarActionPlan::one(ActionEffect::OpenAppModal {
        payload: Value::Object(open),
    }))
}
