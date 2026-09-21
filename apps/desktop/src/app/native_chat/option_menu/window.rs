use super::super::{appearance::ChatAppearance, state::NativeChatView};
use gpui::{
    AppContext as _, Bounds, Context, Entity, FocusHandle, Pixels, Point, ScrollHandle,
    Styled as _, Subscription, Window, WindowBounds, WindowOptions, px, size,
};
use gpui_component::Root;
use serde_json::Value;
use std::cell::Cell;
use std::rc::Rc;
use std::sync::Arc;

pub(in crate::app::native_chat) struct ChatOptionMenu {
    pub(super) chat: gpui::WeakEntity<NativeChatView>,
    pub(super) source: gpui::AnyWindowHandle,
    pub(super) source_focus: Option<FocusHandle>,
    pub(super) source_bounds: Bounds<Pixels>,
    pub(super) appearance: ChatAppearance,
    pub(super) windows: Vec<gpui::WindowHandle<Root>>,
    pub(super) opening: bool,
    pub(super) closed: bool,
    /// Where each depth's panel was anchored, so a panel can reopen in place.
    anchors: Vec<(Bounds<Pixels>, f32, bool)>,
    parent: *mut std::ffi::c_void,
    /// Opened at the pointer (right-click menus), drawn with `MenuMetrics::CONTEXT`.
    compact: bool,
}

pub(super) struct ChatOptionMenuPanel {
    pub(super) menu: Entity<ChatOptionMenu>,
    pub(super) depth: usize,
    pub(super) rows: Arc<Vec<Value>>,
    pub(super) heights: Vec<f32>,
    pub(super) focus: FocusHandle,
    pub(super) selected: Option<usize>,
    pub(super) scroll: ScrollHandle,
    pub(super) child: Option<usize>,
    pub(super) hover_task: Option<gpui::Task<()>>,
    /// The Switch Account panel's Customize state (`SessionAccountsPanel`'s local `customize`).
    pub(super) accounts_customize: bool,
    /// Screen bounds of the panel's account preference select, where its dropdown opens.
    pub(super) select_bounds: Rc<Cell<Bounds<Pixels>>>,
    /// The model picker's cursor, search field and open side list, when this panel is that picker.
    pub(super) model_menu: Option<super::model_menu::ModelMenuState>,
    was_active: bool,
    _activation: Subscription,
    _chat_subscription: Option<Subscription>,
}

impl ChatOptionMenu {
    pub(super) fn metrics(&self) -> super::geometry::MenuMetrics {
        if self.compact {
            super::geometry::MenuMetrics::CONTEXT
        } else {
            super::geometry::MenuMetrics::REGULAR
        }
    }

    pub(in crate::app::native_chat) fn close(
        &mut self,
        command: Option<Value>,
        cx: &mut Context<Self>,
    ) {
        self.close_with_focus(command, true, cx);
    }

    fn close_with_focus(
        &mut self,
        command: Option<Value>,
        restore_focus: bool,
        cx: &mut Context<Self>,
    ) {
        if self.closed {
            return;
        }
        self.closed = true;
        let windows = std::mem::take(&mut self.windows);
        let source = self.source;
        let focus = self.source_focus.clone();
        let chat = self.chat.clone();
        let identity = cx.entity_id();
        cx.defer(move |cx| {
            for handle in windows.into_iter().rev() {
                let _ = handle.update(cx, |_, window, _| window.remove_window());
            }
            let _ = source.update(cx, |_, window, cx| {
                if restore_focus {
                    window.activate_window();
                    if let Some(focus) = focus {
                        focus.focus(window, cx);
                    }
                }
                let _ = chat.update(cx, |chat, cx| {
                    if chat
                        .option_menu
                        .as_ref()
                        .is_some_and(|menu| menu.entity_id() == identity)
                    {
                        chat.option_menu = None;
                        chat.menu_toggle.note_closed();
                    }
                    if let Some(command) = command {
                        chat.handle_action(
                            &super::super::actions::NativeChatAction { command },
                            window,
                            cx,
                        );
                    }
                    cx.notify();
                });
            });
        });
    }

    fn check_active(&mut self, cx: &mut Context<Self>) {
        if self.opening || self.closed {
            return;
        }
        if !self.windows.iter().any(|handle| {
            handle
                .update(cx, |_, window, _| window.is_window_active())
                .unwrap_or(false)
        }) {
            // The press that took the window away is the one a trigger is about to report as a
            // click, so the trigger it belonged to is remembered before the menu goes (menu_toggle.rs).
            let _ = self
                .chat
                .update(cx, |chat, _| chat.menu_toggle.note_dismissed());
            self.close_with_focus(None, false, cx);
        }
    }

    /// Runs a chat command without closing the menu (Switch Account panel controls).
    pub(super) fn dispatch(&mut self, command: Value, cx: &mut Context<Self>) {
        let chat = self.chat.clone();
        cx.defer(move |cx| {
            let _ = chat.update(cx, |chat, cx| chat.invoke(command, cx));
        });
    }

    pub(super) fn truncate(&mut self, depth: usize, focus_parent: bool, cx: &mut Context<Self>) {
        if self.windows.len() <= depth {
            return;
        }
        let windows = self.windows.split_off(depth);
        let parent = self.windows.last().copied();
        cx.defer(move |cx| {
            for handle in windows.into_iter().rev() {
                let _ = handle.update(cx, |_, window, _| window.remove_window());
            }
            if focus_parent && let Some(parent) = parent {
                let _ = parent.update(cx, |_, window, _| window.activate_window());
            }
        });
    }

    pub(super) fn open_panel(
        &mut self,
        rows: Vec<Value>,
        anchor: Bounds<Pixels>,
        width: f32,
        depth: usize,
        cx: &mut Context<Self>,
    ) {
        self.open_panel_at(rows, anchor, width, depth, false, cx);
    }

    /// A select's list: below its trigger (above when there is no room), left edges aligned.
    pub(super) fn open_dropdown(
        &mut self,
        rows: Vec<Value>,
        anchor: Bounds<Pixels>,
        width: f32,
        depth: usize,
        cx: &mut Context<Self>,
    ) {
        self.open_panel_at(rows, anchor, width, depth, true, cx);
    }

    /// Reopens the panel at `depth` with new rows, re-placed against its original anchor.
    /// The Switch Account panel uses this when it grows past the room below its top edge.
    pub(super) fn reopen(&mut self, depth: usize, rows: Vec<Value>, cx: &mut Context<Self>) {
        if let Some(&(anchor, width, below)) = self.anchors.get(depth) {
            self.open_panel_at(rows, anchor, width, depth, below, cx);
        }
    }

    fn open_panel_at(
        &mut self,
        mut rows: Vec<Value>,
        anchor: Bounds<Pixels>,
        width: f32,
        depth: usize,
        below: bool,
        cx: &mut Context<Self>,
    ) {
        if self.closed || rows.is_empty() {
            return;
        }
        self.anchors.truncate(depth);
        self.anchors.push((anchor, width, below));
        for row in &mut rows {
            if let Some(action) = row["hotkeyAction"].as_str() {
                row["detail"] = crate::app::hotkeys::gpui_configured_hotkey_label(action).into();
            }
        }
        self.truncate(depth, false, cx);
        let scale = self.appearance.scale;
        let available = self.source_bounds;
        let metrics = self.metrics();
        let width = if self.compact {
            super::geometry::fit_width(&rows, width, &self.appearance, cx)
        } else {
            width
        };
        let width = px(width * scale).min(available.size.width - px(24.0 * scale));
        let heights = match super::geometry::measure_rows(
            &rows,
            f32::from(width) / scale,
            metrics,
            &self.appearance,
            cx,
        ) {
            Ok(heights) => heights,
            Err(error) => {
                let _ = self.chat.update(cx, |chat, cx| {
                    chat.error = Some(error.to_string());
                    cx.notify();
                });
                return;
            }
        };
        let height = px((metrics.chrome()
            + heights.iter().sum::<f32>()
            + metrics.gap * (rows.len().saturating_sub(1)) as f32)
            * scale)
        .min(available.size.height - px(24.0 * scale));
        let margin = px(12.0 * scale);
        let x = if below {
            anchor.left()
        } else if depth == 0 {
            anchor.right() - width
        } else if anchor.right() + px(4.0 * scale) + width < available.right() - margin {
            anchor.right() + px(4.0 * scale)
        } else {
            anchor.left() - width - px(4.0 * scale)
        };
        let y = if depth == 0 || below {
            if anchor.bottom() + px(4.0 * scale) + height < available.bottom() - margin {
                anchor.bottom() + px(4.0 * scale)
            } else {
                anchor.top() - height - px(4.0 * scale)
            }
        } else {
            anchor.top()
        };
        let bounds = Bounds::new(
            Point::new(
                x.max(available.left() + margin)
                    .min(available.right() - width - margin),
                y.max(available.top() + margin)
                    .min(available.bottom() - height - margin),
            ),
            size(width, height),
        );
        let menu = cx.entity();
        let parent = self.parent;
        let accounts_customize = rows.first().is_some_and(|row| row["customize"] == true);
        let compact = self.compact;
        self.opening = true;
        cx.defer(move |cx| {
            let result = cx.open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    titlebar: None,
                    focus: true,
                    show: true,
                    is_movable: false,
                    is_resizable: false,
                    is_minimizable: false,
                    app_id: crate::gpui_platform_window_app_id(),
                    icon: crate::gpui_platform_window_icon(),
                    window_background: gpui::WindowBackgroundAppearance::Transparent,
                    ..Default::default()
                },
                {
                    let menu = menu.clone();
                    move |window, cx| {
                        if compact {
                            super::platform::prepare_context_menu(window);
                        }
                        crate::app::window::attach_gpui_app_modal_window_to_main_window(
                            window, parent,
                        );
                        let panel = cx.new(|cx| {
                            let focus = cx.focus_handle();
                            focus.focus(window, cx);
                            let activation = cx.observe_window_activation(
                                window,
                                |panel: &mut ChatOptionMenuPanel, window, cx| {
                                    if window.is_window_active() {
                                        panel.was_active = true;
                                    } else if panel.was_active {
                                        let menu = panel.menu.clone();
                                        cx.defer(move |cx| {
                                            menu.update(cx, |menu, cx| menu.check_active(cx))
                                        });
                                    }
                                },
                            );
                            let chat_subscription = if rows
                                .first()
                                .is_some_and(|row| row["accounts"].is_object())
                            {
                                menu.read(cx).chat.upgrade().map(|chat| {
                                    cx.observe_in(
                                        &chat,
                                        window,
                                        |panel: &mut ChatOptionMenuPanel, chat, window, cx| {
                                            let next = &chat.read(cx).snapshot["accountPanel"];
                                            if !next.is_object()
                                                || panel
                                                    .rows
                                                    .first()
                                                    .is_some_and(|row| &row["accounts"] == next)
                                            {
                                                return;
                                            }
                                            panel.rows = Arc::new(vec![
                                                serde_json::json!({"accounts":next.clone()}),
                                            ]);
                                            panel.refit_accounts(window, cx);
                                        },
                                    )
                                })
                            } else if rows.first().is_some_and(|row| row["context"].is_object()) {
                                menu.read(cx).chat.upgrade().map(|chat| {
                                    cx.observe_in(
                                        &chat,
                                        window,
                                        |panel: &mut ChatOptionMenuPanel, chat, window, cx| {
                                            let next = &chat.read(cx).snapshot["contextMeter"];
                                            if panel
                                                .rows
                                                .first()
                                                .is_some_and(|row| &row["context"] == next)
                                            {
                                                return;
                                            }
                                            let next = next.clone();
                                            panel.rows =
                                                Arc::new(vec![serde_json::json!({"context":next})]);
                                            let appearance = &panel.menu.read(cx).appearance;
                                            let height = match super::context::height(
                                                &next,
                                                window.bounds().size.width.as_f32()
                                                    / appearance.scale,
                                                appearance,
                                                cx,
                                            ) {
                                                Ok(height) => height,
                                                Err(error) => {
                                                    let chat = panel.menu.read(cx).chat.clone();
                                                    cx.defer(move |cx| {
                                                        let _ = chat.update(cx, |chat, cx| {
                                                            chat.error = Some(error.to_string());
                                                            cx.notify();
                                                        });
                                                    });
                                                    return;
                                                }
                                            };
                                            panel.heights = vec![height];
                                            let available = panel.menu.read(cx).source_bounds;
                                            let desired = px((height + 14.0) * appearance.scale);
                                            window.resize(size(
                                                window.bounds().size.width,
                                                desired.min(
                                                    available.bottom()
                                                        - window.bounds().top()
                                                        - px(12.0 * appearance.scale),
                                                ),
                                            ));
                                            cx.notify();
                                        },
                                    )
                                })
                            } else if rows.first().is_some_and(|row| row["modelMenu"].is_object()) {
                                menu.read(cx).chat.upgrade().map(|chat| {
                                    cx.observe(&chat, |panel: &mut ChatOptionMenuPanel, _, cx| {
                                        panel.model_menu_changed(cx)
                                    })
                                })
                            } else {
                                None
                            };
                            let model_menu =
                                super::model_menu::ModelMenuState::new(&rows, &menu, window, cx);
                            ChatOptionMenuPanel {
                                menu,
                                depth,
                                rows: Arc::new(rows),
                                heights,
                                focus,
                                selected: None,
                                scroll: Default::default(),
                                child: None,
                                hover_task: None,
                                accounts_customize,
                                select_bounds: Rc::new(Cell::new(Bounds::default())),
                                model_menu,
                                was_active: window.is_window_active(),
                                _activation: activation,
                                _chat_subscription: chat_subscription,
                            }
                        });
                        cx.new(|cx| Root::new(panel, window, cx).bg(gpui::transparent_black()))
                    }
                },
            );
            menu.update(cx, |menu, cx| {
                menu.opening = false;
                match result {
                    Ok(handle) if !menu.closed => menu.windows.push(handle),
                    Ok(handle) => {
                        let _ = handle.update(cx, |_, window, _| window.remove_window());
                    }
                    Err(error) => {
                        let _ = menu.chat.update(cx, |chat, cx| {
                            chat.error = Some(error.to_string());
                            cx.notify();
                        });
                        menu.close(None, cx);
                    }
                }
            });
        });
    }
}

impl NativeChatView {
    pub(in crate::app::native_chat) fn show_option_menu(
        &mut self,
        kind: &str,
        trigger: Bounds<Pixels>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(rows) = self.snapshot["optionMenus"][kind]
            .as_array()
            .filter(|rows| !rows.is_empty())
            .cloned()
        else {
            return;
        };
        if self.chat_menu_toggled_shut(super::super::menu_toggle::option_pill_trigger_id(kind), cx)
        {
            return;
        }
        self.show_chat_menu(
            rows,
            trigger,
            if kind == "model" { 256.0 } else { 240.0 },
            window,
            cx,
        );
    }

    /// A menu opened at the pointer instead of under a trigger.
    ///
    /// React's context menus drop down and to the right of the press, which is
    /// the placement a select's list uses, not the right-aligned placement a
    /// toolbar button's menu uses.
    pub(in crate::app::native_chat) fn show_chat_menu_at(
        &mut self,
        rows: Vec<Value>,
        at: Point<Pixels>,
        width: f32,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.open_chat_menu(
            rows,
            Bounds::new(at, size(px(0.0), px(0.0))),
            width,
            true,
            window,
            cx,
        );
    }

    pub(in crate::app::native_chat) fn show_chat_menu(
        &mut self,
        rows: Vec<Value>,
        trigger: Bounds<Pixels>,
        width: f32,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.open_chat_menu(rows, trigger, width, false, window, cx);
    }

    fn open_chat_menu(
        &mut self,
        rows: Vec<Value>,
        trigger: Bounds<Pixels>,
        width: f32,
        below: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if rows.is_empty() {
            return;
        }
        if let Some(menu) = self.option_menu.take() {
            menu.update(cx, |menu, cx| menu.close_with_focus(None, false, cx));
        }
        let appearance = ChatAppearance::current(&self.snapshot);
        // `trigger` is in content coordinates; a window frame with a titlebar (Chat Lab) put every
        // menu that titlebar's height above its trigger or the pointer.
        let source_bounds = super::super::child_window::content_bounds(window);
        let chat = cx.weak_entity();
        let source = window.window_handle();
        let source_focus = window.focused(cx);
        let parent = self.config.parent_native_view;
        let menu = cx.new(|_| ChatOptionMenu {
            chat,
            source,
            source_focus,
            source_bounds,
            appearance,
            windows: vec![],
            opening: false,
            closed: false,
            anchors: vec![],
            parent,
            compact: below,
        });
        let anchor = Bounds::new(source_bounds.origin + trigger.origin, trigger.size);
        menu.update(cx, |menu, cx| {
            if below {
                menu.open_dropdown(rows, anchor, width, 0, cx);
            } else {
                menu.open_panel(rows, anchor, width, 0, cx);
            }
        });
        self.option_menu = Some(menu);
        self.menu_toggle.note_opened();
        cx.notify();
    }
}
