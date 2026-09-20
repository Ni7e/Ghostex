//! The menus, hover buttons and header buttons the drawn sidebar list carries.
//!
//! CDXC:ContextMenus 2026-09-20 DECISION:
//! User (2026-09-19): the desktop app stops running product logic in QuickJS. Until this
//! milestone the list took its menus from the old projection's newest publish by row id, which
//! cost a row the projection had not published its whole menu and forced a reinstall of the list
//! on every accepted publish. They are built from the store here instead. A row's context menu is
//! still lazy, exactly as the TypeScript made it: the publish carries one placeholder and the
//! menu is built for the row the user actually opened, which is what keeps two hundred rows off
//! the install path.
//!
//! What the menus still read from outside the store is one list, and it is all HUD (M5): the
//! agents the launcher offers and the Saved Actions pinned to a project header. The agent the
//! user launched last and the keep-awake duration are client storage, read through
//! `sidebar_ui_storage.rs` behind a one-second cache, because the TypeScript writes both while
//! the app runs.

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use ghostex_gx_core::{HeaderCommand, HoverAction, LauncherAgent, MenuHost, SidebarMenus};
use serde_json::Value;

use crate::GhostexGpuiApp;
use crate::app::native_sidebar::model::NativeSidebarSnapshot;

/// How long the two client-storage values are reused. Reading them is one indexed row each on an
/// open connection, and an install can run several times a second.
const HOST_STATE_MAX_AGE: Duration = Duration::from_millis(1000);

/// The client-storage half of the menu host, kept between installs.
#[derive(Default)]
pub(super) struct MenuHostCache {
    read_at: Option<Instant>,
    primary_agent_id: Option<String>,
    keep_awake_minutes: Option<i64>,
}

impl GhostexGpuiApp {
    /// The facts the menus read that are neither the store nor the settings.
    pub(super) fn gx_store_menu_host(
        &mut self,
        published: Option<&NativeSidebarSnapshot>,
    ) -> MenuHost {
        let stale = self
            .gx_store
            .menu_host
            .read_at
            .is_none_or(|read_at| read_at.elapsed() >= HOST_STATE_MAX_AGE);
        if stale {
            self.gx_store.menu_host.read_at = Some(Instant::now());
            if let Ok((primary, keep_awake)) = super::sidebar_ui_storage::read_menu_host_state() {
                self.gx_store.menu_host.primary_agent_id = primary;
                self.gx_store.menu_host.keep_awake_minutes = keep_awake;
            }
        }
        let hud = published.map(|snapshot| &snapshot.hud);
        let selected = published.map(|snapshot| snapshot.selected_machine_id.as_str());
        MenuHost {
            // The sidebar page always has the workspace focus bridge; the web app is what does
            // not, and it never reaches this host.
            workspace_focus_bridge: true,
            agents: hud.map(|hud| agents(&hud["agents"])).unwrap_or_default(),
            primary_agent_id: self.gx_store.menu_host.primary_agent_id.clone(),
            global_commands: hud
                .map(|hud| commands(&hud["globalCommands"]))
                .unwrap_or_default(),
            project_commands: hud
                .map(|hud| commands_by_project(&hud["commandsByProject"]))
                .unwrap_or_default(),
            keep_awake_minutes: self.gx_store.menu_host.keep_awake_minutes,
            machine_connected: published.is_some_and(|snapshot| {
                snapshot.machines.iter().any(|machine| {
                    Some(machine.id.as_str()) == selected && machine.state == "connected"
                })
            }),
        }
    }

    /// Answers a `sessionMenu` request from the store rather than sending it to the old runtime.
    /// Returns whether it was answered here; `false` leaves the command on its old path.
    pub(crate) fn gx_store_answer_session_menu(
        &mut self,
        command: &Value,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        if command["type"] != "sessionMenu" || !self.gx_store_sidebar_draws_store_list() {
            return false;
        }
        let Some(session_id) = command["sessionId"].as_str().map(str::to_string) else {
            return false;
        };
        let owner_id = command["ownerId"].as_str().unwrap_or_default().to_string();
        let action = command["action"].as_str().and_then(HoverAction::from_id);
        let published = self.native_sidebar.projection.clone();
        let host = self.gx_store_menu_host(published.as_deref());
        let now_ms = super::host::now_ms();
        let items = {
            let list = &self.gx_store.sidebar_list;
            let menus = SidebarMenus::new(
                &self.gx_store.core,
                list.view(),
                &list.last_inputs,
                &host,
                now_ms,
            );
            let items = match action {
                Some(action) => menus.row_hover_submenu(&session_id, action),
                None => menus.row_menu(&session_id),
            };
            items.map(|items| {
                items
                    .iter()
                    .map(ghostex_gx_core::MenuItem::to_json)
                    .collect::<Vec<Value>>()
            })
        };
        // A row the list no longer draws answers with nothing, which closes the panel, exactly as
        // the TypeScript's empty reply does.
        let items = items.unwrap_or_default();
        let owns_panel = self
            .native_sidebar
            .menu
            .as_ref()
            .and_then(|menu| menu.account_panel.as_ref())
            .is_some_and(|(owner, _)| *owner == owner_id);
        if !owns_panel {
            return true;
        }
        if items.is_empty() {
            self.dismiss_native_sidebar_menu(cx);
            return true;
        }
        let index = self
            .native_sidebar
            .menu
            .as_ref()
            .and_then(|menu| menu.account_panel.as_ref())
            .map(|(_, index)| *index)
            .unwrap_or_default();
        if let Some(panel) = self
            .native_sidebar
            .menu
            .as_mut()
            .and_then(|menu| menu.panels.get_mut(index))
        {
            panel.replace_items(items);
        }
        cx.notify();
        true
    }
}

/// `hud.agents`.
fn agents(value: &Value) -> Vec<LauncherAgent> {
    value
        .as_array()
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
        .unwrap_or_default()
}

/// One Saved Action list.
fn commands(value: &Value) -> Vec<HeaderCommand> {
    value
        .as_array()
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
                    show_on_project_row: command.get("showOnProjectRow").and_then(Value::as_bool)
                        == Some(true),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn commands_by_project(value: &Value) -> BTreeMap<String, Vec<HeaderCommand>> {
    value
        .as_object()
        .map(|projects| {
            projects
                .iter()
                .map(|(project_id, list)| (project_id.clone(), commands(list)))
                .collect()
        })
        .unwrap_or_default()
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}
