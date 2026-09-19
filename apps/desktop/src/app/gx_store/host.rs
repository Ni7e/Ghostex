use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use futures::StreamExt as _;
use futures::channel::mpsc;
use ghostex_gx_client::{ClientOutput, GxClient, GxClientConfig};
use ghostex_gx_core::{ConnectionPhase, ConnectionUpdate, Core, Event, MachineId};

use super::diagnostics::GxStoreDiagnostics;
use super::shadow_diff::ShadowDiff;
use crate::GhostexGpuiApp;
use crate::app::model::GpuiGxserverPresentationFocusState;

/// The daemon does not route by this id; it only tells this socket apart from the old runtime's
/// (`ghostex-gpui-sidebar`) in a frame capture.
const GX_STORE_CLIENT_ID: &str = "ghostex-gpui-store";
/// How long a difference between the two tab lists must last before it counts. The old runtime
/// and the store read the same daemon over two sockets, so either can be a few frames ahead.
const SHADOW_SETTLE: Duration = Duration::from_millis(1000);

#[derive(Clone, PartialEq, Eq)]
struct GxStoreTransport {
    base_url: String,
    auth_token: String,
}

/// What happened since the app started. Memory only; the log lines are built from it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct GxStoreCounters {
    pub(crate) client_starts: u64,
    pub(crate) pumps: u64,
    pub(crate) events: u64,
    pub(crate) largest_burst: usize,
    pub(crate) connections_lost: u64,
    pub(crate) reloads: u64,
    pub(crate) resubscribes_requested: u64,
    pub(crate) skipped_row_reports: u64,
    pub(crate) client_diagnostics: u64,
}

/// CDXC:StateSync 2026-09-19 DECISION:
/// User: the desktop app stops running product logic in QuickJS; one Rust state store owns projects, sessions, tabs, panes, focus, and chat state, and gxserver is the only thing the app syncs with.
/// This is that store inside the app, fed by its own socket to the local daemon. Until the focus and tab milestone it runs in shadow beside the old runtime: nothing on screen reads it, no pump repaints anything, and its only outputs are counters and the `native.sidebar.refresh` diagnostic log. It always runs, because the next milestone reads it; only the disk logging is gated.
#[derive(Default)]
pub(crate) struct GxStoreHost {
    pub(super) core: Core,
    pub(super) client: Option<GxClient>,
    transport: Option<GxStoreTransport>,
    /// Shared with the client thread, which quotes it as `lastRevision` when it subscribes.
    held_revision: Arc<AtomicI64>,
    pub(super) counters: GxStoreCounters,
    connecting_since: Option<Instant>,
    pub(super) shadow: ShadowDiff,
    pub(super) diagnostics: GxStoreDiagnostics,
}

impl GxStoreHost {
    /// Drains the client and applies the burst. Runs on the UI thread and does no I/O: frames are
    /// parsed on the client thread, and everything here is memory work bounded by the burst.
    fn pump(&mut self) {
        let Some(client) = &self.client else {
            return;
        };
        let outputs = client.drain();
        if outputs.is_empty() {
            return;
        }
        let mut events = Vec::with_capacity(outputs.len());
        for output in outputs {
            match output {
                ClientOutput::Event(event) => {
                    if let Event::Connection { update, .. } = &event {
                        self.note_connection(update);
                    }
                    events.push(event);
                }
                ClientOutput::Diagnostic(diagnostic) => {
                    self.counters.client_diagnostics += 1;
                    self.diagnostics.client_diagnostic(&diagnostic);
                }
            }
        }
        self.counters.pumps += 1;
        self.counters.events += events.len() as u64;
        self.counters.largest_burst = self.counters.largest_burst.max(events.len());
        let output = self.core.handle_batch(events, now_ms());
        if let Some(loaded) = self.core.presentation().loaded(&MachineId::Local) {
            self.held_revision.store(loaded.revision, Ordering::Release);
        }
        if !output.changes.machines_reloaded.is_empty() {
            self.counters.reloads += 1;
            let since_connect = self.connecting_since.map(|since| since.elapsed());
            self.diagnostics
                .store_loaded(&self.core, &self.counters, since_connect);
        }
        let live = self
            .core
            .presentation()
            .machine(&MachineId::Local)
            .is_some_and(|machine| machine.connection().phase == ConnectionPhase::Live);
        if live {
            // The next "connect to loaded" time starts at the next reconnect.
            self.connecting_since = None;
        }
        self.run_effects(output.effects);
        // New frames may be exactly what a pending tab list difference was waiting for.
        self.settle_shadow_diff();
    }

    fn note_connection(&mut self, update: &ConnectionUpdate) {
        match update {
            ConnectionUpdate::Connecting { .. } => {
                self.connecting_since.get_or_insert_with(Instant::now);
            }
            ConnectionUpdate::Lost { .. } => self.counters.connections_lost += 1,
            _ => {}
        }
        self.diagnostics.connection(update);
    }

    /// Mirrors the old runtime's focus into the core and compares its tab list with the store's.
    /// Returns `true` when a difference started waiting to settle, so the caller schedules its
    /// judgement.
    fn observe_old_runtime_focus_state(
        &mut self,
        old_state: &GpuiGxserverPresentationFocusState,
    ) -> bool {
        let waiting_since = self.shadow.pending_since();
        self.shadow.observe(&mut self.core, old_state, now_ms());
        self.diagnostics.shadow_summary(&self.shadow, &self.core);
        // A new difference, or another one than was waiting, starts its own clock.
        let now_waiting_since = self.shadow.pending_since();
        now_waiting_since.is_some() && now_waiting_since != waiting_since
    }

    fn settle_shadow_diff(&mut self) {
        if let Some(mismatch) = self.shadow.settle(&mut self.core, SHADOW_SETTLE, now_ms()) {
            self.diagnostics.shadow_mismatch(&mismatch, &self.core);
        }
        self.diagnostics.shadow_summary(&self.shadow, &self.core);
    }
}

impl GhostexGpuiApp {
    /// Starts the store's client for the local daemon, or restarts it when the transport (base
    /// URL or token) changed. Called wherever the sidebar bootstrap is set. The core and its rows
    /// survive a restart of the client: the new socket subscribes with the held revision, and a
    /// daemon with another identity makes the core ask for a full snapshot.
    pub(crate) fn sync_gx_store_transport(&mut self, cx: &mut gpui::Context<Self>) {
        let next = self
            .sidebar_gxserver_bootstrap
            .as_ref()
            .map(|bootstrap| GxStoreTransport {
                base_url: bootstrap.base_url.clone(),
                auth_token: bootstrap.auth_token.clone(),
            });
        let host = &mut self.gx_store;
        if host.transport == next {
            return;
        }
        // Dropping the client stops its thread; its wake channel closes and ends the old pump.
        host.client = None;
        host.transport = next.clone();
        let Some(transport) = next else {
            return;
        };
        let (wake, mut wakes) = mpsc::unbounded::<()>();
        let client = GxClient::start(
            GxClientConfig {
                machine: MachineId::Local,
                base_url: transport.base_url,
                auth_token: transport.auth_token,
                client_id: GX_STORE_CLIENT_ID.to_string(),
                held_revision: host.held_revision.clone(),
                forward_chat_frames: false,
            },
            move || {
                let _ = wake.unbounded_send(());
            },
        );
        match client {
            Ok(client) => {
                host.client = Some(client);
                host.counters.client_starts += 1;
            }
            Err(error) => {
                host.transport = None;
                host.diagnostics.client_start_failed(&error);
                return;
            }
        }
        cx.spawn(async move |this, cx| {
            while wakes.next().await.is_some() {
                if this.update(cx, |this, _| this.gx_store.pump()).is_err() {
                    break;
                }
            }
        })
        .detach();
    }

    /// The old runtime published its focus state. Shadow only: the store follows the old
    /// runtime's focus and its tab list is compared, nothing else reads the result.
    pub(crate) fn gx_store_observe_old_runtime_focus_state(
        &mut self,
        old_state: &GpuiGxserverPresentationFocusState,
        cx: &mut gpui::Context<Self>,
    ) {
        if !self.gx_store.observe_old_runtime_focus_state(old_state) {
            return;
        }
        // A difference that no later frame or publish resolves still has to be judged.
        cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(SHADOW_SETTLE + Duration::from_millis(200))
                .await;
            let _ = this.update(cx, |this, _| this.gx_store.settle_shadow_diff());
        })
        .detach();
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}
