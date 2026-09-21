//! The session note sheet and the composer chrome that reads it.
//!
//! Port of `packages/shared/session-chat-controller/note.ts` and `native-composer-chrome.ts`.

use crate::document::{ComposerChrome, Note};

/// What the note editor holds between frames.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NoteState {
    pub open: bool,
    pub value: String,
    /// The last body this client acknowledged as written.
    pub saved: String,
    pub edited: bool,
    pub loading: bool,
    /// The `readSessionAgentNote` in flight, so its answer can be routed back.
    ///
    /// `toggleNote` awaits the read in a `try`/`finally`: whatever it answers, the sheet stops
    /// loading. Without an id the answer reached nobody and the sheet span forever.
    pub read_request: Option<u64>,
}

impl NoteState {
    /// The document's own shape.
    pub fn document(&self) -> Note {
        Note {
            open: self.open,
            value: self.value.clone(),
            saved: self.saved.clone(),
            edited: self.edited,
            loading: self.loading,
        }
    }

    /// The body a flush would write, or `None` when it would write what is already saved.
    ///
    /// Blur, close, and view disposal can flush the same edit; acknowledge each body once.
    pub fn pending_flush(&self) -> Option<String> {
        let next = self.value.trim().to_string();
        (next != self.saved).then_some(next)
    }

    /// Takes the acknowledgement, the way `flushSessionNote` advances `state.saved` before the
    /// write so a second flush of the same body is a no-op.
    pub fn begin_flush(&mut self) -> Option<(String, String)> {
        let next = self.pending_flush()?;
        let previous = std::mem::replace(&mut self.saved, next.clone());
        Some((previous, next))
    }

    /// Puts the previous body back when the write failed and nothing newer has been saved since.
    pub fn fail_flush(&mut self, previous: String, attempted: &str) {
        if self.saved == attempted {
            self.saved = previous;
        }
    }
}

/// The stash and note reads that feed the composer's own buttons.
///
/// CDXC:SessionChat 2026-09-18 SEE-ALSO:
/// The React chrome is `packages/core-ui/chat/session-chat-composer-actions.tsx`: a stash count
/// badge, a session-note presence dot, and pressed Summary and Note buttons. `session-chat-view.tsx`
/// reads the same two sources; this keeps GPUI chat reading them through one projection.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ComposerChromeState {
    agent_session_id: Option<String>,
    /// Bumped on every refresh, so an answer that lands after the conversation moved on is dropped.
    generation: u64,
    note_text: String,
    /// Once the note editor has opened, its own state is newer than the presence read.
    note_owned: bool,
    session_id: Option<String>,
    stashed_prompt_count: usize,
}

/// One row of the stashed-prompt list, as far as the badge needs it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct StashedPromptRow {
    pub agent_session_id: Option<String>,
    pub session_id: Option<String>,
}

impl ComposerChromeState {
    /// Starts a refresh and answers the generation its results must carry.
    pub fn begin_refresh(&mut self, session_id: Option<Option<String>>) -> u64 {
        if let Some(session_id) = session_id {
            self.session_id = session_id;
        }
        self.generation += 1;
        self.generation
    }

    /// Whether the note read is worth making at all.
    pub fn wants_note_read(&self) -> bool {
        !self.note_owned
    }

    /// Folds a refresh's answers in, unless the conversation moved on.
    pub fn finish_refresh(
        &mut self,
        generation: u64,
        prompts: Option<&[StashedPromptRow]>,
        note: Option<&str>,
    ) -> bool {
        if self.generation != generation {
            return false;
        }
        if let Some(prompts) = prompts {
            self.stashed_prompt_count = prompts
                .iter()
                .filter(|prompt| {
                    (self.agent_session_id.is_some()
                        && prompt.agent_session_id == self.agent_session_id)
                        || (self.session_id.is_some() && prompt.session_id == self.session_id)
                })
                .count();
        }
        if let Some(note) = note {
            self.note_text = note.to_string();
        }
        true
    }

    /// The composer's own buttons: the note dot, the stash badge, and the pressed states.
    pub fn projection(
        &mut self,
        note: &NoteState,
        summary_mode: bool,
        agent_session_id: Option<&str>,
    ) -> ComposerChrome {
        let agent_session_id = agent_session_id.map(str::to_string);
        if self.agent_session_id != agent_session_id {
            self.agent_session_id = agent_session_id;
        }
        if note.open {
            self.note_owned = true;
        }
        let text = if self.note_owned {
            if note.open || note.edited {
                note.value.as_str()
            } else {
                note.saved.as_str()
            }
        } else {
            self.note_text.as_str()
        };
        ComposerChrome {
            note_presence: !text.trim().is_empty(),
            note_pressed: note.open,
            stash_badge: (self.stashed_prompt_count > 0)
                .then(|| self.stashed_prompt_count.min(9).to_string()),
            summary_pressed: summary_mode,
        }
    }
}
