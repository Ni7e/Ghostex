# Plan: Port the macOS Automations feature to the GPUI app (finish the remaining gap)

## Overall goal

Port the macOS app's Automations feature to the GPUI app. Recon result: the port
is already ~80% done and the remaining scope is precisely recorded in
`docs/2026-07-02/deferred-out-of-scope.md` item **[8.1]**:

- The automations **backend** (storage, scheduler, executor, result watcher, 7 RPC
  endpoints) lives entirely in the shared gxserver daemon (`gxserver-rs/`) and is
  used by both apps. **Zero backend work needed. Do not touch `gxserver-rs/`.**
- The **per-project Automate workarea** already works in GPUI: `TitlebarMode::Automate`,
  `automate_workarea_runtime_url_from_project_snapshot` (`gpui/src/main.rs:77452`),
  and all `automation*` project-board bridge actions are live in Rust
  (`run_gpui_project_board_automation_request`, `gpui/src/main.rs:79307`), including
  `automationGetAllState` aggregation (`gpui_automation_all_projects_state`, :79378)
  and run-session/worktree navigation.
- **The gap = the Quick "Automations Overview" page** (the all-projects aggregate
  surface) and its entry points. On macOS, the sidebar Automations row and the
  command palette post `openAutomationsPage`; GPUI's runtime answers with a stub
  toast (`gpui/sidebar/gxserver-runtime.ts:4119-4131`, "Decision #6"). The Decision #6
  automate surface has since landed (per-project mode, `CDXC:GPUIAutomateWorkarea
  2026-07-04-23:18`), so this plan lights up the overview.

Definition of done (from deferred-out-of-scope.md [8.1]): a Kanban-slot URL variant
carrying `surface=automations` + `scope=all` for the overview with the macOS
`showBetaFeatures` seed param, plus the sidebar row / palette entries working.

## macOS reference behavior (mirror this)

All in `native/sidebar/native-sidebar.tsx`:

- `openQuickAutomationsPage()` (:38396) = `ensureQuickAutomationsProject()` (:38341)
  then `focusQuickAutomationsProject()` (:38391).
- `ensureQuickAutomationsProject` finds-or-creates a registry project:
  `projectId = "quick-automations"`, `name = "Automations Overview"`,
  `isQuick: true`, `quickKind: "automations"`, path `~/.ghostex/automations`,
  companion pane hidden.
- `createQuickAutomationsProjectEditorUrl` (:38377) builds the page URL with query
  params: `projectName="Automations Overview"`, `projectPath=""` (empty string),
  `projectId="quick-automations"`, `projectEditorId=<automate-mode editor id>`,
  `surface="automations"`, `scope="all"`, `beadsDisplayKey="Automations Overview"`,
  plus `showBetaFeatures=true|false` seed (`setAutomationsExperimentalGateParam`, :38366).
- The sidebar shows one synthetic Quick session row "Automations Overview"
  (detail "All projects") for the quick-automations project
  (`createQuickAutomationsSidebarSession`, :38254; `isQuickAutomationsSidebarReference`,
  :38279), focusable and closable like other Quick utility pages.
- Entry points (shared React, already used by GPUI unchanged): sidebar row
  (`sidebar/sidebar-app.tsx:4051-4053`) and command palette
  (`sidebar/command-palette.tsx:344-349`) both post `{type:"openAutomationsPage"}`.
  Visibility is gated by Show Beta Features in shared React (`sidebar/settings-modal.tsx`);
  no new gating work needed there.

## The GPUI cross-layer contract (both phases implement exactly this)

The sidebar runtime (TS) publishes active-project context via
`createGpuiSidebarActiveProjectContextPayloadFromGroups`
(`gpui/sidebar/active-project-context.ts:130`); Rust builds `GpuiProjectSnapshot`
from it and issues workarea URLs. When the **quick-automations overview** is the
active group, the payload MUST be exactly:

```
activeProjectId:       "quick-automations"
displayName:           "Automations Overview"
projectIconDataUrl:    null
projectPath:           null
isQuickProjectless:    false
workareaAvailability:  { source: false, browser: false, kanban: false, automate: true, manage: false }
surfaceIds:            { automateBoardId: "project-editor:quick-automations:automate" }   // only this id
```

Rust identifies the overview by `active_project_id == GPUI_QUICK_AUTOMATIONS_PROJECT_ID`
(`"quick-automations"`, const already at `gpui/src/main.rs:79121`) and must then:
issue the overview URL (macOS param set above, `kanban.html` base) and land the
workarea on `TitlebarMode::Automate`.

## Repo rules the workers must follow

- **No tests anywhere in `gpui/**` and no tests in the macOS app trees.** Do not add
  test files; do not add `#[cfg(test)]` modules in gpui.
- **No fallbacks.** If something doesn't line up, fix the actual behavior; never
  add try-then-fallback logic to paper over it.
- **Never run `bun run start` or anything that starts/restarts the Ghostex or GPUI
  app.** Verification is static: `cargo check`, `bun run typecheck`, `bunx vite build`.
- Match the existing comment convention: multi-line `CDXC:<Area> <date>:` provenance
  comments citing the macOS function being mirrored (see examples at
  `gpui/src/main.rs:77456` and `gpui/sidebar/gxserver-runtime.ts:4120`).
- Do not modify `gxserver-rs/**`, `native/**`, `sidebar/**` (repo root),
  `shared/**`, or anything outside the files listed for your phase.
- gpui Rust builds: run `cargo check` from inside `gpui/` (rust-toolchain.toml lives
  there). TS: `bun run typecheck` from the repo root. Web bundle:
  `bunx vite build --config gpui/vite.config.ts` from the repo root.

## Phase 1: Rust — Quick Automations Overview workarea support
- depends_on: []
- parallel_ok: true
- goal: Make the GPUI Rust shell accept the quick-automations active-project
  snapshot, issue the overview runtime URL for the Automate workarea slot, and land
  the workarea on the Automate mode when that project is active. Today the automate
  URL builder refuses quick/projectless snapshots and requires a project path, so
  the overview can never render.
- files: `gpui/src/main.rs` (only)
- do_not_touch: `gpui/sidebar/**`, `gpui/src/cef/**`, `gxserver-rs/**`, `native/**`,
  repo-root `sidebar/**`, `shared/**`. No new bridge functions in
  `gpui/src/cef/sidebar_bridge_manifest.rs` — none are needed.
- approach:
  1. In `automate_workarea_runtime_url_from_project_snapshot` (gpui/src/main.rs:77452),
     add the overview branch: when the snapshot's `active_project_id` equals
     `GPUI_QUICK_AUTOMATIONS_PROJECT_ID` (const at :79121) and
     `feature_availability.automate` is true, build the URL from the bundled
     `kanban.html` entry (`gpui_cef_html_entry_url("GHOSTEX_GPUI_KANBAN_URL", "kanban.html")`)
     with EXACTLY the macOS `createQuickAutomationsProjectEditorUrl` param set:
     `projectName="Automations Overview"` (use `GPUI_QUICK_AUTOMATIONS_DISPLAY_TITLE`),
     `projectPath=""` (empty string, NOT omitted), `projectId="quick-automations"`,
     `projectEditorId=<snapshot.surface_ids.automate_board_id>`,
     `surface="automations"`, `scope="all"`,
     `beadsDisplayKey="Automations Overview"`, and the `showBetaFeatures`
     true/false seed from the runtime settings snapshot (same as the existing
     per-project branch). The overview branch must NOT require
     `in_memory_project_path` and must NOT be blocked by `is_quick_projectless`
     (the runtime sends `isQuickProjectless: false` for the overview; identity is
     the project id). The existing per-project branch must remain byte-for-byte
     behaviorally unchanged for every other project id.
  2. Mode landing: when the active project in the snapshot becomes
     `quick-automations` and the current titlebar mode is not `Automate`, select
     `TitlebarMode::Automate` through the same reviewed availability/focus route the
     titlebar and Option+1..5 use (see the availability gate at
     gpui/src/main.rs:3223-3250 which reads `self.project_features.automate`, and the
     per-project titlebar-mode restore path where the active project context is
     applied). Rationale: on macOS, focusing the quick-automations project always
     opens the automate editor surface; Source/Browser/Kanban/Manage are
     unavailable there (the runtime publishes availability false for them, so their
     modes already fall to placeholders/unavailable). Do not invent a new hotkey
     action id and do not add a new sidebar bridge message for this.
  3. Board bridge: no changes expected. `gpui_automation_board_scope` (:79240)
     already lets request-carried project ids win (overview page targets other
     projects), `automationGetAllState` (:79327 dispatch, :79378 impl) already
     aggregates and already excludes the quick-automations project itself, and the
     Kanban|Automate slot dispatch (:31187-31241) already forwards every
     `automation*` action. Read these and confirm the overview surface's requests
     flow; only touch them if something is actually broken for the overview scope.
  4. Add `CDXC:` provenance comments citing the macOS functions mirrored
     (`createQuickAutomationsProjectEditorUrl`, `focusQuickAutomationsProject` in
     `native/sidebar/native-sidebar.tsx`).
- acceptance_criteria:
  - `cd gpui && cargo check` completes with no errors and no new warnings in the
    touched code.
  - Reading `automate_workarea_runtime_url_from_project_snapshot`: a snapshot with
    `active_project_id == "quick-automations"`, `automate` availability true, no
    project path, and `automate_board_id == "project-editor:quick-automations:automate"`
    yields a `kanban.html` URL containing exactly the params
    `projectName=Automations%20Overview`, `projectPath=` (empty),
    `projectId=quick-automations`,
    `projectEditorId=project-editor%3Aquick-automations%3Aautomate`,
    `surface=automations`, `scope=all`, `beadsDisplayKey=Automations%20Overview`,
    and `showBetaFeatures=<seed>`; and a snapshot for any other project id produces
    the same URL as before this change (no `scope` param).
  - Reading the mode-landing code path: activating the quick-automations project
    selects `TitlebarMode::Automate` via the existing availability-gated route; no
    new bridge message, no new hotkey id, no `hitTest`/overlay/window-routing tricks.
  - `rg -n "fallback" ` on your diff shows no new try-then-fallback logic.

## Phase 2: TS runtime — quick-automations project, sidebar row, entry unstub
- depends_on: []
- parallel_ok: true
- goal: Give the GPUI sidebar runtime the macOS Quick "Automations Overview"
  behavior: ensure the quick-automations project exists in the gxserver domain,
  present it as one synthetic Quick row, focus it when `openAutomationsPage`
  arrives (replacing the stub toast), and publish the exact active-project context
  contract Rust consumes.
- files: `gpui/sidebar/gxserver-runtime.ts`, `gpui/sidebar/active-project-context.ts` (only)
- do_not_touch: `gpui/src/**`, `gxserver-rs/**`, `native/**`, repo-root `sidebar/**`,
  `shared/**`, `gpui/vite.config.ts`. Do not add new CEF bridge functions; the
  existing `postActiveProjectContext` payload path carries everything.
- approach:
  1. Ensure-project (AMENDED after a verified blocker): do NOT create a gxserver
     domain row. `gxserver-rs/src/domain.rs:79` always allocates generated `P...`
     ids (`create_unique_project_id`), so a caller-chosen `"quick-automations"` id
     is impossible, and macOS itself never creates this project through the daemon —
     `ensureQuickAutomationsProject` (`native/sidebar/native-sidebar.tsx:38341`)
     writes only the client-side project registry (`writeStoredProjects`). Mirror
     that reality in GPUI: build the quick-automations overview as a
     **runtime-synthetic presentation project/group** inside
     `gpui/sidebar/gxserver-runtime.ts`, the same pattern as the runtime's existing
     synthetic Chats group (see the projection notes at gxserver-runtime.ts:772 and
     the quick-domain handling around :13463). The synthetic group carries
     `projectContext.editor.projectId "quick-automations"` and the display name
     "Automations Overview". The daemon only ever sees `"quick-automations"` as a
     scope identity string in automation RPC params, which both aggregation walks
     already filter out. Lifetime is session-local: the synthetic group exists from
     the first `openAutomationsPage` until the user closes its row (no persistence;
     this is an accepted, documented delta from macOS's persisted stored-project —
     note it in your COMPLETE summary).
  2. Sidebar row: mirror macOS `createQuickAutomationsSidebarSession` (:38254) and
     `isQuickAutomationsSidebarReference` (:38279) in the runtime's quick-domain
     presentation projection (the code around gxserver-runtime.ts:13463-13520 that
     routes quick domain projects): one synthetic session row titled
     "Automations Overview", detail "All projects", under the Quick group,
     focusable and closable like other Quick utility rows.
  3. Entry unstub: replace the `case "openAutomationsPage"` stub toast
     (gxserver-runtime.ts:4119-4131) with the real flow: ensure the project, focus
     it through the existing presentation focus path (macOS
     `focusQuickAutomationsProject`, :38391), which must result in the
     active-project context repost below. Also route focusing the synthetic Quick
     row itself to the same flow.
  4. Context contract: when the quick-automations group is active, the payload from
     `createGpuiSidebarActiveProjectContextPayloadFromGroups`
     (active-project-context.ts:130) must be exactly the contract in the plan
     header: `activeProjectId "quick-automations"`, `displayName "Automations
     Overview"`, `projectPath null`, `isQuickProjectless false`,
     availability `{source:false, browser:false, kanban:false, automate:true,
     manage:false}`, surfaceIds only
     `automateBoardId: "project-editor:quick-automations:automate"` (the existing
     `nativeProjectEditorSurfaceId` helper already produces this shape). Today
     `createGpuiProjectPayloadFromActiveGroup` (:152) hardcodes
     source/browser/kanban true — add an explicit quick-automations branch rather
     than loosening the general path. The group's `projectContext.editor.projectId`
     must be `"quick-automations"` so `explicitEditorProjectId` accepts it.
  5. Add `CDXC:` provenance comments citing the macOS functions mirrored.
- acceptance_criteria:
  - `bun run typecheck` (repo root) passes.
  - `bunx vite build --config gpui/vite.config.ts` (repo root) succeeds.
  - Reading the diff: `openAutomationsPage` no longer posts the stub toast and the
    "Decision #6" stub comment is gone; the flow is ensure → focus → context repost.
  - Reading `active-project-context.ts`: the quick-automations active group produces
    exactly the header contract payload (field-for-field), and every other project's
    payload is unchanged.
  - The synthetic "Automations Overview" Quick row projection exists and is keyed to
    the quick-automations project only.
  - No new fallback logic; blocked findings reported via the sentinel instead.

## Phase 3: Integration verification and seam fixes
- depends_on: [1, 2]
- parallel_ok: false
- goal: Phases 1 and 2 were written against a shared contract by independent
  agents. Verify the two sides actually mate, fix any seam mismatches, and prove
  the whole feature builds. Static verification only — never launch the app.
- files: `gpui/src/main.rs`, `gpui/sidebar/gxserver-runtime.ts`,
  `gpui/sidebar/active-project-context.ts` (seam fixes only; keep changes minimal)
- do_not_touch: everything else, same exclusions as Phases 1-2.
- approach:
  1. Read the Handoff notes section below for what Phases 1 and 2 actually did.
  2. Trace the full flow end-to-end in code and check each hop against the plan
     header contract: shared React posts `openAutomationsPage` → runtime ensures +
     focuses quick-automations → active-project context payload (exact fields) →
     Rust snapshot accepts id "quick-automations" → overview URL params (exact set,
     `scope=all`, empty `projectPath`, `showBetaFeatures` seed) → Automate mode
     lands → overview page board requests (`automationGetAllState`,
     `automationOpenRunSession`, per-project `automation*` with request-carried
     projectId) reach `run_gpui_project_board_automation_request`.
  3. Check the surface-id string agrees on both sides
     (`project-editor:quick-automations:automate`, note Rust URL-encodes `:` as
     `%3A` in query params — verify encoding consistency with how the per-project
     automate surface already round-trips its editor id).
  4. Fix any mismatch at the seam (smallest correct change, no fallbacks).
  5. Run all three build gates.
- acceptance_criteria:
  - `cd gpui && cargo check` passes.
  - `bun run typecheck` passes (repo root).
  - `bunx vite build --config gpui/vite.config.ts` succeeds (repo root).
  - A written trace (in your COMPLETE summary) of the six hops in step 2 with
    file:line evidence for each, confirming field-for-field contract agreement.
  - Diff scope (AMENDED): the worktree contained pre-existing unrelated
    modifications before this plan started; they are out of scope and must be left
    untouched. The pre-existing dirty set is: `docs/ghostex-high-level-architecture.excalidraw`,
    `editor/scripts/build-editor-app.sh`, `gpui/native/macos/GpuiCefAppKitHooks.m`,
    `gpui/src/main.rs` (had pre-existing edits BEFORE Phase 1 — do not try to
    separate or revert them), `native/macos/ghostexHost/Sources/Shared/GhostexAppStorage.swift`,
    `native/macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift`,
    `native/macos/ghostexHost/Sources/ghostexHost/SessionStatusIndicatorController.swift`,
    `native/macos/ghostexHost/Sources/ghostexHost/TerminalFocusDebugLog.swift`,
    `native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift`,
    `native/macos/ghostexHost/build-ghostex-host.sh`, `native/sidebar/native-sidebar.tsx`,
    `native/sidebar/titlebar-host.tsx`, `shared/ghostex-settings.ts`,
    `shared/gpui-agents-hub-scanner-parity.test.ts`, `shared/session-grid-contract-sidebar.ts`,
    `sidebar/previous-sessions-modal.tsx`, `sidebar/styles/modals.css`, plus
    untracked `docs/drawing.excalidraw` and `docs/2026-07-08/` (this plan). The
    criterion passes if `git status --short` shows NO modified files beyond that
    pre-existing set plus the three Phase-owned gpui files
    (`gpui/src/main.rs`, `gpui/sidebar/gxserver-runtime.ts`,
    `gpui/sidebar/active-project-context.ts`).

## Handoff notes

(Orchestrator appends 2-3 line summaries of completed phases here before
launching dependent phases.)

### Phase 1 (COMPLETE)
Added quick-automations Automate URL support in `gpui/src/main.rs`: overview branch
builds the kanban.html URL with empty `projectPath`, `scope=all`, beta seed, and
overview identity params; the per-project Automate URL path is unchanged (no
`scope` param). The quick-automations snapshot contract accepts `source: false`,
and activating quick-automations lands on `TitlebarMode::Automate` via
`set_active_mode`. `cargo check` passed; only pre-existing unrelated warnings.

### Phase 2 note
Phase 2 initially reported BLOCKED because gxserver `/api/createProject` cannot
accept a caller-chosen project id. Plan step 1 was amended (see above): the
overview is a runtime-synthetic presentation project/group, matching macOS's
client-side registry reality; no daemon row is created.

### Phase 2 (COMPLETE, after amendment)
Added a session-local synthetic Quick "Automations Overview" row (no gxserver
persistence, no daemon lifecycle calls), replaced the `openAutomationsPage` stub
with ensure → focus → active-context repost, wired synthetic row focus/close
handling, and published the exact quick-automations Automate-only active-project
payload from `active-project-context.ts`. Verified with `bun run typecheck` and
`bunx vite build --config gpui/vite.config.ts`.
