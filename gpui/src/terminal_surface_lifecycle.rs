#![allow(dead_code)]

use std::collections::HashMap;

#[cfg(target_os = "macos")]
use crate::terminal_native_view::RealTerminalNativeViewHandle;
#[cfg(target_os = "macos")]
use crate::terminal_surface_host::NativeTerminalSurfacePlatformCommand;
use crate::terminal_surface_host::{
    NativeTerminalSurfaceAttachmentPlan, NativeTerminalSurfaceHostCommand,
};
use crate::{AgentsTerminalBodyMountSlotId, TerminalSurfaceMountSlotKey};

/*
CDXC:GPUTerminalSurfaceLifecycle 2026-06-22-22:45:
The native-view lifecycle boundary is runtime-only for every current visible running Agents terminal mount slot. Host reconciliation commands may only become AppKit/Ghostty work after the slot has a supplied real native terminal view; awaiting state records only the current slot plan and must not manufacture handles, create views, call GhosttyKit/libghostty, build Ghostty surface configs, execute AppKit, log, persist, overlay, route hit tests, or launch/restart the app.

CDXC:GPUTerminalSurfaceLifecycle 2026-06-22-21:27:
Slice 107 depends on empty host command batches being meaningful no-ops during visible Agents pre-layout bounds resets. The lifecycle must keep its awaiting real-view slot until host sync later reports same-bounds NoOp, move/resize, hidden workspace, or no-current-slot detach commands.

CDXC:GPUTerminalSurfaceLifecycle 2026-06-22-22:45:
The App may own one runtime host NSView per visible running Agents mount slot. A lifecycle slot may move from awaiting to ready only after an owned host view is created for the exact same plan, and this state still must not execute AppKit commands, build Ghostty configs, call GhosttyKit/libghostty, log, persist, show, focus, or launch a terminal.

CDXC:GPUTerminalSurfaceLifecycle 2026-06-22-22:45:
The all-visible-running-leaf slice keeps lifecycle state per pane/session mount slot. Adding, resizing, or detaching one visible Agents terminal must not clear unrelated visible running slots, and each slot still requires an explicit real App-owned host view before AppKit or Ghostty work can proceed.

CDXC:GPUICommandTerminalSurface 2026-06-23-05:03:
Command-pane runtime terminal bodies use the same lifecycle state machine with command group/session slot ids. The shared lifecycle never crosses into Agents startup/session registries or shell-state persistence; command collapse and close reconcile as ordinary detach commands before AppKit host views are released.
*/
pub(crate) struct NativeTerminalSurfaceLifecycleState<SlotId = AgentsTerminalBodyMountSlotId> {
    active_slots: HashMap<SlotId, NativeTerminalSurfaceLifecycleSlot<SlotId>>,
}

impl<SlotId> Default for NativeTerminalSurfaceLifecycleState<SlotId> {
    fn default() -> Self {
        Self {
            active_slots: HashMap::new(),
        }
    }
}

impl<SlotId> NativeTerminalSurfaceLifecycleState<SlotId>
where
    SlotId: TerminalSurfaceMountSlotKey,
{
    pub(crate) fn new() -> Self {
        Self::default()
    }

    #[cfg(test)]
    pub(crate) fn active_plan(&self) -> Option<NativeTerminalSurfaceAttachmentPlan<SlotId>> {
        if self.active_slots.len() == 1 {
            self.active_slots.values().map(|slot| slot.plan).next()
        } else {
            None
        }
    }

    #[cfg(test)]
    pub(crate) fn active_plan_for(
        &self,
        slot_id: SlotId,
    ) -> Option<NativeTerminalSurfaceAttachmentPlan<SlotId>> {
        self.active_slots.get(&slot_id).map(|slot| slot.plan)
    }

    #[cfg(test)]
    pub(crate) fn active_plans(&self) -> Vec<NativeTerminalSurfaceAttachmentPlan<SlotId>> {
        let mut plans = self
            .active_slots
            .values()
            .map(|slot| slot.plan)
            .collect::<Vec<_>>();
        plans.sort_by_key(|plan| plan.slot_id.terminal_surface_sort_key());
        plans
    }

    #[cfg(test)]
    fn active_slot_is_awaiting_real_native_view(&self) -> bool {
        self.active_slots.len() == 1
            && self.active_slots.values().all(|slot| {
                matches!(
                    slot.native_view,
                    NativeTerminalNativeViewState::AwaitingRealNativeView
                )
            })
    }

    #[cfg(test)]
    fn active_slot_is_awaiting_real_native_view_for(&self, slot_id: SlotId) -> bool {
        self.active_slots.get(&slot_id).is_some_and(|slot| {
            matches!(
                slot.native_view,
                NativeTerminalNativeViewState::AwaitingRealNativeView
            )
        })
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn with_explicit_real_native_view(
        plan: NativeTerminalSurfaceAttachmentPlan<SlotId>,
        real_view: RealTerminalNativeViewHandle,
    ) -> Self {
        /*
        CDXC:GPUTerminalSurfaceLifecycle 2026-06-22-21:17:
        Ready lifecycle state can only be constructed around an explicit existing real terminal native view handle. This constructor does not create, retain, validate, log, persist, or operate on the view; the unsafe boundary remains the handle supplier.
        */
        Self {
            active_slots: HashMap::from([(
                plan.slot_id,
                NativeTerminalSurfaceLifecycleSlot {
                    plan,
                    native_view: NativeTerminalNativeViewState::Ready { real_view },
                },
            )]),
        }
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn mark_ready_with_real_native_view(
        &mut self,
        plan: NativeTerminalSurfaceAttachmentPlan<SlotId>,
        real_view: RealTerminalNativeViewHandle,
    ) -> bool {
        let Some(slot) = self.active_slots.get_mut(&plan.slot_id) else {
            return false;
        };
        if slot.plan != plan {
            return false;
        }

        *slot = NativeTerminalSurfaceLifecycleSlot {
            plan,
            native_view: NativeTerminalNativeViewState::Ready { real_view },
        };
        true
    }

    pub(crate) fn reconcile_host_commands(
        &mut self,
        commands: &[NativeTerminalSurfaceHostCommand<SlotId>],
    ) -> Vec<NativeTerminalSurfaceLifecycleDecision<SlotId>> {
        let mut decisions = Vec::new();

        for command in commands {
            decisions.extend(self.reconcile_host_command(*command));
        }

        decisions
    }

    fn reconcile_host_command(
        &mut self,
        command: NativeTerminalSurfaceHostCommand<SlotId>,
    ) -> Vec<NativeTerminalSurfaceLifecycleDecision<SlotId>> {
        match command {
            NativeTerminalSurfaceHostCommand::AttachOrShow { plan }
            | NativeTerminalSurfaceHostCommand::MoveOrResize { plan } => {
                self.reconcile_visible_plan(command, plan)
            }
            NativeTerminalSurfaceHostCommand::NoOp { plan } => {
                self.reconcile_no_op_plan(command, plan)
            }
            NativeTerminalSurfaceHostCommand::HideAndDetach { plan } => {
                self.reconcile_detached_plan(command, plan)
            }
        }
    }

    fn reconcile_visible_plan(
        &mut self,
        command: NativeTerminalSurfaceHostCommand<SlotId>,
        plan: NativeTerminalSurfaceAttachmentPlan<SlotId>,
    ) -> Vec<NativeTerminalSurfaceLifecycleDecision<SlotId>> {
        let native_view = self
            .active_slots
            .get(&plan.slot_id)
            .map(|slot| slot.native_view)
            .unwrap_or(NativeTerminalNativeViewState::AwaitingRealNativeView);

        self.active_slots.insert(
            plan.slot_id,
            NativeTerminalSurfaceLifecycleSlot { plan, native_view },
        );
        vec![decision_for_visible_command(command, native_view)]
    }

    fn reconcile_no_op_plan(
        &mut self,
        command: NativeTerminalSurfaceHostCommand<SlotId>,
        plan: NativeTerminalSurfaceAttachmentPlan<SlotId>,
    ) -> Vec<NativeTerminalSurfaceLifecycleDecision<SlotId>> {
        let native_view = self
            .active_slots
            .get(&plan.slot_id)
            .map(|slot| slot.native_view)
            .unwrap_or(NativeTerminalNativeViewState::AwaitingRealNativeView);

        self.active_slots.insert(
            plan.slot_id,
            NativeTerminalSurfaceLifecycleSlot { plan, native_view },
        );
        let decision = match native_view {
            NativeTerminalNativeViewState::AwaitingRealNativeView => {
                NativeTerminalSurfaceLifecycleDecision::NeedsRealNativeView { plan }
            }
            #[cfg(target_os = "macos")]
            NativeTerminalNativeViewState::Ready { .. } => {
                NativeTerminalSurfaceLifecycleDecision::NoOp { plan }
            }
        };

        let _ = command;
        vec![decision]
    }

    fn reconcile_detached_plan(
        &mut self,
        command: NativeTerminalSurfaceHostCommand<SlotId>,
        plan: NativeTerminalSurfaceAttachmentPlan<SlotId>,
    ) -> Vec<NativeTerminalSurfaceLifecycleDecision<SlotId>> {
        let Some(slot) = self.active_slots.get(&plan.slot_id).copied() else {
            return Vec::new();
        };

        if !slot.plan.same_attachment_identity(plan) {
            return Vec::new();
        }

        self.active_slots.remove(&plan.slot_id);
        match slot.native_view {
            NativeTerminalNativeViewState::AwaitingRealNativeView => Vec::new(),
            #[cfg(target_os = "macos")]
            NativeTerminalNativeViewState::Ready { real_view } => {
                vec![NativeTerminalSurfaceLifecycleDecision::DetachStaleView {
                    command: command.to_platform_command(),
                    real_view,
                }]
            }
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
struct NativeTerminalSurfaceLifecycleSlot<SlotId = AgentsTerminalBodyMountSlotId> {
    plan: NativeTerminalSurfaceAttachmentPlan<SlotId>,
    native_view: NativeTerminalNativeViewState,
}

#[derive(Clone, Copy, PartialEq)]
enum NativeTerminalNativeViewState {
    AwaitingRealNativeView,
    #[cfg(target_os = "macos")]
    Ready {
        real_view: RealTerminalNativeViewHandle,
    },
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum NativeTerminalSurfaceLifecycleDecision<SlotId = AgentsTerminalBodyMountSlotId> {
    NeedsRealNativeView {
        plan: NativeTerminalSurfaceAttachmentPlan<SlotId>,
    },
    #[cfg(target_os = "macos")]
    CanExecuteWithRealView {
        command: NativeTerminalSurfacePlatformCommand<SlotId>,
        real_view: RealTerminalNativeViewHandle,
    },
    #[cfg(target_os = "macos")]
    DetachStaleView {
        command: NativeTerminalSurfacePlatformCommand<SlotId>,
        real_view: RealTerminalNativeViewHandle,
    },
    NoOp {
        plan: NativeTerminalSurfaceAttachmentPlan<SlotId>,
    },
}

fn decision_for_visible_command<SlotId: Copy>(
    command: NativeTerminalSurfaceHostCommand<SlotId>,
    native_view: NativeTerminalNativeViewState,
) -> NativeTerminalSurfaceLifecycleDecision<SlotId> {
    let plan = match command {
        NativeTerminalSurfaceHostCommand::AttachOrShow { plan }
        | NativeTerminalSurfaceHostCommand::MoveOrResize { plan }
        | NativeTerminalSurfaceHostCommand::NoOp { plan }
        | NativeTerminalSurfaceHostCommand::HideAndDetach { plan } => plan,
    };

    match native_view {
        NativeTerminalNativeViewState::AwaitingRealNativeView => {
            NativeTerminalSurfaceLifecycleDecision::NeedsRealNativeView { plan }
        }
        #[cfg(target_os = "macos")]
        NativeTerminalNativeViewState::Ready { real_view } => {
            NativeTerminalSurfaceLifecycleDecision::CanExecuteWithRealView {
                command: command.to_platform_command(),
                real_view,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal_surface_host::NativeTerminalSurfaceHost;
    #[cfg(target_os = "macos")]
    use crate::terminal_surface_host::NativeTerminalSurfacePlatformCommand;
    use crate::{AgentsTerminalBodyMountSlotId, TerminalSessionId, WorkspacePaneId};
    use gpui::{Bounds, Pixels};
    use std::collections::HashMap;
    #[cfg(target_os = "macos")]
    use std::{ffi::c_void, ptr::NonNull};

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

    fn first_plan_from_commands(
        commands: &[NativeTerminalSurfaceHostCommand],
    ) -> NativeTerminalSurfaceAttachmentPlan {
        match commands[0] {
            NativeTerminalSurfaceHostCommand::AttachOrShow { plan }
            | NativeTerminalSurfaceHostCommand::MoveOrResize { plan }
            | NativeTerminalSurfaceHostCommand::HideAndDetach { plan }
            | NativeTerminalSurfaceHostCommand::NoOp { plan } => plan,
        }
    }

    #[cfg(target_os = "macos")]
    fn test_real_native_view_handle() -> RealTerminalNativeViewHandle {
        let pointer = NonNull::new(0x1000usize as *mut c_void).unwrap();
        unsafe { RealTerminalNativeViewHandle::from_existing_native_view(pointer) }
    }

    #[test]
    fn attach_show_without_real_view_needs_real_native_view() {
        let slot_id = slot(10, 101);
        let bounds = test_bounds(12.0, 24.0, 640.0, 360.0);
        let mut host = NativeTerminalSurfaceHost::new();
        let commands =
            host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, bounds));
        let expected_plan = first_plan_from_commands(&commands);
        let mut lifecycle = NativeTerminalSurfaceLifecycleState::new();

        let decisions = lifecycle.reconcile_host_commands(&commands);

        assert!(decisions.len() == 1);
        assert!(matches!(
            decisions[0],
            NativeTerminalSurfaceLifecycleDecision::NeedsRealNativeView { plan }
                if plan == expected_plan
        ));
        assert!(
            lifecycle
                .active_plan()
                .is_some_and(|plan| plan == expected_plan)
        );
        assert!(lifecycle.active_slot_is_awaiting_real_native_view());
    }

    #[test]
    fn same_host_no_op_preserves_awaiting_state_and_still_needs_real_view() {
        let slot_id = slot(10, 101);
        let bounds = test_bounds(12.0, 24.0, 640.0, 360.0);
        let mut host = NativeTerminalSurfaceHost::new();
        let mut lifecycle = NativeTerminalSurfaceLifecycleState::new();
        let initial_commands =
            host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, bounds));
        lifecycle.reconcile_host_commands(&initial_commands);
        let expected_plan = lifecycle.active_plan().unwrap();

        let no_op_commands =
            host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, bounds));
        let decisions = lifecycle.reconcile_host_commands(&no_op_commands);

        assert!(decisions.len() == 1);
        assert!(matches!(
            decisions[0],
            NativeTerminalSurfaceLifecycleDecision::NeedsRealNativeView { plan }
                if plan == expected_plan
        ));
        assert!(
            lifecycle
                .active_plan()
                .is_some_and(|plan| plan == expected_plan)
        );
        assert!(lifecycle.active_slot_is_awaiting_real_native_view());
    }

    #[test]
    fn pre_layout_bounds_reset_preserves_awaiting_state_until_same_bounds_no_op() {
        let slot_id = slot(10, 101);
        let bounds = test_bounds(12.0, 24.0, 640.0, 360.0);
        let empty_bounds: HashMap<AgentsTerminalBodyMountSlotId, Bounds<Pixels>> = HashMap::new();
        let mut host = NativeTerminalSurfaceHost::new();
        let mut lifecycle = NativeTerminalSurfaceLifecycleState::new();
        let initial_commands =
            host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, bounds));
        lifecycle.reconcile_host_commands(&initial_commands);
        let expected_plan = lifecycle.active_plan().unwrap();

        let reset_commands = host.sync_visible_agents_slots(true, &[slot_id], &empty_bounds);
        let reset_decisions = lifecycle.reconcile_host_commands(&reset_commands);

        assert!(reset_commands.is_empty());
        assert!(reset_decisions.is_empty());
        assert!(
            lifecycle
                .active_plan()
                .is_some_and(|plan| plan == expected_plan)
        );
        assert!(lifecycle.active_slot_is_awaiting_real_native_view());

        let no_op_commands =
            host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, bounds));
        let decisions = lifecycle.reconcile_host_commands(&no_op_commands);

        assert!(matches!(
            no_op_commands.as_slice(),
            [NativeTerminalSurfaceHostCommand::NoOp { plan }] if *plan == expected_plan
        ));
        assert!(matches!(
            decisions.as_slice(),
            [NativeTerminalSurfaceLifecycleDecision::NeedsRealNativeView { plan }]
                if *plan == expected_plan
        ));
        assert!(lifecycle.active_slot_is_awaiting_real_native_view());
    }

    #[test]
    fn move_resize_while_awaiting_does_not_become_executable() {
        let slot_id = slot(10, 101);
        let first_bounds = test_bounds(12.0, 24.0, 640.0, 360.0);
        let moved_bounds = test_bounds(18.0, 30.0, 720.0, 390.0);
        let mut host = NativeTerminalSurfaceHost::new();
        let mut lifecycle = NativeTerminalSurfaceLifecycleState::new();
        let initial_commands =
            host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, first_bounds));
        lifecycle.reconcile_host_commands(&initial_commands);

        let move_commands =
            host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, moved_bounds));
        let moved_plan = first_plan_from_commands(&move_commands);
        let decisions = lifecycle.reconcile_host_commands(&move_commands);

        assert!(decisions.len() == 1);
        assert!(matches!(
            decisions[0],
            NativeTerminalSurfaceLifecycleDecision::NeedsRealNativeView { plan }
                if plan == moved_plan
        ));
        assert!(
            lifecycle
                .active_plan()
                .is_some_and(|plan| plan == moved_plan)
        );
        assert!(lifecycle.active_slot_is_awaiting_real_native_view());
    }

    #[test]
    fn changed_bounds_after_pre_layout_reset_preserves_awaiting_identity_and_moves() {
        let slot_id = slot(10, 101);
        let first_bounds = test_bounds(12.0, 24.0, 640.0, 360.0);
        let moved_bounds = test_bounds(18.0, 30.0, 720.0, 390.0);
        let empty_bounds: HashMap<AgentsTerminalBodyMountSlotId, Bounds<Pixels>> = HashMap::new();
        let mut host = NativeTerminalSurfaceHost::new();
        let mut lifecycle = NativeTerminalSurfaceLifecycleState::new();
        let initial_commands =
            host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, first_bounds));
        lifecycle.reconcile_host_commands(&initial_commands);
        let first_plan = lifecycle.active_plan().unwrap();

        let reset_commands = host.sync_visible_agents_slots(true, &[slot_id], &empty_bounds);
        let reset_decisions = lifecycle.reconcile_host_commands(&reset_commands);
        let move_commands =
            host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, moved_bounds));
        let decisions = lifecycle.reconcile_host_commands(&move_commands);
        let moved_plan = lifecycle.active_plan().unwrap();

        assert!(reset_commands.is_empty());
        assert!(reset_decisions.is_empty());
        assert!(moved_plan.same_attachment_identity(first_plan));
        assert!(matches!(
            move_commands.as_slice(),
            [NativeTerminalSurfaceHostCommand::MoveOrResize { plan }] if *plan == moved_plan
        ));
        assert!(matches!(
            decisions.as_slice(),
            [NativeTerminalSurfaceLifecycleDecision::NeedsRealNativeView { plan }]
                if *plan == moved_plan
        ));
        assert!(lifecycle.active_slot_is_awaiting_real_native_view());
    }

    #[test]
    fn identity_change_clears_old_awaiting_state_and_needs_new_real_view() {
        let first_slot = slot(10, 101);
        let next_slot = slot(20, 201);
        let first_bounds = test_bounds(12.0, 24.0, 640.0, 360.0);
        let next_bounds = test_bounds(700.0, 24.0, 640.0, 360.0);
        let mut host = NativeTerminalSurfaceHost::new();
        let mut lifecycle = NativeTerminalSurfaceLifecycleState::new();
        let first_commands = host.sync_visible_agents_slots(
            true,
            &[first_slot],
            &bounds_map(first_slot, first_bounds),
        );
        lifecycle.reconcile_host_commands(&first_commands);
        let first_plan = lifecycle.active_plan().unwrap();

        let next_commands =
            host.sync_visible_agents_slots(true, &[next_slot], &bounds_map(next_slot, next_bounds));
        let decisions = lifecycle.reconcile_host_commands(&next_commands);
        let next_plan = lifecycle.active_plan().unwrap();

        assert!(first_plan.host_id != next_plan.host_id);
        assert!(decisions.len() == 1);
        assert!(matches!(
            decisions[0],
            NativeTerminalSurfaceLifecycleDecision::NeedsRealNativeView { plan }
                if plan == next_plan
        ));
        assert!(lifecycle.active_slot_is_awaiting_real_native_view());
        assert!(next_plan.slot_id == next_slot);
    }

    #[test]
    fn removal_clears_awaiting_lifecycle_state_without_execution() {
        let slot_id = slot(10, 101);
        let bounds = test_bounds(12.0, 24.0, 640.0, 360.0);
        let mut host = NativeTerminalSurfaceHost::new();
        let mut lifecycle = NativeTerminalSurfaceLifecycleState::new();
        let attach_commands =
            host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, bounds));
        lifecycle.reconcile_host_commands(&attach_commands);
        assert!(lifecycle.active_plan().is_some());

        let removal_commands =
            host.sync_visible_agents_slots(true, &[], &bounds_map(slot_id, bounds));
        let decisions = lifecycle.reconcile_host_commands(&removal_commands);

        assert!(decisions.is_empty());
        assert!(lifecycle.active_plan().is_none());
    }

    #[test]
    fn hidden_agents_workspace_clears_awaiting_lifecycle_state_without_execution() {
        let slot_id = slot(10, 101);
        let bounds = test_bounds(12.0, 24.0, 640.0, 360.0);
        let empty_bounds: HashMap<AgentsTerminalBodyMountSlotId, Bounds<Pixels>> = HashMap::new();
        let mut host = NativeTerminalSurfaceHost::new();
        let mut lifecycle = NativeTerminalSurfaceLifecycleState::new();
        let attach_commands =
            host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, bounds));
        lifecycle.reconcile_host_commands(&attach_commands);
        assert!(lifecycle.active_plan().is_some());

        let hidden_commands = host.sync_visible_agents_slots(false, &[slot_id], &empty_bounds);
        let decisions = lifecycle.reconcile_host_commands(&hidden_commands);

        assert!(matches!(
            hidden_commands.as_slice(),
            [NativeTerminalSurfaceHostCommand::HideAndDetach { plan }]
                if *plan == first_plan_from_commands(&attach_commands)
        ));
        assert!(decisions.is_empty());
        assert!(lifecycle.active_plan().is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn supplied_test_real_handle_makes_decision_executable_without_calling_ffi() {
        let slot_id = slot(10, 101);
        let first_bounds = test_bounds(12.0, 24.0, 640.0, 360.0);
        let moved_bounds = test_bounds(18.0, 30.0, 720.0, 390.0);
        let mut host = NativeTerminalSurfaceHost::new();
        let attach_commands =
            host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, first_bounds));
        let initial_plan = first_plan_from_commands(&attach_commands);
        let mut lifecycle = NativeTerminalSurfaceLifecycleState::with_explicit_real_native_view(
            initial_plan,
            test_real_native_view_handle(),
        );

        let move_commands =
            host.sync_visible_agents_slots(true, &[slot_id], &bounds_map(slot_id, moved_bounds));
        let decisions = lifecycle.reconcile_host_commands(&move_commands);

        assert!(decisions.len() == 1);
        assert!(matches!(
            decisions[0],
            NativeTerminalSurfaceLifecycleDecision::CanExecuteWithRealView {
                command: NativeTerminalSurfacePlatformCommand::MoveOrResize { .. },
                real_view
            } if real_view == test_real_native_view_handle()
        ));
        assert!(
            lifecycle
                .active_plan()
                .is_some_and(|plan| plan.bounds == moved_bounds)
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn ready_identity_change_detaches_stale_view_then_awaits_new_view_without_calling_ffi() {
        let first_slot = slot(10, 101);
        let next_slot = slot(20, 201);
        let first_bounds = test_bounds(12.0, 24.0, 640.0, 360.0);
        let next_bounds = test_bounds(700.0, 24.0, 640.0, 360.0);
        let mut host = NativeTerminalSurfaceHost::new();
        let first_commands = host.sync_visible_agents_slots(
            true,
            &[first_slot],
            &bounds_map(first_slot, first_bounds),
        );
        let first_plan = first_plan_from_commands(&first_commands);
        let mut lifecycle = NativeTerminalSurfaceLifecycleState::with_explicit_real_native_view(
            first_plan,
            test_real_native_view_handle(),
        );

        let next_commands =
            host.sync_visible_agents_slots(true, &[next_slot], &bounds_map(next_slot, next_bounds));
        let decisions = lifecycle.reconcile_host_commands(&next_commands);
        let next_plan = lifecycle.active_plan().unwrap();

        assert!(decisions.len() == 2);
        assert!(matches!(
            decisions[0],
            NativeTerminalSurfaceLifecycleDecision::DetachStaleView {
                command: NativeTerminalSurfacePlatformCommand::HideAndDetach { .. },
                real_view
            } if real_view == test_real_native_view_handle()
        ));
        assert!(matches!(
            decisions[1],
            NativeTerminalSurfaceLifecycleDecision::NeedsRealNativeView { plan }
                if plan == next_plan
        ));
        assert!(next_plan.slot_id == next_slot);
        assert!(lifecycle.active_slot_is_awaiting_real_native_view());
    }
}
