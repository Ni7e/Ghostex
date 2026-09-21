//! Family e2's picker keys: the model menu and its context, the open picker window, the model
//! provider, the selection outbox and the fork branch strip.
//!
//! Port of the slice of `publish` in `packages/shared/session-chat-controller/native-host.ts`
//! that reads the picker's own state (`native-host.ts:482`, `:483`, `:493`, plus the
//! `modelProvider`, `modelMenuContext`, `modelSelection` and `pendingModelSelection` keys that
//! ride in on `...viewState`).

use ghostex_gx_protocol::Tri;
use serde_json::Value;

use crate::document::Document;
use crate::menus::picker::fork_branches::fork_branches_projection;
use crate::state::{ChatContext, ChatState};

/// Writes family e2's picker and menu keys into `into`.
pub fn document(state: &ChatState, context: &ChatContext, into: &mut Document) {
    let pickers = &state.pickers;

    into.model_provider = match pickers
        .model_menu_context
        .as_ref()
        .and_then(|menu| menu.provider)
    {
        Some(provider) => Tri::Value(provider.as_str().to_string()),
        // `modelProvider: undefined` is a key `JSON.stringify` leaves out.
        None => Tri::Absent,
    };
    into.model_menu_context = match pickers.model_menu_context.as_ref() {
        Some(menu) => Tri::Value(menu.to_json()),
        None => Tri::Null,
    };
    into.model_menu = match pickers.model_menu_context.as_ref() {
        Some(menu) => Tri::Value(pickers.model_menu_projection(menu)),
        None => Tri::Null,
    };
    into.model_picker = match pickers.model_picker.as_ref() {
        Some(picker) => Tri::Value(picker.projection()),
        None => Tri::Null,
    };
    into.model_selection = Tri::Value(pickers.model_selection.to_json());
    into.pending_model_selection = match &state.session.pending_model_selection {
        Tri::Absent => Tri::Absent,
        Tri::Null => Tri::Null,
        Tri::Value(value) => Tri::Value(value.clone()),
    };

    into.fork_branches =
        match fork_branches_projection(&pickers.fork_branches.branches, context.now_ms) {
            Value::Null => Tri::Null,
            value => Tri::Value(value),
        };
}
