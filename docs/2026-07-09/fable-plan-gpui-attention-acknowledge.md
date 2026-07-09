# Plan: Port macOS attention-acknowledge behavior to the gpui app

## Overall goal

In the gpui app, sessions marked `attention` in the sidebar do not clear when the user
clicks the session in the sidebar or clicks the terminal pane itself. In the macOS app both
actions clear attention. The macOS app is the source of truth; port its behavior to gpui.

Root cause (already diagnosed — do not re-derive):

- gxserver (shared Rust backend, `gxserver-rs/`) already owns the full attention state
  machine. `POST /api/updateAgentActivity` with `event: "acknowledge"` transitions the
  session to `activity: "idle"`, `isAcknowledged: true` (`gxserver-rs/src/session_status.rs:198-204`,
  endpoint at `gxserver-rs/src/agents.rs:3061`), and the cleared state is pushed to all
  clients via `presentationDelta` broadcasts. No server changes are needed.
- The macOS app's host-side orchestration lives in `native/sidebar/native-sidebar.tsx`:
  `acknowledgeNativeTerminalAttention` (line ~29563) + `completeNativeTerminalAttentionAcknowledgement`
  (~29607) — a 1.5s minimum-visible floor, an optimistic local presentation clear, a
  locally-acknowledged attention-eventId dedup against stale replays, and the
  `event: "acknowledge"` RPC via `syncNativeSessionActivityWithGxserver` (~25947-25969).
  Triggers: sidebar row focus (~27912), terminal pane click/focus via the `terminalFocused`
  host event (~49842-49946), native pane tab selected (~50399).
- The gpui app never sends `event: "acknowledge"` anywhere. Its sidebar runtime
  (`gpui/sidebar/gxserver-runtime.ts`) renders attention from the gxserver presentation
  stream but its `focusSession` path (~4630-4721) does no acknowledgement. The Rust side
  (`gpui/src/main.rs`) detects terminal-pane clicks and tab/pane focus and calls
  `acknowledge_attention_for_session_activation` (~10554-10570), but that only mutates a
  local in-memory `AgentTerminalActivity` enum — nothing reaches gxserver, so the sidebar
  indicator (driven by the presentation stream) never clears.

## Repo rules all workers MUST follow

- Do NOT write any tests in `gpui/**` (or the macOS app). Acceptance is by typecheck /
  cargo check / code inspection only.
- No fallbacks-instead-of-fixes. Implement the correct behavior directly; do not add
  defensive alternate paths that hide failures.
- NEVER run `bun run start`, `bun run gpui`, or anything that starts/restarts the app.
- The worktree has unrelated uncommitted changes in many files (including
  `gpui/sidebar/gxserver-runtime.ts` and `gpui/src/main.rs`). NEVER run `git restore`,
  `git checkout --`, `git reset`, `git clean`, or `git stash`. Only edit files listed in
  your phase; build on top of the current working-tree content.
- Do not commit anything.
- Match surrounding code style, naming (`gpui_*` / `Gpui*` prefixes), and the existing
  comment conventions in each file. gxserver-runtime.ts keeps its top-level helpers and
  message-type constants in specific regions — mirror how the terminal-bell feature is laid
  out and place new code alongside its analogs.
- Rust edits must compile with `cargo check` run inside `gpui/`. TS edits must pass
  `bun run typecheck` from the repo root.

## Pinned cross-phase contract (both phases must use EXACTLY this)

New Rust -> sidebar-JS bridge event, mirroring the existing terminal-bell event
(`ghostex.gpui.sidebar.workspaceTerminalBell`, see `gpui/src/main.rs:514`, `:42587-42612`,
`:67428-67432` and `gpui/sidebar/gxserver-runtime.ts:497`, `:989-991`, `:1109-1114`,
`:2337-2368`, `:13108-13111`):

- Message type string: `ghostex.gpui.sidebar.workspaceSessionAttentionAcknowledge`
- Message version: `1`
- Payload JSON: `{ "projectId": string, "sessionId": string, "type": <type string>, "version": 1 }`
  where projectId/sessionId are the gxserver identity from `local_workspace_session_mappings`
  (same reverse lookup the bell dispatch does).
- JS bridge callback name: `bridge.onWorkspaceSessionAttentionAcknowledge(payload)`
- JS pending-queue name: `bridge.pendingWorkspaceSessionAttentionAcknowledgements` (array,
  same install/flush pattern as `pendingWorkspaceTerminalBells`).

The acknowledge RPC (TS side only):
`this.client.rpc("/api/updateAgentActivity", { ...(agentName ? { agentName } : {}), event: "acknowledge", projectId, sessionId })`
— same shape as the existing bell RPC at `gpui/sidebar/gxserver-runtime.ts:2337-2368` but with
`event: "acknowledge"`.

---

## Phase 1: Sidebar-runtime acknowledge orchestration (TypeScript)

- depends_on: []
- parallel_ok: true
- goal: Port the macOS attention-acknowledge orchestration into the gpui sidebar runtime so
  that (a) clicking/focusing a session in the gpui sidebar whose presentation activity is
  `attention` acknowledges it, and (b) a new bridge entry point lets the Rust workspace
  report terminal-pane interactions that must acknowledge attention the same way. All
  acknowledge decisions and the gxserver RPC live here in TS; Rust only reports interactions.
- files: `gpui/sidebar/gxserver-runtime.ts` (this phase owns the whole file)
- do_not_touch: `gpui/src/**` (Phase 2 owns it), everything else in the repo.
- approach:
  1. Read the macOS source of truth first: `native/sidebar/native-sidebar.tsx` —
     `acknowledgeNativeTerminalAttention` (~29563), `completeNativeTerminalAttentionAcknowledgement`
     (~29607-29690), `setGxserverPresentationSessionActivityLocally` (~4233, drops the
     `attention` field when clearing, ~4258-4263), `markNativeAttentionEventLocallyAcknowledged`
     (~8943) and its consumption in `applyGxserverSessionActivityResult` (~25896-25899),
     `syncNativeSessionActivityWithGxserver` (~25947-25969),
     `handleNativeSessionEnteredAttention` (~8996) and `clearNativeSessionAttentionTracking`
     (~9036), plus the constant `NATIVE_MIN_ATTENTION_VISIBLE_MS = 1500` (~1563).
  2. In `gpui/sidebar/gxserver-runtime.ts`, add the acknowledge machinery to the runtime
     class, mirroring macOS semantics adapted to the gpui runtime's own presentation store:
     - Track attention-entered timestamps and current attention eventIds per session. The
       runtime already detects attention edges in `detectSessionAttentionCompletionSounds`
       (~3202-3280) using `session.attention?.eventId` / `acknowledged`; extend the same
       presentation-apply path to also record `enteredAt` (local clock) and `eventId` per
       session, and clear tracking when a session leaves attention or is removed.
     - `acknowledgeSessionAttention(sessionId, reason)` (name it in gpui style): no-op
       unless the session's current presentation activity is `attention`. Enforce the 1.5s
       minimum-visible floor exactly like macOS: if attention has been visible < 1500ms,
       schedule completion via setTimeout for the remainder (dedup so only one pending timer
       per session; cancel it if attention gets cleared some other way); otherwise complete
       immediately.
     - Completion does, in order: mark the session's current attention eventId as locally
       acknowledged (dedup set), optimistically mutate the local presentation store — set the
       session's activity to `idle` and drop its `attention` state — and re-publish so the
       sidebar UI, status indicators (`postSessionStatusIndicators`), pet overlay counts, and
       menu-bar counts all update immediately, then fire the RPC
       `/api/updateAgentActivity` with `event: "acknowledge"` (include `agentName` when the
       session has one, matching the bell handler's pattern). The gpui runtime already has a
       local presentation mutation precedent (`setLocalPresentationSessionFocus`, used near
       ~4691); follow that pattern for the activity mutation rather than inventing a new
       store mechanism.
     - Stale-replay guard: when applying an incoming presentation snapshot/delta, if a
       session arrives with `activity: "attention"` and an attention eventId that is in the
       locally-acknowledged set, project it as `idle` (attention cleared) instead — exactly
       why macOS keeps `markNativeAttentionEventLocallyAcknowledged` (~25896-25899). A NEW
       attention eventId must display normally and must clear that session's entry from the
       dedup set.
  3. Hook sidebar focus: in `focusSession` (~4630-4675) — covering the local live path, the
     sleeping/wake path, and the shared session-card `focusSession` message route — call
     `acknowledgeSessionAttention(sessionId, "sidebar-focus")` when the session's
     presentation activity is `attention`. (The shared card in `sidebar/sortable-session-card.tsx`
     computes `shouldAcknowledgeAttention` at ~2382 and posts a plain `focusSession` message;
     the host is responsible for acknowledging on focus — that is this hook.)
  4. Hook native interactions: install `bridge.onWorkspaceSessionAttentionAcknowledge` and
     flush `bridge.pendingWorkspaceSessionAttentionAcknowledgements` using the EXACT names
     and payload shape from the pinned contract, wired at the same two places the bell
     callback is wired (~989-991 install, ~1109-1114 pending flush). The handler validates
     the payload (mirror `normalizeGpuiWorkspaceTerminalBell`, ~13165, including type/version
     check) and then calls `acknowledgeSessionAttention(sessionId, "native-focus")`. Because
     the acknowledge function no-ops when the session is not in attention, duplicate reports
     (e.g. sidebar click also causing a Rust-side focus report) are harmless — do NOT add
     extra suppression logic beyond that.
  5. Remote sessions: if the gpui runtime tracks remote presentation sessions with activity
     (check the `focusSession` remote branch ~4636 and any remote presentation store), mirror
     macOS `acknowledgeRemotePresentationSessionAttention` (`native-sidebar.tsx` ~35258-35277:
     remote `/api/updateAgentActivity` with `event: "acknowledge"` + local clear). If the
     gpui runtime has no remote presentation activity surface yet, skip remote and note that
     in your completion summary — do not build new remote infrastructure.
  6. Do NOT port macOS session-state-file ack persistence (`persistNativeSessionAttentionAcknowledged`)
     — gpui has no native session-state files; the gxserver round-trip is the durable store.
- acceptance_criteria:
  - `bun run typecheck` (repo root) passes.
  - `rg -n '"acknowledge"' gpui/sidebar/gxserver-runtime.ts` shows an
    `/api/updateAgentActivity` RPC with `event: "acknowledge"`.
  - `rg -n "onWorkspaceSessionAttentionAcknowledge|pendingWorkspaceSessionAttentionAcknowledgements" gpui/sidebar/gxserver-runtime.ts`
    shows both the install-time callback assignment and the pending-queue flush, using
    exactly the pinned names.
  - `rg -n "workspaceSessionAttentionAcknowledge" gpui/sidebar/gxserver-runtime.ts` shows the
    pinned message-type constant `ghostex.gpui.sidebar.workspaceSessionAttentionAcknowledge`.
  - `focusSession` path invokes the acknowledge function for attention sessions (code
    inspection: point to the call site in your summary).
  - The acknowledge completion performs BOTH the optimistic local presentation clear
    (activity -> idle, attention dropped, indicators re-published) AND the RPC; the 1.5s
    minimum-visible floor and the locally-acknowledged eventId stale-replay guard are
    present (code inspection: name the functions in your summary).

## Phase 2: Rust workspace interaction dispatch (gpui/src/main.rs)

- depends_on: []
- parallel_ok: true
- goal: When the user interacts with an Agents terminal in the gpui workspace (clicks the
  terminal pane content, clicks its tab, focuses its pane, clicks its chrome while it has
  attention), Rust reports that interaction to the sidebar webview via the pinned bridge
  event so the TS runtime (Phase 1) can acknowledge gxserver attention. Rust makes NO
  acknowledge decision itself — it only reports the interaction; the TS side gates on actual
  attention state.
- files: `gpui/src/main.rs` only.
- do_not_touch: `gpui/sidebar/**` (Phase 1 owns it), `gpui/src/cef/**` (not needed — this is
  a Rust->JS app-owned-script dispatch like the bell, not a JS->Rust bridge message, so no
  manifest change), everything else.
- approach:
  1. Study the existing bell dispatch as the exact template:
     `dispatch_gpui_workspace_terminal_bell` at `gpui/src/main.rs:~42587-42612` (reverse
     lookup of `local_workspace_session_mappings` to get the gxserver
     `{project_id, session_id}` key, build a JSON message with `type` + `version`, execute
     via `sidebar.update(cx, |surface, _| surface.execute_app_owned_script(&script))`), the
     message-type const at `:~514`, and the script builder
     `gpui_workspace_terminal_bell_script` at `:~67428-67432` (note the pending-queue
     fallback shape — the acknowledge script must use the queue name from the pinned
     contract: `pendingWorkspaceSessionAttentionAcknowledgements`).
  2. Add: a message-type const `ghostex.gpui.sidebar.workspaceSessionAttentionAcknowledge`
     (version 1) next to the bell const; a script builder mirroring the bell one but calling
     `bridge.onWorkspaceSessionAttentionAcknowledge` with pending queue
     `bridge.pendingWorkspaceSessionAttentionAcknowledgements`; and a dispatch method
     `dispatch_gpui_workspace_session_attention_acknowledge(&mut self, shell_session_id, cx)`
     mirroring the bell dispatch (silently returns when the terminal has no
     `local_workspace_session_mappings` entry — command terminals and unmapped panes are not
     gxserver sessions and must not dispatch).
  3. Call the dispatch from USER-INTERACTION sites only. The existing local-activity
     acknowledge sites map the interactions; the ones that correspond to direct user input
     are the ones to instrument (read each and confirm it is user-driven, not programmatic
     restore/session-creation plumbing):
     - Terminal content mouse-down handler at `main.rs:~35480-35528` (both the mapped-sleeping
       branch ~35495 and the live branch ~35517, next to the existing local
       `acknowledge_attention_for_session_activation` calls).
     - Chrome-click acknowledge helper `acknowledge_agents_pane_attention_from_chrome_click`
       at `~35326-35340`.
     - User-driven tab selection / pane focus: `select_tab` (~10527-10541) and `focus_pane`
       (~10520-10525) — BUT check their callers first. If they run during programmatic
       session restore or tab creation, dispatching from inside them would wrongly clear
       attention the user never saw (macOS only acknowledges on real user focus events).
       If callers are mixed, instrument the user-driven call sites (click/keyboard handlers)
       instead of the shared function body. State in your completion summary exactly which
       call sites you instrumented and why.
     Do NOT gate dispatch on the local `AgentTerminalActivity` value — that local model is a
     placeholder and is not reliably synced with gxserver attention; the TS side is the
     authority and no-ops when the session is not in attention. Keep the existing local
     `acknowledge_attention_for_session_activation` behavior unchanged (it still clears the
     local dot).
  4. Also check the attention-notification click path
     (`GhostexGpuiSessionAttentionNotificationClicked`, `main.rs:~420`): if its routing ends
     in one of the instrumented focus paths, nothing more is needed; if it focuses the
     session through a different path, dispatch there too (macOS clears attention on
     notification click via the same focus->acknowledge route).
- acceptance_criteria:
  - `cargo check` run inside `gpui/` passes.
  - `rg -n "workspaceSessionAttentionAcknowledge" gpui/src/main.rs` shows the const, the
    script builder, and the dispatch method, using exactly the pinned names/strings.
  - The terminal-content mouse-down handler (~35480-35528) and the chrome-click helper
    (~35326-35340) both dispatch; tab-select/pane-focus user paths dispatch (with the
    programmatic-path analysis reported in the summary).
  - No changes outside `gpui/src/main.rs`; no gating on local `AgentTerminalActivity` for
    the dispatch decision.

## Phase 3: Terminal ESC parity (escape event + done-suppression)

- depends_on: [1, 2]
- parallel_ok: false
- goal: Port the macOS "user pressed ESC in the terminal" attention/done handling to gpui:
  pressing ESC in a focused, mapped Agents terminal clears an active attention state and
  sends `event: "escape"` to gxserver (which applies a short attentionSuppressedUntil window
  server-side, `gxserver-rs/src/session_status.rs:206-223`), mirroring
  `native/sidebar/native-sidebar.tsx:50063-50072` (`terminalEscapePressed` host event ->
  `suppressNativeDoneAfterTerminalEscape` (~22658) + `syncNativeSessionActivityWithGxserver`
  with `{ event: "escape" }`).
- files: `gpui/src/main.rs` (ESC detection + bridge dispatch), `gpui/sidebar/gxserver-runtime.ts`
  (bridge handler + escape flow).
- do_not_touch: `gpui/src/terminal_element.rs` input encoding / key-event consumption — ESC
  must still reach the terminal exactly as before; you may only OBSERVE the keypress, never
  consume or reorder it. Do not touch `gpui/src/cef/**` or shared/ or native/.
- approach:
  1. Read the macOS behavior precisely first: `native-sidebar.tsx` ~50063-50072 (host event
     handling), `suppressNativeDoneAfterTerminalEscape` ~22658-22700 (local attention clear +
     locally-acknowledged eventId mark + local presentation clear + done-suppression window
     `NATIVE_ESCAPE_DONE_SUPPRESSION_MS`), and the Swift emitter in
     `native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift` (search
     `terminalEscapePressed`) to see exactly when macOS emits it (plain ESC keydown on a
     focused terminal — check modifiers/repeat handling and match it).
  2. Rust: find where key events for a focused Agents terminal are handled in
     `gpui/src/main.rs` (the terminal key input path — search for how keystrokes reach the
     terminal/ghostty surface; see also `terminal_element.rs` key handling for the element
     path, but do not modify input forwarding there). At the point where a plain ESC keydown
     (no modifiers) is observed for a mapped Agents terminal, dispatch a new bridge event
     mirroring Phase 2's pattern: message type
     `ghostex.gpui.sidebar.workspaceTerminalEscapePressed`, version 1, payload
     `{ projectId, sessionId, type, version }`, callback
     `bridge.onWorkspaceTerminalEscapePressed`, pending queue
     `bridge.pendingWorkspaceTerminalEscapePresses`. Observation only — the key must still be
     delivered to the terminal unchanged.
  3. TS: add the bridge handler (install + pending flush, same two wiring points as bell and
     the Phase 1 acknowledge callback). Handler validates payload, then mirrors
     `suppressNativeDoneAfterTerminalEscape` semantics adapted to the gpui runtime: if the
     session's presentation activity is `attention`, mark its attention eventId locally
     acknowledged (reuse Phase 1 machinery, reason "terminal-escape"), clear it locally, and
     re-publish; regardless of local attention state, fire the RPC
     `/api/updateAgentActivity` with `{ event: "escape", projectId, sessionId, agentName? }`.
     Port the local done-suppression window ONLY if the gpui runtime has the equivalent
     done/completion-sound surface that macOS suppresses (`detectSessionAttentionCompletionSounds`
     exists — suppress completion sounds for that session for the same window macOS uses,
     `NATIVE_ESCAPE_DONE_SUPPRESSION_MS`); mirror the macOS constant value.
  4. Rate/noise: macOS emits per ESC keydown; gxserver treats escape idempotently (it just
     refreshes a 5s suppression window). Do not add client-side debouncing that macOS does
     not have, but do confirm ESC key-repeat does not flood (check what macOS does with
     repeats and match it).
- acceptance_criteria:
  - `cargo check` (in `gpui/`) and `bun run typecheck` (repo root) both pass.
  - `rg -n "workspaceTerminalEscapePressed" gpui/src/main.rs gpui/sidebar/gxserver-runtime.ts`
    shows the const + dispatch in Rust and the handler wiring in TS.
  - `rg -n '"escape"' gpui/sidebar/gxserver-runtime.ts` shows the
    `/api/updateAgentActivity` RPC with `event: "escape"`.
  - ESC forwarding to the terminal is unchanged (no modification to how the key event is
    consumed/encoded — inspection: state in the summary where you observe the key and why it
    cannot swallow or reorder input).
  - Attention clear on ESC reuses the Phase 1 acknowledge/dedup machinery rather than
    duplicating it.

## Handoff notes

- Phase 1 COMPLETE: `gpui/sidebar/gxserver-runtime.ts` now has the pinned
  `workspaceSessionAttentionAcknowledge` bridge callback + pending queue,
  `acknowledgeSessionAttention(sessionId, reason)` called from `focusSession` for both
  remote and local paths (~lines 5161/5183),
  `completePresentationSessionAttentionAcknowledgement` (local idle clear + republish +
  `event: "acknowledge"` RPC), `GPUI_MIN_ATTENTION_VISIBLE_MS` 1.5s floor, attention
  tracking maps, and `projectPresentationAttentionAcknowledgementGuards` stale-eventId
  replay guard. `bun run typecheck` passes. Phase 3 should reuse the
  `acknowledgeSessionAttention` / locally-acknowledged eventId machinery for the ESC flow.
- Phase 3 COMPLETE: `workspaceTerminalEscapePressed` Rust->sidebar bridge dispatch added
  after successful native Ghostty forwarding for plain ESC press/repeat on mapped Agents
  terminal views; `onWorkspaceTerminalEscapePressed` + `pendingWorkspaceTerminalEscapePresses`
  wired in `gpui/sidebar/gxserver-runtime.ts` with strict payload validation; ESC handling
  reuses Phase 1 local attention clear/dedup, publishes immediately, and sends
  `/api/updateAgentActivity` with `event: "escape"`; 5s ESC completion-sound suppression
  added. `cargo check` and `bun run typecheck` both pass.
- Phase 2 COMPLETE: Added the pinned `workspaceSessionAttentionAcknowledge` const, script
  builder, and mapped-session dispatch in `gpui/src/main.rs`. Wired terminal content
  activation/focus, pane chrome clicks, user tab selection, double-click, Ctrl-Tab, and
  spatial pane-focus wrappers; shared model restore/create paths left uninstrumented.
  Notification clicks already route through sidebar status/pet activation, so no separate
  Rust dispatch was needed. `cargo check` in `gpui/` passes.
