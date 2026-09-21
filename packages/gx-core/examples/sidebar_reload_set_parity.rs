//! The gate for Full Reload over a set: a project's inactive zmx rows, and a user-made group's
//! members, in the order they are reloaded and where a failed one stops the rest.
//!
//! **The recording cannot supply these cases**, so the store is BUILT. A project holds one row of
//! every kind the set must tell apart (zmx and idle, zmx and working, zmx and waiting on the user,
//! zmx and asleep, zmx and stopped, tmux, no provider at all), two rows whose sort keys tie so the
//! session id decides, and a row whose sort key puts it first. A remote machine holds the same
//! shape, a second remote machine holds nothing, and the workspace session groups document has a
//! local group whose members include an asleep row and one the daemon no longer knows, an empty
//! group, and a group of a remote project. A second store has no presentation at all.
//!
//! Every plan is run against every answer script (every reload completing, then each one failing
//! in turn) through `ReloadSetPlan::step_after`, the rule the host runs, and written as the list of
//! rows actually reloaded.
//!
//!   cargo run --release --example sidebar_reload_set_parity -- <out-dir>
//!   bun tooling/gx-core/reload-set-parity.ts compare <out-dir>

use std::process::ExitCode;

use ghostex_gx_core::{
    encode_workspace_subgroup_id, plan_reload_set, Core, MachineId, ProjectKey, ReloadSetPlan,
    WorkspaceGroupsDocument,
};
use serde_json::{json, Value};

const NOW_MS: u64 = 1_790_000_000_000;
const REMOTE: &str = "remote-ab12";
const REMOTE_EMPTY: &str = "remote-zz99";

fn main() -> ExitCode {
    let out_dir = std::env::args().nth(1).unwrap_or_default();
    if out_dir.is_empty() {
        eprintln!("usage: sidebar_reload_set_parity <out-dir>");
        return ExitCode::from(2);
    }
    let local = snapshot(&["P1", "P2"]);
    let remote = snapshot(&["R1"]);
    let document_json = document();
    let document = WorkspaceGroupsDocument::parse(&document_json);
    let mut loaded = Core::new();
    loaded
        .handle_raw_frame(MachineId::Local, &frame(&local).to_string(), NOW_MS)
        .expect("the local frame parses");
    loaded
        .handle_raw_frame(
            MachineId::Remote(REMOTE.to_string()),
            &frame(&remote).to_string(),
            NOW_MS,
        )
        .expect("the remote frame parses");
    let empty = Core::new();
    // The third store: this computer streamed, and the remote machine's rows are the stored
    // LAST-SEEN copy. `fullReloadProjectZmxSessions` resolves its rows from
    // `this.remotePresentations`, which such a machine is absent from, so the old runtime reloads
    // nothing there and `loaded_live` is what keeps the store doing the same.
    let mut last_seen = Core::new();
    last_seen
        .handle_raw_frame(MachineId::Local, &frame(&local).to_string(), NOW_MS)
        .expect("the local frame parses");
    last_seen.seed_last_seen_presentation(
        &MachineId::Remote(REMOTE.to_string()),
        serde_json::from_value(remote.clone()).expect("the remote snapshot parses"),
    );

    let mut entries = Vec::new();
    let mut owned = 0usize;
    let mut traces = 0usize;
    for (presentation, core) in [
        ("loaded", &loaded),
        ("none", &empty),
        ("lastSeen", &last_seen),
    ] {
        for payload in payloads() {
            let plan = plan_reload_set(core, &document, &payload);
            let entry_traces: Vec<Value> = plan
                .as_ref()
                .map(|plan| {
                    scripts(plan.messages.len())
                        .into_iter()
                        .map(|script| {
                            traces += 1;
                            json!({ "script": script, "reloaded": simulate(plan, &script) })
                        })
                        .collect()
                })
                .unwrap_or_default();
            owned += usize::from(plan.is_some());
            entries.push(json!({
                "presentation": presentation,
                "payload": payload,
                "owned": plan.is_some(),
                "plan": plan.as_ref().map(ReloadSetPlan::to_json),
                "traces": entry_traces,
            }));
        }
    }
    let dump = json!({
        "localSnapshot": local,
        "remoteSnapshot": remote,
        "remoteMachine": REMOTE,
        "document": document_json,
        "entries": entries,
    });
    let path = std::path::Path::new(&out_dir).join("rust-reload-sets.json");
    if let Err(error) = std::fs::write(&path, serde_json::to_string(&dump).expect("serialize")) {
        eprintln!("write {}: {error}", path.display());
        return ExitCode::FAILURE;
    }
    println!(
        "{}: {} payloads, {owned} answered, {traces} traces",
        path.display(),
        dump["entries"].as_array().map_or(0, Vec::len),
    );
    if owned == 0 || traces == 0 {
        eprintln!("no set was planned: the gate would compare nothing");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}

fn payloads() -> Vec<Value> {
    let local_group =
        |group_id: &str| encode_workspace_subgroup_id(&ProjectKey::local("P1"), group_id);
    let remote_group = encode_workspace_subgroup_id(&ProjectKey::remote(REMOTE, "R1"), "group-1");
    let unknown_project_group = encode_workspace_subgroup_id(&ProjectKey::local("P9"), "group-1");
    let mut out = Vec::new();
    for group_id in [
        "combined-project:P1".to_string(),
        "combined-project:P2".to_string(),
        format!("remote:{REMOTE}:group:R1"),
        format!("remote:{REMOTE_EMPTY}:group:X1"),
        "combined-chats".to_string(),
        local_group("group-1"),
        "not-a-group".to_string(),
    ] {
        out.push(json!({ "type": "fullReloadProjectZmxSessions", "groupId": group_id }));
    }
    for group_id in [
        local_group("group-1"),
        local_group("group-2"),
        local_group("group-missing"),
        remote_group,
        unknown_project_group,
        "combined-project:P1".to_string(),
        format!("remote:{REMOTE}:group:R1"),
        "not-a-group".to_string(),
    ] {
        out.push(json!({ "type": "fullReloadGroup", "groupId": group_id }));
    }
    out
}

/// Every reload completing, and then each one failing in turn.
fn scripts(rows: usize) -> Vec<Vec<bool>> {
    let mut scripts = vec![vec![true; rows]];
    for failing in 0..rows {
        let mut script = vec![true; failing];
        script.push(false);
        scripts.push(script);
    }
    scripts
}

/// The rows actually reloaded under one script, with the host's own rule.
fn simulate(plan: &ReloadSetPlan, script: &[bool]) -> Vec<Value> {
    let mut reloaded = Vec::new();
    let mut index = 0;
    while let Some(message) = plan.messages.get(index) {
        reloaded.push(message["sessionId"].clone());
        let completed = script.get(index).copied().unwrap_or(true);
        match plan.step_after(index, completed) {
            Some(next) => index = next,
            None => break,
        }
    }
    reloaded
}

/// The workspace session groups document: a local group with an asleep member and one the daemon
/// no longer knows, an empty group, and a remote project's group.
fn document() -> Value {
    json!({
        "projectOrder": ["P1", "P2"],
        "projects": {
            "P1": {
                "groups": [
                    { "groupId": "group-1", "title": "One", "sessionIds": ["A", "D", "ghost", "B"] },
                    { "groupId": "group-2", "title": "Two", "sessionIds": [] },
                ],
                "nextGroupNumber": 3,
            },
            format!("remote:{REMOTE}:project:R1"): {
                "groups": [
                    { "groupId": "group-1", "title": "Remote", "sessionIds": ["G", "A"] },
                ],
                "nextGroupNumber": 2,
            },
        },
    })
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

fn snapshot(projects: &[&str]) -> Value {
    let mut sessions = Vec::new();
    for project in projects {
        if *project == "P2" {
            // A project with rows, none of which the set may take.
            sessions.push(session(project, "W", "zmx", "running", "working", "0005"));
            sessions.push(session(project, "S", "zmx", "sleeping", "idle", "0006"));
            continue;
        }
        for (id, provider, lifecycle, activity, sort) in [
            ("A", "zmx", "running", "idle", "0003"),
            ("B", "zmx", "running", "working", "0004"),
            ("C", "zmx", "running", "attention", "0005"),
            ("D", "zmx", "sleeping", "idle", "0006"),
            ("E", "tmux", "running", "idle", "0007"),
            ("F", "", "running", "idle", "0008"),
            ("G", "zmx", "running", "idle", "0001"),
            ("H", "zmx", "stopped", "idle", "0009"),
            // Two rows whose sort keys tie: the session id decides, by code point.
            ("K2", "zmx", "running", "idle", "0010"),
            ("K1", "zmx", "running", "idle", "0010"),
        ] {
            sessions.push(session(project, id, provider, lifecycle, activity, sort));
        }
    }
    json!({
        "revision": 1,
        "generatedAt": "2026-09-21T00:00:00.000Z",
        "projects": projects.iter().map(|id| json!({
            "projectId": id,
            "title": id,
            "path": format!("/tmp/{id}"),
            "pathState": "available",
            "groupIds": [format!("{id}:active")],
            "sortKey": format!("1:{id}"),
            "createdAt": "2026-06-29T13:10:42.091Z",
            "updatedAt": "2026-09-15T01:18:43.055Z",
        })).collect::<Vec<_>>(),
        "groups": projects.iter().map(|id| json!({
            "groupId": format!("{id}:active"),
            "projectId": id,
            "title": "Active",
            "sessionIds": sessions
                .iter()
                .filter(|row| row["projectId"] == Value::from(*id))
                .map(|row| row["sessionId"].clone())
                .collect::<Vec<_>>(),
            "sortKey": format!("1:{id}:active"),
        })).collect::<Vec<_>>(),
        "sessions": sessions,
    })
}

fn session(
    project_id: &str,
    session_id: &str,
    provider: &str,
    lifecycle: &str,
    activity: &str,
    sort: &str,
) -> Value {
    let mut row = json!({
        "sessionId": session_id,
        "projectId": project_id,
        "groupId": format!("{project_id}:active"),
        "kind": "agent",
        "surface": "workspace",
        "zmxName": format!("S90-{project_id}-{session_id}"),
        "sortKey": sort,
        "visibleInSidebarByDefault": true,
        "alias": format!("Session {session_id}"),
        "activity": activity,
        "pendingQuestionCount": 0,
        "lifecycleState": lifecycle,
        "lastInteractionAt": "2026-09-15T01:18:43.055Z",
        "createdAt": "2026-09-15T01:00:00.000Z",
        "updatedAt": "2026-09-15T01:18:43.055Z",
    });
    if !provider.is_empty() {
        row["sessionPersistenceProvider"] = json!(provider);
    }
    row
}
