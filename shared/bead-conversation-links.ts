/*
 * CDXC:ProjectBoard 2026-05-26-10:16:
 * Project-board cards need durable Ghostex-owned links from Beads tickets to
 * agent conversations. Keep these records outside Beads issue fields so one
 * conversation can own multiple beads without abusing unique external refs or
 * polluting comments/labels with app-routing metadata.
 */

import type { AppToastLevel } from "./app-toast-contract";
import type { SidebarAgentIcon } from "./sidebar-agents";

import type { DiagnosticLoggingSettings } from "./ghostex-settings";

export type BeadConversationLinkStatus = "active" | "archived";

export type BeadConversationLink = {
  agentId?: string;
  agentName?: string;
  agentSessionId?: string;
  agentSessionPath?: string;
  beadDisplayId?: string;
  beadId: string;
  createdAt: string;
  ghostexSessionId: string;
  id: string;
  projectId: string;
  sessionPersistenceName?: string;
  sessionPersistenceProvider?: "tmux" | "zmx" | "zellij";
  status: BeadConversationLinkStatus;
  updatedAt: string;
};

export type ProjectBoardAgentOption = {
  agentId: string;
  /**
   * CDXC:PromptAgents 2026-05-29-10:53:
   * Project-board title generation runs through the board bridge, so the
   * board state must carry the configured prompt-agent command as well as the id.
   *
   * CDXC:PromptAgents 2026-06-01-12:23:
   * The command carried here is the gxserver launch-plan command, not the raw stored command, so Accept All policy is still resolved in gxserver before the board bridge starts title generation.
   *
   * CDXC:PromptAgents 2026-06-02-15:18:
   * Shared conversation-link types must not describe Beads execution as native-owned. The board bridge carries UI request data; gxserver owns Beads command construction and execution.
   */
  command?: string;
  icon?: SidebarAgentIcon;
  label: string;
};

export type ProjectBoardConversationLinkView = BeadConversationLink & {
  isFocused?: boolean;
  isLive?: boolean;
  isRestorable?: boolean;
  isSleeping?: boolean;
  sessionTitle?: string;
};

export type ProjectBoardSessionOption = {
  agentId?: string;
  isFocused?: boolean;
  isSleeping?: boolean;
  label: string;
  sessionId: string;
};

export type ProjectBoardConversationState = {
  activeSessionId?: string;
  agents: ProjectBoardAgentOption[];
  debuggingMode?: boolean;
  diagnosticLogging?: DiagnosticLoggingSettings;
  defaultAgentId?: string;
  focusedTerminalSessionId?: string;
  links: ProjectBoardConversationLinkView[];
  projectId?: string;
  sessions: ProjectBoardSessionOption[];
};

export type ProjectBoardStartLocation = "currentProject" | "newWorktree";

export type ProjectBoardBridgeAction =
  | "appendDebugLog"
  | "associateFocusedSession"
  | "automationArchiveRun"
  | "automationDelete"
  | "automationGetAllState"
  | "automationGetState"
  | "automationOpenRunSession"
  | "automationOpenWorktree"
  | "automationMarkRunRead"
  | "automationRunNow"
  | "automationSave"
  | "automationSetEnabled"
  | "getState"
  | "jumpToConversation"
  | "projectEditorFocusOwnerChanged"
  | "showToast"
  | "startWork"
  | "unlinkConversation";

export type ProjectBoardBridgeRequest = {
  action: ProjectBoardBridgeAction;
  agentId?: string;
  beadDisplayId?: string;
  beadId?: string;
  details?: string;
  event?: string;
  projectEditorId?: string;
  prompt?: string;
  projectId?: string;
  projectPath?: string;
  remoteMachineId?: string;
  payloadJson?: string;
  requestId: string;
  sessionId?: string;
  startLocation?: ProjectBoardStartLocation;
  ticketTitle?: string;
  toastDescription?: string;
  toastLevel?: AppToastLevel;
  toastTitle?: string;
};

export type ProjectBoardBridgeResponse<TPayload = ProjectBoardConversationState> = {
  error?: string;
  ok: boolean;
  payload?: TPayload;
  requestId: string;
};

export function normalizeBeadConversationLinks(
  candidate: unknown,
  projectId: string,
): BeadConversationLink[] {
  if (!Array.isArray(candidate)) {
    return [];
  }
  return candidate.flatMap((entry) => normalizeBeadConversationLink(entry, projectId));
}

export function normalizeBeadConversationLink(
  candidate: unknown,
  fallbackProjectId: string,
): BeadConversationLink[] {
  if (!candidate || typeof candidate !== "object") {
    return [];
  }
  const record = candidate as Partial<BeadConversationLink>;
  const beadId = normalizeNonEmptyString(record.beadId);
  const ghostexSessionId = normalizeNonEmptyString(record.ghostexSessionId);
  if (!beadId || !ghostexSessionId) {
    return [];
  }
  const now = new Date().toISOString();
  const id =
    normalizeNonEmptyString(record.id) ??
    createBeadConversationLinkId(fallbackProjectId, beadId, ghostexSessionId);
  return [
    {
      agentId: normalizeNonEmptyString(record.agentId),
      agentName: normalizeNonEmptyString(record.agentName),
      agentSessionId: normalizeNonEmptyString(record.agentSessionId),
      agentSessionPath: normalizeNonEmptyString(record.agentSessionPath),
      beadDisplayId: normalizeNonEmptyString(record.beadDisplayId),
      beadId,
      createdAt: normalizeDateString(record.createdAt) ?? now,
      ghostexSessionId,
      id,
      projectId: normalizeNonEmptyString(record.projectId) ?? fallbackProjectId,
      sessionPersistenceName: normalizeNonEmptyString(record.sessionPersistenceName),
      sessionPersistenceProvider: normalizePersistenceProvider(record.sessionPersistenceProvider),
      status: record.status === "archived" ? "archived" : "active",
      updatedAt: normalizeDateString(record.updatedAt) ?? now,
    },
  ];
}

export function createBeadConversationLinkId(
  projectId: string,
  beadId: string,
  ghostexSessionId: string,
): string {
  return [projectId, beadId, ghostexSessionId]
    .map((part) => part.trim().replace(/[^a-z0-9_-]+/giu, "-").replace(/^-+|-+$/gu, ""))
    .filter(Boolean)
    .join(":");
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeDateString(value: unknown): string | undefined {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return undefined;
  }
  return value;
}

function normalizePersistenceProvider(
  value: unknown,
): BeadConversationLink["sessionPersistenceProvider"] {
  return value === "tmux" || value === "zmx" || value === "zellij" ? value : undefined;
}
