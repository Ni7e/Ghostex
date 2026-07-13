use anyhow::{anyhow, Result};
use serde_json::Value;

use gxserver::{
    auth::read_gxserver_auth_token, constants::GXSERVER_VERSION, http_client::post_local_api,
    paths::get_gxserver_paths,
};

/*
CDXC:GhostexRustCli 2026-07-13:
Phase 1 of porting scripts/ghostex-cli.mjs (the bundled Node CLI) into the
gxserver-rs workspace so macOS, Windows, and remote Linux ship one CLI
implementation with no Node runtime. This binary is NOT wired into packaging
yet: the Node CLI keeps shipping as `bin/ghostex` while commands migrate.
Phase 1 covers the generic authenticated API bridge (`ghostex api`), which is
the primitive most .mjs commands are built on, plus the server lifecycle
passthrough that reuses the gxserver CLI implementation directly.
*/

const API_BRIDGE_TIMEOUT_MS: u64 = 30_000;

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("server") => gxserver::cli::run(args.iter().skip(1).cloned().collect()).await,
        Some("api") => run_api_bridge(&args[1..]),
        Some("--version") | Some("version") => {
            println!("{GXSERVER_VERSION}");
            Ok(())
        }
        None | Some("--help") | Some("help") => {
            print_help();
            Ok(())
        }
        Some(other) => Err(anyhow!(
            "Unknown ghostex command: {other}. The full command surface still lives in the bundled Node CLI; this Rust CLI currently covers `server` and `api`."
        )),
    }
}

fn run_api_bridge(args: &[String]) -> Result<()> {
    let endpoint = args
        .first()
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow!("Usage: ghostex api <endpoint> [json-params]"))?;
    let endpoint = if endpoint.starts_with('/') {
        endpoint.to_string()
    } else {
        format!("/api/{endpoint}")
    };
    let params: Option<Value> = match args.get(1) {
        Some(raw) => Some(
            serde_json::from_str(raw)
                .map_err(|error| anyhow!("Invalid JSON params for ghostex api: {error}"))?,
        ),
        None => None,
    };
    let paths = get_gxserver_paths(None);
    let auth = read_gxserver_auth_token(&paths)?;
    let response = post_local_api(
        &endpoint,
        params.as_ref(),
        auth.as_ref().map(|auth| auth.token.as_str()),
        API_BRIDGE_TIMEOUT_MS,
    )?;
    match response {
        Some(value) => {
            println!("{}", serde_json::to_string_pretty(&value)?);
            Ok(())
        }
        None => Err(anyhow!(
            "gxserver did not answer {endpoint}. Is gxserver running? Try `ghostex server status`."
        )),
    }
}

fn print_help() {
    println!(
        "ghostex {GXSERVER_VERSION} (Rust CLI, phase 1)

Usage:
  ghostex server <start|stop|stop-all|status|...>  gxserver lifecycle (same as the gxserver binary)
  ghostex api <endpoint> [json-params]             POST an authenticated request to the local gxserver API
  ghostex --version                                Print the CLI version

The remaining command surface (sessions, browser, skills, automations) still
runs through the bundled Node CLI while it is ported command by command.
"
    );
}
