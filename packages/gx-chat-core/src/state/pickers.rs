//! Family e2's state: the model picker, the model menu, model selection, model favorites, the
//! fork branch family, and the context meter, editor and details.
//!
//! **This file belongs to family e2.** Family e1 owns `state/menus.rs` and the rest of
//! `src/menus/`; e2 owns `src/menus/picker/` and `src/menus/context/` and this struct. No other
//! family edits it.
//!
//! Read from, never write to: `ChatState::session::selected_options` (family a merges it by
//! evidence priority and `detectedAt`), `ChatState::session::pending_model_selection`,
//! `ChatState::session::available_agents`, `ChatState::session::agent_session_id`,
//! `ChatState::core::title` and `ChatState::core::hide_account_emails`.

use serde_json::Value;

use crate::menus::context::{ContextDetailsAgent, ContextDetailsPreferences, ContextEditorState};
use crate::menus::picker::catalog::AgentModelCatalog;
use crate::menus::picker::model_menu::ModelMenuCatalogs;
use crate::menus::picker::projection::model_menu_projection;
use crate::menus::picker::{
    ForkBranch, ModelMenuContext, ModelMenuRow, ModelMenuView, ModelPickerState,
    ModelSelectionIntent, ModelSelectionState,
};

/// What family e2's surfaces remember between frames.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PickersState {
    /// The model menu's inputs, or `None` for an agent outside the model catalog.
    ///
    /// Family e1's `computeNativeChatOptions` fills this from the session option catalog; e2
    /// reads it, publishes it and picks against it.
    pub model_menu_context: Option<ModelMenuContext>,
    /// Every provider's model lineup, as e1's session option catalog answers it.
    pub catalogs: ModelMenuCatalogs,
    /// The published agent model catalog the host pushes in.
    pub catalog: AgentModelCatalog,
    /// The full model picker window, or `None` when it is closed.
    pub model_picker: Option<ModelPickerState>,
    /// The merged model pill's menu: which tab is open and what was typed into its search.
    ///
    /// `tab` of `None` is "not opened yet", which is what makes the opening tab the session's own
    /// agent (`modelMenuOpeningTab`). The renderer resets it by sending `modelMenuView` with a
    /// null tab.
    pub model_menu_view: ModelMenuView,
    /// The starred models, the one list the person owns rather than a session or a renderer.
    ///
    /// Stored as the raw `provider:value` keys, which is the record format
    /// `ghostex.model-favorites` has on disk; it must not change.
    pub model_favorites: Vec<String>,
    /// Whether the favorites list has been read back from storage at least once.
    pub model_favorites_loaded: bool,
    /// The model selection outbox and what it is waiting for.
    pub model_selection: ModelSelectionState,
    /// The branch family this conversation belongs to, read once per chat.
    pub fork_branches: ForkBranchesState,
    /// The context meter, its editor and its status line.
    pub context: ContextState,
}

impl PickersState {
    /// The outbox entry, else the pending selection gxserver reports, which is what the picker
    /// opens on and what `modelSelectionUnchanged` compares against (`model-selection.ts`).
    pub fn desired_selection(&self) -> Option<&ModelSelectionIntent> {
        self.model_selection.desired()
    }

    /// `modelMenuProjection(context, modelMenuView)`.
    pub fn model_menu_projection(&self, menu: &ModelMenuContext) -> Value {
        model_menu_projection(
            menu,
            &self.model_menu_view,
            &self.catalogs,
            &self.model_favorites,
            &self.catalog,
        )
    }

    /// The rows the open menu shows, which is what a `modelMenuPick` looks its key up in.
    pub fn model_menu_rows(&self, menu: &ModelMenuContext) -> Vec<ModelMenuRow> {
        crate::menus::picker::projection::model_menu_visible_rows(
            menu,
            &self.model_menu_view,
            &self.catalogs,
            &self.model_favorites,
        )
    }
}

/// The branch switcher's memory.
///
/// CDXC:SessionFork 2026-09-18 WHY:
/// The family is read ONCE per chat and kept: it only changes when a session is forked or
/// retired, both of which land the user on a different session and therefore a different chat
/// state. A daemon that predates `/api/sessionForkBranches`, or a call that failed, leaves the
/// strip unrendered rather than showing an empty menu.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ForkBranchesState {
    /// The read has been issued; it is never issued again.
    pub asked: bool,
    /// The daemon's own order (newest activity first). An empty answer is never adopted.
    pub branches: Vec<ForkBranch>,
}

/// The context meter, the row editor and the measured status line.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ContextState {
    /// The saved row preferences, per agent. Claude and Codex are saved independently.
    pub preferences: ContextPreferencesByAgent,
    /// The row editor's draft, or `None` when the dialog is closed.
    pub editor: Option<ContextEditorState>,
    /// The session's agent icon, which chooses the catalog. Family e1's session option catalog
    /// answers it (`sessionOptions.catalog?.modelIcon`).
    pub agent_icon: Option<String>,
    /// The saved account assigned to this session, which family e1's accounts read answers.
    pub account: Option<crate::menus::context::AgentAccount>,
    /// Where the status line wraps, as the renderer measured it. `[0]` until it reports.
    pub status_rows: Vec<u32>,
    /// When the meter's countdown labels are next re-rendered (`native-context.ts`, 30 s).
    pub next_meter_refresh_ms: Option<f64>,
}

/// One preferences record per agent.
///
/// CDXC:AgentProviders 2026-09-08 DECISION:
/// User: keep the same Claude UI and status line, but save popover and status-line settings
/// independently for Claude and Codex.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ContextPreferencesByAgent {
    pub claude: ContextDetailsPreferences,
    pub codex: ContextDetailsPreferences,
}

impl ContextPreferencesByAgent {
    /// The record for one agent.
    pub fn get(&self, agent: ContextDetailsAgent) -> &ContextDetailsPreferences {
        match agent {
            ContextDetailsAgent::Claude => &self.claude,
            ContextDetailsAgent::Codex => &self.codex,
        }
    }

    /// The record for one agent, to replace it.
    pub fn get_mut(&mut self, agent: ContextDetailsAgent) -> &mut ContextDetailsPreferences {
        match agent {
            ContextDetailsAgent::Claude => &mut self.claude,
            ContextDetailsAgent::Codex => &mut self.codex,
        }
    }
}
