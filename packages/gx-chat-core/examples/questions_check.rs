//! Family c's replay gate, until `examples/replay.rs` and `tooling/gx-chat-core/replay-diff.ts`
//! land.
//!
//! Usage: `cargo run --example questions_check -- [recording.jsonl]`
//!
//! Feeds a recording's frames and actions through family c alone and compares the six document
//! keys it owns (`prompt`, `terminalNotice`, `questionCard`, `asyncQuestions`, `noticeVisible`,
//! `noticeError`) with the TypeScript brain's own output in `/tmp/gx-chat/expected/<name>.jsonl`.
//!
//! The wire fold is family a's and is not finished yet, so this carries the smallest fold the six
//! keys need (CLEARED-on-omission for `prompt` and `terminalNotice`, the message list, the status
//! and the working flag). Delete this example once family a's fold and the shared replay harness
//! are in: the real gate is `replay-diff.ts --keys`.
//!
//! Differences are reported as JSON pointers and counts, never as values, because the same
//! example is pointed at real recordings.

use std::collections::BTreeMap;
use std::process::ExitCode;

use ghostex_gx_chat_core::{
    questions, ChatContext, ChatState, Document, Effect, RpcOutcome, UserAction,
};
use ghostex_gx_protocol::ChatStatus;
use serde_json::Value;

/// The keys family c owns.
const KEYS: [&str; 6] = [
    "prompt",
    "terminalNotice",
    "questionCard",
    "asyncQuestions",
    "noticeVisible",
    "noticeError",
];

fn main() -> ExitCode {
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "/tmp/gx-chat/synthetic.jsonl".to_string());
    let name = path
        .rsplit('/')
        .next()
        .unwrap_or("recording.jsonl")
        .to_string();
    let expected_path = format!("/tmp/gx-chat/expected/{name}");
    let Ok(recording) = std::fs::read_to_string(&path) else {
        eprintln!("unreadable recording: {path}");
        return ExitCode::from(2);
    };
    let Ok(expected_text) = std::fs::read_to_string(&expected_path) else {
        eprintln!("unreadable expected output: {expected_path}");
        eprintln!("run `bun tooling/gx-chat-core/replay-typescript.ts {path}` first");
        return ExitCode::from(2);
    };
    let mut expected: BTreeMap<u64, Value> = BTreeMap::new();
    for line in expected_text.lines().filter(|line| !line.trim().is_empty()) {
        let Ok(row) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(n) = row.get("n").and_then(Value::as_u64) else {
            continue;
        };
        expected.insert(n, row);
    }

    // A refusal is part of the recording. The harness answers family c's own calls itself, so the
    // recorded refusals are replayed in order: these scenarios raise no other failing request, and
    // a recording that does would need the request table family a is building.
    let mut world = World::default();
    for line in recording.lines().filter(|line| !line.trim().is_empty()) {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if record.get("m").and_then(Value::as_str) != Some("resolve") {
            continue;
        }
        let Some(error) = record.pointer("/a/2").and_then(Value::as_object) else {
            continue;
        };
        world.refusals.push((
            record.get("n").and_then(Value::as_u64).unwrap_or(0),
            error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        ));
    }
    let mut compared = 0usize;
    let mut matched = 0usize;
    let mut differences: BTreeMap<String, usize> = BTreeMap::new();

    for line in recording.lines().filter(|line| !line.trim().is_empty()) {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            // The recorder writes a record when the next one begins, so the last line of a live
            // recording may be truncated.
            continue;
        };
        if record.get("k").and_then(Value::as_str) == Some("header") {
            continue;
        }
        let n = record.get("n").and_then(Value::as_u64).unwrap_or(0);
        let kind = record.get("k").and_then(Value::as_str).unwrap_or("");
        let method = record.get("m").and_then(Value::as_str).unwrap_or("");
        let now_ms = record.get("ms").and_then(Value::as_f64).unwrap_or(0.0);
        let arguments = record
            .get("a")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        world.record = n;
        world.context = ChatContext::at(now_ms);
        ghostex_gx_chat_core::session::working::stamp_working_started(&mut world.state, now_ms);
        match (kind, method) {
            ("in", "start") => {
                let effects = questions::sync(&mut world.state);
                world
                    .boot
                    .extend(effects.into_iter().map(|effect| (n, effect)));
            }
            ("in", "event") => {
                if let Some(frame) = arguments.first() {
                    apply_frame(&mut world.state, frame);
                }
                let effects = questions::sync(&mut world.state);
                world
                    .queue
                    .extend(effects.into_iter().map(|effect| (n, effect)));
            }
            ("in", "action") => {
                if let Some(action) = arguments
                    .first()
                    .and_then(|value| serde_json::from_value::<UserAction>(value.clone()).ok())
                {
                    let context = world.context;
                    let effects = questions::handle(&mut world.state, &action, &context);
                    world
                        .queue
                        .extend(effects.into_iter().map(|effect| (n, effect)));
                }
            }
            ("in", "tick") => {
                let effects = questions::sync(&mut world.state);
                world
                    .queue
                    .extend(effects.into_iter().map(|effect| (n, effect)));
            }
            ("doc", "take") => {
                let Some(row) = expected.get(&n) else {
                    continue;
                };
                let Some(snapshot) = row.pointer("/document/snapshot").cloned() else {
                    world.settle();
                    continue;
                };
                if snapshot.is_null() {
                    world.settle();
                    continue;
                }
                let mine = world.document();
                for key in KEYS {
                    compared += 1;
                    let mut found = Vec::new();
                    compare(
                        snapshot.get(key),
                        mine.get(key),
                        &mut format!("/snapshot/{key}"),
                        &mut found,
                    );
                    if found.is_empty() {
                        matched += 1;
                    }
                    for pointer in found {
                        *differences.entry(pointer).or_default() += 1;
                    }
                }
                // The host answers a frame's requests after it drains it, so the answers land on
                // the next turn of the loop rather than inside the one that asked.
                world.settle();
            }
            _ => {}
        }
    }

    println!("recording   {path}");
    println!("keys        {}", KEYS.join(", "));
    println!("compared    {compared} key readings, {matched} matched");
    if differences.is_empty() {
        println!("differences 0");
        return ExitCode::SUCCESS;
    }
    println!("differences {}", differences.values().sum::<usize>());
    for (pointer, count) in &differences {
        println!("  {pointer} x{count}");
    }
    ExitCode::FAILURE
}

/// The state family c reads, plus the in-memory client storage its effects use.
#[derive(Default)]
struct World {
    state: ChatState,
    context: ChatContext,
    storage: BTreeMap<(String, String), String>,
    /// Effects raised in the round that has not been answered yet, with the record that raised
    /// them.
    queue: Vec<(u64, Effect)>,
    boot: Vec<(u64, Effect)>,
    /// The refusals the recording carries, by record number, oldest first.
    refusals: Vec<(u64, String)>,
    /// Where the record reader stands, so a refusal is only used once its turn has come.
    record: u64,
}

impl World {
    /// Answers one round of the effects family c raised, the way the host's loop does.
    fn settle(&mut self) {
        {
            let mut next = Vec::new();
            for (queued_at, effect) in std::mem::take(&mut self.queue) {
                match effect {
                    Effect::ReadStorage { key } => {
                        let value = self
                            .storage
                            .get(&(key.store.clone(), key.suffix.clone()))
                            .cloned();
                        questions::storage_loaded(&mut self.state, &key, value.as_deref());
                    }
                    Effect::WriteStorage { key, value, .. } => {
                        let slot = (key.store.clone(), key.suffix.clone());
                        match value {
                            Some(value) => {
                                self.storage.insert(slot, value);
                            }
                            None => {
                                self.storage.remove(&slot);
                            }
                        }
                        if let Some(more) = questions::storage_written(&mut self.state, &key, None)
                        {
                            next.extend(more.into_iter().map(|effect| (self.record, effect)));
                        }
                    }
                    Effect::SendRpc { request_id, .. } => {
                        // The refusal the recording carries for this call: raised after the
                        // request went out, and answered by the record after the document that
                        // shipped it.
                        let refused = self
                            .refusals
                            .first()
                            .is_some_and(|(at, _)| *at > queued_at && *at <= self.record + 1)
                            .then(|| self.refusals.remove(0).1);
                        let outcome = match refused {
                            Some(message) => RpcOutcome::Err {
                                code: None,
                                message,
                                endpoint: None,
                            },
                            None => RpcOutcome::Ok {
                                result: Value::Object(Default::default()),
                            },
                        };
                        if let Some(more) =
                            questions::rpc_settled(&mut self.state, request_id, &outcome)
                        {
                            next.extend(more.into_iter().map(|effect| (self.record, effect)));
                        }
                    }
                    _ => {}
                }
            }
            // The chat's own boot read answers before the strip's does, so what `start` asked for
            // lands one turn of the loop later than what a frame or an action asks for.
            next.append(&mut self.boot);
            self.queue = next;
        }
    }

    /// Family c's part of the document, as JSON.
    fn document(&self) -> Value {
        let mut document = Document::default();
        questions::document(&self.state, &self.context, &mut document);
        serde_json::to_value(&document).unwrap_or(Value::Null)
    }
}

/// The smallest fold the six keys need. Family a owns the real one.
fn apply_frame(state: &mut ChatState, frame: &Value) {
    let frame_type = frame.get("type").and_then(Value::as_str).unwrap_or("");
    if !matches!(
        frame_type,
        "sessionChatSnapshot" | "sessionChatReplaced" | "sessionChatAppended" | "sessionChatState"
    ) {
        return;
    }
    if let Some(Value::Array(messages)) = frame.get("messages") {
        let parsed = messages
            .iter()
            .filter_map(|message| serde_json::from_value(message.clone()).ok())
            .collect::<Vec<_>>();
        if frame_type == "sessionChatAppended" {
            state.messages.list.extend(parsed.clone());
            state.messages.composed.extend(parsed);
        } else {
            state.messages.list.clone_from(&parsed);
            state.messages.composed = parsed;
        }
    }
    // CLEARED on omission: a frame that can carry them and does not means the agent is no longer
    // blocked.
    if frame_type != "sessionChatAppended" {
        state.session.prompt = frame
            .get("prompt")
            .filter(|value| !value.is_null())
            .cloned();
        state.session.terminal_notice = frame
            .get("terminalNotice")
            .filter(|value| !value.is_null())
            .cloned();
    }
    if let Some(status) = frame.get("status").and_then(Value::as_str) {
        state.session.server_status = ChatStatus::from_wire(status);
    }
    state.session.server_working = frame.get("working") == Some(&Value::Bool(true));
    if let Some(Value::Array(ids)) = frame.get("retiredAsyncQuestionIds") {
        state.session.retired_async_question_ids = ids
            .iter()
            .filter_map(|id| id.as_str().map(str::to_string))
            .collect();
    }
}

/// Collects the JSON pointers at which two values differ.
fn compare(
    left: Option<&Value>,
    right: Option<&Value>,
    pointer: &mut String,
    out: &mut Vec<String>,
) {
    match (left, right) {
        (None, None) => {}
        (Some(_), None) | (None, Some(_)) => out.push(pointer.clone()),
        (Some(Value::Object(left)), Some(Value::Object(right))) => {
            let mut keys: Vec<&String> = left.keys().chain(right.keys()).collect();
            keys.sort();
            keys.dedup();
            for key in keys {
                let length = pointer.len();
                pointer.push('/');
                pointer.push_str(&key.replace('~', "~0").replace('/', "~1"));
                compare(left.get(key), right.get(key), pointer, out);
                pointer.truncate(length);
            }
        }
        (Some(Value::Array(left)), Some(Value::Array(right))) => {
            if left.len() != right.len() {
                out.push(format!("{pointer} (length)"));
                return;
            }
            for (index, (left, right)) in left.iter().zip(right).enumerate() {
                let length = pointer.len();
                pointer.push('/');
                pointer.push_str(&index.to_string());
                compare(Some(left), Some(right), pointer, out);
                pointer.truncate(length);
            }
        }
        (Some(left), Some(right)) if left != right => out.push(pointer.clone()),
        _ => {}
    }
}
