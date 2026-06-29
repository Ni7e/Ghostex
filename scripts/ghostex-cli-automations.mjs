const AUTOMATION_ENDPOINTS = {
  archiveRun: "/api/archiveAutomationRun",
  delete: "/api/deleteAutomation",
  markRunRead: "/api/markAutomationRunRead",
  runNow: "/api/runAutomationNow",
  save: "/api/saveAutomation",
  setEnabled: "/api/setAutomationEnabled",
  state: "/api/readAutomationState",
};

export function registerAutomationCommands(commands, context) {
  /*
   * CDXC:GxserverAutomations 2026-06-29-15:55:
   * `ghostex` and `gx` automation commands should talk to gxserver-rs automation RPCs directly. Keep this in a separate CLI module so the main dispatcher does not own automation parsing or route through renderer command automation actions.
   */
  commands.set("automation-state", automationCommand(AUTOMATION_ENDPOINTS.state, parseAutomationProject, context));
  commands.set("automation-save", automationCommand(AUTOMATION_ENDPOINTS.save, parseAutomationSave, context));
  commands.set("automation-delete", automationCommand(AUTOMATION_ENDPOINTS.delete, parseAutomationId, context));
  commands.set("automation-run-now", automationCommand(AUTOMATION_ENDPOINTS.runNow, parseAutomationId, context));
  commands.set("automation-set-enabled", automationCommand(AUTOMATION_ENDPOINTS.setEnabled, parseAutomationEnabled, context));
  commands.set("automation-archive-run", automationCommand(AUTOMATION_ENDPOINTS.archiveRun, parseAutomationRun, context));
  commands.set("automation-mark-run-read", automationCommand(AUTOMATION_ENDPOINTS.markRunRead, parseAutomationRun, context));
}

export function automationHelpCommands(formatHelpCommand) {
  return [
    formatHelpCommand("automation-state [--path path|--project-id id]", "Print gxserver automations and run history"),
    formatHelpCommand("automation-save --path path --definition-json json", "Create or update a gxserver automation"),
    formatHelpCommand("automation-delete <automationId> --path path", "Delete a gxserver automation"),
    formatHelpCommand("automation-run-now <automationId> --path path", "Queue a gxserver automation immediately"),
    formatHelpCommand("automation-set-enabled <automationId> <true|false> --path path", "Pause or resume a gxserver automation"),
    formatHelpCommand("automation-archive-run --run-id id --path path [--remove-worktree true]", "Archive a completed gxserver run"),
    formatHelpCommand("automation-mark-run-read --run-id id --path path", "Mark a gxserver run as read"),
  ];
}

function automationCommand(pathname, parser, context) {
  return async (args) => {
    const { flags, rest } = context.parseArgs(args);
    const payload = parser(rest, flags);
    const result = await context.callGxserverRpc(pathname, payload, flags);
    if (context.isFailedCliResult(result)) {
      context.printJson(result);
      process.exitCode = 1;
      return;
    }
    context.printJson(result);
  };
}

function parseAutomationProject(rest, flags) {
  return {
    projectId: flags.projectId,
    projectPath: flags.projectPath ?? flags.path ?? rest[0],
  };
}

function parseAutomationSave(rest, flags) {
  const definitionJson = flags.definitionJson ?? flags.payloadJson ?? rest.join(" ");
  return {
    ...parseAutomationProject([], flags),
    definition: typeof definitionJson === "string" ? parseJson(definitionJson) : undefined,
  };
}

function parseAutomationId(rest, flags) {
  return {
    ...parseAutomationProject([], flags),
    automationId: flags.automationId ?? flags.id ?? rest[0],
  };
}

function parseAutomationEnabled(rest, flags) {
  return {
    ...parseAutomationId(rest, flags),
    enabled: parseBoolean(flags.enabled ?? flags.value ?? rest[1] ?? "true"),
  };
}

function parseAutomationRun(rest, flags) {
  return {
    ...parseAutomationProject([], flags),
    removeWorktree: parseBoolean(flags.removeWorktree ?? "false"),
    runId: flags.runId ?? flags.id ?? rest[0],
  };
}

function parseBoolean(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

function parseJson(text) {
  if (!String(text ?? "").trim()) {
    return undefined;
  }
  return JSON.parse(String(text));
}
