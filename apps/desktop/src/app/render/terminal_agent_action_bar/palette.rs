//! CDXC:Theming 2026-09-14 DECISION:
//! User: the toolbar below agent terminals must look correct in light mode.
//! Resolve its pill, controls and menus from the app appearance, independently of the terminal content theme.

use gpui::Rgba;

use crate::app::helpers::chrome_color;

pub(super) fn terminal_agent_bar_indicator_background() -> Rgba {
    chrome_color(0xe0e0e0, 0xdbeafe)
}

pub(super) fn terminal_agent_bar_icon_color() -> Rgba {
    chrome_color(0xa6a6a6, 0x626874)
}

pub(super) fn terminal_agent_bar_disabled_icon_color() -> Rgba {
    chrome_color(0x5a5a5a, 0xb0b5bd)
}

pub(super) fn terminal_agent_bar_background() -> Rgba {
    chrome_color(0x141414, 0xf4f5f7)
}

pub(super) fn terminal_agent_bar_border_color() -> Rgba {
    chrome_color(0x262626, 0xdedfe3)
}

pub(super) fn terminal_agent_bar_hover_background() -> Rgba {
    chrome_color(0x343434, 0xe5e7eb)
}

pub(super) fn terminal_agent_bar_session_id_color() -> Rgba {
    chrome_color(0x6f6f6f, 0x737985)
}

pub(super) fn terminal_agent_bar_session_id_hover_color() -> Rgba {
    chrome_color(0xc4c4c4, 0x303640)
}

pub(super) fn terminal_agent_bar_accent_background() -> Rgba {
    chrome_color(0xe5e5e5, 0x7db8fb)
}

pub(super) fn terminal_agent_bar_accent_hover_background() -> Rgba {
    chrome_color(0xffffff, 0x68aaf5)
}

pub(super) fn terminal_agent_bar_accent_icon_color() -> Rgba {
    chrome_color(0x111111, 0x173e6b)
}

pub(super) fn terminal_agent_bar_menu_background() -> Rgba {
    chrome_color(0x151515, 0xffffff)
}

pub(super) fn terminal_agent_bar_menu_border() -> Rgba {
    chrome_color(0x2a2a2a, 0xdedfe3)
}

pub(super) fn terminal_agent_bar_menu_separator_color() -> Rgba {
    chrome_color(0x222222, 0xe5e7eb)
}

pub(super) fn terminal_agent_bar_menu_text_color() -> Rgba {
    chrome_color(0xd6d6d6, 0x303640)
}
