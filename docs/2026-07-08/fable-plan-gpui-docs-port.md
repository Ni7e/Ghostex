# Plan: Enable Docs (Manage) in gpui app + remove colored view placeholders

## Overall goal

1. The gpui app (GhostexGPUI, code under `gpui/`) must show the real Docs workarea (internally
   named `manage`) for any real project — exactly like the macOS app does — instead of the
   maroon "Docs is unavailable for the current project context." placeholder.
2. The loud colored placeholder screens (teal/purple/amber/pink panes with a centered card,
   badge, title, and message) for the non-terminal views (Source / Browser / Kanban /
   Automate / Docs) must be removed. Where a fallback state is still logically required
   (no project selected, code-server launching/failed, mode asleep), render a NEUTRAL
   minimal state that uses the app's normal workspace/background colors with small muted
   text only — no colored background, no colored border, no colored card, no badge chip.

## Context you must know (verified by prior exploration)

- "Docs" is internally `manage` everywhere. The gpui app ALREADY has:
  - The full Docs React app: `native/sidebar/manage.tsx` (shared with macOS app — do not modify).
  - The CEF entry: `manage.html` -> `gpui/sidebar/manage-main.tsx` -> installs
    `installManageCefBridge` from `gpui/sidebar/project-workarea-cef-bridge.ts`, then imports
    the shared manage app. Bundled by `gpui/vite.config.ts` (entry map lines ~21-27).
  - A complete Rust file bridge in `gpui/src/main.rs`: `run_manage_files_bridge_request_for_project_snapshot`
    (~line 77774) and `manage_files_bridge_result` (~77798) implementing
    list/read/save/rename/duplicate/delete/createFolder/move scoped to `<projectRoot>/docs`
    plus root artifacts plus `manageAdditionalDocsFolders`.
  - CEF surface machinery: `ProjectWorkareaCefSurfaceSlotKey::Manage` (~3308),
    `project_workarea_runtime_url_for_slot` (~22091), `ensure_project_workarea_runtime_cef_surface`
    (~22165), `render_manage_workarea_surface` (~50151).
- The ONLY reason the placeholder shows for Docs is the availability chain:
  - TS gate: `isManageWorkareaAvailableFromRuntimeSettings` in
    `gpui/sidebar/active-project-context.ts` (~329) returns true only when
    `debuggingMode === true && showBetaFeatures === true`. `workareaAvailability.manage`
    (~187-193) and `surfaceIds.manageWorkspaceId` (~294-306, via
    `nativeProjectEditorSurfaceId(projectId, "manage")`) both key off it.
  - Rust gate: `manage_workarea_runtime_url_from_project_snapshot` (`gpui/src/main.rs`
    ~77737-77758) returns `None` unless `feature_availability.manage && !is_quick_projectless`
    plus `active_project_id`, `manage_workspace_id`, and `in_memory_project_path` present.
  - Reference: Kanban is the same bundled-CEF pattern with NO debug/beta gate —
    `kanban_workarea_runtime_url_from_project_snapshot` (~77626) and the kanban entries in
    `active-project-context.ts`. Mirror that pattern for manage.
- Colored placeholder implementation (all in `gpui/src/main.rs`):
  - `TitlebarMode::placeholder_title` (~2403-2412) / `placeholder_message` (~2414-2423).
  - `ProjectEditorPlaceholderColorIdentity` (~2430-2492: SourceTeal, KanbanPurple,
    AutomateAmber, ManagePink) and `ProjectEditorPlaceholderSignature::for_mode` (~2495-2518),
    `for_source_code_server_launch_state` (~2520+).
  - Renderer `render_project_editor_placeholder` (~50262-50335): colored full-size pane,
    centered card `rgb(...)`, badge div, title, message. Element id
    `ghostex-gpui-project-editor-placeholder-{slug}`.
  - Sleeping variants: `ProjectEditorSleepingPlaceholderColorIdentity` (~2549),
    `ProjectEditorSleepingPlaceholderSignature` (~2620),
    `render_project_editor_sleeping_placeholder` (~50171-50261), reached from
    `render_project_editor_surface` (~50009-50027).
  - Per-view fallbacks: `render_source_workarea_surface` (~50086), `render_kanban_workarea_surface`
    (~50117), `render_automate_workarea_surface` (~50137), `render_manage_workarea_surface` (~50151).
  - Helpers: `project_editor_placeholder_title_color` (~59132),
    `project_editor_placeholder_message_color` (~59136),
    `PROJECT_EDITOR_PLACEHOLDER_MAX_WIDTH` (~1108).
  - NOTE: `render_browser_placeholder_body` / `render_browser_restored_placeholder_body`
    (~50596/50625) are the Browser empty-tab bodies, NOT the colored placeholder — leave them alone.
- Line numbers above are approximate anchors from exploration; re-locate symbols by name.

## Repo rules (mandatory)

- Do NOT write any tests in the gpui tree or the macOS app tree. If an existing test breaks
  purely because of an intentional behavior change here, fix or (only if unfixable) delete it.
- No fallback-instead-of-fix logic: make the code do the right thing from the start.
- Never run `bun run start` or anything that restarts the running Ghostex app. Building the
  gpui binary/bundle with the commands below is fine; do not launch/open the app.
- Do not touch `ghostty/**`, `tui/vendor/**`, `node_modules/**`, or the macOS app's Swift code.

## Build / check commands

- Rust: `cd /Users/madda/dev/_active/Ghostex/gpui && cargo check --bins`
- TS typecheck (repo root): `cd /Users/madda/dev/_active/Ghostex && bun run typecheck`
- Sidebar bundle: `cd /Users/madda/dev/_active/Ghostex && bun run build:sidebar-css && bunx vite build --config gpui/vite.config.ts`

## Phase 1: Enable the Docs (manage) workarea unconditionally for real projects
- depends_on: []
- parallel_ok: false
- goal: Remove the debug/beta gating so the Docs workarea is available for every real
  (non-quick-projectless) project in the gpui app, matching how Kanban is gated. After this
  phase, selecting the Docs titlebar tab with a real project active must produce a real
  `manage.html` CEF surface (runtime URL is Some), not the placeholder.
- files: `gpui/sidebar/active-project-context.ts`, `gpui/src/main.rs` (only the manage
  availability/runtime-URL logic), and `gpui/sidebar/gxserver-runtime.ts` only if it also
  branches on manage availability.
- do_not_touch: the placeholder rendering code in `gpui/src/main.rs` (Phase 2 owns it);
  `native/sidebar/manage.tsx`; `gpui/sidebar/manage-main.tsx`; the Rust manage file bridge;
  any Swift code; vite config.
- approach:
  - In `gpui/sidebar/active-project-context.ts`: make the manage workarea available exactly
    like kanban — i.e. `workareaAvailability.manage` true for real projects without requiring
    `debuggingMode`/`showBetaFeatures`, and always provision `surfaceIds.manageWorkspaceId`
    for real projects. Remove `isManageWorkareaAvailableFromRuntimeSettings` (and its helpers)
    if nothing else uses it — do not leave dead code. Keep quick/projectless payloads
    reporting manage: false (Docs needs a project root, same as macOS).
  - In `gpui/src/main.rs`: audit `manage_workarea_runtime_url_from_project_snapshot` so its
    requirements mirror the kanban builder (project id + project path + manage workspace id,
    no quick-projectless). Adjust only what still blocks a real project after the TS change.
  - Grep for other consumers of the manage availability flag (e.g. anything keying UI off
    `feature_availability.manage`) and confirm they behave sensibly now that it is true.
- acceptance_criteria:
  - `rg -n "debuggingMode|showBetaFeatures" gpui/sidebar/active-project-context.ts` shows no
    remaining coupling between those settings and manage availability.
  - For a real project payload, `workareaAvailability.manage` is true and
    `surfaceIds.manageWorkspaceId` is set (demonstrate by reading the builder code paths).
  - `cd /Users/madda/dev/_active/Ghostex/gpui && cargo check --bins` passes.
  - `cd /Users/madda/dev/_active/Ghostex && bun run typecheck` passes.
  - `bunx vite build --config gpui/vite.config.ts` succeeds (run `bun run build:sidebar-css` first).

## Phase 2: Replace colored view placeholders with neutral minimal states
- depends_on: [1]
- parallel_ok: false
- goal: No view in the gpui app ever renders the colored placeholder pane (colored
  background/border, centered card, badge chip) — neither the "unavailable" variant nor the
  "sleeping" variant, for any of Source/Browser/Kanban/Automate/Docs. States that still need
  a fallback (no project, source code-server Launching/Failed, mode asleep) render a neutral
  minimal state: the app's standard workspace background (same background color the normal
  workspace/terminal area uses, resolved from the active theme — not a new hardcoded color),
  no border/card/badge, just small centered muted text (keep existing message strings like
  the code-server launching/failed copy where they carry real information).
- files: `gpui/src/main.rs` only.
- do_not_touch: `gpui/sidebar/**`, `native/sidebar/**`, vite config, Swift code,
  `render_browser_placeholder_body` / `render_browser_restored_placeholder_body` (browser
  empty-tab bodies are a different, acceptable surface).
- approach:
  - Delete `ProjectEditorPlaceholderColorIdentity` and
    `ProjectEditorSleepingPlaceholderColorIdentity` and all their color tables.
  - Rework `ProjectEditorPlaceholderSignature` / `ProjectEditorSleepingPlaceholderSignature`
    (or replace them with something simpler) so they carry only the text needed for the
    neutral state; rework `render_project_editor_placeholder` and
    `render_project_editor_sleeping_placeholder` to render the neutral minimal state described
    in the goal. Keep stable element ids of the form
    `ghostex-gpui-project-editor-placeholder-{slug}` (and the sleeping equivalent) so any
    tooling that references them still works.
  - Keep the source code-server Launching/Failed distinction (text-only) since it is real
    status information; drop the per-mode marketing-style "X is unavailable..." card styling.
    The plain unavailable text can stay as a single muted line.
  - Remove now-unused helpers/constants (placeholder color helpers,
    `PROJECT_EDITOR_PLACEHOLDER_MAX_WIDTH` if unused after rework). No dead code.
  - Do not change when placeholders are chosen vs real surfaces (that logic was finalized in
    Phase 1) — only change what the fallback looks like.
- acceptance_criteria:
  - `rg -n "ProjectEditorPlaceholderColorIdentity|ManagePink|KanbanPurple|AutomateAmber|SourceTeal" gpui/src/main.rs`
    returns nothing.
  - `render_project_editor_placeholder` and `render_project_editor_sleeping_placeholder` (or
    their replacements) contain no hardcoded colored `rgb(...)` backgrounds/borders/cards and
    render no badge chip; they resolve colors from the active theme.
  - `cd /Users/madda/dev/_active/Ghostex/gpui && cargo check --bins` passes with no warnings
    about unused placeholder items introduced by this change.
  - `cargo build --release --bins` in `gpui/` succeeds.

## Handoff notes

- Phase 1 COMPLETE: Removed the debug/beta Docs gate in `gpui/sidebar/active-project-context.ts`
  (with related type/ownership moves in `gpui/sidebar/gxserver-runtime.ts`); real project
  payloads now set `manage: true` and always include `project-editor:<projectId>:manage` in
  surface ids. Quick/projectless and Automations-overview payloads still report manage: false.
  Rust `manage_workarea_runtime_url_from_project_snapshot` was audited and needed no change.
  All Phase 1 acceptance checks passed (rg, cargo check --bins, bun run typecheck, CSS build,
  vite build).
- Phase 2 COMPLETE: In `gpui/src/main.rs` only — removed the colored placeholder identity
  enums and color tables, reworked the unavailable/loading/failed and sleeping placeholder
  signatures to carry text only, and replaced both placeholder renderers with neutral
  centered text on `workspace_background_color()`. `cargo check --bins` and
  `cargo build --release --bins` passed (only pre-existing unrelated warnings).
