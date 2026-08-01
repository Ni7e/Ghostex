// Session Chat transport contract.
// Hosts (ghostex-web, gpui CEF, mobile web views) inject an implementation so
// the shared chat components never talk to gxserver directly. The transport is
// scoped to one (projectId, sessionId): subscribe frames are pre-filtered by
// the host and the mutation calls omit the identity params.

import type {
  GxserverAnswerSessionChatPromptParams,
  GxserverReadSessionChatResult,
  GxserverSaveSessionChatImageResult,
  GxserverSessionChatEvent,
  SessionChatSendKey,
} from "../../shared/session-chat";

export interface SessionChatTransport {
  read(params: {
    limit?: number;
    beforeOffset?: number;
  }): Promise<GxserverReadSessionChatResult>;
  /** Returns an unsubscribe function. Events must already be filtered to this session. */
  subscribe(handlers: {
    onEvent: (e: GxserverSessionChatEvent) => void;
    /**
     * Read at every (re)subscribe, never captured: snapshot/replaced frames
     * carry the follower's window, so a reconnect after a long live session
     * would otherwise answer with fewer rows than are already on screen.
     * Hosts that cannot pass a window ignore it.
     */
    currentLimit?: () => number;
  }): () => void;
  send(text: string, imagePaths?: string[]): Promise<void>;
  /**
   * Injects a raw keystroke sequence (no text, no Enter) — Claude Code's
   * permission-mode cycle is Shift+Tab only. Hosts without a path for it omit
   * this, which hides the Mode control instead of faking it.
   */
  sendKey?(key: SessionChatSendKey): Promise<void>;
  /**
   * Saves composer-pasted image bytes onto the session's machine and returns
   * the absolute path there (terminal-paste contract: ~/.ghostex/i). Hosts
   * without an upload path (e.g. the mobile WebView) omit this, which
   * disables the composer's image paste.
   */
  saveImage?(params: {
    base64Data: string;
    suggestedName?: string;
  }): Promise<GxserverSaveSessionChatImageResult>;
  answerPrompt(
    params: Omit<GxserverAnswerSessionChatPromptParams, "projectId" | "sessionId">,
  ): Promise<void>;
  interrupt(): Promise<void>;
}
