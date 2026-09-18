//! CDXC:SessionChat 2026-09-14 WHY:
//! A quoted ordinary chat send reaches the model but bypasses Codex's local accept_answer(), leaving its terminal questions pending.
//! Answer and Skip must drive the actual question editor inside one serialized terminal job. Codex owns answer framing and preserves the main composer draft.

use std::time::{Duration, Instant};

use serde_json::Value;

use crate::session_chat::*;
use crate::session_chat_send::{capture_session_terminal_text, write_session_chat_payload};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AsyncAnswer {
    pub title: String,
    pub options: usize,
    pub text: Option<String>,
}

pub(crate) fn resolve(
    session: &Value,
    id: &str,
    text: Option<String>,
) -> Result<AsyncAnswer, String> {
    let path = resolve_session_chat_transcript_path(
        SessionChatTranscriptAgent::Codex,
        crate::server::read_runtime_text(session, "agentSessionId").as_deref(),
        crate::server::read_runtime_text(session, "agentSessionPath").as_deref(),
    )
    .ok_or("Codex's question transcript is unavailable.")?;
    let started_at = crate::session_chat_async_questions::async_questions_since(session);
    let mut questions = Vec::new();
    let mut collect = |messages: Vec<SessionChatMessage>| {
        for message in messages {
            if message
                .timestamp
                .zip(started_at)
                .is_some_and(|(at, start)| at < start)
            {
                continue;
            }
            for (index, question) in message
                .async_questions
                .unwrap_or_default()
                .into_iter()
                .enumerate()
            {
                questions.push((format!("{}:{index}", message.id), question));
            }
        }
    };
    let messages = read_incremental_transcript_messages(
        &path,
        &mut SessionChatIncrementalState::default(),
        decode_codex_transcript_line,
        Some(&mut collect),
        None,
        None,
        None,
    )
    .map_err(|error| error.to_string())?;
    collect(messages);
    let question = questions
        .iter()
        .find(|(key, _)| key == id)
        .map(|(_, question)| question)
        .ok_or("This Codex question is no longer available.")?;
    // The terminal exposes titles, not item IDs. Never guess between identical questions.
    if questions
        .iter()
        .any(|(key, other)| key != id && normalized(&other.title) == normalized(&question.title))
    {
        return Err("Codex has repeated this question. Answer it in the terminal so the correct question is selected.".into());
    }
    Ok(AsyncAnswer {
        title: question.title.clone(),
        options: question
            .options
            .as_ref()
            .map(|options| options.iter().take(32).filter(|s| s.len() <= 512).count())
            .unwrap_or(0),
        text,
    })
}

fn normalized(text: &str) -> String {
    text.chars().filter(|c| !c.is_whitespace()).collect()
}

fn lines(screen: &str) -> Vec<String> {
    screen
        .lines()
        .map(|line| {
            crate::session_chat_options::strip_ansi_sgr(line)
                .trim()
                .to_string()
        })
        .collect()
}

/// Read the displayed binding, including user remaps, instead of assuming Alt+Up or Ctrl+].
fn key_bytes(label: &str) -> Option<String> {
    let label = label
        .trim()
        .to_lowercase()
        .replace('⌥', "alt")
        .replace('⇧', "shift");
    let parts: Vec<_> = label.split('+').map(str::trim).collect();
    let (key, modifiers) = parts.split_last()?;
    let mut modifier = 1;
    for value in modifiers {
        modifier += match *value {
            "shift" => 1,
            "alt" | "option" => 2,
            "ctrl" | "control" => 4,
            _ => return None,
        };
    }
    let arrow = match *key {
        "↑" | "up" => Some('A'),
        "↓" | "down" => Some('B'),
        "→" | "right" => Some('C'),
        "←" | "left" => Some('D'),
        _ => None,
    };
    if let Some(arrow) = arrow {
        return Some(format!("\x1b[1;{modifier}{arrow}"));
    }
    let code = match *key {
        "enter" | "return" => 13,
        "tab" => 9,
        "space" => 32,
        value if value.chars().count() == 1 => value.chars().next()? as u32,
        _ => return None,
    };
    Some(format!("\x1b[{code};{modifier}u"))
}

fn binding(footer: &str, action: &str) -> Option<String> {
    footer
        .split("   ")
        .map(str::trim)
        .find_map(|tip| key_bytes(tip.strip_suffix(action)?.trim()))
}

#[derive(Debug, Clone)]
struct Editor {
    body: String,
    footer: String,
    position: usize,
    count: usize,
}

fn editor(screen: &str) -> Option<Editor> {
    let rows = lines(screen);
    let end = rows
        .iter()
        .rposition(|row| row.contains(" skip") && row.contains(" submit"))?;
    // A main input after this footer makes it historical output, not the active editor.
    if rows[end + 1..]
        .iter()
        .any(|row| row.starts_with('›') || row.starts_with('»') || row.contains(" to answer"))
    {
        return None;
    }
    let start = rows[..end]
        .iter()
        .rposition(|row| row.contains("Queued follow-up inputs"))?
        + 1;
    let mut body: Vec<_> = rows[start..end]
        .iter()
        .filter(|row| !row.is_empty() && !row.starts_with('↳'))
        .cloned()
        .collect();
    let mut position = 1;
    let mut count = 1;
    // CDXC:SessionChat 2026-09-15 WHY: Codex omits the counter for a single question. "rest of compaction" in its title was mistaken for that counter and made Enter fail before the answer was sent.
    if let Some((current, total)) = body.first().and_then(|row| {
        let (left, right) = row.split_once(" of ")?;
        let (current, total) = (left.parse::<usize>().ok()?, right.parse::<usize>().ok()?);
        (current > 0 && total > 1 && current <= total).then_some((current, total))
    }) {
        position = current;
        count = total;
        body.remove(0);
    }
    // Hints can wrap independently of question and answer rows.
    let mut footer = rows[end].clone();
    for row in &rows[end + 1..] {
        if row.contains("main prompt")
            || row.contains("prev question")
            || row.contains("next question")
            || row.contains("queued messages")
        {
            footer.push_str("   ");
            footer.push_str(row);
        } else if !row.is_empty() {
            return None;
        }
    }
    Some(Editor {
        body: body.join("\n"),
        footer,
        position,
        count,
    })
}

fn question_input<'a>(editor: &'a Editor, title: &str) -> Option<&'a str> {
    let mut expected = title.chars().filter(|c| !c.is_whitespace());
    let mut next = expected.next()?;
    for (index, character) in editor.body.char_indices() {
        if character.is_whitespace() {
            continue;
        }
        if character != next {
            return None;
        }
        match expected.next() {
            Some(character) => next = character,
            None => return Some(&editor.body[index + character.len_utf8()..]),
        }
    }
    None
}

fn matches_question(editor: &Editor, title: &str) -> bool {
    question_input(editor, title)
        .is_some_and(|rest| rest.is_empty() || rest.starts_with(char::is_whitespace))
}

fn collapsed_binding(screen: &str) -> Option<String> {
    let rows = lines(screen);
    let index = rows
        .iter()
        .rposition(|row| row.starts_with("? ") && row.contains(" question"))?;
    binding(rows.get(index + 1)?, "to answer")
}

struct Driver<'a> {
    project_id: &'a str,
    session_id: &'a str,
    zmx_name: &'a str,
    source: &'a str,
    cancelled: &'a (dyn Fn() -> bool + Send + Sync),
}

impl Driver<'_> {
    async fn write(&self, bytes: &str) -> Result<(), String> {
        if (self.cancelled)() {
            return Err("The question action was cancelled.".into());
        }
        write_session_chat_payload(
            self.project_id,
            self.session_id,
            self.zmx_name,
            self.source,
            bytes,
        )
        .await
    }

    async fn wait<T>(
        &self,
        description: &str,
        mut accept: impl FnMut(&str) -> Option<T>,
    ) -> Result<T, String> {
        let deadline = Instant::now() + Duration::from_secs(4);
        loop {
            if (self.cancelled)() {
                return Err("The question action was cancelled.".into());
            }
            if let Some(screen) = capture_session_terminal_text(self.zmx_name).await {
                if let Some(value) = accept(&screen) {
                    return Ok(value);
                }
            }
            if Instant::now() >= deadline {
                return Err(format!("Could not verify {description} in Codex. Your answer is kept here; check the terminal before retrying."));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    async fn open(&self, title: &str) -> Result<Editor, String> {
        let screen = capture_session_terminal_text(self.zmx_name)
            .await
            .ok_or("Could not read Codex's terminal.")?;
        if editor(&screen).is_none() {
            let key = collapsed_binding(&screen)
                .ok_or("Codex is not showing its pending questions. Nothing was submitted.")?;
            self.write(&key).await?;
        }
        let mut current = self.wait("the question editor opening", editor).await?;
        // Always search from the first live question. Previously skipped or answered terminal questions may differ from the transcript list.
        for _ in 0..100 {
            if current.position == 1 {
                break;
            }
            let key = binding(&current.footer, "prev question")
                .ok_or("Codex's previous-question shortcut is unavailable.")?;
            let before = current.position;
            self.write(&key).await?;
            current = self
                .wait("the previous question", |screen| {
                    editor(screen).filter(|e| e.position + 1 == before)
                })
                .await?;
        }
        for _ in 0..100 {
            if matches_question(&current, title) {
                return Ok(current);
            }
            if current.position >= current.count {
                break;
            }
            let key = binding(&current.footer, "next question")
                .ok_or("Codex's next-question shortcut is unavailable.")?;
            let before = current.position;
            self.write(&key).await?;
            current = self
                .wait("the next question", |screen| {
                    editor(screen).filter(|e| e.position == before + 1)
                })
                .await?;
        }
        Err("This question is no longer pending in Codex's terminal. Nothing was submitted.".into())
    }

    async fn run(&self, answer: &AsyncAnswer) -> Result<(), String> {
        let current = self.open(&answer.title).await?;
        if let Some(text) = &answer.text {
            // Bracketed paste switches named choices to Other without a digit shortcut accidentally submitting a different answer.
            if answer.options > 0 {
                self.write("\x1b[200~ \x1b[201~").await?;
                self.wait("the question's text input", |screen| {
                    let e = editor(screen)?;
                    (matches_question(&e, &answer.title)
                        && e.body
                            .lines()
                            .any(|line| line.starts_with(&format!("› {}.", answer.options + 1))))
                    .then_some(())
                })
                .await?;
            }
            // These kill keys act only inside the verified question editor, never the main composer.
            self.write(&"\x1b[117;5u\x1b[107;5u".repeat(80)).await?;
            self.wait("the empty question input", |screen| {
                let e = editor(screen)?;
                if !matches_question(&e, &answer.title) {
                    return None;
                }
                let tail = if answer.options > 0 {
                    e.body
                        .split(&format!("› {}.", answer.options + 1))
                        .nth(1)?
                        .trim()
                } else {
                    question_input(&e, &answer.title)?.trim()
                };
                matches!(
                    tail,
                    "" | "Type your answer" | "Other" | "Other (write an answer)"
                )
                .then_some(())
            })
            .await?;
            self.write(&crate::session_chat_send::wrap_terminal_bracketed_paste_text(text))
                .await?;
            let staged = self
                .wait("your answer in the question input", |screen| {
                    let e = editor(screen)?;
                    if !matches_question(&e, &answer.title) {
                        return None;
                    }
                    let input = if answer.options > 0 {
                        e.body.split(&format!("› {}.", answer.options + 1)).nth(1)?
                    } else {
                        question_input(&e, &answer.title)?
                    };
                    let input = normalized(input);
                    // Codex collapses large pastes into an atomic placeholder. The input was verified empty before this paste.
                    let placeholder = format!("[PastedContent{}chars]", text.chars().count());
                    let pasted = input == placeholder
                        || input.strip_prefix(&placeholder).is_some_and(|suffix| {
                            suffix.strip_prefix('#').is_some_and(|n| {
                                !n.is_empty() && n.chars().all(|c| c.is_ascii_digit())
                            })
                        });
                    (input == normalized(text) || pasted).then_some(e)
                })
                .await?;
            let key = binding(&staged.footer, "submit")
                .ok_or("Codex's question-submit shortcut is unavailable.")?;
            self.write(&key).await?;
        } else {
            let key = binding(&current.footer, "skip")
                .ok_or("Codex's question-skip shortcut is unavailable.")?;
            self.write(&key).await?;
        }
        self.wait("Codex accepting the question action", |screen| {
            if let Some(e) = editor(screen) {
                (e.count < current.count && !matches_question(&e, &answer.title)).then_some(())
            } else {
                // Closing an unrelated dialog is not an acknowledgement. The final question must return to the real composer.
                (current.count == 1
                    && crate::session_chat_composer::detect_session_chat_composer_readiness(
                        Some("codex"),
                        screen,
                        None,
                    )
                    .state
                        == crate::session_chat_composer::SessionChatComposerState::Ready)
                    .then_some(())
            }
        })
        .await
    }

    // Codex advances after accepting a question, and a failed lookup may also leave one focused. Restore the main prompt on either outcome so an ordinary chat send cannot answer another question accidentally.
    async fn return_to_main_prompt(&self) -> Result<(), String> {
        for _ in 0..100 {
            let screen = capture_session_terminal_text(self.zmx_name)
                .await
                .ok_or("Could not read Codex's terminal after answering.")?;
            let Some(current) = editor(&screen) else {
                return Ok(());
            };
            let action = if current.position == 1 {
                "main prompt"
            } else {
                "prev question"
            };
            let key = binding(&current.footer, action)
                .ok_or("Codex's main-prompt shortcut is unavailable.")?;
            self.write(&key).await?;
            self.wait("returning to the main prompt", |screen| {
                if current.position == 1 {
                    (editor(screen).is_none() && collapsed_binding(screen).is_some()).then_some(())
                } else {
                    editor(screen)
                        .filter(|e| e.position + 1 == current.position)
                        .map(|_| ())
                }
            })
            .await?;
        }
        Err("Codex could not return to its main prompt. Check the terminal before sending another message.".into())
    }
}

pub(crate) async fn run(
    project_id: &str,
    session_id: &str,
    zmx_name: &str,
    source: &str,
    answer: &AsyncAnswer,
    cancelled: &(dyn Fn() -> bool + Send + Sync),
) -> Result<(), String> {
    let driver = Driver {
        project_id,
        session_id,
        zmx_name,
        source,
        cancelled,
    };
    let outcome = driver.run(answer).await;
    let restored = driver.return_to_main_prompt().await;
    outcome.and(restored)
}

#[cfg(test)]
mod tests {
    use super::*;

    const QUESTIONS: &str = "• Working (0s • esc to interrupt)\n\n• Queued follow-up inputs\n  ↳ another message\n\n  2 of 3\n\n  Which layout?\n\n  › 1. Compact\n    2. Spacious\n    3. Other\n\n  enter submit   ctrl + ] skip   ⌥ + ↓ prev question   ⌥ + ↑ next question\n";

    #[test]
    fn targets_the_active_question_not_queued_or_historical_text() {
        let e = editor(QUESTIONS).unwrap();
        assert_eq!((e.position, e.count), (2, 3));
        assert!(matches_question(&e, "Which layout?"));
        assert!(!matches_question(&e, "Compact"));
        assert!(!matches_question(&e, "Which layout"));
        assert!(editor(&(QUESTIONS.to_string() + "\n› Main composer draft\n")).is_none());
        assert!(
            editor(&(QUESTIONS.to_string() + "\n? 3 questions\n  ⌥ + ↑ to answer\n")).is_none()
        );
    }

    #[test]
    fn question_titles_can_wrap_without_matching_answer_text() {
        let screen = QUESTIONS.replace("Which layout?", "Which very long\n  layout?");
        let e = editor(&screen).unwrap();
        assert!(matches_question(&e, "Which very long layout?"));
        assert!(!matches_question(&e, "Which very long layout? Compact"));
    }

    #[test]
    fn single_idle_question_containing_of_is_not_a_progress_counter() {
        let title = "Did the chat percentage stay at 66% for the rest of compaction, or did it catch up when you switched back from the terminal?";
        let screen = format!("• Queued follow-up inputs\n\n  {title}\n\n  Type your answer\n\n  enter submit   ctrl + ] skip   ⌥ + ↓ main prompt");
        let e = editor(&screen).expect("single question editor remains answerable");
        assert_eq!((e.position, e.count), (1, 1));
        assert!(matches_question(&e, title));
        assert_eq!(
            question_input(&e, title).unwrap().trim(),
            "Type your answer"
        );

        let staged = screen.replace("Type your answer", "yes catches up when i switch back");
        let e = editor(&staged).expect("staged single answer remains detectable");
        assert_eq!(
            question_input(&e, title).unwrap().trim(),
            "yes catches up when i switch back"
        );
    }

    #[test]
    fn uses_displayed_question_shortcuts_and_rejects_unknown_bindings() {
        let e = editor(QUESTIONS).unwrap();
        assert_eq!(
            binding(&e.footer, "next question").as_deref(),
            Some("\x1b[1;3A")
        );
        assert_eq!(binding(&e.footer, "skip").as_deref(), Some("\x1b[93;5u"));
        assert_eq!(
            binding("shift + ← to answer", "to answer").as_deref(),
            Some("\x1b[1;2D")
        );
        assert_eq!(key_bytes("unknown + x"), None);
    }
}
