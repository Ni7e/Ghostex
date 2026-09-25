//! `gx_rpc`: the one way a Rust executor file calls gxserver. The GPUI web build has a file of the
//! same name and signature that performs the call with `fetch`
//! (`apps/gpui-web/src/app/gx_store/rpc.rs`), so an executor that uses only this function (and no
//! CEF, AppKit or desktop window API) can be symlinked into the web build unchanged.
//!
//! CDXC:ServerApi 2026-09-25 WHY:
//! The app runtime port (docs/2026-09-25/app-runtime-port/PLAN.md) moves about 27k lines of
//! QuickJS into Rust that must also run in the web build. The desktop had about 110 blocking
//! `TcpStream` call sites and the web build calls `fetch`, with no shared seam, so each ported
//! executor would have had to be written twice. This is the seam, in the shape
//! `native_chat/rpc.rs` already proved: an async function, same signature on both builds.
//!
//! Unlike `native_chat/rpc.rs`, the desktop body does not block the thread that awaits it: the
//! blocking request runs on a thread of its own and the future only waits for the answer, so a
//! caller may await it from `cx.spawn` on the main thread as well as from the background
//! executor. The future is `Send`.
//!
//! Every call is recorded in the `native.runtime.trace` meter (endpoint and parameter names only),
//! so a family's port can be compared call for call with what the old runtime sent.
//!
//! SEE-ALSO: apps/desktop/src/app/gx_store/rpc_types.rs (the shared error type),
//! apps/desktop/src/app/gx_store/runtime_trace.rs (the meter),
//! docs/2026-09-25/app-runtime-port/LEDGER.md (how families use it).

use std::time::Duration;

use futures::channel::oneshot;
use serde_json::Value;

use super::rpc_types::GxRpcError;
use crate::app::helpers::{
    gpui_remote_gxserver_post_typed_operation, gxserver_post_typed_operation,
};
use crate::app::model::GpuiRemoteGxserverRequestTarget;

/// The old runtime's `fetch` ran under the same 60-second global timeout (`packages/chat-runtime/src/network.rs`).
const GX_RPC_TIMEOUT: Duration = Duration::from_secs(60);

/// Calls `path` (`/api/...`) with `params` on the local gxserver, or on the remote machine whose
/// tunnel `remote` names, and returns the envelope's `result`.
#[allow(dead_code)] // the first callers arrive with the runtime port's family commits
pub(crate) async fn gx_rpc(
    remote: Option<GpuiRemoteGxserverRequestTarget>,
    path: &str,
    params: Value,
) -> Result<Value, GxRpcError> {
    super::runtime_trace::trace_gx_rpc(path, &params, remote.is_some());
    let (sender, receiver) = oneshot::channel();
    let owned_path = path.to_string();
    let spawned = std::thread::Builder::new()
        .name("ghostex-gx-rpc".into())
        .spawn(move || {
            let response = match remote {
                Some(target) => gpui_remote_gxserver_post_typed_operation(
                    &target,
                    &owned_path,
                    &params,
                    GX_RPC_TIMEOUT,
                ),
                None => gxserver_post_typed_operation(&owned_path, &params, GX_RPC_TIMEOUT),
            };
            let result = match response {
                Ok((status, body)) => match serde_json::from_str::<Value>(&body) {
                    Ok(envelope) => GxRpcError::from_envelope(&owned_path, Some(status), envelope),
                    Err(_) => Err(GxRpcError::transport(
                        &owned_path,
                        "gxserver returned invalid JSON.",
                    )),
                },
                Err(message) => Err(GxRpcError::transport(&owned_path, message)),
            };
            let _ = sender.send(result);
        });
    if spawned.is_err() {
        return Err(GxRpcError::transport(
            path,
            "Could not start the gxserver request.",
        ));
    }
    receiver.await.unwrap_or_else(|_| {
        Err(GxRpcError::transport(
            path,
            "The gxserver request was dropped.",
        ))
    })
}
