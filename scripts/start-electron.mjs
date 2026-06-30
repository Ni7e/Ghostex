#!/usr/bin/env bun

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hostScriptDir = path.join(repoRoot, "native", "macos", "ghostexHost");
const crossplatformDir = path.join(repoRoot, "crossplatform");
const electronBinary = path.join(crossplatformDir, "node_modules", ".bin", "electron");
const electronAppBinary = path.join(
  crossplatformDir,
  "node_modules",
  "electron",
  "dist",
  "Electron.app",
  "Contents",
  "MacOS",
  "Electron",
);
const protocolVersion = 1;
const gxserverBaseUrl = "http://127.0.0.1:58744";
const startEnvironment = withoutColorDisablingEnvironment(process.env);
const buildEnv = { ...startEnvironment };

/*
CDXC:ElectronLocalStart 2026-06-03-03:04:
`bun run electron` is the Electron equivalent of the native local start command: build the shared T3 assets, refresh the native-staged Web/gxserver package, build the Electron renderer, close only the old Electron shell for this repository, stop stale gxserver when the packaged build identity changed, then launch Electron from the built renderer and return control to the shell.
*/
await run("bun", ["scripts/build-t3code-if-needed.mjs"], { cwd: repoRoot, env: buildEnv });
await run(path.join(hostScriptDir, "build-ghostex-host.sh"), [], { cwd: repoRoot, env: buildEnv });
await run("bun", ["run", "build"], { cwd: crossplatformDir, env: buildEnv });

await closeRunningElectronShell();
await stopRunningGxserverControlPlaneBeforeLaunch();
await launchElectronApp();

async function closeRunningElectronShell() {
  /*
  CDXC:ElectronLocalStart 2026-06-03-03:04:
  Restarting the local Electron app must not kill unrelated Electron apps. Match only the shell binary inside this repository's crossplatform package and wait for it to exit before launching the freshly built renderer.

  CDXC:ElectronLocalStart 2026-06-03-15:36:
  Electron's npm shim starts a real Electron.app child process. Close both the shim and that child so `bun run electron` refreshes the visible app instead of reusing a stale single-instance process.
  */
  const pids = findRunningElectronShellPids();
  if (pids.length === 0) {
    return;
  }

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already exited.
    }
  }

  if (await waitForElectronShellExit(8000)) {
    return;
  }

  for (const pid of findRunningElectronShellPids()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process already exited.
    }
  }

  if (!(await waitForElectronShellExit(2000))) {
    throw new Error("Old Electron shell did not exit, refusing to launch another copy.");
  }
}

async function launchElectronApp() {
  /*
  CDXC:ElectronLocalStart 2026-06-03-13:56:
  The Electron local start command should match `bun run start`: after build and restart prep, it launches the app and exits instead of owning the Electron process lifetime or streaming runtime diagnostics into the invoking terminal.

  CDXC:ElectronLocalStart 2026-06-03-15:36:
  Launch the Electron.app executable directly instead of the npm shim so one detached app process owns the visible window and the restart matcher can close the same binary on the next run.
  */
  if (!existsSync(electronAppBinary)) {
    throw new Error(`Electron app binary is missing at ${electronAppBinary}. Run bun install in crossplatform first.`);
  }
  const child = spawn(electronAppBinary, ["--force-renderer-accessibility", "."], {
    cwd: crossplatformDir,
    detached: true,
    env: buildEnv,
    stdio: "ignore",
  });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", resolve);
  });
  child.unref();
  console.log("Launched Ghostex Electron.");
}

function findRunningElectronShellPids() {
  const result = spawnSync("ps", ["-axo", "pid=,command="], {
    cwd: repoRoot,
    encoding: "utf8",
    env: startEnvironment,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = /^(\d+)\s+(.+)$/.exec(line);
      if (!match) {
        return [];
      }
      const pid = Number(match[1]);
      const command = match[2];
      if (pid === process.pid || !Number.isFinite(pid)) {
        return [];
      }
      const isRepoElectronShim = command.includes(electronBinary);
      const isRepoElectronApp = command.includes(electronAppBinary);
      return (isRepoElectronShim || isRepoElectronApp) && command.includes("--force-renderer-accessibility") ? [pid] : [];
    });
}

async function waitForElectronShellExit(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (findRunningElectronShellPids().length === 0) {
      return true;
    }
    await sleep(100);
  }
  return findRunningElectronShellPids().length === 0;
}

async function stopRunningGxserverControlPlaneBeforeLaunch() {
  const expectedBuildIdentity = readStagedGxserverBuildIdentity();
  if (!expectedBuildIdentity) {
    console.warn("The staged gxserver package has no build identity; stopping any running control plane anyway.");
  }

  const token = readGxserverToken();
  if (!token) {
    return;
  }

  const health = await fetchGxserverJson("/api/health/server", { method: "GET", token });
  if (!health || health.product !== "gxserver") {
    return;
  }

  const actualBuildIdentity = typeof health.buildIdentity === "string" ? health.buildIdentity.trim() : "";
  const buildIdentitySuffix =
    actualBuildIdentity && expectedBuildIdentity && actualBuildIdentity !== expectedBuildIdentity
      ? ` (build identity ${actualBuildIdentity} -> ${expectedBuildIdentity})`
      : "";

  console.log(`Stopping gxserver control plane before opening Electron${buildIdentitySuffix}.`);
  await fetchGxserverJson("/api/control/stop", { method: "POST", token });
  const stopped = await waitForGxserverStop(token, 5000);
  if (!stopped) {
    throw new Error("gxserver stop was requested, but the old control plane is still responding.");
  }
}

function readStagedGxserverBuildIdentity() {
  const identityPath = path.join(hostScriptDir, "Web", "gxserver", "build-identity.json");
  if (!existsSync(identityPath)) {
    return undefined;
  }
  const parsed = JSON.parse(readFileSync(identityPath, "utf8"));
  const buildIdentity = typeof parsed.buildIdentity === "string" ? parsed.buildIdentity.trim() : "";
  return buildIdentity || undefined;
}

function readGxserverToken() {
  const tokenPath = path.join(homedir(), ".ghostex", "gxserver", "auth", "token");
  if (!existsSync(tokenPath)) {
    return undefined;
  }
  const token = readFileSync(tokenPath, "utf8").trim();
  return token || undefined;
}

async function waitForGxserverStop(token, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const health = await fetchGxserverJson("/api/health/server", { method: "GET", token, timeoutMs: 500 });
    if (!health) {
      return true;
    }
    await sleep(100);
  }
  return !(await fetchGxserverJson("/api/health/server", { method: "GET", token, timeoutMs: 500 }));
}

async function fetchGxserverJson(pathname, { method, token, timeoutMs = 1000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${gxserverBaseUrl}${pathname}`, {
      headers: {
        authorization: `Bearer ${token}`,
        "x-gxserver-protocol-version": String(protocolVersion),
      },
      method,
      signal: controller.signal,
    });
    if (!response.ok) {
      return undefined;
    }
    return await response.json();
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || startEnvironment,
    stdio: "inherit",
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (signal) {
        reject(new Error(`${command} exited from ${signal}.`));
        return;
      }
      reject(new Error(`${command} failed with status ${code ?? 1}.`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withoutColorDisablingEnvironment(environment) {
  /*
  CDXC:ElectronLocalStartColorEnv 2026-06-07-00:38:
  Local Electron starts share gxserver and agent-session behavior with native Ghostex. Strip inherited NO_COLOR-style keys before launching build, Electron, and daemon-control subprocesses so desktop sessions remain color-capable.

  CDXC:ElectronLocalStartColorEnv 2026-06-30-22:56:
  Electron-started Factory sessions must not inherit FORCE_COLOR=0 from the launching shell. Remove only disabling FORCE_COLOR values so positive overrides remain available.
  */
  const sanitized = { ...environment };
  for (const key of ["ANSI_COLORS_DISABLED", "NO_COLOR", "NODE_DISABLE_COLORS"]) {
    delete sanitized[key];
  }
  if (isColorDisablingForceColor(sanitized.FORCE_COLOR)) {
    delete sanitized.FORCE_COLOR;
  }
  return sanitized;
}

function isColorDisablingForceColor(value) {
  return typeof value === "string" && ["0", "false"].includes(value.trim().toLowerCase());
}
