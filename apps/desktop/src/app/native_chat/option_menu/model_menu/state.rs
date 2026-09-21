use super::super::super::state::NativeChatView;
use super::super::window::{ChatOptionMenu, ChatOptionMenuPanel};
use super::style::{
    BAR_HEIGHT, BUTTON_GAP, CARD_WIDTH, ERROR_HEIGHT, LIST_HEIGHT, TRAIT_ROW_HEIGHT, button_lines,
};
use gpui::{
    AppContext as _, Bounds, Context, Entity, Pixels, ScrollStrategy, Subscription,
    UniformListScrollHandle, Window,
};
use gpui_component::input::{InputEvent, InputState};
use serde_json::{Value, json};

/// CDXC:SessionChat 2026-09-21 SEE-ALSO:
/// What the picker shows (tabs, row order, search ranking, favorites, the footer rows and the pill's label) is decided in packages/shared/session-chat-presentation/model-menu.ts and projected by packages/shared/session-chat-controller/model-menu.ts as the snapshot's `modelMenu`; native-host.ts answers `modelMenuView`, `modelMenuPick`, `modelMenuTrait` and `modelMenuFavorite`. The React twin is packages/core-ui/chat/session-chat-model-menu.tsx. This side owns only the cursor, the open side list and the search field.
pub(in crate::app::native_chat::option_menu) struct ModelMenuState {
    pub(super) input: Entity<InputState>,
    /// The snapshot's `modelMenu` this panel last drew.
    pub(super) view: Value,
    /// Model rows first, then the footer buttons, as one cursor the arrows walk straight through.
    pub(super) active: usize,
    pub(super) flyout: Option<usize>,
    pub(super) scroll: UniformListScrollHandle,
    _input: Subscription,
}

fn live_view(menu: &Entity<ChatOptionMenu>, cx: &gpui::App) -> Value {
    menu.read(cx)
        .chat
        .upgrade()
        .map(|chat| chat.read(cx).snapshot["modelMenu"].clone())
        .unwrap_or(Value::Null)
}

/// The parts of the view that change the card's height, carried on the panel's row so the window
/// is measured before it exists and re-placed when they change.
fn shape(view: &Value) -> Value {
    json!({
        "lines": button_lines(view["traits"].as_array().map_or(0, Vec::len)).0,
        "error": view["error"].is_string(),
    })
}

fn selected_row(view: &Value) -> usize {
    view["rows"]
        .as_array()
        .and_then(|rows| rows.iter().position(|row| row["selected"] == true))
        .unwrap_or(0)
}

/// The card's height without the 14px of padding and border `open_panel_at` adds for a row menu.
pub(in crate::app::native_chat::option_menu) fn menu_height(marker: &Value) -> f32 {
    let lines = marker["lines"].as_u64().unwrap_or(0) as f32;
    let tray = if lines > 0.0 {
        9.0 + lines * TRAIT_ROW_HEIGHT + (lines - 1.0) * BUTTON_GAP
    } else {
        0.0
    };
    let error = if marker["error"] == true {
        ERROR_HEIGHT
    } else {
        0.0
    };
    2.0 + BAR_HEIGHT * 2.0 + error + LIST_HEIGHT + tray - 14.0
}

impl ModelMenuState {
    pub(in crate::app::native_chat::option_menu) fn new(
        rows: &[Value],
        menu: &Entity<ChatOptionMenu>,
        window: &mut Window,
        cx: &mut Context<ChatOptionMenuPanel>,
    ) -> Option<Self> {
        let marker = rows.first()?.get("modelMenu")?.as_object()?;
        let view = live_view(menu, cx);
        let placeholder = view["placeholder"]
            .as_str()
            .unwrap_or("Search models…")
            .to_owned();
        // A card re-placed for a new height keeps the search the person had typed.
        let query = marker
            .get("reopen")
            .and_then(|_| view["query"].as_str())
            .unwrap_or_default()
            .to_owned();
        let input = cx.new(|cx| {
            let mut input = InputState::new(window, cx).placeholder(placeholder);
            if !query.is_empty() {
                input.set_value(query, window, cx);
            }
            input
        });
        let subscription =
            cx.subscribe_in(&input, window, |panel, input, event: &InputEvent, window, cx| {
                if matches!(event, InputEvent::Focus) {
                    crate::app::native_chat::focus::reclaim_keyboard_focus(window);
                }
                if matches!(event, InputEvent::Change) {
                    let query = input.read(cx).value().to_string();
                    panel.model_menu_send(json!({"type":"modelMenuView","query":query}), cx);
                }
            });
        // Typed text reaches a field only through the window's native keyboard owner, which a GPUI focus handle alone does not claim (native_chat/focus.rs); every other chat field reclaims it the same way.
        crate::app::native_chat::focus::reclaim_keyboard_focus(window);
        input.update(cx, |input, cx| input.focus(window, cx));
        Some(Self {
            input,
            active: selected_row(&view),
            view,
            flyout: None,
            scroll: UniformListScrollHandle::new(),
            _input: subscription,
        })
    }

    pub(super) fn rows(&self) -> &[Value] {
        self.view["rows"].as_array().map_or(&[], Vec::as_slice)
    }

    pub(super) fn traits(&self) -> &[Value] {
        self.view["traits"].as_array().map_or(&[], Vec::as_slice)
    }
}

impl ChatOptionMenuPanel {
    pub(super) fn model_menu_send(&mut self, command: Value, cx: &mut Context<Self>) {
        self.menu.update(cx, |menu, cx| menu.dispatch(command, cx));
    }

    /// The chat published a new snapshot: redraw from it, and re-place the card when its height changed.
    pub(in crate::app::native_chat::option_menu) fn model_menu_changed(
        &mut self,
        cx: &mut Context<Self>,
    ) {
        let next = live_view(&self.menu, cx);
        let Some(state) = self.model_menu.as_mut() else {
            return;
        };
        if !next.is_object() {
            self.menu.update(cx, |menu, cx| menu.close(None, cx));
            return;
        }
        if next == state.view {
            return;
        }
        let mut marker = shape(&next);
        let current = &self.rows[0]["modelMenu"];
        if marker["lines"] != current["lines"] || marker["error"] != current["error"] {
            marker["reopen"] = true.into();
            let depth = self.depth;
            self.menu.update(cx, |menu, cx| {
                menu.reopen(depth, vec![json!({"modelMenu":marker})], cx)
            });
            return;
        }
        let moved = next["tab"] != state.view["tab"] || next["query"] != state.view["query"];
        state.view = next;
        if moved {
            state.active = if state.view["query"].as_str().is_some_and(|q| !q.is_empty()) {
                0
            } else {
                selected_row(&state.view)
            };
            state
                .scroll
                .scroll_to_item(state.active, ScrollStrategy::Top);
        }
        let count = state.rows().len() + state.traits().len();
        state.active = state.active.min(count.saturating_sub(1));
        cx.notify();
    }

    pub(super) fn model_menu_pick(
        &mut self,
        index: usize,
        secondary: bool,
        cx: &mut Context<Self>,
    ) {
        let Some(state) = self.model_menu.as_ref() else {
            return;
        };
        if state.view["disabled"] == true {
            return;
        }
        let Some(key) = state.rows().get(index).map(|row| row["key"].clone()) else {
            return;
        };
        self.model_menu_send(
            json!({"type":"modelMenuPick","key":key,"secondary":secondary}),
            cx,
        );
    }
}

impl NativeChatView {
    pub(in crate::app::native_chat) fn show_model_menu(
        &mut self,
        trigger: Bounds<Pixels>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.snapshot["modelMenu"].is_object() {
            return;
        }
        if self.chat_menu_toggled_shut(
            super::super::super::menu_toggle::option_pill_trigger_id("model"),
            cx,
        ) {
            return;
        }
        super::keys::register(cx);
        // Every visit starts on the session's own agent with an empty search.
        self.invoke(json!({"type":"modelMenuView","tab":null,"query":""}), cx);
        let marker = shape(&self.snapshot["modelMenu"]);
        self.show_chat_menu(
            vec![json!({"modelMenu":marker})],
            trigger,
            CARD_WIDTH,
            window,
            cx,
        );
    }
}
