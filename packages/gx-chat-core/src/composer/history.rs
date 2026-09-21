//! Up-arrow recall of what this composer sent.
//!
//! Port of `packages/core-ui/chat/session-chat-composer-state.ts`.

/// The recall ring: what was sent, and where the cursor sits in it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ComposerHistory {
    pub entries: Vec<String>,
    /// `None` means the composer is showing its own text, not a recalled entry.
    pub index: Option<usize>,
}

impl ComposerHistory {
    /// Records a send, unless it is blank or repeats the newest entry. The cursor always resets.
    pub fn push(&mut self, sent: &str) {
        if sent.trim().is_empty() || self.entries.last().is_some_and(|last| last == sent) {
            self.index = None;
            return;
        }
        self.entries.push(sent.to_string());
        self.index = None;
    }

    /// One entry older, or `None` when there is no history at all.
    pub fn recall_previous(&mut self) -> Option<String> {
        if self.entries.is_empty() {
            return None;
        }
        let index = match self.index {
            None => self.entries.len() - 1,
            Some(index) => index.saturating_sub(1),
        };
        self.index = Some(index);
        Some(self.entries.get(index).cloned().unwrap_or_default())
    }

    /// One entry newer, or back to a blank composer. `None` when no entry is showing.
    pub fn recall_next(&mut self) -> Option<String> {
        let index = self.index? + 1;
        if index >= self.entries.len() {
            // Back to blank.
            self.index = None;
            return Some(String::new());
        }
        self.index = Some(index);
        Some(self.entries.get(index).cloned().unwrap_or_default())
    }

    /// Any manual edit resets the recall cursor and keeps the entries.
    pub fn reset_index(&mut self) {
        self.index = None;
    }

    /// Whether the composer is currently showing a recalled entry.
    pub fn is_active(&self) -> bool {
        self.index.is_some()
    }
}
