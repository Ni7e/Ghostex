# gxserver/native ownership audit handover

<!--
CDXC:ProjectSidebarOwnership 2026-06-02-21:17:
The ownership split is mostly implemented, but final review still needs a concrete handover checklist. This document records the remaining audit buckets and the intended gxserver/macOS boundary so cleanup can continue without re-litigating ownership on each file.
-->

## Purpose

Use this document as the next-agent handover for finishing the gxserver/native ownership split.

The primary contract remains [gxserver-native-ownership.md](./gxserver-native-ownership.md). This handover explains what still needs to be checked and what belongs on each side of the split.

## Core split

gxserver owns shared durable state:

- canonical project records
- canonical worktree identity and parent detection
- canonical terminal/agent/command session records
- shared session lifecycle, title/provenance, activity, provider metadata, pin/favorite state, and previous-session history
- shared project metadata such as custom agents, custom commands/actions, Git config, project-board config, and identity metadata
- Git, clone, worktree, Beads, project, and shared session mutation APIs
- presentation snapshots/deltas that let clients render shared projects, worktrees, groups, sessions, lifecycle, titles, activity, and removals without native refetch fallbacks

macOS owns current-window state:

- selected project, selected row, active tab, active pane, focus, and titlebar state
- pane trees, tab order, split ratios, command-panel placement, command-panel active tab, and visible panel mode
- modal visibility, draft form state, selected picker rows, loading/error display, validation messages, and toasts
- local-first optimistic overlays shaped like gxserver presentation state
- native AppKit/WebKit/Ghostty surface creation and focus after gxserver provides shared identity
- local-only panes such as Quick browser, loose files, editor/code panes, T3 panes, and browser chats unless gxserver adds explicit shared records for them
- local OS integrations such as Finder/IDE open actions, WebView lifecycle, titlebar chrome, and current-window recovery UI

Shared code owns only contracts and pure helpers. It must not persist state, call gxserver, call native APIs, read/write browser storage, shell out, or own UI/window state.

## Current status

Implemented or mostly aligned:

- gxserver owns project/worktree/session canonical inventory.
- project add/open worktree flows route through gxserver and use gxserver presentation to make rows visible.
- macOS shared storage no longer owns durable shared project/session storage.
- WK project storage is treated as a local pane/layout cache and strips canonical G-session metadata.
- command-panel creation now creates gxserver `surface: "commands"` sessions before macOS inserts tabs.
- sidebar command runs now pass stable action `commandId` to gxserver instead of using visible command titles as canonical command ids.
- command-pane display title updates remain local-first but mirror through gxserver rename ownership.
- existing-worktree mode remains project-open-only when the prompt is blank, and can start the submitted visible agent when the shared modal carries a non-blank prompt.
- gxserver presentation revisions advance for project/session mutations even without connected clients.

Do not treat this as complete until the remaining audit buckets below are checked against current code and verified.

## Remaining audit buckets

### 1. Command-panel lifecycle

Expected ownership:

- gxserver owns command session close, sleep, wake, remove, lifecycle, provider state, activity, title/provenance, and command id.
- macOS owns command-panel visibility, split placement, tab order, active command tab, focus, height, and local command run feedback.

Check:

- command-pane tab close paths call gxserver lifecycle/removal for canonical G sessions and only prune local panel layout as local-first UI.
- command-pane sleep/wake paths update gxserver lifecycle and do not only flip native `isSleeping`.
- native command mappings are in-memory/local placement helpers only; they must not become durable command session records.
- command-panel restart hydration keeps only canonical G ids and local placement, and does not restore stale title/lifecycle/provider metadata from WK storage.

High-risk files:

- `native/sidebar/native-sidebar.tsx`
- `native/sidebar/native-project-local-persistence.ts`
- `gxserver/src/server.ts`
- `gxserver/src/domain-state.ts`


Expected ownership:

- macOS owns titlebar UI, dock placement, active highlight, hover/open state, and focus routing.
- native-only Quick/browser/file/T3 rows may be merged only when they have no gxserver shared session record.

Check:

- titlebar/dock resource lists prefer gxserver presentation for shared rows once presentation is available.
- close/sleep/wake/remove titlebar actions route through gxserver for shared sessions/projects.
- native stored project/session trees are not used as canonical titlebar/dock inventory after gxserver startup.

High-risk files:

- `native/sidebar/titlebar-host.tsx`
- `native/sidebar/native-sidebar.tsx`
- `shared/workspace-project-appearance.ts`

### 3. Agent Manager and gx CLI state

Expected ownership:

- gxserver owns shared agent/session inventory, provider metadata, lifecycle, activity, and title projection.
- macOS owns Agent Manager UI, selected row, focus/close routing, and materializing an existing gxserver row into the current window.
- CLI/state commands should report gxserver presentation-backed shared rows and include native-only panes only as explicitly local surfaces.

Check:

- `gx state`, `gx listSessions`, Agent Manager, and related bridge commands do not treat native stored projects/sessions as canonical after gxserver presentation initializes.
- focus/close actions from these surfaces use gxserver mutation paths for shared sessions.
- native-only panes remain clearly marked local and cannot be mistaken for shared gxserver sessions.

High-risk files:

- `native/sidebar/native-sidebar.tsx`
- `native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift`

### 4. Project board and Beads

Expected ownership:

- gxserver owns Beads command execution, project-board data loading, mutations, and durable board config tied to projects/worktrees.
- macOS owns board UI display, selected view, local loading/error state, row expansion, and forwarding actions to gxserver.
- Sidebar React owns board rendering and callbacks.

Check:

- native/Swift code does not construct or run `bd` commands for shared project-board actions when a gxserver typed operation exists.
- project-board display metadata comes from gxserver projectBoardConfig/gitConfig where shared.
- conversation links and previous-session lookup do not rely on stale native previous-session caches as canonical history.

High-risk files:

- `native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift`
- `native/sidebar/project-board-shared.ts`
- `native/sidebar/tasks-placeholder.tsx`
- `native/sidebar/native-sidebar.tsx`
- `gxserver/src/typed-operations.ts`

### 5. Git, clone, changed files, and worktree operations

Expected ownership:

- gxserver owns repository-root detection, Git status/diff/branch data, clone preview/jobs/cancel, commit mutations, and worktree Git operations.
- macOS owns modal visibility, selected files, draft commit message, draft clone fields, loading/error UI, and local-first progress display.
- native process execution is allowed for OS/app hosting concerns, but not for duplicate shared Git/worktree/clone mutations.

Check:

- native `runNativeProcess` call sites are local OS/app concerns only.
- direct native `git`, `gh`, clone, worktree, or Git status calls have been moved to gxserver typed operations where shared state is involved.
- changed-file rendering receives gxserver-owned data or pure parsed data, not a native-owned Git backend.

High-risk files:

- `native/sidebar/native-sidebar.tsx`
- `native/sidebar/gxserver-client.ts`
- `gxserver/src/typed-operations.ts`
- `shared/sidebar-git.ts`
- `shared/project-diff-stats.ts`

### 6. Previous sessions, search, and recents

Expected ownership:

- gxserver owns previous-session rows backed by shared sessions, durable history metadata, and shared search results.
- macOS owns search input text, modal visibility, selected row, in-memory result display, and focus behavior.
- local recents may be a machine-local launcher overlay, not canonical project/session inventory.

Check:

- previous-session modal requests use gxserver search/history APIs for shared rows.
- native previous-session memory cannot resurrect sessions that gxserver no longer publishes.
- project recents do not become a second durable project inventory.
- delete/restore previous-session actions reconcile through gxserver-owned history/session state.

High-risk files:

- `native/sidebar/native-sidebar.tsx`
- `sidebar/find-previous-session-modal.tsx`
- `shared/session-grid-contract-sidebar.ts`
- `gxserver/src/session-presentation/search.ts`

### 7. Project/worktree ordering

Expected ownership:

- gxserver owns worktree parent detection and canonical worktree metadata.
- macOS currently owns local drag/drop project ordering and worktree-family visual order unless/until shared ordering moves to gxserver.
- shared helpers may implement pure worktree-under-parent ordering from gxserver-provided metadata.

Check:

- native ordering code does not infer canonical worktree parentage from stale local metadata.
- worktree ordering constraints use gxserver-provided worktree metadata.
- adding/opening/removing worktrees is visible through gxserver presentation, not native fake project rows.

High-risk files:

- `native/sidebar/native-sidebar.tsx`
- `shared/`
- `gxserver/src/git-root.ts`
- `gxserver/src/typed-operations.ts`

### 8. Settings, actions, agents, and shared project metadata

Expected ownership:

- gxserver owns durable provider/agent/action/project metadata that should survive across windows or launches.
- macOS owns settings modal drafts, local validation, selected pending agent, first-prompt drafts, image drafts, and editor UI cache.
- native localStorage can be a synchronous render/editor cache only, replaced from gxserver snapshots/deltas.

Check:

- custom agents/actions are replaced from gxserver domain-project state during startup and presentation deltas.
- local writes are optimistic but persist to gxserver and reconcile from gxserver responses/deltas.
- old localStorage values cannot override gxserver project metadata after startup.

High-risk files:

- `native/sidebar/gxserver-project-actions.ts`
- `native/sidebar/native-sidebar.tsx`
- `sidebar/settings-modal.tsx`
- `sidebar/configure-actions-modal.tsx`
- `shared/sidebar-commands.ts`
- `shared/sidebar-agents.ts`

### 9. Browser, editor, T3, and other local-only panes

Expected ownership:

- macOS owns browser/editor/T3 pane embedding, tab chrome, focus, placement, WebKit/code-server/T3 setup, and local pane navigation.
- gxserver owns only explicit shared records if such panes are intentionally represented as shared project/session inventory.

Check:

- local-only browser/file/editor/T3 rows are not written into gxserver shared session inventory accidentally.
- shared terminal/agent rows are not kept alive only through native local pane records.
- titlebar/dock/Agent Manager merge these rows only as local panes, not canonical gxserver rows.

High-risk files:

- `native/sidebar/native-sidebar.tsx`
- `native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift`
- `shared/session-grid-contract-sidebar.ts`

### 10. Shared helpers

Expected ownership:

- shared code owns protocol contracts and pure deterministic helpers only.
- shared code must not own persistence, network listeners, UI state, native window state, server mutations, filesystem access, browser storage, or shell/process execution.

Check:

- helpers under `shared/` do not call gxserver/native APIs or read/write storage.
- moved helpers are actually pure transforms and not hidden side-effect adapters.
- ordering/grouping/id helpers consume gxserver-provided state rather than reconstructing canonical identity.

High-risk files:

- `shared/`
- `gxserver/protocol/index.ts`
- `shared/session-grid-contract-sidebar.ts`

### 11. Persistent storage boundaries

Expected ownership:

- gxserver owns durable shared persistence for projects, worktrees, sessions, lifecycle, title/provenance, previous sessions, presentation records, and shared project metadata.
- macOS owns current-window UI persistence: layout, pane placement, local-only panes, disclosure state, local recents, and modal/editor caches.
- Swift shared storage should not persist shared projects or previous sessions after the cutoff.

Check:

- `GhostexAppStorage.swift` and `HostProtocol.swift` expose only allowed shared keys.
- WK local project snapshots strip canonical P/G metadata at reader and writer boundaries.
- deleted old native gxserver sidebar storage files are not referenced anywhere.
- no startup path rebuilds the shared sidebar tree from native storage when gxserver presentation is available.

High-risk files:

- `native/macos/ghostexHost/Sources/Shared/GhostexAppStorage.swift`
- `native/macos/ghostexHost/Sources/ghostexHost/HostProtocol.swift`
- `native/sidebar/native-project-local-persistence.ts`
- `native/sidebar/native-sidebar.tsx`

### 12. Notification completeness

Expected ownership:

- gxserver owns complete snapshots/deltas for shared project/worktree/session presentation.
- macOS owns applying snapshots/deltas and clearing local-first overlays.
- missing presentation data after a gxserver mutation is a gxserver bug, not a native refetch/fallback opportunity.

Check:

- add project, add existing worktree, create worktree, remove project, create session, close/remove session, sleep/wake session, rename/title change, activity change, pin/favorite, group membership, and project metadata updates return or publish enough state.
- server-side presentation revisions advance even when no clients are connected.
- macOS local-first cache insertion/suppression is gxserver-shaped and reconciles with deltas.
- routine native refetches are not used to compensate for incomplete mutation deltas.

High-risk files:

- `gxserver/src/server.ts`
- `gxserver/src/session-presentation/`
- `gxserver/test/api.test.ts`
- `native/sidebar/gxserver-presentation-cache.ts`
- `native/sidebar/native-sidebar.tsx`

## Suggested audit order

1. Command-panel lifecycle close/sleep/wake.
3. Project board/Beads and Git/clone/worktree native process call sites.
4. Previous sessions/search/recents.
5. Persistent storage and shared helper purity.
6. Notification completeness tests for any mutations touched during cleanup.

This order starts with paths most likely to preserve stale native-owned session trees.

## Verification expectations

For each audited bucket:

- search for old native-owned project/session/worktree reconstruction paths
- inspect current code, not only tests
- remove dead fallback branches rather than adding compatibility fallbacks
- keep local-first UI overlays small and gxserver-shaped
- add focused regression tests when a bug or stale ownership path is found

Recommended recurring checks:

- `npm run typecheck`
- `npm run test -- native/sidebar/native-project-local-persistence.test.ts`
- `npm --prefix gxserver run build`
- `/opt/homebrew/bin/node --test gxserver/dist/test/api.test.js`
- `git diff --check`

Known caveat: the compiled gxserver API test may skip two tests if the configured local test port is already in use.
