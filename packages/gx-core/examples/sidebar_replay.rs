//! Replays recorded `/api/events` frames through the core and derives the sidebar list from every
//! one of them, incrementally and from scratch, and compares the two.
//!
//! Usage: `cargo run --release --example sidebar_replay -- <frames.jsonl> [projects-rpc.json]`
//!
//! The second file is the body of a `listProjects` response, which carries the domain rows the
//! project overlays (chat projects, icons, worktrees) are built from.
//!
//! Recordings contain private data: keep them outside the repository. This is tooling, not a test
//! suite: it reports what the view model makes of real traffic.

use std::process::ExitCode;
use std::time::{Duration, Instant};

use ghostex_gx_core::protocol::ServerEvent;
use ghostex_gx_core::{
    Core, Event, Intent, MachineId, SessionSortMode, SidebarInputs, SidebarView, SidebarViewModel,
};
use serde_json::Value;

/// One clock for the whole replay: the frames carry no timestamps, so the sidebar's time-based
/// rules (a new session leading the list, a snooze ending) are judged against a fixed moment.
const NOW_MS: u64 = 1_790_000_000_000;

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

    // Two passes: the whole list of the machine, and the same traffic with Spaces on, which is
    // what a filtered sidebar costs.
    let unfiltered = run_pass("Spaces off", &text, domain_projects.clone(), false);
    let filtered = run_pass("Spaces on", &text, domain_projects, true);

    if unfiltered.mismatches == 0 && filtered.mismatches == 0 {
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

fn run_pass(
    label: &str,
    frames: &str,
    domain_projects: Option<Vec<Value>>,
    spaces_enabled: bool,
) -> PassResult {
    let machine = MachineId::Local;
    let mut core = Core::new();
    let mut model = SidebarViewModel::new();
    let mut inputs = SidebarInputs::default();
    inputs.settings.sidebar_spaces_enabled = spaces_enabled;
    inputs.settings.sort_mode = SessionSortMode::LastActivity;
    if let Some(projects) = domain_projects {
        core.handle(
            Event::DomainProjectsRead {
                machine: machine.clone(),
                projects,
            },
            NOW_MS,
        );
    }

    let mut incremental: Vec<Duration> = Vec::new();
    let mut idle: Vec<Duration> = Vec::new();
    let mut scratch: Vec<Duration> = Vec::new();
    let mut handled = 0u64;
    let mut changed_updates = 0u64;
    let mut focus_intents = 0u64;
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
        let output = core.handle(
            Event::Frame {
                machine: machine.clone(),
                frame: Box::new(frame),
            },
            NOW_MS,
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
                    NOW_MS,
                );
                changes.merge(focus_output.changes);
                focus_intents += 1;
            }
        }
        // Toggle a little UI state now and then: collapse and expand the first project.
        if index % 500 == 0 {
            if let Some(group) = model.view().groups.first() {
                let group_id = group.core.group_id.clone();
                if !inputs.ui.collapse.collapsed_groups.remove(&group_id) {
                    inputs.ui.collapse.collapsed_groups.insert(group_id);
                }
            }
        }

        let update_started = Instant::now();
        model.update(&core, &inputs, &changes, NOW_MS);
        let elapsed = update_started.elapsed();
        if changes.is_empty() {
            idle.push(elapsed);
        } else {
            incremental.push(elapsed);
            changed_updates += 1;
        }

        if index % 25 == 0 {
            let scratch_started = Instant::now();
            let fresh = SidebarViewModel::build_from_scratch(&core, &inputs, NOW_MS);
            scratch.push(scratch_started.elapsed());
            if fresh != *model.view() {
                mismatches += 1;
                if first_mismatch.is_none() {
                    first_mismatch = Some(describe_difference(&fresh, model.view(), index + 1));
                }
            }
        }
    }
    let wall = started.elapsed();
    let view = model.view();

    println!("\n== {label} ==");
    println!(
        "{handled} frames in {} ms, {focus_intents} focus intents, {changed_updates} updates with changes",
        wall.as_millis()
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
    report("incremental update (something changed)", &mut incremental);
    report("update with an empty change summary", &mut idle);
    report("build from scratch", &mut scratch);
    println!(
        "incremental against from scratch: {} comparisons, {mismatches} differences",
        scratch.len()
    );
    if let Some(first) = &first_mismatch {
        println!("{first}");
    }

    PassResult { mismatches }
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
