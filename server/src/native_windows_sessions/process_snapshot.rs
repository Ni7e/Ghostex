use anyhow::{bail, Result};
use std::{
    io::Write,
    os::windows::process::CommandExt,
    process::{Command, Stdio},
};

/// CDXC:PlatformSupport 2026-09-14 WHY:
/// CREATE_NO_WINDOW does not propagate to PowerShell's native-command grandchildren.
/// Listing sessions inside the host avoids a visible Windows Terminal launch on every background identity poll.
pub(crate) fn print() -> Result<()> {
    println!("__GHOSTEX_ZMX_LIST__");
    for session in super::client::list()? {
        println!("name={} pid={}", session.name, session.shell_pid);
    }
    println!("__GHOSTEX_PS__");
    let shell = gxserver::platform::shell::command_shell();
    let script = "Get-CimInstance Win32_Process | ForEach-Object { [string]$_.ProcessId + ' ' + [string]$_.ParentProcessId + ' ?? ' + $_.CommandLine }";
    let output = Command::new(&shell.executable)
        .args(shell.profileless_script_args(script))
        .creation_flags(0x0800_0000)
        .stdin(Stdio::null())
        .output()?;
    if !output.status.success() {
        bail!("Unable to read Windows process identities");
    }
    std::io::stdout().write_all(&output.stdout)?;
    Ok(())
}
