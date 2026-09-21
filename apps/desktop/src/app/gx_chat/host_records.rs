//! The four stored records the core deliberately does not own.
//!
//! `docs/2026-09-21/rust-chat/HOST-TODO.md` section 3: the recovery checkpoints, the durable save
//! outbox, the sent-prompt history and the delivery receipts need disk and a retry worker, which a
//! platform-neutral core cannot have. The brain reads none of them; the host keeps writing them
//! exactly as the TypeScript does and hands the core only what the boot read carries.
//!
//! CDXC:Drafts 2026-09-22 DECISION:
//! User: a user's existing drafts, queued prompts, history and outbox must survive the switch to the
//! Rust brain. Every key format, field name and cap below is the TypeScript's, from
//! `packages/core-ui/chat/session-chat-draft-recovery.ts`, `session-chat-draft-outbox.ts` and
//! `session-chat-sent-history.ts`, so a record written by one brain is read back by the other.

// One item here has no caller: `DRAFT_SAVE_FAILURE`, the composer's save-failure line, which no
// family has ported into the document yet. It is kept because the sentence is the user's and must
// not be reworded when it is finally drawn.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use serde_json::Value;

use ghostex_gx_chat_core::StorageKey;

use super::storage;

/// `ghostex.sessionChat.sent.` keeps the last 50 sent prompts across every session, for Up-arrow
/// recall and the Saved prompts Sent tab. Each send owns a key so two composers cannot overwrite
/// each other's history.
pub(super) const MAX_SENT_MESSAGES: usize = 50;

/// One recovery checkpoint: `ghostex.sessionChat.recovery.<sessionKey>:<draftId>:<revision>`, or
/// `…:<updatedAt>` when the draft has no version.
///
/// The catalog gives this store a TEXT codec, not an object one, so nothing validates the value.
/// That is deliberate: a dismissal overwrites the same key with a marker array, and a decoder has to
/// reject that shape rather than parse it as a checkpoint.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RecoveryCheckpoint {
    pub(super) session_key: String,
    pub(super) text: String,
    pub(super) updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) version: Option<DraftVersion>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) dismissed: Option<bool>,
}

/// `{draftId, revision}`, the identity a draft save is claimed under.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DraftVersion {
    pub(super) draft_id: String,
    pub(super) revision: i64,
}

impl RecoveryCheckpoint {
    /// The part of the key after the prefix.
    fn suffix(&self) -> String {
        match &self.version {
            Some(version) => format!(
                "{}:{}:{}",
                self.session_key, version.draft_id, version.revision
            ),
            None => format!("{}:{}", self.session_key, self.updated_at),
        }
    }
}

/// A stored recovery value, or `None` when the key holds a dismissal marker instead.
///
/// The two tests are the TypeScript decoder's, in its order: a value with a non-string `text` is
/// not a checkpoint (which is how the marker array is rejected), and one already flagged
/// `dismissed` reads as absent.
pub(super) fn decode_recovery(raw: &str) -> Option<RecoveryCheckpoint> {
    let value: Value = serde_json::from_str(raw).ok()?;
    if !value.get("text").is_some_and(Value::is_string) {
        return None;
    }
    if value.get("dismissed").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    serde_json::from_value(value).ok()
}

/// Writes one checkpoint, only when the key is absent and the text is not empty.
///
/// `preserveDraftRevision` never overwrites: a revision already checkpointed is the same text, and a
/// revision already dismissed must stay dismissed. Empty text is never a checkpoint.
pub(super) fn preserve_draft_revision(
    checkpoint: &RecoveryCheckpoint,
    now_ms: i64,
) -> Result<(), &'static str> {
    if checkpoint.text.is_empty() {
        return Ok(());
    }
    let key = StorageKey {
        store: "recovery".to_string(),
        suffix: checkpoint.suffix(),
    };
    if storage::read(&key, now_ms)?.is_some_and(|raw| !raw.is_empty()) {
        return Ok(());
    }
    if is_dismissed(&checkpoint.session_key, checkpoint.version.as_ref(), now_ms)? {
        return Ok(());
    }
    let raw = serde_json::to_string(checkpoint).map_err(|_| "schema")?;
    storage::write(&key, Some(&raw), now_ms)
}

/// Whether a revision was already dismissed.
///
/// `ghostex.sessionChat.recoveryDismissed.["<sessionKey>","<draftId>"]` holds a JSON array of
/// INCLUSIVE `[start, end]` revision ranges, so one record covers a whole run of checkpoints.
pub(super) fn is_dismissed(
    session_key: &str,
    version: Option<&DraftVersion>,
    now_ms: i64,
) -> Result<bool, &'static str> {
    let Some(version) = version else {
        return Ok(false);
    };
    let key = StorageKey {
        store: "recoveryDismissed".to_string(),
        suffix: dismissal_suffix(session_key, &version.draft_id),
    };
    let Some(raw) = storage::read(&key, now_ms)?.filter(|raw| !raw.is_empty()) else {
        return Ok(false);
    };
    let ranges: Vec<(i64, i64)> = serde_json::from_str(&raw).unwrap_or_default();
    Ok(ranges
        .into_iter()
        .any(|(start, end)| start <= version.revision && version.revision <= end))
}

/// `["<sessionKey>","<draftId>"]`, which is a JSON array INSIDE the key rather than in front of it.
fn dismissal_suffix(session_key: &str, draft_id: &str) -> String {
    Value::Array(vec![
        Value::String(session_key.to_string()),
        Value::String(draft_id.to_string()),
    ])
    .to_string()
}

/// One pending draft save: `ghostex.sessionChat.outbox.<sessionKey>:<draftId>:<revision>`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PendingDraft {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) client_id: Option<String>,
    pub(super) session_key: String,
    pub(super) content: String,
    pub(super) version: DraftVersion,
    pub(super) updated_at: i64,
}

impl PendingDraft {
    fn suffix(&self) -> String {
        format!(
            "{}:{}:{}",
            self.session_key, self.version.draft_id, self.version.revision
        )
    }
}

/// Stores one pending save.
pub(super) fn queue_draft_save(draft: &PendingDraft, now_ms: i64) -> Result<(), &'static str> {
    let raw = serde_json::to_string(draft).map_err(|_| "schema")?;
    storage::write(
        &StorageKey {
            store: "draftOutbox".to_string(),
            suffix: draft.suffix(),
        },
        Some(&raw),
        now_ms,
    )
}

/// What a failed save tells the user. One sentence, the TypeScript's, word for word.
///
/// It has no caller yet: `draftSaveStatus` is a composer line no family has ported, so nothing in
/// the document carries it. The clearing of a pending save and the ladder that retries it are
/// `outbox.rs`, which owns the whole queue rather than one row.
pub(super) const DRAFT_SAVE_FAILURE: &str =
    "Draft could not be saved on this computer. Keep this view open until saving succeeds.";

/// One sent prompt: `ghostex.sessionChat.sent.sent:<deliveryId or uuid>`.
///
/// The `sent:` inside the key is part of `promptId`, not a separator this host adds. Only the nine
/// fields below are written; the rest of a stashed prompt stays absent.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SentPrompt {
    pub(super) prompt_id: String,
    pub(super) content: String,
    pub(super) created_at: String,
    pub(super) updated_at: String,
    pub(super) cwd: Option<String>,
    pub(super) project_id: Option<String>,
    pub(super) project_name: Option<String>,
    pub(super) session_id: Option<String>,
}

/// Records one sent prompt. Empty or whitespace-only text is not history.
///
/// `delivery_id` is the receipt's own id when the send came back from the daemon, which keeps the
/// key stable across a replay; otherwise the host mints one, the way `crypto.randomUUID()` does.
pub(super) fn record_sent_prompt(
    text: &str,
    session_key: Option<&str>,
    delivery_id: Option<&str>,
    timestamp: &str,
    now_ms: i64,
) -> Result<bool, &'static str> {
    if text.trim().is_empty() {
        return Ok(false);
    }
    let parts: Vec<&str> = session_key
        .map(|key| key.split(':').collect())
        .unwrap_or_default();
    let prompt_id = format!(
        "sent:{}",
        delivery_id
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
    );
    let prompt = SentPrompt {
        prompt_id: prompt_id.clone(),
        content: text.to_string(),
        created_at: timestamp.to_string(),
        updated_at: timestamp.to_string(),
        cwd: None,
        // `projectId` is the second-to-last segment and `sessionId` the last, so a remote key's
        // `remote-<machineId>:` prefix falls away on its own.
        project_id: if parts.len() >= 2 {
            parts.get(parts.len() - 2).map(|part| (*part).to_string())
        } else {
            None
        },
        project_name: None,
        session_id: parts
            .last()
            .filter(|part| !part.is_empty())
            .map(|part| (*part).to_string()),
    };
    let raw = serde_json::to_string(&prompt).map_err(|_| "schema")?;
    storage::write(
        &StorageKey {
            store: "sentHistory".to_string(),
            suffix: prompt_id,
        },
        Some(&raw),
        now_ms,
    )?;
    Ok(true)
}

/// Records a delivery the daemon reported, once.
///
/// `ghostex.sessionChat.delivered.<projectId>:<sessionId>` holds a JSON array of delivery ids,
/// appended and then truncated to the newest 50. The session key here is built from the delivery's
/// own ids and carries NO `remote-<machineId>:` prefix, unlike every other per-session key.
/// The receipt is written only after the history write succeeded, so a failed history write is
/// retried rather than silently lost.
pub(super) fn record_delivered_draft(
    delivery_id: &str,
    project_id: &str,
    session_id: &str,
    text: &str,
    delivered_at: &str,
    now_ms: i64,
) -> Result<(), &'static str> {
    let session_key = format!("{project_id}:{session_id}");
    let key = StorageKey {
        store: "deliveryReceipts".to_string(),
        suffix: session_key.clone(),
    };
    let mut seen: Vec<String> = storage::read(&key, now_ms)?
        .filter(|raw| !raw.is_empty())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    if seen.iter().any(|id| id == delivery_id) {
        return Ok(());
    }
    if !record_sent_prompt(
        text,
        Some(&session_key),
        Some(delivery_id),
        delivered_at,
        now_ms,
    )? {
        return Ok(());
    }
    seen.push(delivery_id.to_string());
    if seen.len() > MAX_SENT_MESSAGES {
        seen.drain(..seen.len() - MAX_SENT_MESSAGES);
    }
    let raw = serde_json::to_string(&seen).map_err(|_| "schema")?;
    storage::write(&key, Some(&raw), now_ms)
}
