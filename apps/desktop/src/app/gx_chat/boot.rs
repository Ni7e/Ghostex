//! `Effect::ReadComposerBoot`: the one read the chat waits for before it publishes anything.
//!
//! The QuickJS brain's `start` awaits `composer('read')` and only then builds its controller, and
//! `ChatCore::republish` reproduces that: nothing ships until [`ComposerBootRead`] lands. This is
//! the Rust port of `nativeComposerRequest(sessionKey, {operation: 'read'})` in
//! `apps/desktop/sidebar/session-chat-runtime/native-composer.ts`, key for key and in the same
//! write order.

use ghostex_gx_chat_core::composer::storage::{
    StoredDraftRecord, decode_stored_draft, decode_summary, decode_verbose,
};
use ghostex_gx_chat_core::{ComposerBootRead, StorageKey};
use serde_json::{Map, Value, json};

use super::storage;

/// Reads everything the chat needs at boot for one session.
///
/// Every read that fails is treated as "nothing stored", which is what the TypeScript's `catch`
/// around each accessor does; the caller counts the refusals.
pub(super) fn read(session_key: &str, now_ms: i64, errors: &mut usize) -> ComposerBootRead {
    let mut load = |store: &str, suffix: &str| -> Option<String> {
        match storage::read(
            &StorageKey {
                store: store.to_string(),
                suffix: suffix.to_string(),
            },
            now_ms,
        ) {
            Ok(value) => value.filter(|raw| !raw.is_empty()),
            Err(_) => {
                *errors += 1;
                None
            }
        }
    };

    let client_id = load("chatClient", "").unwrap_or_default();
    let stored = load("drafts", session_key).map(|raw| decode_stored_draft(&raw));
    let entry = entry_with_version(stored.as_ref());
    ComposerBootRead {
        session_key: session_key.to_string(),
        client_id,
        entry,
        next_version: next_draft_version(),
        // The scoped option and model-outbox keys (`<sessionKey>#<scope>`) need a prefix scan of the
        // `records` table, which the Rust door does not have. The unscoped key is the one every
        // session has, so it is read and the scoped ones are left to the first write.
        option_states: single(session_key, load("sessionOptions", session_key)),
        model_outboxes: single(session_key, load("modelOutbox", session_key)),
        model_catalog: parse(load("modelCatalog", "")),
        // The two settings arrive as a push (`Event::SettingsChanged`) as well, and the push is the
        // authority; this is only what the first frame draws with.
        chat_settings: json!({"hideAccountEmails": false, "title": Value::Null}),
        context_preferences: json!({
            "claude": parse(load("claudeContext", "")),
            "codex": parse(load("codexContext", "")),
        }),
        dismissed_notice: parse(load("notices", session_key)),
        summary_mode: decode_summary(load("summary", session_key).as_deref()),
        verbose_override: match decode_verbose(load("verbose", session_key).as_deref()) {
            Some(verbose) => Value::Bool(verbose),
            None => Value::Null,
        },
    }
}

/// `entry: { ...stored, version }`.
///
/// CDXC:Drafts 2026-09-19 WHY:
/// A stored revision is reused only when the entry is neither submitted nor parked. A parked draft
/// was handed to the terminal, so the composer opens empty; reusing its revision made the next blur
/// save claim "" under the revision gxserver holds for the handed-off text, and every save failed
/// with "Two editors changed the same draft revision". It starts a fresh draft instead, which is
/// what the live handoff already does with `nextVersion`.
///
/// With nothing stored the object holds ONLY `version`, because `{ ...null, version }` has no other
/// key. A caller that expects `text` to be present would read a default it was never given.
fn entry_with_version(stored: Option<&StoredDraftRecord>) -> Value {
    let reuse = stored.and_then(|record| {
        if record.submitted || record.parked {
            return None;
        }
        record.version.clone()
    });
    let version = match reuse {
        Some(version) => json!({"draftId": version.draft_id, "revision": version.revision}),
        None => next_draft_version(),
    };
    let Some(record) = stored else {
        return json!({ "version": version });
    };
    let mut entry = Map::new();
    entry.insert("text".into(), Value::String(record.text.clone()));
    if let Some(updated_at) = record.updated_at {
        entry.insert("updatedAt".into(), Value::from(updated_at));
    }
    entry.insert("submitted".into(), Value::Bool(record.submitted));
    entry.insert("parked".into(), Value::Bool(record.parked));
    entry.insert("version".into(), version);
    Value::Object(entry)
}

/// `nextSessionChatDraftVersion()`: a fresh identity at revision 1.
///
/// The core generates no ids on purpose (it reads no random source and must cross UniFFI), so the
/// host mints them, in the same v4 shape `crypto.randomUUID()` produces inside QuickJS.
pub(super) fn next_draft_version() -> Value {
    json!({"draftId": uuid::Uuid::new_v4().to_string(), "revision": 1})
}

/// `{ "<key>": <value> }`, or an empty object when nothing is stored.
fn single(key: &str, raw: Option<String>) -> Value {
    match raw.and_then(|raw| serde_json::from_str::<Value>(&raw).ok()) {
        Some(value) => json!({ key: value }),
        None => Value::Object(Map::new()),
    }
}

/// A stored JSON record, or `null` when it is missing or unreadable.
fn parse(raw: Option<String>) -> Value {
    raw.and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or(Value::Null)
}
