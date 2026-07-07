# Plan: GPUI sidebar session-creation parity with the macOS app

## Overall goal

The gpui app's sidebar runtime (`gpui/sidebar/gxserver-runtime.ts`) drives session
creation over gxserver HTTP RPCs. The macOS app (`native/sidebar/native-sidebar.tsx`)
is the SOURCE OF TRUTH for behavior. An earlier fix already added
`lifecycleState: "running"` to the two plain-terminal create sites; this plan fixes
the remaining behavioral divergences found by a full audit of every creation flow.

Confirmed divergences to fix:

1. **Remote agent sessions are created but never started, and prompts are never
   delivered.** macOS remote agent flows do: `/api/createAgentSession` →
   `/api/startSessionProvider` → 4s delay → `/api/sendSessionMessage {submit: true,
   text: prompt}` (see `native/sidebar/native-sidebar.tsx:13304-13351`, constant
   `AGENT_PROMPT_READY_DELAY_MS = 4_000` at `native-sidebar.tsx:1567`). The gpui
   runtime has ZERO calls to `/api/startSessionProvider` or `/api/sendSessionMessage`
   (verify with `rg -n "startSessionProvider|sendSessionMessage" gpui/sidebar/gxserver-runtime.ts`).
2. **Local prompt-driven agent sessions never deliver the prompt.** The gpui runtime
   passes the prompt only as `runtimeSettings.firstUserMessage`, which gxserver-rs
   uses ONLY for first-prompt auto-title generation (`gxserver-rs/src/server.rs:1835`,
   `run_first_prompt_auto_title_job`) — nothing server-side or in `gpui/src/main.rs`
   types the prompt into the agent terminal. On macOS the client delivers the prompt
   (startupText append / stageNativeAgentPrompt locally; sendSessionMessage remotely).
3. **Small parity gaps**: OS-integration quick-terminal title fallback, and the
   Search-by-Text flow being modeled as a fake "agent" session instead of a plain
   terminal running a command like macOS does.

## Repo rules every worker MUST follow

- Do NOT write any tests under `gpui/**` or the macOS app trees (repo AGENTS.md rule).
- No fallback code — fix root causes. If the right fix is impossible at this layer,
  print your phase BLOCKED sentinel with the reason instead of hacking around it.
- NEVER run `bun run start` or any command that restarts/relaunches the Ghostex or
  gpui app.
- NEVER run destructive git commands (`git restore .`, `git reset --hard`,
  `git clean`, `rm -rf`, `git stash`). The working tree has uncommitted changes from
  the user and from OTHER agents working concurrently in this repo (including edits
  to `gpui/sidebar/gxserver-runtime.ts`). Keep your edits additive and localized;
  never revert or reformat code you did not write.
- Line numbers in this plan can drift because of concurrent edits — always re-locate
  code by symbol name (`rg -n "<symbol>" <file>`), not by line number.
- Typecheck with `bun run typecheck` from the repo root (expect no output on success).
- Match the file's existing style: CDXC-style block comments are used to document
  non-obvious constraints; add one only where the code cannot express the why.

## Key architecture facts (already verified — do not re-derive)

- gpui local creates use `this.client.rpc("<path>", params)` against the local
  gxserver daemon; remote creates use
  `this.requestRemoteGxserver<T>(machineId, "<path>", params, options?)`.
- `/api/createAgentSession` (handled in `gxserver-rs/src/server.rs:910`, params built
  by `create_agent_session_params_for_project` in `gxserver-rs/src/agents.rs:306`)
  stores an `agentLaunchPlan` whose `startupText` contains ONLY the agent launch
  command. `firstUserMessage` is stored in the plan and runtimeSettings but is never
  typed into the terminal by the daemon.
- `/api/startSessionProvider` (zmx lifecycle, `gxserver-rs/src/zmx.rs`) starts the
  zmx session and consumes the queued agent-launch startupText (the agent command).
  It is safe to call before the pane attaches: the gpui Rust attach path
  (`gpui_prepare_local_workspace_attach_terminal_plan_with_startup_text` in
  `gpui/src/main.rs:65185`) probes provider state and only starts a missing provider,
  so a provider that already exists is attached without re-typing startup text.
- `/api/sendSessionMessage {projectId, sessionId, submit: true, text}` is the bounded
  zmx message endpoint macOS uses to deliver prompts to remote agents; it types the
  text and submits it server-side, so pane visibility does not matter.
- `previousSessionTitle`, restore payloads, and fork payloads in the gpui runtime
  already match macOS remote behavior — do not touch them.

---

## Phase 1: Remote agent-session creation parity (start provider + deliver prompt)

- depends_on: []
- parallel_ok: false
- goal: After the gpui runtime creates an agent session on a REMOTE machine, the
  agent must actually start, and when a prompt exists it must be delivered and
  submitted — exactly like macOS. Today the gpui runtime only creates the domain row
  and refreshes presentation, leaving a dead session until someone manually opens it.
- files: `gpui/sidebar/gxserver-runtime.ts` (only)
- do_not_touch: `native/sidebar/**`, `gxserver-rs/**`, `shared/**`, `gpui/src/**`,
  any local (non-remote) create path, fork/restore flows.
- approach:
  1. Read the macOS reference sequence at `native/sidebar/native-sidebar.tsx`
     function `runRemoteSidebarGitPromptAction` (search for
     `CDXC:RemoteGit 2026-06-03-03:04`): create → `/api/startSessionProvider`
     `{projectId, sessionId}` with `timeoutMs: 15_000` → await 4000ms delay →
     `/api/sendSessionMessage` `{projectId, sessionId, submit: true, text: prompt}`
     with `timeoutMs: 15_000` → refresh presentation snapshot.
  2. In `gpui/sidebar/gxserver-runtime.ts`, add a private helper on the runtime class
     (e.g. `startRemoteAgentSessionAndSendPrompt(machineId, projectId, sessionId,
     prompt?)`) that performs startSessionProvider, and, when a non-empty prompt is
     given, the 4s delay plus sendSessionMessage. Define the 4000ms constant
     mirroring macOS `AGENT_PROMPT_READY_DELAY_MS`.
  3. Wire it into BOTH remote agent create sites, after the create RPC succeeds and
     before/alongside the existing focus + `refreshRemotePresentationFromGxserver`
     calls (keep existing focus/refresh behavior; refresh after the start so the row
     reflects the running provider):
     - `createAgentSession(agentId, groupId)` remote branch (search
       `"/api/createAgentSession"` inside `createAgentSession`): no prompt here →
       start provider only.
     - `createRemoteAgentSessionForProject(remoteScope, agentId, prompt, title)`:
       start provider, then deliver `prompt` when non-empty. This covers remote
       worktree create/open-existing and remote Git workflow flows that already call
       this method.
  4. Keep error handling consistent with each call site's existing pattern (remote
     warning toasts on failure); a failed start/send must not crash the runtime.
- acceptance_criteria:
  - `rg -n "startSessionProvider" gpui/sidebar/gxserver-runtime.ts` shows the helper
    calling it via `requestRemoteGxserver` and both remote create sites using the
    helper.
  - `rg -n "sendSessionMessage" gpui/sidebar/gxserver-runtime.ts` shows prompt
    delivery with `submit: true` and the 4000ms delay before it.
  - The sequence and params match `native/sidebar/native-sidebar.tsx`'s
    `runRemoteSidebarGitPromptAction` (verifier will diff by eye).
  - `bun run typecheck` passes (run from repo root; no output means pass).

## Phase 2: Local prompt-driven agent-session creation parity (deliver the prompt)

- depends_on: [1]
- parallel_ok: false
- goal: Local gpui agent creations that carry a user prompt (project-board "Start
  work", Git workflow prompt actions, "Commit, Push & PR", merge-conflict agent,
  worktree create/open-with-prompt, App Shot) must have the prompt typed into and
  submitted to the agent, like macOS does. Today the prompt only influences the
  auto-generated title; the agent starts (on pane attach) with no prompt.
- files: `gpui/sidebar/gxserver-runtime.ts` (only)
- do_not_touch: `native/sidebar/**`, `gxserver-rs/**`, `shared/**`, `gpui/src/**`,
  remote paths already handled in Phase 1, plain-terminal create paths.
- approach:
  1. First PROVE the current gap and the fix sequence against the live local daemon,
     using a disposable session in a scratch project (create a temp dir under
     `$HOME/tmp` or use `ghostex` CLI): call the local gxserver HTTP API the same way
     the runtime does — `/api/createAgentSession` with
     `runtimeSettings.firstUserMessage` — then `/api/startSessionProvider`, wait ~4s,
     then `/api/sendSessionMessage {submit: true, text}`. Read the pane content
     (`ghostex read-text <sessionId>` or `/api/readSessionText`) to confirm the agent
     received and submitted the prompt, and that the launch command was not typed
     twice. The `ghostex` CLI (see `ghostex --help`) can create/read/kill sessions;
     the daemon's HTTP base URL + auth token can also be found via the CLI config.
     Kill/remove every session and project you create for testing when done
     (`/api/removeSession`, `/api/removeProject` or `ghostex kill-session`).
  2. In `createAgentSessionRecordForProject` (the single local funnel — search
     `private async createAgentSessionRecordForProject`), after a successful create
     and the existing `focusLocalWorkspaceSession` call: when the `prompt` argument
     is non-empty, call local `/api/startSessionProvider` `{projectId, sessionId}`,
     await the same 4000ms constant from Phase 1, then local `/api/sendSessionMessage`
     `{projectId, sessionId, submit: true, text: prompt}` via `this.client.rpc`.
     Reuse/generalize the Phase 1 helper so remote and local share the
     delay/sequence logic (one helper parameterized by transport is ideal; two thin
     wrappers are acceptable if cleaner).
  3. Do NOT make the caller-visible return value async-later; the method may await
     the delivery before returning (macOS also awaits its staging). Preserve the
     existing return record shape.
  4. Plain agent-button launches without a prompt (`createAgentSession` local branch)
     must NOT gain a startSessionProvider call in this phase: the pane opens and
     attaches immediately via `focusLocalWorkspaceSession`, which already starts the
     provider — adding one would be redundant, not parity. Only prompt-carrying
     creations change.
  5. Sanity-check the race: `focusLocalWorkspaceSession` triggers the Rust attach
     which may itself start the provider; the zmx start path is probe-based and
     consume-once for queued startup text, so create → focus → startSessionProvider →
     delay → sendSessionMessage must not double-type the agent command. Your live
     daemon test from step 1 must exercise this exact order.
- acceptance_criteria:
  - Live-daemon proof (paste the pane text into your completion summary): a
    disposable agent session created with the new sequence shows the agent running
    with the prompt submitted exactly once, launch command typed exactly once.
  - `createAgentSessionRecordForProject` performs start + delay + send for non-empty
    prompts, sharing the Phase 1 delay constant/helper.
  - No prompt-less create path calls `sendSessionMessage`.
  - All disposable test sessions/projects are removed afterwards.
  - `bun run typecheck` passes.

## Phase 3: Small creation parity fixes (OS-integration title, Search-by-Text)

- depends_on: [1, 2]
- parallel_ok: false
- goal: Align two remaining creation flows with macOS user-visible behavior.
- files: `gpui/sidebar/gxserver-runtime.ts` (only)
- do_not_touch: `native/sidebar/**`, `gxserver-rs/**`, `shared/**`, `gpui/src/**`.
- approach:
  1. **OS-integration quick terminal title fallback.** macOS
     (`createNativeQuickTerminal`, `native/sidebar/native-sidebar.tsx:38053-38095`)
     titles a `ghostex://terminal` quick terminal as
     `options.title || projectNameFromPath(cwd) || DEFAULT_TERMINAL_SESSION_TITLE`.
     The gpui `createOsIntegrationTerminal` uses `input.title ??
     DEFAULT_TERMINAL_SESSION_TITLE`, skipping the project-name fallback even though
     it already computes `gpuiProjectNameFromPath(input.cwd)` for project
     registration two lines above. Insert the same fallback:
     `input.title ?? gpuiProjectNameFromPath(input.cwd) ?? DEFAULT_TERMINAL_SESSION_TITLE`
     (check `gpuiProjectNameFromPath`'s empty-string behavior and normalize so an
     empty name falls through to the default, matching macOS `projectNameFromPath`).
  2. **Search by Text session shape.** macOS runs Search-by-Text as a PLAIN terminal:
     `createTerminal("Search by Text", withAtuinIgnoredShellHistoryPrefix("gx f\r"),
     ..., {titleSource: "placeholder", ...})` (`native-sidebar.tsx:33791`) — kind
     "terminal", no agentId, placeholder titleSource. The gpui
     `searchPreviousSessionsByText` instead fabricates an agent session with
     `agentId: "search-by-text"`, which lands in domain state as kind "agent" with
     `runtimeSettings.agentName = "search-by-text"` — a fake agent identity macOS
     never creates (wrong row icon semantics, wrong kind, title never syncs).
     Fix by matching macOS semantics with the machinery from Phases 1-2:
     `/api/createSession` with `{kind: "terminal", lifecycleState: "running",
     projectId, surface: "workspace", title: "Search by Text",
     runtimeSettings: {titleSource: "placeholder"}}`, then
     `focusLocalWorkspaceSession(...)`, then `/api/startSessionProvider` — passing
     the command as explicit startup text if the endpoint accepts a `startupText`
     param (verify in `gxserver-rs/src/zmx.rs` `start_session_provider` /
     `create_attach_session_metadata`, which read `params.startupText`), otherwise
     deliver `gx f` via `/api/sendSessionMessage {submit: true}` after the pane is
     up. Prove your chosen mechanism with a disposable live-daemon session exactly
     like Phase 2 step 1 (command runs once, terminal shows the `gx f` UI), then
     clean up. If neither mechanism can deliver the command cleanly without a hack,
     print `PHASE 3 BLOCKED:` with what you found instead of forcing it.
- acceptance_criteria:
  - `createOsIntegrationTerminal` title fallback chain matches macOS
    (`title ?? projectName ?? default`).
  - `searchPreviousSessionsByText` no longer creates an `agentId:
    "search-by-text"` agent session; it creates a terminal-kind session titled
    "Search by Text" with placeholder titleSource and the `gx f` command delivered
    (live-daemon proof pasted in the completion summary, disposable sessions cleaned
    up).
  - `bun run typecheck` passes.

## Handoff notes

(appended by the orchestrator between phases)

### After Phase 1 (COMPLETE)

Phase 1 added to `gpui/sidebar/gxserver-runtime.ts`: a 4000ms delay constant
(`GPUI_AGENT_PROMPT_READY_DELAY_MS`) with a `delayGpuiAgentPromptStep` helper, and a
remote helper `startRemoteAgentSessionAndSendPrompt` that calls
`/api/startSessionProvider` and (for non-empty prompts) delays then calls
`/api/sendSessionMessage {submit: true}`. Both remote agent create sites use it
(direct remote agent create starts only; `createRemoteAgentSessionForProject` starts
and sends the prompt). Phase 2 should REUSE the existing delay constant/helpers
rather than adding new ones. `bun run typecheck` passed after Phase 1.

### After Phase 2 (COMPLETE)

Phase 2 generalized the Phase 1 machinery into shared start/delay/send prompt
delivery with a local variant (`startLocalAgentSessionAndSendPrompt`-style helper).
`createAgentSessionRecordForProject` now: creates → focuses → starts the provider →
waits 4000ms → submits the prompt via local `/api/sendSessionMessage {submit: true}`.
Proved live against the local daemon (marker prompt echoed exactly once) with all
disposable sessions/projects cleaned up. `bun run typecheck` passed. Phase 3 should
reuse these same helpers for Search-by-Text command delivery if startup-text via
`/api/startSessionProvider` is not viable. NOTE: other agents are concurrently
editing the same file (e.g. a `CDXC:GPUIAutomationsOverview` change) — keep edits
additive and re-read before editing.
