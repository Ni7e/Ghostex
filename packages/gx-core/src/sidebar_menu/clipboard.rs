//! The text Copy Details puts on the clipboard.
//!
//! SEE-ALSO: packages/shared/session-details-copy.ts, which records the decision that this copies
//! stable row metadata and never terminal output or the saved first prompt.

use crate::sidebar_view::view::SessionRow;

use super::text::{format_identifier, js_trim};

/// The project facts the text quotes.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct DetailsGroup<'a> {
    pub(crate) title: &'a str,
    pub(crate) project_path: Option<&'a str>,
    pub(crate) worktree_name: Option<&'a str>,
    pub(crate) worktree_branch: Option<&'a str>,
    pub(crate) parent_project_name: Option<&'a str>,
    pub(crate) remote_machine_name: Option<&'a str>,
    pub(crate) server_id: Option<&'a str>,
}

/// `buildSidebarSessionDetailsClipboardText`.
pub(crate) fn session_details_text(row: &SessionRow, group: &DetailsGroup<'_>) -> String {
    let facts = &row.menu_facts;
    let title = first_non_empty(&[
        facts.raw_display_title.as_deref(),
        facts.primary_title.as_deref(),
        Some(row.alias.as_str()),
    ]);
    let mut lines: Vec<String> = vec!["Ghostex Session".to_string()];
    let mut line = |label: &str, value: Option<&str>| {
        if let Some(value) = value {
            let value = js_trim(value);
            if !value.is_empty() {
                lines.push(format!("{label}: {value}"));
            }
        }
    };
    line("Title", Some(&title));
    line("Alias", (row.alias != title).then_some(row.alias.as_str()));
    line("Session ID", Some(&row.sidebar_session_id));
    line(
        "Routing ID",
        facts
            .session_routing_id
            .as_deref()
            .filter(|routing| *routing != row.sidebar_session_id),
    );
    /*
    CDXC:Cli 2026-09-24 DECISION:
    The user asked that the copied block carry the one id every `ghostex` verb takes, so an agent
    handed it can read or message that thread without guessing: `<server>:<project>:<session>`.
    */
    let global_ref = match (group.server_id, row.key.as_ref()) {
        (Some(server_id), Some(key)) => {
            Some(format!("{server_id}:{}:{}", key.project_id, key.session_id))
        }
        _ => None,
    };
    line("Global Ref", global_ref.as_deref());
    let kind = format_identifier(row.session_kind.as_deref().unwrap_or("terminal"));
    line("Kind", Some(&kind));
    line("Status", Some(&row.lifecycle_state));
    line("Activity", Some(&row.activity));
    let agent = row.agent_icon.as_deref().map(format_identifier);
    line("Agent", agent.as_deref());
    line("Agent Session ID", facts.agent_session_id.as_deref());
    line(
        "Terminal Title",
        facts
            .terminal_title
            .as_deref()
            .filter(|terminal| *terminal != title),
    );
    line("Detail", facts.detail.as_deref());
    let persistence = persistence(row);
    line("Persistence", persistence.as_deref());
    line("Remote Machine", group.remote_machine_name);
    line("Project", Some(group.title));
    line("Project Path", group.project_path);
    line("Worktree", group.worktree_name);
    line("Worktree Branch", group.worktree_branch);
    line("Parent Project", group.parent_project_name);
    line("Last Active", row.last_interaction_at.as_deref());
    lines.join("\n")
}

/// `pickFirstNonEmpty`: the first value with non-whitespace in it, trimmed, else `Session`.
fn first_non_empty(values: &[Option<&str>]) -> String {
    for value in values {
        if let Some(value) = value {
            let trimmed = js_trim(value);
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    "Session".to_string()
}

/// `formatPersistence`.
fn persistence(row: &SessionRow) -> Option<String> {
    let provider = row
        .menu_facts
        .session_persistence_provider
        .as_deref()
        .filter(|value| !value.is_empty());
    let name = row
        .menu_facts
        .session_persistence_name
        .as_deref()
        .filter(|value| !value.is_empty());
    match (provider, name) {
        (None, None) => None,
        (Some(provider), Some(name)) => Some(format!("{provider} ({name})")),
        (Some(provider), None) => Some(provider.to_string()),
        (None, Some(name)) => Some(name.to_string()),
    }
}
