//! Where a chat's replay recording goes, and whether there is one at all.
//!
//! CDXC:SessionChat 2026-09-22 WHY:
//! Porting the chat rules to Rust is graded by replaying recorded inputs through the
//! TypeScript brain and the Rust one and diffing the document, so the recording has to hold
//! the conversation itself. That makes it the one diagnostic in the app that is not a support
//! log: it needs both "Show debug UI controls" and its own expiring scenario, it never reaches
//! the shared logs directory, and it is written to a fixed owner-only directory under /tmp that
//! the operating system clears on restart. The file is named by a digest of the session so no
//! project path, session identity, or title is visible in a directory listing.

use crate::{shared_settings, support_logs};
use std::path::PathBuf;

/// The one directory a recording may ever be written to.
const RECORDING_DIRECTORY: &str = "/tmp/gx-chat";

const FNV_PRIME: u32 = 0x0100_0193;
const FNV_OFFSET_A: u32 = 0x811c_9dc5;
const FNV_OFFSET_B: u32 = 0x0f1b_bcd9;

fn fnv1a32(text: &str, seed: u32) -> u32 {
    let mut hash = seed;
    for unit in text.encode_utf16() {
        hash = (hash ^ u32::from(unit & 0x00ff)).wrapping_mul(FNV_PRIME);
        hash = (hash ^ u32::from(unit >> 8)).wrapping_mul(FNV_PRIME);
    }
    hash
}

/// The same digest the TypeScript seam computes (`nativeChatReplayHash`), so a Rust replay and
/// a TypeScript replay name their outputs alike.
pub(crate) fn digest(text: &str) -> String {
    format!(
        "{:08x}{:08x}",
        fnv1a32(text, FNV_OFFSET_A),
        fnv1a32(text, FNV_OFFSET_B)
    )
}

/// The recording file for this chat, or `None` when the scenario is off, expired, or the
/// debug controls are not enabled. Nothing else in the recorder runs when this returns `None`.
pub(crate) fn recording_path(project_id: &str, session_id: &str) -> Option<PathBuf> {
    if !shared_settings::shared_sidebar_settings_snapshot().debugging_mode() {
        return None;
    }
    if !support_logs::scenario_enabled(support_logs::GpuiDiagnosticScenario::ChatReplay) {
        return None;
    }
    let name = digest(&format!("{project_id}\u{0}{session_id}"));
    Some(PathBuf::from(RECORDING_DIRECTORY).join(format!("{name}.jsonl")))
}
