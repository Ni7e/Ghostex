use super::super::window::ChatOptionMenuPanel;
use gpui::{Context, ScrollStrategy, Window};

#[derive(Clone, Debug, PartialEq, gpui::Action)]
#[action(namespace = ghostex_gpui, no_json)]
pub(super) struct ModelMenuKey {
    key: String,
}
struct ModelMenuKeysRegistered;
impl gpui::Global for ModelMenuKeysRegistered {}

pub(super) const KEY_CONTEXT: &str = "ChatModelMenu";

/// The search field keeps focus the whole visit, and gpui resolves the field's own bindings
/// (arrows, Enter, Escape) before any key listener, so the picker claims its keys as an action in
/// the field's context, the way the composer does (keyboard.rs). Keys it does not use fall through
/// to the field.
pub(super) fn register(cx: &mut gpui::App) {
    if cx.has_global::<ModelMenuKeysRegistered>() {
        return;
    }
    cx.set_global(ModelMenuKeysRegistered);
    let keys = [
        "up",
        "down",
        "ctrl-p",
        "ctrl-n",
        "left",
        "right",
        "enter",
        "shift-enter",
        "escape",
        "tab",
    ]
    .into_iter()
    .map(str::to_owned)
    .chain((1..=9).map(|slot| format!("secondary-{slot}")));
    cx.bind_keys(keys.map(|key| {
        gpui::KeyBinding::new(
            &key,
            ModelMenuKey { key: key.clone() },
            Some("ChatModelMenu > Input"),
        )
    }));
}

impl ChatOptionMenuPanel {
    pub(super) fn model_menu_key_action(
        &mut self,
        action: &ModelMenuKey,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.model_menu_key(&action.key, window, cx) {
            cx.stop_propagation();
            window.prevent_default();
            cx.notify();
        }
    }

    /// True when the picker used the key; anything else belongs to the search field.
    fn model_menu_key(&mut self, key: &str, window: &mut Window, cx: &mut Context<Self>) -> bool {
        let Some(state) = self.model_menu.as_mut() else {
            return false;
        };
        let rows = state.rows().len();
        let count = rows + state.traits().len();
        match key {
            "escape" | "tab" => self.menu.update(cx, |menu, cx| menu.close(None, cx)),
            "up" | "ctrl-p" | "down" | "ctrl-n" if count > 0 => {
                let up = key == "up" || key == "ctrl-p";
                // The footer is one stop on the way round: Left and Right move along its buttons.
                state.active = if state.active >= rows {
                    if up && rows > 0 { rows - 1 } else { 0 }
                } else if up {
                    (state.active + count - 1) % count
                } else if state.active + 1 < rows {
                    state.active + 1
                } else {
                    rows % count
                };
                if state.active < rows {
                    state
                        .scroll
                        .scroll_to_item(state.active, ScrollStrategy::Nearest);
                }
            }
            "enter" | "shift-enter" => {
                let active = state.active;
                if active < rows {
                    self.model_menu_pick(active, key == "shift-enter", cx);
                } else {
                    self.activate_model_button(active - rows, key == "shift-enter", window, cx);
                }
            }
            "left" | "right" if state.active >= rows => {
                let buttons = count - rows;
                let index = state.active - rows;
                state.active = rows
                    + if key == "left" {
                        (index + buttons - 1) % buttons
                    } else {
                        (index + 1) % buttons
                    };
            }
            "left" | "right" => return false,
            _ => {
                let Some(slot) = key
                    .strip_prefix("secondary-")
                    .and_then(|slot| slot.parse::<usize>().ok())
                else {
                    return false;
                };
                let Some(index) = state
                    .rows()
                    .iter()
                    .position(|row| row["shortcut"].as_u64() == Some(slot as u64))
                else {
                    return true;
                };
                state.active = index;
                self.model_menu_pick(index, false, cx);
            }
        }
        true
    }
}
