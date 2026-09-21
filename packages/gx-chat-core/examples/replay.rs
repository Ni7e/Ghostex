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
//! This is a HOST, not just a driver. The core performs no I/O, so a replay that drops its effects
//! grades a brain that never heard back from anything: the async question strip stays `loading`
//! forever, the accounts never arrive, and every surface fed by a read is empty. So:
//!
//!  * **gxserver calls** are answered from the recording's own `resolve` records, oldest request
//!    first. The recorded id is the TypeScript's, from a counter it shares with its timers, so it
//!    cannot be mapped onto the core's; what the two brains do share is the ORDER they ask in, and
//!    that is what this matches on. A recorded answer with no request waiting for it, or a request
//!    the recording never answers, is counted and reported.
//!  * **Client storage** is an in-memory map, answered one record later, which is where the
//!    TypeScript's own storage answers land (its writes go out over the broker and come back as a
//!    `resolve` on a later record).
//!  * **The composer boot read** is one request in both brains, so it takes the first recorded
//!    answer the same way.
//!
//! `requests` is deliberately NOT part of the comparison. It is the QuickJS bridge's wire form,
//! not the core's: storage rides on it there (`composer('read')`, `composer('questionWrite')`) and
//! is an [`Effect`] here, and its ids come off a counter the TypeScript shares with its timers.
//! The Rust host consumes `Vec<Effect>` and builds no `requests` array at all.

use std::collections::{BTreeMap, VecDeque};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use ghostex_gx_chat_core::composer::keys::ComposerKeyEvent;
use ghostex_gx_chat_core::composer::queries::{
    composer_key_intent, composer_references, reference_menu, send_blocked_toast, transcript_menu,
};
use ghostex_gx_chat_core::protocol::{ChatAppendedFrame, ChatSnapshotFrame, ChatStateFrame};
use ghostex_gx_chat_core::{
    ChatContext, ChatCore, ChatFrame, ChatRpcMethod, ChatSettings, ComposerBootRead,
    ConnectionUpdate, Effect, Event, RpcOutcome, StartConfig, StorageKey, UserAction,
};
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

/// One request the core made and the recording has still to answer.
struct Outstanding {
    request_id: u64,
    /// `None` for the boot read, which answers with a [`ComposerBootRead`] rather than an
    /// [`RpcOutcome`].
    method: Option<ChatRpcMethod>,
}

/// The gxserver method a recorded answer's SHAPE identifies, when it identifies one.
///
/// The recording carries no method beside its `resolve`, so the reads whose payload names itself
/// are recognised and the rest fall back to "the oldest request that is not one of those". Without
/// this, a `composer(...)` write answering `true` (the TypeScript's storage goes over the broker;
/// the core's is an [`Effect`], so nothing here is waiting for it) would be handed to whichever
/// gxserver call happened to be in flight.
fn identified(result: &Value) -> Option<ChatRpcMethod> {
    let object = result.as_object()?;
    if object.contains_key("messages") {
        return Some(ChatRpcMethod::ReadSessionChat);
    }
    if object.contains_key("skills") {
        return Some(ChatRpcMethod::ReadSessionChatSkills);
    }
    if object.contains_key("files") {
        return Some(ChatRpcMethod::ReadSessionChatFiles);
    }
    if object.contains_key("branches") {
        return Some(ChatRpcMethod::SessionForkBranches);
    }
    if object.contains_key("accounts") {
        return Some(ChatRpcMethod::AgentAccounts);
    }
    None
}

/// Whether a request's answer would have been recognised by [`identified`].
fn self_naming(method: &ChatRpcMethod) -> bool {
    matches!(
        method,
        ChatRpcMethod::ReadSessionChat
            | ChatRpcMethod::ReadSessionChatSkills
            | ChatRpcMethod::ReadSessionChatFiles
            | ChatRpcMethod::SessionForkBranches
            | ChatRpcMethod::AgentAccounts
    )
}

/// The host half of the replay: client storage, the outstanding-request queue and the effect loop.
#[derive(Default)]
struct World {
    storage: BTreeMap<(String, String), String>,
    outstanding: VecDeque<Outstanding>,
    /// Storage answers the core is waiting for, oldest first.
    ///
    /// They are delivered on the recorded `resolve` records that answer NOTHING the core asked
    /// for, because those records ARE the TypeScript's storage answers: its client storage rides
    /// on the broker (`composer('summary')`, `composer('questionWrite')`, …) where the core's is
    /// an [`Effect`]. Delivering them there rather than immediately is what puts a
    /// `summaryMode = await composer('summary', …)` on the same turn in both brains.
    storage_answers: VecDeque<Event>,
    unanswered: usize,
    unmatched_answers: usize,
}

impl World {
    /// Performs one round of effects, queueing the answers the core will hear next record.
    fn perform(&mut self, effects: Vec<Effect>) {
        for effect in effects {
            match effect {
                Effect::SendRpc {
                    request_id, method, ..
                } => self.outstanding.push_back(Outstanding {
                    request_id,
                    method: Some(method),
                }),
                Effect::ReadComposerBoot { request_id } => {
                    self.outstanding.push_back(Outstanding {
                        request_id,
                        method: None,
                    })
                }
                Effect::ReadStorage { key } => {
                    let value = self.storage.get(&slot(&key)).cloned();
                    self.storage_answers
                        .push_back(Event::StorageLoaded { key, value });
                }
                Effect::WriteStorage { key, value, .. } => {
                    match value {
                        Some(value) => {
                            self.storage.insert(slot(&key), value);
                        }
                        None => {
                            self.storage.remove(&slot(&key));
                        }
                    }
                    self.storage_answers
                        .push_back(Event::StorageWritten { key, error: None });
                }
                _ => {}
            }
        }
    }

    /// Turns one recorded `resolve` into the event the core is waiting for.
    ///
    /// Oldest request first: the recorded id belongs to the other brain's counter, but both brains
    /// ask in the same order, and a divergence there is exactly what the report counts.
    fn answer(&mut self, arguments: &[Value]) -> Option<Event> {
        let result = arguments.get(1).cloned().unwrap_or(Value::Null);
        let error = arguments.get(2).filter(|value| !value.is_null());
        let boot = result.get("sessionKey").is_some() && result.get("clientId").is_some();
        let named = identified(&result);
        let at =
            self.outstanding
                .iter()
                .position(|pending| match (&pending.method, boot, &named) {
                    (None, true, _) => true,
                    (None, false, _) => false,
                    (Some(_), true, _) => false,
                    (Some(method), false, Some(named)) => method == named,
                    (Some(method), false, None) => !self_naming(method),
                });
        let Some(at) = at else {
            // Not an answer to anything the core asked for: it is the TypeScript's own storage
            // round trip, and the core has a storage answer of its own waiting for this turn.
            if let Some(event) = self.storage_answers.pop_front() {
                return Some(event);
            }
            self.unmatched_answers += 1;
            return None;
        };
        let pending = self.outstanding.remove(at)?;
        if pending.method.is_none() {
            if error.is_some() {
                return None;
            }
            return serde_json::from_value::<ComposerBootRead>(result)
                .ok()
                .map(|read| Event::ComposerBootRead(Box::new(read)));
        }
        let outcome = match error {
            Some(error) => RpcOutcome::Err {
                code: error
                    .get("code")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                message: error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Request failed.")
                    .to_string(),
                endpoint: None,
            },
            None => RpcOutcome::Ok { result },
        };
        Some(Event::RpcSettled {
            request_id: pending.request_id,
            outcome: Box::new(outcome),
        })
    }
}

fn slot(key: &StorageKey) -> (String, String) {
    (key.store.clone(), key.suffix.clone())
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
    let mut world = World::default();
    let mut last_revision = 0u64;
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

        match kind {
            "in" => {
                inputs += 1;
                let mut applied = false;
                for event in events_for(method, &args, &mut world) {
                    let effects = core.handle(event, context);
                    world.perform(effects);
                    applied = true;
                }
                if !applied {
                    refused += 1;
                }
            }
            "query" => {
                queries += 1;
                let recorded = record.get("hash").and_then(Value::as_str);
                let answer = query(core.state(), context, method, &args);
                match (answer, recorded) {
                    (Some(answer), Some(recorded)) if fingerprint(&answer) == recorded => {}
                    (_, None) => {}
                    _ => queries_differed += 1,
                }
            }
            "doc" => {
                // The recorded `a[0]` is the TypeScript host's own revision counter. Both counters
                // start at zero and count publishes, so they agree once the two brains publish on
                // the same turns; what the comparison needs is the same QUESTION on both sides,
                // "what changed since my last drain", so the host's last drain is simulated here.
                // The recorded value still rides in the output line.
                let requested = args.first().and_then(Value::as_u64);
                let frame = core.frame(last_revision);
                last_revision = frame.revision;
                let document = serde_json::to_value(&frame).map_err(|error| error.to_string())?;
                let serialized =
                    serde_json::to_string(&document).map_err(|error| error.to_string())?;
                let mut out = Map::new();
                out.insert(
                    "n".to_string(),
                    record.get("n").cloned().unwrap_or(Value::Null),
                );
                out.insert(
                    "lastRevision".to_string(),
                    requested.map(Value::from).unwrap_or(Value::Null),
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
    while let Some(event) = world.storage_answers.pop_front() {
        let effects = core.handle(event, ChatContext::at(0.0));
        world.perform(effects);
    }
    let unanswered = world.outstanding.len() + world.unanswered;
    Ok(Report {
        name,
        records,
        inputs,
        documents,
        queries,
        queries_differed,
        refused,
        unanswered,
        unmatched_answers: world.unmatched_answers,
        output,
    })
}

/// One of the five pure helpers the renderer asks for a single gesture.
///
/// Serialized straight from the typed answer, never through a `serde_json::Value`: the fingerprint
/// is over `JSON.stringify`'s bytes, and a detour through a `Value` would re-order the keys.
fn query(
    state: &ghostex_gx_chat_core::ChatState,
    context: ChatContext,
    method: &str,
    args: &[Value],
) -> Option<String> {
    let first = args.first();
    Some(match method {
        "composerReferences" => to_json(&composer_references(first.and_then(Value::as_str)?)),
        "composerKeyIntent" => {
            let event: ComposerKeyEvent = serde_json::from_value(first?.clone()).ok()?;
            let platform = args.get(1).and_then(Value::as_str);
            to_json(&composer_key_intent(&event, platform))
        }
        "referenceMenu" => to_json(&reference_menu(first.and_then(Value::as_str)?)),
        "transcriptMenu" => {
            let request = first?;
            let href = request.get("href").and_then(Value::as_str);
            let selection = request
                .get("selection")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let question_active = request.get("questionActive") == Some(&Value::Bool(true));
            to_json(&transcript_menu(href, selection, question_active))
        }
        "sendBlockedToast" => {
            let reason = match first.and_then(Value::as_str) {
                Some(reason) => reason.to_string(),
                None => ghostex_gx_chat_core::composer::document::send_blocked(state, &context)?,
            };
            to_json(&send_blocked_toast(&reason))
        }
        _ => return None,
    })
}

fn to_json<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
}

/// Maps one recorded call to the events the Rust core takes.
///
/// The TypeScript entry points are one function each; the Rust core has one enum, so a
/// `brokerMessage` fans out by its own `kind`.
fn events_for(method: &str, args: &[Value], world: &mut World) -> Vec<Event> {
    match method {
        "start" => args
            .first()
            .and_then(|value| serde_json::from_value::<StartConfig>(value.clone()).ok())
            .map(|config| vec![Event::Start(Box::new(config))])
            .unwrap_or_default(),
        "action" => args
            .first()
            .and_then(|value| serde_json::from_value::<UserAction>(value.clone()).ok())
            .map(|action| vec![Event::Action(Box::new(action))])
            .unwrap_or_default(),
        "tick" => vec![Event::Tick],
        "event" => chat_frame(args.first()),
        "resolve" => world.answer(args).into_iter().collect(),
        "brokerMessage" => broker_events(args.first()),
        _ => Vec::new(),
    }
}

fn broker_events(message: Option<&Value>) -> Vec<Event> {
    let Some(message) = message else {
        return Vec::new();
    };
    match message.get("kind").and_then(Value::as_str) {
        Some("event") => chat_frame(message.get("event").or_else(|| message.get("payload"))),
        Some("chatSettings") => message
            .get("settings")
            .or_else(|| message.get("payload"))
            .and_then(|value| serde_json::from_value::<ChatSettings>(value.clone()).ok())
            .map(|settings| vec![Event::SettingsChanged(Box::new(settings))])
            .unwrap_or_default(),
        Some("contextPreferences") => vec![Event::ContextPreferencesChanged {
            provider: message
                .get("provider")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            preferences: message.get("preferences").cloned().unwrap_or(Value::Null),
        }],
        Some("catalog") => vec![Event::ModelCatalogChanged {
            catalog: message.get("catalog").cloned().unwrap_or(Value::Null),
        }],
        Some("reset") => vec![Event::Connection(ConnectionUpdate::Resubscribed)],
        _ => Vec::new(),
    }
}

fn chat_frame(value: Option<&Value>) -> Vec<Event> {
    let Some(value) = value else {
        return Vec::new();
    };
    let frame = match value.get("type").and_then(Value::as_str) {
        Some("sessionChatSnapshot") => serde_json::from_value::<ChatSnapshotFrame>(value.clone())
            .ok()
            .map(|frame| ChatFrame::Snapshot(Box::new(frame))),
        Some("sessionChatReplaced") => serde_json::from_value::<ChatSnapshotFrame>(value.clone())
            .ok()
            .map(|frame| ChatFrame::Replaced(Box::new(frame))),
        Some("sessionChatAppended") => serde_json::from_value::<ChatAppendedFrame>(value.clone())
            .ok()
            .map(|frame| ChatFrame::Appended(Box::new(frame))),
        Some("sessionChatState") => serde_json::from_value::<ChatStateFrame>(value.clone())
            .ok()
            .map(|frame| ChatFrame::State(Box::new(frame))),
        _ => None,
    };
    frame
        .map(|frame| vec![Event::Frame(Box::new(frame))])
        .unwrap_or_default()
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

fn fnv(text: &str, seed: u32) -> u32 {
    let mut hash = seed;
    for unit in text.encode_utf16() {
        hash = (hash ^ u32::from(unit & 0xff)).wrapping_mul(0x0100_0193);
        hash = (hash ^ u32::from(unit >> 8)).wrapping_mul(0x0100_0193);
    }
    hash
}
