# Ghostex GPUI Architecture Overview

<!--
CDXC:GPUIArchitectureDocs 2026-06-24-21:16:
This document explains the technology used by each GPUI prototype surface so future work can preserve the intended split: GPUI owns native shell layout and chrome, CEF owns React/web surfaces, GhosttyKit owns terminal rendering, and AppKit shims only bridge exact native child views and platform services.
-->

This folder contains the macOS-first GPUI prototype for Ghostex. The short version is:

- **GPUI/Rust** owns the native app shell: titlebar, panes, tabs, split layout, resize handles, drag/drop, focus bookkeeping, persistence, and OS menus.
- **CEF/Chromium** owns embedded web surfaces: the React sidebar, Browser pages, Kanban, Manage, and the shared React app-modal host.
- **GhosttyKit/libghostty** owns real terminal rendering/process surfaces, hosted inside AppKit child views mounted into GPUI-measured terminal body rectangles.
- **AppKit Objective-C shims** provide the platform glue that GPUI/CEF/Ghostty need on macOS: CEF message pump, child-view positioning, terminal host views, native key forwarding, notifications, and keychain writes.
- **gxserver** is the live project/session/sidebar data source used by the CEF sidebar and many modal/settings actions.

## Main runtime shape

```text
GPUI window
├─ GPUI titlebar
├─ CEF React sidebar
├─ GPUI sidebar resize divider
└─ GPUI workspace column
   ├─ Agents / Source / Browser / Kanban / Manage workarea
   └─ optional command pane
```

The core rule is that **GPUI owns layout boundaries**. CEF and terminal native child views are positioned only inside normal GPUI layout slots after GPUI measures those slots.

## Important folders and files

- `gpui/src/main.rs` — main GPUI shell, models, render tree, actions, menus, focus, CEF surface ownership, terminal surface orchestration, settings/modal glue.
- `gpui/src/cef/macos.rs` — cef-rs wrapper, CEF initialization, browser child view wrapper, process-message/V8 bridge installation, popup and metadata handlers.
- `gpui/src/terminal_ghostty_surface.rs` — GhosttyKit/libghostty runtime owner wrappers and terminal input/clipboard/close/focus boundaries.
- `gpui/src/terminal_native_view.rs` — App-owned terminal host `NSView` lifecycle and frame/visibility/focus execution.
- `gpui/src/terminal_surface_host.rs` — pure reconciliation of visible terminal mount slots to attach/move/detach plans.
- `gpui/src/terminal_surface_lifecycle.rs` — runtime state machine from host plans to native-view decisions.
- `gpui/src/ghostty_kit.rs` — GhosttyKit path helpers and C ABI declarations.
- `gpui/src/shared_settings.rs` — focused GPUI shared settings service and supported settings parsing.
- `gpui/native/macos/*.m` — Objective-C AppKit shims for CEF, terminal host views, notifications, and keychain.
- `gpui/sidebar/*.tsx` / `gpui/sidebar/*.ts` — CEF React entrypoints and TypeScript runtime/bridge adapters.
- `gpui/vite.config.ts` — Vite build for self-contained CEF HTML entries.
- `gpui/scripts/build-macos-app.sh` — macOS `.app` packager for the GPUI prototype.

## Component technology

### Titlebar

**Technology:** GPUI/Rust + SVG assets + GPUI NativeMenu, plus a gpui-component Popover for the React-backed Tips panel.

Main code:

- `gpui/src/main.rs`
- `gpui/assets/titlebar/*.svg`
- `gpui/titlebar-host.html`
- `native/sidebar/titlebar-host.tsx`

The titlebar is GPUI-owned. It renders the project label, sidebar toggle, workarea switcher, Open In, Resources, Keep Awake, actions, and Settings controls. Most compact menus use OS-owned `gpui_component::native_menu::NativeMenu`; the info/Tips glyph uses a controlled `gpui_component::popover::Popover` containing a CEF surface that loads the shared React titlebar-host Tips panel.

### Sidebar

**Technology:** existing React `SidebarApp` inside CEF.

Main code:

- `gpui/index.html`
- `gpui/sidebar/main.tsx`
- `gpui/sidebar/gxserver-runtime.ts`
- `gpui/src/cef/macos.rs`

Rust creates a `CefSurface` for `index.html`. The TypeScript runtime mounts the shared sidebar React app and adapts it to GPUI by providing a local message source and a `vscode.postMessage`-compatible facade. The sidebar gets gxserver bootstrap data through `window.ghostexGpui`, talks to local gxserver over HTTP/WebSocket, and posts active-project/readiness/native-action messages back through fixed CEF bridge functions.

### Agents terminal panes

**Technology:** GPUI pane/tab chrome + GhosttyKit/libghostty native surfaces + AppKit host views.

Main code:

- `gpui/src/main.rs`
- `gpui/src/terminal_surface_host.rs`
- `gpui/src/terminal_surface_lifecycle.rs`
- `gpui/src/terminal_native_view.rs`
- `gpui/src/terminal_ghostty_surface.rs`
- `gpui/src/ghostty_kit.rs`
- `gpui/native/macos/GpuiTerminalAppKitAdapter.m`

GPUI renders the Agents workspace tree: panes, tab bars, split handles, placeholders, drag/drop, close-confirm UI, and focus chrome. A paint-time canvas records the exact terminal body bounds. The terminal host/lifecycle modules reconcile those measured bounds into native host-view commands. On macOS, AppKit creates a child terminal `NSView`; GhosttyKit creates the real terminal surface against that view.

Non-running states such as sleeping, mounting, restored/unmounted, failed-startup, popped-out, and missing sessions stay as GPUI placeholder cards. Running selected terminal slots can mount real Ghostty surfaces.

### Command pane terminals

**Technology:** GPUI bottom panel + the same Ghostty/AppKit terminal pipeline as Agents, isolated by command-specific ids.

Main code:

- `gpui/src/main.rs`
- shared terminal modules listed above

The command pane is a separate GPUI model and render tree from Agents. It can be pinned, floating, or collapsed, and it has its own tab groups and horizontal splits. Running command terminals use GhosttyKit/AppKit surfaces through command-specific mount slot keys, so command terminal state does not enter Agents workspace maps.

### Browser panes

**Technology:** GPUI Browser chrome + CEF/Chromium page surfaces.

Main code:

- `gpui/src/main.rs`
- `gpui/src/cef/macos.rs`
- `gpui/native/macos/GpuiCefAppKitHooks.m`

GPUI owns Browser tabs, split panes, toolbar, address field, history menus, profile UI, feedback-tool buttons, and drag/drop. Loaded Browser tabs own `CefSurface` entities. `CefSurface` wraps a `CefBrowser`, and `CefElement` positions the CEF child view inside the GPUI body slot during prepaint.

CEF callbacks update runtime tab metadata such as address, page title, favicon URL, and popup/window-open requests. Browser shell state persists only sanitized URL/title-derived data; live CEF page state is runtime-only.

### Source workarea

**Technology:** GPUI CEF/code-server runtime path with placeholder loading/error states.

Main code:

- `gpui/src/main.rs`

Source has strict readiness and mount-request contracts plus an app-owned shared code-server runtime owner. When the selected Source workarea is awake, GPUI launches the macOS-compatible `Web/code-server` runtime on `127.0.0.1:3775`, waits for `/healthz`, then creates the normal-layout Source `CefSurface` from the explicit sidebar project folder URL. It does not accept renderer-provided URLs or fallback mounts.

### Kanban workarea

**Technology:** existing React Kanban/tasks page inside CEF.

Main code:

- `gpui/kanban.html`
- `gpui/sidebar/kanban-main.tsx`
- `gpui/sidebar/project-workarea-cef-bridge.ts`
- `gpui/src/main.rs`

Vite emits a self-contained `kanban.html` entry. Rust creates a project-scoped `CefSurface` for that bundled entry only when active project gates allow it. The TypeScript bridge maps existing WebKit-style message-handler calls to fixed CEF bridge functions.

### Manage workarea

**Technology:** existing React Manage page inside CEF + Rust-owned project/file bridge.

Main code:

- `gpui/manage.html`
- `gpui/sidebar/manage-main.tsx`
- `gpui/sidebar/project-workarea-cef-bridge.ts`
- `gpui/src/main.rs`

Vite emits `manage.html`. Rust creates a project-scoped CEF surface when Manage is available and active. Manage file requests leave the renderer only through fixed bridge functions and are handled by Rust-side project/file policy code instead of trusting arbitrary renderer paths.

### App modals: Settings, Hotkeys, Command Palette, Previous Sessions, Running Sessions, Agents Hub

**Technology:** separate GPUI-owned window containing the shared React modal host inside CEF.

Main code:

- `gpui/modal-host.html`
- `native/sidebar/modal-host.tsx`
- `gpui/src/main.rs`
- `gpui/src/cef/macos.rs`

App modals are not transparent overlays. GPUI opens a real window, creates a `CefSurface`, loads `modal-host.html`, and that entry imports the existing shared React modal host. CEF installs a WebKit-compatible `ghostexAppModalHost` shim only for first-party modal/sidebar entries so the existing React modal code can send lifecycle and command messages.

### Prompt editor

**Technology:** external `GhostexEditor.app`, launched by the `ghostex` CLI.

The Ctrl+G Monaco prompt editor is no longer hosted inside GPUI or the shared app-modal CEF window. GPUI only advertises the `--prompt-editor monaco` attach capability when shared settings select Monaco and the standalone `GhostexEditor.app` executable is resolvable on the local machine. The CLI owns launching that app and the status-file handshake.

## CEF bridge model

CEF bridge code is intentionally fixed-function rather than generic IPC.

Examples:

- Sidebar bridge functions post active project, readiness, and native action messages.
- Project workarea bridge functions post Kanban board/beads/image requests and Manage file requests.
- App modal bridge functions post modal lifecycle and sidebar command messages.

The bridge is installed only for first-party CEF entries and only forwards bounded string payloads to Rust. Browser tabs and arbitrary web pages do not receive sidebar/workarea/modal bridge functions.

## Terminal mount model

Terminal mounting is a staged pipeline:

1. GPUI renders a terminal body slot.
2. A canvas probe records exact body bounds and current scale factor.
3. `NativeTerminalSurfaceHost` computes attach/move/detach commands for current visible mount slots.
4. `NativeTerminalSurfaceLifecycleState` decides whether a real native view is needed or can be reused.
5. `terminal_native_view` creates/resizes/hides/shows the AppKit host `NSView`.
6. `terminal_ghostty_surface` creates or updates a Ghostty surface using the host view and current config.
7. Focus, mouse, scroll, key, clipboard, process-exit, and close-confirm state are synced through runtime-only maps.

This keeps terminal runtime identity separate from persisted shell layout identity.

## Build and packaging

Main files:

- `gpui/Cargo.toml`
- `gpui/build.rs`
- `gpui/vite.config.ts`
- `gpui/scripts/build-macos-app.sh`

Build pieces:

- Cargo builds the Rust app and CEF helper executable.
- `build.rs` compiles Objective-C shims and links Cocoa/Foundation/Metal/CoreText/UserNotifications/etc.
- Vite builds and inlines the CEF HTML entries:
  - `index.html`
  - `kanban.html`
  - `manage.html`
  - `modal-host.html`
  - `titlebar-host.html`
- The app packager creates a macOS `.app` bundle with CEF frameworks, helper apps, sidebar resources, sounds, CLI resources, Web resources, and optional remote gxserver packages.

## Current caveats

- The GPUI prototype is macOS-first. Non-macOS CEF paths are intentionally unsupported/stubbed for now.
- Source starts a shared code-server runtime lazily for awake Source mode and mounts a CEF surface after the local `/healthz` readiness gate passes.
- Kanban and Manage can use bundled CEF entries when the current project gates allow them.
- Browser content is real CEF/Chromium, while Browser chrome and tab/split state are GPUI-owned.
- Terminal content is real GhosttyKit/libghostty for mounted running slots; non-running terminal states remain GPUI placeholders.
- Settings/modal/sidebar React is reused from the existing app rather than being rewritten in GPUI.
