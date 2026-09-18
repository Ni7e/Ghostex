use super::state::NativeChatView;
use gpui::{Context, Focusable as _, Window};
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};

thread_local! {
    /// The terminal kill buffer Ctrl+U and Ctrl+K fill and Ctrl+Y pastes back.
    static KILL_BUFFER: RefCell<String> = const { RefCell::new(String::new()) };
    /// Set while a background keystroke is being replayed into the focused composer.
    static REPLAYING: Cell<bool> = const { Cell::new(false) };
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
}
