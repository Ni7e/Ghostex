# Plan: GPUI titlebar parity with the macOS app (views + missing views working)

## Overall goal

Make the GPUI app titlebar (`gpui/src/main.rs`, `render_titlebar` ~line 41777) present the
same set of views/controls as the macOS app titlebar (React strip `native/sidebar/titlebar-host.tsx`
hosted by `native/macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift`), and bring over the
views that are missing so they actually work in the GPUI app.

Current confirmed gaps (from a full inventory of both titlebars):

1. **Mode switcher**: macOS shows 6 tabs in this order — `Agents, Source, Browser, Kanban, Automate, Docs`
   (title case; "Docs" is the display label for the internal `manage` mode — see
   `native/sidebar/titlebar-host.tsx:4330-4384`). GPUI's `TitlebarMode` enum
   (`gpui/src/main.rs:2250`) has only `Agents, Source, Browser, Kanban, Manage`, labels the last
   one "Manage", and hides it unless `debuggingMode && showBetaFeatures`. Missing: the **Automate**
   tab entirely; wrong label and visibility policy for **Docs**.
2. **Automate workarea**: does not exist in GPUI at all. On macOS the Automate tab opens the same
   bundled tasks page as Kanban but with `surface=automations`
   (`native/sidebar/native-sidebar.tsx:42881` `createProjectAutomateEditorUrl`).
3. **Compact mode dropdown**: macOS swaps the center mode switcher for a compact dropdown in the
   left cluster when the window is narrower than 1050px (`titlebar-host.tsx:373` `compactModeMedia`,
   component `TitlebarModeDropdown` `:7434`). GPUI has nothing.
4. **Companion sidepane toggle**: macOS shows a toggle at the left edge of the mode switcher when
   mode ≠ agents, a project editor is open, and it is not sleeping
   (`titlebar-host.tsx:4324` `shouldShowCompanionToggleButton`, rendered `:7545`). GPUI has the
   companion subsystem (`ProjectEditorCompanion` shell surface, `gpui/src/main.rs:7207`,
   constants `:1041-1044`) but no titlebar toggle.
5. **Dynamic control states on existing buttons** (GPUI renders static icons where macOS is dynamic):
   - Project slot: macOS shows an optional project icon image (`projectState.projectIconDataUrl`)
     before the name (`titlebar-host.tsx:4693`); GPUI shows text only.
   - Sidebar collapse button: macOS picks `IconLayoutSidebar` vs `IconLayoutSidebarRight` based on
     `sidebarSide` (`titlebar-host.tsx:2586`); GPUI always uses `layout-sidebar.svg`.
   - Git button: macOS derives the glyph from the resolved primary git action
     (`getTitlebarGitActionIcon` `:7715`, `resolveSidebarGitPrimaryActionState` via
     `shared/sidebar-git.ts`) and shows a spinner while `git.isBusy`; GPUI always shows
     `git-commit.svg` and passes `show_badge=false` even though `render_titlebar_icon_button`
     (`gpui/src/main.rs:49530`) supports a badge and `GpuiTitlebarGitMenuState`
     (`gpui/src/main.rs:1606`) already carries dirty/ahead/behind state.
   - Actions button: macOS shows the active configured action's icon, or a settings icon when no
     action is configured (`titlebar-host.tsx:4891`, `getSidebarActionIcon`); GPUI always shows
     `player-play.svg`.
   - Tips button: macOS shows an unread-count badge (unread tips + active notices,
     `titlebar-host.tsx:4772`, tips list `TITLEBAR_TIPS` `:727`, notices `:809/:827`); GPUI has no badge.

Already at parity — do NOT rebuild these: Settings and Keep Awake buttons are intentionally absent
from both titlebars (moved to sidebar shortcut chrome; see comment `gpui/src/main.rs:41789` and
`titlebar-host.tsx:4764`). GPUI's NativeMenu dropdowns for Resources/Git/Actions/Open In are the
accepted GPUI equivalent of macOS's web dropdown panels (see
`docs/2026-07-02/gpui-parity-plan.md` Batch 4 line 158-170 and Batch 11 line 401). The passive
project-name label is parity (macOS label is also passive). The update button, exit-focus button,
and Tips CEF popover already exist in GPUI.

## Repo rules every worker MUST follow

- **No tests anywhere in `gpui/**` or the macOS app trees.** Do not add test files or test code.
  (Existing `native/sidebar/titlebar-*-source.test.ts` files: leave them alone unless one fails
  because of your change — in that case fix your change, and only delete a test if it is asserting
  the old pre-parity behavior you were explicitly asked to change.)
- **No fallbacks instead of fixes.** Implement the correct behavior directly; never add
  try-this-then-fall-back logic to paper over an issue.
- **Never run `bun run start` or restart/relaunch the Ghostex or GPUI app.**
- **Never search or modify `ghostty/**`** (vendored upstream) or other vendored trees.
- Native layout discipline: no hitTest overrides, invisible overlays, or overlapping interactive
  regions. GPUI titlebar work here is GPUI-drawn Rust UI; keep it that way.
- Follow existing code style in `gpui/src/main.rs`, including the `CDXC:` contract-comment
  convention — when you change behavior a CDXC comment describes, update that comment.
- Verification commands used across phases:
  - Rust: `cargo check --manifest-path gpui/Cargo.toml` (must pass with no new warnings-as-errors).
  - TypeScript: `bun run typecheck` (repo root; must pass).

## Reference map (both titlebars)

macOS side (read-only reference for parity — do not modify unless a phase says so):
- Strip UI: `native/sidebar/titlebar-host.tsx` — layout `:7876`, App render `:4622-4940`,
  mode defs `:4351/:4330-4384`, handlers `:4154-4282`, compact dropdown `:7434`, companion toggle
  `:4324/:7545`, git icon `:7715`, tips data `:727-827`.
- Native host: `native/macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift` — command dispatch
  `:4204-4281`; sidebar forwarding targets `native/sidebar/native-sidebar.tsx:44605`
  (`openAutomateFromTitlebar`), `:42881` (`createProjectAutomateEditorUrl`), `:38226`
  (`openQuickAutomationsPage`).

GPUI side (the code you change):
- `gpui/src/main.rs`: `render_titlebar` :41777, `render_project_slot` :41814,
  `render_sidebar_collapse_button` :41843, `render_mode_switcher` :41884, `render_mode_tab` :41905,
  `render_right_titlebar_controls` :49348, `render_titlebar_icon_button` :49530,
  `TitlebarMode` :2250, availability :2979/:3064/:21417, snapshot :2645,
  workarea slots :21178 (`project_workarea_runtime_url_for_slot`),
  kanban URL builder :72368, manage URL builder :72398, constants :442-751,
  titlebar assets under `gpui/assets/titlebar/*.svg` (Tabler icons).
- Sidebar runtime & snapshot: `gpui/sidebar/active-project-context.ts` (surface ids),
  `gpui/sidebar/gxserver-runtime.ts`, bridge manifest `gpui/src/cef/sidebar_bridge_manifest.rs`.
- Bundled workarea pages: `gpui/sidebar/kanban-main.tsx`, `gpui/sidebar/manage-main.tsx`, and the
  html entries referenced by `gpui_cef_html_entry_url("GHOSTEX_GPUI_KANBAN_URL", "kanban.html")`
  (see `gpui/build.rs` / `gpui/scripts` for how these pages are bundled).

---

## Phase 1: Mode switcher + center cluster parity

- depends_on: []
- parallel_ok: false
- goal: Make the GPUI titlebar mode switcher present exactly the macOS tab set, order, labels, and
  availability policy — `Agents, Source, Browser, Kanban, Automate, Docs` — plus the two center/left
  cluster behaviors GPUI lacks: the companion sidepane toggle and the narrow-window compact mode
  dropdown. The Automate tab in this phase selects a new `TitlebarMode::Automate` that shows the
  standard project-editor placeholder surface (Phase 2 makes it a real workarea); everything else
  about the tab (gating, sleeping dot, ordering, persistence of the mode slug) must be fully wired.
- files: `gpui/src/main.rs` (mode switcher, TitlebarMode enum, availability, project-editor shell
  mode bookkeeping), new icon SVGs under `gpui/assets/titlebar/` if needed (Tabler outline icons,
  matching existing files' format).
- do_not_touch: `gpui/sidebar/**`, `gxserver-rs/**`, `native/**`, `shared/**`, `sidebar/**`,
  `gpui/src/cef/**`, the right-cluster render functions (`render_right_titlebar_controls`,
  `render_titlebar_icon_button` and the functions it calls) beyond what mode changes force,
  `ghostty/**`.
- approach:
  1. Extend `TitlebarMode` (gpui/src/main.rs:2250) with `Automate` (slug `"automate"`), display
     label `"Automate"`, placed between `Kanban` and `Manage` everywhere ordering matters
     (`titlebar_mode_switcher_items` :75702, `project_editor_order`, tab iteration :3098-3101,
     workspace sleep/wake bookkeeping in `project_editor_shell` — search all `match` sites on
     `TitlebarMode` and extend each deliberately; the compiler will find them once the variant
     exists because the matches are exhaustive).
  2. Rename the `Manage` display label to `"Docs"` (`display_label`, `placeholder_title`, any
     user-visible strings like "Manage is unavailable..." → Docs wording). Keep the internal slug
     `"manage"` and the `Manage` enum variant name so persisted mode state stays compatible
     (mirrors macOS, which keeps mode id `manage` under the Docs label —
     titlebar-host.tsx:4340-4384).
  3. Availability parity (`titlebar_availability` :2979, snapshot policy :2645,
     `titlebar_mode_available` :21417/:3064):
     - Docs (manage): visible always, disabled with the standard "Switch to a project…" tooltip in
       Quick/projectless contexts — REMOVE the `debuggingMode && showBetaFeatures` visibility gate
       so it matches macOS. Update the corresponding CDXC contract comments ("gated Manage") and
       the `isManageAvailable` plumbing consequences inside `gpui/src/main.rs` only; if the strict
       snapshot rejects a manage surface id unless the gate is on, relax that policy in the Rust
       snapshot acceptance to match the new always-available policy. Do not touch the TS side in
       this phase; the Rust side must handle a snapshot that lacks a manage surface id by showing
       the tab with the normal placeholder/unavailable surface (same as today's ungated modes).
     - Automate: same availability class as Browser/Kanban — selectable for real projects, visible
       but disabled for Quick/projectless with the standard tooltip.
     - Sleeping dot (:41980) must cover Automate like other project-editor modes.
  4. Placeholder: give `Automate` a colored placeholder identity like Source/Kanban/Manage
     (`ProjectEditorPlaceholderColorIdentity` :2333, `placeholder_title` "Automate",
     `placeholder_message` mirroring the others). Do NOT create any CEF surface for Automate in
     this phase (that violates the CDXC placeholder contract; Phase 2 owns the real surface).
  5. Companion toggle: render a toggle button at the left edge inside the mode switcher container
     (before the first tab), shown only when `active_mode != Agents`, the active mode is a
     project-editor mode with an open (non-placeholder-only is NOT required — mirror macOS: editor
     open and mode awake), matching macOS `shouldShowCompanionToggleButton`
     (titlebar-host.tsx:4324). Clicking toggles the project-editor companion for the active mode
     using the existing GPUI companion shell state (`ProjectEditorCompanion(TitlebarMode)` :7207 and
     the companion open/close paths already reachable from inside the editor UI — find the existing
     toggle/close function and call it; do not build a parallel mechanism). Icons: Tabler
     `layout-sidebar-left-expand` / `layout-sidebar-left-collapse` matching macOS
     (add SVGs under `gpui/assets/titlebar/` in the same normalized format as existing icons).
  6. Compact mode dropdown: when the window content width is below 1050.0 px, hide the centered
     mode switcher and instead render a compact control in the project slot (after the project
     name) showing the active mode's label plus a chevron; clicking it opens a `NativeMenu` (same
     pattern as `show_gpui_open_targets_menu` :48818) listing all modes with the active one
     check-marked and unavailable ones disabled; selecting calls the same `set_active_mode` path as
     the tabs. Window width comes from the existing render context (`window.viewport_size()` or the
     bounds GPUI already exposes in `render_titlebar` — reuse whatever the browser toolbar or
     layout code already uses for width-dependent decisions).
  7. Keep the mode-switch logging/behavior conventions used by existing tabs (see how
     `set_active_mode` is invoked from `render_mode_tab` :41905) for both the new tab, the compact
     dropdown, and the companion toggle.
- acceptance_criteria:
  - `cargo check --manifest-path gpui/Cargo.toml` passes.
  - `rg -n '"automate"' gpui/src/main.rs` shows the new slug in `from_slug`/`element_slug`, and
    `TitlebarMode` contains `Automate` ordered between Kanban and Manage in
    `titlebar_mode_switcher_items`.
  - `TitlebarMode::Manage.display_label()` returns "Docs" and no user-visible titlebar string says
    "Manage" anymore (`rg -n '"Manage"' gpui/src/main.rs` has no remaining display-label hits).
  - The `debuggingMode && showBetaFeatures` visibility gate for the Docs/manage tab is gone: the
    tab is included in `titlebar_mode_switcher_items` output unconditionally (disabled-for-Quick
    only), verified by reading that function.
  - Automate tab selection routes through the same `set_active_mode` guard as other modes and
    lands on a placeholder surface; no `CefSurface` creation is reachable for Automate in this
    phase (`rg -n 'Automate' gpui/src/main.rs` shows no ensure/create CEF call for it).
  - A companion toggle render function exists, gated on the macOS-equivalent condition, and calls
    the pre-existing companion toggle path (verifiable by reading the new render function and the
    function it invokes).
  - A compact-mode control exists that renders only under 1050px width and opens a NativeMenu
    whose items call `set_active_mode` (verifiable by reading the code).
  - No new files under `gpui/**` other than SVG assets; no test files added anywhere.

## Phase 2: Automate workarea works end-to-end

- depends_on: [1]
- parallel_ok: false
- goal: Replace the Phase 1 Automate placeholder with a real working workarea, exactly following
  the existing Kanban pattern: a bundled first-party CEF page driven by the live project snapshot,
  gated by `project_workarea_runtime_url_for_slot`. On macOS, Automate is the same tasks board
  page as Kanban with `surface=automations` (native-sidebar.tsx:42881); GPUI must mirror that: the
  Automate page is the bundled kanban/tasks page bootstrapped into its automations surface.
- files: `gpui/src/main.rs` (new `ProjectWorkareaCefSurfaceSlotKey::Automate`, URL builder,
  snapshot surface id), `gpui/sidebar/active-project-context.ts` (+ its consumers in
  `gpui/sidebar/gxserver-runtime.ts` / `gpui/sidebar/main.tsx` as needed for the new surface id),
  a new tiny page entry only if the kanban entry cannot take a query param (prefer reusing
  `kanban.html` with an extra query param — check `gpui/sidebar/kanban-main.tsx` and what
  `kanban.html` bootstraps; also `gpui/build.rs` / bundling scripts if a new html entry is
  unavoidable).
- do_not_touch: `native/**`, `shared/**` (read-only), `sidebar/**` (the macOS sidebar),
  `gxserver-rs/**`, right-cluster titlebar render functions, `ghostty/**`.
- approach:
  1. Read `kanban_workarea_runtime_url_from_project_snapshot` (gpui/src/main.rs:72368) and the
     macOS `createProjectAutomateEditorUrl` (native-sidebar.tsx:42881; params: projectName,
     projectPath, projectId, projectEditorId, beadsDisplayKey, `surface=automations`, plus
     `setAutomationsExperimentalGateParam` — read that helper and mirror its semantics). Add
     `automate_workarea_runtime_url_from_project_snapshot` producing the bundled tasks/kanban page
     URL with the same params as kanban PLUS `surface=automations` (and the experimental gate param
     if macOS sends it unconditionally — mirror exactly what macOS does).
  2. Verify what the bundled kanban page does with a `surface` param: `gpui/sidebar/kanban-main.tsx`
     bootstraps the shared tasks board app — confirm the shared app (same one macOS
     `tasks-placeholder.html` uses) switches to the automations surface from the query param. If
     the gpui kanban entry hardcodes a surface, extend the entry to read the param (TS change in
     `gpui/sidebar/`), keeping one html entry if possible.
  3. Add `ProjectWorkareaCefSurfaceSlotKey::Automate`: extend every match on the slot key
     (`project_workarea_runtime_url_for_slot` :21178, visibility/current/render/ensure fns
     :21198-21340, slot pruning, sleep teardown — the exhaustive matches will surface all sites),
     with `titlebar_mode()` → `TitlebarMode::Automate`.
  4. Snapshot plumbing for the surface id: mirror `kanbanBoardId` end to end — TS:
     `gpui/sidebar/active-project-context.ts` (`GpuiSidebarActiveProjectSurfaceIds`, strict
     acceptance, `explicitProjectSurfaceIds`), whatever posts the snapshot in
     `gpui/sidebar/gxserver-runtime.ts`; Rust: `snapshot.surface_ids` parsing/acceptance around
     gpui/src/main.rs:2645 and the strict-snapshot CDXC contracts (update those comments).
     `feature_availability` for automate mirrors kanban's.
  5. Sleep/wake: Automate participates in project-editor sleep/wake exactly like Kanban (placeholder
     when sleeping, CEF surface torn down per the existing slot teardown paths).
  6. Verify with `cargo check` and `bun run typecheck`; also run
     `node --experimental-strip-types` or the repo's usual check for any touched mjs/ts build
     scripts only if you modified them.
- acceptance_criteria:
  - `cargo check --manifest-path gpui/Cargo.toml` and `bun run typecheck` both pass.
  - `rg -n 'Automate' gpui/src/main.rs` shows `ProjectWorkareaCefSurfaceSlotKey::Automate` handled
    in every slot-key match (URL builder, visibility, render, ensure, prune, sleep paths).
  - `automate_workarea_runtime_url_from_project_snapshot` exists, requires a real project
    (returns None for quick/projectless), includes `surface=automations` plus the same identity
    params as the kanban builder, and mirrors macOS's experimental-gate param behavior.
  - The TS surface-id plumbing round-trips: `rg -n 'automate' gpui/sidebar/active-project-context.ts
    gpui/sidebar/gxserver-runtime.ts` shows the id flowing from snapshot creation to the posted
    payload, with strict-acceptance handling identical in shape to kanbanBoardId.
  - Selecting Automate with a real project snapshot yields a real runtime URL (verifiable by
    reading the gate chain: `project_workarea_runtime_url_for_slot` → automate builder → snapshot
    fields), and the placeholder remains for Quick/projectless.
  - No test files added; CDXC comments updated where behavior they describe changed.

## Phase 3: Left/right cluster dynamic control parity

- depends_on: [2]
- parallel_ok: false
- goal: Bring the remaining macOS titlebar view behaviors to the GPUI strip so every control looks
  and behaves like its macOS counterpart: project icon image, side-aware sidebar-collapse icon,
  git button with primary-action glyph + busy spinner + dirty badge, actions button with the active
  action's icon (settings icon when unconfigured), and the tips unread badge.
- files: `gpui/src/main.rs` (project slot, sidebar collapse button, right-cluster render fns,
  `GpuiTitlebarGitMenuState` if it needs extra fields), `gpui/sidebar/gxserver-runtime.ts` +
  `gpui/src/cef/sidebar_bridge_manifest.rs` ONLY if a needed piece of state (project icon data URL,
  git primary action/busy, active action icon) is not already crossing the bridge, new Tabler SVGs
  under `gpui/assets/titlebar/`.
- do_not_touch: mode switcher/center cluster code from Phase 1, workarea slot code from Phase 2,
  `native/**`, `shared/**` (read-only), `sidebar/**`, `gxserver-rs/**`, `ghostty/**`.
- approach:
  1. Project icon: macOS renders `projectState.projectIconDataUrl` as a small img before the name
     (titlebar-host.tsx:4693). Find what feeds that on macOS (project icon in the sidebar project
     snapshot) and whether GPUI's `latest_sidebar_project_snapshot` already carries it; if not,
     extend the snapshot payload in `gpui/sidebar/gxserver-runtime.ts`/`active-project-context.ts`
     and the Rust acceptance, then render it (GPUI `img()` with a data-URL source, 16px, rounded)
     before the name in `render_project_slot`. Respect the strict-snapshot conventions (explicit
     field, no synthesis).
  2. Sidebar collapse icon: pick `layout-sidebar.svg` vs a new `layout-sidebar-right.svg` from the
     user's sidebar side setting (macOS: `projectState.sidebarSide`; GPUI reads shared settings via
     `gpui/src/shared_settings.rs` — the sidebar side setting already exists for layout; reuse it).
  3. Git button (`render_right_titlebar_controls` :49372): derive glyph from the same primary-action
     resolution macOS uses (`shared/sidebar-git.ts` `resolveSidebarGitPrimaryActionState`): the
     sidebar runtime already posts `GpuiTitlebarGitMenuState` (rows, branch, counts,
     primary check-marked row). Have the TS side include the resolved primary action id + isBusy in
     that payload (it already computes them for the menu), map action id → Tabler icon in Rust
     (mirror `getTitlebarGitActionIcon` titlebar-host.tsx:7715; add the needed SVGs), render a
     spinner (reuse the update button's progress-ring/spinner approach) while busy, and pass
     `show_badge=true` when the working tree is dirty or ahead/behind (state already in
     `GpuiTitlebarGitMenuState` :1606).
  4. Actions button (:49379): icon from the active configured action. `GpuiTitlebarAction`
     (:69060) lacks an icon field — plumb the configured action icon through
     `configured_gpui_titlebar_actions` (:48907) from the same settings source macOS uses
     (`SidebarCommandButton.icon` via shared settings; GPUI reads the same settings file through
     `shared_settings.rs`). Map the icon name to a bundled Tabler SVG (add the small set of SVGs
     used by the built-in icon choices; fall back is NOT allowed — if an icon name has no bundled
     asset, bundle it). Unconfigured → `settings` icon and left-click opens the Actions settings
     modal (that path exists: `open_gpui_settings_actions_modal_from_titlebar` :48875).
  5. Tips badge: mirror macOS unread semantics (titlebar-host.tsx: unread tips = entries of
     `TITLEBAR_TIPS` whose ids are not in the persisted seen set; plus active notices such as
     persistence-off / debugging-mode). The tips list and seen-set live in the shared React panel;
     the GPUI strip needs only the COUNT: compute it the same way the React tips panel does and
     surface it to Rust — the tips CEF panel already talks to the app
     (`gpui_titlebar_tips_initial_project_state_update` :23183); if the panel is not resident at
     startup, replicate the unread computation in Rust from the same persisted seen-set storage the
     panel uses (read where titlebar-host.tsx persists seen tips — localStorage key — and where
     GPUI's CEF profile stores it; if that is not reachable from Rust, instead persist the seen-set
     through `shared_settings.rs`-adjacent GPUI state written by the panel via its existing bridge
     and read by the strip). Choose the mechanism that keeps ONE source of truth — no duplicated
     seen-state that can drift; state the chosen design in a CDXC comment.
     Render the badge via `render_titlebar_icon_button`'s existing badge support (or a small count
     badge matching macOS visuals) on the tips trigger (:49526).
  6. Open In button already derives vscode vs folder-open (:49254); extend coverage to match macOS
     `getOpenTargetIcon` (:7704) for the other built-in targets (Cursor, Finder, Terminal, etc.)
     by mapping target ids to bundled SVGs, same discipline as step 4.
- acceptance_criteria:
  - `cargo check --manifest-path gpui/Cargo.toml` and `bun run typecheck` both pass.
  - `render_project_slot` renders the project icon image when the snapshot provides one (read the
    code path from snapshot field to `img()`), and the snapshot plumbing is explicit end-to-end.
  - The sidebar collapse button chooses its SVG from the sidebar side setting (read the code).
  - The git button: icon varies with the posted primary action, spinner renders while busy, and
    `show_badge` is driven by dirty/ahead/behind state — all three verifiable by reading
    `render_right_titlebar_controls` + the state structs + the TS payload producer.
  - The actions button shows the configured action's icon and the settings icon when unconfigured;
    every built-in `SidebarCommandButton` icon name used by the settings UI has a bundled SVG
    (`ls gpui/assets/titlebar/` covers the mapped set; no fallback branch in the mapping).
  - The tips trigger shows an unread badge with a single-source-of-truth design documented in a
    CDXC comment.
  - No test files added; no changes to `native/**`, `shared/**`, `sidebar/**`, `gxserver-rs/**`.

## Handoff notes

(appended by the orchestrator as phases complete)

### After Phase 1 (COMPLETE)

- `TitlebarMode::Automate` exists end-to-end in the shell: slug `"automate"`, ordered
  between Kanban and Docs, wired through availability, persistence, sleep/wake, focus, and
  placeholder identity. Manage is relabeled "Docs" (enum variant + `manage` slug unchanged)
  and the debug/beta visibility gate is removed. Companion toggle and sub-1050px compact
  mode NativeMenu are implemented via existing state paths. Two new Tabler SVGs under
  `gpui/assets/titlebar/`.
- IMPORTANT toolchain note for all later phases and the verifier: the plain
  `cargo check --manifest-path gpui/Cargo.toml` fails in this environment BEFORE compiling
  this crate because the default shell toolchain is Rust 1.89 while the referenced Zed
  checkout pins 1.95.0. Use `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml`
  (or `cargo +1.95.0 check ...`) — that is the command that must pass. This is a
  pre-existing environment condition, not something to fix in this plan.
- The worktree contains unrelated pre-existing modifications from other work (large git
  status). Do not revert or "clean up" anything you did not change yourself.

### After Phase 2 (COMPLETE)

- Automate is now a real project workarea CEF slot (`ProjectWorkareaCefSurfaceSlotKey::Automate`)
  with a URL builder reusing the bundled `kanban.html` page plus `surface=automations` and the
  beta/experimental gate param mirrored from macOS. The active-project snapshot contract gained
  `automateBoardId` and Automate feature availability (TS `gpui/sidebar/active-project-context.ts`
  + `gxserver-runtime.ts`, Rust acceptance in `gpui/src/main.rs`). Kanban-style board/beads/image/
  conversation bridge handling is routed for the Automate slot too.
- Verified with `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` and
  `bun run typecheck`.

### After Phase 3 (COMPLETE)

- Project slot renders explicit snapshot-provided project icons and a sidebar-side-aware
  collapse glyph. Git titlebar state now carries primaryAction/isBusy/dirty and the button
  renders the matching glyph, spinner, and badge. Actions and Open In resolve their active
  icons from configured action/target metadata with bundled SVGs (no fallback branches).
  Tips shows an unread badge from the React panel read-id count plus Rust-owned settings
  notices. Verified with `RUSTUP_TOOLCHAIN=1.95.0 cargo check` and `bun run typecheck`.
