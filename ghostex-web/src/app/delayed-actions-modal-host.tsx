import { useCallback, useEffect, useState } from "react";

import { DelayedSendModal } from "@/sidebar/delayed-send-modal";
import { rpcForMachine } from "../connections/connection-registry";
import { parseSidebarSessionId } from "../sidebar-runtime/sidebar-ids";
import type { OpenDelayedActionsModalDetail } from "./action-events";

type DelayedActionRendererCommand =
  "cancelDelayedSend" | "scheduleDelayedSend" | "toggleCloseAfterDone";

export function DelayedActionsModalHost() {
  const [detail, setDetail] = useState<OpenDelayedActionsModalDetail>();

  useEffect(() => {
    const open = (event: WindowEventMap["ghostex-web:openDelayedActionsModal"]) => {
      setDetail(event.detail);
    };
    const close = () => setDetail(undefined);
    window.addEventListener("ghostex-web:openDelayedActionsModal", open);
    window.addEventListener("ghostex-web:closeAppModal", close);
    return () => {
      window.removeEventListener("ghostex-web:openDelayedActionsModal", open);
      window.removeEventListener("ghostex-web:closeAppModal", close);
    };
  }, []);

  const close = useCallback(() => setDetail(undefined), []);

  const dispatch = useCallback(
    (action: DelayedActionRendererCommand, payload: Record<string, unknown> = {}) => {
      if (!detail) {
        return;
      }
      const target = parseSidebarSessionId(detail.sessionId);
      if (!target) {
        console.warn("[ghostex-web] Ignoring Session Automations for an invalid session id.");
        return;
      }
      void rpcForMachine(target.machineId, "/api/dispatchRendererCommand", {
        action,
        payload: {
          ...payload,
          projectId: target.projectId,
          sessionId: target.sessionId,
        },
      }).catch((error: unknown) => {
        console.error(`[ghostex-web] Session Automations ${action} failed:`, error);
      });
    },
    [detail]
  );

  return (
    <DelayedSendModal
      agentIcon={detail?.agentIcon}
      closeAfterDoneActive={detail?.closeAfterDoneActive}
      delayedSendDeadlineAt={detail?.delayedSendDeadlineAt}
      delayedSendRemainingLabel={detail?.delayedSendRemainingLabel}
      isOpen={detail !== undefined}
      onCancel={close}
      onCancelTimer={() => {
        dispatch("cancelDelayedSend");
        close();
      }}
      onConfirm={(delayMs, sendWhenAgentStops, sendWhenAllProjectSessionsStop) => {
        dispatch("scheduleDelayedSend", {
          delayMs,
          sendWhenAgentStops,
          sendWhenAllProjectSessionsStop,
        });
        close();
      }}
      onToggleCloseAfterDone={() => {
        dispatch("toggleCloseAfterDone");
        close();
      }}
      sendWhenAllProjectSessionsStopActive={detail?.sendWhenAllProjectSessionsStopActive}
      sendWhenAgentStopsActive={detail?.sendWhenAgentStopsActive}
      sessionTitle={detail?.title}
      supportsSendWhenAgentStops
      supportsSendWhenAllProjectSessionsStop
    />
  );
}
