//! The value types the view panel's tab strip drags around: what is being dragged, where it would
//! land, and the little tab that follows the pointer.

use crate::app::consts::*;
use crate::app::helpers::*;
use crate::*;

/// The payload GPUI carries while a view tab is being dragged along the strip.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct DraggedViewTab {
    pub(crate) mode: TitlebarMode,
}

/// The live drag: which tab left its place, and the index it would be dropped at.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct GpuiViewTabDrag {
    pub(crate) mode: TitlebarMode,
    pub(crate) insertion_index: usize,
}

/// The tab that follows the pointer during a reorder. It is a plain label, not the live tab, because
/// the live tab keeps rendering in the strip while it is dragged.
pub(crate) struct ViewTabDragPreview {
    pub(crate) icon: &'static str,
    pub(crate) label: String,
}

impl Render for ViewTabDragPreview {
    fn render(&mut self, _window: &mut Window, _cx: &mut gpui::Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .h(px(WORKAREA_VIEW_TAB_HEIGHT))
            .max_w(px(WORKAREA_VIEW_TAB_MAX_WIDTH))
            .items_center()
            .gap(px(6.0))
            .overflow_hidden()
            .rounded(px(WORKAREA_VIEW_TAB_RADIUS))
            .border_1()
            .border_color(workspace_drop_feedback_border_color())
            .bg(workspace_tab_drag_preview_color())
            .px(px(WORKAREA_VIEW_TAB_HORIZONTAL_PADDING))
            .text_size(px(12.5))
            .text_color(titlebar_active_text_color())
            .shadow_md()
            .child(titlebar_svg_icon(
                self.icon,
                WORKAREA_VIEW_TAB_ICON_SIZE,
                titlebar_icon_color(),
            ))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .overflow_hidden()
                    .whitespace_nowrap()
                    .text_ellipsis()
                    .child(self.label.clone()),
            )
    }
}
