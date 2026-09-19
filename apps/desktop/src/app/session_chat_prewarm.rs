use crate::*;
use std::time::Duration;

/// Native chat views kept warm beyond the ones on screen.
const NATIVE_CHAT_WARM_VIEWS: usize = 10;

impl GhostexGpuiApp {
    /// CDXC:SessionChat 2026-09-19 WHY:
    /// A session's first chat open cost about 300ms after the click (runtime boot, two service-thread round trips, transcript projection) while an already warm view painted in about 25ms; Waku feels instant because every transcript is in memory before the click.
    /// The active project's chat-eligible tab sessions get their native chat views created in the background, one every 150ms, so a click lands on a warm view. Views never show until focused, and the count of warm views is bounded.
    pub(crate) fn schedule_native_chat_prewarm(&mut self, cx: &mut gpui::Context<Self>) {
        if !self.session_chat_use_gpui || self.agents_chat_prewarm_scheduled {
            return;
        }
        let pending = self.native_chat_prewarm_candidates();
        if pending.is_empty() {
            return;
        }
        self.agents_chat_prewarm_scheduled = true;
        cx.spawn(async move |this, cx| {
            for session_id in pending {
                cx.background_executor()
                    .timer(Duration::from_millis(150))
                    .await;
                let keep = this
                    .update(cx, |this, cx| {
                        if !this.session_chat_use_gpui {
                            return false;
                        }
                        if this.native_chat_views.contains_key(&session_id)
                            || !this
                                .agents_workspace
                                .terminal_session_ids()
                                .contains(&session_id)
                        {
                            return true;
                        }
                        this.ensure_native_chat(session_id, cx);
                        true
                    })
                    .unwrap_or(false);
                if !keep {
                    break;
                }
            }
            let _ = this.update(cx, |this, _| this.agents_chat_prewarm_scheduled = false);
        })
        .detach();
    }

    fn native_chat_prewarm_candidates(&self) -> Vec<TerminalSessionId> {
        let room = NATIVE_CHAT_WARM_VIEWS.saturating_sub(self.native_chat_views.len());
        self.agents_workspace
            .terminal_session_ids()
            .into_iter()
            .filter(|session_id| !self.native_chat_views.contains_key(session_id))
            .filter(|session_id| {
                self.agents_chat_mode_sessions.contains(session_id)
                    || self.agents_session_chat_eligible(*session_id)
            })
            .take(room)
            .collect()
    }
}
