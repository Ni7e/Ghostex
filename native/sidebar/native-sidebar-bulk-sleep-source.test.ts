import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const sortableSessionCardSource = readFileSync(
  new URL("../../sidebar/sortable-session-card.tsx", import.meta.url),
  "utf8",
);
const sidebarRefreshDebugLogSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/SidebarRefreshDebugLog.swift", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function countOccurrences(source: string, pattern: string): number {
  return source.split(pattern).length - 1;
}

describe("native sidebar bulk sleep cascade source", () => {
  test("keeps bulk sleep fan-out on a paced queue", () => {
    /*
     * CDXC:NativeSidebarBulkActions 2026-06-13-02:09:
     * Multi-session sleep commands must sleep one target at a time with a short
     * interval between provider shutdowns so Sleep Inactive, Sleep below, and
     * tab-scope sleep do not lag the app or spike the laptop.
     */
    const schedulerSource = sourceBetween(
      nativeSidebarSource,
      "type NativeSidebarBulkSleepSource",
      "type NativeBootstrap",
    );

    expect(schedulerSource).toContain("const NATIVE_SIDEBAR_BULK_SLEEP_INTERVAL_MS = 350;");
    expect(schedulerSource).toContain("delayBetweenOperationsMs?: number");
    expect(schedulerSource).toContain("window.setTimeout(runNext, delayBetweenOperationsMs)");
    expect(schedulerSource).toContain("function runNativeSidebarBulkSleepActionInBackground");
    expect(schedulerSource).toContain(
      "delayBetweenOperationsMs: NATIVE_SIDEBAR_BULK_SLEEP_INTERVAL_MS",
    );
    expect(schedulerSource).toContain('appendNativeSidebarBulkSleepDebugLog("operation.started"');
    expect(schedulerSource).toContain('"operation.completed"');
    expect(schedulerSource).toContain('"operation.threw"');
    expect(schedulerSource).toContain('appendNativeSidebarBulkSleepDebugLog("completed"');
    expect(schedulerSource).toContain("operationDurationMs");
    expect(schedulerSource).toContain("timerDriftMs");
  });

  test("keeps Sleep below request logs and native writer privacy-safe", () => {
    const sleepBelowDetailsSource = sourceBetween(
      sortableSessionCardSource,
      "export function createSleepBelowDebugDetails",
      "function roundSleepBelowDebugMs",
    );
    const sleepBelowPayloadSource = sourceBetween(sleepBelowDetailsSource, "  return {", "  };");
    expect(sleepBelowDetailsSource).toContain('action: "sleepBelow"');
    expect(sleepBelowDetailsSource).toContain("targetCount");
    expect(sleepBelowDetailsSource).toContain("visibleBelowCount");
    expect(sleepBelowDetailsSource).toContain("postMessageDurationMs");
    expect(sleepBelowDetailsSource).toContain("frameDelayMs");
    expect(sleepBelowPayloadSource).not.toContain("sessionId");
    expect(sleepBelowPayloadSource).not.toContain("sessionIds");
    expect(sleepBelowPayloadSource).not.toContain("title");
    expect(sleepBelowPayloadSource).not.toContain("path");
    expect(sleepBelowPayloadSource).not.toContain("url");
    expect(sleepBelowPayloadSource).not.toContain("command");
    expect(sleepBelowPayloadSource).not.toContain("text");
    expect(sleepBelowPayloadSource).not.toContain("message");

    const requestSleepBelowSource = sourceBetween(
      sortableSessionCardSource,
      "  const requestSleepBelow = () => {",
      "  const requestCloseBelow = () => {",
    );
    expect(sortableSessionCardSource).toContain(
      'const SLEEP_BELOW_DEBUG_EVENT_PREFIX = "sleepBelow"',
    );
    expect(requestSleepBelowSource).toContain('source: "sleepBelow"');
    expect(requestSleepBelowSource).toContain('${SLEEP_BELOW_DEBUG_EVENT_PREFIX}.requested');
    expect(requestSleepBelowSource).toContain('${SLEEP_BELOW_DEBUG_EVENT_PREFIX}.posted');
    expect(requestSleepBelowSource).toContain('${SLEEP_BELOW_DEBUG_EVENT_PREFIX}.nextFrame');

    expect(sidebarRefreshDebugLogSource).toContain("NativeLogPrivacy.sanitizePayload(payload)");
    expect(sidebarRefreshDebugLogSource).toContain("parseDetailsPayload(details)");
  });

  test("samples high-volume sidebar refresh diagnostics on both React and native writers", () => {
    /*
     * CDXC:SidebarRefreshDiagnostics 2026-06-16-12:22:
     * Sidebar refresh diagnostics must sample the same persisted event names in
     * React and Swift so `sidebar.refresh.*` and presentation-delta patch loops
     * cannot bypass the support-bundle noise controls.
     */
    const reactRefreshSampler = sourceBetween(
      nativeSidebarSource,
      "function isHighVolumeSidebarRefreshDebugEvent(event: string): boolean {",
      "function shouldSampleSidebarRefreshDebugLog(event: string, intervalMs: number): boolean",
    );
    expect(nativeSidebarSource).toContain("const SIDEBAR_REFRESH_DEBUG_LOG_SAMPLE_MS = 5_000;");
    expect(reactRefreshSampler).toContain('event === "sidebar.refresh.messageReceived"');
    expect(reactRefreshSampler).toContain('event === "sidebar.refresh.messageApplied"');
    expect(reactRefreshSampler).toContain('event === "sidebar.refresh.renderStateChanged"');
    expect(reactRefreshSampler).toContain('event.endsWith(".presentationDelta.sidebarPatch")');

    const nativeRefreshSampler = sourceBetween(
      sidebarRefreshDebugLogSource,
      "private static let sampledEvents = Set([",
      "private static let logDateFormatter",
    );
    expect(sidebarRefreshDebugLogSource).toContain("private static let highVolumeSampleInterval: TimeInterval = 5");
    expect(nativeRefreshSampler).toContain('"sidebar.refresh.messageReceived"');
    expect(nativeRefreshSampler).toContain('"sidebar.refresh.messageApplied"');
    expect(nativeRefreshSampler).toContain('"sidebar.refresh.renderStateChanged"');
    expect(nativeRefreshSampler).toContain('"nativeSidebar.gxserver.presentationDelta.sidebarPatch"');
    expect(sidebarRefreshDebugLogSource).toContain("shouldWriteSampledLogEvent(");
  });

  test("routes multi-session sleep actions through the sleep cascade", () => {
    const setSessionsSleepingSource = sourceBetween(
      nativeSidebarSource,
      "function setNativeSessionsSleepingInBackground",
      "function closeNativeSessionsInBackground",
    );
    expect(setSessionsSleepingSource).toContain("source: options.source ?? \"setSessionsSleeping\"");
    expect(setSessionsSleepingSource).toContain("skippedAlreadySleepingCount");

    const titlebarSleepSource = sourceBetween(
      nativeSidebarSource,
      "function sleepInactiveSessionsFromTitlebar",
      "function focusResourceSessionFromTitlebar",
    );
    expect(titlebarSleepSource).toContain('source: "titlebarSleepInactive"');

    const projectSleepSource = sourceBetween(
      nativeSidebarSource,
      "function sleepInactiveProjectSessions",
      "function hasProjectedDelayedSend",
    );
    expect(countOccurrences(projectSleepSource, 'source: "projectSleepInactive"')).toBe(2);

    const autoSleepSource = sourceBetween(
      nativeSidebarSource,
      'function runNativeAutoSleepMonitor(source: "interval" | "settings-change" | "startup")',
      "function shouldAutoSleepAgentSession",
    );
    expect(countOccurrences(autoSleepSource, 'source: "autoSleep"')).toBe(2);

    const titlebarQuitSource = sourceBetween(
      nativeSidebarSource,
      "function quitResourcesFromTitlebar",
      "function setNativeSessionPoppedOut",
    );
    expect(titlebarQuitSource).toContain("let includesSleepOperation = false");
    expect(titlebarQuitSource).toContain('source: "resourcesQuit"');

    const closeAllSource = sourceBetween(
      nativeSidebarSource,
      "function closeAllNativeSessions",
      "function workspaceHasOpenSessions",
    );
    expect(closeAllSource).toContain('source: "closeAllAsSleep"');

    const remoteSleepSource = sourceBetween(
      nativeSidebarSource,
      "function sleepInactiveRemoteProjectSessions",
      "function closeInactiveRemoteProjectSessions",
    );
    expect(remoteSleepSource).toContain('source: "remoteSleepInactive"');

    const sidebarMessageSource = sourceBetween(
      nativeSidebarSource,
      '    case "setSessionsSleeping": {',
      '    case "setSessionFavorite":',
    );
    expect(sidebarMessageSource).toContain(
      'message.source === "sleepBelow" ? "sleepBelow" : "setSessionsSleeping"',
    );

    const remoteGroupSleepSource = sourceBetween(
      nativeSidebarSource,
      '    case "setGroupSleeping": {',
      '    case "sleepInactiveProjectSessions":',
    );
    expect(remoteGroupSleepSource).toContain('source: "remoteGroupSleep"');

    const paneTabSleepSource = sourceBetween(
      nativeSidebarSource,
      "function handleNativePaneTabSleepRequested",
      "function handleNativePaneTabReorderRequested",
    );
    expect(paneTabSleepSource).toContain('source: "paneTabSleep"');
  });
});
