//! The Rust half of the project slot hotkey gate (cmd+1 to cmd+9): the whole jump, planned by
//! gx-core and applied the way the desktop host applies it, against the shipped
//! `runNativeProjectSlotHotkey` followed by the build that performs its reveal.
//!
//! **What the host does, step for step, and what this example does the same way.** The plan is
//! `project_slot_plan` over the drawn list; its `intents()` go through a `SidebarUiStore`; the list
//! is built again; the target row is selected (the host sends the row click's `selectSession`,
//! which the comparer drives through the shipped `selectNativeSidebarSession`); when the plan
//! reveals, `reveal_plan` is asked of the REBUILT list and its `intents()` and Space memory are
//! applied the same way. The result is the sidebar's own state after the jump, the list it draws,
//! the stored collapse envelope the host would write, and the two ids the jump focuses and
//! reveals.
//!
//! **The store is BUILT** so every branch the hotkey has is reached: eleven local projects so a
//! slot can name the ninth and a tenth exists past it, a project with no sessions, a user-visible
//! Chats collection the slot must not count, a project with a parked, a pinned, a sleeping and a
//! tagged row, a focused row deep in a long list, a collection, two Spaces, hidden projects, and a
//! remote machine held three ways (streaming, the stored last-seen copy, and not loaded at all).
//! The raw presentation, the settings and the stored UI state are written out, and the
//! TypeScript half builds its sidebar store from those, never from this side's answer.
//!
//!   cargo run --release --example sidebar_slot_jump_parity -- <out-dir> [--inject <mutation>]
//!   bun tooling/gx-core/slot-jump-parity.ts compare <out-dir>
//!
//! **Mutations** are port mistakes made on THIS side, around the real planner, and written into
//! the dump; the comparer then must report a difference or a collapsed coverage counter. Each one
//! names a claim of the port: `no-reveal`, `reveal-ignores-setting`, `first-row-always`,
//! `toggle-not-delete`, `keep-selection`, `clear-selection-always`, `reveal-before-expand`,
//! `count-remote-groups`, `slot-off-by-one`, `ignore-show-less`, `count-chats`.

use std::process::ExitCode;
use std::time::Instant;

use ghostex_gx_core::{
    collapse_into_storage, hidden_items_into_storage, project_slot_plan, reveal_plan, Core, Event,
    Intent, MachineId, MachineTabInput, ProjectSlotPlan, SessionKey, SessionSortMode,
    SidebarInputs, SidebarSettings, SidebarUiIntent, SidebarUiStore, SidebarView, SidebarViewModel,
};
use serde_json::{json, Value};

const NOW_MS: u64 = 1_790_000_000_000;
const REMOTE: &str = "remote-ab12";
const LAST_SEEN: &str = "remote-lastseen";
const UNLOADED: &str = "remote-offline";
const SPACE_A: &str = "space-a";
const SPACE_B: &str = "space-b";
const COLLECTION: &str = "project-collection-1";

const MUTATIONS: [&str; 11] = [
    "no-reveal",
    "reveal-ignores-setting",
    "first-row-always",
    "toggle-not-delete",
    "keep-selection",
    "clear-selection-always",
    "reveal-before-expand",
    "count-remote-groups",
    "slot-off-by-one",
    "ignore-show-less",
    "count-chats",
];

/// One arrangement of the sidebar's own state and settings, before the key is pressed.
struct Scenario {
    name: &'static str,
    tab: &'static str,
    settings: Value,
    collapsed: &'static [&'static str],
    expanded_lists: &'static [&'static str],
    collapsed_sections: &'static [(&'static str, &'static str)],
    collapsed_collection: bool,
    hidden: &'static [&'static str],
    show_hidden: bool,
    tag_filters: &'static [&'static str],
    selected: &'static [&'static str],
    space: Option<&'static str>,
    /// `(project, session)`, raw ids, or none.
    focus: Option<(&'static str, &'static str)>,
}

fn base(name: &'static str) -> Scenario {
    Scenario {
        name,
        tab: "local",
        settings: settings(true, false, true, false),
        collapsed: &[],
        expanded_lists: &[],
        collapsed_sections: &[],
        collapsed_collection: false,
        hidden: &[],
        show_hidden: false,
        tag_filters: &[],
        selected: &[],
        space: None,
        focus: Some(("P2", "S2f")),
    }
}

fn settings(expand_on_jump: bool, show_less: bool, parking: bool, spaces: bool) -> Value {
    json!({
        "expandCollapsedProjectsOnJump": expand_on_jump,
        "showLessForExpandedProjectJumps": show_less,
        "enableSessionParking": parking,
        "sidebarSpacesEnabled": spaces,
        "sidebarSpaceFollowActiveSession": false,
        "projectSessionListCollapsedCount": 3,
        "remoteMachines": [
            { "id": REMOTE, "name": "Remote", "sshHost": "remote.invalid" },
            { "id": LAST_SEEN, "name": "Last seen", "sshHost": "seen.invalid" },
            { "id": UNLOADED, "name": "Offline", "sshHost": "off.invalid" },
        ],
    })
}

fn scenarios() -> Vec<Scenario> {
    let mut list = vec![base("plain")];
    list.push(Scenario {
        focus: None,
        ..base("noFocus")
    });
    list.push(Scenario {
        focus: Some(("P2", "S2a")),
        ..base("focusFirst")
    });
    // Collapsed projects, a list shown in full, under every combination of the two settings.
    for (name, expand, less) in [
        ("collapsedExpandLess", true, true),
        ("collapsedExpand", true, false),
        ("collapsedNoExpand", false, false),
        ("collapsedNoExpandLess", false, true),
    ] {
        list.push(Scenario {
            settings: settings(expand, less, true, false),
            collapsed: &[
                "combined-project:P1",
                "combined-project:P2",
                "combined-project:P3",
            ],
            expanded_lists: &["P2", "P1"],
            ..base(name)
        });
    }
    // A focused row the compact list cuts, in a project whose list is compact.
    list.push(Scenario {
        focus: Some(("P2", "S2e")),
        ..base("focusCut")
    });
    // A focused PARKED row: its heading starts collapsed, so the reveal opens it.
    list.push(Scenario {
        focus: Some(("P2", "S2p")),
        ..base("focusParked")
    });
    list.push(Scenario {
        focus: Some(("P2", "S2p")),
        settings: settings(true, false, false, false),
        ..base("parkingOff")
    });
    // Headings collapsed by hand.
    list.push(Scenario {
        collapsed_sections: &[("P2", "sessions"), ("P1", "pinned")],
        ..base("sectionsCollapsed")
    });
    list.push(Scenario {
        hidden: &["combined-project:P1", "combined-project:P4"],
        ..base("hidden")
    });
    list.push(Scenario {
        hidden: &["combined-project:P1", "combined-project:P4"],
        show_hidden: true,
        collapsed: &["combined-project:P1"],
        ..base("hiddenShown")
    });
    list.push(Scenario {
        tag_filters: &["research"],
        ..base("tagFilter")
    });
    list.push(Scenario {
        selected: &["combined-session:P1:S1a", "combined-session:P6:S6a"],
        ..base("multiSelection")
    });
    list.push(Scenario {
        selected: &["combined-session:P1:S1a"],
        collapsed: &["combined-project:P3"],
        ..base("multiSelectionEmptyProject")
    });
    list.push(Scenario {
        collapsed_collection: true,
        collapsed: &["combined-project:P7"],
        ..base("collectionCollapsed")
    });
    for (name, space) in [
        ("spaceA", SPACE_A),
        ("spaceB", SPACE_B),
        ("spaceOther", "other"),
    ] {
        list.push(Scenario {
            settings: settings(true, false, true, true),
            space: Some(space),
            collapsed: &["combined-project:P5"],
            ..base(name)
        });
    }
    list.push(Scenario {
        settings: settings(true, true, true, true),
        space: None,
        ..base("spacesUnchosen")
    });
    for (name, tab) in [
        ("remoteConnected", REMOTE),
        ("remoteLastSeen", LAST_SEEN),
        ("remoteNotLoaded", UNLOADED),
    ] {
        list.push(Scenario {
            tab,
            selected: &["combined-session:P1:S1a"],
            collapsed: &["remote:remote-ab12:group:R1", "combined-project:P1"],
            ..base(name)
        });
    }
    list
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out_dir = args.first().cloned().unwrap_or_default();
    let mutation = args
        .iter()
        .position(|arg| arg == "--inject")
        .and_then(|at| args.get(at + 1).cloned());
    if out_dir.is_empty()
        || mutation
            .as_deref()
            .is_some_and(|name| !MUTATIONS.contains(&name))
    {
        eprintln!(
            "usage: sidebar_slot_jump_parity <out-dir> [--inject <{}>]",
            MUTATIONS.join("|")
        );
        return ExitCode::from(2);
    }
    let mutation = mutation.as_deref();
    let local = local_snapshot();
    let remote = remote_snapshot("R", REMOTE);
    let last_seen = remote_snapshot("L", LAST_SEEN);
    let mut entries = Vec::new();
    let mut planned = 0usize;
    let mut plan_us_total = 0u128;
    let mut plan_us_max = 0u128;
    let mut plans = 0u128;
    for scenario in scenarios() {
        let core = seeded_core(&local, &remote, &last_seen, scenario.focus);
        let mut ui = SidebarUiStore::new();
        ui.restore(initial_ui(&scenario));
        let stored_collapse = collapse_into_storage(&ui.state().collapse, None);
        let stored_hidden = hidden_items_into_storage(&ui.state().hidden_items);
        for slot in 0..=10u32 {
            let mut ui = SidebarUiStore::new();
            ui.restore(initial_ui(&scenario));
            let mut inputs = inputs_for(&scenario, &ui);
            let view = SidebarViewModel::build_from_scratch(&core, &inputs, NOW_MS);

            // The planner, timed alone: this is what a held key pays per repeat.
            let started = Instant::now();
            let plan = project_slot_plan(&view, &inputs.ui, &inputs.settings, slot);
            let slot_us = started.elapsed().as_nanos();
            let plan = mutate_plan(mutation, plan, &core, &view, &inputs, slot);
            let mut reveal_us = 0u128;
            let mut after = view.clone();
            let mut reveal_json = Value::Null;
            if let Some(plan) = &plan {
                planned += 1;
                for intent in mutate_intents(mutation, plan) {
                    ui.apply(intent);
                }
                let before_expand = (mutation == Some("reveal-before-expand"))
                    .then(|| (inputs.clone(), view.clone()));
                inputs.ui = ui.state().clone();
                after = SidebarViewModel::build_from_scratch(&core, &inputs, NOW_MS);
                let reveals = plan.reveal && mutation != Some("no-reveal");
                if let (true, Some(target)) = (reveals, plan.target_session_id.as_deref()) {
                    let started = Instant::now();
                    let reveal = match &before_expand {
                        Some((old_inputs, old_view)) => {
                            reveal_plan(&core, old_inputs, old_view, target, NOW_MS)
                        }
                        None => reveal_plan(&core, &inputs, &after, target, NOW_MS),
                    };
                    reveal_us = started.elapsed().as_nanos();
                    if let Some(reveal) = reveal {
                        reveal_json = json!({
                            "collapsedGroup": reveal.collapsed_group,
                            "collapsedSection": reveal.collapsed_section.map(|section| section.as_str()),
                            "expandList": reveal.expand_list,
                            "selectSpace": reveal.select_space,
                        });
                        for intent in reveal.intents(ui.state()) {
                            ui.apply(intent);
                        }
                        if let Some(resolved) = reveal.remember_space {
                            ui.apply(SidebarUiIntent::RememberSpaceSession {
                                section_key: resolved.section_key,
                                space_id: resolved.space_id,
                                sidebar_session_id: target.to_string(),
                            });
                        }
                        inputs.ui = ui.state().clone();
                        after = SidebarViewModel::build_from_scratch(&core, &inputs, NOW_MS);
                    }
                }
            }
            let total = slot_us + reveal_us;
            plans += 1;
            plan_us_total += total;
            plan_us_max = plan_us_max.max(total);
            entries.push(json!({
                "scenario": scenario.name,
                "tab": scenario.tab,
                "slot": slot,
                "settings": scenario.settings,
                "storedCollapse": stored_collapse,
                "storedHidden": stored_hidden,
                "showHidden": scenario.show_hidden,
                "tagFilters": scenario.tag_filters,
                "selected": scenario.selected,
                "focus": scenario.focus.map(|(project, session)| json!({ "projectId": project, "sessionId": session })),
                "owned": plan.is_some(),
                "plan": plan.as_ref().map(|plan| json!({
                    "groupId": plan.group_id,
                    "wasCollapsed": plan.was_collapsed,
                    "expandGroup": plan.expand_group,
                    "collapseSessionList": plan.collapse_session_list_storage_id,
                    "target": plan.target_session_id,
                    "reveal": plan.reveal,
                })),
                "revealPlan": reveal_json,
                "result": {
                    "focus": plan.as_ref().and_then(|plan| plan.target_session_id.clone()),
                    "reveal": plan.as_ref().filter(|plan| plan.reveal).and_then(|plan| plan.target_session_id.clone()),
                    "state": state_vector(&after, ui.state()),
                },
                "storedCollapseAfter": collapse_into_storage(&ui.state().collapse, Some(&stored_collapse)),
                "planNs": total,
            }));
        }
    }
    let dump = json!({
        "injected": mutation,
        "localSnapshot": local["snapshot"],
        "remoteSnapshot": remote["snapshot"],
        "lastSeenSnapshot": last_seen["snapshot"],
        "remoteMachineId": REMOTE,
        "lastSeenMachineId": LAST_SEEN,
        "entries": entries,
    });
    let path = std::path::Path::new(&out_dir).join("slot-jump-rust.json");
    if let Err(error) = std::fs::create_dir_all(&out_dir)
        .and_then(|()| std::fs::write(&path, serde_json::to_string(&dump).expect("serialize")))
    {
        eprintln!("could not write {}: {error}", path.display());
        return ExitCode::from(1);
    }
    println!(
        "{}: {} cases, {planned} planned; planner (slot plan plus reveal plan) mean {} ns, max {} ns",
        path.display(),
        entries.len(),
        plan_us_total / plans.max(1),
        plan_us_max,
    );
    if planned == 0 {
        eprintln!("nothing was planned: the gate would compare nothing");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}

/// A plan as a mistaken port would have made it. `None` passes the real one through.
fn mutate_plan(
    mutation: Option<&str>,
    plan: Option<ProjectSlotPlan>,
    core: &Core,
    view: &SidebarView,
    inputs: &SidebarInputs,
    slot: u32,
) -> Option<ProjectSlotPlan> {
    match mutation {
        Some("reveal-ignores-setting") => plan.map(|mut plan| {
            plan.reveal = plan.target_session_id.is_some();
            plan
        }),
        Some("first-row-always") => plan.map(|mut plan| {
            plan.target_session_id = view.group(&plan.group_id).and_then(|group| {
                group
                    .core
                    .sessions
                    .first()
                    .map(|session| session.row.sidebar_session_id.clone())
            });
            plan
        }),
        Some("ignore-show-less") => plan.map(|mut plan| {
            plan.collapse_session_list_storage_id = None;
            plan
        }),
        Some("slot-off-by-one") => project_slot_plan(view, &inputs.ui, &inputs.settings, slot + 1)
            .filter(|_| (1..=9).contains(&slot)),
        // Every drawn group counts, this machine's or not.
        Some("count-remote-groups") if inputs.ui.selected_machine_id != "local" => {
            let group = view.groups.get((slot as usize).checked_sub(1)?)?;
            group.core.project_context.as_ref()?;
            (1..=9).contains(&slot).then(|| ProjectSlotPlan {
                group_id: group.core.group_id.clone(),
                was_collapsed: false,
                expand_group: false,
                collapse_session_list_storage_id: None,
                target_session_id: group
                    .core
                    .sessions
                    .first()
                    .map(|session| session.row.sidebar_session_id.clone()),
                reveal: !group.core.sessions.is_empty(),
            })
        }
        // The Chats collection counted as the slot after this computer's first project.
        Some("count-chats") => {
            let _ = core;
            if slot == 2 && inputs.ui.selected_machine_id == "local" {
                return None;
            }
            plan
        }
        _ => plan,
    }
}

fn mutate_intents(mutation: Option<&str>, plan: &ProjectSlotPlan) -> Vec<SidebarUiIntent> {
    let mut intents = plan.intents();
    match mutation {
        Some("keep-selection") => {
            intents.retain(|intent| !matches!(intent, SidebarUiIntent::SetSelectedSessions { .. }))
        }
        Some("clear-selection-always") if plan.target_session_id.is_none() => {
            intents.insert(
                0,
                SidebarUiIntent::SetSelectedSessions {
                    session_ids: Vec::new(),
                },
            );
        }
        Some("toggle-not-delete") => {
            if !plan.expand_group {
                intents.push(SidebarUiIntent::ToggleGroupCollapsed {
                    group_id: plan.group_id.clone(),
                });
            }
        }
        _ => {}
    }
    intents
}

/// The sidebar's own state and the list it draws, in the vocabulary the comparer reads off the
/// TypeScript's snapshot and UI state.
fn state_vector(view: &SidebarView, ui: &ghostex_gx_core::SidebarUiState) -> Value {
    json!({
        "groups": view.groups.iter().map(|group| json!({
            "groupId": group.core.group_id,
            "collapsed": group.core.collapsed,
            "expanded": group.core.expanded,
            "sections": group.core.sections.iter().map(|section| json!({
                "id": section.id.as_str(),
                "collapsed": section.collapsed,
                "sessionIds": section.session_ids,
            })).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
        "collections": view.collections.iter().map(|collection| json!({
            "collectionId": collection.collection_id,
            "collapsed": collection.collapsed,
        })).collect::<Vec<_>>(),
        "selectedSpace": view.spaces.iter().find(|space| space.selected).map(|space| space.id.clone()),
        "showHidden": ui.show_hidden,
        "tagFilters": ui.selected_tag_filters,
        "selectedSessions": ui.selected_session_ids,
        "selectedMachine": ui.selected_machine_id,
    })
}

fn initial_ui(scenario: &Scenario) -> ghostex_gx_core::SidebarUiState {
    let mut ui = ghostex_gx_core::SidebarUiState {
        selected_machine_id: scenario.tab.to_string(),
        ..Default::default()
    };
    let collapse = &mut ui.collapse;
    collapse.collapsed_groups = scenario.collapsed.iter().map(|id| id.to_string()).collect();
    collapse.expanded_session_lists = scenario
        .expanded_lists
        .iter()
        .map(|id| id.to_string())
        .collect();
    for (storage_id, section) in scenario.collapsed_sections {
        let section = ghostex_gx_core::SectionId::ORDER
            .into_iter()
            .find(|candidate| candidate.as_str() == *section)
            .expect("a section name");
        collapse
            .section_collapse
            .entry(storage_id.to_string())
            .or_default()
            .set(section, true);
    }
    if scenario.collapsed_collection {
        collapse
            .collapsed_collections
            .insert(format!("local:{COLLECTION}"));
    }
    if let Some(space) = scenario.space {
        collapse
            .selected_space_by_section
            .insert("local".to_string(), space.to_string());
    }
    ui.hidden_items.group_ids = scenario.hidden.iter().map(|id| id.to_string()).collect();
    ui.show_hidden = scenario.show_hidden;
    ui.selected_tag_filters = scenario
        .tag_filters
        .iter()
        .map(|tag| tag.to_string())
        .collect();
    ui.selected_session_ids = scenario.selected.iter().map(|id| id.to_string()).collect();
    ui
}

fn inputs_for(scenario: &Scenario, ui: &SidebarUiStore) -> SidebarInputs {
    let mut inputs = SidebarInputs {
        ui: ui.state().clone(),
        settings: SidebarSettings::from_settings_json(
            &scenario.settings,
            SessionSortMode::LastActivity,
        ),
        ..Default::default()
    };
    inputs.host.machines = [
        (REMOTE, "Remote"),
        (LAST_SEEN, "Last seen"),
        (UNLOADED, "Offline"),
    ]
    .into_iter()
    .map(|(id, label)| MachineTabInput {
        machine_id: id.to_string(),
        label: label.to_string(),
        state: if id == REMOTE {
            "connected"
        } else {
            "disconnected"
        }
        .to_string(),
        message: None,
        fed: id != UNLOADED,
    })
    .collect();
    inputs
}

fn seeded_core(
    local: &Value,
    remote: &Value,
    last_seen: &Value,
    focus: Option<(&str, &str)>,
) -> Core {
    let mut core = Core::new();
    core.handle_raw_frame(MachineId::Local, &local.to_string(), NOW_MS)
        .expect("the local frame parses");
    core.handle_raw_frame(
        MachineId::Remote(REMOTE.to_string()),
        &remote.to_string(),
        NOW_MS,
    )
    .expect("the remote frame parses");
    core.seed_last_seen_presentation(
        &MachineId::Remote(LAST_SEEN.to_string()),
        serde_json::from_value(last_seen["snapshot"].clone()).expect("the snapshot parses"),
    );
    if let Some((project, session)) = focus {
        core.handle(
            Event::Intent(Intent::FocusSession {
                session: SessionKey::local(project, session),
                visible: None,
            }),
            NOW_MS,
        );
    }
    core
}

fn frame(server_id: &str, snapshot: Value) -> Value {
    json!({
        "type": "presentationSnapshot",
        "protocolVersion": ghostex_gx_core::protocol::GXSERVER_PROTOCOL_VERSION,
        "serverId": server_id,
        "revision": 1,
        "snapshot": snapshot,
    })
}

/// Eleven projects in slot order, a project with no sessions (P3), a chat project the slot must
/// not count, a collection holding P6 and P7, and two Spaces.
fn local_snapshot() -> Value {
    let mut projects: Vec<(String, String, Vec<Value>)> = Vec::new();
    projects.push((
        "P1".into(),
        "/tmp/P1".into(),
        vec![
            row("S1a", 9, json!({ "isPinned": true })),
            row("S1b", 8, json!({})),
            row("S1c", 7, json!({ "sessionTag": "research" })),
        ],
    ));
    projects.push((
        "P2".into(),
        "/tmp/P2".into(),
        vec![
            row("S2a", 20, json!({})),
            row("S2b", 19, json!({ "lifecycleState": "sleeping" })),
            row("S2c", 18, json!({})),
            row("S2d", 17, json!({ "isPinned": true })),
            row("S2e", 16, json!({})),
            row("S2f", 15, json!({})),
            row("S2p", 14, json!({ "isParked": true })),
        ],
    ));
    projects.push(("P3".into(), "/tmp/P3".into(), Vec::new()));
    projects.push((
        "P4".into(),
        "/tmp/P4".into(),
        vec![
            row("S4a", 5, json!({ "sessionTag": "research" })),
            row("S4b", 4, json!({})),
        ],
    ));
    for index in 5..=11 {
        let id = format!("P{index}");
        projects.push((
            id.clone(),
            format!("/tmp/{id}"),
            vec![row(&format!("S{index}a"), 30 - index, json!({}))],
        ));
    }
    // After P1 in the project order, so a slot that counted it would name the wrong project.
    projects.insert(
        1,
        (
            "PC".into(),
            "/tmp/.ghostex/chats/chat-1".into(),
            vec![row("SCa", 3, json!({}))],
        ),
    );
    let mut snapshot = presentation(&projects);
    snapshot["sidebarProjectCollections"] = json!({
        "collections": {
            COLLECTION: {
                "collectionId": COLLECTION,
                "title": "Held",
                "color": "#3aa675",
                "projectIds": ["P6", "P7"],
            }
        },
        "order": [COLLECTION],
    });
    snapshot["sidebarSpaces"] = json!({
        "order": [SPACE_A, SPACE_B],
        "spaces": {
            SPACE_A: space(SPACE_A, "One", &[], &["P1", "P2", "P3", "P5"]),
            SPACE_B: space(SPACE_B, "Two", &[COLLECTION], &["P4"]),
        }
    });
    frame("local", snapshot)
}

fn remote_snapshot(prefix: &str, server_id: &str) -> Value {
    let projects = (1..=3)
        .map(|index| {
            let id = format!("{prefix}{index}");
            (
                id.clone(),
                format!("/srv/{id}"),
                vec![
                    row(&format!("T{prefix}{index}a"), 10, json!({})),
                    row(&format!("T{prefix}{index}b"), 9, json!({})),
                ],
            )
        })
        .collect::<Vec<_>>();
    frame(server_id, presentation(&projects))
}

fn space(id: &str, name: &str, collections: &[&str], projects: &[&str]) -> Value {
    json!({
        "spaceId": id,
        "name": name,
        "color": "#4f5663",
        "icon": "stack",
        "memberCollectionIds": collections,
        "memberProjectIds": projects,
    })
}

fn presentation(projects: &[(String, String, Vec<Value>)]) -> Value {
    let mut sessions = Vec::new();
    for (project, _, rows) in projects {
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
        "projects": projects.iter().enumerate().map(|(index, (id, path, _))| json!({
            "projectId": id,
            "title": id,
            "path": path,
            "pathState": "available",
            "groupIds": [format!("{id}:active")],
            "sortKey": format!("1:{index:02}"),
            "createdAt": "2026-06-29T13:10:42.091Z",
            "updatedAt": "2026-09-15T01:18:43.055Z",
        })).collect::<Vec<_>>(),
        "groups": projects.iter().map(|(id, _, rows)| json!({
            "groupId": format!("{id}:active"),
            "projectId": id,
            "title": "Active",
            "sessionIds": rows.iter().map(|row| row["sessionId"].clone()).collect::<Vec<_>>(),
            "sortKey": format!("1:{id}:active"),
        })).collect::<Vec<_>>(),
        "sessions": sessions,
    })
}

/// A row whose recency is `minutes` past a fixed hour, so the activity sort has one answer.
fn row(id: &str, minutes: u32, extra: Value) -> Value {
    let at = format!("2026-09-15T01:{minutes:02}:00.000Z");
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
        "lastInteractionAt": at,
        "createdAt": "2026-09-01T01:00:00.000Z",
        "updatedAt": at,
    });
    for (key, value) in extra.as_object().expect("an object") {
        row[key] = value.clone();
    }
    row
}
