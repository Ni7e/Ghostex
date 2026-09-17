use gpui::ScrollHandle;
use std::sync::Arc;

use super::model::{NativeSidebarSnapshot, NativeSidebarUpdate};
use crate::GhostexGpuiApp;

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
    pub(crate) hovered_session: Option<String>,
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
                let Some(previous) = self.native_sidebar.snapshot.as_ref() else {
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
                self.native_sidebar.snapshot = Some(Arc::new(snapshot));
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
                    panel.items = items;
                    panel.selected = None;
                }
            }
            NativeSidebarUpdate::Clock { version: 1, rows } => {
                let Some(snapshot) = self.native_sidebar.snapshot.as_mut() else {
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
            }
            _ => return,
        }
        cx.notify();
    }
}
