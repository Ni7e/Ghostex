use super::{
    arguments::{Arguments, Delivery},
    identity::{self, text},
};
use crate::ghostex_cli::{
    rpc::{call_gxserver_rpc, CliError, CliResult},
    selector, sessions,
};
use serde_json::{json, Value};

pub(super) fn send(args: &Arguments) -> CliResult<Value> {
    let body = match &args.body_file {
        Some(path) => std::fs::read_to_string(path).map_err(|error| {
            CliError::Other(format!("Could not read message file {path}: {error}"))
        })?,
        None => args.positional[1].clone(),
    };
    if body.trim().is_empty() {
        return Err(CliError::Other("Message body must not be empty.".into()));
    }
    let sender = identity::caller()?;
    let message = identity::message(&sender, &body);
    if message.len() > crate::zmx::GXSERVER_ZMX_SEND_TEXT_LIMIT_BYTES {
        return Err(CliError::Other(format!(
            "Message including sender header exceeds the {}-byte send limit.",
            crate::zmx::GXSERVER_ZMX_SEND_TEXT_LIMIT_BYTES
        )));
    }
    let reference = &args.positional[0];
    let flags = identity::inventory_flags(&args.flags, reference)?;
    let rows = sessions::fetch_session_list(&flags, false)?;
    let recipient = selector::resolve_one_listed_session(reference, &rows, &flags)?;
    if !identity::is_agent(&recipient) {
        return Err(CliError::Other(
            "The recipient is not an agent session. Run ghostex agents list --all.".into(),
        ));
    }
    if args.delivery != Delivery::Queue && text(&recipient, "lifecycleState") != "running" {
        return Err(CliError::Other(format!("Session {} is not running. Use ghostex wake {} first, or --queue to hold the message until it is awake and ready.", text(&recipient, "globalRef"), text(&recipient, "globalRef"))));
    }
    let mut payload = json!({"globalRef": recipient["globalRef"], "projectId": recipient["projectId"], "sessionId": recipient["sessionId"]});
    let interrupted = args.delivery == Delivery::Interrupt;
    if interrupted {
        call_gxserver_rpc("/api/interruptSessionChat", &payload, &flags)?;
    }
    payload["text"] = json!(message);
    let endpoint = if args.delivery == Delivery::Queue {
        "/api/queueSessionChatPrompt"
    } else {
        "/api/sendSessionChatMessage"
    };
    let result = call_gxserver_rpc(endpoint, &payload, &flags).map_err(|error| {
        CliError::Other(format!(
            "{}{} Inspect chat and queue before retrying.",
            if interrupted {
                "Interruption was requested, but message delivery failed or is uncertain: "
            } else {
                "Message delivery failed or is uncertain: "
            },
            error
        ))
    })?;
    Ok(json!({
        "ok": true,
        "status": if args.delivery == Delivery::Queue { "queued" } else { "accepted" },
        "mode": match args.delivery { Delivery::Normal => "normal", Delivery::Interrupt => "interrupt", Delivery::Queue => "queue" },
        "interruptRequested": interrupted,
        "sender": identity::summary(&sender),
        "recipient": identity::summary(&recipient),
        "receipt": receipt(&result),
    }))
}

pub(super) fn receipt(result: &Value) -> Value {
    json!({
        "requestId": result["requestId"],
        "queuedPromptId": result.get("queuedPromptId").or_else(|| result.pointer("/prompt/id")),
    })
}
