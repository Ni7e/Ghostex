//! The two question surfaces: the card the agent blocks on, and the async questions a working
//! agent collects answers for without stopping.

use serde::{Deserialize, Serialize};

/// The blocking question card.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionCard {
    pub visible: bool,
    /// Which question of the set the card is showing.
    pub question_index: u32,
    pub controls: QuestionControls,
    pub drafts: Vec<QuestionDraft>,
    /// The answer is in flight.
    pub answering: bool,
    /// Answering, or moving between questions: either way the controls are held.
    pub busy: bool,
    /// The saved answers are still being read back.
    pub loading: bool,
}

/// The card's primary button.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionControls {
    pub has_answer: bool,
    pub disabled: bool,
    pub label: String,
}

/// One question's saved answer: the chosen options plus free text.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionDraft {
    pub indices: Vec<u32>,
    pub other: String,
}

/// The async question strip a working agent shows above the composer.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AsyncQuestions {
    pub draft: QuestionDraft,
    pub index: u32,
    pub count: u32,
    /// The answer text as it will be sent.
    pub answer: String,
    pub disabled: bool,
    pub can_send: bool,
    pub working: bool,
    pub collapsed: bool,
    pub submitting: bool,
    pub loading: bool,
    pub error: String,
    pub previous_disabled: bool,
    pub next_disabled: bool,
    pub selected: Vec<u32>,
}
