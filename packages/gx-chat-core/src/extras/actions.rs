//! Family f's user actions: the panels, transcript search, the terminal tail, the subagent viewer
//! and Save to Markdown.

use crate::action::{ActionKind, UserAction};
use crate::effect::Effect;
use crate::state::{ChatContext, ChatState};

/// Handles one action family f owns.
pub fn handle(state: &mut ChatState, action: &UserAction, context: &ChatContext) -> Vec<Effect> {
    let _ = (&state, context);
    match action.kind {
        ActionKind::ToggleAgentFleet
        | ActionKind::ToggleAgentTasks
        | ActionKind::ToggleAgentTasksCompleted
        | ActionKind::SearchOpen
        | ActionKind::SearchClose
        | ActionKind::SearchQuery
        | ActionKind::SearchNext
        | ActionKind::SearchPrevious
        | ActionKind::TerminalTailHover
        | ActionKind::TerminalTailToggle
        | ActionKind::OpenSubagent
        | ActionKind::SubagentBack
        | ActionKind::SubagentClose
        | ActionKind::SubagentRetry
        | ActionKind::SubagentLoadEarlier
        | ActionKind::MarkdownSaveOpen
        | ActionKind::MarkdownSaveFolder
        | ActionKind::MarkdownSaveName
        | ActionKind::MarkdownSaveCancel
        | ActionKind::MarkdownSaveSubmit => Vec::new(),
        _ => Vec::new(),
    }
}
