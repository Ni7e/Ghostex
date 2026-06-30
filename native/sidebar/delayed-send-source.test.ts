import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const localPersistenceSource = readFileSync(
  new URL("./native-project-local-persistence.ts", import.meta.url),
  "utf8",
);
const sessionContractSource = readFileSync(
  new URL("../../shared/session-grid-contract-core.ts", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThan(-1);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("delayed send source", () => {
  test("routes remote delayed sends through remote gxserver enter", () => {
    /*
     * CDXC:RemoteDelayedSend 2026-06-30-15:20:
     * Remote Delayed Send should be a host-owned timer keyed by the scoped
     * remote session id, then fire `/api/sendSessionEnter` on the owning
     * gxserver with only project/session ids. It must not create local attach
     * carriers or shell-command fallbacks.
     */
    const remoteInstallSource = sourceBetween(
      nativeSidebarSource,
      "function installRemoteDelayedSendTimer(",
      "function scheduleRemoteDelayedSend(",
    );
    const remoteScheduleSource = sourceBetween(
      nativeSidebarSource,
      "function scheduleRemoteDelayedSend(",
      "function installDelayedSendTimer(",
    );
    const scheduleSource = sourceBetween(
      nativeSidebarSource,
      "function scheduleDelayedSend(",
      "function cancelDelayedSend(",
    );
    const cancelSource = sourceBetween(
      nativeSidebarSource,
      "function cancelDelayedSend(",
      "function clearRemoteDelayedSendTimer(",
    );
    const remoteProjectionSource = sourceBetween(
      nativeSidebarSource,
      "function getRemoteDelayedSendProjectionForProjectSession(",
      "function getDelayedSendProjectionForProjectSession(",
    );

    expect(nativeSidebarSource).toContain(
      "const delayedSendTimerByRemoteSessionId = new Map<string, RemoteDelayedSendTimerState>();",
    );
    expect(remoteInstallSource).toContain('"/api/sendSessionEnter"');
    expect(remoteInstallSource).toContain("params: {");
    expect(remoteInstallSource).toContain("projectId: target.projectId");
    expect(remoteInstallSource).toContain("sessionId: target.sessionId");
    expect(remoteScheduleSource).toContain("installRemoteDelayedSendTimer(remoteSessionId, target, deadlineAtMs, delayMs);");
    expect(scheduleSource).toContain("const remoteReference = parseRemotePresentationSessionId(sessionId);");
    expect(scheduleSource).toContain("scheduleRemoteDelayedSend(sessionId, remoteReference, delayMs);");
    expect(cancelSource).toContain("clearRemoteDelayedSendTimer(sessionId)");
    expect(remoteProjectionSource).toContain("getRemoteDelayedSendProjectionForRemoteSessionId(");
    expect(nativeSidebarSource).toContain("function hasActiveDelayedSendTimer()");
    expect(nativeSidebarSource).toContain(
      "delayedSendTimerByNativeSessionId.size > 0 || delayedSendTimerByRemoteSessionId.size > 0",
    );
  });

  test("restores delayed sends from minute-level remaining checkpoints", () => {
    /*
     * CDXC:DelayedSend 2026-06-19-14:55:
     * Restart should restore Delayed Send from the last saved remaining
     * duration instead of consuming time while Ghostex is closed. The live
     * deadline remains the in-app countdown source, and the checkpoint updates
     * once per minute while the timer is active.
     */
    const installSource = sourceBetween(
      nativeSidebarSource,
      "function installDelayedSendTimer(",
      "function scheduleDelayedSend(",
    );
    const restoreSource = sourceBetween(
      nativeSidebarSource,
      "function restoreDelayedSendTimerForStoredSession(",
      "function setStoredDelayedSendState(",
    );
    const scheduleSource = sourceBetween(
      nativeSidebarSource,
      "function scheduleDelayedSend(",
      "function cancelDelayedSend(",
    );
    const checkpointSource = sourceBetween(
      nativeSidebarSource,
      "function ensureDelayedSendPersistenceTicker(",
      "function formatDelayedSendDelay(",
    );

    expect(nativeSidebarSource).toContain("const DELAYED_SEND_PERSIST_INTERVAL_MS = 60_000;");
    expect(nativeSidebarSource).toContain("let delayedSendPersistenceTicker");
    expect(installSource).toContain("ensureDelayedSendPersistenceTicker();");
    expect(restoreSource).toContain(
      "const remainingCheckpointMs = normalizeDelayedSendRemainingMs(session.delayedSendRemainingMs);",
    );
    expect(restoreSource).toContain(
      "remainingCheckpointMs !== undefined ? Date.now() + restoreDelayMs : Date.parse(deadlineAt!)",
    );
    expect(scheduleSource).toContain("remainingMs: delayMs");
    expect(checkpointSource).toContain(
      'persistDelayedSendRemainingCheckpoints("delayedSendRemainingCheckpoint")',
    );
    expect(checkpointSource).toContain("remainingMs,");
    expect(localPersistenceSource).toContain(
      "delayedSendRemainingMs: normalizeLocalDelayedSendRemainingMs(session.delayedSendRemainingMs)",
    );
    expect(sessionContractSource).toContain("delayedSendRemainingMs?: number;");
  });
});
