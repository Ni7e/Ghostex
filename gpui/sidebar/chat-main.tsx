import { createRoot } from "react-dom/client";
import "../../sidebar/styles.css";
import {
  isSessionChatEventType,
  resolveSessionChatTranscriptAgent,
  type GxserverReadSessionChatResult,
  type GxserverSessionChatEvent,
} from "../../shared/session-chat";
import { GXSERVER_PROTOCOL_VERSION } from "../../shared/gxserver-protocol";
import { SessionChatView } from "../../sidebar/chat/session-chat-view";
import type { SessionChatTransport } from "../../sidebar/chat/session-chat-transport";

/*
CDXC:GPUISessionChatSurface 2026-07-31:
chat.html is the per-session Session Chat CEF surface that swaps with the
terminal pane body in the gpui Agents workspace. It follows the
kanban-main/manage-main minimalism: session identity arrives as URL query
params (projectId/sessionId/agentId), and the gxserver bootstrap
(baseUrl/token/protocolVersion) is installed by Rust on
window.ghostexGpui.gxserverBootstrap through the chat bootstrap process
message. The page owns its own /api/events websocket with
subscribeSessionChat and filters frames client-side, so the sidebar runtime
never proxies chat data. Local sessions only in v1: remote machines have no
direct HTTP path from this page.
*/

interface ChatGxserverBootstrap {
  authToken?: string;
  baseUrl?: string;
  clientId?: string;
  protocolVersion?: number;
}

interface ChatBridgeNamespace {
  gxserverBootstrap?: ChatGxserverBootstrap;
  onGxserverBootstrapChanged?: (bootstrap: ChatGxserverBootstrap) => void;
}

const BOOTSTRAP_RETRY_DELAY_MS = 120;
const BOOTSTRAP_MAX_ATTEMPTS = 250;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

function chatBridgeNamespace(): ChatBridgeNamespace {
  const target = window as unknown as { ghostexGpui?: ChatBridgeNamespace };
  target.ghostexGpui = target.ghostexGpui ?? {};
  return target.ghostexGpui;
}

function validatedBootstrap(
  candidate: ChatGxserverBootstrap | undefined,
): { authToken: string; baseUrl: string } | undefined {
  if (!candidate) {
    return undefined;
  }
  if (
    candidate.protocolVersion !== undefined &&
    candidate.protocolVersion !== GXSERVER_PROTOCOL_VERSION
  ) {
    return undefined;
  }
  const baseUrl = typeof candidate.baseUrl === "string" ? candidate.baseUrl.trim() : "";
  const authToken = typeof candidate.authToken === "string" ? candidate.authToken : "";
  if (!baseUrl || !authToken) {
    return undefined;
  }
  return { authToken, baseUrl };
}

function waitForBootstrap(): Promise<{ authToken: string; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const namespace = chatBridgeNamespace();
    const settle = (bootstrap: { authToken: string; baseUrl: string }) => {
      if (!settled) {
        settled = true;
        resolve(bootstrap);
      }
    };
    namespace.onGxserverBootstrapChanged = (candidate) => {
      const validated = validatedBootstrap(candidate);
      if (validated) {
        settle(validated);
      }
    };
    const poll = (attempt: number): void => {
      if (settled) {
        return;
      }
      const validated = validatedBootstrap(chatBridgeNamespace().gxserverBootstrap);
      if (validated) {
        settle(validated);
        return;
      }
      if (attempt >= BOOTSTRAP_MAX_ATTEMPTS) {
        reject(new Error("The Ghostex server bootstrap did not arrive."));
        return;
      }
      window.setTimeout(() => poll(attempt + 1), BOOTSTRAP_RETRY_DELAY_MS);
    };
    poll(0);
  });
}

async function rpc<TResult>(
  bootstrap: { authToken: string; baseUrl: string },
  path: string,
  params: Record<string, unknown>,
): Promise<TResult> {
  const response = await fetch(`${bootstrap.baseUrl}${path}`, {
    body: JSON.stringify({ params, protocolVersion: GXSERVER_PROTOCOL_VERSION }),
    headers: {
      authorization: `Bearer ${bootstrap.authToken}`,
      "content-type": "application/json",
      "x-gxserver-protocol-version": String(GXSERVER_PROTOCOL_VERSION),
    },
    method: "POST",
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const envelope = body as
    | { error?: { message?: string }; ok?: boolean; result?: TResult }
    | undefined;
  if (!response.ok || !envelope || envelope.ok !== true) {
    const message =
      envelope && typeof envelope.error?.message === "string"
        ? envelope.error.message
        : `gxserver rejected ${path} (${response.status > 0 ? response.status : "no response"}).`;
    throw new Error(message);
  }
  return envelope.result as TResult;
}

function createGpuiSessionChatTransport(
  bootstrap: { authToken: string; baseUrl: string },
  projectId: string,
  sessionId: string,
): SessionChatTransport {
  return {
    async answerPrompt(params) {
      await rpc(bootstrap, "/api/answerSessionChatPrompt", {
        ...params,
        projectId,
        sessionId,
      });
    },
    async interrupt() {
      await rpc(bootstrap, "/api/interruptSessionChat", { projectId, sessionId });
    },
    read(params) {
      return rpc<GxserverReadSessionChatResult>(bootstrap, "/api/readSessionChat", {
        projectId,
        sessionId,
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
        ...(params.beforeOffset !== undefined ? { beforeOffset: params.beforeOffset } : {}),
      });
    },
    async send(text, imagePaths) {
      await rpc(bootstrap, "/api/sendSessionChatMessage", {
        projectId,
        sessionId,
        text,
        ...(imagePaths && imagePaths.length > 0 ? { imagePaths } : {}),
      });
    },
    subscribe({ onEvent }) {
      /*
      Own /api/events socket per subscription: send subscribeSessionChat on
      every open (the server replies with an authoritative snapshot frame
      first), filter broadcast frames client-side by session identity, and
      resubscribe after reconnects with the same snapshot-first contract the
      web connection uses.
      */
      let closed = false;
      let socket: WebSocket | undefined;
      let reconnectAttempt = 0;
      let reconnectTimeoutId: number | undefined;

      const connect = (): void => {
        if (closed) {
          return;
        }
        const url = new URL(`${bootstrap.baseUrl}/api/events`);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("protocolVersion", String(GXSERVER_PROTOCOL_VERSION));
        url.searchParams.set("authToken", bootstrap.authToken);
        const nextSocket = new WebSocket(url.toString());
        socket = nextSocket;
        nextSocket.addEventListener("open", () => {
          reconnectAttempt = 0;
          nextSocket.send(
            JSON.stringify({ projectId, sessionId, type: "subscribeSessionChat" }),
          );
        });
        nextSocket.addEventListener("message", (event) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(String(event.data));
          } catch {
            return;
          }
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return;
          }
          const frame = parsed as Record<string, unknown>;
          if (
            typeof frame.type !== "string" ||
            !isSessionChatEventType(frame.type) ||
            frame.projectId !== projectId ||
            frame.sessionId !== sessionId ||
            typeof frame.epoch !== "number" ||
            typeof frame.seq !== "number" ||
            frame.protocolVersion !== GXSERVER_PROTOCOL_VERSION
          ) {
            return;
          }
          onEvent(frame as unknown as GxserverSessionChatEvent);
        });
        nextSocket.addEventListener("close", () => {
          if (closed || socket !== nextSocket) {
            return;
          }
          const delay =
            RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
          reconnectAttempt += 1;
          reconnectTimeoutId = window.setTimeout(connect, delay);
        });
        nextSocket.addEventListener("error", () => {
          if (socket === nextSocket) {
            nextSocket.close();
          }
        });
      };
      connect();

      return () => {
        closed = true;
        if (reconnectTimeoutId !== undefined) {
          window.clearTimeout(reconnectTimeoutId);
          reconnectTimeoutId = undefined;
        }
        const activeSocket = socket;
        socket = undefined;
        if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
          try {
            activeSocket.send(
              JSON.stringify({ projectId, sessionId, type: "unsubscribeSessionChat" }),
            );
          } catch {
            // Socket teardown races are fine; the server refcounts followers.
          }
        }
        activeSocket?.close();
      };
    },
  };
}

function renderFailure(root: ReturnType<typeof createRoot>, message: string): void {
  root.render(
    <div className="native-sidebar-shell gpui-session-chat">
      <div className="ghostex-chat-empty-state">
        <div className="ghostex-chat-empty-title">Chat unavailable</div>
        <div className="ghostex-chat-empty-detail">{message}</div>
      </div>
    </div>,
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Ghostex session chat root element was not found.");
}
document.body.dataset.sidebarTheme = "plain-dark";
document.body.classList.add("vscode-dark", "native-sidebar-body");

const root = createRoot(rootElement);
const searchParams = new URLSearchParams(window.location.search);
const projectId = searchParams.get("projectId")?.trim() ?? "";
const sessionId = searchParams.get("sessionId")?.trim() ?? "";
const agentId = searchParams.get("agentId")?.trim() ?? "";

if (!projectId || !sessionId) {
  renderFailure(root, "This chat surface was opened without a session identity.");
} else {
  waitForBootstrap()
    .then((bootstrap) => {
      const transport = createGpuiSessionChatTransport(bootstrap, projectId, sessionId);
      const agentLabel = agentId
        ? resolveSessionChatTranscriptAgent(agentId) ?? agentId
        : null;
      root.render(
        <div className="native-sidebar-shell gpui-session-chat">
          <SessionChatView
            agentLabel={agentLabel}
            className="gpui-session-chat-view"
            transport={transport}
          />
        </div>,
      );
    })
    .catch(() => {
      renderFailure(
        root,
        "The local Ghostex server is not reachable from this window. Toggle back to the terminal and try again.",
      );
    });
}
