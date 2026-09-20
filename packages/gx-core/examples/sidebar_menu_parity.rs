//! Builds every sidebar menu of a recorded presentation and writes them out, so the TypeScript
//! builders they replace can be diffed against them row by row.
//!
//! Usage: `cargo run --release --example sidebar_menu_parity -- <scenario-dir>`
//!
//! The directory holds `scenario-<n>.json` files written by `tooling/gx-core/menu-parity.mjs`,
//! each one a recorded `presentationSnapshot` plus one settings and UI-state variant. This writes
//! `rust-<n>.json` beside each; the same script then diffs the two sides.
//!
//! A missing menu item is a silent feature loss, so nothing here samples: every drawn row, every
//! group and every collection of every scenario is built and written.
//!
//! Recordings contain private data. Keep both the scenarios and the dumps outside the repository.

use std::collections::BTreeMap;
use std::process::ExitCode;
use std::time::Instant;

use ghostex_gx_core::protocol::ServerEvent;
use ghostex_gx_core::{
    agent_logo_icons, colored_agent_logo, menu_to_json, Core, Event, HeaderCommand, HoverAction,
    LauncherAgent, MachineId, MenuHost, SectionCollapse, SectionId, SessionSortMode,
    SidebarCollapseState, SidebarHiddenItems, SidebarInputs, SidebarMenus, SidebarSettings,
    SidebarUiState, SidebarView, SidebarViewModel,
};
use serde_json::{json, Map, Value};

/// The clock the menus are built against when a scenario carries none. Snooze is the one rule
/// that reads it, and the harness writes the same `nowMs` into every scenario so both sides answer
/// it from the same instant.
const FALLBACK_NOW_MS: u64 = 1_790_000_000_000;

fn main() -> ExitCode {
    let Some(directory) = std::env::args().nth(1) else {
        eprintln!("usage: sidebar_menu_parity <scenario-dir>");
        return ExitCode::from(2);
    };
    let mut scenarios: Vec<std::path::PathBuf> = match std::fs::read_dir(&directory) {
        Ok(entries) => entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("scenario-") && name.ends_with(".json"))
            })
            .collect(),
        Err(error) => {
            eprintln!("cannot read {directory}: {error}");
            return ExitCode::from(2);
        }
    };
    scenarios.sort();
    if scenarios.is_empty() {
        eprintln!("no scenario-*.json in {directory}");
        return ExitCode::from(2);
    }
    let mut rows = 0usize;
    let mut menus = 0usize;
    for path in &scenarios {
        let text = match std::fs::read_to_string(path) {
            Ok(text) => text,
            Err(error) => {
                eprintln!("cannot read {}: {error}", path.display());
                return ExitCode::FAILURE;
            }
        };
        let scenario: Value = match serde_json::from_str(&text) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("cannot parse {}: {error}", path.display());
                return ExitCode::FAILURE;
            }
        };
        let started = Instant::now();
        let Some(dump) = build(&scenario) else {
            eprintln!("cannot build {}", path.display());
            return ExitCode::FAILURE;
        };
        let elapsed = started.elapsed();
        rows += dump.rows;
        menus += dump.menus;
        let out = path.with_file_name(
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .replace("scenario-", "rust-"),
        );
        // The dumps carry session titles, project paths, worktree branches, agent session ids and
        // the whole Copy Details text; they are written as privately as the scenarios are.
        if let Err(error) = write_private(&out, &serde_json::to_string(&dump.value).unwrap()) {
            eprintln!("cannot write {}: {error}", out.display());
            return ExitCode::FAILURE;
        }
        println!(
            "{}: {} rows, {} menus, {} ms",
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(""),
            dump.rows,
            dump.menus,
            elapsed.as_millis()
        );
    }
    println!("scenarios {} rows {rows} menus {menus}", scenarios.len());
    ExitCode::SUCCESS
}

struct Dump {
    value: Value,
    rows: usize,
    menus: usize,
}

/// Owner-only, like the scenarios the harness writes beside these.
fn write_private(path: &std::path::Path, body: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(body.as_bytes())?;
    // `mode` applies to a file this call CREATES; a dump left behind by an earlier run would keep
    // whatever it had.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn build(scenario: &Value) -> Option<Dump> {
    let now_ms = scenario
        .get("nowMs")
        .and_then(Value::as_u64)
        .unwrap_or(FALLBACK_NOW_MS);
    let mut core = Core::new();
    let frame = json!({
        "type": "presentationSnapshot",
        "protocolVersion": 1,
        "serverId": "parity",
        "clientId": "parity",
        "revision": scenario.pointer("/snapshot/revision").cloned().unwrap_or(json!(1)),
        "snapshot": scenario.get("snapshot")?.clone(),
    });
    let frame = ServerEvent::parse(&frame.to_string()).ok()?;
    let output = core.handle(
        Event::Frame {
            machine: MachineId::Local,
            frame: Box::new(frame),
        },
        now_ms,
    );
    let changes = output.changes;
    let inputs = SidebarInputs {
        ui: ui_state(scenario.get("ui")?),
        settings: settings(scenario.get("settings")?),
        host: Default::default(),
    };
    let mut model = SidebarViewModel::new();
    model.update(&core, &inputs, &changes, now_ms);
    let view = model.view();
    let host = menu_host(scenario.get("host")?);
    let menus = SidebarMenus::new(&core, view, &inputs, &host, now_ms);

    let mut rows_out = Map::new();
    let mut count = 0usize;
    for group in &view.groups {
        for session in &group.core.sessions {
            let id = session.row.sidebar_session_id.clone();
            let actions = menus.row_actions(group, session);
            let mut entry = Map::new();
            entry.insert("menu".to_string(), menu_to_json(&actions.menu));
            entry.insert(
                "hoverBefore".to_string(),
                menu_to_json(&actions.hover_before),
            );
            entry.insert("hoverAfter".to_string(), menu_to_json(&actions.hover_after));
            entry.insert(
                "hoverChevron".to_string(),
                Value::Bool(actions.hover_chevron),
            );
            entry.insert(
                "fullMenu".to_string(),
                menu_to_json(&menus.row_menu(&id).unwrap_or_default()),
            );
            count += 2;
            // Every hover button that opens a submenu is asked for it, the same way the host does
            // when the user clicks it.
            let mut submenus = Map::new();
            for action in [HoverAction::Tag, HoverAction::Park, HoverAction::Snooze] {
                let items = menus.row_hover_submenu(&id, action).unwrap_or_default();
                if !items.is_empty() {
                    submenus.insert(action.as_str().to_string(), menu_to_json(&items));
                    count += 1;
                }
            }
            entry.insert("hoverSubmenus".to_string(), Value::Object(submenus));
            rows_out.insert(id, Value::Object(entry));
        }
    }
    let mut groups_out = Map::new();
    for group in &view.groups {
        // The rows the group draws, and the ones a heading actually shows, so the TypeScript side
        // builds its menus over the same membership rather than re-deriving it. Which rows a
        // group holds is M4a's gate, not this one.
        let drawn: Vec<Value> = group
            .core
            .sessions
            .iter()
            .map(|session| {
                let key = session.row.key.as_ref();
                json!({
                    "sidebarSessionId": session.row.sidebar_session_id,
                    "projectId": key.map(|key| key.project_id.clone()),
                    "sessionId": key.map(|key| key.session_id.clone()),
                })
            })
            .collect();
        let visible: Vec<String> = group
            .core
            .sections
            .iter()
            .filter(|section| !section.collapsed)
            .flat_map(|section| section.session_ids.iter().cloned())
            .collect();
        groups_out.insert(
            group.core.group_id.clone(),
            json!({
                "menu": menu_to_json(&menus.project_menu(group)),
                "headerActions": menu_to_json(&menus.header_actions(group)),
                "title": group.core.title,
                "storageId": group.core.storage_id,
                "projectId": group.core.project_context.as_ref().map(|project| project.project_id.clone()),
                "sessions": drawn,
                "visibleSessionIds": visible,
            }),
        );
        count += 2;
    }
    let mut collections_out = Map::new();
    for collection in &view.collections {
        collections_out.insert(
            collection.collection_id.clone(),
            json!({
                "menu": menu_to_json(&menus.collection_menu(collection)),
                "storageId": collection.storage_id,
                "color": collection.color,
                "groupIds": collection.group_ids,
            }),
        );
        count += 1;
    }
    let bulk = menus
        .bulk_menu()
        .map_or(Value::Null, |items| menu_to_json(&items));
    let more_menu = menu_to_json(&menus.more_menu());
    count += 2;
    // An open panel is refreshed in place by copying only the keys the newly built item HAS, so a
    // row that leaves `checked` or `disabled` out can never turn either back off. The enumeration
    // diff normalizes both sides' missing booleans, so the invariant is asserted here instead.
    let mut missing: Vec<String> = Vec::new();
    for (where_, menu) in every_menu(&rows_out, &groups_out, &collections_out, &bulk, &more_menu) {
        check_flags(&where_, &menu, &mut missing);
    }
    if !missing.is_empty() {
        eprintln!(
            "{} menu items are missing checked or disabled: {}",
            missing.len(),
            missing[..missing.len().min(5)].join(", ")
        );
        return None;
    }
    let logos: Map<String, Value> = agent_logo_icons()
        .into_iter()
        .map(|icon| {
            (
                icon.to_string(),
                colored_agent_logo(icon).map_or(Value::Null, |url| Value::String(url.to_string())),
            )
        })
        .collect();
    Some(Dump {
        rows: rows_out.len(),
        menus: count,
        value: json!({
            "rows": Value::Object(rows_out),
            "groups": Value::Object(groups_out),
            "collections": Value::Object(collections_out),
            "bulk": bulk,
            "moreMenu": more_menu,
            "logos": Value::Object(logos),
            "order": order(view),
        }),
    })
}

/// The drawn order, so the diff can say which side has a row the other does not.
fn order(view: &SidebarView) -> Value {
    json!({
        "groups": view
            .groups
            .iter()
            .map(|group| group.core.group_id.clone())
            .collect::<Vec<_>>(),
        "sessions": view
            .groups
            .iter()
            .flat_map(|group| group.core.sessions.iter())
            .map(|session| session.row.sidebar_session_id.clone())
            .collect::<Vec<_>>(),
    })
}

fn settings(value: &Value) -> SidebarSettings {
    let sort_mode = match value.get("activeSessionsSortMode").and_then(Value::as_str) {
        Some("manual") => SessionSortMode::Manual,
        _ => SessionSortMode::LastActivity,
    };
    SidebarSettings::from_settings_json(value, sort_mode)
}

fn ui_state(value: &Value) -> SidebarUiState {
    let strings = |key: &str| -> Vec<String> {
        value
            .get(key)
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default()
    };
    let mut collapse = SidebarCollapseState::default();
    collapse.collapsed_groups = strings("collapsedGroups").into_iter().collect();
    collapse.collapsed_collections = strings("collapsedCollections").into_iter().collect();
    collapse.expanded_session_lists = strings("expandedSessionLists").into_iter().collect();
    collapse.expanded_hover_actions = strings("expandedHoverActions").into_iter().collect();
    if let Some(object) = value.get("sectionCollapse").and_then(Value::as_object) {
        for (storage_id, sections) in object {
            let mut state = SectionCollapse::default();
            for section in SectionId::ORDER {
                if let Some(collapsed) = sections.get(section.as_str()).and_then(Value::as_bool) {
                    state.set(section, collapsed);
                }
            }
            collapse.section_collapse.insert(storage_id.clone(), state);
        }
    }
    if let Some(object) = value
        .get("selectedSpaceBySection")
        .and_then(Value::as_object)
    {
        for (section, space) in object {
            if let Some(space) = space.as_str() {
                collapse
                    .selected_space_by_section
                    .insert(section.clone(), space.to_string());
            }
        }
    }
    SidebarUiState {
        selected_machine_id: value
            .get("selectedMachineId")
            .and_then(Value::as_str)
            .unwrap_or("local")
            .to_string(),
        collapse,
        hidden_items: SidebarHiddenItems {
            group_ids: strings("hiddenGroupIds"),
            collection_keys: strings("hiddenCollectionKeys"),
        },
        show_hidden: value.get("showHidden").and_then(Value::as_bool) == Some(true),
        selected_tag_filters: strings("selectedTagFilters"),
        selected_session_ids: strings("selectedSessionIds"),
    }
}

fn menu_host(value: &Value) -> MenuHost {
    let agents = value
        .get("agents")
        .and_then(Value::as_array)
        .map(|agents| {
            agents
                .iter()
                .map(|agent| LauncherAgent {
                    agent_id: text(agent, "agentId"),
                    name: text(agent, "name"),
                    icon: agent
                        .get("icon")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                })
                .collect()
        })
        .unwrap_or_default();
    let commands = |value: Option<&Value>| -> Vec<HeaderCommand> {
        value
            .and_then(Value::as_array)
            .map(|commands| {
                commands
                    .iter()
                    .map(|command| HeaderCommand {
                        command_id: text(command, "commandId"),
                        name: text(command, "name"),
                        icon: command
                            .get("icon")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        show_on_project_row: command
                            .get("showOnProjectRow")
                            .and_then(Value::as_bool)
                            == Some(true),
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    let mut project_commands: BTreeMap<String, Vec<HeaderCommand>> = BTreeMap::new();
    if let Some(object) = value.get("commandsByProject").and_then(Value::as_object) {
        for (project_id, list) in object {
            project_commands.insert(project_id.clone(), commands(Some(list)));
        }
    }
    MenuHost {
        workspace_focus_bridge: value.get("workspaceFocusBridge").and_then(Value::as_bool)
            != Some(false),
        agents,
        primary_agent_id: value
            .get("primaryAgentId")
            .and_then(Value::as_str)
            .map(str::to_string),
        global_commands: commands(value.get("globalCommands")),
        project_commands,
        keep_awake_minutes: value.get("keepAwakeMinutes").and_then(Value::as_i64),
        machine_connected: true,
    }
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// Every built menu of one scenario, with a name for the report.
fn every_menu(
    rows: &Map<String, Value>,
    groups: &Map<String, Value>,
    collections: &Map<String, Value>,
    bulk: &Value,
    more_menu: &Value,
) -> Vec<(String, Value)> {
    let mut menus: Vec<(String, Value)> = Vec::new();
    for (id, row) in rows {
        for key in ["menu", "fullMenu", "hoverBefore", "hoverAfter"] {
            menus.push((format!("row {id} {key}"), row[key].clone()));
        }
        if let Some(submenus) = row["hoverSubmenus"].as_object() {
            for (action, items) in submenus {
                menus.push((format!("row {id} hover:{action}"), items.clone()));
            }
        }
    }
    for (id, group) in groups {
        menus.push((format!("group {id} menu"), group["menu"].clone()));
        menus.push((
            format!("group {id} headerActions"),
            group["headerActions"].clone(),
        ));
    }
    for (id, collection) in collections {
        menus.push((format!("collection {id}"), collection["menu"].clone()));
    }
    menus.push(("bulk".to_string(), bulk.clone()));
    menus.push(("moreMenu".to_string(), more_menu.clone()));
    menus
}

/// Every item, recursively, must carry `checked` and `disabled`.
fn check_flags(where_: &str, menu: &Value, missing: &mut Vec<String>) {
    let Some(items) = menu.as_array() else {
        return;
    };
    for (index, item) in items.iter().enumerate() {
        for key in ["checked", "disabled"] {
            if !item.get(key).is_some_and(Value::is_boolean) {
                missing.push(format!("{where_}[{index}] {key}"));
            }
        }
        check_flags(&format!("{where_}[{index}]"), &item["children"], missing);
    }
}
