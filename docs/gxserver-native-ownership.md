# gxserver and Native Sidebar Ownership

> **Status note (2026-07-29).** Where this document says "the macOS app", read it
> as "the active desktop client". The macOS Swift/AppKit app (`native/`, `src/`)
> is deprecated: it is kept in-tree for reference but is not a development
> target. The active Ghostex apps are the gpui desktop app (`gpui/`), the web app
> (`ghostex-web/`), and the React Native/Expo mobile app (`mobile/`). The
> ownership boundaries below still describe the intended gxserver/client split —
> apply them to `gpui/`, not to the Swift app. Note also that the server is now
> the Rust `gxserver-rs/` implementation.

<!--
CDXC:ProjectSidebarOwnership 2026-06-02-13:16:
The gxserver/native split needs one concrete markdown source of truth before cleanup review continues. This document records which layer owns projects, worktrees, sessions, sidebar layout, tabs, panes, modals, local-first behavior, and shared helpers so stale pre-split code can be removed instead of patched around.
-->

## Purpose

This document defines the ownership boundary between gxserver, the macOS app, sidebar React components, AppKit/native host code, tabs/panes logic, modal/form state, and shared helpers.

Use it as the review checklist when deciding where code belongs.

## Ground Rules

- gxserver owns shared canonical state and complete notifications about that state.
- The macOS app owns current-window presentation, layout, focus, and transient interaction state.
- Sidebar React components own rendering and component-level interaction wiring from supplied props.
- AppKit/native host code owns native surfaces, OS focus, WebViews, terminal embedding, and local pane commands.
- Shared code owns protocol contracts and pure deterministic helpers only.
- No responsibility should have two durable owners.

## gxserver Owns

- Canonical project inventory: project ids, names/titles, normalized paths, favorite/pinned metadata, timestamps, and durable project records.
- Canonical worktree inventory: detecting whether an added folder is an existing worktree, parent/child relationships, branch/name metadata, and worktree registration/creation/removal results.
- Canonical session inventory: session ids, project/worktree association, lifecycle, provider/runtime metadata, shared activity/attention, shared title/provenance, agent metadata, and previous-session metadata.
- Shared sidebar presentation: project rows, worktree nesting metadata, session rows, session groups, group membership, empty-project visibility, project removal, and presentation snapshots/deltas.
- Notification completeness: websocket snapshots/deltas must publish enough state for the macOS app to render added/removed/updated projects and sessions without native refetch fallbacks.
- Shared backend operations: Git, worktree, Beads, clone, launch/resume, sleep/wake/close/remove, shared search, and previous-session results when those operations affect shared state.
- Backend invariants: stable ids, path normalization, duplicate path handling, worktree parent detection, project/session consistency, and canonical persistence.
- Shared session tab semantics: when a visible tab represents a shared terminal/agent/command session, gxserver owns the backing session record and shared close/sleep/wake/remove mutation.
- Durable mutation results. Any action that changes the shared project/session/worktree graph should return or publish canonical state through gxserver.

gxserver must not own local selected tab, selected pane, pane geometry, split layout, command-panel placement, titlebar chrome, modal drafts, first-prompt/image drafts, local focus, or local sidebar disclosure state.

## macOS Native Sidebar Adapter Owns

- Adapting gxserver presentation/domain state into the current macOS window's React sidebar state.
- Local selection and focus: active project, active session, active sidebar row, active pane, active tab, pending focus requests, and keyboard/navigation focus.
- Local-first overlays: immediate hide/show/insert state for clicked project/session/worktree actions while gxserver snapshots/deltas catch up.
- Local-only rows and panes: Quick browser panes, loose files, editor panes, T3 panes, and other surfaces that do not have gxserver session records.
- Calling gxserver mutation APIs for shared actions and reconciling returned/delta state into gxserver-shaped local presentation cache.
- Current-window sidebar UI state: filters, local search text, expanded/collapsed sections, transient visibility, hover/context-menu state, and recents display when it is not shared.
- Temporary pending UI state while waiting for gxserver, as long as it does not become the canonical project/session source.
- Rendering from gxserver state and sending user commands to gxserver mutation APIs.

The adapter must not keep a durable canonical project/worktree/session inventory, duplicate worktree parent detection, or persist shared session metadata independently from gxserver.

## Sidebar React Components and Styles Own

- Sidebar visual layout: project sections, worktree nesting display, session cards/rows, headers, icons, menus, empty states, drag handles, search UI, recent-project drawer UI, and CSS.
- Component-level interaction wiring: clicks, context menus, hover affordances, drag/drop gestures, disclosure toggles, and visual state derived from adapter props.
- Rendering local-first state and gxserver presentation state passed through the native sidebar adapter.
- Deterministic visual grouping only when it is pure rendering from supplied state.

Sidebar components must not call Git, Beads, GitHub, filesystem, zmx, gxserver persistence, or backend mutation APIs directly.

## Native Host and AppKit Bridge Own

- Native window surfaces, split views, tab views, WebViews, Ghostty terminal embedding, browser/editor embedding, and OS-level focus.
- Local pane commands: create, attach, focus, reorder, hide, restore, split, merge, rotate, and close visual pane surfaces when those commands are presentation-only.
- Local pane restoration/materialization decisions for already-known sessions and local-only panes.
- Native terminal and browser surface lifecycle after gxserver has provided shared session identity or attach metadata.

Native host/AppKit code must not independently decide canonical project/worktree identity or persist shared project/session/worktree records.

## Tabs and Panes

- gxserver owns the shared session behind a terminal, agent, or command tab: id, project id, title/provenance, lifecycle, activity, surface, provider metadata, and shared session mutations.
- macOS owns the visible tab instance: containing pane, local order, selected state, focus state, hidden/visible placement, split geometry, and tab chrome.
- macOS owns pane trees: split direction, pane ratios, visible pane count, tab groups, active tab per tab group, focus mode, drag/drop between panes, merge/split/rotate actions, and tab context menus.
- gxserver owns close/sleep/wake/remove when those actions mutate the shared session.
- macOS owns hide/show/reorder/merge/split when those actions only change local presentation of already-owned sessions.
- Sleeping/hidden tabs may remain in the macOS pane/tab tree to preserve placement, but their shared lifecycle/session record remains gxserver-owned.

## Command Panel

- gxserver owns command terminal session identity and shared command-session metadata.
- macOS owns command-panel open/closed state, command-panel split placement, active command tab, command-tab order, command-panel focus, and command draft input.
- Command-panel tabs follow the same split as workspace tabs: gxserver owns the backing command terminal session; macOS owns where and how that tab is shown in the current window.
- gxserver owns any shared command execution/session row after the command terminal is created.

## Modals, Forms, and Pickers

- macOS owns modal visibility, loading/progress state, selected rows, validation messages, confirmation state, toast/display state, and draft form values before submission.
- macOS owns add-project, new-worktree, open-existing-worktree, clone, command palette, previous-sessions modal display, and picker UI.
- macOS owns selected agent, first prompt, image attachments, selected existing worktree row, clone URL draft, branch/name draft, toggles, and validation until the user submits.
- gxserver owns the submitted mutation and the canonical project/session/worktree state returned or published by that mutation.
- Open Existing worktree mode may submit only the selected worktree path when the first prompt is blank. If the shared modal submits a non-blank prompt, it must also submit the visible selected agent so the receiver starts that real agent session instead of inventing defaults.

## Projects and Worktrees

- gxserver owns adding a folder, recognizing it as an existing worktree, attaching it under the parent project, and publishing the updated presentation.
- gxserver owns listing existing worktrees on disk for the Open Existing picker.
- gxserver owns create/remove/switch worktree operations and the project rows produced by those operations.
- macOS owns the picker UI, loading/progress/error state, selected row, and whether lower create-agent/first-prompt controls are shown for the selected mode.
- macOS can apply a returned gxserver project into the gxserver-shaped presentation cache immediately for local-first UX, then reconcile on the websocket delta.
- macOS must not keep native-only fake project rows as the durable project inventory.

## Sidebar Layout

- gxserver owns the data model needed to render shared inventory: projects, presentation groups, sessions, worktree parent metadata, group session ids, titles, activity, and lifecycle.
- gxserver owns project/session presentation snapshots and deltas, including empty projects, project removals, session additions/removals, group changes, and worktree metadata.
- macOS owns the visible sidebar tree: active group, collapsed sections, reference-sidebar layout, group header controls, drag/drop gestures, context menus, visual ordering that is explicitly local, and row selection.
- macOS owns local search/filter text and in-memory search result display.
- gxserver owns previous-session/history search results when rows come from shared session metadata.
- A project added through gxserver must become visible through a presentation snapshot/delta, not through native-only project list mutation.

## Browser, Editor, and Code Panes

- macOS owns browser/editor pane embedding, AppKit/WebKit/code-server surface setup, tab chrome, focus, and placement.
- gxserver owns shared project/session records only when a browser/editor/code pane is represented as shared project session inventory.
- macOS owns local browser navigation chrome, selected browser/editor pane, and pane-level controls unless an explicit gxserver API is introduced for shared browser/editor state.
- Browser chats, Quick browser tabs, Quick file rows, editor panes, T3 panes, and loose files are local macOS pane/sidebar rows unless gxserver has a specific shared session record for them.

## Terminal and Agent Sessions

- gxserver owns session creation and durable identity.
- gxserver owns project association and lifecycle state.
- gxserver owns zmx names, provider metadata, shared title projection, agent metadata, and shared activity/attention state.
- macOS owns embedding and display of the terminal or agent pane.
- macOS owns local input focus, scroll/focus restoration, pane chrome, delayed-send overlays, countdown badges, and transient pane controls.
- Prompt and image picker state belong to macOS until submitted.
- Once a prompt or image payload is submitted and attached to a created agent/session, the resulting session metadata belongs to gxserver.

## Local-First Behavior

- macOS may optimistically hide a closed/removed project or session row so the clicked row disappears immediately.
- macOS may optimistically insert a gxserver-returned project into the gxserver presentation cache so an added project appears before the websocket echo.
- Local suppression wins over stale presentation until gxserver publishes matching absence/removal.
- Optimistic state must be shaped like gxserver presentation/domain state and reconciled by websocket snapshots/deltas.
- Optimistic state must not become a second durable source of truth.
- Missing presentation data is a gxserver bug to fix, not a native refetch/fallback opportunity.

## Shared Code Owns

- Protocol contracts shared by gxserver and native clients.
- Typed operation shapes shared across process boundaries.
- Pure deterministic helpers for sorting, grouping, id comparison, and shape conversion when both sides need the exact same behavior.
- Pure worktree-under-parent ordering that consumes gxserver-provided worktree metadata.

Shared code owns no persistence, network listeners, UI state, native window state, server mutations, or side effects.

## Ordering

- Shared deterministic ordering helpers can live in shared code.
- gxserver owns canonical sort fields when order must sync across clients or windows.
- macOS owns local drag/drop order or display order when it is per-window or per-machine.
- Worktree-under-parent ordering should be pure shared logic that consumes gxserver-provided worktree metadata.

## No Dual Ownership

These responsibilities must have exactly one durable owner:

- Project inventory.
- Worktree parent detection.
- Project add/remove visibility.
- Shared session identity.
- Shared session lifecycle.
- Previous-session rows backed by shared sessions.
- Search results backed by shared sessions.
- Shared title/provenance metadata.
- The session record represented by a shared tab.
- gxserver presentation group membership.
- Native pane/tab layout.
- Command-panel placement and active command tab.
- Modal draft state.
- Local focus and selected tab.

## Cleanup Checklist

Remove or move code that still does any of the following:

- Native-only fake project rows that try to be canonical.
- Native worktree detection that duplicates gxserver canonical detection, except for non-authoritative UI previews before submission.
- Native project/worktree/session persistence in shared storage.
- Refetches used to compensate for incomplete gxserver deltas.
- Two different sources of truth for project visibility.
- Separate worktree-parent resolution paths with different behavior.
- Project creation flows that update local project lists independently from gxserver presentation.
- Presentation deltas that omit metadata required to render the correct sidebar structure.
- Server code that owns local window geometry, local tab selection, pane focus, modal state, or draft form inputs.
- Native terminal/session creation that creates durable sidebar rows without gxserver session identity.
- Native close/sleep/wake/remove flows that mutate shared session state only locally.
- Command-panel terminal rows that use local timestamp ids when they should use gxserver session ids.
- Worktree add/open flows that show create-agent/first-prompt/image UI in existing-worktree selection mode.
- Native project or session caches that are not either local UI caches or gxserver-shaped presentation/domain caches.

## Primary Code Areas

- gxserver protocol and API contracts: `gxserver/protocol/index.ts`.
- gxserver canonical persistence: `gxserver/src/domain-state.ts`.
- gxserver HTTP/websocket mutation and presentation notification flow: `gxserver/src/server.ts`.
- gxserver presentation projection: `gxserver/src/session-presentation/`.
- gxserver typed Git/worktree/Beads operations: `gxserver/src/typed-operations.ts` and related operation handlers.
- Native gxserver RPC client: `native/sidebar/gxserver-client.ts`.
- Native sidebar, modals, local-first cache application, tabs, panes, command panel, and AppKit bridge commands: `native/sidebar/native-sidebar.tsx`.
- Shared pure ordering/grouping helpers: `shared/`.
- Sidebar visual components and styles: `sidebar/`.
