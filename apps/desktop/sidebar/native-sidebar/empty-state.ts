import { hasKnownSidebarProjectInventory } from '@/packages/core-ui/sidebar-project-empty-state';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import type { NativeSidebarUiState } from './ui-state';
import { describeNativeSidebarMachine } from './space-navigation';

export function createNativeEmptyState(ui: NativeSidebarUiState) {
  const state = sidebarStore.getState();
  const unavailable = !!state.groupsById['gxserver-unavailable'];
  if (unavailable) ui.unavailableSince ??= Date.now();
  else {
    ui.unavailableSince = undefined;
    if (state.hasReceivedSnapshot && state.groupOrder.length) ui.hasObservedAvailableState = true;
  }
  const error = unavailable && (ui.hasObservedAvailableState || Date.now() - ui.unavailableSince! >= 20_000);
  const loading = !error && (!state.hasReceivedSnapshot || unavailable);
  const known = hasKnownSidebarProjectInventory({
    ...state,
    unavailableProjectGroupId: 'gxserver-unavailable',
    recentProjectCount: state.hud.recentProjects.length,
    projectSettingsProjectCount: state.hud.projectSettingsProjects?.length ?? 0,
  });
  const section = describeNativeSidebarMachine(ui);
  const canAddProject =
    ui.selectedMachineId === 'local' || ui.metadata.connections[ui.selectedMachineId]?.state === 'connected';
  if (ui.selectedMachineId !== 'local' && !canAddProject)
    return { loading: false, error: false, canAddProject: false, copy: '' };
  return {
    loading,
    error,
    canAddProject,
    copy: error
      ? 'Unable to load sessions.'
      : !known
        ? 'No projects added yet.'
        : section.selection?.kind === 'space'
          ? 'No projects in this Space.'
          : 'No projects',
  };
}
