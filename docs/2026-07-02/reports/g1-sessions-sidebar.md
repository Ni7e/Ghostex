# Report: Group 1 — Core session lifecycle & sidebar (agent a3bb46c3d8a9a7a0c)

## Architecture ground truth
- GPUI sidebar mounts the same shared SidebarApp (gpui/sidebar/main.tsx:25) fed by createGpuiSidebarRuntime() in gpui/sidebar/gxserver-runtime.ts.
- Every React→host message goes through one switch at gpui/sidebar/gxserver-runtime.ts:2156-2453. Unhandled types → handleUnsupportedSidebarMessage — SILENT NO-OP (gxserver-runtime.ts:8008). This is the single most important gap detector.
- Native CEF bridge = fixed 18-function allowlist (gpui/src/cef/sidebar_bridge_manifest.rs:158): focus/create/rename/lifecycle/status hooks only — no group, no project-add, no clone functions.
- gxserver-rs has ZERO group APIs (server.rs route table). Groups are client-side (shared/simple-grouped-session-workspace-state.ts), consumed by macOS (native/sidebar/native-sidebar.tsx:46275+) but NOT by GPUI runtime, which derives groups from gxserver projects (gxserver-runtime.ts:2037 createSidebarGroups).

## F3 Session fork — WORKING (high). forkSession :2226 → :3136 → /api/forkSession :3173, focuses forked. No gaps.

## F1 Session create — WORKING (high)
- createSession :2170 → :2599 → /api/createSession; createSessionInGroup :2173; runSidebarAgent :2176 → createAgentSession() :2645 → /api/createAgentSession with launchSettings{agentCommand,icon}+title :2695-2704; agent resolved via resolveSidebarAgent :2684. Agent CRUD wired: saveSidebarAgent/deleteSidebarAgent/syncSidebarAgentOrder :2432-2440.
- Minor no-ops: createChat, createFullWidthTerminalPane not in switch. T3 create via dedicated bridge (postT3SessionCreate :2582).
- Work: implement createChat handler if needed; createFullWidthTerminalPane if exposed.

## F9 Session rename — WORKING (high). renameSession :2229 → :3184 → /api/requestSessionRename :3200. Modal is in-webview React (sortable-session-card.tsx:1258); double-click inline rename client-side. showSessionRenameModal handled (sidebar-app.tsx:1506). promptRenameSession unused. No gaps.

## F7 Visible-session slots — WORKING (high). Pure client-side (sidebar-visible-session-slots.ts); feeds focusSession (handled) + setSessionsSleeping (:2213). Hotkeys wired from Rust: main.rs:26208 nativeHotkey focusSessionSlot1..9, :26220 gpuiProjectSlotHotkey jumpToProject1..9; handled sidebar-app.tsx:1371,1376. setVisibleCount/setViewMode not posted in shared sidebar/ (macOS-only grid) — not a gap. No gaps.

## F10 Per-session search overlay — WORKING, one minor gap (high)
- Overlay client-side (sidebar-session-search.ts, overlay tsx); Cmd+P opens (sidebar-app.tsx:3498); select → focusSession. requestPreviousSessions :2252 → /api/listPreviousSessions :3272.
- GAP: searchPreviousSessionsByText (sidebar-app.tsx:3977) NOT in switch → server-side history text search no-op. Work: wire → gxserver /api/searchSessions (endpoint exists).

## F5 Session cards — PARTIAL (high)
- Working: lifecycle/activity display (free via gxserver; contract shared/session-grid-contract-sidebar.ts:260,272,780; SessionStatusIndicators bridge in manifest). Tags/pinned/favorite: setSessionTag :2238, setSessionPinned :2244, setSessionFavorite :2232 → /api/updateSession (:3230). Working actions: closeSession(s), setSessionSleeping/setSessionsSleeping/setGroupSleeping, focusSession/focusGroup/focusSessionMode, forkSession, renameSession, runSidebarAgent, copyAttachCommand/copyResumeCommand.
- MISSING (posted by React, no-op in GPUI): copySessionDetails; fullReloadSession; toggleCloseAfterDone; closeInactiveProjectSessions; sleepInactiveProjectSessions; wakeProjectSleepingSessions; popOutPane; restartSession (trigger site unclear).
- Work: handlers for copySessionDetails, fullReloadSession (→ gxserver reload/fullReloadProjectZmxSessions), toggleCloseAfterDone, 3 project-bulk actions; decide popOutPane/restartSession scope.

## F6 DnD reorder — PARTIAL (high)
- Intra-group reorder WORKING: syncSessionOrder :2249 → /api/updateSessionOrder :3256 (posted sidebar-app.tsx:3336,3437,3453).
- MISSING: moveSessionToGroup (posted :3403) no-op; syncGroupOrder (posted :3224) no-op. Blocked by absent group model (F4).

## F8 Project switching / recents / add-repo — PARTIAL (high)
- Working: focusGroup :2456 → focusProjectId :2472-2474. Recents free via gxserver: restoreRecentProject :2310, removeRecentProject :2313, copyRecentProjectPath :2316, openRecentProjectInFinder :2326 (NativeProjectPathAction bridge :2324,2338); /api/listRecentProjects; removeProject :2307.
- ADD-REPOSITORY MISSING (high severity — no way to add a local project in GPUI): pickWorkspaceFolder (posted sidebar-app.tsx:3877, "+ Add project" onAddProject :4165) no-op. No NSOpenPanel/folder-picker in GPUI Rust; main.rs:22427 /api/addProjectPath is remote-machine only. Clone flow all no-op: cloneRepository, previewRepositoryClone, cancelRepositoryClone, browseRemoteProjectDirectories, addRemoteProjectPath (gxserver has /api/startRepositoryClone, /api/previewRepositoryClone, /api/browseProjectDirectories — server side free).
- Work: (1) native folder-picker for pickWorkspaceFolder (Rust/.m shim + bridge fn) → /api/addProjectPath locally; (2) wire clone messages → gxserver clone endpoints; browseRemoteProjectDirectories → /api/browseProjectDirectories; (3) addRemoteProjectPath for remote add-repo modal.

## F4 Grouped workspace state — MISSING (high) — most severe structural gap
- GPUI groups derived from gxserver projects (gxserver-runtime.ts:2037), ONE group per project. No user-defined multi-group model.
- macOS: shared/simple-grouped-session-workspace-state.ts + native-sidebar.tsx (createGroup :46275, createGroupFromSession :46280, renameGroup :46352, closeGroup :46635, moveSessionToGroup :46845, syncGroupOrder :46886), persists project.workspace.groups client-side. gxserver has no group storage.
- GPUI no-ops: createGroup, createGroupFromSession, renameGroup (posted session-group-section.tsx:1317), closeGroup (posted :1437,2893), moveSessionToGroup, syncGroupOrder, fullReloadGroup.
- Collapse/expand WORKING (client-side localStorage, group-collapse.ts). setGroupSleeping WORKING :2215.
- Work: (1) DECIDE: adopt shared simple-grouped-session-workspace-state + client-side persistence (mirror macOS) vs drop sub-project named groups; (2) if adopting, wire all group messages + persistence, make createSidebarGroups respect user groups; (3) until then suppress dead group affordances.
- Uncertainty: do group rename/close/new-group controls render in GPUI (dead-but-visible)? Check session-group-section.tsx gating.

## F2 Session restore on restart — WORKING/PARTIAL (medium)
- Persistence free via gxserver: zmx-backed, SQLite zmxName/providerState (gxserver-rs/src/domain.rs:1469,1593,2242+).
- Cards restore WORKING via /api/readPresentationSnapshot.
- Layout restore: GPUI persists shell state (main.rs:13386, :13148) scoped to placeholder layout only — tab/split ids, NOT session/project ids (CDXC main.rs:13170).
- Terminal reattach: full startup launch-plan pipeline exists (derive_agents_terminal_startup_launch_plans :3944, sync_startup_launch_plans :3582, apply_startup_result :3831, parked-owner reattach :2915/3013), resumes via daemon-built attach command → ghostty. BUT restored sessions = "restored presentation-only Mounting" placeholders that do NOT auto-mount; materialize on explicit activation (main.rs:9230 + CDXC note). GPUI does not call readAgentLaunchPlan/readAgentResumePlan for local restore (only remote Copy Resume main.rs:53907); macOS does (native/sidebar/gxserver-client.ts:535-559, native-sidebar.tsx:34694).
- UNCERTAINTY: does macOS eagerly re-mount all previously-open terminals at launch? If yes, GPUI lazy restore is a real gap. Main thing to verify.
- Work (conditional): auto-materialize previously-visible sessions on startup.

## Cross-cutting no-op message inventory (GPUI runtime silently drops):
createGroup, createGroupFromSession, renameGroup, closeGroup, moveSessionToGroup, syncGroupOrder, fullReloadGroup, fullReloadSession, fullReloadProjectZmxSessions, restartSession, copySessionDetails, toggleCloseAfterDone, closeInactiveProjectSessions, sleepInactiveProjectSessions, wakeProjectSleepingSessions, popOutPane, pickWorkspaceFolder, cloneRepository, previewRepositoryClone, cancelRepositoryClone, browseRemoteProjectDirectories, addRemoteProjectPath, searchPreviousSessionsByText, createChat, createFullWidthTerminalPane (plus browser/git/settings/automation types outside G1).

## Unverified
1. macOS startup eagerness (F2) — eager remount vs lazy.
2. Group affordance rendering in GPUI (F4) — dead-but-visible controls?
3. restartSession trigger site (F5).
