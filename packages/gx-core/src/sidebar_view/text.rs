//! JavaScript-compatible string and date helpers.
//!
//! The sidebar rules being ported run in JavaScript, where `trim`, `\s`, `slice`, and `length`
//! work on UTF-16 code units and a JavaScript notion of whitespace. Parity with the TypeScript
//! projection depends on reproducing those exactly, not on Rust's own definitions.

/// JavaScript `\s` (and the set `String.prototype.trim` strips): the ECMAScript WhiteSpace and
/// LineTerminator code points. Differs from `char::is_whitespace`: it includes U+FEFF and excludes
/// U+0085.
pub(crate) fn is_js_whitespace(character: char) -> bool {
    matches!(
        character,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// JavaScript line terminators, the characters `.` does not match without the `s` flag.
pub(crate) fn is_js_line_terminator(character: char) -> bool {
    matches!(character, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// `String.prototype.trim`.
pub(crate) fn js_trim(value: &str) -> &str {
    value.trim_matches(is_js_whitespace)
}

/// `String.prototype.trimStart`.
pub(crate) fn js_trim_start(value: &str) -> &str {
    value.trim_start_matches(is_js_whitespace)
}

/// `value.trim().replace(/\s+/g, ' ')`.
pub(crate) fn collapse_js_whitespace(value: &str) -> String {
    let mut collapsed = String::with_capacity(value.len());
    let mut pending_space = false;
    for character in js_trim(value).chars() {
        if is_js_whitespace(character) {
            pending_space = true;
            continue;
        }
        if pending_space {
            collapsed.push(' ');
            pending_space = false;
        }
        collapsed.push(character);
    }
    collapsed
}

/// `value?.trim().replace(/\s+/g, ' ')`, `None` when that is empty.
pub(crate) fn normalized_non_empty(value: Option<&str>) -> Option<String> {
    let collapsed = collapse_js_whitespace(value?);
    (!collapsed.is_empty()).then_some(collapsed)
}

/// `value.length` of a JavaScript string.
pub(crate) fn utf16_len(value: &str) -> usize {
    value.chars().map(char::len_utf16).sum()
}

/// `value.slice(0, max_units)`. A character that would be cut in half (a surrogate pair at the
/// boundary) is left out; JavaScript would keep a lone surrogate, which Rust cannot hold.
pub(crate) fn utf16_prefix(value: &str, max_units: usize) -> &str {
    let mut units = 0;
    for (index, character) in value.char_indices() {
        units += character.len_utf16();
        if units > max_units {
            return &value[..index];
        }
    }
    value
}

/// `value.slice(start_units)`, with the same surrogate caveat as [`utf16_prefix`].
pub(crate) fn utf16_suffix(value: &str, start_units: usize) -> &str {
    let mut units = 0;
    for (index, character) in value.char_indices() {
        if units >= start_units {
            return &value[index..];
        }
        units += character.len_utf16();
    }
    ""
}

/// JavaScript `encodeURIComponent`, re-exported for the sidebar id builders.
pub(crate) use crate::keys::encode_uri_component;

/// `Date.parse` for the ISO-8601 forms gxserver and the app write: `YYYY-MM-DD`,
/// `YYYY-MM-DDTHH:MM`, `YYYY-MM-DDTHH:MM:SS`, optional fraction, and `Z` or `±HH:MM`. `None` where
/// JavaScript would give `NaN`.
///
/// A date-time without an offset is read as UTC. JavaScript reads it as local time, which the core
/// cannot know (it reads no clock or time zone); every writer of these fields emits `Z`.
pub(crate) fn parse_iso_ms(value: &str) -> Option<i64> {
    let bytes = value.as_bytes();
    let digits = |from: usize, count: usize| -> Option<i64> {
        let slice = bytes.get(from..from + count)?;
        let mut number = 0i64;
        for byte in slice {
            if !byte.is_ascii_digit() {
                return None;
            }
            number = number * 10 + i64::from(byte - b'0');
        }
        Some(number)
    };
    let year = digits(0, 4)?;
    if bytes.get(4) != Some(&b'-') || bytes.get(7) != Some(&b'-') {
        return None;
    }
    let month = digits(5, 2)?;
    let day = digits(8, 2)?;
    if !(1..=12).contains(&month) || day < 1 || day > days_in_month(year, month) {
        return None;
    }
    let mut millis = days_from_civil(year, month, day) * 86_400_000;
    if bytes.len() == 10 {
        return Some(millis);
    }
    if bytes.get(10) != Some(&b'T') {
        return None;
    }
    let hour = digits(11, 2)?;
    if bytes.get(13) != Some(&b':') {
        return None;
    }
    let minute = digits(14, 2)?;
    let mut index = 16;
    let mut second = 0;
    let mut fraction_ms = 0;
    if bytes.get(index) == Some(&b':') {
        second = digits(index + 1, 2)?;
        index += 3;
        if bytes.get(index) == Some(&b'.') {
            index += 1;
            let start = index;
            while bytes.get(index).is_some_and(u8::is_ascii_digit) {
                index += 1;
            }
            if index == start {
                return None;
            }
            // Milliseconds: the first three digits, padded; further digits are ignored.
            let mut scale = 100;
            for byte in &bytes[start..index.min(start + 3)] {
                fraction_ms += i64::from(byte - b'0') * scale;
                scale /= 10;
            }
        }
    }
    if hour > 24
        || minute > 59
        || second > 59
        || (hour == 24 && (minute, second, fraction_ms) != (0, 0, 0))
    {
        return None;
    }
    let offset_minutes = match bytes.get(index) {
        None => 0,
        Some(b'Z') if index + 1 == bytes.len() => 0,
        Some(sign @ (b'+' | b'-')) => {
            let offset_hour = digits(index + 1, 2)?;
            if bytes.get(index + 3) != Some(&b':') || index + 6 != bytes.len() {
                return None;
            }
            let offset_minute = digits(index + 4, 2)?;
            let total = offset_hour * 60 + offset_minute;
            if *sign == b'+' {
                total
            } else {
                -total
            }
        }
        _ => return None,
    };
    millis += ((hour * 60 + minute - offset_minutes) * 60 + second) * 1000 + fraction_ms;
    Some(millis)
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 => 29,
        _ => 28,
    }
}

/// Days since 1970-01-01 of a proleptic Gregorian date (Howard Hinnant's algorithm).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month_index = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}
