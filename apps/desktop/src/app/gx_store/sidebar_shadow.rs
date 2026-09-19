//! The Rust sidebar list built beside the TypeScript one, and compared with it.
//!
//! CDXC:Sidebar 2026-09-20 WHY:
//! The renderer still draws the TypeScript snapshot; this builds the same list from the Rust store for the same moment and reports where the two disagree, so the switch in M4b is made against a measured parity gate rather than a guess. It runs off the render path: a snapshot only books a coalesced comparison, and the whole path is skipped unless the `native.sidebar.refresh` scenario is on, because one comparison costs a few hundred microseconds rather than a few tens.

use std::collections::HashSet;
use std::time::{Duration, Instant};

use ghostex_gx_core::{
    ChangeSummary, LOCAL_MACHINE_ID, SidebarInputs, SidebarSettings, SidebarViewModel,
    UnavailableState,
};
use serde_json::Value;

use super::sidebar_shadow_compare::compare;
use super::sidebar_shadow_inputs::{mirror_inputs, sort_mode};
use super::sidebar_shadow_storage::{StoredSidebarState, read_sidebar_state};
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
/// How long a read of the stored sidebar state is used before it is read again.
const STORED_STATE_MAX_AGE: Duration = Duration::from_secs(5);
/// How long the "is the scenario on" verdict is reused. Asking costs a stat of the settings file
/// and a clone of its map under a global lock, and a sidebar publish asks several times a second.
const GATE_MAX_AGE: Duration = Duration::from_millis(1000);
/// How often a difference that never settles is allowed to book its own judgement before it waits
/// for the next publish instead.
const MAX_SETTLE_REBOOKS: u8 = 4;

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
    /// The state only client storage holds has not been read yet.
    pub(crate) skipped_stored_unknown: u64,
    /// That read failed; while it does, nothing is compared at all.
    pub(crate) stored_read_failures: u64,
    /// Rows, summed over every confirmed difference: how many of them differ in the question
    /// count, which the old sidebar store leaves out of its row equality and so freezes on a row
    /// nothing else touched.
    pub(crate) question_count_only: u64,
    /// Rows whose only difference is the tooltip while their question count agrees. The frozen
    /// row cannot explain those, and every mistake in the tooltip port produces exactly this
    /// shape, so a number that climbs here is the first place to look.
    pub(crate) tooltip_only: u64,
    /// Confirmed differences, not rows: how many of them are made up entirely of frozen fields,
    /// which is the old side standing still rather than this list moving.
    pub(crate) frozen_fields_only: u64,
    /// Differences that were replaced by another shape before they could settle. A number that
    /// keeps climbing while `matches` and `mismatches` stand still means something flapping.
    pub(crate) never_settled: u64,
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
    /// How often this difference booked its own judgement; bounded so a flapping one cannot keep
    /// a timer, an update and a comparison running for the rest of the app's life.
    rebooks: u8,
}

/// The Rust list, the difference it has with the published one, and what it costs.
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
    stored: Option<StoredSidebarState>,
    stored_read_at: Option<Instant>,
    stored_reading: bool,
    unavailable: UnavailableState,
    /// The newest "is the scenario on" verdict and when it was taken.
    gate: Option<(Instant, bool)>,
    /// The last error the client-storage read gave, as a bounded code.
    stored_error: Option<&'static str>,
    /// A comparison is booked; further snapshots join it.
    scheduled: bool,
    /// Identity of the published snapshot the comparison last saw, so a rejected payload, a clock
    /// row update, a flash and a menu answer do not book one.
    snapshot_identity: usize,
    /// Host time the newest published snapshot arrived.
    snapshot_at_ms: u64,
    /// A difference is waiting to be judged and its timer is already booked.
    settle_scheduled: bool,
    compares_since_scratch_check: u32,
}

impl Default for SidebarShadow {
    fn default() -> Self {
        Self {
            model: SidebarViewModel::new(),
            changes: ChangeSummary::default(),
            // Nothing is derived and nothing is remembered until the comparison is switched on.
            needs_reset: true,
            counters: SidebarShadowCounters::default(),
            pending: None,
            confirmed_signatures: HashSet::new(),
            settings: None,
            stored: None,
            stored_read_at: None,
            stored_reading: false,
            unavailable: UnavailableState::default(),
            gate: None,
            stored_error: None,
            scheduled: false,
            snapshot_identity: 0,
            snapshot_at_ms: 0,
            settle_scheduled: false,
            compares_since_scratch_check: 0,
        }
    }
}

impl SidebarShadow {
    fn is_pending(&self) -> bool {
        self.pending.is_some()
    }

    /// Whether the comparison runs at all. The verdict is reused for a second, because asking
    /// stats the settings file and clones its map under a global lock.
    fn enabled(&mut self) -> bool {
        if let Some((taken_at, enabled)) = self.gate {
            if taken_at.elapsed() < GATE_MAX_AGE {
                return enabled;
            }
        }
        let enabled = super::diagnostics::routine_logging_enabled();
        self.gate = Some((Instant::now(), enabled));
        enabled
    }

    /// Folds what one pump changed into what the next comparison must apply. Nothing is kept
    /// while the comparison is off, because the list is rebuilt from scratch when it comes back.
    pub(super) fn note_changes(&mut self, changes: &ChangeSummary) {
        if self.needs_reset {
            return;
        }
        if changes.side_state.project_collections {
            // The sidebar writes its own copy of the collections back to client storage whenever
            // it adopts a daemon document, so the copy read here is re-read at once rather than
            // at the end of its five seconds.
            self.stored_read_at = None;
        }
        self.changes.merge(changes.clone());
    }

    /// Frees the derived list and everything kept for it. Nothing is accumulated again until a
    /// comparison runs, which rebuilds from scratch.
    fn drop_cache(&mut self) {
        self.model = SidebarViewModel::new();
        self.changes = ChangeSummary::default();
        self.pending = None;
        self.settle_scheduled = false;
        self.needs_reset = true;
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
        if !self.gx_store.sidebar_shadow.enabled() {
            if !self.gx_store.sidebar_shadow.needs_reset {
                self.gx_store.sidebar_shadow.drop_cache();
            }
            return;
        }
        // Only an accepted snapshot or patch replaces the published list; a rejected payload, a
        // clock row update, a flash and a menu answer leave it as it was and are not compared.
        //
        // The address of the `Arc` is the identity, which is sound here and only here: the one
        // assignment site builds the new snapshot before it drops the old value, so the two are
        // alive at once and cannot share an address, and the clock row update mutates in place
        // through `Arc::make_mut` without ever reassigning. Nothing is kept behind this number
        // between comparisons, so a freed snapshot cannot be mistaken for a live one.
        let identity = self
            .native_sidebar
            .snapshot
            .as_ref()
            .map_or(0, |snapshot| std::sync::Arc::as_ptr(snapshot) as usize);
        if identity == 0 || identity == self.gx_store.sidebar_shadow.snapshot_identity {
            return;
        }
        self.gx_store.sidebar_shadow.snapshot_identity = identity;
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
        if !self.gx_store.sidebar_shadow.enabled() {
            if !self.gx_store.sidebar_shadow.needs_reset {
                self.gx_store.sidebar_shadow.drop_cache();
            }
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
            // The cache was dropped; it is rebuilt from scratch below and starts collecting
            // changes again from here.
            shadow.needs_reset = false;
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
        if self.gx_store_sidebar_stored_state(cx).is_none() {
            self.gx_store.sidebar_shadow.counters.skipped_stored_unknown += 1;
            self.gx_store.sidebar_shadow.pending = None;
            // Nothing can be compared at all while this fails, so the summary says so rather than
            // reading as a quiet run with no differences.
            let counters = self.gx_store.sidebar_shadow.counters;
            let error = self.gx_store.sidebar_shadow.stored_error;
            self.gx_store
                .diagnostics
                .sidebar_summary(&counters, true, error, 0, 0);
            return;
        }

        let browser_tabs = self.sidebar_browser_tabs_snapshot.clone();
        let settings = self.gx_store.sidebar_shadow.settings(&snapshot);
        let stored = self
            .gx_store
            .sidebar_shadow
            .stored
            .clone()
            .unwrap_or_default();
        let unavailable = self.gx_store.sidebar_shadow.unavailable;
        let inputs = mirror_inputs(&snapshot, &browser_tabs, settings, stored, unavailable);

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
                let signature = difference.signature();
                let settled = shadow.pending.as_ref().is_some_and(|pending| {
                    pending.signature == signature && pending.since.elapsed() >= SETTLE
                });
                if settled {
                    shadow.pending = None;
                    shadow.counters.mismatches += 1;
                    shadow.counters.question_count_only += difference.question_count_only as u64;
                    shadow.counters.tooltip_only += difference.tooltip_only as u64;
                    if difference.only_frozen_fields {
                        shadow.counters.frozen_fields_only += 1;
                    }
                    if shadow.confirmed_signatures.len() < MAX_CONFIRMED_SIGNATURES
                        && shadow.confirmed_signatures.insert(signature)
                    {
                        shadow.counters.distinct_mismatches += 1;
                    }
                    Some(difference)
                } else {
                    match &mut shadow.pending {
                        // The same difference, still inside its window: nothing to do but wait.
                        Some(pending) if pending.signature == signature => {}
                        // Another shape before the first one could settle. A difference that keeps
                        // changing shape never counts as anything, so it is counted here.
                        Some(_) => {
                            shadow.counters.never_settled += 1;
                            shadow.pending = Some(PendingDifference {
                                since: Instant::now(),
                                signature,
                                rebooks: 0,
                            });
                        }
                        None => {
                            shadow.pending = Some(PendingDifference {
                                since: Instant::now(),
                                signature,
                                rebooks: 0,
                            });
                        }
                    }
                    None
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
        let stored_error = self.gx_store.sidebar_shadow.stored_error;
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
            .sidebar_summary(&counters, pending, stored_error, groups, rows);
        // A difference that no later snapshot resolves still has to be judged, so it books one
        // judgement of its own. A stable difference is settled by the first of them; a shape that
        // keeps changing would book for ever, so the bookings are bounded and it then waits for
        // the next publish like everything else.
        //
        // The bound is per shape, not per list: a difference that takes a new shape on every
        // self-booked judgement gets a fresh budget with it, so the settle-and-book cycle can run
        // on at one comparison every 1.75 seconds for as long as the list keeps changing shape.
        // Accepted: it costs one update and one comparison per cycle, it stops the moment the
        // shapes repeat, and `neverSettled` counts every turn of it. A list that genuinely churns
        // that way and a difference that flaps look the same from here, by design.
        let may_rebook = !self.gx_store.sidebar_shadow.settle_scheduled
            && match &mut self.gx_store.sidebar_shadow.pending {
                Some(pending) if pending.rebooks < MAX_SETTLE_REBOOKS => {
                    pending.rebooks += 1;
                    true
                }
                _ => false,
            };
        if may_rebook {
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

    /// The sidebar state that only client storage holds, re-read now and then. `None` while the
    /// first read is still on its way or while it fails, which is when nothing is compared.
    fn gx_store_sidebar_stored_state(
        &mut self,
        cx: &mut gpui::Context<Self>,
    ) -> Option<&StoredSidebarState> {
        let shadow = &mut self.gx_store.sidebar_shadow;
        let stale = shadow
            .stored_read_at
            .is_none_or(|read_at| read_at.elapsed() >= STORED_STATE_MAX_AGE);
        if stale && !shadow.stored_reading {
            shadow.stored_reading = true;
            cx.spawn(async move |this, cx| {
                let stored = cx
                    .background_executor()
                    .spawn(async move { read_sidebar_state() })
                    .await;
                let _ = this.update(cx, |this, _| {
                    let shadow = &mut this.gx_store.sidebar_shadow;
                    shadow.stored_reading = false;
                    shadow.stored_read_at = Some(Instant::now());
                    match stored {
                        Ok(stored) => {
                            shadow.stored_error = None;
                            if shadow.stored.as_ref() != Some(&stored) {
                                shadow.stored = Some(stored);
                                // The list is derived from it, so it starts over.
                                shadow.drop_cache();
                            }
                        }
                        Err(code) => {
                            shadow.stored_error = Some(code);
                            shadow.counters.stored_read_failures += 1;
                            this.gx_store.diagnostics.sidebar_stored_state_failed(code);
                        }
                    }
                });
            })
            .detach();
        }
        self.gx_store.sidebar_shadow.stored.as_ref()
    }
}
