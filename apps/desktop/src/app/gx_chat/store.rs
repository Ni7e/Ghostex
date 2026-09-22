//! The retained chats: one `ChatCore` per session, and the four limits that decide how many.
//!
//! CDXC:SessionChat 2026-09-22 WHY:
//! One core per SESSION rather than one brain per open view, which is what removes the warm pool.
//! Booting a QuickJS chat view cost about 300 ms against about 25 ms for a warm paint, so
//! `session_chat_prewarm.rs` kept 24 of them alive and `session_chat_warm_pool.rs` evicted them by
//! last render. A retained core in this map costs neither, so switching chats is a lookup: the
//! folded transcript, the pagination window and the read clocks are already there.
//!
//! The limits are `apps/desktop/sidebar/session-chat-runtime/store.ts`, which the user approved:
//! chat data and live subscriptions are retained independently of mounted views.

use std::collections::BTreeMap;

use ghostex_gx_chat_core::ChatCore;
use web_time::Instant;

use super::identity::ChatIdentity;

/// `MAX_RETAINED_SESSIONS`.
const MAX_RETAINED_SESSIONS: usize = 12;
/// `IDLE_RETENTION_MS`: how long a chat nobody is watching stays folded.
const IDLE_RETENTION: std::time::Duration = std::time::Duration::from_secs(5 * 60);
/// `MAX_RETAINED_MESSAGES`.
const MAX_RETAINED_MESSAGES: usize = 1_200;
/// `MAX_RETAINED_BYTES`.
const MAX_RETAINED_BYTES: usize = 4 * 1024 * 1024;
/// How often an idle chat's size is re-measured. Measuring it is a walk of the whole transcript.
const SIZE_RECHECK: std::time::Duration = std::time::Duration::from_secs(5);

/// One retained chat.
pub(super) struct Retained {
    /// Who this chat is. Kept beside the core because a prune drops the map entry, and a later read
    /// of the storage session key must not have to rebuild it from the retention key.
    #[allow(dead_code)]
    pub(super) identity: ChatIdentity,
    pub(super) core: ChatCore,
    /// The storage session key, built once because every record's suffix starts from it.
    pub(super) session_key: String,
    /// How many views are watching. A chat with none is a prune candidate.
    pub(super) listeners: usize,
    /// When a view last called into it, which is what the LRU and the idle expiry read.
    pub(super) touched_at: Instant,
    /// When this chat's size was last measured.
    measured_at: Option<Instant>,
}

impl Retained {
    fn new(identity: ChatIdentity) -> Self {
        let session_key = identity.storage_session_key();
        Self {
            identity,
            core: ChatCore::new(),
            session_key,
            listeners: 0,
            touched_at: Instant::now(),
            measured_at: None,
        }
    }

    /// Whether this chat has outgrown what the store keeps.
    ///
    /// The size is measured at most every five seconds, because it is a walk of the whole document.
    fn oversized(&mut self) -> bool {
        if self.core.state().messages.composed.len() > MAX_RETAINED_MESSAGES {
            return true;
        }
        if self
            .measured_at
            .is_some_and(|at| at.elapsed() < SIZE_RECHECK)
        {
            return false;
        }
        self.measured_at = Some(Instant::now());
        // UTF-16 accounting, the same conservative measure the TypeScript takes of its snapshot.
        serde_json::to_string(self.core.document())
            .map(|text| text.encode_utf16().count() * 2 > MAX_RETAINED_BYTES)
            .unwrap_or(false)
    }
}

/// Every retained chat, keyed by `JSON.stringify([machineId, projectId, sessionId])`.
#[derive(Default)]
pub(super) struct ChatStore {
    retained: BTreeMap<String, Retained>,
    /// Chats dropped by a limit since the last summary.
    pub(super) evicted: u64,
}

impl ChatStore {
    /// The chat for an identity, created on first sight.
    pub(super) fn entry(&mut self, identity: &ChatIdentity) -> &mut Retained {
        self.retained
            .entry(identity.retention_key())
            .or_insert_with(|| Retained::new(identity.clone()))
    }

    pub(super) fn get_mut(&mut self, key: &str) -> Option<&mut Retained> {
        self.retained.get_mut(key)
    }

    pub(super) fn get(&self, key: &str) -> Option<&Retained> {
        self.retained.get(key)
    }

    pub(super) fn len(&self) -> usize {
        self.retained.len()
    }

    /// Drops one chat, whatever its limits say. The caller owns the reason.
    pub(super) fn remove(&mut self, key: &str) {
        self.retained.remove(key);
    }

    /// Drops what the four limits no longer keep, and names what it dropped.
    ///
    /// A chat with a listener is never dropped, whatever its size: the view attached to it is
    /// drawing from it. An oversized chat is DISPOSED rather than sliced, because slicing the
    /// transcript would leave the server's pagination cursor pointing at a row that is gone.
    ///
    /// The answer is `(retention key, storage session key)` per dropped chat, because the maps
    /// BESIDE this one are keyed by both and a chat's entry in them must not outlive the chat: the
    /// timers, the retry worker, the park answer, the held requests and the delivery ids are all
    /// per chat, and the saves in flight are per session key.
    pub(super) fn prune(&mut self) -> Vec<(String, String)> {
        let mut dropped: Vec<(String, String)> = Vec::new();
        let mut expired: Vec<String> = Vec::new();
        for (key, retained) in self.retained.iter_mut() {
            if retained.listeners > 0 {
                continue;
            }
            if retained.touched_at.elapsed() >= IDLE_RETENTION || retained.oversized() {
                expired.push(key.clone());
            }
        }
        for key in expired {
            if let Some(retained) = self.retained.remove(&key) {
                dropped.push((key, retained.session_key));
            }
            self.evicted += 1;
        }
        while self.retained.len() > MAX_RETAINED_SESSIONS {
            let Some(oldest) = self
                .retained
                .iter()
                .filter(|(_, retained)| retained.listeners == 0)
                .min_by_key(|(_, retained)| retained.touched_at)
                .map(|(key, _)| key.clone())
            else {
                // Every retained chat has a view watching it. The cap is a retention limit, not a
                // reason to tear down a chat somebody is looking at.
                break;
            };
            if let Some(retained) = self.retained.remove(&oldest) {
                dropped.push((oldest, retained.session_key));
            }
            self.evicted += 1;
        }
        dropped
    }
}
