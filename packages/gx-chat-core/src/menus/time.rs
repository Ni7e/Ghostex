//! The two date conversions the menus need, without a clock and without a dependency.
//!
//! The brain stamps a dispatch with `new Date(now).toISOString()` and compares evidence with
//! `Date.parse(iso)`. Both are pure functions of a number and a string, so they belong here rather
//! than in the host; the core still reads no clock, it only formats the one the host passed in.

/// `Date.parse(text)` for the ISO 8601 forms gxserver and this surface write, or `None` for
/// anything the engine would answer `NaN` to.
///
/// Only the format the specification calls the Date Time String Format is accepted, which is what
/// every producer on this path writes: `YYYY-MM-DD` optionally followed by `THH:MM[:SS[.sss]]`
/// and an offset of `Z`, `+HH:MM` or `-HH:MM`. A date-only string is UTC, a date-time without an
/// offset is local time in the engine; the brain never writes one, so it is read as UTC here and
/// the difference cannot reach a document.
pub fn parse_iso_millis(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if bytes.len() < 10 {
        return None;
    }
    let number = |range: std::ops::Range<usize>| -> Option<i64> {
        let slice = text.get(range)?;
        if slice.bytes().all(|byte| byte.is_ascii_digit()) {
            slice.parse::<i64>().ok()
        } else {
            None
        }
    };
    if bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let year = number(0..4)?;
    let month = number(5..7)?;
    let day = number(8..10)?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let mut millis = days_from_civil(year, month as u32, day as u32) * 86_400_000;
    if bytes.len() == 10 {
        return Some(millis);
    }
    if bytes[10] != b'T' && bytes[10] != b't' && bytes[10] != b' ' {
        return None;
    }
    if bytes.len() < 16 || bytes[13] != b':' {
        return None;
    }
    let hour = number(11..13)?;
    let minute = number(14..16)?;
    if hour > 24 || minute > 59 {
        return None;
    }
    millis += hour * 3_600_000 + minute * 60_000;
    let mut index = 16;
    if bytes.get(index) == Some(&b':') {
        let second = number(17..19)?;
        if second > 59 {
            return None;
        }
        millis += second * 1_000;
        index = 19;
        if bytes.get(index) == Some(&b'.') {
            let mut fraction = 0i64;
            let mut digits = 0;
            let mut cursor = index + 1;
            while let Some(byte) = bytes.get(cursor) {
                if !byte.is_ascii_digit() {
                    break;
                }
                if digits < 3 {
                    fraction = fraction * 10 + i64::from(byte - b'0');
                    digits += 1;
                }
                cursor += 1;
            }
            if digits == 0 {
                return None;
            }
            while digits < 3 {
                fraction *= 10;
                digits += 1;
            }
            millis += fraction;
            index = cursor;
        }
    }
    match bytes.get(index) {
        None => Some(millis),
        Some(b'Z') | Some(b'z') if index + 1 == bytes.len() => Some(millis),
        Some(sign @ (b'+' | b'-')) if index + 6 == bytes.len() && bytes[index + 3] == b':' => {
            let offset_hour = number(index + 1..index + 3)?;
            let offset_minute = number(index + 4..index + 6)?;
            let offset = offset_hour * 3_600_000 + offset_minute * 60_000;
            Some(if *sign == b'+' {
                millis - offset
            } else {
                millis + offset
            })
        }
        _ => None,
    }
}

/// `new Date(millis).toISOString()`.
pub fn iso_from_millis(millis: i64) -> String {
    let days = millis.div_euclid(86_400_000);
    let rest = millis.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    let hour = rest / 3_600_000;
    let minute = rest / 60_000 % 60;
    let second = rest / 1_000 % 60;
    let fraction = rest % 1_000;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{fraction:03}Z")
}

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's `days_from_civil`).
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month = i64::from(month);
    let day_of_year =
        (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// The inverse of [`days_from_civil`].
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let days = days + 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_prime + 2) / 5 + 1) as u32;
    let month = if month_prime < 10 {
        month_prime + 3
    } else {
        month_prime - 9
    } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}
