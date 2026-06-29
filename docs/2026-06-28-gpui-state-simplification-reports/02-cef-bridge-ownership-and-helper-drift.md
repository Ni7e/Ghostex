# Report 02: CEF Bridge Ownership and Helper Drift

## Summary

CEF is real and heavily used, but the bridge definitions are duplicated across Rust main-process CEF code, the helper binary, and TypeScript adapters. The copies already appear to have drifted.

## What is implemented

CEF powers:

- The main sidebar (`index.html`).
- Browser page tabs.
- Source/code-server.
- Kanban and Manage bundled workareas.
- The shared React app-modal host.
- The titlebar Tips panel.

`gpui/src/cef/macos.rs` owns:

- CEF initialization and external message pump.
- Browser child window creation and native view frame/visibility.
- Browser metadata callbacks.
- Popup handling.
- V8 bridge installation for first-party surfaces.
- App-modal WebKit-compatible bridge.
- Project workarea bridge.
- Sidebar bridge.

`gpui/src/bin/ghostex_gpui_cef_helper.rs` owns helper-process bridge setup.

## Evidence

- `gpui/src/cef/macos.rs`
- `gpui/src/bin/ghostex_gpui_cef_helper.rs`
- `gpui/sidebar/gxserver-runtime.ts`
- `gpui/sidebar/project-workarea-cef-bridge.ts`
- `gpui/native/macos/GpuiCefAppKitHooks.m`

Notable drift:

- `macos.rs` defines a sidebar bridge allowlist with 16 functions.
- `ghostex_gpui_cef_helper.rs` defines a sidebar bridge allowlist with 15 functions.
- The helper appears to be missing `postWorkspaceTerminalRenameCommand`.
- The helper does not mirror the full project-workarea bridge and app-modal bridge logic present in `macos.rs`.

## Why this looks over-complex

- Bridge names, process message names, payload limits, and install behavior are repeated.
- Drift creates bugs that only appear in helper-backed renderer processes.
- It is hard to know whether the main process or helper process is authoritative for a given first-party CEF surface.
- TypeScript retries bridge calls because CEF may install functions after React starts, which is reasonable, but duplicated bridge surfaces make the startup ordering harder to reason about.

## Parallel-safe cleanup target

Create a single bridge manifest and generate or share all bridge definitions from it.

Suggested manifest fields:

- Surface: `sidebar`, `projectWorkarea`, `appModalHost`, `titlebarHost`.
- JavaScript function name.
- Process message name.
- Payload max bytes/chars.
- Allowed surface ids.
- Handler enum variant.
- Helper-process support requirement.

## Suggested implementation path

1. Add a Rust-side static manifest module, without changing behavior.
2. Make `macos.rs` and `ghostex_gpui_cef_helper.rs` consume the same manifest for sidebar bridge functions.
3. Add a small check or compile-time assertion that helper and main allowlists match for surfaces that must run in helper renderers.
4. Move TypeScript string constants toward generated or imported data if practical.
5. Only then delete duplicated bridge constants.

## Risks

- CEF helper behavior is hard to validate statically. A packaged app run may be needed after refactor.
- App-modal and project-workarea bridges have surface-specific security assumptions. Do not flatten them into a generic IPC bus.

## Done when

- Main-process and helper bridge allowlists cannot drift.
- `postWorkspaceTerminalRenameCommand` is either supported in the helper or intentionally removed from both lists.
- Project-workarea and app-modal bridge ownership is documented in code by one authoritative manifest.
