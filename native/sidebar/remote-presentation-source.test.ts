import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const sortableSessionCardSource = readFileSync(
  new URL("../../sidebar/sortable-session-card.tsx", import.meta.url),
  "utf8",
);
const sessionGroupSectionSource = readFileSync(
  new URL("../../sidebar/session-group-section.tsx", import.meta.url),
  "utf8",
);
const sessionCardsCssSource = readFileSync(
  new URL("../../sidebar/styles/session-cards.css", import.meta.url),
  "utf8",
);
const sidebarStoreSource = readFileSync(new URL("../../sidebar/sidebar-store.ts", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source
    .slice(startIndex, endIndex)
    .replace(/\s+/g, " ")
    .replace(/([([])\s+/g, "$1")
    .replace(/,?\s+([)\]])/g, "$1");
}

describe("remote presentation sidebar source", () => {
  test("projects remote sessions through the shared gxserver row shape", () => {
    /*
     * CDXC:RemotePresentation 2026-06-30-00:11:
     * Remote machine rows must not maintain a hand-copied subset of gxserver
     * session fields. Delegate to the shared projector so remote titles,
     * lifecycle state, activity, tags, and persistence metadata stay in parity
     * with local gxserver-backed rows.
     */
    const remoteProjection = sourceBetween(
      nativeSidebarSource,
      "function createRemotePresentationSidebarSession",
      "function createRemotePresentationGroupId",
    );
    expect(remoteProjection).toContain("createGxserverPresentationSidebarSession({");
    expect(remoteProjection).toContain("createRemotePresentationSessionId(machineId, projectId, sessionId)");
    expect(remoteProjection).toContain("canScheduleDelayedSend");
    expect(remoteProjection).toContain("canToggleCloseAfterDone");
    expect(remoteProjection).toContain("resolveCloseAfterDone: (projectId, sessionId) =>");
    expect(remoteProjection).toContain(
      "getRemoteCloseAfterDoneProjectionForPresentationSession(machineId, projectId, sessionId)",
    );
    expect(remoteProjection).toContain("resolveDelayedSend: (projectId, sessionId) =>");
    expect(remoteProjection).toContain(
      "getRemoteDelayedSendProjectionForProjectSession(machineId, projectId, sessionId)",
    );
    expect(remoteProjection).toContain("isFocused");
    expect(remoteProjection).toContain("isVisible: isFocused || index === 0");
    expect(remoteProjection).not.toContain("displayTitle: presentation.displayTitle");
    expect(remoteProjection).not.toContain("providerSessionState,");
  });

  test("marks remote cards and neutral lifecycle dots without duplicating running state", () => {
    /*
     * CDXC:RemotePresentation 2026-06-30-00:11:
     * Remote sessions need the same card and group marker in both render paths
     * so their lifecycle chrome stays scoped to remote rows without forking the
     * shared gxserver sidebar projection.
     *
     * CDXC:RemotePresentation 2026-06-30-11:15:
     * Remote running-idle rows use the bright running title treatment instead of a
     * redundant dot. Keep always-on neutral dots for remote sleeping/done states
     * while working, attention, and error continue to own their existing dots.
     */
    expect(sortableSessionCardSource).toContain("const isRemoteSession = Boolean(sessionGroup?.remoteMachineContext);");
    expect(sortableSessionCardSource).toContain("alwaysShowStateTooltip: isRemoteSession");
    expect(sortableSessionCardSource).toContain("data-remote-session={String(isRemoteSession)}");
    expect(sessionGroupSectionSource).toContain('data-remote-session={String(Boolean(group.remoteMachineContext))}');
    expect(sessionCardsCssSource).toContain('.session-frame[data-remote-session="true"]:is(');
    expect(sessionCardsCssSource).toContain(
      '.session-status-dot-anchored[data-remote-session="true"]:is(',
    );
    expect(sessionCardsCssSource).not.toContain(
      '[data-remote-session="true"][data-lifecycle-state="running"]',
    );
    expect(sessionCardsCssSource).toContain(
      '[data-remote-session="true"][data-lifecycle-state="sleeping"]',
    );
    expect(sessionCardsCssSource).toContain(
      '[data-remote-session="true"][data-lifecycle-state="done"]',
    );
  });

  test("uses the remote machine and project label for focused remote attach titlebars", () => {
    /*
     * CDXC:RemoteAttach 2026-06-30-12:49:
     * Remote attach carriers must stay hidden implementation details. When the
     * carrier is the focused local pane owner, the app/window titlebar should
     * display the remote machine and project or worktree name instead.
     */
    expect(nativeSidebarSource).toContain("function remoteAttachTitlebarProjectContextForActiveCarrier");
    expect(nativeSidebarSource).toContain("const title = `${machineTitle} | ${projectTitle}`;");
    expect(nativeSidebarSource).toContain(
      "const remoteAttachTitlebarContext = remoteAttachTitlebarProjectContextForActiveCarrier(",
    );
    expect(nativeSidebarSource).toContain(
      "appTitle: remoteAttachTitlebarContext?.appTitle ?? nativeAppTitleForProject(currentProject)",
    );
    expect(nativeSidebarSource).toContain(
      "activeProjectName: remoteAttachTitlebarContext?.projectName ?? currentProject.name",
    );
    expect(nativeSidebarSource).toContain("activeProjectPath: currentProject.path");
  });

  test("routes remote Fork through the owning remote gxserver", () => {
    /*
     * CDXC:RemoteActions 2026-06-30-15:20:
     * Remote Fork must use the selected machine's gxserver `/api/forkSession`
     * endpoint and refresh that machine's presentation snapshot. The forked
     * row belongs to the remote project, so native must not create a local pane.
     */
    const remoteForkSource = sourceBetween(
      nativeSidebarSource,
      "async function forkRemotePresentationSession(",
      "function sleepInactiveRemoteProjectSessions",
    );
    const messageHandlerSource = sourceBetween(
      nativeSidebarSource,
      '    case "forkSession":',
      '    case "scheduleDelayedSend":',
    );

    expect(remoteForkSource).toContain("parseRemotePresentationSessionId(remoteSessionId)");
    expect(remoteForkSource).toContain('"/api/forkSession"');
    expect(remoteForkSource).toContain("projectId: target.projectId");
    expect(remoteForkSource).toContain("sessionId: target.sessionId");
    expect(remoteForkSource).toContain(
      'await refreshRemoteGxserverPresentationSnapshot(target.machineId, "remote-fork-session")',
    );
    expect(remoteForkSource).toContain('showAppToast("error", "Remote fork failed"');
    expect(remoteForkSource).not.toContain("materializeNativeForkedGxserverSession");
    expect(messageHandlerSource).toContain("void forkRemotePresentationSession(message.sessionId);");
    expect(messageHandlerSource).toContain("void forkNativeSession(message.sessionId);");
    expect(nativeSidebarSource).not.toContain("Remote fork unavailable");
  });

  test("keeps bulk Sleep below and Close below remote ids in native split paths", () => {
    /*
     * CDXC:RemoteContextMenu 2026-06-30-15:22:
     * Remote Sleep below and Close below send the same scoped row ids as local
     * rows. Native must split those ids inside the bulk handlers so local pane
     * work and remote gxserver lifecycle work stay owned by the right machine.
     */
    const closeSessionsSource = sourceBetween(
      nativeSidebarSource,
      '    case "closeSessions": {',
      '    case "restartSession":',
    );
    expect(closeSessionsSource).toContain("const localSessionIds: string[] = [];");
    expect(closeSessionsSource).toContain("const remoteOperations: NativeSidebarBackgroundOperation[] = [];");
    expect(closeSessionsSource).toContain("for (const sessionId of Array.from(new Set(message.sessionIds)))");
    expect(closeSessionsSource).toContain("if (parseRemotePresentationSessionId(sessionId))");
    expect(closeSessionsSource).toContain(
      'void updateRemotePresentationSession(sessionId, { lifecycleState: "stopped" }, "close-sessions");',
    );
    expect(closeSessionsSource).toContain("localSessionIds.push(sessionId);");
    expect(closeSessionsSource).toContain("closeNativeSessionsInBackground(localSessionIds);");
    expect(closeSessionsSource).toContain("runNativeSidebarBulkActionInBackground(remoteOperations);");

    const setSessionsSleepingSource = sourceBetween(
      nativeSidebarSource,
      '    case "setSessionsSleeping": {',
      '    case "setSessionFavorite":',
    );
    expect(setSessionsSleepingSource).toContain("const localSessionIds: string[] = [];");
    expect(setSessionsSleepingSource).toContain("const remoteOperations: NativeSidebarBackgroundOperation[] = [];");
    expect(setSessionsSleepingSource).toContain("for (const sessionId of Array.from(new Set(message.sessionIds)))");
    expect(setSessionsSleepingSource).toContain("if (parseRemotePresentationSessionId(sessionId))");
    expect(setSessionsSleepingSource).toContain(
      'lifecycleState: message.sleeping ? "sleeping" : "running"',
    );
    expect(setSessionsSleepingSource).toContain("localSessionIds.push(sessionId);");
    expect(setSessionsSleepingSource).toContain("setNativeSessionsSleepingInBackground(localSessionIds");
    expect(setSessionsSleepingSource).toContain("runNativeSidebarBulkSleepActionInBackground(remoteOperations");
    expect(setSessionsSleepingSource).toContain("remoteCount: remoteOperations.length");
  });

  test("parses remote scoped ids before delayed-send and close-after-done local paths", () => {
    /*
     * CDXC:RemoteContextMenu 2026-06-30-15:22:
     * Remote Delayed Send and Close After Done are valid context-menu parity
     * actions only when their native branches parse scoped remote ids before
     * resolving local project/session references.
     */
    const scheduleDelayedSendSource = sourceBetween(
      nativeSidebarSource,
      "function scheduleDelayedSend(",
      "function cancelDelayedSend(",
    );
    expect(scheduleDelayedSendSource).toContain("parseRemotePresentationSessionId(sessionId)");
    expect(scheduleDelayedSendSource.indexOf("parseRemotePresentationSessionId(sessionId)")).toBeLessThan(
      scheduleDelayedSendSource.indexOf("resolveSidebarSessionReference(sessionId)"),
    );
    expect(scheduleDelayedSendSource).toContain("scheduleRemoteDelayedSend(sessionId, remoteReference, delayMs)");
    const remoteDelayedSendSource = sourceBetween(
      nativeSidebarSource,
      "function installRemoteDelayedSendTimer(",
      "function scheduleRemoteDelayedSend(",
    );
    expect(remoteDelayedSendSource).toContain('"/api/sendSessionEnter"');
    expect(remoteDelayedSendSource).toContain("projectId: target.projectId");
    expect(remoteDelayedSendSource).toContain("sessionId: target.sessionId");
    expect(remoteDelayedSendSource).not.toContain("openRemoteAttachTerminal");

    const cancelDelayedSendSource = sourceBetween(
      nativeSidebarSource,
      "function cancelDelayedSend(",
      "function clearDelayedSendTimer(",
    );
    expect(cancelDelayedSendSource).toContain("parseRemotePresentationSessionId(sessionId)");

    const closeAfterDoneSource = sourceBetween(
      nativeSidebarSource,
      "function toggleCloseAfterDone(",
      "function clearCloseAfterDoneTimer(",
    );
    expect(closeAfterDoneSource).toContain("parseRemotePresentationSessionId(sessionId)");
    expect(closeAfterDoneSource.indexOf("parseRemotePresentationSessionId(sessionId)")).toBeLessThan(
      closeAfterDoneSource.indexOf("resolveSidebarSessionReference(sessionId)"),
    );
    expect(closeAfterDoneSource).toContain("toggleRemoteCloseAfterDone(sessionId, remoteReference)");

    const remoteCloseAfterDoneSource = sourceBetween(
      nativeSidebarSource,
      "function installRemoteCloseAfterDoneWatcher(",
      "function isCloseAfterDoneSessionMarkedDone(",
    );
    expect(remoteCloseAfterDoneSource).toContain("createRemotePresentationSessionId(machineId, projectId, sessionId)");
    expect(remoteCloseAfterDoneSource).toContain("closeAfterDoneTimerByRemoteSessionId");
    expect(remoteCloseAfterDoneSource).toContain("remotePresentationSnapshotsByMachineId.get(machineId)");
    expect(remoteCloseAfterDoneSource).toContain("isCloseAfterDonePresentationSessionMarkedDone(presentationSession)");
    expect(remoteCloseAfterDoneSource).toContain("completeRemoteCloseAfterDoneTimer");
    expect(remoteCloseAfterDoneSource).toContain('"/api/killSession"');
    expect(remoteCloseAfterDoneSource).toContain("projectId");
    expect(remoteCloseAfterDoneSource).toContain("sessionId");

    const donePredicateSource = sourceBetween(
      nativeSidebarSource,
      "function isCloseAfterDonePresentationSessionMarkedDone(",
      "function hasCloseAfterDoneAgentIdentity(",
    );
    expect(donePredicateSource).toContain('presentationSession.activity === "attention"');
    expect(donePredicateSource).toContain('presentationSession.activity !== "working"');
    expect(donePredicateSource).toContain("hasCloseAfterDoneAgentIdentity(presentationSession)");
  });

  test("gates remote Pop Out Pane through existing live attach carriers", () => {
    /*
     * CDXC:RemoteAttach 2026-06-30-15:24:
     * Remote Pop Out Pane is an AppKit presentation action for the existing
     * local attach carrier. The remote row may show the action only while that
     * carrier is live, and clicking a stale menu item must not create or focus a
     * replacement carrier.
     */
    const remoteProjectionSource = sourceBetween(
      nativeSidebarSource,
      "function createRemotePresentationSidebarSession",
      "function createRemotePresentationGroupId",
    );
    expect(remoteProjectionSource).toContain("const carrier = resolveRemoteAttachLocalCarrierSession(sessionId);");
    expect(remoteProjectionSource).toContain("canPopOutPane: carrier !== undefined");
    expect(remoteProjectionSource).toContain("isPoppedOut: carrier?.session.isPoppedOut === true || undefined");

    const carrierResolverSource = sourceBetween(
      nativeSidebarSource,
      "function resolveRemoteAttachLocalCarrierSession(",
      "function rememberRemoteAttachLocalSession",
    );
    expect(carrierResolverSource).toContain("remoteAttachLocalSessionIdByRemoteSessionId.get(remoteSessionId)");
    expect(carrierResolverSource).toContain('terminalState?.lifecycleState !== "running"');
    expect(carrierResolverSource).toContain("remoteAttachLocalSessionIdByRemoteSessionId.delete(remoteSessionId)");
    expect(carrierResolverSource).not.toContain("openRemoteAttachTerminal");
    expect(carrierResolverSource).not.toContain("createNativeRemoteAttachCarrierTerminal");

    const popOutHandlerSource = sourceBetween(
      nativeSidebarSource,
      '    case "popOutPane": {',
      '    case "fullReloadGroup": {',
    );
    expect(popOutHandlerSource).toContain("if (popOutRemotePresentationSession(message.sessionId))");
    expect(popOutHandlerSource).not.toContain("openRemoteAttachTerminal");
    expect(popOutHandlerSource).not.toContain("createNativeRemoteAttachCarrierTerminal");

    const popOutRemoteSource = sourceBetween(
      nativeSidebarSource,
      "function popOutRemotePresentationSession(",
      "function sleepInactiveRemoteProjectSessions",
    );
    expect(popOutRemoteSource).toContain("parseRemotePresentationSessionId(remoteSessionId)");
    expect(popOutRemoteSource).toContain("resolveRemoteAttachLocalCarrierSession(remoteSessionId)");
    expect(popOutRemoteSource).toContain("handleNativeTerminalTitleBarAction(");
    expect(popOutRemoteSource).toContain("carrier.localSessionId");
    expect(popOutRemoteSource).toContain('carrier.session.isPoppedOut === true ? "restorePopOut" : "popOut"');
    expect(popOutRemoteSource).toContain('showAppToast("info", "Remote pop out unavailable"');
    expect(popOutRemoteSource).toContain("publish();");
    expect(popOutRemoteSource).not.toContain("openRemoteAttachTerminal");
    expect(popOutRemoteSource).not.toContain("focusExistingRemoteAttachTerminal");
    expect(popOutRemoteSource).not.toContain("createNativeRemoteAttachCarrierTerminal");
    expect(popOutRemoteSource).not.toContain("Pop Out Pane is local-only");

    const eligibilitySource = sourceBetween(
      sortableSessionCardSource,
      "export function getSidebarSessionContextMenuEligibility(",
      "function isSidebarBrowserSession",
    );
    expect(eligibilitySource).toContain("isRemoteSession");
    expect(eligibilitySource).toContain("supportsPopOutPaneMenuAction");
    const menuGateSource = sourceBetween(
      sortableSessionCardSource,
      "function supportsPopOutPaneMenuAction",
      "function supportsPopOutPane(",
    );
    expect(menuGateSource).toContain("session.canPopOutPane === true");
    expect(menuGateSource).toContain('session.lifecycleState !== "sleeping"');
    expect(nativeSidebarSource).not.toContain("Pop Out Pane is local-only");
    expect(sidebarStoreSource).toContain("left.canPopOutPane === right.canPopOutPane");
    expect(sidebarStoreSource).toContain("left.canScheduleDelayedSend === right.canScheduleDelayedSend");
    expect(sidebarStoreSource).toContain("left.canToggleCloseAfterDone === right.canToggleCloseAfterDone");
    expect(sidebarStoreSource).toContain("left.isPoppedOut === right.isPoppedOut");
  });

  test("keeps remote rows on the shared context menu with explicit parity affordances", () => {
    /*
     * CDXC:RemoteContextMenu 2026-06-30-15:22:
     * Remote session rows should keep using the shared session-card context menu
     * while making parity affordances intentional: basic metadata actions,
     * remote lifecycle actions, timers, fork, full reload, and below-scoped bulk
     * actions should be visible from the same normalized row shape.
     */
    expect(sortableSessionCardSource).toContain("const isRemoteSession = Boolean(sessionGroup?.remoteMachineContext);");
    expect(sortableSessionCardSource).not.toContain("RemoteSessionContextMenu");
    const menuActionsSource = sourceBetween(
      sortableSessionCardSource,
      "const primaryActions: SessionContextMenuAction[] = [];",
      "const destructiveActions: SessionContextMenuAction[] = [];",
    );
    for (const label of [
      "Rename",
      "Tag as",
      "Copy details",
      "Delayed Send",
      "Close After Done",
      "Fork",
      "Full reload",
      "Sleep below",
      "Close below",
    ]) {
      expect(menuActionsSource).toContain(`label: "${label}"`);
    }
    expect(menuActionsSource).toContain('label: session.isPinned ? "Unpin" : "Pin"');
    expect(menuActionsSource).toContain('label: session.isSleeping ? "Wake" : "Sleep"');
    expect(menuActionsSource).toContain('label: session.isPoppedOut ? "Restore Pane" : "Pop Out Pane"');
    expect(sortableSessionCardSource).toContain("supportsFork(session)");
    expect(sortableSessionCardSource).toContain("supportsFullReloadMenuAction(session, isRemoteSession)");
  });
});
