//! The Rust half of the Quick Access parity gate (tooling/gx-core/quick-access-parity.ts).
//!
//!   cargo run --example quick_access_parity -- <out-dir>
//!
//! Reads every `<out-dir>/scenarios/<name>.json`, drives [`QuickAccessController`] through its
//! steps and writes what it asked the host to do to `<out-dir>/rust/<name>.json`, in the
//! vocabulary the TypeScript half records: `update`, `post`, `openModal`, `copyText`,
//! `schedulePublish` and `scheduleSessions`.

use std::fs;
use std::path::Path;

use ghostex_gx_core::{
    FixedClock, QuickAccessCollection, QuickAccessContext, QuickAccessController, QuickAccessData,
    QuickAccessEffect, QuickAccessHiddenItems, QuickAccessRecoveredDraft, QuickAccessStorage,
};
use serde_json::{json, Value};

/// The storage a scenario seeds: fixed lists, and every write recorded.
struct ScenarioStorage {
    hidden: QuickAccessHiddenItems,
    collections: Vec<QuickAccessCollection>,
    recovered: Vec<QuickAccessRecoveredDraft>,
    sent: Vec<Value>,
    calls: Vec<Value>,
}

impl QuickAccessStorage for ScenarioStorage {
    fn hidden_items(&mut self) -> QuickAccessHiddenItems {
        self.hidden.clone()
    }
    fn project_collections(&mut self) -> Vec<QuickAccessCollection> {
        self.collections.clone()
    }
    fn recovered_drafts(&mut self) -> Vec<QuickAccessRecoveredDraft> {
        self.recovered.clone()
    }
    fn sent_messages(&mut self) -> Vec<Value> {
        self.sent.clone()
    }
    fn delete_sent_message(&mut self, prompt_id: &str) {
        self.calls
            .push(json!({ "storage": "deleteSent", "id": prompt_id }));
        self.sent
            .retain(|message| message["promptId"].as_str() != Some(prompt_id));
    }
    fn dismiss_draft_recovery(&mut self, recovery_id: &str) {
        self.calls
            .push(json!({ "storage": "dismissRecovery", "id": recovery_id }));
    }
    fn delete_stored_draft(&mut self, session_key: &str) {
        self.calls
            .push(json!({ "storage": "deleteDraft", "id": session_key }));
        self.recovered
            .retain(|draft| draft.session_key != session_key);
    }
    fn import_draft_recovery(&mut self, recovery_drafts: &Value) {
        self.calls
            .push(json!({ "storage": "importRecovery", "value": recovery_drafts }));
    }
    fn reconcile_drafts_from_server(&mut self, drafts: &Value) {
        self.calls
            .push(json!({ "storage": "reconcileDrafts", "value": drafts }));
    }
    fn record_delivered_drafts(&mut self, delivered_drafts: &Value) {
        self.calls
            .push(json!({ "storage": "recordDelivered", "value": delivered_drafts }));
    }
}

fn effect_json(effect: &QuickAccessEffect) -> Value {
    match effect {
        QuickAccessEffect::Update(update) => json!({ "update": update.to_json() }),
        QuickAccessEffect::Post(message) => json!({ "post": message }),
        QuickAccessEffect::OpenModal(message) => json!({ "openModal": message }),
        QuickAccessEffect::CopyText(text) => json!({ "copyText": text }),
        QuickAccessEffect::SchedulePublish => json!({ "schedulePublish": true }),
        QuickAccessEffect::ScheduleSessionsRequest { delay_ms, .. } => {
            json!({ "scheduleSessions": delay_ms })
        }
    }
}

/// Replaces `$last:<kind>` with the newest request id of that kind this run posted, the way the
/// TypeScript half does: the ids carry the clock and a counter, so a scenario cannot spell them.
fn resolve_placeholders(
    value: &Value,
    last_ids: &std::collections::BTreeMap<String, String>,
) -> Value {
    match value {
        Value::String(text) => match text.strip_prefix("$last:") {
            Some(kind) => last_ids
                .get(kind)
                .map(|id| Value::String(id.clone()))
                .unwrap_or_else(|| value.clone()),
            None => value.clone(),
        },
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| resolve_placeholders(item, last_ids))
                .collect(),
        ),
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, item)| (key.clone(), resolve_placeholders(item, last_ids)))
                .collect(),
        ),
        _ => value.clone(),
    }
}

/// `<kind>-<digits>-<digits>`: the kind of a request id.
fn request_kind(request_id: &str) -> Option<&str> {
    let (rest, counter) = request_id.rsplit_once('-')?;
    let (kind, clock) = rest.rsplit_once('-')?;
    let digits = |text: &str| !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit());
    (digits(counter) && digits(clock)).then_some(kind)
}

fn run(scenario: &Value) -> Value {
    let data: QuickAccessData =
        serde_json::from_value(scenario["data"].clone()).expect("scenario data");
    let storage_seed = &scenario["storage"];
    let mut storage = ScenarioStorage {
        hidden: serde_json::from_value(storage_seed["hidden"].clone()).unwrap_or_default(),
        collections: serde_json::from_value(storage_seed["collections"].clone())
            .unwrap_or_default(),
        recovered: serde_json::from_value(storage_seed["recovered"].clone()).unwrap_or_default(),
        sent: serde_json::from_value(storage_seed["sent"].clone()).unwrap_or_default(),
        calls: Vec::new(),
    };
    let mut clock = FixedClock {
        now_ms: scenario["clock"]["nowMs"].as_i64().unwrap_or(0),
        utc_offset_ms: scenario["clock"]["offsetMs"].as_i64().unwrap_or(0),
    };
    let mut controller = QuickAccessController::new(clock.now_ms);
    let mut last_token: Option<u64> = None;
    let mut last_ids: std::collections::BTreeMap<String, String> =
        std::collections::BTreeMap::new();
    let mut out: Vec<Value> = Vec::new();
    for step in scenario["steps"].as_array().into_iter().flatten() {
        if let Some(now) = step["now"].as_i64() {
            clock.now_ms = now;
            out.push(json!([]));
            continue;
        }
        let effects = {
            let mut context = QuickAccessContext {
                data: &data,
                storage: &mut storage,
                clock: &clock,
            };
            if let Some(command) = step.get("command") {
                controller.command(&resolve_placeholders(command, &last_ids), &mut context)
            } else if let Some(message) = step.get("receive") {
                controller.receive(&resolve_placeholders(message, &last_ids), &mut context)
            } else if step.get("flush").is_some() {
                controller.flush_publish(&mut context)
            } else if step.get("timer").is_some() {
                match last_token.take() {
                    Some(token) => controller.sessions_timer_fired(token, &mut context),
                    None => Vec::new(),
                }
            } else if step.get("store").is_some() {
                controller.store_changed()
            } else {
                Vec::new()
            }
        };
        for effect in &effects {
            match effect {
                QuickAccessEffect::ScheduleSessionsRequest { token, .. } => {
                    last_token = Some(*token)
                }
                QuickAccessEffect::Post(message) => {
                    if let Some(request_id) = message["requestId"].as_str() {
                        if let Some(kind) = request_kind(request_id) {
                            last_ids.insert(kind.to_string(), request_id.to_string());
                        }
                    }
                }
                _ => {}
            }
        }
        // The storage writes are not compared: the TypeScript half performs them on real client
        // storage, and what they change shows up in the next snapshot of both halves.
        storage.calls.clear();
        out.push(Value::Array(effects.iter().map(effect_json).collect()));
    }
    Value::Array(out)
}

fn main() {
    let out_dir = std::env::args()
        .nth(1)
        .expect("usage: quick_access_parity <out-dir>");
    let scenarios = Path::new(&out_dir).join("scenarios");
    let rust_dir = Path::new(&out_dir).join("rust");
    fs::create_dir_all(&rust_dir).expect("rust dir");
    let mut names: Vec<_> = fs::read_dir(&scenarios)
        .expect("scenarios dir")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    names.sort();
    for path in names {
        let scenario: Value =
            serde_json::from_str(&fs::read_to_string(&path).expect("read scenario")).expect("json");
        let result = run(&scenario);
        let name = path.file_name().expect("name");
        fs::write(
            rust_dir.join(name),
            serde_json::to_string_pretty(&result).expect("serialize"),
        )
        .expect("write");
    }
}
