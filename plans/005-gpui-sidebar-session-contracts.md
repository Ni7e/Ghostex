# Plan 005: Match macOS sidebar session focus, gxserver launch plans, activity, and first-prompt flows

> **Executor instructions**: Follow this plan step by step. Stop and report on STOP conditions.
>
> **Drift check (run first)**: `git diff --stat 5d9960dff..HEAD -- gpui/sidebar/phase1-gxserver-runtime.ts gpui/sidebar/phase1-main.tsx gpui/src/main.rs gpui/src/cef/macos.rs native/sidebar/native-sidebar.tsx native/sidebar/gxserver-client.ts shared/gxserver-protocol.ts shared/gxserver-presentation-sidebar-projection.ts shared/session-grid-contract-sidebar.ts gxserver-rs/src`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans/004-gpui-terminal-launch-restore.md
- **Category**: correctness
- **Planned at**: commit `5d9960dff`, 2026-06-26

## Why this matters

The shared sidebar can render gxserver rows, but parity requires actions to affect the GPUI workspace exactly like macOS. Clicking sessions, creating agents, starting prompts, generated first-prompt title submission, attention/activity, and focus mode must route through the same authoritative contracts.

## Current state

- GPUI mounts shared `SidebarApp`: `gpui/sidebar/phase1-main.tsx:25`.
- GPUI create-agent paths call `/api/createAgentSession`: `gpui/sidebar/phase1-gxserver-runtime.ts:2466`.
- macOS reads `/api/readAgentLaunchPlan` before launch: `native/sidebar/gxserver-client.ts:515`.
- macOS ingests terminal title events through gxserver: `native/sidebar/gxserver-client.ts:1103`.
- Current GPUI source has a `WorkspaceTerminalFocus` bridge in `gpui/src/cef/macos.rs:164`; verify it before extending.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| GPUI sidebar runtime tests | `bun run test -- gpui/sidebar/phase1-gxserver-runtime` | relevant tests pass |
| Shared projection tests | `bun run test -- gxserver-presentation-sidebar-projection session-grid-contract-sidebar` | relevant tests pass |
| GPUI Rust tests | `cargo test --manifest-path gpui/Cargo.toml workspace_session_focus first_prompt -- --nocapture` | relevant tests pass |
| Typecheck | `bun run typecheck` | exit 0 |

## Scope

**In scope**:
- GPUI sidebar runtime bridges and tests.
- Rust parsing/storing of sidebar session focus/action payloads.
- gxserver launch-plan consumption and activity/title ingestion.
- First-prompt title submit/cancel parity.

**Out of scope**:
- Browser profiles and Browser first URL.
- Terminal low-level startup implementation, except through the APIs from Plan 004.

## Steps

### Step 1: Make local create/start/fork use gxserver launch plans

Port the macOS flow: create canonical gxserver session, read launch plan, then feed validated attach/start metadata to GPUI terminal startup. Do not pass renderer-resolved command strings as launch authority.

**Verify**: `bun run test -- gpui/sidebar/phase1-gxserver-runtime` includes endpoint sequence tests for create-agent, prompt-start, restore, and fork.

### Step 2: Complete sidebar click -> workspace focus/materialization

Use the fixed sidebar bridge to focus an existing mapped Agents tab or materialize a Mounting tab from gxserver attach metadata. If current implementation already exists, add tests and close gaps rather than duplicating it.

**Verify**: Rust tests cover existing mapping, missing mapping, stale mapping, gxserver attach unavailable, and focus mode restore.

### Step 3: Bridge terminal title/activity into gxserver

Wire actual GPUI terminal title/session-state events into gxserver endpoints so activity/attention/working status comes from the same source as macOS.

**Verify**: fake-gxserver tests prove `/api/ingestTerminalTitleEvent`, `/api/ingestSessionStateEvent`, and `/api/updateAgentActivity` are called with sanitized fields.

### Step 4: Match first-prompt generated-title flow

Port the macOS first-prompt helper behavior: consume presentation state, submit staged rename command exactly once when gxserver marks ready, and support cancel. Do not persist prompt text.

**Verify**: tests cover generating -> ready -> submitted, cancel, restart without duplicate submit, and missing terminal readiness.

## Test plan

- TS runtime endpoint-sequence tests for create/focus/fork/prompt flows.
- Rust tests for bridge payload parsing and workspace selection.
- Privacy tests that shell persistence contains no prompt/command text.

## Done criteria

- [ ] GPUI local agent/session creation uses gxserver launch plans.
- [ ] Sidebar session clicks focus or materialize the matching GPUI Agents tab.
- [ ] GPUI terminal title/activity feeds gxserver.
- [ ] First-prompt generated title flow matches macOS.
- [ ] Targeted TS and Rust tests pass.

## STOP conditions

- gxserver lacks the metadata needed to launch a macOS-equivalent terminal.
- A solution would trust renderer command/path/title data.
- Current in-progress bridge work conflicts with this plan; report the conflict instead of replacing it blindly.

## Maintenance notes

Keep sidebar IDs and GPUI shell IDs mapped explicitly. Do not derive workspace identity from tab titles or project names.

