use super::super::appearance::ChatAppearance;
use gpui::{App, TextRun, WindowTextSystem, px};
use serde_json::Value;

pub(super) fn measure_rows(
    rows: &[Value],
    width: f32,
    appearance: &ChatAppearance,
    cx: &App,
) -> anyhow::Result<Vec<f32>> {
    let scale = appearance.scale;
    let text_system = WindowTextSystem::new(cx.text_system().clone());
    let font = gpui::font(appearance.font.clone());
    let text_width = |text: &str| {
        let run = TextRun {
            len: text.len(),
            font: font.clone(),
            ..Default::default()
        };
        f32::from(
            text_system
                .shape_line(text.to_owned().into(), px(12.0 * scale), &[run], None)
                .width,
        ) / scale
    };
    rows.iter()
        .map(|row| {
            if row["context"].is_object() {
                return super::context::height(&row["context"], width, appearance, cx);
            }
            if row["accounts"].is_object() {
                return super::accounts::height(
                    &row["accounts"],
                    width,
                    row["customize"] == true,
                    appearance,
                    cx,
                );
            }
            if row["separator"] == true {
                return Ok(13.0);
            }
            let heading = row["heading"] == true;
            let accessory =
                if !heading && (row.get("checked").is_some() || row["children"].is_array()) {
                    22.0
                } else {
                    0.0
                };
            let icon = if row["icon"].is_string() || row["iconPath"].is_string() {
                22.0
            } else if row["dot"].is_string() {
                14.0
            } else {
                0.0
            };
            let detail = row["detail"]
                .as_str()
                .map(|text| text_width(text) + 8.0)
                .unwrap_or(0.0);
            let content_width = (width - 34.0 - accessory - icon - detail).max(1.0) * scale;
            let description_height = if let Some(description) = row["description"].as_str() {
                let run = TextRun {
                    len: description.len(),
                    font: font.clone(),
                    ..Default::default()
                };
                let lines = text_system.shape_text(
                    description.to_owned().into(),
                    px(if heading { 11.0 } else { 12.0 } * scale),
                    &[run],
                    Some(px(content_width)),
                    None,
                )?;
                lines
                    .iter()
                    // A row's subtitle is one truncated line (`render.rs`); only a heading wraps.
                    .take(if heading { usize::MAX } else { 1 })
                    .map(|line| f32::from(line.size(px(16.0 * scale)).height) / scale)
                    .sum::<f32>()
                    + 2.0
            } else {
                0.0
            };
            Ok(if heading {
                (18.2 + 6.0 + description_height).max(28.0)
            } else {
                18.2 + 16.0 + description_height
            })
        })
        .collect()
}
