//! Checks the Space rules the drawn list cannot answer on its own: that a reveal reaches a row in
//! another Space, that the follow-active rule does too, that a hidden collection does not move the
//! section to a Space the user was not in, and that a worktree follows its parent project.
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
//! 3. Seven Spaces and three collections, the shape of a real sidebar rather than the smallest one
//!    that exercises a branch: the follow-active rule on a row in another Space, a worktree whose
//!    Space is its parent project's, two Spaces claiming one project so the order tie-break has a
//!    choice, and a section sitting on the built-in Other view.
//!
//! This is tooling, not a test suite; it prints what it found and fails the process on a
//! difference.

use std::process::ExitCode;

use ghostex_gx_core::{
    reveal_plan, space_for_focused_row, Core, Event, MachineId, SidebarInputs, SidebarView,
    SidebarViewModel,
};
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

    seven_spaces(&check);

    if failures.get() == 0 {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

/// A sidebar the size of a real one: seven Spaces, three collections, a worktree, and a project
/// two Spaces both claim.
fn seven_spaces(check: &dyn Fn(&str, bool, String)) {
    let core = seven_space_core();
    let selected = |space_id: &str| {
        let mut inputs = base_inputs();
        inputs.settings.sidebar_space_follow_active_session = true;
        inputs
            .ui
            .collapse
            .selected_space_by_section
            .insert("local".to_string(), space_id.to_string());
        inputs
    };
    let inputs = selected("s1");
    let view = SidebarViewModel::build_from_scratch(&core, &inputs, NOW_MS);
    check(
        "seven Spaces: the section draws only its own",
        drawn_groups(&view) == vec!["combined-project:P1".to_string()],
        format!("{:?}", drawn_groups(&view)),
    );

    // The rule this whole function exists for: the focused row is in another Space.
    let follow = |inputs: &SidebarInputs, view: &SidebarView, session: &str| {
        space_for_focused_row(&core, inputs, view, session, NOW_MS)
    };
    check(
        "follow-active moves to the focused row's Space",
        follow(&inputs, &view, "combined-session:P4:S4").as_deref() == Some("s4"),
        format!("{:?}", follow(&inputs, &view, "combined-session:P4:S4")),
    );
    check(
        "follow-active moves to a Space at the far end of the order",
        follow(&inputs, &view, "combined-session:P7:S7").as_deref() == Some("s7"),
        format!("{:?}", follow(&inputs, &view, "combined-session:P7:S7")),
    );
    check(
        "follow-active leaves a row the section already shows alone",
        follow(&inputs, &view, "combined-session:P1:S1").is_none(),
        format!("{:?}", follow(&inputs, &view, "combined-session:P1:S1")),
    );
    let mut off = inputs.clone();
    off.settings.sidebar_space_follow_active_session = false;
    check(
        "follow-active does nothing with the setting off",
        follow(&off, &view, "combined-session:P4:S4").is_none(),
        format!("{:?}", follow(&off, &view, "combined-session:P4:S4")),
    );

    // A worktree belongs to the Space that claims the project it was cut from.
    check(
        "a worktree follows its parent project's Space",
        follow(&inputs, &view, "combined-session:PW:SW").as_deref() == Some("s3"),
        format!("{:?}", follow(&inputs, &view, "combined-session:PW:SW")),
    );

    // Two Spaces name P5; the earlier one in `order` is the one that claims it.
    check(
        "the earlier Space wins a project two of them claim",
        follow(&inputs, &view, "combined-session:P5:S5").as_deref() == Some("s5"),
        format!("{:?}", follow(&inputs, &view, "combined-session:P5:S5")),
    );

    // A project no Space claims lives in the built-in Other view.
    let other = selected("other");
    let other_view = SidebarViewModel::build_from_scratch(&core, &other, NOW_MS);
    check(
        "Other draws the project no Space claims",
        drawn_groups(&other_view) == vec!["combined-project:P8".to_string()],
        format!("{:?}", drawn_groups(&other_view)),
    );
    check(
        "follow-active moves off Other into a claimed row's Space",
        follow(&other, &other_view, "combined-session:P1:S1").as_deref() == Some("s1"),
        format!(
            "{:?}",
            follow(&other, &other_view, "combined-session:P1:S1")
        ),
    );

    // And a reveal, on the same presentation, answers the same way.
    let plan = reveal_plan(&core, &inputs, &view, "combined-session:P7:S7", NOW_MS);
    check(
        "a reveal across seven Spaces names the Space and the group",
        plan.as_ref().and_then(|plan| plan.select_space.as_deref()) == Some("s7")
            && plan.as_ref().map(|plan| plan.group_id.as_str()) == Some("combined-project:P7"),
        format!(
            "{:?}",
            plan.as_ref()
                .map(|plan| (plan.select_space.clone(), plan.group_id.clone()))
        ),
    );
    let worktree_plan = reveal_plan(&core, &inputs, &view, "combined-session:PW:SW", NOW_MS);
    check(
        "a reveal of a worktree names its parent's Space",
        worktree_plan
            .as_ref()
            .and_then(|plan| plan.select_space.as_deref())
            == Some("s3"),
        format!(
            "{:?}",
            worktree_plan.as_ref().map(|plan| plan.select_space.clone())
        ),
    );
}

/// Eight projects, one of them a worktree of the third, in seven Spaces and three collections.
fn seven_space_core() -> Core {
    let projects = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "PW"];
    let spaces = json!({
        "order": ["s1", "s2", "s3", "s4", "s5", "s6", "s7"],
        "spaces": {
            "s1": space("s1", "One", [], ["P1"]),
            "s2": space("s2", "Two", ["c1"], []),
            "s3": space("s3", "Three", [], ["P3"]),
            "s4": space("s4", "Four", [], ["P4"]),
            // Both name P5; `sanitizeSidebarSpacesState` gives it to the earlier one.
            "s5": space("s5", "Five", [], ["P5"]),
            "s6": space("s6", "Six", ["c2"], ["P5", "P6"]),
            "s7": space("s7", "Seven", [], ["P7"]),
        }
    });
    let frame = json!({
        "type": "presentationSnapshot",
        "protocolVersion": ghostex_gx_core::protocol::GXSERVER_PROTOCOL_VERSION,
        "serverId": "reveal-spaces",
        "revision": 1,
        "snapshot": {
            "revision": 1,
            "generatedAt": "2026-09-20T00:00:00.000Z",
            "projects": projects
                .iter()
                .map(|project_id| project(project_id, project_id))
                .collect::<Vec<_>>(),
            "groups": projects.iter().map(|project_id| group(project_id)).collect::<Vec<_>>(),
            "sessions": projects
                .iter()
                .map(|project_id| session(project_id, &format!("S{}", &project_id[1..])))
                .collect::<Vec<_>>(),
            "sidebarSpaces": spaces,
            "sidebarProjectCollections": {
                "order": ["c1", "c2", "c3"],
                "collections": {
                    "c1": collection("c1", "Held", ["P2"]),
                    "c2": collection("c2", "Six", ["P6"]),
                    "c3": collection("c3", "Empty", []),
                },
            },
        }
    });
    let mut core = Core::new();
    core.handle_raw_frame(MachineId::Local, &frame.to_string(), NOW_MS)
        .expect("the frame parses");
    // The worktree metadata rides on the domain rows, not on the presentation.
    core.handle(
        Event::DomainProjectsRead {
            machine: MachineId::Local,
            projects: vec![json!({
                "projectId": "PW",
                "name": "PW",
                "path": "/tmp/PW",
                "worktree": {
                    "branch": "feature",
                    "name": "PW",
                    "parentProjectId": "P3",
                    "parentProjectName": "P3",
                    "parentProjectPath": "/tmp/P3",
                },
            })],
        },
        NOW_MS,
    );
    core
}

fn collection(
    collection_id: &str,
    title: &str,
    projects: impl IntoIterator<Item = &'static str>,
) -> Value {
    json!({
        "collectionId": collection_id,
        "title": title,
        "color": "#3aa675",
        "projectIds": projects.into_iter().collect::<Vec<_>>(),
    })
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
