//! The interleaving, launch and bridge gate for the two PROJECT documents: collections (K5) and
//! Spaces (K6).
//!
//! **Why this exists beside `workspace_groups_guard`.** The guard was generalised into
//! `doc_sync::DocumentSync<D>` for these two documents, and the only instance any gate drove was
//! the workspace session groups one: `AlwaysPushBack` with a stored key. That left the two NEW
//! `EmptyEchoRule` variants (`PushBackFirstEcho`, `Adopt`), the `stores: false` path, the
//! collections document's monotonic `nextCollectionNumber` and `has_document` exercised by nothing
//! at all, and the generalisation's own proof was that it reproduced the pre-generalisation numbers
//! exactly, which is a proof about the one policy it ran. So the same enumeration runs here over
//! the other two policies.
//!
//! **The launch half is the one that matters most, and it is written around a real bug.** On
//! 2026-09-21 the collections document's first echo of EVERY run was deferred (nothing booked the
//! stored read before the daemon's first snapshot), and when the read landed the host re-read the
//! daemon's copy out of the store's side state, which the restore had just OVERWRITTEN with the
//! app's own stored document. So the guard judged this app's document as if it were the daemon's:
//! the daemon's collections were never adopted for the life of the run, and the self-echo spent the
//! `PushBackFirstEcho` token, so the next genuinely empty echo was ADOPTED and every collection
//! would have been deleted. Both shapes are cases below, and `--inject settle-reads-the-side-state`
//! reproduces the defect, which is what makes them worth having.
//!
//!   cargo run --release --example project_docs_guard -- <out-dir>
//!   bun tooling/gx-core/project-docs-guard.ts <out-dir> [--inject <mutation>]

use ghostex_gx_core::{
    collections_hand_back_script, collections_request_script, document_reconcile_wanted,
    spaces_hand_back_script, AdoptOutcome, CollectionsDocument, DocumentSync, SpacesDocument,
    SyncEffect, SyncedDocument, COLLECTIONS_HAND_OFF_MESSAGE_TYPE, COLLECTIONS_SCRIPT_PLACEHOLDER,
    SPACES_HAND_OFF_MESSAGE_TYPE, SPACES_SCRIPT_PLACEHOLDER,
};
use serde_json::{json, Value};

/// The events a script is made of, the same alphabet the workspace-groups enumeration uses so the
/// three policies are asked the same questions.
const EVENTS: [&str; 9] = [
    "editA",
    "editB",
    "echoNone",
    "echoEmpty",
    "echoA",
    "echoB",
    "pushStart",
    "pushOk",
    "pushFail",
];

fn main() {
    let out_dir = std::env::args().nth(1).unwrap_or_default();
    if out_dir.is_empty() {
        eprintln!("usage: project_docs_guard <out-dir>");
        std::process::exit(2);
    }
    let scripts = scripts();
    let collections = collection_documents();
    let spaces = space_documents();
    let collection_cases = enumerate(&collections, &scripts, collections_wire);
    let space_cases = enumerate(&spaces, &scripts, spaces_wire);
    let collection_launch = launch_cases(&collections, collections_wire);
    let space_launch = launch_cases(&spaces, spaces_wire);

    let steps: usize = collection_cases
        .iter()
        .chain(space_cases.iter())
        .map(|case| case["steps"].as_array().map(Vec::len).unwrap_or(0))
        .sum();
    // Every coverage counter here answers "did this run reach the thing it exists for". A clean run
    // whose counters are zero has measured nothing, which is the criterion piece 3a established.
    let counts = coverage(
        &collection_cases,
        &space_cases,
        &collection_launch,
        &space_launch,
    );
    // The one number that MUST be zero, and an assertion rather than a coverage counter: the Spaces
    // document has no stored key at all, so `stores: false` means the guard never asks a host to
    // write one. A single write here is the whole `SyncPolicy::stores` decision having gone.
    assert_eq!(
        storage_writes(&space_cases),
        0,
        "the Spaces document has no stored key, so the guard must never produce a storage write"
    );
    let dump = json!({
        "collections": {
            "documents": collections.iter().map(CollectionsDocument::to_wire_json).collect::<Vec<_>>(),
            "stored": collections.iter().map(CollectionsDocument::to_storage_json).collect::<Vec<_>>(),
            "cases": collection_cases,
            "launch": collection_launch,
            "bridge": collections_bridge(&collections[1]),
        },
        "spaces": {
            "documents": spaces.iter().map(SpacesDocument::to_wire_json).collect::<Vec<_>>(),
            "cases": space_cases,
            "launch": space_launch,
            "bridge": spaces_bridge(&spaces[1]),
        },
    });
    let path = std::path::Path::new(&out_dir).join("rust-project-docs.json");
    std::fs::write(&path, serde_json::to_string(&dump).expect("serialize")).expect("write");
    println!(
        "project docs guard: {} collections cases, {} spaces cases, {steps} steps, {} collections launch cases, {} spaces launch cases, coverage {counts}, written to {}",
        dump["collections"]["cases"].as_array().map(Vec::len).unwrap_or(0),
        dump["spaces"]["cases"].as_array().map(Vec::len).unwrap_or(0),
        dump["collections"]["launch"].as_array().map(Vec::len).unwrap_or(0),
        dump["spaces"]["launch"].as_array().map(Vec::len).unwrap_or(0),
        path.display(),
        counts = counts
            .iter()
            .map(|(name, value)| format!("{name} {value}"))
            .collect::<Vec<_>>()
            .join(" "),
    );
    let zeroes: Vec<&str> = counts
        .iter()
        .filter(|(_, value)| *value == 0)
        .map(|(name, _)| *name)
        .collect();
    if !zeroes.is_empty() {
        eprintln!(
            "coverage counters that stayed at zero, so this run measured nothing: {}",
            zeroes.join(", ")
        );
        std::process::exit(1);
    }
}

/// The outcomes and effects each half reached. Read as a zero-check rather than as numbers:
/// `collectionsPushedBack 0` would mean the empty-echo rule was never exercised at all.
fn coverage(
    collection_cases: &[Value],
    space_cases: &[Value],
    collection_launch: &[Value],
    space_launch: &[Value],
) -> Vec<(&'static str, usize)> {
    let count = |cases: &[Value], outcome: &str| -> usize {
        steps_of(cases)
            .filter(|step| step["outcome"] == json!(outcome))
            .count()
    };
    vec![
        // The two NEW empty-echo rules, which nothing drove before this example existed.
        (
            "collectionsPushedBack",
            count(collection_cases, "ScheduledPush"),
        ),
        (
            "spacesEmptyAdopted",
            steps_of(space_cases)
                .filter(|step| {
                    step["event"] == json!("echoEmpty") && step["outcome"] == json!("Adopted")
                })
                .count(),
        ),
        ("collectionsAdopted", count(collection_cases, "Adopted")),
        ("spacesAdopted", count(space_cases, "Adopted")),
        // The monotonic counter moving forward on an adopt, which is `CollectionsDocument::adopt`.
        (
            "collectionsCounterKept",
            steps_of(collection_cases)
                .filter(|step| step["counterKeptAhead"] == json!(true))
                .count(),
        ),
        // `stores: true` really writing, which is the other half of the assertion that `stores:
        // false` never does.
        ("collectionsStorageWrites", storage_writes(collection_cases)),
        // `has_document`, which `runNativeProjectDrop` branches on: a drop onto the built-in Other
        // view proceeds against an EMPTY document and returns against a MISSING one.
        (
            "documentsHeldFromNothing",
            steps_of(space_cases)
                .filter(|step| step["hasDocument"] == json!(true))
                .count(),
        ),
        (
            "launchJudged",
            collection_launch
                .iter()
                .chain(space_launch.iter())
                .filter(|case| case["asked"].as_u64().unwrap_or(0) > 0)
                .count(),
        ),
        // The launch shape A1 was: the carried echo is NOT what the restore left in the side state.
        (
            "launchSelfEchoAvoided",
            collection_launch
                .iter()
                .chain(space_launch.iter())
                .filter(|case| case["selfEchoAvoided"] == json!(true))
                .count(),
        ),
    ]
}

fn steps_of(cases: &[Value]) -> impl Iterator<Item = Value> + '_ {
    cases
        .iter()
        .flat_map(|case| case["steps"].as_array().cloned().unwrap_or_default())
}

fn storage_writes(cases: &[Value]) -> usize {
    steps_of(cases)
        .map(|step| step["writes"].as_u64().unwrap_or(0) as usize)
        .sum()
}

/// Every well-formed sequence of four events, the same rule the workspace-groups enumeration uses:
/// a push answer needs a push in flight, and a push starts only while one is booked.
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
            "echoEmpty" => booked = true,
            _ => {}
        }
    }
    true
}

/// One document type, every script, from each of the three starting documents.
fn enumerate<D: SyncedDocument>(
    documents: &[D],
    scripts: &[Vec<&'static str>],
    wire: fn(&D) -> Value,
) -> Vec<Value> {
    let mut cases = Vec::new();
    for (start_name, start) in [("empty", 0usize), ("a", 1), ("b", 2)] {
        for script in scripts {
            cases.push(run(
                start_name,
                documents[start].clone(),
                script,
                documents,
                wire,
            ));
        }
    }
    cases
}

/// One script, recording what is held after EVERY event, because oscillation is invisible in a
/// final state.
fn run<D: SyncedDocument>(
    start_name: &str,
    start: D,
    script: &[&str],
    documents: &[D],
    wire: fn(&D) -> Value,
) -> Value {
    let mut sync: DocumentSync<D> = DocumentSync::default();
    sync.restore(start);
    let mut in_flight: Option<u64> = None;
    let mut steps = Vec::new();
    for event in script {
        let counter_before = counter_of(&wire(sync.document()));
        let (outcome, effects) = match *event {
            "editA" => (None, sync.edit(documents[1].clone())),
            "editB" => (None, sync.edit(documents[2].clone())),
            "echoNone" => {
                let (outcome, effects) = sync.adopt(None);
                (Some(outcome), effects)
            }
            "echoEmpty" => {
                let value = wire(&documents[0]);
                let (outcome, effects) = sync.adopt(Some(&value));
                (Some(outcome), effects)
            }
            "echoA" => {
                let value = wire(&documents[1]);
                let (outcome, effects) = sync.adopt(Some(&value));
                (Some(outcome), effects)
            }
            "echoB" => {
                let value = wire(&documents[2]);
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
        let held = wire(sync.document());
        steps.push(json!({
            "event": event,
            "document": held,
            "pending": sync.is_pending(),
            "hasDocument": sync.has_document(),
            "outcome": outcome.map(outcome_name),
            "writes": effects
                .iter()
                .filter(|effect| matches!(effect, SyncEffect::WriteStorage { .. }))
                .count(),
            "schedules": effects
                .iter()
                .filter_map(|effect| match effect {
                    SyncEffect::SchedulePush { delay_ms } => Some(*delay_ms),
                    _ => None,
                })
                .collect::<Vec<_>>(),
            // The monotonic counter, which no other gate has ever read: an echo that carries a
            // lower `nextCollectionNumber` must not drag the held one back, or the next folder
            // reuses a name that is already on screen.
            "counterKeptAhead": counter_of(&held).is_some_and(|after| {
                counter_before.is_some_and(|before| after >= before)
            }) && counter_before != counter_of(&held),
        }));
    }
    json!({ "start": start_name, "script": script, "steps": steps })
}

/// `nextCollectionNumber`, for the documents that have one.
fn counter_of(value: &Value) -> Option<i64> {
    value.get("nextCollectionNumber").and_then(Value::as_i64)
}

/// THE SEQUENCE A LAUNCH PERFORMS, in both orders, with the deferral the host really makes.
///
/// The host reads the stored key on the background executor and puts that document into the store's
/// side state ITSELF. So when the daemon's snapshot lands there are two orders, and the second is
/// the one that bit: the snapshot arrives first, the host DEFERS the echo because the read has not
/// landed, the read then lands and seeds the side state with the app's own document, and the
/// deferral is judged. What must be judged is the DAEMON's copy, carried from the moment it
/// arrived; judging whatever the side state holds by then is this app's own document coming back as
/// an echo, which is `selfEchoAvoided` below and what the mutation reproduces.
fn launch_cases<D: SyncedDocument>(documents: &[D], wire: fn(&D) -> Value) -> Vec<Value> {
    let names = ["empty", "a", "b"];
    let mut cases = Vec::new();
    for (stored_index, stored_name) in names.iter().enumerate() {
        for (server_index, server_name) in names.iter().enumerate() {
            for stored_first in [true, false] {
                let stored = documents[stored_index].clone();
                let server = documents[server_index].clone();
                let server_value = wire(&server);
                let mut sync: DocumentSync<D> = DocumentSync::default();
                let mut side: Option<Value> = None;
                let mut asked = 0usize;
                let mut outcomes: Vec<&'static str> = Vec::new();
                let mut schedules = 0usize;
                let mut self_echo_avoided = false;
                if stored_first {
                    // The read lands first: it restores the guard AND seeds the side state, and the
                    // snapshot is then judged against what the host wrote there.
                    sync.restore(stored.clone());
                    side = Some(wire(&stored));
                    let changed = side.as_ref() != Some(&server_value);
                    if document_reconcile_wanted(changed, true) {
                        asked += 1;
                        let (outcome, effects) = sync.adopt(Some(&server_value));
                        outcomes.push(outcome_name(outcome));
                        schedules += effects.len();
                    }
                } else {
                    // The snapshot lands first. The host cannot judge it yet, so it CARRIES the
                    // echo; the read then lands and overwrites the side state with the stored
                    // document, and the carried echo is what is judged.
                    let changed = side.as_ref() != Some(&server_value);
                    let deferred =
                        document_reconcile_wanted(changed, true).then(|| server_value.clone());
                    sync.restore(stored.clone());
                    // The restore seeds the side state with the app's OWN document, which is what
                    // the settle used to re-read.
                    side = Some(wire(&stored));
                    self_echo_avoided = deferred.as_ref() != side.as_ref();
                    if let Some(echo) = deferred {
                        asked += 1;
                        let (outcome, effects) = sync.adopt(Some(&echo));
                        outcomes.push(outcome_name(outcome));
                        schedules += effects.len();
                    }
                }
                // THE SECOND ECHO, which is the half of the defect a single judgement cannot show:
                // a gxserver that has never stored this document echoes an EMPTY one, and if the
                // first echo was this app's own document the empty rule's token is already spent
                // and the empty echo is adopted, deleting every collection the user has.
                let empty = wire(&documents[0]);
                let (second, _) = sync.adopt(Some(&empty));
                outcomes.push(outcome_name(second));
                cases.push(json!({
                    "name": format!("{stored_name}/{server_name}/{}", match stored_first {
                        true => "storedFirst",
                        false => "snapshotFirst",
                    }),
                    // The indices the TypeScript half builds its own reference from, rather than
                    // parsing them back out of the name.
                    "storedIndex": stored_index,
                    "serverIndex": server_index,
                    "storedFirst": stored_first,
                    "asked": asked,
                    "outcomes": outcomes,
                    "document": wire(sync.document()),
                    "pending": sync.is_pending(),
                    "schedules": schedules,
                    "selfEchoAvoided": self_echo_avoided,
                }));
            }
        }
    }
    cases
}

/// The bridge edges, so the TypeScript half drives the REAL text: the message type the host's
/// routing arm matches on, the hand-back script as a template, and, for the collections document,
/// the request script that recovers a hand-off the app had to refuse.
///
/// The substitution is asserted rather than assumed: a template that did not rebuild byte for byte
/// would make the gate run against text the app never sends, which is the shape of every gate
/// failure this port has had.
fn collections_bridge(sample: &CollectionsDocument) -> Value {
    let placeholder = json!(COLLECTIONS_SCRIPT_PLACEHOLDER).to_string();
    let template = collections_hand_back_script(&json!(COLLECTIONS_SCRIPT_PLACEHOLDER));
    let value = sample.to_wire_json();
    assert_eq!(
        template.replace(&placeholder, &value.to_string()),
        collections_hand_back_script(&value),
        "the collections script template must rebuild the real script byte for byte"
    );
    json!({
        "messageType": COLLECTIONS_HAND_OFF_MESSAGE_TYPE,
        "scriptTemplate": template,
        "placeholder": placeholder,
        "requestScript": collections_request_script(),
    })
}

fn spaces_bridge(sample: &SpacesDocument) -> Value {
    let placeholder = json!(SPACES_SCRIPT_PLACEHOLDER).to_string();
    let template = spaces_hand_back_script(&json!(SPACES_SCRIPT_PLACEHOLDER));
    let value = sample.to_wire_json();
    assert_eq!(
        template.replace(&placeholder, &value.to_string()),
        spaces_hand_back_script(&value),
        "the spaces script template must rebuild the real script byte for byte"
    );
    json!({
        "messageType": SPACES_HAND_OFF_MESSAGE_TYPE,
        "scriptTemplate": template,
        "placeholder": placeholder,
    })
}

fn collections_wire(document: &CollectionsDocument) -> Value {
    document.to_wire_json()
}

fn spaces_wire(document: &SpacesDocument) -> Value {
    document.to_wire_json()
}

/// Three collections documents: empty, one folder, and two folders with a HIGHER counter, so an
/// echo in either direction moves the monotonic number.
fn collection_documents() -> Vec<CollectionsDocument> {
    let build = |entries: &[(&str, &[&str])], counter: i64| {
        let collections: Vec<Value> = entries
            .iter()
            .map(|(id, projects)| {
                json!({
                    "collectionId": id,
                    "color": "#7c6df2",
                    "projectIds": projects,
                    "title": format!("Group {id}"),
                })
            })
            .collect();
        CollectionsDocument::from_storage_json(&json!({
            "collections": collections,
            "nextCollectionNumber": counter,
        }))
    };
    vec![
        CollectionsDocument::empty(),
        build(&[("C1", &["P1", "P2"][..])], 2),
        build(&[("C1", &["P2"][..]), ("C2", &["P3"][..])], 5),
    ]
}

/// Three Spaces documents: empty, one Space, and two with the members moved, which is what a drop
/// onto a Space button produces.
fn space_documents() -> Vec<SpacesDocument> {
    let build = |entries: &[(&str, &[&str])]| {
        let mut spaces = serde_json::Map::new();
        let mut order = Vec::new();
        for (id, projects) in entries {
            order.push(Value::from(*id));
            spaces.insert(
                (*id).to_string(),
                json!({
                    "spaceId": id,
                    "name": format!("Space {id}"),
                    "icon": "stack",
                    "memberCollectionIds": [],
                    "memberProjectIds": projects,
                }),
            );
        }
        SpacesDocument::from_echo_json(&json!({ "order": order, "spaces": spaces }))
            .expect("a built Spaces document parses")
    };
    vec![
        SpacesDocument::default(),
        build(&[("S1", &["P1"][..])]),
        build(&[("S1", &["P2"][..]), ("S2", &["P1"][..])]),
    ]
}

fn outcome_name(outcome: AdoptOutcome) -> &'static str {
    match outcome {
        AdoptOutcome::NoEcho => "NoEcho",
        AdoptOutcome::Unparsable => "Unparsable",
        AdoptOutcome::IgnoredPending => "IgnoredPending",
        AdoptOutcome::IgnoredEqual => "IgnoredEqual",
        AdoptOutcome::ScheduledPush => "ScheduledPush",
        AdoptOutcome::Adopted => "Adopted",
    }
}
