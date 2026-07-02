# Terminal Link In-App Browser Handoff

Date: 2026-07-02

## User Requirement

When the user Command-clicks a link in a terminal in the macOS app, Ghostex should open the link inside the Ghostex macOS app instead of handing it to the system browser.

Placement requirement:

- If the user is in the Agents view, open the link in a new Ghostex browser tab/session.
- If the user is in the Browser view, open the link in a Browser-view tab.

The user asked for a handover only. No implementation decision has been made here.

## Ghostex Code Observations

### Terminal Link Entry Point

The current Ghostty terminal URL action is handled in:

- `native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift:1845`

Observed behavior:

- `GHOSTTY_ACTION_OPEN_URL` reads the URL string from Ghostty.
- It resolves the string through `resolvedGhosttyOpenURL`.
- It currently calls `NSWorkspace.shared.open(url)`.
- This sends the URL to the OS default handler instead of creating an in-app browser surface.

Related resolver:

- `native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift:1880`

Observed behavior:

- `resolvedGhosttyOpenURL` trims empty input.
- It preserves support for old Markdown image references from terminal buffers.
- It returns URL values with schemes directly.
- It treats recognized schemeless file paths as file URLs.

### Source Session Context

The native terminal surface stores the Ghostex session id when a terminal is created:

- `native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift:4105`

Observed behavior:

- `surfaceView.ghostexSessionId = command.sessionId`
- Nearby code wires other surface callbacks back into `TerminalWorkspaceView`.
- The static Ghostty action handler can already recover the surface view with `surfaceView(from:)`.

This means an implementation can identify the source terminal session when handling the open-url action, assuming the relevant path carries that id forward.

### Existing Native-To-Sidebar Browser Tab Event

There is already a host event for browser-new-tab intent:

- `native/macos/ghostexHost/Sources/ghostexHost/HostProtocol.swift:1676`
- `shared/native-ghostty-host-protocol.ts:613`

Event shape:

- `type: "browserOpenInNewTabRequested"`
- `sourceSessionId`
- `url`

Current call sites include normal browser pane new-window/history flows:

- `native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift:4843`

Current sidebar handler:

- `native/sidebar/native-sidebar.tsx:6797`

Observed behavior:

- Converts `sourceSessionId` to a sidebar session id.
- Looks up the source session.
- Returns early unless `sourceSession?.kind === "browser"`.
- Calls `createNativeBrowserSession` with `visiblePlacement: appendToTabGroup` after the source session.

This handler currently does not accept terminal sessions as sources.

### Agents Browser Session Creation

The existing normal workspace browser-session creation path is:

- `native/sidebar/native-sidebar.tsx:6685`

Observed behavior:

- `createNativeBrowserSession` normalizes the URL.
- It creates a `BrowserSessionRecord`.
- It records browser history.
- It posts `createWebPane` to native.
- It posts `focusWebPane`.
- It publishes sidebar/workspace state.
- It accepts `visiblePlacement` for tab-group placement.
- It has a `forceWorkspaceSurface` option and also checks `shouldKeepProjectEditorOpenForNewSession`.

Important placement detail:

- If a project editor surface should stay open, creating a browser session may behave differently from the normal Agents workspace path unless the implementation explicitly handles that policy.

### Source Project And Session Resolution Helpers

Relevant helpers:

- `native/sidebar/native-sidebar.tsx:16799` `resolveNativeHostEventSessionReference`
- `native/sidebar/native-sidebar.tsx:16780` `findSessionRecordInProject`
- `native/sidebar/native-sidebar.tsx:17143` `sidebarSessionIdForNativeSession`

Observed behavior:

- Durable native session ids can encode project/session references.
- Native host events can be resolved back to a project and sidebar session id.
- There is a project-specific session lookup helper.

These are relevant because terminal-link handling should be tied to the source terminal's project/session, not necessarily only the currently active project/session.

### Project Browser View

The project Browser view is handled as a project editor mode named `"git"` in the sidebar/native project-editor path.

Relevant sidebar opener:

- `native/sidebar/native-sidebar.tsx:43741` `openProjectGitEditorSurface`

Observed behavior:

- Browser mode uses a project-editor pane rather than a normal workspace browser session card.
- Existing Browser-mode state includes browser tabs and an active browser tab id.
- When an existing Browser editor is already running, the opener focuses it.

Native Browser-view tab helper:

- `native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift:6438` `addProjectEditorGitTab`

Observed behavior:

- Appends a tab to the native project Browser session.
- Activates the new tab.
- Loads the URL.
- Syncs tab bars.
- Focuses the project editor pane.
- Sends `projectEditorTabSelected`.

Persistence/update path back to sidebar:

- `native/sidebar/native-sidebar.tsx:44933` `handleProjectEditorTabSelected`

Observed behavior:

- For parsed project editor mode `"git"`, the sidebar normalizes Browser tabs.
- It updates `projectEditorSurfaceByProjectId`.
- It persists project Browser state.
- It records browser history visits.
- It publishes state.

Existing native Browser-view popup handling:

- `native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift:13314`

Observed behavior:

- `target=_blank` / `window.open` inside a Browser-view tab creates another Browser-view tab through `addProjectEditorGitTab`.

## cmux Code Observations

Reference repo:

- `/Users/madda/dev/custom/cmux`

Terminal URL action:

- `/Users/madda/dev/custom/cmux/Sources/GhosttyTerminalView.swift:4828`

Observed behavior:

- Handles `GHOSTTY_ACTION_OPEN_URL`.
- Reads the raw URL string from Ghostty.
- Attempts local file-path resolution before URL classification.
- Classifies the target with `resolveTerminalOpenURLTarget`.
- Uses main-actor/deferred work for app/layout operations.
- Opens embedded browser links in cmux when settings and target classification allow it.

URL target classification:

- `/Users/madda/dev/custom/cmux/Sources/GhosttyTerminalView.swift:1387`

Observed behavior:

- `TerminalOpenURLTarget` has embedded-browser and external cases.
- `resolveTerminalOpenURLTarget` handles absolute file paths separately from browser URLs and external schemes.

Embedded browser open path:

- `/Users/madda/dev/custom/cmux/Sources/GhosttyTerminalView.swift:4291`

Observed behavior:

- Resolves the source workspace/panel.
- Uses source context for placement.
- Opens in an existing/appropriate browser area when possible.
- Uses main-actor work for UI mutation.

Settings:

- `/Users/madda/dev/custom/cmux/Sources/Panels/BrowserPanel.swift:803`

Observed behavior:

- cmux has browser-link settings for terminal links, sidebar PR links, port links, host whitelists, and external-open patterns.

Placement helper:

- `/Users/madda/dev/custom/cmux/Sources/Workspace.swift:16014`

Observed behavior:

- cmux has a split-tree helper for finding a preferred right-side pane near the source panel.

cmux does not appear to have the same Agents-view versus project Browser-view split that Ghostex has. Its code is still useful as a reference for source-context capture, URL classification, and deferring UI/layout mutation away from the raw Ghostty callback path.

## Implementation Decision Points For The Next Agent

The next agent should decide:

- Whether to reuse/generalize `browserOpenInNewTabRequested` or introduce a terminal-specific host event.
- Whether terminal web links should be limited to `http`/`https`, whether bare domains should be normalized, and how file URLs/custom schemes should behave.
- How to determine "in Agents view" versus "in Browser view" for the source terminal's project, especially if the source terminal is in a project that is not currently active.
- How Browser-view tab creation should be requested if the sidebar is the routing authority but native owns `addProjectEditorGitTab`.
- Whether `createNativeBrowserSession` should be called with `forceWorkspaceSurface` for terminal links when the project editor is open but not in Browser mode.
- Whether existing comments and protocol docs should be renamed from browser-pane-specific wording to source-agnostic wording if the same event is reused.
- Whether any logging is needed. If persistent logging is added, it must not write raw URLs, paths, project names, session names, command text, or other user-owned content.

## Constraints And Repo Rules To Keep In Mind

- Do not add tests for the macOS app or the `gpui` app per repo instructions.
- Do not run `bun run start` unless the user explicitly asks.
- Avoid broad native hit-test/routing exceptions. This task appears to be protocol/session routing, not hit-testing.
- If code is edited later, add/update CDXC comments in code files for the user-facing requirement. Do not add CDXC comments to Markdown/text files.
- Keep persistent logs safe for support bundles; sanitize at the writer boundary if any logging changes are made.
- Do not use fallback behavior to mask the intended routing. Decide the intended route and implement that route directly.
