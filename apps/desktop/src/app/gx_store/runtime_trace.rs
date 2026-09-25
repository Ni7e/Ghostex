//! The app runtime port's meter: the `native.runtime.trace` diagnostic scenario.
//!
//! Four kinds of line go to `gpui-runtime-trace.jsonl`, with names only, never values:
//!
//! - `runtime.rpc`: a gxserver call the old QuickJS runtime sent (`packages/chat-runtime` hands it
//!   over as a `trace` message when [`runtime_trace_enabled`] armed it).
//! - `runtime.entry`: a script or command that still reached the old runtime
//!   (`NativeService::execute_app_owned_script`), named by [`runtime_entry_name`], and every
//!   `handleSidebarMessage` call the runtime reports itself (`handleSidebarMessage:<type>`).
//! - `runtime.post`: a bridge post, `nativeHost` or `modalHost` message the old runtime sent to
//!   Rust.
//! - `gxRpc.rpc`: a gxserver call a Rust executor sent through `gx_rpc`.
//!
//! CDXC:Diagnostics 2026-09-25 WHY:
//! The runtime performs side effects, so it cannot run in shadow beside its Rust port the way the
//! chat brain did. Parity is proved by the same action logging the same endpoints and parameter
//! names in the same order on the old build and the new one, and progress by the `runtime.*` lines
//! going to zero. `bun tooling/app-runtime-port/trace-meter.ts` summarises the file per ledger
//! family. Endpoints are written without their slashes because the support log redacts any string
//! that contains one.
//!
//! SEE-ALSO: docs/2026-09-25/app-runtime-port/LEDGER.md, packages/chat-runtime/src/network.rs
//! (`trace_record`), apps/desktop/src/app/native_service.rs.

use serde_json::{Value, json};

use crate::support_logs::{self, GpuiDiagnosticScenario, GpuiSupportLog};

/// Whether the scenario is on right now: "Show debug UI controls" and an unexpired
/// `native.runtime.trace`. The runtime thread is armed from this and re-armed on every settings
/// change; each line is still checked again as it is written.
pub(crate) fn runtime_trace_enabled() -> bool {
    crate::shared_settings::shared_sidebar_settings_snapshot().debugging_mode()
        && support_logs::scenario_enabled(GpuiDiagnosticScenario::RuntimeTrace)
}

fn write(event: &str, details: Value) {
    support_logs::append_for_scenario(
        GpuiSupportLog::RuntimeTrace,
        GpuiDiagnosticScenario::RuntimeTrace.scenario_id(),
        event,
        details,
    );
}

/// `/api/readSidebarHud` is written `readSidebarHud`, `/api/a/b` is written `a.b`.
fn endpoint_name(path: &str) -> String {
    let path = path.split('?').next().unwrap_or_default();
    path.trim_start_matches("/api/")
        .trim_matches('/')
        .replace('/', ".")
}

/// A call leaving `gx_rpc`.
pub(crate) fn trace_gx_rpc(path: &str, params: &Value, remote: bool) {
    if !runtime_trace_enabled() {
        return;
    }
    write(
        "gxRpc.rpc",
        json!({
            "endpoint": endpoint_name(path),
            "params": super::rpc_types::gx_rpc_param_names(params),
            "remote": remote,
        }),
    );
}

/// A `trace` message from the runtime thread: `{kind:"trace", method, path, params, socket}`.
pub(crate) fn trace_runtime_rpc(message: &Value) {
    write(
        "runtime.rpc",
        json!({
            "endpoint": endpoint_name(message["path"].as_str().unwrap_or_default()),
            "method": message["method"],
            "params": message["params"],
            "socket": message["socket"].as_bool().unwrap_or(false),
            "remote": message["remote"].as_bool().unwrap_or(false),
        }),
    );
}

/// A script about to be evaluated in the runtime.
pub(crate) fn trace_runtime_entry(source: &str) {
    if !runtime_trace_enabled() {
        return;
    }
    write(
        "runtime.entry",
        json!({ "name": runtime_entry_name(source) }),
    );
}

/// A `traceEntry` message from the runtime: a `handleSidebarMessage` call, named
/// `handleSidebarMessage:<type>`, whichever door delivered it.
pub(crate) fn trace_runtime_handler(message: &Value) {
    let name = message["name"]
        .as_str()
        .and_then(identifier)
        .unwrap_or_else(|| "handleSidebarMessage:untyped".into());
    write("runtime.entry", json!({ "name": name }));
}

/// A message the runtime posted to Rust: `sidebar` (a bridge function), `nativeHost` or
/// `modalHost` (named by the message's `type`).
pub(crate) fn trace_runtime_post(message: &Value) {
    if !runtime_trace_enabled() {
        return;
    }
    let kind = message["kind"].as_str().unwrap_or_default();
    let name = match kind {
        "sidebar" => message["name"].as_str().unwrap_or_default().to_string(),
        "nativeHost" | "modalHost" => message_type(&message["message"]),
        _ => return,
    };
    write("runtime.post", json!({ "kind": kind, "name": name }));
}

/// The `type` of a posted message, which arrives either as an object or as its JSON text.
fn message_type(message: &Value) -> String {
    let parsed;
    let message = match message.as_str() {
        Some(text) => {
            parsed = serde_json::from_str::<Value>(text).unwrap_or(Value::Null);
            &parsed
        }
        None => message,
    };
    identifier(message["type"].as_str().unwrap_or_default()).unwrap_or_else(|| "untyped".into())
}

/// Names a script the way the ledger names its entry point: the first `bridge.on<Name>` callback
/// it calls (with the message `type` for the callbacks that carry a typed command), else the first
/// `CustomEvent` it dispatches, else the first `ghostexGpui` field it assigns.
pub(crate) fn runtime_entry_name(source: &str) -> String {
    if let Some(callback) = first_callback(source) {
        if matches!(
            callback.as_str(),
            "onSidebarCommand"
                | "onSidebarHostMessage"
                | "onNativeQuickAccessCommand"
                | "onGitCommitModalCommand"
                | "onWorktreeModalCommand"
                | "onExportTranscriptModalCommand"
                | "onOsIntegrationCommand"
                | "onWorkspaceTerminalRuntimeAction"
                | "onTitlebarGitAction"
        ) {
            if let Some(kind) = first_type_value(source) {
                return format!("{callback}:{kind}");
            }
        }
        return callback;
    }
    if let Some(index) = source.find("CustomEvent('") {
        let rest = &source[index + "CustomEvent('".len()..];
        if let Some(name) = rest.split('\'').next().and_then(identifier) {
            return format!("event:{name}");
        }
    }
    if let Some(index) = source.find("ghostexGpui.") {
        let rest = &source[index + "ghostexGpui.".len()..];
        if let Some(name) = identifier(
            rest.split(|c: char| !c.is_ascii_alphanumeric())
                .next()
                .unwrap_or_default(),
        ) {
            return format!("set:{name}");
        }
    }
    "script".to_string()
}

/// The first `.on<Upper>...` member in the source.
fn first_callback(source: &str) -> Option<String> {
    let bytes = source.as_bytes();
    let mut start = 0;
    while let Some(offset) = source[start..].find(".on") {
        let at = start + offset + 1;
        if bytes.get(at + 2).is_some_and(u8::is_ascii_uppercase) {
            let name: String = source[at..]
                .chars()
                .take_while(char::is_ascii_alphanumeric)
                .collect();
            return identifier(&name);
        }
        start = at + 2;
    }
    None
}

/// The value of the first `"type":"..."` in the script's JSON payload, when it is a plain name.
fn first_type_value(source: &str) -> Option<String> {
    let index = source.find("\"type\":\"")?;
    let rest = &source[index + "\"type\":\"".len()..];
    identifier(rest.split('"').next()?)
}

/// A code name (letters, digits, `.`, `-`, `_`, at most 80 characters), or `None`.
fn identifier(text: &str) -> Option<String> {
    (!text.is_empty()
        && text.len() <= 80
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':')))
    .then(|| text.to_string())
}
