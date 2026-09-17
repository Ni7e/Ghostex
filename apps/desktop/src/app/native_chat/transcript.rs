use super::{appearance::ChatAppearance, state::NativeChatView};
use gpui::StatefulInteractiveElement;
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, Context, FontWeight, InteractiveElement as _, IntoElement, ParentElement as _,
    Styled as _, Window, div, px, relative,
};
use gpui_component::text::{TextView, TextViewStyle};
use serde_json::{Value, json};

pub(crate) fn text(value: &Value, key: &str) -> String {
    value[key].as_str().unwrap_or_default().to_string()
}

impl NativeChatView {
    fn is_expanded(&self, id: &str, default: bool) -> bool {
        self.expanded.contains(id) || default && !self.collapsed.contains(id)
    }
    pub(crate) fn transcript_row(
        &mut self,
        index: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let items = self.items.clone();
        let item = &items[index];
        let p = ChatAppearance::current(&self.snapshot);
        let s = p.scale;
        let content = if item["kind"] == "summary" {
            let id = format!("summary:{}", text(&item, "id"));
            let expanded = self.expanded.contains(&id);
            let mut row = div()
                .flex()
                .flex_col()
                .w_full()
                .gap(px(8.0 * s))
                .child(self.message_row(&item["user"], &p, window, cx));
            if item["final"].is_object() || item["active"] == true {
                row = row.child(
                    self.disclosure(
                        id,
                        if item["final"].is_object() {
                            "Agent reply"
                        } else {
                            "Active work"
                        }
                        .into(),
                        expanded,
                        None,
                        &p,
                        cx,
                    ),
                );
                if expanded {
                    if item["final"].is_object() {
                        row = row.child(self.message_row(&item["final"], &p, window, cx));
                    } else {
                        for message in item["work"].as_array().into_iter().flatten() {
                            row = row.child(self.message_row(message, &p, window, cx));
                        }
                    }
                }
            }
            row.into_any_element()
        } else if item["kind"] == "completed-work" {
            let id = format!("work:{}", text(&item, "id"));
            let expanded = self.is_expanded(&id, p.verbose);
            let mut row = div().flex().flex_col().w_full().gap(px(8.0 * s));
            row = row.child(
                self.disclosure(
                    id,
                    text(&item, "label"),
                    expanded,
                    Some(json!({"type":"loadWork","id":item["id"],"work":item["deferred"]}))
                        .filter(|_| item["deferred"].is_object()),
                    &p,
                    cx,
                ),
            );
            row = row.child(
                div()
                    .h(px(1.0))
                    .mt(px(2.0 * s))
                    .mb(px(8.0 * s))
                    .w_full()
                    .bg(p.border),
            );
            if expanded {
                for message in item["work"].as_array().into_iter().flatten() {
                    row = row.child(self.message_row(message, &p, window, cx));
                }
            }
            if item["final"].is_object() {
                row = row.child(self.message_row(&item["final"], &p, window, cx));
            }
            row.into_any_element()
        } else {
            self.message_row(&item["message"], &p, window, cx)
        };
        div()
            .w_full()
            .flex()
            .justify_center()
            .child(
                div()
                    .w_full()
                    .max_w(px(768.0 * s))
                    .px(px(16.0 * s))
                    .pb(px(13.0 * s))
                    .when_some(p.transcript_width, |this, width| {
                        this.max_w(relative(1.0)).w(relative(width))
                    })
                    .child(content),
            )
            .into_any_element()
    }

    pub(crate) fn disclosure(
        &self,
        id: String,
        label: String,
        expanded: bool,
        action: Option<Value>,
        p: &ChatAppearance,
        cx: &Context<Self>,
    ) -> AnyElement {
        let s = p.scale;
        div()
            .id(id.clone())
            .flex()
            .items_start()
            .w_full()
            .gap(px(6.0 * s))
            .rounded(px(4.0 * s))
            .text_color(p.primary)
            .cursor_pointer()
            .hover(|style| style.bg(p.border.opacity(0.4)))
            .child(
                div()
                    .w(px(16.0 * s))
                    .ml(px(2.0 * s))
                    .h(px(22.75 * s))
                    .flex()
                    .items_center()
                    .justify_center()
                    .flex_shrink_0()
                    .child(
                        gpui::svg()
                            .path(if expanded {
                                "titlebar/chevron-down.svg"
                            } else {
                                "titlebar/chevron-right.svg"
                            })
                            .size(px(14.0 * s))
                            .text_color(p.primary),
                    ),
            )
            .child(div().flex_1().min_w_0().child(label))
            .on_click(cx.listener(move |this, _, _, cx| {
                if expanded {
                    this.expanded.remove(&id);
                    this.collapsed.insert(id.clone());
                } else {
                    this.collapsed.remove(&id);
                    this.expanded.insert(id.clone());
                    if let Some(action) = &action {
                        this.invoke(action.clone(), cx);
                    }
                }
                this.list.remeasure();
                cx.notify();
            }))
            .into_any_element()
    }

    pub(crate) fn markdown(&self, id: String, content: String, p: &ChatAppearance) -> AnyElement {
        let mut style = TextViewStyle::default()
            .paragraph_gap(gpui::rems(0.75))
            .heading_font_size(|_, base| base);
        style.heading_base_font_size = px(14.0 * p.scale);
        style.is_dark = !p.light;
        style.highlight_theme = if p.light {
            gpui_component::highlighter::HighlightTheme::default_light()
        } else {
            gpui_component::highlighter::HighlightTheme::default_dark()
        }
        .clone();
        TextView::markdown(id, content)
            .selectable(true)
            .style(style)
            .text_size(px(14.0 * p.scale))
            .line_height(px(22.75 * p.scale))
            .text_color(p.primary)
            .into_any_element()
    }

    fn message_row(
        &mut self,
        message: &Value,
        p: &ChatAppearance,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let id = text(message, "id");
        let body = text(message, "text");
        let s = p.scale;
        let mut row = div()
            .id(format!("message:{id}"))
            .group("native-chat-message")
            .flex()
            .flex_col()
            .min_w_0()
            .w_full()
            .gap(px(8.0 * s));
        if message["role"] == "user" && message["suppressed"].is_null() {
            let copy = text(message, "copyText");
            // The prompt renders as markdown like the React bubble, which also makes it a selectable TextView; a plain string child cannot be selected.
            let bubble = div()
                .max_w(relative(0.8))
                .min_w_0()
                .rounded(px(16.0 * s))
                .p(px(12.0 * s))
                .bg(p.input)
                .child(self.markdown(format!("user:{id}"), body.clone(), p));
            return row
                .when(message["queued"] == true, |this| {
                    this.child(
                        div()
                            .flex()
                            .justify_end()
                            .text_size(px(11.0 * s))
                            .text_color(p.muted)
                            .child("QUEUED"),
                    )
                })
                .child(
                    div()
                        .flex()
                        .justify_end()
                        .items_start()
                        .gap(px(6.0 * s))
                        .child(
                            div()
                                .id(format!("copy:{id}"))
                                .opacity(0.0)
                                .group_hover("native-chat-message", |style| style.opacity(1.0))
                                .cursor_pointer()
                                .on_click(move |_, _, cx| {
                                    cx.write_to_clipboard(gpui::ClipboardItem::new_string(
                                        copy.clone(),
                                    ))
                                })
                                .child(
                                    gpui::svg()
                                        .path("titlebar/copy.svg")
                                        .size(px(14.0 * s))
                                        .text_color(p.muted),
                                ),
                        )
                        .child(bubble),
                )
                .into_any_element();
        }
        if message["suppressed"].is_object() {
            let key = format!("suppressed:{id}");
            let expanded = self.expanded.contains(&key);
            row = row.child(self.disclosure(
                key,
                text(&message["suppressed"], "label"),
                expanded,
                None,
                p,
                cx,
            ));
            if expanded {
                row = row.child(self.markdown(format!("body:{id}"), body, p));
            }
            return row.into_any_element();
        }
        if !body.is_empty() {
            let reasoning = message["role"] == "reasoning";
            let tools = message["tools"]
                .as_array()
                .is_some_and(|tools| !tools.is_empty());
            if reasoning && tools {
                let key = format!("reasoning:{id}");
                let expanded = self.is_expanded(&key, p.verbose);
                row = row.child(self.disclosure(
                    key.clone(),
                    text(&message["reasoning"], "headline"),
                    expanded,
                    None,
                    p,
                    cx,
                ));
                let detail = text(&message["reasoning"], "body");
                if expanded && !detail.is_empty() {
                    row = row.child(self.markdown(format!("reasoning-body:{id}"), detail, p));
                }
            } else {
                row = row.child(
                    div()
                        .flex()
                        .items_start()
                        .gap(px(6.0 * s))
                        .child(
                            div()
                                .w(px(16.0 * s))
                                .ml(px(2.0 * s))
                                .flex_shrink_0()
                                .flex()
                                .justify_center()
                                .child(
                                    div()
                                        .mt(px(9.5 * s))
                                        .size(px(4.0 * s))
                                        .rounded_full()
                                        .bg(p.primary),
                                ),
                        )
                        .child(div().min_w_0().flex_1().child(self.markdown(
                            format!("body:{id}"),
                            body.clone(),
                            p,
                        ))),
                );
            }
        }
        let files_key = format!("files:{id}");
        let files_expanded = self.expanded.contains(&files_key);
        if p.simple
            && message["files"]
                .as_array()
                .is_some_and(|files| !files.is_empty())
        {
            row = row.child(self.disclosure(
                files_key,
                text(message, "simpleFileLabel"),
                files_expanded,
                None,
                p,
                cx,
            ));
        }
        for (file_index, file) in message["files"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
            .filter(|_| !p.simple || files_expanded)
        {
            let key = format!("file:{id}:{file_index}");
            let expanded = self.expanded.contains(&key);
            let path = text(file, "path");
            let mut card = div()
                .flex()
                .flex_col()
                .w_full()
                .border_1()
                .border_color(p.border)
                .rounded(px(8.0 * s))
                .overflow_hidden()
                .child(div().p(px(8.0 * s)).child(self.disclosure(
                    key,
                    format!("{} {}", text(file, "action"), path),
                    expanded,
                    None,
                    p,
                    cx,
                )));
            if expanded || p.file_previews {
                for line in file["lines"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .take(if expanded { usize::MAX } else { 7 })
                {
                    let color = match line["kind"].as_str() {
                        Some("add") => gpui::rgb(0x95d0a5),
                        Some("del") => gpui::rgb(0xe6a0a0),
                        _ => gpui::rgb(0xb4b8c0),
                    };
                    let sign = match line["kind"].as_str() {
                        Some("add") => "+",
                        Some("del") => "-",
                        _ => " ",
                    };
                    card = card.child(
                        div()
                            .px(px(8.0 * s))
                            .font_family("JetBrainsMono Nerd Font")
                            .text_size(px(12.6 * s))
                            .text_color(color)
                            .child(format!("{sign} {}", text(line, "text"))),
                    );
                }
            }
            row = row.child(card);
        }
        let reasoning = message["role"] == "reasoning";
        let tools_key = format!("tools:{id}");
        let tools_expanded = self.is_expanded(&tools_key, p.verbose);
        if p.simple
            && message["tools"]
                .as_array()
                .is_some_and(|tools| !tools.is_empty())
        {
            row = row.child(self.disclosure(
                tools_key,
                text(message, "simpleToolLabel"),
                tools_expanded,
                None,
                p,
                cx,
            ));
        }
        if (!p.simple || tools_expanded)
            && (!reasoning || self.is_expanded(&format!("reasoning:{id}"), p.verbose))
        {
            for (index, tool) in message["tools"]
                .as_array()
                .into_iter()
                .flatten()
                .enumerate()
            {
                let key = format!("tool:{id}:{index}");
                let expanded = self.expanded.contains(&key);
                let label = if p.simple {
                    text(&tool["call"], "name")
                } else {
                    format!("{} {}", text(&tool["call"], "name"), text(tool, "preview"))
                };
                row = row.child(self.disclosure(key.clone(), label, expanded, None, p, cx));
                if expanded {
                    let detail = format!(
                        "{}\n{}",
                        text(tool, "input"),
                        text(&tool["result"], "output")
                    );
                    row = row.child(
                        div()
                            .id(format!("detail:{key}"))
                            .max_h(px(400.0 * s))
                            .overflow_y_scroll()
                            .p(px(12.0 * s))
                            .bg(p.input)
                            .rounded(px(8.0 * s))
                            .child(self.markdown(
                                format!("content:{key}"),
                                format!("```\n{detail}\n```"),
                                p,
                            )),
                    );
                }
            }
        }
        if self.snapshot["finalIds"]
            .as_array()
            .is_some_and(|ids| ids.iter().any(|candidate| candidate.as_str() == Some(&id)))
        {
            let copy = text(message, "copyText");
            let annotate = body;
            row = row.child(
                div()
                    .flex()
                    .gap(px(10.0 * s))
                    .text_color(p.muted)
                    .child(
                        div()
                            .id(format!("copy:{id}"))
                            .cursor_pointer()
                            .child(gpui::svg().path("titlebar/copy.svg").size(px(14.0 * s)))
                            .on_click(move |_, _, cx| {
                                cx.write_to_clipboard(gpui::ClipboardItem::new_string(copy.clone()))
                            }),
                    )
                    .child(
                        div()
                            .id(format!("annotate:{id}"))
                            .cursor_pointer()
                            .child(gpui::svg().path("titlebar/pencil.svg").size(px(14.0 * s)))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.host("annotateReply", json!({"markdown":annotate}), cx)
                            })),
                    ),
            );
        }
        row.into_any_element()
    }
}
