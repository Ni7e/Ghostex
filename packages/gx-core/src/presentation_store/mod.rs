//! Per-machine presentation state: the last daemon snapshot, deltas on top, and local overlays.

mod apply;
mod loaded;
mod local_edits;
mod reducers;
mod settle;
mod snapshot_out;
mod store;

pub use apply::SnapshotOrigin;
pub use loaded::LoadedPresentation;
pub use snapshot_out::{snapshot_storage_json, sorted_json};
pub use store::{
    MachinePresentation, PresentationState, PresentationStore, SideState, SideStateUpdate,
};
