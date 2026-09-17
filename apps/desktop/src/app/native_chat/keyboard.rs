use super::state::NativeChatView;
use gpui::{Context, EntityInputHandler as _, Focusable as _, Window};
use serde_json::json;

#[derive(Clone, Debug, PartialEq, gpui::Action)]
#[action(namespace = ghostex_gpui, no_json)]
struct ComposerKey {
    key: String,
}
struct ComposerKeysRegistered;
impl gpui::Global for ComposerKeysRegistered {}

pub(super) fn register(cx: &mut gpui::App) {
    if cx.has_global::<ComposerKeysRegistered>() {
        return;
    }
    cx.set_global(ComposerKeysRegistered);
    cx.bind_keys(
        [
            ("enter", "enter"),
            ("shift-enter", "enter"),
            ("secondary-enter", "enter"),
            ("alt-enter", "enter"),
            ("up", "up"),
            ("shift-up", "up"),
            ("alt-up", "up"),
            ("down", "down"),
            ("shift-down", "down"),
            ("tab", "tab"),
            ("shift-tab", "tab"),
            ("escape", "escape"),
        ]
        .into_iter()
        .map(|(binding, key)| {
            gpui::KeyBinding::new(
                binding,
                ComposerKey { key: key.into() },
                Some("NativeChat > Input"),
            )
        }),
    );
}

/// CDXC:SessionChat 2026-09-17 WHY:
/// GPUI resolves input key bindings before key listeners. Chat-scoped actions let suggestions, history and queueing precede the editor's Enter, arrows and indentation; unhandled bindings continue to the input.
pub(super) trait ComposerInputActions: gpui::InteractiveElement + Sized {
    fn composer_input_actions(self, cx: &Context<NativeChatView>) -> Self {
        self.key_context("NativeChat").capture_action(cx.listener(
            |chat, action: &ComposerKey, window, cx| {
                chat.composer_bound_key(&action.key, window, cx);
            },
        ))
    }
}
impl<T: gpui::InteractiveElement> ComposerInputActions for T {}

impl NativeChatView {
    fn composer_bound_key(&mut self, key: &str, window: &mut Window, cx: &mut Context<Self>) {
        let is_held = self.composer_held_key.as_deref() == Some(key);
        self.composer_held_key = Some(key.to_owned());
        self.composer_key_down(
            &gpui::KeyDownEvent {
                keystroke: gpui::Keystroke {
                    key: key.to_owned(),
                    modifiers: window.modifiers(),
                    key_char: None,
                },
                is_held,
                prefer_character_input: false,
            },
            window,
            cx,
        );
    }
    pub(crate) fn composer_key_down(
        &mut self,
        event: &gpui::KeyDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let this = self;

        let key = &event.keystroke;
        for input in this
            .input
            .iter()
            .chain(this.answer_input.iter().map(|(_, input)| input))
        {
            if input.read(cx).focus_handle(cx).is_focused(window)
                && input.update(cx, |input, cx| {
                    input.marked_text_range(window, cx).is_some()
                })
            {
                return;
            }
        }
        if this.snapshot["questionCard"]["visible"] == true {
            let editing = this.input.iter().chain(this.answer_input.iter().map(|(_, input)| input))
                .any(|input| input.read(cx).focus_handle(cx).is_focused(window));
            let collapsed = this.collapsed.contains(&format!("question:{}", this.snapshot["prompt"]));
            if !editing && !collapsed && !key.modifiers.platform && !key.modifiers.control && !key.modifiers.alt
                && let Ok(digit @ 1..=9) = key.key.parse::<usize>()
            {
                this.invoke(json!({"type":"questionOption","index":digit - 1}), cx);
                cx.stop_propagation();
                window.prevent_default();
            }
            return;
        }
        let Some(input) = this.input.clone() else {
            return;
        };
        if !input.read(cx).focus_handle(cx).is_focused(window) {
            return;
        }
        if key.key == "enter"
            && key.modifiers.alt
            && !key.modifiers.shift
            && !key.modifiers.control
            && !key.modifiers.platform
        {
            this.submit("compact", window, cx);
            cx.stop_propagation();
            window.prevent_default();
            return;
        }
        this.update_suggestion_selection(cx);
        let suggestions = &this.snapshot["suggestions"];
        if suggestions.is_object()
            && (key.key == "escape"
                || suggestions["rows"]
                    .as_array()
                    .is_some_and(|rows| !rows.is_empty())
                    && (matches!(key.key.as_str(), "up" | "down" | "tab")
                        || key.key == "enter" && !key.modifiers.shift))
        {
            if key.key == "enter" && suggestions["sendOnEnter"] == true {
                this.send(false, window, cx);
            } else {
                this.invoke(json!({"type":"suggestionKey","key":key.key}), cx);
            }
            cx.stop_propagation();
            window.prevent_default();
            return;
        }
        let primary = key.key == "enter"
            && !key.modifiers.shift
            && !key.modifiers.alt
            && if cfg!(target_os = "macos") {
                key.modifiers.platform && !key.modifiers.control
            } else {
                key.modifiers.control && !key.modifiers.platform
            };
        let secondary = key.key == "escape"
            && !key.modifiers.shift
            && !key.modifiers.alt
            && !key.modifiers.platform
            && !key.modifiers.control;
        if this.snapshot["noticeVisible"] == true
            && this.snapshot["questionCard"]["busy"] != true
            && (primary || secondary)
            && !event.is_held
        {
            let notice = &this.snapshot["terminalNotice"];
            let choice = notice["choices"]
                .as_array()
                .and_then(|choices| choices.get(if primary { 0 } else { 1 }));
            let has_action = primary
                && notice["actions"].as_array().is_some_and(|actions| {
                    actions.iter().any(|action| action["answer"].is_object())
                });
            let standalone_dialog = notice["dialog"]["rows"]
                .as_array()
                .is_some_and(Vec::is_empty);
            if choice.is_some() || (has_action && !standalone_dialog) {
                this.invoke(
                    json!({"type":if primary {"noticePrimary"} else {"noticeSecondary"}}),
                    cx,
                );
                cx.stop_propagation();
                window.prevent_default();
                return;
            }
        }
        if key.key == "up"
            && key.modifiers.alt
            && !key.modifiers.shift
            && !key.modifiers.control
            && !key.modifiers.platform
            && this.draft.trim().is_empty()
            && this.snapshot["queue"]["capabilities"]["canEdit"] == true
        {
            if let Some(prompt) = this.snapshot["queue"]["prompts"]
                .as_array()
                .and_then(|prompts| prompts.iter().rev().find(|prompt| prompt["busy"] != true))
            {
                this.invoke(
                    json!({"type":"removeQueue","promptId":prompt["id"],"edit":true}),
                    cx,
                );
                cx.stop_propagation();
                window.prevent_default();
                return;
            }
        }
        if (key.key == "up"
            && (this.draft.trim().is_empty() || this.snapshot["historyActive"] == true)
            || key.key == "down" && this.snapshot["historyActive"] == true)
            && !key.modifiers.shift
            && !key.modifiers.control
            && !key.modifiers.platform
            && (!key.modifiers.alt || this.draft.trim().is_empty())
        {
            this.invoke(json!({"type":"recallHistory","direction":key.key}), cx);
            cx.stop_propagation();
            window.prevent_default();
        } else if key.key == "tab"
            && !key.modifiers.shift
            && !key.modifiers.alt
            && !key.modifiers.control
            && !key.modifiers.platform
            && !this.draft.trim().is_empty()
            && this.snapshot["queue"]["capabilities"]["canQueue"] == true
        {
            this.send(true, window, cx);
            cx.stop_propagation();
            window.prevent_default();
        } else if key.key == "escape" {
            if this.maximized_window.is_some() {
                this.close_maximized(cx);
            } else {
                this.invoke(json!({"type":"interrupt"}), cx);
            }
            cx.stop_propagation();
            window.prevent_default();
        } else if key.key == "enter" && !key.modifiers.shift {
            this.send(false, window, cx);
            cx.stop_propagation();
            window.prevent_default();
        } else if key.key == "tab"
            && !key.modifiers.alt
            && !key.modifiers.platform
            && !key.modifiers.control
        {
            if key.modifiers.shift {
                window.focus_prev(cx);
            } else {
                window.focus_next(cx);
            }
            cx.stop_propagation();
            window.prevent_default();
        }
    }
}
