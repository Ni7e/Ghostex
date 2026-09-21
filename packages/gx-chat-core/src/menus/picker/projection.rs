//! Everything both renderers draw for the model picker, from one context and one view state.
//!
//! Port of `packages/shared/session-chat-controller/model-menu.ts`. `ModelMenuContext` is family
//! e1's `computeNativeChatOptions` output; what it can be built from here is
//! [`ModelMenuContext`], which carries the same fields.

use serde_json::{json, Value};

use crate::menus::picker::catalog::AgentModelCatalog;
use crate::menus::picker::model_menu::{
    model_menu_empty_text, model_menu_entries, model_menu_opening_tab, model_menu_pick_value,
    model_menu_rows, model_menu_tabs, ModelMenuCatalogs, ModelMenuCurrent, ModelMenuRow,
    ModelMenuView, MODEL_MENU_SEARCH_PLACEHOLDER,
};
use crate::menus::picker::model_picker::{
    model_picker_supports_session_scope, ModelPickerProvider,
    MODEL_PICKER_DEFAULT_SCOPE_ONLY_REASON,
};
use crate::menus::picker::traits::{
    model_menu_pill_labels, model_menu_traits, ResolvedOptionDescriptor,
};

/// The model menu's inputs, published as `modelMenuContext` and consumed by every pick.
///
/// Built by family e1's `computeNativeChatOptions`; only its fields are read here.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ModelMenuContext {
    pub provider: Option<ModelPickerProvider>,
    /// The catalog's model descriptor id, which is what a pick dispatches against.
    pub model_id: Option<String>,
    /// `catalog.model.defaultValue`.
    pub model_default: Option<String>,
    /// The pill's own label when no entry matches.
    pub model_label: Option<String>,
    /// The visible option descriptors, Shift+Tab mode cycler already removed, resolved against
    /// the session's option state.
    pub descriptors: Vec<ResolvedOptionDescriptor>,
    /// `state[modelId]?.value`: the model this session is running.
    pub model_value: Option<String>,
    /// `state.effort?.value`, which a hand-off to another agent starts from.
    pub effort_value: Option<String>,
    /// The reason the last selection was abandoned.
    pub selection_error: Option<String>,
    /// Picks are refused while an option command is being typed into a working agent.
    pub disabled: bool,
    /// `sessionOptions.sessionKey`: the picker checks it again when it finishes, because the
    /// session can change under an open picker.
    pub session_key: Option<String>,
    /// The value `modelMenuContext` itself is published as.
    ///
    /// Its `descriptors` and `state` are family e1's own shapes, which e2 does not model, so e1
    /// hands the whole object over verbatim and e2 only reads the fields above out of it.
    pub raw: Value,
}

impl ModelMenuContext {
    /// The `modelMenuContext` document key.
    pub fn to_json(&self) -> Value {
        self.raw.clone()
    }
}

/// What a click on a model row means for this session.
#[derive(Clone, Debug, PartialEq)]
pub enum ModelMenuPick {
    /// The row belongs to this session's own agent, so it is an ordinary option pick.
    Select { value: String },
    /// Another agent's model: hand the conversation over, or switch a draft's agent.
    Handoff {
        provider: ModelPickerProvider,
        model: String,
        effort: String,
    },
}

/// `modelMenuPick`.
///
/// `effort_for` is `modelMenuEffortFor(provider, model, currentEffort)`: the effort a model from
/// another agent starts on, which family e1's catalog answers because it knows that agent's
/// options. It is only consulted on the hand-off path.
pub fn model_menu_pick(
    row: &ModelMenuRow,
    context: &ModelMenuContext,
    effort_for: impl FnOnce(ModelPickerProvider, &str, Option<&str>) -> String,
) -> ModelMenuPick {
    if Some(row.entry.provider) == context.provider {
        return ModelMenuPick::Select {
            value: model_menu_pick_value(
                &row.entry,
                context.model_value.as_deref(),
                context.model_default.as_deref(),
            ),
        };
    }
    let model = model_menu_pick_value(&row.entry, None, None);
    let effort = effort_for(row.entry.provider, &model, context.effort_value.as_deref());
    ModelMenuPick::Handoff {
        provider: row.entry.provider,
        model,
        effort,
    }
}

/// `modelMenuProjection`: the whole `modelMenu` document key.
pub fn model_menu_projection(
    context: &ModelMenuContext,
    view: &ModelMenuView,
    catalogs: &ModelMenuCatalogs,
    favorites: &[String],
    catalog: &AgentModelCatalog,
) -> Value {
    let entries = model_menu_entries(catalogs);
    let tab = view
        .tab
        .unwrap_or_else(|| model_menu_opening_tab(&entries, context.provider));
    let traits = model_menu_traits(
        &entries,
        &context.descriptors,
        context.provider.map(|provider| provider.as_str()),
        context.model_value.as_deref(),
        catalog,
    );
    let rows = model_menu_rows(
        &entries,
        tab,
        &view.query,
        favorites,
        &ModelMenuCurrent {
            provider: context
                .provider
                .map(|provider| provider.as_str().to_string()),
            model: context.model_value.clone(),
        },
    );
    let session_scope = context
        .provider
        .is_some_and(model_picker_supports_session_scope);
    json!({
        "tab": tab.as_str(),
        "query": view.query,
        "placeholder": MODEL_MENU_SEARCH_PLACEHOLDER,
        "tabs": model_menu_tabs(&entries, tab),
        "rows": rows,
        "emptyText": rows
            .is_empty()
            .then(|| model_menu_empty_text(tab, &view.query)),
        "traits": traits.iter().map(|row| row.to_json()).collect::<Vec<_>>(),
        "pill": model_menu_pill_labels(
            &entries,
            context.provider.map(|provider| provider.as_str()),
            context.model_value.as_deref(),
            context.model_label.as_deref(),
            &traits,
        ),
        "error": context.selection_error,
        "disabled": context.disabled,
        // Right-click applies to this session only where the agent can; elsewhere the hint says
        // why not.
        "sessionScope": session_scope,
        "scopeHint": if session_scope {
            "Click saves as default · Right-click applies to this session only"
        } else {
            MODEL_PICKER_DEFAULT_SCOPE_ONLY_REASON
        },
    })
}

/// The rows the open menu currently shows, which is what a `modelMenuPick` action looks a key up
/// in.
pub fn model_menu_visible_rows(
    context: &ModelMenuContext,
    view: &ModelMenuView,
    catalogs: &ModelMenuCatalogs,
    favorites: &[String],
) -> Vec<ModelMenuRow> {
    let entries = model_menu_entries(catalogs);
    let tab = view
        .tab
        .unwrap_or_else(|| model_menu_opening_tab(&entries, context.provider));
    model_menu_rows(
        &entries,
        tab,
        &view.query,
        favorites,
        &ModelMenuCurrent {
            provider: context
                .provider
                .map(|provider| provider.as_str().to_string()),
            model: context.model_value.clone(),
        },
    )
}
