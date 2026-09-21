//! The gate for a click on a row of another machine: the one native action it posts, and the two
//! options that decide what the user sees.
//!
//! **No recording holds one**, for the same reason the remote action gate builds its payloads: no
//! remote machine was enabled until 2026-09-21. So the cases are BUILT, and the two that actually
//! decide the pane are enumerated rather than sampled. `keepView` is a function of the group that
//! is active when the click happens, so every shape of active group is a case: nothing, this row's
//! own remote project group, another project's on the same machine, the same project's on another
//! machine, the machine's Chats group, a user-made subgroup, and a local project's group.
//! `preferredInterface` is a function of the row's agent and the Default Agent View, so every
//! combination of a row with an agent, a row without one, a row the machine does not list, a global
//! default of chat and of terminal, and an override that agrees, disagrees or is unreadable is a
//! case.
//!
//! Split Right rides along because it is the same open with a placement and WITHOUT the two
//! options, which is the difference a single payload comparison would miss.
//!
//! **The active group is read the way the live host reads it.** `keepView` is planned from the OLD
//! RUNTIME's `activeGroupId`, which the host tracks in a `RuntimeActiveGroup` from what it sent the
//! runtime and what the runtime published; the core's own focus is seeded to a LOCAL project in
//! every case, because the shadow mirror never follows a remote focus. Each group is reached by one
//! or more HISTORIES, fed to the same tracker the host uses and replayed on the TypeScript side
//! through the runtime's own focus methods, so the group the runtime holds is its code's answer:
//! `published` (the runtime published the group), `sentPublishLagging` (a remote click in that
//! group was sent and its publish is not back), `tellAfterRemote` (then a local click's tell went
//! out, and the late publish still names the remote group), and `tellPending` (that tell is still
//! waiting, flushed before the command). Three alternative plans ride along for the comparer's
//! mutations: `corePlan` (the group from `core.focus()`, the reviewed bug), `publishedPlan` (the
//! last publish only) and `ignoresTellPlan` (the sent group even after a tell).
//!
//! A third machine is held as the stored LAST-SEEN copy (`seed_last_seen_presentation`), which is
//! what an offline machine shows. The old runtime does not list such a machine in
//! `remotePresentations`, so it opens the row without `preferredInterface`; the planner must hand
//! it back. Each of its cases also carries `lastSeenPlan`, the plan a store that read those rows as
//! live would have made, so the comparer's `answer-a-last-seen-machine` mutation is that exact port
//! mistake rather than a guess at it.
//!
//!   cargo run --release --example sidebar_remote_focus_parity -- <out-dir>
//!   bun tooling/gx-core/remote-focus-parity.ts compare <out-dir>

use std::process::ExitCode;

use ghostex_gx_core::{
    plan_remote_focus, remote_focus_group, ActiveGroup, Core, FocusState, MachineId,
    PreferredInterfaceSettings, ProjectKey, RemoteFocusPlan, RuntimeActiveGroup, SessionKey,
};
use serde_json::{json, Value};

const NOW_MS: u64 = 1_790_000_000_000;
/// The user's own machine id shape, and a second machine so a payload built for the wrong one is a
/// difference rather than a coincidence.
const MACHINE: &str = "remote-msgckntd-ecz4w";
const OTHER_MACHINE: &str = "remote-ab12";
/// A machine the store holds no rows for: the planner must hand its clicks back.
const UNLOADED_MACHINE: &str = "remote-offline";
/// A machine whose rows are the stored last-seen copy, not this run's stream.
const LAST_SEEN_MACHINE: &str = "remote-lastseen";
/// The local project the core's focus stays on, and the group a local tell leaves active.
const LOCAL_GROUP: &str = "combined-project:P1";

fn main() -> ExitCode {
    let out_dir = std::env::args().nth(1).unwrap_or_default();
    if out_dir.is_empty() {
        eprintln!("usage: sidebar_remote_focus_parity <out-dir>");
        return ExitCode::from(2);
    }
    let mut entries = Vec::new();
    let mut owned = 0usize;
    for session_id in session_ids() {
        for message in messages(&session_id) {
            for active_group in active_groups() {
                for history in histories(active_group.as_deref()) {
                    for settings in interface_settings() {
                        let core = seeded_core(false);
                        let host_group = history.tracker.current(
                            history.told_stamp,
                            history.tell_pending,
                            NOW_MS,
                        );
                        let plan = plan_remote_focus(&core, &message, &settings, host_group);
                        if plan.is_some() {
                            owned += 1;
                        }
                        let alternative = |group: Option<&str>| {
                            plan_remote_focus(&core, &message, &settings, group)
                                .as_ref()
                                .map_or(Value::Null, RemoteFocusPlan::to_json)
                        };
                        let core_group = core
                            .focus()
                            .active_group
                            .as_ref()
                            .map(ActiveGroup::to_sidebar_group_id);
                        let mut entry = json!({
                            "message": message,
                            "history": history.kind,
                            "historySteps": history.steps,
                            "startGroupId": history.start_group,
                            "activeGroupId": history.runtime_group,
                            "hostGroupId": host_group,
                            "settings": settings_json(&settings),
                            "presentation": presentation_json(),
                            "liveMachineIds": [MACHINE, OTHER_MACHINE],
                            "owned": plan.is_some(),
                            "plan": plan.as_ref().map(RemoteFocusPlan::to_json),
                            "focusGroup": plan.as_ref().map(|plan| plan.focus_group.clone()),
                            "corePlan": alternative(core_group.as_deref()),
                            "publishedPlan": alternative(history.tracker.published()),
                            "ignoresTellPlan": alternative(
                                history.tracker.sent_group().or(history.tracker.published()),
                            ),
                        });
                        if session_id.starts_with(&format!("remote:{LAST_SEEN_MACHINE}:")) {
                            let live = seeded_core(true);
                            entry["lastSeenPlan"] =
                                plan_remote_focus(&live, &message, &settings, host_group)
                                    .as_ref()
                                    .map_or(Value::Null, RemoteFocusPlan::to_json);
                        }
                        entries.push(entry);
                    }
                }
            }
        }
    }
    let dump = json!({ "entries": entries });
    let path = std::path::Path::new(&out_dir).join("rust-remote-focus.json");
    if let Err(error) = std::fs::write(&path, serde_json::to_string(&dump).expect("serialize")) {
        eprintln!("write {}: {error}", path.display());
        return ExitCode::FAILURE;
    }
    println!(
        "{}: {} cases, {owned} answered as a remote click",
        path.display(),
        dump["entries"].as_array().map_or(0, Vec::len),
    );
    // A run that planned nothing compares nothing, whatever the other half then reports.
    if owned == 0 {
        eprintln!("no remote click was planned: the gate would compare nothing");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}

/// Every id shape the remote session pattern must accept or refuse, plus the two machines and the
/// one the store holds no rows for.
fn session_ids() -> Vec<String> {
    vec![
        // An agent row, a row with no agent at all, and a row the machine does not list.
        format!("remote:{MACHINE}:session:R1:RS1"),
        format!("remote:{MACHINE}:session:R1:RS2"),
        format!("remote:{MACHINE}:session:R1:missing"),
        // An agent id that is empty, and one that is only spaces: both are "no agent" to
        // `normalizeNonEmptyString`, so neither may carry a `preferredInterface`.
        format!("remote:{MACHINE}:session:R1:RS3"),
        format!("remote:{MACHINE}:session:R1:RS4"),
        // The machine's chat project, whose group is the Chats collection rather than its own.
        format!("remote:{MACHINE}:session:R-chat:CS1"),
        // The second machine, and a colon inside the session id, which belongs to the session.
        format!("remote:{OTHER_MACHINE}:session:R1:RS1"),
        format!("remote:{OTHER_MACHINE}:session:R1:with:colon"),
        // A machine with no rows: the planner hands it back and the old runtime still opens it.
        format!("remote:{UNLOADED_MACHINE}:session:R1:RS1"),
        // A machine drawn from its last-seen copy, on a row WITH an agent, so a planner that read
        // those rows would add a `preferredInterface` the old runtime never sends.
        format!("remote:{LAST_SEEN_MACHINE}:session:R1:RS1"),
        // Shapes the remote pattern refuses.
        format!("remote:{MACHINE}:session:R1"),
        format!("remote:{MACHINE}:group:R1"),
        "combined-session:P1:S1".to_string(),
        "gpui-browser:P1:7".to_string(),
        String::new(),
    ]
}

/// The two messages the remote branch answers, with every value of the one field that changes the
/// first of them.
fn messages(session_id: &str) -> Vec<Value> {
    vec![
        json!({ "type": "focusSession", "sessionId": session_id }),
        json!({ "type": "focusSession", "sessionId": session_id, "keepView": true }),
        json!({ "type": "focusSession", "sessionId": session_id, "keepView": false }),
        // A string, which `=== true` refuses on the TypeScript side.
        json!({ "type": "focusSession", "sessionId": session_id, "keepView": "true" }),
        json!({ "type": "splitSessionRight", "sessionId": session_id }),
    ]
}

/// Every shape of active group `focusChangesActiveProject` has to answer for.
fn active_groups() -> Vec<Option<String>> {
    vec![
        None,
        Some(format!("remote:{MACHINE}:group:R1")),
        Some(format!("remote:{MACHINE}:group:R2")),
        Some(format!("remote:{OTHER_MACHINE}:group:R1")),
        Some(format!("remote:{MACHINE}:group:combined-chats")),
        Some("combined-project:P1".to_string()),
        Some(format!("gpui-wsg:remote%3A{MACHINE}%3Aproject%3AR1:g1")),
    ]
}

/// One way the host came to hold its idea of the runtime's group, and what the runtime holds.
struct History {
    kind: &'static str,
    /// Replayed on the TypeScript runtime before the message, through its own focus methods.
    steps: Vec<Value>,
    start_group: Option<String>,
    /// What the runtime's `activeGroupId` is once the steps ran; the comparer checks it.
    runtime_group: Option<String>,
    tracker: RuntimeActiveGroup,
    told_stamp: u64,
    tell_pending: bool,
}

/// The row whose click leaves `group` active in the runtime, for the groups a click can produce.
fn row_producing(group: &str) -> Option<String> {
    let rows = [
        format!("remote:{MACHINE}:session:R1:RS1"),
        format!("remote:{MACHINE}:session:R2:R2S1"),
        format!("remote:{MACHINE}:session:R-chat:CS1"),
        format!("remote:{OTHER_MACHINE}:session:R1:RS1"),
    ];
    let core = seeded_core(false);
    rows.into_iter().find(|row| {
        let session = SessionKey::parse_remote_scoped_session_id(row).expect("a remote row");
        remote_focus_group(&core, &session) == group
    })
}

/// Every history that ends with the runtime on `group` or, for the two tell histories, on the local
/// group a tell leaves after a click that produced `group`.
fn histories(group: Option<&str>) -> Vec<History> {
    let mut published = RuntimeActiveGroup::default();
    published.observe_publish(group, 0);
    let mut out = vec![History {
        kind: "published",
        steps: Vec::new(),
        start_group: group.map(str::to_string),
        runtime_group: group.map(str::to_string),
        tracker: published,
        told_stamp: 0,
        tell_pending: false,
    }];
    let Some(row) = group.and_then(row_producing) else {
        return out;
    };
    let group = group.expect("a producible group").to_string();
    let remote_step = json!({ "step": "remoteFocus", "sessionId": row });
    let tell_step =
        json!({ "step": "localTell", "projectId": "P1", "sessionId": "S1", "focusStamp": 1 });
    // The click was sent; the runtime's publish of it is not back, so the last publish is local.
    let mut lagging = RuntimeActiveGroup::default();
    lagging.observe_publish(Some(LOCAL_GROUP), 0);
    lagging.sent_remote_focus(group.clone(), 0, NOW_MS);
    out.push(History {
        kind: "sentPublishLagging",
        steps: vec![remote_step.clone()],
        start_group: Some(LOCAL_GROUP.to_string()),
        runtime_group: Some(group.clone()),
        tracker: lagging.clone(),
        told_stamp: 0,
        tell_pending: false,
    });
    // Then a local click's tell went out (stamp 1), and the click's late publish still names the
    // remote group with the stamp from before the tell.
    let mut told = lagging.clone();
    told.observe_publish(Some(&group), 0);
    out.push(History {
        kind: "tellAfterRemote",
        steps: vec![remote_step.clone(), tell_step.clone()],
        start_group: Some(LOCAL_GROUP.to_string()),
        runtime_group: Some(LOCAL_GROUP.to_string()),
        tracker: told,
        told_stamp: 1,
        tell_pending: false,
    });
    // The local click's tell is still pending; the command flushes it first.
    let mut pending = lagging;
    pending.observe_publish(Some(&group), 0);
    out.push(History {
        kind: "tellPending",
        steps: vec![remote_step, tell_step],
        start_group: Some(LOCAL_GROUP.to_string()),
        runtime_group: Some(LOCAL_GROUP.to_string()),
        tracker: pending,
        told_stamp: 0,
        tell_pending: true,
    });
    out
}

/// Every combination of a global Default Agent View and an override for the one agent a row has.
fn interface_settings() -> Vec<PreferredInterfaceSettings> {
    let mut out = Vec::new();
    for default_interface in ["terminal", "chat"] {
        for override_value in [None, Some("chat"), Some("terminal"), Some("split")] {
            out.push(PreferredInterfaceSettings {
                default_interface: default_interface.to_string(),
                overrides: override_value
                    .map(|value| vec![("claude".to_string(), value.to_string())])
                    .unwrap_or_default(),
            });
        }
    }
    out
}

fn settings_json(settings: &PreferredInterfaceSettings) -> Value {
    json!({
        "preferredAgentInterface": settings.default_interface,
        "preferredAgentInterfaceOverrides": settings
            .overrides
            .iter()
            .map(|(agent_id, value)| (agent_id.clone(), Value::String(value.clone())))
            .collect::<serde_json::Map<String, Value>>(),
    })
}

/// A core holding both loaded machines and the last-seen one, with its focus on the LOCAL project
/// P1, which is where the live store's focus stays while a remote row has focus.
/// `last_seen_live` streams the third machine instead, which is the mutant's store.
fn seeded_core(last_seen_live: bool) -> Core {
    let mut core = Core::new();
    for (machine, server_id) in [
        (MachineId::Local, "local"),
        (MachineId::Remote(MACHINE.to_string()), "remote-a"),
        (MachineId::Remote(OTHER_MACHINE.to_string()), "remote-b"),
    ] {
        core.handle_raw_frame(machine, &snapshot(server_id).to_string(), NOW_MS)
            .expect("the frame parses");
    }
    let last_seen = MachineId::Remote(LAST_SEEN_MACHINE.to_string());
    let stored = snapshot("remote-c");
    match last_seen_live {
        true => {
            core.handle_raw_frame(last_seen, &stored.to_string(), NOW_MS)
                .expect("the frame parses");
        }
        false => {
            core.seed_last_seen_presentation(
                &last_seen,
                serde_json::from_value(stored["snapshot"].clone()).expect("the snapshot parses"),
            );
        }
    }
    let mut focus = FocusState::default();
    focus.active_project = Some(ProjectKey {
        machine: MachineId::Local,
        project_id: "P1".to_string(),
    });
    focus.active_group = ActiveGroup::parse_sidebar_group_id(LOCAL_GROUP);
    core.restore_focus(focus);
    core
}

/// The presentation both halves are given: one project with two rows (one with an agent, one
/// without), a second project, and a chat project.
fn presentation_json() -> Value {
    json!({
        "projects": [
            project("R1", "/tmp/R1"),
            project("R2", "/tmp/R2"),
            project("R-chat", "/Users/x/.ghostex/chats/R-chat"),
        ],
        "groups": [group("R1"), group("R2"), group("R-chat")],
        "sessions": [
            session("R1", "RS1", Some("claude")),
            session("R1", "RS2", None),
            session("R1", "RS3", Some("")),
            session("R1", "RS4", Some("   ")),
            session("R2", "R2S1", Some("codex")),
            session("R-chat", "CS1", Some("claude")),
        ],
    })
}

fn snapshot(server_id: &str) -> Value {
    let presentation = presentation_json();
    json!({
        "type": "presentationSnapshot",
        "protocolVersion": ghostex_gx_core::protocol::GXSERVER_PROTOCOL_VERSION,
        "serverId": server_id,
        "revision": 1,
        "snapshot": {
            "revision": 1,
            "generatedAt": "2026-09-21T00:00:00.000Z",
            "projects": presentation["projects"],
            "groups": presentation["groups"],
            "sessions": presentation["sessions"],
        }
    })
}

fn project(project_id: &str, path: &str) -> Value {
    json!({
        "projectId": project_id,
        "title": project_id,
        "path": path,
        "pathState": "available",
        "groupIds": [format!("{project_id}:active")],
        "sortKey": format!("1:{project_id}"),
        "createdAt": "2026-06-29T13:10:42.091Z",
        "updatedAt": "2026-09-15T01:18:43.055Z",
    })
}

fn group(project_id: &str) -> Value {
    let sessions: Vec<&str> = match project_id {
        "R1" => vec!["RS1", "RS2", "RS3", "RS4"],
        "R2" => vec!["R2S1"],
        _ => vec!["CS1"],
    };
    json!({
        "groupId": format!("{project_id}:active"),
        "projectId": project_id,
        "title": "Active",
        "sessionIds": sessions,
        "sortKey": format!("1:{project_id}:active"),
    })
}

fn session(project_id: &str, session_id: &str, agent_id: Option<&str>) -> Value {
    let mut row = json!({
        "sessionId": session_id,
        "projectId": project_id,
        "groupId": format!("{project_id}:active"),
        "kind": "agent",
        "surface": "workspace",
        "zmxName": format!("S90-{session_id}"),
        "sortKey": format!("000000000000:0:1:{session_id}"),
        "visibleInSidebarByDefault": true,
        "alias": format!("Session {session_id}"),
        "activity": "idle",
        "lifecycleState": "running",
        "lastInteractionAt": "2026-09-15T01:18:43.055Z",
        "createdAt": "2026-09-15T01:00:00.000Z",
        "updatedAt": "2026-09-15T01:18:43.055Z",
    });
    if let Some(agent_id) = agent_id {
        row["agentId"] = Value::String(agent_id.to_string());
    }
    row
}
