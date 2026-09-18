use super::{appearance::ChatAppearance, images::ChatImageSource, state::NativeChatView};
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnimationExt as _, AnyElement, Context, InteractiveElement as _, IntoElement,
    ParentElement as _, StatefulInteractiveElement as _, Styled as _, StyledImage as _, div, img,
    px,
};
use serde_json::{Value, json};

/// Side of a thumbnail tile, matching React's `h-12 w-12` previews.
const TILE_PX: f32 = 48.0;

impl NativeChatView {
    /// Drops the markdown reference this tile stands for, through the shared removal rule.
    fn remove_composer_attachment(
        &mut self,
        range: std::ops::Range<usize>,
        cx: &mut Context<Self>,
    ) {
        let start = self.draft[..range.start].encode_utf16().count();
        let end = self.draft[..range.end].encode_utf16().count();
        self.invoke(
            json!({"type":"removeAttachment","text":self.draft,"start":start,"end":end}),
            cx,
        );
    }

    /// The composer's pasted and dropped image thumbnails, with the uploading tile React shows.
    ///
    /// CDXC:SessionChat 2026-09-18 SEE-ALSO:
    /// The tiles come from the same `[Image #N](path)` references the composer already paints as
    /// pills (`composer_references.rs`), so a reference the user deletes by hand drops its tile too.
    pub(super) fn render_attachment_previews(
        &mut self,
        p: &ChatAppearance,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let s = p.scale;
        let pending = self.snapshot["pendingAttachments"].as_u64().unwrap_or(0);
        let attachments: Vec<_> = self
            .composer_references
            .iter()
            .filter(|reference| reference.kind == "image")
            .map(|reference| (reference.range.clone(), reference.path.clone()))
            .collect();
        if attachments.is_empty() && pending == 0 {
            return None;
        }
        // The viewer reads the same projected shape a transcript picture uses (`images.rs`), so a
        // pasted image reaches it through the session's transport instead of a local file read.
        let images: Vec<Value> = attachments
            .iter()
            .map(|(_, path)| json!({"transport":"read","path":path,"label":path,"alt":"Pasted image"}))
            .collect();
        // React's `flex flex-wrap items-center gap-2 pb-2`: separate rounded chips with a real gap
        // between them, never one fused strip.
        let mut row = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(8.0 * s))
            .pb(px(8.0 * s));
        for (index, (range, path)) in attachments.into_iter().enumerate() {
            let removed = range.clone();
            let source = self.chat_image(&images[index], cx);
            let open = images.clone();
            row = row.child(
                div()
                    .relative()
                    .flex_shrink_0()
                    .size(px(TILE_PX * s))
                    .child(
                        div()
                            .id(("chat-attachment", index))
                            .role(gpui::Role::Button)
                            .aria_label("View pasted image")
                            .cursor_pointer()
                            .size_full()
                            .rounded(px(8.0 * s))
                            .overflow_hidden()
                            .border_1()
                            .border_color(p.input_border)
                            .tooltip(move |window, cx| {
                                gpui_component::tooltip::Tooltip::new(path.clone())
                                    .build(window, cx)
                            })
                            .when_some(
                                match source {
                                    ChatImageSource::Bytes(bytes) => Some(img(bytes)),
                                    ChatImageSource::Uri(url) => Some(img(url)),
                                    _ => None,
                                },
                                |tile, image| {
                                    tile.child(image.size_full().object_fit(gpui::ObjectFit::Cover))
                                },
                            )
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.open_image_viewer(open.clone(), index, cx)
                            })),
                    )
                    .child(
                        div()
                            .id(("chat-attachment-remove", index))
                            .role(gpui::Role::Button)
                            .aria_label("Remove image")
                            .absolute()
                            .top(px(-5.0 * s))
                            .right(px(-5.0 * s))
                            .cursor_pointer()
                            .size(px(16.0 * s))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded_full()
                            .border_1()
                            .border_color(p.input_border)
                            .bg(p.card_background)
                            .hover(|style| style.bg(p.border))
                            .child(
                                gpui::svg()
                                    .path("titlebar/x.svg")
                                    .size(px(9.0 * s))
                                    .text_color(p.muted),
                            )
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.remove_composer_attachment(removed.clone(), cx)
                            })),
                    ),
            );
        }
        if pending > 0 {
            row = row.child(
                div()
                    .flex_shrink_0()
                    .size(px(TILE_PX * s))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(8.0 * s))
                    .border_dashed()
                    .border_1()
                    .border_color(p.input_border)
                    .child(
                        gpui::svg()
                            .path("titlebar/loader2.svg")
                            .size(px(16.0 * s))
                            .text_color(p.muted)
                            .with_animation(
                                "chat-attachment-spinner",
                                gpui::Animation::new(std::time::Duration::from_millis(900))
                                    .repeat(),
                                |svg, delta| {
                                    svg.with_transformation(gpui::Transformation::rotate(
                                        gpui::radians(delta * std::f32::consts::TAU),
                                    ))
                                },
                            ),
                    ),
            );
        }
        Some(row.into_any_element())
    }
}
