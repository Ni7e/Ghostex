//! The old TypeScript projection's list, compared with the Rust one.
//!
//! CDXC:Sidebar 2026-09-20 WHY:
//! In M4a the store's list was the one under test and the old projection was the reference. The
//! sides are swapped here: the Rust list is what the sidebar's own state feeds and, with the
//! renderer switched over, what the user sees, so the comparison now says whether the old
//! projection still agrees with it. The counters and the settle window are unchanged, because the
//! two sides still read the same daemon over two sockets and either can be a frame ahead. What is
//! new is that the state the two are built from is no longer shared: the Rust side reads the
//! sidebar's own state from `sidebar_ui.rs` and the old side keeps its own copy, so a difference
//! in collapse, Space, filters, hidden items or selection is now a real finding rather than a
//! mirror agreeing with itself.

use std::collections::HashSet;
use std::time::{Duration, Instant};

use ghostex_gx_core::{LOCAL_MACHINE_ID, SidebarViewModel};

use super::sidebar_shadow_compare::compare;
use crate::GhostexGpuiApp;

/// How long several publishes in a row are folded into one comparison.
const COALESCE: Duration = Duration::from_millis(250);
/// How long a difference must last before it counts. The two sides read the same daemon over two
/// sockets, and the old projection publishes a frame later than the store applies one.
const SETTLE: Duration = Duration::from_millis(1500);
/// Shapes of confirmed differences remembered for the distinct count.
const MAX_CONFIRMED_SIGNATURES: usize = 1024;
/// How often the incremental list is also built from scratch and the two compared.
const SCRATCH_CHECK_EVERY: u32 = 20;
/// How long the "is the scenario on" verdict is reused. Asking costs a stat of the settings file
/// and a clone of its map under a global lock, and a sidebar publish asks several times a second.
const GATE_MAX_AGE: Duration = Duration::from_millis(1000);
/// How often a difference that never settles is allowed to book its own judgement before it waits
/// for the next publish instead.
const MAX_SETTLE_REBOOKS: u8 = 4;

/// What happened since the app started. Memory only; the log lines are built from it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct SidebarShadowCounters {
    /// Publishes of the old projection seen while the comparison was on.
    pub(crate) publishes: u64,
    /// Comparisons run. Larger than `publishes` on purpose: a difference that is waiting to settle
    /// books its own judgement, and each of those is another comparison of the same publish.
    pub(crate) comparisons: u64,
    /// Comparisons that came from a difference re-judging itself rather than from a publish.
    pub(crate) rejudged: u64,
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
    /// The sidebar's own state has not been read from client storage yet, so the two sides are
    /// built from different collapse and hidden-item state by definition.
    pub(crate) skipped_not_restored: u64,
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
    /// Confirmed differences made up entirely of a timestamp that moves on its own. A working
    /// session restamps `lastInteractionAt` faster than the settle window, so the two sides never
    /// hold the same value long enough to agree on it; the row order it feeds is compared
    /// separately and is not in this bucket.
    pub(crate) timing_fields_only: u64,
    /// Confirmed differences made up entirely of a value only the store holds, in a field the old
    /// projection goes stale in. The store is the newer of the two there; see
    /// `STALE_PUBLISH_FIELDS`.
    pub(crate) stale_fields_only: u64,
    /// Differences that were replaced by another shape before they could settle. A number that
    /// keeps climbing while `matches` and `mismatches` stand still means something flapping.
    pub(crate) never_settled: u64,
    pub(crate) scratch_checks: u64,
    pub(crate) scratch_mismatches: u64,
    pub(crate) compare_max_us: u64,
    pub(crate) last_compare_us: u64,
}

struct PendingDifference {
    since: Instant,
    signature: u64,
    /// How often this difference booked its own judgement; bounded so a flapping one cannot keep
    /// a timer and a comparison running for the rest of the app's life.
    rebooks: u8,
}

/// The difference between the two lists, and what it costs to find it.
#[derive(Default)]
pub(crate) struct SidebarShadow {
    pub(crate) counters: SidebarShadowCounters,
    pending: Option<PendingDifference>,
    confirmed_signatures: HashSet<u64>,
    /// The newest "is the scenario on" verdict and when it was taken.
    gate: Option<(Instant, bool)>,
    /// A comparison is booked; further publishes join it.
    scheduled: bool,
    /// Identity of the published list the comparison last saw, so a rejected payload, a clock row
    /// update, a flash and a menu answer do not book one.
    projection_identity: usize,
    /// A difference is waiting to be judged and its timer is already booked.
    settle_scheduled: bool,
    compares_since_scratch_check: u32,
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
}

impl GhostexGpuiApp {
    /// The old projection published a list. Its values the Rust list still borrows moved with it,
    /// so the list is brought up to date, and one coalesced comparison is booked.
    pub(crate) fn gx_store_sidebar_projection_published(&mut self, cx: &mut gpui::Context<Self>) {
        // Which machines exist is the old projection's answer until M4d, and a stored tab whose
        // machine is gone has to fall back to this computer, or the list would draw nothing.
        self.gx_store_correct_sidebar_machine_tab(cx);
        // The mirrored inputs (the HUD's sort mode and Recent Projects, the git numbers, the two
        // armed timers) come from this payload, so the list is rebuilt whether or not anyone is
        // comparing.
        self.gx_store_sidebar_state_changed(cx);
        // After the rebuild, so the drawn list it reads is this publish's rather than the last
        // one's: whether the focused row is drawn is the question that decides whether it builds.
        self.gx_store_follow_active_session_space(cx);
        if !self.gx_store.sidebar_shadow.enabled() {
            return;
        }
        // Only an accepted snapshot or patch replaces the published list; a rejected payload, a
        // clock row update, a flash and a menu answer leave it as it was and are not compared.
        //
        // The address of the `Arc` is the identity, which is sound here and only here: the one
        // assignment site builds the new list before it drops the old value, so the two are alive
        // at once and cannot share an address. Nothing is kept behind this number between
        // comparisons, so a freed list cannot be mistaken for a live one.
        let identity = self
            .native_sidebar
            .projection
            .as_ref()
            .map_or(0, |snapshot| std::sync::Arc::as_ptr(snapshot) as usize);
        if identity == 0 || identity == self.gx_store.sidebar_shadow.projection_identity {
            return;
        }
        self.gx_store.sidebar_shadow.projection_identity = identity;
        self.gx_store.sidebar_shadow.counters.publishes += 1;
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

    /// Falls back to this computer when the selected machine tab is not one the sidebar offers,
    /// which is what `createNativeSidebarSnapshot` does with its own copy.
    ///
    /// The machine list is built from the settings, so it holds only this computer until they have
    /// arrived; the guard is `state.hud.settings` being there, not the list being non-empty, or a
    /// stored remote tab would be reset in the first moments of every launch.
    fn gx_store_correct_sidebar_machine_tab(&mut self, cx: &mut gpui::Context<Self>) {
        let selected = self.gx_store.sidebar_ui.selected_machine_id().to_string();
        if selected == LOCAL_MACHINE_ID {
            return;
        }
        let Some(snapshot) = self.native_sidebar.projection.as_ref() else {
            return;
        };
        let settings_arrived = snapshot
            .hud
            .get("settings")
            .is_some_and(|settings| settings.is_object());
        if !settings_arrived
            || snapshot
                .machines
                .iter()
                .any(|machine| machine.id == selected)
        {
            return;
        }
        self.gx_store_apply_sidebar_ui_intent(
            ghostex_gx_core::SidebarUiIntent::SelectMachine {
                machine_id: LOCAL_MACHINE_ID.to_string(),
            },
            cx,
        );
    }

    /// Moves the section into the focused row's Space while `sidebarSpaceFollowActiveSession` is
    /// on, which `rememberNativeSidebarFocus` does to the old projection's copy on every focus
    /// change. Without it the two sides filter by different Spaces, and every drawn row then loses
    /// the menu, the hover buttons and the agent logo it carries from a publish built for the
    /// other Space, for as long as the two disagree.
    fn gx_store_follow_active_session_space(&mut self, cx: &mut gpui::Context<Self>) {
        let focused = self
            .gx_store
            .core
            .focus()
            .focused_session
            .as_ref()
            .map(ghostex_gx_core::SessionKey::to_sidebar_session_id);
        // Only when the focused row CHANGED: the rule belongs to a focus change, and applying it
        // on every publish would pull the section back out of any Space the user picked by hand,
        // over and over, with a write behind each one.
        if !self
            .gx_store
            .sidebar_ui
            .take_followed_session(focused.as_deref())
        {
            return;
        }
        let Some(focused) = focused else {
            return;
        };
        let space_id = {
            let store = &self.gx_store;
            ghostex_gx_core::space_for_focused_row(
                &store.core,
                &store.sidebar_list.last_inputs,
                store.sidebar_list.view(),
                &focused,
                super::host::now_ms(),
            )
        };
        if let Some(space_id) = space_id {
            self.gx_store_apply_sidebar_ui_intent(
                ghostex_gx_core::SidebarUiIntent::SelectSpace { space_id },
                cx,
            );
        }
    }

    /// Compares the old projection's newest list with the Rust one.
    fn gx_store_compare_sidebar_view(&mut self, cx: &mut gpui::Context<Self>) {
        if !self.gx_store.sidebar_shadow.enabled() {
            return;
        }
        let Some(snapshot) = self.native_sidebar.projection.clone() else {
            return;
        };
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
            let restored = self.gx_store.sidebar_ui.restored();
            let shadow = &mut self.gx_store.sidebar_shadow;
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
            if !restored {
                shadow.counters.skipped_not_restored += 1;
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

        let compare_started = Instant::now();
        let difference = compare(&snapshot, self.gx_store.sidebar_list.view());
        let compare_us = compare_started.elapsed().as_micros() as u64;
        let scratch = self.gx_store_sidebar_scratch_check();

        let shadow = &mut self.gx_store.sidebar_shadow;
        shadow.counters.comparisons += 1;
        shadow.counters.last_compare_us = compare_us;
        shadow.counters.compare_max_us = shadow.counters.compare_max_us.max(compare_us);
        if let Some(scratch) = scratch {
            shadow.counters.scratch_checks += 1;
            if scratch {
                shadow.counters.scratch_mismatches += 1;
            }
        }
        let mut replaced: Option<super::sidebar_shadow_compare::SidebarMismatch> = None;
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
                    if difference.only_timing_fields {
                        shadow.counters.timing_fields_only += 1;
                    }
                    if difference.only_stale_fields {
                        shadow.counters.stale_fields_only += 1;
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
                            replaced = Some(difference.clone());
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
        // A shape that was replaced before it could settle is never confirmed, so this is the only
        // place its field names are ever seen.
        if let Some(mismatch) = &replaced {
            self.gx_store.diagnostics.sidebar_never_settled(mismatch);
        }
        let counters = self.gx_store.sidebar_shadow.counters;
        let pending = self.gx_store.sidebar_shadow.is_pending();
        let list = self.gx_store.sidebar_list.counters;
        let (groups, rows) = {
            let view = self.gx_store.sidebar_list.view();
            (
                view.groups.len(),
                view.groups
                    .iter()
                    .map(|group| group.core.sessions.len())
                    .sum::<usize>(),
            )
        };
        let source = self.gx_store_sidebar_list_source();
        let deadline_kind = self.gx_store.sidebar_list.deadline_kind;
        self.gx_store.diagnostics.sidebar_summary(
            &counters,
            &list,
            source,
            deadline_kind,
            pending,
            groups,
            rows,
        );
        let ui = self.gx_store.sidebar_ui.counters;
        self.gx_store.diagnostics.sidebar_ui_summary(&ui);
        // A difference that no later publish resolves still has to be judged, so it books one
        // judgement of its own. A stable difference is settled by the first of them; a shape that
        // keeps changing would book for ever, so the bookings are bounded and it then waits for
        // the next publish like everything else.
        //
        // The bound is per shape, not per list: a difference that takes a new shape on every
        // self-booked judgement gets a fresh budget with it, so the settle-and-book cycle can run
        // on at one comparison every 1.75 seconds for as long as the list keeps changing shape.
        // Accepted: it costs one comparison per cycle, it stops the moment the shapes repeat, and
        // `neverSettled` counts every turn of it. A list that genuinely churns that way and a
        // difference that flaps look the same from here, by design.
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
                        this.gx_store.sidebar_shadow.counters.rejudged += 1;
                        this.gx_store_compare_sidebar_view(cx);
                    }
                });
            })
            .detach();
        }
    }

    /// Every so often the list is also built from scratch: a difference there is a gap in the
    /// incremental path, not in the port. `None` when this round did not check.
    fn gx_store_sidebar_scratch_check(&mut self) -> Option<bool> {
        let shadow = &mut self.gx_store.sidebar_shadow;
        shadow.compares_since_scratch_check += 1;
        if shadow.compares_since_scratch_check < SCRATCH_CHECK_EVERY {
            return None;
        }
        shadow.compares_since_scratch_check = 0;
        let now_ms = self.gx_store.sidebar_list.last_built_at_ms;
        let inputs = std::mem::take(&mut self.gx_store.sidebar_list.last_inputs);
        let scratch = SidebarViewModel::build_from_scratch(&self.gx_store.core, &inputs, now_ms);
        self.gx_store.sidebar_list.last_inputs = inputs;
        Some(scratch != *self.gx_store.sidebar_list.view())
    }
}
