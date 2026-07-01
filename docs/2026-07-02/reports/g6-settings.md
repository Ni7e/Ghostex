# Report: Group 6 — Settings (agent a574a14ab7dbaf7d5)

## CROSS-CUTTING CRITICAL: updateSettingsPatch dropped — nearly every granular Settings edit silently not persisted (HIGH confidence)
- SettingsModal routes almost all controls through updateDraft/applySettingsPatch → postSettingsPatch, preferring onPatch (sidebar/settings-modal.tsx:2778-2791, 2874-2931).
- modal-host.tsx:2983-2997 wires BOTH onChange→updateSettings and onPatch→updateSettingsPatch; since onPatch defined, granular edits emit updateSettingsPatch.
- macOS handles both (native-sidebar.tsx:47196-47201: saveSidebarSettingsUpdate + saveSidebarSettingsPatch revision-safe merge).
- GPUI app-modal handlers (main.rs:21858-21927, 25991-26527) handle only "updateSettings". NO "updateSettingsPatch" arm anywhere in gpui tree. Falls through _ => {} discarded. Bridge forwards verbatim (app-modal-host-bridge.ts:205-217).
- Only bulk applySettings controls persist: preset (settings-modal.tsx:3025), reset-all (3039), apply-recommended-ghostty (3061), reset-ghostty (3082). On-close flush is patch-only too (2793-2860).
- Root cause staleness: GPUI handler CDXC 2026-06-24 assumes normalized updateSettings; patch path newer (CDXC RemoteMachines 2026-06-30).
- WORK ITEM (highest priority): add updateSettingsPatch arm to both handlers — read snapshot, shallow-merge patch, write_shared_sidebar_settings_object, run refresh_gpui_shared_settings_consumers_after_save; optionally honor baseRevision.

## Item 1 — modal + tabs — PARTIAL (high)
- Opening fully wired: GpuiAppModalKind (main.rs:1309-1352), is_settings_modal_entry (1464-73), hotkeys (1555-65), sizing (1422-32); modal-host.html:14; NativeWindow registered (sidebar_bridge_manifest.rs:274-293). Tab set shared/ghostex-settings.ts:67-78. Legacy "ghostty" tab value not in nav — ghostty settings live inside settings tab.
- Per tab: settings: read WORKING (full hydrate), writes BROKEN (patch); sound preview WORKING (26486); App Icon section MISSING (listAppIcons/setAppIcon/appIconState unhandled). integrations: WORKING (26317-26364 CLI/browser-control/computer-use/orchestration/title/cua; 26365-26403 hooks). osIntegration: WORKING, beta-gated (settings-modal-tabs.ts:9-23; 26404-26416). remote: WORKING (21861-21895, 25998-26018; Keychain, reconnect, browse, add, clone) but machine-list edits patch-gapped. projects: read WORKING (61666-67, 61712); writes patch-gapped. agents: WORKING (23904-23935, 26365-26403). actions: renders; drives titlebar Actions menu (42679-89); edits patch-gapped. openTargets: see item 6. hotkeys: renders; rebinding onChange → updateDraft (settings-modal.tsx:4909) → patch → DROPPED. Hotkey persistence BROKEN.
- Work: fix patch gap; implement/hide App Icon; verify hotkey rebinds persist post-fix.

## Item 2 — persistence/compat — PARTIAL (high)
- Store shared identical: ~/.ghostex/state/native-sidebar-settings.json (shared_settings.rs:1335-1355); atomic temp-rename (991-1060); content-hash+revision (964-976).
- Read WORKING: full raw object into hydrate sidebarState (main.rs:61643-61728, "settings": full + revision); modal reads hud.settings (modal-host.tsx:2171, gate 2205). No keys lost (round-trips raw JSON; bulk write writes object as-is 21939-52).
- Write: bulk WORKING (21930-81); patch MISSING.
- Work: patch handler; confirm revision advances so modal doesn't think save lost.

## Item 3 — live-apply — PARTIAL (high)
- Fan-out narrow (main.rs:24068-24090): project-editor auto-sleep resched (20593-605); sidebar runtime settings booleans (24081); ghostty request maps for FUTURE surfaces (24092-103); rehydrate open modal (24086-88); gxserver agent policy (23904-35).
- NOT covered (CDXC 24073-75, 23880-902, 24097-99): running Ghostty surfaces NOT live-reloaded (no reload FFI) — config file + future surfaces only; sidebarSide from Settings dropdown does NOT live-apply (read at startup 64166-77, 19525; live flip only via moveSidebar command 44015-19); action bridges/code-server sync outside path.
- Sound preview works (26486); completion playback separate (should_play_completion_sound 5841).
- Work: re-read sidebarSide in fan-out; decide Ghostty live reload (needs GhosttyKit FFI) or document; audit macOS live-apply set.

## Item 4 — Ghostty terminal settings — PARTIAL (high config write / med new-surface application)
- Themes/fonts render from shared ghostty-theme-options.ts + settings-modal sections (2036-2205).
- Managed config editing ported to Rust: shared_settings.rs:81-135 key lists, 136-193 recommended lines (mirror ghostty-config-actions.ts:44-75), 1103-1133 write/apply/reset, candidate paths 73-80. Actions handled main.rs:26455-26511.
- New terminals: font size via request maps (24092-103); theme/other keys via on-disk config — VERIFY new surfaces read theme/font-family from config at creation (SharedTerminalGhosttySurfaceConfig only carries font_size, shared_settings.rs:247-256).
- Running terminals: MISSING (no reload FFI).
- Patch gap: individual theme/font/size/weight edits dropped; only Apply Recommended + Reset (bulk) work today.
- Work: patch fix; verify new-surface config load; track GhosttyKit reload API dependency.

## Item 5 — Auto-sleep per surface — PARTIAL (med-high)
- Agent sessions WORKING (TS runtime): runGpuiAutoSleepMonitor (gxserver-runtime.ts:901-949), gated autoSleepAgentSessionsEnabled, createGpuiAutoSleepAgentSessionIds, bulk-sleep-pacing.ts. CDXC limits to agent sessions.
- code-editor/browser/project-editor WORKING (Rust): TitlebarMode mapping (main.rs:67333-46: Source→CodeEditor, Browser→Browser, Kanban|Manage→ProjectEditor, Agents→None); scheduling 20459-504; poll/resched 20506-605; durations shared_settings.rs:662-691 (targets 205-209).
- git-editor MISSING: autoSleepGitEditor* keys exist (ghostex-settings.ts:1374-75), macOS enforces (native-sidebar.tsx:43004-13); no GitEditor variant/surface in GPUI. Unclear if GPUI has git-editor surface at all.
- Favorites/require-resume exclusions: likely honored (full settings passed) — VERIFY createGpuiAutoSleepAgentSessionIds.
- Settings UI edits patch-gapped (defaults still enforce).
- Work: patch fix; git-editor auto-sleep or defer; verify exclusions; verify Browser target semantics.

## Item 6 — Open-targets — PARTIAL (high)
- Titlebar menu WORKING: main.rs:42650-77 native menu from gpui_visible_open_targets_from_current_settings; reads workspaceOpenTargetHiddenIds/Availability/customWorkspaceOpenTargets (48928-49033); launch (49129-65); active-target memory (43077-137, 44957-70); catalog mirrors workspace-open-targets.ts:77-199.
- Availability detection MISSING: macOS detects at sidebar startup + persists (native-sidebar.tsx:8014-8098, startup 51109, titlebar refresh 8023-32). GPUI only reads → on GPUI-only machine available_ids defaults to finder only (main.rs:48990) → menu shows only "Open Folder", Configure shows all IDEs unavailable. Uncertain whether shared SidebarApp detection runs in GPUI CEF sidebar (depends on possibly-absent native command bridge).
- Custom/hidden edits patch-gapped.
- Work: implement Rust availability detection OR verify shared detection runs; patch fix; verify active_open_target_id persists.

## Item 7 — AppKit-specific — mostly ported (med-high)
- App Icon picker MISSING/decision (listAppIcons/setAppIcon unhandled; native icon swap vs hide).
- Keep Awake PORTED (41822-42400; defaults shared_settings.rs:25-36; visibility 519-570). Notifications+permission PORTED (GpuiSettingsNotifications.m + 26483; deep links 26462-82). Completion sounds preview PORTED (24743, 26486) — confirm actual completion playback. App Shots PORTED (292-345; shared_settings 287-323). OS integration defaults PORTED (26404-16). Ghostex folder PORTED (26417-21). Auto-update: not a settings key — no settings-modal concern. Keychain remote passwords PORTED (21983-22030).

## Severity roll-up
1. updateSettingsPatch handler (single highest-value fix in the whole port).
2. App Icon picker implement/hide.
3. Open-target availability detection.
4. Live-apply: running Ghostty reload; sidebarSide live.
5. git-editor auto-sleep + exclusion verification.

Uncertainties: shared SidebarApp open-target detection under GPUI CEF; createGpuiAutoSleepAgentSessionIds exclusions; git-editor surface existence; new-surface theme/font-family load from config.
