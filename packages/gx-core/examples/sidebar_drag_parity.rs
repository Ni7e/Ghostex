//! The gate for the session moves: what a drag posts, and what those posts write.
//!
//! **The recording cannot supply these cases.** It holds no drags at all and one fixed order, so
//! the presentation here is BUILT, and it is built to reach the cases a real recording never does:
//! a drop at the top, at the bottom, onto the row a session already sits next to (a no-op), across
//! a rule the code forbids (a pinned row onto an unpinned one, an unpinned row while the sort mode
//! is not Manual), into and out of a user-made group, onto a row of a THIRD group, onto a remote
//! group, and, most of all, a drag where rows the projection filtered out sit between the source
//! and the destination. **A DRAWN INDEX IS NOT A STORED INDEX**: the sessions the sidebar draws are
//! the membership sorted, sectioned and tag-filtered, and a port that computed an insert point
//! against them would save an order the user never saw. The probe therefore records BOTH lists and
//! counts the cases where they disagree, so a run in which they never do fails instead of passing.
//!
//! Every case is recorded step by step, not as a final state: the failure mode of an order write is
//! oscillation, and a sequence that ends right after going wrong in the middle is the bug.
//!
//!   cargo run --release --example sidebar_drag_parity -- <out-dir>
//!   bun tooling/gx-core/action-parity.ts drag <out-dir>

use std::process::ExitCode;

use ghostex_gx_core::{
    plan_order_write, plan_session_move, sidebar_group_membership, Core, MachineId,
    SessionSortMode, SidebarInputs, SidebarViewModel, WorkspaceGroupsDocument,
};
use serde_json::{json, Value};

const NOW_MS: u64 = 1_790_000_000_000;
const REMOTE: &str = "remote-ab12";

fn main() -> ExitCode {
    let out_dir = std::env::args().nth(1).unwrap_or_default();
    if out_dir.is_empty() {
        eprintln!("usage: sidebar_drag_parity <out-dir>");
        return ExitCode::from(2);
    }
    let core = build_core();
    let start_document = document();

    let mut cases = Vec::new();
    let mut drawn_differs = 0usize;
    for (variant, inputs) in variants() {
        for command in commands() {
            let case = run_move(&core, &inputs, &start_document, &command, variant);
            if case["membershipDiffersFromDrawn"] == Value::Bool(true) {
                drawn_differs += 1;
            }
            cases.push(case);
        }
    }
    let mut creates = Vec::new();
    for session_id in every_session_id() {
        for (label, document) in [("open", document()), ("atTheLimit", full_document())] {
            let message = json!({ "type": "createGroupFromSession", "sessionId": session_id });
            let plan = plan_order_write(&document, &message);
            creates.push(json!({
                "label": label,
                "sessionId": session_id,
                "message": message,
                "writes": plan.as_ref().map(|plan| plan.to_json()),
                "refusal": plan.as_ref().and_then(|plan| plan.refusal),
                "handedOff": plan.is_none(),
            }));
        }
    }

    let inputs_manual = inputs(SessionSortMode::Manual);
    let dump = json!({
        "scenario": scenario(&core, &inputs_manual),
        "document": start_document.to_json(),
        "fullDocument": full_document().to_json(),
        "cases": cases,
        "creates": creates,
    });
    let path = std::path::Path::new(&out_dir).join("rust-drag.json");
    if let Err(error) = std::fs::write(&path, serde_json::to_string(&dump).expect("serialize")) {
        eprintln!("write {}: {error}", path.display());
        return ExitCode::FAILURE;
    }
    println!(
        "drag probe: {} move cases, {} create cases, {drawn_differs} cases where the membership and the drawn list differ, written to {}",
        dump["cases"].as_array().map(Vec::len).unwrap_or(0),
        dump["creates"].as_array().map(Vec::len).unwrap_or(0),
        path.display()
    );
    // A run in which the membership never differs from the drawn list has not asked the question
    // this probe exists for, so it fails rather than reporting a clean sweep.
    if drawn_differs == 0 {
        eprintln!("the membership never differed from the drawn list: the probe measured nothing");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}

/// One drag, and then what each message it posts writes, recorded after every step.
fn run_move(
    core: &Core,
    inputs: &SidebarInputs,
    document: &WorkspaceGroupsDocument,
    command: &Value,
    variant: &str,
) -> Value {
    let plan = plan_session_move(core, inputs, command);
    let mut held = document.clone();
    let mut steps = Vec::new();
    for message in plan.iter().flat_map(|plan| plan.messages.iter()) {
        let write = plan_order_write(&held, message);
        if let Some(write) = &write {
            for entry in &write.writes {
                if let ghostex_gx_core::OrderWrite::EditDocument { document } = entry {
                    held = document.clone();
                }
            }
        }
        steps.push(json!({
            "message": message,
            "writes": write.as_ref().map(|write| write.to_json()),
            "refusal": write.as_ref().and_then(|write| write.refusal),
            "handedOff": write.is_none(),
            // What the user is looking at after this step.
            "document": held.to_json(),
        }));
    }
    let group_id = command["groupId"].as_str().unwrap_or_default();
    let membership = membership_of(core, inputs, group_id);
    let drawn = drawn_of(core, inputs, group_id);
    json!({
        "variant": variant,
        "command": command,
        // What the document was before this case, so a mutation can ask whether a write changed
        // anything at all. The shipped code writes either way; that is the point.
        "startDocument": document.to_json(),
        "messages": plan.as_ref().map(|plan| plan.messages.clone()),
        "refusal": plan.as_ref().and_then(|plan| plan.refusal),
        "handedOff": plan.is_none(),
        "steps": steps,
        // Recorded, not asserted: the harness counts how often the two lists disagree, because a
        // scenario in which they never do cannot tell the two implementations apart.
        "membership": membership,
        "drawn": drawn,
        "membershipDiffersFromDrawn": membership != drawn,
    })
}

/// Every `moveSession` payload the cases need: each source row, each target group, each hovered
/// row (and none), both positions.
fn commands() -> Vec<Value> {
    let mut commands = Vec::new();
    for session_id in every_session_id() {
        for group_id in target_group_ids() {
            for target_session_id in [
                None,
                Some(local_session("P1", "S1")),
                Some(local_session("P1", "S3")),
                Some(local_session("P1", "S5")),
                Some(local_session("P2", "T1")),
            ] {
                for position in ["before", "after"] {
                    let mut command = json!({
                        "type": "moveSession",
                        "sessionId": session_id,
                        "groupId": group_id,
                        "position": position,
                    });
                    if let Some(target_session_id) = target_session_id.clone() {
                        command["targetSessionId"] = Value::String(target_session_id);
                    }
                    commands.push(command);
                }
            }
        }
    }
    commands
}

fn every_session_id() -> Vec<String> {
    let mut ids: Vec<String> = ["S1", "S2", "S3", "S4", "S5", "S6", "S7"]
        .iter()
        .map(|id| local_session("P1", id))
        .collect();
    ids.push(local_session("P2", "T1"));
    ids.push(format!("remote:{REMOTE}:session:R1:RS1"));
    ids
}

fn target_group_ids() -> Vec<String> {
    vec![
        "combined-project:P1".to_string(),
        "combined-project:P2".to_string(),
        subgroup_id("P1", "group-2"),
        subgroup_id("P1", "group-9"),
        format!("remote:{REMOTE}:group:R1"),
        "combined-chats".to_string(),
    ]
}

fn local_session(project_id: &str, session_id: &str) -> String {
    format!("combined-session:{project_id}:{session_id}")
}

fn subgroup_id(project_id: &str, group_id: &str) -> String {
    format!("gpui-wsg:{project_id}:{group_id}")
}

/// The document the cases start from: one user-made group of P1 holding two of its rows.
fn document() -> WorkspaceGroupsDocument {
    WorkspaceGroupsDocument::parse(&json!({
        "projectOrder": ["P1", "P2"],
        "projects": {
            "P1": {
                "groups": [{ "groupId": "group-2", "sessionIds": ["S4", "S5"], "title": "Group 2" }],
                "nextGroupNumber": 3,
            }
        },
    }))
}

/// A project already at `GPUI_WORKSPACE_SESSION_GROUP_MAX_COUNT`, so `createGroupFromSession`
/// reaches the toast leg. The limit is the only branch of that action that writes nothing, and no
/// recording has ever reached it.
fn full_document() -> WorkspaceGroupsDocument {
    let groups: Vec<Value> = (2..=20)
        .map(|number| {
            json!({
                "groupId": format!("group-{number}"),
                "sessionIds": [],
                "title": format!("Group {number}"),
            })
        })
        .collect();
    WorkspaceGroupsDocument::parse(&json!({
        "projectOrder": ["P1", "P2"],
        "projects": { "P1": { "groups": groups, "nextGroupNumber": 21 } },
    }))
}

/// The three states the same drag is asked in. The third is the one a recording can never supply:
/// a tag filter hiding a row that sits BETWEEN the source and the destination, which is where a
/// port that used the drawn list saves an order the user never saw.
fn variants() -> Vec<(&'static str, SidebarInputs)> {
    let mut filtered = inputs(SessionSortMode::Manual);
    filtered.ui.selected_tag_filters = vec!["favorite".to_string()];
    vec![
        ("manual", inputs(SessionSortMode::Manual)),
        ("lastActivity", inputs(SessionSortMode::LastActivity)),
        ("manualTagFiltered", filtered),
    ]
}

fn inputs(sort_mode: SessionSortMode) -> SidebarInputs {
    let mut inputs = SidebarInputs::default();
    inputs.ui.selected_machine_id = "local".to_string();
    inputs.settings.sort_mode = sort_mode;
    inputs
}

/// The membership of a group, taken from the planner's own inventory rather than described beside
/// it, so the record cannot drift from the list that decided the move.
fn membership_of(core: &Core, inputs: &SidebarInputs, group_id: &str) -> Vec<String> {
    sidebar_group_membership(core, inputs, group_id).unwrap_or_default()
}

/// The list the sidebar DRAWS for the group, which is the membership sorted into sections and
/// filtered. Recorded so the harness can count how far the two are apart.
fn drawn_of(core: &Core, inputs: &SidebarInputs, group_id: &str) -> Vec<String> {
    let view = SidebarViewModel::build_from_scratch(core, inputs, NOW_MS);
    view.group(group_id)
        .map(|group| {
            group
                .core
                .sessions
                .iter()
                .map(|session| session.row.sidebar_session_id.clone())
                .collect()
        })
        .unwrap_or_default()
}

/// The presentation the TypeScript half is handed, so both sides start from the same rows.
fn scenario(core: &Core, inputs: &SidebarInputs) -> Value {
    json!({
        "snapshot": snapshot(),
        "remoteSnapshot": remote_snapshot(),
        "drawnByGroup": target_group_ids()
            .iter()
            .map(|group_id| (group_id.clone(), Value::from(drawn_of(core, inputs, group_id))))
            .collect::<serde_json::Map<_, _>>(),
    })
}

fn build_core() -> Core {
    let mut core = Core::new();
    core.handle_raw_frame(
        MachineId::Local,
        &json!({
            "type": "presentationSnapshot",
            "protocolVersion": ghostex_gx_core::protocol::GXSERVER_PROTOCOL_VERSION,
            "serverId": "local",
            "revision": 1,
            "snapshot": snapshot(),
        })
        .to_string(),
        NOW_MS,
    )
    .expect("the local frame parses");
    core.handle_raw_frame(
        MachineId::Remote(REMOTE.to_string()),
        &json!({
            "type": "presentationSnapshot",
            "protocolVersion": ghostex_gx_core::protocol::GXSERVER_PROTOCOL_VERSION,
            "serverId": "remote",
            "revision": 1,
            "snapshot": remote_snapshot(),
        })
        .to_string(),
        NOW_MS,
    )
    .expect("the remote frame parses");
    core
}

/// Two local projects. P1 holds seven rows and three of them exist to move the two lists apart:
/// S6 is on the commands surface and S7 is not listed in the sidebar by default, so neither is in
/// the MEMBERSHIP at all, and S2 is pinned, so the drawn list leads with it while the membership
/// keeps the daemon's order.
fn snapshot() -> Value {
    let rows: Vec<Value> = [
        ("S1", true, "workspace", true),
        ("S2", true, "workspace", true),
        ("S3", false, "workspace", true),
        ("S4", false, "workspace", true),
        ("S5", false, "workspace", true),
        ("S6", false, "commands", true),
        ("S7", false, "workspace", false),
    ]
    .iter()
    .map(|(id, pinned, surface, listed)| session("P1", id, *pinned, surface, *listed))
    .chain([session("P2", "T1", false, "workspace", true)])
    .chain([session("P2", "T2", false, "workspace", true)])
    .collect();
    json!({
        "revision": 1,
        "generatedAt": "2026-09-21T00:00:00.000Z",
        "projects": [project("P1"), project("P2")],
        "groups": [
            group("P1", &["S3", "S6", "S1", "S7", "S2", "S4", "S5"]),
            group("P2", &["T1", "T2"]),
        ],
        "sessions": rows,
        "workspaceGroups": document().to_side_state(),
    })
}

fn remote_snapshot() -> Value {
    json!({
        "revision": 1,
        "generatedAt": "2026-09-21T00:00:00.000Z",
        "projects": [project("R1")],
        "groups": [group("R1", &["RS1"])],
        "sessions": [session("R1", "RS1", false, "workspace", true)],
    })
}

fn project(project_id: &str) -> Value {
    json!({
        "projectId": project_id,
        "title": project_id,
        "path": format!("/tmp/{project_id}"),
        "pathState": "available",
        "groupIds": [format!("{project_id}:active")],
        "sortKey": format!("1:{project_id}"),
        "createdAt": "2026-06-29T13:10:42.091Z",
        "updatedAt": "2026-09-15T01:18:43.055Z",
    })
}

fn group(project_id: &str, session_ids: &[&str]) -> Value {
    json!({
        "groupId": format!("{project_id}:active"),
        "projectId": project_id,
        "title": "Active",
        "sessionIds": session_ids,
        "sortKey": format!("1:{project_id}:active"),
    })
}

fn session(
    project_id: &str,
    session_id: &str,
    is_pinned: bool,
    surface: &str,
    visible_in_sidebar: bool,
) -> Value {
    json!({
        "sessionId": session_id,
        "projectId": project_id,
        "groupId": format!("{project_id}:active"),
        "kind": "agent",
        "surface": surface,
        "zmxName": format!("S90-{session_id}"),
        // The daemon's array order is the byte order of this key, and the membership follows the
        // GROUP's `sessionIds`, so the two are deliberately not the same order here.
        "sortKey": format!("000000000000:0:{}:{session_id}", if is_pinned { "0" } else { "2" }),
        "visibleInSidebarByDefault": visible_in_sidebar,
        "isPinned": is_pinned,
        "alias": format!("Session {session_id}"),
        "sessionTag": if session_id == "S3" || session_id == "T1" { Some("favorite") } else { None::<&str> },
        "activity": "idle",
        "lifecycleState": "running",
        "lastInteractionAt": "2026-09-15T01:18:43.055Z",
        "createdAt": "2026-09-15T01:00:00.000Z",
        "updatedAt": "2026-09-15T01:18:43.055Z",
    })
}
