use super::appearance::ChatAppearance;
use gpui::{FontWeight, StyleRefinement, Styled, px, relative, rems, rgb};
use gpui_component::text::{InlineCodeStyle, TextViewStyle};
use serde::Deserialize;
use std::sync::LazyLock;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownVisual {
    inline_code: InlineCodeVisual,
    paragraph_gap: f32,
    heading_line_height: f32,
    heading_font_sizes: [f32; 6],
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InlineCodeVisual {
    font_scale: f32,
    padding_x: f32,
    padding_y: f32,
    border_width: f32,
    radius: f32,
}

/// CDXC:SessionChat 2026-09-17 SEE-ALSO: Markdown typography and inline code metrics come from markdown-visual.json, also consumed by session-chat-markdown.tsx.
static VISUAL: LazyLock<MarkdownVisual> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../../../../packages/shared/session-chat-presentation/markdown-visual.json"
    ))
    .expect("shared Markdown appearance")
});

pub(super) fn text_style(p: &ChatAppearance) -> TextViewStyle {
    let mut style = TextViewStyle::default()
        .paragraph_gap(rems(VISUAL.paragraph_gap / 16.0 * p.scale))
        .heading_font_size(|level, base| {
            base * VISUAL.heading_font_sizes[(level.clamp(1, 6) - 1) as usize] / 14.0
        });
    style.heading_base_font_size = px(14.0 * p.scale);
    style.heading = StyleRefinement::default()
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(p.primary)
        .line_height(relative(VISUAL.heading_line_height))
        .pb(px(VISUAL.paragraph_gap * p.scale));
    style.inline_code = Some(inline_code(p));
    style
}

fn inline_code(p: &ChatAppearance) -> InlineCodeStyle {
    let visual = &VISUAL.inline_code;
    InlineCodeStyle {
        font_family: "Menlo".into(),
        font_scale: visual.font_scale,
        padding_x: px(visual.padding_x * p.scale),
        padding_y: px(visual.padding_y * p.scale),
        border_width: px(visual.border_width * p.scale),
        radius: px(visual.radius * p.scale),
        background: rgb(if p.light { 0xefeff0 } else { 0x272727 }).into(),
        border_color: p.foreground.opacity(if p.light { 0.16 } else { 0.18 }),
    }
}
