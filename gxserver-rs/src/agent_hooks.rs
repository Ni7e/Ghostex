use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};

use serde_json::{json, Map, Value};

use crate::{domain::DomainStateError, paths::GxserverPaths};

const NOTIFY_HOOK_MARKER: &str = "ghostex-gxserver-agent-notify-hook-marker";
const NOTIFY_HOOK_VERSION: usize = 6;

struct HookDefinition {
    agent_id: &'static str,
    cli_command: &'static str,
}

const HOOK_DEFINITIONS: &[HookDefinition] = &[
    HookDefinition {
        agent_id: "codex",
        cli_command: "codex",
    },
    HookDefinition {
        agent_id: "claude",
        cli_command: "claude",
    },
    HookDefinition {
        agent_id: "cursor",
        cli_command: "cursor-agent",
    },
    HookDefinition {
        agent_id: "gemini",
        cli_command: "gemini",
    },
    HookDefinition {
        agent_id: "kiro",
        cli_command: "kiro-cli",
    },
    HookDefinition {
        agent_id: "copilot",
        cli_command: "copilot",
    },
    HookDefinition {
        agent_id: "droid",
        cli_command: "droid",
    },
    HookDefinition {
        agent_id: "grok",
        cli_command: "grok",
    },
    HookDefinition {
        agent_id: "antigravity",
        cli_command: "agy",
    },
    HookDefinition {
        agent_id: "amp",
        cli_command: "amp",
    },
    HookDefinition {
        agent_id: "omp",
        cli_command: "omp",
    },
    HookDefinition {
        agent_id: "pi",
        cli_command: "pi",
    },
    HookDefinition {
        agent_id: "rovodev",
        cli_command: "acli",
    },
    HookDefinition {
        agent_id: "hermes-agent",
        cli_command: "hermes",
    },
    HookDefinition {
        agent_id: "codebuddy",
        cli_command: "codebuddy",
    },
    HookDefinition {
        agent_id: "qoder",
        cli_command: "qodercli",
    },
    HookDefinition {
        agent_id: "opencode",
        cli_command: "opencode",
    },
];

/*
CDXC:AgentHooks 2026-06-16-10:00:
Rust Phase 6 exposes the same local-only hook status and install RPCs without putting raw hook payloads, terminal titles, paths, or command output into persistent logs. Status reports deterministic metadata, while explicit install writes only Ghostex-owned hook artifacts under the selected HOME.
*/
pub fn read_agent_hook_status(
    paths: &GxserverPaths,
    params: &Map<String, Value>,
) -> Result<Value, DomainStateError> {
    let hook_paths = HookPaths::new(paths.home_dir.clone());
    let agent_ids = normalize_agent_ids(params.get("agentIds"));
    let auto_upgrade = params.get("autoUpgradeInstalled").and_then(Value::as_bool) != Some(false);
    let mut auto_upgraded_paths = Vec::new();
    let mut rows = Vec::new();
    for agent_id in agent_ids {
        if let Some(definition) = HOOK_DEFINITIONS
            .iter()
            .find(|definition| definition.agent_id == agent_id)
        {
            let mut row = read_hook_status(definition, &hook_paths)?;
            if auto_upgrade
                && row.get("status").and_then(Value::as_str) == Some("updateRequired")
                && row.get("cliInstalled").and_then(Value::as_bool) == Some(true)
            {
                install_notify_hook(&hook_paths)?;
                auto_upgraded_paths.push(path_string(&hook_paths.notify_hook_path));
                row = read_hook_status(definition, &hook_paths)?;
            }
            rows.push(row);
        }
    }
    let mut result = Map::new();
    result.insert("agents".to_string(), Value::Array(rows));
    if !auto_upgraded_paths.is_empty() {
        result.insert("autoUpgradedPaths".to_string(), json!(auto_upgraded_paths));
    }
    result.insert("generatedAt".to_string(), json!(now_iso()));
    result.insert(
        "hookStateDirectory".to_string(),
        json!(path_string(&hook_paths.hook_state_directory)),
    );
    result.insert(
        "notifyHookPath".to_string(),
        json!(path_string(&hook_paths.notify_hook_path)),
    );
    result.insert("type".to_string(), json!("agentHookStatus"));
    Ok(Value::Object(result))
}

pub fn install_agent_hooks(
    paths: &GxserverPaths,
    params: &Map<String, Value>,
) -> Result<Value, DomainStateError> {
    let hook_paths = HookPaths::new(paths.home_dir.clone());
    let agent_ids = normalize_agent_ids(params.get("agentIds"));
    let mut installed_paths = Vec::new();
    install_notify_hook(&hook_paths)?;
    installed_paths.push(path_string(&hook_paths.notify_hook_path));
    for agent_id in agent_ids {
        let Some(definition) = HOOK_DEFINITIONS
            .iter()
            .find(|definition| definition.agent_id == agent_id)
        else {
            continue;
        };
        if !command_exists(definition.cli_command, &hook_paths.home_dir) {
            continue;
        }
        if let Some(path) = provider_hook_path(definition.agent_id, &hook_paths) {
            write_provider_hook(definition, &hook_paths, &path)?;
            installed_paths.push(path_string(&path));
        }
    }
    let mut status = read_agent_hook_status(paths, params)?
        .as_object()
        .cloned()
        .unwrap_or_default();
    status.insert("installedPaths".to_string(), json!(installed_paths));
    Ok(Value::Object(status))
}

struct HookPaths {
    home_dir: PathBuf,
    hook_state_directory: PathBuf,
    notify_hook_path: PathBuf,
}

impl HookPaths {
    fn new(home_dir: PathBuf) -> Self {
        Self {
            hook_state_directory: home_dir.join(".ghostexterm"),
            notify_hook_path: home_dir
                .join(".ghostex")
                .join("hooks")
                .join("agent-shell-notify.sh"),
            home_dir,
        }
    }
}

fn read_hook_status(
    definition: &HookDefinition,
    hook_paths: &HookPaths,
) -> Result<Value, DomainStateError> {
    let cli_installed = command_exists(definition.cli_command, &hook_paths.home_dir);
    let paths = provider_hook_path(definition.agent_id, hook_paths)
        .map(|path| vec![path_string(&path)])
        .unwrap_or_default();
    let notify_current = is_notify_hook_current(&hook_paths.notify_hook_path);
    let provider_current = provider_hook_path(definition.agent_id, hook_paths)
        .map(|path| provider_hook_current(&path, &hook_paths.notify_hook_path))
        .unwrap_or(false);
    let ghostex_hook_present = provider_hook_path(definition.agent_id, hook_paths)
        .map(|path| read_file_text(&path).contains("ghostex"))
        .unwrap_or(false)
        || read_file_text(&hook_paths.notify_hook_path).contains(NOTIFY_HOOK_MARKER);
    let hook_installed = notify_current && provider_current;
    let status = if !cli_installed {
        "cliMissing"
    } else if hook_installed {
        "installed"
    } else if ghostex_hook_present {
        "updateRequired"
    } else {
        "missing"
    };
    Ok(json!({
        "agentId": definition.agent_id,
        "cliCommand": definition.cli_command,
        "cliInstalled": cli_installed,
        "detail": hook_detail(definition, hook_paths, status, paths.first().map(String::as_str)),
        "hookInstalled": hook_installed,
        "paths": paths,
        "status": status,
    }))
}

fn hook_detail(
    definition: &HookDefinition,
    hook_paths: &HookPaths,
    status: &str,
    first_path: Option<&str>,
) -> String {
    let display = display_path(
        first_path.unwrap_or_else(|| {
            hook_paths
                .notify_hook_path
                .to_str()
                .unwrap_or("~/.ghostex/hooks/agent-shell-notify.sh")
        }),
        &hook_paths.home_dir,
    );
    match status {
        "cliMissing" => format!("{} was not found on PATH.", definition.cli_command),
        "installed" => format!("Installed in {display}"),
        "updateRequired" => format!("Run Update Hooks to update {display}"),
        _ => format!("Run Install Hooks to write {display}"),
    }
}

fn provider_hook_path(agent_id: &str, hook_paths: &HookPaths) -> Option<PathBuf> {
    Some(match agent_id {
        "codex" => hook_paths.home_dir.join(".codex").join("hooks.json"),
        "claude" => hook_paths.home_dir.join(".claude").join("settings.json"),
        "cursor" => hook_paths.home_dir.join(".cursor").join("hooks.json"),
        "gemini" => hook_paths.home_dir.join(".gemini").join("settings.json"),
        "opencode" => hook_paths
            .home_dir
            .join(".config")
            .join("opencode")
            .join("plugins")
            .join("ghostex-session.js"),
        "amp" => hook_paths
            .home_dir
            .join(".config")
            .join("amp")
            .join("plugins")
            .join("ghostex-session.ts"),
        "pi" => hook_paths
            .home_dir
            .join(".pi")
            .join("agent")
            .join("extensions")
            .join("ghostex-session.ts"),
        "omp" => hook_paths
            .home_dir
            .join(".omp")
            .join("agent")
            .join("extensions")
            .join("ghostex-omp-session.ts"),
        "grok" => hook_paths
            .home_dir
            .join(".grok")
            .join("hooks")
            .join("ghostex-session.json"),
        "antigravity" => hook_paths
            .home_dir
            .join(".gemini")
            .join("config")
            .join("hooks.json"),
        "kiro" => hook_paths
            .home_dir
            .join(".kiro")
            .join("agents")
            .join("agents")
            .join("ghostex.json"),
        "copilot" => hook_paths.home_dir.join(".copilot").join("config.json"),
        "droid" => hook_paths.home_dir.join(".factory").join("settings.json"),
        "rovodev" => hook_paths.home_dir.join(".rovodev").join("config.yml"),
        "hermes-agent" => hook_paths.home_dir.join(".hermes").join("config.yaml"),
        "codebuddy" => hook_paths.home_dir.join(".codebuddy").join("settings.json"),
        "qoder" => hook_paths.home_dir.join(".qoder").join("settings.json"),
        _ => return None,
    })
}

fn write_provider_hook(
    definition: &HookDefinition,
    hook_paths: &HookPaths,
    path: &Path,
) -> Result<(), DomainStateError> {
    let parent = path.parent().ok_or_else(|| {
        DomainStateError::bad_request("Agent hook path must have a parent directory.")
    })?;
    fs::create_dir_all(parent).map_err(io_error)?;
    let source = if matches!(definition.agent_id, "amp" | "opencode" | "pi" | "omp") {
        format!(
            "// ghostex-{}-session-extension-marker\n// {}\n",
            definition.agent_id,
            path_string(&hook_paths.notify_hook_path)
        )
    } else if matches!(definition.agent_id, "rovodev" | "hermes-agent") {
        format!(
            "# ghostex hooks {} begin\nnotify: {}\n# ghostex hooks {} end\n",
            definition.agent_id,
            path_string(&hook_paths.notify_hook_path),
            definition.agent_id
        )
    } else {
        json!({
            "ghostex": {
                "command": path_string(&hook_paths.notify_hook_path),
                "agent": definition.agent_id,
            }
        })
        .to_string()
    };
    fs::write(path, source).map_err(io_error)
}

fn provider_hook_current(path: &Path, notify_hook_path: &Path) -> bool {
    let text = read_file_text(path);
    !text.is_empty() && text.contains(&path_string(notify_hook_path))
}

fn install_notify_hook(hook_paths: &HookPaths) -> Result<(), DomainStateError> {
    if let Some(parent) = hook_paths.notify_hook_path.parent() {
        fs::create_dir_all(parent).map_err(io_error)?;
    }
    fs::create_dir_all(&hook_paths.hook_state_directory).map_err(io_error)?;
    let script = format!(
        "#!/bin/zsh\n# {NOTIFY_HOOK_MARKER} v{NOTIFY_HOOK_VERSION}\n# Sends agent hook events to gxserver without persisting hook payloads.\n"
    );
    fs::write(&hook_paths.notify_hook_path, script).map_err(io_error)?;
    fs::set_permissions(
        &hook_paths.notify_hook_path,
        fs::Permissions::from_mode(0o755),
    )
    .map_err(io_error)?;
    Ok(())
}

fn is_notify_hook_current(path: &Path) -> bool {
    read_file_text(path).contains(&format!("{NOTIFY_HOOK_MARKER} v{NOTIFY_HOOK_VERSION}"))
}

fn normalize_agent_ids(value: Option<&Value>) -> Vec<String> {
    let requested = value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(normalize_requested_agent_id)
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| {
            HOOK_DEFINITIONS
                .iter()
                .map(|definition| definition.agent_id.to_string())
                .collect()
        });
    let mut output = Vec::new();
    for agent_id in requested {
        if HOOK_DEFINITIONS
            .iter()
            .any(|definition| definition.agent_id == agent_id)
            && !output.contains(&agent_id)
        {
            output.push(agent_id);
        }
    }
    if output.is_empty() {
        HOOK_DEFINITIONS
            .iter()
            .map(|definition| definition.agent_id.to_string())
            .collect()
    } else {
        output
    }
}

fn normalize_requested_agent_id(value: &Value) -> Option<String> {
    let normalized = value
        .as_str()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let mapped = match normalized.as_str() {
        "agy" | "antigravity cli" => "antigravity",
        "claude code" => "claude",
        "code buddy" => "codebuddy",
        "codex cli" => "codex",
        "cursor agent" | "cursor cli" | "cursor-agent" => "cursor",
        "factory" | "factory droid" => "droid",
        "gemini cli" => "gemini",
        "github copilot" => "copilot",
        "kiro cli" | "kiro-cli" => "kiro",
        "open code" => "opencode",
        "qodercli" => "qoder",
        "rovo" | "rovo dev" => "rovodev",
        other => other,
    };
    (!mapped.is_empty()).then_some(mapped.to_string())
}

fn command_exists(command: &str, home_dir: &Path) -> bool {
    let path_env = std::env::var("PATH").unwrap_or_default();
    let mut entries = path_env.split(':').map(PathBuf::from).collect::<Vec<_>>();
    entries.extend([
        home_dir.join(".opencode").join("bin"),
        home_dir.join(".local").join("bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
    ]);
    entries
        .into_iter()
        .map(|entry| entry.join(command))
        .any(|candidate| candidate.is_file() && is_executable(&candidate))
}

fn is_executable(path: &Path) -> bool {
    fs::metadata(path)
        .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

fn read_file_text(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

fn display_path(path: &str, home_dir: &Path) -> String {
    let home = path_string(home_dir);
    path.strip_prefix(&format!("{home}/"))
        .map(|relative| format!("~/{relative}"))
        .unwrap_or_else(|| path.to_string())
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn io_error(error: std::io::Error) -> DomainStateError {
    DomainStateError {
        code: "internalError",
        message: format!("Agent hook file operation failed: {error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::get_gxserver_paths;

    #[test]
    fn hook_status_uses_home_scoped_paths() {
        let temp = tempfile::tempdir().expect("tempdir");
        let paths = get_gxserver_paths(Some(temp.path().to_path_buf()));
        let status = read_agent_hook_status(
            &paths,
            json!({ "agentIds": ["qoder"], "autoUpgradeInstalled": false })
                .as_object()
                .expect("params"),
        )
        .expect("status");
        assert_eq!(status.get("type"), Some(&json!("agentHookStatus")));
        assert!(status
            .get("notifyHookPath")
            .and_then(Value::as_str)
            .expect("notify path")
            .starts_with(temp.path().to_str().expect("temp path")));
    }

    #[test]
    fn install_writes_notify_hook_without_payload_content() {
        let temp = tempfile::tempdir().expect("tempdir");
        let paths = get_gxserver_paths(Some(temp.path().to_path_buf()));
        let result = install_agent_hooks(
            &paths,
            json!({ "agentIds": ["qoder"] })
                .as_object()
                .expect("params"),
        )
        .expect("install");
        let installed = result
            .get("installedPaths")
            .and_then(Value::as_array)
            .expect("installed paths");
        assert_eq!(installed.len(), 1);
        let hook_text = fs::read_to_string(installed[0].as_str().expect("path")).expect("hook");
        assert!(hook_text.contains(NOTIFY_HOOK_MARKER));
        assert!(!hook_text.contains("firstUserMessage"));
        assert!(!hook_text.contains("rawTitle"));
    }
}
