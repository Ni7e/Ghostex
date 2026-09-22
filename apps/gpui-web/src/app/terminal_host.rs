//! The session terminal in the work area: the desktop's `TerminalView`, attached to the session's daemon through gxserver.
use ghostex_gx_core::SessionKey;
use gpui::{AppContext as _, Entity, px};

use crate::GhostexGpuiApp;
use crate::terminal_element::{TerminalFontConfig, TerminalView};
use crate::terminal_model::{TerminalAttachConfig, TerminalModel};

impl GhostexGpuiApp {
    pub(crate) fn ensure_terminal(
        &mut self,
        session: &SessionKey,
        cx: &mut gpui::Context<Self>,
    ) -> Option<Entity<TerminalView>> {
        if let Some(view) = self.terminals.get(session) {
            return Some(view.clone());
        }
        let endpoint = self.gx_store.endpoint.clone()?;
        crate::terminal_gpui_engine::register_gpui_terminal_engine_fonts(cx);
        let (sink, events) = TerminalView::event_channel();
        let model = TerminalModel::attach(
            TerminalAttachConfig {
                base_url: endpoint.base_url,
                auth_token: endpoint.auth_token,
                project_id: session.project_id.clone(),
                session_id: session.session_id.clone(),
                // Provisional: the element's first prepaint resizes to the real bounds.
                cols: 80,
                rows: 24,
                max_scrollback: 10_000,
            },
            sink,
        )
        .inspect_err(|error| log::error!("terminal attach failed: {error}"))
        .ok()?;
        let view = cx.new(|cx| {
            TerminalView::from_model(
                model,
                events,
                TerminalFontConfig {
                    family: "JetBrainsMono Nerd Font".into(),
                    size: px(13.0),
                    ..TerminalFontConfig::default()
                },
                Box::new(|_, _, _, _| {}),
                cx,
            )
        });
        self.terminals.insert(session.clone(), view.clone());
        Some(view)
    }
}
