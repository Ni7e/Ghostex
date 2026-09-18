use super::{appearance::ChatAppearance, markdown_links, state::NativeChatView};
use gpui::Context;
use gpui_component::input::InlineReplacement;
use serde_json::{Value, json};
use std::{ops::Range, time::Duration};

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

impl NativeChatView {
    /// Keep the composer input's reference pills in step with the draft it is about to paint.
    ///
    /// The shared parser answers in the same call, so a pill appears with the keystroke that
    /// completed it instead of a frame later.
    pub(super) fn sync_composer_references(
        &mut self,
        appearance: &ChatAppearance,
        cx: &mut Context<Self>,
    ) {
        if self.composer_reference_draft.as_deref() != Some(self.draft.as_str()) {
            let draft = self.draft.clone();
            let parsed = self.runtime.as_mut().and_then(|runtime| {
                runtime
                    .query("composerReferences", &[Value::String(draft.clone())])
                    .ok()
            });
            self.composer_references = parsed
                .map(|parsed| parse(&draft, &parsed))
                .unwrap_or_default();
            self.composer_reference_draft = Some(draft);
        }
        let replacements = replacements(&self.composer_references, appearance);
        if let Some(input) = self.input.clone() {
            input.update(cx, |input, cx| {
                input.set_inline_replacements(replacements, cx)
            });
        }
    }

    /// Handle a press on a composer reference pill. Returns whether one was hit.
    pub(super) fn click_composer_reference(
        &mut self,
        event: &gpui::MouseDownEvent,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(input) = self.input.clone() else {
            return false;
        };
        let Some(range) = input.read(cx).inline_replacement_at(event.position) else {
            return false;
        };
        let Some(reference) = self
            .composer_references
            .iter()
            .find(|reference| reference.range == range)
            .cloned()
        else {
            return false;
        };
        self.composer_reference_click += 1;
        if event.click_count >= 2 {
            self.composer_reference_task = None;
            if let Some((draft, caret)) = revealed(&self.draft, &reference) {
                self.insert_prompt(&draft, cx);
                self.input_caret = Some(caret);
            }
            return true;
        }
        if reference.kind == "url" {
            return true;
        }
        // CDXC:SessionChat 2026-09-18 DECISION:
        // User (2026-09-16, React composer): a file pill opens on one click through the
        // transcript's Code/Docs flow. Opening waits out the double-click window so the view
        // cannot swallow the second click that expands the reference source.
        let click = self.composer_reference_click;
        let href = reference.path.clone();
        self.composer_reference_task = Some(cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(Duration::from_millis(500))
                .await;
            let _ = this.update(cx, |this, cx| {
                if this.composer_reference_click != click {
                    return;
                }
                this.composer_reference_task = None;
                this.invoke(
                    json!({"type":"openMarkdownLink","href":href,"external":false}),
                    cx,
                );
            });
        }));
        true
    }
}
