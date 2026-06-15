/*
CDXC:GxserverLifecycle 2026-05-30-14:04:
gxserver milestone 1 uses Node 22 LTS or newer and a fixed local API port of 58744 because the existing macOS bridge owns 58743. Standalone/server installs report missing or old system Node clearly, while the macOS app bundles its own runtime.

CDXC:GxserverLifecycle 2026-06-08-12:17:
The macOS app reuses code-server's bundled Node 22 runtime for gxserver so users do not need a system Node install before local session restore, Project board, or sidebar control-plane features can start.
*/

import {
  GXSERVER_LOCAL_API_HOST,
  GXSERVER_LOCAL_API_PORT,
  GXSERVER_MACOS_BRIDGE_PORT,
  GXSERVER_PRODUCT,
  GXSERVER_PROTOCOL_VERSION,
  GXSERVER_REMOTE_API_HOST,
  GXSERVER_REMOTE_API_PORT,
} from "../protocol/index.js";

export {
  GXSERVER_LOCAL_API_HOST,
  GXSERVER_LOCAL_API_PORT,
  GXSERVER_MACOS_BRIDGE_PORT,
  GXSERVER_PRODUCT,
  GXSERVER_PROTOCOL_VERSION,
  GXSERVER_REMOTE_API_HOST,
  GXSERVER_REMOTE_API_PORT,
};

export const GXSERVER_MIN_NODE_MAJOR = 22;
export const GXSERVER_NODE_INSTALL_URL = "https://nodejs.org/en/download";
export const GXSERVER_DEV_LOCAL_API_PORT_ENV = "GHOSTEX_GXSERVER_DEV_PORT";
export const GXSERVER_CONTROL_PLANE_CAPABILITIES = [
  "health",
  "events",
  "localFullApi",
  "remoteLimitedApi",
  "strictProtocolVersion",
] as const;

export function readGxserverLocalApiPort(): number {
  /*
  CDXC:GxserverRustPort 2026-06-14-21:58:
  Rust-port compatibility may explicitly select a non-product loopback port while the packaged daemon owns 58744. Keep the protocol constant as the product default and require the dev-scoped environment variable to opt into any alternate local port.
  */
  const rawPort = process.env[GXSERVER_DEV_LOCAL_API_PORT_ENV];
  if (rawPort === undefined || rawPort.trim() === "") {
    return GXSERVER_LOCAL_API_PORT;
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${GXSERVER_DEV_LOCAL_API_PORT_ENV} must be an integer from 1 to 65535.`);
  }
  return port;
}
