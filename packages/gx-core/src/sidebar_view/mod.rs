//! The sidebar list as data: the groups, sections, rows, collections, Spaces, and empty state the
//! native renderer draws.
//!
//! The pipeline mirrors the TypeScript one it replaces, in the same order: project facts
//! (`projects`), which sessions belong to which group (`membership`), one row per session
//! (`rows`, `session_text`), the order and sections of a group (`ordering`, `sections`,
//! `groups`), and the list around them (`spaces`, `collections`, `assemble`). `model` holds the
//! cache that keeps all of it up to date from a `ChangeSummary`, and `inputs` and `view` are the
//! two ends a host talks to.

mod agents;
mod assemble;
mod collections;
mod groups;
mod inputs;
mod membership;
mod model;
mod ordering;
mod projects;
mod reveal;
mod rows;
mod sections;
mod session_text;
mod spaces;
mod tags;
mod text;
mod view;

pub use inputs::{
    BrowserTabInput, CloseAfterDoneInput, DelayedSendInput, ProjectDiffStats, SectionCollapse,
    SectionId, SessionSortMode, SidebarCollapseState, SidebarHiddenItems, SidebarHostInputs,
    SidebarInputs, SidebarSettings, SidebarUiState, UnavailableState, LOCAL_MACHINE_ID,
};
pub use model::SidebarViewModel;
pub use reveal::{reveal_plan, SidebarRevealPlan};
pub use spaces::OTHER_SPACE_ID;
pub use tags::{TagListItem, TagListItemKind, TagPresentation, UNTAGGED_TAG_FILTER};
pub use view::{
    CollectionView, DelayedSendView, EmptyState, GroupCore, GroupSummary, GroupView,
    MachineSummary, OrderItem, OrderKind, ProjectContextView, SectionView, SessionRow,
    SessionTiming, SessionView, SidebarView, SpaceView, WorktreeView,
};
