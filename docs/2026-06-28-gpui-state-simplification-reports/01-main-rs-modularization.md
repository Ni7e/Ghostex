# Report 01: Main Rust Shell Modularization

## Summary

`gpui/src/main.rs` is the central GPUI runtime file and is currently about 68k lines. It owns many unrelated responsibilities that can be split without changing product behavior.

## What is implemented

`main.rs` currently contains:

- GPUI app boot, window creation, key bindings, titlebar, mode switcher, sidebar layout, and focus model.
- Agents workspace tabs, splits, drag/drop, terminal placeholders, close-confirm UI, and Ghostty surface orchestration.
- Command pane model, rendering, timers, delayed send, close-after-done, action launch routing, and command terminal runtime.
- Browser tab/split shell, toolbar, address input, profile menu, history menu, CEF surface creation, and Browser metadata handling.
- Source, Kanban, and Manage project workarea lifecycle, placeholders, runtime URL gates, and CEF surface ownership.
- App modal routing, Settings save/refresh, modal host bridge handling, Previous Sessions, Running Sessions, Agents Hub, and remote setup flows.
- Remote gxserver tunnel state, remote clone jobs, remote attach sessions, remote project native actions, and remote presentation streams.
- Status/pet overlay state, menu-bar status item callbacks, App Shots dispatch, Keep Awake runtime, notification routing, and shared settings interactions.

## Evidence

- `gpui/src/main.rs`
- `gpui/src/shared_settings.rs`
- `gpui/src/terminal_*`
- `gpui/src/cef/macos.rs`
- `gpui/sidebar/gxserver-runtime.ts`

The concentration is visible from the symbol spread in `main.rs`: `GhostexGpuiApp`, browser runtime, project workarea runtime, terminal startup, command pane, modal host, remote gxserver, and native service callbacks are all in one file.

## Why this looks over-complex

- The main app state has too many maps and runtime subdomains in one struct, making ownership hard to audit.
- Rendering, persistence, native side effects, bridge parsing, CEF creation, terminal reconciliation, and network calls are interleaved.
- Many helper comments describe deleted or historical phases, which makes it hard to distinguish current runtime requirements from porting scaffolding.
- Independent features cannot be refactored safely without loading a large part of the codebase into working memory.

## Parallel-safe cleanup target

Split the file by runtime owner, preserving APIs first:

1. `app_shell.rs`: window, titlebar mode, focus, top-level render dispatch, persistence calls.
2. `browser.rs`: Browser tab model, toolbar actions, CEF surface creation, metadata handlers.
3. `project_workareas.rs`: Source/Kanban/Manage placeholders, runtime URL gates, CEF surface map.
4. `agents_workspace.rs`: Agents pane model, tab/split shell, placeholder state.
5. `command_pane.rs`: command model, command rendering, timers, command actions.
6. `terminal_runtime.rs`: terminal host/lifecycle integration calls shared by Agents and command pane.
7. `app_modals.rs`: modal host window, modal bridge, Settings/modal command handling.
8. `remote_runtime.rs`: remote gxserver, clone, attach, remote native actions.
9. `status_native_services.rs`: menu bar, notifications, App Shots, pet overlay, Keep Awake.

## Suggested first PR

Do a no-behavior-change extraction:

- Move Browser types and methods into a module with `pub(super)` boundaries.
- Keep `GhostexGpuiApp` fields unchanged at first.
- Compile after each extraction.
- Do not simultaneously change bridge semantics or runtime gates.

## Done when

- `main.rs` is reduced to app boot, top-level app struct, top-level render, and module wiring.
- Each major runtime area has a clear owner module.
- No feature behavior changes are included in the initial extraction PR.
