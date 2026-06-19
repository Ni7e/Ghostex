import type { GxserverSessionDomainState } from "../../protocol/index.js";
import {
  getVisibleTerminalTitle,
  isGhostPlaceholderSessionTitle,
  isTemporarySessionTitle,
} from "./normalization.js";
import type { GxserverSessionTitleSource } from "./types.js";
import { isGxserverSessionId } from "../ids.js";

const TERMINAL_TITLE_SESSION_SYNC_AGENT_IDS = new Set([
  "antigravity",
  "claude",
  "codex",
  "copilot",
  "cursor",
  "gemini",
  "hermes-agent",
  "opencode",
  "pi",
  "qoder",
  "rovodev",
]);

const AGENT_COMMAND_EXECUTABLE_NAMES = new Set([
  "acli",
  "agy",
  "amp",
  "claude",
  "codebuddy",
  "codex",
  "copilot",
  "cursor-agent",
  "droid",
  "gemini",
  "grok",
  "hermes",
  "kiro-cli",
  "omp",
  "opencode",
  "pi",
  "qodercli",
]);

/*
CDXC:GxserverSessionTitles 2026-06-01-20:59:
Terminal titles can legitimately start with an agent name, such as "Codex zshrc additions". Reject only titles that still look like an agent launch command, so gxserver trusts settled zmx title observations without letting resume commands become durable sidebar titles.

CDXC:GxserverSessionTitles 2026-06-19-15:55:
Ghostex routing ids are provider-agnostic row identifiers, not agent conversation titles. Reject raw G-session ids from title-based resume lookup so a fresh Cursor/Codex/Claude pane never runs a provider resume command against `G3gnt`-style session ids.
*/
const AGENT_COMMAND_SUBCOMMAND_NAMES = new Set([
  "auth",
  "completion",
  "debug",
  "exec",
  "help",
  "login",
  "logout",
  "mcp",
  "resume",
  "run",
  "sandbox",
  "session",
  "sessions",
]);

export function normalizeTitleSource(value: unknown, title: unknown): GxserverSessionTitleSource {
  if (
    value === "browser-auto" ||
    value === "generated" ||
    value === "placeholder" ||
    value === "terminal-auto" ||
    value === "user"
  ) {
    return value;
  }
  return isTemporarySessionTitle(title) ? "placeholder" : "user";
}

export function normalizeSessionTitleRuntimeSettings(value: unknown, title: unknown): Record<string, unknown> {
  const settings: Record<string, unknown> =
    typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
  if (isTemporarySessionTitle(title) && typeof settings.titleSource !== "string") {
    /*
    CDXC:PreviousSessions 2026-05-31-15:00:
    gxserver owns title provenance. Search by Text is a temporary `gx f`
    launch label, so older clients that omit titleSource must still persist it
    as a placeholder and let the next real terminal title replace it.
    */
    return { ...settings, titleSource: "placeholder" };
  }
  return settings;
}

export function getSessionTitleSource(session: GxserverSessionDomainState): GxserverSessionTitleSource {
  return normalizeTitleSource(
    normalizeText(session.runtimeSettings.titleSource) ?? normalizeText(session.runtimeSettings.restoreTitleSource),
    session.title,
  );
}

export function getTrustedResumeTitle(
  session: Pick<GxserverSessionDomainState, "runtimeSettings" | "title">,
): { reason: string; title?: string } {
  const titleSource = normalizeTitleSource(
    normalizeText(session.runtimeSettings.titleSource) ?? normalizeText(session.runtimeSettings.restoreTitleSource),
    session.title,
  );
  if (titleSource === "placeholder") {
    return { reason: "untrusted-title-source:placeholder" };
  }
  const resumeTitle = getVisibleTerminalTitle(session.title)?.trim();
  if (!resumeTitle) {
    return { reason: "title-empty-or-filtered" };
  }
  if (isRejectedResumeTitle(resumeTitle)) {
    return { reason: "title-rejected-as-command-or-noise" };
  }
  return { reason: "trusted-stored-title", title: resumeTitle };
}

export function isRejectedResumeTitle(title: string): boolean {
  const normalizedTitle = title.trim();
  const normalizedLowerTitle = normalizedTitle.toLowerCase();
  return (
    normalizedTitle === "ð^ß^Ñ»" ||
    isTemporarySessionTitle(normalizedTitle) ||
    isGhostPlaceholderSessionTitle(normalizedTitle) ||
    isGxserverSessionId(normalizedTitle) ||
    /[\u0000-\u001f\u007f]/u.test(normalizedTitle) ||
    (normalizedTitle.startsWith("ð") && normalizedTitle.endsWith("»")) ||
    isAgentCommandNoiseTitle(normalizedLowerTitle)
  );
}

export function supportsTerminalTitleSessionSync(agentName: string | undefined): boolean {
  const normalizedAgentName = agentName?.trim().toLowerCase();
  if (!normalizedAgentName) {
    return false;
  }
  return (
    TERMINAL_TITLE_SESSION_SYNC_AGENT_IDS.has(normalizedAgentName) ||
    [
      "claude code",
      "codex cli",
      "agy",
      "antigravity cli",
      "cursor agent",
      "cursor cli",
      "cursor-agent",
      "github copilot",
      "hermes",
      "hermes agent",
      "open code",
      "qodercli",
      "rovo",
      "rovo dev",
      "π",
    ].includes(normalizedAgentName)
  );
}

export function isValidAgentTerminalTitle(title: string, agentName: string | undefined): boolean {
  return (
    supportsTerminalTitleSessionSync(agentName) &&
    title.trim().length > 1 &&
    /[\p{L}\p{N}]/u.test(title) &&
    getVisibleTerminalTitle(title) !== undefined &&
    !isRejectedResumeTitle(title)
  );
}

function getCommandExecutableName(command: string | undefined): string | undefined {
  const firstPart = command?.trim().split(/\s+/u)[0]?.trim();
  return firstPart ? firstPart.replace(/^['"]|['"]$/gu, "").toLowerCase() : undefined;
}

function isAgentCommandNoiseTitle(title: string): boolean {
  const executableName = getCommandExecutableName(title);
  if (!executableName || !AGENT_COMMAND_EXECUTABLE_NAMES.has(executableName)) {
    return false;
  }
  if (title === executableName) {
    return true;
  }
  const rest = title.slice(executableName.length).trim();
  if (!rest) {
    return true;
  }
  if (rest.startsWith("-")) {
    return true;
  }
  const firstArg = rest.split(/\s+/u)[0];
  return firstArg ? AGENT_COMMAND_SUBCOMMAND_NAMES.has(firstArg) : false;
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
