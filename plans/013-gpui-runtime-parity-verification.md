# Plan 013: Build the final runtime parity verification suite

> **Executor instructions**: Execute this only after Plans 002-012 have landed or been explicitly marked out of scope by the operator. Stop on STOP conditions.
>
> **Drift check (run first)**: `git diff --stat 5d9960dff..HEAD -- gpui native sidebar shared gxserver-rs docs plans`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/002-gpui-startup-window-first-run.md through plans/012-gpui-menu-bar-status-indicators.md
- **Category**: tests
- **Planned at**: commit `5d9960dff`, 2026-06-26

## Why this matters

Several GPUI parity docs and comments prove source boundaries, not running behavior. Final parity requires runtime evidence: launch, restore, focus, native input, CEF surfaces, Browser persistence, workarea actions, modals, OS integration, and support-bundle output must behave like macOS.

## Current state

- Existing tests include TypeScript/Vitest, Rust `cargo test`, source-inspection tests, and Storybook stories.
- The repo instruction says the app has no hot reload and `bun run start` must not be run unless the operator asks.
- Prior audit did not run runtime validation.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `bun run typecheck` | exit 0 |
| Full TS tests | `bun run test` | exit 0 |
| GPUI Rust tests | `cargo test --manifest-path gpui/Cargo.toml` | exit 0 |
| gxserver Rust tests | `cargo test --manifest-path gxserver-rs/Cargo.toml` | exit 0 |

## Scope

**In scope**:
- Automated tests, source tests, and manual verification checklist for final parity.
- Browser/Chrome/Cua/CEF verification scripts only if operator permits running the app.
- Support-bundle zip inspection test plan.

**Out of scope**:
- Implementing missing parity discovered during verification; file follow-up plans instead.
- Starting/restarting the app without explicit operator approval.

## Steps

### Step 1: Create a parity verification matrix

Write a Markdown checklist or test fixture covering every shipped macOS behavior claimed by Plans 002-012. Include owner plan, source files, automated test command, and manual runtime step if needed.

**Verify**: `rg -n "startup|terminal|Browser|Source|Kanban|Manage|Resources|status|support" plans` shows matrix coverage for every area.

### Step 2: Add automated regression tests first

For every behavior that can be tested without launching the app, add Rust/TS/source tests. Prefer exact parser/state-machine tests and privacy tests. Avoid brittle screenshot tests for pure logic.

**Verify**: `bun run test` and `cargo test --manifest-path gpui/Cargo.toml` pass.

### Step 3: Define runtime verification only after operator approval

Prepare a manual/runtime checklist that starts the app only when explicitly allowed. Include macOS-vs-GPUI side-by-side checks for:

- startup/relaunch/window restore/first-run
- terminal create/restore/wake/provider attach/clipboard/drop/settings
- sidebar session focus/focus mode/activity/title/first-prompt
- Browser profiles/cookies/import/project URL/history
- Source/Kanban/Manage actions
- modals/dropdowns/Resources/prompt editor/command palette
- app menu/hotkeys/context menus/notifications/status
- support-bundle contents and privacy

**Verify**: the checklist states the exact start command but marks it "do not run unless operator asks."

### Step 4: Add support-bundle privacy inspection

After runtime verification, inspect generated support logs for forbidden raw data. Build a script or documented command that searches for sample private strings created during the test.

**Verify**: the privacy inspection returns no forbidden strings.

## Test plan

- Full automated suite after implementation.
- Manual runtime checklist only with explicit operator approval.
- Support-bundle inspection using known planted private samples.

## Done criteria

- [ ] Every parity area has automated tests where practical.
- [ ] Every runtime-only behavior has a written manual verification step.
- [ ] Full TS and GPUI Rust test suites pass.
- [ ] Support-bundle privacy inspection exists and passes after runtime verification.

## STOP conditions

- Operator has not approved app start/restart for runtime checks.
- Verification reveals missing parity that belongs in a specific implementation plan.
- Logs contain private data during inspection.

## Maintenance notes

Treat this plan as the release gate for claiming GPUI parity. Source-ledger tests alone are not enough.

