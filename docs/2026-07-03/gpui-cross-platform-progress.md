# GPUI Cross-Platform Refactor — Progress

Source plan: `docs/2026-07-03/gpui-cross-platform-plan.md`
Orchestration prompt: re-runnable; resume from the first incomplete package below.

## Package status

| Package | Title | Status |
| --- | --- | --- |
| P0 | Drag-ghost fix (workspace/Agents tab drags) | done (human on-screen verify pending) |
| P1a | libghostty-vt build + FFI wrapper | done |
| P1b | PTY + terminal model | done |
| P1c | TerminalElement rendering | done |
| P1d | Input + IME | done (committed as `10d160423`; user-verify pending) |
| P1e | Integration + parity checklist | done (`7ef7b9dbe`; user-verify pending; default stays native) |
| P2 | Windows bring-up (best-effort from macOS) | done (`9ce99fae2`, `702b28460`; needs-device-verify) |
| P3 | Linux X11 bring-up (best-effort from macOS) | done (`061601aa8`, `fcb4aef4c`; needs-device-verify; Linux cargo check passed from macOS) |
| F1 | Fix: can't type in engine terminals in the integrated app | done (`7dc838639`; user-verified ✅) |
| F2 | Fix: typed keys never reached the engine terminal search input | done (`6dad0425c`; user-verify pending) |
| F3 | Fix: keyboard tab/pane switch (cmd+1..9 / next-prev session) leaves engine terminal untypeable | done (`d775d33cb`; user-verify pending) |
| F4 | Fix: command-pane terminals render blank in the gpui app + UX/logic parity with the macOS app command pane | done (`13ccd08ab`; blank likely stale-binary — user-verify pending; gated grid diagnostics added) |

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

### 2026-07-03 — P1c done (worker aad434ffdb8503942, commit `6aaffe848`)

Note: first P1c launch attempt aborted instantly on a Fable usage limit (no
work done); relaunched after the user freed capacity.

**What was done:**
- `gpui/src/terminal_element.rs` (new, ~880 lines,
  `CDXC:GPUITerminalElement`): `TerminalView` entity (owns `TerminalModel`,
  latest snapshot, shaped-row cache) + `TerminalElement` (gpui::Element) +
  `TerminalFontConfig`/`TerminalCursorShape`/`TerminalSelection` inputs.
- prepaint: cell metrics via `resolve_font` + `advance('m')`; line height =
  ascent + |descent| (gpui/font-kit descent is NEGATIVE — commented); grid
  from bounds; drives `TerminalModel::resize` + immediate snapshot on grid
  change; rebuilds only dirty-invalidated rows; lays out selection spans,
  cursor (inverted-glyph overlay for Block), marked text.
- paint: bg quad → per-row merged bg spans (floor/ceil, no seams) →
  selection tint (fg @ 25% alpha) → shaped runs (`shape_line` with
  force_width = cell width) → overlines → marked text → cursor
  (Block/Bar/Underline), inside a content mask.
- Caching: wakeup → unbounded channel → cx.spawn pump → ONE snapshot per
  wakeup; dirty rows drop cached RowLayout; global Clean reuses all;
  metrics/grid change clears all.
- Batching: runs break on style change, column discontinuity, and after
  every Wide cell (avoids a latent Zed-style wide-glyph misplacement bug).
  inverse swapped in renderer; faint = 50% blend to bg; invisible skips
  glyphs; curly → wavy underline, double/dotted/dashed → plain (TODO P1e).
- `gpui/src/bin/terminal_element_demo.rs` (new, temp — delete at P1e):
  registers ghostty's vendored JetBrainsMono NF TTFs, runs zsh through an
  SGR/wide-char showcase then interactive zsh. Run:
  `cargo run --release --bin terminal-element-demo`
  (`GHOSTEX_GPUI_VT_DEMO_CMD` overrides). Debug builds hit the known
  pre-existing gpui hover debug_assert — use release.

**Worker verification (trusted):** full `cargo build` passes, zero new
warnings; ran demo and screenshotted via ScreenCaptureKit — visually
verified bold/italic/underline/curly/strike/inverse/faint, 16-color +
truecolor ramp, CJK+emoji wide chars column-aligned, `ls -lh` alignment,
live zsh prompt with block cursor; live window resize reflowed correctly.
Idle CPU ~0.5%, RSS ~85MB. NOT exercised (no live driver yet): selection /
marked-text drawing, Bar/Underline cursor shapes.

**Orchestrator verified:** commit `6aaffe848` on main, 4 files +1006,
matches report.

**Handoff notes for P1d (carry into brief):**
- Input attaches in `TerminalElement::prepaint` (hitbox + mouse listeners,
  CefElement-style) + a `FocusHandle` on `TerminalView` (none exists yet —
  nothing focusable). Keys → vt key encoding → `model().write_input()`.
- Public render inputs: `TerminalView.selection: Option<TerminalSelection>`
  (viewport cells, start-inclusive/end-exclusive, auto-normalized),
  `marked_text: Option<String>`, `cursor_shape` — set + cx.notify().
- Marked text draws at the terminal cursor cell; `gpui::InputHandler`
  should own real composition ranges/caret.
- Font caveat for P1e: "JetBrains Mono" is NOT system-installed; embedded
  font resolves as "JetBrainsMono Nerd Font" — app must register the TTFs
  and pass the right family in `TerminalFontConfig`.
- Re-verify in P1d: wakeup pump lifetime when a TerminalView drops
  mid-stream (loop exits on WeakEntity::update failure — believed correct,
  not stress-tested).

**Next:** P1d — Input + IME.

### 2026-07-04 — P1d found implemented externally; mode change

- The branch was rebased upstream of this effort; P0/P1a/P1b/P1c commits are
  now `4d0ecbd2e` / `df512cf7f` / `ad0388ada` / `6aaffe848`.
- P1d (input + IME) was NOT implemented by an orchestrator-launched worker in
  this session: ~2,050 lines of uncommitted changes appeared in the worktree
  covering the full P1d scope — key encoding via vt (kitty-aware), mouse
  down/move/up/wheel with vt mouse encoding + local word/line selection,
  copy/paste with bracketed paste, full `gpui::InputHandler` (marked text,
  replace_text_in_range, bounds_for_range), `FocusHandle`. Files:
  `terminal_element.rs` (+1067), `ghostty_vt.rs` (+831),
  `terminal_model.rs` (+149), demo bin (+27). User confirmed typing works in
  the demo.
- USER DIRECTIVE (2026-07-04): workers should IMPLEMENT ONLY — no runtime/
  interactive verification; `cargo build` must still pass and commits stay
  phase-scoped. The user will verify everything at the end. All parity
  checklist items from here on are "implemented, user-verify pending", not
  "verified".
- P1e worker's first task: selectively commit the existing P1d work (only the
  vt-terminal files, not unrelated uncommitted changes), then implement P1e.

**Next:** P1e — Integration + parity.

### 2026-07-04 — P1d committed + P1e done (worker af40277cab28bc73f)

Commits (each verified by the worker to build standalone via temp worktree):
- `10d160423` — the externally-written P1d work committed as-is: FocusHandle,
  vt key encoder path, mouse reporting + local selection, clipboard, IME via
  EntityInputHandler; `ghostty_vt.rs` key/mouse/paste/focus encoders + mode
  queries; model send_key/send_mouse/paste/focus/wheel-route/scroll_viewport.
- `7ef7b9dbe` — P1e integration (+2215/−159 across 6 files incl. new
  `gpui/src/terminal_gpui_engine.rs`). P1D-DEBUG keystroke eprintlns and F6
  debug hook stripped (app must not log keystrokes). main.rs mixed-ownership
  hunks separated via hash-object reconstruction; other agents' uncommitted
  work preserved byte-for-byte (worker verified round-trip identity).

**Integration design:**
- Opt-in: shared-settings key `terminalGpuiEngineEnabled` (bool, default
  false), read via `SharedSidebarSettingsSnapshot::gpui_terminal_engine_settings()`.
  Toggle by adding `"terminalGpuiEngineEnabled": true` to
  `native-sidebar-settings.json` (NOT yet in the shared TS settings schema).
- A session joins the engine exactly when its one-shot launch payload would
  otherwise feed a native Ghostty config AND the flag is on. Running native
  surfaces, restored sessions, startup-pipeline flows stay native; both
  engines coexist. `sync_agents/command_gpui_engine_terminals` claim slots at
  the top of the existing host syncs; claimed slots are filtered from native
  `current_slot_ids`. Runtime-vs-persisted identity split preserved.
- Spawn mirrors ghostty macOS exec semantics (`/usr/bin/login -flp` etc.),
  TERM=xterm-256color (no ghostty terminfo in bundle — matches native here),
  same shared font/scrollback settings; vendored JetBrainsMono NF TTFs
  registered at app startup; macos-option-as-alt=true parity.
- Focus branches to `window.focus(view.focus_handle)` for claimed slots;
  exit polled in sync pass with native-parity cleanup; close-confirm mirrors
  ghostty `needsConfirmQuit` incl. OSC 133 prompt detection
  (`cursor_at_prompt()` vt readback).

**Parity checklist (ALL implemented, user-verify pending):** OSC titles+pwd
(re-polled per wakeup, flows into existing `GpuiTerminalRuntimeOscState`);
bell (sidebar dispatch parity); hyperlinks (OSC 8 hover+cmd+click via vetted
opener; plain-URL detection is conservative scheme-scan, narrower than
ghostty regex set); search (Cmd+F bar, viewport-scoped only); rectangular
alt+drag selection; scrollback (wheel history, jump-to-bottom,
`terminalScrollbackLimitMb`; no scrollbar UI); delayed send (fires through vt
key encoder); close-confirm. Kitty graphics deferred (tracked fast-follow).

**Known gaps:** startup-pipeline flows (materialize restored / retry failed)
stay native even with flag on; restored sessions re-materialize native after
relaunch; viewport-only search; approximate URL regex; command plain
terminals without project cwd stay native; non-macOS spawn path unexercised;
settings key Rust-read-only.

**User manual-verify list (deferred to end at user's request):** flip flag →
session attaches via engine (typing/IME/colors/resize); OSC tab titles; bell;
cmd+click OSC 8 + plain URL; alt+drag block select/copy; wheel history in
shell and vim; Cmd+F; close-confirm with vim running vs idle prompt; `exit`
closes tab; sleep/wake; delayed send; drag ghost over engine terminal;
command-pane Action completion; Cmd+V bracketed paste; flag-off native
sessions unchanged.

**Orchestrator gates still closed:** default flip NOT done; native-path
deletion NOT done. Open user decisions parked for end-of-run: default flip,
adding the key to `shared/ghostex-settings.ts` Settings UI, startup-pipeline
engine coverage before default-flip, scrollback-search/scrollbar/kitty
graphics fast-follows.

**Next:** P2 — Windows bring-up (best-effort from macOS).

### 2026-07-04 — P2 done (worker a0d7db2968d5984a0)

Commits (each verified to build standalone in a temp worktree; macOS build
green, warning count unchanged):
- `9ce99fae2` — refactor(gpui): split windowed CEF into shared `cef/shell.rs`
  (OS-agnostic runtime/handlers/CefBrowser wrapper) + `cef/macos.rs` platform
  adapter (13 fns), wired via cfg'd `#[path]` platform modules in
  `cef/mod.rs`. NOTE: the shell.rs/macos.rs split itself appeared in the
  worktree externally (like P1d); the worker judged it P2 content (tree
  didn't compile unwired, its CDXC comments anticipate cef/windows.rs) and
  committed it byte-identical plus two fixes (missing mod.rs wiring; a
  `NSView*/HWND` comment whose `*/` closed the block comment early).
  ORDER-OF-BUSINESS: confirm with user this ownership call was right.
- `702b28460` — feat(gpui): Windows CEF adapter + bring-up seams:
  `cef/windows.rs` (300 lines: set_as_child(HWND), message-only-HWND pump
  mirroring the AppKit shim state machine, SetWindowPos frame w/ per-window
  DPI, ShowWindow SW_SHOWNA/SW_HIDE, SetFocus, helper-exe
  browser_subprocess_path); build.rs Windows libghostty-vt branch (direct
  zig invocation, links `lib/ghostty-vt-static.lib` — name already emitted by
  vendored build.zig); terminal_gpui_engine.rs Windows spawn (PowerShell
  default, non-Windows path byte-for-byte unchanged); main.rs seams
  (`cef_parent_native_view` Win32 arm; cfg(windows) `sidebar_url` — the
  `dist/sidebar` segment is load-bearing for the helper's first-party URL
  check); `scripts/build-windows-app.ps1` packaging skeleton; target-gated
  windows-sys 0.61 (all API names verified against registry source).

**needs-device-verify (nothing executed on Windows):**
1. All of cef/windows.rs (pump thread affinity, WM_TIMER cadence,
   PostMessageW marshaling under real CEF callback threads).
2. DPI scaling in set_native_view_frame (logical→physical, per-monitor moves).
3. SetFocus handoff; whether Win32 needs an analogue of the macOS
   focus-routing shim (historically the fiddliest part).
4. SW_SHOWNA hide/show during drags.
5. Helper-exe flow (`ghostex-gpui-cef-helper.exe`).
6. libghostty-vt windows-msvc compile, archive name/location, extra link libs.
7. PowerShell via ConPTY (interactive, -Command payloads, resize, exit
   status); TERM=xterm-256color left as-is.
8. build-windows-app.ps1 end-to-end incl. cef-dll-sys cache layout.
9. Whole-crate `cargo check --target *-windows-msvc` NOT possible from macOS
   (cef-dll-sys needs target CEF download + cmake/ninja/MSVC) — "compiles on
   Windows" unproven for main.rs despite all sampled seams being gated.
10. Known compile-safe runtime gaps (honest errors, not fallbacks):
    cli_bridge.rs reads /dev/urandom; home_dir/ghostex_home_root use HOME
    (Windows wants USERPROFILE; GHOSTEX_HOME escape hatch; shared_settings.rs
    under active external edit, deliberately not touched); sounds/t3code
    resource lookups know only bundle/dev layouts; `unsupported.rs` stale vs
    current cef API (P3 supersedes); shell.rs select-all family will be
    dead-code warnings on Windows.

**Open decisions parked for user:** shell.rs ownership confirmation; Windows
CI/cross-compile gate; shell discovery depth (cmd/GitBash/WSL later);
USERPROFILE/AppData path policy.

**Next:** P3 — Linux X11 bring-up (best-effort from macOS).

### 2026-07-04 — P3 done (worker aba033ed60be86db1)

Commits (macOS build green at each, 61 pre-existing warnings unchanged;
orchestrator re-confirmed green after landing):
- `061601aa8` — refactor(gpui): extend CEF platform seam for Linux:
  `shell.rs::initialize(cx)` (Linux pump needs gpui executors), new per-OS
  `append_platform_command_line_switches` hook, `set_bounds`/frame calls now
  carry the gpui window scale factor (X11 has no per-window DPI query;
  dedup keyed on scale too), `unsupported.rs` refreshed to current API,
  macOS/Windows adapters updated as documented no-ops.
- `fcb4aef4c` — feat(gpui): Linux X11 adapter + seams:
  - `cef/linux_x11.rs` (364 lines): `set_as_child(x11_window_id)`, x11rb
    0.13 (same major gpui pulls; pure-Rust, own RustConnection),
    ConfigureWindow/Map/Unmap/SetInputFocus glue with logical→physical
    scaling and ≥1px clamp, `--ozone-platform=x11` switch, sibling helper as
    browser_subprocess_path; pump = gpui foreground task mirroring the
    AppKit shim state machine 1:1 (i32::MAX placeholder, 33ms clamp,
    cancellable timer via background timer + select_biased).
  - Backend forcing (`force_gpui_x11_backend_for_windowed_cef`, first stmt of
    main): gpui has no public backend ctor; removes `WAYLAND_DISPLAY` before
    threads exist (the mechanism gpui's compositor guess uses), hard-exits
    loudly if `DISPLAY` unset; terminal children get WAYLAND_DISPLAY
    re-injected so user GUI apps stay native Wayland.
  - Seams: `cef_parent_native_view` Xcb+Xlib arms; `sidebar_url` packaged arm
    now any(windows, linux) (`dist/sidebar` load-bearing for first-party URL
    check); Linux terminal spawn = ghostty non-darwin shape `/bin/sh -c`
    with `$SHELL` default; 5 pre-existing cross-platform cfg errors fixed
    (RefCell ungate; close-confirm bookkeeping + native hover-link query
    cfg-gated — non-macOS arm factually has no native surfaces).
  - build.rs Linux branch (shared direct-zig helper, links
    `lib/libghostty-vt.a`, `-Wl,-rpath,$ORIGIN`); `build-linux-app.sh`
    packaging skeleton (flat CEF layout, icudtl/locales, no SUID
    chrome-sandbox — app runs no_sandbox).
- main.rs staging used the established HEAD-blob reconstruction; other
  agents' ~2.2k uncommitted main.rs lines preserved byte-identical.

**Bonus verification (beyond implement-only):** whole-crate
`cargo check --target x86_64-unknown-linux-gnu` PASSED from macOS (0 errors,
203 warnings = dead macOS-only code, analogous to accepted Windows
situation); cef-dll-sys downloaded real Linux CEF 148 (no cmake needed on
Linux); harness was zig-cc cross wrappers + PKG_CONFIG_ALLOW_CROSS=1 +
GHOSTEX_ZIG. Harness deliberately NOT added to the repo (out of scope) —
user may want it codified as a script/CI gate.

**needs-device-verify (nothing executed on Linux hardware):**
1. All of cef/linux_x11.rs at runtime (set_as_child under gpui X11 parent,
   geometry, SetInputFocus handoff — XWayland focus semantics extra-suspect).
2. Pump under real CEF callback threads (cadence, reentrancy, nested loops).
3. `--ozone-platform=x11` propagation to CEF subprocesses (relies on
   Chromium's own switch propagation, not forced per-child).
4. Scale conversion vs Xft.dpi/randr environments.
5. WAYLAND_DISPLAY removal actually selecting X11Client on real Wayland;
   DISPLAY-missing hard-exit UX.
6. `/bin/sh -c $SHELL` interactive spawn; WAYLAND_DISPLAY re-injection via
   portable-pty.
7. build.rs Linux branch on a Linux host (native zig build; extra link libs?).
8. `$ORIGIN` rpath in dev and staged layouts.
9. build-linux-app.sh end-to-end incl. first-party URL check on staged
   dist/sidebar.
10. Helper flow on Linux.
11. Hide-and-hold drag pattern with X11 child windows (map/unmap mid-drag).
12. v1 trade-offs to eyeball: fractional-scaling sharpness, XWayland IME.
13. P2-inherited compile-safe gaps unchanged (resource lookups, sounds,
    `~/.ghostex-gpui/cef` home dot-dir not XDG).

**Open decisions parked for user:** X11 hard-force escape hatch (env
override for Wayland experiments?); DISPLAY-missing exit(1) UX; unify
Windows frame scaling on the passed gpui scale (2-line follow-up) vs
GetDpiForWindow; XDG cache path compliance; codify the Linux cross-check
harness as a script/CI gate.

## Final summary — 2026-07-04

All 8 work packages are complete. Phase 0 and Phase 1 (P0–P1e) are fully
implemented on macOS: the drag-ghost bug is fixed, and a GPUI-composited
terminal engine (libghostty-vt + portable-pty + TerminalElement + full
input/IME + pane integration with parity checklist) runs behind the
per-session opt-in `terminalGpuiEngineEnabled` (default off; native path
fully intact). Phases 2–3 (Windows, Linux X11) are implemented best-effort
from macOS: per-OS CEF adapters (`cef/windows.rs`, `cef/linux_x11.rs`) over
the shared `cef/shell.rs`, platform seams, spawn paths, build.rs branches,
and packaging skeletons; whole-crate Linux cargo check passes from macOS,
Windows equivalent blocked by toolchain (see P2 item 9).

Commit chain: `4d0ecbd2e` (P0) → `df512cf7f` (P1a) → `ad0388ada` (P1b) →
`6aaffe848` (P1c) → `10d160423` (P1d) → `7ef7b9dbe` (P1e) → `9ce99fae2` +
`702b28460` (P2) → `061601aa8` + `fcb4aef4c` (P3).

Per user directive (2026-07-04), NO runtime verification was performed from
P1e onward — everything is "implemented, user-verify pending". The user's
verification entry points:
1. macOS engine: the 15-item manual list in the P1e entry (flip
   `terminalGpuiEngineEnabled` in native-sidebar-settings.json).
2. P0 drag ghost: on-screen check after relaunching the prototype.
3. Windows: P2 needs-device-verify list (10 items) on real hardware.
4. Linux: P3 needs-device-verify list (13 items) on real hardware.

Orchestrator gates still CLOSED (user decisions): default-flip of the new
engine; deletion of the native terminal pipeline. Other parked decisions are
listed in the P1e/P2/P3 entries. Phase 4 (OSR/Wayland) remains out of scope.

### 2026-07-04 — F1 launched: engine terminals not typeable in integrated app

User began the macOS manual-verify pass (flag set to true in
`~/.ghostex/state/native-sidebar-settings.json`, backup saved as
`.bak-gpui-engine`; release binary rebuilt) and immediately hit: NEW sessions
mount via the engine and render, but typing does nothing.

Known-good boundary: typing worked in the standalone
`terminal-element-demo` bin at P1c/P1d verification, so the input stack
itself is believed sound; suspicion is the P1e integration layer (focus
routing to the view FocusHandle, app-level key interception,
first-responder sync built for native NSViews, or InputHandler
registration in the real window). Also flagged to the worker: the worktree
has uncommitted third-party modifications to `gpui/src/main.rs`,
`terminal_element.rs`, `terminal_model.rs` and others that are baked into
the release binary the user tested — the worker must check those diffs
first and must preserve them byte-for-byte (surgical staging only).

Fix worker launched (fable, max effort), same hard-rules block as prior
packages plus: no keystroke logging may survive to commit; prototype may be
run for diagnosis, production app never.

### 2026-07-04 — F1 done (worker a41e9aa1cf71d877b): `7dc838639`

**Root cause:** the sidebar is a CEF (Chromium) child NSView. Clicking it
makes CEF the macOS first responder, and gpui only makes its own NSView
first responder once at window creation — it never reclaims it on click.
So after any sidebar interaction (which is how agent sessions / sidebar
"new terminal" flows start), hardware key events flow into Chromium and
never enter GPUI at all. lldb confirmed: clicking a dead engine terminal
DID hit `TerminalView::handle_mouse_down` (GPUI-side FocusHandle focused),
but typing produced zero hits on `handle_key_down`/`send_key`/
`write_input`. This is why the "+" tab-bar terminal (created without
touching the sidebar) was typeable while sidebar-created ones were dead.

**Fix (`gpui/src/main.rs`, ~70 lines):** the app already had the correct
pattern for its other GPUI-owned inputs (browser address bar, terminal
search input): call `cef::focus_native_view(parent_ns_view)` (=
`makeFirstResponder` on the GPUI view) before focusing the element handle
(see `CDXC:GPUICefFocusRouting` in GpuiCefAppKitHooks.m). The engine
terminal branches were missing it. Added `focus_gpui_engine_terminal_view`
helper used by both Agents and Command-pane terminal-body click branches;
also drained the sidebar create/attach "focus the new terminal" handoff
for engine-claimed slots (previously only the native path drained it), so
sidebar-created terminals are typeable immediately without a first click.

**Verification:** `cargo build --release` green (61 pre-existing warnings,
none new); other agents' uncommitted hunks preserved byte-for-byte
(reconstructed-blob staging). Orchestrator ran a standalone build of the
bare commit in a fresh worktree: all Rust compiled; only link failed on
the missing gitignored `GhosttyKit.xcframework/ghostty-internal.a`
prebuilt artifact — commit is self-contained at source level. App bundle
(`gpui/build/macos/GhostexGPUI.app`) rebuilt post-fix for user testing.

**Known follow-up gap (parked, not fixed):** keyboard-driven tab/pane
switching (cmd+1..9, focusNext/PreviousSession) moves shell focus to an
engine slot without focusing its element handle — same class of issue;
needs the same first-responder + FocusHandle handoff.

**Process note:** the worker initially drove the running prototype UI
(cua-driver clicks/typing) and was stopped by the user multiple times;
diagnosis concluded with lldb tracing instead. Future fix workers: no
interactive UI automation on the user's machine unless the user opts in.

### 2026-07-04 — User manual-verify pass #1 results + F2 launched

User-verified PASS ✅: typing/backspace/arrows/ctrl+c; colors/styles/emoji/
CJK alignment; resize reflow; vim/htop TUI; click-drag/double/triple-click
selection; alt+drag block selection; Cmd+C / Cmd+V incl. bracketed paste
into vim; wheel scrollback + typing jumps to bottom; wheel routes to vim
not history; close-confirm with vim running; no banner at idle prompt +
`exit` closes tab; drag ghost over engine terminal (P0 verified too); old
native sessions unchanged.

FAIL ❌: Cmd+F shows the search bar but its input can't be typed into
(clicking the input works; Cmd+F must auto-focus it) → F2 worker launched
with the F1 first-responder context and a strict no-UI-automation rule.

NOT YET TESTED (user will return to these): OSC tab titles; bell →
sidebar attention; hyperlink hover + cmd+click; IME composition; delayed
send; sleep/wake + command-pane Actions.

### 2026-07-04 — F2 done (worker a444e5c4244db0009): `6dad0425c`

**Root cause:** the Cmd+F focus chain itself was correct
(`start_search_in_focused_gpui_engine_terminal` → focus-pending →
`sync_terminal_search_inputs` reclaims first responder + focuses the
input). The bug was the root-level `.on_key_down` committed-text forwarder
on the render root (main.rs ~50907): it decides "a terminal is focused"
from app-level `active_mode`/`shell_focus` only — shell focus deliberately
stays on the terminal pane while the search bar is open — so every typed
character was forwarded into the terminal PTY and the event consumed,
which on macOS skips `interpretKeyEvents`, so `insertText` never reached
the focused search input's handler.

**Fix (15 lines, main.rs only):** new `terminal_search_input_owns_keyboard_focus`
gate; the root key forwarder returns immediately (also skipping
sleeping-placeholder wake) when a live terminal search input's FocusHandle
is focused, letting the platform text-input path deliver the key to the
input. Escape-close already restores terminal focus via
`close_terminal_search` → `focus_gpui_engine_terminal_view`; normal
terminal typing unaffected (engine element consumes its own keys first).
CDXC:GPUITerminalSearchFocus at the listener.

**Hygiene:** debug+release builds green (61 pre-existing warnings, none
new); reconstructed-blob staging; ~3,400 lines of third-party uncommitted
main.rs hunks verified intact. App bundle rebuilt post-fix.

**Worker-noted latents (parked):** (a) cmd+1..9 keyboard tab/pane switch
still doesn't reclaim first responder (known F1 gap, unchanged); (b)
`sync_terminal_search_inputs` `take()`s the focus-pending intent before
the input-map lookup — silently drops focus if the lookup ever misses
(today it can't); (c) statically, click-then-type into the search input
had the same swallow — user should verify BOTH Cmd+F-then-type and
click-then-type, plus Esc returning focus.

### 2026-07-04 — F3 + F4 launched (user requests after verify pass)

User asked to fix (1) the parked F1 gap: switching to an engine terminal via
keyboard only (cmd+1..9 / focusNext-PreviousSession) after touching the
sidebar leaves typing dead until a click — same first-responder class as F1;
and (2) command-pane terminals in the gpui app render blank and don't match
the UX/logic of the macOS production app's command pane. Dispatching
sequentially (both touch `gpui/src/main.rs`): F3 first (small, pattern known
from `7dc838639`), then F4 (needs diagnosis; primary = blank rendering,
secondary = UX/logic divergences vs macOS command pane, report what's too
big to fix). Same hard-rules block as F1/F2 incl. NO interactive UI
automation on the user's machine — static diagnosis only.

### 2026-07-04 — F3 done (worker a8144e03b5f15e463): `d775d33cb`

**Root cause:** focusNextSession/focusPreviousSession in all its bindings
(cmd+tab / cmd+shift+tab from the settings hotkey table, always-on
cmd+shift+]/[, ctrl-tab/ctrl-shift-tab KeyBindings, command-palette rows)
converge on `cycle_focused_tab` (~main.rs:35999), which mutated the tab
model + app-level shell focus only — never `focus_gpui_engine_terminal_view`
— so the engine FocusHandle stayed unfocused and CEF kept first responder
(F1 class). **cmd+1..9 was traced end-to-end and is NOT broken at HEAD:**
it round-trips through SidebarApp → `WorkspaceTerminalFocus` →
`focus_existing_gpui_local_workspace_terminal` →
`request_agents_terminal_text_focus_handoff`, which F1's render-top drain
resolves into the same helper. If the user still reproduces cmd+1..9 dead
typing, probe the `gpui.terminalFocus.workspaceFocusRequested` support log
(~main.rs:30141) — it would be a different break.

**Fix (43 insertions, main.rs only):** new
`focus_gpui_engine_terminal_for_focused_mount_slot` resolves the newly
focused slot from `focused_terminal_text_mount_target()` and, only when it
has an engine record, runs `focus_gpui_engine_terminal_view` (first
responder + FocusHandle — byte-identical to the click end state). Called
once in `cycle_focused_tab`'s `if changed` block; Browser/native slots
no-op. Synchronous — engine records persist across tab switches, no
deferral/pending state. CDXC:GPUITerminalGpuiEngineFocus.

**Hygiene:** debug+release green (61 pre-existing warnings, none new);
reconstructed-blob staging; third-party ~3,089+/463− uncommitted main.rs
hunks intact; commit source-self-contained vs parent blob.

**Parked, same gap class (different fix sites — resurface if user hits):**
cmd+[/] focusPrevious/NextGroup (`focus_workspace_direction_by_render_order`),
cmd+alt+arrows (`focus_workspace_direction`/`focus_spatial_target`),
alt+1..5 workarea switch back to Agents, and — non-keyboard — clicks on
Agents pane TAB STRIPS (`select_agents_tab` ~main.rs:32517) set shell focus
without the engine handoff (command-pane tab clicks are fine).

**Next:** F4 launched — command-pane terminals blank in gpui app + UX/logic
parity with the macOS production app command pane.

### 2026-07-04 — F4 done (worker a8bc5659ebc8687b9): `13ccd08ab`

**Blank-rendering root cause (forensic, not fully pinned in current source):**
the blank command terminal WAS engine-claimed and alive — its shell's PTY
winsize was stuck at 1 row x 183 cols (correct width, <1 cell height), so a
1-row grid rendered "blank". Everything else eliminated: spawn/env/PTY pump
identical to the working Agents engine path; sync+render share the slot
predicate; the full layout chain reproduces correctly in a taffy 0.10.1
replication (body ~134 px). Crucially, the binary the user reproduced on was
built pre-07:18 from a mid-flight snapshot of ~3.5k uncommitted third-party
main.rs lines (incl. an uncommitted claim-by-default rewrite of
`sync_command_gpui_engine_terminals`); the current source could not be made
to produce a zero-height state under any static probe. Per the no-fallbacks
rule the worker did NOT add a speculative layout fix; instead it committed
gated diagnostics that settle "never rendered" vs "collapsed rectangle" in
one repro. (Worker read-only-probed the running app: process/PTY/state-file/
CDP reads, no UI driven — within the letter of the no-automation rule.)

**Fixes in `13ccd08ab` (main.rs, +86/−2):**
- Sleep-teardown parity (real logic bug): native command-tab Sleep kills the
  process (TerminalWorkspaceView.swift closeTerminal ~4600); the engine path
  retained the record and a live invisible shell. Now sleeping drops the
  record (kills child), wake re-claims fresh. CDXC:GPUITerminalGpuiEngine.
- Gated diagnostics under existing `native.terminal.focus` scenario
  (default-off) → `~/.ghostex/logs/gpui-terminal-focus-debug.log`:
  `gpui.terminalEngine.commandSpawned`, `…commandSpawnFailedClosedTab`,
  `…commandGridChanged` (cols/rows per applied grid change; numeric ids
  only). CDXC:GPUITerminalGpuiEngineDiagnostics.

**Verified parity (no change needed):** restore semantics (macOS recreates
awake command terminals of active project, parks sleeping — GPUI matches);
OSC title → tab title (`command_pane_tab_display_title` ~main.rs:38914).

**Reported, NOT implemented (large / owned by in-flight work):**
- Engine ignores managed Ghostty appearance config: theme (user runs GitHub
  Dark), cursor style/blink, letter spacing, line height, padding,
  copy-on-select, scroll multipliers, paste protection — engine uses only
  family/size/weight + vt default palette (terminal_gpui_engine.rs:70-84).
- Uncommitted third-party claim-by-default rewrite bypasses
  `terminalGpuiEngineEnabled` for command slots and dropped the
  native-ownership guard (flag-off can't fall back to native).
- Runtime-id instability: `command_terminal_runtime_session_id` derives from
  (group, session); moving a command tab across groups desyncs OSC-title/
  search lookups (~main.rs:17325).
- Startup-wake command sessions respawn as plain shell (no launch/resume
  command replay, unlike native).
- Scrollback scrollbar: in-flight uncommitted third-party work, untouched.

**Hygiene:** cargo check + release green (61 pre-existing warnings, none
new); reconstructed-blob staging; commit compiles standalone in temp sibling
worktree; third-party hunks intact. Bundle NOT packaged by worker.

**User verify (F4):** relaunch fresh bundle → command pane terminal should
render (stale-binary theory); if still blank: enable `native.terminal.focus`
diagnostic scenario, repro once, read gpui-terminal-focus-debug.log
(commandSpawned without commandGridChanged = never rendered; rows:1 =
collapsed rect) + `stty -f /dev/ttysNNN size`. Sleep fix: sleep a command
tab → shell process must die; wake → fresh shell. Regression: close/
close-confirm, exit-closes-tab, delayed send, Action-run completion.
