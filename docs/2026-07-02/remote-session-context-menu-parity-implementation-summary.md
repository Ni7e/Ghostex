# Remote Session Context Menu Parity Implementation Summary

Date: 2026-07-02

## User Request

The task was to implement the plan in `docs/2026-06-30/remote-session-context-menu-parity-plan.md` by running a separate subagent for each part of the plan. The subagents were requested to use `gpt-5.5` with `xhigh` reasoning and to avoid conflicts by owning separate slices of the implementation.

## Requirements

- Keep the shared session context menu instead of creating a separate remote-only menu component.
- Make remote menu eligibility explicit for remote gxserver rows.
- Preserve parity for actions that already have a real remote gxserver path:
  - Rename
  - Pin
  - Tag as
  - Sleep / Wake
  - Copy details
  - Full reload
  - Sleep below
  - Close below
- Keep Copy resume and Copy attach visible only when the remote row has the same required metadata as local rows.
- Allow Fork for supported remote agent rows through the same support gate as local sessions.
- Implement remote Fork through the owning remote gxserver using `/api/forkSession`.
- Implement remote Delayed Send as a host-owned timer that fires through the owning remote gxserver using `/api/sendSessionEnter`.
- Implement remote Close After Done as a host-owned watcher that evaluates remote presentation state and closes through the owning remote gxserver using `/api/killSession`.
- Make Pop Out Pane available for remote rows only when an existing local remote-attach carrier is live.
- Do not create or focus a remote attach carrier as a fallback for Pop Out Pane.
- Do not add frontend guesses, local-only fallbacks, shell-command fallbacks, or OS-specific branches where the gxserver protocol provides an OS-neutral path.
- Verify Sleep below and Close below keep remote scoped ids in the remote bulk paths.
- Add focused source/unit coverage rather than macOS app tests.
- Do not run `bun run start`.

## Subagent Split

The work was delegated into separate non-overlapping implementation slices:

- Sidebar context-menu gates and row capability contract.
- Remote Fork through gxserver.
- Remote Delayed Send timers and projection.
- Remote Close After Done watcher and projection.
- Remote Pop Out Pane carrier gating and routing.
- Source/unit coverage for the parity requirements.

The final integration pass checked the combined worktree and fixed one connector gap: remote rows needed to project the explicit `canScheduleDelayedSend` capability so the new sidebar gate could actually expose Delayed Send for remote terminal/agent rows.

## Implemented Behavior

- Remote terminal/agent rows now use explicit context-menu eligibility through shared sidebar code.
- Remote rows carry explicit capability fields for host-owned or carrier-owned actions:
  - `canScheduleDelayedSend`
  - `canToggleCloseAfterDone`
  - `canPopOutPane`
- Remote Fork now parses the scoped remote session id, calls `/api/forkSession` on the owning remote gxserver, and refreshes that machine's presentation snapshot. It no longer shows the old "Remote fork unavailable" path.
- Remote Delayed Send now stores timers keyed by the full remote session id, projects countdown state to the sidebar row, supports cancellation, and sends Enter through `/api/sendSessionEnter` when the timer fires.
- Remote Close After Done now stores watchers keyed by the full remote session id, evaluates the remote presentation snapshot using the same done semantics as local gxserver rows, projects armed/deadline state to the sidebar row, and closes through `/api/killSession`.
- Remote Pop Out Pane now resolves the scoped remote session id to an existing live local attach carrier, routes through the carrier's native pop-out action, and removes stale carrier mappings instead of creating a new carrier.
- Sidebar row equality now includes the remote capability and pop-out fields so hydrated remote rows update menu visibility and Restore Pane labeling correctly.
- Remote Copy details coverage confirms Remote Machine, Project, and Project Path fields remain present.
- Source coverage verifies remote bulk Sleep below and Close below split scoped remote ids into remote paths.

## Verification Run

The final combined verification passed:

```bash
bunx vitest run native/sidebar/remote-presentation-source.test.ts native/sidebar/delayed-send-source.test.ts native/sidebar/close-after-done-source.test.ts native/sidebar/remote-attach-source.test.ts shared/session-details-copy.test.ts sidebar/sortable-session-card.test.ts sidebar/sidebar-store.test.ts
bun run typecheck
git diff --check -- native/sidebar/native-sidebar.tsx native/sidebar/remote-presentation-source.test.ts native/sidebar/delayed-send-source.test.ts shared/session-grid-contract-sidebar.ts shared/session-details-copy.test.ts sidebar/sortable-session-card.tsx sidebar/sortable-session-card.test.ts sidebar/sidebar-store.ts sidebar/sidebar-store.test.ts
```

No app restart was run.
