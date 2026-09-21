//! The agent model catalog as the chat reads it, and the one label rule it applies.
//!
//! Port of the schema half of `packages/shared/agent-model-catalog.ts`. The catalog is published
//! outside the app and reaches the core through [`crate::Event::ModelCatalogChanged`], already
//! parsed and validated by the host, so nothing here re-implements `parseAgentModelCatalog`; only
//! the shape the picker and the model menu read, and `agentModelCatalogEffortLabel`.
//!
//! Family e1's session option catalog reads the same document. It is public here so there is one
//! definition rather than two.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// One row of an agent's model picker.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelCatalogModel {
    /// Stable id the client dispatches and persists; never shown to the user.
    pub value: String,
    /// Display label, already shortened for the pills.
    pub label: String,
    /// The exact row text the CLI's own picker shows, when it differs from `label`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub picker_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Effort levels this model accepts; empty when the model has none.
    #[serde(default)]
    pub efforts: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_effort: Option<String>,
    #[serde(default)]
    pub fast_mode: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<bool>,
    /// Id of the agent group this row is nested under. Absent means the row sits at the top
    /// level, which is the only kind of row the quick picker keeps.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
}

/// A submenu in an agent's model picker.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelCatalogGroup {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelCatalogFastMode {
    pub available: bool,
    /// Slash command that toggles it, when the CLI has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    /// `model` when only some models offer it, `session` when it is global.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelCatalogAgent {
    pub name: String,
    /// Every effort level the agent knows, in rank order (lowest first).
    #[serde(default)]
    pub efforts: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_effort: Option<String>,
    #[serde(default)]
    pub fast_mode: AgentModelCatalogFastMode,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub groups: Vec<AgentModelCatalogGroup>,
    /// One flat list in display order, which is what every client renders and what the option
    /// logic keys on; grouping is layered on top through [`AgentModelCatalogModel::group`].
    #[serde(default)]
    pub models: Vec<AgentModelCatalogModel>,
}

/// The published document.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelCatalog {
    #[serde(default)]
    pub schema_version: i64,
    /// ISO date; the newer of two catalogs wins.
    #[serde(default)]
    pub updated_at: String,
    /// Effort id to the label shown in the selector.
    #[serde(default)]
    pub effort_labels: BTreeMap<String, String>,
    #[serde(default)]
    pub agents: BTreeMap<String, AgentModelCatalogAgent>,
}

impl AgentModelCatalog {
    /// One agent's lineup, or `None` when the catalog does not know it.
    pub fn agent(&self, id: &str) -> Option<&AgentModelCatalogAgent> {
        self.agents.get(id)
    }
}

/// `sentenceCase`: the first character upper, the rest untouched.
fn sentence_case(word: &str) -> String {
    let mut characters = word.chars();
    match characters.next() {
        Some(first) => first.to_uppercase().collect::<String>() + characters.as_str(),
        None => String::new(),
    }
}

/// `agentModelCatalogEffortLabel`.
pub fn agent_model_catalog_effort_label(catalog: &AgentModelCatalog, effort: &str) -> String {
    if effort == "xhigh" {
        return "xHigh".to_string();
    }
    let label = catalog
        .effort_labels
        .get(effort)
        .map(String::as_str)
        .unwrap_or(effort);
    label
        .split(' ')
        .map(sentence_case)
        .collect::<Vec<_>>()
        .join(" ")
}
