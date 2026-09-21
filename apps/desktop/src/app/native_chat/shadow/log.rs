//! What a shadow run writes, and the rules every line of it obeys.
//!
//! Three records, all routine and all gated on `native.chat.shadow`, in the session chat log
//! (`gpui-session-chat-debug.jsonl`):
//!
//! - `gxChat.shadow.summary`, the running totals, at most once a minute and only when they moved.
//! - `gxChat.shadow.difference`, once per distinct pointer pattern, the first time it differs.
//! - `gxChat.shadow.stopped`, when the shadow gives up on a chat, with the reason.
//!
//! CDXC:SessionChat 2026-09-22 WHY:
//! A shadow observes the user's own conversation, so the difference between "counts and field
//! names" and "content" is the whole privacy rule here, not a style preference. Every value these
//! records carry is a number, a boolean, a fixed word, or a JSON pointer whose array indices are
//! replaced by `*`: never a title, a path, message text, or a value from either brain. The
//! sanitizer in `support_logs.rs` is the second line of that defence and it is silent when it
//! fires (a value past 120 characters or holding a slash becomes `[redacted]`, an object past 32
//! keys loses the rest without saying so, and anything below depth 4 becomes `[depth-capped]`),
//! which is why the shapes below stay small and pointers are written with `|` for `/`.

use std::collections::BTreeSet;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use super::counters::ShadowCounters;
use crate::support_logs;

/// How often the totals are written, matching the store's own summary cadence.
const SUMMARY_INTERVAL: Duration = Duration::from_secs(60);
/// Distinct pointer patterns one chat reports. Past this the counters carry the rest: the point of
/// the record is to name the shape, and a run that has found sixty-four different ones has
/// diverged rather than drifted.
const MAX_DIFFERENCE_RECORDS: usize = 64;
/// Keys named in one summary. Comfortably inside the sanitizer's 32-entry cap on the array.
const MAX_SUMMARY_KEYS: usize = 12;
/// Cut here, where the record can say it was cut, rather than in the sanitizer at 120 where it
/// cannot.
const MAX_TEXT_CHARS: usize = 110;

/// The log's own state: what it has already said, and when it last said it.
#[derive(Default)]
pub(super) struct ShadowLog {
    summary_at: Option<Instant>,
    summary_written: Option<ShadowCounters>,
    reported: BTreeSet<String>,
}

impl ShadowLog {
    /// The first time a pointer pattern differs, name it. Later documents only move the counters.
    pub(super) fn difference(&mut self, key: &str, pointer: &str, counters: &ShadowCounters) {
        if self.reported.contains(pointer) || self.reported.len() >= MAX_DIFFERENCE_RECORDS {
            return;
        }
        self.reported.insert(pointer.to_string());
        record(
            "gxChat.shadow.difference",
            json!({
                "key": log_text(key),
                "pointer": log_text(pointer),
                "documents": counters.documents,
                "documentsDifferent": counters.documents_different,
                "patterns": self.reported.len() as u64,
            }),
        );
    }

    /// The running totals. `force` writes them whatever the interval says, which is what the end
    /// of a chat uses so a short run still leaves its numbers behind.
    pub(super) fn summary(&mut self, counters: &ShadowCounters, force: bool) {
        if !force {
            if self
                .summary_written
                .as_ref()
                .is_some_and(|written| written == counters)
            {
                return;
            }
            if self
                .summary_at
                .is_some_and(|at| at.elapsed() < SUMMARY_INTERVAL)
            {
                return;
            }
        }
        self.summary_at = Some(Instant::now());
        self.summary_written = Some(counters.clone());
        record("gxChat.shadow.summary", summary_details(counters, true));
    }

    /// The shadow has given up on this chat. `reason` is one of a fixed handful of words.
    pub(super) fn stopped(&mut self, reason: &'static str, counters: &ShadowCounters) {
        self.summary_at = Some(Instant::now());
        self.summary_written = Some(counters.clone());
        let mut details = summary_details(counters, false);
        if let Some(object) = details.as_object_mut() {
            object.insert("reason".to_string(), Value::String(reason.to_string()));
        }
        record("gxChat.shadow.stopped", details);
    }
}

/// The summary body, shared by the periodic line and the one that says the shadow stopped.
///
/// Grouped rather than flat: the sanitizer keeps the first 32 keys of an object and drops the rest
/// without saying so, and a flat shape here would already be close to that.
fn summary_details(counters: &ShadowCounters, running: bool) -> Value {
    let worst: Vec<Value> = counters
        .worst_keys(MAX_SUMMARY_KEYS)
        .into_iter()
        .map(|(key, key_counters)| {
            json!({
                "key": log_text(key),
                "compared": key_counters.compared,
                "equal": key_counters.equal,
                "different": key_counters.different,
            })
        })
        .collect();
    json!({
        "running": running,
        "records": counters.records,
        "calls": counters.calls,
        "refusals": counters.refusals,
        "faults": counters.faults,
        "documents": {
            "compared": counters.documents,
            "equal": counters.documents_equal,
            "different": counters.documents_different,
            "unpaired": counters.documents_unpaired,
            "snapshotPresence": counters.snapshot_presence,
        },
        "queries": {
            "compared": counters.queries,
            "different": counters.queries_different,
            "unanswered": counters.queries_unanswered,
        },
        // Both come from the translator. Either above zero means the two brains stopped asking
        // gxserver for things in the same order, and every comparison after that point is a
        // shortage of input rather than a difference in the rules.
        "requests": {
            "unanswered": counters.unanswered,
            "unmatchedAnswers": counters.unmatched_answers,
        },
        "keys": {
            "tracked": counters.keys.len() as u64,
            "differing": counters.differing_keys() as u64,
        },
        "worstKeys": worst,
    })
}

/// Appends one routine shadow line.
///
/// `append_for_scenario` rather than `append`, because the destination log's own scenario is
/// `gpui.sessionChat.viewState` and these lines belong to `native.chat.shadow`: a user who turned
/// the shadow on must not have to turn a second scenario on to read what it found.
fn record(event: &'static str, details: Value) {
    support_logs::append_for_scenario(
        support_logs::GpuiSupportLog::SessionChat,
        support_logs::GpuiDiagnosticScenario::ChatShadow.scenario_id(),
        event,
        details,
    );
}

/// A string the log's sanitizer will print rather than replace: no slash, no control character,
/// and short enough to survive. Pointers arrive here already written with `|` for `/`.
fn log_text(value: &str) -> String {
    let value: String = value
        .replace(['/', '\\'], "|")
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect();
    let value = if value.chars().count() <= MAX_TEXT_CHARS {
        value
    } else {
        let kept: String = value.chars().take(MAX_TEXT_CHARS - 3).collect();
        format!("{kept}...")
    };
    debug_assert!(
        value.chars().count() <= 120
            && !value.contains('/')
            && !value.contains('\\')
            && !value.chars().any(char::is_control),
        "a shadow log value must survive the sanitizer"
    );
    value
}
