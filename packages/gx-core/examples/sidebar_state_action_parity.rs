//! The Rust half of the state-action gate: what the store answers for a row's Delayed Send
//! (`sessionAction: delayedSend`), the agent launcher's run (`projectAction: agent`) and a machine
//! tab's Hide Machine (`machineAction` other than Configure).
//!
//! The planners asked are the three the desktop host calls (`gx_store/sidebar_state_actions.rs`),
//! with the TOP-LEVEL renderer commands the controller receives. The store is BUILT, because no
//! recording carries the shapes that matter: rows whose Delayed Send came from the daemon (with and
//! without a specific-agent reference, with only the flags, with an empty deadline), rows whose
//! Delayed Send and Close After Done are the host's, a row with blank titles and no agent icon,
//! and a remote machine's row; project groups on both machines; and saved remote machine lists
//! that exercise every rule of the normalization the TypeScript applies before it posts the list.
//! The raw presentation and the host inputs are written out so the TypeScript half builds its
//! sidebar store from the SAME inputs through the shipped projection, rather than from this side's
//! answer.
//!
//!   cargo run --release --example sidebar_state_action_parity -- <out-dir>   # from packages/gx-core
//!   bun tooling/gx-core/state-action-parity.ts compare <out-dir> [--inject <mutation>]

use std::process::ExitCode;

use ghostex_gx_core::{
    plan_agent_run, plan_delayed_send_action, plan_machine_disable, CloseAfterDoneInput, Core,
    DelayedSendInput, MachineId, MachineTabInput, SidebarInputs, SidebarViewModel,
};
use serde_json::{json, Value};

const NOW_MS: u64 = 1_790_000_000_000;
const REMOTE: &str = "remote-ab12";

fn main() -> ExitCode {
    let out_dir = std::env::args().nth(1).unwrap_or_default();
    if out_dir.is_empty() {
        eprintln!("usage: sidebar_state_action_parity <out-dir>");
        return ExitCode::from(2);
    }
    let local = snapshot(&[("P1", local_rows()), ("P2", vec![row("Q1", json!({}))])]);
    let remote = snapshot(&[("R1", remote_rows())]);
    let mut core = Core::new();
    core.handle_raw_frame(MachineId::Local, &frame(&local).to_string(), NOW_MS)
        .expect("the local frame parses");
    let last = core
        .handle_raw_frame(
            MachineId::Remote(REMOTE.to_string()),
            &frame(&remote).to_string(),
            NOW_MS,
        )
        .expect("the remote frame parses");

    // The host's own timers, keyed by the sidebar id, exactly as the desktop mirrors them.
    let host_delayed = json!({
        "combined-session:P1:S5": { "deadlineAt": "2026-09-21T10:00:00.000Z", "remainingLabel": "5m", "remainingMs": 300000 },
        "combined-session:P1:S6": { "remainingLabel": "When idle", "sendWhenAgentStopsActive": true },
        "combined-session:P1:S2": { "deadlineAt": "2026-09-21T11:00:00.000Z", "remainingLabel": "1h" },
    });
    let host_close = json!({
        "combined-session:P1:S6": { "armed": true, "remainingLabel": "Closes when done" },
        "combined-session:P1:S7": { "armed": false, "remainingLabel": "not armed" },
        "combined-session:P1:S1": { "armed": true },
    });

    let mut entries = Vec::new();
    for tab in ["local", REMOTE] {
        let mut inputs = SidebarInputs::default();
        inputs.ui.selected_machine_id = tab.to_string();
        inputs.host.machines = vec![MachineTabInput {
            machine_id: REMOTE.to_string(),
            label: "Remote".to_string(),
            state: "connected".to_string(),
            message: None,
            fed: true,
        }];
        for (id, value) in host_delayed.as_object().unwrap() {
            inputs.host.local_delayed_sends.insert(
                id.clone(),
                DelayedSendInput {
                    deadline_at: text(value, "deadlineAt"),
                    remaining_label: text(value, "remainingLabel"),
                    remaining_ms: value.get("remainingMs").and_then(Value::as_i64),
                    send_when_all_project_sessions_stop_active: value
                        .get("sendWhenAllProjectSessionsStopActive")
                        == Some(&Value::Bool(true)),
                    send_when_agent_stops_active: value.get("sendWhenAgentStopsActive")
                        == Some(&Value::Bool(true)),
                },
            );
        }
        for (id, value) in host_close.as_object().unwrap() {
            inputs.host.close_after_done.insert(
                id.clone(),
                CloseAfterDoneInput {
                    armed: value.get("armed") == Some(&Value::Bool(true)),
                    deadline_at: text(value, "deadlineAt"),
                    remaining_label: text(value, "remainingLabel"),
                    remaining_ms: value.get("remainingMs").and_then(Value::as_i64),
                },
            );
        }
        let mut model = SidebarViewModel::new();
        model.update(&core, &inputs, &last.changes, NOW_MS);
        let view = model.view();

        // Every drawn row, and one id no list draws.
        let mut session_ids: Vec<String> = view
            .groups
            .iter()
            .flat_map(|group| group.core.sessions.iter())
            .map(|session| session.row.sidebar_session_id.clone())
            .collect();
        session_ids.push("combined-session:P9:gone".to_string());
        for session_id in session_ids {
            let command = json!({ "type": "sessionAction", "action": "delayedSend", "sessionId": session_id });
            entries.push(entry(
                "delayedSend",
                tab,
                &command,
                None,
                plan_delayed_send_action(view, &command),
            ));
        }

        // The launcher's run on every drawn project and on a group no list draws, with every
        // shape of agent and account a menu row can carry.
        let mut group_ids: Vec<String> = view
            .groups
            .iter()
            .filter(|group| group.core.project_context.is_some())
            .map(|group| group.core.group_id.clone())
            .collect();
        group_ids.push("combined-project:P9".to_string());
        for group_id in group_ids {
            for (agent, account) in [
                (None, None),
                (Some(json!("")), None),
                (Some(json!("codex")), None),
                (Some(json!("claude")), Some(json!("acct-1"))),
                (Some(json!("claude")), Some(Value::Null)),
            ] {
                let mut command =
                    json!({ "type": "projectAction", "action": "agent", "groupId": group_id });
                if let Some(agent) = agent {
                    command["agentId"] = agent;
                }
                if let Some(account) = account {
                    command["accountId"] = account;
                }
                entries.push(entry(
                    "agent",
                    tab,
                    &command,
                    None,
                    plan_agent_run(view, &command),
                ));
            }
        }
    }

    // Hide Machine over every saved list, for the machine the tab names, one normalization
    // renumbers, and none; Configure is here too because it must NOT be this planner's.
    for (list_index, saved) in machine_lists().iter().enumerate() {
        for (action, machine_id) in [
            ("hide", Some("remote-ab12")),
            ("hide", Some("remote-2")),
            ("hide", Some("REMOTE-Up")),
            ("hide", None),
            ("disable", Some("remote-ab12")),
            ("configure", Some("remote-ab12")),
        ] {
            let mut command = json!({ "type": "machineAction", "action": action });
            if let Some(machine_id) = machine_id {
                command["machineId"] = Value::String(machine_id.to_string());
            }
            let plan = plan_machine_disable(&command, Some(saved));
            let mut item = entry("machine", "local", &command, Some(saved.clone()), plan);
            item["listIndex"] = json!(list_index);
            entries.push(item);
        }
    }
    let path = std::path::Path::new(&out_dir).join("state-action-rust.json");
    let dump = json!({
        "localSnapshot": local,
        "remoteSnapshot": remote,
        "remoteMachineId": REMOTE,
        "hostDelayedSends": host_delayed,
        "hostCloseAfterDone": host_close,
        "entries": entries,
    });
    if let Err(error) = std::fs::create_dir_all(&out_dir)
        .and_then(|()| std::fs::write(&path, serde_json::to_string(&dump).unwrap()))
    {
        eprintln!("could not write {}: {error}", path.display());
        return ExitCode::from(1);
    }
    println!(
        "{} state-action entries -> {}",
        entries.len(),
        path.display()
    );
    ExitCode::SUCCESS
}

fn entry(
    kind: &str,
    tab: &str,
    command: &Value,
    saved: Option<Value>,
    plan: Option<ghostex_gx_core::SidebarActionPlan>,
) -> Value {
    json!({
        "kind": kind,
        "tab": tab,
        "command": command,
        "savedRemoteMachines": saved,
        "owned": plan.is_some(),
        "calls": plan.map(|plan| plan.to_json()).unwrap_or(Value::Null),
    })
}

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

/// Saved remote machine lists, each built to reach a rule of `normalizeRemoteMachineSettings`.
fn machine_lists() -> Vec<Value> {
    vec![
        // The ordinary list: the tab's machine and a second one.
        json!([
            { "id": "remote-ab12", "name": "Studio", "sshHost": "studio.invalid", "sshUser": "me" },
            { "id": "remote-cd34", "name": "Box", "sshHost": "box.invalid", "sshPort": 2222 },
        ]),
        // Every normalization rule at once: padding, a dropped nameless machine, a dropped
        // hostless ssh machine, an Easy Connect machine with no host, a duplicate id and a bad id
        // (both renumbered), a password that must not travel, ports as strings, a bad one and a
        // boolean, an upper-case id prefix, a WSL distribution that is refused and one that is
        // kept, an already disabled machine, a non-object, and a name cut at 80 UTF-16 units.
        json!([
            { "id": "  remote-ab12 ", "name": "  Studio  ", "sshHost": " studio.invalid ", "password": "x", "sshPasswordSaved": true },
            { "id": "remote-nameless", "name": "   ", "sshHost": "h.invalid" },
            { "id": "remote-hostless", "name": "No host", "sshHost": "" },
            { "id": "remote-easy", "name": "Easy", "transport": "easyConnect", "easyConnectAddress": " tcABCDEF " },
            { "id": "remote-easybad", "name": "Easy bad", "transport": "easyConnect", "easyConnectAddress": "tc a" },
            { "id": "remote-ab12", "name": "Duplicate", "sshHost": "dup.invalid", "sshPort": " 0x16 " },
            { "id": "not an id", "name": "Bad id", "sshHost": "bad.invalid", "sshPort": "70000" },
            { "id": "REMOTE-Up", "name": "Upper", "sshHost": "up.invalid", "sshPort": true, "disabled": true },
            { "id": "remote-wsl", "name": "WSL", "sshHost": "w.invalid", "wslDistribution": "-bad", "sshIdentityFile": " ~/.ssh/id " },
            { "id": "remote-wsl2", "name": "WSL2", "sshHost": "w2.invalid", "wslDistribution": "Ubuntu (22.04)", "sshPort": "22.5" },
            "not a machine",
            { "id": "remote-long", "name": "x".repeat(79) + "é€😀tail", "sshHost": "l.invalid", "sshPort": "1e3" },
            { "id": "remote-num", "name": 42, "sshHost": "n.invalid" },
        ]),
        // No list at all, and a list that is not an array.
        Value::Null,
        json!({ "remote-ab12": {} }),
    ]
}

fn frame(snapshot: &Value) -> Value {
    json!({
        "type": "presentationSnapshot",
        "protocolVersion": ghostex_gx_core::protocol::GXSERVER_PROTOCOL_VERSION,
        "serverId": "server",
        "revision": 1,
        "snapshot": snapshot,
    })
}

/// The local rows, each carrying one Delayed Send shape.
fn local_rows() -> Vec<Value> {
    let agent =
        json!({ "projectId": "P2", "sessionId": "Q1", "agentName": "Codex", "title": "Other" });
    vec![
        row("S1", json!({ "primaryTitle": "Plain" })),
        row(
            "S2",
            json!({ "delayedSendDeadlineAt": "2026-09-21T12:00:00.000Z", "delayedSendRemainingLabel": "2h", "delayedSendRemainingMs": 7200000 }),
        ),
        row(
            "S3",
            json!({ "sendWhenAgentStopsActive": true, "delayedSendRemainingLabel": "When done", "sendWhenSpecificAgentFinishes": agent }),
        ),
        row(
            "S4",
            json!({ "sendWhenAllProjectSessionsStopActive": true }),
        ),
        row("S5", json!({ "sendWhenSpecificAgentFinishes": agent })),
        row("S6", json!({ "primaryTitle": "Host timer" })),
        row(
            "S7",
            json!({ "primaryTitle": "   ", "terminalTitle": "  term  ", "agentIcon": null, "agentName": null, "agentId": null }),
        ),
        row(
            "S8",
            json!({ "delayedSendDeadlineAt": "", "delayedSendRemainingLabel": "" }),
        ),
    ]
}

fn remote_rows() -> Vec<Value> {
    vec![
        row(
            "T1",
            json!({ "delayedSendDeadlineAt": "2026-09-21T13:00:00.000Z", "delayedSendRemainingLabel": "3h", "sendWhenSpecificAgentFinishes": { "projectId": "R1", "sessionId": "T2" } }),
        ),
        row("T2", json!({ "primaryTitle": "Remote plain" })),
    ]
}

fn row(id: &str, extra: Value) -> Value {
    let mut row = json!({
        "sessionId": id,
        "kind": "agent",
        "surface": "workspace",
        "zmxName": format!("S90-{id}"),
        "sortKey": format!("000{id}"),
        "visibleInSidebarByDefault": true,
        "title": format!("Session {id}"),
        "agentIcon": "codex",
        "agentName": "codex",
        "activity": "idle",
        "pendingQuestionCount": 0,
        "lifecycleState": "running",
        "lastInteractionAt": "2026-09-15T01:18:43.055Z",
        "createdAt": "2026-09-01T01:00:00.000Z",
        "updatedAt": "2026-09-15T01:18:43.055Z",
    });
    for (key, value) in extra.as_object().unwrap() {
        match value.is_null() {
            true => {
                row.as_object_mut().unwrap().remove(key);
            }
            false => row[key] = value.clone(),
        }
    }
    row
}

fn snapshot(projects: &[(&str, Vec<Value>)]) -> Value {
    let mut sessions = Vec::new();
    for (project, rows) in projects {
        for row in rows {
            let mut row = row.clone();
            row["projectId"] = json!(project);
            row["groupId"] = json!(format!("{project}:active"));
            sessions.push(row);
        }
    }
    json!({
        "revision": 1,
        "generatedAt": "2026-09-21T00:00:00.000Z",
        "projects": projects.iter().map(|(id, _)| json!({
            "projectId": id,
            "title": id,
            "path": format!("/tmp/{id}"),
            "pathState": "available",
            "groupIds": [format!("{id}:active")],
            "sortKey": format!("1:{id}"),
            "createdAt": "2026-06-29T13:10:42.091Z",
            "updatedAt": "2026-09-15T01:18:43.055Z",
        })).collect::<Vec<_>>(),
        "groups": projects.iter().map(|(id, rows)| json!({
            "groupId": format!("{id}:active"),
            "projectId": id,
            "title": "Active",
            "sessionIds": rows.iter().map(|row| row["sessionId"].clone()).collect::<Vec<_>>(),
            "sortKey": format!("1:{id}:active"),
        })).collect::<Vec<_>>(),
        "sessions": sessions,
    })
}
