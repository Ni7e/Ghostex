//! Which notice the user closed, and how long closing it keeps the same words off the screen.
//!
//! Port of `packages/shared/session-chat-controller/notice-state.ts`. The stored record is
//! unchanged, including the pre-2026-09-03 form that held only the dismissed key.

use serde::{Deserialize, Serialize};

use crate::questions::model::TerminalNotice;

/// How long the same screen-state notice stays hidden after being dismissed, even when it comes
/// back under a new `detectedAt`.
///
/// A usage limit or an expired login lasts far longer than this, and a user who closed the card
/// knows about it; after this long a re-detection is worth mentioning again.
pub const NOTICE_REDISPLAY_COOLDOWN_MS: i64 = 30 * 60 * 1000;

/// The dismissal one session remembers.
///
/// The field order is the stored key order, because this is written straight to client storage.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DismissedNotice {
    /// Wall-clock millis of the dismissal.
    #[serde(default)]
    pub dismissed_at: i64,
    /// Whether the cooldown applies: only screen-state notices re-detect continuously.
    #[serde(default)]
    pub from_screen: bool,
    /// `kind:title` of the dismissed notice.
    pub identity: String,
    /// Exact detection dismissed: `kind:detectedAt`.
    pub key: String,
}

/// The exact detection a dismissal names.
pub fn notice_dismiss_key(notice: Option<&TerminalNotice>) -> Option<String> {
    notice.map(|notice| format!("{}:{}", notice.kind, notice.detected_at))
}

/// What a notice says, independent of when it was detected.
pub fn notice_identity(notice: &TerminalNotice) -> String {
    format!("{}:{}", notice.kind, notice.title)
}

/// True when `notice` is the detection the user dismissed, or the same screen-state words
/// re-detected within the cooldown.
pub fn is_notice_dismissed(notice: &TerminalNotice, dismissed: Option<&DismissedNotice>) -> bool {
    let Some(dismissed) = dismissed else {
        return false;
    };
    if notice_dismiss_key(Some(notice)).as_deref() == Some(dismissed.key.as_str()) {
        return true;
    }
    if !dismissed.from_screen || notice.source != "screen" {
        return false;
    }
    if notice_identity(notice) != dismissed.identity {
        return false;
    }
    match parse_iso_millis(&notice.detected_at) {
        // An unreadable stamp cannot be compared, so the cooldown holds rather than flashing the
        // card the user just closed.
        None => true,
        Some(detected_at) => detected_at < dismissed.dismissed_at + NOTICE_REDISPLAY_COOLDOWN_MS,
    }
}

/// The record written when the user closes a notice.
pub fn dismissed_notice_state(notice: &TerminalNotice, now_ms: i64) -> DismissedNotice {
    DismissedNotice {
        dismissed_at: now_ms,
        from_screen: notice.source == "screen",
        identity: notice_identity(notice),
        key: notice_dismiss_key(Some(notice)).unwrap_or_default(),
    }
}

/// Reads a stored dismissal, tolerating the record shape that predates the cooldown.
pub fn decode_dismissed_notice(raw: &str) -> Option<DismissedNotice> {
    if raw.is_empty() {
        return None;
    }
    if !raw.starts_with('{') {
        // Pre-2026-09-03 entries stored the bare key; they still hide that one detection.
        return Some(DismissedNotice {
            dismissed_at: 0,
            from_screen: false,
            identity: String::new(),
            key: raw.to_string(),
        });
    }
    serde_json::from_str(raw).ok()
}

/// `Date.parse` for the ISO-8601 stamps gxserver writes, in epoch milliseconds.
///
/// The core reads no timezone, so a stamp without an offset is taken as UTC. gxserver always
/// writes `Z`, which is the only form this has to agree with the TypeScript on.
fn parse_iso_millis(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if bytes.len() < 19 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    if bytes[10] != b'T' && bytes[10] != b't' && bytes[10] != b' ' {
        return None;
    }
    if bytes[13] != b':' || bytes[16] != b':' {
        return None;
    }
    let year: i64 = text.get(0..4)?.parse().ok()?;
    let month: i64 = text.get(5..7)?.parse().ok()?;
    let day: i64 = text.get(8..10)?.parse().ok()?;
    let hour: i64 = text.get(11..13)?.parse().ok()?;
    let minute: i64 = text.get(14..16)?.parse().ok()?;
    let second: i64 = text.get(17..19)?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 {
        return None;
    }
    let mut rest = text.get(19..)?;
    let mut millis = 0i64;
    if let Some(fraction) = rest.strip_prefix('.') {
        let digits: String = fraction.chars().take_while(char::is_ascii_digit).collect();
        if digits.is_empty() {
            return None;
        }
        let mut scaled = digits.clone();
        scaled.truncate(3);
        while scaled.len() < 3 {
            scaled.push('0');
        }
        millis = scaled.parse().ok()?;
        rest = &fraction[digits.len()..];
    }
    let offset_minutes = match rest {
        "" | "Z" | "z" => 0,
        other => {
            let sign = match other.as_bytes().first() {
                Some(b'+') => 1,
                Some(b'-') => -1,
                _ => return None,
            };
            let body = &other[1..];
            let (hours, minutes) = match body.len() {
                5 if body.as_bytes()[2] == b':' => (body.get(0..2)?, body.get(3..5)?),
                4 => (body.get(0..2)?, body.get(2..4)?),
                2 => (body, "00"),
                _ => return None,
            };
            sign * (hours.parse::<i64>().ok()? * 60 + minutes.parse::<i64>().ok()?)
        }
    };
    let days = days_from_civil(year, month, day);
    Some(
        ((days * 86_400 + hour * 3_600 + minute * 60 + second) - offset_minutes * 60) * 1_000
            + millis,
    )
}

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's `days_from_civil`).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}
