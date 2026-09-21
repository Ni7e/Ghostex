//! What the host tells the core about the world outside it, once per turn.
//!
//! The core reads no clock and knows no timezone, so both arrive here. A replay that feeds the
//! recorded values back therefore reproduces the document exactly, including the "Today" and
//! "Yesterday" boundaries the transcript computes against local midnight.

use serde::{Deserialize, Serialize};

/// The host's clock and locale for this turn.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatContext {
    /// Epoch milliseconds, the same number `Date.now()` returns.
    ///
    /// Every deadline, elapsed label, retry backoff and settle hold is measured against it.
    pub now_ms: f64,
    /// Minutes to add to UTC to get the user's local time, the negation of
    /// `Date.prototype.getTimezoneOffset()`.
    ///
    /// `packages/shared/session-chat-presentation/message-time.ts` groups rows by local midnight,
    /// which is the only timezone-dependent rule in the brain.
    pub utc_offset_minutes: i32,
    /// The host's uniform random draws for this turn, in `[0, 1)`, consumed in order.
    ///
    /// The core generates no random values. The one rule that needs them is the working strip's
    /// stint word (`pickSessionChatWorkingWord`), and it can draw twice in a single turn: the
    /// `useState` initializer, then the `useEffect` that immediately replaces it when the first
    /// computation already sees a working session. Two slots is therefore the whole supply, and a
    /// replay feeds the recorded `Math.random()` queue straight into it
    /// (`docs/2026-09-21/rust-chat/REPLAY.md`).
    pub random_units: [f64; 2],
    /// The host's fresh random ids for this turn, consumed in order.
    ///
    /// The core mints no identities either. Two rules need one: the model-selection intent
    /// (`crypto.randomUUID()` in `model-selection.ts`) and the model picker's request id. A host
    /// passes two draws of 128 random bits, [`ChatContext::random_id`] lays them out as a
    /// version 4 UUID, and a replay parses the recorded `u` queue back into the same numbers, so
    /// the id the two brains write is the same string.
    ///
    /// Numbers rather than strings so this type stays `Copy` and stays UniFFI friendly.
    pub random_ids: [u128; 2],
}

impl ChatContext {
    /// A context at `now_ms` in UTC, for a host that has not wired its offset yet.
    pub fn at(now_ms: f64) -> Self {
        Self {
            now_ms,
            utc_offset_minutes: 0,
            random_units: [0.0; 2],
            random_ids: [0; 2],
        }
    }

    /// One of the turn's random ids, as the canonical lowercase UUID text.
    ///
    /// The version and variant bits are forced the way `crypto.randomUUID()` sets them, so a host
    /// may pass raw entropy and a replay may pass a recorded UUID parsed back to a number: both
    /// print the same string.
    pub fn random_id(&self, slot: usize) -> String {
        let bits = self.random_ids.get(slot).copied().unwrap_or_default();
        let bytes = bits.to_be_bytes();
        let mut out = String::with_capacity(36);
        for (index, byte) in bytes.iter().enumerate() {
            if matches!(index, 4 | 6 | 8 | 10) {
                out.push('-');
            }
            let byte = match index {
                6 => (byte & 0x0f) | 0x40,
                8 => (byte & 0x3f) | 0x80,
                _ => *byte,
            };
            out.push(char::from_digit(u32::from(byte >> 4), 16).unwrap_or('0'));
            out.push(char::from_digit(u32::from(byte & 0x0f), 16).unwrap_or('0'));
        }
        out
    }

    /// `now_ms` as the integer milliseconds every stored timestamp is compared against.
    ///
    /// Rounded rather than truncated so a host that passes a fractional clock cannot drift a
    /// comparison by a millisecond against one that passes whole numbers.
    pub fn now_millis(&self) -> i64 {
        self.now_ms.round() as i64
    }
}
