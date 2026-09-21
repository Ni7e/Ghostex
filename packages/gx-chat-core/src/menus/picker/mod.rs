//! Family e2: the model picker, the model menu, model selection, model favorites and the fork
//! branch picker.
//!
//! This subdirectory is family e2's alone. Family e1 owns the rest of `src/menus/` and calls the
//! two entry points below from `menus/document.rs` and `menus/actions.rs`, so e2 never edits an
//! e1 file. Document keys: `modelMenuContext`, `modelMenu`, `modelPicker`, `modelProvider`,
//! `modelSelection`, `pendingModelSelection`, `forkBranches`. Actions: `toggleModelPicker`,
//! `modelPicker*`, `modelMenu*`, `selectForkBranch`.

pub mod actions;
pub mod agents;
pub mod artwork;
pub mod document;
pub mod favorites;
pub mod feedback;
pub mod fork_branches;
pub mod input;
pub mod js;
pub mod model_menu;
pub mod model_picker;
pub mod native;
pub mod projection;
pub mod request;
pub mod selection;
pub mod settle;
pub mod traits;

pub use crate::menus::picker::actions::handle;
pub use crate::menus::picker::document::document;
pub use crate::menus::picker::fork_branches::{ForkBranch, ForkBranchRow, ForkBranchTone};
pub use crate::menus::picker::model_menu::{ModelMenuEntry, ModelMenuRow, ModelMenuTabId, ModelMenuView};
pub use crate::menus::picker::model_picker::{
    ModelPickerProvider, ModelPickerRequest, ModelPickerSelection, ModelSelectionScope,
};
pub use crate::menus::picker::native::{ModelPickerOutcome, ModelPickerState};
pub use crate::menus::picker::projection::{ModelMenuContext, ModelMenuPick};
pub use crate::menus::picker::selection::{ModelSelectionIntent, ModelSelectionState};
pub use crate::menus::picker::settle::settle;
