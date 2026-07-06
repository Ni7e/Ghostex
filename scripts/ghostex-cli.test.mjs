import { describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  agentOrchestrationUsage,
  applyZehnAcceptAllArgs,
  browserUsage,
  buildSessionPickerModel,
  buildSessionPickerRows,
  buildSessionAttachCommand,
  computerUseUsage,
  createCliSshForwardPlan,
  fetchGxserverSessionList,
  findWaitForTextMatch,
  formatCompactSessionLine,
  generateTitleUsage,
  groupSessionsPreservingSidebarOrder,
  isFailedCliResult,
  manageBeadsUsage,
  moveCodexSessionUsage,
  moveSessionPickerSelection,
  parseArgs,
  parseCreateSession,
  parseEditPaths,
  parseOpenPaths,
  parseQuickTerminal,
  parseRename,
  parseVsCodePathPosition,
  parseWaitForText,
  readAndroidReadinessSettings,
  requestGxserverRpc,
  resolveBundledBeadsLaunchFromRoot,
  resolveCliInteractiveShellLaunch,
  resolveGxserverCliLaunchFromRoot,
  resolveGxserverCliLaunchForPath,
  resolveGxserverServerTarget,
  resolveGhostexHistoryLaunchFromRoot,
  resolveGhostexTuiLaunchFromRoot,
  resolveGhostexTui2LaunchFromRoot,
  resolveListedSessions,
  resolveZehnLaunchFromRoot,
  sendGxserverCliAction,
  serverUsage,
  toMobileSessionList,
  usage,
} from "./ghostex-cli.mjs";

const execFileAsync = promisify(execFile);

function strictAndroidReleaseEnv(overrides = {}) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GHOSTEX_ANDROID_REQUIRE_RELEASE_SIGNING: "1",
    GHOSTEX_ANDROID_SIGNING_STORE_FILE: "/tmp/ghostex-android-missing-release.jks",
    GHOSTEX_ANDROID_SIGNING_STORE_PASSWORD: "store-password",
    GHOSTEX_ANDROID_SIGNING_KEY_ALIAS: "ghostex-release",
    GHOSTEX_ANDROID_SIGNING_KEY_PASSWORD: "key-password",
    GHOSTEX_ANDROID_HOST: "mac.tailnet.test",
    GHOSTEX_ANDROID_USER: "madda",
    GHOSTEX_ANDROID_CONFIRM_CLEAR_DATA: "1",
    ...overrides,
  };
}

async function createFakeGhostexEditorApp(rootDir, markerFile) {
  const executable = path.join(rootDir, "GhostexEditor.app", "Contents", "MacOS", "GhostexEditor");
  await mkdir(path.dirname(executable), { recursive: true });
  await writeFile(
    executable,
    `#!/usr/bin/env node
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

if (!process.argv.includes("--daemon")) {
  process.exit(2);
}

const markerFile = ${JSON.stringify(markerFile)};
const socketPath = process.env.GHOSTEX_EDITOR_SOCKET;
if (!socketPath) {
  process.exit(3);
}
if (process.platform !== "win32") {
  try {
    fs.rmSync(socketPath, { force: true });
  } catch {}
}

const sessions = new Map();
const server = net.createServer((socket) => {
  let buffer = "";
  const send = (message) => socket.write(JSON.stringify(message) + "\\n");
  const finish = (requestId, status) => {
    const session = sessions.get(requestId);
    if (!session) {
      return;
    }
    fs.writeFileSync(session.statusFile, status + "\\n");
    send({ requestId, status, type: "closed", v: 1 });
    sessions.delete(requestId);
    if (sessions.size === 0) {
      setTimeout(() => server.close(() => process.exit(0)), 10);
    }
  };
  const handle = (message) => {
    if (message.type === "ping") {
      send({ openCount: sessions.size, type: "pong", v: 1, warm: true });
      return;
    }
    if (message.type === "warm") {
      send({ type: "warmed", v: 1 });
      return;
    }
    if (message.type === "status") {
      send({
        sessions: Array.from(sessions.values()).map((session) => ({
          requestId: session.requestId,
          title: session.title,
        })),
        type: "status",
        v: 1,
        warm: true,
      });
      return;
    }
    if (message.type === "shutdown") {
      send({ type: "ok", v: 1 });
      server.close(() => process.exit(0));
      return;
    }
    if (message.type === "close") {
      finish(message.requestId, message.action === "cancel" ? "cancelled" : "saved");
      send({ type: "ok", v: 1 });
      return;
    }
    if (message.type === "open") {
      const statusFile = message.statusFile;
      fs.mkdirSync(path.dirname(statusFile), { recursive: true });
      fs.writeFileSync(
        markerFile,
        [
          message.filePath,
          "--language",
          message.language || "markdown",
          "--title",
          message.title || "Prompt Editor",
          "--status-file",
          statusFile,
        ].join("\\n") + "\\n",
      );
      fs.writeFileSync(statusFile, "started\\n");
      sessions.set(message.requestId, {
        requestId: message.requestId,
        statusFile,
        title: message.title || "Prompt Editor",
      });
      send({ requestId: message.requestId, type: "opened", v: 1 });
      setTimeout(() => finish(message.requestId, "saved"), 10);
      return;
    }
    send({ message: "unknown request type", type: "error", v: 1 });
  };
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    while (true) {
      const newlineIndex = buffer.indexOf("\\n");
      if (newlineIndex < 0) break;
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      handle(JSON.parse(line));
    }
  });
});
server.listen(socketPath);
`,
  );
  await chmod(executable, 0o755);
  return {
    appPath: path.dirname(path.dirname(path.dirname(executable))),
    executable,
  };
}

function createFakeGhostexEditorSocketPath() {
  return path.join(
    tmpdir(),
    `gx-ed-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.sock`,
  );
}

async function withGxserverFixture(callback, options = {}) {
  const body = options.body ?? {
    ok: true,
    product: "gxserver",
    protocolVersion: 1,
    requestId: "fixture-request",
    result: { sessions: [] },
  };
  const server = http.createServer(async (request, response) => {
    expect(request.headers.authorization).toBe("Bearer test-token");
    expect(request.headers["x-gxserver-protocol-version"]).toBe("1");
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    const requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    expect(requestBody.protocolVersion).toBe(1);
    response.writeHead(options.status ?? 200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await callback({ baseUrl: `http://127.0.0.1:${address.port}` });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function createGxserverRpcAndHealthFixture({ serverId }) {
  return http.createServer(async (request, response) => {
    expect(request.headers.authorization).toBe("Bearer test-token");
    expect(request.headers["x-gxserver-protocol-version"]).toBe("1");
    if (request.method === "GET" && request.url?.startsWith("/api/health/server")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          product: "gxserver",
          protocolVersion: 1,
          serverId,
          state: "running",
        }),
      );
      return;
    }
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    const requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    expect(requestBody.protocolVersion).toBe(1);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        product: "gxserver",
        protocolVersion: 1,
        requestId: "fixture-request",
        result: { sessions: [] },
      }),
    );
  });
}

async function reserveTestPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
          return;
        }
        reject(new Error("Expected test server to reserve a TCP port."));
      });
    });
  });
}

async function isTestPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ghostex CLI Android remote-session contract", () => {
  test("runs main when invoked through a symlinked cli script", async () => {
    /**
     * CDXC:CliEntrypoint 2026-05-18-01:17:
     * Android SSH uses the installed `ghostex` wrapper on the Mac. In local
     * development that wrapper may execute a symlinked `ghostex-cli.mjs`; keep
     * the direct-entrypoint guard symlink-aware so JSON commands do not exit
     * zero with empty stdout.
     */
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-cli-symlink-"));
    try {
      const linkPath = path.join(tempDir, "ghostex-cli.mjs");
      await symlink(path.resolve("scripts/ghostex-cli.mjs"), linkPath);
      const helpResult = await execFileAsync(process.execPath, [linkPath, "help"]);
      const flagHelpResult = await execFileAsync(process.execPath, [linkPath, "--help"]);

      expect(helpResult.stdout).toContain("Usage:");
      expect(helpResult.stdout).toContain("sessions | s | ls [--ungrouped|-u] [--json] [--mobile-summary]");
      expect(flagHelpResult.stdout).toBe(helpResult.stdout);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("parses Android action flag form", () => {
    const { flags, rest } = parseArgs(["--session-id", "session-1", "--json"]);

    expect(rest).toEqual([]);
    expect(flags.sessionId).toBe("session-1");
    expect(flags.json).toBe(true);
  });

  test("parses Android rename-session flag form", () => {
    const { flags, rest } = parseArgs([
      "--session-id",
      "session-1",
      "--title=Ship Android's polish",
      "--json",
    ]);

    expect(rest).toEqual([]);
    expect(parseRename(rest, flags)).toMatchObject({
      sessionId: "session-1",
      title: "Ship Android's polish",
    });
    expect(flags.json).toBe(true);
  });

  test("parses Android create-session project and group flags", () => {
    /**
     * CDXC:AndroidRemoteSessions 2026-05-18-02:31:
     * Android's sidebar plus button must create the terminal in the tapped Mac
     * project/group through the Ghostex CLI, not whichever project happens to
     * be active on the Mac.
     */
    const { flags, rest } = parseArgs([
      "--project-id",
      "project-1",
      "--group-id",
      "group-main",
      "--json",
    ]);

    expect(parseCreateSession(rest, flags)).toMatchObject({
      groupId: "group-main",
      projectId: "project-1",
    });
  });

  test("parses create-session first input for gxserver runtime metadata", () => {
    /**
     * CDXC:GxserverSessionTitle 2026-06-23-08:40:
     * Mobile create-session callers may provide first-message input; the CLI parser must preserve it so gxserver-rs can own first-prompt auto-name claiming and generation.
     */
    const { flags, rest } = parseArgs([
      "Terminal",
      "--input",
      "Summarize this project",
      "--project-id",
      "project-1",
      "--json",
    ]);

    expect(parseCreateSession(rest, flags)).toMatchObject({
      input: "Summarize this project",
      projectId: "project-1",
      title: "Terminal",
    });
  });

  test("parses create-session --start so orchestrators get a live terminal", () => {
    /**
     * CDXC:GxserverCliSessionStart 2026-07-04-17:05:
     * gxserver sessions materialize lazily; --start asks the CLI to call
     * startSessionProvider so send-text/read-text work immediately.
     */
    const { flags, rest } = parseArgs(["P1: Worker", "--start", "--project-id", "project-1"]);

    expect(parseCreateSession(rest, flags)).toMatchObject({
      projectId: "project-1",
      start: true,
      title: "P1: Worker",
    });
    expect(parseCreateSession(["Plain"], {}).start).toBeUndefined();
  });

  test("parses wait-for-text selector, pattern, and clamped polling flags", () => {
    /**
     * CDXC:GxserverCliWaitForText 2026-07-04-17:08:
     * Orchestrator sentinel polling needs line-anchored regex matching with a
     * bounded timeout; the parser owns flag defaults and clamping.
     */
    const { flags, rest } = parseArgs([
      "session-1",
      "^\\s*PHASE 1 (COMPLETE|BLOCKED)",
      "--timeout-seconds",
      "999999",
      "--interval-seconds",
      "0",
      "--lines",
      "5",
    ]);

    expect(parseWaitForText(rest, flags)).toEqual({
      intervalSeconds: 2,
      lines: 10,
      pattern: "^\\s*PHASE 1 (COMPLETE|BLOCKED)",
      selector: "session-1",
      timeoutSeconds: 21600,
    });
    expect(parseWaitForText(["session-1", "PHASE"], {})).toMatchObject({
      intervalSeconds: 20,
      lines: 200,
      timeoutSeconds: 1800,
    });
  });

  test("wait-for-text matches whole scrollback lines so sentinels inside streamed reasoning are ignored", () => {
    const scrollback = [
      "• I am considering whether to print PHASE 1 COMPLETE once checks pass.",
      "  running cargo check...",
      "• PHASE 1 COMPLETE",
      "  summary line",
    ].join("\n");

    const anchored = /^\s*(• )?PHASE 1 (COMPLETE|BLOCKED)$/;
    expect(findWaitForTextMatch(scrollback, anchored)).toBe("• PHASE 1 COMPLETE");
    expect(
      findWaitForTextMatch("thinking about PHASE 1 COMPLETE mid-sentence", anchored),
    ).toBeUndefined();
    expect(findWaitForTextMatch("", anchored)).toBeUndefined();
  });

  test("keeps positional rename-session form for human CLI usage", () => {
    const { flags, rest } = parseArgs(["session-1", "Ship", "Android"]);

    expect(parseRename(rest, flags)).toMatchObject({
      sessionId: "session-1",
      title: "Ship Android",
    });
  });

  test("documents bare ghostex and gx commands as the terminal TUI", () => {
    const help = usage();

    expect(help).toContain("Running ghostex or gx with no subcommand opens the Ghostex terminal TUI");
    expect(help).toContain("browser --help");
    expect(help).not.toContain("browser-devtools-mcp [--port n]");
    expect(help).toContain("top switch button for project/session switching");
    expect(help).toContain("Direct attach stays available through attach/a/resume/r without opening the TUI");
    expect(help).toContain("find | f [zehn args...]");
    expect(help).toContain("gx find and gx f launch bundled zehn");
    expect(help).toContain("history | h [ghostex-history args...]");
    expect(help).toContain("gx history and gx h open the transcript viewer");
    expect(help).not.toContain("search | find");
    expect(help).toMatch(/^\s+ghostex$/m);
    expect(help).toMatch(/^\s+gx$/m);
  });

  test("documents gx server commands in top-level and server help", () => {
    /**
     * CDXC:GxserverCli 2026-06-02-18:36:
     * The user-facing `gx`/`ghostex` help must expose gxserver lifecycle
     * commands through the `server` namespace so normal users can manage the
     * background process without switching to the internal daemon command name.
     */
    const help = usage();
    const serverHelp = serverUsage();

    expect(help).toContain("Server:");
    expect(help).toContain("server start [--json]");
    expect(help).toContain("server stop [--json]");
    expect(help).toContain("server stop-all [--json]");
    expect(help).toContain("server status [--json]");
    expect(help).toContain("server --help");
    expect(serverHelp).toContain("Ghostex Server - manage the gxserver background process");
    expect(serverHelp).toContain("gx server <command> [args...] [--flags]");
    expect(serverHelp).toContain("server version");
    expect(serverHelp).toContain("server --version");
    expect(serverHelp).toContain("gx server stop stops only the control plane");
    expect(serverHelp).toContain("gx server stop-all is destructive");
  });

  test("forwards gx server subcommands to the gxserver CLI", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-gxserver-cli-"));
    const markerPath = path.join(tempDir, "argv.txt");
    const gxserverCliPath = path.join(tempDir, "gxserver");
    try {
      await writeFile(
        gxserverCliPath,
        `#!/bin/sh
printf '%s\\n' "$@" > ${JSON.stringify(markerPath)}
printf 'forwarded:%s\\n' "$1"
`,
      );
      await chmod(gxserverCliPath, 0o755);

      const result = await execFileAsync(process.execPath, [
        path.resolve("scripts/ghostex-cli.mjs"),
        "server",
        "status",
        "--json",
      ], {
        env: {
          ...process.env,
          GHOSTEX_GXSERVER_CLI: gxserverCliPath,
        },
      });

      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("forwarded:status");
      expect((await readFile(markerPath, "utf8")).trim().split("\n")).toEqual(["status", "--json"]);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("forwards gx server subcommands to an explicit gxserver binary path", async () => {
    /*
     * CDXC:GxserverRustPort 2026-06-14-21:09:
     * Explicit CLI daemon selection uses GHOSTEX_GXSERVER_BIN as a hard selection. A relative gxserver-rs/target/debug/gxserver path must resolve from the caller's development root and must not fall back to a packaged daemon.
     */
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-gxserver-rust-bin-"));
    const markerPath = path.join(tempDir, "argv.txt");
    const gxserverBinPath = path.join(tempDir, "gxserver-rs", "target", "debug", "gxserver");
    try {
      await mkdir(path.dirname(gxserverBinPath), { recursive: true });
      await writeFile(
        gxserverBinPath,
        `#!/bin/sh
printf '%s\\n' "$@" > ${JSON.stringify(markerPath)}
printf 'rust-forwarded:%s\\n' "$1"
`,
      );
      await chmod(gxserverBinPath, 0o755);

      const result = await execFileAsync(process.execPath, [
        path.resolve("scripts/ghostex-cli.mjs"),
        "server",
        "status",
        "--json",
      ], {
        cwd: tempDir,
        env: {
          ...process.env,
          GHOSTEX_GXSERVER_BIN: "gxserver-rs/target/debug/gxserver",
        },
      });

      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("rust-forwarded:status");
      expect((await readFile(markerPath, "utf8")).trim().split("\n")).toEqual(["status", "--json"]);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("resolves bundled Rust gxserver from app resources before TypeScript CLI fallback", async () => {
    /*
     * CDXC:GxserverPackaging 2026-06-21-13:45:
     * The app cutover makes packaged `gx server ...` default to Web/gxserver/bin/gxserver. Keep TypeScript CLI discovery after the Rust binary so explicit TypeScript packages remain testable without changing the normal daemon.
     */
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-gxserver-rust-default-"));
    try {
      const appRoot = path.join(tempDir, "typescript-app");
      const rustBinPath = path.join(appRoot, "gxserver", "bin", "gxserver");
      const referenceCliPath = path.join(appRoot, "gxserver", "dist", "src", "cli.js");
      await mkdir(path.dirname(rustBinPath), { recursive: true });
      await mkdir(path.dirname(referenceCliPath), { recursive: true });
      await writeFile(rustBinPath, "#!/bin/sh\n");
      await writeFile(referenceCliPath, "console.log('reference');\n");
      await chmod(rustBinPath, 0o755);

      expect(resolveGxserverCliLaunchFromRoot(appRoot)).toMatchObject({
        args: [],
        command: rustBinPath,
      });

      const referenceOnlyRoot = path.join(tempDir, "reference-only");
      const referenceOnlyCliPath = path.join(referenceOnlyRoot, "gxserver", "dist", "src", "cli.js");
      await mkdir(path.dirname(referenceOnlyCliPath), { recursive: true });
      await writeFile(referenceOnlyCliPath, "console.log('reference');\n");
      expect(resolveGxserverCliLaunchFromRoot(referenceOnlyRoot)).toMatchObject({
        args: [referenceOnlyCliPath],
        command: process.execPath,
      });

      const binaryOnlyRoot = path.join(tempDir, "binary-only");
      const binaryOnlyPath = path.join(binaryOnlyRoot, "gxserver", "bin", "gxserver");
      await mkdir(path.dirname(binaryOnlyPath), { recursive: true });
      await writeFile(binaryOnlyPath, "#!/bin/sh\n");
      await chmod(binaryOnlyPath, 0o755);
      expect(resolveGxserverCliLaunchFromRoot(binaryOnlyRoot)).toMatchObject({
        args: [],
        command: binaryOnlyPath,
      });

      /*
       * CDXC:RemoteMachines 2026-06-23-10:07:
       * Ubuntu remote installs expose the CLI under package/CLI and gxserver
       * under package/bin. Keep that standalone package shape resolvable so
       * `ghostex server start` works after the app uploads the package.
       */
      const standalonePackageRoot = path.join(tempDir, "standalone-package");
      const standalonePackageBin = path.join(standalonePackageRoot, "bin", "gxserver");
      await mkdir(path.dirname(standalonePackageBin), { recursive: true });
      await writeFile(standalonePackageBin, "#!/bin/sh\n");
      await chmod(standalonePackageBin, 0o755);
      expect(resolveGxserverCliLaunchFromRoot(standalonePackageRoot)).toMatchObject({
        args: [],
        command: standalonePackageBin,
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("does not fall back to TypeScript when explicit gxserver binary is invalid", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-gxserver-missing-bin-"));
    try {
      await expect(execFileAsync(process.execPath, [
        path.resolve("scripts/ghostex-cli.mjs"),
        "server",
        "status",
        "--json",
      ], {
        cwd: tempDir,
        env: {
          ...process.env,
          GHOSTEX_GXSERVER_BIN: "gxserver-rs/target/debug/gxserver",
        },
      })).rejects.toMatchObject({
        stdout: expect.stringContaining("gxserver CLI path does not exist"),
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("rejects a non-executable explicit gxserver binary before launch", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-gxserver-nonexec-bin-"));
    const gxserverBinPath = path.join(tempDir, "gxserver-rs", "target", "debug", "gxserver");
    try {
      await mkdir(path.dirname(gxserverBinPath), { recursive: true });
      await writeFile(gxserverBinPath, "#!/bin/sh\n");

      expect(() => resolveGxserverCliLaunchForPath(gxserverBinPath, { explicit: true })).toThrow(
        /gxserver binary is not executable/u,
      );
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("resolves bundled zehn from the pinned submodule output", async () => {
    /**
     * CDXC:AgentHistorySearch 2026-05-29-12:27:
     * Ghostex prompt-history search should launch the pinned zehn checkout or
     * bundled Web/bin copy, not a random PATH install. `gx s` stays reserved for
     * sessions, and `gx search` is intentionally not a zehn alias.
     */
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-zehn-"));
    try {
      const zehnBin = path.join(tempDir, "zehn", "zig-out", "bin", "zehn");
      await mkdir(path.dirname(zehnBin), { recursive: true });
      await writeFile(zehnBin, "#!/bin/sh\n");

      expect(resolveZehnLaunchFromRoot(tempDir)).toMatchObject({
        args: [],
        command: zehnBin,
      });
      expect(usage()).not.toContain("search |");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("documents and resolves the Ghostex transcript history TUI", async () => {
    /*
     * CDXC:AgentTranscriptHistory 2026-06-25-20:56:
     * `gx history` and `gx h` should launch the new transcript viewer from the
     * Ghostex CLI, with packaged binaries preferred and source Cargo fallback
     * available for local checkouts.
     */
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-history-"));
    try {
      const historyBin = path.join(tempDir, "bin", "ghostex-history");
      await mkdir(path.dirname(historyBin), { recursive: true });
      await writeFile(historyBin, "#!/bin/sh\n");

      expect(usage()).toContain("history | h [ghostex-history args...]");
      expect(resolveGhostexHistoryLaunchFromRoot(tempDir)).toMatchObject({
        args: [],
        command: historyBin,
      });

      const sourceRoot = path.join(tempDir, "source");
      const manifestPath = path.join(sourceRoot, "ghostex-history", "Cargo.toml");
      const staleDebugBin = path.join(sourceRoot, "ghostex-history", "target", "debug", "ghostex-history");
      await mkdir(path.dirname(manifestPath), { recursive: true });
      await writeFile(manifestPath, "[package]\nname = \"ghostex-history\"\n");
      await mkdir(path.dirname(staleDebugBin), { recursive: true });
      await writeFile(staleDebugBin, "#!/bin/sh\n");
      expect(resolveGhostexHistoryLaunchFromRoot(sourceRoot)).toMatchObject({
        args: ["run", "--quiet", "--manifest-path", manifestPath, "--"],
        command: "cargo",
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("forwards gx h to the Ghostex transcript history command", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-history-forward-"));
    const markerPath = path.join(tempDir, "argv.txt");
    const historyBin = path.join(tempDir, "ghostex-history");
    try {
      await writeFile(
        historyBin,
        `#!/bin/sh
printf '%s\\n' "$@" > ${JSON.stringify(markerPath)}
printf 'history:%s\\n' "$1"
`,
      );
      await chmod(historyBin, 0o755);

      const result = await execFileAsync(process.execPath, [
        path.resolve("scripts/ghostex-cli.mjs"),
        "h",
        "--accept-all",
        "--list",
        "--agent",
        "codex",
      ], {
        env: {
          ...process.env,
          GHOSTEX_HISTORY_BIN: historyBin,
        },
      });

      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("history:--accept-all");
      expect((await readFile(markerPath, "utf8")).trim().split("\n")).toEqual([
        "--accept-all",
        "--list",
        "--agent",
        "codex",
      ]);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("resolves bundled Ghostex TUI from the app resource bin directory", async () => {
    /**
     * CDXC:GhostexTui 2026-06-07-12:13:
     * Installed `gx` should launch the packaged Ghostex TUI from Web/bin even
     * when the user runs the CLI outside a Ghostex source checkout.
     *
     * CDXC:GhostexTui 2026-07-01-02:10:
     * The packaged `ghostex-tui` binary is now the promoted TUI2 app, so the
     * resolver must pass the Ghostex inventory mode flags even for installed
     * app resources.
     */
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-tui-"));
    try {
      const tuiBin = path.join(tempDir, "bin", "ghostex-tui");
      await mkdir(path.dirname(tuiBin), { recursive: true });
      await writeFile(tuiBin, "#!/bin/sh\n");

      expect(resolveGhostexTuiLaunchFromRoot(tempDir)).toMatchObject({
        args: ["--ghostex", "--no-session"],
        command: tuiBin,
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("keeps gx 2 as a hidden alias for the promoted Ghostex TUI", async () => {
    /**
     * CDXC:GhostexTui 2026-07-01-02:10:
     * TUI2 is no longer an experimental public command. Bare `gx` owns the new
     * app, while `gx 2` remains a compatibility alias that resolves the same
     * canonical `ghostex-tui` package path.
     */
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-tui-"));
    try {
      const tuiBin = path.join(tempDir, "bin", "ghostex-tui");
      await mkdir(path.dirname(tuiBin), { recursive: true });
      await writeFile(tuiBin, "#!/bin/sh\n");

      expect(usage()).not.toContain("2 [--tui2-bin path]");
      expect(resolveGhostexTui2LaunchFromRoot(tempDir)).toMatchObject({
        args: ["--ghostex", "--no-session"],
        command: tuiBin,
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("gx find passes Accept All to zehn from gxserver settings unless user overrides it", () => {
    /**
     * CDXC:AgentHistorySearch 2026-06-04-23:31:
     * Ghostex-owned `gx find` should make Enter resume match the gxserver
     * global Accept All policy while preserving explicit zehn CLI flags.
     */
    expect(applyZehnAcceptAllArgs(["--agent", "codex"], true)).toEqual([
      "--accept-all",
      "--agent",
      "codex",
    ]);
    expect(applyZehnAcceptAllArgs(["--agent", "codex"], false)).toEqual(["--agent", "codex"]);
    expect(applyZehnAcceptAllArgs(["--no-accept-all", "--agent", "codex"], true)).toEqual([
      "--no-accept-all",
      "--agent",
      "codex",
    ]);
    expect(applyZehnAcceptAllArgs(["--accept-all", "--agent", "codex"], true)).toEqual([
      "--accept-all",
      "--agent",
      "codex",
    ]);
  });

  test("parses OS integration path open commands", () => {
    /**
     * CDXC:OSIntegration 2026-05-27-18:06:
     * Open/edit/terminal CLI commands are the public macOS integration surface
     * behind Finder, Open With, and EDITOR-style workflows.
     */
    expect(parseOpenPaths(["./docs/os-integration-prd.md"], {})).toMatchObject({
      mode: "open",
      targets: [{ line: undefined, path: path.resolve("./docs/os-integration-prd.md") }],
    });
    expect(parseEditPaths([], { wait: "src/app.ts:12:3" })).toMatchObject({
      mode: "edit",
      targets: [{ column: 3, line: 12, path: path.resolve("src/app.ts") }],
      wait: true,
    });
    expect(parseEditPaths([], { goto: "src/app.ts:12:3", wait: true })).toMatchObject({
      targets: [{ column: 3, line: 12, path: path.resolve("src/app.ts") }],
      wait: true,
    });
    expect(parseQuickTerminal(["echo", "hi"], { cwd: "/tmp", title: "Scratch" })).toEqual({
      command: "echo hi",
      cwd: "/tmp",
      title: "Scratch",
    });
    expect(parseVsCodePathPosition("file.ts:12:3")).toEqual({
      column: 3,
      line: 12,
      path: "file.ts",
    });
  });

  test("floating Monaco prompt editor launches the standalone GhostexEditor app", async () => {
    /**
     * CDXC:StandalonePromptEditor 2026-07-05:
     * Ctrl+G Monaco prompt editing is now an EDITOR-facing standalone app
     * launch. Keep the blocking status-file handshake, but do not route Monaco
     * through the native app bridge.
     */
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-fme-test-"));
    const homeDir = path.join(tempDir, "home");
    const editFile = path.join(tempDir, "prompt.md");
    const markerFile = path.join(tempDir, "ghostex-editor-args.txt");
    await mkdir(path.join(homeDir, "cli"), { recursive: true });
    await mkdir(path.join(homeDir, "state"), { recursive: true });
    await writeFile(path.join(homeDir, "cli", "bridge-token"), "test-token\n");
    await writeFile(path.join(homeDir, "state", "native-sidebar-settings.json"), JSON.stringify({
      debuggingMode: true,
    }));
    await writeFile(editFile, "prompt text\n");
    const { appPath } = await createFakeGhostexEditorApp(tempDir, markerFile);
    const editorSocket = createFakeGhostexEditorSocketPath();
    try {
      const result = await execFileAsync(process.execPath, [
        path.resolve("scripts/ghostex-cli.mjs"),
        "floating-monaco-editor",
        editFile,
      ], {
        env: {
          ...process.env,
          GHOSTEX_EDITOR_APP: appPath,
          GHOSTEX_EDITOR_SOCKET: editorSocket,
          GHOSTEX_HOME: homeDir,
        },
      });

      expect(result.stderr).toBe("");
      const editorArgs = (await readFile(markerFile, "utf8")).trim().split(/\r?\n/u);
      expect(editorArgs.slice(0, 5)).toEqual([
        editFile,
        "--language",
        "markdown",
        "--title",
        "Prompt Editor",
      ]);
      expect(editorArgs).toContain("--status-file");
      const promptDebugLog = await readFile(
        path.join(homeDir, "logs", "native-prompt-editor-debug.log"),
        "utf8",
      );
      expect(promptDebugLog).toContain("cli.monaco.requestPrepared");
      expect(promptDebugLog).toContain("cli.monaco.editorResolved");
      expect(promptDebugLog).toContain("cli.monaco.statusResolved");
      expect(promptDebugLog).not.toContain(editFile);
      expect(promptDebugLog).not.toContain("prompt text");
      expect(promptDebugLog).not.toContain("test-token");
      expect(promptDebugLog).not.toContain("statusFile");
    } finally {
      await rm(editorSocket, { force: true });
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("floating Monaco prompt editor uses the machine editor when GhostexEditor is unavailable", async () => {
    /**
     * CDXC:StandalonePromptEditor 2026-07-05:
     * Direct floating-monaco-editor invocations still need an environment
     * fallback when the standalone app is unavailable. Use the same
     * machine/default editor selection as prompt-editor, never a hard-coded vi.
     */
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-fme-machine-test-"));
    const homeDir = path.join(tempDir, "home");
    const binDir = path.join(tempDir, "bin");
    const editFile = path.join(tempDir, "prompt.md");
    const markerFile = path.join(tempDir, "machine-editor-args.txt");
    const editorPath = path.join(binDir, "machine-editor");
    const viMarkerFile = path.join(tempDir, "vi-args.txt");
    const viPath = path.join(binDir, "vi");
    await mkdir(path.join(homeDir, "cli"), { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(path.join(homeDir, "cli", "bridge-token"), "test-token\n");
    await writeFile(editFile, "prompt text\n");
    await writeFile(
      editorPath,
      `#!/bin/sh
printf '%s\\n' "$@" > ${JSON.stringify(markerFile)}
`,
    );
    await writeFile(
      viPath,
      `#!/bin/sh
printf '%s\\n' "$@" > ${JSON.stringify(viMarkerFile)}
exit 42
`,
    );
    await chmod(editorPath, 0o755);
    await chmod(viPath, 0o755);
    try {
      const result = await execFileAsync(process.execPath, [
        path.resolve("scripts/ghostex-cli.mjs"),
        "floating-monaco-editor",
        editFile,
      ], {
        env: {
          ...process.env,
          GHOSTEX_EDITOR_APP: "/nonexistent/GhostexEditor.app",
          /*
           * Point at a socket nothing listens on so the test never reaches a
           * real GhostexEditor daemon running on the developer's machine.
           */
          GHOSTEX_EDITOR_SOCKET: createFakeGhostexEditorSocketPath(),
          GHOSTEX_HOME: homeDir,
          GHOSTEX_PROMPT_EDITOR_MACHINE_EDITOR: editorPath,
          GHOSTEX_PROMPT_EDITOR_MACHINE_VISUAL: "",
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          VISUAL: "",
        },
      });

      expect(result.stderr).toContain("Ghostex standalone editor unavailable; using the machine/default editor.");
      expect(result.stderr).not.toContain("falling back to vi");
      expect((await readFile(markerFile, "utf8")).trim()).toBe(editFile);
      expect(await readFile(viMarkerFile, "utf8").catch(() => "")).toBe("");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("prompt-editor uses floating Monaco for macOS app Monaco sessions", async () => {
    /**
     * CDXC:PromptEditor 2026-05-31-11:58:
     * The stable EDITOR wrapper must keep macOS app Ctrl+G on the Monaco
     * overlay when Settings selects Monaco. The wrapper chooses this only from
     * native app runtime markers, not from the setting alone.
     *
     * CDXC:PromptEditor 2026-06-09-21:50:
     * Monaco prompt-editor return focus must prefer the current gxserver S:P:G
     * ref over stale inherited GHOSTEX_NATIVE_SESSION_ID and send native the
     * derived P:G id.
     */
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-prompt-editor-macos-"));
    const homeDir = path.join(tempDir, "home");
    const editFile = path.join(tempDir, "prompt.md");
    const markerFile = path.join(tempDir, "ghostex-editor-args.txt");
    await mkdir(path.join(homeDir, "cli"), { recursive: true });
    await writeFile(path.join(homeDir, "cli", "bridge-token"), "test-token\n");
    await writeFile(editFile, "prompt text\n");
    const { appPath } = await createFakeGhostexEditorApp(tempDir, markerFile);
    const editorSocket = createFakeGhostexEditorSocketPath();
    try {
      const result = await execFileAsync(process.execPath, [
        path.resolve("scripts/ghostex-cli.mjs"),
        "prompt-editor",
        editFile,
      ], {
        env: {
          ...process.env,
          GHOSTEX_EDITOR_APP: appPath,
          GHOSTEX_EDITOR_SOCKET: editorSocket,
          GHOSTEX_HOME: homeDir,
          GHOSTEX_GLOBAL_SESSION_REF: "S1a:P3a91:G8v20",
          GHOSTEX_NATIVE_SESSION_ID: "P3a91:G0000",
          GHOSTEX_PROMPT_EDITOR_CLIENT: "macos-app",
          GHOSTEX_PROMPT_EDITOR_BACKEND: "monaco",
          ZMX_SESSION: "",
        },
      });

      expect(result.stderr).toBe("");
      const editorArgs = (await readFile(markerFile, "utf8")).trim().split(/\r?\n/u);
      expect(editorArgs.slice(0, 5)).toEqual([
        editFile,
        "--language",
        "markdown",
        "--title",
        "Prompt Editor",
      ]);
      expect(editorArgs).toContain("--status-file");
    } finally {
      await rm(editorSocket, { force: true });
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("prompt-editor routes Monaco settings to the machine editor without macOS app context", async () => {
    /**
     * CDXC:PromptEditor 2026-05-31-11:58:
     * Android, iOS, CLI, TUI, and plain SSH attaches do not have the native app
     * prompt-editor marker. In those contexts the wrapper must invoke the
     * machine editor even when the inherited prompt editor backend says Monaco.
     *
     * CDXC:PromptEditorBackend 2026-06-30-03:11:
     * gte is no longer the Ctrl+G fallback. Monaco-denied contexts should run
     * the user's editor command from VISUAL/EDITOR or provider-preserved editor
     * environment.
     *
     * CDXC:ReleaseAutomation 2026-07-01-04:30:
     * Release runners can carry Ghostex-specific machine-editor overrides from
     * the parent app session. Clear those overrides in this EDITOR fallback
     * test so it proves the intended precedence instead of launching the
     * operator's configured editor in a non-TTY release shell.
     */
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-prompt-editor-machine-"));
    const binDir = path.join(tempDir, "bin");
    const editFile = path.join(tempDir, "prompt.md");
    const markerFile = path.join(tempDir, "machine-editor-args.txt");
    const editorPath = path.join(binDir, "machine-editor");
    try {
      await mkdir(binDir, { recursive: true });
      await writeFile(editFile, "prompt text\n");
      await writeFile(
        editorPath,
        `#!/bin/sh
printf '%s\\n' "$@" > ${JSON.stringify(markerFile)}
`,
      );
      await chmod(editorPath, 0o755);

      const result = await execFileAsync(process.execPath, [
        path.resolve("scripts/ghostex-cli.mjs"),
        "prompt-editor",
        editFile,
      ], {
        env: {
          ...process.env,
          GHOSTEX_NATIVE_SESSION_ID: "",
          GHOSTEX_PROMPT_EDITOR_CLIENT: "",
          GHOSTEX_PROMPT_EDITOR_BACKEND: "monaco",
          GHOSTEX_PROMPT_EDITOR_MACHINE_EDITOR: "",
          GHOSTEX_PROMPT_EDITOR_MACHINE_VISUAL: "",
          EDITOR: editorPath,
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          VISUAL: "",
          ZMX_SESSION: "",
        },
      });

      expect(result.stderr).toBe("");
      expect((await readFile(markerFile, "utf8")).trim()).toBe(editFile);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("prompt-editor routes macOS Monaco selection to the machine editor when GhostexEditor is unavailable", async () => {
    /**
     * CDXC:StandalonePromptEditor 2026-07-05:
     * A monaco-selecting macOS app environment can only use Monaco when the
     * standalone editor executable resolves. Missing editor app installs must
     * route to the configured machine/default editor instead of vi.
     */
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-prompt-editor-monaco-missing-"));
    const binDir = path.join(tempDir, "bin");
    const editFile = path.join(tempDir, "prompt.md");
    const markerFile = path.join(tempDir, "machine-editor-args.txt");
    const viMarkerFile = path.join(tempDir, "vi-args.txt");
    const editorPath = path.join(binDir, "machine-editor");
    const viPath = path.join(binDir, "vi");
    try {
      await mkdir(binDir, { recursive: true });
      await writeFile(editFile, "prompt text\n");
      await writeFile(
        editorPath,
        `#!/bin/sh
printf '%s\\n' "$@" > ${JSON.stringify(markerFile)}
`,
      );
      await writeFile(
        viPath,
        `#!/bin/sh
printf '%s\\n' "$@" > ${JSON.stringify(viMarkerFile)}
exit 42
`,
      );
      await chmod(editorPath, 0o755);
      await chmod(viPath, 0o755);

      const result = await execFileAsync(process.execPath, [
        path.resolve("scripts/ghostex-cli.mjs"),
        "prompt-editor",
        editFile,
      ], {
        env: {
          ...process.env,
          GHOSTEX_EDITOR_APP: "/nonexistent/GhostexEditor.app",
          GHOSTEX_NATIVE_SESSION_ID: "",
          GHOSTEX_PROMPT_EDITOR_BACKEND: "monaco",
          GHOSTEX_PROMPT_EDITOR_CLIENT: "macos-app",
          GHOSTEX_PROMPT_EDITOR_MACHINE_EDITOR: editorPath,
          GHOSTEX_PROMPT_EDITOR_MACHINE_VISUAL: "",
          EDITOR: "",
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          VISUAL: "",
          ZMX_SESSION: "",
        },
      });

      expect(result.stderr).toContain("Ghostex standalone editor unavailable; using the machine/default editor.");
      expect(result.stderr).not.toContain("falling back to vi");
      expect((await readFile(markerFile, "utf8")).trim()).toBe(editFile);
      expect(await readFile(viMarkerFile, "utf8").catch(() => "")).toBe("");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test.each(["editor", "gte"])(
    "prompt-editor routes stale macOS Monaco zmx sessions to the machine editor when leader advertises %s",
    async (capability) => {
    /**
     * CDXC:PromptEditor 2026-06-06-16:40:
     * Reattached zmx sessions can inherit macOS app prompt-editor environment
     * from the shell that created the session. The prompt-editor wrapper must
     * trust zmx's current leader capability instead so SSH, TUI, and mobile
     * attaches use the machine editor even when the old environment still says
     * macos-app.
     */
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-prompt-editor-zmx-machine-"));
    const binDir = path.join(tempDir, "bin");
    const editFile = path.join(tempDir, "prompt.md");
    const markerFile = path.join(tempDir, "machine-editor-args.txt");
    const editorPath = path.join(binDir, "machine-editor");
    const zmxPath = path.join(binDir, "zmx");
    try {
      await mkdir(binDir, { recursive: true });
      await writeFile(editFile, "prompt text\n");
      await writeFile(
        editorPath,
        `#!/bin/sh
printf '%s\\n' "$@" > ${JSON.stringify(markerFile)}
`,
      );
      await writeFile(
        zmxPath,
        `#!/bin/sh
if [ "$1" = "prompt-editor-capability" ]; then
  printf '%s\\n' ${capability}
fi
`,
      );
      await chmod(editorPath, 0o755);
      await chmod(zmxPath, 0o755);

      const result = await execFileAsync(process.execPath, [
        path.resolve("scripts/ghostex-cli.mjs"),
        "prompt-editor",
        editFile,
      ], {
        env: {
          ...process.env,
          GHOSTEX_PROMPT_EDITOR_CLIENT: "macos-app",
          GHOSTEX_PROMPT_EDITOR_BACKEND: "monaco",
          GHOSTEX_PROMPT_EDITOR_MACHINE_EDITOR: editorPath,
          GHOSTEX_ZMX_BIN: zmxPath,
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          ZMX_SESSION: "shared-session",
        },
      });

      expect(result.stderr).toBe("");
      expect((await readFile(markerFile, "utf8")).trim()).toBe(editFile);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
    },
  );

  test("prompt-editor uses explicit bundled zmx when zmx leader advertises Monaco capability", async () => {
    /**
     * CDXC:PromptEditor 2026-06-07-08:09:
     * The prompt-editor wrapper must query GHOSTEX_ZMX_BIN instead of PATH so a
     * stale Homebrew zmx cannot hide the current desktop attach client's
     * Monaco capability.
     */
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-prompt-editor-zmx-monaco-"));
    const homeDir = path.join(tempDir, "home");
    const binDir = path.join(tempDir, "bin");
    const editFile = path.join(tempDir, "prompt.md");
    const markerFile = path.join(tempDir, "ghostex-editor-args.txt");
    const pathZmxPath = path.join(binDir, "zmx");
    const bundledZmxPath = path.join(tempDir, "bundled-zmx");
    let editorSocket;
    try {
      await mkdir(path.join(homeDir, "cli"), { recursive: true });
      await mkdir(binDir, { recursive: true });
      await writeFile(path.join(homeDir, "cli", "bridge-token"), "test-token\n");
      await writeFile(editFile, "prompt text\n");
      const { appPath } = await createFakeGhostexEditorApp(tempDir, markerFile);
      editorSocket = createFakeGhostexEditorSocketPath();
      await writeFile(
        pathZmxPath,
        `#!/bin/sh
if [ "$1" = "prompt-editor-capability" ]; then
  printf '%s\\n' editor
fi
`,
      );
      await writeFile(
        bundledZmxPath,
        `#!/bin/sh
if [ "$1" = "prompt-editor-capability" ]; then
  printf '%s\\n' monaco
fi
`,
      );
      await chmod(pathZmxPath, 0o755);
      await chmod(bundledZmxPath, 0o755);

      const result = await execFileAsync(process.execPath, [
        path.resolve("scripts/ghostex-cli.mjs"),
        "prompt-editor",
        editFile,
      ], {
        env: {
          ...process.env,
          GHOSTEX_EDITOR_APP: appPath,
          GHOSTEX_EDITOR_SOCKET: editorSocket,
          GHOSTEX_HOME: homeDir,
          GHOSTEX_PROMPT_EDITOR_CLIENT: "",
          GHOSTEX_PROMPT_EDITOR_BACKEND: "inherit",
          GHOSTEX_ZMX_BIN: bundledZmxPath,
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          ZMX_SESSION: "shared-session",
        },
      });

      expect(result.stderr).toBe("");
      const editorArgs = (await readFile(markerFile, "utf8")).trim().split(/\r?\n/u);
      expect(editorArgs.slice(0, 5)).toEqual([
        editFile,
        "--language",
        "markdown",
        "--title",
        "Prompt Editor",
      ]);
      expect(editorArgs).toContain("--status-file");
    } finally {
      if (editorSocket) {
        await rm(editorSocket, { force: true });
      }
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("prompt-editor ignores PATH zmx when explicit bundled zmx is missing", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-prompt-editor-zmx-no-bin-"));
    const binDir = path.join(tempDir, "bin");
    const editFile = path.join(tempDir, "prompt.md");
    const markerFile = path.join(tempDir, "machine-editor-args.txt");
    const editorPath = path.join(binDir, "machine-editor");
    const pathZmxPath = path.join(binDir, "zmx");
    try {
      await mkdir(binDir, { recursive: true });
      await writeFile(editFile, "prompt text\n");
      await writeFile(
        editorPath,
        `#!/bin/sh
printf '%s\\n' "$@" > ${JSON.stringify(markerFile)}
`,
      );
      await writeFile(
        pathZmxPath,
        `#!/bin/sh
if [ "$1" = "prompt-editor-capability" ]; then
  printf '%s\\n' monaco
fi
`,
      );
      await chmod(editorPath, 0o755);
      await chmod(pathZmxPath, 0o755);

      const result = await execFileAsync(process.execPath, [
        path.resolve("scripts/ghostex-cli.mjs"),
        "prompt-editor",
        editFile,
      ], {
        env: {
          ...process.env,
          GHOSTEX_PROMPT_EDITOR_CLIENT: "macos-app",
          GHOSTEX_PROMPT_EDITOR_BACKEND: "monaco",
          GHOSTEX_PROMPT_EDITOR_MACHINE_EDITOR: editorPath,
          GHOSTEX_ZMX_BIN: "",
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          ZMX_SESSION: "shared-session",
        },
      });

      expect(result.stderr).toBe("");
      expect((await readFile(markerFile, "utf8")).trim()).toBe(editFile);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("prompt-editor treats legacy explicit gte as the machine editor", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-prompt-editor-legacy-gte-"));
    const binDir = path.join(tempDir, "bin");
    const editFile = path.join(tempDir, "prompt.md");
    const markerFile = path.join(tempDir, "machine-editor-args.txt");
    const editorPath = path.join(binDir, "machine-editor");
    try {
      await mkdir(binDir, { recursive: true });
      await writeFile(editFile, "prompt text\n");
      await writeFile(
        editorPath,
        `#!/bin/sh
printf '%s\\n' "$@" > ${JSON.stringify(markerFile)}
`,
      );
      await chmod(editorPath, 0o755);

      const result = await execFileAsync(process.execPath, [
        path.resolve("scripts/ghostex-cli.mjs"),
        "prompt-editor",
        editFile,
      ], {
        env: {
          ...process.env,
          GHOSTEX_PROMPT_EDITOR_CLIENT: "macos-app",
          GHOSTEX_PROMPT_EDITOR_BACKEND: "gte",
          GHOSTEX_PROMPT_EDITOR_MACHINE_EDITOR: "",
          GHOSTEX_PROMPT_EDITOR_MACHINE_VISUAL: "",
          EDITOR: editorPath,
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          VISUAL: "",
          ZMX_SESSION: "",
        },
      });

      expect(result.stderr).toBe("");
      expect((await readFile(markerFile, "utf8")).trim()).toBe(editFile);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test.each([
    ["browser", "ghostex-browser-use"],
    ["computer-use", "ghostex-computer-use"],
    ["agent-orchestration", "ghostex-agent-orchestration"],
    ["fable-5.5-orchestration", "ghostex-fable-5.5-orchestration"],
    ["generate-title", "ghostex-generate-title"],
    ["manage-beads", "ghostex-manage-beads"],
    ["move-codex-session", "ghostex-move-codex-session"],
  ])("delegates %s install-skill to gxserver agent-skills", async (namespace, skillName) => {
    /*
     * CDXC:AgentSkills 2026-06-19-08:25:
     * Ghostex's public CLI should not copy skill folders itself. Route every
     * bundled skill install through gxserver's external skills CLI wrapper while
     * passing the local bundled skills package as the install source.
     */
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-agent-skill-delegate-"));
    const capturePath = path.join(tempDir, "capture.json");
    const fakeGxserverCli = path.join(tempDir, "gxserver-cli.js");
    try {
      await writeFile(
        fakeGxserverCli,
        [
          "#!/usr/bin/env node",
          "import { writeFileSync } from 'node:fs';",
          "const payload = { argv: process.argv.slice(2) };",
          "writeFileSync(process.env.GHOSTEX_TEST_CAPTURE_PATH, JSON.stringify(payload));",
          "console.log(JSON.stringify({ ok: true, received: payload.argv }));",
        ].join("\n"),
      );
      await chmod(fakeGxserverCli, 0o755);

      const result = await execFileAsync(process.execPath, [
        path.resolve("scripts/ghostex-cli.mjs"),
        namespace,
        "install-skill",
        "--json",
      ], {
        env: {
          ...process.env,
          GHOSTEX_GXSERVER_CLI: fakeGxserverCli,
          GHOSTEX_TEST_CAPTURE_PATH: capturePath,
        },
      });
      const payload = JSON.parse(result.stdout);
      const capture = JSON.parse(await readFile(capturePath, "utf8"));
      const sourceIndex = capture.argv.indexOf("--source");
      const sourcePath = capture.argv[sourceIndex + 1];

      expect(payload.ok).toBe(true);
      expect(capture.argv.slice(0, 3)).toEqual(["agent-skills", "install", skillName]);
      expect(sourceIndex).toBeGreaterThan(0);
      expect(sourcePath).toBe(path.resolve("skills"));
      expect(await readFile(path.join(sourcePath, skillName, "SKILL.md"), "utf8")).toContain(`# ${skillName}`);
      expect(capture.argv).toContain("--json");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("documents browser control under gx browser help", async () => {
    const help = browserUsage();
    const cliHelpResult = await execFileAsync(process.execPath, [
      path.resolve("scripts/ghostex-cli.mjs"),
      "browser",
      "--help",
    ]);

    expect(cliHelpResult.stdout).toBe(`${help}\n`);
    expect(help).toContain("gx browser mcp");
    expect(help).toContain("gx browser open [url] [--project-path path|--project-id id] [--reuse similar|exact|none]");
    expect(help).toContain('args = ["browser", "mcp"]');
    expect(help).toContain("ghostex_console_logs");
    expect(help).toContain("ghostex_snapshot");
    expect(help).toContain("browser install-skill");
    expect(help).toContain("default to the CLI process cwd as --project-path");
    expect(help).toContain("default to --reuse similar");
    expect(help).toContain("keep the returned session id and the MCP page id");
  });

  test("documents Ghostex Computer Use under gx computer-use help", async () => {
    const help = computerUseUsage();
    const cliHelpResult = await execFileAsync(process.execPath, [
      path.resolve("scripts/ghostex-cli.mjs"),
      "computer-use",
      "--help",
    ]);

    expect(cliHelpResult.stdout).toBe(`${help}\n`);
    expect(help).toContain("gx computer-use install-skill");
    expect(help).toContain("$ghostex-computer-use");
    expect(help).toContain("$cua-driver");
  });

  test("documents Ghostex Agent Orchestration under gx agent-orchestration help", async () => {
    const help = agentOrchestrationUsage();
    const cliHelpResult = await execFileAsync(process.execPath, [
      path.resolve("scripts/ghostex-cli.mjs"),
      "agent-orchestration",
      "--help",
    ]);

    expect(cliHelpResult.stdout).toBe(`${help}\n`);
    expect(help).toContain("gx agent-orchestration install-skill");
    expect(help).toContain("$ghostex-agent-orchestration");
    expect(help).toContain("read-text --lines");
  });

  test("documents Ghostex Generate Title under gx generate-title help", async () => {
    const help = generateTitleUsage();
    const cliHelpResult = await execFileAsync(process.execPath, [
      path.resolve("scripts/ghostex-cli.mjs"),
      "generate-title",
      "--help",
    ]);

    expect(cliHelpResult.stdout).toBe(`${help}\n`);
    expect(help).toContain("gx generate-title install-skill");
    expect(help).toContain("$ghostex-generate-title");
    expect(help).toContain("shorter than 60 characters");
    expect(help).toContain("ghostex rename-command");
    expect(help).toContain("${GHOSTEX_GLOBAL_SESSION_REF:-${GHOSTEX_SESSION_ID:-${ZMX_SESSION:-}}}");
    expect(help).not.toContain("Do not press Enter");
  });

  test("documents Ghostex Manage Beads under gx manage-beads help", async () => {
    const help = manageBeadsUsage();
    const cliHelpResult = await execFileAsync(process.execPath, [
      path.resolve("scripts/ghostex-cli.mjs"),
      "manage-beads",
      "--help",
    ]);

    expect(cliHelpResult.stdout).toBe(`${help}\n`);
    expect(help).toContain("gx manage-beads install-skill");
    expect(help).toContain("$ghostex-manage-beads");
    expect(help).toContain("gx bd list/show/comments");
    expect(help).toContain("codex-thread:$CODEX_THREAD_ID");
    expect(help).toContain("Ghostex and Codex ids");
  });

  test("documents Ghostex Move Codex Session under gx move-codex-session help", async () => {
    const help = moveCodexSessionUsage();
    const cliHelpResult = await execFileAsync(process.execPath, [
      path.resolve("scripts/ghostex-cli.mjs"),
      "move-codex-session",
      "--help",
    ]);

    expect(cliHelpResult.stdout).toBe(`${help}\n`);
    expect(help).toContain("gx move-codex-session install-skill");
    expect(help).toContain("$ghostex-move-codex-session");
    expect(help).toContain("codex fork --yolo -C <folder-path> <SESSION_ID>");
  });

  test("resolves bundled Beads from app and source-staged resources", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-bundled-bd-"));
    try {
      const appBd = path.join(tempDir, "app", "bin", "bd");
      await mkdir(path.dirname(appBd), { recursive: true });
      await writeFile(appBd, "#!/bin/sh\n");
      await chmod(appBd, 0o755);
      expect(resolveBundledBeadsLaunchFromRoot(path.join(tempDir, "app"))?.command).toBe(appBd);

      const sourceBd = path.join(tempDir, "source", "native", "macos", "ghostexHost", "Web", "bin", "bd");
      await mkdir(path.dirname(sourceBd), { recursive: true });
      await writeFile(sourceBd, "#!/bin/sh\n");
      await chmod(sourceBd, 0o755);
      expect(resolveBundledBeadsLaunchFromRoot(path.join(tempDir, "source"))?.command).toBe(sourceBd);
      expect(resolveBundledBeadsLaunchFromRoot(path.join(tempDir, "path-bin"))).toBeUndefined();
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("builds picker rows with intro text, project spacing, and agent indicators", () => {
    /**
     * CDXC:CliSessionPicker 2026-05-24-18:10:
     * Bare `ghostex`/`gx` must present a keyboard picker that mirrors the
     * macOS sidebar inventory without leaking aliases, paths, status, provider
     * metadata, or detail rows into the selectable session labels.
     *
     * CDXC:CliSessionPicker 2026-05-24-18:25:
     * The first no-project group is labeled Quick Terminals, every project
     * header has one empty row above it, and session labels may add only the
     * agent color marker before the saved title.
     *
     * CDXC:CliSessionPicker 2026-05-24-18:31:
     * Selected sessions recolor the full row instead of only the leading agent
     * marker so the active target stays easy to scan.
     *
     * CDXC:CliSessionPicker 2026-05-24-18:45:
     * The picker starts with the attach prompt and uses colored three-character
     * agent indicators in brackets instead of glyphs.
     *
     * CDXC:CliSessionPicker 2026-05-24-18:47:
     * The header is one bright title plus one separator row, with no extra
     * blank spacer rows before project sections.
     */
    const rows = buildSessionPickerRows([
      {
        alias: 42,
        agent: "claude",
        projectId: "quick",
        projectName: "",
        projectPath: "",
        status: "working",
        title: "Ship picker exactly as titled",
      },
      {
        alias: 7,
        agent: "t3",
        projectId: "a",
        projectName: "Alpha",
        projectPath: "/alpha",
        provider: "zmx",
        title: "No wrap metadata here",
      },
    ]);

    expect(rows).toMatchObject([
      { kind: "title", selected: false, text: "Attach to Ghostex Session" },
      { kind: "separator", selected: false, text: "─" },
      { kind: "project", selected: false, text: "Quick Terminals" },
      {
        agentIndicator: { color: "#d97757", label: "CLD" },
        kind: "session",
        selected: true,
        text: "[CLD] Ship picker exactly as titled",
      },
      { kind: "project", selected: false, text: "Alpha" },
      {
        agentIndicator: { color: "#ff6af3", label: "T3C" },
        kind: "session",
        selected: false,
        text: "[T3C] No wrap metadata here",
      },
    ]);
    expect(rows.map((row) => row.text).join("\n")).not.toContain("42");
    expect(rows.map((row) => row.text).join("\n")).not.toContain("/alpha");
    expect(rows.map((row) => row.text).join("\n")).not.toContain("working");
  });

  test("uses requested picker agent indicators", () => {
    const rows = buildSessionPickerRows([
      {
        agent: "antigravity",
        projectId: "project",
        projectName: "Project",
        projectPath: "/project",
        title: "antigravity row",
      },
      {
        agent: "codex",
        projectId: "project",
        projectName: "Project",
        projectPath: "/project",
        title: "codex row",
      },
      {
        agent: "cursor",
        projectId: "project",
        projectName: "Project",
        projectPath: "/project",
        title: "cursor row",
      },
      {
        agent: "copilot",
        projectId: "project",
        projectName: "Project",
        projectPath: "/project",
        title: "copilot row",
      },
      {
        agent: "gemini",
        projectId: "project",
        projectName: "Project",
        projectPath: "/project",
        title: "gemini row",
      },
      {
        agent: "grok",
        projectId: "project",
        projectName: "Project",
        projectPath: "/project",
        title: "grok row",
      },
      {
        agent: "pi",
        projectId: "project",
        projectName: "Project",
        projectPath: "/project",
        title: "pi row",
      },
    ]);

    expect(rows).toMatchObject([
      { kind: "title" },
      { kind: "separator" },
      { kind: "project", text: "Project" },
      {
        agentIndicator: { color: "#749bff", label: "AGY" },
        kind: "session",
        text: "[AGY] antigravity row",
      },
      {
        agentIndicator: { color: "#a991ff", label: "CDX" },
        kind: "session",
        text: "[CDX] codex row",
      },
      {
        agentIndicator: { color: "#749bff", label: "CRS" },
        kind: "session",
        text: "[CRS] cursor row",
      },
      {
        agentIndicator: { color: "#ffffff", label: "PLT" },
        kind: "session",
        text: "[PLT] copilot row",
      },
      {
        agentIndicator: { color: "#8b9aff", label: "GEM" },
        kind: "session",
        text: "[GEM] gemini row",
      },
      {
        agentIndicator: { color: "#ffffff", label: "GRK" },
        kind: "session",
        text: "[GRK] grok row",
      },
      {
        agentIndicator: { color: "#c8ff62", label: "PIA" },
        kind: "session",
        text: "[PIA] pi row",
      },
    ]);
  });

  test("moves picker selection by session, pages, and wrapping project jumps", () => {
    const model = buildSessionPickerModel([
      {
        projectId: "b",
        projectName: "Beta",
        title: "beta one",
      },
      {
        projectId: "b",
        projectName: "Beta",
        title: "beta two",
      },
      {
        projectId: "a",
        projectName: "Alpha",
        title: "alpha one",
      },
      {
        projectId: "a",
        projectName: "Alpha",
        title: "alpha two",
      },
    ]);

    expect(moveSessionPickerSelection(model, 0, "down")).toBe(1);
    expect(moveSessionPickerSelection(model, 3, "down")).toBe(0);
    expect(moveSessionPickerSelection(model, 1, "up")).toBe(0);
    expect(moveSessionPickerSelection(model, 0, "up")).toBe(3);
    expect(moveSessionPickerSelection(model, 0, "pagedown")).toBe(1);
    expect(moveSessionPickerSelection(model, 1, "pageup")).toBe(0);
    expect(moveSessionPickerSelection(model, 1, "right")).toBe(2);
    expect(moveSessionPickerSelection(model, 3, "left")).toBe(0);
    expect(moveSessionPickerSelection(model, 0, "left")).toBe(2);
    expect(moveSessionPickerSelection(model, 3, "right")).toBe(0);
  });

  test("resolves provider session names for cross-session CLI selectors", async () => {
    /**
     * CDXC:CliSessionSelectors 2026-05-28-10:55:
     * GHOSTEX_SESSION_ID uses the provider persistence name. send-text and other
     * session bridge commands must resolve that id before title matching so
     * generate-title can target the current pane without the combined-session id.
     */
    const sessions = [
      {
        alias: 1,
        projectName: "zmux",
        provider: "zmx",
        providerSessionName: "g-0527-090339",
        sessionId: "combined-session:project-a:g-0527-090339",
        title: "Sidebar Max Counter Display",
      },
      {
        alias: 2,
        projectName: "DockDoor",
        provider: "zmx",
        providerSessionName: "g-0528-083815",
        sessionId: "combined-session:project-b:g-0528-083815",
        title: "Terminal Session",
      },
    ];

    await expect(resolveListedSessions("g-0527-090339", sessions)).resolves.toEqual([sessions[0]]);
    await expect(resolveListedSessions("zmx/g-0528-083815", sessions)).resolves.toEqual([
      sessions[1],
    ]);
    await expect(
      resolveListedSessions("combined-session:project-a:g-0527-090339", sessions),
    ).resolves.toEqual([sessions[0]]);
    await expect(resolveListedSessions("g-0527-090339", [sessions[0], sessions[0]])).resolves.toEqual(
      [sessions[0], sessions[0]],
    );
  });

  test("scopes duplicate gxserver session id selectors by project id", async () => {
    const sessions = [
      {
        globalRef: "S1a:P1aa:G1aa",
        projectId: "P1aa",
        projectName: "Alpha",
        provider: "zmx",
        providerSessionName: "S1a-P1aa-G1aa",
        sessionId: "G1aa",
        title: "Shared id in alpha",
      },
      {
        globalRef: "S1a:P2bb:G1aa",
        projectId: "P2bb",
        projectName: "Beta",
        provider: "zmx",
        providerSessionName: "S1a-P2bb-G1aa",
        sessionId: "G1aa",
        title: "Shared id in beta",
      },
    ];

    await expect(resolveListedSessions("G1aa", sessions)).resolves.toEqual(sessions);
    await expect(resolveListedSessions("G1aa", sessions, { projectId: "P2bb" })).resolves.toEqual([
      sessions[1],
    ]);
    await expect(resolveListedSessions("S1a:P1aa:G1aa", sessions)).resolves.toEqual([sessions[0]]);
  });

  test("formats compact session rows without field labels", () => {
    /**
     * CDXC:CliSessions 2026-05-20-12:20:
     * Session listing should stay compact on narrow terminals: one headline row
     * plus a short detail line, with project paths only on project headers.
     */
    const line = formatCompactSessionLine({
      alias: 2,
      title: "Ship Android polish",
      lastInteractionAt: new Date(Date.now() - 120_000).toISOString(),
      status: "working",
      provider: "zmx",
      providerSessionName: "zmux-main-2",
      agent: "codex",
      isFocused: true,
    });

    expect(line).toBe(
      "› #2  Ship Android polish\n    codex · zmx/zmux-main-2 · working · 2m ago",
    );
    expect(line).not.toContain("project:");
    expect(line).not.toContain("path:");
    expect(line).not.toContain("group:");
  });

  test("resolves attach shell per remote platform", () => {
    /**
     * CDXC:RemoteUbuntuAttach 2026-06-24-22:32:
     * Ubuntu remote attaches run the same bundled Node CLI as macOS, but the
     * process wrapper must use an installed POSIX shell instead of assuming
     * `/bin/zsh` exists. macOS stays pinned to `/bin/zsh` to avoid changing the
     * local app attach environment.
     */
    expect(resolveCliInteractiveShellLaunch({
      env: { SHELL: "/bin/bash" },
      isExecutable: () => false,
      platform: "darwin",
    })).toEqual({ commandFlag: "-lc", executable: "/bin/zsh", loginFlag: "-l" });

    expect(resolveCliInteractiveShellLaunch({
      env: { SHELL: "/usr/bin/bash" },
      isExecutable: (candidate) => candidate === "/usr/bin/bash",
      platform: "linux",
    })).toEqual({ commandFlag: "-lc", executable: "/usr/bin/bash", loginFlag: "-l" });

    expect(resolveCliInteractiveShellLaunch({
      env: { SHELL: "/usr/bin/fish" },
      isExecutable: (candidate) => candidate === "/bin/sh",
      platform: "linux",
    })).toEqual({ commandFlag: "-c", executable: "/bin/sh", loginFlag: "" });
  });

  test("creates a missing zmx session with the agent resume command before attach", () => {
    /**
     * CDXC:AndroidRemoteSessions 2026-05-21-07:21:
     * Android sidebar taps should match macOS persistence restore behavior:
     * attach live zmx sessions, but recreate a missing named zmx session with
     * the agent resume command instead of letting the mobile terminal close.
     */
    const command = buildSessionAttachCommand({
      alias: 7,
      attachCommand: "zmx attach ghostex-session-7",
      projectPath: "/Users/madda/project",
      provider: "zmx",
      providerSessionName: "ghostex-session-7",
      resumeCommand: 'codex resume "Ship Android"',
      status: "idle",
    });

    expect(command).toContain("zmx list --short");
    expect(command).toContain('exec zmx attach "$zmx_session"');
    expect(command).toContain(
      'exec zmx attach "$zmx_session" "$zmx_resume_shell" "$zmx_resume_shell_flag" "$zmx_resume_launcher"',
    );
    expect(command).toContain("zmx_resume_shell=");
    expect(command).toContain("/bin/zsh");
    expect(command).toContain("zmx_resume_shell_flag=");
    expect(command).toContain("-lc");
    expect(command).toContain("codex resume");
    expect(command).toContain("zmx_keepalive_shell=${SHELL:-/bin/zsh}");
    expect(command).toContain('exec "$zmx_keepalive_shell" "$zmx_keepalive_shell_login_flag"');
    expect(command).toContain("Leaving this pane open for inspection.");
  });

  test("tries zmx resume fallback before leaving failed resume pane open", () => {
    const command = buildSessionAttachCommand({
      alias: 7,
      attachCommand: "zmx attach ghostex-session-7",
      projectPath: "/Users/madda/project",
      provider: "zmx",
      providerSessionName: "ghostex-session-7",
      resumeCommand: 'codex resume "019e5383-127b-76f1-a4bf-a785b3b3bf4f"',
      resumeFallbackCommand: 'codex resume "Ship Android"',
      status: "idle",
    });

    expect(command).toContain("zmx_resume_fallback_command=");
    expect(command).toContain("Exact resume failed; trying saved fallback resume command.");
    expect(command).toContain('"$zmx_resume_shell" "$zmx_resume_shell_flag" "$zmx_resume_fallback_command"');
  });

  test("uses full zmx replay for live attach sessions", () => {
    const command = buildSessionAttachCommand({
      alias: 8,
      attachCommand: "zmx attach ghostex-session-8",
      provider: "zmx",
      providerSessionName: "ghostex-session-8",
      status: "working",
    });

    expect(command).toBe("zmx attach ghostex-session-8");
  });

  test("sends gxserver auth and protocol headers for RPC requests", async () => {
    /**
     * CDXC:GxserverCliCutover 2026-05-30-15:15:
     * The Node gx/ghostex CLI reads the local gxserver token itself and sends
     * authenticated protocol-versioned HTTP RPCs. This replaces the retired
     * macOS app bridge for session inventory, lifecycle, and mobile callbacks.
     */
    await withGxserverFixture(async ({ baseUrl }) => {
      const result = await requestGxserverRpc(
        { baseUrl, token: "test-token" },
        "/api/listSessions",
        { projectId: "P3a91" },
        { timeoutMs: 1_000 },
      );

      expect(result).toMatchObject({
        ok: true,
        requestId: "fixture-request",
        sessions: [],
      });
    });
  });

  test("lists non-stopped gxserver zmx sessions with shared lifecycle fields", async () => {
    /**
     * CDXC:GxserverSessionInventory 2026-05-31-08:45:
     * `ghostex sessions --json` is the common inventory for macOS hydration,
     * Android, iOS, the gx TUI, and `gx ls`. It should render running and
     * sleeping zmx sessions while hiding stopped rows by default.
     *
     * CDXC:ProjectVisibility 2026-06-30-21:23:
     * Mobile session inventory must also hide gxserver Recent Projects and
     * Remote Attach carrier projects so phones do not show server-side
     * implementation containers or closed workspaces.
     */
    const server = http.createServer(async (request, response) => {
      expect(request.headers.authorization).toBe("Bearer test-token");
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      JSON.parse(Buffer.concat(chunks).toString("utf8"));
      let result;
      if (request.url === "/api/listProjects") {
        result = {
          projects: [
            { name: "Ghostex", path: "/Users/madda/zmux", projectId: "P1a", visibility: "visible" },
            { isRecentProject: true, name: "Closed", path: "/Users/madda/closed", projectId: "P2a", visibility: "visible" },
            { name: "Remote Attach", path: "/Users/madda/.ghostex/remote-attach-carriers", projectId: "P3a", systemKind: "remoteAttachCarrier", visibility: "hidden" },
          ],
        };
      } else if (request.url === "/api/readPresentationSnapshot") {
        result = {
          snapshot: {
            revision: 9,
            sessions: [
              { activity: "working", projectId: "P1a", sessionId: "G1a" },
              {
                actions: {
                  acknowledgeAttention: false,
                  attach: true,
                  focus: true,
                  kill: true,
                  readText: true,
                  sendMessage: true,
                  sendText: true,
                  sleep: true,
                  wake: false,
                },
                activity: "idle",
                agentIcon: "codex",
                agentName: "codex",
                agentSessionId: "presentation-codex-session",
                groupId: "P1a:active",
                isFavorite: true,
                isPinned: false,
                isPrimaryTitleTerminalTitle: false,
                isTemporaryTitle: false,
                kind: "agent",
                primaryTitle: "Sleeping",
                projectId: "P1a",
                sessionId: "G2a",
                sortKey: "0:1:2026-05-31T04:01:00.000Z:G2a",
                surface: "workspace",
                terminalTitle: "Sleeping",
                title: "Sleeping",
                titleSource: "terminal-auto",
                trustedResumeTitle: "Sleeping",
                updatedAt: "2026-05-31T04:01:00.000Z",
                visibleInSidebarByDefault: true,
                zmxName: "S1a-P1a-G2a",
              },
            ],
          },
        };
      } else {
        result = {
          sessions: [
            {
              globalRef: "S1a:P1a:G1a",
              lifecycleState: "running",
              projectId: "P1a",
              providerState: { lifecycleState: "missing", zmxName: "S1a-P1a-G1a" },
              sessionId: "G1a",
              title: "Live after restart",
              updatedAt: "2026-05-31T04:00:00.000Z",
              zmxName: "S1a-P1a-G1a",
            },
            {
              globalRef: "S1a:P1a:G2a",
              lifecycleState: "sleeping",
              projectId: "P1a",
              providerState: { lifecycleState: "missing", zmxName: "S1a-P1a-G2a" },
              sessionId: "G2a",
              title: "Sleeping",
              runtimeSettings: {
                agentSessionId: "runtime-codex-session",
              },
              updatedAt: "2026-05-31T04:01:00.000Z",
              zmxName: "S1a-P1a-G2a",
            },
            {
              globalRef: "S1a:P1a:G3a",
              lifecycleState: "stopped",
              projectId: "P1a",
              providerState: { lifecycleState: "missing", zmxName: "S1a-P1a-G3a" },
              sessionId: "G3a",
              title: "Stopped",
              updatedAt: "2026-05-31T04:02:00.000Z",
              zmxName: "S1a-P1a-G3a",
            },
            {
              globalRef: "S1a:P2a:G4a",
              lifecycleState: "running",
              projectId: "P2a",
              providerState: { lifecycleState: "exists", zmxName: "S1a-P2a-G4a" },
              sessionId: "G4a",
              title: "Recent project session",
              updatedAt: "2026-05-31T04:03:00.000Z",
              zmxName: "S1a-P2a-G4a",
            },
            {
              globalRef: "S1a:P3a:G5a",
              lifecycleState: "running",
              projectId: "P3a",
              providerState: { lifecycleState: "exists", zmxName: "S1a-P3a-G5a" },
              sessionId: "G5a",
              title: "Remote carrier session",
              updatedAt: "2026-05-31T04:04:00.000Z",
              zmxName: "S1a-P3a-G5a",
            },
          ],
        };
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        product: "gxserver",
        protocolVersion: 1,
        requestId: "inventory-fixture",
        result,
      }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    try {
      const flags = {
        server: `http://127.0.0.1:${address.port}`,
        timeoutMs: 1_000,
        token: "test-token",
      };
      const result = await fetchGxserverSessionList(flags);

      expect(result.sessions.map((session) => session.sessionId)).toEqual(["G1a", "G2a"]);
      expect(result.projects.map((project) => project.projectId)).toEqual(["P1a"]);
      expect(result.sessions[0]).toMatchObject({
        isLive: true,
        isLocalOnly: false,
        lifecycleState: "running",
        ownership: "gxserver",
        provider: "zmx",
        providerSessionName: "S1a-P1a-G1a",
        providerSessionState: "missing",
        sessionPersistenceProvider: "zmx",
        status: "running",
        activity: "working",
      });
      expect(result.sessions[1]).toMatchObject({
        actions: {
          attach: true,
          sendMessage: true,
          wake: false,
        },
        activity: "idle",
        agentIcon: "codex",
        agentName: "codex",
        agentSessionId: "presentation-codex-session",
        groupId: "P1a:active",
        isFavorite: true,
        primaryTitle: "Sleeping",
        surface: "workspace",
        titleSource: "terminal-auto",
        isSleeping: true,
        lifecycleState: "sleeping",
        status: "sleep",
        visibleInSidebarByDefault: true,
      });

      const allResult = await fetchGxserverSessionList({ ...flags, all: true });
      expect(allResult.sessions.map((session) => session.sessionId)).toEqual(["G1a", "G2a", "G3a"]);
      expect(allResult.projects.map((project) => project.projectId)).toEqual(["P1a"]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("projects mobile sessions summary without heavy presentation fields", () => {
    /**
     * CDXC:iOSRemoteSessions 2026-06-30-04:37:
     * iOS should request `ghostex sessions --json --mobile-summary` so large Mac session inventories avoid transferring desktop/debug-only presentation fields over the phone's SSH list path.
     *
     * CDXC:ProjectVisibility 2026-06-30-21:23:
     * The mobile summary compactor must preserve gxserver active-project visibility so hidden Remote Attach carrier rows stay out of phone project lists.
     */
    const result = toMobileSessionList({
      ok: true,
      product: "gxserver",
      projects: [
        { name: "Ghostex", path: "/repo/ghostex", projectId: "P1" },
        { name: "Remote Attach", path: "/repo/.ghostex/remote-attach-carriers", projectId: "P2", systemKind: "remoteAttachCarrier", visibility: "hidden" },
      ],
      revision: "r1",
      sessions: [
        {
          actions: { attach: true, kill: true, wake: false },
          agent: "codex",
          agentIcon: "codex",
          agentSessionPath: "/private/agent/path",
          alias: 12,
          displayTitle: "Ship it",
          displayTitleTooltip: "A long tooltip",
          groupId: "P1:active",
          isFocused: false,
          isLive: true,
          isSleeping: false,
          lastInteractionAt: "2026-06-30T04:37:00.000Z",
          projectId: "P1",
          projectName: "Ghostex",
          projectPath: "/repo/ghostex",
          provider: "zmx",
          providerSessionName: "S1-P1-G1",
          providerSessionState: "exists",
          sessionId: "G1",
          shouldSubmitStagedFirstPromptTitleCommand: true,
          status: "working",
          title: "Raw title",
        },
        {
          displayTitle: "Hidden carrier",
          projectId: "P2",
          projectName: "Remote Attach",
          sessionId: "G2",
          title: "Hidden carrier",
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      product: "gxserver",
      revision: "r1",
      projects: [{ name: "Ghostex", path: "/repo/ghostex", projectId: "P1" }],
      sessions: [
        {
          agent: "codex",
          agentIcon: "codex",
          alias: 12,
          displayTitle: "Ship it",
          isLive: true,
          lastInteractionAt: "2026-06-30T04:37:00.000Z",
          projectId: "P1",
          provider: "zmx",
          providerSessionName: "S1-P1-G1",
          sessionId: "G1",
          status: "working",
        },
      ],
    });
    expect(result.sessions.map((session) => session.sessionId)).toEqual(["G1"]);
    expect(result.sessions[0]).not.toHaveProperty("actions");
    expect(result.sessions[0]).not.toHaveProperty("agentSessionPath");
    expect(result.sessions[0]).not.toHaveProperty("displayTitleTooltip");
  });

  test("resolves bare gxserver session ids before lifecycle RPCs", async () => {
    const requests = [];
    const server = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      const requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push({ body: requestBody, url: request.url });
      const result =
        request.url === "/api/listProjects"
          ? { projects: [{ name: "Ghostex", path: "/Users/madda/zmux", projectId: "P1a" }] }
          : request.url === "/api/listSessions"
            ? {
                sessions: [
                  {
                    globalRef: "S1a:P1a:G9a",
                    lifecycleState: "running",
                    projectId: "P1a",
                    providerState: { lifecycleState: "exists", zmxName: "S1a-P1a-G9a" },
                    sessionId: "G9a",
                    title: "Kill me",
                    updatedAt: "2026-05-31T04:03:00.000Z",
                    zmxName: "S1a-P1a-G9a",
                  },
                ],
              }
            : { killed: true };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        product: "gxserver",
        protocolVersion: 1,
        requestId: "lifecycle-fixture",
        result,
      }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    try {
      const result = await sendGxserverCliAction(
        "closeSession",
        { sessionId: "G9a" },
        {
          server: `http://127.0.0.1:${address.port}`,
          timeoutMs: 1_000,
          token: "test-token",
        },
      );

      expect(result).toMatchObject({ killed: true, ok: true });
      expect(requests.at(-1)).toMatchObject({
        url: "/api/killSession",
        body: {
          params: {
            projectId: "P1a",
            sessionId: "G9a",
          },
          protocolVersion: 1,
        },
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("tag-session sets a gxserver session tag", async () => {
    const requests = [];
    const server = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      requests.push({
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        url: request.url,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        product: "gxserver",
        protocolVersion: 1,
        requestId: "tag-session-fixture",
        result: {
          session: {
            isFavorite: false,
            projectId: "P1a",
            sessionId: "G9a",
            sessionTag: "testing",
          },
        },
      }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    try {
      const result = await execFileAsync(process.execPath, [
        path.resolve("scripts/ghostex-cli.mjs"),
        "tag-session",
        "--session-id",
        "G9a",
        "--project-id",
        "P1a",
        "testing",
        "--server",
        `http://127.0.0.1:${address.port}`,
        "--token",
        "test-token",
        "--json",
      ]);

      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        url: "/api/updateSession",
        body: {
          params: {
            isFavorite: false,
            projectId: "P1a",
            sessionId: "G9a",
            sessionTag: "testing",
          },
          protocolVersion: 1,
        },
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("tag-session none clears a gxserver session tag", async () => {
    const requests = [];
    const server = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      requests.push({
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        url: request.url,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        product: "gxserver",
        protocolVersion: 1,
        requestId: "tag-session-clear-fixture",
        result: {
          session: {
            isFavorite: false,
            projectId: "P1a",
            sessionId: "G9a",
            sessionTag: null,
          },
        },
      }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    try {
      const result = await execFileAsync(process.execPath, [
        path.resolve("scripts/ghostex-cli.mjs"),
        "tag-session",
        "--session-id",
        "G9a",
        "--project-id",
        "P1a",
        "none",
        "--server",
        `http://127.0.0.1:${address.port}`,
        "--token",
        "test-token",
        "--json",
      ]);

      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        url: "/api/updateSession",
        body: {
          params: {
            isFavorite: false,
            projectId: "P1a",
            sessionId: "G9a",
            sessionTag: null,
          },
          protocolVersion: 1,
        },
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("create-agent starts the gxserver provider after creating the session", async () => {
    /**
     * CDXC:GxserverCliAgents 2026-06-19-15:55:
     * Agent orchestration uses `ghostex create-agent` as a spawn primitive. The CLI must create the durable gxserver row and immediately materialize its zmx provider so follow-up `send-message` calls target an agent process, not the post-failure shell prompt.
     */
    const requests = [];
    const server = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      const requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push({ body: requestBody, url: request.url });
      const result =
        request.url === "/api/createAgentSession"
          ? {
              session: {
                projectId: "P1a",
                sessionId: "G1a",
                title: "G1a",
              },
            }
          : request.url === "/api/startSessionProvider"
            ? {
                providerState: { lifecycleState: "exists", zmxName: "S1a-P1a-G1a" },
                session: {
                  projectId: "P1a",
                  providerState: { lifecycleState: "exists", zmxName: "S1a-P1a-G1a" },
                  sessionId: "G1a",
                  title: "G1a",
                },
                started: true,
              }
            : {};
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        product: "gxserver",
        protocolVersion: 1,
        requestId: "create-agent-fixture",
        result,
      }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    try {
      const result = await sendGxserverCliAction(
        "createAgentSession",
        { agentId: "cursor", projectId: "P1a" },
        {
          server: `http://127.0.0.1:${address.port}`,
          timeoutMs: 1_000,
          token: "test-token",
        },
      );

      expect(result.provider).toMatchObject({ started: true });
      expect(result.session).toMatchObject({
        providerState: { lifecycleState: "exists" },
        sessionId: "G1a",
      });
      expect(requests.map((request) => request.url)).toEqual([
        "/api/createAgentSession",
        "/api/startSessionProvider",
      ]);
      expect(requests[0].body.params).toMatchObject({
        agentId: "cursor",
        projectId: "P1a",
      });
      expect(requests[1].body.params).toEqual({
        projectId: "P1a",
        sessionId: "G1a",
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("create-session sends first input to gxserver runtime settings", async () => {
    /**
     * CDXC:GxserverSessionTitle 2026-06-23-08:40:
     * The CLI must pass first-message input through to gxserver-rs as runtime metadata and startup text, leaving title generation and staged rename ownership in gxserver.
     */
    const requests = [];
    const server = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      requests.push({
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        url: request.url,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        product: "gxserver",
        protocolVersion: 1,
        requestId: "create-session-input-fixture",
        result: {
          session: {
            projectId: "P1a",
            sessionId: "G1a",
            title: "Terminal",
          },
        },
      }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    try {
      await sendGxserverCliAction(
        "createSession",
        {
          input: "Summarize this project",
          projectId: "P1a",
          title: "Terminal",
        },
        {
          server: `http://127.0.0.1:${address.port}`,
          timeoutMs: 1_000,
          token: "test-token",
        },
      );

      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        url: "/api/createSession",
        body: {
          params: {
            kind: "terminal",
            launchSettings: {
              startupText: "Summarize this project",
            },
            projectId: "P1a",
            runtimeSettings: {
              firstUserMessage: "Summarize this project",
            },
            title: "Terminal",
          },
          protocolVersion: 1,
        },
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("sleep-session false with a flagged selector calls gxserver wake", async () => {
    const requests = [];
    const server = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      requests.push({
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        url: request.url,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        product: "gxserver",
        protocolVersion: 1,
        requestId: "wake-fixture",
        result: {
          session: {
            lifecycleState: "running",
            projectId: "P1a",
            sessionId: "G9a",
          },
        },
      }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    try {
      /**
       * CDXC:GxserverSessionLifecycle 2026-05-31-08:45:
       * The gx TUI and remote clients use `sleep-session --session-id G... false`
       * as their wake form. When the selector comes from a flag, the boolean is
       * the first positional argument; parsing it as rest[1] silently turns wake
       * into sleep and kills the zmx runtime again.
       */
      const result = await execFileAsync(process.execPath, [
        path.resolve("scripts/ghostex-cli.mjs"),
        "sleep-session",
        "--session-id",
        "G9a",
        "--project-id",
        "P1a",
        "false",
        "--server",
        `http://127.0.0.1:${address.port}`,
        "--token",
        "test-token",
        "--json",
      ]);

      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        url: "/api/wakeSession",
        body: {
          params: {
            projectId: "P1a",
            sessionId: "G9a",
            sleeping: false,
          },
          protocolVersion: 1,
        },
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("rename-command stages a provider rename and submits native Enter through gxserver", async () => {
    const requests = [];
    const server = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push({ body, url: request.url });
      const result =
        request.url === "/api/listProjects"
          ? { projects: [{ name: "Ghostex", path: "/tmp/ghostex", projectId: "P1a" }] }
          : request.url === "/api/listSessions"
            ? {
                sessions: [
                  {
                    kind: "agent",
                    lifecycleState: "running",
                    projectId: "P1a",
                    providerState: { lifecycleState: "exists", zmxName: "S90-P1a-G9a" },
                    sessionId: "G9a",
                    title: "Current Session",
                    zmxName: "S90-P1a-G9a",
                  },
                ],
              }
            : request.url === "/api/readPresentationSnapshot"
              ? { sessions: [] }
              : {
                  session: {
                    kind: "agent",
                    lifecycleState: "running",
                    projectId: body.params.projectId,
                    sessionId: body.params.sessionId,
                  },
                };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        product: "gxserver",
        protocolVersion: 1,
        requestId: "rename-command-fixture",
        result,
      }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    try {
      /*
       * CDXC:GenerateTitleSkill 2026-06-13-01:55:
       * `$ghostex-generate-title` depends on `ghostex rename-command` being a real
       * gxserver-backed CLI action after the macOS bridge cutover.
       *
       * CDXC:GenerateTitleSkill 2026-06-17-16:17:
       * Claude Code needs generated-title `/rename <title>` submitted by the macOS
       * native Enter event, not zmx carriage-return text. Exercise the dispatcher
       * path used by the public command through the renderer-command endpoint so
       * the CLI cannot regress to staging only.
       */
      const result = await sendGxserverCliAction(
        "renameCommand",
        { sessionId: "G9a", title: "Ghostex Native IME Fix" },
        { server: `http://127.0.0.1:${address.port}`, token: "test-token" },
      );

      expect(result).toMatchObject({ ok: true });
      expect(requests.map((entry) => entry.url)).toEqual([
        "/api/listProjects",
        "/api/listSessions",
        "/api/readPresentationSnapshot",
        "/api/dispatchRendererCommand",
      ]);
      expect(requests[3].body.params).toMatchObject({
        action: "renameCommand",
        payload: {
          projectId: "P1a",
          sessionId: "G9a",
          sessionTarget: {
            projectId: "P1a",
            sessionId: "G9a",
          },
          title: "Ghostex Native IME Fix",
        },
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("rename-command preserves project-scoped targets for renderer lookup", async () => {
    const requests = [];
    const globalRef = "S90:P1a:G9a";
    const server = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push({ body, url: request.url });
      const result =
        request.url === "/api/listProjects"
          ? { projects: [{ name: "Project Alpha", path: "/tmp/project-alpha", projectId: "P1a" }] }
          : request.url === "/api/listSessions"
            ? {
                sessions: [
                  {
                    globalRef,
                    kind: "agent",
                    lifecycleState: "running",
                    projectId: "P1a",
                    sessionId: "G9a",
                    title: "Current Session",
                    zmxName: "S90-P1a-G9a",
                  },
                ],
              }
            : request.url === "/api/readPresentationSnapshot"
              ? { sessions: [] }
              : { ok: true };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        product: "gxserver",
        protocolVersion: 1,
        requestId: "global-rename-command-fixture",
        result,
      }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    try {
      /*
       * CDXC:GxserverRendererCommands 2026-06-21-19:22:
       * Generated-title agents call `ghostex rename-command --session-id S:P:G`
       * from inside the target pane. The CLI must resolve that global ref to
       * raw gxserver ids while still sending a structured target that the
       * renderer can match against combined sidebar presentation ids.
       */
      const result = await execFileAsync(process.execPath, [
        path.resolve("scripts/ghostex-cli.mjs"),
        "rename-command",
        "--session-id",
        globalRef,
        "--title",
        "GPUI Sidebar Resize Parity",
        "--server",
        `http://127.0.0.1:${address.port}`,
        "--token",
        "test-token",
        "--json",
      ]);

      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
      expect(requests.map((entry) => entry.url)).toEqual([
        "/api/listProjects",
        "/api/listSessions",
        "/api/readPresentationSnapshot",
        "/api/dispatchRendererCommand",
      ]);
      expect(requests[3].body.params).toMatchObject({
        action: "renameCommand",
        payload: {
          projectId: "P1a",
          sessionId: "G9a",
          sessionTarget: {
            projectId: "P1a",
            sessionId: "G9a",
          },
          title: "GPUI Sidebar Resize Parity",
        },
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("send-key maps supported keys to gxserver terminal text", async () => {
    const requests = [];
    const server = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push({ body, url: request.url });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        product: "gxserver",
        protocolVersion: 1,
        requestId: "send-key-fixture",
        result: {
          session: {
            kind: "agent",
            lifecycleState: "running",
            projectId: body.params.projectId,
            sessionId: body.params.sessionId,
          },
        },
      }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    try {
      const result = await sendGxserverCliAction(
        "sendKey",
        { key: "arrow-up", projectId: "P1a", sessionId: "G9a" },
        { server: `http://127.0.0.1:${address.port}`, token: "test-token" },
      );

      expect(result).toMatchObject({ ok: true });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        url: "/api/sendSessionText",
        body: {
          params: {
            key: "arrow-up",
            projectId: "P1a",
            sessionId: "G9a",
            text: "\u001b[A",
          },
          protocolVersion: 1,
        },
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("routes renderer-only CLI commands through gxserver renderer endpoint", async () => {
    const requests = [];
    const server = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push({ body, url: request.url });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        product: "gxserver",
        protocolVersion: 1,
        requestId: "renderer-command-fixture",
        result: { ok: true, state: { sidebarCollapsed: true } },
      }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    try {
      /*
       * CDXC:GxserverRendererCommands 2026-06-13-02:24:
       * The CLI must not fall back to the retired native app bridge for visible
       * sidebar commands. It should call gxserver's renderer-command endpoint so
       * the daemon owns auth, protocol, and unavailable-renderer failures.
       */
      const result = await sendGxserverCliAction(
        "toggleSidebarCollapsed",
        {},
        { server: `http://127.0.0.1:${address.port}`, token: "test-token" },
      );

      expect(result).toMatchObject({ ok: true });
      expect(requests).toEqual([
        {
          url: "/api/dispatchRendererCommand",
          body: {
            params: {
              action: "toggleSidebarCollapsed",
              payload: {},
            },
            protocolVersion: 1,
          },
        },
      ]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("keeps every advertised bridge action covered by the gxserver dispatcher", async () => {
    const source = await readFile(path.resolve("scripts/ghostex-cli.mjs"), "utf8");
    const bridgeActions = [
      ...source.matchAll(/\["[^"]+",\s*(?:resolvedSessionBridgeAction|bridgeAction)\("([^"]+)"/g),
    ].map((match) => match[1]);
    const dispatcherSource = source.slice(
      source.indexOf("async function sendGxserverCliAction"),
      source.indexOf("async function fetchGxserverState"),
    );
    const dispatcherActions = new Set(
      [...dispatcherSource.matchAll(/case "([^"]+)":/g)].map((match) => match[1]),
    );
    const missingActions = [...new Set(bridgeActions.filter((action) => !dispatcherActions.has(action)))].sort();

    expect(missingActions).toEqual([]);
  });

  test("hard-fails gxserver protocol mismatch with update guidance", async () => {
    await withGxserverFixture(
      async ({ baseUrl }) => {
        await expect(
          requestGxserverRpc(
            { baseUrl, token: "test-token" },
            "/api/listSessions",
            {},
            { timeoutMs: 1_000 },
          ),
        ).rejects.toThrow(/Update Ghostex and gxserver/);
      },
      {
        body: {
          error: "protocolMismatch",
          message: "gxserver protocol mismatch. Expected protocol 1, got 999. Update Ghostex and gxserver so their protocol versions match.",
          ok: false,
          product: "gxserver",
          protocolVersion: 1,
        },
        status: 426,
      },
    );
  });

  test("reports missing local gxserver with a clear start command", async () => {
    await expect(
      requestGxserverRpc(
        { baseUrl: "http://127.0.0.1:9", token: "test-token" },
        "/api/listSessions",
        {},
        { timeoutMs: 50 },
      ),
    ).rejects.toThrow(/Start it with "gx server start"/);
  });

  test("sessions command does not fall back to persisted macOS sidebar state", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "ghostex-cli-no-sidebar-fallback-"));
    try {
      await mkdir(path.join(home, "state"), { recursive: true });
      await writeFile(
        path.join(home, "state", "native-sidebar-projects.json"),
        JSON.stringify({
          projects: [
            {
              name: "Stale",
              projectId: "Pold",
              workspace: {
                groups: [
                  {
                    snapshot: {
                      sessions: [
                        {
                          sessionId: "Gold",
                          sessionPersistenceName: "stale-zmx",
                          sessionPersistenceProvider: "zmx",
                          title: "Stale sidebar session",
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
      let failed;
      try {
        await execFileAsync(process.execPath, [
          path.resolve("scripts/ghostex-cli.mjs"),
          "sessions",
          "--json",
          "--server",
          "http://127.0.0.1:9",
          "--token",
          "test-token",
          "--timeout-ms",
          "50",
        ], {
          env: {
            ...process.env,
            GHOSTEX_HOME: home,
          },
        });
      } catch (error) {
        failed = error;
      }

      /**
       * CDXC:MobileSessionStatus 2026-06-11-23:52:
       * Mobile session inventory must fail when gxserver is unreachable instead of
       * reading retired macOS sidebar persistence. Stale local JSON can contain
       * old statuses, so returning it would recreate the "macOS app must be open"
       * dependency under a different name.
       */
      expect(failed).toBeTruthy();
      const body = JSON.parse(failed.stdout);
      expect(body.ok).toBe(false);
      expect(body.error).toMatch(/Start it with "gx server start"/);
      expect(failed.stdout).not.toContain("Stale sidebar session");
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  test("plans remote ssh targets and direct trusted-network targets with explicit tokens", async () => {
    /**
     * CDXC:GxserverRemoteCli 2026-05-30-15:25:
     * SSH remote support is a helper plan around a forwarded gxserver listener,
     * while direct/Tailscale targets require explicit auth token material from
     * the credential store or stdin one-shot path. The CLI must not fall back to the
     * retired macOS bridge for remote refs.
     */
    expect(createCliSshForwardPlan({ id: "studio", sshUrl: "ssh://madda@example.test" }, { localPort: 60000 })).toMatchObject({
      baseUrl: "http://127.0.0.1:60000",
      checkCommand: ["ssh", "madda@example.test", "command -v gxserver >/dev/null && gxserver status --json"],
      portForwardCommand: ["ssh", "-N", "-o", "ExitOnForwardFailure=yes", "-L", "60000:127.0.0.1:58744", "madda@example.test"],
      startCommand: ["ssh", "madda@example.test", "gxserver start --background"],
    });
    await expect(resolveGxserverServerTarget({ server: "https://studio.test:58745", token: "token-1" })).resolves.toMatchObject({
      baseUrl: "https://studio.test:58745",
      kind: "direct",
      token: "token-1",
    });
    await expect(
      resolveGxserverServerTarget({
        server: "https://studio.test:58745",
        tokenStdin: true,
        stdinReader: async () => "stdin-token\n",
      }),
    ).resolves.toMatchObject({
      baseUrl: "https://studio.test:58745",
      kind: "direct",
      token: "stdin-token",
    });
    await expect(resolveGxserverServerTarget({ server: "studio" })).rejects.toThrow(/was not found/);
  });

  test("guides remote gxserver one-shot tokens away from argv", async () => {
    await expect(resolveGxserverServerTarget({ server: "https://studio.test:58745" })).rejects.toThrow(/--token-stdin/);
    await expect(resolveGxserverServerTarget({ server: "https://studio.test:58745" })).rejects.toThrow(/process listings/);

    const help = usage();
    expect(help).toContain("--token-stdin");
    expect(help).toContain("legacy remote one-shot only because argv can expose secrets");
  });

  test("starts an SSH tunnel before RPC when no existing forward is listening", async () => {
    /**
     * CDXC:GxserverRemoteCli 2026-05-30-20:18:
     * An SSH profile command must not fetch the forwarded URL until the CLI has
     * checked remote gxserver, started it if needed, spawned the forward, and
     * observed gxserver health through that tunnel.
     */
    const localPort = await reserveTestPort();
    const commands = [];
    let remoteRunning = false;
    let tunnelServer;
    let tunnelChild;

    const result = await requestGxserverRpc(
      {
        baseUrl: `http://127.0.0.1:${localPort}`,
        forwardPlan: createCliSshForwardPlan({ id: "studio", sshUrl: "ssh://madda@example.test" }, { localPort }),
        kind: "ssh",
        profileId: "studio",
        serverId: "S1a",
        token: "test-token",
      },
      "/api/listSessions",
      {},
      {
        sshCommandRunner: async (command, options) => {
          commands.push({ command, phase: options.phase });
          if (options.phase === "start") {
            remoteRunning = true;
            return { stderr: "", stdout: "" };
          }
          return {
            stderr: "",
            stdout: JSON.stringify({
              ok: true,
              product: "gxserver",
              protocolVersion: 1,
              serverId: "S1a",
              state: remoteRunning ? "running" : "stopped",
            }),
          };
        },
        sshTunnelIdleKillMs: 0,
        sshTunnelPollMs: 10,
        sshTunnelReadyTimeoutMs: 1_000,
        sshTunnelSpawner: (command) => {
          commands.push({ command, phase: "forward" });
          tunnelChild = new EventEmitter();
          tunnelChild.killed = false;
          tunnelChild.kill = () => {
            tunnelChild.killed = true;
            tunnelServer?.close();
            tunnelChild.emit("exit", 0, null);
            return true;
          };
          tunnelServer = createGxserverRpcAndHealthFixture({ serverId: "S1a" });
          tunnelServer.listen(localPort, "127.0.0.1");
          return tunnelChild;
        },
        timeoutMs: 1_000,
      },
    );

    expect(result).toMatchObject({ ok: true, requestId: "fixture-request", sessions: [] });
    expect(commands.map((entry) => entry.phase)).toEqual(["check", "start", "check", "forward"]);
    expect(commands.at(-1).command).toContain("ExitOnForwardFailure=yes");
    await sleep(20);
    expect(tunnelChild.killed).toBe(true);
  });

  test("chooses a non-gxserver port for SSH profiles when the local gxserver port is occupied", async () => {
    let localGxserverPortFixture;
    if (await isTestPortAvailable(58744)) {
      localGxserverPortFixture = net.createServer();
      await new Promise((resolve) => localGxserverPortFixture.listen(58744, "127.0.0.1", resolve));
    }
    try {
      const target = await resolveGxserverServerTarget({
        server: "ssh://madda@example.test",
        token: "test-token",
      });

      expect(target.kind).toBe("ssh");
      expect(target.forwardPlan.localPort).not.toBe(58744);
      expect(target.baseUrl).not.toBe("http://127.0.0.1:58744");
    } finally {
      await new Promise((resolve) => localGxserverPortFixture?.close(resolve) ?? resolve());
    }
  });

  test("preserves sidebar project and session order from the inventory", () => {
    const grouped = groupSessionsPreservingSidebarOrder([
      {
        alias: 1,
        projectId: "b",
        projectName: "Beta",
        projectPath: "/beta",
        title: "one",
      },
      {
        alias: 2,
        projectId: "a",
        projectName: "Alpha",
        projectPath: "/alpha",
        title: "two",
      },
      {
        alias: 3,
        projectId: "a",
        projectName: "Alpha",
        projectPath: "/alpha",
        title: "three",
      },
    ]);

    expect(grouped.map((project) => project.projectName)).toEqual(["Beta", "Alpha"]);
    expect(grouped[1]?.sessions.map((session) => session.title)).toEqual(["two", "three"]);
  });

  test("documents JSON action and Android rename forms in help", () => {
    const help = usage();

    expect(help).toContain("android-check [--json]");
    expect(help).toContain("create-session [title] [--input text] [--start] [--project-id id] [--group-id id]");
    expect(help).toContain("wait-for-text <selector> <regex>");
    expect(help).toContain("kill | k <selector|all> [--json]");
    expect(help).toContain("attach | a [selector]");
    expect(help).toContain("attach | a --session-id <id>");
    expect(help).toContain("sleep <selector|all> [--json]");
    expect(help).toContain("wake <selector|all> [--json]");
    expect(help).toContain("(sleep|wake|kill) --session-id <id> [--json]");
    expect(help).toContain("rename-session --session-id <id> --title <title> [--json]");
  });

  test("treats failed bridge JSON replies as failed CLI results", () => {
    /**
     * CDXC:AndroidRemoteSessions 2026-05-17-14:24:
     * Android relies on SSH process exit status for remote focus and rename.
     * Keep the bridge failure predicate tested so `{ ok: false }` and
     * transport-level failures cannot be reported to Android as successful
     * remote actions.
     */
    expect(isFailedCliResult({ ok: false })).toBe(true);
    expect(isFailedCliResult({ bridgeOk: false })).toBe(true);
    expect(isFailedCliResult({ ok: true })).toBe(false);
    expect(isFailedCliResult({})).toBe(false);
  });

  test("treats bridge transport failures as failed CLI results for lifecycle actions", () => {
    /**
     * CDXC:AndroidRemoteSessions 2026-05-17-20:58:
     * Android wake/sleep/kill actions are routed through JSON CLI lifecycle
     * commands. A bridge transport failure must be non-success even if the
     * payload does not contain an explicit `ok: false` command result.
     */
    expect(isFailedCliResult({ bridgeOk: false, error: "bridge unavailable" })).toBe(true);
  });

  test("android readiness settings require zmx persistence", async () => {
    /**
     * CDXC:AndroidConnectionManagement 2026-05-17-18:20:
     * `ghostex android-check --json` is Android's Mac-side release gate. The
     * CLI must fail before bridge attach when Ghostex settings are not actually
     * set to zmx, because Android only supports zmx persistence in this release.
     */
    const home = await mkdtemp(path.join(tmpdir(), "ghostex-android-check-"));
    try {
      const settingsPath = path.join(home, "state", "native-sidebar-settings.json");
      await mkdir(path.dirname(settingsPath), { recursive: true });
      await writeFile(settingsPath, JSON.stringify({ sessionPersistenceProvider: "tmux" }));
      const result = await readAndroidReadinessSettings(settingsPath);

      expect(result).toMatchObject({
        ok: false,
        sessionPersistenceProvider: "tmux",
      });
      expect(result.error).toContain("set Session persistence to zmx");
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  test("android readiness settings normalize zmx provider token", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "ghostex-android-check-"));
    try {
      const settingsPath = path.join(home, "state", "native-sidebar-settings.json");
      await mkdir(path.dirname(settingsPath), { recursive: true });
      await writeFile(settingsPath, JSON.stringify({ sessionPersistenceProvider: " zmx " }));

      await expect(readAndroidReadinessSettings(settingsPath)).resolves.toMatchObject({
        ok: true,
        sessionPersistenceProvider: "zmx",
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  test("strict Android release runner refuses to skip Mac readiness", async () => {
    /**
     * CDXC:AndroidReleaseE2E 2026-05-17-20:57:
     * The default Android release runner is final proof, not a source-only
     * convenience command. It must reject `--skip-mac-check` unless `--local`
     * is also present so final release validation always proves the Mac
     * Ghostex/zmx readiness contract.
     */
    await expect(
      execFileAsync("bash", [
        path.resolve("scripts/ghostex-android-release-readiness.sh"),
        "--skip-mac-check",
      ], {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
        },
      }),
    ).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining("--skip-mac-check requires --local"),
    });
  });

  test("strict Android release runner preflights signing target and device safety before work", async () => {
    /**
     * CDXC:AndroidReleaseE2E 2026-05-17-20:59:
     * The default Android release runner should fail before Mac CLI, Gradle, or
     * adb work when final-proof context is missing. Keep this fast preflight
     * test beside the root CLI contract so strict release validation cannot
     * silently fall back to an unsigned local build or an unsafe device clear.
     */
    await expect(
      execFileAsync("bash", [
        path.resolve("scripts/ghostex-android-release-readiness.sh"),
      ], {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
        },
      }),
    ).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining("Final Ghostex Android release proof requires publish signing"),
    });

    try {
      await execFileAsync("bash", [
        path.resolve("scripts/ghostex-android-release-readiness.sh"),
      ], {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
        },
      });
      throw new Error("strict Android release runner unexpectedly passed without final-proof environment");
    } catch (error) {
      expect(error.stderr).toContain("GHOSTEX_ANDROID_REQUIRE_RELEASE_SIGNING=1");
      expect(error.stderr).toContain("GHOSTEX_ANDROID_SIGNING_STORE_FILE");
      expect(error.stderr).toContain("GHOSTEX_ANDROID_HOST");
      expect(error.stderr).toContain("GHOSTEX_ANDROID_USER");
      expect(error.stderr).toContain("GHOSTEX_ANDROID_CONFIRM_CLEAR_DATA=1");
      expect(error.stdout).not.toContain("ghostex-cli.mjs android-check");
      expect(error.stdout).not.toContain("./gradlew");
    }
  });

  test("strict Android release runner preflights external signing keystore before work", async () => {
    /**
     * CDXC:AndroidReleaseSurface 2026-05-17-21:01:
     * Publish signing material has to be an existing external file. The root
     * runner should reject missing or in-checkout keystore paths before it
     * starts Mac readiness, Gradle builds, signature checks, or device work.
     */
    await expect(
      execFileAsync("bash", [
        path.resolve("scripts/ghostex-android-release-readiness.sh"),
      ], {
        env: strictAndroidReleaseEnv(),
      }),
    ).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining("GHOSTEX_ANDROID_SIGNING_STORE_FILE does not exist"),
    });

    const inCheckoutKeystore = path.resolve("android/.ghostex-release-test-keystore");
    await writeFile(inCheckoutKeystore, "test");
    try {
      await execFileAsync("bash", [
        path.resolve("scripts/ghostex-android-release-readiness.sh"),
      ], {
        env: strictAndroidReleaseEnv({
          GHOSTEX_ANDROID_SIGNING_STORE_FILE: inCheckoutKeystore,
        }),
      });
      throw new Error("strict Android release runner unexpectedly accepted an in-checkout signing file");
    } catch (error) {
      expect(error.code).toBe(2);
      expect(error.stderr).toContain("must live outside the Android checkout");
      expect(error.stdout).not.toContain("ghostex-cli.mjs android-check");
      expect(error.stdout).not.toContain("./gradlew");
    } finally {
      await rm(inCheckoutKeystore, { force: true });
    }
  });
});
