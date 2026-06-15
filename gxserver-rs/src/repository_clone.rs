use std::{
    collections::HashMap,
    env, fmt, fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use serde_json::{json, Map, Value};
use tokio::{process::Command, sync::Mutex, time::timeout};
use uuid::Uuid;

use crate::{
    domain::DomainRepository,
    logging::{GxserverLogInput, GxserverLogger, LogLevel},
    paths::GxserverPaths,
    storage::open_gxserver_database,
};

const DEFAULT_REPOSITORY_HOST: &str = "github.com";
const REPOSITORY_CLONE_TIMEOUT_MS: u64 = 30 * 60_000;
const REPOSITORY_CLONE_OUTPUT_LIMIT_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct RepositoryCloneError {
    pub code: &'static str,
    pub message: String,
}

impl RepositoryCloneError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            code: "badRequest",
            message: message.into(),
        }
    }

    fn dependency_unavailable(message: impl Into<String>) -> Self {
        Self {
            code: "dependencyUnavailable",
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            code: "notFound",
            message: message.into(),
        }
    }
}

impl fmt::Display for RepositoryCloneError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.message.fmt(formatter)
    }
}

impl std::error::Error for RepositoryCloneError {}

#[derive(Clone, Default)]
pub struct RepositoryCloneJobManager {
    jobs: Arc<Mutex<HashMap<String, Value>>>,
}

#[derive(Clone)]
pub struct RepositoryCloneRuntime {
    pub logger: Arc<GxserverLogger>,
    pub paths: GxserverPaths,
    pub server_id: String,
}

#[derive(Debug)]
struct ParsedRepositoryCloneInput {
    clone_url: String,
    repository_name: String,
}

#[derive(Debug)]
struct CloneRunOutput {
    exit_code: i32,
    stderr: String,
    stdout: String,
}

/*
CDXC:GxserverRustPort 2026-06-16-00:49:
Phase 7 repository clone jobs remain gxserver-owned background work. Rust keeps the TypeScript preview/start/read/cancel lifecycle, rejects existing destinations before spawning Git, stores jobs in memory for initial parity, and writes only job ids plus booleans to persistent logs so clone URLs, branches, paths, argv, stdout, and stderr stay out of support bundles.
*/
pub async fn dispatch_repository_clone_endpoint(
    manager: RepositoryCloneJobManager,
    runtime: RepositoryCloneRuntime,
    endpoint_path: &str,
    params: &Map<String, Value>,
) -> Result<Value, RepositoryCloneError> {
    match endpoint_path {
        "/api/previewRepositoryClone" => {
            Ok(json!({ "preview": preview_repository_clone(params)? }))
        }
        "/api/startRepositoryClone" => Ok(json!({ "job": manager.start(runtime, params).await? })),
        "/api/readRepositoryCloneJob" => {
            Ok(json!({ "job": manager.read(params.get("jobId")).await? }))
        }
        "/api/cancelRepositoryCloneJob" => {
            Ok(json!({ "job": manager.cancel(params.get("jobId")).await? }))
        }
        _ => Err(RepositoryCloneError::not_found(format!(
            "{endpoint_path} is not a gxserver repository clone endpoint."
        ))),
    }
}

impl RepositoryCloneJobManager {
    async fn start(
        &self,
        runtime: RepositoryCloneRuntime,
        params: &Map<String, Value>,
    ) -> Result<Value, RepositoryCloneError> {
        let preview = preview_repository_clone(params)?;
        if preview
            .get("destinationExists")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return Err(RepositoryCloneError::bad_request(
                preview
                    .get("warning")
                    .and_then(Value::as_str)
                    .unwrap_or("Destination already exists.")
                    .to_string(),
            ));
        }
        let job_id = Uuid::new_v4().to_string();
        let job = json!({
            "jobId": job_id,
            "message": "Cloning repository.",
            "preview": preview,
            "startedAt": now_iso(),
            "state": "running",
        });
        self.jobs.lock().await.insert(job_id.clone(), job.clone());
        let jobs = self.jobs.clone();
        tokio::spawn(async move {
            run_clone_job(jobs, runtime, job_id).await;
        });
        Ok(job)
    }

    async fn read(&self, job_id: Option<&Value>) -> Result<Value, RepositoryCloneError> {
        let job_id = read_job_id(job_id)?;
        self.jobs.lock().await.get(&job_id).cloned().ok_or_else(|| {
            RepositoryCloneError::not_found(format!(
                "Repository clone job {job_id} does not exist."
            ))
        })
    }

    async fn cancel(&self, job_id: Option<&Value>) -> Result<Value, RepositoryCloneError> {
        let job_id = read_job_id(job_id)?;
        let mut jobs = self.jobs.lock().await;
        let job = jobs.get_mut(&job_id).ok_or_else(|| {
            RepositoryCloneError::not_found(format!(
                "Repository clone job {job_id} does not exist."
            ))
        })?;
        if job.get("state").and_then(Value::as_str) == Some("running") {
            if let Some(object) = job.as_object_mut() {
                object.insert("completedAt".to_string(), json!(now_iso()));
                object.insert("message".to_string(), json!("Repository clone canceled."));
                object.insert("state".to_string(), json!("canceled"));
            }
        }
        Ok(job.clone())
    }
}

async fn run_clone_job(
    jobs: Arc<Mutex<HashMap<String, Value>>>,
    runtime: RepositoryCloneRuntime,
    job_id: String,
) {
    let preview = {
        let jobs = jobs.lock().await;
        jobs.get(&job_id)
            .and_then(|job| job.get("preview"))
            .cloned()
            .unwrap_or_else(|| json!({}))
    };
    let branch_specified = preview.get("branchName").and_then(Value::as_str).is_some();
    let clone_main_only = preview
        .get("cloneMainOnly")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let shallow_clone = preview
        .get("shallowClone")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let _ = runtime.logger.log(GxserverLogInput {
        level: LogLevel::Info,
        event: "repositoryClone.started".to_string(),
        server_id: Some(runtime.server_id.clone()),
        request_id: None,
        client: None,
        duration_ms: None,
        error: None,
        details: Some(json!({
            "branchSpecified": branch_specified,
            "cloneMainOnly": clone_main_only,
            "jobId": job_id,
            "shallowClone": shallow_clone,
        })),
    });

    let args = build_repository_clone_git_args(&preview);
    let parent_path = preview
        .get("parentPath")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let clone_result = run_git_clone_process(args, parent_path).await;
    match clone_result {
        Ok(output) => {
            if job_is_canceled(&jobs, &job_id).await {
                return;
            }
            if output.exit_code != 0 {
                mark_job_failed(
                    &jobs,
                    &runtime,
                    &job_id,
                    output
                        .stderr
                        .clone()
                        .or_else(&output.stdout)
                        .or_else(&format!("git clone exited {}.", output.exit_code)),
                    Some(output),
                    "dependencyUnavailable",
                )
                .await;
                return;
            }
            mark_job_adding(&jobs, &job_id).await;
            match add_cloned_project(&runtime, &preview) {
                Ok(project) => {
                    let project_path = project
                        .get("path")
                        .and_then(Value::as_str)
                        .or_else(|| preview.get("destinationPath").and_then(Value::as_str))
                        .unwrap_or_default()
                        .to_string();
                    let mut jobs = jobs.lock().await;
                    if let Some(job) = jobs.get_mut(&job_id).and_then(Value::as_object_mut) {
                        job.insert("completedAt".to_string(), json!(now_iso()));
                        job.insert("exitCode".to_string(), json!(output.exit_code));
                        job.insert("message".to_string(), json!("Repository cloned."));
                        job.insert("project".to_string(), project.clone());
                        job.insert("projectPath".to_string(), json!(project_path));
                        job.insert("state".to_string(), json!("completed"));
                        job.insert("stderr".to_string(), json!(output.stderr));
                        job.insert("stdout".to_string(), json!(output.stdout));
                    }
                    let _ = runtime.logger.log(GxserverLogInput {
                        level: LogLevel::Info,
                        event: "repositoryClone.completed".to_string(),
                        server_id: Some(runtime.server_id.clone()),
                        request_id: None,
                        client: None,
                        duration_ms: None,
                        error: None,
                        details: Some(json!({
                            "jobId": job_id,
                            "projectId": project.get("projectId").and_then(Value::as_str),
                        })),
                    });
                }
                Err(error) => {
                    mark_job_failed(
                        &jobs,
                        &runtime,
                        &job_id,
                        error.to_string(),
                        Some(output),
                        "badRequest",
                    )
                    .await;
                }
            }
        }
        Err(error) => {
            if !job_is_canceled(&jobs, &job_id).await {
                mark_job_failed(&jobs, &runtime, &job_id, error.message, None, error.code).await;
            }
        }
    }
}

async fn mark_job_adding(jobs: &Arc<Mutex<HashMap<String, Value>>>, job_id: &str) {
    let mut jobs = jobs.lock().await;
    if let Some(job) = jobs.get_mut(job_id).and_then(Value::as_object_mut) {
        job.insert("message".to_string(), json!("Adding cloned repository."));
    }
}

async fn mark_job_failed(
    jobs: &Arc<Mutex<HashMap<String, Value>>>,
    runtime: &RepositoryCloneRuntime,
    job_id: &str,
    message: String,
    output: Option<CloneRunOutput>,
    error_code: &'static str,
) {
    {
        let mut jobs = jobs.lock().await;
        if let Some(job) = jobs.get_mut(job_id).and_then(Value::as_object_mut) {
            job.insert("completedAt".to_string(), json!(now_iso()));
            if let Some(output) = output {
                job.insert("exitCode".to_string(), json!(output.exit_code));
                job.insert("stderr".to_string(), json!(output.stderr));
                job.insert("stdout".to_string(), json!(output.stdout));
            }
            job.insert("error".to_string(), json!(message));
            job.insert(
                "message".to_string(),
                job.get("error")
                    .cloned()
                    .unwrap_or_else(|| json!("Repository clone failed.")),
            );
            job.insert("state".to_string(), json!("failed"));
        }
    }
    let _ = runtime.logger.log(GxserverLogInput {
        level: LogLevel::Warn,
        event: "repositoryClone.failed".to_string(),
        server_id: Some(runtime.server_id.clone()),
        request_id: None,
        client: None,
        duration_ms: None,
        error: None,
        details: Some(json!({
            "errorCode": error_code,
            "jobId": job_id,
        })),
    });
}

async fn job_is_canceled(jobs: &Arc<Mutex<HashMap<String, Value>>>, job_id: &str) -> bool {
    jobs.lock()
        .await
        .get(job_id)
        .and_then(|job| job.get("state"))
        .and_then(Value::as_str)
        == Some("canceled")
}

fn add_cloned_project(
    runtime: &RepositoryCloneRuntime,
    preview: &Value,
) -> Result<Value, RepositoryCloneError> {
    let destination_path = preview
        .get("destinationPath")
        .and_then(Value::as_str)
        .ok_or_else(|| RepositoryCloneError::bad_request("destinationPath is missing."))?;
    let normalized_path = normalize_existing_directory_path(
        Some(&Value::String(destination_path.to_string())),
        "destinationPath",
    )?;
    let db = open_gxserver_database(&runtime.paths)
        .map_err(|error| RepositoryCloneError::dependency_unavailable(error.to_string()))?;
    let repository = DomainRepository::new(&db, runtime.server_id.as_str());
    for project in repository
        .list_projects()
        .map_err(|error| RepositoryCloneError::dependency_unavailable(error.to_string()))?
    {
        if project.get("path").and_then(Value::as_str) == Some(normalized_path.as_str()) {
            return Ok(project);
        }
    }
    let mut params = Map::new();
    params.insert(
        "name".to_string(),
        preview
            .get("destinationFolderName")
            .cloned()
            .unwrap_or_else(|| json!("Repository")),
    );
    params.insert("path".to_string(), json!(normalized_path));
    repository
        .create_project(&params)
        .map_err(|error| RepositoryCloneError::dependency_unavailable(error.to_string()))
}

fn preview_repository_clone(params: &Map<String, Value>) -> Result<Value, RepositoryCloneError> {
    let repository_input = read_required_string(params.get("repositoryInput"), "repositoryInput")?;
    let parsed = parse_repository_clone_input(&repository_input)
        .ok_or_else(|| RepositoryCloneError::bad_request("Enter a Git repository to clone."))?;
    let parent_value = params
        .get("parentPath")
        .or_else(|| params.get("folderPath"));
    let parent_path = normalize_existing_directory_path(parent_value, "parentPath")?;
    let default_folder_name = normalize_repository_destination_folder_name(
        Some(&Value::String(parsed.repository_name.clone())),
        "repository",
    )?;
    let requested_folder = params
        .get("destinationFolderName")
        .or_else(|| params.get("newFolderName"));
    let destination_folder_name =
        normalize_repository_destination_folder_name(requested_folder, &default_folder_name)?;
    let destination_path =
        normalize_path_string(Path::new(&parent_path).join(&destination_folder_name));
    if !is_path_inside(&parent_path, &destination_path) || destination_path == parent_path {
        return Err(RepositoryCloneError::bad_request(
            "destinationFolderName must create a child folder inside parentPath.",
        ));
    }
    let destination = read_destination_status(&destination_path)?;
    let branch_name = normalize_repository_branch_name(params.get("branchName"))?;
    let mut preview = Map::new();
    if let Some(branch_name) = branch_name {
        preview.insert("branchName".to_string(), json!(branch_name));
    }
    preview.insert(
        "cloneMainOnly".to_string(),
        json!(params.get("cloneMainOnly").and_then(Value::as_bool) == Some(true)),
    );
    preview.insert("cloneUrl".to_string(), json!(parsed.clone_url));
    preview.insert("defaultFolderName".to_string(), json!(default_folder_name));
    preview.insert("destinationExists".to_string(), json!(destination.exists));
    if let Some(kind) = destination.kind.clone() {
        preview.insert("destinationExistsKind".to_string(), json!(kind));
    }
    preview.insert(
        "destinationFolderName".to_string(),
        json!(destination_folder_name),
    );
    if let Some(is_empty) = destination.is_empty {
        preview.insert("destinationIsEmpty".to_string(), json!(is_empty));
    }
    preview.insert(
        "destinationPath".to_string(),
        json!(destination_path.clone()),
    );
    preview.insert("parentPath".to_string(), json!(parent_path));
    preview.insert("repositoryName".to_string(), json!(parsed.repository_name));
    preview.insert(
        "shallowClone".to_string(),
        json!(params.get("shallowClone").and_then(Value::as_bool) == Some(true)),
    );
    if destination.exists {
        preview.insert(
            "warning".to_string(),
            json!(format!(
                "A {} already exists at {}. Choose a new folder name before cloning.",
                destination
                    .kind
                    .unwrap_or_else(|| "filesystem item".to_string()),
                destination_path
            )),
        );
    }
    Ok(Value::Object(preview))
}

fn build_repository_clone_git_args(preview: &Value) -> Vec<String> {
    let mut args = vec!["clone".to_string()];
    if let Some(branch) = preview.get("branchName").and_then(Value::as_str) {
        args.extend(["--branch".to_string(), branch.to_string()]);
    }
    if preview
        .get("cloneMainOnly")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        args.push("--single-branch".to_string());
    }
    if preview
        .get("shallowClone")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        args.extend(["--depth".to_string(), "1".to_string()]);
    }
    args.push(
        preview
            .get("cloneUrl")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    );
    args.push(
        preview
            .get("destinationFolderName")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    );
    args
}

async fn run_git_clone_process(
    args: Vec<String>,
    cwd: String,
) -> Result<CloneRunOutput, RepositoryCloneError> {
    let mut command = Command::new("git");
    command
        .args(args)
        .current_dir(cwd)
        .envs(repository_clone_environment())
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let child = command.spawn().map_err(|error| {
        RepositoryCloneError::dependency_unavailable(format!("Could not start git clone: {error}"))
    })?;
    let output = match timeout(
        Duration::from_millis(REPOSITORY_CLONE_TIMEOUT_MS),
        child.wait_with_output(),
    )
    .await
    {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => {
            return Err(RepositoryCloneError::dependency_unavailable(format!(
                "git clone failed: {error}"
            )))
        }
        Err(_) => {
            return Err(RepositoryCloneError::dependency_unavailable(format!(
                "git clone timed out after {REPOSITORY_CLONE_TIMEOUT_MS}ms."
            )))
        }
    };
    let stdout_len = output.stdout.len();
    let stderr_len = output.stderr.len();
    if stdout_len > REPOSITORY_CLONE_OUTPUT_LIMIT_BYTES {
        return Err(RepositoryCloneError::dependency_unavailable(format!(
            "git clone stdout exceeded {REPOSITORY_CLONE_OUTPUT_LIMIT_BYTES} bytes."
        )));
    }
    if stderr_len > REPOSITORY_CLONE_OUTPUT_LIMIT_BYTES {
        return Err(RepositoryCloneError::dependency_unavailable(format!(
            "git clone stderr exceeded {REPOSITORY_CLONE_OUTPUT_LIMIT_BYTES} bytes."
        )));
    }
    Ok(CloneRunOutput {
        exit_code: output.status.code().unwrap_or(1),
        stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
    })
}

fn repository_clone_environment() -> Vec<(String, String)> {
    let mut environment: Vec<(String, String)> = env::vars().collect();
    environment.retain(|(key, _)| {
        !matches!(
            key.as_str(),
            "ANSI_COLORS_DISABLED" | "NO_COLOR" | "NODE_DISABLE_COLORS"
        )
    });
    environment
}

fn parse_repository_clone_input(input: &str) -> Option<ParsedRepositoryCloneInput> {
    let token = extract_repository_input_token(input)?;
    if let Some((host, repository_path)) = token
        .strip_prefix("git@")
        .and_then(|rest| rest.split_once(':'))
    {
        let repository_path = normalize_repository_path(repository_path);
        if host.trim().is_empty() || repository_path.is_empty() {
            return None;
        }
        return Some(ParsedRepositoryCloneInput {
            clone_url: format!("git@{}:{repository_path}", host.trim()),
            repository_name: repository_name_from_path(&repository_path),
        });
    }
    if let Some(rest) = token.strip_prefix("ssh://") {
        let after_user = rest.split('@').last().unwrap_or(rest);
        let (host, path) = after_user.split_once('/')?;
        let repository_path = normalize_repository_path(path);
        if host.trim().is_empty() || repository_path.is_empty() {
            return None;
        }
        return Some(ParsedRepositoryCloneInput {
            clone_url: format!("ssh://git@{}/{repository_path}", host.trim()),
            repository_name: repository_name_from_path(&repository_path),
        });
    }
    if token.starts_with("http://") || token.starts_with("https://") || looks_like_host_path(&token)
    {
        let without_scheme = token
            .strip_prefix("https://")
            .or_else(|| token.strip_prefix("http://"))
            .unwrap_or(&token);
        let (host, path) = without_scheme.split_once('/')?;
        let repository_path = normalize_repository_path(path);
        if host.trim().is_empty() || repository_path.is_empty() || !host.contains('.') {
            return None;
        }
        return Some(ParsedRepositoryCloneInput {
            clone_url: format!("https://{}/{repository_path}", host.trim()),
            repository_name: repository_name_from_path(&repository_path),
        });
    }
    let shorthand_path = normalize_repository_path(&token);
    if shorthand_path.split('/').count() < 2 {
        return None;
    }
    Some(ParsedRepositoryCloneInput {
        clone_url: format!("https://{DEFAULT_REPOSITORY_HOST}/{shorthand_path}"),
        repository_name: repository_name_from_path(&shorthand_path),
    })
}

fn extract_repository_input_token(input: &str) -> Option<String> {
    let tokens: Vec<String> = input
        .split_whitespace()
        .map(clean_repository_input_token)
        .filter(|token| !token.is_empty())
        .collect();
    let gh_clone_index = tokens
        .windows(3)
        .position(|window| window == ["gh", "repo", "clone"]);
    if let Some(index) = gh_clone_index {
        return tokens[index + 3..]
            .iter()
            .find(|token| is_repository_like_token(token))
            .cloned();
    }
    tokens
        .into_iter()
        .find(|token| is_repository_like_token(token))
}

fn clean_repository_input_token(token: &str) -> String {
    token
        .trim()
        .trim_start_matches(['<', '(', '"', '\'', '`'])
        .trim_end_matches(['>', ')', ',', '.', '"', '\'', '`'])
        .to_string()
}

fn is_repository_like_token(token: &str) -> bool {
    !token.is_empty()
        && !token.starts_with('-')
        && (token.starts_with("git@")
            || token.starts_with("ssh://")
            || token.starts_with("http://")
            || token.starts_with("https://")
            || looks_like_host_path(token)
            || token.split('/').count() >= 2)
}

fn looks_like_host_path(token: &str) -> bool {
    token
        .split_once('/')
        .is_some_and(|(host, path)| host.contains('.') && !path.is_empty())
}

fn normalize_repository_path(repository_path: &str) -> String {
    let before_hash = repository_path.split('#').next().unwrap_or_default();
    let before_query = before_hash.split('?').next().unwrap_or_default();
    let mut segments: Vec<String> = Vec::new();
    for segment in before_query.split('/') {
        let segment = segment.trim();
        if segment.is_empty() {
            continue;
        }
        let lower = segment.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "-" | "branches"
                | "commit"
                | "commits"
                | "issues"
                | "pull"
                | "pulls"
                | "releases"
                | "src"
                | "tree"
                | "wiki"
        ) {
            break;
        }
        segments.push(segment.to_string());
    }
    let mut normalized = segments.join("/");
    if let Some(stripped) = normalized.strip_suffix(".git") {
        normalized = format!("{stripped}.git");
    } else if !normalized.is_empty() {
        normalized.push_str(".git");
    }
    normalized
}

fn repository_name_from_path(path: &str) -> String {
    path.split('/')
        .filter(|segment| !segment.is_empty())
        .next_back()
        .unwrap_or("repository")
        .trim_end_matches(".git")
        .to_string()
}

fn normalize_repository_destination_folder_name(
    input: Option<&Value>,
    fallback: &str,
) -> Result<String, RepositoryCloneError> {
    let raw_name = input
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback);
    let mut normalized = String::new();
    let mut previous_space = false;
    for ch in raw_name.chars() {
        if matches!(ch, '/' | ':' | '\\') {
            normalized.push('-');
            previous_space = false;
        } else if ch.is_whitespace() {
            if !previous_space {
                normalized.push(' ');
                previous_space = true;
            }
        } else {
            normalized.push(ch);
            previous_space = false;
        }
    }
    let normalized = normalized.trim().to_string();
    if normalized.is_empty() || normalized.chars().all(|ch| ch == '.') {
        return Err(RepositoryCloneError::bad_request(
            "newFolderName must be a valid folder name.",
        ));
    }
    Ok(normalized)
}

fn normalize_repository_branch_name(
    input: Option<&Value>,
) -> Result<Option<String>, RepositoryCloneError> {
    let Some(value) = input else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let branch_name = value
        .as_str()
        .ok_or_else(|| RepositoryCloneError::bad_request("branchName must be a string."))?;
    let branch_name = branch_name.trim();
    if branch_name.is_empty() {
        return Ok(None);
    }
    if !is_repository_branch_name_valid(branch_name) {
        return Err(RepositoryCloneError::bad_request(
            "branchName must be a valid Git branch name.",
        ));
    }
    Ok(Some(branch_name.to_string()))
}

fn is_repository_branch_name_valid(branch_name: &str) -> bool {
    branch_name.len() <= 255
        && branch_name != "@"
        && !branch_name.starts_with(['-', '/'])
        && !branch_name.ends_with(['/', '.'])
        && !branch_name.contains("..")
        && !branch_name.contains("@{")
        && !branch_name.chars().any(|ch| {
            ch.is_whitespace()
                || matches!(ch, '~' | '^' | ':' | '?' | '*' | '[' | '\\')
                || ch.is_control()
        })
        && branch_name.split('/').all(|segment| {
            !segment.is_empty() && !segment.starts_with('.') && !segment.ends_with(".lock")
        })
}

#[derive(Debug)]
struct DestinationStatus {
    exists: bool,
    is_empty: Option<bool>,
    kind: Option<String>,
}

fn read_destination_status(
    destination_path: &str,
) -> Result<DestinationStatus, RepositoryCloneError> {
    match fs::symlink_metadata(destination_path) {
        Ok(metadata) => {
            if metadata.is_dir() {
                let is_empty = fs::read_dir(destination_path)
                    .map_err(|error| RepositoryCloneError::bad_request(error.to_string()))?
                    .next()
                    .is_none();
                Ok(DestinationStatus {
                    exists: true,
                    is_empty: Some(is_empty),
                    kind: Some("directory".to_string()),
                })
            } else {
                Ok(DestinationStatus {
                    exists: true,
                    is_empty: None,
                    kind: Some(if metadata.is_file() { "file" } else { "other" }.to_string()),
                })
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(DestinationStatus {
            exists: false,
            is_empty: None,
            kind: None,
        }),
        Err(error) => Err(RepositoryCloneError::bad_request(error.to_string())),
    }
}

fn read_required_string(
    input: Option<&Value>,
    field: &str,
) -> Result<String, RepositoryCloneError> {
    let text = input.and_then(Value::as_str).map(str::trim).unwrap_or("");
    if text.is_empty() {
        return Err(RepositoryCloneError::bad_request(format!(
            "{field} must be a non-empty string."
        )));
    }
    Ok(text.to_string())
}

fn read_job_id(input: Option<&Value>) -> Result<String, RepositoryCloneError> {
    read_required_string(input, "jobId")
}

fn normalize_existing_directory_path(
    input: Option<&Value>,
    field: &str,
) -> Result<String, RepositoryCloneError> {
    let path = normalize_absolute_path(input, field)?;
    let metadata = fs::metadata(&path)
        .map_err(|_| RepositoryCloneError::not_found(format!("{field} does not exist: {path}")))?;
    if metadata.is_dir() {
        Ok(path)
    } else {
        Err(RepositoryCloneError::bad_request(format!(
            "{field} is not a directory: {path}"
        )))
    }
}

fn normalize_absolute_path(
    input: Option<&Value>,
    field: &str,
) -> Result<String, RepositoryCloneError> {
    let text = input.and_then(Value::as_str).map(str::trim).unwrap_or("");
    if text.is_empty() {
        return Err(RepositoryCloneError::bad_request(format!(
            "{field} must be a non-empty path."
        )));
    }
    let expanded = expand_user_path(text);
    if !expanded.is_absolute() {
        return Err(RepositoryCloneError::bad_request(format!(
            "{field} must be an absolute path or start with ~/"
        )));
    }
    Ok(normalize_path_string(expanded))
}

fn expand_user_path(input: &str) -> PathBuf {
    if input == "~" {
        return home_dir();
    }
    if let Some(rest) = input.strip_prefix("~/") {
        return home_dir().join(rest);
    }
    PathBuf::from(input)
}

fn home_dir() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn normalize_path_string(path: impl AsRef<Path>) -> String {
    path.as_ref()
        .components()
        .collect::<PathBuf>()
        .to_string_lossy()
        .to_string()
}

fn is_path_inside(parent_path: &str, candidate_path: &str) -> bool {
    let parent = Path::new(parent_path);
    let candidate = Path::new(candidate_path);
    parent == candidate || candidate.starts_with(parent)
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

trait NonEmptyString {
    fn or_else(self, fallback: &str) -> String;
}

impl NonEmptyString for String {
    fn or_else(self, fallback: &str) -> String {
        if self.is_empty() {
            fallback.to_string()
        } else {
            self
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn preview_repository_clone_normalizes_github_browser_url() {
        let dir = tempdir().unwrap();
        let mut params = Map::new();
        params.insert(
            "repositoryInput".to_string(),
            json!("https://github.com/factory-ai/ghostex/tree/main"),
        );
        params.insert(
            "parentPath".to_string(),
            json!(dir.path().to_string_lossy()),
        );
        params.insert("shallowClone".to_string(), json!(true));
        let preview = preview_repository_clone(&params).unwrap();
        assert_eq!(
            preview.get("cloneUrl").and_then(Value::as_str),
            Some("https://github.com/factory-ai/ghostex.git")
        );
        assert_eq!(
            preview.get("destinationFolderName").and_then(Value::as_str),
            Some("ghostex")
        );
        assert_eq!(
            preview.get("shallowClone").and_then(Value::as_bool),
            Some(true)
        );
    }

    #[test]
    fn preview_rejects_existing_destination() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("repo")).unwrap();
        let mut params = Map::new();
        params.insert("repositoryInput".to_string(), json!("owner/repo"));
        params.insert(
            "parentPath".to_string(),
            json!(dir.path().to_string_lossy()),
        );
        let preview = preview_repository_clone(&params).unwrap();
        assert_eq!(
            preview.get("destinationExists").and_then(Value::as_bool),
            Some(true)
        );
        assert!(preview
            .get("warning")
            .and_then(Value::as_str)
            .unwrap()
            .contains("already exists"));
    }

    #[test]
    fn repository_branch_validation_matches_clone_contract() {
        assert!(is_repository_branch_name_valid("feature/demo"));
        assert!(!is_repository_branch_name_valid("../bad"));
        assert!(!is_repository_branch_name_valid("bad branch"));
    }
}
