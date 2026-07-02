use std::io::Read;
use std::io::{BufRead, BufReader};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

/// Loopback CLI bridge, mirroring the macOS `NativeHostBridge` contract the
/// installed `ghostex` CLI already speaks:
///
/// - newline-delimited JSON over a 127.0.0.1-only TCP socket on port 58743
///   (the CLI's `DEFAULT_PORT`; gxserver owns 58744),
/// - a per-launch bearer token written to `<ghostex home>/cli/bridge-token`
///   (0600 inside a 0700 dir) that every command line must carry as
///   `authToken`, compared in constant time,
/// - malformed or unauthenticated lines close the client before any command
///   is decoded.
///
/// Post-gxserver-cutover the only CLI command that still uses this bridge is
/// `openFloatingEditor` (the Ctrl+G Monaco prompt editor); every other
/// `ghostex` command talks to the gxserver daemon directly. The client socket
/// stays open while the editor is up — the CLI treats a bridge close as a
/// crash signal and resolves its status file as saved — so the reader thread
/// simply blocks until the CLI disconnects.

pub(crate) const GPUI_CLI_BRIDGE_PORT: u16 = 58743;

static GPUI_CLI_BRIDGE_RUNNING: AtomicBool = AtomicBool::new(false);

pub(crate) fn gpui_cli_bridge_is_running() -> bool {
    GPUI_CLI_BRIDGE_RUNNING.load(Ordering::Relaxed)
}

/// The decoded `openFloatingEditor` fields GPUI consumes. The CLI also sends
/// `cwd`/`language`/`env`, which the host ignores exactly like macOS: prompt
/// buffers are always Markdown and native never runs caller commands.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct GpuiCliBridgeOpenFloatingEditorCommand {
    pub(crate) editor_kind: Option<String>,
    pub(crate) file_path: Option<String>,
    pub(crate) originating_session_id: Option<String>,
    pub(crate) request_id: Option<String>,
    pub(crate) status_file: Option<String>,
    pub(crate) title: Option<String>,
}

pub(crate) fn start_gpui_cli_bridge_server(
    cli_directory: PathBuf,
    on_open_floating_editor: futures::channel::mpsc::UnboundedSender<
        GpuiCliBridgeOpenFloatingEditorCommand,
    >,
) -> Result<(), String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, GPUI_CLI_BRIDGE_PORT))
        .map_err(|error| format!("bind 127.0.0.1:{GPUI_CLI_BRIDGE_PORT} failed: {error}"))?;
    let auth_token = make_bridge_auth_token()?;
    write_bridge_token_file(&cli_directory, &auth_token)?;
    GPUI_CLI_BRIDGE_RUNNING.store(true, Ordering::Relaxed);
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else {
                continue;
            };
            let auth_token = auth_token.clone();
            let on_open_floating_editor = on_open_floating_editor.clone();
            std::thread::spawn(move || {
                serve_bridge_client(stream, &auth_token, &on_open_floating_editor);
            });
        }
    });
    Ok(())
}

fn serve_bridge_client(
    stream: TcpStream,
    auth_token: &str,
    on_open_floating_editor: &futures::channel::mpsc::UnboundedSender<
        GpuiCliBridgeOpenFloatingEditorCommand,
    >,
) {
    let reader = BufReader::new(stream);
    for line in reader.lines() {
        let Ok(line) = line else {
            return;
        };
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            return;
        };
        let presented_token = value.get("authToken").and_then(serde_json::Value::as_str);
        if !constant_time_equals(presented_token, auth_token) {
            return;
        }
        if value.get("type").and_then(serde_json::Value::as_str) == Some("openFloatingEditor") {
            let string_field = |key: &str| {
                value
                    .get(key)
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
                    .filter(|field| !field.trim().is_empty())
            };
            let command = GpuiCliBridgeOpenFloatingEditorCommand {
                editor_kind: string_field("editorKind"),
                file_path: string_field("filePath"),
                originating_session_id: string_field("originatingSessionId"),
                request_id: string_field("requestId"),
                status_file: string_field("statusFile"),
                title: string_field("title"),
            };
            let _ = on_open_floating_editor.unbounded_send(command);
        }
        // Other authenticated command types have moved to gxserver; consume
        // the line and keep the connection open like the macOS bridge.
    }
}

fn make_bridge_auth_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .map_err(|error| format!("bridge token entropy unavailable: {error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn write_bridge_token_file(cli_directory: &PathBuf, auth_token: &str) -> Result<(), String> {
    std::fs::create_dir_all(cli_directory)
        .map_err(|error| format!("bridge token directory failed: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let _ = std::fs::set_permissions(cli_directory, std::fs::Permissions::from_mode(0o700));
    }
    let token_path = cli_directory.join("bridge-token");
    std::fs::write(&token_path, format!("{auth_token}\n"))
        .map_err(|error| format!("bridge token write failed: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let _ = std::fs::set_permissions(&token_path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn constant_time_equals(left: Option<&str>, right: &str) -> bool {
    let Some(left) = left else {
        return false;
    };
    let left = left.as_bytes();
    let right = right.as_bytes();
    if left.len() != right.len() {
        return false;
    }
    let mut difference = 0_u8;
    for (left_byte, right_byte) in left.iter().zip(right.iter()) {
        difference |= left_byte ^ right_byte;
    }
    difference == 0
}
