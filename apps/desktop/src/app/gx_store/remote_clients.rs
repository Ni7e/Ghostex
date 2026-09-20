//! One gxserver client per connected remote machine, feeding the same store.
//!
//! CDXC:RemoteMachines 2026-09-20 DECISION:
//! User (2026-09-19): one Rust state store owns projects, sessions, tabs, panes, focus and chat
//! state, and gxserver is the only thing the app syncs with. A remote machine is another gxserver,
//! so it is another client of the same shape feeding the same store, keyed by machine id, through
//! the same parse and reduce path as this computer's. What stays out of gx-core is everything that
//! is not the daemon's state: which machines are saved, whether the user enabled them, the SSH
//! tunnel, the connect ladder, the reconnect and the wire generation are all the host's, and the
//! core only ever learns "connecting", "live" or "lost" about them.
//!
//! The tunnel is already the app's: `remote_gxserver_connections` holds the loopback port and the
//! bearer token of every machine whose SSH connection is up, and every connect transition funnels
//! through `dispatch_gpui_remote_machine_status_with_message`. So a client starts on the connected
//! edge and stops when the machine leaves that state; nothing here opens a tunnel or speaks SSH.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::{Duration, Instant};

use futures::StreamExt as _;
use futures::channel::mpsc;
use ghostex_gx_client::{ClientOutput, GxClient, GxClientConfig};
use ghostex_gx_core::{
    ConnectionPhase, ConnectionUpdate, Event, MACHINE_STATE_CONNECTED, MachineId, MachineTabInput,
};

use super::host::{GxStoreHost, now_ms};
use crate::GhostexGpuiApp;

/// How long the machine list is reused. Building it stats the settings file and clones its map
/// under a global lock, and the publish path asks on every publish.
const TABS_MAX_AGE: Duration = Duration::from_millis(1000);
/// Delay before a client whose thread ended on its own is replaced (the last entry repeats), the
/// same ladder the local client uses.
const CLIENT_RESTART_BACKOFF_MS: [u64; 5] = [1000, 5000, 15000, 30000, 60000];
/// A client that lived this long before its thread ended starts the backoff over.
const CLIENT_HEALTHY_LIFETIME: Duration = Duration::from_secs(60);

/// What happened since the app started. Memory only; the log lines are built from it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct RemoteClientCounters {
    pub(crate) starts: u64,
    /// Clients stopped because their machine left the connected state.
    pub(crate) stops: u64,
    /// Machines whose rows were dropped because the user disabled or removed them.
    pub(crate) unloads: u64,
    pub(crate) thread_exits: u64,
    pub(crate) events: u64,
    pub(crate) reloads: u64,
}

/// One remote machine's client.
struct RemoteClient {
    client: Option<GxClient>,
    /// Shared with the client thread, which quotes it as `lastRevision` when it subscribes.
    held_revision: Arc<AtomicI64>,
    /// The loopback port and token the client was started for. A machine that reconnects through
    /// another port gets a new client.
    port: u16,
    token: String,
    /// Bumped by every start, so a pump task or a restart timer of an earlier client can tell that
    /// it is no longer the one in charge.
    generation: u64,
    started_at: Option<Instant>,
    restart_attempt: u32,
    /// The earliest a replacement may start after the thread ended on its own. Without it the
    /// reconcile, which runs on the publish path, would start a new client within a second of
    /// every death and the backoff ladder would never be walked.
    restart_due_at: Option<Instant>,
}

/// Every remote machine's client, and the machine tabs the sidebar draws.
#[derive(Default)]
pub(crate) struct RemoteClients {
    clients: BTreeMap<String, RemoteClient>,
    /// The machine tabs, this computer first, as the settings and the connect states describe
    /// them. The sidebar list reads this; nothing else builds it.
    tabs: Vec<MachineTabInput>,
    tabs_read_at: Option<Instant>,
    pub(super) counters: RemoteClientCounters,
}

impl RemoteClients {
    /// The machine tabs. Empty until the first reconcile, which is the moment before the app has
    /// read its settings.
    pub(crate) fn tabs(&self) -> &[MachineTabInput] {
        &self.tabs
    }

    pub(super) fn client(&self, machine_id: &str) -> Option<&GxClient> {
        self.clients
            .get(machine_id)
            .and_then(|remote| remote.client.as_ref())
    }

    pub(super) fn held_revision(&self, machine_id: &str) -> Option<&Arc<AtomicI64>> {
        self.clients
            .get(machine_id)
            .map(|remote| &remote.held_revision)
    }

    fn next_restart_delay(&mut self, machine_id: &str) -> Duration {
        let Some(remote) = self.clients.get_mut(machine_id) else {
            return Duration::from_millis(CLIENT_RESTART_BACKOFF_MS[0]);
        };
        if remote
            .started_at
            .take()
            .is_some_and(|at| at.elapsed() >= CLIENT_HEALTHY_LIFETIME)
        {
            remote.restart_attempt = 0;
        }
        let step = (remote.restart_attempt as usize).min(CLIENT_RESTART_BACKOFF_MS.len() - 1);
        remote.restart_attempt = remote.restart_attempt.saturating_add(1);
        let delay = Duration::from_millis(CLIENT_RESTART_BACKOFF_MS[step]);
        remote.restart_due_at = Some(Instant::now() + delay);
        delay
    }
}

impl GxStoreHost {
    /// Applies what one remote client delivered. Returns whether its thread is gone.
    pub(super) fn pump_remote(&mut self, machine_id: &str) -> bool {
        let Some(client) = self.remote.client(machine_id) else {
            return false;
        };
        let outputs = client.drain();
        let thread_ended = client.thread_ended();
        if outputs.is_empty() {
            return thread_ended;
        }
        let machine = MachineId::Remote(machine_id.to_string());
        let mut events = Vec::with_capacity(outputs.len());
        for output in outputs {
            match output {
                ClientOutput::Event(event) => {
                    if let Event::Connection { update, .. } = &event {
                        self.diagnostics.connection(update);
                    }
                    events.push(event);
                }
                ClientOutput::Diagnostic(diagnostic) => {
                    self.counters.client_diagnostics += 1;
                    self.diagnostics.client_diagnostic(&diagnostic);
                }
            }
        }
        self.remote.counters.events += events.len() as u64;
        let output = self.core.handle_batch(events, now_ms());
        // The sidebar list derives from these, whichever machine they belong to: the selected tab
        // draws one machine's rows and every tab draws a badge counted over another's.
        self.sidebar_list.note_changes(&output.changes);
        if let Some(loaded) = self.core.presentation().loaded(&machine) {
            if let Some(held) = self.remote.held_revision(machine_id) {
                held.store(loaded.revision, Ordering::Release);
            }
        }
        if output.changes.machines_reloaded.contains(&machine) {
            self.remote.counters.reloads += 1;
            self.diagnostics.remote_machine_loaded(&self.core, &machine);
        }
        self.run_effects(output.effects);
        // A remote frame can be exactly what a pending remote tab-list difference was waiting for.
        self.settle_shadow_diff();
        thread_ended
    }

    /// Drops a machine's client and tells the core its stream is down, so the rows it holds stay on
    /// screen as stale instead of vanishing. `MachineUnloaded` is the other path, for a machine the
    /// user disabled or removed.
    fn retire_remote_client(&mut self, machine_id: &str, reason: &str) {
        let Some(remote) = self.remote.clients.get_mut(machine_id) else {
            return;
        };
        remote.client = None;
        // Cleared here and set again by `next_restart_delay` when a thread death is what retired
        // it. A machine that simply reconnected through another port must not sit out the ladder
        // of the client that died before it.
        remote.restart_due_at = None;
        let machine = MachineId::Remote(machine_id.to_string());
        let still_connected = self
            .core
            .presentation()
            .machine(&machine)
            .is_some_and(|entry| {
                matches!(
                    entry.connection().phase,
                    ConnectionPhase::Connecting | ConnectionPhase::Live
                )
            });
        if !still_connected {
            return;
        }
        let lost = ConnectionUpdate::Lost {
            error: Some(reason.to_string()),
        };
        self.diagnostics.connection(&lost);
        let output = self.core.handle(
            Event::Connection {
                machine,
                update: lost,
            },
            now_ms(),
        );
        self.sidebar_list.note_changes(&output.changes);
    }
}

impl GhostexGpuiApp {
    /// Brings the remote clients in line with the machines that are connected right now, and
    /// rebuilds the machine tabs the sidebar draws.
    ///
    /// `force` is for the connect funnel, which must act in the frame the state changed; the
    /// publish path asks with `false` and is answered from the cache most of the time.
    pub(crate) fn gx_store_sync_remote_clients(
        &mut self,
        force: bool,
        cx: &mut gpui::Context<Self>,
    ) {
        if !force
            && self
                .gx_store
                .remote
                .tabs_read_at
                .is_some_and(|at| at.elapsed() < TABS_MAX_AGE)
        {
            return;
        }
        self.gx_store.remote.tabs_read_at = Some(Instant::now());
        // One settings read per reconcile: the order is what the tabs are drawn in and the map is
        // what every membership test below asks.
        let ordered = enabled_remote_machines();
        let enabled: BTreeMap<&str, &str> = ordered
            .iter()
            .map(|(machine_id, label)| (machine_id.as_str(), label.as_str()))
            .collect();
        // A machine is fed while its tunnel is up and the connect funnel says connected: those two
        // are what make a loopback port and a token exist at all.
        let connected: BTreeMap<String, (u16, String)> = enabled
            .keys()
            .filter(|machine_id| {
                self.remote_machine_connect_states
                    .get(**machine_id)
                    .map(String::as_str)
                    == Some(MACHINE_STATE_CONNECTED)
            })
            .filter_map(|machine_id| {
                let connection = self.remote_gxserver_connections.get(*machine_id)?;
                let target = connection.request_target();
                Some(((*machine_id).to_string(), (target.local_port, target.token)))
            })
            .collect();

        // Stop what is no longer connected, and forget a machine the user disabled or removed.
        let held: Vec<String> = self.gx_store.remote.clients.keys().cloned().collect();
        for machine_id in held {
            let wanted = connected.get(&machine_id);
            let same_target = wanted.is_some_and(|(port, token)| {
                self.gx_store
                    .remote
                    .clients
                    .get(&machine_id)
                    .is_some_and(|remote| remote.port == *port && remote.token == *token)
            });
            if same_target {
                continue;
            }
            self.gx_store.remote.counters.stops += 1;
            self.gx_store
                .retire_remote_client(&machine_id, "the machine is no longer connected");
            match wanted {
                // Still connected, through a new tunnel: a fresh target is a fresh start.
                Some(_) => {
                    if let Some(remote) = self.gx_store.remote.clients.get_mut(&machine_id) {
                        remote.restart_attempt = 0;
                    }
                }
                None => {
                    self.gx_store.remote.clients.remove(&machine_id);
                }
            }
        }
        // A machine that left the settings, or that the user disabled, loses its rows and its tab.
        let forget: Vec<MachineId> = self
            .gx_store
            .core
            .presentation()
            .machines()
            .map(|(machine, _)| machine.clone())
            .filter(|machine| {
                machine
                    .remote_id()
                    .is_some_and(|machine_id| !enabled.contains_key(machine_id))
            })
            .collect();
        for machine in forget {
            self.gx_store.remote.counters.unloads += 1;
            if let Some(machine_id) = machine.remote_id() {
                self.gx_store.remote.clients.remove(machine_id);
            }
            let output = self
                .gx_store
                .core
                .handle(Event::MachineUnloaded { machine }, super::host::now_ms());
            self.gx_store.sidebar_list.note_changes(&output.changes);
        }
        for (machine_id, (port, token)) in &connected {
            let running = self
                .gx_store
                .remote
                .clients
                .get(machine_id)
                .is_some_and(|remote| {
                    remote.client.is_some() && remote.port == *port && remote.token == *token
                });
            let waiting = self
                .gx_store
                .remote
                .clients
                .get(machine_id)
                .and_then(|remote| remote.restart_due_at)
                .is_some_and(|due| Instant::now() < due);
            if running || waiting {
                continue;
            }
            self.start_gx_store_remote_client(machine_id, *port, token, cx);
        }

        let selected = self.gx_store.sidebar_ui.selected_machine_id().to_string();
        let tabs = self.remote_machine_tabs(&ordered);
        let moved = self.gx_store.remote.tabs != tabs;
        self.gx_store.remote.tabs = tabs;
        if moved {
            // A tab the sidebar no longer offers must not stay selected, which is what
            // `createNativeSidebarSnapshot` does with its own copy.
            if !self
                .gx_store
                .remote
                .tabs
                .iter()
                .any(|machine| machine.machine_id == selected)
            {
                self.gx_store_apply_sidebar_ui_intent(
                    ghostex_gx_core::SidebarUiIntent::SelectMachine {
                        machine_id: ghostex_gx_core::LOCAL_MACHINE_ID.to_string(),
                    },
                    cx,
                );
            }
            self.gx_store_sidebar_state_changed(cx);
        }
    }

    /// The machine tabs: this computer, then every machine the user has enabled, in settings order.
    fn remote_machine_tabs(&self, ordered: &[(String, String)]) -> Vec<MachineTabInput> {
        let mut tabs = vec![MachineTabInput {
            machine_id: ghostex_gx_core::LOCAL_MACHINE_ID.to_string(),
            label: "Local".to_string(),
            state: MACHINE_STATE_CONNECTED.to_string(),
            message: None,
            fed: true,
        }];
        for (machine_id, label) in ordered {
            tabs.push(MachineTabInput {
                machine_id: machine_id.clone(),
                label: label.clone(),
                state: self
                    .remote_machine_connect_states
                    .get(machine_id.as_str())
                    .cloned()
                    .unwrap_or_else(|| "disconnected".to_string()),
                // The sanitized failure summary is the old projection's; it moves with the rest of
                // the connect state in M5.
                message: None,
                // "The store can draw this machine's list", which is what `supported` gates the
                // renderer on. A machine the host has a client for, running or waiting out a
                // backoff, and a machine whose rows are still held after its stream dropped, both
                // qualify; a machine that has not connected in this run does not, and its tab
                // keeps drawing the old projection's last-seen copy.
                fed: self
                    .gx_store
                    .remote
                    .clients
                    .contains_key(machine_id.as_str())
                    || self
                        .gx_store
                        .core
                        .presentation()
                        .loaded(&MachineId::Remote(machine_id.clone()))
                        .is_some(),
            });
        }
        tabs
    }

    /// The one start path for a remote machine's client.
    fn start_gx_store_remote_client(
        &mut self,
        machine_id: &str,
        port: u16,
        token: &str,
        cx: &mut gpui::Context<Self>,
    ) {
        let entry = self
            .gx_store
            .remote
            .clients
            .entry(machine_id.to_string())
            .or_insert_with(|| RemoteClient {
                client: None,
                held_revision: Arc::new(AtomicI64::new(0)),
                port,
                token: token.to_string(),
                generation: 0,
                started_at: None,
                restart_attempt: 0,
                restart_due_at: None,
            });
        // Dropping the client stops its thread; its wake channel closes and ends the old pump.
        entry.client = None;
        entry.port = port;
        entry.token = token.to_string();
        entry.restart_due_at = None;
        entry.generation += 1;
        let generation = entry.generation;
        // The revision the store holds for this machine, so a restart resumes rather than asking
        // for a whole snapshot it already has.
        let held_revision = entry.held_revision.clone();
        held_revision.store(
            self.gx_store
                .core
                .presentation()
                .loaded(&MachineId::Remote(machine_id.to_string()))
                .map_or(0, |loaded| loaded.revision),
            Ordering::Release,
        );
        let (wake, mut wakes) = mpsc::unbounded::<()>();
        let client = GxClient::start(
            GxClientConfig {
                machine: MachineId::Remote(machine_id.to_string()),
                base_url: format!("http://127.0.0.1:{port}"),
                auth_token: token.to_string(),
                client_id: format!("ghostex-gpui-store:{machine_id}"),
                held_revision,
                forward_chat_frames: false,
            },
            move || {
                let _ = wake.unbounded_send(());
            },
        );
        match client {
            Ok(client) => {
                let entry = self
                    .gx_store
                    .remote
                    .clients
                    .get_mut(machine_id)
                    .expect("inserted above");
                entry.client = Some(client);
                entry.started_at = Some(Instant::now());
                self.gx_store.remote.counters.starts += 1;
            }
            Err(error) => {
                self.gx_store.diagnostics.client_start_failed(&error);
                let delay = self.gx_store.remote.next_restart_delay(machine_id);
                self.schedule_gx_store_remote_restart(
                    machine_id.to_string(),
                    generation,
                    delay,
                    cx,
                );
                return;
            }
        }
        let owner = machine_id.to_string();
        cx.spawn(async move |this, cx| {
            while wakes.next().await.is_some() {
                let alive = this.update(cx, |this, cx| {
                    if this.gx_store_pump_remote(&owner, cx) {
                        this.gx_store_remote_thread_ended(&owner, generation, cx);
                    }
                });
                if alive.is_err() {
                    return;
                }
            }
            // The wake closure lives on the client thread and is dropped with it, so the stream
            // ending is the signal that the thread is gone. Unlike the channel check in the pump
            // it cannot be missed: it arrives even when the thread died without a last output.
            let _ = this.update(cx, |this, cx| {
                this.gx_store_remote_thread_ended(&owner, generation, cx);
            });
        })
        .detach();
    }

    /// Applies what one remote client delivered and redraws what reads it.
    fn gx_store_pump_remote(&mut self, machine_id: &str, cx: &mut gpui::Context<Self>) -> bool {
        let thread_ended = self.gx_store.pump_remote(machine_id);
        self.gx_store_update_sidebar_list(cx);
        thread_ended
    }

    /// The thread of a remote client is gone. Nothing to do when that client was replaced or
    /// dropped on purpose; otherwise its last outputs are applied, its machine is marked stale, and
    /// a new client starts after a bounded backoff, as long as the machine is still connected.
    fn gx_store_remote_thread_ended(
        &mut self,
        machine_id: &str,
        generation: u64,
        cx: &mut gpui::Context<Self>,
    ) {
        let current = self
            .gx_store
            .remote
            .clients
            .get(machine_id)
            .filter(|remote| remote.generation == generation && remote.client.is_some());
        if current.is_none() {
            return;
        }
        self.gx_store_pump_remote(machine_id, cx);
        self.gx_store.remote.counters.thread_exits += 1;
        self.gx_store
            .retire_remote_client(machine_id, "the client thread ended");
        let delay = self.gx_store.remote.next_restart_delay(machine_id);
        self.gx_store
            .diagnostics
            .remote_client_thread_ended(machine_id, delay);
        self.schedule_gx_store_remote_restart(machine_id.to_string(), generation, delay, cx);
    }

    fn schedule_gx_store_remote_restart(
        &mut self,
        machine_id: String,
        generation: u64,
        delay: Duration,
        cx: &mut gpui::Context<Self>,
    ) {
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(delay).await;
            let _ = this.update(cx, |this, cx| {
                // A newer client, or a machine that is no longer connected, settles this itself.
                let stale = this
                    .gx_store
                    .remote
                    .clients
                    .get(&machine_id)
                    .is_none_or(|remote| {
                        remote.generation != generation || remote.client.is_some()
                    });
                if stale {
                    return;
                }
                this.gx_store_sync_remote_clients(true, cx);
            });
        })
        .detach();
    }
}

/// The remote machines the user has enabled in the sidebar, in settings order, with the name each
/// one carries. `settings.remoteMachines.filter(isRemoteMachineEnabledInSidebar)`: a machine with
/// `disabled` true stays saved and is kept out of the sidebar.
fn enabled_remote_machines() -> Vec<(String, String)> {
    crate::shared_settings::shared_sidebar_settings_snapshot()
        .object()
        .get("remoteMachines")
        .and_then(serde_json::Value::as_array)
        .map(|machines| {
            machines
                .iter()
                .filter(|machine| {
                    machine.get("disabled").and_then(serde_json::Value::as_bool) != Some(true)
                })
                .filter_map(|machine| {
                    let machine_id = machine
                        .get("id")
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .filter(|machine_id| !machine_id.is_empty())?;
                    let label = machine
                        .get("name")
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .filter(|name| !name.is_empty())
                        .unwrap_or(machine_id);
                    Some((machine_id.to_string(), label.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}
