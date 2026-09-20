//! Replays recorded `/api/events` frames through the core and derives the sidebar list from every
//! one of them, incrementally and from scratch, and compares the two.
//!
//! Usage: `cargo run --release --example sidebar_replay -- <frames.jsonl> [projects-rpc.json]`
//!
//! The second file is the body of a `listProjects` response, which carries the domain rows the
//! project overlays (chat projects, icons, worktrees) are built from.
//!
//! The replay does not only feed frames: it drives focus, churns the sidebar's own UI state and
//! settings on a rotation, and walks the clock a few seconds per frame so the time-based rules
//! (a new session leading the list, a snooze ending) fire. Every frame is compared both ways, so
//! anything the incremental path forgets to invalidate shows up here.
//!
//! Recordings contain private data: keep them outside the repository. This is tooling, not a test
//! suite: it reports what the view model makes of real traffic.

use std::process::ExitCode;
use std::time::{Duration, Instant};

use ghostex_gx_core::protocol::{
    CustomSessionTag, CustomSessionTagsState, ServerEvent, GXSERVER_PROTOCOL_VERSION,
};
use ghostex_gx_core::{
    collapse_into_storage, collapse_state_from_storage, reveal_plan, Core, Event, Intent,
    MachineId, SectionId, SessionSortMode, SidebarCollapseDiff, SidebarInputs, SidebarUiIntent,
    SidebarUiStore, SidebarView, SidebarViewModel, ToggleAllProjectsInput,
};
use serde_json::Value;

/// Where the replay's clock starts. The frames carry no timestamps of their own.
const START_MS: u64 = 1_790_000_000_000;
/// How far the clock moves per frame, so a recording of a few thousand frames covers hours and
/// the ten-minute new-session window and any snooze in the rows expire while it runs.
const CLOCK_STEP_MS: u64 = 3_000;

fn main() -> ExitCode {
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("usage: sidebar_replay <frames.jsonl> [projects-rpc.json]");
        return ExitCode::from(2);
    };
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) => {
            eprintln!("cannot read {path}: {error}");
            return ExitCode::from(2);
        }
    };
    let domain_projects = std::env::args().nth(2).and_then(read_domain_projects);
    if let Some(projects) = &domain_projects {
        println!("domain project rows: {}", projects.len());
    }

    let churned = run_pass("churned inputs", &text, domain_projects.clone(), true);
    let steady = run_pass("steady inputs", &text, domain_projects, false);

    if churned.mismatches == 0 && steady.mismatches == 0 {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

fn read_domain_projects(path: String) -> Option<Vec<Value>> {
    let text = std::fs::read_to_string(&path).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    Some(
        value
            .pointer("/result/projects")
            .or_else(|| value.get("projects"))?
            .as_array()?
            .clone(),
    )
}

struct PassResult {
    mismatches: u64,
}

/// The sidebar's own state, its writes, and what they are measured against.
struct UiState {
    store: SidebarUiStore,
    stored: String,
    base: ghostex_gx_core::SidebarCollapseState,
    writes: u64,
    persist_failures: u64,
    reveals: u64,
    reveal_failures: u64,
}

impl UiState {
    fn new() -> Self {
        let store = SidebarUiStore::new();
        let stored = collapse_into_storage(&store.state().collapse, None);
        let base = store.state().collapse.clone();
        Self {
            store,
            stored,
            base,
            writes: 0,
            persist_failures: 0,
            reveals: 0,
            reveal_failures: 0,
        }
    }

    /// Applies one intent the way the desktop host does: the state moves, and what it changed is
    /// written to storage and read back, so the round trip is exercised against real ids.
    fn apply(&mut self, intent: SidebarUiIntent) {
        if !self.store.apply(intent).changed {
            return;
        }
        if !self.store.take_pending().collapse {
            return;
        }
        let diff = SidebarCollapseDiff::between(&self.base, &self.store.state().collapse);
        self.stored = diff.apply(Some(&self.stored), &self.store.state().collapse);
        self.base = self.store.state().collapse.clone();
        self.writes += 1;
        let read_back = collapse_state_from_storage(Some(&self.stored), None, None);
        if persisted_only(read_back) != persisted_only(self.base.clone()) {
            self.persist_failures += 1;
        }
    }
}

/// The collapse state as a restart would see it: only Pinned and Sessions are stored.
fn persisted_only(
    mut state: ghostex_gx_core::SidebarCollapseState,
) -> ghostex_gx_core::SidebarCollapseState {
    for sections in state.section_collapse.values_mut() {
        *sections = ghostex_gx_core::SectionCollapse {
            pinned: sections.pinned,
            sessions: sections.sessions,
            ..ghostex_gx_core::SectionCollapse::default()
        };
    }
    state
}

fn run_pass(
    label: &str,
    frames: &str,
    domain_projects: Option<Vec<Value>>,
    churn: bool,
) -> PassResult {
    let machine = MachineId::Local;
    let mut core = Core::new();
    let mut model = SidebarViewModel::new();
    let mut inputs = SidebarInputs::default();
    inputs.settings.sort_mode = SessionSortMode::LastActivity;
    let mut ui = UiState::new();
    if let Some(projects) = domain_projects {
        core.handle(
            Event::DomainProjectsRead {
                machine: machine.clone(),
                projects,
            },
            START_MS,
        );
    }

    let mut cold_build: Option<Duration> = None;
    let mut store_changed: Vec<Duration> = Vec::new();
    let mut catalog_changed: Vec<Duration> = Vec::new();
    let mut inputs_changed: Vec<Duration> = Vec::new();
    let mut idle: Vec<Duration> = Vec::new();
    let mut scratch: Vec<Duration> = Vec::new();
    let mut handled = 0u64;
    let mut focus_intents = 0u64;
    let mut churn_steps = 0u64;
    let mut catalog_swaps = 0u64;
    let mut captured_tags: Option<CustomSessionTagsState> = None;
    let mut mismatches = 0u64;
    let mut first_mismatch: Option<String> = None;
    let started = Instant::now();

    for (index, line) in frames.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(frame) = ServerEvent::parse(line) else {
            continue;
        };
        handled += 1;
        let now_ms = START_MS + index as u64 * CLOCK_STEP_MS;
        let output = core.handle(
            Event::Frame {
                machine: machine.clone(),
                frame: Box::new(frame),
            },
            now_ms,
        );
        let mut changes = output.changes.clone();
        // Drive focus the way a user would, so the focus-dependent parts of the list are
        // exercised against real rows.
        if let Some(session) = output.changes.sessions_changed.first() {
            if index % 7 == 0 {
                let focus_output = core.handle(
                    Event::Intent(Intent::FocusSession {
                        session: session.clone(),
                        visible: Some(vec![session.clone()]),
                    }),
                    now_ms,
                );
                changes.merge(focus_output.changes);
                focus_intents += 1;
            }
        }
        // The tag catalog, the one store input that invalidates every row of the machine without
        // any session changing. Swapped on a rotation between a catalog of the replay's own and
        // the recording's, so rows lose their custom tag labels and get them back.
        let mut catalog_swapped = false;
        if churn && index % 29 == 28 {
            if captured_tags.is_none() {
                captured_tags = core
                    .presentation()
                    .machine(&machine)
                    .and_then(|entry| entry.side_state().custom_session_tags.clone());
            }
            let catalog = if (index / 29) % 2 == 0 {
                replay_tag_catalog()
            } else {
                captured_tags.clone().unwrap_or_default()
            };
            if let Some(frame) = tag_catalog_frame(&catalog) {
                let swapped = core.handle(
                    Event::Frame {
                        machine: machine.clone(),
                        frame: Box::new(frame),
                    },
                    now_ms,
                );
                changes.merge(swapped.changes);
                catalog_swaps += 1;
                catalog_swapped = true;
            }
        }
        let store_moved = !changes.is_empty();
        let before = inputs.clone();
        if churn {
            churn_inputs(&mut inputs, &mut ui, model.view(), index);
            inputs.ui = ui.store.state().clone();
            if inputs != before {
                churn_steps += 1;
            }
        }
        let inputs_moved = inputs != before;

        let empty_before = model.view().groups.is_empty();
        let update_started = Instant::now();
        model.update(&core, &inputs, &changes, now_ms);
        let elapsed = update_started.elapsed();
        // The first update that produces a list is the cold build: the store's first snapshot.
        // Everything before it runs against an empty store and says nothing about the cost.
        if cold_build.is_none() && empty_before && !model.view().groups.is_empty() {
            cold_build = Some(elapsed);
        } else if catalog_swapped {
            catalog_changed.push(elapsed);
        } else if store_moved {
            store_changed.push(elapsed);
        } else if inputs_moved {
            inputs_changed.push(elapsed);
        } else {
            idle.push(elapsed);
        }

        // Every so often, ask what it would take to put one row on screen and check that doing it
        // actually draws the row. The plan is worked out against the same store and inputs, so a
        // rule it gets wrong shows up as a row that is still not drawn.
        if churn && index % 31 == 30 {
            check_reveal(&core, &inputs, model.view(), index, now_ms, &mut ui);
        }
        let scratch_started = Instant::now();
        let fresh = SidebarViewModel::build_from_scratch(&core, &inputs, now_ms);
        scratch.push(scratch_started.elapsed());
        if fresh != *model.view() {
            mismatches += 1;
            if first_mismatch.is_none() {
                first_mismatch = Some(describe_difference(&fresh, model.view(), index + 1));
            }
        }
    }
    let wall = started.elapsed();
    let view = model.view();

    println!("\n== {label} ==");
    println!(
        "{handled} frames in {} ms, {focus_intents} focus intents, {churn_steps} input changes, {catalog_swaps} tag catalog swaps, clock walked {} minutes",
        wall.as_millis(),
        handled * CLOCK_STEP_MS / 60_000
    );
    if let Some(loaded) = core.presentation().loaded(&machine) {
        println!(
            "store: {} projects, {} sessions",
            loaded.projects().len(),
            loaded.session_count()
        );
    }
    println!(
        "list: {} groups, {} rows, {} collections, {} Spaces, {} top-level rows",
        view.groups.len(),
        view.groups
            .iter()
            .map(|group| group.core.sessions.len())
            .sum::<usize>(),
        view.collections.len(),
        view.spaces.len(),
        view.order.len()
    );
    println!(
        "machine counts: {} working, {} needing attention; empty state copy: {:?}",
        view.machine.working_count, view.machine.attention_count, view.empty_state.copy
    );
    if let Some(cold) = cold_build {
        println!("{:<38} {:>9}", "cold build (first snapshot)", micros(cold));
    }
    report("incremental update (store changed)", &mut store_changed);
    report("incremental update (inputs churned)", &mut inputs_changed);
    report("incremental update (tags swapped)", &mut catalog_changed);
    report("update with nothing changed", &mut idle);
    report("build from scratch", &mut scratch);
    println!(
        "incremental against from scratch: {} comparisons, {mismatches} differences",
        scratch.len()
    );
    println!(
        "sidebar state: {} collapse writes, {} that did not survive a read, {} reveals, {} that did not draw the row",
        ui.writes, ui.persist_failures, ui.reveals, ui.reveal_failures
    );
    if let Some(first) = &first_mismatch {
        println!("{first}");
    }

    PassResult {
        mismatches: mismatches + ui.persist_failures + ui.reveal_failures,
    }
}

/// Takes one row of the list, asks what has to change for it to be drawn, does exactly that, and
/// checks the row is then in a heading the list draws.
fn check_reveal(
    core: &Core,
    inputs: &SidebarInputs,
    view: &SidebarView,
    index: usize,
    now_ms: u64,
    ui: &mut UiState,
) {
    let Some(session_id) = view
        .groups
        .iter()
        .flat_map(|group| group.core.sessions.iter())
        .nth(index % 23)
        .map(|session| session.row.sidebar_session_id.clone())
    else {
        return;
    };
    let Some(plan) = reveal_plan(core, inputs, view, &session_id, now_ms) else {
        return;
    };
    ui.reveals += 1;
    let mut revealed = inputs.clone();
    if plan.show_hidden {
        revealed.ui.show_hidden = true;
    }
    if plan.clear_tag_filters {
        revealed.ui.selected_tag_filters.clear();
    }
    if let Some(space_id) = &plan.select_space {
        revealed
            .ui
            .collapse
            .selected_space_by_section
            .insert(revealed.ui.section_key(), space_id.clone());
    }
    if let Some(storage_id) = &plan.collapsed_collection_storage_id {
        revealed
            .ui
            .collapse
            .collapsed_collections
            .remove(storage_id);
    }
    if plan.collapsed_group {
        revealed.ui.collapse.collapsed_groups.remove(&plan.group_id);
    }
    if let Some(section) = plan.collapsed_section {
        revealed
            .ui
            .collapse
            .section_collapse
            .entry(plan.storage_id.clone())
            .or_default()
            .set(section, false);
    }
    if plan.expand_list {
        revealed
            .ui
            .collapse
            .expanded_session_lists
            .insert(plan.storage_id.clone());
    }
    let after = SidebarViewModel::build_from_scratch(core, &revealed, now_ms);
    let drawn = after.group(&plan.group_id).is_some_and(|group| {
        !group.core.collapsed
            && group.core.sections.iter().any(|section| {
                !section.collapsed && section.session_ids.iter().any(|drawn| *drawn == session_id)
            })
    });
    if !drawn {
        ui.reveal_failures += 1;
    }
}

/// Moves one piece of the sidebar's own state per frame, so every input the view model reads is
/// changed and changed back while the store moves underneath it. The sidebar's own half goes
/// through its intents and its write, exactly as the desktop host applies them.
fn churn_inputs(inputs: &mut SidebarInputs, ui: &mut UiState, view: &SidebarView, index: usize) {
    let group_id = view
        .groups
        .get(index % view.groups.len().max(1))
        .map(|group| group.core.group_id.clone());
    let storage_id = view
        .groups
        .get(index % view.groups.len().max(1))
        .map(|group| group.core.storage_id.clone());
    let session_id = view
        .groups
        .iter()
        .flat_map(|group| group.core.sessions.iter())
        .nth(index % 17)
        .map(|session| session.row.sidebar_session_id.clone());
    match index % 13 {
        0 => {
            if let Some(group_id) = group_id {
                ui.apply(SidebarUiIntent::ToggleGroupCollapsed { group_id });
            }
        }
        1 => {
            if let Some(storage_id) = storage_id {
                ui.apply(SidebarUiIntent::ToggleSessionListExpanded { storage_id });
            }
        }
        2 => {
            if let Some(storage_id) = storage_id {
                ui.apply(SidebarUiIntent::ToggleHoverActions { storage_id });
            }
        }
        3 => {
            if let Some(storage_id) = storage_id {
                ui.apply(SidebarUiIntent::ToggleSection {
                    storage_id,
                    section: SectionId::ORDER[index % 6],
                });
            }
        }
        4 => {
            if let Some(session_id) = session_id {
                let mut selected = ui.store.state().selected_session_ids.clone();
                match selected.iter().position(|held| *held == session_id) {
                    Some(position) => {
                        selected.remove(position);
                    }
                    None => selected.push(session_id),
                }
                ui.apply(SidebarUiIntent::SetSelectedSessions {
                    session_ids: selected,
                });
            }
        }
        5 => inputs.settings.enable_session_parking = !inputs.settings.enable_session_parking,
        6 => {
            inputs.settings.project_session_list_collapsed_count = 1 + (index as u32 % 20);
        }
        7 => {
            inputs.settings.sort_mode = match inputs.settings.sort_mode {
                SessionSortMode::LastActivity => SessionSortMode::Manual,
                SessionSortMode::Manual => SessionSortMode::LastActivity,
            };
        }
        8 => inputs.settings.sidebar_spaces_enabled = !inputs.settings.sidebar_spaces_enabled,
        9 => ui.apply(SidebarUiIntent::ToggleShowHidden),
        // One of the two inputs that invalidate every row of the machine at once, the other
        // being the tag catalog, which the pass swaps through the store.
        10 => inputs.settings.debugging_mode = !inputs.settings.debugging_mode,
        11 => ui.apply(SidebarUiIntent::ToggleAllProjects(ToggleAllProjectsInput {
            machine_id: ui.store.selected_machine_id().to_string(),
            group_ids: view
                .groups
                .iter()
                .map(|group| group.core.group_id.clone())
                .collect(),
        })),
        _ => {
            for tag in ["favorite", "untagged"] {
                ui.apply(SidebarUiIntent::ToggleTagFilter {
                    tag: tag.to_string(),
                });
            }
        }
    }
}

/// A catalog of the replay's own, so a swap changes what every tagged row shows.
fn replay_tag_catalog() -> CustomSessionTagsState {
    let tag = |tag_id: &str, name: &str, color: &str| {
        (
            tag_id.to_string(),
            CustomSessionTag {
                tag_id: tag_id.to_string(),
                name: name.to_string(),
                color: color.to_string(),
                icon: "tag".to_string(),
            },
        )
    };
    CustomSessionTagsState {
        order: vec![
            "custom-replayalpha".to_string(),
            "custom-replaybeta".to_string(),
        ],
        tags: [
            tag("custom-replayalpha", "Replay alpha", "#7c6df2"),
            tag("custom-replaybeta", "Replay beta", "#3aa675"),
        ]
        .into_iter()
        .collect(),
    }
}

/// The catalog as a frame the core accepts: no revision, so it is applied whatever the stream's
/// own revision is at this point of the recording.
fn tag_catalog_frame(catalog: &CustomSessionTagsState) -> Option<ServerEvent> {
    let frame = serde_json::json!({
        "type": "customSessionTagsChanged",
        "protocolVersion": GXSERVER_PROTOCOL_VERSION,
        "customSessionTags": catalog,
    });
    ServerEvent::parse(&frame.to_string()).ok()
}

fn report(label: &str, samples: &mut [Duration]) {
    if samples.is_empty() {
        println!("{label:<38} no samples");
        return;
    }
    samples.sort_unstable();
    let percentile = |fraction: f64| -> Duration {
        let index = ((samples.len() as f64 - 1.0) * fraction).round() as usize;
        samples[index]
    };
    println!(
        "{label:<38} n={:<6} median {:>9} p99 {:>9} max {:>9}",
        samples.len(),
        micros(percentile(0.5)),
        micros(percentile(0.99)),
        micros(*samples.last().expect("not empty")),
    );
}

fn micros(duration: Duration) -> String {
    format!("{:.1}us", duration.as_nanos() as f64 / 1000.0)
}

/// Names the first place two lists differ, without quoting anything a recording holds.
fn describe_difference(scratch: &SidebarView, incremental: &SidebarView, line: usize) -> String {
    if scratch.groups.len() != incremental.groups.len() {
        return format!(
            "line {line}: group count {} from scratch, {} incrementally",
            scratch.groups.len(),
            incremental.groups.len()
        );
    }
    for (left, right) in scratch.groups.iter().zip(&incremental.groups) {
        if left.core.group_id != right.core.group_id {
            return format!("line {line}: group order differs");
        }
        if left.core.sessions.len() != right.core.sessions.len() {
            return format!(
                "line {line}: group {} has {} rows from scratch, {} incrementally",
                left.core.group_id,
                left.core.sessions.len(),
                right.core.sessions.len()
            );
        }
        for (left_session, right_session) in left.core.sessions.iter().zip(&right.core.sessions) {
            if left_session != right_session {
                return format!(
                    "line {line}: row {} differs in group {}",
                    left_session.row.sidebar_session_id, left.core.group_id
                );
            }
        }
        if left != right {
            return format!("line {line}: group {} differs", left.core.group_id);
        }
    }
    if scratch.order != incremental.order {
        return format!("line {line}: the top-level order differs");
    }
    if scratch.collections != incremental.collections {
        return format!("line {line}: the collections differ");
    }
    if scratch.spaces != incremental.spaces {
        return format!("line {line}: the Spaces differ");
    }
    format!("line {line}: the lists differ outside the groups")
}
