use std::{
    env,
    net::TcpListener,
    path::PathBuf,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use anyhow::{anyhow, Context, Result};
use serde_json::Value;

use crate::{
    auth::read_gxserver_auth_token,
    config::read_selected_local_api_port,
    constants::{GXSERVER_LOCAL_API_HOST, GXSERVER_PRODUCT, GXSERVER_VERSION},
    http_client::{fetch_server_health, request_server_stop, request_server_stop_all},
    paths::get_gxserver_paths,
    protocol::StatusResponse,
    runtime::{
        create_running_status, create_source_build_identity, create_stopped_status,
        is_build_identity_reusable, is_process_running, read_current_build_identity,
        read_runtime_metadata,
    },
    server::{run_gxserver_foreground, GxserverForegroundOptions},
};

pub async fn run_from_env() -> Result<()> {
    run(env::args().skip(1).collect()).await
}

/*
CDXC:GxserverCli 2026-06-14-20:37:
The Rust CLI intentionally keeps the TypeScript command surface and --json behavior for start, stop, stop-all, and status so app/CLI opt-in can swap binaries without changing client command construction.
*/
pub async fn run(args: Vec<String>) -> Result<()> {
    let version = GXSERVER_VERSION.to_string();
    let build_identity = read_current_build_identity(&version)?;
    let command = args.first().map(String::as_str);
    match command {
        None | Some("--foreground") => {
            let result = run_gxserver_foreground(GxserverForegroundOptions {
                build_identity: Some(build_identity),
                home_dir: None,
                version,
            })
            .await?;
            if result.reused {
                println!("gxserver is already running and uses the expected protocol.");
            }
        }
        Some("start") => {
            print_status(
                &start_gxserver_background(&build_identity, &version).await?,
                args.iter().skip(1).any(|arg| arg == "--json"),
            )?;
        }
        Some("stop") => {
            print_status(
                &stop_gxserver_control_plane(&build_identity, &version).await?,
                args.iter().skip(1).any(|arg| arg == "--json"),
            )?;
        }
        Some("stop-all") => {
            print_status(
                &stop_gxserver_and_sessions(&build_identity, &version).await?,
                args.iter().skip(1).any(|arg| arg == "--json"),
            )?;
        }
        Some("status") => {
            print_status(
                &get_gxserver_status(&build_identity, &version).await?,
                args.iter().skip(1).any(|arg| arg == "--json"),
            )?;
        }
        Some("--version") | Some("version") => {
            println!("{version}");
        }
        Some("--help") | Some("help") => {
            print_help(&version);
        }
        Some(other) => return Err(anyhow!("Unknown gxserver command: {other}")),
    }
    Ok(())
}

pub async fn get_gxserver_status(build_identity: &str, _version: &str) -> Result<StatusResponse> {
    let paths = get_gxserver_paths(None);
    let metadata = read_runtime_metadata(&paths)?;
    let auth = read_gxserver_auth_token(&paths)?;
    if let Ok(Some(health)) =
        fetch_server_health(auth.as_ref().map(|auth| auth.token.as_str()), 800)
    {
        if !is_build_identity_reusable(Some(&health.build_identity), Some(build_identity)) {
            return Ok(StatusResponse {
                health: Some(health),
                metadata,
                message: "gxserver is running with a different build identity.".to_string(),
                ok: false,
                product: GXSERVER_PRODUCT.to_string(),
                state: "protocolMismatch".to_string(),
            });
        }
        return Ok(create_running_status(health, metadata));
    }
    if let Some(metadata) = metadata.clone() {
        if is_process_running(metadata.pid) {
            let pid = metadata.pid;
            return Ok(StatusResponse {
                health: None,
                metadata: Some(metadata),
                message: format!(
                    "gxserver runtime metadata exists for pid {}, but {GXSERVER_LOCAL_API_HOST}:{} is unreachable.",
                    pid,
                    read_selected_local_api_port()?
                ),
                ok: false,
                product: GXSERVER_PRODUCT.to_string(),
                state: "unreachable".to_string(),
            });
        }
    }
    Ok(create_stopped_status(metadata))
}

async fn start_gxserver_background(build_identity: &str, version: &str) -> Result<StatusResponse> {
    let before = get_gxserver_status(build_identity, version).await?;
    if before.state == "running" {
        return Ok(before);
    }
    if before.health.is_some() {
        return Ok(StatusResponse {
            health: before.health,
            metadata: before.metadata,
            message: format!(
                "Rust gxserver was selected, but {GXSERVER_LOCAL_API_HOST}:{} is already owned by a different gxserver build. Stop the current control plane before starting the Rust opt-in.",
                read_selected_local_api_port()?
            ),
            ok: false,
            product: GXSERVER_PRODUCT.to_string(),
            state: "portConflict".to_string(),
        });
    }
    if !is_selected_local_port_available()? {
        /*
        CDXC:GxserverRustPort 2026-06-14-21:09:
        Rust opt-in must keep 127.0.0.1:58744 as a strict single-owner port. Refuse to spawn a detached Rust daemon when another process already owns the fixed port, because falling back to TypeScript or racing a second owner hides the selected Rust startup error.
        */
        return Ok(StatusResponse {
            health: None,
            metadata: before.metadata,
            message: format!(
                "Rust gxserver was selected, but {GXSERVER_LOCAL_API_HOST}:{} is already in use. Stop the current owner before starting the Rust opt-in.",
                read_selected_local_api_port()?
            ),
            ok: false,
            product: GXSERVER_PRODUCT.to_string(),
            state: "portConflict".to_string(),
        });
    }

    let current_exe = env::current_exe().with_context(|| "resolve current gxserver binary")?;
    let mut command = Command::new(current_exe);
    command
        .arg("--foreground")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    spawn_detached(&mut command)?;

    let status = wait_for_status(
        build_identity,
        version,
        Duration::from_millis(5_000),
        |status| status.state == "running",
    )
    .await?;
    if status.state != "running" {
        return Ok(StatusResponse {
            health: None,
            metadata: status.metadata,
            message: format!(
                "gxserver start launched a background process but health did not become ready on {GXSERVER_LOCAL_API_HOST}:{}.",
                read_selected_local_api_port()?
            ),
            ok: false,
            product: GXSERVER_PRODUCT.to_string(),
            state: "starting".to_string(),
        });
    }
    Ok(status)
}

fn is_selected_local_port_available() -> Result<bool> {
    let address = format!(
        "{GXSERVER_LOCAL_API_HOST}:{}",
        read_selected_local_api_port()?
    );
    match TcpListener::bind(&address) {
        Ok(listener) => {
            drop(listener);
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => Ok(false),
        Err(error) => Err(error).with_context(|| format!("probe {address} availability")),
    }
}

async fn stop_gxserver_control_plane(
    build_identity: &str,
    version: &str,
) -> Result<StatusResponse> {
    let before = get_gxserver_status(build_identity, version).await?;
    if before.state != "running" {
        return Ok(before);
    }
    let paths = get_gxserver_paths(None);
    let auth = read_gxserver_auth_token(&paths)?;
    let _ = request_server_stop(auth.as_ref().map(|auth| auth.token.as_str()), 800)?;
    let stopped = wait_for_status(
        build_identity,
        version,
        Duration::from_millis(5_000),
        |status| status.state != "running",
    )
    .await?;
    if stopped.state == "running" {
        return Ok(StatusResponse {
            message:
                "gxserver stop requested control-plane shutdown, but the server is still running."
                    .to_string(),
            ok: false,
            state: "stopping".to_string(),
            ..stopped
        });
    }
    Ok(StatusResponse {
        message: "gxserver control plane stopped. zmx sessions were not signaled or killed."
            .to_string(),
        ok: true,
        ..stopped
    })
}

async fn stop_gxserver_and_sessions(build_identity: &str, version: &str) -> Result<StatusResponse> {
    let before = get_gxserver_status(build_identity, version).await?;
    if before.state != "running" {
        return Ok(before);
    }
    let paths = get_gxserver_paths(None);
    let auth = read_gxserver_auth_token(&paths)?;
    let stop_all = request_server_stop_all(auth.as_ref().map(|auth| auth.token.as_str()), 10_000)?;
    if stop_all.is_none() {
        return Ok(StatusResponse {
            message: "gxserver stop-all could not kill zmx sessions before shutdown.".to_string(),
            ok: false,
            state: "stopping".to_string(),
            ..before
        });
    }
    let stopped = wait_for_status(
        build_identity,
        version,
        Duration::from_millis(10_000),
        |status| status.state != "running",
    )
    .await?;
    if stopped.state == "running" {
        return Ok(StatusResponse {
            message:
                "gxserver stop-all killed zmx sessions but the control plane is still running."
                    .to_string(),
            ok: false,
            state: "stopping".to_string(),
            ..stopped
        });
    }
    let result = stop_all
        .and_then(|value| value.get("result").cloned())
        .unwrap_or(Value::Null);
    let killed = result
        .get("killedSessions")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let failed = result
        .get("failedSessions")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    Ok(StatusResponse {
        message: format!("gxserver control plane stopped after stop-all. zmx sessions killed: {killed}; failed: {failed}."),
        ok: failed == 0,
        ..stopped
    })
}

async fn wait_for_status(
    build_identity: &str,
    version: &str,
    timeout: Duration,
    done: impl Fn(&StatusResponse) -> bool,
) -> Result<StatusResponse> {
    let deadline = Instant::now() + timeout;
    let mut status = get_gxserver_status(build_identity, version).await?;
    while !done(&status) && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(100)).await;
        status = get_gxserver_status(build_identity, version).await?;
    }
    Ok(status)
}

fn print_status(status: &StatusResponse, json: bool) -> Result<()> {
    if json {
        println!("{}", serde_json::to_string_pretty(status)?);
    } else {
        println!("{}", status.message);
    }
    Ok(())
}

fn print_help(version: &str) {
    println!(
        "gxserver {version}

Usage:
  gxserver           Run gxserver in the foreground
  gxserver start     Start gxserver in the background
  gxserver stop      Stop only the gxserver control plane
  gxserver stop-all  Stop gxserver and kill tracked zmx sessions
  gxserver status    Print gxserver runtime state
  gxserver --version Print the gxserver package version
"
    );
}

fn spawn_detached(command: &mut Command) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }
    }
    command
        .spawn()
        .with_context(|| "spawn gxserver background")?;
    Ok(())
}

#[allow(dead_code)]
fn _home_dir_for_tests(path: PathBuf) -> GxserverForegroundOptions {
    GxserverForegroundOptions {
        build_identity: Some(create_source_build_identity(GXSERVER_VERSION)),
        home_dir: Some(path),
        version: GXSERVER_VERSION.to_string(),
    }
}
