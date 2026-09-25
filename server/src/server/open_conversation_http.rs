//! `/api/openConversation` over HTTP: the decision is `crate::open_conversation`; its steps are
//! this daemon's own endpoints, called over the loopback API with the daemon's token, so a
//! restore and a resume publish, log and refuse exactly as they do for a client.

use super::*;

use crate::open_conversation::{open_conversation, OpenConversationRequest};

/// A fork starts a provider and can take a while.
const STEP_TIMEOUT_MS: u64 = 60_000;

pub(crate) async fn handle_open_conversation_http(
    state: &AppState,
    endpoint_path: String,
    request_id: String,
    body: Value,
) -> RoutedResponse {
    let worker_state = state.clone();
    let worker_endpoint = endpoint_path.clone();
    let worker_request_id = request_id.clone();
    match tokio::task::spawn_blocking(move || {
        handle_domain_http(
            &worker_state,
            worker_endpoint,
            worker_request_id,
            &body,
            |_, _, params, _| {
                let request = OpenConversationRequest::read(params)?;
                let token = worker_state.auth_token.clone();
                open_conversation(&request, &|path, params| loopback(&token, path, params))
            },
        )
    })
    .await
    {
        Ok(response) => response,
        Err(error) => domain_error_response(
            endpoint_path,
            request_id,
            DomainStateError::corrupt_state(format!("openConversation failed: {error}")),
        ),
    }
}

fn loopback(
    token: &str,
    path: &str,
    params: Value,
) -> std::result::Result<Value, DomainStateError> {
    let envelope =
        crate::http_client::post_local_api(path, Some(&params), Some(token), STEP_TIMEOUT_MS)
            .map_err(|error| DomainStateError::corrupt_state(format!("{path} failed: {error}")))?
            .ok_or_else(|| DomainStateError::corrupt_state(format!("{path} did not answer.")))?;
    if envelope.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(envelope.get("result").cloned().unwrap_or(Value::Null));
    }
    let message = envelope
        .get("message")
        .or_else(|| envelope.get("error"))
        .and_then(Value::as_str)
        .unwrap_or("gxserver rejected the request.")
        .to_string();
    Err(match envelope.get("error").and_then(Value::as_str) {
        Some("notFound") => DomainStateError::not_found(message),
        Some("badRequest") => DomainStateError::bad_request(message),
        _ => DomainStateError::corrupt_state(message),
    })
}
