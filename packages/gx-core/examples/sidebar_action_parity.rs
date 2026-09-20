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
    encode_uri_component, plan_read_only_action, Core, Event, MachineId, SidebarInputs,
    READ_ONLY_MESSAGE_TYPES,
};
use serde_json::{json, Value};

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
            "{}: {} payloads, {} calls ({} from menus)",
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(""),
            dump.payloads,
            dump.calls,
            dump.from_menus
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
        "scenarios {} payloads {total_payloads} calls {total_calls} fromMenus {from_menus} resolveUs median {median} max {}",
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
    Some(Dump {
        payloads: entries.len(),
        calls,
        from_menus,
        value: json!({
            "parkedProjectId": parked,
            "entries": Value::Array(entries),
        }),
    })
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
