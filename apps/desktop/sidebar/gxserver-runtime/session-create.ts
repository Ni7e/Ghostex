/*
CDXC:RepoStructure 2026-08-22:
Split out of the single 21,861-line `gxserver-runtime.ts`. Pure move: no logic
changed. See `core.ts` for how the runtime's methods are re-attached.
*/
import {
  moveGpuiWorkspaceSessionToSubgroup,
  parseGpuiWorkspaceSessionSubgroupId,
} from "../workspace-session-groups";
import { GpuiGxserverRpcError } from "./client";
import { GPUI_GXSERVER_CHATS_GROUP_ID } from "./constants";
import type { GpuiSidebarRuntime } from "./core";
import { createGpuiSidebarSettings } from "./helpers/bootstrap";
import { normalizeNonEmptyString } from "./helpers/records";
import {
  createGpuiRemotePresentationSessionId,
  parseGpuiRemotePresentationGroupId,
  parseGpuiRemotePresentationProjectId,
} from "./helpers/remote-presentation";
import { gpuiWorkspaceTerminalTitleCommandForAgent } from "./helpers/terminal-lifecycle";
import type {
  GpuiCreatedProjectAgentSessionRecord,
  GpuiFirstPromptTitleRuntimeSettings,
  GpuiGxserverCreatedSessionResult,
  GpuiRemoteProjectReference,
} from "./types-and-protocol";
import { openAppModal } from "@/packages/core-ui/app-modal-host-bridge";
import {
  resolveEffectivePreferredAgentInterface,
  type ghostexSettings,
  type PreferredAgentInterface,
} from "@/packages/shared/ghostex-settings";
import {
  createGxserverPresentationProjectGroupId,
  parseGxserverPresentationProjectGroupId,
} from "@/packages/shared/gxserver-presentation-sidebar-projection";
import type {
  GxserverProjectDomainState,
  GxserverReadAgentHookStatusResult,
} from "@/packages/shared/gxserver-protocol";
import {
  DEFAULT_TERMINAL_SESSION_TITLE,
  createAgentSessionDefaultTitle,
} from "@/packages/shared/session-grid-contract";
import {
  getDefaultSidebarAgentByIcon,
  type SidebarAgentButton,
} from "@/packages/shared/sidebar-agents";

/*
CDXC:RepoStructure 2026-08-22:
The method signatures below are copied verbatim from the original class body.
They exist as a standalone interface — rather than being derived from
`typeof gpuiSidebarRuntimeSessionCreateMethods` — because deriving them would make
`GpuiSidebarRuntime` depend on the bodies that depend on it, which TypeScript
reports as a circular base type. `gpuiSidebarRuntimeSessionCreateMethodsShapeCheck`
at the bottom of this file is what keeps the two in step.
*/
export interface GpuiSidebarRuntimeSessionCreateMethods {
  createFirstPromptTitleRuntimeSettings(
    firstUserMessage?: string,
    firstUserInputDraft?: string,
  ): GpuiFirstPromptTitleRuntimeSettings;
  resolveSessionTitleGenerationCommandForGxserver(
    settings: ghostexSettings,
  ): string | undefined;
  createQuickProject(
    kind: "agent" | "terminal",
  ): Promise<GxserverProjectDomainState | undefined>;
  createQuickAgentSession(agentId: string, accountId?: string): Promise<void>;
  createSession(groupId?: string | undefined): Promise<void>;
  startAgentSessionProviderAndSendPrompt(
    startProvider: () => Promise<unknown>,
    sendPrompt: (promptText: string) => Promise<unknown>,
    prompt?: string,
    renameCommand?: string,
  ): Promise<void>;
  startRemoteAgentSessionAndSendPrompt(
    machineId: string,
    projectId: string,
    sessionId: string,
    prompt?: string,
  ): Promise<void>;
  startLocalAgentSessionAndSendPrompt(
    projectId: string,
    sessionId: string,
    prompt?: string,
    renameCommand?: string,
  ): Promise<void>;
  createAgentSessionFromSidebarLaunch(
    agentId: string,
    groupId?: string | undefined,
    accountId?: string,
  ): Promise<void>;
  requestAgentSessionLaunch(
    agentId: string,
    groupId?: string | undefined,
    accountId?: string,
  ): Promise<void>;
  createAgentSession(
    agentId: string,
    groupId?: string | undefined,
    accountId?: string,
  ): Promise<void>;
  createAgentSessionForProject(
    project: GxserverProjectDomainState,
    agent: SidebarAgentButton,
    prompt: string,
    title?: string,
  ): Promise<string>;
  createAgentSessionRecordForProject(
    project: GxserverProjectDomainState,
    agent: SidebarAgentButton,
    prompt: string,
    options?: {
      agentEffort?: string;
      agentModel?: string;
      draft?: boolean;
      errorMessage?: string;
      firstUserInputDraft?: string;
      preferredInterface?: PreferredAgentInterface;
      renameTitleAfterStart?: string;
      title?: string;
    },
  ): Promise<GpuiCreatedProjectAgentSessionRecord>;
  createRemoteAgentSessionForProject(
    remoteScope: GpuiRemoteProjectReference,
    agentId: string,
    prompt: string,
    title: string,
    options?: {
      agentEffort?: string;
      agentModel?: string;
      draft?: boolean;
      firstUserInputDraft?: string;
      preferredInterface?: PreferredAgentInterface;
    },
  ): Promise<void>;
}

export const gpuiSidebarRuntimeSessionCreateMethods = {
  createFirstPromptTitleRuntimeSettings(
    this: GpuiSidebarRuntime,
    firstUserMessage?: string,
    firstUserInputDraft?: string,
  ): GpuiFirstPromptTitleRuntimeSettings {
    /*
    CDXC:SessionTitles 2026-07-04-21:52:
    GPUI agent sessions must carry the same gxserver-owned first-prompt title
    settings as macOS before hooks claim the prompt. The daemon still owns
    eligibility, title generation, and command submission; GPUI only supplies
    the user's saved title-generation agent/command and any already-known first
    prompt.
    */
    const settings = createGpuiSidebarSettings(this.runtimeSettings);
    const runtimeSettings: GpuiFirstPromptTitleRuntimeSettings = {
      firstPromptTitleGenerationAgent: settings.sessionTitleGenerationAgent,
    };
    const command =
      this.resolveSessionTitleGenerationCommandForGxserver(settings);
    if (command) {
      runtimeSettings.firstPromptTitleGenerationCommand = command;
    }
    const prompt = firstUserMessage?.trim();
    if (prompt) {
      runtimeSettings.firstUserMessage = prompt;
    }
    /*
    CDXC:TranscriptExport 2026-08-20:
    A draft is the opposite of `firstUserMessage`: gxserver types it into the
    new agent's composer once and never submits it. It travels to the daemon
    byte for byte — the trailing space of `@<path> ` is what closes the file
    mention and separates it from the prompt the user writes next — so it is
    deliberately not trimmed here or anywhere else on the way out.
    */
    if (firstUserInputDraft) {
      runtimeSettings.firstUserInputDraft = firstUserInputDraft;
    }
    return runtimeSettings;
  },

  resolveSessionTitleGenerationCommandForGxserver(
    this: GpuiSidebarRuntime,
    settings: ghostexSettings,
  ): string | undefined {
    if (settings.sessionTitleGenerationAgent === "custom") {
      return settings.customSessionTitleGenerationCommand.trim() || undefined;
    }
    return (
      this.resolveSidebarAgent(
        settings.sessionTitleGenerationAgent,
      )?.command?.trim() || undefined
    );
  },

  async createQuickProject(
    this: GpuiSidebarRuntime,
    kind: "agent" | "terminal",
  ): Promise<GxserverProjectDomainState | undefined> {
    if (!this.client) {
      this.postSidebarActionToast("warning", "Quick action unavailable", {
        description: "gxserver is not connected.",
      });
      return undefined;
    }
    try {
      const response = await this.client.rpc<{
        project: GxserverProjectDomainState;
      }>("/api/createQuickProject", {
        kind,
      });
      this.upsertDomainProject(response.project);
      this.focusProjectId(response.project.projectId);
      this.publishPresentation("patch");
      return response.project;
    } catch {
      this.postSidebarActionToast("error", "Quick action failed", {
        description: "Ghostex could not create the Quick workspace.",
      });
      return undefined;
    }
  },

  async createQuickAgentSession(
    this: GpuiSidebarRuntime,
    agentId: string,
    accountId?: string,
  ): Promise<void> {
    /*
    Match macOS createNativeAgentChat: a Quick agent never launches inside the
    active code project. Give it a new projectless chat workspace, then reuse
    the same configured-agent launch path as project headers.
    */
    const project = await this.createQuickProject("agent");
    if (project) {
      await this.createAgentSession(
        agentId,
        createGxserverPresentationProjectGroupId(project.projectId),
        accountId,
      );
    }
  },

  async createSession(
    this: GpuiSidebarRuntime,
    groupId = this.activeGroupId,
  ): Promise<void> {
    const subgroup = groupId
      ? parseGpuiWorkspaceSessionSubgroupId(groupId)
      : undefined;
    const subgroupRemoteProject = subgroup
      ? parseGpuiRemotePresentationProjectId(subgroup.projectId)
      : undefined;
    const remoteGroup =
      groupId && !subgroup
        ? parseGpuiRemotePresentationGroupId(groupId)
        : undefined;
    const remoteTarget = subgroupRemoteProject ?? remoteGroup;
    if (remoteTarget) {
      await this.requestRemoteGxserver<GpuiGxserverCreatedSessionResult>(
        remoteTarget.machineId,
        "/api/createSession",
        {
          kind: "terminal",
          lifecycleState: "running",
          projectId: remoteTarget.projectId,
          surface: "workspace",
          title: DEFAULT_TERMINAL_SESSION_TITLE,
        },
      )
        .then((response) => {
          const createdSessionId = normalizeNonEmptyString(
            response.session?.sessionId,
          );
          if (createdSessionId) {
            if (subgroup && subgroupRemoteProject) {
              this.workspaceGroups = moveGpuiWorkspaceSessionToSubgroup(
                this.workspaceGroups,
                subgroup.projectId,
                createdSessionId,
                subgroup.groupId,
              );
              this.persistWorkspaceGroups();
            }
            const createdReference = {
              machineId: remoteTarget.machineId,
              projectId:
                normalizeNonEmptyString(response.session?.projectId) ??
                remoteTarget.projectId,
              sessionId: createdSessionId,
            };
            this.setRemotePresentationSessionFocus(createdReference);
            this.postRemoteSessionNativeAction(
              "openRemoteSessionTerminal",
              createdReference,
              {
                sessionId: createGpuiRemotePresentationSessionId(
                  createdReference.machineId,
                  createdReference.projectId,
                  createdReference.sessionId,
                ),
                type: "focusSession",
              },
            );
          }
          this.refreshRemotePresentationFromGxserver(
            remoteTarget.machineId,
          ).catch(() => undefined);
        })
        .catch(() => {
          this.postRemoteToast("warning", "Remote session failed", {
            description: "The remote gxserver could not create that session.",
          });
        });
      return;
    }
    const projectId = subgroup
      ? subgroup.projectId
      : groupId
        ? parseGxserverPresentationProjectGroupId(groupId)
        : this.activeProjectId;
    if (!this.client) {
      return;
    }
    if (projectId && !this.ensureLocalProjectPathAvailable(projectId)) {
      return;
    }
    /*
    CDXC:StateSync 2026-07-07:
    gxserver defaults an omitted lifecycleState to "unknown", which the
    presentation layer treats as inactive, so the created terminal never gets a
    sidebar row even though the workspace pane opens. Declare the session
    running at create time like the remote path and the macOS client do.
    */
    let response: GpuiGxserverCreatedSessionResult;
    try {
      response = await this.client.rpc<GpuiGxserverCreatedSessionResult>(
        "/api/createSession",
        {
          ...(projectId ? { projectId } : {}),
          kind: "terminal",
          lifecycleState: "running",
          surface: "workspace",
          title: DEFAULT_TERMINAL_SESSION_TITLE,
        },
      );
    } catch (error) {
      if (
        projectId &&
        error instanceof GpuiGxserverRpcError &&
        error.code === "projectPathUnavailable" &&
        this.presentMissingProjectFolder(projectId)
      ) {
        void this.refreshDomainPresentationSnapshotFromClient("patch").catch(
          () => undefined,
        );
        return;
      }
      throw error;
    }
    const createdProjectId =
      normalizeNonEmptyString(response.session?.projectId) ?? projectId;
    const createdSessionId = normalizeNonEmptyString(
      response.session?.sessionId,
    );
    if (
      subgroup &&
      createdProjectId === subgroup.projectId &&
      createdSessionId
    ) {
      this.workspaceGroups = moveGpuiWorkspaceSessionToSubgroup(
        this.workspaceGroups,
        subgroup.projectId,
        createdSessionId,
        subgroup.groupId,
      );
      this.persistWorkspaceGroups();
    }
    if (createdProjectId && createdSessionId) {
      this.focusLocalWorkspaceSession(createdProjectId, createdSessionId);
    }
  },

  /**
   * CDXC:Worktrees 2026-09-23 WHY:
   * A fixed startup delay can type the first prompt before the agent owns its composer. Like ghostex agents create, retain each prompt in the daemon's durable startup queue and let shared chat readiness and paste verification control delivery; queue receipts preserve rename-before-prompt order.
   */
  async startAgentSessionProviderAndSendPrompt(
    this: GpuiSidebarRuntime,
    startProvider: () => Promise<unknown>,
    sendPrompt: (promptText: string) => Promise<unknown>,
    prompt?: string,
    renameCommand?: string,
  ): Promise<void> {
    await startProvider();
    const promptText = normalizeNonEmptyString(prompt);
    const renameText = normalizeNonEmptyString(renameCommand);
    if (!promptText && !renameText) {
      return;
    }
    const queuePrompt = async (text: string): Promise<void> => {
      const receipt = await sendPrompt(text);
      if (!receipt || typeof receipt !== "object" || !("prompt" in receipt)) {
        throw new Error(
          "gxserver did not confirm the startup prompt was queued. Inspect this session before retrying.",
        );
      }
      const queued = receipt.prompt;
      if (
        !queued ||
        typeof queued !== "object" ||
        !("id" in queued) ||
        !normalizeNonEmptyString(queued.id)
      ) {
        throw new Error(
          "gxserver did not return a startup prompt receipt. Inspect this session before retrying.",
        );
      }
    };
    if (renameText) {
      await queuePrompt(renameText);
    }
    if (promptText) {
      await queuePrompt(promptText);
    }
  },

  async startRemoteAgentSessionAndSendPrompt(
    this: GpuiSidebarRuntime,
    machineId: string,
    projectId: string,
    sessionId: string,
    prompt?: string,
  ): Promise<void> {
    await this.startAgentSessionProviderAndSendPrompt(
      () =>
        this.requestRemoteGxserver(
          machineId,
          "/api/startSessionProvider",
          {
            projectId,
            sessionId,
          },
          { timeoutMs: 15_000 },
        ),
      (promptText) =>
        this.requestRemoteGxserver(
          machineId,
          "/api/queueSessionChatPrompt",
          {
            projectId,
            sessionId,
            startupSend: true,
            text: promptText,
          },
          { timeoutMs: 15_000 },
        ),
      prompt,
    );
  },

  async startLocalAgentSessionAndSendPrompt(
    this: GpuiSidebarRuntime,
    projectId: string,
    sessionId: string,
    prompt?: string,
    renameCommand?: string,
  ): Promise<void> {
    const client = this.client;
    if (!client) {
      throw new Error("gxserver is unavailable.");
    }
    await this.startAgentSessionProviderAndSendPrompt(
      () =>
        client.rpc("/api/startSessionProvider", {
          projectId,
          sessionId,
        }),
      (promptText) =>
        client.rpc("/api/queueSessionChatPrompt", {
          projectId,
          sessionId,
          startupSend: true,
          text: promptText,
        }),
      prompt,
      renameCommand,
    );
  },

  async createAgentSessionFromSidebarLaunch(
    this: GpuiSidebarRuntime,
    agentId: string,
    groupId?: string | undefined,
    accountId?: string,
  ): Promise<void> {
    if (groupId === GPUI_GXSERVER_CHATS_GROUP_ID) {
      await this.createQuickAgentSession(agentId, accountId);
      return;
    }
    await this.createAgentSession(agentId, groupId, accountId);
  },

  async requestAgentSessionLaunch(
    this: GpuiSidebarRuntime,
    agentId: string,
    groupId?: string | undefined,
    accountId?: string,
  ): Promise<void> {
    const normalizedAgentId = agentId.trim();
    const agent = this.resolveSidebarAgent(normalizedAgentId);
    const hookAgentId = getDefaultSidebarAgentByIcon(agent?.icon)?.agentId;
    if (
      !normalizedAgentId ||
      !agent ||
      !hookAgentId ||
      hookAgentId === "zcode"
    ) {
      await this.createAgentSessionFromSidebarLaunch(
        agentId,
        groupId,
        accountId,
      );
      return;
    }

    const remoteGroup = groupId
      ? parseGpuiRemotePresentationGroupId(groupId)
      : undefined;
    let status: GxserverReadAgentHookStatusResult;
    try {
      status = remoteGroup
        ? await this.requestRemoteGxserver<GxserverReadAgentHookStatusResult>(
            remoteGroup.machineId,
            "/api/readAgentHookStatus",
            { agentIds: [hookAgentId] },
          )
        : await this.client!.rpc<GxserverReadAgentHookStatusResult>(
            "/api/readAgentHookStatus",
            {
              agentIds: [hookAgentId],
            },
          );
    } catch {
      this.postSidebarActionToast("warning", "Unable to check agent hooks", {
        description: `Ghostex could not verify ${agent.name} hooks. Try opening the agent again.`,
      });
      return;
    }

    const hookStatus = status.agents.find((row) => row.agentId === hookAgentId);
    if (
      !hookStatus ||
      hookStatus.status === "installed" ||
      hookStatus.status === "cliMissing"
    ) {
      await this.createAgentSessionFromSidebarLaunch(
        agentId,
        groupId,
        accountId,
      );
      return;
    }

    openAppModal({
      agentId: normalizedAgentId,
      agentName: agent.name,
      groupId,
      hookAgentId,
      accountId,
      modal: "agentHooksRequired",
      type: "open",
    });
  },

  /**
   * CDXC:AgentLauncher 2026-09-14 DECISION:
   * User: starting a new agent from Docs, Code, Browser, or any other non-Agents view must keep that view selected.
   * Both local and remote launches use keepView through native attachment so startup completion preserves the view too.
   */
  async createAgentSession(
    this: GpuiSidebarRuntime,
    agentId: string,
    groupId = this.activeGroupId,
    accountId?: string,
  ): Promise<void> {
    const remoteGroup = groupId
      ? parseGpuiRemotePresentationGroupId(groupId)
      : undefined;
    if (remoteGroup) {
      const normalizedAgentId = agentId.trim();
      if (!normalizedAgentId) {
        this.postRemoteToast("warning", "Remote agent unavailable", {
          description: "Choose a configured agent for this remote project.",
        });
        return;
      }
      /*
      CDXC:RemoteMachines 2026-06-24-17:19:
      Remote agent launches must let the owning remote gxserver resolve default and project-custom agent commands from remote project metadata. GPUI sends only the selected agent id, project id, surface, and a require-command guard through Rust's authenticated tunnel, never a renderer-provided command string.
      */
      const remoteAgent = this.resolveSidebarAgent(normalizedAgentId);
      const title = createAgentSessionDefaultTitle(
        remoteAgent?.name ?? normalizedAgentId,
      );
      const response =
        await this.requestRemoteGxserver<GpuiGxserverCreatedSessionResult>(
          remoteGroup.machineId,
          "/api/createAgentSession",
          {
            agentId: normalizedAgentId,
            /*
          CDXC:Drafts 2026-08-28:
          Sidebar agent launches carry no prompt, so the remote gxserver creates
          a draft row. Chat-first launches start the CLI through native
          wake/attach; terminal launches start the provider below. The session
          stays a draft until a first user prompt actually reaches the agent.
          Never combine with firstUserMessage.
          */
            draft: true,
            projectId: remoteGroup.projectId,
            requireLaunchCommand: true,
            runtimeSettings: {
              ...this.createFirstPromptTitleRuntimeSettings(),
              ...(accountId ? { accountId } : {}),
            },
            surface: "workspace",
            title,
          },
        ).catch(() => {
          this.postRemoteToast("warning", "Remote agent failed", {
            description:
              "The remote gxserver could not create that agent session.",
          });
          return undefined;
        });
      if (response) {
        const createdSessionId = normalizeNonEmptyString(
          response.session?.sessionId,
        );
        if (createdSessionId) {
          const createdProjectId =
            normalizeNonEmptyString(response.session?.projectId) ??
            remoteGroup.projectId;
          this.setRemotePresentationSessionFocus({
            machineId: remoteGroup.machineId,
            projectId: createdProjectId,
            sessionId: createdSessionId,
          });
          if (
            resolveEffectivePreferredAgentInterface(
              createGpuiSidebarSettings(this.runtimeSettings),
              normalizedAgentId,
            ) === "chat"
          ) {
            this.postRemoteSessionNativeAction(
              "openRemoteSessionTerminal",
              {
                machineId: remoteGroup.machineId,
                projectId: createdProjectId,
                sessionId: createdSessionId,
              },
              { agentId, groupId, type: "runSidebarAgent" },
              { keepView: true, preferredInterface: "chat" },
            );
          } else {
            await this.startRemoteAgentSessionAndSendPrompt(
              remoteGroup.machineId,
              createdProjectId,
              createdSessionId,
            ).catch(() => {
              this.postRemoteToast("warning", "Remote agent failed", {
                description:
                  "The remote gxserver could not start that agent session.",
              });
            });
          }
        }
        this.refreshRemotePresentationFromGxserver(remoteGroup.machineId).catch(
          () => undefined,
        );
      }
      return;
    }
    const projectId = groupId
      ? parseGxserverPresentationProjectGroupId(groupId)
      : this.activeProjectId;
    if (projectId && !this.ensureLocalProjectPathAvailable(projectId)) {
      return;
    }
    const isWindowsHost =
      typeof navigator !== "undefined" && /Windows/iu.test(navigator.userAgent);
    if (isWindowsHost) {
      /*
      CDXC:PlatformSupport 2026-08-11:
      Windows agent creation and attachment must stay in the Rust-owned WSL
      gxserver path. Splitting creation across CEF fetch and native attach can
      address different backend state during WSL bootstrap and leaves the
      project-header click with no materialized terminal. Send only the
      bounded project and agent ids plus the user's interface preference;
      Rust resolves the configured command, starts the provider, obtains its
      attach plan, and opens the exact tab.
      */
      const postCreate = window.ghostexGpui?.postCreateProjectAgent;
      const normalizedAgentId = agentId.trim();
      if (
        !projectId ||
        !normalizedAgentId ||
        typeof postCreate !== "function"
      ) {
        this.postSidebarActionToast("warning", "Agent unavailable");
        return;
      }
      try {
        const accepted = postCreate(
          JSON.stringify({
            agentId: normalizedAgentId,
            preferredInterface: resolveEffectivePreferredAgentInterface(
              createGpuiSidebarSettings(this.runtimeSettings),
              normalizedAgentId,
            ),
            projectId,
            accountId,
            type: "ghostex.gpui.sidebar.createProjectAgent",
            version: 1,
          }),
        );
        if (!accepted) {
          this.postSidebarActionToast("warning", "Agent unavailable");
        }
      } catch {
        this.postSidebarActionToast("warning", "Agent unavailable");
      }
      return;
    }
    const agent = this.resolveSidebarAgent(agentId);
    if (!this.client || !projectId || !agent) {
      return;
    }
    if (!agent.command) {
      return;
    }
    let response: GpuiGxserverCreatedSessionResult;
    try {
      response = await this.client.rpc<GpuiGxserverCreatedSessionResult>(
        "/api/createAgentSession",
        {
          agentId: agent.agentId,
          /*
        CDXC:Drafts 2026-08-28:
        A sidebar agent launch has no prompt, so the row is created as a draft.
        The agent CLI is NOT started here: `focusLocalWorkspaceSession` below
        hands the session to the Rust attach path, whose
        `should_start_local_zmx_provider_before_gpui_attach` check starts the
        missing provider, so trust/login/update screens surface while the user
        types. gxserver drops `draftStatus` when the first prompt lands.
        */
          draft: true,
          launchSettings: {
            agentCommand: agent.command,
            icon: agent.icon,
          },
          projectId,
          runtimeSettings: {
            ...this.createFirstPromptTitleRuntimeSettings(),
            ...(accountId ? { accountId } : {}),
          },
          surface: "workspace",
          title: createAgentSessionDefaultTitle(agent.name),
        },
      );
    } catch (error) {
      if (
        error instanceof GpuiGxserverRpcError &&
        error.code === "projectPathUnavailable" &&
        this.presentMissingProjectFolder(projectId)
      ) {
        void this.refreshDomainPresentationSnapshotFromClient("patch").catch(
          () => undefined,
        );
        return;
      }
      throw error;
    }
    const createdSessionId = normalizeNonEmptyString(
      response.session?.sessionId,
    );
    if (createdSessionId) {
      const preferredAgentInterface = resolveEffectivePreferredAgentInterface(
        createGpuiSidebarSettings(this.runtimeSettings),
        agent.agentId,
      );
      this.focusLocalWorkspaceSession(
        normalizeNonEmptyString(response.session?.projectId) ?? projectId,
        createdSessionId,
        { keepView: true, preferredInterface: preferredAgentInterface },
      );
    }
  },

  async createAgentSessionForProject(
    this: GpuiSidebarRuntime,
    project: GxserverProjectDomainState,
    agent: SidebarAgentButton,
    prompt: string,
    title = createAgentSessionDefaultTitle(agent.name),
  ): Promise<string> {
    const defaultTitle = createAgentSessionDefaultTitle(agent.name);
    const renameTitle =
      title.trim() !== defaultTitle ? title.trim() : undefined;
    /*
    CDXC:Git 2026-07-11-06:14:
    Match macOS `runSidebarGitPromptAction` + `stageNativeAgentPrompt`: create
    Git helpers as fresh neutral agent sessions, start the provider, then submit
    the provider-specific title command, wait for that command to settle, and
    only then submit the workflow prompt. Persisting `Git: Release` or
    `Git: Multiple Commits` before startup makes the missing-provider attach
    path treat a brand-new row as a trusted resume title; a failed lookup then
    leaves the workflow prompt in a plain shell.
    */
    const created = await this.createAgentSessionRecordForProject(
      project,
      agent,
      prompt,
      {
        renameTitleAfterStart: renameTitle,
        title: defaultTitle,
      },
    );
    return created.sessionId;
  },

  async createAgentSessionRecordForProject(
    this: GpuiSidebarRuntime,
    project: GxserverProjectDomainState,
    agent: SidebarAgentButton,
    prompt: string,
    options: {
      /** Launch flags for the new session alone; gxserver accepts them for Claude and Codex agents only. */
      agentEffort?: string;
      agentModel?: string;
      draft?: boolean;
      errorMessage?: string;
      firstUserInputDraft?: string;
      preferredInterface?: PreferredAgentInterface;
      renameTitleAfterStart?: string;
      title?: string;
    } = {},
  ): Promise<GpuiCreatedProjectAgentSessionRecord> {
    if (!this.client) {
      throw new Error("gxserver is unavailable.");
    }
    const response = await this.client.rpc<{
      session?: {
        agentSessionId?: string;
        agentSessionPath?: string;
        runtimeSettings?: {
          agentSessionId?: string;
          agentSessionPath?: string;
        };
        sessionId?: string;
        zmxName?: string;
      };
    }>("/api/createAgentSession", {
      ...(options.agentEffort ? { agentEffort: options.agentEffort } : {}),
      agentId: agent.agentId,
      ...(options.agentModel ? { agentModel: options.agentModel } : {}),
      /*
      CDXC:Drafts 2026-09-23 WHY:
      An initial prompt is still unsent until the durable startup queue delivers it. Keep the new session chat-eligible as a draft while its input box starts, then let the shared delivery path promote it; this supersedes treating a supplied prompt as already sent.
      */
      ...(options.draft || normalizeNonEmptyString(prompt)
        ? { draft: true }
        : {}),
      launchSettings: {
        agentCommand: agent.command,
        icon: agent.icon,
      },
      projectId: project.projectId,
      runtimeSettings: this.createFirstPromptTitleRuntimeSettings(
        options.renameTitleAfterStart ? undefined : prompt,
        options.firstUserInputDraft,
      ),
      surface: "workspace",
      title: options.title ?? createAgentSessionDefaultTitle(agent.name),
    });
    const session = response.session;
    const sessionId = normalizeNonEmptyString(session?.sessionId);
    if (!sessionId) {
      throw new Error(
        options.errorMessage ??
          "Could not create an agent session in the worktree.",
      );
    }
    this.focusLocalWorkspaceSession(
      project.projectId,
      sessionId,
      options.preferredInterface === "chat"
        ? { preferredInterface: "chat" }
        : undefined,
    );
    const renameTitle = normalizeNonEmptyString(options.renameTitleAfterStart);
    if (normalizeNonEmptyString(prompt) || renameTitle) {
      const renameCommand = renameTitle
        ? `/${gpuiWorkspaceTerminalTitleCommandForAgent(agent.agentId)} ${renameTitle}`
        : undefined;
      await this.startLocalAgentSessionAndSendPrompt(
        project.projectId,
        sessionId,
        prompt,
        renameCommand,
      );
    }
    return {
      agentSessionId:
        normalizeNonEmptyString(session?.agentSessionId) ??
        normalizeNonEmptyString(session?.runtimeSettings?.agentSessionId),
      agentSessionPath:
        normalizeNonEmptyString(session?.agentSessionPath) ??
        normalizeNonEmptyString(session?.runtimeSettings?.agentSessionPath),
      projectId: project.projectId,
      sessionId,
      zmxName: normalizeNonEmptyString(session?.zmxName),
    };
  },

  async createRemoteAgentSessionForProject(
    this: GpuiSidebarRuntime,
    remoteScope: GpuiRemoteProjectReference,
    agentId: string,
    prompt: string,
    title: string,
    options: {
      agentEffort?: string;
      agentModel?: string;
      draft?: boolean;
      firstUserInputDraft?: string;
      preferredInterface?: PreferredAgentInterface;
    } = {},
  ): Promise<void> {
    const response =
      await this.requestRemoteGxserver<GpuiGxserverCreatedSessionResult>(
        remoteScope.machineId,
        "/api/createAgentSession",
        {
          ...(options.agentEffort ? { agentEffort: options.agentEffort } : {}),
          agentId,
          ...(options.agentModel ? { agentModel: options.agentModel } : {}),
          // The same unsent-first-prompt draft rule as the local helper.
          ...(options.draft || normalizeNonEmptyString(prompt)
            ? { draft: true }
            : {}),
          projectId: remoteScope.projectId,
          requireLaunchCommand: true,
          runtimeSettings: this.createFirstPromptTitleRuntimeSettings(
            prompt,
            options.firstUserInputDraft,
          ),
          surface: "workspace",
          title,
        },
        { timeoutMs: 20_000 },
      );
    const sessionId = normalizeNonEmptyString(response.session?.sessionId);
    if (sessionId) {
      const projectId =
        normalizeNonEmptyString(response.session?.projectId) ??
        remoteScope.projectId;
      await this.startRemoteAgentSessionAndSendPrompt(
        remoteScope.machineId,
        projectId,
        sessionId,
        prompt,
      ).catch(() => {
        this.postRemoteToast("warning", "Remote agent prompt failed", {
          description:
            "The remote gxserver could not start that agent session or deliver its prompt.",
        });
      });
      this.setRemotePresentationSessionFocus({
        machineId: remoteScope.machineId,
        projectId,
        sessionId,
      });
      if (options.preferredInterface === "chat") {
        this.postRemoteSessionNativeAction(
          "openRemoteSessionTerminal",
          { machineId: remoteScope.machineId, projectId, sessionId },
          { agentId, type: "runSidebarAgent" },
          { preferredInterface: "chat" },
        );
      }
    }
    await this.refreshRemotePresentationFromGxserver(
      remoteScope.machineId,
    ).catch(() => undefined);
  },
};

const gpuiSidebarRuntimeSessionCreateMethodsShapeCheck: GpuiSidebarRuntimeSessionCreateMethods =
  gpuiSidebarRuntimeSessionCreateMethods;
void gpuiSidebarRuntimeSessionCreateMethodsShapeCheck;
