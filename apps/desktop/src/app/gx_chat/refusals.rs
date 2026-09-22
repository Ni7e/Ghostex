//! How the host names what went wrong in its counters: a refused request, and a call it could not
//! route. Every name printed is a code constant chosen here, never a value that came off the wire.

use ghostex_gx_chat_core::ChatRpcMethod;
use serde_json::Value;

use super::diagnostics::HostCounters;

/// How many distinct refusal names the summary keeps, which is what it prints anyway.
const MAX_REFUSAL_NAMES: usize = 24;

/// Counts one refused request as `<method>/<code>`.
///
/// CDXC:Diagnostics 2026-09-23 WHY:
/// Supersedes the 2026-09-22 count by code alone, which could not say WHICH request failed: the
/// first live run read `{unknown: 18}` and nothing more. Both halves are code constants. The method
/// is the `/api/<method>` the view names in the answer's `endpoint`, mapped onto the core's own
/// method list (anything else is `other`). The code is gxserver's when it sent one, which is always
/// a short camelCase identifier (`invalidParams`); a refusal WITHOUT one never came from gxserver at
/// all, because gxserver spells `error` on every refusal, so it is the desktop's own transport
/// failing, and it is classed from the fixed sentences `native_chat/rpc.rs` and the typed-operation
/// helpers write (`unreachable`, `transport`, `invalidResponse`, `httpStatus`, `authToken`). The
/// MESSAGE is never counted, and the map stops admitting new names at 24.
pub(super) fn note_rpc_refusal(counters: &mut HostCounters, arguments: &[Value]) {
    let Some(error) = arguments.get(2).filter(|value| !value.is_null()) else {
        return;
    };
    let method = error
        .get("endpoint")
        .and_then(Value::as_str)
        .and_then(|endpoint| endpoint.strip_prefix("/api/"))
        .map_or("unknownMethod", rpc_method_name);
    let class = match error.get("code").and_then(Value::as_str) {
        Some(code) if named(code) => code,
        Some(_) => "other",
        None => transport_class(error.get("message").and_then(Value::as_str)),
    };
    let name = format!("{method}/{class}");
    let admitted = counters.rpc_refusals.len() < MAX_REFUSAL_NAMES
        || counters.rpc_refusals.contains_key(&name);
    let name = if admitted { name } else { "other".to_string() };
    *counters.rpc_refusals.entry(name).or_insert(0) += 1;
}

/// Counts one renderer call the host could not turn into an event, by its method.
///
/// `method` is already a constant: it is the `&'static str` the view passed to `call`. A
/// `brokerMessage` is split by its `kind`, because that is where the app runtime's messages differ.
pub(super) fn note_unrouted(
    counters: &mut HostCounters,
    method: &'static str,
    arguments: &[Value],
) {
    let name = if method == "brokerMessage" {
        broker_kind_name(arguments.first())
    } else {
        method
    };
    *counters.actions_unrouted.entry(name).or_insert(0) += 1;
}

/// The name a `brokerMessage` is counted under.
pub(super) fn broker_kind_name(message: Option<&Value>) -> &'static str {
    match message
        .and_then(|message| message.get("kind"))
        .and_then(Value::as_str)
    {
        Some("event") => "brokerMessage.event",
        Some("chunk") => "brokerMessage.chunk",
        Some("response") => "brokerMessage.response",
        Some("reset") => "brokerMessage.reset",
        Some("chatSettings") => "brokerMessage.chatSettings",
        Some("contextPreferences") => "brokerMessage.contextPreferences",
        Some("catalog") => "brokerMessage.catalog",
        _ => "brokerMessage.other",
    }
}

/// A gxserver code is a short identifier; anything else is not printed.
fn named(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= 40
        && code
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-.".contains(&byte))
}

/// Which of the desktop transport's own failures a code-less refusal is.
fn transport_class(message: Option<&str>) -> &'static str {
    let Some(message) = message.map(str::to_ascii_lowercase) else {
        return "unknown";
    };
    if message.contains("not reachable") {
        "unreachable"
    } else if message.contains("auth token") {
        "authToken"
    } else if message.contains("invalid json")
        || message.contains("invalid http")
        || message.contains("invalid chunked")
    {
        "invalidResponse"
    } else if message.contains("failed with http") {
        "httpStatus"
    } else if message.starts_with("could not ") {
        "transport"
    } else {
        "unknown"
    }
}

/// The core's own spelling of a method, as a constant.
///
/// Exhaustive on purpose: a method the core adds fails this build until it is named here, rather
/// than being counted as `other` for ever.
fn rpc_method_name(wire: &str) -> &'static str {
    match ChatRpcMethod::from_wire(wire) {
        ChatRpcMethod::ReadSessionChat => "readSessionChat",
        ChatRpcMethod::ReadSessionChatSkills => "readSessionChatSkills",
        ChatRpcMethod::ReadSessionChatFiles => "readSessionChatFiles",
        ChatRpcMethod::ReadSessionChatImage => "readSessionChatImage",
        ChatRpcMethod::SendSessionChatMessage => "sendSessionChatMessage",
        ChatRpcMethod::InterruptSessionChat => "interruptSessionChat",
        ChatRpcMethod::AnswerSessionChatPrompt => "answerSessionChatPrompt",
        ChatRpcMethod::RewindSessionChat => "rewindSessionChat",
        ChatRpcMethod::SelectSessionChatModel => "selectSessionChatModel",
        ChatRpcMethod::QueueSessionChatPrompt => "queueSessionChatPrompt",
        ChatRpcMethod::UpdateSessionChatQueuedPrompt => "updateSessionChatQueuedPrompt",
        ChatRpcMethod::RemoveSessionChatQueuedPrompt => "removeSessionChatQueuedPrompt",
        ChatRpcMethod::ReorderSessionChatQueue => "reorderSessionChatQueue",
        ChatRpcMethod::SendSessionChatQueuedPrompt => "sendSessionChatQueuedPrompt",
        ChatRpcMethod::SetSessionChatDraft => "setSessionChatDraft",
        ChatRpcMethod::AcknowledgeSessionChatDraftHandoff => "acknowledgeSessionChatDraftHandoff",
        ChatRpcMethod::ReadSessionTerminalTail => "readSessionTerminalTail",
        ChatRpcMethod::SessionForkBranches => "sessionForkBranches",
        ChatRpcMethod::SwitchDraftAgent => "switchDraftAgent",
        ChatRpcMethod::AgentAccounts => "agentAccounts",
        ChatRpcMethod::ReadSessionAgentNote => "readSessionAgentNote",
        ChatRpcMethod::SaveSessionAgentNote => "saveSessionAgentNote",
        ChatRpcMethod::ListStashedPrompts => "listStashedPrompts",
        ChatRpcMethod::SaveStashedPrompt => "saveStashedPrompt",
        ChatRpcMethod::ImportNativeAttachments => "importNativeAttachments",
        ChatRpcMethod::ReadNativeComposer => "readNativeComposer",
        ChatRpcMethod::RunProjectDocsAction => "runProjectDocsAction",
        ChatRpcMethod::Other(_) => "other",
    }
}
