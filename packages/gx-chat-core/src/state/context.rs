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
}

impl ChatContext {
    /// A context at `now_ms` in UTC, for a host that has not wired its offset yet.
    pub fn at(now_ms: f64) -> Self {
        Self {
            now_ms,
            utc_offset_minutes: 0,
            random_units: [0.0; 2],
        }
    }

    /// `now_ms` as the integer milliseconds every stored timestamp is compared against.
    ///
    /// Rounded rather than truncated so a host that passes a fractional clock cannot drift a
    /// comparison by a millisecond against one that passes whole numbers.
    pub fn now_millis(&self) -> i64 {
        self.now_ms.round() as i64
    }
}
