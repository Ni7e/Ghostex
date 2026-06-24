use std::{fs, path::Path};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension};

use crate::{
    config::write_default_config_if_missing,
    constants::GXSERVER_MIGRATION_IDS,
    paths::GxserverPaths,
    protocol::{
        LegacyMacosLogsImportStatus, LegacyMacosStateImportStatus, MigrationStateImports,
        MigrationStatus,
    },
};

pub struct Migration {
    pub id: &'static str,
    pub sql: &'static str,
}

#[derive(Clone, Debug)]
pub struct StorageInitResult {
    pub applied_migrations: Vec<String>,
    pub state_db_file: String,
}

const LEGACY_MACOS_STATE_IMPORT_ID: &str = "legacy_macos_sidebar_state_v1";
const LEGACY_IMPORT_METADATA_KEY: &str = "migration.legacy_macos_sidebar_state_v1";

/*
CDXC:GxserverStorage 2026-06-14-20:37:
SQLite remains TypeScript-compatible during the Rust port. Open every connection with foreign_keys=ON and journal_mode=WAL, then apply migration IDs 0001 through 0013 without inventing a parallel schema.

CDXC:GxserverAppUserData 2026-06-24-13:30:
Scratch Pad and Pinned Prompts are shared user-data surfaces, not GPUI-local modal state. Store their content in gxserver SQLite behind explicit product-data RPCs so macOS and GPUI hydrate the same React contract without logging prompt or note bodies.
*/
pub fn initialize_gxserver_storage(paths: &GxserverPaths) -> Result<StorageInitResult> {
    ensure_gxserver_storage_layout(paths)?;
    let mut db = open_gxserver_database(paths)?;
    let applied_migrations = run_gxserver_migrations(&mut db)?;
    Ok(StorageInitResult {
        applied_migrations,
        state_db_file: paths.state_db_file.to_string_lossy().to_string(),
    })
}

pub fn create_gxserver_migration_status(result: &StorageInitResult) -> MigrationStatus {
    MigrationStatus {
        applied_migrations: result.applied_migrations.clone(),
        current_version: GXSERVER_MIGRATION_IDS.len(),
        state_db_file: result.state_db_file.clone(),
        state_imports: Some(MigrationStateImports {
            legacy_macos_state: read_existing_legacy_import_status(&result.state_db_file)
                .unwrap_or_else(default_no_legacy_state_import_status),
        }),
    }
}

fn default_no_legacy_state_import_status() -> LegacyMacosStateImportStatus {
    LegacyMacosStateImportStatus {
        completed_at: Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
        id: LEGACY_MACOS_STATE_IMPORT_ID.to_string(),
        logs_imported: Some(LegacyMacosLogsImportStatus {
            files_read: 0,
            malformed_line_count: 0,
            migrated_line_count: 0,
        }),
        projects_imported: Some(0),
        sessions_imported: Some(0),
        skipped_reason: Some("noLegacyState".to_string()),
        source_files_read: Some(Vec::new()),
        status: "skipped".to_string(),
    }
}

/*
CDXC:GxserverStorage 2026-06-22-05:10:
Existing TypeScript-created state.db files can already contain the legacy macOS import marker in metadata. Rust startup must surface that durable marker as TypeScript does on later launches: completed markers report `skipped` with `alreadyCompleted`, while missing or non-completed markers continue through the no-legacy startup status path.
*/
fn read_existing_legacy_import_status(state_db_file: &str) -> Option<LegacyMacosStateImportStatus> {
    let db = Connection::open(Path::new(state_db_file)).ok()?;
    let value: String = db
        .query_row(
            "SELECT value FROM metadata WHERE key = ?1",
            [LEGACY_IMPORT_METADATA_KEY],
            |row| row.get(0),
        )
        .optional()
        .ok()??;
    let mut status: LegacyMacosStateImportStatus = serde_json::from_str(&value).ok()?;
    if status.status != "completed" {
        return None;
    }
    status.id = LEGACY_MACOS_STATE_IMPORT_ID.to_string();
    status.status = "skipped".to_string();
    status.skipped_reason = Some("alreadyCompleted".to_string());
    Some(status)
}

pub fn ensure_gxserver_storage_layout(paths: &GxserverPaths) -> Result<()> {
    fs::create_dir_all(&paths.auth_dir).with_context(|| "create auth directory")?;
    set_dir_mode_0700(&paths.auth_dir)?;
    fs::create_dir_all(&paths.logs_dir).with_context(|| "create logs directory")?;
    fs::create_dir_all(&paths.migrations_dir).with_context(|| "create migrations directory")?;
    fs::create_dir_all(&paths.runtime_dir).with_context(|| "create runtime directory")?;
    fs::create_dir_all(&paths.zmx_dir).with_context(|| "create zmx directory")?;
    write_default_config_if_missing(paths)?;
    Ok(())
}

pub fn open_gxserver_database(paths: &GxserverPaths) -> Result<Connection> {
    let db = Connection::open(&paths.state_db_file)
        .with_context(|| format!("open {}", paths.state_db_file.display()))?;
    db.pragma_update(None, "foreign_keys", "ON")?;
    db.pragma_update(None, "journal_mode", "WAL")?;
    Ok(db)
}

pub fn run_gxserver_migrations(db: &mut Connection) -> Result<Vec<String>> {
    db.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id TEXT PRIMARY KEY,
          appliedAt TEXT NOT NULL
        );
        "#,
    )?;

    let mut applied = Vec::new();
    for migration in GXSERVER_STORAGE_MIGRATIONS {
        let exists: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE id = ?1)",
            [migration.id],
            |row| row.get(0),
        )?;
        if exists {
            continue;
        }
        let transaction = db.transaction()?;
        transaction.execute_batch(migration.sql)?;
        transaction.execute(
            "INSERT INTO schema_migrations (id, appliedAt) VALUES (?1, ?2)",
            (
                migration.id,
                chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            ),
        )?;
        transaction.commit()?;
        applied.push(migration.id.to_string());
    }
    Ok(applied)
}

macro_rules! rebuild_sessions_with_session_tag {
    ($version:literal) => {
        concat!(
            r#"
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
        kind TEXT NOT NULL CHECK (kind IN ('terminal', 'agent', 't3')),
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

      PRAGMA user_version = "#,
            $version,
            r#";
    "#
        )
    };
}

pub const GXSERVER_STORAGE_MIGRATIONS: &[Migration] = &[
    Migration {
        id: "0001_foundation",
        sql: r#"
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
    "#,
    },
    Migration {
        id: "0002_domain_state",
        sql: r#"
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
        kind TEXT NOT NULL CHECK (kind IN ('terminal', 'agent', 't3')),
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
    "#,
    },
    Migration {
        id: "0003_session_sidebar_order",
        sql: r#"
      ALTER TABLE sessions ADD COLUMN sidebarOrder REAL;

      CREATE INDEX IF NOT EXISTS idx_sessions_project_sidebar_order
        ON sessions(projectId, sidebarOrder);

      PRAGMA user_version = 3;
    "#,
    },
    Migration {
        id: "0004_previous_session_history_quality",
        sql: r#"
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
    "#,
    },
    Migration {
        id: "0005_session_tags",
        sql: r#"
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
    "#,
    },
    Migration {
        id: "0006_expand_session_tags",
        sql: rebuild_sessions_with_session_tag!("6"),
    },
    Migration {
        id: "0007_expand_session_tags_in_progress_and_type",
        sql: rebuild_sessions_with_session_tag!("7"),
    },
    Migration {
        id: "0008_remove_retired_session_type_tags",
        sql: rebuild_sessions_with_session_tag!("8"),
    },
    Migration {
        id: "0009_remove_legacy_zmux_chat_projects",
        sql: r#"
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
    "#,
    },
    Migration {
        id: "0010_portless_persistence_model",
        sql: r#"
      CREATE TABLE IF NOT EXISTS portless_domain_identities (
        identityId INTEGER PRIMARY KEY,
        identityScope TEXT NOT NULL CHECK (identityScope IN ('project', 'worktree')),
        projectId TEXT NOT NULL,
        worktreeKey TEXT,
        projectSlug TEXT,
        worktreeSlug TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        CHECK (
          (
            identityScope = 'project'
            AND worktreeKey IS NULL
            AND projectSlug IS NOT NULL
            AND worktreeSlug IS NULL
          )
          OR (
            identityScope = 'worktree'
            AND worktreeKey IS NOT NULL
            AND projectSlug IS NULL
            AND worktreeSlug IS NOT NULL
          )
        ),
        FOREIGN KEY (projectId) REFERENCES projects(projectId) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_portless_domain_project_identity
        ON portless_domain_identities(projectId)
        WHERE identityScope = 'project';

      CREATE UNIQUE INDEX IF NOT EXISTS idx_portless_domain_worktree_identity
        ON portless_domain_identities(projectId, worktreeKey)
        WHERE identityScope = 'worktree';

      CREATE UNIQUE INDEX IF NOT EXISTS idx_portless_domain_project_slug
        ON portless_domain_identities(projectSlug)
        WHERE identityScope = 'project';

      CREATE UNIQUE INDEX IF NOT EXISTS idx_portless_domain_worktree_slug
        ON portless_domain_identities(projectId, worktreeSlug)
        WHERE identityScope = 'worktree';

      CREATE TABLE IF NOT EXISTS portless_state (
        stateId TEXT PRIMARY KEY CHECK (stateId = 'global'),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        protocol TEXT NOT NULL CHECK (protocol IN ('https', 'http')),
        setupOwnership TEXT NOT NULL CHECK (setupOwnership IN ('unknown', 'missing', 'ghostex', 'standalone')),
        setupStatus TEXT NOT NULL CHECK (setupStatus IN ('unknown', 'needed', 'active', 'failed', 'disabled', 'postponed')),
        runtimeStatus TEXT NOT NULL CHECK (runtimeStatus IN ('unknown', 'inactive', 'active', 'failed')),
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      PRAGMA user_version = 10;
    "#,
    },
    Migration {
        id: "0011_t3_session_kind",
        /*
        CDXC:T3Code 2026-06-23-06:19:
        Embedded T3 panes now have gxserver-owned session identity. Rebuild the
        sessions table so existing state.db files accept kind=t3 rows without
        weakening the rest of the TypeScript-compatible session constraints.
        */
        sql: rebuild_sessions_with_session_tag!("11"),
    },
    Migration {
        id: "0012_recent_projects",
        /*
        CDXC:GPUIRecentProjects 2026-06-24-12:27:
        Recent Projects is a first-class gxserver project-domain state. Store
        explicit parked state and closed time on the project row so GPUI can
        hydrate a real path-bearing recent list without deriving rows from
        labels, inactive sessions, shell titles, command text, or filesystem
        guesses.
        */
        sql: r#"
      ALTER TABLE projects ADD COLUMN isRecentProject INTEGER NOT NULL DEFAULT 0 CHECK (isRecentProject IN (0, 1));
      ALTER TABLE projects ADD COLUMN recentClosedAt TEXT;

      CREATE INDEX IF NOT EXISTS idx_projects_recent_closed
        ON projects(isRecentProject, recentClosedAt, updatedAt);

      PRAGMA user_version = 12;
    "#,
    },
    Migration {
        id: "0013_app_user_data",
        /*
        CDXC:GxserverAppUserData 2026-06-24-13:30:
        Scratch Pad and Pinned Prompts need a global gxserver-owned source of
        truth for reused React app-modal surfaces. Keep their user-authored
        bodies out of project/session metadata, presentation deltas, and logs by
        storing only the explicit app-user-data rows read by the product-data
        RPCs.
        */
        sql: r#"
      CREATE TABLE IF NOT EXISTS app_user_data (
        itemKind TEXT NOT NULL CHECK (itemKind IN ('scratchPad', 'pinnedPrompt')),
        itemId TEXT NOT NULL,
        content TEXT NOT NULL,
        title TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        PRIMARY KEY (itemKind, itemId),
        CHECK (itemKind <> 'scratchPad' OR itemId = 'global'),
        CHECK (itemKind <> 'pinnedPrompt' OR content <> '')
      );

      CREATE INDEX IF NOT EXISTS idx_app_user_data_kind_updated
        ON app_user_data(itemKind, updatedAt, itemId);

      PRAGMA user_version = 13;
    "#,
    },
];

#[cfg(unix)]
fn set_dir_mode_0700(path: &std::path::Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_dir_mode_0700(_path: &std::path::Path) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::get_gxserver_paths;

    #[test]
    fn initializes_sqlite_with_current_migrations_and_schema_layout() {
        let temp = tempfile::tempdir().expect("tempdir");
        let paths = get_gxserver_paths(Some(temp.path().to_path_buf()));
        let result = initialize_gxserver_storage(&paths).expect("storage init");
        let second = initialize_gxserver_storage(&paths).expect("second storage init");
        assert_eq!(
            result.applied_migrations,
            GXSERVER_MIGRATION_IDS
                .iter()
                .map(|id| (*id).to_string())
                .collect::<Vec<_>>()
        );
        assert_eq!(second.applied_migrations, Vec::<String>::new());
        assert_eq!(
            result.state_db_file,
            paths.state_db_file.to_string_lossy().to_string()
        );

        let db = open_gxserver_database(&paths).expect("open db");
        let user_version: i64 = db
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user_version");
        let foreign_keys: i64 = db
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .expect("foreign_keys");
        let journal_mode: String = db
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .expect("journal_mode");
        assert_eq!(user_version, 13);
        assert_eq!(foreign_keys, 1);
        assert_eq!(journal_mode, "wal");
        assert_eq!(schema_migration_count(&db), 13);
        assert_eq!(
            explicit_index_names(&db),
            vec![
                "idx_app_user_data_kind_updated".to_string(),
                "idx_id_allocations_kind_parent".to_string(),
                "idx_portless_domain_project_identity".to_string(),
                "idx_portless_domain_project_slug".to_string(),
                "idx_portless_domain_worktree_identity".to_string(),
                "idx_portless_domain_worktree_slug".to_string(),
                "idx_projects_recent_closed".to_string(),
                "idx_sessions_project_sidebar_order".to_string(),
                "idx_sessions_project_updated".to_string(),
            ]
        );
        assert_eq!(
            table_columns(&db, "projects"),
            vec![
                "projectId",
                "name",
                "path",
                "identityIconJson",
                "isPinned",
                "isFavorite",
                "defaultCommand",
                "worktreeJson",
                "customAgentsJson",
                "customAgentOrderJson",
                "customCommandsJson",
                "customCommandOrderJson",
                "deletedDefaultCommandIdsJson",
                "launchSettingsJson",
                "runtimeSettingsJson",
                "completionRulesJson",
                "attentionRulesJson",
                "notificationRulesJson",
                "gitConfigJson",
                "projectBoardConfigJson",
                "previousSessionHistoryJson",
                "createdAt",
                "updatedAt",
                "isRecentProject",
                "recentClosedAt",
            ]
        );
        assert_eq!(
            table_columns(&db, "sessions"),
            vec![
                "projectId",
                "sessionId",
                "kind",
                "title",
                "lifecycleState",
                "providerStateJson",
                "zmxName",
                "cwd",
                "agentId",
                "commandId",
                "isPinned",
                "isFavorite",
                "restoredFromSessionId",
                "restoredFromHistoryId",
                "launchSettingsJson",
                "runtimeSettingsJson",
                "completionRulesJson",
                "attentionRulesJson",
                "notificationRulesJson",
                "worktreeJson",
                "createdAt",
                "updatedAt",
                "lastActiveAt",
                "sidebarOrder",
                "sessionTag",
            ]
        );
        assert_eq!(
            table_columns(&db, "portless_domain_identities"),
            vec![
                "identityId",
                "identityScope",
                "projectId",
                "worktreeKey",
                "projectSlug",
                "worktreeSlug",
                "createdAt",
                "updatedAt",
            ]
        );
        assert_eq!(
            table_columns(&db, "portless_state"),
            vec![
                "stateId",
                "enabled",
                "protocol",
                "setupOwnership",
                "setupStatus",
                "runtimeStatus",
                "createdAt",
                "updatedAt",
            ]
        );
        let foreign_key: (String, String, String, String) = db
            .query_row("PRAGMA foreign_key_list(sessions)", [], |row| {
                Ok((row.get(2)?, row.get(3)?, row.get(4)?, row.get(6)?))
            })
            .expect("sessions foreign key");
        assert_eq!(
            foreign_key,
            (
                "projects".to_string(),
                "projectId".to_string(),
                "projectId".to_string(),
                "CASCADE".to_string()
            )
        );
    }

    #[test]
    fn existing_state_db_rows_survive_rust_storage_initialization() {
        let temp = tempfile::tempdir().expect("tempdir");
        let paths = get_gxserver_paths(Some(temp.path().to_path_buf()));
        initialize_gxserver_storage(&paths).expect("storage init");

        {
            let db = open_gxserver_database(&paths).expect("open db");
            insert_project(&db, "P1ts", "TypeScript Project", "/tmp/typescript-project");
            insert_session(&db, "P1ts", "G1ts", "TypeScript Session");
        }

        let result = initialize_gxserver_storage(&paths).expect("storage re-init");
        assert_eq!(result.applied_migrations, Vec::<String>::new());

        let db = open_gxserver_database(&paths).expect("open db");
        let project_name: String = db
            .query_row(
                "SELECT name FROM projects WHERE projectId = ?1",
                ["P1ts"],
                |row| row.get(0),
            )
            .expect("project row");
        let session_title: String = db
            .query_row(
                "SELECT title FROM sessions WHERE projectId = ?1 AND sessionId = ?2",
                ("P1ts", "G1ts"),
                |row| row.get(0),
            )
            .expect("session row");
        assert_eq!(project_name, "TypeScript Project");
        assert_eq!(session_title, "TypeScript Session");
    }

    #[test]
    fn migration_status_reads_typescript_legacy_import_metadata_from_state_db() {
        let temp = tempfile::tempdir().expect("tempdir");
        let paths = get_gxserver_paths(Some(temp.path().to_path_buf()));
        let result = initialize_gxserver_storage(&paths).expect("storage init");
        {
            let db = open_gxserver_database(&paths).expect("open db");
            db.execute(
                r#"
                INSERT INTO metadata (key, value, updatedAt)
                VALUES (?1, ?2, ?3)
                "#,
                rusqlite::params![
                    LEGACY_IMPORT_METADATA_KEY,
                    serde_json::json!({
                        "completedAt": "2026-05-30T17:27:00.000Z",
                        "id": LEGACY_MACOS_STATE_IMPORT_ID,
                        "logsImported": {
                            "filesRead": 2,
                            "malformedLineCount": 1,
                            "migratedLineCount": 6,
                        },
                        "projectsImported": 3,
                        "sessionsImported": 4,
                        "sourceFilesRead": ["native-sidebar-projects.json"],
                        "status": "completed",
                    })
                    .to_string(),
                    "2026-05-30T17:27:00.000Z",
                ],
            )
            .expect("insert legacy import metadata");
        }

        let status = create_gxserver_migration_status(&result);
        let legacy_status = status
            .state_imports
            .expect("state imports")
            .legacy_macos_state;
        assert_eq!(
            legacy_status.completed_at.as_deref(),
            Some("2026-05-30T17:27:00.000Z")
        );
        assert_eq!(legacy_status.id, LEGACY_MACOS_STATE_IMPORT_ID);
        assert_eq!(legacy_status.projects_imported, Some(3));
        assert_eq!(legacy_status.sessions_imported, Some(4));
        assert_eq!(
            legacy_status
                .logs_imported
                .as_ref()
                .map(|logs| logs.migrated_line_count),
            Some(6)
        );
        assert_eq!(
            legacy_status.source_files_read,
            Some(vec!["native-sidebar-projects.json".to_string()])
        );
        assert_eq!(
            legacy_status.skipped_reason.as_deref(),
            Some("alreadyCompleted")
        );
        assert_eq!(legacy_status.status, "skipped");
    }

    #[test]
    fn previous_session_quality_migration_matches_typescript_cleanup() {
        let temp = tempfile::tempdir().expect("tempdir");
        let paths = get_gxserver_paths(Some(temp.path().to_path_buf()));
        ensure_gxserver_storage_layout(&paths).expect("storage layout");
        let mut db = open_gxserver_database(&paths).expect("open db");
        apply_migration_range(&mut db, 0..3);
        insert_project(&db, "P1cle", "Ghostex", "/repo/ghostex");

        /*
        CDXC:GxserverStorage 2026-06-22-05:10:
        Rust storage migrations must preserve TypeScript-created state.db behavior for existing users. Migration 0004 removes only low-signal inactive placeholder rows and backfills retained inactive rows with updatedAt, matching the TypeScript cleanup semantics.
        */
        insert_pre_tag_session(&db, "P1cle", "G1noi", "Terminal Session", "stopped", 0);
        insert_pre_tag_session(&db, "P1cle", "G2kee", "Useful restore row", "stopped", 0);
        insert_pre_tag_session(&db, "P1cle", "G3fav", "Codex Session", "stopped", 1);
        insert_pre_tag_session(&db, "P1cle", "G4unk", "Unknown stale row", "unknown", 0);
        insert_pre_tag_session(&db, "P1cle", "G5run", "Running row", "running", 0);

        run_gxserver_migrations(&mut db).expect("remaining migrations");

        let rows = query_session_activity(&db);
        assert_eq!(
            rows.iter()
                .map(|(session_id, _, _)| session_id.as_str())
                .collect::<Vec<_>>(),
            vec!["G2kee", "G3fav", "G5run"]
        );
        assert_eq!(
            rows.iter()
                .find(|(session_id, _, _)| session_id == "G2kee")
                .and_then(|(_, _, last_active_at)| last_active_at.as_deref()),
            Some("2026-06-04T16:21:00.000Z")
        );
        assert_eq!(
            rows.iter()
                .find(|(session_id, _, _)| session_id == "G3fav")
                .and_then(|(_, _, last_active_at)| last_active_at.as_deref()),
            Some("2026-06-04T16:21:00.000Z")
        );
        assert_eq!(
            rows.iter()
                .find(|(session_id, _, _)| session_id == "G5run")
                .and_then(|(_, _, last_active_at)| last_active_at.as_deref()),
            None
        );
    }

    #[test]
    fn session_tag_expansion_migrations_match_typescript_allowed_values() {
        let temp = tempfile::tempdir().expect("tempdir");
        let paths = get_gxserver_paths(Some(temp.path().to_path_buf()));
        ensure_gxserver_storage_layout(&paths).expect("storage layout");
        let mut db = open_gxserver_database(&paths).expect("open db");
        apply_migration_range(&mut db, 0..5);
        insert_project(&db, "P1tag", "Ghostex", "/repo/ghostex");
        insert_session(&db, "P1tag", "G1old", "Old allowed tag");
        update_session_tag(&db, "G1old", Some("todo"));

        /*
        CDXC:SessionTags 2026-06-22-05:58:
        Rust storage migrations must keep the TypeScript sessionTag schema contract: supported tag values survive each constraint rebuild, legacy/retired values are cleared by migration 0008, and existing state.db files can continue through the expanded tag model.
        */
        apply_migration_range(&mut db, 5..6);
        update_session_tag(&db, "G1old", Some("testing"));
        insert_session(&db, "P1tag", "G2new", "Blocked tag");
        update_session_tag(&db, "G2new", Some("blocked"));

        apply_migration_range(&mut db, 6..7);
        insert_session(&db, "P1tag", "G3wip", "In Progress tag");
        update_session_tag(&db, "G3wip", Some("in-progress"));
        insert_session(&db, "P1tag", "G4typ", "Bug tag");
        update_session_tag(&db, "G4typ", Some("bug"));
        insert_session(&db, "P1tag", "G5des", "Design tag");
        update_session_tag(&db, "G5des", Some("design"));

        db.execute_batch("PRAGMA ignore_check_constraints = ON;")
            .expect("disable tag check");
        update_session_tag(&db, "G4typ", Some("retired-type"));
        db.execute_batch("PRAGMA ignore_check_constraints = OFF;")
            .expect("restore tag check");
        apply_migration_range(&mut db, 7..8);

        let rows = query_session_tags(&db);
        assert_eq!(
            rows,
            vec![
                ("G1old".to_string(), Some("testing".to_string())),
                ("G2new".to_string(), Some("blocked".to_string())),
                ("G3wip".to_string(), Some("in-progress".to_string())),
                ("G4typ".to_string(), None),
                ("G5des".to_string(), Some("design".to_string())),
            ]
        );
    }

    #[test]
    fn legacy_zmux_chat_project_migration_removes_only_typescript_legacy_rows() {
        let temp = tempfile::tempdir().expect("tempdir");
        let paths = get_gxserver_paths(Some(temp.path().to_path_buf()));
        ensure_gxserver_storage_layout(&paths).expect("storage layout");
        let mut db = open_gxserver_database(&paths).expect("open db");
        apply_migration_range(&mut db, 0..8);

        let old_chat_path = temp
            .path()
            .join("zmux/chats/2026-05-08-140732018-chat")
            .to_string_lossy()
            .to_string();
        let old_plugins_path = temp
            .path()
            .join("zmux/chats/2026-05-08-110833862-plugins")
            .to_string_lossy()
            .to_string();
        let current_chat_path = temp
            .path()
            .join("ghostex/chats/2026-06-05-200700000-chat")
            .to_string_lossy()
            .to_string();
        let repo_path = temp
            .path()
            .join("dev/zmux/chats/repo")
            .to_string_lossy()
            .to_string();

        /*
        CDXC:GxserverStorage 2026-06-22-05:10:
        Migration 0009 is intentionally narrow for TypeScript-created state.db compatibility: delete only legacy `~/zmux/chats` Chat/Browser/Plugins quick-project rows, leaving current `~/ghostex/chats` projects and normal repositories whose paths happen to include `/zmux/chats/`.
        */
        insert_project(&db, "P4rpp", "Chat 2026-05-08 14:07", &old_chat_path);
        insert_session(&db, "P4rpp", "G1old", "Terminal Session");
        insert_project(&db, "P5rpk", "Plugins", &old_plugins_path);
        insert_project(&db, "P6new", "Chat 2026-06-05 20:07", &current_chat_path);
        insert_project(&db, "P7rep", "Repo", &repo_path);

        run_gxserver_migrations(&mut db).expect("remaining migrations");

        let projects = query_project_names_and_paths(&db);
        assert_eq!(
            projects,
            vec![
                ("Chat 2026-06-05 20:07".to_string(), current_chat_path),
                ("Repo".to_string(), repo_path),
            ]
        );
        let old_session_count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM sessions WHERE projectId = ?1",
                ["P4rpp"],
                |row| row.get(0),
            )
            .expect("old session count");
        assert_eq!(old_session_count, 0);
    }

    #[test]
    fn migration_status_can_serialize_typescript_not_run_shape() {
        let status = MigrationStatus {
            applied_migrations: Vec::new(),
            current_version: GXSERVER_MIGRATION_IDS.len(),
            state_db_file: "/tmp/state.db".to_string(),
            state_imports: Some(MigrationStateImports {
                legacy_macos_state: LegacyMacosStateImportStatus {
                    completed_at: None,
                    id: "legacy_macos_sidebar_state_v1".to_string(),
                    logs_imported: None,
                    projects_imported: None,
                    sessions_imported: None,
                    skipped_reason: None,
                    source_files_read: None,
                    status: "notRun".to_string(),
                },
            }),
        };

        let value = serde_json::to_value(status).expect("migration status json");
        assert_eq!(
            value["stateImports"]["legacyMacosState"],
            serde_json::json!({
                "id": "legacy_macos_sidebar_state_v1",
                "status": "notRun",
            })
        );
    }

    #[cfg(unix)]
    #[test]
    fn storage_initialization_creates_auth_and_config_with_strict_modes() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().expect("tempdir");
        let paths = get_gxserver_paths(Some(temp.path().to_path_buf()));

        initialize_gxserver_storage(&paths).expect("storage init");

        assert_eq!(
            fs::metadata(&paths.auth_dir)
                .expect("auth dir metadata")
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(&paths.config_file)
                .expect("config metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }

    fn apply_migration_range(db: &mut Connection, range: std::ops::Range<usize>) {
        db.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS schema_migrations (
              id TEXT PRIMARY KEY,
              appliedAt TEXT NOT NULL
            );
            "#,
        )
        .expect("create schema_migrations");

        for migration in &GXSERVER_STORAGE_MIGRATIONS[range] {
            let transaction = db.transaction().expect("migration transaction");
            transaction
                .execute_batch(migration.sql)
                .expect("migration sql");
            transaction
                .execute(
                    "INSERT INTO schema_migrations (id, appliedAt) VALUES (?1, ?2)",
                    (migration.id, "2026-06-22T01:10:00.000Z"),
                )
                .expect("record migration");
            transaction.commit().expect("commit migration");
        }
    }

    fn schema_migration_count(db: &Connection) -> i64 {
        db.query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .expect("schema migration count")
    }

    fn table_columns(db: &Connection, table: &str) -> Vec<String> {
        let mut statement = db
            .prepare(&format!("PRAGMA table_info({table})"))
            .expect("table info");
        statement
            .query_map([], |row| row.get::<_, String>("name"))
            .expect("table columns")
            .collect::<std::result::Result<Vec<_>, _>>()
            .expect("table columns rows")
    }

    fn explicit_index_names(db: &Connection) -> Vec<String> {
        let mut statement = db
            .prepare(
                r#"
                SELECT name
                FROM sqlite_master
                WHERE type = 'index'
                  AND name NOT LIKE 'sqlite_autoindex_%'
                ORDER BY name
                "#,
            )
            .expect("index names");
        statement
            .query_map([], |row| row.get::<_, String>(0))
            .expect("index rows")
            .collect::<std::result::Result<Vec<_>, _>>()
            .expect("index row values")
    }

    fn insert_project(db: &Connection, project_id: &str, name: &str, path: &str) {
        db.execute(
            r#"
            INSERT INTO projects (projectId, name, path, createdAt, updatedAt)
            VALUES (?1, ?2, ?3, ?4, ?4)
            "#,
            rusqlite::params![project_id, name, path, "2026-06-04T16:21:00.000Z"],
        )
        .expect("insert project");
    }

    fn insert_session(db: &Connection, project_id: &str, session_id: &str, title: &str) {
        db.execute(
            r#"
            INSERT INTO sessions (
              projectId, sessionId, kind, title, lifecycleState, providerStateJson,
              zmxName, createdAt, updatedAt
            )
            VALUES (?1, ?2, 'terminal', ?3, 'stopped', '{}', ?4, ?5, ?5)
            "#,
            rusqlite::params![
                project_id,
                session_id,
                title,
                format!("S90-{project_id}-{session_id}"),
                "2026-06-04T16:21:00.000Z",
            ],
        )
        .expect("insert session");
    }

    fn insert_pre_tag_session(
        db: &Connection,
        project_id: &str,
        session_id: &str,
        title: &str,
        lifecycle_state: &str,
        is_favorite: i64,
    ) {
        db.execute(
            r#"
            INSERT INTO sessions (
              projectId,
              sessionId,
              kind,
              title,
              lifecycleState,
              providerStateJson,
              zmxName,
              isPinned,
              isFavorite,
              launchSettingsJson,
              runtimeSettingsJson,
              completionRulesJson,
              attentionRulesJson,
              notificationRulesJson,
              worktreeJson,
              createdAt,
              updatedAt
            )
            VALUES (
              ?1,
              ?2,
              'terminal',
              ?3,
              ?4,
              '{}',
              ?5,
              0,
              ?6,
              '{}',
              '{}',
              '{}',
              '{}',
              '{}',
              '{}',
              ?7,
              ?7
            )
            "#,
            rusqlite::params![
                project_id,
                session_id,
                title,
                lifecycle_state,
                format!("S90-{project_id}-{session_id}"),
                is_favorite,
                "2026-06-04T16:21:00.000Z",
            ],
        )
        .expect("insert pre-tag session");
    }

    fn query_session_activity(db: &Connection) -> Vec<(String, String, Option<String>)> {
        let mut statement = db
            .prepare(
                "SELECT sessionId, lifecycleState, lastActiveAt FROM sessions ORDER BY sessionId",
            )
            .expect("session activity statement");
        statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .expect("session activity rows")
            .collect::<std::result::Result<Vec<_>, _>>()
            .expect("session activity row values")
    }

    fn update_session_tag(db: &Connection, session_id: &str, session_tag: Option<&str>) {
        db.execute(
            "UPDATE sessions SET sessionTag = ?1 WHERE sessionId = ?2",
            rusqlite::params![session_tag, session_id],
        )
        .expect("update session tag");
    }

    fn query_session_tags(db: &Connection) -> Vec<(String, Option<String>)> {
        let mut statement = db
            .prepare("SELECT sessionId, sessionTag FROM sessions ORDER BY sessionId")
            .expect("session tag statement");
        statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("session tag rows")
            .collect::<std::result::Result<Vec<_>, _>>()
            .expect("session tag row values")
    }

    fn query_project_names_and_paths(db: &Connection) -> Vec<(String, String)> {
        let mut statement = db
            .prepare("SELECT name, path FROM projects ORDER BY projectId")
            .expect("project rows statement");
        statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("project rows")
            .collect::<std::result::Result<Vec<_>, _>>()
            .expect("project row values")
    }
}
