use std::path::PathBuf;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::time::Duration;
use std::time::SystemTime;
#[cfg(target_os = "macos")]
use std::time::UNIX_EPOCH;

/// CDXC:SessionIdentity 2026-09-14 WHY:
/// OMP's TTY breadcrumbs survive exit and TTY reuse. Compare against the live process's cwd and subsecond start time; second-rounded `ps lstart` would still accept an old record when a terminal is reused within that second.
#[cfg(target_os = "macos")]
pub(crate) fn process_context(pid: i64) -> Option<(PathBuf, SystemTime)> {
    use std::os::unix::ffi::OsStringExt;

    let pid = i32::try_from(pid).ok().filter(|pid| *pid > 0)?;
    // Both structures are plain C output buffers. Require complete replies before reading them.
    unsafe {
        let mut info: libc::proc_bsdinfo = std::mem::zeroed();
        let mut paths: libc::proc_vnodepathinfo = std::mem::zeroed();
        let info_size = std::mem::size_of_val(&info) as i32;
        let paths_size = std::mem::size_of_val(&paths) as i32;
        if libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            &mut info as *mut _ as *mut _,
            info_size,
        ) != info_size
            || libc::proc_pidinfo(
                pid,
                libc::PROC_PIDVNODEPATHINFO,
                0,
                &mut paths as *mut _ as *mut _,
                paths_size,
            ) != paths_size
        {
            return None;
        }
        let cwd = paths
            .pvi_cdir
            .vip_path
            .iter()
            .flatten()
            .copied()
            .take_while(|byte| *byte != 0)
            .map(|byte| byte as u8)
            .collect::<Vec<_>>();
        let cwd = PathBuf::from(std::ffi::OsString::from_vec(cwd));
        let start = UNIX_EPOCH
            .checked_add(Duration::from_secs(info.pbi_start_tvsec))?
            .checked_add(Duration::from_micros(info.pbi_start_tvusec))?;
        cwd.is_absolute().then_some((cwd, start))
    }
}

#[cfg(target_os = "linux")]
pub(crate) fn process_context(pid: i64) -> Option<(PathBuf, SystemTime)> {
    if pid <= 0 {
        return None;
    }
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    // comm can contain spaces and parentheses; field 22 follows the final closing parenthesis.
    let ticks = stat
        .rsplit_once(')')?
        .1
        .split_whitespace()
        .nth(19)?
        .parse::<u64>()
        .ok()?;
    let hz = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    if hz <= 0 {
        return None;
    }
    let mut boot: libc::timespec = unsafe { std::mem::zeroed() };
    if unsafe { libc::clock_gettime(libc::CLOCK_BOOTTIME, &mut boot) } != 0 {
        return None;
    }
    let now = SystemTime::now();
    let boot_elapsed = Duration::new(boot.tv_sec.try_into().ok()?, boot.tv_nsec.try_into().ok()?);
    // Round up the kernel's start tick so an older record within that tick cannot pass.
    let started = now
        .checked_sub(boot_elapsed)?
        .checked_add(Duration::from_secs_f64(
            (ticks.checked_add(1)?) as f64 / hz as f64,
        ))?;
    let cwd = std::fs::read_link(format!("/proc/{pid}/cwd")).ok()?;
    Some((cwd, started))
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(crate) fn process_context(_pid: i64) -> Option<(PathBuf, SystemTime)> {
    None
}
