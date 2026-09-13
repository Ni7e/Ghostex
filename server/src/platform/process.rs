use std::{ffi::OsStr, process::Command};

/// CDXC:PlatformSupport 2026-09-14 WHY:
/// Background Git and tool probes run in the interactive Windows session; without CREATE_NO_WINDOW every probe can open Windows Terminal.
pub(crate) fn background_command(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    #[cfg(not(windows))]
    let _ = &mut command;
    command
}
