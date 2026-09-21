//! Family e's state: the model picker, the option pills and their menus, accounts, context details
//! and the fork branch picker.
//!
//! **This file belongs to family e (menus, pickers, options, accounts, context).** No other family
//! edits it. Family e1 owns the option, account and settings fields; family e2 owns
//! [`MenusState::picker`] and [`MenusState::context`], the two boxes its subdirectories fill.
//!
//! Read from, never write to: `ChatState::session::selected_options` (family a merges it by
//! evidence priority and `detectedAt`; the document key `selectedOptions` is yours to publish),
//! `ChatState::session::account_switch`, `ChatState::session::pending_model_selection`,
//! `ChatState::session::available_agents`, `ChatState::session::switchable_agents`,
//! `ChatState::session::screen_probed` (latched: it decides between a loading skeleton and a plain
//! unset pill).

use serde_json::Value;

use crate::menus::account_switch::AccountSwitchState;
use crate::menus::catalog::AgentModelCatalog;
use crate::menus::option_store::OptionStore;

/// What the menus, pickers, options, accounts and context surfaces remember between frames.
#[derive(Clone, Debug, PartialEq)]
pub struct MenusState {
    /// The agent model catalog in effect, pushed in by the host. Empty until the first push, which
    /// is what leaves a session with no pills rather than pills naming models it cannot run.
    pub model_catalog: AgentModelCatalog,
    /// The key the option values are stored under, `None` for a session with no key yet.
    ///
    /// CDXC:Drafts 2026-08-28 WHY:
    /// A session that has never been a draft in this client keeps the original key, so every
    /// existing session still reads exactly what it stored. A draft appends `#<agentId>`, which is
    /// what makes switching its agent CLI start from that agent's own values instead of carrying
    /// the previous CLI's dispatched model. The suffix LATCHES for the life of this core:
    /// promotion (the first send) stops the daemon sending `availableAgents`, and without the
    /// latch the key would move back mid-session and drop a dispatched value gxserver has not
    /// confirmed yet.
    pub session_key: Option<String>,
    /// The draft agent id the storage key latched onto, with the session key it was latched for.
    pub latched_draft_agent: Option<(String, Option<String>)>,
    /// The option values and the changes still in flight.
    pub options: OptionStore,
    /// The agent the option store was built for, so an agent change rebuilds it.
    pub options_agent: Option<String>,
    /// The `updatedAt` of the catalog the option store was built for.
    pub options_catalog_version: String,
    /// The stored option state the host handed over at boot, replayed when the store is rebuilt.
    pub stored_options: Value,
    /// `true` once the boot read has answered, so a rebuild does not seed from nothing.
    pub options_seeded: bool,

    /// The last `agentAccounts` answer, absent until the first read lands.
    pub accounts: Option<Value>,
    /// The last account read's failure, absent while it succeeded.
    pub account_error: Option<String>,
    /// A read is in flight, which the panel draws as busy.
    pub accounts_busy: bool,
    /// The generation of the account read in flight, so a stale answer is dropped.
    pub accounts_generation: u64,
    /// The accounts read in flight, so its answer reaches family e and nothing else.
    pub accounts_request: Option<u64>,
    /// When the last periodic account read started, for the 30 second poll.
    pub accounts_polled_at_ms: Option<i64>,
    /// What the poll was keyed on, so a provider or switch change re-reads at once.
    pub accounts_key: Option<String>,
    /// The account-switch card's own machine.
    pub account_switch: AccountSwitchState,

    /// The descriptor id of the option dispatch in flight, or `None`.
    pub option_dispatch_id: Option<String>,
    /// A cyclic mode change is walking the TUI, which holds sending until it lands.
    pub option_switching: bool,
    /// Whether the transport can type a raw key into the agent (`chat.sendKey`).
    pub can_send_key: bool,
}

/// The state a chat opens with.
///
/// Hand-written rather than derived because `can_send_key` starts TRUE: every gxserver transport
/// accepts a raw key, and a host whose transport does not clears it. A derived `false` would hide
/// the Shift+Tab permission cycler and every other keystroke row on a `ChatState::default()`,
/// which is what `ChatCore::new` builds.
impl Default for MenusState {
    fn default() -> Self {
        Self {
            model_catalog: AgentModelCatalog::default(),
            session_key: None,
            latched_draft_agent: None,
            options: OptionStore::default(),
            options_agent: None,
            options_catalog_version: String::new(),
            stored_options: Value::Null,
            options_seeded: false,
            accounts: None,
            account_error: None,
            accounts_busy: false,
            accounts_generation: 0,
            accounts_request: None,
            accounts_polled_at_ms: None,
            accounts_key: None,
            account_switch: AccountSwitchState::default(),
            option_dispatch_id: None,
            option_switching: false,
            can_send_key: true,
        }
    }
}

impl MenusState {
    /// The state a chat opens with.
    pub fn new() -> Self {
        Self::default()
    }
}
