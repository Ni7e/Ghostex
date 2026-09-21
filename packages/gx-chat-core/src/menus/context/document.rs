//! Family e2's context keys: the meter, the row editor and the measured status line.
//!
//! Port of the `contextEditor`, `contextStatusRows` and `contextMeter` slices of `publish` in
//! `packages/shared/session-chat-controller/native-host.ts`.

use ghostex_gx_protocol::Tri;
use serde_json::Value;

use crate::document::Document;
use crate::menus::context::editor::context_editor_projection;
use crate::menus::context::meter::{compute_context_meter, ContextMeterInput};
use crate::menus::context::status::DetectedOptions;
use crate::menus::context::usage::mask_account_text;
use crate::state::{ChatContext, ChatState};

/// Writes family e2's context keys into `into`.
pub fn document(state: &ChatState, context: &ChatContext, into: &mut Document) {
    let pickers = &state.pickers;
    let detected: Option<DetectedOptions> = state
        .session
        .selected_options
        .as_ref()
        .and_then(|value| serde_json::from_value(value.clone()).ok());
    let input = ContextMeterInput {
        icon: pickers.context.agent_icon.as_deref(),
        selected_options: detected.as_ref(),
        account: pickers.context.account.as_ref(),
        agent_session_id: state.session.agent_session_id.clone(),
        // `chat.availableAgents !== null`: nothing has reached the agent yet.
        draft: state.session.available_agents.is_some(),
        title: state.core.title.clone(),
        working: agent_working(state),
        hide_account_emails: state.core.hide_account_emails,
    };
    let agent = crate::menus::context::ContextDetailsAgent::from_icon(input.icon);
    let result = compute_context_meter(
        &input,
        pickers.context.preferences.get(agent),
        context.now_ms,
        context.utc_offset_minutes,
    );
    into.context_meter = match result.meter {
        Value::Null => Tri::Null,
        meter => Tri::Value(meter),
    };

    let hide = state.core.hide_account_emails;
    into.context_editor = match context_editor_projection(
        pickers.context.editor.as_ref(),
        &result.status,
        Some(&result.session),
        context.now_ms,
        context.utc_offset_minutes,
        move |text| {
            if hide {
                mask_account_text(text)
            } else {
                text.to_string()
            }
        },
    ) {
        Value::Null => Tri::Null,
        editor => Tri::Value(editor),
    };

    into.context_status_rows = pickers.context.status_rows.clone();
}

/// `chat.working`, which family a derives.
///
/// To fold into family a: the derived live-turn flag is not on `ChatState` yet, so this is the
/// smallest stand-in the Compact button needs. Replace it with family a's own accessor.
fn agent_working(state: &ChatState) -> bool {
    !state.session.interrupted && (state.session.server_working || state.session.external_working)
}
