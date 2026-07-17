import type { OpenAppModalMessage } from "@/sidebar/app-modal-host-bridge";
import type { OpenRecentProjectsModalDetail } from "./action-events";

type OpenRecentProjectsModalMessage = Extract<
  OpenAppModalMessage,
  { modal: "recentProjects" }
>;

export function installWebAppModalHostShim(): void {
  window.webkit = {
    ...window.webkit,
    messageHandlers: {
      ...window.webkit?.messageHandlers,
      ghostexAppModalHost: {
        postMessage: handleAppModalHostMessage,
      },
    },
  };
}

function handleAppModalHostMessage(message: unknown): void {
  if (!isRecord(message)) {
    console.warn("[ghostex-web] Ignoring invalid app-modal host message.");
    return;
  }

  if (message.type === "close") {
    window.dispatchEvent(new CustomEvent("ghostex-web:closeAppModal"));
    return;
  }

  if (message.type !== "open" || message.modal !== "recentProjects") {
    console.warn(
      `[ghostex-web] Ignoring unsupported app modal: ${String(message.modal ?? "unknown")}.`,
    );
    return;
  }

  const openMessage = message as OpenRecentProjectsModalMessage;
  const detail: OpenRecentProjectsModalDetail = {
    ...(typeof openMessage.machineId === "string"
      ? { machineId: openMessage.machineId }
      : {}),
    ...(typeof openMessage.machineName === "string"
      ? { machineName: openMessage.machineName }
      : {}),
  };
  window.dispatchEvent(
    new CustomEvent("ghostex-web:openRecentProjectsModal", { detail }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
