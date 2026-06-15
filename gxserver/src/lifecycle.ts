import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  GXSERVER_LOCAL_API_HOST,
  GXSERVER_PRODUCT,
  GXSERVER_PROTOCOL_VERSION,
  type GxserverStatusResponse,
} from "../protocol/index.js";
import { readGxserverLocalApiPort } from "./constants.js";
import { readGxserverAuthToken } from "./auth.js";
import { isGxserverBuildIdentityReusable } from "./build-identity.js";
import { fetchServerHealth, requestServerStop, requestServerStopAll } from "./http-client.js";
import { assertSupportedNodeVersion } from "./node-version.js";
import { getGxserverPaths } from "./paths.js";
import { createRunningStatus, createStoppedStatus, isProcessRunning, readRuntimeMetadata } from "./runtime.js";

export interface LifecycleOptions {
  buildIdentity?: string;
  homeDir?: string;
  version: string;
}

export async function getGxserverStatus(options: LifecycleOptions): Promise<GxserverStatusResponse> {
  assertSupportedNodeVersion();
  const paths = getGxserverPaths(options.homeDir);
  const metadata = await readRuntimeMetadata(paths);
  const auth = await readGxserverAuthToken(paths);
  const health = await fetchServerHealth({ token: auth?.token });
  if (health) {
    return createRunningStatus(health, metadata);
  }
  if (metadata && isProcessRunning(metadata.pid)) {
    return {
      metadata,
      message: `gxserver runtime metadata exists for pid ${metadata.pid}, but 127.0.0.1:${readGxserverLocalApiPort()} is unreachable.`,
      ok: false,
      product: GXSERVER_PRODUCT,
      state: "unreachable",
    };
  }
  return createStoppedStatus(metadata);
}

export async function startGxserverBackground(options: LifecycleOptions): Promise<GxserverStatusResponse> {
  assertSupportedNodeVersion();
  const before = await getGxserverStatus(options);
  if (before.state === "running") {
    if (isGxserverBuildIdentityReusable(before.health?.buildIdentity, options.buildIdentity)) {
      return before;
    }
    /*
    CDXC:GxserverLifecycle 2026-06-07-13:32:
    `gxserver start` after an app update must not keep an older same-protocol daemon alive. Stop only the control plane on a definite build-identity mismatch so the replacement daemon runs the current migration and repair code without killing zmx provider sessions.
    */
    const paths = getGxserverPaths(options.homeDir);
    const auth = await readGxserverAuthToken(paths);
    await requestServerStop({ token: auth?.token, timeoutMs: 2000 });
    const stopped = await waitForStopped(options, 5000);
    if (stopped.state === "running") {
      if (isGxserverBuildIdentityReusable(stopped.health?.buildIdentity, options.buildIdentity)) {
        return stopped;
      }
      return {
        ...before,
        message:
          "gxserver build identity changed, but the old control plane did not stop. Stop gxserver and start it again so the current migration code can run.",
        ok: false,
        state: "stopping",
      };
    }
  }

  const cliPath = fileURLToPath(import.meta.url).replace(/lifecycle\.js$/, "cli.js");
    const child = spawn(process.execPath, [cliPath, "--foreground"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  const status = await waitForRunning(options, 5000);
  if (status.state !== "running") {
    return {
      message: `gxserver start launched pid ${child.pid ?? "unknown"} but health did not become ready on ${GXSERVER_LOCAL_API_HOST}:${readGxserverLocalApiPort()}.`,
      ok: false,
      product: GXSERVER_PRODUCT,
      state: "starting",
    };
  }
  return status;
}

export async function stopGxserverControlPlane(options: LifecycleOptions): Promise<GxserverStatusResponse> {
  assertSupportedNodeVersion();
  const before = await getGxserverStatus(options);
  if (before.state !== "running") {
    return before;
  }
  const paths = getGxserverPaths(options.homeDir);
  const auth = await readGxserverAuthToken(paths);
  await requestServerStop({ token: auth?.token });
  const stopped = await waitForStopped(options, 5000);
  if (stopped.state === "running") {
    return {
      ...stopped,
      message: "gxserver stop requested control-plane shutdown, but the server is still running.",
      ok: false,
      state: "stopping",
    };
  }
  return {
    ...stopped,
    message: "gxserver control plane stopped. zmx sessions were not signaled or killed.",
    ok: true,
  };
}

export async function stopGxserverAndZmxSessions(options: LifecycleOptions): Promise<GxserverStatusResponse> {
  assertSupportedNodeVersion();
  const before = await getGxserverStatus(options);
  if (before.state !== "running") {
    return before;
  }
  const paths = getGxserverPaths(options.homeDir);
  const auth = await readGxserverAuthToken(paths);
  /*
  CDXC:GxserverCli 2026-06-02-18:45:
  `gxserver stop-all` is the explicit destructive shutdown path. Unlike
  `gxserver stop`, it asks the daemon to kill tracked zmx provider sessions
  before stopping the control plane so users can intentionally clear the whole
  Ghostex backend runtime without relying on external zmx commands.
  */
  const stopAll = await requestServerStopAll({ token: auth?.token });
  if (!stopAll) {
    return {
      ...before,
      message: "gxserver stop-all could not kill zmx sessions before shutdown.",
      ok: false,
      state: "stopping",
    };
  }
  const stopped = await waitForStopped(options, 10_000);
  if (stopped.state === "running") {
    return {
      ...stopped,
      message: "gxserver stop-all killed zmx sessions but the control plane is still running.",
      ok: false,
      state: "stopping",
    };
  }
  const result = isObjectRecord(stopAll.result) ? stopAll.result : {};
  const killed = Number(result.killedSessions ?? 0);
  const failed = Number(result.failedSessions ?? 0);
  return {
    ...stopped,
    message: `gxserver control plane stopped after stop-all. zmx sessions killed: ${killed}; failed: ${failed}.`,
    ok: failed === 0,
  };
}

export function isCompatibleProtocolVersion(protocolVersion: unknown): boolean {
  return protocolVersion === GXSERVER_PROTOCOL_VERSION;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function waitForRunning(options: LifecycleOptions, timeoutMs: number): Promise<GxserverStatusResponse> {
  return waitForStatus(options, timeoutMs, (status) => status.state === "running");
}

async function waitForStopped(options: LifecycleOptions, timeoutMs: number): Promise<GxserverStatusResponse> {
  return waitForStatus(options, timeoutMs, (status) => status.state !== "running");
}

async function waitForStatus(
  options: LifecycleOptions,
  timeoutMs: number,
  done: (status: GxserverStatusResponse) => boolean,
): Promise<GxserverStatusResponse> {
  const deadline = Date.now() + timeoutMs;
  let status = await getGxserverStatus(options);
  while (!done(status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    status = await getGxserverStatus(options);
  }
  return status;
}
