# Plan 002: Match macOS startup, gxserver bootstrap, window restore, and first-run flow

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm expected results. Stop on any STOP condition.
>
> **Drift check (run first)**: `git diff --stat 5d9960dff..HEAD -- gpui/src/main.rs gpui/src/shared_settings.rs native/macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift native/sidebar/native-sidebar.tsx shared/first-launch-setup-settings.ts`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/001-gpui-parity-baseline.md
- **Category**: correctness
- **Planned at**: commit `5d9960dff`, 2026-06-26

## Why this matters

macOS startup controls gxserver bootstrap ordering, window restoration, one-time first-run teaching, and shutdown cleanup. GPUI currently has a simpler startup path and shell restore. Product direction: GPUI must match current macOS behavior exactly, including first-run flow, while using GPUI-native implementation where appropriate.

## Current state

- macOS startup begins in `AppDelegate.applicationDidFinishLaunching` and installs timers, gxserver bootstrap, logs, update checks, and window creation: `native/macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift:1070`.
- macOS persists and restores main window chrome via `NativeMainWindowChromeSettings`: `AppDelegate.swift:5455`, `AppDelegate.swift:5856`, `AppDelegate.swift:2974`.
- GPUI startup opens one centered `1280x820` window in `fn main`: `gpui/src/main.rs:51255`.
- GPUI persists workspace shell state in `persist_gpui_workspace_shell_state`: `gpui/src/main.rs:21813`.
- Shared first-launch revision state lives in `shared/first-launch-setup-settings.ts:3`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| GPUI Rust targeted tests | `cargo test --manifest-path gpui/Cargo.toml startup window first_launch -- --nocapture` | relevant tests pass |
| TypeScript targeted tests | `bun run test -- first-launch` | first-launch tests pass |
| Typecheck | `bun run typecheck` | exit 0 |

## Scope

**In scope**:
- `gpui/src/main.rs`
- `gpui/src/shared_settings.rs`
- GPUI Rust tests in `gpui/src/main.rs` or nearby test modules
- Relevant shared first-launch tests if a shared helper is extended

**Out of scope**:
- Browser profile persistence, terminal launch payloads, support logging beyond startup events.
- AppKit hit-test overrides or transparent overlays.
- Running `bun run start` unless the operator explicitly asks.

## Steps

### Step 1: Copy macOS startup ordering, not just visual launch

Trace macOS startup from `applicationDidFinishLaunching` through gxserver bootstrap and first window/sidebar initialization. Add a GPUI startup state machine that waits for the same authoritative gxserver readiness/import facts before hydrating the sidebar CEF bridge. Do not hydrate from stale local shell state when macOS would wait for gxserver.

**Verify**: add Rust tests that simulate unavailable gxserver, ready gxserver, and imported/migrated state; `cargo test --manifest-path gpui/Cargo.toml startup_bootstrap -- --nocapture` exits 0.

### Step 2: Implement macOS-equivalent window geometry restore

Port the macOS restore rules: frame, screen id, screen frame, clamp/remap across monitor changes, and persist on move/resize/close. Store only geometry and stable display facts, not workspace paths or project names.

**Verify**: `cargo test --manifest-path gpui/Cargo.toml window_geometry -- --nocapture` exits 0 and covers missing monitor, offscreen frame, min-size clamp, and normal restore.

### Step 3: Match the current macOS first-run flow exactly

Inspect the current macOS path in `native/sidebar/native-sidebar.tsx` and `shared/first-launch-setup-settings.ts`; implement the same one-time startup flow in GPUI. If current macOS opens video first, GPUI opens video first. If current macOS then opens setup or marks a revision, GPUI does the same.

**Verify**: `bun run test -- first-launch-setup-settings` exits 0; add GPUI tests for unseen, current, old revision, and already-seen states.

### Step 4: Preserve privacy and layout invariants

Do not persist paths, project names, raw URLs, titles, commands, tokens, terminal content, or gxserver response bodies in startup/window state. Do not add fallback bootstrap heuristics.

**Verify**: add a persistence test that serializes GPUI startup/window state and asserts sensitive example strings are absent.

## Test plan

- Rust tests for startup state transitions, window restore, and shell-state privacy.
- TypeScript tests for first-launch revision compatibility if shared helpers change.
- Manual verification only when operator permits: relaunch with multiple monitors, first-run profile, migrated gxserver state.

## Done criteria

- [ ] GPUI waits for the same authoritative startup facts as macOS before sidebar hydration.
- [ ] GPUI restores and persists main-window geometry like macOS.
- [ ] GPUI first-run flow matches current macOS behavior exactly.
- [ ] `cargo test --manifest-path gpui/Cargo.toml startup window first_launch -- --nocapture` exits 0.
- [ ] `bun run typecheck` exits 0.

## STOP conditions

- Current macOS first-run behavior is ambiguous after reading source.
- Implementing parity appears to require broad native hit-test routing or transparent overlays.
- Startup code would need to persist private data to function.

## Maintenance notes

Any future macOS first-run revision or bootstrap ordering change must update GPUI in the same PR or explicitly mark GPUI drift.

