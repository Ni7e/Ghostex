import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import {
  GXSERVER_LOCAL_API_HOST,
  GXSERVER_PROTOCOL_VERSION,
  type GxserverAuthToken,
  type GxserverRuntimeMetadata,
  type GxserverSessionDomainState,
  type GxserverTitleObservationState,
} from "../protocol/index.js";
import type { GxserverLogger } from "./logger.js";
import type { GxserverResolvedTool } from "./toolchain.js";
import { providerZmxSessionName } from "./zmx-lifecycle.js";

export interface GxserverZmxTitleObservationStateChange {
  projectId: GxserverSessionDomainState["projectId"];
  reason: string;
  sessionId: GxserverSessionDomainState["sessionId"];
  state: GxserverTitleObservationState;
}

interface GxserverZmxTitleObserverOptions {
  authToken: GxserverAuthToken;
  logger: GxserverLogger;
  maxConsecutiveFailures?: number;
  metadata: GxserverRuntimeMetadata;
  now?: () => Date;
  onObservationStateChange?: (change: GxserverZmxTitleObservationStateChange) => void | Promise<void>;
  readyDelayMs?: number;
  requireZmx: () => Promise<GxserverResolvedTool>;
  retryDelaysMs?: readonly number[];
}

interface DesiredZmxTitleObservationSession {
  projectId: GxserverSessionDomainState["projectId"];
  sessionId: GxserverSessionDomainState["sessionId"];
  zmxName: string;
}

interface ZmxTitleObserverProcess extends DesiredZmxTitleObservationSession {
  child: ChildProcessByStdio<null, Readable, Readable>;
  lastStartedAt: string;
  readyTimer?: NodeJS.Timeout;
  stderr: string;
  stdout: string;
}

const DEFAULT_READY_DELAY_MS = 250;
const DEFAULT_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 5_000] as const;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = DEFAULT_RETRY_DELAYS_MS.length;

/*
CDXC:ZmxTitleObservations 2026-06-01-10:17:
zmx is the shared PTY owner for managed terminal sessions, so gxserver should consume coalesced zmx title observations instead of relying on per-client native title snapshots. The observer process feeds zmx's settled title stream back through the existing authenticated title-ingest API, keeping persistence/status rules centralized in gxserver.

CDXC:ZmxTitleObservations 2026-06-06-23:21:
Persistent zmx observer diagnostics must not include title previews, raw zmx output, response text, or stderr content. Use lengths, status codes, IDs, and booleans so Debugging Mode can diagnose watcher behavior without writing user-owned terminal titles or command output to support-bundle logs.

CDXC:ZmxTitleObservations 2026-06-07-00:30:
Waking a zmx-backed session can expose the session row before the zmx watch-title socket is ready. Keep the desired observation registered, retry startup with bounded backoff, and publish coarse watcher health so Auto Sleep never treats missing working-status detection as proof that the agent is idle.

CDXC:GxserverLogs 2026-06-15-20:39:
zmx title-observer retry scheduling is diagnostic bookkeeping, not a normal-mode warning. Keep retries visible when Debugging Mode is enabled, emit one warning when the watcher becomes unavailable after bounded retries, and never persist zmx session names because project/session ids already identify the affected row.
*/
export class GxserverZmxTitleObserver {
  #closed = false;
  readonly #options: GxserverZmxTitleObserverOptions;
  readonly #desiredSessions = new Map<string, DesiredZmxTitleObservationSession>();
  readonly #failureCounts = new Map<string, number>();
  readonly #processes = new Map<string, ZmxTitleObserverProcess>();
  readonly #retryTimers = new Map<string, NodeJS.Timeout>();
  readonly #states = new Map<string, GxserverTitleObservationState>();
  readonly #suspendedUnavailableKeys = new Set<string>();

  constructor(options: GxserverZmxTitleObserverOptions) {
    this.#options = options;
  }

  async syncSessions(sessions: readonly GxserverSessionDomainState[], reason: string): Promise<void> {
    const desiredKeys = new Set<string>();
    for (const session of sessions) {
      if (!isZmxTitleObservableSession(session)) {
        this.#stopObserving(sessionKey(session), reason);
        continue;
      }
      desiredKeys.add(sessionKey(session));
      await this.observeSession(session, reason);
    }
    for (const [key] of this.#desiredSessions) {
      if (!desiredKeys.has(key)) {
        this.#stopObserving(key, "session-no-longer-observable");
      }
    }
  }

  async syncSession(session: GxserverSessionDomainState, reason: string): Promise<void> {
    if (!isZmxTitleObservableSession(session)) {
      this.#stopObserving(sessionKey(session), reason);
      return;
    }
    await this.observeSession(session, reason);
  }

  async observeSession(session: GxserverSessionDomainState, reason: string): Promise<void> {
    if (this.#closed) {
      return;
    }
    if (!isZmxTitleObservableSession(session)) {
      this.#stopObserving(sessionKey(session), reason);
      return;
    }
    const key = sessionKey(session);
    const zmxName = providerZmxSessionName(session);
    if (!zmxName) {
      return;
    }
    const previousDesired = this.#desiredSessions.get(key);
    const desired: DesiredZmxTitleObservationSession = {
      projectId: session.projectId,
      sessionId: session.sessionId,
      zmxName,
    };
    this.#desiredSessions.set(key, desired);
    if (this.#suspendedUnavailableKeys.has(key)) {
      if (previousDesired?.zmxName !== desired.zmxName || isZmxTitleObserverRecoveryReason(reason)) {
        this.#suspendedUnavailableKeys.delete(key);
        this.#failureCounts.delete(key);
      } else {
        return;
      }
    }
    const existing = this.#processes.get(key);
    if (existing && !existing.child.killed && existing.child.exitCode === null) {
      return;
    }
    if (this.#retryTimers.has(key)) {
      return;
    }

    await this.#startProcess(key, desired, reason);
  }

  close(): void {
    this.#closed = true;
    for (const key of this.#retryTimers.keys()) {
      this.#clearRetryTimer(key);
    }
    for (const [key, process] of this.#processes) {
      this.#stopProcess(key, process, "server-shutdown");
    }
    this.#desiredSessions.clear();
  }

  async #startProcess(key: string, desired: DesiredZmxTitleObservationSession, reason: string): Promise<void> {
    if (this.#closed || !this.#isDesiredSession(key, desired)) {
      return;
    }
    this.#clearRetryTimer(key);
    const lastStartedAt = this.#nowIso();
    let zmx: GxserverResolvedTool;
    try {
      zmx = await this.#options.requireZmx();
    } catch (error) {
      const failureCount = this.#nextFailureCount(key);
      await this.#options.logger.log({
        details: {
          failureCount,
          message: error instanceof Error ? error.message : String(error),
          reason,
        },
        event: "zmxTitleObserver.resolveFailed",
        level: failureCount === 1 ? "warn" : "debug",
        projectId: desired.projectId,
        serverId: this.#options.metadata.serverId,
        sessionId: desired.sessionId,
      });
      this.#scheduleRetry(key, desired, reason, "resolve-failed");
      return;
    }

    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(zmx.executablePath, ["watch-title", desired.zmxName], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const failureCount = this.#nextFailureCount(key);
      await this.#options.logger.log({
        details: {
          failureCount,
          message: error instanceof Error ? error.message : String(error),
          reason,
        },
        event: "zmxTitleObserver.spawnFailed",
        level: failureCount === 1 ? "warn" : "debug",
        projectId: desired.projectId,
        serverId: this.#options.metadata.serverId,
        sessionId: desired.sessionId,
      });
      this.#scheduleRetry(key, desired, reason, "spawn-failed");
      return;
    }

    const process: ZmxTitleObserverProcess = {
      child,
      lastStartedAt,
      projectId: desired.projectId,
      sessionId: desired.sessionId,
      stderr: "",
      stdout: "",
      zmxName: desired.zmxName,
    };
    this.#processes.set(key, process);
    this.#emitObservationState(key, process, {
      ...this.#previousObservationContext(key),
      lastStartedAt,
      status: "starting",
    }, reason);

    await this.#options.logger.log({
      details: { reason },
      event: "zmxTitleObserver.started",
      level: "debug",
      projectId: desired.projectId,
      serverId: this.#options.metadata.serverId,
      sessionId: desired.sessionId,
    });

    process.readyTimer = setTimeout(() => {
      this.#markProcessActive(key, process, "watcher-ready");
    }, this.#readyDelayMs());
    process.readyTimer.unref();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      this.#handleStdout(key, process, String(chunk));
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      process.stderr = trimBufferedText(`${process.stderr}${String(chunk)}`);
    });
    child.on("error", (error) => {
      void this.#options.logger.log({
        details: { message: error.message },
        event: "zmxTitleObserver.error",
        level: "debug",
        projectId: desired.projectId,
        serverId: this.#options.metadata.serverId,
        sessionId: desired.sessionId,
      });
    });
    child.on("exit", (code, signal) => {
      if (this.#processes.get(key)?.child === child) {
        this.#processes.delete(key);
      }
      this.#clearReadyTimer(process);
      const shouldRetry = !this.#closed && this.#desiredSessions.get(key)?.zmxName === desired.zmxName;
      void this.#options.logger.log({
        details: {
          code,
          willRetry: shouldRetry,
          signal,
          stderrLength: process.stderr.length,
        },
        event: this.#closed ? "zmxTitleObserver.stopped" : "zmxTitleObserver.exited",
        level: this.#closed || code === 0 || shouldRetry ? "debug" : "warn",
        projectId: desired.projectId,
        serverId: this.#options.metadata.serverId,
        sessionId: desired.sessionId,
      });
      if (shouldRetry) {
        this.#scheduleRetry(key, desired, "process-exit", "process-exit");
      }
    });
  }

  #stopProcess(key: string, process: ZmxTitleObserverProcess, reason: string): void {
    this.#processes.delete(key);
    this.#clearReadyTimer(process);
    if (!process.child.killed && process.child.exitCode === null) {
      process.child.kill("SIGTERM");
    }
    void this.#options.logger.log({
      details: { reason },
      event: "zmxTitleObserver.stopRequested",
      level: "debug",
      projectId: process.projectId,
      serverId: this.#options.metadata.serverId,
      sessionId: process.sessionId,
    });
  }

  #stopObserving(key: string, reason: string): void {
    this.#desiredSessions.delete(key);
    this.#failureCounts.delete(key);
    this.#clearRetryTimer(key);
    this.#suspendedUnavailableKeys.delete(key);
    this.#states.delete(key);
    const process = this.#processes.get(key);
    if (process) {
      this.#stopProcess(key, process, reason);
    }
  }

  #handleStdout(key: string, process: ZmxTitleObserverProcess, chunk: string): void {
    process.stdout = trimBufferedText(`${process.stdout}${chunk}`);
    let newlineIndex = process.stdout.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = process.stdout.slice(0, newlineIndex).trim();
      process.stdout = process.stdout.slice(newlineIndex + 1);
      if (line) {
        void this.#ingestLine(key, process, line);
      }
      newlineIndex = process.stdout.indexOf("\n");
    }
  }

  async #ingestLine(key: string, process: ZmxTitleObserverProcess, line: string): Promise<void> {
    const title = parseZmxTitleLine(line);
    if (!title) {
      await this.#options.logger.log({
        details: { lineLength: line.length },
        event: "zmxTitleObserver.invalidLine",
        level: "debug",
        projectId: process.projectId,
        serverId: this.#options.metadata.serverId,
        sessionId: process.sessionId,
      });
      return;
    }
    this.#markProcessActive(key, process, "title-observed");
    try {
      const response = await fetch(`http://${GXSERVER_LOCAL_API_HOST}:${this.#options.metadata.port}/api/ingestTerminalTitleEvent`, {
        body: JSON.stringify({
          params: {
            projectId: process.projectId,
            rawTitle: title,
            sessionId: process.sessionId,
            sessionPersistenceProvider: "zmx",
          },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        }),
        headers: {
          authorization: `Bearer ${this.#options.authToken}`,
          "content-type": "application/json",
          "x-gxserver-protocol-version": String(GXSERVER_PROTOCOL_VERSION),
        },
        method: "POST",
      });
      if (!response.ok) {
        const responseText = await response.text();
        await this.#options.logger.log({
          details: {
            responseStatus: response.status,
            responseTextLength: responseText.length,
          },
          event: "zmxTitleObserver.ingestFailed",
          level: "warn",
          projectId: process.projectId,
          serverId: this.#options.metadata.serverId,
          sessionId: process.sessionId,
        });
        return;
      }
      await this.#options.logger.log({
        details: {
          key,
          titleLength: title.length,
        },
        event: "zmxTitleObserver.ingested",
        level: "debug",
        projectId: process.projectId,
        serverId: this.#options.metadata.serverId,
        sessionId: process.sessionId,
      });
    } catch (error) {
      await this.#options.logger.log({
        details: { message: error instanceof Error ? error.message : String(error) },
        event: "zmxTitleObserver.ingestError",
        level: "warn",
        projectId: process.projectId,
        serverId: this.#options.metadata.serverId,
        sessionId: process.sessionId,
      });
    }
  }

  #markProcessActive(key: string, process: ZmxTitleObserverProcess, reason: string): void {
    if (this.#processes.get(key) !== process || process.child.killed || process.child.exitCode !== null) {
      return;
    }
    this.#failureCounts.delete(key);
    this.#suspendedUnavailableKeys.delete(key);
    const previous = this.#states.get(key);
    const lastObservedAt = reason === "title-observed" ? this.#nowIso() : previous?.lastObservedAt;
    if (previous?.status === "active" && reason === "title-observed") {
      /*
      CDXC:ZmxTitleObservations 2026-06-07-00:30:
      Spinner titles can change frequently while the watcher is already healthy. Keep the latest observation timestamp in memory for later failure diagnostics, but do not persist or broadcast health-only updates on every title tick.
      */
      this.#states.set(key, {
        ...previous,
        lastObservedAt,
      });
      return;
    }
    this.#emitObservationState(key, process, {
      lastStartedAt: process.lastStartedAt,
      ...(lastObservedAt ? { lastObservedAt } : {}),
      status: "active",
    }, reason);
  }

  #scheduleRetry(
    key: string,
    desired: DesiredZmxTitleObservationSession,
    reason: string,
    failedPhase: string,
  ): void {
    if (this.#closed || !this.#isDesiredSession(key, desired)) {
      return;
    }
    this.#clearRetryTimer(key);
    const failureCount = this.#nextFailureCount(key);
    if (failureCount > this.#maxConsecutiveFailures()) {
      const lastFailedAt = this.#nowIso();
      this.#suspendedUnavailableKeys.add(key);
      this.#emitObservationState(key, desired, {
        ...this.#previousObservationContext(key),
        failureCount,
        lastFailedAt,
        status: "failed",
      }, reason);
      void this.#options.logger.log({
        details: {
          failedPhase,
          failureCount,
          reason,
        },
        event: "zmxTitleObserver.retrySuppressed",
        level: "debug",
        projectId: desired.projectId,
        serverId: this.#options.metadata.serverId,
        sessionId: desired.sessionId,
      });
      void this.#options.logger.log({
        details: {
          failedPhase,
          failureCount,
          reason,
        },
        event: "zmxTitleObserver.unavailable",
        level: "warn",
        projectId: desired.projectId,
        serverId: this.#options.metadata.serverId,
        sessionId: desired.sessionId,
      });
      return;
    }
    const delayMs = this.#retryDelayMs(failureCount);
    const lastFailedAt = this.#nowIso();
    const nextRetryAt = new Date(Date.parse(lastFailedAt) + delayMs).toISOString();
    this.#emitObservationState(key, desired, {
      ...this.#previousObservationContext(key),
      failureCount,
      lastFailedAt,
      nextRetryAt,
      status: "retrying",
    }, reason);
    const timer = setTimeout(() => {
      this.#retryTimers.delete(key);
      void this.#startProcess(key, desired, "retry");
    }, delayMs);
    timer.unref();
    this.#retryTimers.set(key, timer);
    void this.#options.logger.log({
      details: {
        delayMs,
        failedPhase,
        failureCount,
        reason,
      },
      event: "zmxTitleObserver.retryScheduled",
      level: "debug",
      projectId: desired.projectId,
      serverId: this.#options.metadata.serverId,
      sessionId: desired.sessionId,
    });
  }

  #emitObservationState(
    key: string,
    session: DesiredZmxTitleObservationSession,
    state: GxserverTitleObservationState,
    reason: string,
  ): void {
    const previous = this.#states.get(key);
    if (JSON.stringify(previous) === JSON.stringify(state)) {
      return;
    }
    this.#states.set(key, state);
    const handler = this.#options.onObservationStateChange;
    if (!handler) {
      return;
    }
    void Promise.resolve(handler({
      projectId: session.projectId,
      reason,
      sessionId: session.sessionId,
      state,
    })).catch((error) => {
      void this.#options.logger.log({
        details: { message: error instanceof Error ? error.message : String(error), reason, state: state.status },
        event: "zmxTitleObserver.stateCallbackFailed",
        level: "warn",
        projectId: session.projectId,
        serverId: this.#options.metadata.serverId,
        sessionId: session.sessionId,
      });
    });
  }

  #previousObservationContext(key: string): Partial<GxserverTitleObservationState> {
    const previous = this.#states.get(key);
    return {
      ...(previous?.lastObservedAt ? { lastObservedAt: previous.lastObservedAt } : {}),
      ...(previous?.lastStartedAt ? { lastStartedAt: previous.lastStartedAt } : {}),
    };
  }

  #nextFailureCount(key: string): number {
    const previous = this.#failureCounts.get(key) ?? 0;
    const next = previous + 1;
    this.#failureCounts.set(key, next);
    return next;
  }

  #clearRetryTimer(key: string): void {
    const timer = this.#retryTimers.get(key);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.#retryTimers.delete(key);
  }

  #clearReadyTimer(process: ZmxTitleObserverProcess): void {
    if (!process.readyTimer) {
      return;
    }
    clearTimeout(process.readyTimer);
    process.readyTimer = undefined;
  }

  #readyDelayMs(): number {
    return normalizeDelayMs(this.#options.readyDelayMs, DEFAULT_READY_DELAY_MS);
  }

  #retryDelayMs(failureCount: number): number {
    const delays = this.#options.retryDelaysMs?.length ? this.#options.retryDelaysMs : DEFAULT_RETRY_DELAYS_MS;
    return normalizeDelayMs(delays[Math.min(Math.max(0, failureCount - 1), delays.length - 1)], DEFAULT_RETRY_DELAYS_MS[0]);
  }

  #maxConsecutiveFailures(): number {
    return normalizePositiveInteger(this.#options.maxConsecutiveFailures, DEFAULT_MAX_CONSECUTIVE_FAILURES);
  }

  #nowIso(): string {
    return (this.#options.now?.() ?? new Date()).toISOString();
  }

  #isDesiredSession(key: string, desired: DesiredZmxTitleObservationSession): boolean {
    const current = this.#desiredSessions.get(key);
    return (
      current?.projectId === desired.projectId &&
      current.sessionId === desired.sessionId &&
      current.zmxName === desired.zmxName
    );
  }
}

function parseZmxTitleLine(line: string): string | undefined {
  try {
    const parsed = JSON.parse(line) as { title?: unknown };
    return typeof parsed.title === "string" && parsed.title.trim() ? parsed.title : undefined;
  } catch {
    return undefined;
  }
}

/*
CDXC:ZmxTitleObservations 2026-06-15-17:32:
Title observation is only valid for confirmed live zmx providers. Persistence-disabled, missing, sleeping, and stopped rows must not spawn `zmx watch-title`, because repeated socket failures can overload gxserver and make sidebar selection lag.
*/
export function isZmxTitleObservableSession(session: GxserverSessionDomainState): boolean {
  return (
    (session.kind === "terminal" || session.kind === "agent") &&
    session.lifecycleState === "running" &&
    session.providerState.lifecycleState === "exists" &&
    sessionPersistenceProviderAllowsZmxTitleObservation(session) &&
    Boolean(providerZmxSessionName(session))
  );
}

function sessionKey(session: Pick<GxserverSessionDomainState, "projectId" | "sessionId">): string {
  return `${session.projectId}/${session.sessionId}`;
}

function normalizeDelayMs(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function sessionPersistenceProviderAllowsZmxTitleObservation(session: GxserverSessionDomainState): boolean {
  const provider =
    readRecordText(session.providerState.provider) ??
    readRecordText(session.runtimeSettings.sessionPersistenceProvider);
  return provider === undefined || provider === "zmx";
}

function readRecordText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isZmxTitleObserverRecoveryReason(reason: string): boolean {
  switch (reason) {
    case "create-session":
    case "fork-session":
    case "probe-session-provider":
    case "server-start":
    case "start-session-provider":
    case "wake-session":
      return true;
    default:
      return false;
  }
}

function trimBufferedText(value: string): string {
  return value.length > 16_384 ? value.slice(-16_384) : value;
}
