import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GxserverZmxTitleObserver } from "../src/zmx-title-observer.js";
import type {
  GxserverAuthToken,
  GxserverRuntimeMetadata,
  GxserverSessionDomainState,
} from "../protocol/index.js";
import type { GxserverLogger } from "../src/logger.js";

test("zmx title observer retries after early watch-title failure", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "gxserver-zmx-title-observer-"));
  const counterPath = path.join(tempDir, "watch-count.txt");
  const fakeZmxPath = path.join(tempDir, "fake-zmx.mjs");
  const changes: string[] = [];
  const logger: GxserverLogger = {
    async log(): Promise<void> {},
  };

  try {
    await writeFile(
      fakeZmxPath,
      `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const counterPath = ${JSON.stringify(counterPath)};
let count = 0;
try {
  count = Number(readFileSync(counterPath, "utf8")) || 0;
} catch {}
writeFileSync(counterPath, String(count + 1));
if (process.argv[2] !== "watch-title") {
  process.exit(2);
}
if (count === 0) {
  process.exit(1);
}
setInterval(() => {}, 1000);
`,
      "utf8",
    );
    await chmod(fakeZmxPath, 0o755);

    const observer = new GxserverZmxTitleObserver({
      authToken: "test-token" as GxserverAuthToken,
      logger,
      metadata: metadataFixture(),
      onObservationStateChange: (change) => {
        changes.push(change.state.status);
      },
      readyDelayMs: 5,
      requireZmx: async () => ({
        executablePath: fakeZmxPath,
        source: "devSubmodule",
        tool: "zmx",
      }),
      retryDelaysMs: [10, 20],
    });

    try {
      /*
      CDXC:ZmxTitleObservations 2026-06-07-00:30:
      A wake can start title observation before zmx exposes its watch-title socket. The observer must retry early process failure and become active once the watcher stays alive, otherwise working-status detection can remain stale until Auto Sleep incorrectly sleeps the agent.
      */
      await observer.observeSession(sessionFixture(), "wake-session");
      await waitFor(async () =>
        Number(await readFile(counterPath, "utf8").catch(() => "0")) >= 2 &&
        changes.includes("retrying") &&
        changes.filter((status) => status === "starting").length >= 2 &&
        changes.at(-1) === "active"
      );

      const watchCount = Number(await readFile(counterPath, "utf8"));
      assert.ok(watchCount >= 2, "watch-title was retried after the first failure");
      assert.ok(changes.filter((status) => status === "starting").length >= 2);
      assert.ok(changes.includes("retrying"));
      assert.equal(changes.at(-1), "active");
    } finally {
      observer.close();
    }
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("zmx title observer backs off and warns once when watch-title becomes unavailable", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "gxserver-zmx-title-observer-"));
  const fakeZmxPath = path.join(tempDir, "fake-zmx.mjs");
  const retryEvents: Array<{ delayMs?: number; event: string; failureCount?: number; hasZmxName: boolean; level: string }> = [];
  const logger: GxserverLogger = {
    async log(entry): Promise<void> {
      if (
        entry.event !== "zmxTitleObserver.retryScheduled" &&
        entry.event !== "zmxTitleObserver.retrySuppressed" &&
        entry.event !== "zmxTitleObserver.unavailable"
      ) {
        return;
      }
      retryEvents.push({
        delayMs: typeof entry.details?.delayMs === "number" ? entry.details.delayMs : undefined,
        event: entry.event,
        failureCount: typeof entry.details?.failureCount === "number" ? entry.details.failureCount : undefined,
        hasZmxName: Object.prototype.hasOwnProperty.call(entry.details ?? {}, "zmxName"),
        level: entry.level,
      });
    },
  };

  try {
    await writeFile(
      fakeZmxPath,
      `#!/usr/bin/env node
if (process.argv[2] !== "watch-title") {
  process.exit(2);
}
process.exit(1);
`,
      "utf8",
    );
    await chmod(fakeZmxPath, 0o755);

    const observer = new GxserverZmxTitleObserver({
      authToken: "test-token" as GxserverAuthToken,
      logger,
      maxConsecutiveFailures: 3,
      metadata: metadataFixture(),
      readyDelayMs: 100,
      requireZmx: async () => ({
        executablePath: fakeZmxPath,
        source: "devSubmodule",
        tool: "zmx",
      }),
      retryDelaysMs: [10, 20, 30],
    });

    try {
      await observer.observeSession(sessionFixture(), "wake-session");
      await waitFor(() => retryEvents.some((event) => event.event === "zmxTitleObserver.unavailable"));

      const scheduled = retryEvents.filter((event) => event.event === "zmxTitleObserver.retryScheduled");
      assert.deepEqual(scheduled.map((event) => event.failureCount), [1, 2, 3]);
      assert.deepEqual(scheduled.map((event) => event.delayMs), [10, 20, 30]);
      assert.deepEqual(scheduled.map((event) => event.level), ["debug", "debug", "debug"]);
      const suppressed = retryEvents.filter((event) => event.event === "zmxTitleObserver.retrySuppressed");
      assert.deepEqual(suppressed.map((event) => event.failureCount), [4]);
      assert.deepEqual(suppressed.map((event) => event.level), ["debug"]);
      const unavailable = retryEvents.filter((event) => event.event === "zmxTitleObserver.unavailable");
      assert.deepEqual(unavailable.map((event) => event.failureCount), [4]);
      assert.deepEqual(unavailable.map((event) => event.level), ["warn"]);
      assert.equal(retryEvents.some((event) => event.hasZmxName), false);
    } finally {
      observer.close();
    }
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("zmx title observer stops retrying when a session is no longer observable", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "gxserver-zmx-title-observer-"));
  const fakeZmxPath = path.join(tempDir, "fake-zmx.mjs");
  let retryCount = 0;
  const logger: GxserverLogger = {
    async log(entry): Promise<void> {
      if (entry.event === "zmxTitleObserver.retryScheduled") {
        retryCount += 1;
      }
    },
  };

  try {
    await writeFile(
      fakeZmxPath,
      `#!/usr/bin/env node
if (process.argv[2] !== "watch-title") {
  process.exit(2);
}
process.exit(1);
`,
      "utf8",
    );
    await chmod(fakeZmxPath, 0o755);

    const observer = new GxserverZmxTitleObserver({
      authToken: "test-token" as GxserverAuthToken,
      logger,
      metadata: metadataFixture(),
      readyDelayMs: 100,
      requireZmx: async () => ({
        executablePath: fakeZmxPath,
        source: "devSubmodule",
        tool: "zmx",
      }),
      retryDelaysMs: [100],
    });

    try {
      await observer.observeSession(sessionFixture(), "wake-session");
      await waitFor(() => retryCount === 1);
      await observer.syncSession(
        sessionFixture({
          lifecycleState: "stopped",
          providerState: { lifecycleState: "missing", zmxName: "S90-P3lv0-G5tpf" },
        }),
        "kill-session",
      );
      await delay(150);
      assert.equal(retryCount, 1);
    } finally {
      observer.close();
    }
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("zmx title observer ignores persistence-disabled sessions", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "gxserver-zmx-title-observer-"));
  const counterPath = path.join(tempDir, "watch-count.txt");
  const fakeZmxPath = path.join(tempDir, "fake-zmx.mjs");
  const logger: GxserverLogger = {
    async log(): Promise<void> {},
  };

  try {
    await writeFile(
      fakeZmxPath,
      `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const counterPath = ${JSON.stringify(counterPath)};
let count = 0;
try {
  count = Number(readFileSync(counterPath, "utf8")) || 0;
} catch {}
writeFileSync(counterPath, String(count + 1));
setInterval(() => {}, 1000);
`,
      "utf8",
    );
    await chmod(fakeZmxPath, 0o755);

    const observer = new GxserverZmxTitleObserver({
      authToken: "test-token" as GxserverAuthToken,
      logger,
      metadata: metadataFixture(),
      requireZmx: async () => ({
        executablePath: fakeZmxPath,
        source: "devSubmodule",
        tool: "zmx",
      }),
    });

    try {
      await observer.observeSession(
        sessionFixture({
          providerState: { lifecycleState: "unknown", provider: "off", zmxName: "S90-P3lv0-G5tpf" },
          runtimeSettings: { sessionPersistenceProvider: "off" },
        }),
        "update-session",
      );
      await delay(50);
      assert.equal(await readFile(counterPath, "utf8").catch(() => "0"), "0");
    } finally {
      observer.close();
    }
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("condition was not met before timeout");
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function metadataFixture(): GxserverRuntimeMetadata {
  return {
    buildIdentity: "test",
    pid: process.pid,
    port: 58744,
    protocolVersion: 1,
    serverId: "S90",
    startedAt: "2026-06-07T00:30:00.000Z",
    version: "0.0.0-test",
  };
}

function sessionFixture(overrides: Partial<GxserverSessionDomainState> = {}): GxserverSessionDomainState {
  const session: GxserverSessionDomainState = {
    attentionRules: {},
    completionRules: {},
    createdAt: "2026-06-07T00:29:00.000Z",
    globalRef: "S90:P3lv0:G5tpf",
    hiddenMetadata: {},
    isFavorite: false,
    isPinned: false,
    kind: "agent",
    launchSettings: {},
    lifecycleState: "running",
    notificationRules: {},
    projectId: "P3lv0",
    providerState: { lifecycleState: "exists", zmxName: "S90-P3lv0-G5tpf" },
    runtimeSettings: {},
    sessionId: "G5tpf",
    surface: "workspace",
    title: "Terminal Session",
    updatedAt: "2026-06-07T00:29:00.000Z",
    zmxName: "S90-P3lv0-G5tpf",
  };
  return {
    ...session,
    ...overrides,
    providerState: overrides.providerState ?? session.providerState,
    runtimeSettings: overrides.runtimeSettings ?? session.runtimeSettings,
  };
}
