# T3 Code Session Ownership Plan

## Goal

Make every T3 Code pane shown in the Ghostex sidebar map 1:1 to one durable Ghostex gxserver session.
After this, T3 Code should behave like an embedded renderer/provider for that Ghostex session, so Ghostex can hide T3 Code's own project/thread sidebar without losing session creation, focus, restore, title, or lifecycle behavior.

## Current State Checked

- `gxserver-rs` already persists `kind: "t3"` sessions and the shared presentation projection already renders them as normal sidebar sessions.
- GPUI creates/focuses T3 through id-only sidebar bridge messages and stores T3 provider metadata in `runtimeSettings.t3` / `providerState.t3`.
- The rebased `t3code` checkout has a small Ghostex draft bootstrap patch that opens a usable draft composer from `/draft/:draftId?ghostexDraft=1...`.
- T3 Code still owns its own project/thread sidebar through `apps/web/src/components/AppSidebarLayout.tsx` and `apps/web/src/components/Sidebar.tsx`.
- macOS native sidebar already has older T3 thread-ready/thread-changed handling that preserves one Ghostex card per T3 thread.

## Best Architecture

Ghostex should own the session identity. T3 Code should own only provider state for that session.

Primary identity:

- `ghostexProjectId`
- `ghostexSessionId`

Provider binding:

- `serverOrigin`
- `environmentId`
- `t3ProjectId`
- `t3ThreadId`
- `workspaceRoot`

The durable Ghostex row should be the only sidebar-visible session. T3 thread ids should never create visible app sessions by themselves. If T3 needs a new conversation, it must ask Ghostex to create a new `kind: "t3"` session first.

## Plan

1. Add a shared Ghostex T3 binding contract.

   Put the normalizer/builder in app-owned shared code, for example `shared/t3-session-binding.ts`, and have native, GPUI, and sidebar code use it. The contract should produce one launch descriptor:

   ```text
   ghostexEmbedded=1
   ghostexProjectId=P...
   ghostexSessionId=G...
   ghostexDraft=1
   environmentId=...
   projectId=<t3ProjectId>
   threadId=ghostex-thread-<ghostexSessionId>
   createdAt=...
   hideT3Sidebar=1
   ```

   This avoids each host surface rebuilding slightly different URLs and makes upstream T3 rebases easier.

2. Make Ghostex session creation the only creation path.

   Keep the current order: create the gxserver `kind: "t3"` row first, derive the stable T3 draft/thread id from that Ghostex session id, then open T3 Code. Do this through one host helper per platform:

   - GPUI: factor `gpui_create_local_t3_session`, route URL creation, and focus handling behind a small `T3SessionController`.
   - macOS sidebar: route `createNativeT3Session`, restore, and thread binding through the same shared binding shape.

   Do not let the T3 renderer invent session ids, project paths, URLs, or commands.

3. Add a small T3 embedded adapter inside `t3code`.

   Keep all fork-local T3 edits under a narrow module such as `apps/web/src/ghostex/`:

   - `embeddedLaunch.ts`: reads and validates the Ghostex launch descriptor from the route.
   - `draftBootstrap.ts`: owns the existing draft seeding behavior.
   - `hostEvents.ts`: reports `ready`, `threadChanged`, `titleChanged`, and `turnStateChanged`.
   - `embeddedLayout.ts`: tells the app shell whether to hide T3's sidebar.

   Then touch upstream files only at stable seams:

   - `routes/_chat.draft.$draftId.tsx` to seed the draft before route selection.
   - `components/AppSidebarLayout.tsx` to hide `ThreadSidebar`, `SidebarRail`, and `SidebarControl` when `hideT3Sidebar=1`.
   - `components/ChatView.tsx` only where first-send/new-thread promotion needs to emit host sync.

4. Add one host sync endpoint/path.

   When T3 confirms a thread exists or title changes, Ghostex should update the exact gxserver row by `(ghostexProjectId, ghostexSessionId)`.

   Required validation:

   - The gxserver session must exist and be `kind: "t3"`.
   - The T3 project must resolve to the same workspace root.
   - The incoming thread id must match the current binding or be an explicit host-approved reassignment.
   - The update may change provider metadata, lifecycle, activity, and title only for that one row.

   This should be a real synchronization path, not a fallback that creates hidden rows when metadata is missing.

5. Treat T3 navigation as Ghostex session selection.

   In embedded mode:

   - Opening the bound thread keeps the same Ghostex row.
   - Navigating to another existing T3 thread asks Ghostex to focus the Ghostex session already bound to that thread.
   - If no Ghostex session is bound, Ghostex creates a sibling `kind: "t3"` row first, binds it, and focuses it.
   - The original embedded view is redirected back to its bound thread so one visible Ghostex session never silently changes identity.

6. Hide T3's own sessions only after ownership is complete.

   Once creation, focus, restore, title sync, and thread switch sync all go through Ghostex, enable `hideT3Sidebar=1` for embedded launches. The T3 main chat surface, composer, model picker, approvals, and right panels can remain; only T3's project/thread navigation chrome should disappear.

7. Migrate existing rows deliberately.

   Existing T3 rows with `boundThreadId`, `threadId`, or `pending-*` metadata should be normalized once on read/update:

   - If a real T3 thread id is present, bind the row to it.
   - If only a placeholder exists, derive `ghostex-thread-<sessionId>`.
   - Do not create additional Ghostex rows during migration.

8. Verification checklist.

   - Click `Create T3code agent session` in Ghostex: a Ghostex sidebar row appears and T3 opens directly to a usable composer.
   - Type the first message: the same Ghostex row remains selected and receives the real title/status metadata.
   - Restart Ghostex: clicking the same sidebar row restores the same T3 thread or draft.
   - Create two T3 sessions in the same project: each Ghostex row opens a distinct T3 thread.
   - Hide T3 sidebar: users can still type, approve, interrupt, and continue the session.
   - T3 upstream rebase: all merge conflicts should be limited to the small `apps/web/src/ghostex/` adapter and the few app-shell hook points above.

## Non-Goals

- Do not add a second hidden T3 session list in Ghostex.
- Do not reconcile by guessing from T3 titles, project names, paths, or recent thread order.
- Do not let renderer-provided URLs or paths become authoritative.
- Do not make a fallback route that opens T3's index shell when Ghostex metadata is missing; show a clear unavailable state instead.
