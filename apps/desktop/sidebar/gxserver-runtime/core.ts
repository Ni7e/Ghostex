import { nativePost } from '@/packages/shared/native-runtime/bridge';
/*
CDXC:RepoStructure 2026-08-22:
Split out of the single 21,861-line `gxserver-runtime.ts`. Pure move: no logic
changed. See `core.ts` for how the runtime's methods are re-attached.
*/
import type { GpuiWorkspaceSessionGroupsState } from '../workspace-session-groups';
import {
  createEmptyGpuiWorkspaceSessionGroupsState,
  readStoredGpuiWorkspaceSessionGroupsState,
} from '../workspace-session-groups';
import type { GpuiSidebarRuntimeAppShotAndMiscMethods } from './app-shot-and-misc';
import { gpuiSidebarRuntimeAppShotAndMiscMethods } from './app-shot-and-misc';
import type { GpuiSidebarRuntimeAttentionMethods } from './attention-tracking';
import { gpuiSidebarRuntimeAttentionMethods } from './attention-tracking';
import type { GpuiSidebarRuntimeAutoSleepMethods } from './auto-sleep';
import { gpuiSidebarRuntimeAutoSleepMethods } from './auto-sleep';
import { asGpuiSidebarCommand } from './sidebar-command-entry';
import { GpuiGxserverClient } from './client';
import type { GpuiSidebarRuntimeCloseAfterDoneMethods } from './close-after-done';
import { gpuiSidebarRuntimeCloseAfterDoneMethods } from './close-after-done';
import {
  GPUI_REMOTE_MACHINE_PRESENTATION_CLEAR_STATES,
  GPUI_SIDEBAR_NAVIGATION_HISTORY_COMMAND_EVENT_NAME,
  GPUI_SIDEBAR_REMOTE_EVENT_NAME,
} from './constants';
import type { GpuiSidebarRuntimeGitMethods } from './git';
import { gpuiSidebarRuntimeGitMethods } from './git';
import {
  createEmptyGpuiAppUserData,
  currentGpuiRuntimeSettings,
  hasSameGpuiRuntimeSettings,
} from './helpers/bootstrap';
import { normalizeGpuiBrowserTabs } from './helpers/browser-tabs';
import {
  createGpuiSidebarHudState,
  hasSameGpuiCommandPaneSessions,
  normalizeGpuiCommandPaneSessions,
} from './helpers/command-pane';
import { readStoredGpuiRemoteGroupOrder, readStoredGpuiRemoteRecentProjects } from './helpers/recent-projects';
import { normalizeNonEmptyString } from './helpers/records';
import { GpuiRemoteLastSeenStore } from './helpers/remote-last-seen';
import {
  normalizeGpuiSidebarRemoteEvent,
  parseGpuiRemotePresentationProjectId,
} from './helpers/remote-presentation';
import type { GpuiSidebarRuntimePresentationStreamMethods } from './presentation-stream';
import { gpuiSidebarRuntimePresentationStreamMethods } from './presentation-stream';
import type { GpuiSidebarRuntimeProjectBoardMethods } from './project-board';
import { gpuiSidebarRuntimeProjectBoardMethods } from './project-board';
import type { GpuiSidebarRuntimeProjectAndCommandMethods } from './projects-and-commands';
import { gpuiSidebarRuntimeProjectAndCommandMethods } from './projects-and-commands';
import type { GpuiSidebarRuntimeRemoteMachineMethods } from './remote-machines';
import { gpuiSidebarRuntimeRemoteMachineMethods } from './remote-machines';
import type { GpuiSidebarRuntimeConversationJumpMethods } from './session-conversation-jump';
import { gpuiSidebarRuntimeConversationJumpMethods } from './session-conversation-jump';
import type { GpuiSidebarRuntimeDraftSessionMethods } from './draft-sessions';
import { gpuiSidebarRuntimeDraftSessionMethods } from './draft-sessions';
import type { GpuiSidebarRuntimeSessionCreateMethods } from './session-create';
import { gpuiSidebarRuntimeSessionCreateMethods } from './session-create';
import type { GpuiSidebarRuntimeSessionFocusMethods } from './sessions-and-focus';
import { gpuiSidebarRuntimeSessionFocusMethods } from './sessions-and-focus';
import type { GpuiSidebarRuntimeSidebarGroupMethods } from './sidebar-groups';
import { gpuiSidebarRuntimeSidebarGroupMethods } from './sidebar-groups';
import type { GpuiSidebarRuntimeTerminalLifecycleMethods } from './terminal-lifecycle-queue';
import { gpuiSidebarRuntimeTerminalLifecycleMethods } from './terminal-lifecycle-queue';
import type {
  GpuiBrowserTabSummary,
  GpuiCommandPaneSessionSummary,
  GpuiPendingNativeAppShotPromptInsertion,
  GpuiPendingRemoteGxserverRequest,
  GpuiPresentationSubscription,
  GpuiRemoteSidebarHud,
  GpuiSidebarRuntimeSettings,
  GpuiValidatedGxserverBootstrap,
} from './types-and-protocol';
import type { GpuiSidebarRuntimeWorkspaceGroupMethods } from './workspace-groups-sync';
import { gpuiSidebarRuntimeWorkspaceGroupMethods, installGpuiWorkspaceGroupsHandBack } from './workspace-groups-sync';
import type { GpuiSidebarRuntimeWorktreeMethods } from './worktrees';
import { gpuiSidebarRuntimeWorktreeMethods } from './worktrees';
import type { WebviewApi } from '@/packages/core-ui/webview-api';
import { reduceGxserverPresentationDelta } from '@/packages/shared/gxserver-presentation-cache';
import type {
  GxserverAppUserData,
  GxserverPresentationSnapshot,
  GxserverProjectDomainState,
  GxserverRecentProjectDomainState,
  GxserverSidebarHudResponse,
  GxserverSidebarProjectCollectionsState,
  GxserverSidebarSpacesState,
} from '@/packages/shared/gxserver-protocol';
import { NAVIGATION_HISTORY_SCOPE_GPUI } from '@/packages/shared/navigation-history/navigation-history-contract';
import { NavigationHistoryController } from '@/packages/shared/navigation-history/navigation-history-controller';
import type {
  ExtensionToSidebarMessage,
  SidebarGroupsChangedMessage,
  SidebarHudChangedMessage,
  SidebarHudState,
  SidebarHydrateMessage,
  SidebarOrderSyncResultMessage,
  SidebarPreviousSessionItem,
  SidebarPreviousSessionsResultMessage,
  SidebarSessionGroup,
  SidebarToExtensionMessage,
} from '@/packages/shared/session-grid-contract';
import { isSidebarCommandScope } from '@/packages/shared/sidebar-commands';

/*
CDXC:StateSync 2026-06-24-11:00:
The production GPUI sidebar must mount the shared SidebarApp and hydrate it from gxserver presentation, never Storybook fixtures. Keep the renderer contract narrow: Rust/CEF installs baseUrl, authToken, protocolVersion, and optional active/focus ids on window.ghostexGpui.gxserverBootstrap; this adapter owns HTTP/WebSocket presentation flow, shared reducer/projection, active-project posting, and explicit unsupported handling for sidebar commands outside this slice.

CDXC:Settings 2026-06-24-11:59:
Settings project/worktree metadata in the GPUI SidebarApp still comes from real gxserver project domain rows, but read-side agent/action chrome now comes from `/api/readSidebarHud` so the renderer does not duplicate custom launcher/action normalization. Keep Beads/worktree metadata on project rows and never invent project paths when gxserver omits them.

CDXC:Projects 2026-06-24-14:18:
Reused SidebarApp project path actions in GPUI may send only fixed action names plus trusted gxserver project ids to the sidebar-native bridge. The renderer must never send paths from DOM text, group labels, project titles, or cached project domain rows; Rust resolves ids through gxserver immediately before clipboard/Finder side effects.

CDXC:Projects 2026-06-24-13:49:
Reused SidebarApp IDE-open messages in GPUI use the same pathless native project action bridge. The renderer maps group IDE opens to a Settings-owned fixed action and active workspace IDE opens to fixed VS Code/Zed action names plus gxserver project ids only; targetApp, editor commands, app names, paths, labels, URLs, and shell snippets stay out of the bridge payload so Rust owns editor selection and launch.

CDXC:ServerDaemon 2026-06-24-13:30:
Pinned Prompts in the reused GPUI SidebarApp must hydrate and save through
gxserver app-user-data, matching the app-modal host. Keep prompt bodies inside
authenticated RPC payloads only; do not log them or persist them in a
GPUI-only JSON file.

CDXC:RemoteMachines 2026-06-24-19:06:
Remote terminal focus and copy-attach commands may leave React only as fixed native action names plus machine-scoped remote presentation session ids. Rust owns saved-machine SSH details, gxserver attach/resume metadata, GPUI terminal launch payloads, and clipboard command construction so renderer state never carries tokens, hostnames, paths, or command text.

CDXC:RemoteMachines 2026-08-14:
Remote Recent Projects opens a real project-scoped terminal through the fixed `openRemoteProjectTerminal` selector. React sends only the machine-scoped project id; Rust restores the parked project, creates the remote gxserver terminal, and owns all SSH attach metadata and terminal launch payloads.

CDXC:RemoteMachines 2026-06-24-20:26:
Remote IDE project and changed-file opens are allowed only through Rust-owned fixed editor openers. React may request a fixed action for a machine-scoped project id, but it must never send remote paths, URI strings, SSH host/user/port/identity details, Settings custom commands, or editor command text.

CDXC:RemoteMachines 2026-06-24-21:33:
Zed remote opens are allowed through Rust-owned documented `zed ssh://[user@]host[:port]/path` argv only. React still sends only fixed action names and machine-scoped project ids; Cursor, Windsurf, VSCodium, Sublime, and custom remote editor commands remain unsupported without an equally reviewed native opener contract.

CDXC:FocusRouting 2026-06-24-21:07:
Focused and visible session bootstrap state may use only gxserver presentation session ids the GPUI runtime already owns from create/focus/fork/restore results or machine-scoped remote presentation ids. Local ids stay raw gxserver session ids; remote ids use the existing `remote:<machine>:session:<project>:<session>` convention so React, Rust, and the CEF bootstrap never infer focus from labels, paths, terminal text, project names, or shell placeholder ids.

CDXC:Projects 2026-06-24-22:18:
GPUI must mirror the macOS sidebar projection rules for gxserver project domain metadata and canonical chat-folder paths. Legacy `isChat`/`isQuick`, `launchSettings.isChat`, `launchSettings.isQuick`, and projects under the Ghostex chats roots feed the synthetic Chats group instead of normal Project groups, `isRecentProject` rows stay out of active presentation groups, and automatic fallback focus must choose a visible non-chat project while explicit chat-session focus keeps the Chats group active.

CDXC:Projects 2026-06-24-22:51:
Generated Chat folders must not render as individual GPUI project groups, and clicking a chat session must not publish that chat folder as the active project to Rust. Treat host Ghostex-home chat roots, including dev `.active/chats` homes, as projectless Chats containers before building active-project context, Settings project rows, or Git HUD state.
*/
export function createGpuiSidebarRuntime(): {
  applyWorkspaceGroupsFromHost: (state: unknown) => void;
  persistWorkspaceGroups: () => void;
  messageSource: GpuiSidebarLocalMessageSource;
  start: () => void;
  vscode: WebviewApi;
} {
  const runtime = new GpuiSidebarRuntime();
  return {
    applyWorkspaceGroupsFromHost: (state: unknown) => runtime.applyWorkspaceGroupsFromHost(state),
    persistWorkspaceGroups: () => runtime.persistWorkspaceGroups(),
    messageSource: runtime.messageSource,
    start: () => runtime.start(),
    vscode: runtime.vscode,
  };
}

export class GpuiSidebarLocalMessageSource {
  private readonly eventTarget = new EventTarget();

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean
  ): void {
    this.eventTarget.addEventListener(type, listener, options);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean
  ): void {
    this.eventTarget.removeEventListener(type, listener, options);
  }

  postMessage(
    message:
      | ExtensionToSidebarMessage
      | SidebarHydrateMessage
      | SidebarGroupsChangedMessage
      | SidebarHudChangedMessage
      | SidebarOrderSyncResultMessage
      | SidebarPreviousSessionsResultMessage
  ): void {
    this.eventTarget.dispatchEvent(
      new MessageEvent('message', {
        data: message,
      })
    );
  }
}

export class GpuiSidebarRuntime {
  readonly messageSource = new GpuiSidebarLocalMessageSource();
  readonly vscode: WebviewApi = {
    postMessage: (message) => {
      void this.handleSidebarMessage(message);
    },
  };

  notifyNativeGxserverPresentationReady(): void {
    window.requestAnimationFrame(() => {
      if (!this.presentation) {
        return;
      }
      window.webkit?.messageHandlers?.ghostexNativeHost?.postMessage({
        type: 'gxserverPresentationReady',
      });
    });
  }

  activeGroupId: string | undefined;
  activeProjectId: string | undefined;
  lastNavigationHistoryStatePayload: string | undefined;
  readonly navigationHistory = new NavigationHistoryController({
    activate: (entry) => this.activateNavigationHistoryEntry(entry),
    onStateChange: (state) => this.postNavigationHistoryState(state),
    resolveRpc: () => this.navigationHistoryRpc(),
    scopeId: NAVIGATION_HISTORY_SCOPE_GPUI,
  });
  appUserData: GxserverAppUserData = createEmptyGpuiAppUserData();
  /**
   * Escalating presentation-stream recovery state. `AcknowledgedAt` is when the
   * daemon last answered a `subscribePresentation` (with a snapshot or with
   * "you are already current"); `Attempt` indexes
   * `GPUI_PRESENTATION_STREAM_RECOVERY_DELAYS_MS`; `TimeoutId` both holds the
   * pending retry and coalesces the `onClose` + `onError` pair a single socket
   * failure produces.
   */
  presentationStreamAcknowledgedAt: number | undefined;
  presentationStreamRecoveryAttempt = 0;
  presentationStreamRecoveryTimeoutId: number | undefined;
  /**
   * Per-remote-machine throttle for the "this delta is stale, refetch the whole
   * snapshot" recovery. Holds the last start time and, when a refetch is being
   * held back, the trailing timer that will run it once the cooldown expires.
   */
  readonly staleRemotePresentationRefreshes = new Map<string, { lastStartedAt: number; trailingTimeoutId?: number }>();
  browserTabs: GpuiBrowserTabSummary[] = [];
  client: GpuiGxserverClient | undefined;
  commandPaneSessions: GpuiCommandPaneSessionSummary[] = [];
  domainProjects: GxserverProjectDomainState[] = [];
  focusedSessionId: string | undefined;
  /**
   * CDXC:FocusRouting 2026-09-19 WHY:
   * Focus and tabs are owned by the Rust store: this runtime is told about a selection, never asked, and must never override a newer local one (user decision in apps/desktop/src/app/gx_store/local_focus.rs).
   * The newest focus stamp Rust sent with a tab selection. Every focus state posted afterwards echoes it, so Rust can tell a payload that answers the current selection from one produced before this runtime heard of it.
   * SEE-ALSO: apps/desktop/src/app/gx_store/local_focus.rs, apps/desktop/src/app/helpers/board_gxserver/focus_state.rs.
   */
  gpuiFocusStamp: number | undefined;
  gxserverBootstrap: GpuiValidatedGxserverBootstrap | undefined;
  hasHydrated = false;
  latestGroups: SidebarSessionGroup[] = [];
  latestHud: SidebarHudState = createGpuiSidebarHudState();
  localFirstHiddenPresentationSessionKeys = new Set<string>();
  lastAppShotTargetAt = 0;
  lastAppShotTargetSessionId: string | undefined;
  pendingNativeAppShotPromptInsertions: GpuiPendingNativeAppShotPromptInsertion[] = [];
  pendingRemoteGxserverRequests = new Map<string, GpuiPendingRemoteGxserverRequest>();
  presentation: GxserverPresentationSnapshot | undefined;
  previousSessionsByHistoryId = new Map<string, SidebarPreviousSessionItem>();
  projectBoardRestorableLinkChecks = new Map<
    string,
    { checkedAt: number; restorable: boolean; resumable: boolean; title?: string }
  >();
  quickAutomationsOverviewOpen = false;
  previousSessionsResult:
    | {
        cursor?: string;
        previousSessions: SidebarPreviousSessionItem[];
        query?: string;
        requestId: string;
      }
    | undefined;
  recentProjects: GxserverRecentProjectDomainState[] = [];
  remoteGxserverRequestSequence = 0;
  remotePresentations = new Map<string, GxserverPresentationSnapshot>();
  /*
   * CDXC:RemoteMachines 2026-08-29:
   * Each connected machine's own Action lists, kept per machine so the merged
   * HUD can key them under this app's machine-scoped project ids without the
   * two machines' project id spaces colliding.
   */
  remoteSidebarHuds = new Map<string, GpuiRemoteSidebarHud>();
  remoteLastSeenPresentations = new Map<string, GxserverPresentationSnapshot>();
  remoteLastSeenStore = new GpuiRemoteLastSeenStore();
  remoteRecentProjectsByMachineId = new Map<string, GxserverRecentProjectDomainState[]>();
  remoteGroupOrderByMachineId = new Map<string, string[]>();
  revision = 0;
  runtimeSettings: GpuiSidebarRuntimeSettings | undefined;
  /*
   * The HUD read this runtime still keeps for its own remaining readers. The tab strip's Global
   * Actions come from the Rust HUD since the app runtime port's F2 (gx_store/hud/).
   */
  sidebarHud: GxserverSidebarHudResponse | undefined;
  sleepingLocalSidebarSessionIds = new Set<string>();
  subscription: GpuiPresentationSubscription | undefined;
  visibleSessionIds = new Set<string>();
  didAutoMaterializeStartupSession = false;
  workspaceGroups: GpuiWorkspaceSessionGroupsState = createEmptyGpuiWorkspaceSessionGroupsState();
  lastForwardedRemoteSidebarProjectCollectionsJsonByMachineId = new Map<string, string>();
  lastForwardedRemoteSidebarSpacesJsonByMachineId = new Map<string, string>();
  lastForwardedCustomSessionTagsJson: string | undefined;
  lastForwardedRemoteCustomSessionTagsJsonByMachineId = new Map<string, string>();

  start(): void {
    this.installGpuiBridgeCallbacks();
    this.runtimeSettings = currentGpuiRuntimeSettings();
    this.remoteRecentProjectsByMachineId = readStoredGpuiRemoteRecentProjects();
    this.remoteGroupOrderByMachineId = readStoredGpuiRemoteGroupOrder();
    this.remoteLastSeenPresentations = this.remoteLastSeenStore.read();
    this.workspaceGroups = readStoredGpuiWorkspaceSessionGroupsState();
    window.addEventListener(GPUI_SIDEBAR_REMOTE_EVENT_NAME, this.handleGpuiSidebarRemoteEvent);
    window.addEventListener(
      GPUI_SIDEBAR_NAVIGATION_HISTORY_COMMAND_EVENT_NAME,
      this.handleGpuiSidebarNavigationHistoryCommand
    );
    this.publishUnavailable('bootstrap-pending');
    // `service.ts` installs the bootstrap from the start config before `start()` runs (an empty
    // object when there is none), so there is nothing to poll for.
    const bootstrap = window.ghostexGpui?.gxserverBootstrap;
    if (bootstrap) {
      this.startFromBootstrap(bootstrap);
    }
  }

  installGpuiBridgeCallbacks(): void {
    const gpuiBridge = (window.ghostexGpui = window.ghostexGpui ?? {});
    gpuiBridge.onSidebarHostMessage = (message) => {
      /*
      CDXC:CommandPane 2026-06-24-23:49:
      Rust-owned command-pane Action lifecycle feedback enters the reused SidebarApp through the same local message source as gxserver presentation patches. Keep this callback typed to existing sidebar messages so GPUI can update button run-state without exposing generic IPC, command text, paths, terminal output, or persisted state to React.
      */
      this.messageSource.postMessage(message);
    };
    const applyBrowserTabs = (tabs: readonly GpuiBrowserTabSummary[] | undefined) => {
      const next = normalizeGpuiBrowserTabs(tabs);
      gpuiBridge.browserTabs = next;
      if (JSON.stringify(this.browserTabs) === JSON.stringify(next)) {
        return;
      }
      this.browserTabs = next;
      if (this.presentation) {
        this.publishPresentation('patch');
      }
    };
    gpuiBridge.onBrowserTabsChanged = applyBrowserTabs;
    applyBrowserTabs(gpuiBridge.browserTabs);
    const applyCommandPaneSessions = (sessions: readonly GpuiCommandPaneSessionSummary[] | undefined) => {
      /*
      CDXC:CommandPane 2026-06-25-10:50:
      Rust owns GPUI command-pane session identity, activity, and active-tab state. The external bridge uses native-shaped `G...` local command-pane ids even though Rust internal shell state may still use numeric ids; the sidebar runtime only matches those sanitized summaries to current gxserver HUD command buttons by command id first and normalized title second, mirroring macOS without exposing command text, cwd, output, status-file paths, or shell-state JSON to React.
      */
      const next = normalizeGpuiCommandPaneSessions(sessions);
      gpuiBridge.commandPaneSessions = next;
      if (hasSameGpuiCommandPaneSessions(this.commandPaneSessions, next)) {
        return;
      }
      this.commandPaneSessions = next;
      this.publishHudPatch();
    };
    gpuiBridge.onCommandPaneSessionsChanged = applyCommandPaneSessions;
    applyCommandPaneSessions(gpuiBridge.commandPaneSessions);
    gpuiBridge.onNativeAppShotCaptured = (payload) => {
      void this.handleNativeAppShotCaptured(payload);
    };
    gpuiBridge.onNativeAppShotPromptResult = (payload) => {
      this.handleNativeAppShotPromptResult(payload);
    };
    gpuiBridge.onMenuBarProjectActivation = (payload) => {
      this.handleGpuiMenuBarProjectActivation(payload);
    };
    gpuiBridge.onProjectBoardConversationRequest = (payload) => {
      void this.handleGpuiProjectBoardConversationRequest(payload);
    };
    gpuiBridge.onWorkspaceTabSessionSelected = (payload) => {
      this.handleGpuiWorkspaceTabSessionSelected(payload);
    };
    /*
    CDXC:Sidebar 2026-09-21 WHY:
    The desktop sidebar is the Rust store's, and the page that used to receive its commands and
    forward them here is deleted. Everything the
    store cannot perform itself, because this runtime still owns it (focus, session groups,
    worktrees, git, remote machines, transcripts), arrives on this one entry instead and goes
    straight to the same handler the page's forward ended in. One hop fewer, and nothing in the
    route depends on a page being loaded.
    */
    gpuiBridge.onSidebarCommand = (payload) => {
      const message = asGpuiSidebarCommand(payload);
      if (message) void this.handleSidebarMessage(message);
    };
    installGpuiWorkspaceGroupsHandBack(this);
    const pendingMenuBarProjectActivations = Array.isArray(gpuiBridge.pendingMenuBarProjectActivations)
      ? gpuiBridge.pendingMenuBarProjectActivations.splice(0)
      : [];
    if (pendingMenuBarProjectActivations.length > 0) {
      /*
      CDXC:StatusPet 2026-06-26-06:05:
      GPUI menu-bar project clicks can arrive before the SidebarApp runtime installs callbacks. Drain only fixed first-party project activation payloads carrying one bounded project id, then route through focusProjectId; do not persist payloads or expose paths, titles, commands, URLs, tokens, terminal text, or a generic native event bus.
      */
      for (const payload of pendingMenuBarProjectActivations) {
        this.handleGpuiMenuBarProjectActivation(payload);
      }
    }
    const pendingProjectBoardConversationRequests = Array.isArray(gpuiBridge.pendingProjectBoardConversationRequests)
      ? gpuiBridge.pendingProjectBoardConversationRequests.splice(0)
      : [];
    for (const payload of pendingProjectBoardConversationRequests) {
      /*
      Kanban board conversation requests (getState first of all) routinely
      arrive before the sidebar runtime installs callbacks at startup. Drain
      them in order so early board loads answer instead of timing out.
      */
      void this.handleGpuiProjectBoardConversationRequest(payload);
    }
    const pendingWorkspaceTabSessionSelections = Array.isArray(gpuiBridge.pendingWorkspaceTabSessionSelections)
      ? gpuiBridge.pendingWorkspaceTabSessionSelections.splice(0)
      : [];
    if (pendingWorkspaceTabSessionSelections.length > 0) {
      /*
      CDXC:FocusRouting 2026-06-26-08:01:
      Workspace tab clicks originate from Rust after the local tab is already selected. Drain them into sidebar focus only so startup-time delivery cannot re-enter the Rust workspace materialization bridge or create a focus loop.
      */
      for (const payload of pendingWorkspaceTabSessionSelections) {
        this.handleGpuiWorkspaceTabSessionSelected(payload);
      }
    }
    const pendingSidebarCommands = Array.isArray(gpuiBridge.pendingSidebarCommands)
      ? gpuiBridge.pendingSidebarCommands.splice(0)
      : [];
    for (const payload of pendingSidebarCommands) {
      const message = asGpuiSidebarCommand(payload);
      if (message) void this.handleSidebarMessage(message);
    }
    const pendingNativeAppShotPromptResults = Array.isArray(gpuiBridge.pendingNativeAppShotPromptResults)
      ? gpuiBridge.pendingNativeAppShotPromptResults.splice(0)
      : [];
    for (const payload of pendingNativeAppShotPromptResults) {
      this.handleNativeAppShotPromptResult(payload);
    }
    const pendingNativeAppShots = Array.isArray(gpuiBridge.pendingNativeAppShots)
      ? gpuiBridge.pendingNativeAppShots.splice(0)
      : [];
    if (pendingNativeAppShots.length > 0) {
      /*
      CDXC:AppShots 2026-06-25-23:07:
      Rust may deliver a native App Shot before the SidebarApp runtime finishes installing callbacks. Drain only the first-party queued capture payloads and keep them transient; do not persist app names, window titles, image paths, command text, terminal content, URLs, or side-channel metadata from this bridge.
      */
      for (const payload of pendingNativeAppShots) {
        void this.handleNativeAppShotCaptured(payload);
      }
    }
    gpuiBridge.onRuntimeSettingsChanged = (runtimeSettings) => {
      const didChange = !hasSameGpuiRuntimeSettings(this.runtimeSettings, runtimeSettings);
      this.runtimeSettings = runtimeSettings;
      if (!didChange) {
        return;
      }
      this.publishHudPatch();
      this.postGpuiStatusPetState();
      this.postActiveProjectContext();
    };
    gpuiBridge.onGxserverBootstrapChanged = (bootstrap) => {
      this.applyGxserverBootstrapChanged(bootstrap);
    };
  }

  readonly handleGpuiSidebarRemoteEvent = (event: Event): void => {
    const remoteEvent = normalizeGpuiSidebarRemoteEvent((event as CustomEvent<unknown>).detail);
    if (!remoteEvent) {
      return;
    }
    if (remoteEvent.type === 'remoteMachineStatus') {
      this.messageSource.postMessage(remoteEvent);
      if (GPUI_REMOTE_MACHINE_PRESENTATION_CLEAR_STATES.has(remoteEvent.state)) {
        this.remotePresentations.delete(remoteEvent.machineId);
        // A queued stale-revision refetch is for a cache this just dropped, and
        // the machine is no longer reachable to serve it.
        this.forgetStaleRemotePresentationRefresh(remoteEvent.machineId);
        /*
        CDXC:RemoteMachines 2026-08-29:
        A disconnected machine's Actions are no longer runnable, so its cached
        Action lists go with its presentation instead of leaving dead buttons on
        rows the app can no longer reach.
        */
        this.remoteSidebarHuds.delete(remoteEvent.machineId);
        this.dropRemotePresentationSessionFocus(remoteEvent.machineId);
        this.publishRemotePresentationPatch();
      }
      return;
    }

    if (remoteEvent.type === 'remoteGxserverResponse') {
      this.resolveRemoteGxserverRequest(remoteEvent);
      return;
    }

    if (remoteEvent.payload.type === 'presentationSnapshot') {
      const snapshot = remoteEvent.payload.snapshot;
      const previous = this.remotePresentations.get(remoteEvent.remoteMachineId);
      if (previous && previous.revision > snapshot.revision) {
        return;
      }
      this.remotePresentations.set(remoteEvent.remoteMachineId, snapshot);
      this.pruneRemoteWorkspaceGroupAssignments(remoteEvent.remoteMachineId, snapshot);
      this.publishRemotePresentationPatch();
      /*
      CDXC:RemoteMachines 2026-08-29:
      The snapshot is the point where this app learns which projects the machine
      has, so it is also where their Actions have to be read. The HUD is a
      separate projection from presentation, so it needs its own read.
      */
      void this.refreshRemoteSidebarHudFromGxserver(remoteEvent.remoteMachineId).catch(() => undefined);
      return;
    }

    const previous = this.remotePresentations.get(remoteEvent.remoteMachineId);
    if (!previous) {
      this.scheduleStaleRemotePresentationRefresh(remoteEvent.remoteMachineId);
      return;
    }
    if (remoteEvent.payload.type === 'sidebarProjectCollectionsChanged') {
      if (remoteEvent.payload.revision < previous.revision) {
        this.scheduleStaleRemotePresentationRefresh(remoteEvent.remoteMachineId);
        return;
      }
      const snapshot: GxserverPresentationSnapshot = {
        ...previous,
        revision: remoteEvent.payload.revision as GxserverPresentationSnapshot['revision'],
        sidebarProjectCollections: remoteEvent.payload.sidebarProjectCollections,
      };
      this.remotePresentations.set(remoteEvent.remoteMachineId, snapshot);
      this.forwardRemoteSidebarProjectCollectionsFromGxserver(
        remoteEvent.remoteMachineId,
        remoteEvent.payload.sidebarProjectCollections
      );
      this.publishRemotePresentationPatch();
      return;
    }
    if (remoteEvent.payload.type === 'sidebarSpacesChanged') {
      if (remoteEvent.payload.revision < previous.revision) {
        this.scheduleStaleRemotePresentationRefresh(remoteEvent.remoteMachineId);
        return;
      }
      const snapshot: GxserverPresentationSnapshot = {
        ...previous,
        revision: remoteEvent.payload.revision as GxserverPresentationSnapshot['revision'],
        sidebarSpaces: remoteEvent.payload.sidebarSpaces,
      };
      this.remotePresentations.set(remoteEvent.remoteMachineId, snapshot);
      this.forwardRemoteSidebarSpacesFromGxserver(remoteEvent.remoteMachineId, remoteEvent.payload.sidebarSpaces);
      this.publishRemotePresentationPatch();
      return;
    }
    if (remoteEvent.payload.type === 'customSessionTagsChanged') {
      if (remoteEvent.payload.revision < previous.revision) {
        this.scheduleStaleRemotePresentationRefresh(remoteEvent.remoteMachineId);
        return;
      }
      const snapshot: GxserverPresentationSnapshot = {
        ...previous,
        customSessionTags: remoteEvent.payload.customSessionTags,
        revision: remoteEvent.payload.revision as GxserverPresentationSnapshot['revision'],
      };
      this.remotePresentations.set(remoteEvent.remoteMachineId, snapshot);
      this.forwardRemoteCustomSessionTagsFromGxserver(
        remoteEvent.remoteMachineId,
        remoteEvent.payload.customSessionTags
      );
      this.publishRemotePresentationPatch();
      return;
    }
    if (remoteEvent.payload.type === 'workspaceGroupsChanged') {
      if (remoteEvent.payload.revision < previous.revision) {
        this.scheduleStaleRemotePresentationRefresh(remoteEvent.remoteMachineId);
        return;
      }
      this.remotePresentations.set(remoteEvent.remoteMachineId, {
        ...previous,
        revision: remoteEvent.payload.revision as GxserverPresentationSnapshot['revision'],
        workspaceGroups: remoteEvent.payload.groups,
      });
      this.publishRemotePresentationPatch();
      return;
    }
    if (remoteEvent.payload.revision <= previous.revision) {
      this.scheduleStaleRemotePresentationRefresh(remoteEvent.remoteMachineId);
      return;
    }
    const snapshot = reduceGxserverPresentationDelta(previous, remoteEvent.payload.delta, remoteEvent.payload.revision);
    this.remotePresentations.set(remoteEvent.remoteMachineId, snapshot);
    this.pruneRemoteWorkspaceGroupAssignments(remoteEvent.remoteMachineId, snapshot);
    this.publishRemotePresentationPatch();
    /*
    CDXC:RemoteMachines 2026-08-29:
    A project row on the remote machine is the one delta that can carry an
    Actions edit made over there, so re-read that machine's Action lists then
    and only then — session deltas arrive constantly and cannot change them.
    */
    if ('domainProject' in remoteEvent.payload.delta) {
      void this.refreshRemoteSidebarHudFromGxserver(remoteEvent.remoteMachineId).catch(() => undefined);
    }
  };

  readonly handleGpuiSidebarNavigationHistoryCommand = (event: Event): void => {
    const detail = (event as CustomEvent<unknown>).detail;
    const direction = detail && typeof detail === 'object' ? (detail as { direction?: unknown }).direction : undefined;
    if (direction !== 'back' && direction !== 'forward') {
      return;
    }
    void this.navigationHistory.navigate(direction);
  };

  async handleSidebarMessage(message: SidebarToExtensionMessage): Promise<void> {
    /*
     * CDXC:Diagnostics 2026-09-25 WHY:
     * The app runtime port's meter counts every handler call here, whichever of the four doors
     * delivered it (onSidebarCommand, onSidebarHostMessage, the Git modal commands, Quick Access).
     * The service drops this message unless the `native.runtime.trace` scenario armed it.
     */
    nativePost({ kind: 'traceEntry', name: `handleSidebarMessage:${message.type}` });
    switch (message.type) {
      case 'focusGroup':
        this.focusGroup(message.groupId, message);
        return;
      case 'focusSession':
        await this.focusSession(message.sessionId, message);
        this.postSidebarSessionFocusConfirmation(message.sessionId);
        return;
      case 'runSidebarCommand': {
        /*
        CDXC:CommandPane 2026-06-26-05:22:
        Runtime command-pane messages can arrive from untyped CEF/renderer boundaries. Reject missing, non-string, or blank command ids before Action lookup so unsafe extra launch fields cannot make the selector path throw or reach the fixed command-action bridge.
        */
        const commandId = normalizeNonEmptyString(message.commandId);
        if (!commandId) {
          this.handleUnsupportedSidebarMessage(message);
          return;
        }
        /*
        CDXC:AgentLauncher 2026-08-07:
        Project rows can run either list, so the renderer names the scope.
        Validate the value like runMode rather than trusting the annotation: an
        unrecognized scope is an unsupported no-op, never a silent fallback to
        the project list, which would run an Action the user did not click. An
        absent scope stays project, which is what every sender that predates
        Global Actions sends.
        */
        if (message.scope !== undefined && !isSidebarCommandScope(message.scope)) {
          this.handleUnsupportedSidebarMessage(message);
          return;
        }
        this.runSidebarCommand(commandId, message, message.scope ?? 'project');
        return;
      }
      case 'setSessionSleeping':
        await this.setSessionSleeping(message.sessionId, message.sleeping);
        return;
      case 'setSessionsSleeping':
        await this.setSessionsSleeping(message.sessionIds, message.sleeping);
        return;
      case 'setGroupSleeping':
        await this.setGroupSleeping(message.groupId, message.sleeping);
        return;
      case 'closeSession':
        await this.transitionSession(message.sessionId, 'close');
        return;
      case 'closeSessions':
        await Promise.all(message.sessionIds.map((sessionId) => this.transitionSession(sessionId, 'close')));
        return;
      case 'copySessionDetails':
        this.copySessionDetails(message);
        return;
      case 'fullReloadSession':
        await this.fullReloadSession(message.sessionId);
        return;
      case 'fullReloadProjectZmxSessions':
        await this.fullReloadProjectZmxSessions(message.groupId);
        return;
      case 'fullReloadGroup':
        await this.fullReloadWorkspaceGroup(message.groupId);
        return;
      case 'openAutomationsPage':
        /*
        CDXC:Automations 2026-07-08:
        Mirror macOS `openQuickAutomationsPage`, `ensureQuickAutomationsProject`,
        and `focusQuickAutomationsProject` from native/sidebar/native-sidebar.tsx:
        create the session-local Quick overview row, focus it, and let the
        existing active-project context post carry the Automate workarea identity.
        */
        this.openQuickAutomationsPage();
        return;
      case 'closeInactiveProjectSessions':
        await this.closeInactiveProjectSessions(message.groupId);
        return;
      case 'sleepInactiveProjectSessions':
        await this.sleepInactiveProjectSessions(message.groupId);
        return;
      case 'wakeProjectSleepingSessions':
        await this.wakeProjectSleepingSessions(message.groupId);
        return;
      case 'forkSession':
        await this.forkSession(message.sessionId);
        return;
      case 'splitSessionRight':
        await this.splitSessionRight(message.sessionId);
        return;
      case 'setSessionTag':
        await this.updateSessionFlags(message.sessionId, {
          isFavorite: message.sessionTag === 'favorite',
          sessionTag: message.sessionTag ?? null,
        });
        return;
      case 'setSessionPinned':
        await this.updateSessionFlags(message.sessionId, {
          isPinned: message.pinned,
        });
        return;
      case 'setSessionParked':
        await this.setSessionParked(message.sessionId, message.parked);
        return;
      /*
      CDXC:StateSync 2026-07-29:
      Sidebar V2's settle/snooze commands map 1:1 onto gxserver endpoints. They
      are remote-allowed, so they route through the same machine resolution
      every other session mutation uses; the client posts no optimistic patch
      because the endpoints answer with a presentation delta and enforce guards
      (a working or blocked session cannot settle) that the client must not
      pre-empt.
      */
      case 'snoozeSession':
        await this.snoozeSession(message.sessionId, message.snoozedUntil);
        return;
      case 'unsnoozeSession':
        await this.runSessionLifecycleCommand(message.sessionId, '/api/unsnoozeSession', {});
        return;
      /*
       * CDXC:Sessions 2026-09-25 WHY:
       * A user-made group's order, New Group, Rename, Close Group, Move to New Group, a session
       * dropped into a group and the project order are all Rust's (gx-core workspace_groups/ and
       * sidebar_drag/, a remote row's included), so only a project group's session order is left.
       */
      case 'syncSessionOrder':
        await this.syncSessionOrder(message.groupId, message.sessionIds);
        return;
      /*
      CDXC:Projects 2026-09-21 WHY:
      REMOTE only. This computer's copies of both documents are written and pushed by Rust
      (apps/desktop/src/app/gx_store/project_docs.rs), which is why the local arms and the
      debounced write-through behind them were deleted on 2026-09-21: nothing has posted either
      message without a `remoteMachineId` since M4d part 2 blocker 3, and a queue nothing fills
      would be a second writer waiting to happen.
      */
      case 'updateSidebarProjectCollections':
        if (message.remoteMachineId) {
          await this.updateRemoteSidebarProjectCollections(message.remoteMachineId, message.state);
        }
        return;
      case 'updateSidebarSpaces':
        if (message.remoteMachineId) {
          await this.updateRemoteSidebarSpaces(message.remoteMachineId, message.state);
        }
        return;
      default:
        this.handleUnsupportedSidebarMessage(message);
        return;
    }
  }

  handleUnsupportedSidebarMessage(_message: SidebarToExtensionMessage): void {
    /*
    CDXC:StateSync 2026-06-24-11:00:
    GPUI command parity is intentionally incremental. Unsupported SidebarApp messages must be explicit no-ops in this adapter instead of mutating fixture state, inventing host behavior, logging user content, or pretending native-only Browser/Git/settings/chrome actions succeeded.
    */
  }
}

/*
CDXC:RepoStructure 2026-08-22:
`GpuiSidebarRuntime` is one object with one lifetime; the split only moved its
method bodies into per-responsibility modules. Each of those modules exports a
plain object of methods declared with an explicit `this: GpuiSidebarRuntime`,
and they are copied onto the prototype here. `Object.defineProperty` (rather
than `Object.assign`) is used so the copied methods keep the exact property
attributes a `class` body would have given them: writable, configurable, and
NOT enumerable.

The declaration merge below is what makes `this.someGitMethod()` resolve from
inside `sessions-and-focus.ts` and vice versa: every module sees the whole
merged interface, so the mutual recursion the original class relied on still
type-checks. It works without a circular-inference error only because every
moved method carries an explicit return type annotation.
*/
export interface GpuiSidebarRuntime
  extends
    GpuiSidebarRuntimeGitMethods,
    GpuiSidebarRuntimeWorktreeMethods,
    GpuiSidebarRuntimeSidebarGroupMethods,
    GpuiSidebarRuntimePresentationStreamMethods,
    GpuiSidebarRuntimeSessionFocusMethods,
    GpuiSidebarRuntimeSessionCreateMethods,
    GpuiSidebarRuntimeDraftSessionMethods,
    GpuiSidebarRuntimeAutoSleepMethods,
    GpuiSidebarRuntimeProjectBoardMethods,
    GpuiSidebarRuntimeConversationJumpMethods,
    GpuiSidebarRuntimeAttentionMethods,
    GpuiSidebarRuntimeCloseAfterDoneMethods,
    GpuiSidebarRuntimeTerminalLifecycleMethods,
    GpuiSidebarRuntimeWorkspaceGroupMethods,
    GpuiSidebarRuntimeRemoteMachineMethods,
    GpuiSidebarRuntimeAppShotAndMiscMethods,
    GpuiSidebarRuntimeProjectAndCommandMethods {}

function installGpuiSidebarRuntimeMethods(methods: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(methods)) {
    Object.defineProperty(GpuiSidebarRuntime.prototype, name, {
      value,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
}

installGpuiSidebarRuntimeMethods(gpuiSidebarRuntimeGitMethods);
installGpuiSidebarRuntimeMethods(gpuiSidebarRuntimeWorktreeMethods);
installGpuiSidebarRuntimeMethods(gpuiSidebarRuntimeSidebarGroupMethods);
installGpuiSidebarRuntimeMethods(gpuiSidebarRuntimePresentationStreamMethods);
installGpuiSidebarRuntimeMethods(gpuiSidebarRuntimeSessionFocusMethods);
installGpuiSidebarRuntimeMethods(gpuiSidebarRuntimeSessionCreateMethods);
installGpuiSidebarRuntimeMethods(gpuiSidebarRuntimeDraftSessionMethods);
installGpuiSidebarRuntimeMethods(gpuiSidebarRuntimeAutoSleepMethods);
installGpuiSidebarRuntimeMethods(gpuiSidebarRuntimeProjectBoardMethods);
installGpuiSidebarRuntimeMethods(gpuiSidebarRuntimeConversationJumpMethods);
installGpuiSidebarRuntimeMethods(gpuiSidebarRuntimeAttentionMethods);
installGpuiSidebarRuntimeMethods(gpuiSidebarRuntimeCloseAfterDoneMethods);
installGpuiSidebarRuntimeMethods(gpuiSidebarRuntimeTerminalLifecycleMethods);
installGpuiSidebarRuntimeMethods(gpuiSidebarRuntimeWorkspaceGroupMethods);
installGpuiSidebarRuntimeMethods(gpuiSidebarRuntimeRemoteMachineMethods);
installGpuiSidebarRuntimeMethods(gpuiSidebarRuntimeAppShotAndMiscMethods);
installGpuiSidebarRuntimeMethods(gpuiSidebarRuntimeProjectAndCommandMethods);
