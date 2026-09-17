use super::window::PreviewWindow;
use gpui::{
    Context, InteractiveElement, IntoElement, ParentElement, StatefulInteractiveElement, Styled,
    div, px, rgb,
};
use serde_json::{Value, json};

impl PreviewWindow {
    fn save(&mut self, key: &str, value: Value, window: &mut gpui::Window, cx: &mut Context<Self>) {
        let mut next = self.config.clone();
        if !key.is_empty() {
            next[key] = value;
        }
        next["revision"] = json!(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64
        );
        let temporary = self.path.with_extension("next.json");
        let result = std::fs::write(&temporary, serde_json::to_vec(&next).unwrap())
            .and_then(|_| std::fs::rename(&temporary, &self.path));
        match result {
            Ok(()) => {
                self.error = None;
                self.apply_config(next, window, cx);
            }
            Err(error) => self.error = Some(error.to_string()),
        }
        cx.notify();
    }
    pub(super) fn controls(&self, cx: &Context<Self>) -> impl IntoElement {
        let button =
            |label: String, key: &'static str, value: Value, selected: bool| {
                div()
                    .id(format!("preview-{key}-{label}"))
                    .role(gpui::Role::Button)
                    .aria_label(label.clone())
                    .px_2()
                    .py_1()
                    .rounded(px(5.0))
                    .border_1()
                    .border_color(rgb(0x555555))
                    .bg(rgb(if selected { 0x3c4960 } else { 0x252525 }))
                    .text_color(rgb(0xfafafa))
                    .cursor_pointer()
                    .child(label)
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.save(key, value.clone(), window, cx)
                    }))
            };
        let mut scenarios = div().flex().flex_wrap().gap_2();
        for name in [
            "conversation",
            "working",
            "compacting",
            "question",
            "queue",
            "empty",
        ] {
            scenarios = scenarios.child(button(
                name.into(),
                "scenario",
                json!(name),
                self.config["scenario"] == name,
            ));
        }
        div()
            .flex()
            .flex_col()
            .flex_shrink_0()
            .p_2()
            .gap_2()
            .text_size(px(12.0))
            .font_family("DM Sans")
            .child(scenarios)
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_2()
                    .child(button(
                        if self.config["theme"] == "light" {
                            "Light"
                        } else {
                            "Dark"
                        }
                        .into(),
                        "theme",
                        json!(if self.config["theme"] == "light" {
                            "dark"
                        } else {
                            "light"
                        }),
                        false,
                    ))
                    .child(button(
                        "Zoom −".into(),
                        "zoom",
                        json!((self.config["zoom"].as_i64().unwrap_or(100) - 15).max(70)),
                        false,
                    ))
                    .child(div().py_1().child(format!("{}%", self.config["zoom"])))
                    .child(button(
                        "Zoom +".into(),
                        "zoom",
                        json!((self.config["zoom"].as_i64().unwrap_or(100) + 15).min(200)),
                        false,
                    ))
                    .child(button(
                        "Verbose".into(),
                        "verbose",
                        json!(self.config["verbose"] != true),
                        self.config["verbose"] == true,
                    ))
                    .child(button(
                        "Simple".into(),
                        "simple",
                        json!(self.config["simple"] != true),
                        self.config["simple"] == true,
                    ))
                    .child(button("Reset both".into(), "", Value::Null, false))
                    .child(
                        div()
                            .py_1()
                            .child("Same sample and settings · independent simulated sends"),
                    ),
            )
    }
}
