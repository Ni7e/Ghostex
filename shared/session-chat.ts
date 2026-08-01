// Session Chat — normalized chat projection of an agent terminal session.
// Canonical wire types shared by gxserver (Rust mirror in gxserver-rs/src/session_chat.rs),
// the shared React chat components (sidebar/chat/), and every client host.
// All values must stay plain JSON: they cross the /api/events websocket, the CEF bridge,
// and the gpui remote-machine proxy.

export const SESSION_CHAT_SUPPORTED_AGENTS = new Set([
  "claude",
  "openclaude",
  "codex",
  "grok",
]);

export type SessionChatTranscriptAgent = "claude" | "codex" | "grok";

export function resolveSessionChatTranscriptAgent(
  agentId: string | null | undefined,
): SessionChatTranscriptAgent | null {
  if (agentId === "claude" || agentId === "openclaude") return "claude";
  if (agentId === "codex" || agentId === "grok") return agentId;
  return null;
}

export type SessionChatSource = "transcript" | "hook" | "client";

// Higher wins when the same message id/turn arrives from two sources.
export const SESSION_CHAT_SOURCE_PRIORITY: Record<SessionChatSource, number> = {
  transcript: 3,
  hook: 2,
  client: 1,
};

export type SessionChatRole =
  | "user"
  | "assistant"
  | "reasoning"
  | "tool"
  | "system";

export interface SessionChatTextBlock {
  type: "text";
  text: string;
}

export interface SessionChatToolCallBlock {
  type: "tool-call";
  name: string;
  input: unknown;
}

export interface SessionChatToolResultBlock {
  type: "tool-result";
  output: string;
  isError?: boolean;
}

export interface SessionChatImageRefBlock {
  type: "image-ref";
  path?: string;
  url?: string;
  alt?: string;
}

export type SessionChatBlock =
  | SessionChatTextBlock
  | SessionChatToolCallBlock
  | SessionChatToolResultBlock
  | SessionChatImageRefBlock;

export interface SessionChatMessage {
  /** Stable across re-reads: record uuid/payload id, else `${filePath}:${byteOffset16}`. */
  id: string;
  role: SessionChatRole;
  blocks: SessionChatBlock[];
  /** Epoch ms; null sorts before any timestamp. */
  timestamp: number | null;
  source: SessionChatSource;
  /** Optional explicit turn key; same turnId ⇒ same turn (cross-source dedup). */
  turnId?: string;
}

export type SessionChatTurnLifecycleState =
  | "working"
  | "completed"
  | "interrupted";

export interface SessionChatTurnLifecycle {
  state: SessionChatTurnLifecycleState;
  turnId: string;
  timestamp: number | null;
}

export type SessionChatStatus =
  | "loading"
  | "ready"
  | "working"
  | "empty"
  | "starting"
  | "error"
  | "unsupported";

export interface SessionChatQuestionOption {
  label: string;
  description?: string;
}

export interface SessionChatQuestion {
  question: string;
  header?: string;
  multiSelect: boolean;
  options: SessionChatQuestionOption[];
}

export type SessionChatInteractivePrompt =
  | { kind: "question"; questions: SessionChatQuestion[] }
  | { kind: "approval"; tool: string; summary?: string };

/** One answer per question, by 0-based option indices plus optional free text. */
export interface SessionChatQuestionSelection {
  indices: number[];
  other?: string;
}

// ---------------------------------------------------------------------------
// /api/readSessionChat
// ---------------------------------------------------------------------------

export interface GxserverReadSessionChatParams {
  projectId: string;
  sessionId: string;
  /** Max messages in the tail window. Default 300; page by +200. */
  limit?: number;
  /** Byte offset from a prior page's `beforeOffset` for older history. */
  beforeOffset?: number;
  /**
   * Long-poll (SSH-only clients such as Ghostex mobile): with `fingerprint`,
   * the server holds the request until the chat's fingerprint changes or
   * this many ms elapse (clamped to 30s), then answers with a normal read.
   */
  waitMs?: number;
  /** The `fingerprint` from a previous read result. */
  fingerprint?: string;
}

export interface GxserverReadSessionChatResult {
  messages: SessionChatMessage[];
  lifecycle?: SessionChatTurnLifecycle;
  hasMore: boolean;
  beforeOffset: number;
  epoch: number;
  seq: number;
  /** Opaque change token for `waitMs` long-polling. */
  fingerprint?: string;
  status: SessionChatStatus;
  agent?: string;
  agentSessionId?: string;
  prompt?: SessionChatInteractivePrompt;
  error?: string;
}

// ---------------------------------------------------------------------------
// /api/sendSessionChatMessage · /api/answerSessionChatPrompt · /api/interruptSessionChat
// ---------------------------------------------------------------------------

export interface GxserverSendSessionChatMessageParams {
  projectId: string;
  sessionId: string;
  text: string;
  imagePaths?: string[];
}

export interface GxserverSendSessionChatMessageResult {
  queued: boolean;
  textBytes: number;
}

/*
CDXC:SessionChatImagePaste 2026-08-01:
saveSessionChatImage writes composer-pasted image bytes into ~/.ghostex/i on
the machine the session runs on (clients call it over their per-machine RPC,
so a remote session's image lands on the remote machine). The returned
absolute path is what the composer interpolates into "[Image #N](path)" —
the same reference format the terminal paste path produces.
*/
export interface GxserverSaveSessionChatImageParams {
  projectId: string;
  sessionId: string;
  /** Raw base64 or a full data URL (the data: prefix is tolerated). */
  base64Data: string;
  /** Mined only for its extension; the stored name is always generated. */
  suggestedName?: string;
}

export interface GxserverSaveSessionChatImageResult {
  path: string;
  bytes: number;
}

export interface GxserverAnswerSessionChatPromptParams {
  projectId: string;
  sessionId: string;
  kind: "question" | "approval";
  /** For questions: one entry per question. */
  selections?: SessionChatQuestionSelection[];
  /** For approvals: the raw byte string of the chosen option ("1" allow, "" deny). */
  approvalSend?: string;
}

export interface GxserverAnswerSessionChatPromptResult {
  queued: boolean;
}

export interface GxserverInterruptSessionChatParams {
  projectId: string;
  sessionId: string;
}

export interface GxserverInterruptSessionChatResult {
  interrupted: boolean;
}

// ---------------------------------------------------------------------------
// /api/events frames
// ---------------------------------------------------------------------------

export interface GxserverSubscribeSessionChatMessage {
  type: "subscribeSessionChat";
  projectId: string;
  sessionId: string;
  limit?: number;
}

export interface GxserverUnsubscribeSessionChatMessage {
  type: "unsubscribeSessionChat";
  projectId: string;
  sessionId: string;
}

interface SessionChatFrameBase {
  projectId: string;
  sessionId: string;
  /** Follower generation; bumps on start/replace/re-resolve. */
  epoch: number;
  /** Monotonic within an epoch, starting at 1. */
  seq: number;
  protocolVersion: number;
  serverId: string;
}

export interface GxserverSessionChatSnapshotEvent extends SessionChatFrameBase {
  type: "sessionChatSnapshot";
  messages: SessionChatMessage[];
  lifecycle?: SessionChatTurnLifecycle;
  hasMore: boolean;
  beforeOffset: number;
  status: SessionChatStatus;
  prompt?: SessionChatInteractivePrompt;
  agentSessionId?: string;
}

export interface GxserverSessionChatAppendedEvent extends SessionChatFrameBase {
  type: "sessionChatAppended";
  messages: SessionChatMessage[];
  lifecycle?: SessionChatTurnLifecycle;
}

export interface GxserverSessionChatReplacedEvent extends SessionChatFrameBase {
  type: "sessionChatReplaced";
  messages: SessionChatMessage[];
  lifecycle?: SessionChatTurnLifecycle;
  hasMore: boolean;
  beforeOffset: number;
  status: SessionChatStatus;
  prompt?: SessionChatInteractivePrompt;
  agentSessionId?: string;
}

export interface GxserverSessionChatStateEvent extends SessionChatFrameBase {
  type: "sessionChatState";
  status: SessionChatStatus;
  lifecycle?: SessionChatTurnLifecycle;
  prompt?: SessionChatInteractivePrompt;
  agentSessionId?: string;
}

export type GxserverSessionChatEvent =
  | GxserverSessionChatSnapshotEvent
  | GxserverSessionChatAppendedEvent
  | GxserverSessionChatReplacedEvent
  | GxserverSessionChatStateEvent;

export function isSessionChatEventType(
  type: string,
): type is GxserverSessionChatEvent["type"] {
  return (
    type === "sessionChatSnapshot" ||
    type === "sessionChatAppended" ||
    type === "sessionChatReplaced" ||
    type === "sessionChatState"
  );
}

// ---------------------------------------------------------------------------
// View mode ("viewMode" is taken by the sidebar layout mode — do not reuse it)
// ---------------------------------------------------------------------------

export type SessionSurfaceMode = "terminal" | "chat";
