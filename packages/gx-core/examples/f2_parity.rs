//! The Rust half of the app runtime port's F2 fixture gate (tooling/app-runtime-port/f2-parity.ts).
//!
//!   cargo run -q --example f2_parity -- <dir>
//!
//! Reads `<dir>/fixtures.json`, answers every case with the gx-core function that replaced the
//! TypeScript one, and writes `<dir>/rust.json` in the same shape the TypeScript half writes
//! `<dir>/typescript.json`. The driver diffs the two. Deleted with the runtime in step 3.

use std::fs;
use std::path::PathBuf;

use ghostex_gx_core::hud::{compose_sidebar_hud, HudSources};
use ghostex_gx_core::indicators::{
    indicator_candidates, neutral_indicator_inputs, pet_overlay_payload, status_indicators_payload,
};
use ghostex_gx_core::{
    notification_feed_jump_target, notification_feed_state_message, Core, Effect, Event, Intent,
    MachineId, SessionKey,
};
use ghostex_gx_core::{
    MachineTabInput, SessionSortMode, SidebarInputs, SidebarSettings, SidebarViewModel,
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
    out.insert("hud".into(), hud(&fixtures["hud"]));
    out.insert("indicators".into(), indicators(&fixtures["indicators"]));
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

/// Each case: the same presentations, reads and settings the TypeScript half builds its HUD from.
fn hud(cases: &Value) -> Value {
    Value::Array(
        cases
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .map(|case| {
                let mut core = Core::new();
                core.handle_raw_frame(MachineId::Local, &case["local"].to_string(), 1)
                    .expect("local frame");
                core.handle(
                    Event::DomainProjectsRead {
                        machine: MachineId::Local,
                        projects: case["domainProjects"]
                            .as_array()
                            .cloned()
                            .unwrap_or_default(),
                    },
                    1,
                );
                core.handle_raw_frame(
                    MachineId::Remote("remote-m1".to_string()),
                    &case["remote"].to_string(),
                    1,
                )
                .expect("remote frame");
                let sources = HudSources {
                    settings: case["settings"].clone(),
                    debugging_mode: case["debuggingMode"] == true,
                    show_beta_features: case["showBetaFeatures"] == true,
                    sidebar_hud: case.get("sidebarHud").filter(|hud| !hud.is_null()).cloned(),
                    remote_sidebar_huds: case
                        .get("remoteHud")
                        .filter(|hud| !hud.is_null())
                        .map(|hud| {
                            [("remote-m1".to_string(), hud.clone())]
                                .into_iter()
                                .collect()
                        })
                        .unwrap_or_default(),
                    recent_projects: case["recentProjects"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default(),
                    remote_recent_projects: case["remoteRecents"]
                        .as_array()
                        .map(Vec::as_slice)
                        .unwrap_or_default()
                        .iter()
                        .filter_map(|entry| {
                            Some((
                                entry.get(0)?.as_str()?.to_string(),
                                entry.get(1)?.as_array()?.clone(),
                            ))
                        })
                        .collect(),
                    active_project_id: case["activeProjectId"].as_str().map(str::to_string),
                };
                json!({ "name": case["name"], "hud": compose_sidebar_hud(&core, &sources) })
            })
            .collect(),
    )
}

/// Each case: the status item and pet payloads from one neutral view per machine.
fn indicators(cases: &Value) -> Value {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default();
    Value::Array(
        cases
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .map(|case| {
                let mut core = Core::new();
                core.handle_raw_frame(MachineId::Local, &case["local"].to_string(), 1)
                    .expect("local frame");
                let remote = MachineId::Remote("remote-m1".to_string());
                core.handle_raw_frame(remote.clone(), &case["remote"].to_string(), 1)
                    .expect("remote frame");
                let settings = &case["settings"];
                let mut inputs = SidebarInputs {
                    settings: SidebarSettings::from_settings_json(
                        settings,
                        SessionSortMode::LastActivity,
                    ),
                    ..SidebarInputs::default()
                };
                inputs.host.machines = vec![MachineTabInput {
                    machine_id: "remote-m1".to_string(),
                    label: "Studio".to_string(),
                    state: "connected".to_string(),
                    message: None,
                    fed: true,
                }];
                let saved_remote = settings["remoteMachines"]
                    .as_array()
                    .is_some_and(|machines| {
                        machines.iter().any(|machine| machine["id"] == "remote-m1")
                    });
                let mut machines = vec![MachineId::Local];
                if saved_remote {
                    machines.push(remote);
                }
                let models: Vec<(MachineId, SidebarViewModel)> = machines
                    .into_iter()
                    .map(|machine| {
                        let mut model = SidebarViewModel::new();
                        model.update(
                            &core,
                            &neutral_indicator_inputs(&inputs, &machine),
                            &ghostex_gx_core::ChangeSummary::default(),
                            now_ms,
                        );
                        (machine, model)
                    })
                    .collect();
                let borrowed: Vec<(MachineId, &SidebarViewModel)> = models
                    .iter()
                    .map(|(machine, model)| (machine.clone(), model))
                    .collect();
                let candidates = indicator_candidates(&core, &borrowed);
                json!({
                    "name": case["name"],
                    "status": status_indicators_payload(
                        &candidates,
                        settings["hideMenuBarSessionStatusIndicators"] == true,
                    ),
                    "pet": pet_overlay_payload(
                        &candidates,
                        settings["petOverlayEnabled"] == true,
                        settings["selectedPetId"].as_str(),
                    ),
                })
            })
            .collect(),
    )
}
