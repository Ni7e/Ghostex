//! Ghostex's own prompt queue and the cross-client draft it shares a wire field with.
//!
//! Port of `packages/shared/session-chat-controller/queue.ts`.

use serde::{Deserialize, Serialize};

/// How many rows the strip shows before it scrolls.
///
/// The composer must stay the dominant thing in the footer, so a long queue scrolls rather than
/// pushing the input off the pane.
pub const QUEUE_VISIBLE_ROWS: usize = 5;

/// Long-press duration that turns a Send tap into a queue.
pub const QUEUE_LONG_PRESS_MS: u64 = 500;

/// An identity stays stable across edits; revisions include deletions.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftVersion {
    pub draft_id: String,
    pub revision: i64,
}

/// The unsent composer text as gxserver holds it.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncedDraft {
    /// Text remains recoverable while the terminal owns editing it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parked: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivered_drafts: Option<Vec<DeliveredDraft>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<DraftVersion>,
    /// Durable receipts, retained even after a subsequent draft is saved.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub consumed_drafts: Option<Vec<DraftVersion>>,
    pub content: String,
    /// ISO-8601 millis for display and legacy caches; version orders edits within an identity.
    pub updated_at: String,
    /// Opaque per-client id of the writer, so a client can ignore its own echo.
    pub origin_client_id: String,
}

/// One prompt gxserver already delivered, so the sent-history import runs once.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveredDraft {
    pub id: String,
    pub project_id: String,
    pub session_id: String,
    pub text: String,
    pub delivered_at: String,
}

/// A row is one line. Show the first line that has any content: a prompt that opens with a blank
/// line, a heading, or a fenced block would otherwise render an empty row and look broken.
pub fn queue_row_preview(text: &str) -> String {
    for line in text.split('\n') {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    text.trim().to_string()
}

/// A `sending` row is being delivered by the server scheduler right now. Editing, reordering or
/// deleting it would race the send, so every row control is refused on it.
pub fn is_queue_row_busy(state: &str) -> bool {
    state == "sending"
}

/// Optimistic reorder: the strip shows the new order on drop, and the authoritative queue from the
/// mutation's answer replaces it a moment later. Out-of-range indexes return the list untouched
/// rather than failing, because a drop can resolve against a row a state frame just removed.
pub fn move_queue_row<T: Clone>(queue: &[T], from_index: isize, to_index: isize) -> Vec<T> {
    let mut next = queue.to_vec();
    let length = next.len() as isize;
    if from_index == to_index
        || from_index < 0
        || from_index >= length
        || to_index < 0
        || to_index >= length
    {
        return next;
    }
    let moved = next.remove(from_index as usize);
    next.insert(to_index as usize, moved);
    next
}

/// Both capability gates in one place: the daemon must have reported a `queue` array AND this
/// host's transport must implement the method. Anything false hides that control outright instead
/// of offering a button that 404s or silently does nothing.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportQueueMethods {
    pub queue_prompt: bool,
    pub update_queued_prompt: bool,
    pub remove_queued_prompt: bool,
    pub reorder_queue: bool,
    pub send_queued_prompt: bool,
    pub set_draft: bool,
}

/// The capability block the document carries.
pub fn queue_capabilities(
    daemon_supports_queue: bool,
    transport: &TransportQueueMethods,
) -> crate::document::QueueCapabilities {
    let gate = |method: bool| daemon_supports_queue && method;
    crate::document::QueueCapabilities {
        // Editing a row is a remove plus a re-queue, so it needs both endpoints.
        can_edit: gate(transport.remove_queued_prompt) && gate(transport.queue_prompt),
        can_queue: gate(transport.queue_prompt),
        can_remove: gate(transport.remove_queued_prompt),
        can_reorder: gate(transport.reorder_queue),
        can_retry: gate(transport.update_queued_prompt),
        can_send_now: gate(transport.send_queued_prompt),
        // Draft sync is independent of the queue: a daemon can carry drafts while this host has no
        // queue endpoints, and neither hides anything.
        can_sync_draft: transport.set_draft,
        supported: daemon_supports_queue,
    }
}

/// ISO-8601 millis ordering. Unparseable input never counts as newer.
pub fn is_newer_draft_stamp(candidate: &str, reference: Option<&str>) -> bool {
    let Some(at) = parse_iso_millis(candidate) else {
        return false;
    };
    let Some(reference) = reference else {
        return true;
    };
    match parse_iso_millis(reference) {
        None => true,
        Some(reference_at) => at > reference_at,
    }
}

/// `Date.parse` for the ISO-8601 stamps gxserver writes.
///
/// Only the shape gxserver produces is accepted (`YYYY-MM-DDTHH:MM:SS[.sss]Z` and the same with a
/// numeric offset); anything else answers `None`, which is what `Number.isNaN(Date.parse(...))`
/// means at every call site here.
pub fn parse_iso_millis(value: &str) -> Option<i64> {
    let bytes = value.as_bytes();
    if bytes.len() < 19 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    if bytes[10] != b'T' && bytes[10] != b't' && bytes[10] != b' ' {
        return None;
    }
    let year: i64 = value.get(0..4)?.parse().ok()?;
    let month: i64 = value.get(5..7)?.parse().ok()?;
    let day: i64 = value.get(8..10)?.parse().ok()?;
    let hour: i64 = value.get(11..13)?.parse().ok()?;
    let minute: i64 = value.get(14..16)?.parse().ok()?;
    let second: i64 = value.get(17..19)?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let mut rest = &value[19..];
    let mut millis = 0_i64;
    if let Some(fraction) = rest.strip_prefix('.') {
        let digits: String = fraction.chars().take_while(char::is_ascii_digit).collect();
        if digits.is_empty() {
            return None;
        }
        let padded = format!("{digits:0<3}");
        millis = padded.get(0..3)?.parse().ok()?;
        rest = &rest[1 + digits.len()..];
    }
    let offset_minutes = if rest.is_empty() || rest == "Z" || rest == "z" {
        0
    } else {
        let sign = match rest.as_bytes().first() {
            Some(b'+') => 1,
            Some(b'-') => -1,
            _ => return None,
        };
        let hours: i64 = rest.get(1..3)?.parse().ok()?;
        let minutes: i64 = match rest.len() {
            5 => rest.get(3..5)?.parse().ok()?,
            6 => rest.get(4..6)?.parse().ok()?,
            _ => return None,
        };
        sign * (hours * 60 + minutes)
    };
    let days = days_from_civil(year, month, day);
    Some(
        ((days * 86_400 + hour * 3_600 + minute * 60 + second - offset_minutes * 60) * 1_000)
            + millis,
    )
}

/// Days since 1970-01-01, from Howard Hinnant's civil-date algorithm.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// Whether the saved-draft bar should offer `incoming`.
///
/// Deliberately conservative: a draft this client wrote is its own echo and never offered;
/// identical content is nothing to offer; and an EMPTY incoming draft is never offered, because
/// "Use" on it would clear the local composer, the exact clobber the whole bar exists to prevent.
/// The caller never applies the result on its own: the bar is shown and the user presses Use.
pub fn should_offer_draft(
    incoming: Option<&SyncedDraft>,
    client_id: &str,
    last_handled_updated_at: Option<&str>,
    composer_text: &str,
    local_version: Option<&DraftVersion>,
) -> bool {
    let Some(incoming) = incoming else {
        return false;
    };
    if incoming.parked == Some(true) || incoming.origin_client_id == client_id {
        return false;
    }
    if let Some(version) = &incoming.version {
        let local_is_current = local_version.is_some_and(|local| {
            local.draft_id == version.draft_id && local.revision >= version.revision
        });
        let consumed = incoming.consumed_drafts.as_ref().is_some_and(|receipts| {
            receipts.iter().any(|receipt| {
                receipt.draft_id == version.draft_id && receipt.revision >= version.revision
            })
        });
        if local_is_current || consumed {
            return false;
        }
    }
    if incoming.content == composer_text || incoming.content.trim().is_empty() {
        return false;
    }
    is_newer_draft_stamp(&incoming.updated_at, last_handled_updated_at)
}

/// Receipts are monotonic even when an older save response follows a newer frame.
pub fn merge_draft_state(current: Option<&SyncedDraft>, incoming: &SyncedDraft) -> SyncedDraft {
    let mut consumed: Vec<(String, i64)> = Vec::new();
    for receipt in current
        .and_then(|draft| draft.consumed_drafts.as_ref())
        .into_iter()
        .flatten()
        .chain(incoming.consumed_drafts.iter().flatten())
    {
        match consumed
            .iter_mut()
            .find(|(draft_id, _)| *draft_id == receipt.draft_id)
        {
            Some(slot) => slot.1 = slot.1.max(receipt.revision),
            None => consumed.push((receipt.draft_id.clone(), receipt.revision.max(0))),
        }
    }
    let keep_current = match (
        current.and_then(|draft| draft.version.as_ref()),
        incoming.version.as_ref(),
    ) {
        (Some(mine), Some(theirs)) => {
            mine.draft_id == theirs.draft_id && mine.revision > theirs.revision
        }
        _ => false,
    };
    let body = if keep_current {
        current.expect("keep_current implies a current draft")
    } else {
        incoming
    };
    let retired = body.version.as_ref().is_some_and(|version| {
        consumed
            .iter()
            .find(|(draft_id, _)| *draft_id == version.draft_id)
            .map(|(_, revision)| *revision)
            .unwrap_or(0)
            >= version.revision
    });
    let mut delivered: Vec<DeliveredDraft> = Vec::new();
    for receipt in current
        .and_then(|draft| draft.delivered_drafts.as_ref())
        .into_iter()
        .flatten()
        .chain(incoming.delivered_drafts.iter().flatten())
    {
        match delivered.iter_mut().find(|held| held.id == receipt.id) {
            Some(slot) => *slot = receipt.clone(),
            None => delivered.push(receipt.clone()),
        }
    }
    delivered.sort_by(|left, right| {
        right
            .delivered_at
            .cmp(&left.delivered_at)
            .then_with(|| right.id.cmp(&left.id))
    });
    delivered.truncate(50);
    SyncedDraft {
        content: if retired {
            String::new()
        } else {
            body.content.clone()
        },
        consumed_drafts: Some(
            consumed
                .into_iter()
                .map(|(draft_id, revision)| DraftVersion { draft_id, revision })
                .collect(),
        ),
        delivered_drafts: Some(delivered),
        ..body.clone()
    }
}
