//! The one state every family reads and exactly one family writes.
//!
//! Six sub-states, six owners. Family a owns `identity`, `session`, `messages`, `pending` and
//! `core`; the other five each own the field named after their surface. A family writes its own
//! field and reads the rest, which is what lets six agents port in parallel without touching the
//! same file. `docs/2026-09-21/rust-chat/FAMILIES.md` is the full ownership table.

use crate::state::{
    ComposerState, ExtrasState, MenusState, MessagesState, PendingState, QuestionsState,
    SessionIdentity, SessionState, TranscriptViewState,
};

/// One chat's whole state.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ChatState {
    /// Who this chat is. Family a.
    pub identity: SessionIdentity,
    /// The session facts the wire carries. Family a.
    pub session: SessionState,
    /// The authoritative transcript and its pagination. Family a.
    pub messages: MessagesState,
    /// The optimistic echoes and terminal lines. Family a.
    pub pending: PendingState,
    /// Errors and settings that belong to no single surface. Family a.
    pub core: CoreState,
    /// The transcript projection's own state. Family b.
    pub transcript_view: TranscriptViewState,
    /// Questions, approvals and notices. Family c.
    pub questions: QuestionsState,
    /// The composer. Family d.
    pub composer: ComposerState,
    /// Menus, pickers, options, accounts and context. Family e.
    pub menus: MenusState,
    /// The model picker, the model menu, model selection and the context surfaces. Family e2.
    pub pickers: crate::state::PickersState,
    /// The minimap, search, subagents, panels and the terminal tail. Family f.
    pub extras: ExtrasState,
}

/// The few things that belong to the seam rather than to a surface.
///
/// Family a owns this. The other families set `operation_error` through
/// [`CoreState::fail`] when an action of theirs is refused, because the refusal is drawn in one
/// place for all of them.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CoreState {
    /// The last action refusal, shown above the composer.
    pub operation_error: Option<String>,
    /// The refusal's own code, so the composer can draw `composerNotReady` instead of an error
    /// line.
    pub operation_error_code: Option<String>,
    /// Masks account text everywhere the chat shows it.
    pub hide_account_emails: bool,
    /// The session's display title, or `None` when it has none.
    pub title: Option<String>,
    /// The Chat Lab's display settings, present only under a preview backend.
    pub preview_settings: Option<serde_json::Value>,
    /// Every deadline the core is waiting on. Any family may arm one by key; the host only ever
    /// sees the earliest, as the frame's `nextWakeMs`.
    pub timers: crate::session::timers::TimerTable,
    /// The timer keys that came due during the dispatch running right now, cleared before the next
    /// one. A family reads its own keys out of this rather than being called back.
    pub fired_timers: Vec<String>,
    /// Set for this dispatch when a family's TypeScript calls `publish(controller.current())`
    /// unconditionally rather than through a state change.
    ///
    /// The core's own rule is "publish when the state changed", which is what the TypeScript's
    /// reactive path does. Its imperative path does not: `action` ends with a publish whatever
    /// happened, and several rpc continuations do the same. A family that ports one of those calls
    /// [`CoreState::request_publish`] so the revision moves on exactly the same turns.
    pub publish_requested: bool,
    /// The answers an action that is still in flight publishes on.
    ///
    /// `action` in `native-host.ts` is `async`: its closing `publish(controller.current())` runs
    /// after the last `await` in the arm that handled the command, so the snapshot ships on the
    /// record that ANSWERS the call rather than on the record that made it. The core's handlers
    /// return instead of awaiting, so the same turn is named here: the dispatcher records what the
    /// action asked for, and family a's settle publishes when that answer lands.
    pub publish_awaits: Vec<PublishAwait>,
    /// The controller exists, which is only true once the composer boot read has answered.
    ///
    /// Every publish in `native-host.ts` is written `if (controller) publish(controller.current())`
    /// or runs inside the controller itself, and `startController` is called from the boot read's
    /// `.then(...)`. Nothing the core does before that can ship a document, which is why `start`
    /// leaves the host's first drain empty.
    pub controller_started: bool,
    /// The id the next request carries, for every family.
    ///
    /// One counter for the whole core, because [`crate::Event::RpcSettled`] routes by id alone: two
    /// families drawing from their own counters would both claim request 3 and each would settle
    /// the other's answer.
    pub next_request_id: u64,
}

/// One answer an in-flight action is waiting for before the publish that ends it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PublishAwait {
    /// A gxserver call, by request id.
    Rpc(u64),
    /// A stored record being read or written.
    Storage(crate::event::StorageKey),
}

impl CoreState {
    /// Records that an action is waiting on these answers before it publishes.
    ///
    /// Nothing is recorded when the effects hold no answerable request: the TypeScript arm then
    /// never suspends, and its closing publish runs on the action's own turn.
    pub fn publish_after(&mut self, effects: &[crate::effect::Effect]) -> bool {
        use crate::effect::Effect;
        let mut awaited = false;
        for effect in effects {
            let await_on = match effect {
                Effect::SendRpc { request_id, .. } => PublishAwait::Rpc(*request_id),
                Effect::ReadStorage { key } | Effect::WriteStorage { key, .. } => {
                    PublishAwait::Storage(key.clone())
                }
                _ => continue,
            };
            awaited = true;
            if !self.publish_awaits.contains(&await_on) {
                self.publish_awaits.push(await_on);
            }
        }
        awaited
    }

    /// Publishes if this answer is the one an action was waiting on.
    pub fn settle_publish_await(&mut self, await_on: &PublishAwait) {
        if let Some(at) = self
            .publish_awaits
            .iter()
            .position(|pending| pending == await_on)
        {
            self.publish_awaits.remove(at);
            self.request_publish();
        }
    }

    /// Whether one of this dispatch's due timers is `key`.
    pub fn timer_fired(&self, key: &str) -> bool {
        self.fired_timers.iter().any(|fired| fired == key)
    }

    /// Ships a snapshot this turn even when nothing the document can see changed, for the places
    /// the TypeScript publishes unconditionally.
    pub fn request_publish(&mut self) {
        self.publish_requested = true;
    }

    /// The id for the next request any family asks for. Monotonic and never reused, so a late
    /// answer to a retired request is dropped rather than misrouted.
    pub fn allocate_request_id(&mut self) -> u64 {
        self.next_request_id += 1;
        self.next_request_id
    }

    /// Records a refusal, replacing whatever was shown before.
    pub fn fail(&mut self, message: impl Into<String>, code: Option<String>) {
        self.operation_error = Some(message.into());
        self.operation_error_code = code;
    }

    /// Clears the refusal, which every successful action does.
    pub fn clear_error(&mut self) {
        self.operation_error = None;
        self.operation_error_code = None;
    }
}
