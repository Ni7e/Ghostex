//! The Rust half of the app runtime port's F1 fixture gate (tooling/app-runtime-port/f1-parity.ts):
//! the renderer command validation and target resolution the QuickJS runtime did, now
//! `plan_renderer_command`.
//!
//!   cargo run -q --example f1_parity -- <dir>
//!
//! Reads `<dir>/fixtures.json` (a presentation snapshot, the daemon's project list, one remote
//! machine id and the cases), answers every case, and writes `<dir>/rust.json` in the shape the
//! TypeScript half writes `<dir>/typescript.json`. Deleted with the runtime in step 3.

use std::fs;
use std::path::PathBuf;

use ghostex_gx_core::protocol::ServerEvent;
use ghostex_gx_core::{plan_renderer_command, Core, Event, MachineId, RendererVerb};
use serde_json::{json, Value};

fn snapshot_frame(snapshot: &Value) -> ServerEvent {
    let frame = json!({
        "type": "presentationSnapshot",
        "protocolVersion": 1,
        "serverId": "parity",
        "clientId": "parity",
        "revision": snapshot.get("revision").cloned().unwrap_or(json!(1)),
        "snapshot": snapshot,
    });
    ServerEvent::parse(&frame.to_string()).expect("the fixture snapshot parses")
}

fn main() {
    let dir = PathBuf::from(std::env::args().nth(1).expect("usage: f1_parity <dir>"));
    let fixtures: Value = serde_json::from_str(
        &fs::read_to_string(dir.join("fixtures.json")).expect("fixtures.json"),
    )
    .expect("fixtures.json is JSON");
    let mut core = Core::new();
    core.handle(
        Event::Frame {
            machine: MachineId::Local,
            frame: Box::new(snapshot_frame(&fixtures["snapshot"])),
        },
        1,
    );
    core.handle(
        Event::DomainProjectsRead {
            machine: MachineId::Local,
            projects: fixtures["domainProjects"]
                .as_array()
                .cloned()
                .unwrap_or_default(),
        },
        1,
    );
    let remote = fixtures["remoteMachineId"]
        .as_str()
        .unwrap_or("remote-fixture");
    core.handle(
        Event::Frame {
            machine: MachineId::Remote(remote.to_string()),
            frame: Box::new(snapshot_frame(&fixtures["remoteSnapshot"])),
        },
        1,
    );
    let answers: Vec<Value> = fixtures["cases"]
        .as_array()
        .expect("cases")
        .iter()
        .map(|case| {
            let answer = match plan_renderer_command(
                &core,
                case["action"].as_str().unwrap_or_default(),
                &case["payload"],
            ) {
                Ok(verb) => verb_json(verb),
                Err(error) => json!({ "error": error.message() }),
            };
            json!({ "name": case["name"], "answer": answer })
        })
        .collect();
    fs::write(
        dir.join("rust.json"),
        serde_json::to_string_pretty(&Value::Array(answers)).expect("serializable"),
    )
    .expect("rust.json");
}

fn verb_json(verb: RendererVerb) -> Value {
    match verb {
        RendererVerb::FocusSession(session) => json!({
            "verb": "focusSession",
            "sidebarSessionId": session.sidebar_session_id,
            "projectId": session.key.project_id,
            "sessionId": session.key.session_id,
        }),
        RendererVerb::RenameCommand {
            session,
            title,
            command,
        } => json!({
            "verb": "renameCommand",
            "sidebarSessionId": session.sidebar_session_id,
            "projectId": session.key.project_id,
            "sessionId": session.key.session_id,
            "title": title,
            "command": command,
        }),
        RendererVerb::RunCommand { command_id } => {
            json!({ "verb": "runCommand", "commandId": command_id })
        }
        RendererVerb::ReadResourcesSnapshot => json!({ "verb": "readResourcesSnapshot" }),
        RendererVerb::UpdateSettingsPatch { patch, mut keys } => {
            keys.sort();
            json!({ "verb": "updateSettingsPatch", "keys": keys, "patch": patch })
        }
        RendererVerb::OpenSettings { tab, search_query } => {
            json!({ "verb": "openSettings", "tab": tab, "searchQuery": search_query })
        }
        RendererVerb::OpenBrowser {
            project_id,
            reuse,
            url,
        } => json!({ "verb": "openBrowser", "projectId": project_id, "reuse": reuse, "url": url }),
        other => json!({ "verb": format!("{other:?}") }),
    }
}
