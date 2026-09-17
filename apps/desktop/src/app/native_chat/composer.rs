use super::{appearance::ChatAppearance, state::NativeChatView, transcript::text};
use gpui::StatefulInteractiveElement;
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, Context, InteractiveElement as _, IntoElement, ParentElement as _, Styled as _,
    Window, div, px,
};
use gpui_component::input::Input;
use serde_json::{Value, json};

impl NativeChatView {
    pub(crate) fn icon_command(
        &self,
        id: &'static str,
        label: &'static str,
        icon: &'static str,
        command: Value,
        p: &ChatAppearance,
        cx: &Context<Self>,
    ) -> AnyElement {
        div()
            .id(id)
            .role(gpui::Role::Button)
            .aria_label(label)
            .cursor_pointer()
            .size(px(24.0 * p.scale))
            .flex()
            .items_center()
            .justify_center()
            .rounded(px(5.0 * p.scale))
            .hover(|style| style.bg(p.border))
            .tooltip(move |window, cx| {
                gpui_component::tooltip::Tooltip::new(label).build(window, cx)
            })
            .child(
                gpui::svg()
                    .path(icon)
                    .size(px(14.0 * p.scale))
                    .text_color(p.primary),
            )
            .on_click(cx.listener(move |this, _, _, cx| this.invoke(command.clone(), cx)))
            .into_any_element()
    }
    pub(crate) fn send(&mut self, queued: bool, window: &mut Window, cx: &mut Context<Self>) {
        self.submit(if queued { "queue" } else { "send" }, window, cx);
    }

    pub(crate) fn submit(&mut self, mode: &str, window: &mut Window, cx: &mut Context<Self>) {
        if !self.composer_ready || self.draft.trim().is_empty() || self.pending_send {
            return;
        }
        if mode != "send" && self.snapshot["queue"]["capabilities"]["canQueue"] != true {
            return;
        }
        if self.snapshot["sendBlockedReason"].is_string() {
            self.invoke(json!({"type":"reportSendBlocked"}), cx);
            return;
        }
        self.update_suggestion_selection(cx);
        if mode == "send" && self.snapshot["composerCommand"].is_string() {
            self.invoke(json!({"type":"completeComposerCommand"}), cx);
            self.ensure_input(window, cx);
            return;
        }
        let next_id = match crate::app::helpers::gpui_random_uuid_string() {
            Ok(id) => id,
            Err(error) => {
                self.error = Some(error);
                cx.notify();
                return;
            }
        };
        self.close_maximized(cx);
        self.pending_send = true;
        let submission = json!({"type":mode,"text":self.draft,
            "draftVersion":{"draftId":self.draft_id,"revision":self.draft_revision.max(1)}});
        self.draft.clear();
        self.draft_id = next_id;
        self.draft_revision = 1;
        if let Some(input) = &self.input {
            input.update(cx, |input, cx| input.set_value("", window, cx));
        }
        cx.emit(super::state::NativeChatEvent::DraftState(true));
        self.invoke(submission, cx);
    }

    pub(crate) fn chat_button(
        &self,
        id: String,
        label: String,
        command: Value,
        p: &ChatAppearance,
        cx: &Context<Self>,
    ) -> AnyElement {
        div()
            .id(id)
            .role(gpui::Role::Button)
            .aria_label(label.clone())
            .cursor_pointer()
            .px(px(8.0 * p.scale))
            .py(px(4.0 * p.scale))
            .rounded(px(6.0 * p.scale))
            .border_1()
            .border_color(p.border)
            .text_color(p.primary)
            .hover(|style| style.bg(p.border))
            .child(label)
            .on_click(cx.listener(move |this, _, _, cx| this.invoke(command.clone(), cx)))
            .into_any_element()
    }

    pub(crate) fn host_button(
        &self,
        action: &'static str,
        icon: &'static str,
        p: &ChatAppearance,
        cx: &Context<Self>,
    ) -> AnyElement {
        let label = match action {
            "moreActions" => "More actions",
            "maximizeComposer" if self.maximized_window.is_some() => "Exit maximize",
            "maximizeComposer" => "Maximize",
            "summaryMode" => "Summary mode",
            "sessionNote" => "Session note",
            "stashPrompt" => "Stash prompt",
            "attachPath" => "Attach a file or folder",
            "terminalView" => "Terminal View",
            _ => action,
        };
        div()
            .id(action)
            .role(gpui::Role::Button)
            .aria_label(label)
            .cursor_pointer()
            .size(px(28.0 * p.scale))
            .flex()
            .items_center()
            .justify_center()
            .rounded_full()
            .hover(|style| style.bg(p.border))
            .child(
                gpui::svg()
                    .path(icon)
                    .size(px(16.0 * p.scale))
                    .text_color(p.primary),
            )
            .tooltip(move |window, cx| {
                gpui_component::tooltip::Tooltip::new(label).build(window, cx)
            })
            .on_click(
                cx.listener(move |this, event: &gpui::ClickEvent, window, cx| {
                    this.perform_composer_action(action, event.position(), window, cx)
                }),
            )
            .when(action == "stashPrompt", |this| {
                this.on_mouse_down(
                    gpui::MouseButton::Right,
                    cx.listener(|this, _, _, cx| {
                        this.host("stashedPrompts", json!({}), cx);
                        cx.stop_propagation();
                    }),
                )
            })
            .into_any_element()
    }

    pub(crate) fn render_composer(
        &mut self,
        p: &ChatAppearance,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let s = p.scale;
        let maximized = self.maximized_window.is_some();
        let input = self.input.as_ref().unwrap().clone();
        let mut footer = div()
            .w_full()
            .flex()
            .flex_col()
            .gap(px(8.0 * s))
            .px(px(16.0 * s))
            .pt(px(8.0 * s))
            .pb(px(12.0 * s))
            .max_w(px(768.0 * s))
            .when(maximized, |this| this.p_0().max_w_full().h_full().min_h_0());
        if self.snapshot["incomingDraft"].is_object() {
            footer = footer.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.0 * s))
                    .child(div().flex_1().child("Another saved draft is available"))
                    .child(self.chat_button(
                        "use-incoming".into(),
                        "Use".into(),
                        json!({"type":"useIncomingDraft"}),
                        p,
                        cx,
                    ))
                    .child(self.chat_button(
                        "dismiss-incoming".into(),
                        "Dismiss".into(),
                        json!({"type":"dismissIncomingDraft"}),
                        p,
                        cx,
                    )),
            );
        }
        if !maximized {
            if let Some(strip) = self.render_working_strip(p) {
                footer = footer.child(strip);
            }
        }
        if let Some(error) = self.snapshot["operationError"].as_str() {
            footer = footer.child(
                div()
                    .text_color(gpui::rgb(0xef9999))
                    .child(error.to_string()),
            );
        }
        if let Some(notice) = self.render_notice(p, window, cx) {
            footer = footer.child(notice);
        }
        if let Some(prompt) = self.render_prompt(p, window, cx) {
            return div()
                .flex()
                .w_full()
                .justify_center()
                .flex_shrink_0()
                .child(footer.child(prompt))
                .into_any_element();
        }
        if let Some(note) = self.render_note(p, window, cx) {
            footer = footer.child(note);
        }
        if maximized {
            if let Some(suggestions) = self.inline_suggestions(window, cx) {
                let rows = self.snapshot["suggestions"]["rows"]
                    .as_array()
                    .map_or(0, Vec::len);
                let status = self.snapshot["suggestions"]["status"].is_string();
                let height =
                    (40.0 + rows as f32 * 36.0 + if status { 36.0 } else { 0.0 }).min(290.0);
                footer = footer.child(
                    div()
                        .h(px(height * s))
                        .max_h(gpui::relative(0.4))
                        .flex_shrink_0()
                        .child(suggestions),
                );
            }
        }
        let model = text(&self.snapshot["optionLabels"], "model");
        let effort = text(&self.snapshot["optionLabels"], "options");
        let measurement = self.composer_measurement(p, window, cx);
        let composer_bounds = self.composer_bounds.clone();
        let chat = cx.weak_entity();
        let suggestion_anchor = gpui::canvas(
            move |bounds, _, cx| {
                if composer_bounds.replace(bounds) != bounds {
                    let chat = chat.clone();
                    cx.defer(move |cx| {
                        let _ = chat.update(cx, |chat, cx| chat.sync_suggestion_window(cx));
                    });
                }
            },
            |_, _, _, _| {},
        )
        .absolute()
        .size_full();
        footer = footer.child(
            div()
                .relative()
                .flex()
                .flex_col()
                .w_full()
                .min_w_0()
                .child(suggestion_anchor)
                .rounded(px(22.0 * s))
                .border_1()
                .border_color(p.composer_border)
                .bg(p.composer_background)
                .px(px(16.0 * s))
                .py(px(10.0 * s))
                .gap(px(6.0 * s))
                .when(maximized, |this| this.flex_1().min_h_0())
                .children(self.render_queue(p, cx))
                .child(
                    Input::new(&input)
                        .disabled(!self.composer_ready)
                        .appearance(false)
                        .bordered(false)
                        .focus_bordered(false)
                        .w_full()
                        .p_0()
                        .text_size(px(14.0 * s))
                        .text_color(p.primary)
                        .line_height(px(24.0 * s))
                        .when(!maximized, |this| this.max_h(px(160.0 * s)))
                        .when(maximized, |this| this.h_full().flex_1().min_h_0()),
                )
                .child(
                    div()
                        .relative()
                        .flex()
                        .items_center()
                        .justify_between()
                        .gap(px(8.0 * s))
                        .child(self.render_option_pills(&model, &effort, p, cx))
                        .child(self.render_toolbar(p, cx))
                        .child(measurement),
                ),
        );
        if self.snapshot["contextMeter"]["hasConfiguredItems"] == true
            || self.snapshot["contextMeter"]["starred"]
                .as_array()
                .is_some_and(|items| !items.is_empty())
        {
            footer = footer.child(self.render_context_status(p, window, cx));
        }
        div()
            .flex()
            .w_full()
            .justify_center()
            .flex_shrink_0()
            .when(maximized, |this| this.h_full().min_h_0())
            .child(footer)
            .into_any_element()
    }
}
