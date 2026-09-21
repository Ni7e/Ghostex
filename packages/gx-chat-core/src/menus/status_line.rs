//! Where the status line under the chat box wraps, and how much room it holds free.
//!
//! Port of `packages/shared/session-chat-presentation/status-line-layout.ts`.

/// CDXC:SessionChat 2026-09-19 SEE-ALSO:
/// One status-line row, the height both renderers hold free under the chat box from the first
/// frame so the box never shifts when the values arrive. React applies it as `min-height` in the
/// `.ghostex-chat-status-line.is-reserved` rule of packages/core-ui/styles/chat.css (which also
/// sets the matching 16px line-height); apps/desktop/src/app/native_chat/context_meter.rs reserves
/// the same height.
pub const SESSION_CHAT_STATUS_LINE_ROW_HEIGHT_PX: u32 = 16;

/// `sessionChatStatusLineReserved`: whether the status line keeps its row of space.
///
/// Configured items reserve it while their values are still loading, so the first paint already
/// has room for the line the session is going to show.
pub fn status_line_reserved(has_configured_items: bool, item_count: usize) -> bool {
    has_configured_items || item_count > 0
}

/// `balancedRowStarts`: the index each row of the status line starts at.
///
/// CDXC:SessionChat 2026-09-14 DECISION:
/// User: center every status-line row, avoid a row with only one item where possible, and show
/// separators only between items on the same row. This supersedes the 2026-09-04 container-only
/// centering and left-aligned wrapped rows.
pub fn balanced_row_starts(widths: &[f64], available: f64, separator: f64) -> Vec<usize> {
    #[derive(Clone)]
    struct Layout {
        rows: usize,
        singletons: usize,
        slack: f64,
        starts: Vec<usize>,
    }
    let mut layouts: Vec<Option<Layout>> = Vec::with_capacity(widths.len() + 1);
    layouts.push(Some(Layout {
        rows: 0,
        singletons: 0,
        slack: 0.0,
        starts: Vec::new(),
    }));
    for end in 1..=widths.len() {
        let mut best: Option<Layout> = None;
        let mut width = 0.0;
        for start in (0..end).rev() {
            width += widths[start].min(available) + if start < end - 1 { separator } else { 0.0 };
            if width > available {
                break;
            }
            // A start with no layout is unreachable; the TypeScript would read `undefined.rows`
            // and throw, which cannot happen because every prefix below `end` was filled first.
            let Some(previous) = layouts[start].as_ref() else {
                continue;
            };
            let mut starts = previous.starts.clone();
            starts.push(start);
            let candidate = Layout {
                rows: previous.rows + 1,
                singletons: previous.singletons + usize::from(end - start == 1),
                slack: previous.slack + (available - width).powi(2),
                starts,
            };
            let better = match &best {
                None => true,
                Some(best) => {
                    candidate.rows < best.rows
                        || (candidate.rows == best.rows
                            && (candidate.singletons < best.singletons
                                || (candidate.singletons == best.singletons
                                    && candidate.slack < best.slack)))
                }
            };
            if better {
                best = Some(candidate);
            }
        }
        layouts.push(best);
    }
    layouts[widths.len()]
        .as_ref()
        .map(|layout| layout.starts.clone())
        .unwrap_or_default()
}
