# T3 Code Session Ownership Plan

## Goal

- Make every T3 Code pane in the Ghostex sidebar map 1:1 to one durable Ghostex gxserver session.
  - Ghostex owns the visible session row.
  - T3 Code owns the chat/runtime provider data for that row.
  - Users should not need T3 Code's full thread list for normal session navigation.

- Keep T3 Code's own sidebar accessible, but collapsed by default in Ghostex.
  - Do not fully remove or permanently hide it.
  - Show a small visible button/rail so users can expand it for T3 Code settings and native T3 controls.
  - Collapse it again by default when Ghostex opens an embedded T3 session.

- Keep the Ghostex sidebar row useful.
  - Show the real T3 thread title in the Ghostex sidebar.
  - Show T3 working/attention/idle state in the Ghostex sidebar.
  - Cleanup empty Ghostex-created T3 temp sessions so they do not accumulate.

## Current State Checked

- `gxserver-rs` already persists `kind: "t3"` sessions.
- The shared gxserver presentation projection already renders T3 rows as normal Ghostex sidebar sessions.
- GPUI creates/focuses T3 through id-only bridge messages and stores T3 metadata in `runtimeSettings.t3` / `providerState.t3`.
- The rebased `t3code` checkout has a Ghostex draft bootstrap patch that opens a usable composer from `/draft/:draftId?ghostexDraft=1...`.
- T3 Code still owns its own project/thread sidebar through `apps/web/src/components/AppSidebarLayout.tsx` and `apps/web/src/components/Sidebar.tsx`.
- macOS native sidebar has older T3 `threadReady` / `threadChanged` handling that preserves one Ghostex card per T3 thread.

## Core Rule

- The durable identity is always:
  - `ghostexProjectId`
  - `ghostexSessionId`

- T3 provider binding is metadata on that Ghostex session:
  - `serverOrigin`
  - `environmentId`
  - `t3ProjectId`
  - `t3ThreadId`
  - `workspaceRoot`

- T3 thread ids must not become visible app sessions by themselves.
  - If T3 needs a new conversation, Ghostex must create a new `kind: "t3"` gxserver session first.
  - Then T3 can bind that Ghostex session to a T3 draft/thread.

## Implementation Plan

1. Add a shared Ghostex T3 binding contract.

   - Add app-owned shared code, for example `shared/t3-session-binding.ts`.
   - Use it from GPUI, macOS native sidebar, and any sidebar renderer code that builds T3 routes.
   - The binding contract should build and parse one launch descriptor.

   ```text
   ghostexEmbedded=1
   ghostexProjectId=P...
   ghostexSessionId=G...
   ghostexDraft=1
   environmentId=...
   projectId=<t3ProjectId>
   threadId=ghostex-thread-<ghostexSessionId>
   createdAt=...
   t3SidebarMode=collapsed
   ```

   - Prefer `t3SidebarMode=collapsed` over `hideT3Sidebar=1`.
   - The default embedded behavior is collapsed, not inaccessible.
   - If the param is missing, T3 Code should keep its normal upstream sidebar behavior.

2. Make Ghostex session creation the only creation path.

   - Ghostex creates the gxserver `kind: "t3"` row first.
   - Ghostex derives the stable draft/thread id from the Ghostex session id.
   - Ghostex opens T3 Code with the launch descriptor.
   - T3 renderer code must not invent Ghostex ids, workspace paths, trusted URLs, commands, or project metadata.

   Platform helpers:

   - GPUI: factor `gpui_create_local_t3_session`, route URL creation, and focus handling behind a small `T3SessionController`.
   - macOS sidebar: route `createNativeT3Session`, restore, and thread binding through the same shared binding shape.

3. Add a small T3 embedded adapter inside `t3code`.

   Keep fork-local T3 edits under a narrow module such as `apps/web/src/ghostex/`.

   Suggested files:

   - `embeddedLaunch.ts`
     - Reads and validates `ghostexEmbedded`, `ghostexProjectId`, `ghostexSessionId`, `t3SidebarMode`, project id, thread id, and created time.
   - `draftBootstrap.ts`
     - Owns the existing Ghostex draft seeding behavior.
   - `hostEvents.ts`
     - Reports `ready`, `threadBound`, `threadTitleChanged`, `threadActivityChanged`, and `emptySessionObserved`.
   - `embeddedLayout.ts`
     - Tells the app shell whether the T3 sidebar should be normal or collapsed.
   - `embeddedCleanup.ts`
     - Implements T3-side empty-thread detection and deletion helpers.

   Touch upstream T3 files only at stable seams:

   - `routes/_chat.draft.$draftId.tsx`
     - Seed the Ghostex draft before route selection.
   - `components/AppSidebarLayout.tsx`
     - Render T3 sidebar collapsed when `t3SidebarMode=collapsed`.
     - Keep a visible expand button/rail.
     - Expanded mode should allow users to access T3 Code settings.
   - `components/ChatView.tsx`
     - Emit host sync when a draft is promoted to a real T3 thread.
     - Emit title/activity updates for the active Ghostex-bound thread.

4. Sync T3 title into the Ghostex sidebar.

   - When T3 has a title for a Ghostex-bound thread, send it to Ghostex with:
     - `ghostexProjectId`
     - `ghostexSessionId`
     - `t3ThreadId`
     - `title`
     - `titleSource`

   - Ghostex updates only that gxserver session row.
   - The Ghostex sidebar title should use the T3 thread title once available.
   - Before a real title exists, keep the existing placeholder `T3 Code`.
   - Do not guess titles from URL paths, project names, or T3 sidebar order.

5. Sync T3 status into the Ghostex sidebar.

   - T3 should report activity changes for the Ghostex-bound thread.
   - Map T3 state to Ghostex sidebar activity:
     - `working`
       - T3 thread turn is starting/running/streaming.
       - T3 is preparing a worktree or dispatching provider work.
     - `attention`
       - T3 is waiting for approval, user input, auth, provider selection, or a recoverable error that needs the user.
     - `idle`
       - No active turn and no user action needed.

   - Store this as gxserver session runtime metadata, consistent with existing `agentActivity` presentation.
   - Ghostex presentation should show the same working/attention UI affordances as other agent sessions.
   - The update path must never include prompt text, command text, stdout/stderr, tokens, cookies, full paths, or raw T3 response bodies.

6. Add one host sync endpoint/path.

   - Add a narrow Ghostex-owned sync path for T3 embedded events.
   - It should update exactly one row by `(ghostexProjectId, ghostexSessionId)`.

   Required validation:

   - The gxserver session exists.
   - The session is `kind: "t3"`.
   - The T3 project resolves to the same workspace root stored on the Ghostex session.
   - Incoming thread id matches the current binding, or the event is an explicit host-approved first bind/reassignment.
   - The update can change only:
     - T3 provider metadata.
     - lifecycle/activity state.
     - title/title source.
     - cleanup markers.

   This is a real synchronization path, not a fallback that creates hidden rows when metadata is missing.

7. Treat T3 navigation as Ghostex session selection.

   In embedded mode:

   - Opening the bound thread keeps the same Ghostex row.
   - Navigating to another existing T3 thread asks Ghostex to focus the Ghostex session already bound to that thread.
   - If no Ghostex session is bound:
     - Ghostex creates a sibling `kind: "t3"` row first.
     - Ghostex binds that new row to the T3 thread.
     - Ghostex focuses the new row.
   - The original embedded view must redirect back to its bound thread so one Ghostex session never silently becomes another session.

8. Collapse T3 sidebar, but keep it accessible.

   - Embedded Ghostex T3 launches should start with T3's sidebar collapsed.
   - A visible button/rail must remain available to expand it.
   - Expanded T3 sidebar should allow:
     - T3 Code settings access.
     - Any required upstream account/provider/settings UI.
     - Emergency direct T3 navigation if needed.
   - Collapsing T3 sidebar should not affect Ghostex session identity.
   - Ghostex should remain the normal place users switch between sessions.

9. Cleanup unused Ghostex-created T3 temp sessions every 15 minutes.

   Add a periodic cleanup job.

   - Interval:
     - Run every 15 minutes while the T3 runtime is available.
     - Also run once shortly after Ghostex/T3 runtime startup.

   - Candidate sessions:
     - Created by Ghostex embedded flow.
     - Have `ghostexProjectId` and `ghostexSessionId`.
     - Still empty.
     - Not focused/visible/running.
     - Older than a small grace period, for example 15 minutes from creation.

   - Empty means:
     - No user messages.
     - No assistant messages.
     - No active turn/session.
     - No pending approval/user input.
     - No attachments or draft prompt content worth preserving.

   - Cleanup action:
     - Delete the empty T3 draft/thread/project-thread record from T3 Code first.
     - Then delete/remove the associated Ghostex gxserver `kind: "t3"` session.
     - If T3 deletion fails, do not delete the Ghostex session yet.
     - If Ghostex deletion fails after T3 deletion, mark the row for retry instead of recreating a T3 thread.

   - Safety:
     - Never delete non-Ghostex-created T3 threads.
     - Never delete a thread with any user-authored message, assistant response, attachment, active turn, approval, or typed draft.
     - Never delete the currently focused Ghostex T3 session.
     - Do not log thread titles, prompt text, project names, paths, URLs, or raw API responses.

10. Migrate existing rows deliberately.

   Existing T3 rows with `boundThreadId`, `threadId`, or `pending-*` metadata should normalize once on read/update:

   - If a real T3 thread id is present, bind the row to it.
   - If only a placeholder exists, derive `ghostex-thread-<sessionId>`.
   - Preserve any existing title if it is already user-visible and better than `T3 Code`.
   - Do not create additional Ghostex rows during migration.

## Verification Checklist

- Create from Ghostex project header.
  - Click `Create T3code agent session`.
  - A Ghostex sidebar row appears.
  - T3 opens directly to a usable composer.
  - T3's own sidebar starts collapsed.
  - A visible expand button/rail can reopen T3's sidebar.

- First message.
  - Type the first message.
  - The same Ghostex row remains selected.
  - The row title updates to the real T3 thread title.
  - The row shows `working` while T3 is running.
  - The row returns to `idle` when T3 settles.

- Attention state.
  - Trigger a T3 approval/user-input/auth-needed state.
  - Ghostex sidebar shows attention on the matching row.
  - Clearing the T3 prompt/approval clears the Ghostex attention state.

- Restore.
  - Restart Ghostex.
  - Click the same T3 sidebar row.
  - It restores the same T3 draft/thread.
  - T3's sidebar is collapsed but expandable.

- Multiple sessions.
  - Create two T3 sessions in the same Ghostex project.
  - Each Ghostex row opens a distinct T3 thread.
  - Navigating inside T3 to the other thread focuses or creates the correct Ghostex row instead of mutating the current row.

- Cleanup.
  - Create an empty Ghostex T3 session and leave it unused past the cleanup grace period.
  - The 15-minute cleanup deletes the T3 empty thread/draft first.
  - Then it removes the associated Ghostex sidebar session.
  - A non-empty T3 session is not deleted.
  - A focused/visible T3 session is not deleted.

- Upstream rebase.
  - Most conflicts should stay inside `apps/web/src/ghostex/`.
  - Expected hook conflicts should be limited to:
    - `routes/_chat.draft.$draftId.tsx`
    - `components/AppSidebarLayout.tsx`
    - `components/ChatView.tsx`

## Non-Goals

- Do not fully remove T3 Code's sidebar or settings access.
- Do not add a second hidden T3 session list in Ghostex.
- Do not reconcile by guessing from T3 titles, project names, paths, or recent thread order.
- Do not let renderer-provided URLs or paths become trusted state.
- Do not create fallback Ghostex sessions when T3 metadata is missing.
- Do not fall back to T3's empty index shell when Ghostex metadata is invalid; show a clear unavailable state instead.
