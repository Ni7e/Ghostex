// Keep-alive for projects the user just left: the terminals, chat pages, and
// view page that were visible when a project was parked stay running for the
// Settings-owned window instead of being released on the switch.

use crate::app::model::*;
use crate::*;
use std::time::{Duration, Instant};

/// A Code, Kanban, Automate, or Docs page that was visible when its project was left, kept loaded
/// until the same runtime URL asks for it again or the keep-alive window ends.
pub(crate) struct ParkedProjectWorkareaSurface {
    pub(crate) owned: ProjectWorkareaRuntimeCefSurface,
    pub(crate) parked_at: Instant,
}

/// True while `parked_at` is still inside the keep-alive window; `None` for either means no keep-alive.
pub(crate) fn project_keep_alive_active(
    parked_at: Option<Instant>,
    keep: Option<Duration>,
) -> bool {
    match (parked_at, keep) {
        (Some(parked_at), Some(keep)) => parked_at.elapsed() < keep,
        _ => false,
    }
}

fn keep_alive_remaining(parked_at: Option<Instant>, keep: Option<Duration>) -> Option<Duration> {
    let keep = keep?;
    keep.checked_sub(parked_at?.elapsed())
        .filter(|remaining| !remaining.is_zero())
}

impl GhostexGpuiApp {
    /// CDXC:Workarea 2026-09-19 DECISION:
    /// User: switching Spaces (which switches projects) must keep the previous project live in the background instead of closing and relaunching it on every swap, for a slider-chosen number of minutes.
    /// Only what was visible when the project was left is kept: its visible terminal viewers, visible chat pages, and the open Code/Kanban/Automate/Docs page. Hidden tabs keep the 2026-09-13 release rules, and 0 minutes restores those rules for everything.
    pub(crate) fn project_switch_keep_alive(&self) -> Option<Duration> {
        shared_settings::shared_sidebar_settings_snapshot().project_switch_keep_alive()
    }

    /// The Agents terminal viewers currently on screen, captured before a project switch parks them.
    pub(crate) fn agents_terminal_keep_alive_viewer_sessions(&self) -> HashSet<TerminalSessionId> {
        if self.project_switch_keep_alive().is_none() {
            return HashSet::new();
        }
        self.agents_gpui_engine_terminals
            .keys()
            .copied()
            .filter(|id| self.agents_terminal_viewer_is_visible(*id))
            .collect()
    }

    pub(crate) fn park_project_workarea_runtime_cef_surface(
        &mut self,
        owned: ProjectWorkareaRuntimeCefSurface,
        was_visible: bool,
        cx: &mut gpui::Context<Self>,
    ) {
        if owned.runtime_url.project_view_key.is_some() {
            self.park_custom_project_view(owned);
            return;
        }
        if !was_visible || self.project_switch_keep_alive().is_none() {
            return;
        }
        self.parked_project_workarea_surfaces
            .retain(|parked| !parked.owned.matches_runtime_url(&owned.runtime_url));
        self.parked_project_workarea_surfaces
            .push(ParkedProjectWorkareaSurface {
                owned,
                parked_at: Instant::now(),
            });
        self.ensure_project_keep_alive_expiry_scheduled(cx);
    }

    pub(crate) fn take_parked_project_workarea_runtime_cef_surface(
        &mut self,
        runtime_url: &ProjectWorkareaRealRuntimeUrl,
    ) -> Option<ProjectWorkareaRuntimeCefSurface> {
        if let Some(owned) = self.take_custom_project_view(runtime_url) {
            return Some(owned);
        }
        let keep = self.project_switch_keep_alive();
        let index = self
            .parked_project_workarea_surfaces
            .iter()
            .position(|parked| {
                parked.owned.matches_runtime_url(runtime_url)
                    && project_keep_alive_active(Some(parked.parked_at), keep)
            })?;
        Some(self.parked_project_workarea_surfaces.remove(index).owned)
    }

    fn expire_parked_project_workarea_surfaces(&mut self) {
        let keep = self.project_switch_keep_alive();
        // Dropping the entity closes the page, exactly as the prune did before keep-alive.
        self.parked_project_workarea_surfaces
            .retain(|parked| project_keep_alive_active(Some(parked.parked_at), keep));
    }

    fn next_project_keep_alive_expiry(&self) -> Option<Duration> {
        let keep = self.project_switch_keep_alive();
        let workarea = self
            .parked_project_workarea_surfaces
            .iter()
            .filter_map(|parked| keep_alive_remaining(Some(parked.parked_at), keep));
        let terminals = self
            .parked_agents_terminal_runtimes_by_project
            .values()
            .filter(|parked| !parked.kept_alive_viewer_sessions.is_empty())
            .filter_map(|parked| keep_alive_remaining(parked.parked_at, keep));
        let chats = self
            .parked_agents_chat_runtimes_by_project
            .values()
            .filter(|parked| !parked.kept_alive_sessions.is_empty())
            .filter_map(|parked| keep_alive_remaining(parked.parked_at, keep));
        workarea.chain(terminals).chain(chats).min()
    }

    /// One timer covers every kept project: it fires at the earliest expiry, runs the ordinary
    /// release passes (which now see the window as closed), and re-arms for the next project.
    pub(crate) fn ensure_project_keep_alive_expiry_scheduled(
        &mut self,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.project_keep_alive_expiry_scheduled {
            return;
        }
        let Some(delay) = self.next_project_keep_alive_expiry() else {
            return;
        };
        self.project_keep_alive_expiry_scheduled = true;
        cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(delay + Duration::from_millis(100))
                .await;
            let _ = this.update(cx, |this, cx| {
                this.project_keep_alive_expiry_scheduled = false;
                this.expire_parked_project_workarea_surfaces();
                this.release_unused_agents_gpui_terminal_viewers(false, &HashSet::new(), cx);
                this.evict_expired_hidden_agents_chat_surfaces(cx);
                this.ensure_project_keep_alive_expiry_scheduled(cx);
                cx.notify();
            });
        })
        .detach();
    }
}
