use std::{
    io::{Read, Write},
    net::TcpStream,
    time::Duration,
};

use anyhow::{Context, Result};
use serde_json::Value;

use crate::{
    config::read_selected_local_api_port,
    constants::{GXSERVER_LOCAL_API_HOST, GXSERVER_PROTOCOL_HEADER, GXSERVER_PROTOCOL_VERSION},
    protocol::ServerHealthResponse,
};

pub fn fetch_server_health(
    token: Option<&str>,
    timeout_ms: u64,
) -> Result<Option<ServerHealthResponse>> {
    let Some(value) = fetch_local_json("/api/health/server", "GET", token, timeout_ms)? else {
        return Ok(None);
    };
    let health: ServerHealthResponse =
        serde_json::from_value(value).with_context(|| "parse gxserver health")?;
    Ok(Some(health))
}

pub fn request_server_stop(token: Option<&str>, timeout_ms: u64) -> Result<bool> {
    let response = fetch_local_json("/api/control/stop", "POST", token, timeout_ms)?;
    Ok(response
        .and_then(|value| value.get("ok").and_then(Value::as_bool))
        .unwrap_or(false))
}

pub fn request_server_stop_all(token: Option<&str>, timeout_ms: u64) -> Result<Option<Value>> {
    let response = fetch_local_json("/api/control/stopAll", "POST", token, timeout_ms)?;
    Ok(response.filter(|value| value.get("ok").and_then(Value::as_bool) == Some(true)))
}

fn fetch_local_json(
    path: &str,
    method: &str,
    token: Option<&str>,
    timeout_ms: u64,
) -> Result<Option<Value>> {
    let address = format!(
        "{GXSERVER_LOCAL_API_HOST}:{}",
        read_selected_local_api_port()?
    );
    let timeout = Duration::from_millis(timeout_ms);
    let Ok(mut stream) = TcpStream::connect(&address) else {
        return Ok(None);
    };
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;

    let body = if method == "POST" {
        format!(r#"{{"protocolVersion":{GXSERVER_PROTOCOL_VERSION}}}"#)
    } else {
        String::new()
    };
    let mut request = format!(
        "{method} {path} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n{GXSERVER_PROTOCOL_HEADER}: {GXSERVER_PROTOCOL_VERSION}\r\n"
    );
    if let Some(token) = token {
        request.push_str(&format!("Authorization: Bearer {token}\r\n"));
    }
    if method == "POST" {
        request.push_str("Content-Type: application/json\r\n");
        request.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    request.push_str("\r\n");
    request.push_str(&body);
    stream.write_all(request.as_bytes())?;

    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    let (headers, body) = match response.split_once("\r\n\r\n") {
        Some(parts) => parts,
        None => return Ok(None),
    };
    let status_ok = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|status| status.parse::<u16>().ok())
        .map(|status| (200..300).contains(&status))
        .unwrap_or(false);
    if !status_ok {
        return Ok(None);
    }
    Ok(Some(
        serde_json::from_str(body.trim()).with_context(|| "parse local gxserver response")?,
    ))
}
