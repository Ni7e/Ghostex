//! The Rust sidebar list inside the app: built from the store and the sidebar's own state, kept up
//! to date, and drawn when the renderer is switched to it.
//!
//! CDXC:Sidebar 2026-09-20 DECISION:
//! User: the desktop app stops running product logic in QuickJS; one Rust state store owns it, and
//! every interaction is a local state change plus one redraw. The list is derived here rather than
//! projected in QuickJS and posted over a bridge. It is rebuilt only when the store, the sidebar's
//! own state, the settings, the app's own browser tabs or the clock deadline of a row moved, never
//! per frame, and an update with nothing changed does no work at all. Which list the renderer
//! draws is the `sidebarListSource` setting, so the two can be compared in one running app.

use std::time::{Duration, Instant};

use ghostex_gx_core::{
    ChangeSummary, ConnectionPhase, FocusState, MachineId, SidebarInputs, SidebarSettings,
    SidebarView, SidebarViewModel, UnavailableState,
};
use serde_json::Value;

use super::host::now_ms;
use super::sidebar_list_inputs::{InputsCache, refresh_inputs, sort_mode};
use super::sidebar_snapshot::{SnapshotCache, snapshot_from_view};
use crate::GhostexGpuiApp;

/// How long the settings verdict is reused. Asking stats the settings file and clones its map
/// under a global lock, and an update can run several times a second.
const SETTINGS_MAX_AGE: Duration = Duration::from_millis(1000);
/// The earliest a clock deadline is allowed to wake the list, so a row whose countdown ends in a
/// millisecond does not book a timer per millisecond.
const MIN_DEADLINE_WAIT: Duration = Duration::from_millis(50);

/// Which list the renderer draws.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum SidebarListSource {
    /// The snapshot the TypeScript projection publishes, as before this milestone.
    #[default]
    Projection,
    /// The list derived from the Rust store.
    Store,
}

/// What happened since the app started. Memory only; the log lines are built from it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct SidebarListCounters {
    pub(crate) updates: u64,
    /// Updates that found nothing to do.
    pub(crate) idle: u64,
    pub(crate) view_changes: u64,
    pub(crate) installs: u64,
    pub(crate) deadline_wakes: u64,
    pub(crate) update_max_us: u64,
    pub(crate) install_max_us: u64,
    pub(crate) last_update_us: u64,
    pub(crate) last_install_us: u64,
}

/// The Rust list and everything the host keeps around it.
#[derive(Default)]
pub(crate) struct SidebarList {
    model: SidebarViewModel,
    /// What the store changed since the last update.
    changes: ChangeSummary,
    /// Something besides the store moved (the sidebar's own state, the app's browser tabs, a new
    /// publish of the values still mirrored).
    dirty: bool,
    settings: Option<(u64, SidebarSettings)>,
    settings_read_at: Option<Instant>,
    unavailable: UnavailableState,
    /// Focus as the newest build saw it. The view model compares it too, but only after the whole
    /// input set has been assembled and compared; this is what the cheap gate reads.
    last_focus: Option<FocusState>,
    /// Whether a list has ever been built, so the first update is never skipped.
    built: bool,
    /// The newest "which list is drawn" verdict and when it was taken. Asking costs a stat of the
    /// settings file and a clone of its map under a global lock, and several callers ask per
    /// publish. Held in a cell because the readers are `&self`.
    source: std::cell::Cell<Option<(Instant, SidebarListSource)>>,
    /// The clock deadline a timer is already booked for.
    deadline_booked: Option<u64>,
    /// Address of the published list the installed one last carried the menus of, so a publish
    /// that left the store's own list unchanged still refreshes them.
    installed_projection: usize,
    snapshot_cache: SnapshotCache,
    inputs_cache: InputsCache,
    /// The inputs the newest view was built from, so the shadow compares the same moment. Kept
    /// rather than rebuilt: an update that changed one session must not re-parse the browser tabs
    /// or clone the sidebar's whole state.
    pub(super) last_inputs: SidebarInputs,
    pub(super) last_built_at_ms: u64,
    pub(super) counters: SidebarListCounters,
}

impl SidebarList {
    pub(crate) fn view(&self) -> &SidebarView {
        self.model.view()
    }

    /// Folds what one pump changed into what the next update must apply.
    pub(super) fn note_changes(&mut self, changes: &ChangeSummary) {
        self.changes.merge(changes.clone());
    }

    /// Something besides the store moved.
    pub(super) fn mark_dirty(&mut self) {
        self.dirty = true;
    }

    /// The settings the list depends on, re-read at most once a second.
    fn settings(
        &mut self,
        published: Option<&crate::app::native_sidebar::model::NativeSidebarSnapshot>,
    ) -> SidebarSettings {
        let sort_mode = sort_mode(published);
        if let Some((hash, settings)) = &self.settings {
            if self
                .settings_read_at
                .is_some_and(|read_at| read_at.elapsed() < SETTINGS_MAX_AGE)
                && settings.sort_mode == sort_mode
            {
                let _ = hash;
                return settings.clone();
            }
        }
        let saved = crate::shared_settings::shared_sidebar_settings_snapshot();
        self.settings_read_at = Some(Instant::now());
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

    /// The next moment one of the drawn times reads differently. The view model does not hold the
    /// labels, so this is the host's own deadline beside the one the list reports.
    fn next_label_deadline_ms(&self, now_ms: u64, show_relative_time: bool) -> Option<u64> {
        self.model
            .view()
            .groups
            .iter()
            .flat_map(|group| group.core.sessions.iter())
            .filter_map(|session| {
                session
                    .row
                    .next_label_deadline_ms(now_ms, show_relative_time)
            })
            .min()
    }

    /// Whether a card draws the relative time at all (`hideLastActiveTimeOnSessionCards`).
    fn show_relative_time(&self) -> bool {
        self.settings
            .as_ref()
            .map(|(_, settings)| settings.show_last_active_time)
            .unwrap_or(true)
    }

    /// Whether an update would find nothing to do. Only the cheap signals are read here; the view
    /// model still decides what is actually rebuilt.
    fn nothing_moved(&self, settings: &SidebarSettings, focus: &FocusState, now_ms: u64) -> bool {
        self.built
            && !self.dirty
            && self.changes.is_empty()
            && self.last_focus.as_ref() == Some(focus)
            && self.last_inputs.settings == *settings
            && !self
                .model
                .next_deadline_ms()
                .is_some_and(|deadline| now_ms >= deadline)
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
}

impl GhostexGpuiApp {
    /// Which list the renderer draws.
    ///
    /// `GHOSTEX_SIDEBAR_LIST_SOURCE` decides it for the whole run when it is set. Otherwise the
    /// saved settings do, and moving the value there moves the list in a running app, because the
    /// settings file is re-read whenever it changes on disk. The setting has no row in Settings and
    /// is not a product choice: the two lists exist side by side only until the old projection is
    /// deleted. The normalizer drops keys it does not know, so a settings write by the app takes
    /// the key with it; the environment variable is the one that survives that.
    pub(crate) fn gx_store_sidebar_list_source(&self) -> SidebarListSource {
        // The store's list is only drawn once the sidebar's own state has been read; before that
        // it would show every project expanded and no hidden item hidden.
        if !self.gx_store.sidebar_ui.restored() {
            return SidebarListSource::Projection;
        }
        let cached = self.gx_store.sidebar_list.source.get();
        if let Some((taken_at, source)) = cached {
            if taken_at.elapsed() < SETTINGS_MAX_AGE {
                return source;
            }
        }
        let chosen = match std::env::var("GHOSTEX_SIDEBAR_LIST_SOURCE") {
            Ok(value) if !value.trim().is_empty() => value.trim().to_lowercase(),
            _ => crate::shared_settings::shared_sidebar_settings_snapshot()
                .object()
                .get("sidebarListSource")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_lowercase(),
        };
        let source = match chosen.as_str() {
            "store" => SidebarListSource::Store,
            _ => SidebarListSource::Projection,
        };
        self.gx_store
            .sidebar_list
            .source
            .set(Some((Instant::now(), source)));
        source
    }

    /// Whether the installed list already carries the menus of this publish.
    pub(crate) fn gx_store_sidebar_list_carries_projection(&self, identity: usize) -> bool {
        self.gx_store.sidebar_list.installed_projection == identity
    }

    /// Whether the renderer draws the store's list right now. A machine tab the view model cannot
    /// build (a remote machine, until M4d) keeps the old projection even with the switch on.
    pub(crate) fn gx_store_sidebar_draws_store_list(&self) -> bool {
        self.gx_store_sidebar_list_source() == SidebarListSource::Store
            && self.gx_store.sidebar_list.view().supported
    }

    /// The sidebar's own state moved. The list is rebuilt at once, because a click must show in
    /// the same frame.
    pub(crate) fn gx_store_sidebar_state_changed(&mut self, cx: &mut gpui::Context<Self>) {
        self.gx_store.sidebar_list.mark_dirty();
        self.gx_store_update_sidebar_list(cx);
    }

    /// Rebuilds the list if anything it reads moved, installs it when the renderer is on it, and
    /// books the next clock deadline. Cheap to call: an update with nothing changed returns at
    /// once.
    pub(crate) fn gx_store_update_sidebar_list(&mut self, cx: &mut gpui::Context<Self>) {
        let now_ms = now_ms();
        let machine = self.gx_store.core.presentation().machine(&MachineId::Local);
        let loaded = machine.is_some_and(|machine| machine.loaded().is_some());
        let live =
            machine.is_some_and(|machine| machine.connection().phase == ConnectionPhase::Live);
        let _ = live;
        self.gx_store
            .sidebar_list
            .note_machine_state(loaded, now_ms);

        let published = self.native_sidebar.projection.clone();
        let settings = self.gx_store.sidebar_list.settings(published.as_deref());
        // Nothing the list reads moved: the burst carried no change it draws, no click or publish
        // marked it, focus stands where it did, no row's own clock has run out, and the settings
        // read the same. Returning here is what keeps a pump that changed nothing free, rather
        // than re-assembling the inputs and comparing them field by field inside the view model.
        if self
            .gx_store
            .sidebar_list
            .nothing_moved(&settings, self.gx_store.core.focus(), now_ms)
        {
            self.gx_store.sidebar_list.counters.idle += 1;
            return;
        }
        self.gx_store.sidebar_list.last_focus = Some(self.gx_store.core.focus().clone());
        // Before the generation is read: pruning is a change to the sidebar's own state and the
        // inputs have to carry it.
        self.gx_store_prune_sidebar_tag_filters(&settings);
        let ui_generation = self.gx_store.sidebar_ui.generation();
        let changes = std::mem::take(&mut self.gx_store.sidebar_list.changes);
        self.gx_store.sidebar_list.dirty = false;
        let mut inputs = std::mem::take(&mut self.gx_store.sidebar_list.last_inputs);
        let unavailable = self.gx_store.sidebar_list.unavailable;
        let store = &mut self.gx_store;
        refresh_inputs(
            &mut inputs,
            &mut store.sidebar_list.inputs_cache,
            store.sidebar_ui.state(),
            ui_generation,
            settings,
            published.as_deref(),
            &self.sidebar_browser_tabs_snapshot,
            &store.sidebar_ui.stored_project_collections,
            unavailable,
        );
        let started = Instant::now();
        let changed =
            self.gx_store
                .sidebar_list
                .model
                .update(&self.gx_store.core, &inputs, &changes, now_ms);
        let update_us = started.elapsed().as_micros() as u64;
        {
            let list = &mut self.gx_store.sidebar_list;
            list.counters.updates += 1;
            list.counters.last_update_us = update_us;
            list.counters.update_max_us = list.counters.update_max_us.max(update_us);
            if changed {
                list.counters.view_changes += 1;
            }
            list.last_inputs = inputs;
            list.last_built_at_ms = now_ms;
            list.built = true;
        }
        // A row the list stopped drawing leaves the multi-selection, which is itself one of the
        // list's inputs, so the build runs once more when it did.
        let mut changed = changed;
        if self.gx_store_prune_sidebar_selection() {
            let mut inputs = std::mem::take(&mut self.gx_store.sidebar_list.last_inputs);
            let settings = inputs.settings.clone();
            let ui_generation = self.gx_store.sidebar_ui.generation();
            let store = &mut self.gx_store;
            refresh_inputs(
                &mut inputs,
                &mut store.sidebar_list.inputs_cache,
                store.sidebar_ui.state(),
                ui_generation,
                settings,
                published.as_deref(),
                &self.sidebar_browser_tabs_snapshot,
                &store.sidebar_ui.stored_project_collections,
                unavailable,
            );
            changed |= self.gx_store.sidebar_list.model.update(
                &self.gx_store.core,
                &inputs,
                &ghostex_gx_core::ChangeSummary::default(),
                now_ms,
            );
            self.gx_store.sidebar_list.last_inputs = inputs;
            self.gx_store.sidebar_list.dirty = false;
            cx.notify();
        }
        self.gx_store_book_sidebar_deadline(cx);
        if changed && self.gx_store_sidebar_draws_store_list() {
            self.gx_store_install_sidebar_list(cx);
        }
    }

    /// Drops ticked tag filters the Sort & Filter menu no longer offers, the way the old
    /// projection pruned them before every build.
    fn gx_store_prune_sidebar_tag_filters(&mut self, settings: &SidebarSettings) {
        if self
            .gx_store
            .sidebar_ui
            .state()
            .selected_tag_filters
            .is_empty()
        {
            return;
        }
        let machine = ghostex_gx_core::MachineId::Local;
        let offered = settings.offered_tag_filters(
            self.gx_store
                .core
                .presentation()
                .machine(&machine)
                .and_then(|machine| machine.side_state().custom_session_tags.as_ref()),
        );
        self.gx_store.sidebar_ui.retain_tag_filters(&offered);
    }

    /// Drops rows the list no longer draws from the multi-selection, the way the old projection
    /// prunes its own selection before it builds.
    fn gx_store_prune_sidebar_selection(&mut self) -> bool {
        if self
            .gx_store
            .sidebar_ui
            .state()
            .selected_session_ids
            .is_empty()
        {
            return false;
        }
        let drawn: std::collections::HashSet<&str> = self
            .gx_store
            .sidebar_list
            .model
            .view()
            .groups
            .iter()
            .flat_map(|group| group.core.sessions.iter())
            .map(|session| session.row.sidebar_session_id.as_str())
            .collect();
        self.gx_store
            .sidebar_ui
            .retain_selected_sessions(|session_id| drawn.contains(session_id))
    }

    /// Replaces the list the renderer draws with the one derived from the store.
    pub(crate) fn gx_store_install_sidebar_list(&mut self, cx: &mut gpui::Context<Self>) {
        let Some(published) = self.native_sidebar.projection.clone() else {
            // Nothing has been published yet, so the menus, the HUD and the machine tabs the list
            // still borrows are not there. The renderer keeps drawing nothing, as it does today
            // before the first publish.
            return;
        };
        let started = Instant::now();
        // The labels are formatted against the clock of the moment they are drawn, not the moment
        // the list was last built: a wake that only ticks a countdown does not rebuild the list.
        let now_ms = now_ms();
        let snapshot = {
            // Borrowed rather than cloned: the model and the cache are separate fields, so the
            // whole list does not have to be copied to build the one the renderer draws.
            let list = &mut self.gx_store.sidebar_list;
            snapshot_from_view(
                list.model.view(),
                &published,
                &mut list.snapshot_cache,
                now_ms,
            )
        };
        let install_us = started.elapsed().as_micros() as u64;
        let list = &mut self.gx_store.sidebar_list;
        list.installed_projection = std::sync::Arc::as_ptr(&published) as usize;
        list.counters.installs += 1;
        list.counters.last_install_us = install_us;
        list.counters.install_max_us = list.counters.install_max_us.max(install_us);
        self.install_native_sidebar_snapshot(std::sync::Arc::new(snapshot), cx);
    }

    /// Books one timer for the next moment a row moves on its own (a new session stops leading the
    /// list, a snooze ends, a countdown ticks). Nothing else wakes the list on time.
    fn gx_store_book_sidebar_deadline(&mut self, cx: &mut gpui::Context<Self>) {
        let now = now_ms();
        // Only the drawn list's labels are formatted here; the old projection refreshes its own
        // from the clock rows it publishes. The view model's own deadline is booked either way,
        // because the order and the sections it moves are the list's, not the labels'.
        let show_relative_time = self.gx_store.sidebar_list.show_relative_time();
        let label_deadline = self
            .gx_store_sidebar_draws_store_list()
            .then(|| {
                self.gx_store
                    .sidebar_list
                    .next_label_deadline_ms(now, show_relative_time)
            })
            .flatten();
        let Some(deadline) = [
            self.gx_store.sidebar_list.next_deadline_ms(),
            label_deadline,
        ]
        .into_iter()
        .flatten()
        .min() else {
            self.gx_store.sidebar_list.deadline_booked = None;
            return;
        };
        let booked = self.gx_store.sidebar_list.deadline_booked;
        // A timer for an earlier or equal deadline already covers this one.
        if booked.is_some_and(|booked| booked <= deadline) {
            return;
        }
        self.gx_store.sidebar_list.deadline_booked = Some(deadline);
        let wait = Duration::from_millis(deadline.saturating_sub(now_ms())).max(MIN_DEADLINE_WAIT);
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(wait).await;
            let _ = this.update(cx, |this, cx| {
                if this.gx_store.sidebar_list.deadline_booked != Some(deadline) {
                    return;
                }
                this.gx_store.sidebar_list.deadline_booked = None;
                this.gx_store.sidebar_list.counters.deadline_wakes += 1;
                this.gx_store_update_sidebar_list(cx);
                // A label that reads differently is not a change in the list itself, so the update
                // above may have found nothing; the drawn rows still have to be rebuilt.
                if this.gx_store_sidebar_draws_store_list() {
                    this.gx_store_install_sidebar_list(cx);
                    this.gx_store_book_sidebar_deadline(cx);
                }
            });
        })
        .detach();
    }
}

impl SidebarList {
    fn next_deadline_ms(&self) -> Option<u64> {
        self.model.next_deadline_ms()
    }
}
