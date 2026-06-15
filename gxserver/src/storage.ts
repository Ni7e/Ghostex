import Database from "better-sqlite3";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  GXSERVER_LOCAL_API_HOST,
  GXSERVER_PRODUCT,
  type GxserverListenerConfig,
  type GxserverMigrationStatus,
} from "../protocol/index.js";
import { readGxserverLocalApiPort } from "./constants.js";
import type { GxserverPaths } from "./paths.js";
import { createTailscaleRemoteListenerConfig, normalizeRemoteListenerConfig } from "./remote-listener.js";

export interface GxserverMigration {
  id: string;
  sql: string;
}

export interface GxserverStorageInitResult {
  appliedMigrations: string[];
  stateDbFile: string;
}

export interface GxserverCorsConfig {
  allowedOrigins: string[];
}

export interface GxserverConfig {
  cors: GxserverCorsConfig;
  createdAt: string;
  listeners: {
    local: GxserverListenerConfig;
    remote: GxserverListenerConfig;
  };
  product: typeof GXSERVER_PRODUCT;
}

export class GxserverLocalListenerConfigError extends Error {
  readonly code = "badRequest" as const;

  constructor(message: string) {
    super(message);
    this.name = "GxserverLocalListenerConfigError";
  }
}

/*
CDXC:GxserverCors 2026-05-30-20:15:
Browser access to gxserver is limited to native WKWebView `Origin: null`, known local sidebar development origins, and exact origins added to config.json. CLI and server-to-server clients do not need CORS, so responses without a browser Origin header should not expose CORS or private-network permissions.
*/
const DEFAULT_GXSERVER_CORS_ALLOWED_ORIGINS = [
  "null",
  "http://127.0.0.1:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:6006",
  "http://localhost:4173",
  "http://localhost:5173",
  "http://localhost:6006",
] as const;

export const GxserverStorageMigrations: readonly GxserverMigration[] = [
  {
    id: "0001_foundation",
    sql: `
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS id_allocations (
        allocationId INTEGER PRIMARY KEY,
        id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('server', 'project', 'session')),
        parentId TEXT NOT NULL DEFAULT '',
        createdAt TEXT NOT NULL,
        UNIQUE(kind, parentId, id)
      );

      CREATE INDEX IF NOT EXISTS idx_id_allocations_kind_parent
        ON id_allocations(kind, parentId);

      PRAGMA user_version = 1;
    `,
  },
  {
    id: "0002_domain_state",
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        projectId TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT,
        identityIconJson TEXT NOT NULL DEFAULT '{}',
        isPinned INTEGER NOT NULL DEFAULT 0 CHECK (isPinned IN (0, 1)),
        isFavorite INTEGER NOT NULL DEFAULT 0 CHECK (isFavorite IN (0, 1)),
        defaultCommand TEXT,
        worktreeJson TEXT NOT NULL DEFAULT '{}',
        customAgentsJson TEXT NOT NULL DEFAULT '[]',
        customAgentOrderJson TEXT NOT NULL DEFAULT '[]',
        customCommandsJson TEXT NOT NULL DEFAULT '[]',
        customCommandOrderJson TEXT NOT NULL DEFAULT '[]',
        deletedDefaultCommandIdsJson TEXT NOT NULL DEFAULT '[]',
        launchSettingsJson TEXT NOT NULL DEFAULT '{}',
        runtimeSettingsJson TEXT NOT NULL DEFAULT '{}',
        completionRulesJson TEXT NOT NULL DEFAULT '{}',
        attentionRulesJson TEXT NOT NULL DEFAULT '{}',
        notificationRulesJson TEXT NOT NULL DEFAULT '{}',
        gitConfigJson TEXT NOT NULL DEFAULT '{}',
        projectBoardConfigJson TEXT NOT NULL DEFAULT '{}',
        previousSessionHistoryJson TEXT NOT NULL DEFAULT '[]',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        projectId TEXT NOT NULL,
        sessionId TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('terminal', 'agent')),
        title TEXT NOT NULL,
        lifecycleState TEXT NOT NULL CHECK (lifecycleState IN ('running', 'sleeping', 'stopped', 'missing', 'unknown')),
        providerStateJson TEXT NOT NULL,
        zmxName TEXT NOT NULL,
        cwd TEXT,
        agentId TEXT,
        commandId TEXT,
        isPinned INTEGER NOT NULL DEFAULT 0 CHECK (isPinned IN (0, 1)),
        isFavorite INTEGER NOT NULL DEFAULT 0 CHECK (isFavorite IN (0, 1)),
        restoredFromSessionId TEXT,
        restoredFromHistoryId TEXT,
        launchSettingsJson TEXT NOT NULL DEFAULT '{}',
        runtimeSettingsJson TEXT NOT NULL DEFAULT '{}',
        completionRulesJson TEXT NOT NULL DEFAULT '{}',
        attentionRulesJson TEXT NOT NULL DEFAULT '{}',
        notificationRulesJson TEXT NOT NULL DEFAULT '{}',
        worktreeJson TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        lastActiveAt TEXT,
        PRIMARY KEY (projectId, sessionId),
        FOREIGN KEY (projectId) REFERENCES projects(projectId) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_project_updated
        ON sessions(projectId, updatedAt);

      PRAGMA user_version = 2;
    `,
  },
  {
    id: "0003_session_sidebar_order",
    sql: `
      ALTER TABLE sessions ADD COLUMN sidebarOrder REAL;

      CREATE INDEX IF NOT EXISTS idx_sessions_project_sidebar_order
        ON sessions(projectId, sidebarOrder);

      PRAGMA user_version = 3;
    `,
  },
  {
    id: "0004_previous_session_history_quality",
    sql: `
      DELETE FROM sessions
      WHERE lifecycleState NOT IN ('running', 'sleeping')
        AND isPinned = 0
        AND isFavorite = 0
        AND lastActiveAt IS NULL
        AND (
          lifecycleState <> 'stopped'
          OR lower(trim(title)) IN (
            'terminal session',
            'amp cli session',
            'amp session',
            'antigravity cli session',
            'antigravity session',
            'claude session',
            'claude code session',
            'codebuddy session',
            'code buddy session',
            'codex session',
            'codex cli session',
            'copilot session',
            'cursor agent session',
            'cursor cli session',
            'cursor session',
            'droid session',
            'factory droid session',
            'gemini session',
            'grok session',
            'grok build session',
            'hermes session',
            'hermes agent session',
            'kiro session',
            'kiro cli session',
            'omp session',
            'opencode session',
            'open code session',
            'openai codex session',
            'pi session',
            'qoder session',
            'qodercli session',
            'rovo session',
            'rovo dev session',
            'rovodev session',
            'search by text',
            't3 code session'
          )
          OR trim(title) GLOB 'Session [0-9]*'
          OR trim(title) GLOB '👻*'
        );

      UPDATE sessions
      SET lastActiveAt = updatedAt
      WHERE lifecycleState NOT IN ('running', 'sleeping')
        AND lastActiveAt IS NULL;

      PRAGMA user_version = 4;
    `,
  },
  {
    id: "0005_session_tags",
    sql: `
      ALTER TABLE sessions ADD COLUMN sessionTag TEXT CHECK (
        sessionTag IS NULL OR sessionTag IN (
          'favorite',
          'high-priority',
          'research',
          'todo',
          'in-progress',
          'testing',
          'blocked',
          'low-priority',
          'on-hold',
          'done',
          'bug',
          'feature',
          'design'
        )
      );

      UPDATE sessions
      SET sessionTag = 'favorite'
      WHERE isFavorite = 1
        AND sessionTag IS NULL;

      PRAGMA user_version = 5;
    `,
  },
  {
    id: "0006_expand_session_tags",
    sql: `
      UPDATE sessions
      SET sessionTag = NULL
      WHERE sessionTag IS NOT NULL
        AND sessionTag NOT IN (
          'favorite',
          'high-priority',
          'research',
          'todo',
          'in-progress',
          'testing',
          'blocked',
          'low-priority',
          'on-hold',
          'done',
          'bug',
          'feature',
          'design'
        );

      CREATE TABLE sessions_next (
        projectId TEXT NOT NULL,
        sessionId TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('terminal', 'agent')),
        title TEXT NOT NULL,
        lifecycleState TEXT NOT NULL CHECK (lifecycleState IN ('running', 'sleeping', 'stopped', 'missing', 'unknown')),
        providerStateJson TEXT NOT NULL,
        zmxName TEXT NOT NULL,
        cwd TEXT,
        agentId TEXT,
        commandId TEXT,
        isPinned INTEGER NOT NULL DEFAULT 0 CHECK (isPinned IN (0, 1)),
        isFavorite INTEGER NOT NULL DEFAULT 0 CHECK (isFavorite IN (0, 1)),
        restoredFromSessionId TEXT,
        restoredFromHistoryId TEXT,
        launchSettingsJson TEXT NOT NULL DEFAULT '{}',
        runtimeSettingsJson TEXT NOT NULL DEFAULT '{}',
        completionRulesJson TEXT NOT NULL DEFAULT '{}',
        attentionRulesJson TEXT NOT NULL DEFAULT '{}',
        notificationRulesJson TEXT NOT NULL DEFAULT '{}',
        worktreeJson TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        lastActiveAt TEXT,
        sidebarOrder REAL,
        sessionTag TEXT CHECK (
          sessionTag IS NULL OR sessionTag IN (
            'favorite',
            'high-priority',
            'research',
            'todo',
            'in-progress',
            'testing',
            'blocked',
            'low-priority',
            'on-hold',
            'done',
            'bug',
            'feature',
            'design'
          )
        ),
        PRIMARY KEY (projectId, sessionId),
        FOREIGN KEY (projectId) REFERENCES projects(projectId) ON DELETE CASCADE
      );

      INSERT INTO sessions_next (
        projectId,
        sessionId,
        kind,
        title,
        lifecycleState,
        providerStateJson,
        zmxName,
        cwd,
        agentId,
        commandId,
        isPinned,
        isFavorite,
        restoredFromSessionId,
        restoredFromHistoryId,
        launchSettingsJson,
        runtimeSettingsJson,
        completionRulesJson,
        attentionRulesJson,
        notificationRulesJson,
        worktreeJson,
        createdAt,
        updatedAt,
        lastActiveAt,
        sidebarOrder,
        sessionTag
      )
      SELECT
        projectId,
        sessionId,
        kind,
        title,
        lifecycleState,
        providerStateJson,
        zmxName,
        cwd,
        agentId,
        commandId,
        isPinned,
        isFavorite,
        restoredFromSessionId,
        restoredFromHistoryId,
        launchSettingsJson,
        runtimeSettingsJson,
        completionRulesJson,
        attentionRulesJson,
        notificationRulesJson,
        worktreeJson,
        createdAt,
        updatedAt,
        lastActiveAt,
        sidebarOrder,
        sessionTag
      FROM sessions;

      DROP TABLE sessions;
      ALTER TABLE sessions_next RENAME TO sessions;

      CREATE INDEX IF NOT EXISTS idx_sessions_project_updated
        ON sessions(projectId, updatedAt);

      CREATE INDEX IF NOT EXISTS idx_sessions_project_sidebar_order
        ON sessions(projectId, sidebarOrder);

      PRAGMA user_version = 6;
    `,
  },
  {
    id: "0007_expand_session_tags_in_progress_and_type",
    sql: `
      UPDATE sessions
      SET sessionTag = NULL
      WHERE sessionTag IS NOT NULL
        AND sessionTag NOT IN (
          'favorite',
          'high-priority',
          'research',
          'todo',
          'in-progress',
          'testing',
          'blocked',
          'low-priority',
          'on-hold',
          'done',
          'bug',
          'feature',
          'design'
        );

      CREATE TABLE sessions_next (
        projectId TEXT NOT NULL,
        sessionId TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('terminal', 'agent')),
        title TEXT NOT NULL,
        lifecycleState TEXT NOT NULL CHECK (lifecycleState IN ('running', 'sleeping', 'stopped', 'missing', 'unknown')),
        providerStateJson TEXT NOT NULL,
        zmxName TEXT NOT NULL,
        cwd TEXT,
        agentId TEXT,
        commandId TEXT,
        isPinned INTEGER NOT NULL DEFAULT 0 CHECK (isPinned IN (0, 1)),
        isFavorite INTEGER NOT NULL DEFAULT 0 CHECK (isFavorite IN (0, 1)),
        restoredFromSessionId TEXT,
        restoredFromHistoryId TEXT,
        launchSettingsJson TEXT NOT NULL DEFAULT '{}',
        runtimeSettingsJson TEXT NOT NULL DEFAULT '{}',
        completionRulesJson TEXT NOT NULL DEFAULT '{}',
        attentionRulesJson TEXT NOT NULL DEFAULT '{}',
        notificationRulesJson TEXT NOT NULL DEFAULT '{}',
        worktreeJson TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        lastActiveAt TEXT,
        sidebarOrder REAL,
        sessionTag TEXT CHECK (
          sessionTag IS NULL OR sessionTag IN (
            'favorite',
            'high-priority',
            'research',
            'todo',
            'in-progress',
            'testing',
            'blocked',
            'low-priority',
            'on-hold',
            'done',
            'bug',
            'feature',
            'design'
          )
        ),
        PRIMARY KEY (projectId, sessionId),
        FOREIGN KEY (projectId) REFERENCES projects(projectId) ON DELETE CASCADE
      );

      INSERT INTO sessions_next (
        projectId,
        sessionId,
        kind,
        title,
        lifecycleState,
        providerStateJson,
        zmxName,
        cwd,
        agentId,
        commandId,
        isPinned,
        isFavorite,
        restoredFromSessionId,
        restoredFromHistoryId,
        launchSettingsJson,
        runtimeSettingsJson,
        completionRulesJson,
        attentionRulesJson,
        notificationRulesJson,
        worktreeJson,
        createdAt,
        updatedAt,
        lastActiveAt,
        sidebarOrder,
        sessionTag
      )
      SELECT
        projectId,
        sessionId,
        kind,
        title,
        lifecycleState,
        providerStateJson,
        zmxName,
        cwd,
        agentId,
        commandId,
        isPinned,
        isFavorite,
        restoredFromSessionId,
        restoredFromHistoryId,
        launchSettingsJson,
        runtimeSettingsJson,
        completionRulesJson,
        attentionRulesJson,
        notificationRulesJson,
        worktreeJson,
        createdAt,
        updatedAt,
        lastActiveAt,
        sidebarOrder,
        sessionTag
      FROM sessions;

      DROP TABLE sessions;
      ALTER TABLE sessions_next RENAME TO sessions;

      CREATE INDEX IF NOT EXISTS idx_sessions_project_updated
        ON sessions(projectId, updatedAt);

      CREATE INDEX IF NOT EXISTS idx_sessions_project_sidebar_order
        ON sessions(projectId, sidebarOrder);

      PRAGMA user_version = 7;
    `,
  },
  {
    id: "0008_remove_retired_session_type_tags",
    sql: `
      UPDATE sessions
      SET sessionTag = NULL
      WHERE sessionTag IS NOT NULL
        AND sessionTag NOT IN (
          'favorite',
          'high-priority',
          'research',
          'todo',
          'in-progress',
          'testing',
          'blocked',
          'low-priority',
          'on-hold',
          'done',
          'bug',
          'feature',
          'design'
        );

      CREATE TABLE sessions_next (
        projectId TEXT NOT NULL,
        sessionId TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('terminal', 'agent')),
        title TEXT NOT NULL,
        lifecycleState TEXT NOT NULL CHECK (lifecycleState IN ('running', 'sleeping', 'stopped', 'missing', 'unknown')),
        providerStateJson TEXT NOT NULL,
        zmxName TEXT NOT NULL,
        cwd TEXT,
        agentId TEXT,
        commandId TEXT,
        isPinned INTEGER NOT NULL DEFAULT 0 CHECK (isPinned IN (0, 1)),
        isFavorite INTEGER NOT NULL DEFAULT 0 CHECK (isFavorite IN (0, 1)),
        restoredFromSessionId TEXT,
        restoredFromHistoryId TEXT,
        launchSettingsJson TEXT NOT NULL DEFAULT '{}',
        runtimeSettingsJson TEXT NOT NULL DEFAULT '{}',
        completionRulesJson TEXT NOT NULL DEFAULT '{}',
        attentionRulesJson TEXT NOT NULL DEFAULT '{}',
        notificationRulesJson TEXT NOT NULL DEFAULT '{}',
        worktreeJson TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        lastActiveAt TEXT,
        sidebarOrder REAL,
        sessionTag TEXT CHECK (
          sessionTag IS NULL OR sessionTag IN (
            'favorite',
            'high-priority',
            'research',
            'todo',
            'in-progress',
            'testing',
            'blocked',
            'low-priority',
            'on-hold',
            'done',
            'bug',
            'feature',
            'design'
          )
        ),
        PRIMARY KEY (projectId, sessionId),
        FOREIGN KEY (projectId) REFERENCES projects(projectId) ON DELETE CASCADE
      );

      INSERT INTO sessions_next (
        projectId,
        sessionId,
        kind,
        title,
        lifecycleState,
        providerStateJson,
        zmxName,
        cwd,
        agentId,
        commandId,
        isPinned,
        isFavorite,
        restoredFromSessionId,
        restoredFromHistoryId,
        launchSettingsJson,
        runtimeSettingsJson,
        completionRulesJson,
        attentionRulesJson,
        notificationRulesJson,
        worktreeJson,
        createdAt,
        updatedAt,
        lastActiveAt,
        sidebarOrder,
        sessionTag
      )
      SELECT
        projectId,
        sessionId,
        kind,
        title,
        lifecycleState,
        providerStateJson,
        zmxName,
        cwd,
        agentId,
        commandId,
        isPinned,
        isFavorite,
        restoredFromSessionId,
        restoredFromHistoryId,
        launchSettingsJson,
        runtimeSettingsJson,
        completionRulesJson,
        attentionRulesJson,
        notificationRulesJson,
        worktreeJson,
        createdAt,
        updatedAt,
        lastActiveAt,
        sidebarOrder,
        sessionTag
      FROM sessions;

      DROP TABLE sessions;
      ALTER TABLE sessions_next RENAME TO sessions;

      CREATE INDEX IF NOT EXISTS idx_sessions_project_updated
        ON sessions(projectId, updatedAt);

      CREATE INDEX IF NOT EXISTS idx_sessions_project_sidebar_order
        ON sessions(projectId, sidebarOrder);

      PRAGMA user_version = 8;
    `,
  },
  {
    id: "0009_remove_legacy_zmux_chat_projects",
    sql: `
      DELETE FROM sessions
      WHERE projectId IN (
        SELECT projectId
        FROM projects
        WHERE path LIKE '%/zmux/chats/%'
          AND (
            name GLOB 'Chat [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] *'
            OR name IN ('Browser', 'Plugins')
          )
      );

      DELETE FROM projects
      WHERE path LIKE '%/zmux/chats/%'
        AND (
          name GLOB 'Chat [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] *'
          OR name IN ('Browser', 'Plugins')
        );

      PRAGMA user_version = 9;
    `,
  },
];

/*
CDXC:GxserverStorage 2026-05-30-14:16:
`state.db` starts with an idempotent SQLite migration framework and only foundation tables. Project/session domain records, state import, and API query tables belong to later beads; this layer provides durable metadata and ID allocation plumbing without prebuilding those domains.

CDXC:GxserverDomainState 2026-05-30-17:30:
gxserver owns shared project/session metadata: stable P/G IDs, zmx names, lifecycle/provider state, pinned/favorite, custom agents/commands/order, previous-session history links, launch/runtime settings, completion/attention rules, and worktree/Git/project-board launch config.

CDXC:ProjectSidebarOwnership 2026-06-02-14:01:
Client-local pane, tab, and chrome layout belongs to the macOS app after the ownership split. Do not create a gxserver client-layout table or HTTP API; keeping layout out of gxserver prevents selected tab/pane state from becoming shared daemon state.

CDXC:PinnedSessions 2026-06-02-20:11:
Pinned session row order is shared project-session metadata, not current-window pane layout. Store the explicit sidebar order beside gxserver sessions so drag-to-reorder under a project survives presentation refreshes, restarts, and other clients.

CDXC:PreviousSessions 2026-06-04-20:21:
Previous Sessions should not preserve low-signal inactive placeholder rows created before gxserver owned history quality. The migration removes unpinned/unfavorited placeholder inactive rows and backfills retained inactive rows with updatedAt so history grouping never invents today's date for missing lastActiveAt.

CDXC:SessionTags 2026-06-05-12:30:
The expanded session tag feature is durable gxserver metadata. Store a nullable sessionTag column and backfill legacy favorites to `favorite` so older Favorite rows render and filter as the new Favorite tag without a separate compatibility table.

CDXC:SessionTags 2026-06-05-14:45:
Testing and Blocked expand the allowed durable sessionTag values. Existing databases may already have the old SQLite CHECK constraint, so migration 0006 rebuilds only the sessions table constraint instead of relying on runtime validation alone.

CDXC:SessionTags 2026-06-05-15:22:
In Progress and Type tags are durable user tags. Migration 0007 rebuilds the sessions table CHECK constraint again so already-upgraded databases can store `in-progress`, Bug, Feature, and Design.

CDXC:SessionTags 2026-06-05-19:12:
Type tags are limited to Research, Bug, Feature, and Design. Migration 0008 clears retired values and rebuilds the sessionTag CHECK constraint so already-upgraded databases cannot keep values that no longer appear in sidebar menus and filters.

CDXC:GxserverProjectPaths 2026-06-05-20:07:
Legacy macOS chat/plugin/browser projects imported from `~/zmux/chats` are transient workspace containers from before chats moved to `~/ghostex/chats`. Migration 0009 removes only those legacy quick-project rows so missing old chat directories cannot keep appearing as durable gxserver projects.
*/
export async function initializeGxserverStorage(paths: GxserverPaths): Promise<GxserverStorageInitResult> {
  await ensureGxserverStorageLayout(paths);
  const db = openGxserverDatabase(paths);
  try {
    const appliedMigrations = runGxserverMigrations(db, GxserverStorageMigrations);
    return {
      appliedMigrations,
      stateDbFile: paths.stateDbFile,
    };
  } finally {
    db.close();
  }
}

export async function readGxserverConfig(paths: GxserverPaths): Promise<GxserverConfig> {
  try {
    const parsed = JSON.parse(await readFile(paths.configFile, "utf8")) as Partial<GxserverConfig>;
    return mergeGxserverConfig(parsed);
  } catch (error) {
    if (isMissingFileError(error)) {
      return createDefaultGxserverConfig();
    }
    throw error;
  }
}

export async function writeGxserverConfig(paths: GxserverPaths, config: GxserverConfig): Promise<void> {
  await mkdir(paths.rootDir, { mode: 0o700, recursive: true });
  await writeFile(paths.configFile, `${JSON.stringify(mergeGxserverConfig(config), null, 2)}\n`, {
    mode: 0o600,
  });
}

export function createGxserverMigrationStatus(
  result: GxserverStorageInitResult,
  currentVersion = GxserverStorageMigrations.length,
  stateImports?: GxserverMigrationStatus["stateImports"],
): GxserverMigrationStatus {
  return {
    appliedMigrations: result.appliedMigrations,
    currentVersion,
    ...(stateImports ? { stateImports } : {}),
    stateDbFile: result.stateDbFile,
  };
}

export async function ensureGxserverStorageLayout(paths: GxserverPaths): Promise<void> {
  await Promise.all([
    mkdir(paths.authDir, { mode: 0o700, recursive: true }),
    mkdir(paths.logsDir, { recursive: true }),
    mkdir(paths.migrationsDir, { recursive: true }),
    mkdir(paths.runtimeDir, { recursive: true }),
    mkdir(paths.zmxDir, { recursive: true }),
  ]);
  await writeDefaultConfigIfMissing(paths);
}

export function openGxserverDatabase(paths: GxserverPaths): Database.Database {
  const db = new Database(paths.stateDbFile);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  return db;
}

export function runGxserverMigrations(
  db: Database.Database,
  migrations: readonly GxserverMigration[] = GxserverStorageMigrations,
): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      appliedAt TEXT NOT NULL
    );
  `);

  const applied: string[] = [];
  const selectMigration = db.prepare<[string], { id: string }>(
    "SELECT id FROM schema_migrations WHERE id = ?",
  );
  const recordMigration = db.prepare<[string, string]>(
    "INSERT INTO schema_migrations (id, appliedAt) VALUES (?, ?)",
  );

  const applyMigration = db.transaction((migration: GxserverMigration) => {
    db.exec(migration.sql);
    recordMigration.run(migration.id, new Date().toISOString());
  });

  for (const migration of migrations) {
    if (selectMigration.get(migration.id)) {
      continue;
    }
    applyMigration(migration);
    applied.push(migration.id);
  }

  return applied;
}

async function writeDefaultConfigIfMissing(paths: GxserverPaths): Promise<void> {
  const config = createDefaultGxserverConfig();
  try {
    await writeFile(paths.configFile, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!isExistingFileError(error)) {
      throw error;
    }
  }
}

/*
CDXC:GxserverApi 2026-05-30-14:26:
The local API is always a full loopback listener on 127.0.0.1:58744. The remote/Tailscale listener uses a separate port, 58745, and defaults off so remote exposure is an explicit configuration choice with a reduced permission set.

CDXC:GxserverApi 2026-05-30-23:34:
Config must not silently move the local API because runtime metadata, status checks, CLI callers, and native/sidebar clients use the fixed 127.0.0.1:58744 contract. Startup fails with a clear validation error when config.json attempts to override listeners.local.host or listeners.local.port, while remote listener host/port remain configurable.

CDXC:GxserverRustPort 2026-06-14-21:58:
The Rust-port compatibility harness may explicitly select a dev-only local port through GHOSTEX_GXSERVER_DEV_PORT. Treat that port as the listener default only for that process environment, keeping config.json overrides invalid and preserving 58744 as the product protocol default.
*/
export function createDefaultGxserverConfig(): GxserverConfig {
  const localPort = readGxserverLocalApiPort();
  return {
    cors: {
      allowedOrigins: [...DEFAULT_GXSERVER_CORS_ALLOWED_ORIGINS],
    },
    createdAt: new Date().toISOString(),
    listeners: {
      local: {
        enabled: true,
        host: GXSERVER_LOCAL_API_HOST,
        kind: "local",
        port: localPort,
      },
      remote: {
        ...createTailscaleRemoteListenerConfig({ enabled: false }),
      },
    },
    product: GXSERVER_PRODUCT,
  };
}

export function mergeGxserverConfig(config: Partial<GxserverConfig>): GxserverConfig {
  const defaults = createDefaultGxserverConfig();
  return {
    cors: {
      allowedOrigins: normalizeAllowedCorsOrigins(config.cors?.allowedOrigins, defaults.cors.allowedOrigins),
    },
    createdAt: typeof config.createdAt === "string" ? config.createdAt : defaults.createdAt,
    listeners: {
      local: normalizeLocalListenerConfig(config.listeners?.local, defaults.listeners.local),
      remote: {
        ...normalizeRemoteListenerConfig({
          ...defaults.listeners.remote,
          ...(isPartialListenerConfig(config.listeners?.remote) ? config.listeners.remote : {}),
        }),
      },
    },
    product: GXSERVER_PRODUCT,
  };
}

function normalizeLocalListenerConfig(
  config: unknown,
  defaults: GxserverListenerConfig,
): GxserverListenerConfig {
  if (isPartialListenerConfig(config)) {
    if ("host" in config && config.host !== undefined && config.host !== defaults.host) {
      throw new GxserverLocalListenerConfigError(
        `Local gxserver listener host is fixed at ${defaults.host}; remove listeners.local.host from config.json.`,
      );
    }
    if ("port" in config && config.port !== undefined && config.port !== defaults.port) {
      throw new GxserverLocalListenerConfigError(
        `Local gxserver listener port is fixed at ${defaults.port}; remove listeners.local.port from config.json.`,
      );
    }
  }
  return {
    ...defaults,
    enabled: true,
    kind: "local",
  };
}

function isPartialListenerConfig(value: unknown): value is Partial<GxserverListenerConfig> {
  return typeof value === "object" && value !== null;
}

function normalizeAllowedCorsOrigins(value: unknown, defaults: readonly string[]): string[] {
  const origins = new Set(defaults);
  if (Array.isArray(value)) {
    for (const origin of value) {
      if (typeof origin === "string" && origin.trim()) {
        origins.add(origin.trim());
      }
    }
  }
  return [...origins].sort();
}

function isExistingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
