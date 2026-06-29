# Report 03: Project Workarea Readiness Simplification

## Summary

Source, Kanban, and Manage now have direct runtime URL and CEF-surface gates, but older readiness and proof-style stores still exist around them. Some of this logic appears to be no longer authoritative.

## What is implemented

### Source

- Uses the active sidebar project snapshot.
- Starts an app-owned code-server runtime on `127.0.0.1:3777`.
- Creates a Source CEF surface only after the code-server runtime is ready and the current project can issue a runtime URL.

### Kanban

- Uses a bundled `kanban.html` CEF entry.
- Gets project identity from the active sidebar project snapshot.
- Creates a CEF surface only when selected, awake, and project gates allow it.

### Manage

- Uses a bundled `manage.html` CEF entry.
- Requires explicit project identity and an in-memory project root from the sidebar snapshot.
- Routes file operations through Rust.

## Evidence

- `gpui/src/main.rs`
  - `SourceWorkareaRuntimeState`
  - `BrowserWorkareaRuntimeState`
  - `ProjectScopedRealSurfaceRuntimeState`
  - `ensure_source_code_server_runtime_for_current_context`
  - `ensure_project_workarea_runtime_cef_surfaces_for_current_context`
  - `project_workarea_runtime_url_for_slot`
  - `render_source_workarea_surface`
  - `render_kanban_workarea_surface`
  - `render_manage_workarea_surface`
- `gpui/sidebar/active-project-context.ts`
- `gpui/sidebar/project-workarea-cef-bridge.ts`

## What appears unused or stale

- Strict readiness parsers and stores are still present for Source, Browser, Kanban, and Manage.
- Many related helpers are marked `#[allow(dead_code)]`.
- The comments say older Source/Kanban/Manage proof objects were removed and direct runtime URL gates are now authoritative.
- Placeholder rendering still references readiness availability, but CEF surface creation mostly follows active/awake/runtime URL gates.

## Why this looks over-complex

There are two concepts doing similar work:

1. A direct runtime gate: the app can create a real CEF surface because it has a valid current project and a real runtime URL.
2. A readiness proof/store: the app stores enum-like readiness evidence from bridge messages.

The current code suggests the direct runtime gate is the real authority, while the readiness store mainly affects placeholder labels and legacy proof boundaries.

## Parallel-safe cleanup target

Pick one authority per workarea:

- Source authority: active project snapshot plus app-owned code-server runtime state.
- Kanban authority: active project snapshot plus bundled CEF URL availability.
- Manage authority: active project snapshot plus bundled CEF URL availability plus Rust file bridge policy.

Then delete or narrow any readiness store that no longer changes runtime behavior.

## Suggested implementation path

1. Inventory every call to `store_sidebar_workarea_bridge_event`.
2. Confirm which readiness messages are still sent by the sidebar runtime.
3. If no first-party surface sends these messages, remove the unused parser/store code.
4. If placeholders still need loading/error labels, replace contract stores with direct runtime state enums.
5. Keep the direct CEF surface gate as the only mount authority.

## Done when

- A reader can tell exactly why Source, Kanban, or Manage is a placeholder versus a real CEF surface.
- Workarea readiness messages are either real and documented, or deleted.
- `#[allow(dead_code)]` readiness parser clusters are removed or isolated behind a clearly future-facing module.
