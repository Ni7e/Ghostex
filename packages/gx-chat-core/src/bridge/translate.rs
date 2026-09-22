//! Feeds the bridge's own calls into a [`ChatCore`] and answers what the core asks for.
//!
//! This is the half a shadow run and a replay share. The live QuickJS brain owns the real socket,
//! the real client storage and the real timers; the core beside it performs no I/O at all, so a
//! driver that only forwarded calls would be grading a brain that never heard back from anything:
//! the async question strip would stay `loading` forever, the accounts would never arrive, and
//! every surface fed by a read would be empty. [`BridgeTranslator`] is therefore a small host:
//! it holds client storage in memory, remembers what the core asked gxserver for, and turns the
//! bridge's `resolve` calls into the answers the core is waiting for.

use std::collections::{BTreeMap, VecDeque};

use serde_json::Value;

use crate::bridge::call::BridgeCall;
use crate::bridge::queries::answer_query;
use crate::core::ChatCore;
use crate::document::Frame;
use crate::effect::Effect;
use crate::event::{ChatSettings, ComposerBootRead, ConnectionUpdate, Event, StorageKey};
use crate::state::ChatContext;
use crate::wire::{
    ChatAppendedFrame, ChatFrame, ChatRpcMethod, ChatSnapshotFrame, ChatStateFrame, RpcOutcome,
};

/// What one [`BridgeTranslator::feed`] produced.
#[derive(Clone, Debug, Default)]
pub struct BridgeOutcome {
    /// How many events the call became and the core applied. Zero on a call this build does not
    /// model, which the caller counts as a refusal rather than a no-op.
    pub applied: usize,
    /// The effects the core returned, after the translator recorded the ones it answers itself.
    ///
    /// A shadow host performs NONE of them: the live brain is doing the real I/O and a second
    /// send, write or subscribe would be a duplicate the user can see.
    pub effects: Vec<Effect>,
    /// A pure helper's answer, serialized the way the bridge returns it.
    pub query: Option<String>,
    /// The frame a `take` drained.
    pub frame: Option<Frame>,
}

/// One request the core made and the bridge has still to answer.
#[derive(Clone, Debug)]
struct Outstanding {
    request_id: u64,
    /// `None` for the boot read, which answers with a [`ComposerBootRead`] rather than an
    /// [`RpcOutcome`].
    method: Option<ChatRpcMethod>,
}

/// The host half of a shadow run: client storage, the outstanding-request map, and the draining
/// revision.
///
/// **Why the answers are matched on order and shape rather than on the id they carry.** A
/// `resolve` names the request id the OTHER brain allocated, off a counter the TypeScript shares
/// with its timers, so it cannot be mapped onto the core's ids at all. What the two brains do
/// share is the ORDER they ask in, plus the fact that five gxserver reads name themselves in their
/// payload (`messages`, `skills`, `files`, `branches`, `accounts`). So an answer goes to the oldest
/// request that could have produced it, and a divergence in that order is exactly what
/// [`BridgeTranslator::unanswered`] and [`BridgeTranslator::unmatched_answers`] count.
#[derive(Clone, Debug, Default)]
pub struct BridgeTranslator {
    storage: BTreeMap<(String, String), String>,
    outstanding: VecDeque<Outstanding>,
    /// Storage answers the core is waiting for, oldest first.
    ///
    /// They are delivered on the bridge's `resolve` records that answer NOTHING the core asked
    /// for, because those records ARE the TypeScript's own storage round trips: its client storage
    /// rides on the broker (`composer('summary')`, `composer('questionWrite')`, …) where the
    /// core's is an [`Effect`]. Delivering them there rather than immediately is what puts a
    /// `summaryMode = await composer('summary', …)` on the same turn in both brains.
    storage_answers: VecDeque<Event>,
    /// Answers the OTHER brain never asked the bridge for, delivered on the same turn.
    ///
    /// The retained transcript is `store.ts`'s, not `native-host.ts`'s: its read and its write go
    /// straight to the managed store and produce no `resolve` record at all. Queueing them with
    /// the storage answers would consume a `resolve` that belongs to a real round trip and drift
    /// every answer after it, so they are handed back at once instead.
    direct_answers: VecDeque<Event>,
    /// The retained record this run holds, so a core that writes one can read it back.
    retained_snapshot: Option<String>,
    /// Recall-ring reads the core is waiting for, kept OUT of `storage_answers`.
    ///
    /// `composer('history')` is a SCAN of the sent-prompt store, not a record: the translator's
    /// in-memory storage cannot reproduce it, and the payload of the bridge's own
    /// `composer('history')` is the only answer both brains can agree on. It also must not join
    /// the FIFO above: inserting one answer there delays every answer after it by one `resolve`,
    /// which drifts the pairing for the rest of the run.
    history_reads: VecDeque<StorageKey>,
    /// Chunked broker payloads being reassembled, by transfer id: `(total, parts)`.
    transfers: BTreeMap<String, (usize, Vec<String>)>,
    /// The last call was a chunk that was accepted into `transfers` and produced no event yet.
    ///
    /// Read once by [`BridgeTranslator::feed`], which reports the call as applied: a piece the
    /// core has taken is modelled traffic, not a refusal.
    absorbed_chunk: bool,
    /// The revision the translator itself last drained, so a `take` asks "what changed since MY
    /// last drain" rather than replaying the other brain's counter.
    last_revision: u64,
    unanswered: usize,
    unmatched_answers: usize,
}

impl BridgeTranslator {
    /// A translator with empty storage and nothing in flight.
    pub fn new() -> Self {
        Self::default()
    }

    /// Applies one bridge call to the core.
    pub fn feed(
        &mut self,
        core: &mut ChatCore,
        call: BridgeCall,
        context: ChatContext,
    ) -> BridgeOutcome {
        match call {
            BridgeCall::Query { query, arguments } => BridgeOutcome {
                applied: 1,
                query: answer_query(core.state(), &context, query, &arguments),
                ..BridgeOutcome::default()
            },
            BridgeCall::Take { .. } => {
                // `take` reads `Date.now()` itself, so the wake is measured at the DRAIN's clock.
                let frame = core.frame_at(self.last_revision, context.now_ms);
                self.last_revision = frame.revision;
                BridgeOutcome {
                    applied: 1,
                    frame: Some(frame),
                    ..BridgeOutcome::default()
                }
            }
            other => {
                let mut outcome = BridgeOutcome::default();
                self.absorbed_chunk = false;
                for event in self.events_for(other) {
                    let effects = core.handle(event, context.clone());
                    self.record(&effects);
                    outcome.effects.extend(effects);
                    outcome.applied += 1;
                    while let Some(answer) = self.direct_answers.pop_front() {
                        let round = core.handle(answer, context.clone());
                        self.record(&round);
                        outcome.effects.extend(round);
                    }
                }
                if outcome.applied == 0 && std::mem::take(&mut self.absorbed_chunk) {
                    outcome.applied = 1;
                }
                outcome
            }
        }
    }

    /// Delivers every storage answer still queued, for a run that ran out of `resolve` calls.
    ///
    /// Without it a surface that reads a stored record is left loading in the last documents of a
    /// recording, which is a shortage of input rather than a difference in the rules.
    pub fn flush_storage(&mut self, core: &mut ChatCore, context: ChatContext) -> Vec<Effect> {
        let mut effects = Vec::new();
        while let Some(event) = self.storage_answers.pop_front() {
            let round = core.handle(event, context.clone());
            self.record(&round);
            effects.extend(round);
        }
        effects
    }

    /// Requests the core made that the bridge never answered.
    pub fn unanswered(&self) -> usize {
        self.outstanding.len() + self.unanswered
    }

    /// Answers that arrived with no request of the core's waiting for them.
    pub fn unmatched_answers(&self) -> usize {
        self.unmatched_answers
    }

    /// The gxserver METHOD of every request still in flight, oldest first, for a report.
    ///
    /// Method names only: a request's parameters are the user's conversation and never leave the
    /// translator. An entry here is a request the bridge never answered, which also makes every
    /// later answer eligible to be handed to it instead of to the record it belongs to.
    pub fn outstanding_methods(&self) -> Vec<String> {
        self.outstanding
            .iter()
            .map(|pending| match &pending.method {
                Some(method) => method.as_str().to_string(),
                None => "composerBoot".to_string(),
            })
            .collect()
    }

    /// How many storage answers the core is still waiting for.
    pub fn queued_storage_answers(&self) -> usize {
        self.storage_answers.len()
    }

    /// The revision the translator last drained.
    pub fn last_revision(&self) -> u64 {
        self.last_revision
    }

    /// Records the effects the translator answers itself, and performs the storage ones.
    fn record(&mut self, effects: &[Effect]) {
        for effect in effects {
            match effect {
                Effect::SendRpc {
                    request_id, method, ..
                } => self.outstanding.push_back(Outstanding {
                    request_id: *request_id,
                    method: Some(method.clone()),
                }),
                Effect::ReadComposerBoot { request_id } => {
                    self.outstanding.push_back(Outstanding {
                        request_id: *request_id,
                        method: None,
                    });
                }
                Effect::ReadStorage { key }
                    if key.store == crate::composer::storage::COMPOSER_HISTORY_STORE =>
                {
                    self.history_reads.push_back(key.clone());
                }
                Effect::ReadStorage { key } => {
                    let value = self.storage.get(&slot(key)).cloned();
                    self.storage_answers.push_back(Event::StorageLoaded {
                        key: key.clone(),
                        value,
                    });
                }
                // One host round trip, so ONE queued answer: the TypeScript's own
                // `composer('asyncQuestionRead')` is a single `resolve` record, and pairing is by
                // order.
                Effect::ReadStorageBatch { keys } => {
                    let records = keys
                        .iter()
                        .map(|key| crate::event::StorageRecord {
                            key: key.clone(),
                            value: self.storage.get(&slot(key)).cloned(),
                        })
                        .collect();
                    self.storage_answers
                        .push_back(Event::StorageBatchLoaded { records });
                }
                Effect::WriteStorageBatch { writes } => {
                    for write in writes {
                        match &write.value {
                            Some(value) => {
                                self.storage.insert(slot(&write.key), value.clone());
                            }
                            None => {
                                self.storage.remove(&slot(&write.key));
                            }
                        }
                    }
                    self.storage_answers.push_back(Event::StorageBatchWritten {
                        keys: writes.iter().map(|write| write.key.clone()).collect(),
                        error: None,
                    });
                }
                Effect::WriteStorage { key, value, .. } => {
                    match value {
                        Some(value) => {
                            self.storage.insert(slot(key), value.clone());
                        }
                        None => {
                            self.storage.remove(&slot(key));
                        }
                    }
                    self.storage_answers.push_back(Event::StorageWritten {
                        key: key.clone(),
                        error: None,
                    });
                }
                // The store's own round trips, which the bridge never carried.
                Effect::ReadRetainedSnapshot => {
                    self.direct_answers
                        .push_back(Event::RetainedSnapshotLoaded {
                            value: self.retained_snapshot.clone(),
                        });
                }
                Effect::WriteRetainedSnapshot { value } => {
                    self.retained_snapshot.clone_from(value);
                }
                Effect::FlushStorage { store } => {
                    self.storage_answers.push_back(Event::StorageWritten {
                        key: StorageKey {
                            store: store.clone(),
                            suffix: String::new(),
                        },
                        error: None,
                    });
                }
                _ => {}
            }
        }
    }

    /// Maps one bridge call to the events the core takes.
    ///
    /// The TypeScript entry points are one function each; the core has one enum, so a
    /// `brokerMessage` fans out by its own `kind`.
    fn events_for(&mut self, call: BridgeCall) -> Vec<Event> {
        match call {
            BridgeCall::Start(config) => serde_json::from_value(*config)
                .ok()
                .map(|config| vec![Event::Start(Box::new(config))])
                .unwrap_or_default(),
            BridgeCall::Action(command) => serde_json::from_value(*command)
                .ok()
                .map(|action| vec![Event::Action(Box::new(action))])
                .unwrap_or_default(),
            BridgeCall::Tick => vec![Event::Tick],
            BridgeCall::Frame(frame) => chat_frame(&frame),
            BridgeCall::BrokerMessage(message) => self.broker(&message),
            BridgeCall::Resolve { value, error, .. } => self.settled(value, error),
            BridgeCall::Query { .. } | BridgeCall::Take { .. } => Vec::new(),
        }
    }

    /// One `brokerMessage`, which in the real app carries more than the five state kinds.
    ///
    /// CDXC:SessionChat 2026-09-22 WHY:
    /// A gxserver answer reaches the shipped brain as `brokerMessage {kind: 'response', requestId,
    /// result}` (`native-host.ts:1674`), NOT as `resolve`: `resolve` is how the native side answers
    /// the `composer(...)` operations. Only the synthetic generators call `resolve` for everything,
    /// so a translator that modelled `resolve` alone dropped every real gxserver answer on the
    /// floor, left every read in flight, and made a real recording incomparable from its first
    /// read onwards.
    fn broker(&mut self, message: &Value) -> Vec<Event> {
        match message.get("kind").and_then(Value::as_str) {
            // A payload over 96 KiB arrives in pieces; the assembled value is an ordinary broker
            // message of one of the kinds below.
            Some("chunk") => match self.accept_chunk(message) {
                Some(assembled) => self.broker(&assembled),
                None => Vec::new(),
            },
            Some("response") => {
                let result = message
                    .get("result")
                    .or_else(|| message.get("snapshot"))
                    .cloned()
                    .unwrap_or(Value::Null);
                // `call.reject(new Error(message.error))`: the broker spells a failure as a plain
                // string where a `resolve` spells it as `{code, message}`.
                let error = match message.get("error") {
                    Some(Value::String(text)) => {
                        serde_json::json!({ "message": text })
                    }
                    Some(other) => other.clone(),
                    None => Value::Null,
                };
                self.settled(result, error)
            }
            _ => broker_events(message),
        }
    }

    /// `ChatTransfers.accept`: one chunk in, the assembled message out once the last one lands.
    ///
    /// The bounds are the TypeScript's, and a violation clears the table the way its `fail` does;
    /// the retry it also asks for is the live brain's, not the core's.
    fn accept_chunk(&mut self, message: &Value) -> Option<Value> {
        let transfer_id = message.get("transferId").and_then(Value::as_str)?;
        let index = message.get("index").and_then(Value::as_u64)? as usize;
        let total = message.get("total").and_then(Value::as_u64)? as usize;
        let data = message.get("data").and_then(Value::as_str)?;
        // `data.length > 96 * 1024` counts UTF-16 code units, which is what a JS string length
        // is. Measured in bytes, a piece holding any non-ASCII text overran the bound, the whole
        // transfer was dropped, and every snapshot over 96 KiB (a long chat's first frame after
        // a resubscribe) never reached the core.
        if !(1..=683).contains(&total) || data.encode_utf16().count() > 96 * 1024 {
            self.transfers.clear();
            return None;
        }
        if index == 0 && !self.transfers.contains_key(transfer_id) && self.transfers.is_empty() {
            self.transfers
                .insert(transfer_id.to_string(), (total, Vec::new()));
        }
        let Some((known_total, parts)) = self.transfers.get_mut(transfer_id) else {
            self.transfers.clear();
            return None;
        };
        if *known_total != total || parts.len() != index {
            self.transfers.clear();
            return None;
        }
        let assembled_units: usize = parts
            .iter()
            .map(|part| part.encode_utf16().count())
            .sum::<usize>()
            + data.encode_utf16().count();
        if assembled_units > 64 * 1024 * 1024 {
            self.transfers.clear();
            return None;
        }
        parts.push(data.to_string());
        if parts.len() != total {
            self.absorbed_chunk = true;
            return None;
        }
        let assembled = parts.concat();
        self.transfers.remove(transfer_id);
        serde_json::from_str(&assembled).ok()
    }

    /// One answer, from either channel: the recall ring first, then whatever it was paired with.
    ///
    /// The recall ring is answered BESIDE the pairing, never instead of it. `composer('history')`
    /// is a bridge round trip on the other side and an out-of-band read here, so consuming a FIFO
    /// slot for it (or freeing one) would move every storage answer after it by one record and
    /// drift the pairing for the rest of the run.
    fn settled(&mut self, result: Value, error: Value) -> Vec<Event> {
        let ring = self.recall_ring(&result);
        let claimed = ring.is_some();
        let mut events: Vec<Event> = ring.into_iter().collect();
        events.extend(self.answer(result, error, claimed));
        events
    }

    /// The `composer('history')` answer, when this `resolve` is one and the core asked for it.
    ///
    /// The ring is a SCAN of the sent-prompt store, so the translator's in-memory storage cannot
    /// reproduce it and the payload in front of us is the only answer both brains can agree on. It
    /// is also the only bridge operation that answers a bare array while a recall is suspended,
    /// which is a window exactly one `resolve` wide.
    fn recall_ring(&mut self, result: &Value) -> Option<Event> {
        if !result.is_array() {
            return None;
        }
        let key = self.history_reads.pop_front()?;
        Some(Event::StorageLoaded {
            key,
            value: serde_json::to_string(result).ok(),
        })
    }

    /// Turns one `resolve` into the event the core is waiting for.
    fn answer(&mut self, result: Value, error: Value, claimed: bool) -> Option<Event> {
        let failed = (!error.is_null()).then_some(error);
        let boot = result.get("sessionKey").is_some() && result.get("clientId").is_some();
        let named = identified(&result);
        let at =
            self.outstanding
                .iter()
                .position(|pending| match (&pending.method, boot, &named) {
                    (None, true, _) => true,
                    (None, false, _) => false,
                    (Some(_), true, _) => false,
                    (Some(method), false, Some(named)) => method == named,
                    (Some(method), false, None) => !self_naming(method),
                });
        let Some(at) = at else {
            // Not an answer to anything the core asked for: it is the other brain's own storage
            // round trip, and the core has a storage answer of its own waiting for this turn.
            if let Some(event) = self.storage_answers.pop_front() {
                return Some(event);
            }
            // The recall ring has already taken this record, so it is answered, not orphaned.
            if !claimed {
                self.unmatched_answers += 1;
            }
            return None;
        };
        let pending = self.outstanding.remove(at)?;
        if pending.method.is_none() {
            if failed.is_some() {
                return None;
            }
            return serde_json::from_value::<ComposerBootRead>(result)
                .ok()
                .map(|read| Event::ComposerBootRead(Box::new(read)));
        }
        let outcome = match failed {
            Some(error) => RpcOutcome::Err {
                code: error
                    .get("code")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                message: error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Request failed.")
                    .to_string(),
                endpoint: None,
            },
            None => RpcOutcome::Ok { result },
        };
        Some(Event::RpcSettled {
            request_id: pending.request_id,
            outcome: Box::new(outcome),
        })
    }
}

fn slot(key: &StorageKey) -> (String, String) {
    (key.store.clone(), key.suffix.clone())
}

/// The gxserver method a `resolve` payload's SHAPE identifies, when it identifies one.
///
/// The bridge carries no method beside its `resolve`, so the reads whose payload names itself are
/// recognised and the rest fall back to "the oldest request that is not one of those". Without
/// this, a `composer(...)` write answering `true` would be handed to whichever gxserver call
/// happened to be in flight.
fn identified(result: &Value) -> Option<ChatRpcMethod> {
    let object = result.as_object()?;
    if object.contains_key("messages") {
        return Some(ChatRpcMethod::ReadSessionChat);
    }
    if object.contains_key("skills") {
        return Some(ChatRpcMethod::ReadSessionChatSkills);
    }
    if object.contains_key("files") {
        return Some(ChatRpcMethod::ReadSessionChatFiles);
    }
    if object.contains_key("branches") {
        return Some(ChatRpcMethod::SessionForkBranches);
    }
    if object.contains_key("accounts") {
        return Some(ChatRpcMethod::AgentAccounts);
    }
    None
}

/// Whether a request's answer would have been recognised by [`identified`].
fn self_naming(method: &ChatRpcMethod) -> bool {
    matches!(
        method,
        ChatRpcMethod::ReadSessionChat
            | ChatRpcMethod::ReadSessionChatSkills
            | ChatRpcMethod::ReadSessionChatFiles
            | ChatRpcMethod::SessionForkBranches
            | ChatRpcMethod::AgentAccounts
    )
}

/// The five `brokerMessage` kinds that carry state, fanned out into the events they carry.
///
/// The other two the TypeScript accepts are QuickJS transport and have no core meaning: `chunk`
/// reassembles a transfer over 96 KiB, and `response` completes a request in the broker's own id
/// table. The broker is deleted and the Rust host answers through `resolve`, so both fall through.
fn broker_events(message: &Value) -> Vec<Event> {
    match message.get("kind").and_then(Value::as_str) {
        Some("event") => chat_frame(
            message
                .get("event")
                .or_else(|| message.get("payload"))
                .unwrap_or(&Value::Null),
        ),
        Some("chatSettings") => message
            .get("settings")
            .or_else(|| message.get("payload"))
            .and_then(|value| serde_json::from_value::<ChatSettings>(value.clone()).ok())
            .map(|settings| vec![Event::SettingsChanged(Box::new(settings))])
            .unwrap_or_default(),
        Some("contextPreferences") => vec![Event::ContextPreferencesChanged {
            provider: message
                .get("provider")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            preferences: message.get("preferences").cloned().unwrap_or(Value::Null),
        }],
        Some("catalog") => vec![Event::ModelCatalogChanged {
            catalog: message.get("catalog").cloned().unwrap_or(Value::Null),
        }],
        Some("reset") => vec![Event::Connection(ConnectionUpdate::Resubscribed)],
        _ => Vec::new(),
    }
}

/// One gxserver chat frame, admitted on the same four types the socket allows.
fn chat_frame(value: &Value) -> Vec<Event> {
    let frame = match value.get("type").and_then(Value::as_str) {
        Some("sessionChatSnapshot") => serde_json::from_value::<ChatSnapshotFrame>(value.clone())
            .ok()
            .map(|frame| ChatFrame::Snapshot(Box::new(frame))),
        Some("sessionChatReplaced") => serde_json::from_value::<ChatSnapshotFrame>(value.clone())
            .ok()
            .map(|frame| ChatFrame::Replaced(Box::new(frame))),
        Some("sessionChatAppended") => serde_json::from_value::<ChatAppendedFrame>(value.clone())
            .ok()
            .map(|frame| ChatFrame::Appended(Box::new(frame))),
        Some("sessionChatState") => serde_json::from_value::<ChatStateFrame>(value.clone())
            .ok()
            .map(|frame| ChatFrame::State(Box::new(frame))),
        _ => None,
    };
    frame
        .map(|frame| vec![Event::Frame(Box::new(frame))])
        .unwrap_or_default()
}
