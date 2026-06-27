# Plan 010: Match macOS command palette, modals, rename, prompt editor, Resources, and titlebar popovers

> **Executor instructions**: Follow this plan step by step. Stop on STOP conditions.
>
> **Drift check (run first)**: `git diff --stat 5d9960dff..HEAD -- gpui/src/main.rs gpui/src/cef/macos.rs sidebar/app-modal-host-bridge.ts sidebar/modal-host.tsx sidebar/command-palette.tsx sidebar/session-rename-modal.tsx native/sidebar/titlebar-host.tsx native/sidebar/native-sidebar.tsx native/macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift`

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans/005-gpui-sidebar-session-contracts.md, plans/009-gpui-settings-appearance-config.md
- **Category**: correctness
- **Planned at**: commit `5d9960dff`, 2026-06-26

## Why this matters

macOS has rich command palette, modal, titlebar dropdown, Resources, rename, and prompt-editor flows. Product direction: behavior must match macOS exactly, but GPUI should use GPUI popovers where sensible instead of AppKit/WK child windows. The Zed-style reference is `/Users/madda/.ghostex/i/260626234311.png`.

## Current state

- Shared app modal kinds include `floatingPromptEditor`: `sidebar/app-modal-host-bridge.ts:18`.
- GPUI app modal enum starts at `gpui/src/main.rs:1062`; verify current supported kinds before editing.
- Shared command palette supports command mode and session-search mode in `sidebar/sidebar-app.tsx:2296`.
- GPUI titlebar currently routes many actions through `GpuiAppModalKind` and menus, but Resources and prompt editor are not macOS parity.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| GPUI modal Rust tests | `cargo test --manifest-path gpui/Cargo.toml app_modal titlebar resources prompt_editor -- --nocapture` | relevant tests pass |
| Modal/command TS tests | `bun run test -- command-palette modal-host session-rename` | relevant tests pass |
| Typecheck | `bun run typecheck` | exit 0 |

## Scope

**In scope**:
- GPUI app modal policy table: sizes, resizable/fixed behavior, reuse, focus, close.
- GPUI popover implementation for titlebar dropdowns/menus, modeled after the Zed-style reference.
- Resources titlebar surface parity.
- Command palette Cmd+Shift+P command mode and Cmd+P session-search mode.
- Floating prompt editor/Ctrl+G behavior.
- Rename Generate Name for local command tabs exactly like macOS.

**Out of scope**:
- Implementing broad native child-window overlays.
- Terminal launch internals except through existing terminal APIs.

## Steps

### Step 1: Define GPUI modal/popover policy from macOS behavior

Create a table mapping each macOS modal/dropdown to GPUI behavior. Use GPUI popovers for titlebar dropdowns where appropriate, preserving macOS size, focus, outside-click, Escape, keyboard, and state behavior. Do not keep NativeMenu if it cannot match behavior.

**Verify**: Rust tests assert policy for Settings, Hotkeys, Command Palette, Rename, Delayed Send, Resources, Tips, Actions, Open In, Keep Awake, and prompt editor.

### Step 2: Implement command palette mode parity

Bind Cmd+Shift+P to command mode with `>` and Cmd+P to session-search mode with empty query. Reopening an already-open palette should switch modes like macOS.

**Verify**: tests assert open messages carry correct `initialQuery` and repeated action updates mode.

### Step 3: Implement Resources as a real GPUI popover

Port macOS Resources behavior: readiness ordering, daemon controls, CPU/RAM, dev servers, project session groups, Code IDE, Browser tabs, orphaned resources, focus/sleep/quit/always-start actions. Use GPUI popover UI, not a shortcut to Running Sessions.

**Verify**: tests cover payload shape, ready state, grouped rows, and action bridge callbacks.

### Step 4: Implement floating prompt editor/Ctrl+G

Add GPUI support for the shared `floatingPromptEditor` contract, Monaco/GTE backend behavior, save/cancel, image/status messages, prewarm/reuse if macOS does, and focus return.

**Verify**: tests cover open, save, cancel, status-file response, image callback, prewarm, and close focus.

### Step 5: Implement generated rename for local command tabs

Do not hide Generate Name. Match macOS generated title behavior for local command tabs, with no prompt text persistence or unsafe local state.

**Verify**: tests cover local command tab Generate Name, gxserver sessions, long input, failure, and privacy.

## Test plan

- Rust app-modal policy and popover routing tests.
- TS tests for shared command palette, rename modal capability, and prompt editor bridge.
- Manual UI verification only when operator permits.

## Done criteria

- [ ] GPUI modal/dropdown behavior matches macOS, using GPUI popovers where appropriate.
- [ ] Command palette modes and hotkeys match macOS.
- [ ] Resources surface matches macOS behavior.
- [ ] Prompt editor and generated rename match macOS.
- [ ] Targeted Rust and TS tests pass.

## STOP conditions

- A GPUI popover cannot reproduce required macOS focus/close behavior.
- Generated title parity would require persisting prompt text.
- Resources requires private paths/titles in logs.

## Maintenance notes

Reviewers should compare behavior against macOS, not against older GPUI placeholder docs.

