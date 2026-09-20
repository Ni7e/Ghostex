//! The sidebar list as data: the groups, sections, rows, collections, Spaces, and empty state the
//! native renderer draws.
//!
//! The pipeline mirrors the TypeScript one it replaces, in the same order: project facts
//! (`projects`), which sessions belong to which group (`membership`), one row per session
//! (`rows`, `session_text`), the order and sections of a group (`ordering`, `sections`,
//! `groups`), and the list around them (`spaces`, `collections`, `assemble`). `model` holds the
//! cache that keeps all of it up to date from a `ChangeSummary`, and `inputs` and `view` are the
//! two ends a host talks to.

pub(crate) mod agents;
mod assemble;
pub(crate) mod collections;
mod groups;
mod inputs;
mod machines;
pub(crate) mod membership;
mod model;
pub(crate) mod ordering;
pub(crate) mod projects;
mod reveal;
mod rows;
mod sections;
mod session_text;
pub(crate) mod spaces;
pub(crate) mod tags;
pub(crate) mod text;
pub(crate) mod slot_hotkey;
pub(crate) mod view;

pub use inputs::{
    BrowserTabInput, BrowserTabsInput, CloseAfterDoneInput, DelayedSendInput, MachineTabInput,
    ProjectDiffStats, SectionCollapse, SectionId, SessionSortMode, SidebarCollapseState,
    SidebarHiddenItems, SidebarHostInputs, SidebarInputs, SidebarSettings, SidebarUiState,
    UnavailableState, LOCAL_MACHINE_ID, MACHINE_STATE_CONNECTED,
    MAX_RECENT_SPACE_SESSION_IDS,
};
pub use model::{SidebarUpdateWork, SidebarViewModel};
pub use ordering::session_is_snoozed;
pub use reveal::{reveal_plan, space_for_focused_row, FocusedRowSpace, SidebarRevealPlan};
pub use slot_hotkey::{project_slot_plan, ProjectSlotPlan};
pub use collections::{Collection, CollectionsState};
pub use spaces::{Space, SpacesState, OTHER_SPACE_ID};
pub use tags::{TagListItem, TagListItemKind, TagPresentation, UNTAGGED_TAG_FILTER};
pub use view::{
    CollectionView, DelayedSendView, EmptyState, GroupCore, GroupSummary, GroupView, LabelDeadline,
    MachineSummary, MachineTabView, OrderItem, OrderKind, ProjectContextView, RemoteMachineView,
    SectionView, SessionMenuFacts, SessionRow, SessionTiming, SessionView, SidebarView, SpaceView,
    WorktreeView,
};
