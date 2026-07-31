// ghostex-web SessionChatTransport implementation.
// Scoped to one (machineId, projectId, sessionId): RPC mutations go through the
// machine's gxserver connection, live frames ride the shared /api/events
// socket via the connection's session-chat subscription registry (which
// re-subscribes automatically after reconnects).

import type { GxserverReadSessionChatResult } from "@/shared/session-chat";
import type { SessionChatTransport } from "@/sidebar/chat/session-chat-transport";
import {
  rpcForMachine,
  subscribeSessionChatForMachine,
} from "../connections/connection-registry";

export function createSessionChatTransport(
  machineId: string,
  projectId: string,
  sessionId: string,
): SessionChatTransport {
  return {
    async answerPrompt(params) {
      await rpcForMachine(machineId, "/api/answerSessionChatPrompt", {
        ...params,
        projectId,
        sessionId,
      });
    },
    async interrupt() {
      await rpcForMachine(machineId, "/api/interruptSessionChat", {
        projectId,
        sessionId,
      });
    },
    read(params) {
      return rpcForMachine<GxserverReadSessionChatResult>(
        machineId,
        "/api/readSessionChat",
        {
          projectId,
          sessionId,
          ...(params.limit !== undefined ? { limit: params.limit } : {}),
          ...(params.beforeOffset !== undefined ? { beforeOffset: params.beforeOffset } : {}),
        },
      );
    },
    async send(text, imagePaths) {
      await rpcForMachine(machineId, "/api/sendSessionChatMessage", {
        projectId,
        sessionId,
        text,
        ...(imagePaths && imagePaths.length > 0 ? { imagePaths } : {}),
      });
    },
    subscribe({ onEvent }) {
      // Registry-level subscription survives connection replacement (the
      // registry re-attaches entries when a machine's connection is rebuilt).
      return subscribeSessionChatForMachine(machineId, projectId, sessionId, onEvent);
    },
  };
}
