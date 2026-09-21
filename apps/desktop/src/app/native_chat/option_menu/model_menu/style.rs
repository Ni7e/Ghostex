use super::super::super::appearance::ChatAppearance;
use gpui::{Hsla, rgb};

pub(super) const CARD_WIDTH: f32 = 304.0;
pub(super) const FLYOUT_WIDTH: f32 = 232.0;
pub(super) const CARD_RADIUS: f32 = 12.0;
pub(super) const ITEM_RADIUS: f32 = 8.0;
pub(super) const BAR_HEIGHT: f32 = 40.0;
/// The model list keeps one height whatever the tab holds, so switching tabs never moves the card.
pub(super) const LIST_HEIGHT: f32 = 216.0;
pub(super) const TRAIT_ROW_HEIGHT: f32 = 30.0;
pub(super) const ROW_GAP: f32 = 2.0;
pub(super) const ERROR_HEIGHT: f32 = 58.0;

/// The picker's tones, from the same two surfaces the chat's other menus use.
pub(super) struct Palette {
    pub(super) text: Hsla,
    pub(super) muted: Hsla,
    pub(super) surface: Hsla,
    pub(super) border: Hsla,
    pub(super) accent: Hsla,
    pub(super) star: Hsla,
    ink: Hsla,
}

impl Palette {
    pub(super) fn new(appearance: &ChatAppearance) -> Self {
        let light = appearance.light;
        let text: Hsla = rgb(if light { 0x292929 } else { 0xfcfcfc }).into();
        let ink: Hsla = rgb(if light { 0x000000 } else { 0xffffff }).into();
        Self {
            text,
            muted: text.opacity(0.64),
            surface: rgb(if light { 0xffffff } else { 0x191919 }).into(),
            border: ink.opacity(0.12),
            accent: appearance.control_primary,
            star: rgb(if light { 0xd97706 } else { 0xfbbf24 }).into(),
            ink,
        }
    }

    /// A wash of the surface's contrast colour: hairlines, hover and selection fills.
    pub(super) fn ink(&self, alpha: f32) -> Hsla {
        self.ink.opacity(alpha)
    }
}
