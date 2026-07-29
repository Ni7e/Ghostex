import type { WebviewApi } from "../webview-api";

/*
 * CDXC:SidebarV2 2026-07-29:
 * Sidebar V2 owns no host channel of its own. Every mutation it can perform is
 * declared here as a thin wrapper over the SAME `SidebarToExtensionMessage`
 * variants the classic sidebar posts, so switching sidebars can never change
 * what the host is asked to do. If a V2 affordance needs a new host behavior,
 * the message belongs on the shared contract first — never as a V2-only side
 * channel.
 */

/** Activate a session. Identical for terminal, agent, T3, and browser rows:
    the host resolves the surface from the session id, exactly as V1 relies on. */
export function postSidebarV2FocusSession(vscode: WebviewApi, sessionId: string): void {
  vscode.postMessage({ sessionId, type: "focusSession" });
}

/** Zoom the session's pane tab group (context-menu Focus in V1). */
export function postSidebarV2FocusSessionMode(vscode: WebviewApi, sessionId: string): void {
  vscode.postMessage({ sessionId, type: "focusSessionMode" });
}

/**
 * Commit an inline rename. V1's row rename opens the full-window modal and the
 * modal posts this exact message, so V2's inline editor is the same command
 * with the dialog step removed.
 */
export function postSidebarV2RenameSession(
  vscode: WebviewApi,
  sessionId: string,
  title: string,
): void {
  vscode.postMessage({ sessionId, title, type: "renameSession" });
}

export function postSidebarV2SetSessionSleeping(
  vscode: WebviewApi,
  sessionId: string,
  sleeping: boolean,
): void {
  vscode.postMessage({ sessionId, sleeping, type: "setSessionSleeping" });
}

export function postSidebarV2SetSessionPinned(
  vscode: WebviewApi,
  sessionId: string,
  pinned: boolean,
): void {
  vscode.postMessage({ pinned, sessionId, type: "setSessionPinned" });
}

/*
 * CDXC:SidebarV2Lifecycle 2026-07-29:
 * Settle/snooze are the first commands V2 owns that V1 has no twin for, so they
 * are still declared here rather than inline in the components: the host
 * contract stays in one file, and the payload carries the sidebar session id
 * only — the host owns the machine/project resolution.
 *
 * None of these post an optimistic update. gxserver answers with a presentation
 * delta, and that delta is what moves the row between shelves; a local guess
 * would fight the server's guards (a working session cannot settle) and produce
 * a row that jumps out and back.
 */
export function postSidebarV2SettleSession(vscode: WebviewApi, sessionId: string): void {
  vscode.postMessage({ sessionId, type: "settleSession" });
}

export function postSidebarV2UnsettleSession(vscode: WebviewApi, sessionId: string): void {
  vscode.postMessage({ sessionId, type: "unsettleSession" });
}

export function postSidebarV2SnoozeSession(
  vscode: WebviewApi,
  sessionId: string,
  snoozedUntil: string,
): void {
  vscode.postMessage({ sessionId, snoozedUntil, type: "snoozeSession" });
}

export function postSidebarV2UnsnoozeSession(vscode: WebviewApi, sessionId: string): void {
  vscode.postMessage({ sessionId, type: "unsnoozeSession" });
}

/*
 * CDXC:SidebarV2Worktree 2026-07-29:
 * The worktree flow's two commands. They are declared here for the same reason
 * settle/snooze are: the host contract stays in one file, and the payload
 * carries sidebar ids only — the host owns project, machine, and path
 * resolution. Neither is optimistic: the created session arrives as a
 * presentation delta, and the request/result pair exists only to drive the
 * popover's pending state.
 */
export function postSidebarV2CreateWorktreeSession(
  vscode: WebviewApi,
  input: {
    agentId?: string;
    baseBranch?: string;
    existingWorktreePath?: string;
    firstPrompt?: string;
    projectId: string;
    requestId: string;
    startFromOrigin?: boolean;
  },
): void {
  vscode.postMessage({
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.baseBranch ? { baseBranch: input.baseBranch } : {}),
    ...(input.existingWorktreePath ? { existingWorktreePath: input.existingWorktreePath } : {}),
    ...(input.firstPrompt ? { firstPrompt: input.firstPrompt } : {}),
    projectId: input.projectId,
    requestId: input.requestId,
    ...(input.startFromOrigin === true ? { startFromOrigin: true } : {}),
    type: "createWorktreeSession",
  });
}

export function postSidebarV2RemoveSessionWorktree(
  vscode: WebviewApi,
  input: {
    force?: boolean;
    projectId: string;
    requestId: string;
    worktreePath: string;
  },
): void {
  vscode.postMessage({
    ...(input.force === true ? { force: true } : {}),
    projectId: input.projectId,
    requestId: input.requestId,
    type: "removeSessionWorktree",
    worktreePath: input.worktreePath,
  });
}

/**
 * The branch/worktree list the worktree popover fills its pickers from. This is
 * the SAME request the classic Add Worktree modal sends; the host answers it
 * once and delivers the answer to both surfaces, so V2 introduced no second
 * server-side probe.
 */
export function postSidebarV2RequestProjectWorktrees(
  vscode: WebviewApi,
  input: { projectId?: string; requestId: string },
): void {
  vscode.postMessage({
    ...(input.projectId ? { projectId: input.projectId } : {}),
    requestId: input.requestId,
    type: "requestProjectWorktrees",
  });
}

/**
 * Close deferred to a macrotask, mirroring V1's
 * `postSidebarSessionCloseInBackground`: native message delivery is
 * synchronous, so tearing the runtime down inside the click gesture makes the
 * sidebar feel stalled.
 */
export function postSidebarV2CloseSession(vscode: WebviewApi, sessionId: string): void {
  globalThis.setTimeout(() => {
    vscode.postMessage({ sessionId, type: "closeSession" });
  }, 0);
}
