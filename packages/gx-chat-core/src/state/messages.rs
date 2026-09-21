//! The authoritative transcript: the merged message list, where the stream stands, and how far
//! back the history window reaches.
//!
//! Owned by family a. Family b projects `composed` into rows and must not write anything here.
//!
//! Anti-drop law, carried over from `packages/core-ui/chat/session-chat-merge.ts`: the live list
//! only ever grows. Reads window the history they seed; appends are never trimmed, because a trim
//! removes the OLDEST rows and the pagination cursor cannot reach them again.

use std::collections::BTreeMap;

use ghostex_gx_protocol::ChatMessage;

use crate::wire::StreamPosition;

/// The transcript and its bookkeeping.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MessagesState {
    /// The authoritative list in first-seen order, id-deduplicated by the merger.
    pub list: Vec<ChatMessage>,
    /// `id` to index into `list`. Ordered so a rebuild is deterministic across platforms.
    pub index_by_id: BTreeMap<String, usize>,
    /// The list the renderer sees: the transcript plus markers, terminal statuses, the streaming
    /// bubble and the pending echoes, in the composition order of `controller.ts`.
    pub composed: Vec<ChatMessage>,
    /// Where the accepted stream stands.
    pub position: FramePosition,
    /// The window the next read asks for. Grows with the live list so a reconnect's snapshot never
    /// comes back smaller than what is already on screen.
    pub limit: u32,
    /// Byte cursor after the most recently accepted history window.
    pub before_offset: u64,
    pub has_more: bool,
    pub loading_earlier: bool,
    /// The epoch the detail-mode history prefix belongs to, or `None` when no prefix is held.
    pub history_epoch: Option<i64>,
    /// How many rows of that prefix are held, so the read window can exclude them.
    pub history_prefix_count: usize,
    /// The cursor the automatic boundary fill already tried, so it runs once per cursor.
    pub boundary_attempt: Option<u64>,
    /// The page read in flight, if any.
    pub load_earlier_request: Option<LoadEarlierRequest>,
    /// Bumped every time the subscription is rebuilt. A read in flight across the swap belongs to
    /// the previous conversation and must not apply.
    pub generation: u64,
    pub resync: ResyncState,
    /// When a frame, or a read that stood in for one, last reached this session.
    pub last_frame_at_ms: f64,
    /// When the stall watchdog last asked for a resync, so it cannot fire twice in a row.
    pub last_watchdog_resync_at_ms: f64,
    /// Automatic socket recycles spent on this session. Bounded, because a transport that is
    /// simply down would otherwise reconnect forever.
    pub auto_reconnects: u32,
    /// When the current seed-read patience window opened.
    pub seed_started_at_ms: f64,
    /// How many seed reads have been retried inside that window.
    pub seed_attempt: u32,
}

/// Where the accepted stream stands, and whether it ever started.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FramePosition {
    /// The follower generation, or `None` before the first authoritative frame or read.
    pub epoch: Option<i64>,
    pub seq: i64,
    /// The daemon that owns the epoch. A different one restarts the numbering.
    pub server_id: String,
    /// Whether any frame has arrived at all, which is what the initial-window watchdog gates on.
    pub frame_arrived: bool,
}

impl FramePosition {
    /// This position as a comparable stream position.
    pub fn stream_position(&self) -> StreamPosition {
        StreamPosition {
            server_id: self.server_id.clone(),
            epoch: self.epoch.unwrap_or(0),
            seq: self.seq,
        }
    }
}

/// The resync flight's own bookkeeping, kept apart from the page read.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ResyncState {
    /// A resync read is in flight; a second gap must not start another.
    pub in_flight: bool,
    /// The newest frame position observed while that read was in flight, because the read answers
    /// from a position the server captured before it.
    pub seen_in_flight: Option<StreamPosition>,
    /// Paced follow-ups spent chasing bytes a successful read outran.
    pub follow_ups: u32,
    /// Reads that never landed, retried on their own backoff. A shared counter would let one
    /// budget exhaust the other.
    pub failures: u32,
}

/// The page read the user asked for, identified so a cancelled answer cannot complete a newer
/// request in the same epoch.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LoadEarlierRequest {
    pub epoch: Option<i64>,
    pub before_offset: u64,
    /// The generation that issued it.
    pub generation: u64,
}
