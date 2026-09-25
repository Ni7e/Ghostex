//! The Rust half of the app runtime port's F2 fixture gate (tooling/app-runtime-port/f2-parity.ts).
//!
//!   cargo run -q --example f2_parity -- <dir>
//!
//! Reads `<dir>/fixtures.json`, answers every case with the gx-core function that replaced the
//! TypeScript one, and writes `<dir>/rust.json` in the same shape the TypeScript half writes
//! `<dir>/typescript.json`. The driver diffs the two. Deleted with the runtime in step 3.

use std::fs;
use std::path::PathBuf;

use ghostex_gx_core::{notification_feed_jump_target, notification_feed_state_message};
use serde_json::{json, Map, Value};

fn main() {
    let dir = PathBuf::from(std::env::args().nth(1).expect("usage: f2_parity <dir>"));
    let fixtures: Value = serde_json::from_str(
        &fs::read_to_string(dir.join("fixtures.json")).expect("fixtures.json"),
    )
    .expect("fixtures.json is JSON");
    let mut out = Map::new();
    out.insert(
        "notificationFeed".into(),
        notification_feed(&fixtures["notificationFeed"]),
    );
    fs::write(
        dir.join("rust.json"),
        serde_json::to_string_pretty(&Value::Object(out)).expect("serializable"),
    )
    .expect("rust.json");
}

/// Each case: the daemon's answer, and the session a deferral names (or null).
fn notification_feed(cases: &Value) -> Value {
    Value::Array(
        cases
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .map(|case| {
                let message = notification_feed_state_message(&case["result"]);
                let jump = notification_feed_jump_target(&message, case["deferred"].as_str())
                    .map(|item| item["id"].clone())
                    .unwrap_or(Value::Null);
                json!({ "name": case["name"], "message": message, "jump": jump })
            })
            .collect(),
    )
}
