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
//! A recording holds one RUN per header line: the app starts a fresh QuickJS context every time it
//! creates a chat runtime for the session, so each header is a fresh brain with its own state and
//! its own record counter. Every run is replayed into a fresh [`ChatCore`] and [`BridgeTranslator`]
//! here, the output lines carry the run they belong to, and the report sums the runs.
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
    /// Header lines with at least one record after them, each replayed into a fresh core.
    runs: usize,
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
    /// Requests the core made after the last answer its run carries. No record could have
    /// answered them: the live brain's own answer arrived after the app closed the recording.
    in_flight_at_close: usize,
    output: PathBuf,
}

impl std::fmt::Display for Report {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "recording       {} ({} runs, {} records)\nreplayed        {} inputs, {} queries, {} documents\nqueries         {}/{} fingerprints matched\nrequests        {} unanswered, {} answers with no request, {} in flight at close\nrefused         {} inputs\nactual          {}",
            self.name,
            self.runs,
            self.records,
            self.inputs,
            self.queries,
            self.documents,
            self.queries - self.queries_differed,
            self.queries,
            self.unanswered,
            self.unmatched_answers,
            self.in_flight_at_close,
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
    // `GX_CHAT_ACTUAL_DIR` moves the output, so an agent iterating on the core does not share
    // (and race) the one directory every gate run rewrites.
    let directory = std::env::var_os("GX_CHAT_ACTUAL_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp/gx-chat/actual"));
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
    let mut unanswered = 0usize;
    let mut unmatched_answers = 0usize;
    let mut in_flight_at_close = 0usize;
    // How many requests were outstanding just after the run's latest answer-bearing record.
    let mut outstanding_at_last_answer = 0usize;
    // The run the next record belongs to. A header opens a run; the run counts once a record
    // follows it, so a header the app wrote just before closing is skipped rather than graded.
    let mut run = 0usize;
    let mut runs = 0usize;
    let mut run_has_records = false;
    let mut refusals = Refusals::default();
    let log_refusals = std::env::var("GX_CHAT_REFUSALS").is_ok();
    let log_rpc = std::env::var("GX_CHAT_RPC").is_ok();

    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            // The last line of a live recording may be truncated, which is normal.
            continue;
        };
        if record.get("k").and_then(Value::as_str) == Some("header") {
            let version = record.get("v").and_then(Value::as_u64).unwrap_or(0);
            if version != 1 {
                return Err(format!("unknown recording format {version}"));
            }
            if run_has_records {
                finish_run(
                    &mut core,
                    &mut translator,
                    outstanding_at_last_answer,
                    &mut unanswered,
                    &mut unmatched_answers,
                    &mut in_flight_at_close,
                );
                outstanding_at_last_answer = 0;
                core = ChatCore::new();
                translator = BridgeTranslator::new();
            }
            run += 1;
            run_has_records = false;
            continue;
        }
        if run == 0 {
            return Err("the recording does not start with a header line".to_string());
        }
        if !run_has_records {
            run_has_records = true;
            runs += 1;
        }
        records += 1;
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
        // The record's `ms` is the RECORDER's clock read just before the call; `c[0]` is the
        // brain's own first read inside it, which is the value every rule in that call used
        // (`tick` fires timers against it, `useState(Date.now)` latches it). They differ by a
        // millisecond about two percent of the time, and that millisecond is the whole of the
        // `accountStatus.now` difference on a real recording, so the brain's read is the event's
        // clock when the record carries one.
        let recorded_ms = record.get("ms").and_then(Value::as_f64).unwrap_or(0.0);
        let first_read_ms = record
            .get("c")
            .and_then(Value::as_array)
            .and_then(|reads| reads.first())
            .and_then(Value::as_f64);
        let mut context = ChatContext::at(first_read_ms.unwrap_or(recorded_ms));
        context.utc_offset_minutes = utc_offset_minutes;
        // The whole `c` queue, so a rule that latches a LATER read of the call (the watchdog's
        // `now`, a `setNow` inside an interval) takes the one the brain took.
        context.clock_reads = record
            .get("c")
            .and_then(Value::as_array)
            .map(|reads| reads.iter().filter_map(Value::as_f64).collect())
            .unwrap_or_default();
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
                refusals.note(method, &args, "unparsed");
            }
            continue;
        };
        let before_queue = translator.queued_storage_answers();
        let outcome = translator.feed(&mut core, call, context);
        if method == "resolve" || method == "brokerMessage" {
            outstanding_at_last_answer = translator.unanswered();
        }
        // `GX_CHAT_RPC=1` names every gxserver call the core makes, by run, record and METHOD, so
        // the two brains' request sequences can be lined up against the `requests` the expected
        // file carries. Method names only.
        if log_rpc {
            let number = record.get("n").and_then(Value::as_u64).unwrap_or_default();
            for effect in &outcome.effects {
                match effect {
                    ghostex_gx_chat_core::Effect::SendRpc { method, params, .. } => {
                        let keys: Vec<&str> = params
                            .as_object()
                            .map(|object| object.keys().map(String::as_str).collect())
                            .unwrap_or_default();
                        // For a chat read, the lane that issued it (seed, resync, page).
                        let lane = core
                            .state()
                            .messages
                            .reads
                            .last()
                            .map(|read| format!(" lane={:?}", read.kind))
                            .filter(|_| method.as_str() == "readSessionChat")
                            .unwrap_or_default();
                        eprintln!(
                            "rpc run={run} n={number} method={} params={{{}}}{lane}",
                            method.as_str(),
                            keys.join(",")
                        );
                    }
                    ghostex_gx_chat_core::Effect::ReadComposerBoot { .. } => {
                        eprintln!("rpc run={run} n={number} method=composerBoot");
                    }
                    _ => {}
                }
            }
        }
        if std::env::var("GX_CHAT_STORAGE").is_ok() {
            let number = record.get("n").and_then(Value::as_u64).unwrap_or_default();
            let stores: Vec<String> = outcome
                .effects
                .iter()
                .filter_map(|effect| match effect {
                    ghostex_gx_chat_core::Effect::WriteStorage { key, .. } => {
                        Some(format!("w:{}", key.store))
                    }
                    ghostex_gx_chat_core::Effect::ReadStorage { key } => {
                        Some(format!("r:{}", key.store))
                    }
                    ghostex_gx_chat_core::Effect::FlushStorage { store } => {
                        Some(format!("f:{store}"))
                    }
                    _ => None,
                })
                .collect();
            let after = translator.queued_storage_answers();
            if !stores.is_empty() || after != before_queue {
                eprintln!(
                    "run={run} n={number} m={method} raised=[{}] queue {before_queue}->{after}",
                    stores.join(",")
                );
            }
        }
        match kind {
            "in" => {
                inputs += 1;
                if outcome.applied == 0 {
                    // `GX_CHAT_REFUSALS=1` names the records this build did not model, by number
                    // and by kind. A refusal is where the two brains stop being comparable, so
                    // finding the first one is the first thing to do when a recording's count
                    // drops; the record's arguments are never printed.
                    if log_refusals {
                        let number = record.get("n").and_then(Value::as_u64).unwrap_or_default();
                        eprintln!(
                            "refused run={run} n={number} method={method} {}",
                            refusal_shape(&args)
                        );
                    }
                    refusals.note(method, &args, "unmodelled");
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
                out.insert("run".to_string(), Value::from(run));
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

    if run_has_records {
        finish_run(
            &mut core,
            &mut translator,
            outstanding_at_last_answer,
            &mut unanswered,
            &mut unmatched_answers,
            &mut in_flight_at_close,
        );
    }
    if log_refusals {
        refusals.print();
    }
    Ok(Report {
        name,
        runs,
        records,
        inputs,
        documents,
        queries,
        queries_differed,
        refused,
        unanswered,
        unmatched_answers,
        in_flight_at_close,
        output,
    })
}

/// Closes one run: delivers the storage answers it ran out of `resolve` records for, so a surface
/// that reads one is not left loading in its last documents, and adds its request counts to the
/// recording's.
///
/// A request still open at the end that was issued AFTER the run's last answer-bearing record
/// (`outstanding_at_last_answer` is the count just after that record) is in flight at close, not
/// unanswered: the recording stops one record short of the app closing, so a poll that fires in
/// the last seconds of a run is open on both brains and nothing in the file could answer it.
fn finish_run(
    core: &mut ChatCore,
    translator: &mut BridgeTranslator,
    outstanding_at_last_answer: usize,
    unanswered: &mut usize,
    unmatched_answers: &mut usize,
    in_flight_at_close: &mut usize,
) {
    translator.flush_storage(core, ChatContext::at(0.0));
    // `GX_CHAT_REQUESTS=1` names the METHOD of every request the bridge never answered, oldest
    // first. One of those is also what makes a later `resolve` land on the wrong record, because
    // an answer that names nothing goes to the oldest request that could have produced it. Method
    // names only: a request's parameters are the user's conversation.
    if std::env::var("GX_CHAT_REQUESTS").is_ok() {
        for method in translator.outstanding_methods() {
            eprintln!("unanswered method={method}");
        }
        eprintln!(
            "storage answers still queued: {}",
            translator.queued_storage_answers()
        );
    }
    let open = translator.unanswered();
    let late = open.saturating_sub(outstanding_at_last_answer);
    *unanswered += open - late;
    *in_flight_at_close += late;
    *unmatched_answers += translator.unmatched_answers();
}

/// The refusals of one replay, counted by the shape of the call rather than by record, so the
/// summary names every bridge call this build cannot model and how often it arrives.
#[derive(Default)]
struct Refusals {
    counts: std::collections::BTreeMap<String, usize>,
}

impl Refusals {
    fn note(&mut self, method: &str, args: &[Value], why: &str) {
        let key = format!("{why} method={method} {}", refusal_shape(args));
        *self.counts.entry(key).or_default() += 1;
    }

    fn print(&self) {
        for (shape, count) in &self.counts {
            eprintln!("refusals x{count}: {shape}");
        }
    }
}

/// The SHAPE of a refused call: the first argument's discriminator and its sorted key set.
///
/// Never a value. The discriminator (`type` or `kind`) is one of the wire's own spellings, and a
/// key set names fields, so the line identifies the arm to write without carrying the
/// conversation. A nested `event` or `result` object is described the same way, one level down,
/// because the broker wraps the frame the core actually needs.
fn refusal_shape(args: &[Value]) -> String {
    fn describe(value: &Value) -> String {
        match value {
            Value::Object(object) => {
                let discriminator = object
                    .get("type")
                    .or_else(|| object.get("kind"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let keys: Vec<&str> = object.keys().map(String::as_str).collect();
                format!("{discriminator}{{{}}}", keys.join(","))
            }
            Value::Array(items) => format!("array[{}]", items.len()),
            Value::String(_) => "string".to_string(),
            Value::Number(_) => "number".to_string(),
            Value::Bool(_) => "bool".to_string(),
            Value::Null => "null".to_string(),
        }
    }
    // A `resolve` carries `(requestId, value, error)`: the value is the shape that matters.
    let described = if args.len() >= 2 && args[0].is_number() {
        args.get(1)
    } else {
        args.first()
    };
    let Some(first) = described else {
        return "no arguments".to_string();
    };
    let mut shape = describe(first);
    for nested in ["event", "result", "payload"] {
        if let Some(inner) = first.get(nested) {
            shape.push_str(&format!(" {nested}={}", describe(inner)));
        }
    }
    shape
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
