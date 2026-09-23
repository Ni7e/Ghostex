//! The board notice above the lanes (`ProjectBoardNotice`): why Beads could not answer, with a fix
//! prompt to hand an agent and, where one applies, the Beads guide.

use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, ClipboardItem, Context, IntoElement, ParentElement as _,
    StatefulInteractiveElement as _, Styled as _, div, px,
};

use super::palette::KanbanPalette;
use super::text::board_notice;
use super::widgets::{KanbanButtonKind, kanban_button};
use crate::GhostexGpuiApp;
use crate::app::helpers::titlebar_svg_icon;

impl GhostexGpuiApp {
    pub(crate) fn render_native_kanban_notice(
        &self,
        p: &KanbanPalette,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let message = self.native_kanban.error.as_ref()?;
        let project_path = self
            .native_kanban
            .project
            .as_ref()
            .map(|project| project.project_path.clone())
            .unwrap_or_default();
        let notice = board_notice(message, &project_path);
        let prompt = notice.fix_prompt.clone();
        Some(
            div()
                .flex()
                .flex_none()
                .gap(px(10.0))
                .p(px(12.0))
                .rounded(px(10.0))
                .bg(p.panel)
                .border_1()
                .border_color(p.border)
                .child(div().flex_none().pt(px(1.0)).child(titlebar_svg_icon(
                    "titlebar/alert-triangle.svg",
                    16.0,
                    gpui::rgb(0xfbbf24).into(),
                )))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(4.0))
                        .min_w_0()
                        .flex_1()
                        .child(
                            div()
                                .text_size(px(13.0))
                                .text_color(p.foreground)
                                .child(notice.title.clone()),
                        )
                        .children(notice.lines.iter().map(|line| {
                            div()
                                .text_size(px(12.0))
                                .line_height(px(18.0))
                                .text_color(p.muted)
                                .child(line.clone())
                        }))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(8.0))
                                .mt(px(6.0))
                                .child(
                                    kanban_button(
                                        "kanban-notice-copy",
                                        Some("titlebar/copy.svg"),
                                        Some("Copy fix prompt".into()),
                                        KanbanButtonKind::Secondary,
                                        false,
                                        p,
                                    )
                                    .on_click(cx.listener(
                                        move |_, _, _, cx| {
                                            cx.write_to_clipboard(ClipboardItem::new_string(
                                                prompt.clone(),
                                            ));
                                        },
                                    )),
                                )
                                .when_some(notice.link.clone(), |this, (label, url)| {
                                    this.child(
                                        kanban_button(
                                            "kanban-notice-link",
                                            Some("titlebar/external-link.svg"),
                                            Some(label.into()),
                                            KanbanButtonKind::Ghost,
                                            false,
                                            p,
                                        )
                                        .on_click(move |_, _, cx| cx.open_url(&url)),
                                    )
                                }),
                        ),
                )
                .into_any_element(),
        )
    }
}
