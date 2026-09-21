//! One line of the replay seam, read in memory instead of out of a recording file.
//!
//! The format is `docs/2026-09-21/rust-chat/REPLAY.md`: a header line, then one JSON object per
//! call that reached `globalThis.nativeChat`, carrying the method, its arguments, the clock the
//! recorder read immediately before it, and every non-deterministic value the brain read while it
//! ran. A record is written when the NEXT one begins, so a shadow reads each call one turn late,
//! with everything its continuations did already attributed to it.

use serde_json::Value;

/// One call the live brain took, as the seam reported it.
pub(super) struct ShadowRecord {
    /// The bridge method: `start`, `action`, `brokerMessage`, `event`, `resolve`, `tick`, `take`,
    /// or one of the five pure helpers.
    pub(super) method: String,
    /// The arguments exactly as they crossed the bridge.
    pub(super) arguments: Vec<Value>,
    /// `Date.now()` as the recorder read it immediately before the call: this record's `now_ms`.
    pub(super) now_ms: f64,
    /// Every `Math.random()` the live brain drew during the call, in order.
    pub(super) random: Vec<f64>,
    /// The fingerprint of a pure helper's answer, for the records that carry one.
    pub(super) hash: Option<String>,
}

impl ShadowRecord {
    /// Parses one line, or `None` for the header, a blank line, or a line that is not a record.
    ///
    /// The recorded clock queue (`c`) and id queue (`u`) are deliberately not read. The core takes
    /// its clock from `ms` and generates no ids at all, which is the same choice
    /// `packages/gx-chat-core/examples/replay.rs` makes; a core that grew a second clock read
    /// inside one call would show up as a difference rather than being papered over here.
    pub(super) fn parse(line: &str) -> Option<Self> {
        let record: Value = serde_json::from_str(line).ok()?;
        let kind = record.get("k").and_then(Value::as_str)?;
        if !matches!(kind, "in" | "doc" | "query") {
            return None;
        }
        Some(Self {
            method: record.get("m").and_then(Value::as_str)?.to_string(),
            arguments: record
                .get("a")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
            now_ms: record.get("ms").and_then(Value::as_f64).unwrap_or(0.0),
            random: record
                .get("r")
                .and_then(Value::as_array)
                .map(|draws| draws.iter().filter_map(Value::as_f64).collect())
                .unwrap_or_default(),
            hash: record
                .get("hash")
                .and_then(Value::as_str)
                .map(str::to_string),
        })
    }
}
