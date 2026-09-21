//! Family e1's own replay gate, until `tooling/gx-chat-core/replay-diff.ts` exists.
//!
//! Feeds the synthetic recording's relevant records into family e1's state, assembles family e's
//! document keys for every `doc` record, and diffs them against the document the TypeScript brain
//! produced for that record (`/tmp/gx-chat/expected/<name>.jsonl`).
//!
//! It is deliberately not the whole core: family a's fold, pagination and pending echoes are still
//! being written, so this drives only the session fields e1 reads (`agent`, `sessionAgentId`,
//! `selectedOptions`, `availableAgents`, `switchableAgents`, `accountSwitch`,
//! `pendingModelSelection`, `screenProbed`, `working`) plus the two answers e1 consumes (the
//! composer boot read and the `agentAccounts` reply). Delete it once the real `replay` example and
//! `replay-diff.ts` land.
//!
//! Usage: `cargo run --example e1_check -- [/tmp/gx-chat/synthetic.jsonl]`
//!
//! Recordings are private. This prints counts and JSON pointers only, never a value.

use std::collections::BTreeMap;
use std::path::PathBuf;

use ghostex_gx_chat_core::protocol::Tri;
use ghostex_gx_chat_core::{menus, ChatContext, ChatState, Document, UserAction};
use serde_json::{Map, Value};

/// The top-level document keys family e1 owns.
const KEYS: [&str; 13] = [
    "selectedOptions",
    "availableAgents",
    "switchableAgents",
    "optionLabels",
    "optionMenus",
    "sessionOptions",
    "optionDispatchId",
    "accounts",
    "accountError",
    "accountStatus",
    "accountPanel",
    "accountSwitchCard",
    "accountSwitch",
];

fn main() {
    let recording = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp/gx-chat/synthetic.jsonl"));
    let name = recording
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("synthetic")
        .to_string();
    let expected_path = recording
        .parent()
        .unwrap_or(&PathBuf::from("/tmp/gx-chat"))
        .join("expected")
        .join(format!("{name}.jsonl"));
    let Ok(records) = std::fs::read_to_string(&recording) else {
        eprintln!("no recording at {}", recording.display());
        std::process::exit(2);
    };
    let Ok(expected_text) = std::fs::read_to_string(&expected_path) else {
        eprintln!("no expected run at {}", expected_path.display());
        std::process::exit(2);
    };

    let mut expected: BTreeMap<u64, Value> = BTreeMap::new();
    let mut methods: BTreeMap<u64, (String, String)> = BTreeMap::new();
    for line in expected_text.lines() {
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(number) = entry.get("n").and_then(Value::as_u64) else {
            continue;
        };
        let document = entry.get("document").cloned().unwrap_or(Value::Null);
        if let Some(requests) = document.get("requests").and_then(Value::as_array) {
            for request in requests {
                let Some(id) = request.get("id").and_then(Value::as_u64) else {
                    continue;
                };
                methods.insert(
                    id,
                    (
                        text(request.get("kind")).to_string(),
                        match text(request.get("method")) {
                            "composer" => request
                                .get("params")
                                .and_then(|params| params.get("composer"))
                                .and_then(|composer| composer.get("operation"))
                                .and_then(Value::as_str)
                                .unwrap_or("composer")
                                .to_string(),
                            other => other.to_string(),
                        },
                    ),
                );
            }
        }
        if let Some(snapshot) = document.get("snapshot") {
            if snapshot.is_object() {
                expected.insert(number, snapshot.clone());
            }
        }
    }

    let mut state = ChatState {
        menus: ghostex_gx_chat_core::MenusState::new(),
        ..ChatState::default()
    };
    let mut compared = 0usize;
    let mut matched = 0usize;
    let mut differences: BTreeMap<String, usize> = BTreeMap::new();

    for line in records.lines() {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let kind = text(record.get("k"));
        if kind == "header" {
            continue;
        }
        let number = record.get("n").and_then(Value::as_u64).unwrap_or_default();
        let method = text(record.get("m")).to_string();
        let empty = Vec::new();
        let args = record
            .get("a")
            .and_then(Value::as_array)
            .unwrap_or(&empty)
            .clone();
        let now_ms = record.get("ms").and_then(Value::as_f64).unwrap_or_default();
        let context = ChatContext::at(now_ms);

        match (kind, method.as_str()) {
            ("in", "event") => apply_frame(&mut state, args.first()),
            ("in", "brokerMessage") => apply_broker_message(&mut state, args.first()),
            ("in", "resolve") => {
                let id = args.first().and_then(Value::as_u64).unwrap_or_default();
                let value = args.get(1).cloned().unwrap_or(Value::Null);
                let failed = args.get(2).is_some_and(|error| !error.is_null());
                match methods
                    .get(&id)
                    .map(|(kind, method)| (kind.as_str(), method.as_str()))
                {
                    Some(("broker", "read")) => apply_boot_read(&mut state, &value),
                    Some(("rpc", "agentAccounts")) => {
                        state.menus.accounts_busy = false;
                        if failed {
                            state.menus.account_error = Some("request failed".to_string());
                        } else {
                            state.menus.accounts = Some(value);
                        }
                    }
                    _ => {}
                }
            }
            ("in", "action") => {
                if let Some(action) = user_action(args.first()) {
                    menus::handle(&mut state, &action, &context);
                }
            }
            _ => {}
        }

        menus::observe(&mut state, &context);

        if kind == "doc" {
            let Some(expected_snapshot) = expected.get(&number) else {
                continue;
            };
            let mut document = Document::default();
            menus::document(&state, &context, &mut document);
            let actual = serde_json::to_value(&document).unwrap_or(Value::Null);
            for key in KEYS {
                compared += 1;
                let left = lookup(expected_snapshot, key);
                let right = lookup(&actual, key);
                if left == right {
                    matched += 1;
                } else {
                    for pointer in diff_pointers(&format!("/{key}"), &left, &right) {
                        *differences.entry(pointer).or_default() += 1;
                    }
                }
            }
        }
    }

    println!("recording       {name}");
    println!("documents       {} compared", expected.len());
    println!("keys            {matched}/{compared} matched");
    if differences.is_empty() {
        println!("differences     0");
        return;
    }
    println!("differences     {} pointers", differences.len());
    for (pointer, count) in &differences {
        println!("  {pointer}  x{count}");
    }
    std::process::exit(1);
}

/// A key that may be absent, which is different from present and `null`.
fn lookup(value: &Value, key: &str) -> Tri<Value> {
    match value.get(key) {
        None => Tri::Absent,
        Some(Value::Null) => Tri::Null,
        Some(value) => Tri::Value(value.clone()),
    }
}

/// The pointers at which two values differ, deepest first, so a report names the field rather than
/// the whole subtree.
fn diff_pointers(pointer: &str, left: &Tri<Value>, right: &Tri<Value>) -> Vec<String> {
    match (left, right) {
        (Tri::Value(left), Tri::Value(right)) => diff_values(pointer, left, right),
        _ => vec![pointer.to_string()],
    }
}

fn diff_values(pointer: &str, left: &Value, right: &Value) -> Vec<String> {
    if left == right {
        return Vec::new();
    }
    match (left, right) {
        (Value::Object(left), Value::Object(right)) => {
            let mut pointers = Vec::new();
            let mut keys: Vec<&String> = left.keys().chain(right.keys()).collect();
            keys.sort();
            keys.dedup();
            for key in keys {
                match (left.get(key), right.get(key)) {
                    (Some(left), Some(right)) => {
                        pointers.extend(diff_values(&format!("{pointer}/{key}"), left, right));
                    }
                    _ => pointers.push(format!("{pointer}/{key}")),
                }
            }
            pointers
        }
        (Value::Array(left), Value::Array(right)) if left.len() == right.len() => left
            .iter()
            .zip(right)
            .enumerate()
            .flat_map(|(index, (left, right))| {
                diff_values(&format!("{pointer}/{index}"), left, right)
            })
            .collect(),
        _ => vec![pointer.to_string()],
    }
}

/// The session fields family e1 reads, out of one gxserver frame.
fn apply_frame(state: &mut ChatState, frame: Option<&Value>) {
    let Some(frame) = frame.and_then(Value::as_object) else {
        return;
    };
    let string = |key: &str| frame.get(key).and_then(Value::as_str).map(str::to_string);
    if let Some(agent) = string("agent") {
        state.session.agent = Some(agent);
    }
    if let Some(agent_session_id) = string("sessionAgentId") {
        state.session.session_agent_id = Some(agent_session_id);
    }
    if frame.contains_key("selectedOptions") {
        state.session.selected_options = frame
            .get("selectedOptions")
            .cloned()
            .filter(|value| !value.is_null());
    }
    // Carried by reads alone, and an omission promotes the draft.
    state.session.available_agents = frame
        .get("availableAgents")
        .cloned()
        .filter(|value| !value.is_null());
    if frame.contains_key("switchableAgents") {
        state.session.switchable_agents = frame
            .get("switchableAgents")
            .cloned()
            .filter(|value| !value.is_null());
    }
    if let Some(switch) = frame.get("accountSwitch") {
        state.session.account_switch = if switch.is_null() {
            Tri::Null
        } else {
            Tri::Value(switch.clone())
        };
    }
    if let Some(pending) = frame.get("pendingModelSelection") {
        state.session.pending_model_selection = if pending.is_null() {
            Tri::Null
        } else {
            Tri::Value(pending.clone())
        };
    }
    if frame.get("screenProbed").and_then(Value::as_bool) == Some(true) {
        state.session.screen_probed = true;
    }
    if let Some(working) = frame.get("working").and_then(Value::as_bool) {
        state.session.server_working = working;
    }
}

/// The two broker pushes family e1 reads: the chat settings and the model catalog.
fn apply_broker_message(state: &mut ChatState, message: Option<&Value>) {
    let Some(message) = message.and_then(Value::as_object) else {
        return;
    };
    match message.get("kind").and_then(Value::as_str) {
        Some("chatSettings") => {
            if let Some(settings) = message.get("settings").and_then(Value::as_object) {
                state.core.hide_account_emails =
                    settings.get("hideAccountEmails").and_then(Value::as_bool) == Some(true);
                state.core.title = settings
                    .get("title")
                    .and_then(Value::as_str)
                    .map(str::to_string);
            }
        }
        Some("catalog") => {
            if let Some(parsed) = message
                .get("catalog")
                .and_then(menus::catalog::parse_agent_model_catalog)
            {
                state.menus.model_catalog = parsed;
            }
        }
        _ => {}
    }
}

/// The composer boot read: the storage key, the stored option values and the model catalog.
fn apply_boot_read(state: &mut ChatState, value: &Value) {
    let Some(object) = value.as_object() else {
        return;
    };
    if let Some(session_key) = object.get("sessionKey").and_then(Value::as_str) {
        state.menus.session_key = Some(session_key.to_string());
    }
    if let Some(states) = object.get("optionStates").and_then(Value::as_object) {
        let key = state.menus.session_key.clone().unwrap_or_default();
        state.menus.stored_options = states
            .get(&key)
            .cloned()
            .unwrap_or(Value::Object(Map::new()));
    }
    state.menus.options_seeded = true;
    if let Some(catalog) = object.get("modelCatalog") {
        if let Some(parsed) = menus::catalog::parse_agent_model_catalog(catalog) {
            state.menus.model_catalog = parsed;
        }
    }
    if let Some(settings) = object.get("chatSettings").and_then(Value::as_object) {
        state.core.hide_account_emails =
            settings.get("hideAccountEmails").and_then(Value::as_bool) == Some(true);
        state.core.title = settings
            .get("title")
            .and_then(Value::as_str)
            .map(str::to_string);
    }
}

/// One renderer command, as `UserAction`.
fn user_action(command: Option<&Value>) -> Option<UserAction> {
    let object = command?.as_object()?;
    let kind = object.get("type")?.as_str()?;
    let mut params = object.clone();
    params.remove("type");
    let mut action = UserAction::new(ghostex_gx_chat_core::ActionKind::from_wire(kind));
    action.params = params;
    Some(action)
}

fn text(value: Option<&Value>) -> &str {
    value.and_then(Value::as_str).unwrap_or("")
}
