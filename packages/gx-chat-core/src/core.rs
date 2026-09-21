//! The state machine: events in, document plus effects out.
//!
//! One owner, no I/O, no clock read. The core holds a [`ChatState`], routes each event to the
//! family that owns it (`crate::dispatch`), and reassembles the [`Document`] from the whole state
//! afterwards (`crate::document::assemble`). The port fills the family handlers one directory at a
//! time (`docs/2026-09-21/rust-chat/PLAN.md` step 3) without this file changing.

use crate::dispatch::events;
use crate::document::{assemble, frame_parts, Document, Frame, FrameParts};
use crate::effect::Effect;
use crate::event::Event;
use crate::state::{ChatContext, ChatState};

/// One chat's brain.
///
/// The host owns the socket, storage and timers, feeds this events, and hands [`ChatCore::frame`]
/// to the renderer. One instance per session lives in the store, so switching chats is a pointer
/// swap rather than a teardown.
#[derive(Clone, Debug, Default)]
pub struct ChatCore {
    state: ChatState,
    document: Document,
    parts: FrameParts,
    /// Bumped on every publish, so the host can ask for "only what changed since N".
    revision: u64,
    /// The id the next request carries. Monotonic, never reused, so a late answer to a retired
    /// request is dropped rather than misrouted.
    next_request_id: u64,
    /// The clock and locale the host last passed in. The core never reads either itself.
    context: ChatContext,
    /// The wake the host was last told to arm, so a [`Effect::SetTimer`] is emitted only when the
    /// earliest deadline actually moved.
    armed_wake_ms: Option<u64>,
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
    /// `context` carries the host's clock and UTC offset for this turn; every deadline, elapsed
    /// label, retry backoff and local-midnight boundary is measured against it, which is what
    /// makes a replay reproducible.
    pub fn handle(&mut self, event: Event, context: ChatContext) -> Vec<Effect> {
        self.context = context;
        let mut effects = events::dispatch(&mut self.state, &event, &self.context);
        // Family e1's surfaces have no event of their own: the option pills rebuild from the
        // catalog and the agent, the accounts poll runs on the clock, and the switch card advances
        // on every frame. That is `useMemo` and `useEffect` work in the TypeScript, so it runs once
        // per event here rather than being routed by kind.
        effects.extend(crate::menus::observe(&mut self.state, &self.context));
        self.republish();
        // One wake for the whole core, not one per timer: the table knows which key is earliest,
        // and the host only has to be asked again when that answer changed.
        let wake = self.next_wake_ms();
        if wake != self.armed_wake_ms {
            self.armed_wake_ms = wake;
            effects.push(Effect::SetTimer { delay_ms: wake });
        }
        effects
    }

    /// Milliseconds until the core's earliest armed deadline, or `None` when nothing is armed.
    pub fn next_wake_ms(&self) -> Option<u64> {
        self.state.core.timers.next_wake_ms(self.context.now_ms)
    }

    /// The state every family reads.
    pub fn state(&self) -> &ChatState {
        &self.state
    }

    /// The state, for the host that seeds a core from what it had cached.
    pub fn state_mut(&mut self) -> &mut ChatState {
        &mut self.state
    }

    /// What the renderer should draw right now.
    pub fn document(&self) -> &Document {
        &self.document
    }

    /// The current publish revision.
    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// The clock and locale the host last passed in.
    pub fn context(&self) -> ChatContext {
        self.context
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
            next_wake_ms: self.next_wake_ms(),
            ..Frame::default()
        }
    }

    /// The id for the next request the core asks for.
    pub fn allocate_request_id(&mut self) -> u64 {
        self.next_request_id += 1;
        self.next_request_id
    }

    /// Reassembles the document and bumps the revision when it changed.
    ///
    /// Only a real change bumps, because the revision is what the host's change gate reads: a bump
    /// with identical content would ship the whole document once a second for nothing.
    pub fn republish(&mut self) {
        crate::session::working::stamp_working_started(&mut self.state, self.context.now_ms);
        self.state.messages.composed = crate::session::composition::compose(
            &self.state,
            &crate::session::constants::DEFAULT_COMMAND_CATALOG
                .iter()
                .map(|name| (*name).to_string())
                .collect::<Vec<_>>(),
            None,
            crate::session::working::is_working(&self.state),
        );
        let document = assemble(&self.state, &self.context);
        let parts = frame_parts(&self.state, &self.context);
        if document == self.document && parts == self.parts {
            return;
        }
        self.document = document;
        self.parts = parts;
        self.revision += 1;
    }

    /// Replaces the document and bumps the revision, for a host seeding a cached frame.
    pub fn publish(&mut self, document: Document) {
        self.document = document;
        self.revision += 1;
    }
}
