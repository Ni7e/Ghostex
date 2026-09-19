//! Per-machine presentation state: the last daemon snapshot, deltas on top, and local overlays.

mod apply;
mod loaded;
mod local_edits;
mod reducers;
mod settle;
mod store;

pub use apply::SnapshotOrigin;
pub use loaded::LoadedPresentation;
pub use store::{
    MachinePresentation, PresentationState, PresentationStore, SideState, SideStateUpdate,
};
