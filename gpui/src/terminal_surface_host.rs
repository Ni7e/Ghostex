use std::collections::{HashMap, HashSet};

use gpui::{Bounds, Pixels};

use crate::{
    AgentsTerminalBodyMountSlotId, CommandTerminalBodyMountSlotId, TerminalSurfaceMountSlotKey,
};

/*
CDXC:GPUTerminalSurfaceHost 2026-06-22-22:45:
Phase 2 native terminal parity needs App-owned runtime host boundaries before GPUI can safely create real libghostty AppKit child views. This synchronizer plans normal-layout attachments for current visible terminal mount slots and their recorded body bounds, but it must stay inert: no fake terminal surface, process, command text, output, fallback mount, logging, persistence, overlay, hidden hit region, AppKit hook, or libghostty call is allowed here.

CDXC:GPUTerminalSurfaceHost 2026-06-22-22:45:
The platform adapter needs typed runtime commands derived by reconciling previous validated host plans against the latest all-visible slot plans. Commands may only carry host id, slot id, and exact body bounds so stale cleanup, attach/show, and move/resize stay executable without exposing command text, terminal content, output, paths, URLs, titles, or user text.

CDXC:GPUTerminalAppKitAdapter 2026-06-22-20:58:
Platform-command conversion stays pure and runtime-only until a future slice supplies a real terminal NSView pointer. The converted AppKit payload preserves GPUI body bounds without CEF-style integer rounding so the native terminal view can stay inside the measured body rectangle instead of overlapping tab bars, split handles, sidebars, CEF, or command-pane chrome.

CDXC:GPUTerminalSurfaceHost 2026-06-22-22:45:
Per-render GPUI bounds resets are not terminal removals. When Agents mode is visible and current running slots exist but body canvases have not recorded this frame's bounds yet, preserve their runtime host/lifecycle identities and wait for recorded bounds; clear stale state only when Agents is hidden or slots are no longer current.

CDXC:GPUTerminalSurfaceHost 2026-06-22-22:45:
The Phase 2 all-visible-leaf expansion plans one runtime host per rendered Agents leaf whose selected session is Running. Reconcile by stable pane/session slot id so visible non-focused leaves can mount real surfaces while hidden, sleeping, missing, inactive-tab, and non-Agents slots detach without fallback views or overlap.

CDXC:GPUICommandTerminalSurface 2026-06-23-05:03:
The host reconciler is shared by Agents and command-pane terminal bodies through a typed mount-slot key. Command panes instantiate it with command group/session ids only, so command hosts remain isolated from Agents workspace maps, startup maps, shell-state JSON, and launch payload sources while still using the same normal AppKit child-view pipeline.
*/
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct NativeTerminalSurfaceHostId<SlotId = AgentsTerminalBodyMountSlotId> {
    pub(crate) slot_id: SlotId,
}

impl<SlotId> NativeTerminalSurfaceHostId<SlotId> {
    pub(crate) fn from_slot_id(slot_id: SlotId) -> Self {
        Self { slot_id }
    }
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) struct NativeTerminalSurfaceAttachmentPlan<SlotId = AgentsTerminalBodyMountSlotId> {
    pub(crate) host_id: NativeTerminalSurfaceHostId<SlotId>,
    pub(crate) slot_id: SlotId,
    pub(crate) bounds: Bounds<Pixels>,
}

impl<SlotId: Copy + PartialEq> NativeTerminalSurfaceAttachmentPlan<SlotId> {
    fn new(slot_id: SlotId, bounds: Bounds<Pixels>) -> Self {
        Self {
            host_id: NativeTerminalSurfaceHostId::from_slot_id(slot_id),
            slot_id,
            bounds,
        }
    }

    pub(crate) fn same_attachment_identity(self, other: Self) -> bool {
        self.host_id == other.host_id && self.slot_id == other.slot_id
    }
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum NativeTerminalSurfaceHostCommand<SlotId = AgentsTerminalBodyMountSlotId> {
    AttachOrShow {
        plan: NativeTerminalSurfaceAttachmentPlan<SlotId>,
    },
    MoveOrResize {
        plan: NativeTerminalSurfaceAttachmentPlan<SlotId>,
    },
    HideAndDetach {
        plan: NativeTerminalSurfaceAttachmentPlan<SlotId>,
    },
    NoOp {
        plan: NativeTerminalSurfaceAttachmentPlan<SlotId>,
    },
}

#[cfg(test)]
#[derive(Clone, Copy, PartialEq)]
enum NativeTerminalSurfaceHostSyncAction<SlotId = AgentsTerminalBodyMountSlotId> {
    AwaitingVisibleSlotBounds {
        slot_id: SlotId,
    },
    ReconcileVisibleSlotWithBounds {
        plan: NativeTerminalSurfaceAttachmentPlan<SlotId>,
    },
    ClearBecauseAgentsWorkspaceHidden,
    ClearBecauseNoCurrentSlot,
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct NativeTerminalSurfacePlatformBounds {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[allow(dead_code)]
impl NativeTerminalSurfacePlatformBounds {
    pub(crate) fn from_gpui_bounds(bounds: Bounds<Pixels>) -> Self {
        Self {
            x: bounds.origin.x.as_f32() as f64,
            y: bounds.origin.y.as_f32() as f64,
            width: bounds.size.width.as_f32().max(0.0) as f64,
            height: bounds.size.height.as_f32().max(0.0) as f64,
        }
    }
}

#[allow(dead_code)]
#[derive(Clone, Copy, PartialEq)]
pub(crate) struct NativeTerminalSurfacePlatformCommandPayload<
    SlotId = AgentsTerminalBodyMountSlotId,
> {
    pub(crate) host_id: NativeTerminalSurfaceHostId<SlotId>,
    pub(crate) slot_id: SlotId,
    pub(crate) bounds: NativeTerminalSurfacePlatformBounds,
}

#[allow(dead_code)]
impl<SlotId: Copy> NativeTerminalSurfacePlatformCommandPayload<SlotId> {
    fn from_plan(plan: NativeTerminalSurfaceAttachmentPlan<SlotId>) -> Self {
        Self {
            host_id: plan.host_id,
            slot_id: plan.slot_id,
            bounds: NativeTerminalSurfacePlatformBounds::from_gpui_bounds(plan.bounds),
        }
    }
}

#[allow(dead_code)]
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum NativeTerminalSurfacePlatformCommand<SlotId = AgentsTerminalBodyMountSlotId> {
    AttachOrShow {
        payload: NativeTerminalSurfacePlatformCommandPayload<SlotId>,
    },
    MoveOrResize {
        payload: NativeTerminalSurfacePlatformCommandPayload<SlotId>,
    },
    HideAndDetach {
        payload: NativeTerminalSurfacePlatformCommandPayload<SlotId>,
    },
    NoOp {
        payload: NativeTerminalSurfacePlatformCommandPayload<SlotId>,
    },
}

impl<SlotId: Copy> NativeTerminalSurfaceHostCommand<SlotId> {
    #[allow(dead_code)]
    pub(crate) fn to_platform_command(self) -> NativeTerminalSurfacePlatformCommand<SlotId> {
        match self {
            Self::AttachOrShow { plan } => NativeTerminalSurfacePlatformCommand::AttachOrShow {
                payload: NativeTerminalSurfacePlatformCommandPayload::from_plan(plan),
            },
            Self::MoveOrResize { plan } => NativeTerminalSurfacePlatformCommand::MoveOrResize {
                payload: NativeTerminalSurfacePlatformCommandPayload::from_plan(plan),
            },
            Self::HideAndDetach { plan } => NativeTerminalSurfacePlatformCommand::HideAndDetach {
                payload: NativeTerminalSurfacePlatformCommandPayload::from_plan(plan),
            },
            Self::NoOp { plan } => NativeTerminalSurfacePlatformCommand::NoOp {
                payload: NativeTerminalSurfacePlatformCommandPayload::from_plan(plan),
            },
        }
    }
}

pub(super) struct NativeTerminalSurfaceHost<SlotId = AgentsTerminalBodyMountSlotId> {
    active_plans: HashMap<SlotId, NativeTerminalSurfaceAttachmentPlan<SlotId>>,
}

impl<SlotId> Default for NativeTerminalSurfaceHost<SlotId> {
    fn default() -> Self {
        Self {
            active_plans: HashMap::new(),
        }
    }
}

impl<SlotId> NativeTerminalSurfaceHost<SlotId>
where
    SlotId: TerminalSurfaceMountSlotKey,
{
    pub(super) fn new() -> Self {
        Self::default()
    }

    #[cfg(test)]
    pub(super) fn active_plan(&self) -> Option<NativeTerminalSurfaceAttachmentPlan<SlotId>> {
        if self.active_plans.len() == 1 {
            self.active_plans.values().copied().next()
        } else {
            None
        }
    }

    #[cfg(test)]
    pub(super) fn active_plan_for(
        &self,
        slot_id: SlotId,
    ) -> Option<NativeTerminalSurfaceAttachmentPlan<SlotId>> {
        self.active_plans.get(&slot_id).copied()
    }

    #[cfg(test)]
    pub(super) fn active_plans(&self) -> Vec<NativeTerminalSurfaceAttachmentPlan<SlotId>> {
        let mut plans = self.active_plans.values().copied().collect::<Vec<_>>();
        plans.sort_by_key(|plan| plan.slot_id.terminal_surface_sort_key());
        plans
    }

    pub(crate) fn sync_visible_slots(
        &mut self,
        surface_visible: bool,
        current_slot_ids: &[SlotId],
        recorded_bounds: &HashMap<SlotId, Bounds<Pixels>>,
    ) -> Vec<NativeTerminalSurfaceHostCommand<SlotId>> {
        if !surface_visible {
            return self.reconcile_to_plans(&[], Vec::new());
        }

        let mut seen_slot_ids = HashSet::new();
        let mut current_visible_slot_ids = Vec::new();
        let mut next_plans = Vec::new();

        for slot_id in current_slot_ids.iter().copied() {
            if !seen_slot_ids.insert(slot_id) {
                continue;
            }
            current_visible_slot_ids.push(slot_id);

            if let Some(bounds) = recorded_bounds.get(&slot_id).copied() {
                next_plans.push(NativeTerminalSurfaceAttachmentPlan::new(slot_id, bounds));
            }
        }

        self.reconcile_to_plans(&current_visible_slot_ids, next_plans)
    }

    fn reconcile_to_plans(
        &mut self,
        current_slot_ids: &[SlotId],
        next_plans: Vec<NativeTerminalSurfaceAttachmentPlan<SlotId>>,
    ) -> Vec<NativeTerminalSurfaceHostCommand<SlotId>> {
        let mut commands = Vec::new();
        let current_slot_ids = current_slot_ids.iter().copied().collect::<HashSet<_>>();
        let stale_slot_ids = self
            .active_plans
            .keys()
            .copied()
            .filter(|slot_id| !current_slot_ids.contains(slot_id))
            .collect::<Vec<_>>();

        for stale_slot_id in stale_slot_ids {
            if let Some(stale_plan) = self.active_plans.remove(&stale_slot_id) {
                commands.push(NativeTerminalSurfaceHostCommand::HideAndDetach { plan: stale_plan });
            }
        }

        for next_plan in next_plans {
            let previous_plan = self.active_plans.get(&next_plan.slot_id).copied();
            commands.extend(Self::reconcile_plans(previous_plan, Some(next_plan)));
            self.active_plans.insert(next_plan.slot_id, next_plan);
        }

        commands
    }
    fn reconcile_plans(
        previous_plan: Option<NativeTerminalSurfaceAttachmentPlan<SlotId>>,
        next_plan: Option<NativeTerminalSurfaceAttachmentPlan<SlotId>>,
    ) -> Vec<NativeTerminalSurfaceHostCommand<SlotId>> {
        match (previous_plan, next_plan) {
            (None, None) => Vec::new(),
            (None, Some(plan)) => vec![NativeTerminalSurfaceHostCommand::AttachOrShow { plan }],
            (Some(plan), None) => vec![NativeTerminalSurfaceHostCommand::HideAndDetach { plan }],
            (Some(previous), Some(next)) if previous == next => {
                vec![NativeTerminalSurfaceHostCommand::NoOp { plan: next }]
            }
            (Some(previous), Some(next)) if previous.same_attachment_identity(next) => {
                vec![NativeTerminalSurfaceHostCommand::MoveOrResize { plan: next }]
            }
            (Some(previous), Some(next)) => vec![
                NativeTerminalSurfaceHostCommand::HideAndDetach { plan: previous },
                NativeTerminalSurfaceHostCommand::AttachOrShow { plan: next },
            ],
        }
    }
}

impl NativeTerminalSurfaceHost<AgentsTerminalBodyMountSlotId> {
    pub(crate) fn sync_visible_agents_slots(
        &mut self,
        agents_workspace_visible: bool,
        current_slot_ids: &[AgentsTerminalBodyMountSlotId],
        recorded_bounds: &HashMap<AgentsTerminalBodyMountSlotId, Bounds<Pixels>>,
    ) -> Vec<NativeTerminalSurfaceHostCommand> {
        self.sync_visible_slots(agents_workspace_visible, current_slot_ids, recorded_bounds)
    }

    #[cfg(test)]
    fn visible_agents_slot_sync_action(
        agents_workspace_visible: bool,
        current_slot_ids: &[AgentsTerminalBodyMountSlotId],
        recorded_bounds: &HashMap<AgentsTerminalBodyMountSlotId, Bounds<Pixels>>,
    ) -> NativeTerminalSurfaceHostSyncAction {
        if !agents_workspace_visible {
            return NativeTerminalSurfaceHostSyncAction::ClearBecauseAgentsWorkspaceHidden;
        }

        let &[slot_id] = current_slot_ids else {
            return NativeTerminalSurfaceHostSyncAction::ClearBecauseNoCurrentSlot;
        };
        let Some(bounds) = recorded_bounds.get(&slot_id).copied() else {
            return NativeTerminalSurfaceHostSyncAction::AwaitingVisibleSlotBounds { slot_id };
        };

        NativeTerminalSurfaceHostSyncAction::ReconcileVisibleSlotWithBounds {
            plan: NativeTerminalSurfaceAttachmentPlan::new(slot_id, bounds),
        }
    }
}

impl NativeTerminalSurfaceHost<CommandTerminalBodyMountSlotId> {
    pub(crate) fn sync_visible_command_slots(
        &mut self,
        command_pane_expanded: bool,
        current_slot_ids: &[CommandTerminalBodyMountSlotId],
        recorded_bounds: &HashMap<CommandTerminalBodyMountSlotId, Bounds<Pixels>>,
    ) -> Vec<NativeTerminalSurfaceHostCommand<CommandTerminalBodyMountSlotId>> {
        self.sync_visible_slots(command_pane_expanded, current_slot_ids, recorded_bounds)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{TerminalSessionId, WorkspacePaneId};

    fn slot(pane_id: u64, session_id: u64) -> AgentsTerminalBodyMountSlotId {
        AgentsTerminalBodyMountSlotId {
            pane_id: WorkspacePaneId(pane_id),
            session_id: TerminalSessionId(session_id),
        }
    }

    fn test_bounds(left: f32, top: f32, width: f32, height: f32) -> Bounds<Pixels> {
        Bounds::from_corners(
            gpui::point(gpui::px(left), gpui::px(top)),
            gpui::point(gpui::px(left + width), gpui::px(top + height)),
        )
    }

    fn bounds_map(
        slot_id: AgentsTerminalBodyMountSlotId,
        bounds: Bounds<Pixels>,
    ) -> HashMap<AgentsTerminalBodyMountSlotId, Bounds<Pixels>> {
        HashMap::from([(slot_id, bounds)])
    }

    fn assert_single_attach_or_show(
        commands: &[NativeTerminalSurfaceHostCommand],
        plan: NativeTerminalSurfaceAttachmentPlan,
    ) {
        assert!(commands.len() == 1);
        assert!(matches!(
            commands[0],
            NativeTerminalSurfaceHostCommand::AttachOrShow { plan: actual } if actual == plan
        ));
    }

    fn assert_single_move_or_resize(
        commands: &[NativeTerminalSurfaceHostCommand],
        plan: NativeTerminalSurfaceAttachmentPlan,
    ) {
        assert!(commands.len() == 1);
        assert!(matches!(
            commands[0],
            NativeTerminalSurfaceHostCommand::MoveOrResize { plan: actual } if actual == plan
        ));
    }

    fn assert_single_hide_and_detach(
        commands: &[NativeTerminalSurfaceHostCommand],
        plan: NativeTerminalSurfaceAttachmentPlan,
    ) {
        assert!(commands.len() == 1);
        assert!(matches!(
            commands[0],
            NativeTerminalSurfaceHostCommand::HideAndDetach { plan: actual } if actual == plan
        ));
    }

    fn assert_single_no_op(
        commands: &[NativeTerminalSurfaceHostCommand],
        plan: NativeTerminalSurfaceAttachmentPlan,
    ) {
        assert!(commands.len() == 1);
        assert!(matches!(
            commands[0],
            NativeTerminalSurfaceHostCommand::NoOp { plan: actual } if actual == plan
        ));
    }

    fn assert_platform_payload(
        payload: NativeTerminalSurfacePlatformCommandPayload,
        plan: NativeTerminalSurfaceAttachmentPlan,
    ) {
        let NativeTerminalSurfacePlatformCommandPayload {
            host_id,
            slot_id,
            bounds,
        } = payload;

        assert!(host_id == plan.host_id);
        assert!(slot_id == plan.slot_id);
        assert!(bounds == NativeTerminalSurfacePlatformBounds::from_gpui_bounds(plan.bounds));
    }

    #[test]
    fn initial_plan_reconciles_to_attach_show_command() {
        let slot_id = slot(10, 101);
        let bounds = test_bounds(12.0, 24.0, 640.0, 360.0);
        let expected_plan = NativeTerminalSurfaceAttachmentPlan::new(slot_id, bounds);
        let mut host = NativeTerminalSurfaceHost::new();

        let commands =
            host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, bounds));

        assert_single_attach_or_show(&commands, expected_plan);
        assert!(
            host.active_plan()
                .is_some_and(|active_plan| active_plan == expected_plan)
        );
    }

    #[test]
    fn unchanged_plan_reconciles_to_no_op_command() {
        let slot_id = slot(10, 101);
        let bounds = test_bounds(12.0, 24.0, 640.0, 360.0);
        let expected_plan = NativeTerminalSurfaceAttachmentPlan::new(slot_id, bounds);
        let mut host = NativeTerminalSurfaceHost::new();
        host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, bounds));

        let commands =
            host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, bounds));

        assert_single_no_op(&commands, expected_plan);
        assert!(
            host.active_plan()
                .is_some_and(|active_plan| active_plan == expected_plan)
        );
    }

    #[test]
    fn sync_action_distinguishes_hidden_no_slot_and_awaiting_visible_bounds() {
        let slot_id = slot(10, 101);
        let bounds = test_bounds(12.0, 24.0, 640.0, 360.0);
        let empty_bounds: HashMap<AgentsTerminalBodyMountSlotId, Bounds<Pixels>> = HashMap::new();

        assert!(matches!(
            NativeTerminalSurfaceHost::visible_agents_slot_sync_action(
                false,
                &[slot_id],
                &empty_bounds,
            ),
            NativeTerminalSurfaceHostSyncAction::ClearBecauseAgentsWorkspaceHidden
        ));
        assert!(matches!(
            NativeTerminalSurfaceHost::visible_agents_slot_sync_action(
                true,
                &[],
                &bounds_map(slot_id, bounds),
            ),
            NativeTerminalSurfaceHostSyncAction::ClearBecauseNoCurrentSlot
        ));
        assert!(matches!(
            NativeTerminalSurfaceHost::visible_agents_slot_sync_action(
                true,
                &[slot_id],
                &empty_bounds,
            ),
            NativeTerminalSurfaceHostSyncAction::AwaitingVisibleSlotBounds {
                slot_id: awaiting_slot_id
            } if awaiting_slot_id == slot_id
        ));
        assert!(matches!(
            NativeTerminalSurfaceHost::visible_agents_slot_sync_action(
                true,
                &[slot_id],
                &bounds_map(slot_id, bounds),
            ),
            NativeTerminalSurfaceHostSyncAction::ReconcileVisibleSlotWithBounds { plan }
                if plan == NativeTerminalSurfaceAttachmentPlan::new(slot_id, bounds)
        ));
    }

    #[test]
    fn pre_layout_bounds_reset_preserves_active_plan_until_same_bounds_record() {
        let slot_id = slot(10, 101);
        let bounds = test_bounds(12.0, 24.0, 640.0, 360.0);
        let expected_plan = NativeTerminalSurfaceAttachmentPlan::new(slot_id, bounds);
        let empty_bounds: HashMap<AgentsTerminalBodyMountSlotId, Bounds<Pixels>> = HashMap::new();
        let mut host = NativeTerminalSurfaceHost::new();
        host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, bounds));

        let reset_commands = host.sync_visible_agents_slots(true, &[slot_id], &empty_bounds);

        assert!(reset_commands.is_empty());
        assert!(
            host.active_plan()
                .is_some_and(|active_plan| active_plan == expected_plan)
        );

        let commands =
            host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, bounds));

        assert_single_no_op(&commands, expected_plan);
        assert!(
            host.active_plan()
                .is_some_and(|active_plan| active_plan == expected_plan)
        );
    }

    #[test]
    fn same_host_changed_bounds_reconciles_to_move_resize_only() {
        let slot_id = slot(10, 101);
        let first_bounds = test_bounds(12.0, 24.0, 640.0, 360.0);
        let next_bounds = test_bounds(18.0, 30.0, 720.0, 390.0);
        let expected_plan = NativeTerminalSurfaceAttachmentPlan::new(slot_id, next_bounds);
        let mut host = NativeTerminalSurfaceHost::new();
        host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, first_bounds));

        let commands =
            host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, next_bounds));

        assert_single_move_or_resize(&commands, expected_plan);
        assert!(
            host.active_plan()
                .is_some_and(|active_plan| active_plan == expected_plan)
        );
    }

    #[test]
    fn changed_bounds_after_pre_layout_reset_preserves_identity_and_moves() {
        let slot_id = slot(10, 101);
        let first_bounds = test_bounds(12.0, 24.0, 640.0, 360.0);
        let next_bounds = test_bounds(18.0, 30.0, 720.0, 390.0);
        let first_plan = NativeTerminalSurfaceAttachmentPlan::new(slot_id, first_bounds);
        let expected_plan = NativeTerminalSurfaceAttachmentPlan::new(slot_id, next_bounds);
        let empty_bounds: HashMap<AgentsTerminalBodyMountSlotId, Bounds<Pixels>> = HashMap::new();
        let mut host = NativeTerminalSurfaceHost::new();
        host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, first_bounds));

        let reset_commands = host.sync_visible_agents_slots(true, &[slot_id], &empty_bounds);
        let commands =
            host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, next_bounds));

        assert!(reset_commands.is_empty());
        assert_single_move_or_resize(&commands, expected_plan);
        assert!(expected_plan.same_attachment_identity(first_plan));
        assert!(
            host.active_plan()
                .is_some_and(|active_plan| active_plan == expected_plan)
        );
    }

    #[test]
    fn removed_plan_reconciles_to_hide_detach_and_clears_active_state() {
        let slot_id = slot(10, 101);
        let bounds = test_bounds(12.0, 24.0, 640.0, 360.0);
        let stale_plan = NativeTerminalSurfaceAttachmentPlan::new(slot_id, bounds);
        let mut host = NativeTerminalSurfaceHost::new();
        host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, bounds));

        let commands = host.sync_visible_agents_slots(true, &[], &bounds_map(slot_id, bounds));

        assert_single_hide_and_detach(&commands, stale_plan);
        assert!(host.active_plan().is_none());
    }

    #[test]
    fn hidden_agents_workspace_reconciles_to_hide_detach_and_clears_active_state() {
        let slot_id = slot(10, 101);
        let bounds = test_bounds(12.0, 24.0, 640.0, 360.0);
        let stale_plan = NativeTerminalSurfaceAttachmentPlan::new(slot_id, bounds);
        let empty_bounds: HashMap<AgentsTerminalBodyMountSlotId, Bounds<Pixels>> = HashMap::new();
        let mut host = NativeTerminalSurfaceHost::new();
        host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, bounds));

        let commands = host.sync_visible_agents_slots(false, &[slot_id], &empty_bounds);

        assert_single_hide_and_detach(&commands, stale_plan);
        assert!(host.active_plan().is_none());
    }

    #[test]
    fn changed_identity_reconciles_to_detach_old_then_attach_new() {
        let first_slot = slot(10, 101);
        let next_slot = slot(20, 201);
        let first_bounds = test_bounds(12.0, 24.0, 640.0, 360.0);
        let next_bounds = test_bounds(700.0, 24.0, 640.0, 360.0);
        let first_plan = NativeTerminalSurfaceAttachmentPlan::new(first_slot, first_bounds);
        let next_plan = NativeTerminalSurfaceAttachmentPlan::new(next_slot, next_bounds);
        let mut host = NativeTerminalSurfaceHost::new();
        host.sync_visible_agents_slots(true, &[first_slot], &bounds_map(first_slot, first_bounds));

        let commands =
            host.sync_visible_agents_slots(true, &[next_slot], &bounds_map(next_slot, next_bounds));

        assert!(commands.len() == 2);
        assert!(matches!(
            commands[0],
            NativeTerminalSurfaceHostCommand::HideAndDetach { plan } if plan == first_plan
        ));
        assert!(matches!(
            commands[1],
            NativeTerminalSurfaceHostCommand::AttachOrShow { plan } if plan == next_plan
        ));
        assert!(
            host.active_plan()
                .is_some_and(|active_plan| active_plan == next_plan)
        );
    }

    #[test]
    fn non_current_slot_bounds_do_not_produce_commands() {
        let focused_slot = slot(10, 101);
        let non_focused_slot = slot(20, 201);
        let focused_bounds = test_bounds(12.0, 24.0, 640.0, 360.0);
        let non_focused_bounds = test_bounds(700.0, 24.0, 640.0, 360.0);
        let mut host = NativeTerminalSurfaceHost::new();

        let commands = host.sync_visible_agents_slots(
            true,
            &[focused_slot],
            &bounds_map(non_focused_slot, non_focused_bounds),
        );

        assert!(commands.is_empty());
        assert!(host.active_plan().is_none());

        host.sync_visible_agents_slots(
            true,
            &[focused_slot],
            &bounds_map(focused_slot, focused_bounds),
        );
        let focused_plan = host.active_plan().unwrap();

        let reset_commands = host.sync_visible_agents_slots(
            true,
            &[focused_slot],
            &bounds_map(non_focused_slot, non_focused_bounds),
        );

        assert!(reset_commands.is_empty());
        assert!(
            host.active_plan()
                .is_some_and(|active_plan| active_plan == focused_plan)
        );
    }

    #[test]
    fn platform_bounds_preserve_exact_gpui_body_values_without_rounding() {
        let bounds = Bounds::from_corners(
            gpui::point(gpui::px(12.25), gpui::px(24.5)),
            gpui::point(gpui::px(652.75), gpui::px(384.125)),
        );

        let platform_bounds = NativeTerminalSurfacePlatformBounds::from_gpui_bounds(bounds);

        assert!(
            platform_bounds
                == NativeTerminalSurfacePlatformBounds {
                    x: 12.25,
                    y: 24.5,
                    width: 640.5,
                    height: 359.625,
                }
        );
    }

    #[test]
    fn platform_command_payload_contains_only_host_slot_and_bounds_for_each_variant() {
        let slot_id = slot(10, 101);
        let bounds = test_bounds(12.0, 24.0, 640.0, 360.0);
        let plan = NativeTerminalSurfaceAttachmentPlan::new(slot_id, bounds);

        assert!(matches!(
            NativeTerminalSurfaceHostCommand::AttachOrShow { plan }
                .to_platform_command(),
            NativeTerminalSurfacePlatformCommand::AttachOrShow { payload }
                if {
                    assert_platform_payload(payload, plan);
                    true
                }
        ));
        assert!(matches!(
            NativeTerminalSurfaceHostCommand::MoveOrResize { plan }
                .to_platform_command(),
            NativeTerminalSurfacePlatformCommand::MoveOrResize { payload }
                if {
                    assert_platform_payload(payload, plan);
                    true
                }
        ));
        assert!(matches!(
            NativeTerminalSurfaceHostCommand::HideAndDetach { plan }
                .to_platform_command(),
            NativeTerminalSurfacePlatformCommand::HideAndDetach { payload }
                if {
                    assert_platform_payload(payload, plan);
                    true
                }
        ));
        assert!(matches!(
            NativeTerminalSurfaceHostCommand::NoOp { plan }.to_platform_command(),
            NativeTerminalSurfacePlatformCommand::NoOp { payload }
                if {
                    assert_platform_payload(payload, plan);
                    true
                }
        ));
    }

    #[test]
    fn unchanged_plan_platform_conversion_stays_no_op() {
        let slot_id = slot(10, 101);
        let bounds = test_bounds(12.0, 24.0, 640.0, 360.0);
        let expected_plan = NativeTerminalSurfaceAttachmentPlan::new(slot_id, bounds);
        let mut host = NativeTerminalSurfaceHost::new();
        host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, bounds));

        let commands =
            host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, bounds));
        let platform_command = commands[0].to_platform_command();

        assert_single_no_op(&commands, expected_plan);
        assert!(matches!(
            platform_command,
            NativeTerminalSurfacePlatformCommand::NoOp { payload }
                if {
                    assert_platform_payload(payload, expected_plan);
                    true
                }
        ));
    }
}
