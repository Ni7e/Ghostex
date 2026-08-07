/*
 * CDXC:ProjectBoard 2026-05-26-10:16:
 * Project-board cards need durable Ghostex-owned links from Beads tickets to
 * agent conversations. Keep these records outside Beads issue fields so one
 * conversation can own multiple beads without abusing unique external refs or
 * polluting comments/labels with app-routing metadata.
 */

import type { AppToastLevel } from "./app-toast-contract";
import {
  createGxserverPresentationProjectSessionId,
  parseGxserverPresentationProjectSessionId,
} from "./gxserver-presentation-sidebar-projection";
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

export type BeadConversationLinkStoreProject = {
  path?: string;
  projectBoardConfig?: Record<string, unknown>;
  projectId: string;
};

export type ProjectBoardConversationLinkView = BeadConversationLink & {
  isFocused?: boolean;
  isLive?: boolean;
  /**
   * CDXC:ProjectBoardBeads 2026-08-07:
   * The Ghostex session row is gone from restorable history, but the agent
   * conversation it worked can still be resumed from the row's own agent
   * identity, so the card offers Resume instead of a dead affordance.
   */
  isResumable?: boolean;
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

/*
 * CDXC:ProjectBoardBeads 2026-08-07:
 * Beads rewrites every issue id when a board's issue prefix is reconciled
 * (zmux-95421485 becomes ghostex-95421485), but a persisted link keeps the id
 * it was written with. Matching links to a bead by the trailing issue id keeps
 * the conversation attached across those renames — including for links that
 * were already orphaned by an earlier rename — while still separating two
 * different beads.
 */
export function beadConversationLinkMatchKey(beadId: string): string {
  const normalized = beadId.trim().toLowerCase();
  const separatorIndex = normalized.lastIndexOf("-");
  if (separatorIndex <= 0) {
    return normalized;
  }
  return normalized.slice(separatorIndex + 1) || normalized;
}

export function indexBeadConversationLinksByBead<TLink extends Pick<BeadConversationLink, "beadId">>(
  links: readonly TLink[],
): Map<string, TLink[]> {
  const result = new Map<string, TLink[]>();
  for (const link of links) {
    const key = beadConversationLinkMatchKey(link.beadId);
    const current = result.get(key);
    if (current) {
      current.push(link);
      continue;
    }
    result.set(key, [link]);
  }
  return result;
}

export function selectBeadConversationLinks<TLink>(
  index: ReadonlyMap<string, TLink[]>,
  beadId: string,
): TLink[] {
  return index.get(beadConversationLinkMatchKey(beadId)) ?? [];
}

/*
 * CDXC:ProjectBoardBeads 2026-08-07:
 * One Beads board can be mounted by several project rows — a checkout and its
 * worktree, or the same folder registered twice — and every row keeps its own
 * beadConversationLinks. Links are read across the rows that share a board so
 * a card shows the work that happened, whichever row it was started from.
 * Writes stay on their own row, so this needs no storage change.
 */
export function beadConversationLinkStoreKey(project: BeadConversationLinkStoreProject): string {
  const configured = project.projectBoardConfig?.beadsDirectory;
  const directory = typeof configured === "string" && configured.trim() ? configured : project.path;
  return typeof directory === "string" ? directory.trim().replace(/\/+$/u, "") : "";
}

export function selectBeadConversationLinkStoreProjects<
  TProject extends BeadConversationLinkStoreProject,
>(boardProject: TProject, projects: readonly TProject[]): TProject[] {
  const boardStoreKey = beadConversationLinkStoreKey(boardProject);
  const storeProjects = [boardProject];
  if (!boardStoreKey) {
    return storeProjects;
  }
  for (const candidate of projects) {
    if (
      candidate.projectId !== boardProject.projectId &&
      beadConversationLinkStoreKey(candidate) === boardStoreKey
    ) {
      storeProjects.push(candidate);
    }
  }
  return storeProjects;
}

export function resolveBeadConversationLinkBoardSessionId(
  link: Pick<BeadConversationLink, "ghostexSessionId" | "projectId">,
  boardProjectId: string,
): string {
  const reference = parseGxserverPresentationProjectSessionId(link.ghostexSessionId) ?? {
    projectId: link.projectId,
    sessionId: link.ghostexSessionId,
  };
  return reference.projectId === boardProjectId
    ? reference.sessionId
    : createGxserverPresentationProjectSessionId(reference.projectId, reference.sessionId);
}

export function canonicalizeBeadConversationLinksForBoard<
  TLink extends Pick<
    BeadConversationLink,
    "beadId" | "ghostexSessionId" | "projectId" | "updatedAt"
  >,
>(links: readonly TLink[], boardProjectId: string): TLink[] {
  // A session id is stored relative to the row that owns the link, so the same
  // conversation reads differently from each row of a shared board. Re-express
  // every link against the board project, then keep the newest record of each.
  const byConversation = new Map<string, TLink>();
  for (const link of links) {
    const ghostexSessionId = resolveBeadConversationLinkBoardSessionId(link, boardProjectId);
    const key = `${beadConversationLinkMatchKey(link.beadId)}${ghostexSessionId}`;
    const current = byConversation.get(key);
    if (current && Date.parse(current.updatedAt) >= Date.parse(link.updatedAt)) {
      continue;
    }
    byConversation.set(key, { ...link, ghostexSessionId });
  }
  return [...byConversation.values()];
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
