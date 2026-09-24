//! "Trust and Remember": folders whose agent workspace-trust prompts Ghostex
//! answers on the user's behalf, for every agent, from then on.

use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

use serde_json::{json, Map, Value};

use crate::domain::{DomainRepository, DomainStateError};
use crate::session_chat_notice::{
    classify_session_chat_terminal_notice, SessionChatTerminalNotice,
    SessionChatTerminalNoticeAction, SessionChatTerminalNoticeActionKind,
    SESSION_CHAT_NOTICE_TRUST_PROMPT,
};
use crate::session_chat_options::{session_chat_option_agent, SessionChatOptionAgent};
use crate::session_chat_send::{
    build_terminal_picker_answer_steps, capture_session_terminal_text, execute_session_chat_send,
    SessionChatSendStep, SessionChatSendTarget,
};

/*
CDXC:AgentScreenDetection 2026-09-22 DECISION:
User: add a "Trust and Remember" button to the folder-trust notice that trusts
the project automatically from any AI agent from then on, whether the same
agent or another one.

User: show no card or any UI while a remembered folder is being trusted
automatically; worktrees are not inside the main folder (usually a sibling or
a far-away folder), so cover them through their parent project, not by path
nesting.

The remembered folders are gxserver state (one list per machine, shared by
every chat surface), and answering is screen-derived: a remembered folder's
trust prompt is accepted with the same keystrokes the card's own Trust button
would send for that agent, re-read from a fresh capture, never a blind Enter.
A session's candidate folders are its working directory, its project's root,
and (for a worktree project) the parent project's root, so remembering from
any of them covers the whole family, and a remembered prompt is hidden from
clients (`session_chat_notice_hidden`) while it is being answered.
Claude's older "Do you trust the files in this folder?" wording has no safe
keystroke (its mid-session variant focuses Cancel), so that one screen still
has to be answered in the terminal even when the folder is remembered.
*/

const STORE_FILE: &str = "workspace-trust.json";
const STORE_VERSION: u64 = 1;
/// A prompt that survives an accept is not retried faster than this, so a
/// dialog that refuses to close never receives a stream of keystrokes.
const AUTO_TRUST_RETRY_INTERVAL: Duration = Duration::from_secs(20);

fn store_path() -> std::path::PathBuf {
    ghostex_paths::GhostexPaths::resolve()
        .gxserver_state_dir()
        .join(STORE_FILE)
}

/// One spelling per folder: `~` expanded, symlinks resolved when the folder
/// exists (`/tmp` and `/private/tmp` are the same place on macOS, and an
/// agent may report either as its cwd), trailing separators dropped.
fn normalize_folder(path: &str) -> Option<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }
    let expanded = crate::resume_lookup::expand_home(trimmed);
    let expanded = std::fs::canonicalize(&expanded).unwrap_or(expanded);
    let text = expanded.to_string_lossy();
    let normalized = text.trim_end_matches(['/', '\\']);
    if normalized.is_empty() {
        Some(text.to_string())
    } else {
        Some(normalized.to_string())
    }
}

fn folder_covers(remembered: &str, candidate: &str) -> bool {
    candidate == remembered
        || candidate
            .strip_prefix(remembered)
            .is_some_and(|rest| rest.starts_with(['/', '\\']))
}

/// Every remembered folder, oldest first. A missing or unreadable store is an
/// empty list.
pub fn remembered_trust_folders() -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(store_path()) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<Value>(&text) else {
        return Vec::new();
    };
    value
        .get("folders")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.get("path").and_then(Value::as_str))
        .filter_map(normalize_folder)
        .collect()
}

/// Adds the folders to the store, skipping ones already present.
pub fn remember_trust_folders(folders: &[String]) -> std::io::Result<Vec<String>> {
    let path = store_path();
    let mut entries: Vec<Value> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| value.get("folders").and_then(Value::as_array).cloned())
        .unwrap_or_default();
    let existing: Vec<String> = entries
        .iter()
        .filter_map(|entry| entry.get("path").and_then(Value::as_str))
        .filter_map(normalize_folder)
        .collect();
    let remembered_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let mut added = Vec::new();
    for folder in folders.iter().filter_map(|folder| normalize_folder(folder)) {
        if existing.contains(&folder) || added.contains(&folder) {
            continue;
        }
        entries.push(json!({ "path": folder, "rememberedAt": remembered_at }));
        added.push(folder);
    }
    if added.is_empty() {
        return Ok(added);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let document = json!({ "version": STORE_VERSION, "folders": entries });
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, serde_json::to_vec_pretty(&document)?)?;
    std::fs::rename(&temporary, &path)?;
    Ok(added)
}

/// True when any candidate folder is a remembered folder or lies inside one.
pub fn folders_remembered(candidates: &[String]) -> bool {
    let remembered = remembered_trust_folders();
    if remembered.is_empty() {
        return false;
    }
    candidates
        .iter()
        .filter_map(|candidate| normalize_folder(candidate))
        .any(|candidate| {
            remembered
                .iter()
                .any(|folder| folder_covers(folder, &candidate))
        })
}

/// The folders a session's trust prompt is about: the session's working
/// directory, its project's root, and the parent project's root when the
/// project is a worktree. All are remembered together so every worktree of
/// the project is covered wherever it lives on disk.
pub fn session_trust_folders(session: &Value, project: Option<&Value>) -> Vec<String> {
    let mut folders = Vec::new();
    for candidate in [
        session.get("cwd").and_then(Value::as_str),
        project
            .and_then(|project| project.get("path"))
            .and_then(Value::as_str),
        project
            .and_then(|project| project.get("worktree"))
            .and_then(|worktree| worktree.get("parentProjectPath"))
            .and_then(Value::as_str),
    ]
    .into_iter()
    .flatten()
    .filter_map(normalize_folder)
    {
        if !folders.contains(&candidate) {
            folders.push(candidate);
        }
    }
    folders
}

fn repository_trust_folders(
    repository: &DomainRepository<'_>,
    project_id: &str,
    session_id: &str,
) -> Vec<String> {
    let session = repository
        .get_session(project_id, session_id)
        .ok()
        .flatten();
    let project = repository.get_project(project_id).ok().flatten();
    session
        .map(|session| session_trust_folders(&session, project.as_ref()))
        .unwrap_or_default()
}

/// Whether the session's folders are remembered, read for the funnel that
/// just classified a trust prompt on its screen.
pub fn session_folders_remembered(
    repository: &DomainRepository<'_>,
    project_id: &str,
    session_id: &str,
) -> bool {
    folders_remembered(&repository_trust_folders(
        repository, project_id, session_id,
    ))
}

/// Applied to every trust-prompt notice in the detection funnel: an
/// unremembered folder offers the button; a remembered one is marked for the
/// funnel to answer and is hidden from every client while that happens.
///
/// Hiding is only right when the funnel can actually answer: a remembered
/// folder whose prompt has no safe keystroke (Claude's older wording), or
/// whose last automatic accept failed, keeps its card so the user is never
/// left with a silently stuck agent. Such a card offers no Trust and
/// Remember button, since the folder is already remembered.
pub fn decorate_trust_notice(
    notice: &mut SessionChatTerminalNotice,
    remembered: bool,
    answerable: bool,
    project_id: &str,
    session_id: &str,
) {
    if notice.kind != SESSION_CHAT_NOTICE_TRUST_PROMPT {
        return;
    }
    if remembered {
        notice.auto_trust = answerable && !auto_trust_failed_recently(project_id, session_id);
        return;
    }
    if notice
        .actions
        .iter()
        .any(|action| action.kind == SessionChatTerminalNoticeActionKind::TrustAndRemember)
    {
        return;
    }
    let position = notice
        .actions
        .iter()
        .position(|action| action.kind == SessionChatTerminalNoticeActionKind::SwitchToTerminal)
        .unwrap_or(notice.actions.len());
    notice.actions.insert(
        position,
        SessionChatTerminalNoticeAction::trust_and_remember(),
    );
}

/// The keystrokes that accept whichever agent's trust prompt is on this
/// screen right now. `None` when no trust prompt is on screen or the one on
/// screen has no safe keystroke.
pub fn workspace_trust_accept_steps(
    agent: Option<&str>,
    screen: &str,
) -> Option<Vec<SessionChatSendStep>> {
    let notice = classify_session_chat_terminal_notice(agent, screen)?;
    if notice.kind != SESSION_CHAT_NOTICE_TRUST_PROMPT {
        return None;
    }
    if let Some(send) = notice
        .actions
        .iter()
        .find(|action| action.kind == SessionChatTerminalNoticeActionKind::SendKeys)
        .and_then(|action| action.send.clone())
    {
        return Some(vec![SessionChatSendStep::Write(send)]);
    }
    let option_agent = session_chat_option_agent(agent)?;
    if notice.dialog.is_some() {
        if option_agent != SessionChatOptionAgent::Codex {
            return None;
        }
        let dialog = crate::session_chat_codex_dialog::detect_codex_dialog(screen)?;
        if !dialog.is_codex_directory_trust() {
            return None;
        }
        let mut params = Map::new();
        params.insert("choiceIndex".to_string(), json!(0));
        let payload = dialog.payload(&params).ok()?;
        return Some(vec![
            SessionChatSendStep::VerifyTerminalDialog {
                agent: "codex".to_string(),
                id: dialog.id,
            },
            SessionChatSendStep::Write(payload),
            SessionChatSendStep::SleepMs(150),
        ]);
    }
    let accept = notice
        .choices
        .iter()
        .find(|choice| matches!(choice.label.as_str(), "Yes, I trust this folder" | "Trust"))?;
    let key = if option_agent == SessionChatOptionAgent::Pi {
        crate::session_chat_pi_blocking::pi_trust_answer_key(screen, accept.index)?
    } else {
        crate::session_chat_workspace_trust::workspace_trust_answer_key(
            agent,
            screen,
            accept.index,
        )?
    };
    Some(build_terminal_picker_answer_steps(&key))
}

/// Whether a trust prompt is on this screen at all, answerable or not.
fn trust_prompt_on_screen(agent: Option<&str>, screen: &str) -> bool {
    classify_session_chat_terminal_notice(agent, screen)
        .is_some_and(|notice| notice.kind == SESSION_CHAT_NOTICE_TRUST_PROMPT)
}

/// The `trustAndRemember` lane of answerSessionChatPrompt: remember the
/// session's folders, then accept the prompt on screen the way the card's
/// own Trust button would. Remembering happens first and is never undone by
/// a prompt that cannot be answered, since that is the part the user asked
/// for that outlives this one dialog.
pub(crate) async fn answer_trust_and_remember(
    state: &crate::server::AppState,
    target: &SessionChatSendTarget,
) -> Result<Value, DomainStateError> {
    let project = crate::storage::open_gxserver_database(&state.paths)
        .ok()
        .and_then(|db| {
            DomainRepository::new(&db, state.metadata.server_id.as_str())
                .get_project(&target.project_id)
                .ok()
                .flatten()
        });
    let folders = session_trust_folders(&target.session, project.as_ref());
    if folders.is_empty() {
        return Err(DomainStateError {
            code: "invalidState",
            message: "This session has no folder to remember.".to_string(),
        });
    }
    remember_trust_folders(&folders).map_err(|error| DomainStateError {
        code: "internalError",
        message: format!("Could not save the trusted folder: {error}"),
    })?;
    let agent = crate::session_chat_follower::session_chat_agent_for_session(&target.session);
    let screen = capture_session_terminal_text(&target.zmx_name).await;
    let steps = screen
        .as_deref()
        .and_then(|screen| workspace_trust_accept_steps(agent.as_deref(), screen));
    let Some(steps) = steps else {
        if screen
            .as_deref()
            .is_some_and(|screen| trust_prompt_on_screen(agent.as_deref(), screen))
        {
            return Err(DomainStateError {
                code: "invalidState",
                message: format!(
                    "Remembered {} as trusted, but this prompt has to be answered in the terminal once.",
                    folders[0]
                ),
            });
        }
        return Ok(json!({ "queued": false, "remembered": folders }));
    };
    execute_session_chat_send(
        &target.project_id,
        &target.session_id,
        &target.zmx_name,
        "session-chat-answer",
        steps,
    )
    .await
    .map_err(|error| DomainStateError {
        code: "agentBusy",
        message: error.message,
    })?;
    Ok(json!({ "queued": true, "remembered": folders }))
}

/// What the detection funnel needs to accept a remembered folder's prompt
/// on its own: the pty to write to.
pub(crate) struct AutoTrustPlan {
    pub(crate) zmx_name: String,
}

/// A plan when the notice just classified is a trust prompt on a remembered
/// folder and the session has a pty to answer it on.
pub(crate) fn auto_trust_plan(
    repository: &DomainRepository<'_>,
    project_id: &str,
    session_id: &str,
    notice: Option<&SessionChatTerminalNotice>,
) -> Option<AutoTrustPlan> {
    if !notice.is_some_and(|notice| notice.auto_trust) {
        return None;
    }
    let session = repository.get_session(project_id, session_id).ok()??;
    let zmx_name = crate::zmx::provider_zmx_session_name(&session).ok()?;
    Some(AutoTrustPlan { zmx_name })
}

static AUTO_TRUST_ATTEMPTS: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
/// Sessions whose last automatic accept did not clear the prompt, with the
/// time it failed; the funnel shows the card again for these.
static AUTO_TRUST_FAILURES: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();

fn attempt_key(project_id: &str, session_id: &str) -> String {
    format!("{project_id}|{session_id}")
}

fn mark_auto_trust_failed(project_id: &str, session_id: &str) {
    if let Ok(mut failures) = AUTO_TRUST_FAILURES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
    {
        let now = Instant::now();
        failures
            .retain(|_, failed_at| now.duration_since(*failed_at) < AUTO_TRUST_RETRY_INTERVAL * 4);
        failures.insert(attempt_key(project_id, session_id), now);
    }
}

fn clear_auto_trust_failure(project_id: &str, session_id: &str) {
    if let Ok(mut failures) = AUTO_TRUST_FAILURES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
    {
        failures.remove(&attempt_key(project_id, session_id));
    }
}

fn auto_trust_failed_recently(project_id: &str, session_id: &str) -> bool {
    AUTO_TRUST_FAILURES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .ok()
        .and_then(|failures| failures.get(&attempt_key(project_id, session_id)).copied())
        .is_some_and(|failed_at| failed_at.elapsed() < AUTO_TRUST_RETRY_INTERVAL * 4)
}

/// One accept per prompt per retry interval; `false` means an attempt is
/// still fresh and the screen has not had time to change.
pub(crate) fn claim_auto_trust_attempt(project_id: &str, session_id: &str) -> bool {
    let key = attempt_key(project_id, session_id);
    let Ok(mut attempts) = AUTO_TRUST_ATTEMPTS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
    else {
        return false;
    };
    let now = Instant::now();
    if attempts
        .get(&key)
        .is_some_and(|last| now.duration_since(*last) < AUTO_TRUST_RETRY_INTERVAL)
    {
        return false;
    }
    attempts.retain(|_, last| now.duration_since(*last) < AUTO_TRUST_RETRY_INTERVAL * 4);
    attempts.insert(key, now);
    true
}

/// Accept the prompt from a fresh capture, then re-probe and republish so the
/// card retires as soon as the dialog is gone instead of on the next
/// follower probe. Runs detached; a failed accept leaves the card standing
/// with its own Trust button.
pub(crate) fn dispatch_auto_trust(
    detector: crate::session_chat_options::SessionChatOptionDetector,
    plan: AutoTrustPlan,
    project_id: &str,
    session_id: &str,
    agent: Option<&str>,
) {
    let Ok(handle) = tokio::runtime::Handle::try_current() else {
        return;
    };
    let project_id = project_id.to_string();
    let session_id = session_id.to_string();
    let agent = agent.map(str::to_string);
    handle.spawn(async move {
        let Some(screen) = capture_session_terminal_text(&plan.zmx_name).await else {
            return;
        };
        let Some(steps) = workspace_trust_accept_steps(agent.as_deref(), &screen) else {
            // The prompt left the screen between the probe and this capture
            // (answered in the terminal, or the agent moved on): nothing to do.
            return;
        };
        let sent = execute_session_chat_send(
            &project_id,
            &session_id,
            &plan.zmx_name,
            "workspace-trust-remembered",
            steps,
        )
        .await
        .is_ok();
        tokio::time::sleep(Duration::from_millis(1500)).await;
        // A prompt that is still on screen after the accept is a failure the
        // user has to see: the next probe shows the card again.
        let still_prompting = capture_session_terminal_text(&plan.zmx_name)
            .await
            .is_some_and(|screen| trust_prompt_on_screen(agent.as_deref(), &screen));
        if !sent || still_prompting {
            mark_auto_trust_failed(&project_id, &session_id);
        } else {
            clear_auto_trust_failure(&project_id, &session_id);
        }
        detector
            .detect(&project_id, &session_id, agent.as_deref(), true)
            .await;
        detector.publish_screen_state(&project_id, &session_id);
    });
}
