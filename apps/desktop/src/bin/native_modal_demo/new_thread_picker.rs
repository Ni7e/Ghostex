//! New Thread picker preview. States (`GHOSTEX_NATIVE_MODAL_DEMO_STATE`):
//! default (nine agents, two Codex and one Claude account), `accounts` (the
//! Codex account list opens after a moment), `noaccounts` (accounts read but
//! none for Codex: Current CLI login and Add account), `error` (the accounts
//! list could not be read: Try again), `loading` (agents not read yet).
use super::new_thread_picker::*;
use gpui::{App, AppContext as _, Entity, WindowHandle};
use gpui_component::Root;
use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;

fn agent(light: bool, agent_id: &str, name: &str, icon: Option<&str>) -> NewThreadPickerAgent {
    let (icon_path, icon_svg_size, icon_accent) = match icon {
        Some("codex") => (Some("agent-icons/codex.svg"), 10.5, 0xffffff),
        Some("claude") => (Some("agent-icons/claude.svg"), 11.0, 0xd97757),
        Some("cursor-cli") => (Some("agent-icons/cursor-cli.svg"), 11.5, 0xedecec),
        Some("grok-build") => (Some("agent-icons/grok-build.svg"), 11.5, 0xffffff),
        Some("hermes-agent") => (Some("agent-icons/hermes-agent.svg"), 11.5, 0xf3c46b),
        Some("pi") => (Some("agent-icons/pi.svg"), 10.5, 0xc8ff62),
        Some("omp") => (Some("agent-icons/omp.svg"), 11.5, 0xc8ff62),
        Some("antigravity-cli") => (Some("agent-icons/antigravity-cli.svg"), 11.5, 0x749bff),
        Some("zcode") => (
            Some("agent-icons/zcode.svg"),
            11.5,
            if light { 0x000000 } else { 0xffffff },
        ),
        _ => (None, 12.0, 0xffffff),
    };
    NewThreadPickerAgent {
        agent_id: agent_id.to_string(),
        name: name.to_string(),
        icon: icon.map(str::to_string),
        icon_path,
        icon_svg_size,
        icon_accent,
    }
}

fn account(
    id: &str,
    provider: &str,
    name: &str,
    usage: &str,
    ready: bool,
    is_default: bool,
) -> NewThreadPickerAccount {
    NewThreadPickerAccount {
        id: id.to_string(),
        provider: provider.to_string(),
        name: name.to_string(),
        usage: Some(usage.to_string()),
        ready,
        is_default,
    }
}

fn accounts(state: &str) -> Option<Vec<NewThreadPickerAccount>> {
    match state {
        "error" => None,
        "noaccounts" => Some(vec![account(
            "claude-1",
            "claude",
            "m•••a@•••••.•••",
            "7d: 31% · 5h: 12%",
            true,
            true,
        )]),
        _ => Some(vec![
            account(
                "codex-1",
                "codex",
                "m•••a@•••••.•••",
                "7d: 42% · 3rs",
                true,
                true,
            ),
            account(
                "codex-2",
                "codex",
                "work@example.com",
                "7d: 88% · 0rs",
                false,
                false,
            ),
            account(
                "claude-1",
                "claude",
                "m•••a@•••••.•••",
                "7d: 31% · 5h: 12%",
                true,
                true,
            ),
        ]),
    }
}

pub(super) fn open(demo: &super::DemoEnv, cx: &mut App) {
    let state = demo.state.clone();
    let light = demo.palette.light;
    let agents = if state == "loading" {
        Vec::new()
    } else {
        vec![
            agent(light, "codex", "Codex", Some("codex")),
            agent(light, "claude", "Claude", Some("claude")),
            agent(light, "cursor", "Cursor CLI", Some("cursor-cli")),
            agent(light, "grok", "Grok Build", Some("grok-build")),
            agent(light, "hermes", "Hermes Agent", Some("hermes-agent")),
            agent(light, "pi", "Pi Agent", Some("pi")),
            agent(light, "omp", "OMP", Some("omp")),
            agent(
                light,
                "antigravity",
                "Antigravity CLI",
                Some("antigravity-cli"),
            ),
            agent(light, "zcode", "ZCode", Some("zcode")),
        ]
    };
    let slot: Rc<RefCell<Option<(WindowHandle<Root>, Entity<GpuiNewThreadPickerWindow>)>>> =
        Rc::new(RefCell::new(None));
    let host_slot = slot.clone();
    let host: NewThreadPickerHost = Rc::new(move |command, cx: &mut App| match command {
        NewThreadPickerCommand::LaunchAgent {
            agent_id,
            account_id,
        } => {
            eprintln!("launch {agent_id} with account {account_id:?}");
            cx.quit();
        }
        NewThreadPickerCommand::OpenBrowser => {
            eprintln!("open browser");
            cx.quit();
        }
        NewThreadPickerCommand::CreateTerminal => {
            eprintln!("create terminal");
            cx.quit();
        }
        NewThreadPickerCommand::AddAccount => {
            eprintln!("add account");
            cx.quit();
        }
        NewThreadPickerCommand::RetryAccounts => {
            eprintln!("retry accounts");
            let slot = host_slot.clone();
            cx.spawn(async move |cx| {
                cx.background_executor().timer(Duration::from_secs(1)).await;
                let target = slot.borrow().clone();
                if let Some((window, view)) = target {
                    let _ = cx.update(|cx| {
                        let _ = window.update(cx, |_root, _window, cx| {
                            view.update(cx, |picker, cx| {
                                picker.set_accounts(Ok(accounts("").unwrap_or_default()), cx);
                            });
                        });
                    });
                }
            })
            .detach();
        }
        NewThreadPickerCommand::Closed => {
            eprintln!("closed");
            cx.quit();
        }
    });
    let config = NewThreadPickerConfig {
        palette: demo.palette,
        agents: agents.clone(),
        agents_loaded: state != "loading",
        accounts: accounts(&state),
        close_when_inactive: false,
    };
    let (window, view) = super::open_modal_window(
        NEW_THREAD_PICKER_WIDTH,
        new_thread_picker_window_height(agents.len()),
        move |window, cx| cx.new(|cx| GpuiNewThreadPickerWindow::new(config, host, window, cx)),
        cx,
    );
    *slot.borrow_mut() = Some((window, view.clone()));
    if state == "accounts" || state == "noaccounts" || state == "error" {
        let error = state == "error";
        cx.spawn(async move |cx| {
            cx.background_executor()
                .timer(Duration::from_millis(300))
                .await;
            let _ = cx.update(|cx| {
                let _ = window.update(cx, |_root, window, cx| {
                    view.update(cx, |picker, cx| {
                        if error {
                            picker.set_accounts(
                                Err("Could not reach gxserver on this computer.".to_string()),
                                cx,
                            );
                        }
                        picker.preview_enter_accounts(0, window, cx);
                    });
                });
            });
        })
        .detach();
    }
}
