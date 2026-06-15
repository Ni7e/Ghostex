use std::{env, fs, io};

use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::{
    constants::{GXSERVER_DEV_LOCAL_API_PORT_ENV, GXSERVER_LOCAL_API_PORT, GXSERVER_PRODUCT},
    paths::GxserverPaths,
    protocol::{ListenerConfig, ListenersConfig},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorsConfig {
    pub allowed_origins: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GxserverConfig {
    pub cors: CorsConfig,
    pub created_at: String,
    pub listeners: ListenersConfig,
    pub product: String,
}

const DEFAULT_CORS_ALLOWED_ORIGINS: &[&str] = &[
    "null",
    "http://127.0.0.1:4173",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:6006",
    "http://localhost:4173",
    "http://localhost:5173",
    "http://localhost:6006",
];

/*
CDXC:GxserverApi 2026-06-14-20:37:
The local Rust listener defaults to 127.0.0.1:58744 and the remote listener remains disabled by default. This preserves the TypeScript CLI/native/sidebar assumptions while the port runs side by side.

CDXC:GxserverRustPort 2026-06-14-21:58:
Compatibility runs may explicitly select a different loopback port with GHOSTEX_GXSERVER_DEV_PORT while the packaged daemon owns 58744. The alternate port is a dev/compat opt-in for the selected process, not a config fallback or a product default change.
*/
pub fn create_default_gxserver_config() -> Result<GxserverConfig> {
    let local_port = read_selected_local_api_port()?;
    Ok(GxserverConfig {
        cors: CorsConfig {
            allowed_origins: DEFAULT_CORS_ALLOWED_ORIGINS
                .iter()
                .map(|origin| (*origin).to_string())
                .collect(),
        },
        created_at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        listeners: ListenersConfig {
            local: ListenerConfig::local_with_port(local_port),
            remote: ListenerConfig::remote_default(),
        },
        product: GXSERVER_PRODUCT.to_string(),
    })
}

pub fn read_gxserver_config(paths: &GxserverPaths) -> Result<GxserverConfig> {
    match fs::read_to_string(&paths.config_file) {
        Ok(text) => {
            let parsed: serde_json::Value =
                serde_json::from_str(&text).with_context(|| "parse gxserver config")?;
            merge_gxserver_config(parsed)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => create_default_gxserver_config(),
        Err(error) => Err(error).with_context(|| "read gxserver config"),
    }
}

pub fn write_default_config_if_missing(paths: &GxserverPaths) -> Result<()> {
    let config = create_default_gxserver_config()?;
    let text = format!("{}\n", serde_json::to_string_pretty(&config)?);
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&paths.config_file)
    {
        Ok(mut file) => {
            use std::io::Write;
            file.write_all(text.as_bytes())?;
            set_file_mode_0600(&paths.config_file)?;
            Ok(())
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(error).with_context(|| "write gxserver default config"),
    }
}

pub fn read_selected_local_api_port() -> Result<u16> {
    let Some(raw_port) = env::var(GXSERVER_DEV_LOCAL_API_PORT_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return Ok(GXSERVER_LOCAL_API_PORT);
    };
    let port = raw_port.parse::<u16>().map_err(|_| {
        anyhow!("{GXSERVER_DEV_LOCAL_API_PORT_ENV} must be an integer from 1 to 65535.")
    })?;
    if port == 0 {
        return Err(anyhow!(
            "{GXSERVER_DEV_LOCAL_API_PORT_ENV} must be an integer from 1 to 65535."
        ));
    }
    Ok(port)
}

fn merge_gxserver_config(value: serde_json::Value) -> Result<GxserverConfig> {
    let defaults = create_default_gxserver_config()?;
    let allowed_origins = value
        .get("cors")
        .and_then(|cors| cors.get("allowedOrigins"))
        .and_then(|origins| origins.as_array())
        .map(|origins| {
            let mut merged = defaults.cors.allowed_origins.clone();
            for origin in origins {
                if let Some(origin) = origin.as_str() {
                    let trimmed = origin.trim();
                    if !trimmed.is_empty() && !merged.iter().any(|existing| existing == trimmed) {
                        merged.push(trimmed.to_string());
                    }
                }
            }
            merged.sort();
            merged
        })
        .unwrap_or(defaults.cors.allowed_origins);

    Ok(GxserverConfig {
        cors: CorsConfig { allowed_origins },
        created_at: value
            .get("createdAt")
            .and_then(|created_at| created_at.as_str())
            .unwrap_or(&defaults.created_at)
            .to_string(),
        listeners: defaults.listeners,
        product: GXSERVER_PRODUCT.to_string(),
    })
}

#[cfg(unix)]
fn set_file_mode_0600(path: &std::path::Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_file_mode_0600(_path: &std::path::Path) -> Result<()> {
    Ok(())
}
