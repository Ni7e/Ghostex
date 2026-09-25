//! Owns the core and the sidebar view model, and turns the daemon's frames into the list the shared renderer draws. The desktop's `host.rs` + `sidebar_list.rs` do the same with a native client thread, SQLite-backed sidebar state and the QuickJS runtime's facts channel; none of those exist here, so the inputs this host cannot read yet stay at their defaults.
use std::sync::Arc;

use futures::StreamExt as _;
use futures::channel::mpsc;
use ghostex_gx_core::protocol::ClientMessage;
use ghostex_gx_core::{
    ChangeSummary, ConnectionUpdate, Core, Event, MachineId, MenuHost, SessionKey, SidebarInputs,
    SidebarMenus, SidebarUiStore, SidebarViewModel,
};
use serde_json::{Value, json};

use super::sidebar_snapshot::{SnapshotCache, SnapshotInput, snapshot_from_view};
use super::web_transport::{self, GxserverEndpoint, StreamEvent};
use crate::GhostexGpuiApp;

#[derive(Default)]
pub(crate) struct GxStoreHost {
    pub(crate) core: Core,
    pub(crate) endpoint: Option<GxserverEndpoint>,
    /// What the page shows while there is no list: the connection's last failure.
    pub(crate) status: Option<String>,
    /// The sidebar's own state (collapse, Space, filters, multi-selection); `web_commands.rs` moves it.
    pub(super) sidebar_ui: SidebarUiStore,
    pub(super) model: SidebarViewModel,
    pub(super) inputs: SidebarInputs,
    pub(super) menu_host: MenuHost,
    snapshot_cache: SnapshotCache,
    hud: Arc<Value>,
    socket: Option<web_sys::WebSocket>,
}

pub(crate) fn now_ms() -> u64 {
    js_sys::Date::now() as u64
}

impl GhostexGpuiApp {
    /// Bootstraps, connects and pumps until the page goes away, reconnecting on a close.
    pub(crate) fn gx_store_start(&mut self, cx: &mut gpui::Context<Self>) {
        self.gx_store.hud = Arc::new(json!({}));
        self.gx_store_restore_sidebar_ui();
        self.gx_store.menu_host.machine_connected = true;
        cx.spawn(async move |app, cx| {
            let endpoint = match web_transport::bootstrap().await {
                Ok(endpoint) => endpoint,
                Err(error) => {
                    let _ = app.update(cx, |app, cx| {
                        app.gx_store.status = Some(format!("Could not reach Ghostex: {error}"));
                        cx.notify();
                    });
                    return;
                }
            };
            // The chat host's socket connects to the same daemon (`app/gx_chat/`).
            crate::app::gx_chat::set_endpoint(
                crate::app::gx_chat::LOCAL_MACHINE_ID,
                &endpoint.base_url,
                &endpoint.auth_token,
            );
            let _ = app.update(cx, |app, _| app.gx_store.endpoint = Some(endpoint.clone()));
            let mut attempt = 0u32;
            loop {
                let (sender, mut receiver) = mpsc::unbounded();
                let _ = app.update(cx, |app, cx| {
                    app.gx_store_handle(
                        Event::Connection {
                            machine: MachineId::Local,
                            update: ConnectionUpdate::Connecting { attempt },
                        },
                        cx,
                    );
                    match web_transport::open_events(&endpoint, sender) {
                        Ok(socket) => app.gx_store.socket = Some(socket),
                        Err(error) => app.gx_store.status = Some(error),
                    }
                });
                while let Some(event) = receiver.next().await {
                    let closed = matches!(event, StreamEvent::Closed);
                    if app
                        .update(cx, |app, cx| app.gx_store_stream_event(event, cx))
                        .is_err()
                    {
                        return;
                    }
                    if closed {
                        break;
                    }
                }
                attempt += 1;
                cx.background_executor()
                    .timer(std::time::Duration::from_secs(u64::from(attempt.min(5))))
                    .await;
            }
        })
        .detach();
    }

    fn gx_store_stream_event(&mut self, event: StreamEvent, cx: &mut gpui::Context<Self>) {
        match event {
            StreamEvent::Open => self.gx_store_subscribe(true),
            StreamEvent::Frame(text) => {
                // One per HTTP request any client makes, and nothing reads it.
                if text.contains("\"type\":\"apiRequestHandled\"") || text.contains("\"sessionChat") {
                    return;
                }
                match self.gx_store.core.handle_raw_frame(MachineId::Local, &text, now_ms()) {
                    Ok(output) => self.gx_store_after(output, cx),
                    Err(error) => log::warn!("frame did not parse: {error:?}"),
                }
            }
            StreamEvent::Closed => {
                self.gx_store.socket = None;
                self.gx_store_handle(
                    Event::Connection {
                        machine: MachineId::Local,
                        update: ConnectionUpdate::Lost { error: None },
                    },
                    cx,
                );
            }
        }
    }

    fn gx_store_subscribe(&mut self, full_snapshot: bool) {
        let held = self
            .gx_store
            .core
            .presentation()
            .machine(&MachineId::Local)
            .and_then(|machine| machine.loaded())
            .map(|loaded| loaded.revision);
        let message = ClientMessage::SubscribePresentation {
            client_id: Some("ghostex-gpui-web".to_string()),
            last_revision: if full_snapshot { None } else { held },
            renderer_commands: None,
        };
        if let (Some(socket), Ok(text)) = (&self.gx_store.socket, serde_json::to_string(&message)) {
            let _ = socket.send_with_str(&text);
        }
    }

    pub(crate) fn gx_store_handle(&mut self, event: Event, cx: &mut gpui::Context<Self>) {
        let output = self.gx_store.core.handle(event, now_ms());
        self.gx_store_after(output, cx);
    }

    fn gx_store_after(&mut self, output: ghostex_gx_core::Output, cx: &mut gpui::Context<Self>) {
        for effect in &output.effects {
            if matches!(effect, ghostex_gx_core::Effect::ResubscribePresentation { .. }) {
                self.gx_store_subscribe(true);
            }
        }
        self.gx_store_update_sidebar_list(&output.changes, cx);
    }

    pub(crate) fn gx_store_update_sidebar_list(
        &mut self,
        changes: &ChangeSummary,
        cx: &mut gpui::Context<Self>,
    ) {
        let now_ms = now_ms();
        let store = &mut self.gx_store;
        store.inputs.ui = store.sidebar_ui.state().clone();
        store.model.update(&store.core, &store.inputs, changes, now_ms);
        let snapshot = {
            let menus =
                SidebarMenus::new(&store.core, store.model.view(), &store.inputs, &store.menu_host, now_ms);
            snapshot_from_view(
                store.model.view(),
                &SnapshotInput {
                    menus: &menus,
                    hud: &store.hud,
                    rename_request: None,
                    reveal_request: None,
                    search_shortcut: None,
                    commands_shortcut: None,
                    settings: &store.inputs.settings,
                    hidden_items: &store.inputs.ui.hidden_items,
                    host: &store.menu_host,
                    collapsed_groups: &store.inputs.ui.collapse.collapsed_groups,
                    show_hidden: store.inputs.ui.show_hidden,
                    selected_tag_filters: &store.inputs.ui.selected_tag_filters,
                    now_ms,
                },
                &mut store.snapshot_cache,
            )
        };
        self.install_native_sidebar_snapshot(Arc::new(snapshot), cx);
        self.web_open_linked_session(cx);
        cx.notify();
    }
}

impl GxStoreHost {
    pub(crate) fn sidebar_view(&self) -> &ghostex_gx_core::SidebarView {
        self.model.view()
    }

    /// The store key of a drawn row; `None` for a browser tab or a row the list no longer holds.
    pub(crate) fn session_key_for_row(&self, sidebar_session_id: &str) -> Option<SessionKey> {
        self.model
            .view()
            .groups
            .iter()
            .flat_map(|group| group.core.sessions.iter())
            .find(|session| session.row.sidebar_session_id == sidebar_session_id)
            .and_then(|session| session.row.key.clone())
    }
}
