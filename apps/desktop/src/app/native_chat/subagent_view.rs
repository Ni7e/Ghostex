//! The subagent transcript viewer: the card a subagent link opens over the chat
//! pane, with the child's model label, its task, back and close, and the child's
//! own transcript rendered by the same row renderers as the main list.
//!
//! Every value comes from the host's `subagent` projection and its own splice
//! channel (`packages/shared/session-chat-controller/native-subagent.ts`), the
//! same rules React's `session-chat-subagent-viewer.tsx` renders; this file only
//! lays them out.

use super::{appearance::ChatAppearance, state::NativeChatView, transcript::text};
use crate::app::native_chat::cursor::ChatCursor as _;
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnimationExt as _, AnyElement, Context, InteractiveElement as _, IntoElement, MouseButton,
    ParentElement as _, StatefulInteractiveElement as _, Styled as _, div, list, px, rgba,
};
use serde_json::{Value, json};
use std::sync::Arc;

impl NativeChatView {
    /// The viewer's transcript window, spliced exactly like the main list (`subagentItemsSplice` in native-host.ts).
    pub(super) fn apply_subagent_splice(&mut self, splice: &mut Value) {
        let inserted = splice
            .get_mut("items")
            .and_then(Value::as_array_mut)
            .map(std::mem::take)
            .unwrap_or_default();
        let items = Arc::make_mut(&mut self.subagent_items);
        let start = (splice["start"].as_u64().unwrap_or(0) as usize).min(items.len());
        let end = start
            .saturating_add(splice["deleteCount"].as_u64().unwrap_or(0) as usize)
            .min(items.len());
        let inserted_len = inserted.len();
        items.splice(start..end, inserted);
        self.subagent_list.splice(start..end, inserted_len);
    }

    fn subagent_icon_button(
        &self,
        id: &'static str,
        icon: &'static str,
        label: &'static str,
        command: Value,
        p: &ChatAppearance,
        cx: &Context<Self>,
    ) -> AnyElement {
        let s = p.scale;
        div()
            .id(id)
            .role(gpui::Role::Button)
            .aria_label(label)
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_center()
            .size(px(26.0 * s))
            .rounded(px(6.0 * s))
            .chat_cursor_pointer()
            .hover(|style| style.bg(p.border.opacity(0.6)))
            .child(
                gpui::svg()
                    .path(icon)
                    .size(px(15.0 * s))
                    .text_color(p.primary),
            )
            .on_click(cx.listener(move |this, _, _, cx| this.invoke(command.clone(), cx)))
            .into_any_element()
    }

    /// CDXC:SessionChat 2026-09-18 DECISION:
    /// User: clicking a subagent's name in the chat transcript shows that subagent's transcript in a popup with a backdrop over the main chat, and that transcript uses the same normal display as the main chat, with verbose and summarized off.
    /// GPUI paints the popup inside the chat pane rather than in a child window, and the backdrop takes the pointer so nothing behind it is clickable while it is open.
    pub(super) fn render_subagent_viewer(
        &mut self,
        p: &ChatAppearance,
        window: &mut gpui::Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let state = self.snapshot["subagent"].clone();
        if !state.is_object() {
            if self.subagent_focused {
                self.subagent_focused = false;
                self.focus_requested = true;
            }
            return None;
        }
        // React's dialog traps focus, so Escape closes it whatever the reader last clicked. The
        // native card is painted inside the pane, so it has to claim the pane's focus itself:
        // without this the keyboard handler never sees Escape unless the composer already had it.
        if !self.subagent_focused {
            self.subagent_focused = true;
            self.subagent_focus.focus(window, cx);
        }
        let s = p.scale;
        let title = text(&state, "title");
        let tooltip = text(&state, "tooltip");
        let mut header = div()
            .flex()
            .flex_shrink_0()
            .items_center()
            .gap(px(12.0 * s))
            .px(px(16.0 * s))
            .py(px(12.0 * s))
            .border_b_1()
            .border_color(p.border);
        if state["canBack"] == true {
            header = header.child(self.subagent_icon_button(
                "subagent-back",
                "titlebar/chevron-left.svg",
                "Back to previous subagent",
                json!({"type":"subagentBack"}),
                p,
                cx,
            ));
        }
        header = header
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .gap(px(4.0 * s))
                    .child(
                        // React's `DialogTitle`: `text-base font-medium`, a size above the rows
                        // below it, with the CSS override that stops descenders clipping.
                        div()
                            .id("subagent-title")
                            .w_full()
                            .truncate()
                            .text_size(px(16.0 * s))
                            .line_height(px(24.0 * s))
                            .font_weight(gpui::FontWeight::MEDIUM)
                            .text_color(p.foreground)
                            .when(!tooltip.is_empty(), |this| {
                                this.tooltip(move |window, cx| {
                                    gpui_component::tooltip::Tooltip::new(tooltip.clone())
                                        .build(window, cx)
                                })
                            })
                            .child(title),
                    )
                    .child(
                        div()
                            .w_full()
                            .truncate()
                            .text_size(px(12.0 * s))
                            .text_color(p.muted)
                            .child(text(&state, "description")),
                    ),
            )
            .child(self.subagent_icon_button(
                "subagent-close",
                "titlebar/x.svg",
                "Close subagent transcript",
                json!({"type":"subagentClose"}),
                p,
                cx,
            ));
        let mut card = div()
            .id("subagent-card")
            .occlude()
            .flex()
            .flex_col()
            .min_h_0()
            .w_full()
            .h_full()
            .max_w(px(960.0 * s))
            .max_h(px(860.0 * s))
            .rounded(px(8.0 * s))
            .border_1()
            .border_color(p.border)
            .bg(p.background)
            .text_color(p.primary)
            .overflow_hidden()
            // A click inside the card is not a click on the backdrop that closes it.
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .child(header);
        if let Some(error) = state["error"].as_str() {
            card = card.child(
                div()
                    .id("subagent-error")
                    .flex()
                    .flex_shrink_0()
                    .items_center()
                    .gap(px(12.0 * s))
                    .px(px(16.0 * s))
                    .py(px(8.0 * s))
                    .role(gpui::Role::Alert)
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .text_color(p.error())
                            .child(error.to_string()),
                    )
                    .child(self.chat_button(
                        "subagent-retry".into(),
                        "Retry".into(),
                        json!({"type":"subagentRetry"}),
                        p,
                        cx,
                    )),
            );
        }
        if state["loading"] == true {
            card = card.child(
                div()
                    .id("subagent-loading")
                    .flex()
                    .flex_1()
                    .items_center()
                    .justify_center()
                    .gap(px(8.0 * s))
                    .role(gpui::Role::Status)
                    .text_color(p.muted)
                    .child(subagent_spinner(px(16.0 * s), p.muted))
                    .child("Loading transcript…"),
            );
        } else if state["empty"] == true {
            card = card.child(
                div()
                    .p(px(24.0 * s))
                    .text_color(p.muted)
                    .child("This subagent has not written any messages yet."),
            );
        } else if self.subagent_list.item_count() > 0 {
            if state["hasMore"] == true {
                card = card.child(
                    div()
                        .flex()
                        .flex_shrink_0()
                        .justify_center()
                        .py(px(8.0 * s))
                        .child(
                            self.chat_button(
                                "subagent-load-earlier".into(),
                                if state["loadingEarlier"] == true {
                                    "Loading…"
                                } else {
                                    "Load earlier messages"
                                }
                                .into(),
                                json!({"type":"subagentLoadEarlier"}),
                                p,
                                cx,
                            ),
                        ),
                );
            }
            card = card.child(
                list(
                    self.subagent_list.clone(),
                    cx.processor(|this, index, window, cx| {
                        let items = this.subagent_items.clone();
                        this.transcript_item_row(&items, index, false, window, cx)
                    }),
                )
                .flex_1()
                .min_h_0()
                .w_full(),
            );
        }
        Some(
            div()
                .id("subagent-overlay")
                .track_focus(&self.subagent_focus)
                .absolute()
                .top_0()
                .left_0()
                .size_full()
                .occlude()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                // React's dialog is `min(960px, 100% - 2rem)` by `min(860px, 100dvh - 3rem)`, which
                // on a chat pane this size is the whole pane: the card covers it edge to edge
                // instead of leaving a strip of transcript showing above the backdrop.
                // The dialog's own backdrop tone, dark enough to read the card against a light transcript.
                .bg(rgba(if p.light { 0x00000061 } else { 0x00000094 }))
                .font_family(p.font.clone())
                .on_click(
                    cx.listener(|this, _, _, cx| this.invoke(json!({"type":"subagentClose"}), cx)),
                )
                .child(card)
                .into_any_element(),
        )
    }

    /// The link a subagent chip or fleet row opens the viewer with; a self-selector is plain text (`isSessionChatSubagentSelf`).
    pub(super) fn subagent_open_command(target: &Value) -> Option<Value> {
        if !target.is_object() || target["self"] == true {
            return None;
        }
        let selector = target["selector"]
            .as_str()
            .filter(|value| !value.is_empty())?;
        Some(json!({
            "type": "openSubagent",
            "selector": selector,
            "name": target["name"],
            "agentType": target["agentType"],
            "task": target["task"],
            "model": target["model"],
            "effort": target["effort"],
        }))
    }

    /// A subagent's name as the link React paints: no fill, an underline on hover, and the agent type above the action in its tooltip.
    pub(super) fn subagent_link(
        &self,
        id: String,
        label: String,
        agent_type: Option<String>,
        command: Value,
        p: &ChatAppearance,
        cx: &Context<Self>,
    ) -> AnyElement {
        let tooltip = match agent_type.filter(|value| !value.is_empty()) {
            Some(kind) => format!("{kind}\nView subagent transcript"),
            None => "View subagent transcript".to_string(),
        };
        div()
            .id(gpui::ElementId::Name(id.into()))
            .role(gpui::Role::Button)
            .aria_label(format!("View {label}'s transcript"))
            .min_w_0()
            .truncate()
            .chat_cursor_pointer()
            .text_color(p.control_primary)
            .hover(|style| style.text_decoration_1().text_decoration_color(p.muted))
            .tooltip(move |window, cx| {
                gpui_component::tooltip::Tooltip::new(tooltip.clone()).build(window, cx)
            })
            .child(label)
            .on_click(cx.listener(move |this, _, _, cx| {
                cx.stop_propagation();
                this.invoke(command.clone(), cx);
            }))
            .into_any_element()
    }
}

/// React's `IconLoader2` beside "Loading transcript…", still when the system asks for reduced motion.
fn subagent_spinner(size: gpui::Pixels, color: gpui::Hsla) -> AnyElement {
    let glyph = gpui::svg()
        .path("titlebar/loader2.svg")
        .size(size)
        .text_color(color);
    if crate::app::helpers::gpui_macos_reduce_motion_enabled() {
        return glyph.into_any_element();
    }
    glyph
        .with_animation(
            "subagent-loading-spinner",
            gpui::Animation::new(std::time::Duration::from_millis(900)).repeat(),
            |svg, delta| {
                svg.with_transformation(gpui::Transformation::rotate(gpui::radians(
                    delta * std::f32::consts::TAU,
                )))
            },
        )
        .into_any_element()
}
