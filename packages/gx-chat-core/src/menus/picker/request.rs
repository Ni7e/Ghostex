//! Building the quick picker's request from the catalog.
//!
//! Port of `packages/shared/session-chat-presentation/model-picker-request.ts`. The one
//! difference is the request id: the TypeScript called `crypto.randomUUID()`, and the core has no
//! random source, so the host supplies the id with the action that opens the picker.

use crate::menus::picker::catalog::{agent_model_catalog_effort_label, AgentModelCatalog};
use crate::menus::picker::model_picker::{
    EffortChoice, ModelPickerModel, ModelPickerProvider, ModelPickerRequest,
};

/// `SHORT_MODEL_LABELS`.
fn short_model_label(value: &str) -> Option<&'static str> {
    match value {
        "gpt-6-astra" => Some("Astra"),
        "gpt-5.6-sol" => Some("Sol"),
        "gpt-5.6-terra" => Some("Terra"),
        "gpt-5.6-luna" => Some("Luna"),
        "fable" => Some("Fable"),
        "opus[1m]" => Some("Opus (1m)"),
        "opus" => Some("Opus"),
        "sonnet" => Some("Sonnet"),
        "haiku" => Some("Haiku"),
        _ => None,
    }
}

/// CDXC:SessionChat 2026-09-11 DECISION: User chose this exact top-to-bottom Cursor overlay
/// order, keeping related models together.
const CURSOR_MODEL_ORDER: &[&str] = &[
    "auto",
    "cursor-grok-4.6",
    "gemini-3.8-flash",
    "claude-fable-5-1",
    "claude-opus-5",
    "claude-opus-4-8",
    "claude-sonnet-5",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
];

/// CDXC:SessionChat 2026-09-11 DECISION: User chose this exact top-to-bottom Antigravity overlay
/// order, with Gemini together, then Opus, Sonnet and GPT-OSS.
const ANTIGRAVITY_MODEL_ORDER: &[&str] = &[
    "gemini-3.8-flash",
    "gemini-3.1-pro",
    "claude-opus-4-6-thinking",
    "claude-sonnet-4-6",
    "gpt-oss-120b-medium",
];

/// `MODEL_RANKS`: the two providers whose overlay has a fixed order.
fn model_order(provider: ModelPickerProvider) -> Option<&'static [&'static str]> {
    match provider {
        ModelPickerProvider::Cursor => Some(CURSOR_MODEL_ORDER),
        ModelPickerProvider::Antigravity => Some(ANTIGRAVITY_MODEL_ORDER),
        _ => None,
    }
}

/// The rank a value sorts at: its place in the order, else the order's length (last).
fn model_rank(order: &[&str], value: &str) -> usize {
    order
        .iter()
        .position(|entry| *entry == value)
        .unwrap_or(order.len())
}

/// `modelPickerProvider`: which quick picker an agent icon opens, if any.
///
/// CDXC:SessionChat 2026-09-09 DECISION: User: Cursor, Grok Build and Antigravity get the quick
/// picker with white accents and one standard icon for every model.
pub fn model_picker_provider(icon: Option<&str>) -> Option<ModelPickerProvider> {
    match icon? {
        "claude" => Some(ModelPickerProvider::Claude),
        "codex" => Some(ModelPickerProvider::Codex),
        "cursor-cli" | "cursor" => Some(ModelPickerProvider::Cursor),
        "grok-build" | "grok" => Some(ModelPickerProvider::Grok),
        "antigravity-cli" | "antigravity" => Some(ModelPickerProvider::Antigravity),
        _ => None,
    }
}

/// The trailing codename Codex's own picker repeats after the version.
fn strip_codex_codename(label: &str) -> String {
    for name in ["Astra", "Sol", "Terra", "Luna"] {
        let Some(head) = label.strip_suffix(name) else {
            continue;
        };
        let trimmed = head.trim_end_matches([' ', '\t', '\n', '\r']);
        if trimmed.len() < head.len() {
            return trimmed.to_string();
        }
    }
    label.to_string()
}

/// `createModelPickerRequest`, shared by the in-pane chat picker and the terminal's native modal
/// host. `request_id` replaces the `crypto.randomUUID()` the TypeScript generated.
pub fn create_model_picker_request(
    catalog: &AgentModelCatalog,
    provider: ModelPickerProvider,
    selected_model: Option<&str>,
    selected_effort: Option<&str>,
    request_id: String,
) -> Option<ModelPickerRequest> {
    let agent = catalog.agent(provider.as_str())?;
    let order = model_order(provider);
    // CDXC:SessionChat 2026-09-09 DECISION: User: keep only the selected models in the quick
    // picker, exclude Cursor Composer too, and retain every other model under Legacy in the
    // normal picker.
    let mut kept: Vec<_> = agent
        .models
        .iter()
        .filter(|model| model.group.is_none())
        .collect();
    if let Some(order) = order {
        // `Array.prototype.sort` is stable, so equal ranks keep catalog order.
        kept.sort_by_key(|model| model_rank(order, &model.value));
    }
    let models: Vec<ModelPickerModel> = kept
        .into_iter()
        .map(|model| ModelPickerModel {
            value: model.value.clone(),
            label: match provider {
                ModelPickerProvider::Claude | ModelPickerProvider::Codex => {
                    short_model_label(&model.value)
                        .map(str::to_string)
                        .unwrap_or_else(|| model.label.clone())
                }
                _ => model.label.clone(),
            },
            version: match provider {
                ModelPickerProvider::Codex => Some(strip_codex_codename(&model.label)),
                _ => None,
            },
            efforts: model
                .efforts
                .iter()
                .map(|value| EffortChoice {
                    value: value.clone(),
                    label: agent_model_catalog_effort_label(catalog, value),
                })
                .collect(),
            default_effort: model
                .default_effort
                .clone()
                .or_else(|| agent.default_effort.clone()),
        })
        .collect();
    // Detection may not have arrived yet. The catalog default is a starting cursor, not a claim
    // about the running agent.
    let catalog_default = agent
        .models
        .iter()
        .find(|model| model.default == Some(true))
        .map(|model| model.value.as_str());
    let model = models
        .iter()
        .find(|entry| Some(entry.value.as_str()) == selected_model)
        .or_else(|| {
            models
                .iter()
                .find(|entry| Some(entry.value.as_str()) == catalog_default)
        })
        .or_else(|| models.first())?
        .clone();
    let effort = model
        .efforts
        .iter()
        .find(|entry| Some(entry.value.as_str()) == selected_effort)
        .or_else(|| {
            model
                .efforts
                .iter()
                .find(|entry| Some(&entry.value) == model.default_effort.as_ref())
        })
        .or_else(|| model.efforts.first())
        .map(|entry| entry.value.clone())
        .unwrap_or_default();
    let efforts = agent
        .efforts
        .iter()
        .map(|value| EffortChoice {
            value: value.clone(),
            label: agent_model_catalog_effort_label(catalog, value),
        })
        .collect();
    Some(ModelPickerRequest {
        request_id,
        provider,
        models,
        efforts,
        model: model.value.clone(),
        effort,
    })
}
