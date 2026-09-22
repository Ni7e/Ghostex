use super::state::NativeChatView;
use gpui::{Context, EntityInputHandler as _, Focusable as _, Window};
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};

thread_local! {
    /// The terminal kill buffer Ctrl+U and Ctrl+K fill and Ctrl+Y pastes back.
    static KILL_BUFFER: RefCell<String> = const { RefCell::new(String::new()) };
    /// Set while a background keystroke is being replayed into the focused composer.
    static REPLAYING: Cell<bool> = const { Cell::new(false) };
}

/// The text a keystroke types when it is not a chord: what the platform would insert through the IME path.
fn typed_text(keystroke: &gpui::Keystroke) -> Option<&str> {
    let modifiers = keystroke.modifiers;
    if modifiers.platform || modifiers.control || modifiers.function {
        return None;
    }
    let text = keystroke.key_char.as_deref()?;
    if text.is_empty() || text.chars().any(char::is_control) {
        return None;
    }
    Some(text)
}

fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "mac"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

/// Byte range of the logical line `caret` sits on.
fn line_bounds(text: &str, caret: usize) -> (usize, usize) {
    let start = text[..caret].rfind('\n').map_or(0, |index| index + 1);
    let end = text[caret..]
        .find('\n')
        .map_or(text.len(), |index| caret + index);
    (start, end)
}

impl NativeChatView {
    /// Ctrl+U, Ctrl+K and Ctrl+Y in the composer. Returns whether the draft changed.
    ///
    /// CDXC:SessionChat 2026-09-18 SEE-ALSO:
    /// The chord table is `sessionChatTerminalShortcut`
    /// (`packages/core-ui/chat/session-chat-edit-shortcuts.ts`), carrying the user's 2026-09-08
    /// decision that these keys behave like the terminal on logical line boundaries; the kill buffer
    /// is this renderer's own, the way React keeps one per composer.
    pub(super) fn composer_terminal_edit(&mut self, command: &str, cx: &mut Context<Self>) -> bool {
        let Some(input) = self.input.clone() else {
            return false;
        };
        let selection = input.read(cx).selected_range();
        let start = selection.start.min(self.draft.len());
        let end = selection.end.max(start).min(self.draft.len());
        if !self.draft.is_char_boundary(start) || !self.draft.is_char_boundary(end) {
            return false;
        }
        let (from, to) = match command {
            "killLineLeft" => (line_bounds(&self.draft, start).0, end),
            "killLineRight" => {
                let line_end = line_bounds(&self.draft, end).1;
                if start == line_end && line_end < self.draft.len() {
                    // Already at the end of the line: Ctrl+K joins the next one, as a terminal does.
                    (start, line_end + 1)
                } else {
                    (start, line_end)
                }
            }
            "yank" => (start, end),
            _ => return false,
        };
        let insert = if command == "yank" {
            KILL_BUFFER.with(|buffer| buffer.borrow().clone())
        } else {
            String::new()
        };
        if from == to && insert.is_empty() {
            return false;
        }
        if command != "yank" {
            KILL_BUFFER.with(|buffer| *buffer.borrow_mut() = self.draft[from..to].to_owned());
        }
        let next = format!("{}{insert}{}", &self.draft[..from], &self.draft[to..]);
        let caret = next[..from + insert.len()].encode_utf16().count();
        self.insert_prompt(&next, cx);
        self.input_caret = Some(caret);
        true
    }

    /// Caret arrows and editing chords pressed while only the chat background holds focus.
    ///
    /// CDXC:SessionChat 2026-09-18 SEE-ALSO:
    /// The rules are the user's 2026-09-06 and 2026-09-07 decisions in
    /// `session-chat-caret-navigation.ts` and `session-chat-edit-shortcuts.ts`, reached here through
    /// `nativeComposerKeyIntent`. GPUI has no DOM to re-target, so the composer takes focus and the
    /// keystroke is replayed into it instead of each command being reimplemented.
    pub(super) fn composer_background_key(
        &mut self,
        keystroke: &gpui::Keystroke,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if REPLAYING.with(Cell::get) {
            return false;
        }
        let Some(input) = self.input.clone() else {
            return false;
        };
        let modifiers = keystroke.modifiers;
        /*
        CDXC:SessionChat 2026-09-22 DECISION:
        User: the GPUI chat view puts typed input into the text box automatically, like the React composer did; clicking outside the text box and then typing writes into the composer where the caret was last set.
        The composer keeps its caret across blur, so focusing it and inserting the keystroke's text lands the character there; the IME path cannot do it because the platform input handler only follows focus on the next paint.
        Enter keeps its view-level meaning from React (send, Shift+Enter newline, Option+Enter compact and send) by running the composer's own Enter handling once the composer has focus.
        */
        if keystroke.key == "enter" && !modifiers.platform && !modifiers.control {
            self.invoke(json!({"type":"composerExpand","editor":true}), cx);
            if modifiers.shift {
                // The composer's key handling leaves Shift+Enter to the input's own newline, which a replay never reaches.
                input.update(cx, |input, cx| {
                    input.focus(window, cx);
                    input.replace_text_in_range(None, "\n", window, cx);
                });
            } else {
                input.read(cx).focus_handle(cx).focus(window, cx);
                self.composer_bound_key("enter", window, cx);
            }
            return true;
        }
        if let Some(text) = typed_text(keystroke) {
            let text = text.to_owned();
            self.invoke(json!({"type":"composerExpand","editor":true}), cx);
            input.update(cx, |input, cx| {
                input.focus(window, cx);
                input.replace_text_in_range(None, &text, window, cx);
            });
            return true;
        }
        let event = json!({
            "key": keystroke.key, "alt": modifiers.alt, "control": modifiers.control,
            "platform": modifiers.platform, "shift": modifiers.shift,
        });
        let intent = self.runtime.as_ref().and_then(|runtime| {
            runtime.query(
                "composerKeyIntent",
                vec![event, Value::String(platform().to_owned())],
                std::time::Duration::from_millis(40),
            )
        });
        // A busy runtime answers nothing in time; the key then behaves as it did before.
        if !intent.is_some_and(|intent| intent.is_object()) {
            return false;
        }
        input.read(cx).focus_handle(cx).focus(window, cx);
        let replay = keystroke.clone();
        window.defer(cx, move |window, cx| {
            REPLAYING.with(|flag| flag.set(true));
            window.dispatch_keystroke(replay, cx);
            REPLAYING.with(|flag| flag.set(false));
        });
        true
    }

    /// Whether one of this chat's own text fields holds GPUI focus, so keys already reach the
    /// composer path through the pane's capture listener.
    pub(crate) fn composer_owns_gpui_focus(&self, window: &Window, cx: &gpui::App) -> bool {
        self.input
            .iter()
            .chain(self.answer_input.iter().map(|(_, input)| input))
            .chain(self.async_answer_input.iter().map(|(_, input)| input))
            .chain(self.note_input.iter())
            .any(|input| input.read(cx).focus_handle(cx).is_focused(window))
            || self.terminal_dialog_key_focus.is_focused(window)
    }
}
