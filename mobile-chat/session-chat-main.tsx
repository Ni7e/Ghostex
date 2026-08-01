import { createRoot } from "react-dom/client";
import "../sidebar/styles.css";
import {
  resolveSessionChatTranscriptAgent,
  type GxserverReadSessionChatResult,
  type GxserverSessionChatSnapshotEvent,
} from "../shared/session-chat";
import { GXSERVER_PROTOCOL_VERSION } from "../shared/gxserver-protocol";
import { SessionChatView } from "../sidebar/chat/session-chat-view";
import type { SessionChatTransport } from "../sidebar/chat/session-chat-transport";

/*
CDXC:SessionChatMobileWebview 2026-07-31:
Session Chat page for the React Native app, bundled by
scripts/build-mobile-chat.mjs into one self-contained HTML string the app
loads in a react-native-webview. It mounts the same shared SessionChatView as
gpui's chat.html and the web app; only the transport differs. The phone has
no HTTP path to gxserver (SSH only), so every transport call crosses a
postMessage bridge to React Native, which SSH-execs the matching `ghostex
session-chat` CLI verb on the machine. Live updates come from this page's own
long-poll loop (readSessionChat --wait-ms/--fingerprint) re-emitted as
synthetic sessionChatSnapshot frames; the RN side stays a dumb verb runner so
all chat behavior lives in shared code.

Bridge contract (mirrored by mobile/src/chat/session-chat-bridge.ts):
- page → RN: window.ReactNativeWebView.postMessage(JSON.stringify(
    { id, op: "read" | "send" | "answerPrompt" | "interrupt", params }))
- RN → page: window.ghostexMobileChatDeliver({ id, ok, result?, error? })
- RN config (injected before content loads):
  window.__ghostexMobileChatConfig = { agentId? }
*/

interface MobileChatConfig {
  agentId?: string;
}

interface BridgeResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

type BridgeOp = "read" | "send" | "answerPrompt" | "interrupt";

const CONFIG_RETRY_DELAY_MS = 100;
const CONFIG_MAX_ATTEMPTS = 100;
const BRIDGE_CALL_TIMEOUT_MS = 90_000;
const LONG_POLL_WAIT_MS = 20_000;
const SUBSCRIBE_ERROR_RETRY_MS = 3_000;
/*
A daemon older than the fingerprint long-poll answers reads immediately and
without a fingerprint. Pacing those iterations is a hot-loop guard for that
version skew, not a feature fallback: chat still works, at plain-poll latency,
until the machine's Ghostex is updated.
*/
const NO_FINGERPRINT_POLL_DELAY_MS = 3_000;

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void };
    ghostexMobileChatDeliver?: (response: BridgeResponse) => void;
    __ghostexMobileChatConfig?: MobileChatConfig;
  }
}

const pendingCalls = new Map<
  number,
  { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: number }
>();
let nextCallId = 1;

window.ghostexMobileChatDeliver = (response) => {
  const entry = pendingCalls.get(response?.id);
  if (!entry) {
    return;
  }
  pendingCalls.delete(response.id);
  window.clearTimeout(entry.timer);
  if (response.ok) {
    entry.resolve(response.result);
  } else {
    entry.reject(new Error(response.error || "The Ghostex bridge call failed."));
  }
};

function bridgeCall<TResult>(op: BridgeOp, params?: Record<string, unknown>): Promise<TResult> {
  return new Promise<TResult>((resolve, reject) => {
    const host = window.ReactNativeWebView;
    if (!host) {
      reject(new Error("This chat page is not hosted by the Ghostex app."));
      return;
    }
    const id = nextCallId;
    nextCallId += 1;
    const timer = window.setTimeout(() => {
      pendingCalls.delete(id);
      reject(new Error("The Ghostex bridge call timed out."));
    }, BRIDGE_CALL_TIMEOUT_MS);
    pendingCalls.set(id, {
      reject,
      resolve: (result) => resolve(result as TResult),
      timer,
    });
    host.postMessage(JSON.stringify({ id, op, params: params ?? {} }));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function snapshotEventFromRead(
  result: GxserverReadSessionChatResult,
): GxserverSessionChatSnapshotEvent {
  return {
    beforeOffset: result.beforeOffset,
    epoch: result.epoch,
    hasMore: result.hasMore,
    // The RN host scopes the whole bridge to one session, so identity fields
    // are placeholders the (already pre-filtered) transport never checks.
    projectId: "",
    sessionId: "",
    protocolVersion: GXSERVER_PROTOCOL_VERSION,
    seq: result.seq,
    serverId: "",
    type: "sessionChatSnapshot",
    messages: result.messages,
    ...(result.lifecycle !== undefined ? { lifecycle: result.lifecycle } : {}),
    ...(result.prompt !== undefined ? { prompt: result.prompt } : {}),
    ...(result.agentSessionId !== undefined
      ? { agentSessionId: result.agentSessionId }
      : {}),
    status: result.status,
  };
}

function createMobileSessionChatTransport(): SessionChatTransport {
  return {
    async answerPrompt(params) {
      await bridgeCall("answerPrompt", params as unknown as Record<string, unknown>);
    },
    async interrupt() {
      await bridgeCall("interrupt");
    },
    read(params) {
      return bridgeCall<GxserverReadSessionChatResult>("read", {
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
        ...(params.beforeOffset !== undefined ? { beforeOffset: params.beforeOffset } : {}),
      });
    },
    async send(text, imagePaths) {
      await bridgeCall("send", {
        text,
        ...(imagePaths && imagePaths.length > 0 ? { imagePaths } : {}),
      });
    },
    subscribe({ onEvent }) {
      let stopped = false;
      void (async () => {
        let fingerprint: string | undefined;
        let emitted = false;
        while (!stopped) {
          let result: GxserverReadSessionChatResult;
          try {
            result = await bridgeCall<GxserverReadSessionChatResult>("read", {
              ...(fingerprint !== undefined
                ? { fingerprint, waitMs: LONG_POLL_WAIT_MS }
                : {}),
            });
          } catch {
            if (!stopped) {
              await sleep(SUBSCRIBE_ERROR_RETRY_MS);
            }
            continue;
          }
          if (stopped) {
            return;
          }
          const changed = result.fingerprint === undefined || result.fingerprint !== fingerprint;
          fingerprint = result.fingerprint;
          if (changed || !emitted) {
            emitted = true;
            onEvent(snapshotEventFromRead(result));
          }
          if (result.fingerprint === undefined) {
            await sleep(NO_FINGERPRINT_POLL_DELAY_MS);
          }
        }
      })();
      return () => {
        stopped = true;
      };
    },
  };
}

function waitForConfig(): Promise<MobileChatConfig> {
  return new Promise((resolve) => {
    const poll = (attempt: number): void => {
      const config = window.__ghostexMobileChatConfig;
      if (config && typeof config === "object") {
        resolve(config);
        return;
      }
      if (attempt >= CONFIG_MAX_ATTEMPTS) {
        resolve({});
        return;
      }
      window.setTimeout(() => poll(attempt + 1), CONFIG_RETRY_DELAY_MS);
    };
    poll(0);
  });
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Ghostex session chat root element was not found.");
}
document.body.dataset.sidebarTheme = "plain-dark";
document.body.classList.add("vscode-dark", "native-sidebar-body");

const root = createRoot(rootElement);
void waitForConfig().then((config) => {
  const agentId = config.agentId?.trim() ?? "";
  const agentLabel = agentId ? resolveSessionChatTranscriptAgent(agentId) ?? agentId : null;
  root.render(
    <div className="native-sidebar-shell gpui-session-chat">
      <SessionChatView
        agentLabel={agentLabel}
        className="gpui-session-chat-view"
        transport={createMobileSessionChatTransport()}
      />
    </div>,
  );
});
