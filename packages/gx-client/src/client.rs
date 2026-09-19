//! The handle a host holds.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Arc;
use std::thread;

use crate::config::GxClientConfig;
use crate::output::{ClientOutput, ClientStats, ClientStatsSnapshot};
use crate::socket::Endpoint;
use crate::worker::{Command, Worker};

/// Why a client could not start.
#[derive(Debug)]
pub enum StartError {
    /// The base URL is not `http://<host>:<port>`.
    UnsupportedBaseUrl,
    Thread(std::io::Error),
}

impl std::fmt::Display for StartError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsupportedBaseUrl => {
                formatter.write_str("the gxserver base URL must be http://<host>:<port>")
            }
            Self::Thread(error) => write!(formatter, "could not start the client thread: {error}"),
        }
    }
}

impl std::error::Error for StartError {}

/// A running client. Dropping it stops the thread without waiting for it.
pub struct GxClient {
    commands: Sender<Command>,
    outputs: Receiver<ClientOutput>,
    shutdown: Arc<AtomicBool>,
    wake_pending: Arc<AtomicBool>,
    stats: Arc<ClientStats>,
}

impl GxClient {
    /// Starts the socket thread. `wake` is called from that thread, at most once between two
    /// [`Self::drain`] calls, whenever outputs are waiting; it must only signal the host's own
    /// thread (send on a channel) and return.
    pub fn start(
        config: GxClientConfig,
        wake: impl Fn() + Send + 'static,
    ) -> Result<Self, StartError> {
        let endpoint = Endpoint::parse(&config.base_url).ok_or(StartError::UnsupportedBaseUrl)?;
        let (commands, command_receiver) = mpsc::channel();
        let (output_sender, outputs) = mpsc::channel();
        let shutdown = Arc::new(AtomicBool::new(false));
        let wake_pending = Arc::new(AtomicBool::new(false));
        let stats = Arc::new(ClientStats::default());
        let worker = Worker {
            config,
            endpoint,
            outputs: output_sender,
            commands: command_receiver,
            shutdown: shutdown.clone(),
            wake: Box::new(wake),
            wake_pending: wake_pending.clone(),
            stats: stats.clone(),
        };
        thread::Builder::new()
            .name("ghostex-gx-client".into())
            .spawn(move || worker.run())
            .map_err(StartError::Thread)?;
        Ok(Self {
            commands,
            outputs,
            shutdown,
            wake_pending,
            stats,
        })
    }

    /// Everything the thread produced since the last call, in order. Re-arms the wake first, so
    /// an output queued while this runs causes another wake instead of being stranded.
    pub fn drain(&self) -> Vec<ClientOutput> {
        self.wake_pending.store(false, Ordering::Release);
        self.outputs.try_iter().collect()
    }

    /// Asks for a full snapshot: `subscribePresentation` without `lastRevision`, on the live
    /// socket when there is one, else with the next connect. This is what the host does for
    /// `Effect::ResubscribePresentation`.
    pub fn request_resubscribe(&self) {
        let _ = self.commands.send(Command::Resubscribe);
    }

    pub fn stats(&self) -> ClientStatsSnapshot {
        self.stats.snapshot()
    }
}

impl Drop for GxClient {
    fn drop(&mut self) {
        // The thread is not joined: it looks at this flag at least once per socket read timeout
        // and between reconnect waits, and nothing it still sends can reach anyone.
        self.shutdown.store(true, Ordering::Release);
        let _ = self.commands.send(Command::Shutdown);
    }
}
