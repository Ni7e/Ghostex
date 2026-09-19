//! One sidebar row from one daemon session, and one from a browser tab.
//!
//! SEE-ALSO: packages/shared/gxserver-presentation-sidebar-projection.ts
//! (`createGxserverPresentationSidebarSession`) and apps/desktop/sidebar/native-sidebar/model.ts
//! (`projectNativeSidebarSession`).

use ghostex_gx_protocol::{LifecycleState, PresentationSession, SessionKind};

use crate::keys::SessionKey;

use super::agents::{resolve_agent_icon, BROWSER_AGENT_ICON};
use super::inputs::{BrowserTabInput, CloseAfterDoneInput, DelayedSendInput};
use super::session_text::{session_heading, session_tooltip, TitleInput};
use super::tags::{effective_tag, tag_presentation, TagCatalog};
use super::text::{encode_uri_component, js_trim, parse_iso_ms};
use super::view::{DelayedSendView, SessionRow, SessionTiming};

const GENERATING_TITLE_LABEL: &str = "Generating title...";

/// The per-row inputs that do not come from the session itself.
pub(crate) struct RowContext<'a> {
    pub(crate) catalog: &'a TagCatalog,
    pub(crate) debugging_mode: bool,
}

/// `combined-session:<project>:<session>`.
pub(crate) fn sidebar_session_id(project_id: &str, session_id: &str) -> String {
    format!(
        "combined-session:{}:{}",
        encode_uri_component(project_id),
        encode_uri_component(session_id)
    )
}

/// `gpui-browser:<project>:<tab>`.
pub(crate) fn browser_row_id(project_id: &str, tab_id: &str) -> String {
    format!(
        "gpui-browser:{}:{}",
        encode_uri_component(project_id),
        tab_id
    )
}

/// `presentationLifecycleStateForSidebar`.
fn sidebar_lifecycle_state(state: &LifecycleState) -> &'static str {
    match state {
        LifecycleState::Running => "running",
        LifecycleState::Sleeping => "sleeping",
        LifecycleState::Unknown => "error",
        LifecycleState::Other(value) if value == "missing" => "error",
        LifecycleState::Stopped | LifecycleState::Other(_) => "done",
    }
}

/// `providerSessionStateForGxserverPresentation`.
fn provider_session_state(session: &PresentationSession) -> String {
    let published = session.provider_session_state.as_str();
    if !published.is_empty() {
        return published.to_string();
    }
    match session.lifecycle_state {
        LifecycleState::Running => "exists".to_string(),
        LifecycleState::Sleeping | LifecycleState::Stopped => "missing".to_string(),
        LifecycleState::Other(ref value) if value == "missing" => "missing".to_string(),
        _ => "unknown".to_string(),
    }
}

/// `sessionKind`: an agent row is a terminal row to the sidebar.
fn session_kind(kind: &SessionKind) -> String {
    match kind {
        SessionKind::Agent | SessionKind::Terminal => "terminal".to_string(),
        SessionKind::Other(value) => value.clone(),
    }
}

/// The daemon's delayed send, when it published one; the host's own timer otherwise.
fn delayed_send(
    session: &PresentationSession,
    local: Option<&DelayedSendInput>,
) -> Option<DelayedSendView> {
    let server = session.delayed_send_deadline_at.is_some()
        || session.delayed_send_remaining_label.is_some()
        || session.delayed_send_remaining_ms.is_some()
        || session.send_when_all_project_sessions_stop_active == Some(true)
        || session.send_when_agent_stops_active == Some(true);
    if server {
        return Some(DelayedSendView {
            deadline_at: session.delayed_send_deadline_at.clone(),
            remaining_label: session.delayed_send_remaining_label.clone(),
            remaining_ms: session.delayed_send_remaining_ms,
            send_when_all_project_sessions_stop_active: session
                .send_when_all_project_sessions_stop_active
                == Some(true),
            send_when_agent_stops_active: session.send_when_agent_stops_active == Some(true),
        });
    }
    local.map(|local| DelayedSendView {
        deadline_at: local.deadline_at.clone(),
        remaining_label: local.remaining_label.clone(),
        remaining_ms: local.remaining_ms,
        send_when_all_project_sessions_stop_active: local
            .send_when_all_project_sessions_stop_active,
        send_when_agent_stops_active: local.send_when_agent_stops_active,
    })
}

/// A daemon session as a sidebar row.
pub(crate) fn session_row(
    key: SessionKey,
    session: &PresentationSession,
    close_after_done: Option<&CloseAfterDoneInput>,
    local_delayed_send: Option<&DelayedSendInput>,
    context: &RowContext<'_>,
) -> SessionRow {
    let lifecycle_state = sidebar_lifecycle_state(&session.lifecycle_state);
    let provider = provider_session_state(session);
    let is_live = provider == "exists";
    let agent_icon = resolve_agent_icon(
        session
            .agent_icon
            .as_deref()
            .or(session.agent_name.as_deref())
            .or(session.agent_id.as_deref()),
    );
    let delayed = delayed_send(session, local_delayed_send);
    let session_note = session
        .session_note
        .as_deref()
        .filter(|note| !js_trim(note).is_empty())
        .map(str::to_string);
    let effective = effective_tag(session.session_tag.as_deref(), session.is_favorite);
    let routing_id = format!("{}:{}", key.project_id, key.session_id);
    let alias = session.title.clone();
    let primary_title = Some(
        session
            .primary_title
            .clone()
            .unwrap_or_else(|| session.title.clone()),
    );
    let title_input = TitleInput {
        agent_icon,
        alias: &alias,
        display_title: session.display_title.as_deref(),
        display_title_tooltip: session.display_title_tooltip.as_deref(),
        is_browser: session_kind(&session.kind) == "browser",
        is_primary_title_terminal_title: session.is_primary_title_terminal_title,
        primary_title: primary_title.as_deref(),
        terminal_title: session.terminal_title.as_deref(),
        detail: session.subtitle.as_deref(),
        session_note: session_note.as_deref(),
        pending_question_count: session.pending_question_count,
        activity: session.activity.as_str(),
        delayed_send_remaining_label: delayed
            .as_ref()
            .and_then(|delayed| delayed.remaining_label.as_deref()),
        close_after_done,
        effective_tag: effective.as_deref(),
        is_live: Some(is_live),
        is_running: Some(is_live),
        is_sleeping: Some(lifecycle_state == "sleeping"),
        lifecycle_state: Some(lifecycle_state),
        native_pane_state: None,
        provider_session_state: Some(provider.as_str()),
        session_persistence_provider: session
            .session_persistence_provider
            .as_ref()
            .map(|provider| provider.as_str()),
        session_persistence_name: Some(session.zmx_name.as_str()),
        session_routing_id: Some(routing_id.as_str()),
        session_number: None,
        agent_session_id: session.agent_session_id.as_deref(),
    };
    let heading = session_heading(&title_input, false);
    let tooltip = session_tooltip(&title_input, context.catalog, context.debugging_mode, false);
    let last_interaction_at = session
        .meaningful_activity_at
        .clone()
        .or_else(|| session.last_active_at.clone())
        .or_else(|| Some(session.updated_at.clone()));

    let session_kind = session_kind(&session.kind);
    SessionRow {
        sidebar_session_id: sidebar_session_id(&key.project_id, &key.session_id),
        // `kind === 'browser' || sessionKind === 'browser'` everywhere in the TypeScript; a
        // daemon row of that kind is a browser row wherever the sidebar asks.
        is_browser: session_kind == "browser",
        browser_is_active: false,
        browser_is_visible: false,
        alias,
        display_title: if session.is_generating_first_prompt_title {
            GENERATING_TITLE_LABEL.to_string()
        } else {
            heading
        },
        title_tooltip: tooltip,
        activity: session.activity.as_str().to_string(),
        pending_question_count: session.pending_question_count,
        agent_icon: agent_icon.map(str::to_string),
        session_kind: Some(session_kind),
        lifecycle_state: lifecycle_state.to_string(),
        is_pinned: session.is_pinned,
        is_parked: session.is_parked,
        is_draft: session.is_draft,
        is_favorite: session.is_favorite,
        session_tag: session.session_tag.clone(),
        tag_presentation: tag_presentation(effective.as_deref(), context.catalog),
        effective_tag: effective,
        timing: SessionTiming {
            created_ms: parse_iso_ms(&session.created_at),
            created_at: Some(session.created_at.clone()),
            last_interaction_ms: last_interaction_at.as_deref().and_then(parse_iso_ms),
            working_started_ms: session.working_started_at.as_deref().and_then(parse_iso_ms),
            snoozed_until_ms: session.snoozed_until.as_deref().and_then(parse_iso_ms),
        },
        last_interaction_at,
        session_note,
        favicon_data_url: None,
        has_composer_draft: session.has_composer_draft,
        queued_prompt_count: session.queued_prompt_count.filter(|count| *count > 0),
        queued_prompt_failed_count: session
            .queued_prompt_failed_count
            .filter(|count| *count > 0),
        delayed_send: delayed,
        close_after_done: close_after_done.cloned(),
        is_generating_first_prompt_title: session.is_generating_first_prompt_title,
        key: Some(key),
    }
}

/// A browser tab as a sidebar row. Browser tabs are host state, not sessions, so the row carries
/// no store key.
pub(crate) fn browser_row(tab: &BrowserTabInput, context: &RowContext<'_>) -> SessionRow {
    let lifecycle_state = if tab.is_sleeping {
        "sleeping"
    } else {
        "running"
    };
    let native_pane_state = if tab.is_sleeping {
        "unmounted"
    } else {
        "mounted"
    };
    let title_input = TitleInput {
        agent_icon: Some(BROWSER_AGENT_ICON),
        alias: &tab.title,
        display_title: Some(tab.title.as_str()),
        is_browser: true,
        primary_title: Some(tab.title.as_str()),
        activity: "idle",
        is_live: Some(!tab.is_sleeping),
        is_running: Some(!tab.is_sleeping),
        is_sleeping: Some(tab.is_sleeping),
        lifecycle_state: Some(lifecycle_state),
        native_pane_state: Some(native_pane_state),
        ..TitleInput::default()
    };
    SessionRow {
        sidebar_session_id: browser_row_id(&tab.project_id, &tab.tab_id),
        key: None,
        is_browser: true,
        alias: tab.title.clone(),
        display_title: session_heading(&title_input, false),
        title_tooltip: session_tooltip(
            &title_input,
            context.catalog,
            context.debugging_mode,
            false,
        ),
        activity: "idle".to_string(),
        agent_icon: Some(BROWSER_AGENT_ICON.to_string()),
        session_kind: Some("browser".to_string()),
        lifecycle_state: lifecycle_state.to_string(),
        favicon_data_url: tab.favicon_url.clone(),
        browser_is_active: tab.is_active,
        browser_is_visible: tab.is_visible,
        ..SessionRow::default()
    }
}
