//! The agent's task plan, pinned above the composer and outside it: the list
//! the CLI shows under its own transcript. Rows, order, the header line and the
//! completed-task fold all come from `sessionChatAgentTaskPanel`
//! (packages/shared/session-chat-presentation/agent-tasks.ts), the same
//! projection `session-chat-agent-tasks-panel.tsx` renders.

use super::{appearance::ChatAppearance, state::NativeChatView, transcript::text};
use crate::app::helpers::ThrottledAnimationExt;
use crate::app::native_chat::cursor::ChatCursor as _;
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, Context, InteractiveElement as _, IntoElement, ParentElement as _,
    StatefulInteractiveElement as _, Styled as _, div, px, relative,
};
use serde_json::{Value, json};
use std::time::Duration;

impl NativeChatView {
    pub(super) fn render_agent_tasks(
        &self,
        p: &ChatAppearance,
        cx: &Context<Self>,
    ) -> Option<AnyElement> {
        let panel = self.snapshot["agentTasksPanel"].clone();
        if !panel.is_object() {
            return None;
        }
        let s = p.scale;
        let open = panel["collapsed"] != true;
        let percent = panel["percent"].as_f64().unwrap_or(0.0) as f32 / 100.0;
        let bar = div()
            .w(px(48.0 * s))
            .h(px(4.0 * s))
            .rounded_full()
            .overflow_hidden()
            .flex_shrink_0()
            .bg(p.foreground.opacity(0.1))
            .child(
                div()
                    .h_full()
                    .w(relative(percent))
                    .rounded_full()
                    .bg(p.control_primary),
            )
            .into_any_element();
        let header = self.panel_header(
            super::panel_card::PanelHeader {
                id: "chat-agent-tasks-header",
                icon: "titlebar/list-check.svg",
                title: "Tasks",
                meta: text(&panel, "meta"),
                open,
                toggle_label: if open { "Hide tasks" } else { "Show tasks" },
                trailing: Some(bar),
                command: json!({"type":"toggleAgentTasks","open":!open}),
            },
            p,
            cx,
        );
        let mut body = Vec::new();
        if open {
            let mut rows = div()
                .id("chat-agent-tasks-rows")
                .flex()
                .flex_col()
                .gap(px(4.0 * s))
                .max_h(px(220.0 * s))
                .overflow_y_scroll();
            for row in panel["rows"].as_array().into_iter().flatten() {
                rows = rows.child(self.task_row(row, p));
            }
            body.push(rows.into_any_element());
            // CDXC:SessionChat 2026-09-16 DECISION: User: the fold is a text line, not a button, and reads "N more task(s)" / "Show less tasks". Rows are the Subagents row size. The panel is the shared status card with a list icon.
            let fold = text(&panel, "foldLabel");
            if !fold.is_empty() {
                let expanded = panel["showCompleted"] == true;
                body.push(
                    div()
                        .id("chat-agent-tasks-fold")
                        .role(gpui::Role::Button)
                        .aria_label(fold.clone())
                        .chat_cursor_pointer()
                        .text_size(px(12.0 * s))
                        .text_color(p.card_muted)
                        .hover(|style| style.text_color(p.foreground))
                        .child(fold)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.invoke(
                                json!({"type":"toggleAgentTasksCompleted","expanded":!expanded}),
                                cx,
                            )
                        }))
                        .into_any_element(),
                );
            }
        }
        Some(
            div()
                .id("chat-agent-tasks")
                .role(gpui::Role::Group)
                .aria_label("Agent tasks")
                .w_full()
                .child(self.status_card_with_header(header, body, Vec::new(), p))
                .into_any_element(),
        )
    }

    fn task_row(&self, row: &Value, p: &ChatAppearance) -> AnyElement {
        let s = p.scale;
        let group = row["group"].as_str().unwrap_or("pending");
        let marker = match group {
            "in_progress" => {
                let glyph = gpui::svg()
                    .path("titlebar/loader2.svg")
                    .size(px(13.0 * s))
                    .text_color(p.control_primary);
                if crate::app::helpers::gpui_macos_reduce_motion_enabled() {
                    glyph.into_any_element()
                } else {
                    glyph
                        .with_throttled_animation(
                            "chat-agent-tasks-spinner",
                            Duration::from_secs(1),
                            |glyph, progress| {
                                glyph.with_transformation(gpui::Transformation::rotate(
                                    gpui::percentage(progress),
                                ))
                            },
                        )
                        .into_any_element()
                }
            }
            // React: a filled check for done work (`IconCircleCheckFilled`), not the outline ring
            // that a waiting task wears.
            "completed" => gpui::svg()
                .path("titlebar/circle-check-filled.svg")
                .size(px(13.0 * s))
                .text_color(p.primary)
                .into_any_element(),
            // The waiting marker is a hollow ring, the shape the CLI uses for a pending box
            // (`.ghostex-chat-agent-tasks-dot`).
            _ => div()
                .size(px(8.0 * s))
                .rounded_full()
                .border(px(1.5 * s))
                .border_color(p.muted.opacity(0.7))
                .into_any_element(),
        };
        let title = text(row, "title");
        let blocked = text(row, "blockedLabel");
        div()
            .id(gpui::SharedString::from(format!(
                "chat-agent-task:{}",
                text(row, "id")
            )))
            .flex()
            .items_center()
            .gap(px(8.0 * s))
            .w_full()
            .min_w_0()
            .text_size(px(12.0 * s))
            .tooltip(move |window, cx| {
                gpui_component::tooltip::Tooltip::new(title.clone()).build(window, cx)
            })
            .child(
                div()
                    .size(px(13.0 * s))
                    .flex()
                    .items_center()
                    .justify_center()
                    .flex_shrink_0()
                    .child(marker),
            )
            .child(
                // React's `flex: 0 1 auto`: the title takes only the room it needs, so what a task
                // waits for reads as part of the line instead of drifting to the far edge.
                div()
                    .flex_shrink(1.0)
                    .min_w_0()
                    .truncate()
                    .when(group == "completed", |this| {
                        this.text_color(p.card_muted).line_through()
                    })
                    .when(group != "completed", |this| this.text_color(p.prose))
                    .child(text(row, "subject")),
            )
            .when(!blocked.is_empty(), |this| {
                this.child(
                    div()
                        .flex_shrink_0()
                        .text_size(px(11.0 * s))
                        .text_color(p.card_muted)
                        .child(blocked),
                )
            })
            .into_any_element()
    }
}
