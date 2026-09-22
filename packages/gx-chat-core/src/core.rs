//! The state machine: events in, document plus effects out.
//!
//! One owner, no I/O, no clock read. The core holds a [`ChatState`], routes each event to the
//! family that owns it (`crate::dispatch`), and reassembles the [`Document`] from the whole state
//! afterwards (`crate::document::assemble`). The port fills the family handlers one directory at a
//! time (`docs/2026-09-21/rust-chat/PLAN.md` step 3) without this file changing.

use crate::dispatch::events;
use crate::document::{
    assemble, frame_parts, Document, Frame, FrameParts, ItemsSplice, MinimapMarker, RowDetails,
    TranscriptItem,
};
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
    /// The clock and locale the host last passed in. The core never reads either itself.
    context: ChatContext,
    /// The context the published document was assembled at.
    ///
    /// The change test runs at THIS clock rather than the current one, which is what keeps the
    /// publish decision the TypeScript's: its document is a function of state and `Date.now()`, but
    /// it republishes only when the STATE changed, so a label that merely counts seconds never
    /// ships a new snapshot on its own.
    published_context: ChatContext,
    /// The wake the host was last told to arm, so a [`Effect::SetTimer`] is emitted only when the
    /// earliest deadline actually moved.
    armed_wake_ms: Option<u64>,
    /// What the host was last sent, so a frame carries only the changed window.
    sent: SentFrame,
    /// Bumped whenever `republish` rebuilds the frame parts, which stands in for the array
    /// identity `take` compares on.
    parts_revision: u64,
    /// Whether a publish has happened at all.
    ///
    /// `native-host.ts` starts with its OWN empty `minimapMarkers` and `subagentItems` arrays
    /// (native-host.ts:145, :149) and replaces both inside `publish` with the projection's rail and
    /// the viewer's list. So a drain before the first publish ships the module's arrays and the
    /// drain after it ships the replacements, which are different objects however equal they are.
    /// The core has no identities, so the first publish clears those two pointers by hand.
    published_once: bool,
}

/// The parts the host already has, which is what turns a whole list into a splice.
///
/// `native-host.ts` keeps one `sent…` variable per channel and compares by array identity; unchanged
/// items keep their identity there (`native-presentation.ts` caches its projection), so comparing by
/// value here is the same test.
#[derive(Clone, Debug, Default)]
struct SentFrame {
    /// The parts counter the host was last sent, so a drain after a publish ships all four
    /// channels and a drain without one ships none.
    parts_revision: u64,
    items: Option<Vec<TranscriptItem>>,
    subagent_items: Option<Vec<TranscriptItem>>,
    minimap: Option<Vec<MinimapMarker>>,
    row_details: Option<RowDetails>,
}

impl ChatCore {
    /// A core with nothing loaded yet: the document says "loading" and draws the skeleton.
    ///
    /// Assembled rather than hand-built, so an event that changes nothing the document can see
    /// leaves the revision at zero and the host's first drain ships no snapshot, which is where the
    /// TypeScript starts too (`start` pushes its boot read and publishes nothing).
    pub fn new() -> Self {
        let mut core = Self::default();
        core.document = assemble(&core.state, &core.context);
        core.parts = frame_parts(&core.state, &core.context);
        core
    }

    /// Applies one event and returns what the host must do.
    ///
    /// `context` carries the host's clock and UTC offset for this turn; every deadline, elapsed
    /// label, retry backoff and local-midnight boundary is measured against it, which is what
    /// makes a replay reproducible.
    pub fn handle(&mut self, event: Event, context: ChatContext) -> Vec<Effect> {
        self.context = context;
        // Index zero of the turn's clock reads is `now_ms` itself.
        self.state.core.clock_cursor = 1;
        // `dispatch` routes the event to its owner and then runs the six per-family settle hooks
        // in a fixed order, which is where every `useMemo` and `useEffect` of the TypeScript lives.
        //
        // A batch storage answer is ONE host round trip carrying several records, so it is
        // expanded into the per-key answers it stands for and dispatched in order. Every family's
        // existing arm then serves it unchanged, and the whole batch still publishes once: the
        // republish below runs after the last of them.
        let mut effects = Vec::new();
        for expanded in expand(event) {
            effects.extend(events::dispatch(&mut self.state, &expanded, &self.context));
        }
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
    pub fn context(&self) -> &ChatContext {
        &self.context
    }

    /// The frame for a host whose last seen revision is `last_revision`.
    ///
    /// The document is left out when the host is already current, which is what keeps a
    /// once-a-second status frame from shipping the whole transcript.
    pub fn frame(&mut self, last_revision: u64) -> Frame {
        let now_ms = self.context.now_ms;
        self.frame_at(last_revision, now_ms)
    }

    /// The same frame, with `nextWakeMs` measured at the host's clock AT THE DRAIN.
    ///
    /// `take` in `native-host.ts` reads `Date.now()` itself, so its wake is the remaining delay
    /// from the moment the host asks, not from the last event the core handled. A host that drains
    /// on a different turn from the one it last fed (which is every host: it ticks, then takes)
    /// would otherwise arm its timer that much too late.
    pub fn frame_at(&mut self, last_revision: u64, now_ms: f64) -> Frame {
        // `take` compares its four channels by IDENTITY. `projection.items` is a new array
        // whenever `NativeChatPresentation.update` rebuilt, even when every row in it was reused,
        // so a rebuild ships the degenerate splice `{start: length, deleteCount: 0, items: []}`;
        // an unchanged turn hands back the same result object and ships nothing. The core has no
        // identities, so the projection's own revision stands in for it.
        // The first drain always ships, whatever happened: `itemsSplice(undefined, next)` has no
        // previous array to compare against.
        let rebuilt = self.sent.items.is_none() || self.parts_revision != self.sent.parts_revision;
        self.sent.parts_revision = self.parts_revision;
        let mut items_splice = None;
        if rebuilt {
            items_splice = Some(splice(self.sent.items.as_deref(), &self.parts.items));
            self.sent.items = Some(self.parts.items.clone());
        }
        // The other three keep their identity when their content does: the minimap rail caches its
        // own projection, the subagent viewer hands back one stable list, and `rowDetails` is a
        // STRING, so `sentRowDetails === rowDetails` is a value comparison already.
        let subagent_splice =
            if self.sent.subagent_items.as_deref() == Some(self.parts.subagent_items.as_slice()) {
                None
            } else {
                let splice = splice(
                    self.sent.subagent_items.as_deref(),
                    &self.parts.subagent_items,
                );
                self.sent.subagent_items = Some(self.parts.subagent_items.clone());
                Some(splice)
            };
        let minimap = if self.sent.minimap.as_deref() == Some(self.parts.minimap.as_slice()) {
            None
        } else {
            self.sent.minimap = Some(self.parts.minimap.clone());
            Some(self.parts.minimap.clone())
        };
        let row_details = if self.sent.row_details.as_ref() == Some(&self.parts.row_details) {
            None
        } else {
            self.sent.row_details = Some(self.parts.row_details.clone());
            Some(self.parts.row_details.clone())
        };
        Frame {
            items_splice,
            minimap,
            subagent_splice,
            row_details,
            revision: self.revision,
            snapshot: if last_revision == self.revision {
                None
            } else {
                Some(Box::new(self.document.clone()))
            },
            requests: Vec::new(),
            next_wake_ms: self.state.core.timers.next_wake_ms(now_ms),
        }
    }

    /// The id for the next request the core asks for.
    ///
    /// One counter for the whole core, on the state, because every family draws from it and
    /// [`crate::Event::RpcSettled`] routes by id alone.
    pub fn allocate_request_id(&mut self) -> u64 {
        self.state.core.allocate_request_id()
    }

    /// Reassembles the document and bumps the revision when it changed.
    ///
    /// Only a real change bumps, because the revision is what the host's change gate reads: a bump
    /// with identical content would ship the whole document once a second for nothing.
    pub fn republish(&mut self) {
        crate::session::working::stamp_working_started(&mut self.state, self.context.now_ms);
        // The two `useEffect`s the TypeScript runs before the composition reads their state: the
        // pending echoes pruned against the authoritative list, and the pending tool row dropped
        // once the transcript retired it.
        crate::session::before_compose(&mut self.state, &self.context);
        self.state.messages.composed = crate::session::composition::compose(
            &self.state,
            &crate::session::constants::DEFAULT_COMMAND_CATALOG
                .iter()
                .map(|name| (*name).to_string())
                .collect::<Vec<_>>(),
            None,
            crate::session::working::is_working(&self.state),
        );
        // `presentation.update(state.messages, …)` runs here in `publish`, on the list the
        // composition above has just produced.
        crate::transcript::rows::refresh(&mut self.state, &self.context);
        // The test is "did the STATE change", asked in the only terms the core has: assemble the
        // new state at the clock the published document was assembled at. Equal means nothing but
        // the clock moved, and the TypeScript would not have published either, so the host keeps
        // the snapshot it has (its `snapshot` variable is not refreshed without a publish).
        let requested = std::mem::take(&mut self.state.core.publish_requested);
        let chain_continued = std::mem::take(&mut self.state.core.chain_continued);
        // `start`'s `.catch`: `transcriptItems = []; snapshot = {status: 'error', error};
        // revision++`. It runs with no controller at all, so it is decided before the gate below
        // and replaces the document rather than assembling one.
        if let Some(error) = self.state.core.boot_error.take() {
            self.document = crate::document::Document {
                status: "error".to_string(),
                error: ghostex_gx_protocol::Tri::Value(error),
                ..Default::default()
            };
            self.parts = FrameParts::default();
            self.state.transcript_view.projection_revision += 1;
            self.parts_revision = self.state.transcript_view.projection_revision;
            self.published_context = self.context.clone();
            self.revision += 1;
            return;
        }
        // `if (controller) publish(...)`: before the boot read answers there is no controller, so
        // nothing the core has done can ship yet and the host's first drain is empty.
        if !self.state.core.controller_started {
            return;
        }
        if chain_continued && !requested {
            return;
        }
        let probe = assemble(&self.state, &self.published_context);
        let probe_parts = frame_parts(&self.state, &self.published_context);
        // A rebuilt projection is a publish of its own: `update` rebuilds only when one of its
        // inputs changed identity, every one of those is a `useState` value the lifecycle
        // republishes on, and `take` then ships the new (if equal) array as a degenerate splice.
        // Holding the flag until the next real change shipped that splice a turn late.
        let rebuilt = self.state.transcript_view.projection_rebuilt;
        if !requested
            && !rebuilt
            && probe.reactive() == self.document.reactive()
            && probe_parts == self.parts
        {
            return;
        }
        self.document = assemble(&self.state, &self.context);
        self.parts = frame_parts(&self.state, &self.context);
        if std::mem::take(&mut self.state.transcript_view.projection_rebuilt) {
            self.state.transcript_view.projection_revision += 1;
        }
        self.parts_revision = self.state.transcript_view.projection_revision;
        self.published_context = self.context.clone();
        self.revision += 1;
        if !self.published_once {
            self.published_once = true;
            self.sent.minimap = None;
            self.sent.subagent_items = None;
        }
    }

    /// Replaces the document and bumps the revision, for a host seeding a cached frame.
    pub fn publish(&mut self, document: Document) {
        self.document = document;
        self.published_context = self.context.clone();
        self.revision += 1;
    }
}

/// One event, or the per-key answers a batch answer stands for.
///
/// `composer('asyncQuestionRead')` and `composer('asyncQuestionRetire')` each touch two stores and
/// answer once, so the core asks for them as one effect and hears back one event. Every family
/// reads storage per key, so the answer is fanned out here rather than in six settle hooks.
fn expand(event: Event) -> Vec<Event> {
    match event {
        Event::StorageBatchLoaded { records } => records
            .into_iter()
            .map(|record| Event::StorageLoaded {
                key: record.key,
                value: record.value,
            })
            .collect(),
        Event::StorageBatchWritten { keys, error } => keys
            .into_iter()
            .map(|key| Event::StorageWritten {
                key,
                error: error.clone(),
            })
            .collect(),
        other => vec![other],
    }
}

/// `itemsSplice(previous, next)`: replace `deleteCount` items at `start` with `items`.
///
/// CDXC:SessionChat 2026-09-18 WHY:
/// A live status row changes once a second, and shipping the whole transcript for it cost about 1MB
/// of JSON per frame on a 139-message session. Only the changed window crosses the bridge; GPUI
/// splices its item list and list state the same way.
/// SEE-ALSO: apps/desktop/src/app/native_chat/state.rs (pump).
fn splice(previous: Option<&[TranscriptItem]>, next: &[TranscriptItem]) -> ItemsSplice {
    let Some(previous) = previous else {
        return ItemsSplice {
            start: 0,
            delete_count: 0,
            items: next.to_vec(),
            length: next.len(),
        };
    };
    let limit = previous.len().min(next.len());
    let mut start = 0;
    while start < limit && previous[start] == next[start] {
        start += 1;
    }
    let mut end = 0;
    while end < limit - start && previous[previous.len() - 1 - end] == next[next.len() - 1 - end] {
        end += 1;
    }
    ItemsSplice {
        start,
        delete_count: previous.len() - start - end,
        items: next[start..next.len() - end].to_vec(),
        length: next.len(),
    }
}
