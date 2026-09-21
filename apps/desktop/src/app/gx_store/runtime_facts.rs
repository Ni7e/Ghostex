//! The runtime's one-way facts channel, and the comparison that proves it carries what the old
//! projection's publish carried.
//!
//! CDXC:Sidebar 2026-09-21 DECISION:
//! User (M4d part 2, question 1 option A): the facts the Rust sidebar still borrows from the
//! deleted page (the sidebar HUD, a project's git numbers, the Close After Done and Delayed Send
//! timers, and a reveal request) arrive on a narrow one-way channel the runtime posts, rather than
//! by porting the HUD and the timers into Rust now. The channel has no diffing and no patches and
//! dies with QuickJS in M8.
//!
//! CDXC:Sidebar 2026-09-21 WHY:
//! This step only INGESTS and COMPARES: every reader still takes its value from the publish
//! (`sidebar_list_inputs.rs`, `sidebar_snapshot.rs`), and the counters here say whether the two
//! agree. A clock-derived field cannot be compared that way, because the publish computes
//! `remainingMs` and `remainingLabel` when it projects and the channel computes them when it
//! posts, so the comparison judges `armed`, the deadline and the two send-when flags and carries
//! the rest for the reader that follows in step 3.
//!
//! SEE-ALSO: apps/desktop/sidebar/gxserver-runtime/sidebar-runtime-facts.ts,
//! apps/desktop/src/app/gx_store/diagnostics_runtime_facts.rs.

use std::collections::HashMap;

use ghostex_gx_core::{CloseAfterDoneInput, DelayedSendInput, ProjectDiffStats};
use serde_json::Value;

use crate::GhostexGpuiApp;
use crate::app::native_sidebar::model::NativeSidebarSnapshot;

/// What the channel has delivered, beside what the publish carries.
#[derive(Default)]
pub(crate) struct SidebarRuntimeFacts {
    /// The sidebar HUD as the zustand store holds it, which is the object the projection publishes.
    pub(super) hud: Option<Value>,
    pub(super) project_diff_stats: HashMap<String, ProjectDiffStats>,
    pub(super) close_after_done: HashMap<String, CloseAfterDoneInput>,
    pub(super) delayed_sends: HashMap<String, DelayedSendInput>,
    /// The newest reveal the runtime asked for: its sidebar session id and its request id.
    pub(super) reveal: Option<(String, u64)>,
    /// The reveals this app asked for itself (the titlebar's Reveal Active Session), which the
    /// runtime never sees and the publish carries all the same.
    pub(super) local_reveals: Vec<u64>,
    pub(super) counters: RuntimeFactsCounters,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct RuntimeFactsCounters {
    pub(super) hud_posts: u64,
    pub(super) row_posts: u64,
    pub(super) reveal_posts: u64,
    pub(super) unparsable: u64,
    /// Publishes compared, and the ones that arrived before the channel had said anything.
    pub(super) comparisons: u64,
    pub(super) before_first_post: u64,
    pub(super) hud_differences: u64,
    pub(super) project_diff_stats_differences: u64,
    pub(super) close_after_done_differences: u64,
    pub(super) delayed_send_differences: u64,
    pub(super) reveal_differences: u64,
    /// A row the publish has a Delayed Send for and the channel has not. Not a difference: the
    /// daemon's own delayed sends ride the presentation and this app's timers never hold them.
    pub(super) delayed_send_publish_only: u64,
}

/// The number of local reveal request ids kept, which is one per Reveal Active Session press.
const MAX_LOCAL_REVEALS: usize = 8;

impl GhostexGpuiApp {
    /// A channel payload. Parsed into the parallel fields; nothing here is read by the list yet.
    pub(crate) fn receive_sidebar_runtime_facts(&mut self, payload: &str) {
        let Ok(value) = serde_json::from_str::<Value>(payload) else {
            self.gx_store.runtime_facts.counters.unparsable += 1;
            return;
        };
        let facts = &mut self.gx_store.runtime_facts;
        match value.get("kind").and_then(Value::as_str) {
            Some("hud") => {
                facts.hud = value.get("hud").cloned();
                facts.counters.hud_posts += 1;
            }
            Some("rows") => {
                facts.project_diff_stats = value
                    .get("projectDiffStats")
                    .and_then(Value::as_object)
                    .map(|entries| {
                        entries
                            .iter()
                            .map(|(id, stats)| (id.clone(), project_diff_stats(stats)))
                            .collect()
                    })
                    .unwrap_or_default();
                facts.close_after_done = value
                    .get("closeAfterDone")
                    .and_then(Value::as_object)
                    .map(|entries| {
                        entries
                            .iter()
                            .map(|(id, entry)| (id.clone(), close_after_done(entry)))
                            .collect()
                    })
                    .unwrap_or_default();
                facts.delayed_sends = value
                    .get("delayedSend")
                    .and_then(Value::as_object)
                    .map(|entries| {
                        entries
                            .iter()
                            .map(|(id, entry)| (id.clone(), delayed_send(entry)))
                            .collect()
                    })
                    .unwrap_or_default();
                facts.counters.row_posts += 1;
            }
            Some("reveal") => {
                let session_id = value.get("sessionId").and_then(Value::as_str);
                let request_id = value.get("requestId").and_then(Value::as_u64);
                if let (Some(session_id), Some(request_id)) = (session_id, request_id) {
                    facts.reveal = Some((session_id.to_string(), request_id));
                    facts.counters.reveal_posts += 1;
                } else {
                    facts.counters.unparsable += 1;
                }
            }
            _ => facts.counters.unparsable += 1,
        }
    }

    /// Remembers a reveal this app asked the page for itself, so the comparison does not read it as
    /// a reveal the channel lost.
    pub(crate) fn gx_store_note_local_sidebar_reveal(&mut self, request_id: u64) {
        let reveals = &mut self.gx_store.runtime_facts.local_reveals;
        reveals.push(request_id);
        if reveals.len() > MAX_LOCAL_REVEALS {
            reveals.remove(0);
        }
    }

    /// Compares the channel with the publish it is meant to replace, one counter per family.
    pub(crate) fn gx_store_compare_sidebar_runtime_facts(
        &mut self,
        published: &NativeSidebarSnapshot,
    ) {
        let published_diff_stats = published_project_diff_stats(published);
        let published_close_after_done = published_close_after_done(published);
        let published_delayed_sends = published_delayed_sends(published);
        let facts = &mut self.gx_store.runtime_facts;
        facts.counters.comparisons += 1;
        let Some(hud) = facts.hud.as_ref() else {
            // The service seeds the store's HUD before the runtime has posted anything
            // (`sidebar/service/start.ts`), so the first publishes of a launch have nothing to be
            // compared with.
            facts.counters.before_first_post += 1;
            return;
        };
        if *hud != published.hud {
            facts.counters.hud_differences += 1;
        }
        for (project_id, stats) in &published_diff_stats {
            if facts.project_diff_stats.get(project_id) != Some(stats) {
                facts.counters.project_diff_stats_differences += 1;
            }
        }
        for (session_id, close) in &published_close_after_done {
            let channel = facts.close_after_done.get(session_id);
            if channel.map(|entry| (entry.armed, entry.deadline_at.as_deref()))
                != Some((close.armed, close.deadline_at.as_deref()))
            {
                facts.counters.close_after_done_differences += 1;
            }
        }
        for (session_id, delayed) in &published_delayed_sends {
            let Some(channel) = facts.delayed_sends.get(session_id) else {
                facts.counters.delayed_send_publish_only += 1;
                continue;
            };
            if (
                channel.deadline_at.as_deref(),
                channel.send_when_all_project_sessions_stop_active,
                channel.send_when_agent_stops_active,
            ) != (
                delayed.deadline_at.as_deref(),
                delayed.send_when_all_project_sessions_stop_active,
                delayed.send_when_agent_stops_active,
            ) {
                facts.counters.delayed_send_differences += 1;
            }
        }
        if let Some(request) = &published.reveal_request {
            let channel_has = facts
                .reveal
                .as_ref()
                .is_some_and(|(session_id, request_id)| {
                    *request_id == request.request_id && *session_id == request.session_id
                });
            let asked_here = facts.local_reveals.contains(&request.request_id);
            if !channel_has && !asked_here {
                facts.counters.reveal_differences += 1;
            }
        }
    }
}

fn project_diff_stats(stats: &Value) -> ProjectDiffStats {
    let number = |key: &str| stats.get(key).and_then(Value::as_i64).unwrap_or_default();
    let flag = |key: &str| stats.get(key).and_then(Value::as_bool) == Some(true);
    ProjectDiffStats {
        additions: number("additions"),
        deletions: number("deletions"),
        files: number("files"),
        is_loading: flag("isLoading"),
        is_repo: flag("isRepo"),
    }
}

fn close_after_done(entry: &Value) -> CloseAfterDoneInput {
    CloseAfterDoneInput {
        armed: entry.get("armed").and_then(Value::as_bool) == Some(true),
        deadline_at: text(entry, "deadlineAt"),
        remaining_label: text(entry, "remainingLabel"),
        remaining_ms: entry.get("remainingMs").and_then(Value::as_i64),
    }
}

fn delayed_send(entry: &Value) -> DelayedSendInput {
    DelayedSendInput {
        deadline_at: text(entry, "deadlineAt"),
        remaining_label: text(entry, "remainingLabel"),
        remaining_ms: entry.get("remainingMs").and_then(Value::as_i64),
        send_when_all_project_sessions_stop_active: entry
            .get("sendWhenAllProjectSessionsStopActive")
            .and_then(Value::as_bool)
            == Some(true),
        send_when_agent_stops_active: entry
            .get("sendWhenAgentStopsActive")
            .and_then(Value::as_bool)
            == Some(true),
    }
}

fn text(entry: &Value, key: &str) -> Option<String> {
    entry.get(key).and_then(Value::as_str).map(str::to_string)
}

fn detail_text(details: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    details.get(key).and_then(Value::as_str).map(str::to_string)
}

fn detail_flag(details: &serde_json::Map<String, Value>, key: &str) -> bool {
    details.get(key).and_then(Value::as_bool) == Some(true)
}

/// The same reads `sidebar_list_inputs.rs` performs on a publish, so the two sides of the
/// comparison are the value the list uses today and the value it will use in step 3.
fn published_project_diff_stats(
    published: &NativeSidebarSnapshot,
) -> Vec<(String, ProjectDiffStats)> {
    published
        .groups
        .iter()
        .filter_map(|group| {
            let editor = group.project_context.as_ref()?.get("editor")?;
            let project_id = editor.get("projectId").and_then(Value::as_str)?.to_string();
            Some((project_id, project_diff_stats(editor.get("diffStats")?)))
        })
        .collect()
}

fn published_close_after_done(
    published: &NativeSidebarSnapshot,
) -> Vec<(String, CloseAfterDoneInput)> {
    published
        .groups
        .iter()
        .flat_map(|group| group.sessions.iter())
        .filter_map(|session| {
            let armed = detail_flag(&session.details, "closeAfterDone");
            let deadline_at = detail_text(&session.details, "closeAfterDoneDeadlineAt");
            (armed || deadline_at.is_some()).then(|| {
                (
                    session.session_id.clone(),
                    CloseAfterDoneInput {
                        armed,
                        deadline_at,
                        remaining_label: None,
                        remaining_ms: None,
                    },
                )
            })
        })
        .collect()
}

fn published_delayed_sends(published: &NativeSidebarSnapshot) -> Vec<(String, DelayedSendInput)> {
    published
        .groups
        .iter()
        .flat_map(|group| group.sessions.iter())
        .filter_map(|session| {
            let deadline_at = detail_text(&session.details, "delayedSendDeadlineAt");
            let all_stop = detail_flag(&session.details, "sendWhenAllProjectSessionsStopActive");
            let agent_stop = detail_flag(&session.details, "sendWhenAgentStopsActive");
            (deadline_at.is_some() || all_stop || agent_stop).then(|| {
                (
                    session.session_id.clone(),
                    DelayedSendInput {
                        deadline_at,
                        remaining_label: None,
                        remaining_ms: None,
                        send_when_all_project_sessions_stop_active: all_stop,
                        send_when_agent_stops_active: agent_stop,
                    },
                )
            })
        })
        .collect()
}
