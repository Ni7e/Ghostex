use std::sync::Arc;

use gpui::{AnyElement, Bounds, IntoElement, Styled, canvas, point, px, size};

use super::{
    appearance::SidebarAppearance,
    model::{NativeSidebarGroup, NativeSidebarSession},
};
use crate::GhostexGpuiApp;

pub(super) const SESSION_HEIGHT: f32 = 34.0;
pub(super) const SESSION_SPACING: f32 = 1.0;

impl GhostexGpuiApp {
    /// CDXC:Sidebar 2026-09-17 WHY:
    /// Spinner frames rebuilt and laid out every expanded session, including offscreen rows, starving scroll input.
    /// Keep the full list height in the existing scroll container but construct rows only inside its paint mask.
    /// Resolve reveal requests from logical row bounds so offscreen sessions remain reachable.
    pub(super) fn render_native_session_list(
        &self,
        group: &NativeSidebarGroup,
        sessions: Vec<Arc<NativeSidebarSession>>,
        appearance: &SidebarAppearance,
        cx: &mut gpui::Context<Self>,
    ) -> AnyElement {
        let snapshot = self.native_sidebar.snapshot.clone();
        let group_id = group.group_id.clone();
        let appearance = appearance.clone();
        let scale = appearance.scale;
        let row_height = px((SESSION_HEIGHT + SESSION_SPACING) * scale);
        let height = row_height * sessions.len();
        let view = cx.entity();
        canvas(
            move |bounds, window, cx| {
                let Some(snapshot) = snapshot else {
                    return Vec::new();
                };
                let Some(group) = snapshot
                    .groups
                    .iter()
                    .find(|group| group.group_id == group_id)
                else {
                    return Vec::new();
                };
                let mask = window.content_mask().bounds.intersect(&bounds);
                let mut rows = view.update(cx, |app, cx| {
                    if let Some(request) = &app.native_sidebar.pending_reveal
                        && let Some(index) = sessions
                            .iter()
                            .position(|session| session.session_id == request.session_id)
                    {
                        let id = request.session_id.clone();
                        app.reveal_native_session_bounds(
                            &id,
                            Bounds::new(
                                bounds.origin + point(px(0.0), row_height * index),
                                size(bounds.size.width, px(SESSION_HEIGHT * scale)),
                            ),
                            scale,
                            window,
                            cx,
                        );
                    }
                    if mask.size.width <= px(0.0) || mask.size.height <= px(0.0) {
                        return Vec::new();
                    }
                    let first = (f32::from(mask.top() - bounds.top()) / f32::from(row_height))
                        .floor() as usize;
                    let end = ((f32::from(mask.bottom() - bounds.top()) / f32::from(row_height))
                        .ceil() as usize)
                        .min(sessions.len());
                    (first..end)
                        .map(|index| {
                            (
                                index,
                                app.render_native_sidebar_session(
                                    group,
                                    &sessions[index],
                                    &snapshot.hud,
                                    &appearance,
                                    cx,
                                ),
                            )
                        })
                        .collect::<Vec<_>>()
                });
                for (index, row) in &mut rows {
                    row.layout_as_root(size(bounds.size.width, row_height).into(), window, cx);
                    row.prepaint_at(
                        bounds.origin + point(px(0.0), row_height * *index),
                        window,
                        cx,
                    );
                }
                rows
            },
            |_, rows, window, cx| {
                for (_, mut row) in rows {
                    row.paint(window, cx);
                }
            },
        )
        .w_full()
        .h(height)
        .flex_shrink_0()
        .into_any_element()
    }
}
