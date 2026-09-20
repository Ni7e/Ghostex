//! The three routes into the sidebar's own state that are not sidebar commands.
//!
//! CDXC:Sidebar 2026-09-21 WHY:
//! Everything else that moves this state arrives as a sidebar command and is turned into an intent
//! in `sidebar_ui_commands.rs`. These three do not, and until M5 piece 7c they were the reason the
//! old runtime still had to write the collapse key: nothing in Rust saw them.
//!
//! - **The per-Space session memory.** `rememberSidebarSpaceSession`, written on every focus change
//!   and every reveal, and read by a Space switch with `sidebarSpaceSwitchBehavior` set to
//!   `restore`. The Space it is keyed by comes from `space_for_focused_row` and from the reveal
//!   plan, which answer it with the same function.
//! - **The Space-editor delete.** Deleting the Space a section is filtered by leaves that section
//!   naming a Space that is gone. The renderer forwards the dialog's result to the sidebar page,
//!   which owns the Spaces document; this takes the one consequence the SIDEBAR STATE has.
//! - **`gpuiProjectSlotHotkey`.** A THIRD route, neither of the two sidebar-command envelopes. It
//!   deletes the jumped-to project's collapsed flag and, with `showLessForExpandedProjectJumps` on,
//!   its session list's expanded flag, and that second one fought the Rust reveal that follows the
//!   same jump over one key on every cmd+1..9. The jump itself (the focus, the reveal request) is
//!   still the old runtime's and the message is still forwarded; what moves here is the state.
//!
//! **The counters that prove these fire** are `spaceMemoryWrites`, `spaceForgets` and `slotJumps`
//! on `gxStore.sidebarUi`. A run in which the user pressed cmd+1 on a collapsed project and
//! `slotJumps` is zero means this file never saw the hotkey and the old runtime is still the only
//! thing that expanded it.
//!
//! SEE-ALSO: apps/desktop/sidebar/native-sidebar/space-navigation.ts,
//! apps/desktop/sidebar/native-sidebar/events.ts, apps/desktop/sidebar/native-sidebar/hotkeys.ts,
//! packages/gx-core/src/sidebar_view/slot_hotkey.rs.

use ghostex_gx_core::{FocusedRowSpace, SidebarUiIntent};
use serde_json::Value;

use crate::GhostexGpuiApp;

impl GhostexGpuiApp {
    /// Puts a row at the front of its Space's memory.
    pub(crate) fn gx_store_remember_space_session(
        &mut self,
        resolved: &FocusedRowSpace,
        sidebar_session_id: &str,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.gx_store_apply_sidebar_ui_intent(
            SidebarUiIntent::RememberSpaceSession {
                section_key: resolved.section_key.clone(),
                space_id: resolved.space_id.clone(),
                sidebar_session_id: sidebar_session_id.to_string(),
            },
            cx,
        ) {
            self.gx_store.sidebar_ui.counters.space_memory_writes += 1;
        }
    }

    /// The Space editor's result, on its way to the sidebar page. Only a DELETE of the Space a
    /// section is currently filtered by changes anything here; the document itself is the page's.
    ///
    /// The section key is built the way `receiveNativeSidebarEvent` builds it, from the message's
    /// own machine id rather than from the selected tab: a Space can be deleted from a dialog
    /// opened on another machine's section.
    pub(crate) fn gx_store_note_sidebar_space_editor_result(
        &mut self,
        message: &serde_json::Map<String, Value>,
        cx: &mut gpui::Context<Self>,
    ) {
        if message.get("mode").and_then(Value::as_str) != Some("delete") {
            return;
        }
        let Some(space_id) = message.get("spaceId").and_then(Value::as_str) else {
            return;
        };
        let section_key = match message.get("remoteMachineId").and_then(Value::as_str) {
            Some(machine_id) => format!("remote:{machine_id}"),
            None => ghostex_gx_core::LOCAL_MACHINE_ID.to_string(),
        };
        if self
            .gx_store
            .sidebar_ui
            .state()
            .collapse
            .selected_space_by_section
            .get(&section_key)
            .map(String::as_str)
            != Some(space_id)
        {
            return;
        }
        if self.gx_store_apply_sidebar_ui_intent(
            SidebarUiIntent::ForgetSectionSpace { section_key },
            cx,
        ) {
            self.gx_store.sidebar_ui.counters.space_forgets += 1;
        }
    }

    /// A project slot hotkey, on its way to the old runtime. Applies the two deletions the jump
    /// makes to this state; the message still goes on, because the focus and the reveal request it
    /// produces are not this state's.
    ///
    /// The slot names the Nth drawn project, and the list it is resolved against is this store's
    /// whichever list the renderer installs: the two agree group for group (the sidebar shadow's
    /// standing gate), and this state is the only writer of the collapse key in either position of
    /// the switch, so answering only for one of them would silently stop storing the jump.
    pub(crate) fn gx_store_note_project_slot_hotkey(
        &mut self,
        slot_number: u8,
        cx: &mut gpui::Context<Self>,
    ) {
        let plan = {
            let store = &self.gx_store;
            ghostex_gx_core::project_slot_plan(
                store.sidebar_list.view(),
                store.sidebar_ui.state(),
                &store.sidebar_list.last_inputs.settings,
                u32::from(slot_number),
            )
        };
        let Some(plan) = plan else {
            return;
        };
        self.gx_store.sidebar_ui.counters.slot_jumps += 1;
        // The multi-selection is cleared by the SELECTION the jump makes, not by the jump, so a
        // slot naming a project with no drawn row leaves it alone. That is what
        // `runNativeProjectSlotHotkey` does, where `selectNativeSidebarSession` is inside
        // `if (session)`; clearing it unconditionally would have been a new difference in the
        // course of closing declared difference 4.
        if plan.has_session {
            self.gx_store_apply_sidebar_ui_intent(
                SidebarUiIntent::SetSelectedSessions {
                    session_ids: Vec::new(),
                },
                cx,
            );
        }
        if !plan.expand_group {
            return;
        }
        self.gx_store_apply_sidebar_ui_intent(
            SidebarUiIntent::ExpandProjectForSlotJump {
                group_id: plan.group_id,
                collapse_session_list_storage_id: plan.collapse_session_list_storage_id,
            },
            cx,
        );
    }
}
