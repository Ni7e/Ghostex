import {
  GXSERVER_PROTOCOL_VERSION,
  type GxserverAppUserData,
  type GxserverCheckoutProjectNewBranchResult,
  type GxserverCreatePullRequestResult,
  type GxserverDeleteWorktreeProjectResult,
  type GxserverForkSessionResult,
  type GxserverEndpointPath,
  type GxserverGenerateCommitMessageResult,
  type GxserverMergeWorktreeIntoMainResult,
  type GxserverPresentationDelta,
  type GxserverPresentationProject,
  type GxserverPresentationSearchResponse,
  type GxserverPresentationSearchResult,
  type GxserverPresentationSession,
  type GxserverPresentationSnapshot,
  type GxserverProjectDomainState,
  type GxserverProjectId,
  type GxserverProjectWorktreeListResult,
  type GxserverRecentProjectDomainState,
  type GxserverRendererCommand,
  type GxserverSessionId,
  type GxserverSessionTransitionResult,
  type GxserverSidebarHudResponse,
  type GxserverSidebarHudSettingsMutationParams,
  type GxserverSidebarHudSettingsMutationResult,
  type GxserverTypedOperationResult,
} from "../../shared/gxserver-protocol";
import {
  reduceGxserverPresentationDelta,
  reorderPresentationProjectSessions,
} from "../../shared/gxserver-presentation-cache";
import { createDisplaySessionLayout } from "../../shared/active-sessions-sort";
import {
  createGxserverPresentationProjectGroupId,
  createGxserverPresentationProjectSessionId,
  createGxserverPresentationSidebarGroup,
  createGxserverPresentationSidebarGroups,
  createGxserverPresentationSidebarSessionKey,
  createGxserverPresentationSessionsByProjectFromGroups,
  parseGxserverPresentationProjectGroupId,
  parseGxserverPresentationProjectSessionId,
  type GxserverPresentationCloseAfterDoneProjection,
  type GxserverPresentationSidebarProjectOverlay,
} from "../../shared/gxserver-presentation-sidebar-projection";
import {
  createAgentSessionDefaultTitle,
  DEFAULT_TERMINAL_SESSION_TITLE,
  resolveSidebarTheme,
  type ExtensionToSidebarMessage,
  type SidebarCommandSessionIndicator,
  type SidebarGroupsChangedMessage,
  type SidebarHudChangedMessage,
  type SidebarHudState,
  type SidebarHydrateMessage,
  type SidebarOrderSyncResultMessage,
  type SidebarPreviousSessionsResultMessage,
  type SidebarPreviousSessionItem,
  type SidebarPromptGitCommitMessage,
  type SidebarProjectSettingsItem,
  type SidebarRemoteMachineStatusMessage,
  type SidebarRecentProject,
  type SidebarSessionGroup,
  type SidebarSessionItem,
  type SidebarTheme,
  type SidebarToExtensionMessage,
} from "../../shared/session-grid-contract";
import {
  createSidebarAgentButtons,
  DEFAULT_SIDEBAR_AGENTS,
  getSidebarAgentIconById,
  isDefaultSidebarAgentId,
  type SidebarAgentButton,
} from "../../shared/sidebar-agents";
import {
  createSidebarCommandButtons,
  isSidebarCommandRunMode,
  isSidebarCommandConfigured,
  type SidebarCommandButton,
} from "../../shared/sidebar-commands";
import { getCompletionSoundLabel } from "../../shared/completion-sound";
import { createAppToastRequest, type AppToastLevel } from "../../shared/app-toast-contract";
import { normalizeghostexSettings, type ghostexSettings } from "../../shared/ghostex-settings";
import {
  createDefaultSidebarGitState,
  hasSidebarGitRemoteCommitDelta,
  normalizeSidebarGitAction,
  type SidebarGitAction,
  type SidebarGitChangedFile,
  type SidebarGitFileDiffDraft,
  type SidebarGitState,
} from "../../shared/sidebar-git";
import {
  createDefaultSidebarProjectDiffStats,
  parseGitZeroDelimitedPaths,
} from "../../shared/project-diff-stats";
import {
  normalizeWorkspaceProjectIcon,
  normalizeWorkspaceProjectIconDataUrl,
  normalizeWorkspaceThemeColor,
} from "../../shared/workspace-project-appearance";
import type { SidebarSessionTag } from "../../shared/session-tags";
import { openAppModal, postAppModalHostMessage } from "../../sidebar/app-modal-host-bridge";
import type { WebviewApi } from "../../sidebar/webview-api";
import {
  createGpuiSidebarActiveProjectContextPayloadFromGroups,
  type GpuiSidebarRuntimeSettings,
  type GpuiSidebarRuntimeSettingsSnapshot,
} from "./active-project-context";
import { runGpuiSidebarBulkSleepPaced } from "./bulk-sleep-pacing";

export type GpuiGxserverBootstrap = {
  authToken?: string;
  baseUrl?: string;
  clientId?: string;
  focusedSessionId?: string;
  initialActiveProjectId?: string;
  protocolVersion?: number;
  visibleSessionIds?: readonly string[];
};

export type GpuiCommandPaneSessionSummary = {
  commandId?: string;
  closeAfterDone?: boolean;
  closeAfterDoneDeadlineAt?: string;
  closeAfterDoneRemainingLabel?: string;
  closeAfterDoneRemainingMs?: number;
  delayedSendDeadlineAt?: string;
  delayedSendRemainingLabel?: string;
  delayedSendRemainingMs?: number;
  isActive?: boolean;
  /*
  CDXC:GPUISidebarAutoSleep 2026-06-27-06:54:
  Rust forwards this true-only bit for native-shaped external `G...` command-panel split pane owners so GPUI Auto Sleep can protect every active command leaf while keeping `isActive` scoped to HUD/responder focus. Rust shell internals may still use numeric ids, but those ids must not cross this TypeScript bridge as command-pane owners.
  */
  isPaneOwner?: true;
  sessionId: string;
  status: SidebarCommandSessionIndicator["status"];
  title?: string;
};

export type GhostexGpuiSidebarBridge = {
  commandPaneSessions?: readonly GpuiCommandPaneSessionSummary[];
  gxserverBootstrap?: GpuiGxserverBootstrap;
  onCommandPaneSessionsChanged?: (
    sessions: readonly GpuiCommandPaneSessionSummary[],
  ) => void;
  onGxserverBootstrapChanged?: (bootstrap: GpuiGxserverBootstrap) => void;
  onMenuBarProjectActivation?: (payload: unknown) => void;
  onMenuBarSessionActivation?: (payload: unknown) => void;
  onNativeAppShotCaptured?: (payload: unknown) => void;
  onNativeAppShotPromptResult?: (payload: unknown) => void;
  onRuntimeSettingsChanged?: (
    runtimeSettings: GpuiSidebarRuntimeSettingsSnapshot,
  ) => void;
  onSidebarHostMessage?: (message: ExtensionToSidebarMessage) => void;
  onStatusPetActivation?: (payload: unknown) => void;
  onWorkspaceFolderPicked?: (payload: unknown) => void;
  onWorkspaceTabSessionSelected?: (payload: unknown) => void;
  onWorkspaceTerminalLifecycleRequest?: (payload: unknown) => void;
  pendingMenuBarProjectActivations?: unknown[];
  pendingMenuBarSessionActivations?: unknown[];
  pendingNativeAppShotPromptResults?: unknown[];
  pendingNativeAppShots?: unknown[];
  pendingStatusPetActivations?: unknown[];
  pendingWorkspaceFolderPicks?: unknown[];
  pendingWorkspaceTabSessionSelections?: unknown[];
  pendingWorkspaceTerminalLifecycleRequests?: unknown[];
  postActiveProjectContext?: (payload: string) => boolean;
  postGxserverPresentationFocusState?: (payload: string) => boolean;
  postGhostexHotkeyAction?: (payload: string) => boolean;
  postNativeAppShotPromptToSession?: (payload: string) => boolean;
  postNativeProjectPathAction?: (payload: string) => boolean;
  postPetOverlayState?: (payload: string) => boolean;
  postSidebarCommandAction?: (payload: string) => boolean;
  postSidebarCommandRunEnd?: (payload: string) => boolean;
  postSessionStatusIndicators?: (payload: string) => boolean;
  postT3SessionCreate?: (payload: string) => boolean;
  postT3SessionFocus?: (payload: string) => boolean;
  postWorkspaceTerminalFocus?: (payload: string) => boolean;
  postWorkspaceTerminalLifecycleResult?: (payload: string) => boolean;
  postWorkspaceTerminalRenameCommand?: (payload: string) => boolean;
  runtimeSettings?: GpuiSidebarRuntimeSettings;
};

declare global {
  interface Window {
    ghostexGpui?: GhostexGpuiSidebarBridge;
  }
}

type GpuiSidebarRuntimeSnapshotKind = "hydrate" | "patch";

type GpuiWorkspaceTerminalLifecycleRequest = {
  action: "close" | "sleep" | "wake";
  projectId: string;
  replacementProjectId?: string;
  replacementSessionId?: string;
  requestId: number;
  sessionId: string;
  skipReplacementFallback: boolean;
};

type GpuiValidatedGxserverBootstrap = {
  authToken: string;
  baseUrl: string;
  clientId: string;
  focusedSessionId?: string;
  initialActiveProjectId?: string;
  visibleSessionIds?: readonly string[];
};

type GpuiSidebarGroupsPatch = {
  groupOrder: string[];
  groups: SidebarSessionGroup[];
  removedGroupIds: string[];
  removedSessionIds: string[];
};

type GpuiGxserverRpcSuccess<TResult> = {
  ok: true;
  product: "gxserver";
  protocolVersion: number;
  result: TResult;
};

type GpuiProjectWorktreesResultMessage = {
  branches?: unknown;
  error?: string;
  ok: boolean;
  requestId: string;
  type: "projectWorktreesResult";
  worktrees?: unknown;
};

type GpuiSidebarRemotePresentationEvent = {
  payload:
    | {
        snapshot: GxserverPresentationSnapshot;
        type: "presentationSnapshot";
      }
    | {
        delta: GxserverPresentationDelta;
        revision: number;
        type: "presentationDelta";
      };
  remoteMachineId: string;
  type: "remoteGxserverPresentation";
};

type GpuiSidebarRemoteGxserverResponseEvent = {
  error?: string;
  ok: boolean;
  remoteMachineId: string;
  requestId: string;
  result?: unknown;
  type: "remoteGxserverResponse";
};

type GpuiSidebarRemoteEvent =
  | SidebarRemoteMachineStatusMessage
  | GpuiSidebarRemoteGxserverResponseEvent
  | GpuiSidebarRemotePresentationEvent;

type GpuiSessionStatusIndicatorStatus = "attention" | "working" | "available";

type GpuiSessionStatusIndicatorCandidate = {
  hasRunningZmxBacking: boolean;
  iconDataUrl?: string;
  lastInteractionAt?: string;
  order: number;
  projectId: string;
  projectTitle: string;
  sessionId: string;
  status: GpuiSessionStatusIndicatorStatus;
  title: string;
};

type GpuiSessionStatusIndicatorProject = {
  iconDataUrl?: string;
  projectId: string;
  sessions: Array<{
    lastActiveAt?: string;
    sessionId: string;
    sidebarOrder: number;
    status: GpuiSessionStatusIndicatorStatus;
    title: string;
  }>;
  title: string;
};

type GpuiSessionStatusIndicatorsPayload = {
  attentionCount: number;
  availableCount: number;
  hideMenuBarIndicators: boolean;
  projects: GpuiSessionStatusIndicatorProject[];
  type: typeof GPUI_SIDEBAR_SESSION_STATUS_INDICATORS_MESSAGE_TYPE;
  version: typeof GPUI_SIDEBAR_SESSION_STATUS_INDICATORS_MESSAGE_VERSION;
  workingCount: number;
};

type GpuiPetOverlayStatePayload = {
  activities: Array<{
    id: string;
    projectId: string;
    state: GpuiSessionStatusIndicatorStatus;
    title: string;
  }>;
  enabled: boolean;
  selectedPetId: string;
  statusItems: Array<{
    count: number;
    status: GpuiSessionStatusIndicatorStatus;
  }>;
  type: typeof GPUI_SIDEBAR_PET_OVERLAY_STATE_MESSAGE_TYPE;
  version: typeof GPUI_SIDEBAR_PET_OVERLAY_STATE_MESSAGE_VERSION;
};

type GpuiStatusPetActivationPayload = {
  sessionId: string;
};

type GpuiMenuBarProjectActivationPayload = {
  projectId: string;
};

type GpuiMenuBarSessionActivationPayload = {
  projectId: string;
  sessionId: string;
};

type GpuiWorkspaceTabSessionSelectionPayload = {
  localWasSleeping?: true;
  projectId: string;
  sessionId: string;
};

type GpuiRendererCommandResolvedSession = {
  projectId: string;
  sessionId: string;
  sidebarSessionId: string;
};

const GPUI_SIDEBAR_BOOTSTRAP_RETRY_DELAY_MS = 20;
const GPUI_SIDEBAR_BOOTSTRAP_MAX_ATTEMPTS = 250;
const GPUI_AUTO_SLEEP_MONITOR_INTERVAL_MS = 60 * 1000;
const GPUI_AUTO_SLEEP_MINUTE_MS = 60 * 1000;
const GPUI_WORKSPACE_TERMINAL_LIFECYCLE_BRIDGE_RETRY_DELAY_MS = 25;
const GPUI_SIDEBAR_DEFAULT_CLIENT_ID = "ghostex-gpui-sidebar";
const GPUI_GXSERVER_UNAVAILABLE_GROUP_ID = "gxserver-unavailable";
const GPUI_GXSERVER_CHATS_GROUP_ID = "combined-chats";
const GPUI_DEFAULT_VISIBLE_COUNT = 1;
const GPUI_SIDEBAR_NATIVE_PROJECT_PATH_ACTION_MESSAGE_VERSION = 1;
const GPUI_SIDEBAR_NATIVE_PROJECT_PATH_ACTION_MESSAGE_TYPE =
  "ghostex.gpui.sidebar.nativeProjectPathAction";
const GPUI_SIDEBAR_COMMAND_ACTION_MESSAGE_VERSION = 1;
const GPUI_SIDEBAR_COMMAND_ACTION_MESSAGE_TYPE =
  "ghostex.gpui.sidebar.commandAction";
const GPUI_SIDEBAR_COMMAND_RUN_END_MESSAGE_VERSION = 1;
const GPUI_SIDEBAR_COMMAND_RUN_END_MESSAGE_TYPE =
  "ghostex.gpui.sidebar.commandRunEnd";
const GPUI_SIDEBAR_COMMAND_SELECTOR_MESSAGE_KEYS = new Set(["commandId", "runMode", "type"]);
const GPUI_SIDEBAR_GXSERVER_FOCUS_STATE_MESSAGE_VERSION = 1;
const GPUI_SIDEBAR_GXSERVER_FOCUS_STATE_MESSAGE_TYPE =
  "ghostex.gpui.sidebar.gxserverPresentationFocusState";
const GPUI_SIDEBAR_WORKSPACE_TERMINAL_FOCUS_MESSAGE_VERSION = 1;
const GPUI_SIDEBAR_WORKSPACE_TERMINAL_FOCUS_MESSAGE_TYPE =
  "ghostex.gpui.sidebar.workspaceTerminalFocus";
const GPUI_SIDEBAR_T3_SESSION_FOCUS_MESSAGE_VERSION = 1;
const GPUI_SIDEBAR_T3_SESSION_FOCUS_MESSAGE_TYPE =
  "ghostex.gpui.sidebar.t3SessionFocus";
const GPUI_SIDEBAR_T3_SESSION_CREATE_MESSAGE_VERSION = 1;
const GPUI_SIDEBAR_T3_SESSION_CREATE_MESSAGE_TYPE =
  "ghostex.gpui.sidebar.t3SessionCreate";
const GPUI_SIDEBAR_WORKSPACE_TERMINAL_RENAME_COMMAND_MESSAGE_VERSION = 1;
const GPUI_SIDEBAR_WORKSPACE_TERMINAL_RENAME_COMMAND_MESSAGE_TYPE =
  "ghostex.gpui.sidebar.workspaceTerminalRenameCommand";
const GPUI_SIDEBAR_WORKSPACE_TERMINAL_LIFECYCLE_REQUEST_MESSAGE_VERSION = 1;
const GPUI_SIDEBAR_WORKSPACE_TERMINAL_LIFECYCLE_REQUEST_MESSAGE_TYPE =
  "ghostex.gpui.sidebar.workspaceTerminalLifecycleRequest";
const GPUI_SIDEBAR_WORKSPACE_TERMINAL_LIFECYCLE_RESULT_MESSAGE_VERSION = 1;
const GPUI_SIDEBAR_WORKSPACE_TERMINAL_LIFECYCLE_RESULT_MESSAGE_TYPE =
  "ghostex.gpui.sidebar.workspaceTerminalLifecycleResult";
const GPUI_SIDEBAR_SESSION_STATUS_INDICATORS_MESSAGE_VERSION = 1;
const GPUI_SIDEBAR_SESSION_STATUS_INDICATORS_MESSAGE_TYPE =
  "ghostex.gpui.sidebar.sessionStatusIndicators";
const GPUI_SIDEBAR_PET_OVERLAY_STATE_MESSAGE_VERSION = 1;
const GPUI_SIDEBAR_PET_OVERLAY_STATE_MESSAGE_TYPE =
  "ghostex.gpui.sidebar.petOverlayState";
const GPUI_SIDEBAR_STATUS_PET_ACTIVATION_MESSAGE_VERSION = 1;
const GPUI_SIDEBAR_STATUS_PET_ACTIVATION_MESSAGE_TYPE =
  "ghostex.gpui.sidebar.statusPetActivation";
const GPUI_SIDEBAR_MENU_BAR_PROJECT_ACTIVATION_MESSAGE_VERSION = 1;
const GPUI_SIDEBAR_MENU_BAR_PROJECT_ACTIVATION_MESSAGE_TYPE =
  "ghostex.gpui.sidebar.menuBarProjectActivation";
const GPUI_SIDEBAR_MENU_BAR_SESSION_ACTIVATION_MESSAGE_VERSION = 1;
const GPUI_SIDEBAR_MENU_BAR_SESSION_ACTIVATION_MESSAGE_TYPE =
  "ghostex.gpui.sidebar.menuBarSessionActivation";
const GPUI_SIDEBAR_WORKSPACE_TAB_SESSION_SELECTED_MESSAGE_VERSION = 1;
const GPUI_SIDEBAR_WORKSPACE_TAB_SESSION_SELECTED_MESSAGE_TYPE =
  "ghostex.gpui.sidebar.workspaceTabSessionSelected";
const GPUI_SIDEBAR_NATIVE_APP_SHOT_MESSAGE_VERSION = 1;
const GPUI_SIDEBAR_NATIVE_APP_SHOT_MESSAGE_TYPE =
  "ghostex.gpui.sidebar.nativeAppShotCaptured";
const GPUI_SIDEBAR_NATIVE_APP_SHOT_PROMPT_MESSAGE_VERSION = 1;
const GPUI_SIDEBAR_NATIVE_APP_SHOT_PROMPT_MESSAGE_TYPE =
  "ghostex.gpui.sidebar.nativeAppShotPrompt";
const GPUI_SIDEBAR_NATIVE_APP_SHOT_PROMPT_RESULT_MESSAGE_VERSION = 1;
const GPUI_SIDEBAR_NATIVE_APP_SHOT_PROMPT_RESULT_MESSAGE_TYPE =
  "ghostex.gpui.sidebar.nativeAppShotPromptResult";
const GPUI_SIDEBAR_REMOTE_EVENT_NAME = "ghostex-gpui-sidebar-remote-event";
const APP_SHOT_RECENT_TARGET_MS = 60_000;
const APP_SHOT_PROMPT_INSERT_RESULT_TIMEOUT_MS = 2_000;
const GPUI_STATUS_INDICATOR_MAX_CANDIDATES = 96;
const GPUI_STATUS_INDICATOR_MAX_PROJECTS = 32;
const GPUI_STATUS_INDICATOR_MAX_SESSIONS_PER_PROJECT = 16;
const GPUI_STATUS_INDICATOR_ID_MAX_CHARS = 256;
const GPUI_STATUS_INDICATOR_TITLE_MAX_CHARS = 120;
const GPUI_RENDERER_COMMAND_RENAME_TITLE_MAX_CHARS = 120;
const GPUI_RENDERER_COMMAND_RENAME_TITLE_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const DEFAULT_GPUI_PROMPT_AGENT_ID = "codex";

const GPUI_BACKGROUND_COMMIT_MESSAGE_DEFAULT_AGENT_IDS = new Set([
  "claude",
  "codex",
  "cursor",
  "gemini",
]);

type GpuiSidebarNativeProjectPathAction =
  | "copyRecentProjectPath"
  | "openRecentProjectInFinder"
  | "copyWorkspaceProjectPath"
  | "openWorkspaceProjectInFinder"
  | "openWorkspaceProjectInIde"
  | "openActiveWorkspaceProjectInFinder"
  | "openActiveWorkspaceProjectInVscode"
  | "openActiveWorkspaceProjectInZed"
  | "openExistingPullRequestInBrowser"
  | "openSidebarGitChangedFileInIde"
  | "copyRemoteProjectPath"
  | "copyRemoteProjectOpenFolderCommand"
  | "openRemoteWorkspaceProjectInIde"
  | "openRemoteWorkspaceProjectInVscode"
  | "openRemoteWorkspaceProjectInZed"
  | "openRemoteExistingPullRequestInBrowser"
  | "openRemoteSidebarGitChangedFileInIde"
  | "openRemoteSessionTerminal"
  | "copyRemoteAttachCommand"
  | "copyRemoteResumeCommand";

type GpuiTrustedExistingWorktreeList = {
  parentProjectId: string;
  paths: Set<string>;
  remoteMachineId?: string;
  sourceProjectId: string;
  worktreeKeys?: Set<string>;
};

type GpuiPendingGitCommitRequest = {
  action: Extract<SidebarGitAction, "commit" | "pr" | "push">;
  files: SidebarGitChangedFile[];
  hasCommit: boolean;
  projectId: string;
  remoteReference?: GpuiRemoteProjectReference;
  remoteTitle?: string;
  subject: string;
};

type GpuiPendingNativeAppShotPromptInsertion = {
  resolve: (ok: boolean) => void;
  sessionId: string;
  timeoutId: number;
};

type GpuiTrustedGitReviewFileSelection = {
  explicit: boolean;
  filePaths: string[];
};

type GpuiPendingRemoteGxserverRequest = {
  reject: (error: Error) => void;
  resolve: (result: unknown) => void;
  timeoutId: number;
};

type GpuiGxserverCreatedSessionResult = {
  session?: {
    projectId?: string;
    sessionId?: string;
  };
};

type GpuiNativeAppShotCapture = {
  appName: string;
  bundleIdentifier?: string;
  imagePath: string;
  trigger?: string;
  windowHeight?: number;
  windowTitle?: string;
  windowWidth?: number;
};

type GpuiWorktreeMetadata = {
  branch?: string;
  name?: string;
  parentProjectId: string;
  parentProjectName?: string;
};

type GpuiGitPreferences = {
  confirmCommit: boolean;
  generateCommitBody: boolean;
  primaryAction: SidebarGitAction;
};

type GpuiRemoteProjectReference = {
  machineId: string;
  projectId: string;
};

type GpuiRemoteProjectScope = GpuiRemoteProjectReference & {
  machineName?: string;
  project: GxserverPresentationProject;
};

type GpuiRemoteCreatePullRequestResult = {
  created?: boolean;
  ok?: boolean;
  pr?: {
    number?: number;
    state?: string;
  };
  reason?: string;
};

class GpuiUserVisibleGitError extends Error {}

const GPUI_GIT_MULTIPLE_COMMITS_PROMPT = `Please review my current changes and commit them as multiple focused commits.

Commit-splitting rules:
- Group changes by related feature, fix, or topic.
- Do not combine unrelated work in the same commit.
- Use file-based splitting only; do not split individual hunks.
- Make each commit easy to revert or cherry-pick later.
- Use clear, concise commit messages.`;

const GPUI_REMOTE_MERGE_CONFLICT_PROMPT =
  "A direct merge into main has conflicts in this remote project. Inspect the repository state, resolve the conflicts, and commit the merge when it is correct.";

const GPUI_GIT_RELEASE_STEPS_PROMPT = `1. Push any local commits to remote.
2. Review the commits since the last released version.
3. Update CHANGELOG.md to mention the new changes.
4. Publish the next minor version to the usual places we publish this app.`;

const GPUI_GIT_MULTICOMMIT_RELEASE_PROMPT = `${GPUI_GIT_MULTIPLE_COMMITS_PROMPT}

After all focused commits are created:
${GPUI_GIT_RELEASE_STEPS_PROMPT}`;

const GPUI_GIT_RELEASE_ONLY_PROMPT = `Please release this app using the usual release workflow.

${GPUI_GIT_RELEASE_STEPS_PROMPT}`;

const GPUI_REMOTE_RECENT_PROJECTS_STORAGE_KEY = "ghostex-gpui-remote-recent-projects";

function createEmptyGpuiAppUserData(): GxserverAppUserData {
  return {
    pinnedPrompts: [],
    scratchPadContent: "",
  };
}

/*
CDXC:GPUISidebarGxserverRuntime 2026-06-24-11:00:
The production GPUI sidebar must mount the shared SidebarApp and hydrate it from gxserver presentation, never Storybook fixtures. Keep the renderer contract narrow: Rust/CEF installs baseUrl, authToken, protocolVersion, and optional active/focus ids on window.ghostexGpui.gxserverBootstrap; this adapter owns HTTP/WebSocket presentation flow, shared reducer/projection, active-project posting, and explicit unsupported handling for sidebar commands outside this slice.

CDXC:GPUISettingsMetadata 2026-06-24-11:59:
Settings project/worktree metadata in the GPUI SidebarApp still comes from real gxserver project domain rows, but read-side agent/action chrome now comes from `/api/readSidebarHud` so the renderer does not duplicate custom launcher/action normalization. Keep Beads/worktree metadata on project rows and never invent project paths when gxserver omits them.

CDXC:GPUISidebarProjectPathActions 2026-06-24-14:18:
Reused SidebarApp project path actions in GPUI may send only fixed action names plus trusted gxserver project ids to the sidebar-native bridge. The renderer must never send paths from DOM text, group labels, project titles, or cached project domain rows; Rust resolves ids through gxserver immediately before clipboard/Finder side effects.

CDXC:GPUISidebarProjectPathActions 2026-06-24-13:49:
Reused SidebarApp IDE-open messages in GPUI use the same pathless native project action bridge. The renderer maps group IDE opens to a Settings-owned fixed action and active workspace IDE opens to fixed VS Code/Zed action names plus gxserver project ids only; targetApp, editor commands, app names, paths, labels, URLs, and shell snippets stay out of the bridge payload so Rust owns editor selection and launch.

CDXC:GPUIWorktrees 2026-06-24-18:21:
The reused Add Worktree modal in GPUI must run local worktree create/open flows through gxserver typed endpoints instead of shelling from TypeScript or accepting arbitrary renderer paths. Remote worktree create/open must use id-scoped gxserver endpoints where the owning daemon derives target paths, branch refs, and Open Existing selections from project ids plus daemon-issued keys; do not route remote checkout paths or branch text through the renderer as authority.

CDXC:GPUIWorktrees 2026-06-24-14:06:
Open Existing prompt starts come from the reused modal's real prompt and
visible agent selector. Blank prompts keep the project-open-only behavior, but
a non-blank prompt must fail if the submitted agent is not configured instead
of silently opening the worktree without starting the requested session.

CDXC:GxserverAppUserData 2026-06-24-13:30:
Scratch Pad and Pinned Prompts in the reused GPUI SidebarApp must hydrate and
save through gxserver app-user-data, matching the app-modal host and macOS
sidebar. Keep note and prompt bodies inside authenticated RPC payloads only;
do not log them or persist them in a GPUI-only JSON file.

CDXC:GPUISidebarGit 2026-06-24-15:22:
GPUI Git controls may use gxserver-owned project ids and typed Git/GitHub/Beads endpoints for status, diffs, commit, push, and direct remote sync. Commit and PR creation paths must use the reused review modal or visible gxserver agent sessions, with remote-machine actions routed through the Rust-owned saved-machine tunnel and the owning remote gxserver.

CDXC:GPUISidebarGit 2026-06-24-15:43:
Existing pull-request browser open and changed-file IDE open are native GPUI side effects. React may send only fixed action names, gxserver project ids, and normalized project-relative file candidates from current HUD/review state; Rust must re-resolve PR URLs and changed-file membership through gxserver before launching a browser or editor.

CDXC:GPUISidebarGit 2026-06-24-15:55:
GPUI worktree completion may run direct merge-to-main and delete-after-cleanup only from a confirmed Git review request. The renderer uses the pending machine-scoped gxserver project id plus gxserver worktree parent metadata, fixed Git action names, and `/api/deleteWorktreeProject`; renderer paths, branch text, shell snippets, command output, and modal labels are never authority for side effects.

CDXC:GPUISidebarGit 2026-06-24-16:11:
Blank GPUI commit messages use a local gxserver generation endpoint after the reused commit modal validates the selected review files. The renderer sends only the trusted project id, review-approved relative paths, and selected prompt-agent id; gxserver stages/diffs the registered project and returns the subject/body used by the same commit pipeline.

CDXC:GPUISidebarGit 2026-06-24-16:28:
Direct/background GPUI PR creation must complete through gxserver before the UI opens a PR or removes a worktree. Reused review confirmations commit only validated review files, push with fixed Git action names, call the sanitized `/api/createPullRequest` project-id RPC, and run delete-after cleanup only after that result confirms an open PR; visible-agent PR workflows remain non-delete because they have no gxserver-owned PR completion signal.

CDXC:GPUISidebarGit 2026-06-24-16:45:
Visible PR-agent sessions expose gxserver lifecycle/activity only, not a trusted PR-created result. Preserve visible PR sessions for non-delete-after workflows, but route every delete-after PR request through the direct/background gxserver PR result before removing the original validated worktree.

CDXC:GPUIRemoteGit 2026-06-24-17:47:
Remote GPUI Git/GitHub/worktree actions must route through the Rust-owned saved-machine gxserver tunnel with machine-scoped project ids, reviewed file paths, fixed endpoint action names, and id-scoped worktree/branch operations only. Native side effects stay explicit: terminal focus uses remote attach, PR browser opens and copy-path use Rust revalidation, local Finder dereference remains unsupported for remote paths, and remote IDE opens require Rust-owned fixed editor support.

CDXC:GPUIRemoteAttach 2026-06-24-19:06:
Remote terminal focus and copy-attach commands may leave React only as fixed native action names plus machine-scoped remote presentation session ids. Rust owns saved-machine SSH details, gxserver attach/resume metadata, GPUI terminal launch payloads, and clipboard command construction so renderer state never carries tokens, hostnames, paths, or command text.

CDXC:GPUIRemoteNativeActions 2026-06-24-19:25:
Remote project copy-path, existing-PR browser open, Recent Projects Open Folder command-copy, and changed-file open intents may leave React only as fixed native action names plus machine-scoped project ids and review-approved relative file candidates. Rust must revalidate through the saved-machine gxserver tunnel before clipboard/browser/editor side effects; local Finder must never dereference remote paths, so Recent Projects Open Folder copies a saved-machine SSH command instead of opening Finder.

CDXC:GPUIRecentProjects 2026-06-25-19:30:
Remote Recent Projects Open Folder must follow the macOS sidebar source of truth by crossing the native bridge as `copyRemoteProjectOpenFolderCommand`, not by showing an unsupported GPUI toast or attempting local Finder. React may send only the machine-scoped project id; Rust owns path lookup, SSH command construction, clipboard write, and sanitized user feedback.

CDXC:GPUIRemoteNativeActions 2026-06-24-20:26:
Remote IDE project and changed-file opens are allowed only through Rust-owned fixed editor openers. React may request a fixed action for a machine-scoped project id, but it must never send remote paths, URI strings, SSH host/user/port/identity details, Settings custom commands, or editor command text.

CDXC:GPUIRemoteNativeActions 2026-06-24-21:33:
Zed remote opens are allowed through Rust-owned documented `zed ssh://[user@]host[:port]/path` argv only. React still sends only fixed action names and machine-scoped project ids; Cursor, Windsurf, VSCodium, Sublime, and custom remote editor commands remain unsupported without an equally reviewed native opener contract.

CDXC:GPUISidebarGxserverFocusState 2026-06-24-21:07:
Focused and visible session bootstrap state may use only gxserver presentation session ids the GPUI runtime already owns from create/focus/fork/restore results or machine-scoped remote presentation ids. Local ids stay raw gxserver session ids; remote ids use the existing `remote:<machine>:session:<project>:<session>` convention so React, Rust, and the CEF bootstrap never infer focus from labels, paths, terminal text, project names, or shell placeholder ids.

CDXC:GPUISidebarProjectClassification 2026-06-24-22:18:
GPUI must mirror the macOS sidebar projection rules for gxserver project domain metadata and canonical chat-folder paths. Legacy `isChat`/`isQuick`, `launchSettings.isChat`, `launchSettings.isQuick`, and projects under the Ghostex chats roots feed the synthetic Chats group instead of normal Project groups, `isRecentProject` rows stay out of active presentation groups, and automatic fallback focus must choose a visible non-chat project while explicit chat-session focus keeps the Chats group active.

CDXC:GPUISidebarProjectClassification 2026-06-24-22:51:
Generated Chat folders must not render as individual GPUI project groups, and clicking a chat session must not publish that chat folder as the active project to Rust. Treat host Ghostex-home chat roots, including dev `.active/chats` homes, as projectless Chats containers before building active-project context, Settings project rows, or Git HUD state.
*/
export function createGpuiSidebarRuntime(): {
  messageSource: GpuiSidebarLocalMessageSource;
  start: () => void;
  vscode: WebviewApi;
} {
  const runtime = new GpuiSidebarRuntime();
  return {
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
    options?: AddEventListenerOptions | boolean,
  ): void {
    this.eventTarget.addEventListener(type, listener, options);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
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
      | GpuiProjectWorktreesResultMessage,
  ): void {
    this.eventTarget.dispatchEvent(
      new MessageEvent("message", {
        data: message,
      }),
    );
  }
}

class GpuiSidebarRuntime {
  readonly messageSource = new GpuiSidebarLocalMessageSource();
  readonly vscode: WebviewApi = {
    postMessage: (message) => {
      void this.handleSidebarMessage(message);
    },
  };

  private activeProjectContextRetryId: number | undefined;
  private activeGroupId: string | undefined;
  private activeProjectId: string | undefined;
  private appUserData: GxserverAppUserData = createEmptyGpuiAppUserData();
  private autoSleepMonitorIntervalId: number | undefined;
  private autoSleepMonitorRunning = false;
  private bootstrapPollTimeoutId: number | undefined;
  private client: GpuiGxserverClient | undefined;
  private closeAfterDoneCountdownTickerId: number | undefined;
  private closeAfterDoneTimersBySessionId = new Map<string, GpuiCloseAfterDoneTimer>();
  private commandPaneSessions: GpuiCommandPaneSessionSummary[] = [];
  private domainProjects: GxserverProjectDomainState[] = [];
  private focusedSessionId: string | undefined;
  private gxserverBootstrap: GpuiValidatedGxserverBootstrap | undefined;
  private gitState: SidebarGitState = createDefaultSidebarGitState();
  private hasHydrated = false;
  private latestGroups: SidebarSessionGroup[] = [];
  private latestHud: SidebarHudState = createGpuiSidebarHudState();
  private localFirstHiddenPresentationSessionKeys = new Set<string>();
  private lastAppShotTargetAt = 0;
  private lastAppShotTargetSessionId: string | undefined;
  private lastGitRefreshProjectId: string | undefined;
  private pendingNativeAppShotPromptInsertions: GpuiPendingNativeAppShotPromptInsertion[] = [];
  private pendingGitCommitRequests = new Map<string, GpuiPendingGitCommitRequest>();
  private pendingRemoteGxserverRequests = new Map<string, GpuiPendingRemoteGxserverRequest>();
  private presentation: GxserverPresentationSnapshot | undefined;
  private previousSessionsByHistoryId = new Map<string, SidebarPreviousSessionItem>();
  private previousSessionsResult:
    | {
        previousSessions: SidebarPreviousSessionItem[];
        query?: string;
        requestId: string;
      }
    | undefined;
  private recentProjects: GxserverRecentProjectDomainState[] = [];
  private remoteGxserverRequestSequence = 0;
  private remotePresentations = new Map<string, GxserverPresentationSnapshot>();
  private remoteRecentProjectsByMachineId = new Map<string, GxserverRecentProjectDomainState[]>();
  private revision = 0;
  private runtimeSettings: GpuiSidebarRuntimeSettings | undefined;
  private sidebarHud: GxserverSidebarHudResponse | undefined;
  private sleepingLocalSidebarSessionIds = new Set<string>();
  private subscription: GpuiPresentationSubscription | undefined;
  private trustedExistingWorktreeList: GpuiTrustedExistingWorktreeList | undefined;
  private visibleSessionIds = new Set<string>();
  private workspaceTerminalLifecycleBridgeRetryId: number | undefined;

  start(): void {
    this.installGpuiBridgeCallbacks();
    this.runtimeSettings = currentGpuiRuntimeSettings();
    this.remoteRecentProjectsByMachineId = readStoredGpuiRemoteRecentProjects();
    for (const sessionId of readStoredGpuiCloseAfterDoneSessionIds()) {
      this.closeAfterDoneTimersBySessionId.set(sessionId, {});
    }
    window.addEventListener(GPUI_SIDEBAR_REMOTE_EVENT_NAME, this.handleGpuiSidebarRemoteEvent);
    this.publishUnavailable("bootstrap-pending");
    this.tryStartFromInstalledBootstrap(0);
    this.startGpuiAutoSleepMonitor();
  }

  private installGpuiBridgeCallbacks(): void {
    const gpuiBridge = (window.ghostexGpui = window.ghostexGpui ?? {});
    gpuiBridge.onSidebarHostMessage = (message) => {
      /*
      CDXC:GPUICommandPane 2026-06-24-23:49:
      Rust-owned command-pane Action lifecycle feedback enters the reused SidebarApp through the same local message source as gxserver presentation patches. Keep this callback typed to existing sidebar messages so GPUI can update button run-state without exposing generic IPC, command text, paths, terminal output, or persisted state to React.
      */
      this.messageSource.postMessage(message);
    };
    gpuiBridge.onWorkspaceTerminalLifecycleRequest = (payload) => {
      /*
      CDXC:GPUIWorkspaceLifecycle 2026-06-26-07:25:
      GPUI native workspace tab Close/Sleep must follow macOS ownership: Rust owns the local pane/tab chrome, while the sidebar runtime performs the gxserver lifecycle transition first and reports only request success back through a fixed result bridge. Payloads are bounded ids plus action/request enums only; no titles, paths, commands, terminal text, URLs, tokens, or daemon bodies cross this callback.

      CDXC:GPUIWorkspaceLifecycle 2026-06-26-05:23:
      The callback may be installed before CEF exposes `postWorkspaceTerminalLifecycleResult`. Queue normalized requests until that result bridge exists so gxserver lifecycle commits cannot be lost between React focus and Rust acknowledgement.
      */
      this.handleOrQueueWorkspaceTerminalLifecycleRequest(payload);
    };
    const applyCommandPaneSessions = (
      sessions: readonly GpuiCommandPaneSessionSummary[] | undefined,
    ) => {
      /*
      CDXC:GPUICommandPane 2026-06-25-10:50:
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
    gpuiBridge.onStatusPetActivation = (payload) => {
      this.handleGpuiStatusPetActivation(payload);
    };
    gpuiBridge.onMenuBarProjectActivation = (payload) => {
      this.handleGpuiMenuBarProjectActivation(payload);
    };
    gpuiBridge.onMenuBarSessionActivation = (payload) => {
      void this.handleGpuiMenuBarSessionActivation(payload);
    };
    gpuiBridge.onWorkspaceTabSessionSelected = (payload) => {
      this.handleGpuiWorkspaceTabSessionSelected(payload);
    };
    gpuiBridge.onWorkspaceFolderPicked = (payload) => {
      void this.handleGpuiWorkspaceFolderPicked(payload);
    };
    const pendingStatusPetActivations = Array.isArray(gpuiBridge.pendingStatusPetActivations)
      ? gpuiBridge.pendingStatusPetActivations.splice(0)
      : [];
    if (pendingStatusPetActivations.length > 0) {
      /*
      CDXC:GPUIStatusPetOverlay 2026-06-26-05:07:
      GPUI status clicks, and a later pet slice using the same fixed shape, can arrive before the runtime installs callbacks. Drain only first-party activation payloads carrying bounded session ids, then route through focusSession; do not persist payloads or expose paths, titles, commands, URLs, tokens, terminal text, or a generic native event bus.
      */
      for (const payload of pendingStatusPetActivations) {
        this.handleGpuiStatusPetActivation(payload);
      }
    }
    const pendingMenuBarProjectActivations = Array.isArray(gpuiBridge.pendingMenuBarProjectActivations)
      ? gpuiBridge.pendingMenuBarProjectActivations.splice(0)
      : [];
    if (pendingMenuBarProjectActivations.length > 0) {
      /*
      CDXC:GPUIMenuBarStatusItem 2026-06-26-06:05:
      GPUI menu-bar project clicks can arrive before the SidebarApp runtime installs callbacks. Drain only fixed first-party project activation payloads carrying one bounded project id, then route through focusProjectId; do not persist payloads or expose paths, titles, commands, URLs, tokens, terminal text, or a generic native event bus.
      */
      for (const payload of pendingMenuBarProjectActivations) {
        this.handleGpuiMenuBarProjectActivation(payload);
      }
    }
    const pendingMenuBarSessionActivations = Array.isArray(gpuiBridge.pendingMenuBarSessionActivations)
      ? gpuiBridge.pendingMenuBarSessionActivations.splice(0)
      : [];
    if (pendingMenuBarSessionActivations.length > 0) {
      /*
      CDXC:GPUIMenuBarStatusItem 2026-06-26-06:05:
      GPUI menu-bar session clicks use a fixed first-party payload with bounded project/session ids. Drain queued clicks into the existing focusSession path so local clicks still use WorkspaceTerminalFocus and remote-shaped ids stay within reviewed focus routing.
      */
      for (const payload of pendingMenuBarSessionActivations) {
        void this.handleGpuiMenuBarSessionActivation(payload);
      }
    }
    const pendingWorkspaceTabSessionSelections = Array.isArray(
        gpuiBridge.pendingWorkspaceTabSessionSelections,
      )
      ? gpuiBridge.pendingWorkspaceTabSessionSelections.splice(0)
      : [];
    if (pendingWorkspaceTabSessionSelections.length > 0) {
      /*
      CDXC:GPUIWorkspaceSessionFocus 2026-06-26-08:01:
      Workspace tab clicks originate from Rust after the local tab is already selected. Drain them into sidebar focus only so startup-time delivery cannot re-enter the Rust workspace materialization bridge or create a focus loop.
      */
      for (const payload of pendingWorkspaceTabSessionSelections) {
        this.handleGpuiWorkspaceTabSessionSelected(payload);
      }
    }
    const pendingWorkspaceTerminalLifecycleRequests = Array.isArray(
        gpuiBridge.pendingWorkspaceTerminalLifecycleRequests,
      )
      ? gpuiBridge.pendingWorkspaceTerminalLifecycleRequests.splice(0)
      : [];
    this.drainPendingWorkspaceTerminalLifecycleRequests(pendingWorkspaceTerminalLifecycleRequests);
    const pendingWorkspaceFolderPicks = Array.isArray(gpuiBridge.pendingWorkspaceFolderPicks)
      ? gpuiBridge.pendingWorkspaceFolderPicks.splice(0)
      : [];
    for (const payload of pendingWorkspaceFolderPicks) {
      void this.handleGpuiWorkspaceFolderPicked(payload);
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
      CDXC:GPUIAppShots 2026-06-25-23:07:
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
      void this.runGpuiAutoSleepMonitor("settings-change");
    };
    gpuiBridge.onGxserverBootstrapChanged = (bootstrap) => {
      this.applyGxserverBootstrapChanged(bootstrap);
    };
  }

  private startGpuiAutoSleepMonitor(): void {
    if (this.autoSleepMonitorIntervalId !== undefined) {
      return;
    }
    /*
    CDXC:GPUISidebarAutoSleep 2026-06-27-01:24:
    GPUI owns only the SidebarApp/gxserver runtime policy loop for agent terminal Auto Sleep. Run a small idempotent monitor from the runtime lifecycle, use the normalized shared settings snapshot, and route every sleep through the existing gxserver session lifecycle path instead of adding Browser, project-editor, native-pane, or renderer-local sleep behavior.
    */
    this.autoSleepMonitorIntervalId = window.setInterval(() => {
      void this.runGpuiAutoSleepMonitor("interval");
    }, GPUI_AUTO_SLEEP_MONITOR_INTERVAL_MS);
    void this.runGpuiAutoSleepMonitor("startup");
  }

  private async runGpuiAutoSleepMonitor(
    _source: "interval" | "settings-change" | "startup",
  ): Promise<void> {
    if (this.autoSleepMonitorRunning) {
      return;
    }
    const settings = createGpuiSidebarSettings(this.runtimeSettings);
    if (!settings.autoSleepAgentSessionsEnabled || !this.presentation) {
      return;
    }
    const sessionIdsToSleep = createGpuiAutoSleepAgentSessionIds({
      activeProjectId: this.activeProjectId,
      commandPaneSessions: this.commandPaneSessions,
      focusedSessionId: this.focusedSessionId,
      groups: this.latestGroups,
      nowMs: Date.now(),
      presentation: this.presentation,
      settings,
    });
    if (sessionIdsToSleep.length === 0) {
      return;
    }
    this.autoSleepMonitorRunning = true;
    try {
      /*
      CDXC:GPUISidebarAutoSleep 2026-06-27-02:05:
      Auto Sleep must match native bulk sleep pacing: eligible agent sessions sleep one at a time with a 350 ms gap so gxserver and terminal teardown are not hit concurrently. Use the shared aggregate-count helper and ignore its private-data-free result because monitor progress is already reflected by gxserver presentation updates.
      */
      await runGpuiSidebarBulkSleepPaced(sessionIdsToSleep, async (sessionId) => {
        await this.setSessionSleeping(sessionId, true);
      });
    } finally {
      this.autoSleepMonitorRunning = false;
    }
  }

  private handleGpuiStatusPetActivation(payload: unknown): void {
    const activation = normalizeGpuiStatusPetActivation(payload);
    if (!activation) {
      return;
    }
    /*
    CDXC:GPUIStatusPetOverlay 2026-06-26-05:07:
    Visible GPUI status activation, and later pet activation, must re-enter the sidebar runtime's existing focusSession route. Keep this as a fixed callback with one bounded session id so local focus stays local, remote focus uses the reviewed remote native action path, and Rust never creates or wakes unrelated sessions for indicator clicks.
    */
    void this.focusSession(activation.sessionId, {
      sessionId: activation.sessionId,
      type: "focusSession",
    });
  }

  private handleGpuiMenuBarProjectActivation(payload: unknown): void {
    const activation = normalizeGpuiMenuBarProjectActivation(payload);
    if (!activation) {
      return;
    }
    /*
    CDXC:GPUIMenuBarStatusItem 2026-06-26-06:05:
    Running Agents project rows should behave like focusing the matching sidebar project group. Reuse local focusProjectId or the remote group projection plus the normal presentation publish instead of creating a native-only project switch path, and accept only the bounded project id from Rust.
    */
    const remoteProject = parseGpuiRemotePresentationProjectId(activation.projectId);
    if (remoteProject) {
      this.activeGroupId = createGpuiRemotePresentationGroupId(
        remoteProject.machineId,
        remoteProject.projectId,
      );
      this.publishRemotePresentationPatch();
      return;
    }
    this.focusProjectId(activation.projectId);
    this.publishPresentation("patch");
  }

  private async handleGpuiMenuBarSessionActivation(payload: unknown): Promise<void> {
    const activation = normalizeGpuiMenuBarSessionActivation(payload);
    if (!activation) {
      return;
    }
    /*
    CDXC:GPUIMenuBarStatusItem 2026-06-26-06:05:
    Running Agents session rows should behave like sidebar session-card clicks. Normalize raw local gxserver ids into the existing project-scoped presentation id when needed, then reuse focusSession so local clicks update presentation focus and post WorkspaceTerminalFocus back to Rust for terminal selection/materialization.
    */
    const sessionId = gpuiMenuBarStatusSessionFocusRoutingId(
      activation.projectId,
      activation.sessionId,
    );
    await this.focusSession(sessionId, {
      sessionId,
      type: "focusSession",
    });
  }

  private handleGpuiWorkspaceTabSessionSelected(payload: unknown): void {
    const selection = normalizeGpuiWorkspaceTabSessionSelection(payload);
    if (!selection) {
      return;
    }
    /*
    CDXC:GPUIWorkspaceSessionFocus 2026-06-26-08:01:
    A GPUI workspace tab click has already selected the native tab in Rust. Match macOS `paneTabSelected` by updating the sidebar's local presentation focus and publishing only the sidebar patch; do not post `workspaceTerminalFocus` back to Rust or call gxserver `/api/focusSession`.

    CDXC:GPUIWorkspaceSessionFocus 2026-06-27-00:33:
    MacOS reconciles stale native sleeping pane tabs when gxserver presentation already reports the canonical P/G session running. Preserve the one-way tab-selection path for ordinary clicks, but if Rust marks the selected mapped tab as locally sleeping and the current presentation row is running, post one bounded WorkspaceTerminalFocus so Rust reuses and attaches that existing tab instead of leaving an inert sleeping placeholder.
    */
    const shouldReconcileRunningPresentation =
      selection.localWasSleeping === true &&
      this.presentation?.sessions.some((session) =>
        session.projectId === selection.projectId &&
        session.sessionId === selection.sessionId &&
        session.lifecycleState === "running"
      ) === true;
    this.setLocalPresentationSessionFocus(selection.projectId, selection.sessionId);
    if (shouldReconcileRunningPresentation) {
      this.postLocalWorkspaceTerminalFocus(selection.projectId, selection.sessionId);
    }
    this.publishPresentation("patch");
  }

  private applyGxserverBootstrapChanged(bootstrap: GpuiGxserverBootstrap): void {
    const validated = validateGpuiGxserverBootstrap(bootstrap);
    if (!validated) {
      this.startFromBootstrap(bootstrap);
      return;
    }
    if (!this.gxserverBootstrap || !hasSameGpuiGxserverBootstrapTransport(this.gxserverBootstrap, validated)) {
      this.startFromBootstrap(bootstrap);
      return;
    }
    /*
    CDXC:GPUISidebarBootstrapReplay 2026-06-26-05:31:
    Post-start same-transport bootstrap refreshes are Rust's replay channel for the sidebar bridge, not a new macOS-style focus command. Store the refreshed transport/focus hint snapshot but do not reapply `initialActiveProjectId`, focused session, or visible ids over live React focus; otherwise the active project can bounce between stale and current sidebar snapshots after a local click.
    */
    this.gxserverBootstrap = validated;
  }

  private async handleNativeAppShotCaptured(payload: unknown): Promise<void> {
    const appShot = normalizeGpuiNativeAppShotCapture(payload);
    if (!appShot) {
      this.postAppShotToast("warning", "App Shot Failed", {
        description: "Could not read the native App Shot.",
      });
      return;
    }

    const prompt = formatGpuiNativeAppShotPrompt(
      appShot,
      createGpuiSidebarSettings(this.runtimeSettings).appShotsMetadataEnabled,
    );
    const staged = await this.stageNativeAppShotInAgentSession(prompt);
    if (!staged.ok) {
      this.postAppShotToast("warning", "App Shot Failed", {
        description: staged.description,
      });
      return;
    }

    this.postAppShotToast("success", "App Shot Added", {
      description: appShot.appName,
    });
  }

  private async stageNativeAppShotInAgentSession(
    prompt: string,
  ): Promise<{ ok: true } | { description: string; ok: false }> {
    /*
    CDXC:GPUIAppShots 2026-06-25-23:28:
    GPUI App Shots mirror macOS target order for local sessions: reuse the last successful local App Shot target for 60 seconds when it is still a live local agent row, otherwise use the focused/visible local agent row, and create a default prompt-agent session only when the exact local insert bridge declines. Keep command-pane, sleeping, stale, non-agent, and sidebar-only rows out of insertion.

    CDXC:GPUIAppShots 2026-06-26-04:27:
    Existing-session App Shot targeting now accepts live remote agent rows by their machine-scoped presentation session id, but only as an insertion request to Rust. React must not wake, materialize, or open remote attach tabs for App Shots; Rust may write only when that exact remote attach surface is already mounted.
    */
    const targetSession = this.resolveNativeAppShotTargetSession();
    if (targetSession && await this.stageNativeAppShotInExistingAgentSession(targetSession, prompt)) {
      return { ok: true };
    }

    if (!this.client) {
      return {
        description: "The local agent service is not ready.",
        ok: false,
      };
    }
    const project = this.activeDomainProject();
    if (!project) {
      return {
        description: "Open a project before using App Shots.",
        ok: false,
      };
    }
    const agent = this.resolveDefaultPromptAgent();
    if (!agent?.command?.trim()) {
      return {
        description: "Choose a configured default prompt agent before using App Shots.",
        ok: false,
      };
    }

    try {
      const sessionId = await this.createAgentSessionForProject(project, agent, prompt);
      this.rememberNativeAppShotTargetSessionId(sessionId);
      return { ok: true };
    } catch {
      return {
        description: "Could not stage the App Shot in an agent session.",
        ok: false,
      };
    }
  }

  private async stageNativeAppShotInExistingAgentSession(
    session: SidebarSessionItem,
    prompt: string,
  ): Promise<boolean> {
    const sessionId = nativeAppShotPromptSessionIdForSidebarSession(session);
    if (!sessionId) {
      return false;
    }
    const remoteSession = parseGpuiRemotePresentationSessionId(sessionId);
    if (remoteSession) {
      this.setRemotePresentationSessionFocus(remoteSession);
    } else {
      const projectId = localGxserverProjectIdForSidebarSession(session, this.presentation);
      if (projectId) {
        this.focusLocalWorkspaceSession(projectId, sessionId);
      } else {
        this.focusedSessionId = sessionId;
        this.visibleSessionIds = new Set([sessionId]);
        this.postGxserverPresentationFocusState();
      }
    }
    const inserted = await this.postNativeAppShotPromptToSession(sessionId, prompt);
    if (inserted) {
      this.rememberNativeAppShotTargetSessionId(sessionId);
    }
    return inserted;
  }

  private resolveNativeAppShotTargetSession(): SidebarSessionItem | undefined {
    const now = Date.now();
    const recentTarget =
      this.lastAppShotTargetSessionId &&
      now - this.lastAppShotTargetAt <= APP_SHOT_RECENT_TARGET_MS
        ? this.findNativeAppShotSessionByPresentationSessionId(this.lastAppShotTargetSessionId)
        : undefined;
    if (isNativeAppShotAgentSession(recentTarget)) {
      return recentTarget;
    }

    const focusedSession =
      this.focusedSessionId
        ? this.findNativeAppShotSessionByPresentationSessionId(this.focusedSessionId)
        : undefined;
    if (isNativeAppShotAgentSession(focusedSession)) {
      return focusedSession;
    }

    for (const sessionId of this.visibleSessionIds) {
      const visibleSession = this.findNativeAppShotSessionByPresentationSessionId(sessionId);
      if (visibleSession?.isVisible && isNativeAppShotAgentSession(visibleSession)) {
        return visibleSession;
      }
    }
    return undefined;
  }

  private findNativeAppShotSessionByPresentationSessionId(
    sessionId: string,
  ): SidebarSessionItem | undefined {
    const normalizedSessionId = normalizeNonEmptyString(sessionId);
    if (!normalizedSessionId) {
      return undefined;
    }
    if (parseGpuiRemotePresentationSessionId(normalizedSessionId)) {
      return this.findNativeAppShotSessionByRemotePresentationSessionId(normalizedSessionId);
    }
    return this.findNativeAppShotSessionByLocalGxserverSessionId(normalizedSessionId);
  }

  private findNativeAppShotSessionByLocalGxserverSessionId(
    sessionId: string,
  ): SidebarSessionItem | undefined {
    const normalizedSessionId = normalizeNonEmptyString(sessionId);
    if (!normalizedSessionId || parseGpuiRemotePresentationSessionId(normalizedSessionId)) {
      return undefined;
    }
    for (const group of this.latestGroups) {
      if (group.remoteMachineContext) {
        continue;
      }
      const session = group.sessions.find(
        (candidate) =>
          localGxserverSessionIdForSidebarSession(candidate) === normalizedSessionId,
      );
      if (session) {
        return session;
      }
    }
    return undefined;
  }

  private findNativeAppShotSessionByRemotePresentationSessionId(
    sessionId: string,
  ): SidebarSessionItem | undefined {
    const normalizedSessionId = normalizeNonEmptyString(sessionId);
    if (!normalizedSessionId || !parseGpuiRemotePresentationSessionId(normalizedSessionId)) {
      return undefined;
    }
    for (const group of this.latestGroups) {
      if (!group.remoteMachineContext) {
        continue;
      }
      const session = group.sessions.find(
        (candidate) => candidate.sessionId === normalizedSessionId,
      );
      if (session) {
        return session;
      }
    }
    return undefined;
  }

  private async postNativeAppShotPromptToSession(
    sessionId: string,
    prompt: string,
  ): Promise<boolean> {
    const postPrompt = window.ghostexGpui?.postNativeAppShotPromptToSession;
    if (typeof postPrompt !== "function") {
      return false;
    }
    const payload = JSON.stringify({
      prompt,
      sessionId,
      type: GPUI_SIDEBAR_NATIVE_APP_SHOT_PROMPT_MESSAGE_TYPE,
      version: GPUI_SIDEBAR_NATIVE_APP_SHOT_PROMPT_MESSAGE_VERSION,
    });

    return await new Promise<boolean>((resolve) => {
      const pending: GpuiPendingNativeAppShotPromptInsertion = {
        resolve,
        sessionId,
        timeoutId: 0,
      };
      pending.timeoutId = window.setTimeout(() => {
        this.resolvePendingNativeAppShotPromptInsertion(pending, false);
      }, APP_SHOT_PROMPT_INSERT_RESULT_TIMEOUT_MS);
      this.pendingNativeAppShotPromptInsertions.push(pending);
      let sent = false;
      try {
        sent = postPrompt(payload) === true;
      } catch {
        sent = false;
      }
      if (!sent) {
        this.resolvePendingNativeAppShotPromptInsertion(pending, false);
      }
    });
  }

  private handleNativeAppShotPromptResult(payload: unknown): void {
    const result = normalizeGpuiNativeAppShotPromptResult(payload);
    if (!result) {
      return;
    }
    const pending = this.pendingNativeAppShotPromptInsertions.find(
      (candidate) => candidate.sessionId === result.sessionId,
    );
    if (!pending) {
      return;
    }
    this.resolvePendingNativeAppShotPromptInsertion(pending, result.ok);
  }

  private resolvePendingNativeAppShotPromptInsertion(
    pending: GpuiPendingNativeAppShotPromptInsertion,
    ok: boolean,
  ): void {
    const index = this.pendingNativeAppShotPromptInsertions.indexOf(pending);
    if (index >= 0) {
      this.pendingNativeAppShotPromptInsertions.splice(index, 1);
    }
    window.clearTimeout(pending.timeoutId);
    pending.resolve(ok);
  }

  private rememberNativeAppShotTargetSessionId(sessionId: string): void {
    const normalizedSessionId = normalizeNonEmptyString(sessionId);
    if (!normalizedSessionId) {
      return;
    }
    this.lastAppShotTargetSessionId = normalizedSessionId;
    this.lastAppShotTargetAt = Date.now();
  }

  private readonly handleGpuiSidebarRemoteEvent = (event: Event): void => {
    const remoteEvent = normalizeGpuiSidebarRemoteEvent((event as CustomEvent<unknown>).detail);
    if (!remoteEvent) {
      return;
    }
    if (remoteEvent.type === "remoteMachineStatus") {
      this.messageSource.postMessage(remoteEvent);
      if (
        remoteEvent.state === "disconnected" ||
        remoteEvent.state === "failed" ||
        remoteEvent.state === "installApprovalRequired"
      ) {
        this.remotePresentations.delete(remoteEvent.machineId);
        this.dropRemotePresentationSessionFocus(remoteEvent.machineId);
        this.publishRemotePresentationPatch();
      }
      return;
    }

    if (remoteEvent.type === "remoteGxserverResponse") {
      this.resolveRemoteGxserverRequest(remoteEvent);
      return;
    }

    if (remoteEvent.payload.type === "presentationSnapshot") {
      this.remotePresentations.set(remoteEvent.remoteMachineId, remoteEvent.payload.snapshot);
      this.publishRemotePresentationPatch();
      return;
    }

    const previous = this.remotePresentations.get(remoteEvent.remoteMachineId);
    if (!previous || remoteEvent.payload.revision <= previous.revision) {
      return;
    }
    this.remotePresentations.set(
      remoteEvent.remoteMachineId,
      reduceGxserverPresentationDelta(
        previous,
        remoteEvent.payload.delta,
        remoteEvent.payload.revision,
      ),
    );
    this.publishRemotePresentationPatch();
  };

  private tryStartFromInstalledBootstrap(attempt: number): void {
    const bootstrap = window.ghostexGpui?.gxserverBootstrap;
    if (bootstrap) {
      this.startFromBootstrap(bootstrap);
      return;
    }
    if (attempt >= GPUI_SIDEBAR_BOOTSTRAP_MAX_ATTEMPTS) {
      return;
    }
    this.bootstrapPollTimeoutId = window.setTimeout(() => {
      this.tryStartFromInstalledBootstrap(attempt + 1);
    }, GPUI_SIDEBAR_BOOTSTRAP_RETRY_DELAY_MS);
  }

  private startFromBootstrap(bootstrap: GpuiGxserverBootstrap): void {
    if (this.bootstrapPollTimeoutId !== undefined) {
      window.clearTimeout(this.bootstrapPollTimeoutId);
      this.bootstrapPollTimeoutId = undefined;
    }

    const validated = validateGpuiGxserverBootstrap(bootstrap);
    if (!validated) {
      this.publishUnavailable("bootstrap-invalid");
      return;
    }

    this.subscription?.close();
    this.gxserverBootstrap = validated;
    this.client = new GpuiGxserverClient(validated);
    this.applyGxserverBootstrapPresentationState(validated);

    const client = this.client;
    void Promise.all([
      client.fetchPresentationSnapshot(),
      client.fetchAppUserData(),
      client.fetchProjectList().catch(() => undefined),
      client.fetchRecentProjects().catch(() => undefined),
      client.fetchSidebarHud(validated.initialActiveProjectId),
    ])
      .then(([snapshot, appUserData, domainProjects, recentProjects, sidebarHud]) => {
        if (this.client !== client) {
          return;
        }
        this.appUserData = appUserData;
        this.domainProjects = domainProjects ? [...domainProjects] : [];
        this.recentProjects = recentProjects ? [...recentProjects] : [];
        this.sidebarHud = sidebarHud;
        this.applyPresentationSnapshot(snapshot, "hydrate");
        this.openPresentationSubscription(validated.clientId, snapshot.revision);
      })
      .catch(() => {
        this.publishUnavailable("snapshot-failed");
      });
  }

  private applyGxserverBootstrapPresentationState(
    bootstrap: GpuiValidatedGxserverBootstrap,
  ): boolean {
    const nextFocusedSessionId = bootstrap.focusedSessionId;
    const nextVisibleSessionIds = new Set(bootstrap.visibleSessionIds ?? []);
    const nextActiveProjectId = bootstrap.initialActiveProjectId;
    const nextActiveGroupId = activeGroupIdForGpuiGxserverBootstrapPresentationState({
      focusedSessionId: nextFocusedSessionId,
      initialActiveProjectId: nextActiveProjectId,
    });
    const didChange =
      this.activeProjectId !== nextActiveProjectId ||
      this.activeGroupId !== nextActiveGroupId ||
      this.focusedSessionId !== nextFocusedSessionId ||
      !sameStringSet(this.visibleSessionIds, nextVisibleSessionIds);
    this.activeProjectId = nextActiveProjectId;
    this.activeGroupId = nextActiveGroupId;
    this.focusedSessionId = nextFocusedSessionId;
    this.visibleSessionIds = nextVisibleSessionIds;
    return didChange;
  }

  private openPresentationSubscription(clientId: string, lastRevision: number): void {
    if (!this.client) {
      return;
    }
    this.subscription = this.client.subscribePresentation({
      clientId,
      lastRevision,
      onClose: () => {
        this.recoverPresentationStream(clientId);
      },
      onDelta: (delta, revision) => {
        this.applyPresentationDelta(delta, revision);
      },
      onError: () => {
        this.recoverPresentationStream(clientId);
      },
      onRendererCommand: (command) => this.handleGxserverRendererCommand(command),
      onSnapshot: (snapshot) => {
        this.applyPresentationSnapshot(snapshot, this.hasHydrated ? "patch" : "hydrate");
      },
    });
  }

  private async handleGxserverRendererCommand(
    command: GxserverRendererCommand,
  ): Promise<Record<string, unknown>> {
    switch (command.action) {
      case "focusSession": {
        const resolvedSession = this.resolveGxserverRendererCommandSession(command.payload);
        if (!resolvedSession) {
          throw new Error("No matching session was found.");
        }
        await this.focusSession(resolvedSession.sidebarSessionId, {
          sessionId: resolvedSession.sidebarSessionId,
          type: "focusSession",
        });
        return {
          ok: true,
          session: {
            ghostexId: resolvedSession.sidebarSessionId,
            projectId: resolvedSession.projectId,
            sessionId: resolvedSession.sessionId,
          },
        };
      }
      case "renameCommand": {
        const resolvedSession = this.resolveGxserverRendererCommandSession(command.payload);
        if (!resolvedSession) {
          throw new Error("No matching session was found.");
        }
        const title = normalizeGpuiRendererCommandRenameTitle(command.payload);
        if (!title) {
          throw new Error("Invalid renderer command title.");
        }
        this.postLocalWorkspaceTerminalRenameCommand(
          resolvedSession.projectId,
          resolvedSession.sessionId,
          title,
        );
        return {
          accepted: true,
          action: "renameCommand",
          ok: true,
          session: {
            ghostexId: resolvedSession.sidebarSessionId,
            projectId: resolvedSession.projectId,
            sessionId: resolvedSession.sessionId,
          },
        };
      }
      case "runCommand":
        return this.runGxserverRendererCommandButton(
          readGpuiRecordString(command.payload, "commandId"),
          command,
        );
      case "clickButton": {
        const kind = readGpuiRecordString(command.payload, "kind")?.trim();
        if (kind !== "command") {
          throw new Error("Unsupported renderer command.");
        }
        return this.runGxserverRendererCommandButton(
          readGpuiRecordString(command.payload, "id"),
          command,
        );
      }
      default:
        throw new Error("Unsupported renderer command.");
    }
  }

  private runGxserverRendererCommandButton(
    rawCommandId: string | undefined,
    rendererCommand: GxserverRendererCommand,
  ): Record<string, unknown> {
    /*
    CDXC:GxserverRendererCommands 2026-06-27-05:51:
    gxserver `runCommand` and `clickButton(kind:"command")` must launch the same trusted project Action button as native. Treat renderer payloads as selectors only; command text, URLs, close-on-exit normalization, completion-sound preference, cwd/env, paths, output, and logs must come from the live HUD command and fixed Rust command-action bridge.
    */
    const commandId = normalizeNonEmptyString(rawCommandId)?.trim();
    if (!commandId) {
      throw new Error("Unsupported renderer command.");
    }
    const command = this.resolveSidebarCommand(commandId);
    if (!command || !isSidebarCommandConfigured(command)) {
      throw new Error("Unsupported renderer command.");
    }
    const selectionMessage: Extract<SidebarToExtensionMessage, { type: "runSidebarCommand" }> = {
      commandId,
      type: "runSidebarCommand",
    };
    if (!this.postSidebarCommandAction(command, selectionMessage)) {
      throw new Error("Renderer command bridge unavailable.");
    }
    return {
      accepted: true,
      action: rendererCommand.action,
      ok: true,
    };
  }

  private resolveGxserverRendererCommandSession(
    payload: Record<string, unknown>,
  ): GpuiRendererCommandResolvedSession | undefined {
    /*
    CDXC:GxserverRendererCommands 2026-06-27-02:05:
    gxserver renderer commands can target local sessions with raw project/session ids in `sessionTarget`, while the reused GPUI SidebarApp renders combined `combined-session:<project>:<session>` ids. Resolve those raw ids to the same combined sidebar id before invoking runtime focus logic, and keep the command result bounded to ids/status rather than paths, titles, command text, URLs, tokens, terminal output, or renderer payload echoes.
    */
    const target = readGpuiRendererCommandSessionTarget(payload);
    const globalReference = parseGpuiRendererCommandGlobalSessionRef(
      readGpuiRecordString(target, "globalRef") ?? readGpuiRecordString(payload, "globalRef"),
    );
    const projectId =
      readGpuiRecordString(target, "projectId")?.trim() ||
      readGpuiRecordString(payload, "projectId")?.trim() ||
      globalReference?.projectId;
    const sessionId =
      readGpuiRecordString(target, "sessionId")?.trim() ||
      readGpuiRecordString(payload, "sessionId")?.trim() ||
      globalReference?.sessionId;
    if (!sessionId) {
      return undefined;
    }
    const scopedSession = parseGxserverPresentationProjectSessionId(sessionId);
    if (scopedSession) {
      if (projectId && scopedSession.projectId !== projectId) {
        return undefined;
      }
      if (
        !this.hasGpuiRendererCommandLocalSession(
          scopedSession.projectId,
          scopedSession.sessionId,
        )
      ) {
        return undefined;
      }
      return {
        projectId: scopedSession.projectId,
        sessionId: scopedSession.sessionId,
        sidebarSessionId: sessionId,
      };
    }
    if (!projectId) {
      return undefined;
    }
    if (!this.hasGpuiRendererCommandLocalSession(projectId, sessionId)) {
      return undefined;
    }
    return {
      projectId,
      sessionId,
      sidebarSessionId: createGxserverPresentationProjectSessionId(projectId, sessionId),
    };
  }

  private hasGpuiRendererCommandLocalSession(projectId: string, sessionId: string): boolean {
    if (
      this.presentation?.sessions.some((session) =>
        session.projectId === projectId && session.sessionId === sessionId
      )
    ) {
      return true;
    }
    return this.latestGroups.some((group) =>
      group.sessions.some((session) => {
        const reference = parseGxserverPresentationProjectSessionId(session.sessionId);
        return reference?.projectId === projectId && reference.sessionId === sessionId;
      })
    );
  }

  private postLocalWorkspaceTerminalRenameCommand(
    projectId: string,
    sessionId: string,
    title: string,
  ): void {
    /*
    CDXC:GxserverRendererCommands 2026-06-27-02:27:
    GPUI `renameCommand` is accepted when TypeScript resolves gxserver's raw sessionTarget to the local workspace session and posts one fixed fire-and-forget Rust bridge payload. Keep the result and errors id-only, and pass the normalized title only through `postWorkspaceTerminalRenameCommand` so logs/results do not expose user title text, command text, paths, URLs, tokens, or terminal output.
    */
    const postRename = window.ghostexGpui?.postWorkspaceTerminalRenameCommand;
    if (typeof postRename !== "function") {
      throw new Error("Renderer command bridge unavailable.");
    }
    const bridgeSent = postRename(JSON.stringify({
      version: GPUI_SIDEBAR_WORKSPACE_TERMINAL_RENAME_COMMAND_MESSAGE_VERSION,
      type: GPUI_SIDEBAR_WORKSPACE_TERMINAL_RENAME_COMMAND_MESSAGE_TYPE,
      projectId,
      sessionId,
      title,
    }));
    if (!bridgeSent) {
      throw new Error("Renderer command bridge unavailable.");
    }
  }

  private recoverPresentationStream(clientId: string): void {
    if (!this.client) {
      return;
    }
    const client = this.client;
    this.subscription?.close();
    this.subscription = undefined;
    void Promise.all([
      client.fetchPresentationSnapshot(),
      client.fetchProjectList().catch(() => undefined),
      client.fetchRecentProjects().catch(() => undefined),
      client.fetchSidebarHud(this.activeProjectId),
    ])
      .then(([snapshot, domainProjects, recentProjects, sidebarHud]) => {
        if (this.client !== client) {
          return;
        }
        if (domainProjects) {
          this.domainProjects = [...domainProjects];
        }
        if (recentProjects) {
          this.recentProjects = [...recentProjects];
        }
        this.sidebarHud = sidebarHud;
        this.applyPresentationSnapshot(snapshot, this.hasHydrated ? "patch" : "hydrate");
        this.openPresentationSubscription(clientId, snapshot.revision);
      })
      .catch(() => {
        this.publishUnavailable("stream-recovery-failed");
      });
  }

  private applyPresentationSnapshot(
    snapshot: GxserverPresentationSnapshot,
    kind: GpuiSidebarRuntimeSnapshotKind,
  ): void {
    this.presentation = snapshot;
    this.publishPresentation(kind);
    if (kind === "hydrate") {
      void this.runGpuiAutoSleepMonitor("startup");
    }
  }

  private applyPresentationDelta(delta: GxserverPresentationDelta, gxserverRevision: number): void {
    if (!this.presentation || gxserverRevision <= this.presentation.revision) {
      return;
    }
    this.applyDomainProjectDelta(delta);
    this.presentation = reduceGxserverPresentationDelta(
      this.presentation,
      delta,
      gxserverRevision,
    );
    this.publishPresentation("patch");
  }

  private publishPresentation(kind: GpuiSidebarRuntimeSnapshotKind): void {
    const presentation = this.presentation;
    if (!presentation) {
      this.publishUnavailable("presentation-missing");
      return;
    }

    const previousGroups = this.latestGroups;
    const groups = this.createSidebarGroups(presentation);
    /*
    CDXC:GPUIWorkspaceSessionFocus 2026-06-26-23:24:
    Sidebar session-card wake decisions should use the lifecycle state that was just rendered from gxserver presentation. Cache only bounded local project/session routing ids for sleeping rows before emitting hydrate/patch so a same-tick click cannot miss the sleeping state and fall through to plain focus.
    */
    this.sleepingLocalSidebarSessionIds = new Set(
      groups.flatMap((group) =>
        group.sessions.flatMap((session) => {
          const reference = parseGxserverPresentationProjectSessionId(session.sessionId);
          return reference &&
            (session.lifecycleState === "sleeping" || session.isSleeping === true)
            ? [createGxserverPresentationProjectSessionId(reference.projectId, reference.sessionId)]
            : [];
        }),
      ),
    );
    this.latestHud = createGpuiSidebarHudState({
      activeProjectId: this.activeProjectId,
      commandPaneSessions: this.commandPaneSessions,
      focusedSessionId: this.focusedSessionId,
      git: this.gitStateForHud(),
      groups,
      presentation,
      runtimeSettings: this.runtimeSettings,
      domainProjects: this.domainProjects,
      recentProjects: this.recentProjects,
      remoteRecentProjectsByMachineId: this.remoteRecentProjectsByMachineId,
      remotePresentationsByMachineId: this.remotePresentations,
      sidebarHud: this.sidebarHud,
    });

    if (kind === "hydrate" || !this.hasHydrated) {
      this.messageSource.postMessage(this.createHydrateMessage(groups, this.latestHud));
      this.hasHydrated = true;
    } else {
      const patch = createGpuiSidebarGroupsPatch(previousGroups, groups);
      const revision = ++this.revision;
      this.messageSource.postMessage({
        groupOrder: patch.groupOrder,
        groups: patch.groups,
        removedGroupIds: patch.removedGroupIds,
        removedSessionIds: patch.removedSessionIds,
        revision,
        type: "sidebarGroupsChanged",
      });
      this.messageSource.postMessage({
        hud: this.latestHud,
        revision,
        type: "sidebarHudChanged",
      });
    }
    this.latestGroups = groups;
    this.postGpuiStatusPetState();
    this.postActiveProjectContext();
    this.postGxserverPresentationFocusState();
    this.refreshGitStateForActiveProjectIfNeeded();
  }

  private publishUnavailable(_reason: string): void {
    this.presentation = undefined;
    this.appUserData = createEmptyGpuiAppUserData();
    this.domainProjects = [];
    this.dropLocalPresentationSessionFocus();
    this.gitState = createDefaultSidebarGitState();
    this.lastGitRefreshProjectId = undefined;
    this.pendingGitCommitRequests.clear();
    this.recentProjects = [];
    this.sidebarHud = undefined;
    this.latestGroups = [
      ...createGpuiGxserverUnavailableSidebarGroups(),
      ...this.createRemoteSidebarGroups(),
    ];
    this.latestHud = createGpuiSidebarHudState({
      activeProjectId: this.activeProjectId,
      commandPaneSessions: this.commandPaneSessions,
      git: this.gitStateForHud(),
      groups: this.latestGroups,
      runtimeSettings: this.runtimeSettings,
      domainProjects: this.domainProjects,
      recentProjects: this.recentProjects,
      remoteRecentProjectsByMachineId: this.remoteRecentProjectsByMachineId,
      remotePresentationsByMachineId: this.remotePresentations,
      sidebarHud: this.sidebarHud,
    });
    this.messageSource.postMessage(
      this.createHydrateMessage(this.latestGroups, this.latestHud),
    );
    this.hasHydrated = true;
    this.postGpuiStatusPetState();
    this.postActiveProjectContext();
    this.postGxserverPresentationFocusState();
  }

  private publishRemotePresentationPatch(): void {
    const previousGroups = this.latestGroups;
    const groups = this.presentation
      ? this.createSidebarGroups(this.presentation)
      : [
          ...createGpuiGxserverUnavailableSidebarGroups(),
          ...this.createRemoteSidebarGroups(),
        ];
    this.latestHud = createGpuiSidebarHudState({
      activeProjectId: this.activeProjectId,
      commandPaneSessions: this.commandPaneSessions,
      focusedSessionId: this.focusedSessionId,
      git: this.gitStateForHud(),
      groups,
      presentation: this.presentation,
      runtimeSettings: this.runtimeSettings,
      domainProjects: this.domainProjects,
      recentProjects: this.recentProjects,
      remoteRecentProjectsByMachineId: this.remoteRecentProjectsByMachineId,
      remotePresentationsByMachineId: this.remotePresentations,
      sidebarHud: this.sidebarHud,
    });
    if (!this.hasHydrated) {
      this.messageSource.postMessage(this.createHydrateMessage(groups, this.latestHud));
      this.hasHydrated = true;
    } else {
      const patch = createGpuiSidebarGroupsPatch(previousGroups, groups);
      const revision = ++this.revision;
      this.messageSource.postMessage({
        groupOrder: patch.groupOrder,
        groups: patch.groups,
        removedGroupIds: patch.removedGroupIds,
        removedSessionIds: patch.removedSessionIds,
        revision,
        type: "sidebarGroupsChanged",
      });
      this.messageSource.postMessage({
        hud: this.latestHud,
        revision,
        type: "sidebarHudChanged",
      });
    }
    this.latestGroups = groups;
    this.postGpuiStatusPetState();
    this.postActiveProjectContext();
    this.postGxserverPresentationFocusState();
  }

  private applyDomainProjectDelta(delta: GxserverPresentationDelta): void {
    if ("domainProject" in delta && delta.domainProject) {
      const nextProject = delta.domainProject;
      const existingIndex = this.domainProjects.findIndex(
        (project) => project.projectId === nextProject.projectId,
      );
      this.domainProjects =
        existingIndex >= 0
          ? this.domainProjects.map((project, index) =>
              index === existingIndex ? nextProject : project,
            )
          : [...this.domainProjects, nextProject];
      if (
        nextProject.isRecentProject === true ||
        this.recentProjects.some((project) => project.projectId === nextProject.projectId)
      ) {
        this.refreshRecentProjectsFromClient();
      }
      this.refreshSidebarHudFromClient();
      return;
    }
    if (delta.type === "projectRemoved") {
      this.domainProjects = this.domainProjects.filter(
        (project) => project.projectId !== delta.projectId,
      );
      this.refreshRecentProjectsFromClient();
      this.refreshSidebarHudFromClient();
    }
  }

  private refreshRecentProjectsFromClient(): void {
    const client = this.client;
    if (!client) {
      return;
    }
    void client.fetchRecentProjects()
      .then((recentProjects) => {
        if (this.client !== client) {
          return;
        }
        this.recentProjects = [...recentProjects];
        if (this.presentation) {
          this.publishPresentation("patch");
          return;
        }
        this.publishHudPatch();
      })
      .catch(() => undefined);
  }

  private refreshSidebarHudFromClient(): void {
    const client = this.client;
    if (!client) {
      return;
    }
    void client.fetchSidebarHud(this.activeProjectId)
      .then((sidebarHud) => {
        if (this.client !== client) {
          return;
        }
        this.sidebarHud = sidebarHud;
        this.publishHudPatch();
      })
      .catch(() => {
        /*
         * CDXC:SidebarHudContract 2026-06-24-20:34:
         * Sidebar HUD projection refresh is best-effort after active-project or
         * project-metadata changes. Failure keeps the previous gxserver
         * projection instead of rebuilding custom launcher/action rows from
         * raw project metadata in the renderer.
         */
      });
  }

  private publishHudPatch(): void {
    this.latestHud = createGpuiSidebarHudState({
      activeProjectId: this.activeProjectId,
      commandPaneSessions: this.commandPaneSessions,
      focusedSessionId: this.focusedSessionId,
      git: this.gitStateForHud(),
      groups: this.latestGroups,
      presentation: this.presentation,
      runtimeSettings: this.runtimeSettings,
      domainProjects: this.domainProjects,
      recentProjects: this.recentProjects,
      remoteRecentProjectsByMachineId: this.remoteRecentProjectsByMachineId,
      remotePresentationsByMachineId: this.remotePresentations,
      sidebarHud: this.sidebarHud,
    });
    if (!this.hasHydrated) {
      return;
    }
    this.messageSource.postMessage({
      hud: this.latestHud,
      revision: ++this.revision,
      type: "sidebarHudChanged",
    });
  }

  private postActiveProjectContext(attempt = 0): void {
    if (this.activeProjectContextRetryId !== undefined) {
      window.clearTimeout(this.activeProjectContextRetryId);
      this.activeProjectContextRetryId = undefined;
    }

    const postActiveProjectContext = window.ghostexGpui?.postActiveProjectContext;
    if (typeof postActiveProjectContext !== "function") {
      /*
      CDXC:GPUISidebarGxserverRuntime 2026-06-24-11:00:
      CEF may install the sidebar bridge after the React entrypoint starts. Retry only the bridge send and rebuild the active-project payload from the latest live groups at send time, so startup never replays a stale fixture/workspace payload.
      */
      if (attempt < GPUI_SIDEBAR_BOOTSTRAP_MAX_ATTEMPTS) {
        this.activeProjectContextRetryId = window.setTimeout(() => {
          this.postActiveProjectContext(attempt + 1);
        }, GPUI_SIDEBAR_BOOTSTRAP_RETRY_DELAY_MS);
      }
      return;
    }

    const payload = createGpuiSidebarActiveProjectContextPayloadFromGroups({
      groups: this.latestGroups,
      runtimeSettings: this.runtimeSettings,
    });
    postActiveProjectContext(JSON.stringify(payload));
  }

  private postGxserverPresentationFocusState(): void {
    const postFocusState = window.ghostexGpui?.postGxserverPresentationFocusState;
    if (typeof postFocusState !== "function") {
      return;
    }
    const payload = JSON.stringify({
      focusedSessionId: this.focusedSessionId,
      type: GPUI_SIDEBAR_GXSERVER_FOCUS_STATE_MESSAGE_TYPE,
      version: GPUI_SIDEBAR_GXSERVER_FOCUS_STATE_MESSAGE_VERSION,
      visibleSessionIds: [...this.visibleSessionIds],
    });
    try {
      postFocusState(payload);
    } catch {
      /*
      CDXC:GPUISidebarGxserverFocusState 2026-06-24-21:07:
      Focus-state publication is a sidebar-native synchronization hint for Rust bootstrap replay only. A missing or rejecting CEF bridge must not change gxserver data, create fallback focus ids, log renderer payloads, or block the visible SidebarApp state that React already owns.
      */
    }
  }

  private postGpuiStatusPetState(): void {
    const settings = createGpuiSidebarSettings(this.runtimeSettings);
    const candidates = createGpuiSessionStatusIndicatorCandidatesFromSidebarGroups(this.latestGroups);
    const statusPayload = createGpuiSessionStatusIndicatorsPayload(candidates, settings);
    const petPayload = createGpuiPetOverlayStatePayload(candidates, settings);
    /*
    CDXC:GPUIStatusPetOverlay 2026-06-26-04:38:
    GPUI status indicators and the pet overlay consume the same saved shared Settings object as SidebarApp hydrate. Publish only bounded counts, booleans, pet id, and sidebar-projected project/session ids/titles through fixed bridge functions.

    CDXC:GPUIStatusPetOverlay 2026-06-27-20:11:
    The standalone GPUI floating session indicator was removed. Keep posting
    status counts/projects for the menu bar and pet badge surfaces, but do not
    include floating visibility or floating size settings in the status payload.
    */
    try {
      window.ghostexGpui?.postSessionStatusIndicators?.(JSON.stringify(statusPayload));
      window.ghostexGpui?.postPetOverlayState?.(JSON.stringify(petPayload));
    } catch {
      /*
      CDXC:GPUIStatusPetOverlay 2026-06-26-04:38:
      The status/pet bridge is presentation-only. If CEF has not installed the fixed functions or rejects a payload, keep SidebarApp state authoritative and avoid fallback UI state, raw JSON logging, project/path/title side channels, or invented native indicators.
      */
    }
  }

  private createHydrateMessage(
    groups: SidebarSessionGroup[],
    hud: SidebarHudState,
  ): SidebarHydrateMessage {
    return {
      groups,
      hud,
      pinnedPrompts: [...this.appUserData.pinnedPrompts],
      previousSessions: [],
      revision: ++this.revision,
      scratchPadContent: this.appUserData.scratchPadContent,
      type: "hydrate",
    };
  }

  private createSidebarGroups(presentation: GxserverPresentationSnapshot): SidebarSessionGroup[] {
    this.refreshCloseAfterDoneTimers();
    const projectProjection = createGpuiPresentationProjectProjectionMetadata({
      domainProjects: this.domainProjects,
      presentation,
      recentProjects: this.recentProjects,
    });
    this.ensureActiveProject(presentation, projectProjection);
    const groups = createGxserverPresentationSidebarGroups({
      activeProjectId: this.activeProjectId,
      chatProjectIds: projectProjection.chatProjectIds,
      focusedSessionId: this.focusedSessionId,
      hiddenProjectIds: projectProjection.hiddenProjectIds,
      hiddenSessionKeys: this.localFirstHiddenPresentationSessionKeys,
      presentation,
      projectOverlays: projectProjection.projectOverlays,
      resolveAgentIcon: resolveGpuiSidebarAgentIcon,
      resolveCloseAfterDone: (projectId, sessionId) =>
        this.getCloseAfterDoneProjection(
          createGxserverPresentationProjectSessionId(projectId, sessionId),
        ),
      resolveSessionRoutingId: createGpuiSidebarSessionRoutingId,
      visibleSessionIds: this.visibleSessionIds,
    });

    if (!this.activeGroupId) {
      this.activeGroupId =
        groups.find((group) => group.isActive)?.groupId ??
        groups.find((group) => group.projectContext)?.groupId ??
        groups.find((group) => group.isChatCollection)?.groupId;
    }

    const localGroups = groups.map((group) => ({
      ...group,
      isActive: group.groupId === this.activeGroupId,
      sessions: group.sessions.map((session) => ({
        ...session,
        isFocused:
          group.groupId === this.activeGroupId &&
          this.focusedSessionId === parseGxserverPresentationProjectSessionId(session.sessionId)?.sessionId,
        isVisible:
          group.groupId === this.activeGroupId &&
          (
            this.visibleSessionIds.has(
              parseGxserverPresentationProjectSessionId(session.sessionId)?.sessionId ?? session.sessionId,
            ) ||
            session.isVisible
          ),
      })),
    }));
    return [...localGroups, ...this.createRemoteSidebarGroups()];
  }

  private createRemoteSidebarGroups(): SidebarSessionGroup[] {
    const settings = createGpuiSidebarSettings(this.runtimeSettings);
    return createGpuiRemotePresentationSidebarGroups({
      activeGroupId: this.activeGroupId,
      focusedSessionId: this.focusedSessionId,
      presentationsByMachineId: this.remotePresentations,
      remoteRecentProjectsByMachineId: this.remoteRecentProjectsByMachineId,
      resolveAgentIcon: resolveGpuiSidebarAgentIcon,
      resolveCloseAfterDone: (machineId, projectId, sessionId) =>
        this.getCloseAfterDoneProjection(
          createGpuiRemotePresentationSessionId(machineId, projectId, sessionId),
        ),
      settings,
      visibleSessionIds: this.visibleSessionIds,
    });
  }

  private ensureActiveProject(
    presentation: GxserverPresentationSnapshot,
    projectProjection: GpuiPresentationProjectProjectionMetadata,
  ): void {
    const projectIds = new Set(presentation.projects.map((project) => project.projectId));
    if (this.focusedSessionId) {
      /*
      CDXC:GPUIWorkspaceSessionFocus 2026-06-27-13:22:
      Re-clicking a local session in the GPUI sidebar must keep behaving like the macOS app: the focused terminal owns the active project. Bootstrap can replay a stale initial project beside the current focused session, so resolve the session from the fresh presentation snapshot before rendering groups.
      */
      const focusedProjectId = presentation.sessions.find(
        (session) => session.sessionId === this.focusedSessionId,
      )?.projectId;
      if (
        focusedProjectId &&
        projectIds.has(focusedProjectId) &&
        !projectProjection.hiddenProjectIds.has(focusedProjectId)
      ) {
        const focusedGroupId = projectProjection.chatProjectIds.has(focusedProjectId)
          ? GPUI_GXSERVER_CHATS_GROUP_ID
          : createGxserverPresentationProjectGroupId(focusedProjectId);
        if (this.activeProjectId !== focusedProjectId || this.activeGroupId !== focusedGroupId) {
          this.activeProjectId = focusedProjectId;
          this.activeGroupId = focusedGroupId;
          this.refreshSidebarHudFromClient();
        }
        return;
      }
    }
    if (
      this.activeProjectId &&
      projectIds.has(this.activeProjectId) &&
      !projectProjection.hiddenProjectIds.has(this.activeProjectId)
    ) {
      if (projectProjection.chatProjectIds.has(this.activeProjectId)) {
        if (this.activeGroupId !== GPUI_GXSERVER_CHATS_GROUP_ID) {
          this.activeGroupId = GPUI_GXSERVER_CHATS_GROUP_ID;
          this.refreshSidebarHudFromClient();
        }
        return;
      }
      return;
    }
    const firstProject = presentation.projects.find(
      (project) =>
        !projectProjection.hiddenProjectIds.has(project.projectId) &&
        !projectProjection.chatProjectIds.has(project.projectId),
    );
    if (firstProject) {
      this.focusProjectId(firstProject.projectId);
      return;
    }
    this.activeProjectId = undefined;
    this.activeGroupId = GPUI_GXSERVER_CHATS_GROUP_ID;
    this.refreshSidebarHudFromClient();
  }

  private async handleSidebarMessage(message: SidebarToExtensionMessage): Promise<void> {
    switch (message.type) {
      case "focusGroup":
        this.focusGroup(message.groupId, message);
        return;
      case "focusSession":
        await this.focusSession(message.sessionId, message);
        return;
      case "focusSessionMode":
        if (parseGpuiRemotePresentationSessionId(message.sessionId)) {
          await this.focusSession(message.sessionId, message);
          return;
        }
        this.handleUnsupportedSidebarMessage(message);
        return;
      case "createSession":
        await this.createSession();
        return;
      case "createSessionInGroup":
        await this.createSession(message.groupId);
        return;
      case "runSidebarAgent":
        await this.createAgentSession(message.agentId, message.groupId);
        return;
      case "runSidebarCommand": {
        /*
        CDXC:GPUICommandPane 2026-06-26-05:22:
        Runtime command-pane messages can arrive from untyped CEF/renderer boundaries. Reject missing, non-string, or blank command ids before Action lookup so unsafe extra launch fields cannot make the selector path throw or reach the fixed command-action bridge.
        */
        const commandId = normalizeNonEmptyString(message.commandId);
        if (!commandId) {
          this.handleUnsupportedSidebarMessage(message);
          return;
        }
        this.runSidebarCommand(commandId, message);
        return;
      }
      case "runGhostexHotkeyAction": {
        this.postGhostexHotkeyAction(message);
        return;
      }
      case "endSidebarCommandRun": {
        /*
        CDXC:GPUICommandPane 2026-06-26-05:22:
        Closing a command-pane Action run is command-id-only. Validate the selector at the runtime boundary so malformed renderer messages with command text, URLs, paths, cwd/env, logs, or output are unsupported no-ops instead of crashing before the run-end bridge can decline them.
        */
        const commandId = normalizeNonEmptyString(message.commandId);
        if (!commandId) {
          this.handleUnsupportedSidebarMessage(message);
          return;
        }
        this.endSidebarCommandRun(commandId, message);
        return;
      }
      case "setSessionSleeping":
        await this.setSessionSleeping(message.sessionId, message.sleeping);
        return;
      case "setSessionsSleeping":
        await this.setSessionsSleeping(message.sessionIds, message.sleeping);
        return;
      case "setGroupSleeping":
        await this.setGroupSleeping(message.groupId, message.sleeping);
        return;
      case "closeSession":
        await this.transitionSession(message.sessionId, "close");
        return;
      case "closeSessions":
        await Promise.all(message.sessionIds.map((sessionId) =>
          this.transitionSession(sessionId, "close"),
        ));
        return;
      case "copySessionDetails":
        this.copySessionDetails(message);
        return;
      case "toggleCloseAfterDone":
        this.toggleCloseAfterDone(message.sessionId);
        return;
      case "closeInactiveProjectSessions":
        await this.closeInactiveProjectSessions(message.groupId);
        return;
      case "sleepInactiveProjectSessions":
        await this.sleepInactiveProjectSessions(message.groupId);
        return;
      case "wakeProjectSleepingSessions":
        await this.wakeProjectSleepingSessions(message.groupId);
        return;
      case "forkSession":
        await this.forkSession(message.sessionId);
        return;
      case "renameSession":
        await this.renameSession(message);
        return;
      case "setSessionFavorite":
        await this.updateSessionFlags(message.sessionId, {
          isFavorite: message.favorite,
          sessionTag: message.favorite ? "favorite" : null,
        });
        return;
      case "setSessionTag":
        await this.updateSessionFlags(message.sessionId, {
          isFavorite: message.sessionTag === "favorite",
          sessionTag: message.sessionTag ?? null,
        });
        return;
      case "setSessionPinned":
        await this.updateSessionFlags(message.sessionId, {
          isPinned: message.pinned,
        });
        return;
      case "syncSessionOrder":
        await this.syncSessionOrder(message.groupId, message.sessionIds);
        return;
      case "requestPreviousSessions":
        await this.requestPreviousSessions(message);
        return;
      case "searchPreviousSessionsByText":
        await this.searchPreviousSessionsByText();
        return;
      case "restorePreviousSession":
        await this.restorePreviousSession(message.historyId);
        return;
      case "deletePreviousSession":
        await this.deletePreviousSession(message.historyId);
        return;
      case "copyAttachCommand": {
        const remoteSession = parseGpuiRemotePresentationSessionId(message.sessionId);
        if (remoteSession) {
          this.postRemoteSessionNativeAction("copyRemoteAttachCommand", remoteSession, message);
          return;
        }
        this.handleUnsupportedSidebarMessage(message);
        return;
      }
      case "copyResumeCommand": {
        const remoteSession = parseGpuiRemotePresentationSessionId(message.sessionId);
        if (remoteSession) {
          this.postRemoteSessionNativeAction("copyRemoteResumeCommand", remoteSession, message);
          return;
        }
        this.handleUnsupportedSidebarMessage(message);
        return;
      }
      case "requestProjectWorktrees":
        await this.requestProjectWorktrees(message);
        return;
      case "saveScratchPad":
        await this.saveScratchPad(message.content);
        return;
      case "savePinnedPrompt":
        await this.savePinnedPrompt(message);
        return;
      case "createProjectWorktree":
        await this.createProjectWorktree(message);
        return;
      case "openSettings":
        this.openAppModal("settings");
        return;
      case "openWorkspaceWelcome":
        this.openAppModal("firstLaunchSetup");
        return;
      case "openHighlightedFeatures":
      case "openGhostexTutorialVideo":
        this.openAppModal("watchGhostexVideo");
        return;
      case "reconnectRemoteMachine":
        this.reconnectRemoteMachine(message.remoteMachineId, message.installApproved === true);
        return;
      case "openRemoteCloneRepository":
        this.openRemoteCloneRepository(message.remoteMachineId);
        return;
      case "pickWorkspaceFolder":
        this.pickWorkspaceFolder(message);
        return;
      case "removeProject":
        await this.removeProject(message.projectId);
        return;
      case "restoreRecentProject":
        await this.restoreRecentProject(message.projectId);
        return;
      case "removeRecentProject":
        await this.removeRecentProject(message.projectId);
        return;
      case "copyRecentProjectPath":
        {
          const remoteProject = parseGpuiRemotePresentationProjectId(message.projectId);
          if (remoteProject) {
            this.postRemoteProjectNativeAction("copyRemoteProjectPath", remoteProject, message);
            return;
          }
        }
        this.postNativeProjectPathAction("copyRecentProjectPath", message.projectId, message);
        return;
      case "openRecentProjectInFinder":
        {
          const remoteProject = parseGpuiRemotePresentationProjectId(message.projectId);
          if (remoteProject) {
            this.postRemoteProjectNativeAction(
              "copyRemoteProjectOpenFolderCommand",
              remoteProject,
              message,
            );
            return;
          }
        }
        this.postNativeProjectPathAction("openRecentProjectInFinder", message.projectId, message);
        return;
      case "closeWorkspaceProjectForGroup":
        await this.closeProjectForGroup(message.groupId);
        return;
      case "copyWorkspaceProjectPathForGroup":
        this.postProjectPathActionForGroup(
          "copyWorkspaceProjectPath",
          message.groupId,
          message,
        );
        return;
      case "openWorkspaceProjectInFinderForGroup":
        this.postProjectPathActionForGroup(
          "openWorkspaceProjectInFinder",
          message.groupId,
          message,
        );
        return;
      case "openWorkspaceProjectInIdeForGroup":
        this.postProjectPathActionForGroup(
          "openWorkspaceProjectInIde",
          message.groupId,
          message,
        );
        return;
      case "openActiveWorkspaceProjectInFinder":
        this.postActiveProjectPathAction("openActiveWorkspaceProjectInFinder", message);
        return;
      case "openActiveWorkspaceProjectInIde":
        if (message.targetApp !== "vscode" && message.targetApp !== "zed") {
          this.handleUnsupportedSidebarMessage(message);
          return;
        }
        this.postActiveProjectPathAction(
          message.targetApp === "vscode"
            ? "openActiveWorkspaceProjectInVscode"
            : "openActiveWorkspaceProjectInZed",
          message,
        );
        return;
      case "removeWorkspaceProjectForGroup":
        await this.removeProjectForGroup(message.groupId);
        return;
      case "setProjectWorktreeCommand":
        await this.updateProjectWorktreeCommand(message.projectId, message.command);
        return;
      case "setProjectBeadsDisplayKey":
        await this.updateProjectBeadsDisplayKey(message.projectId, message.displayKey);
        return;
      case "setProjectBeadsDirectory":
        await this.updateProjectBeadsDirectory(message.projectId, message.directory);
        return;
      case "refreshGitState":
        await this.refreshGitStateForMessage(message);
        return;
      case "setSidebarGitPrimaryAction":
        await this.persistGitPreferences({ primaryAction: message.action }, message);
        return;
      case "setSidebarGitCommitConfirmationEnabled":
        await this.persistGitPreferences({ confirmCommit: message.enabled }, message);
        return;
      case "setSidebarGitGenerateCommitBodyEnabled":
        await this.persistGitPreferences({ generateCommitBody: message.enabled }, message);
        return;
      case "runSidebarGitAction":
        await this.runSidebarGitAction(message);
        return;
      case "confirmSidebarGitCommit":
        await this.confirmSidebarGitCommit(message);
        return;
      case "cancelSidebarGitCommit":
        this.pendingGitCommitRequests.delete(message.requestId);
        this.publishHudPatch();
        return;
      case "runSidebarGitMultipleCommits":
        await this.runSidebarGitMultipleCommits(message.requestId, message.agentId);
        return;
      case "confirmSidebarGitDirectMerge":
        await this.confirmSidebarGitDirectMerge(message);
        return;
      case "commitWorktreeBeforeDelete":
        await this.runSidebarGitAction({
          action: "commit",
          groupId: message.groupId,
          type: "runSidebarGitAction",
        });
        return;
      case "openSidebarGitChangedFileDiff":
        await this.openSidebarGitChangedFileDiff(message.filePath, message.requestId);
        return;
      case "openSidebarGitChangedFile":
        await this.openSidebarGitChangedFileInIde(message);
        return;
      case "saveSidebarAgent":
        await this.saveSidebarAgent(message);
        return;
      case "deleteSidebarAgent":
        await this.deleteSidebarAgent(message.agentId);
        return;
      case "syncSidebarAgentOrder":
        await this.syncSidebarAgentOrder(message.requestId, message.agentIds);
        return;
      case "saveSidebarCommand":
        await this.saveSidebarCommand(message);
        return;
      case "deleteSidebarCommand":
        await this.deleteSidebarCommand(message.commandId);
        return;
      case "syncSidebarCommandOrder":
        await this.syncSidebarCommandOrder(message.requestId, message.commandIds);
        return;
      default:
        this.handleUnsupportedSidebarMessage(message);
        return;
    }
  }

  private focusGroup(groupId: string, originalMessage: SidebarToExtensionMessage): void {
    const remoteGroup = parseGpuiRemotePresentationGroupId(groupId);
    if (remoteGroup) {
      const target = this.selectRemoteGroupAttachTarget(remoteGroup);
      if (!target) {
        this.postRemoteToast("info", "Remote attach unavailable", {
          description: "This remote project has no attachable sessions.",
        });
        return;
      }
      if (this.postRemoteSessionNativeAction("openRemoteSessionTerminal", target, originalMessage)) {
        this.setRemotePresentationSessionFocus(target);
        this.publishRemotePresentationPatch();
      }
      return;
    }
    const projectId = parseGxserverPresentationProjectGroupId(groupId);
    if (projectId) {
      this.focusProjectId(projectId);
    } else {
      this.activeGroupId = groupId;
      this.refreshSidebarHudFromClient();
    }
    this.publishPresentation("patch");
  }

  private async focusSession(
    sessionId: string,
    originalMessage?: SidebarToExtensionMessage,
  ): Promise<void> {
    const remoteSession = parseGpuiRemotePresentationSessionId(sessionId);
    if (remoteSession) {
      if (this.postRemoteSessionNativeAction(
        "openRemoteSessionTerminal",
        remoteSession,
        originalMessage ?? { sessionId, type: "focusSession" },
      )) {
        this.setRemotePresentationSessionFocus(remoteSession);
        this.publishRemotePresentationPatch();
      }
      return;
    }
    const reference = parseGxserverPresentationProjectSessionId(sessionId);
    if (!reference || !this.client) {
      return;
    }
    if (this.isSleepingLocalPresentationSession(reference.projectId, reference.sessionId)) {
      /*
      CDXC:GPUIWorkspaceSessionFocus 2026-06-26-23:24:
      Sleeping local session-card clicks must match macOS session activation by committing gxserver `/api/wakeSession` before the Rust workspace materializes the terminal. A plain focus bridge can select the tab but leaves gxserver sleeping, so route this branch through the same Wake path as the sidebar sleep toggle.
      */
      await this.setSessionSleeping(sessionId, false);
      return;
    }
    /*
    CDXC:GPUISidebarSessionFocus 2026-06-26-04:42:
    Local GPUI sidebar clicks must match the macOS sidebar ownership model: the SidebarApp adapter applies local focus immediately and publishes the CEF bootstrap focus hint, but it must not call gxserver `/api/focusSession`. That endpoint is an external renderer-command route and can bounce focus when another renderer is the first open gxserver subscriber.
    */
    if (this.isLocalPresentationT3Session(reference.projectId, reference.sessionId)) {
      this.focusLocalT3Session(reference.projectId, reference.sessionId);
    } else {
      this.focusLocalWorkspaceSession(reference.projectId, reference.sessionId);
    }
    this.publishPresentation("patch");
  }

  private focusLocalT3Session(projectId: string, sessionId: string): void {
    /*
    CDXC:GPUIT3SessionFocus 2026-06-28-22:27:
    GPUI T3 Code session-card clicks must activate T3 through a dedicated id-only bridge, not the terminal attach bridge. T3 rows already carry durable gxserver runtime metadata, so Rust owns route resolution and the renderer may send only bounded project/session ids.
    */
    const normalizedProjectId = normalizeNonEmptyString(projectId);
    const normalizedSessionId = normalizeNonEmptyString(sessionId);
    if (!normalizedProjectId || !normalizedSessionId) {
      return;
    }
    this.setLocalPresentationSessionFocus(normalizedProjectId, normalizedSessionId);
    this.postLocalT3SessionFocus(normalizedProjectId, normalizedSessionId);
  }

  private focusLocalWorkspaceSession(projectId: string, sessionId: string): void {
    /*
    CDXC:GPUIWorkspaceSessionFocus 2026-06-26-06:18:
    Any successful local GPUI activation that makes a gxserver workspace session current must update both the reused SidebarApp presentation focus and the real GPUI Agents workspace. This matches macOS create, fork, restore, App Shot, and session-click behavior instead of requiring a second sidebar click to show the newly focused terminal.
    */
    const normalizedProjectId = normalizeNonEmptyString(projectId);
    const normalizedSessionId = normalizeNonEmptyString(sessionId);
    if (!normalizedProjectId || !normalizedSessionId) {
      return;
    }
    this.setLocalPresentationSessionFocus(normalizedProjectId, normalizedSessionId);
    this.postLocalWorkspaceTerminalFocus(normalizedProjectId, normalizedSessionId);
  }

  private postLocalWorkspaceTerminalFocus(projectId: string, sessionId: string): void {
    /*
    CDXC:GPUIWorkspaceSessionFocus 2026-06-26-06:08:
    Local GPUI session-card clicks must drive the real Agents workspace the way macOS does: after React updates gxserver presentation focus, send only bounded project/session ids to Rust so Rust can select or materialize the corresponding terminal tab from gxserver attach metadata. Do not pass labels, titles, commands, paths, terminal content, or daemon responses through the renderer bridge.
    */
    const postFocus = window.ghostexGpui?.postWorkspaceTerminalFocus;
    if (typeof postFocus !== "function") {
      return;
    }
    const payload = JSON.stringify({
      projectId,
      sessionId,
      type: GPUI_SIDEBAR_WORKSPACE_TERMINAL_FOCUS_MESSAGE_TYPE,
      version: GPUI_SIDEBAR_WORKSPACE_TERMINAL_FOCUS_MESSAGE_VERSION,
    });
    postFocus(payload);
  }

  private postLocalT3SessionFocus(projectId: string, sessionId: string): void {
    const postFocus = window.ghostexGpui?.postT3SessionFocus;
    if (typeof postFocus !== "function") {
      return;
    }
    const payload = JSON.stringify({
      projectId,
      sessionId,
      type: GPUI_SIDEBAR_T3_SESSION_FOCUS_MESSAGE_TYPE,
      version: GPUI_SIDEBAR_T3_SESSION_FOCUS_MESSAGE_VERSION,
    });
    postFocus(payload);
  }

  private postLocalT3SessionCreate(projectId: string): void {
    /*
    CDXC:GPUIT3SessionCreate 2026-06-29-01:22:
    The sidebar project-header T3 Code create button must start a project-scoped T3 draft chat, not the generic `npx --yes t3` agent launcher. Send only the gxserver project id to Rust so the native side can create the `kind: "t3"` row, resolve T3 owner-only project metadata, and open the draft composer without renderer-owned URLs, paths, commands, tokens, or daemon responses.
    */
    const postCreate = window.ghostexGpui?.postT3SessionCreate;
    if (typeof postCreate !== "function") {
      return;
    }
    const payload = JSON.stringify({
      projectId,
      type: GPUI_SIDEBAR_T3_SESSION_CREATE_MESSAGE_TYPE,
      version: GPUI_SIDEBAR_T3_SESSION_CREATE_MESSAGE_VERSION,
    });
    postCreate(payload);
  }

  private async createSession(groupId = this.activeGroupId): Promise<void> {
    const remoteGroup = groupId ? parseGpuiRemotePresentationGroupId(groupId) : undefined;
    if (remoteGroup) {
      await this.requestRemoteGxserver<GpuiGxserverCreatedSessionResult>(
        remoteGroup.machineId,
        "/api/createSession",
        {
          kind: "terminal",
          lifecycleState: "running",
          projectId: remoteGroup.projectId,
          surface: "workspace",
          title: DEFAULT_TERMINAL_SESSION_TITLE,
        },
      ).then((response) => {
        const createdSessionId = normalizeNonEmptyString(response.session?.sessionId);
        if (createdSessionId) {
          this.setRemotePresentationSessionFocus({
            machineId: remoteGroup.machineId,
            projectId: normalizeNonEmptyString(response.session?.projectId) ?? remoteGroup.projectId,
            sessionId: createdSessionId,
          });
        }
        this.refreshRemotePresentationFromGxserver(remoteGroup.machineId).catch(() => undefined);
      }).catch(() => {
        this.postRemoteToast("warning", "Remote session failed", {
          description: "The remote gxserver could not create that session.",
        });
      });
      return;
    }
    const projectId = groupId ? parseGxserverPresentationProjectGroupId(groupId) : this.activeProjectId;
    if (!this.client) {
      return;
    }
    const response = await this.client.rpc<GpuiGxserverCreatedSessionResult>("/api/createSession", {
      ...(projectId ? { projectId } : {}),
      kind: "terminal",
      surface: "workspace",
    });
    const createdProjectId = normalizeNonEmptyString(response.session?.projectId) ?? projectId;
    const createdSessionId = normalizeNonEmptyString(response.session?.sessionId);
    if (createdProjectId && createdSessionId) {
      this.focusLocalWorkspaceSession(createdProjectId, createdSessionId);
    }
  }

  private async createAgentSession(agentId: string, groupId = this.activeGroupId): Promise<void> {
    const remoteGroup = groupId ? parseGpuiRemotePresentationGroupId(groupId) : undefined;
    if (remoteGroup) {
      const normalizedAgentId = agentId.trim();
      if (!normalizedAgentId) {
        this.postRemoteToast("warning", "Remote agent unavailable", {
          description: "Choose a configured agent for this remote project.",
        });
        return;
      }
      /*
      CDXC:GPUIRemoteSessions 2026-06-24-17:19:
      Remote agent launches must let the owning remote gxserver resolve default and project-custom agent commands from remote project metadata. GPUI sends only the selected agent id, project id, surface, and a require-command guard through Rust's authenticated tunnel, never a renderer-provided command string.
      */
      const response = await this.requestRemoteGxserver<GpuiGxserverCreatedSessionResult>(remoteGroup.machineId, "/api/createAgentSession", {
        agentId: normalizedAgentId,
        projectId: remoteGroup.projectId,
        requireLaunchCommand: true,
        surface: "workspace",
      }).catch(() => {
        this.postRemoteToast("warning", "Remote agent failed", {
          description: "The remote gxserver could not create that agent session.",
        });
        return undefined;
      });
      if (response) {
        const createdSessionId = normalizeNonEmptyString(response.session?.sessionId);
        if (createdSessionId) {
          this.setRemotePresentationSessionFocus({
            machineId: remoteGroup.machineId,
            projectId: normalizeNonEmptyString(response.session?.projectId) ?? remoteGroup.projectId,
            sessionId: createdSessionId,
          });
        }
        this.refreshRemotePresentationFromGxserver(remoteGroup.machineId).catch(() => undefined);
      }
      return;
    }
    const projectId = groupId ? parseGxserverPresentationProjectGroupId(groupId) : this.activeProjectId;
    const agent = this.resolveSidebarAgent(agentId);
    if (!this.client || !projectId || !agent) {
      return;
    }
    if (agent.agentId === "t3") {
      this.postLocalT3SessionCreate(projectId);
      return;
    }
    if (!agent.command) {
      return;
    }
    const response = await this.client.rpc<GpuiGxserverCreatedSessionResult>("/api/createAgentSession", {
      agentId: agent.agentId,
      launchSettings: {
        agentCommand: agent.command,
        icon: agent.icon,
      },
      projectId,
      surface: "workspace",
      title: createAgentSessionDefaultTitle(agent.name),
    });
    const createdSessionId = normalizeNonEmptyString(response.session?.sessionId);
    if (createdSessionId) {
      this.focusLocalWorkspaceSession(
        normalizeNonEmptyString(response.session?.projectId) ?? projectId,
        createdSessionId,
      );
    }
  }

  private async searchPreviousSessionsByText(): Promise<void> {
    const projectId = this.activeProjectId;
    if (!this.client || !projectId) {
      this.postSidebarActionToast("info", "Search by Text needs an active project.");
      return;
    }
    const response = await this.client
      .rpc<GpuiGxserverCreatedSessionResult>("/api/createAgentSession", {
        agentId: "search-by-text",
        launchSettings: {
          agentCommand: "gx f",
        },
        projectId,
        surface: "workspace",
        title: "Search by Text",
      })
      .catch(() => undefined);
    if (!response) {
      this.postSidebarActionToast("error", "Search by Text failed", {
        description: "gxserver could not create the search terminal.",
      });
      return;
    }
    const createdSessionId = normalizeNonEmptyString(response.session?.sessionId);
    if (createdSessionId) {
      this.focusLocalWorkspaceSession(
        normalizeNonEmptyString(response.session?.projectId) ?? projectId,
        createdSessionId,
      );
    }
  }

  private async setGroupSleeping(groupId: string, sleeping: boolean): Promise<void> {
    const remoteGroup = parseGpuiRemotePresentationGroupId(groupId);
    if (remoteGroup) {
      const presentation = this.remotePresentations.get(remoteGroup.machineId);
      const sessionIds = (presentation?.sessions ?? [])
        .filter((session) => session.projectId === remoteGroup.projectId)
        .map((session) =>
          createGpuiRemotePresentationSessionId(
            remoteGroup.machineId,
            remoteGroup.projectId,
            session.sessionId,
          ),
        );
      /*
      CDXC:GPUISidebarBulkSleep 2026-06-27-02:05:
      Group sleep shares the same native-parity pacing as explicit multi-select sleep, while Wake remains concurrent because restoring sessions does not need terminal teardown throttling.
      */
      await this.setSessionsSleeping(sessionIds, sleeping);
      return;
    }
    const projectId = parseGxserverPresentationProjectGroupId(groupId);
    if (!projectId || !this.presentation) {
      return;
    }
    const sessionIds = this.presentation.sessions
      .filter((session) => session.projectId === projectId)
      .map((session) => createGxserverPresentationProjectSessionId(projectId, session.sessionId));
    /*
    CDXC:GPUISidebarBulkSleep 2026-06-27-02:05:
    Local project group sleep uses the shared private-data-free pacing helper through setSessionsSleeping, preserving the existing per-session focus replacement behavior inside setSessionSleeping.
    */
    await this.setSessionsSleeping(sessionIds, sleeping);
  }

  private async setSessionsSleeping(
    sessionIds: readonly string[],
    sleeping: boolean,
  ): Promise<void> {
    if (!sleeping) {
      await Promise.all(sessionIds.map((sessionId) => this.setSessionSleeping(sessionId, false)));
      return;
    }
    /*
    CDXC:GPUISidebarBulkSleep 2026-06-27-02:05:
    GPUI sleep bulk actions must mirror native pacing by starting one sleep request at a time with a 350 ms interval. Use the shared aggregate-count helper so per-operation failures continue without exposing ids, titles, paths, commands, URLs, or user text.
    */
    await runGpuiSidebarBulkSleepPaced(sessionIds, async (sessionId) => {
      await this.setSessionSleeping(sessionId, true);
    });
  }

  private async setSessionSleeping(sessionId: string, sleeping: boolean): Promise<void> {
    const remoteSession = parseGpuiRemotePresentationSessionId(sessionId);
    if (remoteSession) {
      this.postRemoteGxserverSidebarRequest(
        remoteSession.machineId,
        sleeping ? "/api/sleepSession" : "/api/wakeSession",
        {
          projectId: remoteSession.projectId,
          reason: "gpui-sidebar",
          sessionId: remoteSession.sessionId,
        },
      );
      return;
    }
    const reference = parseGxserverPresentationProjectSessionId(sessionId);
    if (!reference || !this.client) {
      return;
    }
    const replacementFocusSessionId = sleeping
      ? this.resolveLocalProjectListTransitionFocusTarget(reference.projectId, reference.sessionId)
      : undefined;
    await this.client.rpc(sleeping ? "/api/sleepSession" : "/api/wakeSession", {
      projectId: reference.projectId,
      reason: "gpui-sidebar",
      sessionId: reference.sessionId,
    });
    if (sleeping) {
      this.patchPresentationSession(reference.projectId, reference.sessionId, {
        lifecycleState: "sleeping",
      });
      if (replacementFocusSessionId) {
        this.focusLocalWorkspaceSession(reference.projectId, replacementFocusSessionId);
        this.publishPresentation("patch");
      }
      return;
    }
    /*
    CDXC:GPUIWorkspaceSessionFocus 2026-06-26-06:34:
    A local sidebar Wake action is also a workspace activation in the macOS app: the row becomes running and the corresponding workspace terminal is selected/restored through the same focus path as a direct session click. GPUI must use the local focus bridge here, not gxserver `/api/focusSession`.
    */
    this.patchPresentationSession(reference.projectId, reference.sessionId, {
      lifecycleState: "running",
    });
    this.focusLocalWorkspaceSession(reference.projectId, reference.sessionId);
    this.publishPresentation("patch");
  }

  private async transitionSession(
    sessionId: string,
    action: "close" | "sleep",
  ): Promise<void> {
    const remoteSession = parseGpuiRemotePresentationSessionId(sessionId);
    if (remoteSession) {
      this.postRemoteGxserverSidebarRequest(
        remoteSession.machineId,
        action === "close" ? "/api/killSession" : "/api/sleepSession",
        {
          projectId: remoteSession.projectId,
          reason: "gpui-sidebar",
          sessionId: remoteSession.sessionId,
        },
      );
      return;
    }
    const reference = parseGxserverPresentationProjectSessionId(sessionId);
    if (!reference || !this.client) {
      return;
    }
    const replacementFocusSessionId = this.resolveLocalProjectListTransitionFocusTarget(
      reference.projectId,
      reference.sessionId,
    );
    if (action === "close") {
      this.removePresentationSession(reference.projectId, reference.sessionId);
      if (replacementFocusSessionId) {
        this.focusLocalWorkspaceSession(reference.projectId, replacementFocusSessionId);
        this.publishPresentation("patch");
      }
      await this.client.rpc<GxserverSessionTransitionResult>("/api/transitionSession", {
        action,
        projectId: reference.projectId,
        reason: "gpui-sidebar",
        sessionId: reference.sessionId,
      }).catch(() => undefined);
      return;
    }
    const result = await this.client.rpc<GxserverSessionTransitionResult>("/api/transitionSession", {
      action,
      projectId: reference.projectId,
      reason: "gpui-sidebar",
      sessionId: reference.sessionId,
    });
    if (!shouldApplyGpuiLocalWorkspaceTransition(result, action)) {
      return;
    }
    this.patchPresentationSession(reference.projectId, reference.sessionId, {
      lifecycleState: "sleeping",
    });
    if (replacementFocusSessionId) {
      this.focusLocalWorkspaceSession(reference.projectId, replacementFocusSessionId);
      this.publishPresentation("patch");
    }
  }

  private copySessionDetails(
    message: Extract<SidebarToExtensionMessage, { type: "copySessionDetails" }>,
  ): void {
    const detailsText = normalizeNonEmptyString(message.detailsText);
    if (!detailsText) {
      this.handleUnsupportedSidebarMessage(message);
      return;
    }
    try {
      postAppModalHostMessage(
        { detailsText, type: "copySessionDetails" },
        "GPUISidebarActions:copySessionDetails",
      );
    } catch {
      this.handleUnsupportedSidebarMessage(message);
    }
  }

  private async closeInactiveProjectSessions(groupId: string): Promise<void> {
    const sessionIds = this.collectInactiveProjectSessionIds(groupId);
    await Promise.all(sessionIds.map((sessionId) => this.transitionSession(sessionId, "close")));
  }

  private async sleepInactiveProjectSessions(groupId: string): Promise<void> {
    const sessionIds = this.collectInactiveProjectSessionIds(groupId);
    await this.setSessionsSleeping(sessionIds, true);
  }

  private collectInactiveProjectSessionIds(groupId: string): string[] {
    const remoteGroup = parseGpuiRemotePresentationGroupId(groupId);
    if (remoteGroup) {
      const presentation = this.remotePresentations.get(remoteGroup.machineId);
      return (presentation?.sessions ?? [])
        .filter((session) => session.projectId === remoteGroup.projectId)
        .filter(isGpuiInactiveProjectPresentationSession)
        .map((session) =>
          createGpuiRemotePresentationSessionId(
            remoteGroup.machineId,
            remoteGroup.projectId,
            session.sessionId,
          ),
        );
    }
    const projectId = parseGxserverPresentationProjectGroupId(groupId);
    if (!projectId || !this.presentation) {
      return [];
    }
    return this.presentation.sessions
      .filter((session) => session.projectId === projectId)
      .filter(isGpuiInactiveProjectPresentationSession)
      .map((session) => createGxserverPresentationProjectSessionId(projectId, session.sessionId));
  }

  private async wakeProjectSleepingSessions(groupId: string): Promise<void> {
    const remoteGroup = parseGpuiRemotePresentationGroupId(groupId);
    if (remoteGroup) {
      const presentation = this.remotePresentations.get(remoteGroup.machineId);
      const sessionIds = (presentation?.sessions ?? [])
        .filter(
          (session) =>
            session.projectId === remoteGroup.projectId &&
            session.lifecycleState === "sleeping",
        )
        .map((session) =>
          createGpuiRemotePresentationSessionId(
            remoteGroup.machineId,
            remoteGroup.projectId,
            session.sessionId,
          ),
        );
      await this.setSessionsSleeping(sessionIds, false);
      return;
    }
    const projectId = parseGxserverPresentationProjectGroupId(groupId);
    if (!projectId || !this.presentation) {
      return;
    }
    this.focusProjectId(projectId);
    const sessionIds = this.presentation.sessions
      .filter(
        (session) =>
          session.projectId === projectId && session.lifecycleState === "sleeping",
      )
      .map((session) => createGxserverPresentationProjectSessionId(projectId, session.sessionId));
    await this.setSessionsSleeping(sessionIds, false);
  }

  private toggleCloseAfterDone(sessionId: string): void {
    const session = this.findPresentationSessionRowForSidebarSessionId(sessionId);
    if (!session) {
      this.postSidebarActionToast(
        "info",
        "Close After Done is only available for terminal sessions.",
      );
      return;
    }
    if (this.closeAfterDoneTimersBySessionId.has(sessionId)) {
      this.clearCloseAfterDoneTimer(sessionId);
      this.publishPresentation("patch");
      this.postSidebarActionToast("info", "Close After Done canceled");
      return;
    }
    this.closeAfterDoneTimersBySessionId.set(sessionId, {});
    this.persistCloseAfterDoneSessionIds();
    this.refreshCloseAfterDoneTimer(sessionId, Date.now());
    this.publishPresentation("patch");
    this.postSidebarActionToast("info", "Close After Done enabled", {
      description: "Closes after Done stays visible for 3m.",
    });
  }

  private findPresentationSessionRowForSidebarSessionId(
    sessionId: string,
  ): GxserverPresentationSession | undefined {
    const remoteSession = parseGpuiRemotePresentationSessionId(sessionId);
    if (remoteSession) {
      return this.findRemotePresentationSession(remoteSession);
    }
    const reference = parseGxserverPresentationProjectSessionId(sessionId);
    if (!reference) {
      return undefined;
    }
    return this.presentation?.sessions.find(
      (session) =>
        session.projectId === reference.projectId && session.sessionId === reference.sessionId,
    );
  }

  private refreshCloseAfterDoneTimers(): void {
    const nowMs = Date.now();
    for (const sessionId of [...this.closeAfterDoneTimersBySessionId.keys()]) {
      this.refreshCloseAfterDoneTimer(sessionId, nowMs);
    }
  }

  private refreshCloseAfterDoneTimer(sessionId: string, nowMs: number): void {
    const timer = this.closeAfterDoneTimersBySessionId.get(sessionId);
    if (!timer) {
      return;
    }
    const remoteSession = parseGpuiRemotePresentationSessionId(sessionId);
    const snapshotAvailable = remoteSession
      ? this.remotePresentations.has(remoteSession.machineId)
      : this.presentation !== undefined;
    if (!snapshotAvailable) {
      this.resetCloseAfterDoneCountdown(sessionId, timer);
      return;
    }
    const session = this.findPresentationSessionRowForSidebarSessionId(sessionId);
    if (!session) {
      this.clearCloseAfterDoneTimer(sessionId);
      return;
    }
    if (!isGpuiCloseAfterDonePresentationSessionDone(session)) {
      this.resetCloseAfterDoneCountdown(sessionId, timer);
      return;
    }
    if (timer.deadlineAtMs !== undefined) {
      this.ensureCloseAfterDoneCountdownTicker();
      return;
    }
    const deadlineAtMs = nowMs + GPUI_CLOSE_AFTER_DONE_DELAY_MS;
    const timeoutId = window.setTimeout(() => {
      this.completeCloseAfterDoneTimer(sessionId, deadlineAtMs);
    }, GPUI_CLOSE_AFTER_DONE_DELAY_MS);
    this.closeAfterDoneTimersBySessionId.set(sessionId, {
      deadlineAtMs,
      doneSinceAtMs: nowMs,
      timeoutId,
    });
    this.ensureCloseAfterDoneCountdownTicker();
  }

  private resetCloseAfterDoneCountdown(sessionId: string, timer: GpuiCloseAfterDoneTimer): void {
    if (timer.timeoutId !== undefined) {
      window.clearTimeout(timer.timeoutId);
    }
    this.closeAfterDoneTimersBySessionId.set(sessionId, {});
    this.stopCloseAfterDoneCountdownTickerIfIdle();
  }

  private completeCloseAfterDoneTimer(sessionId: string, expectedDeadlineAtMs: number): void {
    const timer = this.closeAfterDoneTimersBySessionId.get(sessionId);
    if (!timer || timer.deadlineAtMs !== expectedDeadlineAtMs) {
      return;
    }
    const session = this.findPresentationSessionRowForSidebarSessionId(sessionId);
    if (!session || !isGpuiCloseAfterDonePresentationSessionDone(session)) {
      this.resetCloseAfterDoneCountdown(sessionId, timer);
      this.publishPresentation("patch");
      return;
    }
    this.clearCloseAfterDoneTimer(sessionId);
    void this.transitionSession(sessionId, "close");
  }

  private clearCloseAfterDoneTimer(sessionId: string): void {
    const timer = this.closeAfterDoneTimersBySessionId.get(sessionId);
    if (timer?.timeoutId !== undefined) {
      window.clearTimeout(timer.timeoutId);
    }
    this.closeAfterDoneTimersBySessionId.delete(sessionId);
    this.persistCloseAfterDoneSessionIds();
    this.stopCloseAfterDoneCountdownTickerIfIdle();
  }

  private persistCloseAfterDoneSessionIds(): void {
    writeStoredGpuiCloseAfterDoneSessionIds([...this.closeAfterDoneTimersBySessionId.keys()]);
  }

  private ensureCloseAfterDoneCountdownTicker(): void {
    if (this.closeAfterDoneCountdownTickerId !== undefined) {
      return;
    }
    this.closeAfterDoneCountdownTickerId = window.setInterval(() => {
      if (!this.hasActiveCloseAfterDoneCountdown()) {
        this.stopCloseAfterDoneCountdownTickerIfIdle();
        return;
      }
      this.publishPresentation("patch");
    }, 1_000);
  }

  private stopCloseAfterDoneCountdownTickerIfIdle(): void {
    if (
      this.hasActiveCloseAfterDoneCountdown() ||
      this.closeAfterDoneCountdownTickerId === undefined
    ) {
      return;
    }
    window.clearInterval(this.closeAfterDoneCountdownTickerId);
    this.closeAfterDoneCountdownTickerId = undefined;
  }

  private hasActiveCloseAfterDoneCountdown(): boolean {
    for (const timer of this.closeAfterDoneTimersBySessionId.values()) {
      if (timer.deadlineAtMs !== undefined) {
        return true;
      }
    }
    return false;
  }

  private getCloseAfterDoneProjection(
    sessionId: string,
  ): GxserverPresentationCloseAfterDoneProjection | undefined {
    const timer = this.closeAfterDoneTimersBySessionId.get(sessionId);
    if (!timer) {
      return undefined;
    }
    if (timer.deadlineAtMs === undefined) {
      return { armed: true };
    }
    const remainingMs = Math.max(0, timer.deadlineAtMs - Date.now());
    return {
      armed: true,
      deadlineAt: new Date(timer.deadlineAtMs).toISOString(),
      remainingLabel: formatGpuiCloseAfterDoneCountdown(remainingMs),
      remainingMs,
    };
  }

  private async transitionWorkspaceTerminalLifecycleClose(
    request: GpuiWorkspaceTerminalLifecycleRequest,
    fallbackReplacementSessionId: string | undefined,
  ): Promise<boolean> {
    /*
    CDXC:GPUIWorkspaceLifecycle 2026-06-26-23:59:
    Rust-origin mapped Agents close matches macOS local-first behavior: hide/remove the SidebarApp row and focus the Rust-provided or project-list replacement locally, then attempt gxserver `/api/transitionSession` best-effort. Provider transition failure must not keep a retryable Ghostty close-confirm prompt or block the native tab close.
    */
    this.removePresentationSession(request.projectId, request.sessionId);
    const replacementProjectId = request.replacementProjectId ?? request.projectId;
    const replacementSessionId = request.replacementSessionId ?? fallbackReplacementSessionId;
    if (replacementSessionId) {
      this.focusLocalWorkspaceSession(replacementProjectId, replacementSessionId);
      this.publishPresentation("patch");
    }
    await this.client.rpc<GxserverSessionTransitionResult>("/api/transitionSession", {
      action: request.action,
      projectId: request.projectId,
      reason: "closeTerminal",
      sessionId: request.sessionId,
    }).catch(() => undefined);
    return true;
  }

  private workspaceTerminalLifecycleResultBridgeReady(): boolean {
    return typeof window.ghostexGpui?.postWorkspaceTerminalLifecycleResult === "function";
  }

  private handleOrQueueWorkspaceTerminalLifecycleRequest(payload: unknown): void {
    const request = normalizeGpuiWorkspaceTerminalLifecycleRequest(payload);
    if (!request) {
      return;
    }
    if (!this.workspaceTerminalLifecycleResultBridgeReady()) {
      this.queuePendingWorkspaceTerminalLifecycleRequest(request);
      return;
    }
    void this.handleNormalizedWorkspaceTerminalLifecycleRequest(request);
  }

  private queuePendingWorkspaceTerminalLifecycleRequest(
    request: GpuiWorkspaceTerminalLifecycleRequest,
  ): void {
    const gpuiBridge = (window.ghostexGpui = window.ghostexGpui ?? {});
    const pending = Array.isArray(gpuiBridge.pendingWorkspaceTerminalLifecycleRequests)
      ? gpuiBridge.pendingWorkspaceTerminalLifecycleRequests
      : [];
    pending.push(request);
    gpuiBridge.pendingWorkspaceTerminalLifecycleRequests = pending;
    this.scheduleWorkspaceTerminalLifecycleBridgeRetry();
  }

  private scheduleWorkspaceTerminalLifecycleBridgeRetry(): void {
    if (this.workspaceTerminalLifecycleBridgeRetryId !== undefined) {
      return;
    }
    this.workspaceTerminalLifecycleBridgeRetryId = window.setTimeout(() => {
      this.workspaceTerminalLifecycleBridgeRetryId = undefined;
      this.drainPendingWorkspaceTerminalLifecycleRequests();
    }, GPUI_WORKSPACE_TERMINAL_LIFECYCLE_BRIDGE_RETRY_DELAY_MS);
  }

  private drainPendingWorkspaceTerminalLifecycleRequests(
    queuedRequests?: readonly unknown[],
  ): void {
    const gpuiBridge = (window.ghostexGpui = window.ghostexGpui ?? {});
    const pending = [
      ...(queuedRequests ?? []),
      ...(Array.isArray(gpuiBridge.pendingWorkspaceTerminalLifecycleRequests)
        ? gpuiBridge.pendingWorkspaceTerminalLifecycleRequests.splice(0)
        : []),
    ];
    if (pending.length === 0) {
      return;
    }
    if (!this.workspaceTerminalLifecycleResultBridgeReady()) {
      for (const payload of pending) {
        const request = normalizeQueuedGpuiWorkspaceTerminalLifecycleRequest(payload);
        if (request) {
          this.queuePendingWorkspaceTerminalLifecycleRequest(request);
        }
      }
      return;
    }
    for (const payload of pending) {
      const request = normalizeQueuedGpuiWorkspaceTerminalLifecycleRequest(payload);
      if (request) {
        void this.handleNormalizedWorkspaceTerminalLifecycleRequest(request);
      }
    }
  }

  private async handleNormalizedWorkspaceTerminalLifecycleRequest(
    request: GpuiWorkspaceTerminalLifecycleRequest,
  ): Promise<void> {
    let ok = false;
    try {
      ok = await this.applyWorkspaceTerminalLifecycleRequest(request);
    } catch {
      ok = false;
    }
    this.postWorkspaceTerminalLifecycleResult(request.requestId, ok);
  }

  private async applyWorkspaceTerminalLifecycleRequest(
    request: GpuiWorkspaceTerminalLifecycleRequest,
  ): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    if (request.action === "wake") {
      /*
      CDXC:GPUIWorkspaceLifecycle 2026-06-26-23:24:
      Rust-origin mapped sleeping placeholder activation must mirror macOS wake ownership: SidebarApp/gxserver commits `/api/wakeSession`, the sidebar marks the row running, and only the result ack lets Rust move the native tab into Mounting. Do not post WorkspaceTerminalFocus from this branch or the wake request would re-enter Rust before its pending lifecycle mutation applies.
      */
      await this.client.rpc("/api/wakeSession", {
        projectId: request.projectId,
        reason: "gpui-sidebar",
        sessionId: request.sessionId,
      });
      this.patchPresentationSession(request.projectId, request.sessionId, {
        lifecycleState: "running",
      });
      this.setLocalPresentationSessionFocus(request.projectId, request.sessionId);
      this.publishPresentation("patch");
      return true;
    }
    const fallbackReplacementSessionId =
      request.replacementSessionId === undefined && !request.skipReplacementFallback
        ? this.resolveLocalProjectListTransitionFocusTarget(request.projectId, request.sessionId)
        : undefined;
    if (request.action === "close") {
      return this.transitionWorkspaceTerminalLifecycleClose(request, fallbackReplacementSessionId);
    }
    const result = await this.client.rpc<GxserverSessionTransitionResult>("/api/transitionSession", {
      action: request.action,
      projectId: request.projectId,
      reason: "sleepSession",
      sessionId: request.sessionId,
    });
    if (!shouldApplyGpuiLocalWorkspaceTransition(result, request.action)) {
      return false;
    }
    this.patchPresentationSession(request.projectId, request.sessionId, {
      lifecycleState: "sleeping",
    });
    const replacementProjectId = request.replacementProjectId ?? request.projectId;
    const replacementSessionId = request.replacementSessionId ?? fallbackReplacementSessionId;
    if (replacementSessionId) {
      this.focusLocalWorkspaceSession(replacementProjectId, replacementSessionId);
      this.publishPresentation("patch");
    }
    return true;
  }

  private postWorkspaceTerminalLifecycleResult(requestId: number, ok: boolean): void {
    const postResult = window.ghostexGpui?.postWorkspaceTerminalLifecycleResult;
    if (typeof postResult !== "function") {
      return;
    }
    const payload = JSON.stringify({
      ok,
      requestId,
      type: GPUI_SIDEBAR_WORKSPACE_TERMINAL_LIFECYCLE_RESULT_MESSAGE_TYPE,
      version: GPUI_SIDEBAR_WORKSPACE_TERMINAL_LIFECYCLE_RESULT_MESSAGE_VERSION,
    });
    postResult(payload);
  }

  private resolveLocalProjectListTransitionFocusTarget(
    projectId: string,
    removedSessionId: string,
  ): string | undefined {
    /*
    CDXC:GPUIWorkspaceSessionFocus 2026-06-26-06:34:
    Sidebar-origin local close/sleep must follow the macOS project-list focus rule: background transitions do not steal focus, while closing or sleeping the focused session selects the next running row from the same displayed local project order and routes it through the workspace focus bridge.
    */
    const normalizedProjectId = normalizeNonEmptyString(projectId);
    const normalizedRemovedSessionId = normalizeNonEmptyString(removedSessionId);
    if (
      !normalizedProjectId ||
      !normalizedRemovedSessionId ||
      this.focusedSessionId !== normalizedRemovedSessionId
    ) {
      return undefined;
    }
    const orderedSessionIds = this.localProjectTransitionSessionIds(
      normalizedProjectId,
      normalizedRemovedSessionId,
    );
    const removedIndex = orderedSessionIds.indexOf(normalizedRemovedSessionId);
    const candidates = removedIndex >= 0
      ? [...orderedSessionIds.slice(removedIndex + 1), ...orderedSessionIds.slice(0, removedIndex)]
      : orderedSessionIds;
    const replacementSessionId = candidates.find((candidateSessionId) =>
      candidateSessionId !== normalizedRemovedSessionId &&
      this.isRunningLocalPresentationSession(normalizedProjectId, candidateSessionId),
    );
    return replacementSessionId;
  }

  private localProjectTransitionSessionIds(projectId: string, removedSessionId: string): string[] {
    const orderedSessionIds: string[] = [];
    const addSessionId = (sessionId: string | undefined): void => {
      const normalizedSessionId = normalizeNonEmptyString(sessionId);
      if (!normalizedSessionId || orderedSessionIds.includes(normalizedSessionId)) {
        return;
      }
      orderedSessionIds.push(normalizedSessionId);
    };
    for (const group of this.latestGroups) {
      for (const session of group.sessions) {
        if (parseGpuiRemotePresentationSessionId(session.sessionId)) {
          continue;
        }
        const reference = parseGxserverPresentationProjectSessionId(session.sessionId);
        if (reference?.projectId === projectId) {
          addSessionId(reference.sessionId);
        }
      }
    }
    for (const session of this.presentation?.sessions ?? []) {
      if (session.projectId === projectId) {
        addSessionId(session.sessionId);
      }
    }
    addSessionId(removedSessionId);
    return orderedSessionIds;
  }

  private isRunningLocalPresentationSession(projectId: string, sessionId: string): boolean {
    return this.presentation?.sessions.some((session) =>
      session.projectId === projectId &&
      session.sessionId === sessionId &&
      session.lifecycleState === "running",
    ) ?? false;
  }

  private isLocalPresentationT3Session(projectId: string, sessionId: string): boolean {
    return this.presentation?.sessions.some((session) =>
      session.projectId === projectId &&
      session.sessionId === sessionId &&
      session.kind === "t3",
    ) ?? false;
  }

  private isSleepingLocalPresentationSession(projectId: string, sessionId: string): boolean {
    const presentationSleeping = this.presentation?.sessions.some((session) =>
      session.projectId === projectId &&
      session.sessionId === sessionId &&
      session.lifecycleState === "sleeping",
    ) ?? false;
    if (presentationSleeping) {
      return true;
    }
    const sidebarSessionId = createGxserverPresentationProjectSessionId(projectId, sessionId);
    if (this.sleepingLocalSidebarSessionIds.has(sidebarSessionId)) {
      return true;
    }
    return this.latestGroups.some((group) =>
      group.sessions.some((session) =>
        session.sessionId === sidebarSessionId &&
        (session.lifecycleState === "sleeping" || session.isSleeping === true),
      ),
    );
  }

  private async forkSession(sessionId: string): Promise<void> {
    const remoteSession = parseGpuiRemotePresentationSessionId(sessionId);
    if (remoteSession) {
      if (!this.findRemotePresentationSession(remoteSession)) {
        this.postRemoteToast("warning", "Remote fork unavailable", {
          description: "Reconnect the remote machine before forking this session.",
        });
        return;
      }
      /*
      CDXC:GPUIRemoteSessions 2026-06-24-17:19:
      Remote fork authority comes only from a machine-prefixed session id already present in the remote presentation snapshot. Route the project/session ids to `/api/forkSession` on that machine; do not derive ids from labels or terminal text.
      */
      const response = await this.requestRemoteGxserver<GxserverForkSessionResult>(remoteSession.machineId, "/api/forkSession", {
        projectId: remoteSession.projectId,
        reason: "gpui-sidebar",
        sessionId: remoteSession.sessionId,
      }).catch(() => {
        this.postRemoteToast("warning", "Remote fork failed", {
          description: "The remote gxserver could not fork that session.",
        });
        return undefined;
      });
      if (response) {
        this.setRemotePresentationSessionFocus({
          machineId: remoteSession.machineId,
          projectId: response.session.projectId ?? remoteSession.projectId,
          sessionId: response.session.sessionId,
        });
        this.refreshRemotePresentationFromGxserver(remoteSession.machineId).catch(() => undefined);
      }
      return;
    }
    const reference = parseGxserverPresentationProjectSessionId(sessionId);
    if (!reference || !this.client) {
      return;
    }
    const response = await this.client.rpc<GxserverForkSessionResult>("/api/forkSession", {
      projectId: reference.projectId,
      reason: "gpui-sidebar",
      sessionId: reference.sessionId,
    });
    this.focusLocalWorkspaceSession(
      response.session.projectId ?? reference.projectId,
      response.session.sessionId,
    );
  }

  private async renameSession(
    message: Extract<SidebarToExtensionMessage, { type: "renameSession" }>,
  ): Promise<void> {
    const remoteSession = parseGpuiRemotePresentationSessionId(message.sessionId);
    if (remoteSession) {
      this.postRemoteGxserverSidebarRequest(remoteSession.machineId, "/api/updateSession", {
        projectId: remoteSession.projectId,
        sessionId: remoteSession.sessionId,
        title: message.title,
      });
      return;
    }
    const reference = parseGxserverPresentationProjectSessionId(message.sessionId);
    if (!reference || !this.client) {
      return;
    }
    await this.client.rpc("/api/requestSessionRename", {
      agentName: message.agentId,
      projectId: reference.projectId,
      reason: "gpui-sidebar",
      sessionId: reference.sessionId,
      title: message.title,
      titleSource: message.shouldGenerateTitle ? "generated" : "user",
    });
    this.patchPresentationSession(reference.projectId, reference.sessionId, {
      title: message.title,
    });
  }

  private async updateSessionFlags(
    sessionId: string,
    flags: { isFavorite?: boolean; isPinned?: boolean; sessionTag?: SidebarSessionTag | null },
  ): Promise<void> {
    const remoteSession = parseGpuiRemotePresentationSessionId(sessionId);
    if (remoteSession) {
      this.postRemoteGxserverSidebarRequest(remoteSession.machineId, "/api/updateSession", {
        ...flags,
        projectId: remoteSession.projectId,
        sessionId: remoteSession.sessionId,
      });
      return;
    }
    const reference = parseGxserverPresentationProjectSessionId(sessionId);
    if (!reference || !this.client) {
      return;
    }
    await this.client.rpc("/api/updateSession", {
      ...flags,
      projectId: reference.projectId,
      sessionId: reference.sessionId,
    });
    this.patchPresentationSession(reference.projectId, reference.sessionId, flags);
  }

  private async syncSessionOrder(groupId: string, sessionIds: readonly string[]): Promise<void> {
    const projectId = parseGxserverPresentationProjectGroupId(groupId);
    if (!projectId || !this.client || !this.presentation) {
      return;
    }
    const gxserverSessionIds = sessionIds.flatMap((sessionId) => {
      const reference = parseGxserverPresentationProjectSessionId(sessionId);
      return reference?.projectId === projectId ? [reference.sessionId] : [];
    });
    if (gxserverSessionIds.length === 0) {
      return;
    }
    this.presentation = reorderPresentationProjectSessions(
      this.presentation,
      projectId as GxserverProjectId,
      gxserverSessionIds as GxserverSessionId[],
    );
    this.publishPresentation("patch");
    await this.client.rpc("/api/updateSessionOrder", {
      projectId,
      sessionIds: gxserverSessionIds,
    });
  }

  private async requestPreviousSessions(
    message: Extract<SidebarToExtensionMessage, { type: "requestPreviousSessions" }>,
  ): Promise<void> {
    const limit = message.limit ?? 80;
    const sessionTags = message.sessionTags;
    const remoteMachines = this.connectedRemotePreviousSessionMachines();
    try {
      const [localResponse, ...remoteResponses] = await Promise.all([
        this.client
          ? this.client.rpc<GxserverPresentationSearchResponse>(
              "/api/listPreviousSessions",
              {
                includeActive: false,
                includePrevious: true,
                limit,
                query: message.query,
                sessionTags,
              },
            ).catch(() => ({ results: [] }))
          : Promise.resolve({ results: [] }),
        ...remoteMachines.map((machine) =>
          this.requestRemoteGxserver<GxserverPresentationSearchResponse>(
            machine.machineId,
            "/api/listPreviousSessions",
            {
              includeActive: false,
              includePrevious: true,
              limit,
              query: message.query,
              sessionTags,
            },
          ).catch(() => ({ results: [] })),
        ),
      ]);
      /*
      CDXC:GPUIRemotePreviousSessions 2026-06-24-17:19:
      Previous-session list/search combines local gxserver rows with connected remote gxserver rows, but remote history ids are machine-prefixed so restore/delete can route back through Rust's tunnel owner. Keep only the current result page in memory and do not persist remote metadata in GPUI.
      */
      const remoteItems = remoteResponses.flatMap((response, index) =>
        response.results.map((result) =>
          gxserverSearchResultToPreviousSessionItem(result, {
            historyIdPrefix: `remote-gxserver:${remoteMachines[index]?.machineId ?? ""}`,
            projectNamePrefix: remoteMachines[index]?.machineName,
          }),
        ),
      );
      this.postPreviousSessionsResult(
        message.requestId,
        message.query,
        [
          ...localResponse.results.map(gxserverSearchResultToPreviousSessionItem),
          ...remoteItems,
        ]
          .sort(comparePreviousSessionItemsByClosedTime)
          .slice(0, limit),
      );
    } catch {
      this.postPreviousSessionsResult(message.requestId, message.query, []);
    }
  }

  private async restorePreviousSession(historyId: string): Promise<void> {
    const remoteReference = parseGpuiRemotePreviousSessionHistoryId(historyId);
    if (remoteReference) {
      await this.restoreRemotePreviousSession(remoteReference, historyId);
      return;
    }
    const reference = parseGpuiGxserverPreviousSessionHistoryId(historyId);
    if (!reference || !this.client) {
      return;
    }
    const previousSession = this.previousSessionsByHistoryId.get(historyId);
    if (previousSession && previousSession.isRestorable !== true) {
      return;
    }
    try {
      const response = await this.client.rpc<GpuiGxserverCreatedSessionResult>("/api/createSession", {
        kind: "terminal",
        lifecycleState: "running",
        projectId: reference.projectId,
        restoredFromSessionId: reference.sessionId,
        ...(previousSession?.sessionTag ? { sessionTag: previousSession.sessionTag } : {}),
        ...(previousSession?.sidebarOrder !== undefined ? { sidebarOrder: previousSession.sidebarOrder } : {}),
        surface: "workspace",
        title: previousSessionTitle(previousSession),
      });
      const restoredSessionId = normalizeNonEmptyString(response.session?.sessionId);
      if (restoredSessionId) {
        this.focusLocalWorkspaceSession(
          normalizeNonEmptyString(response.session?.projectId) ?? reference.projectId,
          restoredSessionId,
        );
      }
      await this.client.rpc("/api/removeSession", {
        projectId: reference.projectId,
        reason: "restorePreviousSession",
        sessionId: reference.sessionId,
      }).catch(() => undefined);
      this.removePreviousSessionFromCurrentResult(historyId);
    } catch {
      this.postRemoteToast("warning", "Previous session restore failed", {
        description: "gxserver could not restore that previous session.",
      });
    }
  }

  private async restoreRemotePreviousSession(
    reference: { machineId: string; projectId: string; sessionId: string },
    historyId: string,
  ): Promise<void> {
    const previousSession = this.previousSessionsByHistoryId.get(historyId);
    if (previousSession && previousSession.isRestorable !== true) {
      return;
    }
    /*
    CDXC:GPUIRemotePreviousSessions 2026-06-24-17:19:
    Restoring remote history recreates a real workspace session on the owning remote gxserver and then removes the stopped history row from that same machine. GPUI does not create a local terminal, synthesize resume commands, or trust visible previous-session labels as operation ids.

    CDXC:GPUIRemoteAttach 2026-06-24-19:06:
    When remote previous-session restore returns a new gxserver session id, GPUI may immediately ask Rust to attach that exact restored id through the same native remote terminal action as a direct session click. If gxserver does not return the new id, the restore remains server-only instead of guessing from labels or the old history id.
    */
    try {
      const response = await this.requestRemoteGxserver<{
        session?: { projectId?: string; sessionId?: string };
      }>(reference.machineId, "/api/createSession", {
        kind: "terminal",
        lifecycleState: "running",
        projectId: reference.projectId,
        restoredFromSessionId: reference.sessionId,
        ...(previousSession?.sessionTag ? { sessionTag: previousSession.sessionTag } : {}),
        ...(previousSession?.sidebarOrder !== undefined ? { sidebarOrder: previousSession.sidebarOrder } : {}),
        surface: "workspace",
        title: previousSessionTitle(previousSession),
      });
      await this.requestRemoteGxserver(reference.machineId, "/api/removeSession", {
        projectId: reference.projectId,
        reason: "restorePreviousSession",
        sessionId: reference.sessionId,
      }).catch(() => undefined);
      this.removePreviousSessionFromCurrentResult(historyId);
      const restoredSessionId = response.session?.sessionId;
      if (restoredSessionId) {
        const restoredReference = {
          machineId: reference.machineId,
          projectId: response.session?.projectId ?? reference.projectId,
          sessionId: restoredSessionId,
        };
        this.setRemotePresentationSessionFocus(restoredReference);
        this.postRemoteSessionNativeAction(
          "openRemoteSessionTerminal",
          restoredReference,
          { historyId, type: "restorePreviousSession" },
        );
      }
    } catch {
      this.postRemoteToast("warning", "Remote restore failed", {
        description: "The remote gxserver could not restore that previous session.",
      });
    }
  }

  private async deletePreviousSession(historyId: string): Promise<void> {
    const remoteReference = parseGpuiRemotePreviousSessionHistoryId(historyId);
    if (remoteReference) {
      await this.requestRemoteGxserver(remoteReference.machineId, "/api/removeSession", {
        projectId: remoteReference.projectId,
        reason: "deletePreviousSession",
        sessionId: remoteReference.sessionId,
      }).catch(() => undefined);
      this.removePreviousSessionFromCurrentResult(historyId);
      return;
    }
    const reference = parseGpuiGxserverPreviousSessionHistoryId(historyId);
    if (!reference || !this.client) {
      return;
    }
    await this.client.rpc("/api/removeSession", {
      projectId: reference.projectId,
      reason: "deletePreviousSession",
      sessionId: reference.sessionId,
    }).catch(() => undefined);
    this.removePreviousSessionFromCurrentResult(historyId);
  }

  private connectedRemotePreviousSessionMachines(): Array<{
    machineId: string;
    machineName: string;
  }> {
    const settings = createGpuiSidebarSettings(this.runtimeSettings);
    return settings.remoteMachines.flatMap((machine) =>
      this.remotePresentations.has(machine.id)
        ? [{ machineId: machine.id, machineName: machine.name }]
        : [],
    );
  }

  private postPreviousSessionsResult(
    requestId: string,
    query: string | undefined,
    previousSessions: SidebarPreviousSessionItem[],
  ): void {
    this.previousSessionsResult = {
      previousSessions,
      query,
      requestId,
    };
    for (const session of previousSessions) {
      this.previousSessionsByHistoryId.set(session.historyId, session);
    }
    this.messageSource.postMessage({
      previousSessions,
      query,
      requestId,
      type: "previousSessionsResult",
    });
  }

  private removePreviousSessionFromCurrentResult(historyId: string): void {
    this.previousSessionsByHistoryId.delete(historyId);
    const previousResult = this.previousSessionsResult;
    if (!previousResult) {
      return;
    }
    this.postPreviousSessionsResult(
      previousResult.requestId,
      previousResult.query,
      previousResult.previousSessions.filter((session) => session.historyId !== historyId),
    );
  }

  private async requestProjectWorktrees(
    message: Extract<SidebarToExtensionMessage, { type: "requestProjectWorktrees" }>,
  ): Promise<void> {
    const requestId = message.requestId.trim();
    if (!requestId) {
      return;
    }
    if (message.remoteMachineId?.trim()) {
      await this.requestRemoteProjectWorktrees(message, requestId);
      return;
    }
    const sourceProject = this.resolveDomainProjectScope(message) ?? this.activeDomainProject();
    if (!sourceProject || !this.client) {
      this.trustedExistingWorktreeList = undefined;
      this.postProjectWorktreesResult(requestId, {
        error: "No active gxserver project is available.",
        ok: false,
      });
      return;
    }
    const parentProject = this.resolveWorktreeFamilyParentProject(sourceProject) ?? sourceProject;
    try {
      const [worktreeResult, branchResult] = await Promise.all([
        this.client.rpc<GxserverTypedOperationResult>("/api/runWorktreeAction", {
          action: "list",
          projectId: parentProject.projectId,
        }),
        this.client.rpc<GxserverTypedOperationResult>("/api/runGitAction", {
          action: "listBranches",
          projectId: parentProject.projectId,
        }),
      ]);
      if (worktreeResult.exitCode !== 0 || branchResult.exitCode !== 0) {
        throw new Error("gxserver could not read worktree metadata.");
      }
      const worktrees = createGpuiExistingWorktreeOptions(
        worktreeResult.worktrees,
        parentProject,
        sourceProject,
        this.domainProjects,
      );
      this.trustedExistingWorktreeList = {
        parentProjectId: parentProject.projectId,
        paths: new Set(worktrees.map((worktree) => worktree.path)),
        sourceProjectId: sourceProject.projectId,
      };
      this.postProjectWorktreesResult(requestId, {
        branches: normalizeGpuiWorktreeBaseBranches(branchResult.branches),
        ok: true,
        worktrees,
      });
    } catch {
      this.trustedExistingWorktreeList = undefined;
      this.postProjectWorktreesResult(requestId, {
        error: "Could not load gxserver worktrees.",
        ok: false,
      });
    }
  }

  private async requestRemoteProjectWorktrees(
    message: Extract<SidebarToExtensionMessage, { type: "requestProjectWorktrees" }>,
    requestId: string,
  ): Promise<void> {
    const sourceProject = this.resolveRemotePresentationProjectScope({
      projectId: message.projectId,
      remoteMachineId: message.remoteMachineId,
    });
    if (!sourceProject) {
      this.trustedExistingWorktreeList = undefined;
      this.postProjectWorktreesResult(requestId, {
        error: "Reconnect the remote machine before loading worktrees.",
        ok: false,
      });
      return;
    }
    try {
      const result = await this.requestRemoteGxserver<GxserverProjectWorktreeListResult>(
        sourceProject.machineId,
        "/api/listProjectWorktrees",
        {
          projectId: sourceProject.projectId,
        },
        { timeoutMs: 30_000 },
      );
      const worktrees = normalizeGpuiExistingWorktreeOptions(result.worktrees);
      this.trustedExistingWorktreeList = {
        parentProjectId: result.parentProjectId,
        paths: new Set(worktrees.map((worktree) => worktree.path)),
        remoteMachineId: sourceProject.machineId,
        sourceProjectId: result.sourceProjectId,
        worktreeKeys: new Set(
          worktrees
            .map((worktree) => worktree.worktreeKey?.trim())
            .filter((key): key is string => Boolean(key)),
        ),
      };
      this.postProjectWorktreesResult(requestId, {
        branches: normalizeGpuiWorktreeBaseBranches(result.branches),
        ok: true,
        worktrees,
      });
    } catch {
      this.trustedExistingWorktreeList = undefined;
      this.postProjectWorktreesResult(requestId, {
        error: "Could not load remote gxserver worktrees.",
        ok: false,
      });
    }
  }

  private async createProjectWorktree(
    message: Extract<SidebarToExtensionMessage, { type: "createProjectWorktree" }>,
  ): Promise<void> {
    const mode =
      message.mode === "openExisting" ||
      normalizeGpuiProjectPath(message.existingWorktreePath) ||
      message.existingWorktreeKey?.trim()
        ? "openExisting"
        : "create";
    const toastId = createGpuiWorktreeToastId();
    this.postWorktreeToast("info", mode === "openExisting" ? "Opening worktree" : "Creating worktree", {
      persistent: true,
      toastId,
    });
    try {
      if (message.remoteMachineId?.trim()) {
        await this.createRemoteProjectWorktree(message);
        this.trustedExistingWorktreeList = undefined;
        this.postWorktreeToast("success", "Remote worktree ready", { toastId });
        return;
      }
      if (!this.client) {
        throw new Error("gxserver is unavailable.");
      }
      const sourceProject = this.resolveDomainProjectScope(message) ?? this.activeDomainProject();
      if (!sourceProject || !normalizeGpuiProjectPath(sourceProject.path)) {
        throw new Error("Open an active code project before creating a worktree.");
      }
      if (sourceProject.isRecentProject === true) {
        throw new Error("Restore the project before creating a worktree.");
      }

      if (mode === "openExisting") {
        await this.openExistingProjectWorktree(message, sourceProject);
      } else {
        await this.createNewProjectWorktree(message, sourceProject);
      }
      this.trustedExistingWorktreeList = undefined;
      await this.refreshDomainPresentationFromClient("patch").catch(() => undefined);
      this.postWorktreeToast("success", "Worktree ready", { toastId });
    } catch (error) {
      this.postWorktreeToast(
        "error",
        mode === "openExisting" ? "Could not open worktree" : "Could not create worktree",
        {
          description: gpuiWorktreeUserVisibleErrorMessage(error),
          toastId,
        },
      );
    }
  }

  private async createNewProjectWorktree(
    message: Extract<SidebarToExtensionMessage, { type: "createProjectWorktree" }>,
    sourceProject: GxserverProjectDomainState,
  ): Promise<void> {
    if (!this.client) {
      throw new Error("gxserver is unavailable.");
    }
    const prompt = message.prompt?.trim() ?? "";
    const baseBranch = message.baseBranch?.trim() ?? "";
    const agent = this.resolveSidebarAgent(message.agentId?.trim() ?? "");
    if (!prompt) {
      throw new Error("Worktree prompt is empty.");
    }
    if (!baseBranch) {
      throw new Error("Choose a base branch.");
    }
    if (!agent?.command?.trim()) {
      throw new Error("Choose an agent with a configured command.");
    }

    const parentProject = this.resolveWorktreeFamilyParentProject(sourceProject) ?? sourceProject;
    const gxserverParentProject = await this.registerDomainProjectPath(parentProject);
    let gxserverOperationProject = gxserverParentProject;
    let gxserverSetupCommandProject = gxserverParentProject;
    if (
      normalizeGpuiProjectPath(sourceProject.path) !== normalizeGpuiProjectPath(parentProject.path)
    ) {
      gxserverOperationProject = await this.registerDomainProjectPath(sourceProject);
      gxserverSetupCommandProject = gxserverOperationProject;
    }

    const target = await this.resolveUniqueWorktreeTarget(gxserverOperationProject, prompt);
    const createResult = await this.client.rpc<GxserverTypedOperationResult>(
      "/api/runWorktreeAction",
      {
        action: "create",
        baseRef: baseBranch,
        branch: target.branch,
        projectId: gxserverOperationProject.projectId,
        worktreePath: target.path,
      },
    );
    if (createResult.exitCode !== 0) {
      throw new Error("git worktree add failed.");
    }

    const gxserverWorktreeProject = await this.registerProjectPath({
      name: `${gxserverParentProject.name || gpuiProjectNameFromPath(gxserverParentProject.path ?? "")}-${target.name}`,
      path: target.path,
    });
    if (!normalizeGpuiWorktreeParentProjectId(gxserverWorktreeProject.worktree)) {
      throw new Error("gxserver did not register the new checkout as a worktree project.");
    }
    await this.ensureWorktreeBeadsHooks(gxserverWorktreeProject);
    await this.runWorktreeSetupCommandIfConfigured(
      gxserverWorktreeProject,
      gxserverSetupCommandProject,
    );
    await this.createAgentSessionForProject(gxserverWorktreeProject, agent, prompt);
    this.focusProjectId(gxserverWorktreeProject.projectId);
  }

  private async createRemoteProjectWorktree(
    message: Extract<SidebarToExtensionMessage, { type: "createProjectWorktree" }>,
  ): Promise<void> {
    const remoteScope = this.resolveRemotePresentationProjectScope({
      projectId: message.projectId,
      remoteMachineId: message.remoteMachineId,
    });
    if (!remoteScope) {
      throw new Error("Reconnect the remote machine before creating a worktree.");
    }
    const mode =
      message.mode === "openExisting" || message.existingWorktreeKey?.trim()
        ? "openExisting"
        : "create";
    const prompt = message.prompt?.trim() ?? "";
    const agentId = message.agentId?.trim() ?? "";
    const agentTitle = createAgentSessionDefaultTitle(
      this.resolveSidebarAgent(agentId)?.name ?? agentId,
    );
    /*
    CDXC:RemoteWorktrees 2026-06-24-18:40:
    GPUI remote Add Worktree submits only the selected remote project id plus
    bounded create/open labels to gxserver. The remote daemon derives checkout
    paths, branch names, and open-existing worktree paths; GPUI preserves the
    shared modal's optional Open Existing prompt behavior by creating an agent
    session after the daemon returns a registered project id.
    */
    if (mode === "openExisting") {
      const worktreeKey = message.existingWorktreeKey?.trim() ?? "";
      if (!worktreeKey || !this.isTrustedRemoteExistingWorktreeKey(worktreeKey, remoteScope)) {
        throw new Error("Choose an existing remote worktree from the latest worktree list.");
      }
      const response = await this.requestRemoteGxserver<{
        project?: GxserverPresentationProject;
      }>(
        remoteScope.machineId,
        "/api/openProjectWorktree",
        {
          projectId: remoteScope.projectId,
          worktreeKey,
        },
        { timeoutMs: 45_000 },
      );
      const project = await this.resolveRemoteWorktreeMutationProject(
        remoteScope.machineId,
        response.project,
      );
      if (prompt) {
        if (!agentId) {
          throw new Error("Choose an agent before starting a remote worktree prompt.");
        }
        await this.createRemoteAgentSessionForProject(
          { machineId: remoteScope.machineId, projectId: project.projectId },
          agentId,
          prompt,
          agentTitle,
        );
      }
      return;
    }

    const baseRef = message.baseBranch?.trim() ?? "";
    if (!prompt) {
      throw new Error("Worktree prompt is empty.");
    }
    if (!baseRef) {
      throw new Error("Choose a base branch.");
    }
    if (!agentId) {
      throw new Error("Choose an agent before creating a remote worktree.");
    }
    const response = await this.requestRemoteGxserver<{
      project?: GxserverPresentationProject;
    }>(
      remoteScope.machineId,
      "/api/createProjectWorktree",
      {
        baseRef,
        nameHint: gpuiWorktreeSlugFromPrompt(prompt),
        projectId: remoteScope.projectId,
      },
      { timeoutMs: 90_000 },
    );
    const project = await this.resolveRemoteWorktreeMutationProject(
      remoteScope.machineId,
      response.project,
    );
    await this.createRemoteAgentSessionForProject(
      { machineId: remoteScope.machineId, projectId: project.projectId },
      agentId,
      prompt,
      agentTitle,
    );
  }

  private async openExistingProjectWorktree(
    message: Extract<SidebarToExtensionMessage, { type: "createProjectWorktree" }>,
    sourceProject: GxserverProjectDomainState,
  ): Promise<void> {
    const existingWorktreePath = normalizeGpuiProjectPath(message.existingWorktreePath);
    if (!existingWorktreePath) {
      throw new Error("Choose an existing worktree.");
    }
    const parentProject = this.resolveWorktreeFamilyParentProject(sourceProject) ?? sourceProject;
    if (!this.isTrustedExistingWorktreePath(existingWorktreePath, sourceProject, parentProject)) {
      throw new Error("Choose an existing worktree from the latest worktree list.");
    }
    const gxserverWorktreeProject = await this.registerProjectPath({
      name: gpuiProjectNameFromPath(existingWorktreePath),
      path: existingWorktreePath,
    });
    if (!normalizeGpuiWorktreeParentProjectId(gxserverWorktreeProject.worktree)) {
      throw new Error("The selected checkout is not a registered worktree.");
    }
    await this.ensureWorktreeBeadsHooks(gxserverWorktreeProject);
    const prompt = message.prompt?.trim() ?? "";
    const agent = this.resolveSidebarAgent(message.agentId?.trim() ?? "");
    if (prompt && !agent?.command?.trim()) {
      throw new Error("Choose an agent with a configured command.");
    }
    if (prompt && agent) {
      await this.createAgentSessionForProject(gxserverWorktreeProject, agent, prompt);
    }
    this.focusProjectId(gxserverWorktreeProject.projectId);
  }

  private postProjectWorktreesResult(
    requestId: string,
    result: {
      branches?: unknown;
      error?: string;
      ok: boolean;
      worktrees?: unknown;
    },
  ): void {
    this.messageSource.postMessage({
      branches: result.branches,
      error: result.error,
      ok: result.ok,
      requestId,
      type: "projectWorktreesResult",
      worktrees: result.worktrees,
    });
  }

  private async updateProjectWorktreeCommand(
    projectId: string,
    command: string,
  ): Promise<void> {
    const project = this.domainProjectById(projectId);
    if (!project || !this.client) {
      return;
    }
    const normalizedCommand = command.trim();
    await this.updateProjectDomainState(project.projectId, {
      gitConfig: {
        ...project.gitConfig,
        worktreeCommand: normalizedCommand || null,
      },
    });
  }

  private async updateProjectBeadsDisplayKey(
    projectId: string,
    displayKey: string,
  ): Promise<void> {
    const project = this.domainProjectById(projectId);
    if (!project || !this.client) {
      return;
    }
    const normalizedDisplayKey = displayKey.trim().toUpperCase().replace(/[^A-Z0-9]/gu, "").slice(0, 3);
    await this.updateProjectDomainState(project.projectId, {
      gitConfig: {
        ...project.gitConfig,
        beadsDisplayKey: normalizedDisplayKey || null,
      },
      projectBoardConfig: {
        ...project.projectBoardConfig,
        beadsDisplayKey: normalizedDisplayKey || null,
      },
    });
  }

  private async updateProjectBeadsDirectory(
    projectId: string,
    directory: string,
  ): Promise<void> {
    const project = this.domainProjectById(projectId);
    if (!project || !this.client) {
      return;
    }
    const normalizedDirectory = directory.trim();
    await this.updateProjectDomainState(project.projectId, {
      projectBoardConfig: {
        ...project.projectBoardConfig,
        beadsDirectory: normalizedDirectory || null,
      },
    });
  }

  private refreshGitStateForActiveProjectIfNeeded(): void {
    const project = this.activeDomainProject();
    if (!project || project.projectId === this.lastGitRefreshProjectId) {
      return;
    }
    this.lastGitRefreshProjectId = project.projectId;
    void this.refreshGitState({ project, toastOnFailure: false });
  }

  private async refreshGitState({
    force = false,
    project = this.activeDomainProject(),
    publishBusy = false,
    toastOnFailure = false,
  }: {
    force?: boolean;
    project?: GxserverProjectDomainState;
    publishBusy?: boolean;
    toastOnFailure?: boolean;
  } = {}): Promise<SidebarGitState> {
    if (!project) {
      this.gitState = createDefaultSidebarGitState();
      this.publishHudPatch();
      return this.gitState;
    }
    if (force) {
      this.lastGitRefreshProjectId = project.projectId;
    }
    const nextState = await this.readSidebarGitState(project, {
      publishBusy,
      toastOnFailure,
    });
    if (this.activeProjectId === project.projectId) {
      this.gitState = nextState;
      this.publishHudPatch();
    }
    return nextState;
  }

  private async refreshGitStateForMessage(
    message: Extract<SidebarToExtensionMessage, { type: "refreshGitState" }>,
  ): Promise<void> {
    /*
    CDXC:GPUISidebarGit 2026-06-24-21:26:
    Reused Git controls can refresh from a scoped local or remote project row. Resolve that owner before reading Git state; unscoped callers keep the active-project behavior, but scoped remote rows must never refresh the active local project by accident.
    */
    const explicitScope = Boolean(message.groupId?.trim() || message.projectId?.trim());
    const remoteScope = this.resolveGitPreferenceRemoteScope(message);
    if (remoteScope) {
      const activeRemoteGroupId = createGpuiRemotePresentationGroupId(
        remoteScope.machineId,
        remoteScope.projectId,
      );
      if (this.activeGroupId === activeRemoteGroupId) {
        const preferences = this.gitPreferencesForPresentationProject(
          this.findRemotePresentationProject(remoteScope) ?? remoteScope.project,
        );
        this.gitState = {
          ...createDefaultSidebarGitState(
            preferences.primaryAction,
            preferences.confirmCommit,
            preferences.generateCommitBody,
          ),
          isBusy: true,
        };
        this.publishHudPatch();
      }
      const nextState = await this.readRemoteSidebarGitState(remoteScope);
      if (this.activeGroupId === activeRemoteGroupId) {
        this.gitState = nextState;
        this.publishHudPatch();
      }
      return;
    }
    if (explicitScope && this.isGitPreferenceRemoteScope(message)) {
      this.postRemoteToast("warning", "Remote Git unavailable", {
        description: "Reconnect the remote machine before refreshing Git state.",
      });
      return;
    }
    const project =
      this.resolveGitPreferenceLocalProject(message) ??
      (explicitScope ? undefined : this.activeDomainProject());
    if (!project) {
      this.postGitToast("warning", "Git unavailable", {
        description: "No active gxserver project is available.",
      });
      return;
    }
    await this.refreshGitState({
      force: true,
      project,
      publishBusy: true,
      toastOnFailure: true,
    });
  }

  private async readSidebarGitState(
    project: GxserverProjectDomainState,
    options: { publishBusy?: boolean; toastOnFailure?: boolean } = {},
  ): Promise<SidebarGitState> {
    const baseState = createDefaultSidebarGitState(
      this.gitPreferencesForProject(project).primaryAction,
      this.gitPreferencesForProject(project).confirmCommit,
      this.gitPreferencesForProject(project).generateCommitBody,
    );
    if (
      !this.client ||
      project.isRecentProject === true ||
      isGpuiPresentationQuickDomainProject(project) ||
      !normalizeGpuiProjectPath(project.path)
    ) {
      return { ...baseState, hasCheckedGitHubRemote: true, isRepo: false };
    }
    if (options.publishBusy && this.activeProjectId === project.projectId) {
      this.gitState = { ...baseState, isBusy: true };
      this.publishHudPatch();
    }
    try {
      const repoCheck = await this.runGitAction(project, { action: "isInsideWorkTree" });
      if (repoCheck.exitCode !== 0 || repoCheck.stdout.trim() !== "true") {
        return { ...baseState, hasCheckedGitHubRemote: true, isRepo: false };
      }

      const [
        branch,
        status,
        diff,
        untrackedFiles,
        upstream,
        remotes,
        originRemote,
        ghVersion,
        pr,
      ] = await Promise.all([
        this.runGitAction(project, { action: "branch" }),
        this.runGitAction(project, { action: "statusPorcelain" }),
        this.runGitAction(project, { action: "diffNumstat" }),
        this.runGitAction(project, { action: "listUntracked" }),
        this.runGitAction(project, { action: "upstreamCounts" }),
        this.runGitAction(project, { action: "listRemotes" }),
        this.runGitAction(project, { action: "getOriginRemoteUrl" }),
        this.runGitHubAction(project, { action: "version" }),
        this.runGitHubAction(project, { action: "prView" }),
      ]);
      const files = mergeGpuiGitChangedFiles([
        ...parseGpuiGitNumstatFiles(diff.stdout),
        ...parseGpuiGitStatusPorcelainFiles(status.stdout),
        ...parseGitZeroDelimitedPaths(untrackedFiles.stdout).flatMap((path) => {
          const normalizedPath = normalizeGpuiRelativeGitFilePath(path);
          return normalizedPath
            ? [
                {
                  additions: 0,
                  deletions: 0,
                  path: normalizedPath,
                },
              ]
            : [];
        }),
      ]);
      const totals = summarizeGpuiGitChangedFiles(files);
      const upstreamParts = upstream.exitCode === 0 ? upstream.stdout.trim().split(/\s+/) : [];
      return {
        ...baseState,
        additions: totals.additions,
        aheadCount: Number(upstreamParts[0] || 0) || 0,
        behindCount: Number(upstreamParts[1] || 0) || 0,
        branch: branch.stdout.trim() || null,
        deletions: totals.deletions,
        hasCheckedGitHubRemote: true,
        hasGitHubCli: ghVersion.exitCode === 0,
        hasGitHubRemote:
          originRemote.exitCode === 0 && normalizeGpuiGitHubRemoteUrl(originRemote.stdout) !== undefined,
        hasOriginRemote: remotes.stdout.split(/\s+/).includes("origin"),
        hasUpstream: upstream.exitCode === 0,
        hasWorkingTreeChanges: status.stdout.trim().length > 0,
        isBusy: false,
        isRepo: true,
        files,
        isWorktree: normalizeGpuiWorktreeParentProjectId(project.worktree) !== undefined,
        pr: parseGpuiGitHubPullRequest(pr.stdout, pr.exitCode === 0),
        worktreeName: stringFromRecord(project.worktree, "name"),
      };
    } catch {
      if (options.toastOnFailure) {
        this.postGitToast("error", "Could not refresh Git state", {
          description: "gxserver could not inspect the selected project.",
        });
      }
      return { ...baseState, isBusy: false };
    }
  }

  private async readRemoteSidebarGitState(
    remoteScope: GpuiRemoteProjectScope,
  ): Promise<SidebarGitState> {
    const remotePreferences = this.gitPreferencesForPresentationProject(
      this.findRemotePresentationProject(remoteScope) ?? remoteScope.project,
    );
    const baseState = createDefaultSidebarGitState(
      remotePreferences.primaryAction,
      remotePreferences.confirmCommit,
      remotePreferences.generateCommitBody,
    );
    try {
      const repoCheck = await this.runRemoteGitAction(remoteScope, { action: "isInsideWorkTree" });
      if (repoCheck.exitCode !== 0 || repoCheck.stdout.trim() !== "true") {
        return { ...baseState, hasCheckedGitHubRemote: true, isRepo: false };
      }

      const [
        branch,
        status,
        diff,
        untrackedFiles,
        upstream,
        remotes,
        originRemote,
        ghVersion,
        pr,
      ] = await Promise.all([
        this.runRemoteGitAction(remoteScope, { action: "branch" }),
        this.runRemoteGitAction(remoteScope, { action: "statusPorcelain" }),
        this.runRemoteGitAction(remoteScope, { action: "diffNumstat" }),
        this.runRemoteGitAction(remoteScope, { action: "listUntracked" }),
        this.runRemoteGitAction(remoteScope, { action: "upstreamCounts" }),
        this.runRemoteGitAction(remoteScope, { action: "listRemotes" }),
        this.runRemoteGitAction(remoteScope, { action: "getOriginRemoteUrl" }),
        this.runRemoteGitHubAction(remoteScope, { action: "version" }),
        this.runRemoteGitHubAction(remoteScope, { action: "prView" }),
      ]);
      const files = mergeGpuiGitChangedFiles([
        ...parseGpuiGitNumstatFiles(diff.stdout),
        ...parseGpuiGitStatusPorcelainFiles(status.stdout),
        ...parseGitZeroDelimitedPaths(untrackedFiles.stdout).flatMap((path) => {
          const normalizedPath = normalizeGpuiRelativeGitFilePath(path);
          return normalizedPath
            ? [
                {
                  additions: 0,
                  deletions: 0,
                  path: normalizedPath,
                },
              ]
            : [];
        }),
      ]);
      const totals = summarizeGpuiGitChangedFiles(files);
      const upstreamParts = upstream.exitCode === 0 ? upstream.stdout.trim().split(/\s+/) : [];
      const presentationProject =
        this.findRemotePresentationProject(remoteScope) ?? remoteScope.project;
      return {
        ...baseState,
        additions: totals.additions,
        aheadCount: Number(upstreamParts[0] || 0) || 0,
        behindCount: Number(upstreamParts[1] || 0) || 0,
        branch: branch.stdout.trim() || null,
        deletions: totals.deletions,
        files,
        hasCheckedGitHubRemote: true,
        hasGitHubCli: ghVersion.exitCode === 0,
        hasGitHubRemote:
          originRemote.exitCode === 0 && normalizeGpuiGitHubRemoteUrl(originRemote.stdout) !== undefined,
        hasOriginRemote: remotes.stdout.split(/\s+/).includes("origin"),
        hasUpstream: upstream.exitCode === 0,
        hasWorkingTreeChanges: status.stdout.trim().length > 0,
        isBusy: false,
        isRepo: true,
        isWorktree: normalizeGpuiWorktreeParentProjectId(presentationProject.worktree) !== undefined,
        pr: parseGpuiGitHubPullRequest(pr.stdout, pr.exitCode === 0),
        worktreeName: stringFromRecord(presentationProject.worktree, "name") ?? presentationProject.title,
      };
    } catch {
      this.postRemoteToast("warning", "Remote Git unavailable", {
        description: "The remote gxserver could not inspect the selected project.",
      });
      return { ...baseState, hasCheckedGitHubRemote: true, isBusy: false, isRepo: false };
    }
  }

  private async runRemoteSidebarGitAction(
    message: Extract<SidebarToExtensionMessage, { type: "runSidebarGitAction" }>,
    remoteScope: GpuiRemoteProjectScope,
  ): Promise<void> {
    if (message.action === "multiRelease") {
      await this.runRemoteSidebarGitPromptAction(
        remoteScope,
        "Multicommit & Release",
        GPUI_GIT_MULTICOMMIT_RELEASE_PROMPT,
      );
      return;
    }
    if (message.action === "release") {
      await this.runRemoteSidebarGitPromptAction(
        remoteScope,
        "Release",
        GPUI_GIT_RELEASE_ONLY_PROMPT,
      );
      return;
    }

    const gitState = await this.readRemoteSidebarGitState(remoteScope);
    if (!gitState.isRepo) {
      this.postRemoteToast("warning", "Remote Git unavailable", {
        description: "Open a Git repository on the remote machine to use Git actions.",
      });
      return;
    }

    if (message.action === "syncMain") {
      if (!normalizeGpuiWorktreeParentProjectId(remoteScope.project.worktree)) {
        this.postRemoteToast("warning", "Remote worktree unavailable", {
          description: "Open a remote worktree project to sync with main.",
        });
        return;
      }
      await this.runRemoteSidebarGitPromptAction(
        remoteScope,
        "Sync with Main",
        buildGpuiGitSyncWithMainPrompt(),
      );
      return;
    }

    if (message.action === "syncRemote") {
      if (!hasSidebarGitRemoteCommitDelta(gitState)) {
        this.postRemoteToast("info", "Remote already synced");
        return;
      }
      await this.runRemoteGitMutation(
        remoteScope,
        "Syncing remote",
        "Remote sync complete",
        async () => {
          await this.syncRemoteCurrentBranchWithRemote(remoteScope, gitState);
        },
      );
      return;
    }

    if (
      normalizeGpuiWorktreeMetadata(remoteScope.project.worktree) &&
      (message.action === "commit" || message.action === "push" || message.action === "pr")
    ) {
      this.promptRemoteSidebarGitActionReview(remoteScope, gitState, message.action);
      return;
    }

    if (message.action === "pr") {
      if (gitState.pr?.state === "open") {
        this.postRemoteProjectNativeAction(
          "openRemoteExistingPullRequestInBrowser",
          remoteScope,
          message,
        );
        return;
      }
      if (!gitState.hasGitHubCli) {
        this.postRemoteToast("warning", "Remote GitHub CLI unavailable", {
          description: "Install GitHub CLI on the remote machine before creating a pull request.",
        });
        return;
      }
      if (gitState.hasWorkingTreeChanges) {
        this.promptRemoteSidebarGitActionReview(remoteScope, gitState, "pr");
        return;
      }
      await this.runRemoteSidebarGitPullRequestAgentWorkflow({
        gitState,
        hasCommit: false,
        hasExplicitFileSelection: false,
        message: "",
        remoteScope,
      });
      return;
    }

    if (message.action === "commit") {
      if (!gitState.hasWorkingTreeChanges) {
        this.postRemoteToast("info", "No remote changes to commit");
        return;
      }
      this.promptRemoteSidebarGitActionReview(remoteScope, gitState, "commit");
      return;
    }

    if (message.action === "push") {
      if (gitState.hasWorkingTreeChanges) {
        this.promptRemoteSidebarGitActionReview(remoteScope, gitState, "push");
        return;
      }
      await this.runRemoteGitMutation(remoteScope, "Pushing", "Remote push complete", async () => {
        await this.pushRemoteCurrentBranch(remoteScope, gitState);
      });
    }
  }

  private promptRemoteSidebarGitActionReview(
    remoteScope: GpuiRemoteProjectScope,
    gitState: SidebarGitState,
    action: Extract<SidebarGitAction, "commit" | "pr" | "push">,
  ): void {
    const requestId = `gpui-remote-git-action-${Date.now().toString(36)}`;
    const hasCommit = gitState.hasWorkingTreeChanges;
    this.pendingGitCommitRequests.set(requestId, {
      action,
      files: [...gitState.files],
      hasCommit,
      projectId: createGpuiRemotePresentationProjectId(remoteScope.machineId, remoteScope.projectId),
      remoteReference: {
        machineId: remoteScope.machineId,
        projectId: remoteScope.projectId,
      },
      remoteTitle: remoteScope.project.title || remoteScope.machineName || "Remote project",
      subject: "",
    });
    const modalDraft: SidebarPromptGitCommitMessage = {
      action,
      agentId: this.resolveDefaultPromptAgentId(),
      branch: gitState.branch,
      changedFiles: gitState.files,
      confirmLabel: resolveGpuiSidebarGitConfirmLabel(action, hasCommit),
      deleteWorktreeAfterDefault: false,
      description: hasCommit
        ? "Review and confirm your remote commit. Leave the message blank to auto-generate one."
        : resolveGpuiSidebarGitPromptDescription(action),
      isDefaultRef: gitState.branch === "main" || gitState.branch === "master",
      isWorktree: normalizeGpuiWorktreeMetadata(remoteScope.project.worktree) !== undefined,
      requestId,
      showCommitMessage: hasCommit,
      suggestedBody: undefined,
      suggestedSubject: "",
      type: "promptGitCommit",
      worktreeName: stringFromRecord(remoteScope.project.worktree, "name") ?? remoteScope.project.title,
    };
    this.messageSource.postMessage(modalDraft);
  }

  private async runSidebarGitAction(
    message: Extract<SidebarToExtensionMessage, { type: "runSidebarGitAction" }>,
  ): Promise<void> {
    const remoteReference = message.groupId
      ? parseGpuiRemotePresentationGroupId(message.groupId)
      : message.projectId
        ? parseGpuiRemotePresentationProjectId(message.projectId)
        : undefined;
    if (remoteReference) {
      const remoteScope = this.resolveRemotePresentationProjectScope({
        groupId: message.groupId,
        projectId: message.projectId,
      });
      if (!remoteScope) {
        this.postRemoteToast("warning", "Remote Git unavailable", {
          description: "Reconnect the remote machine before using Git actions.",
        });
        return;
      }
      await this.runRemoteSidebarGitAction(message, remoteScope);
      return;
    }
    const project = this.resolveGitProjectForMessage(message);
    if (!project) {
      this.postGitToast("warning", "Git unavailable", {
        description: "No active gxserver project is available.",
      });
      return;
    }

    if (message.action === "multiRelease") {
      await this.runSidebarGitPromptAction(
        project,
        "Multicommit & Release",
        GPUI_GIT_MULTICOMMIT_RELEASE_PROMPT,
      );
      return;
    }
    if (message.action === "release") {
      await this.runSidebarGitPromptAction(project, "Release", GPUI_GIT_RELEASE_ONLY_PROMPT);
      return;
    }

    const gitState = await this.refreshGitState({
      force: true,
      project,
      publishBusy: true,
      toastOnFailure: true,
    });
    if (!gitState.isRepo) {
      this.postGitToast("warning", "Git unavailable", {
        description: "Open a Git repository to use Git actions.",
      });
      return;
    }

    if (message.action === "syncMain") {
      if (!normalizeGpuiWorktreeParentProjectId(project.worktree)) {
        this.postGitToast("warning", "Worktree unavailable", {
          description: "Open a worktree project to sync with main.",
        });
        return;
      }
      await this.runSidebarGitPromptAction(
        project,
        "Sync with Main",
        buildGpuiGitSyncWithMainPrompt(),
      );
      return;
    }

    if (message.action === "syncRemote") {
      if (!hasSidebarGitRemoteCommitDelta(gitState)) {
        this.postGitToast("info", "Remote already synced");
        return;
      }
      await this.runGitMutation(project, "Syncing remote", "Remote sync complete", async () => {
        await this.syncCurrentBranchWithRemote(project, gitState);
      });
      return;
    }

    if (
      normalizeGpuiWorktreeMetadata(project.worktree) &&
      (message.action === "commit" || message.action === "push" || message.action === "pr")
    ) {
      this.promptSidebarGitActionReview(project, gitState, message.action);
      return;
    }

    if (message.action === "pr") {
      if (gitState.pr?.state === "open") {
        this.postNativeProjectPathAction(
          "openExistingPullRequestInBrowser",
          project.projectId,
          message,
        );
        return;
      }
      if (!gitState.hasGitHubCli) {
        this.postGitToast("warning", "GitHub CLI unavailable", {
          description: "Install GitHub CLI before creating a pull request.",
        });
        return;
      }
      if (gitState.hasWorkingTreeChanges) {
        this.promptSidebarGitActionReview(project, gitState, "pr");
        return;
      }
      await this.runSidebarGitPullRequestAgentWorkflow({
        gitState,
        hasCommit: false,
        hasExplicitFileSelection: false,
        message: "",
        project,
      });
      return;
    }

    if (message.action === "commit") {
      if (!gitState.hasWorkingTreeChanges) {
        this.postGitToast("info", "No changes to commit");
        return;
      }
      this.promptSidebarGitActionReview(project, gitState, "commit");
      return;
    }

    if (message.action === "push") {
      if (gitState.hasWorkingTreeChanges) {
        this.promptSidebarGitActionReview(project, gitState, "push");
        return;
      }
      await this.runGitMutation(project, "Pushing", "Push complete", async () => {
        await this.pushCurrentBranch(project, gitState);
      });
    }
  }

  private async confirmSidebarGitCommit(
    message: Extract<SidebarToExtensionMessage, { type: "confirmSidebarGitCommit" }>,
  ): Promise<void> {
    const pending = this.pendingGitCommitRequests.get(message.requestId);
    this.pendingGitCommitRequests.delete(message.requestId);
    if (!pending) {
      this.publishHudPatch();
      return;
    }
    if (pending.remoteReference) {
      await this.confirmRemoteSidebarGitCommit(pending, message);
      return;
    }
    const project = this.domainProjectById(pending.projectId);
    if (!project) {
      this.postGitToast("error", "Git action unavailable", {
        description: "The selected gxserver project is no longer available.",
      });
      this.publishHudPatch();
      return;
    }
    const gitState = await this.refreshGitState({
      force: true,
      project,
      publishBusy: true,
      toastOnFailure: true,
    });
    if (!gitState.isRepo) {
      this.postGitToast("warning", "Git unavailable", {
        description: "Open a Git repository to use Git actions.",
      });
      return;
    }
    if (pending.action === "pr") {
      let trustedFileSelection: GpuiTrustedGitReviewFileSelection | undefined;
      if (pending.hasCommit) {
        try {
          trustedFileSelection = this.resolveTrustedGitReviewFileSelection(pending, message.filePaths);
        } catch {
          this.postGitToast("warning", "Invalid file selection", {
            description: "Choose files from the current Git review before creating a pull request.",
          });
          this.gitState = { ...this.gitStateForHud(), isBusy: false };
          this.publishHudPatch();
          return;
        }
      }
      if (message.deleteWorktreeAfter !== true) {
        await this.runSidebarGitPullRequestAgentWorkflow({
          agentId: message.agentId,
          filePaths: trustedFileSelection?.filePaths,
          gitState,
          hasCommit: pending.hasCommit,
          hasExplicitFileSelection: trustedFileSelection?.explicit ?? false,
          message: message.message,
          project,
        });
        return;
      }
      let confirmedPullRequest = false;
      const completed = await this.runGitMutation(
        project,
        resolveGpuiSidebarGitStartedTitle("pr", pending.hasCommit),
        resolveGpuiSidebarGitFinishedTitle("pr"),
        async () => {
          if (pending.hasCommit) {
            await this.commitWithMessage(project, message.message, trustedFileSelection?.filePaths, {
              agentId: message.agentId,
              commitOnNewRef: message.commitOnNewRef === true,
            });
          }
          const nextGitState = await this.refreshGitState({ force: true, project });
          await this.pushCurrentBranch(project, nextGitState);
          const result = await this.createPullRequest(project);
          if (!isGpuiConfirmedOpenPullRequest(result)) {
            throw new GpuiUserVisibleGitError("GitHub CLI could not create or find an open pull request.");
          }
          confirmedPullRequest = true;
          this.postNativeProjectPathAction("openExistingPullRequestInBrowser", project.projectId, message);
        },
      );
      if (completed && confirmedPullRequest) {
        await this.deleteWorktreeAfterCompletedGitAction(project);
      }
      if (completed && !confirmedPullRequest) {
        this.postGitToast("warning", "Worktree cleanup skipped", {
          description: "Pull request creation was not confirmed.",
        });
      }
      if (!completed) {
        this.postGitToast("warning", "Worktree cleanup skipped", {
          description: "Pull request creation did not complete.",
        });
      }
      return;
    }
    let trustedFileSelection: GpuiTrustedGitReviewFileSelection | undefined;
    if (pending.hasCommit) {
      try {
        trustedFileSelection = this.resolveTrustedGitReviewFileSelection(pending, message.filePaths);
      } catch {
        this.postGitToast("warning", "Invalid file selection", {
          description: "Choose files from the current Git review before committing.",
        });
        this.gitState = { ...this.gitStateForHud(), isBusy: false };
        this.publishHudPatch();
        return;
      }
    }

    const completed = await this.runGitMutation(
      project,
      resolveGpuiSidebarGitStartedTitle(pending.action, pending.hasCommit),
      resolveGpuiSidebarGitFinishedTitle(pending.action),
      async () => {
        if (pending.hasCommit) {
          await this.commitWithMessage(project, message.message, trustedFileSelection?.filePaths, {
            agentId: message.agentId,
            commitOnNewRef: message.commitOnNewRef === true,
          });
        }
        if (pending.action === "push") {
          const nextState = await this.refreshGitState({ force: true, project });
          await this.pushCurrentBranch(project, nextState);
        }
      },
    );
    if (completed && message.deleteWorktreeAfter === true) {
      await this.deleteWorktreeAfterCompletedGitAction(project);
    }
  }

  private async confirmRemoteSidebarGitCommit(
    pending: GpuiPendingGitCommitRequest & { remoteReference: GpuiRemoteProjectReference },
    message: Extract<SidebarToExtensionMessage, { type: "confirmSidebarGitCommit" }>,
  ): Promise<void> {
    const remoteScope = this.resolveRemotePresentationProjectScope(pending.remoteReference);
    if (!remoteScope) {
      this.postRemoteToast("warning", "Remote Git unavailable", {
        description: "Reconnect the remote machine before confirming this Git action.",
      });
      return;
    }
    const gitState = await this.readRemoteSidebarGitState(remoteScope);
    if (!gitState.isRepo) {
      this.postRemoteToast("warning", "Remote Git unavailable", {
        description: "Open a Git repository on the remote machine to use Git actions.",
      });
      return;
    }
    if (pending.action === "pr") {
      let trustedFileSelection: GpuiTrustedGitReviewFileSelection | undefined;
      if (pending.hasCommit) {
        try {
          trustedFileSelection = this.resolveTrustedGitReviewFileSelection(pending, message.filePaths);
        } catch {
          this.postRemoteToast("warning", "Invalid file selection", {
            description: "Choose files from the current remote Git review before creating a pull request.",
          });
          return;
        }
      }
      if (message.deleteWorktreeAfter !== true) {
        await this.runRemoteSidebarGitPullRequestAgentWorkflow({
          agentId: message.agentId,
          filePaths: trustedFileSelection?.filePaths,
          gitState,
          hasCommit: pending.hasCommit,
          hasExplicitFileSelection: trustedFileSelection?.explicit ?? false,
          message: message.message,
          remoteScope,
        });
        return;
      }
      let confirmedPullRequest = false;
      const completed = await this.runRemoteGitMutation(
        remoteScope,
        resolveGpuiSidebarGitStartedTitle("pr", pending.hasCommit),
        resolveGpuiSidebarGitFinishedTitle("pr"),
        async () => {
          if (pending.hasCommit) {
            await this.commitRemoteWithMessage(
              remoteScope,
              message.message,
              trustedFileSelection?.filePaths,
              {
                agentId: message.agentId,
                commitOnNewRef: message.commitOnNewRef === true,
              },
            );
          }
          const nextGitState = await this.readRemoteSidebarGitState(remoteScope);
          await this.pushRemoteCurrentBranch(remoteScope, nextGitState);
          const result = await this.createRemotePullRequest(remoteScope);
          if (!isGpuiConfirmedOpenRemotePullRequest(result)) {
            throw new GpuiUserVisibleGitError("GitHub CLI could not create or find an open remote pull request.");
          }
          confirmedPullRequest = true;
          this.postRemoteProjectNativeAction(
            "openRemoteExistingPullRequestInBrowser",
            remoteScope,
            message,
          );
        },
      );
      if (completed && confirmedPullRequest) {
        await this.deleteRemoteWorktreeAfterCompletedGitAction(remoteScope);
      }
      if (completed && !confirmedPullRequest) {
        this.postRemoteToast("warning", "Remote worktree cleanup skipped", {
          description: "Pull request creation was not confirmed.",
        });
      }
      if (!completed) {
        this.postRemoteToast("warning", "Remote worktree cleanup skipped", {
          description: "Pull request creation did not complete.",
        });
      }
      return;
    }

    let trustedFileSelection: GpuiTrustedGitReviewFileSelection | undefined;
    if (pending.hasCommit) {
      try {
        trustedFileSelection = this.resolveTrustedGitReviewFileSelection(pending, message.filePaths);
      } catch {
        this.postRemoteToast("warning", "Invalid file selection", {
          description: "Choose files from the current remote Git review before committing.",
        });
        return;
      }
    }

    const completed = await this.runRemoteGitMutation(
      remoteScope,
      resolveGpuiSidebarGitStartedTitle(pending.action, pending.hasCommit),
      resolveGpuiSidebarGitFinishedTitle(pending.action),
      async () => {
        if (pending.hasCommit) {
          await this.commitRemoteWithMessage(
            remoteScope,
            message.message,
            trustedFileSelection?.filePaths,
            {
              agentId: message.agentId,
              commitOnNewRef: message.commitOnNewRef === true,
            },
          );
        }
        if (pending.action === "push") {
          const nextState = await this.readRemoteSidebarGitState(remoteScope);
          await this.pushRemoteCurrentBranch(remoteScope, nextState);
        }
      },
    );
    if (completed && message.deleteWorktreeAfter === true) {
      await this.deleteRemoteWorktreeAfterCompletedGitAction(remoteScope);
    }
  }

  private async confirmSidebarGitDirectMerge(
    message: Extract<SidebarToExtensionMessage, { type: "confirmSidebarGitDirectMerge" }>,
  ): Promise<void> {
    const pending = this.pendingGitCommitRequests.get(message.requestId);
    this.pendingGitCommitRequests.delete(message.requestId);
    if (!pending) {
      this.publishHudPatch();
      return;
    }
    if (pending.remoteReference) {
      await this.confirmRemoteSidebarGitDirectMerge(pending, message);
      return;
    }
    const project = this.domainProjectById(pending.projectId);
    if (!project) {
      this.postGitToast("error", "Direct merge unavailable", {
        description: "The selected gxserver project is no longer available.",
      });
      this.publishHudPatch();
      return;
    }
    const worktree = normalizeGpuiWorktreeMetadata(project.worktree);
    if (!worktree) {
      this.postGitToast("warning", "Worktree unavailable", {
        description: "Direct merge is only available from a gxserver worktree project.",
      });
      this.publishHudPatch();
      return;
    }
    const conflictAgent = this.resolveDefaultPromptAgent(message.agentId);
    if (!conflictAgent?.command?.trim()) {
      this.postGitToast("error", "Agent unavailable", {
        description: "Choose a configured prompt agent before merging.",
      });
      this.publishHudPatch();
      return;
    }

    const gitState = await this.refreshGitState({
      force: true,
      project,
      publishBusy: true,
      toastOnFailure: true,
    });
    if (!gitState.isRepo) {
      this.postGitToast("warning", "Git unavailable", {
        description: "Open a Git repository before merging this worktree.",
      });
      return;
    }

    let trustedFileSelection: GpuiTrustedGitReviewFileSelection | undefined;
    if (pending.hasCommit) {
      try {
        trustedFileSelection = this.resolveTrustedGitReviewFileSelection(pending, message.filePaths);
      } catch {
        this.postGitToast("warning", "Invalid file selection", {
          description: "Choose files from the current Git review before merging.",
        });
        this.gitState = { ...this.gitStateForHud(), isBusy: false };
        this.publishHudPatch();
        return;
      }
    }

    const toastId = createGpuiGitToastId();
    this.postGitToast("info", "Merging worktree into main", {
      persistent: true,
      toastId,
    });
    this.gitState = { ...this.gitStateForHud(), isBusy: true };
    this.publishHudPatch();
    try {
      if (pending.hasCommit) {
        await this.commitWithMessage(project, message.message, trustedFileSelection?.filePaths, {
          agentId: message.agentId,
        });
      }
      const nextGitState = await this.readSidebarGitState(project);
      const result = await this.mergeWorktreeIntoMain({
        branch: nextGitState.branch ?? worktree.branch,
        conflictAgent,
        deleteWorktreeAfter: message.deleteWorktreeAfter === true,
        worktreeProject: project,
      });
      this.gitState = { ...this.gitStateForHud(), isBusy: false };
      this.publishHudPatch();
      if (result === "conflicts") {
        this.postGitToast("warning", "Merge conflicts need resolution", { toastId });
        return;
      }
      await this.refreshDomainPresentationFromClient("patch").catch(() => undefined);
      this.postGitToast("success", "Worktree merged to main", { toastId });
    } catch (error) {
      this.gitState = { ...this.gitStateForHud(), isBusy: false };
      this.publishHudPatch();
      this.postGitToast("error", "Direct merge failed", {
        description: gpuiUserVisibleGitErrorMessage(
          error,
          "gxserver could not merge the selected worktree.",
        ),
        toastId,
      });
    }
  }

  private async confirmRemoteSidebarGitDirectMerge(
    pending: GpuiPendingGitCommitRequest & { remoteReference: GpuiRemoteProjectReference },
    message: Extract<SidebarToExtensionMessage, { type: "confirmSidebarGitDirectMerge" }>,
  ): Promise<void> {
    const remoteScope = this.resolveRemotePresentationProjectScope(pending.remoteReference);
    if (!remoteScope) {
      this.postRemoteToast("warning", "Remote merge unavailable", {
        description: "Reconnect the remote machine before merging this worktree.",
      });
      return;
    }
    if (!normalizeGpuiWorktreeMetadata(remoteScope.project.worktree)) {
      this.postRemoteToast("warning", "Remote worktree unavailable", {
        description: "Direct merge is only available from a remote worktree project.",
      });
      return;
    }
    let trustedFileSelection: GpuiTrustedGitReviewFileSelection | undefined;
    if (pending.hasCommit) {
      try {
        trustedFileSelection = this.resolveTrustedGitReviewFileSelection(pending, message.filePaths);
      } catch {
        this.postRemoteToast("warning", "Invalid file selection", {
          description: "Choose files from the current remote Git review before merging.",
        });
        return;
      }
    }
    const toastId = createGpuiGitToastId();
    this.postGitToast("info", "Merging remote worktree", {
      persistent: true,
      toastId,
    });
    /*
    CDXC:RemoteGitBranching 2026-06-24-18:55:
    Remote direct merge and commit-on-new-branch must go through id-scoped gxserver operations so the daemon derives main, parent, and branch targets. GPUI may refresh presentation and create a conflict-resolution agent session, but it must not attach terminals, focus remote panes, open native apps, or expose branch/path/command details in status text.
    */
    try {
      if (pending.hasCommit) {
        await this.commitRemoteWithMessage(
          remoteScope,
          message.message,
          trustedFileSelection?.filePaths,
          {
            agentId: message.agentId,
          },
        );
      }
      const result = await this.mergeRemoteWorktreeIntoMain(remoteScope);
      await this.refreshRemotePresentationFromGxserver(remoteScope.machineId).catch(() => undefined);
      if (result.status === "conflicts") {
        this.postGitToast("warning", "Remote merge conflicts need resolution", { toastId });
        const conflictAgentId = this.resolveDefaultPromptAgentId(message.agentId);
        if (conflictAgentId && result.parentProjectId) {
          await this.createRemoteAgentSessionForProject(
            { machineId: remoteScope.machineId, projectId: result.parentProjectId },
            conflictAgentId,
            GPUI_REMOTE_MERGE_CONFLICT_PROMPT,
            formatGpuiGitAgentWorkflowTitle("Merge Conflicts"),
          ).catch(() => undefined);
        }
        return;
      }
      this.postGitToast("success", "Remote worktree merged", { toastId });
      if (message.deleteWorktreeAfter === true) {
        await this.deleteRemoteWorktreeAfterCompletedGitAction(remoteScope);
      }
    } catch (error) {
      this.postGitToast("error", "Remote direct merge failed", {
        description: gpuiUserVisibleGitErrorMessage(
          error,
          "Remote gxserver could not merge the selected worktree.",
        ),
        toastId,
      });
    }
  }

  private async mergeRemoteWorktreeIntoMain(
    remoteScope: GpuiRemoteProjectScope,
  ): Promise<GxserverMergeWorktreeIntoMainResult> {
    return this.requestRemoteGxserver<GxserverMergeWorktreeIntoMainResult>(
      remoteScope.machineId,
      "/api/mergeWorktreeIntoMain",
      { projectId: remoteScope.projectId },
      { timeoutMs: 60_000 },
    );
  }

  private async mergeWorktreeIntoMain(input: {
    branch?: string | null;
    conflictAgent: SidebarAgentButton;
    deleteWorktreeAfter: boolean;
    worktreeProject: GxserverProjectDomainState;
  }): Promise<"conflicts" | "merged"> {
    const worktree = normalizeGpuiWorktreeMetadata(input.worktreeProject.worktree);
    if (!worktree) {
      throw new Error("Direct merge requires a worktree project.");
    }
    const branch = input.branch?.trim() || worktree.branch;
    if (!branch) {
      throw new Error("Create and checkout a branch before merging.");
    }
    const parentProject = this.domainProjectById(worktree.parentProjectId);
    if (
      !parentProject ||
      parentProject.projectId === input.worktreeProject.projectId ||
      parentProject.isRecentProject === true ||
      !normalizeGpuiProjectPath(parentProject.path)
    ) {
      throw new Error("The gxserver worktree parent project is unavailable.");
    }

    const mainCheck = await this.runGitAction(parentProject, {
      action: "verifyRef",
      ref: "main",
    });
    if (mainCheck.exitCode !== 0) {
      throw new Error('The parent project does not have a local "main" branch.');
    }
    const parentStatus = await this.runGitAction(parentProject, { action: "status" });
    if (parentStatus.exitCode !== 0) {
      throw new Error("Could not read parent project status.");
    }
    if (hasGpuiGxserverShortStatusChanges(parentStatus.stdout)) {
      throw new Error("Commit or stash changes in the main project before merging this worktree.");
    }

    const checkoutResult = await this.runGitAction(parentProject, {
      action: "checkout",
      branch: "main",
    });
    if (checkoutResult.exitCode !== 0) {
      throw new Error("Could not checkout main.");
    }
    const mergeResult = await this.runGitAction(parentProject, {
      action: "merge",
      branch,
    });
    if (mergeResult.exitCode !== 0) {
      await this.launchMergeConflictAgent({
        agent: input.conflictAgent,
        branch,
        mergeOutput: mergeResult.stderr.trim() || mergeResult.stdout.trim(),
        parentProject,
        worktree,
        worktreeProject: input.worktreeProject,
      });
      return "conflicts";
    }

    if (input.deleteWorktreeAfter) {
      await this.deleteWorktreeAfterCompletedGitAction(input.worktreeProject);
    }
    return "merged";
  }

  private async launchMergeConflictAgent(input: {
    agent: SidebarAgentButton;
    branch: string;
    mergeOutput: string;
    parentProject: GxserverProjectDomainState;
    worktree: GpuiWorktreeMetadata;
    worktreeProject: GxserverProjectDomainState;
  }): Promise<void> {
    this.focusProjectId(input.parentProject.projectId);
    await this.createAgentSessionForProject(
      input.parentProject,
      input.agent,
      buildGpuiMergeConflictPrompt(input),
      formatGpuiGitAgentWorkflowTitle("Merge Conflicts"),
    );
  }

  private async deleteWorktreeAfterCompletedGitAction(
    worktreeProject: GxserverProjectDomainState,
  ): Promise<void> {
    if (!this.client) {
      return;
    }
    const currentProject = this.domainProjectById(worktreeProject.projectId) ?? worktreeProject;
    const worktree = normalizeGpuiWorktreeMetadata(currentProject.worktree);
    if (!worktree) {
      this.postGitToast("warning", "Worktree cleanup skipped", {
        description: "The selected gxserver project is no longer a worktree.",
      });
      return;
    }
    const parentProject = this.domainProjectById(worktree.parentProjectId);
    const toastId = createGpuiGitToastId();
    this.postGitToast("info", "Removing worktree", {
      persistent: true,
      toastId,
    });
    try {
      const result = await this.client.rpc<GxserverDeleteWorktreeProjectResult>(
        "/api/deleteWorktreeProject",
        {
          deleteLocalBranch: false,
          deleteRemoteBranch: false,
          projectId: currentProject.projectId,
        },
      );
      this.postGxserverWorktreeDeleteWarnings(result);
      this.domainProjects = this.domainProjects.filter(
        (project) => project.projectId !== currentProject.projectId,
      );
      if (parentProject) {
        this.focusProjectId(parentProject.projectId);
      } else if (this.activeProjectId === currentProject.projectId) {
        const fallbackProjectId = this.domainProjects[0]?.projectId;
        this.activeProjectId = fallbackProjectId;
        this.activeGroupId = fallbackProjectId
          ? createGxserverPresentationProjectGroupId(fallbackProjectId)
          : GPUI_GXSERVER_CHATS_GROUP_ID;
      }
      await this.refreshDomainPresentationFromClient("patch").catch(() => {
        this.publishHudPatch();
      });
      this.postGitToast("success", "Worktree removed", { toastId });
    } catch {
      this.postGitToast("error", "Could not remove worktree", {
        description: "gxserver worktree cleanup failed.",
        toastId,
      });
    }
  }

  private async deleteRemoteWorktreeAfterCompletedGitAction(
    remoteScope: GpuiRemoteProjectScope,
  ): Promise<void> {
    const currentProject =
      this.findRemotePresentationProject(remoteScope) ?? remoteScope.project;
    const worktree = normalizeGpuiWorktreeMetadata(currentProject.worktree);
    if (!worktree) {
      this.postRemoteToast("warning", "Remote worktree cleanup skipped", {
        description: "The selected remote project is no longer a worktree.",
      });
      return;
    }
    const toastId = createGpuiGitToastId();
    this.postGitToast("info", "Removing remote worktree", {
      persistent: true,
      toastId,
    });
    try {
      const result = await this.requestRemoteGxserver<GxserverDeleteWorktreeProjectResult>(
        remoteScope.machineId,
        "/api/deleteWorktreeProject",
        {
          deleteLocalBranch: false,
          deleteRemoteBranch: false,
          projectId: remoteScope.projectId,
        },
        { timeoutMs: 45_000 },
      );
      this.postGxserverWorktreeDeleteWarnings(result);
      await this.refreshRemotePresentationFromGxserver(remoteScope.machineId).catch(() => undefined);
      this.postGitToast("success", "Remote worktree removed", { toastId });
    } catch {
      this.postGitToast("error", "Could not remove remote worktree", {
        description: "Remote gxserver worktree cleanup failed.",
        toastId,
      });
    }
  }

  private postGxserverWorktreeDeleteWarnings(
    result: GxserverDeleteWorktreeProjectResult,
  ): void {
    for (const warning of result.warnings) {
      switch (warning.kind) {
        case "localBranchDeleteFailed":
        case "localBranchNotResolved":
          this.postGitToast("warning", "Worktree removed, but local branch cleanup needs attention");
          break;
        case "remoteBranchDeleteFailed":
        case "remoteBranchNotResolved":
          this.postGitToast("warning", "Worktree removed, but remote branch cleanup needs attention");
          break;
        case "pruneFailed":
          this.postGitToast("warning", "Worktree removed, but stale metadata cleanup needs attention");
          break;
      }
    }
  }

  private async runSidebarGitMultipleCommits(
    requestId: string,
    agentId?: string,
  ): Promise<void> {
    const pending = this.pendingGitCommitRequests.get(requestId);
    this.pendingGitCommitRequests.delete(requestId);
    if (pending?.remoteReference) {
      const remoteScope = this.resolveRemotePresentationProjectScope(pending.remoteReference);
      if (!remoteScope) {
        this.postRemoteToast("warning", "Remote Git unavailable", {
          description: "Reconnect the remote machine before starting this Git workflow.",
        });
        return;
      }
      await this.runRemoteSidebarGitPromptAction(
        remoteScope,
        "Multiple Commits",
        GPUI_GIT_MULTIPLE_COMMITS_PROMPT,
        agentId,
      );
      return;
    }
    const project = pending ? this.domainProjectById(pending.projectId) : this.activeDomainProject();
    if (!project) {
      this.postGitToast("warning", "Git unavailable", {
        description: "No active gxserver project is available.",
      });
      this.publishHudPatch();
      return;
    }
    await this.runSidebarGitPromptAction(project, "Multiple Commits", GPUI_GIT_MULTIPLE_COMMITS_PROMPT, agentId);
  }

  private promptSidebarGitActionReview(
    project: GxserverProjectDomainState,
    gitState: SidebarGitState,
    action: Extract<SidebarGitAction, "commit" | "pr" | "push">,
  ): void {
    const requestId = `gpui-git-action-${Date.now().toString(36)}`;
    const hasCommit = gitState.hasWorkingTreeChanges;
    /*
    CDXC:GPUISidebarGit 2026-06-24-15:22:
    GPUI commit review stores the gxserver-derived changed-file list with the request id. Later modal selections and diff clicks may only reference those paths, so CEF cannot stage or inspect arbitrary renderer-supplied paths.
    Treat the modal's all-selected case as that stored review list instead of a fresh unbounded add-all, so files created after review opens cannot slip into the confirmed commit.
    */
    this.pendingGitCommitRequests.set(requestId, {
      action,
      files: [...gitState.files],
      hasCommit,
      projectId: project.projectId,
      subject: "",
    });
    const modalDraft: SidebarPromptGitCommitMessage = {
      action,
      agentId: this.resolveDefaultPromptAgent()?.agentId,
      branch: gitState.branch,
      changedFiles: gitState.files,
      confirmLabel: resolveGpuiSidebarGitConfirmLabel(action, hasCommit),
      deleteWorktreeAfterDefault: false,
      description: hasCommit
        ? "Review and confirm your commit. Leave the message blank to auto-generate one."
        : resolveGpuiSidebarGitPromptDescription(action),
      isDefaultRef: gitState.branch === "main" || gitState.branch === "master",
      isWorktree: normalizeGpuiWorktreeMetadata(project.worktree) !== undefined,
      requestId,
      showCommitMessage: hasCommit,
      suggestedBody: undefined,
      suggestedSubject: "",
      type: "promptGitCommit",
      worktreeName: stringFromRecord(project.worktree, "name"),
    };
    this.messageSource.postMessage(modalDraft);
    this.gitState = { ...gitState, isBusy: false };
    this.publishHudPatch();
  }

  private async openSidebarGitChangedFileDiff(
    filePath: string,
    requestId?: string,
  ): Promise<void> {
    const request = requestId ? this.pendingGitCommitRequests.get(requestId) : undefined;
    if (request?.remoteReference) {
      await this.openRemoteSidebarGitChangedFileDiff(
        request.remoteReference,
        filePath,
        requestId,
      );
      return;
    }
    const project = request ? this.domainProjectById(request.projectId) : undefined;
    const normalizedFilePath = normalizeGpuiRelativeGitFilePath(filePath);
    if (!requestId || !request || !project || !normalizedFilePath) {
      return;
    }
    const reviewFile = request.files.find((file) => file.path === normalizedFilePath);
    if (!reviewFile) {
      return;
    }
    try {
      const [stagedDiff, unstagedDiff] = await Promise.all([
        this.runGitAction(project, {
          action: "diffCachedNoExt",
          filePath: normalizedFilePath,
        }),
        this.runGitAction(project, {
          action: "diffNoExt",
          filePath: normalizedFilePath,
        }),
      ]);
      const patchParts = [stagedDiff.stdout.trimEnd(), unstagedDiff.stdout.trimEnd()].filter(
        (part) => part.trim().length > 0,
      );
      let patch = patchParts.join("\n\n");
      if (!patch.trim()) {
        const untracked = await this.runGitAction(project, {
          action: "isUntrackedFile",
          filePath: normalizedFilePath,
        });
        if (untracked.stdout.trim()) {
          const noIndexDiff = await this.runGitAction(project, {
            action: "diffNoIndexAgainstNull",
            filePath: normalizedFilePath,
          });
          patch = noIndexDiff.stdout.trimEnd() || noIndexDiff.stderr.trimEnd();
        }
      }
      this.postSidebarGitFileDiff(requestId, {
        additions: reviewFile.additions,
        deletions: reviewFile.deletions,
        filePath: normalizedFilePath,
        patch: patch.trim() || `No diff is available for ${normalizedFilePath}.`,
      });
    } catch {
      this.postSidebarGitFileDiff(requestId, {
        additions: reviewFile.additions,
        deletions: reviewFile.deletions,
        filePath: normalizedFilePath,
        patch: `No diff is available for ${normalizedFilePath}.`,
      });
    }
  }

  private async openRemoteSidebarGitChangedFileDiff(
    remoteReference: GpuiRemoteProjectReference,
    filePath: string,
    requestId?: string,
  ): Promise<void> {
    const request = requestId ? this.pendingGitCommitRequests.get(requestId) : undefined;
    const remoteScope = this.resolveRemotePresentationProjectScope(remoteReference);
    const normalizedFilePath = normalizeGpuiRelativeGitFilePath(filePath);
    if (!requestId || !request || !remoteScope || !normalizedFilePath) {
      return;
    }
    const reviewFile = request.files.find((file) => file.path === normalizedFilePath);
    if (!reviewFile) {
      return;
    }
    try {
      const [stagedDiff, unstagedDiff] = await Promise.all([
        this.runRemoteGitAction(remoteScope, {
          action: "diffCachedNoExt",
          filePath: normalizedFilePath,
        }),
        this.runRemoteGitAction(remoteScope, {
          action: "diffNoExt",
          filePath: normalizedFilePath,
        }),
      ]);
      const patchParts = [stagedDiff.stdout.trimEnd(), unstagedDiff.stdout.trimEnd()].filter(
        (part) => part.trim().length > 0,
      );
      let patch = patchParts.join("\n\n");
      if (!patch.trim()) {
        const untracked = await this.runRemoteGitAction(remoteScope, {
          action: "isUntrackedFile",
          filePath: normalizedFilePath,
        });
        if (untracked.stdout.trim()) {
          const noIndexDiff = await this.runRemoteGitAction(remoteScope, {
            action: "diffNoIndexAgainstNull",
            filePath: normalizedFilePath,
          });
          patch = noIndexDiff.stdout.trimEnd() || noIndexDiff.stderr.trimEnd();
        }
      }
      this.postSidebarGitFileDiff(requestId, {
        additions: reviewFile.additions,
        deletions: reviewFile.deletions,
        filePath: normalizedFilePath,
        patch: patch.trim() || `No diff is available for ${normalizedFilePath}.`,
      });
    } catch {
      this.postSidebarGitFileDiff(requestId, {
        additions: reviewFile.additions,
        deletions: reviewFile.deletions,
        filePath: normalizedFilePath,
        patch: `No diff is available for ${normalizedFilePath}.`,
      });
    }
  }

  private async openSidebarGitChangedFileInIde(
    message: Extract<SidebarToExtensionMessage, { type: "openSidebarGitChangedFile" }>,
  ): Promise<void> {
    /*
    CDXC:GPUISidebarGit 2026-06-24-21:26:
    Changed-file IDE opens reuse the shared SidebarApp file row. GPUI sends Rust only the gxserver project id and a normalized relative file candidate already present in the current HUD or review request; Rust remains authoritative and re-validates the file against gxserver before resolving an absolute path.
    Scoped non-review opens must re-read the owning local or remote gxserver project instead of using the active local HUD file list, so remote rows cannot open stale or cross-project file candidates.
    */
    const normalizedFilePath = normalizeGpuiRelativeGitFilePath(message.filePath);
    const request = message.requestId
      ? this.pendingGitCommitRequests.get(message.requestId)
      : undefined;
    if (request?.remoteReference) {
      const remoteScope = this.resolveRemotePresentationProjectScope(request.remoteReference);
      if (
        !normalizedFilePath ||
        !remoteScope ||
        !request.files.some((file) => file.path === normalizedFilePath)
      ) {
        this.postRemoteToast("warning", "Remote file open unavailable", {
          description: "Choose a changed file from the current remote Git review.",
        });
        return;
      }
      this.postRemoteProjectNativeAction(
        "openRemoteSidebarGitChangedFileInIde",
        remoteScope,
        message,
        { filePath: normalizedFilePath },
      );
      return;
    }
    if (!request) {
      const remoteScope = this.resolveGitPreferenceRemoteScope(message);
      if (remoteScope) {
        if (!normalizedFilePath) {
          this.postRemoteToast("warning", "Remote file open unavailable", {
            description: "Choose a changed file from the current remote Git state.",
          });
          return;
        }
        const gitState = await this.readRemoteSidebarGitState(remoteScope);
        if (!gitState.files.some((file) => file.path === normalizedFilePath)) {
          this.postRemoteToast("warning", "Remote file open unavailable", {
            description: "Choose a changed file from the current remote Git state.",
          });
          return;
        }
        this.postRemoteProjectNativeAction(
          "openRemoteSidebarGitChangedFileInIde",
          remoteScope,
          message,
          { filePath: normalizedFilePath },
        );
        return;
      }
      if (this.isGitPreferenceRemoteScope(message)) {
        this.postRemoteToast("warning", "Remote file open unavailable", {
          description: "Reconnect the remote machine before opening changed files.",
        });
        return;
      }
    }
    const project = request ? this.domainProjectById(request.projectId) : this.activeDomainProject();
    const explicitScope = !request && Boolean(message.groupId?.trim() || message.projectId?.trim());
    const scopedProject = request
      ? project
      : this.resolveGitPreferenceLocalProject(message) ?? (explicitScope ? undefined : project);
    const trustedFiles =
      request?.files ??
      (scopedProject && scopedProject.projectId !== this.activeProjectId
        ? (await this.readSidebarGitState(scopedProject)).files
        : this.gitState.files);
    if (
      !normalizedFilePath ||
      !scopedProject ||
      scopedProject.isRecentProject === true ||
      !trustedFiles.some((file) => file.path === normalizedFilePath)
    ) {
      this.postGitToast("warning", "Open file unavailable", {
        description: "Choose a changed file from the current Git state.",
      });
      return;
    }
    this.postNativeProjectPathAction(
      "openSidebarGitChangedFileInIde",
      scopedProject.projectId,
      message,
      { filePath: normalizedFilePath },
    );
  }

  private postSidebarGitFileDiff(
    requestId: string,
    draft: SidebarGitFileDiffDraft,
  ): void {
    this.messageSource.postMessage({
      draft,
      requestId,
      type: "sidebarGitFileDiff",
    });
  }

  private resolveTrustedGitReviewFileSelection(
    request: GpuiPendingGitCommitRequest,
    filePaths?: readonly string[],
  ): GpuiTrustedGitReviewFileSelection {
    const explicit = filePaths !== undefined;
    const candidatePaths = explicit ? filePaths : request.files.map((file) => file.path);
    const allowedPaths = new Map(request.files.map((file) => [file.path, file.path]));
    const selectedPaths: string[] = [];
    for (const filePath of candidatePaths) {
      const normalizedPath = normalizeGpuiRelativeGitFilePath(filePath);
      const trustedPath = normalizedPath ? allowedPaths.get(normalizedPath) : undefined;
      if (!trustedPath) {
        throw new Error("Selected file is not part of the current Git review.");
      }
      if (!selectedPaths.includes(trustedPath)) {
        selectedPaths.push(trustedPath);
      }
    }
    if (selectedPaths.length === 0) {
      throw new Error("Select at least one changed file.");
    }
    return { explicit, filePaths: selectedPaths };
  }

  private async runGitMutation(
    project: GxserverProjectDomainState,
    startedTitle: string,
    finishedTitle: string,
    operation: () => Promise<void>,
  ): Promise<boolean> {
    const toastId = createGpuiGitToastId();
    this.postGitToast("info", startedTitle, { persistent: true, toastId });
    this.gitState = { ...this.gitStateForHud(), isBusy: true };
    this.publishHudPatch();
    try {
      await operation();
      await this.refreshGitState({ force: true, project });
      this.postGitToast("success", finishedTitle, { toastId });
      return true;
    } catch (error) {
      this.gitState = { ...this.gitStateForHud(), isBusy: false };
      this.publishHudPatch();
      this.postGitToast("error", `${startedTitle} failed`, {
        description: gpuiUserVisibleGitErrorMessage(error, "gxserver Git operation failed."),
        toastId,
      });
      return false;
    }
  }

  private async commitWithMessage(
    project: GxserverProjectDomainState,
    message: string,
    filePaths?: readonly string[],
    options: { agentId?: string; commitOnNewRef?: boolean } = {},
  ): Promise<void> {
    const parsedMessage = parseGpuiSidebarGitCommitMessage(message);
    let resolvedMessage = parsedMessage;
    if (parsedMessage.subject) {
      const addResult = await this.runGitAction(project, {
        action: "addAll",
        filePaths,
      });
      if (addResult.exitCode !== 0) {
        throw new Error("Could not stage changes.");
      }
    } else {
      resolvedMessage = await this.generateCommitMessage(project, filePaths, options.agentId);
    }
    if (options.commitOnNewRef) {
      await this.checkoutSidebarGitFeatureBranch(project, resolvedMessage.subject);
    }
    const commitResult = await this.runGitAction(project, {
      action: "commit",
      messageBody: resolvedMessage.body,
      messageSubject: resolvedMessage.subject,
      noVerify: await this.shouldBypassMissingBeadsDatabasePreCommitHook(project),
    });
    if (commitResult.exitCode !== 0) {
      throw new Error("Could not commit changes.");
    }
  }

  private async generateCommitMessage(
    project: GxserverProjectDomainState,
    filePaths: readonly string[] | undefined,
    agentId?: string,
  ): Promise<{ body: string; subject: string }> {
    if (!this.client) {
      throw new Error("gxserver is unavailable.");
    }
    if (!filePaths || filePaths.length === 0) {
      throw new Error("Select at least one changed file before generating a commit message.");
    }
    const agent = this.resolveDefaultPromptAgent(agentId);
    if (!agent?.command?.trim()) {
      throw new GpuiUserVisibleGitError(
        "Choose a configured prompt agent before generating a commit message.",
      );
    }
    if (!supportsGpuiBackgroundCommitMessageGeneration(agent)) {
      throw new GpuiUserVisibleGitError(
        "Selected prompt agent does not support background commit message generation.",
      );
    }
    this.postGitToast("info", "Generating commit message");
    return this.client.rpc<GxserverGenerateCommitMessageResult>("/api/generateCommitMessage", {
      agentId: agent.agentId,
      filePaths: [...filePaths],
      projectId: project.projectId,
    });
  }

  private async generateRemoteCommitMessage(
    remoteScope: GpuiRemoteProjectScope,
    filePaths: readonly string[] | undefined,
    agentId?: string,
  ): Promise<{ body: string; subject: string }> {
    if (!filePaths || filePaths.length === 0) {
      throw new Error("Select at least one changed file before generating a commit message.");
    }
    const resolvedAgentId = this.resolveDefaultPromptAgentId(agentId);
    if (!resolvedAgentId) {
      throw new GpuiUserVisibleGitError(
        "Choose a prompt agent before generating a remote commit message.",
      );
    }
    this.postGitToast("info", "Generating remote commit message");
    return this.requestRemoteGxserver<GxserverGenerateCommitMessageResult>(
      remoteScope.machineId,
      "/api/generateCommitMessage",
      {
        agentId: resolvedAgentId,
        filePaths: [...filePaths],
        projectId: remoteScope.projectId,
      },
      { timeoutMs: 125_000 },
    );
  }

  private async checkoutSidebarGitFeatureBranch(
    project: GxserverProjectDomainState,
    subject: string,
  ): Promise<string> {
    const baseName = sanitizeGpuiSidebarGitBranchName(subject);
    for (let index = 0; index < 20; index += 1) {
      const candidate = index === 0 ? baseName : `${baseName}-${index + 1}`;
      const exists = await this.runGitAction(project, {
        action: "verifyRef",
        ref: candidate,
      });
      if (exists.exitCode !== 0) {
        const checkout = await this.runGitAction(project, {
          action: "checkoutNewBranch",
          branch: candidate,
        });
        if (checkout.exitCode !== 0) {
          throw new Error("Could not create a new branch.");
        }
        return candidate;
      }
    }
    throw new Error("Could not create a unique branch.");
  }

  private async pushCurrentBranch(
    project: GxserverProjectDomainState,
    gitState: Pick<SidebarGitState, "branch" | "behindCount" | "hasOriginRemote" | "hasUpstream">,
  ): Promise<void> {
    const branch = gitState.branch;
    if (!branch) {
      throw new Error("Create and checkout a branch before pushing.");
    }
    if (gitState.behindCount > 0) {
      throw new Error("Branch is behind upstream.");
    }
    const push = gitState.hasUpstream
      ? await this.runGitAction(project, { action: "push" })
      : gitState.hasOriginRemote
        ? await this.runGitAction(project, { action: "pushSetUpstream", branch })
        : undefined;
    if (!push) {
      throw new Error('Add an "origin" remote before pushing.');
    }
    if (push.exitCode !== 0) {
      throw new Error("Could not push branch.");
    }
  }

  private async syncCurrentBranchWithRemote(
    project: GxserverProjectDomainState,
    gitState: SidebarGitState,
  ): Promise<void> {
    const branch = gitState.branch;
    if (!branch) {
      throw new Error("Create and checkout a branch before syncing.");
    }
    if (gitState.hasUpstream) {
      const pull = await this.runGitAction(project, { action: "pullFastForward" });
      if (pull.exitCode !== 0) {
        throw new Error("Could not pull branch.");
      }
      const nextGitState = await this.refreshGitState({ force: true, project });
      if (nextGitState.aheadCount > 0) {
        await this.pushCurrentBranch(project, nextGitState);
      }
      return;
    }
    await this.pushCurrentBranch(project, gitState);
  }

  private async commitRemoteWithMessage(
    remoteScope: GpuiRemoteProjectScope,
    message: string,
    filePaths?: readonly string[],
    options: { agentId?: string; commitOnNewRef?: boolean } = {},
  ): Promise<void> {
    const parsedMessage = parseGpuiSidebarGitCommitMessage(message);
    let resolvedMessage = parsedMessage;
    if (parsedMessage.subject) {
      const addResult = await this.runRemoteGitAction(remoteScope, {
        action: "addAll",
        filePaths,
      });
      if (addResult.exitCode !== 0) {
        throw new Error("Could not stage remote changes.");
      }
    } else {
      resolvedMessage = await this.generateRemoteCommitMessage(
        remoteScope,
        filePaths,
        options.agentId,
      );
    }
    if (options.commitOnNewRef) {
      await this.checkoutRemoteSidebarGitFeatureBranch(remoteScope, resolvedMessage.subject);
    }
    const commitResult = await this.runRemoteGitAction(remoteScope, {
      action: "commit",
      messageBody: resolvedMessage.body,
      messageSubject: resolvedMessage.subject,
      noVerify: await this.shouldBypassRemoteMissingBeadsDatabasePreCommitHook(remoteScope),
    });
    if (commitResult.exitCode !== 0) {
      throw new Error("Could not commit remote changes.");
    }
  }

  private async checkoutRemoteSidebarGitFeatureBranch(
    remoteScope: GpuiRemoteProjectScope,
    subject: string,
  ): Promise<void> {
    const result = await this.requestRemoteGxserver<GxserverCheckoutProjectNewBranchResult>(
      remoteScope.machineId,
      "/api/checkoutProjectNewBranch",
      {
        branchLabel: subject,
        projectId: remoteScope.projectId,
      },
      { timeoutMs: 30_000 },
    );
    if (result.checkedOut !== true) {
      throw new Error("Could not create a new remote branch.");
    }
  }

  private async pushRemoteCurrentBranch(
    remoteScope: GpuiRemoteProjectScope,
    gitState: Pick<SidebarGitState, "branch" | "behindCount" | "hasOriginRemote" | "hasUpstream">,
  ): Promise<void> {
    const branch = gitState.branch;
    if (!branch) {
      throw new Error("Create and checkout a branch before pushing.");
    }
    if (gitState.behindCount > 0) {
      throw new Error("Remote branch is behind upstream.");
    }
    const push = gitState.hasUpstream
      ? await this.runRemoteGitAction(remoteScope, { action: "push" })
      : gitState.hasOriginRemote
        ? await this.runRemoteGitAction(remoteScope, { action: "pushSetUpstreamCurrent" })
        : undefined;
    if (!push) {
      throw new Error('Add an "origin" remote before pushing.');
    }
    if (push.exitCode !== 0) {
      throw new Error("Could not push remote branch.");
    }
  }

  private async syncRemoteCurrentBranchWithRemote(
    remoteScope: GpuiRemoteProjectScope,
    gitState: SidebarGitState,
  ): Promise<void> {
    const branch = gitState.branch;
    if (!branch) {
      throw new Error("Create and checkout a branch before syncing.");
    }
    if (gitState.hasUpstream) {
      const pull = await this.runRemoteGitAction(remoteScope, { action: "pullFastForward" });
      if (pull.exitCode !== 0) {
        throw new Error("Could not pull remote branch.");
      }
      const nextGitState = await this.readRemoteSidebarGitState(remoteScope);
      if (nextGitState.aheadCount > 0) {
        await this.pushRemoteCurrentBranch(remoteScope, nextGitState);
      }
      return;
    }
    await this.pushRemoteCurrentBranch(remoteScope, gitState);
  }

  private async shouldBypassRemoteMissingBeadsDatabasePreCommitHook(
    remoteScope: GpuiRemoteProjectScope,
  ): Promise<boolean> {
    const beadsStorage = await this.runRemoteBeadsAction(remoteScope, { action: "storageExists" });
    if (beadsStorage.exitCode !== 0 || beadsStorage.stdout.trim() !== "true") {
      return false;
    }
    try {
      const status = await this.runRemoteBeadsAction(remoteScope, { action: "status" });
      return status.exitCode !== 0 && isMissingGpuiBeadsDatabaseError(`${status.stderr}\n${status.stdout}`);
    } catch {
      return false;
    }
  }

  private async shouldBypassMissingBeadsDatabasePreCommitHook(
    project: GxserverProjectDomainState,
  ): Promise<boolean> {
    const beadsStorage = await this.runBeadsAction(project, { action: "storageExists" });
    if (beadsStorage.exitCode !== 0 || beadsStorage.stdout.trim() !== "true") {
      return false;
    }
    try {
      const status = await this.runBeadsAction(project, { action: "status" });
      return status.exitCode !== 0 && isMissingGpuiBeadsDatabaseError(`${status.stderr}\n${status.stdout}`);
    } catch {
      return false;
    }
  }

  private async runSidebarGitPromptAction(
    project: GxserverProjectDomainState,
    title: string,
    prompt: string,
    agentId?: string,
  ): Promise<void> {
    const gitState = await this.refreshGitState({
      force: true,
      project,
      publishBusy: true,
      toastOnFailure: true,
    });
    if (!gitState.isRepo) {
      this.postGitToast("warning", "Git unavailable", {
        description: "Open a Git repository to use this workflow.",
      });
      return;
    }
    const agent = this.resolveDefaultPromptAgent(agentId);
    if (!agent?.command?.trim()) {
      this.postGitToast("error", "Agent unavailable", {
        description: "Choose a configured prompt agent before starting this Git workflow.",
      });
      return;
    }
    await this.createAgentSessionForProject(
      project,
      agent,
      prompt,
      formatGpuiGitAgentWorkflowTitle(title),
    );
    this.postGitToast("success", "Git workflow started");
  }

  private async runRemoteSidebarGitPromptAction(
    remoteScope: GpuiRemoteProjectScope,
    title: string,
    prompt: string,
    agentId?: string,
  ): Promise<void> {
    const gitState = await this.readRemoteSidebarGitState(remoteScope);
    if (!gitState.isRepo) {
      this.postRemoteToast("warning", "Remote Git unavailable", {
        description: "Open a Git repository on the remote machine to use this workflow.",
      });
      return;
    }
    const resolvedAgentId = this.resolveDefaultPromptAgentId(agentId);
    try {
      await this.createRemoteAgentSessionForProject(
        remoteScope,
        resolvedAgentId,
        prompt,
        formatGpuiGitAgentWorkflowTitle(title),
      );
      this.postRemoteToast("success", "Remote Git workflow started");
    } catch {
      this.postRemoteToast("error", "Remote Git workflow failed", {
        description: "The remote gxserver could not start the selected prompt agent.",
      });
    }
  }

  private async runSidebarGitPullRequestAgentWorkflow(input: {
    agentId?: string;
    filePaths?: readonly string[];
    gitState: SidebarGitState;
    hasExplicitFileSelection: boolean;
    hasCommit: boolean;
    message: string;
    project: GxserverProjectDomainState;
  }): Promise<void> {
    const agent = this.resolveDefaultPromptAgent(input.agentId);
    if (!agent?.command?.trim()) {
      this.postGitToast("error", "Agent unavailable", {
        description: "Choose a configured prompt agent before creating a pull request.",
      });
      return;
    }
    /*
    CDXC:GPUISidebarGit 2026-06-24-16:45:
    Visible PR-agent workflows are for user-observable, non-delete PR creation only. The terminal session can report gxserver lifecycle/activity, but it cannot prove that `gh pr create` produced an open PR; delete-after cleanup must stay on the direct gxserver PR result path.
    */
    const prompt = buildGpuiGitPullRequestAgentPrompt({
      filePaths: input.filePaths,
      hasExplicitFileSelection: input.hasExplicitFileSelection,
      hasCommit: input.hasCommit,
      message: input.message.trim(),
      selectedFiles:
        input.filePaths && input.filePaths.length > 0
          ? input.filePaths
          : input.gitState.files.map((file) => file.path),
    });
    try {
      await this.createAgentSessionForProject(
        input.project,
        agent,
        prompt,
        formatGpuiGitAgentWorkflowTitle("Commit, Push & PR"),
      );
      this.postGitToast("success", "Pull request workflow started");
    } catch {
      this.postGitToast("error", "Pull request workflow failed", {
        description: "gxserver could not start the selected prompt agent.",
      });
    }
  }

  private async runRemoteSidebarGitPullRequestAgentWorkflow(input: {
    agentId?: string;
    filePaths?: readonly string[];
    gitState: SidebarGitState;
    hasExplicitFileSelection: boolean;
    hasCommit: boolean;
    message: string;
    remoteScope: GpuiRemoteProjectScope;
  }): Promise<void> {
    const resolvedAgentId = this.resolveDefaultPromptAgentId(input.agentId);
    const prompt = buildGpuiGitPullRequestAgentPrompt({
      filePaths: input.filePaths,
      hasExplicitFileSelection: input.hasExplicitFileSelection,
      hasCommit: input.hasCommit,
      message: input.message.trim(),
      selectedFiles:
        input.filePaths && input.filePaths.length > 0
          ? input.filePaths
          : input.gitState.files.map((file) => file.path),
    });
    try {
      await this.createRemoteAgentSessionForProject(
        input.remoteScope,
        resolvedAgentId,
        prompt,
        formatGpuiGitAgentWorkflowTitle("Commit, Push & PR"),
      );
      this.postRemoteToast("success", "Remote pull request workflow started");
    } catch {
      this.postRemoteToast("error", "Remote pull request workflow failed", {
        description: "The remote gxserver could not start the selected prompt agent.",
      });
    }
  }

  private async persistGitPreferences(
    updates: Partial<GpuiGitPreferences>,
    scopeMessage?: {
      groupId?: string;
      projectId?: string;
    },
  ): Promise<void> {
    const explicitScope = Boolean(scopeMessage?.groupId?.trim() || scopeMessage?.projectId?.trim());
    const remoteScope = this.resolveGitPreferenceRemoteScope(scopeMessage);
    if (remoteScope) {
      await this.persistRemoteGitPreferences(remoteScope, updates);
      return;
    }
    if (explicitScope && this.isGitPreferenceRemoteScope(scopeMessage)) {
      this.postRemoteToast("warning", "Remote Git preferences unavailable", {
        description: "Reconnect the remote machine before changing Git preferences.",
      });
      return;
    }

    const scopedProject = this.resolveGitPreferenceLocalProject(scopeMessage);
    if (explicitScope && !scopedProject) {
      this.postGitToast("warning", "Git preferences unavailable", {
        description: "Choose a current project before changing Git preferences.",
      });
      return;
    }
    const currentPreferences = this.gitPreferencesForProject(scopedProject ?? this.activeDomainProject());
    const nextPreferences: GpuiGitPreferences = {
      ...currentPreferences,
      ...updates,
      primaryAction: normalizeSidebarGitAction(updates.primaryAction ?? currentPreferences.primaryAction),
    };
    if (scopedProject && this.client) {
      const nextProject = await this.updateProjectDomainState(scopedProject.projectId, {
        gitConfig: {
          ...scopedProject.gitConfig,
          confirmCommit: nextPreferences.confirmCommit,
          generateCommitBody: nextPreferences.generateCommitBody,
          primaryAction: nextPreferences.primaryAction,
        },
      });
      if (this.activeProjectId === scopedProject.projectId || this.activeProjectId === nextProject?.projectId) {
        this.gitState = {
          ...this.gitState,
          confirmSuggestedCommit: nextPreferences.confirmCommit,
          generateCommitBody: nextPreferences.generateCommitBody,
          primaryAction: nextPreferences.primaryAction,
        };
        this.publishHudPatch();
      }
      return;
    }
    if (!this.client || this.domainProjects.length === 0) {
      this.gitState = {
        ...this.gitState,
        confirmSuggestedCommit: nextPreferences.confirmCommit,
        generateCommitBody: nextPreferences.generateCommitBody,
        primaryAction: nextPreferences.primaryAction,
      };
      this.publishHudPatch();
      return;
    }
    await Promise.all(
      this.domainProjects.map((project) =>
        this.updateProjectDomainState(project.projectId, {
          gitConfig: {
            ...project.gitConfig,
            confirmCommit: nextPreferences.confirmCommit,
            generateCommitBody: nextPreferences.generateCommitBody,
            primaryAction: nextPreferences.primaryAction,
          },
        }),
      ),
    );
    this.gitState = {
      ...this.gitState,
      confirmSuggestedCommit: nextPreferences.confirmCommit,
      generateCommitBody: nextPreferences.generateCommitBody,
      primaryAction: nextPreferences.primaryAction,
    };
    this.publishHudPatch();
  }

  private resolveGitPreferenceRemoteScope(scopeMessage?: {
    groupId?: string;
    projectId?: string;
  }): GpuiRemoteProjectScope | undefined {
    if (!scopeMessage) {
      return undefined;
    }
    if (scopeMessage.groupId && parseGpuiRemotePresentationGroupId(scopeMessage.groupId)) {
      return this.resolveRemotePresentationProjectScope({ groupId: scopeMessage.groupId });
    }
    const remoteProject = scopeMessage.projectId
      ? parseGpuiRemotePresentationProjectId(scopeMessage.projectId)
      : undefined;
    return remoteProject ? this.resolveRemotePresentationProjectScope(remoteProject) : undefined;
  }

  private isGitPreferenceRemoteScope(scopeMessage?: {
    groupId?: string;
    projectId?: string;
  }): boolean {
    return Boolean(
      (scopeMessage?.groupId && parseGpuiRemotePresentationGroupId(scopeMessage.groupId)) ||
        (scopeMessage?.projectId && parseGpuiRemotePresentationProjectId(scopeMessage.projectId)),
    );
  }

  private resolveGitPreferenceLocalProject(scopeMessage?: {
    groupId?: string;
    projectId?: string;
  }): GxserverProjectDomainState | undefined {
    if (scopeMessage?.groupId) {
      const projectId = this.resolveProjectIdForGroup(scopeMessage.groupId);
      return projectId ? this.domainProjectById(projectId) : undefined;
    }
    if (scopeMessage?.projectId) {
      return this.domainProjectById(scopeMessage.projectId);
    }
    return undefined;
  }

  private async persistRemoteGitPreferences(
    remoteScope: GpuiRemoteProjectScope,
    updates: Partial<GpuiGitPreferences>,
  ): Promise<void> {
    const currentPreferences = this.gitPreferencesForPresentationProject(
      this.findRemotePresentationProject(remoteScope) ?? remoteScope.project,
    );
    const nextPreferences: GpuiGitPreferences = {
      ...currentPreferences,
      ...updates,
      primaryAction: normalizeSidebarGitAction(updates.primaryAction ?? currentPreferences.primaryAction),
    };
    /*
    CDXC:GPUIRemoteGit 2026-06-24-18:22:
    Remote Git preference writes use only the selected machine id, gxserver project id, and the three known preference keys. Rust owns the tunnel and response shaping; the renderer never sends paths, labels, branch names, command text, URLs, tokens, stdout/stderr, or raw daemon bodies as write authority.
    */
    try {
      const response = await this.requestRemoteGxserver<{
        project?: GxserverPresentationProject;
      }>(
        remoteScope.machineId,
        "/api/updateProject",
        {
          gitConfig: {
            confirmCommit: nextPreferences.confirmCommit,
            generateCommitBody: nextPreferences.generateCommitBody,
            primaryAction: nextPreferences.primaryAction,
          },
          projectId: remoteScope.projectId,
        },
      );
      if (response.project) {
        this.upsertRemotePresentationProject(remoteScope.machineId, response.project);
      } else {
        await this.refreshRemotePresentationFromGxserver(remoteScope.machineId).catch(() => undefined);
      }
      if (this.activeGroupId === createGpuiRemotePresentationGroupId(remoteScope.machineId, remoteScope.projectId)) {
        this.gitState = {
          ...this.gitState,
          confirmSuggestedCommit: nextPreferences.confirmCommit,
          generateCommitBody: nextPreferences.generateCommitBody,
          primaryAction: nextPreferences.primaryAction,
        };
      }
      this.publishRemotePresentationPatch();
    } catch {
      this.postRemoteToast("warning", "Remote Git preferences unavailable", {
        description: "The remote gxserver could not save that Git preference.",
      });
    }
  }

  private resolveGitProjectForMessage(
    message: Extract<SidebarToExtensionMessage, { type: "runSidebarGitAction" }>,
  ): GxserverProjectDomainState | undefined {
    const projectId = message.groupId
      ? this.resolveProjectIdForGroup(message.groupId)
      : message.projectId ?? this.activeProjectId;
    const project = projectId ? this.domainProjectById(projectId) : this.activeDomainProject();
    if (project && this.activeProjectId !== project.projectId) {
      this.focusProjectId(project.projectId);
      this.publishPresentation("patch");
    }
    return project;
  }

  private gitStateForHud(): SidebarGitState {
    const preferences = this.gitPreferencesForProject(this.activeDomainProject());
    return {
      ...this.gitState,
      confirmSuggestedCommit: preferences.confirmCommit,
      generateCommitBody: preferences.generateCommitBody,
      primaryAction: preferences.primaryAction,
    };
  }

  private gitPreferencesForProject(
    project: GxserverProjectDomainState | undefined,
  ): GpuiGitPreferences {
    return {
      confirmCommit: booleanFromRecord(project?.gitConfig, "confirmCommit") ?? false,
      generateCommitBody: booleanFromRecord(project?.gitConfig, "generateCommitBody") ?? true,
      primaryAction: normalizeSidebarGitAction(stringFromRecord(project?.gitConfig, "primaryAction")),
    };
  }

  private gitPreferencesForPresentationProject(
    project: GxserverPresentationProject | undefined,
  ): GpuiGitPreferences {
    return {
      confirmCommit: booleanFromRecord(project?.gitConfig, "confirmCommit") ?? false,
      generateCommitBody: booleanFromRecord(project?.gitConfig, "generateCommitBody") ?? true,
      primaryAction: normalizeSidebarGitAction(stringFromRecord(project?.gitConfig, "primaryAction")),
    };
  }

  private resolveDefaultPromptAgent(agentId?: string): SidebarAgentButton | undefined {
    const requestedAgentId = this.resolveDefaultPromptAgentId(agentId);
    return this.resolveSidebarAgent(requestedAgentId);
  }

  private resolveDefaultPromptAgentId(agentId?: string): string {
    return (
      agentId?.trim() ||
      this.latestHud.settings?.defaultPromptAgentId?.trim() ||
      DEFAULT_GPUI_PROMPT_AGENT_ID
    );
  }

  private async runGitAction(
    project: GxserverProjectDomainState,
    params: Record<string, unknown>,
  ): Promise<GxserverTypedOperationResult> {
    if (!this.client) {
      throw new Error("gxserver is unavailable.");
    }
    return this.client.rpc<GxserverTypedOperationResult>("/api/runGitAction", {
      ...params,
      projectId: project.projectId,
    });
  }

  private async runRemoteGitAction(
    remoteScope: GpuiRemoteProjectReference,
    params: Record<string, unknown>,
  ): Promise<GxserverTypedOperationResult> {
    return this.requestRemoteGxserver<GxserverTypedOperationResult>(
      remoteScope.machineId,
      "/api/runGitAction",
      {
        ...params,
        projectId: remoteScope.projectId,
      },
    );
  }

  private async runGitHubAction(
    project: GxserverProjectDomainState,
    params: Record<string, unknown>,
  ): Promise<GxserverTypedOperationResult> {
    if (!this.client) {
      throw new Error("gxserver is unavailable.");
    }
    return this.client.rpc<GxserverTypedOperationResult>("/api/runGitHubAction", {
      ...params,
      projectId: project.projectId,
    });
  }

  private async runRemoteGitHubAction(
    remoteScope: GpuiRemoteProjectReference,
    params: Record<string, unknown>,
  ): Promise<GxserverTypedOperationResult> {
    return this.requestRemoteGxserver<GxserverTypedOperationResult>(
      remoteScope.machineId,
      "/api/runGitHubAction",
      {
        ...params,
        projectId: remoteScope.projectId,
      },
    );
  }

  private async createPullRequest(
    project: GxserverProjectDomainState,
  ): Promise<GxserverCreatePullRequestResult> {
    if (!this.client) {
      throw new Error("gxserver is unavailable.");
    }
    /*
    CDXC:GPUISidebarGit 2026-06-24-16:28:
    Direct GPUI PR creation must use a gxserver completion result before opening
    the PR or deleting a worktree. The renderer sends only the trusted project
    id; gxserver owns `gh pr create --fill`, current-branch PR lookup, and
    validated state/URL return data.
    */
    return this.client.rpc<GxserverCreatePullRequestResult>("/api/createPullRequest", {
      projectId: project.projectId,
    });
  }

  private async createRemotePullRequest(
    remoteScope: GpuiRemoteProjectReference,
  ): Promise<GpuiRemoteCreatePullRequestResult> {
    return this.requestRemoteGxserver<GpuiRemoteCreatePullRequestResult>(
      remoteScope.machineId,
      "/api/createPullRequest",
      {
        projectId: remoteScope.projectId,
      },
      { timeoutMs: 45_000 },
    );
  }

  private async runBeadsAction(
    project: GxserverProjectDomainState,
    params: Record<string, unknown>,
  ): Promise<GxserverTypedOperationResult> {
    if (!this.client) {
      throw new Error("gxserver is unavailable.");
    }
    return this.client.rpc<GxserverTypedOperationResult>("/api/runBeadsAction", {
      ...params,
      projectId: project.projectId,
    });
  }

  private async runRemoteBeadsAction(
    remoteScope: GpuiRemoteProjectReference,
    params: Record<string, unknown>,
  ): Promise<GxserverTypedOperationResult> {
    return this.requestRemoteGxserver<GxserverTypedOperationResult>(
      remoteScope.machineId,
      "/api/runBeadsAction",
      {
        ...params,
        projectId: remoteScope.projectId,
      },
      { timeoutMs: 60_000 },
    );
  }

  private async runRemoteGitMutation(
    remoteScope: GpuiRemoteProjectScope,
    startedTitle: string,
    finishedTitle: string,
    operation: () => Promise<void>,
  ): Promise<boolean> {
    const toastId = createGpuiGitToastId();
    this.postGitToast("info", startedTitle, { persistent: true, toastId });
    try {
      await operation();
      await this.refreshRemotePresentationFromGxserver(remoteScope.machineId).catch(() => undefined);
      this.postGitToast("success", finishedTitle, { toastId });
      return true;
    } catch (error) {
      this.postGitToast("error", `${startedTitle} failed`, {
        description: gpuiUserVisibleGitErrorMessage(error, "Remote gxserver Git operation failed."),
        toastId,
      });
      return false;
    }
  }

  private postGitToast(
    level: AppToastLevel,
    title: string,
    options: {
      description?: string;
      persistent?: boolean;
      toastId?: string;
    } = {},
  ): void {
    try {
      postAppModalHostMessage(
        createAppToastRequest(level, title, options.description, {
          persistent: options.persistent,
          toastId: options.toastId,
        }),
        "AppModals:gpuiGitToast",
      );
    } catch {
      /*
      CDXC:GPUISidebarGit 2026-06-24-15:22:
      Git mutations and agent workflows must not depend on toast-host availability. Missing toast presentation is not a reason to fake success or skip gxserver-owned Git state changes.
      */
    }
  }

  private postAppShotToast(
    level: AppToastLevel,
    title: string,
    options: {
      description?: string;
    } = {},
  ): void {
    try {
      postAppModalHostMessage(
        createAppToastRequest(level, title, options.description),
        "AppModals:gpuiAppShotToast",
      );
    } catch {
      /*
      CDXC:GPUIAppShots 2026-06-25-23:07:
      App Shots user feedback must not depend on toast-host availability and must not log raw app names, window titles, image paths, project paths, command text, terminal content, URLs, or tokens when presentation is unavailable.
      */
    }
  }

  private reconnectRemoteMachine(remoteMachineId: string, installApproved: boolean): void {
    try {
      postAppModalHostMessage(
        {
          installApproved,
          remoteMachineId,
          type: "reconnectRemoteMachine",
        },
        "GPUISidebarRemoteMachines:reconnect",
      );
      this.messageSource.postMessage({
        machineId: remoteMachineId,
        state: "connecting",
        type: "remoteMachineStatus",
      });
    } catch {
      this.postRemoteToast("warning", "Remote connect unavailable", {
        description: "GPUI could not reach the native remote-machine bridge.",
      });
    }
  }

  private openRemoteCloneRepository(remoteMachineId: string): void {
    /*
    CDXC:RemoteClone 2026-06-24-19:35:
    GPUI remote machine headers reuse the shared Clone Repository modal, but only after the selected machine has a live Rust-delivered gxserver presentation. The renderer may carry the saved machine id/name into the modal; clone preview, Git execution, project registration, and presentation refresh remain Rust/remote-gxserver owned.
    */
    const normalizedMachineId = remoteMachineId.trim();
    if (!normalizedMachineId || !this.remotePresentations.has(normalizedMachineId)) {
      this.postRemoteToast("warning", "Remote clone unavailable", {
        description: "Reconnect the remote machine before cloning a repository.",
      });
      return;
    }
    try {
      openAppModal({
        modal: "addRepository",
        remoteMachineId: normalizedMachineId,
        remoteMachineName: this.remoteMachineName(normalizedMachineId) ?? "Remote",
        type: "open",
      });
    } catch {
      this.postRemoteToast("warning", "Remote clone unavailable", {
        description: "GPUI could not open the shared Clone Repository modal.",
      });
    }
  }

  private requestRemoteGxserver<TResult = unknown>(
    remoteMachineId: string,
    path: GxserverEndpointPath,
    params: Record<string, unknown>,
    options: { timeoutMs?: number } = {},
  ): Promise<TResult> {
    const requestId = `remote-${Date.now().toString(36)}-${++this.remoteGxserverRequestSequence}`;
    const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 20_000, 1_000), 130_000);
    return new Promise<TResult>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pendingRemoteGxserverRequests.delete(requestId);
        reject(new Error("Remote gxserver request timed out."));
      }, timeoutMs + 2_000);
      this.pendingRemoteGxserverRequests.set(requestId, {
        reject,
        resolve: (result) => resolve(result as TResult),
        timeoutId,
      });
      try {
        /*
        CDXC:GPUIRemoteMachines 2026-06-24-17:19:
        Response-capable remote sidebar RPCs still carry only a bounded request id plus the allowlisted endpoint params into Rust. Rust owns the live tunnel, token, endpoint allowlist, response sanitization, and presentation refresh; renderer code must not receive tokens, SSH details, command text, URLs, or raw daemon bodies.
        */
        postAppModalHostMessage(
          {
            params,
            path,
            remoteMachineId,
            requestId,
            timeoutMs,
            type: "gpuiRemoteGxserverSidebarRequest",
          },
          "GPUISidebarRemoteMachines:request",
        );
      } catch (error) {
        window.clearTimeout(timeoutId);
        this.pendingRemoteGxserverRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error("Remote gxserver bridge failed."));
      }
    });
  }

  private resolveRemoteGxserverRequest(
    event: GpuiSidebarRemoteGxserverResponseEvent,
  ): void {
    const pending = this.pendingRemoteGxserverRequests.get(event.requestId);
    if (!pending) {
      return;
    }
    window.clearTimeout(pending.timeoutId);
    this.pendingRemoteGxserverRequests.delete(event.requestId);
    if (event.ok) {
      pending.resolve(event.result);
      return;
    }
    pending.reject(new Error(event.error || "Remote gxserver request failed."));
  }

  private postRemoteGxserverSidebarRequest(
    remoteMachineId: string,
    path: GxserverEndpointPath,
    params: Record<string, unknown>,
  ): void {
    try {
      postAppModalHostMessage(
        {
          params,
          path,
          remoteMachineId,
          type: "gpuiRemoteGxserverSidebarRequest",
        },
        "GPUISidebarRemoteMachines:request",
      );
    } catch {
      this.postRemoteToast("warning", "Remote action unavailable", {
        description: "GPUI could not reach the native remote gxserver bridge.",
      });
    }
  }

  private findRemotePresentationSession(reference: {
    machineId: string;
    projectId: string;
    sessionId: string;
  }): GxserverPresentationSession | undefined {
    return this.remotePresentations
      .get(reference.machineId)
      ?.sessions.find(
        (session) =>
          session.projectId === reference.projectId &&
          session.sessionId === reference.sessionId,
      );
  }

  private postRemoteToast(
    level: AppToastLevel,
    title: string,
    options: { description?: string } = {},
  ): void {
    try {
      postAppModalHostMessage(
        createAppToastRequest(level, title, options.description),
        "GPUISidebarRemoteMachines:toast",
      );
    } catch {
      /*
      CDXC:GPUIRemoteMachines 2026-06-24-16:48:
      Remote-machine operations must never depend on toast-host availability. If the shared app-modal toast bridge is missing, keep the native-owned request/status path honest and avoid logging payloads, SSH details, tokens, paths, daemon responses, or renderer contents.
      */
    }
  }

  private resolveRemotePresentationProjectScope(input: {
    groupId?: string;
    projectId?: string;
    remoteMachineId?: string;
  } | GpuiRemoteProjectReference): GpuiRemoteProjectScope | undefined {
    const groupReference = "groupId" in input && input.groupId
      ? parseGpuiRemotePresentationGroupId(input.groupId)
      : undefined;
    const projectReference = !groupReference && "projectId" in input && input.projectId
      ? parseGpuiRemotePresentationProjectId(input.projectId)
      : undefined;
    const machineId =
      groupReference?.machineId ??
      projectReference?.machineId ??
      ("remoteMachineId" in input ? input.remoteMachineId?.trim() : undefined) ??
      ("machineId" in input ? input.machineId : undefined);
    const projectId =
      groupReference?.projectId ??
      projectReference?.projectId ??
      ("projectId" in input ? input.projectId?.trim() : undefined);
    if (!machineId || !projectId) {
      return undefined;
    }
    const presentation = this.remotePresentations.get(machineId);
    const project = presentation?.projects.find((candidate) => candidate.projectId === projectId);
    if (!project) {
      return undefined;
    }
    return {
      machineId,
      machineName: this.remoteMachineName(machineId),
      project,
      projectId,
    };
  }

  private findRemotePresentationProject(
    reference: GpuiRemoteProjectReference,
  ): GxserverPresentationProject | undefined {
    return this.remotePresentations
      .get(reference.machineId)
      ?.projects.find((project) => project.projectId === reference.projectId);
  }

  private upsertRemotePresentationProject(
    remoteMachineId: string,
    nextProject: GxserverPresentationProject,
  ): void {
    const presentation = this.remotePresentations.get(remoteMachineId);
    if (!presentation) {
      return;
    }
    const existingIndex = presentation.projects.findIndex(
      (project) => project.projectId === nextProject.projectId,
    );
    const projects =
      existingIndex >= 0
        ? presentation.projects.map((project, index) =>
            index === existingIndex ? nextProject : project,
          )
        : [...presentation.projects, nextProject];
    this.remotePresentations.set(remoteMachineId, {
      ...presentation,
      projects,
    });
  }

  private removeRemotePresentationProject(remoteMachineId: string, projectId: string): void {
    const presentation = this.remotePresentations.get(remoteMachineId);
    if (!presentation) {
      return;
    }
    this.remotePresentations.set(remoteMachineId, {
      ...presentation,
      groups: presentation.groups.filter((group) => group.projectId !== projectId),
      projects: presentation.projects.filter((project) => project.projectId !== projectId),
      sessions: presentation.sessions.filter((session) => session.projectId !== projectId),
    });
  }

  private remoteMachineName(machineId: string): string | undefined {
    return createGpuiSidebarSettings(this.runtimeSettings).remoteMachines
      .find((machine) => machine.id === machineId)
      ?.name;
  }

  private resolveRemoteWorktreeFamilyParentProjectFromPresentation(
    sourceProject: GpuiRemoteProjectScope,
  ): GpuiRemoteProjectScope | undefined {
    const parentProjectId = normalizeGpuiWorktreeParentProjectId(sourceProject.project.worktree);
    if (!parentProjectId) {
      return sourceProject;
    }
    const parentProject = this.remotePresentations
      .get(sourceProject.machineId)
      ?.projects.find((project) => project.projectId === parentProjectId);
    return parentProject
      ? {
          machineId: sourceProject.machineId,
          machineName: sourceProject.machineName,
          project: parentProject,
          projectId: parentProject.projectId,
      }
      : undefined;
  }

  private isTrustedRemoteExistingWorktreeKey(
    worktreeKey: string,
    sourceProject: GpuiRemoteProjectScope,
  ): boolean {
    const trusted = this.trustedExistingWorktreeList;
    return Boolean(
      trusted &&
        trusted.remoteMachineId === sourceProject.machineId &&
        trusted.sourceProjectId === sourceProject.projectId &&
        trusted.worktreeKeys?.has(worktreeKey.trim()),
    );
  }

  private async resolveRemoteWorktreeMutationProject(
    remoteMachineId: string,
    project: GxserverPresentationProject | undefined,
  ): Promise<GxserverPresentationProject> {
    if (!project?.projectId) {
      throw new Error("Remote gxserver did not return a worktree project.");
    }
    this.upsertRemotePresentationProject(remoteMachineId, project);
    this.publishRemotePresentationPatch();
    await this.refreshRemotePresentationFromGxserver(remoteMachineId).catch(() => undefined);
    return (
      this.findRemotePresentationProject({
        machineId: remoteMachineId,
        projectId: project.projectId,
      }) ?? project
    );
  }

  private async refreshRemotePresentationFromGxserver(remoteMachineId: string): Promise<void> {
    const response = await this.requestRemoteGxserver<{ snapshot?: unknown }>(
      remoteMachineId,
      "/api/readPresentationSnapshot",
      {},
    );
    if (isPresentationSnapshot(response.snapshot)) {
      this.remotePresentations.set(remoteMachineId, response.snapshot);
      this.publishPresentation("patch");
    }
  }

  private async registerDomainProjectPath(
    project: GxserverProjectDomainState,
  ): Promise<GxserverProjectDomainState> {
    const path = normalizeGpuiProjectPath(project.path);
    if (!path) {
      throw new Error("Project has no registered path.");
    }
    return this.registerProjectPath({
      name: project.name || gpuiProjectNameFromPath(path),
      path,
    });
  }

  private async registerProjectPath(input: {
    name: string;
    path: string;
  }): Promise<GxserverProjectDomainState> {
    if (!this.client) {
      throw new Error("gxserver is unavailable.");
    }
    const response = await this.client.rpc<{ project: GxserverProjectDomainState }>(
      "/api/addProjectPath",
      {
        name: input.name,
        path: input.path,
      },
    );
    this.upsertDomainProject(response.project);
    return response.project;
  }

  private async ensureWorktreeBeadsHooks(
    project: GxserverProjectDomainState,
  ): Promise<void> {
    if (!this.client) {
      throw new Error("gxserver is unavailable.");
    }
    const result = await this.client.rpc<GxserverTypedOperationResult>(
      "/api/runWorktreeAction",
      {
        action: "ensureBeadsHooks",
        projectId: project.projectId,
      },
    );
    if (result.exitCode !== 0) {
      throw new Error("Could not prepare Beads hooks for this worktree.");
    }
  }

  private async runWorktreeSetupCommandIfConfigured(
    worktreeProject: GxserverProjectDomainState,
    setupCommandProject: GxserverProjectDomainState,
  ): Promise<void> {
    const setupCommand = stringFromRecord(setupCommandProject.gitConfig, "worktreeCommand");
    if (!setupCommand || !this.client) {
      return;
    }
    const result = await this.client.rpc<GxserverTypedOperationResult>(
      "/api/runProjectSetupCommand",
      {
        action: "worktreeSetupCommand",
        projectId: worktreeProject.projectId,
        setupCommandProjectId: setupCommandProject.projectId,
      },
    );
    if (result.exitCode !== 0) {
      throw new Error("Worktree setup command failed.");
    }
  }

  private async createAgentSessionForProject(
    project: GxserverProjectDomainState,
    agent: SidebarAgentButton,
    prompt: string,
    title = createAgentSessionDefaultTitle(agent.name),
  ): Promise<string> {
    if (!this.client) {
      throw new Error("gxserver is unavailable.");
    }
    const response = await this.client.rpc<{
      session?: { sessionId?: string };
    }>("/api/createAgentSession", {
      agentId: agent.agentId,
      launchSettings: {
        agentCommand: agent.command,
        icon: agent.icon,
      },
      projectId: project.projectId,
      runtimeSettings: {
        firstUserMessage: prompt,
      },
      surface: "workspace",
      title,
    });
    const sessionId = response.session?.sessionId?.trim();
    if (!sessionId) {
      throw new Error("Could not create an agent session in the worktree.");
    }
    this.focusLocalWorkspaceSession(project.projectId, sessionId);
    return sessionId;
  }

  private async createRemoteAgentSessionForProject(
    remoteScope: GpuiRemoteProjectReference,
    agentId: string,
    prompt: string,
    title: string,
  ): Promise<void> {
    const response = await this.requestRemoteGxserver<GpuiGxserverCreatedSessionResult>(
      remoteScope.machineId,
      "/api/createAgentSession",
      {
        agentId,
        projectId: remoteScope.projectId,
        requireLaunchCommand: true,
        runtimeSettings: {
          firstUserMessage: prompt,
        },
        surface: "workspace",
        title,
      },
      { timeoutMs: 20_000 },
    );
    const sessionId = normalizeNonEmptyString(response.session?.sessionId);
    if (sessionId) {
      this.setRemotePresentationSessionFocus({
        machineId: remoteScope.machineId,
        projectId: normalizeNonEmptyString(response.session?.projectId) ?? remoteScope.projectId,
        sessionId,
      });
    }
    await this.refreshRemotePresentationFromGxserver(remoteScope.machineId).catch(() => undefined);
  }

  private async resolveUniqueWorktreeTarget(
    project: GxserverProjectDomainState,
    prompt: string,
  ): Promise<{ branch: string; name: string; path: string }> {
    if (!this.client) {
      throw new Error("gxserver is unavailable.");
    }
    const sourcePath = normalizeGpuiProjectPath(project.path);
    if (!sourcePath) {
      throw new Error("Project has no registered path.");
    }
    const parentDirectory = gpuiDirname(sourcePath);
    const projectFolderName = gpuiProjectNameFromPath(sourcePath);
    const baseSlug = gpuiWorktreeSlugFromPrompt(prompt);
    const registeredPaths = new Set(
      this.domainProjects
        .map((candidate) => normalizeGpuiProjectPath(candidate.path))
        .filter((path): path is string => Boolean(path)),
    );
    for (let index = 0; index < 50; index += 1) {
      const name = index === 0 ? baseSlug : `${baseSlug}-${index + 1}`;
      const branch = name;
      const path = `${parentDirectory}/${projectFolderName}-${name}`;
      const [branchCheck, pathCheck] = await Promise.all([
        this.client.rpc<GxserverTypedOperationResult>("/api/runGitAction", {
          action: "verifyRef",
          projectId: project.projectId,
          ref: `refs/heads/${branch}`,
        }),
        this.client.rpc<GxserverTypedOperationResult>("/api/runWorktreeAction", {
          action: "pathExists",
          projectId: project.projectId,
          worktreePath: path,
        }),
      ]);
      if (branchCheck.exitCode !== 0 && pathCheck.exitCode !== 0 && !registeredPaths.has(path)) {
        return { branch, name, path };
      }
    }
    throw new Error("Could not find an unused worktree name.");
  }

  private async saveSidebarAgent(
    message: Extract<SidebarToExtensionMessage, { type: "saveSidebarAgent" }>,
  ): Promise<void> {
    const name = message.name.trim();
    const command = message.command.trim();
    if (!name || !command || !this.client || this.domainProjects.length === 0) {
      return;
    }
    await this.mutateSidebarHudSettings({
      acceptAllMode: message.acceptAllMode,
      activeProjectId: this.activeProjectId,
      agentId: message.agentId,
      command,
      icon: message.icon,
      name,
      operation: "save",
      target: "agent",
    });
  }

  private async deleteSidebarAgent(agentId: string): Promise<void> {
    if (!this.client || this.domainProjects.length === 0) {
      return;
    }
    await this.mutateSidebarHudSettings({
      activeProjectId: this.activeProjectId,
      agentId,
      operation: "delete",
      target: "agent",
    });
  }

  private async syncSidebarAgentOrder(
    requestId: string,
    agentIds: readonly string[],
  ): Promise<void> {
    if (!this.client) {
      return;
    }
    const result = await this.mutateSidebarHudSettings({
      activeProjectId: this.activeProjectId,
      agentIds,
      operation: "order",
      target: "agent",
    });
    this.messageSource.postMessage({
      itemIds: result?.itemIds ?? [],
      kind: "agent",
      requestId,
      status: "success",
      type: "sidebarOrderSyncResult",
    });
  }

  private async saveSidebarCommand(
    message: Extract<SidebarToExtensionMessage, { type: "saveSidebarCommand" }>,
  ): Promise<void> {
    const project = this.activeDomainProject();
    if (!project || !this.client) {
      return;
    }
    const name = message.name.trim();
    const command = message.command?.trim();
    const url = message.url?.trim();
    if (!name && !message.icon) {
      return;
    }
    if (message.actionType === "browser" && !url) {
      return;
    }
    if (message.actionType === "terminal" && !command) {
      return;
    }
    await this.mutateSidebarHudSettings({
      actionType: message.actionType,
      activeProjectId: project.projectId,
      closeTerminalOnExit: message.actionType === "terminal" ? message.closeTerminalOnExit : false,
      command,
      commandId: message.commandId,
      icon: message.icon,
      name,
      playCompletionSound: message.actionType === "terminal" ? message.playCompletionSound : false,
      operation: "save",
      target: "command",
      url,
    });
  }

  private async deleteSidebarCommand(commandId: string): Promise<void> {
    const project = this.activeDomainProject();
    if (!project || !this.client) {
      return;
    }
    await this.mutateSidebarHudSettings({
      activeProjectId: project.projectId,
      commandId,
      operation: "delete",
      target: "command",
    });
  }

  private async syncSidebarCommandOrder(
    requestId: string,
    commandIds: readonly string[],
  ): Promise<void> {
    const project = this.activeDomainProject();
    if (!project || !this.client) {
      return;
    }
    const result = await this.mutateSidebarHudSettings({
      activeProjectId: project.projectId,
      commandIds,
      operation: "order",
      target: "command",
    });
    this.messageSource.postMessage({
      itemIds: result?.itemIds ?? [],
      kind: "command",
      requestId,
      status: "success",
      type: "sidebarOrderSyncResult",
    });
  }

  private pickWorkspaceFolder(originalMessage: SidebarToExtensionMessage): void {
    try {
      postAppModalHostMessage(
        { type: "pickWorkspaceFolder" },
        "GPUISidebarWorkspaceProjects:pickWorkspaceFolder",
      );
    } catch {
      this.handleUnsupportedSidebarMessage(originalMessage);
    }
  }

  private async handleGpuiWorkspaceFolderPicked(payload: unknown): Promise<void> {
    const pick = normalizeGpuiWorkspaceFolderPick(payload);
    if (!pick) {
      return;
    }
    if (!this.client) {
      this.postSidebarActionToast("error", "Add Project failed", {
        description: "gxserver is not connected.",
      });
      return;
    }
    try {
      const response = await this.client.rpc<{ project?: GxserverProjectDomainState }>(
        "/api/addProjectPath",
        pick.name ? { name: pick.name, path: pick.path } : { path: pick.path },
      );
      const project = response.project;
      if (!project) {
        throw new Error("gxserver did not return the added project.");
      }
      this.upsertDomainProject(project);
      this.focusProjectId(project.projectId);
      await this.refreshDomainPresentationSnapshotFromClient("patch").catch(() => {
        this.publishHudPatch();
      });
    } catch {
      this.postSidebarActionToast("error", "Add Project failed", {
        description: "Ghostex could not add the selected folder.",
      });
    }
  }

  private postSidebarActionToast(
    level: AppToastLevel,
    title: string,
    options: { description?: string } = {},
  ): void {
    try {
      postAppModalHostMessage(
        createAppToastRequest(level, title, options.description),
        "GPUISidebarActions:toast",
      );
    } catch {
      // Toast-host availability must never gate the underlying action.
    }
  }

  private async removeProject(projectId: string): Promise<void> {
    const remoteReference = parseGpuiRemotePresentationProjectId(projectId);
    if (remoteReference) {
      await this.removeRemoteProject(remoteReference);
      return;
    }
    if (!this.client) {
      return;
    }
    await this.client.rpc("/api/removeProject", {
      projectId,
    });
  }

  private async restoreRecentProject(projectId: string): Promise<void> {
    const remoteReference = parseGpuiRemotePresentationProjectId(projectId);
    if (remoteReference) {
      await this.restoreRemoteRecentProject(remoteReference);
      return;
    }
    if (!this.client) {
      return;
    }
    const response = await this.client.rpc<{
      project?: GxserverProjectDomainState;
      recentProjects: GxserverRecentProjectDomainState[];
    }>("/api/restoreRecentProject", {
      projectId,
    });
    /*
    CDXC:GPUIRecentProjects 2026-06-25-19:22:
    Local Recent Project restore must mirror macOS by treating `/api/restoreRecentProject` as the authoritative recent-row mutation, activating the restored local project id, and applying a fresh gxserver presentation so the normal group returns promptly without synthesized drawer rows.
    */
    if (response.project) {
      this.upsertDomainProject(response.project);
    }
    this.recentProjects = [...response.recentProjects];
    this.focusProjectId(projectId);
    await this.refreshDomainPresentationSnapshotFromClient("patch").catch(() => {
      this.publishHudPatch();
    });
  }

  private async removeRecentProject(projectId: string): Promise<void> {
    const remoteReference = parseGpuiRemotePresentationProjectId(projectId);
    if (remoteReference) {
      await this.removeRemoteRecentProject(remoteReference);
      return;
    }
    if (!this.client) {
      return;
    }
    const response = await this.client.rpc<{
      recentProjects: GxserverRecentProjectDomainState[];
    }>("/api/removeRecentProject", {
      projectId,
    });
    this.domainProjects = this.domainProjects.filter(
      (project) => project.projectId !== projectId,
    );
    this.recentProjects = [...response.recentProjects];
    this.publishHudPatch();
  }

  private async closeRemoteProjectForGroup(
    remoteScope: GpuiRemoteProjectScope,
    groupId: string,
  ): Promise<void> {
    /*
    CDXC:GPUIRemoteProjects 2026-06-27-19:37:
    Remote Recent Projects are client-app state, not local Mac gxserver state
    and not the remote daemon's shared project state. GPUI parks a
    machine-scoped row in its own CEF storage so macOS and GPUI can connect to
    and organize the same remote machine independently.
    */
    const presentation = this.remotePresentations.get(remoteScope.machineId);
    const recentProject: GxserverRecentProjectDomainState = {
      path: remoteScope.project.path ?? "",
      projectId: remoteScope.projectId as GxserverProjectId,
      recentClosedAt: new Date().toISOString(),
      sessionCount: presentation
        ? countGpuiRemotePresentationProjectSessions(presentation, remoteScope.projectId)
        : 0,
      title: remoteScope.project.title,
    };
    const previousProjects = this.remoteRecentProjectsByMachineId.get(remoteScope.machineId) ?? [];
    this.remoteRecentProjectsByMachineId.set(
      remoteScope.machineId,
      orderGpuiRecentProjects([
        recentProject,
        ...previousProjects.filter((project) => project.projectId !== remoteScope.projectId),
      ]),
    );
    writeStoredGpuiRemoteRecentProjects(this.remoteRecentProjectsByMachineId);
    if (this.activeGroupId === groupId) {
      this.activeGroupId = undefined;
    }
    this.publishRemotePresentationPatch();
  }

  private async restoreRemoteRecentProject(
    remoteReference: GpuiRemoteProjectReference,
  ): Promise<void> {
    this.remoteRecentProjectsByMachineId.set(
      remoteReference.machineId,
      (this.remoteRecentProjectsByMachineId.get(remoteReference.machineId) ?? []).filter(
        (project) => project.projectId !== remoteReference.projectId,
      ),
    );
    writeStoredGpuiRemoteRecentProjects(this.remoteRecentProjectsByMachineId);
    this.activeGroupId = createGpuiRemotePresentationGroupId(
      remoteReference.machineId,
      remoteReference.projectId,
    );
    if (!this.remotePresentations.has(remoteReference.machineId)) {
      this.reconnectRemoteMachine(remoteReference.machineId, false);
    }
    this.publishRemotePresentationPatch();
  }

  private async removeRemoteRecentProject(
    remoteReference: GpuiRemoteProjectReference,
  ): Promise<void> {
    this.remoteRecentProjectsByMachineId.set(
      remoteReference.machineId,
      (this.remoteRecentProjectsByMachineId.get(remoteReference.machineId) ?? []).filter(
        (project) => project.projectId !== remoteReference.projectId,
      ),
    );
    writeStoredGpuiRemoteRecentProjects(this.remoteRecentProjectsByMachineId);
    this.publishRemotePresentationPatch();
  }

  private async removeRemoteProject(remoteReference: GpuiRemoteProjectReference): Promise<void> {
    try {
      await this.requestRemoteGxserver(remoteReference.machineId, "/api/removeProject", {
        projectId: remoteReference.projectId,
      });
      this.removeRemotePresentationProject(remoteReference.machineId, remoteReference.projectId);
      this.remoteRecentProjectsByMachineId.set(
        remoteReference.machineId,
        (this.remoteRecentProjectsByMachineId.get(remoteReference.machineId) ?? []).filter(
          (project) => project.projectId !== remoteReference.projectId,
        ),
      );
      writeStoredGpuiRemoteRecentProjects(this.remoteRecentProjectsByMachineId);
      this.publishRemotePresentationPatch();
    } catch {
      this.postRemoteToast("warning", "Remote project removal failed", {
        description: "The remote gxserver could not remove that project.",
      });
    }
  }

  private async closeProjectForGroup(groupId: string): Promise<void> {
    const remoteScope = this.resolveRemotePresentationProjectScope({ groupId });
    if (parseGpuiRemotePresentationGroupId(groupId)) {
      if (!remoteScope) {
        this.postRemoteToast("warning", "Remote project close unavailable", {
          description: "Reconnect the remote machine before closing the project.",
        });
        return;
      }
      await this.closeRemoteProjectForGroup(remoteScope, groupId);
      return;
    }
    if (!this.client) {
      return;
    }
    const projectId = this.resolveProjectIdForGroup(groupId);
    if (!projectId) {
      return;
    }
    /*
    CDXC:GPUIRecentProjects 2026-06-24-12:38:
    GPUI reuses SidebarApp's macOS close/remove split. Close must call the gxserver park endpoint with the project id resolved from the live presentation group, then consume gxserver's authoritative parked row; never synthesize a Recent Project row or map Close to hard delete when resolution or the daemon mutation fails.
    */
    const response = await this.client.rpc<{
      project: GxserverProjectDomainState;
      recentProjects: GxserverRecentProjectDomainState[];
    }>("/api/closeProjectToRecent", {
      projectId,
    });
    this.upsertDomainProject(response.project);
    this.recentProjects = [...response.recentProjects];
    if (this.activeGroupId === groupId || this.activeProjectId === projectId) {
      this.activeGroupId = undefined;
      this.activeProjectId = undefined;
    }
    this.removeLocalPresentationProject(projectId);
    if (this.presentation) {
      this.publishPresentation("patch");
      return;
    }
    this.publishHudPatch();
  }

  private async removeProjectForGroup(groupId: string): Promise<void> {
    const remoteScope = this.resolveRemotePresentationProjectScope({ groupId });
    if (parseGpuiRemotePresentationGroupId(groupId)) {
      if (!remoteScope) {
        this.postRemoteToast("warning", "Remote project removal unavailable", {
          description: "Reconnect the remote machine before removing the project.",
        });
        return;
      }
      await this.removeRemoteProject(remoteScope);
      return;
    }
    const projectId = parseGxserverPresentationProjectGroupId(groupId);
    if (projectId) {
      await this.removeProject(projectId);
    }
  }

  private resolveProjectIdForGroup(groupId: string): string | undefined {
    if (parseGpuiRemotePresentationGroupId(groupId)) {
      return undefined;
    }
    const projectId = parseGxserverPresentationProjectGroupId(groupId);
    if (!projectId) {
      return undefined;
    }
    const group = this.latestGroups.find((candidate) => candidate.groupId === groupId);
    if (group?.projectContext) {
      return projectId;
    }
    return undefined;
  }

  private postProjectPathActionForGroup(
    action: Extract<
      GpuiSidebarNativeProjectPathAction,
      "copyWorkspaceProjectPath" | "openWorkspaceProjectInFinder" | "openWorkspaceProjectInIde"
    >,
    groupId: string,
    originalMessage: SidebarToExtensionMessage,
  ): void {
    const remoteGroup = parseGpuiRemotePresentationGroupId(groupId);
    if (remoteGroup) {
      if (action === "copyWorkspaceProjectPath") {
        this.postRemoteProjectNativeAction("copyRemoteProjectPath", remoteGroup, originalMessage);
        return;
      }
      if (action === "openWorkspaceProjectInIde") {
        this.postRemoteProjectNativeAction(
          "openRemoteWorkspaceProjectInIde",
          remoteGroup,
          originalMessage,
        );
        return;
      }
      this.postRemoteToast("warning", "Remote project open unavailable", {
        description: "GPUI does not open remote project paths in local Finder.",
      });
      return;
    }
    const projectId = this.resolveProjectIdForGroup(groupId);
    if (!projectId) {
      this.handleUnsupportedSidebarMessage(originalMessage);
      return;
    }
    this.postNativeProjectPathAction(action, projectId, originalMessage);
  }

  private postActiveProjectPathAction(
    action: Extract<
      GpuiSidebarNativeProjectPathAction,
      | "openActiveWorkspaceProjectInFinder"
      | "openActiveWorkspaceProjectInVscode"
      | "openActiveWorkspaceProjectInZed"
    >,
    originalMessage: SidebarToExtensionMessage,
  ): void {
    const remoteGroup = this.activeGroupId
      ? parseGpuiRemotePresentationGroupId(this.activeGroupId)
      : undefined;
    if (remoteGroup) {
      if (action === "openActiveWorkspaceProjectInVscode") {
        this.postRemoteProjectNativeAction(
          "openRemoteWorkspaceProjectInVscode",
          remoteGroup,
          originalMessage,
        );
        return;
      }
      if (action === "openActiveWorkspaceProjectInZed") {
        this.postRemoteProjectNativeAction(
          "openRemoteWorkspaceProjectInZed",
          remoteGroup,
          originalMessage,
        );
        return;
      }
      this.postRemoteToast("warning", "Remote project open unavailable", {
        description:
          action === "openActiveWorkspaceProjectInFinder"
            ? "GPUI does not open remote project paths in local Finder."
            : "That editor is not supported for GPUI remote project opens.",
      });
      return;
    }
    const projectId = this.activeProjectId;
    if (!projectId || !this.domainProjectById(projectId)) {
      this.handleUnsupportedSidebarMessage(originalMessage);
      return;
    }
    this.postNativeProjectPathAction(action, projectId, originalMessage);
  }

  private selectRemoteGroupAttachTarget(
    reference: GpuiRemoteProjectReference,
  ): { machineId: string; projectId: string; sessionId: string } | undefined {
    const presentation = this.remotePresentations.get(reference.machineId);
    const session = (presentation?.sessions ?? [])
      .filter((candidate) =>
        candidate.projectId === reference.projectId &&
        (candidate.kind === "terminal" || candidate.kind === "agent"),
      )
      .sort(compareGpuiRemoteAttachCandidateSessions)[0];
    return session
      ? {
          machineId: reference.machineId,
          projectId: reference.projectId,
          sessionId: session.sessionId,
        }
      : undefined;
  }

  private postRemoteSessionNativeAction(
    action: Extract<
      GpuiSidebarNativeProjectPathAction,
      "openRemoteSessionTerminal" | "copyRemoteAttachCommand" | "copyRemoteResumeCommand"
    >,
    reference: { machineId: string; projectId: string; sessionId: string },
    originalMessage: SidebarToExtensionMessage,
  ): boolean {
    return this.postNativeProjectPathAction(
      action,
      createGpuiRemotePresentationSessionId(
        reference.machineId,
        reference.projectId,
        reference.sessionId,
      ),
      originalMessage,
    );
  }

  private postRemoteProjectNativeAction(
    action: Extract<
      GpuiSidebarNativeProjectPathAction,
      | "copyRemoteProjectPath"
      | "copyRemoteProjectOpenFolderCommand"
      | "openRemoteWorkspaceProjectInIde"
      | "openRemoteWorkspaceProjectInVscode"
      | "openRemoteWorkspaceProjectInZed"
      | "openRemoteExistingPullRequestInBrowser"
      | "openRemoteSidebarGitChangedFileInIde"
    >,
    reference: GpuiRemoteProjectReference,
    originalMessage: SidebarToExtensionMessage,
    options: { filePath?: string } = {},
  ): boolean {
    return this.postNativeProjectPathAction(
      action,
      createGpuiRemotePresentationProjectId(reference.machineId, reference.projectId),
      originalMessage,
      options,
    );
  }

  private postNativeProjectPathAction(
    action: GpuiSidebarNativeProjectPathAction,
    projectId: string,
    originalMessage: SidebarToExtensionMessage,
    options: { filePath?: string } = {},
  ): boolean {
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId) {
      this.handleUnsupportedSidebarMessage(originalMessage);
      return false;
    }
    const bridge = window.ghostexGpui?.postNativeProjectPathAction;
    if (!bridge) {
      this.handleUnsupportedSidebarMessage(originalMessage);
      return false;
    }
    const payload = JSON.stringify({
      action,
      ...(options.filePath ? { filePath: options.filePath } : {}),
      projectId: normalizedProjectId,
      type: GPUI_SIDEBAR_NATIVE_PROJECT_PATH_ACTION_MESSAGE_TYPE,
      version: GPUI_SIDEBAR_NATIVE_PROJECT_PATH_ACTION_MESSAGE_VERSION,
    });
    try {
      if (!bridge(payload)) {
        this.handleUnsupportedSidebarMessage(originalMessage);
        return false;
      }
      return true;
    } catch {
      this.handleUnsupportedSidebarMessage(originalMessage);
      return false;
    }
  }

  private postSidebarCommandAction(
    command: SidebarCommandButton,
    selectionMessage: Extract<SidebarToExtensionMessage, { type: "runSidebarCommand" }>,
  ): boolean {
    const bridge = window.ghostexGpui?.postSidebarCommandAction;
    if (!bridge) {
      this.handleUnsupportedSidebarMessage(selectionMessage);
      return false;
    }
    const payload = JSON.stringify({
      actionType: command.actionType,
      commandId: command.commandId,
      name: command.name,
      /*
      CDXC:GPUICommandPane 2026-06-27-07:54:
      `runSidebarCommand` reaches the launch bridge only after GPUI rebuilds it as a selector-shaped object. Forward an own, validated runMode only for terminal Actions so Rust can create the visible debug workspace terminal like macOS while all other launch metadata stays resolved from the trusted HUD command.
      */
      ...(command.actionType === "terminal" &&
      selectionMessage.runMode &&
      isSidebarCommandRunMode(selectionMessage.runMode)
        ? { runMode: selectionMessage.runMode }
        : {}),
      ...(command.actionType === "terminal"
        ? {
            /*
            CDXC:GPUICommandPane 2026-06-27-07:54:
            GPUI command-pane Action launches must match native `runNativeSidebarCommand`: default command-pane runtime forces terminal close-on-exit off even when trusted saved/HUD Action definitions preserve older close-on-exit metadata. Renderer `runSidebarCommand` messages cannot supply this field, and Browser Actions must continue omitting the terminal-only boolean.
            */
            closeTerminalOnExit: false,
            playCompletionSound: command.playCompletionSound,
          }
        : {}),
      ...(command.actionType === "terminal" && command.command
        ? { command: command.command }
        : {}),
      ...(command.actionType === "browser" && command.url ? { url: command.url } : {}),
      type: GPUI_SIDEBAR_COMMAND_ACTION_MESSAGE_TYPE,
      version: GPUI_SIDEBAR_COMMAND_ACTION_MESSAGE_VERSION,
    });
    try {
      if (!bridge(payload)) {
        this.handleUnsupportedSidebarMessage(selectionMessage);
        return false;
      }
      return true;
    } catch {
      this.handleUnsupportedSidebarMessage(selectionMessage);
      return false;
    }
  }

  private postGhostexHotkeyAction(
    originalMessage: Extract<SidebarToExtensionMessage, { type: "runGhostexHotkeyAction" }>,
  ): boolean {
    const bridge = window.ghostexGpui?.postGhostexHotkeyAction;
    if (!bridge) {
      this.handleUnsupportedSidebarMessage(originalMessage);
      return false;
    }
    /*
    CDXC:GPUICommandPalette 2026-06-27-08:11:
    Shared SidebarApp and Command Palette hotkey rows emit `runGhostexHotkeyAction` through the reused GPUI runtime, not directly to Rust. Forward only the fixed action-id selector so Open Commands Panel, focused-pane routes, Settings, and modal hotkeys share Rust's native dispatcher without renderer-owned session ids, paths, command text, URLs, or launch metadata.
    */
    if (
      Object.keys(originalMessage).some((key) => key !== "type" && key !== "actionId") ||
      typeof originalMessage.actionId !== "string" ||
      originalMessage.actionId.trim() === ""
    ) {
      this.handleUnsupportedSidebarMessage(originalMessage);
      return false;
    }
    const payload = JSON.stringify({
      actionId: originalMessage.actionId,
      type: "runGhostexHotkeyAction",
    });
    try {
      if (!bridge(payload)) {
        this.handleUnsupportedSidebarMessage(originalMessage);
        return false;
      }
      return true;
    } catch {
      this.handleUnsupportedSidebarMessage(originalMessage);
      return false;
    }
  }

  private postSidebarCommandRunEnd(
    commandId: string,
    originalMessage: SidebarToExtensionMessage,
  ): boolean {
    const bridge = window.ghostexGpui?.postSidebarCommandRunEnd;
    if (!bridge) {
      this.handleUnsupportedSidebarMessage(originalMessage);
      return false;
    }
    const normalizedCommandId = commandId.trim();
    if (!normalizedCommandId) {
      return false;
    }
    const payload = JSON.stringify({
      commandId: normalizedCommandId,
      /*
      CDXC:GPUICommandPane 2026-06-27-05:59:
      `endSidebarCommandRun` is a separate fixed GPUI bridge from Action launch because Rust only needs the selected command id to close the mapped command-pane run. Rebuild the payload here so renderer command text, URLs, close-on-exit flags, cwd/env, paths, logs, output, status-file paths, and run ids never cross the run-end bridge.
      */
      type: GPUI_SIDEBAR_COMMAND_RUN_END_MESSAGE_TYPE,
      version: GPUI_SIDEBAR_COMMAND_RUN_END_MESSAGE_VERSION,
    });
    try {
      if (!bridge(payload)) {
        this.handleUnsupportedSidebarMessage(originalMessage);
        return false;
      }
      return true;
    } catch {
      this.handleUnsupportedSidebarMessage(originalMessage);
      return false;
    }
  }

  private focusProjectId(projectId: string): void {
    const normalizedProjectId = normalizeNonEmptyString(projectId);
    if (!normalizedProjectId) {
      return;
    }
    this.activeProjectId = normalizedProjectId;
    this.activeGroupId = this.isGpuiPresentationChatProjectId(normalizedProjectId)
      ? GPUI_GXSERVER_CHATS_GROUP_ID
      : createGxserverPresentationProjectGroupId(normalizedProjectId);
    this.refreshSidebarHudFromClient();
  }

  private setLocalPresentationSessionFocus(projectId: string, sessionId: string): void {
    const normalizedProjectId = normalizeNonEmptyString(projectId);
    const normalizedSessionId = normalizeNonEmptyString(sessionId);
    if (!normalizedProjectId || !normalizedSessionId) {
      return;
    }
    this.activeProjectId = normalizedProjectId;
    this.activeGroupId = this.isGpuiPresentationChatProjectId(normalizedProjectId)
      ? GPUI_GXSERVER_CHATS_GROUP_ID
      : createGxserverPresentationProjectGroupId(normalizedProjectId);
    this.refreshSidebarHudFromClient();
    this.focusedSessionId = normalizedSessionId;
    this.visibleSessionIds = this.nextVisibleSessionIdsForLocalFocus(
      normalizedProjectId,
      normalizedSessionId,
    );
    this.postGxserverPresentationFocusState();
  }

  private nextVisibleSessionIdsForLocalFocus(projectId: string, sessionId: string): Set<string> {
    /*
    CDXC:GPUISidebarSessionFocus 2026-06-26-04:42:
    GPUI local session focus should follow the macOS sidebar rule that a click selects the target within the current visible workspace projection instead of replacing all visible ownership with a singleton. Preserve live local visible ids and remote ids, materialize the current project's projected visible row, then add the clicked session so last-activity resorting cannot make a second session steal focus back.
    */
    const liveLocalSessionIds = new Set(
      (this.presentation?.sessions ?? []).map((session) => session.sessionId),
    );
    const nextVisibleSessionIds = new Set(
      [...this.visibleSessionIds].filter((visibleSessionId) =>
        parseGpuiRemotePresentationSessionId(visibleSessionId) ||
        liveLocalSessionIds.has(visibleSessionId),
      ),
    );
    const projectVisibleSessionIds = this.currentVisibleSessionIdsForLocalProject(projectId);
    for (const visibleSessionId of projectVisibleSessionIds) {
      nextVisibleSessionIds.add(visibleSessionId);
    }
    nextVisibleSessionIds.add(sessionId);
    return nextVisibleSessionIds;
  }

  private currentVisibleSessionIdsForLocalProject(projectId: string): string[] {
    const presentation = this.presentation;
    if (!presentation) {
      return [];
    }
    const sessions =
      createGxserverPresentationSessionsByProjectFromGroups({ presentation }).get(projectId) ?? [];
    return sessions.flatMap((session, index) =>
      this.visibleSessionIds.has(session.sessionId) || index === 0
        ? [session.sessionId]
        : [],
    );
  }

  private isGpuiPresentationChatProjectId(projectId: string): boolean {
    return isGpuiPresentationChatDomainProject(this.domainProjectById(projectId)) ||
      isGpuiPresentationChatProjectPath(
        this.presentation?.projects.find((project) => project.projectId === projectId)?.path,
      );
  }

  private setRemotePresentationSessionFocus(reference: {
    machineId: string;
    projectId: string;
    sessionId: string;
  }): void {
    const machineId = normalizeNonEmptyString(reference.machineId);
    const projectId = normalizeNonEmptyString(reference.projectId);
    const sessionId = normalizeNonEmptyString(reference.sessionId);
    if (!machineId || !projectId || !sessionId) {
      return;
    }
    const scopedSessionId = createGpuiRemotePresentationSessionId(machineId, projectId, sessionId);
    const scopedGroupId = createGpuiRemotePresentationGroupId(machineId, projectId);
    this.activeGroupId = scopedGroupId;
    this.focusedSessionId = scopedSessionId;
    this.visibleSessionIds = new Set([scopedSessionId]);
    this.postGxserverPresentationFocusState();
  }

  private dropLocalPresentationSessionFocus(): void {
    if (this.focusedSessionId && !parseGpuiRemotePresentationSessionId(this.focusedSessionId)) {
      this.focusedSessionId = undefined;
    }
    this.visibleSessionIds = new Set(
      [...this.visibleSessionIds].filter((sessionId) =>
        Boolean(parseGpuiRemotePresentationSessionId(sessionId)),
      ),
    );
  }

  private dropRemotePresentationSessionFocus(machineId: string): void {
    if (
      this.focusedSessionId &&
      parseGpuiRemotePresentationSessionId(this.focusedSessionId)?.machineId === machineId
    ) {
      this.focusedSessionId = undefined;
    }
    this.visibleSessionIds = new Set(
      [...this.visibleSessionIds].filter(
        (sessionId) => parseGpuiRemotePresentationSessionId(sessionId)?.machineId !== machineId,
      ),
    );
  }

  private activeDomainProject(): GxserverProjectDomainState | undefined {
    return this.activeProjectId
      ? this.domainProjectById(this.activeProjectId)
      : this.domainProjects.find(
          (project) =>
            project.isRecentProject !== true &&
            !isGpuiPresentationQuickDomainProject(project),
        );
  }

  private domainProjectById(projectId: string): GxserverProjectDomainState | undefined {
    return this.domainProjects.find((project) => project.projectId === projectId);
  }

  private resolveDomainProjectScope(scope: {
    projectId?: string;
    projectPath?: string;
  }): GxserverProjectDomainState | undefined {
    if (scope.projectId) {
      const byId = this.domainProjectById(scope.projectId);
      if (byId) {
        return byId;
      }
    }
    const normalizedPath = normalizeGpuiProjectPath(scope.projectPath);
    if (!normalizedPath) {
      return undefined;
    }
    return this.domainProjects.find(
      (project) => normalizeGpuiProjectPath(project.path) === normalizedPath,
    );
  }

  private resolveWorktreeFamilyParentProject(
    project: GxserverProjectDomainState,
  ): GxserverProjectDomainState | undefined {
    const parentProjectId = normalizeGpuiWorktreeParentProjectId(project.worktree);
    return parentProjectId ? this.domainProjectById(parentProjectId) : project;
  }

  private isTrustedExistingWorktreePath(
    path: string,
    sourceProject: GxserverProjectDomainState,
    parentProject: GxserverProjectDomainState,
  ): boolean {
    const trusted = this.trustedExistingWorktreeList;
    return Boolean(
      trusted &&
        trusted.sourceProjectId === sourceProject.projectId &&
        trusted.parentProjectId === parentProject.projectId &&
        trusted.paths.has(path),
    );
  }

  private resolveSidebarAgent(agentId: string): SidebarAgentButton | undefined {
    const normalizedAgentId = agentId.trim();
    if (!normalizedAgentId) {
      return undefined;
    }
    const agents = this.sidebarHud
      ? ([...this.sidebarHud.agents] as SidebarAgentButton[])
      : createSidebarAgentButtons([], []);
    return agents.find(
      (agent) => agent.agentId === normalizedAgentId,
    );
  }

  private resolveSidebarCommand(commandId: string): SidebarCommandButton | undefined {
    const normalizedCommandId = commandId.trim();
    if (!normalizedCommandId) {
      return undefined;
    }
    const commands = this.sidebarHud
      ? ([...this.sidebarHud.commands] as SidebarCommandButton[])
      : createSidebarCommandButtons([], [], []);
    return commands.find(
      (command) => command.commandId === normalizedCommandId,
    );
  }

  private createSidebarCommandSelectionMessage(
    commandId: string,
    originalMessage: SidebarToExtensionMessage,
  ): Extract<SidebarToExtensionMessage, { type: "runSidebarCommand" }> | undefined {
    /*
    CDXC:GPUICommandPane 2026-06-27-07:54:
    The GPUI SidebarApp/Command Palette Action launch boundary accepts only selector-shaped `runSidebarCommand` objects: type, command id, and an own optional runMode. Renderer-supplied command text, URLs, cwd/env, paths, output, logs, run ids, and status fields are unsupported instead of being stripped into a launch.
    */
    if (
      Object.keys(originalMessage).some((key) =>
        !GPUI_SIDEBAR_COMMAND_SELECTOR_MESSAGE_KEYS.has(key)
      )
    ) {
      return undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(originalMessage, "runMode")) {
      return {
        commandId,
        type: "runSidebarCommand",
      };
    }
    const runMode = (originalMessage as { runMode?: unknown }).runMode;
    if (!isSidebarCommandRunMode(runMode)) {
      return undefined;
    }
    return {
      commandId,
      runMode,
      type: "runSidebarCommand",
    };
  }

  private runSidebarCommand(
    commandId: string,
    originalMessage: SidebarToExtensionMessage,
  ): void {
    /*
     * CDXC:GPUICommandPane 2026-06-26-05:11:
     * The shared SidebarApp and Command Palette emit `runSidebarCommand` as an
     * Action-selection message: command id plus optional runMode. In GPUI,
     * resolve the selected Action from the live gxserver HUD projection and hand
     * trusted launch metadata to Rust through the fixed command-action bridge so
     * command text, URLs, saved close-on-exit metadata, paths, output, and logs
     * never come from the renderer message.
     *
     * CDXC:GPUICommandPane 2026-06-27-06:37:
     * Match native sidebar dispatch for stale Action selectors: an unknown command id is an unsupported no-op, while an existing but unconfigured Action still opens Settings so the user can supply the missing command or URL.
     *
     * CDXC:GPUICommandPane 2026-06-27-07:54:
     * Treat selector shape as part of the Action contract before looking up the HUD command. Extra launch/run-state fields are unsupported no-ops, not sanitized launches, while valid configured-but-empty selectors still reach Settings like macOS.
     */
    const selectionMessage = this.createSidebarCommandSelectionMessage(commandId, originalMessage);
    if (!selectionMessage) {
      this.handleUnsupportedSidebarMessage(originalMessage);
      return;
    }
    const command = this.resolveSidebarCommand(commandId);
    if (!command) {
      this.handleUnsupportedSidebarMessage(originalMessage);
      return;
    }
    if (!isSidebarCommandConfigured(command)) {
      this.openAppModal("settings");
      return;
    }
    if (this.postSidebarCommandAction(command, selectionMessage)) {
      return;
    }
    this.handleUnsupportedSidebarMessage(selectionMessage);
  }

  private endSidebarCommandRun(
    commandId: string,
    originalMessage: SidebarToExtensionMessage,
  ): void {
    if (this.postSidebarCommandRunEnd(commandId, originalMessage)) {
      return;
    }
    this.handleUnsupportedSidebarMessage(originalMessage);
  }

  private async mutateSidebarHudSettings(
    params: GxserverSidebarHudSettingsMutationParams,
  ): Promise<GxserverSidebarHudSettingsMutationResult | undefined> {
    const client = this.client;
    if (!client) {
      return undefined;
    }
    /*
     * CDXC:SidebarHudSettingsMutation 2026-06-24-20:54:
     * GPUI SidebarApp forwards Settings agent/action save, delete, and order
     * intents to gxserver instead of normalizing custom project metadata in the
     * renderer. Apply the returned canonical project rows and HUD projection so
     * Settings rows and sidebar buttons refresh from the same daemon contract.
     */
    const response = await client.mutateSidebarHudSettings(params);
    if (this.client !== client) {
      return undefined;
    }
    for (const project of response.projects) {
      this.upsertDomainProject(project);
    }
    this.sidebarHud = response.hud;
    this.publishHudPatch();
    return response;
  }

  private async updateProjectDomainState(
    projectId: string,
    params: Record<string, unknown>,
  ): Promise<GxserverProjectDomainState | undefined> {
    if (!this.client) {
      return undefined;
    }
    const response = await this.client.rpc<{ project: GxserverProjectDomainState }>(
      "/api/updateProject",
      {
        ...params,
        projectId,
      },
    );
    this.upsertDomainProject(response.project);
    this.publishHudPatch();
    this.refreshSidebarHudFromClient();
    return response.project;
  }

  private upsertDomainProject(nextProject: GxserverProjectDomainState): void {
    const existingIndex = this.domainProjects.findIndex(
      (project) => project.projectId === nextProject.projectId,
    );
    this.domainProjects =
      existingIndex >= 0
        ? this.domainProjects.map((project, index) =>
            index === existingIndex ? nextProject : project,
          )
        : [...this.domainProjects, nextProject];
  }

  private async refreshDomainPresentationFromClient(
    kind: GpuiSidebarRuntimeSnapshotKind,
  ): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    const [snapshot, domainProjects, recentProjects] = await Promise.all([
      client.fetchPresentationSnapshot(),
      client.fetchProjectList(),
      client.fetchRecentProjects().catch(() => this.recentProjects),
    ]);
    if (this.client !== client) {
      return;
    }
    this.domainProjects = [...domainProjects];
    this.recentProjects = [...recentProjects];
    this.applyPresentationSnapshot(snapshot, kind);
  }

  private async refreshDomainPresentationSnapshotFromClient(
    kind: GpuiSidebarRuntimeSnapshotKind,
  ): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    const [snapshot, domainProjects] = await Promise.all([
      client.fetchPresentationSnapshot(),
      client.fetchProjectList(),
    ]);
    if (this.client !== client) {
      return;
    }
    this.domainProjects = [...domainProjects];
    this.applyPresentationSnapshot(snapshot, kind);
  }

  private postWorktreeToast(
    level: AppToastLevel,
    title: string,
    options: {
      description?: string;
      persistent?: boolean;
      toastId?: string;
    } = {},
  ): void {
    try {
      postAppModalHostMessage(
        createAppToastRequest(level, title, options.description, {
          persistent: options.persistent,
          toastId: options.toastId,
        }),
        "AppModals:gpuiWorktreeToast",
      );
    } catch {
      /*
      CDXC:GPUIWorktrees 2026-06-24-18:21:
      Worktree mutations should still run when the toast host is unavailable.
      The missing toast bridge is a presentation problem, while gxserver remains
      the production owner for Git, setup, Beads hook, and agent-session state.
      */
    }
  }

  private openAppModal(
    modal: "firstLaunchSetup" | "settings" | "watchGhostexVideo",
  ): void {
    /*
    CDXC:GPUISidebarAppModalBridge 2026-06-24-11:40:
    Sidebar-origin Settings, first-launch welcome, and tutorial-video requests in GPUI must use the shared app-modal host bridge installed by the CEF sidebar surface. Do not fork Settings React UI, duplicate modal state, or route these first-party modals through fixture/sidebar-only alternate paths.
    */
    try {
      openAppModal({ modal, type: "open" });
    } catch {
      this.handleUnsupportedSidebarMessage({ type: "openSettings" });
    }
  }

  private async saveScratchPad(content: string): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    this.appUserData = await client.saveScratchPad(content);
    this.publishAppUserDataHydrate();
  }

  private async savePinnedPrompt(
    message: Extract<SidebarToExtensionMessage, { type: "savePinnedPrompt" }>,
  ): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    this.appUserData = await client.savePinnedPrompt({
      content: message.content,
      promptId: message.promptId,
      title: message.title,
    });
    this.publishAppUserDataHydrate();
  }

  private publishAppUserDataHydrate(): void {
    if (!this.hasHydrated) {
      return;
    }
    this.messageSource.postMessage(
      this.createHydrateMessage(this.latestGroups, this.latestHud),
    );
  }

  private patchPresentationSession(
    projectId: string,
    sessionId: string,
    patch: Partial<GxserverPresentationSnapshot["sessions"][number]>,
  ): void {
    const presentation = this.presentation;
    const session = presentation?.sessions.find(
      (candidate) => candidate.projectId === projectId && candidate.sessionId === sessionId,
    );
    if (!presentation || !session) {
      return;
    }
    this.presentation = reduceGxserverPresentationDelta(
      presentation,
      {
        session: {
          ...session,
          ...patch,
        },
        type: "sessionUpdated",
      },
      presentation.revision + 1,
    );
    this.publishPresentation("patch");
  }

  private removePresentationSession(projectId: string, sessionId: string): void {
    this.hideLocalPresentationSession(projectId, sessionId);
    const presentation = this.presentation;
    if (!presentation) {
      return;
    }
    this.presentation = reduceGxserverPresentationDelta(
      presentation,
      {
        projectId: projectId as GxserverProjectId,
        sessionId: sessionId as GxserverSessionId,
        type: "sessionRemoved",
      },
      presentation.revision + 1,
    );
    this.publishPresentation("patch");
  }

  private hideLocalPresentationSession(projectId: string, sessionId: string): void {
    /*
    CDXC:GPUIWorkspaceLifecycle 2026-06-26-23:59:
    GPUI native tab close must match macOS local-first sidebar removal. Keep a runtime-only hidden-session overlay so future gxserver hydrates cannot reinsert a locally closed mapped Agents row while the backend transition catches up or fails best-effort. Store only project/session ids.
    */
    this.localFirstHiddenPresentationSessionKeys.add(
      createGxserverPresentationSidebarSessionKey(projectId, sessionId),
    );
  }

  private removeLocalPresentationProject(projectId: string): void {
    const presentation = this.presentation;
    if (!presentation) {
      return;
    }
    /*
    CDXC:GPUIRecentProjects 2026-06-25-18:50:
    Local close-to-recent must immediately mirror macOS by removing the parked project from normal GPUI sidebar groups while using gxserver's `/api/closeProjectToRecent` recent-project response as the only drawer source.
    */
    this.presentation = reduceGxserverPresentationDelta(
      presentation,
      {
        projectId: projectId as GxserverProjectId,
        type: "projectRemoved",
      },
      presentation.revision + 1,
    );
  }

  private handleUnsupportedSidebarMessage(_message: SidebarToExtensionMessage): void {
    /*
    CDXC:GPUISidebarGxserverRuntime 2026-06-24-11:00:
    GPUI command parity is intentionally incremental. Unsupported SidebarApp messages must be explicit no-ops in this adapter instead of mutating fixture state, inventing host behavior, logging user content, or pretending native-only Browser/Git/settings/chrome actions succeeded.
    */
  }
}

type GpuiRendererCommandHandler = (
  command: GxserverRendererCommand,
) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;

class GpuiGxserverClient {
  constructor(private readonly bootstrap: GpuiValidatedGxserverBootstrap) {}

  async fetchPresentationSnapshot(): Promise<GxserverPresentationSnapshot> {
    const { snapshot } = await this.rpc<{ snapshot: GxserverPresentationSnapshot }>(
      "/api/readPresentationSnapshot",
    );
    return snapshot;
  }

  async fetchProjectList(): Promise<GxserverProjectDomainState[]> {
    const { projects } = await this.rpc<{ projects: GxserverProjectDomainState[] }>(
      "/api/listProjects",
    );
    return projects;
  }

  async fetchRecentProjects(): Promise<GxserverRecentProjectDomainState[]> {
    const { recentProjects } = await this.rpc<{
      recentProjects: GxserverRecentProjectDomainState[];
    }>("/api/listRecentProjects");
    return recentProjects;
  }

  async fetchSidebarHud(activeProjectId: string | undefined): Promise<GxserverSidebarHudResponse> {
    const normalizedActiveProjectId = activeProjectId?.trim();
    return this.rpc<GxserverSidebarHudResponse>(
      "/api/readSidebarHud",
      normalizedActiveProjectId ? { activeProjectId: normalizedActiveProjectId } : {},
    );
  }

  async mutateSidebarHudSettings(
    params: GxserverSidebarHudSettingsMutationParams,
  ): Promise<GxserverSidebarHudSettingsMutationResult> {
    return this.rpc<GxserverSidebarHudSettingsMutationResult>(
      "/api/mutateSidebarHudSettings",
      params,
    );
  }

  async fetchAppUserData(): Promise<GxserverAppUserData> {
    return this.rpc<GxserverAppUserData>("/api/readAppUserData");
  }

  async saveScratchPad(content: string): Promise<GxserverAppUserData> {
    return this.rpc<GxserverAppUserData>("/api/saveScratchPad", { content });
  }

  async savePinnedPrompt(params: {
    content: string;
    promptId?: string;
    title: string;
  }): Promise<GxserverAppUserData> {
    return this.rpc<GxserverAppUserData>("/api/savePinnedPrompt", params);
  }

  async rpc<TResult>(
    path: GxserverEndpointPath,
    params: Record<string, unknown> = {},
  ): Promise<TResult> {
    const response = await fetch(`${this.bootstrap.baseUrl}${path}`, {
      body: JSON.stringify({
        params,
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      }),
      headers: {
        authorization: `Bearer ${this.bootstrap.authToken}`,
        "content-type": "application/json",
        "x-gxserver-protocol-version": String(GXSERVER_PROTOCOL_VERSION),
      },
      method: "POST",
    });
    const body = await readJson(response);
    if (!response.ok || !isGxserverRpcSuccess<TResult>(body)) {
      throw new Error("gxserver RPC failed.");
    }
    if (body.protocolVersion !== GXSERVER_PROTOCOL_VERSION) {
      throw new Error("gxserver protocol mismatch.");
    }
    return body.result;
  }

  subscribePresentation({
    clientId,
    lastRevision,
    onClose,
    onDelta,
    onError,
    onRendererCommand,
    onSnapshot,
  }: {
    clientId: string;
    lastRevision: number;
    onClose: () => void;
    onDelta: (delta: GxserverPresentationDelta, revision: number) => void;
    onError: () => void;
    onRendererCommand?: GpuiRendererCommandHandler;
    onSnapshot: (snapshot: GxserverPresentationSnapshot) => void;
  }): GpuiPresentationSubscription {
    const url = new URL(`${this.bootstrap.baseUrl}/api/events`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("protocolVersion", String(GXSERVER_PROTOCOL_VERSION));
    url.searchParams.set("authToken", this.bootstrap.authToken);

    const socket = new WebSocket(url.toString());
    let closedByClient = false;
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        clientId,
        lastRevision,
        ...(onRendererCommand ? { rendererCommands: true } : {}),
        type: "subscribePresentation",
      }));
    });
    socket.addEventListener("message", (event) => {
      const message = parseObject(event.data);
      if (!message) {
        return;
      }
      if (message.type === "presentationSnapshot" && isPresentationSnapshot(message.snapshot)) {
        onSnapshot(message.snapshot);
        return;
      }
      if (
        message.type === "presentationDelta" &&
        typeof message.revision === "number" &&
        isPresentationDelta(message.delta)
      ) {
        onDelta(message.delta, message.revision);
        return;
      }
      if (
        message.type === "rendererCommand" &&
        onRendererCommand &&
        isGpuiRendererCommand(message.command)
      ) {
        void handleGpuiRendererCommand(socket, message.command, onRendererCommand);
      }
    });
    socket.addEventListener("error", () => {
      onError();
    });
    socket.addEventListener("close", () => {
      if (!closedByClient) {
        onClose();
      }
    });
    return {
      close: () => {
        closedByClient = true;
        socket.close();
      },
    };
  }
}

type GpuiPresentationSubscription = {
  close: () => void;
};

function validateGpuiGxserverBootstrap(
  bootstrap: GpuiGxserverBootstrap,
): GpuiValidatedGxserverBootstrap | undefined {
  if (
    bootstrap.protocolVersion !== undefined &&
    bootstrap.protocolVersion !== GXSERVER_PROTOCOL_VERSION
  ) {
    return undefined;
  }
  if (typeof bootstrap.baseUrl !== "string" || bootstrap.baseUrl.trim().length === 0) {
    return undefined;
  }
  if (typeof bootstrap.authToken !== "string" || bootstrap.authToken.trim().length === 0) {
    return undefined;
  }
  try {
    const baseUrl = new URL(bootstrap.baseUrl);
    return {
      authToken: bootstrap.authToken,
      baseUrl: baseUrl.toString().replace(/\/$/u, ""),
      clientId: normalizeNonEmptyString(bootstrap.clientId) ?? GPUI_SIDEBAR_DEFAULT_CLIENT_ID,
      focusedSessionId: normalizeNonEmptyString(bootstrap.focusedSessionId),
      initialActiveProjectId: normalizeNonEmptyString(bootstrap.initialActiveProjectId),
      visibleSessionIds: uniqueNonEmptyStrings(bootstrap.visibleSessionIds),
    };
  } catch {
    return undefined;
  }
}

function hasSameGpuiGxserverBootstrapTransport(
  left: GpuiValidatedGxserverBootstrap,
  right: GpuiValidatedGxserverBootstrap,
): boolean {
  return (
    left.authToken === right.authToken &&
    left.baseUrl === right.baseUrl &&
    left.clientId === right.clientId
  );
}

function activeGroupIdForGpuiGxserverBootstrapPresentationState({
  focusedSessionId,
  initialActiveProjectId,
}: Pick<GpuiValidatedGxserverBootstrap, "focusedSessionId" | "initialActiveProjectId">): string | undefined {
  const remoteSession = focusedSessionId
    ? parseGpuiRemotePresentationSessionId(focusedSessionId)
    : undefined;
  if (remoteSession) {
    return createGpuiRemotePresentationGroupId(remoteSession.machineId, remoteSession.projectId);
  }
  return initialActiveProjectId
    ? createGxserverPresentationProjectGroupId(initialActiveProjectId)
    : undefined;
}

function uniqueNonEmptyStrings(values: readonly unknown[] | undefined): readonly string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }
  return [...new Set(values.flatMap((value) => {
    const normalized = typeof value === "string" ? normalizeNonEmptyString(value) : undefined;
    return normalized ? [normalized] : [];
  }))];
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

const GPUI_COMMAND_PANE_SESSION_SUMMARY_LIMIT = 128;
const GPUI_COMMAND_PANE_SESSION_STRING_MAX_LENGTH = 512;
const GPUI_COMMAND_PANE_TIMER_DEADLINE_MAX_LENGTH = 64;
const GPUI_COMMAND_PANE_TIMER_LABEL_MAX_LENGTH = 32;
const GPUI_COMMAND_PANE_TIMER_REMAINING_MS_MAX = 2_147_483_647;
const GPUI_GXSERVER_LOCAL_COMMAND_PANE_SESSION_ID_PATTERN = /^G[0-9][0-9A-Za-z_-]*$/u;

function normalizeGpuiCommandPaneSessions(
  sessions: readonly GpuiCommandPaneSessionSummary[] | unknown,
): GpuiCommandPaneSessionSummary[] {
  if (!Array.isArray(sessions)) {
    return [];
  }
  return sessions.slice(0, GPUI_COMMAND_PANE_SESSION_SUMMARY_LIMIT).flatMap((session) => {
    if (!session || typeof session !== "object") {
      return [];
    }
    const record = session as Partial<Record<keyof GpuiCommandPaneSessionSummary, unknown>>;
    const sessionId = normalizeGpuiCommandPaneSessionString(record.sessionId);
    const status = normalizeGpuiCommandPaneSessionStatus(record.status);
    if (!sessionId || !status || !isGpuiGxserverLocalCommandPaneSessionId(sessionId)) {
      return [];
    }
    const commandId = normalizeGpuiCommandPaneSessionString(record.commandId);
    const title = normalizeGpuiCommandPaneSessionString(record.title);
    const delayedSendDeadlineAt = normalizeGpuiCommandPaneTimerDeadlineAt(
      record.delayedSendDeadlineAt,
    );
    const delayedSendRemainingLabel = normalizeGpuiCommandPaneTimerRemainingLabel(
      record.delayedSendRemainingLabel,
    );
    const delayedSendRemainingMs = normalizeGpuiCommandPaneTimerRemainingMs(
      record.delayedSendRemainingMs,
    );
    const closeAfterDoneDeadlineAt = normalizeGpuiCommandPaneTimerDeadlineAt(
      record.closeAfterDoneDeadlineAt,
    );
    const closeAfterDoneRemainingLabel = normalizeGpuiCommandPaneTimerRemainingLabel(
      record.closeAfterDoneRemainingLabel,
    );
    const closeAfterDoneRemainingMs = normalizeGpuiCommandPaneTimerRemainingMs(
      record.closeAfterDoneRemainingMs,
    );
    return [
      {
        ...(commandId ? { commandId } : {}),
        /*
        CDXC:GPUICommandPaneTimers 2026-06-27-02:05:
        Native Rust emits command-pane timer summaries with only Delayed Send and Close After Done display fields. Keep the TypeScript bridge at the same privacy boundary by normalizing and forwarding just bounded timer strings, non-negative remaining milliseconds, and a true-only Close After Done flag; never pass command text, cwd/env, URLs, paths, output, run ids, status-file paths, tokens, or unknown native fields into the Sidebar HUD.
        */
        ...(record.closeAfterDone === true ? { closeAfterDone: true } : {}),
        ...(closeAfterDoneDeadlineAt ? { closeAfterDoneDeadlineAt } : {}),
        ...(closeAfterDoneRemainingLabel ? { closeAfterDoneRemainingLabel } : {}),
        ...(closeAfterDoneRemainingMs !== undefined ? { closeAfterDoneRemainingMs } : {}),
        ...(delayedSendDeadlineAt ? { delayedSendDeadlineAt } : {}),
        ...(delayedSendRemainingLabel ? { delayedSendRemainingLabel } : {}),
        ...(delayedSendRemainingMs !== undefined ? { delayedSendRemainingMs } : {}),
        ...(record.isActive === true ? { isActive: true } : {}),
        ...(record.isPaneOwner === true ? { isPaneOwner: true } : {}),
        sessionId,
        status,
        ...(title ? { title } : {}),
      },
    ];
  });
}

function normalizeGpuiCommandPaneSessionString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (
    !normalized ||
    normalized.length > GPUI_COMMAND_PANE_SESSION_STRING_MAX_LENGTH ||
    /[\u0000-\u001F\u007F]/.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function normalizeGpuiCommandPaneTimerDeadlineAt(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > GPUI_COMMAND_PANE_TIMER_DEADLINE_MAX_LENGTH ||
    /[\u0000-\u001F\u007F]/.test(normalized) ||
    !/^\d{4}-\d{2}-\d{2}T/u.test(normalized) ||
    Number.isNaN(Date.parse(normalized))
  ) {
    return undefined;
  }
  return normalized;
}

function normalizeGpuiCommandPaneTimerRemainingLabel(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (
    !normalized ||
    normalized.length > GPUI_COMMAND_PANE_TIMER_LABEL_MAX_LENGTH ||
    /[\u0000-\u001F\u007F]/.test(normalized) ||
    !/^[0-9dhms: .+-]+$/iu.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function normalizeGpuiCommandPaneTimerRemainingMs(value: unknown): number | undefined {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > GPUI_COMMAND_PANE_TIMER_REMAINING_MS_MAX
  ) {
    return undefined;
  }
  return Math.ceil(value);
}

function normalizeGpuiCommandPaneSessionStatus(
  value: unknown,
): SidebarCommandSessionIndicator["status"] | undefined {
  return isValidGpuiCommandPaneSessionStatus(value) ? value : undefined;
}

function isValidGpuiCommandPaneSessionStatus(
  value: unknown,
): value is SidebarCommandSessionIndicator["status"] {
  return value === "idle" || value === "running" || value === "error";
}

function hasSameGpuiCommandPaneSessions(
  current: readonly GpuiCommandPaneSessionSummary[],
  next: readonly GpuiCommandPaneSessionSummary[],
): boolean {
  if (current.length !== next.length) {
    return false;
  }
  return current.every((session, index) => {
    const candidate = next[index];
    return (
      session.commandId === candidate?.commandId &&
      session.closeAfterDone === candidate?.closeAfterDone &&
      session.closeAfterDoneDeadlineAt === candidate?.closeAfterDoneDeadlineAt &&
      session.closeAfterDoneRemainingLabel === candidate?.closeAfterDoneRemainingLabel &&
      session.closeAfterDoneRemainingMs === candidate?.closeAfterDoneRemainingMs &&
      session.delayedSendDeadlineAt === candidate?.delayedSendDeadlineAt &&
      session.delayedSendRemainingLabel === candidate?.delayedSendRemainingLabel &&
      session.delayedSendRemainingMs === candidate?.delayedSendRemainingMs &&
      session.isActive === candidate?.isActive &&
      session.isPaneOwner === candidate?.isPaneOwner &&
      session.sessionId === candidate?.sessionId &&
      session.status === candidate?.status &&
      session.title === candidate?.title
    );
  });
}

function isGpuiGxserverLocalCommandPaneSessionId(sessionId: unknown): sessionId is string {
  /*
  CDXC:GPUICommandPane 2026-06-27-01:37:
  GPUI command-pane summaries are live local tab state for gxserver-backed native-shaped `G...` command sessions only. Rust shell internals may still carry numeric ids, so drop raw numeric strings, lowercase `g...`, malformed strings, and non-string rows at the bridge boundary before stale native-local command tabs can drive HUD indicators, active-tab state, timer projection, or auto-sleep protection.
  */
  return typeof sessionId === "string" &&
    GPUI_GXSERVER_LOCAL_COMMAND_PANE_SESSION_ID_PATTERN.test(sessionId);
}

type GpuiSidebarCommandSessionIndicatorScope = {
  activeProjectId?: string;
  presentation?: GxserverPresentationSnapshot;
};

function filterGpuiGxserverLocalCommandPaneSessions(
  commandPaneSessions: readonly GpuiCommandPaneSessionSummary[],
  scope: GpuiSidebarCommandSessionIndicatorScope = {},
): GpuiCommandPaneSessionSummary[] {
  /*
  CDXC:GPUICommandPane 2026-06-27-08:32:
  Command-pane ownership consumers require both an external native-shaped local `G...` id and a valid Sidebar HUD status. Reuse this filter for HUD indicators and Auto Sleep owner protection so malformed native rows, including `isPaneOwner:true` rows with invalid status, cannot keep sessions awake.

  CDXC:GPUICommandPane 2026-06-27-08:45:
  Native presentation cleanup removes stale command-panel rows after authoritative gxserver snapshots and explicit removal deltas. When the live HUD is built with an active project and presentation, require the command-pane summary id to still exist in that active project so deleted local `G...` tabs cannot keep Action indicators, timers, or active states visible.
  */
  const presentedSessionIds = scope.activeProjectId && scope.presentation
    ? new Set<string>(
        scope.presentation.sessions.flatMap((session) =>
          session.projectId === scope.activeProjectId ? [session.sessionId] : []
        ),
      )
    : undefined;
  return commandPaneSessions.filter((session) => {
    if (
      !isGpuiGxserverLocalCommandPaneSessionId(session.sessionId) ||
      !isValidGpuiCommandPaneSessionStatus(session.status)
    ) {
      return false;
    }
    return presentedSessionIds ? presentedSessionIds.has(session.sessionId) : true;
  });
}

export function createGpuiSidebarCommandSessionIndicators(
  commands: readonly SidebarCommandButton[],
  commandPaneSessions: readonly GpuiCommandPaneSessionSummary[],
  scope: GpuiSidebarCommandSessionIndicatorScope = {},
): SidebarCommandSessionIndicator[] {
  /*
  CDXC:GPUICommandPane 2026-06-27-06:30:
  Command-session HUD status is owned by Rust's sanitized command-pane summary. The TypeScript bridge may forward only external native-shaped local `G...` command-pane rows whose status is already a Sidebar HUD status; internal Rust numeric shell ids and malformed bridge rows must not match HUD Actions or infer status from renderer activity, command text, paths, URLs, output, logs, titles, status files, or other private fields.

  CDXC:GPUICommandPane 2026-06-27-08:45:
  Keep the exported helper backward-compatible for direct two-argument tests and callers. Live HUD construction passes the optional active-project presentation scope so stale command-pane summaries are pruned against the full current presentation, not against whichever ids happen to appear in a non-removal delta.
  */
  const localCommandPaneSessions = filterGpuiGxserverLocalCommandPaneSessions(commandPaneSessions, scope);
  return commands.flatMap((command) => {
    if (command.actionType !== "terminal") {
      return [];
    }
    const commandTitleKey = getGpuiSidebarCommandTitleKey(
      getGpuiSidebarCommandSessionTitle(command),
    );
    if (!commandTitleKey) {
      return [];
    }
    const mappedSession = localCommandPaneSessions.find(
      (session) =>
        session.commandId === command.commandId &&
        getGpuiSidebarCommandTitleKey(session.title) === commandTitleKey,
    );
    const session =
      mappedSession ??
      localCommandPaneSessions.find(
        (candidate) => getGpuiSidebarCommandTitleKey(candidate.title) === commandTitleKey,
      );
    if (!session) {
      return [];
    }
    return [
      {
        commandId: command.commandId,
        ...(session.closeAfterDone === true ? { closeAfterDone: true } : {}),
        ...(session.closeAfterDoneDeadlineAt ? {
          closeAfterDoneDeadlineAt: session.closeAfterDoneDeadlineAt,
        } : {}),
        ...(session.closeAfterDoneRemainingLabel ? {
          closeAfterDoneRemainingLabel: session.closeAfterDoneRemainingLabel,
        } : {}),
        ...(session.closeAfterDoneRemainingMs !== undefined ? {
          closeAfterDoneRemainingMs: session.closeAfterDoneRemainingMs,
        } : {}),
        ...(session.delayedSendDeadlineAt ? {
          delayedSendDeadlineAt: session.delayedSendDeadlineAt,
        } : {}),
        ...(session.delayedSendRemainingLabel ? {
          delayedSendRemainingLabel: session.delayedSendRemainingLabel,
        } : {}),
        ...(session.delayedSendRemainingMs !== undefined ? {
          delayedSendRemainingMs: session.delayedSendRemainingMs,
        } : {}),
        isActive: session.isActive === true,
        sessionId: session.sessionId,
        status: session.status,
        ...(session.title ? { title: session.title } : {}),
      },
    ];
  });
}

function getGpuiSidebarCommandSessionTitle(command: SidebarCommandButton): string {
  const normalizedActionName = command.name.trim();
  return normalizedActionName.length > 0
    ? normalizedActionName
    : (command.command ?? "").trim().slice(0, 20);
}

function getGpuiSidebarCommandTitleKey(value: string | undefined): string {
  return normalizeGpuiCommandPaneSessionString(value)?.toLocaleLowerCase() ?? "";
}

function createGpuiSidebarHudState({
  activeProjectId,
  commandPaneSessions = [],
  domainProjects = [],
  focusedSessionId,
  git,
  groups = [],
  presentation,
  recentProjects = [],
  remoteRecentProjectsByMachineId,
  remotePresentationsByMachineId,
  runtimeSettings,
  sidebarHud,
}: {
  activeProjectId?: string;
  commandPaneSessions?: readonly GpuiCommandPaneSessionSummary[];
  domainProjects?: readonly GxserverProjectDomainState[];
  focusedSessionId?: string;
  git?: SidebarGitState;
  groups?: readonly SidebarSessionGroup[];
  presentation?: GxserverPresentationSnapshot;
  recentProjects?: readonly GxserverRecentProjectDomainState[];
  remoteRecentProjectsByMachineId?: ReadonlyMap<string, readonly GxserverRecentProjectDomainState[]>;
  remotePresentationsByMachineId?: ReadonlyMap<string, GxserverPresentationSnapshot>;
  runtimeSettings?: GpuiSidebarRuntimeSettings;
  sidebarHud?: GxserverSidebarHudResponse;
} = {}): SidebarHudState {
  const settings = createGpuiSidebarSettings(runtimeSettings);
  /*
   * CDXC:SidebarHudContract 2026-06-24-20:34:
   * GPUI SidebarApp uses gxserver's `/api/readSidebarHud` projection for read-side agent/action buttons so live sidebar and app-modal Settings share one production contract. The local shared defaults are only for pre-bootstrap or unavailable gxserver state; project metadata is not re-normalized here.
   */
  const agents = sidebarHud
    ? ([...sidebarHud.agents] as SidebarAgentButton[])
    : createSidebarAgentButtons([], []);
  const commands = sidebarHud
    ? ([...sidebarHud.commands] as ReturnType<typeof createSidebarCommandButtons>)
    : createSidebarCommandButtons([], [], []);
  const focusedSession = groups
    .flatMap((group) => group.sessions)
    .find((session) =>
      parseGxserverPresentationProjectSessionId(session.sessionId)?.sessionId === focusedSessionId ||
      session.sessionId === focusedSessionId,
    );
  const visibleSessions = groups.flatMap((group) => group.sessions.filter((session) => session.isVisible));
  return {
    activeSessionsSortMode: "lastActivity",
    agentManagerZoomPercent: settings.agentManagerZoomPercent,
    agents,
    commands,
    commandSessionIndicators: createGpuiSidebarCommandSessionIndicators(
      commands,
      commandPaneSessions,
      { activeProjectId, presentation },
    ),
    completionBellEnabled: settings.completionBellEnabled,
    completionSound: settings.completionSound,
    completionSoundLabel: getCompletionSoundLabel(settings.completionSound),
    debuggingMode: settings.debuggingMode,
    focusedSessionTitle: focusedSession?.displayTitle ?? focusedSession?.primaryTitle ?? focusedSession?.alias,
    git: git ?? createDefaultSidebarGitState(),
    highlightedVisibleCount: GPUI_DEFAULT_VISIBLE_COUNT,
    isFocusModeActive: false,
    pendingAgentIds: [],
    projectSettingsProjects: createGpuiProjectSettingsProjects(domainProjects, presentation),
    /*
    CDXC:GPUIRecentProjects 2026-06-24-12:27:
    GPUI Recent Projects hydrate from `/api/listRecentProjects`, a
    gxserver-owned parked-project contract. Keep an empty drawer when the
    endpoint has no explicit rows; never derive recent projects from labels,
    inactive sessions, presentation titles, command text, or path guessing.
    */
    recentProjects: [
      ...createGpuiRecentProjects(recentProjects, settings),
      ...createGpuiRemoteRecentProjects(
        remoteRecentProjectsByMachineId,
        remotePresentationsByMachineId,
        settings,
      ),
    ].sort(compareGpuiRecentProjectsByClosedAt),
    settings,
    createSessionOnSidebarDoubleClick: settings.createSessionOnSidebarDoubleClick,
    renameSessionOnDoubleClick: settings.renameSessionOnDoubleClick,
    showCloseButtonOnSessionCards: settings.showCloseButtonOnSessionCards,
    theme: resolveSidebarTheme(settings.sidebarTheme, "dark"),
    viewMode: "grid",
    visibleCount: GPUI_DEFAULT_VISIBLE_COUNT,
    visibleSlotLabels: visibleSessions.map((session) => session.shortcutLabel),
  };
}

function createGpuiSidebarSettings(
  runtimeSettings?: GpuiSidebarRuntimeSettings,
): ghostexSettings {
  /*
  CDXC:GPUISettingsSidebarHandoff 2026-06-24-11:22:
  GPUI SidebarApp must receive the real saved shared Settings object, normalized through the same TypeScript settings schema as macOS, instead of hardcoded bootstrap defaults. Keep Manage availability strict by overriding only debuggingMode/showBetaFeatures from the CEF-provided booleans; missing, malformed, string-like truthy, or numeric truthy values cannot enable Manage.
  */
  const settings = normalizeghostexSettings(runtimeSettings?.settings);
  return {
    ...settings,
    debuggingMode: runtimeSettings?.debuggingMode === true,
    showBetaFeatures: runtimeSettings?.showBetaFeatures === true,
  };
}

export function createGpuiAutoSleepAgentSessionIds({
  activeProjectId,
  commandPaneSessions = [],
  focusedSessionId,
  groups = [],
  nowMs,
  presentation,
  settings,
}: {
  activeProjectId?: string;
  commandPaneSessions?: readonly GpuiCommandPaneSessionSummary[];
  focusedSessionId?: string;
  groups?: readonly SidebarSessionGroup[];
  nowMs: number;
  presentation: GxserverPresentationSnapshot;
  settings: Pick<
    ghostexSettings,
    "autoSleepAgentIdleMinutes" | "autoSleepAgentSessionsEnabled"
  >;
}): string[] {
  /*
  CDXC:GPUISidebarAutoSleep 2026-06-27-01:24:
  GPUI Agent Auto Sleep must choose only local gxserver presentation agent terminals after protecting selected/visible sidebar owners, focused sessions, active command-pane owners, and popped-out rows. Return bounded project/session routing ids for the existing setSessionSleeping path; do not inspect Browser/project-editor surfaces, titles, paths, commands, terminal output, URLs, tokens, or remote-machine rows.
  */
  if (!settings.autoSleepAgentSessionsEnabled) {
    return [];
  }
  const protectedProjectSessionKeys = collectGpuiAutoSleepProtectedProjectSessionKeys({
    activeProjectId,
    commandPaneSessions,
    focusedSessionId,
    groups,
    presentation,
  });
  return presentation.sessions.flatMap((session) =>
    shouldAutoSleepGpuiPresentationAgentSession({
      nowMs,
      protectedProjectSessionKeys,
      session,
      settings,
    })
      ? [createGxserverPresentationProjectSessionId(session.projectId, session.sessionId)]
      : [],
  );
}

export function collectGpuiAutoSleepProtectedProjectSessionKeys({
  activeProjectId,
  commandPaneSessions = [],
  focusedSessionId,
  groups = [],
  presentation,
}: {
  activeProjectId?: string;
  commandPaneSessions?: readonly GpuiCommandPaneSessionSummary[];
  focusedSessionId?: string;
  groups?: readonly SidebarSessionGroup[];
  presentation: GxserverPresentationSnapshot;
}): Set<string> {
  const protectedProjectSessionKeys = new Set<string>();
  for (const group of groups) {
    if (group.remoteMachineContext) {
      continue;
    }
    let hasProjectedOwner = false;
    for (const session of group.sessions) {
      if (session.isFocused === true || session.isVisible === true) {
        addGpuiAutoSleepProtectedSessionId(
          protectedProjectSessionKeys,
          presentation,
          session.sessionId,
          group.projectContext?.editor.projectId,
        );
        hasProjectedOwner = true;
      }
      if (session.isPoppedOut === true) {
        addGpuiAutoSleepProtectedSessionId(
          protectedProjectSessionKeys,
          presentation,
          session.sessionId,
          group.projectContext?.editor.projectId,
        );
      }
    }
    if (!hasProjectedOwner && group.sessions[0]) {
      addGpuiAutoSleepProtectedSessionId(
        protectedProjectSessionKeys,
        presentation,
        group.sessions[0].sessionId,
        group.projectContext?.editor.projectId,
      );
    }
  }
  addGpuiAutoSleepProtectedSessionId(
    protectedProjectSessionKeys,
    presentation,
    focusedSessionId,
  );
  /*
  CDXC:GPUISidebarAutoSleep 2026-06-27-06:54:
  Native Auto Sleep protects the active owner of every visible command-panel split leaf from the command-pane layout, not the HUD-focused tab. GPUI Rust sends that split ownership as sanitized `isPaneOwner:true` on external native-shaped `G...` ids; TypeScript protects only that field after the same local id and valid-status filtering used by command indicators, so internal numeric Rust ids, stale legacy rows, collapsed HUD focus, and malformed statuses cannot keep sessions awake.

  CDXC:GPUISidebarAutoSleep 2026-06-27-07:28:
  Native command-panel layout is scoped to the active project, so a GPUI command-pane owner summary must protect only the active project's matching external `G...` session. Do not treat a bare command-pane id as globally owned across projects because that can keep unrelated same-id agent sessions awake.
  */
  const localCommandPaneSessions = filterGpuiGxserverLocalCommandPaneSessions(commandPaneSessions);
  for (const commandPaneSession of localCommandPaneSessions) {
    if (commandPaneSession.isPaneOwner === true) {
      addGpuiAutoSleepProtectedSessionId(
        protectedProjectSessionKeys,
        presentation,
        commandPaneSession.sessionId,
        activeProjectId,
      );
    }
  }
  return protectedProjectSessionKeys;
}

function shouldAutoSleepGpuiPresentationAgentSession({
  nowMs,
  protectedProjectSessionKeys,
  session,
  settings,
}: {
  nowMs: number;
  protectedProjectSessionKeys: ReadonlySet<string>;
  session: GxserverPresentationSession;
  settings: Pick<
    ghostexSettings,
    "autoSleepAgentIdleMinutes" | "autoSleepAgentSessionsEnabled"
  >;
}): boolean {
  if (session.lifecycleState !== "running" || session.activity !== "idle") {
    return false;
  }
  if (session.actions.sleep !== true || !isGpuiAutoSleepAgentTerminalSession(session)) {
    return false;
  }
  if (
    protectedProjectSessionKeys.has(
      gpuiAutoSleepProjectSessionKey(session.projectId, session.sessionId),
    )
  ) {
    return false;
  }
  const lastActivityMs = gpuiAutoSleepLastActivityMs(session);
  if (lastActivityMs === undefined) {
    return false;
  }
  return nowMs - lastActivityMs >= settings.autoSleepAgentIdleMinutes * GPUI_AUTO_SLEEP_MINUTE_MS;
}

function isGpuiAutoSleepAgentTerminalSession(session: GxserverPresentationSession): boolean {
  if (session.kind === "t3") {
    return false;
  }
  if (session.surface !== "workspace" && session.surface !== "commands") {
    return false;
  }
  if (session.kind === "agent") {
    return true;
  }
  return Boolean(
    normalizeNonEmptyString(session.agentId) ||
      normalizeNonEmptyString(session.agentName) ||
      normalizeNonEmptyString(session.agentSessionId) ||
      normalizeNonEmptyString(session.agentSessionPath),
  );
}

function gpuiAutoSleepLastActivityMs(session: GxserverPresentationSession): number | undefined {
  const timestamp = session.lastActiveAt ?? session.updatedAt;
  const timestampMs = Date.parse(timestamp);
  return Number.isFinite(timestampMs) ? timestampMs : undefined;
}

function addGpuiAutoSleepProtectedSessionId(
  protectedProjectSessionKeys: Set<string>,
  presentation: GxserverPresentationSnapshot,
  sessionId: string | undefined,
  projectIdHint?: string,
): void {
  const normalizedSessionId = normalizeNonEmptyString(sessionId)?.trim();
  if (!normalizedSessionId || parseGpuiRemotePresentationSessionId(normalizedSessionId)) {
    return;
  }
  const scopedReference = parseGxserverPresentationProjectSessionId(normalizedSessionId);
  if (scopedReference) {
    protectedProjectSessionKeys.add(
      gpuiAutoSleepProjectSessionKey(scopedReference.projectId, scopedReference.sessionId),
    );
    return;
  }
  const matchingSessions = presentation.sessions.filter((session) =>
    session.sessionId === normalizedSessionId &&
    (!projectIdHint || session.projectId === projectIdHint)
  );
  for (const session of matchingSessions) {
    protectedProjectSessionKeys.add(
      gpuiAutoSleepProjectSessionKey(session.projectId, session.sessionId),
    );
  }
}

function gpuiAutoSleepProjectSessionKey(projectId: string, sessionId: string): string {
  return `${projectId}\u0000${sessionId}`;
}

export function createGpuiSessionStatusIndicatorCandidatesFromSidebarGroups(
  groups: readonly SidebarSessionGroup[],
): GpuiSessionStatusIndicatorCandidate[] {
  /*
  CDXC:GPUIStatusPetOverlay 2026-06-26-04:38:
  GPUI derives status/pet candidates from the live gxserver SidebarApp groups because the GPUI sidebar entry mounts SidebarApp directly and never runs native-sidebar.tsx. Preserve the same project/session order semantics as macOS by reusing shared display layout, but keep the bridge payload bounded and route with ids only rather than paths, commands, terminal text, external URLs, or daemon bodies. Project icon parity may carry only an already-normalized image data URL for notification attachments.
  */
  const candidates: GpuiSessionStatusIndicatorCandidate[] = [];
  let order = 0;
  for (const group of groups) {
    if (candidates.length >= GPUI_STATUS_INDICATOR_MAX_CANDIDATES) {
      break;
    }
    const groupProjectId = group.projectContext?.editor.projectId;
    const groupIconDataUrl = normalizeWorkspaceProjectIconDataUrl(group.projectContext?.iconDataUrl);
    const sessionsById = Object.fromEntries(
      group.sessions.map((session) => [session.sessionId, session]),
    );
    const manualSessionIds = group.sessions.map((session) => session.sessionId);
    const displayLayout = createDisplaySessionLayout({
      sessionIdsByGroup: { [group.groupId]: manualSessionIds },
      sessionsById,
      sortMode: "lastActivity",
      workspaceGroupIds: [group.groupId],
    });
    const visualSessionIds = displayLayout.sessionIdsByGroup[group.groupId] ?? manualSessionIds;
    for (const sessionId of visualSessionIds) {
      if (candidates.length >= GPUI_STATUS_INDICATOR_MAX_CANDIDATES) {
        break;
      }
      const session = sessionsById[sessionId];
      if (!session) {
        continue;
      }
      const combinedReference = parseGxserverPresentationProjectSessionId(session.sessionId);
      const candidateProjectId = groupProjectId ?? combinedReference?.projectId;
      if (!candidateProjectId) {
        continue;
      }
      candidates.push({
        hasRunningZmxBacking: hasRunningZmxBackingForGpuiIdleIndicator(session),
        ...(groupIconDataUrl ? { iconDataUrl: groupIconDataUrl } : {}),
        lastInteractionAt: session.lastInteractionAt,
        order,
        projectId: candidateProjectId,
        projectTitle: boundedGpuiStatusIndicatorTitle(
          group.title || candidateProjectId,
          candidateProjectId,
        ),
        sessionId: session.sessionId,
        status: getGpuiSessionStatusIndicatorStatus(session),
        title: getGpuiPetOverlaySessionTitle(session),
      });
      order += 1;
    }
  }
  return candidates;
}

export function createGpuiSessionStatusIndicatorsPayload(
  candidates: readonly GpuiSessionStatusIndicatorCandidate[],
  settings: ghostexSettings,
): GpuiSessionStatusIndicatorsPayload {
  const counts = countGpuiSessionStatusIndicatorCandidates(candidates);
  return {
    attentionCount: counts.attention,
    availableCount: counts.available,
    hideMenuBarIndicators: settings.hideMenuBarSessionStatusIndicators,
    projects: createGpuiSessionStatusIndicatorProjects(candidates),
    type: GPUI_SIDEBAR_SESSION_STATUS_INDICATORS_MESSAGE_TYPE,
    version: GPUI_SIDEBAR_SESSION_STATUS_INDICATORS_MESSAGE_VERSION,
    workingCount: counts.working,
  };
}

export function createGpuiPetOverlayStatePayload(
  candidates: readonly GpuiSessionStatusIndicatorCandidate[],
  settings: ghostexSettings,
): GpuiPetOverlayStatePayload {
  const actionableActivityCandidates = candidates.filter(
    (candidate) => candidate.status === "attention" || candidate.status === "working",
  );
  const shownActivityCandidates =
    actionableActivityCandidates.length > 0
      ? [...actionableActivityCandidates].sort(compareGpuiPetOverlayActivityCandidates).slice(0, 3)
      : [...candidates].sort(compareGpuiSessionStatusIndicatorCandidates).slice(0, 2);
  return {
    activities: shownActivityCandidates.map((candidate) => ({
      id: candidate.sessionId,
      projectId: candidate.projectId,
      state: candidate.status,
      title: candidate.title,
    })),
    enabled: settings.petOverlayEnabled,
    selectedPetId: boundedGpuiStatusIndicatorTitle(settings.selectedPetId, "cat"),
    statusItems: createGpuiPetOverlayStatusItems(candidates),
    type: GPUI_SIDEBAR_PET_OVERLAY_STATE_MESSAGE_TYPE,
    version: GPUI_SIDEBAR_PET_OVERLAY_STATE_MESSAGE_VERSION,
  };
}

function createGpuiSessionStatusIndicatorProjects(
  candidates: readonly GpuiSessionStatusIndicatorCandidate[],
): GpuiSessionStatusIndicatorProject[] {
  const projects: GpuiSessionStatusIndicatorProject[] = [];
  const projectsById = new Map<string, GpuiSessionStatusIndicatorProject>();
  for (const candidate of candidates) {
    if (!shouldCountGpuiSessionStatusIndicatorCandidate(candidate)) {
      continue;
    }
    let project = projectsById.get(candidate.projectId);
    if (!project) {
      if (projects.length >= GPUI_STATUS_INDICATOR_MAX_PROJECTS) {
        continue;
      }
      project = {
        ...(candidate.iconDataUrl ? { iconDataUrl: candidate.iconDataUrl } : {}),
        projectId: candidate.projectId,
        sessions: [],
        title: candidate.projectTitle,
      };
      projectsById.set(candidate.projectId, project);
      projects.push(project);
    }
    if (project.sessions.length >= GPUI_STATUS_INDICATOR_MAX_SESSIONS_PER_PROJECT) {
      continue;
    }
    project.sessions.push({
      lastActiveAt: candidate.lastInteractionAt,
      sessionId: candidate.sessionId,
      sidebarOrder: candidate.order,
      status: candidate.status,
      title: candidate.title,
    });
  }
  return projects;
}

function countGpuiSessionStatusIndicatorCandidates(
  candidates: readonly GpuiSessionStatusIndicatorCandidate[],
): Record<GpuiSessionStatusIndicatorStatus, number> {
  const counts = {
    attention: 0,
    available: 0,
    working: 0,
  };
  for (const candidate of candidates) {
    if (shouldCountGpuiSessionStatusIndicatorCandidate(candidate)) {
      counts[candidate.status] += 1;
    }
  }
  return counts;
}

function createGpuiPetOverlayStatusItems(
  candidates: readonly GpuiSessionStatusIndicatorCandidate[],
): Array<{ count: number; status: GpuiSessionStatusIndicatorStatus }> {
  const counts = countGpuiSessionStatusIndicatorCandidates(candidates);
  if (counts.attention > 0 || counts.working > 0) {
    const items: Array<{ count: number; status: GpuiSessionStatusIndicatorStatus }> = [];
    if (counts.attention > 0) {
      items.push({ count: counts.attention, status: "attention" });
    }
    if (counts.working > 0) {
      items.push({ count: counts.working, status: "working" });
    }
    return items;
  }
  return counts.available > 0 ? [{ count: counts.available, status: "available" }] : [];
}

function getGpuiSessionStatusIndicatorStatus(
  session: SidebarSessionItem,
): GpuiSessionStatusIndicatorStatus {
  if (session.activity === "attention") {
    return "attention";
  }
  if (session.activity === "working") {
    return "working";
  }
  return "available";
}

function hasRunningZmxBackingForGpuiIdleIndicator(session: SidebarSessionItem): boolean {
  if (session.sessionKind !== "terminal") {
    return false;
  }
  if (session.sessionPersistenceProvider !== "zmx" || !normalizeNonEmptyString(session.sessionPersistenceName)) {
    return false;
  }
  return (
    session.providerSessionState === "exists" ||
    session.nativePaneState === "mounted" ||
    session.nativePaneState === "mounting" ||
    session.isLive === true
  );
}

function shouldCountGpuiSessionStatusIndicatorCandidate(
  candidate: GpuiSessionStatusIndicatorCandidate,
): boolean {
  return candidate.status !== "available" || candidate.hasRunningZmxBacking;
}

function compareGpuiSessionStatusIndicatorCandidates(
  left: GpuiSessionStatusIndicatorCandidate,
  right: GpuiSessionStatusIndicatorCandidate,
): number {
  const timeDelta =
    getGpuiIndicatorTimestamp(right.lastInteractionAt) -
    getGpuiIndicatorTimestamp(left.lastInteractionAt);
  if (timeDelta !== 0) {
    return timeDelta;
  }
  return left.order - right.order;
}

function compareGpuiPetOverlayActivityCandidates(
  left: GpuiSessionStatusIndicatorCandidate,
  right: GpuiSessionStatusIndicatorCandidate,
): number {
  const statusDelta =
    getGpuiPetOverlayActivityStatusPriority(right.status) -
    getGpuiPetOverlayActivityStatusPriority(left.status);
  if (statusDelta !== 0) {
    return statusDelta;
  }
  return left.order - right.order;
}

function getGpuiPetOverlayActivityStatusPriority(
  status: GpuiSessionStatusIndicatorStatus,
): number {
  switch (status) {
    case "attention":
      return 2;
    case "working":
      return 1;
    case "available":
      return 0;
  }
}

function getGpuiIndicatorTimestamp(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getGpuiPetOverlaySessionTitle(session: SidebarSessionItem): string {
  const title =
    session.displayTitle?.trim() ||
    session.primaryTitle?.trim() ||
    session.terminalTitle?.trim() ||
    session.alias.trim() ||
    session.sessionNumber?.trim();
  return boundedGpuiStatusIndicatorTitle(title, "Untitled session");
}

function boundedGpuiStatusIndicatorTitle(value: string | undefined, fallback: string): string {
  const normalized = normalizeNonEmptyString(value) ?? fallback;
  return normalized.length > GPUI_STATUS_INDICATOR_TITLE_MAX_CHARS
    ? normalized.slice(0, GPUI_STATUS_INDICATOR_TITLE_MAX_CHARS)
    : normalized;
}

function normalizeGpuiStatusPetActivation(value: unknown): GpuiStatusPetActivationPayload | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["sessionId", "type", "version"].includes(key))) {
    return undefined;
  }
  if (
    record.type !== GPUI_SIDEBAR_STATUS_PET_ACTIVATION_MESSAGE_TYPE ||
    record.version !== GPUI_SIDEBAR_STATUS_PET_ACTIVATION_MESSAGE_VERSION
  ) {
    return undefined;
  }
  const sessionId = normalizeNonEmptyString(record.sessionId)?.trim();
  if (!sessionId || !gpuiStatusPetActivationSessionIdAllowed(sessionId)) {
    return undefined;
  }
  return { sessionId };
}

function normalizeGpuiMenuBarProjectActivation(
  value: unknown,
): GpuiMenuBarProjectActivationPayload | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["projectId", "type", "version"].includes(key))) {
    return undefined;
  }
  if (
    record.type !== GPUI_SIDEBAR_MENU_BAR_PROJECT_ACTIVATION_MESSAGE_TYPE ||
    record.version !== GPUI_SIDEBAR_MENU_BAR_PROJECT_ACTIVATION_MESSAGE_VERSION
  ) {
    return undefined;
  }
  const projectId = normalizeNonEmptyString(record.projectId)?.trim();
  if (!projectId || !gpuiStatusPetActivationSessionIdAllowed(projectId)) {
    return undefined;
  }
  return { projectId };
}

function normalizeGpuiMenuBarSessionActivation(
  value: unknown,
): GpuiMenuBarSessionActivationPayload | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["projectId", "sessionId", "type", "version"].includes(key))) {
    return undefined;
  }
  if (
    record.type !== GPUI_SIDEBAR_MENU_BAR_SESSION_ACTIVATION_MESSAGE_TYPE ||
    record.version !== GPUI_SIDEBAR_MENU_BAR_SESSION_ACTIVATION_MESSAGE_VERSION
  ) {
    return undefined;
  }
  const projectId = normalizeNonEmptyString(record.projectId)?.trim();
  const sessionId = normalizeNonEmptyString(record.sessionId)?.trim();
  if (
    !projectId ||
    !sessionId ||
    !gpuiStatusPetActivationSessionIdAllowed(projectId) ||
    !gpuiStatusPetActivationSessionIdAllowed(sessionId)
  ) {
    return undefined;
  }
  return { projectId, sessionId };
}

function normalizeGpuiWorkspaceTabSessionSelection(
  value: unknown,
): GpuiWorkspaceTabSessionSelectionPayload | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) =>
      !["localWasSleeping", "projectId", "sessionId", "type", "version"].includes(key)
    )
  ) {
    return undefined;
  }
  if (
    record.type !== GPUI_SIDEBAR_WORKSPACE_TAB_SESSION_SELECTED_MESSAGE_TYPE ||
    record.version !== GPUI_SIDEBAR_WORKSPACE_TAB_SESSION_SELECTED_MESSAGE_VERSION
  ) {
    return undefined;
  }
  const projectId = normalizeNonEmptyString(record.projectId)?.trim();
  const sessionId = normalizeNonEmptyString(record.sessionId)?.trim();
  if (
    !projectId ||
    !sessionId ||
    !gpuiStatusPetActivationSessionIdAllowed(projectId) ||
    !gpuiStatusPetActivationSessionIdAllowed(sessionId)
  ) {
    return undefined;
  }
  if (record.localWasSleeping !== undefined && record.localWasSleeping !== true) {
    return undefined;
  }
  return {
    ...(record.localWasSleeping === true ? { localWasSleeping: true } : {}),
    projectId,
    sessionId,
  };
}

function normalizeQueuedGpuiWorkspaceTerminalLifecycleRequest(
  value: unknown,
): GpuiWorkspaceTerminalLifecycleRequest | undefined {
  /*
  CDXC:GPUIWorkspaceLifecycle 2026-06-26-05:23:
  Lifecycle retries may contain either the raw fixed bridge payload queued before React started or the runtime's already-normalized id-only request queued while the CEF result bridge was missing. Accept only those two bounded shapes so retries do not reintroduce paths, commands, terminal text, URLs, tokens, or generic IPC fields.
  */
  return normalizeGpuiWorkspaceTerminalLifecycleRequest(value) ??
    normalizeGpuiWorkspaceTerminalLifecycleQueuedRequest(value);
}

function normalizeGpuiWorkspaceTerminalLifecycleQueuedRequest(
  value: unknown,
): GpuiWorkspaceTerminalLifecycleRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) =>
      ![
        "action",
        "projectId",
        "replacementProjectId",
        "replacementSessionId",
        "requestId",
        "sessionId",
        "skipReplacementFallback",
      ].includes(key)
    )
  ) {
    return undefined;
  }
  if (
    typeof record.requestId !== "number" ||
    !Number.isSafeInteger(record.requestId) ||
    record.requestId <= 0
  ) {
    return undefined;
  }
  const action = record.action === "close" || record.action === "sleep" || record.action === "wake"
    ? record.action
    : undefined;
  const projectId = normalizeNonEmptyString(record.projectId)?.trim();
  const sessionId = normalizeNonEmptyString(record.sessionId)?.trim();
  const replacementProjectId = normalizeNonEmptyString(record.replacementProjectId)?.trim();
  const replacementSessionId = normalizeNonEmptyString(record.replacementSessionId)?.trim();
  if (
    !action ||
    !projectId ||
    !sessionId ||
    (record.skipReplacementFallback !== true &&
      record.skipReplacementFallback !== false) ||
    !gpuiLocalWorkspaceLifecycleProjectIdAllowed(projectId) ||
    !gpuiLocalWorkspaceLifecycleSessionIdAllowed(sessionId)
  ) {
    return undefined;
  }
  if ((replacementProjectId && !replacementSessionId) || (!replacementProjectId && replacementSessionId)) {
    return undefined;
  }
  if (record.skipReplacementFallback === true && replacementProjectId && replacementSessionId) {
    return undefined;
  }
  if (
    replacementProjectId &&
    replacementSessionId &&
    (!gpuiLocalWorkspaceLifecycleProjectIdAllowed(replacementProjectId) ||
      !gpuiLocalWorkspaceLifecycleSessionIdAllowed(replacementSessionId))
  ) {
    return undefined;
  }
  return {
    action,
    projectId,
    ...(replacementProjectId && replacementSessionId
      ? { replacementProjectId, replacementSessionId }
      : {}),
    requestId: record.requestId,
    sessionId,
    skipReplacementFallback: record.skipReplacementFallback,
  };
}

function normalizeGpuiWorkspaceTerminalLifecycleRequest(
  value: unknown,
): GpuiWorkspaceTerminalLifecycleRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) =>
      ![
        "action",
        "projectId",
        "replacementProjectId",
        "replacementSessionId",
        "requestId",
        "sessionId",
        "skipReplacementFallback",
        "type",
        "version",
      ].includes(key)
    )
  ) {
    return undefined;
  }
  if (
    record.type !== GPUI_SIDEBAR_WORKSPACE_TERMINAL_LIFECYCLE_REQUEST_MESSAGE_TYPE ||
    record.version !== GPUI_SIDEBAR_WORKSPACE_TERMINAL_LIFECYCLE_REQUEST_MESSAGE_VERSION ||
    typeof record.requestId !== "number" ||
    !Number.isSafeInteger(record.requestId) ||
    record.requestId <= 0
  ) {
    return undefined;
  }
  const action = record.action === "close" || record.action === "sleep" || record.action === "wake"
    ? record.action
    : undefined;
  if (!action) {
    return undefined;
  }
  const projectId = normalizeNonEmptyString(record.projectId)?.trim();
  const sessionId = normalizeNonEmptyString(record.sessionId)?.trim();
  const replacementProjectId = normalizeNonEmptyString(record.replacementProjectId)?.trim();
  const replacementSessionId = normalizeNonEmptyString(record.replacementSessionId)?.trim();
  const skipReplacementFallback =
    record.skipReplacementFallback === undefined
      ? false
      : record.skipReplacementFallback === true;
  if (
    !projectId ||
    !sessionId ||
    !gpuiLocalWorkspaceLifecycleProjectIdAllowed(projectId) ||
    !gpuiLocalWorkspaceLifecycleSessionIdAllowed(sessionId)
  ) {
    return undefined;
  }
  if (record.skipReplacementFallback !== undefined && record.skipReplacementFallback !== true) {
    return undefined;
  }
  if ((replacementProjectId && !replacementSessionId) || (!replacementProjectId && replacementSessionId)) {
    return undefined;
  }
  if (skipReplacementFallback && replacementProjectId && replacementSessionId) {
    return undefined;
  }
  if (
    replacementProjectId &&
    replacementSessionId &&
    (!gpuiLocalWorkspaceLifecycleProjectIdAllowed(replacementProjectId) ||
      !gpuiLocalWorkspaceLifecycleSessionIdAllowed(replacementSessionId))
  ) {
    return undefined;
  }
  return {
    action,
    projectId,
    ...(replacementProjectId && replacementSessionId
      ? { replacementProjectId, replacementSessionId }
      : {}),
    requestId: record.requestId,
    sessionId,
    skipReplacementFallback,
  };
}

function didGpuiGxserverProviderTransitionCommit(result: GxserverSessionTransitionResult): boolean {
  /*
  CDXC:GPUIWorkspaceLifecycle 2026-06-26-08:01:
  GPUI sleep must match macOS gxserver lifecycle ownership: `/api/transitionSession` resolving is not proof that zmx stopped. Only publish local sleep state after the returned session lifecycle matches the action, provider lifecycle is `missing`, and the optional kill result did not explicitly fail.
  */
  if (!isObjectRecord(result) || !isObjectRecord(result.session)) {
    return false;
  }
  const providerState = result.session.providerState;
  if (!isObjectRecord(providerState)) {
    return false;
  }
  const expectedLifecycleState = result.action === "sleep" ? "sleeping" : "stopped";
  const killSucceeded = readGpuiTransitionKillSucceeded(
    isObjectRecord(result.transition) ? result.transition : undefined,
  );
  return (
    result.session.lifecycleState === expectedLifecycleState &&
    providerState.lifecycleState === "missing" &&
    killSucceeded !== false
  );
}

function shouldApplyGpuiLocalWorkspaceTransition(
  result: GxserverSessionTransitionResult,
  action: "close" | "sleep",
): boolean {
  /*
  CDXC:GPUIWorkspaceLifecycle 2026-06-26-23:44:
  macOS close and sleep intentionally diverge after gxserver handles a provider transition. Close removes the local pane/sidebar row once `/api/transitionSession` returns a valid close result, even when provider kill did not commit; sleep must stay strict so GPUI does not show a cold sleeping placeholder while the zmx runtime is still live.
  */
  if (!isObjectRecord(result) || result.action !== action || !isObjectRecord(result.session)) {
    return false;
  }
  return action === "close" || didGpuiGxserverProviderTransitionCommit(result);
}

function readGpuiTransitionKillSucceeded(transition: Record<string, unknown> | undefined): boolean | undefined {
  const kill = transition?.kill;
  if (!isObjectRecord(kill)) {
    return undefined;
  }
  return typeof kill.killed === "boolean" ? kill.killed : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function gpuiLocalWorkspaceLifecycleProjectIdAllowed(value: string): boolean {
  return /^P[0-9][a-z0-9]{0,30}$/u.test(value);
}

function gpuiLocalWorkspaceLifecycleSessionIdAllowed(value: string): boolean {
  return (
    gpuiStatusPetActivationSessionIdAllowed(value) &&
    !value.includes(":") &&
    !parseGpuiRemotePresentationSessionId(value) &&
    !parseGxserverPresentationProjectSessionId(value)
  );
}

function gpuiMenuBarStatusSessionFocusRoutingId(projectId: string, sessionId: string): string {
  if (
    parseGpuiRemotePresentationSessionId(sessionId) ||
    parseGxserverPresentationProjectSessionId(sessionId)
  ) {
    return sessionId;
  }
  const remoteProject = parseGpuiRemotePresentationProjectId(projectId);
  if (remoteProject) {
    return createGpuiRemotePresentationSessionId(
      remoteProject.machineId,
      remoteProject.projectId,
      sessionId,
    );
  }
  return createGxserverPresentationProjectSessionId(projectId, sessionId);
}

function gpuiStatusPetActivationSessionIdAllowed(value: string): boolean {
  return (
    value.length <= GPUI_STATUS_INDICATOR_ID_MAX_CHARS &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function createGpuiRecentProjects(
  recentProjects: readonly GxserverRecentProjectDomainState[],
  settings: ghostexSettings,
): SidebarRecentProject[] {
  return recentProjects
    .flatMap((project) => {
      const projectId = typeof project.projectId === "string" ? project.projectId.trim() : "";
      const title = typeof project.title === "string" ? project.title.trim() : "";
      const path = normalizeGpuiProjectPath(project.path);
      if (!projectId || !title || !path) {
        return [];
      }
      const icon = normalizeWorkspaceProjectIcon(project.icon);
      const iconDataUrl = normalizeWorkspaceProjectIconDataUrl(project.iconDataUrl);
      const theme = normalizeGpuiSidebarTheme(project.theme) ??
        resolveSidebarTheme(settings.sidebarTheme, "dark");
      const themeColor = normalizeWorkspaceThemeColor(project.themeColor);
      const recentClosedAt =
        typeof project.recentClosedAt === "string" && project.recentClosedAt.trim().length > 0
          ? project.recentClosedAt.trim()
          : undefined;
      return [
        {
          ...(icon ? { icon } : {}),
          ...(iconDataUrl ? { iconDataUrl } : {}),
          ...(recentClosedAt ? { recentClosedAt } : {}),
          ...(themeColor ? { themeColor } : {}),
          path,
          projectId,
          sessionCount: Number.isFinite(project.sessionCount)
            ? Math.max(0, Math.floor(project.sessionCount))
            : 0,
          theme,
          title,
        },
      ];
    })
    .sort(compareGpuiRecentProjectsByClosedAt);
}

function createGpuiRemoteRecentProjects(
  recentProjectsByMachineId: ReadonlyMap<string, readonly GxserverRecentProjectDomainState[]> | undefined,
  presentationsByMachineId: ReadonlyMap<string, GxserverPresentationSnapshot> | undefined,
  settings: ghostexSettings,
): SidebarRecentProject[] {
  /*
  CDXC:GPUIRemoteProjects 2026-06-27-19:37:
  Remote Recent Projects are GPUI-client-local parking rows. Keep ids
  machine-scoped and reconcile display fields from a live remote presentation
  when connected, but do not call the remote daemon's recent endpoints or share
  the parked state with the macOS app.
  */
  if (!recentProjectsByMachineId) {
    return [];
  }
  const remoteMachinesById = new Map(
    settings.remoteMachines.map((machine) => [machine.id, machine]),
  );
  return [...recentProjectsByMachineId.entries()].flatMap(([machineId, recentProjects]) => {
    const machine = remoteMachinesById.get(machineId);
    if (!machine) {
      return [];
    }
    const presentation = presentationsByMachineId?.get(machineId);
    return recentProjects.flatMap((project) => {
      const projectId = typeof project.projectId === "string" ? project.projectId.trim() : "";
      const presentationProject = presentation?.projects.find(
        (candidate) => candidate.projectId === projectId,
      );
      if (presentation && !presentationProject) {
        return [];
      }
      const title =
        presentationProject?.title.trim() ||
        (typeof project.title === "string" ? project.title.trim() : "");
      const path = normalizeGpuiProjectPath(presentationProject?.path ?? project.path);
      if (!projectId || !title || !path) {
        return [];
      }
      const icon = normalizeWorkspaceProjectIcon(project.icon);
      const iconDataUrl = normalizeWorkspaceProjectIconDataUrl(project.iconDataUrl);
      const theme = normalizeGpuiSidebarTheme(project.theme) ??
        resolveSidebarTheme(settings.sidebarTheme, "dark");
      const themeColor = normalizeWorkspaceThemeColor(project.themeColor);
      const recentClosedAt =
        typeof project.recentClosedAt === "string" && project.recentClosedAt.trim().length > 0
          ? project.recentClosedAt.trim()
          : undefined;
      return [
        {
          ...(icon ? { icon } : {}),
          ...(iconDataUrl ? { iconDataUrl } : {}),
          ...(recentClosedAt ? { recentClosedAt } : {}),
          ...(themeColor ? { themeColor } : {}),
          path,
          projectId: createGpuiRemotePresentationProjectId(machineId, projectId),
          remoteMachineId: machineId,
          remoteMachineName: machine.name || "Remote",
          sessionCount: presentation
            ? countGpuiRemotePresentationProjectSessions(presentation, projectId)
            : Number.isFinite(project.sessionCount)
              ? Math.max(0, Math.floor(project.sessionCount))
              : 0,
          theme,
          title,
        },
      ];
    });
  });
}

function readStoredGpuiRemoteRecentProjects(): Map<string, GxserverRecentProjectDomainState[]> {
  try {
    return groupGpuiRemoteRecentProjectsByMachine(
      normalizeStoredGpuiRemoteRecentProjects(
        JSON.parse(localStorage.getItem(GPUI_REMOTE_RECENT_PROJECTS_STORAGE_KEY) ?? "[]"),
      ),
    );
  } catch {
    return new Map();
  }
}

function writeStoredGpuiRemoteRecentProjects(
  projectsByMachineId: ReadonlyMap<string, readonly GxserverRecentProjectDomainState[]>,
): void {
  try {
    const rows = [...projectsByMachineId.entries()].flatMap(([machineId, projects]) =>
      projects.flatMap((project) => {
        const projectId = typeof project.projectId === "string" ? project.projectId.trim() : "";
        const title = typeof project.title === "string" ? project.title.trim() : "";
        const path = typeof project.path === "string" ? project.path.trim() : "";
        if (!machineId.trim() || !projectId || !title) {
          return [];
        }
        return [
          {
            machineId: machineId.trim(),
            path,
            projectId,
            recentClosedAt: typeof project.recentClosedAt === "string" ? project.recentClosedAt : undefined,
            sessionCount: Number.isFinite(project.sessionCount)
              ? Math.max(0, Math.floor(project.sessionCount))
              : 0,
            title,
          },
        ];
      }),
    );
    /*
    CDXC:GPUIRemoteProjects 2026-06-27-19:37:
    GPUI remote recent rows are app-client state. Persist only machine id,
    remote project id, title/path needed for the disconnected drawer, timestamp,
    and count; do not persist tokens, SSH hosts, usernames, command text,
    terminal output, or local gxserver project rows.
    */
    localStorage.setItem(GPUI_REMOTE_RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // CEF storage may be unavailable in tests or early bootstrap; the in-memory rows still drive this session.
  }
}

function normalizeStoredGpuiRemoteRecentProjects(
  value: unknown,
): Array<{ machineId: string; project: GxserverRecentProjectDomainState }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return [];
    }
    const record = candidate as Record<string, unknown>;
    const machineId = normalizeNonEmptyString(record.machineId);
    const projectId = normalizeNonEmptyString(record.projectId);
    const title = normalizeNonEmptyString(record.title);
    if (!machineId || !projectId || !title) {
      return [];
    }
    const path = typeof record.path === "string" ? record.path.trim() : "";
    const recentClosedAt =
      typeof record.recentClosedAt === "string" &&
      record.recentClosedAt.trim().length > 0 &&
      Number.isFinite(Date.parse(record.recentClosedAt))
        ? record.recentClosedAt.trim()
        : undefined;
    const sessionCount = Number(record.sessionCount);
    return [
      {
        machineId,
        project: {
          path,
          projectId: projectId as GxserverProjectId,
          ...(recentClosedAt ? { recentClosedAt } : {}),
          sessionCount: Number.isFinite(sessionCount) && sessionCount > 0
            ? Math.floor(sessionCount)
            : 0,
          title,
        },
      },
    ];
  });
}

/*
CDXC:GPUIRemoteProjects 2026-06-27-21:59:
The GPUI start build runs through Vite/Rolldown, whose transformer accepts readonly array shorthand and ReadonlyArray<T> but rejects `readonly Array<T>`. Keep this helper input in ReadonlyArray<T> form so Remote Recent Projects packaging does not break local GPUI startup.
*/
function groupGpuiRemoteRecentProjectsByMachine(
  rows: ReadonlyArray<{ machineId: string; project: GxserverRecentProjectDomainState }>,
): Map<string, GxserverRecentProjectDomainState[]> {
  const projectsByMachineId = new Map<string, GxserverRecentProjectDomainState[]>();
  for (const row of rows) {
    projectsByMachineId.set(
      row.machineId,
      orderGpuiRecentProjects([
        row.project,
        ...(projectsByMachineId.get(row.machineId) ?? []).filter(
          (project) => project.projectId !== row.project.projectId,
        ),
      ]),
    );
  }
  return projectsByMachineId;
}

function orderGpuiRecentProjects(
  projects: readonly GxserverRecentProjectDomainState[],
): GxserverRecentProjectDomainState[] {
  return [...projects].sort(
    (left, right) =>
      Date.parse(right.recentClosedAt ?? "") - Date.parse(left.recentClosedAt ?? ""),
  );
}

function countGpuiRemotePresentationProjectSessions(
  presentation: GxserverPresentationSnapshot,
  projectId: string,
): number {
  return presentation.sessions.filter(
    (session) =>
      session.projectId === projectId &&
      session.visibleInSidebarByDefault === true &&
      session.surface !== "commands",
  ).length;
}

function normalizeGpuiSidebarTheme(value: unknown): SidebarTheme | undefined {
  if (value === "plain-dark") {
    return "dark-2";
  }
  return GPUI_SIDEBAR_THEME_VALUES.has(value as SidebarTheme)
    ? (value as SidebarTheme)
    : undefined;
}

const GPUI_SIDEBAR_THEME_VALUES = new Set<SidebarTheme>([
  "dark-1",
  "dark-2",
  "plain-dark",
  "plain-light",
  "dark-green",
  "dark-blue",
  "dark-red",
  "dark-pink",
  "dark-orange",
  "light-blue",
  "light-green",
  "light-pink",
  "light-orange",
]);

function compareGpuiRecentProjectsByClosedAt(
  left: SidebarRecentProject,
  right: SidebarRecentProject,
): number {
  /*
  CDXC:GPUIRecentProjects 2026-06-25-19:22:
  Native `compareRecentProjectsByClosedAt` only sorts parsed close time descending. The Recent Projects drawer contract does not include gxserver `updatedAt`, so GPUI must not invent title or id tie-breaks; stable sort preserves producer order for equal timestamps.
  */
  return gpuiRecentProjectClosedAtMillis(right) - gpuiRecentProjectClosedAtMillis(left);
}

function gpuiRecentProjectClosedAtMillis(project: SidebarRecentProject): number {
  const millis = Date.parse(project.recentClosedAt ?? "");
  return Number.isFinite(millis) ? millis : 0;
}

type GpuiPresentationProjectProjectionMetadata = {
  chatProjectIds: ReadonlySet<string>;
  hiddenProjectIds: ReadonlySet<string>;
  projectOverlays: readonly GxserverPresentationSidebarProjectOverlay[];
};

function createGpuiPresentationProjectProjectionMetadata({
  domainProjects,
  presentation,
  recentProjects,
}: {
  domainProjects: readonly GxserverProjectDomainState[];
  presentation: GxserverPresentationSnapshot;
  recentProjects?: readonly GxserverRecentProjectDomainState[];
}): GpuiPresentationProjectProjectionMetadata {
  const chatProjectIds = new Set<string>();
  /*
  CDXC:GPUIRecentProjects 2026-06-27-19:37:
  GPUI must match the macOS sidebar split: parked Recent Projects belong only in the React Recent Projects drawer, never in the main Projects list. Hide ids from both the domain project flag and the authoritative `/api/listRecentProjects` endpoint so presentation snapshots cannot briefly resurrect parked projects as normal groups.
  */
  const hiddenProjectIds = new Set(
    (recentProjects ?? [])
      .map((project) => typeof project.projectId === "string" ? project.projectId.trim() : "")
      .filter((projectId) => projectId.length > 0),
  );
  const projectOverlays: GxserverPresentationSidebarProjectOverlay[] = [];
  const domainProjectIds = new Set(domainProjects.map((project) => project.projectId));

  for (const project of domainProjects) {
    const isChatProject = isGpuiPresentationChatDomainProject(project);
    const isQuickProject = isGpuiPresentationQuickDomainProject(project);
    const iconDataUrl = gpuiPresentationProjectIconDataUrl(project);
    if (project.isRecentProject === true) {
      hiddenProjectIds.add(project.projectId);
    }
    if (isChatProject || isQuickProject) {
      chatProjectIds.add(project.projectId);
    }
    if (isChatProject || isQuickProject || iconDataUrl) {
      projectOverlays.push({
        ...(iconDataUrl ? { iconDataUrl } : {}),
        isChatProject,
        isQuickProject,
        projectId: project.projectId,
      });
    }
  }

  for (const project of presentation.projects) {
    if (domainProjectIds.has(project.projectId) || !isGpuiPresentationChatProjectPath(project.path)) {
      continue;
    }
    chatProjectIds.add(project.projectId);
    projectOverlays.push({
      isChatProject: true,
      isQuickProject: true,
      projectId: project.projectId,
    });
  }

  return {
    chatProjectIds,
    hiddenProjectIds,
    projectOverlays,
  };
}

function gpuiPresentationProjectIconDataUrl(
  project: GxserverProjectDomainState,
): string | undefined {
  /*
  CDXC:GPUISettingsNotifications 2026-06-26-07:22:
  Session-attention icon parity must source images only from gxserver project identity metadata already normalized for workspace project appearance. Do not infer icons from project paths, URLs, titles, sessions, browser favicons, logs, command output, or renderer-local state.
  */
  const identityIcon = project.identityIcon;
  if (!identityIcon) {
    return undefined;
  }
  const icon = normalizeWorkspaceProjectIcon(identityIcon.icon);
  if (icon?.kind === "image") {
    return icon.dataUrl;
  }
  return normalizeWorkspaceProjectIconDataUrl(identityIcon.iconDataUrl);
}

function isGpuiPresentationChatDomainProject(
  project: GxserverProjectDomainState | undefined,
): boolean {
  return booleanFromRecord(project as Record<string, unknown> | undefined, "isChat") === true ||
    booleanFromRecord(project?.launchSettings, "isChat") === true ||
    isGpuiPresentationChatProjectPath(project?.path);
}

function isGpuiPresentationQuickDomainProject(
  project: GxserverProjectDomainState | undefined,
): boolean {
  return booleanFromRecord(project as Record<string, unknown> | undefined, "isQuick") === true ||
    booleanFromRecord(project?.launchSettings, "isQuick") === true ||
    isGpuiPresentationChatDomainProject(project);
}

function isGpuiPresentationChatProjectPath(value: unknown): boolean {
  const path = normalizeGpuiProjectPath(value)?.replace(/\\/gu, "/").replace(/\/+$/u, "");
  if (!path) {
    return false;
  }
  /*
  CDXC:GPUISidebarProjectClassification 2026-06-24-22:51:
  Match macOS chat-project detection by storage root instead of display title. `~/ghostex/chats`, `~/.ghostex[-variant]/chats`, and host-provided Ghostex homes such as repo-local `.active/chats` are projectless Chats containers; arbitrary projects named "Chat ..." are not.
  */
  return (
    /(?:^|\/)(?:ghostex|\.ghostex(?:-[^/]+)?|\.active)\/chats(?:\/|$)/u.test(path) ||
    /^~\/(?:ghostex|\.ghostex(?:-[^/]+)?|\.active)\/chats(?:\/|$)/u.test(path)
  );
}

function createGpuiProjectSettingsProjects(
  domainProjects: readonly GxserverProjectDomainState[],
  presentation: GxserverPresentationSnapshot | undefined,
): SidebarProjectSettingsItem[] {
  if (domainProjects.length > 0) {
    return domainProjects.flatMap((project) => {
      const path = normalizeGpuiProjectPath(project.path);
      if (
        !path ||
        project.isRecentProject === true ||
        isGpuiPresentationQuickDomainProject(project)
      ) {
        return [];
      }
      return [
        {
          ...optionalGpuiProjectSettingsString("beadsDirectory", stringFromRecord(project.projectBoardConfig, "beadsDirectory")),
          ...optionalGpuiProjectSettingsString(
            "beadsDisplayKey",
            stringFromRecord(project.projectBoardConfig, "beadsDisplayKey") ??
              stringFromRecord(project.gitConfig, "beadsDisplayKey"),
          ),
          name: project.name,
          path,
          projectId: project.projectId,
          ...optionalGpuiProjectSettingsString(
            "worktreeCommand",
            stringFromRecord(project.gitConfig, "worktreeCommand"),
          ),
          ...optionalGpuiProjectSettingsString(
            "worktreeParentProjectId",
            normalizeGpuiWorktreeParentProjectId(project.worktree),
          ),
        },
      ];
    });
  }
  return (presentation?.projects ?? []).flatMap((project) => {
    const path = normalizeGpuiProjectPath(project.path);
    if (!path || isGpuiPresentationChatProjectPath(path)) {
      return [];
    }
    return [
      {
        name: project.title,
        path,
        projectId: project.projectId,
        ...optionalGpuiProjectSettingsString(
          "worktreeParentProjectId",
          normalizeGpuiWorktreeParentProjectId(project.worktree),
        ),
      },
    ];
  });
}

function optionalGpuiProjectSettingsString<TKey extends keyof SidebarProjectSettingsItem>(
  key: TKey,
  value: string | undefined,
): Partial<Pick<SidebarProjectSettingsItem, TKey>> {
  return value ? { [key]: value } as Partial<Pick<SidebarProjectSettingsItem, TKey>> : {};
}

function normalizeGpuiWorktreeParentProjectId(
  worktree: Record<string, unknown> | undefined,
): string | undefined {
  return stringFromRecord(worktree, "parentProjectId");
}

function normalizeGpuiWorktreeMetadata(
  worktree: Record<string, unknown> | undefined,
): GpuiWorktreeMetadata | undefined {
  const parentProjectId = normalizeGpuiWorktreeParentProjectId(worktree);
  if (!parentProjectId) {
    return undefined;
  }
  return {
    ...optionalStringField("branch", stringFromRecord(worktree, "branch")),
    ...optionalStringField("name", stringFromRecord(worktree, "name")),
    ...optionalStringField("parentProjectName", stringFromRecord(worktree, "parentProjectName")),
    parentProjectId,
  };
}

function stringFromRecord(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function booleanFromRecord(
  record: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function optionalStringField<TKey extends string>(
  key: TKey,
  value: string | undefined,
): Partial<Record<TKey, string>> {
  return value ? { [key]: value } as Partial<Record<TKey, string>> : {};
}

function parseGpuiGitNumstatFiles(stdout: string): SidebarGitChangedFile[] {
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const [additions, deletions, ...pathParts] = line.split(/\s+/);
      const path = normalizeGpuiRelativeGitFilePath(pathParts.join(" "));
      if (!path) {
        return [];
      }
      return [
        {
          additions: normalizeGpuiGitNumstatNumber(additions),
          deletions: normalizeGpuiGitNumstatNumber(deletions),
          path,
        },
      ];
    });
}

function parseGpuiGitStatusPorcelainFiles(stdout: string): SidebarGitChangedFile[] {
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.length >= 4)
    .flatMap((line) => {
      const rawPath = line.slice(3).trim();
      const path = normalizeGpuiRelativeGitFilePath(
        rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) ?? "" : rawPath,
      );
      return path ? [{ additions: 0, deletions: 0, path }] : [];
    });
}

function mergeGpuiGitChangedFiles(
  files: readonly SidebarGitChangedFile[],
): SidebarGitChangedFile[] {
  const mergedFiles = new Map<string, SidebarGitChangedFile>();
  for (const file of files) {
    const existing = mergedFiles.get(file.path);
    mergedFiles.set(file.path, {
      additions: Math.max(existing?.additions ?? 0, file.additions),
      deletions: Math.max(existing?.deletions ?? 0, file.deletions),
      path: file.path,
    });
  }
  return [...mergedFiles.values()];
}

function normalizeGpuiGitNumstatNumber(value: string | undefined): number {
  if (!value || value === "-") {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarizeGpuiGitChangedFiles(files: readonly SidebarGitChangedFile[]): {
  additions: number;
  deletions: number;
} {
  return files.reduce(
    (stats, file) => ({
      additions: stats.additions + file.additions,
      deletions: stats.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

function parseGpuiGitHubPullRequest(
  stdout: string,
  success: boolean,
): SidebarGitState["pr"] {
  if (!success || !stdout.trim()) {
    return null;
  }
  try {
    const candidate = JSON.parse(stdout) as Partial<NonNullable<SidebarGitState["pr"]>>;
    const state = String(candidate.state || "").toLowerCase();
    if (!candidate.url || !candidate.title || !["open", "closed", "merged"].includes(state)) {
      return null;
    }
    return {
      number: typeof candidate.number === "number" ? candidate.number : undefined,
      state: state as NonNullable<SidebarGitState["pr"]>["state"],
      title: candidate.title,
      url: candidate.url,
    };
  } catch {
    return null;
  }
}

function isGpuiConfirmedOpenPullRequest(result: GxserverCreatePullRequestResult): boolean {
  return (
    result.ok === true &&
    result.pr?.state === "open" &&
    typeof result.pr.url === "string" &&
    /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+$/u.test(result.pr.url)
  );
}

function isGpuiConfirmedOpenRemotePullRequest(result: GpuiRemoteCreatePullRequestResult): boolean {
  return result.ok === true && result.pr?.state === "open";
}

function normalizeGpuiGitHubRemoteUrl(remoteUrl: string): string | undefined {
  const trimmed = remoteUrl.trim().split(/\s+/)[0]?.replace(/\.git$/u, "") ?? "";
  if (!trimmed) {
    return undefined;
  }
  const sshMatch = /^git@github\.com:(?<path>[^#?]+)$/u.exec(trimmed);
  const sshPath = sshMatch?.groups?.path;
  if (sshPath) {
    return `https://github.com/${sshPath.replace(/^\/+/u, "").replace(/\.git$/u, "")}`;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname !== "github.com") {
      return undefined;
    }
    const repoPath = parsed.pathname.replace(/^\/+/u, "").replace(/\.git$/u, "");
    return repoPath ? `https://github.com/${repoPath}` : undefined;
  } catch {
    return undefined;
  }
}

function parseGpuiSidebarGitCommitMessage(message: string): {
  body: string;
  subject: string;
} {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    return { body: "", subject: "" };
  }
  const [firstLine = "", ...restLines] = trimmedMessage.split(/\r?\n/);
  return {
    body: restLines.join("\n").trim(),
    subject: firstLine.trim(),
  };
}

/*
CDXC:GPUISidebarGit 2026-06-24-16:11:
Blank commit-message generation in GPUI mirrors the native background prompt
support set. Built-in agents that do not expose a safe headless prompt mode
must fail explicitly, while configured non-default custom agents may use their
stored command through the local gxserver generation endpoint.
*/
function supportsGpuiBackgroundCommitMessageGeneration(agent: SidebarAgentButton): boolean {
  return (
    GPUI_BACKGROUND_COMMIT_MESSAGE_DEFAULT_AGENT_IDS.has(agent.agentId) ||
    !isDefaultSidebarAgentId(agent.agentId)
  );
}

function gpuiUserVisibleGitErrorMessage(error: unknown, fallback: string): string {
  return error instanceof GpuiUserVisibleGitError ? error.message : fallback;
}

function sanitizeGpuiSidebarGitBranchName(subject: string): string {
  return (
    subject
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/gu, "")
      .trim()
      .replace(/[\s_]+/gu, "-")
      .replace(/-+/gu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 48) || `change-${Date.now().toString(36)}`
  );
}

function normalizeGpuiRelativeGitFilePath(filePath: string): string | undefined {
  const normalizedFilePath = filePath.replaceAll("\\", "/").replace(/^\/+/, "").trim();
  if (!normalizedFilePath || normalizedFilePath.includes("\0")) {
    return undefined;
  }
  const segments = normalizedFilePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return undefined;
  }
  return normalizedFilePath;
}

function isMissingGpuiBeadsDatabaseError(message: string): boolean {
  return /no beads database found|run ['"]?bd init['"]?|not initialized|no storage/iu.test(message);
}

function resolveGpuiSidebarGitConfirmLabel(
  action: Extract<SidebarGitAction, "commit" | "pr" | "push">,
  hasCommit: boolean,
): string {
  if (action === "commit") {
    return "Commit";
  }
  if (action === "push") {
    return hasCommit ? "Commit & Push" : "Push";
  }
  return hasCommit ? "Commit, Push & PR" : "Push & Create PR";
}

function resolveGpuiSidebarGitPromptDescription(
  action: Extract<SidebarGitAction, "commit" | "pr" | "push">,
): string {
  if (action === "commit") {
    return "Review and commit changes.";
  }
  if (action === "push") {
    return "Push the current branch.";
  }
  return "Create or open a pull request.";
}

function resolveGpuiSidebarGitStartedTitle(
  action: Extract<SidebarGitAction, "commit" | "pr" | "push">,
  hasCommit: boolean,
): string {
  if (action === "pr") {
    return hasCommit ? "Committing, pushing, and creating PR" : "Pushing and creating PR";
  }
  if (action === "push") {
    return hasCommit ? "Committing and pushing" : "Pushing";
  }
  return "Committing";
}

function resolveGpuiSidebarGitFinishedTitle(
  action: Extract<SidebarGitAction, "commit" | "pr" | "push">,
): string {
  if (action === "pr") {
    return "Pull request ready";
  }
  return action === "push" ? "Push complete" : "Commit complete";
}

function formatGpuiGitAgentWorkflowTitle(title: string): string {
  const normalizedTitle = title.trim();
  return normalizedTitle.startsWith("Git:") ? normalizedTitle : `Git: ${normalizedTitle}`;
}

function buildGpuiGitSyncWithMainPrompt(): string {
  return [
    "Please sync the latest main branch changes into this worktree so it can be merged back to main afterward.",
    "",
    "Use the current repository and branch in this terminal. Inspect Git state directly before changing anything.",
    "",
    "Requirements:",
    "- Fetch the latest remote refs before syncing.",
    "- Bring main into this worktree branch using the safest normal project workflow for this repository, such as merge or rebase only if that is clearly the repo convention.",
    "- Preserve work from both main and this worktree. If conflicts happen, resolve them without dropping code, behavior, or UX from either side.",
    "- After resolving conflicts, run the relevant checks you can run locally.",
    "- Leave the worktree branch ready for the user to merge back into main.",
    "- Stop and explain clearly if the repository state is unsafe or if a decision is needed.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildGpuiGitPullRequestAgentPrompt(input: {
  filePaths?: readonly string[];
  hasExplicitFileSelection: boolean;
  hasCommit: boolean;
  message: string;
  selectedFiles: readonly string[];
}): string {
  const selectedFiles = input.selectedFiles.filter((filePath) => filePath.trim().length > 0);
  return [
    "Please complete the Git pull request flow in this terminal.",
    "",
    "Use the current repository checkout in this terminal. Inspect branch, remote, and PR state directly before changing anything.",
    "",
    "Do these steps visibly:",
    input.hasCommit
      ? input.hasExplicitFileSelection
        ? "- Stage and commit only the selected files listed below. Do not stage excluded files."
        : "- Stage and commit all new/modified files."
      : "- There were no working tree changes when the modal opened, so skip committing unless you find new user changes.",
    input.message
      ? "- Use the requested commit message below unless it is clearly invalid for the actual diff."
      : "- Write a concise commit message that matches the staged diff.",
    "- If you encounter conflicts, rebases, merge state, or divergent local/remote changes, make sure not to lose changes from either side.",
    "- Push the current branch to origin, setting upstream if needed.",
    "- Create a GitHub pull request with `gh pr create --fill`, or open/show the existing PR if one already exists.",
    "- Stop and explain clearly if a command fails, authentication is missing, or a merge/rebase/conflict situation needs the user's decision.",
    "",
    input.hasExplicitFileSelection && selectedFiles.length > 0
      ? ["Selected files:", ...selectedFiles.map((filePath) => `- ${filePath}`)].join("\n")
      : "Selected files: all new/modified files.",
    input.message ? `\nRequested commit message:\n${input.message}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildGpuiMergeConflictPrompt(input: {
  branch: string;
  mergeOutput: string;
  parentProject: GxserverProjectDomainState;
  worktree: GpuiWorktreeMetadata;
  worktreeProject: GxserverProjectDomainState;
}): string {
  const output = input.mergeOutput.trim();
  const worktreeName = input.worktree.name ?? input.worktreeProject.name ?? "this worktree";
  const parentName = input.parentProject.name || input.worktree.parentProjectName || "the main project";
  return [
    "Please handle the current Git merge conflicts on the main branch.",
    "",
    `Target project: ${parentName}`,
    "Target branch: main",
    `Merged worktree branch: ${input.branch}`,
    `Worktree: ${worktreeName}`,
    "",
    "Resolve the conflicts without losing any code, behavior, or UX from either side.",
    "Inspect the conflict markers, preserve the important intent from main and the worktree branch, run the relevant checks you can run locally, stage the resolved files, and leave the final state ready for review.",
    output ? `\nMerge output:\n${output}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function hasGpuiGxserverShortStatusChanges(stdout: string): boolean {
  return stdout
    .split("\n")
    .some((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("##");
    });
}

function normalizeGpuiProjectPath(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().replace(/\/+$/u, "")
    : undefined;
}

function normalizeGpuiWorktreeBaseBranches(
  branches: GxserverTypedOperationResult["branches"],
): Array<{ current: boolean; name: string; remote: boolean }> {
  const seenBranches = new Set<string>();
  return (branches ?? []).flatMap((branch) => {
    const name = branch.name?.trim();
    if (!name || seenBranches.has(name)) {
      return [];
    }
    seenBranches.add(name);
    return [
      {
        current: branch.current === true,
        name,
        remote: branch.remote === true,
      },
    ];
  });
}

function normalizeGpuiExistingWorktreeOptions(
  worktrees: GxserverProjectWorktreeListResult["worktrees"] | unknown,
): Array<{
  branch: string;
  isCurrentProject: boolean;
  isRegistered: boolean;
  name: string;
  path: string;
  worktreeKey: string;
}> {
  if (!Array.isArray(worktrees)) {
    return [];
  }
  return worktrees.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const worktree = entry as Record<string, unknown>;
    const path = normalizeGpuiProjectPath(worktree.path);
    const name =
      stringFromRecord(worktree, "name") ?? (path ? gpuiProjectNameFromPath(path) : undefined);
    const worktreeKey = stringFromRecord(worktree, "worktreeKey");
    if (!path || !name || !worktreeKey) {
      return [];
    }
    return [
      {
        branch: stringFromRecord(worktree, "branch") ?? "",
        isCurrentProject: booleanFromRecord(worktree, "isCurrentProject") === true,
        isRegistered: booleanFromRecord(worktree, "isRegistered") === true,
        name,
        path,
        worktreeKey,
      },
    ];
  });
}

function createGpuiExistingWorktreeOptions(
  worktrees: GxserverTypedOperationResult["worktrees"],
  parentProject: GxserverProjectDomainState,
  sourceProject: GxserverProjectDomainState,
  domainProjects: readonly GxserverProjectDomainState[],
): Array<{
  branch: string;
  isCurrentProject: boolean;
  isRegistered: boolean;
  name: string;
  path: string;
}> {
  const entries = worktrees ?? [];
  const mainEntry = entries.find((entry) => entry.bare !== true);
  const mainPath = normalizeGpuiProjectPath(mainEntry?.path) ?? normalizeGpuiProjectPath(parentProject.path);
  const sourcePath = normalizeGpuiProjectPath(sourceProject.path);
  const registeredPaths = new Set(
    domainProjects
      .map((project) => normalizeGpuiProjectPath(project.path))
      .filter((path): path is string => Boolean(path)),
  );
  return entries.flatMap((entry) => {
    if (entry.bare === true) {
      return [];
    }
    const path = normalizeGpuiProjectPath(entry.path);
    if (!path || path === mainPath) {
      return [];
    }
    return [
      {
        branch: entry.branch?.trim() ?? "",
        isCurrentProject: path === sourcePath,
        isRegistered: registeredPaths.has(path),
        name: gpuiProjectNameFromPath(path),
        path,
      },
    ];
  });
}

function gpuiProjectNameFromPath(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "Project";
}

function gpuiDirname(path: string): string {
  const parts = path.replace(/\/+$/u, "").split("/").filter(Boolean);
  if (parts.length <= 1) {
    return "/";
  }
  return `/${parts.slice(0, -1).join("/")}`;
}

function gpuiWorktreeSlugFromPrompt(prompt: string): string {
  const firstWords = prompt
    .trim()
    .toLowerCase()
    .replace(/[`'"]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 6)
    .join("-");
  return (firstWords || "worktree").slice(0, 48).replace(/-+$/u, "") || "worktree";
}

function createGpuiWorktreeToastId(): string {
  return `toast-gpui-worktree-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createGpuiGitToastId(): string {
  return `toast-gpui-git-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function gpuiWorktreeUserVisibleErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  if (
    message &&
    !message.includes("/") &&
    !message.includes("\\") &&
    !message.includes("\n") &&
    message.length <= 160
  ) {
    return message;
  }
  return "The gxserver worktree operation failed.";
}

function createGpuiGxserverUnavailableSidebarGroups(): SidebarSessionGroup[] {
  return [
    {
      groupId: GPUI_GXSERVER_CHATS_GROUP_ID,
      isActive: false,
      isChatCollection: true,
      isFocusModeActive: false,
      kind: "workspace",
      layoutVisibleCount: GPUI_DEFAULT_VISIBLE_COUNT,
      sessions: [],
      title: "Chats",
      viewMode: "grid",
      visibleCount: GPUI_DEFAULT_VISIBLE_COUNT,
    },
    {
      groupId: GPUI_GXSERVER_UNAVAILABLE_GROUP_ID,
      isActive: true,
      isFocusModeActive: false,
      kind: "workspace",
      layoutVisibleCount: GPUI_DEFAULT_VISIBLE_COUNT,
      sessions: [],
      title: "",
      viewMode: "grid",
      visibleCount: GPUI_DEFAULT_VISIBLE_COUNT,
    },
  ];
}

function createGpuiRemotePresentationSidebarGroups({
  activeGroupId,
  focusedSessionId,
  presentationsByMachineId,
  remoteRecentProjectsByMachineId,
  resolveAgentIcon,
  resolveCloseAfterDone,
  settings,
  visibleSessionIds,
}: {
  activeGroupId?: string;
  focusedSessionId?: string;
  presentationsByMachineId: ReadonlyMap<string, GxserverPresentationSnapshot>;
  remoteRecentProjectsByMachineId?: ReadonlyMap<string, readonly GxserverRecentProjectDomainState[]>;
  resolveAgentIcon: (agentName: string | undefined) => SidebarAgentButton["icon"];
  resolveCloseAfterDone?: (
    machineId: string,
    projectId: string,
    sessionId: string,
  ) => GxserverPresentationCloseAfterDoneProjection | undefined;
  settings: ghostexSettings;
  visibleSessionIds?: ReadonlySet<string>;
}): SidebarSessionGroup[] {
  /*
  CDXC:GPUIRemoteMachines 2026-06-24-16:48:
  GPUI remote machine sections must render only saved machines with Rust-delivered gxserver presentation snapshots. Prefix every project/session id with the machine id so reused SidebarApp rows cannot collide with local gxserver rows or another remote machine, while tokens, SSH hosts, usernames, key paths, and remote URLs stay outside renderer state.
  */
  return settings.remoteMachines.flatMap((machine) => {
    const presentation = presentationsByMachineId.get(machine.id);
    if (!presentation) {
      return [];
    }
    const sessionsByProject = createGxserverPresentationSessionsByProjectFromGroups({
      presentation,
    });
    const projectsById = new Map(
      presentation.projects.map((project) => [project.projectId, project]),
    );
    return presentation.groups.flatMap((group) => {
      const project = projectsById.get(group.projectId);
      if (!project) {
        return [];
      }
      if (isGpuiRemoteProjectClosedToRecent(machine.id, project.projectId, remoteRecentProjectsByMachineId)) {
        return [];
      }
      return [
        createGpuiRemotePresentationSidebarGroup({
          activeGroupId,
          focusedSessionId,
          machineId: machine.id,
          machineName: machine.name,
          project,
          resolveAgentIcon,
          resolveCloseAfterDone,
          sessions: sessionsByProject.get(project.projectId) ?? [],
          settings,
          visibleSessionIds,
        }),
      ];
    });
  });
}

function isGpuiRemoteProjectClosedToRecent(
  machineId: string,
  projectId: string,
  recentProjectsByMachineId: ReadonlyMap<string, readonly GxserverRecentProjectDomainState[]> | undefined,
): boolean {
  /*
  CDXC:GPUIRemoteProjects 2026-06-27-19:37:
  Connected remote presentation projects render under their saved-machine sections, while client-parked remote projects render only as machine-scoped rows in Recent Projects. Filter the remote machine projection with GPUI's app-local recent list instead of mutating the remote gxserver project state.
  */
  return (recentProjectsByMachineId?.get(machineId) ?? []).some(
    (project) => project.projectId === projectId,
  );
}

function createGpuiRemotePresentationSidebarGroup({
  activeGroupId,
  focusedSessionId,
  machineId,
  machineName,
  project,
  resolveAgentIcon,
  resolveCloseAfterDone,
  sessions,
  settings,
  visibleSessionIds,
}: {
  activeGroupId?: string;
  focusedSessionId?: string;
  machineId: string;
  machineName: string;
  project: GxserverPresentationProject;
  resolveAgentIcon: (agentName: string | undefined) => SidebarAgentButton["icon"];
  resolveCloseAfterDone?: (
    machineId: string,
    projectId: string,
    sessionId: string,
  ) => GxserverPresentationCloseAfterDoneProjection | undefined;
  sessions: readonly GxserverPresentationSession[];
  settings: ghostexSettings;
  visibleSessionIds?: ReadonlySet<string>;
}): SidebarSessionGroup {
  const groupId = createGpuiRemotePresentationGroupId(machineId, project.projectId);
  const isActiveGroup = groupId === activeGroupId;
  const scopedProjectId = createGpuiRemotePresentationProjectId(machineId, project.projectId);
  const focusedRemoteSession = focusedSessionId
    ? parseGpuiRemotePresentationSessionId(focusedSessionId)
    : undefined;
  const focusedSessionIdForGroup =
    isActiveGroup &&
    focusedRemoteSession?.machineId === machineId &&
    focusedRemoteSession.projectId === project.projectId
      ? focusedRemoteSession.sessionId
      : undefined;
  const visibleSessionIdsForGroup = new Set(
    [...(visibleSessionIds ?? [])].flatMap((sessionId) => {
      const reference = parseGpuiRemotePresentationSessionId(sessionId);
      if (
        !isActiveGroup ||
        reference?.machineId !== machineId ||
        reference.projectId !== project.projectId
      ) {
        return [];
      }
      return [reference.sessionId];
    }),
  );
  const group = createGxserverPresentationSidebarGroup({
    activeProjectId: isActiveGroup ? project.projectId : undefined,
    canRemoveProject: false,
    createProjectGroupId: (projectId) =>
      createGpuiRemotePresentationGroupId(machineId, projectId),
    createProjectSessionId: (projectId, sessionId) =>
      createGpuiRemotePresentationSessionId(machineId, projectId, sessionId),
    project,
    projectOverlay: {
      editor: {
        diffStats: createDefaultSidebarProjectDiffStats(),
        isOpen: false,
        isSleeping: false,
        projectId: scopedProjectId,
        status: "idle",
      },
      path: project.path ?? "",
      projectId: project.projectId,
      theme: resolveSidebarTheme(settings.sidebarTheme, "dark"),
    },
    focusedSessionId: focusedSessionIdForGroup,
    resolveAgentIcon,
    resolveCloseAfterDone: resolveCloseAfterDone
      ? (projectId, sessionId) => resolveCloseAfterDone(machineId, projectId, sessionId)
      : undefined,
    resolveSessionRoutingId: (projectId, sessionId) =>
      createGpuiRemotePresentationSessionRoutingId(machineId, projectId, sessionId),
    sessions,
    visibleSessionIds: visibleSessionIdsForGroup,
  });
  return {
    ...group,
    groupId,
    isActive: isActiveGroup,
    projectContext: group.projectContext
      ? {
          ...group.projectContext,
          canRemoveProject: false,
          path: project.path ?? "",
        }
      : group.projectContext,
    remoteMachineContext: {
      machineId,
      machineName,
    },
  };
}

function compareGpuiRemoteAttachCandidateSessions(
  left: GxserverPresentationSession,
  right: GxserverPresentationSession,
): number {
  const score = (session: GxserverPresentationSession): number => {
    let value = 0;
    if (session.lifecycleState === "running") {
      value += 100;
    }
    if (session.activity === "attention") {
      value += 40;
    } else if (session.activity === "working") {
      value += 30;
    }
    if (session.isPinned) {
      value += 10;
    }
    if (session.isFavorite) {
      value += 5;
    }
    return value;
  };
  const scoreDelta = score(right) - score(left);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  const rightTime = Date.parse(right.lastActiveAt ?? right.updatedAt ?? right.createdAt);
  const leftTime = Date.parse(left.lastActiveAt ?? left.updatedAt ?? left.createdAt);
  return (Number.isFinite(rightTime) ? rightTime : 0) -
    (Number.isFinite(leftTime) ? leftTime : 0);
}

function createGpuiRemotePresentationGroupId(machineId: string, projectId: string): string {
  return `remote:${machineId}:group:${projectId}`;
}

function parseGpuiRemotePresentationGroupId(
  groupId: string,
): { machineId: string; projectId: string } | undefined {
  const match = /^remote:([^:]+):group:(.+)$/u.exec(groupId);
  if (!match) {
    return undefined;
  }
  return { machineId: match[1]!, projectId: match[2]! };
}

function createGpuiRemotePresentationProjectId(machineId: string, projectId: string): string {
  return `remote:${machineId}:project:${projectId}`;
}

function parseGpuiRemotePresentationProjectId(
  projectId: string,
): { machineId: string; projectId: string } | undefined {
  const match = /^remote:([^:]+):project:(.+)$/u.exec(projectId);
  if (!match) {
    return undefined;
  }
  return { machineId: match[1]!, projectId: match[2]! };
}

function createGpuiRemotePresentationSessionId(
  machineId: string,
  projectId: string,
  sessionId: string,
): string {
  return `remote:${machineId}:session:${projectId}:${sessionId}`;
}

function parseGpuiRemotePresentationSessionId(
  sessionId: string,
): { machineId: string; projectId: string; sessionId: string } | undefined {
  const match = /^remote:([^:]+):session:([^:]+):(.+)$/u.exec(sessionId);
  if (!match) {
    return undefined;
  }
  return { machineId: match[1]!, projectId: match[2]!, sessionId: match[3]! };
}

function createGpuiRemotePresentationSessionRoutingId(
  machineId: string,
  projectId: string,
  sessionId: string,
): string {
  return `${machineId}:${projectId}:${sessionId}`;
}

function createGpuiSidebarGroupsPatch(
  previousGroups: readonly SidebarSessionGroup[],
  nextGroups: SidebarSessionGroup[],
): GpuiSidebarGroupsPatch {
  const previousGroupIds = new Set(previousGroups.map((group) => group.groupId));
  const nextGroupIds = new Set(nextGroups.map((group) => group.groupId));
  const previousSessionIds = new Set(previousGroups.flatMap((group) => group.sessions.map((session) => session.sessionId)));
  const nextSessionIds = new Set(nextGroups.flatMap((group) => group.sessions.map((session) => session.sessionId)));
  return {
    groupOrder: nextGroups.map((group) => group.groupId),
    groups: nextGroups,
    removedGroupIds: [...previousGroupIds].filter((groupId) => !nextGroupIds.has(groupId)),
    removedSessionIds: [...previousSessionIds].filter((sessionId) => !nextSessionIds.has(sessionId)),
  };
}

function gxserverSearchResultToPreviousSessionItem(
  result: GxserverPresentationSearchResult,
  options: { historyIdPrefix?: string; projectNamePrefix?: string } = {},
): SidebarPreviousSessionItem {
  const title = result.displayTitle || result.primaryTitle || result.title || "Previous Session";
  const closedAt = result.closedAt ?? result.updatedAt ?? result.createdAt;
  const agentName = result.agentName ?? result.agentId;
  const sessionPersistenceProvider = result.sessionPersistenceProvider ?? "zmx";
  const sessionPersistenceName = result.sessionPersistenceName ?? result.zmxName;
  return {
    activity: "idle",
    agentIcon: resolveGpuiSidebarAgentIcon(result.agentIcon ?? agentName),
    agentSessionId: result.agentSessionId,
    alias: title,
    closedAt,
    column: 0,
    displayTitle: result.displayTitle,
    displayTitleTooltip: result.displayTitleTooltip,
    historyId: `${options.historyIdPrefix ?? "gxserver"}:${result.projectId}:${result.sessionId}`,
    isFavorite: result.isFavorite,
    isFocused: false,
    isGeneratedName: false,
    isPinned: result.isPinned,
    isPrimaryTitleTerminalTitle: result.isPrimaryTitleTerminalTitle,
    isRestorable: true,
    isRunning: false,
    isVisible: false,
    lastInteractionAt: result.lastActiveAt,
    lifecycleState: "done",
    primaryTitle: result.primaryTitle ?? title,
    projectId: result.projectId,
    projectName: options.projectNamePrefix
      ? `${options.projectNamePrefix} / ${result.projectTitle}`
      : result.projectTitle,
    row: 0,
    sessionId: result.sessionId,
    sessionKind: "terminal",
    sessionPersistenceName,
    sessionPersistenceProvider,
    sessionTag: result.sessionTag,
    shortcutLabel: "",
    terminalTitle: result.terminalTitle,
  };
}

function comparePreviousSessionItemsByClosedTime(
  left: SidebarPreviousSessionItem,
  right: SidebarPreviousSessionItem,
): number {
  return previousSessionClosedTime(right) - previousSessionClosedTime(left);
}

function previousSessionClosedTime(session: SidebarPreviousSessionItem): number {
  const time = Date.parse(session.closedAt);
  return Number.isFinite(time) ? time : 0;
}

function parseGpuiGxserverPreviousSessionHistoryId(
  historyId: string,
): { projectId: string; sessionId: string } | undefined {
  const match = /^gxserver:([^:]+):([^:]+)$/u.exec(historyId);
  if (!match) {
    return undefined;
  }
  return { projectId: match[1]!, sessionId: match[2]! };
}

function parseGpuiRemotePreviousSessionHistoryId(
  historyId: string,
): { machineId: string; projectId: string; sessionId: string } | undefined {
  const match = /^remote-gxserver:([^:]+):([^:]+):([^:]+)$/u.exec(historyId);
  if (!match) {
    return undefined;
  }
  return { machineId: match[1]!, projectId: match[2]!, sessionId: match[3]! };
}

function previousSessionTitle(
  previousSession: SidebarPreviousSessionItem | undefined,
): string {
  return (
    previousSession?.primaryTitle ||
    previousSession?.terminalTitle ||
    previousSession?.alias ||
    DEFAULT_TERMINAL_SESSION_TITLE
  );
}

function resolveGpuiSidebarAgentIcon(agentName: string | undefined): SidebarAgentButton["icon"] {
  const directIcon = getSidebarAgentIconById(agentName);
  if (directIcon) {
    return directIcon;
  }

  const normalizedAgentName = agentName?.trim().toLowerCase();
  if (!normalizedAgentName) {
    return undefined;
  }
  return DEFAULT_SIDEBAR_AGENTS.find(
    (agent) =>
      agent.agentId === normalizedAgentName ||
      agent.name.trim().toLowerCase() === normalizedAgentName ||
      agent.icon === normalizedAgentName,
  )?.icon;
}

function createGpuiSidebarSessionRoutingId(projectId: string, sessionId: string): string {
  return `${projectId}:${sessionId}`;
}

function currentGpuiRuntimeSettings(): GpuiSidebarRuntimeSettings | undefined {
  return window.ghostexGpui?.runtimeSettings;
}

function hasSameGpuiRuntimeSettings(
  previous: GpuiSidebarRuntimeSettings | undefined,
  next: GpuiSidebarRuntimeSettingsSnapshot,
): boolean {
  return (
    previous?.debuggingMode === next.debuggingMode &&
    previous?.showBetaFeatures === next.showBetaFeatures &&
    previous?.settings === next.settings
  );
}

function normalizeGpuiNativeAppShotPromptResult(
  value: unknown,
): { ok: boolean; sessionId: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    record.type !== GPUI_SIDEBAR_NATIVE_APP_SHOT_PROMPT_RESULT_MESSAGE_TYPE ||
    record.version !== GPUI_SIDEBAR_NATIVE_APP_SHOT_PROMPT_RESULT_MESSAGE_VERSION ||
    typeof record.ok !== "boolean"
  ) {
    return undefined;
  }
  const sessionId = normalizeNonEmptyString(record.sessionId);
  return sessionId
    ? { ok: record.ok, sessionId }
    : undefined;
}

function nativeAppShotPromptSessionIdForSidebarSession(
  session: SidebarSessionItem | undefined,
): string | undefined {
  if (!session) {
    return undefined;
  }
  const remoteSession = parseGpuiRemotePresentationSessionId(session.sessionId);
  if (remoteSession) {
    return createGpuiRemotePresentationSessionId(
      remoteSession.machineId,
      remoteSession.projectId,
      remoteSession.sessionId,
    );
  }
  return localGxserverSessionIdForSidebarSession(session);
}

function localGxserverSessionIdForSidebarSession(
  session: SidebarSessionItem | undefined,
): string | undefined {
  if (!session || parseGpuiRemotePresentationSessionId(session.sessionId)) {
    return undefined;
  }
  return (
    parseGxserverPresentationProjectSessionId(session.sessionId)?.sessionId ??
    normalizeNonEmptyString(session.sessionId)
  );
}

function localGxserverProjectIdForSidebarSession(
  session: SidebarSessionItem,
  presentation: GxserverPresentationSnapshot | undefined,
): string | undefined {
  const scopedSession = parseGxserverPresentationProjectSessionId(session.sessionId);
  if (scopedSession?.projectId) {
    return scopedSession.projectId;
  }
  const sessionId = localGxserverSessionIdForSidebarSession(session);
  return sessionId
    ? presentation?.sessions.find((candidate) => candidate.sessionId === sessionId)?.projectId
    : undefined;
}

function isNativeAppShotAgentSession(
  session: SidebarSessionItem | undefined,
): session is SidebarSessionItem {
  if (!session) {
    return false;
  }
  if (session.sessionKind !== "terminal" || session.isSleeping === true) {
    return false;
  }
  if (session.lifecycleState === "sleeping" || session.isLive !== true) {
    return false;
  }
  return Boolean(session.agentIcon);
}

function normalizeGpuiNativeAppShotCapture(value: unknown): GpuiNativeAppShotCapture | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    record.type !== GPUI_SIDEBAR_NATIVE_APP_SHOT_MESSAGE_TYPE ||
    record.version !== GPUI_SIDEBAR_NATIVE_APP_SHOT_MESSAGE_VERSION
  ) {
    return undefined;
  }
  const appName = normalizeGpuiNativeAppShotString(record.appName, 256);
  const imagePath = normalizeGpuiNativeAppShotImagePath(record.imagePath);
  if (!appName || !imagePath) {
    return undefined;
  }
  const bundleIdentifier = normalizeGpuiNativeAppShotString(record.bundleIdentifier, 256);
  const windowTitle = normalizeGpuiNativeAppShotString(record.windowTitle, 512);
  const windowWidth = normalizeGpuiNativeAppShotDimension(record.windowWidth);
  const windowHeight = normalizeGpuiNativeAppShotDimension(record.windowHeight);
  const trigger = normalizeGpuiNativeAppShotTrigger(record.trigger);
  const appShot: GpuiNativeAppShotCapture = {
    appName,
    imagePath,
  };
  if (bundleIdentifier) {
    appShot.bundleIdentifier = bundleIdentifier;
  }
  if (windowTitle) {
    appShot.windowTitle = windowTitle;
  }
  if (windowWidth) {
    appShot.windowWidth = windowWidth;
  }
  if (windowHeight) {
    appShot.windowHeight = windowHeight;
  }
  if (trigger) {
    appShot.trigger = trigger;
  }
  return appShot;
}

function normalizeGpuiNativeAppShotImagePath(value: unknown): string | undefined {
  const path = normalizeGpuiNativeAppShotString(value, 4096);
  if (!path || !path.startsWith("~/.ghostex/i/")) {
    return undefined;
  }
  return path;
}

function normalizeGpuiNativeAppShotString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/u.test(text)) {
    return undefined;
  }
  return text;
}

function normalizeGpuiNativeAppShotDimension(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > 100_000) {
    return undefined;
  }
  return value;
}

function normalizeGpuiNativeAppShotTrigger(value: unknown): string | undefined {
  const trigger = normalizeGpuiNativeAppShotString(value, 80);
  return trigger === "both-command" ||
    trigger === "both-shift" ||
    trigger === "both-option" ||
    trigger === "double-left-shift" ||
    trigger === "double-left-option"
    ? trigger
    : undefined;
}

function formatGpuiNativeAppShotPrompt(
  appShot: GpuiNativeAppShotCapture,
  includeMetadata: boolean,
): string {
  const metadataLines = [`App: ${appShot.appName}`];
  if (appShot.bundleIdentifier) {
    metadataLines.push(`Bundle ID: ${appShot.bundleIdentifier}`);
  }
  if (appShot.windowTitle) {
    metadataLines.push(`Window title: ${appShot.windowTitle}`);
  }
  if (appShot.windowWidth && appShot.windowHeight) {
    metadataLines.push(`Window size: ${appShot.windowWidth} x ${appShot.windowHeight} px`);
  }
  /*
  CDXC:GPUIAppShots 2026-06-25-23:07:
  GPUI formats App Shot prompts like macOS using only native-supplied app/window metadata and the `~/.ghostex/i` display path. The prompt must not include OCR, Accessibility text, DOM text, terminal content, stdout/stderr, commands, URLs, or renderer-supplied file paths.

  CDXC:GPUIAppShots 2026-06-29-01:29:
  Superseded by 2026-06-29-02:59.

  CDXC:GPUIAppShots 2026-06-29-02:59:
  App Shot prompt text should paste only the image link by default, with no intro sentence, no closing instruction, no blank spacer lines, and one newline of padding before and after. Add WindowServer metadata only when the Settings App Shots metadata toggle is enabled.
  */
  const promptLines = [`[Image #1](${appShot.imagePath})`];
  if (includeMetadata) {
    promptLines.push("Metadata:", ...metadataLines);
  }
  return `\n${promptLines.join("\n")}\n`;
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

const GPUI_CLOSE_AFTER_DONE_DELAY_MS = 3 * 60_000;
const GPUI_CLOSE_AFTER_DONE_STORAGE_KEY = "ghostex-gpui-close-after-done-session-ids";

type GpuiCloseAfterDoneTimer = {
  deadlineAtMs?: number;
  doneSinceAtMs?: number;
  timeoutId?: number;
};

function isGpuiInactiveProjectPresentationSession(
  session: GxserverPresentationSession,
): boolean {
  return (
    session.lifecycleState !== "sleeping" &&
    session.activity !== "working" &&
    session.activity !== "attention"
  );
}

function isGpuiCloseAfterDonePresentationSessionDone(
  session: GxserverPresentationSession,
): boolean {
  if (session.activity === "attention") {
    return true;
  }
  return session.activity !== "working" && hasGpuiCloseAfterDoneAgentIdentity(session);
}

function hasGpuiCloseAfterDoneAgentIdentity(session: GxserverPresentationSession): boolean {
  return Boolean(
    session.agentSessionId?.trim() ||
      session.agentSessionPath?.trim() ||
      session.agentName?.trim() ||
      session.agentId?.trim() ||
      session.agentIcon?.trim(),
  );
}

function formatGpuiCloseAfterDoneCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const paddedMinutes = String(minutes).padStart(2, "0");
  const paddedSeconds = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${paddedMinutes}:${paddedSeconds}`;
  }
  return `${paddedMinutes}:${paddedSeconds}`;
}

function readStoredGpuiCloseAfterDoneSessionIds(): string[] {
  try {
    const raw = window.localStorage.getItem(GPUI_CLOSE_AFTER_DONE_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
  } catch {
    return [];
  }
}

function writeStoredGpuiCloseAfterDoneSessionIds(sessionIds: readonly string[]): void {
  try {
    if (sessionIds.length === 0) {
      window.localStorage.removeItem(GPUI_CLOSE_AFTER_DONE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      GPUI_CLOSE_AFTER_DONE_STORAGE_KEY,
      JSON.stringify([...sessionIds]),
    );
  } catch {
    // Storage availability must never gate close-after-done behavior.
  }
}

function normalizeGpuiWorkspaceFolderPick(
  payload: unknown,
): { name?: string; path: string } | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const record = payload as { name?: unknown; path?: unknown; type?: unknown };
  if (record.type !== "workspaceFolderPicked") {
    return undefined;
  }
  const path = normalizeNonEmptyString(record.path);
  if (!path) {
    return undefined;
  }
  return { name: normalizeNonEmptyString(record.name), path };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text.trim() ? JSON.parse(text) as unknown : undefined;
}

function isGxserverRpcSuccess<TResult>(
  value: unknown,
): value is GpuiGxserverRpcSuccess<TResult> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as Partial<GpuiGxserverRpcSuccess<TResult>>).ok === true &&
    (value as Partial<GpuiGxserverRpcSuccess<TResult>>).product === "gxserver" &&
    "result" in value
  );
}

function parseObject(value: unknown): Record<string, unknown> | undefined {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

async function handleGpuiRendererCommand(
  socket: WebSocket,
  command: GxserverRendererCommand,
  handler: GpuiRendererCommandHandler,
): Promise<void> {
  try {
    const result = await handler(command);
    socket.send(JSON.stringify({
      commandId: command.commandId,
      ok: true,
      result: isObjectRecord(result) ? result : { ok: true },
      type: "rendererCommandResult",
    }));
  } catch (error) {
    socket.send(JSON.stringify({
      commandId: command.commandId,
      error: safeGpuiRendererCommandErrorMessage(error),
      ok: false,
      type: "rendererCommandResult",
    }));
  }
}

function isGpuiRendererCommand(value: unknown): value is GxserverRendererCommand {
  if (!isObjectRecord(value)) {
    return false;
  }
  return (
    typeof value.action === "string" &&
    typeof value.commandId === "string" &&
    isObjectRecord(value.payload)
  );
}

function safeGpuiRendererCommandErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Renderer command failed.";
  }
  if (
    error.message === "Invalid renderer command title." ||
    error.message === "No matching session was found." ||
    error.message === "Renderer command bridge unavailable." ||
    error.message === "Unsupported renderer command."
  ) {
    return error.message;
  }
  return "Renderer command failed.";
}

function normalizeGpuiRendererCommandRenameTitle(
  payload: Record<string, unknown>,
): string | undefined {
  const rawTitle = readGpuiRecordString(payload, "title");
  if (
    rawTitle === undefined ||
    GPUI_RENDERER_COMMAND_RENAME_TITLE_CONTROL_PATTERN.test(rawTitle)
  ) {
    return undefined;
  }
  const title = rawTitle.trim();
  if (!title || title.length > GPUI_RENDERER_COMMAND_RENAME_TITLE_MAX_CHARS) {
    return undefined;
  }
  return title;
}

function readGpuiRendererCommandSessionTarget(
  payload: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const target = payload.sessionTarget;
  return isObjectRecord(target) && !Array.isArray(target) ? target : undefined;
}

function readGpuiRecordString(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function parseGpuiRendererCommandGlobalSessionRef(
  globalRef: string | undefined,
): { projectId: string; sessionId: string } | undefined {
  const parts = globalRef?.trim().split(":");
  if (parts?.length !== 3 || !parts[1] || !parts[2]) {
    return undefined;
  }
  return {
    projectId: parts[1],
    sessionId: parts[2],
  };
}

function isPresentationSnapshot(value: unknown): value is GxserverPresentationSnapshot {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray((value as GxserverPresentationSnapshot).groups) &&
    Array.isArray((value as GxserverPresentationSnapshot).projects) &&
    Array.isArray((value as GxserverPresentationSnapshot).sessions) &&
    typeof (value as GxserverPresentationSnapshot).revision === "number"
  );
}

function isPresentationDelta(value: unknown): value is GxserverPresentationDelta {
  return Boolean(value) && typeof value === "object" && typeof (value as { type?: unknown }).type === "string";
}

function normalizeGpuiSidebarRemoteEvent(value: unknown): GpuiSidebarRemoteEvent | undefined {
  const event = parseObject(value);
  if (!event || typeof event.type !== "string") {
    return undefined;
  }
  if (event.type === "remoteMachineStatus") {
    const machineId = normalizeNonEmptyString(event.machineId);
    const state = event.state;
    if (!machineId || !GPUI_REMOTE_MACHINE_STATUS_STATES.has(state as string)) {
      return undefined;
    }
    return {
      machineId,
      state: state as SidebarRemoteMachineStatusMessage["state"],
      type: "remoteMachineStatus",
    };
  }
  if (event.type === "remoteGxserverResponse") {
    const remoteMachineId = normalizeNonEmptyString(event.remoteMachineId);
    const requestId = normalizeNonEmptyString(event.requestId);
    if (!remoteMachineId || !requestId || typeof event.ok !== "boolean") {
      return undefined;
    }
    return {
      error: normalizeNonEmptyString(event.error),
      ok: event.ok,
      remoteMachineId,
      requestId,
      result: event.result,
      type: "remoteGxserverResponse",
    };
  }
  if (event.type !== "remoteGxserverPresentation") {
    return undefined;
  }
  const remoteMachineId = normalizeNonEmptyString(event.remoteMachineId);
  const payload = parseObject(event.payload);
  if (!remoteMachineId || !payload || typeof payload.type !== "string") {
    return undefined;
  }
  if (payload.type === "presentationSnapshot" && isPresentationSnapshot(payload.snapshot)) {
    return {
      payload: {
        snapshot: payload.snapshot,
        type: "presentationSnapshot",
      },
      remoteMachineId,
      type: "remoteGxserverPresentation",
    };
  }
  if (
    payload.type === "presentationDelta" &&
    isPresentationDelta(payload.delta) &&
    typeof payload.revision === "number"
  ) {
    return {
      payload: {
        delta: payload.delta,
        revision: payload.revision,
        type: "presentationDelta",
      },
      remoteMachineId,
      type: "remoteGxserverPresentation",
    };
  }
  return undefined;
}

const GPUI_REMOTE_MACHINE_STATUS_STATES = new Set([
  "connecting",
  "connected",
  "disconnected",
  "installApprovalRequired",
  "installing",
  "failed",
]);
