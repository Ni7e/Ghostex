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
use super::widgets::{CARD_RADIUS, LANE_RADIUS};
use crate::GhostexGpuiApp;
use crate::app::helpers::{
    ThrottledAnimationExt as _, gpui_macos_reduce_motion_enabled, titlebar_svg_icon,
};

/// Title lines of each skeleton card, per lane, so the lanes don't fill in lockstep.
const SKELETON_LANES: [&[u8]; 4] = [&[3, 2, 1, 2, 1], &[1, 2, 3, 1], &[2, 1], &[1, 2, 1, 2]];

/// The first load's placeholder cards: the card's shell holding an id, title lines and the
/// creator line in place of text, pulsing with the shared skeleton pulse.
fn skeleton_cards(position: usize, p: &KanbanPalette) -> AnyElement {
    let bar = p.foreground.opacity(if p.glass { 0.08 } else { 0.07 });
    let text = move |width: gpui::DefiniteLength, height: f32| {
        div().w(width).h(px(height)).rounded_full().bg(bar)
    };
    let cards = div().flex().flex_col().gap(px(8.0)).children(
        SKELETON_LANES[position % SKELETON_LANES.len()]
            .iter()
            .enumerate()
            .map(|(index, lines)| {
                div()
                    .w_full()
                    .flex()
                    .flex_col()
                    .gap(px(10.0))
                    .p(px(12.0))
                    .rounded(px(CARD_RADIUS))
                    .bg(p.card)
                    .border_1()
                    .border_color(p.border)
                    .child(text(px(52.0).into(), 7.0))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(8.0))
                            .children((0..*lines).map(|line| {
                                let last = line + 1 == *lines;
                                let width = if last && *lines > 1 {
                                    0.45 + (index % 3) as f32 * 0.1
                                } else {
                                    0.9 - (index % 2) as f32 * 0.08
                                };
                                text(gpui::relative(width), 10.0)
                            })),
                    )
                    .child(text(px(128.0).into(), 7.0))
            }),
    );
    if gpui_macos_reduce_motion_enabled() {
        return cards.into_any_element();
    }
    let (period, min) = crate::app::session_chat_skeleton::skeleton_pulse();
    cards
        .with_throttled_animation(
            ElementId::Name(format!("kanban-skeleton-pulse-{position}").into()),
            period,
            move |cards, frame| {
                let dip = 1.0 - (frame * std::f32::consts::TAU).cos();
                cards.opacity(1.0 - (1.0 - min) * dip * 0.5)
            },
        )
        .into_any_element()
}

impl GhostexGpuiApp {
    pub(crate) fn render_native_kanban_lane(
        &self,
        column: &BoardColumn,
        tickets: &[&BoardTicket],
        empty_hint: Option<&'static str>,
        skeleton: Option<usize>,
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
                            .when(skeleton.is_none(), |this| {
                                this.child(
                                    div()
                                        .text_size(px(12.0))
                                        .text_color(p.muted)
                                        .child(tickets.len().to_string()),
                                )
                            })
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
                            .children(skeleton.map(|position| skeleton_cards(position, p)))
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
