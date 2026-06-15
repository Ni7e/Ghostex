use std::{fs, io};

use anyhow::{bail, Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::{ids, paths::GxserverPaths};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GxserverIdentityFile {
    pub created_at: String,
    pub server_id: String,
}

/*
CDXC:GxserverIdentity 2026-06-14-20:37:
identity.json carries the stable serverId across Rust daemon restarts. Runtime metadata stays separate so stale pid/port files can be removed without changing server-scoped refs.
*/
pub fn ensure_gxserver_identity(paths: &GxserverPaths) -> Result<GxserverIdentityFile> {
    if let Some(existing) = read_gxserver_identity(paths)? {
        return Ok(existing);
    }
    fs::create_dir_all(&paths.root_dir).with_context(|| "create gxserver root")?;
    let identity = GxserverIdentityFile {
        created_at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        server_id: ids::create_server_id(),
    };
    fs::write(
        &paths.identity_file,
        format!("{}\n", serde_json::to_string_pretty(&identity)?),
    )
    .with_context(|| "write gxserver identity")?;
    set_file_mode_0600(&paths.identity_file)?;
    Ok(identity)
}

fn read_gxserver_identity(paths: &GxserverPaths) -> Result<Option<GxserverIdentityFile>> {
    match fs::read_to_string(&paths.identity_file) {
        Ok(text) => {
            let parsed: GxserverIdentityFile =
                serde_json::from_str(&text).with_context(|| "parse gxserver identity")?;
            if !ids::is_gxserver_server_id(&parsed.server_id) {
                bail!(
                    "Invalid gxserver identity file at {}. Expected serverId like S7k.",
                    paths.identity_file.display()
                );
            }
            Ok(Some(parsed))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error).with_context(|| "read gxserver identity"),
    }
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
