# Plan 004: Match macOS terminal launch, restore, provider attach, and terminalReady handoff

> **Executor instructions**: Follow this plan step by step. Run verification before moving on. Stop on STOP conditions.
>
> **Drift check (run first)**: `git diff --stat 5d9960dff..HEAD -- gpui/src/main.rs gpui/src/terminal_ghostty_surface.rs gpui/src/terminal_native_view.rs gpui/native/macos/GpuiTerminalAppKitAdapter.m native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift native/sidebar/native-sidebar.tsx shared/native-ghostty-host-protocol.ts`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans/001-gpui-parity-baseline.md, plans/003-gpui-support-logging-debugging.md
- **Category**: correctness
- **Planned at**: commit `5d9960dff`, 2026-06-26

## Why this matters

The terminal is the core product surface. GPUI must not merely render terminal-shaped tabs; it must match macOS launch payloads, provider attach, restored session behavior, startup text ordering, close semantics, and terminal readiness handoff.

## Current state

- macOS creates terminals in `TerminalWorkspaceView.createTerminal`: `TerminalWorkspaceView.swift:3546`.
- macOS sends `terminalReady` after native surface creation: `TerminalWorkspaceView.swift:4030`; sidebar consumes it around `native-sidebar.tsx:46659`.
- GPUI has shell state and libghostty mount/startup plumbing in `gpui/src/main.rs`, including real mounted body event forwarding and startup placeholders.
- Audit found gaps around generic command-pane launch payloads, local provider attach, restored sessions, and terminalReady-equivalent readiness.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| GPUI terminal tests | `cargo test --manifest-path gpui/Cargo.toml terminal startup restore attach -- --nocapture` | relevant tests pass |
| Sidebar terminal tests | `bun run test -- native-sidebar` | selected terminal/session tests pass |
| Typecheck | `bun run typecheck` | exit 0 |

## Scope

**In scope**:
- GPUI terminal startup payload sources.
- Agents and command-pane terminal restore/materialization paths.
- Tests for provider attach, cwd/env/command/initial input, readiness, and privacy.

**Out of scope**:
- Browser profiles.
- App modal UI.
- Implementing fallback shells where macOS would attach/restore a provider session.

## Steps

### Step 1: Document macOS terminal launch matrix in code tests

Capture macOS behavior cases: plain terminal, command action tab, restored provider session, zmx/tmux/zellij attach, missing cwd, missing provider metadata, startup text, delayed send, and close-after-done.

**Verify**: new GPUI Rust tests enumerate the cases and initially fail or assert TODO state before implementation.

### Step 2: Feed authoritative launch payloads into GPUI

Wire every GPUI path that semantically owns a command/session to an explicit launch payload source. Payloads must come from gxserver/macOS-equivalent authority, not renderer labels or persisted shell titles. Store only runtime payloads in memory; shell persistence must remain private-data-free.

**Verify**: tests show restored/created sessions get cwd/env/attach/initial input only from trusted payload producers.

### Step 3: Implement terminalReady-equivalent handoff

Expose and consume a real readiness signal for GPUI Ghostty surfaces. Promote Mounting placeholders to Running only after exact owner/runtime id match. Send startup text only after readiness, matching macOS ordering.

**Verify**: tests assert no startup text is sent before readiness and exactly-once send after readiness.

### Step 4: Match close, preserve, and process cleanup semantics

Compare macOS close/kill/preserve behavior and implement GPUI equivalents for running, sleeping, mounting, restored, failed, and popped-out states.

**Verify**: tests cover close with preserve, full quit cleanup, failed startup retry, and stale runtime owner cleanup.

## Test plan

- Rust model tests for launch payload formation and lifecycle transitions.
- Focused TS tests for sidebar terminalReady sequencing if shared sidebar code changes.
- Manual terminal runtime verification only when operator permits app launch.

## Done criteria

- [ ] GPUI restored/new terminal sessions materialize from authoritative payloads.
- [ ] Provider attach/new/restore behavior matches macOS.
- [ ] Startup text ordering matches macOS terminalReady behavior.
- [ ] Shell state persists no commands, paths, titles, stdout/stderr, tokens, or terminal content.
- [ ] Targeted Rust and TS tests pass.

## STOP conditions

- A path requires deriving commands or cwd from renderer labels or private persisted shell state.
- Ghostty readiness cannot be observed without changing upstream imported Ghostty code.
- The implementation would add transparent hit-test overlays.

## Maintenance notes

Every future terminal workflow should add a launch-matrix test. Do not accept visual placeholder parity as terminal parity.

