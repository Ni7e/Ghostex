//! The composer's merged model pill opens this picker: agent tabs, a model search, starred rows,
//! and a footer of settings that open a side list.

mod flyout;
mod keys;
mod render;
mod state;
mod style;

pub(super) use flyout::flyout_height;
pub(super) use state::{ModelMenuState, menu_height};
