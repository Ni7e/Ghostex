//! The Rust half of the app runtime port's F2 fixture gate (tooling/app-runtime-port/f2-parity.ts).
//!
//!   cargo run -q --example f2_parity -- <dir>
//!
//! Reads `<dir>/fixtures.json`, answers every case with the gx-core function that replaced the
//! TypeScript one, and writes `<dir>/rust.json` in the same shape the TypeScript half writes
//! `<dir>/typescript.json`. The driver diffs the two. Deleted with the runtime in step 3.

use std::fs;
use std::path::PathBuf;

use ghostex_gx_core::{
    notification_feed_jump_target, notification_feed_state_message, Core, Effect, Event, Intent,
    MachineId, SessionKey,
};
use serde_json::{json, Map, Value};

fn main() {
    let dir = PathBuf::from(std::env::args().nth(1).expect("usage: f2_parity <dir>"));
    let fixtures: Value = serde_json::from_str(
        &fs::read_to_string(dir.join("fixtures.json")).expect("fixtures.json"),
    )
    .expect("fixtures.json is JSON");
    let mut out = Map::new();
    out.insert(
        "notificationFeed".into(),
        notification_feed(&fixtures["notificationFeed"]),
    );
    out.insert("attention".into(), attention(&fixtures["attention"]));
    fs::write(
        dir.join("rust.json"),
        serde_json::to_string_pretty(&Value::Object(out)).expect("serializable"),
    )
    .expect("rust.json");
}

/// Each case: the daemon's answer, and the session a deferral names (or null).
fn notification_feed(cases: &Value) -> Value {
    Value::Array(
        cases
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .map(|case| {
                let message = notification_feed_state_message(&case["result"]);
                let jump = notification_feed_jump_target(&message, case["deferred"].as_str())
                    .map(|item| item["id"].clone())
                    .unwrap_or(Value::Null);
                json!({ "name": case["name"], "message": message, "jump": jump })
            })
            .collect(),
    )
}

/// The attention timeline through one `Core`: frames, acknowledgements, Escape and timer ticks, and
/// after each step what was reported, which sounds played, and every row's shown activity.
fn attention(steps: &Value) -> Value {
    let mut core = Core::new();
    // (due, arm order, session, entered_at)
    let mut timers: Vec<(u64, u64, SessionKey, u64)> = Vec::new();
    let mut armed = 0u64;
    let mut results = Vec::new();
    for step in steps.as_array().map(Vec::as_slice).unwrap_or_default() {
        let now = step["t"].as_u64().unwrap_or_default();
        let mut effects: Vec<Effect> = Vec::new();
        match step["op"].as_str().unwrap_or_default() {
            "frame" => {
                let machine = match step["machine"].as_str() {
                    Some("local") => MachineId::Local,
                    Some(id) => MachineId::Remote(id.to_string()),
                    None => continue,
                };
                let output = core
                    .handle_raw_frame(machine, &step["frame"].to_string(), now)
                    .expect("frame parses");
                effects.extend(output.effects);
            }
            "ack" => {
                let session = SessionKey::parse_sidebar_session_id(
                    step["sessionId"].as_str().unwrap_or_default(),
                )
                .expect("a sidebar session id");
                effects.extend(
                    core.handle(Event::Intent(Intent::AcknowledgeAttention { session }), now)
                        .effects,
                );
            }
            "escape" => {
                let session = SessionKey::local(
                    step["projectId"].as_str().unwrap_or_default(),
                    step["sessionId"].as_str().unwrap_or_default(),
                );
                effects.extend(
                    core.handle(Event::Intent(Intent::TerminalEscape { session }), now)
                        .effects,
                );
            }
            "tick" => {
                timers.sort_by_key(|(due, order, _, _)| (*due, *order));
                let due: Vec<_> = timers
                    .iter()
                    .filter(|timer| timer.0 <= now)
                    .cloned()
                    .collect();
                timers.retain(|timer| timer.0 > now);
                for (_, _, session, entered_at_ms) in due {
                    effects.extend(
                        core.handle(
                            Event::Intent(Intent::AttentionAcknowledgeDue {
                                session,
                                entered_at_ms,
                            }),
                            now,
                        )
                        .effects,
                    );
                }
            }
            _ => {}
        }
        let mut rpcs = Vec::new();
        let mut sounds = Vec::new();
        for effect in effects {
            match effect {
                Effect::ArmAttentionAcknowledge {
                    session,
                    delay_ms,
                    entered_at_ms,
                } => {
                    armed += 1;
                    timers.push((now + delay_ms, armed, session, entered_at_ms));
                }
                Effect::ReportAgentActivity {
                    session,
                    report,
                    agent_name,
                } => {
                    let mut rpc = Map::new();
                    rpc.insert(
                        "machine".into(),
                        Value::from(session.machine.remote_id().unwrap_or("local")),
                    );
                    rpc.insert("path".into(), Value::from("/api/updateAgentActivity"));
                    if let Some(agent_name) = agent_name {
                        rpc.insert("agentName".into(), Value::from(agent_name));
                    }
                    rpc.insert("event".into(), Value::from(report.event()));
                    rpc.insert("projectId".into(), Value::from(session.project_id));
                    rpc.insert("sessionId".into(), Value::from(session.session_id));
                    rpcs.push(Value::Object(rpc));
                }
                Effect::SessionAttentionRaised { session } => {
                    sounds.push(Value::from(session.to_sidebar_session_id()))
                }
                _ => {}
            }
        }
        let mut visible = Map::new();
        for (machine, presentation) in core.presentation().machines() {
            let Some(loaded) = presentation.loaded() else {
                continue;
            };
            for session in loaded.server_sessions() {
                let key = SessionKey {
                    machine: machine.clone(),
                    project_id: session.project_id.clone(),
                    session_id: session.session_id.clone(),
                };
                if let Some(shown) =
                    presentation.effective_session(&session.project_id, &session.session_id)
                {
                    visible.insert(
                        key.to_sidebar_session_id(),
                        serde_json::to_value(&shown.activity).unwrap_or(Value::Null),
                    );
                }
            }
        }
        results.push(json!({ "t": now, "rpcs": rpcs, "sounds": sounds, "visible": visible }));
    }
    Value::Array(results)
}
