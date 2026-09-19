// C1 wave-4 re-cluster: further split out of app/render.rs (~7,340
// lines, itself moved verbatim out of main.rs) into descriptively named
// modules; pure move, no logic changes. Cluster: titlebar shell (project slot, sidebar collapse, mode switcher/dropdown, mode tab) and the cross-platform titlebar double-click zoom action.

use gpui::Animation;
use gpui::AnimationExt as _;
use gpui::FontWeight;
use gpui::InteractiveElement as _;
use gpui::IntoElement;
use gpui::MouseButton;
use gpui::MouseDownEvent;
use gpui::ObjectFit;
use gpui::ParentElement as _;
use gpui::StatefulInteractiveElement as _;
use gpui::Styled as _;
use gpui::StyledImage as _;
use gpui::Window;
use gpui::WindowControlArea;
use gpui::div;
use gpui::img;
use gpui::prelude::FluentBuilder as _;
use gpui::px;
use gpui_component::h_flex;
use gpui_component::tooltip::ManagedTooltipExt as _;
use gpui_component::tooltip::ManagedTooltipPlacement;

use crate::app::consts::*;
use crate::app::helpers::*;
use crate::app::model::*;
use crate::*;

/*
CDXC:Titlebar 2026-08-23:
GPUI paints the whole titlebar strip itself, so AppKit's own titlebar view
never sees a double click there and the standard macOS zoom gesture silently
did nothing. Forward it to the platform window, which honours the user's
NSGlobalDomain AppleActionOnDoubleClick preference (Maximize/Fill/Minimize/
Do Nothing). Linux compositors leave the same gesture to the client, so zoom
directly there; Windows already resolves it from the WindowControlArea::Drag
hit test in the platform layer.
*/
#[cfg(target_os = "macos")]
fn gpui_titlebar_double_click_window_action(window: &Window) {
    window.titlebar_double_click();
}

#[cfg(target_os = "linux")]
fn gpui_titlebar_double_click_window_action(window: &Window) {
    window.zoom_window();
}

#[cfg(target_os = "windows")]
fn gpui_titlebar_double_click_window_action(_window: &Window) {}

#[cfg(target_os = "linux")]
struct GpuiLinuxTitlebarDragState {
    should_move: bool,
}

fn titlebar_panel_toggle_button(
    id: &'static str,
    icon: &'static str,
    size_reduction: f32,
    enabled: bool,
) -> gpui::Stateful<gpui::Div> {
    let button = div()
        .id(id)
        .relative()
        .flex()
        .flex_shrink_0()
        .h(px(TITLEBAR_CONTROL_HEIGHT - size_reduction))
        .items_center()
        .justify_center()
        .cursor_default()
        .when(enabled, |this| {
            this.hover(|this| this.bg(titlebar_button_hover_color()))
        });
    #[cfg(target_os = "macos")]
    let button = button.px(px(TITLEBAR_BUTTON_HORIZONTAL_PADDING)).child(
        div()
            .flex()
            .ml(px(TITLEBAR_SIDEBAR_COLLAPSE_ICON_LEFT_OFFSET))
            .mt(px(TITLEBAR_SIDEBAR_COLLAPSE_ICON_TOP_OFFSET))
            .items_center()
            .justify_center()
            .child(titlebar_svg_icon(
                icon,
                TITLEBAR_SIDEBAR_COLLAPSE_ICON_SIZE - size_reduction,
                if enabled {
                    titlebar_active_text_color()
                } else {
                    titlebar_disabled_text_color()
                },
            )),
    );
    #[cfg(not(target_os = "macos"))]
    let button = button
        .w(px(TITLEBAR_BUTTON_WIDTH - size_reduction))
        .border_r_1()
        .border_color(titlebar_button_border_color())
        .child(titlebar_svg_icon(
            icon,
            TITLEBAR_SIDEBAR_COLLAPSE_ICON_SIZE - size_reduction,
            if enabled {
                titlebar_icon_color()
            } else {
                titlebar_disabled_text_color()
            },
        ));
    button
}

impl GhostexGpuiApp {
    pub(crate) fn render_titlebar(
        &self,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        /*
        CDXC:Titlebar 2026-06-14-16:47:
        The GPUI titlebar mirrors the macOS app: native traffic lights, passive project identity, full-width mode tabs for Agents/Source/Browser/Kanban/Automate/Docs, a compact mode dropdown below 1050px, and right-side icon buttons.

        CDXC:Titlebar 2026-07-04-01:00:
        Quick/projectless GPUI contexts keep Agents and Source selectable, keep Browser, Kanban, Automate, and Docs visible but disabled, and use the same availability helper for tabs, the compact dropdown, hotkeys, restore, and persistence.

        CDXC:Titlebar 2026-06-22-19:39:
        The GPUI titlebar must match the current macOS titlebar chrome: the sidebar toggle is a flat Tabler layout-sidebar glyph instead of the older blue circular chevron, and the right controls are the same project/window actions as macOS: Tips, Resources, Git, Actions, and Open In. Settings and Keep Awake live in sidebar shortcut chrome, not this titlebar strip.
        */
        let mode_switcher_items = self.titlebar_mode_switcher_items();
        let show_mode_switcher = !mode_switcher_items.is_empty();
        let extension_mode_width = mode_switcher_items
            .iter()
            .filter_map(|item| {
                let TitlebarMode::Extension(id) = item.mode else {
                    return None;
                };
                let label = gpui_extension_view_presentation(id)
                    .map(|presentation| presentation.title)
                    .unwrap_or_else(|| id.as_str().to_string());
                Some((label.chars().count() as f32 * 7.5 + 28.0).max(70.0))
            })
            .sum::<f32>();
        let use_compact_mode_dropdown = show_mode_switcher
            && window.bounds().size.width.as_f32()
                < TITLEBAR_COMPACT_MODE_WIDTH_THRESHOLD
                    + extension_mode_width
                    + (self.titlebar_accounts.len() as f32 * 58.0)
                        .min(window.bounds().size.width.as_f32() * 0.35);
        let titlebar = div()
            .id("ghostex-gpui-titlebar")
            .relative()
            .flex()
            .items_center()
            .flex_shrink_0()
            .w_full()
            .h(px(TITLEBAR_HEIGHT))
            .bg(titlebar_gradient_fill())
            .border_b_1()
            .border_color(titlebar_button_border_color())
            .text_color(titlebar_text_color())
            .font_family("Inter Variable")
            .line_height(px(TITLEBAR_CONTROL_HEIGHT))
            .window_control_area(WindowControlArea::Drag);

        /*
        X11 does not consume GPUI's WindowControlArea hit boxes, so a
        client-decorated Linux window must hand movement to the window manager
        from the real titlebar element. Wait for pointer movement so ordinary
        clicks and double-click maximize keep their existing behavior.
        */
        #[cfg(target_os = "linux")]
        let titlebar = {
            let drag_state =
                window.use_state(cx, |_, _| GpuiLinuxTitlebarDragState { should_move: false });
            titlebar
                .on_mouse_down_out(
                    window.listener_for(&drag_state, |state, _, _, _| state.should_move = false),
                )
                .on_mouse_down(
                    MouseButton::Left,
                    window.listener_for(&drag_state, |state, _, window, _| {
                        state.should_move = matches!(
                            window.window_decorations(),
                            gpui::Decorations::Client { .. }
                        );
                    }),
                )
                .on_mouse_up(
                    MouseButton::Left,
                    window.listener_for(&drag_state, |state, _, _, _| {
                        state.should_move = false;
                    }),
                )
                .on_mouse_move(window.listener_for(&drag_state, |state, _, window, _| {
                    if state.should_move {
                        state.should_move = false;
                        window.start_window_move();
                    }
                }))
        };

        // CDXC:Titlebar 2026-09-11 DECISION:
        // User: full view buttons stay centered in the window, but the compact dropdown belongs on the left right after the Notifications bell, which follows Next.
        // This supersedes the 2026-09-10 wording that put the compact dropdown immediately after Next; equal side regions still keep the full tabs centered.
        titlebar
            .on_click(|event, window, _cx| {
                if event.click_count() != 2 {
                    return;
                }
                gpui_titlebar_double_click_window_action(window);
            })
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                    this.show_gpui_titlebar_customize_menu(event.position, window, cx);
                }),
            )
            .child(
                h_flex()
                    .id("ghostex-gpui-titlebar-left")
                    .h_full()
                    .flex_1()
                    .min_w_0()
                    .overflow_hidden()
                    .child(self.render_project_slot(use_compact_mode_dropdown, cx)),
            )
            .child(
                h_flex()
                    .h_full()
                    .flex_shrink_0()
                    .items_center()
                    .justify_center()
                    .when(show_mode_switcher && !use_compact_mode_dropdown, |this| {
                        this.child(self.render_mode_switcher(cx))
                    }),
            )
            .child(
                h_flex()
                    .id("ghostex-gpui-titlebar-right")
                    .h_full()
                    .flex_1()
                    .min_w_0()
                    .justify_end()
                    .child(self.render_right_titlebar_controls(window, cx)),
            )
    }

    /// CDXC:Titlebar 2026-09-10 WHY:
    /// The centered titlebar gives the left region a zero flex basis; auto-sized descendants can retain their minimum measured width and collapse the project label even with space available.
    /// Both the project slot and its label must grow into the width allocated by their parent.
    pub(crate) fn render_project_slot(
        &self,
        show_compact_mode_dropdown: bool,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        let project_icon = self
            .latest_sidebar_project_snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.project_icon_data_url.as_deref())
            .and_then(gpui_project_icon_image_from_data_url);
        h_flex()
            .ml(px(TITLEBAR_PROJECT_LEFT))
            .mt(px(1.0))
            .flex_1()
            .h(px(TITLEBAR_CONTROL_HEIGHT))
            .max_w(px(620.0))
            .min_w_0()
            .items_center()
            .window_control_area(WindowControlArea::Drag)
            .child(self.render_sidebar_collapse_button(cx))
            .child(self.render_titlebar_companion_toggle(cx))
            /*
            CDXC:Navigation 2026-08-19:
            Back/Forward sit LEFT of the project name, next to the sidebar
            toggle. Placing them after the name made them slide horizontally
            every time the active project's title changed length, which is
            exactly the kind of moving target a frequently clicked control must
            not be.
            */
            .child(self.render_titlebar_navigation_history_buttons(cx))
            // CDXC:Notifications 2026-09-11 DECISION:
            // User: the notification bell sits immediately to the right of the Next button.
            .when(self.titlebar_notification_bell_visible(), |this| {
                this.child(self.render_titlebar_notification_bell(cx))
            })
            .when(show_compact_mode_dropdown, |this| {
                this.child(self.render_compact_mode_dropdown(cx))
            })
            // CDXC:Titlebar 2026-09-19 DECISION:
            // User: the Update button sits on the left just before the project name, after the bell and the compact view dropdown, so showing or hiding it only moves the project name and never shifts Back/Forward.
            .when(self.update_available || self.update_downloading, |this| {
                this.child(self.render_titlebar_update_button(cx))
            })
            .child(
                h_flex()
                    .h(px(TITLEBAR_CONTROL_HEIGHT))
                    .flex_1()
                    .max_w(px(210.0))
                    .min_w_0()
                    .items_center()
                    .overflow_hidden()
                    .whitespace_nowrap()
                    .px(px(3.0))
                    .ml(px(5.0))
                    .mt(px(2.0))
                    .text_size(px(13.5))
                    .font_weight(FontWeight::SEMIBOLD)
                    .line_height(px(TITLEBAR_CONTROL_HEIGHT))
                    .text_color(titlebar_project_text_color())
                    .when_some(project_icon, |this, image| {
                        this.child(
                            img(image)
                                .size(px(16.0))
                                .mr(px(6.0))
                                .flex_shrink_0()
                                .rounded(px(4.0))
                                .object_fit(ObjectFit::Fill),
                        )
                    })
                    .child(self.project_name.clone()),
            )
    }

    /// CDXC:Workarea 2026-09-19 DECISION:
    /// User: keep the companion toggle next to Hide sidebar in every view and show it greyed out in Agents, so Back/Forward never shift when moving between views or projects with and without a companion. Make the chat control 2px smaller in both dimensions after two 1px reductions, and use the unfilled Side tail with text chat bubble in both the visible and hidden states.
    /// This supersedes the 2026-09-15 rule that rendered the toggle only in companion views; the toggle still replaces the minimized companion bar.
    pub(crate) fn render_titlebar_companion_toggle(
        &self,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        let enabled = self.active_mode.is_project_editor_mode();
        let visible = enabled && self.project_editor_shell.left_companion_visible;
        let tooltip = if !enabled {
            "Companion is not available in Agents".into()
        } else if visible {
            titlebar_tooltip_label("Hide companion", "toggleCompanionPane")
        } else {
            titlebar_tooltip_label("Show companion", "toggleCompanionPane")
        };
        titlebar_panel_toggle_button(
            "ghostex-gpui-titlebar-companion-toggle",
            if visible {
                TITLEBAR_ICON_COMPANION_HIDE
            } else {
                TITLEBAR_ICON_COMPANION_SHOW
            },
            2.0,
            enabled,
        )
        .when(enabled, |this| {
            this.on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, _, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                    this.toggle_project_editor_companion_from_hotkey(window, cx);
                }),
            )
        })
        .managed_tooltip_with_placement(ManagedTooltipPlacement::Right, move |window, cx| {
            titlebar_tooltip(tooltip.clone(), window, cx)
        })
    }

    pub(crate) fn render_sidebar_collapse_button(
        &self,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        /*
        CDXC:Titlebar 2026-06-22-19:39:
        The visible sidebar toggle should match the macOS React titlebar's current flat layout-sidebar icon. Keep its GPUI hit target 7px away from the native traffic lights (widened from 3px on 2026-08-23; macOS only, Windows/Linux keep their own frame). This margin is the left edge of the whole project slot, so it also sets where Back/Forward and the project name start. Do not render the old blue circular chevron visual.

        CDXC:Sidebar 2026-06-26-10:04:
        The GPUI titlebar sidebar button toggles the same in-shell collapsed chrome state as Cmd+B and the shared command-palette action. Collapse hides the sidebar and divider siblings without writing sidebarWidth, so the user's expanded width is restored on the next toggle.

        Windows and Linux do not have traffic lights to clear. Their collapse
        control uses the same full-height 42px segmented frame as Open In,
        mirrored with a trailing divider, and remains inside the 9px titlebar
        inset instead of extending past the window edge.
        */
        let button = titlebar_panel_toggle_button(
            "ghostex-gpui-sidebar-collapse",
            TITLEBAR_ICON_LAYOUT_SIDEBAR,
            0.0,
            true,
        )
        .on_mouse_down(
            MouseButton::Left,
            cx.listener(|this, _, window, cx| {
                window.prevent_default();
                cx.stop_propagation();
                this.toggle_gpui_sidebar_collapsed(cx);
            }),
        )
        .managed_tooltip_with_placement(ManagedTooltipPlacement::Right, {
            let tooltip = titlebar_tooltip_label("Hide sidebar", "toggleSidebarCollapsed");
            move |window, cx| titlebar_tooltip(tooltip.clone(), window, cx)
        });
        #[cfg(target_os = "macos")]
        let button = button.ml(px(-9.0));
        button
    }

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
