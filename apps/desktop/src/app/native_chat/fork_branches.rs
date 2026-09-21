//! The chat's fork branch switcher, GPUI's half of
//! `packages/core-ui/chat/session-chat-fork-branch-switcher.tsx`.
//!
//! CDXC:SessionFork 2026-09-18 SEE-ALSO:
//! The button renders what `NativeForkBranches` projects
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
    StatefulInteractiveElement as _, Styled as _, canvas, div, px, svg,
};
use std::{cell::Cell, rc::Rc};

/// The button's toggle key in `menu_toggle.rs`.
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
    /// The fork switcher, or nothing at all when this session has no family: an unforked
    /// conversation shows no button.
    ///
    /// CDXC:SessionFork 2026-09-21 DECISION:
    /// User: a forked session shows a small button in the top right of the chat view, not a bar of
    /// its own. It is placed absolutely against the region the conversation occupies, so it costs
    /// the transcript no row and never pushes the rows down, and it starts below whatever chrome is
    /// above that region (the error banner, the "load earlier turns" row, the search bar) instead
    /// of over it. It carries the chat's own surface and a hairline because it floats over text.
    /// This supersedes the thin right-aligned strip the switcher used to own above the transcript.
    pub(super) fn render_fork_branch_badge(
        &mut self,
        p: &ChatAppearance,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let branches = &self.snapshot["forkBranches"];
        let count = branches["count"].as_u64()?;
        let tooltip = branches["tooltip"].as_str().unwrap_or_default().to_owned();
        let s = p.scale;
        let bounds = Rc::new(Cell::new(gpui::Bounds::default()));
        let measured = bounds.clone();
        let label = tooltip.clone();
        Some(
            div()
                .id("chat-fork-branches")
                .absolute()
                // Clear of the transcript's own 5px scrollbar column at the pane's right edge.
                .top(px(6.0 * s))
                .right(px(10.0 * s))
                .role(gpui::Role::Button)
                .aria_label(label)
                .chat_cursor_pointer()
                .h(px(24.0 * s))
                .px(px(6.0 * s))
                .flex()
                .items_center()
                .gap(px(4.0 * s))
                .rounded(px(6.0 * s))
                .border_1()
                .border_color(p.control_border)
                .bg(p.background)
                .text_size(px(11.0 * s))
                .text_color(p.muted)
                .when(self.chat_menu_is_open(FORK_BRANCHES_TRIGGER), |this| {
                    this.bg(p.border)
                })
                .hover(|style| style.bg(p.border))
                .tooltip(move |window, cx| {
                    gpui_component::tooltip::Tooltip::new(tooltip.clone()).build(window, cx)
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
                    if rows.is_empty() || chat.chat_menu_toggled_shut(FORK_BRANCHES_TRIGGER, cx) {
                        return;
                    }
                    chat.show_chat_menu(rows, bounds.get(), 288.0, window, cx);
                }))
                .child(
                    canvas(move |rect, _, _| measured.set(rect), |_, _, _, _| {})
                        .absolute()
                        .size_full(),
                )
                .into_any_element(),
        )
    }
}
