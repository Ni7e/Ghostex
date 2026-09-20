// Ghostex Help: the seven sample questions the Ask Ghostex view offers as starter chips, and the
// flow that turns a picked one into a Ghostex Help quick chat.

use gpui::Window;

use crate::app::helpers::*;
use crate::app::model::*;
use crate::*;

/// CDXC:Onboarding 2026-09-20 DECISION:
/// User: seven useful sample questions (for example making Claude control Codex, or matching the terminal width to the chat width); picking one starts a Ghostex Help chat.
/// The first row is "Ask anything about Ghostex", and every row shows a short summary label with the full question under it; the full question is what gets staged.
/// Picking a row never sends: the chat opens with the question as an editable draft and the user presses Enter (see createGhostexHelpChat in the sidebar runtime).
/// This supersedes the 2026-09-09 wording that the rows are a titlebar dropdown: the seven questions are starter chips in the Ask Ghostex view now, and their wording is unchanged.
pub(crate) struct GpuiTitlebarHelpQuestion {
    /// Titlebar icon asset for the row; each question gets its own so the
    /// menu does not repeat one glyph seven times.
    pub(crate) icon_path: &'static str,
    /// The short row label shown in the menu.
    pub(crate) label: &'static str,
    /// The full question sent as the chat's first message.
    pub(crate) question: &'static str,
}

pub(crate) const GPUI_TITLEBAR_HELP_QUESTIONS: &[GpuiTitlebarHelpQuestion] = &[
    GpuiTitlebarHelpQuestion {
        icon_path: "titlebar/robot.svg",
        label: "Let Claude Code control Codex",
        question: "How can I make Claude Code control Codex and other agents?",
    },
    GpuiTitlebarHelpQuestion {
        icon_path: "titlebar/arrows-diagonal-expand.svg",
        label: "Match terminal width to chat",
        question: "Make the terminal width match the chat width.",
    },
    // CDXC:Onboarding 2026-09-15 DECISION:
    // User: replace the Help sample "Make the sidebar narrower" (the leftover of "Sidebar on the right, narrower") with annotating Browser pages and Markdown files, not "notes".
    GpuiTitlebarHelpQuestion {
        icon_path: "titlebar/pencil.svg",
        label: "Annotate Browser pages and Markdown",
        question: "How do I annotate a Browser page or Markdown file?",
    },
    GpuiTitlebarHelpQuestion {
        icon_path: "titlebar/world.svg",
        label: "Use Ghostex from my phone",
        question: "How do I use Ghostex from my phone or another computer?",
    },
    GpuiTitlebarHelpQuestion {
        icon_path: "titlebar/clock.svg",
        label: "Run an agent on a schedule",
        question: "Set up an automation that runs an agent on a schedule.",
    },
    GpuiTitlebarHelpQuestion {
        icon_path: "titlebar/bell.svg",
        label: "Notify me when an agent finishes",
        question: "Play a sound and notify me when an agent finishes.",
    },
    GpuiTitlebarHelpQuestion {
        icon_path: "titlebar/layout-board-split.svg",
        label: "Kanban board and starting work",
        question: "What does the Kanban board do, and how do I start work on a card?",
    },
];

/// Menu index of the open-ended row; the sample questions follow it.
pub(crate) const GPUI_TITLEBAR_HELP_ASK_ANYTHING_INDEX: usize = 0;

pub(crate) const GPUI_TITLEBAR_HELP_ASK_ANYTHING_LABEL: &str = "Ask anything about Ghostex";
pub(crate) const GPUI_TITLEBAR_HELP_ASK_ANYTHING_ICON: &str = "titlebar/sparkles.svg";
pub(crate) const GPUI_TITLEBAR_HELP_ASK_ANYTHING_SUMMARY: &str =
    "An agent that knows the app answers, or changes the setting for you.";

/// The bundled skill every Help chat invokes in its first message; the skill
/// itself is installed by `ghostex guide install-skill`.
const GHOSTEX_HELP_SKILL_INVOCATION: &str = "$ghostex-help";

/// The draft staged in the new chat's composer for a Help menu row: the bare
/// skill mention plus a trailing space for the open-ended row (the user types
/// the question after it), otherwise the full sample question after the
/// mention. Nothing is submitted; the user edits and presses Enter.
pub(crate) fn gpui_titlebar_help_question_prompt(question_index: usize) -> Option<String> {
    if question_index == GPUI_TITLEBAR_HELP_ASK_ANYTHING_INDEX {
        return Some(format!("{GHOSTEX_HELP_SKILL_INVOCATION} "));
    }
    let question = GPUI_TITLEBAR_HELP_QUESTIONS
        .get(question_index - 1)?
        .question;
    Some(format!("{GHOSTEX_HELP_SKILL_INVOCATION} {question}"))
}

impl GhostexGpuiApp {
    /// The `openGhostexHelp` hotkey and the `⋯` menu's Ask Ghostex row both open the Ask Ghostex
    /// view, which is where the sample questions live now.
    pub(crate) fn show_gpui_titlebar_help_menu(
        &mut self,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) {
        self.open_view_tab(TitlebarMode::Ghostex(GhostexPage::Ask), window, cx);
    }

    /// A picked Help row: make sure the bundled `ghostex-help` skill is
    /// installed (a local folder copy, run off the UI thread), then ask the
    /// sidebar runtime to start a Quick agent chat whose first message invokes
    /// the skill with the question. The runtime owns quick-workspace creation,
    /// the default prompt agent, and focusing the new session.
    pub(crate) fn run_gpui_titlebar_help_question(
        &mut self,
        question_index: usize,
        cx: &mut gpui::Context<Self>,
    ) {
        let Some(prompt) = gpui_titlebar_help_question_prompt(question_index) else {
            return;
        };
        // Help chats live in one project rooted at the Ghostex config folder
        // (OS-specific, resolved by ghostex_paths), not in a fresh Quick
        // project per question.
        let project_dir = shared_settings::ghostex_storage_paths().config_dir.clone();
        let project_path = project_dir.to_string_lossy().to_string();
        let background = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            let (install_result, trust_warnings) = background
                .spawn(async move {
                    let install_result = gpui_install_bundled_ghostex_skill(
                        &["guide", "install-skill"],
                        "Ghostex Help",
                    );
                    let trust_warnings = gpui_trust_folder_for_agent_clis(&project_dir);
                    (install_result, trust_warnings)
                })
                .await;
            let _ = this.update(cx, |this, cx| {
                if let Err(message) = install_result {
                    this.dispatch_gpui_app_modal_toast(
                        "warning",
                        "Ghostex Help skill not installed",
                        message.as_str(),
                        cx,
                    );
                }
                if !trust_warnings.is_empty() {
                    this.dispatch_gpui_app_modal_toast(
                        "warning",
                        "Could not mark the Ghostex folder as trusted",
                        trust_warnings.join(" ").as_str(),
                        cx,
                    );
                }
                let dispatched = this.dispatch_gpui_os_integration_command_message(
                    serde_json::json!({
                        "action": "createGhostexHelpChat",
                        "projectPath": project_path,
                        "question": prompt,
                    }),
                    cx,
                );
                if !dispatched {
                    this.dispatch_gpui_app_modal_toast(
                        "warning",
                        "Ghostex Help unavailable",
                        "The sidebar is not ready to start a chat yet.",
                        cx,
                    );
                }
            });
        })
        .detach();
    }
}
