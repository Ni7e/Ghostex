/*
CDXC:GPUITerminalGpuiEngine 2026-07-04:
P1e integration glue for the GPUI-composited terminal engine (libghostty-vt +
TerminalElement). This is the default terminal pipeline on every OS; on macOS
the shared `terminalGpuiEngineEnabled: false` setting is a temporary opt-out
back to the native GhosttyKit surface pipeline while that path is phased out.
Command-pane sessions always use this engine when their body slot is
rendered. This module owns
only the engine-side helpers (font registration/mapping, spawn-config
construction mirroring ghostty's macOS login-shell exec semantics, and the
per-session runtime record). Pane wiring lives in main.rs next to the native
paths it mirrors.
*/

use std::path::PathBuf;

use gpui::{App, Entity, FontWeight, SharedString, px};

use crate::AgentsTerminalRuntimeSessionId;
use crate::shared_settings::{SharedGpuiTerminalEngineSettings, SharedTerminalConfirmCloseSurface};
use crate::terminal_element::{TerminalFontConfig, TerminalView};
use crate::terminal_model::{TerminalConfirmCloseBehavior, TerminalSpawnConfig};

/// Initial grid guess before the first prepaint measures the real body; the
/// element resizes the terminal synchronously on first layout.
const INITIAL_GRID_COLS: u16 = 80;
const INITIAL_GRID_ROWS: u16 = 24;
const INITIAL_CELL_WIDTH_PX: u32 = 8;
const INITIAL_CELL_HEIGHT_PX: u32 = 17;

/// One live GPUI-engine terminal owned by the app shell. Dropping the record
/// drops the view entity (killing the child via the model) and the event
/// subscription together.
pub(crate) struct GpuiEngineTerminalRecord {
    pub(crate) view: Entity<TerminalView>,
    pub(crate) runtime_session_id: AgentsTerminalRuntimeSessionId,
    /// Ghostty `wait-after-command` semantics: exited contents stay on
    /// screen instead of auto-closing the tab.
    pub(crate) wait_after_command: bool,
    pub(crate) _subscription: gpui::Subscription,
}

/// Register the vendored JetBrains Mono Nerd Font faces the ghostty tree
/// already carries so the engine's default terminal font resolves without a
/// system install. Idempotent per process; call once at startup.
pub(crate) fn register_gpui_terminal_engine_fonts(cx: &App) {
    let fonts: Vec<std::borrow::Cow<'static, [u8]>> = vec![
        include_bytes!("../../ghostty/src/font/res/JetBrainsMonoNerdFont-Regular.ttf")
            .as_slice()
            .into(),
        include_bytes!("../../ghostty/src/font/res/JetBrainsMonoNerdFont-Bold.ttf")
            .as_slice()
            .into(),
        include_bytes!("../../ghostty/src/font/res/JetBrainsMonoNerdFont-Italic.ttf")
            .as_slice()
            .into(),
        include_bytes!("../../ghostty/src/font/res/JetBrainsMonoNerdFont-BoldItalic.ttf")
            .as_slice()
            .into(),
    ];
    if let Err(error) = cx.text_system().add_fonts(fonts) {
        eprintln!("gpui terminal engine font registration failed: {error}");
    }
}

/// Element font config from the shared terminal settings. The app default
/// family "JetBrains Mono" is not system-installed; the registered vendored
/// faces resolve as "JetBrainsMono Nerd Font" (the same embedded face the
/// native ghostty renderer uses), so the default maps to that family.
pub(crate) fn gpui_engine_terminal_font_config(
    settings: &SharedGpuiTerminalEngineSettings,
) -> TerminalFontConfig {
    let family: SharedString = if settings.font_family == "JetBrains Mono" {
        "JetBrainsMono Nerd Font".into()
    } else {
        settings.font_family.clone().into()
    };
    TerminalFontConfig {
        family,
        size: px(settings.font_size),
        weight: FontWeight(settings.font_weight),
    }
}

/// Close-confirm policy for the engine from the shared Ghostty-backed
/// `terminalConfirmCloseSurface` setting.
pub(crate) fn gpui_engine_confirm_close_behavior(
    settings: &SharedGpuiTerminalEngineSettings,
) -> TerminalConfirmCloseBehavior {
    match settings.confirm_close_surface {
        SharedTerminalConfirmCloseSurface::True => TerminalConfirmCloseBehavior::UnlessPrompt,
        SharedTerminalConfirmCloseSurface::False => TerminalConfirmCloseBehavior::Never,
        SharedTerminalConfirmCloseSurface::Always => TerminalConfirmCloseBehavior::Always,
    }
}

/// Build the spawn config for a GPUI-engine terminal from the same launch
/// payload fields the native Ghostty path consumes.
///
/// Process shape mirrors ghostty's macOS exec semantics (termio/Exec.zig):
/// `/usr/bin/login -flp <user>` for real login-shell behavior, then bash
/// `exec -l` into the payload command (or the user's shell when the payload
/// has none). An inaccessible cwd is ignored exactly like ghostty ignores
/// it. Env mirrors the native surfaces in this app: no ghostty terminfo is
/// bundled, so TERM stays xterm-256color with truecolor + TERM_PROGRAM set.
pub(crate) fn gpui_engine_terminal_spawn_config(
    working_directory: Option<String>,
    command: Option<String>,
    env_vars: Vec<(String, String)>,
    scrollback_limit_bytes: u64,
) -> TerminalSpawnConfig {
    let cwd = working_directory
        .map(PathBuf::from)
        .filter(|path| path.is_dir());

    let mut env = crate::terminal_environment::color_capable_terminal_env_vars(env_vars);
    env.retain(|(key, _)| !matches!(key.as_str(), "TERM" | "COLORTERM" | "TERM_PROGRAM"));
    env.extend([
        ("TERM".into(), "xterm-256color".into()),
        ("COLORTERM".into(), "truecolor".into()),
        ("TERM_PROGRAM".into(), "ghostty".into()),
    ]);
    // The Linux app removed WAYLAND_DISPLAY from its own environment to run
    // as an X11 client (see CDXC:GPUILinuxX11Backend in main.rs); terminal
    // children are not part of that constraint, so they get the inherited
    // value back and user-launched GUI apps keep running native Wayland.
    #[cfg(target_os = "linux")]
    if let Some(wayland_display) = crate::linux_inherited_wayland_display() {
        env.push(("WAYLAND_DISPLAY".into(), wayland_display.to_string()));
    }

    let (program, args) = spawn_invocation(command);

    TerminalSpawnConfig {
        program,
        args,
        env,
        cwd,
        cols: INITIAL_GRID_COLS,
        rows: INITIAL_GRID_ROWS,
        cell_width_px: INITIAL_CELL_WIDTH_PX,
        cell_height_px: INITIAL_CELL_HEIGHT_PX,
        max_scrollback: scrollback_limit_bytes as usize,
    }
}

#[cfg(not(target_os = "windows"))]
fn spawn_invocation(command: Option<String>) -> (String, Vec<String>) {
    let shell_command = command.unwrap_or_else(default_shell);
    login_shell_invocation(&shell_command)
}

/// Windows has no login(1)/`exec -l` semantics and no `$SHELL` contract:
/// ConPTY sessions default to PowerShell (present on every supported
/// Windows), launched interactively when the payload carries no command and
/// as `-Command` runner otherwise.
#[cfg(target_os = "windows")]
fn spawn_invocation(command: Option<String>) -> (String, Vec<String>) {
    match command {
        Some(command) => (
            default_shell(),
            vec!["-NoLogo".to_string(), "-Command".to_string(), command],
        ),
        None => (default_shell(), vec!["-NoLogo".to_string()]),
    }
}

#[cfg(not(target_os = "windows"))]
fn default_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|shell| !shell.is_empty())
        .unwrap_or_else(|| {
            if cfg!(target_os = "macos") {
                "/bin/zsh".to_string()
            } else {
                "/bin/sh".to_string()
            }
        })
}

#[cfg(target_os = "windows")]
fn default_shell() -> String {
    "powershell.exe".to_string()
}

#[cfg(target_os = "macos")]
fn login_shell_invocation(shell_command: &str) -> (String, Vec<String>) {
    // Mirrors ghostty's darwin path: login(1) provides getlogin()/SHELL and
    // hushlogin behavior, bash `exec -l` replaces itself with the real
    // command as a login shell. If USER is somehow absent, run the command
    // through the shell directly — the same degradation ghostty applies
    // when its passwd lookup fails.
    let Ok(user) = std::env::var("USER") else {
        return (
            default_shell(),
            vec!["-c".to_string(), shell_command.to_string()],
        );
    };
    let hushlogin = std::env::var("HOME")
        .map(|home| PathBuf::from(home).join(".hushlogin").exists())
        .unwrap_or(false);
    let mut args: Vec<String> = Vec::new();
    if hushlogin {
        args.push("-q".to_string());
    }
    args.extend([
        "-flp".to_string(),
        user,
        "/bin/bash".to_string(),
        "--noprofile".to_string(),
        "--norc".to_string(),
        "-c".to_string(),
        format!("exec -l {shell_command}"),
    ]);
    ("/usr/bin/login".to_string(), args)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn login_shell_invocation(shell_command: &str) -> (String, Vec<String>) {
    // Mirrors ghostty's non-darwin exec path (termio/Exec.zig): wrap the
    // shell command in `/bin/sh -c` so argument parsing stays with the shell
    // and NixOS-style /bin/sh environment setup applies. The command itself
    // defaults to $SHELL (default_shell), so a plain launch lands in the
    // user's own shell; login(1) semantics are a macOS-only expectation.
    (
        "/bin/sh".to_string(),
        vec!["-c".to_string(), shell_command.to_string()],
    )
}
