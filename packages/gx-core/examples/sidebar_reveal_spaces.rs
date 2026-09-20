//! Checks that a reveal reaches a row in another Space, and that a hidden collection does not move
//! the section to a Space the user was not in.
//!
//! Usage: `cargo run --example sidebar_reveal_spaces`
//!
//! It needs no recording, and that is the point: a recording made on a machine with no Spaces runs
//! every reveal with the Space branch inert, so it passes whether the branch works or not. The two
//! cases here are the ones the drawn list cannot answer on its own.
//!
//! 1. The row is in a Space the section is not filtered by. The drawn list does not hold it at
//!    all, so the plan has to come from a list built with nothing filtering, and it must say which
//!    Space to move to. `reveal.ts` reads `state.groupOrder`, the unfiltered inventory, for the
//!    same reason.
//! 2. The row's project is inside a collection the user hid, with Show Hidden off, and the Space
//!    claims that collection rather than the project. The collection is dropped from the drawn
//!    list while its projects are still drawn, so a plan that read the collection from there would
//!    answer the Space question on the wrong branch and move the section for no reason.
//!
//! This is tooling, not a test suite; it prints what it found and fails the process on a
//! difference.

use std::process::ExitCode;

use ghostex_gx_core::{reveal_plan, Core, MachineId, SidebarInputs, SidebarView, SidebarViewModel};
use serde_json::{json, Value};

const NOW_MS: u64 = 1_790_000_000_000;
const SPACE_A: &str = "space-a";
const SPACE_B: &str = "space-b";
const COLLECTION: &str = "project-collection-1";

fn main() -> ExitCode {
    let failures = std::cell::Cell::new(0usize);
    let check = |label: &str, ok: bool, detail: String| {
        println!("{:<56} {}", label, if ok { "ok" } else { "DIFFERS" });
        if !ok {
            failures.set(failures.get() + 1);
            println!("  {detail}");
        }
    };

    // Case 1: two Spaces, one project each, the section filtered by the first.
    // No collection holds either project here: a project inside one follows the collection, which
    // is the second case rather than this one.
    let core = core_with(spaces_by_project(), &[]);
    let mut inputs = base_inputs();
    inputs
        .ui
        .collapse
        .selected_space_by_section
        .insert("local".to_string(), SPACE_A.to_string());
    let view = SidebarViewModel::build_from_scratch(&core, &inputs, NOW_MS);
    if std::env::var("DEBUG_ROWS").is_ok() {
        for group in &view.groups {
            println!(
                "group {} storage {} collection {:?} rows {:?}",
                group.core.group_id,
                group.core.storage_id,
                group.collection_id,
                group
                    .core
                    .sessions
                    .iter()
                    .map(|session| session.row.sidebar_session_id.clone())
                    .collect::<Vec<_>>()
            );
        }
    }
    check(
        "the drawn list holds only the selected Space's project",
        drawn_groups(&view) == vec!["combined-project:P1".to_string()],
        format!("{:?}", drawn_groups(&view)),
    );
    let plan = reveal_plan(&core, &inputs, &view, "combined-session:P2:S2", NOW_MS);
    check(
        "a reveal finds a row in another Space at all",
        plan.is_some(),
        "reveal_plan returned None: the row was looked for in the filtered list".to_string(),
    );
    check(
        "the reveal names the group holding it",
        plan.as_ref().map(|plan| plan.group_id.as_str()) == Some("combined-project:P2"),
        format!("{:?}", plan.as_ref().map(|plan| &plan.group_id)),
    );
    check(
        "the reveal moves the section to that Space",
        plan.as_ref().and_then(|plan| plan.select_space.as_deref()) == Some(SPACE_B),
        format!(
            "{:?}",
            plan.as_ref().and_then(|plan| plan.select_space.clone())
        ),
    );
    // The row the section already shows needs no move.
    let same = reveal_plan(&core, &inputs, &view, "combined-session:P1:S1", NOW_MS);
    check(
        "a reveal inside the selected Space moves nothing",
        same.as_ref()
            .is_some_and(|plan| plan.select_space.is_none()),
        format!("{:?}", same.as_ref().map(|plan| plan.select_space.clone())),
    );

    // Case 2: the second project is in a collection the first Space claims, and that collection is
    // hidden. The project is still drawn, and the section must stay where it is.
    let core = core_with(spaces_by_collection(), &["P2"]);
    let mut inputs = base_inputs();
    inputs
        .ui
        .collapse
        .selected_space_by_section
        .insert("local".to_string(), SPACE_A.to_string());
    inputs
        .ui
        .hidden_items
        .collection_keys
        .push(format!("local:{COLLECTION}"));
    let view = SidebarViewModel::build_from_scratch(&core, &inputs, NOW_MS);
    check(
        "a hidden collection is dropped while its projects are drawn",
        view.collections.is_empty()
            && drawn_groups(&view).contains(&"combined-project:P2".to_string()),
        format!(
            "collections {:?} groups {:?}",
            view.collections.len(),
            drawn_groups(&view)
        ),
    );
    let plan = reveal_plan(&core, &inputs, &view, "combined-session:P2:S2", NOW_MS);
    check(
        "a project in a hidden collection does not move the Space",
        plan.as_ref()
            .is_some_and(|plan| plan.select_space.is_none()),
        format!(
            "{:?}",
            plan.as_ref().and_then(|plan| plan.select_space.clone())
        ),
    );
    check(
        "and its hidden collection is still the one to unhide",
        plan.as_ref().is_some_and(|plan| plan.show_hidden),
        format!("{:?}", plan.as_ref().map(|plan| plan.show_hidden)),
    );

    if failures.get() == 0 {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

fn drawn_groups(view: &SidebarView) -> Vec<String> {
    view.groups
        .iter()
        .map(|group| group.core.group_id.clone())
        .collect()
}

fn base_inputs() -> SidebarInputs {
    let mut inputs = SidebarInputs::default();
    inputs.settings.sidebar_spaces_enabled = true;
    inputs
}

/// Each Space owns one project outright.
fn spaces_by_project() -> Value {
    json!({
        "order": [SPACE_A, SPACE_B],
        "spaces": {
            SPACE_A: space(SPACE_A, "One", [], ["P1"]),
            SPACE_B: space(SPACE_B, "Two", [], ["P2"]),
        }
    })
}

/// The first Space owns a collection, and the second project is in it.
fn spaces_by_collection() -> Value {
    json!({
        "order": [SPACE_A, SPACE_B],
        "spaces": {
            SPACE_A: space(SPACE_A, "One", [COLLECTION], ["P1"]),
            SPACE_B: space(SPACE_B, "Two", [], []),
        }
    })
}

fn space(
    space_id: &str,
    name: &str,
    collections: impl IntoIterator<Item = &'static str>,
    projects: impl IntoIterator<Item = &'static str>,
) -> Value {
    json!({
        "spaceId": space_id,
        "name": name,
        "color": "#4f5663",
        "icon": "stack",
        "memberCollectionIds": collections.into_iter().collect::<Vec<_>>(),
        "memberProjectIds": projects.into_iter().collect::<Vec<_>>(),
    })
}

/// A store holding two projects, one group and one session each, with the given Spaces document
/// and a collection holding whichever projects are named.
fn core_with(spaces: Value, collection_projects: &[&str]) -> Core {
    let frame = json!({
        "type": "presentationSnapshot",
        "protocolVersion": ghostex_gx_core::protocol::GXSERVER_PROTOCOL_VERSION,
        "serverId": "reveal-spaces",
        "revision": 1,
        "snapshot": {
            "revision": 1,
            "generatedAt": "2026-09-20T00:00:00.000Z",
            "projects": [project("P1", "One"), project("P2", "Two")],
            "groups": [group("P1"), group("P2")],
            "sessions": [session("P1", "S1"), session("P2", "S2")],
            "sidebarSpaces": spaces,
            "sidebarProjectCollections": {
                "collections": {
                    COLLECTION: {
                        "collectionId": COLLECTION,
                        "title": "Held",
                        "color": "#3aa675",
                        "projectIds": collection_projects,
                    }
                },
                "order": [COLLECTION],
            },
        }
    });
    let mut core = Core::new();
    core.handle_raw_frame(MachineId::Local, &frame.to_string(), NOW_MS)
        .expect("the frame parses");
    core
}

fn project(project_id: &str, title: &str) -> Value {
    json!({
        "projectId": project_id,
        "title": title,
        "path": format!("/tmp/{project_id}"),
        "pathState": "available",
        "groupIds": [format!("{project_id}:active")],
        "sortKey": format!("1:{project_id}"),
        "createdAt": "2026-06-29T13:10:42.091Z",
        "updatedAt": "2026-09-15T01:18:43.055Z",
    })
}

fn group(project_id: &str) -> Value {
    json!({
        "groupId": format!("{project_id}:active"),
        "projectId": project_id,
        "title": "Active",
        "sessionIds": [format!("S{}", &project_id[1..])],
        "sortKey": format!("1:{project_id}:active"),
    })
}

fn session(project_id: &str, session_id: &str) -> Value {
    json!({
        "sessionId": session_id,
        "projectId": project_id,
        "groupId": format!("{project_id}:active"),
        "kind": "agent",
        "surface": "workspace",
        "zmxName": format!("S90-{project_id}-{session_id}"),
        "sortKey": format!("000000000000:0:1:{session_id}"),
        "visibleInSidebarByDefault": true,
        "alias": format!("Session {session_id}"),
        "activity": "idle",
        "lifecycleState": "sleeping",
        "lastInteractionAt": "2026-09-15T01:18:43.055Z",
        "createdAt": "2026-09-15T01:00:00.000Z",
        "updatedAt": "2026-09-15T01:18:43.055Z",
    })
}
