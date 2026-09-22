//! The one background thread the Rust chat brain runs on, and the per-view handle onto it.
//!
//! CDXC:SessionChat 2026-09-22 WHY:
//! ONE thread for every chat, not one per view. The QuickJS brain needs a thread each because each
//! view owns a 96 MiB runtime; a `ChatCore` is a plain value, so twelve of them share a thread and
//! the store's retention is a map on it. The handle keeps the same five methods
//! `ChatRuntimeWorker` has (`call`, `call_raw`, `query`, `query_for_gesture`, `take_outputs`) so
//! `apps/desktop/src/app/native_chat/` drives either brain through one shape.

use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock, mpsc};
use std::thread;
use std::time::Duration;

use ghostex_gx_chat_core::{ChatContext, Effect, Event, HostRequest};
use serde_json::Value;
use web_time::Instant;

use super::boot;
use super::diagnostics::{HostCounters, HostDiagnostics};
use super::draft_ops;
use super::effects::{self, Routed};
use super::events;
use super::frame;
use super::host_records;
use super::identity::ChatIdentity;
use super::locale;
use super::outbox::{self, Workers};
use super::queries;
use super::saves;
use super::storage;
use super::store::ChatStore;

/// What a drained chat hands its view. The same two cases `ChatRuntimeOutput` has, so the view's
/// `pump` does not care which brain produced them.
pub(crate) enum ChatHostOutput {
    Drained(Value),
    /// The host failed in a way the view should draw instead of the chat. One thing raises it: a
    /// panic inside the Rust brain, which disables that ONE chat (see [`disable_chat`]). A storage
    /// refusal is counted rather than fatal.
    Error(String),
}

/// What a chat whose brain panicked draws instead of its transcript.
///
/// A whole sentence, and a constant one: it reaches the view's error banner
/// (`native_chat/render.rs` draws `self.error` above the transcript), and a panic payload can carry
/// anything the failing code was holding, which for this crate is the user's conversation.
///
/// CDXC:SessionChat 2026-09-22 WHY:
/// It names the two things that actually work. The sentence used to offer "Reopen this chat", which
/// [`step`]'s `Attach` arm deliberately refuses with this very message, so the one recovery it
/// suggested was the one that could not happen; the two it names now are a setting the user can
/// reach and a restart, which is what clears `disabled`. "Chat brain" is the Settings row's own
/// label, so the sentence can be followed without translating it.
const HOST_PANIC_MESSAGE: &str =
    "Chat could not be shown. Set Chat brain back to QuickJS in Settings, or restart Ghostex.";

/// How deep a storage answer may feed back into the core within one drive pass.
///
/// Each answer can ask for the next read, and a rule that asked for a record it had just written
/// would otherwise spin the thread. Twelve is well past the longest real chain (the boot read, then
/// the notice, the question drafts and the retired-question list).
const MAX_SETTLE_ROUNDS: usize = 12;

/// One attached view.
struct Sink {
    id: u64,
    outputs: mpsc::Sender<ChatHostOutput>,
    wake: Arc<dyn Fn() + Send + Sync>,
    /// The revision this view last drained, so a frame carries only what changed.
    last_revision: u64,
}

enum HostCommand {
    Attach {
        identity: ChatIdentity,
        sink: Sink,
    },
    Detach {
        key: String,
        sink: u64,
    },
    Call {
        key: String,
        method: &'static str,
        arguments: Vec<Value>,
    },
    CallRaw {
        key: String,
        method: &'static str,
        raw: String,
    },
    Query {
        key: String,
        method: &'static str,
        arguments: Vec<Value>,
        reply: mpsc::Sender<Option<Value>>,
    },
}

/// A view's door onto the shared host.
pub(crate) struct ChatHostHandle {
    key: String,
    id: u64,
    outputs: mpsc::Receiver<ChatHostOutput>,
    idle: Arc<AtomicBool>,
}

static COMMANDS: OnceLock<mpsc::Sender<HostCommand>> = OnceLock::new();
static IDLE: OnceLock<Arc<AtomicBool>> = OnceLock::new();
static NEXT_SINK: AtomicU64 = AtomicU64::new(1);

impl ChatHostHandle {
    /// Attaches a view to the chat its config names, starting the host thread on first use.
    ///
    /// `config` is the same object `ChatRuntimeWorker::start` takes, so the two brains are picked
    /// from one call site.
    pub(crate) fn start(config: Value, wake: impl Fn() + Send + Sync + 'static) -> Self {
        let commands = COMMANDS.get_or_init(spawn).clone();
        let identity = ChatIdentity::from_config(&config);
        let key = identity.retention_key();
        let id = NEXT_SINK.fetch_add(1, Ordering::Relaxed);
        let (outputs, receiver) = mpsc::channel();
        let _ = commands.send(HostCommand::Attach {
            identity,
            sink: Sink {
                id,
                outputs,
                wake: Arc::new(wake),
                last_revision: 0,
            },
        });
        // `start` is an ordinary call once the chat exists, so the core hears it the same way the
        // QuickJS brain hears `nativeChat.start(config)`.
        let _ = commands.send(HostCommand::Call {
            key: key.clone(),
            method: "start",
            arguments: vec![config],
        });
        Self {
            key,
            id,
            outputs: receiver,
            idle: IDLE
                .get_or_init(|| Arc::new(AtomicBool::new(false)))
                .clone(),
        }
    }

    pub(crate) fn call(&self, method: &'static str, arguments: Vec<Value>) {
        if let Some(commands) = COMMANDS.get() {
            let _ = commands.send(HostCommand::Call {
                key: self.key.clone(),
                method,
                arguments,
            });
        }
    }

    pub(crate) fn call_raw(&self, method: &'static str, raw: String) {
        if let Some(commands) = COMMANDS.get() {
            let _ = commands.send(HostCommand::CallRaw {
                key: self.key.clone(),
                method,
                raw,
            });
        }
    }

    /// A pure helper for a per-paint caller: a busy thread answers nothing rather than stalling the
    /// frame, which is the rule `ChatRuntimeWorker::query` wrote down.
    pub(crate) fn query(
        &self,
        method: &'static str,
        arguments: Vec<Value>,
        timeout: Duration,
    ) -> Option<Value> {
        if !self.idle.load(Ordering::Acquire) {
            return None;
        }
        self.query_for_gesture(method, arguments, timeout)
    }

    /// A pure helper for one deliberate press, which queues behind running work.
    pub(crate) fn query_for_gesture(
        &self,
        method: &'static str,
        arguments: Vec<Value>,
        timeout: Duration,
    ) -> Option<Value> {
        let commands = COMMANDS.get()?;
        let (reply, answer) = mpsc::channel();
        commands
            .send(HostCommand::Query {
                key: self.key.clone(),
                method,
                arguments,
                reply,
            })
            .ok()?;
        answer.recv_timeout(timeout).ok()?
    }

    pub(crate) fn take_outputs(&self) -> Vec<ChatHostOutput> {
        self.outputs.try_iter().collect()
    }
}

impl Drop for ChatHostHandle {
    fn drop(&mut self) {
        if let Some(commands) = COMMANDS.get() {
            let _ = commands.send(HostCommand::Detach {
                key: self.key.clone(),
                sink: self.id,
            });
        }
    }
}

/// Starts the host thread and hands back its command channel.
fn spawn() -> mpsc::Sender<HostCommand> {
    let (commands, receiver) = mpsc::channel::<HostCommand>();
    let idle = IDLE
        .get_or_init(|| Arc::new(AtomicBool::new(false)))
        .clone();
    thread::Builder::new()
        .name("ghostex-gx-chat-host".into())
        .spawn(move || run(receiver, idle))
        .expect("spawn the chat host thread");
    commands
}

/// How many renderer requests one chat with no view attached may hold before the chat is released.
///
/// A chat is retained without a view for up to five minutes (`store.rs`), and the requests it
/// raises in that window are the view's to perform, so they wait for one. The bound is what keeps a
/// chat nobody reopens from growing a list nobody reads; 128 is well past what a retained chat's
/// timers produce in five minutes.
const MAX_HELD_REQUESTS: usize = 128;

/// Every chat, and what the host counts about them.
#[derive(Default)]
pub(super) struct World {
    pub(super) store: ChatStore,
    sinks: std::collections::BTreeMap<String, Sink>,
    wakes: std::collections::BTreeMap<String, Instant>,
    pub(super) counters: HostCounters,
    diagnostics: HostDiagnostics,
    /// The draft saves in flight, by request id, so the outbox row is cleared when gxserver has it.
    pub(super) draft_saves: std::collections::BTreeMap<u64, host_records::PendingDraft>,
    /// One retry worker per chat, which drains what a refused save left in the outbox.
    pub(super) draft_workers: Workers,
    /// When each chat's retry ladder is next due. Its own map, because `wakes` is the core's timer
    /// and `Effect::SetTimer` owns that one exclusively.
    pub(super) retry_wakes: std::collections::BTreeMap<String, Instant>,
    /// The `composer('park')` answer a handoff owes its `draftSubmitted` request.
    parked: std::collections::BTreeMap<String, draft_ops::ParkResult>,
    /// Delivery receipts already written, so a re-read of the same synced draft writes nothing.
    pub(super) delivered: std::collections::BTreeMap<String, std::collections::BTreeSet<String>>,
    /// What a chat with no attached view owes one, delivered when a view arrives.
    held_requests: std::collections::BTreeMap<String, Vec<HostRequest>>,
    /// The chat this thread is working on, so a panic knows which one to disable.
    driving: Option<String>,
    /// Chats whose brain panicked. They are not rebuilt: the same input would panic again.
    disabled: std::collections::BTreeSet<String>,
}

fn run(commands: mpsc::Receiver<HostCommand>, idle: Arc<AtomicBool>) {
    let mut world = World::default();
    loop {
        idle.store(true, Ordering::Release);
        let wait = world
            .wakes
            .values()
            .chain(world.retry_wakes.values())
            .min()
            .map(|at| at.saturating_duration_since(Instant::now()));
        let command = match wait {
            Some(wait) => match commands.recv_timeout(wait) {
                Ok(command) => Some(command),
                Err(mpsc::RecvTimeoutError::Timeout) => None,
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            },
            None => match commands.recv() {
                Ok(command) => Some(command),
                Err(_) => return,
            },
        };
        idle.store(false, Ordering::Release);
        // CDXC:SessionChat 2026-09-22 WHY:
        // ONE thread carries every chat, so a panic in one chat's rules would otherwise end all of
        // them AND leave `COMMANDS` holding a sender nobody reads: every later call would succeed
        // into a dead channel, every chat would freeze with no error drawn, and `idle` would be
        // left false so each paint's pure query would wait out its timeout. The panic is caught
        // per command instead: the one chat is dropped, its view is told, and the thread goes on.
        // The live QuickJS path is untouched by all of this, and an unwind cannot be avoided by
        // being careful, because `packages/gx-chat-core` indexes and unwraps like any other crate.
        //
        // The retention pass is INSIDE the guard: `ChatStore::prune` measures an idle chat by
        // serializing its whole document, which is `packages/gx-chat-core`'s `Serialize` code, so a
        // panic there would have ended the thread outright with none of the above applying.
        let pruned = std::panic::catch_unwind(AssertUnwindSafe(|| {
            step(&mut world, command);
            world.store.prune()
        }));
        match pruned {
            Ok(pruned) => {
                for key in pruned {
                    purge(&mut world, &key);
                }
            }
            Err(_) => disable_chat(&mut world),
        }
        world.counters.sessions_retained = world.store.len();
        world.counters.sessions_evicted = world.store.evicted;
        let counters = world.counters.clone();
        world.diagnostics.summary(&counters);
    }
}

/// Drops the chat this thread was working on when its brain panicked.
///
/// The chat is REMOVED rather than reset: `World` is only assumed-unwind-safe because the one piece
/// of state a panicking core can have left half written is that chat's own entry, and dropping it
/// is what makes that true. Rebuilding it is not offered either, because the input that panicked
/// is on its way back in as soon as the view retries.
///
/// A panic that belongs to NO chat is still recorded. `driving` is `None` for the stretch of the
/// timer pass between its two loops and for a command naming a chat that is already gone, and a
/// silent unwind there was the one failure this guard could not be noticed by: nothing drawn,
/// nothing counted, and the thread carrying on as if the pass had run.
fn disable_chat(world: &mut World) {
    world.counters.panics += 1;
    if let Some(key) = world.driving.take() {
        world.store.remove(&key);
        purge(world, &key);
        world.disabled.insert(key.clone());
        if let Some(sink) = world.sinks.remove(&key) {
            let posted = sink
                .outputs
                .send(ChatHostOutput::Error(HOST_PANIC_MESSAGE.to_string()))
                .is_ok();
            if posted {
                (sink.wake)();
            }
        }
        world.counters.chats_disabled += 1;
    }
    // Unconditional: "panic" in the event name is what `support_logs` reads as an important
    // diagnostic, and a chat whose brain died is one the user can see. Counts only, as ever: no
    // key, no session id, and never the payload, which is whatever the failing code was holding.
    crate::support_logs::append(
        crate::support_logs::GpuiSupportLog::SessionChat,
        "gxChat.host.chatDisabledAfterPanic",
        serde_json::json!({
            "panics": world.counters.panics,
            "chatsDisabled": world.counters.chats_disabled,
        }),
    );
}

/// Forgets everything keyed by one chat, so a map does not outlive the chat it belongs to.
///
/// CDXC:Drafts 2026-09-22 WHY:
/// `draft_saves` is NOT purged here, unlike the six maps above it. Its entries are keyed by the
/// request id of a `setSessionChatDraft` the view is still holding, and `settle_draft_save` runs
/// before the store is even consulted, so the answer still arrives and still clears the outbox row
/// it queued. Dropping the entry with the chat meant a save that was in flight when the retention
/// prune took its chat (twelve chats open, this one the least recently touched) was never
/// acknowledged: the row stayed in the outbox and went out again on the next open, delivering a
/// revision gxserver already had. The map is bounded on its own at 256 in flight, which is where a
/// view that never answers is accounted for.
fn purge(world: &mut World, key: &str) {
    world.wakes.remove(key);
    world.retry_wakes.remove(key);
    world.draft_workers.remove(key);
    world.parked.remove(key);
    world.delivered.remove(key);
    world.held_requests.remove(key);
}

/// One command, or one pass of the due timers.
///
/// `driving` names the chat this pass belongs to for as long as the pass runs, so a panic anywhere
/// inside it disables the right chat rather than none. The timer pass sets it per chat, because it
/// walks several.
fn step(world: &mut World, command: Option<HostCommand>) {
    world.driving = match &command {
        Some(HostCommand::Attach { identity, .. }) => Some(identity.retention_key()),
        Some(
            HostCommand::Detach { key, .. }
            | HostCommand::Call { key, .. }
            | HostCommand::CallRaw { key, .. }
            | HostCommand::Query { key, .. },
        ) => Some(key.clone()),
        None => None,
    };
    match command {
        Some(HostCommand::Attach { identity, sink }) => {
            let key = identity.retention_key();
            // A chat whose brain panicked is not rebuilt, and its view is told again rather than
            // being left drawing an empty pane.
            if world.disabled.contains(&key) {
                let posted = sink
                    .outputs
                    .send(ChatHostOutput::Error(HOST_PANIC_MESSAGE.to_string()))
                    .is_ok();
                if posted {
                    (sink.wake)();
                }
                return;
            }
            {
                let retained = world.store.entry(&identity);
                retained.listeners = 1;
                retained.touched_at = Instant::now();
            }
            // One sink per chat. A second view of the same session replaces the first, which is
            // how the app resolves a chat to one view already (`native_chat_for_generation`);
            // the replaced handle simply stops being drained.
            world.sinks.insert(key.clone(), sink);
            // `replayDraftSaves`: a save a previous run could not deliver is still in the
            // outbox, and opening its chat is what registers the writer that drains it.
            world.draft_workers.entry(key.clone()).or_default();
            world.retry_wakes.insert(key.clone(), Instant::now());
            drive(world, &key, Vec::new());
        }
        Some(HostCommand::Detach { key, sink }) => {
            if world.sinks.get(&key).is_some_and(|held| held.id == sink) {
                world.sinks.remove(&key);
                if let Some(retained) = world.store.get_mut(&key) {
                    retained.listeners = 0;
                    retained.touched_at = Instant::now();
                }
            }
        }
        Some(HostCommand::Call {
            key,
            method,
            arguments,
        }) => {
            // A `resolve` is the answer to a request the core made, and the view echoes the
            // core's own id back, so there is no order matching to do. A retry write is the
            // one exception: it is the HOST's own request, numbered above every id the core
            // can allocate, and the core must never see its answer.
            if method == "resolve" && saves::settle_retry_write(world, &key, &arguments) {
                return;
            }
            let events = if method == "resolve" {
                note_rpc_refusal(world, &arguments);
                saves::settle_draft_save(world, &key, &arguments);
                events::resolved(&arguments).into_iter().collect()
            } else {
                events::events_for(method, &arguments)
            };
            if events.is_empty() {
                world.counters.actions_unrouted += 1;
            }
            drive(world, &key, events);
        }
        Some(HostCommand::CallRaw { key, method, raw }) => {
            let arguments = serde_json::from_str::<Value>(&raw)
                .map(|value| vec![value])
                .unwrap_or_default();
            let events = events::events_for(method, &arguments);
            if events.is_empty() {
                world.counters.actions_unrouted += 1;
            }
            drive(world, &key, events);
        }
        Some(HostCommand::Query {
            key,
            method,
            arguments,
            reply,
        }) => {
            let answered = std::panic::catch_unwind(AssertUnwindSafe(|| {
                world.store.get(&key).and_then(|retained| {
                    let context = context(retained.core.state());
                    queries::answer(retained.core.state(), context, method, &arguments)
                })
            }));
            match answered {
                // A query changes nothing, so it does not drain; the view uses the answer at once.
                Ok(answer) => {
                    let _ = reply.send(answer);
                }
                Err(payload) => {
                    // The waiting view is answered FIRST, and only then does the unwind go on to
                    // the guard that disables the chat. `query_for_gesture` blocks the UI thread on
                    // this channel, so a panic that left it unanswered stalled the gesture for the
                    // whole timeout before the pane could draw anything at all, error included.
                    let _ = reply.send(None);
                    std::panic::resume_unwind(payload);
                }
            }
        }
        None => {
            let due: Vec<String> = world
                .retry_wakes
                .iter()
                .filter(|(_, at)| **at <= Instant::now())
                .map(|(key, _)| key.clone())
                .collect();
            for key in due {
                world.retry_wakes.remove(&key);
                world.driving = Some(key.clone());
                saves::drain_outbox(world, &key);
            }
            world.driving = None;
            let due: Vec<String> = world
                .wakes
                .iter()
                .filter(|(_, at)| **at <= Instant::now())
                .map(|(key, _)| key.clone())
                .collect();
            for key in due {
                world.wakes.remove(&key);
                drive(world, &key, vec![Event::Tick]);
            }
        }
    }
}

/// Counts one gxserver refusal by its CODE, and only when the code is one.
///
/// CDXC:Diagnostics 2026-09-22 WHY:
/// The code comes off the wire, so it is neither a code constant nor bounded: a daemon that
/// answered with a sentence, a path or a token in that field would put it in a support log, and an
/// unbounded map of them would also grow without limit. Anything that is not a short lower-case
/// identifier is counted as `other`, and the map stops admitting new names at 24, which is what the
/// summary prints anyway. The MESSAGE is never counted, only the code.
fn note_rpc_refusal(world: &mut World, arguments: &[Value]) {
    let Some(error) = arguments.get(2).filter(|value| !value.is_null()) else {
        return;
    };
    let code = error
        .get("code")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let named = code.len() <= 40
        && !code.is_empty()
        && code.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_-.".contains(&byte)
        });
    let code = if named { code } else { "other" };
    let counted =
        world.counters.rpc_refusals.len() < 24 || world.counters.rpc_refusals.contains_key(code);
    let entry = if counted { code } else { "other" };
    *world
        .counters
        .rpc_refusals
        .entry(entry.to_string())
        .or_insert(0) += 1;
}

/// Applies a burst of events to one chat, performs what the host owns, and drains a frame.
fn drive(world: &mut World, key: &str, events: Vec<Event>) {
    if world.store.get(key).is_none() {
        return;
    }
    world.driving = Some(key.to_string());
    let mut pending = events;
    // Whatever this chat owed a view it did not have, in the order it was raised. An empty list
    // for every chat with a view attached, which is every chat a gesture reaches.
    let mut requests: Vec<HostRequest> = world.held_requests.remove(key).unwrap_or_default();
    let mut rounds = 0usize;
    while !pending.is_empty() && rounds < MAX_SETTLE_ROUNDS {
        rounds += 1;
        let mut answers: Vec<Event> = Vec::new();
        for event in std::mem::take(&mut pending) {
            // The core's borrow ends before an effect is performed, because performing one reads
            // and writes the store's own counters.
            let (effects, session_key) = {
                let Some(retained) = world.store.get_mut(key) else {
                    world.driving = None;
                    return;
                };
                retained.touched_at = Instant::now();
                let session_key = retained.session_key.clone();
                let context = context(retained.core.state());
                (retained.core.handle(event, context), session_key)
            };
            for effect in effects {
                *world
                    .counters
                    .effects
                    .entry(effect_name(&effect))
                    .or_insert(0) += 1;
                match effects::route(effect) {
                    // Performed by doing nothing, because the shipped brain does nothing either
                    // (`effects::SWALLOWED_HOST_ACTIONS`). Counted by name so a deliberate no-op is
                    // still visible in `gxChat.host.summary`; the name is a code constant.
                    Routed::Swallowed(name) => {
                        *world
                            .counters
                            .host_actions_swallowed
                            .entry(name)
                            .or_insert(0) += 1;
                    }
                    Routed::Renderer(request) => {
                        if request.kind
                            == ghostex_gx_chat_core::RequestKind::Other(
                                effects::UNROUTED.to_string(),
                            )
                        {
                            world.counters.effects_unrouted += 1;
                        }
                        saves::note_draft_save(world, &session_key, &request);
                        requests.push(adopt_park_answer(world, key, *request));
                    }
                    // A gesture the core asked to have replayed at itself, which joins this
                    // round's answers so it settles inside the same drive pass.
                    Routed::SelfAction(action) => answers.push(Event::Action(action)),
                    Routed::Host(effect) => {
                        perform(
                            world,
                            key,
                            &session_key,
                            effect,
                            &mut answers,
                            &mut requests,
                        );
                    }
                }
            }
        }
        pending.append(&mut answers);
    }
    // A chain deeper than the cap leaves events unapplied, which is a rule the core grew and this
    // host never expected. It is counted rather than logged, because the events themselves are the
    // user's conversation.
    if !pending.is_empty() {
        world.counters.settle_rounds_exhausted += 1;
    }
    saves::record_deliveries(world, key);
    publish(world, key, requests);
    world.driving = None;
}

/// A handoff's `draftSubmitted` carries what `composer('park')` minted, which is the host's.
///
/// `native-host.ts` spreads the park answer into the request (`{...handoff, text, version}`), and
/// the view reads `nextVersion` out of it to start the composer's next draft. The core has no
/// random source and no view state, so both the handoff id and the next revision are made here and
/// merged on the way past.
fn adopt_park_answer(world: &mut World, key: &str, mut request: HostRequest) -> HostRequest {
    if request.kind != ghostex_gx_chat_core::RequestKind::DraftSubmitted {
        return request;
    }
    // Every send adopts a fresh revision, which is what `composer('submitted')` answers with.
    request
        .params
        .insert("nextVersion".into(), boot::next_draft_version());
    if request.method != "handoff" {
        return request;
    }
    if let Some(park) = world.parked.remove(key) {
        request
            .params
            .insert("handoffId".into(), Value::String(park.handoff_id));
        request
            .params
            .insert("content".into(), Value::String(park.content));
        request
            .params
            .insert("draftVersion".into(), park.draft_version);
    }
    request
}

/// Performs one host-side effect and queues the event that answers it.
fn perform(
    world: &mut World,
    key: &str,
    session_key: &str,
    effect: Effect,
    answers: &mut Vec<Event>,
    requests: &mut Vec<HostRequest>,
) {
    let now_ms = now_millis();
    match effect {
        Effect::ReadStorage { key: storage_key } => {
            let value = match storage::read(&storage_key, now_ms) {
                Ok(value) => value,
                Err(_) => {
                    world.counters.storage_refused += 1;
                    None
                }
            };
            answers.push(Event::StorageLoaded {
                key: storage_key,
                value,
            });
        }
        // One host operation that reads several records and answers once. The COUNT of round trips
        // is part of the contract, not an optimisation, so the batch stays one answer.
        Effect::ReadStorageBatch { keys } => {
            let records = keys
                .into_iter()
                .map(|storage_key| {
                    let value = match storage::read(&storage_key, now_ms) {
                        Ok(value) => value,
                        Err(_) => {
                            world.counters.storage_refused += 1;
                            None
                        }
                    };
                    ghostex_gx_chat_core::StorageRecord {
                        key: storage_key,
                        value,
                    }
                })
                .collect();
            answers.push(Event::StorageBatchLoaded { records });
        }
        Effect::WriteStorage {
            key: storage_key,
            value,
            ..
        } => {
            // `durable` asks for a flush before the answer. Every write here lands in one immediate
            // SQLite transaction with `synchronous=FULL`, so it is already durable when it returns.
            let error = match write_storage(world, key, session_key, &storage_key, &value, now_ms) {
                Ok(()) => None,
                Err(reason) => {
                    world.counters.storage_refused += 1;
                    Some(reason.to_string())
                }
            };
            answers.push(Event::StorageWritten {
                key: storage_key,
                error,
            });
        }
        // One outcome for the whole batch, because the host operation it stands for is one call.
        // The writes go out in the order given and the first refusal names the failure.
        Effect::WriteStorageBatch { writes } => {
            let mut keys = Vec::with_capacity(writes.len());
            let mut error = None;
            for write in writes {
                if let Err(reason) =
                    write_storage(world, key, session_key, &write.key, &write.value, now_ms)
                {
                    world.counters.storage_refused += 1;
                    error.get_or_insert_with(|| reason.to_string());
                }
                keys.push(write.key);
            }
            answers.push(Event::StorageBatchWritten { keys, error });
        }
        // `composer('flush')` is `flushDraftSaves(sessionKey)`: every stored write this door makes
        // is already on disk when it returns, so what is left to wait for is the outbox, and the
        // send must not deliver while a revision gxserver has not acknowledged is still queued.
        Effect::FlushStorage { store } => {
            let drained = outbox::pending(session_key, now_ms).is_empty();
            if !drained
                && let Some(request) = saves::next_retry_write(world, key, session_key, now_ms)
            {
                requests.push(request);
            }
            answers.push(Event::StorageWritten {
                key: ghostex_gx_chat_core::StorageKey {
                    store,
                    suffix: String::new(),
                },
                // A queued revision is a delivery the daemon has not taken yet, not a storage
                // failure: the ladder keeps trying and the send goes on, which is what the
                // TypeScript's already-resolved `flushDraftSaves` did for an empty queue.
                error: None,
            });
        }
        Effect::ReadComposerBoot { .. } => {
            let mut errors = 0usize;
            let read = boot::read(session_key, now_ms, &mut errors);
            world.counters.storage_refused += errors as u64;
            // `start` in `native-host.ts` pushes `{kind: 'composerInit', method: 'restore', params:
            // result}` from the same answer. It is the ONLY path that gives the view its client id,
            // its draft id and its draft revision, so without it every save is refused with "Two
            // editors changed the same draft revision" and the composer never reports itself ready.
            requests.push(HostRequest {
                id: None,
                kind: ghostex_gx_chat_core::RequestKind::ComposerInit,
                method: "restore".to_string(),
                params: match serde_json::to_value(&read) {
                    Ok(Value::Object(params)) => params,
                    _ => serde_json::Map::new(),
                },
            });
            answers.push(Event::ComposerBootRead(Box::new(read)));
        }
        Effect::SetTimer { delay_ms } => match delay_ms {
            Some(delay) => {
                world.wakes.insert(
                    key.to_string(),
                    Instant::now() + Duration::from_millis(delay.max(1)),
                );
            }
            None => {
                world.wakes.remove(key);
            }
        },
        _ => {}
    }
}

/// One stored write, or one of the three draft operations the core names as a store.
///
/// `composer('submitted')`, `composer('park')` and `composer('receive')` are conditional on what is
/// already on disk and touch records the core does not own, so they are performed here rather than
/// written through (`draft_ops.rs`). Anything else is an ordinary catalogued row.
fn write_storage(
    world: &mut World,
    key: &str,
    session_key: &str,
    storage_key: &ghostex_gx_chat_core::StorageKey,
    value: &Option<String>,
    now_ms: i64,
) -> Result<(), &'static str> {
    use ghostex_gx_chat_core::composer::storage::{
        DRAFT_PARK_STORE, DRAFT_RECEIVE_STORE, DRAFT_SUBMITTED_STORE,
    };
    let operation = matches!(
        storage_key.store.as_str(),
        DRAFT_SUBMITTED_STORE | DRAFT_PARK_STORE | DRAFT_RECEIVE_STORE
    );
    if !operation {
        return storage::write(storage_key, value.as_deref(), now_ms);
    }
    let payload: Value = value
        .as_deref()
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or(Value::Null);
    match storage_key.store.as_str() {
        DRAFT_SUBMITTED_STORE => draft_ops::submitted(session_key, &payload, now_ms),
        DRAFT_PARK_STORE => {
            let park = draft_ops::park(session_key, &payload, now_ms)?;
            world.parked.insert(key.to_string(), park);
            Ok(())
        }
        _ => draft_ops::receive(session_key, &payload, now_ms),
    }
}

/// Drains a frame and posts it, when it carries anything.
///
/// CDXC:SessionChat 2026-09-22 WHY:
/// A chat with no attached view HOLDS its requests rather than dropping them. The transport is the
/// view's (`effects.rs`), and a retained chat still ticks, so the requests a timer raises have
/// nowhere to go for as long as five minutes. Dropped, they took the core's own bookkeeping with
/// them: a `SendRpc` it never gets an answer to leaves its lane marked in flight for ever, which is
/// how the model-selection outbox and the draft retry worker each wedged on the first tick after a
/// chat was closed. The document itself was never at risk, because a drain with no sink does not
/// advance the revision and a new view reads the whole snapshot.
pub(super) fn publish(world: &mut World, key: &str, requests: Vec<HostRequest>) {
    let Some(last_revision) = world.sinks.get(key).map(|sink| sink.last_revision) else {
        hold(world, key, requests);
        return;
    };
    let Some(retained) = world.store.get_mut(key) else {
        return;
    };
    // `frame_at`, not `frame`: `take` in `native-host.ts` reads `Date.now()` itself, and measuring
    // `nextWakeMs` against the clock of the last event handled is one turn stale, so the host would
    // arm its timer that much late (`docs/2026-09-21/rust-chat/PROGRESS.md`, Integration 2 item 8).
    let drained = retained.core.frame_at(last_revision, now_millis() as f64);
    let revision = drained.revision;
    let envelope = frame::envelope(drained, requests);
    let carries = envelope
        .as_object()
        .is_some_and(frame::envelope_carries_change);
    let Some(sink) = world.sinks.get_mut(key) else {
        return;
    };
    sink.last_revision = revision;
    if !carries {
        return;
    }
    let posted = sink.outputs.send(ChatHostOutput::Drained(envelope)).is_ok();
    let wake = sink.wake.clone();
    world.counters.frames_published += 1;
    if posted {
        wake();
    }
}

/// Keeps what a chat with no attached view owes one, and RELEASES the chat when it owes too much.
///
/// CDXC:SessionChat 2026-09-22 WHY:
/// At the cap the whole chat goes, rather than the oldest requests going one by one. Dropping a
/// single request is exactly the failure the held lane exists to prevent: a `SendRpc` the core never
/// gets an answer to leaves its lane marked in flight for ever, so a chat trimmed at the cap would
/// come back with the model-selection outbox or the draft retry worker permanently wedged, and
/// nothing would ever say so. Releasing the chat is the five-minute retention prune arriving early,
/// and it costs nothing that is not already on disk or on the wire: the draft, its outbox row and
/// its recovery checkpoints are the host's records, and the transcript refolds from the snapshot the
/// next attach subscribes for. The next view therefore reads a chat with no half-settled lanes
/// instead of one that looks alive and is not.
fn hold(world: &mut World, key: &str, requests: Vec<HostRequest>) {
    if requests.is_empty() {
        return;
    }
    let held = world.held_requests.entry(key.to_string()).or_default();
    held.extend(requests);
    if held.len() <= MAX_HELD_REQUESTS {
        return;
    }
    let forgotten = held.len() as u64;
    world.store.remove(key);
    purge(world, key);
    world.counters.requests_dropped += forgotten;
    world.counters.chats_released += 1;
}

/// The clock, the timezone, the random draws and the formatted stamps, once per turn.
///
/// The core reads none of them: `packages/gx-chat-core` builds for wasm and must cross UniFFI, so
/// every one of them is an input. The draws are taken from the OS random source a v4 UUID uses
/// rather than a seeded generator, because the one rule that reads them is the working strip's
/// stint word and a repeated seed would freeze it on one word. The ids are raw entropy:
/// `ChatContext::random_id(slot)` forces the version and variant bits when it prints one back as a
/// canonical UUID, so the host must not pre-format them.
///
/// It is built with the `with_*` setters rather than an exhaustive struct literal, because an
/// input the core adds then costs this host nothing and falls back to what it did before.
fn context(state: &ghostex_gx_chat_core::ChatState) -> ChatContext {
    let bytes = uuid::Uuid::new_v4().into_bytes();
    let draw = |at: usize| -> f64 {
        let mut value = 0u64;
        for byte in bytes[at..at + 7].iter() {
            value = (value << 8) | u64::from(*byte);
        }
        value as f64 / (1u64 << 56) as f64
    };
    let utc_offset_minutes = chrono::Local::now().offset().local_minus_utc() / 60;
    ChatContext::at(now_millis() as f64)
        .with_utc_offset_minutes(utc_offset_minutes)
        .with_random_units([draw(0), draw(8)])
        .with_random_ids([
            u128::from_be_bytes(bytes),
            u128::from_be_bytes(uuid::Uuid::new_v4().into_bytes()),
        ])
        .with_formatted_times(locale::formatted_times(state, utc_offset_minutes))
}

pub(super) fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_millis() as i64)
        .unwrap_or(0)
}

/// The variant name of an effect, for the counters. Never its payload.
fn effect_name(effect: &Effect) -> &'static str {
    match effect {
        Effect::SendRpc { .. } => "sendRpc",
        Effect::Subscribe { .. } => "subscribe",
        Effect::Unsubscribe => "unsubscribe",
        Effect::Reconnect => "reconnect",
        Effect::ReadStorage { .. } => "readStorage",
        Effect::ReadStorageBatch { .. } => "readStorageBatch",
        Effect::ReadComposerBoot { .. } => "readComposerBoot",
        Effect::WriteStorage { .. } => "writeStorage",
        Effect::WriteStorageBatch { .. } => "writeStorageBatch",
        Effect::FlushStorage { .. } => "flushStorage",
        Effect::SetTimer { .. } => "setTimer",
        Effect::SetComposerText { .. } => "setComposerText",
        Effect::ClearComposerIfUnchanged { .. } => "clearComposerIfUnchanged",
        Effect::Open(_) => "open",
        Effect::Copy { .. } => "copy",
        Effect::Toast { .. } => "toast",
        Effect::RestoreReturnedPrompt { .. } => "restoreReturnedPrompt",
        Effect::MarkdownSaved { .. } => "markdownSaved",
        Effect::HostAction { .. } => "hostAction",
        _ => "unrouted",
    }
}
