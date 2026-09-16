use super::{appearance::SidebarAppearance, model::NativeSidebarGroup};
use crate::app::helpers::chrome_color;
use gpui::prelude::FluentBuilder;
use gpui::{AnyElement, IntoElement, ParentElement, Styled, div, px, rgb};
use gpui_component::h_flex;
use serde_json::Value;

pub(crate) fn project_status(
    group: &NativeSidebarGroup,
    hud: &Value,
    appearance: &SidebarAppearance,
) -> Option<AnyElement> {
    let scale = appearance.scale;
    let count = |key: &str| group.summary[key].as_u64().unwrap_or_default();
    let working = count("workingCount");
    let attention = count("attentionCount");
    let awake = count("awakeCount");
    if group.collapsed && (working > 0 || attention > 0 || awake > 0) {
        let count_badge = |count: u64, color, dot: bool| {
            h_flex()
                .gap(px(3.0 * scale))
                .when(dot, |row| {
                    row.child(div().size(px(6.0 * scale)).rounded_full().bg(color))
                })
                .child(count.to_string())
        };
        return Some(
            h_flex()
                .gap(px(7.0 * scale))
                .text_size(px(10.0 * scale))
                .text_color(appearance.foreground)
                .when(working > 0, |row| {
                    row.child(count_badge(working, rgb(0xffb454), true))
                })
                .when(attention > 0, |row| {
                    row.child(count_badge(attention, rgb(0x95d7f6), true))
                })
                .when(working == 0 && attention == 0 && awake > 0, |row| {
                    row.child(count_badge(awake, rgb(0xaaaaaa), false))
                })
                .into_any_element(),
        );
    }
    if hud["settings"]["hideProjectHeaderDiffStats"] == true {
        return None;
    }
    let stats = group
        .project_context
        .as_ref()?
        .get("editor")?
        .get("diffStats")?;
    let additions = stats["additions"].as_u64().unwrap_or_default().min(9999);
    let deletions = stats["deletions"].as_u64().unwrap_or_default().min(9999);
    if additions == 0 && deletions == 0 {
        return None;
    }
    Some(
        h_flex()
            .gap(px(8.0 * scale))
            .text_size(px(13.55 * scale))
            .opacity(0.32)
            .when(
                hud["settings"]["showProjectEditorDiffFileCount"] == true,
                |row| {
                    row.child(
                        div().text_color(chrome_color(0xb4b8c0, 0x0969da)).child(
                            stats["files"]
                                .as_u64()
                                .unwrap_or_default()
                                .min(99)
                                .to_string(),
                        ),
                    )
                },
            )
            .child(
                div()
                    .text_color(chrome_color(0x9bbf8d, 0x1a7f37))
                    .child(format!("+{additions}")),
            )
            .child(
                div()
                    .text_color(chrome_color(0xc58b8b, 0xcf222e))
                    .child(format!("-{deletions}")),
            )
            .into_any_element(),
    )
}
