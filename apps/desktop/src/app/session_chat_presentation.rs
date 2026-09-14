use crate::*;

const PRESENTATION_CACHE_ENTRIES: usize = 128;
const PRESENTATION_CACHE_ENTRY_BYTES: usize = 128 * 1024;

impl GhostexGpuiApp {
    /// CDXC:SessionChat 2026-09-14 WHY:
    /// Bottom-bar account and context state must survive renderer release even when a transcript exceeds the snapshot cache limit.
    /// Keep only bounded presentation data under the native machine/project/session binding and pass it synchronously into the next activation.
    pub(crate) fn cache_session_chat_presentation(
        &mut self,
        key: GpuiWorkspaceTerminalSessionKey,
        state: &serde_json::Value,
    ) {
        let Some(fields) = state.as_object() else {
            return;
        };
        if state.to_string().len() > PRESENTATION_CACHE_ENTRY_BYTES
            || fields.keys().any(|field| {
                !matches!(
                    field.as_str(),
                    "accounts"
                        | "selectedOptions"
                        | "sessionAgentId"
                        | "agentSessionId"
                        | "agent"
                        | "statusLineReady"
                        | "sessionTitle"
                )
            })
        {
            return;
        }
        self.session_chat_presentations
            .retain(|(candidate, _)| candidate != &key);
        self.session_chat_presentations.push((key, state.clone()));
        let excess = self
            .session_chat_presentations
            .len()
            .saturating_sub(PRESENTATION_CACHE_ENTRIES);
        self.session_chat_presentations.drain(..excess);
    }

    pub(crate) fn cached_session_chat_presentation(
        &mut self,
        key: Option<&GpuiWorkspaceTerminalSessionKey>,
    ) -> Option<serde_json::Value> {
        let key = key?;
        let index = self
            .session_chat_presentations
            .iter()
            .position(|(candidate, _)| candidate == key)?;
        let entry = self.session_chat_presentations.remove(index);
        let state = entry.1.clone();
        self.session_chat_presentations.push(entry);
        Some(state)
    }

    pub(crate) fn forget_session_chat_presentation(
        &mut self,
        key: &GpuiWorkspaceTerminalSessionKey,
    ) {
        self.session_chat_presentations
            .retain(|(candidate, _)| candidate != key);
    }
}
