//! The sidebar's own "more" menu and the Sort & Filter page inside it.
//!
//! SEE-ALSO: apps/desktop/sidebar/native-sidebar/navigation.ts.

use crate::sidebar_view::tags::{
    normalize_tag_list_items, tag_list_item_filter, tag_list_item_label, tag_presentation,
    TagCatalog, TagListItemKind,
};
use crate::sidebar_view::{SessionSortMode, SidebarSettings, SidebarUiState, LOCAL_MACHINE_ID};

use super::commands::{message, MenuCommand};
use super::host::MenuHost;
use super::item::MenuItem;

const DISCORD_URL: &str = "https://discord.gg/df7b3G92CS";

/// `KEEP_AWAKE_DURATION_OPTIONS`.
const KEEP_AWAKE_OPTIONS: [(&str, i64); 3] =
    [("Until turned off", 0), ("2 hours", 120), ("5 hours", 300)];

/// Everything the more menu reads.
pub struct MoreMenuInput<'a> {
    pub ui: &'a SidebarUiState,
    pub settings: &'a SidebarSettings,
    pub catalog: &'a TagCatalog,
    pub host: &'a MenuHost,
    /// The project group ids the list draws, without the Chats group.
    pub drawn_project_group_ids: &'a [String],
}

/// `createNativeNavigation(...).moreMenu`.
pub fn more_menu(input: &MoreMenuInput<'_>) -> Vec<MenuItem> {
    let ui = input.ui;
    let is_local = ui.selected_machine_id == LOCAL_MACHINE_ID;
    let intent = |label: &str, icon: &str, action: &str| {
        MenuItem::row(label, icon, MenuCommand::sidebar_action(action))
    };

    let mut sort: Vec<MenuItem> = Vec::new();
    if is_local {
        sort.push(intent("Show Hidden", "eye", "showHidden").with_checked(ui.show_hidden));
        sort.push(MenuItem::separator());
    }
    let manual = input.settings.sort_mode == SessionSortMode::Manual;
    sort.push(intent("Last Active Sorting", "clock", "sortLastActivity").with_checked(!manual));
    sort.push(intent("Manual Sorting", "arrows-sort", "sortManual").with_checked(manual));
    for item in normalize_tag_list_items(&input.settings.tag_list_items, Some(input.catalog)) {
        if !item.visible {
            continue;
        }
        if item.kind == TagListItemKind::Separator {
            if item.enabled {
                sort.push(MenuItem::separator());
            }
            continue;
        }
        let Some(tag) = tag_list_item_filter(&item).map(str::to_string) else {
            continue;
        };
        sort.push(
            MenuItem {
                label: Some(tag_list_item_label(&item, input.catalog)),
                command: Some(MenuCommand::toggle_tag_filter(&tag)),
                ..MenuItem::default()
            }
            .with_tag_presentation(tag_presentation(Some(&tag), input.catalog).as_ref())
            .with_checked(ui.selected_tag_filters.iter().any(|filter| *filter == tag))
            .with_disabled(!item.enabled),
        );
    }

    let mut more: Vec<MenuItem> = Vec::new();
    if is_local || input.host.machine_connected {
        more.push(intent("Add Project", "plus", "addProject"));
    }
    more.push(
        MenuItem::submenu(
            "Sort & Filter",
            "filter",
            sort.into_iter()
                .map(|item| {
                    let has_command = item.command.is_some();
                    MenuItem {
                        keep_open: has_command,
                        ..item
                    }
                })
                .collect(),
        )
        .with_page(),
    );
    if !input.drawn_project_group_ids.is_empty() {
        let any_expanded = input
            .drawn_project_group_ids
            .iter()
            .any(|group_id| !ui.collapse.collapsed_groups.contains(group_id));
        more.push(intent(
            if any_expanded {
                "Collapse All"
            } else {
                "Expand Previous"
            },
            "arrows-diagonal",
            "toggleProjects",
        ));
    }
    if !is_local {
        more.push(intent("Edit Machine", "pencil", "editMachine"));
    }
    more.push(MenuItem::separator());
    more.push(intent("Sessions", "history", "sessions"));
    more.push(intent("Import Sessions", "download", "importSessions"));
    more.push(MenuItem::row(
        "Search by Prompt",
        "file-search",
        MenuCommand::command(message::search_previous_sessions_by_text()),
    ));
    more.push(MenuItem::separator());
    more.push(intent("Agents Hub", "users-group", "agentsHub"));
    more.push(MenuItem::row(
        "All Automations",
        "clock",
        MenuCommand::command(message::open_automations_page()),
    ));
    more.push(MenuItem::separator());
    more.push(intent("Mobile & Remote", "devices", "remoteSetup"));
    if input.settings.show_beta_features && !input.settings.hide_keep_awake_titlebar_control {
        let active = input.host.keep_awake_minutes;
        let mut children: Vec<MenuItem> = KEEP_AWAKE_OPTIONS
            .iter()
            .map(|(label, minutes)| {
                MenuItem::row(
                    label,
                    "coffee",
                    MenuCommand::command(message::start_keep_awake(*minutes)),
                )
                .with_checked(active == Some(*minutes))
            })
            .collect();
        if active.is_some() {
            children.push(MenuItem::row(
                "Don't Keep Awake",
                "square-minus",
                MenuCommand::command(message::stop_keep_awake()),
            ));
        }
        children.push(MenuItem::separator());
        children.push(intent("Power Settings", "settings", "powerSettings"));
        more.push(MenuItem::submenu(
            "Keep Awake",
            if active.is_some() { "coffee" } else { "moon" },
            children,
        ));
    }
    more.push(MenuItem::row(
        "Join Discord",
        "users-group",
        MenuCommand::command(message::open_external_url(DISCORD_URL)),
    ));
    more.push(MenuItem::separator());
    more.push(intent("Hotkeys", "keyboard", "hotkeys"));
    more.push(intent("Settings", "settings", "settings"));
    more
}
