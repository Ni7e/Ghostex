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

use ghostex_gx_core::{LOCAL_MACHINE_ID, MachineId, SidebarViewModel};

use super::sidebar_scratch_compare::compare_views;
use super::sidebar_shadow_compare::{FocusComparable, compare};
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
    /// A remote machine tab is selected that the host feeds no client for, so the store holds no
    /// rows to compare. Zero on a machine that is connected.
    pub(crate) skipped_remote: u64,
    /// The two sides are on different machine tabs, which is two lists rather than one question.
    pub(crate) skipped_machine_mismatch: u64,
    /// Comparisons that ran on a REMOTE machine's tab. The gate reads this beside `unexplained`:
    /// a skip counter at zero proves nothing unless something was actually compared.
    pub(crate) comparisons_remote: u64,
    /// The old runtime's focus is on something the store does not own the focus for (a remote
    /// session, the quick automations row), so the two sides' focus flags are not one question.
    pub(crate) skipped_foreign_focus: u64,
    pub(crate) skipped_not_loaded: u64,
    /// The store still holds the rows of a daemon whose stream dropped, while the old runtime has
    /// already published its unavailable placeholder (this computer) or its last-seen copy (a
    /// remote machine). The two disagree about availability by design until the unavailable state
    /// moves into the store.
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
    /// Confirmed differences in which every differing field is accounted for by one of the three
    /// rules, in whatever mix. `mismatches` minus this is the milestone's gate: it is what is
    /// left once the old side standing still, a timestamp moving on its own and a value the old
    /// side has not caught up with are all taken out.
    pub(crate) explained_only: u64,
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
    /// The field names this shape had, so the one that replaces it can say what moved rather than
    /// only what it is. A shape that never settles is only ever seen through that difference.
    fields: Vec<String>,
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
        // The machine tabs are the store's own now: the settings say which machines exist and the
        // connect states say how they are doing, so a tab the sidebar no longer offers falls back
        // to this computer here. Answered from a one-second cache unless a connect moved.
        self.gx_store_sync_remote_clients(false, cx);
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

    /// Remembers the focused row under its Space, and moves the section into that Space while
    /// `sidebarSpaceFollowActiveSession` is on. Both halves of `rememberNativeSidebarFocus`, which
    /// ran on every focus change.
    ///
    /// The memory is what a Space switch restores the focus to when `sidebarSpaceSwitchBehavior` is
    /// `restore`, and it is written whatever the follow setting says: the two are asked as one
    /// question so the unfiltered list is built at most once per focus change.
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
        let resolved = {
            let store = &self.gx_store;
            ghostex_gx_core::space_for_focused_row(
                &store.core,
                &store.sidebar_list.last_inputs,
                store.sidebar_list.view(),
                &focused,
                super::host::now_ms(),
            )
        };
        let Some(resolved) = resolved else {
            return;
        };
        // The memory first: the follow moves the section, and the row has to be remembered under
        // the Space it belongs to and not under whichever one the section was showing.
        self.gx_store_remember_space_session(&resolved, &focused, cx);
        if resolved.follow {
            // The ROW's section, not the tab's: a focused row on another machine moves that
            // machine's section and leaves the tab where it is (reveal.rs, `space_for_focused_row`).
            self.gx_store_apply_sidebar_ui_intent(
                ghostex_gx_core::SidebarUiIntent::SetSectionSpace {
                    section_key: resolved.section_key,
                    space_id: resolved.space_id,
                },
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
        // The compared machine is whichever tab is selected, not this computer: since M4d the
        // store draws a remote machine's list too, so the gate that protected the local sidebar
        // protects that one by asking the same questions of the machine it is built for.
        let selected = self.gx_store.sidebar_ui.selected_machine_id().to_string();
        let machine = self
            .gx_store
            .core
            .presentation()
            .machine(&machine_key(&selected));
        let loaded = machine.is_some_and(|machine| machine.loaded().is_some());
        let live = machine.is_some_and(|machine| {
            machine.connection().phase == ghostex_gx_core::ConnectionPhase::Live
        });
        // A machine the host feeds a client for. `skippedRemote` is this and nothing else now, so
        // it reaches zero on a machine that is connected.
        let fed = self.gx_store.sidebar_list.view().supported;
        {
            let restored = self.gx_store.sidebar_ui.restored();
            let shadow = &mut self.gx_store.sidebar_shadow;
            if snapshot.selected_machine_id != selected {
                // The two sides are on different machine tabs for a moment, so they are two
                // different lists rather than two answers to one question.
                shadow.counters.skipped_machine_mismatch += 1;
                shadow.pending = None;
                return;
            }
            if !fed {
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
        let is_remote = selected != LOCAL_MACHINE_ID;
        if self.gx_store.local_focus.foreign_focus && !is_remote {
            // THIS COMPUTER's tab with the old runtime's focus on something the store does not own
            // the focus of (a remote session, the quick automations row): the store keeps its last
            // local focus while the projection has moved off it, so every local row's focus flags
            // disagree by design and the record is not one question.
            //
            // A REMOTE tab is the opposite case and is compared: there the six focus-derived
            // fields are the ones left out by name (`FocusComparable`), and everything else of
            // every row is a real comparison. Discarding the whole record there is what made this
            // gate unable to measure the thing it gates.
            self.gx_store.sidebar_shadow.counters.skipped_foreign_focus += 1;
            self.gx_store.sidebar_shadow.pending = None;
            return;
        }

        let compare_started = Instant::now();
        let focus = if is_remote {
            FocusComparable::No
        } else {
            FocusComparable::Yes
        };
        let fed_machines: std::collections::HashSet<&str> = self
            .gx_store
            .remote
            .tabs()
            .iter()
            .filter(|machine| machine.fed)
            .map(|machine| machine.machine_id.as_str())
            .collect();
        let difference = compare(
            &snapshot,
            self.gx_store.sidebar_list.view(),
            focus,
            &fed_machines,
        );
        let compare_us = compare_started.elapsed().as_micros() as u64;
        let scratch = self.gx_store_sidebar_scratch_check();

        let shadow = &mut self.gx_store.sidebar_shadow;
        shadow.counters.comparisons += 1;
        if is_remote {
            // The milestone's gate: `skippedRemote 0` says nothing on its own, because every
            // other skip can hold the count of real remote comparisons at zero beside it.
            shadow.counters.comparisons_remote += 1;
        }
        shadow.counters.last_compare_us = compare_us;
        shadow.counters.compare_max_us = shadow.counters.compare_max_us.max(compare_us);
        if let Some(scratch) = scratch {
            shadow.counters.scratch_checks += 1;
            if scratch {
                shadow.counters.scratch_mismatches += 1;
            }
        }
        let mut replaced: Option<(Vec<String>, super::sidebar_shadow_compare::SidebarMismatch)> =
            None;
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
                    if difference.only_explained_fields {
                        shadow.counters.explained_only += 1;
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
                        Some(previous) => {
                            shadow.counters.never_settled += 1;
                            replaced = Some((previous.fields.clone(), difference.clone()));
                            shadow.pending = Some(PendingDifference {
                                since: Instant::now(),
                                signature,
                                fields: difference.field_names(),
                                rebooks: 0,
                            });
                        }
                        None => {
                            shadow.pending = Some(PendingDifference {
                                since: Instant::now(),
                                signature,
                                fields: difference.field_names(),
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
        if let Some((previous, mismatch)) = &replaced {
            self.gx_store
                .diagnostics
                .sidebar_never_settled(previous, mismatch);
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
        let phases = self.gx_store.sidebar_list.install_phases();
        let remote = self.gx_store.remote.counters;
        let machines = self.gx_store.remote.tabs().len();
        self.gx_store.diagnostics.sidebar_summary(
            &counters,
            &list,
            source,
            deadline_kind,
            pending,
            groups,
            rows,
            phases,
            &remote,
            machines,
        );
        let ui = self.gx_store.sidebar_ui.counters;
        self.gx_store.diagnostics.sidebar_ui_summary(&ui);
        // The workspace session groups counters ride this path too, because it is the one that is
        // proved to reach the log in a quiet run: everything through `record()` is silent until the
        // shared settings snapshot is warm, and the two places this used to be emitted from (a push
        // and the one reconcile) both fire before that or not at all (gx_store/diagnostics.rs).
        let groups = self.gx_store.workspace_groups.counters;
        let side_state_held = self
            .gx_store
            .core
            .presentation()
            .machine(&MachineId::Local)
            .is_some_and(|machine| machine.side_state().workspace_groups.is_some());
        self.gx_store
            .diagnostics
            .workspace_groups_summary(groups, side_state_held);
        // K5, K6 and the project moves ride the SAME periodic path, for the reason that one cost
        // two live rounds: a record emitted only from a push has no line at all in a run where the
        // user moved no project, and the counters it carries are exactly what says whether the
        // path is alive. The first line goes out with every counter at zero on purpose.
        let collections = self.gx_store.collections.counters;
        let spaces = self.gx_store.spaces.counters;
        let moves = self.gx_store.project_moves;
        self.gx_store
            .diagnostics
            .client_document_summary(collections, spaces, moves);
        // A remote row's actions ride the same path for the same reason: a run in which the user
        // touched no remote row must still say so (gx_store/sidebar_remote.rs).
        self.gx_store_sidebar_actions_summary();
        // And the last-seen copies, whose two halves both fire only when there is a remote machine
        // to seed or to store (gx_store/remote_last_seen.rs).
        self.gx_store_last_seen_summary();
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

    /// Every so often the list is also built from scratch: a difference there is this port's own
    /// cache failing to invalidate, never a difference with the old projection, so it is named in
    /// its own record. `None` when this round did not check.
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
        let difference = compare_views(self.gx_store.sidebar_list.view(), &scratch);
        if let Some(difference) = &difference {
            let last_update = self.gx_store.sidebar_list.last_update;
            self.gx_store
                .diagnostics
                .sidebar_scratch_mismatch(difference, &last_update);
        }
        Some(difference.is_some())
    }
}

/// The store's key for a machine tab id.
fn machine_key(machine_id: &str) -> MachineId {
    if machine_id == LOCAL_MACHINE_ID {
        MachineId::Local
    } else {
        MachineId::Remote(machine_id.to_string())
    }
}
