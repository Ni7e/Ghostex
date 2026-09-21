//! The transcript minimap's geometry and its hover previews, ported from
//! `packages/shared/session-chat-presentation/minimap.ts`.
//!
//! CDXC:SessionChat 2026-09-18 SEE-ALSO:
//! One dash per user prompt, in two renderers: packages/core-ui/chat/session-chat-minimap.tsx (with
//! session-chat-minimap.css) and apps/desktop/src/app/native_chat/minimap.rs, which reads the same
//! minimap.json. The rail's `scale` is also written as `--ghostex-chat-minimap-scale` in
//! session-chat-minimap.css; change both together.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// `minimap.json`, the one table both renderers already read. Included rather than ported, the way
/// `docs/2026-09-21/rust-chat/SEAM.md` section 4 requires of the presentation tables.
const GEOMETRY_JSON: &str = include_str!("../../../shared/session-chat-presentation/minimap.json");

/// The rail's dimensions.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinimapGeometry {
    pub minimum_turns: usize,
    pub scale: f64,
    pub spacing: f64,
    pub dash_height: f64,
    pub rail_width: f64,
    pub line_offset: f64,
    pub column_width: f64,
    pub padding_block: f64,
    pub dash_widths: Vec<f64>,
    pub preview_limit: usize,
}

/// `SESSION_CHAT_MINIMAP`.
pub fn geometry() -> MinimapGeometry {
    serde_json::from_str(GEOMETRY_JSON).expect("minimap.json ships with this crate")
}

/// One marker row on the wire: the dash, the transcript row it jumps to, and what the hover
/// preview says.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinimapMarkerRow {
    pub id: String,
    pub item: usize,
    pub prompt: String,
    pub reply: String,
}

/// `sessionChatMinimapPreviewText`: the prompt's own words, on one line.
pub fn minimap_preview_text(message: Option<&Value>) -> String {
    let blocks = message
        .and_then(|message| message.get("blocks"))
        .and_then(Value::as_array);
    let joined = blocks
        .map(|blocks| {
            blocks
                .iter()
                .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
                .map(|block| {
                    block
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string()
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default();
    collapse_whitespace(&joined)
}

/// `sessionChatMinimapPreview`: the same one-line preview, cut to what a hover card can show.
pub fn minimap_preview(message: Option<&Value>, preview_limit: usize) -> String {
    let text = minimap_preview_text(message);
    // The TypeScript slices by UTF-16 code units, which is what a JavaScript string index is.
    let units: Vec<u16> = text.encode_utf16().collect();
    if units.len() <= preview_limit {
        return text;
    }
    let head = String::from_utf16_lossy(&units[..preview_limit]);
    format!("{}\u{2026}", trim_end_js(&head))
}

/// `sessionChatMinimapVisible`: a single prompt has nothing to navigate between, so the rail stays
/// away until there are two.
pub fn minimap_visible(turn_count: usize, minimum_turns: usize) -> bool {
    turn_count >= minimum_turns
}

/// `sessionChatMinimapDashWidth`: dashes grow towards the one the pointer is on.
pub fn minimap_dash_width(distance: i64, widths: &[f64]) -> f64 {
    if widths.is_empty() {
        return 0.0;
    }
    let index = distance.clamp(0, widths.len() as i64 - 1) as usize;
    widths[index]
}

/// `sessionChatMinimapIndexAt`: which dash a pointer at `progress` means.
pub fn minimap_index_at(progress: f64, turn_count: usize) -> i64 {
    let clamped = progress.clamp(0.0, 1.0);
    crate::extras::activity::js_round(clamped * (turn_count as f64 - 1.0)) as i64
}

/// `sessionChatMinimapRailHeight`: one `spacing` step between neighbouring dashes.
pub fn minimap_rail_height(turn_count: usize, spacing: f64) -> f64 {
    (turn_count as f64 - 1.0).max(0.0) * spacing
}

/// `.replace(/\s+/g, ' ').trim()`.
fn collapse_whitespace(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut in_run = false;
    for character in value.chars() {
        if is_js_space(character) {
            if !in_run {
                out.push(' ');
                in_run = true;
            }
        } else {
            out.push(character);
            in_run = false;
        }
    }
    crate::extras::agent_tasks::js_trim(&out).to_string()
}

/// `String.prototype.trimEnd`.
fn trim_end_js(value: &str) -> &str {
    value.trim_end_matches(|character: char| is_js_space(character))
}

/// The `\s` class: Unicode `White_Space` plus the byte order mark.
fn is_js_space(character: char) -> bool {
    character.is_whitespace() || character == '\u{feff}'
}
