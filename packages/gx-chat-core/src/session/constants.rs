//! Every number family a's rules depend on, in one place.
//!
//! Each one is carried over verbatim from the TypeScript named beside it. Changing one here
//! changes behaviour, so they are constants rather than literals scattered through the port.

/// The first read's window. `packages/core-ui/chat/session-chat-pagination.ts`.
pub const INITIAL_LIMIT: u32 = 300;
/// How much one "Load earlier" adds.
pub const PAGE: u32 = 200;
/// Mirrors gxserver's own clamp in `server/src/session_chat.rs`.
pub const MAX_LIMIT: u32 = 10_000;

/// Client-side not-found and starting retry patience, `use-session-chat/state.ts`.
pub const NOT_FOUND_RETRY_DELAYS_MS: [u64; 4] = [1_000, 2_000, 4_000, 8_000];
pub const NOT_FOUND_RETRY_FIXED_DELAY_MS: u64 = 10_000;
pub const NOT_FOUND_RETRY_WINDOW_MS: f64 = 60_000.0;

/// A resync read answers from a stream position captured before it, so frames landing while it is
/// in flight can outrun its result. One paced follow-up covers those bytes; the cap stops a
/// continuously streaming turn from turning follow-ups into a read loop.
pub const RESYNC_FOLLOW_UP_DELAY_MS: u64 = 250;
pub const MAX_RESYNC_FOLLOW_UPS: u32 = 4;

/// The read deadline. It does not cancel the request, it settles the state machine: a read that
/// never resolves would otherwise pin the resync flight and freeze every later gap verdict.
pub const READ_TIMEOUT_MS: u64 = 30_000;

/// A resync read that fails, including by timeout, must keep retrying: nothing else re-reads, and
/// the gap that asked for it has already been consumed.
pub const RESYNC_RETRY_DELAYS_MS: [u64; 4] = [1_000, 2_000, 4_000, 8_000];
pub const RESYNC_RETRY_MAX_DELAY_MS: u64 = 15_000;

/// Liveness floor. A silently dead follower delivers no frames at all, so no gap is ever observed
/// and the fold rules never fire.
pub const STALL_THRESHOLD_MS: f64 = 20_000.0;
pub const STALL_CHECK_INTERVAL_MS: u64 = 5_000;

/// Initial-window liveness floor. Shorter, because nothing is on screen yet and a resync read
/// cannot recover a socket whose subscribe snapshot was lost; only a fresh socket can.
pub const INITIAL_STALL_THRESHOLD_MS: f64 = 15_000.0;
/// Automatic socket recycles per session mount. Past this the manual Retry button is the only
/// recovery.
pub const MAX_AUTOMATIC_RECONNECTS: u32 = 2;

/// Clock skew slack when a lifecycle boundary settles a turn, REAL epochs only.
/// `packages/core-ui/chat/session-chat-working-status.ts`.
pub const LIFECYCLE_CLOCK_SKEW_SLACK_MS: i64 = 2_000;
/// The gate that keeps small logical clocks (fixtures) strictly ordered.
pub const REAL_EPOCH_FLOOR_MS: i64 = 100_000_000_000;

/// How many optimistic echoes and command markers are kept.
/// `packages/core-ui/chat/session-chat-pending.ts`.
pub const PENDING_SEND_LIMIT: usize = 8;
pub const COMMAND_MARKER_LIMIT: usize = 8;

/// Clock slack between the client's interrupt marker and the transcript's own row.
/// `packages/core-ui/chat/session-chat-returned-prompt.ts`.
pub const INTERRUPT_MARKER_MATCH_SLACK_MS: i64 = 15_000;
/// Marker command for a chat-box Escape; rendered through its label.
pub const INTERRUPT_MARKER_COMMAND: &str = "interrupt";
pub const INTERRUPT_MARKER_LABEL: &str = "Interrupted the agent";
/// The transcript row the agent writes for a turn interrupted mid-response.
pub const TRANSCRIPT_INTERRUPTED_TEXT: &str = "conversation interrupted";

/// How many returned-prompt ids are remembered, so a reload inside the server's window cannot
/// stack a second copy above what the user has typed since.
pub const RETURNED_PROMPT_APPLIED_LIMIT: usize = 32;

/// The retained snapshot's bounds, `apps/desktop/sidebar/session-chat-runtime/persistence.ts`.
pub const PERSISTED_MAX_RECORD_BYTES: usize = 2 * 1024 * 1024;
pub const PERSISTED_MAX_AGE_MS: f64 = 7.0 * 24.0 * 60.0 * 60.0 * 1_000.0;

/// The retained session's bounds, `apps/desktop/sidebar/session-chat-runtime/store.ts`.
pub const MAX_RETAINED_SESSIONS: usize = 12;
pub const IDLE_RETENTION_MS: f64 = 5.0 * 60.0 * 1_000.0;
pub const MAX_RETAINED_MESSAGES: usize = 1_200;
pub const MAX_RETAINED_BYTES: usize = 4 * 1024 * 1024;
/// How long a store resync waits, `min(250 * 2^n, 10_000)`.
pub const STORE_RESYNC_BASE_DELAY_MS: u64 = 250;
pub const STORE_RESYNC_MAX_DELAY_MS: u64 = 10_000;
/// How long the store waits before writing the snapshot it just folded.
pub const STORE_PERSISTENCE_DEBOUNCE_MS: u64 = 1_000;

/// The default verified command catalog for local "Ran /x" markers.
/// `packages/core-ui/chat/session-chat-send-classification.ts`.
pub const DEFAULT_COMMAND_CATALOG: [&str; 5] = ["clear", "compact", "exit", "help", "model"];

/// The synthetic streaming bubble's id.
pub const STREAMING_ID: &str = "streaming";
/// Id prefixes that decide a row's sort tier.
pub const PENDING_ID_PREFIX: &str = "pending:";
pub const LAUNCH_PENDING_ID_PREFIX: &str = "launch-pending:";
pub const COMMAND_MARKER_ID_PREFIX: &str = "command:";
pub const TERMINAL_TOOL_ID_PREFIX: &str = "terminal-tool:";
/// How long a missing terminal sample is held before the tool row drops, which bridges the
/// terminal's repaint gaps. `packages/core-ui/chat/session-chat-terminal-status.ts`.
pub const TERMINAL_TOOL_HOLD_MS: f64 = 5_000.0;

/// The `notFound` retry delay for `attempt`, zero-based.
pub fn not_found_retry_delay_ms(attempt: u32) -> u64 {
    NOT_FOUND_RETRY_DELAYS_MS
        .get(attempt as usize)
        .copied()
        .unwrap_or(NOT_FOUND_RETRY_FIXED_DELAY_MS)
}

/// The resync retry delay for `attempt`, zero-based.
pub fn resync_retry_delay_ms(attempt: u32) -> u64 {
    RESYNC_RETRY_DELAYS_MS
        .get(attempt as usize)
        .copied()
        .unwrap_or(RESYNC_RETRY_MAX_DELAY_MS)
}
