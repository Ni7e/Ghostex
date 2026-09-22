//! What the page does for a chat view. On the desktop the view's broker requests cross into a second QuickJS runtime that runs `apps/desktop/sidebar/session-chat-runtime/broker.ts` (the live chat socket, drafts, options and the model catalog). That file is browser code, so here it runs in the page itself, unchanged, and this module is the relay between it and the views: the same payload the desktop's `session_chat_runtime.rs` builds, and the same two entry points for what comes back.
use futures::StreamExt as _;
use futures::channel::mpsc;
use ghostex_gx_core::SessionKey;
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

use crate::GhostexGpuiApp;

#[wasm_bindgen(inline_js = r#"
let epoch = null;
const waiting = [];

export function chat_broker_install(deliver) {
  window.ghostexGpui = window.ghostexGpui || {};
  window.webkit = window.webkit || {};
  window.webkit.messageHandlers = window.webkit.messageHandlers || {};
  // The broker posts to the desktop's native host through this handler.
  window.webkit.messageHandlers.ghostexNativeHost = {
    postMessage(message) {
      if (message?.type !== 'sessionChatRuntimeBroker') return;
      if (message.kind === 'ready') {
        epoch = message.epoch;
        for (const request of waiting.splice(0)) chat_broker_request(request);
        return;
      }
      deliver(String(message.generation ?? ''), JSON.stringify(message));
    },
  };
  globalThis.ghostexInstallChatBroker();
}

export function chat_broker_request(requestJson) {
  if (epoch === null) {
    waiting.push(requestJson);
    return;
  }
  const request = JSON.parse(requestJson);
  request.epoch = epoch;
  window.ghostexGpui.onSessionChatRuntimeRequest?.(request);
}
"#)]
extern "C" {
    fn chat_broker_install(deliver: &Closure<dyn FnMut(String, String)>);
    fn chat_broker_request(request_json: &str);
}

impl GhostexGpuiApp {
    /// Starts the page's chat broker and the task that hands its messages to the views.
    pub(crate) fn web_start_chat_broker(&mut self, cx: &mut gpui::Context<Self>) {
        let (sender, mut receiver) = mpsc::unbounded::<(String, String)>();
        let deliver = Closure::<dyn FnMut(String, String)>::new(move |generation, message| {
            let _ = sender.unbounded_send((generation, message));
        });
        chat_broker_install(&deliver);
        // The broker lives as long as the page.
        deliver.forget();
        cx.spawn(async move |app, cx| {
            while let Some((generation, message)) = receiver.next().await {
                let delivered = app.update(cx, |app, cx| {
                    let Some(view) = app
                        .native_chats
                        .values()
                        .find(|(id, _)| id.0.to_string() == generation)
                        .map(|(_, view)| view.clone())
                    else {
                        return;
                    };
                    let Ok(payload) = serde_json::from_str::<Value>(&message) else {
                        return;
                    };
                    view.update(cx, |view, cx| match payload["raw"].as_str() {
                        // A frame that fits one message travels as its JSON text and only the runtime parses it.
                        Some(raw) if payload["kind"] == "event" => {
                            view.receive_broker_raw(raw.to_string())
                        }
                        _ => view.receive_callback("onSessionChatRuntimeMessage", &payload, cx),
                    });
                });
                if delivered.is_err() {
                    return;
                }
            }
        })
        .detach();
    }

    pub(crate) fn web_relay_chat_broker(
        &mut self,
        session: &SessionKey,
        message: Value,
        _cx: &mut gpui::Context<Self>,
    ) {
        if message["method"] == "presentation" {
            self.chat_presentations
                .insert(session.clone(), message["params"]["state"].clone());
            return;
        }
        let Some((shell_session_id, _)) = self.native_chats.get(session) else {
            return;
        };
        let Some(endpoint) = self.gx_store.endpoint.as_ref() else {
            return;
        };
        chat_broker_request(
            &json!({
                "clientId": message["clientId"],
                "generation": shell_session_id.0.to_string(),
                "requestId": message["requestId"],
                "method": message["method"],
                "params": message["params"],
                "identity": {"machineId": "local", "projectId": session.project_id, "sessionId": session.session_id},
                "endpoint": {"baseUrl": endpoint.base_url, "authToken": endpoint.auth_token},
            })
            .to_string(),
        );
    }

    pub(crate) fn web_chat_host_action(
        &mut self,
        _session: &SessionKey,
        message: &Value,
        cx: &mut gpui::Context<Self>,
    ) {
        match message["action"].as_str().or_else(|| message["method"].as_str()) {
            // The composer's terminal button: the same session, as a terminal.
            Some("terminalView" | "switchToTerminal") => self.web_show_terminal(true, cx),
            Some("composerReady") => {}
            other => log::info!("chat host action not handled on web yet: {other:?}"),
        }
    }
}
