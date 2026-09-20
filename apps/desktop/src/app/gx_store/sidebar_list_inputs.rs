//! The inputs the Rust sidebar list is built from besides the store.
//!
//! CDXC:Sidebar 2026-09-20 WHY:
//! Three kinds of value meet here and the file keeps them apart on purpose. The sidebar's own
//! state (collapse, Space, filters, hidden items, selection) is the Rust store's, owned since
//! M4b. The browser tabs, the stored collections and the unavailable clock are this app's own
//! facts. The rest are still read from the snapshot the old projection publishes, because their
//! real source has not moved into Rust yet: the sort mode and the Recent Projects come from the
//! daemon's sidebar HUD, the git numbers from the old runtime's background probe, and the Close
//! After Done and Delayed Send timers from the runtime that owns them. Each of those is handed to
//! M5 with the HUD and the session lifecycle; until then they are mirrored here and nowhere else,
//! so there is one list of what is still borrowed.

use ghostex_gx_core::{
    BrowserTabInput, CloseAfterDoneInput, DelayedSendInput, MachineTabInput, ProjectDiffStats,
    SessionSortMode, SidebarHostInputs, SidebarInputs, SidebarSettings, SidebarUiState,
    UnavailableState,
};
use serde_json::Value;

use crate::app::native_sidebar::model::{NativeSidebarSession, NativeSidebarSnapshot};

/// Most browser tabs the host publishes; the same bound the sidebar runtime applies.
const MAX_BROWSER_TABS: usize = 256;
/// `GPUI_SIDEBAR_BROWSER_FAVICON_URL_MAX_CHARS`, the bound the sidebar runtime measures a favicon
/// URL against, before and after normalizing it. Kept here rather than borrowed from this app's
/// own favicon bound, which is a different contract that happens to hold the same number.
const FAVICON_URL_MAX_CHARS: usize = 2048;
/// The bound `normalizeGpuiBrowserTabs` slices a tab title to, in UTF-16 code units.
const BROWSER_TITLE_MAX_CHARS: usize = 512;

/// What the assembled inputs were built from, so an update that changes none of it does no work.
#[derive(Default)]
pub(super) struct InputsCache {
    /// Identity of the sidebar's own state: bumped by every intent and by the restore.
    ui_generation: u64,
    /// Contents of the browser tab list this app last published, which arrives as JSON.
    browser_tabs_hash: Option<u64>,
    /// Address of the snapshot the mirrored values were taken from.
    published: Option<usize>,
    /// The machine tabs as the last refresh saw them.
    machines: Option<Vec<MachineTabInput>>,
    stored_collections: Option<Option<Value>>,
    settings: Option<SidebarSettings>,
    unavailable: Option<UnavailableState>,
}

/// Brings the assembled inputs up to date in place. Each part is rebuilt only when its own source
/// moved, so a pump that changed one session does not re-parse the browser tabs or re-read every
/// published row.
#[allow(clippy::too_many_arguments)]
pub(super) fn refresh_inputs(
    inputs: &mut SidebarInputs,
    cache: &mut InputsCache,
    ui: &SidebarUiState,
    ui_generation: u64,
    settings: SidebarSettings,
    published: Option<&NativeSidebarSnapshot>,
    browser_tabs_json: &str,
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
    let browser_hash = text_hash(browser_tabs_json);
    if cache.browser_tabs_hash != Some(browser_hash) {
        cache.browser_tabs_hash = Some(browser_hash);
        inputs.host.browser_tabs = browser_tabs(browser_tabs_json);
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

fn text_hash(value: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
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

/// The browser tabs this app last published to the sidebar runtime, read back with the same
/// normalization that runtime applies.
fn browser_tabs(json: &str) -> Vec<BrowserTabInput> {
    let Ok(Value::Array(tabs)) = serde_json::from_str::<Value>(json) else {
        return Vec::new();
    };
    tabs.into_iter()
        .take(MAX_BROWSER_TABS)
        .filter_map(|tab| {
            let non_empty = |key: &str| {
                tab.get(key)
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
                    .map(str::to_string)
            };
            Some(BrowserTabInput {
                project_id: non_empty("projectId")?,
                tab_id: non_empty("tabId")?,
                // `normalizeGpuiBrowserTabs` slices the title; leaving it whole here gave the
                // store's row a longer title than the published one for a tab whose page has a
                // title over the bound, and every field derived from it (the heading, the alias,
                // the tooltip) then differed for as long as that tab was open.
                title: js_slice_utf16(&non_empty("title")?, BROWSER_TITLE_MAX_CHARS),
                favicon_url: tab
                    .get("faviconUrl")
                    .and_then(Value::as_str)
                    .and_then(normalized_favicon_url),
                is_active: tab.get("isActive").and_then(Value::as_bool) == Some(true),
                is_sleeping: tab.get("isSleeping").and_then(Value::as_bool) == Some(true),
                is_visible: tab.get("isVisible").and_then(Value::as_bool) == Some(true),
            })
        })
        .collect()
}

/// A favicon URL as the sidebar runtime keeps it, or `None` where the runtime drops it.
///
/// `normalizeGpuiBrowserFaviconUrl` (apps/desktop/sidebar/gxserver-runtime/helpers/browser-tabs.ts)
/// trims, measures the value against its bound, parses it, requires `http` or `https` after the
/// parser has lowercased the scheme, rejects a username or a password, requires a host, strips
/// the fragment, and measures what it serialized against the same bound. All of that is done
/// here, because a value the runtime drops is a value this mirror must drop too: when the
/// normalized list comes out unchanged the runtime publishes nothing, and a difference made here
/// would then never resolve.
///
/// The two parts left out are the stored spelling and the parser's own escapes: the string is
/// built only to be measured and is then dropped, because the comparison reads presence alone,
/// and where this parser and the WHATWG one spell an odd escape differently they differ in the
/// characters, never in whether there are any.
fn normalized_favicon_url(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || utf16_len(trimmed) > FAVICON_URL_MAX_CHARS {
        return None;
    }
    let mut parsed = gpui::http_client::Url::parse(trimmed).ok()?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.host_str().is_none_or(str::is_empty)
    {
        return None;
    }
    parsed.set_fragment(None);
    let normalized = parsed.to_string();
    (utf16_len(&normalized) <= FAVICON_URL_MAX_CHARS).then_some(normalized)
}

/// The length JavaScript measures, which is code units rather than characters or bytes.
fn utf16_len(value: &str) -> usize {
    value.chars().map(char::len_utf16).sum()
}

/// `value.slice(0, max)`: JavaScript counts UTF-16 code units, so a character outside the basic
/// plane counts twice.
///
/// The one case this cannot reproduce is a cut that lands between the two halves of such a
/// character: JavaScript keeps the first half as a lone surrogate, which is not a string Rust can
/// hold. The character is dropped whole instead, so the two differ by one character in a title
/// that is already being cut at exactly that boundary.
fn js_slice_utf16(value: &str, max: usize) -> String {
    if utf16_len(value) <= max {
        return value.to_string();
    }
    let mut taken = 0usize;
    let mut sliced = String::new();
    for character in value.chars() {
        let width = character.len_utf16();
        if taken + width > max {
            break;
        }
        taken += width;
        sliced.push(character);
    }
    sliced
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
