# Plan 008: Match macOS Source, Kanban, Manage workarea behavior

> **Executor instructions**: Follow this plan step by step. Stop on STOP conditions.
>
> **Drift check (run first)**: `git diff --stat 5d9960dff..HEAD -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/sidebar/phase1-project-workarea-cef-bridge.ts gpui/sidebar/phase1-active-project-context.ts native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift native/sidebar/native-sidebar.tsx native/sidebar/manage.tsx native/sidebar/manage-source.test.ts`

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans/005-gpui-sidebar-session-contracts.md, plans/007-gpui-browser-profiles-import-project.md
- **Category**: correctness
- **Planned at**: commit `5d9960dff`, 2026-06-26

## Why this matters

Source, Kanban, and Manage are project-scoped workareas. GPUI has source-ledger and some runtime CEF wiring, but parity requires the same user behavior as macOS: Source startup/restart, Kanban board automation, Beads actions, image bridge, Manage file bridge, and project identity handling.

## Current state

- macOS creates project editor panes through `TerminalWorkspaceView.createProjectEditorPane`: `TerminalWorkspaceView.swift:4942`.
- GPUI active-project snapshots carry Source/Kanban/Manage identity but reject Browser identity: `gpui/sidebar/phase1-active-project-context.ts:11`.
- GPUI has project workarea bridge handling in `gpui/src/main.rs` around project board, Beads, image, Manage file events.
- GPUI comments indicate Source runtime CEF replacement remains gated on real URL/process/surface authority.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| GPUI workarea Rust tests | `cargo test --manifest-path gpui/Cargo.toml source kanban manage project_workarea -- --nocapture` | relevant tests pass |
| GPUI workarea TS tests | `bun run test -- gpui/sidebar/phase1-project-workarea-cef-bridge gpui/sidebar/phase1-active-project-context manage` | relevant tests pass |
| Typecheck | `bun run typecheck` | exit 0 |

## Scope

**In scope**:
- Source runtime startup/readiness/restart behavior matching macOS.
- Kanban Project Board bridge automation, title generation, Beads, image flows.
- Manage file bridge list/read/write/save behavior.
- Project identity and Quick/projectless gate behavior.

**Out of scope**:
- Browser project URL/profile behavior except dependencies from Plan 007.
- Generic fallback URLs or path inference.

## Steps

### Step 1: Verify and complete Source runtime parity

Compare current macOS Source behavior with GPUI Source runtime. Implement missing debounce, startup, ready/failure, sleep/wake, code-server URL issuance, CEF surface replacement, and no-private-data persistence.

**Verify**: Rust tests cover ready, load failed, sleep/wake, restart debounce, missing project, Quick disabled state, and private data exclusion.

### Step 2: Complete Kanban Project Board automation

Port macOS Project Board response handling exactly, including conversation/start-work actions and generated title behavior. Keep gxserver ownership for Beads operations and privacy-safe payloads.

**Verify**: tests cover empty title generation, start-work action, Beads response shape, image paste request, and error event names.

### Step 3: Complete Manage file bridge parity

Match macOS Manage behavior: project-scoped file operations, no project path in page URL, safe file bridge, same read/write/save responses, same disabled states.

**Verify**: tests cover list, read, save, invalid path, outside-project rejection, Quick disabled, debug/beta gate, and no path leakage in logs.

### Step 4: Runtime validate CEF surfaces when permitted

Do not claim parity from source comments. Once implementation tests pass and operator permits app verification, validate that Source/Kanban/Manage load real surfaces and perform actions.

**Verify**: manual checklist recorded in PR notes; do not run `bun run start` without explicit permission.

## Test plan

- Rust tests for Source runtime and bridge state.
- TS tests for active-project gates and first-party web bridges.
- Privacy tests for path/URL/command exclusion.

## Done criteria

- [ ] Source runtime behavior matches macOS.
- [ ] Kanban Project Board automation matches macOS.
- [ ] Manage file bridge behavior matches macOS.
- [ ] No fallback probes, fake URLs, or path inference were added.
- [ ] Targeted Rust and TS tests pass.

## STOP conditions

- Current macOS behavior differs between WK and CEF in a way that needs product decision.
- Matching Manage requires exposing project paths in URLs/logs.
- Runtime validation shows CEF cannot support a required behavior.

## Maintenance notes

Future workarea changes must distinguish source-ledger evidence from running-app parity.

