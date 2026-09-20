//! The interleaving gate for the workspace-groups pending-push guard.
//!
//! The failure this exists to catch is OSCILLATION, and oscillation is not visible in a final
//! state: a local move lands, a stale echo undoes it, the push lands, the daemon's next echo redoes
//! it, and the user watches a row jump back and then forward while the sequence ends exactly where
//! it should. So this probe records what is held after EVERY event, not after the last one, and the
//! TypeScript half is driven through the same script so the two are compared step by step.
//!
//! The scripts are enumerated rather than chosen. Every well-formed sequence of four events over
//! the alphabet below is written out, which puts an echo before the push, between the push starting
//! and its answer, and after it, without anyone having to think of those three cases by name. A
//! sequence is well-formed when a push answer follows a push that started, and when a push starts
//! only while one is booked, because firing a timer nobody booked is not something the app can do.
//!
//!   bun tooling/gx-core/action-parity.ts workspace-groups <out-dir>   # the TypeScript half
//!   cargo run --release --example workspace_groups_guard -- <out-dir>

use std::collections::BTreeMap;

use ghostex_gx_core::{
    AdoptOutcome, ProjectWorkspaceGroups, WorkspaceGroupsDocument, WorkspaceGroupsEffect,
    WorkspaceGroupsSync, WorkspaceSubgroup,
};
use serde_json::{json, Value};

/// The events a script is made of.
const EVENTS: [&str; 9] = [
    "editA",
    "editB",
    "echoNone",
    "echoEmpty",
    "echoA",
    "echoB",
    "pushStart",
    "pushOk",
    // The failure leg matters as much as the success one: a push that cannot reach the server
    // keeps the flag UP and retries for ever, which is what stops a stale echo overwriting a
    // document just because the network is down.
    "pushFail",
];

fn main() {
    let out_dir = std::env::args().nth(1).unwrap_or_default();
    if out_dir.is_empty() {
        eprintln!("usage: workspace_groups_guard <out-dir>");
        std::process::exit(2);
    }
    let documents = documents();
    let scripts = scripts();
    let mut cases = Vec::new();
    for (start_name, start) in [("empty", 0usize), ("a", 1), ("b", 2)] {
        for script in &scripts {
            cases.push(run(
                start_name,
                documents[start].clone(),
                script,
                &documents,
            ));
        }
    }
    let steps: usize = cases
        .iter()
        .map(|case| case["steps"].as_array().map(Vec::len).unwrap_or(0))
        .sum();
    let path = std::path::Path::new(&out_dir).join("rust-groups.json");
    std::fs::write(
        &path,
        serde_json::to_string(&json!({
            "documents": documents.iter().map(WorkspaceGroupsDocument::to_json).collect::<Vec<_>>(),
            "cases": cases,
        }))
        .expect("serialize"),
    )
    .expect("write");
    println!(
        "workspace groups guard: {} cases, {steps} steps, written to {}",
        cases.len(),
        path.display()
    );
}

/// Three documents: empty, and two that differ in the one place a move changes, which is the order
/// of the session ids inside a group.
fn documents() -> Vec<WorkspaceGroupsDocument> {
    let group = |ids: &[&str]| WorkspaceSubgroup {
        group_id: "group-2".to_string(),
        session_ids: ids.iter().map(|id| id.to_string()).collect(),
        title: "Group 2".to_string(),
    };
    let doc = |ids: &[&str]| {
        let mut projects = BTreeMap::new();
        projects.insert(
            "P1".to_string(),
            ProjectWorkspaceGroups {
                groups: vec![group(ids)],
                next_group_number: 3,
            },
        );
        WorkspaceGroupsDocument {
            project_order: vec!["P1".to_string()],
            projects,
        }
    };
    vec![
        WorkspaceGroupsDocument::default(),
        doc(&["S1", "S2", "S3"]),
        doc(&["S2", "S1", "S3"]),
    ]
}

/// Every well-formed sequence of four events.
fn scripts() -> Vec<Vec<&'static str>> {
    let mut scripts = Vec::new();
    for a in EVENTS {
        for b in EVENTS {
            for c in EVENTS {
                for d in EVENTS {
                    let script = vec![a, b, c, d];
                    if well_formed(&script) {
                        scripts.push(script);
                    }
                }
            }
        }
    }
    scripts
}

/// A push answer needs a push in flight, and a push starts only while one is booked. Both are
/// properties of the SCRIPT and not of either implementation, so they are decided here once and
/// both sides are driven through the same list.
fn well_formed(script: &[&str]) -> bool {
    let mut in_flight = false;
    let mut booked = false;
    for event in script {
        match *event {
            "editA" | "editB" => booked = true,
            "pushStart" => {
                if !booked || in_flight {
                    return false;
                }
                booked = false;
                in_flight = true;
            }
            "pushOk" | "pushFail" => {
                if !in_flight {
                    return false;
                }
                in_flight = false;
            }
            // An echo that schedules a push books one, which a later pushStart may then fire.
            "echoEmpty" => booked = true,
            _ => {}
        }
    }
    true
}

/// One script, run against the guard, recording what is held after every event.
fn run(
    start_name: &str,
    start: WorkspaceGroupsDocument,
    script: &[&str],
    documents: &[WorkspaceGroupsDocument],
) -> Value {
    let mut sync = WorkspaceGroupsSync::default();
    sync.restore(start);
    let mut in_flight: Option<u64> = None;
    let mut steps = Vec::new();
    for event in script {
        let (outcome, effects) = match *event {
            "editA" => (None, sync.edit(documents[1].clone())),
            "editB" => (None, sync.edit(documents[2].clone())),
            "echoNone" => {
                let (outcome, effects) = sync.adopt(None);
                (Some(outcome), effects)
            }
            "echoEmpty" => {
                let (outcome, effects) = sync.adopt(Some(&json!({})));
                (Some(outcome), effects)
            }
            "echoA" => {
                let value = documents[1].to_json();
                let (outcome, effects) = sync.adopt(Some(&value));
                (Some(outcome), effects)
            }
            "echoB" => {
                let value = documents[2].to_json();
                let (outcome, effects) = sync.adopt(Some(&value));
                (Some(outcome), effects)
            }
            "pushStart" => {
                let (_document, revision) = sync.push_started();
                in_flight = Some(revision);
                (None, Vec::new())
            }
            "pushOk" | "pushFail" => {
                let revision = in_flight.take().unwrap_or_default();
                (None, sync.push_finished(revision, *event == "pushOk"))
            }
            _ => (None, Vec::new()),
        };
        steps.push(json!({
            "event": event,
            // What the user is looking at after this event, which is the whole point: a sequence
            // that ends right having gone wrong in the middle is the bug.
            "document": sync.document().to_json(),
            "pending": sync.is_pending(),
            "outcome": outcome.map(outcome_name),
            "writes": effects
                .iter()
                .filter(|effect| matches!(effect, WorkspaceGroupsEffect::WriteStorage { .. }))
                .count(),
            "schedules": effects
                .iter()
                .filter_map(|effect| match effect {
                    WorkspaceGroupsEffect::SchedulePush { delay_ms } => Some(*delay_ms),
                    _ => None,
                })
                .collect::<Vec<_>>(),
        }));
    }
    json!({ "start": start_name, "script": script, "steps": steps })
}

fn outcome_name(outcome: AdoptOutcome) -> &'static str {
    match outcome {
        AdoptOutcome::IgnoredPending => "ignoredPending",
        AdoptOutcome::IgnoredEqual => "ignoredEqual",
        AdoptOutcome::ScheduledPush => "scheduledPush",
        AdoptOutcome::Adopted => "adopted",
    }
}
