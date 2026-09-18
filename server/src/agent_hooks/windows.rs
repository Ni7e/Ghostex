use serde_json::{json, Value};
use std::{io::Read, path::Path};

/// CDXC:AgentHooks 2026-09-14 WHY:
/// Windows command hooks must read JSON from stdin directly; passing it through Windows PowerShell 5.1 native argv strips JSON quotes.
/// Installation still uses the existing explicit install and Codex trust flow.
pub(crate) fn command(agent: &str, notify_path: &Path) -> String {
    let executable = std::env::current_exe().unwrap_or_default();
    let quote = |text: &str| format!("'{}'", text.replace('\'', "''"));
    format!(
        "powershell.exe -NoLogo -NoProfile -Command \"& {} agent-hook-notify-native {} {}\"",
        quote(&executable.to_string_lossy()),
        quote(&notify_path.to_string_lossy()),
        quote(agent)
    )
}

pub(crate) fn notify(args: Vec<String>) -> anyhow::Result<()> {
    let script = std::fs::read_to_string(
        args.first()
            .ok_or_else(|| anyhow::anyhow!("Missing hook path"))?,
    )?;
    let directory = super::install::notify_hook_state_directory(&script)
        .ok_or_else(|| anyhow::anyhow!("Missing hook state directory"))?;
    let mut input = String::new();
    std::io::stdin()
        .take(1024 * 1024)
        .read_to_string(&mut input)?;
    let mut payload: Value = serde_json::from_str(&input)?;
    let agent = args.get(1).map(String::as_str).unwrap_or("codex");
    if let Some(object) = payload.as_object_mut() {
        object.entry("agent").or_insert_with(|| json!(agent));
    }
    let state = [
        "VSMUX_SESSION_STATE_FILE",
        "GHOSTEX_SESSION_STATE_FILE",
        "ghostex_SESSION_STATE_FILE",
    ]
    .into_iter()
    .find_map(|key| std::env::var(key).ok().filter(|value| !value.is_empty()))
    .unwrap_or_default();
    if std::env::var("GHOSTEX_INTERNAL_PROMPT_GENERATION").as_deref() != Ok("1")
        && std::env::var("GHOSTEX_INTERNAL_TITLE_GENERATION").as_deref() != Ok("1")
    {
        let _ = super::run_notify_hook(vec![
            state,
            payload.to_string(),
            directory.to_string_lossy().into_owned(),
        ]);
    }
    if agent != "antigravity" {
        if payload["hook_event_name"] == "Interrupt" {
            println!("{{}}");
        } else {
            println!("{{\"continue\":true}}");
        }
    }
    Ok(())
}

pub(crate) fn resolve_command(command: &str) -> Option<String> {
    let extensions = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
    let path = std::env::var_os("PATH")?;
    for directory in std::env::split_paths(&path).filter(|path| path.is_absolute()) {
        let candidate = directory.join(command);
        if candidate.extension().is_some() && candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
        for extension in extensions.split(';').chain(Some(".ps1")) {
            let candidate = directory.join(format!("{command}{extension}"));
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }
    None
}
