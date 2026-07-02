# GPUI Cross-Platform Plan: macOS / Windows / Linux

<!--
CDXC:GPUICrossPlatformPlan 2026-07-03:
Roadmap for taking the GPUI app from macOS-only to all three desktop OSes with
the smallest sustainable architecture, decided after studying Glass (CEF OSR in
GPUI), Zed (GPUI-composited terminal), winghostty (Ghostty core on Windows),
and libghostty-vt (render-state C API already vendored under ghostty/).
Phases are ordered so every phase ships alone and nothing is built twice.
-->

## Where we are today (macOS-only)

- **GPUI/Rust** draws the shell (titlebar, tabs, splits, drag ghosts) into one
  Metal layer on the window's root NSView.
- **CEF runs windowed**: each browser/sidebar/kanban/manage/modal surface is a
  native child NSView created via `WindowInfo::set_as_child` on that same root
  view (`gpui/src/cef/macos.rs`), positioned by `CefElement` prepaint.
- **Terminals are libghostty surfaces** rendered into app-owned child NSViews
  (`gpui/src/terminal_native_view.rs`, `gpui/native/macos/GpuiTerminalAppKitAdapter.m`),
  reconciled by the canvas-probe → host → lifecycle pipeline.
- Native child views always composite **above** the GPUI layer. GPUI content
  can never draw over live browser/terminal panes. Existing coping mechanisms:
  hide-during-drag for Browser/command tab drags (`allows_cef_child_views()`
  gate, `main.rs:6610`) and separate NSWindows for modals/toasts/tips.
- Known bug: workspace/Agents tab drags hide nothing, so the drag ghost and
  the pane-body drop bands vanish behind running terminal views.

## Target end state

One shared architecture across macOS, Windows, Linux:

- **Shell**: GPUI (Metal / DirectX11 / blade-Vulkan backends — all exist upstream).
- **Terminals**: fully GPUI-composited elements powered by **libghostty-vt**
  (Ghostty's terminal core with the C render-state API, already vendored at
  `ghostty/include/ghostty/vt.h` + `src/lib_vt.zig`) + a Rust PTY layer.
  No native views. Works identically on all three OSes, including Wayland.
- **CEF web surfaces**: stay **windowed child views** with a thin per-OS
  adapter (NSView / HWND / X11 window). Linux v1 runs the whole app in X11
  mode (XWayland on modern desktops). Browser OSR is a deliberate LATER,
  not part of this plan's critical path.
- **Layering discipline**: the existing hide-and-hold + separate-window
  patterns remain the only tools for "GPUI above native" until/unless OSR
  lands. This keeps AGENTS.md layout rules intact (no overlays, no hit-test
  routing).

Why this shape: Ghostty has no offscreen mode, so terminals must become
GPUI-drawn to work on Windows (no Ghostty app runtime) and Wayland (no
foreign-surface embedding) — and doing so also permanently fixes all
terminal-related z-order problems. CEF, by contrast, embeds fine as a child
window on macOS/Windows/X11, so windowed CEF is the cheapest correct choice
per-OS today, with OSR kept as a clean upgrade path.

---

## Phase 0 — Fix the drag-ghost bug (macOS, now; days)

Extend the existing drag visibility gate to workspace/Agents tab drags:

- `begin_workspace_tab_drag` / drag-finish paths (`main.rs:37503`) must hide
  app-owned terminal host native views (and CEF views, same as Browser drags)
  for the whole drag, then restore on drop/cancel. Reuse
  `set_app_owned_terminal_host_native_view_visible` and the parked-owner
  reattach machinery — do NOT invent overlays.
- GPUI placeholder cards show underneath while hidden, so drop-edge bands
  (`render_workspace_drop_edge_band`, `main.rs:43215`) become visible again —
  same co-design as `CDXC:GPUIBrowserSplits` (`main.rs:44847`).
- Optional polish (separate, later): capture a pane screenshot at drag start
  (ScreenCaptureKit) and draw it as a GPUI image instead of the blank
  placeholder. macOS-only nicety; skip unless blanking feels bad.

Done when: dragging any tab shows the ghost and drop feedback over every pane
type; drop/cancel restores content; no view leaks (hide/show only, no
destroy/recreate).

## Phase 1 — GPUI-composited terminal on libghostty-vt (the core refactor)

The one big-ish phase. Replaces per-OS native terminal views with a portable
GPUI element while keeping Ghostty's terminal behavior.

**Engine — libghostty-vt (vendored, MIT):**
- Build `libghostty-vt` from `ghostty/` (build step exists:
  `ghostty/src/build/GhosttyLibVt.zig`; umbrella header `ghostty/include/ghostty/vt.h`).
- It provides: VT parse, screen/scrollback/alt-screen, styles/SGR, selection,
  modes, OSC (titles, hyperlinks), kitty graphics state, key/mouse encoding,
  and crucially `render.h` — a render-state API designed exactly for external
  renderers: update-from-terminal under a short lock, then read rows/cells
  with two-level dirty tracking (global + per-row).
- Caveat noted in `src/lib_vt.zig`: functionality stable, **API not yet
  stable**. Acceptable — ghostty is vendored; pin and absorb API bumps on our
  schedule.

**PTY layer — Rust:**
- Use `portable-pty` (WezTerm's crate): openpty on Unix, ConPTY on Windows.
- Feed PTY output bytes into the vt terminal on a background task; batch
  wakeups (Zed uses a 4ms coalescing window — copy the *idea*).

**Rendering — new `TerminalElement` (Rust, gpui::Element):**
- prepaint: measure cell metrics via `text_system().advance(font, size, 'm')`,
  resize terminal, sync render state, build layout (batched same-style text
  runs, merged background rects, cursor, IME marked text, selection rects).
- paint: background quad → per-cell bg rects → selection/search highlights →
  shaped text runs (`shape_line` with forced cell advance) → IME → cursor.
- Use vt dirty tracking to skip clean rows when building layout.
- Architectural reference: Zed `crates/terminal` + `crates/terminal_view`
  (~17.7k LOC total; reusable core concepts ~8–9k). **GPL-3.0 — reference the
  architecture, re-implement; never copy code.** Glass/Zed file pointers in
  "Reference material" below.

**Input:**
- Keyboard: route GPUI key events through vt's key encoding (kitty keyboard
  protocol + legacy — this is ghostty's own encoder, which sidesteps the
  kitty-vs-legacy bugs we've fought before).
- Mouse: vt mouse encoding for reporting modes; local selection/scroll
  otherwise. IME via `gpui::InputHandler` (marked text drawn by the element).

**Integration & cleanup:**
- The mount pipeline simplifies: terminal body slots render the element
  directly — the canvas-probe → `terminal_surface_host` →
  `terminal_surface_lifecycle` → `terminal_native_view` chain and
  `GpuiTerminalAppKitAdapter.m` are deleted once parity is reached.
- Keep runtime-vs-persisted identity split (mount slot ids) — it is
  independent of native views and still correct.
- Migrate incrementally behind a setting: new engine per-session opt-in →
  default-on → delete native path. Parity checklist: OSC titles/pwd, bell,
  hyperlinks + hover, search, selection/copy modes, scrollback size, delayed
  send, close-confirm, kitty graphics (may ship after first cut — track
  explicitly if deferred).

Done when: all Agents/command terminals run the GPUI element on macOS with no
native terminal views left, drag/overlay/z-order issues gone for terminals.

**Effort:** weeks, not days; the biggest single chunk. Mechanical parts
(element layout/paint, mappings, PTY plumbing) are highly agent-delegable;
human time concentrates on input feel, IME, and render polish.

## Phase 2 — Windows bring-up

- **Shell:** gpui Windows backend (DirectX11) exists upstream — build, fix
  app-side `cfg(target_os = "macos")` assumptions (menus, `macos_parent_view`,
  keychain, notifications, paths, packaging). Expect a long tail of small
  portability chores rather than architecture work.
- **Terminal:** free — Phase 1 output + ConPTY via portable-pty. Verify shell
  discovery (PowerShell/cmd/Git Bash/WSL); winghostty's docs are a good
  checklist of Windows terminal gotchas.
- **CEF:** new `cef/windows.rs` adapter mirroring `cef/macos.rs`:
  `WindowInfo::set_as_child(hwnd)`, set frame / show-hide, focus glue, and the
  CEF message-pump + helper-exe equivalents. The Rust shell layer
  (`CefSurface`/`CefElement`, visibility gates, bridges) is shared as-is.
  Windows has the same child-window-above-everything behavior — the Phase 0
  hide-during-drag pattern applies unchanged.
- **gxserver/zmx and launch plumbing:** audit separately; out of scope here.

Done when: the app runs on Windows with terminals + sidebar + browser panes,
using the same shell code and the same layering rules.

## Phase 3 — Linux bring-up (X11 mode)

- Run the whole app as X11 (works under XWayland everywhere). This is an
  explicit, documented choice: **X11 embedding requires the host window to be
  X11, so it is app-wide, not per-pane.** Force gpui's x11 backend at launch
  and pass `--ozone-platform=x11` to CEF.
- New `cef/linux_x11.rs` adapter: `set_as_child(x11_window_id)` + frame/
  visibility/focus glue. Everything else shared.
- Terminal: free (Phase 1). Known trade-offs to accept for v1: fractional
  scaling sharpness, weaker IME story under XWayland.

Done when: Linux parity with Windows feature set, shipped as an X11 app.

## Phase 4 — LATER / optional: browser OSR + native Wayland

Not on the critical path. Do this only when (a) Linux-native-Wayland matters,
or (b) hide-during-drag / separate-window workarounds become a real product
constraint for web surfaces.

- Start with **CPU OnPaint OSR** (dirty-rect BGRA → GPUI image): one
  platform-independent code path, good enough for sidebar/kanban/settings and
  normal browsing; video is the only real sufferer.
- Upgrade per-platform to shared GPU textures only if perf demands: our cef-rs
  fork already has `osr_texture_import` (IOSurface / D3D11 / DMA-BUF) and an
  OSR example; gpui has `surface()` (CVPixelBuffer) on macOS today; Windows
  D3D11 and Linux dmabuf need small gpui renderer extensions.
- Budget the input layer honestly (this is the real cost — built once, all
  platforms): DIP mouse coords, Windows-VK key codes even on macOS, native-key
  double-dispatch gate, IME composition + renderer-IPC editability routing,
  GPUI-drawn context menus, `<select>` popup-widget frames, `on_cursor_change`,
  window.open policy, external message pump, two-phase init, ObjC
  `CefAppProtocol` shim on macOS, accessibility loss.
- Glass (`~/dev/custom/Glass`, `crates/browser`) is the working reference for
  all of the above on our exact stack — including its gaps (`<select>` popups
  dropped, no cursor changes, frame path macOS-only). **GPL-3.0 — reference
  only, no copying.**
- Once OSR lands, flip Linux to gpui's Wayland backend and delete the X11-only
  constraint.

---

## Reference material (local checkouts)

| What | Where | License | Use |
| --- | --- | --- | --- |
| Glass CEF-OSR browser in GPUI | `~/dev/custom/Glass/crates/browser` | GPL-3.0 | Architecture reference for Phase 4 (pump, init, input, IME, menus) |
| Zed terminal (model + element) | `~/dev/custom/zed/crates/terminal{,_view}` | GPL-3.0 | Architecture reference for Phase 1 element/input/coalescing |
| libghostty-vt | `ghostty/include/ghostty/vt.h`, `ghostty/src/lib_vt.zig`, build: `ghostty/src/build/GhosttyLibVt.zig` | MIT (vendored) | Phase 1 engine |
| winghostty | github.com/amanthanvi/winghostty | MIT | Proof Ghostty core runs on Windows; Windows terminal gotcha checklist |
| cef-rs fork with OSR texture import | `~/dev/_references/cef-rs` (`cef/src/osr_texture_import/`, `examples/osr/`) | (fork) | Phase 4 GPU path |

Licensing rule for this plan: Glass and Zed app crates are GPL — study and
re-implement; do not copy code into this repo. libghostty-vt and winghostty
are MIT. gpui itself is Apache-2.0.

## Risks / open decisions

1. **libghostty-vt API instability** — pinned vendored copy mitigates; budget
   small absorb-cost per ghostty sync.
2. **Kitty graphics rendering** in the GPUI element (images in terminal) —
   decide ship-with or fast-follow during Phase 1 parity checklist.
3. **Font/fallback parity** with current Ghostty rendering (ligatures,
   emoji, box-drawing alignment) — GPUI text system differs from ghostty's
   renderer; test with the user's real font config early.
4. **Per-OS focus glue for windowed CEF** (Phases 2–3) — historically the
   fiddliest part (macOS hooks file is mostly focus code); allocate real time.
5. **Windows/Linux packaging + helper processes** for CEF — mirror the mac
   packager script per OS.
6. **IME on X11/XWayland** for the GPUI terminal — verify early in Phase 3.

## Non-goals (explicit)

- No CEF OSR before Phase 4; no per-pane XWayland tricks (impossible anyway).
- No alacritty switch — engine stays Ghostty (via libghostty-vt).
- No transparent-overlay / hit-test workarounds for layering, ever
  (AGENTS.md discipline stands).
- No native-Wayland requirement for v1 Linux.
