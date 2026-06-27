# Plan 009: Match macOS settings effects, appearance, and configuration persistence

> **Executor instructions**: Follow this plan step by step. Stop on STOP conditions.
>
> **Drift check (run first)**: `git diff --stat 5d9960dff..HEAD -- gpui/src/shared_settings.rs gpui/src/main.rs gpui/native/macos gpui/sidebar/phase1-gxserver-runtime.ts shared/ghostex-settings.ts shared/ghostty-terminal-settings.ts sidebar/settings-modal.tsx native/sidebar/native-sidebar.tsx native/macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/002-gpui-startup-window-first-run.md, plans/006-gpui-terminal-input-clipboard-settings.md
- **Category**: correctness
- **Planned at**: commit `5d9960dff`, 2026-06-26

## Why this matters

GPUI already persists shared settings, but parity requires settings to have the same effects as macOS. A saved setting that does nothing in the running GPUI app is a behavior gap.

## Current state

- Shared settings type is in `shared/ghostex-settings.ts:442`.
- GPUI intentionally parses only consumed fields in `gpui/src/shared_settings.rs:176`.
- macOS Settings and native host fan out terminal, appearance, Source, Browser, notification, and status settings through native/sidebar code.
- GPUI currently forwards settings into sidebar runtime and some GPUI surfaces, but appearance/native chrome and many Ghostty effects remain partial.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| GPUI settings Rust tests | `cargo test --manifest-path gpui/Cargo.toml settings appearance ghostty -- --nocapture` | relevant tests pass |
| Shared settings tests | `bun run test -- ghostex-settings settings-modal ghostty-terminal-settings` | relevant tests pass |
| Typecheck | `bun run typecheck` | exit 0 |

## Scope

**In scope**:
- GPUI settings parsing for all fields GPUI must apply.
- Native chrome appearance: sidebar/titlebar colors, workspace background, focused pane border, Browser toolbar if applicable.
- Source runtime settings restart debounce.
- Notification/status settings fan-out.

**Out of scope**:
- Browser durable profile implementation; covered by Plan 007.
- Terminal input/clipboard settings; covered by Plan 006, except mapping dependencies.

## Steps

### Step 1: Build a macOS-to-GPUI settings effect matrix

For every setting GPUI exposes through shared Settings, record the macOS effect and the GPUI effect. Settings with no GPUI effect must either be implemented or hidden only if macOS hides them in the same context. Product decision favors implementation.

**Verify**: add a Markdown or test fixture matrix under `plans/` or tests; `rg -n "workspaceBackgroundColor|customSidebarTitlebar|terminalGhosttyTheme" gpui/src gpui/native` shows implementation consumers.

### Step 2: Apply appearance settings to GPUI native chrome

Thread appearance settings into GPUI titlebar, sidebar edges, workspace background, pane borders, terminal host background, and Browser toolbar equivalents. Match macOS colors and normalization.

**Verify**: Rust tests assert normalized settings map to expected style values.

### Step 3: Match Source settings restart debounce

Port macOS debounce/last-action-wins behavior for Source code-server user config and Insiders settings. Re-read final settings at fire time and restart only awake Source runtimes.

**Verify**: tests simulate rapid toggles and assert one restart with final settings.

### Step 4: Keep settings persistence private and compatible

Preserve whole-object writes without stripping unknown TypeScript fields. Do not write paths, runtime URLs, cookies, or terminal content into settings.

**Verify**: round-trip tests with unknown fields and sensitive sample values.

## Test plan

- Rust tests for GPUI settings snapshot, appearance mapping, restart debounce.
- Existing shared settings Vitest tests remain green.
- Visual verification only when operator permits.

## Done criteria

- [ ] Every user-visible shared setting exposed in GPUI has the macOS-equivalent effect or a documented macOS-equivalent hidden state.
- [ ] GPUI native appearance matches macOS settings behavior.
- [ ] Source settings restart behavior matches macOS debounce.
- [ ] Targeted Rust and TS tests pass.

## STOP conditions

- A setting requires platform behavior GPUI cannot provide without a product decision.
- Applying a setting would require logging or persisting private runtime data.

## Maintenance notes

When new settings are added, require a macOS effect and GPUI effect in the same change.

