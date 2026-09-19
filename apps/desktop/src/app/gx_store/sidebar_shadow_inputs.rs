//! The inputs the Rust sidebar view model is built from while the old projection still owns them.
//!
//! Per field, the value comes from wherever it is most faithful: the sidebar's own UI state is
//! mirrored from the snapshot the old projection just published (it is the exact state that
//! projection used), the settings and the browser tabs come from this app's own copies, and the
//! hidden items are read from the client storage the sidebar persists them in, because a hidden
//! project is absent from the snapshot and cannot be mirrored.

use ghostex_gx_core::{
    BrowserTabInput, CloseAfterDoneInput, DelayedSendInput, ProjectDiffStats, SectionCollapse,
    SectionId, SessionSortMode, SidebarHostInputs, SidebarInputs, SidebarSettings, SidebarUiState,
    UnavailableState,
};
use serde_json::Value;

use super::sidebar_shadow_storage::StoredSidebarState;
use crate::app::native_sidebar::model::{NativeSidebarSession, NativeSidebarSnapshot};

/// Most browser tabs the host publishes; the same bound the sidebar runtime applies.
const MAX_BROWSER_TABS: usize = 256;
/// `GPUI_SIDEBAR_BROWSER_FAVICON_URL_MAX_CHARS`, the bound the sidebar runtime measures a favicon
/// URL against, before and after normalizing it. Kept here rather than borrowed from this app's
/// own favicon bound, which is a different contract that happens to hold the same number.
const FAVICON_URL_MAX_CHARS: usize = 2048;

/// Builds everything the view model reads from the snapshot the old projection published, this
/// app's browser tabs, and the persisted hidden items.
pub(super) fn mirror_inputs(
    snapshot: &NativeSidebarSnapshot,
    browser_tabs_json: &str,
    settings: SidebarSettings,
    stored: StoredSidebarState,
    unavailable: UnavailableState,
) -> SidebarInputs {
    let mut ui = SidebarUiState {
        selected_machine_id: snapshot.selected_machine_id.clone(),
        hidden_items: stored.hidden_items,
        ..SidebarUiState::default()
    };
    let section_key = ui.section_key();
    if let Some(space_id) = snapshot
        .scroll_scope
        .split_once('|')
        .map(|(_, space_id)| space_id)
        .filter(|space_id| !space_id.is_empty() && *space_id != "all")
    {
        ui.collapse
            .selected_space_by_section
            .insert(section_key.clone(), space_id.to_string());
    }
    for group in &snapshot.groups {
        if group.collapsed {
            ui.collapse.collapsed_groups.insert(group.group_id.clone());
        }
        if group.expanded {
            ui.collapse
                .expanded_session_lists
                .insert(group.storage_id.clone());
        }
        if group.hover_actions_expanded {
            ui.collapse
                .expanded_hover_actions
                .insert(group.storage_id.clone());
        }
        let mut sections = SectionCollapse::default();
        for section in &group.sections {
            if let Some(id) = section_id(&section.id) {
                sections.set(id, section.collapsed);
            }
        }
        ui.collapse
            .section_collapse
            .insert(group.storage_id.clone(), sections);
        for session in &group.sessions {
            if detail_bool(session, "isMultiSelected") {
                ui.selected_session_ids.push(session.session_id.clone());
            }
        }
    }
    for collection in &snapshot.collections {
        if collection.collapsed {
            ui.collapse
                .collapsed_collections
                .insert(collection.storage_id.clone());
        }
    }
    let (show_hidden, tag_filters) = more_menu_state(&snapshot.more_menu);
    ui.show_hidden = show_hidden;
    ui.selected_tag_filters = tag_filters;

    let recent_projects = snapshot
        .hud
        .get("recentProjects")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let mut host = SidebarHostInputs {
        browser_tabs: browser_tabs(browser_tabs_json),
        // The projection hides a parked project by its own id; a remote machine's entry carries a
        // machine-scoped one and belongs to that machine's section.
        recent_project_ids: recent_projects
            .iter()
            .filter(|project| project.get("remoteMachineId").is_none())
            .filter_map(|project| project.get("projectId").and_then(Value::as_str))
            .map(str::to_string)
            .collect(),
        recent_project_count: recent_projects.len(),
        stored_project_collections: stored.project_collections,
        unavailable,
        ..SidebarHostInputs::default()
    };
    for group in &snapshot.groups {
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

    SidebarInputs { ui, settings, host }
}

/// The sort mode the old projection used, from the HUD it published.
pub(super) fn sort_mode(snapshot: &NativeSidebarSnapshot) -> SessionSortMode {
    match snapshot
        .hud
        .get("activeSessionsSortMode")
        .and_then(Value::as_str)
    {
        Some("manual") => SessionSortMode::Manual,
        _ => SessionSortMode::LastActivity,
    }
}

fn section_id(value: &str) -> Option<SectionId> {
    Some(match value {
        "browser" => SectionId::Browser,
        "pinned" => SectionId::Pinned,
        "drafts" => SectionId::Drafts,
        "sessions" => SectionId::Sessions,
        "parked" => SectionId::Parked,
        "snoozed" => SectionId::Snoozed,
        _ => return None,
    })
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

/// Show Hidden and the ticked tag filters, which only the "more" menu of the snapshot reveals.
fn more_menu_state(more_menu: &Value) -> (bool, Vec<String>) {
    let mut show_hidden = false;
    let mut filters: Vec<String> = Vec::new();
    let mut walk: Vec<&Value> = more_menu.as_array().into_iter().flatten().collect();
    while let Some(item) = walk.pop() {
        if let Some(children) = item.get("children").and_then(Value::as_array) {
            walk.extend(children);
        }
        let Some(command) = item.get("command") else {
            continue;
        };
        match command.get("type").and_then(Value::as_str) {
            Some("sidebarAction")
                if command.get("action").and_then(Value::as_str) == Some("showHidden") =>
            {
                show_hidden = item.get("checked").and_then(Value::as_bool) == Some(true);
            }
            Some("toggleTagFilter")
                if item.get("checked").and_then(Value::as_bool) == Some(true) =>
            {
                if let Some(tag) = command.get("tag").and_then(Value::as_str) {
                    filters.push(tag.to_string());
                }
            }
            _ => {}
        }
    }
    (show_hidden, filters)
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
                title: non_empty("title")?,
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
