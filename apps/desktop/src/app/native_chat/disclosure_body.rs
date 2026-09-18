//! The body of an open disclosure: the vertical rail down its left and the
//! indent that hangs its content off that rail.
//!
//! React draws it with `SessionChatExpansion` (session-chat-expansion.tsx) and
//! the `.ghostex-chat-expansion*` rules in styles/chat.css: a two-pixel line in
//! `muted-foreground` at 42%, stretched over the whole body, with the content
//! starting a fixed distance to the right of it. Everything that opens onto
//! more rows uses it, so a reader can see at a glance which rows belong to the
//! heading they expanded: the turn's "Worked for Xs" log, a reasoning row's
//! detail and tool run, an expanded tool's arguments and result, and the
//! "+N previous tool calls" and "N tool calls" groups.

use super::appearance::ChatAppearance;
use gpui::{AnyElement, IntoElement, ParentElement as _, Styled as _, div, px};

/// Where the rail hangs, measured from the left edge of the row that owns it.
#[derive(Clone, Copy)]
pub(super) enum DisclosureRail {
    /// A body opened by a heading whose chevron sits in the transcript's marker
    /// column: the completed-work log, a reasoning row, a tool group's toggle.
    /// React's `.ghostex-chat-expansion` with no override.
    Marker,
    /// One tool row's own detail, indented past the tool rows around it.
    /// React's `.ghostex-chat-work-detail`.
    ToolDetail,
}

impl DisclosureRail {
    /// The centre of the two-pixel line. React reaches these two values through
    /// the marker-column tokens plus `.ghostex-chat-expansion`'s own negative
    /// inset, which `.ghostex-chat-work-detail` overrides and the other bodies
    /// do not; they are written out here because GPUI has no cascade to inherit
    /// them from.
    fn centre(self) -> f32 {
        match self {
            Self::Marker => 2.5,
            Self::ToolDetail => 15.0,
        }
    }
}

/// The distance from the rail's right edge to the first column of content, the
/// same on both rails: React's 15px rail box minus its 2px line, plus the
/// expansion's 7px gap.
const RAIL_TO_CONTENT: f32 = 13.5;

/// Wrap an open disclosure's rows in the rail that says they belong to the
/// heading above them. `gap` is the spacing between those rows, which stays
/// whatever the surrounding column already used.
pub(super) fn disclosure_body(
    p: &ChatAppearance,
    rail: DisclosureRail,
    gap: f32,
    children: impl IntoIterator<Item = AnyElement>,
) -> AnyElement {
    let s = p.scale;
    div()
        .flex()
        .min_w_0()
        .ml(px((rail.centre() - 1.0) * s))
        .gap(px(RAIL_TO_CONTENT * s))
        .child(
            div()
                .w(px(2.0 * s))
                .flex_shrink_0()
                .rounded(px(1.0 * s))
                .bg(p.muted.opacity(0.42)),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .gap(px(gap * s))
                .children(children),
        )
        .into_any_element()
}
