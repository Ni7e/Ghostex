//! Native GPUI Handoff / Export dialog, the desktop twin of the React
//! `ExportTranscriptModal` in packages/core-ui/export-transcript-result-modal.tsx.
//!
//! CDXC:TranscriptExport 2026-09-15 DECISION:
//! User: the React app modals do not fill their GPUI child window and need a hand-tuned window height, so they are being rebuilt in GPUI one at a time, starting with Handoff / Export. The native dialog must match the React one 1 to 1: the same layout, copy, colors, states and behaviour in both appearances. It measures its own first layout and sizes the window to it instead of trusting a constant.
//! SEE-ALSO: packages/core-ui/export-transcript-result-modal.tsx and packages/core-ui/styles/modals.css (the React twin and the `.gx-app-modal` / `.export-transcript-*` tokens mirrored below), apps/desktop/src/app/export_transcript_modal_lifecycle.rs (open, close, sidebar bridge), apps/desktop/src/bin/export_transcript_modal_demo.rs (standalone preview).
//!
//! This module depends only on gpui, gpui-component and serde_json so the demo binary can include it with `#[path]`; the app drives it through `ExportTranscriptModalHost`.
use gpui::prelude::FluentBuilder as _;
use gpui::{
    Animation, AnimationExt as _, AnyElement, App, Bounds, ClickEvent, Context, FocusHandle,
    FontWeight, Hsla, InteractiveElement as _, IntoElement, KeyDownEvent, MouseDownEvent,
    ParentElement as _, Pixels, Render, Rgba, StatefulInteractiveElement as _, Styled as _,
    Transformation, Window, anchored, deferred, div, point, px, radians, rgb, size, svg,
};
use gpui_component::tooltip::Tooltip;
use gpui_component::{h_flex, v_flex};
use std::cell::Cell;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::Duration;

/// The React dialog opens on the Rename Session width (`APP_MODAL_HOST_EXPORT_TRANSCRIPT_RESULT_WINDOW_WIDTH`).
pub(crate) const EXPORT_TRANSCRIPT_MODAL_WIDTH: f32 = 570.0;
/// First-frame height only. The window is resized to the measured layout as soon as the first prepaint reports it.
pub(crate) const EXPORT_TRANSCRIPT_MODAL_INITIAL_HEIGHT: f32 = 520.0;

const WINDOW_PADDING: f32 = 24.0;
const SECTION_GAP: f32 = 20.0;
const FOOTER_BUTTON_HEIGHT: f32 = 32.0;
const CONTROL_HEIGHT: f32 = 32.0;
const RADIUS_CONTROL: f32 = 8.0;
const RADIUS_SECTION: f32 = 12.0;
const UI_FONT: &str = ".SystemUIFont";
const MONO_FONT: &str = if cfg!(target_os = "macos") {
    ".AppleSystemUIFontMonospaced"
} else if cfg!(target_os = "windows") {
    "Consolas"
} else {
    "monospace"
};

const ICON_USER_SHARE: &str = "modals/export-transcript/user-share.svg";
const ICON_MARKDOWN: &str = "modals/export-transcript/markdown.svg";
const ICON_CHECK_CARD: &str = "modals/export-transcript/check-card.svg";
const ICON_CHECK_BUTTON: &str = "modals/export-transcript/check-button.svg";
const ICON_COPY: &str = "modals/export-transcript/copy.svg";
const ICON_FOLDER_SEARCH: &str = "modals/export-transcript/folder-search.svg";
const ICON_SELECTOR: &str = "modals/export-transcript/selector.svg";
const ICON_LOADER: &str = "modals/export-transcript/loader-2.svg";
const ICON_CIRCLE_CHECK: &str = "modals/export-transcript/circle-check-filled.svg";

const TITLE: &str = "Handoff / Export";
const DESCRIPTION: &str = "Ghostex writes this conversation to a Markdown file. Pick what to do with it and what to include.";
const HANDOFF_CARD_TITLE: &str = "Handoff to an agent";
const HANDOFF_CARD_DESCRIPTION: &str = "Start a new conversation with the handover attached.";
const EXPORT_CARD_TITLE: &str = "Export to Markdown";
const EXPORT_CARD_DESCRIPTION: &str = "Save the conversation as a file and copy its path.";
const CONTINUE_WITH: &str = "Continue with";
const SELECT_AGENT_PLACEHOLDER: &str = "Select agent";
const EXPORT_HINT: &str = "The file is saved in the Ghostex exports folder.";
const INCLUDE: &str = "Include";
const SAVED_AS_MARKDOWN: &str = "Saved as Markdown";
const REVEAL_IN_FINDER: &str = "Reveal in Finder";
const EXPORT_FAILED: &str = "The transcript export failed.";

/// What the user wants to do with the written file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ExportTranscriptMode {
    Handoff,
    Export,
}

/// The include-toggles; user and agent messages are never optional, so only
/// the three optional record families are here. Defaults mirror the daemon's
/// historical selection: commands and patches in, reasoning out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ExportTranscriptIncludeOptions {
    pub(crate) commands: bool,
    pub(crate) patches: bool,
    pub(crate) reasoning: bool,
}

impl Default for ExportTranscriptIncludeOptions {
    fn default() -> Self {
        Self {
            commands: true,
            patches: true,
            reasoning: false,
        }
    }
}

/// The user's last mode and include combination. A per-client UI preference,
/// so repeat exports reopen exactly as they were left without involving gxserver.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct ExportTranscriptModalPrefs {
    pub(crate) mode: Option<ExportTranscriptMode>,
    pub(crate) include: ExportTranscriptIncludeOptions,
}

pub(crate) fn load_export_transcript_modal_prefs(path: &Path) -> ExportTranscriptModalPrefs {
    let Some(value) = std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
    else {
        return ExportTranscriptModalPrefs::default();
    };
    let defaults = ExportTranscriptIncludeOptions::default();
    let flag = |key: &str, default: bool| {
        value
            .get(key)
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(default)
    };
    ExportTranscriptModalPrefs {
        mode: match value.get("mode").and_then(serde_json::Value::as_str) {
            Some("export") => Some(ExportTranscriptMode::Export),
            Some("handoff") => Some(ExportTranscriptMode::Handoff),
            _ => None,
        },
        include: ExportTranscriptIncludeOptions {
            commands: flag("includeCommands", defaults.commands),
            patches: flag("includePatches", defaults.patches),
            reasoning: flag("includeReasoning", defaults.reasoning),
        },
    }
}

pub(crate) fn persist_export_transcript_modal_prefs(
    path: &Path,
    prefs: ExportTranscriptModalPrefs,
) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let payload = serde_json::json!({
        "mode": match prefs.mode {
            Some(ExportTranscriptMode::Export) => "export",
            _ => "handoff",
        },
        "includeCommands": prefs.include.commands,
        "includePatches": prefs.include.patches,
        "includeReasoning": prefs.include.reasoning,
    });
    let _ = std::fs::write(path, payload.to_string());
}

/// A configured agent that can take the handoff (the React modal only offers
/// agents whose HUD button carries a launch command).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ExportTranscriptAgent {
    pub(crate) agent_id: String,
    pub(crate) name: String,
}

/// The dialog's lifecycle, owned by the host: choose what to include, watch
/// the daemon write the file, then follow up on the result. `Failed` keeps the
/// dialog open with the daemon's message and a way back to the export.
#[derive(Clone, Debug)]
pub(crate) enum ExportTranscriptStage {
    Options,
    Exporting,
    Done {
        agent_id: Option<String>,
        can_reveal: bool,
        path: String,
    },
    Failed {
        message: String,
    },
}

/// What the dialog asks its host to do. The dialog removes its own window
/// before sending any command other than `RunExport`.
pub(crate) enum ExportTranscriptModalCommand {
    RunExport(ExportTranscriptIncludeOptions),
    StartConversation { agent_id: String },
    Cancel,
    Reveal,
}

pub(crate) type ExportTranscriptModalHost = Rc<dyn Fn(ExportTranscriptModalCommand, &mut App)>;

pub(crate) struct ExportTranscriptModalConfig {
    pub(crate) agents: Vec<ExportTranscriptAgent>,
    /// The exported session's own agent, preselected so "handoff to the same agent" is one click away.
    pub(crate) default_agent_id: Option<String>,
    pub(crate) light: bool,
    /// The `sidebarTheme` setting; tinted dark themes recolor the foreground and muted text.
    pub(crate) sidebar_theme: Option<String>,
    pub(crate) prefs_path: Option<PathBuf>,
    /// Overrides the remembered mode on open; the demo uses it to show one branch.
    pub(crate) initial_mode: Option<ExportTranscriptMode>,
}

/// The `.gx-app-modal` tokens plus the shadcn theme tokens the export dialog
/// reads, resolved for one appearance. Dark values come from modals.css and
/// shadcn.css, light values from modals-light.css.
#[derive(Clone, Copy)]
struct Palette {
    surface: Rgba,
    panel: Rgba,
    raised: Rgba,
    raised_hover: Rgba,
    hairline: Rgba,
    foreground: Rgba,
    muted: Rgba,
    /// `--background`: the switch thumb color.
    background: Rgba,
    primary: Rgba,
    primary_foreground: Rgba,
    /// `bg-input/90`: the unchecked switch track.
    switch_off: Rgba,
    focus_border: Rgba,
    destructive: Rgba,
    success: Rgba,
    accent: Rgba,
    menu_background: Rgba,
    menu_border: Rgba,
}

fn rgba(hex: u32, alpha: f32) -> Rgba {
    let mut color = rgb(hex);
    color.a = alpha;
    color
}

/// CSS `color-mix(in srgb, a <weight_a>, b)`: premultiplied interpolation.
fn css_mix(a: Rgba, weight_a: f32, b: Rgba) -> Rgba {
    let weight_b = 1.0 - weight_a;
    let alpha = a.a * weight_a + b.a * weight_b;
    if alpha <= 0.0 {
        return Rgba {
            r: 0.0,
            g: 0.0,
            b: 0.0,
            a: 0.0,
        };
    }
    let channel = |ca: f32, cb: f32| (ca * a.a * weight_a + cb * b.a * weight_b) / alpha;
    Rgba {
        r: channel(a.r, b.r),
        g: channel(a.g, b.g),
        b: channel(a.b, b.b),
        a: alpha,
    }
}

/// The `--app-foreground`, `--app-muted` and `--app-background` triple of each
/// dark sidebar theme in packages/core-ui/styles/theme.css.
fn dark_theme_text_colors(sidebar_theme: Option<&str>) -> (u32, u32, u32) {
    match sidebar_theme {
        Some("dark-1") => (0xc8cdd5, 0x747b85, 0x191919),
        Some("dark-green") => (0xd8e3db, 0x8ea196, 0x0b120d),
        Some("dark-blue") => (0xdce6f8, 0x90a0b8, 0x0c1117),
        Some("dark-red") => (0xf1dde1, 0xb6939b, 0x140c0e),
        Some("dark-pink") => (0xf4deeb, 0xb99bad, 0x160d13),
        Some("dark-orange") => (0xf0dfcf, 0xbaa08c, 0x171008),
        _ => (0xc8cdd5, 0x747b85, 0x0e0e0e),
    }
}

impl Palette {
    fn resolve(light: bool, sidebar_theme: Option<&str>) -> Self {
        if light {
            Self {
                surface: rgb(0xffffff),
                panel: rgb(0xf5f5f5),
                raised: rgb(0xf0f0f0),
                raised_hover: rgb(0xe5e5e5),
                hairline: rgba(0x000000, 0.14),
                foreground: rgb(0x262626),
                muted: rgb(0x626262),
                background: rgb(0xffffff),
                primary: rgb(0x262626),
                primary_foreground: rgb(0xffffff),
                switch_off: rgba(0x000000, 0.16 * 0.9),
                focus_border: rgb(0x525252),
                destructive: rgb(0xb91c1c),
                success: rgb(0x15803d),
                accent: rgb(0xe9e9e9),
                menu_background: rgb(0xffffff),
                menu_border: rgba(0x000000, 0.16),
            }
        } else {
            let (foreground, muted, background) = dark_theme_text_colors(sidebar_theme);
            Self {
                surface: rgb(0x0e0e0e),
                panel: rgb(0x161616),
                raised: rgb(0x1d1d1d),
                raised_hover: rgb(0x232323),
                hairline: rgba(0xffffff, 0.08),
                foreground: rgb(foreground),
                muted: rgb(muted),
                background: rgb(background),
                primary: rgb(0xe5e5e5),
                primary_foreground: rgb(0x171717),
                switch_off: rgba(0xffffff, 0.15 * 0.9),
                focus_border: rgb(0xffffff),
                destructive: rgb(0xf87171),
                success: rgb(0x4ade80),
                accent: rgb(0x262626),
                menu_background: rgb(0x161616),
                menu_border: rgba(0xffffff, 0.08),
            }
        }
    }

    fn card_selected_background(&self) -> Rgba {
        css_mix(self.foreground, 0.06, self.raised)
    }

    fn card_selected_border(&self) -> Rgba {
        css_mix(self.foreground, 0.45, self.hairline)
    }

    fn chip_background(&self) -> Rgba {
        rgba_of(self.foreground, 0.10)
    }

    fn menu_selected_background(&self) -> Rgba {
        rgba_of(self.foreground, 0.12)
    }

    fn primary_hover(&self) -> Rgba {
        css_mix(self.primary, 0.88, rgb(0xffffff))
    }
}

fn rgba_of(color: Rgba, alpha: f32) -> Rgba {
    Rgba { a: alpha, ..color }
}

fn hsla(color: Rgba) -> Hsla {
    color.into()
}

fn transparent() -> Hsla {
    gpui::transparent_black()
}

fn icon(path: &'static str, icon_size: f32, color: Rgba) -> gpui::Svg {
    svg().path(path).size(px(icon_size)).text_color(hsla(color))
}

pub(crate) struct GpuiExportTranscriptModalWindow {
    host: ExportTranscriptModalHost,
    palette: Palette,
    prefs_path: Option<PathBuf>,
    agents: Vec<ExportTranscriptAgent>,
    default_agent_id: Option<String>,
    mode: ExportTranscriptMode,
    include: ExportTranscriptIncludeOptions,
    selected_agent_id: Option<String>,
    stage: ExportTranscriptStage,
    /// Set by a Handoff run so the done stage starts the conversation instead of showing the path.
    handoff_requested: bool,
    copied: bool,
    copied_generation: u64,
    agent_menu_open: bool,
    agent_menu_highlight: Option<usize>,
    agent_trigger_bounds: Rc<Cell<Option<Bounds<Pixels>>>>,
    /// The window height the first prepaint asked for; later prepaints only grow the window.
    requested_height: Rc<Cell<Option<f32>>>,
    focus_handle: FocusHandle,
}

impl GpuiExportTranscriptModalWindow {
    pub(crate) fn new(
        config: ExportTranscriptModalConfig,
        host: ExportTranscriptModalHost,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let prefs = config
            .prefs_path
            .as_deref()
            .map(load_export_transcript_modal_prefs)
            .unwrap_or_default();
        let focus_handle = cx.focus_handle();
        focus_handle.focus(window, cx);
        Self {
            host,
            palette: Palette::resolve(config.light, config.sidebar_theme.as_deref()),
            prefs_path: config.prefs_path,
            agents: config.agents,
            default_agent_id: config.default_agent_id,
            mode: config
                .initial_mode
                .or(prefs.mode)
                .unwrap_or(ExportTranscriptMode::Handoff),
            include: prefs.include,
            selected_agent_id: None,
            stage: ExportTranscriptStage::Options,
            handoff_requested: false,
            copied: false,
            copied_generation: 0,
            agent_menu_open: false,
            agent_menu_highlight: None,
            agent_trigger_bounds: Rc::new(Cell::new(None)),
            requested_height: Rc::new(Cell::new(None)),
            focus_handle,
        }
    }

    /// A fresh agent list from the host (the HUD read that finishes after open).
    pub(crate) fn set_agents(
        &mut self,
        agents: Vec<ExportTranscriptAgent>,
        cx: &mut Context<Self>,
    ) {
        if self.agents == agents {
            return;
        }
        self.agents = agents;
        if self.agents.is_empty() {
            self.agent_menu_open = false;
        }
        cx.notify();
    }

    /// The sidebar runtime's answer to `RunExport`.
    pub(crate) fn receive_result(
        &mut self,
        ok: bool,
        path: Option<String>,
        can_reveal: bool,
        agent_id: Option<String>,
        error: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let handoff_requested = std::mem::take(&mut self.handoff_requested);
        match (ok, path) {
            (true, Some(path)) => {
                self.stage = ExportTranscriptStage::Done {
                    agent_id,
                    can_reveal,
                    path,
                };
                if handoff_requested && self.effective_mode() == ExportTranscriptMode::Handoff {
                    if let Some(agent) = self.effective_agent() {
                        let agent_id = agent.agent_id.clone();
                        self.close_window_and_send(
                            ExportTranscriptModalCommand::StartConversation { agent_id },
                            window,
                            cx,
                        );
                        return;
                    }
                }
            }
            _ => {
                self.stage = ExportTranscriptStage::Failed {
                    message: error
                        .map(|message| message.trim().to_string())
                        .filter(|message| !message.is_empty())
                        .unwrap_or_else(|| EXPORT_FAILED.to_string()),
                };
            }
        }
        cx.notify();
    }

    fn effective_mode(&self) -> ExportTranscriptMode {
        if self.agents.is_empty() {
            ExportTranscriptMode::Export
        } else {
            self.mode
        }
    }

    fn effective_agent(&self) -> Option<&ExportTranscriptAgent> {
        let done_agent_id = match &self.stage {
            ExportTranscriptStage::Done { agent_id, .. } => agent_id.as_deref(),
            _ => None,
        };
        self.selected_agent_id
            .as_deref()
            .and_then(|id| self.agents.iter().find(|agent| agent.agent_id == id))
            .or_else(|| {
                done_agent_id
                    .or(self.default_agent_id.as_deref())
                    .and_then(|id| self.agents.iter().find(|agent| agent.agent_id == id))
            })
            .or_else(|| self.agents.first())
    }

    fn is_done(&self) -> bool {
        matches!(self.stage, ExportTranscriptStage::Done { .. })
    }

    fn is_exporting(&self) -> bool {
        matches!(self.stage, ExportTranscriptStage::Exporting)
    }

    fn show_result(&self) -> bool {
        self.is_done() && self.effective_mode() == ExportTranscriptMode::Export
    }

    fn busy(&self) -> bool {
        self.is_exporting()
            || (self.is_done() && self.effective_mode() == ExportTranscriptMode::Handoff)
    }

    fn controls_disabled(&self) -> bool {
        self.busy() || self.is_done()
    }

    fn can_run(&self) -> bool {
        !self.is_done()
            && !self.is_exporting()
            && (self.effective_mode() == ExportTranscriptMode::Export
                || self.effective_agent().is_some())
    }

    fn primary_label(&self) -> String {
        if self.is_exporting() {
            return "Exporting…".to_string();
        }
        if self.is_done() && self.effective_mode() == ExportTranscriptMode::Handoff {
            return "Starting…".to_string();
        }
        if matches!(self.stage, ExportTranscriptStage::Failed { .. }) {
            return "Try Again".to_string();
        }
        match self.effective_mode() {
            ExportTranscriptMode::Handoff => match self.effective_agent() {
                Some(agent) => format!("Handoff to {}", agent.name),
                None => "Handoff".to_string(),
            },
            ExportTranscriptMode::Export => "Export".to_string(),
        }
    }

    fn persist_prefs(&self) {
        if let Some(path) = &self.prefs_path {
            persist_export_transcript_modal_prefs(
                path,
                ExportTranscriptModalPrefs {
                    mode: Some(self.mode),
                    include: self.include,
                },
            );
        }
    }

    fn choose_mode(&mut self, mode: ExportTranscriptMode, cx: &mut Context<Self>) {
        if self.controls_disabled() {
            return;
        }
        self.mode = mode;
        self.agent_menu_open = false;
        self.persist_prefs();
        cx.notify();
    }

    fn toggle_include(&mut self, index: usize, cx: &mut Context<Self>) {
        if self.controls_disabled() {
            return;
        }
        match index {
            0 => self.include.commands = !self.include.commands,
            1 => self.include.patches = !self.include.patches,
            _ => self.include.reasoning = !self.include.reasoning,
        }
        self.persist_prefs();
        cx.notify();
    }

    fn run(&mut self, cx: &mut Context<Self>) {
        if !self.can_run() {
            return;
        }
        self.agent_menu_open = false;
        self.handoff_requested = self.effective_mode() == ExportTranscriptMode::Handoff;
        self.stage = ExportTranscriptStage::Exporting;
        cx.notify();
        (self.host)(ExportTranscriptModalCommand::RunExport(self.include), cx);
    }

    fn copy_path(&mut self, cx: &mut Context<Self>) {
        let ExportTranscriptStage::Done { path, .. } = &self.stage else {
            return;
        };
        cx.write_to_clipboard(gpui::ClipboardItem::new_string(path.clone()));
        self.copied = true;
        self.copied_generation = self.copied_generation.wrapping_add(1);
        let generation = self.copied_generation;
        cx.notify();
        cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(Duration::from_millis(1_500))
                .await;
            let _ = this.update(cx, |this, cx| {
                if this.copied_generation == generation {
                    this.copied = false;
                    cx.notify();
                }
            });
        })
        .detach();
    }

    fn close_window_and_send(
        &mut self,
        command: ExportTranscriptModalCommand,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        window.remove_window();
        (self.host)(command, cx);
    }

    fn cancel(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.close_window_and_send(ExportTranscriptModalCommand::Cancel, window, cx);
    }

    fn reveal(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.close_window_and_send(ExportTranscriptModalCommand::Reveal, window, cx);
    }

    fn toggle_agent_menu(&mut self, cx: &mut Context<Self>) {
        if self.controls_disabled() || self.agents.is_empty() {
            return;
        }
        self.agent_menu_open = !self.agent_menu_open;
        self.agent_menu_highlight = self.agent_menu_open.then(|| {
            self.effective_agent()
                .and_then(|agent| self.agents.iter().position(|candidate| candidate == agent))
                .unwrap_or(0)
        });
        cx.notify();
    }

    fn choose_agent(&mut self, index: usize, cx: &mut Context<Self>) {
        if let Some(agent) = self.agents.get(index) {
            self.selected_agent_id = Some(agent.agent_id.clone());
        }
        self.agent_menu_open = false;
        cx.notify();
    }

    fn move_agent_highlight(&mut self, delta: isize, cx: &mut Context<Self>) {
        if self.agents.is_empty() {
            return;
        }
        let count = self.agents.len() as isize;
        let current = self.agent_menu_highlight.unwrap_or(0) as isize;
        let next = (current + delta).rem_euclid(count) as usize;
        self.agent_menu_highlight = Some(next);
        cx.notify();
    }

    fn on_key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        match event.keystroke.key.as_str() {
            "escape" => {
                if self.agent_menu_open {
                    self.agent_menu_open = false;
                    cx.notify();
                } else {
                    self.cancel(window, cx);
                }
            }
            "enter" => {
                if event.is_held {
                    return;
                }
                if self.agent_menu_open {
                    if let Some(index) = self.agent_menu_highlight {
                        self.choose_agent(index, cx);
                    }
                } else if self.show_result() {
                    self.copy_path(cx);
                } else {
                    self.run(cx);
                }
            }
            "up" if self.agent_menu_open => self.move_agent_highlight(-1, cx),
            "down" if self.agent_menu_open => self.move_agent_highlight(1, cx),
            _ => return,
        }
        cx.stop_propagation();
    }

    fn render_header(&self) -> AnyElement {
        let p = self.palette;
        v_flex()
            .gap(px(6.0))
            .child(div().text_size(px(16.0)).line_height(px(20.8)).child(TITLE))
            .child(
                div()
                    .text_size(px(13.0))
                    .line_height(px(20.15))
                    .text_color(hsla(p.muted))
                    .child(DESCRIPTION),
            )
            .into_any_element()
    }

    fn render_mode_card(
        &self,
        index: usize,
        mode: ExportTranscriptMode,
        icon_path: &'static str,
        title: &'static str,
        description: &'static str,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = self.palette;
        let selected = self.effective_mode() == mode;
        let disabled = self.controls_disabled();
        h_flex()
            .id(("export-transcript-mode-card", index))
            .relative()
            .flex_1()
            .flex_basis(px(0.0))
            .min_w_0()
            .items_start()
            .gap(px(10.0))
            .pt(px(10.0))
            .pr(px(12.0))
            .pb(px(11.0))
            .pl(px(10.0))
            .rounded(px(RADIUS_CONTROL))
            .border_1()
            .border_color(hsla(if selected {
                p.card_selected_border()
            } else {
                p.hairline
            }))
            .bg(hsla(if selected {
                p.card_selected_background()
            } else {
                p.raised
            }))
            .when(disabled, |this| this.opacity(0.6).cursor_default())
            .when(!disabled, |this| {
                this.cursor_pointer()
                    .hover(move |this| this.bg(hsla(p.raised_hover)))
                    .on_click(cx.listener(move |this, _: &ClickEvent, _window, cx| {
                        this.choose_mode(mode, cx);
                    }))
            })
            .child(
                div()
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .size(px(28.0))
                    .rounded(px(8.0))
                    .bg(hsla(if selected {
                        p.primary
                    } else {
                        p.chip_background()
                    }))
                    .child(icon(
                        icon_path,
                        16.0,
                        if selected {
                            p.primary_foreground
                        } else {
                            p.muted
                        },
                    )),
            )
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .gap(px(2.0))
                    .pr(px(16.0))
                    .child(
                        div()
                            .text_size(px(13.0))
                            .line_height(px(16.9))
                            .font_weight(FontWeight::MEDIUM)
                            .child(title),
                    )
                    .child(
                        div()
                            .text_size(px(12.0))
                            .line_height(px(17.4))
                            .text_color(hsla(p.muted))
                            .child(description),
                    ),
            )
            .when(selected, |this| {
                this.child(div().absolute().top(px(10.0)).right(px(10.0)).child(icon(
                    ICON_CHECK_CARD,
                    14.0,
                    p.foreground,
                )))
            })
            .into_any_element()
    }

    fn render_mode_grid(&self, cx: &mut Context<Self>) -> AnyElement {
        // CSS grid stretches both cards to the taller one; gpui-component's row helper centers items.
        let mut grid = h_flex().w_full().items_stretch().gap(px(8.0));
        if !self.agents.is_empty() {
            grid = grid.child(self.render_mode_card(
                0,
                ExportTranscriptMode::Handoff,
                ICON_USER_SHARE,
                HANDOFF_CARD_TITLE,
                HANDOFF_CARD_DESCRIPTION,
                cx,
            ));
        }
        grid.child(self.render_mode_card(
            1,
            ExportTranscriptMode::Export,
            ICON_MARKDOWN,
            EXPORT_CARD_TITLE,
            EXPORT_CARD_DESCRIPTION,
            cx,
        ))
        .into_any_element()
    }

    /// Both branches share one height so the fitted window never clips when the mode changes.
    fn render_agent_row(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = self.palette;
        if self.effective_mode() == ExportTranscriptMode::Export {
            return h_flex()
                .min_h(px(CONTROL_HEIGHT))
                .items_center()
                .child(
                    div()
                        .text_size(px(12.0))
                        .line_height(px(17.4))
                        .text_color(hsla(p.muted))
                        .child(EXPORT_HINT),
                )
                .into_any_element();
        }
        let disabled = self.controls_disabled();
        let open = self.agent_menu_open;
        let trigger_bounds = self.agent_trigger_bounds.clone();
        let value = self.effective_agent().map(|agent| agent.name.clone());
        h_flex()
            .min_h(px(CONTROL_HEIGHT))
            .items_center()
            .gap(px(10.0))
            .on_children_prepainted(move |bounds, _window, _cx| {
                trigger_bounds.set(bounds.get(1).copied());
            })
            .child(
                div()
                    .flex_shrink_0()
                    .text_size(px(12.0))
                    .line_height(px(17.14))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(hsla(p.muted))
                    .child(CONTINUE_WITH),
            )
            .child(
                h_flex()
                    .id("export-transcript-agent-select")
                    .flex_1()
                    .min_w_0()
                    .h(px(CONTROL_HEIGHT))
                    .px(px(12.0))
                    .gap(px(6.0))
                    .items_center()
                    .justify_between()
                    .rounded(px(RADIUS_CONTROL))
                    .border_1()
                    .border_color(hsla(if open { p.focus_border } else { p.hairline }))
                    .bg(hsla(p.raised))
                    .text_size(px(14.0))
                    .line_height(px(20.0))
                    .when(disabled, |this| this.opacity(0.5).cursor_default())
                    .when(!disabled, |this| {
                        this.cursor_pointer()
                            .when(!open, |this| {
                                this.hover(move |this| this.bg(hsla(p.raised_hover)))
                            })
                            .on_click(cx.listener(|this, _: &ClickEvent, _window, cx| {
                                this.toggle_agent_menu(cx);
                            }))
                    })
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .overflow_hidden()
                            .whitespace_nowrap()
                            .text_ellipsis()
                            .when(value.is_none(), |this| this.text_color(hsla(p.muted)))
                            .child(value.unwrap_or_else(|| SELECT_AGENT_PLACEHOLDER.to_string())),
                    )
                    .child(
                        div()
                            .flex_shrink_0()
                            .child(icon(ICON_SELECTOR, 16.0, p.muted)),
                    ),
            )
            .into_any_element()
    }

    fn render_agent_menu(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        if !self.agent_menu_open {
            return None;
        }
        let trigger = self.agent_trigger_bounds.get()?;
        let p = self.palette;
        let selected_index = self
            .effective_agent()
            .and_then(|agent| self.agents.iter().position(|candidate| candidate == agent));
        let highlight = self.agent_menu_highlight;
        let position = point(
            trigger.origin.x,
            trigger.origin.y + trigger.size.height + px(4.0),
        );
        let rows = self.agents.iter().enumerate().map(|(index, agent)| {
            let selected = selected_index == Some(index);
            let highlighted = highlight == Some(index);
            h_flex()
                .id(("export-transcript-agent-item", index))
                .w_full()
                .min_h(px(28.0))
                .px(px(8.0))
                .py(px(6.0))
                .gap(px(8.0))
                .items_center()
                .rounded(px(6.0))
                .text_size(px(14.0))
                .line_height(px(20.0))
                .text_color(hsla(p.foreground))
                .cursor_default()
                .when(selected, |this| this.bg(hsla(p.menu_selected_background())))
                .when(!selected && highlighted, |this| this.bg(hsla(p.accent)))
                .when(!selected, |this| {
                    this.hover(move |this| this.bg(hsla(p.accent)))
                })
                .on_click(cx.listener(move |this, _: &ClickEvent, _window, cx| {
                    this.choose_agent(index, cx);
                }))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .overflow_hidden()
                        .whitespace_nowrap()
                        .text_ellipsis()
                        .child(agent.name.clone()),
                )
        });
        Some(
            deferred(
                anchored()
                    .position(position)
                    .snap_to_window_with_margin(px(8.0))
                    .child(
                        v_flex()
                            .id("export-transcript-agent-menu")
                            .occlude()
                            .w(trigger.size.width)
                            .p(px(4.0))
                            .rounded(px(RADIUS_CONTROL))
                            .border_1()
                            .border_color(hsla(p.menu_border))
                            .bg(hsla(p.menu_background))
                            .shadow_lg()
                            .on_mouse_down_out(cx.listener(
                                move |this, event: &MouseDownEvent, _window, cx| {
                                    // A mouse-down on the trigger is the trigger's own toggle-close.
                                    if trigger.contains(&event.position) {
                                        return;
                                    }
                                    this.agent_menu_open = false;
                                    cx.notify();
                                },
                            ))
                            .children(rows),
                    ),
            )
            .with_priority(1)
            .into_any_element(),
        )
    }

    fn render_switch(&self, checked: bool, disabled: bool) -> AnyElement {
        let p = self.palette;
        div()
            .flex_shrink_0()
            .w(px(32.0))
            .h(px(20.0))
            .rounded(px(6.0))
            .border_2()
            .border_color(if checked {
                hsla(p.primary)
            } else {
                transparent()
            })
            .bg(hsla(if checked { p.primary } else { p.switch_off }))
            .when(disabled, |this| this.opacity(0.5))
            .child(
                div()
                    .size(px(16.0))
                    .ml(px(if checked { 12.0 } else { 0.0 }))
                    .rounded(px(4.0))
                    .bg(hsla(p.background))
                    .shadow_sm(),
            )
            .into_any_element()
    }

    fn render_include(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let p = self.palette;
        let disabled = self.controls_disabled();
        const ROWS: [(&str, &str); 3] = [
            (
                "Commands & output",
                "Terminal commands the agent ran, with the tail of their output.",
            ),
            ("File changes", "The patches the agent applied to files."),
            ("Reasoning", "The agent's own reasoning sections."),
        ];
        let values = [
            self.include.commands,
            self.include.patches,
            self.include.reasoning,
        ];
        let mut elements = vec![
            div()
                .mt(px(4.0))
                .text_size(px(12.0))
                .line_height(px(17.14))
                .font_weight(FontWeight::MEDIUM)
                .text_color(hsla(p.muted))
                .child(INCLUDE)
                .into_any_element(),
            v_flex()
                .w_full()
                .rounded(px(RADIUS_SECTION))
                .border_1()
                .border_color(hsla(p.hairline))
                .bg(hsla(p.panel))
                .overflow_hidden()
                .children(
                    ROWS.iter()
                        .enumerate()
                        .map(|(index, (label, description))| {
                            h_flex()
                                .id(("export-transcript-toggle-row", index))
                                .w_full()
                                .items_center()
                                .justify_between()
                                .gap(px(16.0))
                                .px(px(12.0))
                                .py(px(9.0))
                                .when(index > 0, |this| {
                                    this.border_t_1().border_color(hsla(p.hairline))
                                })
                                .when(!disabled, |this| {
                                    this.cursor_pointer().on_click(cx.listener(
                                        move |this, _: &ClickEvent, _window, cx| {
                                            this.toggle_include(index, cx);
                                        },
                                    ))
                                })
                                .child(
                                    v_flex()
                                        .min_w_0()
                                        .gap(px(2.0))
                                        .child(
                                            div()
                                                .text_size(px(13.0))
                                                .line_height(px(18.57))
                                                .font_weight(FontWeight::MEDIUM)
                                                .child(*label),
                                        )
                                        .child(
                                            div()
                                                .text_size(px(12.0))
                                                .line_height(px(17.14))
                                                .text_color(hsla(p.muted))
                                                .child(*description),
                                        ),
                                )
                                .child(self.render_switch(values[index], disabled))
                        }),
                )
                .into_any_element(),
        ];
        if let ExportTranscriptStage::Failed { message } = &self.stage {
            elements.push(self.render_error(message.clone()));
        }
        elements
    }

    fn render_error(&self, message: String) -> AnyElement {
        div()
            .text_size(px(12.0))
            .line_height(px(18.0))
            .text_color(hsla(self.palette.destructive))
            .child(message)
            .into_any_element()
    }

    fn render_result(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = self.palette;
        let (path, can_reveal) = match &self.stage {
            ExportTranscriptStage::Done {
                path, can_reveal, ..
            } => (path.clone(), *can_reveal),
            _ => (String::new(), false),
        };
        v_flex()
            .w_full()
            .mt(px(4.0))
            .gap(px(10.0))
            .p(px(12.0))
            .rounded(px(RADIUS_SECTION))
            .border_1()
            .border_color(hsla(p.hairline))
            .bg(hsla(p.panel))
            .child(
                h_flex()
                    .items_center()
                    .gap(px(8.0))
                    .text_size(px(13.0))
                    .line_height(px(18.57))
                    .font_weight(FontWeight::MEDIUM)
                    .child(icon(ICON_CIRCLE_CHECK, 16.0, p.success))
                    .child(SAVED_AS_MARKDOWN),
            )
            .child(
                h_flex()
                    .w_full()
                    .items_center()
                    .gap(px(6.0))
                    .pt(px(8.0))
                    .pr(px(8.0))
                    .pb(px(8.0))
                    .pl(px(12.0))
                    .rounded(px(RADIUS_CONTROL))
                    .border_1()
                    .border_color(hsla(p.hairline))
                    .bg(hsla(p.raised))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .font_family(MONO_FONT)
                            .text_size(px(12.0))
                            .line_height(px(17.4))
                            .child(path),
                    )
                    .when(can_reveal, |this| {
                        this.child(
                            div()
                                .id("export-transcript-reveal")
                                .flex_shrink_0()
                                .flex()
                                .items_center()
                                .justify_center()
                                .size(px(32.0))
                                .rounded(px(RADIUS_CONTROL))
                                .cursor_pointer()
                                .hover(move |this| this.bg(hsla(p.accent)))
                                .tooltip(|window, cx| {
                                    Tooltip::new(REVEAL_IN_FINDER).build(window, cx)
                                })
                                .on_click(cx.listener(|this, _: &ClickEvent, window, cx| {
                                    this.reveal(window, cx);
                                }))
                                .child(icon(ICON_FOLDER_SEARCH, 15.0, p.foreground)),
                        )
                    }),
            )
            .into_any_element()
    }

    fn render_body(&self, cx: &mut Context<Self>) -> AnyElement {
        let mut body = v_flex()
            .w_full()
            .gap(px(10.0))
            .child(self.render_mode_grid(cx))
            .child(self.render_agent_row(cx));
        if self.show_result() {
            body = body.child(self.render_result(cx));
        } else {
            body = body.children(self.render_include(cx));
        }
        body.into_any_element()
    }

    fn render_action_button(
        &self,
        id: &'static str,
        label: String,
        leading: Option<AnyElement>,
        primary: bool,
        disabled: bool,
        on_click: impl Fn(&mut Self, &mut Window, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = self.palette;
        h_flex()
            .id(id)
            .flex_1()
            .flex_basis(px(0.0))
            .min_w_0()
            .h(px(FOOTER_BUTTON_HEIGHT))
            .px(px(12.0))
            .gap(px(6.0))
            .items_center()
            .justify_center()
            .rounded(px(RADIUS_CONTROL))
            .border_1()
            .border_color(hsla(if primary { p.primary } else { p.hairline }))
            .bg(if primary {
                hsla(p.primary)
            } else {
                transparent()
            })
            .text_size(px(14.0))
            .line_height(px(20.0))
            .text_color(hsla(if primary {
                p.primary_foreground
            } else {
                p.foreground
            }))
            .whitespace_nowrap()
            .when(disabled, |this| this.opacity(0.5).cursor_default())
            .when(!disabled, |this| {
                this.cursor_pointer()
                    .hover(move |this| {
                        this.bg(hsla(if primary {
                            p.primary_hover()
                        } else {
                            p.raised_hover
                        }))
                    })
                    .on_click(cx.listener(move |this, _: &ClickEvent, window, cx| {
                        on_click(this, window, cx);
                    }))
            })
            .children(leading)
            .child(label)
            .into_any_element()
    }

    fn render_footer(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = self.palette;
        let show_result = self.show_result();
        let left = self.render_action_button(
            "export-transcript-cancel",
            if show_result { "Done" } else { "Cancel" }.to_string(),
            None,
            false,
            false,
            |this, window, cx| this.cancel(window, cx),
            cx,
        );
        let right = if show_result {
            let copied = self.copied;
            self.render_action_button(
                "export-transcript-copy",
                if copied { "Path Copied" } else { "Copy Path" }.to_string(),
                Some(
                    icon(
                        if copied { ICON_CHECK_BUTTON } else { ICON_COPY },
                        15.0,
                        p.primary_foreground,
                    )
                    .into_any_element(),
                ),
                true,
                false,
                |this, _window, cx| this.copy_path(cx),
                cx,
            )
        } else {
            let spinner = self.busy().then(|| {
                icon(ICON_LOADER, 15.0, p.primary_foreground)
                    .with_animation(
                        "export-transcript-spinner",
                        Animation::new(Duration::from_millis(900)).repeat(),
                        |svg, delta| {
                            svg.with_transformation(Transformation::rotate(radians(
                                delta * std::f32::consts::TAU,
                            )))
                        },
                    )
                    .into_any_element()
            });
            self.render_action_button(
                "export-transcript-primary",
                self.primary_label(),
                spinner,
                true,
                !self.can_run(),
                |this, _window, cx| this.run(cx),
                cx,
            )
        };
        h_flex()
            .w_full()
            .gap(px(8.0))
            .child(left)
            .child(right)
            .into_any_element()
    }
}

impl Render for GpuiExportTranscriptModalWindow {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = self.palette;
        let requested_height = self.requested_height.clone();
        let menu = self.render_agent_menu(cx);
        div()
            .id("ghostex-gpui-export-transcript-modal")
            .size_full()
            .overflow_hidden()
            .bg(hsla(p.surface))
            .font_family(UI_FONT)
            .text_size(px(14.0))
            .line_height(px(20.0))
            .text_color(hsla(p.foreground))
            .track_focus(&self.focus_handle)
            .on_key_down(cx.listener(Self::on_key_down))
            .child(
                v_flex()
                    .size_full()
                    .p(px(WINDOW_PADDING))
                    .gap(px(SECTION_GAP))
                    .child(
                        v_flex()
                            .flex_1()
                            .w_full()
                            .gap(px(SECTION_GAP))
                            /*
                            The child window opens at a first-frame estimate. The first prepaint knows the real
                            header and body heights, so the window is resized to fit them exactly; later prepaints
                            only grow it (a failure message under the toggles) and never shrink it, so the saved-file
                            state keeps the frame the options layout established, like the React dialog.
                            */
                            .on_children_prepainted(move |bounds, window, cx| {
                                if bounds.len() < 2 {
                                    return;
                                }
                                let content: f32 = bounds
                                    .iter()
                                    .map(|bounds| f32::from(bounds.size.height))
                                    .sum();
                                let needed = (content
                                    + WINDOW_PADDING * 2.0
                                    + SECTION_GAP * 2.0
                                    + FOOTER_BUTTON_HEIGHT)
                                    .round();
                                let current = f32::from(window.viewport_size().height).round();
                                let first = requested_height.get().is_none();
                                if !first && needed <= current {
                                    return;
                                }
                                if (needed - current).abs() < 1.0
                                    || requested_height.get() == Some(needed)
                                {
                                    if first {
                                        requested_height.set(Some(needed));
                                    }
                                    return;
                                }
                                requested_height.set(Some(needed));
                                let handle = window.window_handle();
                                let width = window.viewport_size().width;
                                cx.defer(move |cx| {
                                    let _ = handle.update(cx, |_root, window, _cx| {
                                        window.resize(size(width, px(needed)));
                                    });
                                });
                            })
                            .child(self.render_header())
                            .child(self.render_body(cx)),
                    )
                    .child(self.render_footer(cx)),
            )
            .children(menu)
    }
}
