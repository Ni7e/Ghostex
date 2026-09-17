use crate::app::model::TerminalSessionId;
use crate::app::native_chat::state::{NativeChatConfig, NativeChatView};
use gpui::StatefulInteractiveElement as _;
use gpui::{
    App, AppContext, Context, Entity, InteractiveElement, IntoElement, ParentElement, Render,
    Styled, Window, WindowBounds, WindowOptions, div, px, size,
};
use serde_json::Value;
use std::{path::PathBuf, time::Duration};

pub(super) fn open(path: PathBuf, cx: &mut App) {
    let bounds = gpui::Bounds::centered(None, size(px(720.0), px(850.0)), cx);
    cx.open_window(
        WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(bounds)),
            titlebar: Some(gpui::TitlebarOptions {
                title: Some("Ghostex Chat Lab · GPUI".into()),
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

struct PreviewWindow {
    path: PathBuf,
    config: Value,
    chat: Entity<NativeChatView>,
    _watch: gpui::Task<()>,
}
impl PreviewWindow {
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
                        let Some(config) = std::fs::read(&this.path)
                            .ok()
                            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                        else {
                            return;
                        };
                        if config != this.config {
                            this.chat.update(cx, |chat, cx| {
                                chat.close_maximized(cx);
                            });
                            this.chat = Self::chat(&config, window, cx);
                            this.config = config;
                            cx.notify();
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
            _watch: watch,
        }
    }
}
impl Render for PreviewWindow {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let light = self.config["theme"] == "light";
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(gpui::rgb(if light { 0xfcfcfc } else { 0x0d0d0d }))
            .text_color(gpui::rgb(if light { 0x3f3f46 } else { 0xfcfcfc }))
            .child(
                div()
                    .flex_shrink_0()
                    .p_3()
                    .border_b_1()
                    .border_color(gpui::rgb(0x444444))
                    .text_size(px(12.0))
                    .child(format!(
                        "Chat Lab · GPUI    {} · {}%",
                        self.config["scenario"].as_str().unwrap_or(""),
                        self.config["zoom"]
                    ))
                    .child(
                        div()
                            .id("open-react-preview")
                            .cursor_pointer()
                            .mt_1()
                            .text_color(gpui::rgb(0x8ab4f8))
                            .child("Open React comparison and sample controls ↗")
                            .on_click(|_, _, cx| cx.open_url("http://127.0.0.1:5188")),
                    ),
            )
            .child(div().flex_1().min_h_0().child(self.chat.clone()))
    }
}
