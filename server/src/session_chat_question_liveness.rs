//! Whether the question a chat card answers is still a live selector on the
//! agent's screen, and how the answer is delivered when it is not.

use crate::session_chat::{SessionChatQuestion, SessionChatQuestionSelection};

/// Long labels can be clipped or wrapped by the selector, so only this many
/// leading characters of the first option have to be on screen.
const LIVE_LABEL_PREFIX_CHARS: usize = 24;

/*
CDXC:AgentScreenDetection 2026-09-21 WHY:
Claude's AskUserQuestion answer is a run of selector digits, which only mean
something while the selector is on screen. A resumed Claude process cancels the
pending question ("[Request interrupted by user for tool use]") and shows its
plain composer, while the chat card can still be up for the few seconds the
resume takes. Observed 2026-09-21: a two-question card answered right after a
resume typed "1", "1", Enter into the composer and submitted the prompt "11".
The digits are therefore written only when a capture taken right now shows the
selector's first row ("1. <first option>"); otherwise the question is no longer
being asked and the answer goes to the agent as an ordinary message.
*/
pub fn claude_question_selector_on_screen(
    questions: &[SessionChatQuestion],
    screen_text: &str,
) -> bool {
    let Some(first_label) = questions
        .first()
        .and_then(|question| question.options.first())
        .map(|option| option.label.trim())
        .filter(|label| !label.is_empty())
    else {
        // Nothing to look for: the card has no numbered rows to compare.
        return true;
    };
    let prefix: String = first_label.chars().take(LIVE_LABEL_PREFIX_CHARS).collect();
    let prefix = prefix.trim_end();
    // Multi-select rows put a checkbox between the number and the label.
    screen_text.lines().any(|line| {
        line.split_once("1. ")
            .is_some_and(|(_, row)| row.contains(prefix))
    })
}

/// The answer as a message the agent can read without the selector: every
/// question with its picked labels, in order.
pub fn format_ask_answer_message(
    questions: &[SessionChatQuestion],
    selections: &[SessionChatQuestionSelection],
) -> String {
    let lines: Vec<String> = questions
        .iter()
        .enumerate()
        .filter_map(|(index, question)| {
            let selection = selections.get(index)?;
            let mut labels: Vec<String> = selection
                .indices
                .iter()
                .filter_map(|option_index| question.options.get(*option_index))
                .map(|option| option.label.trim().to_string())
                .filter(|label| !label.is_empty())
                .collect();
            let other = selection.other.as_deref().unwrap_or_default().trim();
            if !other.is_empty() {
                labels.push(other.to_string());
            }
            (!labels.is_empty()).then(|| {
                format!(
                    "- {} Answer: {}",
                    question.question.trim(),
                    labels.join(", ")
                )
            })
        })
        .collect();
    format!("My answers to your questions:\n{}", lines.join("\n"))
}
