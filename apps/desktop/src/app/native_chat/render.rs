use super::keyboard::ComposerInputActions as _;
use super::{appearance::ChatAppearance, state::NativeChatView};
use gpui::prelude::FluentBuilder as _;
use gpui::{
    Context, Focusable as _, InteractiveElement as _, IntoElement, ParentElement as _, Render,
    Styled as _, Window, div, list, px,
};
use serde_json::json;

impl Render for NativeChatView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        super::scroll_bottom::register(cx);
        self.main_window = Some(window.window_handle());
        if self.maximized_window.is_none() {
            self.ensure_input(window, cx);
        }
        let p = ChatAppearance::current(&self.snapshot);
        let s = p.scale;
        let state = self.snapshot.clone();
        let error = self.error.clone();
        let transcript = list(
            self.list.clone(),
            cx.processor(|this, index, window, cx| this.transcript_row(index, window, cx)),
        )
        .flex_1()
        .min_h_0()
        .w_full();
        let transcript = self.scrollable_transcript(transcript, cx);
        let composer = if self.maximized_window.is_none() {
            self.render_composer(&p, window, cx)
        } else {
            div().h(px(148.0 * s)).into_any_element()
        };
        let bounds = self.bounds.clone();
        let rows = self.list.item_count();
        let content_ready = self.error.is_none()
            && (rows > 0
                || matches!(
                    state["status"].as_str(),
                    Some("ready" | "working" | "empty")
                ));
        let session_id = self.config.sidebar_session_id.clone();
        let shell_session_id = self.config.shell_session_id;
        let app = self.config.app.clone();
        let pane_focused = self.pane_focused;
        let composer_ready = self.composer_ready;
        div()
            .id("native-session-chat")
            .size_full()
            .min_w_0()
            .min_h_0()
            .flex()
            .flex_col()
            .overflow_hidden()
            .on_action(cx.listener(Self::handle_action))
            .font_family(p.font.clone())
            .text_size(px(14.0 * s))
            .line_height(px(22.75 * s))
            .bg(p.background)
            .text_color(p.primary)
            .capture_any_mouse_down(|_, window, _| {
                super::focus::reclaim_keyboard_focus(window);
            })
            .capture_action(cx.listener(Self::scroll_bottom_action))
            .capture_key_down(cx.listener(Self::composer_key_down))
            .composer_input_actions(cx)
            .capture_key_up(cx.listener(|chat, _, _, _| chat.composer_held_key = None))
            .capture_action(cx.listener(Self::paste_attachments))
            .on_drop(cx.listener(|chat, paths: &gpui::ExternalPaths, _, cx| {
                let paths = paths
                    .0
                    .iter()
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect::<Vec<_>>();
                chat.invoke(serde_json::json!({"type":"attachPaths","paths":paths}), cx);
                cx.stop_propagation();
            }))
            .when_some(error, |this, error| {
                this.child(
                    div()
                        .p(px(16.0 * s))
                        .text_color(gpui::rgb(0xef9999))
                        .child(error),
                )
            })
            .when(state["hasMore"] == true, |this| {
                this.child(
                    div().flex().justify_center().child(
                        self.chat_button(
                            "load-earlier".into(),
                            if state["loadingEarlier"] == true {
                                "Loading…"
                            } else {
                                "Load earlier messages"
                            }
                            .into(),
                            json!({"type":"loadEarlier"}),
                            &p,
                            cx,
                        ),
                    ),
                )
            })
            .when(self.list.item_count() == 0, |this| {
                this.child(self.render_empty_transcript_region(&state, &p, cx))
            })
            .when(self.list.item_count() > 0, |this| this.child(transcript))
            .child(composer)
            .child(
                gpui::canvas(
                    move |rect, _, _| {
                        bounds.set(rect);
                    },
                    move |rect, _, _, cx| {
                        if rect.size.width > px(0.0) && rect.size.height > px(0.0) {
                            super::diagnostics::content_frame_painted(
                                &session_id,
                                rows,
                                content_ready,
                                composer_ready,
                                pane_focused,
                                || {
                                    app.as_ref()
                                        .and_then(|app| app.upgrade())
                                        .is_some_and(|app| {
                                            app.read(cx)
                                                .focused_agents_or_companion_shell_session_id()
                                                == Some(shell_session_id)
                                        })
                                },
                            );
                        }
                    },
                )
                .absolute()
                .size_full(),
            )
    }
}
