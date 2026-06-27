import {
  GRID_COLUMN_COUNT,
  clampVisibleSessionCount,
  type SidebarSessionGroup,
  type SidebarSessionItem,
} from "./session-grid-contract";
import type {
  GxserverDomainLifecycleState,
  GxserverPresentationProject,
  GxserverPresentationSession,
  GxserverPresentationSnapshot,
} from "./gxserver-protocol";
import { createDefaultSidebarProjectDiffStats } from "./project-diff-stats";
import { orderProjectsWithWorktrees } from "./project-worktree-order";

export const GXSERVER_PRESENTATION_CHATS_GROUP_ID = "combined-chats";

const GXSERVER_PRESENTATION_PROJECT_GROUP_ID_PREFIX = "combined-project:";
const GXSERVER_PRESENTATION_PROJECT_SESSION_ID_PREFIX = "combined-session:";
const GXSERVER_PRESENTATION_ID_SEPARATOR = ":";

export type GxserverPresentationSidebarSessionKey = string;

export type GxserverPresentationSidebarSessionReference = {
  projectId: string;
  sessionId: string;
};

export type GxserverPresentationDelayedSendProjection = {
  deadlineAt?: string;
  remainingLabel?: string;
  remainingMs?: number;
};

export type GxserverPresentationCloseAfterDoneProjection = {
  armed: boolean;
  deadlineAt?: string;
  remainingLabel?: string;
  remainingMs?: number;
};

export type GxserverPresentationSidebarProjectOverlay = {
  editor?: NonNullable<SidebarSessionGroup["projectContext"]>["editor"];
  iconDataUrl?: string;
  isChatProject?: boolean;
  isQuickProject?: boolean;
  orderIndex?: number;
  path?: string;
  projectId: string;
  theme?: NonNullable<SidebarSessionGroup["projectContext"]>["theme"];
  themeColor?: string;
  title?: string;
  worktree?: NonNullable<SidebarSessionGroup["projectContext"]>["worktree"];
};

export type GxserverPresentationSidebarInput = {
  activeProjectId?: string;
  chatProjectIds?: ReadonlySet<string>;
  focusedSessionId?: string;
  hiddenProjectIds?: ReadonlySet<string>;
  hiddenSessionKeys?: ReadonlySet<GxserverPresentationSidebarSessionKey>;
  presentation: GxserverPresentationSnapshot;
  projectOverlays?: readonly GxserverPresentationSidebarProjectOverlay[];
  resolveAgentIcon: (agentName: string | undefined) => SidebarSessionItem["agentIcon"];
  resolveCloseAfterDone?: (
    projectId: string,
    sessionId: string,
  ) => GxserverPresentationCloseAfterDoneProjection | undefined;
  resolveDelayedSend?: (
    projectId: string,
    sessionId: string,
  ) => GxserverPresentationDelayedSendProjection | undefined;
  resolveSessionRoutingId?: (projectId: string, sessionId: string) => string | undefined;
  visibleSessionIds?: ReadonlySet<string>;
};

export type GxserverPresentationSidebarSessionInput = {
  createProjectSessionId?: (projectId: string, sessionId: string) => string;
  focusedSessionId?: string;
  index: number;
  isActiveProject: boolean;
  localSession?: SidebarSessionItem;
  presentation: GxserverPresentationSession;
  projectId: string;
  resolveAgentIcon: (agentName: string | undefined) => SidebarSessionItem["agentIcon"];
  resolveCloseAfterDone?: (
    projectId: string,
    sessionId: string,
  ) => GxserverPresentationCloseAfterDoneProjection | undefined;
  resolveDelayedSend?: (
    projectId: string,
    sessionId: string,
  ) => GxserverPresentationDelayedSendProjection | undefined;
  resolveProviderSessionState?: (
    presentation: Pick<GxserverPresentationSession, "lifecycleState" | "providerSessionState">,
    localSession: SidebarSessionItem | undefined,
  ) => NonNullable<SidebarSessionItem["providerSessionState"]>;
  resolveSessionRoutingId?: (projectId: string, sessionId: string) => string | undefined;
  visibleSessionIds?: ReadonlySet<string>;
};

export type GxserverPresentationSidebarGroupInput = {
  activeProjectId?: string;
  canRemoveProject?: boolean;
  createProjectGroupId?: (projectId: string) => string;
  createProjectSessionId?: (projectId: string, sessionId: string) => string;
  extraSessions?: readonly SidebarSessionItem[];
  focusedSessionId?: string;
  project: GxserverPresentationProject;
  projectOverlay?: GxserverPresentationSidebarProjectOverlay;
  resolveAgentIcon: (agentName: string | undefined) => SidebarSessionItem["agentIcon"];
  resolveCloseAfterDone?: (
    projectId: string,
    sessionId: string,
  ) => GxserverPresentationCloseAfterDoneProjection | undefined;
  resolveDelayedSend?: (
    projectId: string,
    sessionId: string,
  ) => GxserverPresentationDelayedSendProjection | undefined;
  resolveLocalSession?: (projectId: string, sessionId: string) => SidebarSessionItem | undefined;
  resolveProviderSessionState?: (
    presentation: Pick<GxserverPresentationSession, "lifecycleState" | "providerSessionState">,
    localSession: SidebarSessionItem | undefined,
  ) => NonNullable<SidebarSessionItem["providerSessionState"]>;
  resolveSessionRoutingId?: (projectId: string, sessionId: string) => string | undefined;
  sessions: readonly GxserverPresentationSession[];
  visibleSessionIds?: ReadonlySet<string>;
};

/*
CDXC:GxserverPresentationParity 2026-06-24-10:45:
GPUI must render gxserver sessions through the same React sidebar contract as macOS. This shared projection maps gxserver presentation snapshots into sidebar groups without AppKit, filesystem, browser, or native pane ownership; platform wrappers may join local resource state through explicit overlay inputs.
*/
export function createGxserverPresentationSidebarGroups(
  input: GxserverPresentationSidebarInput,
): SidebarSessionGroup[] {
  const projectOverlaysById = new Map(
    (input.projectOverlays ?? []).map((project) => [project.projectId, project]),
  );
  const sessionsByProject = createGxserverPresentationSessionsByProjectFromGroups({
    hiddenProjectIds: input.hiddenProjectIds,
    hiddenSessionKeys: input.hiddenSessionKeys,
    presentation: input.presentation,
  });
  const visibleProjects = input.presentation.projects.filter(
    (project) => !input.hiddenProjectIds?.has(project.projectId),
  );
  const chatProjects = orderGxserverPresentationSidebarProjects(
    visibleProjects.filter((project) =>
      isGxserverPresentationChatProject(input, project, projectOverlaysById.get(project.projectId)),
    ),
    projectOverlaysById,
  );
  const chatSessions = chatProjects.flatMap((project) => {
    const isActiveProject = project.projectId === input.activeProjectId;
    return (sessionsByProject.get(project.projectId) ?? []).map((session, index) =>
      createGxserverPresentationSidebarSession({
        focusedSessionId: input.focusedSessionId,
        index,
        isActiveProject,
        presentation: session,
        projectId: project.projectId,
        resolveAgentIcon: input.resolveAgentIcon,
        resolveCloseAfterDone: input.resolveCloseAfterDone,
        resolveDelayedSend: input.resolveDelayedSend,
        resolveSessionRoutingId: input.resolveSessionRoutingId,
        visibleSessionIds: input.visibleSessionIds,
      }),
    );
  });
  const projectGroups = orderGxserverPresentationSidebarProjects(
    visibleProjects.filter((project) =>
      !isGxserverPresentationChatProject(input, project, projectOverlaysById.get(project.projectId)),
    ),
    projectOverlaysById,
  ).map((project) =>
    createGxserverPresentationSidebarGroup({
      activeProjectId: input.activeProjectId,
      focusedSessionId: input.focusedSessionId,
      project,
      projectOverlay: projectOverlaysById.get(project.projectId),
      resolveAgentIcon: input.resolveAgentIcon,
      resolveCloseAfterDone: input.resolveCloseAfterDone,
      resolveDelayedSend: input.resolveDelayedSend,
      resolveSessionRoutingId: input.resolveSessionRoutingId,
      sessions: sessionsByProject.get(project.projectId) ?? [],
      visibleSessionIds: input.visibleSessionIds,
    }),
  );

  return [
    {
      groupId: GXSERVER_PRESENTATION_CHATS_GROUP_ID,
      isActive:
        chatProjects.some((project) => project.projectId === input.activeProjectId) ||
        (input.projectOverlays ?? []).some(
          (project) =>
            project.projectId === input.activeProjectId &&
            (project.isQuickProject === true || project.isChatProject === true),
        ),
      isChatCollection: true,
      isFocusModeActive: false,
      kind: "workspace",
      layoutVisibleCount: visibleCountForGxserverPresentationSidebarSessions(chatSessions),
      sessions: chatSessions,
      title: "Chats",
      viewMode: "grid",
      visibleCount: visibleCountForGxserverPresentationSidebarSessions(chatSessions),
    },
    ...projectGroups,
  ];
}

export function createGxserverPresentationSessionsByProjectFromGroups({
  hiddenProjectIds,
  hiddenSessionKeys,
  presentation,
}: {
  hiddenProjectIds?: ReadonlySet<string>;
  hiddenSessionKeys?: ReadonlySet<GxserverPresentationSidebarSessionKey>;
  presentation: GxserverPresentationSnapshot;
}): Map<string, GxserverPresentationSession[]> {
  const sessionByProjectSessionKey = new Map(
    presentation.sessions.map((session) => [
      createGxserverPresentationSidebarSessionKey(session.projectId, session.sessionId),
      session,
    ]),
  );
  const sessionsByProject = new Map<string, GxserverPresentationSession[]>();
  for (const group of presentation.groups) {
    if (hiddenProjectIds?.has(group.projectId)) {
      continue;
    }
    const sessions = sessionsByProject.get(group.projectId) ?? [];
    for (const sessionId of group.sessionIds) {
      const session = sessionByProjectSessionKey.get(
        createGxserverPresentationSidebarSessionKey(group.projectId, sessionId),
      );
      if (
        !session ||
        session.visibleInSidebarByDefault !== true ||
        session.surface === "commands" ||
        hiddenSessionKeys?.has(
          createGxserverPresentationSidebarSessionKey(session.projectId, session.sessionId),
        )
      ) {
        continue;
      }
      sessions.push(session);
    }
    sessionsByProject.set(group.projectId, sessions);
  }
  return sessionsByProject;
}

export function createGxserverPresentationSidebarGroup({
  activeProjectId,
  canRemoveProject = true,
  createProjectGroupId = createGxserverPresentationProjectGroupId,
  createProjectSessionId = createGxserverPresentationProjectSessionId,
  extraSessions = [],
  focusedSessionId,
  project,
  projectOverlay,
  resolveAgentIcon,
  resolveCloseAfterDone,
  resolveDelayedSend,
  resolveLocalSession,
  resolveProviderSessionState,
  resolveSessionRoutingId,
  sessions,
  visibleSessionIds,
}: GxserverPresentationSidebarGroupInput): SidebarSessionGroup {
  const isActiveProject = project.projectId === activeProjectId;
  const presentationSidebarSessions = sessions.map((session, index) =>
    createGxserverPresentationSidebarSession({
      createProjectSessionId,
      focusedSessionId,
      index,
      isActiveProject,
      localSession: resolveLocalSession?.(project.projectId, session.sessionId),
      presentation: session,
      projectId: project.projectId,
      resolveAgentIcon,
      resolveCloseAfterDone,
      resolveDelayedSend,
      resolveProviderSessionState,
      resolveSessionRoutingId,
      visibleSessionIds,
    }),
  );
  const sidebarSessions = [...presentationSidebarSessions, ...extraSessions];
  const projectContext = {
    canRemoveProject,
    editor: projectOverlay?.editor ?? createIdleGxserverPresentationProjectEditorState(project.projectId),
    iconDataUrl: projectOverlay?.iconDataUrl,
    path: projectOverlay?.path || project.path || "",
    theme: projectOverlay?.theme,
    themeColor: projectOverlay?.themeColor,
    worktree: projectOverlay?.worktree,
  };
  return {
    groupId: createProjectGroupId(project.projectId),
    canFocusMode: false,
    isActive: isActiveProject,
    isFocusModeActive: false,
    kind: "workspace",
    layoutVisibleCount: visibleCountForGxserverPresentationSidebarSessions(sidebarSessions),
    projectContext,
    sessions: sidebarSessions,
    title: project.title,
    viewMode: "grid",
    visibleCount: visibleCountForGxserverPresentationSidebarSessions(sidebarSessions),
  };
}

export function createGxserverPresentationSidebarSession({
  createProjectSessionId = createGxserverPresentationProjectSessionId,
  focusedSessionId,
  index,
  isActiveProject,
  localSession,
  presentation,
  projectId,
  resolveAgentIcon,
  resolveCloseAfterDone,
  resolveDelayedSend,
  resolveProviderSessionState,
  resolveSessionRoutingId,
  visibleSessionIds,
}: GxserverPresentationSidebarSessionInput): SidebarSessionItem {
  const lifecycleState = presentationLifecycleStateForSidebar(presentation.lifecycleState);
  const nativePaneState = localSession?.nativePaneState;
  const providerSessionState =
    resolveProviderSessionState?.(presentation, localSession) ??
    providerSessionStateForGxserverPresentation(presentation);
  const isLive =
    providerSessionState === "exists" ||
    nativePaneState === "mounted" ||
    nativePaneState === "mounting";
  const closeAfterDone = resolveCloseAfterDone?.(projectId, presentation.sessionId);
  const delayedSend = resolveDelayedSend?.(projectId, presentation.sessionId);
  return {
    activity: presentation.activity,
    agentIcon: resolveAgentIcon(presentation.agentIcon ?? presentation.agentName ?? presentation.agentId),
    agentSessionId: presentation.agentSessionId ?? localSession?.agentSessionId,
    alias: presentation.title,
    closeAfterDone: closeAfterDone?.armed,
    closeAfterDoneDeadlineAt: closeAfterDone?.deadlineAt,
    closeAfterDoneRemainingLabel: closeAfterDone?.remainingLabel,
    closeAfterDoneRemainingMs: closeAfterDone?.remainingMs,
    column: index % GRID_COLUMN_COUNT,
    detail: presentation.subtitle,
    delayedSendDeadlineAt: delayedSend?.deadlineAt,
    delayedSendRemainingLabel: delayedSend?.remainingLabel,
    delayedSendRemainingMs: delayedSend?.remainingMs,
    displayTitle: presentation.displayTitle,
    displayTitleTooltip: presentation.displayTitleTooltip,
    isFavorite: presentation.isFavorite,
    isFocused: isActiveProject && focusedSessionId === presentation.sessionId,
    isGeneratingFirstPromptTitle: presentation.isGeneratingFirstPromptTitle,
    isLive,
    isPinned: presentation.isPinned,
    isPrimaryTitleTerminalTitle: presentation.isPrimaryTitleTerminalTitle,
    isRunning: isLive,
    isSleeping: lifecycleState === "sleeping",
    isVisible: isActiveProject && (
      visibleSessionIds?.has(presentation.sessionId) === true ||
      index === 0
    ),
    lastInteractionAt: presentation.lastActiveAt ?? presentation.updatedAt,
    lifecycleState,
    nativePaneState,
    primaryTitle: presentation.primaryTitle ?? presentation.title,
    providerSessionState,
    row: Math.floor(index / GRID_COLUMN_COUNT),
    sessionId: createProjectSessionId(projectId, presentation.sessionId),
    sessionKind: presentation.kind === "agent" ? "terminal" : presentation.kind,
    sessionTag: presentation.sessionTag,
    sessionNumber: String(index + 1),
    sessionPersistenceName: presentation.zmxName,
    sessionPersistenceProvider: presentation.sessionPersistenceProvider,
    sessionRoutingId: resolveSessionRoutingId?.(projectId, presentation.sessionId),
    shortcutLabel: String(index + 1),
    terminalTitle: presentation.terminalTitle,
    titleObservation: presentation.titleObservation,
  };
}

export function presentationLifecycleStateForSidebar(
  lifecycleState: GxserverDomainLifecycleState,
): NonNullable<SidebarSessionItem["lifecycleState"]> {
  switch (lifecycleState) {
    case "running":
      return "running";
    case "sleeping":
      return "sleeping";
    case "missing":
    case "unknown":
      return "error";
    case "stopped":
    default:
      return "done";
  }
}

export function providerSessionStateForGxserverPresentation(
  presentation: Pick<GxserverPresentationSession, "lifecycleState" | "providerSessionState">,
): NonNullable<SidebarSessionItem["providerSessionState"]> {
  /*
  CDXC:GxserverPresentation 2026-06-24-10:45:
  Provider liveness is a shared gxserver presentation concept, while platform panes are optional overlays. Resolve the daemon-published provider state here so macOS and GPUI cards agree on zmx/tmux/zellij liveness before any local resource override is applied.
  */
  if (presentation.providerSessionState) {
    return presentation.providerSessionState;
  }
  switch (presentation.lifecycleState) {
    case "running":
      return "exists";
    case "sleeping":
    case "missing":
    case "stopped":
      return "missing";
    case "unknown":
    default:
      return "unknown";
  }
}

export function orderGxserverPresentationSidebarProjects(
  presentationProjects: readonly GxserverPresentationProject[],
  projectOverlaysById: ReadonlyMap<string, GxserverPresentationSidebarProjectOverlay> = new Map(),
): GxserverPresentationProject[] {
  const presentationProjectById = new Map(
    presentationProjects.map((project) => [project.projectId, project]),
  );
  return orderProjectsWithWorktrees(
    [...presentationProjects]
      .sort((left, right) => {
        const leftLocalIndex = projectOverlaysById.get(left.projectId)?.orderIndex;
        const rightLocalIndex = projectOverlaysById.get(right.projectId)?.orderIndex;
        if (leftLocalIndex !== undefined || rightLocalIndex !== undefined) {
          return (leftLocalIndex ?? Number.MAX_SAFE_INTEGER) - (rightLocalIndex ?? Number.MAX_SAFE_INTEGER);
        }
        return (
          left.sortKey.localeCompare(right.sortKey) ||
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.projectId.localeCompare(right.projectId)
        );
      })
      .map((project) => {
        const overlay = projectOverlaysById.get(project.projectId);
        return {
          isChat: overlay?.isChatProject,
          isQuick: overlay?.isQuickProject,
          orderIndex: overlay?.orderIndex ?? Number.MAX_SAFE_INTEGER,
          project,
          projectId: project.projectId,
          sortKey: project.sortKey,
          updatedAt: project.updatedAt,
          worktree: overlay?.worktree,
        };
      }),
  )
    .map((item) => presentationProjectById.get(item.projectId))
    .filter((project): project is GxserverPresentationProject => project !== undefined);
}

export function createGxserverPresentationSidebarSessionKey(
  projectId: string,
  sessionId: string,
): GxserverPresentationSidebarSessionKey {
  return `${projectId}\u0000${sessionId}`;
}

export function createGxserverPresentationProjectGroupId(projectId: string): string {
  return `${GXSERVER_PRESENTATION_PROJECT_GROUP_ID_PREFIX}${encodeGxserverPresentationIdPart(projectId)}`;
}

export function parseGxserverPresentationProjectGroupId(groupId: string): string | undefined {
  if (!groupId.startsWith(GXSERVER_PRESENTATION_PROJECT_GROUP_ID_PREFIX)) {
    return undefined;
  }
  return decodeGxserverPresentationIdPart(groupId.slice(GXSERVER_PRESENTATION_PROJECT_GROUP_ID_PREFIX.length));
}

export function createGxserverPresentationProjectSessionId(projectId: string, sessionId: string): string {
  return [
    GXSERVER_PRESENTATION_PROJECT_SESSION_ID_PREFIX,
    encodeGxserverPresentationIdPart(projectId),
    GXSERVER_PRESENTATION_ID_SEPARATOR,
    encodeGxserverPresentationIdPart(sessionId),
  ].join("");
}

export function parseGxserverPresentationProjectSessionId(
  sessionId: string,
): GxserverPresentationSidebarSessionReference | undefined {
  if (!sessionId.startsWith(GXSERVER_PRESENTATION_PROJECT_SESSION_ID_PREFIX)) {
    return undefined;
  }
  const payload = sessionId.slice(GXSERVER_PRESENTATION_PROJECT_SESSION_ID_PREFIX.length);
  const separatorIndex = payload.indexOf(GXSERVER_PRESENTATION_ID_SEPARATOR);
  if (separatorIndex < 0) {
    return undefined;
  }
  const projectId = decodeGxserverPresentationIdPart(payload.slice(0, separatorIndex));
  const originalSessionId = decodeGxserverPresentationIdPart(payload.slice(separatorIndex + 1));
  if (!projectId || !originalSessionId) {
    return undefined;
  }
  return {
    projectId,
    sessionId: originalSessionId,
  };
}

export function originalGxserverPresentationSidebarSessionId(sessionId: string): string {
  return parseGxserverPresentationProjectSessionId(sessionId)?.sessionId ?? sessionId;
}

export function combineGxserverPresentationSidebarSession(
  projectId: string,
  session: SidebarSessionItem,
  createProjectSessionId = createGxserverPresentationProjectSessionId,
): SidebarSessionItem {
  return {
    ...session,
    sessionId: createProjectSessionId(projectId, originalGxserverPresentationSidebarSessionId(session.sessionId)),
  };
}

export function createIdleGxserverPresentationProjectEditorState(
  projectId: string,
): NonNullable<SidebarSessionGroup["projectContext"]>["editor"] {
  return {
    diffStats: createDefaultSidebarProjectDiffStats(),
    isOpen: false,
    isSleeping: false,
    projectId,
    status: "idle",
  };
}

export function visibleCountForGxserverPresentationSidebarSessions(
  sessions: readonly SidebarSessionItem[],
) {
  return clampVisibleSessionCount(Math.max(1, sessions.filter((session) => session.isVisible).length));
}

function isGxserverPresentationChatProject(
  input: Pick<GxserverPresentationSidebarInput, "chatProjectIds">,
  project: GxserverPresentationProject,
  projectOverlay: GxserverPresentationSidebarProjectOverlay | undefined,
): boolean {
  return projectOverlay?.isQuickProject === true ||
    projectOverlay?.isChatProject === true ||
    input.chatProjectIds?.has(project.projectId) === true;
}

function encodeGxserverPresentationIdPart(value: string): string {
  return encodeURIComponent(value);
}

function decodeGxserverPresentationIdPart(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
