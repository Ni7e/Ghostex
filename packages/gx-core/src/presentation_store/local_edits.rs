//! Local-first edits: hides and optimistic patches. None of them touches the revision.

use std::borrow::Cow;

use ghostex_gx_protocol::PresentationSession;

use super::store::{MachinePresentation, PresentationStore};
use crate::change::{ChangeSummary, IgnoredReason};
use crate::keys::{ProjectKey, SessionKey};
use crate::overlay::{PatchVerdict, SessionPatch, StoredPatch};

impl PresentationStore {
    /// Hides a session locally (a local-first close). Returns whether it was visible before.
    pub fn hide_session(&mut self, key: &SessionKey) -> ChangeSummary {
        let Some(entry) = self.machines.get_mut(&key.machine) else {
            return ChangeSummary::ignored(IgnoredReason::UnknownTarget);
        };
        let was_visible = entry
            .effective_session(&key.project_id, &key.session_id)
            .is_some();
        entry
            .overlays
            .hidden_sessions
            .insert(&key.project_id, &key.session_id, ());
        let mut summary = ChangeSummary::default();
        if was_visible {
            summary.note_session_removed(key.clone());
            summary.note_session_order_changed(key.project_key());
        }
        summary
    }

    /// Takes a local hide back (the close request failed).
    pub fn unhide_session(&mut self, key: &SessionKey) -> ChangeSummary {
        let Some(entry) = self.machines.get_mut(&key.machine) else {
            return ChangeSummary::ignored(IgnoredReason::UnknownTarget);
        };
        let mut summary = ChangeSummary::default();
        if entry
            .overlays
            .hidden_sessions
            .remove(&key.project_id, &key.session_id)
            .is_some()
            && entry
                .effective_session(&key.project_id, &key.session_id)
                .is_some()
        {
            summary.note_session_changed(key.clone());
            summary.note_session_order_changed(key.project_key());
        }
        summary
    }

    /// Hides a project locally (close to recent) until the daemon's removal arrives.
    pub fn hide_project(&mut self, key: &ProjectKey) -> ChangeSummary {
        let Some(entry) = self.machines.get_mut(&key.machine) else {
            return ChangeSummary::ignored(IgnoredReason::UnknownTarget);
        };
        let mut summary = ChangeSummary::default();
        let exists = entry
            .loaded()
            .is_some_and(|loaded| loaded.project(&key.project_id).is_some());
        if entry
            .overlays
            .hidden_projects
            .insert(key.project_id.clone())
            && exists
        {
            summary.note_project_removed(key.clone());
            summary.note_project_order_changed(key.machine.clone());
        }
        summary
    }

    pub fn unhide_project(&mut self, key: &ProjectKey) -> ChangeSummary {
        let Some(entry) = self.machines.get_mut(&key.machine) else {
            return ChangeSummary::ignored(IgnoredReason::UnknownTarget);
        };
        let mut summary = ChangeSummary::default();
        let exists = entry
            .loaded()
            .is_some_and(|loaded| loaded.project(&key.project_id).is_some());
        if entry.overlays.hidden_projects.remove(&key.project_id) && exists {
            summary.note_project_changed(key.clone());
            summary.note_project_order_changed(key.machine.clone());
        }
        summary
    }

    /// Overlays an optimistic patch on a session. The revision is untouched.
    ///
    /// Refused when the store does not hold the session (there is nothing to overlay). A patch the
    /// daemon row already agrees with is not stored: it would have nothing to do, and would later
    /// look like a pending overlay to a newer daemon value.
    pub fn patch_session(&mut self, key: &SessionKey, patch: SessionPatch) -> ChangeSummary {
        let Some(entry) = self.machines.get_mut(&key.machine) else {
            return ChangeSummary::ignored(IgnoredReason::UnknownTarget);
        };
        let Some(server) = entry
            .loaded()
            .and_then(|loaded| loaded.server_session(&key.project_id, &key.session_id))
        else {
            return ChangeSummary::ignored(IgnoredReason::UnknownTarget);
        };
        let before = entry
            .effective_session(&key.project_id, &key.session_id)
            .map(Cow::into_owned);
        let stored = StoredPatch::new(patch, server);
        if stored.verdict(server) == PatchVerdict::Pending {
            entry
                .overlays
                .session_patches
                .insert(&key.project_id, &key.session_id, stored);
        } else {
            entry
                .overlays
                .session_patches
                .remove(&key.project_id, &key.session_id);
        }
        Self::session_change_since(entry, key, before)
    }

    /// Drops a session's optimistic patch (the request it anticipated failed).
    pub fn clear_session_patch(&mut self, key: &SessionKey) -> ChangeSummary {
        let Some(entry) = self.machines.get_mut(&key.machine) else {
            return ChangeSummary::ignored(IgnoredReason::UnknownTarget);
        };
        let before = entry
            .effective_session(&key.project_id, &key.session_id)
            .map(Cow::into_owned);
        entry
            .overlays
            .session_patches
            .remove(&key.project_id, &key.session_id);
        Self::session_change_since(entry, key, before)
    }

    fn session_change_since(
        entry: &MachinePresentation,
        key: &SessionKey,
        before: Option<PresentationSession>,
    ) -> ChangeSummary {
        let after = entry.effective_session(&key.project_id, &key.session_id);
        let mut summary = ChangeSummary::default();
        if before.as_ref() != after.as_deref() {
            summary.note_session_changed(key.clone());
        }
        summary
    }

    /// Drops every patch whose expiry has passed.
    pub fn expire_patches(&mut self, now_ms: u64) -> ChangeSummary {
        let mut summary = ChangeSummary::default();
        for (machine, entry) in &mut self.machines {
            let expired: Vec<(String, String)> = entry
                .overlays
                .session_patches
                .iter()
                .filter(|(_, _, stored)| stored.patch.expires_at_ms <= now_ms)
                .map(|(project_id, session_id, _)| (project_id.to_string(), session_id.to_string()))
                .collect();
            for (project_id, session_id) in expired {
                entry
                    .overlays
                    .session_patches
                    .remove(&project_id, &session_id);
                summary.note_session_changed(SessionKey {
                    machine: machine.clone(),
                    project_id,
                    session_id,
                });
            }
        }
        summary
    }
}
