//! The gate for a remote row's session actions: the calls they send down the machine's tunnel,
//! in order, and what happens when one of them fails.
//!
//! **No recording can supply these cases.** Every remote machine was disabled until the user
//! enabled one on 2026-09-21, so no recorded frame holds a remote action, and the interesting
//! cases are the failures, which a live machine gives on demand only by breaking it. So the
//! payloads are BUILT: every message type the remote leg answers, every value of every field that
//! changes the call (a tag that is a word, `favorite`, a clear and absent; a park with the
//! park-sleeps setting on and off; a snooze with and without a wake time), and every id shape the
//! remote pattern must accept or refuse (a colon inside the session id, an encoded character, a
//! local id, a remote GROUP id, an empty machine, an empty project, a browser row).
//!
//! **A remote action is a SEQUENCE, so a final state cannot judge it.** For every plan this writes
//! one trace per answer script: every waited call succeeding, and then each waited call failing in
//! turn. A trace is the calls in the order they go out (the path, the RAW ids that machine
//! accepts, whether the caller waits, the timeout) and the toast a failure shows, produced by the
//! same `step_after` rule the host runs. The TypeScript half drives the shipped
//! `handleSidebarMessage` with the same script as the bridge's answers.
//!
//! Two local rules ride along because this change made them measurable: whether a Full Reload
//! goes on to its wake after each of the three sleep answers, and whether a paced bulk sleep waits
//! for each request before the next.
//!
//!   cargo run --release --example sidebar_remote_action_parity -- <out-dir>
//!   bun tooling/gx-core/remote-action-parity.ts compare <out-dir>

use std::process::ExitCode;

use ghostex_gx_core::{
    plan_bulk_request, plan_remote_session_action, reload_continues_after, Core, LifecycleAnswer,
    RemoteCallMode, RemoteSessionPlan, RemoteStep, SidebarInputs,
};
use serde_json::{json, Value};

/// The sentence the bridge answers every failed request with (`GPUI_REMOTE_GXSERVER_REQUEST_FAILED`
/// in the desktop crate). A toast whose description is `None` shows exactly this.
const REQUEST_FAILED: &str = "Remote gxserver request failed.";

fn main() -> ExitCode {
    let out_dir = std::env::args().nth(1).unwrap_or_default();
    if out_dir.is_empty() {
        eprintln!("usage: sidebar_remote_action_parity <out-dir>");
        return ExitCode::from(2);
    }
    let mut entries = Vec::new();
    let mut owned = 0usize;
    let mut traces = 0usize;
    for session_id in session_ids() {
        for (payload, sleep_when_parking) in payloads(&session_id) {
            let plan = plan_remote_session_action(&payload, sleep_when_parking);
            let entry_traces: Vec<Value> = match &plan {
                Some(plan) => scripts(plan)
                    .into_iter()
                    .map(|script| {
                        traces += 1;
                        json!({ "script": script, "events": simulate(plan, &script) })
                    })
                    .collect(),
                None => Vec::new(),
            };
            if plan.is_some() {
                owned += 1;
            }
            entries.push(json!({
                "payload": payload,
                "sleepWhenParking": sleep_when_parking,
                "owned": plan.is_some(),
                "plan": plan.as_ref().map(RemoteSessionPlan::to_json),
                "traces": entry_traces,
            }));
        }
    }
    let reload_stop: Vec<Value> = [
        LifecycleAnswer::Accepted,
        LifecycleAnswer::Declined,
        LifecycleAnswer::Failed,
    ]
    .into_iter()
    .map(|answer| json!({ "answer": answer.as_str(), "continues": reload_continues_after(answer) }))
    .collect();
    let core = Core::new();
    let inputs = SidebarInputs::default();
    let bulk_waits: Vec<Value> = [
        json!({ "type": "setSessionsSleeping", "sessionIds": ["a", "b", "c"], "sleeping": true }),
        json!({ "type": "setSessionsSleeping", "sessionIds": ["a", "b", "c"], "sleeping": false }),
        json!({ "type": "closeSessions", "sessionIds": ["a", "b", "c"] }),
    ]
    .into_iter()
    .map(|payload| {
        let request = plan_bulk_request(&core, &inputs, &payload);
        json!({
            "payload": payload,
            "waitsForEach": request.as_ref().map(|request| request.waits_for_each()),
            "intervalMs": request.as_ref().map(|request| request.interval_ms),
        })
    })
    .collect();
    let dump = json!({
        "entries": entries,
        "reloadStop": reload_stop,
        "bulkWaits": bulk_waits,
    });
    let path = std::path::Path::new(&out_dir).join("rust-remote-actions.json");
    if let Err(error) = std::fs::write(&path, serde_json::to_string(&dump).expect("serialize")) {
        eprintln!("write {}: {error}", path.display());
        return ExitCode::FAILURE;
    }
    println!(
        "{}: {} payloads, {owned} answered as remote, {traces} traces",
        path.display(),
        dump["entries"].as_array().map_or(0, Vec::len),
    );
    // A gate whose Rust half answers nothing compares nothing. Both halves of the zero-check live
    // on the TypeScript side too, but a run that planned no remote action is wrong before it gets
    // there.
    if owned == 0 || traces == 0 {
        eprintln!("no remote action was planned: the gate would compare nothing");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}

/// Every id shape the remote pattern `^remote:([^:]+):session:([^:]+):(.+)$` must accept or refuse.
fn session_ids() -> Vec<String> {
    vec![
        // The user's own machine id shape, and a second machine, so a leg sent to the wrong one is a
        // difference rather than a coincidence.
        "remote:remote-msgckntd-ecz4w:session:P0erj:G1".to_string(),
        "remote:remote-ab12:session:proj-2:G-2".to_string(),
        // A colon INSIDE the session id belongs to the session: the last group is `(.+)`.
        "remote:remote-ab12:session:proj-2:with:colon".to_string(),
        // An encoded character stays encoded: remote ids are not URI-decoded.
        "remote:remote-ab12:session:pr%C3%B8ject:S%201".to_string(),
        // Shapes the pattern refuses, so the remote leg must not answer them.
        "remote:remote-ab12:session:proj-2".to_string(),
        "remote::session:proj-2:G1".to_string(),
        "remote:remote-ab12:session::G1".to_string(),
        "remote:remote-ab12:group:proj-2".to_string(),
        "remote:remote-ab12:project:proj-2".to_string(),
        "combined-session:P0erj:G1".to_string(),
        "gpui-browser:P0erj:7".to_string(),
        String::new(),
    ]
}

/// Every payload the remote leg answers, with every field value that changes the call.
fn payloads(session_id: &str) -> Vec<(Value, bool)> {
    let mut out: Vec<(Value, bool)> = Vec::new();
    let plain = |out: &mut Vec<(Value, bool)>, payload: Value| out.push((payload, false));
    for sleeping in [json!(true), json!(false), json!("true")] {
        plain(
            &mut out,
            json!({ "type": "setSessionSleeping", "sessionId": session_id, "sleeping": sleeping }),
        );
    }
    plain(
        &mut out,
        json!({ "type": "setSessionSleeping", "sessionId": session_id }),
    );
    plain(
        &mut out,
        json!({ "type": "closeSession", "sessionId": session_id }),
    );
    plain(
        &mut out,
        json!({ "type": "forkSession", "sessionId": session_id }),
    );
    for pinned in [Some(true), Some(false), None] {
        let mut payload = json!({ "type": "setSessionPinned", "sessionId": session_id });
        if let Some(pinned) = pinned {
            payload["pinned"] = json!(pinned);
        }
        plain(&mut out, payload);
    }
    for setting in [false, true] {
        for parked in [true, false] {
            out.push((
                json!({ "type": "setSessionParked", "sessionId": session_id, "parked": parked }),
                setting,
            ));
        }
    }
    // A tag that is a word, the one that is also the star, an explicit clear and an absent field,
    // which `setSessionTag`'s arm turns into the same clear.
    for tag in [json!("work"), json!("favorite"), Value::Null] {
        plain(
            &mut out,
            json!({ "type": "setSessionTag", "sessionId": session_id, "sessionTag": tag }),
        );
    }
    plain(
        &mut out,
        json!({ "type": "setSessionTag", "sessionId": session_id }),
    );
    for favorite in [true, false] {
        plain(
            &mut out,
            json!({ "type": "setSessionFavorite", "sessionId": session_id, "favorite": favorite }),
        );
    }
    for snoozed_until in [Some("2026-09-22T13:00:00.000Z"), None] {
        let mut payload = json!({ "type": "snoozeSession", "sessionId": session_id });
        if let Some(snoozed_until) = snoozed_until {
            payload["snoozedUntil"] = json!(snoozed_until);
        }
        plain(&mut out, payload);
    }
    plain(
        &mut out,
        json!({ "type": "unsnoozeSession", "sessionId": session_id }),
    );
    for kind in ["fullReloadSession", "restartSession"] {
        plain(&mut out, json!({ "type": kind, "sessionId": session_id }));
    }
    // Split Right is refused on purpose (its remote leg moves the old runtime's remote focus), so
    // it is enumerated to prove the remote leg does NOT answer it.
    plain(
        &mut out,
        json!({ "type": "splitSessionRight", "sessionId": session_id }),
    );
    out
}

/// Every waited call succeeding, and then each one failing in turn.
fn scripts(plan: &RemoteSessionPlan) -> Vec<Vec<bool>> {
    let awaited = plan
        .legs
        .iter()
        .filter(|leg| leg.mode == RemoteCallMode::Awaited)
        .count();
    let mut scripts = vec![vec![true; awaited]];
    for failing in 0..awaited {
        let mut script = vec![true; failing];
        script.push(false);
        scripts.push(script);
    }
    scripts
}

/// The plan run against one answer script with the host's own rule, as the calls and the toast it
/// produces. A fire-and-forget call reads no answer: nobody waits for it.
fn simulate(plan: &RemoteSessionPlan, script: &[bool]) -> Vec<Value> {
    let mut events = Vec::new();
    let mut answers = script.iter().copied();
    let mut index = 0;
    while let Some(leg) = plan.legs.get(index) {
        events.push(json!({
            "event": "request",
            "machine": plan.machine_id(),
            "path": leg.path,
            "params": leg.params,
            "awaited": leg.mode == RemoteCallMode::Awaited,
            "timeoutMs": leg.timeout_ms,
        }));
        let ok = match leg.mode {
            RemoteCallMode::Awaited => answers.next().unwrap_or(true),
            RemoteCallMode::FireAndForget => true,
        };
        match plan.step_after(index, ok) {
            RemoteStep::Next(next) => index = next,
            RemoteStep::Done => break,
            RemoteStep::Stopped { toast } => {
                if let Some(toast) = toast {
                    events.push(json!({
                        "event": "toast",
                        "level": toast.level.as_str(),
                        "title": toast.title,
                        "description": toast.description.unwrap_or(REQUEST_FAILED),
                    }));
                }
                break;
            }
        }
    }
    events
}
