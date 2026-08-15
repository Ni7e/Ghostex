# Plan 001: Establish GPUI parity decision and verification baseline

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If a STOP condition occurs, stop and report.
>
> **Drift check (run first)**: `git diff --stat 5d9960dff..HEAD -- plans docs gpui native sidebar shared gxserver-rs`
> Then run: `git status --short -- plans docs gpui native sidebar shared gxserver-rs`
> If any in-scope file changed since this plan was written, compare the "Current state" notes against live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `5d9960dff`, 2026-06-26

## Why this matters

The remaining GPUI parity work is large and will be split across agents. Without one central decision document, agents will keep re-litigating whether GPUI may diverge from macOS. The product decision is clear: GPUI must match the current macOS app exactly in behavior, while implementation details may use GPUI-native components where appropriate.

## Current state

- `docs/gpui-port-handover.md` and `docs/gpui-workspace-area-parity-requirements.md` contain historical source-ledger notes and deferred runtime caveats.
- `plans/README.md` now records the global product decisions and the numbered parity work packages.
- The repository has strict logging, CDXC comment, layout, destructive-operation, and app-restart rules in `AGENTS.md`.
- The root scripts expose `bun run typecheck`, `bun run test`, and GPUI Rust tests through `cargo test --manifest-path gpui/Cargo.toml`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Inspect plan index | `sed -n '1,220p' plans/README.md` | index contains all numbered GPUI parity plans |
| Typecheck docs references lightly | `rg -n "macOS app is the source of truth|GPUI must adhere 100%" plans` | finds the global decision text |

## Scope

**In scope**:
- `plans/README.md`
- `plans/001-gpui-parity-baseline.md`
- Optional: a new `docs/gpui-parity-decisions.md` only if the operator explicitly wants product docs outside `plans/`.

**Out of scope**:
- Any implementation under `gpui/`, `native/`, `sidebar/`, `shared/`, or `gxserver-rs`.
- Running or restarting the app.

## Steps

### Step 1: Confirm the global product decision is visible

Read `plans/README.md` and confirm it states:

- GPUI must match current macOS behavior 100%.
- Durable Browser profiles should match macOS.
- Dropdown/menu behavior should use GPUI popovers where appropriate.
- Browser active-project behavior should be copied from macOS.
- First-run, generated titles, menu-bar, and floating status should match macOS.

**Verify**: `rg -n "100%|profiles|popovers|first-run|Generate Name|menu-bar" plans/README.md` -> all product decisions appear.

### Step 2: Add or refine decision docs only if the operator asks

If the operator asks for a product-facing doc outside `plans/`, create a concise `docs/gpui-parity-decisions.md` that repeats the decisions from `plans/README.md`. Do not edit implementation code.

**Verify**: `git diff --stat -- plans docs` -> only Markdown plan/decision docs changed.

## Test plan

No runtime tests are required for this planning baseline. Verification is file-content inspection.

## Done criteria

- [ ] `plans/README.md` contains the global parity decisions.
- [ ] Every later plan can reference `plans/README.md` for the shared decision.
- [ ] No implementation files were modified by this plan.

## STOP conditions

- The operator asks for implementation instead of planning.
- The product decision conflicts with a newer explicit user instruction.

## Maintenance notes

When product decisions change, update `plans/README.md` first, then update any affected plan files before dispatching agents.
