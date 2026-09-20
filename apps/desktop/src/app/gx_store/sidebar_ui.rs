//! The sidebar's own state inside the app: seeded from client storage once, moved by intents, and
//! written back on a debounce.
//!
//! CDXC:Sidebar 2026-09-20 DECISION:
//! User: the desktop app stops running product logic in QuickJS, and every interaction is a local
//! state change plus one redraw. A click on a chevron, a tag filter or a Space now moves this
//! state and the list is rebuilt from it in the same frame. The write to client storage happens
//! afterwards, off the UI thread, and the list never waits for it. The same command is still sent
//! to the old projection, which keeps its own copy for the menus it still owns (M4c).

use std::time::{Duration, Instant};

use ghostex_gx_core::{
    SidebarCollapseDiff, SidebarCollapseState, SidebarPersistSet, SidebarUiIntent, SidebarUiStore,
    hidden_items_into_storage,
};
use serde_json::Value;

use super::sidebar_ui_storage::{
    SidebarUiWrite, StoredSidebarUi, read_sidebar_ui_state, write_sidebar_ui_state,
};
use crate::GhostexGpuiApp;

/// How long intents are folded together before one write runs. A hold on a collapse hotkey, or a
/// Collapse All over thirty projects, must cost one write and not one per step.
const WRITE_DEBOUNCE: Duration = Duration::from_millis(400);
/// How often a write that failed books its own retry before it waits for the next click instead.
/// Nothing is lost when it stops: the change stays owed and the next intent carries it.
const MAX_WRITE_RETRIES: u32 = 3;
/// How long a failed read waits before it is tried again. Nothing the user does is lost while it
/// fails: the state still moves, only the write is refused until the state is known.
const READ_RETRY: Duration = Duration::from_secs(10);

/// What happened since the app started. Memory only; the log lines are built from it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct SidebarUiCounters {
    pub(crate) intents: u64,
    pub(crate) writes: u64,
    pub(crate) write_failures: u64,
    pub(crate) read_failures: u64,
    pub(crate) write_max_us: u64,
}

/// The sidebar's own state and everything the host needs around it.
pub(crate) struct SidebarUiHost {
    store: SidebarUiStore,
    /// The state is only written once it is known: writing before the read lands would store an
    /// empty collapse state over the user's own.
    restored: bool,
    restoring: bool,
    retry_after: Option<Instant>,
    /// What the last read or write left in storage, so the next write carries only the difference.
    base_collapse: SidebarCollapseState,
    write_scheduled: bool,
    write_retries: u32,
    /// Bumped by every change, so the list can tell whether this state moved without comparing it.
    generation: u64,
    /// The sidebar's own copy of the project collections, read with the rest of the state.
    pub(super) stored_project_collections: Option<Value>,
    pub(super) counters: SidebarUiCounters,
    pub(super) last_error: Option<&'static str>,
}

impl Default for SidebarUiHost {
    fn default() -> Self {
        Self {
            store: SidebarUiStore::new(),
            restored: false,
            restoring: false,
            retry_after: None,
            base_collapse: SidebarCollapseState::default(),
            write_scheduled: false,
            write_retries: 0,
            generation: 0,
            stored_project_collections: None,
            counters: SidebarUiCounters::default(),
            last_error: None,
        }
    }
}

impl SidebarUiHost {
    /// The state the list is built from. Empty defaults until the first read lands.
    pub(crate) fn state(&self) -> &ghostex_gx_core::SidebarUiState {
        self.store.state()
    }

    /// Whether client storage has been read. The Rust list is not drawn before it has, because a
    /// list built from empty collapse state would show every project expanded for a moment.
    pub(crate) fn restored(&self) -> bool {
        self.restored
    }

    /// Moves whenever the state moves.
    pub(super) fn generation(&self) -> u64 {
        self.generation
    }

    pub(crate) fn selected_machine_id(&self) -> &str {
        self.store.selected_machine_id()
    }

    /// Drops rows the list no longer draws from the multi-selection.
    pub(super) fn retain_selected_sessions(&mut self, keep: impl FnMut(&str) -> bool) -> bool {
        let moved = self.store.retain_selected_sessions(keep);
        if moved {
            self.generation += 1;
        }
        moved
    }

    fn adopt(&mut self, stored: StoredSidebarUi) {
        let state = ghostex_gx_core::SidebarUiState {
            selected_machine_id: stored.selected_machine_id,
            collapse: stored.collapse.clone(),
            hidden_items: stored.hidden_items,
            // Show Hidden, the tag filters and the multi-selection start over on every launch,
            // exactly as the TypeScript state did: none of them is persisted.
            ..ghostex_gx_core::SidebarUiState::default()
        };
        self.base_collapse = stored.collapse;
        self.stored_project_collections = stored.project_collections;
        self.store.restore(state);
        self.restored = true;
        self.generation += 1;
    }

    /// The write the pending changes amount to, what it was computed against, and the set to owe
    /// again if it never reaches storage.
    fn take_write(&mut self) -> (SidebarUiWrite, SidebarCollapseState, SidebarPersistSet) {
        let pending = self.store.take_pending();
        let state = self.store.state();
        let mut write = SidebarUiWrite::default();
        if pending.collapse {
            let diff = SidebarCollapseDiff::between(&self.base_collapse, &state.collapse);
            if !diff.is_empty() {
                write.collapse = Some((diff, state.collapse.clone()));
            }
        }
        if pending.hidden_items {
            write.hidden_items = Some(hidden_items_into_storage(&state.hidden_items));
        }
        if pending.machine_tab {
            write.selected_machine_id = Some(state.selected_machine_id.clone());
        }
        (write, state.collapse.clone(), pending)
    }
}

impl GhostexGpuiApp {
    /// Reads the sidebar's own state from client storage. Runs once; a failed read is retried on
    /// the next call, which the sidebar bootstrap makes whenever its transport is synced.
    pub(crate) fn gx_store_restore_sidebar_ui(&mut self, cx: &mut gpui::Context<Self>) {
        let ui = &mut self.gx_store.sidebar_ui;
        if ui.restored || ui.restoring {
            return;
        }
        if ui.retry_after.is_some_and(|at| Instant::now() < at) {
            return;
        }
        ui.restoring = true;
        cx.spawn(async move |this, cx| {
            let stored = cx
                .background_executor()
                .spawn(async move { read_sidebar_ui_state() })
                .await;
            let _ = this.update(cx, |this, cx| {
                let ui = &mut this.gx_store.sidebar_ui;
                ui.restoring = false;
                match stored {
                    Ok(stored) => {
                        ui.last_error = None;
                        ui.adopt(stored);
                        // Everything the list reads moved at once; it is rebuilt from scratch.
                        this.gx_store_sidebar_state_changed(cx);
                    }
                    Err(code) => {
                        ui.counters.read_failures += 1;
                        ui.last_error = Some(code);
                        ui.retry_after = Some(Instant::now() + READ_RETRY);
                        this.gx_store.diagnostics.sidebar_ui_read_failed(code);
                    }
                }
            });
        })
        .detach();
    }

    /// Applies one intent and books the write it owes. Returns whether the list must be rebuilt.
    pub(crate) fn gx_store_apply_sidebar_ui_intent(
        &mut self,
        intent: SidebarUiIntent,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        let ui = &mut self.gx_store.sidebar_ui;
        ui.counters.intents += 1;
        let outcome = ui.store.apply(intent);
        if !outcome.changed {
            return false;
        }
        ui.generation += 1;
        if !ui.store.pending().is_empty() {
            self.gx_store_schedule_sidebar_ui_write(cx);
        }
        self.gx_store_sidebar_state_changed(cx);
        true
    }

    /// Books one write for everything the intents since the last one changed.
    fn gx_store_schedule_sidebar_ui_write(&mut self, cx: &mut gpui::Context<Self>) {
        let ui = &mut self.gx_store.sidebar_ui;
        // Nothing is written before the read landed: the difference would be measured against an
        // empty state and would erase what the user has.
        if !ui.restored || ui.write_scheduled {
            return;
        }
        ui.write_scheduled = true;
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(WRITE_DEBOUNCE).await;
            let Ok(Some((write, base, owed))) = this.update(cx, |this, _| {
                let ui = &mut this.gx_store.sidebar_ui;
                ui.write_scheduled = false;
                let (write, base, owed) = ui.take_write();
                (!write.is_empty()).then_some((write, base, owed))
            }) else {
                return;
            };
            let started = Instant::now();
            let stored = write.collapse.is_some();
            let result = cx
                .background_executor()
                .spawn(async move { write_sidebar_ui_state(&write) })
                .await;
            let elapsed = started.elapsed().as_micros() as u64;
            let _ = this.update(cx, |this, cx| {
                let ui = &mut this.gx_store.sidebar_ui;
                ui.counters.write_max_us = ui.counters.write_max_us.max(elapsed);
                match result {
                    Ok(()) => {
                        ui.counters.writes += 1;
                        ui.last_error = None;
                        ui.write_retries = 0;
                        if stored {
                            // Stored now; the next write carries what changes from here.
                            ui.base_collapse = base;
                        }
                    }
                    Err(code) => {
                        ui.counters.write_failures += 1;
                        ui.last_error = Some(code);
                        // The change is still only in memory, so it is owed again rather than
                        // dropped: the next click, or the retry below, carries it with the rest.
                        ui.store.mark_pending(owed);
                        let retry = ui.write_retries < MAX_WRITE_RETRIES;
                        ui.write_retries += 1;
                        this.gx_store.diagnostics.sidebar_ui_write_failed(code);
                        if retry {
                            this.gx_store_schedule_sidebar_ui_write(cx);
                        }
                    }
                }
            });
        })
        .detach();
    }
}
