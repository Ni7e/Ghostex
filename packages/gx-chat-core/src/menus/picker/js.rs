//! The four JavaScript number rules family e2's copy depends on.
//!
//! Every label in the picker, the model menu and the context rows was built by a template string
//! over a `number`, so the Rust port has to print what V8 prints, not what Rust's formatter
//! prints. The differences that actually bite:
//!
//! - `Math.round` sends halves towards positive infinity; `f64::round` sends them away from zero,
//!   so `Math.round(-0.5)` is `-0` and `(-0.5f64).round()` is `-1`.
//! - `Number.prototype.toFixed` picks the larger candidate on an exact tie (`(1.25).toFixed(1)`
//!   is `"1.3"`), while Rust's `{:.1}` rounds a tie to even and writes `"1.2"`.
//! - `String(number)` writes an integral double without a decimal point (`2`, not `2.0`).
//!
//! These are private to family e2. When a sibling family needs the same rules they should move to
//! a shared module rather than being copied again.

/// `Math.round`: halves go up, towards positive infinity.
pub fn js_round(value: f64) -> f64 {
    if !value.is_finite() {
        return value;
    }
    let floor = value.floor();
    if value - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    }
}

/// `String(value)` for a number JavaScript would print without an exponent.
///
/// Every caller here divides small integers (`minutes / 1440`, `seconds / 3600`), so the shortest
/// round-trip form and the plain decimal form agree; an integral value loses its `.0`.
pub fn js_number(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    if value == value.trunc() && value.abs() < 1e21 {
        return format!("{}", value as i64);
    }
    let mut text = format!("{value}");
    if text.ends_with(".0") {
        text.truncate(text.len() - 2);
    }
    text
}

/// `Number.prototype.toFixed(digits)`.
///
/// Rounds the exact binary value, and on an exact tie picks the larger candidate, which is what
/// the specification says and what Rust's round-to-even formatter does not do.
pub fn to_fixed(value: f64, digits: usize) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    let negative = value < 0.0;
    // The exact decimal expansion of a double is finite, so a generous precision is exact here
    // and lets the rounding decision be made on digits rather than on another float.
    let exact = format!("{:.*}", digits + 30, value.abs());
    let (whole, fraction) = exact.split_once('.').unwrap_or((exact.as_str(), ""));
    let kept = &fraction[..digits.min(fraction.len())];
    let rest = &fraction[digits.min(fraction.len())..];
    let round_up = match rest.as_bytes().first() {
        Some(&first) if first > b'5' => true,
        Some(&b'5') => true,
        _ => false,
    };
    let mut digits_out: Vec<u8> = whole.bytes().chain(kept.bytes()).collect();
    if round_up {
        let mut index = digits_out.len();
        loop {
            if index == 0 {
                digits_out.insert(0, b'1');
                break;
            }
            index -= 1;
            if digits_out[index] == b'9' {
                digits_out[index] = b'0';
            } else {
                digits_out[index] += 1;
                break;
            }
        }
    }
    let text = String::from_utf8(digits_out).unwrap_or_default();
    let split = text.len() - digits;
    let mut out = String::new();
    if negative && text.bytes().any(|byte| byte != b'0') {
        out.push('-');
    }
    let whole_part = text[..split].trim_start_matches('0');
    out.push_str(if whole_part.is_empty() {
        "0"
    } else {
        whole_part
    });
    if digits > 0 {
        out.push('.');
        out.push_str(&text[split..]);
    }
    out
}

/// `` `${value.toFixed(1)}`.replace(/\.0$/, '') ``, the shape three token and percentage labels
/// share.
pub fn to_fixed_trimmed(value: f64, digits: usize) -> String {
    let text = to_fixed(value, digits);
    match text.strip_suffix(".0") {
        Some(trimmed) => trimmed.to_string(),
        None => text,
    }
}

/// `Number.isFinite`, which is false for a missing value as well as for `NaN` and the infinities.
pub fn is_finite(value: Option<f64>) -> bool {
    value.is_some_and(f64::is_finite)
}
