import { projectViewSpaceOptions } from '@/packages/shared/ghostex-settings/project-views';
/*
CDXC:RepoStructure 2026-08-22:
Split out of the single 21,861-line `gxserver-runtime.ts`. Pure move: no logic
changed. See `core.ts` for how the runtime's methods are re-attached.
*/
import { GPUI_DEFAULT_VISIBLE_COUNT } from '../constants';
import type { GpuiRemoteSidebarHud, GpuiSidebarRuntimeSettings } from '../types-and-protocol';
import { createGpuiSidebarSettings } from './bootstrap';
import { createGpuiProjectSettingsProjects } from './presentation-projection';
import { createGpuiRemotePresentationProjectId } from './remote-presentation';
import { createGpuiActiveProjectSpaceRefs, createGpuiProjectViewProjects } from './view-scopes';
import {
  compareGpuiRecentProjectsByClosedAt,
  createGpuiRecentProjects,
  createGpuiRemoteRecentProjects,
} from './recent-projects';
import { DEFAULT_COMPLETION_SOUND, getCompletionSoundLabel } from '@/packages/shared/completion-sound';
import { parseGxserverPresentationProjectSessionId } from '@/packages/shared/gxserver-presentation-sidebar-projection';
import type {
  GxserverPresentationSnapshot,
  GxserverProjectDomainState,
  GxserverRecentProjectDomainState,
  GxserverSidebarHudResponse,
} from '@/packages/shared/gxserver-protocol';
import type { SidebarHudState, SidebarSessionGroup } from '@/packages/shared/session-grid-contract';
import { resolveSidebarTheme } from '@/packages/shared/session-grid-contract';
import type { SidebarAgentButton } from '@/packages/shared/sidebar-agents';
import { createSidebarAgentButtons } from '@/packages/shared/sidebar-agents';
import type { SidebarCommandButton } from '@/packages/shared/sidebar-commands';
import { createSidebarCommandButtons } from '@/packages/shared/sidebar-commands';
import type { SidebarGitState } from '@/packages/shared/sidebar-git';
import { createDefaultSidebarGitState } from '@/packages/shared/sidebar-git';

export function createGpuiSidebarHudState({
  activeProjectId,
  domainProjects = [],
  focusedSessionId,
  git,
  groups = [],
  presentation,
  recentProjects = [],
  remoteRecentProjectsByMachineId,
  remotePresentationsByMachineId,
  remoteSidebarHudsByMachineId,
  runtimeSettings,
  sidebarHud,
}: {
  activeProjectId?: string;
  domainProjects?: readonly GxserverProjectDomainState[];
  focusedSessionId?: string;
  git?: SidebarGitState;
  groups?: readonly SidebarSessionGroup[];
  presentation?: GxserverPresentationSnapshot;
  recentProjects?: readonly GxserverRecentProjectDomainState[];
  remoteRecentProjectsByMachineId?: ReadonlyMap<string, readonly GxserverRecentProjectDomainState[]>;
  remotePresentationsByMachineId?: ReadonlyMap<string, GxserverPresentationSnapshot>;
  remoteSidebarHudsByMachineId?: ReadonlyMap<string, GpuiRemoteSidebarHud>;
  runtimeSettings?: GpuiSidebarRuntimeSettings;
  sidebarHud?: GxserverSidebarHudResponse;
} = {}): SidebarHudState {
  const settings = createGpuiSidebarSettings(runtimeSettings);
  /*
   * CDXC:AgentLauncher 2026-06-24-20:34:
   * GPUI SidebarApp uses gxserver's `/api/readSidebarHud` projection for read-side agent/action buttons so live sidebar and app-modal Settings share one production contract. The local shared defaults are only for pre-bootstrap or unavailable gxserver state; project metadata is not re-normalized here.
   */
  const agents = sidebarHud ? ([...sidebarHud.agents] as SidebarAgentButton[]) : createSidebarAgentButtons([], []);
  /*
   * CDXC:Projects 2026-08-01:
   * `showOnProjectRow` is optional on the gxserver contract because a daemon
   * older than the app drops fields it does not know, so a legacy response
   * yields `undefined` where SidebarCommandButton promises a boolean. Normalize
   * at the surface boundary instead of casting the gap away, so row rendering
   * and the Settings toggle both see a real boolean.
   */
  const normalizeHudCommands = (
    hudCommands: readonly GxserverSidebarHudResponse['commands'][number][]
  ): ReturnType<typeof createSidebarCommandButtons> =>
    hudCommands.map((command) => ({
      ...command,
      showOnProjectRow: command.showOnProjectRow === true,
    })) as ReturnType<typeof createSidebarCommandButtons>;
  const commands = sidebarHud ? normalizeHudCommands(sidebarHud.commands) : createSidebarCommandButtons([], [], []);
  /*
   * CDXC:AgentLauncher 2026-08-01:
   * `globalCommands` is optional on the gxserver contract because a daemon
   * older than the app drops fields it does not know. Normalize the gap to an
   * empty list here, at the surface boundary, so Settings renders an empty
   * Global Actions section instead of failing on undefined.
   */
  const globalCommands = (
    sidebarHud?.globalCommands ? normalizeHudCommands(sidebarHud.globalCommands) : []
  ) as ReturnType<typeof createSidebarCommandButtons>;
  /*
   * CDXC:RemoteMachines 2026-08-29:
   * A remote machine's per-project Actions arrive keyed by that machine's own
   * project ids, which mean nothing to this app on their own — two machines can
   * hand out the same `P1…` id. Re-key them under the machine-scoped project id
   * the sidebar rows already use, so a remote row resolves its own Actions
   * through exactly the same lookup a local row does.
   *
   * The remote machine's Global Actions stay on that machine: `globalCommands`
   * is a flat app-wide list here, so mixing a remote machine's globals into it
   * would put them on every LOCAL project row too.
   */
  const remoteCommandsByProject = Object.fromEntries(
    [...(remoteSidebarHudsByMachineId ?? new Map<string, GpuiRemoteSidebarHud>())].flatMap(([machineId, remoteHud]) =>
      Object.entries(remoteHud.commandsByProject ?? {}).map(([projectId, projectCommands]) => [
        createGpuiRemotePresentationProjectId(machineId, projectId),
        normalizeHudCommands(projectCommands),
      ])
    )
  );
  const localCommandsByProject = sidebarHud?.commandsByProject
    ? Object.fromEntries(
        Object.entries(sidebarHud.commandsByProject).map(([projectId, projectCommands]) => [
          projectId,
          normalizeHudCommands(projectCommands),
        ])
      )
    : undefined;
  const commandsByProject =
    localCommandsByProject || Object.keys(remoteCommandsByProject).length > 0
      ? { ...localCommandsByProject, ...remoteCommandsByProject }
      : undefined;
  const focusedSession = groups
    .flatMap((group) => group.sessions)
    .find(
      (session) =>
        parseGxserverPresentationProjectSessionId(session.sessionId)?.sessionId === focusedSessionId ||
        session.sessionId === focusedSessionId
    );
  const visibleSessions = groups.flatMap((group) => group.sessions.filter((session) => session.isVisible));
  return {
    ...(activeProjectId ? { activeProjectId } : {}),
    activeProjectSpaceRefs: createGpuiActiveProjectSpaceRefs({
      activeProjectId,
      domainProjects,
      presentation,
      remotePresentationsByMachineId,
    }),
    activeSessionsSortMode: 'lastActivity',
    agentManagerZoomPercent: settings.agentManagerZoomPercent,
    agents,
    commands,
    ...(commandsByProject ? { commandsByProject } : {}),
    // Command-pane tabs are Rust's; nothing reads this runtime HUD's indicators any more.
    commandSessionIndicators: [],
    completionBellEnabled: settings.completionSound !== 'off',
    completionSound: settings.completionSound === 'off' ? DEFAULT_COMPLETION_SOUND : settings.completionSound,
    completionSoundLabel: getCompletionSoundLabel(
      settings.completionSound === 'off' ? DEFAULT_COMPLETION_SOUND : settings.completionSound
    ),
    debuggingMode: settings.debuggingMode,
    focusedSessionTitle: focusedSession?.displayTitle ?? focusedSession?.primaryTitle ?? focusedSession?.alias,
    git: git ?? createDefaultSidebarGitState(),
    globalCommands,
    highlightedVisibleCount: GPUI_DEFAULT_VISIBLE_COUNT,
    isFocusModeActive: false,
    pendingAgentIds: [],
    projectSettingsProjects: createGpuiProjectSettingsProjects(domainProjects, presentation),
    projectViewProjects: createGpuiProjectViewProjects(groups),
    projectViewSpaces: [
      ...projectViewSpaceOptions(presentation?.sidebarSpaces, 'local'),
      ...[...(remotePresentationsByMachineId ?? [])].flatMap(([machineId, snapshot]) =>
        projectViewSpaceOptions(
          snapshot.sidebarSpaces,
          `remote:${machineId}`,
          settings.remoteMachines.find((machine) => machine.id === machineId)?.name ?? machineId
        )
      ),
    ],
    /*
    CDXC:Projects 2026-06-24-12:27:
    GPUI Recent Projects hydrate from `/api/listRecentProjects`, a
    gxserver-owned parked-project contract. Keep an empty drawer when the
    endpoint has no explicit rows; never derive recent projects from labels,
    inactive sessions, presentation titles, command text, or path guessing.
    */
    recentProjects: [
      ...createGpuiRecentProjects(recentProjects, settings),
      ...createGpuiRemoteRecentProjects(remoteRecentProjectsByMachineId, remotePresentationsByMachineId, settings),
    ].sort(compareGpuiRecentProjectsByClosedAt),
    settings,
    createSessionOnSidebarDoubleClick: settings.createSessionOnSidebarDoubleClick,
    renameSessionOnDoubleClick: settings.renameSessionOnDoubleClick,
    theme: resolveSidebarTheme(settings.sidebarTheme, 'dark'),
    viewMode: 'grid',
    visibleCount: GPUI_DEFAULT_VISIBLE_COUNT,
    visibleSlotLabels: visibleSessions.map((session) => session.shortcutLabel),
  };
}
