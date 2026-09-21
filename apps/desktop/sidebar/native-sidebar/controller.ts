import { openAppModal } from '@/packages/core-ui/app-modal-host-bridge';
import { runNativeProjectDrop } from './project-drag';
import { createNativeAgentLauncherController } from './agent-launcher';
import { receiveNativeSidebarEvent } from './events';
import { createNativeAccountMenuController } from './accounts';
import { resolveCloseProjectSuccessorSessionId } from '@/packages/core-ui/sidebar-app/close-project-successor';
import { runNativeMembershipAction } from './membership';
import { runNativeSidebarHotkey, runNativeProjectSlotHotkey } from './hotkeys';
import { createNativeSidebarClock } from './clock';
import { runNativeCollectionAction } from './collections';
import { runNativeSidebarAction } from './navigation';
import { runNativeProjectAction } from './project-actions';
import { reorderNativeSidebar } from './reorder';
import { selectNativeSidebarSession } from './selection';
import { runNativeSessionAction } from './session-actions';
import { editNativeSidebarSpace, rememberNativeSidebarFocus, switchNativeSidebarSpace } from './space-navigation';
import type { ExtensionToSidebarMessage } from '@/packages/shared/session-grid-contract';
import type { NativeSidebarBridge } from '@/packages/shared/native-sidebar';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import type { createGpuiSidebarRuntime } from '../gxserver-runtime';
import { applyNativeSidebarMessage, createNativeSidebarSnapshot } from './model';
import { nativeSidebarProjectionPhases } from './projection-phases';
import { NativeSidebarUiState } from './ui-state';
import { createNativeSidebarPublisher } from './updates';
import { resolveNativeSessionMenu } from './menu-request';
import { isDiagnosticLoggingScenarioEnabled } from '@/packages/shared/ghostex-settings/diagnostic-logging';

export function connectNativeSidebar(runtime: ReturnType<typeof createGpuiSidebarRuntime>): () => void {
  const ui = new NativeSidebarUiState();
  const bridge = window.ghostexGpui as typeof window.ghostexGpui & NativeSidebarBridge;
  if (!bridge?.postNativeSidebarSnapshot) {
    throw new Error('The native sidebar snapshot bridge is not installed.');
  }
  const publisher = createNativeSidebarPublisher((payload) => bridge.postNativeSidebarSnapshot!(payload));
  let pendingPublish: number | undefined;
  let disposed = false;
  const tick = createNativeSidebarClock();
  // Also run after each publish so an armed Delayed Send reaches the chat working row without waiting for the next second.
  const postClock = () => {
    const rows = tick();
    if (rows.length && !disposed)
      bridge.postNativeSidebarSnapshot!(JSON.stringify({ kind: 'clock', version: 1, rows }));
  };
  const publish = () => {
    if (pendingPublish !== undefined || disposed) return;
    // CDXC:Sidebar 2026-09-17 WHY:
    // Full snapshots took 80-200ms and microtasks rebuilt one after each event in a burst, delaying pane focus.
    // Publish once per frame after the shared controller has applied the incoming changes.
    pendingPublish = window.requestAnimationFrame(() => {
      pendingPublish = undefined;
      if (disposed) return;
      const started = Date.now();
      const snapshot = createNativeSidebarSnapshot(ui);
      const projected = Date.now();
      const metrics = publisher.publish(snapshot);
      postClock();
      if (
        metrics &&
        snapshot.hud.debuggingMode &&
        isDiagnosticLoggingScenarioEnabled(snapshot.hud.settings?.diagnosticLogging, 'native.sidebar.refresh')
      ) {
        runtime.vscode.postMessage({
          type: 'sidebarDebugLog',
          scenarioId: 'native.sidebar.refresh',
          event: 'nativeSidebar.publish',
          details: {
            ...metrics,
            projectionMs: projected - started,
            publishMs: Date.now() - projected,
            ...nativeSidebarProjectionPhases.current,
          },
        });
      }
    });
  };
  const post = (message: Parameters<typeof runtime.vscode.postMessage>[0]) => {
    if (
      message.type === 'closeWorkspaceProjectForGroup' &&
      sidebarStore.getState().groupsById[message.groupId]?.isActive
    ) {
      const snapshot = createNativeSidebarSnapshot(ui);
      const orderedGroupIds = snapshot.order.flatMap((item) =>
        item.kind === 'project'
          ? [item.id]
          : (snapshot.collections.find((collection) => collection.collectionId === item.id)?.groupIds ?? [])
      );
      runtime.vscode.postMessage({
        ...message,
        successorSessionId: resolveCloseProjectSuccessorSessionId({
          closingGroupId: message.groupId,
          orderedGroupIds,
          ...sidebarStore.getState(),
        }),
      });
    } else runtime.vscode.postMessage(message);
  };
  const accounts = createNativeAccountMenuController(runtime.vscode.requestSessionAccounts, (update) =>
    bridge.postNativeSidebarSnapshot!(JSON.stringify(update))
  );
  const launcher = createNativeAgentLauncherController(
    runtime.vscode.requestGroupAccounts,
    (update) => bridge.postNativeSidebarSnapshot!(JSON.stringify(update)),
    (groupId, agentId, accountId) =>
      runNativeProjectAction({ type: 'projectAction', action: 'agent', groupId, agentId, accountId }, post)
  );
  let previousFocusedSessionId: string | undefined;
  const receive = (event: Event) => {
    if (!(event instanceof MessageEvent)) return;
    const message = event.data as ExtensionToSidebarMessage;
    ui.metadata.receive(message, post);
    applyNativeSidebarMessage(message);
    receiveNativeSidebarEvent(ui, message, post);
    if (message.type === 'playCompletionSound' && message.sessionId)
      bridge.postNativeSidebarSnapshot!(JSON.stringify({ kind: 'flash', version: 1, sessionId: message.sessionId }));
    if (message.type === 'revealSidebarSession') ui.requestReveal(message.sessionId, message.requestId);
    if (message.type === 'nativeHotkey') runNativeSidebarHotkey(ui, message.actionId, post);
    if (message.type === 'gpuiProjectSlotHotkey') runNativeProjectSlotHotkey(ui, message.slotNumber, post);
    const focused = Object.values(sidebarStore.getState().sessionsById).find((session) => session.isFocused)?.sessionId;
    if (focused && focused !== previousFocusedSessionId) rememberNativeSidebarFocus(ui, focused);
    previousFocusedSessionId = focused;
    publish();
  };
  // The app owns the stored workspace session groups document and hands the held one back after
  // every change, so this page's copy is never the stale base its next edit is computed from. A
  // document that arrived before this ran is parked on the bridge and taken here.
  bridge.applyWorkspaceGroups = (state) => {
    runtime.applyWorkspaceGroupsFromHost(state);
  };
  bridge.requestWorkspaceGroups = () => {
    runtime.persistWorkspaceGroups();
  };
  if (bridge.pendingWorkspaceGroups !== undefined) {
    const parked = bridge.pendingWorkspaceGroups;
    delete bridge.pendingWorkspaceGroups;
    runtime.applyWorkspaceGroupsFromHost(parked);
  }
  // The same hand-back for the project collections document and the Spaces document, which the app
  // has owned since M5 piece 7d. Both are parked on the bridge when they arrive before this runs
  // and drained here, so a document is delivered late rather than lost.
  bridge.applyProjectCollections = (state) => {
    ui.metadata.applyCollectionsFromHost(state);
    publish();
  };
  bridge.applySidebarSpaces = (state) => {
    ui.metadata.applySpacesFromHost(state);
    publish();
  };
  // The app refused a hand-off because it had not read the stored key yet, so this page's copy is
  // the only one carrying that edit. It posts it again as an ordinary hand-off.
  bridge.requestProjectCollections = () => {
    ui.metadata.requestCollections();
  };
  if (bridge.pendingProjectCollections !== undefined) {
    const parked = bridge.pendingProjectCollections;
    delete bridge.pendingProjectCollections;
    ui.metadata.applyCollectionsFromHost(parked);
  }
  if (bridge.pendingSidebarSpaces !== undefined) {
    const parked = bridge.pendingSidebarSpaces;
    delete bridge.pendingSidebarSpaces;
    ui.metadata.applySpacesFromHost(parked);
  }
  bridge.onNativeSidebarCommand = (command) => {
    if (command.type === 'sessionMenu') {
      const items = resolveNativeSessionMenu(ui, publisher.snapshot, command);
      bridge.postNativeSidebarSnapshot!(
        JSON.stringify({ kind: 'menu', version: 1, ownerId: command.ownerId, items, close: !items.length })
      );
      return;
    }
    if (command.type === 'command') post(command.message);
    else if (command.type === 'machineAction') {
      const state = sidebarStore.getState();
      if (command.action === 'configure') openAppModal({ type: 'open', modal: 'settings', initialTab: 'remote' });
      else if (state.hud.settings)
        post({
          type: 'updateSettingsPatch',
          baseRevision: state.revision,
          source: 'settings:remoteMachines',
          patch: {
            remoteMachines: state.hud.settings.remoteMachines?.map((machine) =>
              machine.id === command.machineId ? { ...machine, disabled: true } : machine
            ),
          },
        });
    } else if (command.type === 'agentAccounts') void launcher(command);
    else if (command.type === 'sessionAccounts') void accounts(command);
    else if (command.type === 'selectSession')
      selectNativeSidebarSession(ui, () => createNativeSidebarSnapshot(ui), command, post);
    else if (command.type === 'moveToSpace' || command.type === 'moveToCollection' || command.type === 'moveCollection')
      runNativeProjectDrop(ui, command, post);
    else if (command.type === 'moveSession' || command.type === 'moveGroup' || command.type === 'moveSpace')
      reorderNativeSidebar(ui, command, post);
    else if (command.type === 'projectMembership' || command.type === 'spaceMembership')
      runNativeMembershipAction(ui, command, post);
    else if (command.type === 'collectionAction') runNativeCollectionAction(ui, command, post);
    else if (command.type === 'sidebarAction' && command.action === 'loadSessions') runtime.startLocalGxserver();
    else if (command.type === 'sidebarAction') runNativeSidebarAction(ui, command.action, post);
    else if (command.type === 'projectAction') runNativeProjectAction(command, post);
    else if (command.type === 'sessionAction') runNativeSessionAction(command, post);
    else if (command.type === 'batch') {
      if (command.clearSelection) ui.selectedSessionIds = [];
      command.messages.forEach(post);
    } else if (command.type === 'selectSpace') switchNativeSidebarSpace(ui, command.spaceId, post);
    else if (command.type === 'editSpace') editNativeSidebarSpace(ui, command.spaceId);
    else ui.apply(command);
    publish();
  };
  runtime.messageSource.addEventListener('message', receive);
  const unsubscribe = sidebarStore.subscribe(publish);
  const clock = window.setInterval(() => {
    if (ui.unavailableSince) publish();
    postClock();
  }, 1_000);
  publish();
  return () => {
    disposed = true;
    if (pendingPublish !== undefined) window.cancelAnimationFrame(pendingPublish);
    window.clearInterval(clock);
    unsubscribe();
    runtime.messageSource.removeEventListener('message', receive);
    delete bridge.onNativeSidebarCommand;
    delete bridge.applyWorkspaceGroups;
    delete bridge.requestWorkspaceGroups;
    delete bridge.applyProjectCollections;
    delete bridge.applySidebarSpaces;
    delete bridge.requestProjectCollections;
  };
}
