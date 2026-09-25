//! Puts an arrow-driven question list (Cursor Agent's AskQuestion, pi's
//! cursor_ask_question select, omp's ask dialog) on the question and row an
//! answer step expects, from the screen as it is when the step runs.

use std::time::Duration;

use crate::session_chat_send::{capture_session_terminal_text, write_session_chat_payload};

const PREVIOUS_ROW: &str = "\u{1b}[A"; // Up
const NEXT_ROW: &str = "\u{1b}[B"; // Down
const PREVIOUS_QUESTION: &str = "\u{1b}[D"; // Left
const NEXT_QUESTION: &str = "\u{1b}[C"; // Right
const SETTLE_MS: u64 = 250;
const MAX_ATTEMPTS: usize = 6;

/// Which agent's list is on screen: they differ in the highlight marker and in
/// whether the user can move between questions.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QuestionListUi {
    /// `› [ ] Red`, ←/→ between questions.
    Cursor,
    /// `→ Red`, one question at a time.
    Pi,
    /// `❯ ○ Red`, ←/→ (or Tab) between question tabs.
    Omp,
}

impl QuestionListUi {
    fn marker(self) -> char {
        match self {
            QuestionListUi::Cursor => '›',
            QuestionListUi::Pi => '→',
            QuestionListUi::Omp => '❯',
        }
    }

    fn moves_between_questions(self) -> bool {
        !matches!(self, QuestionListUi::Pi)
    }
}

/// Where an answer step needs the list: `row` is an option index, or
/// `labels.len()` for the free-text row after the options.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QuestionRowTarget {
    pub ui: QuestionListUi,
    /// Every question's text, in order, to tell which one is on screen.
    pub questions: Vec<String>,
    pub question: usize,
    pub labels: Vec<String>,
    pub row: usize,
}

/// What the list shows right now.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct QuestionListScreen {
    pub question: usize,
    /// Read only on the target question: the labels belong to it.
    pub highlighted: Option<usize>,
}

fn compact(text: &str) -> String {
    text.chars().filter(|c| !c.is_whitespace()).collect()
}

fn screen_lines(screen: &str) -> Vec<String> {
    screen
        .lines()
        .map(|line| {
            crate::session_chat_options::strip_ansi_sgr(line)
                .trim()
                .trim_matches(['│', '┃'])
                .trim()
                .to_string()
        })
        .collect()
}

/// The row text without its checkbox or radio glyph.
fn row_text(line: &str) -> &str {
    let mut text = line.trim_start();
    loop {
        if let Some(rest) = text.strip_prefix('[').and_then(|rest| {
            let (inside, rest) = rest.split_once(']')?;
            (inside.chars().count() <= 1).then_some(rest)
        }) {
            text = rest.trim_start();
        } else if let Some(rest) = text.strip_prefix(['○', '●', '◉', '◯', '☐', '☑', '☒', '✓', '✔'])
        {
            text = rest.trim_start();
        } else {
            return text;
        }
    }
}

fn question_on_line(line: &str, question: &str) -> bool {
    // Cursor numbers its questions ("1. Which color?").
    let line = line
        .split_once(". ")
        .filter(|(number, _)| number.parse::<usize>().is_ok())
        .map_or(line, |(_, rest)| rest);
    let (line, question) = (compact(line), compact(question));
    !line.is_empty() && (line == question || (line.len() >= 16 && question.starts_with(&line)))
}

/// Reads the live list. `None` when no question of `target` is on screen or
/// its highlight cannot be placed on an option or the free-text row.
pub fn read_question_list_screen(
    target: &QuestionRowTarget,
    screen: &str,
) -> Option<QuestionListScreen> {
    let lines = screen_lines(screen);
    // Earlier questions can still be on screen (omp previews them all in its
    // tool call); the live one is the lowest.
    let (heading, question) = target
        .questions
        .iter()
        .enumerate()
        .filter_map(|(index, question)| {
            lines
                .iter()
                .rposition(|line| question_on_line(line, question))
                .map(|line| (line, index))
        })
        .max()?;
    if question != target.question {
        return Some(QuestionListScreen {
            question,
            highlighted: None,
        });
    }
    let labels: Vec<String> = target.labels.iter().map(|label| compact(label)).collect();
    let marker = target.ui.marker();
    let mut seen_option = false;
    for line in &lines[heading + 1..] {
        let marked = line.starts_with(marker);
        let text = compact(row_text(line.trim_start_matches(marker)));
        // The longest label wins, so "Blue green" is not read as "Blue".
        let option = labels
            .iter()
            .enumerate()
            .filter(|(_, label)| !label.is_empty() && text.starts_with(label.as_str()))
            .max_by_key(|(_, label)| label.len())
            .map(|(index, _)| index);
        if marked {
            let highlighted = match option {
                Some(index) => index,
                // The free-text row follows the options.
                None if seen_option => labels.len(),
                None => return None,
            };
            return Some(QuestionListScreen {
                question,
                highlighted: Some(highlighted),
            });
        }
        seen_option |= option.is_some();
    }
    None
}

/// The one write that brings the list closer to `target`, or `None` once it
/// is there. `Err` when the list shows another question it cannot leave.
pub fn next_question_row_keys(
    target: &QuestionRowTarget,
    screen: &QuestionListScreen,
) -> Result<Option<String>, ()> {
    if screen.question != target.question {
        if !target.ui.moves_between_questions() {
            return Err(());
        }
        return Ok(Some(if target.question < screen.question {
            PREVIOUS_QUESTION.repeat(screen.question - target.question)
        } else {
            NEXT_QUESTION.repeat(target.question - screen.question)
        }));
    }
    let highlighted = screen.highlighted.ok_or(())?;
    Ok(match target.row.cmp(&highlighted) {
        std::cmp::Ordering::Equal => None,
        std::cmp::Ordering::Less => Some(PREVIOUS_ROW.repeat(highlighted - target.row)),
        std::cmp::Ordering::Greater => Some(NEXT_ROW.repeat(target.row - highlighted)),
    })
}

/// CDXC:SessionChat 2026-09-25 DECISION:
/// User: "make gxserver move the highlight back before answering". Cursor, pi and omp lists are driven with arrows counted from where the list opens, so a highlight the user moved in the terminal (or a question tab they switched to) made Space or Enter land on the wrong row. Every row these plans act on is reached through this step, which reads the list when the step runs and moves by the exact difference, never across the wrap. A screen it cannot read stops the answer instead of typing blind.
/// SEE-ALSO: build_cursor_ask_answer_keys, build_pi_ask_answer_keys and build_omp_ask_answer_keys in server/src/session_chat_send.rs.
pub(crate) async fn align_question_row(
    project_id: &str,
    session_id: &str,
    zmx_name: &str,
    source: &str,
    target: &QuestionRowTarget,
    superseded: &(dyn Fn() -> bool + Send + Sync),
) -> Result<(), String> {
    let lost =
        || "The agent's question is no longer on screen, so the answer was not sent.".to_string();
    for _ in 0..MAX_ATTEMPTS {
        if superseded() {
            return Err("The answer was superseded before it reached the agent.".to_string());
        }
        let screen = capture_session_terminal_text(zmx_name)
            .await
            .and_then(|screen| read_question_list_screen(target, &screen))
            .ok_or_else(lost)?;
        let Some(keys) = next_question_row_keys(target, &screen).map_err(|()| lost())? else {
            return Ok(());
        };
        write_session_chat_payload(project_id, session_id, zmx_name, source, &keys).await?;
        tokio::time::sleep(Duration::from_millis(SETTLE_MS)).await;
    }
    Err(
        "The agent's question did not move to the answer's row. Answer it in the terminal."
            .to_string(),
    )
}
