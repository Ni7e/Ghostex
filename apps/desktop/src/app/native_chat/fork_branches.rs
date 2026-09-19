//! The chat's fork branch switcher, GPUI's half of
//! `packages/core-ui/chat/session-chat-fork-branch-switcher.tsx`.
//!
//! CDXC:SessionFork 2026-09-18 SEE-ALSO:
//! The strip renders what `NativeForkBranches` projects
//! (`packages/shared/session-chat-controller/native-fork-branches.ts`) from the shared copy and row
//! rules in `packages/shared/session-chat-presentation/fork-branches.ts`; the same projection feeds
//! the React switcher, so neither renderer decides what a row says. The pick travels back as the
//! `selectForkBranch` host action, handled in
//! `apps/desktop/src/app/session_chat_fork_branches.rs`.

use super::{appearance::ChatAppearance, state::NativeChatView};
use crate::app::native_chat::cursor::ChatCursor as _;
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, Context, Hsla, InteractiveElement as _, IntoElement, ParentElement as _,
    StatefulInteractiveElement as _, Styled as _, canvas, div, px, relative, svg,
};
use std::{cell::Cell, rc::Rc};

/// The strip's toggle key in `menu_toggle.rs`.
const FORK_BRANCHES_TRIGGER: &str = "chat-fork-branches";

/// The lifecycle dot's tint, the tones of `sessionChatForkBranchTone` in React's colours
/// (`bg-emerald-500`, `bg-muted-foreground/60`, `bg-muted-foreground/35`).
pub(super) fn branch_dot_color(tone: &str, appearance: &ChatAppearance) -> Hsla {
    match tone {
        "running" => gpui::rgb(0x10b981).into(),
        "sleeping" => appearance.muted.opacity(0.6),
        _ => appearance.muted.opacity(0.35),
    }
}

impl NativeChatView {
    /// The thin right-aligned strip above the transcript, or nothing at all when this session has
    /// no family: an unforked conversation shows no empty row.
    pub(super) fn render_fork_branch_strip(
        &mut self,
        p: &ChatAppearance,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let strip = &self.snapshot["forkBranches"];
        let count = strip["count"].as_u64()?;
        let tooltip = strip["tooltip"].as_str().unwrap_or_default().to_owned();
        let s = p.scale;
        let bounds = Rc::new(Cell::new(gpui::Bounds::default()));
        let measured = bounds.clone();
        let label = tooltip.clone();
        Some(
            div()
                .w_full()
                .flex_shrink_0()
                .flex()
                .justify_center()
                .child(
                    div()
                        .w_full()
                        .max_w(px(768.0 * s))
                        .px(px(16.0 * s))
                        .pt(px(4.0 * s))
                        .flex()
                        .justify_end()
                        .when_some(p.transcript_width, |this, width| {
                            this.max_w(relative(1.0)).w(relative(width))
                        })
                        .child(
                            div()
                                .id("chat-fork-branches")
                                .relative()
                                .role(gpui::Role::Button)
                                .aria_label(label)
                                .chat_cursor_pointer()
                                .h(px(24.0 * s))
                                .px(px(6.0 * s))
                                .flex()
                                .items_center()
                                .gap(px(4.0 * s))
                                .rounded(px(6.0 * s))
                                .text_size(px(11.0 * s))
                                .text_color(p.muted)
                                .when(self.chat_menu_is_open(FORK_BRANCHES_TRIGGER), |this| {
                                    this.bg(p.border)
                                })
                                .hover(|style| style.bg(p.border))
                                .tooltip(move |window, cx| {
                                    gpui_component::tooltip::Tooltip::new(tooltip.clone())
                                        .build(window, cx)
                                })
                                .child(
                                    svg()
                                        .path("titlebar/git-branch.svg")
                                        .size(px(14.0 * s))
                                        .flex_shrink_0()
                                        .text_color(p.muted),
                                )
                                .child(count.to_string())
                                .on_click(cx.listener(move |chat, _, window, cx| {
                                    let rows = chat.snapshot["forkBranches"]["menu"]
                                        .as_array()
                                        .cloned()
                                        .unwrap_or_default();
                                    if rows.is_empty()
                                        || chat.chat_menu_toggled_shut(FORK_BRANCHES_TRIGGER, cx)
                                    {
                                        return;
                                    }
                                    chat.show_chat_menu(rows, bounds.get(), 288.0, window, cx);
                                }))
                                .child(
                                    canvas(move |rect, _, _| measured.set(rect), |_, _, _, _| {})
                                        .absolute()
                                        .size_full(),
                                ),
                        ),
                )
                .into_any_element(),
        )
    }
}
