//! What a host passes to [`crate::GxClient::start`], and the client's timing rules.

use std::sync::atomic::AtomicI64;
use std::sync::Arc;
use std::time::Duration;

use ghostex_gx_core::MachineId;

/// Delay before reconnect attempt `n` (the last entry repeats). The same ladder the TypeScript
/// client uses, so a daemon restart is met by one client behaviour, not two.
pub const RECONNECT_LADDER_MS: [u64; 6] = [250, 1000, 2000, 4000, 8000, 16000];

/// The ladder restarts from its first step only when the stream had been acknowledged for at
/// least this long before it dropped. A stream that flaps faster keeps escalating.
pub const HEALTHY_STREAM_DURATION: Duration = Duration::from_secs(30);

/// A subscribe the daemon cannot serve (state database unavailable) is answered by silence, so
/// every subscribe is paired with this deadline; missing it drops the socket and reconnects.
pub const SUBSCRIBE_ACK_TIMEOUT: Duration = Duration::from_secs(10);

/// Lower bound between two resubscribes the client forces itself after a delta failed to parse.
pub const FORCED_RESUBSCRIBE_INTERVAL: Duration = Duration::from_secs(10);

/// How long one socket read may block. Bounds how late the thread notices a shutdown or a
/// resubscribe request, so dropping the client never waits on the daemon.
pub(crate) const SOCKET_READ_TIMEOUT: Duration = Duration::from_millis(200);
pub(crate) const SOCKET_WRITE_TIMEOUT: Duration = Duration::from_secs(10);
pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
pub(crate) const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
/// The `listProjects` read runs on the socket thread (see `worker.rs` for why), so it is short.
pub(crate) const DOMAIN_PROJECTS_READ_TIMEOUT: Duration = Duration::from_secs(3);
/// A snapshot of a large workspace is a few megabytes; the default tungstenite frame cap of
/// 16 MiB would turn a larger one into an endless reconnect loop.
pub(crate) const MAX_FRAME_BYTES: usize = 256 * 1024 * 1024;

/// Where the daemon is and how the store is identified to it.
#[derive(Clone, Debug)]
pub struct GxClientConfig {
    /// The machine the events are reported for. The local daemon is [`MachineId::Local`].
    pub machine: MachineId,
    /// `http://<loopback host>:<port>`, without a path. Any other scheme is refused.
    pub base_url: String,
    /// The daemon's bearer token. Sent in the `Authorization` header only, never in a URL.
    pub auth_token: String,
    /// Echoed back on the snapshot frame; the daemon does not route by it.
    pub client_id: String,
    /// The revision the host's store holds for `machine`, `0` while it holds nothing. The client
    /// quotes it as `lastRevision` on every subscribe; the host writes it after applying frames.
    pub held_revision: Arc<AtomicI64>,
    /// Parse and forward the four `sessionChat*` frames. A full-stream socket carries the chat
    /// frames of every session any client subscribed to; the core has no state for them before
    /// the chat milestone, so a host leaves this off and they are dropped unparsed like
    /// `apiRequestHandled`. Tools turn it on to check the chat wire types against live traffic.
    pub forward_chat_frames: bool,
}
