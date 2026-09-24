//! The native GPUI Automate view (the view panel's automations page) and its create/edit dialog.
//! SEE-ALSO: apps/desktop/views/project-board/automations.tsx, automation-dialog.tsx and
//! automations-drafts.ts (the React page this ports), app/helpers/board_gxserver/automation.rs
//! (the bridge logic both call).
mod actions;
mod detail;
mod dialog;
mod dialog_render;
mod drafts;
mod host;
mod lists;
mod model;
mod render;
mod requests;
mod style;
mod view;

pub(crate) use style::{AutomatePalette, secondary_button};
pub(crate) use view::NativeAutomateView;
