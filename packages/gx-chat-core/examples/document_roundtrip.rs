//! Checks that a recorded chat frame survives this crate's types unchanged.
//!
//! Usage: `cargo run --example document_roundtrip -- <path>...`
//!
//! Each path is a frame as `nativeChat.take()` produced it (a bare document is accepted too). The
//! example deserializes it into [`Frame`], serializes it back, and compares the two values. A
//! difference is reported as a JSON pointer and a reason only: recordings hold real conversations,
//! so no value from the file is ever printed.
//!
//! Generate a private-data-free input with `bun tooling/gx-chat-core/sample-document.ts`.

use std::collections::BTreeSet;
use std::process::ExitCode;

use ghostex_gx_chat_core::{Document, Frame};
use serde_json::Value;

fn main() -> ExitCode {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    if paths.is_empty() {
        eprintln!("usage: document_roundtrip <path>...");
        return ExitCode::from(2);
    }
    let mut failed = false;
    for path in &paths {
        match check(path) {
            Ok(differences) if differences.is_empty() => println!("{path}: 0 differences"),
            Ok(differences) => {
                failed = true;
                println!("{path}: {} differences", differences.len());
                for difference in differences {
                    println!("  {} ({})", difference.pointer, difference.reason);
                }
            }
            Err(error) => {
                failed = true;
                println!("{path}: {error}");
            }
        }
    }
    if failed {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}

fn check(path: &str) -> Result<Vec<Difference>, String> {
    let text = std::fs::read_to_string(path).map_err(|error| format!("unreadable: {error}"))?;
    let original: Value =
        serde_json::from_str(&text).map_err(|error| format!("bad JSON: {error}"))?;
    // A frame has a revision; anything else is treated as a bare document.
    let reserialized = if original.get("revision").is_some() {
        let frame: Frame = serde_json::from_value(original.clone())
            .map_err(|error| format!("frame does not deserialize: {error}"))?;
        serde_json::to_value(&frame)
            .map_err(|error| format!("frame does not serialize: {error}"))?
    } else {
        let document: Document = serde_json::from_value(original.clone())
            .map_err(|error| format!("document does not deserialize: {error}"))?;
        serde_json::to_value(&document)
            .map_err(|error| format!("document does not serialize: {error}"))?
    };
    let mut differences = Vec::new();
    compare(
        &original,
        &reserialized,
        &mut String::new(),
        &mut differences,
    );
    Ok(differences)
}

/// One place the round trip changed the document. Carries no value from the file.
struct Difference {
    pointer: String,
    reason: &'static str,
}

fn compare(left: &Value, right: &Value, pointer: &mut String, out: &mut Vec<Difference>) {
    match (left, right) {
        (Value::Object(left), Value::Object(right)) => {
            let keys: BTreeSet<&String> = left.keys().chain(right.keys()).collect();
            for key in keys {
                let length = pointer.len();
                pointer.push('/');
                pointer.push_str(&escape(key));
                match (left.get(key), right.get(key)) {
                    (Some(left), Some(right)) => compare(left, right, pointer, out),
                    (Some(_), None) => out.push(difference(pointer, "key dropped")),
                    (None, Some(_)) => out.push(difference(pointer, "key invented")),
                    (None, None) => {}
                }
                pointer.truncate(length);
            }
        }
        (Value::Array(left), Value::Array(right)) => {
            if left.len() != right.len() {
                out.push(difference(pointer, "length changed"));
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
        (Value::Number(left), Value::Number(right)) if left != right => {
            // An integer written back as a float is a contract break even though the two compare
            // equal numerically, so the representation is what is checked.
            out.push(difference(pointer, "number representation changed"));
        }
        (left, right) if left != right => out.push(difference(pointer, "value changed")),
        _ => {}
    }
}

fn difference(pointer: &str, reason: &'static str) -> Difference {
    Difference {
        pointer: if pointer.is_empty() {
            "/".to_string()
        } else {
            pointer.to_string()
        },
        reason,
    }
}

/// JSON pointer escaping, so a key holding `/` or `~` still names one place.
fn escape(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}
