//! Replays a recording through the Rust core and writes one document per line.
//!
//! ```text
//! cargo run --release --example replay -- /tmp/gx-chat/synthetic.jsonl
//! cargo run --release --example replay -- --utc-offset 240 /tmp/gx-chat/synthetic.jsonl
//! ```
//!
//! The format, the fingerprint and the output shape are `docs/2026-09-21/rust-chat/REPLAY.md`.
//! Recordings are the user's conversation: this example reads them from `/tmp/gx-chat/` and writes
//! to `/tmp/gx-chat/actual/`, and prints counts only, never content.
//!
//! Everything below the recording's own framing is `ghostex_gx_chat_core::bridge`: [`BridgeCall`]
//! parses one call out of the method name and the argument array, and [`BridgeTranslator`] feeds it
//! to the core and answers what the core asks for (gxserver calls from the recording's own
//! `resolve` records, client storage from an in-memory map). The desktop host runs the same two
//! against the live bridge to drive the core in SHADOW beside the QuickJS brain, so this file owns
//! only what is specific to a recording: reading JSONL, the clock and random queues each record
//! carries, the fingerprint, and the report.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use ghostex_gx_chat_core::bridge::{BridgeCall, BridgeTranslator};
use ghostex_gx_chat_core::{ChatContext, ChatCore};
use serde_json::{Map, Value};

fn main() {
    let mut inputs: Vec<PathBuf> = Vec::new();
    let mut utc_offset_minutes = 0i32;
    let mut arguments = std::env::args().skip(1);
    while let Some(argument) = arguments.next() {
        if argument == "--utc-offset" {
            utc_offset_minutes = arguments
                .next()
                .and_then(|value| value.parse().ok())
                .unwrap_or(0);
        } else {
            inputs.push(PathBuf::from(argument));
        }
    }
    if inputs.is_empty() {
        inputs.push(PathBuf::from("/tmp/gx-chat/synthetic.jsonl"));
    }
    let mut failures = 0;
    for input in inputs {
        match replay(&input, utc_offset_minutes) {
            Ok(report) => {
                println!("{report}");
                if report.unanswered > 0
                    || report.unmatched_answers > 0
                    || report.queries_differed > 0
                {
                    failures += 1;
                }
            }
            Err(message) => {
                println!("{}: {message}", input.display());
                failures += 1;
            }
        }
    }
    if failures > 0 {
        std::process::exit(1);
    }
}

struct Report {
    name: String,
    records: usize,
    inputs: usize,
    documents: usize,
    queries: usize,
    queries_differed: usize,
    refused: usize,
    /// Requests the core made that the recording never answered.
    unanswered: usize,
    /// Recorded answers that arrived with no request of the core's waiting.
    unmatched_answers: usize,
    output: PathBuf,
}

impl std::fmt::Display for Report {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "recording       {} ({} records)\nreplayed        {} inputs, {} queries, {} documents\nqueries         {}/{} fingerprints matched\nrequests        {} unanswered, {} answers with no request\nrefused         {} inputs\nactual          {}",
            self.name,
            self.records,
            self.inputs,
            self.queries,
            self.documents,
            self.queries - self.queries_differed,
            self.queries,
            self.unanswered,
            self.unmatched_answers,
            self.refused,
            self.output.display()
        )
    }
}

fn replay(input: &Path, utc_offset_minutes: i32) -> Result<Report, String> {
    let text = fs::read_to_string(input).map_err(|error| error.to_string())?;
    let name = input
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("recording")
        .to_string();
    let directory = PathBuf::from("/tmp/gx-chat/actual");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let output = directory.join(format!("{name}.jsonl"));
    let mut sink = fs::File::create(&output).map_err(|error| error.to_string())?;

    let mut core = ChatCore::new();
    let mut translator = BridgeTranslator::new();
    let mut records = 0usize;
    let mut inputs = 0usize;
    let mut documents = 0usize;
    let mut queries = 0usize;
    let mut queries_differed = 0usize;
    let mut refused = 0usize;

    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            // The last line of a live recording may be truncated, which is normal.
            continue;
        };
        records += 1;
        if record.get("k").and_then(Value::as_str) == Some("header") {
            let version = record.get("v").and_then(Value::as_u64).unwrap_or(0);
            if version != 1 {
                return Err(format!("unknown recording format {version}"));
            }
            continue;
        }
        let kind = record.get("k").and_then(Value::as_str).unwrap_or_default();
        let method = record.get("m").and_then(Value::as_str).unwrap_or_default();
        let args = record
            .get("a")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        // `ms` is the record's own `now_ms` and `r` is every `Math.random()` the live run read
        // during this call, in order: the two queues the core draws from instead of reading a
        // clock or a random source (`docs/2026-09-21/rust-chat/REPLAY.md`).
        let mut context = ChatContext::at(record.get("ms").and_then(Value::as_f64).unwrap_or(0.0));
        context.utc_offset_minutes = utc_offset_minutes;
        if let Some(draws) = record.get("r").and_then(Value::as_array) {
            for (slot, draw) in draws.iter().take(context.random_units.len()).enumerate() {
                context.random_units[slot] = draw.as_f64().unwrap_or(0.0);
            }
        }
        // `u` is every `crypto.randomUUID()` the live run read during this call. The core takes
        // them as numbers so its context stays `Copy`; parsing the recorded text back and letting
        // `ChatContext::random_id` print it again round-trips to the same string.
        if let Some(ids) = record.get("u").and_then(Value::as_array) {
            for (slot, id) in ids.iter().take(context.random_ids.len()).enumerate() {
                context.random_ids[slot] = id.as_str().map(uuid_bits).unwrap_or_default();
            }
        }

        let Some(call) = BridgeCall::parse(method, &args) else {
            if kind == "in" {
                inputs += 1;
                refused += 1;
            }
            continue;
        };
        let outcome = translator.feed(&mut core, call, context);
        match kind {
            "in" => {
                inputs += 1;
                if outcome.applied == 0 {
                    // `GX_CHAT_REFUSALS=1` names the records this build did not model, by number
                    // and by kind. A refusal is where the two brains stop being comparable, so
                    // finding the first one is the first thing to do when a recording's count
                    // drops; the record's arguments are never printed.
                    if std::env::var("GX_CHAT_REFUSALS").is_ok() {
                        let number = record.get("n").and_then(Value::as_u64).unwrap_or_default();
                        let kind = args
                            .first()
                            .and_then(|first| first.get("type").or_else(|| first.get("kind")))
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        eprintln!("refused n={number} method={method} kind={kind}");
                    }
                    refused += 1;
                }
            }
            "query" => {
                queries += 1;
                let recorded = record.get("hash").and_then(Value::as_str);
                match (outcome.query, recorded) {
                    (Some(answer), Some(recorded)) if fingerprint(&answer) == recorded => {}
                    (_, None) => {}
                    _ => queries_differed += 1,
                }
            }
            "doc" => {
                let Some(frame) = outcome.frame else {
                    continue;
                };
                let document = serde_json::to_value(&frame).map_err(|error| error.to_string())?;
                let serialized =
                    serde_json::to_string(&document).map_err(|error| error.to_string())?;
                let mut out = Map::new();
                out.insert(
                    "n".to_string(),
                    record.get("n").cloned().unwrap_or(Value::Null),
                );
                // The recorded `a[0]` is the TypeScript host's own revision counter, which the
                // translator does not replay (it drains against its own). It still rides in the
                // output line so the two files line up record for record.
                out.insert(
                    "lastRevision".to_string(),
                    args.first()
                        .and_then(Value::as_u64)
                        .map(Value::from)
                        .unwrap_or(Value::Null),
                );
                out.insert("hash".to_string(), Value::String(fingerprint(&serialized)));
                out.insert("document".to_string(), document);
                writeln!(
                    sink,
                    "{}",
                    serde_json::to_string(&Value::Object(out)).map_err(|error| error.to_string())?
                )
                .map_err(|error| error.to_string())?;
                documents += 1;
            }
            _ => {}
        }
    }

    // Storage answers the recording ran out of `resolve` records for are delivered at the end,
    // so a surface that reads one is not left loading in the last documents of the run.
    translator.flush_storage(&mut core, ChatContext::at(0.0));
    Ok(Report {
        name,
        records,
        inputs,
        documents,
        queries,
        queries_differed,
        refused,
        unanswered: translator.unanswered(),
        unmatched_answers: translator.unmatched_answers(),
        output,
    })
}

/// Two 32-bit FNV-1a passes over the UTF-16 code units, low byte then high byte, printed as 16
/// lowercase hex characters. `nativeChatReplayHash` in
/// `packages/shared/session-chat-controller/native-host-replay.ts`.
fn fingerprint(text: &str) -> String {
    format!(
        "{:08x}{:08x}",
        fnv(text, 0x811c_9dc5),
        fnv(text, 0x0f1b_bcd9)
    )
}

/// The 128 bits of a canonical UUID string, so the core can print the same one back.
fn uuid_bits(text: &str) -> u128 {
    let mut bits = 0u128;
    for digit in text.chars().filter_map(|unit| unit.to_digit(16)) {
        bits = (bits << 4) | u128::from(digit);
    }
    bits
}

fn fnv(text: &str, seed: u32) -> u32 {
    let mut hash = seed;
    for unit in text.encode_utf16() {
        hash = (hash ^ u32::from(unit & 0xff)).wrapping_mul(0x0100_0193);
        hash = (hash ^ u32::from(unit >> 8)).wrapping_mul(0x0100_0193);
    }
    hash
}
