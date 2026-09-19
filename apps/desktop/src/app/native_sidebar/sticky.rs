use super::{appearance::SidebarAppearance, model::NativeSidebarSnapshot};
use crate::GhostexGpuiApp;
use gpui::{AnyElement, Bounds, IntoElement, ParentElement, Pixels, Styled, deferred, div, px};

impl GhostexGpuiApp {
    pub(crate) fn record_native_project_bounds(
        &mut self,
        id: &str,
        bounds: Bounds<Pixels>,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.native_sidebar.group_bounds.get(id) != Some(&bounds) {
            self.native_sidebar
                .group_bounds
                .insert(id.to_owned(), bounds);
            cx.notify();
        }
    }

    pub(crate) fn render_native_sticky_project(
        &self,
        snapshot: &NativeSidebarSnapshot,
        appearance: &SidebarAppearance,
        cx: &mut gpui::Context<Self>,
    ) -> Option<AnyElement> {
        let viewport = self.native_sidebar.scroll.bounds();
        let height = px(30.0 * appearance.scale);
        let visible: std::collections::HashSet<&str> = snapshot
            .order
            .iter()
            .flat_map(|item| {
                if item.kind == "project" {
                    vec![item.id.as_str()]
                } else {
                    snapshot
                        .collections
                        .iter()
                        .find(|collection| {
                            collection.collection_id == item.id && !collection.collapsed
                        })
                        .map(|collection| collection.group_ids.iter().map(String::as_str).collect())
                        .unwrap_or_default()
                }
            })
            .collect();
        let (group, bounds) = snapshot
            .groups
            .iter()
            .filter(|group| !group.collapsed && visible.contains(group.group_id.as_str()))
            .filter_map(|group| {
                self.native_sidebar
                    .group_bounds
                    .get(&group.group_id)
                    .map(|bounds| (group, *bounds))
            })
            .filter(|(_, bounds)| bounds.top() < viewport.top() && bounds.bottom() > viewport.top())
            .max_by_key(|(_, bounds)| bounds.top())?;
        let y = viewport
            .top()
            .min(bounds.bottom() - height)
            .max(viewport.top() - height);
        let root = self.native_sidebar.bounds;
        // CDXC:Projects 2026-09-19 WHY:
        // The recorded bounds are the header row's, which already sit inside its 3px side margins, and the chevron hangs 18px left of the row. The pinned box adds both back (margins outside, chevron gutter as left padding) so the clipped copy keeps the resting width and its chevron.
        let margin = px(3.0 * appearance.scale);
        let gutter = px(18.0 * appearance.scale);
        Some(
            deferred(
                div()
                    .absolute()
                    .left(bounds.left() - margin - gutter - root.left())
                    .top(y - root.top())
                    .w(bounds.size.width + margin * 2.0 + gutter)
                    .pl(gutter)
                    .h(height)
                    .overflow_hidden()
                    .bg(crate::app::helpers::titlebar_background())
                    .child(self.render_native_project_header(group, &snapshot.hud, appearance, cx)),
            )
            .with_priority(5)
            .into_any_element(),
        )
    }
}
