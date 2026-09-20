// C1 wave-4 re-cluster: further split out of app/render.rs (~7,340
// lines, itself moved verbatim out of main.rs) into descriptively named
// modules; pure move, no logic changes. Cluster: the view mode switcher, its
// compact dropdown, and the mode tab. The titlebar shell that used to sit here
// moved to app/render/workarea_header/ when the titlebar row was deleted; the
// mode tabs stay here until the view panel's tab strip replaces them.

use gpui::Animation;
use gpui::AnimationExt as _;
use gpui::FontWeight;
use gpui::InteractiveElement as _;
use gpui::IntoElement;
use gpui::MouseButton;
use gpui::MouseDownEvent;
use gpui::ParentElement as _;
use gpui::Styled as _;
use gpui::div;
use gpui::prelude::FluentBuilder as _;
use gpui::px;
use gpui_component::h_flex;
use gpui_component::tooltip::ManagedTooltipExt as _;
use gpui_component::tooltip::ManagedTooltipPlacement;

use crate::app::consts::*;
use crate::app::helpers::*;
use crate::app::model::*;
use crate::*;

impl GhostexGpuiApp {
    pub(crate) fn render_mode_switcher(&self, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        let items = self.titlebar_mode_switcher_items();
        let modes = items.iter().map(|item| item.mode).collect::<Vec<_>>();
        let highlighted_mode = items
            .iter()
            .find(|item| item.is_available && item.mode == self.active_mode)
            .map(|item| item.mode);
        let highlight_state = self.titlebar_mode_highlight.clone();
        let (slide_from, generation, target) = {
            let mut state = highlight_state.borrow_mut();
            let (from, generation) = state.begin_frame(highlighted_mode);
            let target = highlighted_mode.and_then(|mode| state.span_for(mode));
            (from, generation, target)
        };
        let highlight_layer = div()
            .absolute()
            .top(px(TITLEBAR_MODE_TAB_TOP_INSET
                + (TITLEBAR_CONTROL_HEIGHT
                    - TITLEBAR_MODE_TAB_TOP_INSET
                    - TITLEBAR_MODE_TAB_HEIGHT)
                    / 2.0))
            .h(px(TITLEBAR_MODE_TAB_HEIGHT))
            .rounded(px(TITLEBAR_MODE_TAB_RADIUS))
            .bg(titlebar_active_segment_color());
        let highlight_layer = match (target, slide_from) {
            (Some(to), Some(from)) => {
                let state = highlight_state.clone();
                highlight_layer
                    .with_animation(
                        format!("ghostex-gpui-titlebar-mode-highlight-{generation}"),
                        Animation::new(TITLEBAR_MODE_TAB_SLIDE_DURATION)
                            .with_easing(gpui::ease_out_quint()),
                        move |layer, delta| {
                            let span = from.lerp(to, delta);
                            state.borrow_mut().note_painted(span);
                            layer.left(px(span.left)).w(px(span.width))
                        },
                    )
                    .into_any_element()
            }
            (Some(to), None) => highlight_layer
                .left(px(to.left))
                .w(px(to.width))
                .into_any_element(),
            // Keep the child index stable for `record_spans` even before the
            // first prepaint has produced a span to draw.
            (None, _) => div().absolute().size_0().into_any_element(),
        };

        // `on_children_prepainted` lives on `Div`, so it must precede `.id()`.
        let mut switcher = h_flex()
            .on_children_prepainted({
                let state = highlight_state.clone();
                move |children: Vec<gpui::Bounds<gpui::Pixels>>, window, _cx| {
                    let mut state = state.borrow_mut();
                    let had_spans = modes.first().is_some_and(|m| state.span_for(*m).is_some());
                    state.record_spans(&modes, &children);
                    let has_spans = modes.first().is_some_and(|m| state.span_for(*m).is_some());
                    if !had_spans && has_spans {
                        window.request_animation_frame();
                    }
                }
            })
            .id("ghostex-gpui-titlebar-mode-switcher")
            .relative()
            .h(px(TITLEBAR_CONTROL_HEIGHT))
            .pt(px(TITLEBAR_MODE_TAB_TOP_INSET))
            .gap(px(TITLEBAR_MODE_TAB_GAP))
            .items_center()
            .child(highlight_layer);
        for (index, item) in items.into_iter().enumerate() {
            let presentation = match item.mode {
                TitlebarMode::Extension(id) => gpui_extension_view_presentation(id),
                _ => None,
            };
            let label = presentation
                .as_ref()
                .map(|presentation| presentation.title.clone())
                .unwrap_or_else(|| item.mode.display_label().to_string());
            switcher = switcher.child(self.render_mode_tab(
                item.mode,
                label,
                index,
                target.is_some(),
                item.is_available,
                item.disabled_reason,
                cx,
            ));
        }
        switcher
    }

    pub(crate) fn render_compact_mode_dropdown(
        &self,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        let label = match self.active_mode {
            TitlebarMode::Extension(id) => gpui_extension_view_presentation(id)
                .map(|presentation| presentation.title)
                .unwrap_or_else(|| id.as_str().to_string()),
            mode => mode.display_label().to_string(),
        };
        let shortcut = self
            .titlebar_mode_switcher_items()
            .iter()
            .position(|item| item.mode == self.active_mode)
            .and_then(|index| {
                gpui_configured_hotkey_label(&format!("switchTitlebarView{}", index + 1))
            });
        /*
        CDXC:Titlebar 2026-09-19 DECISION:
        User: the compact view dropdown keeps looking like a mode tab, so it
        follows the soft segment (rounded, no hairlines, mode-tab height).
        This supersedes the 2026-09-06 square-with-hairlines wording, which
        only mirrored the tab look of that time.
        */
        h_flex()
            .id("ghostex-gpui-titlebar-compact-mode-dropdown")
            .flex_shrink_0()
            .h(px(TITLEBAR_MODE_TAB_HEIGHT))
            .mt(px(TITLEBAR_MODE_TAB_TOP_INSET))
            .min_w(px(108.0))
            .items_center()
            .justify_center()
            .gap(px(7.0))
            .rounded(px(TITLEBAR_MODE_TAB_RADIUS))
            .px(px(TITLEBAR_MODE_TAB_HORIZONTAL_PADDING))
            .text_size(px(12.5))
            .font_weight(FontWeight::NORMAL)
            .line_height(px(TITLEBAR_MODE_TAB_HEIGHT))
            .text_color(titlebar_active_text_color())
            .cursor_default()
            .hover(|this| this.bg(titlebar_button_hover_color()))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, event: &MouseDownEvent, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                    this.show_gpui_titlebar_mode_menu(event.position, window, cx);
                }),
            )
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(|this, event: &MouseDownEvent, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                    this.show_gpui_titlebar_view_menu(this.active_mode, event.position, window, cx);
                }),
            )
            .when_some(shortcut, |this, shortcut| {
                this.managed_tooltip_with_placement(
                    ManagedTooltipPlacement::Right,
                    move |window, cx| titlebar_tooltip(shortcut.clone(), window, cx),
                )
            })
            .child(label)
            .child(titlebar_svg_icon(
                TITLEBAR_ICON_CHEVRON_DOWN,
                12.0,
                titlebar_icon_color(),
            ))
    }

    pub(crate) fn render_mode_tab(
        &self,
        mode: TitlebarMode,
        label: String,
        position: usize,
        highlight_layer_visible: bool,
        is_available: bool,
        _disabled_reason: Option<&'static str>,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        let is_active = is_available && self.active_mode == mode;
        // The sliding layer paints the active fill; the tab paints it itself
        // only on the first frame, before any span has been captured.
        let paints_own_active_fill = is_active && !highlight_layer_visible;
        // CDXC:Hotkeys 2026-09-09 DECISION:
        // User: hovering a titlebar view shows only its shortcut at its current position, including after reordering.
        let shortcut = gpui_configured_hotkey_label(&format!("switchTitlebarView{}", position + 1));
        /*
        CDXC:Titlebar 2026-07-04-01:00:
        Disabled Quick/projectless tabs remain normal titlebar segments with a hover reason and no separate hit target. Browser, Kanban, Automate, and Docs share the native disabled reason while click handling still calls the central availability guard before changing active workspace mode.
        */
        div()
            .id(format!(
                "ghostex-gpui-titlebar-mode-{}",
                mode.element_slug()
            ))
            .relative()
            .flex()
            .h(px(TITLEBAR_MODE_TAB_HEIGHT))
            .items_center()
            .justify_center()
            .rounded(px(TITLEBAR_MODE_TAB_RADIUS))
            .px(px(TITLEBAR_MODE_TAB_HORIZONTAL_PADDING))
            .text_size(px(13.55))
            .font_weight(FontWeight::NORMAL)
            .line_height(px(TITLEBAR_MODE_TAB_HEIGHT))
            .text_color(if !is_available {
                titlebar_disabled_text_color()
            } else if is_active {
                titlebar_active_text_color()
            } else {
                titlebar_inactive_text_color()
            })
            .cursor_default()
            .when(paints_own_active_fill, |this| {
                this.bg(titlebar_active_segment_color())
            })
            .when(!is_available, |this| {
                this.bg(titlebar_disabled_segment_color())
            })
            .hover(move |this| {
                if !is_available {
                    return this;
                }
                let this = this.text_color(titlebar_active_text_color());
                if is_active {
                    this
                } else {
                    this.bg(titlebar_button_hover_color())
                }
            })
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, _event: &gpui::MouseDownEvent, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                    if is_available && this.set_active_mode(mode, window, cx) {
                        cx.notify();
                    }
                }),
            )
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                    if let TitlebarMode::Extension(id) = mode {
                        if gpui_custom_view(id)
                            .is_some_and(|view| view.definition.get("source").is_some())
                        {
                            this.show_project_view_menu(id, event.position, window, cx);
                            return;
                        }
                    }
                    this.show_gpui_titlebar_view_menu(mode, event.position, window, cx);
                }),
            )
            .when_some(shortcut, |this, shortcut| {
                this.managed_tooltip_with_placement(
                    ManagedTooltipPlacement::Right,
                    move |window, cx| titlebar_tooltip(shortcut.clone(), window, cx),
                )
            })
            .child(label)
    }
}
