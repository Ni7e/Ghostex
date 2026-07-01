# Report: Groups 3 (Prompts) + 4 (Palette/hotkeys/commands) (agent ad53dcb7ec80e8049)

## Architecture fact
React modals code-present in GPUI app-modal host, but a modal only works if (a) GpuiAppModalKind entry, (b) bridge command handled in handle_gpui_app_modal_sidebar_command, (c) open path exists. Titlebar Settings menu (show_titlebar_settings_menu, main.rs:42635) = primary open path; NO modal-open action in cx.bind_keys (~24 hardcoded keystrokes) → keyboard opening only works while sidebar/palette CEF surface has focus.

## F1 Floating prompt editor (Ctrl+G) — MISSING (high)
- macOS: server injects ghostex n wrapper as $EDITOR/$VISUAL (gxserver-rs/src/zmx.rs, ghostex_prompt_editor_wrapper → exec GHOSTEX_CLI_EXECUTABLE n, GHOSTEX_PROMPT_EDITOR_BACKEND). Ctrl+G in agent → CLI calls host over authenticated localhost bridge (HostProtocol.swift openFloatingEditor) → AppDelegate openFloatingPromptEditor → prewarmed Monaco WKWebView window + save/cancel status-file handshake with waiting terminal. React FloatingPromptEditorModal in modal-host.tsx (~863).
- GPUI: modal code-present but: no FloatingPromptEditor variant in GpuiAppModalKind (1313-1322); no openFloatingEditor handler, no floating window, NO CLI localhost host bridge anywhere in gpui/src. GPUI only sets attach preference --prompt-editor monaco / promptEditor:"monaco" when promptEditorBackend=="monaco" (main.rs:53723-26, 53974-76, 53985) — asks server to inject wrapper but nothing can host the editor.
- Work: modal kind + open path; host-side bridge endpoint for injected ghostex n CLI (bridge token/port discovery); Monaco window lifecycle (prewarm, draft load, save/cancel status file, return-focus); guard promptEditorBackend=monaco setting until host exists.
- Uncertainty: whether GPUI runs ANY localhost CLI bridge (none found — consistent with B.10 finding: no 58743 server).

## F2 Image insert/preview — MISSING (high). Blocked on F1. After host exists, wire floatingPromptEditorImagePaste + persistence/preview.

## F3 Cross-client prompt routing — PARTIAL (med-high)
- Sending half exists (capability at attach, gated by setting). Receiving half missing (blocked on F1). Work: host endpoint to fulfill routed open; only advertise capability when serviceable.

## F6 First-prompt auto title — PARTIAL (high)
- Server generation shared. macOS client submits staged /rename via REAL Return keypress when generation finishes: native-sidebar.tsx imports shouldSubmitStagedFirstPromptTitleCommand (374), evaluates (4091), posts sendTerminalEnter (4164) — deliberately not CR text write.
- GPUI: sets titleSource (gxserver-runtime.ts:3206) but no import of first-prompt-title-submit, no sendTerminalEnter for titles (only Delayed-Send comment). GPUI HAS native Ghostty Return path (Delayed Send uses it).
- Work: detect generating→done in GPUI runtime (port shouldSubmitStagedFirstPromptTitleCommand), submit staged /rename via Ghostty Return keypath (reuse Delayed-Send mechanism), keep Generating overlay until after submit.
- (Refines G7/8 report's F5 uncertainty: macOS DOES use the staged-Enter path — native-sidebar.tsx posts sendTerminalEnter. So this IS a real gap.)

## F4 Pinned prompts — WORKING (high). Kind (1316,1339,1363,1386); OpenGpuiPinnedPromptsModal menu (42644) + listener (45041); savePinnedPrompt (26263) → /api/savePinnedPrompt. Minor: no native terminal-focus shortcut (ties to hotkey table).

## F5 Scratch pad — WORKING (high). Kind (1317,1340,1364,1387); menu (42645) + listener (45050); saveScratchPad (26260) → /api/saveScratchPad. Same minor note.

## F7 Delayed send — WORKING (high)
- Kind (1319); open via command-pane tab context menu (21293, action 45254); scheduleDelayedSend (26269), cancel (26272), toggleCloseAfterDone (26275); submission via native Ghostty Return path with live-tab resolution (5524).
- Minor: open path limited to command-tab context menu + direct modal route; if macOS opens from other surfaces (Agents terminals — see G2 F10 gap: delayedSend RuntimeNoOp for Agents), add routes.

## F9 Hotkeys — PARTIAL, MAJOR gap (high) — most severe in G4
- Modal + recorder reachable & persistable: hotkeys-modal.tsx + hotkey-recorder-field.tsx reused; kind (1335,1359); menu (42637) + listener (44939); saving via updateSettings (25992). NOTE: G6 found rebinding actually goes through updateDraft → PATCH → dropped; so persistence depends on updateSettingsPatch fix.
- Canonical hotkey table NOT mapped natively: shared/ghostex-hotkeys.ts (~50 defs) referenced NOWHERE in main.rs. cx.bind_keys = ~24 hardcoded literals; none open modals; none read from settings.
- User-configured hotkeys only fire when sidebar/palette CEF has focus: sidebar-app.tsx resolves keydown → posts runGhostexHotkeyAction (handled 26050 → modal kinds 1549). Terminal/Browser focus → DOM never sees keydown.
- Work: full native hotkey table (read normalized ghostex-hotkeys settings into Rust, cx.bind_keys registration); make hardcoded binds settings-driven; rebind on settings update.

## F8 Command palette — PARTIAL (high)
- Open + reachability: kind (1313,1336,1360,1383); menu (42638) + listener (45014); openCommandPalette/openSessionSearchPalette in hotkey map. Command list from hud.commands (modal-host.tsx:2174). Previous sessions work (26596/26603/26620).
- GAPS: (1) focusSession from palette DROPPED — no "focusSession" case in app-modal handler, fallthrough _ => {} (26647). Selecting a running session does nothing. (2) runSidebarCommand from palette DROPPED — no handler (palette posts commandId+runMode, command-palette.tsx:916-20). Sidebar-surface execution works separately. (3) searchPreviousSessionsByText intentional no-op (26637-42).
- Work: handle focusSession (route to native terminal focus/materialize); handle runSidebarCommand (resolve against HUD → run_gpui_titlebar_action path); decide/implement text search.

## F10 Custom commands/configure-actions/icon-picker — WORKING (high)
- ConfigureActions kind (1322,1345,1369,1392); menu (42640) + listener (44952). saveSidebarCommand/deleteSidebarCommand/syncSidebarCommandOrder handled (runtime 2441/2444/2447 → 6889/6923/6936) → gxserver project domain (customCommands etc.). Icon picker reused.
- Execution from SIDEBAR fully wired: SidebarCommandAction bridge → receive (27918) → strict allowlist parse (65258) → run_gpui_titlebar_action (42805): terminal/debug-terminal/browser; unconfigured → opens editor; run-end closes tab (27934).
- Only cross-over gap: palette execution (F8).

## Severity summary
1. F1+F2 floating prompt editor MISSING (no kind, no host bridge, no window).
2. F9 native hotkey table MISSING (24 hardcoded; configured hotkeys dead with terminal focus).
3. F8 palette focusSession + runSidebarCommand dropped; text search no-op.
4. F6 first-prompt title Enter-submit missing client half (macOS staged-Enter confirmed real).
5. F3 routing partial (blocked on F1).
6. F4/F5/F7/F10 working (minor open-path notes).
