# Mission: orchestrate the GPUI cross-platform refactor

You are the ORCHESTRATOR for the plan in
`docs/2026-07-03/gpui-cross-platform-plan.md`. Read that file FIRST — it is
the source of truth for scope, phase order, and non-goals. Then read
`AGENTS.md`, `gpui/ARCHITECTURE.md`, and the progress file (below).

You do NOT implement code yourself. You launch one dedicated worker agent per
work package (always model Fable, xhigh reasoning effort), track progress in
the progress file, brief each next worker, and handle user check-ins. Workers
implement, verify, and commit their own work; you coordinate.

## State and resumability

- Progress file: `docs/2026-07-03/gpui-cross-platform-progress.md`. Create it
  if missing. At session start, read it and resume from the first incomplete
  work package. After every worker completes, append: package id, what was
  done, the worker's reported verification, open issues, next package.
- This prompt is re-runnable: a fresh session with this same prompt must be
  able to continue seamlessly from the progress file alone.

## Work packages (launch one worker agent per package, in this order)

- **P0 — Drag-ghost fix.** Extend the existing drag visibility gate so
  workspace/Agents tab drags hide native terminal + CEF views the way
  Browser/command drags already do (`allows_cef_child_views()` gate at
  main.rs:6610; begin/finish handlers near main.rs:37212 and 37503; terminal
  hiding via `set_app_owned_terminal_host_native_view_visible` + parked-owner
  reattach — hide/show only, never destroy/recreate mid-drag). Done: ghost and
  drop-edge bands visible over every pane type; content restores on drop AND
  drag-cancel; no focus bugs.
- **P1a — libghostty-vt build + FFI.** Build libghostty-vt from the vendored
  tree (`ghostty/src/build/GhosttyLibVt.zig`, header
  `ghostty/include/ghostty/vt.h`), wire into `gpui/build.rs`, write a minimal
  safe Rust wrapper module. Deliverable: a smoke binary/path that feeds bytes
  to a vt terminal and reads rows back via `render.h` (respect its two-level
  dirty-tracking contract: update never clears dirty; caller clears both
  levels).
- **P1b — PTY + terminal model.** `portable-pty` based spawn; background
  reader task feeding the vt terminal under a short lock; ~4ms wakeup
  coalescing; immutable per-frame snapshot for rendering; resize plumbing.
- **P1c — TerminalElement rendering.** New `gpui::Element`: cell metrics via
  `text_system().advance(font, size, 'm')`; batched same-style text runs via
  `shape_line` with forced cell advance; merged background rects; selection
  highlights; cursor shapes; use vt dirty tracking to skip clean rows.
- **P1d — Input + IME.** Keyboard through vt's own key encoding (kitty +
  legacy); mouse reporting through vt mouse encoding with local
  selection/scroll otherwise; copy/paste incl. bracketed paste; IME via
  `gpui::InputHandler` with marked-text drawing.
- **P1e — Integration + parity.** Mount the element behind a per-session
  opt-in setting alongside the existing native Ghostty path. Work through the
  plan's parity checklist (OSC titles/pwd, bell, hyperlinks, search,
  selection modes, scrollback, delayed send, close-confirm; kitty graphics
  may be a tracked fast-follow). Each item verified in the running prototype
  before it is checked off.
- **P2 — Windows bring-up (best-effort from macOS).** Per-OS CEF adapter
  `gpui/src/cef/windows.rs` mirroring the macos.rs surface
  (`set_as_child(hwnd)`, frame/visibility/focus glue, message pump, helper
  exe), cfg-gating of macOS-only assumptions behind platform seams, build
  scripts. macOS build stays green throughout. Everything that needs real
  Windows hardware is marked "needs-device-verify" in the progress file, not
  claimed done.
- **P3 — Linux X11 bring-up (best-effort from macOS).** Same as P2 with
  `gpui/src/cef/linux_x11.rs` (`set_as_child(x11_window_id)`), forced gpui
  x11 backend at launch, `--ozone-platform=x11` for CEF. X11-is-app-wide is a
  documented constraint. Same needs-device-verify discipline.

Phase 4 (browser OSR / native Wayland) is OUT OF SCOPE unless the user asks.

## How to launch each worker

Launch via the Agent tool, model **fable**, reasoning effort **xhigh**, one
package per agent, sequentially (a package starts only after the previous
worker reports done). Each worker prompt must be fully self-contained:

1. Its package scope (copy the package text above, plus the matching section
   of the plan file).
2. Repo pointers: plan file, progress file, `AGENTS.md`, relevant source
   anchors. Warn: `gpui/src/main.rs` is 2.9MB — targeted rg + offset reads
   only, never read whole.
3. The hard rules block below, verbatim.
4. Verification duty: the worker verifies its own work — `cargo build` in
   `gpui/` must pass, and the worker runs the `ghostex-gpui` prototype binary
   when its package has user-visible behavior (never the production Ghostex
   app). The worker commits its own work at stable checkpoints (clear,
   phase-scoped messages; never a broken build) and states exactly what it
   verified vs. assumed.
5. Report format: files touched, behavior delta, verification evidence, open
   risks — so you can record progress and brief the next worker.

Workers cannot talk to the user. Anything requiring a user decision comes
back to YOU, and you ask the user.

## Between workers

Trust worker reports — do not re-verify or review their diffs. Your job after
each worker: record its report in the progress file, carry any open risks or
handoff notes into the next worker's brief, and launch the next package. If a
worker reports failure or an unresolved blocker, launch a follow-up worker
carrying the full failure context to fix forward (surgical fixes only — never
broad restores).

## STOP AND ASK THE USER (orchestrator-level gates)

1. Before making the new terminal engine the default (end of P1e).
2. Before deleting the native terminal pipeline
   (terminal_surface_host/lifecycle/native_view + GpuiTerminalAppKitAdapter.m).
3. Whenever P2/P3 hit a blocker that only real Windows/Linux hardware can
   resolve — record state and stop rather than guessing.

## Hard rules (include verbatim in every worker prompt)

- No tests in the gpui app or macOS app. No test scaffolding.
- Strict layout ownership: never solve layering with transparent overlays,
  hitTest overrides, or hidden overlap. Hide-and-hold and separate native
  windows are the only sanctioned tools.
- No fallback code where correcting the behavior is possible.
- Never run destructive git/file operations; never revert broadly.
- Do not restart or touch the production Ghostex app. Building/running the
  `ghostex-gpui` prototype binary for verification is fine.
- LICENSING: Zed's terminal crates (~/dev/custom/zed/crates/terminal{,_view})
  and Glass's browser crate (~/dev/custom/Glass/crates/browser) are GPL-3.0 —
  study architecture freely; NEVER copy code, comments, or identifiers into
  this repo. libghostty-vt (vendored under ghostty/) is MIT and gpui is
  Apache-2.0 — fine to use directly.
- Match surrounding code style; use the repo's CDXC comment convention for
  load-bearing design decisions. Prefer deleting complexity over adding it.

## Quality bar

A phase is complete only when the plan file's "Done when" criteria are each
explicitly confirmed in the progress file, backed by the worker's reported
verification evidence. Keep the macOS build green after every package. When
all packages are done (or blocked on hardware), write a final summary section
in the progress file and report to the user.
