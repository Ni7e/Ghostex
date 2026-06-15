use std::{
    env, fs, io,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use serde::Deserialize;

use crate::{
    config::read_selected_local_api_port,
    constants::{GXSERVER_PRODUCT, GXSERVER_PROTOCOL_VERSION},
    paths::GxserverPaths,
    protocol::{RuntimeMetadata, ServerHealthResponse, StatusResponse},
};

pub fn create_source_build_identity(version: &str) -> String {
    /*
    CDXC:GxserverRustPort 2026-06-14-21:09:
    Phase 2 app/CLI opt-in must not mistake a TypeScript source daemon for the Rust daemon. Keep the shared gxserver product/version shape while marking Rust source builds explicitly in health and runtime metadata.
    */
    format!("gxserver:{version}:rust-source")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GxserverBuildIdentityFile {
    build_identity: String,
    fingerprint: String,
    package_version: String,
}

/*
CDXC:GxserverRustPackaging 2026-06-16-01:30:
Phase 8 packages Rust gxserver as Web/gxserver/bin/gxserver while the macOS app still compares daemon health with Web/gxserver/build-identity.json. Read the same package-root identity file as the TypeScript CLI, and use the explicit Rust source identity only when that package file is absent.
*/
pub fn read_current_build_identity(version: &str) -> Result<String> {
    read_build_identity_for_executable(
        &env::current_exe()
            .with_context(|| "resolve current gxserver executable for build identity")?,
        version,
    )
}

pub fn read_build_identity_for_executable(executable_path: &Path, version: &str) -> Result<String> {
    let package_root = package_root_for_executable(executable_path)
        .with_context(|| "resolve gxserver package root for build identity")?;
    read_build_identity_from_package_root(&package_root, version)
}

fn package_root_for_executable(executable_path: &Path) -> Option<PathBuf> {
    executable_path
        .parent()
        .and_then(|bin_dir| bin_dir.parent())
        .map(Path::to_path_buf)
}

pub fn read_build_identity_from_package_root(package_root: &Path, version: &str) -> Result<String> {
    let identity_path = package_root.join("build-identity.json");
    match fs::read_to_string(&identity_path) {
        Ok(text) => {
            let parsed: GxserverBuildIdentityFile = serde_json::from_str(&text)
                .with_context(|| format!("parse {}", identity_path.display()))?;
            if parsed.build_identity.trim().is_empty()
                || parsed.fingerprint.trim().is_empty()
                || parsed.package_version.trim().is_empty()
            {
                anyhow::bail!(
                    "Invalid gxserver build identity file at {}.",
                    identity_path.display()
                );
            }
            Ok(parsed.build_identity)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            Ok(create_source_build_identity(version))
        }
        Err(error) => Err(error).with_context(|| format!("read {}", identity_path.display())),
    }
}

pub fn is_build_identity_reusable(running: Option<&str>, expected: Option<&str>) -> bool {
    let Some(expected) = expected.map(str::trim).filter(|value| !value.is_empty()) else {
        return true;
    };
    running == Some(expected)
}

/*
CDXC:GxserverRuntimeIdentity 2026-06-14-20:37:
Rust Phase 1 writes the same runtime metadata shape as TypeScript so status checks and compatibility fixtures can distinguish healthy, stale, and unreachable fixed-port daemons without probing arbitrary process state.
*/
pub fn write_runtime_metadata(paths: &GxserverPaths, metadata: &RuntimeMetadata) -> Result<()> {
    fs::create_dir_all(&paths.runtime_dir).with_context(|| "create gxserver runtime directory")?;
    fs::write(
        &paths.runtime_metadata_file,
        format!("{}\n", serde_json::to_string_pretty(metadata)?),
    )
    .with_context(|| "write gxserver runtime metadata")?;
    set_file_mode_0600(&paths.runtime_metadata_file)?;
    Ok(())
}

pub fn read_runtime_metadata(paths: &GxserverPaths) -> Result<Option<RuntimeMetadata>> {
    match fs::read_to_string(&paths.runtime_metadata_file) {
        Ok(text) => {
            let parsed: RuntimeMetadata =
                serde_json::from_str(&text).with_context(|| "parse gxserver runtime metadata")?;
            if parsed.port == read_selected_local_api_port()?
                && parsed.protocol_version == GXSERVER_PROTOCOL_VERSION
                && !parsed.server_id.is_empty()
                && !parsed.started_at.is_empty()
                && !parsed.version.is_empty()
            {
                Ok(Some(parsed))
            } else {
                Ok(None)
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error).with_context(|| "read gxserver runtime metadata"),
    }
}

pub fn remove_runtime_metadata(paths: &GxserverPaths) -> Result<()> {
    match fs::remove_file(&paths.runtime_metadata_file) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| "remove gxserver runtime metadata"),
    }
}

pub fn create_running_status(
    health: ServerHealthResponse,
    metadata: Option<RuntimeMetadata>,
) -> StatusResponse {
    StatusResponse {
        health: Some(health.clone()),
        metadata,
        message: format!("gxserver is running on 127.0.0.1:{}.", health.port),
        ok: true,
        product: GXSERVER_PRODUCT.to_string(),
        state: "running".to_string(),
    }
}

pub fn create_stopped_status(metadata: Option<RuntimeMetadata>) -> StatusResponse {
    StatusResponse {
        health: None,
        message: if metadata.is_some() {
            "gxserver is not running; runtime metadata is stale.".to_string()
        } else {
            "gxserver is not running.".to_string()
        },
        ok: true,
        product: GXSERVER_PRODUCT.to_string(),
        state: if metadata.is_some() {
            "stale".to_string()
        } else {
            "stopped".to_string()
        },
        metadata,
    }
}

pub fn is_process_running(pid: u32) -> bool {
    #[cfg(unix)]
    {
        let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
        if result == 0 {
            return true;
        }
        std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        false
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_package_identity_uses_rust_source_identity() {
        let temp = tempfile::tempdir().expect("tempdir");
        let bin_dir = temp.path().join("bin");
        fs::create_dir_all(&bin_dir).expect("bin dir");
        let executable = bin_dir.join("gxserver");
        fs::write(&executable, "").expect("executable placeholder");

        let identity =
            read_build_identity_for_executable(&executable, "0.1.0").expect("build identity");

        assert_eq!(identity, "gxserver:0.1.0:rust-source");
    }

    #[test]
    fn packaged_identity_file_overrides_rust_source_identity() {
        let temp = tempfile::tempdir().expect("tempdir");
        let bin_dir = temp.path().join("bin");
        fs::create_dir_all(&bin_dir).expect("bin dir");
        let executable = bin_dir.join("gxserver");
        fs::write(&executable, "").expect("executable placeholder");
        fs::write(
            temp.path().join("build-identity.json"),
            r#"{
  "buildIdentity": "gxserver:0.1.0:sha256:phase8",
  "fingerprint": "sha256:phase8",
  "packageVersion": "0.1.0"
}
"#,
        )
        .expect("build identity file");

        let identity =
            read_build_identity_for_executable(&executable, "0.1.0").expect("build identity");

        assert_eq!(identity, "gxserver:0.1.0:sha256:phase8");
    }

    #[test]
    fn invalid_packaged_identity_file_is_an_error() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(
            temp.path().join("build-identity.json"),
            r#"{"buildIdentity":"","fingerprint":"sha256:phase8","packageVersion":"0.1.0"}"#,
        )
        .expect("build identity file");

        let error = read_build_identity_from_package_root(temp.path(), "0.1.0")
            .expect_err("invalid identity should fail");

        assert!(error
            .to_string()
            .contains("Invalid gxserver build identity"));
    }
}
