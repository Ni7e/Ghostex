//! Family d's uniform settle hook: the boot read, the two catalog reads, and the send gate the
//! other families read.
//!
//! `computeSessionChatSkills` and `computeSessionChatFiles`
//! (`packages/shared/session-chat-controller/skills.ts` and `files.ts`) are `useEffect`
//! bookkeeping: the skills list is read once per agent and re-read when the agent changes, the
//! file list once per chat. The core has no render pass, so the same decision runs here, once per
//! event.

use serde_json::Value;

use crate::effect::Effect;
use crate::event::{ComposerBootRead, Event};
use crate::state::{ChatContext, ChatState};
use crate::wire::{ChatRpcMethod, RpcOutcome};

/// Settles family d's carried state for this event.
pub fn settle(state: &mut ChatState, event: &Event, context: &ChatContext) -> Vec<Effect> {
    let mut effects = Vec::new();
    match event {
        Event::ComposerBootRead(read) => adopt_boot_read(state, read),
        Event::RpcSettled {
            request_id,
            outcome,
        } => settle_catalog(state, *request_id, outcome.as_ref()),
        _ => {}
    }
    effects.extend(request_catalogs(state));
    // `rewindEnabled` is `sendBlockedReason(state) === null`, which is family d's rule read by
    // family b. `document::assemble` runs b before d, so the answer is cached here rather than
    // read out of a half-built document.
    state.composer.send_blocked_reason = crate::composer::document::send_blocked(state, context);
    effects
}

/// The half of `composer('read')` that is family d's: the client id's draft entry and the two
/// transcript modes it hands to family b.
fn adopt_boot_read(state: &mut ChatState, read: &ComposerBootRead) {
    state.composer.boot_read = true;
    state.composer.stored_draft = serde_json::from_value(read.entry.clone()).ok();
    state.composer.version = read
        .entry
        .get("version")
        .and_then(|version| serde_json::from_value(version.clone()).ok());
    if state.composer.text.is_empty() {
        // A parked or submitted entry opens the composer empty, which is what the host's
        // `composerInit` arm does with the same record.
        let parked = read.entry.get("parked") == Some(&Value::Bool(true));
        let submitted = read.entry.get("submitted") == Some(&Value::Bool(true));
        if !parked && !submitted {
            state.composer.text = read
                .entry
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
        }
    }
    // The stored value is family d's to read and family b's to own
    // (`docs/2026-09-21/rust-chat/FAMILIES.md`, "Two assignments the seam map left ambiguous").
    state.transcript_view.summary_mode = read.summary_mode;
    state.transcript_view.verbose_override = read.verbose_override.as_bool();
}

/// `computeSessionChatSkills` and `computeSessionChatFiles`: one read each, the first re-asked
/// when the agent the session runs under changes.
fn request_catalogs(state: &mut ChatState) -> Vec<Effect> {
    let mut effects = Vec::new();
    if !state.composer.boot_read {
        return effects;
    }
    let agent = state.session.session_agent_id.clone();
    let sources = &mut state.composer.sources;
    if sources.skills_agent != agent || !sources.skills_asked {
        sources.skills_asked = true;
        sources.skills_agent.clone_from(&agent);
        sources.skills = None;
        sources.skills_error = None;
        sources.skills_loading = true;
        let request_id = state.core.allocate_request_id();
        state.composer.sources.skills_request = Some(request_id);
        effects.push(Effect::SendRpc {
            request_id,
            method: ChatRpcMethod::ReadSessionChatSkills,
            params: Box::new(Value::Object(Default::default())),
        });
    }
    // `computeSessionChatFiles` reads nothing on mount: it hands back a `requestFiles` callback
    // the `@` list calls the first time it opens, and `filesLoading` is false until then.
    if state.composer.suggestions.file_active && !state.composer.sources.files_asked {
        state.composer.sources.files_asked = true;
        state.composer.sources.files_loading = true;
        let request_id = state.core.allocate_request_id();
        state.composer.sources.files_request = Some(request_id);
        effects.push(Effect::SendRpc {
            request_id,
            method: ChatRpcMethod::ReadSessionChatFiles,
            params: Box::new(Value::Object(Default::default())),
        });
    }
    effects
}

/// The two catalog answers, which are the only reads family d issues on its own.
fn settle_catalog(state: &mut ChatState, request_id: u64, outcome: &RpcOutcome) {
    let sources = &mut state.composer.sources;
    if sources.skills_request == Some(request_id) {
        sources.skills_request = None;
        sources.skills_loading = false;
        match outcome {
            RpcOutcome::Ok { result } => {
                sources.skills = Some(
                    result
                        .get("skills")
                        .and_then(|skills| serde_json::from_value(skills.clone()).ok())
                        .unwrap_or_default(),
                );
                sources.skills_error = None;
            }
            RpcOutcome::Err { message, .. } => {
                sources.skills = None;
                sources.skills_error = Some(message.clone());
            }
        }
        return;
    }
    if sources.files_request == Some(request_id) {
        sources.files_request = None;
        sources.files_loading = false;
        if let RpcOutcome::Ok { result } = outcome {
            sources.files = Some(
                result
                    .get("files")
                    .and_then(|files| serde_json::from_value(files.clone()).ok())
                    .unwrap_or_default(),
            );
        }
    }
}
