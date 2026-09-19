use ghostex_gx_core::Effect;

use super::host::GxStoreHost;

impl GxStoreHost {
    /// Performs what the core asked for. While the store runs in shadow only the requests that
    /// keep the store itself correct are performed; the rest belong to the milestone that makes
    /// the store the owner of that behaviour, and performing them now would duplicate what the
    /// old runtime still does.
    pub(super) fn run_effects(&mut self, effects: Vec<Effect>) {
        for effect in effects {
            match effect {
                Effect::ResubscribePresentation { reason, .. } => {
                    self.counters.resubscribes_requested += 1;
                    self.diagnostics.resubscribe_requested(&reason);
                    if let Some(client) = &self.client {
                        client.request_resubscribe();
                    }
                }
                Effect::ReportSkippedRows {
                    projects,
                    groups,
                    sessions,
                    first_error,
                    ..
                } => {
                    self.counters.skipped_row_reports += 1;
                    self.diagnostics
                        .skipped_rows(projects, groups, sessions, &first_error);
                }
                // M3 (focus and tabs owned by Rust): persist the last session of a project,
                // coalesced per project. The old runtime still persists it today.
                Effect::RememberProjectSession { .. } => {}
                // M4 (sidebar from the store): read `/api/readSidebarHud` in the background.
                Effect::RefetchSidebarHud { .. } => {}
                // M5 (session lifecycle, attention, notifications): read the notification feed.
                Effect::RefetchNotificationFeed { .. } => {}
                // The core's effect list grows with each milestone; a new one is wired when the
                // milestone that introduces it lands.
                _ => {}
            }
        }
    }
}
