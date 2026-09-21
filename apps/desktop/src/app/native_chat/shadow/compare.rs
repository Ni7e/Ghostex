//! Comparing the two documents, key by key, and naming where they differ without saying how.
//!
//! The comparison is `tooling/gx-chat-core/replay-diff.ts` in Rust: the same union walk, the same
//! `length` pointer for a list whose sizes differ, and the same key granularity (the top-level
//! keys of the `take` payload, with `snapshot` expanded into its own). The three pointers neither
//! brain can agree on are already gone, because both sides arrive through
//! `gx_chat_core::bridge::comparable_document` / `comparable_value`.
//!
//! **Nothing here reads a value.** A difference is reported as the pointer it sits at, with every
//! array index replaced by `*` so one row of a transcript cannot be identified, and a pointer is
//! written with `|` where JSON uses `/`, because the support log's sanitizer replaces any string
//! holding a slash with `[redacted]`.

use std::collections::BTreeSet;

use serde_json::Value;

use super::counters::ShadowCounters;

/// The one key whose contents are counted per inner key rather than as a whole.
const SNAPSHOT: &str = "snapshot";

/// Distinct pointers collected from one document. A transcript that diverges early differs at
/// every row below it, and the pattern is the same one; the cap bounds the walk without changing
/// what the first difference for a pattern says.
const MAX_POINTERS: usize = 32;

/// Compares one pair of documents and folds the outcome into `counters`.
///
/// Returns the `(key, pointer)` pairs the difference was found at, for the caller to report the
/// first time it sees each pattern.
pub(super) fn compare_documents(
    live: &Value,
    shadow: &Value,
    counters: &mut ShadowCounters,
) -> Vec<(String, String)> {
    counters.documents += 1;
    let mut differences: Vec<(String, String)> = Vec::new();
    let (Some(live), Some(shadow)) = (live.as_object(), shadow.as_object()) else {
        // Neither brain can publish a document that is not an object, so this is the whole frame
        // having gone wrong rather than a key of it.
        counters.documents_different += 1;
        counters.key("document", false);
        differences.push(("document".to_string(), "|".to_string()));
        return differences;
    };
    let keys: BTreeSet<&str> = live
        .keys()
        .chain(shadow.keys())
        .map(String::as_str)
        .collect();
    let mut equal = true;
    for key in keys {
        let left = live.get(key);
        let right = shadow.get(key);
        if key == SNAPSHOT {
            match (left, right) {
                (Some(left), Some(right)) => {
                    equal &= compare_snapshot(left, right, counters, &mut differences);
                }
                (None, None) => {}
                // One brain published the document and the other did not. There is nothing to
                // compare, and counting it as a content difference on every one of the document's
                // keys would drown the keys that really differ.
                _ => {
                    counters.snapshot_presence += 1;
                    equal = false;
                }
            }
            continue;
        }
        let mut pointers = BTreeSet::new();
        collect(left, right, &format!("|{key}"), &mut pointers);
        counters.key(key, pointers.is_empty());
        if pointers.is_empty() {
            continue;
        }
        equal = false;
        for pointer in pointers {
            differences.push((key.to_string(), pointer));
        }
    }
    if equal {
        counters.documents_equal += 1;
    } else {
        counters.documents_different += 1;
    }
    differences
}

/// The document's own keys, each its own bucket, which is what makes the summary say WHICH
/// surface disagrees rather than "the snapshot differed".
fn compare_snapshot(
    live: &Value,
    shadow: &Value,
    counters: &mut ShadowCounters,
    differences: &mut Vec<(String, String)>,
) -> bool {
    let (Some(live), Some(shadow)) = (live.as_object(), shadow.as_object()) else {
        counters.key("snapshot", false);
        differences.push(("snapshot".to_string(), "|snapshot".to_string()));
        return false;
    };
    let keys: BTreeSet<&str> = live
        .keys()
        .chain(shadow.keys())
        .map(String::as_str)
        .collect();
    let mut equal = true;
    for key in keys {
        let bucket = format!("snapshot|{key}");
        let mut pointers = BTreeSet::new();
        collect(
            live.get(key),
            shadow.get(key),
            &format!("|snapshot|{key}"),
            &mut pointers,
        );
        counters.key(&bucket, pointers.is_empty());
        if pointers.is_empty() {
            continue;
        }
        equal = false;
        for pointer in pointers {
            differences.push((bucket.clone(), pointer));
        }
    }
    equal
}

/// Collects the pointers at which two values differ, with array indices collapsed to `*`.
///
/// `None` is "the key is absent", which is a difference from any present value including `null`:
/// absent, `null` and a value are three different things on this wire
/// (`packages/gx-chat-core/src/lib.rs`).
fn collect(left: Option<&Value>, right: Option<&Value>, at: &str, into: &mut BTreeSet<String>) {
    if into.len() >= MAX_POINTERS {
        return;
    }
    let (left, right) = match (left, right) {
        (Some(left), Some(right)) => (left, right),
        (None, None) => return,
        _ => {
            into.insert(at.to_string());
            return;
        }
    };
    match (left, right) {
        (Value::Array(left), Value::Array(right)) => {
            if left.len() != right.len() {
                into.insert(format!("{at}|length"));
            }
            for (left, right) in left.iter().zip(right.iter()) {
                collect(Some(left), Some(right), &format!("{at}|*"), into);
                if into.len() >= MAX_POINTERS {
                    return;
                }
            }
        }
        (Value::Object(left), Value::Object(right)) => {
            let keys: BTreeSet<&str> = left
                .keys()
                .chain(right.keys())
                .map(String::as_str)
                .collect();
            for key in keys {
                collect(left.get(key), right.get(key), &format!("{at}|{key}"), into);
                if into.len() >= MAX_POINTERS {
                    return;
                }
            }
        }
        (left, right) => {
            if left != right {
                into.insert(at.to_string());
            }
        }
    }
}
