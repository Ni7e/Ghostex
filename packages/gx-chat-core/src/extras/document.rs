//! Family f's part of the document: the panels, the working strip, the terminal tail, the empty
//! state and the loading stage.

use crate::document::Document;
use crate::state::{ChatContext, ChatState};

/// Writes family f's keys into `into`.
///
/// `agentFleet`, `agentTasks` and `terminalActivity` are folded by family a and cleared by any
/// frame that can carry them and does not; the strips and panels here are their projections and
/// are never gated on `working`, because subagents outlive the turn that spawned them.
pub fn document(state: &ChatState, _context: &ChatContext, into: &mut Document) {
    let _ = (state, into);
}
