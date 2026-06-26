# GPUI Sidebar gxserver Parity Progress

## Overall Parity Requirements

- GPUI must render real gxserver sidebar/settings state through the same React sidebar contracts as the macOS app, not fixture-only `SidebarStoryHarness` data.
- gxserver presentation snapshots and deltas must be reduced through one shared implementation so project/session ordering, group membership, manual sorting, pins, tags, lifecycle, and provider-liveness semantics do not diverge by platform.
- gxserver presentation-to-sidebar projection must stay platform-neutral in shared code. macOS-only pane/window overlays, AppKit behavior, WKWebView/CEF ownership, local filesystem paths, and remote-attach carrier mechanics remain in native wrappers.
- Persistent logs must stay privacy-safe. These slices did not add persistent logging.
- App refresh, build, typecheck, unit tests, and visual verification are deferred by instruction.

## Current Task Slices

1. Shared gxserver sidebar foundation: extract reducer and projection helpers into shared TypeScript while keeping macOS behavior intact.
2. GPUI sidebar runtime bridge: replace fixture sidebar data with gxserver snapshot/delta hydration and project/session projection.
3. GPUI settings/runtime parity: feed settings, remote machines, agent/integration status, and gxserver commands into the reused React settings/sidebar surfaces.
4. Validation and polish: run the appropriate app, build, and UI verification once the parent workflow allows verification commands.

## Worker 1 Implementation

- Added `shared/gxserver-presentation-cache.ts` as the platform-neutral gxserver presentation reducer/cache module.
- Kept `native/sidebar/gxserver-presentation-cache.ts` as a compatibility re-export so existing macOS imports continue to work.
- Added `shared/gxserver-presentation-sidebar-projection.ts` with reusable gxserver snapshot-to-sidebar helpers, lifecycle/provider state mapping, presentation session/group creation, project ordering, visible-count calculation, and stable combined project/session id helpers.
- Updated `native/sidebar/native-presentation-projection.ts` to call shared projection helpers while keeping native-only Quick/Chats, remote-attach carrier suppression, delayed-send, Close After Done, and local browser/T3 pane merge behavior in the native wrapper.
- Did not wire GPUI runtime yet and did not run verification commands, per instruction.

## Worker 2 Implementation

- Replaced `gpui/sidebar/phase1-main.tsx` fixture/story harness runtime with the shared `SidebarApp` mounted through a GPUI-local message source and `WebviewApi` adapter.
- Added `gpui/sidebar/phase1-gxserver-runtime.ts` as the GPUI TypeScript runtime bridge. It reads `window.ghostexGpui.gxserverBootstrap`, validates `baseUrl`, `authToken`, and `protocolVersion`, fetches `/api/readPresentationSnapshot`, opens `/api/events`, sends `subscribePresentation`, applies snapshots/deltas with `shared/gxserver-presentation-cache.ts`, and projects groups with `shared/gxserver-presentation-sidebar-projection.ts`.
- The GPUI runtime now publishes a real `hydrate` message, `sidebarGroupsChanged`/`sidebarHudChanged` patch messages, and `previousSessionsResult` messages into `SidebarApp` through the local message source. Missing/invalid bootstrap or snapshot failures hydrate the existing synthetic `gxserver-unavailable` state instead of using fixture sessions.
- Extended `gpui/sidebar/phase1-active-project-context.ts` with a live `SidebarSessionGroup` payload path. GPUI active-project context is now posted from projected live groups and the strict two-boolean runtime settings snapshot, while the Storybook workspace helper remains only for existing source/tests.
- Wired safe/basic command routing in the GPUI `vscode.postMessage` adapter for focus group/session, create terminal session, create default agent session, sleep/wake session/group, close session(s) through `transitionSession`, fork session, rename session, favorite/tag/pin, session order sync, previous-session search, and project removal.
- Left Browser panes, native chrome/sidebar movement, Git/worktree/project-board actions, Settings persistence/installers, app modal host parity, command palette native actions, recent project parking/restore, remote machines, T3/browser access, scratch pad/pinned prompt persistence, and renderer-only command families as explicit unsupported no-ops in this slice.
- Did not edit GPUI Rust/CEF bootstrap. Worker 3 must install `window.ghostexGpui.gxserverBootstrap` with `{ baseUrl, authToken, protocolVersion, clientId?, initialActiveProjectId?, focusedSessionId?, visibleSessionIds? }` and call `window.ghostexGpui.onGxserverBootstrapChanged(bootstrap)` if bootstrap arrives or changes after page load. Existing `postActiveProjectContext(payload)` and `runtimeSettings` / `onRuntimeSettingsChanged(settings)` remain required.
- Did not run verification commands, restart the app, or run `bun run start`, per instruction.

## Worker 3 Implementation

- Extended the private sidebar CEF install message so sidebar-only renderers receive `window.ghostexGpui.gxserverBootstrap` alongside the existing `postActiveProjectContext` bridge and runtime settings object. Ordinary Browser, project workarea, and app-modal CEF clients are not passed the bootstrap or token.
- Added `cef::SidebarGxserverBootstrap` and threaded it through `CefSurface::new` / `CefBrowser::new` only for the phase-1 sidebar surface. Non-sidebar surfaces pass `None`.
- Built the bootstrap from real local gxserver facts in GPUI Rust: `http://127.0.0.1:58744`, the existing `read_gpui_gxserver_auth_token()` helper, protocol version `1`, and stable client id `ghostex-gpui-sidebar`.
- Left `initialActiveProjectId`, `focusedSessionId`, and `visibleSessionIds` absent because this slice found no explicit GPUI-owned gxserver presentation id state for them. It does not derive ids from paths, titles, shell terminal ids, Browser tabs, fixtures, or fallback state.
- Added the narrow post-load CEF update message `ghostex.gpui.sidebar.gxserverBootstrapChanged`, which replaces only `window.ghostexGpui.gxserverBootstrap` and invokes the fixed optional `window.ghostexGpui.onGxserverBootstrapChanged(bootstrap)` callback. The existing shared-settings poll now also checks whether the token-derived bootstrap changed, so a startup unavailable state can flip to live later without fake data or a new watcher.
- Preserved the active-project bridge and runtime settings refresh behavior, including the current saved-settings JSON runtime-settings payload.
- Updated `gpui/src/bin/ghostex_gpui_cef_helper.rs` to mirror the helper-side render-process constants, bootstrap parser, V8 object install, and post-load callback path.
- Updated non-macOS `cef/unsupported.rs` with the same public API shape and no-op refresh method while keeping non-macOS CEF explicitly unsupported.
- Did not run verification commands, restart the app, or run `bun run start`, per instruction.

## Worker 4 Implementation

- Routed GPUI sidebar `openSettings` through the shared app-modal host bridge with `openAppModal({ modal: "settings", type: "open" })` instead of adding a second Settings UI. Also routed clear shared modal commands for first-launch welcome and the tutorial/video help entries through the same bridge.
- Replaced GPUI app-modal hook status/install/uninstall no-ops with gxserver-backed `/api/readAgentHookStatus`, `/api/installAgentHooks`, and `/api/uninstallAgentHooks` calls. Successful daemon payloads are dispatched back to the modal host as `agentHookStatus`; transport/API failures return the same message shape with no fake provider rows or installed hooks.
- Added GPUI Settings status replies for `requestGhostexCliStatus`, `requestGhostexFolderStats`, and `requestOSIntegrationStatus`. CLI status is a narrow read-only local probe that does not run installers or permission prompts. Folder stats scan only the resolved Ghostex home immediate child directories. OS Integration returns a truthful unavailable status because GPUI does not yet own the macOS Launch Services bridge.
- Added Portless Settings/setup command handling that updates gxserver state through `/api/updatePortlessState` for saved enabled/protocol changes, setup-prompt disable, and unsupported admin-action result recording. GPUI still does not run privileged Portless install/reconfigure/retry/remove scripts in this slice.
- Improved GPUI app-modal hydrate state with real saved shared settings, mirrored default agent/action button lists, and gxserver `/api/health/server` Portless health when the short local health read is available. Project settings remain empty because this slice did not add a non-blocking modal project-list fetch or invent project paths.
- Preserved privacy boundaries: no persistent logging was added, gxserver tokens stay inside localhost request helpers, and no command text, stdout/stderr, project/session names, URLs, or paths are written to logs by this slice.
- Did not run verification commands, restart the app, or run `bun run start`, per instruction.

## Worker 5 Implementation

- Extended the GPUI SidebarApp runtime to fetch `/api/listProjects` alongside `/api/readPresentationSnapshot`, retain gxserver project domain rows, and merge `domainProject` presentation deltas into the live HUD. Settings project rows now come from gxserver project domain rows when available, falling back only to presentation project rows that explicitly include paths.
- Replaced GPUI SidebarApp default-only custom agent/action hydration with shared TypeScript normalizers over gxserver project metadata. Custom agent save/delete/order sync and custom command save/delete/order sync now persist through `/api/updateProject` instead of hardcoded Rust JSON duplication.
- Added safe sidebar worktree metadata routing for `requestProjectWorktrees`: GPUI uses `/api/runWorktreeAction` with `action: "list"` plus `/api/runGitAction` with `action: "listBranches"` for the selected local project/worktree family, then returns `projectWorktreesResult`. Remote-machine worktree browsing remains explicitly unsupported.
- Wired project Settings metadata saves in both the GPUI SidebarApp runtime and Rust app-modal bridge through `/api/updateProject`: `setProjectWorktreeCommand`, `setProjectBeadsDisplayKey`, and `setProjectBeadsDirectory`. The Beads display key mirrors native behavior by updating both legacy `gitConfig.beadsDisplayKey` and `projectBoardConfig.beadsDisplayKey`; Beads directory updates only `projectBoardConfig.beadsDirectory`.
- Updated the Rust app-modal Settings hydrate to fill `hud.projectSettingsProjects` from `/api/listProjects`, falling back to `/api/readPresentationSnapshot` only when explicit path-bearing presentation rows are available. The payload still includes only shared Settings contract fields and does not invent paths, names, Beads metadata, or worktree metadata.
- Confirmed and preserved the existing GPUI Previous Sessions app-modal path: request uses `/api/listPreviousSessions`, restore creates a real gxserver session through `/api/createSession` and removes the old row through `/api/removeSession`, and delete uses `/api/removeSession`.
- Preserved Worker 4 Portless health/update behavior and did not add persistent logging, local shell execution, token/path logging, or fixture data.
- Did not run verification commands, restart the app, or run `bun run start`, per instruction.

## Worker 6 Implementation

- Eliminated the Rust app-modal Settings default-only custom agent/action hydration gap. `gpui/src/main.rs` now reads real `/api/listProjects` domain rows during app-modal hydrate, normalizes gxserver custom agent metadata into `hud.agents`, and normalizes project/worktree-owned custom action metadata into `hud.commands`.
- Mirrored the shared Sidebar contract behavior narrowly in Rust for the app-modal host: default agents/actions remain when gxserver rows are absent or invalid, hidden built-in agents stay hidden until explicitly stored, custom agents require explicit id/name/command, browser actions require explicit URLs, terminal actions require explicit commands, icon fields are allowlisted, and display order/deleted default ids are respected.
- Reused the same `/api/listProjects` result for app-modal project settings rows, agent buttons, and action buttons so Settings hydration does not perform separate custom metadata reads or derive launch/action chrome from presentation labels, paths, session titles, command output, URLs, or environment values.
- Kept the live GPUI SidebarApp TypeScript runtime unchanged because it was already using the shared normalizers and gxserver project rows from Worker 5.
- Preserved privacy boundaries: no persistent logging was added, gxserver tokens stay inside existing localhost request helpers, and no project/session names, paths, command text, URLs, stdout/stderr, or daemon response bodies are logged.
- Did not run verification commands, restart the app, or run `bun run start`, per instruction.

## Worker 7 Implementation

- Added a gxserver-owned Recent Projects contract instead of deriving rows from labels or inactive sessions. Project domain rows now carry explicit `isRecentProject` and `recentClosedAt` fields, with a storage migration and shared TypeScript protocol types.
- Added `/api/listRecentProjects`, `/api/restoreRecentProject`, and `/api/removeRecentProject`. The list endpoint returns only explicit parked, path-bearing project rows with project id, title, path, recent closed time, session count computed from gxserver sessions, and optional stored identity icon/theme metadata.
- Updated gxserver presentation projection so explicit recent projects remain durable domain projects but are omitted from active presentation groups. Restore clears the parked fields and publishes a project presentation update; removing a recent project deletes only a row that is still marked recent.
- Wired the GPUI SidebarApp runtime to hydrate `hud.recentProjects` from `/api/listRecentProjects`, refresh that cache after relevant project deltas, and route `restoreRecentProject` / `removeRecentProject` through the new gxserver mutations. Copy path and Finder open remain unsupported in GPUI because there is not yet a safe native owner for clipboard/Finder actions.
- Updated the GPUI Rust app-modal hydrate to include the same `/api/listRecentProjects` rows instead of hard-coded `recentProjects: []`.
- Preserved privacy boundaries: no persistent logging was added, and the new contract does not log or infer from project/session names, command text, URLs, stdout/stderr, tokens, environment values, or filesystem probes.
- Did not run verification commands, restart the app, or run `bun run start`, per instruction.

## Worker 8 Implementation

- Added `/api/closeProjectToRecent` as the producer-side gxserver park mutation for GPUI Close Project. The endpoint accepts only a trusted project id, verifies the project exists and has a stored path, sets `isRecentProject: true`, stamps `recentClosedAt` with server time, publishes the presentation update, and returns the authoritative Recent Projects list.
- Wired the GPUI SidebarApp runtime to route `closeWorkspaceProjectForGroup` separately from `removeWorkspaceProjectForGroup`. Close resolves the project id from the live gxserver presentation group, calls `/api/closeProjectToRecent`, updates local domain/recent caches from the daemon response, and does not synthesize a recent row when resolution or the daemon mutation fails.
- Preserved hard delete semantics for `removeWorkspaceProjectForGroup` and `removeRecentProject`; Close Project no longer falls through to delete in GPUI.
- Preserved privacy boundaries: no persistent logging was added, and the new park flow does not log project/session names, paths, command text, URLs, stdout/stderr, tokens, environment values, or daemon response bodies.
- Did not run verification commands, restart the app, or run `bun run start`, per instruction.

## Worker 9 Implementation

- Wired Rust app-modal Settings hydration to use the explicit active project id from the latest validated GPUI sidebar active-project snapshot when normalizing `hud.commands` from gxserver project rows. Quick/projectless, no-snapshot, and no-active-id hydrates keep the existing no-active-project behavior; unknown explicit ids return default actions instead of borrowing another project row.
- Kept titlebar Settings opens, app-modal bridge opens, Settings save rehydrates, Portless/project metadata refreshes, and product-state refreshes on the same active-project scoping path when the app owns a snapshot.
- Threaded the same validated snapshot active project id into `SidebarGxserverBootstrap.initialActiveProjectId` and refreshes the sidebar CEF bootstrap immediately when the active-project snapshot changes, in addition to the existing polling refresh.
- Left `focusedSessionId` and `visibleSessionIds` absent because this slice still found no explicit GPUI-owned gxserver presentation session id state for those fields.
- Preserved privacy boundaries: no persistent logging was added, and the new paths do not log or persist project ids, project names, paths, URLs, tokens, command text, stdout/stderr, or daemon response bodies.
- Did not run verification commands, restart the app, or run `bun run start`, per instruction.

## Worker 10 Implementation

- Added a fixed GPUI sidebar-native project path action bridge for reused SidebarApp messages: Recent Projects copy path/open in Finder, workspace group copy path/open in Finder, and active workspace open in Finder.
- The TypeScript sidebar runtime now resolves group/active actions to trusted gxserver project ids only and posts a bounded JSON payload with `version`, `type`, `action`, and `projectId`. It does not send renderer paths, DOM text, project titles, or cached domain paths.
- Extended the macOS CEF sidebar bridge and helper binary with the allowlisted `window.ghostexGpui.postNativeProjectPathAction(payload)` function. The bridge remains sidebar-only, main-frame-only, one-string-payload, and size-bounded; Browser/workarea/modal CEF surfaces do not receive this function.
- Added Rust app-side strict parsing for the native project path action payload. Rust resolves recent actions through `/api/listRecentProjects` and workspace/active actions through `/api/listProjects`, accepts only path-bearing rows for the requested project id, requires a non-empty absolute path, then performs the native side effect.
- Copy path uses GPUI clipboard writes on the app thread. Finder open reuses the existing reviewed GPUI OS opener helper from Rust, not TypeScript shelling or a generic IPC channel.
- Preserved privacy boundaries: no persistent logging was added, and the new path does not log project/session names, paths, URLs, tokens, command text, stdout/stderr, daemon response bodies, or renderer payload contents.
- Did not run verification commands, restart the app, or run `bun run start`, per instruction.

## Worker 11 Implementation

- Implemented local GPUI `createProjectWorktree` handling in the TypeScript sidebar runtime. Create mode now resolves the source/parent gxserver project, registers/repairs parent and source rows through `/api/addProjectPath`, generates a bounded sibling worktree branch/path candidate, verifies candidate branch/path availability through `/api/runGitAction` and `/api/runWorktreeAction`, creates the checkout with `/api/runWorktreeAction`, registers the new checkout, prepares Beads hooks, runs the gxserver-owned worktree setup command when configured, and creates a gxserver agent session with the submitted first prompt.
- Implemented local Open Existing handling for the reused Add Worktree modal. GPUI now stores the immediately preceding gxserver worktree-list result as the only trusted path set, rejects arbitrary renderer paths, registers/repairs the selected checkout through `/api/addProjectPath`, verifies gxserver worktree metadata, prepares Beads hooks, focuses the worktree project, and conditionally starts an agent only when real prompt/agent data is supplied by the caller.
- Switched GPUI agent launches from default-agent-only lookup to the same hydrated sidebar agent list used by Settings/HUD, while still passing the resolved command/icon to `/api/createAgentSession` so custom agents and default Accept All shaping remain gxserver-owned.
- Added app-modal toast progress/failure feedback for local worktree create/open without adding persistent logs. Toast copy is generic and does not include paths, branch names, prompt text, setup command text, stdout/stderr, URLs, tokens, environment values, project names, or daemon response bodies.
- Kept remote-machine worktree create/open explicitly unsupported in this slice. GPUI still does not own remote gxserver connection, credential, or machine-selection flows.
- Did not run verification commands, restart the app, or run `bun run start`, per instruction.

## Worker 12 Implementation

- Replaced the GPUI OS Integration unavailable status stub with macOS Launch Services diagnostics behind `#[cfg(target_os = "macos")]`. The status payload now reports the packaged app bundle identifier, representative editor defaults, script defaults, the `ghostex://` default bundle id when present, generated time, and Info.plist registration booleans for editable files, script runner, and the Ghostex URL scheme.
- Wired `setOSIntegrationDefaults` in the GPUI app-modal sidebar command handler to parse the explicit Settings target and call the real Launch Services mutation path before refreshing status. The mutation path only runs for `editor`, `terminalLinks`, `scriptRunner`, or `all`, and status requests remain read-only.
- Matched the Swift host target behavior: editor defaults cover the same editor extension set, script-runner defaults cover `command`, `tool`, and `sh`, terminal links use the `ghostex` URL scheme, and `all` applies only those three role groups. Invalid/missing targets do not mutate anything.
- Kept non-macOS behavior honest with the shared unavailable payload and no Launch Services side effects.
- Preserved privacy boundaries: no persistent logging was added, the bridge does not log bundle paths, URLs, command text, environment values, or raw Launch Services diagnostics, and the only exposed data is the existing shared Settings status payload.
- Worker 12 remaining gap before Worker 13: GPUI macOS packaging still needed the Swift app's document and URL declarations before Launch Services could report the packaged app as an available handler. GPUI could set supported defaults explicitly when Launch Services accepted the app bundle, but it still did not surface per-extension OSStatus failures because `SidebarOSIntegrationStatusMessage` has no failure field.
- Did not run verification commands, restart the app, or run `bun run start`, per instruction.

## Worker 13 Implementation

- Added the Swift app's Launch Services document declarations to the GPUI main app bundle Info.plist emitted by `gpui/scripts/build-macos-app.sh`: editable files use extension `*`, role `Editor`, rank `Alternate`, and content types `public.text`, `public.source-code`, `public.script`, and `public.data`; script files use extensions `command`, `tool`, and `sh`, role `Shell`, rank `Alternate`, and content types `public.shell-script` and `public.unix-executable`.
- Added the GPUI main app bundle `ghostex` URL scheme declaration so Worker 12's Launch Services status bridge can detect the packaged GPUI app as an available terminal-link handler.
- Kept Settings semantics explicit: the plist only registers GPUI as an available handler through `LSHandlerRank: Alternate`; default editor, script-runner, and terminal-link changes remain owned by the Settings actions Worker 12 added.
- Kept helper app plists unchanged so CEF helper bundles do not register as document or URL handlers.
- Did not run packaging, plist validation, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 14 Implementation

- Replaced the GPUI Portless admin unsupported-result stub with a macOS-only fixed privileged helper modeled on `PortlessAdminClient.swift`.
- The helper accepts only `install`, `reconfigure`, `retry`, and `remove`; requires validated `https`/`http` for install/reconfigure/retry; treats remove protocol as optional; writes a temporary root script; runs it via `/usr/bin/osascript` administrator privileges; suppresses stdout/stderr; cleans the script best-effort; and returns only sanitized result fields.
- The root script uses only app-bundled `Contents/Resources/Web/code-server/lib/node` plus `Contents/Resources/Web/portless/dist/cli.js`, installs/removes `sh.portless.proxy`, sets LaunchDaemon output paths to `/dev/null`, and runs Portless with `PORTLESS_SYNC_HOSTS=0`.
- Updated GPUI packaging to stage the narrow Portless admin runtime resources from the native-staged Web payload into the GPUI app bundle and fail packaging if the shared Node runtime or Portless CLI payload is missing. No user PATH, global npm, source checkout command, gxserver-rs, or generic shell fallback is used at runtime.
- Wired admin results through `/api/updatePortlessState` as `recordAdminResult`, refreshed `hud.portless` for the app-modal host, and included the sanitized local result in `hud.portless.nativeAdmin.lastResult`.
- Updated GPUI Portless HUD availability so native admin actions are available only on packaged macOS builds with the bundled runtime present, only for the gxserver-recommended action, and with `remove` limited to Ghostex-owned setup. Non-macOS and incomplete bundles stay honestly unavailable.
- Preserved saved Portless enabled/protocol synchronization behavior from Workers 4/5 and did not add persistent logging.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 15 Implementation

- Added gxserver-owned app user data persistence for Scratch Pad and Pinned Prompts with `/api/readAppUserData`, `/api/saveScratchPad`, and `/api/savePinnedPrompt`, backed by the new `app_user_data` SQLite migration.
- Kept the reused React contracts unchanged: hydrate still provides `scratchPadContent` and `pinnedPrompts`, Scratch Pad still posts `saveScratchPad`, and Pinned Prompts still posts `savePinnedPrompt`. The current modal has no delete or manual order message; empty pinned-prompt content continues to remove that prompt.
- Wired GPUI app-modal Rust hydration and saves to gxserver instead of the old GPUI-only product-state file, and removed the unused GPUI product-state path helper.
- Wired the GPUI SidebarApp runtime to fetch gxserver app user data during hydrate and to persist Scratch Pad/Pinned Prompt saves through gxserver before posting a refreshed hydrate.
- Wired macOS native sidebar startup and saves through the same gxserver app user data source, with a one-time legacy localStorage seed when gxserver has no app-user-data rows. Legacy keys are cleared only after gxserver ownership is confirmed so stale local cache cannot resurrect old prompts later.
- Preserved privacy boundaries: no persistent logging was added, and new diagnostics record only counts, lengths, booleans, event names, and error types, never prompt/note bodies, paths, URLs, command text, tokens, stdout/stderr, or daemon response bodies.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 16 Implementation

- Extended the existing GPUI sidebar-native project path action bridge to handle reused SidebarApp IDE-open messages: `openWorkspaceProjectInIdeForGroup` and `openActiveWorkspaceProjectInIde`.
- The TypeScript runtime resolves group/active workspace actions to trusted gxserver project ids and posts only the bounded native payload with `version`, `type`, fixed `action`, and `projectId`. The generic group IDE action uses a Settings-owned native action; active-workspace VS Code/Zed selections are mapped to fixed native action names. It does not forward paths, titles, DOM text, renderer `targetApp`, app names, editor commands, URLs, or shell snippets.
- Rust keeps the existing strict parser and resolves workspace/active project ids through `/api/listProjects`, requiring a path-bearing gxserver row with an absolute stored path before any native side effect.
- IDE launch selection is native-owned: generic group IDE opens use shared Settings built-in default editor commands with fixed argv (`code`/compatible `--reuse-window`, `zed`/`zeditor` `--existing`, `subl` direct path) or fixed macOS app-name fallbacks when the CLI is absent; active-workspace IDE opens use fixed VS Code or Zed targets from the shared message. At the end of Worker 16, custom default editor commands still failed through the existing generic warning toast path until Worker 17 added the bounded native parser.
- Preserved privacy boundaries: no persistent logging was added, and the new path does not log project/session names, paths, app names, editor command text, URLs, tokens, stdout/stderr, daemon response bodies, or renderer payload contents.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 17 Implementation

- Added production GPUI support for Settings custom default editor command strings on generic workspace group IDE opens.
- Kept the renderer bridge unchanged and pathless: SidebarApp still sends only the fixed `openWorkspaceProjectInIde` native action plus a trusted gxserver project id. Rust resolves the project path through `/api/listProjects` and reads `defaultEditorCommand` / `customDefaultEditorCommand` from shared Settings itself.
- Implemented a native-owned bounded parser for custom default editor commands. Supported custom strings are argv-style commands with optional single/double-quoted tokens; the executable must be either a PATH command that exists or an absolute executable file, and the resolved project path is appended as a separate argv item. Launches suppress stdin/stdout/stderr and return only generic warning text on parse, availability, or spawn failure.
- Left shell-style custom command behavior intentionally unsupported for project opens. The GPUI project-open path does not invoke `/bin/sh` or `/bin/zsh`, does not expand environment variables, globs, redirects, pipes, comments, or placeholders, does not accept relative executable paths, and does not treat `.app` bundle directories as executables. Users who need app-name launch behavior can use a safe command such as `/usr/bin/open -a "App Name"`.
- Built-in default editor commands remain on the existing fixed argv/app-name path; active-workspace Open In VS Code/Zed remains fixed-target behavior and does not consult custom Settings command text.
- Preserved privacy boundaries: no persistent logging was added, and the custom command path does not log project/session names, paths, app names, editor command text, URLs, tokens, stdout/stderr, daemon response bodies, or renderer payload contents.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 18 Implementation

- Updated the shared Add Worktree modal so Open Existing still submits a selected worktree path by itself when the first prompt is blank, but can also submit a real first prompt plus the visible selected agent from the same shared controls used by Create New.
- Routed those optional Open Existing `agentId` and `prompt` fields through the native app-modal host `createProjectWorktree` message without adding GPUI-only UI or invented defaults.
- Tightened GPUI Open Existing handling so a non-blank submitted prompt requires a configured submitted agent; blank prompts preserve the trusted-path project-open flow from Worker 11.
- Updated macOS local and remote Open Existing receivers to honor the same optional prompt draft: they continue open-only behavior for blank prompts, and start the selected agent session in the opened worktree when prompt text is submitted.
- Preserved Worker 11's trust boundary: GPUI still accepts only paths from the immediately preceding gxserver worktree-list result and rejects arbitrary renderer paths outside that set.
- Preserved privacy boundaries: no persistent logging was added, and no project/worktree names, paths, prompt text, command text, URLs, tokens, stdout/stderr, daemon responses, or renderer payload contents are written to logs by this slice.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 19 Implementation

- Added the optional shared `statusItems` channel to `SidebarOSIntegrationStatusMessage` so reused Settings surfaces can receive sanitized Launch Services operation metadata without breaking older status payloads.
- Updated the shared OS Integration Settings tab to render generic repair guidance for those status items, with sanitized target/extension labels and no GPUI-only UI branch.
- Wired GPUI macOS Launch Services mutations to preserve per-extension editor/script default failures, `ghostex` scheme failures, bundle-registration failures, invalid targets, and bundle-identity problems as enum-based status items instead of discarding OSStatus results.
- Kept GPUI non-macOS honest by returning the existing unavailable status plus an unsupported-platform status item, with no fake Launch Services parity.
- Wired the Swift macOS host's two Settings command routes to emit the same `statusItems` channel and replaced raw numeric default-set failure messages with generic user-facing text.
- Preserved privacy boundaries: no persistent logging was added, and the new channel does not expose bundle paths, file paths, URLs, command text, environment values, tokens, raw OSStatus values, stdout/stderr, daemon response bodies, or user-owned content.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 20 Implementation

- Routed GPUI Git HUD refresh through gxserver typed operations for repository detection, branch, porcelain status, numstat files, untracked files, upstream ahead/behind counts, remotes/origin, GitHub CLI availability, and current PR metadata. The reused SidebarApp now receives real Git state instead of the default no-op state.
- Persisted Git sidebar preferences from GPUI through gxserver project `gitConfig`: primary action, commit-review confirmation, and commit-body generation settings now hydrate back into the shared HUD state.
- Implemented production-safe direct Git mutations backed by `/api/runGitAction`: `syncRemote` performs fast-forward pull plus push when needed, clean `push` pushes or sets upstream through `origin`, and confirmed `commit` / `commit & push` stage only trusted review files before committing. The GPUI adapter rejects modal file selections that are not in the gxserver-derived changed-file list for that review request.
- Reused the shared commit review modal in GPUI by adding a request-scoped shared `sidebarGitFileDiff` result channel. File diff clicks are served through gxserver `diffCachedNoExt`, `diffNoExt`, `isUntrackedFile`, and `diffNoIndexAgainstNull`, and only for files from the pending review request.
- Routed Git agent workflows through visible gxserver agent sessions where native/macOS also expects a visible prompt workflow: `syncMain`, `multiRelease`, `release`, `runSidebarGitMultipleCommits`, and Create PR after review. PR prompts avoid embedding project paths or branch labels; selected file lists are included only when the user explicitly narrowed the commit selection and the paths match the trusted review list.
- Left blank commit-message generation as the remaining GPUI gap at the end of Worker 20 because GPUI did not yet own native prompt-generation shell execution or a safe gxserver result channel for generated commit subjects/bodies. Worker 23 closes that gap through local gxserver generation.
- Preserved privacy boundaries: no persistent logging was added, toast text stays generic, gxserver request authority is project id plus fixed typed action names, and the new shared file-diff message is scoped by request id instead of exposing renderer-supplied paths as authority.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 21 Implementation

- Implemented GPUI existing-PR browser open through the existing sidebar-native bridge. The reused Git action still starts from shared SidebarApp state, but Rust re-runs gxserver `/api/runGitHubAction` with `prView` for the gxserver project id and opens only a current open `https://github.com/.../pull/<number>` URL. Renderer DOM text, cached PR URLs, arbitrary payload URLs, titles, and browser state are not launch authority.
- Implemented GPUI changed-file IDE open for the shared Git HUD/review action family. The TypeScript runtime accepts only files already present in the current gxserver-derived HUD or pending review request, then Rust re-queries gxserver Git state, rebuilds the current changed-file set, normalizes the relative candidate, joins it under the gxserver project path, and launches through the reviewed Settings default editor path.
- Narrowly extended the shared `openSidebarGitChangedFile` message with an optional review `requestId` so review-scoped opens can be validated against pending gxserver review files without adding GPUI-only UI.
- Kept the CEF bridge fixed and sidebar-only: no new generic IPC, no renderer shelling, no arbitrary URL/path bridge, and no Browser/workarea/modal exposure. The CEF helper still forwards only one bounded string payload, while Rust owns gxserver revalidation and side effects.
- Preserved privacy boundaries: no persistent logging was added, no PR URLs or file paths are logged, gxserver daemon responses are not persisted or logged, and user-visible failures remain generic.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 22 Implementation

- Implemented local GPUI direct worktree merge-to-main from the reused Git review modal. Worktree commit/push/PR actions now open the same review modal as macOS so the confirmed Merge to main path is available, including no-change worktree completions.
- Direct merge resolves authority from the pending gxserver project id and gxserver worktree metadata, requires a configured prompt agent for conflict recovery, verifies the parent project exists locally with a `main` ref, requires the parent checkout to be clean, checks out `main`, and runs the merge through fixed `/api/runGitAction` action names. It does not shell from TypeScript or trust renderer paths, branch text, command text, modal labels, or commit-message content as operation authority.
- If the parent merge exits with conflicts, GPUI starts a visible gxserver agent session in the parent project with a conflict-resolution prompt and reports the merge as needing resolution instead of faking success or deleting the worktree.
- Implemented delete-after-worktree cleanup for completed direct commit/push and direct merge operations. Cleanup only runs after the safe operation finishes, validates that the original gxserver project is still a worktree, and removes it via `/api/deleteWorktreeProject` with branch deletion disabled. Returned cleanup warnings are surfaced generically without logging raw daemon output.
- Left PR-agent delete-after cleanup unsupported because the visible `gh pr create --fill` workflow still has no gxserver-owned completion signal in GPUI; the prompt now states that this specific visible-agent PR path cannot delete automatically yet.
- Preserved privacy boundaries: no persistent logging was added, and the new flow does not persist or log project/worktree names, paths, branch names, command text, commit messages, URLs, tokens, stdout/stderr, daemon responses, or renderer payload contents.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 23 Implementation

- Implemented GPUI blank commit-message generation for confirmed commit, commit-and-push, and direct merge flows that use the reused shared Git review modal.
- Added a local-only gxserver `/api/generateCommitMessage` RPC. It accepts only a trusted gxserver project id, the review-approved project-relative file list from the GPUI pending review request, and the selected prompt-agent id. gxserver re-derives current changed paths from zero-delimited Git status before staging, stages only validated files, reads file-scoped cached diff/stat output through allowlisted typed Git actions, builds the same JSON subject/body prompt shape used by macOS, resolves the prompt-agent command from gxserver project/settings state, and returns only parsed `subject`/`body`.
- Mirrored native prompt-agent support for commit-message generation: Codex uses ephemeral headless `exec`, Cursor uses read-only print/ask mode, Claude and Gemini use `-p`, and custom non-default agents use their configured stdin wrapper. Unsupported built-in prompt agents fail honestly through both GPUI preflight and gxserver enforcement instead of falling back to a generic message.
- Updated GPUI commit handling so explicit messages continue unchanged, while blank messages generate after file-selection validation and before branch creation/commit. The renderer still does not shell out, does not send command text, does not trust renderer paths as authority, and does not fabricate commit messages.
- Preserved privacy boundaries: no persistent logging was added, typed Git metadata redacts selected file paths as counts, generated prompt/diff/commit text stays inside authenticated RPC payloads and process stdout, and only sanitized no-agent/unsupported-agent preflight messages are surfaced directly.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 24 Implementation

- Added local-only gxserver `/api/createPullRequest` for direct/background GPUI PR completion. The endpoint accepts only trusted project scope, runs fixed `gh pr create --fill` plus current-branch `gh pr view --json number,state,url`, validates the returned `https://github.com/.../pull/<number>` URL and open PR state, and returns only `{ ok, created, pr, reason }` without raw command output.
- Wired GPUI direct PR actions and shared review confirmations to commit only validated review files, push through fixed gxserver Git action names, call `/api/createPullRequest`, and then reuse Worker 21's native browser opener so Rust re-resolves the current PR URL before launching the browser.
- Enabled delete-after-worktree cleanup for the direct/background PR path only after the gxserver PR result confirms an open pull request. Cleanup still uses the Worker 22 validated `/api/deleteWorktreeProject` path with branch deletion disabled.
- Left visible-agent PR cleanup unsupported because visible PR terminals still have no gxserver-owned completion signal. The new cleanup support applies only to the direct/background PR path with a confirmed gxserver PR result.
- Preserved privacy boundaries: no persistent logging was added, and the new path does not persist or log PR URLs, branch names, commit messages, command text, stdout/stderr, daemon responses, project/worktree names, paths, tokens, or renderer payload contents.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 25 Implementation

- Inspected the shared Create PR flow, GPUI routing, gxserver protocol, presentation deltas, event socket, and agent/session lifecycle shape. Visible PR-agent sessions expose gxserver lifecycle/activity/provider state only; there is still no trusted PR-created result signal without scraping terminal text, prompt text, stdout/stderr, or timers.
- Narrowed GPUI PR routing to a production policy: non-delete PR actions preserve the visible prompt-agent session workflow, while any PR review confirmation with delete-after requested uses the Worker 24 direct/background `/api/createPullRequest` path and deletes the original validated worktree only after gxserver confirms an open PR.
- Removed the visible GPUI PR-agent cleanup warning path by making visible PR prompts non-delete only. Delete-after intent is no longer handed to the visible terminal workflow, so GPUI does not ask an agent or renderer-side guess to clean up after an unconfirmed PR.
- Preserved privacy boundaries: no persistent logging was added, and the new routing does not persist or log PR URLs, branch names, commit messages, command text, stdout/stderr, daemon responses, project/worktree names, paths, tokens, or renderer payload contents.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 26 Implementation

- Implemented the first production GPUI remote-machine foundation through the existing Rust-owned SSH/keychain/tunnel path. Reconnect requests now drive remote gxserver status into the reused SidebarApp surface, store tokens only through native secure storage/in-memory connection state, and refresh remote presentation snapshots after a successful connection.
- Added a sidebar-only Rust event channel for remote machine status and remote gxserver presentation payloads. The TypeScript SidebarApp runtime consumes those events, keeps machine-scoped presentation snapshots, and renders saved remote machines as remote project/session groups with ids prefixed by machine id so local and remote rows cannot collide.
- Routed the shared remote project picker through the GPUI app-modal host. Browse/add project commands now go from React to Rust, through an authenticated live remote gxserver tunnel, and back as the existing remote picker result messages without exposing remote tokens, SSH details, remote URLs, daemon response bodies, or renderer payload authority.
- Added an allowlisted remote sidebar RPC path for session ownership actions that the reused SidebarApp already emits: create terminal session, sleep/wake, kill, rename, favorite, pin, and tag updates. Each call targets only the selected live remote machine tunnel and then refreshes the remote presentation snapshot.
- Kept remote Git/GitHub, worktree, clone, project close/remove, native path actions, terminal attach/focus, remote agent launch/fork/resume, and previous-session restore unsupported rather than faking data or shelling from the renderer.
- Preserved privacy boundaries: no persistent logging was added, and the new remote bridge does not log or persist hostnames, usernames, paths, project names, URLs, tokens, command text, stdout/stderr, daemon responses, or renderer payload contents.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 27 Implementation

- Routed GPUI remote project-header agent launches through the Worker 26 Rust-owned remote gxserver tunnel. The SidebarApp runtime sends only the machine-scoped project id, selected agent id, workspace surface, and a `requireLaunchCommand` guard; it does not send renderer-owned command text, host data, URLs, tokens, prompts, stdout/stderr, or daemon response bodies.
- Added gxserver `requireLaunchCommand` enforcement for `createAgentSession`, so default/custom remote agent ids must resolve to a real command through the owning daemon's built-in defaults or remote project metadata. Unknown custom agent ids now fail honestly instead of creating an inert commandless session.
- Routed remote session fork through `/api/forkSession` after validating that the machine-prefixed session id exists in the current remote presentation snapshot. The fork path uses only remote project/session ids from the snapshot, not labels or terminal text.
- Implemented GPUI previous-session list/search across local gxserver plus connected remote machines. Remote rows use `remote-gxserver:<machine>:<project>:<session>` history ids, and Rust strips path-bearing `cwd` / `agentSessionPath` fields before the response reaches CEF.
- Implemented previous-session restore/delete for remote rows. Restore creates a real remote workspace session with `restoredFromSessionId`, then removes the stopped remote history row and refreshes the remote presentation through the same Rust-owned tunnel. Local GPUI previous-session restore/delete is also wired through the existing local gxserver create/remove endpoints.
- Added a response-capable but still allowlisted remote sidebar RPC bridge for the session/history endpoints that need success or list results. Mutating remote responses resolve with sanitized success only; raw session bodies that may contain launch/runtime settings are not forwarded to the renderer.
- Preserved privacy boundaries: no persistent logging was added, remote tokens stay in Rust/native tunnel state, and the new paths do not log hostnames, usernames, paths, project/session names, commands, prompts, URLs, stdout/stderr, daemon response bodies, or renderer payload contents.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 28 Implementation

- Routed GPUI remote Git/GitHub actions through the Worker 26/27 Rust-owned saved-machine gxserver tunnel. Remote project row Git actions now read repository state, changed files, branch/upstream/remotes, GitHub CLI state, and current PR metadata from the owning remote gxserver before deciding commit, push, sync, PR, and prompt-agent workflows.
- Reused the shared Git review modal for remote commit/push/PR work. Pending review requests now carry machine/project scope, so confirm, multiple-commits, delete-after cleanup, file-diff clicks, and direct-merge unsupported warnings route back to the owning remote project instead of the active local project.
- Implemented remote safe mutations: fast-forward sync/push, reviewed commit and commit-and-push on the current ref, blank commit-message generation via remote `/api/generateCommitMessage`, direct PR creation via remote `/api/createPullRequest` only when a trusted PR result is needed for delete-after cleanup, and remote worktree delete-after cleanup through the owning remote gxserver.
- Left remote Add Worktree list/create/open, direct merge-to-main, and commit-on-new-branch unsupported in GPUI. The current gxserver worktree create/open and merge/branch flows still require renderer-provided remote checkout paths, branch/ref strings, or branch-name derivation, so this slice does not route those through the saved-machine tunnel until gxserver exposes id-scoped remote worktree/merge/branch operations that derive target paths and refs on the remote daemon side.
- Extended the GPUI Rust remote sidebar bridge allowlist and response shaping for the new endpoints. Typed operation responses strip `command`, generated commit-message responses keep only subject/body, PR creation responses keep open-state confirmation without URL launch authority, and delete-worktree responses keep warning kinds only; remote project list/add endpoints are not exposed through the sidebar tunnel.
- Kept native path/browser/terminal-focus sub-actions unsupported for remote projects. Existing remote PR browser opens, changed-file IDE opens, remote Add Worktree create/open, remote direct merge, remote commit-on-new-branch, remote terminal attach/focus, and remote native project path actions still need a later remote-owned native or daemon surface rather than being faked through local Finder/IDE/browser actions.
- Preserved privacy boundaries: no persistent logging was added, remote tokens stay in Rust tunnel state, and the new paths do not persist or log hostnames, usernames, paths, project/worktree/session names, branch names, command text, commit messages, generated text, PR URLs, stdout/stderr, daemon bodies, or renderer payload contents.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 29 Implementation

- Scoped shared Git preference messages so reused Git controls can include the owning `groupId` or machine-scoped `projectId`. GPUI now routes scoped local preference writes to the resolved local gxserver project, scoped remote writes through the owning saved-machine gxserver tunnel, and keeps old unscoped local callers on the existing all-local-project preference behavior.
- Added sanitized Git preference metadata to gxserver presentation projects. The projection exposes only `primaryAction`, `confirmCommit`, and `generateCommitBody`, so remote GPUI can preserve current preference values without fetching path-bearing domain project lists through the sidebar tunnel.
- Hardened the GPUI Rust remote sidebar bridge for project mutations. `/api/updateProject` is allowlisted only for full Git preference writes with a valid gxserver project id, while close/restore/remove recent and remove project endpoints accept only `projectId`; raw update fields, paths, names, commands, URLs, branch refs, stdout/stderr, tokens, and daemon bodies are not forwarded as renderer authority.
- Implemented GPUI remote project close/remove/restore using the owning remote gxserver endpoints. Close calls `/api/closeProjectToRecent`, restore/remove recent use `/api/restoreRecentProject` and `/api/removeRecentProject`, and hard remove uses `/api/removeProject`; GPUI displays remote Recent Projects from `/api/listRecentProjects` rather than synthesizing local fake rows.
- Kept remote native path actions honest: remote Recent Project copy/open and remote Finder/IDE/browser/native opens remain unsupported instead of tunneling local Finder/clipboard/browser behavior.
- Preserved privacy boundaries: no persistent logging was added, remote tokens stay in Rust tunnel state, and the new paths do not persist or log hostnames, usernames, project/session names, paths, branch names, command text, URLs, stdout/stderr, daemon response bodies, or renderer payload contents.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 30 Implementation

- Added production gxserver worktree/branch RPCs for GPUI remote parity: `/api/listProjectWorktrees`, `/api/createProjectWorktree`, `/api/openProjectWorktree`, `/api/mergeWorktreeIntoMain`, and `/api/checkoutProjectNewBranch`.
- The new worktree RPCs accept only trusted project ids plus bounded user-owned labels or an opaque daemon-issued worktree key. gxserver derives parent/source project paths, sibling worktree paths, branch names, open-existing checkout paths, merge parent/main targets, and unique branch names on the owning daemon side instead of trusting renderer-provided absolute paths or branch targets.
- Wired GPUI remote Add Worktree through the saved-machine tunnel. The shared modal now carries a `worktreeKey` for remote Open Existing selections, and GPUI accepts only keys from the latest remote gxserver list result before calling `/api/openProjectWorktree`. Create New calls `/api/createProjectWorktree`, then preserves the optional first-prompt/agent behavior by creating the remote agent session in the returned worktree project.
- Wired GPUI remote direct merge-to-main through `/api/mergeWorktreeIntoMain` for remote worktree projects. GPUI commits trusted review files first when needed, refreshes remote presentation after the mutation, reports conflicts generically, and leaves delete-after cleanup on the existing validated remote worktree-delete path after a completed merge.
- Wired remote commit-on-new-branch through `/api/checkoutProjectNewBranch` before the reviewed remote commit. The renderer sends only the project id and commit subject label; gxserver normalizes and uniquifies the actual branch name.
- Extended the Rust remote sidebar tunnel allowlist and response shaping for these endpoints. Create/open responses are reduced to sanitized presentation project metadata, list responses keep only branch display rows plus worktree display rows with opaque keys, merge responses keep only parent project id and status, and checkout-new-branch returns only a boolean confirmation.
- Preserved unsupported remote side effects: this slice did not implement remote terminal attach/focus, Finder/IDE/open-terminal/browser side effects, generic remote filesystem deletion, clone actions, or native remote path opens.
- Preserved privacy boundaries: no persistent logging was added, remote tokens stay in Rust tunnel state, and the new paths do not persist or log hostnames, usernames, project/worktree/session names, paths, branch names, command text, prompts, URLs, tokens, stdout/stderr, daemon bodies, or renderer payload contents.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 31 Implementation

- Implemented GPUI remote terminal/session attach and focus through the existing sidebar-native bridge. Remote session clicks, remote focus-mode clicks, and remote group focus now send only a fixed native action plus a machine-scoped remote presentation session id; the renderer does not send SSH targets, remote paths, tokens, command text, daemon responses, or terminal content.
- Added Rust-owned remote attach handling. Rust parses the remote presentation id, resolves the saved remote machine settings and live gxserver tunnel, validates attach metadata through the owning remote gxserver, and creates or focuses a GPUI Agents terminal tab with an explicit Ghostty startup payload that runs `ssh -tt ... ghostex attach --session-id --project-id` inside the remote login shell.
- Added runtime-only remote attach focus bookkeeping from machine/project/session id to the GPUI terminal tab that owns the SSH attach process. The map is not persisted and stores no SSH targets, paths, commands, titles, tokens, stdout/stderr, or daemon bodies.
- Added direct remote Copy Attach Command and Copy Resume Command surfaces outside previous-session restore. Rust builds the SSH attach command from saved machine settings and exact ids; resume command copy asks the remote gxserver for its agent resume plan, wraps the returned copy command in SSH, and writes the command directly to the clipboard without sending command text through React.
- Updated remote previous-session restore so, when the remote gxserver returns the newly restored session id, GPUI immediately routes that exact id through the same Rust-owned attach path. If the daemon does not return a new id, GPUI leaves restore server-only instead of guessing from the old history id.
- Preserved privacy boundaries: no persistent logging was added, remote tokens remain in Rust tunnel state, and this slice does not persist or log hostnames, usernames, project/session names, paths, branch names, command text, prompts, URLs, stdout/stderr, daemon bodies, clipboard contents, or renderer payload contents.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 32 Implementation

- Implemented GPUI remote project path copy through the sidebar-native bridge. Reused Recent Projects and project-header Copy Path now send only a fixed remote action plus machine-scoped project id; Rust resolves the active or recent project path through the live remote gxserver tunnel immediately before writing the clipboard.
- Implemented GPUI remote existing-PR browser open for the shared Git action path and the direct/background PR completion path. Rust re-runs remote `/api/runGitHubAction` with `prView`, validates open state and an `https://github.com/.../pull/<number>` URL, and only then asks the OS to open the browser.
- Routed review-scoped remote changed-file open intents through Rust for current remote Git-state revalidation. After validating the project-relative file candidate against remote `statusPorcelain`, `diffNumstat`, and `listUntracked`, GPUI still fails honestly because there is no reviewed local IDE remote-file owner in this slice.
- Kept remote Finder and remote IDE project opens unsupported rather than opening remote paths in local Finder/IDE or inventing SSH/URI fallbacks. Remote group/session focus continues to use Worker 31's Rust-owned remote attach terminal path.
- Updated the shared PR protocol comment and GPUI runtime comments so they no longer claim all remote PR/browser native side effects are unsupported.
- Preserved privacy boundaries: no persistent logging was added, remote tokens remain in Rust tunnel state, and this slice does not persist or log hostnames, usernames, project/session names, paths, branch names, command text, prompts, URLs, stdout/stderr, daemon bodies, clipboard contents, or renderer payload contents.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 33 Implementation

- Routed GPUI Remote machine Clone Repository through the shared Add Repository modal. The sidebar runtime now opens the modal with only the selected saved machine id/name after a live remote gxserver presentation exists.
- Implemented Rust-owned remote clone preview/start/poll/cancel handling for the modal commands. The renderer submits only explicit clone UI input: repository text, target parent folder text, optional folder/branch text, clone flags, request id, and selected machine id. Rust forwards bounded params through the existing saved-machine gxserver tunnel; the remote daemon validates, derives destination paths, runs Git, and registers the project.
- Kept clone progress runtime-only in GPUI. Rust stores only request id, remote machine id, remote clone job id, and toast id so cancel/poll can target the daemon job; it does not store or log repository URLs, target paths, folder names, branch names, stdout/stderr, daemon bodies, SSH targets, tokens, or prompts.
- Updated the gxserver Rust clone job so a successful clone registration publishes the authoritative `projectAdded` presentation delta, in addition to clients refreshing the remote presentation snapshot after completion.
- Kept optional first-prompt/agent behavior unchanged because the shared Clone Repository modal does not currently collect a first prompt or selected prompt agent.
- At the end of Worker 33, remote Finder/IDE project opens and packaged remote gxserver install/upload when the daemon was missing remained out of that slice; Worker 35 later closed the packaged install/upload path for bundled remote targets.
- Preserved privacy boundaries: no persistent logging was added, user-visible clone failures are generic in GPUI, and raw clone output/daemon failure details are not forwarded to CEF.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 34 Implementation

- Implemented live GPUI remote presentation event streaming through the Rust-owned saved-machine gxserver tunnel. On successful reconnect, Rust now opens authenticated `/api/events` over the localhost SSH tunnel, sends the existing `subscribePresentation` message with the shared sidebar client id, and forwards only `presentationSnapshot` / `presentationDelta` payloads through the existing sidebar-only remote event channel.
- Added runtime stream ownership for connected remote machines: each connection carries a cancel flag and generation id, disconnect/reconnect cancels the old stream, bounded reconnect attempts run inside Rust, and stale stream or snapshot-refresh results are ignored when they no longer match the current machine connection.
- Kept TypeScript renderer authority unchanged. The existing `remoteGxserverPresentation` handler continues to apply snapshots/deltas into the machine-scoped presentation cache with shared reducers and machine-prefixed project/session/group ids, so local rows and multiple remote machines cannot collide.
- Retained snapshot refreshes after GPUI-owned remote mutations as a resync path, but they are no longer the only mechanism for remote sidebar freshness because remote daemon deltas now stream live when the tunnel is connected.
- Preserved privacy boundaries: no persistent logging was added, and Rust does not expose remote base URLs, bearer tokens, SSH details, command text, stdout/stderr, daemon responses, hostnames, usernames, or renderer payload bodies to CEF globals.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 35 Implementation

- Implemented packaged remote gxserver install/upload for GPUI reconnect approval on macOS. When the saved-machine SSH token read reports gxserver missing and the shared approval modal retries with `installApproved`, Rust probes the remote OS/CPU, selects only a compatible app-bundled gxserver package, archives it with AppleDouble files disabled, uploads it over the saved SSH configuration, installs it under `~/.ghostex/gxserver/releases`, retargets the stable package symlink, exposes gxserver/zmx/zehn/bd/ghostex/gx under `~/.local/bin`, starts gxserver, reads the token, stores it in Keychain, and reconnects through the existing Worker 26 tunnel/Worker 34 stream path.
- Added GPUI app-bundle resource validation for remote Linux packages. The packaging script now stages prebuilt `gxserver-linux-x64` and `gxserver-linux-arm64` packages from explicit env paths, deterministic `build/remote-gxserver-linux/<arch>/package` outputs, or already staged native Web resources, and validates required gxserver/zmx/zehn/bd/Node/Portless/CLI resources plus Linux ELF architecture before copying them into `Contents/Resources/Web`.
- Kept runtime fallback honest: development binaries or app bundles without a matching packaged remote artifact report install unavailable/unsupported instead of reading source checkout paths or uploading host macOS packages. `GHOSTEX_REQUIRE_REMOTE_GXSERVER_LINUX_PACKAGES=1` keeps packaging fail-fast for builds that must ship remote Linux install support.
- Reused the existing shared Settings/app-modal command path. No GPUI-only control was added; the same `reconnectRemoteMachine` command with bounded `remoteMachineId` and `installApproved` remains the only renderer authority.
- Preserved privacy boundaries: no persistent logging was added, tokens stay in Keychain/Rust tunnel state, SSH host/user/path/command text/stdout/stderr/daemon bodies are not forwarded to CEF, and user-visible failures remain generic status messages.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 36 Implementation

- Implemented GPUI remote project IDE opens through a Rust-owned VS Code Remote-SSH policy. Reused sidebar messages now send only fixed remote IDE action names plus machine-scoped project ids; Rust resolves saved machine settings, the live remote gxserver tunnel, and the remote project path before launching `code` or `code-insiders` with fixed argv.
- Implemented GPUI remote changed-file IDE opens for the same supported VS Code/Insiders Remote-SSH policy. Rust still revalidates the renderer-provided relative candidate against current remote `statusPorcelain`, `diffNumstat`, and `listUntracked` output before joining it under the remote gxserver project path.
- Kept unsupported paths honest: remote Finder/open-folder remains unsupported in GPUI, and remote IDE opens for Zed/Zeditor, Sublime, Cursor, Windsurf, VSCodium, custom Settings commands, or saved machine configs that require Ghostex-only SSH port/identity fields fail with generic messaging instead of opening local remote paths or shelling arbitrary Settings text.
- Preserved privacy boundaries: no persistent logging was added, and the new opener does not persist or log hostnames, usernames, remote paths, file names, command text, URI text, tokens, stdout/stderr, daemon bodies, or renderer payload contents.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 37 Implementation

- Added `/api/readSidebarHud` as a production gxserver contract for normalized sidebar/app-modal agent and action HUD rows. The Rust daemon projection owns default agents/actions, hidden built-ins, custom agent id/name/command validation, browser URL validation, terminal command validation, agent/action icon allowlists, display order, deleted default action ids, active-project command scoping, worktree parent command ownership, and unknown-active-project default actions.
- Updated shared protocol types for the new endpoint so GPUI clients call a typed gxserver contract instead of string-only private paths.
- Updated the GPUI Rust app-modal hydrate and titlebar Actions reader to consume `/api/readSidebarHud`; app-modal Rust no longer normalizes custom agent/action read rows from `/api/listProjects`. Project Settings rows, Recent Projects, Pinned Prompts, and Scratch Pad remain on their existing gxserver contracts.
- Updated the GPUI SidebarApp TypeScript runtime to fetch and cache `/api/readSidebarHud`, use it for `hud.agents`, `hud.commands`, and agent lookup, and refresh it after active-project or project-metadata changes. The runtime keeps raw `/api/listProjects` rows for project settings/worktree data and Settings save/delete/order mutations.
- Preserved privacy boundaries: no persistent logging was added, and the new contract does not log project names, paths, command text, URLs, prompts, tokens, stdout/stderr, daemon bodies, or renderer payload contents.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 38 Implementation

- Added `/api/mutateSidebarHudSettings` as a production gxserver mutation contract for Settings custom agent/action save, delete, and order operations. The daemon now owns validation and metadata mutation for hidden built-in agents, restored default agents, default action deletion through `deletedDefaultCommandIds`, display order normalization, agent/action icon allowlists, browser URL presence, terminal command presence, active-project action scoping, and worktree parent command ownership.
- Kept real project metadata as the persistence source. Agent mutations still fan out normalized `customAgents` and `customAgentOrder` to project rows, action mutations update the active project command owner row, and the endpoint returns updated project rows plus a refreshed `/api/readSidebarHud`-compatible HUD payload.
- Updated the GPUI SidebarApp TypeScript runtime to call `/api/mutateSidebarHudSettings` for `saveSidebarAgent`, `deleteSidebarAgent`, `syncSidebarAgentOrder`, `saveSidebarCommand`, `deleteSidebarCommand`, and `syncSidebarCommandOrder`. The renderer now applies daemon-returned project rows and HUD rows instead of rebuilding `customAgents`, `customAgentOrder`, `customCommands`, `customCommandOrder`, or `deletedDefaultCommandIds` locally.
- Updated the GPUI Rust app-modal command handler to keep CEF message validation as a shape boundary but route agent/action Settings writes through `/api/mutateSidebarHudSettings` instead of applying local metadata state transitions and persisting through `/api/updateProject`.
- Preserved native compatibility by leaving `/api/updateProject` and the existing native/shared Settings message shapes intact; only the GPUI Rust and GPUI SidebarApp mutation paths moved to the new gxserver contract.
- Preserved privacy boundaries: no persistent logging was added, and the new contract/client paths do not log project names, paths, command text, URLs, prompts, tokens, stdout/stderr, daemon bodies, or renderer payload contents.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 39 Implementation

- Added explicit runtime-only focused/visible gxserver session state for the GPUI sidebar bootstrap. Rust now stores a strict `GpuiGxserverPresentationFocusState` alongside the existing active-project snapshot and threads it through `SidebarGxserverBootstrap.focusedSessionId` and `visibleSessionIds`.
- Added a fixed sidebar-only CEF bridge function, `postGxserverPresentationFocusState`, so the GPUI SidebarApp runtime can publish only the gxserver presentation session ids it already owns from create/focus/fork/restore flows. The Rust parser accepts raw local gxserver session ids and existing machine-scoped remote session ids, rejects malformed/oversized payloads, and does not log or persist renderer JSON.
- Updated the TypeScript sidebar runtime to treat local daemon-returned session ids from create session, create agent session, fork, previous-session restore, and worktree agent creation as focused/visible. Remote session focus, remote create/agent/fork/restore, and remote attach actions use the existing `remote:<machine>:session:<project>:<session>` id convention so local and remote ids cannot collide.
- Changed post-load `gxserverBootstrapChanged` handling so focus-only bootstrap updates adjust active/focused/visible state without restarting the local gxserver client or reopening the presentation subscription.
- Updated Rust remote attach open/refocus paths to set the same machine-scoped focused/visible state when the owning terminal tab is known. Shell-only terminal placeholders without a real gxserver presentation session id remain unsupported and are left out instead of guessed from terminal tabs, titles, paths, or layout state.
- Preserved privacy boundaries: no persistent logging was added, and the new focus bridge/bootstrap path carries only ids, not project/session names, paths, commands, prompts, URLs, tokens, stdout/stderr, daemon bodies, or terminal contents.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Worker 40 Implementation

- Audited the remaining scoped-message/editor-target gaps against the shared SidebarApp contract, the Git row, the GPUI sidebar runtime, and the Rust native action bridge.
- Scoped the remaining concrete Git control messages found in the audited surface: `refreshGitState` and non-review `openSidebarGitChangedFile` now carry optional `groupId` / `projectId`, the reusable Git row sends that scope, and the GPUI runtime resolves the owning local or remote gxserver project before reading Git state or opening a changed file. Stale explicit scopes fail honestly instead of falling back to the active local project.
- Confirmed the vague unscoped Git/UI gap is no longer a general remaining item after the scoped refresh/open-file change. The remaining Git/GitHub policy limitation is only the visible PR-agent delete-after case, where gxserver still does not expose a trusted PR-created result for terminal-agent workflows.
- Added fixed GPUI remote Zed/Zeditor project and changed-file opens. Generic remote IDE opens now honor Settings `zed` / `zeditor`, and active-workspace Open In Zed routes through a fixed native action. Rust resolves saved machine settings, live remote gxserver project paths, and changed-file candidates before constructing the documented `zed ssh://[user@]host[:port]/path` CLI target; React never sends remote paths, URI text, SSH details, editor command text, or custom Settings snippets.
- Kept unsupported remote editor targets precise: Cursor, Windsurf, VSCodium, Sublime, and custom remote editor commands remain unsupported because this slice found no equally reviewed fixed native CLI/URI opener contract for those targets. Saved-machine identity-file configs also remain unsupported for remote editor opens because the fixed VS Code and Zed launch forms cannot carry Ghostex-only identity-file behavior safely.
- Preserved remote Finder/open-folder as unsupported. GPUI still does not open remote paths in local Finder or invent a remote file-manager bridge.
- Preserved privacy boundaries: no persistent logging was added, and the new paths do not persist or log hostnames, usernames, project/session names, paths, branch names, command text, URI text, URLs, tokens, stdout/stderr, daemon bodies, clipboard contents, or renderer payload contents.
- Did not run verification commands, builds, tests, app restarts, or `bun run start`, per instruction.

## Blank Sidebar Fix

- Fixed the GPUI sidebar blank page at the CEF bundle boundary. The previous Vite postprocessor inlined entry scripts, but those scripts still depended on emitted chunk imports and, after inlining, their relative specifiers no longer resolved from the HTML file URL. The final CEF HTML now uses Vite output for CSS and an esbuild single-file browser bundle for each CEF entry script.
- Rebuilt final CEF HTML from the source wrapper instead of regex-editing Vite-transformed JavaScript, because generated React code can contain script-tag-shaped strings. The inliner now inserts bundled JavaScript with callback replacements so `$&` tokens inside minified React code cannot reinsert the original script tag.
- Reverted the earlier speculative local hydrate replay change; the blank page was not a SidebarApp message timing issue.
- Kept gxserver endpoint behavior, projection logic, native layout, and sidebar command routing unchanged.
- Ran `bunx vite build --config gpui/vite.config.ts` successfully and rebuilt `gpui/dist/sidebar`.
- Verified the emitted CEF entries have no external script `src`, no `modulepreload`, no relative chunk imports, no raw `</script>` inside the inline script body, and a root element.
- Loaded `gpui/dist/sidebar/index.html` through Playwright from `file://`; the shared sidebar layout rendered with the Projects empty state and no page errors or console messages.
- Did not restart the app or run `bun run start`, per repository instruction.

## GPUI Chat Project Classification Fix

- Ported the macOS sidebar project classification rule into the GPUI gxserver projection adapter. GPUI now reads legacy top-level `isChat` / `isQuick`, gxserver domain `launchSettings.isChat` / `launchSettings.isQuick`, `isRecentProject`, and canonical chat storage roots before calling the shared presentation projection.
- Chat roots now include the macOS roots `~/ghostex/chats` and `~/.ghostex[-variant]/chats`, plus host Ghostex-home roots such as repo-local `.active/chats`, so generated Chat folders do not render as individual GPUI Projects when gxserver lacks local macOS-only project flags.
- Chat and Quick projects now feed the shared synthetic `Chats` group through `chatProjectIds` and overlay flags instead of rendering as normal Projects. Recent projects are passed as hidden project ids so parked rows stay out of active presentation groups.
- Changed automatic active-project fallback so it chooses the first visible non-chat presentation project instead of raw `presentation.projects[0]`, which could select `.active` or another chat folder before projection filtering.
- Preserved explicit chat-session focus by making direct project focus and local session focus activate the synthetic Chats group when the focused target belongs to a chat/quick domain project. This keeps the active-project bridge from publishing chat folders to Rust and avoids the titlebar loop between `.active` and the real code project.
- Settings project rows and Git HUD refresh now treat chat/quick/recent rows as projectless, matching macOS behavior for disposable chat containers.
- Did not run broad verification, app restart, or `bun run start`, per repository instruction.

## GPUI Remote Recent Projects Open Folder Parity

- Updated GPUI Recent Projects `Open Folder` for remote rows to match the macOS sidebar source of truth: the shared SidebarApp still emits `openRecentProjectInFinder`, the GPUI TypeScript bridge converts machine-scoped remote project ids into the fixed native action `copyRemoteProjectOpenFolderCommand`, and Rust resolves the remote gxserver project path immediately before copying a saved-machine SSH command that starts a login shell in that folder.
- GPUI still does not open remote paths in local Finder or add a remote file-manager bridge. The supported remote Recent Projects folder action is command-copy parity, with sanitized toast text and no renderer-provided paths, hosts, tokens, or command snippets.

## Remaining Work

- Local custom project IDE command shell compatibility is a policy non-goal in GPUI project-open actions. Supported custom default editor commands remain native-owned argv-style executable launches only; shell snippets, expansion/placeholders, relative executable paths, and `.app` bundle-directory command strings stay unsupported rather than being run through a shell.
- Opening remote paths in local Finder or through a remote file-manager bridge remains a policy non-goal. Remote Recent Projects `Open Folder` is supported only as the reviewed saved-machine SSH command-copy action.
- Remote editor support is limited to fixed native-owned openers: VS Code / Insiders Remote-SSH and Zed / Zeditor SSH URI. Cursor, Windsurf, VSCodium, Sublime, custom commands, and saved-machine identity-file-only editor opens remain unsupported until each has a deterministic native opener that does not shell Settings text or expose remote paths/URIs to React.
- Visible PR-agent terminal workflows remain intentionally non-delete. Delete-after cleanup is supported only by direct/background gxserver PR creation, because visible agent terminals do not publish a trusted PR-created result to gxserver.
- Scratch Pad and Pinned Prompts have gxserver persistence parity for the current shared UI. Future explicit delete or manual-ordering controls require new shared React messages before GPUI can implement those commands.
- Focus/visibility remains intentionally unsupported for GPUI shell-only terminal tabs or surfaces that do not carry a real gxserver presentation session id.
- Broad verification not run by instruction: no typecheck, unit/UI tests, app restart, or `bun run start` was run. The focused blank-sidebar verification was the GPUI Vite build, emitted-HTML structural check, and direct Playwright `file://` load recorded above.
