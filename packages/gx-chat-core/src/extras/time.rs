//! `Date.parse` for the ISO-8601 stamps the chat frames carry, without a date crate.
//!
//! The fleet roster, the terminal activity and the subagent clocks all anchor on an ISO-8601
//! `detectedAt`, and the TypeScript reads it with `Date.parse`. The core has no clock and no
//! timezone, so the one form `Date.parse` resolves against local time (a date-time with no offset)
//! is resolved against [`crate::ChatContext::utc_offset_minutes`] instead.

/// Epoch milliseconds for an ISO-8601 stamp, or `None` where `Date.parse` returns `NaN`.
///
/// Accepts `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM`, `YYYY-MM-DDTHH:MM:SS`, an optional fractional second,
/// and an optional `Z` or `±HH:MM` offset. A date-only stamp is UTC and a date-time without an
/// offset is local, which is what the ECMAScript date-time string format says.
pub fn parse_iso_millis(value: &str, utc_offset_minutes: i32) -> Option<f64> {
    let bytes = value.as_bytes();
    if bytes.len() < 10 {
        return None;
    }
    let year: i64 = digits(&value[0..4])?;
    if bytes[4] != b'-' {
        return None;
    }
    let month: i64 = digits(&value[5..7])?;
    if bytes[7] != b'-' {
        return None;
    }
    let day: i64 = digits(&value[8..10])?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let rest = &value[10..];
    if rest.is_empty() {
        return epoch_millis(year, month, day, 0, 0, 0, 0.0, 0);
    }
    if !rest.starts_with('T') && !rest.starts_with('t') && !rest.starts_with(' ') {
        return None;
    }
    let rest = &rest[1..];
    if rest.len() < 5 {
        return None;
    }
    let hour: i64 = digits(&rest[0..2])?;
    if rest.as_bytes()[2] != b':' {
        return None;
    }
    let minute: i64 = digits(&rest[3..5])?;
    let mut tail = &rest[5..];
    let mut second: i64 = 0;
    let mut fraction = 0.0_f64;
    if tail.starts_with(':') {
        if tail.len() < 3 {
            return None;
        }
        second = digits(&tail[1..3])?;
        tail = &tail[3..];
        if tail.starts_with('.') {
            let digit_count = tail[1..]
                .bytes()
                .take_while(|byte| byte.is_ascii_digit())
                .count();
            if digit_count == 0 {
                return None;
            }
            // `Date.parse` keeps millisecond precision and truncates the rest.
            let millis_text: String = tail[1..]
                .chars()
                .take(digit_count.min(3))
                .chain("000".chars())
                .take(3)
                .collect();
            fraction = digits::<i64>(&millis_text)? as f64;
            tail = &tail[1 + digit_count..];
        }
    }
    if hour > 24 || minute > 59 || second > 59 {
        return None;
    }
    let offset = match tail {
        "" => utc_offset_minutes,
        "Z" | "z" => 0,
        _ => parse_offset(tail)?,
    };
    epoch_millis(year, month, day, hour, minute, second, fraction, offset)
}

/// `±HH:MM`, `±HHMM` or `±HH`, the offsets `Date.parse` accepts on an ISO stamp.
fn parse_offset(text: &str) -> Option<i32> {
    let sign = match text.as_bytes().first()? {
        b'+' => 1,
        b'-' => -1,
        _ => return None,
    };
    let body: String = text[1..].chars().filter(|c| *c != ':').collect();
    if body.len() != 2 && body.len() != 4 {
        return None;
    }
    let hours: i32 = digits(&body[0..2])?;
    let minutes: i32 = if body.len() == 4 {
        digits(&body[2..4])?
    } else {
        0
    };
    if hours > 23 || minutes > 59 {
        return None;
    }
    Some(sign * (hours * 60 + minutes))
}

/// Milliseconds since the epoch, the same arithmetic `Date.UTC` does.
fn epoch_millis(
    year: i64,
    month: i64,
    day: i64,
    hour: i64,
    minute: i64,
    second: i64,
    millis: f64,
    offset_minutes: i32,
) -> Option<f64> {
    let days = days_from_civil(year, month, day);
    let seconds = days * 86_400 + hour * 3_600 + minute * 60 + second;
    Some((seconds as f64) * 1_000.0 + millis - (offset_minutes as f64) * 60_000.0)
}

/// Howard Hinnant's `days_from_civil`: days since 1970-01-01 for a proleptic Gregorian date.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// An all-digit field parsed as a number, or `None` when anything else is in it.
fn digits<T: std::str::FromStr>(text: &str) -> Option<T> {
    if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}
