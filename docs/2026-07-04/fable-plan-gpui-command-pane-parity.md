# Plan: GPUI command pane behavior parity with macOS (gxserver/zmx-backed, GPUI-rendered)

Date: 2026-07-04

## Overall goal

Make the command pane in the GPUI app (`gpui/`) behave the same as in the macOS app.
Research (already done, verified against code) shows the pane chrome and interaction
behavior are ALREADY at parity — do NOT re-implement any of these:

- F12 tri-state toggle (`toggle_command_pane_from_keyboard` gpui/src/main.rs:41374,
  `command_pane_keyboard_toggle_decision` :7342)
- create-on-open of a "Command Terminal" session with cwd = project path
- height default 125px / clamp 40-600px / ratio clamp 0.05-0.90 / restore-default-on-open-from-hidden
- focus restore to workspace terminal on hide; auto-collapse on last session close
- Pinned/Floating/Collapsed modes, 25px floating inset
- horizontal-only splits, Cmd+T targeting the focused command tab group
- titlebar pin/unpin/expand/close controls, sleeping placeholders, Actions-into-command-tabs

The REAL divergence: gpui command-pane terminals spawn a plain local login shell
(`command: None` payload) instead of a gxserver-registered, zmx-backed session with
`surface: "commands"` the way macOS does. Consequences: no daemon session record, no
sidebar/state integration equivalent, no title/session survival, and app restart or
sleep kills the process instead of re-attaching.

The target architecture mirrors what gpui ALREADY does for Agents work-area terminals:
Rust calls the local gxserver daemon over HTTP (`gpui_gxserver_rpc_result`), gets the
daemon-built zmx `attachCommand`, and passes it as the `command` of the launch payload
consumed by `spawn_gpui_engine_terminal_record` → `TerminalModel::spawn`. Rendering
stays on the NEW GPUI-composited ghostty engine (`TerminalModel`/`TerminalView`/
`terminal_gpui_engine.rs`) — that part is already the default for command terminals
and must remain so. Do NOT use the old native NSView Ghostty surface path for command
terminals.

## Key reference code (read these before writing anything)

- Agents attach flow to copy: `gpui_prepare_local_workspace_attach_terminal_plan`
  gpui/src/main.rs:61517 (`/api/wakeSession` → optional `/api/startSessionProvider` →
  `/api/attachSessionMetadata` → `attach_command`, `cwd`), consumed by
  `insert_gpui_local_workspace_attach_terminal` gpui/src/main.rs:62671.
- Command payload plumbing today: `plain_command_terminal_project_launch_payload`
  gpui/src/main.rs:17708, `default_command_terminal_engine_launch_payload` :17732,
  `CommandTerminalLaunchPayloadSource` :17750, synthetic runtime ids
  `command_terminal_runtime_session_id` :17652.
- Command engine spawn loop: `sync_command_gpui_engine_terminals` gpui/src/main.rs:37624
  (drains payloads at :37707-37733, spawns via `spawn_gpui_engine_terminal_record` :37805).
- Engine glue: gpui/src/terminal_gpui_engine.rs (`gpui_engine_terminal_spawn_config` :104,
  login-shell invocation :130-173).
- macOS reference behavior: `createCommandTerminal` native/sidebar/native-sidebar.tsx:17491,
  `createGxserverTerminalRecordForNativeCreate` (surface "commands") :23760,
  `postNativeCreateTerminalWithGxserverAttach` :4923. The daemon returns the ready-made
  attach command; the client never synthesizes its own zmx script.
- Command pane model: `CommandPaneModel` gpui/src/main.rs:11437; shell-state persistence
  `command_pane_model_to_shell_state_json_with_optional_delayed_send_timers` :14829,
  restore `command_pane_model_from_shell_state_with_default_height_px` :14290.

## Repo rules workers MUST follow

- NO tests anywhere in `gpui/` or the macOS app trees. Do not add `#[cfg(test)]`,
  test files, or test scripts. If an existing test breaks from your change, delete it.
- NO fallbacks that hide failures. If gxserver attach fails, surface the failure
  honestly (e.g. close the tab / show the existing failure path) — do NOT silently
  fall back to a plain local shell as a "backup" path. (A deliberate, explicit
  non-gxserver mode is different from a failure fallback; see phase specs.)
- Never run `bun run start` or restart the running Ghostex app.
- Match surrounding code style, including the dated `CDXC:` comment-block convention
  used in gpui/src (add a brief dated entry describing your change where the file
  already uses them).
- All work happens in the existing worktree at /Users/madda/dev/_active/Ghostex.
  Do not create branches or commit; leave changes uncommitted.

## Phase 1: gxserver-backed creation/attach for command-pane terminals
- depends_on: []
- parallel_ok: false
- goal: Every newly created command-pane terminal in the GPUI app becomes a
  gxserver-registered, zmx-backed session with `surface: "commands"`, whose PTY runs
  the daemon-built attach command inside the NEW GPUI-rendered ghostty engine —
  exactly mirroring how Agents work-area terminals attach, and matching macOS
  `createCommandTerminal` semantics.
- files: gpui/src/main.rs (primarily), gpui/src/terminal_gpui_engine.rs if needed.
- do_not_touch: native/, shared/, gxserver/, src/, sidebar/, ghostty/, the old native
  surface files (gpui/src/terminal_ghostty_surface.rs, terminal_native_view.rs,
  terminal_surface_host.rs, terminal_surface_lifecycle.rs), and the Agents attach
  flow itself (reuse it via shared helpers; refactor-extract is fine, behavior change
  to Agents is not).
- approach:
  1. Add a command-session gxserver registration step: when a command session is
     created (open-when-empty, Cmd+T tab, split, titlebar new-tab, Action launch),
     asynchronously create a gxserver terminal session record for the active project
     with `surface: "commands"` and title "Command Terminal" (or the Action title).
     Find the gxserver API the daemon exposes for creating terminal session records —
     inspect what macOS `createGxserverTerminalRecordForNativeCreate`
     (native/sidebar/native-sidebar.tsx:23760) sends to gxserver (follow it into the
     gxserver client calls / gxserver/ routes, e.g. an /api/createSession-style
     endpoint) and call the same endpoint via `gpui_gxserver_rpc_result`. Use the
     active project's gxserver projectId (gpui already registers/knows projects via
     its daemon RPCs and sidebar snapshot).
  2. Reuse the wake/attach sequencing of
     `gpui_prepare_local_workspace_attach_terminal_plan` (extract a shared helper if
     that is cleaner) to obtain `attachCommand` + cwd for the new command session id.
  3. Feed the result into the existing payload channel:
     `CommandTerminalLaunchPayloadSource::insert_explicit_payload_for_mount_slot`
     with `command: Some(attach_command)`, `working_directory: Some(cwd)`. Replace
     the synthetic `command_terminal_runtime_session_id` usage with the real gxserver
     session id where the code tracks runtime ids for command sessions, so exits,
     titles (OSC), and sidebar refresh use the real identity.
  4. Action-launched command tabs must match macOS: gxserver-backed session + the
     action's execution text sent as startup/initial input after attach (macOS sends
     `"<executionText>\r"` as one-shot startup text so the pane stays attached to zmx
     after the command exits) — instead of today's
     `gpui_command_action_process_command` raw process. Preserve the existing
     run-feedback wiring in the exit path.
  5. Because attach metadata arrives async, keep the mount slot in its existing
     pre-spawn/awaiting state until the payload is inserted (the spawn loop already
     only spawns when a payload or default exists — make the default plain-shell
     payload no longer apply to gxserver-destined slots; a slot must wait for its
     attach payload and honestly show the existing failure/close path if the RPC
     fails; NO silent plain-shell fallback).
  6. Closing a command session must delete/kill the gxserver session (mirror whatever
     Agents/macOS do on command-session close — macOS removes the session record and
     kills the zmx pane through the daemon). Sleep keeps its current semantics for
     now (Phase 2 refines restart/re-attach).
  7. If the gxserver daemon genuinely is not running/reachable (remote-only or
     daemon-less dev mode), follow whatever the Agents work-area path does in that
     same situation — same policy, not a new one.
- acceptance_criteria:
  - `cd /Users/madda/dev/_active/Ghostex/gpui && cargo check` passes with no new
    warnings introduced by the change.
  - Code inspection: no command-pane spawn path passes `command: None` to
    `spawn_gpui_engine_terminal_record` for a newly created project command terminal;
    the payload command comes from a gxserver `/api/attachSessionMetadata`-derived
    attach command (grep evidence in gpui/src/main.rs).
  - Code inspection: command session creation calls the same gxserver
    session-record-creation endpoint macOS uses, with `surface: "commands"`.
  - Code inspection: Action-launched command tabs send execution text as initial
    input to a gxserver-backed attach, not as the spawned process command.
  - Code inspection: closing a command session issues the daemon kill/remove call.
  - Rendering still uses the GPUI engine: the command render slot still prefers
    `command_gpui_engine_terminals` views; no new use of the native surface path for
    command terminals.
  - PHASE 1 COMPLETE printed with a 5-line summary.

## Phase 2: restart/sleep lifecycle parity (re-attach instead of fresh shells)
- depends_on: [1]
- parallel_ok: false
- goal: Command-pane sessions survive app restart and sleep/wake the way macOS
  sessions do: the persisted shell state remembers each command session's gxserver
  session id and title, and on restore/wake gpui re-attaches (wake →
  attachSessionMetadata → attach command) instead of spawning a fresh empty local
  shell. Titles shown in the command pane tab bar come from the real session record /
  OSC titles, matching macOS.
- files: gpui/src/main.rs.
- do_not_touch: same exclusions as Phase 1.
- approach:
  1. Extend the command-pane shell-state JSON (writer
     `command_pane_model_to_shell_state_json_with_optional_delayed_send_timers`
     gpui/src/main.rs:14829, reader
     `command_pane_model_from_shell_state_with_default_height_px` :14290) to persist,
     per terminal session: the gxserver session id and the display title. Keep the
     existing policy of NOT persisting command text or scrollback (the daemon owns
     that via zmx). Follow the existing JSON field naming style; missing fields in
     old state files must load cleanly as "no gxserver id" (fresh-create on demand,
     as Phase 1 does).
  2. On restore at startup, for each restored command session that has a gxserver id:
     validate the session still exists on the daemon (the wakeSession RPC response
     covers this), then run the wake/attach flow from Phase 1 and insert the attach
     payload for its mount slot so the GPUI engine re-attaches to the live zmx pane
     (scrollback and running processes revive, like macOS). If the daemon reports the
     session gone, drop that session from the model honestly (matching macOS
     normalization, which keeps only gxserver-backed persisted session ids) — do not
     spawn a substitute local shell.
  3. Sleep/wake: keep the existing "sleep tears down the renderer" model, but wake
     must go through wake/attach re-attach (same helper) instead of spawning a fresh
     default shell, and sleeping must NOT kill the daemon-side zmx session — only
     drop the local PTY/renderer (detach). Verify the drop path in
     `sync_command_gpui_engine_terminals` (:37626-37644 area) results in detach, not
     daemon-session kill; close (user X / close-tab actions) remains the kill path
     from Phase 1.
  4. Tab titles: initialize from the persisted/daemon title and keep following the
     existing OSC TitleChanged event wiring; renames (RenameCommandPaneTab) should
     propagate to the daemon session record the same way Agents/macOS renames do (if
     an update RPC is already used elsewhere in gpui, reuse it; if none exists in
     gpui at all, persist locally and note it in your summary).
- acceptance_criteria:
  - `cd /Users/madda/dev/_active/Ghostex/gpui && cargo check` passes.
  - Code inspection: shell-state writer/reader round-trips gxserver session id +
    title for command sessions, tolerating old state files without those fields.
  - Code inspection: startup restore path calls wake/attach for persisted command
    sessions and inserts attach payloads; a daemon-missing session removes the tab
    rather than spawning a plain shell.
  - Code inspection: wake-from-sleep re-attaches via the daemon attach command;
    sleep does not call the daemon kill endpoint.
  - PHASE 2 COMPLETE printed with a 5-line summary.

## Handoff notes

Phase 1 (COMPLETE): Command terminals are now gxserver-backed. Worker added
`/api/createSession` command-surface creation with `surface:"commands"` + zmx
metadata, reused the wake/attach metadata flow so command terminals spawn the
daemon-built attach command instead of local shells (new tabs, splits, opens, and
Action tabs all route through async gxserver attach; Action execution text goes as
startup text). Added gxserver runtime id mapping, OSC title lookup, and
`/api/transitionSession` + `/api/removeSession` cleanup on close. Only
gpui/src/main.rs changed.

Phase 2 (COMPLETE): Persisted command-pane gxserver project/session ids and display
titles in shell state (old-state tolerant). Startup restore runs awake persisted
command sessions through the Phase 1 wake/attach payload flow; daemon-missing
sessions close honestly. Wake-from-sleep re-attaches via gxserver; sleep no longer
kills/removes daemon sessions. Renames persist locally and sync via
`/api/updateSession`. Only gpui/src/main.rs changed.
