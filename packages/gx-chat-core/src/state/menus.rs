//! Family e's state: the model picker, the option pills and their menus, accounts, context details
//! and the fork branch picker.
//!
//! **This file belongs to family e (menus, pickers, options, accounts, context).** No other family
//! edits it. Fill it with what `packages/shared/session-chat-presentation/model-menu.ts`,
//! `model-picker.ts`, `accounts.ts`, `context-details.ts`, `option-menu.ts`, `fork-branches.ts`
//! and the controller's `option-state.ts`, `model-selection.ts`, `native-options.ts`,
//! `native-accounts.ts`, `native-context.ts` keep: which menu is open, the picker's input and
//! highlight, the model favorites, the selection outbox, the accounts read and its clock, and the
//! context rows being edited.
//!
//! Read from, never write to: `ChatState::session::selected_options` (family a merges it by
//! evidence priority and `detectedAt`; the document key `selectedOptions` is yours to publish),
//! `ChatState::session::account_switch`, `ChatState::session::pending_model_selection`,
//! `ChatState::session::available_agents`, `ChatState::session::switchable_agents`,
//! `ChatState::session::screen_probed` (latched: it decides between a loading skeleton and a plain
//! unset pill).

/// What the menus, pickers and context surfaces remember between frames.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MenusState {}
