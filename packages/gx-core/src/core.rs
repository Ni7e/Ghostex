//! The top-level state machine: events in, state plus effects out.

use ghostex_gx_protocol::{EventParseError, PresentationSnapshot, ServerEvent};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::change::{ChangeSummary, IgnoredReason};
use crate::focus::{ActiveGroup, ExternalFocusUpdate, FocusOutcome, FocusState};
use crate::keys::{MachineId, ProjectKey, SessionKey};
use crate::overlay::SessionPatch;
use crate::presentation_store::{PresentationStore, SideStateUpdate, SnapshotOrigin};

/// Something the user or the host did. Applied synchronously; never waits on the daemon.
///
/// New variants are added by later milestones; match with a wildcard arm.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub enum Intent {
    /// Focus a session. `visible` is the host's exact rendered set when the selection came from
    /// the workspace (tab click, next or previous tab); leave it `None` for a sidebar click.
    FocusSession {
        session: SessionKey,
        group: Option<ActiveGroup>,
        visible: Option<Vec<SessionKey>>,
    },
    /// Make a project active without choosing a session.
    FocusProject {
        project: ProjectKey,
    },
    /// The host reports the exact set of sessions that own a pane.
    SetVisibleSessions {
        sessions: Vec<SessionKey>,
    },
    /// The host reports which sessions are on screen (Auto Sleep safety).
    SetDisplayedSessions {
        sessions: Vec<SessionKey>,
    },
    /// A focus update that did not start here; dropped when older than the newest local intent.
    ExternalFocus(ExternalFocusUpdate),
    /// Local-first close: hide the row now, let the daemon catch up.
    HideSession {
        session: SessionKey,
    },
    /// The close request failed: show the row again.
    UnhideSession {
        session: SessionKey,
    },
    /// Local-first close to recent.
    HideProject {
        project: ProjectKey,
    },
    UnhideProject {
        project: ProjectKey,
    },
    /// Show an optimistic lifecycle or activity value until the daemon reports it.
    PatchSession {
        session: SessionKey,
        patch: SessionPatch,
    },
    /// The request a patch anticipated failed.
    ClearSessionPatch {
        session: SessionKey,
    },
}

/// An input to the core.
#[derive(Clone, Debug, PartialEq)]
#[non_exhaustive]
pub enum Event {
    /// A parsed frame from a machine's event stream. Parse off the UI thread with
    /// [`ServerEvent::parse`]; [`Core::handle_raw_frame`] does both for tools.
    Frame {
        machine: MachineId,
        frame: Box<ServerEvent>,
    },
    /// The result of an HTTP `readPresentationSnapshot`.
    SnapshotRead {
        machine: MachineId,
        snapshot: Box<PresentationSnapshot>,
    },
    /// The result of an HTTP `listProjects`: the full domain project rows.
    DomainProjectsRead {
        machine: MachineId,
        projects: Vec<Value>,
    },
    /// A machine was removed or its state must be forgotten.
    MachineUnloaded {
        machine: MachineId,
    },
    Intent(Intent),
    /// Time passed. The host decides how often; the core only compares deadlines to `now_ms`.
    Tick,
}

/// Why the host must subscribe to a machine's presentation again.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub enum ResubscribeReason {
    /// The daemon answered `presentationSnapshotCurrent` but the store holds nothing.
    CurrentWithoutSnapshot,
    /// A frame named another daemon than the loaded snapshot.
    ServerChanged,
}

/// A request the host must perform. The core never performs I/O itself.
///
/// New variants are added by later milestones; match with a wildcard arm.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub enum Effect {
    /// Send `subscribePresentation` again. `last_revision` is what to quote; `None` forces a full
    /// snapshot.
    ResubscribePresentation {
        machine: MachineId,
        last_revision: Option<i64>,
        reason: ResubscribeReason,
    },
    /// `globalSidebarCommandsChanged` carries no payload: read `/api/readSidebarHud`.
    RefetchSidebarHud { machine: MachineId },
    /// `notificationFeedChanged` carries no payload: read `/api/readNotificationFeed`.
    RefetchNotificationFeed { machine: MachineId },
    /// Persist the user's last selected session of a project (it must survive restarts).
    RememberProjectSession {
        project: ProjectKey,
        session: SessionKey,
    },
}

/// The result of handling one event.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Output {
    pub effects: Vec<Effect>,
    pub changes: ChangeSummary,
}

/// The one owner of product state.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Core {
    presentation: PresentationStore,
    focus: FocusState,
}

impl Core {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn presentation(&self) -> &PresentationStore {
        &self.presentation
    }

    pub fn focus(&self) -> &FocusState {
        &self.focus
    }

    /// Seeds focus from persisted state before anything else happens (startup restore). Does not
    /// count as a local intent.
    pub fn restore_focus(&mut self, focus: FocusState) {
        self.focus = focus;
    }

    /// The workspace tabs of the active group. `NotLoaded` until the owning machine's first
    /// snapshot arrived, and when no group is active.
    pub fn active_tab_sessions(
        &self,
    ) -> crate::selectors::Loadable<Vec<crate::selectors::TabSession>> {
        match &self.focus.active_group {
            Some(group) => self.presentation.tab_sessions(group),
            None => crate::selectors::Loadable::NotLoaded,
        }
    }

    /// Parses and handles one raw frame. For tools and tests of the wire path; a real client
    /// parses on its socket thread and sends [`Event::Frame`].
    pub fn handle_raw_frame(
        &mut self,
        machine: MachineId,
        frame: &str,
        now_ms: u64,
    ) -> Result<Output, EventParseError> {
        let frame = ServerEvent::parse(frame)?;
        Ok(self.handle(
            Event::Frame {
                machine,
                frame: Box::new(frame),
            },
            now_ms,
        ))
    }

    /// Applies one event. Synchronous and free of I/O; `now_ms` is the host's clock.
    pub fn handle(&mut self, event: Event, now_ms: u64) -> Output {
        let mut output = Output::default();
        match event {
            Event::Frame { machine, frame } => self.handle_frame(&machine, *frame, &mut output),
            Event::SnapshotRead { machine, snapshot } => {
                output.changes =
                    self.presentation
                        .apply_snapshot(&machine, "", *snapshot, SnapshotOrigin::Read);
            }
            Event::DomainProjectsRead { machine, projects } => {
                output.changes = self.presentation.set_domain_projects(&machine, projects);
            }
            Event::MachineUnloaded { machine } => {
                output.changes = self.presentation.unload_machine(&machine);
                let focus = self.focus.machine_gone(&machine);
                self.note_focus(focus, &mut output);
            }
            Event::Intent(intent) => self.handle_intent(intent, now_ms, &mut output),
            Event::Tick => output.changes = self.presentation.expire_patches(now_ms),
        }
        self.reconcile_focus_with_presentation(&mut output);
        output
    }

    fn handle_frame(&mut self, machine: &MachineId, frame: ServerEvent, output: &mut Output) {
        match frame {
            ServerEvent::PresentationSnapshot(frame) => {
                output.changes = self.presentation.apply_snapshot(
                    machine,
                    &frame.header.server_id,
                    *frame.snapshot,
                    SnapshotOrigin::Stream,
                );
            }
            ServerEvent::PresentationSnapshotCurrent(frame) => {
                output.changes = self.presentation.apply_snapshot_current(
                    machine,
                    &frame.header.server_id,
                    frame.revision,
                );
                if output.changes.ignored == Some(IgnoredReason::NotLoaded) {
                    output.effects.push(Effect::ResubscribePresentation {
                        machine: machine.clone(),
                        last_revision: None,
                        reason: ResubscribeReason::CurrentWithoutSnapshot,
                    });
                }
            }
            ServerEvent::PresentationDelta(frame) => {
                output.changes = self.presentation.apply_delta(
                    machine,
                    &frame.header.server_id,
                    frame.revision,
                    frame.delta,
                );
                self.resubscribe_if_server_changed(machine, output);
            }
            ServerEvent::WorkspaceGroupsChanged(frame) => self.handle_side_state(
                machine,
                &frame.header.server_id,
                frame.revision,
                SideStateUpdate::WorkspaceGroups(frame.groups),
                output,
            ),
            ServerEvent::SidebarProjectCollectionsChanged(frame) => self.handle_side_state(
                machine,
                &frame.header.server_id,
                frame.revision,
                SideStateUpdate::ProjectCollections(frame.sidebar_project_collections),
                output,
            ),
            ServerEvent::SidebarSpacesChanged(frame) => self.handle_side_state(
                machine,
                &frame.header.server_id,
                frame.revision,
                SideStateUpdate::Spaces(frame.sidebar_spaces),
                output,
            ),
            ServerEvent::CustomSessionTagsChanged(frame) => self.handle_side_state(
                machine,
                &frame.header.server_id,
                frame.revision,
                SideStateUpdate::CustomSessionTags(frame.custom_session_tags),
                output,
            ),
            ServerEvent::GlobalSidebarCommandsChanged(frame) => {
                if let Some(revision) = frame.revision {
                    self.presentation
                        .note_revision(machine, &frame.header.server_id, revision);
                }
                output.effects.push(Effect::RefetchSidebarHud {
                    machine: machine.clone(),
                });
            }
            ServerEvent::NotificationFeedChanged(_) => {
                output.effects.push(Effect::RefetchNotificationFeed {
                    machine: machine.clone(),
                });
            }
            ServerEvent::EventStreamReady(_)
            | ServerEvent::ServerStarted(_)
            | ServerEvent::ServerStopping(_)
            | ServerEvent::ApiRequestHandled(_)
            | ServerEvent::RendererCommand(_)
            | ServerEvent::SessionChatSnapshot(_)
            | ServerEvent::SessionChatReplaced(_)
            | ServerEvent::SessionChatAppended(_)
            | ServerEvent::SessionChatState(_)
            | ServerEvent::Unknown { .. } => {
                output.changes = ChangeSummary::ignored(IgnoredReason::NotOwnedYet);
            }
        }
    }

    fn handle_side_state(
        &mut self,
        machine: &MachineId,
        server_id: &str,
        revision: Option<i64>,
        update: SideStateUpdate,
        output: &mut Output,
    ) {
        output.changes = self
            .presentation
            .apply_side_state(machine, server_id, revision, update);
        self.resubscribe_if_server_changed(machine, output);
    }

    fn resubscribe_if_server_changed(&self, machine: &MachineId, output: &mut Output) {
        if output.changes.ignored == Some(IgnoredReason::ServerChanged) {
            output.effects.push(Effect::ResubscribePresentation {
                machine: machine.clone(),
                last_revision: None,
                reason: ResubscribeReason::ServerChanged,
            });
        }
    }

    fn handle_intent(&mut self, intent: Intent, now_ms: u64, output: &mut Output) {
        match intent {
            Intent::FocusSession {
                session,
                group,
                visible,
            } => {
                // Before the first snapshot the target cannot be checked (startup restore); once
                // the machine is loaded a session that does not exist is refused.
                let loaded = self.presentation.loaded(&session.machine).is_some();
                if loaded && self.presentation.session(&session).is_none() {
                    output.changes = ChangeSummary::ignored(IgnoredReason::UnknownTarget);
                    return;
                }
                let focus =
                    self.focus
                        .focus_session(&self.presentation, session, group, visible, now_ms);
                self.note_focus(focus, output);
            }
            Intent::FocusProject { project } => {
                let loaded = self.presentation.loaded(&project.machine).is_some();
                if loaded && self.presentation.project(&project).is_none() {
                    output.changes = ChangeSummary::ignored(IgnoredReason::UnknownTarget);
                    return;
                }
                let focus = self
                    .focus
                    .focus_project(&self.presentation, project, now_ms);
                self.note_focus(focus, output);
            }
            Intent::SetVisibleSessions { sessions } => {
                let focus = self.focus.set_visible_sessions(sessions, now_ms);
                self.note_focus(focus, output);
            }
            Intent::SetDisplayedSessions { sessions } => {
                let focus = self.focus.set_displayed_sessions(sessions);
                self.note_focus(focus, output);
            }
            Intent::ExternalFocus(update) => {
                let focus = self.focus.apply_external(update);
                self.note_focus(focus, output);
            }
            Intent::HideSession { session } => {
                output.changes = self.presentation.hide_session(&session);
            }
            Intent::UnhideSession { session } => {
                output.changes = self.presentation.unhide_session(&session);
            }
            Intent::HideProject { project } => {
                output.changes = self.presentation.hide_project(&project);
            }
            Intent::UnhideProject { project } => {
                output.changes = self.presentation.unhide_project(&project);
            }
            Intent::PatchSession { session, patch } => {
                output.changes = self.presentation.patch_session(&session, patch);
            }
            Intent::ClearSessionPatch { session } => {
                output.changes = self.presentation.clear_session_patch(&session);
            }
        }
    }

    fn note_focus(&self, focus: FocusOutcome, output: &mut Output) {
        if let Some((local_stamp, observed_stamp)) = focus.stale_external {
            output.changes.merge(ChangeSummary::ignored(
                IgnoredReason::OlderThanLocalIntent {
                    local_stamp,
                    observed_stamp,
                },
            ));
        }
        if focus.changed || focus.displayed_changed {
            output.changes.merge(ChangeSummary {
                focus_changed: focus.changed,
                displayed_changed: focus.displayed_changed,
                ..ChangeSummary::default()
            });
        }
        if let Some((project, session)) = focus.remembered {
            output
                .effects
                .push(Effect::RememberProjectSession { project, session });
        }
    }

    /// Focus must never point at a session that is gone. Runs after every event: sessions the
    /// daemon removed or the user hid leave focus, and after a machine's (re)load everything
    /// focus holds for that machine is checked against the new rows.
    fn reconcile_focus_with_presentation(&mut self, output: &mut Output) {
        let mut gone: Vec<SessionKey> = output.changes.sessions_removed.clone();
        for project in &output.changes.projects_removed {
            gone.extend(self.focus_sessions_where(|key| key.project_key() == *project));
        }
        let forgotten = gone.len();
        for machine in &output.changes.machines_reloaded {
            if self.presentation.loaded(machine).is_none() {
                continue;
            }
            let missing = self
                .focus_sessions_where(|key| key.machine == *machine)
                .into_iter()
                .filter(|key| self.presentation.session(key).is_none());
            gone.extend(missing);
        }
        if gone.is_empty() {
            return;
        }
        // Only sessions the daemon or the user removed are forgotten as a project's last
        // session. A reload must not forget them: the remembered session of a closed project is
        // not in the presentation, and the user still expects it back.
        let (removed, missing_after_reload) = gone.split_at(forgotten);
        let mut focus = self.focus.sessions_gone(removed, true);
        let reload = self.focus.sessions_gone(missing_after_reload, false);
        focus.changed |= reload.changed;
        focus.displayed_changed |= reload.displayed_changed;
        self.note_focus(focus, output);
    }

    fn focus_sessions_where(&self, matches: impl Fn(&SessionKey) -> bool) -> Vec<SessionKey> {
        self.focus
            .focused_session
            .iter()
            .chain(&self.focus.visible_sessions)
            .chain(&self.focus.displayed_sessions)
            .filter(|key| matches(key))
            .cloned()
            .collect()
    }
}
