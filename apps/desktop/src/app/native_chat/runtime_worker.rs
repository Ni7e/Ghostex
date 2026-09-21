use ghostex_chat_runtime::{ChatRuntime, ReplaySink};
use serde_json::Value;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
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
    CallRaw {
        method: &'static str,
        raw: String,
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
    /// True while the thread waits for work, so a synchronous query knows an answer is imminent.
    idle: Arc<AtomicBool>,
}

impl ChatRuntimeWorker {
    /// `recording` is the `native.chat.replay` file for this chat, or `None` when the scenario
    /// is off (replay_recording.rs). It is opened on the runtime thread, so a recording that
    /// cannot be made private stops the chat instead of leaking the conversation.
    pub(crate) fn start(
        config: Value,
        recording: Option<std::path::PathBuf>,
        wake: impl Fn() + Send + Sync + 'static,
    ) -> Self {
        let (commands, command_rx) = mpsc::channel::<Command>();
        let (output_tx, outputs) = mpsc::channel();
        let idle = Arc::new(AtomicBool::new(false));
        let idle_flag = idle.clone();
        thread::Builder::new()
            .name("ghostex-chat-runtime".into())
            .spawn(move || {
                let post = |output: ChatRuntimeOutput| {
                    let _ = output_tx.send(output);
                    wake();
                };
                // The Rust chat core run beside this one when `native.chat.shadow` is on, fed the
                // same seam lines the recorder writes (`super::shadow`). `None` when the scenario
                // is off, and then nothing below it costs anything.
                let shadow = super::shadow::ShadowHost::start_if_enabled();
                let shadow_sink = shadow.clone().map(|shadow| -> ReplaySink {
                    Box::new(move |line: &str| shadow.record(line))
                });
                let mut runtime = match ChatRuntime::new(&config, recording.as_deref(), shadow_sink)
                {
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
                            // The other half of every comparison: the document the live brain just
                            // drained. Its own `take` record reaches the shadow one call later.
                            if let Some(shadow) = shadow.as_ref() {
                                shadow.document(&output);
                            }
                            *next_wake = output["nextWakeMs"]
                                .as_u64()
                                .map(|ms| Instant::now() + Duration::from_millis(ms.max(1)));
                            let carries_change = output["itemsSplice"].is_object()
                                || output["snapshot"].is_object()
                                || output["rowDetails"].is_object()
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
                    idle_flag.store(true, Ordering::Release);
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
                    idle_flag.store(false, Ordering::Release);
                    match command {
                        Some(Command::Call { method, arguments }) => {
                            if let Err(error) = runtime.call(method, &arguments) {
                                post(ChatRuntimeOutput::Error(error.to_string()));
                            }
                        }
                        Some(Command::CallRaw { method, raw }) => {
                            if let Err(error) = runtime.call_raw(method, &raw) {
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
        Self {
            commands,
            outputs,
            idle,
        }
    }

    /// Queue a controller call; its output arrives through the wake callback.
    pub(crate) fn call(&self, method: &'static str, arguments: Vec<Value>) {
        let _ = self.commands.send(Command::Call { method, arguments });
    }

    /// Like `call` with one argument that is already JSON text; the runtime parses it itself.
    pub(crate) fn call_raw(&self, method: &'static str, raw: String) {
        let _ = self.commands.send(Command::CallRaw { method, raw });
    }

    /// Run a pure controller helper and wait for its answer, or give up after `timeout`.
    /// CDXC:SessionChat 2026-09-18 WHY:
    /// The composer asks this on every paint. While the thread boots a transcript or backfills projections it cannot answer for hundreds of milliseconds, and waiting out the timeout on each frame made the UI stutter right after a session click.
    /// A busy thread answers `None` immediately; only an idle one, which replies in well under a millisecond, is waited for.
    pub(crate) fn query(
        &self,
        method: &'static str,
        arguments: Vec<Value>,
        timeout: Duration,
    ) -> Option<Value> {
        if !self.idle.load(Ordering::Acquire) {
            return None;
        }
        self.query_for_gesture(method, arguments, timeout)
    }

    /// Run a pure controller helper for one deliberate press (a right-click menu), waiting up to
    /// `timeout` even when the thread is busy.
    ///
    /// CDXC:SessionChat 2026-09-19 WHY:
    /// `query` gives up at once on a busy thread, which suits a per-paint helper, but a menu row
    /// list asked for that way silently failed to open whenever a streaming reply or a transcript
    /// boot had the thread. A press happens once, so it queues behind the running work instead.
    pub(crate) fn query_for_gesture(
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
