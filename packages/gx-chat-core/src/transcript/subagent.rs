//! Reading a subagent out of a tool call/result pair.
//!
//! **This is family f's rule** (`packages/shared/session-chat-presentation/subagent.ts`), ported
//! here because a tool row carries its subagent chip. `PROGRESS.md` lists it under "to fold into
//! family f"; when `src/extras/subagent_target.rs` lands, this file is deleted.

use serde_json::{Map, Value};

use crate::transcript::jsstr::{ascii_lower, js_trim};
use crate::transcript::tool_fold::ToolPair;

const SUBAGENT_TOOL_NAMES: [&str; 5] =
    ["spawn_agent", "agent", "task", "send_message", "followup_task"];

/// A value that is an object, or a JSON string that parses into one.
fn record(value: Option<&Value>) -> Option<Value> {
    match value? {
        Value::String(text) => match serde_json::from_str::<Value>(text) {
            Ok(parsed) if parsed.is_object() => Some(parsed),
            _ => None,
        },
        other if other.is_object() => Some(other.clone()),
        _ => None,
    }
}

/// A non-blank string field, trimmed.
fn text(record: Option<&Value>, key: &str) -> Option<String> {
    let value = record?.get(key)?.as_str()?;
    let trimmed = js_trim(value);
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// `\bagentId:\s*([a-zA-Z0-9_-]+)`.
fn agent_id_in_output(output: &str) -> Option<String> {
    let mut cursor = 0;
    while let Some(at) = output[cursor..].find("agentId:") {
        let start = cursor + at;
        cursor = start + "agentId:".len();
        let before = output[..start].chars().next_back();
        if before.is_some_and(|character| character.is_ascii_alphanumeric() || character == '_') {
            continue;
        }
        let rest = &output[cursor..];
        let space: usize = rest
            .chars()
            .take_while(|character| crate::transcript::jsstr::is_js_space(*character))
            .map(char::len_utf8)
            .sum();
        let id: String = rest[space..]
            .chars()
            .take_while(|character| character.is_ascii_alphanumeric() || *character == '_' || *character == '-')
            .collect();
        if !id.is_empty() {
            return Some(id);
        }
    }
    None
}

/// The subagent a tool row links to, as both renderers read it.
pub fn tool_subagent(pair: &ToolPair<'_>, agent_path: &str) -> Option<Value> {
    let name = pair.call_name()?;
    let tool = ascii_lower(name.split(['.', ':']).next_back().unwrap_or(name));
    if tool.is_empty() || !SUBAGENT_TOOL_NAMES.contains(&tool.as_str()) {
        return None;
    }
    let input = record(pair.call_input());
    let output = record(pair.result_output().map(|text| Value::String(text.to_string())).as_ref());
    let mut target = Map::new();
    if tool == "send_message" || tool == "followup_task" {
        let id = text(input.as_ref(), "id");
        let selector_source = text(input.as_ref(), "target").or_else(|| id.clone())?;
        let selector = if selector_source.starts_with('/') || Some(&selector_source) == id.as_ref() {
            selector_source.clone()
        } else {
            format!("{agent_path}/{selector_source}")
        };
        target.insert(
            "name".to_string(),
            selector_source.split('/').next_back().unwrap_or(&selector_source).into(),
        );
        target.insert("selector".to_string(), selector.into());
        return Some(Value::Object(target));
    }
    let task = text(input.as_ref(), "task_name");
    let name = task
        .clone()
        .or_else(|| text(input.as_ref(), "name"))
        .or_else(|| text(input.as_ref(), "description"))
        .or_else(|| text(output.as_ref(), "agent_nickname"));
    let id = text(output.as_ref(), "agent_id")
        .or_else(|| text(output.as_ref(), "agentId"))
        .or_else(|| agent_id_in_output(pair.result_output().unwrap_or_default()));
    let selector = id
        .or_else(|| text(output.as_ref(), "task_name"))
        .or_else(|| {
            task.as_ref().map(|task| {
                if task.starts_with('/') {
                    task.clone()
                } else {
                    format!("{agent_path}/{task}")
                }
            })
        })
        .or_else(|| name.clone())?;
    target.insert("selector".to_string(), selector.clone().into());
    target.insert("name".to_string(), name.unwrap_or(selector).into());
    if let Some(agent_type) =
        text(input.as_ref(), "subagent_type").or_else(|| text(input.as_ref(), "agent_type"))
    {
        target.insert("agentType".to_string(), agent_type.into());
    }
    if let Some(task) = text(input.as_ref(), "description") {
        target.insert("task".to_string(), task.into());
    }
    Some(Value::Object(target))
}

/// A selector that points back at the conversation being read is not a link.
pub fn is_subagent_self(selector: &str, agent_path: &str) -> bool {
    selector == "/root" || selector == agent_path
}
