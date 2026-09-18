use ghostex_chat_runtime::ChatRuntime;
use serde_json::Value;
use std::{
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

/// CDXC:SessionChat 2026-09-18 WHY:
/// The shared chat controller ran on the UI thread: opening a long transcript blocked input for up to a second while QuickJS projected every message, and each broker frame stalled a redraw.
/// Every chat now owns a runtime thread that creates its QuickJS runtime, applies actions and broker messages, services the controller's timers, and posts drained output back; the view only splices what arrives.
/// The one synchronous helper (composer references) waits on the thread with a short timeout so the input still paints pills with the keystroke unless the runtime is busy.
pub(crate) enum ChatRuntimeOutput {
    Drained(Value),
    Error(String),
}

enum Command {
    Call {
        method: &'static str,
        arguments: Vec<Value>,
    },
    Query {
        method: &'static str,
        arguments: Vec<Value>,
        reply: mpsc::Sender<Result<Value, String>>,
    },
}

pub(crate) struct ChatRuntimeWorker {
    commands: mpsc::Sender<Command>,
    outputs: mpsc::Receiver<ChatRuntimeOutput>,
}

impl ChatRuntimeWorker {
    pub(crate) fn start(config: Value, wake: impl Fn() + Send + Sync + 'static) -> Self {
        let (commands, command_rx) = mpsc::channel::<Command>();
        let (output_tx, outputs) = mpsc::channel();
        thread::Builder::new()
            .name("ghostex-chat-runtime".into())
            .spawn(move || {
                let post = |output: ChatRuntimeOutput| {
                    let _ = output_tx.send(output);
                    wake();
                };
                let mut runtime = match ChatRuntime::new(&config) {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        post(ChatRuntimeOutput::Error(error.to_string()));
                        return;
                    }
                };
                let mut next_wake: Option<Instant> = None;
                let drain =
                    |runtime: &mut ChatRuntime, next_wake: &mut Option<Instant>| match runtime
                        .drain()
                    {
                        Ok(output) => {
                            *next_wake = output["nextWakeMs"]
                                .as_u64()
                                .map(|ms| Instant::now() + Duration::from_millis(ms.max(1)));
                            let carries_change = output["itemsSplice"].is_object()
                                || output["snapshot"].is_object()
                                || output["requests"]
                                    .as_array()
                                    .is_some_and(|requests| !requests.is_empty());
                            if carries_change {
                                post(ChatRuntimeOutput::Drained(output));
                            }
                        }
                        Err(error) => post(ChatRuntimeOutput::Error(error.to_string())),
                    };
                drain(&mut runtime, &mut next_wake);
                loop {
                    let command = match next_wake {
                        Some(at) => {
                            match command_rx
                                .recv_timeout(at.saturating_duration_since(Instant::now()))
                            {
                                Ok(command) => Some(command),
                                Err(mpsc::RecvTimeoutError::Timeout) => None,
                                Err(mpsc::RecvTimeoutError::Disconnected) => return,
                            }
                        }
                        None => match command_rx.recv() {
                            Ok(command) => Some(command),
                            Err(_) => return,
                        },
                    };
                    match command {
                        Some(Command::Call { method, arguments }) => {
                            if let Err(error) = runtime.call(method, &arguments) {
                                post(ChatRuntimeOutput::Error(error.to_string()));
                            }
                        }
                        Some(Command::Query {
                            method,
                            arguments,
                            reply,
                        }) => {
                            let _ = reply.send(
                                runtime
                                    .query(method, &arguments)
                                    .map_err(|error| error.to_string()),
                            );
                            continue;
                        }
                        None => {}
                    }
                    drain(&mut runtime, &mut next_wake);
                }
            })
            .expect("spawn the chat runtime thread");
        Self { commands, outputs }
    }

    /// Queue a controller call; its output arrives through the wake callback.
    pub(crate) fn call(&self, method: &'static str, arguments: Vec<Value>) {
        let _ = self.commands.send(Command::Call { method, arguments });
    }

    /// Run a pure controller helper and wait for its answer, or give up after `timeout`.
    pub(crate) fn query(
        &self,
        method: &'static str,
        arguments: Vec<Value>,
        timeout: Duration,
    ) -> Option<Value> {
        let (reply, answer) = mpsc::channel();
        self.commands
            .send(Command::Query {
                method,
                arguments,
                reply,
            })
            .ok()?;
        answer.recv_timeout(timeout).ok()?.ok()
    }

    pub(crate) fn take_outputs(&self) -> Vec<ChatRuntimeOutput> {
        self.outputs.try_iter().collect()
    }
}
