//! Single gxserver calls a session's own controls make. Web-ready: `gx_rpc` only.

use serde_json::json;

use crate::app::gx_store::{GxRpcError, gx_rpc};

/// `/api/switchSessionAgent` on the local daemon.
pub(crate) async fn switch_session_agent(
    project_id: String,
    session_id: String,
    agent_id: String,
) -> Result<(), GxRpcError> {
    gx_rpc(
        None,
        "/api/switchSessionAgent",
        json!({ "agentId": agent_id, "projectId": project_id, "sessionId": session_id }),
    )
    .await
    .map(|_| ())
}
