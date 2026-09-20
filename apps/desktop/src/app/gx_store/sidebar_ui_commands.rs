//! Turning a command the renderer sends into the intent it is, so the sidebar's own state moves in
//! Rust in the same frame the click happens.
//!
//! CDXC:Sidebar 2026-09-20 WHY:
//! The command is still sent on to the old projection afterwards, which keeps its own copy for the
//! menus it owns until M4c. Both sides therefore apply the same command to equivalent state, which
//! is why the comparison between the two lists stays meaningful across a click, and why the write
//! to client storage carries only what this state changed (gx-core sidebar_ui/diff.rs).
//!
//! Four commands are deliberately not identical to the TypeScript, and they are listed together
//! here because the list belongs beside the code that decides it rather than only in a review:
//! `collectionAction:select` and `collectionAction:toggleProjects` act on the rows and groups the
//! list DRAWS, where `nativeCollectionGroups` acts on the collection's membership including its
//! filtered and hidden projects; `sidebarAction:toggleProjects` likewise leaves hidden projects
//! alone; and a sidebar slot hotkey clears the TypeScript multi-selection but not this one,
//! because it arrives as `gpuiProjectSlotHotkey` and never reaches this file. The full list, with
//! the reveal and the Space differences, is in docs/2026-09-19/rust-core/PROGRESS.md.

use ghostex_gx_core::{SectionId, SidebarUiIntent, ToggleAllProjectsInput};
use serde_json::Value;

use crate::GhostexGpuiApp;

impl GhostexGpuiApp {
    /// Applies what this command does to the sidebar's own state. Returns whether it moved.
    pub(crate) fn gx_store_note_sidebar_command(
        &mut self,
        command: &Value,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        let Some(intent) = self.sidebar_command_intent(command) else {
            return false;
        };
        self.gx_store_apply_sidebar_ui_intent(intent, cx)
    }

    fn sidebar_command_intent(&mut self, command: &Value) -> Option<SidebarUiIntent> {
        let text = |key: &str| command.get(key).and_then(Value::as_str).map(str::to_string);
        match command.get("type").and_then(Value::as_str)? {
            "toggleGroup" => Some(SidebarUiIntent::ToggleGroupCollapsed {
                group_id: text("groupId")?,
            }),
            // The three below carry the session-list storage id in `groupId`, which is what the
            // collapse state has always been keyed by below a project row.
            "toggleList" => Some(SidebarUiIntent::ToggleSessionListExpanded {
                storage_id: text("groupId")?,
            }),
            "toggleHoverActions" => Some(SidebarUiIntent::ToggleHoverActions {
                storage_id: text("groupId")?,
            }),
            "toggleSection" => Some(SidebarUiIntent::ToggleSection {
                storage_id: text("groupId")?,
                section: section_id(command.get("section").and_then(Value::as_str)?)?,
            }),
            "selectMachine" => Some(SidebarUiIntent::SelectMachine {
                machine_id: text("machineId")?,
            }),
            "selectSpace" => Some(SidebarUiIntent::SelectSpace {
                space_id: text("spaceId")?,
            }),
            "toggleTagFilter" => Some(SidebarUiIntent::ToggleTagFilter { tag: text("tag")? }),
            "projectMembership" if command.get("action") == Some(&Value::from("hide")) => {
                let group_id = text("groupId")?;
                Some(match self.sidebar_group_hidden(&group_id) {
                    true => SidebarUiIntent::UnhideGroup { group_id },
                    false => SidebarUiIntent::HideGroup { group_id },
                })
            }
            "sidebarAction" => match command.get("action").and_then(Value::as_str)? {
                "showHidden" => Some(SidebarUiIntent::ToggleShowHidden),
                "toggleProjects" => {
                    Some(SidebarUiIntent::ToggleAllProjects(ToggleAllProjectsInput {
                        machine_id: self.gx_store.sidebar_ui.selected_machine_id().to_string(),
                        group_ids: self.sidebar_drawn_project_group_ids(),
                    }))
                }
                _ => None,
            },
            "collectionAction" => self.collection_intent(command),
            "selectSession" => self.selection_intent(command),
            "batch" if command.get("clearSelection") == Some(&Value::Bool(true)) => {
                Some(SidebarUiIntent::SetSelectedSessions {
                    session_ids: Vec::new(),
                })
            }
            _ => None,
        }
    }

    fn collection_intent(&mut self, command: &Value) -> Option<SidebarUiIntent> {
        let collection_id = command.get("collectionId").and_then(Value::as_str)?;
        let storage_id = self.sidebar_collection_storage_id(collection_id)?;
        match command.get("action").and_then(Value::as_str)? {
            "toggle" => Some(SidebarUiIntent::ToggleCollectionCollapsed { storage_id }),
            "hide" => Some(match self.sidebar_collection_hidden(&storage_id) {
                true => SidebarUiIntent::UnhideCollection { storage_id },
                false => SidebarUiIntent::HideCollection { storage_id },
            }),
            "select" => Some(SidebarUiIntent::SetSelectedSessions {
                session_ids: self.sidebar_collection_session_ids(collection_id),
            }),
            "toggleProjects" => Some(SidebarUiIntent::ToggleAllProjects(ToggleAllProjectsInput {
                // The projects of one collection are remembered under the collection's own key,
                // so collapsing every project of a machine and collapsing one collection do not
                // overwrite each other's memory.
                machine_id: storage_id,
                group_ids: self.sidebar_collection_group_ids(collection_id),
            })),
            _ => None,
        }
    }

    fn selection_intent(&mut self, command: &Value) -> Option<SidebarUiIntent> {
        let mode = command.get("mode").and_then(Value::as_str)?;
        if matches!(mode, "clear" | "focus") {
            // A row click clears the multi-selection; the focus itself is the store's own intent
            // and is applied where the selection is made (gx_store/local_focus.rs).
            return Some(SidebarUiIntent::SetSelectedSessions {
                session_ids: Vec::new(),
            });
        }
        let clicked = command.get("sessionId").and_then(Value::as_str)?;
        let visible = self.sidebar_rendered_session_ids();
        if !visible.iter().any(|session_id| session_id == clicked) && mode == "range" {
            return Some(SidebarUiIntent::SetSelectedSessions {
                session_ids: Vec::new(),
            });
        }
        let session_ids = match mode {
            // Cmd-click adds exactly the clicked visible row to the set, dropping anything the
            // list no longer draws. The active session is never seeded in implicitly.
            "additive" => {
                let mut next: Vec<String> = self
                    .gx_store
                    .sidebar_ui
                    .state()
                    .selected_session_ids
                    .iter()
                    .filter(|session_id| visible.iter().any(|drawn| drawn == *session_id))
                    .cloned()
                    .collect();
                if visible.iter().any(|drawn| drawn == clicked)
                    && !next.iter().any(|held| held == clicked)
                {
                    next.push(clicked.to_string());
                }
                next
            }
            // Shift-click is anchored on the focused row and takes the inclusive range in rendered
            // order, so collapsed projects, filters and sorting define it exactly.
            "range" => {
                let clicked_index = visible.iter().position(|id| id == clicked)?;
                match self.sidebar_focused_row_id() {
                    Some(active) => match visible.iter().position(|id| *id == active) {
                        Some(active_index) => {
                            let start = active_index.min(clicked_index);
                            let end = active_index.max(clicked_index);
                            visible[start..=end].to_vec()
                        }
                        None => vec![clicked.to_string()],
                    },
                    None => vec![clicked.to_string()],
                }
            }
            _ => return None,
        };
        Some(SidebarUiIntent::SetSelectedSessions { session_ids })
    }
}

/// The rows and ids the intents above are resolved against: the list that is on screen.
impl GhostexGpuiApp {
    /// Every project group the machine draws, the Chats collection left out.
    fn sidebar_drawn_project_group_ids(&self) -> Vec<String> {
        match self.gx_store_sidebar_draws_store_list() {
            true => self
                .gx_store
                .sidebar_list
                .view()
                .groups
                .iter()
                .filter(|group| group.core.group_id != ghostex_gx_core::CHATS_GROUP_ID)
                .map(|group| group.core.group_id.clone())
                .collect(),
            false => self
                .native_sidebar
                .snapshot
                .iter()
                .flat_map(|snapshot| snapshot.groups.iter())
                .filter(|group| !group.is_chat_collection)
                .map(|group| group.group_id.clone())
                .collect(),
        }
    }

    /// The `<section key>:<collection id>` a collection's own state is stored under.
    ///
    /// The key is built from the section, exactly as `runNativeCollectionAction` builds it, rather
    /// than looked up in the drawn list: a collection the user hid is in no drawn list, and
    /// resolving it there would make unhiding it a silent no-op. The collection still has to be
    /// one the sidebar knows, so an id from a stale menu does nothing, which is what the
    /// TypeScript's `if (!collection) return` does.
    fn sidebar_collection_storage_id(&self, collection_id: &str) -> Option<String> {
        let state = self.gx_store.sidebar_ui.state();
        let storage_id = format!("{}:{}", state.section_key(), collection_id);
        let published = self
            .native_sidebar
            .projection
            .iter()
            .flat_map(|snapshot| snapshot.collections.iter())
            .any(|collection| collection.collection_id == collection_id);
        let hidden = state
            .hidden_items
            .collection_keys
            .iter()
            .any(|key| *key == storage_id);
        (published || hidden).then_some(storage_id)
    }

    /// The groups of a collection, from the publish the menu that sent the command was built from.
    fn sidebar_collection_group_ids(&self, collection_id: &str) -> Vec<String> {
        self.native_sidebar
            .projection
            .iter()
            .flat_map(|snapshot| snapshot.collections.iter())
            .find(|collection| collection.collection_id == collection_id)
            .map(|collection| collection.group_ids.clone())
            .unwrap_or_default()
    }

    fn sidebar_collection_session_ids(&self, collection_id: &str) -> Vec<String> {
        let group_ids = self.sidebar_collection_group_ids(collection_id);
        match self.gx_store_sidebar_draws_store_list() {
            true => self
                .gx_store
                .sidebar_list
                .view()
                .groups
                .iter()
                .filter(|group| group_ids.iter().any(|id| *id == group.core.group_id))
                .flat_map(|group| group.core.sessions.iter())
                .map(|session| session.row.sidebar_session_id.clone())
                .collect(),
            false => self
                .native_sidebar
                .snapshot
                .iter()
                .flat_map(|snapshot| snapshot.groups.iter())
                .filter(|group| group_ids.iter().any(|id| *id == group.group_id))
                .flat_map(|group| group.sessions.iter())
                .map(|session| session.session_id.clone())
                .collect(),
        }
    }

    /// The rows the list actually draws, in order: what a shift-click range is measured in.
    fn sidebar_rendered_session_ids(&self) -> Vec<String> {
        match self.gx_store_sidebar_draws_store_list() {
            true => {
                let view = self.gx_store.sidebar_list.view();
                view.order
                    .iter()
                    .flat_map(|item| match item.kind {
                        ghostex_gx_core::OrderKind::Project => vec![item.id.clone()],
                        ghostex_gx_core::OrderKind::Collection => view
                            .collections
                            .iter()
                            .find(|collection| {
                                collection.collection_id == item.id && !collection.collapsed
                            })
                            .map(|collection| collection.group_ids.clone())
                            .unwrap_or_default(),
                    })
                    .filter_map(|group_id| view.group(&group_id))
                    .filter(|group| !group.core.collapsed)
                    .flat_map(|group| {
                        group
                            .core
                            .sections
                            .iter()
                            .filter(|section| !section.collapsed)
                            .flat_map(|section| section.session_ids.iter().cloned())
                    })
                    .collect()
            }
            false => {
                let Some(snapshot) = self.native_sidebar.snapshot.as_ref() else {
                    return Vec::new();
                };
                snapshot
                    .order
                    .iter()
                    .flat_map(|item| {
                        if item.kind == "project" {
                            vec![item.id.clone()]
                        } else {
                            snapshot
                                .collections
                                .iter()
                                .find(|collection| {
                                    collection.collection_id == item.id && !collection.collapsed
                                })
                                .map(|collection| collection.group_ids.clone())
                                .unwrap_or_default()
                        }
                    })
                    .filter_map(|group_id| {
                        snapshot
                            .groups
                            .iter()
                            .find(|group| group.group_id == group_id)
                    })
                    .filter(|group| !group.collapsed)
                    .flat_map(|group| {
                        group
                            .sections
                            .iter()
                            .filter(|section| !section.collapsed)
                            .flat_map(|section| section.session_ids.iter().cloned())
                    })
                    .collect()
            }
        }
    }

    fn sidebar_focused_row_id(&self) -> Option<String> {
        self.gx_store
            .core
            .focus()
            .focused_session
            .as_ref()
            .map(ghostex_gx_core::SessionKey::to_sidebar_session_id)
    }

    fn sidebar_group_hidden(&self, group_id: &str) -> bool {
        self.gx_store
            .sidebar_ui
            .state()
            .hidden_items
            .group_ids
            .iter()
            .any(|held| held == group_id)
    }

    fn sidebar_collection_hidden(&self, storage_id: &str) -> bool {
        self.gx_store
            .sidebar_ui
            .state()
            .hidden_items
            .collection_keys
            .iter()
            .any(|held| held == storage_id)
    }
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
    /// Puts a row on screen: the Space that shows it is selected, the group, its collection and
    /// its heading are opened, Show Hidden and the tag filters are lifted where they hide it, and
    /// the full list is shown when the compact one would still leave it out. The old projection
    /// does the same to its own copy, from the same request, so the two stay in step.
    ///
    /// Runs whichever list is drawn. It used to be gated on the store's list being the drawn one,
    /// because working the plan out reads the list and may build it again and nothing on screen
    /// would have used the answer; since M5 piece 7c this state is the only writer of the collapse
    /// key in either position of the switch, so a reveal that did not run here would simply not be
    /// stored.
    pub(crate) fn gx_store_note_sidebar_reveal(
        &mut self,
        sidebar_session_id: &str,
        request_id: u64,
        cx: &mut gpui::Context<Self>,
    ) {
        // The request id is taken first, whatever the switch says. `reveal.ts` never clears
        // `ui.revealRequest`, so the newest one is on every publish for the rest of the run, and a
        // gate that returned before this would replay the session's last reveal the moment the
        // switch moved: a group expanding, Show Hidden lifting and the filters clearing out of
        // nowhere, for something the user asked for minutes ago.
        let fresh = self.gx_store.sidebar_ui.take_reveal_request(request_id);
        if !fresh {
            return;
        }
        let now_ms = super::host::now_ms();
        let plan = {
            let store = &self.gx_store;
            ghostex_gx_core::reveal_plan(
                &store.core,
                &store.sidebar_list.last_inputs,
                store.sidebar_list.view(),
                sidebar_session_id,
                now_ms,
            )
        };
        let Some(plan) = plan else {
            return;
        };
        let mut intents: Vec<SidebarUiIntent> = Vec::new();
        // The machine before everything else: every other field of the plan is keyed by that
        // machine's section, so applying the Space or a collapse first would write them under the
        // section the user is leaving. `rememberNativeSidebarFocus` switches the tab the same way.
        if let Some(machine_id) = plan.select_machine {
            intents.push(SidebarUiIntent::SelectMachine { machine_id });
        }
        // The Space next: it decides which groups the section draws at all, which is what the
        // TypeScript does by running `rememberNativeSidebarFocus` before everything else.
        if let Some(space_id) = plan.select_space {
            intents.push(SidebarUiIntent::SelectSpace { space_id });
        }
        if plan.show_hidden {
            intents.push(SidebarUiIntent::ToggleShowHidden);
        }
        if plan.clear_tag_filters {
            for tag in self
                .gx_store
                .sidebar_ui
                .state()
                .selected_tag_filters
                .clone()
            {
                intents.push(SidebarUiIntent::ToggleTagFilter { tag });
            }
        }
        if let Some(storage_id) = plan.collapsed_collection_storage_id {
            intents.push(SidebarUiIntent::ToggleCollectionCollapsed { storage_id });
        }
        if plan.collapsed_group {
            intents.push(SidebarUiIntent::ToggleGroupCollapsed {
                group_id: plan.group_id.clone(),
            });
        }
        if let Some(section) = plan.collapsed_section {
            intents.push(SidebarUiIntent::ToggleSection {
                storage_id: plan.storage_id.clone(),
                section,
            });
        }
        if plan.expand_list
            && !self
                .gx_store
                .sidebar_ui
                .state()
                .collapse
                .expanded_session_lists
                .contains(&plan.storage_id)
        {
            intents.push(SidebarUiIntent::ToggleSessionListExpanded {
                storage_id: plan.storage_id.clone(),
            });
        }
        for intent in intents {
            self.gx_store_apply_sidebar_ui_intent(intent, cx);
        }
        // `rememberNativeSidebarFocus` runs FIRST inside `applyNativeSidebarReveal` and remembers
        // the row under the Space it belongs to, whatever the follow setting says. The plan carries
        // that Space, resolved from the same group the rest of the plan was built from.
        if let Some(resolved) = plan.remember_space {
            self.gx_store_remember_space_session(&resolved, sidebar_session_id, cx);
        }
    }
}
