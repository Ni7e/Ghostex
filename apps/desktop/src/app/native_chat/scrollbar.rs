//! The transcript's own scrollbar.
//!
//! gpui-component's `Scrollbar` already implements `ScrollbarHandle` for gpui's
//! `ListState`, so the chat list needs no hand-rolled thumb: the component reads
//! the list's offset and content size, drags it through
//! `set_offset_from_scrollbar`, and brackets the drag with the list's own
//! `scrollbar_drag_started` / `scrollbar_drag_ended`. It also already carries
//! the app's exact thumb colors (`apply_gpui_component_theme` in
//! app/helpers/titlebar.rs, shared with packages/components/ui/scrollbar-theme.css),
//! so only the 5px thickness from React's session-chat-scrollbar.css is set here.
//!
//! Its mouse handling is scoped to the thumb strip, so it never takes a click,
//! a drag or a selection away from the transcript underneath it.

use super::{appearance::ChatAppearance, state::NativeChatView};
use gpui::{AnyElement, IntoElement as _, px};
use gpui_component::scroll::{Scrollbar, ScrollbarShow};

/// Unscaled track and thumb width, the value in session-chat-scrollbar.css.
const THICKNESS: f32 = 5.0;

impl NativeChatView {
    /// The thin thumb beside the transcript: it fades in while the list scrolls
    /// or the pointer is on it, fades out when the reader stops, and drags.
    pub(super) fn transcript_scrollbar(&self, p: &ChatAppearance) -> AnyElement {
        Scrollbar::vertical(&self.list)
            .id("chat-transcript-scrollbar")
            .thickness(px(THICKNESS * p.scale))
            .scrollbar_show(ScrollbarShow::Scrolling)
            .into_any_element()
    }
}
