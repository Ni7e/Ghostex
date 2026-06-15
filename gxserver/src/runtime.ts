import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  GXSERVER_PRODUCT,
  GXSERVER_PROTOCOL_VERSION,
  type GxserverRuntimeMetadata,
  type GxserverServerHealthResponse,
  type GxserverStatusResponse,
} from "../protocol/index.js";
import { readGxserverLocalApiPort } from "./constants.js";
import type { GxserverPaths } from "./paths.js";

export async function writeRuntimeMetadata(
  paths: GxserverPaths,
  metadata: GxserverRuntimeMetadata,
): Promise<void> {
  await mkdir(paths.runtimeDir, { recursive: true });
  await writeFile(paths.runtimeMetadataFile, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
}

export async function readRuntimeMetadata(paths: GxserverPaths): Promise<GxserverRuntimeMetadata | undefined> {
  try {
    const parsed = JSON.parse(await readFile(paths.runtimeMetadataFile, "utf8")) as Partial<GxserverRuntimeMetadata>;
    if (
      typeof parsed.buildIdentity === "string" &&
      typeof parsed.pid === "number" &&
      parsed.port === readGxserverLocalApiPort() &&
      parsed.protocolVersion === GXSERVER_PROTOCOL_VERSION &&
      typeof parsed.serverId === "string" &&
      typeof parsed.startedAt === "string" &&
      typeof parsed.version === "string"
    ) {
      return parsed as GxserverRuntimeMetadata;
    }
    return undefined;
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function removeRuntimeMetadata(paths: GxserverPaths): Promise<void> {
  await rm(paths.runtimeMetadataFile, { force: true });
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
  }
}

export function createRunningStatus(
  health: GxserverServerHealthResponse,
  metadata?: GxserverRuntimeMetadata,
): GxserverStatusResponse {
  return {
    health,
    metadata,
    message: `gxserver is running on 127.0.0.1:${health.port}.`,
    ok: true,
    product: GXSERVER_PRODUCT,
    state: "running",
  };
}

export function createStoppedStatus(metadata?: GxserverRuntimeMetadata): GxserverStatusResponse {
  return {
    metadata,
    message: metadata ? "gxserver is not running; runtime metadata is stale." : "gxserver is not running.",
    ok: true,
    product: GXSERVER_PRODUCT,
    state: metadata ? "stale" : "stopped",
  };
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
