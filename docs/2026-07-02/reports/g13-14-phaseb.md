# Report: Groups 13 (remote/portless), 14 (OS integration), Phase B 15–18 (agent adcb50f74a4f411af)

## Key architectural finding
GPUI reuses the SAME shared React sidebar + modal host + titlebar host via CEF (gpui/sidebar/main.tsx:3 imports ../../sidebar/sidebar-app; gpui/vite.config.ts:25 builds modal-host.html from native/sidebar/modal-host.tsx; :26 titlebar-host from native/sidebar/titlebar-host.tsx). React UI for every modal already exists in the GPUI build — gaps are in the native Rust/ObjC host that must OPEN modals and back bridges. Both apps share the same gxserver daemon (~/.ghostex/gxserver; ghostex-cli.mjs:58; portless main.rs:58532); gxserver-rs/src/portless.rs (6324 lines) shared, not ported.

## 13.1 Remote gxserver install/multi-server — WORKING (high)
- Multi-server real: remote_gxserver_connections HashMap keyed by machine id (main.rs:19218); per-conn SSH tunnel (struct :1604 child/local_port/token); stop_all (:19509).
- Full connect+install: gpui_connect_remote_gxserver_platform (main.rs:51807): token read → exit 127+approval → probe OS/CPU → select bundled package → scp → install → re-read token → Keychain → checked localhost tunnel. Package selection :52075, arch/ELF :52140/:52155, install script :52278, scp :52461. Settings reconnect/install-approval + modal :22141, open modal :22274, sidebar RPC bridge :22958, presentation stream :23809, SSH-password Keychain :21990. Remote machine status → shared sidebar :24229.
- macOS mirror: RemoteGxserverClient.swift connect :105, connectSynchronously :251, installBundledGxserverAndReadToken :537, openTunnel :871, subscribePresentation :971.
- Minor gap: prebuilt Linux packages must exist at build/remote-gxserver-linux/{x64,arm64}/package (build-macos-app.sh:234 validates). Ensure CI produces both.

## 13.2 Portless — PARTIAL (high)
- Working: admin client ported: gpui_run_portless_admin_action (main.rs:58361 → :58409) writes root script, osascript admin privileges (:58723), sh.portless.proxy LaunchDaemon (:58647), runtime from packaged Web/code-server/lib/node + Web/portless/dist/cli.js (:58480; build validates :130). Matches PortlessAdminClient.swift (:117/:229/:307). Settings→daemon sync :24851, /api/updatePortlessState fan-out, runPortlessSettingsAdminAction :26515.
- GAPS: (1) Portless setup modal NOT wired — GpuiAppModalKind has no portlessSetup/"n" entry (main.rs:1330-1352); modal id "n" registered in modal-host.tsx; macOS opens as portlessSetup (AD:16193). Add kind+sizing+open path. (2) First-launch Portless prompt missing — postponePortlessSetupPrompt/cancelPortlessSetupPrompt stubbed to sidebar refresh only (main.rs:26643-26645); port prompt-surfacing (macOS activePortlessSetupPromptMode).

## 13.3 Remote project picker + attach — WORKING (high)
- Picker modal in enum (main.rs:1327, opened :17482); dir browse/add via sidebar RPC bridge. remote_attach_sessions (:19233), attach terminal launch (:23525, focus-existing :23503), SSH attach/resume/folder cmd Rust-owned (:23233/:23263/:23358), machine-scoped bridge for copy-path/PR/IDE/recents (:27882). macOS parity AD:13354/:17482. No material gaps.

## 14.4 Keep-awake — WORKING (high) end-to-end
- Titlebar → duration menu (:41822) → start period (:41896) → runtime (:42023) → caffeinate spawn (:42055, allow-display-sleep). Working-session auto-hold 20-min grace (:42293/:42391), power-rule ticker (:42441–:42564), visibility gating (:42585). Shared React titlebar-keep-awake-source.
- Minor: keepAwakeDeactivateOnUserSwitch parsed but no-op (:42306) — confirm macOS behavior; port if concrete.

## 14.5 Lid-sleep helper — WORKING (high)
- GpuiLidSleepHelperClient.m installs via same root installer contract (/usr/bin/install + plist + LaunchDaemon via osascript admin, :104–:170), privileged XPC (:231), first-enable-installs (:287, gate :290). Build compiles REAL Swift helper from native sources, stages into Contents/Library/LaunchServices (build-macos-app.sh:165, staged :220). Rust lease/heartbeat/disable (main.rs:42082/:42148). macOS parity LidSleepPrivilegedHelperClient.swift:30/:131.
- Verify only: XPC designated requirement derived from bundle id (GpuiLidSleepHelperClient.m:27 fallback com.madda.ghostex.gpui) — signing identity must match (helper main.swift:174 isValidClientCode).

## 14.6 Open-with targets — WORKING (high)
- show_gpui_open_targets_menu (main.rs:42650), open_active_project_with_open_target (:43118), visible targets from settings (:48928), gpui_launch_open_target (:49129): open -a for apps, /usr/bin/env argv for commands, Finder/Open-Folder fixed opener (:49445/:49464). OpenTargets modal in enum. Catalog shared workspace-open-targets.ts. No gaps.

## 14.7 Accessibility display options — WORKING/AHEAD (med)
- GpuiAccessibilityDisplayOptions.m mirrors Reduce Motion (NSWorkspace.accessibilityDisplayShouldReduceMotion :24 + change monitor :65), gates pet overlay animation (main.rs:387, :19469, :44528).
- No macOS counterpart found (PetOverlayController.swift animates without gate) — appears GPUI-only enhancement. Confirm before treating as parity work.

## B.8 First-launch/discover/tips/video — PARTIAL (med)
- Present: FirstLaunchSetup + tipsAndTricks + WatchGhostexVideo modal kinds (main.rs:1324/:1325), opened from Tips panel (openWorkspaceWelcome :26034, openGhostexTutorialVideo :26042), tips project-state wiring (:21458/:21499). Shared React in build. Manual access works.
- GAPS: (1) discoverGhostex modal absent from GpuiAppModalKind (main.rs:1330-1352); macOS first-class (AD:11624/:11700/:11805). (2) No automatic first-run sequence — macOS auto-opens Highlighted Features → firstLaunchSetup (AD:6809/:11621/:11822-28); GPUI has no first-run detection/persistence. Add flag + auto-open chain.

## B.9 Sparkle/auto-update — MISSING (high)
- No Sparkle framework/keys/driver; build script ad-hoc signs only (codesign --force --deep --sign - , build-macos-app.sh:590); no SUFeedURL/SUPublicEDKey/appcast/notarization/hardened-runtime/DevID. build.rs compiles 7 Gpui*.m shims only. Version hardcoded 0.1.0 (:527).
- No backend for showUpdateDialogFromTitlebar/checkForUpdate/downloadUpdate in main.rs. Shared titlebar renders update state (titlebar-host.tsx:342/:436) → titlebar update button DEAD in GPUI.
- Work: integrate Sparkle (framework + Info.plist + user driver), DevID sign + notarize + staple, GPUI appcast (extend release-ghostex.mjs/appcast.xml for com.madda.ghostex.gpui + real versioning), back the update commands so titlebar button + updateDownloadProgress work.

## B.10 CLI entry points — PARTIAL (med)
- Working: build stages CLI (build-macos-app.sh:109 ghostex-cli.mjs + launcher + skills). Most commands via gxserver 127.0.0.1:58744 (~/.ghostex/gxserver) — app-agnostic. ghostex:// registered in GPUI Info.plist (:515); OS-integration status/set implemented (main.rs:57515/:57821/:57930).
- GAPS: (1) native CLI bridge NOT served: CLI uses port 58743 prod/58742 dev + bridge-token (ghostex-cli.mjs:16/:57/:3339); macOS serves + writes token (AD:3751/:3837/:3857); GPUI binds nothing, writes no token → EDITOR-facing/legacy automation commands fail. Implement bridge server + token, or reroute via gxserver. (2) App activation wrong: osascript 'tell application "Ghostex" to activate' (ghostex-cli.mjs:3890); GPUI CFBundleName "Ghostex GPUI" (:524). Parameterize/bundle-id activation. (3) No runtime ghostex:// handler (also in shell report).
- Uncertainty: exact audit of which CLI commands still need native bridge (:3339/:5837).

## B.11 Logging/crash — MISSING (med-high)
- macOS: many *DebugLog.swift writers under ~/.ghostex/logs (RemoteGxserverInstallDebugLog, SidebarRefreshDebugLog, TerminalFocusDebugLog, NativeBrowserImportDebugLog) + os.log. AGENTS.md mandates ~/.ghostex/logs.
- GPUI: no persistent log writer, no panic hook, no catch_unwind, no ~/.ghostex/logs writes (only do-not-log invariants). Only daemon-owned gxserver.jsonl exists.
- Work: sanitized size-capped writer under ~/.ghostex/logs for GPUI flows; std::panic hook → crash records; writer-boundary tests per AGENTS.md.
- Uncertainty: Info.plist GHOSTEXHomeDirectoryName=.ghostex-gpui (build-macos-app.sh:532) appears vestigial — Rust uses GHOSTEX_HOME else ~/.ghostex (shared_settings.rs:1335-1346); no set_var in main.rs. Confirm no shim consumes it.

## Severity roll-up
1. B.9 Sparkle/auto-update MISSING + no DevID signing/notarization (blocks distribution).
2. B.11 logging + crash reporting MISSING.
3. 13.2 Portless setup modal + first-run prompt MISSING (backend works).
4. B.10 CLI native bridge + activation + URL handling PARTIAL.
5. B.8 auto first-run sequence + Discover modal MISSING (manual works).
6. 13.1/13.3/14.4/14.5/14.6 WORKING; 14.7 GPUI-only (verify).
