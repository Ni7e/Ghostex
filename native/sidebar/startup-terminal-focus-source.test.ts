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

describe("startup terminal focus source", () => {
  test("queues restored terminal focus only after gxserver presentation confirms the session", () => {
    /*
    CDXC:StartupFocus 2026-06-15-10:59:
    App relaunch should restore keyboard focus to the terminal that owned it at shutdown, but only after gxserver confirms the restored active workspace terminal still exists and before the first post-presentation native layout publish.
    */
    expect(nativeSidebarSource).toContain("const startupRestoredTerminalFocusTarget = {");
    expect(nativeSidebarSource).toContain("sessionId: activeSnapshot().focusedSessionId");
    expect(nativeSidebarSource).toContain("let didResolveStartupRestoredTerminalFocusRequest = false;");

    const helperSource = sourceBetween(
      nativeSidebarSource,
      "function queueStartupRestoredTerminalFocusRequest",
      "function beginNativeSidebarFocusIntent",
    );
    expect(helperSource).toContain("didResolveStartupRestoredTerminalFocusRequest");
    expect(helperSource).toContain("if (!presentation)");
    expect(helperSource).toContain("startupRestoredTerminalFocusTarget.projectId !== activeProjectId");
    expect(helperSource).toContain("snapshot.focusedSessionId !== sessionId");
    expect(helperSource).toContain('session?.kind !== "terminal"');
    expect(helperSource).toContain('session.surface === "commands"');
    expect(helperSource).toContain("session.isSleeping === true");
    expect(helperSource).toContain("isCurrentWorkspaceNativeFocusTarget(snapshot, sessionId)");
    expect(helperSource).toContain('presentationSession.surface !== "workspace"');
    expect(helperSource).toContain("presentationSession.visibleInSidebarByDefault !== true");
    expect(helperSource).toContain("isGxserverPresentationSessionLocallyHidden(project.projectId, sessionId)");
    expect(helperSource).toContain('queueNativeLayoutFocusRequest(sessionId, "startupRestoredTerminalFocus")');

    const startupSnapshotSource = sourceBetween(
      nativeSidebarSource,
      "async function refreshGxserverStartupSnapshot",
      "function startGxserverPresentationSubscription",
    );
    const startupPruneIndex = startupSnapshotSource.indexOf("pruneStaleGxserverLocalSessionsFromPresentation");
    const startupPaneChromeIndex = startupSnapshotSource.indexOf("applyGxserverPresentationSessionsToNativePaneChrome");
    const startupFocusIndex = startupSnapshotSource.indexOf("queueStartupRestoredTerminalFocusRequest");
    const startupPublishIndex = startupSnapshotSource.indexOf("publish();", startupFocusIndex);
    expect(startupFocusIndex).toBeGreaterThan(startupPruneIndex);
    expect(startupFocusIndex).toBeGreaterThan(startupPaneChromeIndex);
    expect(startupPublishIndex).toBeGreaterThan(startupFocusIndex);

    const presentationSnapshotSource = sourceBetween(
      nativeSidebarSource,
      "function applyGxserverPresentationSnapshot",
      "function applyGxserverPresentationDelta",
    );
    const presentationPruneIndex = presentationSnapshotSource.indexOf("pruneStaleGxserverLocalSessionsFromPresentation");
    const presentationPaneChromeIndex = presentationSnapshotSource.indexOf("applyGxserverPresentationSessionsToNativePaneChrome");
    const presentationFocusIndex = presentationSnapshotSource.indexOf("queueStartupRestoredTerminalFocusRequest");
    const presentationPublishIndex = presentationSnapshotSource.indexOf("publish();", presentationFocusIndex);
    expect(presentationFocusIndex).toBeGreaterThan(presentationPruneIndex);
    expect(presentationFocusIndex).toBeGreaterThan(presentationPaneChromeIndex);
    expect(presentationPublishIndex).toBeGreaterThan(presentationFocusIndex);
  });
});
