use super::{
    catalog::{self, CATALOG},
    mise, process,
};
use crate::{domain::DomainStateError, paths::GxserverPaths};
use serde_json::{json, Map, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, LazyLock, Mutex},
    time::Duration,
};

#[derive(Clone)]
struct Job {
    state: Value,
    progress: Value,
}

static JOBS: LazyLock<Mutex<HashMap<(PathBuf, String), Job>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static PROBES: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);

pub(crate) async fn dispatch(
    paths: &GxserverPaths,
    params: &Map<String, Value>,
) -> Result<Value, DomainStateError> {
    let agent_id = params
        .get("agentId")
        .and_then(Value::as_str)
        .ok_or_else(|| error("Missing agent id."))?;
    let definition = CATALOG
        .iter()
        .find(|entry| entry.agent_id == agent_id)
        .ok_or_else(|| error("Unknown agent CLI."))?;
    let action = params
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("read");
    if !matches!(action, "read" | "start") {
        return Err(error("Unknown CLI action."));
    }
    let home = paths.agent_config_home_dir().to_path_buf();
    let key = (home.clone(), agent_id.to_string());
    let previous = JOBS.lock().map_err(error)?.get(&key).cloned();
    if action == "read" {
        if let Some(job) = &previous {
            if job.progress["status"] == "running" {
                let mut state = job.state.clone();
                state["job"] = job.progress.clone();
                return Ok(state);
            }
        }
    }
    let mut state = read_state(definition, &home).await?;
    if action == "read" {
        if let Some(job) = previous {
            state["job"] = job.progress;
        }
        return Ok(state);
    }
    let operation = params
        .get("operation")
        .and_then(Value::as_str)
        .ok_or_else(|| error("Missing install/update operation."))?;
    let installed = state["executablePath"].is_string();
    if operation != if installed { "update" } else { "install" } {
        return Err(error(
            "CLI installation changed. Refresh its status before continuing.",
        ));
    }
    let method_id = params
        .get("methodId")
        .and_then(Value::as_str)
        .ok_or_else(|| error("Choose an installation method."))?;
    let method = state["methods"]
        .as_array()
        .and_then(|methods| methods.iter().find(|method| method["id"] == method_id))
        .ok_or_else(|| error("Unsupported installation method."))?;
    if let Some(reason) = method["unavailableReason"].as_str() {
        return Err(error(reason));
    }
    if installed {
        if let Some(detected) = state["detectedMethodId"].as_str() {
            if method_id != detected {
                return Err(error(
                    "Use the detected installation method to update this CLI.",
                ));
            }
        }
    }
    let script = method["command"]
        .as_str()
        .ok_or_else(|| error("Missing CLI command."))?
        .to_string();
    let id = uuid::Uuid::new_v4().to_string();
    let progress =
        json!({"id":id,"operation":operation,"command":script,"status":"running","output":""});
    {
        let mut jobs = JOBS.lock().map_err(error)?;
        if jobs.values().any(|job| job.progress["status"] == "running") {
            return Err(error(
                "Another CLI install or update is still running. Wait for it to finish.",
            ));
        }
        jobs.insert(
            key.clone(),
            Job {
                state: state.clone(),
                progress: progress.clone(),
            },
        );
    }
    state["job"] = progress;
    tokio::spawn(async move {
        let output_key = key.clone();
        let result = process::run(&script, &home, Duration::from_secs(900), move |chunk| {
            if let Ok(mut jobs) = JOBS.lock() {
                if let Some(job) = jobs.get_mut(&output_key) {
                    let mut output = job.progress["output"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string();
                    output.push_str(&chunk);
                    if output.len() > 64 * 1024 {
                        let mut start = output.len() - 64 * 1024;
                        while !output.is_char_boundary(start) {
                            start += 1;
                        }
                        output.drain(..start);
                    }
                    job.progress["output"] = json!(output);
                }
            }
        })
        .await;
        let verification = if result.is_ok() {
            Some(read_state(definition, &home).await)
        } else {
            None
        };
        let result = result.and_then(|_| {
            let verified = verification.unwrap().map_err(|error| error.message)?;
            if !verified["executablePath"].is_string() {
                return Err("The installer exited successfully, but the CLI is still missing from PATH. Check the installation docs and refresh after fixing PATH.".to_string());
            }
            if let Some(reason) = verified["versionError"].as_str() {
                return Err(format!("The installer finished, but the CLI version check failed: {reason}"));
            }
            Ok(())
        });
        if let Ok(mut jobs) = JOBS.lock() {
            if let Some(job) = jobs.get_mut(&key) {
                job.progress["status"] = json!(if result.is_ok() {
                    "succeeded"
                } else {
                    "failed"
                });
                if let Err(error) = result {
                    job.progress["error"] = json!(error);
                }
            }
        }
    });
    Ok(state)
}

async fn read_state(
    definition: &'static catalog::Definition,
    home: &Path,
) -> Result<Value, DomainStateError> {
    let _permit = PROBES.acquire().await.map_err(error)?;
    let owned_home = home.to_path_buf();
    let (executable, methods, detected_method) = tokio::task::spawn_blocking(move || {
        crate::agent_hooks::probing::refresh_cli_environment(&owned_home);
        let executable = process::resolve(&definition.binary, &owned_home);
        let mise = mise::installation(definition, executable.as_deref(), &owned_home);
        let executable = mise
            .as_ref()
            .map(|installation| installation.executable.clone())
            .or(executable);
        let methods = catalog::methods(
            definition,
            executable.as_deref(),
            &owned_home,
            mise.as_ref(),
        );
        let detected = if mise
            .as_ref()
            .is_some_and(|installation| installation.tool.is_some())
        {
            Some("mise".to_string())
        } else {
            executable
                .as_deref()
                .and_then(|path| catalog::detected_method(path, definition))
        };
        (executable, methods, detected)
    })
    .await
    .map_err(error)?;
    let mut state =
        json!({"agentId":definition.agent_id,"platform":std::env::consts::OS,"methods":methods});
    if let Some(path) = executable {
        state["executablePath"] = json!(path);
        if let Some(method) = &detected_method {
            state["detectedMethodId"] = json!(method);
        }
        let output = Arc::new(Mutex::new(String::new()));
        let capture = output.clone();
        let args = definition
            .version_args
            .clone()
            .unwrap_or_else(|| vec!["--version".into()]);
        let invoke = if cfg!(windows) { "& " } else { "" };
        let script = format!(
            "{invoke}{} {}",
            process::quote(&path),
            args.iter()
                .map(|arg| process::quote(arg))
                .collect::<Vec<_>>()
                .join(" ")
        );
        match process::run(&script, home, Duration::from_secs(5), move |chunk| {
            if let Ok(mut output) = capture.lock() {
                if output.len() < 4096 {
                    output.push_str(&chunk);
                }
            }
        })
        .await
        {
            Ok(()) => {
                let text = output.lock().map_err(error)?.clone();
                if let Some(line) = text
                    .lines()
                    .map(str::trim)
                    .find(|line| !line.is_empty() && line.chars().any(|ch| ch.is_ascii_digit()))
                {
                    state["version"] = json!(line.chars().take(160).collect::<String>());
                }
            }
            Err(reason) => state["versionError"] = json!(reason),
        }
    }
    Ok(state)
}

fn error(message: impl std::fmt::Display) -> DomainStateError {
    DomainStateError {
        code: "invalidParams",
        message: message.to_string(),
    }
}
