# GPUI Cross-Platform Refactor — Progress

Source plan: `docs/2026-07-03/gpui-cross-platform-plan.md`
Orchestration prompt: re-runnable; resume from the first incomplete package below.

## Package status

| Package | Title | Status |
| --- | --- | --- |
| P0 | Drag-ghost fix (workspace/Agents tab drags) | done (human on-screen verify pending) |
| P1a | libghostty-vt build + FFI wrapper | done |
| P1b | PTY + terminal model | done |
| P1c | TerminalElement rendering | in_progress |
| P1d | Input + IME | pending |
| P1e | Integration + parity checklist | pending |
| P2 | Windows bring-up (best-effort from macOS) | pending |
| P3 | Linux X11 bring-up (best-effort from macOS) | pending |

Phase 4 (browser OSR / native Wayland) is out of scope unless the user asks.

## Orchestrator gates (STOP AND ASK USER)

1. Before making the new terminal engine the default (end of P1e).
2. Before deleting the native terminal pipeline
   (terminal_surface_host/lifecycle/native_view + GpuiTerminalAppKitAdapter.m).
3. When P2/P3 hit blockers only real Windows/Linux hardware can resolve.

## Log

### 2026-07-03 — Session start (orchestrator)

- Fresh start: no prior progress file. Read plan, AGENTS.md, gpui/ARCHITECTURE.md.
- Pre-existing uncommitted changes in worktree (not ours): `gpui/build.rs`,
  `gpui/scripts/build-macos-app.sh`, `gpui/src/main.rs`, untracked
  `gpui/assets/titlebar/download.svg`, `gpui/native/macos/GpuiSparkleUpdater.m`,
  `gpui/scripts/codesign-gpui-app.sh`, plus android/iOS submodule changes.
  Workers must commit only their own changes, never these.
- Launching P0 worker.

### 2026-07-03 — P0 done (worker aac4bb7c217e84d63, commit `7fd75a856`)

**What was done:** `gpui/src/main.rs` only (+53/−21). `allows_cef_child_views()`
gate extended with a new `workspace_tab_drag_active` flag
(`CDXC:GPUIWorkspaceTabDragVisibility`); new helper
`agents_terminal_native_views_may_be_visible()` gates the four Agents terminal
sync sites (slot sync, parked-owner reattach, ready-handoff promotion, startup
Ready branch) so a workspace drag behaves like a mode-switch away from Agents:
mounted terminals hide-and-park (NSView hidden, Ghostty owner retained),
reattach/promotion pause until drag end. Command-pane terminal sync gated the
same way. Drag begin/finish flips the flag; two drop handlers now call
`finish_workspace_tab_drag_state` so every drop path restores views. Hide/show
only — no overlays, no destroy/recreate.

**Worker verification (trusted):** debug + release `cargo build` pass; the
committed tree in isolation passes `cargo check` (temp worktree); full
code-path trace against the proven Browser-drag and Agents mode-switch paths;
all drop handlers + root mouse-up cancel confirmed to end drag state.
Interactive drag could not be exercised (sandbox app never frontmost; worker
stopped rather than touch the user's running apps).

**Orchestrator verified:** commit `7fd75a856` exists on main, touches only
`gpui/src/main.rs` (+53/−21), pre-existing uncommitted changes undisturbed.

**Open issues / notes:**
- HUMAN VERIFY: on-screen ghost + drop bands over a running terminal, restore
  on drop and cancel, terminal focus after drag (needs prototype relaunch with
  new binary — worker deliberately did not relaunch).
- Pre-existing (not P0 regressions): debug-build first-render panic (gpui
  `debug_assert` "hover style already set", div.rs:758 — release unaffected;
  blocks debug-build UI testing); command-tab drags still don't hide terminals
  (only CEF) — trivially fixable by OR-ing `command_tab_drag_active` into the
  two terminal gates; sidebar CEF view never hidden during any drag type.
- Cross-pane drop of a Running tab re-mounts the surface (mount slot id embeds
  pane_id) — same as before; instant preservation would be a separate feature.
- One-time side effects during worker verification: Screen Recording
  permission dialog appeared; a sandboxed "Ghostex GPUI" window briefly showed.

**Next:** P1a — libghostty-vt build + FFI.

### 2026-07-03 — P1a done (worker abbb72feb6da03a22, commit `c0de8dc7c`)

**What was done:**
- `gpui/scripts/build-libghostty-vt.sh` (new): builds `libghostty-vt.a` via
  `zig build -Demit-lib-vt=true -Demit-xcframework=false -Doptimize=ReleaseSafe`.
  Zig selection: `GHOSTEX_ZIG` env → PATH zig if 0.15.x → mise installs.
  Replicates the xcrun-wrapper SDK redirect from the iOS vt script (Xcode 26
  libSystem TBD is arm64e-only).
- `gpui/build.rs`: `build_libghostty_vt()` builds into `$OUT_DIR`, links via
  `cargo:rustc-link-arg` (same mechanism as GhosttyKit); rerun-if-changed on
  ghostty tree. Staged surgically around unrelated uncommitted hunks.
- `gpui/src/ghostty_vt.rs` (new, ~750 lines): the single FFI choke point.
  Hand-written `ffi` decls (no bindgen) + safe layer: `VtTerminal`
  (new/feed/resize/reset), `VtRenderState` (update/size/dirty/clear_dirty/
  colors/cursor_viewport/rows), streaming `VtRows`→`VtRow`→`VtCells`→
  `VtCellRef` (graphemes, resolved fg/bg, style, wide/spacer).
- `gpui/src/bin/ghostty_vt_smoke.rs` (new) + Cargo.toml `[[bin]]`: smoke
  deliverable, run with `cargo run --bin ghostty-vt-smoke`.

**Worker verification (trusted):** full `cargo build` passes (no new
warnings); archive symbols confirmed via nm; smoke run demonstrated plain
text, SGR bold+color, truecolor, cursor-move partial dirty, two-level dirty
clear (update never clears; caller clears per-row AND global), and resize
reflow 20→10 cols. Cross-checked wrapper handle-reuse against
`ghostty/src/terminal/c/render.zig`.

**Orchestrator verified:** commit `c0de8dc7c` on main, 6 files +1035/−1,
matches the report.

**Handoff notes for P1b (carry into brief):**
- Locking: `VtRenderState::update(&mut self, &mut VtTerminal)` is the short
  lock point. Put `VtTerminal` behind a Mutex shared by PTY reader (feed) and
  render (update); row/cell readback happens after update OUTSIDE the
  terminal lock. Row/cell borrows can't outlive an update (lifetimes enforce).
- Dirty contract: caller clears per-row (`VtRow::clear_dirty`) AND global
  (`VtRenderState::clear_dirty`) — independent layers. Cursor movement
  dirties both departed and arrived rows.
- API quirks: pinned C-int enums; sized-struct ABI (`size` first) for
  `GhosttyStyle`/`GhosttyRenderStateColors`; `GHOSTTY_INVALID_VALUE` = "no
  explicit color" → `None`; skip wide-char spacer cells.
  `GhosttyTerminalOptions` has an upstream TODO re future ABI padding —
  re-check on vendor bumps.
- Not yet declared (add in `ghostty_vt.rs` only): terminal callbacks
  (`GHOSTTY_TERMINAL_OPT_WRITE_PTY`, title/bell), key/mouse encoders
  (`key.h`/`mouse.h`), scroll_viewport, `get_multi` batching.
- Toolchain: requires Zig 0.15.x (0.16 rejected by ghostty's requireZig);
  mise zig 0.15.2 satisfies locally; other machines need `GHOSTEX_ZIG`.

**Next:** P1b — PTY + terminal model.

### 2026-07-03 — P1b done (worker a14a7c4e67114086c, commit `d0ebf47a0`)

**What was done:**
- `gpui/src/ghostty_vt.rs` extended (FFI choke point stays single):
  `ghostty_terminal_set`, `GHOSTTY_TERMINAL_OPT_{USERDATA,WRITE_PTY,BELL,
  TITLE_CHANGED}`, callback trampolines via safe `VtHostCallbacks` (boxed
  FnMut, userdata owned by `VtTerminal`), `cursor_visible()`, SGR underline
  constants.
- `gpui/src/terminal_model.rs` (new, 501 lines, zero gpui deps):
  `TerminalModel::spawn(TerminalSpawnConfig, sink)`, `write_input`, `resize`
  (vt + TIOCSWINSZ), `snapshot()`, `exit_status()`, `kill()`.
  `TerminalEvent = Wakeup | Bell | TitleChanged | Exited(TerminalExit)`.
- Threading: three std threads (pty-read, wakeup notifier, child-wait).
  `VtTerminal` in `Arc<Mutex>`, held only for feed/resize/update; PTY writer
  own mutex; lock order terminal→writer (WRITE_PTY auto-replies fire inside
  feed). Readback outside the lock.
- Coalescing: AtomicBool pending + mpsc; false→true transition signals; the
  notifier sleeps 4ms, clears-before-delivering one Wakeup. Burst = 1 event.
- `TerminalSnapshot`: fully owned; cols, rows (dirty + `SnapshotCell` per
  column incl. spacers), global dirty, cursor + visibility, bg/fg/cursor
  colors, palette[256]. `snapshot()` consumes BOTH dirty layers.
- `gpui/src/bin/terminal_model_smoke.rs` + Cargo deps (`portable-pty 0.9`).
- `gpui/Cargo.lock`, one `mod` line in main.rs (staged surgically).

**Worker verification (trusted):** full `cargo build` passes; smoke run vs
`/bin/zsh` showed: PTY got initial size (stty 12 80), DSR auto-reply via
WRITE_PTY round-tripped, bell + title events, `write_input` echo, mid-session
resize 80x12→100x16 observed by stty, exit code 7 captured, dirty semantics
(Partial with clean untouched rows → Clean after drain), 3 wakeups total for
whole script. P1a smoke still passes.

**Orchestrator verified:** commit `d0ebf47a0` on main, 6 files +951/−11,
matches report.

**Handoff notes for P1c (carry into brief):**
- On `Wakeup` (fires on a model background thread — marshal to gpui
  foreground, e.g. cx.notify), call `snapshot()` once and cache; paint from
  cached snapshot only. `row.dirty` is a skip-hint relative to the PREVIOUS
  snapshot — dropping a snapshot drops that diff info; snapshot once per
  wakeup and keep the last frame.
- `dirty == Clean` → skip layout entirely; `Full` after resize.
- Cell fg/bg `None` = defaults → use snapshot foreground/background;
  `inverse` NOT pre-applied — renderer must swap; skip
  `VtCellWide::SpacerTail/SpacerHead` when drawing (indexes column-aligned).
- `Exited` and final `Wakeup` may arrive in either order.
- Still open (not P1b's): title readback string query (P1e), scroll_viewport/
  scrollback view, key/mouse encoders (P1d), cursor visual style/blink not in
  snapshot yet.

**Next:** P1c — TerminalElement rendering.
