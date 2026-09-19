//! Replays recorded `/api/events` frames through the core.
//!
//! Usage: `cargo run --release --example replay -- <frames.jsonl>`
//!
//! The input holds one raw frame per line, exactly as the socket delivered it. Recordings contain
//! private data: keep them outside the repository. This is tooling, not a test suite: it reports
//! what the wire types and the store make of real traffic.

use std::collections::BTreeMap;
use std::process::ExitCode;
use std::time::{Duration, Instant};

use ghostex_gx_core::protocol::{peek_event_type, ServerEvent};
use ghostex_gx_core::{
    ActiveGroup, Core, Event, Intent, Loadable, MachineId, ProjectKey, SessionKey,
};

#[derive(Default)]
struct TypeStats {
    frames: u64,
    bytes: u64,
    parse: Duration,
    parse_max: Duration,
    apply: Duration,
    apply_max: Duration,
}

struct ParseFailure {
    line: usize,
    event_type: String,
    error: String,
}

#[derive(Default)]
struct ChatPosition {
    server_id: String,
    epoch: i64,
    seq: i64,
    frames: u64,
    gaps: u64,
    epochs: u64,
}

fn main() -> ExitCode {
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("usage: replay <frames.jsonl>");
        return ExitCode::from(2);
    };
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) => {
            eprintln!("cannot read {path}: {error}");
            return ExitCode::from(2);
        }
    };

    let machine = MachineId::Local;
    let mut core = Core::new();
    let mut stats: BTreeMap<String, TypeStats> = BTreeMap::new();
    let mut failures: Vec<ParseFailure> = Vec::new();
    let mut ignored: BTreeMap<String, u64> = BTreeMap::new();
    let mut effects: BTreeMap<String, u64> = BTreeMap::new();
    let mut delta_types: BTreeMap<String, u64> = BTreeMap::new();
    let mut chats: BTreeMap<(String, String), ChatPosition> = BTreeMap::new();
    let mut violations: Vec<String> = Vec::new();
    let mut peek_total = Duration::ZERO;
    let mut peek_missed = 0u64;
    let mut held_revision: Option<i64> = None;
    let mut changed_frames = 0u64;
    let mut sessions_changed = 0u64;
    let mut order_changes = 0u64;
    let started = Instant::now();

    for (index, line) in text.lines().enumerate() {
        let line_number = index + 1;
        if line.trim().is_empty() {
            continue;
        }

        let peek_started = Instant::now();
        let peeked = peek_event_type(line).map(str::to_string);
        peek_total += peek_started.elapsed();
        if peeked.is_none() {
            peek_missed += 1;
        }

        let parse_started = Instant::now();
        let parsed = ServerEvent::parse(line);
        let parse_elapsed = parse_started.elapsed();
        let frame = match parsed {
            Ok(frame) => frame,
            Err(error) => {
                failures.push(ParseFailure {
                    line: line_number,
                    event_type: error
                        .event_type()
                        .map(str::to_string)
                        .or(peeked)
                        .unwrap_or_else(|| "<no type>".to_string()),
                    error: error.to_string(),
                });
                continue;
            }
        };
        let event_type = frame.event_type().to_string();
        if peeked.as_deref() != Some(event_type.as_str()) {
            violations.push(format!(
                "line {line_number}: peeked type {peeked:?} differs from parsed type {event_type}"
            ));
        }
        note_frame(&frame, &mut delta_types, &mut chats);

        let apply_started = Instant::now();
        let output = core.handle(
            Event::Frame {
                machine: machine.clone(),
                frame: Box::new(frame),
            },
            line_number as u64,
        );
        let apply_elapsed = apply_started.elapsed();

        let entry = stats.entry(event_type).or_default();
        entry.frames += 1;
        entry.bytes += line.len() as u64;
        entry.parse += parse_elapsed;
        entry.parse_max = entry.parse_max.max(parse_elapsed);
        entry.apply += apply_elapsed;
        entry.apply_max = entry.apply_max.max(apply_elapsed);

        if let Some(reason) = &output.changes.ignored {
            let name = format!("{reason:?}");
            let name = name
                .split([' ', '{', '('])
                .next()
                .unwrap_or_default()
                .to_string();
            *ignored.entry(name).or_default() += 1;
        }
        for effect in &output.effects {
            let name = format!("{effect:?}");
            let name = name
                .split([' ', '{', '('])
                .next()
                .unwrap_or_default()
                .to_string();
            *effects.entry(name).or_default() += 1;
        }
        if !output.changes.is_empty() {
            changed_frames += 1;
            sessions_changed += output.changes.sessions_changed.len() as u64;
            order_changes += output.changes.session_order_changed.len() as u64;
            check_invariants(&core, &machine, line_number, &mut violations);
        }

        let revision = core
            .presentation()
            .loaded(&machine)
            .map(|loaded| loaded.revision);
        if let (Some(before), Some(after)) = (held_revision, revision) {
            if after < before {
                violations.push(format!(
                    "line {line_number}: revision decreased from {before} to {after}"
                ));
            }
        }
        held_revision = revision.or(held_revision);
    }
    let elapsed = started.elapsed();

    println!("== frames by type ==");
    println!(
        "{:<34} {:>7} {:>11} {:>11} {:>11} {:>11} {:>11}",
        "type", "frames", "bytes", "parse avg", "parse max", "apply avg", "apply max"
    );
    let mut total_frames = 0;
    for (event_type, entry) in &stats {
        total_frames += entry.frames;
        println!(
            "{:<34} {:>7} {:>11} {:>11} {:>11} {:>11} {:>11}",
            event_type,
            entry.frames,
            entry.bytes,
            micros(entry.parse / entry.frames.max(1) as u32),
            micros(entry.parse_max),
            micros(entry.apply / entry.frames.max(1) as u32),
            micros(entry.apply_max),
        );
    }
    println!(
        "total: {total_frames} frames handled, {} parse failures, {} ms wall",
        failures.len(),
        elapsed.as_millis()
    );
    println!(
        "peek_event_type: {} avg per frame, {peek_missed} frames it could not read",
        micros(peek_total / (total_frames + failures.len() as u64).max(1) as u32)
    );

    println!("\n== presentation delta types ==");
    for (delta_type, count) in &delta_types {
        println!("{delta_type:<34} {count:>7}");
    }

    println!("\n== parse failures ==");
    if failures.is_empty() {
        println!("none");
    }
    for failure in &failures {
        println!(
            "line {} type {}: {}",
            failure.line, failure.event_type, failure.error
        );
    }

    println!("\n== store ==");
    match core.presentation().loaded(&machine) {
        None => println!("presentation: NOT LOADED (the recording holds no snapshot)"),
        Some(loaded) => {
            println!("server id: {}", loaded.server_id);
            println!("final revision: {}", loaded.revision);
            println!("projects: {}", loaded.projects().len());
            println!("groups: {}", loaded.groups().len());
            println!("sessions: {}", loaded.session_count());
            let tabs: usize = loaded
                .projects()
                .iter()
                .filter_map(|project| {
                    core.presentation()
                        .tab_sessions(&ActiveGroup::Project(ProjectKey::local(
                            project.project_id.as_str(),
                        )))
                        .loaded()
                })
                .map(|tabs| tabs.len())
                .sum();
            println!("tab sessions over all project groups: {tabs}");
            let chat_tabs = core
                .presentation()
                .tab_sessions(&ActiveGroup::Chats(machine.clone()))
                .loaded()
                .map_or(0, |tabs| tabs.len());
            println!("tab sessions of the Chats collection: {chat_tabs}");
        }
    }
    println!(
        "frames that changed state: {changed_frames} (sessions changed: {sessions_changed}, session order changes: {order_changes})"
    );
    println!("ignored inputs by reason: {ignored:?}");
    println!("effects requested: {effects:?}");

    println!("\n== session chat streams ==");
    println!("sessions with chat frames: {}", chats.len());
    let chat_frames: u64 = chats.values().map(|chat| chat.frames).sum();
    let chat_gaps: u64 = chats.values().map(|chat| chat.gaps).sum();
    let chat_epochs: u64 = chats.values().map(|chat| chat.epochs).sum();
    println!("chat frames: {chat_frames}, epochs seen: {chat_epochs}, seq gaps inside an epoch: {chat_gaps}");

    focus_cycle_report(&mut core, &machine, &mut violations);

    println!("\n== invariants ==");
    println!("checked: every session's project exists; every group id has a row and every row is in its group; tab sessions resolve to sessions; the revision never decreases; peek agrees with the parser; focus never points at a missing session");
    if violations.is_empty() {
        println!("all hold");
    } else {
        println!("{} violations:", violations.len());
        for violation in violations.iter().take(50) {
            println!("  {violation}");
        }
    }

    if failures.is_empty() && violations.is_empty() {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

fn micros(duration: Duration) -> String {
    format!("{:.1}us", duration.as_nanos() as f64 / 1000.0)
}

fn note_frame(
    frame: &ServerEvent,
    delta_types: &mut BTreeMap<String, u64>,
    chats: &mut BTreeMap<(String, String), ChatPosition>,
) {
    let (base, is_baseline) = match frame {
        ServerEvent::PresentationDelta(frame) => {
            *delta_types
                .entry(frame.delta.delta_type().to_string())
                .or_default() += 1;
            return;
        }
        ServerEvent::SessionChatSnapshot(frame) | ServerEvent::SessionChatReplaced(frame) => {
            (&frame.base, true)
        }
        ServerEvent::SessionChatAppended(frame) => (&frame.base, false),
        ServerEvent::SessionChatState(frame) => (&frame.base, false),
        _ => return,
    };
    let chat = chats
        .entry((base.project_id.clone(), base.session_id.clone()))
        .or_default();
    chat.frames += 1;
    let same_stream = chat.server_id == base.server_id && chat.epoch == base.epoch;
    if !same_stream {
        chat.epochs += 1;
    } else if !is_baseline && base.seq != chat.seq + 1 {
        // The recording starts mid-stream, so the first frame of a session is never a gap.
        chat.gaps += 1;
    }
    chat.server_id = base.server_id.clone();
    chat.epoch = base.epoch;
    chat.seq = base.seq;
}

fn check_invariants(core: &Core, machine: &MachineId, line: usize, violations: &mut Vec<String>) {
    let store = core.presentation();
    let Some(loaded) = store.loaded(machine) else {
        return;
    };
    for session in loaded.server_sessions() {
        if loaded.project(&session.project_id).is_none() {
            violations.push(format!(
                "line {line}: session {}/{} has no project",
                session.project_id, session.session_id
            ));
        }
        let group = loaded.groups().iter().find(|group| {
            group.project_id == session.project_id && group.group_id == session.group_id
        });
        if let Some(group) = group {
            if !group.session_ids.contains(&session.session_id) {
                violations.push(format!(
                    "line {line}: session {}/{} is missing from its group {}",
                    session.project_id, session.session_id, session.group_id
                ));
            }
        }
    }
    for group in loaded.groups() {
        for session_id in &group.session_ids {
            if loaded
                .server_session(&group.project_id, session_id)
                .is_none()
            {
                violations.push(format!(
                    "line {line}: group {} lists {session_id}, which has no row",
                    group.group_id
                ));
            }
        }
    }
    for project in loaded.projects() {
        let group = ActiveGroup::Project(ProjectKey::local(project.project_id.as_str()));
        match store.tab_sessions(&group) {
            Loadable::NotLoaded => violations.push(format!(
                "line {line}: tab sessions of loaded project {} read as not loaded",
                project.project_id
            )),
            Loadable::Loaded(tabs) => {
                for tab in tabs {
                    if store.session(&tab.key).is_none() {
                        violations.push(format!(
                            "line {line}: tab {}/{} does not resolve to a session",
                            tab.key.project_id, tab.key.session_id
                        ));
                    }
                }
            }
        }
    }
    for key in core
        .focus()
        .focused_session
        .iter()
        .chain(&core.focus().visible_sessions)
    {
        if key.machine == *machine && store.session(key).is_none() {
            violations.push(format!(
                "line {line}: focus points at missing session {}/{}",
                key.project_id, key.session_id
            ));
        }
    }
}

/// Drives the focus reducer the way a held "next tab" hotkey would, on the project with the most
/// tabs, to show what one step costs when it is a store mutation with no round trip.
fn focus_cycle_report(core: &mut Core, machine: &MachineId, violations: &mut Vec<String>) {
    println!("\n== focus reducer (held next tab) ==");
    let Some(loaded) = core.presentation().loaded(machine) else {
        println!("skipped: presentation not loaded");
        return;
    };
    let busiest: Option<(ProjectKey, Vec<SessionKey>)> = loaded
        .projects()
        .iter()
        .filter_map(|project| {
            let key = ProjectKey::local(project.project_id.as_str());
            let tabs = core
                .presentation()
                .tab_sessions(&ActiveGroup::Project(key.clone()))
                .loaded()?;
            Some((key, tabs.into_iter().map(|tab| tab.key).collect::<Vec<_>>()))
        })
        .max_by_key(|(_, tabs)| tabs.len());
    let Some((project, tabs)) = busiest.filter(|(_, tabs)| !tabs.is_empty()) else {
        println!("skipped: no project has tabs");
        return;
    };

    const STEPS: usize = 10_000;
    let started = Instant::now();
    let mut changed = 0usize;
    for step in 0..STEPS {
        let session = tabs[step % tabs.len()].clone();
        let output = core.handle(
            Event::Intent(Intent::FocusSession {
                session: session.clone(),
                group: None,
                visible: Some(vec![session]),
            }),
            step as u64,
        );
        if output.changes.focus_changed {
            changed += 1;
        }
    }
    let focus_elapsed = started.elapsed();

    let started = Instant::now();
    let mut tab_rows = 0usize;
    for _ in 0..STEPS {
        tab_rows += core
            .active_tab_sessions()
            .loaded()
            .map_or(0, |tabs| tabs.len());
    }
    let selector_elapsed = started.elapsed();

    println!("project with the most tabs: {} tabs", tabs.len());
    println!(
        "{STEPS} focus intents: {} per intent, {changed} changed focus",
        micros(focus_elapsed / STEPS as u32)
    );
    println!(
        "{STEPS} reads of the active tab list: {} per read ({} rows each)",
        micros(selector_elapsed / STEPS as u32),
        tab_rows / STEPS
    );
    let stamp = core.focus().local_stamp;
    if stamp != STEPS as u64 {
        violations.push(format!(
            "focus stamp is {stamp} after {STEPS} local intents"
        ));
    }
    if core.focus().active_project.as_ref() != Some(&project) {
        violations.push("the active project is not the project of the focused session".to_string());
    }

    // A late echo that observed an older stamp must lose to the newest local intent.
    let focused_before = core.focus().focused_session.clone();
    let output = core.handle(
        Event::Intent(Intent::ExternalFocus(
            ghostex_gx_core::ExternalFocusUpdate {
                observed_stamp: stamp - 1,
                active_project: None,
                active_group: None,
                focused_session: None,
                visible_sessions: Some(Vec::new()),
            },
        )),
        0,
    );
    let held = core.focus().focused_session == focused_before && output.changes.ignored.is_some();
    println!("stale external focus update dropped: {held}");
    if !held {
        violations.push("a stale external focus update overwrote a newer local intent".to_string());
    }
}
