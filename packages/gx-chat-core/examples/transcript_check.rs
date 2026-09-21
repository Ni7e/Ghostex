//! Family b's replay gate: the same message lists through both projections, item by item.
//!
//! `bun tooling/gx-chat-core/synthetic-b.ts` runs the shipped rules
//! (`packages/shared/session-chat-controller/native-presentation.ts`) over a set of message lists
//! built from the Chat Lab fixtures and writes what each one produced. This replays the same inputs
//! through `src/transcript/` and reports the JSON pointers that differ.
//!
//! Usage: `cargo run --example transcript_check [-- /tmp/gx-chat/transcript-b.json]`
//!
//! The report is pointers and counts only, never values: the same rule the recording gate follows,
//! so the example is safe to point at a fixture built from a real conversation.

use std::collections::BTreeMap;
use std::process::ExitCode;

use ghostex_gx_chat_core::{transcript, ChatContext, ChatState};
use serde_json::Value;

const DEFAULT_FIXTURE: &str = "/tmp/gx-chat/transcript-b.json";

fn main() -> ExitCode {
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| DEFAULT_FIXTURE.to_string());
    let Ok(text) = std::fs::read_to_string(&path) else {
        eprintln!("fixture        missing: {path}");
        eprintln!("               run: bun tooling/gx-chat-core/synthetic-b.ts");
        return ExitCode::FAILURE;
    };
    let Ok(fixture) = serde_json::from_str::<Value>(&text) else {
        eprintln!("fixture        not JSON: {path}");
        return ExitCode::FAILURE;
    };
    if fixture.get("v") != Some(&Value::from(1)) {
        eprintln!("fixture        unknown format version");
        return ExitCode::FAILURE;
    }
    let context = ChatContext {
        now_ms: fixture
            .get("nowMs")
            .and_then(Value::as_f64)
            .unwrap_or_default(),
        utc_offset_minutes: fixture
            .get("utcOffsetMinutes")
            .and_then(Value::as_i64)
            .unwrap_or_default() as i32,
        ..ChatContext::default()
    };
    let Some(Value::Array(cases)) = fixture.get("cases") else {
        eprintln!("fixture        has no cases");
        return ExitCode::FAILURE;
    };

    let mut pointers: BTreeMap<String, usize> = BTreeMap::new();
    let mut matched = 0;
    let mut items = 0;
    let mut details = 0;
    let mut failed_cases: Vec<&str> = Vec::new();

    for case in cases {
        let name = case.get("name").and_then(Value::as_str).unwrap_or("?");
        let mut state = ChatState::default();
        state.messages.composed = match case.get("messages").cloned() {
            Some(value) => serde_json::from_value(value).unwrap_or_default(),
            None => Vec::new(),
        };
        state.session.server_working = case.get("working") == Some(&Value::Bool(true));
        state.transcript_view.summary_mode = case.get("summary") == Some(&Value::Bool(true));
        state.transcript_view.working_directory = case
            .get("workingDirectory")
            .and_then(Value::as_str)
            .map(str::to_string);
        if let Some(agent_path) = case.get("agentPath").and_then(Value::as_str) {
            state.transcript_view.agent_path = agent_path.to_string();
        }

        let actual =
            serde_json::to_value(transcript::rows(&state, &context)).unwrap_or(Value::Null);
        let expected = case.get("items").cloned().unwrap_or(Value::Null);
        items += expected.as_array().map_or(0, Vec::len);
        let before = pointers.len();
        let mut differences = 0;
        compare(
            &expected,
            &actual,
            &format!("/{name}/items"),
            &mut pointers,
            &mut differences,
        );

        let expected_final = case.get("finalIds").cloned().unwrap_or(Value::Null);
        let actual_final =
            serde_json::to_value(state.transcript_view.final_ids.clone()).unwrap_or(Value::Null);
        // `rows` does not fill the cached ids; the projection does, so it is read the same way.
        let actual_final = if actual_final == Value::Array(Vec::new()) {
            let mut warmed = state.clone();
            transcript::rows::refresh(&mut warmed, &context);
            serde_json::to_value(warmed.transcript_view.final_ids).unwrap_or(Value::Null)
        } else {
            actual_final
        };
        compare(
            &expected_final,
            &actual_final,
            &format!("/{name}/finalIds"),
            &mut pointers,
            &mut differences,
        );

        if let Some(Value::Array(requests)) = case.get("rowDetails") {
            state.transcript_view.open_rows = requests
                .iter()
                .map(|request| ghostex_gx_chat_core::state::OpenRow {
                    key: request["key"].as_str().unwrap_or_default().to_string(),
                    kind: request["kind"].as_str().unwrap_or_default().to_string(),
                    message_id: request["messageId"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    index: request["index"].as_u64().unwrap_or_default() as usize,
                })
                .collect();
            let mut expected_details = serde_json::Map::new();
            for request in requests {
                expected_details.insert(
                    request["key"].as_str().unwrap_or_default().to_string(),
                    request["detail"].clone(),
                );
            }
            let actual_details = serde_json::to_value(transcript::row_details(&state, &context))
                .unwrap_or(Value::Null);
            details += expected_details.len();
            compare(
                &Value::Object(expected_details),
                &actual_details,
                &format!("/{name}/rowDetails"),
                &mut pointers,
                &mut differences,
            );
        }

        if differences == 0 {
            matched += 1;
        } else {
            failed_cases.push(name);
        }
        let _ = before;
    }

    let total: usize = pointers.values().sum();
    println!("fixture        {path}");
    println!(
        "cases          {matched}/{} matched, {items} expected items, {details} open rows",
        cases.len()
    );
    println!("differences    {total} at {} pointers", pointers.len());
    for (pointer, count) in pointers.iter().take(60) {
        println!("  {pointer}  x{count}");
    }
    if pointers.len() > 60 {
        println!("  … {} more pointers", pointers.len() - 60);
    }
    if !failed_cases.is_empty() {
        println!("cases failing  {}", failed_cases.join(", "));
    }
    if total == 0 {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

/// Walks both values together and records the pointer of every difference.
///
/// The pointer is generalised on the way down: an array index becomes `[]` so a whole transcript's
/// worth of the same mistake reports as one row with a count, and never as a value.
fn compare(
    expected: &Value,
    actual: &Value,
    pointer: &str,
    pointers: &mut BTreeMap<String, usize>,
    differences: &mut usize,
) {
    match (expected, actual) {
        (Value::Object(left), Value::Object(right)) => {
            let mut keys: Vec<&String> = left.keys().collect();
            for key in right.keys() {
                if !left.contains_key(key) {
                    keys.push(key);
                }
            }
            for key in keys {
                let child = format!("{pointer}/{key}");
                match (left.get(key), right.get(key)) {
                    (Some(left), Some(right)) => {
                        compare(left, right, &child, pointers, differences)
                    }
                    _ => record(&child, pointers, differences),
                }
            }
        }
        (Value::Array(left), Value::Array(right)) => {
            if left.len() != right.len() {
                record(&format!("{pointer}/length"), pointers, differences);
            }
            for index in 0..left.len().min(right.len()) {
                compare(
                    &left[index],
                    &right[index],
                    &format!("{pointer}/[]"),
                    pointers,
                    differences,
                );
            }
        }
        (left, right) if left == right => {}
        (Value::Number(left), Value::Number(right)) if left.as_f64() == right.as_f64() => {
            record(
                &format!("{pointer} (number representation)"),
                pointers,
                differences,
            );
        }
        _ => record(pointer, pointers, differences),
    }
}

fn record(pointer: &str, pointers: &mut BTreeMap<String, usize>, differences: &mut usize) {
    *pointers.entry(pointer.to_string()).or_default() += 1;
    *differences += 1;
}
