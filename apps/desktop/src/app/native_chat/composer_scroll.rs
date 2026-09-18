use super::state::NativeChatView;
use gpui::{AnyElement, Context, IntoElement, ParentElement, Styled, div, px};
use serde_json::json;

impl NativeChatView {
    pub(super) fn composer_collapse_eligible(&self) -> bool {
        self.maximized_window.is_none()
            && !(self.snapshot["questionCard"]["visible"] == true
                && self.snapshot["prompt"]["kind"] == "question")
            && self.snapshot["composerCollapseEligible"] == true
    }

    pub(super) fn composer_collapsed(&self) -> bool {
        self.composer_collapse_eligible() && self.snapshot["composerCollapsed"] == true
    }

    pub(super) fn scrollable_transcript(
        &self,
        transcript: impl IntoElement,
        cx: &Context<Self>,
    ) -> AnyElement {
        let chat = cx.weak_entity();
        div()
            .relative()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .w_full()
            .child(transcript)
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
                                    let maximum = chat.list.max_offset_for_scrollbar().y.as_f32();
                                    let end_distance = (maximum - offset).max(0.0);
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
