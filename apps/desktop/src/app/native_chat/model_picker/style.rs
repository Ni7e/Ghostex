use gpui::{Background, BoxShadow, Hsla, Point, linear_color_stop, linear_gradient, px, rgb};
use serde_json::Value;

pub(super) fn number(value: &Value, key: &str) -> f32 {
    value[key].as_f64().unwrap_or_default() as f32
}
pub(super) fn text(value: &Value, key: &str) -> String {
    value[key].as_str().unwrap_or_default().to_owned()
}
pub(super) fn accent(value: &Value) -> Hsla {
    rgb(match value["provider"].as_str() {
        Some("codex") => 0x0069cb,
        Some("claude") => 0xe85c35,
        _ => 0xffffff,
    })
    .into()
}
pub(super) fn mix(color: Hsla, base: Hsla, amount: f32) -> Hsla {
    let a: gpui::Rgba = color.into();
    let b: gpui::Rgba = base.into();
    gpui::Rgba {
        r: a.r * amount + b.r * (1.0 - amount),
        g: a.g * amount + b.g * (1.0 - amount),
        b: a.b * amount + b.b * (1.0 - amount),
        a: a.a * amount + b.a * (1.0 - amount),
    }
    .into()
}
pub(super) fn tile_background(accent: Hsla, selected: bool, available: bool) -> Background {
    let from = if !available {
        rgb(0x0a0b0d).into()
    } else if selected {
        mix(accent, rgb(0x23252d).into(), 0.1)
    } else {
        rgb(0x1b1c1f).into()
    };
    let to = rgb(if !available {
        0x08090b
    } else if selected {
        0x12151d
    } else {
        0x0e0f12
    });
    linear_gradient(
        145.0,
        linear_color_stop(from, 0.0),
        linear_color_stop(to, 0.9),
    )
}
pub(super) fn shadow(color: Hsla, blur: f32, y: f32, scale: f32) -> BoxShadow {
    BoxShadow {
        inset: false,
        color,
        offset: Point::new(px(0.0), px(y * scale)),
        blur_radius: px(blur * scale),
        spread_radius: px(0.0),
    }
}
