# Report: Groups 9 (Browser) + 10 (Editors/docs) (agent af11bdebf600bbff0)

## 9.1 Core browser panes — WORKING (high)
- BrowserTabModel (main.rs:6436) tabs + BrowserNode split tree + focused_pane/active_tab; splits 6462-83; per-tab BrowserNavigationHistory (6398); drag/reorder (6292, 6447).
- Address normalization matches macOS contract: normalize_address (48490; localhost→http, dotted→https, free text→Google 48511); macOS normalizedProjectEditorBrowserURL (TWV:5833, search fallback :31438). Commit main.rs:19723.
- History = OS NativeMenu Back/Forward dropdowns (673, 6380-84); tab right-click menu (31114). Favicons in tab chrome both sides (6393-95, 28055, 41351; macOS TWV:4834-38, 16215).
- UNSURE: "favicon-on-hover" specific interaction not found either side — spot-check tab-hover close (x)/favicon swap visually.

## 9.2 Browser profiles — PARTIAL (high) — largest G9 gap
- macOS: named user profiles persisted UserDefaults (NativeBrowserProfiles.swift:81-118), last-used (48), picker with New Profile…/Import Browser Data… (129-172); persistent per-profile CEF storage via cache_path (GhostexCEFBridge.mm:797-835); cookie import Chrome/Brave/Edge/Arc/Chromium/Firefox incl. Keychain Safe Storage AES decrypt (NativeBrowserProfiles.swift:353-922, import dialog 1124-1294).
- GPUI: generated-only Default + "Profile N", cap 32, no names (main.rs:546-49, 6301-64); Select/CreateBrowserProfile actions (1169-82); per-tab profile_id (6390). Request context IN-MEMORY only — cache_path deliberately empty, session-cookie persistence disabled (cef/macos.rs:2298-2346, CDXC 2298). Cookies don't survive restart. No import (non-goals CDXC main.rs:6310).
- Work: (1) persistent per-profile cache_path in cef_request_context_for_profile; (2) named profiles + persistence (mirror NativeBrowserProfileStore); (3) port New Profile…/Import Browser Data… + import dialog + cookie readers + Keychain decrypt (~940 lines Swift).

## 9.3 DevTools — WORKING (high). GPUI ToggleBrowserDevTools (1139, toolbar 43729, on_action 45210) → real host.show_dev_tools (cef/macos.rs:2256-67). macOS uses CDP remote frontend window (CEFBridge.mm:2292-2329) — cosmetic difference, no work.

## 9.4 Annotations/Agentation — WORKING (high, near-parity)
- Both inject agentation@3.0.2/React 18.2 into live CEF main frame, Settings-selectable, github.com disabled. macOS NativeBrowserReactGrab.swift:108-284; gpui BrowserFeedbackTool{Agentation,ReactGrab} (7897-7920), URLs 616-26, script 48212-360, toolbar 28137, settings 28145, github gate 43476/28146.
- Low work: diff injected script for version drift.

## 9.5 Browser-use — PARTIAL (high)
- = ghostex-browser-use skill driving CEF over CDP via ghostex browser mcp CLI (bundled in both apps).
- CDP exposure WORKING both: macOS port scan 9333-9343 (CEFBridge.mm:212-222, 2434-35); gpui default 9334 (cef/macos.rs:466, 2349-55) — inside macOS scan range. Minor: env var names differ (GHOSTEX_CEF_REMOTE_DEBUGGING_PORT vs GHOSTEX_GPUI_CEF_REMOTE_DEBUGGING_PORT).
- MISSING: ghostex browser open → renderer commands openBrowser/openBrowserPane (ghostex-cli.mjs:173-74, 1652-63); macOS executes (native-sidebar.tsx:34613, 46073-85, 50771); GPUI renderer handler supports only focusSession/renameCommand/runCommand/clickButton, THROWS "Unsupported renderer command" (gxserver-runtime.ts:1456-1517). Skill step 1 fails; only CDP control of already-open pane works.
- Work: (1) add openBrowser/openBrowserPane to handleGxserverRendererCommand incl. reuse semantics (--reuse exact/--new/--project-*); (2) align CDP env-var name.

## 9.6 Downloads/permissions/popups — MIXED
- Popups WORKING (high): both intercept popup → shell tab model (gpui cef/macos.rs:1855-87, 179-204, wired main.rs:21124-38; macOS CEFBridge.mm:2215-70).
- Permission prompts MISSING in gpui (med): macOS OnShowPermissionPrompt grants clipboard for trusted origin (code-server), denies others (CEFBridge.mm:1029-91, 2273-89, helper 1151). gpui has NO permission handler → code-server clipboard prompts may misbehave. Work: add CEF permission handler.
- Downloads: NEITHER implements CefDownloadHandler — parity (no download support both sides). Flag only if product wants it.

## 10.7 code-server — WORKING launch/settings, PARTIAL idle-sleep
- SourceCodeServerRuntimeOwner real: main.rs:2642-99, ensure (19798), bg start (19856), 127.0.0.1:3777 (2479-92), health+grace (2694, 62338), Node resolution (62074-111), storage prep (62030-41).
- Settings seed parity: Dark 2026 theme only-when-absent (62043-71) mirrors NativeCodeServerUserSettings.swift:12-43. Settings-restart flow (19940, invoked 20660) mirrors macOS debounced restart.
- GAP (med): idle-sleep doesn't stop process. macOS stops code-server when EVERY editor asleep (native-sidebar.tsx:43143-54, called from all sleep paths). gpui only hides CEF surface (main.rs:2067, 20465); stop only on drop/relaunch/settings-restart (19507/19847/19950). Work: stop when all Source surfaces asleep.
- Note: macOS launcher lives in NativeT3CodePaneReproLog.swift as NativeCodeServerRuntimeLauncher.

## 10.8 t3code — PARTIAL (high)
- Session binding/launch WORKS: durable gxserver T3 row + draft/thread URL loaded via Browser CEF (gpui_create_local_t3_session main.rs:53028, metadata 53012/53184-208, URL 53202-03/53615-46, provider "t3code" 53359/53413); focus/create bridge (gxserver-runtime.ts:175-76, 2514-94; main.rs:2168-74, 26806/26932-63). Matches macOS model (NativeT3RuntimeLauncher, NativeT3CodePaneReproLog.swift:1316+, 1799/1833).
- MISSING (high): local T3 runtime authority — macOS launches/owns packaged local T3 server (port binding, ownership, health, process-tree teardown; NativeT3CodePaneReproLog.swift:150-705, 1316-1460, terminate 427-479). gpui killT3RuntimeServer/Session no-ops (26305-13); relies on externally-running runtime. DECIDE: gxserver-rs owns T3 runtime (server.rs T3 settings sync 6335-6464, no launcher found) vs port launcher to gpui.
- MISSING (high): t3BrowserAccess + t3ThreadId modal wiring — modals in shared modal-host (29-30, 97-98, 3176-93); macOS triggers (AD:16197-98, 17763-66); gpui has NO showT3BrowserAccess/showT3ThreadId trigger. Work: wire via app-modal-host bridge + submit callbacks.
- Hibernation tied to runtime-authority gap.

## 10.9 Docs/meo editor — PARTIAL (med/high)
- meo is imported by Manage app (native/sidebar/manage.tsx:97); gpui bundles same manage.tsx (gpui/sidebar/manage-main.tsx) + mounts Manage CEF surface (slot key main.rs:2499). Editor renders in gpui BUT bridge incomplete:
- gpui ghostexManageFiles bridge supports only list/read/save (project-workarea-cef-bridge.ts:62-64 → main.rs:62408-66). macOS ManageFilesBridge: list/read/save/rename/duplicate/delete/createFolder/move (TWV:11382-478).
- MISSING: (1) gitBaseline in read/save responses (macOS TWV:411-28, 11831) → meo git diff gutter/overview ruler DEAD in gpui (meo/editor.ts:20-26, 1434-35, gitDiffCore.ts). (2) rename/duplicate/delete/createFolder/move → "Unsupported Manage file action." (main.rs:62464). (3) verify Docs-folder scoping allowlist (macOS TWV:11570-91, 11925-86) + .excalidraw acceptance.
- Work: add gitBaseline (bounded HEAD ≤1MB, sanitized); implement file ops; confirm scoping.

## 10.10 Surface kinds — macOS vs gpui
- macOS families (ghostex-settings.ts:838-46; native-sidebar.tsx:454): agent, browser, code-editor, git-editor, project-editor (tasks/manage/automate), companion.
- gpui TitlebarMode (main.rs:1647-54): Agents, Source, Browser, Kanban, Manage. Switch actions same five (935-39).
- MISSING: (1) git-editor surface — macOS "git" mode = Browser-backed surface seeded with project GitHub remote (openProjectGitEditorSurface native-sidebar.tsx:43730; paneKind projectEditorGit TWV:5453; restore browserTabs 12009-18) + own auto-sleep family. gpui folds into Browser (main.rs:16960), no mode, no autoSleepGitEditor family (6703-06). (2) automate surface — macOS ProjectEditorSurfaceMode "automate" (native-sidebar.tsx:454, 1968, 1994; engine shared). No gpui mode; daemon engine shared but no pane.
- Companion: gpui has concept (ShellFocusTarget 6486) — verify separately.

## Severity summary
1. 9.2 profiles persistence + import (large port)
2. 9.5 browser-use openBrowser/openBrowserPane renderer commands
3. 10.8 T3 runtime authority + modals
4. 10.9 meo bridge (gitBaseline, file ops)
5. 10.10 git-editor + automate surfaces
6. 10.7 code-server idle-stop
7. 9.6 CEF permission handler

Unsure: favicon-on-hover exact interaction; T3 runtime ownership intent (gxserver vs app); Manage list scoping parity.
