# Plan: GPUI sidebar terminal sessions — match macOS create/attach behavior

Date: 2026-07-06

## Overall goal

In the GPUI app (`gpui/`), sidebar terminal sessions must behave exactly like the
macOS app:

1. Clicking an agent button (e.g. "Claude") in the sidebar must create a session
   whose terminal runs in the **project directory** and launches the **agent
   command** (e.g. `claude`) — not an empty shell at `~`.
2. Clicking an **existing** session in the sidebar must attach to the
   already-running zmx session (live scrollback / running agent), not mount a
   fresh empty shell.

Both symptoms share one root cause in `gpui/src/main.rs`, diagnosed below. The
gxserver daemon side is fully correct and must not be changed.

## Repo rules workers MUST follow

- **No tests** anywhere under `gpui/` or the macOS app trees. Do not add test
  code. If an existing test breaks because of your change, delete it.
- **No fallbacks**: fix the actual behavior at the root; do not add
  try-this-then-fall-back logic to paper over the broken path.
- Never restart the Ghostex app; never run `bun run start`.
- Search routing: work inside `gpui/`; read (but do not modify)
  `gxserver-rs/`, `shared/gxserver-protocol.ts`, `native/sidebar/native-sidebar.tsx`
  for reference. Exclude `ghostty/**`, `tui/vendor/**`, `node_modules/**`,
  `target/**` from searches.
- Verify by reading code and compiling (`cargo check` from `gpui/`), NOT by
  launching the app.

## Reference: how the macOS app does it (the behavior to replicate)

All state lives in the `gxserver-rs` daemon (HTTP RPC). The macOS renderer
(`native/sidebar/native-sidebar.tsx`) orchestrates; the Swift host only executes
the shell command string the daemon returns.

**Create agent session (macOS):**
1. `launchAgentTerminal` (native-sidebar.tsx:22832) fetches the agent launch
   plan via `/api/readAgentLaunchPlan` → `{ command, startupText,
   startupTextDisposition: "queueAfterTerminalReady" }`. The agent command is
   delivered as **startup text typed into the terminal after it is ready**, not
   baked into the shell launch command.
2. `createTerminal` → `/api/createSession` with `cwd: project.path`; the daemon
   assigns `zmxName = {serverId}-{projectId}-{sessionId}` (gxserver-rs/src/ids.rs:58).
3. `postNativeCreateTerminalWithGxserverAttach` (native-sidebar.tsx:4923)
   fetches `/api/attachSessionMetadata` → `{ attachCommand, cwd, zmxName,
   persistenceSessionCreated, startupText, startupTextDisposition }`. If the zmx
   provider is missing and startup text is queued, it first calls
   `/api/startSessionProvider`, then re-fetches attach metadata.
4. The terminal is spawned with `workingDirectory = attach.cwd` and
   `command = attach.attachCommand` (the daemon-built `/bin/zsh -lc` script that
   `zmx attach`es, creating the session on first attach — gxserver-rs/src/zmx.rs:1523).
5. After terminal-ready, the queued `startupText` (the agent command) is written
   into the terminal as text input.

**Attach to existing session (macOS):**
1. Sidebar click → `focusTerminal`. If a live surface already exists, just focus
   it (no re-attach).
2. Otherwise (presentation row exists but no local pane, or session sleeping):
   materialize a pane and call the same attach flow with intent
   `"wake"` (→ `/api/wakeSession`) for sleeping sessions or `"attach"`
   (→ `/api/attachSessionMetadata`) otherwise. Both return the same
   `attachCommand`; because the zmx session name is deterministic and the zmx
   process is alive, `zmx attach` reconnects to the live session. For existing
   sessions `startupTextDisposition` is `"none"` so nothing is re-typed.

## Diagnosed root cause in the GPUI app

The sidebar (running in `gpui/sidebar/gxserver-runtime.ts`) already does the
gxserver work correctly:

- Agent button → `runSidebarAgent` → `createAgentSession()`
  (gxserver-runtime.ts:4654, local branch :4708) → `/api/createAgentSession`
  with `launchSettings.agentCommand` — the agent command **is** persisted in
  gxserver.
- It then publishes a `gxserverPresentationFocusState` snapshot and posts
  `workspaceTerminalFocus` (`focusLocalWorkspaceSession`, :4493).
- Clicking an existing session (`focusSession`, :4439) does the same two posts.

On the Rust side (`gpui/src/main.rs`) the failure sequence is:

1. The presentation snapshot arrives first:
   `set_sidebar_gxserver_presentation_focus_state` (main.rs:31351) →
   `reconcile_local_workspace_tabs_with_sidebar` (main.rs:31376) →
   `WorkspaceModel::reconcile_with_sidebar_tab_sessions` (main.rs:11217). For
   any tab session not already mapped it creates a
   `TerminalSession::placeholder` + `local_workspace_session_mappings` entry
   (main.rs:11266-11276) — **with no launch payload and no attach metadata**.
2. Then `workspaceTerminalFocus` is dispatched:
   `receive_sidebar_workspace_terminal_focus_payload` (main.rs:31084). At
   main.rs:31111 it calls
   `focus_existing_gpui_local_workspace_terminal(&key, cx)` (main.rs:31725),
   which finds the placeholder mapping from step 1 and returns `true` —
   **short-circuiting before the attach path**.
3. Placeholder activation → `Mounting` → mount reconcile (main.rs:39602-39672,
   macOS-only) → `agents_terminal_config_request_with_launch_payload_source`
   (main.rs:18273). `take_payload_for_mount_slot` returns `None`
   (main.rs:18286-18291) → surface spawns the **default shell, default cwd (~),
   no command**.

The correct machinery already exists but is unreachable for sidebar-driven
sessions:

- `gpui_prepare_local_workspace_attach_terminal_plan_with_startup_text`
  (main.rs:63396) calls `/api/wakeSession` / `/api/attachSessionMetadata`,
  handles provider cold-start via
  `should_start_local_zmx_provider_before_gpui_attach` → `/api/startSessionProvider`
  (main.rs:63416-63434), and reads `attach.attachCommand` (main.rs:63438) and
  `attach.cwd` (main.rs:63442).
- `insert_gpui_local_workspace_attach_terminal` (main.rs:64761) converts the
  plan into `AgentsTerminalExplicitLaunchPayload { working_directory,
  command: Some(attach_command), ... }` and inserts it for the mount slot
  (main.rs:64801).
- That path is only reached from `open_gpui_local_workspace_terminal`
  (main.rs:31766) and the async attach spawn at main.rs:31114-31141, both of
  which only run when `focus_existing_...` returned `false` — which it never
  does once the reconcile placeholder exists.

Additional facts:

- The spawn layer supports everything needed:
  `GhosttySurfaceLaunchPayload::try_new(working_directory, command, env_vars,
  initial_input, wait_after_command)` (gpui/src/terminal_ghostty_surface.rs:701).
- `AgentsTerminalStartupLaunchPayloadSource` (main.rs:3944) has no producer
  (documented at main.rs:4287) — placeholder→Mounting activation flows through
  it and therefore mounts blank.
- The remote-attach analog (`gpui_prepare_remote_attach_terminal_plan`,
  main.rs:63351) and command-terminal attach
  (`start_command_terminal_gxserver_attach_for_slot`, used at
  main.rs:36550-36561) are fully wired — use them as pattern references.

---

## Phase 1: Route sidebar-driven session focus/creation through the local attach plan

- depends_on: []
- parallel_ok: false
- goal: Make `workspaceTerminalFocus` for a local workspace session that is not
  yet materialized (a reconcile-created placeholder with no launch payload and
  no live mounted surface) run the full attach pipeline — fetch attach/wake
  metadata from gxserver, insert the explicit launch payload
  (command = daemon `attachCommand`, working_directory = `attach.cwd`), and
  only then activate/mount the tab. Sessions that already have a live mounted
  terminal surface must keep the current fast path (just focus, no re-attach) —
  exactly like macOS `focusTerminal`.
- files: `gpui/src/main.rs` (primary). Only touch other `gpui/src/*.rs` files
  if a small helper genuinely belongs there.
- do_not_touch: `gxserver-rs/**`, `native/**`, `shared/**`, `sidebar/**`,
  `gpui/sidebar/**`, `gpui/src/terminal_ghostty_surface.rs` spawn API surface
  (you may call it, not change it).
- approach:
  - Change the short-circuit decision in
    `receive_sidebar_workspace_terminal_focus_payload` (main.rs:31084-31141) /
    `focus_existing_gpui_local_workspace_terminal` (main.rs:31725): a
    reconcile-created placeholder whose mount slot has never received a launch
    payload and which has no live terminal surface must NOT count as
    "existing". Route those through the same code that
    `open_gpui_local_workspace_terminal` (main.rs:31766) uses:
    `gpui_prepare_local_workspace_attach_terminal_plan_with_startup_text` →
    `insert_gpui_local_workspace_attach_terminal` → activate tab.
    Prefer reusing/refactoring `open_gpui_local_workspace_terminal` so the
    placeholder-mapping case and the no-mapping case converge on one attach
    path (reuse the existing placeholder tab instead of creating a duplicate
    tab when a mapping already exists).
  - You need a reliable "has this session actually been attached/mounted"
    predicate. Base it on real state (e.g. session runtime state past
    Mounting-with-payload, or a live surface handle), not on a new ad-hoc
    boolean that can drift. Placeholder tabs created by
    `reconcile_with_sidebar_tab_sessions` must be distinguishable from tabs
    that mounted with an attach payload.
  - Ordering: the attach-plan fetch is async. Ensure the launch payload is
    inserted for the mount slot BEFORE the session transitions to Mounting /
    the mount reconcile consumes the slot, so the surface never spawns bare.
    Follow the sequencing that `open_gpui_local_workspace_terminal` +
    `insert_gpui_local_workspace_attach_terminal` (main.rs:64761-64801)
    already implement.
  - Wake vs attach: preserve the existing intent logic — sleeping sessions go
    through `/api/wakeSession`, others `/api/attachSessionMetadata`; keep the
    provider cold-start (`/api/startSessionProvider`) sequencing in
    `gpui_prepare_local_workspace_attach_terminal_plan_with_startup_text`
    intact.
  - Do not regress: command terminals
    (`start_command_terminal_gxserver_attach_for_slot`), remote attach
    (`gpui_prepare_remote_attach_terminal_plan`), and the T3/browser routes
    must be untouched. Re-clicking an already-open live session must still
    just focus it without spawning anything.
- acceptance_criteria:
  - Reading `receive_sidebar_workspace_terminal_focus_payload` and its callees
    shows: a placeholder session with no inserted/consumed launch payload and
    no live surface reaches
    `gpui_prepare_local_workspace_attach_terminal_plan_with_startup_text` and
    `insert_gpui_local_workspace_attach_terminal`; the inserted
    `AgentsTerminalExplicitLaunchPayload` uses `command = attach.attachCommand`
    and `working_directory = attach.cwd` from the gxserver response.
  - A session with a live mounted surface still takes the focus-only path (no
    second attach, no duplicate tab).
  - Sleeping sessions route through the wake variant (`/api/wakeSession`).
  - `cd gpui && cargo check` completes without errors or new warnings in the
    touched code.

## Phase 2: Agent-command startup text and create-flow parity

- depends_on: [1]
- parallel_ok: false
- goal: With Phase 1 routing in place, make the "create agent session" flow
  fully match macOS: the new session's terminal starts in the project
  directory via the daemon attach command, and the agent command (stored by
  `/api/createAgentSession` and returned as `startupText` with
  `startupTextDisposition: "queueAfterTerminalReady"` in the attach metadata)
  is actually delivered to the terminal — typed after the terminal is ready,
  exactly like macOS — so clicking "Claude" yields a running `claude` agent in
  the project cwd. Existing sessions (disposition `"none"`) must never get
  text re-typed.
- files: `gpui/src/main.rs` (primary); `gpui/sidebar/gxserver-runtime.ts` only
  if the create flow demonstrably fails to pass something gxserver needs
  (compare with the macOS `createAgentSession` params — likely no change
  needed since the agent command is already persisted server-side).
- do_not_touch: `gxserver-rs/**`, `native/**`, `shared/**`, `sidebar/**`
  (the top-level React app), Phase 1's short-circuit predicate except where
  startup-text delivery requires threading data through it.
- approach:
  - Trace how `gpui_prepare_local_workspace_attach_terminal_plan_with_startup_text`
    (main.rs:63396) carries `startupText` / `startupTextDisposition` into
    `GpuiLocalWorkspaceAttachTerminalPlan` and what
    `insert_gpui_local_workspace_attach_terminal` (main.rs:64761) does with
    it. Complete whatever is missing so that startup text with disposition
    `queueAfterTerminalReady` is written to the terminal once it is ready.
  - Delivery mechanism: prefer the mechanism the gpui codebase already has for
    writing text into a terminal after readiness (look at how the remote
    attach plan or command terminals deliver initial input — e.g. the
    `initial_input` field of `GhosttySurfaceLaunchPayload`, or an existing
    terminal-ready callback that sends text). Match macOS semantics: the
    attach command spawns the zmx shell; the agent command arrives as typed
    input afterwards. If `initial_input` on the launch payload is the
    established gpui equivalent and reliably delivers after shell readiness,
    using it is acceptable — the invariant is: new agent session ⇒ agent
    command runs in the zmx session; existing session ⇒ nothing extra typed.
  - Verify the created session's cwd: gxserver derives attach `cwd` as
    `session.cwd ?? project.path` (gxserver-rs/src/zmx.rs:405). Confirm the
    gpui create path results in attach metadata with the project path (read
    `create_agent_session_params_for_project`, gxserver-rs/src/agents.rs:306,
    to confirm the server sets cwd; only if it provably ends up empty AND the
    project path is not used as fallback would a client-side change be
    justified).
  - Do not double-deliver: if the daemon reports
    `persistenceSessionCreated: false` (session already existed) or
    disposition `"none"`, no startup text may be sent.
- acceptance_criteria:
  - Code path shows: new agent session → attach plan carries
    `startupText`/disposition → after the surface is ready the startup text is
    delivered exactly once; disposition `"none"` (existing session) delivers
    nothing.
  - The launch payload for a new agent session has
    `working_directory == attach.cwd` (project path), and `command` is the
    daemon attach script (agent command NOT baked into the spawn command).
  - `cd gpui && cargo check` completes without errors or new warnings in the
    touched code.

## Handoff notes

### Phase 1 (COMPLETE)

Changed `gpui/src/main.rs` only. Sidebar focus now skips the
focus-existing fast path for reconcile-only placeholders that have no live
surface owner and no pending launch payload. Sleeping mapped sessions route
through the wake attach intent; other placeholder attaches use attach
metadata. Attach insertion reuses the existing mapped tab (no duplicate tab)
and inserts the daemon attach command + cwd payload before mounting.
`cd gpui && cargo check` passed with no new warnings in touched code.

### Phase 2 (COMPLETE)

Updated `gpui/src/main.rs` to carry the gxserver startup-text metadata
(`startupText` / `startupTextDisposition` / `persistenceSessionCreated`)
through the local attach plan and thread eligible queued startup text into a
one-shot terminal `initial_input`. Attach command and `working_directory`
remain sourced from gxserver attach metadata; provider cold-start behavior
preserved; no retyping into existing sessions. `cargo check` passed.
