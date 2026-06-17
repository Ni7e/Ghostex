import type {
  GxserverPresentationSearchParams,
  GxserverPresentationSearchResponse,
  GxserverPresentationSearchResult,
  GxserverProjectDomainState,
  GxserverSessionDomainState,
} from "../../protocol/index.js";
import type { GxserverPresentationReadModel } from "./repository.js";
import { isActivePresentationSession, resolvePresentationSessionLastActiveAt } from "./projector.js";
import { projectSessionTitle } from "../session-title/projection.js";
import { getTrustedResumeTitle } from "../session-title/trust.js";

const DEFAULT_SEARCH_LIMIT = 40;
const MAX_SEARCH_LIMIT = 100;

/*
CDXC:GxserverPresentationSearch 2026-06-01-15:08:
Sidebar and Previous Sessions search are metadata-only in this pass. Query gxserver's project/session records on demand with limit/cursor instead of preloading old sessions into React or adding an FTS table before metadata search proves insufficient.
*/
export function searchGxserverPresentationSessions(
  state: GxserverPresentationReadModel,
  params: GxserverPresentationSearchParams,
): GxserverPresentationSearchResponse {
  const { candidates, limit, offset, projectsById } = collectPresentationSearchCandidates(state, params);
  const sortedCandidates = candidates.sort((left, right) => compareSessionRecency(left.session, right.session));
  const page = sortedCandidates.slice(offset, offset + limit);
  return {
    cursor: offset + limit < sortedCandidates.length ? String(offset + limit) : undefined,
    results: page.map(({ match, session }) =>
      toSearchResult(projectsById.get(session.projectId), session, match ?? { field: "title" as const }),
    ),
  };
}

function collectPresentationSearchCandidates(
  state: GxserverPresentationReadModel,
  params: GxserverPresentationSearchParams,
): {
  candidates: Array<{
    match: GxserverPresentationSearchResult["match"] | undefined;
    session: GxserverSessionDomainState;
  }>;
  limit: number;
  offset: number;
  projectsById: Map<string, GxserverProjectDomainState>;
} {
  const limit = normalizeLimit(params.limit);
  const offset = normalizeCursor(params.cursor);
  const includeActive = params.includeActive !== false;
  const includePrevious = params.includePrevious !== false;
  const query = normalizeQuery(params.query);
  const sessionTags = normalizeSessionTags(params.sessionTags);
  const projectsById = new Map(state.projects.map((project) => [project.projectId, project]));
  const candidates = state.sessions
    .filter((session) => !params.projectId || session.projectId === params.projectId)
    .filter((session) => sessionTags.length === 0 || (session.sessionTag && sessionTags.includes(session.sessionTag)))
    .filter((session) => {
      const active = isActivePresentationSession(session);
      return (active && includeActive) || (!active && includePrevious);
    })
    .map((session) => ({ match: matchSession(projectsById.get(session.projectId), session, query), session }))
    .filter((candidate) => !query || candidate.match);
  return {
    candidates,
    limit,
    offset,
    projectsById,
  };
}

export function searchGxserverPreviousSessions(
  state: GxserverPresentationReadModel,
  params: GxserverPresentationSearchParams,
): GxserverPresentationSearchResponse {
  /*
  CDXC:PreviousSessions 2026-06-04-20:21:
  The Previous Sessions modal is a restore surface, not a dump of every inactive gxserver row. Return stopped sessions with trusted resume titles plus explicitly pinned/favorited rows, so placeholder terminals created during migration or startup do not keep reappearing without useful activity metadata.

  CDXC:PreviousSessions 2026-06-07-05:28:
  Command-pane runs such as `bun run start` are reusable tool output, not restorable workspace history. Exclude the commands surface in gxserver before pin/favorite/title exceptions so every client receives the same Previous Sessions list without adding local modal filters.

  CDXC:PreviousSessions 2026-06-17-17:06:
  The Previous Sessions modal is a close-history surface. Sort and page stopped rows by the provider close timestamp instead of lastActiveAt so a session closed now is immediately near the top even if its last user activity was older.
  */
  const { candidates, limit, offset, projectsById } = collectPresentationSearchCandidates(
    {
      projects: state.projects,
      sessions: state.sessions.filter(isPreviousSessionHistoryCandidate),
    },
    {
      ...params,
      includeActive: false,
      includePrevious: true,
    },
  );
  const sortedCandidates = candidates.sort((left, right) =>
    comparePreviousSessionClosedRecency(left.session, right.session),
  );
  const page = sortedCandidates.slice(offset, offset + limit);
  return {
    cursor: offset + limit < sortedCandidates.length ? String(offset + limit) : undefined,
    results: page.map(({ match, session }) => ({
      ...toSearchResult(projectsById.get(session.projectId), session, match ?? { field: "title" as const }),
      closedAt: resolvePreviousSessionClosedAt(session),
    })),
  };
}

function toSearchResult(
  project: GxserverProjectDomainState | undefined,
  session: GxserverSessionDomainState,
  match: NonNullable<GxserverPresentationSearchResult["match"]>,
): GxserverPresentationSearchResult {
  const titleProjection = projectSessionTitle(session);
  const agentName = readText(session.runtimeSettings.agentName) ?? session.agentId;
  const agentSessionId = readText(session.runtimeSettings.agentSessionId);
  const agentSessionPath = readText(session.runtimeSettings.agentSessionPath);
  const sessionPersistenceProvider = readSearchSessionPersistenceProvider(session);
  const sessionPersistenceName = readSearchSessionPersistenceName(session, sessionPersistenceProvider);
  /*
  CDXC:GxserverPresentationSearch 2026-06-01-22:06:
  Previous Sessions uses the same session-card renderer as the live sidebar. Search results must carry gxserver's full title projection, not only `title`, so every client can suppress the unsynced `∗` marker for terminal-synced persisted titles and keep placeholders marked.

  CDXC:GxserverPresentationActivity 2026-06-07-05:17:
  Search rows also feed client sidebar/history cards. Return the same resolved lastActiveAt as the live presentation snapshot so clients do not reinterpret metadata updatedAt as recent user activity.

  CDXC:PreviousSessions 2026-06-13-15:36:
  Stopped gxserver sessions are the canonical Previous Sessions source after close. Carry compact agent identity and provider routing metadata in search results so clients can render the assigned agent and seed restore records without reviving native archived-session caches or exposing raw first prompts.
  */
  return {
    ...(session.agentId ? { agentIcon: session.agentId } : {}),
    ...(session.agentId ? { agentId: session.agentId } : {}),
    ...(agentName ? { agentName } : {}),
    ...(agentSessionId ? { agentSessionId } : {}),
    ...(agentSessionPath ? { agentSessionPath } : {}),
    createdAt: session.createdAt,
    ...(session.cwd ? { cwd: session.cwd } : {}),
    displayTitle: titleProjection.displayTitle,
    displayTitleTooltip: titleProjection.displayTitleTooltip,
    isFavorite: session.sessionTag === "favorite" || session.isFavorite,
    isPinned: session.isPinned,
    isPrimaryTitleTerminalTitle: titleProjection.isPrimaryTitleTerminalTitle,
    isTemporaryTitle: titleProjection.isTemporaryTitle,
    lastActiveAt: resolvePresentationSessionLastActiveAt(session),
    lifecycleState: session.lifecycleState,
    match,
    projectId: session.projectId,
    projectTitle: project?.name ?? session.projectId,
    ...(titleProjection.primaryTitle !== undefined ? { primaryTitle: titleProjection.primaryTitle } : {}),
    sessionId: session.sessionId,
    ...(sessionPersistenceName ? { sessionPersistenceName } : {}),
    ...(sessionPersistenceProvider ? { sessionPersistenceProvider } : {}),
    ...(session.sessionTag ? { sessionTag: session.sessionTag } : {}),
    ...(session.sidebarOrder !== undefined ? { sidebarOrder: session.sidebarOrder } : {}),
    subtitle: session.cwd ?? project?.path,
    surface: session.surface,
    ...(titleProjection.terminalTitle !== undefined ? { terminalTitle: titleProjection.terminalTitle } : {}),
    title: titleProjection.title,
    titleSource: titleProjection.titleSource,
    ...(titleProjection.trustedResumeTitle !== undefined ? { trustedResumeTitle: titleProjection.trustedResumeTitle } : {}),
    updatedAt: session.updatedAt,
    zmxName: session.zmxName,
  };
}

function readSearchSessionPersistenceProvider(
  session: GxserverSessionDomainState,
): GxserverPresentationSearchResult["sessionPersistenceProvider"] | undefined {
  const value = readText(session.runtimeSettings.sessionPersistenceProvider) ?? readText(session.providerState.provider);
  return value === "tmux" || value === "zmx" || value === "zellij" ? value : undefined;
}

function readSearchSessionPersistenceName(
  session: GxserverSessionDomainState,
  provider: GxserverPresentationSearchResult["sessionPersistenceProvider"] | undefined,
): string | undefined {
  if (!provider) {
    return undefined;
  }
  if (provider === "zmx") {
    return readText(session.providerState.zmxName) ?? session.zmxName;
  }
  return readText(session.providerState.providerName) ?? readText(session.runtimeSettings.sessionPersistenceName);
}

function isPreviousSessionHistoryCandidate(session: GxserverSessionDomainState): boolean {
  if (session.surface !== "workspace") {
    return false;
  }
  if (isActivePresentationSession(session)) {
    return false;
  }
  if (session.isPinned || session.isFavorite || session.sessionTag) {
    return true;
  }
  if (session.lifecycleState !== "stopped") {
    return false;
  }
  return getTrustedResumeTitle(session).title !== undefined;
}

function normalizeSessionTags(
  values: GxserverPresentationSearchParams["sessionTags"],
): NonNullable<GxserverPresentationSearchParams["sessionTags"]> {
  return values?.filter((value, index, allValues) => allValues.indexOf(value) === index) ?? [];
}

function matchSession(
  project: GxserverProjectDomainState | undefined,
  session: GxserverSessionDomainState,
  query: string,
): GxserverPresentationSearchResult["match"] | undefined {
  if (!query) {
    return { field: "title" };
  }
  const titleProjection = projectSessionTitle(session);
  const fields: Array<{ field: NonNullable<GxserverPresentationSearchResult["match"]>["field"]; value?: string }> = [
    { field: "title", value: titleProjection.title },
    { field: "title", value: titleProjection.primaryTitle },
    { field: "title", value: titleProjection.terminalTitle },
    { field: "agent", value: session.agentId },
    { field: "agent", value: readText(session.runtimeSettings.agentName) },
    { field: "project", value: project?.name },
    { field: "project", value: project?.path },
    { field: "cwd", value: session.cwd },
    { field: "command", value: session.commandId },
    { field: "id", value: session.sessionId },
    { field: "id", value: session.globalRef },
    { field: "timestamp", value: session.createdAt },
    { field: "timestamp", value: session.updatedAt },
    { field: "timestamp", value: resolvePresentationSessionLastActiveAt(session) },
  ];
  for (const field of fields) {
    if (field.value?.toLocaleLowerCase().includes(query)) {
      return { field: field.field, snippet: field.value };
    }
  }
  return undefined;
}

function compareSessionRecency(left: GxserverSessionDomainState, right: GxserverSessionDomainState): number {
  const leftTime = resolvePresentationSessionLastActiveAt(left);
  const rightTime = resolvePresentationSessionLastActiveAt(right);
  const byTime = rightTime.localeCompare(leftTime);
  return byTime || left.sessionId.localeCompare(right.sessionId);
}

function comparePreviousSessionClosedRecency(
  left: GxserverSessionDomainState,
  right: GxserverSessionDomainState,
): number {
  const byTime = resolvePreviousSessionClosedAt(right).localeCompare(resolvePreviousSessionClosedAt(left));
  return byTime || left.sessionId.localeCompare(right.sessionId);
}

function resolvePreviousSessionClosedAt(session: GxserverSessionDomainState): string {
  const providerClosedAt =
    session.lifecycleState === "stopped" && session.providerState.lifecycleState === "missing"
      ? readText(session.providerState.probedAt)
      : undefined;
  return providerClosedAt ?? session.updatedAt ?? session.createdAt;
}

function normalizeQuery(query: unknown): string {
  return typeof query === "string" ? query.trim().toLocaleLowerCase() : "";
}

function normalizeLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_SEARCH_LIMIT;
  }
  return Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.trunc(limit)));
}

function normalizeCursor(cursor: unknown): number {
  if (typeof cursor !== "string" || !/^\d+$/.test(cursor)) {
    return 0;
  }
  return Math.max(0, Number.parseInt(cursor, 10));
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
