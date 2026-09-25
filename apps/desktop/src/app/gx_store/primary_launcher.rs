//! The agent the sidebar's launchers and the New Thread picker treat as the default: read from
//! client storage at start, and written whenever an agent is launched.
//!
//! CDXC:AgentLauncher 2026-09-09 WHY:
//! A launch from the New Thread picker or a sidebar launcher must also become the highlighted
//! default agent. The key is the historic `ghostex-sidebar-project-terminal-launcher` so existing
//! choices carry forward.
//!
//! CDXC:AgentLauncher 2026-09-25 WHY:
//! The QuickJS app runtime wrote this key on every `runSidebarAgent` host message and posted
//! `primaryAgentLauncherChanged` back to Rust, which is how Rust's own field learned it. Rust sends
//! that host message itself, so it writes the key and its field at the same moment, and the runtime's
//! writer, its start-up post and the Rust receiver are gone.
//! SEE-ALSO: packages/client-storage/catalog.ts (the `launcher` store).

use serde_json::Value;

use super::sidebar_ui_storage::{read_preference_value, write_client_document_value};
use crate::GhostexGpuiApp;

const PRIMARY_AGENT_LAUNCHER_KEY: &str = "ghostex-sidebar-project-terminal-launcher";

/// `readPrimaryAgentLauncherId`: the stored agent, trimmed, `None` when empty or unreadable.
pub(crate) fn read_primary_agent_launcher_id() -> Option<String> {
    let stored = read_preference_value(PRIMARY_AGENT_LAUNCHER_KEY).ok()??;
    let agent_id = stored.trim();
    (!agent_id.is_empty() && agent_id.len() <= 128).then(|| agent_id.to_string())
}

impl GhostexGpuiApp {
    /// A `runSidebarAgent` host message is on its way to the runtime: its agent becomes the
    /// default, in this app's field and in client storage.
    pub(crate) fn gx_store_note_primary_launcher_host_message(&mut self, message: &Value) {
        if message.get("type").and_then(Value::as_str) != Some("runSidebarAgent") {
            return;
        }
        let Some(agent_id) = message.get("agentId").and_then(Value::as_str) else {
            return;
        };
        // `writePrimaryAgentLauncherId(message.agentId)` stored the id as it came.
        let _ = write_client_document_value(PRIMARY_AGENT_LAUNCHER_KEY, Some(agent_id));
        let agent_id = agent_id.trim();
        self.sidebar_primary_agent_launcher_id =
            (!agent_id.is_empty() && agent_id.len() <= 128).then(|| agent_id.to_string());
    }
}
