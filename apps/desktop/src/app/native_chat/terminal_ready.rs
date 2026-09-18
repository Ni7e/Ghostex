//! The composer footer's Terminal View button doubles as the agent CLI's
//! readiness light and shows the bottom of that screen on hover. Both come from
//! the session-scoped terminal-tail read the `composerNotReady` card uses; the
//! read happens only on hover or focus, never on a background timer.
//!
//! Only a measured verdict tints the glyph: `unknown`, an unreadable screen and
//! the time before the first hover keep the inherited footer color, because the
//! daemon fails open on `unknown` and a red button would accuse a session that
//! sends fine. Colors match `.ghostex-chat-footer-control[data-terminal-ready]`
//! in packages/core-ui/styles/chat.css.

use super::{appearance::ChatAppearance, state::NativeChatView, transcript::text};
use gpui::{
    AnyElement, Context, InteractiveElement as _, IntoElement, ParentElement as _,
    StatefulInteractiveElement as _, Styled as _, div, px,
};
use serde_json::json;

impl NativeChatView {
    pub(super) fn render_terminal_view_button(
        &self,
        p: &ChatAppearance,
        cx: &Context<Self>,
    ) -> AnyElement {
        let tail = &self.snapshot["terminalTail"];
        let tint = match tail["readiness"].as_str() {
            Some("ready") => Some(gpui::rgb(0xa6e3b1)),
            Some("notReady") => Some(gpui::rgb(0xf0a3a3)),
            _ => None,
        };
        let preview = text(tail, "preview");
        let reason = text(tail, "reason");
        let tooltip = [
            Some("Agent CLI Preview".to_string()),
            Some("Click to Switch to Terminal View".to_string()),
            Some(reason).filter(|reason| !reason.is_empty()),
            Some(preview).filter(|preview| !preview.is_empty()),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join("\n\n");
        div()
            .id("terminalView")
            .role(gpui::Role::Button)
            .aria_label("Terminal View")
            .cursor_pointer()
            .size(px(28.0 * p.scale))
            .flex()
            .items_center()
            .justify_center()
            .rounded_full()
            .hover(|style| style.bg(p.border))
            .child(
                gpui::svg()
                    .path("titlebar/terminal-2.svg")
                    .size(px(16.0 * p.scale))
                    .text_color(tint.map_or(p.primary, |color| color.into())),
            )
            .tooltip(move |window, cx| {
                gpui_component::tooltip::Tooltip::new(tooltip.clone()).build(window, cx)
            })
            // The tooltip's own open delay is longer than the read, so hovering is enough
            // to have the current screen ready by the time the preview appears.
            .on_hover(cx.listener(|this, hovered: &bool, _, cx| {
                if *hovered {
                    this.invoke(json!({"type":"terminalTailHover"}), cx);
                }
            }))
            .on_click(
                cx.listener(move |this, event: &gpui::ClickEvent, window, cx| {
                    this.perform_composer_action("terminalView", event.position(), window, cx)
                }),
            )
            .into_any_element()
    }
}
