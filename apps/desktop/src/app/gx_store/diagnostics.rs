use std::collections::HashSet;
use std::time::{Duration, Instant};

use ghostex_gx_client::{ClientDiagnostic, StartError, redact_quoted_values};
use ghostex_gx_core::{ConnectionUpdate, Core, Loadable, MachineId, ProjectKey, ResubscribeReason};
use serde_json::json;

use super::host::GxStoreCounters;
use super::shadow_diff::{ShadowCounters, ShadowDiff, ShadowMismatch};
use super::sidebar_shadow::SidebarShadowCounters;
use super::sidebar_shadow_compare::SidebarMismatch;
use crate::{shared_settings, support_logs};

/// Distinct mismatch records one app run may write; later ones are only counted.
const MAX_DISTINCT_MISMATCH_RECORDS: usize = 200;
/// Unconditional warning lines one app run may write. A daemon that keeps producing a bad row
/// must not be able to fill the disk through this path.
const MAX_WARNING_LINES: u32 = 40;
const SHADOW_SUMMARY_INTERVAL: Duration = Duration::from_secs(60);

/// Log lines of the store, all in the `native.sidebar.refresh` support log.
///
/// Routine lines (`gxStore.loaded`, `gxStore.connection`, `gxStore.shadow.*`) are written only
/// while "Show debug UI controls" and that scenario are on, which the support log enforces.
/// Warnings (a frame that does not parse, snapshot rows that were skipped) are written always,
/// capped per run. Every line holds ids, counts, enum names, and field names: never a title, a
/// path, or frame content.
#[derive(Default)]
pub(crate) struct GxStoreDiagnostics {
    logged_mismatches: HashSet<u64>,
    warning_lines: u32,
    /// When the summary was last considered, so a run with logging off reads the settings at
    /// most once per interval, and the totals it last wrote.
    shadow_summary_considered_at: Option<Instant>,
    shadow_summary_written: ShadowCounters,
    logged_sidebar_mismatches: HashSet<u64>,
    sidebar_summary_considered_at: Option<Instant>,
    sidebar_summary_written: SidebarShadowCounters,
    sidebar_storage_warnings: u32,
}

pub(super) fn routine_logging_enabled() -> bool {
    shared_settings::shared_sidebar_settings_snapshot().debugging_mode()
        && support_logs::scenario_enabled(support_logs::GpuiDiagnosticScenario::SidebarRefresh)
}

fn append(event: &str, details: serde_json::Value) {
    support_logs::append(support_logs::GpuiSupportLog::SidebarRefresh, event, details);
}

impl GxStoreDiagnostics {
    /// One line per (re)load of the local machine: the first one is the store coming up.
    pub(super) fn store_loaded(
        &mut self,
        core: &Core,
        counters: &GxStoreCounters,
        since_connect: Option<Duration>,
    ) {
        let store = core.presentation();
        let Some(loaded) = store.loaded(&MachineId::Local) else {
            return;
        };
        let chat_projects = loaded
            .projects()
            .iter()
            .filter(|project| {
                store.is_chat_project(&ProjectKey::local(project.project_id.as_str()))
            })
            .count();
        append(
            "gxStore.loaded",
            json!({
                "first": counters.reloads == 1,
                "revision": loaded.revision,
                "projects": loaded.projects().len(),
                "groups": loaded.groups().len(),
                "sessions": loaded.session_count(),
                "chatProjects": chat_projects,
                "tabsGeneration": core.tabs_generation(),
                "connectToLoadedMs": since_connect.map(|elapsed| elapsed.as_millis() as u64),
                "clientStarts": counters.client_starts,
                "reloads": counters.reloads,
            }),
        );
    }

    /// The persisted focus seeded the core at startup. Ids only.
    pub(super) fn focus_restored(&mut self, core: &Core) {
        let focus = core.focus();
        append(
            "gxStore.focusRestored",
            json!({
                "activeProjectId": focus.active_project.as_ref().map(|project| &project.project_id),
                "focusedSessionId": focus.focused_session.as_ref().map(|session| &session.session_id),
            }),
        );
    }

    /// The old runtime sent an empty tab list for a project the store does not see as empty (or
    /// cannot judge yet), so the workspace kept its tabs. A warning: it means the two readers of
    /// the daemon disagree, or the old runtime posted before it had rows.
    pub(super) fn empty_tab_list_disputed(&mut self, core: &Core, total: u64) {
        let store_tabs = match core.active_tab_sessions() {
            Loadable::Loaded(tabs) => Some(tabs.len()),
            Loadable::NotLoaded | Loadable::Missing => None,
        };
        self.warning(
            "gxStore.emptyTabListDisputed.warning",
            json!({
                "storeRevision": store_revision(core),
                "storeActiveTabs": store_tabs,
                "total": total,
            }),
        );
    }

    pub(super) fn connection(&mut self, update: &ConnectionUpdate) {
        let details = match update {
            ConnectionUpdate::Connecting { attempt } => {
                json!({ "phase": "connecting", "attempt": attempt })
            }
            // `reason`, not `error`: a daemon restart is routine, and the support log writes any
            // line with an error-named key unconditionally.
            ConnectionUpdate::Lost { error } => json!({ "phase": "lost", "reason": error }),
            _ => return,
        };
        append("gxStore.connection", details);
    }

    pub(super) fn resubscribe_requested(&mut self, reason: &ResubscribeReason) {
        let reason = match reason {
            ResubscribeReason::CurrentWithoutSnapshot => "currentWithoutSnapshot",
            ResubscribeReason::ServerChanged => "serverChanged",
            _ => "other",
        };
        append("gxStore.resubscribeRequested", json!({ "reason": reason }));
    }

    pub(super) fn skipped_rows(
        &mut self,
        projects: usize,
        groups: usize,
        sessions: usize,
        first_error: &str,
    ) {
        self.warning(
            "gxStore.snapshotRowsSkipped.warning",
            json!({
                "projects": projects,
                "groups": groups,
                "sessions": sessions,
                "firstError": redact_quoted_values(first_error),
            }),
        );
    }

    pub(super) fn client_diagnostic(&mut self, diagnostic: &ClientDiagnostic) {
        let details = match diagnostic {
            ClientDiagnostic::FrameParseFailed {
                event_type,
                error,
                resubscribe_scheduled,
            } => json!({
                "kind": "frameParseFailed",
                "frameType": event_type,
                "error": error,
                "resubscribeScheduled": resubscribe_scheduled,
            }),
            ClientDiagnostic::DomainProjectsReadFailed { error } => {
                json!({ "kind": "domainProjectsReadFailed", "error": error })
            }
            ClientDiagnostic::SubscribeNotAcknowledged => {
                json!({ "kind": "subscribeNotAcknowledged" })
            }
            ClientDiagnostic::ProtocolMismatch { received } => {
                json!({ "kind": "protocolMismatch", "received": received })
            }
            ClientDiagnostic::ThreadStopped { reason } => {
                json!({ "kind": "threadStopped", "error": reason })
            }
        };
        self.warning("gxStore.client.warning", details);
    }

    pub(super) fn client_start_failed(&mut self, error: &StartError) {
        self.warning(
            "gxStore.clientStart.error",
            json!({ "error": error.to_string() }),
        );
    }

    /// The client's thread is gone although nobody stopped it; a new client follows.
    pub(super) fn client_thread_ended(&mut self, restart_attempt: u32, restart_in: Duration) {
        self.warning(
            "gxStore.clientThreadEnded.warning",
            json!({
                "restartAttempt": restart_attempt,
                "restartInMs": restart_in.as_millis() as u64,
            }),
        );
    }

    fn warning(&mut self, event: &str, details: serde_json::Value) {
        if self.warning_lines >= MAX_WARNING_LINES {
            return;
        }
        self.warning_lines += 1;
        append(event, details);
    }

    /// One bounded record per distinct mismatch. A mismatch seen while logging is off is not
    /// remembered, so turning the scenario on later still records it when it happens again.
    pub(super) fn shadow_mismatch(&mut self, mismatch: &ShadowMismatch, core: &Core) {
        let signature = mismatch.signature();
        if self.logged_mismatches.contains(&signature)
            || self.logged_mismatches.len() >= MAX_DISTINCT_MISMATCH_RECORDS
            || !routine_logging_enabled()
        {
            return;
        }
        self.logged_mismatches.insert(signature);
        let fields: Vec<serde_json::Value> = mismatch
            .fields
            .iter()
            .map(|(tab, names)| json!({ "tab": tab, "names": names }))
            .collect();
        append(
            "gxStore.shadow.mismatch",
            json!({
                "storeGroup": mismatch.store_group,
                "storeRevision": store_revision(core),
                "oldTabCount": mismatch.old_tab_count,
                "storeTabCount": mismatch.store_tab_count,
                "onlyOld": mismatch.only_old,
                "onlyStore": mismatch.only_store,
                "orderDiffers": mismatch.order_differs,
                "fields": fields,
            }),
        );
    }

    /// The running totals, at most once a minute and only when they moved. Without it a run
    /// with no mismatch would leave no trace that comparisons ran.
    pub(super) fn shadow_summary(&mut self, shadow: &ShadowDiff, core: &Core) {
        let counters = shadow.counters();
        if counters == self.shadow_summary_written
            || self
                .shadow_summary_considered_at
                .is_some_and(|at| at.elapsed() < SHADOW_SUMMARY_INTERVAL)
        {
            return;
        }
        self.shadow_summary_considered_at = Some(Instant::now());
        if !routine_logging_enabled() {
            return;
        }
        self.shadow_summary_written = counters;
        let active_tabs = match core.active_tab_sessions() {
            Loadable::Loaded(tabs) => Some(tabs.len()),
            Loadable::NotLoaded | Loadable::Missing => None,
        };
        append(
            "gxStore.shadow.summary",
            json!({
                "observed": counters.observed,
                "matches": counters.matches,
                "mismatches": counters.mismatches,
                "distinctMismatches": counters.distinct_mismatches,
                "transient": counters.transient,
                "notComparable": counters.not_comparable,
                "remoteSkipped": counters.remote_skipped,
                "iconDifferences": counters.icon_differences,
                "staleExternalFocus": counters.stale_external_focus,
                "pending": shadow.is_pending(),
                "storeRevision": store_revision(core),
                "storeActiveTabs": active_tabs,
                "tabsGeneration": core.tabs_generation(),
            }),
        );
    }
}

impl GxStoreDiagnostics {
    /// One bounded record per distinct sidebar difference: ids, counts, and field names only.
    pub(super) fn sidebar_mismatch(&mut self, mismatch: &SidebarMismatch, snapshot_revision: u64) {
        let signature = mismatch.signature();
        if self.logged_sidebar_mismatches.contains(&signature)
            || self.logged_sidebar_mismatches.len() >= MAX_DISTINCT_MISMATCH_RECORDS
            || !routine_logging_enabled()
        {
            return;
        }
        self.logged_sidebar_mismatches.insert(signature);
        let named = |fields: &[(String, Vec<&'static str>)]| -> Vec<serde_json::Value> {
            fields
                .iter()
                .map(|(id, names)| json!({ "id": id, "names": names }))
                .collect()
        };
        append(
            "gxStore.sidebarShadow.mismatch",
            json!({
                "snapshotRevision": snapshot_revision,
                "oldGroupCount": mismatch.old_group_count,
                "storeGroupCount": mismatch.store_group_count,
                "onlyOldGroups": mismatch.only_old_groups,
                "onlyStoreGroups": mismatch.only_store_groups,
                "groupOrderDiffers": mismatch.group_order_differs,
                "topLevel": mismatch.top_level,
                "groups": named(&mismatch.groups),
                "sessions": named(&mismatch.sessions),
                "onlyOldSessions": mismatch.only_old_sessions,
                "onlyStoreSessions": mismatch.only_store_sessions,
                "questionCountOnly": mismatch.question_count_only,
                "tooltipOnly": mismatch.tooltip_only,
                "onlyFrozenFields": mismatch.only_frozen_fields,
            }),
        );
    }

    /// The running totals of the sidebar comparison, at most once a minute and only when they
    /// moved.
    pub(super) fn sidebar_summary(
        &mut self,
        counters: &SidebarShadowCounters,
        pending: bool,
        stored_error: Option<&'static str>,
        groups: usize,
        rows: usize,
    ) {
        if *counters == self.sidebar_summary_written
            || self
                .sidebar_summary_considered_at
                .is_some_and(|at| at.elapsed() < SHADOW_SUMMARY_INTERVAL)
        {
            return;
        }
        self.sidebar_summary_considered_at = Some(Instant::now());
        if !routine_logging_enabled() {
            return;
        }
        self.sidebar_summary_written = *counters;
        append(
            "gxStore.sidebarShadow.summary",
            json!({
                "observed": counters.observed,
                "compared": counters.compared,
                "matches": counters.matches,
                "mismatches": counters.mismatches,
                "distinctMismatches": counters.distinct_mismatches,
                "transient": counters.transient,
                "skippedRemote": counters.skipped_remote,
                "skippedForeignFocus": counters.skipped_foreign_focus,
                "skippedNotLoaded": counters.skipped_not_loaded,
                "skippedNotLive": counters.skipped_not_live,
                "skippedStoredUnknown": counters.skipped_stored_unknown,
                "storedReadFailures": counters.stored_read_failures,
                "storedReadError": stored_error,
                "questionCountOnly": counters.question_count_only,
                "tooltipOnly": counters.tooltip_only,
                "frozenFieldsOnly": counters.frozen_fields_only,
                "neverSettled": counters.never_settled,
                "scratchChecks": counters.scratch_checks,
                "scratchMismatches": counters.scratch_mismatches,
                "updateUs": counters.last_update_us,
                "updateMaxUs": counters.update_max_us,
                "compareUs": counters.last_compare_us,
                "compareMaxUs": counters.compare_max_us,
                "pending": pending,
                "storeGroups": groups,
                "storeRows": rows,
            }),
        );
    }

    /// The sidebar state only client storage holds could not be read, so nothing is compared.
    /// The code is a fixed word: a database error string can carry the file's path.
    pub(super) fn sidebar_stored_state_failed(&mut self, error: &'static str) {
        if self.sidebar_storage_warnings >= 3 {
            return;
        }
        self.sidebar_storage_warnings += 1;
        self.warning(
            "gxStore.sidebarShadow.storedState.warning",
            json!({ "error": error }),
        );
    }
}

fn store_revision(core: &Core) -> Option<i64> {
    core.presentation()
        .loaded(&MachineId::Local)
        .map(|loaded| loaded.revision)
}
