use super::{
    controls::{button, footer},
    style::{accent, mix, number, shadow, text, tile_background},
    window::ModelPickerWindow,
};
use crate::app::native_chat::cursor::ChatCursor as _;
use gpui::{
    AnyElement, Context, InteractiveElement, IntoElement, ParentElement, Render,
    StatefulInteractiveElement, Styled, Window, div, px, rgb, svg,
};
use serde_json::{Value, json};

fn arrow(
    state: &Value,
    id: &str,
    control: &str,
    label: &str,
    asset: &str,
    enabled: bool,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    scale: f32,
    cx: &mut Context<ModelPickerWindow>,
) -> AnyElement {
    button(
        id.into(),
        label.into(),
        enabled && state["closing"] != true,
        json!({"type":"modelPickerControl","control":control}),
        cx,
    )
    .absolute()
    .left(px(x - width * scale / 2.0))
    .top(px(y - height * scale / 2.0))
    .w(px(width * scale))
    .h(px(height * scale))
    .flex()
    .items_center()
    .justify_center()
    .text_color(rgb(0xc3c6d6))
    .opacity(if enabled { 1.0 } else { 0.4 })
    .child(
        svg()
            .path(format!("titlebar/{asset}.svg"))
            .text_color(rgb(0xc3c6d6))
            .size(px(15.0 * scale)),
    )
    .into_any_element()
}

fn tile(
    state: &Value,
    entry: &Value,
    model: bool,
    center_x: f32,
    y: f32,
    scale: f32,
    cx: &mut Context<ModelPickerWindow>,
) -> AnyElement {
    let selected = entry["selected"] == true;
    let available = model || entry["available"] == true;
    let enabled = available && state["closing"] != true;
    let width = if model && selected { 136.0 } else { 120.0 };
    let height = if model {
        if selected { 126.0 } else { 110.0 }
    } else {
        100.0
    };
    let color = accent(state);
    let label = text(entry, "label");
    let index = entry["index"].as_u64().unwrap_or_default();
    let action = if model {
        "modelPickerModel"
    } else {
        "modelPickerEffort"
    };
    let mut card = div().id(format!("picker-{}-{index}",if model {"model"} else {"effort"}))
        .role(gpui::Role::CheckBox).aria_toggled(if selected {gpui::Toggled::True} else {gpui::Toggled::False}).aria_label(format!("{} {label}",if model {"Model"} else {"Effort"}))
        .absolute().left(px(center_x-width*scale/2.0)).top(px(y-height*scale/2.0)).w(px(width*scale)).h(px(height*scale))
        .rounded(px(18.0*scale)).border(px(if selected {2.0} else {1.0}*scale))
        .border_color(if !available { rgb(0x15161a).into() } else if selected { color } else { gpui::rgba(0x71717b70).into() })
        .bg(tile_background(color,selected,available)).flex().flex_col().items_center().justify_center()
        .gap(px(if model && selected {6.0} else if model {9.0} else {8.0}*scale))
        .p(px(10.0*scale)).text_size(px(15.0*scale)).line_height(px(18.0*scale)).font_weight(gpui::FontWeight::MEDIUM)
        .text_color(rgb(if available {0xe8e9ef} else {0x3e4048}))
        .on_mouse_down(gpui::MouseButton::Left, |_,_,cx| cx.stop_propagation())
        .on_click(cx.listener(move |view,event: &gpui::ClickEvent,_,cx| {
            if enabled { view.chat.update(cx, |chat,cx| chat.invoke(json!({"type":action,"index":index,"save":event.click_count()==2,"pointer":true}),cx)); }
        }));
    if available {
        card = card
            .chat_cursor_pointer()
            .shadow(vec![shadow(
                if selected {
                    color.opacity(0.2)
                } else {
                    gpui::black().opacity(0.33)
                },
                if selected { 24.0 } else { 24.0 },
                if selected { 0.0 } else { 8.0 },
                scale,
            )])
            .hover(move |style| {
                style
                    .border_color(mix(color, gpui::white(), 0.7))
                    .bg(gpui::linear_gradient(
                        145.0,
                        gpui::linear_color_stop(rgb(0x282b33), 0.0),
                        gpui::linear_color_stop(rgb(0x181a21), 1.0),
                    ))
            });
    }
    let icon_color = if !available {
        rgb(0x3e4048).into()
    } else if selected {
        mix(color, gpui::white(), if model { 0.45 } else { 0.4 })
    } else {
        rgb(if model { 0xe0e2ec } else { 0xb9bdcd }).into()
    };
    card = card.child(
        svg()
            .path(format!("model-picker/{}", text(entry, "artwork")))
            .size(px(38.0 * scale))
            .text_color(icon_color),
    );
    let mut name = div()
        .flex()
        .flex_col()
        .items_center()
        .text_center()
        .gap(px(scale));
    if let Some(version) = entry["version"].as_str() {
        name = name.child(
            div()
                .text_size(px(11.0 * scale))
                .line_height(px(13.2 * scale))
                .font_weight(gpui::FontWeight::NORMAL)
                .text_color(rgb(0xa6a9b7))
                .child(version.to_owned()),
        );
    }
    card = card.child(name.child(label));
    if let Some(effort) = state["effortLabel"]
        .as_str()
        .filter(|_| model && selected && state["narrow"] == true)
    {
        card = card.child(
            div()
                .text_center()
                .text_color(mix(color, gpui::white(), 0.6))
                .child(effort.to_owned()),
        );
    }
    card.into_any_element()
}

impl Render for ModelPickerWindow {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let appearance =
            super::super::appearance::ChatAppearance::current(&self.chat.read(cx).snapshot);
        let zoom = appearance.scale;
        let size = window.viewport_size();
        let dimensions = (size.width.as_f32() / zoom, size.height.as_f32() / zoom);
        if self.last_size != Some(dimensions) {
            self.last_size = Some(dimensions);
            let chat = self.chat.clone();
            cx.defer(move |cx| chat.update(cx, |chat,cx| chat.invoke(json!({"type":"modelPickerMeasure","size":{"width":dimensions.0,"height":dimensions.1}}),cx)));
        }
        let snapshot = self.chat.read(cx).snapshot.clone();
        let state = &snapshot["modelPicker"];
        let scale = number(state, "scale") * zoom;
        let center_x = size.width.as_f32() / 2.0;
        let center_y = number(state, "centerY") * scale;
        let viewport_height = number(state, "viewportHeight") * zoom;
        let mut stage = div()
            .relative()
            .w_full()
            .h(px(viewport_height))
            .overflow_hidden();
        if state["short"] != true {
            let first = state["models"]
                .as_array()
                .and_then(|entries| entries.first())
                .map(|entry| number(entry, "y"))
                .unwrap_or_default()
                * scale;
            let last = state["models"]
                .as_array()
                .and_then(|entries| entries.last())
                .map(|entry| number(entry, "y"))
                .unwrap_or_default()
                * scale;
            stage = stage.child(
                div()
                    .absolute()
                    .left(px(center_x))
                    .top(px(first))
                    .w(px(1.0))
                    .h(px((last - first).max(0.0)))
                    .bg(gpui::rgba(0x72778750)),
            );
        }
        if state["narrow"] != true
            && state["efforts"]
                .as_array()
                .is_some_and(|entries| !entries.is_empty())
        {
            let width = (number(state, "stageWidth") - 180.0) * scale;
            stage = stage.child(
                div()
                    .absolute()
                    .left(px(center_x - width / 2.0))
                    .top(px(center_y))
                    .w(px(width))
                    .h(px(1.0))
                    .bg(gpui::rgba(0x858b9870)),
            );
            for entry in state["efforts"].as_array().into_iter().flatten() {
                stage = stage.child(tile(
                    state,
                    entry,
                    false,
                    center_x + number(entry, "x") * scale,
                    center_y,
                    scale,
                    cx,
                ));
            }
        }
        for entry in state["models"].as_array().into_iter().flatten() {
            stage = stage.child(tile(
                state,
                entry,
                true,
                center_x,
                number(entry, "y") * scale,
                scale,
                cx,
            ));
        }
        stage = stage
            .child(arrow(
                state,
                "picker-model-up",
                "ArrowUp",
                "Move up one model",
                "chevron-up",
                state["canUp"] == true,
                center_x,
                center_y - 77.0 * scale,
                24.0,
                18.0,
                scale,
                cx,
            ))
            .child(arrow(
                state,
                "picker-model-down",
                "ArrowDown",
                "Move down one model",
                "chevron-down",
                state["canDown"] == true,
                center_x,
                center_y + 77.0 * scale,
                24.0,
                18.0,
                scale,
                cx,
            ));
        let distance = if state["narrow"] == true {
            104.0
        } else {
            number(state, "stageWidth") / 2.0 - 70.0
        };
        stage = stage
            .child(arrow(
                state,
                "picker-effort-left",
                "ArrowLeft",
                "Decrease effort",
                "chevron-left",
                state["canLeft"] == true,
                center_x - distance * scale,
                center_y,
                32.0,
                44.0,
                scale,
                cx,
            ))
            .child(arrow(
                state,
                "picker-effort-right",
                "ArrowRight",
                "Increase effort",
                "chevron-right",
                state["canRight"] == true,
                center_x + distance * scale,
                center_y,
                32.0,
                44.0,
                scale,
                cx,
            ));
        let color = accent(state);
        let agent = div()
            .absolute()
            .top(px(24.0 * zoom))
            .left(px(24.0 * zoom))
            .flex()
            .items_center()
            .gap(px(13.0 * zoom))
            .text_size(px(16.9 * zoom))
            .font_weight(gpui::FontWeight::SEMIBOLD)
            .text_color(rgb(0xe0e2ec))
            .child(
                div()
                    .size(px(44.2 * zoom))
                    .rounded(px(14.3 * zoom))
                    .border_1()
                    .border_color(color.opacity(0.28))
                    .bg(tile_background(color, true, true))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(
                        svg()
                            .path(format!("agent-icons/{}.svg", text(&state["agent"], "icon")))
                            .size(px(26.0 * zoom))
                            .text_color(mix(color, gpui::white(), 0.6)),
                    ),
            )
            .child(text(&state["agent"], "name"));
        div().relative().size_full().overflow_hidden().track_focus(&self.focus).font_family(appearance.font)
            .bg(gpui::rgba(0x030407d9)).text_color(rgb(0xf4f4f7))
            .on_mouse_down(gpui::MouseButton::Left,cx.listener(|view,_,_,cx| view.chat.update(cx,|chat,cx| chat.invoke(json!({"type":"modelPickerCancel"}),cx))))
            .on_key_down(cx.listener(|view,event: &gpui::KeyDownEvent,window,cx| {
                let key = &event.keystroke;
                let name = match key.key.as_str() {"up"=>"ArrowUp","down"=>"ArrowDown","left"=>"ArrowLeft","right"=>"ArrowRight","enter"=>"Enter","escape"=>"Escape",name=>name};
                if !key.modifiers.alt && !key.modifiers.control && !key.modifiers.platform && matches!(name,"ArrowUp"|"ArrowDown"|"ArrowLeft"|"ArrowRight"|"Enter"|"Escape"|"h"|"j"|"k"|"l"|","|".") {
                    view.chat.update(cx,|chat,cx| chat.invoke(json!({"type":"modelPickerKey","key":{"key":name,"code":key.key,"shiftKey":key.modifiers.shift}}),cx));
                    cx.stop_propagation(); window.prevent_default();
                }
            }))
            .on_key_up(cx.listener(|view,event: &gpui::KeyUpEvent,_,cx| {
                view.chat.update(cx,|chat,cx| chat.invoke(json!({"type":"modelPickerKeyUp","key":event.keystroke.key}),cx));
            }))
            .on_action(cx.listener(|view,action: &crate::app::hotkeys::RunConfiguredGhostexHotkey,_,cx| {
                if action.action_id == "openModelPicker" { view.chat.update(cx,|chat,cx| chat.invoke(json!({"type":"modelPickerCancel"}),cx)); }
            }))
            .on_scroll_wheel(cx.listener(|view,event: &gpui::ScrollWheelEvent,_,cx| {
                let delta = event.delta.pixel_delta(px(20.0));
                let height = view.last_size.map(|size|size.1).unwrap_or_default();
                view.chat.update(cx,|chat,cx| chat.invoke(json!({"type":"modelPickerScroll","input":{"deltaX":-delta.x.as_f32(),"deltaY":-delta.y.as_f32(),"height":height,"shiftKey":event.modifiers.shift,"ctrlKey":event.modifiers.control,"metaKey":event.modifiers.platform,"now":view.started.elapsed().as_millis() as u64}}),cx));
                cx.stop_propagation();
            }))
            .child(stage).child(agent).child(footer(state,zoom,cx))
    }
}
