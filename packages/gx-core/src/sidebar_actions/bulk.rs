//! The bulk, project and collection actions: which rows they act on, and in what order.
//!
//! CDXC:Sessions 2026-09-20 WHY:
//! Almost nothing here is new behaviour. Every one of these payloads ends in the per-session
//! actions the store already owns (sleep, wake, close), so a port that reimplemented them would
//! have written a second copy of the declined leg, the replacement focus and the echo guard. What
//! these payloads really are is a SET and an ORDER, and that is what this file answers: which rows
//! the action touches, in which order, and whether the fan-out is paced.
//!
//! Two shapes reach it.
//!
//! - A `batch` is the renderer's own envelope. The bulk menu and every collection menu build one
//!   ("Sleep Selected", a collection's Pin, Tag or Full Reload) as a list of ordinary per-session
//!   messages, optionally clearing the multi-selection first, and the controller posts each one.
//!   So the batch needs no set of its own and no pacing: it is exactly the messages the menu built.
//! - The plural payloads (`setSessionsSleeping`, `closeSessions`, `setGroupSleeping`,
//!   `sleepInactiveProjectSessions`, `closeInactiveProjectSessions`,
//!   `wakeProjectSleepingSessions`) resolve a set here and then fan out into the same per-session
//!   messages.
//!
//! **The pacing is a decision, not an implementation detail.** A bulk SLEEP through
//! `setSessionsSleeping` runs one request at a time with 350 ms between them, and wake and close do
//! not (`CDXC:SessionSleep 2026-06-27-02:05`: restoring a session needs no terminal teardown
//! throttling). A batch of per-session sleeps from the bulk MENU is not paced either, because it
//! never goes through the plural payload. Getting that backwards is invisible in any list
//! comparison and would either hammer the daemon or make Sleep Selected feel broken, so the plan
//! carries the interval and the gate compares it.
//!
//! SEE-ALSO: apps/desktop/sidebar/gxserver-runtime/auto-sleep.ts (`setSessionsSleeping`,
//! `setGroupSleeping`, `collectInactiveProjectSessionIds`, `wakeProjectSleepingSessions`),
//! apps/desktop/sidebar/bulk-sleep-pacing.ts, apps/desktop/sidebar/native-sidebar/controller.ts
//! (the `batch` arm), apps/desktop/src/app/gx_store/sidebar_bulk.rs.

use serde_json::{json, Map, Value};

use crate::core::Core;
use crate::keys::{ProjectKey, SessionKey};
use crate::sidebar_view::SidebarInputs;

use super::resolve::text_field;

use ghostex_gx_protocol::{LifecycleState, SessionActivity};

/// `GPUI_SIDEBAR_BULK_SLEEP_INTERVAL_MS`.
pub const BULK_SLEEP_INTERVAL_MS: u64 = 350;

/// What the renderer's `batch` envelope asks for: clear the multi-selection, then post each
/// message.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BatchPlan {
    pub clear_selection: bool,
    pub messages: Vec<Value>,
}

impl BatchPlan {
    pub fn to_json(&self) -> Value {
        json!({ "clearSelection": self.clear_selection, "messages": self.messages })
    }
}

/// The `batch` command, or `None` when this is not one.
///
/// The messages are passed on exactly as the menu built them, in order. Nothing is resolved,
/// filtered or reordered here: the menu already decided which rows it offers the action for, which
/// is what `createNativeBulkMenu` and `createNativeCollectionMenu` do, and re-deciding it would be
/// a second place for the two to differ.
pub fn plan_batch(command: &Value) -> Option<BatchPlan> {
    if text_field(command, "type")? != "batch" {
        return None;
    }
    let messages = command.get("messages")?.as_array()?.clone();
    Some(BatchPlan {
        clear_selection: command
            .get("clearSelection")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        messages,
    })
}

/// Which per-session action a plural payload fans out into.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BulkAction {
    Sleep,
    Wake,
    Close,
}

impl BulkAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sleep => "sleep",
            Self::Wake => "wake",
            Self::Close => "close",
        }
    }

    /// The per-session message the fan-out posts, which is the payload the single-session path
    /// already answers.
    fn message(self, sidebar_session_id: &str) -> Value {
        match self {
            Self::Sleep => json!({
                "type": "setSessionSleeping",
                "sessionId": sidebar_session_id,
                "sleeping": true,
            }),
            Self::Wake => json!({
                "type": "setSessionSleeping",
                "sessionId": sidebar_session_id,
                "sleeping": false,
            }),
            Self::Close => json!({ "type": "closeSession", "sessionId": sidebar_session_id }),
        }
    }
}

/// A plural payload, resolved.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BulkRequest {
    pub action: BulkAction,
    /// The per-session messages, in the order the TypeScript issues them.
    pub messages: Vec<Value>,
    /// Milliseconds between requests, or zero for the concurrent fan-out.
    pub interval_ms: u64,
    /// `focusProjectId` runs BEFORE the fan-out for a project wake, and for nothing else.
    pub focus_project: Option<ProjectKey>,
}

impl BulkRequest {
    /// Whether each request must come HOME before the interval starts and the next one goes out.
    ///
    /// CDXC:SessionSleep 2026-09-21 WHY:
    /// `runGpuiSidebarBulkSleepPaced` awaits `sleepTarget` and only then waits the interval, so a
    /// paced sleep is one request at a time in the strict sense: the second is not sent while the
    /// first is still in flight. The host used to post one message every 350 ms without waiting,
    /// which overlaps teardowns whenever a sleep takes longer than the interval, and a remote sleep
    /// always does (the tunnel, then the machine's own snapshot re-read). Wake and close go through
    /// `Promise.all` and wait for nothing.
    pub fn waits_for_each(&self) -> bool {
        self.interval_ms > 0
    }

    pub fn to_json(&self) -> Value {
        json!({
            "action": self.action.as_str(),
            "intervalMs": self.interval_ms,
            "waitsForEach": self.waits_for_each(),
            "focusProject": self
                .focus_project
                .as_ref()
                .map(ProjectKey::to_workspace_project_id),
            "messages": self.messages,
        })
    }
}

/// Every plural payload this file answers.
pub const BULK_MESSAGE_TYPES: [&str; 6] = [
    "setSessionsSleeping",
    "closeSessions",
    "setGroupSleeping",
    "sleepInactiveProjectSessions",
    "closeInactiveProjectSessions",
    "wakeProjectSleepingSessions",
];

/// Whether this payload is one this file answers, without resolving anything.
pub fn owns_bulk_message(message: &Value) -> bool {
    text_field(message, "type").is_some_and(|kind| BULK_MESSAGE_TYPES.contains(&kind))
}

/// Whether this command is the renderer's batch envelope.
pub fn owns_batch_command(command: &Value) -> bool {
    text_field(command, "type") == Some("batch")
}

/// The plural payloads, or `None` when this file does not own one.
///
/// Refused, with the reason at each refusal:
///
/// - **A set that would include a browser row.** Every project-scoped payload here starts from
///   `this.browserTabs` and sleeps or closes the project's app tabs alongside its sessions, through
///   the browser bridge and not through the daemon. The store knows which tabs a project has but
///   the host cannot reach that bridge from this path (it needs a `Window`), so a payload whose set
///   would contain even one is handed over WHOLE rather than performed in half: half of a Sleep All
///   is worse than none, and the old runtime still does all of it.
/// - **A host that does not supply the app-tab list at all**, which is not the same as a host that
///   says there are none. The answer decides whether a payload is performed, so a question the host
///   never answered must not be read as a "no": the desktop host stopped filling it on 2026-09-20
///   while the old runtime's own `browserTabs` still lists tabs, and reading absence as emptiness
///   would put a project's sessions to sleep and leave its app tabs awake.
/// - **A remote group**, which needs that machine's tunnel.
/// - **A user-made session group** (`gpui-wsg:`), whose membership is the workspace session groups
///   document, the fourth client-storage key with its own writer and its own pending-push guard.
/// - **A group id that does not parse**, which is the TypeScript's own early return.
/// - **An explicit id list naming a row this store cannot resolve** is NOT refused: the plural
///   payloads parse each id independently and the single-session path answers each one, exactly as
///   the fan-out does there.
pub fn plan_bulk_request(
    core: &Core,
    inputs: &SidebarInputs,
    message: &Value,
) -> Option<BulkRequest> {
    match text_field(message, "type")? {
        // An explicit list from a multi-selection. The ids are the menu's own and are fanned out
        // untouched; only the direction decides the pacing.
        "setSessionsSleeping" => {
            let sleeping = message.get("sleeping")?.as_bool()?;
            let ids = explicit_session_ids(message)?;
            let action = match sleeping {
                true => BulkAction::Sleep,
                false => BulkAction::Wake,
            };
            Some(bulk(action, ids, None))
        }
        "closeSessions" => {
            let ids = explicit_session_ids(message)?;
            Some(bulk(BulkAction::Close, ids, None))
        }
        // The project-scoped ones resolve their own set.
        kind => {
            let project = local_project_of_group(message)?;
            if !project_tabs_known_absent(inputs, &project.project_id) {
                return None;
            }
            // `if (!projectId || !this.presentation) return`. Three of the four payloads would
            // answer a machine with no presentation with an empty set, which is what the early
            // return does anyway, but `wakeProjectSleepingSessions` moves the active project FIRST
            // and the early return happens before it: answering here would jump the user to a
            // project whose rows nobody has yet. This is the store's not-loaded state, not an empty
            // one, and it is the refusal PLAN.md asks for rather than a guess at zero rows.
            core.presentation().loaded(&project.machine)?;
            let (action, rows) = match kind {
                "setGroupSleeping" => {
                    let sleeping = message.get("sleeping")?.as_bool()?;
                    let action = match sleeping {
                        true => BulkAction::Sleep,
                        false => BulkAction::Wake,
                    };
                    // `lifecycleState === (sleeping ? 'running' : 'sleeping')`: only the rows the
                    // action can move, so a group of sleeping sessions asked to sleep calls
                    // nothing at all.
                    let wanted = match sleeping {
                        true => LifecycleState::Running,
                        false => LifecycleState::Sleeping,
                    };
                    (
                        action,
                        project_rows(core, &project, |row| row.lifecycle_state == wanted),
                    )
                }
                "wakeProjectSleepingSessions" => (
                    BulkAction::Wake,
                    project_rows(core, &project, |row| {
                        row.lifecycle_state == LifecycleState::Sleeping
                    }),
                ),
                "sleepInactiveProjectSessions" => {
                    (BulkAction::Sleep, project_rows(core, &project, is_inactive))
                }
                "closeInactiveProjectSessions" => {
                    (BulkAction::Close, project_rows(core, &project, is_inactive))
                }
                _ => return None,
            };
            let ids = rows
                .into_iter()
                .map(|session_id| {
                    SessionKey {
                        machine: project.machine.clone(),
                        project_id: project.project_id.clone(),
                        session_id,
                    }
                    .to_sidebar_session_id()
                })
                .collect();
            // Only the project wake moves the active project, and it does so BEFORE the fan-out,
            // which is why it is part of the request rather than a follow-up.
            let focus = match kind {
                "wakeProjectSleepingSessions" => Some(project),
                _ => None,
            };
            Some(bulk(action, ids, focus))
        }
    }
}

/// The plan for one resolved set. The pacing rule lives here so the four project payloads and the
/// two explicit ones cannot answer it differently.
fn bulk(action: BulkAction, ids: Vec<String>, focus_project: Option<ProjectKey>) -> BulkRequest {
    BulkRequest {
        messages: ids.iter().map(|id| action.message(id)).collect(),
        // `runGpuiSidebarBulkSleepPaced` is reached only by the SLEEP direction of
        // `setSessionsSleeping`; wake and close go through `Promise.all`.
        interval_ms: match action {
            BulkAction::Sleep => BULK_SLEEP_INTERVAL_MS,
            _ => 0,
        },
        action,
        focus_project,
    }
}

fn explicit_session_ids(message: &Value) -> Option<Vec<String>> {
    Some(
        message
            .get("sessionIds")?
            .as_array()?
            .iter()
            .filter_map(|id| id.as_str().map(str::to_string))
            .collect(),
    )
}

/// `parseGxserverPresentationProjectGroupId`, which is a string parse and asks the store nothing.
/// A remote group and a user-made session group are refused here rather than parsed.
fn local_project_of_group(message: &Value) -> Option<ProjectKey> {
    let group_id = text_field(message, "groupId")?;
    let project = ProjectKey::parse_sidebar_group_id(group_id)?;
    project.machine.is_local().then_some(project)
}

/// Whether the host has told us this project has NO app tabs. Three answers, and only this one
/// lets the payload be performed.
///
/// The TypeScript's sets filter on the tab's own state (sleeping, visible) per payload, but this is
/// a refusal and not a set, so the question is only whether any exist. It is asked in the positive
/// ("known absent") on purpose: the two ways of not knowing, a host that supplies nothing and a
/// host that lists a tab, both have to refuse, and a predicate named for the tab's presence invites
/// the one caller it has to write `!has_tab` and turn silence into a "no".
///
/// The list it reads is `SidebarInputs::host.browser_tabs`, and the old runtime's own
/// `this.browserTabs` is a SEPARATE list that no change here empties. So a host that stops feeding
/// this one does not stop the old runtime from sleeping a project's app tabs: it stops this side
/// from knowing they exist. If the tabs move off the sidebar, this predicate needs whatever list
/// replaces them, not a removal.
fn project_tabs_known_absent(inputs: &SidebarInputs, project_id: &str) -> bool {
    let tabs = &inputs.host.browser_tabs;
    tabs.is_supplied() && !tabs.iter().any(|tab| tab.project_id == project_id)
}

/// `isGpuiInactiveProjectPresentationSession`: awake, and neither working nor waiting on the user.
/// Stopped history that is pinned, tagged or starred stays in the presentation and is deliberately
/// NOT included, because sleeping it would promote it back into the active shelf.
pub(super) fn is_inactive(row: &ghostex_gx_protocol::PresentationSession) -> bool {
    row.lifecycle_state == LifecycleState::Running
        && row.activity != SessionActivity::Working
        && row.activity != SessionActivity::Attention
}

/// The project's rows that pass a test, in the daemon's own array order.
///
/// The order is rebuilt from `sortKey` rather than read off a list, for the reason
/// `localProjectTransitionSessionIds` gives: the store keeps rows by id, the daemon orders its
/// array by the byte order of that key, and a store built from deltas has no array order to read.
/// It matters here because the order is the order the requests go out in, and a paced sleep makes
/// that visible: the rows go to sleep one at a time, in this order, 350 ms apart.
pub(super) fn project_rows(
    core: &Core,
    project: &ProjectKey,
    keep: impl Fn(&ghostex_gx_protocol::PresentationSession) -> bool,
) -> Vec<String> {
    let Some(loaded) = core.presentation().loaded(&project.machine) else {
        return Vec::new();
    };
    let mut rows: Vec<(&str, &str)> = loaded
        .server_sessions()
        .filter(|row| row.project_id == project.project_id && keep(row))
        .map(|row| (row.sort_key.as_str(), row.session_id.as_str()))
        .collect();
    rows.sort_unstable();
    rows.into_iter()
        .map(|(_, session_id)| session_id.to_string())
        .collect()
}

/// The counters a host reports, named here so the record and the gate agree on what they mean.
pub fn bulk_request_summary(request: &BulkRequest) -> Value {
    let mut summary = Map::new();
    summary.insert(
        "action".to_string(),
        Value::String(request.action.as_str().to_string()),
    );
    summary.insert(
        "rows".to_string(),
        Value::Number((request.messages.len() as u64).into()),
    );
    summary.insert(
        "intervalMs".to_string(),
        Value::Number(request.interval_ms.into()),
    );
    summary.insert(
        "focusProject".to_string(),
        Value::Bool(request.focus_project.is_some()),
    );
    Value::Object(summary)
}
