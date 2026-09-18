use base64::{Engine, engine::general_purpose::STANDARD};
use std::path::{Path, PathBuf};

pub(super) fn shell() -> String {
    let pwsh = std::env::var_os("ProgramFiles")
        .map(PathBuf::from)
        .map(|root| root.join("PowerShell/7/pwsh.exe"));
    if let Some(path) = pwsh.filter(|path| path.is_file()) {
        return path.to_string_lossy().into_owned();
    }
    std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("C:/Windows"))
        .join("System32/WindowsPowerShell/v1.0/powershell.exe")
        .to_string_lossy()
        .into_owned()
}

pub(super) fn invocation(command: Option<String>, cwd: Option<&Path>) -> (String, Vec<String>) {
    let mut args = vec!["-NoLogo".into()];
    if command.is_none() && cwd.is_some() {
        args.push("-NoExit".into());
    }
    if command.is_some() || cwd.is_some() {
        let script = format!(
            "{}{}",
            cwd.map(|path| format!(
                "Set-Location -LiteralPath '{}'; ",
                path.to_string_lossy().replace('\'', "''")
            ))
            .unwrap_or_default(),
            command.unwrap_or_default()
        );
        args.push("-EncodedCommand".into());
        args.push(
            STANDARD.encode(
                script
                    .encode_utf16()
                    .flat_map(u16::to_le_bytes)
                    .collect::<Vec<_>>(),
            ),
        );
    }
    (shell(), args)
}

pub(super) fn auth_token() -> Option<String> {
    std::fs::read_to_string(
        crate::shared_settings::ghostex_storage_paths()
            .gxserver_state_dir()
            .join("auth/token"),
    )
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

pub(super) fn path(path: &Path) -> Result<String, String> {
    if !path.is_absolute() {
        return Err("Choose an absolute Windows folder path.".into());
    }
    Ok(path.to_string_lossy().into_owned())
}

pub(super) fn cli_status() -> super::WindowsWslGhostexCliStatus {
    let mut status = super::WindowsWslGhostexCliStatus::default();
    if let Some(path) = std::env::current_exe()
        .ok()
        .and_then(|path| {
            path.parent()
                .map(|parent| parent.join("resources/native/ghostex.exe"))
        })
        .filter(|path| path.is_file())
    {
        status.ghostex_path = Some(path.to_string_lossy().into_owned());
    }
    status
}
