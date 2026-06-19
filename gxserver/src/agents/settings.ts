import type Database from "better-sqlite3";
import type {
  GxserverAgentSettings,
  GxserverReadAgentSettingsResult,
  GxserverUpdateAgentSettingsParams,
} from "../../protocol/index.js";

const AGENT_SETTINGS_METADATA_KEY = "agents.settings.v1";
const DEFAULT_PROMPT_AGENT_ID = "codex";
const MAX_DEFAULT_PROMPT_AGENT_ID_LENGTH = 120;

export const DEFAULT_GXSERVER_AGENT_SETTINGS: GxserverAgentSettings = {
  agentAcceptAllEnabled: true,
  defaultPromptAgentId: DEFAULT_PROMPT_AGENT_ID,
};

/*
CDXC:GxserverAgentSettings 2026-06-02-22:23:
Global agent launch policy is gxserver-owned daemon state, not macOS sidebar-local settings or per-project launchSettings. Store Accept All under metadata so macOS, CLI, TUI, mobile, and remote clients resolve inherited agent permissions through one shared source before gxserver builds launch, resume, wake, fork, and copy commands.

CDXC:GxserverAgentSettings 2026-06-19-08:58:
Default Prompt Agent now shares the same gxserver-owned metadata record as global Accept All. Preserve existing macOS selections by accepting plain built-in or custom agent ids without validating against a client-local agent registry; launch surfaces validate command availability at use time.
*/
export class GxserverAgentSettingsRepository {
  readonly #db: Database.Database;
  readonly #now: () => string;

  constructor(db: Database.Database, options: { now?: () => string } = {}) {
    this.#db = db;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  read(): GxserverAgentSettings {
    return this.readWithMetadata().settings;
  }

  readWithMetadata(): GxserverReadAgentSettingsResult {
    const row = this.#db
      .prepare<[string], { value: string }>("SELECT value FROM metadata WHERE key = ?")
      .get(AGENT_SETTINGS_METADATA_KEY);
    return {
      isPersisted: row !== undefined,
      settings: normalizeAgentSettings(row?.value),
    };
  }

  update(params: GxserverUpdateAgentSettingsParams): GxserverAgentSettings {
    const next = normalizeAgentSettings({
      ...this.read(),
      ...(typeof params.agentAcceptAllEnabled === "boolean"
        ? { agentAcceptAllEnabled: params.agentAcceptAllEnabled }
        : {}),
      ...(typeof params.defaultPromptAgentId === "string"
        ? { defaultPromptAgentId: params.defaultPromptAgentId }
        : {}),
    });
    const now = this.#now();
    this.#db
      .prepare(
        `INSERT INTO metadata (key, value, updatedAt)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
      )
      .run(AGENT_SETTINGS_METADATA_KEY, JSON.stringify(next), now);
    return next;
  }
}

export function normalizeAgentSettings(value: unknown): GxserverAgentSettings {
  const parsed = typeof value === "string" ? parseJsonObject(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...DEFAULT_GXSERVER_AGENT_SETTINGS };
  }
  const record = parsed as Record<string, unknown>;
  return {
    agentAcceptAllEnabled:
      typeof record.agentAcceptAllEnabled === "boolean"
        ? record.agentAcceptAllEnabled
        : DEFAULT_GXSERVER_AGENT_SETTINGS.agentAcceptAllEnabled,
    defaultPromptAgentId: normalizeDefaultPromptAgentId(
      typeof record.defaultPromptAgentId === "string"
        ? record.defaultPromptAgentId
        : undefined,
    ),
  };
}

function normalizeDefaultPromptAgentId(value: string | undefined): string {
  return ((value ?? "").trim() || DEFAULT_GXSERVER_AGENT_SETTINGS.defaultPromptAgentId).slice(
    0,
    MAX_DEFAULT_PROMPT_AGENT_ID_LENGTH,
  );
}

function parseJsonObject(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
