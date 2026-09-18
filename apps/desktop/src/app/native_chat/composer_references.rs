use super::{appearance::ChatAppearance, markdown_links};
use gpui_component::input::InlineReplacement;
use serde_json::Value;
use std::ops::Range;

/// `0.1rem`, the distance the chat stylesheet puts between a composer pill's left edge and its
/// icon. The composer's own `1em` is `14 * scale`, matching `Input::text_size` in `composer.rs`.
const ICON_INSET_REM: f32 = 0.1;
const ROOT_FONT_PX: f32 = 16.0;
const COMPOSER_FONT_PX: f32 = 14.0;

/// One markdown reference in the draft, resolved to the draft's byte offsets.
///
/// CDXC:SessionChat 2026-09-18 SEE-ALSO:
/// The rules live in `packages/shared/session-chat-presentation/reference-pills.ts` and reach this
/// file through `nativeChat.composerReferences`; the input side is
/// `.dependencies/gpui-component/crates/ui/src/input/inline_replacement.rs`.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct ComposerReference {
    /// Byte range of `[label](path)` inside the draft.
    pub(super) range: Range<usize>,
    pub(super) kind: String,
    pub(super) path: String,
    /// The visible text, already padded for the icon and truncated to the shared label width.
    pub(super) pill: String,
}

/// Byte offset of every UTF-16 code-unit boundary in `draft`, so JS string indices land on chars.
fn utf16_boundaries(draft: &str) -> Vec<(usize, usize)> {
    let mut boundaries = Vec::with_capacity(draft.len() + 1);
    let mut utf16 = 0;
    for (byte, character) in draft.char_indices() {
        boundaries.push((utf16, byte));
        utf16 += character.len_utf16();
    }
    boundaries.push((utf16, draft.len()));
    boundaries
}

fn byte_offset(boundaries: &[(usize, usize)], utf16: usize) -> Option<usize> {
    boundaries
        .binary_search_by_key(&utf16, |(units, _)| *units)
        .ok()
        .map(|index| boundaries[index].1)
}

/// Decode the shared parser's answer for `draft`.
pub(super) fn parse(draft: &str, parsed: &Value) -> Vec<ComposerReference> {
    let boundaries = utf16_boundaries(draft);
    parsed
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|reference| {
            let start = byte_offset(&boundaries, reference["start"].as_u64()? as usize)?;
            let end = byte_offset(&boundaries, reference["end"].as_u64()? as usize)?;
            (start < end).then_some(ComposerReference {
                range: start..end,
                kind: reference["kind"].as_str()?.to_owned(),
                path: reference["path"].as_str()?.to_owned(),
                pill: reference["pill"].as_str()?.to_owned(),
            })
        })
        .collect()
}

/// Turn the draft's references into the input's display projection.
pub(super) fn replacements(
    references: &[ComposerReference],
    appearance: &ChatAppearance,
) -> Vec<InlineReplacement> {
    references
        .iter()
        .filter_map(|reference| {
            let color = markdown_links::composer_color(&reference.kind, appearance)?;
            Some(
                InlineReplacement::new(reference.range.clone(), reference.pill.clone())
                    .color(color)
                    .icon(
                        format!("chat-references/{}.svg", reference.kind),
                        gpui::px(
                            COMPOSER_FONT_PX * appearance.scale * markdown_links::VISUAL.icon_em,
                        ),
                        gpui::px(ICON_INSET_REM * ROOT_FONT_PX * appearance.scale),
                    ),
            )
        })
        .collect()
}

/// The draft with `·` inserted before the reference's destination, and the caret that follows it.
///
/// CDXC:SessionChat 2026-09-18 DECISION:
/// User (2026-09-09, React composer): a double click expands a pill back into its editable
/// markdown source. The marker suppresses the pill so the same text stays visible while it is
/// edited, and it is stripped again on send.
pub(super) fn revealed(draft: &str, reference: &ComposerReference) -> Option<(String, usize)> {
    let source = draft.get(reference.range.clone())?;
    let label_end = source.find("](")?;
    let split = reference.range.start + label_end;
    let mut next = String::with_capacity(draft.len() + 2);
    next.push_str(&draft[..split]);
    next.push('\u{b7}');
    next.push_str(&draft[split..]);
    let caret = next[..split + '\u{b7}'.len_utf8()].encode_utf16().count();
    Some((next, caret))
}
