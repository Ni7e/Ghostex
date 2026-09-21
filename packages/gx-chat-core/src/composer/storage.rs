//! The stored records the composer reads and writes, in the exact shape the TypeScript wrote them.
//!
//! CDXC:Drafts 2026-09-22 DECISION:
//! User: drafts and queued prompts must survive the switch to the Rust brain. Every record below
//! keeps the key prefix, the field names and the legacy-value tolerance of
//! `packages/core-ui/chat/session-chat-draft-storage.ts`, `session-chat-summary-override.ts` and
//! `session-chat-verbose-override.ts`, so a draft written by the TypeScript brain is read back
//! unchanged by this one and the other way round.
//!
//! The stores and their prefixes:
//!
//! | store | key | value |
//! |---|---|---|
//! | `drafts` | `ghostex.sessionChat.draft.<sessionKey>` | [`StoredDraftRecord`] as JSON, or legacy raw text |
//! | `summary` | `ghostex.sessionChat.summary.<sessionKey>` | `"1"` or `"0"` |
//! | `verbose` | `ghostex.sessionChat.verbose.<sessionKey>` | `"1"`, `"0"`, or absent |
//! | `returnedPrompts` | `ghostex.sessionChat.returnedPrompts.applied` | family a's applied-id list |
//!
//! The recovery checkpoints (`ghostex.sessionChat.recovery.`), the save outbox
//! (`ghostex.sessionChat.outbox.`), the sent history (`ghostex.sessionChat.sent.`) and the delivery
//! receipts (`ghostex.sessionChat.delivered.`) are read and written by the desktop plumbing, not by
//! the brain: they are listed in the report, and the host keeps owning them.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::composer::queue::DraftVersion;

/// The store ids the composer uses, as `StorageKey::store`.
pub const DRAFTS_STORE: &str = "drafts";
/// The per-session summary-mode flag.
pub const SUMMARY_STORE: &str = "summary";
/// The per-session verbose override.
pub const VERBOSE_STORE: &str = "verbose";

/// One stored composer draft.
///
/// The field names are the TypeScript's `DecodedStoredDraft`, and `updatedAt` stays a number of
/// epoch milliseconds. `submitted` and `parked` are written as real booleans, which is what
/// `entry.submitted === true` reads back.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredDraftRecord {
    pub text: String,
    /// `None` for a legacy plain-string draft, which callers must treat as "age unknown".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<DraftVersion>,
    #[serde(default)]
    pub submitted: bool,
    #[serde(default)]
    pub parked: bool,
}

/// Decodes a stored draft, falling back to the legacy raw-text form.
///
/// A record is only JSON when it has a string `text` and a numeric `updatedAt`, and a version is
/// only kept when its `draftId` is a string and its `revision` is a positive safe integer: the same
/// three tests `decodeStoredDraft` applies, so a half-written record degrades the same way.
pub fn decode_stored_draft(raw: &str) -> StoredDraftRecord {
    if let Ok(Value::Object(parsed)) = serde_json::from_str::<Value>(raw) {
        let text = parsed.get("text").and_then(Value::as_str);
        let updated_at = parsed.get("updatedAt").and_then(Value::as_f64);
        if let (Some(text), Some(updated_at)) = (text, updated_at) {
            let version = parsed.get("version").and_then(|version| {
                let draft_id = version.get("draftId")?.as_str()?;
                let revision = version.get("revision")?.as_f64()?;
                (revision.fract() == 0.0
                    && revision > 0.0
                    && revision.abs() <= 9_007_199_254_740_991.0)
                    .then(|| DraftVersion {
                        draft_id: draft_id.to_string(),
                        revision: revision as i64,
                    })
            });
            return StoredDraftRecord {
                text: text.to_string(),
                updated_at: Some(updated_at as i64),
                version,
                submitted: parsed.get("submitted") == Some(&Value::Bool(true)),
                parked: parsed.get("parked") == Some(&Value::Bool(true)),
            };
        }
    }
    // Legacy drafts are the raw composer text, not JSON.
    StoredDraftRecord {
        text: raw.to_string(),
        updated_at: None,
        version: None,
        submitted: false,
        parked: false,
    }
}

/// The record's JSON, as `writeStoredSessionChatDraft` writes it.
///
/// The key order is the TypeScript object literal's: `text`, `updatedAt`, `version`, `submitted`,
/// `parked`. `JSON.stringify` drops an `undefined` version, which is what the skip above does.
pub fn encode_stored_draft(record: &StoredDraftRecord) -> String {
    serde_json::to_string(record).unwrap_or_else(|_| "{}".to_string())
}

/// The text a stored draft puts in the composer: a parked draft opens empty.
pub fn stored_draft_text(record: Option<&StoredDraftRecord>) -> String {
    match record {
        Some(record) if !record.parked => record.text.clone(),
        _ => String::new(),
    }
}

/// `"1"` means summary mode is on; anything else, including a missing record, means off.
pub fn decode_summary(raw: Option<&str>) -> bool {
    raw == Some("1")
}

/// What the summary record is written as.
pub fn encode_summary(summary_mode: bool) -> &'static str {
    if summary_mode {
        "1"
    } else {
        "0"
    }
}

/// `"1"` and `"0"` pin the override; anything else follows the Ghostex setting.
pub fn decode_verbose(raw: Option<&str>) -> Option<bool> {
    match raw {
        Some("1") => Some(true),
        Some("0") => Some(false),
        _ => None,
    }
}

/// What the verbose record is written as.
pub fn encode_verbose(verbose: bool) -> &'static str {
    if verbose {
        "1"
    } else {
        "0"
    }
}

/// `ghostex.sessionChat.summary.<sessionKey>`, as the store plus the suffix the host prefixes.
pub fn summary_key(session_key: &str) -> crate::event::StorageKey {
    crate::event::StorageKey {
        store: SUMMARY_STORE.to_string(),
        suffix: session_key.to_string(),
    }
}

/// `ghostex.sessionChat.verbose.<sessionKey>`.
pub fn verbose_key(session_key: &str) -> crate::event::StorageKey {
    crate::event::StorageKey {
        store: VERBOSE_STORE.to_string(),
        suffix: session_key.to_string(),
    }
}
