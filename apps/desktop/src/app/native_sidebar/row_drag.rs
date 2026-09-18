use std::sync::Arc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, FontWeight, Hsla, Image, IntoElement, ParentElement, Pixels, Styled, Window, div,
    img, px,
};

use super::{appearance::SidebarAppearance, model::NativeSidebarSession};
use crate::app::{consts::*, helpers::*};

#[derive(Clone)]
pub(crate) enum RowDragIdentity {
    Project {
        image: Option<Arc<Image>>,
        show_icon: bool,
    },
    Collection {
        color: Hsla,
        background: Hsla,
    },
    Session {
        session: Arc<NativeSidebarSession>,
    },
}

#[derive(Clone)]
pub(crate) struct RowDragPreview {
    pub(crate) identity: RowDragIdentity,
    pub(crate) appearance: SidebarAppearance,
    pub(crate) width: Pixels,
    pub(crate) pointer_x: Pixels,
}

impl RowDragPreview {
    pub(crate) fn render(&self, title: &str, window: &Window) -> AnyElement {
        let appearance = &self.appearance;
        let scale = appearance.scale;
        let session_backing = titlebar_background().blend(gpui::rgb(0xffffff).opacity(0.06).into());
        let row = div()
            .flex()
            .items_center()
            .w(self.width)
            .min_w_0()
            .font_family(".SystemUIFont")
            .font_weight(FontWeight::LIGHT)
            .text_size(px(15.55 * scale))
            .text_color(appearance.foreground);
        let row = match &self.identity {
            RowDragIdentity::Project { image, show_icon } => row
                .h(px(30.0 * scale))
                .px(px(8.0 * scale))
                .gap(px(10.0 * scale))
                .bg(appearance.hover)
                .when(*show_icon, |row| {
                    row.child(match image {
                        Some(image) => img(image.clone())
                            .size(px(16.0 * scale))
                            .flex_shrink_0()
                            .into_any_element(),
                        None => titlebar_svg_icon(
                            TITLEBAR_ICON_FOLDER_OPEN,
                            16.0 * scale,
                            appearance.muted,
                        )
                        .into_any_element(),
                    })
                }),
            RowDragIdentity::Collection { color, background } => row
                .h(px(30.0 * scale))
                .pl(px(5.0 * scale))
                .pr(px(8.0 * scale))
                .gap(px(5.0 * scale))
                .border_l_2()
                .border_color(*color)
                .bg(*background)
                .child(
                    div()
                        .w(px(20.0 * scale))
                        .flex_shrink_0()
                        .flex()
                        .justify_center()
                        .child(titlebar_svg_icon(
                            COMMAND_ICON_CHEVRON_RIGHT,
                            12.0 * scale,
                            appearance.muted,
                        )),
                ),
            RowDragIdentity::Session { session } => row
                .h(px(34.0 * scale))
                .pl(px(5.0 * scale))
                .pr(px(6.0 * scale))
                .gap(px(6.0 * scale))
                .rounded(px(5.0 * scale))
                .bg(session_backing)
                .opacity(0.95)
                .when(session.is_focused, |row| {
                    row.bg(session_backing.blend(appearance.session_selected))
                })
                .when(session.is_visible && !session.is_focused, |row| {
                    row.bg(session_backing.blend(appearance.visible))
                })
                .when(session.is_visible || session.is_focused, |row| {
                    row.text_color(chrome_color(0xd8d8d8, 0x292929))
                })
                .child(
                    div()
                        .size(px(15.0 * scale))
                        .flex_shrink_0()
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(super::icons::session_drag_icon(session, appearance)),
                ),
        };
        let lock_x = !matches!(self.identity, RowDragIdentity::Session { .. });
        div()
            .relative()
            .when(lock_x, |wrapper| {
                wrapper.left(self.pointer_x - window.mouse_position().x)
            })
            .child(
                row.child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .text_ellipsis()
                        .child(title.to_owned()),
                ),
            )
            .into_any_element()
    }
}
