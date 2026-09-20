//! The header row itself: its frame, its window-control duties, its drag behaviour, and the float
//! that replaces the hairline the old titlebar drew under itself.

use gpui::InteractiveElement as _;
use gpui::IntoElement;
use gpui::MouseButton;
use gpui::MouseDownEvent;
use gpui::ParentElement as _;
use gpui::StatefulInteractiveElement as _;
use gpui::Styled as _;
use gpui::Window;
use gpui::WindowControlArea;
use gpui::div;
use gpui::prelude::FluentBuilder as _;
use gpui::px;
use gpui_component::ElementExt as _;
use gpui_component::h_flex;

use super::anchor::record_workarea_header_bottom_y;
use crate::app::consts::*;
use crate::app::helpers::*;
use crate::app::model::*;
use crate::*;

/*
CDXC:Titlebar 2026-08-23:
GPUI paints the whole header itself, so AppKit's own titlebar view never sees a double click there
and the standard macOS zoom gesture silently did nothing. Forward it to the platform window, which
honours the user's NSGlobalDomain AppleActionOnDoubleClick preference (Maximize/Fill/Minimize/
Do Nothing). Linux compositors leave the same gesture to the client, so zoom directly there;
Windows already resolves it from the WindowControlArea::Drag hit test in the platform layer.
*/
#[cfg(target_os = "macos")]
fn gpui_header_double_click_window_action(window: &Window) {
    window.titlebar_double_click();
}

#[cfg(target_os = "linux")]
fn gpui_header_double_click_window_action(window: &Window) {
    window.zoom_window();
}

#[cfg(target_os = "windows")]
fn gpui_header_double_click_window_action(_window: &Window) {}

#[cfg(target_os = "linux")]
struct GpuiLinuxHeaderDragState {
    should_move: bool,
}

impl GhostexGpuiApp {
    /// True while the workspace column is too narrow for the header's labels, which is what the
    /// mockup's narrow chat column drops first.
    pub(crate) fn workarea_header_compact(&self, window: &Window) -> bool {
        command_pane_workspace_width(window, self.sidebar_width, self.sidebar_collapsed)
            < WORKAREA_HEADER_COMPACT_WIDTH
    }

    pub(crate) fn render_workarea_header(
        &self,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        /*
        CDXC:Titlebar 2026-07-04-01:00:
        Quick/projectless GPUI contexts keep Agents and Source selectable, keep Browser, Kanban, Automate, and Docs visible but disabled, and use the same availability helper for tabs, the compact dropdown, hotkeys, restore, and persistence.

        CDXC:Titlebar 2026-09-20 DECISION:
        User: the header keeps only what belongs to the active project. The sidebar toggle stays a flat Tabler layout-sidebar glyph, the right controls are Git, Actions and Open In, and everything occasional (Ask Ghostex, Tips & Tricks, Resources, Dev servers, Extensions) is reached from one trailing menu button.
        This supersedes the 2026-06-22 rule that listed Tips and Resources as their own titlebar buttons; Settings, Keep Awake, the notification bell and the account usage meters live in sidebar chrome, not this strip.

        CDXC:Titlebar 2026-09-20 DECISION:
        User: the window has no titlebar row. This header, the first child of the workspace column,
        takes over its job: the project breadcrumb, Start/Open/Commit, the trailing ⋯ menu and the
        two panel toggles, with no line under it. The view tabs still sit here until the view panel
        owns them, so the header is deliberately busier than the mockup for two phases.
        This supersedes the 2026-06-14 rule that described a full-width titlebar strip.
        */
        let mode_switcher_items = self.titlebar_mode_switcher_items();
        let show_mode_switcher = !mode_switcher_items.is_empty();
        let extension_mode_width = mode_switcher_items
            .iter()
            .filter_map(|item| {
                let TitlebarMode::Extension(id) = item.mode else {
                    return None;
                };
                let label = gpui_extension_view_presentation(id)
                    .map(|presentation| presentation.title)
                    .unwrap_or_else(|| id.as_str().to_string());
                Some((label.chars().count() as f32 * 7.5 + 28.0).max(70.0))
            })
            .sum::<f32>();
        let use_compact_mode_dropdown = show_mode_switcher
            && window.bounds().size.width.as_f32()
                < TITLEBAR_COMPACT_MODE_WIDTH_THRESHOLD + extension_mode_width;
        let compact = self.workarea_header_compact(window);

        /*
        CDXC:Titlebar 2026-09-20 DECISION:
        User: "they just do nice fade from bottom mask thingy at the top". The header floats over
        the workspace column instead of sitting above it, so the transcript scrolls under it and
        fades out; it paints the workspace background, draws no bottom border, and there is no edge
        at all where it meets the content. This is the overlap the user approved, and it is scoped
        to the header over the content beneath it: the row is opaque and occludes the mouse, so the
        band it covers is the drag area it has always been, and the ramp below it
        (`render_workarea_header_content_fade`) carries no hitbox at all, so everything under the
        faded strip keeps every click, drag and scroll. Nothing here licenses another overlay.

        CDXC:Titlebar 2026-09-20 WHY:
        `occlude()` is what makes the float honest rather than a second input layer: without it the
        row's own hitbox would not stop a click on the empty drag area from also reaching the
        transcript painted underneath, and the same press would both drag the window and land in the
        chat. It blocks the mouse only where the header is actually drawn, and only while no drag is
        in flight (`workarea_header_blocks_mouse`).
        */
        let header_background = workspace_background_color();
        let header = div()
            .id("ghostex-gpui-workarea-header")
            .absolute()
            .top_0()
            .left_0()
            .right_0()
            .flex()
            .items_center()
            .flex_shrink_0()
            .h(px(WORKAREA_HEADER_HEIGHT))
            .bg(header_background)
            .when(self.workarea_header_blocks_mouse(), |header| {
                header.occlude()
            })
            .text_color(titlebar_text_color())
            .font_family("Inter Variable")
            .line_height(px(TITLEBAR_CONTROL_HEIGHT))
            .window_control_area(WindowControlArea::Drag)
            .on_prepaint(|bounds, _window, _cx| {
                record_workarea_header_bottom_y(bounds.bottom().as_f32());
            });

        /*
        X11 does not consume GPUI's WindowControlArea hit boxes, so a client-decorated Linux window
        must hand movement to the window manager from the real drag element. Wait for pointer
        movement so ordinary clicks and double-click maximize keep their existing behavior.
        */
        #[cfg(target_os = "linux")]
        let header = {
            let drag_state =
                window.use_state(cx, |_, _| GpuiLinuxHeaderDragState { should_move: false });
            header
                .on_mouse_down_out(
                    window.listener_for(&drag_state, |state, _, _, _| state.should_move = false),
                )
                .on_mouse_down(
                    MouseButton::Left,
                    window.listener_for(&drag_state, |state, _, window, _| {
                        state.should_move = matches!(
                            window.window_decorations(),
                            gpui::Decorations::Client { .. }
                        );
                    }),
                )
                .on_mouse_up(
                    MouseButton::Left,
                    window.listener_for(&drag_state, |state, _, _, _| {
                        state.should_move = false;
                    }),
                )
                .on_mouse_move(window.listener_for(&drag_state, |state, _, window, _| {
                    if state.should_move {
                        state.should_move = false;
                        window.start_window_move();
                    }
                }))
        };

        // CDXC:Titlebar 2026-09-20 DECISION:
        // User: full view buttons stay centered in the window, and the compact dropdown belongs on the left immediately after Next.
        // This restores the 2026-09-10 wording that the 2026-09-11 rule amended, because the Notifications bell it anchored to has moved to the sidebar; equal side regions still keep the full tabs centered.
        header
            .on_click(|event, window, _cx| {
                if event.click_count() != 2 {
                    return;
                }
                gpui_header_double_click_window_action(window);
            })
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                    this.show_gpui_titlebar_customize_menu(event.position, window, cx);
                }),
            )
            .child(
                h_flex()
                    .id("ghostex-gpui-workarea-header-left")
                    .h_full()
                    .flex_1()
                    .min_w_0()
                    .overflow_hidden()
                    .child(self.render_workarea_header_breadcrumb(
                        use_compact_mode_dropdown,
                        compact,
                        cx,
                    )),
            )
            .child(
                h_flex()
                    .h_full()
                    .flex_shrink_0()
                    .items_center()
                    .justify_center()
                    .when(show_mode_switcher && !use_compact_mode_dropdown, |this| {
                        this.child(self.render_mode_switcher(cx))
                    }),
            )
            .child(
                h_flex()
                    .id("ghostex-gpui-workarea-header-right")
                    .h_full()
                    .flex_1()
                    .min_w_0()
                    .justify_end()
                    .child(self.render_workarea_header_actions(compact, window, cx)),
            )
    }
}
