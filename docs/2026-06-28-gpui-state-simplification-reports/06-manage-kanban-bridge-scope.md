# Report 06: Manage and Kanban Bridge Scope

## Summary

Kanban and Manage reuse existing React pages inside CEF. The runtime is useful, but bridge scope is uneven: some bridge surfaces are real, some return placeholder responses, and some policy code describes operations that are not actually handled.

## What is implemented

### Kanban

- `gpui/kanban.html` loads `gpui/sidebar/kanban-main.tsx`.
- `kanban-main.tsx` installs a WebKit-compatible shim through `project-workarea-cef-bridge.ts`.
- Rust receives:
  - Project beads requests.
  - Project board requests.
  - Project board image requests.
- Beads operations call gxserver's typed Beads endpoint for many board actions.
- Image paste can read the clipboard and save images under the Ghostex image path.

### Manage

- `gpui/manage.html` loads `gpui/sidebar/manage-main.tsx`.
- `manage-main.tsx` installs the Manage CEF bridge.
- Rust receives Manage file requests.
- Rust currently supports:
  - `list`
  - `read`
  - `save`
- Requests are scoped to the active project snapshot and checked to stay inside the project root.

## Evidence

- `gpui/sidebar/kanban-main.tsx`
- `gpui/sidebar/manage-main.tsx`
- `gpui/sidebar/project-workarea-cef-bridge.ts`
- `gpui/src/main.rs`
  - `receive_project_workarea_bridge_event`
  - `run_manage_files_bridge_request_for_project_snapshot`
  - `manage_files_bridge_result`
  - `project_board_bridge_response_for_request_payload`
  - `run_project_beads_bridge_request_for_context`
  - `project_board_image_bridge_response_for_payload`

## What is not fully hooked up

- `project_board_bridge_response_for_request_payload` handles `getState` and focus-owner state with a minimal response, but many conversation/project-board actions are not handled.
- Prompt-agent title generation is explicitly not handled by the GPUI runtime surface.
- Manage policy scaffolding mentions create, rename, delete, move, and search operations, but actual Manage file handling only supports list/read/save.
- Workarea readiness stores are separate from the actual CEF bridge request handling.

## Why this looks over-complex

There are two separate bridge concepts:

1. The real runtime request bridge used by Kanban and Manage CEF pages.
2. The sidebar-scoped readiness and operation-policy bridge, much of which is not clearly used by the current runtime.

The actual product behavior is smaller than the policy surface implies.

## Parallel-safe cleanup target

Make each workarea bridge honest about what it supports:

- Kanban bridge: Beads actions, board state subset, image paste.
- Manage bridge: list/read/save only, unless create/rename/delete/search are actually implemented.

## Suggested implementation path

1. Delete or isolate dead Manage operation-policy enums that describe unsupported actions.
2. Convert unsupported Kanban board conversation actions into one small explicit unsupported handler.
3. Keep CEF project-workarea bridge functions narrow and surface-specific.
4. Avoid adding generic renderer IPC.
5. If Manage needs create/rename/delete/search, implement them in the real `manage_files_bridge_result` path before expanding policy claims.

## Done when

- The supported bridge actions are obvious from one file or one manifest.
- Manage operation policy and Manage operation implementation match.
- Kanban unsupported paths are explicit and small.
