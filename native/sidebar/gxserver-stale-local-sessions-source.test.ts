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

describe("gxserver stale local sessions source", () => {
  test("prunes stale canonical terminal panes against gxserver presentation", () => {
    /*
    CDXC:GxserverPresentation 2026-06-13-12:05:
    Canonical P/G terminal tabs must not be rendered from stale local paneLayout
    after gxserver stops presenting the row. Source coverage keeps startup,
    snapshot, and delta presentation paths wired to the local prune before the
    native layout sync can publish a wakeable placeholder for a deleted row.
    */
    const pruneSource = sourceBetween(
      nativeSidebarSource,
      "function pruneStaleGxserverLocalSessionsFromPresentation",
      "function clearStaleGxserverLocalSessionRuntime",
    );
    expect(pruneSource).toContain("GXSERVER_CANONICAL_PROJECT_ID_PATTERN.test(project.projectId)");
    expect(pruneSource).toContain("isCanonicalGxserverProjectSession(project.projectId, session.sessionId)");
    expect(pruneSource).toContain("removeSessionInSimpleWorkspace(nextWorkspace, sessionId,");
    expect(pruneSource).toContain("wakeReplacement: false");
    expect(pruneSource).toContain("normalizeLiveCommandsPanelState");
    expect(pruneSource).toContain("writeStoredProjects(`pruneStaleGxserverLocalSessions:${reason}`)");

    const runtimeCleanupSource = sourceBetween(
      nativeSidebarSource,
      "function clearStaleGxserverLocalSessionRuntime",
      "function applyGxserverPresentationSnapshot",
    );
    expect(runtimeCleanupSource).toContain("forgetNativeSessionMappingForProject(projectId, sessionId)");
    expect(runtimeCleanupSource).toContain('postNative({ sessionId: nativeSessionId, type: "closeTerminal" })');

    const startupSnapshotSource = sourceBetween(
      nativeSidebarSource,
      "async function refreshGxserverStartupSnapshot",
      "function startGxserverPresentationSubscription",
    );
    expect(startupSnapshotSource).toContain("pruneStaleGxserverLocalSessionsFromPresentation");

    const presentationSnapshotSource = sourceBetween(
      nativeSidebarSource,
      "function applyGxserverPresentationSnapshot",
      "function applyGxserverPresentationDelta",
    );
    expect(presentationSnapshotSource).toContain("pruneStaleGxserverLocalSessionsFromPresentation");

    const presentationDeltaSource = sourceBetween(
      nativeSidebarSource,
      "function applyGxserverPresentationDelta",
      "function applyGxserverPresentationSessionsToNativePaneChrome",
    );
    expect(presentationDeltaSource).toContain("pruneStaleGxserverLocalSessionsFromPresentation");
    expect(presentationDeltaSource).toContain("staleGxserverLocalSessionPruneScopeForDelta(delta)");
    expect(presentationDeltaSource).toContain("stalePruneScope");
  });

  test("limits delta pruning to explicit gxserver removals", () => {
    /*
    CDXC:GxserverPresentation 2026-06-15-10:04:
    Source coverage keeps stale cleanup away from ordinary presentation deltas. A sessionPresentationChanged delta may arrive before gxserver echoes a just-created split, so only explicit removal deltas should prune from the websocket delta stream.
    */
    const scopeSource = sourceBetween(
      nativeSidebarSource,
      "function staleGxserverLocalSessionPruneScopeForDelta",
      "function pruneStaleGxserverLocalSessionsFromPresentation",
    );
    expect(scopeSource).toContain('delta.type === "sessionRemoved"');
    expect(scopeSource).toContain('return { kind: "session", projectId: delta.projectId, sessionId: delta.sessionId };');
    expect(scopeSource).toContain('delta.type === "projectRemoved"');
    expect(scopeSource).toContain('return { kind: "project", projectId: delta.projectId };');
    expect(scopeSource).toContain("return undefined;");

    const pruneSource = sourceBetween(
      nativeSidebarSource,
      "function pruneStaleGxserverLocalSessionsFromPresentation",
      "function clearStaleGxserverLocalSessionRuntime",
    );
    expect(pruneSource).toContain("scope: StaleGxserverLocalSessionPruneScope = { kind: \"all\" }");
    expect(pruneSource).toContain(
      "doesStaleGxserverLocalSessionPruneScopeInclude(scope, project.projectId, session.sessionId)",
    );
  });
});
