# Plan: GPUI parity with macOS — tabs, sidebar ordering, companion pages & sidepane

## Overall goal

Make the GPUI app (`gpui/`) match the existing macOS app behavior exactly in four areas:

1. **Tabs bar**: the Agents workspace tab strip must mirror the active project's sidebar
   session group exactly (same sessions, same order, same titles), like the macOS app.
   Today it renders phantom local-only "Terminal Session" tabs that are not in the sidebar.
2. **Sidebar project ordering**: projects and worktrees in the GPUI sidebar must be ordered
   like the macOS app (chats/quick first, manual order, and worktree projects placed
   directly below their main repo project, movable only within their family).
3. **Companion pages** (Source / Browser / Kanban / Automate / Docs): opening one of these
   must never show the "X is sleeping — Activate X" placeholder. macOS always wakes the
   surface on open; GPUI must do the same.
4. **Companion sidepane**: the left companion pane next to the project-editor surface must
   show a real terminal (the focused/eligible session, macOS logic), not a blank
   placeholder, and the divider line between the companion pane and the main pane must be
   neutral (macOS uses opaque `0x1E1E1E`, 1px), not the current mode-tinted colored line.

## Repo rules every worker MUST follow

- **No tests** may be added in `gpui/**` or in the macOS app trees (`native/macos/**`,
  `native/sidebar/**`, `sidebar/**`, `src/**`). Tests in `shared/**` are allowed only if you
  changed a `shared/` module that already has a test file next to it.
- **No fallbacks instead of fixes.** Do the right thing from the start; do not add
  "try-then-fall-back" logic to paper over an issue.
- **Never restart the Ghostex app, never run `bun run start` or `bun run gpui`** or any
  command that launches/restarts an app. Verification is code-level + build/typecheck only.
- **Native layout discipline** (applies to the companion terminal work): interactive
  regions must be laid out as non-overlapping sibling/child frames. No transparent
  overlays, no `hitTest` overrides, no hidden overlap between interactive regions.
- `gpui/src/main.rs` is huge (~76k lines). Make targeted edits; never reformat unrelated
  regions. Line numbers below were captured on 2026-07-05 and may drift slightly — anchor
  by symbol name, not raw line number.
- Do not commit anything. Leave changes in the working tree.

## Build / verification commands

- Rust: `cd /Users/madda/dev/_active/Ghostex/gpui && cargo check` must exit 0.
- GPUI CEF TS bundles: `cd /Users/madda/dev/_active/Ghostex/gpui && bun x vite build` must exit 0.
- Root TS (if you touch `shared/**`, `sidebar/**`, or `native/sidebar/**`):
  `cd /Users/madda/dev/_active/Ghostex && bun run typecheck` must exit 0.
- Shared tests (only if you touch the module):
  `cd /Users/madda/dev/_active/Ghostex && bun x vitest run shared/project-worktree-order.test.ts`.

## Architecture snapshot (read before coding)

- The GPUI app is a Rust GPUI shell (`gpui/src/main.rs`) + CEF webviews. The sidebar is the
  SAME shared React `SidebarApp` used by macOS, mounted by `gpui/sidebar/main.tsx` and fed
  by the adapter `gpui/sidebar/gxserver-runtime.ts` (HTTP/WebSocket to local gxserver;
  ingests `presentationSnapshot`/`presentationDelta` around `gxserver-runtime.ts:315-320`).
- The GPUI Agents tab strip is native GPUI, rendered from local shell state
  (`WorkspaceModel.terminal_sessions` + `WorkspaceNode` tree), NOT from gxserver.
- The macOS reference behavior lives mostly in shared TypeScript:
  - `shared/project-worktree-order.ts` — worktree ordering + drag constraints.
  - `shared/gxserver-presentation-sidebar-projection.ts` — project ordering + hidden
    session/project filtering.
  - `native/sidebar/native-sidebar.tsx` — macOS wiring (tab list building, wake logic).
  - `native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift` — macOS
    companion sidepane implementation (reference only; do not modify).

---

## Phase 1: Sidebar project + worktree ordering parity (TypeScript)

- depends_on: []
- parallel_ok: true (files disjoint from Phase 2)
- goal: The GPUI sidebar must order projects exactly like the macOS sidebar: chat/quick
  projects first, then code projects in manual/persisted order (falling back to
  sortKey/updatedAt), with each worktree project rendered directly below its main repo
  project and only movable within its family. Today the GPUI sidebar does not apply this
  ordering. Diagnose the actual gap first, then fix the root cause — do not bolt a re-sort
  on top of a broken input.
- files: `gpui/sidebar/gxserver-runtime.ts`, `gpui/sidebar/active-project-context.ts`,
  `gpui/sidebar/workspace-session-groups.ts` (only if needed). Touch
  `shared/gxserver-presentation-sidebar-projection.ts` or `shared/project-worktree-order.ts`
  ONLY if you find a genuine bug in the shared module itself (unlikely — macOS uses them
  correctly).
- do_not_touch: `gpui/src/**`, `gpui/native/**`, `native/**`, `sidebar/**` (shared React
  app), `src/**`.
- approach:
  - Reference behavior: `orderGxserverPresentationSidebarProjects` at
    `shared/gxserver-presentation-sidebar-projection.ts:441` sorts by local overlay
    `orderIndex` (manual drag order) first, then `sortKey.localeCompare`, then `updatedAt`
    desc, then `projectId`, and then calls `orderProjectsWithWorktrees(...)`
    (`shared/project-worktree-order.ts:22`) which splits chat/quick to the front and emits
    each main project immediately followed by its worktree children (identified via
    `project.worktree.parentProjectId`, family resolution with cycle guard at
    `project-worktree-order.ts:130`). Drag constraints: `canDropProjectWithWorktrees`
    (`project-worktree-order.ts:56-87`) and `moveProjectsWithWorktrees` (`:30`).
  - The macOS native path additionally repairs worktree parent ids by normalized
    `parentProjectPath` so a worktree nests under its canonical main repo even across
    legacy-id migrations: `createNativeProjectWorktreeParentCandidates`
    (`native/sidebar/native-sidebar.tsx:11455-11483`) and
    `resolveNativeProjectWorktreeParentMetadata` (`:11485-11514`). GPUI's runtime likely
    needs the equivalent canonicalization applied to the presentation data it feeds the
    shared projection.
  - Diagnose in `gpui/sidebar/gxserver-runtime.ts` (~15k lines): find where it builds the
    projection input / sidebar contract from the presentation cache. Likely gaps: (a) it
    does not supply the local overlay `orderIndex` values (manual order) to the projection,
    (b) it does not pass worktree metadata (`worktree.parentProjectId`) through to the
    order items, or (c) it bypasses `orderGxserverPresentationSidebarProjects` /
    `orderProjectsWithWorktrees` entirely and emits projects in raw cache order. Fix so the
    GPUI runtime uses the SAME shared ordering functions and inputs the macOS path uses.
  - Also verify project drag/drop in the GPUI sidebar routes through
    `moveProjectsWithWorktrees` semantics (the shared `sidebar/sidebar-app.tsx` already
    calls it at `:6797` — if the GPUI runtime persists a reordered list, it must persist
    the family-normalized result, not a raw index move).
- acceptance_criteria:
  - The code path that produces the GPUI sidebar's project list demonstrably routes
    through `orderProjectsWithWorktrees` (directly or via
    `orderGxserverPresentationSidebarProjects`) with worktree
    `parentProjectId` metadata populated. Prove by citing the call chain in
    `gpui/sidebar/gxserver-runtime.ts` (function names + lines).
  - A worktree project whose `worktree.parentProjectId` (or canonicalized parent path)
    matches a visible main project is emitted immediately after that main project in the
    ordered list, regardless of its raw cache position.
  - `cd gpui && bun x vite build` exits 0.
  - `cd /Users/madda/dev/_active/Ghostex && bun run typecheck` exits 0 if any root-tree
    file was touched.
  - `bun x vitest run shared/project-worktree-order.test.ts` passes if `shared/**` touched.

## Phase 2: Companion pages auto-wake, neutral divider, companion sidepane terminal (Rust)

- depends_on: []
- parallel_ok: true (files disjoint from Phase 1)
- goal: Three tightly-coupled fixes in the GPUI project-editor shell: (a) opening
  Source/Browser/Kanban/Automate/Docs always activates the surface (no "X is sleeping"
  placeholder on open), (b) the divider between the companion sidepane and the main
  project-editor pane loses its mode-tinted color and becomes neutral like macOS, (c) the
  companion sidepane hosts a real terminal for the appropriate session (macOS selection
  logic) instead of an empty placeholder.
- files: `gpui/src/main.rs` (primary); `gpui/src/terminal_surface_host.rs`,
  `gpui/src/terminal_surface_lifecycle.rs`, `gpui/src/terminal_native_view.rs` only if the
  companion mount slot genuinely requires changes there (prefer reusing the existing
  pipeline with a companion-specific slot key).
- do_not_touch: `gpui/sidebar/**`, `shared/**`, `native/**`, `sidebar/**`, `src/**`.
- approach:
  - **(a) Auto-wake on open.** Today `render_project_editor_surface`
    (`gpui/src/main.rs:47209-47227`) returns
    `render_project_editor_sleeping_placeholder` when
    `!self.project_editor_shell.is_mode_awake(mode)`, and `set_active_mode`
    (`main.rs:32559-32593`) deliberately does not wake a sleeping mode — waking only
    happens on placeholder click via `focus_project_editor_surface` (`main.rs:36512-36541`
    → `mark_project_editor_mode_awake`). macOS instead wakes on every open: the titlebar
    openers in `native/sidebar/native-sidebar.tsx` (e.g. `switchNativeWorkareaView`
    `:28101-28129`) set `isOpen: true, isSleeping: false` and call
    `wakeProjectEditorSurface` (`:43403-43485`). Fix: when the user switches the active
    mode to a project-editor mode (titlebar workarea switcher, hotkeys, sidebar-driven
    mode changes — every path that ends in `set_active_mode` selecting a project-editor
    mode), mark that mode awake through the same path `focus_project_editor_surface` uses
    (`mark_project_editor_mode_awake` + any recency/cap bookkeeping such as the awake
    surface limit). The sleeping placeholder must remain reachable ONLY for surfaces that
    were put to sleep while NOT active (e.g. background sleep of a non-active mode) — it
    must never be what the user sees after deliberately opening a page. Remove now-dead
    placeholder-only wake paths if they become unreachable. Do not special-case one mode:
    all five (Source, Browser, Kanban, Automate, Docs/Manage) get identical treatment.
  - **(b) Neutral divider.** `render_project_editor_companion_divider`
    (`main.rs:47169-47207`) draws a 5px grab handle (`workspace_split_handle_color()`,
    `0x0c0c0c`) containing a 1px line colored by
    `project_editor_companion_divider_color(mode)` (`main.rs:56147-56156`, mode-tinted
    teal/blue/purple/amber/pink). macOS uses a neutral opaque `0x1E1E1E` 1px separator
    (`configureWorkspaceSeparatorLayer`, `TerminalWorkspaceView.swift:8748-8765`). Fix:
    make the visible 1px line neutral `0x1E1E1E` for all modes (keep the 5px grab handle
    behavior and hover/drag affordances). Delete `project_editor_companion_divider_color`
    and its per-mode tint table if nothing else uses it.
  - **(c) Companion terminal.** `render_project_editor_companion_pane`
    (`main.rs:46973-47071`) currently renders an empty placeholder body
    (`main.rs:47058-47069`). Implement the macOS behavior
    (`TerminalWorkspaceView.swift:9442-9601`, `9948-10037`):
    - Companion session selection: prefer the currently focused workspace session, then
      the previously shown companion session, then the first eligible session. Eligible =
      active, not a command-pane session, not sleeping, not a mounting placeholder, not
      popped out, and has a real terminal surface (mirror
      `isProjectEditorCompanionEligibleSession`, Swift `:9494-9505`).
    - Keep the companion selection synced when the sidebar/workspace focus changes while a
      project-editor mode is active (macOS: `syncProjectEditorCompanionSelectionFromSidebar`
      `:9456-9481`).
    - Mount the real Ghostty terminal in the companion body using the EXISTING terminal
      mount pipeline. Follow the command-pane precedent: command terminals reuse the same
      pipeline with command-specific mount slot keys so their state never collides with the
      Agents workspace maps (`ARCHITECTURE.md` "Command pane terminals"). Give the
      companion a companion-specific mount slot key for the selected session. The body slot
      is a normal GPUI layout slot: paint-time canvas records bounds →
      `NativeTerminalSurfaceHost` computes attach/move/detach → lifecycle → native view.
      IMPORTANT: the same session's terminal must not be double-mounted — when a session is
      shown in the companion while the Agents workspace is hidden (project-editor mode is
      active, so Agents surfaces are unmounted), the companion mount owns the surface;
      mirror how macOS moves the session surface into the companion frame
      (`syncProjectEditorCompanionPane`, Swift `:10022-10037`).
    - If NO eligible session exists, keep a placeholder body (that is the correct empty
      state, not a fallback).
    - Focus: clicking the companion terminal focuses it and routes key input to it, using
      the existing focus bookkeeping used by workspace terminal panes.
- acceptance_criteria:
  - `cd gpui && cargo check` exits 0.
  - In `set_active_mode` (or its single shared helper), switching to any project-editor
    mode marks that mode awake before render; cite the code path. Grep proof:
    `render_project_editor_sleeping_placeholder` is no longer reachable from a plain
    mode-switch of the active window (only from genuinely-slept non-active surfaces, or is
    fully removed if that state is now impossible).
  - `project_editor_companion_divider_color` mode tints are gone; the companion divider's
    visible line is neutral `0x1E1E1E` for every mode. Cite the render code.
  - `render_project_editor_companion_pane` renders a terminal body slot wired into the
    terminal mount pipeline with a companion-specific slot key; companion session selection
    implements focused → previous → first-eligible with the eligibility rules above. Cite
    the selection function and the mount-slot wiring.
  - No `hitTest` overrides, transparent overlays, or overlapping interactive regions were
    added.

## Phase 3: Tab strip mirrors the sidebar session group (Rust + GPUI sidebar bridge)

- depends_on: [1, 2]
- parallel_ok: false
- goal: The GPUI Agents tab bar must show exactly the sessions the sidebar shows for the
  active project, in the same order, with the same titles — like macOS, where native pane
  tabs "mirror the active sidebar group exactly" (including sleeping/unmounted sessions as
  parked tabs) and hidden/companion/carrier sessions are excluded upstream by the shared
  projection. Phantom "Terminal Session" tabs that do not correspond to sidebar rows must
  no longer appear.
- files: `gpui/src/main.rs`, `gpui/sidebar/gxserver-runtime.ts`, `gpui/src/cef/macos.rs`
  (only if the bridge needs a new fixed-function message).
- do_not_touch: `shared/**`, `native/**`, `sidebar/**`, `src/**`,
  `gpui/sidebar/active-project-context.ts` ordering logic from Phase 1 (build on it, do
  not rewrite it), Phase 2's companion/divider/wake code (build on it).
- approach:
  - Current state: the tab strip renders 1:1 from local shell state —
    `render_workspace_tab_bar` (`main.rs:45584`) iterates `leaf.tab_group.tabs` with no
    filtering; sessions live in `WorkspaceModel.terminal_sessions` (`main.rs:10168`);
    `TerminalSession` (`main.rs:9419`) has NO kind/hidden/companion fields. Phantom tabs
    come from (a) the hardcoded demo seed `WorkspaceModel::first_slice_default()`
    (`main.rs:10179`, 8 sample tabs) and (b) restore paths that default titles to
    "Terminal Session" (`terminal_session_title_for_id` `main.rs:19076`;
    `GPUI_PREVIOUS_SESSION_RESTORE_DEFAULT_TITLE` `main.rs:67338`).
  - macOS reference: the tab list is built from the active project's snapshot —
    `getNativePaneSessionsForSnapshot` (`native/sidebar/native-sidebar.tsx:48902`) takes
    `snapshot.visibleSessionIds` first, then appends remaining `snapshot.sessions`,
    deduped; `shouldIncludeSessionInNativePaneTabs` always returns true (`:3049-3058`)
    because exclusion (hidden sessions, carrier projects, top-mode companion surfaces)
    already happened in the shared projection. Sleeping sessions stay as parked tabs. Tab
    titles: `displayTitle || primaryTitle || terminalTitle || alias` (`:18215`), with the
    shared default `DEFAULT_TERMINAL_SESSION_TITLE = "Terminal Session"`
    (`shared/session-grid-contract-session.ts:63`) applied at session-creation time, not
    invented client-side.
  - Design: the CEF sidebar runtime already ingests the full presentation and already maps
    gxserver session clicks to shell tabs (`gxserver-runtime.ts` around `:1476`; Rust-side
    maps at `main.rs:20652-20662`, `20688`). Extend this bridge so the sidebar runtime
    posts the ACTIVE project's ordered tab-session list (session key, title fields, agent
    icon, lifecycle/presentation state, sleeping flag) whenever it changes — same
    fixed-function bounded-payload style as the existing bridge messages
    (`ARCHITECTURE.md` "CEF bridge model"). On the Rust side, reconcile
    `WorkspaceModel.terminal_sessions` + the workspace tab tree against that list:
    - sessions present in the list get tabs in list order (preserve existing pane/split
      assignment for sessions that already have tabs; append new ones to the active tab
      group like macOS appends to the layout);
    - local tabs whose session is NOT in the list are removed from the tab tree (they are
      not in the sidebar, so they must not be tabs);
    - titles update from the list (keep the existing live-OSC-title preference in
      `agents_workspace_tab_display_title` `main.rs:39665` — macOS includes
      `terminalTitle` in its chain, so OSC-preference is parity, not a deviation);
    - sleeping/unmounted sessions keep tabs with their parked presentation state (macOS
      shows them dim; GPUI already has `TerminalSessionPresentationState` `main.rs:8885`).
  - Delete or gate the demo seed `first_slice_default()` so a real gxserver-connected run
    never shows sample tabs. If the demo seed is still needed for gxserver-less dev runs,
    it may ONLY appear when there is no gxserver bootstrap at all (that is the genuine
    empty state, not a fallback).
  - Previous-session restore metadata (`main.rs:67338-67364`) must no longer materialize
    tabs that the sidebar does not list: restored placeholders reconcile against the
    sidebar list like everything else.
  - Keep it deterministic and bounded: the bridge payload is the projection output the
    sidebar already computed — do NOT re-implement hidden/carrier/kind filtering in Rust.
- acceptance_criteria:
  - `cd gpui && cargo check` exits 0 and `cd gpui && bun x vite build` exits 0.
  - A bridge message exists that carries the active project's ordered tab-session list
    from the CEF sidebar to Rust; cite sender (gxserver-runtime.ts) and receiver
    (main.rs / cef code) with function names.
  - Rust reconciliation: given a bridge list [A, B, C], the tab tree contains exactly tabs
    for A, B, C (plus nothing else) after reconciliation; a pre-existing local tab D not
    in the list is removed. Cite the reconciliation function and its removal path.
  - `WorkspaceModel::first_slice_default()` demo tabs can no longer appear when a gxserver
    bootstrap is present; cite the gating/removal.
  - Tab titles come from the sidebar-provided title chain; the only remaining
    "Terminal Session" literals in gpui are either dead or used exactly where macOS uses
    the shared default (cite each remaining occurrence and why it is parity).
  - Sessions in sleeping/unmounted lifecycle states still get tabs (parked), matching
    macOS `shouldIncludeSessionInNativePaneTabs` always-true semantics.

## Handoff notes

(appended by the orchestrator as phases complete)

- Phase 1 COMPLETE: `gpui/sidebar/gxserver-runtime.ts` — `createSidebarGroups` now passes
  raw presentation plus order/worktree overlays (persisted `orderIndex`, canonicalized
  worktree metadata) into `createGxserverPresentationSidebarGroups` →
  `orderGxserverPresentationSidebarProjects` → `orderProjectsWithWorktrees`. Drag/drop
  persistence normalizes saved project order through `orderProjectsWithWorktrees`.
  Only that one file changed; `cd gpui && bun x vite build` passes.

- Phase 2 COMPLETE: `gpui/src/main.rs` — `set_active_mode` now marks every project-editor
  mode awake before render (no sleeping placeholder on open). Companion divider tint
  removed; visible separator is neutral `0x1E1E1E`. Companion terminal selection is
  focused → previous → first eligible running session; the companion body mounts through a
  companion-specific terminal slot (`ProjectEditorCompanionTerminalBodyMountSlotId` /
  `sync_project_editor_companion_terminal_surface_host`) with its own focus/input path.
  `cargo check` and `bun x vite build` both pass.

- Phase 3 COMPLETE: `gpui/sidebar/gxserver-runtime.ts` + `gpui/src/main.rs` — the sidebar
  posts the active group's ordered tab-session list via a `tabSessions` bridge message;
  Rust parses it and reconciles the Agents tab tree to exactly those sessions (title,
  lifecycle, activity, agent icon from sidebar rows; tabs not in the list are removed).
  Demo seed tabs are gated out of production defaults (empty workspace start). Remaining
  "Terminal Session" literals cover only transient shell-created placeholders and
  previous-session metadata defaults, matching the shared default. `cargo check` and
  `bun x vite build` both pass.
