/*
CDXC:RepoStructure 2026-08-22:
Split out of the single 21,861-line `gxserver-runtime.ts`. Pure move: no logic
changed. See `core.ts` for how the runtime's methods are re-attached.
*/
import {
  APP_SHOT_PROMPT_INSERT_RESULT_TIMEOUT_MS,
  APP_SHOT_RECENT_TARGET_MS,
  GPUI_SIDEBAR_COMMAND_ACTION_MESSAGE_TYPE,
  GPUI_SIDEBAR_COMMAND_ACTION_MESSAGE_VERSION,
  GPUI_SIDEBAR_COMMAND_RUN_END_MESSAGE_TYPE,
  GPUI_SIDEBAR_COMMAND_RUN_END_MESSAGE_VERSION,
  GPUI_SIDEBAR_NATIVE_APP_SHOT_PROMPT_MESSAGE_TYPE,
  GPUI_SIDEBAR_NATIVE_APP_SHOT_PROMPT_MESSAGE_VERSION,
  GPUI_SIDEBAR_NATIVE_PROJECT_PATH_ACTION_MESSAGE_TYPE,
  GPUI_SIDEBAR_NATIVE_PROJECT_PATH_ACTION_MESSAGE_VERSION,
} from './constants';
import type { GpuiSidebarRuntime } from './core';
import { activateGpuiProject } from './project-activation';
import {
  formatGpuiNativeAppShotPrompt,
  isNativeAppShotAgentSession,
  localGxserverProjectIdForSidebarSession,
  localGxserverSessionIdForSidebarSession,
  nativeAppShotPromptSessionIdForSidebarSession,
  normalizeGpuiNativeAppShotCapture,
  normalizeGpuiNativeAppShotPromptResult,
} from './helpers/app-shot';
import { createGpuiSidebarSettings } from './helpers/bootstrap';
import { normalizeNonEmptyString } from './helpers/records';
import {
  createGpuiRemotePresentationGroupId,
  parseGpuiRemotePresentationProjectId,
  parseGpuiRemotePresentationSessionId,
} from './helpers/remote-presentation';
import { normalizeGpuiMenuBarProjectActivation } from './helpers/status-indicators';
import type {
  GpuiPendingNativeAppShotPromptInsertion,
  GpuiSidebarNativeProjectPathAction,
  GpuiWorkspaceTerminalFocusPlacement,
} from './types-and-protocol';
import { openAppModal, postAppModalHostMessage } from '@/packages/core-ui/app-modal-host-bridge';
import type { AppToastLevel } from '@/packages/shared/app-toast-contract';
import { createAppToastRequest } from '@/packages/shared/app-toast-contract';
import type { PreferredAgentInterface } from '@/packages/shared/ghostex-settings';
import type { SidebarSessionItem, SidebarToExtensionMessage } from '@/packages/shared/session-grid-contract';
import type { SidebarCommandButton } from '@/packages/shared/sidebar-commands';
import { isSidebarCommandRunMode } from '@/packages/shared/sidebar-commands';

/*
CDXC:RepoStructure 2026-08-22:
The method signatures below are copied verbatim from the original class body.
They exist as a standalone interface — rather than being derived from
`typeof gpuiSidebarRuntimeAppShotAndMiscMethods` — because deriving them would make
`GpuiSidebarRuntime` depend on the bodies that depend on it, which TypeScript
reports as a circular base type. `gpuiSidebarRuntimeAppShotAndMiscMethodsShapeCheck`
at the bottom of this file is what keeps the two in step.
*/
export interface GpuiSidebarRuntimeAppShotAndMiscMethods {
  handleGpuiMenuBarProjectActivation(payload: unknown): void;
  handleNativeAppShotCaptured(payload: unknown): Promise<void>;
  stageNativeAppShotInAgentSession(prompt: string): Promise<{ ok: true } | { description: string; ok: false }>;
  stageNativeAppShotInExistingAgentSession(session: SidebarSessionItem, prompt: string): Promise<boolean>;
  resolveNativeAppShotTargetSession(): SidebarSessionItem | undefined;
  findNativeAppShotSessionByPresentationSessionId(sessionId: string): SidebarSessionItem | undefined;
  findNativeAppShotSessionByLocalGxserverSessionId(sessionId: string): SidebarSessionItem | undefined;
  findNativeAppShotSessionByRemotePresentationSessionId(sessionId: string): SidebarSessionItem | undefined;
  postNativeAppShotPromptToSession(sessionId: string, prompt: string): Promise<boolean>;
  handleNativeAppShotPromptResult(payload: unknown): void;
  resolvePendingNativeAppShotPromptInsertion(pending: GpuiPendingNativeAppShotPromptInsertion, ok: boolean): void;
  rememberNativeAppShotTargetSessionId(sessionId: string): void;
  postAppShotToast(
    level: AppToastLevel,
    title: string,
    options?: {
      description?: string;
    }
  ): void;
  postSidebarActionToast(level: AppToastLevel, title: string, options?: { description?: string }): void;
  postNativeProjectPathAction(
    action: GpuiSidebarNativeProjectPathAction,
    projectId: string,
    originalMessage: SidebarToExtensionMessage,
    options?: {
      filePath?: string;
      keepView?: boolean;
      placement?: GpuiWorkspaceTerminalFocusPlacement;
      preferredInterface?: PreferredAgentInterface;
    }
  ): boolean;
  postSidebarCommandAction(
    command: SidebarCommandButton,
    selectionMessage: Extract<SidebarToExtensionMessage, { type: 'runSidebarCommand' }>
  ): boolean;
  postGhostexHotkeyAction(
    originalMessage: Extract<SidebarToExtensionMessage, { type: 'runGhostexHotkeyAction' }>
  ): boolean;
  postSidebarCommandRunEnd(commandId: string, originalMessage: SidebarToExtensionMessage): boolean;
  openAppModal(modal: 'firstLaunchSetup' | 'onboarding' | 'settings' | 'watchGhostexVideo'): void;
  savePinnedPrompt(message: Extract<SidebarToExtensionMessage, { type: 'savePinnedPrompt' }>): Promise<void>;
  publishAppUserDataHydrate(): void;
}

export const gpuiSidebarRuntimeAppShotAndMiscMethods = {
  handleGpuiMenuBarProjectActivation(this: GpuiSidebarRuntime, payload: unknown): void {
    const activation = normalizeGpuiMenuBarProjectActivation(payload);
    if (!activation) {
      return;
    }
    void activateGpuiProject(this, activation.projectId);
  },

  async handleNativeAppShotCaptured(this: GpuiSidebarRuntime, payload: unknown): Promise<void> {
    const appShot = normalizeGpuiNativeAppShotCapture(payload);
    if (!appShot) {
      this.postAppShotToast('warning', 'App Shot Failed', {
        description: 'Could not read the native App Shot.',
      });
      return;
    }

    const prompt = formatGpuiNativeAppShotPrompt(
      appShot,
      createGpuiSidebarSettings(this.runtimeSettings).appShotsMetadataEnabled
    );
    const staged = await this.stageNativeAppShotInAgentSession(prompt);
    if (!staged.ok) {
      this.postAppShotToast('warning', 'App Shot Failed', {
        description: staged.description,
      });
      return;
    }

    this.postAppShotToast('success', 'App Shot Added', {
      description: appShot.appName,
    });
  },

  async stageNativeAppShotInAgentSession(
    this: GpuiSidebarRuntime,
    prompt: string
  ): Promise<{ ok: true } | { description: string; ok: false }> {
    /*
    CDXC:AppShots 2026-06-25-23:28:
    GPUI App Shots mirror macOS target order for local sessions: reuse the last successful local App Shot target for 60 seconds when it is still a live local agent row, otherwise use the focused/visible local agent row, and create a default prompt-agent session only when the exact local insert bridge declines. Keep command-pane, sleeping, stale, non-agent, and sidebar-only rows out of insertion.

    CDXC:AppShots 2026-06-26-04:27:
    Existing-session App Shot targeting now accepts live remote agent rows by their machine-scoped presentation session id, but only as an insertion request to Rust. React must not wake, materialize, or open remote attach tabs for App Shots; Rust may write only when that exact remote attach surface is already mounted.
    */
    const targetSession = this.resolveNativeAppShotTargetSession();
    if (targetSession && (await this.stageNativeAppShotInExistingAgentSession(targetSession, prompt))) {
      return { ok: true };
    }

    if (!this.client) {
      return {
        description: 'The local agent service is not ready.',
        ok: false,
      };
    }
    const project = this.activeDomainProject();
    if (!project) {
      return {
        description: 'Open a project before using App Shots.',
        ok: false,
      };
    }
    const agent = this.resolveDefaultPromptAgent();
    if (!agent?.command?.trim()) {
      return {
        description: 'Choose a configured default prompt agent before using App Shots.',
        ok: false,
      };
    }

    try {
      const sessionId = await this.createAgentSessionForProject(project, agent, prompt);
      this.rememberNativeAppShotTargetSessionId(sessionId);
      return { ok: true };
    } catch {
      return {
        description: 'Could not stage the App Shot in an agent session.',
        ok: false,
      };
    }
  },

  async stageNativeAppShotInExistingAgentSession(
    this: GpuiSidebarRuntime,
    session: SidebarSessionItem,
    prompt: string
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
  },

  resolveNativeAppShotTargetSession(this: GpuiSidebarRuntime): SidebarSessionItem | undefined {
    const now = Date.now();
    const recentTarget =
      this.lastAppShotTargetSessionId && now - this.lastAppShotTargetAt <= APP_SHOT_RECENT_TARGET_MS
        ? this.findNativeAppShotSessionByPresentationSessionId(this.lastAppShotTargetSessionId)
        : undefined;
    if (isNativeAppShotAgentSession(recentTarget)) {
      return recentTarget;
    }

    const focusedSession = this.focusedSessionId
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
  },

  findNativeAppShotSessionByPresentationSessionId(
    this: GpuiSidebarRuntime,
    sessionId: string
  ): SidebarSessionItem | undefined {
    const normalizedSessionId = normalizeNonEmptyString(sessionId);
    if (!normalizedSessionId) {
      return undefined;
    }
    if (parseGpuiRemotePresentationSessionId(normalizedSessionId)) {
      return this.findNativeAppShotSessionByRemotePresentationSessionId(normalizedSessionId);
    }
    return this.findNativeAppShotSessionByLocalGxserverSessionId(normalizedSessionId);
  },

  findNativeAppShotSessionByLocalGxserverSessionId(
    this: GpuiSidebarRuntime,
    sessionId: string
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
        (candidate) => localGxserverSessionIdForSidebarSession(candidate) === normalizedSessionId
      );
      if (session) {
        return session;
      }
    }
    return undefined;
  },

  findNativeAppShotSessionByRemotePresentationSessionId(
    this: GpuiSidebarRuntime,
    sessionId: string
  ): SidebarSessionItem | undefined {
    const normalizedSessionId = normalizeNonEmptyString(sessionId);
    if (!normalizedSessionId || !parseGpuiRemotePresentationSessionId(normalizedSessionId)) {
      return undefined;
    }
    for (const group of this.latestGroups) {
      if (!group.remoteMachineContext) {
        continue;
      }
      const session = group.sessions.find((candidate) => candidate.sessionId === normalizedSessionId);
      if (session) {
        return session;
      }
    }
    return undefined;
  },

  async postNativeAppShotPromptToSession(
    this: GpuiSidebarRuntime,
    sessionId: string,
    prompt: string
  ): Promise<boolean> {
    const postPrompt = window.ghostexGpui?.postNativeAppShotPromptToSession;
    if (typeof postPrompt !== 'function') {
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
  },

  handleNativeAppShotPromptResult(this: GpuiSidebarRuntime, payload: unknown): void {
    const result = normalizeGpuiNativeAppShotPromptResult(payload);
    if (!result) {
      return;
    }
    const pending = this.pendingNativeAppShotPromptInsertions.find(
      (candidate) => candidate.sessionId === result.sessionId
    );
    if (!pending) {
      return;
    }
    this.resolvePendingNativeAppShotPromptInsertion(pending, result.ok);
  },

  resolvePendingNativeAppShotPromptInsertion(
    this: GpuiSidebarRuntime,
    pending: GpuiPendingNativeAppShotPromptInsertion,
    ok: boolean
  ): void {
    const index = this.pendingNativeAppShotPromptInsertions.indexOf(pending);
    if (index >= 0) {
      this.pendingNativeAppShotPromptInsertions.splice(index, 1);
    }
    window.clearTimeout(pending.timeoutId);
    pending.resolve(ok);
  },

  rememberNativeAppShotTargetSessionId(this: GpuiSidebarRuntime, sessionId: string): void {
    const normalizedSessionId = normalizeNonEmptyString(sessionId);
    if (!normalizedSessionId) {
      return;
    }
    this.lastAppShotTargetSessionId = normalizedSessionId;
    this.lastAppShotTargetAt = Date.now();
  },

  postAppShotToast(
    this: GpuiSidebarRuntime,
    level: AppToastLevel,
    title: string,
    options: {
      description?: string;
    } = {}
  ): void {
    try {
      postAppModalHostMessage(createAppToastRequest(level, title, options.description), 'AppModals:gpuiAppShotToast');
    } catch {
      /*
      CDXC:AppShots 2026-06-25-23:07:
      App Shots user feedback must not depend on toast-host availability and must not log raw app names, window titles, image paths, project paths, command text, terminal content, URLs, or tokens when presentation is unavailable.
      */
    }
  },

  postSidebarActionToast(
    this: GpuiSidebarRuntime,
    level: AppToastLevel,
    title: string,
    options: { description?: string } = {}
  ): void {
    try {
      postAppModalHostMessage(createAppToastRequest(level, title, options.description), 'GPUISidebarActions:toast');
    } catch {
      // Toast-host availability must never gate the underlying action.
    }
  },

  postNativeProjectPathAction(
    this: GpuiSidebarRuntime,
    action: GpuiSidebarNativeProjectPathAction,
    projectId: string,
    originalMessage: SidebarToExtensionMessage,
    options: {
      filePath?: string;
      keepView?: boolean;
      placement?: GpuiWorkspaceTerminalFocusPlacement;
      preferredInterface?: PreferredAgentInterface;
    } = {}
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
      ...(options.placement ? { placement: options.placement } : {}),
      ...(options.preferredInterface ? { preferredInterface: options.preferredInterface } : {}),
      ...(options.keepView ? { keepView: true } : {}),
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
  },

  postSidebarCommandAction(
    this: GpuiSidebarRuntime,
    command: SidebarCommandButton,
    selectionMessage: Extract<SidebarToExtensionMessage, { type: 'runSidebarCommand' }>
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
      CDXC:CommandPane 2026-06-27-07:54:
      `runSidebarCommand` reaches the launch bridge only after GPUI rebuilds it as a selector-shaped object. Forward an own, validated runMode only for terminal Actions so Rust can create the visible debug workspace terminal like macOS while all other launch metadata stays resolved from the trusted HUD command.
      */
      ...(command.actionType === 'terminal' &&
      selectionMessage.runMode &&
      isSidebarCommandRunMode(selectionMessage.runMode)
        ? { runMode: selectionMessage.runMode }
        : {}),
      ...(command.actionType === 'terminal'
        ? {
            /*
            CDXC:CommandPane 2026-06-27-07:54:
            GPUI command-pane Action launches must match native `runNativeSidebarCommand`: default command-pane runtime forces terminal close-on-exit off even when trusted saved/HUD Action definitions preserve older close-on-exit metadata. Renderer `runSidebarCommand` messages cannot supply this field, and Browser Actions must continue omitting the terminal-only boolean.
            */
            closeTerminalOnExit: false,
            playCompletionSound: command.playCompletionSound,
          }
        : {}),
      ...(command.actionType === 'terminal' && command.command ? { command: command.command } : {}),
      ...(command.actionType === 'terminal' && command.links && command.links.length > 0
        ? { links: command.links.map((link) => ({ target: link.target, url: link.url })) }
        : {}),
      ...(command.actionType === 'browser' && command.url ? { url: command.url } : {}),
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
  },

  postGhostexHotkeyAction(
    this: GpuiSidebarRuntime,
    originalMessage: Extract<SidebarToExtensionMessage, { type: 'runGhostexHotkeyAction' }>
  ): boolean {
    const bridge = window.ghostexGpui?.postGhostexHotkeyAction;
    if (!bridge) {
      this.handleUnsupportedSidebarMessage(originalMessage);
      return false;
    }
    /*
    CDXC:CommandPalette 2026-06-27-08:11:
    Shared SidebarApp and Command Palette hotkey rows emit `runGhostexHotkeyAction` through the reused GPUI runtime, not directly to Rust. Forward only the fixed action-id selector so Open Commands Panel, focused-pane routes, Settings, and modal hotkeys share Rust's native dispatcher without renderer-owned session ids, paths, command text, URLs, or launch metadata.
    */
    if (
      Object.keys(originalMessage).some((key) => key !== 'type' && key !== 'actionId') ||
      typeof originalMessage.actionId !== 'string' ||
      originalMessage.actionId.trim() === ''
    ) {
      this.handleUnsupportedSidebarMessage(originalMessage);
      return false;
    }
    const payload = JSON.stringify({
      actionId: originalMessage.actionId,
      type: 'runGhostexHotkeyAction',
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
  },

  postSidebarCommandRunEnd(
    this: GpuiSidebarRuntime,
    commandId: string,
    originalMessage: SidebarToExtensionMessage
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
      CDXC:CommandPane 2026-06-27-05:59:
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
  },

  openAppModal(
    this: GpuiSidebarRuntime,
    modal: 'firstLaunchSetup' | 'onboarding' | 'settings' | 'watchGhostexVideo'
  ): void {
    /*
    CDXC:AppModal 2026-06-24-11:40:
    Sidebar-origin Settings, first-launch welcome, and tutorial-video requests in GPUI must use the shared app-modal host bridge installed by the CEF sidebar surface. Do not fork Settings React UI, duplicate modal state, or route these first-party modals through fixture/sidebar-only alternate paths.
    */
    try {
      openAppModal({ modal, type: 'open' });
    } catch {
      this.handleUnsupportedSidebarMessage({ type: 'openSettings' });
    }
  },

  async savePinnedPrompt(
    this: GpuiSidebarRuntime,
    message: Extract<SidebarToExtensionMessage, { type: 'savePinnedPrompt' }>
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
  },

  publishAppUserDataHydrate(this: GpuiSidebarRuntime): void {
    if (!this.hasHydrated) {
      return;
    }
    this.messageSource.postMessage(this.createHydrateMessage(this.latestGroups, this.latestHud));
  },
};

const gpuiSidebarRuntimeAppShotAndMiscMethodsShapeCheck: GpuiSidebarRuntimeAppShotAndMiscMethods =
  gpuiSidebarRuntimeAppShotAndMiscMethods;
void gpuiSidebarRuntimeAppShotAndMiscMethodsShapeCheck;
