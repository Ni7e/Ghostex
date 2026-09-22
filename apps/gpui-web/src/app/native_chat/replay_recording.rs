//! The desktop records a chat's runtime traffic to a private file for replay debugging. The browser has no file system, so no chat is ever recorded here.
use std::path::PathBuf;

pub(crate) fn recording_path(_project_id: &str, _session_id: &str) -> Option<PathBuf> {
    None
}
