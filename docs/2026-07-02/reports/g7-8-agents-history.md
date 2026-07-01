# Report: Groups 7 (Agents) + 8 (History & search) (agent aaa3828cbd8a4fe36)

## Architecture note
GPUI mounts the same production React modal host (gpui/modal-host.html → native/sidebar/modal-host.tsx; vite.config.ts:31). All modals imported (modal-host.tsx:6-19). Modal routing generalized: GpuiAppModalKind (main.rs:1308-1533) incl. AgentsHub/ConfigureAgents/PreviousSessions/DaemonSessions; openable from titlebar Settings-utility menu (42639-46), hotkeys (1549-67), modal-id messages.

## CROSS-CUTTING: GPUI never bundles or starts a local gxserver (med-high)
- Reaches daemon via localhost base-URL + bearer-token bootstrap (main.rs:19261, 20671); gpui/build.rs stages no Web/gxserver/zehn/zmx/bd. macOS starts gxserver from bundle + verifies/restarts when zmx/zehn/bd missing/stale (GxserverClient.swift:494,520,529). If no external daemon: all server-backed features silently empty. (Matches shell report item 1.)

## F1 Agents Hub — WORKING (high)
- Hub = file catalog, 4 tabs configs/hooks/mds/skills (agents-hub-modal.tsx:66-70; shared/agents-hub-catalog.ts). GPUI reimplements catalog scanner natively: GpuiAgentsHubCatalogBuilder (main.rs:49500-50072) scans Claude/Codex/OpenCode/Pi/Cursor/Antigravity-Gemini/Grok. Handlers: requestAgentsHubCatalog/FileContent/save/openInFinder/openInEditor (26423-53). Delivered on open (requires_sidebar_state 1484).
- Work: drift risk between GPUI scanner (roots hardcoded 49681-50069) vs server scanner (agents.rs) — add shared fixture test; verify Monaco loads under CEF file:// (else textarea fallback).

## F2 Configure-Agents + per-agent config — WORKING (high)
- Modal reads hydrated store (configure-agents-modal.tsx:36); posts saveSidebarAgent/deleteSidebarAgent/syncSidebarAgentOrder (88-147); AgentConfigDraft: name/command/icon/acceptAllMode.
- GPUI hydrates hud.agents from /api/readSidebarHud (61656-61); saves handled (26521-23 → handle_gpui_sidebar_agent_metadata_command, parser 59975-60030). Per-project policy wired (23906-53, 24026-50, 63607-20).
- Notes: no env-var field on EITHER side (not a GPUI gap; product confirm). Verify modal list re-renders after save without reopen.

## F3 Agent hook status + completion detection — WORKING (high)
- requestAgentHookStatus→/api/readAgentHookStatus, install/uninstall (26365-403; builder 56354-92). Completion detection server-side (agent_hooks.rs:3217+) → presentation stream → indicators. Works.
- Work: GPUI does ONE batched call (56363-80, 45s timeout); macOS probes per-provider in priority order posting partials (agent-hook-status-source.test.ts:22-60). Implement progressive posting or accept.

## F4 Session attention end-to-end — PARTIAL (med-high)
- Works: detection server-side (session_status.rs); sidebar runtime posts sessionStatusIndicators (gxserver-runtime.ts:1998-2012, payload :8920); Rust edge-detects + banner with rate limits 20s/60s/8 (main.rs:27482-510, candidates 64953-90, delivery 27513-48, GpuiSettingsNotifications.m, click routing main.rs:375); menu-bar indicator (64993+, GpuiMenuBarStatusItem.m); in-sidebar attention chrome shared.
- GAP: completion sound + flash on attention MISSING. macOS plays sound + flash (native-sidebar.tsx playNativeSessionCompletionSound; test :36). GPUI: shared SidebarApp listens for playCompletionSound message (sidebar-app.tsx:1381-1413) but GPUI runtime NEVER emits it on attention transitions; Rust banner sound-nil (27520). Only action/command completion plays sound (20902-03).
- Work: (1) emit playCompletionSound (sessionId + configured sound) from gxserver-runtime.ts on transition into attention; respect completionSound/completionBellEnabled; dedupe by attentionEventId. (2) confirm acknowledgement-on-focus (10580-609) doesn't re-fire.

## F5 First-prompt auto title — PARTIAL (medium)
- Modern path WORKS: server generates/stages (agents.rs:2496-2607, 3217-3423; shouldSendAgentRenameCommand gxserver-protocol.ts:1799); renameCommand renderer command → GPUI handles end-to-end (gxserver-runtime.ts:1446,1475-99 → postWorkspaceTerminalRenameCommand → Rust sends /rename + Return into surface, main.rs:19278-79).
- GAP: legacy presentation-staged Enter-submit path not implemented (shouldSubmitStagedFirstPromptTitleCommand / isGeneratingTitle unhandled; macOS first-prompt-title-submit.ts).
- UNCERTAIN: does current gxserver still use staged-Enter for any agent (notably Claude bare /rename) or always renameCommand? If universal renameCommand, GPUI at parity. Confirm; port if needed. Card spinner renders (shared).

## F6 Previous-sessions browse/search — WORKING (high); Search-by-Text launch intentionally removed
- Modal browse+filter (previous-sessions-modal.tsx, 200ms debounce :374-88; fuzzy previous-session-search.ts). GPUI opens (main.rs:45023-25, menu 42642, hotkey 1558), refresh on open. Data: requestPreviousSessions → /api/listPreviousSessions with includePrevious/limit/query/sessionTags (26596-601, 56865-954).
- zehn/bd/zmx bundled INSIDE gxserver package (Resources/Web/bin/zehn; toolchain.rs:54,130,311) — used by gx f CLI, NOT spawned by either GUI. ghostex-history/ is standalone TUI via CLI only. Both GUIs rely on /api/listPreviousSessions.
- searchPreviousSessionsByText deliberate NO-OP in GPUI (main.rs:26637-42); shared modal no longer renders Search-by-Text launch buttons. If port wants macOS "zehn prompt-content search terminal" capability, needs real current-project terminal-launch path. Confirm product intent.
- Depends on external daemon (cross-cutting).

## F7 Resume previous session — WORKING (high)
- Modal: browse/filter/restore/delete only (617-20, 645), posts restorePreviousSession{historyId}.
- GPUI: 26603-18, 57191-224 → /api/createSession with restoredFromSessionId (surface=workspace, running), removes stopped history row. Same contract as macOS (domain.rs restore-id, storage.rs). Delete wired (57174-89 → /api/removeSession).
- Verify: canonical gxserver:<projectId>:<sessionId> row id always populated by gpui_gxserver_search_result_to_previous_session_item (56983-57017) — rows lacking it silently no-op; confirm restored session actually mounts visible surface.

## F8 Daemon-sessions viewer — PARTIAL (high)
- Viewer + kill actions, NOT attach/adopt (no such control either side; adoption is separate sidebar concern, gxserver-stale-local-sessions-source.test.ts). Posts refreshDaemonSessions/killDaemonSession/killTerminalDaemon/killT3RuntimeSession/killT3RuntimeServer (daemon-sessions-modal.tsx:160,503,542,553,390).
- GPUI opens (menu 42643, hotkey 1559, Resources glyph 43392-429), auto-refresh (21609-71). State from health + /api/readPresentationSnapshot (57262-387, 24367-78). refreshDaemonSessions (26257) + killDaemonSession (26278-98, 57226-59) WORK.
- GAPS: (1) killTerminalDaemon STUB — "GPUI cannot stop the shared Ghostex daemon…yet" (26299-304). (2) killT3RuntimeServer/Session STUBS — no T3 runtime inventory (26305-13); T3 rows likely empty, kill inert. (3) verify daemon session rows rich enough (pid/port/project) (57362-87).

## Status matrix
1 AgentsHub WORKING high | 2 ConfigureAgents WORKING high | 3 hook status WORKING high (batch vs progressive) | 4 attention PARTIAL med-high (no sound/flash) | 5 first-prompt title PARTIAL medium | 6 prev-sessions WORKING high (text-search launch removed) | 7 resume WORKING high | 8 daemon viewer PARTIAL high (daemon/T3 kills stubbed) | local gxserver lifecycle MISSING med-high.

## Confirm-with-user/macOS
- F5 staged-Enter path still live in gxserver?
- F2 env vars never existed as GUI feature.
- F8 attach/adopt = separate sidebar adoption surface, not this modal.
- F6 restore zehn text-search as first-class GPUI capability or leave CLI-only?
