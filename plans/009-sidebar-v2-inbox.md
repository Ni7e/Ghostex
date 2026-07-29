# 009 — Sidebar V2 ("Inbox") for the gpui app

STATUS 2026-07-29: **COMPLETE.** All five phases implemented and independently verified
clean (final targeted confirmation passed: 565 cargo tests, 628 shared tests, 41/41 V2
stories, zero regressions beyond documented foreign breakage). Uncommitted — pending the
user's commit decision.

Canonical spec, agreed with the user on 2026-07-29. Implementation agents: read this whole file
before touching code. This is the single source of truth; if code reality conflicts with this
doc, flag it to the orchestrator instead of improvising.

## Vision

A t3code-style "Sidebar V2": a flat, position-stable inbox of sessions across all projects,
selectable as an opt-in alternative to the current sidebar. The current sidebar (V1) stays
EXACTLY as it is and remains the default. V2 is a presentation layer plus new lifecycle
state — it must never break existing gpui behaviors (session activation, browser tab
activation, pane focus, wake flows all keep using the same message paths).

Reference implementation: `t3code/` (fork of pingdotgg/t3code, branch ghostex, freshly synced
to upstream v0.0.30). Read its code for design/behavior parity; do NOT import from it at
runtime — port and adapt.

Key t3code reference files:
- `t3code/apps/web/src/components/SidebarV2.tsx` — the whole V2 UI (cards, slim rows, shelves, tooltip, snooze popover)
- `t3code/apps/web/src/components/Sidebar.logic.ts` — pure status/sort logic (v2 fns: resolveSidebarV2Status, sortThreadsForSidebarV2, sortSettledThreadsForSidebarV2, resolveSettledTimestamp, formatWorkingDurationLabel, …)
- `t3code/packages/client-runtime/src/state/threadSettled.ts` — effectiveSettled/effectiveSnoozed/canSettle/canSnooze/threadWokeAt predicates
- `t3code/apps/web/src/components/Sidebar.snooze.ts` — DST-safe snooze presets
- `t3code/apps/web/src/sidebarProjectGrouping.ts` + `logicalProject.ts` — cross-machine logical project grouping
- `t3code/apps/web/src/worktreeCleanup.ts`, `t3code/packages/shared/src/git.ts` — orphan detection, temp-branch naming (`t3code/<8hex>`)
- `t3code/apps/server/src/ws.ts:818-870` — atomic lazy worktree bootstrap
- `t3code/apps/web/src/index.css` `[data-sidebar-version]` theming

## Decisions (agreed with user — do not relitigate)

1. **Shape**: flat session inbox (newest-first, position-stable — activity never reorders rows)
   PLUS a **"Group by Project"** sub-mode: collapsible project groups instead of the header
   scope dropdown. In grouped mode each project has its own collapsed **Settled** shelf at the
   bottom of its group. Worktrees roll up under their parent project (no sibling project rows).
2. **Lifecycle**: FULL t3code parity — settle AND snooze. Server-owned state in gxserver-rs:
   `settledAt`, `settledOverride`, `snoozedUntil`, `snoozedAt` per session. Manual
   settle/un-settle (hover ✓ / ↩), snooze presets popover (In 1 hour / This evening /
   Tomorrow 9am / Next week), Snoozed shelf sorted soonest-wake-first, exact-boundary wake
   timers, raised-hand-while-snoozed surfacing, auto-settle (configurable N days inactive,
   default 3; or PR merged/closed), guards: never settle/snooze a working/attention session.
   Capability flags so older gxservers (remote machines) degrade gracefully (affordances hide,
   nothing auto-settles).
3. **Cross-machine logical projects**: auto-group by normalized git `origin` remote URL
   (gxserver-rs probes it, ships in presentation), per-project override (by repo / by
   repo+path / keep separate) stored in the shared settings file. Machine badge on sessions
   from non-local machines. Non-git projects never merge.
4. **Worktree model**: worktree = ATTRIBUTE of a session (cwd + branch), t3code-style, not a
   registered sibling project. Created lazily and atomically server-side; deleting the last
   session pointing at a worktree offers cleanup (with dirty-status awareness). Old
   worktree-as-project registrations keep working in V1 and display merged under the parent in V2.
5. **Creation UX**: plain + click = instant local session (unchanged). Split-button dropdown /
   context item "New worktree session…" opens a COMPACT popover: agent (default last used),
   base branch (default project default branch), "start from origin" toggle, OPTIONAL first
   prompt. gxserver-rs then atomically: create worktree (temp branch `ghostex/<8hex>`) → run
   the project's existing `worktreeCommand` setup → spawn session inside → rollback on failure.
   Auto-rename branch to a descriptive slug later (reuse existing auto-rename machinery).
   Also an "open existing worktree/branch" path (ideas salvaged from the old
   `sidebar/worktree-create-modal.tsx`, which this flow eventually retires). Per-project
   "default new sessions to worktree" setting (mirror of t3code `defaultThreadEnvMode`).
6. **Rollout**: V1 default everywhere; V2 pure opt-in. Toggle surfaced in BOTH: (a) the
   sidebar Sort & Filter menu, (b) the app Settings — as the FIRST setting at the very top,
   marked with a "New" badge. Setting key `sidebarVersion` in `shared/ghostex-settings.ts`
   rides the existing settings file → hud.settings pipeline (no Rust changes needed).
7. **Git/PR data**: server-side in gxserver-rs, shipped via presentation snapshot/deltas.
   Since each worktree session's cwd IS the worktree folder, resolve per-session git state
   from the session cwd: branch, +n/−n diff stats vs merge-base, PR number+state via `gh`
   when available (aggressive caching; extend the existing 60s worktree-topology cache
   pattern). No `gh` → no PR badge, auto-settle falls back to inactivity-only.
8. **Concept translation in V2** (nothing disappears, but inbox-hostile features stay V1-only):
   - Quick/chat sessions → pseudo-project "Quick" in scope filter; normal inbox rows.
   - Browser sessions → in flat mode: a dedicated "Browser" section; clicking a row
     shows/activates the browser tab tied to that project/worktree (existing machine-scoped
     project-id keyed activation paths). In Group-by-Project mode: browser tabs render as
     today, above the agent sessions inside each project group.
   - Project collections → ordering/grouping in Group-by-Project mode + sections in scope dropdown.
   - Pinned sessions → float above the inbox.
   - Tag filters + search → filter the inbox exactly as today.
   - DROPPED from V2 (V1-only): manual sorting, named session sub-groups.
9. **Phasing**: P1 skeleton → P2 lifecycle → P3 git/PR cards → P4 worktree flow → P5
   cross-machine. Each phase shippable behind the toggle.

## Existing architecture (verified 2026-07-29)

- ONE shared React sidebar: `sidebar/sidebar-app.tsx` (~300KB). gpui mounts it via
  `gpui/sidebar/main.tsx` (CEF, `data-sidebar-mode="combined"`); the runtime adapter is
  `gpui/sidebar/gxserver-runtime.ts` (implements the `vscode` WebviewApi + message source).
  The Swift macOS app is DEPRECATED (see AGENTS.md "Active apps vs deprecated apps") —
  do not do work for it; its adapter is `native/sidebar/native-sidebar.tsx`.
- Contracts: `shared/session-grid-contract-sidebar.ts` (`SidebarSessionItem` line ~267,
  `SidebarSessionGroup` ~440, `SidebarHudState` ~615, message unions ~1036/1067).
  gxserver protocol: `shared/gxserver-protocol.ts` (`GxserverPresentationSnapshot` ~1673,
  `...Session` ~1594, `...Delta` ~1683). Projection:
  `shared/gxserver-presentation-sidebar-projection.ts` (+ existing `.test.ts` precedent).
- Settings: schema `shared/ghostex-settings.ts` (`ghostexSettings`, `DEFAULT_ghostex_SETTINGS`,
  `normalizeghostexSettings`); UI `sidebar/settings-modal.tsx` (Sidebar section ~3409,
  `SidebarPresetField` ~11572 is the pattern template); storage
  `GHOSTEX_HOME/state/native-sidebar-settings.json` via `gpui/src/shared_settings.rs`
  (Rust preserves unknown keys — new UI-only settings need NO Rust change).
- Sort & Filter menu: `SidebarReferenceSectionHeader` in `sidebar/sidebar-app.tsx` (~6011),
  menu body ~6366 via `SidebarContextMenuPortal`. Rendered per-section-header → a global
  option must be threaded from SidebarApp state.
  KNOWN GAP: in gpui, `activeSessionsSortMode` is hardcoded in
  `gpui/sidebar/gxserver-runtime.ts` (~14311) and `setActiveSessionsSortMode` is unhandled →
  Manual Sorting silently no-ops in gpui. Do NOT repeat this pattern for V2; `sidebarVersion`
  goes through the settings pipeline instead.
- Current sort logic: `shared/active-sessions-sort.ts` (`createDisplaySessionLayout`).
- Worktree legacy surface (to be superseded in P4 but kept working):
  `sidebar/worktree-create-modal.tsx`, `worktree-delete-modal.tsx`,
  `shared/project-worktree-order.ts`, gxserver endpoints
  `/api/{listProjectWorktrees,createProjectWorktree,openProjectWorktree,mergeWorktreeIntoMain,deleteWorktreeProject,runWorktreeAction}`,
  `gxserver-rs/src/typed_operations.rs` (build_worktree_command ~1039),
  `gxserver-rs/src/domain.rs` (worktree topology probe ~866, 60s TTL cache).
- gpui CSS entry: `sidebar/styles.css` import chain (last import wins). Reskin precedent:
  `sidebar/styles/hierarchy-panels.css` gated reskin; V2 should use a
  `data-sidebar-version="v2"` attribute on the sidebar root for its stylesheet.

## Testing rules (repo law — see AGENTS.md)

- NO tests in `gpui/` and none for the deprecated macOS app.
- Unit tests in `shared/` ARE welcome (existing precedent: `*.test.ts` next to modules) —
  use them for all ported pure logic.
- Storybook is the primary UI verification harness: `bun run storybook` (port 6006, config
  `sidebar/.storybook`). Follow the precedent of `sidebar/sidebar-app.interactions.stories.tsx`
  (mock message source / vscode shim driving the real `SidebarApp`). Every V2 phase must add
  stories exercising its states with mock data (flat mode, grouped mode, shelves, statuses,
  empty states). Verifier agents drive Storybook via CDP.
- Never run `bun run start` or anything that restarts the user's app.
- Temp dev changes to speed up verification are allowed but MUST be clearly marked
  (`// TEMPDEV:` comment) and removed before a phase is declared done.

## Concurrency rules

Multiple agents (ours and others) share this checkout. Re-read files before editing, targeted
edits only, never whole-file rewrites from stale content, never revert foreign hunks, no
commits unless the orchestrator says so. See AGENTS.md.

## Phase acceptance criteria

### P1 — skeleton (no server changes)
- `sidebarVersion: "v1" | "v2"` + `sidebarV2Layout: "flat" | "byProject"` settings keys
  (defaults "v1"/"flat"), normalized + defaulted in `shared/ghostex-settings.ts`.
- Settings modal: new entry rendered at the very TOP of the General settings tab, "New" badge,
  copy pattern from `SidebarPresetField`. Searchable.
- Sort & Filter menu: "Sidebar" radio group (Classic / V2 Inbox) above the sort radios; works
  in gpui (via settings pipeline, not the broken sort-mode channel). When V2 active, a
  "Group by Project" toggle item appears; the Manual Sorting radio is hidden/disabled.
- V2 render tree in new files (e.g. `sidebar/v2/`): flat inbox (position-stable
  creation-order, newest first; pinned float on top; attention/working statuses shown with
  t3code's three-hue system), Group-by-Project mode (collapsible groups, browser tabs above
  agent sessions per group, per-project Settled shelf placeholder), Browser section (flat
  mode), scope filter dropdown fed by projects (+ "Quick"), search + tag filters applied,
  session click / context menu / rename delegate to the SAME message handlers V1 uses.
- Ported pure logic in `shared/sidebar-v2-*.ts` with unit tests (status resolution, sorting,
  settled/snoozed partition — partition can run on derived data until P2 wires real state).
- Storybook stories for all of the above; V1 stories unchanged and passing.
- Zero behavior change when `sidebarVersion` is "v1" (the default).

### P2 — lifecycle (settle/snooze)
- gxserver-rs: session fields settledAt/settledOverride/snoozedUntil/snoozedAt persisted,
  RPCs (settle/unsettle/snooze/unsnooze), presentation fields + deltas, capability flags in
  bootstrap/summary, server-side auto-settle sweep (inactivity, guards per decision 2).
- Client: shelves live, hover actions, snooze popover, wake timers, un-settle, bulk ops via
  existing multi-select if trivial (else defer, note it). `sidebarAutoSettleAfterDays` setting.
- Unit tests in shared/ for predicates; Storybook stories for shelves/popover; gxserver-rs
  `cargo test` where the crate already has test precedent.

### P3 — git/PR cards
- gxserver-rs per-session-cwd probe: branch, diff stats vs merge-base, PR via `gh`
  (cached, throttled, non-blocking); presentation fields; card row 3 UI (branch, PR badge
  colored by state, +n −n); PR-merged/closed auto-settle; tooltip with branch/mismatch info.

### P4 — worktree flow v2
- Per decision 5. Atomic server path with rollback; compact popover; split + button;
  open-existing path; last-session-delete cleanup prompt with dirty check; temp branch
  `ghostex/<8hex>` + auto-rename integration; per-project default-env-mode setting.
  Old modal remains functional until this phase fully replaces its entry points, then its
  entry points switch to the new flow (modal code may remain for V1 delete flow if needed).

### P5 — cross-machine logical projects
- Per decision 3. Remote-URL probe in gxserver-rs → presentation; client logical grouping +
  overrides UI (project context menu / project actions dialog pattern from t3code); machine
  badges; scope filter shows logical projects; Group-by-Project groups merge across machines.

## Status log

- 2026-07-29: Spec written. P1 started (P1a settings/toggle agent + P1b logic-port agent in
  parallel, then P1c UI, then P1v verification loop).
- 2026-07-29: **P1 COMPLETE and verified clean** (implement → adversarial verify → fix →
  re-verify). Sidebar V2 lives in `sidebar/v2/`, logic in `shared/sidebar-v2-*.ts`, settings
  keys `sidebarVersion`/`sidebarV2Layout`, stylesheet `sidebar/styles/sidebar-v2.css`
  (scoped `[data-sidebar-version="v2"]`), 13 passing V2 stories. Notable: sidebar-originated
  `updateSettingsPatch` now actually persists in gpui (rides the app-modal host bridge).
- 2026-07-29: **P2-server COMPLETE**: `gxserver-rs/src/session_lifecycle.rs`, migration 0016,
  endpoints `/api/{settleSession,unsettleSession,snoozeSession,unsnoozeSession}`
  (remote-allowed; settle rejects working+attention, snooze rejects attention only —
  snoozing a WORKING session is allowed by design), presentation fields + snapshot
  `capabilities: {sessionSettlement, sessionSnooze}`, 60s sweep for auto-settle
  (`sidebarAutoSettleAfterDays` read server-side from native-sidebar-settings.json,
  default 3, null/<=0 disables; capped 100 writes/pass).
- ACCEPTED DEVIATIONS — do NOT "fix" these, they are deliberate:
  - Snooze expiry is DERIVED client-side from retained `snoozedUntil` (wake-to-the-ms);
    server GCs spent snooze fields only after +24h so the "Woke" indicator survives.
  - Snoozing a settled session does NOT un-settle it (matches t3code's decider).
  - Auto-settle sets `settledOverride:"settled"` but leaves `settledAt` NULL (so settled
    sort falls back to the activity clock); manual settle stamps `settledAt`.
  - `settledOverride` values are `"settled" | "active"`. Server keeps an internal
    `settledOverrideAt` (not published) so real activity newer than the override clears it.
  - Browser-row ordering in Group-by-Project mode follows V1's activity order (explicit
    user decision), not the position-stable rule.
  - `shared/sidebar-v2-snooze|logical-project|worktree-cleanup.ts` shipped in P1 ahead of
    their consuming phases (intentional).
  - Default/unclassified attention renders `data-kind="input"` with `data-hue="amber"` —
    CSS and tests must key attention colors off `data-hue`, never `data-kind`.
- Known foreign breakage (NOT ours): tests `discover-ghostex-modal-source` +
  `watch-ghostex-video-modal-source`; V1 interaction stories broken at HEAD by a concurrent
  top-row/command-palette rework; `LightOrange` settings story ignores its theme setting.
- 2026-07-29: **P2 COMPLETE and verified clean** (server + client, live isolated-daemon
  matrix passed). Further accepted items: the Woke pill is amber BY DESIGN (t3code parity);
  activity-reset lag on the Settled shelf (≤60s, server-owned override stamp) is inherent
  and correct; client-side auto-settle window vs remote machines' own windows is a known
  P5 item (fix by trusting the remote server's classification / carrying the window
  per-machine). Bulk settle/snooze deferred until V2 has multi-select.
- P3 WIRE CONTRACT (agreed): `GxserverPresentationSession.gitStatus?: { branch: string|null,
  additions: number, deletions: number, prNumber?: number, prState?: "open"|"draft"|
  "merged"|"closed", prUrl?: string, updatedAt: string }` + snapshot capability
  `sessionGitStatus: true`. TS type is owned by the P3-client agent; Rust emit must match
  it exactly. Probes are per unique session CWD (many sessions share one cwd), cached
  (~60s git TTL, ~5min PR TTL), throttled, non-blocking, git commands time-boxed; `gh`
  absent/unauthed → no PR fields, no errors. Diff stats = session cwd worktree vs
  merge-base with the repo default branch (committed-on-branch + uncommitted).
  PR merged/closed → auto-settle eligible immediately (same working/attention guards).
- 2026-07-29: **P3 COMPLETE and verified clean** (live isolated-daemon matrix + Storybook +
  wire-contract byte parity all passed). Optional minors carried forward: probe skips
  pinned-stopped rows (only live sessions probed — semi-intentional); silent cache pruning
  can leave stale gitStatus on published stopped rows until next snapshot; transient gh
  auth flaps drop/restore PR badges one pass (self-healing); light-theme story surface
  stays dark (pre-existing harness limitation). A fixer is bounding the probe's
  reader-join timeout (the one non-time-boxed wait).
- P4 WIRE CONTRACT (agreed): POST `/api/createWorktreeSession`
  `{ projectId, agentId?, baseBranch?, startFromOrigin?, firstPrompt?,
     existingWorktree?: { path: string } }` → `{ sessionId, worktreePath, branch }`;
  server-side atomic sequence (optional fetch origin → `git worktree add -b ghostex/<8hex>`
  → run the project's worktreeCommand setup → create+register the session with
  cwd=worktreePath via the NORMAL gxserver createSession machinery → optional first prompt
  → rollback (remove worktree) if any step fails; reuse existing typed_operations worktree
  command builders + path-safety normalization). `existingWorktree.path` skips creation and
  spawns into that path. Snapshot capability `worktreeSessions: true`. Branch display needs
  NO new fields (P3 gitStatus already shows the worktree's branch from the session cwd).
  Cleanup: POST `/api/removeSessionWorktree` `{ projectId, worktreePath, force? }` →
  `{ removed, dirty?, warnings? }` (dirty check first; force overrides), used by the
  client's "last session in this worktree closed → remove worktree?" prompt.
  Sidebar messages: `createWorktreeSession` (mirror of the endpoint params) and
  `removeSessionWorktree`; TS types owned by the P4-client agent, Rust matches exactly.
  Temp-branch auto-rename: when a temp `ghostex/<8hex>` branch's session gets a real
  (non-temporary) title, server may rename the branch to `ghostex/<slug>`; if wiring into
  the existing title flow is too entangled, defer with a note — do NOT hack it.
- 2026-07-29: **P4 IMPLEMENTED** (server + client, verification pending). Server:
  `gxserver-rs/src/worktree_sessions.rs` + endpoints in server.rs; auto-rename WIRED via a
  60s reconcile pass (marker-stamped sessions, renames once, re-probes git cache);
  worktrees are sibling dirs `<project>-<hex>`, sessions NEVER registered as projects.
  Client: split + button (V2 toolbar + byProject group headers), compact popover on the
  context-menu portal, "New session on <branch>", cleanup prompt with dirty→force
  re-prompt, `requestId`-paired result messages `worktreeSessionResult` /
  `sessionWorktreeRemovalResult`. FURTHER ACCEPTED DEVIATIONS (deliberate):
  - Remote machines: endpoints are RemoteAllowed server-side, but the gpui remote bridge
    allowlist (`gpui/src/main.rs` ~81130/81439) does not carry them yet → the runtime
    REFUSES remote with a clear toast. Flip in P5 (one line per list + param shaper).
  - Global `newSessionsDefaultEnvMode: "local"|"worktree"` (not per-project), surfaced in
    the "+" chevron menu, NOT the Settings modal.
  - `SidebarSessionItem.cwd?` added (projected from existing presentation data) — cleanup
    needs the path; not a server change.
  - Cleanup prompt is a sidebar-document dialog reusing `.confirm-modal-*` chrome (the
    native deleteWorktree modal stays V1-only). "Managed" = the whole `ghostex/` branch
    namespace; anything else is never offered for deletion.
  - `removeSessionWorktree` warnings are plain user-safe strings (never raw git output).
- 2026-07-29: P4 verification: NEEDS FIXES → fix round dispatched. MAJOR: "New session on
  <branch>" fails for project-root sessions (client must hide it when the row's cwd is the
  project root — plain + covers that case). Minors: session-row orphan on identity-apply
  failure; delta failure after provider start must not roll back a live session; failed
  `worktree add` must prune; shared-worktree detection must count sessions by cwd equality
  (not only gitStatus-probed rows); removeSessionWorktree must refuse a REGISTERED worktree
  project's checkout (V1 delete flow owns those). Accepted nits (documented, no fix):
  raw git text on the error channel (pre-existing pattern), adopted-marker sweep cost,
  existingWorktree ignoring baseBranch/startFromOrigin, symlinked-cwd string compare,
  light-theme popover button (harness limitation). Load-dependent V1 story flakes noted
  for future verifiers (9 stable foreign failures; drag/sort/card-actions flake under load).
- P5 WIRE CONTRACT (agreed): `GxserverPresentationProject.gitRemoteOriginUrl?: string|null`
  (probed server-side with TTL caching like the topology probe; null = no origin; absent =
  not yet probed/non-git). Snapshot gains `autoSettleAfterDays?: number|null` — the window
  THAT daemon actually uses — so clients partition each machine's sessions with the right
  window (fixes the P2 remote-window minor). Client-side: logical grouping via the existing
  `shared/sidebar-v2-logical-project.ts` module; per-project grouping overrides stored in
  `ghostex-settings.ts` as `sidebarProjectGroupingOverrides:
  Record<string, "repository"|"repositoryPath"|"separate">` (key = the module's physical
  project key); machine badges on merged rows (remoteMachineContext already exists).
  gpui remote bridge: add createWorktreeSession + removeSessionWorktree to the allowlist in
  gpui/src/main.rs (+ param shaper mirroring the lifecycle shaper), then flip the runtime's
  remote refusal to real routing.
- 2026-07-29: **P4 FIX ROUND COMPLETE** (all six findings fixed, non-vacuously tested).
  **P5 IMPLEMENTED** (server + client; final verification pending). Key P5 facts:
  probe module `gxserver-rs/src/project_git_remote.rs` (10min repo TTL / 30min non-repo,
  family-root keying, piggybacks the 60s git-status task, warm probe on projectAdded);
  P3's git runner is now shared as `run_git_probe_command`. Client: grouping module mode
  renamed `repository_path` → `repositoryPath` (one spelling end-to-end); override key =
  `<machineId>:<normalizedPath>`; `"separate"` stored explicitly; merged groups addressed
  by a representative host group id with memberGroupIds; merging happens AFTER per-daemon
  capability/window/partition decisions; per-machine windows: remote daemon that doesn't
  publish autoSettleAfterDays → NULL window client-side (server override is the source);
  settings source `sidebar:projectGrouping`; override UI = byProject group-header context
  menu only (no Settings-modal control — per-checkout keys aren't a Settings shape);
  remote worktree endpoints allowlisted + shaped in gpui/src/main.rs, runtime routes remote
  (120s create / 60s remove timeouts). 38 V2 stories total.
- 2026-07-29: FINAL VERIFICATION: whole feature clean EXCEPT two P5 findings → last fix
  round dispatched. (1) MAJOR: "Repository + path" override is inert — nothing publishes a
  repository root. CONTRACT ADDITION: presentation project gains
  `gitRepositoryRootPath?: string` (probed via `git rev-parse --show-toplevel` in the same
  project_git_remote cache entry; absent for non-git), client populates
  `repository.rootPath` from it so `repositoryPath` keys become real; tests must use the
  shipped shape. (2) minor: restoring a parked project loses its origin ~60s (warm the
  remote cache on projectUpdated deltas too / don't evict merely-unpublished projects).
  Plus UX fix: choosing "Repository" mode on a split group applies the override to every
  project sharing that repository identity (symmetric one-click re-merge), and the
  remote-probe abandoned-reader log gets its own event name. Accepted (documented, no
  fix): probe-on-create bounded blocking, 24-probes/pass saturation ~240 projects,
  non-`git@` scp spellings not canonicalized, literal "local" machine-id collision,
  Woke/Approval both amber (t3code parity), shelf-header style asymmetry, 260px truncation,
  Storybook light-theme harness limitation.
- 2026-07-29: **FINAL FIX ROUND COMPLETE** (all four items, non-vacuously tested).
  (1) `gitRepositoryRootPath` now rides the SAME `project_git_remote` probe/cache entry/TTL
  as the origin URL (one extra `rev-parse --show-toplevel`, family-root keyed, root changes
  delta exactly like URL changes; two states only — string or ABSENT, no null). Carried
  through protocol → sidebar contract `projectContext` → projection → `toSidebarV2Project`,
  so `repository.rootPath` is finally populated and `repositoryPath` keys are real.
  (2) The `origin` warm now follows PUBLICATION instead of `delta_type == "projectAdded"`
  (`ensure_published_project_git_remote_probed`): a restored parked project carries its
  remote in the delta that restores it, and a parked/hidden project is never probed at all
  (no evict↔warm ping-pong). (3) Choosing "Repository"/"Repository + path" writes the
  override for every VISIBLE row sharing the repository (new `SidebarV2GroupModel.
  repositoryCanonicalKey`), so one click on ANY split row re-merges the set; "Keep separate"
  keeps its narrow scope. (4) The `origin` probe has its own abandoned-reader counter and
  logs `projectGitRemoteReaderAbandoned`.
  Verification: gxserver-rs 565 tests green; new story fixture `sidebar-v2-monorepo` (two
  sub-projects of one checkout + the same sub-path on a remote machine) proves the three
  modes now produce three DIFFERENT lists; 41 V2 stories green (38 + 3); both the
  repositoryPath-splits story and the re-merge step were confirmed to FAIL with their fix
  temporarily removed; live isolated-daemon run confirmed the published root and the
  park→pass→restore no-gap behaviour.
