# gxserver and macOS Responsibility Map

<!--
CDXC:ProjectSidebarOwnership 2026-06-02-13:41:
The gxserver/native split needs a concise review map in addition to the full ownership checklist. This document records exactly what each layer owns, including tabs, panes, modals, project/worktree flows, local-first sidebar behavior, and the code that should be removed after the split.

CDXC:ProjectSidebarOwnership 2026-06-02-13:53:
The review map must cover every ownership bucket involved in the sidebar split, not only projects/worktrees. Tabs, panes, workspace layout, project board actions, Git flows, previous sessions, search, recents, settings, persistence, and gxserver notifications all need explicit owners so stale pre-split native code can be identified and removed.

CDXC:ProjectSidebarOwnership 2026-06-02-17:30:
The ownership map needs to be the markdown handoff for review, so it must also name browser/editor/code panes, terminal/agent sessions, ordering, no-dual-ownership invariants, and the primary code areas that should be audited.

CDXC:ProjectSidebarOwnership 2026-06-02-20:04:

CDXC:ProjectSidebarOwnership 2026-06-02-15:10:
The ownership handoff needs an at-a-glance bullet list in addition to the full audit map. Reviewers should be able to see the exact owners for gxserver, macOS current-window state, sidebar React, AppKit/native host, tabs, panes, modals, shared code, notifications, and cleanup before reading the detailed sections.
-->

## Purpose

Use this as the quick source of truth when reviewing whether code belongs in gxserver, the macOS app, sidebar React, AppKit/native host code, or shared helpers.

The rule is: shared durable state has one owner, and current-window UI state has one owner.

## At-a-glance Ownership

- gxserver owns canonical shared state: project inventory, worktree identity/parent detection, shared session records, project/session/worktree lifecycle, Git/worktree/Beads/clone mutations, previous-session records, shared search results, durable backend configuration, persistence, protocol mutation results, and complete presentation snapshots/deltas.
- macOS app and native sidebar adapter own current-window state: selected project/session/row, active tab and pane, focus, titlebar/dock/modal visibility, command-panel placement, local search/filter text, picker drafts, local-first optimistic overlays, and reconciliation of gxserver snapshots/deltas into renderable sidebar state.
- Sidebar React components own visuals and component interactions: sidebar tree layout, project sections, worktree nesting display, session rows/cards, menus, icons, drag handles, empty states, modal/picker rendering, hover/context menu affordances, disclosure toggles, CSS, accessibility, and callbacks supplied by the adapter.
- Tabs and panes are split by backing state versus placement: gxserver owns the shared terminal/agent/command session behind a tab and shared close/sleep/wake/remove mutations; macOS owns the visible tab instance, selected tab, tab order, pane tree, split ratios, merge/split/rotate behavior, hidden/visible placement, and tab chrome.
- Command panel follows the tab rule: gxserver owns command terminal session identity and shared metadata once created; macOS owns panel open state, placement, active command tab, tab order, focus, command draft input, and picker UI.
- Modals, forms, and pickers are macOS-owned until submit: visibility, selected rows, validation, loading/error state, agent selection, first prompt, image attachments, existing-worktree selection, clone drafts, and confirmation UI. gxserver owns the submitted mutation and canonical state it returns or publishes.
- Projects and worktrees are gxserver-owned after selection: adding a folder, recognizing an existing worktree, attaching it under the parent project, listing existing worktrees for the picker, creating/removing/switching worktrees, and publishing the sidebar presentation that makes the result visible.
- Browser, editor, Quick, T3, loose-file, and other local-only panes are macOS-owned unless gxserver introduces an explicit shared session record for that surface.
- Shared code owns contracts and pure helpers only: protocol types, typed operation shapes, deterministic sorting/grouping/id comparison/shape conversion, and worktree-under-parent ordering from gxserver-provided metadata.
- Notifications are gxserver-owned and reconciliation is macOS-owned: gxserver must publish enough snapshot/delta state to render added, removed, and updated projects/worktrees/sessions; macOS applies that state and clears local-first optimistic overlays. Native refetches must not compensate for incomplete deltas.
- Cleanup should remove old dual ownership: native canonical project/session/worktree inventories, duplicate worktree detection, native shared project/session persistence, fake durable rows, local timestamp ids for shared command sessions, refetch fallbacks for missing deltas, direct native Git/Beads/worktree mutations, and existing-worktree UI that shows create-agent/first-prompt/image controls.

## gxserver Owns

- Canonical project records: ids, names, paths, timestamps, favorite/pinned metadata, and durable inventory.
- Canonical worktree records: parent project detection, branch/name metadata, worktree relationships, registration, creation, removal, and switch results.
- Canonical shared session records: ids, project/worktree association, lifecycle, provider/runtime metadata, activity, attention, titles, provenance, agent metadata, and previous-session metadata.
- Shared sidebar presentation: project rows, worktree nesting, session rows, groups, empty-project visibility, project removal, and snapshots/deltas.
- Complete notifications: websocket snapshots/deltas must include enough state for the macOS app to show added, removed, and updated projects/worktrees/sessions without native refetch fallbacks.
- Backend mutations that affect shared state: Git, worktree, Beads, clone, launch/resume, sleep/wake/close/remove, shared search, and previous-session lookups.
- Backend invariants: stable ids, path normalization, duplicate path handling, worktree parent detection, project/session consistency, and canonical persistence.
- The backing session behind any shared terminal, agent, or command tab.
- Mutation return values and published state after shared project/session/worktree changes.
- Canonical project-board/Beads actions and results when the board is attached to a project/worktree.
- Canonical Git status, changed-files, commit, branch, clone, worktree, and repository-root operations.
- Shared previous-session/history rows and shared search results backed by gxserver session metadata.
- Durable agent/action/provider configuration that should be consistent across windows or launches.
- Durable project/session/worktree persistence and schema migrations for shared records.

gxserver must not own selected tab, selected pane, pane geometry, split layout, titlebar chrome, modal drafts, first-prompt/image drafts, current-window focus, local sidebar disclosure state, or command-panel placement.

## macOS Native Sidebar Adapter Owns

- Adapting gxserver presentation/domain state into the current macOS window's React sidebar state.
- Current-window selection and focus: active project, active session, active sidebar row, active pane, active tab, pending focus requests, and keyboard/navigation focus.
- Local-first overlays: immediate hide/show/insert state for clicked project/session/worktree actions while gxserver catches up.
- Local-only rows and panes: Quick browser panes, loose files, editor panes, T3 panes, and other surfaces without gxserver session records.
- Calling gxserver mutation APIs for shared actions and reconciling returned state or websocket deltas into gxserver-shaped local presentation cache.
- Current-window sidebar UI state: filters, local search text, expanded/collapsed sections, transient visibility, hover/context-menu state, and recents display when it is not shared.
- Temporary pending UI while waiting for gxserver, as long as it does not become the durable project/session source.
- Local process bridge routing for native-only integrations and for forwarding user commands to gxserver APIs.

The adapter must not keep a canonical project/worktree/session inventory, duplicate worktree parent detection, or persist shared session metadata independently from gxserver.

## macOS App Owns

- Current-window routing of user intent: when a click, keyboard shortcut, titlebar action, dock action, context menu item, or modal submit should call gxserver versus a native-only pane command.
- Local materialization of gxserver-backed sessions into AppKit/WebView/Ghostty surfaces after gxserver provides shared identity and attach metadata.
- Local-first reconciliation overlays that make user actions visible immediately while preserving gxserver as the shared source of truth.
- Local-only presentation for panes that gxserver does not own: Quick browser tabs, loose-file editor rows, browser chats, T3 panes, and native setup/probe surfaces.
- Native app lifecycle, startup/shutdown ordering, gxserver daemon startup/reuse, bridge port selection, and current-window recovery UI when gxserver is unavailable.

The macOS app must not create durable shared project/session/worktree rows without gxserver identity, and it must not repair missing gxserver presentation by rebuilding the old native tree.

## Sidebar React Components Own

- Visual layout: project sections, worktree nesting, session rows/cards, headers, icons, menus, empty states, drag handles, search UI, recent-project drawer UI, and CSS.
- Component-level interaction wiring: clicks, context menus, hover affordances, drag/drop gestures, disclosure toggles, and visual state derived from props.
- Rendering local-first state and gxserver presentation state passed through the native sidebar adapter.
- Pure visual grouping when it is deterministic rendering from supplied state.
- Display-only board, Git, changed-file, previous-session, command, settings, and picker components from supplied data and callbacks.
- Accessibility, keyboard affordances, tooltips, visual loading states, and modal layout.

Sidebar React components must not call Git, Beads, GitHub, filesystem, zmx, gxserver persistence, or backend mutation APIs directly.

## Native Host and AppKit Bridge Own

- Native window surfaces, split views, tab views, WebViews, Ghostty terminal embedding, browser/editor embedding, and OS-level focus.
- Local pane commands: create, attach, focus, reorder, hide, restore, split, merge, rotate, and close visual pane surfaces when those commands are presentation-only.
- Native terminal and browser surface lifecycle after gxserver has provided shared session identity or attach metadata.
- Local pane restoration/materialization decisions for already-known sessions and local-only panes.
- Local WebView-to-AppKit bridges for sidebar commands, modal display, titlebar commands, and native surface commands.
- Native support bundle, app lifecycle, and OS window behavior that is not shared project/session state.

Native host/AppKit code must not independently decide canonical project/worktree identity or persist shared project/session/worktree records.

## Titlebar, Workspace Dock, and App Chrome

- macOS may merge native-only Quick/browser/editor/file rows into titlebar or dock surfaces only when those rows have no gxserver shared session record.
- Titlebar actions that mutate shared lifecycle, such as sleep/wake/close/remove, must call gxserver-owned lifecycle paths and then apply local-first presentation cache updates.
- Titlebar actions that only change window chrome, pane focus, local visibility, or tab selection remain macOS-owned.

## Agent Manager, X-Bridge, and gx Commands

- gxserver owns shared agent session identity, provider metadata, lifecycle, activity, title projection, project association, and any shared operation results.
- macOS owns Agent Manager window/modal display, selected row, focus/close button wiring, and materializing a selected gxserver presentation row into the current window.
- Agent Manager should list shared sessions from gxserver presentation when available, while preserving native-only Quick/chat panes that gxserver does not own.
- The X-bridge command handlers in the macOS app own command routing and current-window effects, not shared inventory.
- `gx listSessions`, `gx state`, and similar current-app commands should report gxserver presentation-backed shared rows when gxserver presentation exists, then include native-only panes only for explicitly local surfaces.
- CLI/state command output must not treat native stored projects as the canonical project/session source after gxserver presentation has initialized.

## Tabs and Panes

- gxserver owns the shared session behind terminal, agent, and command tabs: id, project id, title/provenance, lifecycle, activity, surface, provider metadata, and shared mutations.
- macOS owns the visible tab instance: containing pane, local order, selected state, focus state, hidden/visible placement, split geometry, and tab chrome.
- macOS owns pane trees: split direction, pane ratios, visible pane count, tab groups, active tab per group, focus mode, drag/drop between panes, merge/split/rotate actions, and tab context menus.
- gxserver owns close, sleep, wake, and remove when those actions mutate the shared session.
- macOS owns hide, show, reorder, merge, split, and rotate when those actions only change local presentation of already-owned sessions.
- Sleeping or hidden tabs may stay in the macOS pane/tab tree to preserve placement, but their shared lifecycle/session record remains gxserver-owned.

## Command Panel

- gxserver owns command terminal session identity and shared command-session metadata.
- macOS owns command-panel open/closed state, split placement, active command tab, command-tab order, focus, and command draft input.
- Command-panel tabs follow the same ownership rule as workspace tabs: gxserver owns the backing command terminal session; macOS owns where and how the tab is shown.
- gxserver owns command terminal lifecycle mutations after a command terminal becomes a shared session.
- macOS owns command palette UI, command picker filtering, temporary command run feedback, and local command draft state.
- Command-panel rows must use gxserver session ids once the command terminal is shared; timestamp/local-only ids are allowed only for truly local transient UI that cannot be referenced as a shared session.

## Project Board and Beads

- gxserver owns Beads command execution, project-board data loading, mutation results, action status, and any durable board state tied to a project/worktree.
- macOS owns opening/closing the board UI, selected board view, local loading/error display, row expansion, and forwarding board actions to gxserver.
- Sidebar React owns board visuals, row rendering, action buttons, filters, empty states, and component interaction wiring from supplied callbacks.
- Native code must not construct or run `bd` commands directly for shared project-board actions.

## Git, Clone, and Changed Files

- gxserver owns repository-root detection, Git status/diff/branch data, clone preview/jobs/cancel, commit mutations, and worktree Git operations.
- macOS owns Git modal visibility, selected files, draft commit message, selected clone URL/path/branch fields, loading/error display, and local-first progress UI.
- Sidebar React owns changed-file tree rendering, Git action rows, clone/add repository modal layout, and picker interactions from supplied props.
- Shared helpers may parse or sort Git-shaped data only when they are pure and deterministic.

## Modals, Forms, and Pickers

- macOS owns modal visibility, loading/progress state, selected rows, validation messages, confirmation state, toast/display state, and draft form values before submission.
- macOS owns add-project, new-worktree, open-existing-worktree, clone, command palette, previous-sessions modal display, and picker UI.
- macOS owns selected agent, first prompt, image attachments, selected existing worktree row, clone URL draft, branch/name draft, toggles, and validation until submit.
- gxserver owns the submitted mutation and the canonical project/session/worktree state returned or published by that mutation.
- Open Existing worktree mode may submit only the selected worktree path when the first prompt is blank. If the shared modal submits a non-blank prompt, it must also submit the visible selected agent so the receiver starts that real agent session instead of inventing defaults.
- Settings/configuration modals follow the same rule: macOS owns drafts and visible validation before save; gxserver owns durable configuration when it must be shared across windows, app launches, or sessions.

## Projects and Worktrees

- gxserver owns adding a folder, recognizing it as an existing worktree, attaching it under the parent project, and publishing the updated presentation.
- gxserver owns listing existing worktrees on disk for the Open Existing picker.
- gxserver owns create, remove, and switch worktree operations and the project rows produced by those operations.
- macOS owns picker UI, loading/progress/error state, selected row, and whether lower create-agent/first-prompt controls are visible for the selected mode.
- macOS may apply a gxserver-returned project into the gxserver-shaped presentation cache immediately for local-first UX, then reconcile on the websocket delta.
- macOS must not keep native-only fake project rows as durable project inventory.

## Project Resource Actions

- gxserver owns shared project lifecycle mutations: close project, remove project, sleep project sessions, wake shared sleeping sessions, and remove/sleep/wake individual shared sessions.
- macOS owns the visible project action menu, confirmation UI, context-menu closure, selected/focused row after the action, and local-first suppression or insertion of gxserver-shaped presentation rows.
- Project sleep/wake/reload actions should enumerate shared workspace rows from gxserver presentation when available.
- Command-panel sessions involved in project sleep/wake/reload remain macOS-placed tabs, but their shared terminal lifecycle belongs to gxserver once they have gxserver session identity.
- Full reload can only be executed by macOS for materialized native terminal surfaces; gxserver still owns the backing shared session metadata and lifecycle state.
- Missing local materialization is not permission to synthesize a native canonical row. It should be treated as "not currently reloadable in this window" unless the action is wake/focus and materialization is the correct local effect.

## Status Indicators, Pet Overlay, and Auto-Sleep

- gxserver owns shared activity, attention, lifecycle, and title/provenance fields that drive status indicators for shared terminal/agent rows.
- macOS owns how those indicators render, when transient local badges appear, and which native/local-only panes participate in window-only overlays.
- Pet overlay candidates, status summaries, and titlebar sleep-inactive actions should use gxserver presentation for shared sessions when available.
- Auto-sleep may use macOS-local timers and window activity signals, but shared terminal lifecycle transitions must go through gxserver-owned sleep paths.
- Browser, Quick file, T3, and other local panes remain native-owned for overlay and idle behavior unless gxserver adds explicit shared records for them.

## Sidebar Layout

- gxserver owns the shared data model: projects, presentation groups, sessions, worktree parent metadata, group session ids, titles, activity, lifecycle, and snapshots/deltas.
- macOS owns the visible sidebar tree: active group, collapsed sections, reference-sidebar layout, group header controls, drag/drop gestures, context menus, local ordering, and row selection.
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

## Previous Sessions, Search, and Recents

- gxserver owns previous-session rows backed by shared sessions, including durable history metadata and shared search results.
- gxserver owns shared session/project search when results come from canonical project/session/worktree records.
- macOS owns the search box value, modal visibility, selected row, in-memory result display, and focus behavior.
- macOS may own local recents only as a parking/launcher overlay for this machine, not as canonical project inventory.
- Native previous-session storage must not resurrect shared sessions that gxserver no longer publishes.

## Runtime Setup, Probes, and External Tools

- gxserver owns backend checks and typed operations when they affect shared projects, worktrees, Git, Beads, clone jobs, or shared session lifecycle.
- macOS owns local environment probes required to render or host this window, such as WebView/Ghostty setup, file picker display, OS open actions, native support-bundle collection UI, and browser/editor pane setup.
- Native process execution is allowed for local OS/app hosting concerns, but not for duplicate shared Git/worktree/Beads/project-board mutations that gxserver owns.
- Any retained native post-create setup command must consume gxserver-owned configuration/results and must not become a parallel worktree creation or detection path.

## Settings, Agents, Actions, and Prompts

- gxserver owns durable provider/agent/action configuration that should be shared across windows or survive as backend state.
- macOS owns configuration modal drafts, local validation, selected agent for a pending launch, first-prompt text, image attachment drafts, and pending prompt UI.
- Sidebar React owns settings/action/agent modal layout and component interactions from supplied props.
- Shared prompt/title helpers may stay in shared code only when pure and deterministic.

## Persistence and Caches

- gxserver owns durable persistence for shared projects, worktrees, sessions, lifecycle, previous-session metadata, and presentation records.
- macOS owns current-window UI persistence such as layout, local pane placement, local sidebar disclosure, local-only panes, and local recents.
- Native gxserver presentation caches must be gxserver-shaped and treated as render/cache state, not as a second source of truth.
- Shared code must not read or write browser storage, native storage, files, or gxserver state.

## Notifications and Reconciliation

- gxserver owns websocket snapshot/delta completeness for project, worktree, session, group, lifecycle, title, activity, and removal changes.
- macOS owns applying snapshots/deltas into the current window, reconciling local-first overlays, and clearing optimistic state once gxserver publishes matching state.
- Missing sidebar state after a gxserver mutation is a gxserver notification/presentation bug.
- Native refetches must not be used to hide incomplete gxserver deltas.
- Add-project, add-existing-worktree, create-worktree, remove-project, close-session, sleep, wake, rename, title/activity, group membership, and project-removal mutations must either return enough canonical state for immediate cache insertion or publish a complete presentation delta.
- Refetch is acceptable only as an explicit reconnect/snapshot recovery path after a known missed revision or gxserver restart, not as routine compensation after individual mutations.
- macOS optimistic updates must be gxserver-shaped so websocket snapshots and deltas can reconcile them without a translation-only native source of truth.

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
- Pure deterministic helpers for sorting, grouping, id comparison, shape conversion, and worktree-under-parent ordering.

Shared code must not own persistence, network listeners, UI state, native window state, server mutations, localStorage/sessionStorage, filesystem access, or side effects.

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

## Code To Remove Or Move

- Native-only fake project rows that try to be canonical.
- Native worktree detection that duplicates gxserver canonical detection, except non-authoritative UI previews before submit.
- Native project/worktree/session persistence for shared records.
- Refetches used to compensate for incomplete gxserver deltas.
- Two sources of truth for project visibility.
- Separate worktree-parent resolution paths with different behavior.
- Project creation flows that mutate local project lists independently from gxserver presentation.
- Presentation deltas that omit metadata required to render the correct sidebar structure.
- gxserver code that owns local window geometry, tab selection, pane focus, modal state, or draft form inputs.
- Native terminal/session creation that creates durable sidebar rows without gxserver session identity.
- Native close/sleep/wake/remove flows that mutate shared session state only locally.
- Command-panel terminal rows that use local timestamp ids when they should use gxserver session ids.
- Worktree add/open flows that show create-agent, first-prompt, image, or prompt-helper UI in existing-worktree selection mode.
- Shared helpers that read/write browser storage or call backend/native APIs.
- Native direct `git`, `gh`, `bd`, worktree, or clone execution for shared project operations when a gxserver typed operation exists.
- Native command-panel/shared terminal rows that cannot be reconciled to gxserver session ids.

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
