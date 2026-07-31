// Mounts the shared SessionChatView for a workspace session. The transport is
// memoized per (machineId, projectId, sessionId) so the chat hook's
// subscription survives unrelated re-renders. Chat styles (.ghostex-chat-*)
// live in sidebar/styles/chat.css, pulled in through the shared sheet below
// (already loaded app-wide by WebSidebar; the duplicate import dedupes).

import { useMemo } from "react";
import { resolveSessionChatTranscriptAgent } from "@/shared/session-chat";
import { SessionChatView } from "@/sidebar/chat/session-chat-view";
import "@/sidebar/styles.css";
import type { WorkspaceSession } from "../workspace/workspace-model";
import { createSessionChatTransport } from "../chat/session-chat-transport";

export function SessionChatHost({ session }: { session: WorkspaceSession }) {
  const transport = useMemo(
    () => createSessionChatTransport(session.machineId, session.projectId, session.sessionId),
    [session.machineId, session.projectId, session.sessionId],
  );
  const agentLabel = session.agentId
    ? resolveSessionChatTranscriptAgent(session.agentId) ?? session.agentId
    : null;
  return (
    <SessionChatView
      agentLabel={agentLabel}
      canSend={session.presentationState === "running"}
      className="workspace-session-chat"
      transport={transport}
      working={session.activity === "working"}
    />
  );
}
