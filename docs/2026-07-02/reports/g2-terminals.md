# Report: Group 2 — Terminal panes & tabs + command panes (agent aef88947c68a34e1f)

## Orientation
- GPUI mounts real libghostty surfaces for visible-running Agents terminals + command-pane bodies via lifecycle machine (terminal_surface_lifecycle.rs, terminal_ghostty_surface.rs); attach via daemon-built attach command → ghostty_surface_new (main.rs:3277, :9892; remote :3194).
- Key/mouse/IME via GpuiTerminalAppKitAdapter.m + GhostexGpuiTerminalHandleNativeKeyEvent (main.rs:108); mouse/scroll forwarded at GPUI element level (main.rs:28994–29486).
- MOST CONSEQUENTIAL: ghostty_runtime_action_cb is a stub returning false (terminal_ghostty_surface.rs:1159–1164). macOS full dispatcher at TerminalWorkspaceView.swift:1817–1858. Root cause of missing link-click, bell, search, OSC title/pwd (F11).

## F1 Splits+tabs — WORKING (high)
- cmd+t NewTerminalTab (main.rs:45920 → :26140); cmd+d/cmd+shift+d SplitFocusedTerminalRight/Down (:45921–22 → :26151; model :10031); tab close (:38982, :9484, :10630); reorder DraggedWorkspaceTab (:34301–86, :10191, preview :4157/:8237); cross-pane move/drag-to-split WorkspaceDropTarget::PaneBody zones (:34349–79, :10249); close scopes CloseTab/CloseOthers (:1038).
- Minor: verify macOS lacks "Close to the Right"/"Close tabs in pane"; if present, add scopes.

## F2 Keyboard nav / hotkeys — PARTIAL (high) — most systemic gap
- GPUI: exactly 23 hardcoded KeyBinding entries (main.rs:45911–45934): cmd+alt+arrows (focus_workspace_direction :45282–91, spatial :18400), cmd+t, cmd+d, cmd+shift+d, cmd+n, ctrl+shift+m, f12, ctrl-tab/ctrl-shift-tab, cmd+w, alt+shift+s, cmd+b, alt+1..5, ctrl+cmd+f. Configurable hotkeys dispatched ONLY when CEF sidebar posts runGhostexHotkeyAction (main.rs:26050, :27957) — only when web surface owns focus.
- macOS: settings-driven global monitor installAppHotkeyEventMonitor (AppDelegate.swift:2301), readHotkeys (:6247), matchedHotkeyActionId (:12129), dispatchNativeHotkey (:12209), handleHotkeyEquivalent (:11250) — works regardless of focus.
- Work: (1) native settings-driven hotkey resolver (normalizeghostexHotkeySettings → dispatch into runGhostexHotkeyAction/gpui_focused_pane_hotkey_action routes); (2) register missing chords reachable from focused terminal: cmd+shift+p palette, cmd+p session search, cmd+, settings, cmd+. hotkeys, cmd+r rename, ctrl+shift+l rotate, cmd+[/] prev/next group, cmd+1..9 slots, cmd+ctrl+1..9 project jump, ctrl+shift+1..5 action slots, ctrl+shift+o/f/r/s pop-out/fork/reload/delayed-send; (3) tab prev/next chord parity: shared defaults cmd+tab/cmd+shift+tab (+cmd+shift+[/] alternates) vs GPUI ctrl-tab (verify macOS actually binds cmd+tab first).

## F3 Focus borders — WORKING (med-high)
- workspace_focused_pane_border_color (main.rs:47485 → :38713, :40334); command pane border (:47647 → :5926); browser border shell_focuses_this_browser_pane (:41045); ShellFocusTarget model (:16811+, :16966+); click terminal → shell focus → Ghostty host (:8998).
- Verify at runtime: focus/border across CEF↔Ghostty boundaries.

## F4 Close-confirm — WORKING (high)
- ghostty_surface_needs_confirm_quit bound (ghostty_kit.rs:525; wrapper terminal_ghostty_surface.rs:1768); confirm flows Agents (main.rs:16358, :17422–17579 gated :17579) + command (:16443, :17619–17737); privacy-safe copy (:17360); close via ghostty_surface_request_close.
- macOS uses Ghostty's built-in confirm-close-surface config (AppDelegate.swift:5564, :5630). Parity OK; verify prompt copy.

## F5 Sleeping/overflow placeholders — PARTIAL (med)
- GPUI: states Sleeping/Mounting/StartupFailed/RestoredUnmounted/PoppedOutPlaceholder (main.rs:7963+, :9110); placeholder render (:47056+, :40107, :47260); honors clickToWakeSleepingSessions (:18589); command-pane "Press Any Key to Wake" + alphanumeric wake (:857, :8749–53); Agents wake = click/activation (:39544); command overflow "Show Active Tab" (:737); keep-awake tracking (:49211).
- macOS: SleepingPanePlaceholderContentView press-any-key (TWV:32017, :32116), clickToWake (:2939), batch sleepInactiveSessionsFromTitlebar (AD:9892, :10407).
- Work: (1) keyboard press-any-key wake for AGENTS sleeping bodies; (2) "Sleep Inactive Sessions" titlebar batch route; (3) confirm workspace tab-strip overflow affordances.

## F6 IME — WORKING (high)
- NSTextInputClient full impl (GpuiTerminalAppKitAdapter.m:390: setMarkedText :689, insertText :673, interpretKeyEvents :556, preedit :495, firstRectForCharacterRange :746 → native_ime_point_for_view main.rs:225–230, :30254); committed/preedit via main.rs:167/:196. Runtime-verify CJK candidate placement + dead keys.

## F7 File drop — WORKING (high)
- registerForDraggedTypes (:815), dragging handlers (:423–431), path extraction public.file-url (:230, :301–305), insert via GhostexGpuiTerminalInsertDroppedText (main.rs:140). Minor: verify quoting/multi-file join parity.

## F8 Layout actions — WORKING (high)
- AppendFullWidthTerminalRowForPane (main.rs:984, :643); MergeAllTabsForPane (:996 → :9974) + ctrl+shift+m; rotate_panes_clockwise (:10014); Split Right/Below chrome (:10039); far-right overflow NativeMenu (:646); tab context menu (:652). No gaps besides pop-out.

## F9 Pop-out windows — MISSING (high)
- macOS: ensurePoppedOutPaneWindow real NSWindow (TWV:16356–16473), applyOptimisticPanePopOutAction (:16553), restorePopOut (:16446–16508), menu entries (:27304, :29650, :29695). Transfers surface owner, does not relaunch (:2905).
- GPUI: popOutPane → RuntimeNoOp (main.rs:16949, handler :26173 returns). Only open_window calls: main window (:45937) + CEF modal hosts (:21626). PoppedOutPlaceholder card exists (:7963+, :8073) but no window creation/reattach.
- Work: real pop-out window re-parenting Ghostty surface owner; wire popOutPane/restorePopOut + placeholder + Reattach; add menu entries.

## F10 Command panes — WORKING mostly (med-high)
- Modes Pinned/Floating/Collapsed (main.rs:4278, :4322; pin visibility :4551; floating 25px inset :723–727; collapsed strip :4583+). F12 ToggleCommandPane (:45913), palette open (:26143); splits coerced horizontal (:11362, :16782); Action terminals distinct launch source (:5859, :11055).
- Delayed send FULL for command panes: schedule/cancel/restore/countdown/persistence (:25295–25608), modal (:21293), badge (:18906–19021), tooltip (:4476, :5216). Rename (:10471, :26178). Scoped close (:1251, :661). Sleep/wake (:26188–91; placeholder :849; parks owner :3009, :5161; preserves intents :10757). Close-After-Done + HUD (:5310, :11550).
- Work: (1) Delayed Send unavailable for focused AGENTS terminals via hotkey — delayedSend → RuntimeNoOp (:16940, :26173); confirm macOS behavior for Agents (ctrl+shift+s focusedPaneAction) then implement; (2) verify Action command terminal launch parity vs runNativeSidebarCommand/createCommandTerminal; (3) close-scope parity.

## F11 Scrollback/search/links/bell — PARTIAL→MISSING (high)
- Root cause: ghostty_runtime_action_cb stub (terminal_ghostty_surface.rs:1159–1164). All action structs bound in ghostty_kit.rs (open_url :316, mouse_over_link :232, start_search :347, search_total :353, search_selected :359, scrollbar :365, desktop_notification :213, set_title :220, pwd :226) but never dispatched.
- macOS handles all (TWV:1817–1858): OPEN_URL (:1845–58), RING_BELL → ringBell visual (:1827, :23112), START_SEARCH → TerminalSearchBarView (:1830, :23123, :24443) + END/TOTAL/SELECTED (:1833–42), SET_TITLE/PWD live tab title/cwd (:1817–20), SCROLLBAR + TerminalPaneAttentionFocusScrollView (:2215) scroll_to_row (:2406, :2486).
- Work (severe→minor): (1) implement runtime action dispatcher (unblocks all); (2) OPEN_URL → gpui_open_url (exists main.rs:48750) + MOUSE_OVER_LINK hover; (3) search-bar UI + search action tags; (4) RING_BELL (note completionBellEnabled main.rs:24775/:61684 is agent-completion bell, NOT terminal BEL); (5) SET_TITLE/PWD → live tab labels (currently hardcoded terminal_session_title_for_id main.rs:17770); (6) scrollbar overlay + scroll_to_row/attention-jump if required.
- Wheel scrollback + selection work today (surface.mouse_scroll main.rs:29204, :29486).

## Cross-cutting RuntimeNoOps
forkSession + reloadSession universal no-ops (main.rs:16943–47, :26173). macOS has real Fork/Reload title-bar buttons + menu (TWV:29668–70, :29713–15, :29759–61). Server-backed; GPUI never issues request. Work: implement Fork/Reload dispatch + UI entries.

## Uncertainties
1. Fork/Reload/DelayedSend exact server semantics for Agents terminals.
2. Auto-sleep policy owner (sidebar/server vs native timer) — scopes missing batch route.
3. macOS press-any-key wake for Agents panes (appears yes via shared SleepingPanePlaceholderContentView).
4. Does macOS actually bind cmd+tab in-app?
5. macOS workspace tab-strip overflow UI.
