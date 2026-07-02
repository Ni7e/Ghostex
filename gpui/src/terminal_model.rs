#![allow(dead_code)]

/*
CDXC:GPUITerminalModel 2026-07-03:
P1b portable terminal model: PTY (portable-pty: openpty on Unix, ConPTY on
Windows) → libghostty-vt → owned per-frame snapshots. Pure model layer with
no gpui types; consumers (P1c element, P1e integration) observe it through
TerminalEventSink and pull TerminalSnapshot values.

Threading (three plain std threads per model, all exit when the child dies):
- pty-read: blocking PTY reads, feeds bytes into the shared VtTerminal under
  a SHORT lock (feed only), then requests a wakeup.
- wakeup: coalesces wakeup requests. First bytes after a delivered wakeup arm
  a ~4ms window; every burst inside the window folds into ONE Wakeup event
  (idea from Zed's terminal wakeup batching; implementation is our own).
  Correctness: the reader feeds BEFORE requesting, and the notifier clears
  the pending flag BEFORE delivering, so bytes always land either in the
  snapshot taken for the current wakeup or in a subsequent wakeup — never
  silently dropped.
- child-wait: reaps the child and delivers Exited exactly once. Exited and
  the final Wakeup race by nature; consumers must accept either order.

Locking: the VtTerminal mutex is only ever held for feed/resize and for
VtRenderState::update inside snapshot(). Row/cell readback happens after
update outside the terminal lock, per the ghostty_vt contract. The PTY writer
has its own mutex; lock order is terminal → writer only (write_pty
auto-replies fire inside feed), never the reverse, so no cycle exists.

Dirty contract: snapshot() consumes BOTH dirty layers (per-row + global)
after copying rows out, so each snapshot's `dirty`/row `dirty` flags describe
changes since the previous snapshot. Rows always carry full content; dirty
flags are a skip-work hint for the renderer, not a completeness marker.
*/

use std::{
    io::{Read, Write},
    path::PathBuf,
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::Duration,
};

use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};

use crate::ghostty_vt::{
    self, VtCellWide, VtDirty, VtError, VtHostCallbacks, VtRenderState, VtTerminal, ffi,
};

/// Wakeup coalescing window: bytes arriving within this span of the first
/// unnotified feed produce a single Wakeup.
const WAKEUP_COALESCE_WINDOW: Duration = Duration::from_millis(4);

/// PTY read buffer size per read call.
const PTY_READ_BUFFER_LEN: usize = 64 * 1024;

pub type Rgb = ffi::GhosttyColorRgb;

/// How to spawn the shell process behind a terminal model.
#[derive(Clone, Debug)]
pub struct TerminalSpawnConfig {
    pub program: String,
    pub args: Vec<String>,
    /// Extra environment on top of the inherited one.
    pub env: Vec<(String, String)>,
    pub cwd: Option<PathBuf>,
    pub cols: u16,
    pub rows: u16,
    pub cell_width_px: u32,
    pub cell_height_px: u32,
    pub max_scrollback: usize,
}

/// Model → consumer notifications. Delivered on model-owned background
/// threads; sinks must be cheap and thread-safe (e.g. post to an executor).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TerminalEvent {
    /// New output was folded into the terminal; take a snapshot when ready.
    Wakeup,
    /// BEL received.
    Bell,
    /// Terminal title changed (OSC 0/2); query lives with P1e.
    TitleChanged,
    /// Child process exited. Terminal contents stay readable afterwards.
    Exited(TerminalExit),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TerminalExit {
    /// Process exit code; `None` when waiting on the child itself failed.
    pub code: Option<u32>,
    pub success: bool,
}

pub type TerminalEventSink = Arc<dyn Fn(TerminalEvent) + Send + Sync>;

/// Underline style of a snapshot cell (SGR 4 / 4:n).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnderlineStyle {
    None,
    Single,
    Double,
    Curly,
    Dotted,
    Dashed,
}

/// One rendered cell, fully owned. `None` colors mean "use the snapshot
/// default"; spacer-width cells carry no drawable content but keep the cells
/// vector index-aligned with columns.
#[derive(Clone, Debug)]
pub struct SnapshotCell {
    /// Base character; space for empty cells.
    pub base: char,
    /// Combining characters beyond the base, if any (rare).
    pub combining: Option<Box<str>>,
    pub width: VtCellWide,
    pub fg: Option<Rgb>,
    pub bg: Option<Rgb>,
    pub bold: bool,
    pub italic: bool,
    pub faint: bool,
    pub blink: bool,
    pub inverse: bool,
    pub invisible: bool,
    pub strikethrough: bool,
    pub overline: bool,
    pub underline: UnderlineStyle,
    /// Explicit underline color; `None` means underline uses the cell fg.
    pub underline_color: Option<Rgb>,
}

#[derive(Clone, Debug)]
pub struct SnapshotRow {
    /// Changed since the previous snapshot. Content is always present; this
    /// is a hint that lets the renderer keep cached layout for clean rows.
    pub dirty: bool,
    /// One entry per column, spacers included.
    pub cells: Vec<SnapshotCell>,
}

impl SnapshotRow {
    /// Row text with spacers skipped and trailing whitespace trimmed.
    /// Convenience for logging/smoke output, not a render path.
    pub fn text(&self) -> String {
        let mut text = String::new();
        for cell in &self.cells {
            match cell.width {
                VtCellWide::SpacerTail | VtCellWide::SpacerHead => continue,
                VtCellWide::Narrow | VtCellWide::Wide => {}
            }
            text.push(cell.base);
            if let Some(combining) = &cell.combining {
                text.push_str(combining);
            }
        }
        text.truncate(text.trim_end().len());
        text
    }
}

/// Immutable, fully owned view of one frame. Taking a snapshot consumes the
/// terminal's dirty state, so `dirty`/per-row flags are relative to the
/// previous snapshot; the paint path never touches the terminal lock.
#[derive(Clone, Debug)]
pub struct TerminalSnapshot {
    pub cols: u16,
    /// Viewport rows, top to bottom. Length equals the row count.
    pub rows: Vec<SnapshotRow>,
    /// Global dirty level as of this frame ([`VtDirty::Clean`] means nothing
    /// changed since the previous snapshot).
    pub dirty: VtDirty,
    /// Cursor position in viewport cells, if inside the viewport.
    pub cursor: Option<(u16, u16)>,
    /// DECTCEM cursor visibility.
    pub cursor_visible: bool,
    pub background: Rgb,
    pub foreground: Rgb,
    /// Explicit cursor color, if the terminal set one.
    pub cursor_color: Option<Rgb>,
    /// Active 256-color palette (for palette-indexed consumers).
    pub palette: [Rgb; 256],
}

/// A live terminal: spawned child on a PTY, libghostty-vt state, background
/// pump threads, and snapshot access. Owned by the UI-side consumer.
pub struct TerminalModel {
    terminal: Arc<Mutex<VtTerminal>>,
    render_state: VtRenderState,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    exit: Arc<OnceLock<TerminalExit>>,
    size: (u16, u16),
    cell_size_px: (u32, u32),
}

impl TerminalModel {
    /// Spawn the configured process on a fresh PTY and start the pump
    /// threads. Events flow to `events` from background threads immediately.
    pub fn spawn(config: TerminalSpawnConfig, events: TerminalEventSink) -> anyhow::Result<Self> {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(pty_size(
            config.cols,
            config.rows,
            config.cell_width_px,
            config.cell_height_px,
        ))?;

        let mut command = CommandBuilder::new(&config.program);
        command.args(&config.args);
        if let Some(cwd) = &config.cwd {
            command.cwd(cwd);
        }
        for (key, value) in &config.env {
            command.env(key, value);
        }

        let child = pair.slave.spawn_command(command)?;
        // Drop our slave handle so the master sees EOF once the child exits.
        drop(pair.slave);

        let killer = child.clone_killer();
        let mut reader = pair.master.try_clone_reader()?;
        let writer: Arc<Mutex<Box<dyn Write + Send>>> =
            Arc::new(Mutex::new(pair.master.take_writer()?));

        let mut vt = VtTerminal::new(config.cols, config.rows, config.max_scrollback)?;
        {
            // Terminal → host hooks. write_pty fires inside feed() on the
            // pty-read thread while the terminal lock is held; it only takes
            // the writer lock (terminal → writer order, never reversed).
            // Auto-replies are tiny, so writing under that lock is fine.
            let reply_writer = Arc::clone(&writer);
            let bell_events = Arc::clone(&events);
            let title_events = Arc::clone(&events);
            vt.set_host_callbacks(VtHostCallbacks {
                write_pty: Some(Box::new(move |bytes| {
                    let mut writer = reply_writer.lock().expect("pty writer lock poisoned");
                    // A dying PTY makes these writes fail; the exit path
                    // already reports that, so replies are best-effort.
                    let _ = writer.write_all(bytes).and_then(|()| writer.flush());
                })),
                bell: Some(Box::new(move || bell_events(TerminalEvent::Bell))),
                title_changed: Some(Box::new(move || {
                    title_events(TerminalEvent::TitleChanged)
                })),
            })?;
        }
        let terminal = Arc::new(Mutex::new(vt));
        let exit: Arc<OnceLock<TerminalExit>> = Arc::new(OnceLock::new());

        // Wakeup coalescing: `pending` is true while a wakeup is owed but
        // not yet delivered; only the false→true transition signals the
        // notifier, so a whole burst costs one channel send + one event.
        let pending = Arc::new(AtomicBool::new(false));
        let (wakeup_tx, wakeup_rx) = mpsc::channel::<()>();

        {
            let pending = Arc::clone(&pending);
            let events = Arc::clone(&events);
            thread::Builder::new()
                .name("ghostex-terminal-wakeup".into())
                .spawn(move || {
                    while wakeup_rx.recv().is_ok() {
                        thread::sleep(WAKEUP_COALESCE_WINDOW);
                        // Clear BEFORE delivering: bytes fed after the clear
                        // re-arm the window instead of being folded into a
                        // wakeup the consumer may already be handling.
                        pending.store(false, Ordering::SeqCst);
                        events(TerminalEvent::Wakeup);
                    }
                })?;
        }

        {
            let terminal = Arc::clone(&terminal);
            let pending = Arc::clone(&pending);
            thread::Builder::new()
                .name("ghostex-terminal-pty-read".into())
                .spawn(move || {
                    let mut buffer = vec![0u8; PTY_READ_BUFFER_LEN];
                    loop {
                        match reader.read(&mut buffer) {
                            // EOF, or EIO once the child side is gone.
                            Ok(0) | Err(_) => break,
                            Ok(len) => {
                                terminal
                                    .lock()
                                    .expect("terminal lock poisoned")
                                    .feed(&buffer[..len]);
                                if pending
                                    .compare_exchange(
                                        false,
                                        true,
                                        Ordering::SeqCst,
                                        Ordering::SeqCst,
                                    )
                                    .is_ok()
                                {
                                    let _ = wakeup_tx.send(());
                                }
                            }
                        }
                    }
                    // wakeup_tx drops here; the notifier drains any pending
                    // signal (delivering the final wakeup) and exits.
                })?;
        }

        {
            let events = Arc::clone(&events);
            let exit = Arc::clone(&exit);
            let mut child = child;
            thread::Builder::new()
                .name("ghostex-terminal-child-wait".into())
                .spawn(move || {
                    let status = match child.wait() {
                        Ok(status) => TerminalExit {
                            code: Some(status.exit_code()),
                            success: status.success(),
                        },
                        Err(_) => TerminalExit {
                            code: None,
                            success: false,
                        },
                    };
                    let _ = exit.set(status);
                    events(TerminalEvent::Exited(status));
                })?;
        }

        Ok(Self {
            terminal,
            render_state: VtRenderState::new()?,
            writer,
            master: pair.master,
            killer,
            exit,
            size: (config.cols, config.rows),
            cell_size_px: (config.cell_width_px, config.cell_height_px),
        })
    }

    /// Write input bytes (encoded key/mouse/paste data) to the PTY.
    pub fn write_input(&self, bytes: &[u8]) -> std::io::Result<()> {
        let mut writer = self.writer.lock().expect("pty writer lock poisoned");
        writer.write_all(bytes)?;
        writer.flush()
    }

    /// Propagate a cell-grid size change to the vt terminal and the PTY
    /// (TIOCSWINSZ + SIGWINCH via portable-pty). The vt terminal resizes
    /// first so redraw output triggered by SIGWINCH meets the new grid.
    pub fn resize(
        &mut self,
        cols: u16,
        rows: u16,
        cell_width_px: u32,
        cell_height_px: u32,
    ) -> anyhow::Result<()> {
        if (cols, rows) == self.size && (cell_width_px, cell_height_px) == self.cell_size_px {
            return Ok(());
        }
        self.terminal
            .lock()
            .expect("terminal lock poisoned")
            .resize(cols, rows, cell_width_px, cell_height_px)?;
        self.master
            .resize(pty_size(cols, rows, cell_width_px, cell_height_px))?;
        self.size = (cols, rows);
        self.cell_size_px = (cell_width_px, cell_height_px);
        Ok(())
    }

    /// Grid size in cells as `(cols, rows)`.
    pub fn size(&self) -> (u16, u16) {
        self.size
    }

    /// Exit status once the child has exited.
    pub fn exit_status(&self) -> Option<TerminalExit> {
        self.exit.get().copied()
    }

    /// Terminate the child process (SIGHUP/kill semantics per platform).
    pub fn kill(&mut self) -> std::io::Result<()> {
        self.killer.kill()
    }

    /// Take an owned frame snapshot. Holds the terminal lock only for the
    /// render-state update; row/cell copy-out and dirty clearing run outside
    /// it. Consumes both dirty layers per the ghostty_vt contract.
    pub fn snapshot(&mut self) -> Result<TerminalSnapshot, VtError> {
        {
            let mut terminal = self.terminal.lock().expect("terminal lock poisoned");
            self.render_state.update(&mut terminal)?;
        }

        let (cols, rows) = self.render_state.size()?;
        let dirty = self.render_state.dirty()?;
        let colors = self.render_state.colors()?;
        let cursor = self.render_state.cursor_viewport()?;
        let cursor_visible = self.render_state.cursor_visible()?;

        let mut snapshot_rows: Vec<SnapshotRow> = Vec::with_capacity(rows as usize);
        let mut codepoints: Vec<u32> = Vec::new();
        let mut row_iter = self.render_state.rows()?;
        while let Some(mut row) = row_iter.next_row() {
            let row_dirty = row.is_dirty()?;
            let mut cells: Vec<SnapshotCell> = Vec::with_capacity(cols as usize);
            {
                let mut cell_iter = row.cells()?;
                while let Some(cell) = cell_iter.next_cell() {
                    codepoints.clear();
                    cell.append_codepoints(&mut codepoints)?;
                    let mut chars = codepoints.iter().map(|codepoint| {
                        char::from_u32(*codepoint).unwrap_or(char::REPLACEMENT_CHARACTER)
                    });
                    let base = chars.next().unwrap_or(' ');
                    let combining: Option<Box<str>> = if codepoints.len() > 1 {
                        Some(chars.collect::<String>().into_boxed_str())
                    } else {
                        None
                    };
                    let style = cell.style()?;
                    cells.push(SnapshotCell {
                        base,
                        combining,
                        width: cell.wide()?,
                        fg: cell.fg_color()?,
                        bg: cell.bg_color()?,
                        bold: style.bold,
                        italic: style.italic,
                        faint: style.faint,
                        blink: style.blink,
                        inverse: style.inverse,
                        invisible: style.invisible,
                        strikethrough: style.strikethrough,
                        overline: style.overline,
                        underline: underline_style(style.underline),
                        underline_color: ghostty_vt::style_color_rgb(
                            &style.underline_color,
                            &colors.palette,
                        ),
                    });
                }
            }
            row.clear_dirty()?;
            snapshot_rows.push(SnapshotRow {
                dirty: row_dirty,
                cells,
            });
        }
        drop(row_iter);
        self.render_state.clear_dirty()?;

        Ok(TerminalSnapshot {
            cols,
            rows: snapshot_rows,
            dirty,
            cursor,
            cursor_visible,
            background: colors.background,
            foreground: colors.foreground,
            cursor_color: colors.cursor_has_value.then_some(colors.cursor),
            palette: colors.palette,
        })
    }
}

impl Drop for TerminalModel {
    fn drop(&mut self) {
        // Best-effort teardown: killing the child EOFs the PTY, which winds
        // down all three pump threads.
        let _ = self.killer.kill();
    }
}

fn pty_size(cols: u16, rows: u16, cell_width_px: u32, cell_height_px: u32) -> PtySize {
    PtySize {
        rows,
        cols,
        pixel_width: (u32::from(cols) * cell_width_px).min(u32::from(u16::MAX)) as u16,
        pixel_height: (u32::from(rows) * cell_height_px).min(u32::from(u16::MAX)) as u16,
    }
}

fn underline_style(raw: ffi::GhosttySgrUnderline) -> UnderlineStyle {
    match raw {
        ffi::GHOSTTY_SGR_UNDERLINE_SINGLE => UnderlineStyle::Single,
        ffi::GHOSTTY_SGR_UNDERLINE_DOUBLE => UnderlineStyle::Double,
        ffi::GHOSTTY_SGR_UNDERLINE_CURLY => UnderlineStyle::Curly,
        ffi::GHOSTTY_SGR_UNDERLINE_DOTTED => UnderlineStyle::Dotted,
        ffi::GHOSTTY_SGR_UNDERLINE_DASHED => UnderlineStyle::Dashed,
        _ => UnderlineStyle::None,
    }
}
