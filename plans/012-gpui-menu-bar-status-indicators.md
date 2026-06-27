# Plan 012: Match macOS menu-bar and floating status indicators

> **Executor instructions**: Follow this plan step by step. Stop on STOP conditions.
>
> **Drift check (run first)**: `git diff --stat 5d9960dff..HEAD -- gpui/src/main.rs gpui/native/macos/GpuiMenuBarStatusItem.m gpui/build.rs gpui/sidebar/phase1-gxserver-runtime.ts native/macos/ghostexHost/Sources/ghostexHost/SessionStatusIndicatorController.swift native/sidebar/native-sidebar.tsx shared/gxserver-presentation-sidebar-projection.ts shared/ghostex-settings.ts`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/005-gpui-sidebar-session-contracts.md, plans/011-gpui-menus-hotkeys-os-notifications.md
- **Category**: correctness
- **Planned at**: commit `5d9960dff`, 2026-06-26

## Why this matters

Product decision: GPUI should implement menu-bar and floating status behavior like macOS. The current worktree already contains apparent in-progress GPUI menu-bar status item work; this plan is to finish, verify, and align it exactly with macOS.

## Current state

- macOS status controller starts at `native/macos/ghostexHost/Sources/ghostexHost/SessionStatusIndicatorController.swift:10`.
- macOS sidebar computes status indicator payloads in `native/sidebar/native-sidebar.tsx`.
- Current GPUI worktree includes `gpui/native/macos/GpuiMenuBarStatusItem.m` and Rust bridge calls around `apply_gpui_menu_bar_status_item_state`; verify live code before editing.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| GPUI status Rust tests | `cargo test --manifest-path gpui/Cargo.toml menu_bar_status session_status -- --nocapture` | relevant tests pass |
| Status TS tests | `bun run test -- menu-bar-status-indicator session-status ghostex-settings` | relevant tests pass |
| Typecheck | `bun run typecheck` | exit 0 |

## Scope

**In scope**:
- GPUI macOS menu-bar status item.
- GPUI floating status panel if macOS has one enabled by settings.
- Running Agents dropdown/modal from menu-bar click.
- Count precedence: attention/working suppress available exactly as macOS.
- Hide/show settings and click routing to project/session.

**Out of scope**:
- Session-attention notifications, covered by Plan 011.
- General Resources titlebar surface, covered by Plan 010.

## Steps

### Step 1: Diff current GPUI status work against macOS

Read `SessionStatusIndicatorController.swift` and current `GpuiMenuBarStatusItem.m`. Build a checklist for badge rendering, visibility settings, click behavior, project/session rows, Restart/Quit footer, drag positioning if floating panel exists, and secondary-click behavior.

**Verify**: add tests or source assertions that map each macOS behavior to GPUI.

### Step 2: Finish menu-bar badge parity

Implement missing badge count ordering, hide settings, empty-state behavior, left-click behavior, exact item rect behavior, and visual styling. Do not pass renderer JSON to AppKit; Rust should pass bounded copied fields.

**Verify**: Rust/native tests cover attention, working, available, hidden, empty, multi-project, and malformed payload.

### Step 3: Finish Running Agents dropdown parity

Match macOS Running Agents project/session rows, click-to-focus callbacks, footer commands, and no-op secondary click if macOS requires it. Use current GPUI/AppKit bridge as appropriate.

**Verify**: tests cover project click, session click, quit/restart actions, order, truncation, and privacy.

### Step 4: Implement floating status panel if still missing

If current GPUI has only menu-bar status but macOS has floating badges, implement the floating panel behavior or document exact setting-gated absence if macOS disables it. Product rule says match macOS.

**Verify**: tests cover visible/hidden, drag persistence if implemented, and count consistency with menu-bar.

## Test plan

- Rust tests for status projection parsing and FFI structs.
- Native source tests modeled after `native/sidebar/menu-bar-status-indicator-source.test.ts`.
- Manual menu-bar/floating verification only when operator permits.

## Done criteria

- [ ] GPUI menu-bar status item matches macOS.
- [ ] GPUI floating status behavior matches macOS if current macOS exposes it.
- [ ] Counts, ordering, click routing, settings, and privacy are tested.
- [ ] Targeted Rust and TS tests pass.

## STOP conditions

- Current in-progress GPUI status implementation conflicts with this plan.
- AppKit status APIs cannot support a macOS behavior in GPUI without a design decision.
- Payloads would need private titles/paths beyond macOS behavior.

## Maintenance notes

Any future session activity projection change must update macOS status and GPUI status together.

