use std::{collections::HashMap, sync::Arc, time::Duration};

use serde_json::{json, Map, Value};
use tokio::sync::{broadcast, mpsc, oneshot, Mutex};
use uuid::Uuid;

use crate::constants::GXSERVER_PROTOCOL_VERSION;

pub type EventClientSender = mpsc::UnboundedSender<Value>;
pub type EventClientReceiver = mpsc::UnboundedReceiver<Value>;

#[derive(Clone)]
pub struct GxserverEventHub {
    inner: Arc<EventHubInner>,
}

struct EventHubInner {
    broadcast_tx: broadcast::Sender<Value>,
    pending_renderer_commands: Mutex<HashMap<String, oneshot::Sender<Value>>>,
    renderer_client: Mutex<Option<RendererClient>>,
    server_id: String,
}

#[derive(Clone)]
struct RendererClient {
    client_id: String,
    sender: EventClientSender,
}

#[derive(Debug)]
pub struct RendererCommandError {
    pub code: &'static str,
    pub message: String,
}

/*
CDXC:GxserverPresentationEvents 2026-06-15-09:55:
Phase 4 Rust WebSockets must move beyond eventStreamReady and own the same server event hub contract as TypeScript: broadcast lifecycle/API/presentation events, let clients subscribe for fresh snapshots, and route renderer-only commands through the authenticated event stream without changing the default product port.
*/
impl GxserverEventHub {
    pub fn new(server_id: impl Into<String>) -> Self {
        let (broadcast_tx, _) = broadcast::channel(256);
        Self {
            inner: Arc::new(EventHubInner {
                broadcast_tx,
                pending_renderer_commands: Mutex::new(HashMap::new()),
                renderer_client: Mutex::new(None),
                server_id: server_id.into(),
            }),
        }
    }

    pub fn broadcast(&self, event: Value) {
        let _ = self.inner.broadcast_tx.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Value> {
        self.inner.broadcast_tx.subscribe()
    }

    pub fn client_channel(&self) -> (EventClientSender, EventClientReceiver) {
        mpsc::unbounded_channel()
    }

    pub async fn register_renderer_client(
        &self,
        client_id: impl Into<String>,
        sender: EventClientSender,
    ) -> String {
        let client_id = client_id.into();
        *self.inner.renderer_client.lock().await = Some(RendererClient {
            client_id: client_id.clone(),
            sender,
        });
        client_id
    }

    pub async fn unregister_renderer_client(&self, client_id: &str) {
        let mut renderer = self.inner.renderer_client.lock().await;
        if renderer
            .as_ref()
            .map(|client| client.client_id.as_str() == client_id)
            .unwrap_or(false)
        {
            *renderer = None;
        }
    }

    pub async fn handle_renderer_command_result(&self, message: &Map<String, Value>) {
        let command_id = message
            .get("commandId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let Some(sender) = self
            .inner
            .pending_renderer_commands
            .lock()
            .await
            .remove(command_id)
        else {
            return;
        };
        let result = if message.get("ok").and_then(Value::as_bool) == Some(false) {
            json!({
                "error": message
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("macOS renderer command failed."),
                "ok": false,
            })
        } else {
            message
                .get("result")
                .and_then(Value::as_object)
                .cloned()
                .map(Value::Object)
                .unwrap_or_else(|| json!({ "ok": true }))
        };
        let _ = sender.send(result);
    }

    pub async fn dispatch_renderer_command(
        &self,
        action: String,
        payload: Map<String, Value>,
        timeout_ms: u64,
    ) -> Result<Value, RendererCommandError> {
        let Some(renderer) = self.inner.renderer_client.lock().await.clone() else {
            return Err(RendererCommandError::dependency_unavailable());
        };
        let command_id = format!("renderer-{}", Uuid::new_v4());
        let command = json!({
            "action": action,
            "commandId": command_id,
            "createdAt": now_iso(),
            "payload": Value::Object(payload),
            "timeoutMs": timeout_ms,
        });
        let event = json!({
            "command": command,
            "protocolVersion": GXSERVER_PROTOCOL_VERSION,
            "serverId": self.inner.server_id,
            "type": "rendererCommand",
        });
        let (result_tx, result_rx) = oneshot::channel();
        self.inner
            .pending_renderer_commands
            .lock()
            .await
            .insert(command_id.clone(), result_tx);
        if renderer.sender.send(event).is_err() {
            self.inner
                .pending_renderer_commands
                .lock()
                .await
                .remove(&command_id);
            self.unregister_renderer_client(&renderer.client_id).await;
            return Err(RendererCommandError::dependency_unavailable());
        }
        match tokio::time::timeout(Duration::from_millis(timeout_ms), result_rx).await {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(_)) => {
                self.inner
                    .pending_renderer_commands
                    .lock()
                    .await
                    .remove(&command_id);
                Err(RendererCommandError::dependency_unavailable())
            }
            Err(_) => {
                self.inner
                    .pending_renderer_commands
                    .lock()
                    .await
                    .remove(&command_id);
                Err(RendererCommandError::timeout(&action, timeout_ms))
            }
        }
    }
}

impl RendererCommandError {
    fn dependency_unavailable() -> Self {
        Self {
            code: "dependencyUnavailable",
            message: "No macOS renderer is connected to gxserver for renderer-only commands."
                .to_string(),
        }
    }

    fn timeout(action: &str, timeout_ms: u64) -> Self {
        Self {
            code: "dependencyUnavailable",
            message: format!(
                "Timed out waiting {timeout_ms}ms for macOS renderer command {action}."
            ),
        }
    }
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
