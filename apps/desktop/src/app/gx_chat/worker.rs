//! The one background thread the Rust chat brain runs on, and the per-view handle onto it.
//!
//! CDXC:SessionChat 2026-09-22 WHY:
//! ONE thread for every chat, not one per view. The QuickJS brain needs a thread each because each
//! view owns a 96 MiB runtime; a `ChatCore` is a plain value, so twelve of them share a thread and
//! the store's retention is a map on it. The handle keeps the same five methods
//! `ChatRuntimeWorker` has (`call`, `call_raw`, `query`, `query_for_gesture`, `take_outputs`) so
//! `apps/desktop/src/app/native_chat/` drives either brain through one shape.

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
use super::host_records::{self, DraftVersion, PendingDraft, RecoveryCheckpoint};
use super::identity::ChatIdentity;
use super::locale;
use super::outbox::{self, DraftWorker, Workers};
use super::queries;
use super::storage;
use super::store::ChatStore;

/// What a drained chat hands its view. The same two cases `ChatRuntimeOutput` has, so the view's
/// `pump` does not care which brain produced them.
pub(crate) enum ChatHostOutput {
    Drained(Value),
    /// The host failed in a way the view should draw instead of the chat. Nothing raises it yet: a
    /// `ChatCore` cannot fail to boot the way a QuickJS runtime can, and a storage refusal is
    /// counted rather than fatal. The variant stays so the view's two arms keep matching.
    #[allow(dead_code)]
    Error(String),
}

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

/// Every chat, and what the host counts about them.
#[derive(Default)]
struct World {
    store: ChatStore,
    sinks: std::collections::BTreeMap<String, Sink>,
    wakes: std::collections::BTreeMap<String, Instant>,
    counters: HostCounters,
    diagnostics: HostDiagnostics,
    /// The draft saves in flight, by request id, so the outbox row is cleared when gxserver has it.
    draft_saves: std::collections::BTreeMap<u64, PendingDraft>,
    /// One retry worker per chat, which drains what a refused save left in the outbox.
    draft_workers: Workers,
    /// When each chat's retry ladder is next due. Its own map, because `wakes` is the core's timer
    /// and `Effect::SetTimer` owns that one exclusively.
    retry_wakes: std::collections::BTreeMap<String, Instant>,
    /// The `composer('park')` answer a handoff owes its `draftSubmitted` request.
    parked: std::collections::BTreeMap<String, draft_ops::ParkResult>,
    /// Delivery receipts already written, so a re-read of the same synced draft writes nothing.
    delivered: std::collections::BTreeMap<String, std::collections::BTreeSet<String>>,
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
        match command {
            Some(HostCommand::Attach { identity, sink }) => {
                let key = identity.retention_key();
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
                drive(&mut world, &key, Vec::new());
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
                if method == "resolve" && settle_retry_write(&mut world, &key, &arguments) {
                    continue;
                }
                let events = if method == "resolve" {
                    settle_draft_save(&mut world, &key, &arguments);
                    events::resolved(&arguments).into_iter().collect()
                } else {
                    events::events_for(method, &arguments)
                };
                if events.is_empty() {
                    world.counters.actions_unrouted += 1;
                }
                drive(&mut world, &key, events);
            }
            Some(HostCommand::CallRaw { key, method, raw }) => {
                let arguments = serde_json::from_str::<Value>(&raw)
                    .map(|value| vec![value])
                    .unwrap_or_default();
                let events = events::events_for(method, &arguments);
                if events.is_empty() {
                    world.counters.actions_unrouted += 1;
                }
                drive(&mut world, &key, events);
            }
            Some(HostCommand::Query {
                key,
                method,
                arguments,
                reply,
            }) => {
                let answer = world.store.get(&key).and_then(|retained| {
                    let context = context(retained.core.state());
                    queries::answer(retained.core.state(), context, method, &arguments)
                });
                let _ = reply.send(answer);
                // A query changes nothing, so it does not drain; the view uses the answer at once.
                continue;
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
                    drain_outbox(&mut world, &key);
                }
                let due: Vec<String> = world
                    .wakes
                    .iter()
                    .filter(|(_, at)| **at <= Instant::now())
                    .map(|(key, _)| key.clone())
                    .collect();
                for key in due {
                    world.wakes.remove(&key);
                    drive(&mut world, &key, vec![Event::Tick]);
                }
            }
        }
        world.store.prune();
        world.counters.sessions_retained = world.store.len();
        world.counters.sessions_evicted = world.store.evicted;
        let counters = world.counters.clone();
        world.diagnostics.summary(&counters);
    }
}

/// Applies a burst of events to one chat, performs what the host owns, and drains a frame.
fn drive(world: &mut World, key: &str, events: Vec<Event>) {
    if world.store.get(key).is_none() {
        return;
    }
    let mut pending = events;
    let mut requests: Vec<HostRequest> = Vec::new();
    let mut rounds = 0usize;
    // The boot read is one per chat, and it is the first thing the core asks for.
    let needs_boot = world
        .store
        .get(key)
        .is_some_and(|retained| !retained.booted);
    if needs_boot && let Some(retained) = world.store.get_mut(key) {
        retained.booted = true;
    }
    while !pending.is_empty() && rounds < MAX_SETTLE_ROUNDS {
        rounds += 1;
        let mut answers: Vec<Event> = Vec::new();
        for event in std::mem::take(&mut pending) {
            // The core's borrow ends before an effect is performed, because performing one reads
            // and writes the store's own counters.
            let (effects, session_key) = {
                let Some(retained) = world.store.get_mut(key) else {
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
                note_unperformed(world, &effect);
                match effects::route(effect) {
                    Routed::Renderer(request) => {
                        if request.kind
                            == ghostex_gx_chat_core::RequestKind::Other(
                                effects::UNROUTED.to_string(),
                            )
                        {
                            world.counters.effects_unrouted += 1;
                        }
                        note_draft_save(world, &session_key, &request);
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
    record_deliveries(world, key);
    publish(world, key, requests);
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

/// Writes the sent history for every draft gxserver reports it delivered, once each.
///
/// `onDeliveredDrafts` in `native-host.ts` hands the receipts to `composer('deliveries')`, which is
/// `recordDeliveredSessionChatDrafts`. The core folds them onto `session.synced_draft`
/// (`merge_draft_state`), so the host reads them there rather than needing a callback into the
/// core. The stored receipt set is the real de-duplication; the in-memory set only keeps a chat
/// that re-reads the same snapshot from touching disk again.
fn record_deliveries(world: &mut World, key: &str) {
    let Some(retained) = world.store.get(key) else {
        return;
    };
    let Some(deliveries) = retained
        .core
        .state()
        .session
        .synced_draft
        .as_ref()
        .and_then(|draft| draft.get("deliveredDrafts"))
        .and_then(Value::as_array)
        .filter(|deliveries| !deliveries.is_empty())
        .cloned()
    else {
        return;
    };
    let now_ms = now_millis();
    let seen = world.delivered.entry(key.to_string()).or_default();
    let mut refusals = 0u64;
    for delivery in deliveries {
        let (Some(id), Some(project_id), Some(session_id)) = (
            delivery.get("id").and_then(Value::as_str),
            delivery.get("projectId").and_then(Value::as_str),
            delivery.get("sessionId").and_then(Value::as_str),
        ) else {
            continue;
        };
        if !seen.insert(id.to_string()) {
            continue;
        }
        if host_records::record_delivered_draft(
            id,
            project_id,
            session_id,
            delivery
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            delivery
                .get("deliveredAt")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            now_ms,
        )
        .is_err()
        {
            // A refused write must be retried rather than remembered as done.
            seen.remove(id);
            refusals += 1;
        }
    }
    world.counters.storage_refused += refusals;
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
            if !drained && let Some(request) = next_retry_write(world, key, session_key, now_ms) {
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
fn publish(world: &mut World, key: &str, requests: Vec<HostRequest>) {
    let Some(last_revision) = world.sinks.get(key).map(|sink| sink.last_revision) else {
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

fn now_millis() -> i64 {
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

/// Counts a host action nothing performs, by its own name.
///
/// The three in [`effects::UNPERFORMED_HOST_ACTIONS`] are the core calling itself through a door
/// that does not exist yet. The counter is what makes that visible in `gxChat.host.summary` rather
/// than leaving a model pick, a slash-command send or an agent hand-off silently doing nothing.
fn note_unperformed(world: &mut World, effect: &Effect) {
    let Effect::HostAction { action, .. } = effect else {
        return;
    };
    let Some(name) = effects::UNPERFORMED_HOST_ACTIONS
        .iter()
        .find(|known| *known == action)
    else {
        return;
    };
    *world.counters.host_actions_dropped.entry(name).or_insert(0) += 1;
}

/// Writes the durable save outbox and the recovery checkpoint a draft save owes.
///
/// CDXC:Drafts 2026-09-10 DECISION:
/// User: unsaved edits must survive unavailable connections and retry across restarts, with visible
/// save failures, and saving must work quietly in the background without a routine saving indicator
/// while typing. The two records belong to the HOST, not the brain: the core reads neither and a
/// platform-neutral crate cannot own a disk-backed retry worker. The outbox row is written BEFORE
/// the call goes out, so a crash between the two leaves the save to be retried rather than lost.
fn note_draft_save(world: &mut World, session_key: &str, request: &HostRequest) {
    if request.kind != ghostex_gx_chat_core::RequestKind::Rpc
        || request.method != ghostex_gx_chat_core::ChatRpcMethod::SetSessionChatDraft.as_str()
    {
        return;
    }
    let Some(request_id) = request.id else {
        return;
    };
    let version = request
        .params
        .get("version")
        .or_else(|| request.params.get("draftVersion"));
    let Some(version) = version.and_then(|value| {
        Some(DraftVersion {
            draft_id: value.get("draftId")?.as_str()?.to_string(),
            revision: value.get("revision")?.as_i64()?,
        })
    }) else {
        return;
    };
    let content = request
        .params
        .get("content")
        .or_else(|| request.params.get("text"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let now_ms = now_millis();
    let draft = PendingDraft {
        client_id: request
            .params
            .get("clientId")
            .and_then(Value::as_str)
            .map(str::to_string),
        session_key: session_key.to_string(),
        content: content.clone(),
        version: version.clone(),
        updated_at: now_ms,
    };
    if host_records::queue_draft_save(&draft, now_ms).is_err() {
        world.counters.storage_refused += 1;
    }
    if host_records::preserve_draft_revision(
        &RecoveryCheckpoint {
            session_key: session_key.to_string(),
            text: content,
            updated_at: now_ms,
            version: Some(version),
            dismissed: None,
        },
        now_ms,
    )
    .is_err()
    {
        world.counters.storage_refused += 1;
    }
    world.draft_saves.insert(request_id, draft);
}

/// Clears the outbox row once gxserver acknowledged the save, and arms the ladder when it did not.
///
/// A refusal leaves the row where it is, which is what makes the save retry at all: the stored
/// record IS the queue, so a save is not lost when the app quits between two attempts.
fn settle_draft_save(world: &mut World, key: &str, arguments: &[Value]) {
    let Some(request_id) = arguments.first().and_then(Value::as_u64) else {
        return;
    };
    let Some(draft) = world.draft_saves.remove(&request_id) else {
        return;
    };
    if arguments.get(2).is_some_and(|error| !error.is_null()) {
        // The row it queued is still in the outbox, and that row is the queue, so the in-flight
        // entry is dropped rather than kept: keeping it would grow a map nothing ever reads again.
        arm_retry(world, key, true);
        return;
    }
    if outbox::acknowledge(&draft.session_key, &draft.version, now_millis()).is_err() {
        world.counters.storage_refused += 1;
    }
    let worker = world.draft_workers.entry(key.to_string()).or_default();
    worker.failures = 0;
}

/// The answer to a retry write of this host's own, which the core must never see.
///
/// A retry is numbered from [`outbox::HOST_REQUEST_ID_BASE`], above every id
/// `ChatCore::allocate_request_id` can reach, so one glance at the id says whose answer this is.
fn settle_retry_write(world: &mut World, key: &str, arguments: &[Value]) -> bool {
    let Some(request_id) = arguments.first().and_then(Value::as_u64) else {
        return false;
    };
    if request_id < outbox::HOST_REQUEST_ID_BASE {
        return false;
    }
    let failed = arguments.get(2).is_some_and(|error| !error.is_null());
    let now_ms = now_millis();
    let Some(worker) = world.draft_workers.get_mut(key) else {
        return true;
    };
    let Some(cleared) = outbox::settle(worker, request_id, failed, now_ms) else {
        return true;
    };
    if cleared {
        // The queue is drained one row at a time, in the order the revisions were typed.
        drain_outbox(world, key);
    } else {
        arm_retry(world, key, false);
    }
    true
}

/// Sends the next pending save of one chat, if the view is there to perform it.
fn drain_outbox(world: &mut World, key: &str) {
    let Some(session_key) = world
        .store
        .get(key)
        .map(|retained| retained.session_key.clone())
    else {
        return;
    };
    let now_ms = now_millis();
    let Some(request) = next_retry_write(world, key, &session_key, now_ms) else {
        return;
    };
    publish(world, key, vec![request]);
}

/// The next retry write, or `None` when one is in flight or nothing is pending.
fn next_retry_write(
    world: &mut World,
    key: &str,
    session_key: &str,
    now_ms: i64,
) -> Option<HostRequest> {
    let worker = world.draft_workers.entry(key.to_string()).or_default();
    outbox::next_write(worker, session_key, now_ms)
}

/// Arms the retry ladder after a refused save.
///
/// `count` is whether this refusal is the worker's own to count: a save the CORE issued is not one
/// of the worker's attempts, but it is the event that starts the ladder, which is exactly what
/// `queueDraftSave`'s `void flushDraftSaves(...)` did on the TypeScript side.
fn arm_retry(world: &mut World, key: &str, count: bool) {
    let worker: &mut DraftWorker = world.draft_workers.entry(key.to_string()).or_default();
    if count {
        worker.failures = worker.failures.saturating_add(1);
    }
    let delay = outbox::retry_delay_ms(worker.failures);
    world.retry_wakes.insert(
        key.to_string(),
        Instant::now() + Duration::from_millis(delay),
    );
}
