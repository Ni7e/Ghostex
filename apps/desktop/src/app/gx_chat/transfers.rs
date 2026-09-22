//! The app runtime's chunked transfers, put back together.
//!
//! CDXC:SessionChat 2026-09-23 WHY:
//! The Rust brain still hears gxserver through the app runtime's broker
//! (`apps/desktop/sidebar/session-chat-runtime/broker.ts`), and that broker splits any message
//! longer than 96 KiB into `{kind: 'chunk'}` pieces. The retained store emits a chat's WHOLE folded
//! transcript as one `sessionChatSnapshot` on subscribe, on hydration and after every reconnect, so
//! any conversation of real length arrives chunked. The host had no arm for `chunk` and counted
//! each piece as unrouted, which dropped the snapshot itself: the first live run counted 18 such
//! pieces at startup and 15 more later. This is the port of `ChatTransfers`
//! (`packages/shared/session-chat-controller/transfers.ts`), limit for limit: one transfer at a
//! time per chat, at most 683 pieces of 96 Ki UTF-16 units, 64 Mi units in all, 30 seconds end to
//! end. A transfer that breaks any of those is FAILED rather than patched, and the caller answers a
//! failure the way the TypeScript does, by retrying the chat.

use std::collections::BTreeMap;
use std::time::Duration;

use serde_json::Value;
use web_time::Instant;

/// `data.length > 96 * 1024`, in UTF-16 units like the JavaScript string it was sliced from.
const MAX_PIECE_UNITS: usize = 96 * 1024;
/// `total > 683`.
const MAX_PIECES: u64 = 683;
/// `transfer.length > 64 * 1024 * 1024`.
const MAX_TRANSFER_UNITS: usize = 64 * 1024 * 1024;
/// The `setTimeout(..., 30_000)` a transfer is failed by.
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(30);

/// One transfer in flight for one chat.
pub(super) struct Transfer {
    id: String,
    total: u64,
    parts: Vec<String>,
    units: usize,
    started: Instant,
}

/// What one piece did.
pub(super) enum Piece {
    /// More pieces are owed.
    Pending,
    /// The last piece arrived; this is the message the pieces spelled.
    Complete(Value),
    /// The transfer broke and was dropped.
    Failed,
}

/// Whether a broker message is a piece of a transfer.
pub(super) fn is_piece(message: Option<&Value>) -> bool {
    message
        .and_then(|message| message.get("kind"))
        .and_then(Value::as_str)
        == Some("chunk")
}

/// `ChatTransfers.accept`, for the chat `key`.
pub(super) fn accept(
    pending: &mut BTreeMap<String, Transfer>,
    key: &str,
    message: Option<&Value>,
) -> Piece {
    let field = |name: &str| message.and_then(|message| message.get(name));
    let id = field("transferId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty());
    let index = field("index").and_then(Value::as_u64);
    let total = field("total")
        .and_then(Value::as_u64)
        .filter(|total| (1..=MAX_PIECES).contains(total));
    let data = field("data").and_then(Value::as_str);
    let (Some(id), Some(index), Some(total), Some(data)) = (id, index, total, data) else {
        pending.remove(key);
        return Piece::Failed;
    };
    let units = data.encode_utf16().count();
    if units > MAX_PIECE_UNITS {
        pending.remove(key);
        return Piece::Failed;
    }
    if index == 0 && !pending.contains_key(key) {
        pending.insert(
            key.to_string(),
            Transfer {
                id: id.to_string(),
                total,
                parts: Vec::new(),
                units: 0,
                started: Instant::now(),
            },
        );
    }
    // A piece of another transfer, one out of order, or one with no transfer to join fails the
    // transfer outright, which is `fail('The shared chat transfer was interrupted.')`.
    let Some(transfer) = pending.get_mut(key).filter(|transfer| {
        transfer.id == id && transfer.total == total && transfer.parts.len() as u64 == index
    }) else {
        pending.remove(key);
        return Piece::Failed;
    };
    transfer.units += units;
    if transfer.units > MAX_TRANSFER_UNITS {
        pending.remove(key);
        return Piece::Failed;
    }
    transfer.parts.push(data.to_string());
    if (transfer.parts.len() as u64) < transfer.total {
        return Piece::Pending;
    }
    let Some(transfer) = pending.remove(key) else {
        return Piece::Failed;
    };
    match serde_json::from_str::<Value>(&transfer.parts.concat()) {
        Ok(message) => Piece::Complete(message),
        Err(_) => Piece::Failed,
    }
}

/// When the oldest transfer in flight times out, so the host thread wakes for it.
pub(super) fn deadline(pending: &BTreeMap<String, Transfer>) -> Option<Instant> {
    pending
        .values()
        .map(|transfer| transfer.started + TRANSFER_TIMEOUT)
        .min()
}

/// Drops every transfer past its 30 seconds and names the chats they belonged to.
pub(super) fn expire(pending: &mut BTreeMap<String, Transfer>) -> Vec<String> {
    let expired: Vec<String> = pending
        .iter()
        .filter(|(_, transfer)| transfer.started.elapsed() >= TRANSFER_TIMEOUT)
        .map(|(key, _)| key.clone())
        .collect();
    for key in &expired {
        pending.remove(key);
    }
    expired
}
