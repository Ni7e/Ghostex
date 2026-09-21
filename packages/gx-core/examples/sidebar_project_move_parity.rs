//! The gate for the PROJECT moves: reorder, a project into and out of a collection, and Space
//! membership.
//!
//! **The recording cannot supply these cases.** It holds no drags at all, so the presentation here
//! is BUILT, and it is built at the user's real scale, because a synthetic fixture smaller than
//! their configuration has missed real bugs in this port before: 35 projects, 7 worktrees under 3
//! parents, 3 collections, 7 Spaces, and user-made groups on projects that are dragged, so a
//! project carries its groups with it.
//!
//! **A DRAWN INDEX IS NOT A STORED INDEX**, and for these moves the list is `groupOrder`: every
//! group the projection built, before a Space, a tag filter or Show Hidden took anything off
//! screen. A port that spliced into the drawn rows would save an order the user never saw. Both
//! lists are recorded for every case and the run FAILS if they never disagree, because a scenario
//! in which they agree cannot tell the two implementations apart.
//!
//! **Every case is recorded step by step.** One gesture writes up to three documents in order (the
//! collections document, the Spaces document, the project order), and the failure mode of an order
//! write is oscillation: a sequence that ends right after going wrong in the middle is the bug, so
//! the document after EVERY write is in the dump rather than only the last one.
//!
//!   cargo run --release --example sidebar_project_move_parity -- <out-dir>
//!   bun tooling/gx-core/project-drag-parity.ts <out-dir>

use std::process::ExitCode;

use ghostex_gx_core::{
    plan_project_move, plan_project_order_write, sidebar_project_group_order, CollectionsDocument,
    Core, Event, Intent, MachineId, ProjectWrite, SideStateUpdate, SidebarInputs, SidebarViewModel,
    SpacesDocument, WorkspaceGroupsDocument,
};
use serde_json::{json, Value};

const NOW_MS: u64 = 1_790_000_000_000;
/// The clock a created collection's id carries. Fixed, so both halves mint the same id.
const CREATE_MS: i64 = 1_790_000_000_000;

/// Which projects are worktrees, and of whom. The user uses worktrees heavily, so three families:
/// a parent with two, a parent with one, and a parent with three.
const WORKTREES: &[(&str, &str)] = &[
    ("P01", "P00"),
    ("P02", "P00"),
    ("P11", "P10"),
    ("P21", "P20"),
    ("P22", "P20"),
    ("P23", "P20"),
    // A worktree of a worktree, so the family walk has something to walk.
    ("P24", "P21"),
];

/// Projects with user-made session groups, which a project drag has to carry with it.
const SUBGROUPED: &[&str] = &["P00", "P10", "P30"];

fn main() -> ExitCode {
    let out_dir = std::env::args().nth(1).unwrap_or_default();
    if out_dir.is_empty() {
        eprintln!("usage: sidebar_project_move_parity <out-dir>");
        return ExitCode::from(2);
    }
    let mut cases = Vec::new();
    let mut order_differs = 0usize;
    let mut writes_total = 0usize;
    let mut refusals = 0usize;
    let mut hand_offs = 0usize;
    let mut collection_edits = 0usize;
    let mut space_edits = 0usize;
    let mut order_writes = 0usize;
    let mut empties = 0usize;
    let mut remote_loaded_orders = 0usize;
    for (variant, inputs) in variants() {
        let core = match variant {
            "remoteLoaded" => build_core_with_remote_machine(),
            _ => build_core(),
        };
        let stored = sidebar_project_group_order(&core, &inputs).unwrap_or_default();
        let drawn = drawn_order(&core, &inputs);
        for command in commands() {
            let case = run_case(&core, &inputs, &command, variant, &stored, &drawn);
            if case["orderDiffersFromDrawn"] == Value::Bool(true) {
                order_differs += 1;
            }
            if case["handedOff"] == Value::Bool(true) {
                hand_offs += 1;
            }
            if case["refusal"].is_string() {
                refusals += 1;
            }
            for step in case["steps"].as_array().into_iter().flatten() {
                writes_total += 1;
                match step["write"]["write"].as_str() {
                    Some("editCollections") => {
                        collection_edits += 1;
                        if step["collectionsEmptied"] == Value::Bool(true) {
                            empties += 1;
                        }
                    }
                    Some("editSpaces") => space_edits += 1,
                    Some("groupOrder") => {
                        order_writes += 1;
                        if variant == "remoteLoaded" {
                            remote_loaded_orders += 1;
                        }
                    }
                    _ => {}
                }
            }
            cases.push(case);
        }
    }
    let launch = launch_cases();
    let counter = monotonic_cases();

    let dump = json!({
        "scenario": scenario(),
        "collections": collections_document().to_storage_json(),
        "spaces": spaces_document().to_wire_json(),
        "document": workspace_document().to_json(),
        "createMs": CREATE_MS,
        "cases": cases,
        "launch": launch,
        "monotonic": counter,
    });
    let path = std::path::Path::new(&out_dir).join("rust-project-move.json");
    if let Err(error) = std::fs::write(&path, serde_json::to_string(&dump).expect("serialize")) {
        eprintln!("write {}: {error}", path.display());
        return ExitCode::FAILURE;
    }
    println!(
        "project move probe: {} cases, {writes_total} writes ({collection_edits} collections, {space_edits} spaces, {order_writes} orders), {refusals} refusals, {hand_offs} hand-offs, {empties} collections emptied, {order_differs} cases where the stored order differs from the drawn one, {} launch cases, {} counter cases, written to {}",
        dump["cases"].as_array().map(Vec::len).unwrap_or(0),
        dump["launch"].as_array().map(Vec::len).unwrap_or(0),
        dump["monotonic"].as_array().map(Vec::len).unwrap_or(0),
        path.display()
    );
    // Every one of these is a coverage counter, and a clean run whose coverage is zero has measured
    // nothing. The order/drawn one is the reason this probe exists at all.
    let zeroes: Vec<&str> = [
        ("orderDiffers", order_differs),
        ("collectionEdits", collection_edits),
        ("spaceEdits", space_edits),
        ("orderWrites", order_writes),
        ("refusals", refusals),
        ("handOffs", hand_offs),
        ("collectionsEmptied", empties),
        // A local drag with a remote machine connected writes its order: the refusal this replaced
        // handed every one of them to a TypeScript path that saves no order at all then.
        ("remoteLoadedOrders", remote_loaded_orders),
    ]
    .iter()
    .filter(|(_, value)| *value == 0)
    .map(|(name, _)| *name)
    .collect();
    if !zeroes.is_empty() {
        eprintln!(
            "coverage counters that stayed at zero: {}",
            zeroes.join(", ")
        );
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}

/// One project move, and the document each of its writes leaves behind.
fn run_case(
    core: &Core,
    inputs: &SidebarInputs,
    command: &Value,
    variant: &'static str,
    stored: &[String],
    drawn: &[String],
) -> Value {
    let mut collections = collections_document();
    let mut spaces = spaces_document();
    let mut document = workspace_document();
    let plan = plan_project_move(
        core,
        inputs,
        &collections,
        spaces_input(inputs, &spaces),
        command,
        CREATE_MS,
    );
    let mut steps = Vec::new();
    for write in plan.iter().flat_map(|plan| plan.writes.iter()) {
        let before = collections.state.collections.len();
        match write {
            ProjectWrite::EditCollections { document } => collections = document.clone(),
            ProjectWrite::EditSpaces { document } => spaces = document.clone(),
            ProjectWrite::GroupOrder { group_ids } => {
                let message = json!({ "type": "syncGroupOrder", "groupIds": group_ids });
                if let Some(plan) = plan_project_order_write(core, inputs, &document, &message) {
                    for entry in &plan.writes {
                        if let ghostex_gx_core::OrderWrite::EditDocument { document: next } = entry
                        {
                            document = next.clone();
                        }
                    }
                }
            }
            _ => {}
        }
        steps.push(json!({
            "write": write.to_json(),
            // What is held after this step, so a sequence that goes wrong in the middle and comes
            // back is visible instead of hidden by its final state.
            "collections": collections.to_storage_json(),
            "spaces": spaces.to_wire_json(),
            "document": document.to_json(),
            "collectionsEmptied": collections.state.collections.len() < before,
        }));
    }
    json!({
        "variant": variant,
        "command": command,
        "writes": plan.as_ref().map(|plan| plan.to_json()),
        "refusal": plan.as_ref().and_then(|plan| plan.refusal),
        "handedOff": plan.is_none(),
        "steps": steps,
        // Recorded, not asserted: the harness counts how often the two disagree, and the probe
        // fails when they never do.
        "storedOrder": stored,
        "drawnOrder": drawn,
        "orderDiffersFromDrawn": stored != drawn,
    })
}

/// `section.spacesState`: the metadata entry, which is absent until an echo or an edit sets it.
fn spaces_input<'a>(
    inputs: &SidebarInputs,
    spaces: &'a SpacesDocument,
) -> Option<&'a SpacesDocument> {
    let _ = inputs;
    Some(spaces)
}

/// Every payload the cases need. Built by name rather than by a full cross product, because the
/// interesting pairs are named ones: the top, the bottom, a row's own position, the middle of a
/// collection, out of one, between two, a hidden collection, and a worktree family.
fn commands() -> Vec<Value> {
    let mut commands = Vec::new();
    let sources = [
        // A parent project that is in a collection AND has worktrees AND has user-made groups.
        "combined-project:P00",
        // One of its worktrees, which may only move inside its own family.
        "combined-project:P01",
        // A worktree of a worktree.
        "combined-project:P24",
        // An ungrouped project.
        "combined-project:P15",
        // The only project of a collection, so moving it out empties the collection.
        "combined-project:P34",
        // A project inside the HIDDEN collection.
        "combined-project:P30",
        // A user-made group, which is a row of `groupOrder` with its project's id.
        "gpui-wsg:P10:group-2",
        // The Chats collection, which has no project at all.
        "combined-chats",
        // A group the list has no row for.
        "combined-project:NOPE",
    ];
    let targets = [
        "combined-project:P00",
        "combined-project:P01",
        // The TOP of the order and the BOTTOM of it.
        "combined-project:P03",
        "combined-project:P34",
        // The middle of a collection, which is where a drop JOINS it.
        "combined-project:P12",
        // Another collection.
        "combined-project:P05",
        // Inside the hidden collection.
        "combined-project:P30",
        // A worktree of a THIRD family.
        "combined-project:P22",
        "combined-chats",
    ];
    for source in sources {
        for target in targets {
            for position in ["before", "after"] {
                commands.push(json!({
                    "type": "moveGroup",
                    "groupId": source,
                    "targetGroupId": target,
                    "position": position,
                }));
            }
        }
        // Into each collection, and out of every collection.
        for collection in [
            Some("C1"),
            Some("C2"),
            Some("C3"),
            Some("C4"),
            Some("NOPE"),
            None,
        ] {
            let mut command = json!({
                "type": "moveToCollection",
                "sourceKind": "group",
                "sourceId": source,
            });
            if let Some(collection) = collection {
                command["collectionId"] = Value::from(collection);
            }
            commands.push(command);
        }
        // Onto a Space button, onto the built-in Other view, and onto one that is not there.
        for space in ["space-1", "space-4", "space-7", "other", "space-nope"] {
            commands.push(json!({
                "type": "moveToSpace",
                "sourceKind": "group",
                "sourceId": source,
                "spaceId": space,
            }));
        }
        // The membership menu items, which reach the same documents from a menu rather than a drag.
        commands.push(json!({
            "type": "projectMembership",
            "groupId": source,
            "action": "createCollection",
        }));
        commands.push(json!({
            "type": "projectMembership",
            "groupId": source,
            "action": "moveCollection",
            "collectionId": "C2",
        }));
        commands.push(
            json!({ "type": "projectMembership", "groupId": source, "action": "moveCollection" }),
        );
        commands.push(json!({ "type": "projectMembership", "groupId": source, "action": "hide" }));
    }
    // A whole collection dragged, including onto itself, which is the case whose targets all move
    // out with the source and therefore leaves no index at all.
    for source in ["C1", "C2", "C3", "C4", "NOPE"] {
        for (kind, target) in [
            ("group", "combined-project:P15"),
            ("group", "combined-project:P00"),
            ("collection", "C1"),
            ("collection", "C2"),
        ] {
            for position in ["before", "after"] {
                commands.push(json!({
                    "type": "moveCollection",
                    "sourceId": source,
                    "targetKind": kind,
                    "targetId": target,
                    "position": position,
                }));
            }
        }
        // A collection onto a Space, which carries the COLLECTION id as the member rather than the
        // projects, and which does NOT take the projects out of it.
        for space in ["space-2", "other"] {
            commands.push(json!({
                "type": "moveToSpace",
                "sourceKind": "collection",
                "sourceId": source,
                "spaceId": space,
            }));
        }
    }
    // A payload the planner cannot read at all, which is HANDED to the old runtime rather than
    // answered: a port that guessed a default would post an order the app never posts.
    commands.push(json!({ "type": "moveGroup", "groupId": "combined-project:P00", "targetGroupId": "combined-project:P03" }));
    commands.push(json!({ "type": "moveGroup", "groupId": "combined-project:P00", "targetGroupId": "combined-project:P03", "position": "sideways" }));
    commands.push(json!({ "type": "moveSpace", "spaceId": "space-1", "targetSpaceId": "space-3", "position": "after" }));
    // The Space buttons reordered, with the visible set both complete and overflowed, which is
    // where `applySidebarSpaceRowReorder` has to write back into non-contiguous slots.
    let visible_all: Vec<String> = (1..=7).map(|index| format!("space-{index}")).collect();
    let visible_some = vec![
        "space-1".to_string(),
        "space-3".to_string(),
        "space-6".to_string(),
    ];
    for visible in [visible_all, visible_some] {
        for space in ["space-1", "space-3", "space-6", "space-7"] {
            for target in ["space-1", "space-3", "space-6"] {
                for position in ["before", "after"] {
                    commands.push(json!({
                        "type": "moveSpace",
                        "spaceId": space,
                        "targetSpaceId": target,
                        "visibleSpaceIds": visible,
                        "position": position,
                    }));
                }
            }
        }
    }
    // The Spaces submenu's ticks, and New Space, for a project and for a collection.
    for space in [Some("space-1"), Some("space-5"), Some("space-nope"), None] {
        for member in [
            json!({ "projectId": "P15" }),
            json!({ "projectId": "P00" }),
            json!({ "collectionId": "C1" }),
            json!({}),
        ] {
            let mut command = json!({ "type": "spaceMembership" });
            if let Some(space) = space {
                command["spaceId"] = Value::from(space);
            }
            for (key, value) in member.as_object().expect("object") {
                command[key.as_str()] = value.clone();
            }
            commands.push(command);
        }
    }
    commands
}

/// The three states the same move is asked in. The second and the third are the ones a recording
/// can never supply: a filter that hides projects BETWEEN the source and the destination, which is
/// exactly where a port that used the drawn list would splice into the wrong slot.
fn variants() -> Vec<(&'static str, SidebarInputs)> {
    let mut tag_filtered = inputs(true);
    tag_filtered.ui.selected_tag_filters = vec!["favorite".to_string()];
    let mut space_filtered = inputs(true);
    space_filtered
        .ui
        .collapse
        .selected_space_by_section
        .insert("local".to_string(), "space-2".to_string());
    // The machine tab on a REMOTE machine, where every arm is handed to the old runtime because a
    // remote edit is a direct call down that machine's tunnel. Its own variant rather than a case,
    // because it is a property of the whole gesture and not of one payload.
    let mut remote_tab = inputs(true);
    remote_tab.ui.selected_machine_id = "remote-ab12".to_string();
    // THIS computer's tab with a remote machine CONNECTED, which is the user's configuration since
    // they enabled one. Its own store (`build_core_with_remote_machine`); the TypeScript half runs it
    // as a local tab with Spaces on, so a clean run says the connected machine changes nothing about
    // a local drag and the answer is the one the TypeScript gave while no remote machine was drawn.
    vec![
        ("spacesOn", inputs(true)),
        ("spacesOff", inputs(false)),
        ("tagFiltered", tag_filtered),
        ("spaceFiltered", space_filtered),
        ("remoteTab", remote_tab),
        ("remoteLoaded", inputs(true)),
    ]
}

fn inputs(spaces_enabled: bool) -> SidebarInputs {
    let mut inputs = SidebarInputs::default();
    inputs.ui.selected_machine_id = "local".to_string();
    inputs.settings.sidebar_spaces_enabled = spaces_enabled;
    // The hidden collection, which is hidden by its `<section key>:<collection id>` storage id.
    inputs.ui.hidden_items.collection_keys = vec!["local:C3".to_string()];
    inputs
}

/// The top-level rows the sidebar DRAWS, which is the stored order filtered and folded into
/// collections. Recorded so the harness can count how far the two are apart.
fn drawn_order(core: &Core, inputs: &SidebarInputs) -> Vec<String> {
    SidebarViewModel::build_from_scratch(core, inputs, NOW_MS)
        .groups
        .iter()
        .map(|group| group.core.group_id.clone())
        .collect()
}

/// **K5's empty-echo rule, built rather than hoped for.** An empty server document is pushed back
/// on the FIRST echo only, so the SECOND empty echo is adopted: that is how a user deleting their
/// last collection survives, and it is the one branch a fixture cannot reach by accident.
fn launch_cases() -> Vec<Value> {
    use ghostex_gx_core::DocumentSync;
    let non_empty = collections_document();
    let empty = CollectionsDocument::empty();
    let mut cases = Vec::new();
    for (label, stored, echoes) in [
        (
            "emptyServerTwice",
            non_empty.clone(),
            vec![empty.clone(), empty.clone()],
        ),
        (
            "emptyServerThenReal",
            non_empty.clone(),
            vec![empty.clone(), non_empty.clone()],
        ),
        (
            "realServerThenEmpty",
            non_empty.clone(),
            vec![non_empty.clone(), empty.clone()],
        ),
        ("emptyStoredEmptyServer", empty.clone(), vec![empty.clone()]),
        (
            "emptyStoredRealServer",
            empty.clone(),
            vec![non_empty.clone()],
        ),
    ] {
        let mut sync: DocumentSync<CollectionsDocument> = DocumentSync::default();
        sync.restore(stored.clone());
        let mut steps = Vec::new();
        for echo in echoes {
            let (outcome, _) = sync.adopt(Some(&echo.to_wire_json()));
            steps.push(json!({
                "echo": echo.to_wire_json(),
                "outcome": format!("{outcome:?}"),
                "held": sync.document().to_storage_json(),
                "pending": sync.is_pending(),
            }));
        }
        cases.push(json!({ "label": label, "stored": stored.to_storage_json(), "steps": steps }));
    }
    cases
}

/// **The monotonic counter, built rather than hoped for.** An echo whose `nextCollectionNumber` is
/// BEHIND the held one must not move it backwards, or the next folder the user makes reuses a name
/// that is already on screen.
fn monotonic_cases() -> Vec<Value> {
    use ghostex_gx_core::DocumentSync;
    let mut cases = Vec::new();
    for (label, held_number, echo_number) in [
        ("serverBehind", 9i64, 2i64),
        ("serverAhead", 2, 9),
        ("serverEqual", 4, 4),
        ("serverZero", 5, 0),
    ] {
        let mut sync: DocumentSync<CollectionsDocument> = DocumentSync::default();
        let mut held = collections_document();
        held.next_collection_number = held_number;
        sync.restore(held.clone());
        let mut echo = collections_document();
        echo.next_collection_number = echo_number;
        // A different collection title, so the echo is never equal and always reaches the merge.
        echo.state.collections[0].title = "Renamed".to_string();
        let (outcome, _) = sync.adopt(Some(&echo.to_wire_json()));
        let created = ghostex_gx_core::create_collection(sync.document(), "P15", CREATE_MS);
        cases.push(json!({
            "label": label,
            "held": held.to_storage_json(),
            "echo": echo.to_wire_json(),
            "outcome": format!("{outcome:?}"),
            "merged": sync.document().to_storage_json(),
            // The id, the title and the colour a NEW collection would take next, which is what the
            // counter is for and the only place it is visible to the user.
            "created": created.1.to_storage_json(),
        }));
    }
    cases
}

/// The presentation the TypeScript half is handed, so both sides start from the same rows.
fn scenario() -> Value {
    json!({ "snapshot": snapshot() })
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
    // The two documents the moves read come from the side state, exactly as they do in the app:
    // the host puts the held document there after every change, and the view model and the planner
    // then read the same copy.
    for update in [
        SideStateUpdate::ProjectCollections(
            serde_json::from_value(collections_document().to_wire_json()).expect("wire"),
        ),
        SideStateUpdate::Spaces(
            serde_json::from_value(spaces_document().to_wire_json()).expect("wire"),
        ),
    ] {
        core.handle(
            Event::Intent(Intent::SetSideState {
                machine: MachineId::Local,
                update: Box::new(update),
            }),
            NOW_MS,
        );
    }
    core
}

/// The same store with a remote machine connected and holding two projects of its own.
fn build_core_with_remote_machine() -> Core {
    let mut core = build_core();
    let ids = ["R00", "R01"];
    core.handle_raw_frame(
        MachineId::Remote("remote-ab12".to_string()),
        &json!({
            "type": "presentationSnapshot",
            "protocolVersion": ghostex_gx_core::protocol::GXSERVER_PROTOCOL_VERSION,
            "serverId": "remote",
            "revision": 1,
            "snapshot": {
                "revision": 1,
                "generatedAt": "2026-09-21T00:00:00.000Z",
                "projects": ids.iter().map(|id| project(id)).collect::<Vec<_>>(),
                "groups": ids.iter().map(|id| group(id)).collect::<Vec<_>>(),
                "sessions": ids
                    .iter()
                    .flat_map(|id| ["A", "B", "C"].map(|session_id| session(id, session_id, false)))
                    .collect::<Vec<_>>(),
            },
        })
        .to_string(),
        NOW_MS,
    )
    .expect("the remote frame parses");
    core
}

/// 35 projects, seven of them worktrees, three with user-made groups.
fn snapshot() -> Value {
    let ids: Vec<String> = (0..35).map(|index| format!("P{index:02}")).collect();
    let projects: Vec<Value> = ids.iter().map(|id| project(id)).collect();
    let groups: Vec<Value> = ids.iter().map(|id| group(id)).collect();
    let sessions: Vec<Value> = ids
        .iter()
        .flat_map(|id| {
            [
                session(id, "A", true),
                session(id, "B", false),
                session(id, "C", false),
            ]
        })
        .collect();
    json!({
        "revision": 1,
        "generatedAt": "2026-09-21T00:00:00.000Z",
        "projects": projects,
        "groups": groups,
        "sessions": sessions,
        "workspaceGroups": workspace_document().to_side_state(),
    })
}

fn project(project_id: &str) -> Value {
    let mut value = json!({
        "projectId": project_id,
        "title": project_id,
        "path": format!("/tmp/{project_id}"),
        "pathState": "available",
        "groupIds": [format!("{project_id}:active")],
        "sortKey": format!("1:{project_id}"),
        "createdAt": "2026-06-29T13:10:42.091Z",
        "updatedAt": "2026-09-15T01:18:43.055Z",
    });
    if let Some((_, parent)) = WORKTREES.iter().find(|(child, _)| *child == project_id) {
        value["worktree"] = json!({
            "branch": format!("wt/{project_id}"),
            "name": project_id,
            "parentProjectId": parent,
            "parentProjectName": parent,
            "parentProjectPath": format!("/tmp/{parent}"),
        });
    }
    value
}

fn group(project_id: &str) -> Value {
    json!({
        "groupId": format!("{project_id}:active"),
        "projectId": project_id,
        "title": "Active",
        "sessionIds": ["A", "B", "C"],
        "sortKey": format!("1:{project_id}:active"),
    })
}

fn session(project_id: &str, session_id: &str, favorite: bool) -> Value {
    json!({
        "sessionId": session_id,
        "projectId": project_id,
        "groupId": format!("{project_id}:active"),
        "kind": "agent",
        "surface": "workspace",
        "zmxName": format!("S90-{project_id}-{session_id}"),
        "sortKey": format!("000000000000:0:2:{project_id}:{session_id}"),
        "visibleInSidebarByDefault": true,
        "isPinned": false,
        "alias": format!("Session {project_id} {session_id}"),
        // Only the first project of each family carries the tag, so the tag filter hides projects
        // BETWEEN a source and a destination rather than hiding all of them or none.
        "sessionTag": if favorite && project_id.ends_with('0') { Some("favorite") } else { None::<&str> },
        "activity": "idle",
        "lifecycleState": "running",
        "lastInteractionAt": "2026-09-15T01:18:43.055Z",
        "createdAt": "2026-09-15T01:00:00.000Z",
        "updatedAt": "2026-09-15T01:18:43.055Z",
    })
}

/// Three collections: one holding a worktree parent (so its family inherits), one holding two
/// ungrouped projects, and one holding a single project, so moving that project out empties it.
fn collections_document() -> CollectionsDocument {
    CollectionsDocument::from_storage_json(&json!({
        "collections": [
            { "collectionId": "C1", "title": "Group 1", "color": "#7c6df2", "projectIds": ["P00", "P05"] },
            { "collectionId": "C2", "title": "Group 2", "color": "#3aa675", "projectIds": ["P10", "P12"] },
            { "collectionId": "C3", "title": "Group 3", "color": "#d6873f", "projectIds": ["P30"] },
            // A collection of ONE project, so moving that project out empties it and the collection
            // is dropped. No recording has ever reached that branch and it is the one the user sees
            // as a folder disappearing.
            { "collectionId": "C4", "title": "Group 4", "color": "#d75b72", "projectIds": ["P34"] },
        ],
        "nextCollectionNumber": 5,
    }))
}

/// Seven Spaces, which is the user's own number, with both kinds of member.
fn spaces_document() -> SpacesDocument {
    let spaces: serde_json::Map<String, Value> = (1..=7)
        .map(|index| {
            let space_id = format!("space-{index}");
            let members: Vec<String> = match index {
                1 => vec!["P15".to_string(), "P16".to_string()],
                2 => vec!["P20".to_string(), "P21".to_string()],
                3 => vec!["P25".to_string()],
                _ => Vec::new(),
            };
            let collections: Vec<String> = match index {
                4 => vec!["C1".to_string()],
                5 => vec!["C2".to_string()],
                _ => Vec::new(),
            };
            (
                space_id.clone(),
                json!({
                    "spaceId": space_id,
                    "name": format!("Space {index}"),
                    "color": "#3f8fc7",
                    "icon": "stack",
                    "memberProjectIds": members,
                    "memberCollectionIds": collections,
                }),
            )
        })
        .collect();
    SpacesDocument::from_echo_json(&json!({
        "order": (1..=7).map(|index| format!("space-{index}")).collect::<Vec<_>>(),
        "spaces": spaces,
    }))
    .expect("the Spaces fixture parses")
}

/// The workspace session groups document: a manual project order, and user-made groups on three
/// projects so a project drag carries them.
fn workspace_document() -> WorkspaceGroupsDocument {
    let projects: serde_json::Map<String, Value> = SUBGROUPED
        .iter()
        .map(|project_id| {
            (
                project_id.to_string(),
                json!({
                    "groups": [
                        { "groupId": "group-2", "sessionIds": ["B"], "title": "Group 2" },
                        { "groupId": "group-3", "sessionIds": [], "title": "Group 3" },
                    ],
                    "nextGroupNumber": 4,
                }),
            )
        })
        .collect();
    WorkspaceGroupsDocument::parse(&json!({
        "projectOrder": (0..35).map(|index| format!("P{index:02}")).collect::<Vec<_>>(),
        "projects": projects,
    }))
}
