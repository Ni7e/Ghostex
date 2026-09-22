use super::state::NativeChatView;
use gpui::{
    AnyElement, Context, InteractiveElement as _, IntoElement, ParentElement, Styled, div, px,
};
use serde_json::json;

impl NativeChatView {
    /// CDXC:SessionChat 2026-09-23 SEE-ALSO: `sessionChatKeepComposerExpanded` in `packages/shared/ghostex-settings/types.ts` holds the user's decision; a missing key reads as its default, on.
    pub(super) fn composer_collapse_eligible(&self) -> bool {
        let keep_expanded = crate::shared_settings::shared_sidebar_settings_snapshot()
            .object()
            .get("sessionChatKeepComposerExpanded")
            .and_then(serde_json::Value::as_bool)
            != Some(false);
        !keep_expanded
            && self.maximized_window.is_none()
            && !(self.snapshot["questionCard"]["visible"] == true
                && self.snapshot["prompt"]["kind"] == "question")
            && self.snapshot["composerCollapseEligible"] == true
    }

    pub(super) fn composer_collapsed(&self) -> bool {
        self.composer_collapse_eligible() && self.snapshot["composerCollapsed"] == true
    }

    /// This frame's chat box tween. `render` reads it before it builds the transcript, whose end
    /// inset comes from the same frame, and `render_composer` reads it again to paint the box.
    pub(super) fn composer_frame(
        &mut self,
        cx: &Context<Self>,
    ) -> super::composer_animation::ComposerFrame {
        let reduce_motion = cx.reduce_motion();
        self.composer_animation
            .set_collapsed(self.composer_collapsed(), reduce_motion);
        self.composer_animation.advance(reduce_motion)
    }

    pub(super) fn scrollable_transcript(
        &self,
        transcript: impl IntoElement,
        cx: &Context<Self>,
    ) -> AnyElement {
        let chat = cx.weak_entity();
        let p = super::appearance::ChatAppearance::current(&self.snapshot);
        let scale = p.scale;
        div()
            .relative()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .w_full()
            // React's transcript menu trigger wraps the whole message list, minimap, scrollbar and
            // scroll button included; pills and links stop the press first (transcript_menu.rs).
            .on_mouse_down(
                gpui::MouseButton::Right,
                cx.listener(|this, event: &gpui::MouseDownEvent, window, cx| {
                    this.transcript_secondary_press(event, window, cx)
                }),
            )
            .child(self.minimap_row(transcript.into_any_element(), cx))
            .child(
                // React masks the viewport's last rows into the composer band
                // (`--scroll-fade-mask` on `[data-slot='message-scroller-viewport']` in chat.css).
                // GPUI cannot mask a scrolling list, so the same shape is painted: a plain div with
                // no id and no interactivity, which registers no hitbox and takes no input.
                div()
                    .absolute()
                    .bottom_0()
                    .left_0()
                    .right_0()
                    .h(px(24.0 * p.scale))
                    .bg(gpui::linear_gradient(
                        180.0,
                        gpui::linear_color_stop(p.background.opacity(0.0), 0.0),
                        gpui::linear_color_stop(p.background, 1.0),
                    )),
            )
            .child(self.transcript_scrollbar(&p))
            .child(self.scroll_bottom_button(cx))
            .child(
                gpui::canvas(
                    |bounds, _, _| bounds,
                    move |_, bounds, window, _| {
                        let chat = chat.clone();
                        window.on_mouse_event(
                            move |event: &gpui::ScrollWheelEvent, phase, _, cx| {
                                if phase != gpui::DispatchPhase::Capture
                                    || !bounds.contains(&event.position)
                                    || event.modifiers.control
                                {
                                    return;
                                }
                                let _ = chat.update(cx, |chat, cx| {
                                    let delta = event.delta.pixel_delta(px(16.0)).y.as_f32();
                                    if delta == 0.0 {
                                        return;
                                    }
                                    let offset =
                                        -chat.list.scroll_px_offset_for_scrollbar().y.as_f32();
                                    // The list's end padding is the band a collapsed box left
                                    // behind (`ComposerFrame::transcript_inset`), not transcript:
                                    // the gesture measures to the last row's end, so a collapsed
                                    // box expands again as soon as the rows are all in view.
                                    let maximum = (chat.list.max_offset_for_scrollbar().y.as_f32()
                                        - chat.composer_animation.current_transcript_inset())
                                    .max(0.0);
                                    let end_distance = (maximum - offset).max(0.0);
                                    // CDXC:SessionChat 2026-09-21 WHY: An upward wheel that leaves the list inside the band the collapsed box would only fill with the held inset is not a collapse gesture. Collapsing there uncovers no rows, and with the box expanding again 10px from the end it let a small up and down wobble at the edge flip the box on every reversal.
                                    if delta > 0.0
                                        && !chat.composer_collapsed()
                                        && end_distance + delta
                                            < chat.composer_animation.collapse_travel(scale)
                                    {
                                        return;
                                    }
                                    chat.invoke(
                                        json!({"type":"composerScroll", "delta":delta,
                            "distanceToEnd":end_distance,
                            "canScroll":if delta > 0.0 { offset > 0.0 } else { end_distance > 0.0 },
                            "eligible":chat.composer_collapse_eligible()}),
                                        cx,
                                    );
                                });
                            },
                        );
                    },
                )
                .absolute()
                .size_full(),
            )
            .into_any_element()
    }
}
