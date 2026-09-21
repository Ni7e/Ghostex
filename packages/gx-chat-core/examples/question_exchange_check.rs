//! Family c's gate for the answered-question exchange parser.
//!
//! Usage: `cargo run --example question_exchange_check`
//!
//! `packages/shared/session-chat-presentation/questions.ts` is the one part of family c that no
//! recording reaches: the exchange it builds is drawn by family b, so it never appears under a
//! key family c publishes, and neither synthetic recording contains an answered question tool
//! call. `tooling/gx-chat-core/question-exchange-cases.ts` runs the shipped TypeScript over a
//! file of invented cases; this compares the Rust port's answer to each of them.
//!
//! Differences are reported by case name and JSON pointer, never by value.

use std::process::ExitCode;

use ghostex_gx_chat_core::questions::answered_question_exchange;
use serde_json::Value;

const EXPECTED: &str = "/tmp/gx-chat/expected/question-exchange.json";

fn main() -> ExitCode {
    let Ok(text) = std::fs::read_to_string(EXPECTED) else {
        eprintln!("unreadable expected output: {EXPECTED}");
        eprintln!("run `bun tooling/gx-chat-core/question-exchange-cases.ts` first");
        return ExitCode::from(2);
    };
    let Ok(Value::Array(rows)) = serde_json::from_str::<Value>(&text) else {
        eprintln!("the expected output is not a list of cases");
        return ExitCode::from(2);
    };
    let mut differences = 0usize;
    for row in &rows {
        let name = row.get("name").and_then(Value::as_str).unwrap_or("?");
        let tool = row.get("tool").and_then(Value::as_str).unwrap_or("");
        let output = row.get("output").and_then(Value::as_str).unwrap_or("");
        let is_error = row.get("isError") == Some(&Value::Bool(true));
        let input = row.get("input").cloned().unwrap_or(Value::Null);
        let expected = row.get("exchange").cloned().unwrap_or(Value::Null);
        let mine = answered_question_exchange(tool, &input, output, is_error)
            .map(|exchange| serde_json::to_value(&exchange).unwrap_or(Value::Null))
            .unwrap_or(Value::Null);
        let mut found = Vec::new();
        compare(&expected, &mine, &mut String::new(), &mut found);
        if found.is_empty() {
            continue;
        }
        differences += found.len();
        println!("{name}");
        for pointer in found {
            println!("  {pointer}");
        }
    }
    println!("cases       {}", rows.len());
    println!("differences {differences}");
    if differences == 0 {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

/// Collects the JSON pointers at which two values differ.
fn compare(left: &Value, right: &Value, pointer: &mut String, out: &mut Vec<String>) {
    match (left, right) {
        (Value::Object(left), Value::Object(right)) => {
            let mut keys: Vec<&String> = left.keys().chain(right.keys()).collect();
            keys.sort();
            keys.dedup();
            for key in keys {
                let length = pointer.len();
                pointer.push('/');
                pointer.push_str(&key.replace('~', "~0").replace('/', "~1"));
                match (left.get(key), right.get(key)) {
                    (Some(left), Some(right)) => compare(left, right, pointer, out),
                    _ => out.push(pointer.clone()),
                }
                pointer.truncate(length);
            }
        }
        (Value::Array(left), Value::Array(right)) => {
            if left.len() != right.len() {
                out.push(format!("{pointer} (length)"));
                return;
            }
            for (index, (left, right)) in left.iter().zip(right).enumerate() {
                let length = pointer.len();
                pointer.push('/');
                pointer.push_str(&index.to_string());
                compare(left, right, pointer, out);
                pointer.truncate(length);
            }
        }
        (left, right) if left != right => out.push(if pointer.is_empty() {
            "/".to_string()
        } else {
            pointer.clone()
        }),
        _ => {}
    }
}
