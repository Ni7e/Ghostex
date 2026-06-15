import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("native terminal create focus source", () => {
  test("defers zmx workspace create focus until terminalReady layout sync", () => {
    /*
    CDXC:TerminalCreationFocus 2026-06-13-14:00:
    zmx workspace terminal creation must not send a direct native focus before
    Swift has reported terminalReady. Source coverage keeps New Terminal and
    forked-session creates routed through focusAfterReady so setActiveTerminalSet
    owns the first focused layout after the surface exists.
    */
    const createTerminalSource = sourceBetween(
      nativeSidebarSource,
      "function createTerminal(",
      "function createFocusedTabGroupPlacement",
    );
    expect(createTerminalSource).toContain("shouldDeferZmxWorkspaceFocusUntilTerminalReady");
    expect(createTerminalSource).toContain("focusAfterReady: shouldDeferZmxWorkspaceFocusUntilTerminalReady");
    expect(createTerminalSource).toContain('reason: "gxserverAttachCreateTerminalReadyFocus"');
    expect(createTerminalSource).toContain('surface: "workspaceTerminal"');
    expect(createTerminalSource).toContain(
      "deferWorkspaceFocusUntilTerminalReady: shouldDeferZmxWorkspaceFocusUntilTerminalReady",
    );

    const forkSource = sourceBetween(
      nativeSidebarSource,
      "function materializeNativeForkedGxserverSession",
      "function promptDelayedSend",
    );
    expect(forkSource).toContain('reason: "gxserverForkCreateTerminalReadyFocus"');
    expect(forkSource).toContain("deferWorkspaceFocusUntilTerminalReady: true");
  });

  test("keeps immediate gxserver attach focus behind an explicit non-deferred branch", () => {
    const helperSource = sourceBetween(
      nativeSidebarSource,
      "async function postNativeCreateTerminalWithGxserverAttach",
      "function showAppToast",
    );
    expect(helperSource).toContain("deferWorkspaceFocusUntilTerminalReady?: boolean");
    expect(helperSource).toContain("options.deferWorkspaceFocusUntilTerminalReady === true");
    expect(helperSource).toContain("nativeFocusTrace.gxserverAttachFocusDeferredUntilTerminalReady");

    const deferredBranchIndex = helperSource.indexOf(
      "options.deferWorkspaceFocusUntilTerminalReady === true",
    );
    const directFocusIndex = helperSource.indexOf(
      'postNativeFocusTerminalForCurrentIntent(\n        command.sessionId,\n        options.focusIntent,\n        "gxserver-attach-focus-after-create"',
    );
    expect(deferredBranchIndex).toBeGreaterThanOrEqual(0);
    expect(directFocusIndex).toBeGreaterThan(deferredBranchIndex);
  });

  test("publishes native layout before sidebar hydrate when terminalReady consumes deferred focus", () => {
    const eventSource = sourceBetween(
      nativeSidebarSource,
      'window.addEventListener("ghostex-native-host-event"',
      "function handleNativePaneReorderRequested",
    );
    expect(eventSource).toContain("let publishNativeLayoutBeforeSidebarHydrate = false;");
    expect(eventSource).toContain("publish({ nativeLayoutBeforeSidebarHydrate: true });");

    const queueFocusIndex = eventSource.indexOf(
      "queueNativeLayoutFocusRequest(sidebarSessionId, focusAfterReady.reason);",
    );
    const publishNativeFirstIndex = eventSource.indexOf(
      "publishNativeLayoutBeforeSidebarHydrate = true;",
      queueFocusIndex,
    );
    const typingFocusIndex = eventSource.indexOf(
      "postNativeFocusTerminalForCurrentIntent(",
      publishNativeFirstIndex,
    );
    expect(queueFocusIndex).toBeGreaterThanOrEqual(0);
    expect(publishNativeFirstIndex).toBeGreaterThan(queueFocusIndex);
    expect(typingFocusIndex).toBeGreaterThan(publishNativeFirstIndex);
    expect(eventSource).toContain('`${focusAfterReady.reason}:typingFocus`');
  });

  test("focuses the worktree agent terminal after Add Worktree modal creation", () => {
    /*
    CDXC:WorktreeModal 2026-06-15-11:30:
    Add Worktree modal submit should keep the existing toast-backed creation
    flow, then switch to the new worktree's agent terminal once the terminal is
    created. Source coverage keeps that modal path explicit instead of relying
    on createTerminal's current default.
    */
    const worktreeCreateSource = sourceBetween(
      nativeSidebarSource,
      "async function createProjectWorktreeFromPrompt",
      "async function openExistingRemoteWorktreeProject",
    );
    expect(worktreeCreateSource).toContain("await createNativeWorktreeForAgentPrompt({");
    expect(worktreeCreateSource).toContain("focusAfterCreate: true,");
    expect(worktreeCreateSource).toContain('showAppToast("warning", "Worktree prompt is empty")');
    expect(worktreeCreateSource).toContain('showAppToast("error", "Agent is unavailable"');
  });

  test("keeps presentation pruning from deleting gxserver-unconfirmed zmx creates", () => {
    /*
    CDXC:TerminalCreationFocus 2026-06-13-15:44:
    gxserver project deltas can arrive after local zmx create has inserted a
    canonical P/G row but before the presentation stream echoes the new session.
    Source coverage keeps pruneStaleGxserverLocalSessionsFromPresentation from
    closing that row while native createTerminal is still pending.

    CDXC:TerminalCreationFocus 2026-06-15-10:04:
    Native terminalReady is not gxserver confirmation. Keep stale-prune guarded by a separate presentation-confirmation marker so splitMore cannot close a fresh pane in the gap between AppKit surface readiness and gxserver's session echo.
    */
    const surfacePendingHelperSource = sourceBetween(
      nativeSidebarSource,
      "function markNativeTerminalSurfaceCreationPending",
      "function takeNativeTerminalSurfaceCreationPending",
    );
    expect(surfacePendingHelperSource).toContain("markGxserverPresentationConfirmationPending");

    const pendingConfirmationHelperSource = sourceBetween(
      nativeSidebarSource,
      "function markGxserverPresentationConfirmationPending",
      "function isNativeTerminalSurfaceCreationPendingForProject",
    );
    expect(pendingConfirmationHelperSource).toContain("pendingGxserverPresentationConfirmationBySessionId.set(sessionId");
    expect(pendingConfirmationHelperSource).toContain("function confirmGxserverPresentationSession");
    expect(pendingConfirmationHelperSource).toContain("pendingGxserverPresentationConfirmationBySessionId.delete(sessionId)");
    expect(pendingConfirmationHelperSource).toContain("function isGxserverPresentationConfirmationPendingForProject");
    expect(pendingConfirmationHelperSource).toContain("Date.now() - pending.startedAt");
    expect(pendingConfirmationHelperSource).toContain("GXSERVER_PRESENTATION_CONFIRMATION_PENDING_MS");

    const pruneSource = sourceBetween(
      nativeSidebarSource,
      "function pruneStaleGxserverLocalSessionsFromPresentation",
      "function clearStaleGxserverLocalSessionRuntime",
    );
    expect(pruneSource).toContain("skippedPendingCreateSessionKeys");
    expect(pruneSource).toContain('scope.kind === "all"');
    expect(pruneSource).toContain(
      "isGxserverPresentationConfirmationPendingForProject(project.projectId, session.sessionId)",
    );
    expect(pruneSource).toContain("nativeSidebar.gxserver.staleLocalSessionPruneSkippedPendingCreate");

    const missingPresentationIndex = pruneSource.indexOf("presentationSessionKeys.has(");
    const pendingCreateIndex = pruneSource.indexOf(
      "isGxserverPresentationConfirmationPendingForProject(project.projectId, session.sessionId)",
    );
    const pruneIndex = pruneSource.indexOf("return true;", pendingCreateIndex);
    expect(missingPresentationIndex).toBeGreaterThanOrEqual(0);
    expect(pendingCreateIndex).toBeGreaterThan(missingPresentationIndex);
    expect(pruneIndex).toBeGreaterThan(pendingCreateIndex);

    const terminalReadySource = sourceBetween(
      nativeSidebarSource,
      '} else if (hostEvent.type === "terminalReady") {',
      "const startupText = takeNativeTerminalStartupText(sidebarSessionId);",
    );
    expect(terminalReadySource).toContain("takeNativeTerminalSurfaceCreationPending(sidebarSessionId)");
    expect(terminalReadySource).not.toContain("clearGxserverPresentationConfirmationPending(sidebarSessionId)");
    expect(terminalReadySource).not.toContain("pendingGxserverPresentationConfirmationBySessionId.delete(sidebarSessionId)");

    const paneChromeSource = sourceBetween(
      nativeSidebarSource,
      "function applyGxserverPresentationSessionToNativePaneChrome",
      "gxserverTitleProjectionBySessionKey.set",
    );
    expect(paneChromeSource).toContain(
      "confirmGxserverPresentationSession(presentation.projectId, presentation.sessionId, reason)",
    );
  });
});
