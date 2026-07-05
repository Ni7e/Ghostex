#!/usr/bin/env bun

import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const gpuiDir = path.join(repoRoot, "gpui");
const appName = "GhostexGPUI";
const bundleId = "com.madda.ghostex.gpui";
const isDarwin = process.platform === "darwin";
/*
CDXC:GPUIStartCommand 2026-07-06:
`bun run gpui` now covers Linux with the same one-command contract: build the
staged flat app via build-linux-app.sh, close only the matching staged GPUI
binaries (main app + CEF helper; the app-owned gxserver daemon and its zmx
sessions deliberately stay alive so the relaunched app reattaches), and launch
the staged executable detached. macOS keeps the app-bundle/lockf/osascript
flow unchanged.
*/
const appPath = isDarwin
  ? path.join(gpuiDir, "build", "macos", `${appName}.app`)
  : path.join(gpuiDir, "build", "linux", appName);
const appContentsPrefix = path.join(appPath, "Contents") + path.sep;
const linuxAppBinaryPrefix = path.join(appPath, "ghostex-gpui");
const linuxAppExecutable = path.join(appPath, "ghostex-gpui");
const buildScript = path.join(
  gpuiDir,
  "scripts",
  isDarwin ? "build-macos-app.sh" : "build-linux-app.sh",
);
const localStartLockFile = path.join(repoRoot, "build", "ghostex-gpui-local-start.lock");
const referencesRoot = path.resolve(gpuiDir, "..", "..", "..", "_references");
const customReferencesRoot = path.resolve(referencesRoot, "..", "custom");
const startEnvironment = process.env;

validateStartArguments(process.argv.slice(2));
ensureSupportedHost();
reexecUnderLocalStartLock();
ensureLocalReferenceCheckouts();
await closeRunningGpuiBundle();
run("/bin/bash", [buildScript]);
if (!existsSync(appPath)) {
  throw new Error(`Built GPUI app is missing at ${appPath}.`);
}
launchGpuiApp();

function validateStartArguments(args) {
  for (const arg of args) {
    if (arg === "--") {
      continue;
    }
    throw new Error(`Unknown GPUI start argument: ${arg}. Use "bun run gpui".`);
  }
}

function ensureSupportedHost() {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new Error("The GPUI local app currently runs on macOS and Linux only.");
  }
}

function reexecUnderLocalStartLock() {
  /*
  CDXC:GPUIStartCommand 2026-06-21-18:43:
  `bun run gpui` must be the GPUI equivalent of the macOS local start command: one root command builds the local CEF/GPUI bundle, prevents overlapping rebuilds, closes only the matching GPUI bundle before replacing it, and launches the rebuilt app without using Cua Driver or the main Ghostex start path.

  CDXC:GPUIStartCommand 2026-06-21-18:54:
  The GPUI manifest intentionally patches Zed, cef-rs, and gpui-component through a shared `_references` folder so the port builds against inspected local codebases. The start command may materialize missing reference entries as symlinks to existing `/Users/madda/dev/custom` checkouts, but it must not overwrite a present path because reference repos can contain user or agent work.
  */
  if (process.env.GHOSTEX_GPUI_START_LOCK_HELD === "1") {
    return;
  }
  mkdirSync(path.dirname(localStartLockFile), { recursive: true });
  // lockf(1) is macOS/BSD; flock(1) is the util-linux equivalent.
  const [lockCommand, ...lockArgs] = isDarwin
    ? ["/usr/bin/lockf", "-k", localStartLockFile]
    : ["flock", localStartLockFile];
  const result = spawnSync(
    lockCommand,
    [...lockArgs, process.execPath, scriptPath, ...process.argv.slice(2)],
    {
      cwd: repoRoot,
      env: { ...process.env, GHOSTEX_GPUI_START_LOCK_HELD: "1" },
      stdio: "inherit",
    },
  );
  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? 1);
}

function ensureLocalReferenceCheckouts() {
  mkdirSync(referencesRoot, { recursive: true });
  ensureReferenceCheckout({
    name: "zed",
    requiredRelativePath: path.join("crates", "gpui", "Cargo.toml"),
  });
  ensureReferenceCheckout({
    name: "cef-rs",
    requiredRelativePath: path.join("cef", "Cargo.toml"),
  });
  ensureReferenceCheckout({
    name: "gpui-component",
    requiredRelativePath: path.join("crates", "ui", "Cargo.toml"),
  });
}

function ensureReferenceCheckout({ name, requiredRelativePath }) {
  const expectedPath = path.join(referencesRoot, name);
  const expectedRequiredPath = path.join(expectedPath, requiredRelativePath);
  if (existsSync(expectedRequiredPath)) {
    return;
  }

  if (pathExistsWithoutFollowingFinalSymlink(expectedPath)) {
    throw new Error(
      `GPUI reference ${expectedPath} exists, but ${expectedRequiredPath} is missing. Refusing to overwrite it; fix or replace that reference checkout manually.`,
    );
  }

  const sourcePath = path.join(customReferencesRoot, name);
  const sourceRequiredPath = path.join(sourcePath, requiredRelativePath);
  if (!existsSync(sourceRequiredPath)) {
    throw new Error(
      `Missing GPUI reference ${expectedPath}. Expected ${sourceRequiredPath} to exist so it could be linked into ${referencesRoot}.`,
    );
  }

  symlinkSync(sourcePath, expectedPath, "dir");
  console.log(`Linked ${expectedPath} -> ${sourcePath}`);
}

function pathExistsWithoutFollowingFinalSymlink(candidatePath) {
  try {
    lstatSync(candidatePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function closeRunningGpuiBundle() {
  /*
  CDXC:GPUIStartCommand 2026-06-25-13:56:
  The local GPUI rebuild command must fully close the exact dev bundle before replacing it. If AppleScript quit and SIGTERM leave a stale or slow GPUI process alive, escalate to SIGKILL and still verify the bundle has exited before building.
  */
  let pids = findRunningGpuiBundlePids();
  if (pids.length === 0) {
    return;
  }

  console.log(`Closing running ${appName} before rebuilding ${appPath}.`);
  if (isDarwin) {
    run("osascript", ["-e", `tell application id "${bundleId}" to quit`], {
      allowFailure: true,
      stdio: "ignore",
    });
    if (await waitForGpuiBundleExit(8000)) {
      return;
    }
  }

  pids = findRunningGpuiBundlePids();
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {
      // Process already exited.
    }
  }
  if (await waitForGpuiBundleExit(8000)) {
    return;
  }

  pids = findRunningGpuiBundlePids();
  console.log(`Force closing ${appName} before rebuilding ${appPath}.`);
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGKILL");
    } catch {
      // Process already exited.
    }
  }
  if (!(await waitForGpuiBundleExit(2000))) {
    throw new Error(`${appName} did not exit, refusing to rebuild ${appPath} while it is still running.`);
  }
}

async function waitForGpuiBundleExit(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (findRunningGpuiBundlePids().length === 0) {
      return true;
    }
    await sleep(100);
  }
  return findRunningGpuiBundlePids().length === 0;
}

function findRunningGpuiBundlePids() {
  return uniquePids([...findRunningGpuiPidsByBundleId(), ...findRunningGpuiPidsByBundlePath()]);
}

function findRunningGpuiPidsByBundleId() {
  if (!isDarwin) {
    return [];
  }
  const result = spawnSync("osascript", [
    "-e",
    `tell application "System Events" to get the unix id of every process whose bundle identifier is "${bundleId}"`,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: startEnvironment,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }
  return parsePidList(result.stdout);
}

function findRunningGpuiPidsByBundlePath() {
  const result = spawnSync("ps", ["-axo", "pid=,args=", "-ww"], {
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
    .map((line) => line.match(/^\s*(\d+)\s+(.+)$/))
    .filter((match) => match && commandLineBelongsToGpuiBundle(match[2]))
    .map((match) => match[1]);
}

function commandLineBelongsToGpuiBundle(commandLine) {
  if (isDarwin) {
    return commandLine.startsWith(appContentsPrefix);
  }
  // Flat Linux layout: match only the staged app binaries (ghostex-gpui and
  // ghostex-gpui-cef-helper). The staged gxserver daemon and zmx sessions
  // live under the same directory and must survive a rebuild.
  return commandLine.startsWith(linuxAppBinaryPrefix);
}

function launchGpuiApp() {
  if (isDarwin) {
    run("open", ["-n", appPath]);
    return;
  }
  const child = spawn(linuxAppExecutable, [], {
    cwd: appPath,
    env: startEnvironment,
    detached: true,
    stdio: "ignore",
  });
  child.on("error", (error) => {
    throw error;
  });
  child.unref();
  console.log(`Launched ${linuxAppExecutable} (pid ${child.pid}).`);
}

function parsePidList(value) {
  return value
    .split(/[,\s]+/)
    .map((pid) => pid.trim())
    .filter(Boolean);
}

function uniquePids(pids) {
  return [...new Set(pids)];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: startEnvironment,
    stdio: options.stdio ?? "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}.`);
  }
  return result;
}
