use std::{path::PathBuf, ptr};
use windows_sys::Win32::{
    Foundation::{
        CloseHandle, DuplicateHandle, DUPLICATE_SAME_ACCESS, ERROR_NO_MORE_ITEMS, HANDLE,
    },
    Storage::FileSystem::{
        GetFileType, GetFinalPathNameByHandleW, FILE_NAME_OPENED, FILE_TYPE_DISK,
    },
    System::{
        Diagnostics::ProcessSnapshotting::*,
        Threading::{
            GetCurrentProcess, OpenProcess, PROCESS_DUP_HANDLE, PROCESS_QUERY_INFORMATION,
            PROCESS_VM_READ,
        },
    },
};

/// CDXC:SessionIdentity 2026-09-14 WHY:
/// A newly started native Codex has no conversation ID in argv. Windows previously returned no open files, leaving chat at "starting" after the terminal had replied.
/// Read the exact process-owned rollout through Windows process snapshotting, matching macOS lsof and Linux procfs without guessing from a shared project directory.
pub(crate) fn open_paths(process_id: i64) -> Vec<PathBuf> {
    let Some(pid) = u32::try_from(process_id).ok().filter(|pid| *pid != 0) else {
        return Vec::new();
    };
    unsafe {
        let process = OpenProcess(
            PROCESS_QUERY_INFORMATION | PROCESS_VM_READ | PROCESS_DUP_HANDLE,
            0,
            pid,
        );
        if process.is_null() {
            return Vec::new();
        }
        let mut snapshot = ptr::null_mut();
        let status = PssCaptureSnapshot(process, PSS_CAPTURE_HANDLES, 0, &mut snapshot);
        if status != 0 {
            CloseHandle(process);
            return Vec::new();
        }
        let mut marker = ptr::null_mut();
        if PssWalkMarkerCreate(ptr::null(), &mut marker) != 0 {
            PssFreeSnapshot(GetCurrentProcess(), snapshot);
            CloseHandle(process);
            return Vec::new();
        }
        let mut paths = Vec::new();
        let mut complete = false;
        // Each walk advances within this immutable snapshot. Bound the work for unusually large processes.
        for _ in 0..65_536 {
            let mut entry: PSS_HANDLE_ENTRY = std::mem::zeroed();
            let status = PssWalkSnapshot(
                snapshot,
                PSS_WALK_HANDLES,
                marker,
                (&mut entry as *mut PSS_HANDLE_ENTRY).cast(),
                std::mem::size_of::<PSS_HANDLE_ENTRY>() as u32,
            );
            if status != 0 {
                complete = status == ERROR_NO_MORE_ITEMS;
                break;
            }
            let mut duplicate = ptr::null_mut();
            if DuplicateHandle(
                process,
                entry.Handle,
                GetCurrentProcess(),
                &mut duplicate,
                0,
                0,
                DUPLICATE_SAME_ACCESS,
            ) == 0
            {
                continue;
            }
            // Snapshot name information omits file objects. Query only duplicated disk handles;
            // named pipes must never enter a potentially blocking path-name query.
            if GetFileType(duplicate) == FILE_TYPE_DISK {
                if let Some(path) = file_path(duplicate) {
                    paths.push(path);
                }
            }
            CloseHandle(duplicate);
        }
        PssWalkMarkerFree(marker);
        PssFreeSnapshot(GetCurrentProcess(), snapshot);
        CloseHandle(process);
        if complete {
            paths
        } else {
            Vec::new()
        }
    }
}

fn file_path(handle: HANDLE) -> Option<PathBuf> {
    let mut buffer = vec![0_u16; 1024];
    loop {
        let length = unsafe {
            GetFinalPathNameByHandleW(
                handle,
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                FILE_NAME_OPENED,
            )
        } as usize;
        if length == 0 || length > 32_768 {
            return None;
        }
        if length >= buffer.len() {
            buffer.resize(length + 1, 0);
            continue;
        }
        let path = String::from_utf16_lossy(&buffer[..length]);
        return Some(if let Some(unc) = path.strip_prefix(r"\\?\UNC\") {
            PathBuf::from(format!(r"\\{unc}"))
        } else {
            PathBuf::from(path.strip_prefix(r"\\?\").unwrap_or(&path))
        });
    }
}
