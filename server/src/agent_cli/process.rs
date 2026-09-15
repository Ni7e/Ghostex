use std::{path::Path, process::Stdio, time::Duration};
use tokio::{io::AsyncReadExt, process::Command};

pub(crate) fn resolve(binary: &str, home: &Path) -> Option<String> {
    #[cfg(windows)]
    {
        let shell = crate::platform::shell::command_shell();
        let mut command = crate::platform::process::background_command(&shell.executable);
        command.current_dir(home).args(shell.profileless_script_args(&format!(
            "{}; (Get-Command {} -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1).Source",
            WINDOWS_REFRESH_PATH,
            quote(binary),
        )));
        return crate::agent_hooks::probing::run_command_stdout_with_timeout(
            command,
            Duration::from_secs(3),
        )
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty());
    }
    #[cfg(not(windows))]
    crate::agent_hooks::probing::resolve_cli_command(binary, home)
}

#[cfg(windows)]
const WINDOWS_REFRESH_PATH: &str = "$env:Path = @([Environment]::GetEnvironmentVariable('Path','User'), [Environment]::GetEnvironmentVariable('Path','Machine'), $env:Path) -join ';'";

fn command(script: &str, home: &Path) -> Command {
    let shell = if !cfg!(windows) && script.contains('|') {
        crate::platform::shell::command_shell_for_path("/bin/bash")
    } else {
        crate::platform::shell::command_shell()
    };
    let mut command = Command::new(&shell.executable);
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    #[cfg(windows)]
    let script = format!("$ErrorActionPreference = 'Stop'; $global:LASTEXITCODE = 0; {WINDOWS_REFRESH_PATH}; {script}; if ($LASTEXITCODE) {{ exit $LASTEXITCODE }}");
    #[cfg(not(windows))]
    let script = if script.contains('|') {
        // The download must fail the operation even when the installer receives an empty pipe.
        format!("set -o pipefail; {script}")
    } else {
        script.to_string()
    };
    command.args(shell.profileless_script_args(&script));
    #[cfg(not(windows))]
    command.env(
        "PATH",
        crate::agent_hooks::probing::normalize_gxserver_process_path(
            std::env::var("PATH").ok().as_deref(),
            home,
        ),
    );
    command
        .current_dir(home)
        .env("HOME", home)
        .env("NO_COLOR", "1")
        .env("TERM", "dumb")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    command
}

pub(crate) fn quote(value: &str) -> String {
    if cfg!(windows) {
        format!("'{}'", value.replace('\'', "''"))
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

pub(crate) async fn run(
    script: &str,
    home: &Path,
    timeout: Duration,
    output: impl Fn(String) + Clone + Send + 'static,
) -> Result<(), String> {
    let mut child = command(script, home)
        .spawn()
        .map_err(|error| error.to_string())?;
    let pid = child.id();
    let stdout = child.stdout.take().ok_or("CLI stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("CLI stderr unavailable")?;
    let stdout_task = tokio::spawn(drain(stdout, output.clone()));
    let stderr_task = tokio::spawn(drain(stderr, output));
    let result = tokio::time::timeout(timeout, child.wait()).await;
    if result.is_err() {
        #[cfg(unix)]
        if let Some(pid) = pid {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGKILL);
            }
        }
        #[cfg(windows)]
        if let Some(pid) = pid {
            let mut kill = Command::new("taskkill.exe");
            kill.creation_flags(0x0800_0000);
            let _ = kill
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .output()
                .await;
        }
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
    // An installer can leave a detached child holding its pipes open.
    for mut task in [stdout_task, stderr_task] {
        if tokio::time::timeout(Duration::from_secs(2), &mut task)
            .await
            .is_err()
        {
            task.abort();
        }
    }
    match result {
        Ok(Ok(status)) if status.success() => Ok(()),
        Ok(Ok(status)) => Err(format!("Command exited with {status}.")),
        Ok(Err(error)) => Err(error.to_string()),
        Err(_) => Err(format!(
            "Command timed out after {} seconds.",
            timeout.as_secs()
        )),
    }
}

async fn drain(mut stream: impl tokio::io::AsyncRead + Unpin, output: impl Fn(String)) {
    let mut buffer = [0; 4096];
    while let Ok(count) = stream.read(&mut buffer).await {
        if count == 0 {
            break;
        }
        output(String::from_utf8_lossy(&buffer[..count]).into_owned());
    }
}
