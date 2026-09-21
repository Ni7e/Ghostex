//! The Rust half of the account-menu gate: the agent launcher's account pages (`agentAccounts`)
//! and a session row's Switch Account flyout (`sessionAccounts`), driven through scripts of
//! commands and late, failed and overtaken answers, plus an enumeration of the four shared account
//! text rules the pages use.
//!
//! Every script is run through `SidebarAccountMenus` exactly as the desktop host runs it
//! (`gx_store/sidebar_accounts.rs`): a command's steps, each request held until the script
//! answers it, the answer read the way the host reads it (a local answer through
//! `agent_accounts_http_answer`, a remote one shaped through `AccountsState` as the bridge shapes
//! it), and a launch planned through the store's own `plan_agent_run`. The store, the agents and
//! every account are BUILT: no name, email or figure here came from a real machine.
//!
//!   cargo run --release --example sidebar_account_menu_parity -- <out-dir> [--inject <mutation>]
//!   bun tooling/gx-core/account-menu-parity.ts compare <out-dir> [--inject <mutation>]
//!
//! Host mutations (`--inject` here), each of which the compare must catch:
//!   late-answer        the host keys its pending call by PAGE, so an older call's answer is
//!                      applied to the newest request of the same page
//!   fresh-transport    the host builds the per-session switch memory anew for every command
//!   no-mask            Hide account emails is never read
//!   working-ignored    the row's working state is never read
//!   drop-switch-clear  the progress is never cleared once a pick lands
//!   no-refresh         Try Again does not ask the daemon to refresh
//!   launch-without-account  the quick launch drops the default account
//!   blank-counts       the agent list's account counts stay blank

use std::process::ExitCode;

use ghostex_gx_core::{
    account_headline_windows, account_session_working, account_usage_detail, account_usage_label,
    agent_accounts_http_answer, is_five_hour_window, is_weekly_window, js_round, mask_account_text,
    plan_agent_run, AccountMenuHost, AccountMenuStep, AccountsRequest, AccountsState,
    AccountsTarget, ActionEffect, Core, LauncherAgent, MachineId, MachineTabInput, MenuHost,
    MenuItem, SessionKey, SidebarAccountMenus, SidebarInputs, SidebarViewModel,
};
use serde_json::{json, Value};

const NOW_MS: u64 = 1_790_000_000_000;
const REMOTE: &str = "remote-ab12";
const P1: &str = "combined-project:P1";
const P9: &str = "combined-project:P9";
const R1: &str = "remote:remote-ab12:group:R1";
const S1: &str = "combined-session:P1:S1";
const S2: &str = "combined-session:P1:S2";
const S3: &str = "combined-session:P1:S3";
const T1: &str = "remote:remote-ab12:session:R1:T1";
const REMOTE_FAILED: &str = "Remote gxserver request failed.";

const MUTATIONS: [&str; 8] = [
    "late-answer",
    "fresh-transport",
    "no-mask",
    "working-ignored",
    "drop-switch-clear",
    "no-refresh",
    "launch-without-account",
    "blank-counts",
];

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(out_dir) = args.first().filter(|dir| !dir.starts_with("--")) else {
        eprintln!("usage: sidebar_account_menu_parity <out-dir> [--inject <mutation>]");
        return ExitCode::from(2);
    };
    let inject = args
        .iter()
        .position(|arg| arg == "--inject")
        .and_then(|index| args.get(index + 1))
        .cloned();
    if let Some(name) = &inject {
        if !MUTATIONS.contains(&name.as_str()) {
            eprintln!("unknown mutation {name}; one of {MUTATIONS:?}");
            return ExitCode::from(2);
        }
    }
    let inject = inject.as_deref().unwrap_or("");

    let local = snapshot(&[
        (
            "P1",
            vec![
                row("S1", json!({})),
                row("S2", json!({ "activity": "working" })),
                row(
                    "S3",
                    json!({ "agentIcon": "claude", "agentName": "claude" }),
                ),
            ],
        ),
        ("P2", vec![row("Q1", json!({}))]),
    ]);
    let remote = snapshot(&[("R1", vec![row("T1", json!({ "activity": "working" }))])]);
    let mut core = Core::new();
    core.handle_raw_frame(MachineId::Local, &frame(&local).to_string(), NOW_MS)
        .expect("the local frame parses");
    let last = core
        .handle_raw_frame(
            MachineId::Remote(REMOTE.to_string()),
            &frame(&remote).to_string(),
            NOW_MS,
        )
        .expect("the remote frame parses");
    let mut models = Vec::new();
    for tab in ["local", REMOTE] {
        let mut inputs = SidebarInputs::default();
        inputs.ui.selected_machine_id = tab.to_string();
        inputs.host.machines = vec![MachineTabInput {
            machine_id: REMOTE.to_string(),
            label: "Remote".to_string(),
            state: "connected".to_string(),
            message: None,
            fed: true,
        }];
        let mut model = SidebarViewModel::new();
        model.update(&core, &inputs, &last.changes, NOW_MS);
        models.push((tab, model));
    }

    let agents = json!([
        { "agentId": "claude", "name": "Claude", "icon": "claude" },
        { "agentId": "codex", "name": "Codex", "icon": "codex" },
        { "agentId": "pi", "name": "Pi Agent", "icon": "pi" },
        { "agentId": "house-agent", "name": "House Agent" },
    ]);
    let mut outputs = Vec::new();
    let mut scripts = scripts();
    for script in &mut scripts {
        let tab = script["tab"].as_str().unwrap_or("local");
        let view = models
            .iter()
            .find(|(name, _)| *name == tab)
            .map(|(_, model)| model.view())
            .expect("a view per tab");
        let mut run = Run {
            menus: SidebarAccountMenus::default(),
            host: MenuHost {
                agents: launcher_agents(&agents),
                primary_agent_id: script["primaryAgentId"].as_str().map(str::to_string),
                machine_connected: true,
                workspace_focus_bridge: true,
                ..MenuHost::default()
            },
            hide: false,
            pending: Vec::new(),
            events: Vec::new(),
            inject,
            view,
        };
        let steps = script["steps"].as_array().cloned().unwrap_or_default();
        let mut shaped_steps = Vec::new();
        for step in steps {
            let mut step = step;
            if let Some(command) = step.get("command") {
                if inject == "fresh-transport" && command["type"] == "sessionAccounts" {
                    run.menus.sessions = Default::default();
                }
                let host = account_host(&run.host, run.hide, inject, false);
                let steps = run
                    .menus
                    .command(command, &host)
                    .expect("every scripted command names its page");
                run.record(steps);
            } else if let Some(hide) = step.get("hideAccountEmails").and_then(Value::as_bool) {
                run.hide = hide;
            } else if let Some(index) = step.get("answer").and_then(Value::as_u64) {
                let index = index as usize;
                // A request this side never made (a source mutation that skips one) answers
                // nothing here; the compare sees the missing request.
                let Some(slot) = run.pending.get_mut(index) else {
                    shaped_steps.push(step);
                    continue;
                };
                // Only the late-answer mutation can have consumed a request already.
                let Some(mut request) = slot.take() else {
                    assert_eq!(inject, "late-answer", "each request is answered once");
                    shaped_steps.push(step);
                    continue;
                };
                if inject == "late-answer" {
                    // The newest pending request of the same page takes this answer.
                    if let Some(newer) = run.pending.iter_mut().rev().find(|newer| {
                        newer
                            .as_ref()
                            .is_some_and(|newer| newer.page() == request.page())
                    }) {
                        request = newer.take().unwrap();
                    }
                }
                let result = match &request.target {
                    AccountsTarget::Local => {
                        let http = &step["local"];
                        agent_accounts_http_answer(
                            http["status"].as_u64().unwrap_or(0) as u16,
                            http["body"].as_str().unwrap_or_default(),
                        )
                    }
                    AccountsTarget::Remote(_) => match step.get("remote") {
                        Some(result) => {
                            // `gpui_remote_sidebar_agent_accounts_response_payload`: what the
                            // bridge lets through, which is also what the TypeScript is handed.
                            let shaped = AccountsState::from_json(result)
                                .map(|state| state.to_json())
                                .unwrap_or(Value::Null);
                            step["shaped"] = shaped.clone();
                            Ok(shaped)
                        }
                        None => Err(REMOTE_FAILED.to_string()),
                    },
                };
                let working = request
                    .session_id()
                    .is_some_and(|id| account_session_working(view, id))
                    && inject != "working-ignored";
                let host = account_host(&run.host, run.hide, inject, working);
                let answer = run.menus.answer(request, result, &host);
                if answer.overtaken {
                    run.events.push(json!({ "event": "overtaken" }));
                }
                run.record(answer.steps);
            }
            shaped_steps.push(step);
        }
        script["steps"] = Value::Array(shaped_steps);
        let unanswered = run
            .pending
            .iter()
            .filter(|request| request.is_some())
            .count();
        outputs.push(json!({
            "name": script["name"],
            "events": run.events,
            "unanswered": unanswered,
        }));
    }

    let dump = json!({
        "localSnapshot": local,
        "remoteSnapshot": remote,
        "remoteMachineId": REMOTE,
        "agents": agents,
        "scripts": scripts,
        "rust": outputs,
        "usage": usage_enumeration(),
        "inject": inject,
    });
    let path = std::path::Path::new(out_dir).join("account-menu-rust.json");
    if let Err(error) = std::fs::create_dir_all(out_dir)
        .and_then(|()| std::fs::write(&path, serde_json::to_string(&dump).unwrap()))
    {
        eprintln!("could not write {}: {error}", path.display());
        return ExitCode::from(1);
    }
    println!(
        "{} scripts, {} usage cases -> {}",
        dump["scripts"].as_array().map_or(0, Vec::len),
        dump["usage"].as_array().map_or(0, Vec::len),
        path.display()
    );
    ExitCode::SUCCESS
}

struct Run<'a> {
    menus: SidebarAccountMenus,
    host: MenuHost,
    hide: bool,
    pending: Vec<Option<AccountsRequest>>,
    events: Vec<Value>,
    inject: &'a str,
    view: &'a ghostex_gx_core::SidebarView,
}

fn account_host<'a>(
    host: &'a MenuHost,
    hide: bool,
    inject: &str,
    working: bool,
) -> AccountMenuHost<'a> {
    AccountMenuHost {
        menu: host,
        hide_account_emails: hide && inject != "no-mask",
        session_working: working,
    }
}

impl Run<'_> {
    fn record(&mut self, steps: Vec<AccountMenuStep>) {
        for step in steps {
            match step {
                AccountMenuStep::Publish {
                    owner_id,
                    items,
                    close,
                } => {
                    let mut items: Vec<Value> = items.iter().map(MenuItem::to_json).collect();
                    if self.inject == "blank-counts" {
                        for item in &mut items {
                            if let Some(secondary) = item.get_mut("secondary") {
                                secondary["label"] = json!("");
                            }
                        }
                    }
                    self.events.push(json!({
                        "event": "publish",
                        "ownerId": owner_id,
                        "close": close,
                        "items": items,
                    }));
                }
                AccountMenuStep::Request(request) => {
                    let mut params = request.params.clone();
                    if self.inject == "no-refresh" {
                        if let Some(object) = params.as_object_mut() {
                            object.remove("refresh");
                        }
                    }
                    self.events.push(json!({
                        "event": "request",
                        "target": match &request.target {
                            AccountsTarget::Local => "local".to_string(),
                            AccountsTarget::Remote(machine) => format!("remote:{machine}"),
                        },
                        "params": params,
                    }));
                    self.pending.push(Some(request));
                }
                AccountMenuStep::Launch {
                    group_id,
                    agent_id,
                    account_id,
                } => {
                    let mut command = json!({
                        "type": "projectAction",
                        "action": "agent",
                        "groupId": group_id,
                        "agentId": agent_id,
                    });
                    if let Some(account_id) =
                        account_id.filter(|_| self.inject != "launch-without-account")
                    {
                        command["accountId"] = json!(account_id);
                    }
                    let message = plan_agent_run(self.view, &command).and_then(|plan| {
                        plan.effects.into_iter().find_map(|effect| match effect {
                            ActionEffect::SidebarHostMessage { message } => Some(message),
                            _ => None,
                        })
                    });
                    if let Some(message) = message {
                        // The runtime's `runSidebarAgent` writes the primary agent, which the
                        // host re-reads once the launch has dropped its cached copy.
                        self.host.primary_agent_id = Some(agent_id);
                        self.events
                            .push(json!({ "event": "launch", "message": message }));
                    }
                }
                AccountMenuStep::SwitchProgress { session, progress } => {
                    if progress.is_none() && self.inject == "drop-switch-clear" {
                        continue;
                    }
                    self.events.push(progress_event(&session, progress));
                }
            }
        }
    }
}

fn progress_event(session: &SessionKey, progress: Option<Value>) -> Value {
    let mut event = json!({
        "event": "progress",
        "projectId": session.project_id,
        "sessionId": session.session_id,
        "progress": progress.unwrap_or(Value::Null),
    });
    if let MachineId::Remote(machine) = &session.machine {
        event["machineId"] = json!(machine);
    }
    event
}

fn launcher_agents(agents: &Value) -> Vec<LauncherAgent> {
    agents
        .as_array()
        .unwrap()
        .iter()
        .map(|agent| LauncherAgent {
            agent_id: agent["agentId"].as_str().unwrap().to_string(),
            name: agent["name"].as_str().unwrap().to_string(),
            icon: agent["icon"].as_str().map(str::to_string),
        })
        .collect()
}

/// A synthetic account list: every rule of both pages has an account that reaches it.
fn accounts(session: Value) -> Value {
    let window = |id: &str, seconds: Value, used: f64, model: Value| json!({ "id": id, "label": format!("{id} window"), "usedPercent": used, "limitWindowSeconds": seconds, "model": model });
    let mut state = json!({
        "accounts": [
            {
                "id": "acct-ada", "provider": "claude", "selector": "ada", "indicator": "AL",
                "name": "Ada Lovelace", "email": "ada@example.test", "registered": true,
                "status": "ready", "sessionCount": 2, "color": "sky", "eligible": true, "sharedHistory": true,
                "usage": [
                    window("sevenDay", json!(604800), 42.5, Value::Null),
                    window("fiveHour", json!(18000), 12.49, Value::Null),
                    window("sevenDayFable", json!(604800), 80.0, json!("Fable")),
                ],
            },
            {
                "id": "acct-bob", "provider": "claude", "selector": "bob", "indicator": "",
                "name": "bob.builder@example.test", "email": "", "registered": true,
                "status": "loginRequired", "sessionCount": 0,
                "usage": [
                    window("sevenDay", Value::Null, 99.5, Value::Null),
                    window("opusWeek", json!(604800), 10.0, json!("Opus")),
                ],
            },
            {
                "id": "acct-carl", "provider": "claude", "selector": "carl", "name": "Carl",
                "email": "carl@example.test", "registered": false, "status": "ready", "usage": [],
            },
            {
                "id": "acct-dot", "provider": "claude", "selector": "dot", "name": "Dot",
                "email": "dot@example.test", "registered": true, "status": "ready",
                "usage": [
                    window("sevenDay", json!(18000), 30.0, Value::Null),
                    window("custom", json!(90000), 70.0, json!("")),
                ],
            },
            {
                "id": "acct-dee", "provider": "codex", "selector": "dee", "name": "Dee",
                "email": "dee@example.test", "registered": true, "status": "ready", "resetCredits": 3,
                "usage": [
                    window("primary", json!(18000), 20.0, Value::Null),
                    window("secondary", json!(604800), 99.5, Value::Null),
                ],
            },
            {
                "id": "acct-eve", "provider": "codex", "selector": "eve", "name": "Eve",
                "email": "eve@example.test", "registered": true, "status": "ready", "resetCredits": null,
                "usage": [window("secondary", json!(1209600), -0.5, Value::Null)],
            },
            {
                "id": "acct-fay", "provider": "codex", "selector": "fay", "name": "Fay at fay@example.test",
                "email": "fay@example.test", "registered": true, "status": "ready", "resetCredits": 1.5,
                "usage": [],
            },
            {
                "id": "acct-gus", "provider": "codex", "selector": "gus", "name": "Gus",
                "email": "gus@example.test", "registered": true, "status": "unavailable", "resetCredits": 0,
                "usage": [window("weekly", json!(700000), 0.49999999999999994, Value::Null)],
            },
        ],
        "helpers": [],
        "defaults": {},
        "defaultAccounts": { "claude": "acct-ada", "codex": "acct-fay" },
    });
    if !session.is_null() {
        state["session"] = session;
    }
    state
}

fn empty_accounts() -> Value {
    json!({ "accounts": [], "helpers": [], "defaults": {}, "defaultAccounts": {} })
}

/// A local answer: the whole HTTP envelope, as the runtime's client reads it.
fn ok(result: Value) -> Value {
    json!({
        "status": 200,
        "body": json!({ "ok": true, "product": "gxserver", "protocolVersion": 1, "result": result }).to_string(),
    })
}

fn fail(status: u16, body: &str) -> Value {
    json!({ "status": status, "body": body })
}

fn command(value: Value) -> Value {
    json!({ "command": value })
}

fn answer(index: usize, local: Value) -> Value {
    json!({ "answer": index, "local": local })
}

fn remote_answer(index: usize, result: Option<Value>) -> Value {
    match result {
        Some(result) => json!({ "answer": index, "remote": result }),
        None => json!({ "answer": index }),
    }
}

fn launcher(group: &str, action: &str, agent: Option<&str>) -> Value {
    let mut value = json!({ "type": "agentAccounts", "groupId": group, "action": action });
    if let Some(agent) = agent {
        value["agentId"] = json!(agent);
    }
    command(value)
}

fn flyout(session: &str, action: &str, account: Option<&str>) -> Value {
    let mut value = json!({ "type": "sessionAccounts", "sessionId": session, "action": action });
    if let Some(account) = account {
        value["accountId"] = json!(account);
    }
    command(value)
}

fn script(name: &str, tab: &str, steps: Vec<Value>) -> Value {
    json!({ "name": name, "tab": tab, "steps": steps })
}

fn scripts() -> Vec<Value> {
    let claude_session =
        json!({ "provider": "claude", "accountId": "acct-ada", "policy": {}, "override": null });
    let codex_session =
        json!({ "provider": "codex", "accountId": null, "policy": {}, "override": null });
    let hide = json!({ "hideAccountEmails": true });
    let failed = fail(
        500,
        &json!({ "ok": false, "message": "  Could not read\u{0}accounts for\n\tops@example.test  " }).to_string(),
    );
    let mut scripts = vec![
        // The launcher opens, the counts arrive, each agent's page, back, and a cached launch.
        script("launcher-open-pages", "local", vec![
            launcher(P1, "load", None),
            answer(0, ok(accounts(Value::Null))),
            launcher(P1, "accounts", Some("claude")),
            launcher(P1, "root", None),
            launcher(P1, "accounts", Some("codex")),
            hide.clone(),
            launcher(P1, "accounts", Some("claude")),
            launcher(P1, "accounts", Some("house-agent")),
            launcher(P1, "launch", Some("codex")),
            launcher(P1, "root", None),
        ]),
        // Reopening the launcher drops the list it cached and asks again, so the counts are
        // never the previous opening's; a cached page in between asks nothing.
        script("launcher-reopen-reloads", "local", vec![
            launcher(P1, "load", None),
            answer(0, ok(accounts(Value::Null))),
            launcher(P1, "accounts", Some("claude")),
            launcher(P1, "load", None),
            answer(1, ok(empty_accounts())),
            launcher(P1, "accounts", Some("claude")),
        ]),
        // A page opened before the list: the hint, then the page.
        script("launcher-reading-hint", "local", vec![
            launcher(P1, "accounts", Some("codex")),
            answer(0, ok(accounts(Value::Null))),
            launcher(P1, "launch", Some("claude")),
        ]),
        // A launch before any list waits for it, and starts as the default account.
        script("launcher-launch-waits", "local", vec![
            launcher(P1, "launch", Some("claude")),
            answer(0, ok(accounts(Value::Null))),
        ]),
        // An agent with no account switcher launches at once, list or not.
        script("launcher-launch-plain", "local", vec![
            launcher(P1, "launch", Some("pi")),
            launcher(P1, "launch", Some("house-agent")),
            launcher(P1, "launch", Some("gone-agent")),
            answer(0, ok(accounts(Value::Null))),
        ]),
        // A failed read, Try Again with a refresh, and the empty-state block.
        script("launcher-failure-retry", "local", vec![
            launcher(P1, "accounts", Some("claude")),
            answer(0, failed.clone()),
            hide.clone(),
            launcher(P1, "retry", Some("claude")),
            answer(1, fail(502, "")),
            launcher(P1, "retry", Some("claude")),
            answer(2, ok(empty_accounts())),
            launcher(P1, "root", None),
            launcher(P1, "launch", Some("claude")),
        ]),
        // A failed launch read shows the page with the reason and launches nothing.
        script("launcher-launch-fails", "local", vec![
            launcher(P1, "launch", Some("codex")),
            answer(0, fail(200, &json!({ "ok": true, "product": "gxserver", "protocolVersion": 2, "result": {} }).to_string())),
            launcher(P1, "root", None),
            answer(1, fail(200, &json!({ "ok": true, "product": "other", "result": {} }).to_string())),
        ]),
        // LATE ANSWERS: a load overtaken by a page, and a group overtaken by another group.
        script("launcher-late-same-group", "local", vec![
            launcher(P1, "load", None),
            launcher(P1, "accounts", Some("claude")),
            answer(1, ok(accounts(Value::Null))),
            answer(0, ok(empty_accounts())),
            launcher(P1, "root", None),
        ]),
        script("launcher-late-other-group", "local", vec![
            launcher(P1, "load", None),
            launcher(P9, "load", None),
            answer(0, ok(accounts(Value::Null))),
            answer(1, ok(empty_accounts())),
            launcher(P9, "accounts", Some("codex")),
            launcher(P1, "accounts", Some("codex")),
            answer(2, ok(accounts(Value::Null))),
            launcher(P1, "launch", Some("codex")),
        ]),
        // A late FAILURE is dropped too.
        script("launcher-late-failure", "local", vec![
            launcher(P1, "accounts", Some("claude")),
            launcher(P1, "accounts", Some("codex")),
            answer(0, failed.clone()),
            answer(1, ok(accounts(Value::Null))),
        ]),
        // A group this list does not draw: the pages still work, the launch plans nothing.
        script("launcher-undrawn-group", "local", vec![
            launcher(P9, "load", None),
            answer(0, ok(accounts(Value::Null))),
            launcher(P9, "launch", Some("claude")),
            launcher(P9, "launch", Some("pi")),
        ]),
        // A remote machine's project: its tunnel, a failure, and a shaped answer.
        script("launcher-remote", REMOTE, vec![
            launcher(R1, "load", None),
            remote_answer(0, None),
            launcher(R1, "accounts", Some("claude")),
            remote_answer(1, Some(accounts(Value::Null))),
            launcher(R1, "launch", Some("claude")),
        ]),
        // The flyout: a codex session, a claude session, the working row, hidden emails.
        script("flyout-pages", "local", vec![
            flyout(S1, "load", None),
            answer(0, ok(accounts(codex_session.clone()))),
            flyout(S3, "load", None),
            answer(1, ok(accounts(claude_session.clone()))),
            flyout(S2, "load", None),
            answer(2, ok(accounts(claude_session.clone()))),
            hide.clone(),
            flyout(S3, "load", None),
            answer(3, ok(accounts(claude_session.clone()))),
            flyout(S1, "load", None),
            answer(4, ok(accounts(Value::Null))),
            flyout(S1, "load", None),
            answer(5, ok(empty_accounts())),
        ]),
        // A pick: the progress names the account from the last answer, clears on success and on
        // failure, and does not show for the account already in use or for an unknown one.
        script("flyout-pick", "local", vec![
            flyout(S3, "load", None),
            answer(0, ok(accounts(claude_session.clone()))),
            flyout(S3, "select", Some("acct-bob")),
            answer(1, ok(accounts(json!({ "provider": "claude", "accountId": "acct-bob" })))),
            flyout(S3, "select", Some("acct-bob")),
            answer(2, ok(accounts(claude_session.clone()))),
            flyout(S3, "select", Some("acct-dot")),
            answer(3, failed.clone()),
            flyout(S3, "select", Some("acct-nobody")),
            answer(4, ok(accounts(claude_session.clone()))),
            flyout(S1, "select", Some("acct-dee")),
            answer(5, ok(accounts(codex_session.clone()))),
        ]),
        // Try Again refreshes; a bad row id never calls.
        script("flyout-retry-and-bad-id", "local", vec![
            flyout(S1, "load", None),
            answer(0, fail(503, &json!({ "ok": false, "message": 42 }).to_string())),
            flyout(S1, "retry", None),
            answer(1, ok(accounts(codex_session.clone()))),
            flyout("garbage-row", "load", None),
            flyout("combined-session:P1", "retry", None),
        ]),
        // LATE ANSWERS: another row's answer lands after this row's, and a pick lands after the
        // flyout moved on. The dropped answer still teaches the memory the next pick reads.
        script("flyout-late-other-session", "local", vec![
            flyout(S3, "load", None),
            flyout(S1, "load", None),
            answer(1, ok(accounts(codex_session.clone()))),
            answer(0, ok(accounts(claude_session.clone()))),
            flyout(S3, "select", Some("acct-dot")),
            flyout(S1, "load", None),
            answer(2, ok(accounts(json!({ "provider": "claude", "accountId": "acct-dot" })))),
            answer(3, ok(accounts(codex_session.clone()))),
        ]),
        script("flyout-late-same-session", "local", vec![
            flyout(S3, "load", None),
            flyout(S3, "retry", None),
            answer(1, failed.clone()),
            answer(0, ok(accounts(claude_session.clone()))),
            flyout(S3, "select", Some("acct-ada")),
            answer(2, ok(accounts(claude_session.clone()))),
        ]),
        // A remote row: its tunnel, a pick with its machine on the progress, a failure.
        script("flyout-remote", REMOTE, vec![
            flyout(T1, "load", None),
            remote_answer(0, Some(accounts(claude_session.clone()))),
            flyout(T1, "select", Some("acct-dot")),
            remote_answer(1, None),
            flyout(T1, "retry", None),
            remote_answer(2, Some(json!({ "accounts": "not a list" }))),
        ]),
    ];
    // The primary agent the header remembers, for the page that lists the agents.
    scripts.push(script(
        "launcher-primary",
        "local",
        vec![
            launcher(P1, "load", None),
            answer(0, ok(accounts(Value::Null))),
        ],
    ));
    scripts.last_mut().unwrap()["primaryAgentId"] = json!("codex");
    scripts
}

/// The four shared text rules, enumerated over every window shape the helpers publish and some
/// they do not, and the mask over crafted and generated text.
fn usage_enumeration() -> Vec<Value> {
    let mut cases = Vec::new();
    let ids = [
        json!("sevenDay"),
        json!("fiveHour"),
        json!("custom"),
        Value::Null,
    ];
    let seconds = [
        Value::Null,
        json!(0),
        json!(-5),
        json!(18000),
        json!(604800),
        json!(259200),
        json!(18000.0 * 3.0 + 3600.0),
        json!(90000),
        json!(90000.5),
        json!(59.9),
        json!(8.64e25),
    ];
    let models = [
        Value::Null,
        json!(""),
        json!("Fable"),
        json!("FABLE"),
        json!("opus"),
        json!("Opus-fable"),
    ];
    let used = [
        0.0,
        12.5,
        42.5,
        -0.5,
        -2.5,
        0.49999999999999994,
        99.5,
        100.0,
        1e21,
    ];
    let mut windows = Vec::new();
    for id in &ids {
        for second in &seconds {
            for model in &models {
                for (index, used) in used.iter().enumerate() {
                    let mut window = json!({ "usedPercent": used, "limitWindowSeconds": second, "model": model });
                    if !id.is_null() {
                        window["id"] = id.clone();
                    }
                    if index % 2 == 0 {
                        window["label"] = json!("Label");
                    }
                    windows.push(window);
                }
            }
        }
    }
    // Labels and percents, one window per case.
    for window in &windows {
        let parsed = AccountsState::from_json(&json!({
            "accounts": [{ "name": "x", "usage": [window] }],
            "defaultAccounts": {},
        }))
        .expect("a window parses");
        let parsed = &parsed.accounts[0].usage[0];
        cases.push(json!({
            "kind": "window",
            "window": window,
            "label": account_usage_label(parsed),
            "weekly": is_weekly_window(parsed),
            "fiveHour": is_five_hour_window(parsed),
            "round": js_round(parsed.used_percent),
        }));
    }
    // Accounts of two to four windows, both providers: the headline and the row's detail line.
    let mut seed: u64 = 0x5eed;
    let mut next = |bound: usize| {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        ((seed >> 33) as usize) % bound
    };
    for index in 0..3000 {
        let count = 1 + next(4);
        let usage: Vec<Value> = (0..count)
            .map(|_| windows[next(windows.len())].clone())
            .collect();
        let provider = if index % 2 == 0 { "claude" } else { "codex" };
        let mut account =
            json!({ "id": format!("a{index}"), "provider": provider, "name": "x", "usage": usage });
        match next(4) {
            0 => account["resetCredits"] = json!(next(5) as f64 * 0.75),
            1 => account["resetCredits"] = Value::Null,
            2 => account["resetCredits"] = json!("7"),
            _ => {}
        }
        let state =
            AccountsState::from_json(&json!({ "accounts": [account], "defaultAccounts": {} }))
                .expect("an account parses");
        let parsed = &state.accounts[0];
        cases.push(json!({
            "kind": "account",
            "account": account,
            "headline": account_headline_windows(parsed),
            "detail": account_usage_detail(parsed, provider),
        }));
    }
    // The mask over crafted text and generated text.
    let crafted = [
        "ada@example.test",
        "a@b",
        "Name ada@example.test and bob@x.y",
        "a@b@c",
        "@lead and trail@",
        "no address here",
        "x@ y",
        "é😀@例え.jp",
        "tab\tsep@x\u{a0}nbsp@y",
        "nel\u{85}ab@cd",
        "bom\u{feff}ab@cd",
        "",
        "@@",
        "ab@@cd",
    ];
    let alphabet = [
        'a', 'b', '@', ' ', '\u{a0}', '\u{85}', '\u{feff}', '.', 'é', '😀', '\n',
    ];
    let mut texts: Vec<String> = crafted.iter().map(|text| text.to_string()).collect();
    for _ in 0..4000 {
        let length = next(9);
        texts.push(
            (0..length)
                .map(|_| alphabet[next(alphabet.len())])
                .collect(),
        );
    }
    for text in texts {
        cases.push(json!({ "kind": "mask", "text": text, "masked": mask_account_text(&text) }));
    }
    cases
}

fn frame(snapshot: &Value) -> Value {
    json!({
        "type": "presentationSnapshot",
        "protocolVersion": ghostex_gx_core::protocol::GXSERVER_PROTOCOL_VERSION,
        "serverId": "server",
        "revision": 1,
        "snapshot": snapshot,
    })
}

fn row(id: &str, extra: Value) -> Value {
    let mut row = json!({
        "sessionId": id,
        "kind": "agent",
        "surface": "workspace",
        "zmxName": format!("S90-{id}"),
        "sortKey": format!("000{id}"),
        "visibleInSidebarByDefault": true,
        "title": format!("Session {id}"),
        "agentIcon": "codex",
        "agentName": "codex",
        "activity": "idle",
        "pendingQuestionCount": 0,
        "lifecycleState": "running",
        "lastInteractionAt": "2026-09-15T01:18:43.055Z",
        "createdAt": "2026-09-01T01:00:00.000Z",
        "updatedAt": "2026-09-15T01:18:43.055Z",
    });
    for (key, value) in extra.as_object().unwrap() {
        row[key] = value.clone();
    }
    row
}

fn snapshot(projects: &[(&str, Vec<Value>)]) -> Value {
    let mut sessions = Vec::new();
    for (project, rows) in projects {
        for row in rows {
            let mut row = row.clone();
            row["projectId"] = json!(project);
            row["groupId"] = json!(format!("{project}:active"));
            sessions.push(row);
        }
    }
    json!({
        "revision": 1,
        "generatedAt": "2026-09-21T00:00:00.000Z",
        "projects": projects.iter().map(|(id, _)| json!({
            "projectId": id,
            "title": id,
            "path": format!("/tmp/{id}"),
            "pathState": "available",
            "groupIds": [format!("{id}:active")],
            "sortKey": format!("1:{id}"),
            "createdAt": "2026-06-29T13:10:42.091Z",
            "updatedAt": "2026-09-15T01:18:43.055Z",
        })).collect::<Vec<_>>(),
        "groups": projects.iter().map(|(id, rows)| json!({
            "groupId": format!("{id}:active"),
            "projectId": id,
            "title": "Active",
            "sessionIds": rows.iter().map(|row| row["sessionId"].clone()).collect::<Vec<_>>(),
            "sortKey": format!("1:{id}:active"),
        })).collect::<Vec<_>>(),
        "sessions": sessions,
    })
}
