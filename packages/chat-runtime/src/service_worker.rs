use super::ServiceRuntime;
use anyhow::{Result, anyhow};
use serde_json::Value;
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};

#[derive(Clone)]
struct Delivery {
    messages: mpsc::Sender<Result<Value, String>>,
    wake_pending: Arc<AtomicBool>,
    wake: Arc<dyn Fn() + Send + Sync>,
}

impl Delivery {
    fn send(&self, message: Result<Value, String>) {
        if self.messages.send(message).is_ok() && !self.wake_pending.swap(true, Ordering::AcqRel) {
            (self.wake)();
        }
    }
}

pub struct ServiceWorker {
    commands: mpsc::Sender<String>,
    messages: mpsc::Receiver<Result<Value, String>>,
    wake_pending: Arc<AtomicBool>,
}

impl ServiceWorker {
    pub fn start(
        config: Value,
        database: PathBuf,
        wake: impl Fn() + Send + Sync + 'static,
    ) -> Result<Self> {
        let (commands, command_rx) = mpsc::channel::<String>();
        let (message_tx, messages) = mpsc::channel();
        let (ready_tx, ready) = mpsc::sync_channel(1);
        let wake_pending = Arc::new(AtomicBool::new(false));
        let delivery = Delivery {
            messages: message_tx,
            wake_pending: wake_pending.clone(),
            wake: Arc::new(wake),
        };
        thread::Builder::new()
            .name("ghostex-native-service".into())
            .spawn(move || {
                let output = delivery.clone();
                let mut runtime = match ServiceRuntime::new(&config, &database, move |message| {
                    output.send(Ok(message))
                }) {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        let _ = ready_tx.send(Err(error.to_string()));
                        return;
                    }
                };
                if ready_tx.send(Ok(())).is_err() {
                    return;
                }
                let mut next_tick = Instant::now();
                loop {
                    // Keep commands FIFO and allow input between completed network callbacks.
                    match command_rx.try_recv() {
                        Ok(source) => {
                            if let Err(error) = runtime.evaluate(&source) {
                                delivery.send(Err(error.to_string()));
                            }
                            continue;
                        }
                        Err(mpsc::TryRecvError::Disconnected) => return,
                        Err(mpsc::TryRecvError::Empty) => {}
                    }
                    if Instant::now() >= next_tick {
                        if let Err(error) = runtime.tick() {
                            delivery.send(Err(error.to_string()));
                        }
                        next_tick = Instant::now() + Duration::from_millis(16);
                        continue;
                    }
                    match runtime.poll_network() {
                        Ok(true) => continue,
                        Err(error) => {
                            delivery.send(Err(error.to_string()));
                            continue;
                        }
                        Ok(false) => {}
                    }
                    match command_rx
                        .recv_timeout(next_tick.saturating_duration_since(Instant::now()))
                    {
                        Ok(source) => {
                            if let Err(error) = runtime.evaluate(&source) {
                                delivery.send(Err(error.to_string()));
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => return,
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                    }
                }
            })?;
        ready
            .recv()
            .map_err(|_| anyhow!("Native service stopped during startup"))?
            .map_err(|error| anyhow!(error))?;
        Ok(Self {
            commands,
            messages,
            wake_pending,
        })
    }

    pub fn evaluate(&self, source: &str) -> Result<()> {
        self.commands
            .send(source.to_owned())
            .map_err(|_| anyhow!("Native service is not running"))
    }

    pub fn drain_ready(&self) -> Vec<Result<Value, String>> {
        // Reset before reading: a producer racing with the drain schedules the next wake.
        self.wake_pending.store(false, Ordering::Release);
        self.messages.try_iter().collect()
    }
}
