# Plan 003: Match macOS support-bundle logging and Debugging Mode behavior

> **Executor instructions**: Follow this plan step by step. Run verification after every step. Stop on STOP conditions.
>
> **Drift check (run first)**: `git diff --stat 5d9960dff..HEAD -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/src/shared_settings.rs native/macos/ghostexHost/Sources/Shared/GhostexAppStorage.swift native/macos/ghostexHost/Sources/ghostexHost/TerminalFocusDebugLog.swift native/macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift native/sidebar/*log* sidebar/sidebar-app.tsx`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/001-gpui-parity-baseline.md
- **Category**: security
- **Planned at**: commit `5d9960dff`, 2026-06-26

## Why this matters

macOS support logs are safe for users to zip and send. GPUI needs comparable diagnostics for startup, CEF, sidebar, Source, terminal, focus, and modal failures without leaking private data. Absence of logs is privacy-safe but not parity.

## Current state

- macOS support logs live under `~/.ghostex/logs`: `native/macos/ghostexHost/Sources/Shared/GhostexAppStorage.swift:70`.
- macOS Debugging Mode reads shared settings: `GhostexAppStorage.swift:333`.
- macOS sanitizes at writer boundaries: `AppDelegate.swift:1894`; `TerminalFocusDebugLog.swift` contains `NativeLogPrivacy`.
- GPUI has stderr-only `GHOSTEX_GPUI_TRACE`, explicitly not a support-bundle log: `gpui/src/main.rs:51335`.
- Current GPUI source contains at least a focused session debug logging path around `append_gpui_sidebar_focus_debug_log_payload`; treat it as in-progress and verify before adding broader logging.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| GPUI logging tests | `cargo test --manifest-path gpui/Cargo.toml log privacy debug -- --nocapture` | relevant tests pass |
| TypeScript log tests | `bun run test -- support-log` | support-log tests pass |
| Typecheck | `bun run typecheck` | exit 0 |

## Scope

**In scope**:
- GPUI Rust logging helper/module.
- GPUI CEF/sidebar/Source/terminal diagnostic call sites.
- Tests proving gating, rotation/retention, and sanitization.

**Out of scope**:
- Logging raw renderer JSON, daemon response bodies, terminal content, commands, paths, URLs, tokens, cookies, page titles, or environment values.
- Replacing gxserver logging.

## Steps

### Step 1: Port the macOS logging contract

Implement a GPUI support-log writer under the shared Ghostex logs directory. Match macOS behavior: Debugging Mode gates routine logs; warning/error/failure logs may write when Debugging Mode is off; structured JSONL is preferred; retention and rotation match macOS where practical.

**Verify**: tests cover Debugging Mode off/on, failure-class bypass, path selection, rotation, and retention.

### Step 2: Implement writer-boundary sanitization

Create a Rust sanitizer equivalent to macOS categories: safe IDs/counts/booleans/timings pass; paths, URLs, titles, commands, stdout/stderr, tokens, cookies, secrets, environment values, page text, and user text are redacted or summarized.

**Verify**: tests feed representative private strings and assert none appear in output.

### Step 3: Wire high-value GPUI diagnostics

Add call sites for startup bootstrap, CEF init/load failures, sidebar bridge parse failures as counts/enums only, Source runtime failures, terminal startup/attach transitions, app-modal bridge errors, and focus-loop diagnostics. Do not add broad generic logging.

**Verify**: targeted tests prove each call site writes only sanitized fields.

## Test plan

- Rust unit tests for sanitizer, writer, gating, rotation, retention.
- Source tests that scan generated log output for forbidden raw strings.
- Existing macOS support-log source tests should remain green: `bun run test -- support-log`.

## Done criteria

- [ ] GPUI writes support-bundle logs under `~/.ghostex/logs`.
- [ ] Routine logs are Debugging Mode gated; important diagnostics can write with Debugging Mode off.
- [ ] Writer-boundary sanitizer has tests for all repository logging-rule categories.
- [ ] `cargo test --manifest-path gpui/Cargo.toml log privacy debug -- --nocapture` exits 0.

## STOP conditions

- A useful diagnostic seems to require logging private data.
- Existing GPUI in-progress logging has a conflicting path or privacy model.
- Rotation/retention would require deleting non-GPUI logs.

## Maintenance notes

Every future persistent GPUI log call must go through the sanitizer helper. Reviewers should reject ad hoc `fs::write` or `eprintln!` replacements for support-bundle logging.

