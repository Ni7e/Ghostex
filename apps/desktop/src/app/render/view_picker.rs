//! The view panel with no view in it: a card per view the project could open, grouped built-ins,
//! then your views and extensions, then the Ghostex pages.

use gpui::AnyElement;
use gpui::FontWeight;
use gpui::InteractiveElement as _;
use gpui::IntoElement;
use gpui::MouseButton;
use gpui::MouseDownEvent;
use gpui::ParentElement as _;
use gpui::Styled as _;
use gpui::Window;
use gpui::div;
use gpui::prelude::FluentBuilder as _;
use gpui::px;
use gpui_component::h_flex;
use gpui_component::v_flex;

use crate::app::consts::*;
use crate::app::helpers::*;
use crate::app::model::*;
use crate::*;

/// Which of the picker's three groups a view belongs to. Ruling 13: the picker lists everything, so
/// the groups are only how it is read, never what it leaves out.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ViewPickerGroup {
    BuiltIn,
    Extension,
    Ghostex,
}

impl ViewPickerGroup {
    fn of(mode: TitlebarMode) -> Self {
        match mode {
            TitlebarMode::Extension(_) => Self::Extension,
            TitlebarMode::Ghostex(_) => Self::Ghostex,
            _ => Self::BuiltIn,
        }
    }

    /// The label above the group, or nothing for the built-ins, which open the list.
    fn label(self) -> Option<&'static str> {
        match self {
            Self::BuiltIn => None,
            Self::Extension => Some("YOUR VIEWS AND EXTENSIONS"),
            Self::Ghostex => Some("GHOSTEX"),
        }
    }
}

/// One line under a view's name in the picker. Built-ins say what the view is for in the product's
/// own words; an extension or custom view has no description of its own to show.
fn view_picker_description(mode: TitlebarMode) -> &'static str {
    match mode {
        TitlebarMode::Source => "Edit and search the project in the built-in editor.",
        TitlebarMode::Browser => "Open a local app or any website.",
        TitlebarMode::Kanban => "Plan work and track task progress.",
        TitlebarMode::Automate => "Run repeatable project routines.",
        TitlebarMode::Manage => "Notes, plans and reference files.",
        TitlebarMode::Ghostex(page) => page.description(),
        TitlebarMode::Extension(_) | TitlebarMode::Agents => "",
    }
}

impl GhostexGpuiApp {
    /// CDXC:Workarea 2026-09-20 DECISION:
    /// User (screen 02, ruling 13): with the panel open and nothing selected, it shows a picker of
    /// every view this project can open — built-ins, then your views and extensions, then the
    /// Ghostex pages — with single-letter shortcuts while it has focus and a link to the Settings
    /// scope editor at the bottom. Only views the project's own scope hides are missing from it.
    pub(crate) fn render_view_picker(&mut self, cx: &mut gpui::Context<Self>) -> AnyElement {
        let modes = self.view_picker_entries();
        let mut groups: Vec<(ViewPickerGroup, Vec<TitlebarModeSwitcherItem>)> = Vec::new();
        for item in modes {
            let group = ViewPickerGroup::of(item.mode);
            match groups.last_mut() {
                Some((last, items)) if *last == group => items.push(item),
                _ => groups.push((group, vec![item])),
            }
        }
        let mut body = v_flex()
            .w_full()
            .max_w(px(VIEW_PICKER_CONTENT_WIDTH))
            .items_center()
            .child(
                div()
                    .text_size(px(15.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(titlebar_active_text_color())
                    .child("Open a view"),
            )
            .child(
                div()
                    .mt(px(4.0))
                    .mb(px(14.0))
                    .text_size(px(12.5))
                    .text_color(titlebar_inactive_text_color())
                    .child(
                        "Views belong to this project, so they stay put when you switch sessions.",
                    ),
            );
        for (group, items) in groups {
            if let Some(label) = group.label() {
                body = body.child(
                    div()
                        .w_full()
                        .mt(px(12.0))
                        .mb(px(6.0))
                        .text_size(px(11.0))
                        .text_color(titlebar_disabled_text_color())
                        .child(label),
                );
            }
            for pair in items.chunks(2) {
                let mut row = h_flex()
                    .w_full()
                    .mb(px(VIEW_PICKER_CARD_GAP))
                    .items_stretch()
                    .gap(px(VIEW_PICKER_CARD_GAP));
                for item in pair {
                    row = row.child(self.render_view_picker_card(*item, cx));
                }
                if pair.len() == 1 {
                    // The odd card keeps its column instead of stretching across both.
                    row = row.child(div().flex_1().min_w_0());
                }
                body = body.child(row);
            }
        }
        v_flex()
            .id("ghostex-gpui-view-picker")
            .size_full()
            .min_w_0()
            .min_h_0()
            .items_center()
            .justify_center()
            .overflow_y_scroll()
            .track_scroll(&self.view_picker_scroll)
            .p(px(24.0))
            .bg(project_editor_shell_background_color())
            .font_family("Inter Variable")
            .text_color(titlebar_text_color())
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, _event: &MouseDownEvent, _window, cx| {
                    this.focus_view_picker(cx);
                }),
            )
            .child(body)
            .child(self.render_view_picker_manage_link(cx))
            .into_any_element()
    }

    /// Every view the picker offers: the scoped list, minus `Agents`, which is the panel being
    /// closed rather than a view.
    pub(crate) fn view_picker_entries(&self) -> Vec<TitlebarModeSwitcherItem> {
        self.titlebar_mode_switcher_items()
            .into_iter()
            .filter(|item| item.mode != TitlebarMode::Agents)
            .collect()
    }

    fn render_view_picker_card(
        &self,
        item: TitlebarModeSwitcherItem,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        let mode = item.mode;
        let available = item.is_available;
        let description = view_picker_description(mode);
        let shortcut = view_picker_shortcut(mode);
        let dashed = matches!(mode, TitlebarMode::Extension(_));
        div()
            .id(format!(
                "ghostex-gpui-view-picker-card-{}",
                mode.element_slug()
            ))
            .relative()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .gap(px(3.0))
            .px(px(14.0))
            .py(px(12.0))
            .rounded(px(12.0))
            .border_1()
            .when(dashed, |this| this.border_dashed())
            .border_color(workspace_pane_border_color())
            .bg(titlebar_popup_menu_background())
            .cursor_default()
            .when(!available, |this| this.opacity(0.5))
            .when(available, |this| {
                this.hover(|this| this.bg(titlebar_active_segment_color()))
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, _event: &MouseDownEvent, window, cx| {
                            window.prevent_default();
                            cx.stop_propagation();
                            this.open_view_tab(mode, window, cx);
                        }),
                    )
            })
            .child(
                h_flex()
                    .w_full()
                    .min_w_0()
                    .items_center()
                    .gap(px(8.0))
                    .child(titlebar_svg_icon(
                        mode.tab_icon(),
                        15.0,
                        titlebar_icon_color(),
                    ))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .overflow_hidden()
                            .whitespace_nowrap()
                            .text_ellipsis()
                            .text_size(px(13.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(titlebar_active_text_color())
                            .child(mode.tab_label()),
                    ),
            )
            .when(!description.is_empty(), |this| {
                this.child(
                    div()
                        .text_size(px(12.0))
                        .line_height(px(16.0))
                        .text_color(titlebar_inactive_text_color())
                        .child(description),
                )
            })
            .when_some(item.disabled_reason, |this, reason| {
                this.child(
                    div()
                        .text_size(px(12.0))
                        .line_height(px(16.0))
                        .text_color(titlebar_disabled_text_color())
                        .child(reason),
                )
            })
            .when_some(shortcut, |this, shortcut| {
                this.child(
                    div()
                        .absolute()
                        .top(px(12.0))
                        .right(px(12.0))
                        .text_size(px(11.0))
                        .font_family(ACCOUNT_INDICATOR_FONT_FAMILY)
                        .text_color(titlebar_disabled_text_color())
                        .child(shortcut.to_string()),
                )
            })
    }

    fn render_view_picker_manage_link(&self, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        div()
            .id("ghostex-gpui-view-picker-manage")
            .mt(px(14.0))
            .text_size(px(12.0))
            .text_color(titlebar_inactive_text_color())
            .cursor_default()
            .hover(|this| this.text_color(titlebar_active_text_color()))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, _event: &MouseDownEvent, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                    this.open_gpui_settings_extensions_page(Some(window), cx);
                }),
            )
            .child("Manage views and where they appear…")
    }

    /// CDXC:Hotkeys 2026-09-20 DECISION:
    /// User (screen 02): single-letter shortcuts open a view while the picker has focus. They are
    /// only live there, so they cannot collide with anything typed in a terminal, a chat or a page.
    pub(crate) fn open_view_from_view_picker_keystroke(
        &mut self,
        keystroke: &gpui::Keystroke,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        if !self.view_picker_open()
            || self.shell_focus != ShellFocusTarget::ProjectEditorSurface(TitlebarMode::Agents)
        {
            return false;
        }
        let modifiers = keystroke.modifiers;
        if modifiers.control || modifiers.alt || modifiers.platform || modifiers.function {
            return false;
        }
        let Some(letter) = keystroke
            .key
            .chars()
            .next()
            .filter(|_| keystroke.key.chars().count() == 1)
            .map(|letter| letter.to_ascii_uppercase())
        else {
            return false;
        };
        let Some(mode) = self
            .view_picker_entries()
            .into_iter()
            .find(|item| item.is_available && view_picker_shortcut(item.mode) == Some(letter))
            .map(|item| item.mode)
        else {
            return false;
        };
        self.open_view_tab(mode, window, cx)
    }
}

/// The letter a built-in view answers to in the picker. Extension, custom and Ghostex views have
/// none, because their names are not the app's to reserve a key for.
fn view_picker_shortcut(mode: TitlebarMode) -> Option<char> {
    match mode {
        TitlebarMode::Source => Some('C'),
        TitlebarMode::Browser => Some('B'),
        TitlebarMode::Kanban => Some('K'),
        TitlebarMode::Automate => Some('U'),
        TitlebarMode::Manage => Some('D'),
        TitlebarMode::Agents | TitlebarMode::Extension(_) | TitlebarMode::Ghostex(_) => None,
    }
}
