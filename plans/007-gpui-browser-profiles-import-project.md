# Plan 007: Match macOS Browser profiles, cookies, import, project seeding, and history behavior

> **Executor instructions**: Follow this plan step by step. Stop on STOP conditions.
>
> **Drift check (run first)**: `git diff --stat 5d9960dff..HEAD -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/sidebar/phase1-active-project-context.ts gpui/sidebar/phase1-gxserver-runtime.ts native/macos/ghostexHost/Sources/ghostexHost/NativeBrowserProfiles.swift native/macos/ghostexHost/Sources/ghostexHost/GhostexCEFBridge.mm native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift native/sidebar/native-sidebar.tsx`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans/001-gpui-parity-baseline.md, plans/003-gpui-support-logging-debugging.md
- **Category**: correctness
- **Planned at**: commit `5d9960dff`, 2026-06-26

## Why this matters

The product decision is explicit: GPUI Browser must match macOS exactly, including durable CEF profiles/cookies/import. UI affordances that look like profiles or import cannot remain shell-only.

## Current state

- macOS Browser profiles are implemented in `NativeBrowserProfiles.swift`.
- macOS CEF request contexts persist profile storage and session cookies in `GhostexCEFBridge.mm`.
- GPUI currently creates CEF request contexts with `persist_session_cookies: 0`: `gpui/src/cef/macos.rs:2362`.
- GPUI active-project snapshots reject `browserWorkareaId`: `gpui/sidebar/phase1-active-project-context.ts:11`.
- macOS Browser project mode resolves the current project's GitHub remote before falling back to default URL; inspect `native/sidebar/native-sidebar.tsx` project Browser creation paths.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| GPUI Browser Rust tests | `cargo test --manifest-path gpui/Cargo.toml browser profile import history -- --nocapture` | relevant tests pass |
| GPUI sidebar tests | `bun run test -- gpui/sidebar/phase1-active-project-context gpui/sidebar/phase1-gxserver-runtime` | relevant tests pass |
| Typecheck | `bun run typecheck` | exit 0 |

## Scope

**In scope**:
- GPUI CEF profile request context persistence.
- Browser profile naming/selection/last-used persistence matching macOS.
- Browser import behavior matching macOS.
- Browser first-open project URL behavior matching macOS.
- Browser History menu semantics matching macOS.

**Out of scope**:
- Source/Kanban/Manage workareas, except Browser active-project contract changes they consume.
- Generic non-CEF web engine paths.

## Steps

### Step 1: Port durable CEF profile storage

Make GPUI request contexts match macOS profile storage and cookie persistence. Use the same privacy boundaries: durable CEF data can exist as Browser runtime/profile data, but shell state and logs must not include profile paths, cookies, URLs, titles, history, or page data.

**Verify**: Rust tests assert request context settings include persistent profile storage and session-cookie persistence as macOS requires.

### Step 2: Implement Browser profile model parity

Match macOS profile names, last-used profile, picker behavior, profile isolation, and beta gating. Do not keep generated numeric shell ids as the only durable model if macOS has named profiles.

**Verify**: tests cover create/select/rename/delete/default/last-used and restart model restore.

### Step 3: Implement Browser import parity

Port macOS import behavior for cookies/profile data into the selected GPUI CEF profile. Remove or replace the unsupported notification.

**Verify**: add tests with importer fixtures; assert imported data lands in selected profile only and logs contain no cookies/paths.

### Step 4: Match project Browser first-open behavior

Do not guess from old docs. Inspect current macOS `native/sidebar/native-sidebar.tsx` and implement exactly the same contract. If macOS uses active project GitHub remote and remembered tabs, GPUI should do the same. Change the GPUI active-project/Browser identity contract as needed to match macOS, with explicit privacy-safe fields.

**Verify**: project with GitHub origin opens repo on first Browser activation; non-GitHub/no-remote uses default; existing Browser tabs are reused.

### Step 5: Match Browser History semantics

macOS right-side History opens selected history rows in a new Browser tab for project Browser. GPUI currently uses active-tab navigation history. Split these behaviors to match macOS.

**Verify**: tests show selecting a History row creates a new tab and preserves the old tab.

## Test plan

- Rust tests for request context settings and sanitized shell persistence.
- TS tests for active-project Browser contract, first URL, profile UI, and History semantics.
- Manual restart/profile/import verification only when operator permits.

## Done criteria

- [ ] GPUI durable Browser profiles/cookies/import match macOS.
- [ ] Browser project first-open behavior matches macOS exactly.
- [ ] Browser History menu behavior matches macOS.
- [ ] No Browser runtime private data leaks into shell state or support logs.
- [ ] Targeted Rust and TS tests pass.

## STOP conditions

- Current macOS Browser behavior cannot be determined from source.
- A change would persist raw URLs/titles/cookies in GPUI shell state or support logs.
- CEF API limitations block durable profile parity without a design decision.

## Maintenance notes

Any future Browser active-project contract change must be validated against macOS, not historical GPUI source-ledger docs.

