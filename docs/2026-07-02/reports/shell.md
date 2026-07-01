# Report: Cross-cutting app shell & lifecycle (agent a36566daff38b9170)

Paths: macOS = native/macos/ghostexHost/Sources/ghostexHost/ (AppDelegate.swift=AD, TerminalWorkspaceView.swift=TWV, GxserverClient.swift=GC); GPUI = gpui/src/main.rs (M); titlebar React = native/sidebar/titlebar-host.tsx (TSX).

Overarching: GPUI shell is a single-window CEF host assuming an already-running, protocol-matched gxserver and a clean environment. Real workspace-layout persistence and most titlebar chrome exist, but the "app-as-daemon-owner / OS-integrated / self-diagnosing" layer from AppDelegate is missing.

## 1. App startup + gxserver spawn/handshake — MISSING (high) — most severe
- macOS: window creation gated on daemon bootstrap. applicationDidFinishLaunching (AD:1109) → startGxserverBootstrapThenCreateWindow (AD:1135, def AD:3615) awaits gxserverClient.startOrReuse() (GC:174) before makeWindow (AD:3625). Client spawns bundled daemon (launchGxserverForeground GC:604, resolveGxserverLaunchPlan GC:755/846, port 58744). Handshake authenticatedHealthStatus (GC:444): product, protocolVersion (GC:462 → "protocol mismatch. Update Ghostex and gxserver…"), buildIdentity reuse decision (GC:473, 504), bundled-tool availability zmx/zehn/bd (GC:525 → toolchainUnavailable). On mismatch restarts daemon from current bundle. Daemon survives app quit (AD:1201).
- GPUI: fn main() (M:45906) cef::prepare_application → open one window → initialize_cef. No daemon spawn, no handshake, no gating. Lazily reads token (read_gpui_gxserver_auth_token), hits /api/health/server on demand; failure = "gxserver is not reachable on 127.0.0.1:58744." (M:63074). Protocol mismatch flattened to generic invalid-RPC error (M:63030–63041). GPUI_GXSERVER_PROTOCOL_VERSION = 1 (M:48590). Sidebar bootstrap polls token (refresh_sidebar_gxserver_bootstrap_if_changed M:20665). Only remote-SSH install path exists (gpui_install_bundled_remote_gxserver_and_read_token M:52001).
- Work items: launch bootstrap ensuring local daemon (locate/launch bundled gxserver or reuse) before workspace surfaces; version/build/toolchain handshake with restart-on-mismatch semantics; honest daemon-down/protocol-mismatch UI at startup; preserve "quit never stops daemon".

## 2. Window state persistence — PARTIAL (high)
- macOS: persistMainWindowChrome (AD:3340, store AD:6370); restore restoredInitialWindowFrame (AD:3185)/readMainWindowChrome (AD:6342), multi-monitor aware (screen id + relative origin, nearest-display fallback, min-size clamp AD:3205–3230). Sidebar width in settings.json (AD:6136/6302, restore AD:6941). Pane/tab/split layout owned by React sidebar localStorage + native mirror (AD:1195).
- GPUI: persists sidebar width (M:43983, read M:19526) and full workspace shell-state JSON at ~/.ghostex/state/gpui-workspace-shell-state.json (M:67375): activeMode, shellFocus, tab/split tree (M:13400), browser tabs/profiles, command pane, project editor; versioned (M:70), restore + legacy migration (M:13131, gating M:13190). BUT window always opens centered fixed 1280x820 (M:45936) — frame/position/display not persisted.
- Work items: persist window bounds + screen id, restore with multi-monitor logic (AD:3205–3260).

## 3. Multi-window — WORKING/parity (high). Neither supports multiple main windows. macOS single window (AD:992); cmd+n = browser pane/createSession (AD:6026/6088). GPUI cx.open_window once (M:45954); modals separate windows (M:21627). See item 5 for reopen gap.

## 4. Titlebar + native menu bar — PARTIAL; two severe sub-gaps
- Native app menu bar MISSING (high): macOS installMainMenu (AD:2533): App(About/Check for Updates/Settings/Services/Hide/Quit), File→Close Pane ⌘W (AD:2604), Edit undo/redo/cut/copy/paste/selectAll (AD:2623), View (AD:2656), Window→Minimize/Zoom/BringAllToFront (AD:2663), Help. GPUI: no cx.set_menus anywhere; NativeMenu uses are titlebar popovers only.
- Update-download slot MISSING (high): TSX TitlebarUpdateProgressRing, updateAvailable/Downloading/Progress, showUpdateDialogFromTitlebar (TSX:342–436); Sparkle (AD:1023–1046, 15-min probes AD:470). GPUI: no Sparkle/auto-update at all.
- Mode switcher PARTIAL/med: gpui titlebar_mode_switcher_items (M:2436), centered tabs (M:35928). TSX modes agents|code|git|automate|tasks|manage (TSX:128) vs gpui Agents/Source/Browser/Kanban/Manage — verify mode set.
- Open In WORKING/med (M:42657/42635, launch M:49131). Resources PARTIAL/high: glyph only opens daemonSessions modal; deferred "process CPU/RAM sampling, Portless rows, resource bundles, restart controls, bulk quit/sleep" (M:43391). Tips WORKING/high (M:552/605). Keep Awake WORKING/high (M:1584, caffeinate M:49428, GpuiLidSleepHelperClient.m).
- Rename/session title PARTIAL/med: passive project label (M:27987); rename via modals (M:1320, M:1224); titlebar not editable like updateAppTitlebarTitle (AD:3603).
- Traffic light/zoom PARTIAL/med: macOS manual positioning + observers (AD:954–960, AD:1004), Zoom via Window menu. gpui traffic_light_position 9,9 + appears_transparent (M:45939–45942), no Zoom item.
- Work items: cx.set_menus app menu bar; auto-update + titlebar slot; full Resources dropdown; editable titlebar session title; Window→Zoom.

## 5. Quit/close — PARTIAL (med)
- macOS: applicationShouldTerminate (AD:1218) delays to flush CEF cookies (GhostexCEFFlushBrowserState, AD:1219–1242); willTerminate (AD:1170) persists window+chrome, stops code-server, restores lid sleep, does NOT stop gxserver (AD:1201). ShouldTerminateAfterLastWindowClosed=true (AD:2208). No confirm-quit dialog (sessions live in daemon). No dock menu/reopen handler.
- GPUI: no shouldTerminate equivalent; cef::shutdown after run loop (M:45966). No pre-quit CEF cookie flush (browser auth loss risk). No explicit will-terminate flush. No dock-reopen → closing the one window leaves app running windowless.
- Work items: pre-terminate CEF browser-state flush; will-terminate persistence flush; reopen handling or quit-on-last-window-close.

## 6. Appearance/theming — WORKING/parity (med). Both dark-first. macOS workspace bg from Ghostty config background (AD:2963), accent only on NSAlert (AD:858/897). GPUI fixed workspace_background_color, .appearance(false) (M:43281/43664); menu-bar shim honors dark/light (GpuiMenuBarStatusItem.m:63–71). Minor work item: derive GPUI workspace bg from Ghostty config background.

## 7. Layout engine — sidebar WORKING (high); pane dividers PARTIAL (med)
- Sidebar divider parity good: macOS min/max 520 (TWV:6695), default 235 (TWV:6739), workspace min 240, double-click reset (AD:6221). GPUI 5px rail, clamp 150..520 preserve 240 (M:44788, drag M:43959, reset M:43987, persist M:43983). Note default-width difference (235 vs setting).
- Pane dividers: macOS real sibling rails (TWV:2870/9197), splitDividerWidth (TWV:14025), 1px #1e1e1e, divider double-click reset (TWV:15379). GPUI prepaint slot/canvas-probe with drag handles; split-tree render/persist present; NOT confirmed: min-size clamps + per-divider double-click reset.
- Work items: verify/add pane-split min-size clamps + per-divider double-click reset; align default sidebar width.

## 8. Session-restore at shell level — PARTIAL (med)
- macOS: sidebar owns layout restore (localStorage paneLayout); native performs terminal recreation reattaching zmx/gxserver sessions live in same panes/tabs (AD:1779 comment, workspace-restore-debug.log AD:1785).
- GPUI: restores structure from own shell-state JSON (M:13400) but restored terminals are placeholders (RestoredUnmounted/RestoredPlaceholder M:7962–8072, "Materialize" action); live reattach depends on user activation. Ownership divergence: GPUI layout in gpui-workspace-shell-state.json vs macOS sidebar localStorage.
- Work items: on startup reconcile restored tabs vs live gxserver presentation sessions and auto-materialize selected/visible ones.
- Uncertainty: macOS auto-reattach aggressiveness inferred from comments (medium confidence).

## 9. External event routing — MISSING (high)
- macOS: application(_:open urls:) (AD:1146) → handleOSIntegrationURL (AD:4798): ghostex://terminal?command&cwd&title → quick terminal; ghostex://open|edit?path&line&column → openPaths. openFiles (AD:1160/1165/1149) → dispatchOSIntegrationFileOpenPaths (AD:4839); .command/.tool/.sh prompt Run/Edit/Cancel (AD:4859). CFBundleURLSchemes ghostex (AD:5107).
- GPUI: no incoming URL/file-open/Apple-Event/dock-menu handling. Only reads default handler status (M:57930, LSCopyDefaultHandlerForURLScheme M:58100) and sets LS defaults from Settings (M:57515) — can register but can't handle.
- Work items: AppKit open-urls/open-files delegate via .m shim routing ghostex://terminal + ghostex://open|edit + Finder Open With; port .command/.tool/.sh Run/Edit dialog; optional dock menu.

## 10. Crash handling + support-bundle logging — MISSING (high)
- macOS: ~/.ghostex/logs via GhostexAppStorage.logsDirectory: native-host lifecycle log (appendNativeHostLifecycleLog, AD:1250–1272) + named debug logs (native-ghostty-config, session-title-sync-debug, agent-detection-debug, workspace-restore-debug, sidebar-collapse-state-debug, project-board-debug — AD:1643–1924), retention (AD:1115).
- GPUI: essentially none. No ~/.ghostex/logs writes, no panic hook, no support bundle. Only state JSON ~/.ghostex/state + images ~/.ghostex/i (M:67375, M:8527). Panics lost to stderr.
- Work items: std::panic::set_hook writing crash reports to ~/.ghostex/logs; lifecycle + support-bundle logging with retention matching macOS conventions.

## Severity roll-up (worst first)
1. no daemon spawn/handshake at startup
2. no OS URL/file-open routing
3. no crash/support logging
4. no app menu bar; no updates; Resources partial
5. restore = placeholders not live reattach
6. window frame not persisted
7. no pre-quit CEF flush / reopen
8. verify pane-split clamps/reset
9. workspace bg from Ghostty config (minor)
10. multi-window: parity, none.

Uncertainties: (a) macOS live-reattach aggressiveness (TWV pipeline untraced); (b) GPUI window resizable/zoomable/fullscreen intent (M:45937); (c) full macOS Resources dropdown inventory (from GPUI deferral comment only).
