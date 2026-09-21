//! Family f's parity gate: runs the Rust port over the same table
//! `tooling/gx-chat-core/extras-parity.ts` ran the shipped TypeScript over, and reports every case
//! whose answer differs.
//!
//! The replay gate (`docs/2026-09-21/rust-chat/REPLAY.md`) drives the whole brain and therefore
//! waits on family a's fold. This one covers family f's own rules on their own, including the
//! branches a recording never reaches.
//!
//! ```text
//! bun tooling/gx-chat-core/extras-parity.ts
//! cargo run --example extras_parity
//! ```
//!
//! The fixture is invented, so this example may print its values; a replay recording may not.

use std::collections::BTreeMap;
use std::process::ExitCode;

use ghostex_gx_chat_core::extras::activity::{activity_elapsed_seconds, format_activity_elapsed};
use ghostex_gx_chat_core::extras::agent_fleet::{agent_fleet_rows, subagent_model_label};
use ghostex_gx_chat_core::extras::agent_tasks::agent_task_panel;
use ghostex_gx_chat_core::extras::minimap_rail::{geometry, minimap_preview, minimap_preview_text};
use ghostex_gx_chat_core::extras::save_markdown_paths::{
    folder_path_error, markdown_stem_error, normalized_folder_path, normalized_markdown_stem,
    suggested_markdown_stem,
};
use ghostex_gx_chat_core::extras::subagent_target::{is_subagent_self, tool_subagent};
use ghostex_gx_chat_core::extras::terminal_tail_format::format_terminal_tail_preview;
use ghostex_gx_chat_core::extras::transcript_search::{
    search_count_label, transcript_item_text, transcript_matches,
};
use ghostex_gx_chat_core::extras::welcome::{
    empty_state_copy, format_duration, new_session_welcome_title, shows_new_session_welcome,
    welcome_agent_icon, welcome_agent_name,
};
use ghostex_gx_chat_core::extras::working_words::pick_working_word;
use ghostex_gx_chat_core::ChatContext;
use serde_json::{json, Value};

fn main() -> ExitCode {
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "/tmp/gx-chat/extras-parity.json".to_string());
    let Ok(text) = std::fs::read_to_string(&path) else {
        eprintln!("fixture not found: {path}");
        eprintln!("run: bun tooling/gx-chat-core/extras-parity.ts");
        return ExitCode::FAILURE;
    };
    let fixture: Value = serde_json::from_str(&text).expect("the fixture is JSON");
    let now = fixture["now"].as_f64().expect("the fixture carries `now`");
    let context = ChatContext::at(now);

    let mut checked = 0usize;
    let mut differences: BTreeMap<String, usize> = BTreeMap::new();
    let mut first: Vec<String> = Vec::new();
    let groups = fixture["cases"].as_object().expect("`cases` is an object");
    for (group, list) in groups {
        for (index, case) in list
            .as_array()
            .expect("a group is a list")
            .iter()
            .enumerate()
        {
            let input = &case["input"];
            let expected = &case["output"];
            let Some(actual) = run(group, input, &context) else {
                *differences
                    .entry(format!("{group} (not covered)"))
                    .or_default() += 1;
                continue;
            };
            checked += 1;
            if &actual != expected {
                *differences.entry(group.clone()).or_default() += 1;
                if first.len() < 12 {
                    first.push(format!(
                        "  {group}[{index}]\n    input    {input}\n    expected {expected}\n    actual   {actual}"
                    ));
                }
            }
        }
    }

    let total: usize = differences.values().sum();
    println!("fixture     {path}");
    println!("checked     {checked} cases in {} groups", groups.len());
    println!("differences {total}");
    for (group, count) in &differences {
        println!("  {group}  x{count}");
    }
    for line in &first {
        println!("{line}");
    }
    if total == 0 {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

/// The Rust answer for one case, or `None` when this build does not cover the group.
fn run(group: &str, input: &Value, context: &ChatContext) -> Option<Value> {
    Some(match group {
        "workingWord" => json!(pick_working_word(input.as_f64()?)),
        "activityElapsed" => json!(format_activity_elapsed(input.as_f64()?)),
        "activitySeconds" => number(activity_elapsed_seconds(
            input.get("elapsedSeconds").and_then(Value::as_f64),
            input.get("detectedAt").and_then(Value::as_str)?,
            context.now_ms,
            context.utc_offset_minutes,
        )),
        "modelLabel" => json!(subagent_model_label(
            input.get("model").and_then(Value::as_str),
            input.get("effort").and_then(Value::as_str),
        )),
        "fleetStrip" => {
            let fleet = input.get("fleet").filter(|value| !value.is_null());
            match agent_fleet_rows(fleet, input["provider"].as_str(), context) {
                Some(strip) => serde_json::to_value(strip).ok()?,
                None => Value::Null,
            }
        }
        "taskPanel" => {
            let tasks = input.get("tasks").filter(|value| !value.is_null());
            match agent_task_panel(
                tasks,
                input["collapsed"].as_bool()?,
                input["showCompleted"].as_bool()?,
            ) {
                Some(panel) => serde_json::to_value(panel).ok()?,
                None => Value::Null,
            }
        }
        "tailPreview" => {
            let lines: Vec<String> = input
                .as_array()?
                .iter()
                .map(|line| line.as_str().unwrap_or_default().to_string())
                .collect();
            json!(format_terminal_tail_preview(&lines))
        }
        "minimapPreview" => {
            let message = input.as_object().map(|_| input);
            json!({
                "text": minimap_preview_text(message),
                "preview": minimap_preview(message, geometry().preview_limit),
            })
        }
        "minimapGeometry" => serde_json::to_value(geometry()).ok()?,
        "searchMatches" => {
            serde_json::to_value(transcript_matches(&search_items(), input.as_str()?)).ok()?
        }
        "searchLabel" => json!(search_count_label(
            input["query"].as_str()?,
            input["total"].as_u64()? as usize,
            input["activeIndex"].as_u64()? as usize,
        )),
        "searchItemText" => json!(transcript_item_text(input)),
        "subagentTarget" => {
            let call = input.get("call").filter(|value| !value.is_null());
            let result = input.get("result").filter(|value| !value.is_null());
            match tool_subagent(call, result, input["agentPath"].as_str()?) {
                Some(target) => serde_json::to_value(target).ok()?,
                None => Value::Null,
            }
        }
        "subagentSelf" => json!(is_subagent_self(
            input["selector"].as_str()?,
            input["agentPath"].as_str()?
        )),
        "showsWelcome" => json!(shows_new_session_welcome(input.as_str()?)),
        "welcomeAgentName" => match welcome_agent_name(input.as_str()) {
            Some(name) => json!(name),
            None => Value::Null,
        },
        "welcomeTitle" => json!(new_session_welcome_title(input.as_str())),
        "welcomeIcon" => match welcome_agent_icon(
            input.get("label").and_then(Value::as_str),
            input.get("icon").and_then(Value::as_str),
        ) {
            Some(icon) => json!(icon),
            None => Value::Null,
        },
        "emptyState" => serde_json::to_value(empty_state_copy(
            input["kind"].as_str()?,
            input.get("agent").and_then(Value::as_str),
        ))
        .ok()?,
        "duration" => json!(format_duration(input.as_f64()?)),
        "folderError" => match folder_path_error(input.as_str()?) {
            Some(error) => json!(error),
            None => Value::Null,
        },
        "folderPath" => json!(normalized_folder_path(input.as_str()?)),
        "stemError" => match markdown_stem_error(input.as_str()?) {
            Some(error) => json!(error),
            None => Value::Null,
        },
        "stem" => json!(normalized_markdown_stem(input.as_str()?)),
        "suggestedStem" => {
            let existing: Vec<String> = input["existing"]
                .as_array()?
                .iter()
                .map(|path| path.as_str().unwrap_or_default().to_string())
                .collect();
            json!(suggested_markdown_stem(
                input["title"].as_str()?,
                input["folder"].as_str()?,
                &existing
            ))
        }
        _ => return None,
    })
}

/// A JavaScript number, or `null`: an integral value serializes without a fractional part.
fn number(value: Option<f64>) -> Value {
    match value {
        Some(value) if value.fract() == 0.0 => Value::from(value as i64),
        Some(value) => Value::from(value),
        None => Value::Null,
    }
}

/// The transcript rows the search cases run over, the same list the fixture used.
fn search_items() -> Vec<Value> {
    vec![
        json!({ "kind": "message", "message": { "id": "m1", "text": "the cat sat on the mat" } }),
        json!({
            "kind": "summary",
            "id": "t1",
            "user": { "id": "u1", "text": "cat" },
            "final": { "id": "f1", "text": "CAT cat" },
            "work": [{
                "id": "w1",
                "tools": [{ "call": { "name": "Cat" }, "preview": "cat preview" }],
                "files": [{ "path": "/tmp/cat.txt" }]
            }]
        }),
        json!({
            "kind": "completed-work",
            "id": "t2",
            "label": "Worked for 3s",
            "artifacts": [{ "id": "a1", "suppressed": { "label": "a cat card" } }]
        }),
    ]
}
