// Per-agent slash-command catalogs for the composer's "/" picker.
// Lists were extracted from the installed CLIs (codex/grok binaries via
// strings; Claude Code's built-in set) on 2026-07-31 — they are a curated
// snapshot, not discovered at runtime, so update them when an agent CLI adds
// commands. The names also feed classifySessionChatSend so verified commands
// get "Ran /x" markers instead of optimistic echoes.

export interface SessionChatSlashCommand {
  /** Command name without the leading slash. */
  readonly name: string;
  readonly description: string;
}

const CLAUDE_CODE_SLASH_COMMANDS: readonly SessionChatSlashCommand[] = [
  { name: "add-dir", description: "Add additional working directories" },
  { name: "agents", description: "Manage agent configurations" },
  { name: "bashes", description: "List and manage background shells" },
  { name: "bug", description: "Submit feedback about Claude Code" },
  { name: "clear", description: "Clear conversation history" },
  { name: "compact", description: "Compact conversation, keeping a summary" },
  { name: "config", description: "Open the settings panel" },
  { name: "context", description: "Show current context usage" },
  { name: "cost", description: "Show session cost and token usage" },
  { name: "doctor", description: "Diagnose installation issues" },
  { name: "exit", description: "Exit the REPL" },
  { name: "export", description: "Export the conversation" },
  { name: "help", description: "Show help and available commands" },
  { name: "hooks", description: "Manage hook configurations" },
  { name: "ide", description: "Manage IDE integrations" },
  { name: "init", description: "Create a CLAUDE.md for the project" },
  { name: "install-github-app", description: "Set up Claude GitHub Actions" },
  { name: "login", description: "Switch Anthropic accounts" },
  { name: "logout", description: "Sign out of your account" },
  { name: "mcp", description: "Manage MCP server connections" },
  { name: "memory", description: "Edit memory files" },
  { name: "model", description: "Set the AI model" },
  { name: "output-style", description: "Set the output style" },
  { name: "permissions", description: "Manage tool permissions" },
  { name: "pr-comments", description: "Get comments from a GitHub PR" },
  { name: "release-notes", description: "View release notes" },
  { name: "rename", description: "Rename the current session" },
  { name: "resume", description: "Resume a previous conversation" },
  { name: "review", description: "Review a pull request" },
  { name: "rewind", description: "Rewind conversation and/or code" },
  { name: "security-review", description: "Review changes for security issues" },
  { name: "status", description: "Show version, model, and connectivity" },
  { name: "statusline", description: "Set up the status line" },
  { name: "terminal-setup", description: "Install Shift+Enter key binding" },
  { name: "todos", description: "List current todo items" },
  { name: "usage", description: "Show plan usage limits" },
  { name: "vim", description: "Toggle vim editing mode" },
];

const CODEX_SLASH_COMMANDS: readonly SessionChatSlashCommand[] = [
  { name: "approvals", description: "Choose what Codex can do without approval" },
  { name: "compact", description: "Summarize conversation to save context" },
  { name: "diff", description: "Show git diff (including untracked files)" },
  { name: "init", description: "Create an AGENTS.md for Codex" },
  { name: "logout", description: "Log out of Codex" },
  { name: "mcp", description: "List configured MCP tools" },
  { name: "mention", description: "Mention a file" },
  { name: "model", description: "Choose model and reasoning effort" },
  { name: "new", description: "Start a new chat" },
  { name: "permissions", description: "Review and change tool permissions" },
  { name: "plan", description: "Switch to Plan mode" },
  { name: "quit", description: "Exit Codex" },
  { name: "rename", description: "Rename the current session" },
  { name: "review", description: "Review current changes and find issues" },
  { name: "status", description: "Show session configuration and token usage" },
  { name: "undo", description: "Restore workspace to the last snapshot" },
];

const GROK_SLASH_COMMANDS: readonly SessionChatSlashCommand[] = [
  { name: "clear", description: "Clear conversation history" },
  { name: "compact", description: "Compact conversation history" },
  { name: "editor", description: "Edit prompt in external editor" },
  { name: "exit", description: "Exit Grok" },
  { name: "help", description: "Show help and available commands" },
  { name: "init", description: "Initialize project context" },
  { name: "login", description: "Log in" },
  { name: "logout", description: "Log out" },
  { name: "mcp", description: "Manage MCP servers" },
  { name: "memory", description: "Manage memory" },
  { name: "model", description: "Switch model" },
  { name: "models", description: "List available models" },
  { name: "settings", description: "Open settings" },
  { name: "status", description: "Show session status" },
];

/** Conservative fallback for unrecognized agents (mirrors the default catalog). */
const FALLBACK_SLASH_COMMANDS: readonly SessionChatSlashCommand[] = [
  { name: "clear", description: "Clear conversation history" },
  { name: "compact", description: "Compact conversation history" },
  { name: "exit", description: "Exit the agent" },
  { name: "help", description: "Show help and available commands" },
  { name: "model", description: "Switch model" },
];

const SLASH_COMMANDS_BY_AGENT: Record<string, readonly SessionChatSlashCommand[]> = {
  claude: CLAUDE_CODE_SLASH_COMMANDS,
  openclaude: CLAUDE_CODE_SLASH_COMMANDS,
  codex: CODEX_SLASH_COMMANDS,
  grok: GROK_SLASH_COMMANDS,
};

const SLASH_HEADING_BY_AGENT: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  grok: "Grok",
  openclaude: "OpenClaude",
};

/** Picker section heading (the agent's display name, "Commands" fallback). */
export function sessionChatSlashHeadingForAgent(
  agent: string | null | undefined,
): string {
  if (agent === null || agent === undefined) {
    return "Commands";
  }
  return SLASH_HEADING_BY_AGENT[agent] ?? "Commands";
}

export function sessionChatSlashCommandsForAgent(
  agent: string | null | undefined,
): readonly SessionChatSlashCommand[] {
  if (agent === null || agent === undefined) {
    return FALLBACK_SLASH_COMMANDS;
  }
  return SLASH_COMMANDS_BY_AGENT[agent] ?? FALLBACK_SLASH_COMMANDS;
}

/**
 * The token being completed: the whole draft when it is a single line-leading
 * "/word" with no whitespace yet, else null (picker closed).
 */
export function sessionChatSlashQuery(draft: string): string | null {
  return /^\/[^\s/]*$/.test(draft) ? draft.slice(1) : null;
}

export function filterSessionChatSlashCommands(
  commands: readonly SessionChatSlashCommand[],
  query: string,
): readonly SessionChatSlashCommand[] {
  if (query === "") {
    return commands;
  }
  const lower = query.toLowerCase();
  const prefixed = commands.filter((command) => command.name.startsWith(lower));
  const substring = commands.filter(
    (command) => !command.name.startsWith(lower) && command.name.includes(lower),
  );
  return [...prefixed, ...substring];
}
