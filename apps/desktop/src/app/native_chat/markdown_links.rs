use super::appearance::ChatAppearance;
use gpui::{Hsla, px, rgb};
use gpui_component::text::InlineLink;
use serde::Deserialize;
use serde_json::Value;
use std::{collections::HashMap, sync::LazyLock};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReferenceVisual {
    gap: f32,
    pub(super) icon_em: f32,
    dark_white_mix: f32,
    colors: HashMap<String, String>,
    composer_url: String,
    web: WebVisual,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebVisual {
    light_color: String,
    dark_color: String,
    gap_em: f32,
}

pub(super) static VISUAL: LazyLock<ReferenceVisual> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../../../../packages/shared/session-chat-presentation/reference-visual.json"
    ))
    .expect("shared reference appearance")
});

/// Blend a shared hex color the way the chat stylesheet does: raw in light mode, lightened toward
/// white in dark mode so a pill keeps its hue without going muddy on the dark surface.
fn blended(hex: &str, appearance: &ChatAppearance) -> Option<Hsla> {
    let color = u32::from_str_radix(hex.trim_start_matches('#'), 16).ok()?;
    let mix = if appearance.light {
        0.0
    } else {
        VISUAL.dark_white_mix
    };
    let channel = |shift: u32| {
        (((color >> shift) & 255u32) as f32 * (1.0 - mix) + 255.0 * mix).round() as u32
    };
    Some(rgb(channel(16) << 16 | channel(8) << 8 | channel(0)).into())
}

/// The color a reference pill uses inside an editable composer.
///
/// CDXC:SessionChat 2026-09-18 WHY:
/// A link inside the composer is dimmer than the same link in the transcript, which is why the
/// composer reads `composerUrl` instead of the transcript's `web` colors.
pub(super) fn composer_color(kind: &str, appearance: &ChatAppearance) -> Option<Hsla> {
    let hex = if kind == "url" {
        &VISUAL.composer_url
    } else {
        VISUAL.colors.get(kind)?
    };
    blended(hex, appearance)
}

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
            let color = blended(color, appearance)?;
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
