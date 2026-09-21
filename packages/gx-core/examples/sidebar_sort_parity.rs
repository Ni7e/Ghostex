//! The Rust half of the sort gate: what the store answers for the More menu's two sort rows,
//! `sortManual` and `sortLastActivity`, under every combination of the inputs that make the drawn
//! rows differ from the stored ones.
//!
//! The planner asked is `plan_open_action`, the one function the desktop host calls
//! (`gx_store/sidebar_open.rs`), with the TOP-LEVEL renderer command the controller receives. The
//! store is BUILT: this computer with a project whose rows a tag filter hides and a second project
//! that is hidden, and a second machine with its own project. Every view is drawn by the real
//! `SidebarViewModel` so the dump also says how many rows the view drew against how many the store
//! holds; the TypeScript half asserts the same gap on its side, so a scenario in which the drawn
//! and the stored rows agree cannot pass as coverage.
//!
//!   cargo run --release --example sidebar_sort_parity -- <out-dir>   # from packages/gx-core
//!   bun tooling/gx-core/sort-parity.ts compare <out-dir> [--inject <mutation>]

use std::process::ExitCode;

use ghostex_gx_core::{
    plan_open_action, Core, MachineId, SessionSortMode, SidebarInputs, SidebarViewModel,
};
use serde_json::{json, Value};

const NOW_MS: u64 = 1_790_000_000_000;
const REMOTE: &str = "remote-ab12";

fn main() -> ExitCode {
    let out_dir = std::env::args().nth(1).unwrap_or_default();
    if out_dir.is_empty() {
        eprintln!("usage: sidebar_sort_parity <out-dir>");
        return ExitCode::from(2);
    }
    let mut core = Core::new();
    core.handle_raw_frame(
        MachineId::Local,
        &frame(&snapshot(&["P1", "P2"])).to_string(),
        NOW_MS,
    )
    .expect("the local frame parses");
    let last = core
        .handle_raw_frame(
            MachineId::Remote(REMOTE.to_string()),
            &frame(&snapshot(&["R1"])).to_string(),
            NOW_MS,
        )
        .expect("the remote frame parses");
    let stored_rows = 3 * ROWS.len();

    let mut entries = Vec::new();
    for machine in ["local", REMOTE] {
        for tag_filter in [None, Some("favorite")] {
            for hidden in [None, Some("combined-project:P2")] {
                for sort_mode in [SessionSortMode::LastActivity, SessionSortMode::Manual] {
                    let mut inputs = SidebarInputs::default();
                    inputs.ui.selected_machine_id = machine.to_string();
                    if let Some(tag) = tag_filter {
                        inputs.ui.selected_tag_filters = vec![tag.to_string()];
                    }
                    if let Some(group_id) = hidden {
                        inputs.ui.hidden_items.group_ids = vec![group_id.to_string()];
                    }
                    inputs.settings.sort_mode = sort_mode;
                    let mut model = SidebarViewModel::new();
                    model.update(&core, &inputs, &last.changes, NOW_MS);
                    let view = model.view();
                    let drawn_rows: usize = view
                        .groups
                        .iter()
                        .map(|group| group.core.sessions.len())
                        .sum();
                    for action in ["sortManual", "sortLastActivity"] {
                        let command = json!({ "type": "sidebarAction", "action": action });
                        let plan = plan_open_action(view, &command);
                        entries.push(json!({
                            "machine": machine,
                            "tagFilter": tag_filter,
                            "hiddenGroup": hidden,
                            "sortMode": match sort_mode {
                                SessionSortMode::Manual => "manual",
                                SessionSortMode::LastActivity => "lastActivity",
                            },
                            "drawnGroups": view.groups.len(),
                            "drawnRows": drawn_rows,
                            "storedRows": stored_rows,
                            "command": command,
                            "owned": plan.is_some(),
                            "calls": plan.map(|plan| plan.to_json()).unwrap_or(Value::Null),
                        }));
                    }
                }
            }
        }
    }
    let path = std::path::Path::new(&out_dir).join("sort-rust.json");
    if let Err(error) = std::fs::create_dir_all(&out_dir).and_then(|()| {
        std::fs::write(
            &path,
            serde_json::to_string(&json!({ "entries": entries })).unwrap(),
        )
    }) {
        eprintln!("could not write {}: {error}", path.display());
        return ExitCode::from(1);
    }
    println!("{} sort entries -> {}", entries.len(), path.display());
    ExitCode::SUCCESS
}

/// Every project's rows: three terminal rows, one pinned and one tagged `favorite`, so the
/// `favorite` filter hides two of every three.
const ROWS: [(&str, &str, bool); 3] = [
    ("A", "2026-09-15T01:18:43.055Z", false),
    ("B", "2026-09-15T02:18:43.055Z", false),
    ("C", "2026-09-15T00:18:43.055Z", true),
];

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
    let sessions: Vec<Value> = projects
        .iter()
        .flat_map(|project| {
            ROWS.iter().map(move |(id, last, pinned)| {
                json!({
                    "sessionId": id,
                    "projectId": project,
                    "groupId": format!("{project}:active"),
                    "kind": "agent",
                    "surface": "workspace",
                    "zmxName": format!("S90-{project}-{id}"),
                    "sortKey": format!("000{id}"),
                    "visibleInSidebarByDefault": true,
                    "alias": format!("Session {id}"),
                    "activity": "idle",
                    "pendingQuestionCount": 0,
                    "lifecycleState": "running",
                    "isPinned": pinned,
                    "sessionTag": if *id == "B" { Value::from("favorite") } else { Value::Null },
                    "lastInteractionAt": last,
                    "createdAt": "2026-09-01T01:00:00.000Z",
                    "updatedAt": last,
                })
            })
        })
        .collect();
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
            "sessionIds": ROWS.iter().map(|(row, _, _)| *row).collect::<Vec<_>>(),
            "sortKey": format!("1:{id}:active"),
        })).collect::<Vec<_>>(),
        "sessions": sessions,
    })
}
