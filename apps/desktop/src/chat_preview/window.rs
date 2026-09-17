use crate::app::model::TerminalSessionId;
use crate::app::native_chat::state::{NativeChatConfig, NativeChatView};
use gpui::{
    App, AppContext, Context, Entity, IntoElement, ParentElement, Render, Styled, Window,
    WindowBounds, WindowOptions, div, px, size,
};
use serde_json::Value;
use std::{path::PathBuf, time::Duration};

pub(super) fn open(path: PathBuf, cx: &mut App) {
    let bounds = gpui::Bounds::centered(None, size(px(1440.0), px(850.0)), cx);
    cx.open_window(
        WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(bounds)),
            titlebar: Some(gpui::TitlebarOptions {
                title: Some("Ghostex Chat Lab · GPUI / React".into()),
                ..Default::default()
            }),
            focus: false,
            ..Default::default()
        },
        |window, cx| {
            let view = cx.new(|cx| PreviewWindow::new(path, window, cx));
            cx.new(|cx| gpui_component::Root::new(view, window, cx))
        },
    )
    .expect("open chat preview");
}

pub(super) struct PreviewWindow {
    pub(super) path: PathBuf,
    pub(super) config: Value,
    chat: Entity<NativeChatView>,
    reference: Option<Entity<crate::CefSurface>>,
    pub(super) error: Option<String>,
    _watch: gpui::Task<()>,
}
impl PreviewWindow {
    pub(super) fn apply_config(
        &mut self,
        config: Value,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.chat.update(cx, |chat, cx| chat.close_maximized(cx));
        self.chat = Self::chat(&config, window, cx);
        self.config = config;
        cx.notify();
    }
    fn chat(config: &Value, window: &mut Window, cx: &mut Context<Self>) -> Entity<NativeChatView> {
        gpui_component::Theme::change(
            if config["theme"] == "light" {
                gpui_component::ThemeMode::Light
            } else {
                gpui_component::ThemeMode::Dark
            },
            Some(window),
            cx,
        );
        let native = NativeChatConfig {
            project_id: "preview".into(),
            session_id: "preview".into(),
            sidebar_session_id: "preview".into(),
            shell_session_id: TerminalSessionId(1),
            client_id: "preview".into(),
            remote: None,
            app: None,
            parent_native_view: crate::app::helpers::cef_parent_native_view(window)
                .unwrap_or(std::ptr::null_mut()),
            initial_snapshot: None,
            initial_presentation: None,
            preview: Some(config.clone()),
        };
        cx.new(|cx| NativeChatView::new(native, cx))
    }
    fn new(path: PathBuf, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let config: Value =
            serde_json::from_slice(&std::fs::read(&path).expect("read preview state"))
                .expect("preview state JSON");
        let chat = Self::chat(&config, window, cx);
        let watch = cx.spawn_in(window, async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(Duration::from_millis(300))
                    .await;
                if this
                    .update_in(cx, |this, window, cx| {
                        if this.reference.is_none() && crate::cef::context_initialized() {
                            match super::reference::create(window, cx) {
                                Ok(reference) => {
                                    this.reference = Some(reference);
                                    this.error = None;
                                }
                                Err(error) => this.error = Some(error),
                            }
                            cx.notify();
                        }
                        let Some(config) = std::fs::read(&this.path)
                            .ok()
                            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                        else {
                            return;
                        };
                        if config != this.config {
                            this.apply_config(config, window, cx);
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        });
        Self {
            path,
            config,
            chat,
            reference: None,
            error: None,
            _watch: watch,
        }
    }
}
impl Render for PreviewWindow {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let light = self.config["theme"] == "light";
        let pane = || {
            div()
                .flex_1()
                .min_w_0()
                .min_h_0()
                .h_full()
                .flex()
                .flex_col()
                .overflow_hidden()
        };
        let label = |text: &str| {
            div()
                .h(px(30.0))
                .flex_shrink_0()
                .px_3()
                .flex()
                .items_center()
                .text_size(px(12.0))
                .border_b_1()
                .border_color(gpui::rgb(0x444444))
                .child(text.to_owned())
        };
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(gpui::rgb(if light { 0xfcfcfc } else { 0x0d0d0d }))
            .text_color(gpui::rgb(if light { 0x3f3f46 } else { 0xfcfcfc }))
            .child(self.controls(cx))
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .flex()
                    .w_full()
                    .child(
                        pane()
                            .child(label("GPUI"))
                            .child(div().flex_1().min_h_0().child(self.chat.clone())),
                    )
                    .child(
                        div()
                            .w(px(1.0))
                            .h_full()
                            .flex_shrink_0()
                            .bg(gpui::rgb(0x444444)),
                    )
                    .child(pane().child(label("React")).child(
                        if let Some(reference) = &self.reference {
                            div()
                                .relative()
                                .flex_1()
                                .min_h_0()
                                .child(reference.clone())
                                .into_any_element()
                        } else {
                            div()
                                .p_4()
                                .child(
                                    self.error
                                        .clone()
                                        .unwrap_or_else(|| "Loading React reference…".into()),
                                )
                                .into_any_element()
                        },
                    )),
            )
    }
}
