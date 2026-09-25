//! The gate for New Group, Rename and Close Group (gx-core `workspace_groups/group_commands.rs`):
//! every command against every document and active group, dumped as the calls the host makes.
//!
//!   cargo run --release --example group_commands_parity -- <out-dir>
//!   bun tooling/gx-core/group-commands-parity.ts <out-dir> [--inject <mutation>]
//!
//! The TypeScript half runs the handlers the app shipped until 2026-09-25, frozen in
//! tooling/gx-core/workspace-groups-edits-frozen.ts. Deleted in step 3 with the runtime.

use std::process::ExitCode;

use ghostex_gx_core::{
    plan_group_command, ActiveGroup, GroupCommandPlan, ProjectKey, WorkspaceGroupsDocument,
};
use serde_json::{json, Value};

const REMOTE: &str = "remote-ab12";

fn main() -> ExitCode {
    let out_dir = std::env::args().nth(1).unwrap_or_default();
    if out_dir.is_empty() {
        eprintln!("usage: group_commands_parity <out-dir>");
        return ExitCode::from(2);
    }
    let mut cases = Vec::new();
    for (document_label, document) in documents() {
        for (active_label, active_project, active_group) in actives() {
            for message in messages() {
                let plan = plan_group_command(
                    &document,
                    active_project.as_ref(),
                    active_group.as_ref(),
                    &message,
                );
                cases.push(json!({
                    "document": document_label,
                    "documentState": document.to_json(),
                    "active": active_label,
                    "activeProjectId": active_project.as_ref().filter(|p| p.machine.is_local()).map(|p| p.project_id.clone()),
                    "activeGroupId": active_group.as_ref().map(ActiveGroup::to_sidebar_group_id),
                    "message": message,
                    "calls": plan.map(|plan| calls(&plan)),
                }));
            }
        }
    }
    let path = std::path::Path::new(&out_dir).join("rust-group-commands.json");
    if std::fs::write(&path, json!({ "cases": cases }).to_string()).is_err() {
        eprintln!("could not write {}", path.display());
        return ExitCode::from(1);
    }
    println!(
        "group commands probe: {} cases, written to {}",
        cases.len(),
        path.display()
    );
    ExitCode::SUCCESS
}

/// The plan as the calls the host makes, in the shape the TypeScript recorder writes them.
fn calls(plan: &GroupCommandPlan) -> Value {
    match plan {
        GroupCommandPlan::Nothing => json!([]),
        GroupCommandPlan::LimitReached => json!([
            { "call": "toast", "level": "info", "title": "Group limit reached for this project." }
        ]),
        GroupCommandPlan::Create {
            document,
            activate_group_id,
        } => json!([
            { "call": "editDocument", "document": document.to_json() },
            { "call": "activate", "groupId": activate_group_id },
        ]),
        GroupCommandPlan::Rename { document } => json!([
            { "call": "editDocument", "document": document.to_json() }
        ]),
        GroupCommandPlan::Close {
            member_session_ids,
            document,
            activate_project_group,
        } => {
            let mut calls: Vec<Value> = member_session_ids
                .iter()
                .map(|id| json!({ "call": "closeSession", "sessionId": id }))
                .collect();
            calls.push(json!({ "call": "editDocument", "document": document.to_json() }));
            if let Some(project) = activate_project_group {
                calls.push(json!({ "call": "activate", "groupId": project.to_sidebar_group_id() }));
            }
            Value::Array(calls)
        }
    }
}

fn documents() -> Vec<(&'static str, WorkspaceGroupsDocument)> {
    let full: Vec<Value> = (2..=20)
        .map(|n| json!({ "groupId": format!("group-{n}"), "sessionIds": [], "title": format!("Group {n}") }))
        .collect();
    let remote_key = format!("remote:{REMOTE}:project:R1");
    vec![
        (
            "empty",
            WorkspaceGroupsDocument::parse(&json!({ "projectOrder": [], "projects": {} })),
        ),
        (
            "groups",
            WorkspaceGroupsDocument::parse(&json!({
                "projectOrder": ["P1", "P2"],
                "projects": {
                    "P1": { "groups": [
                        { "groupId": "group-2", "sessionIds": ["S4", "S5"], "title": "Group 2" },
                        { "groupId": "group-3", "sessionIds": [], "title": "Named" },
                    ], "nextGroupNumber": 4 },
                    remote_key: { "groups": [
                        { "groupId": "group-2", "sessionIds": ["RS1", "RS2"], "title": "Group 2" },
                    ], "nextGroupNumber": 3 },
                },
            })),
        ),
        (
            "full",
            WorkspaceGroupsDocument::parse(&json!({
                "projectOrder": ["P1"],
                "projects": { "P1": { "groups": full, "nextGroupNumber": 21 } },
            })),
        ),
    ]
}

fn actives() -> Vec<(&'static str, Option<ProjectKey>, Option<ActiveGroup>)> {
    let p1 = ProjectKey::local("P1");
    let r1 = ProjectKey::remote(REMOTE, "R1");
    vec![
        ("none", None, None),
        (
            "p1",
            Some(p1.clone()),
            Some(ActiveGroup::Project(p1.clone())),
        ),
        (
            "p1group2",
            Some(p1.clone()),
            Some(ActiveGroup::Subgroup {
                project: p1,
                group_id: "group-2".into(),
            }),
        ),
        (
            "r1group2",
            Some(r1.clone()),
            Some(ActiveGroup::Subgroup {
                project: r1,
                group_id: "group-2".into(),
            }),
        ),
    ]
}

fn messages() -> Vec<Value> {
    let p1 = ProjectKey::local("P1");
    let p2 = ProjectKey::local("P2");
    let r1 = ProjectKey::remote(REMOTE, "R1");
    let sub = |project: &ProjectKey, group: &str| {
        ghostex_gx_core::encode_workspace_subgroup_id(project, group)
    };
    let mut out = Vec::new();
    for group_id in [
        Some(p1.to_sidebar_group_id()),
        Some(p2.to_sidebar_group_id()),
        Some(r1.to_sidebar_group_id()),
        Some(sub(&p1, "group-2")),
        Some(sub(&r1, "group-2")),
        Some("combined-chats".to_string()),
        Some(String::new()),
        None,
    ] {
        let mut message = json!({ "type": "createGroup" });
        if let Some(group_id) = &group_id {
            message["groupId"] = json!(group_id);
        }
        out.push(message);
    }
    for group_id in [
        sub(&p1, "group-2"),
        sub(&p1, "group-3"),
        sub(&p1, "group-9"),
        sub(&r1, "group-2"),
        p1.to_sidebar_group_id(),
    ] {
        for title in ["Renamed", "  Padded  ", "", "   ", "Named", "Group 2"] {
            out.push(json!({ "type": "renameGroup", "groupId": group_id, "title": title }));
        }
        out.push(json!({ "type": "closeGroup", "groupId": group_id }));
    }
    out
}
