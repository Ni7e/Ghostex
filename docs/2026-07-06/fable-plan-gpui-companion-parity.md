# Plan: GPUI companion terminal parity with macOS app

## Overall goal

The gpui app (`gpui/`, Rust, almost everything in `gpui/src/main.rs`) must mirror the
macOS app's "project editor companion terminal" behavior:

1. **Bug A — wrong companion terminal on view switch.** When the user switches the
   titlebar view to Source/Browser/Kanban/Automate/Docs (a "project editor mode"),
   the companion side-pane must show the **last-focused terminal session belonging to
   the currently active project** — one of the project's existing sessions — never a
   blank startup shell and never a session from another project. Today the resolver
   picks the agents-workspace focused pane (often a blank shell) or the globally-first
   eligible session with no project scoping.

2. **Bug B — sidebar session click while in a non-agents view.** When the user clicks
   a session in the sidebar while a project editor mode is active, the app must STAY
   in the current mode and simply rebind the companion pane to the clicked session.
   Today it unconditionally sets `active_mode = TitlebarMode::Agents` (while the
   editor content stays visible on the right — inconsistent state).

The macOS reference implementation (READ THESE, they are the source of truth to copy):

- `native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift`
  - `preferredProjectEditorCompanionSessionId()` (~line 9483): candidate order is
    `[focusedSessionId, previous projectEditorCompanionSessionId]`, first eligible
    wins, else first eligible of the active project's visible sessions.
  - `isProjectEditorCompanionEligibleSession` (~9494), `openDefaultProjectEditorCompanionPane`
    (~9442), `focusProjectEditorPane` seeding (~5942-5948),
    `activateProjectEditorCompanionPane` (~9537-9683): on sidebar retarget it sets
    `projectEditorCompanionSessionId = sessionId`, `projectEditorCompanionIsVisible = true`,
    `focusedSessionId = sessionId`, does NOT clear `activeProjectEditorId` (editor stays).
- `native/sidebar/native-sidebar.tsx`
  - `shouldKeepProjectEditorOpenForSessionFocus` (~44979): keep the editor open on a
    session click iff the clicked project's editor surface is open AND the companion
    pane is not hidden. When kept, the agents workarea is NOT activated (~27576-27578)
    and the sidebar posts `retargetProjectEditorCompanionSession` (~6038-6060).

Decision logic to port (pseudocode):

```
# Sidebar session click:
keepEditor = activeModeIsProjectEditor AND companionPaneVisible AND clickedProject == activeProject
if keepEditor:
    stay in current mode; update workspace focus state; companionSessionId := clicked session
else:
    existing behavior (switch to Agents, focus pane)

# Companion resolution (view switch / sync):
candidates (first eligible AND belonging-to-active-project wins):
  1. agents-workspace focused pane session
  2. last sidebar-focused session for the active project
  3. previously stored companion session
  4. first eligible session belonging to the active project
else: None (no companion terminal) — NEVER a session of another project, NEVER an
unmapped native shell that is not one of the project's sessions.
```

## Repo rules workers MUST follow

- Do NOT write any tests in `gpui/` (repo rule: no tests in the gpui app).
- Do NOT add fallback/workaround logic where the correct fix is to fix the behavior
  itself. No "try agents focus first then patch it up later" hacks.
- Do NOT run, restart, or launch the app (`bun run start` etc. is forbidden). Do NOT
  use any desktop-automation/screenshot tooling. Verify by reading code and running
  `cargo check` only.
- Do NOT modify the macOS app (`native/**`), the sidebar TS (`sidebar/**`,
  `native/sidebar/**`), `shared/**`, or the bridge manifest
  (`gpui/src/cef/sidebar_bridge_manifest.rs`) — no protocol changes are needed; the
  sidebar already sends `WorkspaceTerminalFocus`.
- Match surrounding code style in `gpui/src/main.rs`; keep changes minimal and local.
- Build gate for every phase: `cd gpui && cargo check` must succeed (warnings that
  already existed are fine; no new errors).

## Key gpui code anchors (verified by exploration; line numbers approximate)

All in `gpui/src/main.rs` unless noted:

- `TitlebarMode` enum ~2313; `is_project_editor_mode()` ~2357 (Source/Browser/Kanban/
  Automate/Manage; "Manage" is the Docs view).
- Mode switch: `set_active_mode()` ~33029; calls
  `sync_project_editor_companion_terminal_selection()` ~33052.
- Companion resolution cluster ~22335-22417:
  - eligibility `...session_is_eligible` ~22335 (presentation Running + runtime
    session exists via `agents_terminal_runtime_sessions.runtime_session_id_for_shell_session`),
  - `focused_project_editor_companion_terminal_session()` ~22350,
  - `first_project_editor_companion_terminal_session()` ~22358 (global, unscoped — the bug),
  - `resolve_project_editor_companion_terminal_session()` ~22368,
  - `sync_project_editor_companion_terminal_selection()` ~22379,
  - `project_editor_companion_terminal_slot_for_mode()` ~22388.
- Companion state: `project_editor_companion_terminal_session_id: Option<TerminalSessionId>`
  ~21040 (init ~21443).
- Sidebar click path: `SidebarBridgeEvent::WorkspaceTerminalFocus` dispatch ~30797 →
  `receive_sidebar_workspace_terminal_focus_payload()` ~31084; records
  `local_workspace_latest_focus_key` ~31109; then
  `focus_existing_gpui_local_workspace_terminal(&key)` ~31741 (offending
  `self.active_mode = TitlebarMode::Agents;` inside) or async-attach →
  `open_gpui_local_workspace_terminal(...)` ~31806 (same offending assignment).
- Project/session mapping: `GpuiLocalWorkspaceSessionKey { project_id, session_id }`
  ~2956; `local_workspace_latest_focus_key: Option<GpuiLocalWorkspaceSessionKey>` ~20958;
  `local_workspace_session_mappings: HashMap<GpuiLocalWorkspaceSessionKey, TerminalSessionId>`
  ~20959; reverse lookup `local_workspace_key_for_shell_session(session_id)` (used ~33693).
- Active project id: `gpui_app_modal_active_project_id()` ~27762 (reads
  `latest_sidebar_project_snapshot`).
- Companion pane visibility: `ProjectEditorShellModel` ~7611, field
  `left_companion_visible` (companion hidden ⇔ false).
- Companion focus helper: `focus_project_editor_companion` ~37676; surface-host sync
  `sync_project_editor_companion_terminal_surface_host()` ~38816.

---

## Phase 1: Project-scoped, last-focused companion terminal resolution (Bug A)

- depends_on: []
- parallel_ok: false
- goal: Rewrite the companion-terminal resolution in `gpui/src/main.rs` so the
  companion pane always binds to a terminal session that belongs to the currently
  active project, preferring the last-focused one, exactly mirroring the macOS
  `preferredProjectEditorCompanionSessionId()` semantics. After this phase, switching
  to Source/Browser/Kanban/Automate/Docs shows the last-focused terminal of the active
  project, never a blank startup shell or another project's session.
- files: `gpui/src/main.rs` — ONLY the companion-resolution cluster (~22335-22417) and
  small new private helper methods next to it.
- do_not_touch: `receive_sidebar_workspace_terminal_focus_payload`,
  `focus_existing_gpui_local_workspace_terminal`, `open_gpui_local_workspace_terminal`
  (~31084-31900 region — Phase 2 owns those); anything outside `gpui/`;
  `gpui/src/cef/sidebar_bridge_manifest.rs`.
- approach:
  1. Add a helper that returns the active project id (reuse the logic behind
     `gpui_app_modal_active_project_id()` ~27762).
  2. Add a helper `fn shell_session_belongs_to_active_project(&self, session_id) -> bool`
     using the existing reverse lookup `local_workspace_key_for_shell_session` and
     comparing `key.project_id` to the active project id. A native session with NO
     local-workspace key (e.g. the blank startup shell) does NOT belong.
  3. Rewrite `resolve_project_editor_companion_terminal_session()` (~22368) to return
     the first candidate that is BOTH eligible (existing ~22335 gate, unchanged) AND
     belongs to the active project, in this order:
       a. the agents-workspace focused pane session
          (`focused_project_editor_companion_terminal_session()`),
       b. `local_workspace_latest_focus_key` when its `project_id` equals the active
          project, mapped through `local_workspace_session_mappings` to a native
          `TerminalSessionId`,
       c. the currently stored `project_editor_companion_terminal_session_id`,
       d. the first eligible session that belongs to the active project (project-
          scoped replacement for `first_project_editor_companion_terminal_session()`;
          iterate the workspace session order and keep only project-owned sessions —
          or iterate `local_workspace_session_mappings` entries for the active project
          in workspace order).
     If no candidate qualifies, return `None`. Do NOT keep any global/unscoped
     fallback — returning a foreign or unmapped session IS the bug being fixed.
  4. If the global-first helper `first_project_editor_companion_terminal_session()`
     has no remaining callers after the rewrite, remove it (or fold it into the new
     project-scoped helper) rather than leaving dead code.
  5. `sync_project_editor_companion_terminal_selection()` and the slot builder keep
     their existing roles; they should now transparently produce project-correct
     results because resolution changed underneath.
- acceptance_criteria:
  - `resolve_project_editor_companion_terminal_session()` cannot return a session id
    that lacks a `GpuiLocalWorkspaceSessionKey` mapping or whose key's `project_id`
    differs from the active project (verify by reading every return path).
  - Candidate priority in code is exactly: workspace-focused pane → latest sidebar
    focus key → stored companion id → first project-owned eligible session → `None`.
  - The eligibility gate (Running + runtime session present) still applies to every
    candidate.
  - No behavior change to any code outside the resolution cluster.
  - `cd gpui && cargo check` completes without errors (prove with the command output).

## Phase 2: Sidebar session click keeps editor mode and retargets companion (Bug B)

- depends_on: [1]
- parallel_ok: false
- goal: When a sidebar session click (`WorkspaceTerminalFocus` bridge event) arrives
  while `active_mode.is_project_editor_mode()` is true, the companion pane visible,
  and the clicked session's project is the active project, the app stays in the
  current mode and rebinds the companion terminal to the clicked session — mirroring
  macOS `shouldKeepProjectEditorOpenForSessionFocus` + `activateProjectEditorCompanionPane`.
  In every other case, behavior is unchanged from today (switch to Agents and focus
  the pane).
- files: `gpui/src/main.rs` — the sidebar click path:
  `receive_sidebar_workspace_terminal_focus_payload` (~31084),
  `focus_existing_gpui_local_workspace_terminal` (~31741),
  `open_gpui_local_workspace_terminal` (~31806), plus any small helper they need.
- do_not_touch: the Phase 1 resolution cluster except to CALL its public entry points
  (`sync_project_editor_companion_terminal_selection()` etc.) — do not re-modify the
  candidate ordering; anything outside `gpui/`; the bridge manifest.
- approach:
  1. Compute a `keep_editor_mode` condition where the click is handled:
     `self.active_mode.is_project_editor_mode()` AND the companion pane is visible for
     the active editor shell (`left_companion_visible` on the relevant
     `ProjectEditorShellModel`) AND `key.project_id` equals the active project id
     (use the Phase 1 helper).
  2. In `focus_existing_gpui_local_workspace_terminal` (~31741) and
     `open_gpui_local_workspace_terminal` (~31806): when `keep_editor_mode`, do NOT
     assign `self.active_mode = TitlebarMode::Agents` and do NOT hand keyboard focus
     to the agents pane. Instead: still update the agents-workspace tab/pane selection
     state for the target session (so returning to Agents later shows it focused,
     matching macOS which updates workspace focus on click), then set
     `self.project_editor_companion_terminal_session_id = Some(<native session id>)`,
     call `sync_project_editor_companion_terminal_selection()` (Phase 1 ordering keeps
     the clicked session: it is now both the latest focus key and the stored id), and
     focus the companion surface via the existing companion-focus path
     (`focus_project_editor_companion` ~37676 or the narrower surface-focus sync it
     uses). The titlebar mode and the editor content on the right must not change.
  3. The not-yet-materialized path (async attach → `open_gpui_local_workspace_terminal`)
     must get the same treatment: the branch reads `self.active_mode` at call time, so
     the keep-mode condition is evaluated when the terminal is actually opened. Verify
     the async callback indeed lands in the patched function and inherits the guard.
  4. When `keep_editor_mode` is false (not in an editor mode, companion hidden, or a
     cross-project click), the existing code path must run byte-for-byte identical
     logic to today (mode switch to Agents, tab select, shell focus handoff).
  5. No new bridge messages, no sidebar/TS changes — the existing
     `WorkspaceTerminalFocus` event carries `{projectId, sessionId}` which is all
     that is needed.
- acceptance_criteria:
  - Grep proof: neither `focus_existing_gpui_local_workspace_terminal` nor
    `open_gpui_local_workspace_terminal` contains an UNCONDITIONAL
    `active_mode = TitlebarMode::Agents` assignment anymore; the assignment is guarded
    by the negation of the keep-editor-mode condition.
  - In the keep branch: `project_editor_companion_terminal_session_id` is set to the
    clicked session's native `TerminalSessionId`,
    `sync_project_editor_companion_terminal_selection()` is invoked, the companion
    surface receives focus, and there is no code path that flips `active_mode`.
  - Companion hidden (`left_companion_visible == false`) or non-editor mode or
    cross-project click ⇒ control flow reaches the pre-existing switch-to-Agents
    logic unchanged.
  - The async materialization path evaluates the guard at open time (verify by
    reading the callback).
  - `cd gpui && cargo check` completes without errors (prove with the command output).

## Handoff notes

### Phase 1 → Phase 2

Phase 1 is COMPLETE. Companion resolution in `gpui/src/main.rs` is now project-scoped:
active-project ownership is checked via the local workspace session mapping, candidate
order is workspace-focused pane → latest sidebar focus key → stored companion id →
first project-owned eligible session → `None`, and the old unscoped first-terminal
fallback was removed (foreign/unmapped sessions resolve to `None`). `cargo check`
passes. Phase 2 can rely on `sync_project_editor_companion_terminal_selection()`
keeping a clicked same-project session selected once it is the latest focus key and
stored companion id.

### Phase 2

Phase 2 is COMPLETE. A same-project keep-editor guard (active project id + companion
visibility) now gates the sidebar-click handlers: existing mapped session clicks
retarget the project-editor companion without flipping `active_mode`; the async
attach path applies the same retarget when the terminal opens; hidden-companion,
non-editor-mode, and cross-project clicks stay on the existing Agents path.
`cargo check` passes; all Phase 2 changes are local to `gpui/src/main.rs`.

### Follow-up fix: companion pane mounted a blank default shell

After Phases 1–2, the companion selected the correct session but its native
Ghostty surface spawned a default shell ("~"): companion config requests never
carried a launch payload, because the daemon-built `zmx attach` command is a
one-shot payload keyed to the AGENTS body mount slot only (the GPUI-engine
terminal path was unaffected — it re-renders the same terminal entity). Fix
(all in `gpui/src/main.rs`): added
`ProjectEditorCompanionTerminalLaunchPayloadSource` (attach payloads keyed by
runtime id + companion slot); companion slots without a live surface now mount
only with an attach payload (never a blank shell) and otherwise fetch the
session's attach metadata from gxserver asynchronously
(`request_project_editor_companion_terminal_attach_payload`); the sidebar-click
keep-editor paths seed the companion payload synchronously from the
just-inserted agents payload, keeping a startup-text-free copy on the agents
slot so a later Agents-view mount attaches the same zmx session without
re-sending startup input. zmx supports concurrent clients, so the companion
attach mirrors the session exactly like mobile attach does.
