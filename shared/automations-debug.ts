import type {
  ProjectAutomationAgentOption,
  ProjectAutomationTargetOption,
  ProjectAutomationsBridgeState,
} from "./automations";

export type ProjectAutomationLogSurface = "automate" | "overview";

export type ProjectAutomationLogContext = {
  agentSelectItemCount?: number;
  dialogOpen?: boolean;
  draftAgentKnown?: boolean;
  draftHasAgent?: boolean;
  draftProjectKnown?: boolean;
  experimentalFeaturesEnabled?: boolean;
  globalScope?: boolean;
  hasPayload?: boolean;
  phase?: string;
  remote?: boolean;
  responseOk?: boolean;
  surface: ProjectAutomationLogSurface;
  targetProjectKnown?: boolean;
};

export function summarizeProjectAutomationsForLog(
  state: Pick<
    ProjectAutomationsBridgeState,
    | "agents"
    | "automations"
    | "defaultAgentId"
    | "projectCanUseWorktrees"
    | "projects"
    | "runs"
    | "worktreeUnavailableReason"
  >,
  context: ProjectAutomationLogContext,
): Record<string, unknown> {
  /*
   * CDXC:Automations 2026-07-01-02:47:
   * Automation picker diagnostics must explain empty Agent selects without leaking project names, paths, agent labels, commands, URLs, prompts, or secret-looking values. Keep the shared log shape to counts, booleans, and fixed enum context so Overview and Automate diagnostics remain support-bundle safe.
   */
  return {
    ...context,
    ...summarizeProjectAutomationAgentsForLog(state.agents, state.defaultAgentId),
    automationCount: state.automations.length,
    projectCanUseWorktrees: state.projectCanUseWorktrees,
    ...summarizeProjectAutomationTargetsForLog(state.projects),
    runCount: state.runs.length,
    worktreeUnavailable: Boolean(state.worktreeUnavailableReason),
  };
}

export function summarizeProjectAutomationAgentsForLog(
  agents: readonly Pick<ProjectAutomationAgentOption, "agentId" | "command" | "icon">[],
  defaultAgentId?: string,
): Record<string, unknown> {
  const agentIds = new Set(agents.map((agent) => agent.agentId.trim()).filter(Boolean));
  const normalizedDefaultAgentId = defaultAgentId?.trim() ?? "";
  return {
    agentCount: agents.length,
    agentsWithCommandCount: agents.filter((agent) => Boolean(agent.command?.trim())).length,
    agentsWithIconCount: agents.filter((agent) => Boolean(agent.icon)).length,
    defaultAgentKnown: Boolean(normalizedDefaultAgentId && agentIds.has(normalizedDefaultAgentId)),
    hasDefaultAgentId: normalizedDefaultAgentId.length > 0,
  };
}

export function summarizeProjectAutomationTargetsForLog(
  projects: readonly Pick<ProjectAutomationTargetOption, "canUseWorktrees" | "worktreeUnavailableReason">[],
): Record<string, unknown> {
  return {
    projectOptionCount: projects.length,
    projectsWithWorktreeCount: projects.filter((project) => project.canUseWorktrees).length,
    projectsWithWorktreeUnavailableReasonCount: projects.filter((project) =>
      Boolean(project.worktreeUnavailableReason),
    ).length,
  };
}

export function summarizeAutomationErrorForLog(error: unknown): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error);
  return {
    errorType: automationDiagnosticErrorType(error),
    hasMessage: message.trim().length > 0,
    messageLength: message.length,
  };
}

function automationDiagnosticErrorType(error: unknown): string {
  if (!(error instanceof Error)) {
    return typeof error;
  }
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(error.name) ? error.name : "Error";
}
