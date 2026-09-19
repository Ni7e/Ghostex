use std::sync::Arc;

use gpui::{
    App, Bounds, DispatchPhase, Entity, Hitbox, HitboxBehavior, MouseMoveEvent, Pixels, Window,
};

use super::model::NativeSidebarSession;
use crate::GhostexGpuiApp;

/// The hovered row one session list asks for: take the row under the pointer, or let go of one of its own rows.
enum SessionHoverChange {
    Claim(String),
    Release(String),
}

/// CDXC:Sidebar 2026-09-19 DECISION:
/// The user asked to click a session card's X and, when the next card slides up under the cursor, click again to close it without moving the mouse to bring up that card's hover buttons.
/// Row `on_hover` only fires on mouse moves, so a card that moved under a still pointer (close, reorder, scroll) never learned it was hovered.
/// Each visible row gets a non-interactive hit-test probe, and the list resolves the hovered card from the frame's hit test after every paint and on every mouse move.
pub(super) struct SessionHoverProbes {
    probes: Vec<(String, Hitbox)>,
    sessions: Vec<Arc<NativeSidebarSession>>,
}

impl SessionHoverProbes {
    /// Inserted during prepaint, before the rows' own hitboxes, so the probes sit beneath the rows and block nothing.
    pub(super) fn insert(
        sessions: Vec<Arc<NativeSidebarSession>>,
        rows: impl Iterator<Item = (usize, Bounds<Pixels>)>,
        window: &mut Window,
    ) -> Self {
        let probes = rows
            .map(|(index, bounds)| {
                (
                    sessions[index].session_id.clone(),
                    window.insert_hitbox(bounds, HitboxBehavior::Normal),
                )
            })
            .collect();
        Self { probes, sessions }
    }

    /// Called during paint, once this frame's hit test is known.
    pub(super) fn track(self, view: Entity<GhostexGpuiApp>, window: &mut Window, cx: &mut App) {
        if let Some(change) = self.change(view.read(cx), window, cx) {
            let view = view.clone();
            window.defer(cx, move |_, cx| {
                view.update(cx, |app, cx| app.apply_native_session_hover(change, cx))
            });
        }
        window.on_mouse_event(move |_: &MouseMoveEvent, phase, window, cx| {
            if phase != DispatchPhase::Bubble {
                return;
            }
            if let Some(change) = self.change(view.read(cx), window, cx) {
                view.update(cx, |app, cx| app.apply_native_session_hover(change, cx));
            }
        });
    }

    fn change(
        &self,
        app: &GhostexGpuiApp,
        window: &Window,
        cx: &App,
    ) -> Option<SessionHoverChange> {
        // Keyboard input suppresses hit-test hover; keep whatever the pointer last showed.
        if window.last_input_was_keyboard() {
            return None;
        }
        let current = app.native_sidebar.hovered_session.as_deref();
        let under_pointer = if app.native_sidebar.pointer_inside && !cx.has_active_drag() {
            self.probes
                .iter()
                .find(|(_, hitbox)| hitbox.is_hovered(window))
                .map(|(id, _)| id.as_str())
        } else {
            None
        };
        match under_pointer {
            Some(id) => (current != Some(id)).then(|| SessionHoverChange::Claim(id.to_owned())),
            None => current
                .filter(|id| {
                    self.sessions
                        .iter()
                        .any(|session| session.session_id == *id)
                })
                .map(|id| SessionHoverChange::Release(id.to_owned())),
        }
    }
}

impl GhostexGpuiApp {
    fn apply_native_session_hover(
        &mut self,
        change: SessionHoverChange,
        cx: &mut gpui::Context<Self>,
    ) {
        let hovered = &mut self.native_sidebar.hovered_session;
        match change {
            SessionHoverChange::Claim(id) if hovered.as_deref() != Some(&id) => *hovered = Some(id),
            SessionHoverChange::Release(id) if hovered.as_deref() == Some(&id) => *hovered = None,
            _ => return,
        }
        cx.notify();
    }
}
