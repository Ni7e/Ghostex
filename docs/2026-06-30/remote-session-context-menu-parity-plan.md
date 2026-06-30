# Remote Session Context Menu Parity Plan

## Goal

Bring remote gxserver session context menus closer to regular local session menus for both macOS and Linux remote machines. The implementation should route actions to the owning remote gxserver or to an existing local remote-attach carrier. It should not add frontend guesses, local-only fallbacks, or OS-specific branches where the gxserver protocol already provides an OS-neutral path.

## Screenshot menu target:

- Rename
- Pin
- Tag as
- Sleep / Wake
- Copy details
- Delayed Send
- Close After Done
- Fork
- Full reload
- Pop Out Pane / Restore Pane
- Sleep below
- Close below

## Current Code Findings

`sidebar/sortable-session-card.tsx` owns the session context menu. Most menu visibility is based on `SidebarSessionItem` data, not on whether the owning group is remote. Remote rows are detectable through `sessionGroup.remoteMachineContext`.

`native/sidebar/native-sidebar.tsx` already parses remote scoped ids with `parseRemotePresentationSessionId(...)` and `parseRemotePresentationGroupId(...)`. Several context-menu messages already have remote branches:

- `renameSession` -> `/api/updateSession`
- `setSessionPinned` -> `/api/updateSession`
- `setSessionTag` -> `/api/updateSession`
- `setSessionSleeping` / `setSessionsSleeping` -> `/api/sleepSession` or `/api/wakeSession`
- `closeSession` / `closeSessions` -> `/api/killSession`
- `fullReloadSession` -> kill then wake on the remote gxserver
- `copyResumeCommand` -> remote `/api/readAgentResumePlan`
- `copyAttachCommand` -> remote `/api/attachSessionMetadata`
- `copySessionDetails` -> clipboard text built from the rendered row, already includes remote machine/project metadata

Remote requests use `requestRemoteGxserver(machineId, path, params)`, so the same code path works for macOS and Linux remote gxservers.

The current explicit gaps are:

- `forkSession` detects remote ids but only shows “Remote fork unavailable”.
- `popOutPane` detects remote ids but only shows “Pop Out Pane is local-only”.
- `scheduleDelayedSend`, `cancelDelayedSend`, and `toggleCloseAfterDone` are local-native timer paths and do not parse remote ids.
- Menu visibility for remote rows should be made intentional. Some items may already appear from shared `SidebarSessionItem` data, but the desired parity should be covered by source tests instead of relying on accidental gates.

## Implementation Plan

### 1. Keep Shared Menu Rendering, Add Remote-Aware Gates

Update `sidebar/sortable-session-card.tsx` so remote session menu eligibility is explicit:

- Keep Rename, Pin, Tag as, Sleep/Wake, Copy details, Full reload, Sleep below, and Close below visible for remote terminal/agent rows.
- Keep Copy resume and Copy attach visible when the remote row has the same required metadata as local rows.
- Allow Fork for supported remote agent rows using the same `supportsFork(session)` gate as local sessions.
- Gate Pop Out Pane separately for remote rows. It should appear only when there is a running local remote-attach carrier for that remote session, because pop-out is an AppKit/local pane operation.
- Gate Delayed Send and Close After Done through remote-specific capability checks instead of reusing local-only terminal assumptions.

Do not create a separate remote context-menu component unless the shared menu becomes unreasonably branchy. The current shared menu is the right place because it already builds actions from normalized `SidebarSessionItem` rows.

### 2. Implement Remote Fork Through Remote gxserver

Replace the current remote `forkSession` toast in `native/sidebar/native-sidebar.tsx` with a real remote helper:

- Parse the remote scoped session id.
- Call `requestRemoteGxserver(machineId, "/api/forkSession", { projectId, sessionId })`.
- Refresh that machine’s presentation snapshot after success.
- Do not materialize a local pane for the forked session. The new row belongs to the remote project and should appear through the remote presentation stream.
- On error, show the same style of concise app toast used by other remote gxserver actions.

This is OS-neutral because `/api/forkSession` is a gxserver-rs endpoint allowed for remote protocol use.

### 3. Implement Remote Delayed Send With Remote gxserver Enter

Add a remote-specific delayed-send path in `native/sidebar/native-sidebar.tsx`:

- When `scheduleDelayedSend` receives a remote scoped session id, store a timer keyed by the full remote session id.
- On fire, call remote gxserver `/api/sendSessionEnter` with `{ projectId, sessionId }`.
- Track deadline/remaining label for remote rows so the existing sidebar clock UI can render through `resolveDelayedSend` when projecting remote sessions.
- Support `cancelDelayedSend` for remote scoped session ids.
- Keep timer state in the macOS app initially, matching the current host-owned Delayed Send model. Do not invent remote shell commands or local attach fallbacks.

Follow-up option: move Delayed Send into gxserver later if it needs to survive closing the macOS app or be visible/controlable from other clients.

### 4. Implement Remote Close After Done Using Remote Presentation State

Add a remote close-after-done watcher keyed by the full remote session id:

- `toggleCloseAfterDone` should parse remote ids and arm/cancel a remote timer.
- The watcher should evaluate the remote presentation snapshot for that machine/project/session.
- Treat remote done/attention/agent-idle using the same semantic rule as local Close After Done: attention is done; non-working agent-backed rows count as done.
- When the three-minute done window completes, call remote gxserver `/api/killSession`.
- Project the armed/deadline state into remote `SidebarSessionItem` rows via `createRemotePresentationSidebarSession(...)`.

This keeps behavior in the macOS app like the existing local implementation, but the actual close operation remains remote gxserver-owned.

### 5. Implement Remote Pop Out Pane Only For Existing Attach Carriers

Do not pop out a remote row by guessing or creating hidden local UI. Pop-out is local AppKit presentation, so it is valid only when the remote session already has a running local attach carrier.

Plan:

- Add a helper that resolves `remote scoped session id -> local carrier session id` from `remoteAttachLocalSessionIdByRemoteSessionId`.
- Expose Pop Out Pane for a remote row only when that helper finds a live carrier.
- Route `popOutPane` on remote ids to the existing local carrier’s `handleNativeTerminalTitleBarAction(..., "popOut" | "restorePopOut")`.
- If the carrier disappeared between menu open and click, hide/ignore with a toast and remove the stale map entry.

This avoids the bad version where clicking Pop Out Pane silently creates or focuses a new SSH attach session first.

### 6. Verify Existing “Below” Actions

`Sleep below` and `Close below` already send lists of scoped session ids. The native handler already splits local and remote ids for `setSessionsSleeping` and `closeSessions`. The implementation pass should still add source coverage proving remote scoped ids stay in those bulk paths.

## Tests / Checks

Add focused source or unit coverage rather than Swift tests.

Recommended checks:

- `native/sidebar/remote-presentation-source.test.ts`
  - Remote session rows use the shared menu and keep expected context-menu affordances.
  - Remote fork no longer contains the “Remote fork unavailable” branch.
  - Remote delayed-send and close-after-done branches parse scoped remote ids.
  - Remote pop-out is carrier-gated and does not create a carrier as a fallback.

- `shared/session-details-copy.test.ts`
  - Remote Copy details keeps Remote Machine / Project / Project Path fields.

- `sidebar` interaction/source coverage
  - Remote fixture row shows Rename, Pin, Tag as, Sleep/Wake, Copy details, Full reload, Sleep below, Close below.
  - Remote supported agent row shows Fork.
  - Remote row with an attach carrier shows Pop Out Pane; one without a carrier does not.
  - Remote timer-capable rows show Delayed Send and Close After Done when the native handlers support scoped ids.

Manual verification after implementation:

- Run the app only if explicitly requested.
- Connect to a Linux remote gxserver and a macOS remote gxserver.
- Right-click remote terminal and remote Codex rows.
- Confirm actions mutate only the owning remote gxserver.
- Confirm local hidden remote-attach carrier rows do not appear in normal local project sections.

## Proposed First Implementation Order

1. Add helper predicates for remote scoped session/group ids and remote attach carrier resolution.
2. Make remote menu visibility intentional in `sidebar/sortable-session-card.tsx`.
3. Replace remote Fork toast with remote `/api/forkSession`.
4. Add remote Delayed Send timer support using `/api/sendSessionEnter`.
5. Add remote Close After Done watcher using remote presentation state and `/api/killSession`.
6. Add carrier-gated remote Pop Out Pane.
7. Add source/unit coverage for the above.

## Expected Result

Remote macOS and Linux sessions should show the same context-menu items wherever the action has a real remote gxserver or local carrier implementation. Items that are inherently local AppKit actions should appear only when a local carrier exists. Timer actions should operate through remote gxserver session APIs, not through copied shell commands or assumed local terminal state.
