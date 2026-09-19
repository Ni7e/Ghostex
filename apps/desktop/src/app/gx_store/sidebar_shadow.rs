//! The Rust sidebar list built beside the TypeScript one, and compared with it.
//!
//! CDXC:Sidebar 2026-09-20 WHY:
//! The renderer still draws the TypeScript snapshot; this builds the same list from the Rust store for the same moment and reports where the two disagree, so the switch in M4b is made against a measured parity gate rather than a guess. It runs off the render path: a snapshot only books a coalesced comparison, and the whole path is skipped unless the `native.sidebar.refresh` scenario is on, because one comparison costs a few hundred microseconds rather than a few tens.

use std::collections::HashSet;
use std::time::{Duration, Instant};

use ghostex_gx_core::{
    ChangeSummary, LOCAL_MACHINE_ID, SidebarHiddenItems, SidebarInputs, SidebarSettings,
    SidebarViewModel, UnavailableState,
};
use serde_json::Value;

use super::sidebar_shadow_compare::compare;
use super::sidebar_shadow_inputs::{mirror_inputs, sort_mode};
use super::sidebar_shadow_storage::read_hidden_items;
use crate::GhostexGpuiApp;
use crate::app::native_sidebar::model::NativeSidebarSnapshot;

/// How long several snapshots in a row are folded into one comparison.
const COALESCE: Duration = Duration::from_millis(250);
/// How long a difference must last before it counts. The two sides read the same daemon over two
/// sockets, and the old projection publishes a frame later than the store applies one.
const SETTLE: Duration = Duration::from_millis(1500);
/// Shapes of confirmed differences remembered for the distinct count.
const MAX_CONFIRMED_SIGNATURES: usize = 1024;
/// How often the incremental list is also built from scratch and the two compared.
const SCRATCH_CHECK_EVERY: u32 = 20;
/// How long a read hidden-items value is used before it is read again.
const HIDDEN_ITEMS_MAX_AGE: Duration = Duration::from_secs(5);

/// What happened since the app started. Memory only; the log lines are built from it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct SidebarShadowCounters {
    /// Sidebar snapshots seen while the comparison was on.
    pub(crate) observed: u64,
    pub(crate) compared: u64,
    pub(crate) matches: u64,
    /// Differences that lasted the settle window.
    pub(crate) mismatches: u64,
    pub(crate) distinct_mismatches: u64,
    /// Differences that were gone by the time they were judged: one side was a frame ahead.
    pub(crate) transient: u64,
    /// A remote machine tab is selected; the store holds only the local daemon so far.
    pub(crate) skipped_remote: u64,
    /// The old runtime's focus is on something the store cannot hold, so its focus flags would
    /// disagree by design.
    pub(crate) skipped_foreign_focus: u64,
    pub(crate) skipped_not_loaded: u64,
    /// The store still holds the rows of a daemon whose stream dropped, while the old runtime has
    /// already published its unavailable placeholder. The two disagree about availability by
    /// design until remote machines and the unavailable state move into the store.
    pub(crate) skipped_not_live: u64,
    /// The hidden projects have not been read from client storage yet.
    pub(crate) skipped_hidden_unknown: u64,
    /// Rows whose only difference is the question count the old sidebar store freezes.
    pub(crate) question_count_only: u64,
    pub(crate) scratch_checks: u64,
    pub(crate) scratch_mismatches: u64,
    pub(crate) update_max_us: u64,
    pub(crate) compare_max_us: u64,
    pub(crate) last_update_us: u64,
    pub(crate) last_compare_us: u64,
}

struct PendingDifference {
    since: Instant,
    signature: u64,
}

/// The Rust list, the difference it has with the published one, and what it costs.
#[derive(Default)]
pub(crate) struct SidebarShadow {
    model: SidebarViewModel,
    /// What the store changed since the last comparison.
    changes: ChangeSummary,
    /// The cache is dropped whenever the comparison is off, so the first comparison after it is
    /// turned on builds from scratch.
    needs_reset: bool,
    counters: SidebarShadowCounters,
    pending: Option<PendingDifference>,
    confirmed_signatures: HashSet<u64>,
    settings: Option<(u64, SidebarSettings)>,
    hidden_items: Option<SidebarHiddenItems>,
    hidden_items_read_at: Option<Instant>,
    hidden_items_reading: bool,
    unavailable: UnavailableState,
    /// A comparison is booked; further snapshots join it.
    scheduled: bool,
    /// Host time the newest published snapshot arrived.
    snapshot_at_ms: u64,
    /// A difference is waiting to be judged and its timer is already booked.
    settle_scheduled: bool,
    compares_since_scratch_check: u32,
}

impl SidebarShadow {
    fn is_pending(&self) -> bool {
        self.pending.is_some()
    }

    /// Folds what one pump changed into what the next comparison must apply. Nothing is kept
    /// while the comparison is off, because the list is rebuilt from scratch when it comes back.
    pub(super) fn note_changes(&mut self, changes: &ChangeSummary) {
        if self.needs_reset {
            return;
        }
        self.changes.merge(changes.clone());
    }

    /// Drops the derived list; the next comparison starts over.
    fn reset(&mut self) {
        self.model = SidebarViewModel::new();
        self.changes = ChangeSummary::default();
        self.pending = None;
        self.needs_reset = false;
    }

    /// Tracks how long the local daemon has been unavailable, which the empty-state copy reads.
    fn note_machine_state(&mut self, loaded: bool, now_ms: u64) {
        if loaded {
            self.unavailable.since_ms = None;
            self.unavailable.observed_available = true;
        } else if self.unavailable.since_ms.is_none() {
            self.unavailable.since_ms = Some(now_ms);
        }
    }

    /// The settings the list depends on, rebuilt only when the saved settings moved.
    fn settings(&mut self, snapshot: &NativeSidebarSnapshot) -> SidebarSettings {
        let saved = crate::shared_settings::shared_sidebar_settings_snapshot();
        let sort_mode = sort_mode(snapshot);
        if let Some((hash, settings)) = &self.settings {
            if *hash == saved.content_hash() && settings.sort_mode == sort_mode {
                return settings.clone();
            }
        }
        let settings =
            SidebarSettings::from_settings_json(&Value::Object(saved.object().clone()), sort_mode);
        self.settings = Some((saved.content_hash(), settings.clone()));
        settings
    }
}

impl GhostexGpuiApp {
    /// A sidebar update arrived from the old projection. Books one coalesced comparison; the
    /// whole path is skipped while the diagnostic scenario is off.
    pub(crate) fn gx_store_sidebar_snapshot_received(&mut self, cx: &mut gpui::Context<Self>) {
        if !super::diagnostics::routine_logging_enabled() {
            self.gx_store.sidebar_shadow.needs_reset = true;
            return;
        }
        // The list is built for the moment the old projection published, not for the moment the
        // comparison runs: both sides then judge the same clock-based rules (a new session leading
        // the list, a snooze ending) against the same instant.
        self.gx_store.sidebar_shadow.snapshot_at_ms = super::host::now_ms();
        self.gx_store.sidebar_shadow.counters.observed += 1;
        if self.gx_store.sidebar_shadow.scheduled {
            return;
        }
        self.gx_store.sidebar_shadow.scheduled = true;
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(COALESCE).await;
            let _ = this.update(cx, |this, cx| {
                this.gx_store.sidebar_shadow.scheduled = false;
                this.gx_store_compare_sidebar_view(cx);
            });
        })
        .detach();
    }

    /// Builds the Rust list for the moment of the newest published snapshot and compares the two.
    fn gx_store_compare_sidebar_view(&mut self, cx: &mut gpui::Context<Self>) {
        if !super::diagnostics::routine_logging_enabled() {
            self.gx_store.sidebar_shadow.needs_reset = true;
            return;
        }
        let Some(snapshot) = self.native_sidebar.snapshot.clone() else {
            return;
        };
        let now_ms = self.gx_store.sidebar_shadow.snapshot_at_ms;
        let machine = self
            .gx_store
            .core
            .presentation()
            .machine(&ghostex_gx_core::MachineId::Local);
        let loaded = machine.is_some_and(|machine| machine.loaded().is_some());
        let live = machine.is_some_and(|machine| {
            machine.connection().phase == ghostex_gx_core::ConnectionPhase::Live
        });
        {
            let shadow = &mut self.gx_store.sidebar_shadow;
            if shadow.needs_reset {
                shadow.reset();
            }
            shadow.note_machine_state(loaded, now_ms);
            if snapshot.selected_machine_id != LOCAL_MACHINE_ID {
                shadow.counters.skipped_remote += 1;
                shadow.pending = None;
                return;
            }
            if !loaded {
                shadow.counters.skipped_not_loaded += 1;
                shadow.pending = None;
                return;
            }
            if !live {
                shadow.counters.skipped_not_live += 1;
                shadow.pending = None;
                return;
            }
        }
        if self.gx_store.local_focus.foreign_focus {
            // The old runtime's accepted focus is a row the store cannot hold (a remote session,
            // the quick automations row), so its focus flags are not this list's to match.
            self.gx_store.sidebar_shadow.counters.skipped_foreign_focus += 1;
            self.gx_store.sidebar_shadow.pending = None;
            return;
        }
        if self.gx_store_sidebar_hidden_items(cx).is_none() {
            self.gx_store.sidebar_shadow.counters.skipped_hidden_unknown += 1;
            return;
        }

        let browser_tabs = self.sidebar_browser_tabs_snapshot.clone();
        let settings = self.gx_store.sidebar_shadow.settings(&snapshot);
        let hidden_items = self
            .gx_store
            .sidebar_shadow
            .hidden_items
            .clone()
            .unwrap_or_default();
        let unavailable = self.gx_store.sidebar_shadow.unavailable;
        let inputs = mirror_inputs(
            &snapshot,
            &browser_tabs,
            settings,
            hidden_items,
            unavailable,
        );

        let changes = std::mem::take(&mut self.gx_store.sidebar_shadow.changes);
        let update_started = Instant::now();
        self.gx_store
            .sidebar_shadow
            .model
            .update(&self.gx_store.core, &inputs, &changes, now_ms);
        let update_us = update_started.elapsed().as_micros() as u64;
        let compare_started = Instant::now();
        let difference = compare(&snapshot, self.gx_store.sidebar_shadow.model.view());
        let compare_us = compare_started.elapsed().as_micros() as u64;

        let scratch = self.gx_store_sidebar_scratch_check(&inputs, now_ms);
        let shadow = &mut self.gx_store.sidebar_shadow;
        shadow.counters.compared += 1;
        shadow.counters.last_update_us = update_us;
        shadow.counters.last_compare_us = compare_us;
        shadow.counters.update_max_us = shadow.counters.update_max_us.max(update_us);
        shadow.counters.compare_max_us = shadow.counters.compare_max_us.max(compare_us);
        if let Some(scratch) = scratch {
            shadow.counters.scratch_checks += 1;
            if scratch {
                shadow.counters.scratch_mismatches += 1;
            }
        }
        let confirmed = match difference {
            None => {
                shadow.counters.matches += 1;
                if shadow.pending.take().is_some() {
                    shadow.counters.transient += 1;
                }
                None
            }
            Some(difference) => {
                shadow.counters.question_count_only += difference.question_count_only as u64;
                let signature = difference.signature();
                match &shadow.pending {
                    Some(pending)
                        if pending.signature == signature && pending.since.elapsed() >= SETTLE =>
                    {
                        shadow.pending = None;
                        shadow.counters.mismatches += 1;
                        if shadow.confirmed_signatures.len() < MAX_CONFIRMED_SIGNATURES
                            && shadow.confirmed_signatures.insert(signature)
                        {
                            shadow.counters.distinct_mismatches += 1;
                        }
                        Some(difference)
                    }
                    Some(pending) if pending.signature == signature => None,
                    _ => {
                        shadow.pending = Some(PendingDifference {
                            since: Instant::now(),
                            signature,
                        });
                        None
                    }
                }
            }
        };
        if let Some(mismatch) = &confirmed {
            let revision = snapshot.revision;
            self.gx_store
                .diagnostics
                .sidebar_mismatch(mismatch, revision);
        }
        let counters = self.gx_store.sidebar_shadow.counters;
        let pending = self.gx_store.sidebar_shadow.is_pending();
        let (groups, rows) = {
            let view = self.gx_store.sidebar_shadow.model.view();
            (
                view.groups.len(),
                view.groups
                    .iter()
                    .map(|group| group.core.sessions.len())
                    .sum::<usize>(),
            )
        };
        self.gx_store
            .diagnostics
            .sidebar_summary(&counters, pending, groups, rows);
        if self.gx_store.sidebar_shadow.pending.is_some()
            && !self.gx_store.sidebar_shadow.settle_scheduled
        {
            // A difference that no later snapshot resolves still has to be judged, once.
            self.gx_store.sidebar_shadow.settle_scheduled = true;
            cx.spawn(async move |this, cx| {
                cx.background_executor().timer(SETTLE + COALESCE).await;
                let _ = this.update(cx, |this, cx| {
                    this.gx_store.sidebar_shadow.settle_scheduled = false;
                    if this.gx_store.sidebar_shadow.pending.is_some() {
                        this.gx_store_compare_sidebar_view(cx);
                    }
                });
            })
            .detach();
        }
    }

    /// Every so often the list is also built from scratch: a difference there is a gap in the
    /// incremental path, not in the port. `None` when this round did not check.
    fn gx_store_sidebar_scratch_check(
        &mut self,
        inputs: &SidebarInputs,
        now_ms: u64,
    ) -> Option<bool> {
        let shadow = &mut self.gx_store.sidebar_shadow;
        shadow.compares_since_scratch_check += 1;
        if shadow.compares_since_scratch_check < SCRATCH_CHECK_EVERY {
            return None;
        }
        shadow.compares_since_scratch_check = 0;
        let scratch = SidebarViewModel::build_from_scratch(&self.gx_store.core, inputs, now_ms);
        Some(scratch != *self.gx_store.sidebar_shadow.model.view())
    }

    /// The hidden projects and collections, re-read from client storage now and then. `None`
    /// while the first read is still on its way.
    fn gx_store_sidebar_hidden_items(
        &mut self,
        cx: &mut gpui::Context<Self>,
    ) -> Option<&SidebarHiddenItems> {
        let shadow = &mut self.gx_store.sidebar_shadow;
        let stale = shadow
            .hidden_items_read_at
            .is_none_or(|read_at| read_at.elapsed() >= HIDDEN_ITEMS_MAX_AGE);
        if stale && !shadow.hidden_items_reading {
            shadow.hidden_items_reading = true;
            cx.spawn(async move |this, cx| {
                let hidden_items = cx
                    .background_executor()
                    .spawn(async move { read_hidden_items() })
                    .await;
                let _ = this.update(cx, |this, _| {
                    let shadow = &mut this.gx_store.sidebar_shadow;
                    shadow.hidden_items_reading = false;
                    shadow.hidden_items_read_at = Some(Instant::now());
                    match hidden_items {
                        Ok(hidden_items) => {
                            if shadow.hidden_items.as_ref() != Some(&hidden_items) {
                                shadow.hidden_items = Some(hidden_items);
                                // The list is derived from them, so it starts over.
                                shadow.needs_reset = true;
                            }
                        }
                        Err(error) => this
                            .gx_store
                            .diagnostics
                            .sidebar_hidden_items_failed(&error),
                    }
                });
            })
            .detach();
        }
        self.gx_store.sidebar_shadow.hidden_items.as_ref()
    }
}
