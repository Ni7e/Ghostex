//! What a sidebar command does in the browser. The desktop spreads this over a dozen `sidebar_*.rs` files, most of which also keep its old QuickJS runtime in step; here a command is either the sidebar's own state (the core's `SidebarUiStore`, saved to localStorage under the same keys and formats the desktop uses), a menu the core builds, a focus intent, or a daemon call.
use ghostex_gx_core::{
    ChangeSummary, Event, HoverAction, Intent, LifecycleAnswer, LifecycleFollowUp, MenuItem,
    SectionId, SidebarMenus, SidebarUiIntent, apply_lifecycle_answer, owns_lifecycle_message,
    plan_lifecycle_request,
};
use ghostex_gx_core as sidebar_ui;
use serde_json::Value;

use super::host::now_ms;
use crate::GhostexGpuiApp;

fn local_storage() -> Option<web_sys::Storage> {
    web_sys::window()?.local_storage().ok()?
}

fn section_id(value: &str) -> Option<SectionId> {
    Some(match value {
        "browser" => SectionId::Browser,
        "pinned" => SectionId::Pinned,
        "drafts" => SectionId::Drafts,
        "sessions" => SectionId::Sessions,
        "parked" => SectionId::Parked,
        "snoozed" => SectionId::Snoozed,
        _ => return None,
    })
}

impl GhostexGpuiApp {
    pub(super) fn gx_store_restore_sidebar_ui(&mut self) {
        let Some(storage) = local_storage() else {
            return;
        };
        let read = |key: &str| storage.get_item(key).ok().flatten();
        let mut state = self.gx_store.sidebar_ui.state().clone();
        state.collapse = sidebar_ui::collapse_state_from_storage(
            read(sidebar_ui::COLLAPSE_STORAGE_KEY).as_deref(),
            None,
            None,
        );
        state.hidden_items = sidebar_ui::hidden_items_from_storage(
            read(sidebar_ui::HIDDEN_ITEMS_STORAGE_KEY).as_deref(),
        );
        self.gx_store.sidebar_ui.restore(state);
    }

    fn gx_store_persist_sidebar_ui(&mut self) {
        let owed = self.gx_store.sidebar_ui.take_pending();
        if owed.is_empty() {
            return;
        }
        let Some(storage) = local_storage() else {
            return;
        };
        let state = self.gx_store.sidebar_ui.state();
        let existing = storage.get_item(sidebar_ui::COLLAPSE_STORAGE_KEY).ok().flatten();
        let _ = storage.set_item(
            sidebar_ui::COLLAPSE_STORAGE_KEY,
            &sidebar_ui::collapse_into_storage(&state.collapse, existing.as_deref()),
        );
        let _ = storage.set_item(
            sidebar_ui::HIDDEN_ITEMS_STORAGE_KEY,
            &sidebar_ui::hidden_items_into_storage(&state.hidden_items),
        );
    }

    fn sidebar_ui_intent(&self, command: &Value) -> Option<SidebarUiIntent> {
        let text = |key: &str| command.get(key).and_then(Value::as_str).map(str::to_string);
        match command.get("type").and_then(Value::as_str)? {
            "toggleGroup" => Some(SidebarUiIntent::ToggleGroupCollapsed { group_id: text("groupId")? }),
            "toggleList" => Some(SidebarUiIntent::ToggleSessionListExpanded { storage_id: text("groupId")? }),
            "toggleHoverActions" => Some(SidebarUiIntent::ToggleHoverActions { storage_id: text("groupId")? }),
            "toggleSection" => Some(SidebarUiIntent::ToggleSection {
                storage_id: text("groupId")?,
                section: section_id(command.get("section").and_then(Value::as_str)?)?,
            }),
            "selectSpace" => Some(SidebarUiIntent::SelectSpace { space_id: text("spaceId")? }),
            "toggleTagFilter" => Some(SidebarUiIntent::ToggleTagFilter { tag: text("tag")? }),
            "sidebarAction" if command["action"] == "showHidden" => Some(SidebarUiIntent::ToggleShowHidden),
            "selectSession" if matches!(command["mode"].as_str(), Some("clear" | "focus")) => {
                Some(SidebarUiIntent::SetSelectedSessions { session_ids: Vec::new() })
            }
            _ => None,
        }
    }

    pub(crate) fn web_run_sidebar_command(&mut self, command: Value, cx: &mut gpui::Context<Self>) {
        // The drawing code wraps runtime-bound messages as `{type: "command", message}`.
        let command = match command.get("type").and_then(Value::as_str) {
            Some("command") => command["message"].clone(),
            _ => command,
        };
        if self.web_answer_session_menu(&command, cx) {
            return;
        }
        if let Some(intent) = self.sidebar_ui_intent(&command) {
            if self.gx_store.sidebar_ui.apply(intent).changed {
                self.gx_store_persist_sidebar_ui();
                self.gx_store_update_sidebar_list(&ChangeSummary::default(), cx);
            }
            // The sidebar's own state is the whole answer; a clear-selection click also focuses, below.
            if command["type"] != "selectSession" {
                return;
            }
        }
        if self.web_run_lifecycle(&command, cx) {
            return;
        }
        if command["type"] == "selectSession" && command["mode"] == "focus" {
            if let Some(row_id) = command["sessionId"].as_str() {
                self.web_focus_row(row_id, cx);
            }
            return;
        }
        log::info!("sidebar command not handled on web yet: {}", command["type"]);
    }

    /// Sleep and Wake: the core plans the daemon call and what follows its answer; this host only performs the call with `fetch`.
    fn web_run_lifecycle(&mut self, message: &Value, cx: &mut gpui::Context<Self>) -> bool {
        if !owns_lifecycle_message(message) {
            return false;
        }
        let Some(request) = plan_lifecycle_request(&self.gx_store.core, message) else {
            return false;
        };
        let Some(endpoint) = self.gx_store.endpoint.clone() else {
            return true;
        };
        if request.rpc_path.is_empty() {
            return true;
        }
        cx.spawn(async move |app, cx| {
            let result =
                super::web_transport::rpc(&endpoint, request.rpc_path, request.rpc_params.clone()).await;
            let answer = LifecycleAnswer::read(result.as_ref().map_err(String::as_str));
            let _ = app.update(cx, |app, cx| {
                let focused = app.gx_store.core.focus().focused_session.clone();
                for follow_up in apply_lifecycle_answer(&request, answer, focused.as_ref(), now_ms()) {
                    match follow_up {
                        LifecycleFollowUp::Patch { session, patch } => app.gx_store_handle(
                            Event::Intent(Intent::PatchSession { session, patch }),
                            cx,
                        ),
                        LifecycleFollowUp::Focus { session, .. } => {
                            app.open_session = Some(session.clone());
                            app.gx_store_handle(
                                Event::Intent(Intent::FocusSession { session, visible: None }),
                                cx,
                            );
                        }
                    }
                }
            });
        })
        .detach();
        true
    }

    /// `?session=<projectId>:<sessionId>` opens that session once the list has it, and `&surface=terminal` shows its terminal: a deep link, and what the screenshot driver uses.
    pub(crate) fn web_open_linked_session(&mut self, cx: &mut gpui::Context<Self>) {
        if self.open_session.is_some() || self.linked_session_opened {
            return;
        }
        let Some(search) = web_sys::window().and_then(|window| window.location().search().ok()) else {
            return;
        };
        let parameter = |name: &str| {
            search.trim_start_matches('?').split('&').find_map(|pair| {
                pair.strip_prefix(name)?.strip_prefix('=').map(str::to_string)
            })
        };
        let Some((project_id, session_id)) =
            parameter("session").and_then(|value| value.split_once(':').map(|(p, s)| (p.to_string(), s.to_string())))
        else {
            return;
        };
        // By store key rather than by drawn row: a compact session list hides most of a project's rows.
        if !self.gx_store.sidebar_view().ready {
            return;
        }
        self.linked_session_opened = true;
        self.web_open_session(
            ghostex_gx_core::SessionKey { machine: ghostex_gx_core::MachineId::Local, project_id, session_id },
            cx,
        );
        if parameter("surface").as_deref() == Some("terminal") {
            self.web_show_terminal(true, cx);
        }
    }

    fn web_focus_row(&mut self, row_id: &str, cx: &mut gpui::Context<Self>) {
        let Some(session) = self.gx_store.session_key_for_row(row_id) else {
            return;
        };
        self.web_open_session(session, cx);
    }

    fn web_open_session(&mut self, session: ghostex_gx_core::SessionKey, cx: &mut gpui::Context<Self>) {
        self.open_session = Some(session.clone());
        self.ensure_native_chat(&session, cx);
        if self.show_terminal {
            self.ensure_terminal(&session, cx);
        }
        self.gx_store_handle(Event::Intent(Intent::FocusSession { session, visible: None }), cx);
        cx.notify();
    }

    fn web_answer_session_menu(&mut self, command: &Value, cx: &mut gpui::Context<Self>) -> bool {
        if command["type"] != "sessionMenu" {
            return false;
        }
        let Some(session_id) = command["sessionId"].as_str() else {
            return true;
        };
        let owner_id = command["ownerId"].as_str().unwrap_or_default();
        let action = command["action"].as_str().and_then(HoverAction::from_id);
        let store = &self.gx_store;
        let menus =
            SidebarMenus::new(&store.core, store.model.view(), &store.inputs, &store.menu_host, now_ms());
        let items = match action {
            Some(action) => menus.row_hover_submenu(session_id, action),
            None => menus.row_menu(session_id),
        }
        .map(|items| items.iter().map(MenuItem::to_json).collect::<Vec<Value>>())
        .unwrap_or_default();
        let panel_index = self
            .native_sidebar
            .menu
            .as_ref()
            .and_then(|menu| menu.account_panel.as_ref())
            .filter(|(owner, _)| owner == owner_id)
            .map(|(_, index)| *index);
        let Some(index) = panel_index else {
            return true;
        };
        if items.is_empty() {
            self.dismiss_native_sidebar_menu(cx);
        } else if let Some(panel) =
            self.native_sidebar.menu.as_mut().and_then(|menu| menu.panels.get_mut(index))
        {
            panel.replace_items(items);
        }
        cx.notify();
        true
    }
}
