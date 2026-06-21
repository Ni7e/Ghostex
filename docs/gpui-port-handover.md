# GPUI Port Handover Prompt

```text
We are working in /Users/madda/dev/_active/Ghostex on the Ghostex GPUI port.

First, read and follow:
- /Users/madda/dev/_active/Ghostex/AGENTS.md
- ~/.agents/main.md

Do not use Cua Driver unless I explicitly ask. Do not run `bun run start` or restart the main Ghostex app unless I explicitly ask. For GPUI app launch, use the built bundle directly:
- open -n /Users/madda/dev/_active/Ghostex/gpui/build/macos/GhostexGPUI.app

Main code areas:
- GPUI app: /Users/madda/dev/_active/Ghostex/gpui
- GPUI Rust UI entry point: /Users/madda/dev/_active/Ghostex/gpui/src/main.rs
- GPUI CEF platform code: /Users/madda/dev/_active/Ghostex/gpui/src/cef/
- GPUI macOS bundle/build script: /Users/madda/dev/_active/Ghostex/gpui/scripts/build-macos-app.sh
- GPUI sidebar web assets: /Users/madda/dev/_active/Ghostex/gpui/sidebar/
- GPUI copied titlebar/addressbar SVGs: /Users/madda/dev/_active/Ghostex/gpui/assets/titlebar/

Native macOS reference code:
- /Users/madda/dev/_active/Ghostex/native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift

Key reference sections to inspect:
- Browser/titlebar/address toolbar layout
- `BrowserAddressTextFieldCell`
- `WebPaneHostView`
- `configureBrowserToolbar`
- `layoutBrowserToolbar`
- `commitAddress`
- `url(fromAddressInput:)`

Frontend/sidebar reference code:
- /Users/madda/dev/_active/Ghostex/sidebar/
- /Users/madda/dev/_active/Ghostex/src/
- /Users/madda/dev/_active/Ghostex/components/
- /Users/madda/dev/_active/Ghostex/shared/

Reference repo/codebase folders:
- If a `references/` folder is absent, create/use:
  - /Users/madda/dev/_active/Ghostex/references/
- Clone any needed upstream/reference repos there, not into app source folders.
- Relevant references for the GPUI port are:
  - Tauri CEF-related project/repo the user mentioned, if needed for replacing/aligning CEF shell behavior.
  - Any GPUI examples/reference repos needed for idiomatic GPUI layout and components.
  - Any CEF integration references needed for macOS bundle/helper/process layout.
- Keep references read-only unless explicitly asked to patch them.

Current GPUI port state:
- The GPUI app exists under `gpui/`.
- It is a macOS phase-1 prototype with:
  - left sidebar rendered from the Ghostex React sidebar via CEF
  - main CEF browser pane
  - GPUI titlebar copied visually from the macOS app
  - GPUI browser address bar copied visually from the macOS app
- The app bundle path is:
  - /Users/madda/dev/_active/Ghostex/gpui/build/macos/GhostexGPUI.app
- Bundle ID seen previously:
  - com.madda.ghostex.gpui.phase1

Important implemented GPUI UI requirements:
- Titlebar must visually match the macOS app titlebar, but implemented in GPUI, not SwiftUI/AppKit.
- Address bar must visually match the macOS app browser toolbar, but implemented in GPUI, not SwiftUI/AppKit.
- Do not bring over dropdown modals yet. Buttons/tabs/icons should exist visually, but dropdown behavior is deferred.
- Layout should use strict normal GPUI/native layout. Do not solve interaction issues with transparent overlays, broad hit-test routing, or overlapping invisible views unless the user explicitly approves after an explanation.
- The CEF browser content should sit under the GPUI toolbar in normal layout, not underneath an overlay.
- Keep the macOS source as visual/behavioral reference, but implement new UI in GPUI components.

Important address bar details already copied:
- Browser toolbar height: 40px.
- Background: black.
- Left controls: back, forward, reload.
- Address field: lock/globe icon, URL text, placeholder "Search or enter address".
- Right controls currently visual-only/deferred: Agentation, Profile, Appearance, DevTools.
- Zoom control is hidden unless needed, matching macOS behavior.
- Address commit behavior should normalize URLs like the macOS app:
  - explicit scheme remains unchanged
  - localhost / 127.0.0.1 uses http://
  - dotted no-space domains use https://
  - other text becomes a Google search query

Important code-comment requirement:
- Add/update CDXC comments for important user-facing requirements and technical decisions.
- Format:
  - `CDXC:AreaName yyyy-MM-dd-hh:mm:`
- Use current date/time.
- Comments should explain requirements, not narrate obvious code.
- Keep existing CDXC comments accurate when changing behavior.

Important repo rules:
- Do not add fallback behavior when the right fix is to correct the behavior directly.
- Avoid searching vendored/imported/build/dependency trees unless specifically needed.
- Use `rg` first for searches.
- Exclude at minimum:
  - ghostty/**
  - tui/vendor/**
  - iOS/Vendor/**
  - node_modules/**
  - .git/**
  - dist/**
  - build/**
  - out/**
  - target/**
  - tmp/**
  - storybook-static/**
- Do not revert or delete unrelated dirty work. Other agents/user may have uncommitted changes.
- Before destructive operations, show exact tracked/untracked files affected and ask for approval.

Validation commands for GPUI work:
- From /Users/madda/dev/_active/Ghostex/gpui:
  - cargo fmt
  - cargo check
- To rebuild the macOS bundle:
  - ./scripts/build-macos-app.sh
- To launch without Cua Driver:
  - open -n build/macos/GhostexGPUI.app
- Do not use Cua Driver unless I explicitly ask.

Recent known launch:
- The app was started from:
  - /Users/madda/dev/_active/Ghostex/gpui/build/macos/GhostexGPUI.app
- Main process previously observed:
  - GhostexGPUI PID 67446
- If relaunching, check current running process first and avoid killing unrelated processes.

What to do next:
- Continue GPUI port work from the existing implementation in `gpui/src/main.rs`.
- Use the native macOS app as the source of truth for visual behavior.
- Keep changes scoped to the GPUI port unless I explicitly ask for broader app changes.
```
