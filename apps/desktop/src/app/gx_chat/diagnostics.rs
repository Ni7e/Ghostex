//! The host's periodic counters, behind the two gates every routine disk log is behind.
//!
//! CDXC:Diagnostics 2026-09-22 WHY:
//! Counts only. A chat's ids, titles, paths, prompts, account names and message text are the user's
//! conversation, and the gxserver auth token must never reach a log line, an error string or a URL.
//! Every field below is a number, which is what makes this record safe to leave enabled while a
//! repro is collected. `support_logs::append` enforces both gates for us, but an event name or a
//! details key containing `error`, `fail`, `warning`, `crash`, `abort`, `fatal` or `panic` bypasses
//! them as an important diagnostic, so the counters are spelled `refused` and `unrouted` instead.

use std::collections::BTreeMap;
use std::time::Duration;

use serde_json::json;
use web_time::Instant;

use crate::support_logs::{self, GpuiDiagnosticScenario, GpuiSupportLog};

/// At most one summary a minute, and only when a counter moved.
const SUMMARY_INTERVAL: Duration = Duration::from_secs(60);

/// What the host counts between two summaries.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct HostCounters {
    /// Chats held in the store right now.
    pub(super) sessions_retained: usize,
    /// Chats the retention limits dropped.
    pub(super) sessions_evicted: u64,
    /// Drains posted to a view.
    pub(super) frames_published: u64,
    /// Effects performed or forwarded, by `Effect` variant name.
    pub(super) effects: BTreeMap<&'static str, u64>,
    /// gxserver refusals, by the code they carried (`unknown` when they carried none).
    pub(super) rpc_refusals: BTreeMap<String, u64>,
    /// Client-storage reads and writes that did not complete.
    pub(super) storage_refused: u64,
    /// Renderer calls this build could not turn into an event.
    pub(super) actions_unrouted: u64,
    /// Effects this build has no arm for, which is only possible when the core grows a variant:
    /// `Effect` is `#[non_exhaustive]` and `effects::route` spells out every one it knows.
    pub(super) effects_unrouted: u64,
}

/// Throttles the summary and remembers what it last wrote.
#[derive(Default)]
pub(super) struct HostDiagnostics {
    considered_at: Option<Instant>,
    written: Option<HostCounters>,
}

impl HostDiagnostics {
    /// Writes the running totals, at most once a minute and only when they moved.
    ///
    /// Without it a run with no refusal would leave no trace that the Rust brain ran at all, which
    /// is the first thing to check when the switch is flipped.
    pub(super) fn summary(&mut self, counters: &HostCounters) {
        if self.written.as_ref() == Some(counters)
            || self
                .considered_at
                .is_some_and(|at| at.elapsed() < SUMMARY_INTERVAL)
        {
            return;
        }
        self.considered_at = Some(Instant::now());
        if !enabled() {
            return;
        }
        self.written = Some(counters.clone());
        // The sanitizer drops object entries past the first 32 with no marker, so the three maps are
        // capped here rather than silently truncated there.
        let effects: BTreeMap<&str, u64> = counters
            .effects
            .iter()
            .take(24)
            .map(|(k, v)| (*k, *v))
            .collect();
        let refusals: BTreeMap<String, u64> = counters
            .rpc_refusals
            .iter()
            .take(24)
            .map(|(code, count)| (code.clone(), *count))
            .collect();
        support_logs::append(
            GpuiSupportLog::SessionChat,
            "gxChat.host.summary",
            json!({
                "sessionsRetained": counters.sessions_retained,
                "sessionsEvicted": counters.sessions_evicted,
                "framesPublished": counters.frames_published,
                "effects": effects,
                "rpcRefusals": refusals,
                "storageRefused": counters.storage_refused,
                "actionsUnrouted": counters.actions_unrouted,
                "effectsUnrouted": counters.effects_unrouted,
            }),
        );
    }
}

/// Both gates: Show debug UI controls, and the chat's own diagnostic scenario.
fn enabled() -> bool {
    crate::shared_settings::shared_sidebar_settings_snapshot().debugging_mode()
        && support_logs::scenario_enabled(GpuiDiagnosticScenario::SessionChat)
}
