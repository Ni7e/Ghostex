//! The sidebar's menus, hover buttons and header buttons, as data.
//!
//! CDXC:ContextMenus 2026-09-20 DECISION:
//! User (2026-09-19): the desktop app stops running product logic in QuickJS; one Rust store owns
//! it. The menus were the last part of the sidebar a host still had to take from the TypeScript
//! projection by row id, which meant a row the projection had not published drew with no menu and
//! no hover buttons, and every accepted publish forced the whole list to be reinstalled. They are
//! built here instead, on demand for the row or group the user opened, and nothing is cached that
//! could go stale. This supersedes nothing: the TypeScript builders keep running for the machines
//! this store does not hold yet.
//!
//! Every builder is a port of one file under `apps/desktop/sidebar/native-sidebar/`, named in its
//! own `SEE-ALSO`. The command payloads are unchanged, so a row built here and a row built there
//! reach the same handler.

mod agent_logos;
mod bulk;
mod capabilities;
mod clipboard;
mod collection;
mod commands;
mod group;
mod header;
mod host;
mod hover;
mod item;
mod membership;
mod navigation;
mod project;
mod session;
mod text;

use std::collections::BTreeSet;

use crate::core::Core;
use crate::keys::{MachineId, CHATS_GROUP_ID};
use crate::sidebar_view::collections::CollectionsState;
use crate::sidebar_view::spaces::SpacesState;
use crate::sidebar_view::tags::TagCatalog;
use crate::sidebar_view::{
    CollectionView, GroupView, SessionRow, SessionView, SidebarInputs, SidebarView,
    LOCAL_MACHINE_ID,
};

pub use agent_logos::{agent_logo_icons, colored_agent_logo};
pub use commands::MenuCommand;
pub use group::MenuGroup;
pub use header::{agent_launcher_items, project_header_actions};
pub use host::{HeaderCommand, LauncherAgent, MenuHost};
pub use hover::{hover_strip, HoverAction, HoverStrip};
pub use item::{menu_to_json, MenuItem, MenuSecondary, MenuSplit};
pub use session::SessionActions;

/// Builds the menus of one drawn list. Holds no state of its own: everything is derived from the
/// store and the list it was made for, so a menu can never be older than the row it belongs to.
pub struct SidebarMenus<'a> {
    view: &'a SidebarView,
    inputs: &'a SidebarInputs,
    host: &'a MenuHost,
    catalog: TagCatalog,
    spaces: Option<SpacesState>,
    collections: CollectionsState,
    now_ms: u64,
}

impl<'a> SidebarMenus<'a> {
    pub fn new(
        core: &Core,
        view: &'a SidebarView,
        inputs: &'a SidebarInputs,
        host: &'a MenuHost,
        now_ms: u64,
    ) -> Self {
        let machine = if view.selected_machine_id == LOCAL_MACHINE_ID {
            MachineId::Local
        } else {
            MachineId::Remote(view.selected_machine_id.clone())
        };
        let store = core.presentation();
        let side_state = store.machine(&machine).map(|entry| entry.side_state());
        Self {
            view,
            inputs,
            host,
            catalog: TagCatalog::from_state(
                side_state.and_then(|side| side.custom_session_tags.as_ref()),
            ),
            // The Spaces submenu follows the same switch the drawn list does: with Spaces off the
            // sidebar has none to offer.
            spaces: inputs
                .settings
                .sidebar_spaces_enabled
                .then(|| side_state.and_then(|side| side.spaces.as_ref()))
                .flatten()
                .map(SpacesState::from_wire),
            collections: match side_state.and_then(|side| side.project_collections.as_ref()) {
                Some(state) => CollectionsState::from_wire(state),
                None => inputs
                    .host
                    .stored_project_collections
                    .as_ref()
                    .map(CollectionsState::from_local_json)
                    .unwrap_or_default(),
            },
            now_ms,
        }
    }

    /// The group facts every menu of a group and of its rows reads.
    pub fn menu_group(&self, group: &'a GroupView) -> MenuGroup<'a> {
        let core = &group.core;
        MenuGroup {
            group_id: core.group_id.as_str(),
            storage_id: core.storage_id.as_str(),
            title: core.title.as_str(),
            // Remote machines are not in this store yet (M4d), so every group it draws is local.
            is_remote: false,
            remote_machine_name: None,
            is_stale: false,
            // Every project group and every user-made group can take a session into a new group;
            // the Chats collection cannot.
            can_create_session_group: core.group_id != CHATS_GROUP_ID,
            // The projection never sets it, so the Focus item never appears.
            can_focus_mode: false,
            workspace_focus_bridge: self.host.workspace_focus_bridge,
            project: core.project_context.as_ref(),
            // The projection marks every project group removable; only a remote machine's are not.
            can_remove_project: true,
            git_remote_origin_url: core
                .project_context
                .as_ref()
                .and_then(|project| project.git_remote_origin_url.as_deref()),
        }
    }

    /// The hover buttons and the placeholder menu a row publishes.
    pub fn row_actions(&self, group: &GroupView, session: &SessionView) -> SessionActions {
        let menu_group = self.menu_group(group);
        session::session_hover_actions(&self.session_input(&menu_group, &session.row, &[]))
    }

    /// The whole context menu of one row: the bulk menu when the row is part of a multi-selection,
    /// its own menu otherwise. `None` when the list no longer draws the row.
    pub fn row_menu(&self, sidebar_session_id: &str) -> Option<Vec<MenuItem>> {
        let (group, session) = self.find_row(sidebar_session_id)?;
        if self
            .inputs
            .ui
            .selected_session_ids
            .iter()
            .any(|selected| selected == sidebar_session_id)
        {
            if let Some(menu) = self.bulk_menu() {
                return Some(menu);
            }
        }
        let below = self.rows_below(group, &session.row);
        let below: Vec<&SessionRow> = below.iter().map(|session| &*session.row).collect();
        let menu_group = self.menu_group(group);
        Some(session::session_menu(&self.session_input(
            &menu_group,
            &session.row,
            &below,
        )))
    }

    /// The submenu behind one hover button of one row.
    pub fn row_hover_submenu(
        &self,
        sidebar_session_id: &str,
        action: HoverAction,
    ) -> Option<Vec<MenuItem>> {
        let (group, session) = self.find_row(sidebar_session_id)?;
        let menu_group = self.menu_group(group);
        Some(session::session_hover_submenu(
            &self.session_input(&menu_group, &session.row, &[]),
            action,
        ))
    }

    /// The menu a multi-selection carries, or `None` below two selected rows.
    pub fn bulk_menu(&self) -> Option<Vec<MenuItem>> {
        let selected: Vec<&SessionRow> = self
            .inputs
            .ui
            .selected_session_ids
            .iter()
            .filter_map(|session_id| self.find_row(session_id).map(|(_, session)| &*session.row))
            .collect();
        bulk::bulk_menu(&bulk::BulkMenuInput {
            selected: &selected,
            settings: &self.inputs.settings,
            catalog: &self.catalog,
        })
    }

    /// A project header's context menu.
    pub fn project_menu(&self, group: &GroupView) -> Vec<MenuItem> {
        let menu_group = self.menu_group(group);
        project::project_menu(&project::ProjectMenuInput {
            group: &menu_group,
            sessions: &group.core.sessions,
            collection_id: group.collection_id.as_deref(),
            collections: &self.collections,
            spaces: self.spaces.as_ref(),
            hidden_group: self
                .inputs
                .ui
                .hidden_items
                .group_ids
                .iter()
                .any(|group_id| *group_id == group.core.group_id),
        })
    }

    /// A project header's buttons.
    pub fn header_actions(&self, group: &GroupView) -> Vec<MenuItem> {
        let menu_group = self.menu_group(group);
        header::project_header_actions(&menu_group, &self.inputs.settings, self.host)
    }

    /// A collection's context menu.
    pub fn collection_menu(&self, collection: &CollectionView) -> Vec<MenuItem> {
        let sessions: Vec<&SessionView> = collection
            .group_ids
            .iter()
            .filter_map(|group_id| self.view.group(group_id))
            .flat_map(|group| group.core.sessions.iter())
            .collect();
        collection::collection_menu(&collection::CollectionMenuInput {
            collection_id: collection.collection_id.as_str(),
            color: collection.color.as_str(),
            sessions: &sessions,
            hidden: self
                .inputs
                .ui
                .hidden_items
                .collection_keys
                .iter()
                .any(|key| *key == collection.storage_id),
            tag_list_items: &self.inputs.settings.tag_list_items,
            catalog: &self.catalog,
            spaces: self.spaces.as_ref(),
        })
    }

    /// The sidebar's own "more" menu.
    pub fn more_menu(&self) -> Vec<MenuItem> {
        let drawn: Vec<String> = self
            .view
            .groups
            .iter()
            .filter(|group| group.core.group_id != CHATS_GROUP_ID)
            .map(|group| group.core.group_id.clone())
            .collect();
        navigation::more_menu(&navigation::MoreMenuInput {
            ui: &self.inputs.ui,
            settings: &self.inputs.settings,
            catalog: &self.catalog,
            host: self.host,
            drawn_project_group_ids: &drawn,
        })
    }

    fn session_input<'b>(
        &'b self,
        group: &'b MenuGroup<'b>,
        row: &'b SessionRow,
        below: &'b [&'b SessionRow],
    ) -> session::SessionMenuInput<'b> {
        session::SessionMenuInput {
            row,
            group,
            settings: &self.inputs.settings,
            catalog: &self.catalog,
            below,
            now_ms: self.now_ms,
        }
    }

    fn find_row(&self, sidebar_session_id: &str) -> Option<(&'a GroupView, &'a SessionView)> {
        self.view.groups.iter().find_map(|group| {
            group
                .core
                .sessions
                .iter()
                .find(|session| session.row.sidebar_session_id == sidebar_session_id)
                .map(|session| (group, session))
        })
    }

    /// The rows drawn under this one in its group, which is what Sleep Below and Close Below
    /// target. A row inside a collapsed section is not drawn and is not below anything.
    fn rows_below(&self, group: &'a GroupView, row: &SessionRow) -> Vec<&'a SessionView> {
        let visible: BTreeSet<&str> = group
            .core
            .sections
            .iter()
            .filter(|section| !section.collapsed)
            .flat_map(|section| section.session_ids.iter().map(String::as_str))
            .collect();
        let drawn: Vec<&SessionView> = group
            .core
            .sessions
            .iter()
            .filter(|session| visible.contains(session.row.sidebar_session_id.as_str()))
            .collect();
        match drawn
            .iter()
            .position(|session| session.row.sidebar_session_id == row.sidebar_session_id)
        {
            Some(index) => drawn[index + 1..].to_vec(),
            None => Vec::new(),
        }
    }
}
