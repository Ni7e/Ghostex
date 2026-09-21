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
    let client_id = client_id(now_ms, errors);
    let stored = load("drafts", session_key, now_ms, errors).map(|raw| decode_stored_draft(&raw));
    let entry = entry_with_version(stored.as_ref());
    let model_catalog = parse(load("modelCatalog", "", now_ms, errors));
    let claude_context = parse(load("claudeContext", "", now_ms, errors));
    let codex_context = parse(load("codexContext", "", now_ms, errors));
    let dismissed_notice = parse(load("notices", session_key, now_ms, errors));
    let summary_mode = decode_summary(load("summary", session_key, now_ms, errors).as_deref());
    let verbose_override = decode_verbose(load("verbose", session_key, now_ms, errors).as_deref());
    ComposerBootRead {
        session_key: session_key.to_string(),
        client_id,
        entry,
        next_version: next_draft_version(),
        option_states: scoped("sessionOptions", session_key, now_ms, errors),
        model_outboxes: scoped("modelOutbox", session_key, now_ms, errors),
        model_catalog,
        // The two settings arrive as a push (`Event::SettingsChanged`) as well, and the push is the
        // authority; this is only what the first frame draws with.
        chat_settings: json!({"hideAccountEmails": false, "title": Value::Null}),
        context_preferences: json!({ "claude": claude_context, "codex": codex_context }),
        dismissed_notice,
        summary_mode,
        verbose_override: match verbose_override {
            Some(verbose) => Value::Bool(verbose),
            None => Value::Null,
        },
    }
}

/// `sessionChatDraftClientId()`: this computer's opaque draft-origin id, minted on first sight.
///
/// CDXC:Drafts 2026-09-10 WHY:
/// It is PERSISTED, and the startup outbox replay uses the same one as the composer: a fresh id
/// every mount makes this client's own last push look like another device and pops the conflict bar
/// against itself. The Step 4 host read the record and answered with an empty string when it was
/// absent, which is a fresh install, a new profile, or any user who had never opened chat: every
/// draft echo then came back unattributed and the outbox rows carried no `clientId` at all. The
/// shape is `packages/shared/session-chat-controller/client-id.ts`'s, `gx-` then two base-36 runs,
/// because an id is compared and stored but never parsed. A refused write is counted and the
/// in-memory id is used anyway, which is what the TypeScript's `catch` does for private mode.
fn client_id(now_ms: i64, errors: &mut usize) -> String {
    let key = StorageKey {
        store: "chatClient".to_string(),
        suffix: String::new(),
    };
    if let Some(stored) = load("chatClient", "", now_ms, errors) {
        return stored;
    }
    let created = format!(
        "gx-{}{}",
        base36(u64::from_be_bytes(
            uuid::Uuid::new_v4().into_bytes()[..8]
                .try_into()
                .unwrap_or_default()
        )),
        base36(now_ms.max(0) as u64)
    );
    if storage::write(&key, Some(&created), now_ms).is_err() {
        *errors += 1;
    }
    created
}

/// `Number.prototype.toString(36)`: lower-case digits, most significant first.
fn base36(mut value: u64) -> String {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".to_string();
    }
    let mut out = Vec::new();
    while value > 0 {
        out.push(DIGITS[(value % 36) as usize]);
        value /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

/// One stored record, or `None` when it is absent, empty or unreadable.
fn load(store: &str, suffix: &str, now_ms: i64, errors: &mut usize) -> Option<String> {
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

/// `{ "<sessionKey>[#<scope>]": <value> }` for every stored record of this session.
///
/// `storedSessionChatOptionKeys` and `storedModelSelectionKeys` take exactly the keys that are the
/// session key itself or start with `<sessionKey>#`, and hand back the part after the store's own
/// prefix. The `#` scope is how one session's pills are remembered per worktree or per draft agent,
/// so a session with scopes whose unscoped row alone was read opened on another scope's options.
fn scoped(store: &str, session_key: &str, now_ms: i64, errors: &mut usize) -> Value {
    let rows = match storage::scan(store, session_key, now_ms) {
        Ok(rows) => rows,
        Err(_) => {
            *errors += 1;
            return Value::Object(Map::new());
        }
    };
    let mut states = Map::new();
    for (suffix, raw) in rows {
        // The scan is a prefix scan, so a sibling session whose key merely starts with this one's
        // (`p:s` against `p:s2`) would come back too. Only the key itself and its `#` scopes count.
        if suffix != session_key && !suffix.starts_with(&format!("{session_key}#")) {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(&raw) {
            states.insert(suffix, value);
        }
    }
    Value::Object(states)
}

/// A stored JSON record, or `null` when it is missing or unreadable.
fn parse(raw: Option<String>) -> Value {
    raw.and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or(Value::Null)
}
