// Session Chat transport contract.
// Hosts (ghostex-web, gpui CEF, mobile web views) inject an implementation so
// the shared chat components never talk to gxserver directly. The transport is
// scoped to one (projectId, sessionId): subscribe frames are pre-filtered by
// the host and the mutation calls omit the identity params.

import type {
  GxserverAnswerSessionChatPromptParams,
  GxserverReadSessionChatResult,
  GxserverSessionChatEvent,
} from "../../shared/session-chat";

export interface SessionChatTransport {
  read(params: {
    limit?: number;
    beforeOffset?: number;
  }): Promise<GxserverReadSessionChatResult>;
  /** Returns an unsubscribe function. Events must already be filtered to this session. */
  subscribe(handlers: {
    onEvent: (e: GxserverSessionChatEvent) => void;
  }): () => void;
  send(text: string, imagePaths?: string[]): Promise<void>;
  answerPrompt(
    params: Omit<GxserverAnswerSessionChatPromptParams, "projectId" | "sessionId">,
  ): Promise<void>;
  interrupt(): Promise<void>;
}
