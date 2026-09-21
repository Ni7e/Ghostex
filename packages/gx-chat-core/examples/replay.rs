//! Replays a recording through the Rust core and writes one document per line.
//!
//! ```text
//! cargo run --release --example replay -- /tmp/gx-chat/synthetic.jsonl
//! ```
//!
//! The format, the fingerprint and the output shape are `docs/2026-09-21/rust-chat/REPLAY.md`.
//! Recordings are the user's conversation: this example reads them from `/tmp/gx-chat/` and writes
//! to `/tmp/gx-chat/actual/`, and prints counts only, never content.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use ghostex_gx_chat_core::protocol::{ChatAppendedFrame, ChatSnapshotFrame, ChatStateFrame};
use ghostex_gx_chat_core::{
    ChatContext, ChatCore, ChatFrame, ChatSettings, ConnectionUpdate, Event, RpcOutcome,
    StartConfig, UserAction,
};
use serde_json::{Map, Value};

fn main() {
    let mut inputs: Vec<PathBuf> = std::env::args().skip(1).map(PathBuf::from).collect();
    if inputs.is_empty() {
        inputs.push(PathBuf::from("/tmp/gx-chat/synthetic.jsonl"));
    }
    let mut failures = 0;
    for input in inputs {
        match replay(&input) {
            Ok(report) => println!("{report}"),
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
    refused: usize,
    output: PathBuf,
}

impl std::fmt::Display for Report {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "recording       {} ({} records)\nreplayed        {} inputs, {} documents\nrefused         {} inputs\nactual          {}",
            self.name,
            self.records,
            self.inputs,
            self.documents,
            self.refused,
            self.output.display()
        )
    }
}

fn replay(input: &Path) -> Result<Report, String> {
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
    let mut last_revision = 0u64;
    let mut records = 0usize;
    let mut inputs = 0usize;
    let mut documents = 0usize;
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
        let mut context =
            ChatContext::at(record.get("ms").and_then(Value::as_f64).unwrap_or(0.0));
        if let Some(draws) = record.get("r").and_then(Value::as_array) {
            for (slot, draw) in draws.iter().take(context.random_units.len()).enumerate() {
                context.random_units[slot] = draw.as_f64().unwrap_or(0.0);
            }
        }

        match kind {
            "in" => {
                inputs += 1;
                let mut applied = false;
                for event in events_for(method, &args) {
                    core.handle(event, context);
                    applied = true;
                }
                if !applied {
                    refused += 1;
                }
            }
            "doc" => {
                // The recorded `a[0]` is the TypeScript host's own revision counter, and the two
                // brains do not publish the same number of times, so replaying it literally would
                // ask for a revision this core never had and ship the document every time. What
                // the comparison needs is the same QUESTION on both sides, "what changed since my
                // last drain", so the host's last drain is simulated here instead. The recorded
                // value still rides in the output line.
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
            // Pure helpers the renderer asks for one gesture. They belong to the families that own
            // the composer and the transcript menus, so this build has nothing to answer with yet.
            _ => {}
        }
    }

    Ok(Report {
        name,
        records,
        inputs,
        documents,
        refused,
        output,
    })
}

/// Maps one recorded call to the events the Rust core takes.
///
/// The TypeScript entry points are one function each; the Rust core has one enum, so a
/// `brokerMessage` fans out by its own `kind`.
fn events_for(method: &str, args: &[Value]) -> Vec<Event> {
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
        "resolve" => {
            let request_id = args.first().and_then(Value::as_u64).unwrap_or_default();
            let error = args.get(2).filter(|value| !value.is_null());
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
                None => RpcOutcome::Ok {
                    result: args.get(1).cloned().unwrap_or(Value::Null),
                },
            };
            vec![Event::RpcSettled {
                request_id,
                outcome: Box::new(outcome),
            }]
        }
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
