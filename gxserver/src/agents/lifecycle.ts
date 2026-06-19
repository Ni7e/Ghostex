import type {
  GxserverAgentForkPlan,
  GxserverAgentLaunchPlan,
  GxserverCreateSessionParams,
  GxserverProjectDomainState,
  GxserverAgentResumePlan,
  GxserverAgentSettings,
  GxserverSessionDomainState,
} from "../../protocol/index.js";
import {
  appendCursorResumeFlag,
  getClaudeSessionReference,
  getCodexSessionReference,
  getCursorSessionReference,
  getExactAgentSessionReference,
  getOpenCodeSessionReference,
  getPiSessionReference,
} from "../agent-resume/identity.js";
import { getTrustedAgentResumeTitle } from "../agent-resume/title.js";
import { normalizeAgentActivityState } from "../session-status/index.js";

export {
  applyAgentActivityTransition,
  getAgentActivityStaleProjectionDelayMs,
  getEffectiveAgentActivityState,
  updateSessionActivitySettings,
} from "../session-status/index.js";

export type GxserverAgentAcceptAllMode = "inherit" | "enabled" | "disabled";

export interface GxserverAgentLaunchInput {
  acceptAllMode?: GxserverAgentAcceptAllMode;
  agentId: string;
  agentSessionId?: string;
  command?: string;
  delayedSendDeadlineAt?: string;
  firstUserMessage?: string;
  globalAcceptAllEnabled?: boolean;
  icon?: string;
}

export interface GxserverAgentResumeInput {
  agentCommand?: string;
  agentLookupCommand?: string;
  agentId?: string;
  agentSessionId?: string;
  agentSessionPath?: string;
  firstUserMessage?: string;
  projectPath?: string;
  storedCommandCandidates?: readonly string[];
  title?: string;
  titleSource?: string;
}

type DefaultAgentId =
  | "amp"
  | "antigravity"
  | "claude"
  | "codebuddy"
  | "codex"
  | "copilot"
  | "cursor"
  | "droid"
  | "gemini"
  | "grok"
  | "hermes-agent"
  | "kiro"
  | "omp"
  | "opencode"
  | "pi"
  | "qoder"
  | "rovodev"
  | "t3";

/*
CDXC:AgentResume 2026-06-11-22:49:
Hook-supported Kiro and OMP sessions have native exact-id resume commands. Keep them in gxserver's restorable-agent set so wake, resume, and future clients share the same lifecycle planner instead of treating those lower-priority integrations as hook-only rows.
*/
type RestorableAgentId = Exclude<DefaultAgentId, "t3">;

interface AgentAcceptAllFlagSpec {
  kind: "flag";
  aliases: readonly string[];
  canonicalFlag: string;
}

interface AgentAcceptAllEnvironmentSpec {
  kind: "environment";
  assignments: readonly { name: string; value: string }[];
  legacyFlagAliases: readonly string[];
}

type AgentAcceptAllSpec = AgentAcceptAllFlagSpec | AgentAcceptAllEnvironmentSpec;

const DEFAULT_AGENT_COMMANDS: Readonly<Record<DefaultAgentId, string>> = {
  amp: "amp",
  antigravity: "agy",
  claude: "claude",
  codebuddy: "codebuddy",
  codex: "codex",
  copilot: "copilot",
  cursor: "cursor-agent",
  droid: "droid",
  gemini: "gemini",
  grok: "grok",
  "hermes-agent": "hermes",
  kiro: "kiro-cli chat --agent ghostex",
  omp: "omp",
  opencode: "opencode",
  pi: "pi",
  qoder: "qodercli",
  rovodev: "acli rovodev run",
  t3: "npx --yes t3",
};

const DEFAULT_AGENT_ICON_TO_ID: Readonly<Record<string, DefaultAgentId>> = {
  "amp-cli": "amp",
  "antigravity-cli": "antigravity",
  claude: "claude",
  codebuddy: "codebuddy",
  codex: "codex",
  copilot: "copilot",
  "cursor-cli": "cursor",
  "factory-droid": "droid",
  gemini: "gemini",
  "grok-build": "grok",
  "hermes-agent": "hermes-agent",
  kiro: "kiro",
  omp: "omp",
  opencode: "opencode",
  pi: "pi",
  qoder: "qoder",
  "rovo-dev": "rovodev",
  t3: "t3",
};

const OPENCODE_ACCEPT_ALL_CONFIG_CONTENT = JSON.stringify({ permission: "allow" });

const ACCEPT_ALL_SPECS: Readonly<Record<DefaultAgentId, AgentAcceptAllSpec | null>> = {
  amp: { kind: "flag", aliases: ["--dangerously-allow-all"], canonicalFlag: "--dangerously-allow-all" },
  antigravity: {
    kind: "flag",
    aliases: ["--dangerously-skip-permissions"],
    canonicalFlag: "--dangerously-skip-permissions",
  },
  claude: {
    kind: "flag",
    aliases: ["--dangerously-skip-permissions"],
    canonicalFlag: "--dangerously-skip-permissions",
  },
  codex: { kind: "flag", aliases: ["--yolo"], canonicalFlag: "--yolo" },
  codebuddy: null,
  copilot: { kind: "flag", aliases: ["--allow-all", "--yolo"], canonicalFlag: "--yolo" },
  cursor: { kind: "flag", aliases: ["--force", "--yolo"], canonicalFlag: "--yolo" },
  droid: null,
  gemini: { kind: "flag", aliases: ["-y", "--yolo"], canonicalFlag: "--yolo" },
  grok: { kind: "flag", aliases: ["--always-approve"], canonicalFlag: "--always-approve" },
  "hermes-agent": null,
  kiro: null,
  omp: null,
  opencode: {
    kind: "environment",
    assignments: [{ name: "OPENCODE_CONFIG_CONTENT", value: OPENCODE_ACCEPT_ALL_CONFIG_CONTENT }],
    legacyFlagAliases: ["--dangerously-skip-permissions", "--yolo"],
  },
  pi: null,
  qoder: null,
  rovodev: null,
  t3: null,
};

const GROK_PERMISSION_MODE_FLAG = "--permission-mode";
const GROK_BYPASS_PERMISSIONS_VALUE = "bypassPermissions";

/*
CDXC:GxserverAgentLifecycle 2026-05-30-15:04:
gxserver owns agent launch/resume decisions for the hard cutover while preserving the current sidebar TypeScript rules. Launch commands get runtime Accept All handling, restore commands keep the raw configured command, startup text is queued after terminalReady, and exact-id resume may use the existing title fallback wrapper instead of replaying into live zmx sessions.

CDXC:GxserverAgentLifecycle 2026-06-01-12:07:
Resume, wake, and fork-style restored commands must apply the same global/per-agent Accept All policy as launch while leaving the stored base command unchanged. gxserver owns this runtime command shaping so macOS, CLI, TUI, and mobile clients do not each decide whether to append permission-bypass flags or inject runtime permission config.

CDXC:GxserverAgentLifecycle 2026-06-01-12:23:
Clients must not rebuild agent launch or resume shell commands locally. gxserver returns launch/resume command plans with separate base, runtime, lookup, display, copy, fallback, and startup-script fields so OpenCode title lookup can use the base command while the final launched command still receives the Accept All runtime permission config.

CDXC:GxserverAgentLifecycle 2026-06-01-12:59:
Resume plans must resolve exact agent conversation identity before title lookup and must use shared gxserver title trust for any lookup fallback. Placeholder or status-prefixed titles are display-only and must not become Cursor/OpenCode/Codex lookup input.

CDXC:GxserverForkSession 2026-06-04-07:42:
Fork is a gxserver-owned lifecycle action for macOS, Electron, CLI, Android, and iOS. Build provider fork commands from the authoritative domain session identity and daemon agent settings so sidebar clients do not reject valid Codex rows because their local presentation cache is missing agentName or agentSessionId.

CDXC:GxserverAgentLifecycle 2026-06-06-16:58:
gxserver-generated launch, resume, and fork startup text is typed into interactive shells by macOS clients and by server-owned zmx run flows. Prefix one leading space at the shell-input boundary so automated commands do not enter Atuin history; keep display/copy commands unprefixed and leave in-agent slash commands to client-specific prompt flows.

CDXC:GxserverAgentLifecycle 2026-06-07-10:01:
Copy Resume is a clipboard affordance, not the automated restore path. It must copy only the agent-specific exact-id resume invocation while primary/startup commands keep the validation and title-lookup wrappers needed for reliable wake behavior.

CDXC:GxserverAgentLifecycle 2026-06-09-14:22:
OpenCode TUI Accept All is config-driven, not flag-driven. Launch, resume, and copy commands must use OPENCODE_CONFIG_CONTENT with permission allow while keeping lookup commands on the plain base opencode command so session-list parsing is unaffected.

CDXC:GxserverAgentLifecycle 2026-06-19-15:55:
Fresh CLI-created agent sessions must consume the queued launch command for their first provider materialization. Do not treat the Ghostex G-session id or a user/display title as a provider resume title before an agent hook has captured a real restorable conversation identity.
*/
export function buildAgentLaunchPlan(input: GxserverAgentLaunchInput): GxserverAgentLaunchPlan {
  const baseCommand = normalizeText(input.command) ?? resolveDefaultAgentCommand(input.agentId) ?? "";
  const launchCommand = resolveAgentLaunchCommand({
    acceptAllMode: input.acceptAllMode,
    agentId: input.agentId,
    command: baseCommand,
    globalAcceptAllEnabled: input.globalAcceptAllEnabled === true,
    icon: input.icon,
  });
  const command =
    input.agentId === "cursor" && input.agentSessionId
      ? appendCursorResumeFlag(launchCommand, input.agentSessionId)
      : launchCommand;
  return {
    agentCommand: baseCommand,
    command,
    delayedSend:
      normalizeText(input.delayedSendDeadlineAt) !== undefined
        ? {
            deadlineAt: normalizeText(input.delayedSendDeadlineAt)!,
            disposition: "scheduled",
          }
        : undefined,
    firstUserMessage: normalizeText(input.firstUserMessage),
    startupText: command ? asAtuinIgnoredShellInput(command) : "",
    startupTextDisposition: command ? "queueAfterTerminalReady" : "none",
  };
}

export function buildAgentForkPlan(
  project: GxserverProjectDomainState,
  session: GxserverSessionDomainState,
  agentSettings?: GxserverAgentSettings,
): GxserverAgentForkPlan {
  const input = toAgentResumeInput(project, session, agentSettings);
  const agentId = normalizeRestorableAgentId(input.agentId);
  const agentCommand = input.agentCommand;
  if (!agentId || !agentCommand) {
    return { agentId, startupTextDisposition: "none" };
  }
  const resumeTitle = agentId === "pi" ? undefined : getTrustedAgentResumeTitle(input);
  const primaryCommand = buildAgentForkCommand(agentId, agentCommand, input, resumeTitle);
  const displayCommand = buildAgentForkCommand(agentId, agentCommand, input, resumeTitle, { display: true });
  const startupText = primaryCommand ? asAtuinIgnoredShellInput(primaryCommand) : undefined;
  return {
    agentId,
    baseCommand: normalizeText(input.agentLookupCommand),
    displayCommand: displayCommand ?? primaryCommand,
    primaryCommand,
    runtimeCommand: normalizeText(agentCommand),
    startupText,
    startupTextDisposition: startupText ? "queueAfterTerminalReady" : "none",
  };
}

export function createAgentForkSessionParams(
  project: GxserverProjectDomainState,
  sourceSession: GxserverSessionDomainState,
  plan: GxserverAgentForkPlan,
): GxserverCreateSessionParams {
  const agentId = normalizeText(plan.agentId) ?? normalizeText(sourceSession.agentId) ?? "codex";
  const startupText = normalizeStartupText(plan.startupText);
  return {
    agentId,
    cwd: sourceSession.cwd ?? project.path,
    kind: "agent",
    launchSettings: {
      agentLaunchPlan: {
        agentCommand: normalizeText(plan.baseCommand),
        command: normalizeText(plan.primaryCommand) ?? "",
        startupText: plan.startupText ?? "",
        startupTextDisposition: plan.startupTextDisposition,
      },
      forkedFromSessionId: sourceSession.sessionId,
      runtimeRelevant: {
        queueProviderStartupText: startupText !== undefined,
      },
    },
    lifecycleState: "running",
    providerState: {
      lifecycleState: "missing",
      provider: "zmx",
    },
    projectId: project.projectId,
    restoredFromSessionId: sourceSession.sessionId,
    runtimeSettings: {
      agentActivity: normalizeAgentActivityState(undefined, {
        activity: startupText ? "working" : "idle",
      }),
      agentCommand: normalizeText(plan.baseCommand),
      launchAgentId: agentId,
      agentName: agentId,
      forkedFromSessionId: sourceSession.sessionId,
      startupText,
      titleSource: "placeholder",
    },
    surface: sourceSession.surface,
    title: `${sourceSession.title || "Terminal Session"} Fork`,
  };
}

export function buildProjectAgentLaunchPlan(
  project: GxserverProjectDomainState,
  input: Pick<GxserverAgentLaunchInput, "agentId" | "agentSessionId">,
  agentSettings?: GxserverAgentSettings,
): GxserverAgentLaunchPlan {
  const agentConfig = resolveProjectAgentConfig(project, input.agentId, {});
  return buildAgentLaunchPlan({
    acceptAllMode: normalizeAcceptAllMode(agentConfig.acceptAllMode),
    agentId: input.agentId,
    agentSessionId: input.agentSessionId,
    command: normalizeText(agentConfig.command),
    globalAcceptAllEnabled: resolveGlobalAcceptAllEnabled(project, agentSettings),
    icon: normalizeText(agentConfig.icon),
  });
}

export function createAgentSessionParams(
  project: GxserverProjectDomainState,
  params: GxserverCreateSessionParams,
  agentSettings?: GxserverAgentSettings,
): GxserverCreateSessionParams {
  const agentId = normalizeText(params.agentId) ?? "codex";
  const launchSettings = normalizeObject(params.launchSettings);
  const runtimeSettings = normalizeObject(params.runtimeSettings);
  const agentConfig = resolveProjectAgentConfig(project, agentId, launchSettings);
  const launchPlan = buildAgentLaunchPlan({
    acceptAllMode: normalizeAcceptAllMode(agentConfig.acceptAllMode ?? launchSettings.acceptAllMode),
    agentId,
    agentSessionId: normalizeText(runtimeSettings.agentSessionId),
    command: normalizeText(agentConfig.command) ?? normalizeText(launchSettings.agentCommand),
    delayedSendDeadlineAt: normalizeText(launchSettings.delayedSendDeadlineAt),
    firstUserMessage: normalizeText(runtimeSettings.firstUserMessage),
    globalAcceptAllEnabled: resolveGlobalAcceptAllEnabled(project, agentSettings),
    icon: normalizeText(agentConfig.icon ?? launchSettings.icon),
  });
  return {
    ...params,
    agentId,
    kind: "agent",
    launchSettings: {
      ...launchSettings,
      agentLaunchPlan: launchPlan,
      runtimeRelevant: {
        delayedSendDeadlineAt: launchPlan.delayedSend?.deadlineAt,
        queueProviderStartupText: launchPlan.startupTextDisposition === "queueAfterTerminalReady",
      },
    },
    lifecycleState: params.lifecycleState ?? "running",
    runtimeSettings: {
      ...runtimeSettings,
      agentActivity: normalizeAgentActivityState(runtimeSettings.agentActivity, {
        activity: launchPlan.startupText ? "working" : "idle",
      }),
      agentCommand: launchPlan.agentCommand,
      launchAgentId: agentId,
      ...(launchPlan.firstUserMessage ? { firstUserMessage: launchPlan.firstUserMessage } : {}),
    },
  };
}

export function getAgentStartupTextForSession(
  project: GxserverProjectDomainState,
  session: GxserverSessionDomainState,
  agentSettings?: GxserverAgentSettings,
): string | undefined {
  return buildAgentResumeStartupText(project, session, agentSettings);
}

export function getAgentLaunchStartupTextForSession(
  session: GxserverSessionDomainState,
): string | undefined {
  const launchPlan = readAgentLaunchPlan(session.launchSettings);
  return launchPlan?.startupText?.trim() ? launchPlan.startupText : undefined;
}

export function getQueuedAgentLaunchStartupTextForSession(
  session: GxserverSessionDomainState,
): string | undefined {
  if (!hasQueuedAgentLaunchStartupText(session)) {
    return undefined;
  }
  return getAgentLaunchStartupTextForSession(session);
}

export function hasQueuedAgentLaunchStartupText(session: GxserverSessionDomainState): boolean {
  const runtimeRelevant = normalizeObject(session.launchSettings.runtimeRelevant);
  return runtimeRelevant.queueProviderStartupText === true;
}

export function launchSettingsWithConsumedAgentLaunchStartupText(
  session: GxserverSessionDomainState,
): Record<string, unknown> | undefined {
  if (!hasQueuedAgentLaunchStartupText(session)) {
    return undefined;
  }
  const runtimeRelevant = normalizeObject(session.launchSettings.runtimeRelevant);
  return {
    ...session.launchSettings,
    runtimeRelevant: {
      ...runtimeRelevant,
      queueProviderStartupText: false,
    },
  };
}

export function buildAgentResumeStartupText(
  project: GxserverProjectDomainState,
  session: GxserverSessionDomainState,
  agentSettings?: GxserverAgentSettings,
): string | undefined {
  return buildAgentResumePlan(project, session, agentSettings).startupText;
}

export function buildAgentResumePlan(
  project: GxserverProjectDomainState,
  session: GxserverSessionDomainState,
  agentSettings?: GxserverAgentSettings,
): GxserverAgentResumePlan {
  const input = toAgentResumeInput(project, session, agentSettings);
  const primaryCommand = buildAgentResumeCommand(project, session, {}, agentSettings);
  const displayCommand = primaryCommand ? (buildAgentResumeCommand(project, session, { display: true }, agentSettings) ?? primaryCommand) : undefined;
  const fallbackCommand = buildAgentResumeFallbackCommand(project, session, agentSettings);
  const copyCommand = buildAgentResumeCopyCommand(input);
  const startupText = primaryCommand
    ? asAtuinIgnoredShellInput(wrapRestoredTerminalResumeCommand(primaryCommand, displayCommand ?? primaryCommand, fallbackCommand))
    : undefined;
  return {
    agentId: normalizeText(input.agentId),
    baseCommand: normalizeText(input.agentLookupCommand),
    copyCommand,
    displayCommand,
    fallbackCommand,
    lookupCommand: normalizeText(input.agentLookupCommand),
    primaryCommand,
    runtimeCommand: normalizeText(input.agentCommand),
    startupText,
    startupTextDisposition: startupText ? "queueAfterTerminalReady" : "none",
  };
}

export function buildAgentResumeCommand(
  project: GxserverProjectDomainState,
  session: GxserverSessionDomainState,
  options: { display?: boolean } = {},
  agentSettings?: GxserverAgentSettings,
): string | undefined {
  const input = toAgentResumeInput(project, session, agentSettings);
  const agentId = normalizeRestorableAgentId(input.agentId);
  const agentCommand = input.agentCommand;
  const agentLookupCommand = input.agentLookupCommand ?? agentCommand;
  if (!agentId || !agentCommand) {
    return undefined;
  }
  const resumeTitle = agentId === "pi" ? undefined : getTrustedAgentResumeTitle(input);
  const exactReference = getExactAgentSessionReference(agentId, input);
  const codexExactReference = agentId === "codex" ? getCodexSessionReference(input) : undefined;
  const codexReference = agentId === "codex" ? (codexExactReference ?? resumeTitle) : undefined;
  const claudeExactReference = agentId === "claude" ? getClaudeSessionReference(input) : undefined;
  const cursorReference = agentId === "cursor" ? getCursorSessionReference(input) : undefined;
  const openCodeReference = agentId === "opencode" ? getOpenCodeSessionReference(input) : undefined;
  const piReference = agentId === "pi" ? getPiSessionReference(input) : undefined;

  switch (agentId) {
    case "amp":
      return exactReference ? `${agentCommand} threads continue ${quoteShellDoubleArg(exactReference)}` : undefined;
    case "antigravity":
      return exactReference ? `${agentCommand} --conversation ${quoteShellDoubleArg(exactReference)}` : undefined;
    case "codebuddy":
    case "copilot":
    case "droid":
    case "gemini":
    case "hermes-agent":
    case "qoder":
      return exactReference ? `${agentCommand} --resume ${quoteShellDoubleArg(exactReference)}` : undefined;
    case "grok":
      return exactReference ? `${agentCommand} -r ${quoteShellDoubleArg(exactReference)}` : undefined;
    case "kiro":
      return exactReference ? `${agentCommand} --resume-id ${quoteShellDoubleArg(exactReference)}` : undefined;
    case "omp":
      return exactReference ? `${agentCommand} --session ${quoteShellDoubleArg(exactReference)}` : undefined;
    case "codex":
      if (!codexReference) {
        return undefined;
      }
      if (options.display) {
        return codexExactReference
          ? `${agentCommand} resume ${quoteShellDoubleArg(codexExactReference)}`
          : `${agentCommand} resume ${quoteShellDoubleArg(codexReference)}  # lookup Codex session id by title`;
      }
      return codexExactReference
        ? buildCodexValidatedResumeCommand(agentCommand, codexExactReference)
        : buildCodexResumeLookupCommand(agentCommand, codexReference);
    case "claude":
      if (claudeExactReference) {
        return `${agentCommand} --resume ${quoteShellDoubleArg(claudeExactReference)}`;
      }
      if (!resumeTitle) {
        return undefined;
      }
      return options.display
        ? `${agentCommand} --resume ${quoteShellDoubleArg(resumeTitle)}  # lookup Claude session id by title`
        : buildClaudeResumeLookupCommand(agentCommand, input, resumeTitle);
    case "cursor":
      if (cursorReference) {
        return `${agentCommand} --resume ${quoteShellDoubleArg(cursorReference)}`;
      }
      if (!resumeTitle || !input.projectPath) {
        return undefined;
      }
      return options.display
        ? `${agentCommand} --resume ${quoteShellDoubleArg(resumeTitle)}  # lookup chat id in Cursor chat store`
        : buildCursorResumeLookupCommand(agentCommand, input.projectPath, resumeTitle);
    case "opencode":
      if (openCodeReference) {
        return `${agentCommand} --session ${quoteShellDoubleArg(openCodeReference)}`;
      }
      if (!resumeTitle) {
        return undefined;
      }
      return options.display
        ? `${agentCommand} -s ${quoteShellDoubleArg(resumeTitle)}  # lookup session id in OpenCode session list`
        : buildOpenCodeResumeCommand(agentCommand, resumeTitle, agentLookupCommand);
    case "pi":
      return piReference ? `${agentCommand} --session ${quoteShellDoubleArg(piReference)}` : undefined;
    case "rovodev":
      return exactReference ? buildRovoDevResumeCommand(agentCommand, exactReference) : undefined;
  }
}

function buildAgentResumeCopyCommand(input: GxserverAgentResumeInput): string | undefined {
  const agentId = normalizeRestorableAgentId(input.agentId);
  const agentCommand = input.agentCommand;
  if (!agentId || !agentCommand) {
    return undefined;
  }
  const exactReference = getExactAgentSessionReference(agentId, input);
  switch (agentId) {
    case "amp":
      return exactReference ? `${agentCommand} threads continue ${quoteShellDoubleArg(exactReference)}` : undefined;
    case "antigravity":
      return exactReference ? `${agentCommand} --conversation ${quoteShellDoubleArg(exactReference)}` : undefined;
    case "codebuddy":
    case "copilot":
    case "droid":
    case "gemini":
    case "hermes-agent":
    case "qoder":
      return exactReference ? `${agentCommand} --resume ${quoteShellDoubleArg(exactReference)}` : undefined;
    case "grok":
      return exactReference ? `${agentCommand} -r ${quoteShellDoubleArg(exactReference)}` : undefined;
    case "kiro":
      return exactReference ? `${agentCommand} --resume-id ${quoteShellDoubleArg(exactReference)}` : undefined;
    case "omp":
      return exactReference ? `${agentCommand} --session ${quoteShellDoubleArg(exactReference)}` : undefined;
    case "codex": {
      const codexReference = getCodexSessionReference(input);
      return codexReference ? `${agentCommand} resume ${quoteShellDoubleArg(codexReference)}` : undefined;
    }
    case "claude": {
      const claudeReference = getClaudeSessionReference(input);
      return claudeReference ? `${agentCommand} --resume ${quoteShellDoubleArg(claudeReference)}` : undefined;
    }
    case "cursor": {
      const cursorReference = getCursorSessionReference(input);
      return cursorReference ? `${agentCommand} --resume ${quoteShellDoubleArg(cursorReference)}` : undefined;
    }
    case "opencode": {
      const openCodeReference = getOpenCodeSessionReference(input);
      return openCodeReference ? `${agentCommand} --session ${quoteShellDoubleArg(openCodeReference)}` : undefined;
    }
    case "pi": {
      const piReference = getPiSessionReference(input);
      return piReference ? `${agentCommand} --session ${quoteShellDoubleArg(piReference)}` : undefined;
    }
    case "rovodev":
      return exactReference ? buildRovoDevResumeCommand(agentCommand, exactReference) : undefined;
  }
}

function buildAgentForkCommand(
  agentId: RestorableAgentId,
  agentCommand: string,
  input: GxserverAgentResumeInput,
  resumeTitle: string | undefined,
  options: { display?: boolean } = {},
): string | undefined {
  switch (agentId) {
    case "codex": {
      const exactReference = getCodexSessionReference(input);
      if (exactReference) {
        return `${agentCommand} fork ${quoteShellDoubleArg(exactReference)}`;
      }
      if (!resumeTitle) {
        return undefined;
      }
      return options.display
        ? `${agentCommand} fork ${quoteShellDoubleArg(resumeTitle)}  # lookup Codex session id by title`
        : buildCodexForkLookupCommand(agentCommand, resumeTitle);
    }
    case "claude": {
      const exactReference = getClaudeSessionReference(input);
      if (exactReference) {
        return `${agentCommand} --resume ${quoteShellDoubleArg(exactReference)} --fork-session`;
      }
      if (!resumeTitle) {
        return undefined;
      }
      return options.display
        ? `${agentCommand} --resume ${quoteShellDoubleArg(resumeTitle)} --fork-session  # lookup Claude session id by title`
        : buildClaudeResumeLookupCommand(agentCommand, input, resumeTitle, { fork: true });
    }
    case "pi": {
      const reference = getPiSessionReference(input);
      return reference ? `${agentCommand} --fork ${quoteShellDoubleArg(reference)}` : undefined;
    }
    default:
      return undefined;
  }
}

export function buildAgentResumeFallbackCommand(
  project: GxserverProjectDomainState,
  session: GxserverSessionDomainState,
  agentSettings?: GxserverAgentSettings,
): string | undefined {
  const input = toAgentResumeInput(project, session, agentSettings);
  const agentId = normalizeRestorableAgentId(input.agentId);
  const agentCommand = input.agentCommand;
  const agentLookupCommand = input.agentLookupCommand ?? agentCommand;
  const resumeTitle = getTrustedAgentResumeTitle(input);
  if (!agentId || !agentCommand || !resumeTitle) {
    return undefined;
  }
  switch (agentId) {
    case "codex": {
      const exactReference = getCodexSessionReference(input);
      return exactReference && exactReference !== resumeTitle
        ? buildCodexResumeLookupCommand(agentCommand, resumeTitle)
        : undefined;
    }
    case "claude": {
      const exactReference = getClaudeSessionReference(input);
      return exactReference && resumeTitle
        ? buildClaudeResumeLookupCommand(agentCommand, input, resumeTitle)
        : undefined;
    }
    case "opencode": {
      const exactReference = getOpenCodeSessionReference(input);
      return exactReference && exactReference !== resumeTitle
        ? buildOpenCodeResumeCommand(agentCommand, resumeTitle, agentLookupCommand)
        : undefined;
    }
    case "cursor": {
      const exactReference = getCursorSessionReference(input);
      return exactReference && input.projectPath
        ? buildCursorResumeLookupCommand(agentCommand, input.projectPath, resumeTitle)
        : undefined;
    }
    default:
      return undefined;
  }
}

function resolveAgentLaunchCommand(input: {
  acceptAllMode?: GxserverAgentAcceptAllMode;
  agentId: string;
  command: string;
  globalAcceptAllEnabled: boolean;
  icon?: string;
}): string {
  const enabled =
    input.acceptAllMode === "enabled" ? true : input.acceptAllMode === "disabled" ? false : input.globalAcceptAllEnabled;
  return applyAcceptAllSpec(input.command, input.agentId, enabled, input.icon, {
    stripWhenDisabled: input.acceptAllMode === "disabled",
  });
}

function applyAcceptAllSpec(
  command: string,
  agentId: string,
  enabled: boolean,
  icon?: string,
  options: { stripWhenDisabled?: boolean } = {},
): string {
  const trimmed = command.trim();
  const spec = resolveAcceptAllSpec(agentId, icon);
  if (!trimmed || !spec) {
    return trimmed;
  }
  if (spec.kind === "environment") {
    const stripped = stripAcceptAllMarkers(trimmed, spec);
    return enabled ? `${formatEnvironmentAssignments(spec)} ${stripped}`.trim() : stripped;
  }
  if (!enabled) {
    return options.stripWhenDisabled === true ? stripAcceptAllFlags(trimmed, spec) : trimmed;
  }
  const deduped = dedupeAcceptAllFlags(trimmed, spec);
  return commandIncludesAcceptAllFlag(deduped, spec) ? deduped : `${deduped} ${spec.canonicalFlag}`.trim();
}

function resolveAcceptAllSpec(agentId: string, icon?: string): AgentAcceptAllSpec | undefined {
  const normalizedAgentId = normalizeDefaultAgentId(agentId);
  const specFromId = normalizedAgentId ? ACCEPT_ALL_SPECS[normalizedAgentId] : undefined;
  if (specFromId) {
    return specFromId;
  }
  const iconAgentId = icon ? DEFAULT_AGENT_ICON_TO_ID[icon] : undefined;
  const specFromIcon = iconAgentId ? ACCEPT_ALL_SPECS[iconAgentId] : undefined;
  return specFromIcon ?? undefined;
}

function stripAcceptAllMarkers(command: string, spec: AgentAcceptAllEnvironmentSpec): string {
  const aliases = new Set(spec.legacyFlagAliases);
  const assignmentTokens = new Set(spec.assignments.map(formatEnvironmentAssignment));
  return tokenizeCommand(command)
    .filter((token) => !assignmentTokens.has(token) && !isAcceptAllFlagToken(token, aliases))
    .join(" ");
}

function formatEnvironmentAssignments(spec: AgentAcceptAllEnvironmentSpec): string {
  return spec.assignments.map(formatEnvironmentAssignment).join(" ");
}

function formatEnvironmentAssignment(assignment: { name: string; value: string }): string {
  return `${assignment.name}=${quoteShellArg(assignment.value)}`;
}

function stripAcceptAllFlags(command: string, spec: AgentAcceptAllFlagSpec): string {
  const aliases = new Set(spec.aliases);
  const nextTokens: string[] = [];
  const tokens = tokenizeCommand(command);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (isAcceptAllFlagToken(token, aliases)) {
      continue;
    }
    if (token === GROK_PERMISSION_MODE_FLAG) {
      const valueToken = tokens[index + 1];
      if (valueToken === GROK_BYPASS_PERMISSIONS_VALUE || valueToken?.startsWith(`${GROK_BYPASS_PERMISSIONS_VALUE}=`)) {
        index += 1;
        continue;
      }
    }
    if (token.startsWith(`${GROK_PERMISSION_MODE_FLAG}=`) && token.slice(GROK_PERMISSION_MODE_FLAG.length + 1) === GROK_BYPASS_PERMISSIONS_VALUE) {
      continue;
    }
    nextTokens.push(token);
  }
  return nextTokens.join(" ");
}

function dedupeAcceptAllFlags(command: string, spec: AgentAcceptAllFlagSpec): string {
  const aliases = new Set(spec.aliases);
  const nextTokens: string[] = [];
  let hasSeen = false;
  const tokens = tokenizeCommand(command);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (isAcceptAllFlagToken(token, aliases)) {
      if (!hasSeen) {
        nextTokens.push(token);
        hasSeen = true;
      }
      continue;
    }
    if (token === GROK_PERMISSION_MODE_FLAG) {
      const valueToken = tokens[index + 1];
      if (valueToken === GROK_BYPASS_PERMISSIONS_VALUE) {
        if (!hasSeen) {
          nextTokens.push(token, valueToken);
          hasSeen = true;
        }
        index += 1;
        continue;
      }
    }
    if (token.startsWith(`${GROK_PERMISSION_MODE_FLAG}=`) && token.slice(GROK_PERMISSION_MODE_FLAG.length + 1) === GROK_BYPASS_PERMISSIONS_VALUE) {
      if (!hasSeen) {
        nextTokens.push(token);
        hasSeen = true;
      }
      continue;
    }
    nextTokens.push(token);
  }
  return nextTokens.join(" ");
}

function commandIncludesAcceptAllFlag(command: string, spec: AgentAcceptAllFlagSpec): boolean {
  const aliases = new Set(spec.aliases);
  const tokens = tokenizeCommand(command);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (isAcceptAllFlagToken(token, aliases)) {
      return true;
    }
    if (token === GROK_PERMISSION_MODE_FLAG && tokens[index + 1] === GROK_BYPASS_PERMISSIONS_VALUE) {
      return true;
    }
    if (token.startsWith(`${GROK_PERMISSION_MODE_FLAG}=`) && token.slice(GROK_PERMISSION_MODE_FLAG.length + 1) === GROK_BYPASS_PERMISSIONS_VALUE) {
      return true;
    }
  }
  return false;
}

function isAcceptAllFlagToken(token: string, aliases: ReadonlySet<string>): boolean {
  if (aliases.has(token)) {
    return true;
  }
  const equalsIndex = token.indexOf("=");
  return equalsIndex > 0 && aliases.has(token.slice(0, equalsIndex));
}

function tokenizeCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

function wrapRestoredTerminalResumeCommand(
  command: string,
  displayCommand: string,
  fallbackCommand?: string,
): string {
  const lines = [
    `printf '%s\\n' ${quoteShellArg("Restoring session...")}`,
    `printf '> %s\\n\\n' ${quoteShellArg(displayCommand)}`,
    "__ghostex_restore_resume_status=0",
    "__ghostex_restore_resume_primary() {",
    command,
    "}",
    "__ghostex_restore_resume_primary || __ghostex_restore_resume_status=$?",
    "unset -f __ghostex_restore_resume_primary",
  ];
  if (fallbackCommand && fallbackCommand !== command) {
    lines.push(
      'if [ "$__ghostex_restore_resume_status" -ne 0 ]; then',
      `  printf '%s\\n' ${quoteShellArg("Exact resume failed; trying saved fallback resume command.")}`,
      "  __ghostex_restore_resume_status=0",
      "  __ghostex_restore_resume_fallback() {",
      fallbackCommand,
      "  }",
      "  __ghostex_restore_resume_fallback || __ghostex_restore_resume_status=$?",
      "  unset -f __ghostex_restore_resume_fallback",
      "fi",
    );
  }
  lines.push("unset __ghostex_restore_resume_status");
  return lines.join("\n");
}

function asAtuinIgnoredShellInput(command: string): string {
  const text = command.replace(/[\r\n]+$/u, "");
  return `${text.startsWith(" ") ? text : ` ${text}`}\r`;
}

function toAgentResumeInput(
  project: GxserverProjectDomainState,
  session: GxserverSessionDomainState,
  agentSettings?: GxserverAgentSettings,
): GxserverAgentResumeInput {
  const agentConfig = resolveProjectAgentConfig(project, session.agentId ?? "", session.launchSettings);
  const baseAgentCommand =
    normalizeText(session.runtimeSettings.agentCommand) ??
    normalizeText(agentConfig.command) ??
    resolveDefaultAgentCommand(session.agentId);
  const agentId = session.agentId;
  const runtimeAgentCommand = agentId && baseAgentCommand
    ? resolveAgentLaunchCommand({
        acceptAllMode: normalizeAcceptAllMode(agentConfig.acceptAllMode ?? session.launchSettings.acceptAllMode),
        agentId,
        command: baseAgentCommand,
        globalAcceptAllEnabled: resolveGlobalAcceptAllEnabled(project, agentSettings),
        icon: normalizeText(agentConfig.icon ?? session.launchSettings.icon),
      })
    : baseAgentCommand;
  return {
    agentCommand: runtimeAgentCommand,
    agentId,
    agentLookupCommand: baseAgentCommand,
    agentSessionId: normalizeText(session.runtimeSettings.agentSessionId),
    agentSessionPath: normalizeText(session.runtimeSettings.agentSessionPath),
    firstUserMessage: normalizeText(session.runtimeSettings.firstUserMessage) ?? normalizeText(session.launchSettings.firstUserMessage),
    projectPath: session.cwd ?? project.path,
    storedCommandCandidates: collectStoredAgentResumeCommandCandidates(session),
    title: session.title,
    titleSource: normalizeText(session.runtimeSettings.titleSource) ?? normalizeText(session.runtimeSettings.restoreTitleSource) ?? "user",
  };
}

function resolveGlobalAcceptAllEnabled(
  project: GxserverProjectDomainState,
  agentSettings?: GxserverAgentSettings,
): boolean {
  /*
  CDXC:GxserverAgentSettings 2026-06-02-22:23:
  Global Accept All resolves from gxserver daemon agent settings. Project launchSettings are a legacy migration fallback only for rows imported before the daemon-level settings record existed; new clients must read/write `/api/readAgentSettings` and `/api/updateAgentSettings` instead of shaping commands locally.
  */
  return agentSettings
    ? agentSettings.agentAcceptAllEnabled
    : readBoolean(project.launchSettings.agentAcceptAllEnabled ?? project.launchSettings.acceptAll);
}

function collectStoredAgentResumeCommandCandidates(session: GxserverSessionDomainState): readonly string[] {
  const runtimeSettings = session.runtimeSettings;
  const launchSettings = session.launchSettings;
  const launchPlan = normalizeObject(launchSettings.agentLaunchPlan);
  const resumePlan = normalizeObject(launchSettings.agentResumePlan);
  const candidates = [
    runtimeSettings.agentResumeCommand,
    runtimeSettings.resumeCommand,
    runtimeSettings.resumeFallbackCommand,
    runtimeSettings.copyCommand,
    runtimeSettings.startupText,
    launchSettings.agentResumeCommand,
    launchSettings.resumeCommand,
    launchSettings.resumeFallbackCommand,
    launchSettings.copyCommand,
    launchSettings.startupText,
    launchPlan.command,
    launchPlan.startupText,
    resumePlan.primaryCommand,
    resumePlan.copyCommand,
    resumePlan.displayCommand,
    resumePlan.startupText,
  ];
  return [...new Set(candidates.map(normalizeText).filter((value): value is string => value !== undefined))];
}

function resolveProjectAgentConfig(
  project: GxserverProjectDomainState,
  agentId: string,
  launchSettings: Record<string, unknown>,
): Record<string, unknown> {
  const normalizedAgentId = agentId.trim().toLowerCase();
  const customAgent = project.customAgents.find((candidate) => {
    const candidateId = normalizeText(candidate.agentId)?.toLowerCase();
    return candidateId === normalizedAgentId;
  });
  return customAgent ?? (normalizeText(launchSettings.agentCommand) ? launchSettings : {});
}

function buildRovoDevResumeCommand(agentCommand: string, sessionReference: string): string {
  const quoted = quoteShellDoubleArg(sessionReference);
  return /\brovodev\b/u.test(agentCommand)
    ? `${agentCommand} --restore ${quoted}`
    : `${agentCommand} rovodev run --restore ${quoted}`;
}

function buildClaudeResumeLookupCommand(
  agentCommand: string,
  input: GxserverAgentResumeInput,
  resumeTitle: string,
  options: { fork?: boolean } = {},
): string {
  /*
  CDXC:GxserverMigration 2026-06-10-17:30:
  Ghostex 3.6 Claude rows often persisted only a human title or first prompt, not Claude's exact session id. Wake must resolve the local Claude transcript id before running `claude --resume`; title-as-id restores fail for those migrated rows.
  */
  const args = [
    quoteShellArg(input.projectPath ?? ""),
    quoteShellArg(resumeTitle),
    quoteShellArg(input.firstUserMessage ?? ""),
  ].join(" ");
  const resumeInvocation = options.fork
    ? `${agentCommand} --resume "$CLAUDE_RESUME_SESSION_ID" --fork-session`
    : `${agentCommand} --resume "$CLAUDE_RESUME_SESSION_ID"`;
  return [
    'CLAUDE_RESUME_SESSION_ID="$(',
    `${buildNodeEvalCommand(getClaudeSessionIdLookupScript())} -- ${args}`,
    ')"',
    "&&",
    'test -n "$CLAUDE_RESUME_SESSION_ID"',
    "&&",
    resumeInvocation,
    "||",
    `{ printf '%s\\n' ${quoteShellArg(`Unable to find restorable Claude session id for "${resumeTitle}".`)}; false; }`,
  ].join(" ");
}

function buildNodeEvalCommand(script: string): string {
  /*
  CDXC:GxserverAgentLifecycle 2026-06-10-18:17:
  Runtime resume lookup commands must not depend on `/usr/bin/python3` or any user-installed interpreter. gxserver is launched by Ghostex with the bundled code-server Node, so embed `process.execPath` and run lookup helpers through that app-owned runtime.
  */
  return `${quoteShellArg(process.execPath)} --no-warnings -e ${quoteShellArg(script)}`;
}

function buildCursorResumeLookupCommand(agentCommand: string, projectPath: string, resumeTitle: string): string {
  return [
    'CURSOR_CHAT_ID="$(',
    `${buildNodeEvalCommand(getCursorChatSessionLookupScript())} -- ${quoteShellArg(projectPath)} ${quoteShellArg(resumeTitle)}`,
    ')"',
    "&&",
    'test -n "$CURSOR_CHAT_ID"',
    "&&",
    `${agentCommand} --resume "$CURSOR_CHAT_ID"`,
    "||",
    `printf '%s\\n' ${quoteShellArg(`Unable to find Cursor chat id for "${resumeTitle}".`)}`,
  ].join(" ");
}

function buildOpenCodeResumeCommand(agentCommand: string, resumeTitle: string, lookupAgentCommand = agentCommand): string {
  return `${agentCommand} -s "$(${lookupAgentCommand} session list --format json | ${buildNodeEvalCommand(getOpenCodeSessionLookupScript())} -- ${quoteShellArg(resumeTitle)})"`;
}

function buildCodexValidatedResumeCommand(agentCommand: string, sessionReference: string): string {
  /*
  CDXC:GxserverAgentLifecycle 2026-06-07-01:57:
  Codex sleep/wake restore may keep its title fallback, but it must never resume Ghostex's internal `codex exec` title-generation transcript. Validate exact ids through the same transcript classifier used by title lookup so a polluted stored id fails primary restore and falls through to the filtered fallback.
  */
  return [
    'CODEX_RESUME_SESSION_ID="$(',
    `${buildNodeEvalCommand(getCodexSessionIdLookupScript())} -- --exact ${quoteShellArg(sessionReference)}`,
    ')"',
    "&&",
    'test -n "$CODEX_RESUME_SESSION_ID"',
    "&&",
    `${agentCommand} resume "$CODEX_RESUME_SESSION_ID"`,
    "||",
    `{ printf '%s\\n' ${quoteShellArg(`Unable to restore Codex session "${sessionReference}".`)}; false; }`,
  ].join(" ");
}

function buildCodexResumeLookupCommand(agentCommand: string, resumeTitle: string): string {
  return [
    'CODEX_RESUME_SESSION_ID="$(',
    `${buildNodeEvalCommand(getCodexSessionIdLookupScript())} -- --title ${quoteShellArg(resumeTitle)}`,
    ')"',
    "&&",
    'test -n "$CODEX_RESUME_SESSION_ID"',
    "&&",
    `${agentCommand} resume "$CODEX_RESUME_SESSION_ID"`,
    "||",
    `{ printf '%s\\n' ${quoteShellArg(`Unable to find restorable Codex session id for "${resumeTitle}".`)}; false; }`,
  ].join(" ");
}

function buildCodexForkLookupCommand(agentCommand: string, resumeTitle: string): string {
  return [
    'CODEX_FORK_SESSION_ID="$(',
    `${buildNodeEvalCommand(getCodexSessionIdLookupScript())} -- --title ${quoteShellArg(resumeTitle)}`,
    ')"',
    "&&",
    'test -n "$CODEX_FORK_SESSION_ID"',
    "&&",
    `${agentCommand} fork "$CODEX_FORK_SESSION_ID"`,
    "||",
    `printf '%s\\n' ${quoteShellArg(`Unable to find Codex session id for "${resumeTitle}".`)}`,
  ].join(" ");
}

function getClaudeSessionIdLookupScript(): string {
  return `const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const [projectPathArg = "", titleArg = "", firstPromptArg = ""] = process.argv.slice(1);
const projectPath = projectPathArg.trim();
const title = normalize(titleArg);
const firstPrompt = normalize(firstPromptArg);
if (!title && !firstPrompt) {
  process.exit(1);
}

const home = os.homedir();
const roots = [path.join(home, ".claude", "projects")];
const profilesRoot = path.join(home, ".claude-profiles");
try {
  for (const entry of fs.readdirSync(profilesRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      roots.push(path.join(profilesRoot, entry.name, "projects"));
    }
  }
} catch {}

function normalize(value) {
  return String(value || "").split(/\\s+/u).filter(Boolean).join(" ");
}

function textFromMessage(message) {
  if (typeof message === "string") {
    return message;
  }
  if (!message || typeof message !== "object") {
    return "";
  }
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = [];
    for (const item of content) {
      if (typeof item === "string") {
        parts.push(item);
      } else if (item && typeof item === "object" && typeof item.text === "string") {
        parts.push(item.text);
      }
    }
    return parts.join("\\n");
  }
  return "";
}

function expandHome(value) {
  if (value === "~") {
    return home;
  }
  return value.startsWith("~/") ? path.join(home, value.slice(2)) : value;
}

function normalizedPath(value) {
  return path.resolve(expandHome(value));
}

function pathContains(parent, child) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isProjectMatch(cwd) {
  if (!projectPath) {
    return true;
  }
  const cwdText = String(cwd || "").trim();
  if (!cwdText) {
    return false;
  }
  try {
    const project = normalizedPath(projectPath);
    const candidate = normalizedPath(cwdText);
    return candidate === project || pathContains(project, candidate) || pathContains(candidate, project);
  } catch {
    return cwdText === projectPath || cwdText.startsWith(projectPath.replace(/\\/+$/u, "") + "/") || projectPath.startsWith(cwdText.replace(/\\/+$/u, "") + "/");
  }
}

function scanTranscript(filePath) {
  let sessionId = path.basename(filePath).replace(/\\.jsonl$/u, "");
  const cwdValues = [];
  const names = [];
  const summaries = [];
  let firstUser = "";
  let latest = "";
  let lines;
  try {
    lines = fs.readFileSync(filePath, "utf8").split(/\\r?\\n/u);
  } catch {
    return undefined;
  }
  for (let index = 0; index < lines.length && index <= 2000; index += 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    if (typeof item.sessionId === "string" && item.sessionId.trim()) {
      sessionId = item.sessionId.trim();
    }
    if (typeof item.cwd === "string") {
      cwdValues.push(item.cwd);
    }
    if (typeof item.projectPath === "string") {
      cwdValues.push(item.projectPath);
    }
    if (typeof item.timestamp === "string" && item.timestamp > latest) {
      latest = item.timestamp;
    }
    const itemType = String(item.type || "");
    if (itemType === "custom-title" && typeof item.customTitle === "string") {
      names.push(item.customTitle);
    }
    if (itemType === "agent-name" && typeof item.agentName === "string") {
      names.push(item.agentName);
    }
    if (typeof item.slug === "string") {
      names.push(item.slug);
    }
    if (typeof item.summary === "string") {
      summaries.push(item.summary);
    }
    if (itemType === "user" && !firstUser) {
      firstUser = textFromMessage(item.message);
    }
  }
  const projectScore = cwdValues.some(isProjectMatch) ? 2 : 0;
  if (projectPath && projectScore === 0) {
    return undefined;
  }
  const normalizedNames = names.concat(summaries).map(normalize).filter(Boolean);
  const normalizedFirstUser = normalize(firstUser);
  let score = projectScore;
  if (title) {
    if (normalizedNames.some((value) => value === title)) {
      score += 8;
    } else if (normalizedNames.some((value) => value.includes(title) || title.includes(value))) {
      score += 4;
    }
  }
  if (firstPrompt && normalizedFirstUser) {
    if (normalizedFirstUser === firstPrompt) {
      score += 10;
    } else if (firstPrompt.includes(normalizedFirstUser) || normalizedFirstUser.includes(firstPrompt)) {
      score += 5;
    }
  }
  return score > 0 ? { latest, score, sessionId } : undefined;
}

const matches = [];
for (const root of roots) {
  let projectDirs;
  try {
    projectDirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory() || projectDir.name === "subagents") {
      continue;
    }
    const projectDirPath = path.join(root, projectDir.name);
    let files;
    try {
      files = fs.readdirSync(projectDirPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) {
        continue;
      }
      const result = scanTranscript(path.join(projectDirPath, file.name));
      if (result) {
        matches.push(result);
      }
    }
  }
}

if (!matches.length) {
  process.exit(1);
}

matches.sort((left, right) => left.score - right.score || left.latest.localeCompare(right.latest));
process.stdout.write(matches[matches.length - 1].sessionId);
`;
}

function getCodexSessionIdLookupScript(): string {
  return `const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const [mode = "", query = ""] = process.argv.slice(1).map((value) => String(value || "").trim());
if (!["--exact", "--title"].includes(mode) || !query) {
  process.exit(1);
}

const home = os.homedir();
const candidateHomes = [];
if (process.env.CODEX_HOME) {
  candidateHomes.push(expandHome(process.env.CODEX_HOME));
}
candidateHomes.push(
  path.join(home, ".codex-profiles", "personal"),
  path.join(home, ".codex-profiles", "work"),
  path.join(home, ".codex"),
);

const seen = new Set();
const codexHomes = [];
for (const candidate of candidateHomes) {
  let normalized = candidate;
  try {
    if (fs.existsSync(candidate)) {
      normalized = fs.realpathSync(candidate);
    }
  } catch {}
  if (seen.has(normalized)) {
    continue;
  }
  seen.add(normalized);
  codexHomes.push(normalized);
}

const sessionIdPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;
const internalTitlePromptMarkers = [
  "Write a concise session title that summarizes the user's text.",
  "Output handling:",
  "Print only the final result to stdout.",
];

function expandHome(value) {
  const text = String(value || "");
  if (text === "~") {
    return home;
  }
  return text.startsWith("~/") ? path.join(home, text.slice(2)) : text;
}

function resolveTranscriptPath(codexHome, value) {
  const expanded = expandHome(String(value || "").trim());
  return path.isAbsolute(expanded) ? expanded : path.join(codexHome, expanded);
}

function* walkFiles(root, sessionId) {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name.includes(sessionId) && entry.name.endsWith(".jsonl")) {
        yield entryPath;
      }
    }
  }
}

function transcriptPathsForSession(codexHome, sessionId, item = {}) {
  const paths = [];
  const seenPaths = new Set();
  for (const key of ["path", "session_path", "sessionPath", "transcript_path", "transcriptPath"]) {
    const value = typeof item[key] === "string" ? item[key].trim() : "";
    if (!value) {
      continue;
    }
    const transcriptPath = resolveTranscriptPath(codexHome, value);
    if (!seenPaths.has(transcriptPath)) {
      seenPaths.add(transcriptPath);
      paths.push(transcriptPath);
    }
  }
  const sessionsDir = path.join(codexHome, "sessions");
  for (const transcriptPath of walkFiles(sessionsDir, sessionId)) {
    if (!seenPaths.has(transcriptPath)) {
      seenPaths.add(transcriptPath);
      paths.push(transcriptPath);
    }
  }
  return paths;
}

function transcriptIsInternalCodexExec(transcriptPath) {
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, "utf8").split(/\\r?\\n/u);
  } catch {
    return false;
  }
  for (let index = 0; index < lines.length && index <= 80; index += 1) {
    const line = lines[index] || "";
    if (internalTitlePromptMarkers.every((marker) => line.includes(marker))) {
      return true;
    }
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = entry && typeof entry === "object" ? entry.payload : undefined;
    if (!payload || typeof payload !== "object") {
      continue;
    }
    if (String(payload.originator || "").trim() === "codex_exec") {
      return true;
    }
    if (String(payload.source || "").trim() === "exec") {
      return true;
    }
  }
  return false;
}

function isInternalCodexSession(codexHome, sessionId, item = {}) {
  if (String(item.originator || "").trim() === "codex_exec") {
    return true;
  }
  if (String(item.source || "").trim() === "exec") {
    return true;
  }
  return transcriptPathsForSession(codexHome, sessionId, item).some(transcriptIsInternalCodexExec);
}

function exactReferenceIsInternal(sessionId) {
  return codexHomes.some((codexHome) => isInternalCodexSession(codexHome, sessionId));
}

if (mode === "--exact") {
  const exactMatch = query.match(sessionIdPattern);
  if (!exactMatch) {
    process.stdout.write(query);
    process.exit(0);
  }
  const sessionId = exactMatch[0].toLowerCase();
  if (exactReferenceIsInternal(sessionId)) {
    process.exit(1);
  }
  process.stdout.write(sessionId);
  process.exit(0);
}

const matches = [];
for (const codexHome of codexHomes) {
  const indexPath = path.join(codexHome, "session_index.jsonl");
  let lines;
  try {
    lines = fs.readFileSync(indexPath, "utf8").split(/\\r?\\n/u);
  } catch {
    continue;
  }
  for (const line of lines) {
    if (!line) {
      continue;
    }
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    if (String(item.thread_name || "").trim() !== query) {
      continue;
    }
    const sessionId = String(item.id || "").trim();
    if (!sessionId || isInternalCodexSession(codexHome, sessionId, item)) {
      continue;
    }
    matches.push({ sessionId, updatedAt: String(item.updated_at || "") });
  }
}

if (!matches.length) {
  process.exit(1);
}

matches.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
process.stdout.write(matches[matches.length - 1].sessionId);
`;
}

function getCursorChatSessionLookupScript(): string {
  return `const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const [projectPath = "", title = ""] = process.argv.slice(1).map((value) => String(value || "").trim());
if (!projectPath || !title) {
  process.exit(1);
}

const projectHash = crypto.createHash("md5").update(projectPath).digest("hex");
const chatsDir = path.join(os.homedir(), ".cursor", "chats", projectHash);
let chatDirs;
try {
  chatDirs = fs.readdirSync(chatsDir, { withFileTypes: true });
} catch {
  process.exit(1);
}

function parseMetaValue(raw) {
  const value = String(raw || "").trim();
  if (value.startsWith("{")) {
    return JSON.parse(value);
  }
  return JSON.parse(Buffer.from(value, "hex").toString("utf8"));
}

const matches = [];
for (const chatDir of chatDirs) {
  if (!chatDir.isDirectory()) {
    continue;
  }
  const dbPath = path.join(chatsDir, chatDir.name, "store.db");
  if (!fs.existsSync(dbPath)) {
    continue;
  }
  let db;
  let rows;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    rows = db.prepare("select value from meta").all();
  } catch {
    rows = [];
  } finally {
    try {
      db?.close();
    } catch {}
  }
  for (const row of rows) {
    let meta;
    try {
      meta = parseMetaValue(row.value);
    } catch {
      continue;
    }
    if (String(meta.name || "").trim() !== title) {
      continue;
    }
    const chatId = String(meta.agentId || chatDir.name).trim();
    if (!chatId) {
      continue;
    }
    const createdAt = Number(meta.createdAt || 0);
    matches.push({ chatId, createdAt: Number.isFinite(createdAt) ? createdAt : 0 });
  }
}

if (!matches.length) {
  process.exit(1);
}

matches.sort((left, right) => left.createdAt - right.createdAt);
process.stdout.write(matches[matches.length - 1].chatId);
`;
}

function getOpenCodeSessionLookupScript(): string {
  return `const title = String(process.argv[1] || "").trim();
if (!title) {
  process.exit(1);
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  for (const line of input.split(/\\r?\\n/u)) {
    if (!line.trim()) {
      continue;
    }
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    const name = String(item.title || item.name || "").trim();
    const sessionId = String(item.id || "").trim();
    if (name === title && sessionId) {
      process.stdout.write(sessionId);
      process.exit(0);
    }
  }
  process.exit(1);
});
`;
}

function readAgentLaunchPlan(value: Record<string, unknown>): GxserverAgentLaunchPlan | undefined {
  const plan = normalizeObject(value.agentLaunchPlan);
  const startupText = normalizeStartupText(plan.startupText);
  const command = normalizeText(plan.command);
  return startupText || command
    ? {
        agentCommand: normalizeText(plan.agentCommand),
        command: command ?? "",
        firstUserMessage: normalizeText(plan.firstUserMessage),
        startupText: startupText ?? "",
        startupTextDisposition: plan.startupTextDisposition === "queueAfterTerminalReady" ? "queueAfterTerminalReady" : "none",
      }
    : undefined;
}

function normalizeDefaultAgentId(value: string | undefined): DefaultAgentId | undefined {
  return value && Object.prototype.hasOwnProperty.call(DEFAULT_AGENT_COMMANDS, value)
    ? (value as DefaultAgentId)
    : undefined;
}

function normalizeRestorableAgentId(value: string | undefined): RestorableAgentId | undefined {
  const agentId = normalizeDefaultAgentId(value);
  return agentId && agentId !== "t3" ? agentId : undefined;
}

function resolveDefaultAgentCommand(agentId: string | undefined): string | undefined {
  const normalized = normalizeDefaultAgentId(agentId);
  return normalized ? DEFAULT_AGENT_COMMANDS[normalized] : undefined;
}

function normalizeAcceptAllMode(value: unknown): GxserverAgentAcceptAllMode | undefined {
  return value === "inherit" || value === "enabled" || value === "disabled" ? value : undefined;
}

function normalizeObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeStartupText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

function getCommandExecutableName(command: string | undefined): string | undefined {
  const first = command?.trim().split(/\s+/u)[0]?.trim();
  return first ? first.replace(/^['"]|['"]$/gu, "").toLowerCase() : undefined;
}

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function quoteShellDoubleArg(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`")}"`;
}
