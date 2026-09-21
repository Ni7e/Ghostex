//! What a shadow run counts. Counts only: no pointer here ever carries a value from either brain.

use std::collections::BTreeMap;

/// One document key's comparison tally.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct KeyCounters {
    /// Documents in which this key was looked at, which is every compared document.
    pub(super) compared: u64,
    pub(super) equal: u64,
    pub(super) different: u64,
}

/// Everything one shadow run has seen. Compared by value, so the periodic summary can skip a
/// round in which nothing moved.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct ShadowCounters {
    /// Seam records read, including the ones no call could be parsed from.
    pub(super) records: u64,
    /// Calls the translator applied to the core.
    pub(super) calls: u64,
    /// Calls this build does not model, which the brief counts rather than ignores: a method the
    /// bridge grew, or an argument shape the core's types refuse.
    pub(super) refusals: u64,
    pub(super) documents: u64,
    pub(super) documents_equal: u64,
    pub(super) documents_different: u64,
    /// `take` records with no live document left to compare against, or live documents dropped
    /// because their record never arrived. Either means the pairing slipped and the numbers after
    /// it are not trustworthy.
    pub(super) documents_unpaired: u64,
    /// Documents where one brain published a `snapshot` and the other did not. Counted apart from
    /// a content difference because it is the known gap of the port
    /// (`docs/2026-09-21/rust-chat/PROGRESS.md`), and because there is nothing to compare.
    pub(super) snapshot_presence: u64,
    pub(super) queries: u64,
    pub(super) queries_different: u64,
    /// Pure helpers the shadow could not answer at all, so no fingerprint was compared.
    pub(super) queries_unanswered: u64,
    /// Requests the core made that the live traffic never answered, and answers with no request
    /// of the core's waiting. Both come from the translator, and either above zero means the two
    /// brains stopped asking in the same order.
    pub(super) unanswered: u64,
    pub(super) unmatched_answers: u64,
    /// Panics caught around shadow work. The shadow stops for that chat on the first one.
    pub(super) faults: u64,
    /// Per document key: the top-level keys of the `take` payload, with `snapshot` expanded into
    /// its own keys as `snapshot|<key>`, which is the granularity `replay-diff.ts --keys` uses.
    pub(super) keys: BTreeMap<String, KeyCounters>,
}

impl ShadowCounters {
    /// Records one key's outcome in this document.
    pub(super) fn key(&mut self, key: &str, equal: bool) {
        let entry = self.keys.entry(key.to_string()).or_default();
        entry.compared += 1;
        if equal {
            entry.equal += 1;
        } else {
            entry.different += 1;
        }
    }

    /// How many keys have differed at least once.
    pub(super) fn differing_keys(&self) -> usize {
        self.keys
            .values()
            .filter(|counters| counters.different > 0)
            .count()
    }

    /// The keys that differ most, worst first, for the summary's short list.
    pub(super) fn worst_keys(&self, limit: usize) -> Vec<(&str, KeyCounters)> {
        let mut ranked: Vec<(&str, KeyCounters)> = self
            .keys
            .iter()
            .filter(|(_, counters)| counters.different > 0)
            .map(|(key, counters)| (key.as_str(), *counters))
            .collect();
        ranked.sort_by(|left, right| {
            right
                .1
                .different
                .cmp(&left.1.different)
                .then_with(|| left.0.cmp(right.0))
        });
        ranked.truncate(limit);
        ranked
    }
}
