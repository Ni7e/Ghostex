import type {
  GxserverAgentActivityState,
  GxserverPresentationAttentionState,
  GxserverPresentationGroup,
  GxserverPresentationProject,
  GxserverPresentationRevision,
  GxserverPresentationSession,
  GxserverPresentationSessionActions,
  GxserverPresentationSessionActivity,
  GxserverPresentationSnapshot,
  GxserverProjectDomainState,
  GxserverSessionDomainState,
  GxserverTitleObservationState,
} from "../../protocol/index.js";
import { getEffectiveAgentActivityState } from "../session-status/index.js";
import { projectSessionTitle } from "../session-title/projection.js";

export interface GxserverPresentationProjectorInput {
  generatedAt?: string;
  projects: readonly GxserverProjectDomainState[];
  revision: GxserverPresentationRevision;
  sessions: readonly GxserverSessionDomainState[];
}

const ACTIVE_LIFECYCLE_STATES = new Set(["running", "sleeping"]);
const RECENT_STOPPED_LIMIT_PER_PROJECT = 20;

/*
CDXC:GxserverPresentation 2026-06-01-15:08:
The hard cutover feed is active-focused presentation state, not raw session history. Project sessions into shared rows with surface, title provenance, activity, and sidebar visibility while keeping stopped history out unless pinned or favorited so clients do not hydrate the entire database at startup.
*/
export function projectGxserverPresentationSnapshot(
  input: GxserverPresentationProjectorInput,
): GxserverPresentationSnapshot {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const sessionsByProject = new Map<string, GxserverSessionDomainState[]>();
  for (const session of input.sessions) {
    const sessions = sessionsByProject.get(session.projectId) ?? [];
    sessions.push(session);
    sessionsByProject.set(session.projectId, sessions);
  }

  const projects: GxserverPresentationProject[] = [];
  const groups: GxserverPresentationGroup[] = [];
  const sessions: GxserverPresentationSession[] = [];

  for (const project of [...input.projects].sort(compareProjects)) {
    const projectSessions = sessionsByProject.get(project.projectId) ?? [];
    const visibleProjectSessions = selectPresentationSessions(projectSessions);

    const groupId = defaultGroupId(project.projectId);
    const presentationSessions = visibleProjectSessions.map((session) =>
      projectPresentationSession(project, groupId, session, generatedAt)
    );
    presentationSessions.sort(comparePresentationSessions);

    /*
    CDXC:GxserverPresentationProjects 2026-06-01-21:14:
    Newly added code projects must appear in the sidebar before their first terminal session exists. Keep every active project in the presentation project list while still filtering old stopped sessions out of the session rows.
    */
    projects.push(projectPresentationProject(project));
    groups.push({
      groupId,
      projectId: project.projectId,
      sessionIds: presentationSessions.map((session) => session.sessionId),
      sortKey: `${projectSortKey(project)}:active`,
      title: "Active",
    });
    sessions.push(...presentationSessions);
  }

  return {
    generatedAt,
    groups,
    projects,
    revision: input.revision,
    sessions,
  };
}

export function projectPresentationProject(project: GxserverProjectDomainState): GxserverPresentationProject {
  /*
  CDXC:GxserverPresentationProjects 2026-06-02-08:16:
  Worktree project rows are shared gxserver presentation state. Include worktree parent metadata in the presentation project so clients can render a newly added checkout under its main project from the projectAdded delta without waiting for a separate domain-project refresh.
  */
  return {
    createdAt: project.createdAt,
    groupIds: [defaultGroupId(project.projectId)],
    isFavorite: project.isFavorite,
    isPinned: project.isPinned,
    path: project.path,
    projectId: project.projectId,
    sortKey: projectSortKey(project),
    title: project.name,
    updatedAt: project.updatedAt,
    ...(project.worktree ? { worktree: project.worktree } : {}),
  };
}

export function projectPresentationSession(
  project: GxserverProjectDomainState,
  groupId: string,
  session: GxserverSessionDomainState,
  generatedAt?: string,
): GxserverPresentationSession {
  const titleProjection = projectSessionTitle(session);
  const activityState = normalizePresentationActivityState(session.runtimeSettings.agentActivity, generatedAt);
  const titleObservation = normalizeTitleObservationState(session.runtimeSettings.zmxTitleObservation);
  const providerSessionState = providerSessionStateForDomainSession(session);
  const sessionPersistenceProvider = sessionPersistenceProviderForDomainSession(session);
  const agentName = readText(session.runtimeSettings.agentName) ?? session.agentId;
  const agentSessionId = readText(session.runtimeSettings.agentSessionId);
  const agentSessionPath = readText(session.runtimeSettings.agentSessionPath);
  const subtitle = session.cwd ?? project.path;
  const presentationLastActiveAt = resolvePresentationSessionLastActiveAt(session);
  const lifecycleState = effectivePresentationLifecycleState(session);
  return {
    actions: presentationSessionActions(session, activityState.activity),
    activity: activityState.activity,
    ...(agentName ? { agentName } : {}),
    ...(session.agentId ? { agentId: session.agentId, agentIcon: session.agentId } : {}),
    /*
    CDXC:GxserverPresentationIdentity 2026-06-11-23:58:
    Agent hook identity is server-owned presentation data. Publish captured provider session ids and paths with the row so macOS, mobile, CLI, and future clients can show and resume the same Codex/Claude session instead of only receiving the routed Ghostex session id.
    */
    ...(agentSessionId ? { agentSessionId } : {}),
    ...(agentSessionPath ? { agentSessionPath } : {}),
    ...(activityState.attention ? { attention: activityState.attention } : {}),
    createdAt: session.createdAt,
    ...(session.cwd ? { cwd: session.cwd } : {}),
    groupId,
    isFavorite: session.sessionTag === "favorite" || session.isFavorite,
    /*
    CDXC:GxserverSessionTitle 2026-06-04-07:11:
    First-prompt title generation is gxserver-owned, but clients still own their local loading chrome. Publish a privacy-safe boolean in presentation rows so native terminal overlays, sidebar card text, and future clients can render and clear "Generating title" without reading raw prompts or duplicating server runtime-status rules.

    CDXC:GxserverSessionTitle 2026-06-12-07:08:
    gxserver stages first-prompt title commands as terminal text and native macOS submits them with a real Enter. Publish an explicit submit flag so Claude's bare `/rename` can use that bridge without marking the unchanged generic title as generated.
    */
    isGeneratingFirstPromptTitle: readText(session.runtimeSettings.gxserverFirstPromptAutoTitleStatus) === "running",
    ...(session.runtimeSettings.gxserverFirstPromptAutoTitleShouldSubmitStagedCommand === true
      ? { shouldSubmitStagedFirstPromptTitleCommand: true }
      : {}),
    isPinned: session.isPinned,
    displayTitle: titleProjection.displayTitle,
    displayTitleTooltip: titleProjection.displayTitleTooltip,
    isPrimaryTitleTerminalTitle: titleProjection.isPrimaryTitleTerminalTitle,
    isTemporaryTitle: titleProjection.isTemporaryTitle,
    kind: session.kind,
    lastActiveAt: presentationLastActiveAt,
    lifecycleState,
    providerSessionState,
    ...(titleProjection.primaryTitle !== undefined ? { primaryTitle: titleProjection.primaryTitle } : {}),
    projectId: session.projectId,
    sessionId: session.sessionId,
    ...(sessionPersistenceProvider ? { sessionPersistenceProvider } : {}),
    ...(session.sessionTag ? { sessionTag: session.sessionTag } : {}),
    ...(session.sidebarOrder !== undefined ? { sidebarOrder: session.sidebarOrder } : {}),
    sortKey: sessionSortKey(session),
    ...(subtitle ? { subtitle } : {}),
    surface: session.surface,
    ...(titleProjection.terminalTitle !== undefined ? { terminalTitle: titleProjection.terminalTitle } : {}),
    title: titleProjection.title,
    ...(titleObservation ? { titleObservation } : {}),
    titleSource: titleProjection.titleSource,
    ...(titleProjection.trustedResumeTitle !== undefined ? { trustedResumeTitle: titleProjection.trustedResumeTitle } : {}),
    tooltip: buildSessionTooltip(project, session, titleProjection.title),
    updatedAt: session.updatedAt,
    visibleInSidebarByDefault: isVisibleInWorkspaceSidebar(session),
    zmxName: session.zmxName,
  };
}

function presentationSessionActions(
  session: GxserverSessionDomainState,
  activity: GxserverPresentationSessionActivity,
): GxserverPresentationSessionActions {
  /*
  CDXC:GxserverPresentation 2026-06-04-03:33:
  Clients should not each infer whether a session can be attached, sent to,
  woken, slept, killed, or acknowledged. Publish coarse action availability
  with the presentation row so Android, iOS, TUI, CLI, and agent orchestration
  render and automate against the same gxserver-owned rules.
  */
  const lifecycleState = effectivePresentationLifecycleState(session);
  const isRunning = lifecycleState === "running";
  const isSleeping = lifecycleState === "sleeping";
  const isStopped = lifecycleState === "stopped";
  const providerSessionState = providerSessionStateForDomainSession(session);
  const providerExists = providerSessionState === "exists";
  const isLive = providerExists;
  const canAttach = providerExists || (isRunning && providerSessionState === "unknown") || isSleeping;
  const canInteract = isLive && !isSleeping && !isStopped;
  return {
    acknowledgeAttention: activity === "attention",
    attach: canAttach,
    focus: canInteract,
    kill: !isStopped,
    readText: canInteract,
    sendMessage: canInteract,
    sendText: canInteract,
    sleep: canInteract,
    wake: isSleeping,
  };
}

function effectivePresentationLifecycleState(
  session: GxserverSessionDomainState,
): GxserverSessionDomainState["lifecycleState"] {
  /*
  CDXC:GxserverSessionLifecycle 2026-06-07-17:56:
  TUI, Android, and iOS create and attach sessions through gxserver, while macOS renders the shared presentation feed. A non-stopped zmx-backed row with providerState=exists must project as running even when an older client-created row still has domain lifecycle=unknown, so clients do not duplicate server repair logic.
  */
  if (hasActiveProviderSession(session)) {
    return "running";
  }
  return session.lifecycleState;
}

function hasActiveProviderSession(session: GxserverSessionDomainState): boolean {
  return session.lifecycleState !== "stopped" && providerSessionStateForDomainSession(session) === "exists";
}

/*
CDXC:GxserverPresentation 2026-06-15-17:32:
Sidebar rows need provider liveness separately from domain lifecycle. A row can be `running` because native has a mounted pane, while gxserver still knows the zmx provider is missing or persistence is disabled; publish that distinction so clients do not treat every running row as a valid zmx focus target.
*/
function providerSessionStateForDomainSession(
  session: GxserverSessionDomainState,
): GxserverPresentationSession["providerSessionState"] {
  const provider = readSessionPersistenceProvider(session);
  if (provider === "off") {
    return "persistence-disabled";
  }
  switch (session.providerState.lifecycleState) {
    case "exists":
      return "exists";
    case "missing":
      return "missing";
    case "unknown":
    default:
      return "unknown";
  }
}

function sessionPersistenceProviderForDomainSession(
  session: GxserverSessionDomainState,
): GxserverPresentationSession["sessionPersistenceProvider"] | undefined {
  const provider = readSessionPersistenceProvider(session);
  return provider === "tmux" || provider === "zellij" || provider === "zmx" ? provider : undefined;
}

function readSessionPersistenceProvider(session: GxserverSessionDomainState): string | undefined {
  return readText(session.runtimeSettings.sessionPersistenceProvider) ?? readText(session.providerState.provider);
}

export function isActivePresentationSession(session: GxserverSessionDomainState): boolean {
  return ACTIVE_LIFECYCLE_STATES.has(effectivePresentationLifecycleState(session));
}

export function isVisibleInWorkspaceSidebar(session: GxserverSessionDomainState): boolean {
  return session.surface === "workspace" && isActivePresentationSession(session);
}

export function shouldIncludePresentationSession(session: GxserverSessionDomainState): boolean {
  return isActivePresentationSession(session) || session.isPinned || session.isFavorite || Boolean(session.sessionTag);
}

export function defaultGroupId(projectId: string): string {
  return `${projectId}:active`;
}

function selectPresentationSessions(sessions: readonly GxserverSessionDomainState[]): GxserverSessionDomainState[] {
  const active = sessions.filter(isActivePresentationSession);
  const pinnedStopped = sessions
    .filter((session) => !isActivePresentationSession(session) && shouldIncludePresentationSession(session))
    .sort(compareDomainSessions)
    .slice(0, RECENT_STOPPED_LIMIT_PER_PROJECT);
  return [...active, ...pinnedStopped];
}

function normalizePresentationActivityState(value: unknown, generatedAt: string | undefined): {
  activity: GxserverPresentationSessionActivity;
  attention?: GxserverPresentationAttentionState;
} {
  const generatedAtMs = generatedAt ? Date.parse(generatedAt) : Number.NaN;
  const state = getEffectiveAgentActivityState(
    value,
    { activity: "idle" },
    Number.isFinite(generatedAtMs) ? generatedAtMs : Date.now(),
  );
  const activity = state.activity === "attention" || state.activity === "working" ? state.activity : "idle";
  if (activity !== "attention") {
    return { activity };
  }
  /*
  CDXC:SessionAttention 2026-06-08-13:19:
  macOS receives fresh attention transitions through gxserver presentation deltas. Publish the same stable attention event id used by the activity state machine so clients can play completion side effects once for a new event while ignoring startup snapshots, stream recovery snapshots, and stale replays.
  */
  const eventId = readText(state.attentionEventId) ?? readText(state.lastChangedAt);
  return {
    activity,
    attention: {
      acknowledged: state.isAcknowledged === true,
      ...(typeof state.lastChangedAt === "string" ? { enteredAt: state.lastChangedAt } : {}),
      ...(eventId ? { eventId } : {}),
    },
  };
}

function normalizeTitleObservationState(value: unknown): GxserverTitleObservationState | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }
  const status = readTitleObservationStatus(value.status);
  if (!status) {
    return undefined;
  }
  const failureCount = readFailureCount(value.failureCount);
  const lastFailedAt = readText(value.lastFailedAt);
  const lastObservedAt = readText(value.lastObservedAt);
  const lastStartedAt = readText(value.lastStartedAt);
  const nextRetryAt = readText(value.nextRetryAt);
  /*
  CDXC:SessionStatus 2026-06-07-00:30:
  Project only coarse zmx title-observer state into shared session rows. Clients need this to distinguish idle from unknown-detection during watcher startup/retry, but raw titles, terminal text, commands, paths, and stderr must stay out of presentation payloads.
  */
  return {
    ...(failureCount !== undefined ? { failureCount } : {}),
    ...(lastFailedAt ? { lastFailedAt } : {}),
    ...(lastObservedAt ? { lastObservedAt } : {}),
    ...(lastStartedAt ? { lastStartedAt } : {}),
    ...(nextRetryAt ? { nextRetryAt } : {}),
    status,
  };
}

function readTitleObservationStatus(value: unknown): GxserverTitleObservationState["status"] | undefined {
  switch (value) {
    case "active":
    case "failed":
    case "retrying":
    case "starting":
      return value;
    default:
      return undefined;
  }
}

function readFailureCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function buildSessionTooltip(
  project: GxserverProjectDomainState,
  session: GxserverSessionDomainState,
  title: string,
): string {
  return [title, project.name, session.cwd, session.agentId, session.commandId].filter(Boolean).join(" - ");
}

function projectSortKey(project: GxserverProjectDomainState): string {
  const pinRank = project.isPinned ? "0" : project.isFavorite ? "1" : "2";
  return `${pinRank}:${project.name.toLocaleLowerCase()}:${project.projectId}`;
}

export function resolvePresentationSessionLastActiveAt(session: GxserverSessionDomainState): string {
  /*
  CDXC:GxserverPresentationActivity 2026-06-07-05:17:
  Sidebar clients show the presentation row's lastActiveAt as the "last active" timer. Use the true activity timestamp when gxserver has one and fall back to the session created/restored timestamp; never use updatedAt because provider probes, title observation, and metadata writes can advance it without user activity and make old sessions render as 0s in macOS, Electron, and future clients.
  */
  return session.lastActiveAt ?? session.createdAt;
}

function sessionSortKey(session: GxserverSessionDomainState): string {
  const activeRank = isActivePresentationSession(session) ? "0" : "1";
  const pinRank = session.isPinned
    ? "0"
    : session.sessionTag === "favorite" || session.isFavorite
      ? "1"
      : "2";
  /*
  CDXC:PinnedSessions 2026-06-02-20:11:
  Pinned sessions under a project need a durable user-defined order. Sort rows by
  the explicit gxserver sidebar order before recency so drag-to-reorder cannot
  be undone by the next presentation snapshot or lifecycle/title delta.

  CDXC:ManualSessionSorting 2026-06-05-12:30:
  Manual Sorting uses the same gxserver sidebar order for non-pinned sessions.
  New sessions receive order 0, while saved manual snapshots start at 1000, so
  new rows land at the top and previously ordered rows keep their saved order.
  Put sidebar order before active/pinned rank so manual mode can move pinned,
  stopped, and non-pinned rows freely; last-active mode applies its own display
  partitions in the shared sidebar sorter.
  */
  const sidebarOrder = formatSidebarOrder(session.sidebarOrder);
  return `${sidebarOrder}:${activeRank}:${pinRank}:${resolvePresentationSessionLastActiveAt(session)}:${session.sessionId}`;
}

function formatSidebarOrder(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? String(Math.floor(value)).padStart(12, "0")
    : "z";
}

function compareProjects(left: GxserverProjectDomainState, right: GxserverProjectDomainState): number {
  return projectSortKey(left).localeCompare(projectSortKey(right));
}

function compareDomainSessions(left: GxserverSessionDomainState, right: GxserverSessionDomainState): number {
  return sessionSortKey(left).localeCompare(sessionSortKey(right));
}

function comparePresentationSessions(
  left: GxserverPresentationSession,
  right: GxserverPresentationSession,
): number {
  return left.sortKey.localeCompare(right.sortKey);
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
