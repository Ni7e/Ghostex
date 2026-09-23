//! One status lane (`BoardLane`): its header with the count and a `+` that creates a ticket in
//! the lane, and its scrolling column of cards, which is also where a dragged card drops.

use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, Context, ElementId, InteractiveElement as _, IntoElement, ParentElement as _,
    StatefulInteractiveElement as _, Styled as _, div, px,
};

use super::card::KanbanCardDrag;
use super::model::{BoardColumn, BoardTicket, MAX_VISIBLE_TICKETS_PER_LANE};
use super::palette::KanbanPalette;
use super::widgets::LANE_RADIUS;
use crate::GhostexGpuiApp;
use crate::app::helpers::titlebar_svg_icon;

impl GhostexGpuiApp {
    pub(crate) fn render_native_kanban_lane(
        &self,
        column: &BoardColumn,
        tickets: &[&BoardTicket],
        empty_hint: Option<&'static str>,
        p: &KanbanPalette,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let key = column.key.clone();
        let add_key = column.key.clone();
        let lane_drop = p.lane_drop;
        let border_strong = p.border_strong;
        let control_hover = p.control_hover;
        let visible = tickets.len().min(MAX_VISIBLE_TICKETS_PER_LANE);
        let hidden = tickets.len() - visible;
        let cards = tickets[..visible]
            .iter()
            .map(|ticket| self.render_native_kanban_card(ticket, p, cx))
            .collect::<Vec<_>>();
        div()
            .id(ElementId::Name(format!("kanban-lane-{}", column.key).into()))
            .flex()
            .flex_col()
            .flex_1()
            .min_w(px(230.0))
            .h_full()
            .min_h_0()
            .rounded(px(LANE_RADIUS))
            .bg(p.lane)
            .border_1()
            .border_color(p.border)
            .drag_over::<KanbanCardDrag>(move |style, _, _, _| {
                style.bg(lane_drop).border_color(border_strong)
            })
            .on_drop(cx.listener(move |this, drag: &KanbanCardDrag, _, cx| {
                this.native_kanban_move_ticket(&drag.ticket_id, &key, cx);
            }))
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_between()
                    .h(px(42.0))
                    .pl(px(12.0))
                    .pr(px(6.0))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.0))
                            .min_w_0()
                            .child(
                                div()
                                    .size(px(6.0))
                                    .flex_none()
                                    .rounded_full()
                                    .bg(p.tone(column.tone)),
                            )
                            .child(
                                div()
                                    .truncate()
                                    .text_size(px(13.0))
                                    .text_color(p.foreground.opacity(0.9))
                                    .child(column.label.clone()),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(2.0))
                            .child(
                                div()
                                    .text_size(px(12.0))
                                    .text_color(p.muted)
                                    .child(tickets.len().to_string()),
                            )
                            .child(
                                div()
                                    .id(ElementId::Name(
                                        format!("kanban-lane-add-{}", column.key).into(),
                                    ))
                                    .size(px(26.0))
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .rounded(px(7.0))
                                    .cursor_pointer()
                                    .hover(move |style| style.bg(control_hover))
                                    .tooltip({
                                        let label = format!("Add ticket to {}", column.label);
                                        move |window, cx| {
                                            crate::app::helpers::titlebar_tooltip(
                                                label.clone(),
                                                window,
                                                cx,
                                            )
                                        }
                                    })
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        this.native_kanban_open_new_ticket(&add_key, window, cx);
                                    }))
                                    .child(titlebar_svg_icon("titlebar/plus.svg", 14.0, p.muted)),
                            ),
                    ),
            )
            .child(
                div()
                    .id(ElementId::Name(
                        format!("kanban-lane-scroll-{}", column.key).into(),
                    ))
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(8.0))
                            .px(px(10.0))
                            .pt(px(2.0))
                            .pb(px(10.0))
                            .children(cards)
                            .when_some(empty_hint, |this, hint| {
                                this.child(
                                    div()
                                        .px(px(4.0))
                                        .py(px(8.0))
                                        .text_size(px(12.0))
                                        .text_color(p.faint)
                                        .child(hint),
                                )
                            })
                            .when(hidden > 0, |this| {
                                this.child(
                                    div()
                                        .px(px(12.0))
                                        .py(px(10.0))
                                        .rounded(px(8.0))
                                        .border_1()
                                        .border_color(p.border)
                                        .text_size(px(12.0))
                                        .text_color(p.muted)
                                        .child(format!(
                                            "Showing {visible} of {}. Use search or filters to narrow this lane.",
                                            tickets.len()
                                        )),
                                )
                            }),
                    ),
            )
            .into_any_element()
    }
}
