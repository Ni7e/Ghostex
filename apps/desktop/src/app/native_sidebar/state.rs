use gpui::ScrollHandle;
use std::sync::Arc;

use super::model::{NativeSidebarSnapshot, NativeSidebarUpdate};
use crate::GhostexGpuiApp;
use crate::app::project_views::PROJECT_VIEW_SCOPE_OPTION_HUD_KEYS;

#[derive(Default)]
pub(crate) struct NativeSidebarState {
    pub(crate) disclosures: super::disclosure::SidebarDisclosures,
    pub(crate) group_bounds: std::collections::HashMap<String, gpui::Bounds<gpui::Pixels>>,
    pub(crate) space_gesture: super::space_gesture::SpaceGesture,
    pub(crate) completion_flashes: std::collections::HashMap<String, std::time::Instant>,
    pub(crate) bounds: gpui::Bounds<gpui::Pixels>,
    pub(crate) menu: Option<super::menu_state::SidebarMenuState>,
    pub(crate) next_menu_request: u64,
    #[cfg(target_os = "macos")]
    pub(crate) reveal: Option<super::reveal::NativeSidebarReveal>,
    /// CDXC:Sidebar 2026-09-17 WHY:
    /// A frame profile found snapshot and session deep copies dominating the UI thread during redraws.
    /// Share immutable snapshots with row callbacks; incoming patches and clock updates use copy-on-write mutation.
    pub(crate) snapshot: Option<Arc<NativeSidebarSnapshot>>,
    /// The newest list the TypeScript projection published. The same value as `snapshot` while the
    /// renderer draws that projection; the source of the menus, the HUD and the machine tabs while
    /// it draws the store's list instead (gx_store/sidebar_snapshot.rs).
    pub(crate) projection: Option<Arc<NativeSidebarSnapshot>>,
    pub(crate) scroll: ScrollHandle,
    pub(crate) scroll_offsets: std::collections::HashMap<String, gpui::Point<gpui::Pixels>>,
    pub(crate) pending_scroll_offset: Option<gpui::Point<gpui::Pixels>>,
    pub(crate) pending_reveal: Option<super::model::NativeSidebarRevealRequest>,
    pub(crate) handled_rename: Option<u64>,
    pub(crate) handled_reveal: Option<u64>,
    pub(crate) scroll_animation: Option<super::scroll::SidebarScrollAnimation>,
    pub(crate) reveal_flash: Option<(String, std::time::Instant)>,
    pub(crate) dragging: Option<(&'static str, String)>,
    pub(crate) drop_command: Option<serde_json::Value>,
    pub(crate) name_editor: Option<super::rename::SidebarNameEditor>,
    pub(crate) pointer_inside: bool,
    pub(crate) hovered_collection: Option<String>,
    pub(crate) hovered_section: Option<String>,
    pub(crate) hovered_group: Option<String>,
    /// This frame's project header probes; `hovered_group` follows them.
    pub(crate) header_hover: super::project_hover::ProjectHeaderHoverProbes,
    pub(crate) hovered_session: Option<String>,
    /// Armed Delayed Send / Close After Done labels by sidebar session id, for every session rather than only the rows the snapshot shows (session_chat_armed_actions.rs).
    pub(crate) armed_actions: std::collections::HashMap<String, serde_json::Value>,
}

impl NativeSidebarState {
    pub(crate) fn is_dragging(&self, kind: &str, id: &str) -> bool {
        self.dragging
            .as_ref()
            .is_some_and(|(drag_kind, drag_id)| *drag_kind == kind && drag_id == id)
    }
}

impl GhostexGpuiApp {
    pub(crate) fn receive_native_sidebar_snapshot(
        &mut self,
        payload: &str,
        cx: &mut gpui::Context<Self>,
    ) {
        let update = match serde_json::from_str::<NativeSidebarUpdate>(payload) {
            Ok(update) => update,
            Err(error) => {
                crate::support_logs::append_repro(
                    crate::support_logs::GpuiSupportLog::SidebarRefresh,
                    "gpui.sidebar.native.invalidSnapshot",
                    serde_json::json!({"error": error.to_string()}),
                );
                return;
            }
        };
        let update = match update {
            NativeSidebarUpdate::Patch(patch) if patch.version == 1 => {
                let Some(previous) = self.native_sidebar.projection.as_ref() else {
                    return;
                };
                match patch.apply(previous) {
                    Ok(snapshot) => NativeSidebarUpdate::Snapshot(snapshot),
                    Err(error) => {
                        crate::support_logs::append(
                            crate::support_logs::GpuiSupportLog::SidebarRefresh,
                            "gpui.sidebar.native.invalidPatch",
                            serde_json::json!({"error": error.to_string()}),
                        );
                        return;
                    }
                }
            }
            update => update,
        };
        match update {
            NativeSidebarUpdate::Snapshot(snapshot) if snapshot.version == 1 => {
                self.native_sidebar.projection = Some(Arc::new(snapshot));
                // A reveal is a command the sidebar's own state answers, and the request reaches
                // this app on the publish that carries it (gx_store/sidebar_ui_commands.rs).
                if let Some(request) = self
                    .native_sidebar
                    .projection
                    .as_ref()
                    .and_then(|snapshot| snapshot.reveal_request.clone())
                {
                    self.gx_store_note_sidebar_reveal(&request.session_id, request.request_id, cx);
                }
                // The values the store's list still borrows moved with this publish, and the
                // comparison reads it; both run whichever list is drawn.
                self.gx_store_sidebar_projection_published(cx);
                if self.gx_store_sidebar_list_source()
                    == crate::app::gx_store::SidebarListSource::Projection
                {
                    let published = self
                        .native_sidebar
                        .projection
                        .clone()
                        .expect("assigned above");
                    self.install_native_sidebar_snapshot(published, cx);
                }
            }
            NativeSidebarUpdate::Flash {
                version: 1,
                session_id,
            } => {
                self.native_sidebar
                    .completion_flashes
                    .retain(|_, started| started.elapsed().as_secs_f32() < 3.0);
                self.native_sidebar
                    .completion_flashes
                    .insert(session_id, std::time::Instant::now());
            }
            NativeSidebarUpdate::Menu {
                version: 1,
                owner_id,
                items,
                close,
            } => {
                let Some(menu) = self.native_sidebar.menu.as_mut() else {
                    return;
                };
                let Some((owner, index)) = &menu.account_panel else {
                    return;
                };
                if *owner != owner_id {
                    return;
                }
                if close {
                    self.dismiss_native_sidebar_menu(cx);
                } else if let Some(panel) = menu.panels.get_mut(*index) {
                    panel.replace_items(items);
                }
            }
            NativeSidebarUpdate::Clock { version: 1, rows } => {
                for row in &rows {
                    match &row.armed_actions {
                        Some(actions) => self
                            .native_sidebar
                            .armed_actions
                            .insert(row.session_id.clone(), actions.clone()),
                        None => self.native_sidebar.armed_actions.remove(&row.session_id),
                    };
                }
                self.sync_session_chat_armed_actions(cx);
                // The clock rows carry the labels the old projection formats. The store's list
                // formats its own against the host clock and books its own wake, so they are
                // applied to the projection and reach the screen only while it is what is drawn.
                let drawn_is_projection = self.gx_store_sidebar_list_source()
                    == crate::app::gx_store::SidebarListSource::Projection;
                let Some(snapshot) = self.native_sidebar.projection.as_mut() else {
                    return;
                };
                let snapshot = Arc::make_mut(snapshot);
                let rows: std::collections::HashMap<_, _> = rows
                    .into_iter()
                    .map(|row| (row.session_id.clone(), row))
                    .collect();
                for session in snapshot
                    .groups
                    .iter_mut()
                    .flat_map(|group| group.sessions.iter_mut())
                {
                    if let Some(row) = rows.get(&session.session_id) {
                        let session = Arc::make_mut(session);
                        session.details.insert(
                            "timerLabel".into(),
                            row.timer_label
                                .clone()
                                .map(serde_json::Value::String)
                                .unwrap_or_default(),
                        );
                        session.details.insert(
                            "lastInteractionLabel".into(),
                            row.last_interaction_label
                                .clone()
                                .map(serde_json::Value::String)
                                .unwrap_or_default(),
                        );
                    }
                }
                if drawn_is_projection {
                    self.native_sidebar.snapshot = self.native_sidebar.projection.clone();
                }
            }
            _ => return,
        }
        cx.notify();
    }

    /// Installs the list the renderer draws, whichever side built it: the scroll scope it belongs
    /// to, the reveal it carries, the disclosure animations, the open menu, the project view scope
    /// options, and the browser focus the row highlight reads.
    pub(crate) fn install_native_sidebar_snapshot(
        &mut self,
        snapshot: Arc<NativeSidebarSnapshot>,
        cx: &mut gpui::Context<Self>,
    ) {
        if let Some(previous) = &self.native_sidebar.snapshot
            && previous.scroll_scope != snapshot.scroll_scope
        {
            self.native_sidebar.scroll_offsets.insert(
                previous.scroll_scope.clone(),
                self.native_sidebar.scroll.offset(),
            );
            self.native_sidebar.pending_scroll_offset = Some(
                self.native_sidebar
                    .scroll_offsets
                    .get(&snapshot.scroll_scope)
                    .copied()
                    .unwrap_or_default(),
            );
            self.native_sidebar.scroll_animation = None;
            self.native_sidebar.group_bounds.clear();
        }
        if let Some(request) = &snapshot.reveal_request
            && self.native_sidebar.handled_reveal != Some(request.request_id)
        {
            self.native_sidebar.pending_reveal = Some(request.clone());
            self.native_sidebar.handled_reveal = Some(request.request_id);
        }
        self.native_sidebar
            .disclosures
            .sync(&snapshot, self.gpui_pet_overlay_reduce_motion_enabled);
        if let Some(menu) = self.native_sidebar.menu.as_mut() {
            menu.refresh(&snapshot);
        }
        if let Some(handle) = self.app_modal_window {
            let previous = self.native_sidebar.snapshot.as_ref().map(|s| &s.hud);
            let changed = PROJECT_VIEW_SCOPE_OPTION_HUD_KEYS
                .iter()
                .filter_map(|key| {
                    let value = snapshot.hud.get(*key)?;
                    (previous.and_then(|hud| hud.get(*key)) != Some(value))
                        .then(|| (*key, value.clone()))
                })
                .collect::<Vec<_>>();
            if !changed.is_empty() {
                let _ = handle.update(cx, |host, _, cx| {
                    host.refresh_project_view_scope_options(&changed, cx);
                });
            }
        }
        // The old runtime draws no session row focused while a browser tab of the active group owns focus; rows read that per frame, so it is derived here, once per snapshot (gx_store/local_focus.rs).
        let browser_focus = snapshot.groups.iter().any(|group| {
            group.is_active
                && group
                    .sessions
                    .iter()
                    .any(|session| session.is_focused && session.is_browser())
        });
        self.gx_store_note_sidebar_snapshot_browser_focus(browser_focus);
        self.native_sidebar.snapshot = Some(snapshot);
        cx.notify();
    }
}
