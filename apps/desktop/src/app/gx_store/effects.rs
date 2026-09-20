use ghostex_gx_core::Effect;

use super::host::GxStoreHost;

impl GxStoreHost {
    /// Performs what the core asked for: the requests that keep the store itself correct, and
    /// what focus ownership needs. The rest belong to the milestone that makes the store the
    /// owner of that behaviour; performing them now would duplicate what the old runtime does.
    pub(super) fn run_effects(&mut self, effects: Vec<Effect>) {
        for effect in effects {
            match effect {
                // Routed by machine: a remote machine's snapshot has to be asked of that
                // machine's client, and asking the local one would resubscribe the wrong daemon
                // while the machine that needs a snapshot waits for ever.
                Effect::ResubscribePresentation { machine, reason } => {
                    self.counters.resubscribes_requested += 1;
                    self.diagnostics.resubscribe_requested(&reason);
                    let client = match machine.remote_id() {
                        None => self.client.as_ref(),
                        Some(machine_id) => self.remote.client(machine_id),
                    };
                    if let Some(client) = client {
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
                // Kept newest per project and handed to the old runtime with the next tell: the
                // record lives in its client storage (`projectLastSession`) until storage moves
                // to Rust, and a second writer would leave its cache stale.
                Effect::RememberProjectSession { session, .. } => {
                    self.local_focus.remember(session);
                }
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
