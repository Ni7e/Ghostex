import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const terminalFocusDebugLogSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/TerminalFocusDebugLog.swift", import.meta.url),
  "utf8",
);
const nativeLayoutLayeringDebugLogSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/NativeLayoutLayeringDebugLog.swift", import.meta.url),
  "utf8",
);
const nativeT3CodePaneReproLogSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/NativeT3CodePaneReproLog.swift", import.meta.url),
  "utf8",
);
const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("support log noise source", () => {
  test("keeps terminal focus logs sampled and single-line sanitized", () => {
    /*
    CDXC:NativeTerminalFocus 2026-06-16-12:22:
    Terminal focus support logs should keep routine key/input and viewport
    probes sampled while using one shared helper that reports suppressed line
    counts and prevents sanitized free-form log messages from spanning lines.
    */
    const sampledEvents = sourceBetween(
      terminalFocusDebugLogSource,
      "private static let sampledEvents = Set([",
      "private static let logDateFormatter",
    );
    expect(sampledEvents).toContain('"nativeFocusTrace.surfaceKeyDown"');
    expect(sampledEvents).toContain('"nativeHost.activationBoundary.inputEvent"');
    expect(sampledEvents).toContain('"nativeWorkspace.zmxPersistenceViewportRefresh.sent"');
    expect(terminalFocusDebugLogSource).toContain("func shouldWriteSampledLogEvent(");
    expect(terminalFocusDebugLogSource).toContain('payload["suppressedSinceLastWrite"]');
    expect(terminalFocusDebugLogSource).toContain("func singleLineLogText(_ message: String) -> String");
    expect(terminalFocusDebugLogSource).toContain('replacingOccurrences(of: "\\n", with: "\\\\n")');
    expect(terminalFocusDebugLogSource).toContain("singleLineLogText(redactSensitiveText(message))");
  });

  test("samples layout/layering transition loops at the writer boundary", () => {
    /*
    CDXC:WorkspaceLayeringDiagnostics 2026-06-16-12:22:
    Layout/layering logs need transition evidence, not one line for every
    active-layout, selection, or focus-owner tick during Debugging Mode.
    */
    const sampledEvents = sourceBetween(
      nativeLayoutLayeringDebugLogSource,
      "private static let sampledEvents = Set([",
      "private static let logDateFormatter",
    );
    expect(nativeLayoutLayeringDebugLogSource).toContain(
      "private static let highVolumeSampleInterval: TimeInterval = 5",
    );
    expect(sampledEvents).toContain('"nativePaneLayoutTrace.layoutSync.posted"');
    expect(sampledEvents).toContain('"nativePaneLayoutTrace.terminalFocused.received"');
    expect(sampledEvents).toContain('"nativeWorkspace.projectEditor.layout.active"');
    expect(nativeLayoutLayeringDebugLogSource).toContain("shouldWriteSampledLogEvent(");
  });

  test("samples T3 and CEF repro probes that fire during drag/layout loops", () => {
    /*
    CDXC:T3Code 2026-06-16-12:22:
    T3/CEF support logs should retain source-drag and companion-sync breadcrumbs
    without rotating through one 25 MB file per active drag or layout sequence.
    */
    const sampledEvents = sourceBetween(
      nativeT3CodePaneReproLogSource,
      "private static let sampledEvents = Set([",
      "private static let logDateFormatter",
    );
    expect(nativeT3CodePaneReproLogSource).toContain(
      "private static let highVolumeSampleInterval: TimeInterval = 5",
    );
    expect(sampledEvents).toContain('"nativeWorkspace.projectEditor.cef.sourceDragDiagnostic"');
    expect(sampledEvents).toContain('"nativeWorkspace.projectEditor.cef.sourceDragDiagnostic.nativeMouse"');
    expect(sampledEvents).toContain('"nativeWorkspace.projectEditor.companion.sync"');
    expect(nativeT3CodePaneReproLogSource).toContain("shouldWriteSampledLogEvent(");
  });

  test("keeps sidebar focus projection diagnostics metadata-only", () => {
    /*
    CDXC:SidebarSessionFocus 2026-06-29-03:03:
    Sidebar focus projection repro logs should show whether the focused
    workspace session was projected as a focused visible row, without writing
    session names, paths, URLs, command text, terminal titles, or raw details.
    */
    const focusProjectionSource = sourceBetween(
      nativeSidebarSource,
      "type SidebarFocusProjectionDebugRow = {",
      "function buildSidebarMessage()",
    );
    expect(focusProjectionSource).toContain("appendSidebarRefreshDebugLog(");
    expect(focusProjectionSource).toContain('"nativeSidebar.focusProjection.mismatch"');
    expect(focusProjectionSource).toContain("sessionId: session.sessionId");
    expect(focusProjectionSource).toContain("groupId: group.groupId");
    expect(focusProjectionSource).not.toMatch(/\b(title|path|url|command|terminalTitle|primaryTitle|displayTitle|details):/i);
    expect(focusProjectionSource).not.toContain("session.title");
    expect(focusProjectionSource).not.toContain("group.title");
  });
});
