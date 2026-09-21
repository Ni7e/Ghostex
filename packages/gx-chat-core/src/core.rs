//! The state machine: events in, document plus effects out.
//!
//! The port fills the bodies family by family (`docs/2026-09-21/rust-chat/PLAN.md` step 3). What
//! is fixed here is the shape: one owner, no I/O, no clock read, and a document the host can hand
//! to the renderer unchanged.

use crate::document::{Document, Frame};
use crate::effect::Effect;
use crate::event::Event;

/// One chat's brain.
///
/// The host owns the socket, storage and timers, feeds this events, and hands [`ChatCore::frame`]
/// to the renderer. One instance per session lives in the store, so switching chats is a pointer
/// swap rather than a teardown.
#[derive(Clone, Debug, Default)]
pub struct ChatCore {
    document: Document,
    /// Bumped on every publish, so the host can ask for "only what changed since N".
    revision: u64,
    /// The id the next request carries. Monotonic, never reused, so a late answer to a retired
    /// request is dropped rather than misrouted.
    next_request_id: u64,
    /// The clock the host last passed in. The core never reads a clock itself.
    now_ms: f64,
}

impl ChatCore {
    /// A core with nothing loaded yet: the document says "loading" and draws the skeleton.
    pub fn new() -> Self {
        let mut core = Self::default();
        core.document.view.kind = "loading".to_string();
        core.document.status = "loading".to_string();
        core
    }

    /// Applies one event and returns what the host must do.
    ///
    /// `now_ms` is the host's clock for this turn; every deadline, elapsed label, and retry
    /// backoff is measured against it, which is what makes a replay reproducible.
    pub fn handle(&mut self, event: Event, now_ms: f64) -> Vec<Effect> {
        self.now_ms = now_ms;
        match event {
            // Each arm lands with its family's port. Until then an event is accepted and changes
            // nothing, which keeps a host wired against this build honest rather than panicking.
            Event::Start(_)
            | Event::Frame(_)
            | Event::Connection(_)
            | Event::RpcSettled { .. }
            | Event::Action(_)
            | Event::Tick
            | Event::StorageLoaded { .. }
            | Event::StorageWritten { .. }
            | Event::SettingsChanged(_)
            | Event::ContextPreferencesChanged { .. }
            | Event::ModelCatalogChanged { .. }
            | Event::Measured(_)
            | Event::DraftChanged { .. } => Vec::new(),
        }
    }

    /// What the renderer should draw right now.
    pub fn document(&self) -> &Document {
        &self.document
    }

    /// The current publish revision.
    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// The clock the host last passed in.
    pub fn now_ms(&self) -> f64 {
        self.now_ms
    }

    /// The frame for a host whose last seen revision is `last_revision`.
    ///
    /// The document is left out when the host is already current, which is what keeps a
    /// once-a-second status frame from shipping the whole transcript.
    pub fn frame(&self, last_revision: u64) -> Frame {
        Frame {
            revision: self.revision,
            snapshot: if last_revision == self.revision {
                None
            } else {
                Some(Box::new(self.document.clone()))
            },
            ..Frame::default()
        }
    }

    /// The id for the next request the core asks for.
    pub fn allocate_request_id(&mut self) -> u64 {
        self.next_request_id += 1;
        self.next_request_id
    }

    /// Replaces the document and bumps the revision. Every publish goes through here so no path
    /// can change what is drawn without telling the host.
    pub fn publish(&mut self, document: Document) {
        self.document = document;
        self.revision += 1;
    }
}
