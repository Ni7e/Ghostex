/*
CDXC:TranscriptExport 2026-09-15 WHY:
Standalone preview of the native Handoff / Export dialog so its look can be
checked against the React Storybook stories without launching Ghostex. Run with:
    cargo run --release --bin export-transcript-modal-demo
Environment:
    GHOSTEX_EXPORT_MODAL_DEMO_THEME=dark|light                    (default dark)
    GHOSTEX_EXPORT_MODAL_DEMO_MODE=handoff|export                 (default: remembered, else handoff)
    GHOSTEX_EXPORT_MODAL_DEMO_STATE=options|done|failed|noagents  (default options)
The primary button simulates the daemon: it answers after one second with a
fake path, or with the failure message when the state is `failed`. Cancel,
Done, Reveal and a handoff quit the demo.
*/
#![allow(dead_code)]
#[path = "../assets.rs"]
mod assets;
#[path = "../app/window/export_transcript_modal.rs"]
mod export_transcript_modal;

use export_transcript_modal::*;
use gpui::{
    App, AppContext as _, Bounds, WindowBounds, WindowHandle, WindowOptions, point, px, size,
};
use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;

const FAKE_PATH: &str = "/Users/you/Library/Application Support/ghostex/exports/fix-hookless-agent-modal-g04t1-20260915-081928.md";

fn env(name: &str) -> String {
    std::env::var(name)
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
}

fn deliver(handle: WindowHandle<GpuiExportTranscriptModalWindow>, ok: bool, cx: &mut App) {
    let _ = handle.update(cx, |modal, window, cx| {
        if ok {
            modal.receive_result(
                true,
                Some(FAKE_PATH.to_string()),
                true,
                Some("codex".to_string()),
                None,
                window,
                cx,
            );
        } else {
            modal.receive_result(
                false,
                None,
                false,
                None,
                Some("This session has no transcript yet. Send a prompt first.".to_string()),
                window,
                cx,
            );
        }
    });
}

fn main() {
    let light = env("GHOSTEX_EXPORT_MODAL_DEMO_THEME") == "light";
    let initial_mode = match env("GHOSTEX_EXPORT_MODAL_DEMO_MODE").as_str() {
        "export" => Some(ExportTranscriptMode::Export),
        "handoff" => Some(ExportTranscriptMode::Handoff),
        _ => None,
    };
    let state = env("GHOSTEX_EXPORT_MODAL_DEMO_STATE");
    let agents = if state == "noagents" {
        Vec::new()
    } else {
        vec![
            ExportTranscriptAgent {
                agent_id: "codex".to_string(),
                name: "Codex".to_string(),
            },
            ExportTranscriptAgent {
                agent_id: "claude".to_string(),
                name: "Claude".to_string(),
            },
            ExportTranscriptAgent {
                agent_id: "gemini".to_string(),
                name: "Gemini".to_string(),
            },
        ]
    };
    gpui_platform::application()
        .with_assets(assets::GhostexAssets)
        .run(move |cx: &mut App| {
            gpui_component::init(cx);
            let window_size = size(
                px(EXPORT_TRANSCRIPT_MODAL_WIDTH),
                px(EXPORT_TRANSCRIPT_MODAL_INITIAL_HEIGHT),
            );
            let bounds = cx
                .primary_display()
                .map(|display| Bounds::centered_at(display.bounds().center(), window_size))
                .unwrap_or_else(|| Bounds::new(point(px(240.0), px(160.0)), window_size));
            let options = WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                focus: true,
                show: true,
                is_resizable: false,
                is_minimizable: false,
                titlebar: None,
                ..Default::default()
            };
            let slot: Rc<RefCell<Option<WindowHandle<GpuiExportTranscriptModalWindow>>>> =
                Rc::new(RefCell::new(None));
            let host_slot = slot.clone();
            let fail = state == "failed";
            let host: ExportTranscriptModalHost =
                Rc::new(move |command, cx: &mut App| match command {
                    ExportTranscriptModalCommand::RunExport(include) => {
                        eprintln!(
                            "run export: commands={} patches={} reasoning={}",
                            include.commands, include.patches, include.reasoning
                        );
                        let slot = host_slot.clone();
                        cx.spawn(async move |cx| {
                            cx.background_executor().timer(Duration::from_secs(1)).await;
                            let handle = *slot.borrow();
                            if let Some(handle) = handle {
                                let _ = cx.update(|cx| deliver(handle, !fail, cx));
                            }
                        })
                        .detach();
                    }
                    ExportTranscriptModalCommand::StartConversation { agent_id } => {
                        eprintln!("handoff to {agent_id}");
                        cx.quit();
                    }
                    ExportTranscriptModalCommand::Cancel => {
                        eprintln!("cancel");
                        cx.quit();
                    }
                    ExportTranscriptModalCommand::Reveal => {
                        eprintln!("reveal");
                        cx.quit();
                    }
                });
            let config = ExportTranscriptModalConfig {
                agents,
                default_agent_id: Some("codex".to_string()),
                light,
                sidebar_theme: None,
                prefs_path: None,
                initial_mode,
            };
            let handle = cx
                .open_window(options, move |window, cx| {
                    window.set_window_title("");
                    window.activate_window();
                    cx.new(|cx| GpuiExportTranscriptModalWindow::new(config, host, window, cx))
                })
                .expect("open the demo window");
            *slot.borrow_mut() = Some(handle);
            if state == "done" || state == "failed" {
                let ok = state == "done";
                cx.defer(move |cx| deliver(handle, ok, cx));
            }
            cx.activate(true);
        });
}
