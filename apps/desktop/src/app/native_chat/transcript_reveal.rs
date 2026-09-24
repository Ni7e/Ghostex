/*!
The loading hold a chat shows while its transcript is still being read, and the fade the
transcript arrives with once it is ready.

CDXC:SessionChat 2026-09-24 DECISION:
User: no skeleton when a GPUI chat view is focused, because the transcript loads within 500ms; the chat fades in as soon as it is ready instead. The transcript area stays blank during the hold (the real composer keeps its place at the bottom) and only the late Retry row can appear in it. This supersedes the 2026-09-19 decision to draw a skeleton the moment a transcript starts loading; React chat keeps its skeleton.
*/

use super::{appearance::ChatAppearance, state::NativeChatView};
use gpui::prelude::FluentBuilder as _;
use gpui::{
    Animation, AnimationExt as _, AnyElement, Context, Div, InteractiveElement as _, IntoElement,
    ParentElement as _, StatefulInteractiveElement as _, Styled as _, div, px,
};
use serde_json::{Value, json};
use std::time::Duration;

const REVEAL_MS: u64 = 250;

/// Whether the transcript is being held back, and which reveal its fade belongs to.
pub(crate) struct TranscriptReveal {
    /// Nothing of this transcript has been drawn since the view was created or last drew the
    /// loading hold, so the next content fades in.
    held: bool,
    /// Bumped each time content replaces a hold, so the next session's content fades in afresh.
    generation: Option<u64>,
}

impl Default for TranscriptReveal {
    /// A new view fades its first content in too: the pane showed the pre-view placeholder
    /// (session_chat_skeleton.rs) until it existed, often with the transcript already read.
    fn default() -> Self {
        Self {
            held: true,
            generation: None,
        }
    }
}

impl NativeChatView {
    /// The hold stage while the transcript is still being read. A chat whose host has not published
    /// its first snapshot yet is reading its transcript too.
    pub(super) fn transcript_loading_stage<'a>(&self, state: &'a Value) -> Option<&'a str> {
        state["loadingStage"]
            .as_str()
            .or_else(|| (state["status"].is_null() && self.error.is_none()).then_some("indicator"))
    }

    /// The loading hold: an empty transcript region, with the Retry row once the read runs long.
    pub(super) fn render_loading_hold(
        &mut self,
        stage: &str,
        p: &ChatAppearance,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        self.transcript_reveal.held = true;
        let s = p.scale;
        div()
            .flex_1()
            .min_h_0()
            .w_full()
            .flex()
            .items_center()
            .justify_center()
            .overflow_hidden()
            .when(stage == "retry", |this| {
                this.child(
                    div()
                        .id("chat-transcript-loading")
                        .role(gpui::Role::Status)
                        .aria_label("Loading conversation…")
                        .flex()
                        .items_center()
                        .justify_center()
                        .gap(px(12.0 * s))
                        .text_color(p.muted)
                        .child("Still loading this conversation.")
                        .child(self.chat_button(
                            "retry-chat".into(),
                            "Retry".into(),
                            json!({"type":"retry"}),
                            p,
                            cx,
                        )),
                )
            })
            .into_any_element()
    }

    /// The transcript region, fading in when it replaces a loading hold.
    pub(super) fn reveal_transcript(&mut self, region: Div) -> AnyElement {
        let reveal = &mut self.transcript_reveal;
        if std::mem::take(&mut reveal.held) {
            reveal.generation = Some(reveal.generation.map_or(0, |generation| generation + 1));
        }
        match reveal.generation {
            // Stays wrapped after the fade ends so the rows keep one element path.
            Some(generation) => region
                .with_animation(
                    gpui::ElementId::NamedInteger("chat-transcript-reveal".into(), generation),
                    // Not ease-out-quint: that is ~95% opaque a third of the way in, which reads as a pop.
                    Animation::new(Duration::from_millis(REVEAL_MS)).with_easing(gpui::ease_in_out),
                    |region, delta| region.opacity(delta),
                )
                .into_any_element(),
            None => region.into_any_element(),
        }
    }
}
