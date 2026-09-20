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
    apply_close_answer, apply_fork_answer, apply_lifecycle_answer, close_optimistic_follow_ups,
    encode_uri_component, plan_close_request, plan_fork_request, plan_lifecycle_request,
    plan_read_only_action, ActiveGroup, CloseAnswer, CloseFollowUp, Core, Event, ForkFollowUp,
    Intent, LifecycleAnswer, LifecycleFollowUp, MachineId, ProjectKey, SessionKey, SidebarInputs,
    QUICK_AUTOMATIONS_PROJECT_ID, READ_ONLY_MESSAGE_TYPES,
};
use serde_json::{json, Map, Value};

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
    let mut resolve_micros: Vec<u128> = Vec::new();
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
        let Some(dump) = build(&scenario, menu_dump.as_ref(), &mut resolve_micros) else {
            eprintln!("cannot build {}", path.display());
            return ExitCode::FAILURE;
        };
        total_payloads += dump.payloads;
        total_calls += dump.calls;
        from_menus += dump.from_menus;
        total_lifecycle += dump.lifecycle;
        total_close += dump.close;
        total_fork += dump.fork;
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
        "scenarios {} payloads {total_payloads} calls {total_calls} fromMenus {from_menus} lifecycle {total_lifecycle} close {total_close} fork {total_fork} resolveUs median {median} max {}",
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
    core.handle(
        Event::Frame {
            machine: MachineId::Local,
            frame: Box::new(frame),
        },
        now_ms,
    );

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
    Some(Dump {
        payloads: entries.len(),
        calls,
        from_menus,
        lifecycle: lifecycle_count,
        close: close_count,
        fork: fork_count,
        value: json!({
            "parkedProjectId": parked,
            "entries": Value::Array(entries),
            "lifecycle": Value::Array(lifecycle),
            "close": Value::Array(closes),
            "fork": Value::Array(forks),
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
        for active in ["elsewhere", "already"] {
            let mut base = core.clone();
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
                        apply_fork_answer(&request, result.as_ref().map_err(String::as_str))
                            .iter()
                            .map(ForkFollowUp::to_json)
                            .collect(),
                    ),
                );
            }
            entries.push(json!({
                "sessionId": session.to_sidebar_session_id(),
                "active": active,
                "activeBefore": active_before,
                "owned": true,
                "request": request.to_json(),
                "answers": Value::Object(answers),
            }));
        }
    }
    entries
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
