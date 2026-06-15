use std::fs;

use anyhow::{Context, Result};
use rusqlite::Connection;

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

/*
CDXC:GxserverStorage 2026-06-14-20:37:
SQLite remains TypeScript-compatible during the Rust port. Open every connection with foreign_keys=ON and journal_mode=WAL, then apply migration IDs 0001 through 0009 without inventing a parallel schema.
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
            legacy_macos_state: LegacyMacosStateImportStatus {
                completed_at: chrono::Utc::now()
                    .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                id: "legacy_macos_sidebar_state_v1".to_string(),
                logs_imported: LegacyMacosLogsImportStatus {
                    files_read: 0,
                    malformed_line_count: 0,
                    migrated_line_count: 0,
                },
                projects_imported: 0,
                sessions_imported: 0,
                skipped_reason: "noLegacyState".to_string(),
                source_files_read: Vec::new(),
                status: "skipped".to_string(),
            },
        }),
    }
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
    fn initializes_sqlite_with_current_migrations() {
        let temp = tempfile::tempdir().expect("tempdir");
        let paths = get_gxserver_paths(Some(temp.path().to_path_buf()));
        let result = initialize_gxserver_storage(&paths).expect("storage init");
        assert_eq!(
            result.applied_migrations,
            GXSERVER_MIGRATION_IDS
                .iter()
                .map(|id| (*id).to_string())
                .collect::<Vec<_>>()
        );

        let db = open_gxserver_database(&paths).expect("open db");
        let user_version: i64 = db
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user_version");
        let foreign_keys: i64 = db
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .expect("foreign_keys");
        assert_eq!(user_version, 9);
        assert_eq!(foreign_keys, 1);
    }
}
