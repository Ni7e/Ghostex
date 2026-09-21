//! The document a shadow run compares, with the three pointers neither brain can agree on removed.

use serde_json::Value;

use crate::document::Frame;

/// The top-level pointers excluded from every document comparison, and why.
///
/// 1. `/requests` is the QuickJS bridge's WIRE FORM, not the core's contract. Client storage rides
///    on it there (`composer('read')`, `composer('summary')`) and is an [`crate::Effect`] here, and
///    its ids come off a counter the TypeScript shares with its TIMERS, so reproducing them would
///    mean reproducing the timer allocation order too. [`crate::ChatCore::frame`] builds no
///    `requests` array at all.
/// 2. `/revision` and `/nextWakeMs` are the publish counter and the earliest armed deadline. Both
///    agree only when EVERY publish and EVERY timer agrees, including the ones between two drains
///    that no document can show.
///
/// `tooling/gx-chat-core/run-gates.sh` passes the same three to `replay-diff.ts --ignore` and
/// prints the strict number beside the relaxed one, so the exclusion stays visible.
pub const EXCLUDED_POINTERS: [&str; 3] = ["/requests", "/revision", "/nextWakeMs"];

/// The frame as JSON, with [`EXCLUDED_POINTERS`] removed.
///
/// This is what a shadow host compares with the document the live QuickJS brain published: feed
/// both through it and any remaining difference is a real one.
pub fn comparable_document(frame: &Frame) -> Value {
    let mut value = serde_json::to_value(frame).unwrap_or(Value::Null);
    strip_excluded(&mut value);
    value
}

/// The same exclusions applied to a document the OTHER brain produced, which arrives as plain JSON.
pub fn comparable_value(document: &Value) -> Value {
    let mut value = document.clone();
    strip_excluded(&mut value);
    value
}

fn strip_excluded(value: &mut Value) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    for pointer in EXCLUDED_POINTERS {
        object.remove(pointer.trim_start_matches('/'));
    }
}
