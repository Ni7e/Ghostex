# Plan 011: Match macOS app menus, hotkeys, context menus, OS integration, and notifications

> **Executor instructions**: Follow this plan step by step. Stop on STOP conditions.
>
> **Drift check (run first)**: `git diff --stat 5d9960dff..HEAD -- gpui/src/main.rs gpui/native/macos native/macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift native/macos/ghostexHost/Sources/ghostexHost/HostProtocol.swift shared/ghostex-hotkeys.ts sidebar/command-palette.tsx`

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans/004-gpui-terminal-launch-restore.md, plans/010-gpui-modals-titlebar-resources-prompt.md
- **Category**: correctness
- **Planned at**: commit `5d9960dff`, 2026-06-26

## Why this matters

macOS users rely on app menus, global hotkeys, tab context menus, drag/drop management, notifications, OS open events, update/status controls, and app activation behavior. GPUI must match these desktop contracts, not just render similar controls.

## Current state

- macOS hotkey defaults live in `AppDelegate.swift:5465`.
- Shared hotkeys live in `shared/ghostex-hotkeys.ts`.
- GPUI binds a subset in `gpui/src/main.rs` around `fn main`.
- macOS context menus and tab actions live in `TerminalWorkspaceView.swift`; GPUI context menus are smaller and some rows are intentionally unsupported.
- GPUI notification settings/test plumbing exists in native macOS GPUI files, but real session-attention notification parity must be verified.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| GPUI native Rust tests | `cargo test --manifest-path gpui/Cargo.toml hotkey menu notification os_integration -- --nocapture` | relevant tests pass |
| Hotkey TS tests | `bun run test -- ghostex-hotkeys command-palette` | relevant tests pass |
| Typecheck | `bun run typecheck` | exit 0 |

## Scope

**In scope**:
- GPUI app menu parity: App, File, Edit, Window, Help where macOS has them.
- Hotkey defaults/settings dispatch from terminal, CEF, sidebar, command pane.
- Pane/tab context menus and middle-click close.
- Drag/drop management parity for tabs/panes, not terminal file paste covered by Plan 006.
- Attention notifications with click-to-focus, no sound, permission flow, and privacy bounds.
- OS integration: open URL/file, app activation, update/status menu actions, notification settings deep link.

**Out of scope**:
- Menu-bar/floating status indicator badges, covered by Plan 012.
- Titlebar Resources/prompt editor, covered by Plan 010.

## Steps

### Step 1: Build app menu parity

Inspect macOS `NSApp` menu construction and implement GPUI macOS app menu entries with matching actions and enabled states. Include Close Pane routing to focused surface and update/settings/window actions.

**Verify**: tests assert each shared menu action maps to a GPUI handler or is disabled only when macOS would disable it.

### Step 2: Match shared hotkey behavior

Use shared hotkey ids and defaults. Add missing Cmd+P/Cmd+Shift+P routing from Plan 010 if not already done. Implement or hide unsupported actions only if macOS hides them in the same context; otherwise implement real behavior.

**Verify**: tests cover terminal focus, CEF focus, sidebar focus, command pane focus, and retired/alias hotkeys.

### Step 3: Complete context menu and drag/drop parity

Port macOS tab/pane context menu rows backed by real GPUI operations: Rename, Delayed Send, Close After Done, Fork, Reload, Pop Out, Focus, Sleep/Wake/Close scopes, middle-click close, and drag/drop persistence. Do not expose rows that no-op.

**Verify**: tests cover visible rows per surface and action dispatch.

### Step 4: Implement real session-attention notifications

Match macOS: permission flow, optional bounded project icon attachment, no sound, temp cleanup, `sessionId` routing, click activation/focus, denied/settings repair, and no private data in logs.

**Verify**: native/Rust tests cover authorization states, delivered payload, click callback, cleanup, and privacy.

### Step 5: Complete OS open/activation/update integration

Match macOS behavior for external URLs/files, activation/unhide/deminiaturize on status/notification clicks, update actions, traffic-light placement, and notification settings link.

**Verify**: source tests or native unit tests cover routing decisions; manual checks only with operator permission.

## Test plan

- Rust/native tests for action routing and notification payloads.
- TS tests for hotkey definition compatibility.
- Manual native verification for menu items and notifications when permitted.

## Done criteria

- [ ] GPUI app menu and hotkeys match macOS.
- [ ] Context menus and drag/drop behavior match macOS where corresponding surfaces exist.
- [ ] GPUI session-attention notifications match macOS.
- [ ] OS-level integrations listed above match macOS.
- [ ] Targeted tests pass.

## STOP conditions

- A menu/hotkey action depends on a parity plan that has not landed.
- Notification parity requires logging session/project names.
- App menu implementation conflicts with GPUI platform limitations.

## Maintenance notes

New shared hotkeys must be added to macOS and GPUI dispatch in the same change.

