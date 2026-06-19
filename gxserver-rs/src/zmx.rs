use std::{
    collections::HashMap,
    io::{Read, Write},
    path::Path,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

use serde_json::{json, Map, Value};

use crate::{
    constants::GXSERVER_PROTOCOL_VERSION,
    domain::{read_project_id, read_session_id, DomainRepository, DomainStateError},
    toolchain::{require_bundled_zmx, GxserverResolvedTool},
};

const ZMX_LIFECYCLE_COMMAND_TIMEOUT_MS: u64 = 5_000;
pub const GXSERVER_ZMX_COMMAND_STDOUT_LIMIT_BYTES: usize = 512 * 1024;
pub const GXSERVER_ZMX_COMMAND_STDERR_LIMIT_BYTES: usize = 64 * 1024;
pub const GXSERVER_ZMX_HISTORY_STDOUT_LIMIT_BYTES: usize = 256 * 1024;
pub const GXSERVER_ZMX_SEND_TEXT_LIMIT_BYTES: usize = 512 * 1024;

#[derive(Clone)]
pub struct ZmxServerContext {
    pub auth_token_file: String,
    pub base_url: String,
}

pub struct ZmxEndpointOutput {
    pub result: Value,
    pub presentation_session: Option<(String, String)>,
}

#[derive(Debug)]
pub enum ZmxEndpointError {
    DependencyUnavailable(String),
    Domain(DomainStateError),
}

impl From<DomainStateError> for ZmxEndpointError {
    fn from(error: DomainStateError) -> Self {
        Self::Domain(error)
    }
}

type ZmxEndpointResult<T> = Result<T, ZmxEndpointError>;

#[derive(Clone, Debug, Default)]
struct ZmxCommandOptions {
    allow_stdout_truncation: bool,
    stderr_limit_bytes: Option<usize>,
    stdin: Option<String>,
    stdout_limit_bytes: Option<usize>,
    timeout_ms: Option<u64>,
}

#[derive(Clone, Debug)]
struct ZmxCommandResult {
    exit_code: i32,
    stderr: String,
    stdout: String,
    stdout_truncated: bool,
}

#[derive(Clone, Debug)]
struct ProviderProbe {
    error: Option<String>,
    lifecycle_state: String,
    probed_at: String,
    zmx_name: String,
}

#[derive(Clone, Debug)]
struct ProviderKill {
    error: Option<String>,
    exit_code: i32,
    killed: bool,
    stderr: String,
    stdout: String,
    zmx_name: String,
}

struct LifecycleParams {
    project_id: String,
    session_id: String,
}

/*
CDXC:GxserverRustPort 2026-06-15-18:06:
Phase 5 Rust must own zmx-backed lifecycle and session I/O through Ghostex-managed zmx artifacts only. Keep command builders explicit, pass user send text through stdin, cap subprocess output, and never add PATH fallback or automatic listener-port fallback.
*/
pub fn dispatch_zmx_lifecycle_endpoint(
    repository: &DomainRepository<'_>,
    endpoint_path: &str,
    params: &Map<String, Value>,
    context: &ZmxServerContext,
) -> ZmxEndpointResult<ZmxEndpointOutput> {
    let result = match endpoint_path {
        "/api/probeSessionProvider" => {
            let lifecycle = read_lifecycle_params(params)?;
            let (probe, session, _, _) = probe_and_cache_session_provider(repository, &lifecycle)?;
            json!({
                "provider": "zmx",
                "providerState": probe_to_value(&probe),
                "session": session,
            })
        }
        "/api/attachSessionMetadata" | "/api/wakeSession" => {
            let mut attach = create_attach_session_metadata(repository, params, context)?;
            let restore_blocked = attach.get("restoreBlocked").is_some();
            if endpoint_path == "/api/wakeSession" && !restore_blocked {
                let attach_session = attach
                    .get("session")
                    .cloned()
                    .ok_or_else(|| DomainStateError::corrupt_state("Attach session missing."))?;
                let provider_state = attach_session
                    .get("providerState")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                let mut update = Map::new();
                update.insert(
                    "projectId".to_string(),
                    value_field(&attach_session, "projectId")?,
                );
                update.insert(
                    "sessionId".to_string(),
                    value_field(&attach_session, "sessionId")?,
                );
                update.insert("lifecycleState".to_string(), json!("running"));
                update.insert("providerState".to_string(), provider_state);
                let session = repository.update_session_for_lifecycle(&update)?;
                attach
                    .as_object_mut()
                    .expect("attach object")
                    .insert("session".to_string(), session.clone());
                json!({ "attach": attach, "session": session })
            } else if endpoint_path == "/api/wakeSession" {
                let session = attach
                    .get("session")
                    .cloned()
                    .ok_or_else(|| DomainStateError::corrupt_state("Attach session missing."))?;
                json!({ "attach": attach, "session": session })
            } else {
                json!({ "attach": attach })
            }
        }
        "/api/startSessionProvider" => start_session_provider(repository, params, context)?,
        "/api/transitionSession" => {
            let lifecycle = read_lifecycle_params(params)?;
            let action = match params.get("action").and_then(Value::as_str) {
                Some("close") => "close",
                Some("sleep") => "sleep",
                _ => {
                    return Err(DomainStateError::bad_request(format!(
                        "Invalid session transition action: {}.",
                        params
                            .get("action")
                            .map(Value::to_string)
                            .unwrap_or_else(|| "undefined".to_string())
                    ))
                    .into())
                }
            };
            let target_lifecycle = if action == "sleep" {
                "sleeping"
            } else {
                "stopped"
            };
            let (kill, session) =
                kill_and_cache_session_provider(repository, &lifecycle, target_lifecycle)?;
            json!({
                "action": action,
                "session": session,
                "transition": {
                    "kill": kill_to_value(&kill),
                    "session": session,
                },
            })
        }
        "/api/sleepSession" | "/api/killSession" => {
            let lifecycle = read_lifecycle_params(params)?;
            let target_lifecycle = if endpoint_path == "/api/sleepSession" {
                "sleeping"
            } else {
                "stopped"
            };
            let (kill, session) =
                kill_and_cache_session_provider(repository, &lifecycle, target_lifecycle)?;
            json!({ "kill": kill_to_value(&kill), "session": session })
        }
        _ => {
            return Err(DomainStateError::not_found(format!(
                "{endpoint_path} is not a gxserver zmx lifecycle endpoint."
            ))
            .into())
        }
    };
    let presentation_session = session_target_from_lifecycle_result(&result);
    Ok(ZmxEndpointOutput {
        result,
        presentation_session,
    })
}

pub fn dispatch_zmx_session_interaction_endpoint(
    repository: &DomainRepository<'_>,
    endpoint_path: &str,
    params: &Map<String, Value>,
) -> ZmxEndpointResult<Value> {
    let zmx = require_zmx()?;
    let lifecycle = read_lifecycle_params(params)?;
    let session = require_session(repository, &lifecycle)?;
    let zmx_name = provider_zmx_session_name(&session)?;
    match endpoint_path {
        "/api/readSessionText" => {
            let result = run_zmx_interaction_command(
                build_zmx_history_command(&zmx_name, &zmx.executable_path),
                ZmxCommandOptions {
                    allow_stdout_truncation: true,
                    stdout_limit_bytes: Some(GXSERVER_ZMX_HISTORY_STDOUT_LIMIT_BYTES),
                    ..ZmxCommandOptions::default()
                },
            )?;
            let mut output = Map::new();
            output.insert(
                "capturedBytes".to_string(),
                json!(result.stdout.as_bytes().len()),
            );
            output.insert(
                "limitBytes".to_string(),
                json!(GXSERVER_ZMX_HISTORY_STDOUT_LIMIT_BYTES),
            );
            output.insert("provider".to_string(), json!("zmx"));
            output.insert("session".to_string(), session);
            output.insert("source".to_string(), json!("history"));
            output.insert("text".to_string(), Value::String(result.stdout));
            output.insert(
                "truncated".to_string(),
                Value::Bool(result.stdout_truncated),
            );
            if result.stdout_truncated {
                output.insert(
                    "truncatedReason".to_string(),
                    json!("historyOutputLimitExceeded"),
                );
            }
            output.insert("zmxName".to_string(), Value::String(zmx_name));
            Ok(Value::Object(output))
        }
        "/api/sendSessionText" => {
            let text = read_interaction_text(params.get("text"), "sendSessionText")?;
            let result = run_zmx_interaction_command(
                build_zmx_send_command(&zmx_name, &zmx.executable_path),
                ZmxCommandOptions {
                    stdin: Some(text.clone()),
                    ..ZmxCommandOptions::default()
                },
            )?;
            Ok(send_result(
                result.exit_code,
                session,
                &text,
                false,
                zmx_name,
            ))
        }
        "/api/sendSessionEnter" => {
            let result = run_zmx_interaction_command(
                build_zmx_send_command(&zmx_name, &zmx.executable_path),
                ZmxCommandOptions {
                    stdin: Some("\r".to_string()),
                    ..ZmxCommandOptions::default()
                },
            )?;
            Ok(send_result(
                result.exit_code,
                session,
                "\r",
                false,
                zmx_name,
            ))
        }
        "/api/sendSessionMessage" => {
            let text = read_interaction_text(params.get("text"), "sendSessionMessage")?;
            let submit = params.get("submit").and_then(Value::as_bool) != Some(false);
            let payload = if submit {
                format!("{text}\r")
            } else {
                text.clone()
            };
            let result = run_zmx_interaction_command(
                build_zmx_send_command(&zmx_name, &zmx.executable_path),
                ZmxCommandOptions {
                    stdin: Some(payload),
                    ..ZmxCommandOptions::default()
                },
            )?;
            let mut value = send_result(result.exit_code, session, &text, false, zmx_name);
            value
                .as_object_mut()
                .expect("send result object")
                .insert("submit".to_string(), Value::Bool(submit));
            Ok(value)
        }
        _ => Err(DomainStateError::not_found(format!(
            "{endpoint_path} is not a gxserver zmx session interaction endpoint."
        ))
        .into()),
    }
}

pub fn prepare_focus_session_renderer_command(
    repository: &DomainRepository<'_>,
    params: &Map<String, Value>,
) -> ZmxEndpointResult<(Value, Map<String, Value>)> {
    let lifecycle = read_lifecycle_params(params)?;
    let session = require_session(repository, &lifecycle)?;
    let mut payload = params.clone();
    payload.insert("projectId".to_string(), json!(lifecycle.project_id));
    payload.insert("sessionId".to_string(), json!(lifecycle.session_id));
    Ok((session, payload))
}

pub fn merge_session_with_renderer_result(session: Value, result: Value) -> Value {
    let mut output = result.as_object().cloned().unwrap_or_default();
    output.insert("session".to_string(), session);
    Value::Object(output)
}

fn send_result(
    exit_code: i32,
    session: Value,
    text: &str,
    _submit: bool,
    zmx_name: String,
) -> Value {
    json!({
        "exitCode": exit_code,
        "provider": "zmx",
        "session": session,
        "textBytes": text.as_bytes().len(),
        "textLength": text.chars().count(),
        "zmxName": zmx_name,
    })
}

fn create_attach_session_metadata(
    repository: &DomainRepository<'_>,
    params: &Map<String, Value>,
    context: &ZmxServerContext,
) -> ZmxEndpointResult<Value> {
    let lifecycle = read_lifecycle_params(params)?;
    let project = repository
        .get_project(&lifecycle.project_id)?
        .ok_or_else(|| {
            DomainStateError::not_found(format!("Project {} does not exist.", lifecycle.project_id))
        })?;
    let existing_session = require_session(repository, &lifecycle)?;
    let cwd = string_field(&existing_session, "cwd").or_else(|| string_field(&project, "path"));
    let (probe, probed_session, zmx, zmx_name) =
        probe_and_cache_session_provider(repository, &lifecycle)?;
    let explicit_startup_text = normalize_optional_startup_text(params.get("startupText"));
    let queued_launch_startup_text = if explicit_startup_text.is_none() {
        get_queued_agent_launch_startup_text_for_session(&probed_session)
    } else {
        None
    };
    let startup_text = explicit_startup_text
        .clone()
        .or(queued_launch_startup_text.clone())
        .or_else(|| get_agent_startup_text_for_session(&project, &probed_session));
    let startup_text_disposition =
        decide_startup_text_disposition(&probe.lifecycle_state, startup_text.as_deref());
    let session_for_attach = if explicit_startup_text.is_none()
        && (queued_launch_startup_text.is_some() || probe.lifecycle_state == "exists")
    {
        consume_queued_agent_launch_startup_text(repository, &probed_session)?
    } else {
        probed_session.clone()
    };
    if probe.lifecycle_state == "missing" && !cwd.as_deref().map(cwd_exists).unwrap_or(false) {
        let mut restore_blocked = Map::new();
        if let Some(cwd) = cwd.clone() {
            restore_blocked.insert("cwd".to_string(), Value::String(cwd));
        }
        restore_blocked.insert("reason".to_string(), json!("missingCwd"));
        let mut attach = Map::new();
        attach.insert("provider".to_string(), json!("zmx"));
        attach.insert("providerState".to_string(), probe_to_value(&probe));
        attach.insert("restoreBlocked".to_string(), Value::Object(restore_blocked));
        attach.insert("session".to_string(), session_for_attach);
        maybe_insert_startup_text(
            &mut attach,
            &startup_text_disposition,
            startup_text.as_deref(),
        );
        attach.insert(
            "startupTextDisposition".to_string(),
            Value::String(startup_text_disposition),
        );
        attach.insert("zmxName".to_string(), Value::String(zmx_name));
        return Ok(Value::Object(attach));
    }

    let attach_command = build_zmx_attach_command(ZmxAttachCommandInput {
        cwd: cwd.clone().unwrap_or_default(),
        global_session_ref: string_field(&probed_session, "globalRef"),
        gxserver_auth_token_file: Some(context.auth_token_file.clone()),
        gxserver_base_url: Some(context.base_url.clone()),
        gxserver_protocol_version: Some(GXSERVER_PROTOCOL_VERSION),
        prompt_editor: (params.get("promptEditor").and_then(Value::as_str) == Some("monaco"))
            .then_some("monaco".to_string()),
        session_name: zmx_name.clone(),
        title: string_field(&session_for_attach, "title"),
        zmx_executable_path: zmx.executable_path,
    });
    let mut attach = Map::new();
    attach.insert("attachCommand".to_string(), Value::String(attach_command));
    if let Some(cwd) = cwd {
        attach.insert("cwd".to_string(), Value::String(cwd));
    }
    attach.insert(
        "persistenceSessionCreated".to_string(),
        Value::Bool(probe.lifecycle_state == "missing"),
    );
    attach.insert("provider".to_string(), json!("zmx"));
    attach.insert("providerState".to_string(), probe_to_value(&probe));
    attach.insert("session".to_string(), session_for_attach);
    maybe_insert_startup_text(
        &mut attach,
        &startup_text_disposition,
        startup_text.as_deref(),
    );
    attach.insert(
        "startupTextDisposition".to_string(),
        Value::String(startup_text_disposition),
    );
    attach.insert("zmxName".to_string(), Value::String(zmx_name));
    Ok(Value::Object(attach))
}

fn start_session_provider(
    repository: &DomainRepository<'_>,
    params: &Map<String, Value>,
    context: &ZmxServerContext,
) -> ZmxEndpointResult<Value> {
    let lifecycle = read_lifecycle_params(params)?;
    let project = repository
        .get_project(&lifecycle.project_id)?
        .ok_or_else(|| {
            DomainStateError::not_found(format!("Project {} does not exist.", lifecycle.project_id))
        })?;
    let (probe, probed_session, zmx, zmx_name) =
        probe_and_cache_session_provider(repository, &lifecycle)?;
    let explicit_startup_text = normalize_optional_startup_text(params.get("startupText"));
    let queued_launch_startup_text = if explicit_startup_text.is_none() {
        get_queued_agent_launch_startup_text_for_session(&probed_session)
    } else {
        None
    };
    let startup_text = explicit_startup_text
        .clone()
        .or(queued_launch_startup_text)
        .or_else(|| get_agent_startup_text_for_session(&project, &probed_session));
    let startup_text_disposition =
        decide_startup_text_disposition(&probe.lifecycle_state, startup_text.as_deref());
    let should_start_with_startup_text =
        startup_text_disposition == "queueAfterTerminalReady" && startup_text.is_some();
    let should_start_plain_terminal = probe.lifecycle_state == "missing"
        && startup_text_disposition == "none"
        && string_field(&probed_session, "kind").as_deref() == Some("terminal");
    if !should_start_with_startup_text && !should_start_plain_terminal {
        return Ok(json!({
            "provider": "zmx",
            "providerState": probe_to_value(&probe),
            "session": if explicit_startup_text.is_none() && has_queued_agent_launch_startup_text(&probed_session) {
                consume_queued_agent_launch_startup_text(repository, &probed_session)?
            } else {
                probed_session
            },
            "started": false,
            "startupTextDisposition": startup_text_disposition,
            "zmxName": zmx_name,
        }));
    }
    let cwd = string_field(&probed_session, "cwd").or_else(|| string_field(&project, "path"));
    let Some(cwd) = cwd.filter(|path| cwd_exists(path)) else {
        return Err(ZmxEndpointError::DependencyUnavailable(
            "Cannot start session provider because the project directory is missing.".to_string(),
        ));
    };
    let command = if should_start_with_startup_text {
        build_zmx_run_command(ZmxRunCommandInput {
            cwd,
            global_session_ref: string_field(&probed_session, "globalRef"),
            gxserver_auth_token_file: Some(context.auth_token_file.clone()),
            gxserver_base_url: Some(context.base_url.clone()),
            gxserver_protocol_version: Some(GXSERVER_PROTOCOL_VERSION),
            session_name: zmx_name.clone(),
            startup_text: startup_text.unwrap_or_default(),
            zmx_executable_path: zmx.executable_path,
        })
    } else {
        build_zmx_shell_provider_command(ZmxShellProviderCommandInput {
            cwd,
            global_session_ref: string_field(&probed_session, "globalRef"),
            gxserver_auth_token_file: Some(context.auth_token_file.clone()),
            gxserver_base_url: Some(context.base_url.clone()),
            gxserver_protocol_version: Some(GXSERVER_PROTOCOL_VERSION),
            session_name: zmx_name.clone(),
            zmx_executable_path: zmx.executable_path,
        })
    };
    let result = run_zmx_interaction_command(command, ZmxCommandOptions::default())?;
    let provider_state = ProviderProbe {
        error: None,
        lifecycle_state: "exists".to_string(),
        probed_at: now_iso(),
        zmx_name: zmx_name.clone(),
    };
    let mut update = Map::new();
    update.insert("projectId".to_string(), json!(lifecycle.project_id));
    update.insert("sessionId".to_string(), json!(lifecycle.session_id));
    update.insert("lifecycleState".to_string(), json!("running"));
    update.insert(
        "providerState".to_string(),
        Value::Object(provider_state_patch(&probed_session, &provider_state)?),
    );
    if explicit_startup_text.is_none() {
        if let Some(launch_settings) =
            launch_settings_with_consumed_agent_launch_startup_text(&probed_session)
        {
            update.insert("launchSettings".to_string(), Value::Object(launch_settings));
        }
    }
    let session = repository.update_session_for_lifecycle(&update)?;
    Ok(json!({
        "exitCode": result.exit_code,
        "provider": "zmx",
        "providerState": probe_to_value(&provider_state),
        "session": session,
        "started": true,
        "startupTextDisposition": startup_text_disposition,
        "zmxName": zmx_name,
    }))
}

fn probe_and_cache_session_provider(
    repository: &DomainRepository<'_>,
    lifecycle: &LifecycleParams,
) -> ZmxEndpointResult<(ProviderProbe, Value, GxserverResolvedTool, String)> {
    let session = require_session(repository, lifecycle)?;
    let zmx = require_zmx()?;
    let zmx_name = provider_zmx_session_name(&session)?;
    let probe = probe_zmx_session(&zmx_name, &zmx.executable_path);
    let lifecycle_state = reconcile_domain_lifecycle_from_provider_probe(
        string_field(&session, "lifecycleState")
            .as_deref()
            .unwrap_or("unknown"),
        &probe.lifecycle_state,
    );
    let mut update = Map::new();
    update.insert("projectId".to_string(), json!(lifecycle.project_id));
    update.insert("sessionId".to_string(), json!(lifecycle.session_id));
    update.insert("lifecycleState".to_string(), json!(lifecycle_state));
    update.insert(
        "providerState".to_string(),
        Value::Object(provider_state_patch(&session, &probe)?),
    );
    let updated = repository.update_session_for_lifecycle(&update)?;
    Ok((probe, updated, zmx, zmx_name))
}

fn kill_and_cache_session_provider(
    repository: &DomainRepository<'_>,
    lifecycle: &LifecycleParams,
    lifecycle_state: &str,
) -> ZmxEndpointResult<(ProviderKill, Value)> {
    let session = require_session(repository, lifecycle)?;
    let zmx = require_zmx()?;
    let zmx_name = provider_zmx_session_name(&session)?;
    let kill = kill_zmx_session(&zmx_name, &zmx.executable_path);
    let timestamp = now_iso();
    let provider_state = if kill.killed {
        missing_provider_state_patch(&session, &timestamp)?
    } else {
        failed_kill_provider_state_patch(&session, &kill, &timestamp)?
    };
    let mut update = Map::new();
    update.insert("projectId".to_string(), json!(lifecycle.project_id));
    update.insert("sessionId".to_string(), json!(lifecycle.session_id));
    update.insert(
        "lifecycleState".to_string(),
        json!(if kill.killed {
            lifecycle_state
        } else {
            "unknown"
        }),
    );
    update.insert("providerState".to_string(), Value::Object(provider_state));
    let updated = repository.update_session_for_lifecycle(&update)?;
    Ok((kill, updated))
}

fn probe_zmx_session(session_name: &str, zmx_executable_path: &str) -> ProviderProbe {
    let probed_at = now_iso();
    let result = run_zsh_script(
        build_zmx_exists_command(session_name, zmx_executable_path),
        ZmxCommandOptions::default(),
    );
    let result = match result {
        Ok(result) => result,
        Err(error) => {
            return ProviderProbe {
                error: Some(format!("zmx probe command failed: {error}")),
                lifecycle_state: "unknown".to_string(),
                probed_at,
                zmx_name: session_name.to_string(),
            }
        }
    };
    let lifecycle_state = if result.exit_code == 0 {
        "exists"
    } else if result.exit_code == 1 {
        "missing"
    } else {
        "unknown"
    };
    ProviderProbe {
        error: (lifecycle_state == "unknown").then(|| zmx_probe_exit_error_message(&result)),
        lifecycle_state: lifecycle_state.to_string(),
        probed_at,
        zmx_name: session_name.to_string(),
    }
}

fn kill_zmx_session(session_name: &str, zmx_executable_path: &str) -> ProviderKill {
    let result = run_zsh_script(
        build_zmx_kill_command(session_name, zmx_executable_path),
        ZmxCommandOptions::default(),
    );
    let result = match result {
        Ok(result) => result,
        Err(error) => {
            let message = format!("zmx kill command failed: {error}");
            return ProviderKill {
                error: Some(message.clone()),
                exit_code: 1,
                killed: false,
                stderr: message,
                stdout: String::new(),
                zmx_name: session_name.to_string(),
            };
        }
    };
    let killed = result.exit_code == 0;
    ProviderKill {
        error: (!killed).then(|| {
            if result.stderr.is_empty() {
                format!("exit-{}", result.exit_code)
            } else {
                result.stderr.clone()
            }
        }),
        exit_code: result.exit_code,
        killed,
        stderr: result.stderr,
        stdout: result.stdout,
        zmx_name: session_name.to_string(),
    }
}

fn run_zmx_interaction_command(
    script: String,
    options: ZmxCommandOptions,
) -> ZmxEndpointResult<ZmxCommandResult> {
    let allow_stdout_truncation = options.allow_stdout_truncation;
    let result =
        run_zsh_script(script, options).map_err(ZmxEndpointError::DependencyUnavailable)?;
    if result.exit_code != 0 && !(allow_stdout_truncation && result.stdout_truncated) {
        let message = if !result.stderr.is_empty() {
            result.stderr.clone()
        } else if !result.stdout.is_empty() {
            result.stdout.clone()
        } else {
            format!(
                "zmx session interaction command exited {}",
                result.exit_code
            )
        };
        return Err(ZmxEndpointError::DependencyUnavailable(message));
    }
    Ok(result)
}

fn run_zsh_script(script: String, options: ZmxCommandOptions) -> Result<ZmxCommandResult, String> {
    run_zsh_script_blocking(&script, options)
}

fn run_zsh_script_blocking(
    script: &str,
    options: ZmxCommandOptions,
) -> Result<ZmxCommandResult, String> {
    let mut child = Command::new("/bin/zsh")
        .arg("-lc")
        .arg(script)
        .envs(build_gxserver_zmx_child_environment())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        let input = options.stdin.clone().unwrap_or_default();
        let _ = stdin.write_all(input.as_bytes());
    }
    let terminate = Arc::new(AtomicBool::new(false));
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "missing zmx stdout pipe".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "missing zmx stderr pipe".to_string())?;
    let stdout_limit = options
        .stdout_limit_bytes
        .unwrap_or(GXSERVER_ZMX_COMMAND_STDOUT_LIMIT_BYTES);
    let stderr_limit = options
        .stderr_limit_bytes
        .unwrap_or(GXSERVER_ZMX_COMMAND_STDERR_LIMIT_BYTES);
    let stdout_terminate = terminate.clone();
    let stderr_terminate = terminate.clone();
    let stdout_thread = thread::spawn(move || read_capped(stdout, stdout_limit, stdout_terminate));
    let stderr_thread = thread::spawn(move || read_capped(stderr, stderr_limit, stderr_terminate));

    let timeout = Duration::from_millis(
        options
            .timeout_ms
            .unwrap_or(ZMX_LIFECYCLE_COMMAND_TIMEOUT_MS),
    );
    let started = Instant::now();
    let mut timed_out = false;
    let mut terminate_started: Option<Instant> = None;
    loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            let (stdout, stdout_truncated) = stdout_thread
                .join()
                .map_err(|_| "zmx stdout reader panicked".to_string())?;
            let (stderr, stderr_truncated) = stderr_thread
                .join()
                .map_err(|_| "zmx stderr reader panicked".to_string())?;
            let mut exit_code = status.code().unwrap_or(1);
            if timed_out {
                exit_code = 124;
            } else if stdout_truncated || stderr_truncated {
                exit_code = 125;
            }
            let stderr_text = String::from_utf8_lossy(&stderr).trim().to_string();
            let stdout_text = String::from_utf8_lossy(&stdout).trim().to_string();
            let mut stderr_lines = Vec::new();
            if !stderr_text.is_empty() {
                stderr_lines.push(stderr_text);
            }
            if timed_out {
                stderr_lines.push(format!(
                    "zmx lifecycle command timed out after {}ms",
                    timeout.as_millis()
                ));
            }
            if stdout_truncated {
                stderr_lines.push(format!("zmx command stdout exceeded {stdout_limit} bytes"));
            }
            if stderr_truncated {
                stderr_lines.push(format!("zmx command stderr exceeded {stderr_limit} bytes"));
            }
            return Ok(ZmxCommandResult {
                exit_code,
                stderr: stderr_lines.join("\n"),
                stdout: stdout_text,
                stdout_truncated,
            });
        }
        let should_terminate = terminate.load(Ordering::SeqCst) || started.elapsed() >= timeout;
        if should_terminate {
            timed_out = timed_out || started.elapsed() >= timeout;
            if terminate_started.is_none() {
                terminate_started = Some(Instant::now());
                send_sigterm(&child);
            } else if terminate_started
                .map(|instant| instant.elapsed() >= Duration::from_millis(1_000))
                .unwrap_or(false)
            {
                let _ = child.kill();
            }
        }
        thread::sleep(Duration::from_millis(10));
    }
}

fn read_capped<R: Read>(
    mut reader: R,
    limit: usize,
    terminate: Arc<AtomicBool>,
) -> (Vec<u8>, bool) {
    let mut output = Vec::new();
    let mut truncated = false;
    let mut buffer = [0_u8; 8192];
    loop {
        let Ok(read) = reader.read(&mut buffer) else {
            break;
        };
        if read == 0 {
            break;
        }
        let remaining = limit.saturating_sub(output.len());
        if read > remaining {
            if remaining > 0 {
                output.extend_from_slice(&buffer[..remaining]);
            }
            truncated = true;
            terminate.store(true, Ordering::SeqCst);
            break;
        }
        output.extend_from_slice(&buffer[..read]);
    }
    (output, truncated)
}

fn send_sigterm(child: &std::process::Child) {
    #[cfg(unix)]
    unsafe {
        libc::kill(child.id() as i32, libc::SIGTERM);
    }
    #[cfg(not(unix))]
    {
        let _ = child.kill();
    }
}

struct ZmxAttachCommandInput {
    cwd: String,
    global_session_ref: Option<String>,
    gxserver_auth_token_file: Option<String>,
    gxserver_base_url: Option<String>,
    gxserver_protocol_version: Option<u64>,
    prompt_editor: Option<String>,
    session_name: String,
    title: Option<String>,
    zmx_executable_path: String,
}

struct ZmxRunCommandInput {
    cwd: String,
    global_session_ref: Option<String>,
    gxserver_auth_token_file: Option<String>,
    gxserver_base_url: Option<String>,
    gxserver_protocol_version: Option<u64>,
    session_name: String,
    startup_text: String,
    zmx_executable_path: String,
}

struct ZmxShellProviderCommandInput {
    cwd: String,
    global_session_ref: Option<String>,
    gxserver_auth_token_file: Option<String>,
    gxserver_base_url: Option<String>,
    gxserver_protocol_version: Option<u64>,
    session_name: String,
    zmx_executable_path: String,
}

fn build_zmx_attach_command(input: ZmxAttachCommandInput) -> String {
    let prompt_editor_attach_args = if input.prompt_editor.as_deref() == Some("monaco") {
        "--prompt-editor=monaco"
    } else {
        ""
    };
    let script = format!(
        r#"
zmx_session={}
zmx_cwd={}
zmx_global_session_ref={}
zmx_gxserver_auth_token_file={}
zmx_gxserver_base_url={}
zmx_gxserver_protocol_version={}
zmx_persistence_notice_command={}
zmx_title_notice_command={}
zmx_bin={}
zmx_prompt_editor_attach_args={}
if [ ! -x "$zmx_bin" ]; then
  printf '%s\n' 'session persistence is set to zmx, but Ghostex bundled zmx was not found.'
  exit 127
fi
export GHOSTEX_ZMX_BIN="$zmx_bin"
{}
if [ -n "$zmx_global_session_ref" ]; then
  export GHOSTEX_GLOBAL_SESSION_REF="$zmx_global_session_ref"
fi
if [ -n "$zmx_session" ]; then
  export GHOSTEX_SESSION_ID="$zmx_session"
fi
if [ -n "$zmx_gxserver_auth_token_file" ]; then
  export GHOSTEX_GXSERVER_AUTH_TOKEN_FILE="$zmx_gxserver_auth_token_file"
fi
if [ -n "$zmx_gxserver_base_url" ]; then
  export GHOSTEX_GXSERVER_BASE_URL="$zmx_gxserver_base_url"
fi
if [ -n "$zmx_gxserver_protocol_version" ]; then
  export GHOSTEX_GXSERVER_PROTOCOL_VERSION="$zmx_gxserver_protocol_version"
fi
if "$zmx_bin" list --short 2>/dev/null | grep -F -x -- "$zmx_session" >/dev/null 2>&1; then
  if [ -n "$zmx_title_notice_command" ]; then
    /bin/zsh -lc "$zmx_title_notice_command"
  fi
  exec "$zmx_bin" attach $zmx_prompt_editor_attach_args "$zmx_session"
fi
if [ -n "$zmx_persistence_notice_command" ]; then
  /bin/zsh -lc "$zmx_persistence_notice_command"
fi
cd "$zmx_cwd" || exit
exec "$zmx_bin" attach $zmx_prompt_editor_attach_args "$zmx_session"
"#,
        shell_quote(&input.session_name),
        shell_quote(&input.cwd),
        shell_quote(input.global_session_ref.as_deref().unwrap_or("")),
        shell_quote(input.gxserver_auth_token_file.as_deref().unwrap_or("")),
        shell_quote(input.gxserver_base_url.as_deref().unwrap_or("")),
        shell_quote(
            &input
                .gxserver_protocol_version
                .map(|value| value.to_string())
                .unwrap_or_default(),
        ),
        shell_quote(&persistence_notice_shell_command(&input.session_name)),
        shell_quote(&session_title_shell_command(input.title.as_deref())),
        shell_quote(&input.zmx_executable_path),
        shell_quote(prompt_editor_attach_args),
        zmx_session_identity_reset_shell_command(),
    )
    .trim()
    .to_string();
    format!("/bin/zsh -lc {}", shell_quote(&script))
}

fn build_zmx_kill_command(session_name: &str, zmx_executable_path: &str) -> String {
    format!(
        r#"
zmx_session={}
zmx_bin={}
if [ ! -x "$zmx_bin" ]; then
  printf '%s\n' 'session persistence is set to zmx, but Ghostex bundled zmx was not found.'
  exit 127
fi
unset ZMX_SESSION ZMX_SESSION_PREFIX
exec "$zmx_bin" kill "$zmx_session" --force
"#,
        shell_quote(session_name),
        shell_quote(zmx_executable_path),
    )
    .trim()
    .to_string()
}

fn build_zmx_history_command(session_name: &str, zmx_executable_path: &str) -> String {
    format!(
        r#"
zmx_session={}
zmx_bin={}
if [ ! -x "$zmx_bin" ]; then
  printf '%s\n' 'session persistence is set to zmx, but Ghostex bundled zmx was not found.' >&2
  exit 127
fi
unset ZMX_SESSION ZMX_SESSION_PREFIX
exec "$zmx_bin" history "$zmx_session"
"#,
        shell_quote(session_name),
        shell_quote(zmx_executable_path),
    )
    .trim()
    .to_string()
}

fn build_zmx_send_command(session_name: &str, zmx_executable_path: &str) -> String {
    format!(
        r#"
zmx_session={}
zmx_bin={}
if [ ! -x "$zmx_bin" ]; then
  printf '%s\n' 'session persistence is set to zmx, but Ghostex bundled zmx was not found.' >&2
  exit 127
fi
unset ZMX_SESSION ZMX_SESSION_PREFIX
exec "$zmx_bin" send "$zmx_session"
"#,
        shell_quote(session_name),
        shell_quote(zmx_executable_path),
    )
    .trim()
    .to_string()
}

fn build_zmx_run_command(input: ZmxRunCommandInput) -> String {
    let startup_command =
        with_atuin_ignored_shell_history_prefix(input.startup_text.trim_end_matches(['\r', '\n']));
    let provider_shell_command = format!(
        "{}\n{}\nexec /bin/zsh -li",
        zmx_provider_prompt_editor_setup_shell_command(),
        startup_command
    );
    format_zmx_provider_run_script(
        &input.session_name,
        &input.cwd,
        input.global_session_ref.as_deref(),
        input.gxserver_auth_token_file.as_deref(),
        input.gxserver_base_url.as_deref(),
        input.gxserver_protocol_version,
        Some(&startup_command),
        &provider_shell_command,
        "zmx_startup_command",
        &input.zmx_executable_path,
    )
}

fn build_zmx_shell_provider_command(input: ZmxShellProviderCommandInput) -> String {
    let provider_shell_command = format!(
        "{}\nexec /bin/zsh -li",
        zmx_provider_prompt_editor_setup_shell_command()
    );
    format_zmx_provider_run_script(
        &input.session_name,
        &input.cwd,
        input.global_session_ref.as_deref(),
        input.gxserver_auth_token_file.as_deref(),
        input.gxserver_base_url.as_deref(),
        input.gxserver_protocol_version,
        None,
        &provider_shell_command,
        "zmx_shell_command",
        &input.zmx_executable_path,
    )
}

#[allow(clippy::too_many_arguments)]
fn format_zmx_provider_run_script(
    session_name: &str,
    cwd: &str,
    global_session_ref: Option<&str>,
    gxserver_auth_token_file: Option<&str>,
    gxserver_base_url: Option<&str>,
    gxserver_protocol_version: Option<u64>,
    startup_text: Option<&str>,
    provider_shell_command: &str,
    command_variable: &str,
    zmx_executable_path: &str,
) -> String {
    let startup_text_assignment = startup_text
        .map(|text| format!("zmx_startup_text={}\n", shell_quote(text)))
        .unwrap_or_default();
    let startup_text_guard = if startup_text.is_some() {
        "if [ -z \"$zmx_startup_text\" ]; then\n  printf '%s\\n' 'gxserver startSessionProvider requires startup text.' >&2\n  exit 64\nfi\n"
    } else {
        ""
    };
    let command_arg = format!("${command_variable}");
    format!(
        r#"
zmx_session={}
zmx_cwd={}
zmx_global_session_ref={}
zmx_gxserver_auth_token_file={}
zmx_gxserver_base_url={}
zmx_gxserver_protocol_version={}
{}{}={}
zmx_bin={}
if [ ! -x "$zmx_bin" ]; then
  printf '%s\n' 'session persistence is set to zmx, but Ghostex bundled zmx was not found.' >&2
  exit 127
fi
export GHOSTEX_ZMX_BIN="$zmx_bin"
{}{}
if [ -n "$zmx_global_session_ref" ]; then
  export GHOSTEX_GLOBAL_SESSION_REF="$zmx_global_session_ref"
fi
if [ -n "$zmx_session" ]; then
  export GHOSTEX_SESSION_ID="$zmx_session"
fi
if [ -n "$zmx_gxserver_auth_token_file" ]; then
  export GHOSTEX_GXSERVER_AUTH_TOKEN_FILE="$zmx_gxserver_auth_token_file"
fi
if [ -n "$zmx_gxserver_base_url" ]; then
  export GHOSTEX_GXSERVER_BASE_URL="$zmx_gxserver_base_url"
fi
if [ -n "$zmx_gxserver_protocol_version" ]; then
  export GHOSTEX_GXSERVER_PROTOCOL_VERSION="$zmx_gxserver_protocol_version"
fi
cd "$zmx_cwd" || exit
exec "$zmx_bin" run "$zmx_session" -d --initial-command /bin/zsh -lic "{}"
"#,
        shell_quote(session_name),
        shell_quote(cwd),
        shell_quote(global_session_ref.unwrap_or("")),
        shell_quote(gxserver_auth_token_file.unwrap_or("")),
        shell_quote(gxserver_base_url.unwrap_or("")),
        shell_quote(
            &gxserver_protocol_version
                .map(|value| value.to_string())
                .unwrap_or_default(),
        ),
        startup_text_assignment,
        command_variable,
        shell_quote(provider_shell_command),
        shell_quote(zmx_executable_path),
        startup_text_guard,
        zmx_session_identity_reset_shell_command(),
        command_arg,
    )
    .trim()
    .to_string()
}

fn build_zmx_exists_command(session_name: &str, zmx_executable_path: &str) -> String {
    format!(
        r#"
zmx_session={}
zmx_bin={}
if [ ! -x "$zmx_bin" ]; then
  printf '%s\n' 'session persistence is set to zmx, but Ghostex bundled zmx was not found.' >&2
  exit 127
fi
unset ZMX_SESSION ZMX_SESSION_PREFIX
zmx_sessions=$("$zmx_bin" list --short)
zmx_list_status=$?
if [ "$zmx_list_status" -ne 0 ]; then
  printf '%s\n' "zmx list --short failed with exit $zmx_list_status" >&2
  exit 2
fi
printf '%s\n' "$zmx_sessions" | grep -F -x -- "$zmx_session" >/dev/null 2>&1
"#,
        shell_quote(session_name),
        shell_quote(zmx_executable_path),
    )
    .trim()
    .to_string()
}

fn zmx_provider_prompt_editor_setup_shell_command() -> &'static str {
    r#"
ghostex_prompt_editor_home="${GHOSTEX_HOME:-$HOME/.ghostex}"
ghostex_prompt_editor_wrapper="$ghostex_prompt_editor_home/state/prompt-editor"
mkdir -p "${ghostex_prompt_editor_wrapper:h}" 2>/dev/null || true
cat > "$ghostex_prompt_editor_wrapper" <<'__GHOSTEX_PROMPT_EDITOR_WRAPPER__'
#!/bin/zsh
if [ -n "${GHOSTEX_ZMX_BIN:-}" ] && [ -x "${GHOSTEX_ZMX_BIN:-}" ]; then
  export GHOSTEX_ZMX_BIN
fi
if [ -n "${GHOSTEX_CLI_EXECUTABLE:-}" ] && [ -x "${GHOSTEX_CLI_EXECUTABLE:-}" ]; then
  exec "$GHOSTEX_CLI_EXECUTABLE" prompt-editor "$@"
fi
if command -v ghostex >/dev/null 2>&1; then
  exec ghostex prompt-editor "$@"
fi
exec gte "$@"
__GHOSTEX_PROMPT_EDITOR_WRAPPER__
chmod 755 "$ghostex_prompt_editor_wrapper" 2>/dev/null || true
export EDITOR="$ghostex_prompt_editor_wrapper"
export VISUAL="$ghostex_prompt_editor_wrapper"
export GHOSTEX_PROMPT_EDITOR_BACKEND="${GHOSTEX_PROMPT_EDITOR_BACKEND:-monaco}"
export GHOSTEX_PROMPT_EDITING_ENABLED=1
"#
    .trim()
}

fn zmx_session_identity_reset_shell_command() -> String {
    format!("unset {}", session_identity_environment_keys().join(" "))
}

fn persistence_notice_shell_command(session_name: &str) -> String {
    format!(
        "printf '%s\\n' {}",
        shell_quote(&format!(
            "This session is using zmx persistence: {session_name}"
        ))
    )
}

fn session_title_shell_command(title: Option<&str>) -> String {
    let Some(title) = title.map(str::trim).filter(|title| !title.is_empty()) else {
        return String::new();
    };
    format!("printf '%s\\n' {}", shell_quote(title))
}

fn with_atuin_ignored_shell_history_prefix(text: &str) -> String {
    let trimmed_right = text.trim_end();
    if trimmed_right.trim().is_empty() {
        return String::new();
    }
    if trimmed_right.starts_with(' ') {
        trimmed_right.to_string()
    } else {
        format!(" {}", trimmed_right.trim_start())
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn read_lifecycle_params(params: &Map<String, Value>) -> Result<LifecycleParams, DomainStateError> {
    Ok(LifecycleParams {
        project_id: read_project_id(params)?,
        session_id: read_session_id(params)?,
    })
}

fn require_session(
    repository: &DomainRepository<'_>,
    lifecycle: &LifecycleParams,
) -> Result<Value, DomainStateError> {
    repository
        .get_session(&lifecycle.project_id, &lifecycle.session_id)?
        .ok_or_else(|| {
            DomainStateError::not_found(format!(
                "Session {}/{} does not exist.",
                lifecycle.project_id, lifecycle.session_id
            ))
        })
}

fn require_zmx() -> ZmxEndpointResult<GxserverResolvedTool> {
    require_bundled_zmx().map_err(ZmxEndpointError::DependencyUnavailable)
}

fn provider_zmx_session_name(session: &Value) -> Result<String, DomainStateError> {
    string_field(session, "zmxName").ok_or_else(|| {
        DomainStateError::corrupt_state("zmxName missing from session domain state.")
    })
}

fn provider_state_patch(
    session: &Value,
    probe: &ProviderProbe,
) -> Result<Map<String, Value>, DomainStateError> {
    let mut provider_state = session
        .get("providerState")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    provider_state.remove("killError");
    provider_state.insert(
        "lifecycleState".to_string(),
        Value::String(probe.lifecycle_state.clone()),
    );
    if let Some(error) = &probe.error {
        provider_state.insert("probeError".to_string(), Value::String(error.clone()));
    } else {
        provider_state.remove("probeError");
    }
    provider_state.insert(
        "probedAt".to_string(),
        Value::String(probe.probed_at.clone()),
    );
    provider_state.insert("zmxName".to_string(), Value::String(probe.zmx_name.clone()));
    Ok(provider_state)
}

fn missing_provider_state_patch(
    session: &Value,
    timestamp: &str,
) -> Result<Map<String, Value>, DomainStateError> {
    let mut provider_state = session
        .get("providerState")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    provider_state.remove("killError");
    provider_state.remove("probeError");
    provider_state.insert("lifecycleState".to_string(), json!("missing"));
    provider_state.insert("probedAt".to_string(), json!(timestamp));
    provider_state.insert(
        "zmxName".to_string(),
        json!(provider_zmx_session_name(session)?),
    );
    Ok(provider_state)
}

fn failed_kill_provider_state_patch(
    session: &Value,
    kill: &ProviderKill,
    timestamp: &str,
) -> Result<Map<String, Value>, DomainStateError> {
    let error = kill
        .error
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| (!kill.stderr.trim().is_empty()).then(|| kill.stderr.clone()))
        .unwrap_or_else(|| format!("zmx kill command exited {}", kill.exit_code));
    let mut provider_state = session
        .get("providerState")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    provider_state.insert("killError".to_string(), Value::String(error.clone()));
    provider_state.insert("lifecycleState".to_string(), json!("unknown"));
    provider_state.insert("probeError".to_string(), Value::String(error));
    provider_state.insert("probedAt".to_string(), json!(timestamp));
    provider_state.insert(
        "zmxName".to_string(),
        json!(provider_zmx_session_name(session)?),
    );
    Ok(provider_state)
}

fn reconcile_domain_lifecycle_from_provider_probe(
    current_lifecycle_state: &str,
    provider_lifecycle_state: &str,
) -> String {
    if provider_lifecycle_state == "exists" && current_lifecycle_state != "stopped" {
        "running".to_string()
    } else {
        current_lifecycle_state.to_string()
    }
}

fn probe_to_value(probe: &ProviderProbe) -> Value {
    let mut value = Map::new();
    if let Some(error) = &probe.error {
        value.insert("error".to_string(), Value::String(error.clone()));
    }
    value.insert(
        "lifecycleState".to_string(),
        Value::String(probe.lifecycle_state.clone()),
    );
    value.insert(
        "probedAt".to_string(),
        Value::String(probe.probed_at.clone()),
    );
    value.insert("zmxName".to_string(), Value::String(probe.zmx_name.clone()));
    Value::Object(value)
}

fn kill_to_value(kill: &ProviderKill) -> Value {
    let mut value = Map::new();
    if let Some(error) = &kill.error {
        value.insert("error".to_string(), Value::String(error.clone()));
    }
    value.insert("exitCode".to_string(), json!(kill.exit_code));
    value.insert("killed".to_string(), Value::Bool(kill.killed));
    value.insert("stderr".to_string(), Value::String(kill.stderr.clone()));
    value.insert("stdout".to_string(), Value::String(kill.stdout.clone()));
    value.insert("zmxName".to_string(), Value::String(kill.zmx_name.clone()));
    Value::Object(value)
}

fn decide_startup_text_disposition(provider_state: &str, startup_text: Option<&str>) -> String {
    if startup_text
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        return "none".to_string();
    }
    if provider_state == "exists" {
        "discardExistingProvider".to_string()
    } else if provider_state == "unknown" {
        "discardUnknownProvider".to_string()
    } else {
        "queueAfterTerminalReady".to_string()
    }
}

fn maybe_insert_startup_text(
    output: &mut Map<String, Value>,
    disposition: &str,
    startup_text: Option<&str>,
) {
    if disposition == "queueAfterTerminalReady" {
        if let Some(startup_text) = startup_text.filter(|value| !value.trim().is_empty()) {
            output.insert(
                "startupText".to_string(),
                Value::String(startup_text.to_string()),
            );
        }
    }
}

fn normalize_optional_startup_text(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
}

fn get_agent_launch_startup_text_for_session(session: &Value) -> Option<String> {
    session
        .get("launchSettings")
        .and_then(Value::as_object)
        .and_then(|settings| settings.get("agentLaunchPlan"))
        .and_then(Value::as_object)
        .and_then(|plan| plan.get("startupText"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
}

fn get_queued_agent_launch_startup_text_for_session(session: &Value) -> Option<String> {
    if !has_queued_agent_launch_startup_text(session) {
        return None;
    }
    get_agent_launch_startup_text_for_session(session)
}

fn has_queued_agent_launch_startup_text(session: &Value) -> bool {
    session
        .get("launchSettings")
        .and_then(Value::as_object)
        .and_then(|settings| settings.get("runtimeRelevant"))
        .and_then(Value::as_object)
        .and_then(|runtime| runtime.get("queueProviderStartupText"))
        .and_then(Value::as_bool)
        == Some(true)
}

fn launch_settings_with_consumed_agent_launch_startup_text(
    session: &Value,
) -> Option<Map<String, Value>> {
    if !has_queued_agent_launch_startup_text(session) {
        return None;
    }
    let mut launch_settings = session
        .get("launchSettings")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let mut runtime_relevant = launch_settings
        .get("runtimeRelevant")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    runtime_relevant.insert("queueProviderStartupText".to_string(), Value::Bool(false));
    launch_settings.insert(
        "runtimeRelevant".to_string(),
        Value::Object(runtime_relevant),
    );
    Some(launch_settings)
}

fn consume_queued_agent_launch_startup_text(
    repository: &DomainRepository<'_>,
    session: &Value,
) -> ZmxEndpointResult<Value> {
    let Some(launch_settings) = launch_settings_with_consumed_agent_launch_startup_text(session)
    else {
        return Ok(session.clone());
    };
    let mut update = Map::new();
    update.insert("projectId".to_string(), value_field(session, "projectId")?);
    update.insert("sessionId".to_string(), value_field(session, "sessionId")?);
    update.insert("launchSettings".to_string(), Value::Object(launch_settings));
    repository
        .update_session_for_lifecycle(&update)
        .map_err(ZmxEndpointError::Domain)
}

fn get_agent_startup_text_for_session(_project: &Value, _session: &Value) -> Option<String> {
    /*
    CDXC:GxserverRustPort 2026-06-19-15:55:
    Fresh agent provider launch is controlled by `runtimeRelevant.queueProviderStartupText`; generic zmx attach/start must not reuse a stale launch plan as a resume fallback after that queue bit is consumed.
    */
    None
}

fn read_interaction_text(
    value: Option<&Value>,
    command_name: &str,
) -> Result<String, DomainStateError> {
    let Some(text) = value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    else {
        return Err(DomainStateError::bad_request(format!(
            "{command_name} requires non-empty text."
        )));
    };
    if text.len() > GXSERVER_ZMX_SEND_TEXT_LIMIT_BYTES {
        return Err(DomainStateError::bad_request(format!(
            "{command_name} text exceeds the {GXSERVER_ZMX_SEND_TEXT_LIMIT_BYTES}-byte zmx send limit."
        )));
    }
    Ok(text.to_string())
}

fn zmx_probe_exit_error_message(result: &ZmxCommandResult) -> String {
    if !result.stderr.trim().is_empty() {
        return result.stderr.trim().to_string();
    }
    if !result.stdout.trim().is_empty() {
        return result.stdout.trim().to_string();
    }
    format!("zmx probe command exited {}", result.exit_code)
}

fn session_target_from_lifecycle_result(result: &Value) -> Option<(String, String)> {
    let session = result.get("session").or_else(|| {
        result
            .get("attach")
            .and_then(|attach| attach.get("session"))
    })?;
    Some((
        string_field(session, "projectId")?,
        string_field(session, "sessionId")?,
    ))
}

fn value_field(value: &Value, key: &str) -> Result<Value, DomainStateError> {
    value.get(key).cloned().ok_or_else(|| {
        DomainStateError::corrupt_state(format!("{key} missing from gxserver response state."))
    })
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn cwd_exists(cwd: &str) -> bool {
    let trimmed = cwd.trim();
    !trimmed.is_empty() && Path::new(trimmed).is_dir()
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn build_gxserver_zmx_child_environment() -> HashMap<String, String> {
    let mut environment = std::env::vars().collect::<HashMap<_, _>>();
    for key in environment_keys_to_strip() {
        environment.remove(key);
    }
    environment.insert("COLORTERM".to_string(), "truecolor".to_string());
    environment.insert("TERM_PROGRAM".to_string(), "ghostty".to_string());
    if let Some(resources_dir) = environment
        .get("GHOSTTY_RESOURCES_DIR")
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
    {
        environment.insert("TERM".to_string(), "xterm-ghostty".to_string());
        if let Some(parent) = Path::new(&resources_dir).parent() {
            environment.insert(
                "TERMINFO".to_string(),
                parent.join("terminfo").to_string_lossy().to_string(),
            );
        }
    } else {
        environment.insert("TERM".to_string(), "xterm-256color".to_string());
    }
    environment
}

fn environment_keys_to_strip() -> Vec<&'static str> {
    let mut keys = Vec::new();
    keys.extend([
        "ANSI_COLORS_DISABLED",
        "NO_COLOR",
        "NODE_DISABLE_COLORS",
        "COLORTERM",
        "TERM",
        "TERMINFO",
        "TERM_PROGRAM",
        "TERM_PROGRAM_VERSION",
        "LaunchInstanceID",
        "XPC_FLAGS",
        "XPC_SERVICE_NAME",
        "__CFBundleIdentifier",
    ]);
    keys.extend(session_identity_environment_keys());
    keys
}

fn session_identity_environment_keys() -> Vec<&'static str> {
    vec![
        "GHOSTEX_AGENT",
        "GHOSTEX_GLOBAL_SESSION_REF",
        "GHOSTEX_GXSERVER_AUTH_TOKEN_FILE",
        "GHOSTEX_GXSERVER_BASE_URL",
        "GHOSTEX_GXSERVER_PROTOCOL_VERSION",
        "GHOSTEX_NATIVE_SESSION_ID",
        "GHOSTEX_SESSION_ID",
        "GHOSTEX_SESSION_STATE_FILE",
        "GHOSTEX_WORKSPACE_ID",
        "GHOSTEX_WORKSPACE_ROOT",
        "VSMUX_AGENT",
        "VSMUX_SESSION_ID",
        "VSMUX_SESSION_STATE_FILE",
        "VSMUX_WORKSPACE_ID",
        "VSMUX_WORKSPACE_ROOT",
        "ZMX_SESSION",
        "ZMX_SESSION_PREFIX",
        "ghostex_AGENT",
        "ghostex_SESSION_ID",
        "ghostex_SESSION_STATE_FILE",
        "ghostex_WORKSPACE_ID",
        "ghostex_WORKSPACE_ROOT",
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zmx_run_command_uses_initial_command_and_ghostex_identity() {
        let command = build_zmx_run_command(ZmxRunCommandInput {
            cwd: "/tmp/project".to_string(),
            global_session_ref: Some("S7k:P100:G100".to_string()),
            gxserver_auth_token_file: Some("/tmp/home/.ghostex/gxserver/auth/token".to_string()),
            gxserver_base_url: Some("http://127.0.0.1:58746".to_string()),
            gxserver_protocol_version: Some(1),
            session_name: "S7k-P100-G100".to_string(),
            startup_text: "codex --yolo\r".to_string(),
            zmx_executable_path: "/repo/zmx/zig-out/bin/zmx".to_string(),
        });
        assert!(command.contains(
            "run \"$zmx_session\" -d --initial-command /bin/zsh -lic \"$zmx_startup_command\""
        ));
        assert!(command.contains("zmx_startup_text=' codex --yolo'"));
        assert!(command.contains("export GHOSTEX_GLOBAL_SESSION_REF=\"$zmx_global_session_ref\""));
        assert!(command.contains(
            "ghostex_prompt_editor_wrapper=\"$ghostex_prompt_editor_home/state/prompt-editor\""
        ));
        assert!(!command.contains("PATH zmx"));
    }

    #[test]
    fn provider_state_patches_preserve_unknown_failed_kill_route() {
        let session = json!({
            "providerState": { "lifecycleState": "exists", "provider": "zmx" },
            "zmxName": "S7k-P100-G100",
        });
        let kill = ProviderKill {
            error: Some("zmx kill failed".to_string()),
            exit_code: 42,
            killed: false,
            stderr: "zmx kill failed".to_string(),
            stdout: String::new(),
            zmx_name: "S7k-P100-G100".to_string(),
        };
        let patch = failed_kill_provider_state_patch(&session, &kill, "2026-06-15T18:06:00.000Z")
            .expect("patch");
        assert_eq!(patch.get("lifecycleState"), Some(&json!("unknown")));
        assert_eq!(patch.get("zmxName"), Some(&json!("S7k-P100-G100")));
        assert_eq!(patch.get("killError"), Some(&json!("zmx kill failed")));
    }

    #[test]
    fn send_payload_validation_uses_utf8_byte_cap() {
        assert!(read_interaction_text(Some(&json!("hello")), "sendSessionText").is_ok());
        let error = read_interaction_text(Some(&json!("")), "sendSessionText")
            .expect_err("empty text rejected");
        assert_eq!(error.code, "badRequest");
        let oversized = "x".repeat(GXSERVER_ZMX_SEND_TEXT_LIMIT_BYTES + 1);
        let error = read_interaction_text(Some(&json!(oversized)), "sendSessionText")
            .expect_err("oversized text rejected");
        assert!(error.message.contains("zmx send limit"));
    }

    #[test]
    fn queued_launch_startup_text_is_explicit_and_consumable() {
        let session = json!({
            "launchSettings": {
                "agentLaunchPlan": {
                    "startupText": " cursor-agent --yolo\r"
                },
                "runtimeRelevant": {
                    "queueProviderStartupText": true
                }
            }
        });
        assert_eq!(
            get_queued_agent_launch_startup_text_for_session(&session),
            Some(" cursor-agent --yolo\r".to_string())
        );
        let consumed =
            launch_settings_with_consumed_agent_launch_startup_text(&session).expect("consumed");
        assert_eq!(
            consumed
                .get("runtimeRelevant")
                .and_then(Value::as_object)
                .and_then(|runtime| runtime.get("queueProviderStartupText")),
            Some(&Value::Bool(false))
        );
    }

    #[test]
    fn startup_text_disposition_never_replays_live_provider_text() {
        assert_eq!(
            decide_startup_text_disposition("exists", Some(" codex --yolo")),
            "discardExistingProvider"
        );
        assert_eq!(
            decide_startup_text_disposition("unknown", Some(" codex --yolo")),
            "discardUnknownProvider"
        );
        assert_eq!(
            decide_startup_text_disposition("missing", Some(" codex --yolo")),
            "queueAfterTerminalReady"
        );
        assert_eq!(decide_startup_text_disposition("missing", None), "none");
    }
}
