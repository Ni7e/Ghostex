//! The Rust half of the session slot hotkey gate (Focus Session 1 to 9, cmd+1 to cmd+9 by
//! default): the Nth drawn row, planned by gx-core and focused and revealed the way the desktop
//! host does it, against the shipped `runNativeSidebarHotkey` followed by the build that performs
//! its reveal.
//!
//! **What the host does, step for step, and what this example does the same way.** The plan is
//! `session_slot_plan` over the drawn list; its `intents()` go through a `SidebarUiStore`; the list
//! is built again; the row is selected (the host sends the row click's `selectSession`, which the
//! comparer drives through the shipped `selectNativeSidebarSession`, and a LOCAL row moves the
//! store's focus in process, which this example does with the core's own focus intent); then
//! `reveal_plan` is asked of the rebuilt list and its `intents()` and Space memory are applied.
//! A REMOTE row is handed to the remote row machinery, whose planner (`plan_remote_focus`) is
//! asked here with the message the host builds from that `selectSession`, so a remote row in range
//! is proved to reach it (the open itself is the remote focus gate's).
//!
//! **The store is BUILT** (the slot jump gate's fixture): eleven local projects, a project with no
//! sessions, a Chats collection, a project with a parked, a pinned, a sleeping and a tagged row, a
//! long list the compact form cuts, a collection, two Spaces, hidden projects, and a remote machine
//! held three ways (streaming, the stored last-seen copy, not loaded).
//!
//!   cargo run --release --example sidebar_session_slot_parity -- <out-dir> [--inject <mutation>]
//!   bun tooling/gx-core/session-slot-parity.ts compare <out-dir>
//!
//! **Mutations** are port mistakes made on THIS side, around the real planner: `count-collapsed`
//! (a collapsed project's rows count), `rows-not-headings` (the group's rows in list order, so the
//! compact list's cut rows, a closed heading's rows and the parked rows count),
//! `relative-to-focus` (the slot counted from the focused row, as the walk counts),
//! `ignore-collapsed-collection`, `slot-off-by-one`, `local-only`
//! (remote groups skipped, as the project slot does), `wrap-beyond` (a slot past the list lands on
//! the last row), `no-reveal`, `keep-selection`, and `page-not-told`.

use std::process::ExitCode;
use std::time::Instant;

use ghostex_gx_core::{
    collapse_into_storage, hidden_items_into_storage, plan_remote_focus, rendered_session_ids,
    reveal_plan, session_slot_plan, sidebar_ui_mirror_changes, Core, Event, Intent, MachineId,
    MachineTabInput, OrderKind, PreferredInterfaceSettings, SessionKey, SessionSlotPlan,
    SessionSortMode, SidebarInputs, SidebarSettings, SidebarUiIntent, SidebarUiStore, SidebarView,
    SidebarViewModel,
};
use serde_json::{json, Value};

const NOW_MS: u64 = 1_790_000_000_000;
const REMOTE: &str = "remote-ab12";
const LAST_SEEN: &str = "remote-lastseen";
const UNLOADED: &str = "remote-offline";
const SPACE_A: &str = "space-a";
const SPACE_B: &str = "space-b";
const COLLECTION: &str = "project-collection-1";

const MUTATIONS: [&str; 10] = [
    "count-collapsed",
    "rows-not-headings",
    "relative-to-focus",
    "ignore-collapsed-collection",
    "slot-off-by-one",
    "local-only",
    "wrap-beyond",
    "no-reveal",
    "keep-selection",
    "page-not-told",
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

/// Every project but P2 and P4 collapsed: five rows are drawn, so slots 6 to 9 name nothing.
const ALL_BUT_TWO: &[&str] = &[
    "combined-project:P1",
    "combined-project:P3",
    "combined-project:P5",
    "combined-project:P6",
    "combined-project:P7",
    "combined-project:P8",
    "combined-project:P9",
    "combined-project:P10",
    "combined-project:P11",
    "combined-project:PC",
];

fn scenarios() -> Vec<Scenario> {
    let mut list = vec![base("plain")];
    list.push(Scenario {
        focus: None,
        ..base("noFocus")
    });
    // P1 collapsed: its three rows must not reserve slots.
    list.push(Scenario {
        collapsed: &["combined-project:P1"],
        ..base("collapsedFirst")
    });
    list.push(Scenario {
        collapsed: &["combined-project:P1", "combined-project:P2"],
        ..base("collapsedTwo")
    });
    // The long list in full rather than compact.
    list.push(Scenario {
        expanded_lists: &["P2"],
        ..base("listShownInFull")
    });
    list.push(Scenario {
        collapsed: ALL_BUT_TWO,
        ..base("shortList")
    });
    list.push(Scenario {
        collapsed: ALL_BUT_TWO,
        expanded_lists: &["P2"],
        ..base("shortListFull")
    });
    list.push(Scenario {
        collapsed_sections: &[("P2", "sessions"), ("P1", "pinned")],
        ..base("sectionsCollapsed")
    });
    // The parked heading starts collapsed, so with parking on its row is never in range; with
    // parking off the row is an ordinary one and is.
    list.push(Scenario {
        collapsed: &["combined-project:P1"],
        expanded_lists: &["P2"],
        collapsed_sections: &[("P2", "sessions")],
        ..base("parkedReached")
    });
    list.push(Scenario {
        collapsed: &["combined-project:P1"],
        expanded_lists: &["P2"],
        settings: settings(true, false, false, false),
        ..base("parkingOff")
    });
    list.push(Scenario {
        hidden: &["combined-project:P1", "combined-project:P4"],
        ..base("hidden")
    });
    list.push(Scenario {
        hidden: &["combined-project:P1", "combined-project:P4"],
        show_hidden: true,
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
    // The collection holds P6 and P7; with the projects before it collapsed it is in range.
    list.push(Scenario {
        collapsed: &[
            "combined-project:P1",
            "combined-project:P2",
            "combined-project:P4",
            "combined-project:P5",
        ],
        ..base("collectionOpen")
    });
    list.push(Scenario {
        collapsed_collection: true,
        collapsed: &[
            "combined-project:P1",
            "combined-project:P2",
            "combined-project:P4",
            "combined-project:P5",
        ],
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
            ..base(name)
        });
    }
    list.push(Scenario {
        settings: settings(true, true, true, true),
        space: None,
        ..base("spacesUnchosen")
    });
    for (name, tab, collapsed) in [
        ("remoteConnected", REMOTE, &[][..]),
        (
            "remoteConnectedCollapsed",
            REMOTE,
            &["remote:remote-ab12:group:R1", "combined-project:P1"][..],
        ),
        ("remoteLastSeen", LAST_SEEN, &[][..]),
        ("remoteNotLoaded", UNLOADED, &[][..]),
    ] {
        list.push(Scenario {
            tab,
            selected: &["combined-session:P1:S1a"],
            collapsed,
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
            "usage: sidebar_session_slot_parity <out-dir> [--inject <{}>]",
            MUTATIONS.join("|")
        );
        return ExitCode::from(2);
    }
    let mutation = mutation.as_deref();
    let local = local_snapshot();
    let remote = remote_snapshot("R", REMOTE);
    let last_seen = remote_snapshot("L", LAST_SEEN);
    let interface = PreferredInterfaceSettings {
        default_interface: "terminal".to_string(),
        overrides: Vec::new(),
    };
    let mut entries = Vec::new();
    let mut planned = 0usize;
    let mut plan_ns_total = 0u128;
    let mut plan_ns_max = 0u128;
    let mut plans = 0u128;
    for scenario in scenarios() {
        let stored = {
            let mut ui = SidebarUiStore::new();
            ui.restore(initial_ui(&scenario));
            (
                collapse_into_storage(&ui.state().collapse, None),
                hidden_items_into_storage(&ui.state().hidden_items),
            )
        };
        for slot in 1..=9u32 {
            let mut core = seeded_core(&local, &remote, &last_seen, scenario.focus);
            let mut ui = SidebarUiStore::new();
            ui.restore(initial_ui(&scenario));
            let mut inputs = inputs_for(&scenario, &ui);
            let view = SidebarViewModel::build_from_scratch(&core, &inputs, NOW_MS);
            let drawn: Vec<String> = rendered_session_ids(&view).cloned().collect();

            let started = Instant::now();
            let plan = session_slot_plan(&view, slot);
            let plan_ns = started.elapsed().as_nanos();
            let plan = mutate_plan(mutation, plan, &view, slot);
            plans += 1;
            plan_ns_total += plan_ns;
            plan_ns_max = plan_ns_max.max(plan_ns);

            let mut after = view.clone();
            let mut mirror = Vec::new();
            let mut reveal_json = Value::Null;
            let mut remote_open = Value::Null;
            if let Some(plan) = &plan {
                planned += 1;
                let target = plan.target_session_id.clone();
                for intent in plan.intents() {
                    if mutation == Some("keep-selection") {
                        continue;
                    }
                    apply_mirrored(&mut ui, intent, &mut mirror);
                }
                inputs.ui = ui.state().clone();
                // The row click: a local row moves the store's focus in process; a remote row goes
                // to the remote row machinery, whose planner is asked with the host's message.
                match SessionKey::parse_remote_scoped_session_id(&target) {
                    Some(_) => {
                        let message = json!({ "type": "focusSession", "sessionId": target });
                        let open = plan_remote_focus(&core, &message, &interface, None);
                        remote_open = json!(open.is_some());
                    }
                    None => {
                        if let Some((project, session)) = local_ids(&target) {
                            focus_local(&mut core, &project, &session);
                        }
                    }
                }
                after = SidebarViewModel::build_from_scratch(&core, &inputs, NOW_MS);
                if mutation != Some("no-reveal") {
                    if let Some(reveal) = reveal_plan(&core, &inputs, &after, &target, NOW_MS) {
                        reveal_json = json!({
                            "collapsedGroup": reveal.collapsed_group,
                            "expandList": reveal.expand_list,
                            "selectSpace": reveal.select_space,
                            "rememberSpace": reveal.remember_space.is_some(),
                        });
                        for intent in reveal.intents(ui.state()) {
                            apply_mirrored(&mut ui, intent, &mut mirror);
                        }
                        if let Some(resolved) = reveal.remember_space {
                            apply_mirrored(
                                &mut ui,
                                SidebarUiIntent::RememberSpaceSession {
                                    section_key: resolved.section_key,
                                    space_id: resolved.space_id,
                                    sidebar_session_id: target.clone(),
                                },
                                &mut mirror,
                            );
                        }
                        inputs.ui = ui.state().clone();
                        after = SidebarViewModel::build_from_scratch(&core, &inputs, NOW_MS);
                    }
                }
            }
            let page_messages = match mutation {
                Some("page-not-told") => Vec::new(),
                _ if mirror.is_empty() => Vec::new(),
                _ => vec![json!({ "type": "sidebarUiMirror", "changes": mirror })],
            };
            entries.push(json!({
                "scenario": scenario.name,
                "tab": scenario.tab,
                "slot": slot,
                "settings": scenario.settings,
                "storedCollapse": stored.0,
                "storedHidden": stored.1,
                "showHidden": scenario.show_hidden,
                "tagFilters": scenario.tag_filters,
                "selected": scenario.selected,
                "focus": scenario.focus.map(|(project, session)| json!({ "projectId": project, "sessionId": session })),
                "drawnRows": drawn.len(),
                "target": plan.as_ref().map(|plan| plan.target_session_id.clone()),
                "remoteOpen": remote_open,
                "revealPlan": reveal_json,
                "result": {
                    "focus": plan.as_ref().map(|plan| plan.target_session_id.clone()),
                    "reveal": if mutation == Some("no-reveal") { None } else { plan.as_ref().map(|plan| plan.target_session_id.clone()) },
                    "state": state_vector(&after, ui.state()),
                },
                "storedCollapseAfter": collapse_into_storage(&ui.state().collapse, Some(&stored.0)),
                "pageMessages": page_messages,
                "planNs": plan_ns,
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
    let path = std::path::Path::new(&out_dir).join("session-slot-rust.json");
    if let Err(error) = std::fs::create_dir_all(&out_dir)
        .and_then(|()| std::fs::write(&path, serde_json::to_string(&dump).expect("serialize")))
    {
        eprintln!("could not write {}: {error}", path.display());
        return ExitCode::from(1);
    }
    println!(
        "{}: {} cases, {planned} planned; planner mean {} ns, max {} ns",
        path.display(),
        entries.len(),
        plan_ns_total / plans.max(1),
        plan_ns_max,
    );
    if planned == 0 {
        eprintln!("nothing was planned: the gate would compare nothing");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}

/// `combined-session:<project>:<session>` split into its raw ids.
fn local_ids(sidebar_session_id: &str) -> Option<(String, String)> {
    let rest = sidebar_session_id.strip_prefix("combined-session:")?;
    let (project, session) = rest.split_once(':')?;
    Some((project.to_string(), session.to_string()))
}

/// Applies one intent the way the host's `gx_store_apply_sidebar_ui_intent_unbuilt` does while a
/// slot hotkey collects the page's mirror. Returns whether the state moved.
fn apply_mirrored(
    ui: &mut SidebarUiStore,
    intent: SidebarUiIntent,
    mirror: &mut Vec<Value>,
) -> bool {
    let kept = intent.clone();
    if !ui.apply(intent).changed {
        return false;
    }
    mirror.extend(sidebar_ui_mirror_changes(&kept, ui.state()));
    true
}

/// A plan as a mistaken port would have made it. `None` passes the real one through.
fn mutate_plan(
    mutation: Option<&str>,
    plan: Option<SessionSlotPlan>,
    view: &SidebarView,
    slot: u32,
) -> Option<SessionSlotPlan> {
    let nth = |rows: Vec<String>| {
        rows.into_iter()
            .nth(slot as usize - 1)
            .map(|target_session_id| SessionSlotPlan { target_session_id })
    };
    let groups_in_order = |open_collections_only: bool| -> Vec<&ghostex_gx_core::GroupView> {
        view.order
            .iter()
            .flat_map(|item| match item.kind {
                OrderKind::Project => vec![item.id.clone()],
                OrderKind::Collection => view
                    .collections
                    .iter()
                    .find(|collection| {
                        collection.collection_id == item.id
                            && (!open_collections_only || !collection.collapsed)
                    })
                    .map(|collection| collection.group_ids.clone())
                    .unwrap_or_default(),
            })
            .filter_map(|id| view.group(&id))
            .collect()
    };
    let headings = |group: &ghostex_gx_core::GroupView| -> Vec<String> {
        group
            .core
            .sections
            .iter()
            .filter(|section| !section.collapsed)
            .flat_map(|section| section.session_ids.iter().cloned())
            .collect()
    };
    match mutation {
        Some("count-collapsed") => nth(groups_in_order(true)
            .into_iter()
            .flat_map(|group| headings(group))
            .collect()),
        Some("rows-not-headings") => nth(groups_in_order(true)
            .into_iter()
            .filter(|group| !group.core.collapsed)
            .flat_map(|group| {
                group
                    .core
                    .sessions
                    .iter()
                    .map(|session| session.row.sidebar_session_id.clone())
                    .collect::<Vec<_>>()
            })
            .collect()),
        Some("relative-to-focus") => {
            let rows: Vec<String> = rendered_session_ids(view).cloned().collect();
            let focused = view
                .groups
                .iter()
                .flat_map(|group| group.core.sessions.iter())
                .find(|session| session.is_focused)
                .and_then(|session| {
                    rows.iter()
                        .position(|id| *id == session.row.sidebar_session_id)
                });
            match focused {
                Some(at) => rows.get(at + slot as usize).map(|id| SessionSlotPlan {
                    target_session_id: id.clone(),
                }),
                None => plan,
            }
        }
        Some("ignore-collapsed-collection") => nth(groups_in_order(false)
            .into_iter()
            .filter(|group| !group.core.collapsed)
            .flat_map(|group| headings(group))
            .collect()),
        Some("slot-off-by-one") => {
            if slot == 9 {
                None
            } else {
                session_slot_plan(view, slot + 1)
            }
        }
        Some("local-only") => nth(groups_in_order(true)
            .into_iter()
            .filter(|group| !group.core.collapsed && group.core.remote_machine.is_none())
            .flat_map(|group| headings(group))
            .collect()),
        Some("wrap-beyond") => plan.or_else(|| {
            rendered_session_ids(view).last().map(|id| SessionSlotPlan {
                target_session_id: id.clone(),
            })
        }),
        _ => plan,
    }
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
        focus_local(&mut core, project, session);
    }
    core
}

fn focus_local(core: &mut Core, project: &str, session: &str) {
    core.handle(
        Event::Intent(Intent::FocusSession {
            session: SessionKey::local(project, session),
            visible: None,
        }),
        NOW_MS,
    );
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
