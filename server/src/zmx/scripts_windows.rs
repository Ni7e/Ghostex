use super::scripts::{ZmxAttachCommandInput, ZmxRunCommandInput, ZmxShellProviderCommandInput};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{collections::HashMap, process::Command};

const PREFIX: &str = "ghostex-native-session:";
#[derive(Serialize, Deserialize)]
struct Invocation {
    program: String,
    args: Vec<String>,
    #[serde(default)]
    environment: HashMap<String, String>,
}

fn invocation(
    program: &str,
    args: Vec<String>,
    mut environment: HashMap<String, String>,
) -> String {
    environment.insert("WMX_DIR".into(), session_directory());
    format!(
        "{PREFIX}{}",
        serde_json::to_string(&Invocation {
            program: program.into(),
            args,
            environment
        })
        .expect("serialize native session invocation")
    )
}

pub(super) fn process(script: &str) -> Result<Option<(Command, HashMap<String, String>)>, String> {
    let Some(encoded) = script.strip_prefix(PREFIX) else {
        return Ok(None);
    };
    let invocation: Invocation =
        serde_json::from_str(encoded).map_err(|error| error.to_string())?;
    let mut command = Command::new(invocation.program);
    command.args(invocation.args);
    Ok(Some((command, invocation.environment)))
}

fn simple(program: &str, operation: &str, name: &str) -> String {
    invocation(program, vec![operation.into(), name.into()], HashMap::new())
}

pub(crate) fn list_command(program: &str, short: bool) -> String {
    invocation(
        program,
        if short {
            vec!["list".into(), "--short".into()]
        } else {
            vec!["list".into()]
        },
        HashMap::new(),
    )
}

fn quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', "''"))
}

pub(crate) fn build_zmx_attach_command(input: ZmxAttachCommandInput) -> String {
    format!(
        "$env:WMX_DIR={}; & {} attach --require-existing {}{}",
        quote(&session_directory()),
        quote(&input.zmx_executable_path),
        quote(&input.session_name),
        input
            .prompt_editor
            .as_deref()
            .map(|editor| format!(" --prompt-editor {}", quote(editor)))
            .unwrap_or_default()
    )
}
pub(crate) fn build_started_zmx_attach_command(input: ZmxAttachCommandInput) -> String {
    build_zmx_attach_command(input)
}
pub(crate) fn build_zmx_kill_command(name: &str, program: &str) -> String {
    simple(program, "kill", name)
}
pub(crate) fn build_zmx_history_command(name: &str, program: &str) -> String {
    simple(program, "history", name)
}
pub(crate) fn build_zmx_screen_capture_command(
    name: &str,
    program: &str,
    scrollback: u32,
    vt: bool,
) -> String {
    let mut args = vec![
        "history".into(),
        name.into(),
        "--scrollback".into(),
        scrollback.to_string(),
    ];
    if vt {
        args.push("--vt".into());
    }
    invocation(program, args, HashMap::new())
}
pub(crate) fn build_zmx_grid_command(name: &str, program: &str) -> String {
    simple(program, "grid", name)
}
pub(crate) fn build_zmx_send_command(name: &str, program: &str) -> String {
    simple(program, "send", name)
}
pub(crate) fn build_zmx_exists_command(name: &str, program: &str) -> String {
    simple(program, "exists", name)
}

pub(crate) fn build_zmx_run_command(input: ZmxRunCommandInput) -> String {
    start(
        &input.zmx_executable_path,
        &input.session_name,
        &input.cwd,
        Some(&input.startup_text),
        input.global_session_ref,
        input.gxserver_auth_token_file,
        input.gxserver_base_url,
        input.gxserver_protocol_version,
    )
}
pub(crate) fn build_zmx_shell_provider_command(input: ZmxShellProviderCommandInput) -> String {
    start(
        &input.zmx_executable_path,
        &input.session_name,
        &input.cwd,
        None,
        input.global_session_ref,
        input.gxserver_auth_token_file,
        input.gxserver_base_url,
        input.gxserver_protocol_version,
    )
}

#[allow(clippy::too_many_arguments)]
fn start(
    program: &str,
    name: &str,
    cwd: &str,
    startup: Option<&str>,
    global_ref: Option<String>,
    token_file: Option<String>,
    base_url: Option<String>,
    version: Option<u64>,
) -> String {
    let mut environment = HashMap::new();
    for (key, value) in [
        ("GHOSTEX_GLOBAL_SESSION_REF", global_ref),
        ("GHOSTEX_GXSERVER_AUTH_TOKEN_FILE", token_file),
        ("GHOSTEX_GXSERVER_BASE_URL", base_url),
        (
            "GHOSTEX_GXSERVER_PROTOCOL_VERSION",
            version.map(|value| value.to_string()),
        ),
        ("GHOSTEX_SESSION_ID", Some(name.to_string())),
        ("GHOSTEX_ZMX_BIN", Some(program.to_string())),
    ] {
        if let Some(value) = value {
            environment.insert(key.into(), value);
        }
    }
    // CDXC:PromptEditor 2026-09-14 WHY:
    // Apply Ghostex's editor handshake after the user's PowerShell profile; otherwise profile-assigned VS Code blocks chat/terminal transfers.
    let startup = format!(
        "$env:GHOSTEX_PROMPT_EDITOR_MACHINE_VISUAL=$env:VISUAL; $env:GHOSTEX_PROMPT_EDITOR_MACHINE_EDITOR=$env:EDITOR; $env:VISUAL='ghostex prompt-editor'; $env:EDITOR=$env:VISUAL; $env:GHOSTEX_PROMPT_EDITING_ENABLED='1'; {}",
        startup.unwrap_or_default().trim_end_matches(['\r', '\n'])
    );
    let launch = json!({"name": name, "cwd": cwd,
        "shell": crate::platform::shell::command_shell().executable,
        "startup": startup});
    let encoded =
        STANDARD.encode(serde_json::to_vec(&launch).expect("serialize native session launch"));
    invocation(program, vec!["start-encoded".into(), encoded], environment)
}

pub(crate) fn process_snapshot_command(program: &str) -> String {
    invocation(program, vec!["process-snapshot".into()], HashMap::new())
}

/// CDXC:PlatformSupport 2026-09-14 WHY:
/// Keep the existing endpoint directory when migrating to wmx so running native sessions remain attachable without restarting their agents.
fn session_directory() -> String {
    ghostex_paths::GhostexPaths::resolve()
        .runtime_dir
        .join("windows-sessions")
        .to_string_lossy()
        .into_owned()
}

pub(crate) fn version_command(program: &str) -> String {
    invocation(program, vec!["version".into()], HashMap::new())
}
pub(crate) fn inspect_command(program: &str, name: &str) -> String {
    simple(program, "inspect", name)
}
pub(crate) fn force_kill_command(program: &str, name: &str) -> String {
    invocation(
        program,
        vec!["kill".into(), "--force".into(), name.into()],
        HashMap::new(),
    )
}
