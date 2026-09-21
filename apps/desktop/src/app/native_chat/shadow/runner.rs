//! The shadow itself: a thread per chat that keeps a [`ChatCore`] in step with the live brain.
//!
//! The live runtime thread does two things for it and nothing else: it hands over each seam line
//! as the recorder produces it, and it hands over each document the live brain drained. Both are
//! cheap sends; everything else happens over here.

use std::collections::VecDeque;
use std::panic::{self, AssertUnwindSafe};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, mpsc};
use std::thread;

use chrono::Local;
use ghostex_gx_chat_core::bridge::{
    BridgeCall, BridgeTranslator, comparable_document, comparable_value,
};
use ghostex_gx_chat_core::{ChatContext, ChatCore};
use serde_json::Value;

use super::capture::ShadowRecord;
use super::compare::compare_documents;
use super::counters::ShadowCounters;
use super::gate::shadow_enabled;
use super::log::ShadowLog;

/// Messages queued for the shadow thread. Past this the live brain is producing faster than the
/// comparison consumes, and dropping any one of them would desynchronize the two cores, so the
/// shadow stops instead of reporting numbers that mean nothing.
const MAX_QUEUED: usize = 512;
/// Drained documents waiting for the `take` record that names them. One is the normal depth: a
/// record reaches the seam when the NEXT call begins, so a document is always one call ahead.
const MAX_PENDING_DOCUMENTS: usize = 8;

/// What the live runtime thread sends over.
enum ShadowMessage {
    /// One line of the replay seam, exactly as the recorder writes it.
    Record(String),
    /// The document the live brain's `take` just returned.
    Document(Box<Value>),
}

/// The live side's handle on one chat's shadow.
///
/// CDXC:SessionChat 2026-09-22 WHY:
/// The shadow may never be able to affect the chat it is watching, so it does not share the
/// runtime thread: a panic in a half-ported rule, a slow comparison of a long transcript, or an
/// unbounded backlog would all be the user's problem if it did. It owns a thread, takes only
/// clones over a channel, performs NONE of the effects its core asks for, and switches itself off
/// on the first panic (`faults`) or the first backlog (`stopped`). The handle is deliberately not
/// `Sync`: it lives on the runtime thread that created it and nowhere else.
pub(crate) struct ShadowHost {
    messages: mpsc::Sender<ShadowMessage>,
    /// How many messages the thread has still to read, so the live side can see a backlog without
    /// asking the channel.
    queued: Arc<AtomicUsize>,
    /// False once the shadow has stopped, which is what makes both entry points free.
    running: Arc<AtomicBool>,
}

impl ShadowHost {
    /// Starts a shadow for this chat, or answers `None` when the scenario is off.
    ///
    /// With the scenario off no core is constructed, no thread is spawned, and the caller installs
    /// no capture hook, which is the whole of the "zero cost when off" rule.
    pub(crate) fn start_if_enabled() -> Option<Rc<Self>> {
        if !shadow_enabled() {
            return None;
        }
        let (messages, inbox) = mpsc::channel::<ShadowMessage>();
        let queued = Arc::new(AtomicUsize::new(0));
        let running = Arc::new(AtomicBool::new(true));
        let thread_queued = queued.clone();
        let thread_running = running.clone();
        thread::Builder::new()
            .name("ghostex-chat-shadow".into())
            .spawn(move || run(inbox, &thread_queued, &thread_running))
            .ok()?;
        Some(Rc::new(Self {
            messages,
            queued,
            running,
        }))
    }

    /// Hands over one seam line. Called from inside the QuickJS runtime, so it does no work.
    pub(crate) fn record(&self, line: &str) {
        self.send(ShadowMessage::Record(line.to_string()));
    }

    /// Hands over the document the live brain just drained, which is the other half of every
    /// comparison.
    pub(crate) fn document(&self, document: &Value) {
        self.send(ShadowMessage::Document(Box::new(document.clone())));
    }

    fn send(&self, message: ShadowMessage) {
        if !self.running.load(Ordering::Acquire) {
            return;
        }
        if self.queued.load(Ordering::Acquire) >= MAX_QUEUED {
            // The thread drains what it has and then reports why it stopped: the live side cannot
            // write the log line, because the counters are over there.
            self.running.store(false, Ordering::Release);
            return;
        }
        self.queued.fetch_add(1, Ordering::AcqRel);
        if self.messages.send(message).is_err() {
            self.running.store(false, Ordering::Release);
        }
    }
}

/// The shadow thread's loop.
fn run(inbox: mpsc::Receiver<ShadowMessage>, queued: &AtomicUsize, running: &AtomicBool) {
    let mut shadow = Shadow::new();
    while let Ok(message) = inbox.recv() {
        queued.fetch_sub(1, Ordering::AcqRel);
        // A half-ported rule that panics must cost the user nothing at all, so the shadow catches
        // it, counts it, and stops for this chat rather than taking the thread down on every
        // following document.
        if panic::catch_unwind(AssertUnwindSafe(|| shadow.apply(message))).is_err() {
            shadow.counters.faults += 1;
            running.store(false, Ordering::Release);
            shadow.log.stopped("panic", &shadow.counters);
            return;
        }
        if !running.load(Ordering::Acquire) {
            shadow.log.stopped("backlog", &shadow.counters);
            return;
        }
        shadow.log.summary(&shadow.counters, false);
        // The user turning the scenario off, or its expiry passing, stops the work as well as the
        // writing: an expired scenario must not leave a second brain running for the rest of the
        // session.
        if shadow.should_stop() {
            running.store(false, Ordering::Release);
            shadow.log.stopped("scenarioOff", &shadow.counters);
            return;
        }
    }
    // The chat closed: the live runtime thread dropped its end. Say what the run found, whatever
    // the interval says, so a chat that was open for ten seconds still leaves its numbers behind.
    running.store(false, Ordering::Release);
    shadow.log.summary(&shadow.counters, true);
}

/// One chat's shadow state.
struct Shadow {
    core: ChatCore,
    translator: BridgeTranslator,
    counters: ShadowCounters,
    log: ShadowLog,
    /// Documents the live brain drained, waiting for the `take` record that pairs them.
    live_documents: VecDeque<Value>,
    /// Minutes east of UTC, read once: the core cannot read a timezone, and the only rule that
    /// needs one is the transcript's local-midnight grouping.
    utc_offset_minutes: i32,
    /// How many messages have been applied since the gate was last read, so the settings snapshot
    /// is consulted about once a second rather than per call.
    since_gate_read: u32,
}

impl Shadow {
    fn new() -> Self {
        Self {
            core: ChatCore::new(),
            translator: BridgeTranslator::new(),
            counters: ShadowCounters::default(),
            log: ShadowLog::default(),
            live_documents: VecDeque::new(),
            utc_offset_minutes: Local::now().offset().local_minus_utc() / 60,
            since_gate_read: 0,
        }
    }

    fn apply(&mut self, message: ShadowMessage) {
        match message {
            ShadowMessage::Document(document) => {
                if self.live_documents.len() >= MAX_PENDING_DOCUMENTS {
                    self.live_documents.pop_front();
                    self.counters.documents_unpaired += 1;
                }
                self.live_documents.push_back(*document);
            }
            ShadowMessage::Record(line) => self.record(&line),
        }
    }

    /// Whether the shadow should stop because the scenario is no longer on. Checked on a counter
    /// rather than on every message, because it reads the shared settings snapshot.
    fn should_stop(&mut self) -> bool {
        self.since_gate_read += 1;
        if self.since_gate_read < 256 {
            return false;
        }
        self.since_gate_read = 0;
        !shadow_enabled()
    }

    fn record(&mut self, line: &str) {
        let Some(record) = ShadowRecord::parse(line) else {
            // The header line, and nothing else this seam produces.
            return;
        };
        self.counters.records += 1;
        let mut context = ChatContext::at(record.now_ms);
        context.utc_offset_minutes = self.utc_offset_minutes;
        for (slot, draw) in record
            .random
            .iter()
            .take(context.random_units.len())
            .enumerate()
        {
            context.random_units[slot] = *draw;
        }
        let Some(call) = BridgeCall::parse(&record.method, &record.arguments) else {
            self.counters.refusals += 1;
            return;
        };
        let is_take = matches!(call, BridgeCall::Take { .. });
        let is_query = matches!(call, BridgeCall::Query { .. });
        let outcome = self.translator.feed(&mut self.core, call, context);
        // The shadow performs NO effects. The live brain owns the socket, the storage and the
        // timers; a second send, write or subscribe from here is something the user can see.
        drop(outcome.effects);
        if outcome.applied == 0 {
            self.counters.refusals += 1;
        } else if !is_take && !is_query {
            self.counters.calls += 1;
        }
        self.counters.unanswered = self.translator.unanswered() as u64;
        self.counters.unmatched_answers = self.translator.unmatched_answers() as u64;
        if is_query {
            self.compare_query(outcome.query.as_deref(), record.hash.as_deref());
            return;
        }
        if is_take {
            self.compare_document(outcome.frame.as_ref());
        }
    }

    /// One pure helper answered on both sides. The recording carries the live answer's fingerprint
    /// and never the answer, so this compares the fingerprints.
    fn compare_query(&mut self, answer: Option<&str>, recorded: Option<&str>) {
        self.counters.queries += 1;
        let (Some(answer), Some(recorded)) = (answer, recorded) else {
            self.counters.queries_unanswered += 1;
            return;
        };
        if super::super::replay_recording::digest(answer) != recorded {
            self.counters.queries_different += 1;
        }
    }

    /// One drained document on each side.
    ///
    /// The live document arrives when the runtime thread drains; its `take` record reaches the
    /// seam one call later, which is when the shadow drains its own. The queue is what holds them
    /// together, and a pop that finds nothing is counted rather than compared against whatever is
    /// there.
    fn compare_document(&mut self, frame: Option<&ghostex_gx_chat_core::Frame>) {
        let (Some(frame), Some(live)) = (frame, self.live_documents.pop_front()) else {
            self.counters.documents_unpaired += 1;
            return;
        };
        let live = comparable_value(&live);
        let shadow = comparable_document(frame);
        let differences = compare_documents(&live, &shadow, &mut self.counters);
        for (key, pointer) in differences {
            self.log.difference(&key, &pointer, &self.counters);
        }
    }
}
