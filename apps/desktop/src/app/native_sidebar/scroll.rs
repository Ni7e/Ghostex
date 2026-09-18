use crate::{GhostexGpuiApp, app::helpers::*};
use gpui::{AnyElement, Bounds, IntoElement, Pixels, Point, Styled, Window, canvas, px};
use std::time::Instant;

pub(crate) struct SidebarScrollAnimation {
    from: Point<Pixels>,
    to: Point<Pixels>,
    started: Instant,
    session_id: String,
}

impl GhostexGpuiApp {
    pub(crate) fn update_native_sidebar_scroll(
        &mut self,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if cx.has_active_drag() {
            let bounds = self.native_sidebar.scroll.bounds();
            let pointer = window.mouse_position();
            if bounds.contains(&pointer) {
                let edge = px(30.0);
                let delta = if pointer.y < bounds.top() + edge {
                    px(6.0)
                } else if pointer.y > bounds.bottom() - edge {
                    px(-6.0)
                } else {
                    px(0.0)
                };
                if delta != px(0.0) {
                    let current = self.native_sidebar.scroll.offset();
                    self.native_sidebar
                        .scroll
                        .set_offset(Point::new(current.x, (current.y + delta).min(px(0.0))));
                    window.request_animation_frame();
                    cx.notify();
                }
            }
        }
        if let Some(offset) = self.native_sidebar.pending_scroll_offset.take() {
            self.native_sidebar.scroll.set_offset(offset);
            cx.notify();
            return;
        }
        if let Some(animation) = &self.native_sidebar.scroll_animation {
            let t = (animation.started.elapsed().as_secs_f32() / 0.22).min(1.0);
            let eased = 1.0 - (1.0 - t).powi(3);
            self.native_sidebar
                .scroll
                .set_offset(animation.from + (animation.to - animation.from) * eased);
            if t >= 1.0 {
                self.native_sidebar.reveal_flash =
                    Some((animation.session_id.clone(), Instant::now()));
                self.native_sidebar.scroll_animation = None;
            }
            window.request_animation_frame();
            cx.notify();
        }
    }

    pub(crate) fn reveal_native_session_bounds(
        &mut self,
        session_id: &str,
        bounds: Bounds<Pixels>,
        scale: f32,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.native_sidebar.pending_scroll_offset.is_some()
            || !self
                .native_sidebar
                .pending_reveal
                .as_ref()
                .is_some_and(|request| request.session_id == session_id)
        {
            return;
        }
        self.native_sidebar.pending_reveal = None;
        let viewport = self.native_sidebar.scroll.bounds();
        let pinned_height = px(30.0 * scale);
        let padding = px(50.0 * scale)
            .min(((viewport.size.height - pinned_height - bounds.size.height) / 2.0).max(px(0.0)));
        let top = viewport.top() + pinned_height + padding;
        let bottom = viewport.bottom() - padding;
        let delta = if bounds.top() < top {
            bounds.top() - top
        } else if bounds.bottom() > bottom {
            bounds.bottom() - bottom
        } else {
            px(0.0)
        };
        if delta.abs() < px(1.0) {
            self.native_sidebar.reveal_flash = Some((session_id.to_owned(), Instant::now()));
        } else {
            let from = self.native_sidebar.scroll.offset();
            self.native_sidebar.scroll_animation = Some(SidebarScrollAnimation {
                from,
                to: Point::new(from.x, (from.y - delta).min(px(0.0))),
                started: Instant::now(),
                session_id: session_id.to_owned(),
            });
        }
        window.request_animation_frame();
        cx.notify();
    }
}

pub(crate) fn reveal_flash(start: Instant, scale: f32) -> AnyElement {
    canvas(
        |_, _, _| {},
        move |bounds, _, window, _| {
            let elapsed = start.elapsed().as_secs_f32();
            if elapsed >= 1.1 {
                return;
            }
            let phase = (elapsed % 0.55) / 0.55;
            let opacity = if phase < 0.2 {
                phase / 0.2
            } else if phase <= 0.55 {
                1.0
            } else {
                (1.0 - phase) / 0.45
            };
            window.paint_quad(gpui::quad(
                bounds,
                px(5.0 * scale),
                gpui::rgba(0x00000000),
                px(2.0 * scale),
                chrome_color(0xffffff, 0x93c5fd).opacity(opacity),
                gpui::BorderStyle::Solid,
            ));
            window.request_animation_frame();
        },
    )
    .absolute()
    .inset_0()
    .into_any_element()
}
