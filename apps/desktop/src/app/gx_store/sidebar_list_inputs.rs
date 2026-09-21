//! The inputs the Rust sidebar list is built from besides the store.
//!
//! CDXC:Sidebar 2026-09-20 WHY:
//! Three kinds of value meet here and the file keeps them apart on purpose. The sidebar's own
//! state (collapse, Space, filters, hidden items, selection) is the Rust store's, owned since
//! M4b. The stored collections and the unavailable clock are this app's own facts. The rest are
//! still read from the snapshot the old projection publishes, because their
//! real source has not moved into Rust yet: the sort mode and the Recent Projects come from the
//! daemon's sidebar HUD, the git numbers from the old runtime's background probe, and the Close
//! After Done and Delayed Send timers from the runtime that owns them. Each of those is handed to
//! M5 with the HUD and the session lifecycle; until then they are mirrored here and nowhere else,
//! so there is one list of what is still borrowed.

use ghostex_gx_core::{
    CloseAfterDoneInput, DelayedSendInput, MachineTabInput, ProjectDiffStats, SessionSortMode,
    SidebarHostInputs, SidebarInputs, SidebarSettings, SidebarUiState, UnavailableState,
};
use serde_json::Value;

use crate::app::native_sidebar::model::{NativeSidebarSession, NativeSidebarSnapshot};

/// What the assembled inputs were built from, so an update that changes none of it does no work.
#[derive(Default)]
pub(super) struct InputsCache {
    /// Identity of the sidebar's own state: bumped by every intent and by the restore.
    ui_generation: u64,
    /// Address of the snapshot the mirrored values were taken from.
    published: Option<usize>,
    /// The machine tabs as the last refresh saw them.
    machines: Option<Vec<MachineTabInput>>,
    stored_collections: Option<Option<Value>>,
    settings: Option<SidebarSettings>,
    unavailable: Option<UnavailableState>,
}

/// Brings the assembled inputs up to date in place. Each part is rebuilt only when its own source
/// moved, so a pump that changed one session does not re-read every published row.
#[allow(clippy::too_many_arguments)]
pub(super) fn refresh_inputs(
    inputs: &mut SidebarInputs,
    cache: &mut InputsCache,
    ui: &SidebarUiState,
    ui_generation: u64,
    settings: SidebarSettings,
    published: Option<&NativeSidebarSnapshot>,
    stored_project_collections: &Option<Value>,
    unavailable: UnavailableState,
    machines: &[MachineTabInput],
) {
    if cache.ui_generation != ui_generation || cache.settings.is_none() {
        cache.ui_generation = ui_generation;
        inputs.ui = ui.clone();
    }
    if cache.settings.as_ref() != Some(&settings) {
        cache.settings = Some(settings.clone());
        inputs.settings = settings;
    }
    if cache.stored_collections.as_ref() != Some(stored_project_collections) {
        cache.stored_collections = Some(stored_project_collections.clone());
        inputs.host.stored_project_collections = stored_project_collections.clone();
    }
    if cache.unavailable != Some(unavailable) {
        cache.unavailable = Some(unavailable);
        inputs.host.unavailable = unavailable;
    }
    if cache.machines.as_deref() != Some(machines) {
        cache.machines = Some(machines.to_vec());
        inputs.host.machines = machines.to_vec();
    }
    let published_identity = published.map_or(0, |snapshot| snapshot as *const _ as usize);
    if cache.published == Some(published_identity) {
        return;
    }
    cache.published = Some(published_identity);
    refresh_mirrored(&mut inputs.host, published);
}

/// The values whose real source has not moved into Rust yet, taken from the newest publish of the
/// old projection. Every one of them is handed to M5 with the HUD and the session lifecycle.
fn refresh_mirrored(host: &mut SidebarHostInputs, published: Option<&NativeSidebarSnapshot>) {
    let recent_projects = published
        .and_then(|snapshot| snapshot.hud.get("recentProjects"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    // The projection hides a parked project by its own id; a remote machine's entry carries a
    // machine-scoped one and belongs to that machine's section.
    host.recent_project_ids = recent_projects
        .iter()
        .filter(|project| project.get("remoteMachineId").is_none())
        .filter_map(|project| project.get("projectId").and_then(Value::as_str))
        .map(str::to_string)
        .collect();
    // A remote machine's parked projects are kept per machine: a project id is unique per daemon
    // only, so one flat set would hide a local project whose id a remote machine also handed out.
    //
    // CDXC:RemoteMachines 2026-09-20 WHY:
    // The `projectId` of a remote Recent Project is the MACHINE-SCOPED id
    // (`createGpuiRemotePresentationProjectId`, helpers/recent-projects.ts), and the raw daemon id
    // the store keys its rows by is nowhere else in the row, so it has to be parsed back out.
    // Inserting the id as published put strings of the form `remote:<m>:project:<raw>` into a set
    // that both readers compare against RAW ids (`build_project_meta`, `machine_tab_summary`), so
    // the set matched nothing and every project the user had parked on a remote machine came back
    // as a sidebar group the moment that machine connected.
    host.remote_recent_project_ids.clear();
    for project in recent_projects {
        let Some(machine_id) = project.get("remoteMachineId").and_then(Value::as_str) else {
            continue;
        };
        let parsed = project
            .get("projectId")
            .and_then(Value::as_str)
            .and_then(ghostex_gx_core::ProjectKey::parse_workspace_project_id);
        // An entry whose id does not name this machine is not this machine's to hide.
        let Some(project) = parsed.filter(|key| key.machine.remote_id() == Some(machine_id)) else {
            continue;
        };
        host.remote_recent_project_ids
            .entry(machine_id.to_string())
            .or_default()
            .insert(project.project_id);
    }
    host.recent_project_count = recent_projects.len();
    host.project_diff_stats.clear();
    host.close_after_done.clear();
    host.local_delayed_sends.clear();
    for group in published
        .map(|snapshot| snapshot.groups.as_slice())
        .unwrap_or_default()
    {
        if let Some((project_id, stats)) = project_diff_stats(group.project_context.as_ref()) {
            host.project_diff_stats.insert(project_id, stats);
        }
        for session in &group.sessions {
            if let Some(close) = close_after_done(session) {
                host.close_after_done
                    .insert(session.session_id.clone(), close);
            }
            if let Some(delayed) = delayed_send(session) {
                host.local_delayed_sends
                    .insert(session.session_id.clone(), delayed);
            }
        }
    }
}

/// The sort mode, from the daemon's sidebar HUD as the old projection publishes it. The HUD moves
/// into the store with the session lifecycle (M5); until then this is the one reader of it.
pub(super) fn sort_mode(snapshot: Option<&NativeSidebarSnapshot>) -> SessionSortMode {
    match snapshot
        .and_then(|snapshot| snapshot.hud.get("activeSessionsSortMode"))
        .and_then(Value::as_str)
    {
        Some("manual") => SessionSortMode::Manual,
        _ => SessionSortMode::LastActivity,
    }
}

pub(super) fn detail_bool(session: &NativeSidebarSession, key: &str) -> bool {
    session.details.get(key).and_then(Value::as_bool) == Some(true)
}

pub(super) fn detail_str<'a>(session: &'a NativeSidebarSession, key: &str) -> Option<&'a str> {
    session.details.get(key).and_then(Value::as_str)
}

pub(super) fn detail_u64(session: &NativeSidebarSession, key: &str) -> u64 {
    session
        .details
        .get(key)
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

/// The git numbers the old runtime's background probe published for a project.
fn project_diff_stats(project_context: Option<&Value>) -> Option<(String, ProjectDiffStats)> {
    let editor = project_context?.get("editor")?;
    let project_id = editor.get("projectId").and_then(Value::as_str)?.to_string();
    let stats = editor.get("diffStats")?;
    let number = |key: &str| stats.get(key).and_then(Value::as_i64).unwrap_or_default();
    let flag = |key: &str| stats.get(key).and_then(Value::as_bool) == Some(true);
    Some((
        project_id,
        ProjectDiffStats {
            additions: number("additions"),
            deletions: number("deletions"),
            files: number("files"),
            is_loading: flag("isLoading"),
            is_repo: flag("isRepo"),
        },
    ))
}

/// The Close After Done timer of a row, which the old runtime still owns.
fn close_after_done(session: &NativeSidebarSession) -> Option<CloseAfterDoneInput> {
    let armed = detail_bool(session, "closeAfterDone");
    let deadline_at = detail_str(session, "closeAfterDoneDeadlineAt").map(str::to_string);
    let remaining_label = detail_str(session, "closeAfterDoneRemainingLabel").map(str::to_string);
    let remaining_ms = session
        .details
        .get("closeAfterDoneRemainingMs")
        .and_then(Value::as_i64);
    (armed || deadline_at.is_some() || remaining_label.is_some()).then_some(CloseAfterDoneInput {
        armed,
        deadline_at,
        remaining_label,
        remaining_ms,
    })
}

/// A row's Delayed Send. The daemon's own wins inside the view model, so mirroring the published
/// values here only fills in the ones this app's timers own.
fn delayed_send(session: &NativeSidebarSession) -> Option<DelayedSendInput> {
    let deadline_at = detail_str(session, "delayedSendDeadlineAt").map(str::to_string);
    let remaining_label = detail_str(session, "delayedSendRemainingLabel").map(str::to_string);
    let remaining_ms = session
        .details
        .get("delayedSendRemainingMs")
        .and_then(Value::as_i64);
    let all_stop = detail_bool(session, "sendWhenAllProjectSessionsStopActive");
    let agent_stop = detail_bool(session, "sendWhenAgentStopsActive");
    (deadline_at.is_some()
        || remaining_label.is_some()
        || remaining_ms.is_some()
        || all_stop
        || agent_stop)
        .then_some(DelayedSendInput {
            deadline_at,
            remaining_label,
            remaining_ms,
            send_when_all_project_sessions_stop_active: all_stop,
            send_when_agent_stops_active: agent_stop,
        })
}
