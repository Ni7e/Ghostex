import {
  GXSERVER_LOCAL_API_HOST,
  GXSERVER_PRODUCT,
  GXSERVER_PROTOCOL_VERSION,
  type GxserverAuthToken,
  type GxserverProtocolMismatch,
  type GxserverServerHealthResponse,
} from "../protocol/index.js";
import { GXSERVER_PROTOCOL_HEADER } from "./api.js";
import { readGxserverLocalApiPort } from "./constants.js";

export class GxserverProtocolMismatchError extends Error {
  readonly mismatch: GxserverProtocolMismatch;

  constructor(actualProtocolVersion: unknown) {
    const mismatch: GxserverProtocolMismatch = {
      actualProtocolVersion,
      expectedProtocolVersion: GXSERVER_PROTOCOL_VERSION,
      message: `gxserver protocol mismatch. Expected protocol ${GXSERVER_PROTOCOL_VERSION}, got ${String(
        actualProtocolVersion,
      )}. Update Ghostex and gxserver so their protocol versions match.`,
      product: GXSERVER_PRODUCT,
    };
    super(mismatch.message);
    this.name = "GxserverProtocolMismatchError";
    this.mismatch = mismatch;
  }
}

export async function fetchServerHealth(options: {
  token?: GxserverAuthToken;
  timeoutMs?: number;
} = {}): Promise<GxserverServerHealthResponse | undefined> {
  const response = await fetchLocalJson("/api/health/server", {
    method: "GET",
    timeoutMs: options.timeoutMs ?? 800,
    token: options.token,
  });
  if (!response) {
    return undefined;
  }
  if (response.product !== GXSERVER_PRODUCT) {
    return undefined;
  }
  if (response.protocolVersion !== GXSERVER_PROTOCOL_VERSION) {
    throw new GxserverProtocolMismatchError(response.protocolVersion);
  }
  return response as unknown as GxserverServerHealthResponse;
}

export async function requestServerStop(options: {
  token?: GxserverAuthToken;
  timeoutMs?: number;
} = {}): Promise<boolean> {
  const response = await fetchLocalJson("/api/control/stop", {
    method: "POST",
    timeoutMs: options.timeoutMs ?? 800,
    token: options.token,
  });
  return Boolean(response?.ok);
}

export async function requestServerStopAll(options: {
  token?: GxserverAuthToken;
  timeoutMs?: number;
} = {}): Promise<Record<string, unknown> | undefined> {
  const response = await fetchLocalJson("/api/control/stopAll", {
    method: "POST",
    timeoutMs: options.timeoutMs ?? 10_000,
    token: options.token,
  });
  return response?.ok === true ? response : undefined;
}

async function fetchLocalJson(
  path: "/api/health/server" | "/api/control/stop" | "/api/control/stopAll",
  options: { method: "GET" | "POST"; timeoutMs: number; token?: GxserverAuthToken },
): Promise<Record<string, unknown> | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(`http://${GXSERVER_LOCAL_API_HOST}:${readGxserverLocalApiPort()}${path}`, {
      headers: {
        [GXSERVER_PROTOCOL_HEADER]: String(GXSERVER_PROTOCOL_VERSION),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      method: options.method,
      signal: controller.signal,
    });
    if (!response.ok) {
      return undefined;
    }
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
