export const GHOSTEX_T3_EMBEDDED_FLAG = "1";
export const GHOSTEX_T3_DRAFT_FLAG = "1";
export const GHOSTEX_T3_DEFAULT_SIDEBAR_MODE = "collapsed" as const;

export type GhostexT3SidebarMode = "collapsed" | "normal";

export type GhostexT3LaunchDescriptor = {
  createdAt?: string;
  environmentId: string;
  ghostexProjectId: string;
  ghostexSessionId: string;
  isDraft?: boolean;
  projectId: string;
  t3SidebarMode: GhostexT3SidebarMode;
  threadId: string;
};

function readNonEmptyLaunchParam(search: URLSearchParams, key: string): string | undefined {
  const value = search.get(key)?.trim();
  return value ? value : undefined;
}

export function normalizeGhostexT3IdentityComponent(sessionId: string): string {
  const normalized = sessionId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "session";
}

export function stableGhostexT3DraftId(sessionId: string): string {
  return `ghostex-draft-${normalizeGhostexT3IdentityComponent(sessionId)}`;
}

export function stableGhostexT3DraftThreadId(sessionId: string): string {
  return `ghostex-thread-${normalizeGhostexT3IdentityComponent(sessionId)}`;
}

export function parseGhostexT3LaunchDescriptor(
  search: URLSearchParams,
): GhostexT3LaunchDescriptor | null {
  if (search.get("ghostexEmbedded") !== GHOSTEX_T3_EMBEDDED_FLAG) {
    return null;
  }

  const ghostexProjectId = readNonEmptyLaunchParam(search, "ghostexProjectId");
  const ghostexSessionId = readNonEmptyLaunchParam(search, "ghostexSessionId");
  const environmentId = readNonEmptyLaunchParam(search, "environmentId");
  const projectId = readNonEmptyLaunchParam(search, "projectId");
  const threadId = readNonEmptyLaunchParam(search, "threadId");
  if (!ghostexProjectId || !ghostexSessionId || !environmentId || !projectId || !threadId) {
    return null;
  }

  const rawSidebarMode = readNonEmptyLaunchParam(search, "t3SidebarMode");
  const t3SidebarMode: GhostexT3SidebarMode =
    rawSidebarMode === "normal" ? "normal" : GHOSTEX_T3_DEFAULT_SIDEBAR_MODE;
  const createdAt = readNonEmptyLaunchParam(search, "createdAt");

  return {
    ...(createdAt ? { createdAt } : {}),
    environmentId,
    ghostexProjectId,
    ghostexSessionId,
    isDraft: search.get("ghostexDraft") === GHOSTEX_T3_DRAFT_FLAG,
    projectId,
    t3SidebarMode,
    threadId,
  };
}

export function appendGhostexT3LaunchDescriptor(
  search: URLSearchParams,
  descriptor: GhostexT3LaunchDescriptor,
): void {
  /*
  CDXC:T3SessionOwnership 2026-07-01-02:17:
  Embedded T3 panes must launch with Ghostex project/session identity and a collapsed-but-accessible T3 sidebar. Keep the descriptor explicit on both draft and real-thread routes so T3 promotion does not lose the owning gxserver row.
  */
  search.set("ghostexEmbedded", GHOSTEX_T3_EMBEDDED_FLAG);
  search.set("ghostexProjectId", descriptor.ghostexProjectId);
  search.set("ghostexSessionId", descriptor.ghostexSessionId);
  if (descriptor.isDraft === true) {
    search.set("ghostexDraft", GHOSTEX_T3_DRAFT_FLAG);
  } else {
    search.delete("ghostexDraft");
  }
  search.set("environmentId", descriptor.environmentId);
  search.set("projectId", descriptor.projectId);
  search.set("threadId", descriptor.threadId);
  if (descriptor.createdAt) {
    search.set("createdAt", descriptor.createdAt);
  } else {
    search.delete("createdAt");
  }
  search.set("t3SidebarMode", descriptor.t3SidebarMode);
}

export function buildGhostexT3LaunchSearchParams(
  descriptor: GhostexT3LaunchDescriptor,
): URLSearchParams {
  const search = new URLSearchParams();
  appendGhostexT3LaunchDescriptor(search, descriptor);
  return search;
}
