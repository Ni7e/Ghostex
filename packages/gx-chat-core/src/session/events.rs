//! What family a does with each event: the start, the frames, the reads, and the clock.
//!
//! Ported from the subscribe effect of `packages/shared/session-chat-controller/controller.ts`
//! together with the ordering half of `apps/desktop/sidebar/session-chat-runtime/store.ts`, which
//! the Rust core folds into one place because the broker and the per-view runtime are both gone.

use ghostex_gx_protocol::ReadSessionChatResult;
use serde_json::{Map, Value};

use crate::effect::Effect;
use crate::event::{ConnectionUpdate, Event, StartConfig};
use crate::session::apply::{apply_authoritative, apply_draft_agent_carriage};
use crate::session::constants::{INITIAL_LIMIT, MAX_LIMIT};
use crate::session::fold::{fold_append, fold_state, FoldedSnapshot, StateCarrier};
use crate::session::stream::{accept_authoritative_frame, accept_sequenced_frame, Verdict};
use crate::state::{ChatContext, ChatState};
use crate::wire::{ChatFrame, ChatRpcMethod, RpcOutcome};

/// Handles one event family a owns.
pub fn handle(state: &mut ChatState, event: &Event, context: &ChatContext) -> Vec<Effect> {
    match event {
        Event::Start(config) => start(state, config, context),
        Event::Frame(frame) => frame_arrived(state, frame, context),
        Event::Connection(update) => connection(state, *update, context),
        Event::RpcSettled {
            request_id,
            outcome,
        } => rpc_settled(state, *request_id, outcome, context),
        Event::SettingsChanged(settings) => {
            state.core.hide_account_emails = settings.hide_account_emails;
            state.core.title = settings.title.clone();
            Vec::new()
        }
        _ => Vec::new(),
    }
}

/// The host is opening this chat: adopt what it had cached, then subscribe and seed-read.
fn start(state: &mut ChatState, config: &StartConfig, context: &ChatContext) -> Vec<Effect> {
    state.identity.client_id = config.client_id.clone();
    state.identity.project_id = config.project_id.clone();
    state.identity.session_id = config.session_id.clone();
    state.messages.generation += 1;
    state.messages.limit = state.messages.limit.max(INITIAL_LIMIT);
    state.messages.last_frame_at_ms = context.now_ms;
    state.messages.seed_started_at_ms = context.now_ms;
    state.messages.seed_attempt = 0;
    state.core.preview_settings = config.preview.clone();

    // Retained data is folded before the first paint, so a session switch never shows an empty
    // transcript between mount and the subscription's first frame.
    if let Some(cached) = config
        .initial_snapshot
        .as_ref()
        .and_then(|value| serde_json::from_value::<FoldedSnapshot>(value.clone()).ok())
    {
        state.messages.position.epoch = Some(cached.result.epoch);
        state.messages.position.seq = cached.result.seq;
        state.messages.limit = state
            .messages
            .limit
            .max(cached.result.messages.len() as u32)
            .min(MAX_LIMIT);
        apply_draft_agent_carriage(state, &cached.result);
        apply_authoritative(state, &cached.result, true);
        state.messages.snapshot = Some(cached);
    }

    vec![
        Effect::Subscribe {
            limit: state.messages.limit,
            catalog: true,
        },
        read_effect(state, None),
    ]
}

/// One accepted frame.
fn frame_arrived(state: &mut ChatState, frame: &ChatFrame, context: &ChatContext) -> Vec<Effect> {
    // Liveness is "a frame reached us", not "a frame changed something": a dropped or duplicate
    // frame still proves the stream is alive.
    state.messages.last_frame_at_ms = context.now_ms;
    let position = frame.position();
    if state.messages.resync.in_flight {
        // Remember how far the live stream ran while the read was in flight; the read answers from
        // a position captured before it.
        let ahead = state
            .messages
            .resync
            .seen_in_flight
            .as_ref()
            .is_none_or(|seen| position.is_ahead_of(seen));
        if ahead {
            state.messages.resync.seen_in_flight = Some(position.clone());
        }
    }

    match frame {
        ChatFrame::Snapshot(snapshot) | ChatFrame::Replaced(snapshot) => {
            accept_authoritative_frame(
                &mut state.messages.position,
                &snapshot.base.server_id,
                snapshot.base.epoch,
                snapshot.base.seq,
            );
            let folded = fold_state(
                state.messages.snapshot.as_ref(),
                StateCarrier::Snapshot(snapshot),
            );
            apply_authoritative(state, &folded.result, true);
            state.messages.snapshot = Some(folded);
            Vec::new()
        }
        ChatFrame::Appended(appended) => {
            match accept_sequenced_frame(
                &mut state.messages.position,
                appended.base.epoch,
                appended.base.seq,
            ) {
                Verdict::Drop => Vec::new(),
                Verdict::Resync => vec![read_effect(state, None)],
                Verdict::Apply => {
                    let Some(previous) = state.messages.snapshot.clone() else {
                        return vec![read_effect(state, None)];
                    };
                    // Retract first: the rows that replace an abandoned prompt can ride the very
                    // same frame.
                    if state.messages.remove_ids(&appended.superseded_message_ids) {
                        state.messages.snapshot = Some(previous.clone());
                    }
                    let folded = fold_append(&previous, appended);
                    if !appended.messages.is_empty() {
                        state.messages.apply_append(&appended.messages);
                        // Keep the read window at least as large as what is on screen, so a later
                        // resync or pagination read cannot answer with less than the live list
                        // already holds.
                        let on_screen = state
                            .messages
                            .list
                            .len()
                            .saturating_sub(state.messages.history_prefix_count)
                            as u32;
                        state.messages.limit = state.messages.limit.max(on_screen).min(MAX_LIMIT);
                        state.session.server_status = ghostex_gx_protocol::ChatStatus::Ready;
                    }
                    if let Some(lifecycle) = appended.lifecycle.clone() {
                        state.session.lifecycle = Some(lifecycle);
                    }
                    state.messages.snapshot = Some(folded);
                    Vec::new()
                }
            }
        }
        ChatFrame::State(frame) => {
            match accept_sequenced_frame(
                &mut state.messages.position,
                frame.base.epoch,
                frame.base.seq,
            ) {
                Verdict::Drop => Vec::new(),
                Verdict::Resync => vec![read_effect(state, None)],
                Verdict::Apply => {
                    let folded =
                        fold_state(state.messages.snapshot.as_ref(), StateCarrier::State(frame));
                    apply_authoritative(state, &folded.result, true);
                    state.messages.snapshot = Some(folded);
                    Vec::new()
                }
            }
        }
    }
}

/// The socket's own state changed.
fn connection(
    state: &mut ChatState,
    update: ConnectionUpdate,
    context: &ChatContext,
) -> Vec<Effect> {
    state.messages.last_frame_at_ms = context.now_ms;
    match update {
        ConnectionUpdate::Subscribed => Vec::new(),
        ConnectionUpdate::Lost => Vec::new(),
        ConnectionUpdate::Resubscribed => {
            // A fresh socket restarts the stream position: nothing applies until its snapshot
            // re-seeds the epoch, and a snapshot replaces the content wholesale.
            state.messages.position.frame_arrived = false;
            state.messages.generation += 1;
            Vec::new()
        }
    }
}

/// A read the core asked for has settled.
fn rpc_settled(
    state: &mut ChatState,
    _request_id: u64,
    outcome: &RpcOutcome,
    context: &ChatContext,
) -> Vec<Effect> {
    match outcome {
        RpcOutcome::Ok { result } => {
            let Ok(read) = serde_json::from_value::<ReadSessionChatResult>(result.clone()) else {
                return Vec::new();
            };
            state.messages.last_frame_at_ms = context.now_ms;
            state.messages.resync.in_flight = false;
            state.messages.resync.failures = 0;
            // A read never rolls a newer live tail back: the frames seen while it was in flight
            // are already accounted for, so the cursor keeps the higher position.
            let outrun = state
                .messages
                .resync
                .seen_in_flight
                .take()
                .filter(|seen| seen.is_ahead_of(&state.messages.position.stream_position()));
            if state.messages.position.epoch.is_none() {
                state.messages.position.epoch = Some(read.epoch);
                state.messages.position.seq = read.seq;
            }
            if let Some(seen) = outrun {
                state.messages.position.epoch = Some(seen.epoch);
                state.messages.position.seq = seen.seq;
            }
            let folded = fold_state(state.messages.snapshot.as_ref(), StateCarrier::Read(&read));
            apply_draft_agent_carriage(state, &read);
            apply_authoritative(state, &folded.result, true);
            state.messages.snapshot = Some(folded);
            Vec::new()
        }
        RpcOutcome::Err { .. } => {
            state.messages.resync.in_flight = false;
            // Only a seed read that has never seen a frame turns into the view's error state; a
            // failed page leaves the live tail valid.
            if !state.messages.position.frame_arrived
                && context.now_ms - state.messages.seed_started_at_ms
                    >= crate::session::constants::NOT_FOUND_RETRY_WINDOW_MS
            {
                state.session.error = Some("Conversation could not be loaded.".to_string());
                state.session.server_status = ghostex_gx_protocol::ChatStatus::Error;
            }
            Vec::new()
        }
    }
}

/// The `readSessionChat` call, at the window the view currently needs.
fn read_effect(state: &mut ChatState, before_offset: Option<u64>) -> Effect {
    state.messages.resync.in_flight = true;
    let mut params = Map::new();
    params.insert(
        "projectId".to_string(),
        Value::String(state.identity.project_id.clone()),
    );
    params.insert(
        "sessionId".to_string(),
        Value::String(state.identity.session_id.clone()),
    );
    params.insert("limit".to_string(), Value::from(state.messages.limit));
    if let Some(offset) = before_offset {
        params.insert("beforeOffset".to_string(), Value::from(offset));
    }
    Effect::SendRpc {
        request_id: 0,
        method: ChatRpcMethod::ReadSessionChat,
        params: Box::new(Value::Object(params)),
    }
}
