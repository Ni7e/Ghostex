//! The context one recorded bridge call ran at, read off its seam line.

use serde_json::Value;

use crate::state::ChatContext;

/// The [`ChatContext`] a recorded call ran at: its clock reads, random draws and ids.
///
/// Two readers of the seam need this and must agree: `examples/replay.rs` and the desktop shadow.
/// The line's `ms` is the RECORDER's clock, read just before the call; `c` is every read the brain
/// itself made inside it, in order. `c[0]` is the call's clock (`tick` fires timers against it,
/// the first `useState(Date.now)` latches it) and differs from `ms` by a millisecond on a few
/// percent of calls; the later reads are what a rule that latches past the first read takes (the
/// stall watchdog's `now`, `setNow` inside an interval, `accountStatus.now`). A reader that uses
/// `ms` for every read ships a latched clock one millisecond off for the rest of the run: that was
/// the whole of the shadow's `accountStatus` difference on the 2026-09-22 recordings. `r` fills
/// [`ChatContext::random_units`] and `u` [`ChatContext::random_ids`].
pub fn recorded_context(record: &Value, utc_offset_minutes: i32) -> ChatContext {
    let recorded_ms = record.get("ms").and_then(Value::as_f64).unwrap_or(0.0);
    let clock_reads: Vec<f64> = record
        .get("c")
        .and_then(Value::as_array)
        .map(|reads| reads.iter().filter_map(Value::as_f64).collect())
        .unwrap_or_default();
    let mut context = ChatContext::at(clock_reads.first().copied().unwrap_or(recorded_ms))
        .with_utc_offset_minutes(utc_offset_minutes)
        .with_clock_reads(clock_reads);
    if let Some(draws) = record.get("r").and_then(Value::as_array) {
        for (slot, draw) in draws.iter().take(context.random_units.len()).enumerate() {
            context.random_units[slot] = draw.as_f64().unwrap_or(0.0);
        }
    }
    // The core takes ids as numbers so its context stays `Copy`; parsing the recorded text back
    // and letting `ChatContext::random_id` print it again round-trips to the same string.
    if let Some(ids) = record.get("u").and_then(Value::as_array) {
        for (slot, id) in ids.iter().take(context.random_ids.len()).enumerate() {
            context.random_ids[slot] = id.as_str().map(uuid_bits).unwrap_or_default();
        }
    }
    context
}

/// A recorded `crypto.randomUUID()` as the number [`ChatContext::random_id`] prints back.
fn uuid_bits(text: &str) -> u128 {
    let mut bits = 0u128;
    for digit in text.chars().filter_map(|unit| unit.to_digit(16)) {
        bits = (bits << 4) | u128::from(digit);
    }
    bits
}
