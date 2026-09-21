//! Plans every read-only sidebar action for a recorded presentation and writes the CALLS it would
//! make, so the shipped TypeScript that still answers them can be diffed against it.
//!
//! Usage: `cargo run --release --example sidebar_action_parity -- <scenario-dir>`
//!
//! The directory holds the `scenario-<n>.json` files `tooling/gx-core/menu-parity.ts scenarios`
//! writes. This writes `rust-actions-<n>.json` beside each; `tooling/gx-core/action-parity.ts
//! compare` then runs the same payload list through the real `GpuiSidebarRuntime` arms and diffs
//! the two sides call by call.
//!
//! **Why the calls and not the list.** A sidebar action is invisible in any comparison of the
//! drawn sidebar: sending the wrong native action, or the right one with the wrong project id,
//! changes nothing a list comparison can see. So the gate enumerates the calls themselves, and it
//! enumerates rather than samples: every project of the recording is probed with every message
//! type, together with the ids that have no project (a remote group, a user-made group, the Chats
//! group, a group that does not exist, the empty string) and the text edges of the two copy
//! actions. A payload the menus can build and this list misses is a hole in the gate, so the menu
//! dump `sidebar_menu_parity` writes is read when it is there and every read-only command in it is
//! added to the list.
//!
//! Recordings contain private data. Keep both the scenarios and the dumps outside the repository.

use std::process::ExitCode;
use std::time::Instant;

use ghostex_gx_core::protocol::ServerEvent;
use ghostex_gx_core::{
    apply_close_answer, apply_flags_answer, apply_fork_answer, apply_lifecycle_answer,
    apply_snooze_answer, close_optimistic_follow_ups, encode_uri_component, iso_string_from_ms,
    plan_batch, plan_bulk_request, plan_close_request, plan_flags_request, plan_fork_request,
    plan_full_reload, plan_lifecycle_request, plan_modal_action, plan_open_action,
    plan_read_only_action, plan_snooze_action, plan_snooze_request, plan_split_right,
    rename_seed_title, session_is_snoozed, snooze_wake_ms, ActiveGroup, CloseAnswer, CloseFollowUp,
    Core, Event, FlagsFollowUp, ForkFollowUp, Intent, LifecycleAnswer, LifecycleFollowUp,
    MachineId, ProjectKey, SectionCollapse, SessionKey, SideStateUpdate, SidebarInputs,
    SidebarView, SidebarViewModel, SnoozeClock, SnoozeFollowUp, WorkspaceGroupsDocument,
    QUICK_AUTOMATIONS_PROJECT_ID, READ_ONLY_MESSAGE_TYPES, SESSION_SNOOZE_PRESETS,
};
use serde_json::{json, Map, Value};

/// The clock facts file the harness writes beside the scenarios.
const SNOOZE_CLOCK_FILE: &str = "snooze-clock.json";

/// Every id shape that is not a live local project group, so each branch of the resolution is
/// probed even when the recording has no row of that kind.
const SYNTHETIC_GROUP_IDS: [&str; 7] = [
    "remote:machine-1:group:P0erj",
    "remote:machine-1:group:",
    "remote::group:P0erj",
    "combined-chats",
    "gpui-wsg:P0erj:group-1",
    "combined-project:does-not-exist",
    "",
];

/// The same for a session id: two remote shapes, a local one, and the empty string.
const SYNTHETIC_SESSION_IDS: [&str; 5] = [
    "remote:machine-1:session:P0erj:S1",
    "remote:machine-1:session:P0erj:",
    "remote::session:P0erj:S1",
    "combined-session:P0erj:S1",
    "",
];

/// The text edges `normalizeNonEmptyString` decides on: it tests the TRIMMED value and returns the
/// ORIGINAL, so a padded string must reach the clipboard with its padding.
const SYNTHETIC_TEXTS: [&str; 5] = ["Copy me", "  padded  ", "   ", "", "\n"];

/// A remote machine the store has LOADED, for the project-scoped bulk probes. No recording carries
/// one, so the same snapshot is fed to a second machine id and both halves are given it.
const BULK_REMOTE_MACHINE: &str = "remote-ab12";

/// A remote machine the store has NOT loaded while the old runtime still holds its LAST SEEN
/// presentation, which is the state a machine that has disconnected is really in. It is what makes
/// the not-loaded refusal load-bearing rather than equivalent to answering with no rows.
const BULK_REMOTE_LAST_SEEN: &str = "remote-zz99";

fn main() -> ExitCode {
    let Some(directory) = std::env::args().nth(1) else {
        eprintln!("usage: sidebar_action_parity <scenario-dir>");
        return ExitCode::from(2);
    };
    let mut scenarios: Vec<std::path::PathBuf> = match std::fs::read_dir(&directory) {
        Ok(entries) => entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("scenario-") && name.ends_with(".json"))
            })
            .collect(),
        Err(error) => {
            eprintln!("cannot read {directory}: {error}");
            return ExitCode::from(2);
        }
    };
    scenarios.sort();
    if scenarios.is_empty() {
        eprintln!("no scenario-*.json in {directory}");
        return ExitCode::from(2);
    }
    let mut total_payloads = 0usize;
    let mut total_calls = 0usize;
    let mut from_menus = 0usize;
    let mut total_lifecycle = 0usize;
    let mut total_close = 0usize;
    let mut total_fork = 0usize;
    let mut total_flags = 0usize;
    let mut total_modals = 0usize;
    let mut total_snooze = 0usize;
    let mut total_bulk = 0usize;
    let mut total_reload = 0usize;
    let mut resolve_micros: Vec<u128> = Vec::new();
    // The clock facts the snooze rule is answered against. The harness writes them under a pinned
    // time zone because this crate reads neither a clock nor a zone; without the file the snooze
    // probes are empty and `action-parity.ts compare` fails rather than reporting a clean run it
    // never measured.
    let clock_file: Option<Value> =
        std::fs::read_to_string(std::path::Path::new(&directory).join(SNOOZE_CLOCK_FILE))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok());
    if clock_file.is_none() {
        eprintln!(
            "no {SNOOZE_CLOCK_FILE} in {directory}: run `bun tooling/gx-core/action-parity.ts snooze-clock {directory}` first, or the snooze half measures nothing"
        );
    }
    for path in &scenarios {
        let scenario: Value = match std::fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
        {
            Some(value) => value,
            None => {
                eprintln!("cannot read {}", path.display());
                return ExitCode::FAILURE;
            }
        };
        let menu_dump = menu_dump_beside(path);
        let Some(dump) = build(
            &scenario,
            menu_dump.as_ref(),
            clock_file.as_ref(),
            &mut resolve_micros,
        ) else {
            eprintln!("cannot build {}", path.display());
            return ExitCode::FAILURE;
        };
        total_payloads += dump.payloads;
        total_calls += dump.calls;
        from_menus += dump.from_menus;
        total_lifecycle += dump.lifecycle;
        total_close += dump.close;
        total_fork += dump.fork;
        total_flags += dump.flags;
        total_modals += dump.modals;
        total_snooze += dump.snooze;
        total_bulk += dump.bulk;
        total_reload += dump.reload;
        let out = path.with_file_name(
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .replace("scenario-", "rust-actions-"),
        );
        // A payload carries a project path, a resume command line and a session title, and a plan
        // carries them back; both are written as privately as the scenarios are.
        if let Err(error) = write_private(&out, &serde_json::to_string(&dump.value).unwrap()) {
            eprintln!("cannot write {}: {error}", out.display());
            return ExitCode::FAILURE;
        }
        println!(
            "{}: {} payloads, {} calls ({} from menus), {} lifecycle transitions, {} closes",
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(""),
            dump.payloads,
            dump.calls,
            dump.from_menus,
            dump.lifecycle,
            dump.close
        );
    }
    resolve_micros.sort_unstable();
    // The one cost this milestone adds to a click is the resolution, and a timer nobody looks at
    // is a timer that was never assigned: the group-resolving actions build the project facts, so
    // the median over them must not read as free.
    let median = resolve_micros
        .get(resolve_micros.len() / 2)
        .copied()
        .unwrap_or(0);
    println!(
        "scenarios {} payloads {total_payloads} calls {total_calls} fromMenus {from_menus} lifecycle {total_lifecycle} close {total_close} fork {total_fork} flags {total_flags} modals {total_modals} snooze {total_snooze} bulk {total_bulk} reload {total_reload} resolveUs median {median} max {}",
        scenarios.len(),
        resolve_micros.last().copied().unwrap_or(0)
    );
    if median == 0 {
        eprintln!(
            "the project-path resolution measured 0 us over {} probes, which is a timer that is not measuring what it says",
            resolve_micros.len()
        );
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}

struct Dump {
    value: Value,
    payloads: usize,
    calls: usize,
    from_menus: usize,
    lifecycle: usize,
    close: usize,
    fork: usize,
    flags: usize,
    modals: usize,
    snooze: usize,
    bulk: usize,
    reload: usize,
}

/// The menu dump `sidebar_menu_parity` writes for the same scenario, when it has been run.
fn menu_dump_beside(scenario: &std::path::Path) -> Option<Value> {
    let path = scenario.with_file_name(
        scenario
            .file_name()
            .and_then(|name| name.to_str())?
            .replace("scenario-", "rust-"),
    );
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn write_private(path: &std::path::Path, body: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(body.as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn build(
    scenario: &Value,
    menu_dump: Option<&Value>,
    clock_file: Option<&Value>,
    resolve_micros: &mut Vec<u128>,
) -> Option<Dump> {
    let now_ms = scenario.get("nowMs").and_then(Value::as_u64).unwrap_or(0);
    let mut core = Core::new();
    let frame = json!({
        "type": "presentationSnapshot",
        "protocolVersion": 1,
        "serverId": "parity",
        "clientId": "parity",
        "revision": scenario.pointer("/snapshot/revision").cloned().unwrap_or(json!(1)),
        "snapshot": scenario.get("snapshot")?.clone(),
    });
    let frame = ServerEvent::parse(&frame.to_string()).ok()?;
    let changes = core
        .handle(
            Event::Frame {
                machine: MachineId::Local,
                frame: Box::new(frame),
            },
            now_ms,
        )
        .changes;
    // One drawn list, under default inputs, so the dialog probes below ask about rows the sidebar
    // really draws. Nothing else in this example needs it.
    let mut model = SidebarViewModel::new();
    let view_inputs = SidebarInputs::default();
    model.update(&core, &view_inputs, &changes, now_ms);

    let project_ids: Vec<String> = scenario
        .pointer("/snapshot/projects")?
        .as_array()?
        .iter()
        .filter_map(|project| project.get("projectId")?.as_str())
        .map(str::to_string)
        .collect();

    // Two host input sets, because `parked_project_ids` is the one host value the resolution
    // reads: one where nothing is parked, and one where the FIRST project is, which is exactly
    // what takes a project's group away without touching the presentation.
    let parked = project_ids.first().cloned();
    let mut variants: Vec<(&str, SidebarInputs)> = vec![("none", SidebarInputs::default())];
    if let Some(parked) = parked.clone() {
        let mut inputs = SidebarInputs::default();
        inputs.host.recent_project_ids.insert(parked);
        variants.push(("firstParked", inputs));
    }

    let mut payloads: Vec<Value> = Vec::new();
    let mut from_menus = 0usize;
    for project_id in &project_ids {
        let group_id = format!("combined-project:{}", encode_uri_component(project_id));
        for kind in group_message_types() {
            payloads.push(json!({ "type": kind, "groupId": group_id }));
        }
    }
    for group_id in SYNTHETIC_GROUP_IDS {
        for kind in group_message_types() {
            payloads.push(json!({ "type": kind, "groupId": group_id }));
        }
    }
    // NOT probed: the three group actions with no `groupId` at all. `resolveProjectIdForGroup`
    // hands `undefined` to `parseGxserverPresentationProjectGroupId`, which throws, so the
    // TypeScript answers that payload with an unhandled rejection rather than with a call. The
    // renderer cannot build one (`NativeSidebarCommand` requires the field and every menu sets
    // it), so the two sides are not compared on a shape neither can be asked for. The two session
    // actions and the two copy actions ARE probed without their field, because those answer it.
    for session_id in session_ids(scenario).iter().chain(
        SYNTHETIC_SESSION_IDS
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<String>>()
            .iter(),
    ) {
        payloads.push(json!({ "type": "copyResumeCommand", "sessionId": session_id }));
        payloads.push(json!({ "type": "copyAttachCommand", "sessionId": session_id }));
    }
    payloads.push(json!({ "type": "copyResumeCommand" }));
    payloads.push(json!({ "type": "copyAttachCommand" }));
    for text in SYNTHETIC_TEXTS {
        payloads.push(json!({ "type": "copySessionDetails", "detailsText": text }));
        payloads.push(json!({ "type": "copyWorkspaceProjectRemoteUrl", "remoteUrl": text }));
    }
    payloads.push(json!({ "type": "copySessionDetails" }));
    payloads.push(json!({ "type": "copyWorkspaceProjectRemoteUrl" }));
    if let Some(dump) = menu_dump {
        let mut found: Vec<Value> = Vec::new();
        collect_menu_commands(dump, &mut found);
        from_menus = found.len();
        payloads.extend(found);
    }

    let mut entries: Vec<Value> = Vec::new();
    let mut calls = 0usize;
    for (variant, inputs) in &variants {
        for payload in &payloads {
            let started = Instant::now();
            let plan = plan_read_only_action(&core, inputs, payload)?;
            if payload
                .get("groupId")
                .and_then(Value::as_str)
                .is_some_and(|group_id| group_id.starts_with("combined-project:"))
            {
                resolve_micros.push(started.elapsed().as_micros());
            }
            calls += plan.effects.len();
            entries.push(json!({
                "variant": variant,
                "payload": payload,
                "calls": plan.to_json(),
            }));
        }
    }
    let lifecycle = lifecycle_entries(&core, scenario, now_ms);
    let lifecycle_count = lifecycle.len();
    let closes = close_entries(&core, scenario, now_ms);
    let close_count = closes.len();
    let forks = fork_entries(&core, scenario, now_ms);
    let fork_count = forks.len();
    let flags = flags_entries(&core, scenario, menu_dump, now_ms);
    let flags_count = flags.len();
    let modals = modal_entries(model.view());
    let opens = open_entries(model.view());
    let modal_count = modals.len() + opens.len();
    let bulk = bulk_entries(&core, scenario);
    let batch = batch_entries();
    let reload = reload_entries(&core, scenario);
    let split = split_entries(&core, scenario);
    let snooze_clock = snooze_clock_entries(clock_file);
    let snooze_boundary = snooze_boundary_entries(&core, scenario, model.view());
    let snooze_actions = snooze_action_entries(model.view(), clock_file);
    let snooze_calls = snooze_call_entries(scenario);
    let snooze_count =
        snooze_clock.len() + snooze_boundary.len() + snooze_actions.len() + snooze_calls.len();
    let bulk_count = bulk.len() + batch.len();
    let reload_count = reload.len() + split.len();
    Some(Dump {
        payloads: entries.len(),
        calls,
        from_menus,
        lifecycle: lifecycle_count,
        close: close_count,
        fork: fork_count,
        flags: flags_count,
        modals: modal_count,
        snooze: snooze_count,
        bulk: bulk_count,
        reload: reload_count,
        value: json!({
            "parkedProjectId": parked,
            "entries": Value::Array(entries),
            "lifecycle": Value::Array(lifecycle),
            "close": Value::Array(closes),
            "fork": Value::Array(forks),
            "flags": Value::Array(flags),
            "modals": Value::Array(modals),
            "open": Value::Array(opens),
            "titleRule": Value::Array(title_rule_entries()),
            "snoozeClock": Value::Array(snooze_clock),
            "snoozeBoundary": Value::Array(snooze_boundary),
            "snoozeActions": Value::Array(snooze_actions),
            "snoozeCalls": Value::Array(snooze_calls),
            "bulk": Value::Array(bulk),
            "batch": Value::Array(batch),
            "reload": Value::Array(reload),
            "split": Value::Array(split),
        }),
    })
}

/// The transition half of the gate.
///
/// A lifecycle action is not one answer but four, and only the first is visible in a call diff:
/// what the call was, what the client shows the moment the daemon accepts it, what it shows when
/// the daemon then echoes AGREEMENT, and what it shows when the daemon echoes something ELSE. The
/// last one is the case that reaches users (the row said asleep, the daemon says running) and the
/// one nothing has ever compared, so every entry here carries all four.
///
/// Every session of the recording is driven, under both calls and under three starting focus
/// states, because the focus is what decides the follow-ups: which row the sleep hands the focus
/// to, and whether a wake takes it back.
fn lifecycle_entries(core: &Core, scenario: &Value, now_ms: u64) -> Vec<Value> {
    let rows: Vec<Value> = scenario
        .pointer("/snapshot/sessions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut targets: Vec<(String, String, Option<Value>)> = rows
        .iter()
        .filter_map(|row| {
            Some((
                row.get("projectId")?.as_str()?.to_string(),
                row.get("sessionId")?.as_str()?.to_string(),
                Some(row.clone()),
            ))
        })
        .collect();
    // A session the store has never heard of, which the TypeScript still calls the daemon for,
    // because `parseGxserverPresentationProjectSessionId` is a string parse and asks the store
    // nothing.
    targets.push((
        "unknown-project".to_string(),
        "unknown-session".to_string(),
        None,
    ));
    // A session of the Quick Automations project, whose whole answer is "nothing happens".
    targets.push((
        QUICK_AUTOMATIONS_PROJECT_ID.to_string(),
        "quick-1".to_string(),
        None,
    ));
    // The focus sitting on a real row of another project, so "somewhere else" is a row the store
    // holds rather than an id it would drop.
    let first_project = targets.first().map(|(project_id, _, _)| project_id.clone());
    let elsewhere = targets
        .iter()
        .rev()
        .find(|(project_id, _, row)| row.is_some() && Some(project_id) != first_project.as_ref())
        .map(|(project_id, session_id, _)| SessionKey::local(project_id, session_id));
    let mut entries = Vec::new();
    for (project_id, session_id, row) in &targets {
        let session = SessionKey::local(project_id, session_id);
        for sleeping in [true, false] {
            // `movesDuringCall` is the state the other three cannot reach: the user picks
            // another session WHILE the daemon is answering. It is the only way to exercise
            // `focusMovedElsewhereDuringWake`, and without it a wake that steals the focus back
            // is invisible to this gate.
            for focus in ["self", "other", "none", "movesDuringCall"] {
                let focused = match focus {
                    "self" | "movesDuringCall" => Some(session.clone()),
                    "other" => elsewhere.clone(),
                    _ => None,
                };
                entries.push(lifecycle_entry(
                    core,
                    &session,
                    sleeping,
                    focus,
                    focused,
                    match focus {
                        "movesDuringCall" => elsewhere.clone(),
                        _ => None,
                    },
                    row.as_ref(),
                    now_ms,
                ));
            }
        }
    }
    entries
}

/// One action, driven from one starting state through all three answers and, for the accepted
/// one, all three echoes.
fn lifecycle_entry(
    core: &Core,
    session: &SessionKey,
    sleeping: bool,
    focus: &str,
    focused: Option<SessionKey>,
    // Where the focus moved to while the daemon was answering, when this case is about that.
    moved_to: Option<SessionKey>,
    row: Option<&Value>,
    now_ms: u64,
) -> Value {
    let mut base = core.clone();
    if let Some(focused) = &focused {
        base.handle(
            Event::Intent(Intent::FocusSession {
                session: focused.clone(),
                visible: None,
            }),
            now_ms,
        );
    }
    let payload = json!({
        "type": "setSessionSleeping",
        "sessionId": session.to_sidebar_session_id(),
        "sleeping": sleeping,
    });
    let Some(request) = plan_lifecycle_request(&base, &payload) else {
        return json!({
            "sessionId": session.to_sidebar_session_id(),
            "sleeping": sleeping,
            "focus": focus,
            "owned": false,
        });
    };
    // The focus as the answer finds it, which is not always the focus the call left with.
    let focused_now = moved_to.or_else(|| base.focus().focused_session.clone());
    // Each answer is compared by what it LEAVES, not by the follow-up list: the two sides express
    // the optimistic value differently (an overlay here, a written row there), so the comparable
    // thing is the state the sidebar would draw afterwards plus which row took the focus.
    let mut answers = Map::new();
    let mut accepted_store = base.clone();
    for answer in [
        LifecycleAnswer::Accepted,
        LifecycleAnswer::Declined,
        LifecycleAnswer::Failed,
    ] {
        let follow_ups = apply_lifecycle_answer(&request, answer, focused_now.as_ref(), now_ms);
        let mut store = base.clone();
        for follow_up in &follow_ups {
            if let LifecycleFollowUp::Patch { session, patch } = follow_up {
                store.handle(
                    Event::Intent(Intent::PatchSession {
                        session: session.clone(),
                        patch: patch.clone(),
                    }),
                    now_ms,
                );
            }
        }
        answers.insert(
            answer.as_str().to_string(),
            json!({
                "state": lifecycle_json(effective_lifecycle(&store, session).as_deref()),
                "focus": Value::Array(
                    follow_ups
                        .iter()
                        .filter(|follow_up| matches!(follow_up, LifecycleFollowUp::Focus { .. }))
                        .map(LifecycleFollowUp::to_json)
                        .collect(),
                ),
            }),
        );
        if answer == LifecycleAnswer::Accepted {
            accepted_store = store;
        }
    }
    // The echo half: the daemon is made to say three different things about the same row, from the
    // state an accepted answer left behind.
    let after = accepted_store;
    let mut echo = Map::new();
    if let Some(row) = row {
        let original = row
            .get("lifecycleState")
            .and_then(Value::as_str)
            .unwrap_or("running")
            .to_string();
        let agreed = match sleeping {
            true => "sleeping".to_string(),
            false => "running".to_string(),
        };
        // The third echo has to be a value NEITHER side predicted, so it is chosen against both
        // the row\'s own state and the one the action asked for. Picking a fixed word instead made
        // this probe agree with `stillOld` for every already-stopped row, and the three echoes
        // then said the same thing and proved nothing.
        let moved_on = ["stopped", "running", "sleeping", "unknown"]
            .into_iter()
            .find(|state| *state != original && *state != agreed)
            .unwrap_or("unknown")
            .to_string();
        let mut states = Map::new();
        states.insert("agrees".to_string(), Value::String(agreed.clone()));
        states.insert("stillOld".to_string(), Value::String(original.clone()));
        states.insert("movedOn".to_string(), Value::String(moved_on.clone()));
        echo.insert("states".to_string(), Value::Object(states));
        for (name, state) in [
            ("agrees", agreed.clone()),
            ("stillOld", original.clone()),
            ("movedOn", moved_on.clone()),
        ] {
            let mut echoed = after.clone();
            let mut echo_row = row.clone();
            echo_row["lifecycleState"] = Value::String(state.clone());
            let frame = json!({
                "type": "presentationDelta",
                "protocolVersion": 1,
                "serverId": "parity",
                "clientId": "parity",
                "revision": now_revision(&echoed, session),
                "delta": { "type": "sessionUpdated", "session": echo_row },
            });
            // A gate whose echo silently fails to apply cannot fail: every one of the three
            // answers would then read back the optimistic value, and two of the three are
            // ALLOWED to. So a frame that does not parse, or that the store ignores, stops the
            // run instead of quietly agreeing with itself.
            let parsed = ServerEvent::parse(&frame.to_string())
                .unwrap_or_else(|error| panic!("the echo frame does not parse: {error:?}"));
            let output = echoed.handle(
                Event::Frame {
                    machine: MachineId::Local,
                    frame: Box::new(parsed),
                },
                now_ms,
            );
            assert!(
                output.changes.ignored.is_none(),
                "the echo frame was ignored: {:?}",
                output.changes.ignored
            );
            echo.insert(
                name.to_string(),
                lifecycle_json(effective_lifecycle(&echoed, session).as_deref()),
            );
        }
    }
    json!({
        "sessionId": session.to_sidebar_session_id(),
        "sleeping": sleeping,
        "focus": focus,
        "owned": true,
        "request": request.to_json(),
        "answers": Value::Object(answers),
        "echo": Value::Object(echo),
    })
}

/// One past the revision the store holds, so the delta is never dropped as stale.
fn now_revision(core: &Core, session: &SessionKey) -> i64 {
    core.presentation()
        .loaded(&session.machine)
        .map(|loaded| loaded.revision + 1)
        .unwrap_or(1)
}

/// The lifecycle state the sidebar would draw for a row: the daemon value with the overlay on top,
/// and nothing at all when the row is not there.
fn effective_lifecycle(core: &Core, session: &SessionKey) -> Option<String> {
    core.presentation()
        .machine(&session.machine)?
        .effective_session(&session.project_id, &session.session_id)
        .map(|row| row.lifecycle_state.as_str().to_string())
}

fn lifecycle_json(state: Option<&str>) -> Value {
    state.map_or(Value::Null, |state| Value::String(state.to_string()))
}

fn group_message_types() -> Vec<&'static str> {
    READ_ONLY_MESSAGE_TYPES
        .into_iter()
        .filter(|kind| kind.ends_with("ForGroup"))
        .collect()
}

/// Every session the recording holds, in its sidebar form.
fn session_ids(scenario: &Value) -> Vec<String> {
    scenario
        .pointer("/snapshot/sessions")
        .and_then(Value::as_array)
        .map(|sessions| {
            sessions
                .iter()
                .filter_map(|session| {
                    Some(format!(
                        "combined-session:{}:{}",
                        encode_uri_component(session.get("projectId")?.as_str()?),
                        encode_uri_component(session.get("sessionId")?.as_str()?)
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Every `{ type: 'command', message }` payload anywhere in a menu dump whose message is one of
/// the types this milestone ported, deduplicated and in a stable order.
fn collect_menu_commands(value: &Value, found: &mut Vec<Value>) {
    match value {
        Value::Object(entries) => {
            if entries.get("type") == Some(&Value::String("command".to_string())) {
                if let Some(Value::Object(message)) = entries.get("message") {
                    if message
                        .get("type")
                        .and_then(Value::as_str)
                        .is_some_and(|kind| READ_ONLY_MESSAGE_TYPES.contains(&kind))
                    {
                        let message = Value::Object(message.clone());
                        if !found.contains(&message) {
                            found.push(message);
                        }
                    }
                }
            }
            for item in entries.values() {
                collect_menu_commands(item, found);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_menu_commands(item, found);
            }
        }
        _ => {}
    }
}

/// The close half of the gate.
///
/// Close is the only action whose optimistic update takes a row AWAY, so it gets a fourth answer
/// the other actions do not have: the call that never comes home. That is the case where an
/// optimistic removal and a never-arriving echo leave the client's story permanently ahead of the
/// daemon's, and it is the one the original cannot even reach, because its `rpc` is a bare `fetch`
/// with no timeout.
///
/// Every entry carries what the user sees at three moments: the instant they click, once the
/// answer is in (for each of the four answers), and after the daemon says one of three things
/// about the row afterwards.
fn close_entries(core: &Core, scenario: &Value, now_ms: u64) -> Vec<Value> {
    let rows: Vec<Value> = scenario
        .pointer("/snapshot/sessions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut targets: Vec<(String, String, Option<Value>)> = rows
        .iter()
        .filter_map(|row| {
            Some((
                row.get("projectId")?.as_str()?.to_string(),
                row.get("sessionId")?.as_str()?.to_string(),
                Some(row.clone()),
            ))
        })
        .collect();
    targets.push((
        "unknown-project".to_string(),
        "unknown-session".to_string(),
        None,
    ));
    let first_project = targets.first().map(|(project_id, _, _)| project_id.clone());
    let elsewhere = targets
        .iter()
        .rev()
        .find(|(project_id, _, row)| row.is_some() && Some(project_id) != first_project.as_ref())
        .map(|(project_id, session_id, _)| SessionKey::local(project_id, session_id));
    let mut entries = Vec::new();
    for (project_id, session_id, row) in &targets {
        let session = SessionKey::local(project_id, session_id);
        for focus in ["self", "other", "none"] {
            let focused = match focus {
                "self" => Some(session.clone()),
                "other" => elsewhere.clone(),
                _ => None,
            };
            entries.push(close_entry(
                core,
                &session,
                focus,
                focused,
                row.as_ref(),
                now_ms,
            ));
        }
    }
    entries
}

fn close_entry(
    core: &Core,
    session: &SessionKey,
    focus: &str,
    focused: Option<SessionKey>,
    row: Option<&Value>,
    now_ms: u64,
) -> Value {
    let mut base = core.clone();
    if let Some(focused) = &focused {
        base.handle(
            Event::Intent(Intent::FocusSession {
                session: focused.clone(),
                visible: None,
            }),
            now_ms,
        );
    }
    let payload = json!({
        "type": "closeSession",
        "sessionId": session.to_sidebar_session_id(),
    });
    let Some(request) = plan_close_request(&base, &payload) else {
        return json!({
            "sessionId": session.to_sidebar_session_id(),
            "focus": focus,
            "owned": false,
        });
    };
    // The click itself.
    let optimistic = close_optimistic_follow_ups(&request);
    let mut after_click = base.clone();
    run_close_follow_ups(&mut after_click, &optimistic, now_ms);
    let mut answers = Map::new();
    let mut accepted_store = after_click.clone();
    for answer in [
        CloseAnswer::Accepted,
        CloseAnswer::Failed,
        CloseAnswer::NeverAnswered,
    ] {
        let follow_ups = apply_close_answer(&request, answer);
        let mut store = after_click.clone();
        run_close_follow_ups(&mut store, &follow_ups, now_ms);
        answers.insert(
            answer.as_str().to_string(),
            json!({ "drawn": row_is_drawn(&store, session) }),
        );
        if answer == CloseAnswer::Accepted {
            accepted_store = store;
        }
    }
    let mut echo = Map::new();
    if let Some(row) = row {
        // What the daemon can say next about a row the client has already taken away.
        for (name, frame) in [
            (
                "removed",
                json!({
                    "type": "sessionRemoved",
                    "projectId": session.project_id,
                    "sessionId": session.session_id,
                }),
            ),
            (
                "stillRunning",
                json!({
                    "type": "sessionUpdated",
                    "session": with_lifecycle(row, "running"),
                }),
            ),
            (
                "stopped",
                json!({
                    "type": "sessionUpdated",
                    "session": with_lifecycle(row, "stopped"),
                }),
            ),
        ] {
            let mut echoed = accepted_store.clone();
            let envelope = json!({
                "type": "presentationDelta",
                "protocolVersion": 1,
                "serverId": "parity",
                "clientId": "parity",
                "revision": now_revision(&echoed, session),
                "delta": frame,
            });
            let parsed = ServerEvent::parse(&envelope.to_string())
                .unwrap_or_else(|error| panic!("the close echo frame does not parse: {error:?}"));
            let output = echoed.handle(
                Event::Frame {
                    machine: MachineId::Local,
                    frame: Box::new(parsed),
                },
                now_ms,
            );
            assert!(
                output.changes.ignored.is_none(),
                "the close echo frame was ignored: {:?}",
                output.changes.ignored
            );
            echo.insert(
                name.to_string(),
                json!({ "drawn": row_is_drawn(&echoed, session) }),
            );
        }
    }
    json!({
        "sessionId": session.to_sidebar_session_id(),
        "focus": focus,
        "owned": true,
        "request": request.to_json(),
        "optimistic": {
            "drawn": row_is_drawn(&after_click, session),
            "focus": Value::Array(
                optimistic
                    .iter()
                    .filter(|follow_up| matches!(follow_up, CloseFollowUp::Focus { .. }))
                    .map(CloseFollowUp::to_json)
                    .collect(),
            ),
        },
        "answers": Value::Object(answers),
        "echo": Value::Object(echo),
    })
}

fn with_lifecycle(row: &Value, state: &str) -> Value {
    let mut row = row.clone();
    row["lifecycleState"] = Value::String(state.to_string());
    row
}

fn run_close_follow_ups(core: &mut Core, follow_ups: &[CloseFollowUp], now_ms: u64) {
    for follow_up in follow_ups {
        let intent = match follow_up {
            CloseFollowUp::Hide { session } => Intent::HideSession {
                session: session.clone(),
            },
            CloseFollowUp::Unhide { session } => Intent::UnhideSession {
                session: session.clone(),
            },
            CloseFollowUp::Focus { .. } => continue,
        };
        core.handle(Event::Intent(intent), now_ms);
    }
}

/// Whether the sidebar would draw the row at all: the daemon holds it and no local overlay hides
/// it. This is the only thing a close can be judged by, because a close does not change a value,
/// it changes whether there is a row.
fn row_is_drawn(core: &Core, session: &SessionKey) -> bool {
    core.presentation()
        .machine(&session.machine)
        .and_then(|entry| entry.effective_session(&session.project_id, &session.session_id))
        .is_some()
}

/// The fork half of the gate.
///
/// Fork has no optimistic half to compare, which is itself the thing worth proving: the pane move
/// happens only after the daemon has answered with a session id, so the four answers are a call
/// that succeeds, one that succeeds with nothing usable in it, one that fails, and one that never
/// comes home. Only the first places a pane; the other three must all land in the same toast and
/// move nothing.
///
/// **The user-made group is BUILT here**, the same way the app-tab probe is: no recording carries
/// a workspace session groups document, so a fork from inside a group was unreachable on both
/// sides and a port that answered it any way at all would have passed. Each probed row is run
/// twice, once against an empty document and once against one that holds that row in `group-1`,
/// and the document the probe planned against rides in the entry so the TypeScript half starts
/// from the same one rather than from a label. What that second run compares is the whole of what
/// the group leg does: the group that becomes active BEFORE the call, and the document the answer
/// writes.
fn fork_entries(core: &Core, scenario: &Value, now_ms: u64) -> Vec<Value> {
    let rows: Vec<Value> = scenario
        .pointer("/snapshot/sessions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut targets: Vec<(String, String)> = rows
        .iter()
        .filter_map(|row| {
            Some((
                row.get("projectId")?.as_str()?.to_string(),
                row.get("sessionId")?.as_str()?.to_string(),
            ))
        })
        .collect();
    // A row the store does not hold: the fork has no source and neither side calls anything.
    targets.push(("unknown-project".to_string(), "unknown-session".to_string()));
    let mut entries = Vec::new();
    for (project_id, session_id) in &targets {
        let session = SessionKey::local(project_id, session_id);
        for (groups_case, groups_json) in [
            ("noGroups", empty_workspace_groups()),
            ("inGroup", workspace_groups_holding(project_id, session_id)),
        ] {
            let document = WorkspaceGroupsDocument::parse(&groups_json);
            for active in ["elsewhere", "already"] {
                let mut base = core.clone();
                if let Ok(state) = serde_json::from_value::<
                    ghostex_gx_protocol::WorkspaceSessionGroupsState,
                >(groups_json.clone())
                {
                    base.handle(
                        Event::Intent(Intent::SetSideState {
                            machine: MachineId::Local,
                            update: Box::new(SideStateUpdate::WorkspaceGroups(state)),
                        }),
                        now_ms,
                    );
                }
                if active == "already" {
                    base.handle(
                        Event::Intent(Intent::FocusSession {
                            session: session.clone(),
                            visible: None,
                        }),
                        now_ms,
                    );
                }
                // Recorded rather than assumed. A loaded snapshot already re-homes the focus to SOME
                // project, so "do nothing" does not mean "no project is active", and for a session of
                // that project it silently means the opposite of what the case is called. The
                // TypeScript half starts from this exact pair instead of from a label.
                let focus = base.focus();
                let active_before = json!({
                    "project": focus.active_project.as_ref().map(ProjectKey::to_workspace_project_id),
                    "group": focus.active_group.as_ref().map(ActiveGroup::to_sidebar_group_id),
                });
                let Some(request) = plan_fork_request(
                    &base,
                    &json!({
                        "type": "forkSession",
                        "sessionId": session.to_sidebar_session_id(),
                    }),
                ) else {
                    entries.push(json!({
                        "sessionId": session.to_sidebar_session_id(),
                        "active": active,
                        "groupsCase": groups_case,
                        "workspaceGroups": groups_json,
                        "activeBefore": active_before,
                        "owned": false,
                    }));
                    continue;
                };
                let mut answers = Map::new();
                for (name, result) in fork_answers(session_id) {
                    answers.insert(
                        name.to_string(),
                        Value::Array(
                            apply_fork_answer(
                                &document,
                                &request,
                                result.as_ref().map_err(String::as_str),
                            )
                            .iter()
                            .map(ForkFollowUp::to_json)
                            .collect(),
                        ),
                    );
                }
                entries.push(json!({
                    "sessionId": session.to_sidebar_session_id(),
                    "active": active,
                    "groupsCase": groups_case,
                    "workspaceGroups": groups_json,
                    "activeBefore": active_before,
                    "owned": true,
                    "request": request.to_json(),
                    "answers": Value::Object(answers),
                }));
            }
        }
    }
    entries
}

/// A document with nothing in it, which is what every scenario really has.
fn empty_workspace_groups() -> Value {
    json!({ "projectOrder": [], "projects": {} })
}

/// A document that holds one row in a user-made group, with a second group beside it so a port
/// that always picks the first group is a difference, and a second member so the forked session
/// landing anywhere but at the END of the list is one too.
fn workspace_groups_holding(project_id: &str, session_id: &str) -> Value {
    json!({
        "projectOrder": [project_id],
        "projects": {
            project_id: {
                "groups": [
                    { "groupId": "group-2", "sessionIds": ["not-a-real-session"], "title": "Other" },
                    {
                        "groupId": "group-1",
                        "sessionIds": ["probe-member", session_id],
                        "title": "Review",
                    },
                ],
                "nextGroupNumber": 3,
            },
        },
    })
}

/// The four things `/api/forkSession` can do, in the shape the host hands them on.
fn fork_answers(session_id: &str) -> Vec<(&'static str, Result<Value, String>)> {
    vec![
        (
            "accepted",
            Ok(json!({ "fork": { "session": { "sessionId": format!("{session_id}-fork") } } })),
        ),
        // A success envelope with nothing usable in it. The TypeScript throws its own error for
        // this and lands in the same toast as a transport failure, which is the leg a port is
        // most likely to answer with a pane that has no session behind it.
        ("emptyFork", Ok(json!({ "fork": { "session": {} } }))),
        ("failed", Err("transport".to_string())),
        ("neverAnswered", Err("timeout".to_string())),
    ]
}

/// The flags half of the gate.
///
/// Four commands, one call, and two details that are easy to lose: a tag also writes the star, and
/// a cleared tag reaches the daemon as an explicit `null` but reaches the row as an ABSENT field.
/// Both are probed directly rather than left to whichever tags a recording happens to contain, and
/// every tag the real menus can emit is added on top of them from the menu dump.
fn flags_entries(
    core: &Core,
    scenario: &Value,
    menu_dump: Option<&Value>,
    now_ms: u64,
) -> Vec<Value> {
    let rows: Vec<Value> = scenario
        .pointer("/snapshot/sessions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut tags: Vec<Value> = vec![
        Value::String("favorite".to_string()),
        Value::String("later".to_string()),
        // The clear, which is the leg a port collapses into "say nothing".
        Value::Null,
    ];
    if let Some(dump) = menu_dump {
        let mut found: Vec<Value> = Vec::new();
        collect_tag_values(dump, &mut found);
        for tag in found {
            if !tags.contains(&tag) {
                tags.push(tag);
            }
        }
    }
    let mut entries = Vec::new();
    for row in rows.iter().take(FLAGS_ROWS_PER_SCENARIO) {
        let (Some(project_id), Some(session_id)) = (
            row.get("projectId").and_then(Value::as_str),
            row.get("sessionId").and_then(Value::as_str),
        ) else {
            continue;
        };
        let session = SessionKey::local(project_id, session_id);
        let sidebar_session_id = session.to_sidebar_session_id();
        let mut payloads: Vec<Value> = vec![
            json!({ "type": "setSessionPinned", "sessionId": sidebar_session_id, "pinned": true }),
            json!({ "type": "setSessionPinned", "sessionId": sidebar_session_id, "pinned": false }),
            json!({ "type": "setSessionParked", "sessionId": sidebar_session_id, "parked": true }),
            json!({ "type": "setSessionParked", "sessionId": sidebar_session_id, "parked": false }),
            json!({ "type": "setSessionFavorite", "sessionId": sidebar_session_id, "favorite": true }),
            json!({ "type": "setSessionFavorite", "sessionId": sidebar_session_id, "favorite": false }),
        ];
        for tag in &tags {
            payloads.push(json!({
                "type": "setSessionTag",
                "sessionId": sidebar_session_id,
                "sessionTag": tag,
            }));
        }
        for payload in payloads {
            // Parking is the one leg a setting changes, so both settings are driven.
            for sleep_when_parking in [false, true] {
                let Some(request) = plan_flags_request(&payload, sleep_when_parking) else {
                    entries.push(json!({ "payload": payload, "sleepWhenParking": sleep_when_parking, "owned": false }));
                    continue;
                };
                let mut answers = Map::new();
                for accepted in [true, false] {
                    let follow_ups = apply_flags_answer(&request, accepted, now_ms);
                    let mut store = core.clone();
                    for follow_up in &follow_ups {
                        if let FlagsFollowUp::Patch { session, patch } = follow_up {
                            store.handle(
                                Event::Intent(Intent::PatchSession {
                                    session: session.clone(),
                                    patch: patch.clone(),
                                }),
                                now_ms,
                            );
                        }
                    }
                    answers.insert(
                        match accepted {
                            true => "accepted".to_string(),
                            false => "failed".to_string(),
                        },
                        json!({
                            "follow": Value::Array(
                                follow_ups.iter().map(FlagsFollowUp::to_json).collect(),
                            ),
                            "row": flags_row(&store, &session),
                        }),
                    );
                }
                entries.push(json!({
                    "payload": payload,
                    "sleepWhenParking": sleep_when_parking,
                    "owned": true,
                    "request": request.to_json(),
                    "answers": Value::Object(answers),
                }));
            }
        }
    }
    entries
}

/// Enough rows to cover the shapes without multiplying the whole recording by twenty payloads:
/// the flags path reads nothing about the row, so a second hundred rows would add no branch.
const FLAGS_ROWS_PER_SCENARIO: usize = 12;

/// The four fields a flag call can move, as the sidebar would draw them.
fn flags_row(core: &Core, session: &SessionKey) -> Value {
    match core
        .presentation()
        .machine(&session.machine)
        .and_then(|entry| entry.effective_session(&session.project_id, &session.session_id))
    {
        Some(row) => json!({
            "isPinned": row.is_pinned,
            "isParked": row.is_parked,
            "isFavorite": row.is_favorite,
            "sessionTag": row.session_tag,
        }),
        None => Value::Null,
    }
}

/// Every `sessionTag` value anywhere in a menu dump, so the gate asks about the tags the user's
/// own catalog really offers and not only the two written above.
fn collect_tag_values(value: &Value, found: &mut Vec<Value>) {
    match value {
        Value::Object(entries) => {
            if entries.get("type") == Some(&Value::String("setSessionTag".to_string())) {
                if let Some(tag) = entries.get("sessionTag") {
                    if !found.contains(tag) {
                        found.push(tag.clone());
                    }
                }
            }
            for item in entries.values() {
                collect_tag_values(item, found);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_tag_values(item, found);
            }
        }
        _ => {}
    }
}

/// The dialog half of the gate.
///
/// Rename and Note call nothing, so what is compared is the pair of host calls they make: the
/// dismissal the open dialog is closed with, and the payload the new one is seeded with. The seed
/// is the row's own title and note, which is where the title rule lives, so the probe drives every
/// drawn row rather than a sample: a row whose primary title is blank, whose terminal title is
/// blank, or which has neither takes a different branch of the same `||` chain.
fn modal_entries(view: &SidebarView) -> Vec<Value> {
    let mut entries = Vec::new();
    for group in &view.groups {
        for session in &group.core.sessions {
            let sidebar_session_id = session.row.sidebar_session_id.clone();
            for action in ["rename", "note", "firstMessage", "delayedSend"] {
                let payload = json!({
                    "type": "sessionAction",
                    "sessionId": sidebar_session_id,
                    "action": action,
                });
                // The row the seed comes from travels with the entry. Which rows a group holds
                // is M4a's gate, not this one; what this one asks is what the two sides make of
                // the SAME row, so re-deriving the row here would add a second place to differ.
                let row = json!({
                    "primaryTitle": session.row.menu_facts.primary_title,
                    "terminalTitle": session.row.menu_facts.terminal_title,
                    "alias": session.row.alias,
                    "agentIcon": session.row.agent_icon,
                    "sessionNote": session.row.session_note,
                });
                match plan_modal_action(view, &payload) {
                    Some(plan) => entries.push(json!({
                        "payload": payload,
                        "row": row,
                        "owned": true,
                        "action": plan.to_json(),
                    })),
                    None => entries.push(json!({ "payload": payload, "row": row, "owned": false })),
                }
            }
        }
    }
    entries
}

/// The Full Reload and Split Right half of the gate.
///
/// Neither payload makes a call of its own, so what is compared is the SEQUENCE and the BRANCH: how
/// many legs a reload runs, in what order, and which of them asks for the remount; and whether a
/// split wakes the row with the placement or only selects it with the placement. Both of those are
/// invisible in a list comparison and both are wrong in a way the user feels: a reload whose wake
/// overtakes its sleep reloads nothing, and a split that forgets the placement opens the session in
/// the tab it already had instead of a new pane.
///
/// Every row of the recording is probed, plus the id shapes no recording holds. The split branch is
/// chosen by the row's lifecycle, so the counters on both sides have to see both branches; the
/// gate's zero-check is what enforces that rather than an assumption about the recording.
fn reload_entries(core: &Core, scenario: &Value) -> Vec<Value> {
    let mut ids: Vec<String> = session_ids(scenario)
        .into_iter()
        .take(RELOAD_SESSIONS_PER_SCENARIO)
        .collect();
    for id in SYNTHETIC_SESSION_IDS {
        ids.push(id.to_string());
    }
    // A Quick Automations row, whose whole answer on both sides is that nothing happens, and a row
    // the store has never heard of.
    ids.push(format!(
        "combined-session:{}:quick-1",
        encode_uri_component(QUICK_AUTOMATIONS_PROJECT_ID)
    ));
    ids.push("combined-session:unknown-project:unknown-session".to_string());
    let mut entries = Vec::new();
    for id in &ids {
        for kind in ["fullReloadSession", "restartSession"] {
            let payload = json!({ "type": kind, "sessionId": id });
            entries.push(match plan_full_reload(core, &payload) {
                Some(plan) => json!({ "payload": payload, "owned": true, "plan": plan.to_json() }),
                None => json!({ "payload": payload, "owned": false }),
            });
        }
    }
    entries
}

/// The Split Right half, in the same shape.
fn split_entries(core: &Core, scenario: &Value) -> Vec<Value> {
    let mut ids: Vec<String> = session_ids(scenario)
        .into_iter()
        .take(RELOAD_SESSIONS_PER_SCENARIO)
        .collect();
    for id in SYNTHETIC_SESSION_IDS {
        ids.push(id.to_string());
    }
    ids.push(format!(
        "combined-session:{}:quick-1",
        encode_uri_component(QUICK_AUTOMATIONS_PROJECT_ID)
    ));
    ids.push("combined-session:unknown-project:unknown-session".to_string());
    ids.into_iter()
        .map(|id| {
            let payload = json!({ "type": "splitSessionRight", "sessionId": id });
            match plan_split_right(core, &payload) {
                Some(plan) => json!({ "payload": payload, "owned": true, "plan": plan.to_json() }),
                None => json!({ "payload": payload, "owned": false }),
            }
        })
        .collect()
}

/// Enough rows to reach both split branches and every refusal without multiplying the recording.
const RELOAD_SESSIONS_PER_SCENARIO: usize = 12;

/// The bulk half of the gate.
///
/// A plural payload is a SET and an ORDER over actions that are already gated one at a time, so
/// that is what this compares: which rows, in which order, through which per-session action, and
/// whether the fan-out is paced. None of it is visible in a list comparison and the order is not
/// cosmetic, because a paced sleep sends the requests in exactly this order 350 ms apart.
///
/// Every project of the recording is probed with all four project payloads, and the two explicit
/// ones with id lists taken from the recording plus the shapes no recording contains (an empty
/// list, an id the store does not hold, a browser id, a remote id).
///
/// **The app-tab probe is BUILT here rather than looked for**, because no recording carries a
/// browser tab and both sides would otherwise never meet one. Since the user's 2026-09-21 decision
/// the demand on it is the opposite of what it was: the FIRST probed project is given two app tabs,
/// the same two are handed to the TypeScript half, and the comparison asks that the payload is
/// PERFORMED over the project's sessions and that neither side calls anything for a tab. A
/// leftover browser leg on either side shows up as an extra call in the set comparison.
///
/// **The remote probes are BUILT for the same reason**, and in two states rather than one. A
/// machine the store has LOADED must be answered, with that machine's scoped session ids and with
/// no active-project move, because `wakeProjectSleepingSessions` calls `focusProjectId` on its
/// local branch only. A machine the store has NOT loaded must be REFUSED while the old runtime
/// still holds its last-seen presentation, which is exactly what a disconnected machine looks like:
/// the TypeScript resolves a real set from that copy, so the two answers are only the same if the
/// refusal is there. `expectHandOffWork` is what the comparison demands of it, because a hand-off
/// nobody performs proves nothing.
fn bulk_entries(core: &Core, scenario: &Value) -> Vec<Value> {
    let project_ids: Vec<String> = scenario
        .pointer("/snapshot/projects")
        .and_then(Value::as_array)
        .map(|projects| {
            projects
                .iter()
                .filter_map(|project| project.get("projectId")?.as_str())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    // Each probe carries the app-tab list the TypeScript half is handed for the same entry, which
    // is empty for all but the app-tab probe below.
    let mut payloads: Vec<(Value, Vec<Value>)> = Vec::new();
    let project_payloads = |group_id: &str| {
        vec![
            json!({ "type": "setGroupSleeping", "groupId": group_id, "sleeping": true }),
            json!({ "type": "setGroupSleeping", "groupId": group_id, "sleeping": false }),
            json!({ "type": "wakeProjectSleepingSessions", "groupId": group_id }),
            json!({ "type": "sleepInactiveProjectSessions", "groupId": group_id }),
            json!({ "type": "closeInactiveProjectSessions", "groupId": group_id }),
        ]
    };
    for project_id in project_ids.iter().take(BULK_PROJECTS_PER_SCENARIO) {
        let group_id = format!("combined-project:{}", encode_uri_component(project_id));
        for payload in project_payloads(&group_id) {
            payloads.push((payload, Vec::new()));
        }
    }
    // The same four project payloads for a project that HAS app tabs, which no recording and no
    // scenario host can produce. Two tabs, one awake and visible and one asleep, because the legs
    // that were removed on both sides filtered on exactly those two fields: a probe with one tab
    // could not tell a set that still sleeps half the tabs from one that touches none.
    for project_id in project_ids.iter().take(1) {
        let group_id = format!("combined-project:{}", encode_uri_component(project_id));
        let tabs = vec![
            json!({
                "projectId": project_id,
                "tabId": "probe-tab-awake",
                "title": "Probe tab",
                "isActive": false,
                "isSleeping": false,
                "isVisible": false,
            }),
            json!({
                "projectId": project_id,
                "tabId": "probe-tab-asleep",
                "title": "Probe tab",
                "isActive": false,
                "isSleeping": true,
                "isVisible": false,
            }),
        ];
        for payload in project_payloads(&group_id) {
            payloads.push((payload, tabs.clone()));
        }
    }
    // The group shapes that resolve to no local project, each a refusal with its own reason.
    for group_id in SYNTHETIC_GROUP_IDS {
        payloads.push((
            json!({ "type": "setGroupSleeping", "groupId": group_id, "sleeping": true }),
            Vec::new(),
        ));
        payloads.push((
            json!({ "type": "wakeProjectSleepingSessions", "groupId": group_id }),
            Vec::new(),
        ));
    }
    // The same four payloads against a store with NO presentation for the machine, which is
    // `!this.presentation` and which every scenario is the opposite of. Three of the four cannot
    // tell an empty set from the early return, but a project wake moves the active project before
    // the early return would have happened, so this is the one branch where answering with zero
    // rows is not the same as not answering.
    let unloaded = Core::new();
    let mut unloaded_payloads: Vec<Value> = Vec::new();
    for project_id in project_ids.iter().take(1) {
        let group_id = format!("combined-project:{}", encode_uri_component(project_id));
        unloaded_payloads.extend(project_payloads(&group_id));
    }
    // The explicit lists a multi-selection sends.
    let selected: Vec<String> = session_ids(scenario)
        .into_iter()
        .take(BULK_SELECTED_PER_SCENARIO)
        .collect();
    for ids in [
        selected.clone(),
        Vec::new(),
        vec!["combined-session:nope:nope".to_string()],
        vec!["gpui-browser:P0erj:tab-1".to_string()],
        vec!["remote:machine-1:session:P0erj:S1".to_string()],
    ] {
        payloads.push((
            json!({ "type": "setSessionsSleeping", "sessionIds": ids, "sleeping": true, "source": "sleepBelow" }),
            Vec::new(),
        ));
        payloads.push((
            json!({ "type": "setSessionsSleeping", "sessionIds": ids, "sleeping": false }),
            Vec::new(),
        ));
        payloads.push((
            json!({ "type": "closeSessions", "sessionIds": ids }),
            Vec::new(),
        ));
    }
    // The remote arm, against a store that has STREAMED one remote machine and holds the stored
    // LAST-SEEN copy of a second, with this scenario's own rows on both.
    let remote_core = core_with_remote_machine(scenario);
    let mut remote_payloads: Vec<(Value, bool)> = Vec::new();
    for project_id in project_ids.iter().take(BULK_REMOTE_PROJECTS_PER_SCENARIO) {
        let loaded_group = format!("remote:{BULK_REMOTE_MACHINE}:group:{project_id}");
        let last_seen_group = format!("remote:{BULK_REMOTE_LAST_SEEN}:group:{project_id}");
        for payload in project_payloads(&loaded_group) {
            remote_payloads.push((payload, false));
        }
        // The same five payloads against the machine whose rows are the stored copy.
        //
        // CORRECTED 2026-09-21, and the correction is the point of this probe. It used to hand the
        // TypeScript half the set the LOADED machine resolves, on the argument that the old runtime
        // answers an offline machine from its last-seen copy. It does not: all four project
        // payloads and `fullReloadProjectZmxSessions` read `this.remotePresentations`, which a
        // machine that has not streamed in this run is absent from, while the copy the sidebar
        // DRAWS is the separate `remoteLastSeenPresentations`. So the right answer on both sides is
        // NOTHING, the store's refusal is what produces it, and the TypeScript half is handed the
        // machine as last-seen rather than as live so its own early return is the thing that runs.
        for payload in project_payloads(&last_seen_group) {
            remote_payloads.push((payload, true));
        }
    }
    // A project the loaded remote machine does not have: answered, with nothing in the set, which
    // is a different answer from the refusal above and must not collapse into it.
    for payload in project_payloads(&format!(
        "remote:{BULK_REMOTE_MACHINE}:group:does-not-exist"
    )) {
        remote_payloads.push((payload, false));
    }

    payloads
        .into_iter()
        .map(|(payload, tabs)| bulk_entry(plan_bulk_request(core, &payload), payload, tabs, false))
        .chain(unloaded_payloads.into_iter().map(|payload| {
            bulk_entry(
                plan_bulk_request(&unloaded, &payload),
                payload,
                Vec::new(),
                true,
            )
        }))
        .chain(remote_payloads.into_iter().map(|(payload, last_seen)| {
            let mut entry = bulk_entry(
                plan_bulk_request(&remote_core, &payload),
                payload,
                Vec::new(),
                false,
            );
            let object = entry.as_object_mut().expect("object");
            // The streamed machine is handed to the TypeScript half as a live presentation; the
            // seeded one is handed to it as the last-seen map it draws from and never acts on, so
            // the early return the store's refusal matches is the one that really runs there.
            object.insert("remoteMachines".to_string(), json!([BULK_REMOTE_MACHINE]));
            object.insert(
                "lastSeenMachines".to_string(),
                json!([BULK_REMOTE_LAST_SEEN]),
            );
            if last_seen {
                object.insert("lastSeen".to_string(), json!(true));
            }
            entry
        }))
        .collect()
}

/// This scenario's rows loaded three ways: as this computer's daemon, as a STREAMED remote
/// machine, and as `BULK_REMOTE_LAST_SEEN`, whose rows are seeded from the stored copy.
fn core_with_remote_machine(scenario: &Value) -> Core {
    let mut core = Core::new();
    let snapshot = scenario.get("snapshot").cloned().unwrap_or(json!({}));
    let revision = scenario
        .pointer("/snapshot/revision")
        .cloned()
        .unwrap_or(json!(1));
    let frame = json!({
        "type": "presentationSnapshot",
        "protocolVersion": 1,
        "serverId": "parity",
        "clientId": "parity",
        "revision": revision,
        "snapshot": snapshot,
    })
    .to_string();
    for machine in [
        MachineId::Local,
        MachineId::Remote(BULK_REMOTE_MACHINE.to_string()),
    ] {
        core.handle_raw_frame(machine, &frame, 0)
            .expect("the parity frame parses");
    }
    // The second machine holds the SAME rows, seeded from its stored last-seen copy rather than
    // streamed. That is the case the store could not reach until the copy was read back
    // (2026-09-21), and it is the one the project-scoped planners have to tell apart: the rows are
    // there and drawn, faded, and there is no tunnel behind them.
    let snapshot: ghostex_gx_core::protocol::PresentationSnapshot =
        serde_json::from_value(scenario.get("snapshot").cloned().unwrap_or(json!({})))
            .expect("the parity snapshot parses");
    core.seed_last_seen_presentation(
        &MachineId::Remote(BULK_REMOTE_LAST_SEEN.to_string()),
        snapshot,
    );
    core
}

/// One probe's answer, together with the facts the TypeScript half must start from rather than
/// from a label: the app tabs the project has, and whether the machine's rows are loaded.
fn bulk_entry(
    planned: Option<ghostex_gx_core::BulkRequest>,
    payload: Value,
    tabs: Vec<Value>,
    unloaded: bool,
) -> Value {
    let mut entry = json!({
        "payload": payload,
        "browserTabs": Value::Array(tabs),
        "presentation": match unloaded { true => "none", false => "loaded" },
    });
    let object = entry.as_object_mut().expect("object");
    match planned {
        Some(request) => {
            object.insert("owned".to_string(), Value::Bool(true));
            object.insert("request".to_string(), request.to_json());
        }
        None => {
            object.insert("owned".to_string(), Value::Bool(false));
        }
    }
    entry
}

/// Enough projects to cover the shapes without multiplying the recording by five payloads. The
/// resolution reads only the project's own rows, so a sixth project adds no branch.
const BULK_PROJECTS_PER_SCENARIO: usize = 5;
const BULK_SELECTED_PER_SCENARIO: usize = 4;
/// Two is enough for the remote arm: the branch reads only the project's own rows, and each project
/// is probed in both machine states.
const BULK_REMOTE_PROJECTS_PER_SCENARIO: usize = 2;

/// The renderer's batch envelope, which is a pass-through and is compared as one.
fn batch_entries() -> Vec<Value> {
    let message = |kind: &str| json!({ "type": kind, "sessionId": "combined-session:P0erj:S1" });
    let commands = vec![
        json!({ "type": "batch", "clearSelection": true, "messages": [message("closeSession")] }),
        json!({ "type": "batch", "messages": [message("closeSession"), message("forkSession")] }),
        json!({ "type": "batch", "messages": [] }),
        json!({ "type": "batch", "clearSelection": false, "messages": [message("closeSession")] }),
        // Not a batch at all, so the planner must not answer it.
        json!({ "type": "command", "message": message("closeSession") }),
    ];
    commands
        .into_iter()
        .map(|command| match plan_batch(&command) {
            Some(plan) => json!({ "command": command, "owned": true, "plan": plan.to_json() }),
            None => json!({ "command": command, "owned": false }),
        })
        .collect()
}

/// The wake-time half of the gate, driven directly from clock facts the harness wrote.
///
/// The rule reads the clock twice (the instant, and the local calendar behind "Tomorrow" and
/// "Next week"), so neither side may read a real clock while the gate runs: the harness pins a
/// time zone, writes a fixed instant per case together with the local offset at that instant and
/// the offset at 09:00 local on each of the next seven days, and both sides answer for exactly
/// those. A case list chosen here instead would be a list of instants that miss the two days a
/// year the answer is hard.
fn snooze_clock_entries(clock_file: Option<&Value>) -> Vec<Value> {
    let cases = clock_file
        .and_then(|file| file.get("cases"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    cases
        .iter()
        .filter_map(|case| {
            let clock = snooze_clock_from_case(case)?;
            let mut wake = Map::new();
            for preset in SESSION_SNOOZE_PRESETS {
                wake.insert(
                    preset.to_string(),
                    match snooze_wake_ms(preset, &clock) {
                        Some(ms) => Value::String(iso_string_from_ms(ms)),
                        None => Value::Null,
                    },
                );
            }
            // An unknown preset is refused rather than answered, and the harness asserts the
            // TypeScript throws on it rather than posting a call.
            wake.insert(
                "notAPreset".to_string(),
                match snooze_wake_ms("notAPreset", &clock) {
                    Some(ms) => Value::String(iso_string_from_ms(ms)),
                    None => Value::Null,
                },
            );
            Some(json!({
                "case": case.get("case").cloned().unwrap_or(Value::Null),
                "nowMs": clock.now_ms,
                "wake": Value::Object(wake),
            }))
        })
        .collect()
}

fn snooze_clock_from_case(case: &Value) -> Option<SnoozeClock> {
    let now_ms = case.get("nowMs")?.as_i64()?;
    let offset_ms = case.get("offsetMs")?.as_i64()?;
    let mut clock = SnoozeClock::fixed(now_ms, offset_ms);
    let offsets = case.get("morningOffsetsMs")?.as_array()?;
    for (index, slot) in clock.morning_offset_ms.iter_mut().enumerate() {
        if let Some(offset) = offsets.get(index).and_then(Value::as_i64) {
            *slot = offset;
        }
    }
    Some(clock)
}

/// The boundary half: the exact moment a snooze ends.
///
/// The action surface is not the only thing that has to agree about it. The section a row is drawn
/// in and the menu item that offers Snooze or Unsnooze read the same instant, and a port where
/// those drift by a tick draws a row under the Snoozed heading whose own menu already offers the
/// presets. So the probe reports what the shared predicate says AND which section the row really
/// lands in, rebuilt through the whole view model, and the harness holds both against the one
/// TypeScript predicate.
fn snooze_boundary_entries(core: &Core, scenario: &Value, view: &SidebarView) -> Vec<Value> {
    // A row the list really draws, so the section below is a section and not a `None`.
    let Some((session, row_id, storage_id)) = view
        .groups
        .iter()
        .find_map(|group| {
            let row = group
                .core
                .sessions
                .iter()
                .find(|session| !session.row.is_browser)?;
            Some((row, group.core.storage_id.clone()))
        })
        .and_then(|(session, storage_id)| {
            Some((
                SessionKey::parse_sidebar_session_id(&session.row.sidebar_session_id)?,
                session.row.sidebar_session_id.clone(),
                storage_id,
            ))
        })
    else {
        return Vec::new();
    };
    // Every heading open and the whole list shown, because a `SectionView` carries the rows it
    // DRAWS: Snoozed starts collapsed, so a probe under the defaults read `None` for exactly the
    // cases it exists to check and would have agreed with any answer at all.
    let mut inputs = SidebarInputs::default();
    inputs.ui.collapse.section_collapse.insert(
        storage_id.clone(),
        SectionCollapse {
            browser: false,
            pinned: false,
            drafts: false,
            sessions: false,
            parked: false,
            snoozed: false,
        },
    );
    inputs.ui.collapse.expanded_session_lists.insert(storage_id);
    let Some(server_row) = scenario
        .pointer("/snapshot/sessions")
        .and_then(Value::as_array)
        .and_then(|rows| {
            rows.iter().find(|row| {
                row.get("projectId").and_then(Value::as_str) == Some(session.project_id.as_str())
                    && row.get("sessionId").and_then(Value::as_str)
                        == Some(session.session_id.as_str())
            })
        })
        .cloned()
    else {
        return Vec::new();
    };
    // A round local instant, and the four stamps around it that decide the boundary.
    let now_ms: i64 = 1_800_000_000_000;
    let cases: Vec<(&str, Option<String>)> = vec![
        ("aTickBefore", Some(iso_string_from_ms(now_ms - 1))),
        ("exactly", Some(iso_string_from_ms(now_ms))),
        ("aTickAfter", Some(iso_string_from_ms(now_ms + 1))),
        ("aMinuteAfter", Some(iso_string_from_ms(now_ms + 60_000))),
        ("longPast", Some(iso_string_from_ms(now_ms - 86_400_000))),
        ("absent", None),
        ("empty", Some(String::new())),
        ("notADate", Some("not-a-date".to_string())),
    ];
    cases
        .into_iter()
        .map(|(name, snoozed_until)| {
            let mut echoed = core.clone();
            let mut echo_row = server_row.clone();
            match &snoozed_until {
                Some(value) => {
                    echo_row["snoozedUntil"] = Value::String(value.clone());
                }
                None => {
                    if let Some(object) = echo_row.as_object_mut() {
                        object.remove("snoozedUntil");
                    }
                }
            }
            let frame = json!({
                "type": "presentationDelta",
                "protocolVersion": 1,
                "serverId": "parity",
                "clientId": "parity",
                "revision": now_revision(&echoed, &session),
                "delta": { "type": "sessionUpdated", "session": echo_row },
            });
            let parsed = ServerEvent::parse(&frame.to_string())
                .unwrap_or_else(|error| panic!("the snooze echo frame does not parse: {error:?}"));
            let output = echoed.handle(
                Event::Frame {
                    machine: MachineId::Local,
                    frame: Box::new(parsed),
                },
                now_ms as u64,
            );
            assert!(
                output.changes.ignored.is_none(),
                "the snooze echo frame was ignored: {:?}",
                output.changes.ignored
            );
            let mut model = SidebarViewModel::new();
            model.update(&echoed, &inputs, &output.changes, now_ms as u64);
            let drawn = model
                .view()
                .groups
                .iter()
                .flat_map(|group| group.core.sessions.iter())
                .find(|session| session.row.sidebar_session_id == row_id);
            let snoozed_until_ms = drawn.and_then(|session| session.row.timing.snoozed_until_ms);
            let section = model
                .view()
                .groups
                .iter()
                .flat_map(|group| group.core.sections.iter())
                .find(|section| section.session_ids.iter().any(|id| *id == row_id))
                .map(|section| section.id.as_str().to_string());
            json!({
                "case": name,
                "snoozedUntil": snoozed_until,
                "nowMs": now_ms,
                "parsedMs": snoozed_until_ms,
                "isSnoozed": session_is_snoozed(snoozed_until_ms, now_ms as u64),
                "section": section,
            })
        })
        .collect()
}

/// The menu row: what `sessionAction: snooze` posts, for every preset, both tag shapes and the
/// absent one, under every clock case the harness wrote.
fn snooze_action_entries(view: &SidebarView, clock_file: Option<&Value>) -> Vec<Value> {
    let cases = clock_file
        .and_then(|file| file.get("cases"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let rows: Vec<String> = view
        .groups
        .iter()
        .flat_map(|group| group.core.sessions.iter())
        .filter(|session| !session.row.is_browser)
        .take(SNOOZE_ACTION_ROWS_PER_SCENARIO)
        .map(|session| session.row.sidebar_session_id.clone())
        .collect();
    let mut entries = Vec::new();
    for case in &cases {
        let Some(clock) = snooze_clock_from_case(case) else {
            continue;
        };
        for sidebar_session_id in &rows {
            for payload in snooze_action_payloads(sidebar_session_id) {
                entries.push(snooze_action_entry(view, &payload, &clock));
            }
        }
    }
    // A row the list does not draw stops the whole action before the switch, which is the one
    // refusal the menu itself cannot produce and the harness asserts posts nothing.
    if let Some(clock) = cases.first().and_then(snooze_clock_from_case) {
        for payload in snooze_action_payloads("combined-session:nope:nope") {
            entries.push(snooze_action_entry(view, &payload, &clock));
        }
    }
    entries
}

fn snooze_action_entry(view: &SidebarView, payload: &Value, clock: &SnoozeClock) -> Value {
    let planned = plan_snooze_action(view, payload, clock);
    // Whether the list draws the row travels with the entry rather than being decided again on
    // the other side: which rows a group holds is M4a's gate, and what this one asks is what the
    // two sides make of the SAME row. The TypeScript half seeds its store from this.
    let drawn = payload
        .get("sessionId")
        .and_then(Value::as_str)
        .is_some_and(|id| {
            view.groups
                .iter()
                .flat_map(|group| group.core.sessions.iter())
                .any(|session| session.row.sidebar_session_id == id)
        });
    json!({
        "payload": payload,
        "nowMs": clock.now_ms,
        "drawn": drawn,
        "owned": planned.is_some(),
        "messages": planned.map(|action| action.to_json()).unwrap_or(Value::Null),
    })
}

/// Enough rows to cover the shapes: the action reads nothing about a row beyond whether it is
/// drawn, so a second hundred rows would add no branch and would multiply by every clock case.
const SNOOZE_ACTION_ROWS_PER_SCENARIO: usize = 2;

/// Every shape `snooze_with_tag` and the plain preset row can build, plus the two the renderer can
/// be handed with no preset at all.
fn snooze_action_payloads(sidebar_session_id: &str) -> Vec<Value> {
    let mut payloads = Vec::new();
    for preset in SESSION_SNOOZE_PRESETS {
        for tag in [None, Some(Value::Null), Some(Value::String("later".into()))] {
            let mut payload = json!({
                "type": "sessionAction",
                "sessionId": sidebar_session_id,
                "action": "snooze",
                "preset": preset,
            });
            if let Some(tag) = tag {
                payload["sessionTag"] = tag;
            }
            payloads.push(payload);
        }
    }
    payloads.push(json!({
        "type": "sessionAction",
        "sessionId": sidebar_session_id,
        "action": "snooze",
        "sessionTag": "favorite",
    }));
    payloads.push(json!({
        "type": "sessionAction",
        "sessionId": sidebar_session_id,
        "action": "snooze",
    }));
    // `if (command.preset)` is a truthiness test, so the empty string posts nothing.
    payloads.push(json!({
        "type": "sessionAction",
        "sessionId": sidebar_session_id,
        "action": "snooze",
        "preset": "",
    }));
    payloads
}

/// The two calls: what they send, and what an accepted and a refused answer do.
fn snooze_call_entries(scenario: &Value) -> Vec<Value> {
    let rows: Vec<Value> = scenario
        .pointer("/snapshot/sessions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut sidebar_session_ids: Vec<String> = rows
        .iter()
        .take(SNOOZE_CALL_ROWS_PER_SCENARIO)
        .filter_map(|row| {
            Some(
                SessionKey::local(
                    row.get("projectId")?.as_str()?,
                    row.get("sessionId")?.as_str()?,
                )
                .to_sidebar_session_id(),
            )
        })
        .collect();
    sidebar_session_ids
        .push(SessionKey::local(QUICK_AUTOMATIONS_PROJECT_ID, "quick-1").to_sidebar_session_id());
    sidebar_session_ids.push("combined-session:unknown-project:unknown-session".to_string());
    sidebar_session_ids.push("gpui-browser:P0erj:tab-1".to_string());
    sidebar_session_ids.push("remote:machine-1:session:P0erj:S1".to_string());
    sidebar_session_ids.push(String::new());
    let mut entries = Vec::new();
    for sidebar_session_id in &sidebar_session_ids {
        let payloads = vec![
            json!({
                "type": "snoozeSession",
                "sessionId": sidebar_session_id,
                "snoozedUntil": "2026-09-21T09:00:00.000Z",
            }),
            // No `snoozedUntil` at all: the TypeScript spreads an `undefined` and `JSON.stringify`
            // drops the key, so the call must carry no key either.
            json!({ "type": "snoozeSession", "sessionId": sidebar_session_id }),
            json!({ "type": "unsnoozeSession", "sessionId": sidebar_session_id }),
        ];
        for payload in payloads {
            let Some(request) = plan_snooze_request(&payload) else {
                entries.push(json!({ "payload": payload, "owned": false }));
                continue;
            };
            let mut answers = Map::new();
            for accepted in [true, false] {
                answers.insert(
                    match accepted {
                        true => "accepted".to_string(),
                        false => "failed".to_string(),
                    },
                    Value::Array(
                        apply_snooze_answer(&request, accepted)
                            .iter()
                            .map(SnoozeFollowUp::to_json)
                            .collect(),
                    ),
                );
            }
            entries.push(json!({
                "payload": payload,
                "owned": true,
                "request": request.to_json(),
                "answers": Value::Object(answers),
            }));
        }
    }
    entries
}

const SNOOZE_CALL_ROWS_PER_SCENARIO: usize = 6;

/// The seed-title rule, driven directly.
///
/// A recording is not guaranteed to contain a padded or blank title, and this one does not: the
/// gate's own untrimmed-title mutation produced ZERO differences when the rule was only ever
/// reached through drawn rows, which is a gate that cannot fail. The triples below reach every
/// branch of the `||` chain whatever the recording holds.
fn title_rule_entries() -> Vec<Value> {
    let cases: [(Option<&str>, Option<&str>, &str); 12] = [
        (Some("Primary"), Some("Terminal"), "alias"),
        // Padded: the trim decides the VALUE, not only the test.
        (Some("  Primary  "), Some("Terminal"), "alias"),
        (Some("\tPrimary\n"), None, "alias"),
        // Blank primary falls through to the terminal title.
        (Some("   "), Some("Terminal"), "alias"),
        (Some(""), Some("  Terminal  "), "alias"),
        (None, Some("Terminal"), "alias"),
        // Both blank falls through to the alias, which is NOT trimmed.
        (Some("   "), Some("   "), "  alias  "),
        (None, None, "  alias  "),
        (Some(""), Some(""), ""),
        (None, None, ""),
        // The JavaScript trim also removes these two, which Rust's `str::trim` does not.
        (Some("\u{0085}Primary\u{0085}"), None, "alias"),
        (Some("\u{feff}   \u{feff}"), Some("Terminal"), "alias"),
    ];
    cases
        .into_iter()
        .map(|(primary, terminal, alias)| {
            json!({
                "primaryTitle": primary,
                "terminalTitle": terminal,
                "alias": alias,
                "title": rename_seed_title(primary, terminal, alias),
            })
        })
        .collect()
}

/// The open half of the gate.
///
/// What these nine payloads do is post ONE app-modal-host message, so that message is what is
/// compared, field by field, against the one the shipped TypeScript posts for the same command.
/// A wrong field here opens the right dialog on the wrong project or the Space editor in create
/// mode over an existing Space, and neither moves a single row of the drawn list.
///
/// **Two branches are BUILT, because no scenario reaches them.** Every recording is a
/// single-machine one with this computer selected, so the remote forms of Add Project, Configure
/// This Machine and the Space editor, and a project header on another machine, would have been
/// unreachable on both sides at once. The view is cloned and its `selected_machine_id` and its
/// groups are overridden for those probes, which is sound because this planner reads exactly those
/// fields; each probe records what it was planned against so the TypeScript half starts from the
/// same machine id, the same Spaces and the same group facts rather than from a label.
fn open_entries(view: &SidebarView) -> Vec<Value> {
    let mut entries = Vec::new();
    let remote_machine = "machine-1";
    // This computer's tab, as every scenario has it, and the same tab with a remote machine
    // selected. The Spaces travel with each one.
    // The Space the editor must open in EDIT mode is BUILT, because no recording carries one: with
    // an empty Space list every probe fell into create mode and the mutation that turns edit into
    // create could not fail, which is the shape this port has thrown a mutation away for before.
    let mut local_view = view.clone();
    local_view.spaces.push(ghostex_gx_core::SpaceView {
        id: "space-probe".to_string(),
        name: "Probe Space".to_string(),
        icon: "stack".to_string(),
        color: "#4f5663".to_string(),
        selected: false,
        contains_active_session: false,
        working_count: 0,
        attention_count: 0,
    });
    let mut remote_view = local_view.clone();
    remote_view.selected_machine_id = remote_machine.to_string();
    let views = [("local", local_view), ("remote", remote_view)];
    for (tab, probe) in &views {
        for action in SIDEBAR_ACTIONS {
            entries.push(open_entry(
                probe,
                tab,
                json!({ "type": "sidebarAction", "action": action }),
            ));
        }
        for machine_action in ["configure", "disable"] {
            entries.push(open_entry(
                probe,
                tab,
                json!({
                    "type": "machineAction",
                    "action": machine_action,
                    "machineId": probe.selected_machine_id,
                }),
            ));
        }
        // A Space the machine has, one it does not, and the row that carries no id at all, which
        // is New Space and must open in create mode.
        let known = probe.spaces.first().map(|space| space.id.clone());
        for space_id in [known, Some("not-a-space".to_string()), None] {
            let mut command = json!({ "type": "editSpace" });
            if let Some(space_id) = space_id {
                command["spaceId"] = Value::String(space_id);
            }
            entries.push(open_entry(probe, tab, command));
        }
    }
    // The project header's two rows, on the groups the list really draws, plus a group id it does
    // not hold and a REMOTE project group, which no scenario has: both ids that the worktree
    // dialog must carry come out differently there (the workspace project id, and the machine).
    let mut project_view = view.clone();
    if let Some(first) = project_view.groups.first().cloned() {
        project_view
            .groups
            .push(remote_group_probe(&first, remote_machine));
    }
    let mut group_ids: Vec<String> = project_view
        .groups
        .iter()
        .filter(|group| group.core.project_context.is_some())
        .map(|group| group.core.group_id.clone())
        .take(OPEN_PROJECTS_PER_SCENARIO)
        .collect();
    if let Some(remote) = project_view
        .groups
        .last()
        .map(|group| group.core.group_id.clone())
    {
        group_ids.push(remote);
    }
    group_ids.push("combined-project:not-a-project".to_string());
    for group_id in group_ids {
        for action in ["worktree", "history", "agent"] {
            entries.push(open_entry(
                &project_view,
                "local",
                json!({ "type": "projectAction", "action": action, "groupId": group_id }),
            ));
        }
    }
    entries
}

/// Every action the `sidebarAction` union has, so a row that stops being answered here is a
/// difference rather than a probe nobody wrote.
const SIDEBAR_ACTIONS: [&str; 17] = [
    "newTag",
    "loadSessions",
    "accounts",
    "addProject",
    "editMachine",
    "sessions",
    "commands",
    "importSessions",
    "agentsHub",
    "remoteSetup",
    "hotkeys",
    "settings",
    "powerSettings",
    "sortManual",
    "sortLastActivity",
    "showHidden",
    "toggleProjects",
];

/// Enough project headers to cover the shapes; the payload reads only the group's own facts.
const OPEN_PROJECTS_PER_SCENARIO: usize = 3;

/// One probe, with the facts the TypeScript half is handed for the same entry.
fn open_entry(view: &SidebarView, tab: &str, command: Value) -> Value {
    let group = command
        .get("groupId")
        .and_then(Value::as_str)
        .and_then(|group_id| view.group(group_id));
    let mut entry = json!({
        "command": command.clone(),
        "tab": tab,
        "selectedMachineId": view.selected_machine_id,
        "spaces": Value::Array(
            view.spaces
                .iter()
                .map(|space| json!({
                    "spaceId": space.id,
                    "name": space.name,
                    "icon": space.icon,
                    "color": space.color,
                }))
                .collect(),
        ),
        // The drawn group's own facts, handed over rather than re-derived: which groups the list
        // draws is M4a's gate, and re-deriving them here would let a port that read the wrong
        // list pass both.
        "group": match group {
            Some(group) => json!({
                "groupId": group.core.group_id,
                "title": group.core.title,
                "projectPath": group.core.project_context.as_ref().map(|project| project.path.clone()),
                "hasProjectContext": group.core.project_context.is_some(),
                "remoteMachine": group.core.remote_machine.as_ref().map(|machine| json!({
                    "machineId": machine.machine_id,
                    "machineName": machine.machine_name,
                    "projectId": machine.project_id,
                })),
            }),
            None => Value::Null,
        },
    });
    let object = entry.as_object_mut().expect("object");
    match plan_open_action(view, &command) {
        Some(plan) => {
            object.insert("owned".to_string(), Value::Bool(true));
            object.insert("calls".to_string(), plan.to_json());
        }
        None => {
            object.insert("owned".to_string(), Value::Bool(false));
        }
    }
    entry
}

/// A copy of a drawn project group, moved onto another machine. The group id is what carries the
/// workspace project id, so it is rebuilt the way the store builds one for a remote project.
fn remote_group_probe(
    group: &ghostex_gx_core::GroupView,
    machine_id: &str,
) -> ghostex_gx_core::GroupView {
    let raw_project_id = group
        .core
        .project_context
        .as_ref()
        .map(|project| project.project_id.clone())
        .unwrap_or_default();
    let project = ProjectKey::remote(machine_id, &raw_project_id);
    let mut core = (*group.core).clone();
    core.group_id = project.to_sidebar_group_id();
    core.remote_machine = Some(ghostex_gx_core::RemoteMachineView {
        machine_id: machine_id.to_string(),
        machine_name: "Windows Remote".to_string(),
        project_id: Some(raw_project_id),
    });
    ghostex_gx_core::GroupView {
        core: std::sync::Arc::new(core),
        ..group.clone()
    }
}
