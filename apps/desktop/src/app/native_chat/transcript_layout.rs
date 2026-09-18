use serde::Deserialize;
use std::sync::LazyLock;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TranscriptLayout {
    pub end_padding: f32,
}

/// CDXC:SessionChat 2026-09-18 SEE-ALSO:
/// React's message-scroller-content reserves this space in addition to row padding and the composer inset; the native list reserves it on its last row.
pub(super) static LAYOUT: LazyLock<TranscriptLayout> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../../../../packages/shared/session-chat-presentation/transcript-layout.json"
    ))
    .expect("shared transcript layout")
});
