use super::appearance::ChatAppearance;
use gpui::{Hsla, px, rgb};
use gpui_component::text::InlineLink;
use serde::Deserialize;
use serde_json::Value;
use std::{collections::HashMap, sync::LazyLock};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceVisual {
    gap: f32,
    icon_em: f32,
    dark_white_mix: f32,
    colors: HashMap<String, String>,
    web: WebVisual,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebVisual {
    light_color: String,
    dark_color: String,
    gap_em: f32,
}

static VISUAL: LazyLock<ReferenceVisual> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../../../../packages/shared/session-chat-presentation/reference-visual.json"
    ))
    .expect("shared reference appearance")
});

pub(super) fn presentations(
    references: &Value,
    appearance: &ChatAppearance,
) -> HashMap<(String, String), InlineLink> {
    references
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|reference| {
            let kind = reference["kind"].as_str()?;
            let color = if kind == "url" {
                if appearance.light {
                    &VISUAL.web.light_color
                } else {
                    &VISUAL.web.dark_color
                }
            } else {
                VISUAL.colors.get(kind)?
            };
            let color = u32::from_str_radix(color.trim_start_matches('#'), 16).ok()?;
            let mix = if appearance.light {
                0.0
            } else {
                VISUAL.dark_white_mix
            };
            let channel = |shift: u32| {
                (((color >> shift) & 255u32) as f32 * (1.0 - mix) + 255.0 * mix).round() as u32
            };
            let color: Hsla = rgb(channel(16) << 16 | channel(8) << 8 | channel(0)).into();
            Some((
                (
                    reference["href"].as_str()?.to_owned(),
                    reference["sourceLabel"].as_str()?.to_owned(),
                ),
                InlineLink {
                    label: reference["label"].as_str()?.to_owned().into(),
                    title: reference["title"].as_str()?.to_owned().into(),
                    icon: format!("chat-references/{kind}.svg").into(),
                    icon_size: px(14.0 * appearance.scale * VISUAL.icon_em),
                    gap: px(if kind == "url" {
                        14.0 * VISUAL.web.gap_em
                    } else {
                        VISUAL.gap
                    } * appearance.scale),
                    color,
                },
            ))
        })
        .collect()
}
