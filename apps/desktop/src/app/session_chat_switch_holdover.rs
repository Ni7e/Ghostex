use crate::app::native_chat::state::NativeChatView;
use crate::*;
use gpui::{
    AnyElement, InteractiveElement as _, IntoElement, ParentElement as _, Styled as _, div,
};
use std::cell::RefCell;
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// The longest a pane keeps showing its previous conversation while the next one boots.
const CHAT_HOLDOVER_MAX: Duration = Duration::from_millis(1200);

#[derive(Default)]
pub(crate) struct SessionChatHoldover {
    /// The last session whose native chat painted real content in this pane.
    ready: Option<TerminalSessionId>,
    /// The session the pane is waiting on, and since when.
    pending: Option<(TerminalSessionId, Instant)>,
    deadline_scheduled: bool,
}

#[derive(Default)]
pub(crate) struct SessionChatHoldovers {
    by_pane: RefCell<HashMap<WorkspacePaneId, SessionChatHoldover>>,
}

impl GhostexGpuiApp {
    /// The same readiness the chat view's own paint marker uses: rows on screen, or a status that says there are none.
    pub(crate) fn native_chat_content_ready(
        &self,
        view: &Entity<NativeChatView>,
        cx: &gpui::App,
    ) -> bool {
        let view = view.read(cx);
        view.error.is_none()
            && (view.list.item_count() > 0
                || matches!(
                    view.snapshot["status"].as_str(),
                    Some("ready" | "working" | "empty")
                ))
    }

    /// CDXC:SessionChat 2026-09-19 WHY:
    /// Switching to a session whose native chat was still booting painted an empty pane for the whole boot, the blink Waku avoids by leaving the previous conversation on screen until the next one has content.
    /// The pane keeps drawing the conversation it last showed, input-blocked and unchanged, while the incoming view boots unseen underneath it, for at most 1.2s; the incoming view takes over as soon as it has rows or its own status, or when the wait runs out. A previous conversation that is on screen in another pane is not borrowed, since one view cannot paint twice in a frame.
    pub(crate) fn render_native_chat_with_holdover(
        &self,
        pane_id: WorkspacePaneId,
        session_id: TerminalSessionId,
        view: &Entity<NativeChatView>,
        cx: &mut gpui::Context<Self>,
    ) -> AnyElement {
        let incoming = |view: &Entity<NativeChatView>| {
            div()
                .id(format!("native-chat-{}", session_id.0))
                .size_full()
                .min_w_0()
                .min_h_0()
                .overflow_hidden()
                .child(view.clone())
        };
        let ready = self.native_chat_content_ready(view, cx);
        let mut holdovers = self.session_chat_holdovers.by_pane.borrow_mut();
        let entry = holdovers.entry(pane_id).or_default();
        if ready {
            entry.ready = Some(session_id);
            entry.pending = None;
            entry.deadline_scheduled = false;
            return incoming(view).into_any_element();
        }
        let pending_since = match entry.pending {
            Some((pending_id, since)) if pending_id == session_id => since,
            _ => {
                let now = Instant::now();
                entry.pending = Some((session_id, now));
                entry.deadline_scheduled = false;
                now
            }
        };
        let shown_elsewhere = |candidate: TerminalSessionId| {
            self.agents_workspace
                .rendered_leaf_order()
                .into_iter()
                .filter(|leaf| *leaf != pane_id)
                .any(|leaf| self.agents_workspace.active_session_in_pane(leaf) == Some(candidate))
        };
        let previous = entry
            .ready
            .filter(|previous_id| *previous_id != session_id && !shown_elsewhere(*previous_id))
            .and_then(|previous_id| self.native_chat_views.get(&previous_id).cloned())
            .filter(|previous| self.native_chat_content_ready(previous, cx))
            .filter(|_| pending_since.elapsed() < CHAT_HOLDOVER_MAX);
        let Some(previous) = previous else {
            entry.ready = None;
            return incoming(view).into_any_element();
        };
        if !entry.deadline_scheduled {
            entry.deadline_scheduled = true;
            let remaining = CHAT_HOLDOVER_MAX.saturating_sub(pending_since.elapsed());
            cx.spawn(async move |this, cx| {
                cx.background_executor().timer(remaining).await;
                let _ = this.update(cx, |_, cx| cx.notify());
            })
            .detach();
        }
        div()
            .id(format!("native-chat-holdover-{}", pane_id.0))
            .relative()
            .size_full()
            .min_w_0()
            .min_h_0()
            .overflow_hidden()
            .child(
                div()
                    .absolute()
                    .inset_0()
                    .opacity(0.0)
                    .child(incoming(view)),
            )
            .child(div().absolute().inset_0().child(previous.clone()))
            .child(div().absolute().inset_0().occlude())
            .into_any_element()
    }
}
