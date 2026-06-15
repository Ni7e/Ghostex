use std::{collections::HashSet, env, fmt, path::Path};

use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Map, Value};

use crate::ids::{
    create_global_session_ref, create_project_id, create_session_id, create_zmx_session_name,
    is_gxserver_project_id, is_gxserver_session_id,
};

const JSON_LIMIT_CHARS: usize = 1_000_000;
const JSON_MAX_DEPTH: usize = 10;
const MAX_ID_GENERATION_ATTEMPTS: usize = 1024;

type DomainResult<T> = std::result::Result<T, DomainStateError>;

#[derive(Debug, Clone)]
pub struct DomainStateError {
    pub code: &'static str,
    pub message: String,
}

impl DomainStateError {
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self {
            code: "badRequest",
            message: message.into(),
        }
    }

    pub fn corrupt_state(message: impl Into<String>) -> Self {
        Self {
            code: "corruptState",
            message: message.into(),
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self {
            code: "notFound",
            message: message.into(),
        }
    }
}

impl fmt::Display for DomainStateError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.message.fmt(formatter)
    }
}

impl std::error::Error for DomainStateError {}

/*
CDXC:GxserverRustPort 2026-06-14-22:12:
Phase 3 Rust must use the TypeScript SQLite tables as durable state instead of an in-memory compatibility stub. Preserve project/session IDs, JSON validation, corrupt-state errors, and camelCase response fields so sidebar inventory can opt into Rust without a client protocol change.
*/
pub struct DomainRepository<'a> {
    db: &'a Connection,
    server_id: String,
}

impl<'a> DomainRepository<'a> {
    pub fn new(db: &'a Connection, server_id: impl Into<String>) -> Self {
        Self {
            db,
            server_id: server_id.into(),
        }
    }

    pub fn create_project(&self, params: &Map<String, Value>) -> DomainResult<Value> {
        let project_id = self.create_unique_project_id()?;
        let timestamp = now_iso();
        let project = normalize_project_input(&project_id, &timestamp, params)?;
        self.db
            .execute(
                r#"
                INSERT INTO projects (
                  projectId, name, path, identityIconJson, isPinned, isFavorite, defaultCommand, worktreeJson,
                  customAgentsJson, customAgentOrderJson, customCommandsJson, customCommandOrderJson,
                  deletedDefaultCommandIdsJson, launchSettingsJson, runtimeSettingsJson, completionRulesJson,
                  attentionRulesJson, notificationRulesJson, gitConfigJson, projectBoardConfigJson,
                  previousSessionHistoryJson, createdAt, updatedAt
                ) VALUES (
                  ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                  ?9, ?10, ?11, ?12,
                  ?13, ?14, ?15, ?16,
                  ?17, ?18, ?19, ?20,
                  ?21, ?22, ?23
                )
                "#,
                project_insert_params(&project)?,
            )
            .map_err(sql_error)?;
        self.record_id_allocation("project", "", &project_id, &timestamp)?;
        Ok(project)
    }

    pub fn update_project(&self, params: &Map<String, Value>) -> DomainResult<Value> {
        let project_id = read_project_id(params)?;
        let current = self.get_project(&project_id)?.ok_or_else(|| {
            DomainStateError::not_found(format!("Project {project_id} does not exist."))
        })?;
        let updated_at = now_iso();
        let project = merge_project_update(current, &updated_at, params)?;
        self.db
            .execute(
                r#"
                UPDATE projects SET
                  name = ?2,
                  path = ?3,
                  identityIconJson = ?4,
                  isPinned = ?5,
                  isFavorite = ?6,
                  defaultCommand = ?7,
                  worktreeJson = ?8,
                  customAgentsJson = ?9,
                  customAgentOrderJson = ?10,
                  customCommandsJson = ?11,
                  customCommandOrderJson = ?12,
                  deletedDefaultCommandIdsJson = ?13,
                  launchSettingsJson = ?14,
                  runtimeSettingsJson = ?15,
                  completionRulesJson = ?16,
                  attentionRulesJson = ?17,
                  notificationRulesJson = ?18,
                  gitConfigJson = ?19,
                  projectBoardConfigJson = ?20,
                  previousSessionHistoryJson = ?21,
                  updatedAt = ?23
                WHERE projectId = ?1
                "#,
                project_insert_params(&project)?,
            )
            .map_err(sql_error)?;
        Ok(project)
    }

    pub fn list_projects(&self) -> DomainResult<Vec<Value>> {
        let mut statement = self
            .db
            .prepare("SELECT * FROM projects ORDER BY updatedAt DESC, projectId ASC")
            .map_err(sql_error)?;
        let rows = statement
            .query_map([], project_row_from_sql)
            .map_err(sql_error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(sql_error)?;
        rows.into_iter().map(project_from_row).collect()
    }

    pub fn get_project(&self, project_id: &str) -> DomainResult<Option<Value>> {
        let row = self
            .db
            .query_row(
                "SELECT * FROM projects WHERE projectId = ?1",
                [project_id],
                project_row_from_sql,
            )
            .optional()
            .map_err(sql_error)?;
        row.map(project_from_row).transpose()
    }

    pub fn remove_project(&self, project_id: &str) -> DomainResult<Value> {
        let current = self.get_project(project_id)?.ok_or_else(|| {
            DomainStateError::not_found(format!("Project {project_id} does not exist."))
        })?;
        self.db
            .execute("DELETE FROM projects WHERE projectId = ?1", [project_id])
            .map_err(sql_error)?;
        Ok(current)
    }

    pub fn add_project_path(&self, params: &Map<String, Value>) -> DomainResult<Value> {
        let path = normalize_existing_directory_path(
            params.get("path").or_else(|| params.get("projectPath")),
            "path",
        )?;
        if let Some(existing) = self.find_project_by_path(&path)? {
            return Ok(existing);
        }
        let mut create_params = params.clone();
        create_params.insert("path".to_string(), Value::String(path.clone()));
        if !read_optional_text(create_params.get("name")).is_some() {
            create_params.insert("name".to_string(), Value::String(path_basename(&path)));
        }
        self.create_project(&create_params)
    }

    pub fn create_session(
        &self,
        params: &Map<String, Value>,
        create_agent_session: bool,
    ) -> DomainResult<Value> {
        let project = self.resolve_create_session_project(params)?;
        let project_id = read_string_field(&project, "projectId")?;
        let session_id = self.create_unique_session_id(&project_id)?;
        let timestamp = now_iso();
        let normalized_params = if create_agent_session {
            normalize_create_agent_session_params(params)
        } else {
            params.clone()
        };
        let session = normalize_session_input(
            &self.server_id,
            &project_id,
            &session_id,
            &timestamp,
            &normalized_params,
        )?;
        self.db
            .execute(
                r#"
                INSERT INTO sessions (
                  projectId, sessionId, kind, title, lifecycleState, providerStateJson, zmxName, cwd,
                  agentId, commandId, isPinned, isFavorite, sessionTag, restoredFromSessionId, restoredFromHistoryId,
                  launchSettingsJson, runtimeSettingsJson, completionRulesJson, attentionRulesJson,
                  notificationRulesJson, worktreeJson, createdAt, updatedAt, lastActiveAt, sidebarOrder
                ) VALUES (
                  ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                  ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                  ?16, ?17, ?18, ?19,
                  ?20, ?21, ?22, ?23, ?24, ?25
                )
                "#,
                session_insert_params(&session)?,
            )
            .map_err(sql_error)?;
        self.record_id_allocation("session", &project_id, &session_id, &timestamp)?;
        Ok(session)
    }

    pub fn update_session(&self, params: &Map<String, Value>) -> DomainResult<Value> {
        self.update_session_inner(params, false)
    }

    pub fn update_session_for_lifecycle(&self, params: &Map<String, Value>) -> DomainResult<Value> {
        self.update_session_inner(params, true)
    }

    fn update_session_inner(
        &self,
        params: &Map<String, Value>,
        allow_stopped_lifecycle_revive: bool,
    ) -> DomainResult<Value> {
        let project_id = read_project_id(params)?;
        let session_id = read_session_id(params)?;
        let current = self.get_session(&project_id, &session_id)?.ok_or_else(|| {
            DomainStateError::not_found(format!(
                "Session {project_id}/{session_id} does not exist."
            ))
        })?;
        if !allow_stopped_lifecycle_revive {
            reject_stopped_session_revive(&current, params, "update-session")?;
        }
        let updated_at = now_iso();
        let session = merge_session_update(&self.server_id, current, &updated_at, params)?;
        self.db
            .execute(
                r#"
                UPDATE sessions SET
                  kind = ?3,
                  title = ?4,
                  lifecycleState = ?5,
                  providerStateJson = ?6,
                  zmxName = ?7,
                  cwd = ?8,
                  agentId = ?9,
                  commandId = ?10,
                  isPinned = ?11,
                  isFavorite = ?12,
                  sessionTag = ?13,
                  restoredFromSessionId = ?14,
                  restoredFromHistoryId = ?15,
                  launchSettingsJson = ?16,
                  runtimeSettingsJson = ?17,
                  completionRulesJson = ?18,
                  attentionRulesJson = ?19,
                  notificationRulesJson = ?20,
                  worktreeJson = ?21,
                  createdAt = ?22,
                  updatedAt = ?23,
                  lastActiveAt = ?24,
                  sidebarOrder = ?25
                WHERE projectId = ?1 AND sessionId = ?2
                "#,
                session_insert_params(&session)?,
            )
            .map_err(sql_error)?;
        Ok(session)
    }

    pub fn update_session_order(&self, params: &Map<String, Value>) -> DomainResult<Vec<Value>> {
        let project_id = read_project_id(params)?;
        if self.get_project(&project_id)?.is_none() {
            return Err(DomainStateError::not_found(format!(
                "Project {project_id} does not exist."
            )));
        }
        let session_ids = normalize_session_order_ids(params.get("sessionIds"))?;
        let updated_at = now_iso();
        let mut sessions = Vec::new();
        for (index, session_id) in session_ids.iter().enumerate() {
            let current = self.get_session(&project_id, session_id)?.ok_or_else(|| {
                DomainStateError::not_found(format!(
                    "Session {project_id}/{session_id} does not exist."
                ))
            })?;
            let mut update = Map::new();
            update.insert("projectId".to_string(), Value::String(project_id.clone()));
            update.insert("sessionId".to_string(), Value::String(session_id.clone()));
            update.insert(
                "sidebarOrder".to_string(),
                Value::Number(serde_json::Number::from(((index + 1) * 1000) as i64)),
            );
            let session = merge_session_update(&self.server_id, current, &updated_at, &update)?;
            self.db
                .execute(
                    "UPDATE sessions SET updatedAt = ?3, sidebarOrder = ?4 WHERE projectId = ?1 AND sessionId = ?2",
                    params![
                        project_id,
                        session_id,
                        updated_at,
                        ((index + 1) * 1000) as i64
                    ],
                )
                .map_err(sql_error)?;
            sessions.push(session);
        }
        Ok(sessions)
    }

    pub fn list_sessions(&self, project_id: Option<&str>) -> DomainResult<Vec<Value>> {
        let rows = if let Some(project_id) = project_id {
            let mut statement = self
                .db
                .prepare(
                    "SELECT * FROM sessions WHERE projectId = ?1 ORDER BY updatedAt DESC, sessionId ASC",
                )
                .map_err(sql_error)?;
            let rows = statement
                .query_map([project_id], session_row_from_sql)
                .map_err(sql_error)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(sql_error)?;
            rows
        } else {
            let mut statement = self
                .db
                .prepare(
                    "SELECT * FROM sessions ORDER BY updatedAt DESC, projectId ASC, sessionId ASC",
                )
                .map_err(sql_error)?;
            let rows = statement
                .query_map([], session_row_from_sql)
                .map_err(sql_error)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(sql_error)?;
            rows
        };
        rows.into_iter()
            .map(|row| session_from_row(&self.server_id, row))
            .collect()
    }

    pub fn get_session(&self, project_id: &str, session_id: &str) -> DomainResult<Option<Value>> {
        let row = self
            .db
            .query_row(
                "SELECT * FROM sessions WHERE projectId = ?1 AND sessionId = ?2",
                params![project_id, session_id],
                session_row_from_sql,
            )
            .optional()
            .map_err(sql_error)?;
        row.map(|row| session_from_row(&self.server_id, row))
            .transpose()
    }

    pub fn remove_session(&self, params: &Map<String, Value>) -> DomainResult<Value> {
        let project_id = read_project_id(params)?;
        let session_id = read_session_id(params)?;
        let current = self.get_session(&project_id, &session_id)?.ok_or_else(|| {
            DomainStateError::not_found(format!(
                "Session {project_id}/{session_id} does not exist."
            ))
        })?;
        self.db
            .execute(
                "DELETE FROM sessions WHERE projectId = ?1 AND sessionId = ?2",
                params![project_id, session_id],
            )
            .map_err(sql_error)?;
        Ok(current)
    }

    pub fn read_project_status(&self, params: &Map<String, Value>) -> DomainResult<Value> {
        let project_id = read_project_id(params)?;
        let project = self.get_project(&project_id)?.ok_or_else(|| {
            DomainStateError::not_found(format!("Project {project_id} does not exist."))
        })?;
        Ok(json!({
            "project": project,
            "sessions": self.list_sessions(Some(&project_id))?,
        }))
    }

    fn find_project_by_path(&self, normalized_path: &str) -> DomainResult<Option<Value>> {
        for project in self.list_projects()? {
            if project.get("path").and_then(Value::as_str) == Some(normalized_path) {
                return Ok(Some(project));
            }
        }
        Ok(None)
    }

    fn resolve_create_session_project(&self, params: &Map<String, Value>) -> DomainResult<Value> {
        let project_id = params
            .get("projectId")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        if is_gxserver_project_id(project_id) {
            if let Some(project) = self.get_project(project_id)? {
                return Ok(project);
            }
        }

        let project_path = params.get("projectPath").or_else(|| params.get("cwd"));
        if let Some(path_value) = project_path
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
        {
            let normalized_path = normalize_existing_directory_path(
                Some(&Value::String(path_value.to_string())),
                if params.contains_key("projectPath") {
                    "projectPath"
                } else {
                    "cwd"
                },
            )?;
            if let Some(existing) = self.find_project_by_path(&normalized_path)? {
                return Ok(existing);
            }
            let mut create_params = Map::new();
            create_params.insert(
                "name".to_string(),
                Value::String(
                    read_optional_text(params.get("projectName"))
                        .unwrap_or_else(|| path_basename(&normalized_path)),
                ),
            );
            create_params.insert("path".to_string(), Value::String(normalized_path));
            return self.create_project(&create_params);
        }

        if !project_id.is_empty() && !is_gxserver_project_id(project_id) {
            return Err(DomainStateError::bad_request(format!(
                "Invalid gxserver project ID: {project_id}."
            )));
        }
        if !project_id.is_empty() {
            return Err(DomainStateError::not_found(format!(
                "Project {project_id} does not exist."
            )));
        }
        Err(DomainStateError::bad_request(
            "createSession requires projectId, projectPath, or cwd.",
        ))
    }

    fn create_unique_project_id(&self) -> DomainResult<String> {
        let existing = self.existing_project_ids()?;
        for _ in 0..MAX_ID_GENERATION_ATTEMPTS {
            let candidate = create_project_id();
            if !existing.contains(&candidate) {
                return Ok(candidate);
            }
        }
        Err(DomainStateError::bad_request(
            "Unable to generate a unique gxserver project ID.",
        ))
    }

    fn create_unique_session_id(&self, project_id: &str) -> DomainResult<String> {
        let existing = self.existing_session_ids(project_id)?;
        for _ in 0..MAX_ID_GENERATION_ATTEMPTS {
            let candidate = create_session_id();
            if !existing.contains(&candidate) {
                return Ok(candidate);
            }
        }
        Err(DomainStateError::bad_request(
            "Unable to generate a unique gxserver session ID.",
        ))
    }

    fn existing_project_ids(&self) -> DomainResult<HashSet<String>> {
        let mut statement = self
            .db
            .prepare("SELECT projectId AS id FROM projects UNION SELECT id FROM id_allocations WHERE kind = 'project'")
            .map_err(sql_error)?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(sql_error)?
            .collect::<std::result::Result<HashSet<_>, _>>()
            .map_err(sql_error)?;
        Ok(ids)
    }

    fn existing_session_ids(&self, project_id: &str) -> DomainResult<HashSet<String>> {
        let mut statement = self
            .db
            .prepare("SELECT sessionId AS id FROM sessions WHERE projectId = ?1 UNION SELECT id FROM id_allocations WHERE kind = 'session' AND parentId = ?2")
            .map_err(sql_error)?;
        let ids = statement
            .query_map(params![project_id, project_id], |row| {
                row.get::<_, String>(0)
            })
            .map_err(sql_error)?
            .collect::<std::result::Result<HashSet<_>, _>>()
            .map_err(sql_error)?;
        Ok(ids)
    }

    fn record_id_allocation(
        &self,
        kind: &str,
        parent_id: &str,
        id: &str,
        created_at: &str,
    ) -> DomainResult<()> {
        self.db
            .execute(
                "INSERT OR IGNORE INTO id_allocations (id, kind, parentId, createdAt) VALUES (?1, ?2, ?3, ?4)",
                params![id, kind, parent_id, created_at],
            )
            .map_err(sql_error)?;
        Ok(())
    }
}

pub fn read_domain_rpc_params(body: &Value) -> DomainResult<Map<String, Value>> {
    let Some(object) = body.as_object() else {
        return Err(DomainStateError::bad_request(
            "RPC request body must be an object.",
        ));
    };
    match object.get("params") {
        None => Ok(Map::new()),
        Some(Value::Object(params)) => Ok(params.clone()),
        Some(_) => Err(DomainStateError::bad_request(
            "RPC params must be an object.",
        )),
    }
}

pub fn read_optional_project_id(params: &Map<String, Value>) -> DomainResult<Option<String>> {
    match params.get("projectId") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) if value.trim().is_empty() => Ok(None),
        _ => read_project_id(params).map(Some),
    }
}

pub fn read_project_id(params: &Map<String, Value>) -> DomainResult<String> {
    let value = params
        .get("projectId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !is_gxserver_project_id(value) {
        return Err(DomainStateError::bad_request(format!(
            "Invalid gxserver project ID: {}.",
            params
                .get("projectId")
                .map(Value::to_string)
                .unwrap_or_else(|| "undefined".to_string())
        )));
    }
    Ok(value.to_string())
}

pub fn read_session_id(params: &Map<String, Value>) -> DomainResult<String> {
    let value = params
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !is_gxserver_session_id(value) {
        return Err(DomainStateError::bad_request(format!(
            "Invalid gxserver session ID: {}.",
            params
                .get("sessionId")
                .map(Value::to_string)
                .unwrap_or_else(|| "undefined".to_string())
        )));
    }
    Ok(value.to_string())
}

fn normalize_project_input(
    project_id: &str,
    timestamp: &str,
    input: &Map<String, Value>,
) -> DomainResult<Value> {
    let mut project = Map::new();
    project.insert(
        "attentionRules".to_string(),
        Value::Object(normalize_object(input.get("attentionRules"))),
    );
    project.insert(
        "completionRules".to_string(),
        Value::Object(normalize_object(input.get("completionRules"))),
    );
    project.insert(
        "createdAt".to_string(),
        Value::String(timestamp.to_string()),
    );
    project.insert(
        "customAgentOrder".to_string(),
        Value::Array(
            normalize_string_array(input.get("customAgentOrder"))
                .into_iter()
                .map(Value::String)
                .collect(),
        ),
    );
    project.insert(
        "customAgents".to_string(),
        Value::Array(normalize_object_array(input.get("customAgents"))),
    );
    project.insert(
        "customCommandOrder".to_string(),
        Value::Array(
            normalize_string_array(input.get("customCommandOrder"))
                .into_iter()
                .map(Value::String)
                .collect(),
        ),
    );
    project.insert(
        "customCommands".to_string(),
        Value::Array(normalize_object_array(input.get("customCommands"))),
    );
    insert_optional_string(
        &mut project,
        "defaultCommand",
        read_optional_text(input.get("defaultCommand")),
    );
    project.insert(
        "deletedDefaultCommandIds".to_string(),
        Value::Array(
            normalize_string_array(input.get("deletedDefaultCommandIds"))
                .into_iter()
                .map(Value::String)
                .collect(),
        ),
    );
    project.insert(
        "gitConfig".to_string(),
        Value::Object(normalize_object(input.get("gitConfig"))),
    );
    insert_optional_object(
        &mut project,
        "identityIcon",
        normalize_object(input.get("identityIcon")),
    );
    project.insert(
        "isFavorite".to_string(),
        Value::Bool(input.get("isFavorite").and_then(Value::as_bool) == Some(true)),
    );
    project.insert(
        "isPinned".to_string(),
        Value::Bool(input.get("isPinned").and_then(Value::as_bool) == Some(true)),
    );
    project.insert(
        "launchSettings".to_string(),
        Value::Object(normalize_object(input.get("launchSettings"))),
    );
    project.insert(
        "name".to_string(),
        Value::String(normalize_required_text(input.get("name"), "name")?),
    );
    project.insert(
        "notificationRules".to_string(),
        Value::Object(normalize_object(input.get("notificationRules"))),
    );
    insert_optional_string(&mut project, "path", read_optional_text(input.get("path")));
    project.insert(
        "previousSessionHistory".to_string(),
        Value::Array(normalize_object_array(input.get("previousSessionHistory"))),
    );
    project.insert(
        "projectBoardConfig".to_string(),
        Value::Object(normalize_object(input.get("projectBoardConfig"))),
    );
    project.insert(
        "projectId".to_string(),
        Value::String(project_id.to_string()),
    );
    project.insert(
        "runtimeSettings".to_string(),
        Value::Object(normalize_object(input.get("runtimeSettings"))),
    );
    project.insert(
        "updatedAt".to_string(),
        Value::String(timestamp.to_string()),
    );
    insert_optional_object(
        &mut project,
        "worktree",
        normalize_object(input.get("worktree")),
    );
    Ok(Value::Object(project))
}

fn merge_project_update(
    current: Value,
    updated_at: &str,
    input: &Map<String, Value>,
) -> DomainResult<Value> {
    let current = current.as_object().ok_or_else(|| {
        DomainStateError::corrupt_state("Project row did not decode as an object.")
    })?;
    let mut next = current.clone();
    update_object_field(&mut next, input, "attentionRules");
    update_object_field(&mut next, input, "completionRules");
    update_string_array_field(&mut next, input, "customAgentOrder");
    update_object_array_field(&mut next, input, "customAgents");
    update_string_array_field(&mut next, input, "customCommandOrder");
    update_object_array_field(&mut next, input, "customCommands");
    update_optional_text_field(&mut next, input, "defaultCommand");
    update_string_array_field(&mut next, input, "deletedDefaultCommandIds");
    update_object_field(&mut next, input, "gitConfig");
    update_optional_object_field(&mut next, input, "identityIcon");
    if let Some(value) = input.get("isFavorite") {
        next.insert(
            "isFavorite".to_string(),
            Value::Bool(value.as_bool() == Some(true)),
        );
    }
    if let Some(value) = input.get("isPinned") {
        next.insert(
            "isPinned".to_string(),
            Value::Bool(value.as_bool() == Some(true)),
        );
    }
    update_object_field(&mut next, input, "launchSettings");
    if input.contains_key("name") {
        next.insert(
            "name".to_string(),
            Value::String(normalize_required_text(input.get("name"), "name")?),
        );
    }
    update_object_field(&mut next, input, "notificationRules");
    update_optional_text_field(&mut next, input, "path");
    update_object_array_field(&mut next, input, "previousSessionHistory");
    update_object_field(&mut next, input, "projectBoardConfig");
    update_object_field(&mut next, input, "runtimeSettings");
    update_optional_object_field(&mut next, input, "worktree");
    next.insert(
        "updatedAt".to_string(),
        Value::String(updated_at.to_string()),
    );
    Ok(Value::Object(next))
}

fn normalize_session_input(
    server_id: &str,
    project_id: &str,
    session_id: &str,
    timestamp: &str,
    input: &Map<String, Value>,
) -> DomainResult<Value> {
    let zmx_name = create_zmx_session_name(server_id, project_id, session_id);
    let title = read_optional_text(input.get("title")).unwrap_or_else(|| session_id.to_string());
    let mut runtime_settings = normalize_object(input.get("runtimeSettings"));
    if is_temporary_session_title(&title) && !runtime_settings.contains_key("titleSource") {
        runtime_settings.insert(
            "titleSource".to_string(),
            Value::String("placeholder".to_string()),
        );
    }
    if !runtime_settings.contains_key("agentActivity") {
        runtime_settings.insert(
            "agentActivity".to_string(),
            default_agent_activity(input.get("agentId").and_then(Value::as_str), timestamp),
        );
    }
    let mut launch_settings = normalize_object(input.get("launchSettings"));
    let surface = resolve_surface(input.get("surface"), &launch_settings, &runtime_settings);
    if input.get("surface").and_then(Value::as_str).is_some()
        || launch_settings.get("surface").is_some()
    {
        launch_settings.insert("surface".to_string(), Value::String(surface.clone()));
    }
    let session_tag = normalize_optional_session_tag(input.get("sessionTag"))?;
    let mut provider_state = normalize_object(input.get("providerState"));
    provider_state.insert(
        "lifecycleState".to_string(),
        Value::String(normalize_provider_lifecycle_state(
            provider_state.get("lifecycleState"),
        )),
    );
    provider_state.insert("zmxName".to_string(), Value::String(zmx_name.clone()));

    let mut session = Map::new();
    insert_optional_string(
        &mut session,
        "agentId",
        read_optional_text(input.get("agentId")),
    );
    session.insert(
        "attentionRules".to_string(),
        Value::Object(normalize_object(input.get("attentionRules"))),
    );
    insert_optional_string(
        &mut session,
        "commandId",
        read_optional_text(input.get("commandId")),
    );
    session.insert(
        "completionRules".to_string(),
        Value::Object(normalize_object(input.get("completionRules"))),
    );
    session.insert(
        "createdAt".to_string(),
        Value::String(timestamp.to_string()),
    );
    insert_optional_string(&mut session, "cwd", read_optional_text(input.get("cwd")));
    session.insert(
        "globalRef".to_string(),
        Value::String(create_global_session_ref(server_id, project_id, session_id)),
    );
    let mut hidden = Map::new();
    insert_optional_string(
        &mut hidden,
        "restoredFromHistoryId",
        read_optional_text(input.get("restoredFromHistoryId")),
    );
    if let Some(restored) = input
        .get("restoredFromSessionId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        if !is_gxserver_session_id(restored) {
            return Err(DomainStateError::bad_request(format!(
                "Invalid restoredFromSessionId: {restored}."
            )));
        }
        hidden.insert(
            "restoredFromSessionId".to_string(),
            Value::String(restored.to_string()),
        );
    }
    session.insert("hiddenMetadata".to_string(), Value::Object(hidden));
    session.insert(
        "isFavorite".to_string(),
        Value::Bool(
            session_tag.as_deref() == Some("favorite")
                || (session_tag.is_none()
                    && input.get("isFavorite").and_then(Value::as_bool) == Some(true)),
        ),
    );
    session.insert(
        "isPinned".to_string(),
        Value::Bool(input.get("isPinned").and_then(Value::as_bool) == Some(true)),
    );
    session.insert(
        "kind".to_string(),
        Value::String(normalize_session_kind(input.get("kind"))),
    );
    insert_optional_string(
        &mut session,
        "lastActiveAt",
        read_optional_text(input.get("lastActiveAt")),
    );
    session.insert("launchSettings".to_string(), Value::Object(launch_settings));
    session.insert(
        "lifecycleState".to_string(),
        Value::String(normalize_domain_lifecycle_state(
            input.get("lifecycleState"),
        )),
    );
    session.insert(
        "notificationRules".to_string(),
        Value::Object(normalize_object(input.get("notificationRules"))),
    );
    session.insert(
        "projectId".to_string(),
        Value::String(project_id.to_string()),
    );
    session.insert("providerState".to_string(), Value::Object(provider_state));
    session.insert(
        "runtimeSettings".to_string(),
        Value::Object(runtime_settings),
    );
    session.insert(
        "sessionId".to_string(),
        Value::String(session_id.to_string()),
    );
    if let Some(tag) = session_tag {
        session.insert("sessionTag".to_string(), Value::String(tag));
    }
    if let Some(order) = normalize_optional_sidebar_order(input.get("sidebarOrder")) {
        session.insert("sidebarOrder".to_string(), json!(order));
    } else {
        session.insert("sidebarOrder".to_string(), json!(0));
    }
    session.insert("surface".to_string(), Value::String(surface));
    session.insert("title".to_string(), Value::String(title));
    session.insert(
        "updatedAt".to_string(),
        Value::String(timestamp.to_string()),
    );
    insert_optional_object(
        &mut session,
        "worktree",
        normalize_object(input.get("worktree")),
    );
    session.insert("zmxName".to_string(), Value::String(zmx_name));
    Ok(Value::Object(session))
}

fn merge_session_update(
    server_id: &str,
    current: Value,
    updated_at: &str,
    input: &Map<String, Value>,
) -> DomainResult<Value> {
    let current = current.as_object().ok_or_else(|| {
        DomainStateError::corrupt_state("Session row did not decode as an object.")
    })?;
    let project_id = current
        .get("projectId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| {
            DomainStateError::corrupt_state("projectId missing from session domain state.")
        })?;
    let session_id = current
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| {
            DomainStateError::corrupt_state("sessionId missing from session domain state.")
        })?;
    let zmx_name = create_zmx_session_name(server_id, &project_id, &session_id);
    let mut next = current.clone();
    update_optional_text_field(&mut next, input, "agentId");
    update_object_field(&mut next, input, "attentionRules");
    update_optional_text_field(&mut next, input, "commandId");
    update_object_field(&mut next, input, "completionRules");
    update_optional_text_field(&mut next, input, "cwd");
    let mut hidden = next
        .get("hiddenMetadata")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    if input.contains_key("restoredFromHistoryId") {
        set_optional_string(
            &mut hidden,
            "restoredFromHistoryId",
            read_optional_text(input.get("restoredFromHistoryId")),
        );
    }
    if input.contains_key("restoredFromSessionId") {
        if let Some(restored) = read_optional_text(input.get("restoredFromSessionId")) {
            if !is_gxserver_session_id(&restored) {
                return Err(DomainStateError::bad_request(format!(
                    "Invalid restoredFromSessionId: {restored}."
                )));
            }
            hidden.insert("restoredFromSessionId".to_string(), Value::String(restored));
        } else {
            hidden.remove("restoredFromSessionId");
        }
    }
    next.insert("hiddenMetadata".to_string(), Value::Object(hidden));
    if input.contains_key("isPinned") {
        next.insert(
            "isPinned".to_string(),
            Value::Bool(input.get("isPinned").and_then(Value::as_bool) == Some(true)),
        );
    }
    if input.contains_key("kind") {
        next.insert(
            "kind".to_string(),
            Value::String(normalize_session_kind(input.get("kind"))),
        );
    }
    update_optional_text_field(&mut next, input, "lastActiveAt");
    let mut launch_settings = if input.contains_key("launchSettings") {
        normalize_object(input.get("launchSettings"))
    } else {
        next.get("launchSettings")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default()
    };
    let runtime_settings = if input.contains_key("runtimeSettings") {
        let title = input
            .get("title")
            .and_then(Value::as_str)
            .or_else(|| next.get("title").and_then(Value::as_str));
        let mut settings = normalize_object(input.get("runtimeSettings"));
        if title.map(is_temporary_session_title).unwrap_or(false)
            && !settings.contains_key("titleSource")
        {
            settings.insert(
                "titleSource".to_string(),
                Value::String("placeholder".to_string()),
            );
        }
        settings
    } else {
        next.get("runtimeSettings")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default()
    };
    if input.contains_key("launchSettings") || input.contains_key("surface") {
        let surface = resolve_surface(input.get("surface"), &launch_settings, &runtime_settings);
        if input.contains_key("surface") || launch_settings.contains_key("surface") {
            launch_settings.insert("surface".to_string(), Value::String(surface.clone()));
        }
        next.insert("surface".to_string(), Value::String(surface));
    } else {
        next.insert(
            "surface".to_string(),
            Value::String(resolve_surface(None, &launch_settings, &runtime_settings)),
        );
    }
    next.insert("launchSettings".to_string(), Value::Object(launch_settings));
    if input.contains_key("lifecycleState") {
        next.insert(
            "lifecycleState".to_string(),
            Value::String(normalize_domain_lifecycle_state(
                input.get("lifecycleState"),
            )),
        );
    }
    update_object_field(&mut next, input, "notificationRules");
    if input.contains_key("providerState") {
        let mut provider_state = normalize_object(input.get("providerState"));
        provider_state.insert(
            "lifecycleState".to_string(),
            Value::String(normalize_provider_lifecycle_state(
                provider_state.get("lifecycleState"),
            )),
        );
        provider_state.insert("zmxName".to_string(), Value::String(zmx_name.clone()));
        next.insert("providerState".to_string(), Value::Object(provider_state));
    } else if let Some(provider_state) = next
        .get("providerState")
        .and_then(Value::as_object)
        .cloned()
    {
        let mut provider_state = provider_state;
        provider_state.insert("zmxName".to_string(), Value::String(zmx_name.clone()));
        next.insert("providerState".to_string(), Value::Object(provider_state));
    }
    next.insert(
        "runtimeSettings".to_string(),
        Value::Object(runtime_settings),
    );
    if input.contains_key("sessionTag") || input.contains_key("isFavorite") {
        let session_tag = if input.contains_key("sessionTag") {
            normalize_optional_session_tag(input.get("sessionTag"))?
        } else if input.get("isFavorite").and_then(Value::as_bool) == Some(true) {
            Some("favorite".to_string())
        } else {
            None
        };
        if let Some(tag) = session_tag {
            next.insert("sessionTag".to_string(), Value::String(tag.clone()));
            next.insert("isFavorite".to_string(), Value::Bool(tag == "favorite"));
        } else {
            next.remove("sessionTag");
            next.insert("isFavorite".to_string(), Value::Bool(false));
        }
    }
    if input.contains_key("sidebarOrder") {
        match normalize_optional_sidebar_order(input.get("sidebarOrder")) {
            Some(order) => {
                next.insert("sidebarOrder".to_string(), json!(order));
            }
            None => {
                next.remove("sidebarOrder");
            }
        }
    }
    if input.contains_key("title") {
        next.insert(
            "title".to_string(),
            Value::String(read_optional_text(input.get("title")).unwrap_or(session_id.clone())),
        );
    }
    update_optional_object_field(&mut next, input, "worktree");
    next.insert(
        "globalRef".to_string(),
        Value::String(create_global_session_ref(
            server_id,
            &project_id,
            &session_id,
        )),
    );
    next.insert(
        "updatedAt".to_string(),
        Value::String(updated_at.to_string()),
    );
    next.insert("zmxName".to_string(), Value::String(zmx_name));
    Ok(Value::Object(next))
}

fn normalize_create_agent_session_params(input: &Map<String, Value>) -> Map<String, Value> {
    let mut params = input.clone();
    let agent_id = read_optional_text(input.get("agentId")).unwrap_or_else(|| "codex".to_string());
    let mut launch_settings = normalize_object(input.get("launchSettings"));
    let mut runtime_settings = normalize_object(input.get("runtimeSettings"));
    let base_command = read_optional_text(launch_settings.get("agentCommand"))
        .or_else(|| default_agent_command(&agent_id).map(str::to_string))
        .unwrap_or_default();
    let command = apply_agent_accept_all(&agent_id, &base_command);
    let startup_text = if command.is_empty() {
        String::new()
    } else {
        format!(" {command}\r")
    };
    let mut plan = Map::new();
    if !base_command.is_empty() {
        plan.insert(
            "agentCommand".to_string(),
            Value::String(base_command.clone()),
        );
    }
    plan.insert("command".to_string(), Value::String(command.clone()));
    plan.insert("startupText".to_string(), Value::String(startup_text));
    plan.insert(
        "startupTextDisposition".to_string(),
        Value::String(
            if command.is_empty() {
                "none"
            } else {
                "queueAfterTerminalReady"
            }
            .to_string(),
        ),
    );
    if let Some(first_user_message) = read_optional_text(runtime_settings.get("firstUserMessage")) {
        plan.insert(
            "firstUserMessage".to_string(),
            Value::String(first_user_message),
        );
    }
    launch_settings.insert("agentLaunchPlan".to_string(), Value::Object(plan));
    launch_settings.insert(
        "runtimeRelevant".to_string(),
        json!({ "queueProviderStartupText": !command.is_empty() }),
    );
    if !command.is_empty() {
        runtime_settings.insert("agentCommand".to_string(), Value::String(base_command));
    }
    runtime_settings.insert("agentName".to_string(), Value::String(agent_id.clone()));
    runtime_settings.insert("launchAgentId".to_string(), Value::String(agent_id.clone()));
    params.insert("agentId".to_string(), Value::String(agent_id));
    params.insert("kind".to_string(), Value::String("agent".to_string()));
    params.insert("launchSettings".to_string(), Value::Object(launch_settings));
    params.insert(
        "lifecycleState".to_string(),
        input
            .get("lifecycleState")
            .cloned()
            .unwrap_or_else(|| Value::String("running".to_string())),
    );
    params.insert(
        "runtimeSettings".to_string(),
        Value::Object(runtime_settings),
    );
    params
}

fn default_agent_command(agent_id: &str) -> Option<&'static str> {
    match agent_id {
        "amp" => Some("amp"),
        "antigravity" => Some("agy"),
        "claude" => Some("claude"),
        "codex" => Some("codex"),
        "cursor" => Some("cursor-agent"),
        "gemini" => Some("gemini"),
        "grok" => Some("grok"),
        "opencode" => Some("opencode"),
        "pi" => Some("pi"),
        _ => None,
    }
}

fn apply_agent_accept_all(agent_id: &str, command: &str) -> String {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if agent_id == "codex" && !trimmed.split_whitespace().any(|token| token == "--yolo") {
        return format!("{trimmed} --yolo");
    }
    trimmed.to_string()
}

fn default_agent_activity(agent_id: Option<&str>, timestamp: &str) -> Value {
    let mut activity = Map::new();
    activity.insert("activity".to_string(), Value::String("idle".to_string()));
    if let Some(agent_id) = agent_id.filter(|value| !value.trim().is_empty()) {
        activity.insert("agentName".to_string(), Value::String(agent_id.to_string()));
    }
    activity.insert("hasSeenWorking".to_string(), Value::Bool(false));
    activity.insert("isAcknowledged".to_string(), Value::Bool(true));
    activity.insert(
        "lastChangedAt".to_string(),
        Value::String(timestamp.to_string()),
    );
    activity.insert(
        "suppressedUntil".to_string(),
        Value::String(timestamp.to_string()),
    );
    Value::Object(activity)
}

fn reject_stopped_session_revive(
    current: &Value,
    input: &Map<String, Value>,
    reason: &str,
) -> DomainResult<()> {
    if current.get("lifecycleState").and_then(Value::as_str) != Some("stopped") {
        return Ok(());
    }
    if let Some(requested) = input.get("lifecycleState").and_then(Value::as_str) {
        if requested != "stopped" {
            return Err(DomainStateError::bad_request(format!(
                "{reason} cannot change a stopped session to {requested}; use a lifecycle endpoint to wake or start it."
            )));
        }
    }
    if input
        .get("providerState")
        .and_then(Value::as_object)
        .and_then(|provider| provider.get("lifecycleState"))
        .and_then(Value::as_str)
        == Some("exists")
    {
        return Err(DomainStateError::bad_request(format!(
            "{reason} cannot mark a stopped session provider as exists; use a lifecycle endpoint to wake or start it."
        )));
    }
    Ok(())
}

#[derive(Debug)]
struct ProjectRow {
    attention_rules_json: String,
    completion_rules_json: String,
    created_at: String,
    custom_agent_order_json: String,
    custom_agents_json: String,
    custom_command_order_json: String,
    custom_commands_json: String,
    default_command: Option<String>,
    deleted_default_command_ids_json: String,
    git_config_json: String,
    identity_icon_json: String,
    is_favorite: i64,
    is_pinned: i64,
    launch_settings_json: String,
    name: String,
    notification_rules_json: String,
    path: Option<String>,
    previous_session_history_json: String,
    project_board_config_json: String,
    project_id: String,
    runtime_settings_json: String,
    updated_at: String,
    worktree_json: String,
}

fn project_row_from_sql(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectRow> {
    Ok(ProjectRow {
        project_id: row.get("projectId")?,
        name: row.get("name")?,
        path: row.get("path")?,
        identity_icon_json: row.get("identityIconJson")?,
        is_pinned: row.get("isPinned")?,
        is_favorite: row.get("isFavorite")?,
        default_command: row.get("defaultCommand")?,
        worktree_json: row.get("worktreeJson")?,
        custom_agents_json: row.get("customAgentsJson")?,
        custom_agent_order_json: row.get("customAgentOrderJson")?,
        custom_commands_json: row.get("customCommandsJson")?,
        custom_command_order_json: row.get("customCommandOrderJson")?,
        deleted_default_command_ids_json: row.get("deletedDefaultCommandIdsJson")?,
        launch_settings_json: row.get("launchSettingsJson")?,
        runtime_settings_json: row.get("runtimeSettingsJson")?,
        completion_rules_json: row.get("completionRulesJson")?,
        attention_rules_json: row.get("attentionRulesJson")?,
        notification_rules_json: row.get("notificationRulesJson")?,
        git_config_json: row.get("gitConfigJson")?,
        project_board_config_json: row.get("projectBoardConfigJson")?,
        previous_session_history_json: row.get("previousSessionHistoryJson")?,
        created_at: row.get("createdAt")?,
        updated_at: row.get("updatedAt")?,
    })
}

fn project_from_row(row: ProjectRow) -> DomainResult<Value> {
    let mut project = Map::new();
    project.insert(
        "attentionRules".to_string(),
        parse_object(
            &row.attention_rules_json,
            "attentionRulesJson",
            "project",
            &row.project_id,
        )?,
    );
    project.insert(
        "completionRules".to_string(),
        parse_object(
            &row.completion_rules_json,
            "completionRulesJson",
            "project",
            &row.project_id,
        )?,
    );
    project.insert("createdAt".to_string(), Value::String(row.created_at));
    project.insert(
        "customAgentOrder".to_string(),
        parse_string_array(
            &row.custom_agent_order_json,
            "customAgentOrderJson",
            "project",
            &row.project_id,
        )?,
    );
    project.insert(
        "customAgents".to_string(),
        parse_object_array(
            &row.custom_agents_json,
            "customAgentsJson",
            "project",
            &row.project_id,
        )?,
    );
    project.insert(
        "customCommandOrder".to_string(),
        parse_string_array(
            &row.custom_command_order_json,
            "customCommandOrderJson",
            "project",
            &row.project_id,
        )?,
    );
    project.insert(
        "customCommands".to_string(),
        parse_object_array(
            &row.custom_commands_json,
            "customCommandsJson",
            "project",
            &row.project_id,
        )?,
    );
    insert_optional_string(&mut project, "defaultCommand", row.default_command);
    project.insert(
        "deletedDefaultCommandIds".to_string(),
        parse_string_array(
            &row.deleted_default_command_ids_json,
            "deletedDefaultCommandIdsJson",
            "project",
            &row.project_id,
        )?,
    );
    project.insert(
        "gitConfig".to_string(),
        parse_object(
            &row.git_config_json,
            "gitConfigJson",
            "project",
            &row.project_id,
        )?,
    );
    insert_parsed_optional_object(
        &mut project,
        "identityIcon",
        &row.identity_icon_json,
        "identityIconJson",
        "project",
        &row.project_id,
    )?;
    project.insert("isFavorite".to_string(), Value::Bool(row.is_favorite == 1));
    project.insert("isPinned".to_string(), Value::Bool(row.is_pinned == 1));
    project.insert(
        "launchSettings".to_string(),
        parse_object(
            &row.launch_settings_json,
            "launchSettingsJson",
            "project",
            &row.project_id,
        )?,
    );
    project.insert("name".to_string(), Value::String(row.name));
    project.insert(
        "notificationRules".to_string(),
        parse_object(
            &row.notification_rules_json,
            "notificationRulesJson",
            "project",
            &row.project_id,
        )?,
    );
    insert_optional_string(&mut project, "path", row.path);
    project.insert(
        "previousSessionHistory".to_string(),
        parse_object_array(
            &row.previous_session_history_json,
            "previousSessionHistoryJson",
            "project",
            &row.project_id,
        )?,
    );
    project.insert(
        "projectBoardConfig".to_string(),
        parse_object(
            &row.project_board_config_json,
            "projectBoardConfigJson",
            "project",
            &row.project_id,
        )?,
    );
    project.insert(
        "projectId".to_string(),
        Value::String(row.project_id.clone()),
    );
    project.insert(
        "runtimeSettings".to_string(),
        parse_object(
            &row.runtime_settings_json,
            "runtimeSettingsJson",
            "project",
            &row.project_id,
        )?,
    );
    project.insert("updatedAt".to_string(), Value::String(row.updated_at));
    insert_parsed_optional_object(
        &mut project,
        "worktree",
        &row.worktree_json,
        "worktreeJson",
        "project",
        &row.project_id,
    )?;
    Ok(Value::Object(project))
}

#[derive(Debug)]
struct SessionRow {
    agent_id: Option<String>,
    attention_rules_json: String,
    command_id: Option<String>,
    completion_rules_json: String,
    created_at: String,
    cwd: Option<String>,
    is_favorite: i64,
    is_pinned: i64,
    kind: String,
    last_active_at: Option<String>,
    launch_settings_json: String,
    lifecycle_state: String,
    notification_rules_json: String,
    project_id: String,
    provider_state_json: String,
    restored_from_history_id: Option<String>,
    restored_from_session_id: Option<String>,
    runtime_settings_json: String,
    session_id: String,
    session_tag: Option<String>,
    sidebar_order: Option<f64>,
    title: String,
    updated_at: String,
    worktree_json: String,
    zmx_name: String,
}

fn session_row_from_sql(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionRow> {
    Ok(SessionRow {
        project_id: row.get("projectId")?,
        session_id: row.get("sessionId")?,
        kind: row.get("kind")?,
        title: row.get("title")?,
        lifecycle_state: row.get("lifecycleState")?,
        provider_state_json: row.get("providerStateJson")?,
        zmx_name: row.get("zmxName")?,
        cwd: row.get("cwd")?,
        agent_id: row.get("agentId")?,
        command_id: row.get("commandId")?,
        is_pinned: row.get("isPinned")?,
        is_favorite: row.get("isFavorite")?,
        restored_from_session_id: row.get("restoredFromSessionId")?,
        restored_from_history_id: row.get("restoredFromHistoryId")?,
        launch_settings_json: row.get("launchSettingsJson")?,
        runtime_settings_json: row.get("runtimeSettingsJson")?,
        completion_rules_json: row.get("completionRulesJson")?,
        attention_rules_json: row.get("attentionRulesJson")?,
        notification_rules_json: row.get("notificationRulesJson")?,
        worktree_json: row.get("worktreeJson")?,
        created_at: row.get("createdAt")?,
        updated_at: row.get("updatedAt")?,
        last_active_at: row.get("lastActiveAt")?,
        sidebar_order: row.get("sidebarOrder")?,
        session_tag: row.get("sessionTag")?,
    })
}

fn session_from_row(server_id: &str, row: SessionRow) -> DomainResult<Value> {
    let row_id = format!("{}/{}", row.project_id, row.session_id);
    let zmx_name = create_zmx_session_name(server_id, &row.project_id, &row.session_id);
    let mut provider_state = parse_object_map(
        &row.provider_state_json,
        "providerStateJson",
        "session",
        &row_id,
    )?;
    provider_state.insert(
        "lifecycleState".to_string(),
        Value::String(normalize_provider_lifecycle_state(
            provider_state.get("lifecycleState"),
        )),
    );
    provider_state.insert("zmxName".to_string(), Value::String(zmx_name.clone()));
    let launch_settings = parse_object_map(
        &row.launch_settings_json,
        "launchSettingsJson",
        "session",
        &row_id,
    )?;
    let runtime_settings = parse_object_map(
        &row.runtime_settings_json,
        "runtimeSettingsJson",
        "session",
        &row_id,
    )?;
    let worktree = parse_object_map(&row.worktree_json, "worktreeJson", "session", &row_id)?;
    let tag = row.session_tag.as_deref().and_then(|value| {
        normalize_optional_session_tag(Some(&Value::String(value.to_string())))
            .ok()
            .flatten()
    });
    let mut session = Map::new();
    insert_optional_string(&mut session, "agentId", row.agent_id);
    session.insert(
        "attentionRules".to_string(),
        parse_object(
            &row.attention_rules_json,
            "attentionRulesJson",
            "session",
            &row_id,
        )?,
    );
    insert_optional_string(&mut session, "commandId", row.command_id);
    session.insert(
        "completionRules".to_string(),
        parse_object(
            &row.completion_rules_json,
            "completionRulesJson",
            "session",
            &row_id,
        )?,
    );
    session.insert("createdAt".to_string(), Value::String(row.created_at));
    insert_optional_string(&mut session, "cwd", row.cwd);
    session.insert(
        "globalRef".to_string(),
        Value::String(create_global_session_ref(
            server_id,
            &row.project_id,
            &row.session_id,
        )),
    );
    let mut hidden = Map::new();
    insert_optional_string(
        &mut hidden,
        "restoredFromHistoryId",
        row.restored_from_history_id,
    );
    insert_optional_string(
        &mut hidden,
        "restoredFromSessionId",
        row.restored_from_session_id,
    );
    session.insert("hiddenMetadata".to_string(), Value::Object(hidden));
    session.insert(
        "isFavorite".to_string(),
        Value::Bool(tag.as_deref() == Some("favorite") || row.is_favorite == 1),
    );
    session.insert("isPinned".to_string(), Value::Bool(row.is_pinned == 1));
    session.insert(
        "kind".to_string(),
        Value::String(normalize_session_kind(Some(&Value::String(row.kind)))),
    );
    insert_optional_string(&mut session, "lastActiveAt", row.last_active_at);
    session.insert(
        "launchSettings".to_string(),
        Value::Object(launch_settings.clone()),
    );
    session.insert(
        "lifecycleState".to_string(),
        Value::String(normalize_domain_lifecycle_state(Some(&Value::String(
            row.lifecycle_state,
        )))),
    );
    session.insert(
        "notificationRules".to_string(),
        parse_object(
            &row.notification_rules_json,
            "notificationRulesJson",
            "session",
            &row_id,
        )?,
    );
    session.insert(
        "projectId".to_string(),
        Value::String(row.project_id.clone()),
    );
    session.insert("providerState".to_string(), Value::Object(provider_state));
    session.insert(
        "runtimeSettings".to_string(),
        Value::Object(runtime_settings.clone()),
    );
    session.insert("sessionId".to_string(), Value::String(row.session_id));
    if let Some(tag) = tag {
        session.insert("sessionTag".to_string(), Value::String(tag));
    }
    if let Some(order) = row.sidebar_order.filter(|value| value.is_finite()) {
        session.insert("sidebarOrder".to_string(), json!(order));
    }
    session.insert(
        "surface".to_string(),
        Value::String(resolve_surface(None, &launch_settings, &runtime_settings)),
    );
    session.insert("title".to_string(), Value::String(row.title));
    session.insert("updatedAt".to_string(), Value::String(row.updated_at));
    if !worktree.is_empty() {
        session.insert("worktree".to_string(), Value::Object(worktree));
    }
    session.insert("zmxName".to_string(), Value::String(zmx_name));
    let _ = row.zmx_name;
    Ok(Value::Object(session))
}

fn project_insert_params(
    project: &Value,
) -> DomainResult<rusqlite::ParamsFromIter<Vec<rusqlite::types::Value>>> {
    let object = project
        .as_object()
        .ok_or_else(|| DomainStateError::bad_request("Project must be an object."))?;
    let values = vec![
        sql_text(required_string(object, "projectId")?),
        sql_text(required_string(object, "name")?),
        sql_optional_text(optional_string(object, "path")),
        sql_text(stringify_domain_json_field(
            "identityIcon",
            object.get("identityIcon").unwrap_or(&json!({})),
        )?),
        sql_i64(bool_field(object, "isPinned") as i64),
        sql_i64(bool_field(object, "isFavorite") as i64),
        sql_optional_text(optional_string(object, "defaultCommand")),
        sql_text(stringify_domain_json_field(
            "worktree",
            object.get("worktree").unwrap_or(&json!({})),
        )?),
        sql_text(stringify_domain_json_field(
            "customAgents",
            object.get("customAgents").unwrap_or(&json!([])),
        )?),
        sql_text(
            serde_json::to_string(object.get("customAgentOrder").unwrap_or(&json!([]))).unwrap(),
        ),
        sql_text(stringify_domain_json_field(
            "customCommands",
            object.get("customCommands").unwrap_or(&json!([])),
        )?),
        sql_text(
            serde_json::to_string(object.get("customCommandOrder").unwrap_or(&json!([]))).unwrap(),
        ),
        sql_text(
            serde_json::to_string(object.get("deletedDefaultCommandIds").unwrap_or(&json!([])))
                .unwrap(),
        ),
        sql_text(stringify_domain_json_field(
            "launchSettings",
            object.get("launchSettings").unwrap_or(&json!({})),
        )?),
        sql_text(stringify_domain_json_field(
            "runtimeSettings",
            object.get("runtimeSettings").unwrap_or(&json!({})),
        )?),
        sql_text(stringify_domain_json_field(
            "completionRules",
            object.get("completionRules").unwrap_or(&json!({})),
        )?),
        sql_text(stringify_domain_json_field(
            "attentionRules",
            object.get("attentionRules").unwrap_or(&json!({})),
        )?),
        sql_text(stringify_domain_json_field(
            "notificationRules",
            object.get("notificationRules").unwrap_or(&json!({})),
        )?),
        sql_text(stringify_domain_json_field(
            "gitConfig",
            object.get("gitConfig").unwrap_or(&json!({})),
        )?),
        sql_text(stringify_domain_json_field(
            "projectBoardConfig",
            object.get("projectBoardConfig").unwrap_or(&json!({})),
        )?),
        sql_text(stringify_domain_json_field(
            "previousSessionHistory",
            object.get("previousSessionHistory").unwrap_or(&json!([])),
        )?),
        sql_text(required_string(object, "createdAt")?),
        sql_text(required_string(object, "updatedAt")?),
    ];
    Ok(rusqlite::params_from_iter(values))
}

fn session_insert_params(
    session: &Value,
) -> DomainResult<rusqlite::ParamsFromIter<Vec<rusqlite::types::Value>>> {
    let object = session
        .as_object()
        .ok_or_else(|| DomainStateError::bad_request("Session must be an object."))?;
    let hidden = object
        .get("hiddenMetadata")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let values = vec![
        sql_text(required_string(object, "projectId")?),
        sql_text(required_string(object, "sessionId")?),
        sql_text(required_string(object, "kind")?),
        sql_text(required_string(object, "title")?),
        sql_text(required_string(object, "lifecycleState")?),
        sql_text(stringify_domain_json_field(
            "providerState",
            object.get("providerState").unwrap_or(&json!({})),
        )?),
        sql_text(required_string(object, "zmxName")?),
        sql_optional_text(optional_string(object, "cwd")),
        sql_optional_text(optional_string(object, "agentId")),
        sql_optional_text(optional_string(object, "commandId")),
        sql_i64(bool_field(object, "isPinned") as i64),
        sql_i64(bool_field(object, "isFavorite") as i64),
        sql_optional_text(optional_string(object, "sessionTag")),
        sql_optional_text(optional_string(&hidden, "restoredFromSessionId")),
        sql_optional_text(optional_string(&hidden, "restoredFromHistoryId")),
        sql_text(stringify_domain_json_field(
            "launchSettings",
            object.get("launchSettings").unwrap_or(&json!({})),
        )?),
        sql_text(stringify_domain_json_field(
            "runtimeSettings",
            object.get("runtimeSettings").unwrap_or(&json!({})),
        )?),
        sql_text(stringify_domain_json_field(
            "completionRules",
            object.get("completionRules").unwrap_or(&json!({})),
        )?),
        sql_text(stringify_domain_json_field(
            "attentionRules",
            object.get("attentionRules").unwrap_or(&json!({})),
        )?),
        sql_text(stringify_domain_json_field(
            "notificationRules",
            object.get("notificationRules").unwrap_or(&json!({})),
        )?),
        sql_text(stringify_domain_json_field(
            "worktree",
            object.get("worktree").unwrap_or(&json!({})),
        )?),
        sql_text(required_string(object, "createdAt")?),
        sql_text(required_string(object, "updatedAt")?),
        sql_optional_text(optional_string(object, "lastActiveAt")),
        match object
            .get("sidebarOrder")
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite())
        {
            Some(value) => rusqlite::types::Value::Real(value),
            None => rusqlite::types::Value::Null,
        },
    ];
    Ok(rusqlite::params_from_iter(values))
}

fn sql_text(value: String) -> rusqlite::types::Value {
    rusqlite::types::Value::Text(value)
}

fn sql_i64(value: i64) -> rusqlite::types::Value {
    rusqlite::types::Value::Integer(value)
}

fn sql_optional_text(value: Option<String>) -> rusqlite::types::Value {
    value.map(sql_text).unwrap_or(rusqlite::types::Value::Null)
}

fn normalize_required_text(value: Option<&Value>, field: &str) -> DomainResult<String> {
    read_optional_text(value).ok_or_else(|| {
        DomainStateError::bad_request(format!("{field} must be a non-empty string."))
    })
}

fn read_optional_text(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalize_object(value: Option<&Value>) -> Map<String, Value> {
    value
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

fn normalize_object_array(value: Option<&Value>) -> Vec<Value> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_object().cloned().map(Value::Object))
                .collect()
        })
        .unwrap_or_default()
}

fn normalize_string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn normalize_session_order_ids(value: Option<&Value>) -> DomainResult<Vec<String>> {
    let Some(items) = value.and_then(Value::as_array) else {
        return Err(DomainStateError::bad_request(
            "sessionIds must contain at least one session ID.",
        ));
    };
    if items.is_empty() {
        return Err(DomainStateError::bad_request(
            "sessionIds must contain at least one session ID.",
        ));
    }
    let mut seen = HashSet::new();
    let mut session_ids = Vec::new();
    for item in items {
        let Some(session_id) = item.as_str() else {
            return Err(DomainStateError::bad_request(format!(
                "Invalid sessionId: {item}."
            )));
        };
        if !is_gxserver_session_id(session_id) {
            return Err(DomainStateError::bad_request(format!(
                "Invalid sessionId: {session_id}."
            )));
        }
        if !seen.insert(session_id.to_string()) {
            return Err(DomainStateError::bad_request(format!(
                "Duplicate sessionId: {session_id}."
            )));
        }
        session_ids.push(session_id.to_string());
    }
    Ok(session_ids)
}

fn normalize_optional_sidebar_order(value: Option<&Value>) -> Option<i64> {
    let number = value.and_then(Value::as_f64)?;
    if number.is_finite() && number >= 0.0 {
        Some(number.floor() as i64)
    } else {
        None
    }
}

fn normalize_optional_session_tag(value: Option<&Value>) -> DomainResult<Option<String>> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() || value.as_str() == Some("") {
        return Ok(None);
    }
    let Some(tag) = value.as_str() else {
        return Err(DomainStateError::bad_request(
            "sessionTag must be a supported session tag.",
        ));
    };
    match tag {
        "favorite" | "high-priority" | "research" | "todo" | "in-progress" | "testing"
        | "blocked" | "low-priority" | "on-hold" | "done" | "bug" | "feature" | "design" => {
            Ok(Some(tag.to_string()))
        }
        _ => Err(DomainStateError::bad_request(
            "sessionTag must be a supported session tag.",
        )),
    }
}

fn normalize_session_kind(value: Option<&Value>) -> String {
    if value.and_then(Value::as_str) == Some("agent") {
        "agent".to_string()
    } else {
        "terminal".to_string()
    }
}

fn normalize_domain_lifecycle_state(value: Option<&Value>) -> String {
    match value.and_then(Value::as_str) {
        Some("running" | "sleeping" | "stopped" | "missing" | "unknown") => {
            value.unwrap().as_str().unwrap().to_string()
        }
        _ => "unknown".to_string(),
    }
}

fn normalize_provider_lifecycle_state(value: Option<&Value>) -> String {
    match value.and_then(Value::as_str) {
        Some("exists" | "missing" | "unknown") => value.unwrap().as_str().unwrap().to_string(),
        _ => "unknown".to_string(),
    }
}

fn resolve_surface(
    explicit: Option<&Value>,
    launch_settings: &Map<String, Value>,
    runtime_settings: &Map<String, Value>,
) -> String {
    for value in [
        explicit.and_then(Value::as_str),
        launch_settings.get("surface").and_then(Value::as_str),
        runtime_settings.get("surface").and_then(Value::as_str),
    ]
    .into_iter()
    .flatten()
    {
        if value == "commands" || value == "workspace" {
            return value.to_string();
        }
    }
    "workspace".to_string()
}

fn is_temporary_session_title(title: &str) -> bool {
    matches!(
        title.trim().to_ascii_lowercase().as_str(),
        "terminal session"
            | "search by text"
            | "codex session"
            | "codex cli session"
            | "claude session"
            | "claude code session"
            | "cursor session"
            | "cursor agent session"
    ) || title.trim().starts_with("Session ")
}

fn insert_optional_string(map: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        map.insert(key.to_string(), Value::String(value));
    }
}

fn set_optional_string(map: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        map.insert(key.to_string(), Value::String(value));
    } else {
        map.remove(key);
    }
}

fn insert_optional_object(map: &mut Map<String, Value>, key: &str, value: Map<String, Value>) {
    if !value.is_empty() {
        map.insert(key.to_string(), Value::Object(value));
    }
}

fn insert_parsed_optional_object(
    map: &mut Map<String, Value>,
    key: &str,
    value: &str,
    column: &str,
    row_kind: &str,
    row_id: &str,
) -> DomainResult<()> {
    let parsed = parse_object_map(value, column, row_kind, row_id)?;
    if !parsed.is_empty() {
        map.insert(key.to_string(), Value::Object(parsed));
    }
    Ok(())
}

fn update_object_field(next: &mut Map<String, Value>, input: &Map<String, Value>, key: &str) {
    if input.contains_key(key) {
        next.insert(
            key.to_string(),
            Value::Object(normalize_object(input.get(key))),
        );
    }
}

fn update_optional_object_field(
    next: &mut Map<String, Value>,
    input: &Map<String, Value>,
    key: &str,
) {
    if input.contains_key(key) {
        let value = normalize_object(input.get(key));
        if value.is_empty() {
            next.remove(key);
        } else {
            next.insert(key.to_string(), Value::Object(value));
        }
    }
}

fn update_object_array_field(next: &mut Map<String, Value>, input: &Map<String, Value>, key: &str) {
    if input.contains_key(key) {
        next.insert(
            key.to_string(),
            Value::Array(normalize_object_array(input.get(key))),
        );
    }
}

fn update_string_array_field(next: &mut Map<String, Value>, input: &Map<String, Value>, key: &str) {
    if input.contains_key(key) {
        next.insert(
            key.to_string(),
            Value::Array(
                normalize_string_array(input.get(key))
                    .into_iter()
                    .map(Value::String)
                    .collect(),
            ),
        );
    }
}

fn update_optional_text_field(
    next: &mut Map<String, Value>,
    input: &Map<String, Value>,
    key: &str,
) {
    if input.contains_key(key) {
        set_optional_string(next, key, read_optional_text(input.get(key)));
    }
}

fn parse_object(value: &str, column: &str, row_kind: &str, row_id: &str) -> DomainResult<Value> {
    Ok(Value::Object(parse_object_map(
        value, column, row_kind, row_id,
    )?))
}

fn parse_object_map(
    value: &str,
    column: &str,
    row_kind: &str,
    row_id: &str,
) -> DomainResult<Map<String, Value>> {
    let parsed = parse_json_column(value, column, row_kind, row_id)?;
    parsed
        .as_object()
        .cloned()
        .ok_or_else(|| corrupt_json_column(column, row_kind, row_id, "expected a JSON object"))
}

fn parse_object_array(
    value: &str,
    column: &str,
    row_kind: &str,
    row_id: &str,
) -> DomainResult<Value> {
    let parsed = parse_json_column(value, column, row_kind, row_id)?;
    let Some(items) = parsed.as_array() else {
        return Err(corrupt_json_column(
            column,
            row_kind,
            row_id,
            "expected a JSON array of objects",
        ));
    };
    let mut output = Vec::new();
    for (index, item) in items.iter().enumerate() {
        let Some(object) = item.as_object() else {
            return Err(corrupt_json_column(
                column,
                row_kind,
                row_id,
                &format!("expected object at array index {index}"),
            ));
        };
        output.push(Value::Object(object.clone()));
    }
    Ok(Value::Array(output))
}

fn parse_string_array(
    value: &str,
    column: &str,
    row_kind: &str,
    row_id: &str,
) -> DomainResult<Value> {
    let parsed = parse_json_column(value, column, row_kind, row_id)?;
    let Some(items) = parsed.as_array() else {
        return Err(corrupt_json_column(
            column,
            row_kind,
            row_id,
            "expected a JSON array of strings",
        ));
    };
    let mut output = Vec::new();
    for (index, item) in items.iter().enumerate() {
        let Some(text) = item
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            return Err(corrupt_json_column(
                column,
                row_kind,
                row_id,
                &format!("expected non-empty string at array index {index}"),
            ));
        };
        output.push(Value::String(text.to_string()));
    }
    Ok(Value::Array(output))
}

fn parse_json_column(
    value: &str,
    column: &str,
    row_kind: &str,
    row_id: &str,
) -> DomainResult<Value> {
    serde_json::from_str(value).map_err(|error| {
        corrupt_json_column(column, row_kind, row_id, &format!("invalid JSON ({error})"))
    })
}

fn corrupt_json_column(
    column: &str,
    row_kind: &str,
    row_id: &str,
    detail: &str,
) -> DomainStateError {
    DomainStateError::corrupt_state(format!(
        "Corrupt gxserver domain-state JSON in {row_kind} {row_id} column {column}: {detail}. Refusing to read or update the row so persisted state is not overwritten."
    ))
}

fn stringify_domain_json_field(field: &str, value: &Value) -> DomainResult<String> {
    assert_domain_json_depth(field, value, 0)?;
    let text = serde_json::to_string(value).map_err(|_| {
        DomainStateError::bad_request(format!("{field} must be JSON-serializable."))
    })?;
    if text.len() > JSON_LIMIT_CHARS {
        return Err(DomainStateError::bad_request(format!(
            "{field} exceeds the gxserver domain-state JSON size limit of {JSON_LIMIT_CHARS} characters."
        )));
    }
    Ok(text)
}

fn assert_domain_json_depth(field: &str, value: &Value, depth: usize) -> DomainResult<()> {
    if depth > JSON_MAX_DEPTH {
        return Err(DomainStateError::bad_request(format!(
            "{field} exceeds the gxserver domain-state JSON depth limit of {JSON_MAX_DEPTH}."
        )));
    }
    match value {
        Value::Array(items) => {
            for item in items {
                assert_domain_json_depth(field, item, depth + 1)?;
            }
        }
        Value::Object(object) => {
            for item in object.values() {
                assert_domain_json_depth(field, item, depth + 1)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn normalize_existing_directory_path(value: Option<&Value>, field: &str) -> DomainResult<String> {
    let path = normalize_required_text(value, field)?;
    let expanded = expand_user_path(&path);
    let normalized = Path::new(&expanded);
    if !normalized.is_absolute() {
        return Err(DomainStateError::bad_request(format!(
            "{field} must be an absolute path or start with ~/."
        )));
    }
    if !normalized.exists() {
        return Err(DomainStateError::not_found(format!(
            "{field} does not exist: {expanded}."
        )));
    }
    if !normalized.is_dir() {
        return Err(DomainStateError::bad_request(format!(
            "{field} is not a directory: {expanded}."
        )));
    }
    Ok(expanded)
}

fn expand_user_path(path: &str) -> String {
    if path == "~" {
        return env::var("HOME").unwrap_or_else(|_| path.to_string());
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = env::var_os("HOME") {
            return Path::new(&home).join(rest).to_string_lossy().to_string();
        }
    }
    path.to_string()
}

fn path_basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(path)
        .to_string()
}

fn read_string_field(value: &Value, key: &str) -> DomainResult<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| DomainStateError::corrupt_state(format!("{key} missing from domain state.")))
}

fn required_string(object: &Map<String, Value>, key: &str) -> DomainResult<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| DomainStateError::bad_request(format!("{key} must be a string.")))
}

fn optional_string(object: &Map<String, Value>, key: &str) -> Option<String> {
    object.get(key).and_then(Value::as_str).map(str::to_string)
}

fn bool_field(object: &Map<String, Value>, key: &str) -> bool {
    object.get(key).and_then(Value::as_bool) == Some(true)
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn sql_error(error: rusqlite::Error) -> DomainStateError {
    DomainStateError {
        code: "internalError",
        message: format!("SQLite domain-state error: {error}"),
    }
}

pub fn initialize_for_tests(db: &Connection) -> Result<()> {
    db.execute_batch("PRAGMA foreign_keys = ON;")
        .context("enable foreign keys")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        paths::get_gxserver_paths,
        storage::{initialize_gxserver_storage, open_gxserver_database},
    };

    fn open_test_database() -> (tempfile::TempDir, Connection) {
        let temp = tempfile::tempdir().expect("tempdir");
        let paths = get_gxserver_paths(Some(temp.path().to_path_buf()));
        initialize_gxserver_storage(&paths).expect("storage init");
        let db = open_gxserver_database(&paths).expect("open db");
        (temp, db)
    }

    #[test]
    fn rejects_domain_json_deeper_than_contract_limit() {
        let (_temp, db) = open_test_database();
        let repository = DomainRepository::new(&db, "S7k");
        let mut nested = json!("leaf");
        for _ in 0..12 {
            nested = json!({ "child": nested });
        }
        let params = json!({
            "name": "Deep JSON",
            "runtimeSettings": nested,
        });
        let error = repository
            .create_project(params.as_object().expect("params object"))
            .expect_err("deep JSON rejected");
        assert_eq!(error.code, "badRequest");
        assert!(error.message.contains("depth limit"));
    }

    #[test]
    fn maps_corrupt_project_json_to_corrupt_state() {
        let (_temp, db) = open_test_database();
        let repository = DomainRepository::new(&db, "S7k");
        let params = json!({ "name": "Corrupt JSON" });
        let project = repository
            .create_project(params.as_object().expect("params object"))
            .expect("project created");
        let project_id = project
            .get("projectId")
            .and_then(Value::as_str)
            .expect("project id");
        db.execute(
            "UPDATE projects SET runtimeSettingsJson = ?1 WHERE projectId = ?2",
            rusqlite::params!["{not-json", project_id],
        )
        .expect("corrupt project row");
        let error = repository
            .list_projects()
            .expect_err("corrupt row rejected");
        assert_eq!(error.code, "corruptState");
        assert!(error.message.contains("runtimeSettingsJson"));
    }
}
