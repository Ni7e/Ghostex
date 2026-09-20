//! The project slot hotkeys, cmd+1 to cmd+9: the port of `runNativeProjectSlotHotkey`'s reads.
//!
//! CDXC:Sidebar 2026-09-21 WHY:
//! This one is not a sidebar command and never was. It arrives as `gpuiProjectSlotHotkey`, a THIRD
//! route beside the two sidebar-command envelopes, and it reaches into the collapse state and
//! DELETES two keys directly: the project's collapsed flag, and (with
//! `showLessForExpandedProjectJumps` on) its session list's expanded flag. The second one fought the
//! Rust reveal that follows the same jump, because `reveal_plan` may ask for exactly the storage id
//! the hotkey had just removed, so the two wrote opposite values for one key on every jump.
//!
//! What is ported here is the READ: which project the slot names, whether it was collapsed, and
//! which storage id the session list is keyed by. The focus, the reveal request and the toast stay
//! where they are; this is the state the two sides were fighting over, not the jump itself.
//!
//! DELETE, not toggle. `runNativeProjectSlotHotkey` removes both keys, so a jump to a project that
//! is already expanded leaves it expanded, where a toggle would collapse it.
//!
//! SEE-ALSO: apps/desktop/sidebar/native-sidebar/hotkeys.ts (`runNativeProjectSlotHotkey`),
//! packages/gx-core/src/sidebar_ui/intents.rs (`ExpandProjectForSlotJump`).

use super::inputs::{SidebarSettings, SidebarUiState};
use super::view::SidebarView;

/// What a slot hotkey changes about the sidebar's own state.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectSlotPlan {
    pub group_id: String,
    /// The group was collapsed when the key was pressed, which is the TypeScript's `collapsed` and
    /// decides both branches below.
    pub was_collapsed: bool,
    /// Expand the group: it was collapsed and `expandCollapsedProjectsOnJump` is on.
    pub expand_group: bool,
    /// The session list to put back to its compact form, which is the same branch plus
    /// `showLessForExpandedProjectJumps`.
    pub collapse_session_list_storage_id: Option<String>,
    /// The group draws a row to jump to. `runNativeProjectSlotHotkey` selects a session only when
    /// one exists, and the multi-selection is cleared by that selection and not by the jump, so a
    /// slot naming an empty project leaves the selection alone.
    pub has_session: bool,
}

/// The project a slot names, and what the jump does to its collapse state.
///
/// `None` for a slot outside 1 to 9 and for a slot with no project behind it, which is what the
/// TypeScript's two early returns are: the Nth LOCAL group of the drawn list, and only when that
/// group is a project (a machine's Chats collection is not).
pub fn project_slot_plan(
    view: &SidebarView,
    ui: &SidebarUiState,
    settings: &SidebarSettings,
    slot_number: u32,
) -> Option<ProjectSlotPlan> {
    if !(1..=9).contains(&slot_number) {
        return None;
    }
    let group = view
        .groups
        .iter()
        // `!group.remoteMachineContext`: this computer's groups, in the order the list draws them.
        .filter(|group| group.core.remote_machine.is_none())
        .nth(slot_number as usize - 1)?;
    group.core.project_context.as_ref()?;
    let was_collapsed = ui.collapse.collapsed_groups.contains(&group.core.group_id);
    let expand_group = was_collapsed && settings.expand_collapsed_projects_on_jump;
    Some(ProjectSlotPlan {
        group_id: group.core.group_id.clone(),
        was_collapsed,
        expand_group,
        has_session: !group.core.sessions.is_empty(),
        collapse_session_list_storage_id: (expand_group
            && settings.show_less_for_expanded_project_jumps)
            .then(|| group.core.storage_id.clone()),
    })
}
