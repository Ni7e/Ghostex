//! Family d's replay gate: the five pure queries, answered by the Rust core and fingerprinted the
//! way the recorder fingerprints the TypeScript's answers.
//!
//! ```text
//! cargo run --example composer_check -- /tmp/gx-chat/synthetic.jsonl /tmp/gx-chat/synthetic-composer.jsonl
//! ```
//!
//! A recording holds the user's conversation, so nothing here prints a record's arguments or an
//! answer: the report is a count per method, and a mismatch names the method and the record
//! number only.
//!
//! This exists because `examples/replay.rs` (family a's) does not yet. It gates exactly the part of
//! family d whose output is fingerprinted rather than diffed, and it is deleted when the full
//! replay lands.

use std::collections::BTreeMap;
use std::fs;
use std::process::ExitCode;

use ghostex_gx_chat_core::composer::keys::ComposerKeyEvent;
use ghostex_gx_chat_core::composer::queries::{
    composer_key_intent, composer_references, reference_menu, send_blocked_toast, transcript_menu,
};
use serde_json::Value;

const FNV_PRIME: u32 = 0x0100_0193;
const FNV_OFFSET_A: u32 = 0x811c_9dc5;
const FNV_OFFSET_B: u32 = 0x0f1b_bcd9;

/// Two 32-bit FNV-1a passes over the UTF-16 code units, low byte then high byte.
///
/// The same function as `nativeChatReplayHash` in
/// `packages/shared/session-chat-controller/native-host-replay.ts`.
fn replay_hash(text: &str) -> String {
    format!(
        "{:08x}{:08x}",
        fnv1a32(text, FNV_OFFSET_A),
        fnv1a32(text, FNV_OFFSET_B)
    )
}

fn fnv1a32(text: &str, seed: u32) -> u32 {
    let mut hash = seed;
    for unit in text.encode_utf16() {
        hash = (hash ^ u32::from(unit & 0xff)).wrapping_mul(FNV_PRIME);
        hash = (hash ^ u32::from(unit >> 8)).wrapping_mul(FNV_PRIME);
    }
    hash
}

/// `JSON.stringify(value ?? null) ?? 'null'`, which is what the recorder hashed.
///
/// The typed answer is serialized straight to text, never through `serde_json::Value`: a `Value`
/// object is a `BTreeMap`, so a detour through one would sort `{action, path, type, view, line}`
/// into alphabetical order and change the fingerprint of a value that is in fact identical.
fn serialize<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
}

fn answer(method: &str, args: &[Value]) -> Option<String> {
    let first = args.first();
    Some(match method {
        "composerReferences" => serialize(&composer_references(first.and_then(Value::as_str)?)),
        "composerKeyIntent" => {
            let event: ComposerKeyEvent = serde_json::from_value(first?.clone()).ok()?;
            let platform = args.get(1).and_then(Value::as_str);
            serialize(&composer_key_intent(&event, platform))
        }
        "referenceMenu" => serialize(&reference_menu(first.and_then(Value::as_str)?)),
        "transcriptMenu" => {
            let request = first?;
            let href = request.get("href").and_then(Value::as_str);
            let selection = request
                .get("selection")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let question_active = request.get("questionActive") == Some(&Value::Bool(true));
            serialize(&transcript_menu(href, selection, question_active))
        }
        "sendBlockedToast" => serialize(&send_blocked_toast(first.and_then(Value::as_str)?)),
        _ => return None,
    })
}

fn main() -> ExitCode {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    let paths = if paths.is_empty() {
        vec![
            "/tmp/gx-chat/synthetic.jsonl".to_string(),
            "/tmp/gx-chat/synthetic-composer.jsonl".to_string(),
        ]
    } else {
        paths
    };

    let mut matched: BTreeMap<String, usize> = BTreeMap::new();
    let mut differed: BTreeMap<String, Vec<u64>> = BTreeMap::new();
    let mut skipped = 0usize;
    let mut failed = false;

    for path in &paths {
        let Ok(text) = fs::read_to_string(path) else {
            println!("missing     {path}");
            failed = true;
            continue;
        };
        let mut queries = 0usize;
        for line in text.lines().filter(|line| !line.is_empty()) {
            let Ok(record) = serde_json::from_str::<Value>(line) else {
                // A recording ends when the app does, so a half-written final line is normal.
                continue;
            };
            if record.get("k").and_then(Value::as_str) != Some("query") {
                continue;
            }
            queries += 1;
            let method = record
                .get("m")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let number = record.get("n").and_then(Value::as_u64).unwrap_or_default();
            let args: Vec<Value> = record
                .get("a")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let Some(answer) = answer(&method, &args) else {
                skipped += 1;
                continue;
            };
            let expected = record
                .get("hash")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let expected_len = record.get("len").and_then(Value::as_u64);
            let actual = replay_hash(&answer);
            let actual_len = answer.encode_utf16().count() as u64;
            if actual == expected && expected_len.is_none_or(|len| len == actual_len) {
                *matched.entry(method).or_default() += 1;
            } else {
                differed.entry(method).or_default().push(number);
                failed = true;
            }
        }
        println!("recording   {path} ({queries} queries)");
    }

    for (method, count) in &matched {
        println!("matched     {method} x{count}");
    }
    for (method, records) in &differed {
        println!(
            "DIFFERED    {method} x{} at records {records:?}",
            records.len()
        );
    }
    if skipped > 0 {
        println!("skipped     {skipped} (method not answered by family d)");
    }
    if failed {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}
