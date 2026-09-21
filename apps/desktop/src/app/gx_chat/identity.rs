//! Who a retained chat is, and the two strings every other file keys off it.
//!
//! Two different keys, for two different tables, and they are not interchangeable:
//!
//! - The RETENTION key is `JSON.stringify([machineId, projectId, sessionId])`, which is what
//!   `apps/desktop/sidebar/session-chat-runtime/store.ts` keys its retained sessions by.
//! - The STORAGE session key is `<projectId>:<sessionId>`, with a `remote-<machineId>:` prefix off
//!   the local machine (`broker.ts`). It is what every per-session client-storage record's suffix
//!   is built from, so a draft written under one spelling is invisible under the other.

use serde_json::Value;

/// One retained chat.
#[derive(Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct ChatIdentity {
    /// `None` on this computer, the remote machine's settings id otherwise.
    pub(super) machine_id: Option<String>,
    pub(super) project_id: String,
    pub(super) session_id: String,
}

impl ChatIdentity {
    /// Reads the identity out of the config the view hands its runtime.
    pub(super) fn from_config(config: &Value) -> Self {
        Self {
            machine_id: config
                .get("machineId")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
                .map(str::to_string),
            project_id: config
                .get("projectId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            session_id: config
                .get("sessionId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        }
    }

    /// `JSON.stringify([machineId, projectId, sessionId])`, the retention key.
    ///
    /// The local machine writes `null` for its id, which is what the TypeScript store does with an
    /// absent `identity.machineId`.
    pub(super) fn retention_key(&self) -> String {
        let machine = match &self.machine_id {
            Some(id) => Value::String(id.clone()),
            None => Value::Null,
        };
        Value::Array(vec![
            machine,
            Value::String(self.project_id.clone()),
            Value::String(self.session_id.clone()),
        ])
        .to_string()
    }

    /// `<projectId>:<sessionId>`, prefixed `remote-<machineId>:` off this computer.
    pub(super) fn storage_session_key(&self) -> String {
        match &self.machine_id {
            Some(id) => format!("remote-{id}:{}:{}", self.project_id, self.session_id),
            None => format!("{}:{}", self.project_id, self.session_id),
        }
    }
}
