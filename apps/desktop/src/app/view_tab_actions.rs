//! What the view panel's tab strip does: reordering by drag, and popping a view out of the window.

use crate::app::helpers::*;
use crate::app::model::*;
use crate::*;

impl GhostexGpuiApp {
    pub(crate) fn begin_view_tab_drag(
        &mut self,
        mode: TitlebarMode,
        index: usize,
        cx: &mut gpui::Context<Self>,
    ) {
        if self
            .view_tab_drag
            .is_some_and(|drag| drag.mode == mode && drag.insertion_index == index)
        {
            return;
        }
        self.view_tab_drag = Some(GpuiViewTabDrag {
            mode,
            insertion_index: index,
        });
        cx.notify();
    }

    pub(crate) fn set_view_tab_drop_index(&mut self, index: usize, cx: &mut gpui::Context<Self>) {
        let Some(drag) = self.view_tab_drag else {
            return;
        };
        if drag.insertion_index == index {
            return;
        }
        self.view_tab_drag = Some(GpuiViewTabDrag {
            insertion_index: index,
            ..drag
        });
        cx.notify();
    }

    pub(crate) fn update_view_tab_drag_feedback(
        &mut self,
        event: &gpui::DragMoveEvent<DraggedViewTab>,
        tab_index: usize,
        cx: &mut gpui::Context<Self>,
    ) {
        if !event.bounds.contains(&event.event.position) {
            return;
        }
        let dragged = event.drag(cx).mode;
        self.begin_view_tab_drag(dragged, tab_index, cx);
        let insertion_index =
            workspace_tab_insertion_index(event.bounds, event.event.position, tab_index);
        self.set_view_tab_drop_index(insertion_index, cx);
    }

    pub(crate) fn handle_view_tab_drop(
        &mut self,
        mode: TitlebarMode,
        default_insertion_index: usize,
        cx: &mut gpui::Context<Self>,
    ) {
        let insertion_index = self
            .view_tab_drag
            .filter(|drag| drag.mode == mode)
            .map(|drag| drag.insertion_index)
            .unwrap_or(default_insertion_index);
        self.view_tab_drag = None;
        // The strip the user sees is the available subset, so an index in it has to be translated
        // back into the stored list before anything moves; otherwise dropping a tab in a project
        // that hides one view would reorder a different pair.
        let tabs = self.open_view_tabs();
        let stored_index = match tabs.get(insertion_index) {
            Some(neighbour) => self
                .open_views
                .iter()
                .position(|tab| tab == neighbour)
                .unwrap_or(self.open_views.len()),
            None => self.open_views.len(),
        };
        self.reorder_view_tab(mode, stored_index, cx);
        cx.notify();
    }

    /// A drag released anywhere but on a tab ends here, so the drop indicator cannot outlive the
    /// drag that drew it. The window root calls this on every left mouse up, beside the other tab
    /// drags.
    pub(crate) fn cancel_view_tab_drag(&mut self, cx: &mut gpui::Context<Self>) {
        if self.view_tab_drag.is_none() {
            return;
        }
        self.view_tab_drag = None;
        cx.notify();
    }

    /// CDXC:Workarea 2026-09-20 DECISION:
    /// User (screen 09): "Pop out (next to expand) moves the view to its own window, for a second
    /// monitor." Every view Ghostex can pop out is a page served over local HTTP (code-server for
    /// Code, gxserver for Kanban, Automate and Docs, the extension's own server, the tab's own
    /// address for Browser), so popping out hands that exact page to a window of its own instead of
    /// building a second CEF host inside the app. A view with no page yet cannot be popped out, and
    /// the control says so rather than opening an empty window.
    pub(crate) fn view_pop_out_url(&self, mode: TitlebarMode) -> Option<String> {
        if mode == TitlebarMode::Browser {
            return self
                .browser_tabs
                .active_tab()
                .map(|tab| tab.url.clone())
                .filter(|url| url.starts_with("http://") || url.starts_with("https://"));
        }
        let slot = ProjectWorkareaCefSurfaceSlotKey::for_titlebar_mode(mode)?;
        self.project_workarea_runtime_url_for_slot(slot)
            .map(|runtime_url| runtime_url.value.clone())
            .filter(|url| url.starts_with("http://") || url.starts_with("https://"))
    }

    pub(crate) fn pop_out_view(&mut self, mode: TitlebarMode, cx: &mut gpui::Context<Self>) {
        let Some(url) = self.view_pop_out_url(mode) else {
            return;
        };
        if let Err(message) = gpui_open_external_http_url(&url) {
            self.upsert_gpui_app_toast(
                GpuiAppToast {
                    copy_text: None,
                    id: "gpui-view-pop-out-failed".to_string(),
                    level: GpuiAppToastLevel::from_raw(Some("warning")),
                    title: format!("Could not pop out {}", mode.tab_label()),
                    description: Some(message),
                    loading: false,
                    persistent: false,
                    duration_ms: GPUI_APP_TOAST_DEFAULT_DURATION_MS,
                    epoch: 0,
                },
                cx,
            );
        }
    }
}
