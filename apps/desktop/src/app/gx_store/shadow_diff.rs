use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::time::{Duration, Instant};

use ghostex_gx_core::{
    ActiveGroup, Core, Event, ExternalFocusUpdate, FocusField, Intent, Loadable, MachineId,
    PresentationStore, ProjectKey, SessionKey, TabSession, default_group_for_project,
};

use crate::app::helpers::{
    GpuiGxserverPresentationFocusEcho, GpuiWorkspaceTerminalSessionKey, gpui_sidebar_agent_icon,
};
use crate::app::model::{
    AgentTerminalActivity, GpuiGxserverPresentationFocusState, GpuiSidebarWorkspaceTabSession,
    TerminalSessionPresentationState,
};

/// Most ids one log record names per list; the support log caps arrays at 32 anyway.
const MAX_IDS_PER_RECORD: usize = 24;

/// Shapes of confirmed differences remembered for the distinct count.
const MAX_CONFIRMED_SIGNATURES: usize = 1024;

/// One tab as the old runtime published it, reduced to what both sides have.
///
/// Titles and directories are compared, so they are held here, in memory; a log record only ever
/// names the FIELD that differs.
#[derive(Clone, Debug, PartialEq, Eq)]
struct OldTab {
    key: SessionKey,
    title: String,
    activity: &'static str,
    is_sleeping: bool,
    is_draft: bool,
    is_generating_first_prompt_title: bool,
    working_directory: Option<String>,
    agent_icon: Option<&'static str>,
    agent_name: Option<String>,
    agent_session_id: Option<String>,
    has_session_note: bool,
    stashed_prompt_count: u64,
    has_switchable_agents: bool,
}

impl OldTab {
    fn from_bridge(tab: &GpuiSidebarWorkspaceTabSession) -> Self {
        let key = match &tab.key {
            GpuiWorkspaceTerminalSessionKey::Local(key) => {
                SessionKey::local(key.project_id.as_str(), key.session_id.as_str())
            }
            GpuiWorkspaceTerminalSessionKey::Remote(key) => SessionKey::remote(
                key.remote_machine_id.as_str(),
                key.project_id.as_str(),
                key.session_id.as_str(),
            ),
        };
        Self {
            key,
            title: tab.title.clone(),
            activity: match tab.activity {
                AgentTerminalActivity::Idle => "idle",
                AgentTerminalActivity::Working => "working",
                AgentTerminalActivity::Attention => "attention",
            },
            is_sleeping: tab.presentation_state == TerminalSessionPresentationState::Sleeping,
            is_draft: tab.is_draft,
            is_generating_first_prompt_title: tab.is_generating_first_prompt_title,
            working_directory: tab.working_directory.clone(),
            agent_icon: tab.agent_icon,
            agent_name: tab.agent_name.clone(),
            agent_session_id: tab.agent_session_id.clone(),
            has_session_note: tab.has_session_note,
            stashed_prompt_count: tab.stashed_prompt_count,
            has_switchable_agents: !tab.switchable_agents.is_empty(),
        }
    }

    /// Names of the fields whose values differ from the store's row. The old payload's
    /// `lifecycleState` is the sidebar's own vocabulary (`error`, `done`), not the daemon's, so
    /// only the sleeping flag is comparable; `kind` is `terminal` for every row on both sides.
    fn differing_fields(&self, store: &TabSession) -> Vec<&'static str> {
        let mut fields = Vec::new();
        let mut check = |name: &'static str, same: bool| {
            if !same {
                fields.push(name);
            }
        };
        check("title", self.title == store.title);
        check("activity", self.activity == store.bridge_activity());
        check("isSleeping", self.is_sleeping == store.is_sleeping);
        check("isDraft", self.is_draft == store.is_draft);
        check(
            "isGeneratingFirstPromptTitle",
            self.is_generating_first_prompt_title == store.is_generating_first_prompt_title,
        );
        check(
            "workingDirectory",
            self.working_directory == store.working_directory,
        );
        check("agentName", self.agent_name == store.agent_name);
        check(
            "agentSessionId",
            self.agent_session_id == store.agent_session_id,
        );
        check(
            "hasSessionNote",
            self.has_session_note == store.has_session_note,
        );
        check(
            "stashedPromptCount",
            self.stashed_prompt_count == store.stashed_prompt_count.unwrap_or(0),
        );
        check(
            "switchableAgents",
            self.has_switchable_agents == store.has_switchable_agents,
        );
        fields
    }

    /// The old runtime resolves the daemon's icon key through its agent catalog before it
    /// publishes; the store keeps the raw key. A difference here is expected for custom agents,
    /// so it is counted on its own and never makes a comparison a mismatch.
    fn icon_differs(&self, store: &TabSession) -> bool {
        self.agent_icon != gpui_sidebar_agent_icon(store.agent_icon.as_deref())
    }
}

/// A confirmed difference between the two tab lists: ids and field names, nothing else.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub(crate) struct ShadowMismatch {
    /// Sidebar group id of the store's active group (it embeds the project id).
    pub(crate) store_group: String,
    pub(crate) old_tab_count: usize,
    pub(crate) store_tab_count: usize,
    /// `<project id>:<session id>` of tabs only one side lists.
    pub(crate) only_old: Vec<String>,
    pub(crate) only_store: Vec<String>,
    /// Both sides list the same tabs in another order.
    pub(crate) order_differs: bool,
    /// Per tab both sides list: the names of the fields that differ.
    pub(crate) fields: Vec<(String, Vec<&'static str>)>,
}

impl ShadowMismatch {
    pub(crate) fn signature(&self) -> u64 {
        let mut hasher = DefaultHasher::new();
        self.hash(&mut hasher);
        hasher.finish()
    }
}

enum Comparison {
    /// The store cannot answer yet (`NotLoaded`, `Missing`) or the old runtime sent no tab list.
    /// Never a mismatch.
    NotComparable,
    Match,
    Mismatch(ShadowMismatch),
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct ShadowCounters {
    /// Focus states the old runtime published.
    pub(crate) observed: u64,
    pub(crate) not_comparable: u64,
    pub(crate) matches: u64,
    /// Differences that disappeared within the settle time: one side was a few frames ahead.
    pub(crate) transient: u64,
    /// Differences that lasted: one per confirmation, so a lasting one counts again with every
    /// publish of the old runtime. `distinct_mismatches` counts each shape once.
    pub(crate) mismatches: u64,
    pub(crate) distinct_mismatches: u64,
    /// Tabs whose resolved agent icon differs (expected for catalog-mapped icons).
    pub(crate) icon_differences: u64,
    /// Publishes whose active project is on a machine the store holds no rows for: a remote
    /// machine with no client, or one whose first snapshot has not arrived. Zero once its client
    /// has loaded it.
    pub(crate) remote_skipped: u64,
    /// Old-runtime focus updates the core dropped as older than a local selection. Expected
    /// while the user moves through tabs faster than the old runtime is told.
    pub(crate) stale_external_focus: u64,
}

/// What a publish of the old runtime meant for the store's focus.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ObservedFocus {
    /// Produced against an older stamp than the newest local selection: not applied.
    Stale,
    /// Applied; the focused session is a local session (or nothing is focused).
    Local,
    /// Applied; the focused row is not a local session the store holds (a remote session, a
    /// remote project, the quick automations row).
    Foreign,
}

struct PendingDifference {
    since: Instant,
    signature: u64,
}

/// Compares the old runtime's tab list for its active project with the store's active tab list.
#[derive(Default)]
pub(crate) struct ShadowDiff {
    counters: ShadowCounters,
    old_focus: Option<OldFocus>,
    old_tabs: Option<Vec<OldTab>>,
    pending: Option<PendingDifference>,
    confirmed_signatures: HashSet<u64>,
    /// What mirroring the old focus again meant, while judging a waiting difference.
    remirrored: Option<ObservedFocus>,
}

/// The focus part of the old runtime's last publish, in the old bridge's id forms.
#[derive(Clone, Debug)]
struct OldFocus {
    active_project_id: Option<String>,
    /// The sidebar group the old runtime has selected. It is the only source for a user-made
    /// session group that holds no session, which no focused session can point at.
    active_group_id: Option<String>,
    focused_session_id: Option<String>,
    visible_session_ids: Vec<String>,
    /// The store stamp the old runtime had been told when it published.
    observed_stamp: u64,
}

impl ShadowDiff {
    pub(crate) fn counters(&self) -> ShadowCounters {
        self.counters
    }

    pub(crate) fn is_pending(&self) -> bool {
        self.pending.is_some()
    }

    /// The outcome of the newest repeat mirror, once.
    pub(crate) fn take_remirrored(&mut self) -> Option<ObservedFocus> {
        self.remirrored.take()
    }

    pub(crate) fn pending_since(&self) -> Option<Instant> {
        self.pending.as_ref().map(|pending| pending.since)
    }

    /// The old runtime published a focus state: make the core's focus follow it when it is not
    /// older than the newest local selection, then compare the tab lists.
    pub(crate) fn observe(
        &mut self,
        core: &mut Core,
        old_state: &GpuiGxserverPresentationFocusState,
        echo: &GpuiGxserverPresentationFocusEcho,
        now_ms: u64,
    ) -> ObservedFocus {
        let observed_stamp = echo.focus_stamp.unwrap_or(0);
        self.counters.observed += 1;
        self.old_tabs = old_state
            .active_project_tab_sessions
            .as_ref()
            .map(|tabs| tabs.iter().map(OldTab::from_bridge).collect());
        self.old_focus = Some(OldFocus {
            active_project_id: old_state.active_project_id.clone(),
            active_group_id: echo.active_group_id.clone(),
            focused_session_id: old_state.focused_session_id.clone(),
            visible_session_ids: old_state.visible_session_ids.clone(),
            observed_stamp,
        });
        // A remote focus is still not mirrored, and the list is still compared.
        //
        // CDXC:FocusRouting 2026-09-20 WHY:
        // Mirroring it would make the store's active project and active group a remote machine's,
        // and the workspace reads `active_tab_sessions` for its own tabs; the store does not own
        // remote focus until the session lifecycle milestone does, so it keeps this computer's.
        // The tab LIST is another question: the rows are in the store now, so the comparison
        // resolves the group from the project the old runtime named rather than from focus, which
        // is what lets `skippedRemote` reach zero without handing the store a focus it cannot
        // finish.
        let observed = self.mirror_focus(core, now_ms);
        // A machine whose rows are not in the store has no list to compare against.
        if self.names_unheld_machine(core) {
            self.counters.remote_skipped += 1;
            self.pending = None;
            return observed;
        }
        match self.compare(core) {
            Comparison::NotComparable => {
                self.counters.not_comparable += 1;
                self.pending = None;
            }
            Comparison::Match => {
                self.counters.matches += 1;
                self.pending = None;
            }
            Comparison::Mismatch(mismatch) => {
                // A publish that repeats a difference already waiting does not restart its clock.
                let signature = mismatch.signature();
                if self
                    .pending
                    .as_ref()
                    .is_none_or(|pending| pending.signature != signature)
                {
                    self.pending = Some(PendingDifference {
                        since: Instant::now(),
                        signature,
                    });
                }
            }
        }
        observed
    }

    /// Judges a waiting difference again. Returns it once it has lasted `settle`; a difference
    /// that is gone was one side being a few frames ahead of the other.
    ///
    /// The old focus is mirrored again first: when the old runtime was ahead, its publish named
    /// a session the store did not hold yet, and the core dropped that name. Now that frames
    /// have arrived the same publish can be applied in full.
    pub(crate) fn settle(
        &mut self,
        core: &mut Core,
        settle: Duration,
        now_ms: u64,
    ) -> Option<ShadowMismatch> {
        let since = self.pending.as_ref()?.since;
        self.remirrored = Some(self.mirror_focus(core, now_ms));
        match self.compare(core) {
            Comparison::Match | Comparison::NotComparable => {
                self.counters.transient += 1;
                self.pending = None;
                None
            }
            Comparison::Mismatch(_) if since.elapsed() < settle => None,
            Comparison::Mismatch(mismatch) => {
                self.counters.mismatches += 1;
                if self.confirmed_signatures.len() < MAX_CONFIRMED_SIGNATURES
                    && self.confirmed_signatures.insert(mismatch.signature())
                {
                    self.counters.distinct_mismatches += 1;
                }
                self.pending = None;
                Some(mismatch)
            }
        }
    }

    /// Mirrors the old focus into the core, unless it is a remote focus, which is judged and never
    /// mirrored (see `observe`). The one rule for both callers.
    ///
    /// CDXC:FocusRouting 2026-09-21 WHY:
    /// `settle` used to mirror without that check, so a remote publish whose tab list stayed
    /// different wrote the remote project and group into the core after all, and the core's focus
    /// then flipped between this computer and a remote machine depending on whether a difference
    /// had settled.
    fn mirror_focus(&mut self, core: &mut Core, now_ms: u64) -> ObservedFocus {
        let Some(old_focus) = &self.old_focus else {
            return ObservedFocus::Stale;
        };
        if names_remote_focus(
            old_focus.active_project_id.as_deref(),
            old_focus.focused_session_id.as_deref(),
        ) {
            return match old_focus.observed_stamp < core.focus().local_stamp {
                true => ObservedFocus::Stale,
                false => ObservedFocus::Foreign,
            };
        }
        let (update, foreign) = external_focus_update(core, old_focus, self.old_tabs.as_deref());
        let output = core.handle(Event::Intent(Intent::ExternalFocus(update)), now_ms);
        if output.changes.ignored.is_some() {
            self.counters.stale_external_focus += 1;
            ObservedFocus::Stale
        } else if foreign {
            ObservedFocus::Foreign
        } else {
            ObservedFocus::Local
        }
    }

    /// Whether the old runtime's active project is on a machine the store holds no rows for.
    fn names_unheld_machine(&self, core: &Core) -> bool {
        self.old_project()
            .is_some_and(|project| core.presentation().loaded(&project.machine).is_none())
    }

    fn old_project(&self) -> Option<ProjectKey> {
        self.old_focus
            .as_ref()
            .and_then(|old_focus| old_focus.active_project_id.as_deref())
            .and_then(ProjectKey::parse_workspace_project_id)
    }

    /// The group whose tab list is compared, or `None` when the two sides are not answering the
    /// same question.
    ///
    /// For a LOCAL project it is the store's own active group, because the store owns this
    /// computer's focus and is ahead of the old runtime from a selection until it is told. For a
    /// remote project the store has no focus opinion at all, so the group is derived from what the
    /// old runtime named, the same way `external_focus_update` derives it.
    fn compared_group(&self, core: &Core) -> Option<ActiveGroup> {
        let old_project = self.old_project()?;
        let store = core.presentation();
        if old_project.machine.is_local() {
            if Some(&old_project) != core.focus().active_project.as_ref() {
                return None;
            }
            return core.focus().active_group.clone();
        }
        let selected = self
            .old_focus
            .as_ref()
            .and_then(|old_focus| old_focus.active_group_id.as_deref())
            .and_then(ActiveGroup::parse_sidebar_group_id)
            .filter(|group| group_belongs_to(store, group, &old_project));
        Some(selected.unwrap_or_else(|| default_group_for_project(store, &old_project)))
    }

    fn compare(&mut self, core: &Core) -> Comparison {
        let Some(old_tabs) = &self.old_tabs else {
            return Comparison::NotComparable;
        };
        let Some(group) = self.compared_group(core) else {
            return Comparison::NotComparable;
        };
        // A workspace that holds a tab from another machine than its project's is a list the store
        // has no shape for: its tab list is a group's sessions, and a group belongs to one machine.
        let owner = self.old_project().map(|project| project.machine);
        if old_tabs
            .iter()
            .any(|tab| Some(&tab.key.machine) != owner.as_ref())
        {
            return Comparison::NotComparable;
        }
        let Loadable::Loaded(store_tabs) = core.presentation().tab_sessions(&group) else {
            return Comparison::NotComparable;
        };
        let label = |key: &SessionKey| format!("{}:{}", key.project_id, key.session_id);
        let mut mismatch = ShadowMismatch {
            store_group: group.to_sidebar_group_id(),
            old_tab_count: old_tabs.len(),
            store_tab_count: store_tabs.len(),
            ..ShadowMismatch::default()
        };
        let store_by_key: HashMap<&SessionKey, &TabSession> =
            store_tabs.iter().map(|store| (&store.key, store)).collect();
        let old_keys: HashSet<&SessionKey> = old_tabs.iter().map(|old| &old.key).collect();
        let mut icon_differences = 0;
        for old in old_tabs {
            match store_by_key.get(&old.key) {
                None => mismatch.only_old.push(label(&old.key)),
                Some(store) => {
                    let fields = old.differing_fields(store);
                    if !fields.is_empty() {
                        mismatch.fields.push((label(&old.key), fields));
                    }
                    icon_differences += u64::from(old.icon_differs(store));
                }
            }
        }
        for store in &store_tabs {
            if !old_keys.contains(&store.key) {
                mismatch.only_store.push(label(&store.key));
            }
        }
        mismatch.order_differs = mismatch.only_old.is_empty()
            && mismatch.only_store.is_empty()
            && old_tabs
                .iter()
                .map(|old| &old.key)
                .ne(store_tabs.iter().map(|store| &store.key));
        mismatch.only_old.truncate(MAX_IDS_PER_RECORD);
        mismatch.only_store.truncate(MAX_IDS_PER_RECORD);
        mismatch.fields.truncate(MAX_IDS_PER_RECORD);
        let differs = !mismatch.only_old.is_empty()
            || !mismatch.only_store.is_empty()
            || mismatch.order_differs
            || !mismatch.fields.is_empty();
        if differs {
            Comparison::Mismatch(mismatch)
        } else {
            self.counters.icon_differences += icon_differences;
            Comparison::Match
        }
    }
}

/// Whether a publish of the old runtime puts focus on a remote machine: its active project or its
/// focused session.
///
/// Mirroring such a focus would set a remote focused session and project while the active group
/// stays on the last local project (the core cannot derive a group on a machine it does not
/// hold), and the local tab list would then be compared with a remote one.
fn names_remote_focus(active_project_id: Option<&str>, focused_session_id: Option<&str>) -> bool {
    let remote_project = active_project_id
        .and_then(ProjectKey::parse_workspace_project_id)
        .is_some_and(|project| !project.machine.is_local());
    let remote_focus = focused_session_id
        .is_some_and(|session_id| SessionKey::parse_remote_scoped_session_id(session_id).is_some());
    remote_project || remote_focus
}

/// Whether a sidebar group the old runtime named belongs to the project it also named. A group of
/// another project, of another machine, or the Chats collection of a project that is not a chat
/// project is not this payload's to apply: the store's own reconcile would replace it on the next
/// event anyway, and until then it would name a tab list that is not the project's.
fn group_belongs_to(store: &PresentationStore, group: &ActiveGroup, project: &ProjectKey) -> bool {
    match group {
        ActiveGroup::Project(owner) => owner == project && !store.is_chat_project(project),
        ActiveGroup::Subgroup {
            project: owner,
            group_id,
        } => {
            owner == project
                && store
                    .user_groups_of_project(project)
                    .iter()
                    .any(|group| group.group_id == *group_id)
        }
        ActiveGroup::Chats(machine) => {
            *machine == project.machine && store.is_chat_project(project)
        }
    }
}

/// The old runtime's focus as an external update, quoting the stamp the old runtime echoed, so
/// the core drops it when a newer local selection exists. The flag says whether the focused id
/// names something that is not a local session the store or the published tab list can place.
///
/// The payload names the focused and visible sessions by raw session id for a local session. The
/// project comes from the published tab list when the session is one of its tabs, else from the
/// store. An id neither can place clears the field: keeping the previous session would leave the
/// core's active project pinned to it, because a focused session owns the active project.
fn external_focus_update(
    core: &Core,
    old_state: &OldFocus,
    old_tabs: Option<&[OldTab]>,
) -> (ExternalFocusUpdate, bool) {
    let store = core.presentation();
    let resolve = |session_id: &str| -> Option<SessionKey> {
        // A remote session in a visible pane of a local project is left out: the store holds no
        // remote machine yet, and an unjudgeable key would sit in the visible set for good.
        if SessionKey::parse_remote_scoped_session_id(session_id).is_some() {
            return None;
        }
        old_tabs
            .into_iter()
            .flatten()
            .map(|tab| &tab.key)
            .find(|key| key.machine == MachineId::Local && key.session_id == session_id)
            .cloned()
            .or_else(|| store.resolve_focus_state_session_id(session_id))
    };
    let mut update = ExternalFocusUpdate::new(old_state.observed_stamp).with_visible_sessions(
        old_state
            .visible_session_ids
            .iter()
            .filter_map(|session_id| resolve(session_id))
            .collect(),
    );
    let active_project = old_state
        .active_project_id
        .as_deref()
        .and_then(ProjectKey::parse_workspace_project_id);
    let focused = old_state
        .focused_session_id
        .as_deref()
        .and_then(|session_id| resolve(session_id));
    match focused {
        // The core derives the active project and group from the focused session.
        Some(focused) => update = update.with_focused_session(focused),
        None => {
            update = update.clear_focused_session();
            if let Some(project) = &active_project {
                let selected = old_state
                    .active_group_id
                    .as_deref()
                    .and_then(ActiveGroup::parse_sidebar_group_id)
                    .filter(|group| group_belongs_to(store, group, project));
                update = update.with_active_group(
                    selected.unwrap_or_else(|| default_group_for_project(store, project)),
                );
            }
        }
    }
    let foreign = old_state.focused_session_id.is_some()
        && matches!(update.focused_session, FocusField::Clear);
    match active_project {
        Some(project) => (update.with_active_project(project), foreign),
        None => (update, foreign),
    }
}
