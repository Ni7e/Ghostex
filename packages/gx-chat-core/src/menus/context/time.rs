//! The two date calls the context rows make.
//!
//! `Date.parse(iso)` turns the ISO stamps gxserver sends into epoch milliseconds, and
//! `new Date(ms).toLocaleString()` formats Codex's `startedAt`. Neither may read a clock or a
//! timezone, so the offset comes from [`crate::ChatContext::utc_offset_minutes`].
//!
//! CDXC:SessionChat 2026-09-22 WHY:
//! `toLocaleString()` is the second locale-dependent call in the whole chat brain (the first is
//! `native-accounts.ts`, family e1's). It is reproduced here in the `en-US` form V8 produces by
//! default, which is what the recordings were made under; a user whose locale differs will see a
//! different string than the TypeScript produced. The fix is a formatted value from the host, not
//! a locale database in this crate.

/// `Date.parse(value)`: epoch milliseconds, or `None` for a stamp this parser does not recognise.
///
/// Only the ISO-8601 forms gxserver and the agents emit are accepted: `YYYY-MM-DD`, optionally
/// `THH:MM[:SS[.fff]]`, optionally `Z` or `+HH:MM`. A date-only stamp is UTC, which is what the
/// specification says.
pub fn date_parse(value: &str) -> Option<f64> {
    let bytes = value.as_bytes();
    if bytes.len() < 10 {
        return None;
    }
    let year: i64 = value.get(0..4)?.parse().ok()?;
    if bytes[4] != b'-' {
        return None;
    }
    let month: i64 = value.get(5..7)?.parse().ok()?;
    if bytes[7] != b'-' {
        return None;
    }
    let day: i64 = value.get(8..10)?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let mut hour = 0i64;
    let mut minute = 0i64;
    let mut second = 0i64;
    let mut millis = 0i64;
    let mut offset_minutes = 0i64;
    let rest = &value[10..];
    if !rest.is_empty() {
        let rest = match rest.as_bytes()[0] {
            b'T' | b't' | b' ' => &rest[1..],
            _ => return None,
        };
        if rest.len() < 5 {
            return None;
        }
        hour = rest.get(0..2)?.parse().ok()?;
        if rest.as_bytes()[2] != b':' {
            return None;
        }
        minute = rest.get(3..5)?.parse().ok()?;
        let mut cursor = 5;
        if rest.as_bytes().get(cursor) == Some(&b':') {
            second = rest.get(cursor + 1..cursor + 3)?.parse().ok()?;
            cursor += 3;
            if rest.as_bytes().get(cursor) == Some(&b'.') {
                let start = cursor + 1;
                let mut end = start;
                while rest.as_bytes().get(end).is_some_and(u8::is_ascii_digit) {
                    end += 1;
                }
                let fraction = rest.get(start..end)?;
                let padded = format!("{fraction:0<3}");
                millis = padded.get(0..3)?.parse().ok()?;
                cursor = end;
            }
        }
        match rest.as_bytes().get(cursor) {
            None => {}
            Some(b'Z') | Some(b'z') => {}
            Some(sign @ (b'+' | b'-')) => {
                let sign = if *sign == b'-' { -1 } else { 1 };
                let hours: i64 = rest.get(cursor + 1..cursor + 3)?.parse().ok()?;
                let minutes: i64 = match rest.as_bytes().get(cursor + 3) {
                    Some(b':') => rest.get(cursor + 4..cursor + 6)?.parse().ok()?,
                    Some(_) => rest.get(cursor + 3..cursor + 5)?.parse().ok()?,
                    None => 0,
                };
                offset_minutes = sign * (hours * 60 + minutes);
            }
            Some(_) => return None,
        }
    }
    if hour > 24 || minute > 59 || second > 59 {
        return None;
    }
    let days = days_from_civil(year, month, day);
    let millis = days * 86_400_000 + hour * 3_600_000 + minute * 60_000 + second * 1_000 + millis
        - offset_minutes * 60_000;
    Some(millis as f64)
}

/// Howard Hinnant's `days_from_civil`: days since 1970-01-01, for any proleptic Gregorian date.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// The inverse: the civil date of a day count since the epoch.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let days = days + 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_position = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_position + 2) / 5 + 1;
    let month = month_position + if month_position < 10 { 3 } else { -9 };
    (year + i64::from(month <= 2), month, day)
}

/// `new Date(ms).toLocaleString()` in V8's default `en-US` form: `M/D/YYYY, h:mm:ss AM/PM`.
pub fn to_locale_string(epoch_ms: f64, utc_offset_minutes: i32) -> String {
    let local_ms = epoch_ms + f64::from(utc_offset_minutes) * 60_000.0;
    let total_millis = local_ms.floor() as i64;
    let days = total_millis.div_euclid(86_400_000);
    let time_of_day = total_millis.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    let hour24 = time_of_day / 3_600_000;
    let minute = (time_of_day / 60_000) % 60;
    let second = (time_of_day / 1_000) % 60;
    let suffix = if hour24 < 12 { "AM" } else { "PM" };
    let hour12 = match hour24 % 12 {
        0 => 12,
        hour => hour,
    };
    format!("{month}/{day}/{year}, {hour12}:{minute:0>2}:{second:0>2} {suffix}")
}
