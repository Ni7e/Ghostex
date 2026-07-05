# Plan: Pass keyboard shortcuts through to embedded VSCode when the Source view owns focus

## Overall goal

Bug report: when a keybinding exists in both VSCode and Ghostex, pressing it while typing
inside the embedded VSCode (code-server) "Source" view triggers the Ghostex action instead
of the VSCode one. Example: Cmd+D (VSCode "select next occurrence") opens a new Ghostex
terminal session instead. Shortcuts that only exist in VSCode (e.g. Cmd+F, which already
has a dedicated carve-out on macOS) work fine.

Fix, in BOTH the macOS AppKit app and the gpui app: while the Source-view embedded VSCode
surface owns keyboard focus (native first responder is inside that CEF view), Ghostex must
stop claiming its app hotkeys and let the key events reach code-server/VSCode. Only a small
"escape hatch" allowlist of Ghostex shortcuts stays active.

## Allowlist decision (applies to both apps — keep them consistent)

While the Source-view CEF surface owns native keyboard focus, the ONLY Ghostex shortcuts
that may still trigger Ghostex actions are:

1. Workarea switching — shared hotkey action ids `switchAgentsView`, `switchSourceView`,
   `switchGitHubView`, `switchKanbanView`, `switchManageView` (default chords Alt+1..Alt+5;
   see `shared/ghostex-hotkeys.ts`). These are the user's escape hatch out of the Source
   view and do not collide with default VSCode bindings.
2. macOS-reserved app commands: Cmd+Q quit (already handled before hotkey matching on
   macOS; `QuitGhostexGpui` in gpui), and in gpui also `HideGhostexGpui`,
   `HideGhostexGpuiOthers`, `MinimizeGhostexGpuiWindow` (Cmd+H / Alt+Cmd+H / Cmd+M).

EVERYTHING else must NOT run a Ghostex action and MUST be delivered to the embedded VSCode
page. That explicitly includes: Cmd+D / Cmd+Shift+D (splits / new session), Cmd+T, Cmd+W,
Cmd+N, Cmd+B, Cmd+P, Cmd+Shift+P, Cmd+. , Ctrl+Tab / Ctrl+Shift+Tab, Cmd+Shift+[ / ],
jumpToProject1..5, sleep/wake-session chords, Cmd+V-into-terminal, merge-tabs, focus
navigation chords (cmd+alt+arrows), and every user-configured hotkey-table entry not in
the allowlist above. VSCode has its own meanings for many of these (Cmd+B sidebar, Cmd+P
quick open, Cmd+W close editor, Ctrl+Tab editor switch, ...) — per the product decision,
VSCode wins inside the Source view.

Existing special handling that must be preserved as-is:

- macOS Cmd+F carve-out for the Source view (`isSourceProjectEditorChromiumFindTarget` in
  `TerminalWorkspaceView.swift`) already returns the event to VSCode. Do not regress it.
- macOS Chromium zoom shortcuts (Cmd+= / Cmd+- / Cmd+0) are handled as CEF page zoom for
  focused Chromium panes before generic hotkey matching. Leave that behavior unchanged.

## Scope guards (both apps)

- Suppression applies ONLY when the Source-view embedded-VSCode CEF surface actually owns
  the native first responder. It must NOT apply when:
  - a terminal (including a project-editor companion terminal shown next to the Source
    view) owns focus,
  - a Browser pane / Kanban / Automate / Manage / sidebar / settings surface owns focus
    (their current behavior is out of scope and must not change),
  - a Ghostex app modal / native child-window modal is open or owns key focus,
  - the Source view is merely visible or "active" but focus is elsewhere.
- No new tests anywhere for this change. The macOS app and the gpui app are explicitly
  no-new-test zones per repository rules. If an existing test fails ONLY because it
  asserts the old behavior of files you changed, prefer updating the assertion; delete it
  only if it is a macOS-app/gpui test that cannot be updated meaningfully.
- No fallback-style code. Fix the routing at the decision point; do not add try-then-fail
  layers, transparent overlay views, hitTest overrides, or window pre-dispatch rerouting.
- Follow the existing comment conventions in each file (block comments with a
  `CDXC:<Topic> <date>:` tag explaining the constraint).
- NEVER run `bun run start` or anything that launches/restarts the Ghostex app.

## Phase 1: macOS app — suppress non-allowlisted Ghostex hotkeys while Source view owns focus

- depends_on: []
- parallel_ok: true
- goal: In the macOS AppKit host, when the embedded VSCode (code-server) Source-view CEF
  surface is the first responder, generic Ghostex hotkey matching in
  `handleHotkeyEquivalent` must stop claiming key events except for the allowlist
  (workarea switching; Cmd+Q stays handled by its existing earlier branch). Non-allowlisted
  chords must fall through (return `false` from `handleHotkeyEquivalent`) so AppKit
  delivers them to the CEF view and VSCode handles them.
- files: `native/macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift`,
  `native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift`
- do_not_touch: `gpui/**`, `shared/**`, `native/sidebar/**`, `ghostty/**`, any other Swift
  files unless a tiny accessor is genuinely required.
- approach:
  - Key flow today: `AppDelegate.installAppHotkeyEventMonitor` (~line 2411) installs a
    local `.keyDown` monitor that calls `ghostexRootView.handleHotkeyEquivalent(event)`
    (~line 10063 in AppDelegate.swift). That method runs, in order: focused-Chromium zoom
    handling, focused-Chromium find handling (with the existing Source-view Cmd+F
    carve-out), Cmd+Q, native-editable bypass, web-chrome (WKWebView) allowlist branch,
    then GENERIC matching via `matchedHotkeyActionId(for:)` + `dispatchNativeHotkey(_)`.
    A focused Source-view CEF pane is none of "native editable" nor "web chrome", so it
    falls into the generic branch — that is the bug.
  - In `TerminalWorkspaceView.swift`, add a focused-Source-view resolver, e.g.
    `func sourceProjectEditorOwnsFirstResponder() -> Bool`. Implement it strictly from the
    live responder: take `window?.firstResponder as? NSView`, require it to be a
    descendant of the workspace view, walk up to the containing `WebPaneHostView` /
    `GhostexCEFBrowserView` (helpers `chromiumHostView(containing:)` and
    `chromiumBrowserView(containing:)` already exist, ~line 20580), and return true only
    when that view belongs to a `projectEditorPaneSessions` entry with `mode == "code"`
    (same ownership test as `isSourceProjectEditorChromiumFindTarget`, ~line 20568). Do
    NOT reuse `focusedChromiumZoomTarget()`'s fallback chain (`focusedSessionId`,
    `activeProjectEditorId`) — those can report the Source editor while a terminal
    actually owns focus; only the responder-descendant path is acceptable here.
  - In `handleHotkeyEquivalent` (AppDelegate.swift), after the Cmd+Q branch and before the
    `isNativeEditableFirstResponder()` branch, add a branch:
    ```
    if workspaceView.sourceProjectEditorOwnsFirstResponder() {
      // only while no app modal is open, mirroring shouldHandleHotkeyWhileWebChromeOwnsFocus
      if activeAppModalKind == nil, activeNativeAppModalKind == nil,
         let hotkeyText, let actionId = matchedHotkeyActionId(for: hotkeyText),
         Self.isSourceViewAllowedHotkeyActionId(actionId) {
        dispatchNativeHotkey(actionId)
        return true
      }
      return false
    }
    ```
    with `isSourceViewAllowedHotkeyActionId` returning true exactly for
    `switchAgentsView`, `switchSourceView`, `switchGitHubView`, `switchKanbanView`,
    `switchManageView`. When a modal IS open, the branch must not dispatch anything and
    must return false (modals own their own key routing). Note `matchedHotkeyActionId`
    mutates pending-prefix sequence state; calling it once inside this branch (as shown)
    is fine, but do not call it a second time on the same event.
  - Add a `logNativeHotkeyDebug("nativeHotkeys.sourceViewPassthrough", ...)` breadcrumb
    (actionId-or-none + hotkeyText + keyCode) in the suppressed path, matching the
    existing logging style, so future repros can prove routing.
  - Add `CDXC:` block comments explaining: source view hosts embedded VSCode; VSCode-owned
    editing shortcuts must reach code-server; only workarea-switch escape hatches (and the
    earlier Cmd+Q branch) may claim keys while that CEF surface owns first responder.
- acceptance_criteria:
  - `TerminalWorkspaceView.swift` gains a responder-strict Source-view focus check that
    returns true only when `window.firstResponder` is a view inside a
    `projectEditorPaneSessions` entry with `mode == "code"`, with no fallback to
    `focusedSessionId` / `activeProjectEditorId`. (Prove by reading the implementation.)
  - `handleHotkeyEquivalent` returns `false` (event passes to CEF) for any matched hotkey
    action other than the five `switch*View` ids while that check is true and no modal is
    open, and dispatches the five `switch*View` ids normally. Cmd+Q and the Cmd+F
    Source-view carve-out behavior are unchanged. (Prove by reading the new branch and its
    placement: after Cmd+Q, before `isNativeEditableFirstResponder()`.)
  - Web-chrome branch, native-editable bypass, Chromium zoom/find handling, and the
    generic branch for all non-Source focus targets are textually unchanged in behavior.
  - The Swift host still compiles: run `CONFIGURATION=Debug native/macos/ghostexHost/build-ghostex-host.sh`
    from the repo root and it must succeed (build only — do NOT launch the app, do NOT run
    `bun run start`). If that script cannot complete in this environment for reasons
    unrelated to your change (missing toolchain/deps), state exactly what failed and why
    it is unrelated.

## Phase 2: gpui app — suppress non-allowlisted Ghostex hotkeys while Source workarea CEF owns focus

- depends_on: []
- parallel_ok: true
- goal: Same product behavior in the gpui app: while the Source workarea's embedded-VSCode
  CEF surface owns native keyboard focus, Ghostex keybindings (both the base defaults and
  the configured hotkey table) must not run Ghostex actions — except workarea switching
  (`SwitchAgentsWorkarea`/`SwitchSourceWorkarea`/`SwitchBrowserWorkarea`/
  `SwitchKanbanWorkarea`/`SwitchManageWorkarea` and the equivalent `switch*View` ids via
  `RunConfiguredGhostexHotkey`) and app-reserved `QuitGhostexGpui`, `HideGhostexGpui`,
  `HideGhostexGpuiOthers`, `MinimizeGhostexGpuiWindow` — and the suppressed key events
  must still reach the CEF view so VSCode executes its own binding.
- files: `gpui/src/main.rs`; only if the pass-through mechanically requires it:
  `gpui/native/macos/GpuiCefAppKitHooks.m` and `gpui/src/cef/macos.rs` /
  `gpui/src/cef/shell.rs`.
- do_not_touch: `native/**`, `shared/**`, `sidebar/**`, `ghostty/**`,
  `gpui/src/terminal_*.rs`.
- approach:
  - Hotkey sources in `gpui/src/main.rs`:
    - Base default global bindings registered in `main()` (~line 55135): `cmd-d`
      SplitFocusedTerminalRight, `cmd-shift-d` SplitFocusedTerminalDown, `cmd-t`
      NewTerminalTab, `cmd-w` CloseFocusedSurface, `cmd-b` ToggleGpuiSidebarCollapsed,
      `cmd-n` NewBrowserTab, `cmd-f` FindInFocusedTerminal, `cmd-v`
      PasteIntoFocusedTerminal, `ctrl-tab`/`ctrl-shift-tab` cycle, `ctrl-shift-m`
      MergeAllTabs, `f12` ToggleCommandPane, `ctrl-cmd-f` ToggleAgentsFocusMode,
      sleep-focused-session, `cmd-alt-arrows` focus, `alt-1..5` workarea switch, and the
      app-reserved quit/hide/minimize bindings.
    - The configured hotkey table: `gpui_configured_hotkey_key_bindings_from_settings()`
      (~line 1236) binds user chords to `RunConfiguredGhostexHotkey { action_id }`, whose
      root `on_action` listener (~line 53441) feeds
      `handle_gpui_app_modal_sidebar_command` → `"runGhostexHotkeyAction"` (~line 29779).
  - Focus signal that already exists: the shell tracks the AppKit first responder via
    `cef::install_first_responder_observer` →
    `receive_first_responder_transition` / `classify_first_responder_target`
    (~line 33089), producing
    `FirstResponderTarget::CefSurface(FirstResponderCefSurface::ProjectWorkarea(ProjectWorkareaCefSurfaceSlotKey::Source))`
    when the Source workarea CEF view owns focus. Use exactly this state (macOS); add a
    small helper like `fn source_workarea_cef_owns_native_focus(&self) -> bool`.
  - REQUIRED INVESTIGATION before coding: determine how a cmd-chord key event currently
    reaches a Ghostex action while the Source CEF NSView is first responder (GPUI window
    key-equivalent dispatch, the swizzled `sendEvent:` hook in
    `gpui/native/macos/GpuiCefAppKitHooks.m`, or menu key equivalents from
    `ghostex_gpui_main_menus()` / `cx.set_menus`). Read the GPUI framework's macOS window
    key handling in the vendored/locked gpui crate if needed. The fix must sit at the
    point where suppression BOTH (a) prevents the Ghostex action and (b) leaves the event
    available to the CEF first responder — a handler that merely no-ops while GPUI still
    reports the key equivalent as handled is NOT acceptable, because then VSCode never
    sees the key (the bug would become "shortcut does nothing").
  - Preferred shape if GPUI's action dispatch supports it: guard the relevant `on_action`
    listeners (and the `RunConfiguredGhostexHotkey` listener) with
    `source_workarea_cef_owns_native_focus()` and decline via `cx.propagate()` so the
    binding falls through, THEN verify in the GPUI platform code that an unhandled key
    equivalent is returned to AppKit for normal first-responder delivery. If GPUI marks
    any matched binding as handled regardless of propagation, instead gate earlier — e.g.
    in the macOS key-equivalent entry point used by the app (the `GpuiCefAppKitHooks.m`
    `sendEvent:` hook already knows registered CEF views and the first responder;
    Rust can export the "suppress Ghostex chords for source focus" decision the same way
    existing CEF hook state is exported). Choose the mechanism that provably delivers the
    key to CEF; do not leave dead half-mechanisms behind.
  - Menu items: if the investigation shows the main-menu key equivalents (not GPUI
    bindings) are what fire for some chords while CEF is focused, apply the same
    allowlist gate to that path for the Source-focus case.
  - The allowlist gate must also cover `"runGhostexHotkeyAction"` ids arriving from the
    keybinding path: while Source CEF owns focus, only `switch*View` ids may execute.
    Do NOT gate the command-palette/sidebar-originated `runGhostexHotkeyAction` messages —
    when the palette or sidebar posts an action the user clicked, Source CEF does not own
    first responder, and clicked palette rows must keep working; the gate must key off the
    live native-focus state, which naturally satisfies this.
  - Non-macOS builds: keep behavior compiling on linux/windows (`first_responder_target`
    is only fed on macOS); guard with `cfg(target_os = "macos")` consistently with the
    surrounding code so other platforms are unchanged.
  - Add `CDXC:` comments in the repo's existing style at the gate site(s) explaining the
    VSCode-wins-inside-Source-view decision and the allowlist.
- acceptance_criteria:
  - There is a single, clearly named Source-CEF-native-focus predicate derived from
    `first_responder_target == CefSurface(ProjectWorkarea(Source))`, and every gated path
    uses it (no duplicated ad-hoc checks). (Prove by reading the code.)
  - While that predicate is true: `cmd-d`, `cmd-shift-d`, `cmd-t`, `cmd-w`, `cmd-n`,
    `cmd-b`, `cmd-f`, `cmd-v`, `ctrl-tab`, `ctrl-shift-tab`, `ctrl-shift-m`, `f12`,
    sleep-session, `cmd-alt-arrow`, and every configured `RunConfiguredGhostexHotkey`
    id outside the allowlist do not run their Ghostex handlers, and the mechanism
    demonstrably leaves the key event deliverable to the CEF view (explain the exact
    dispatch path in code comments or the completion summary, citing the GPUI/platform
    code that makes the fall-through true — this must be an evidence-backed claim, not an
    assumption).
  - `alt-1..alt-5` workarea switching and `QuitGhostexGpui` / `HideGhostexGpui` /
    `HideGhostexGpuiOthers` / `MinimizeGhostexGpuiWindow` still work while the Source CEF
    owns focus.
  - Command-palette rows and sidebar-posted `runGhostexHotkeyAction` messages are not
    affected when the palette/sidebar is what owns focus.
  - Behavior for Browser-tab CEF focus, sidebar CEF focus, Kanban/Automate/Manage CEF
    focus, and terminal focus is unchanged.
  - `cargo check` succeeds in `gpui/` (run from `gpui/`; do not launch the app).

## Verifier findings (round 1) — RESOLVED in fix round 1, re-verified PASSED

Fix: `ghostex_gpui_main_menus_for_source_focus(bool)` swaps Close Pane onto a menu-only
action with no key equivalent while Source CEF owns native focus (flipped both ways by
`reconcile_source_workarea_cef_keyboard_ownership` on first-responder transitions, with
`cef::refresh_application_menu_hooks()` re-run after each menu rebuild), and the same
reconcile hook moves GPUI keyboard focus onto the Source CefSurface focus handle so a
previously focused companion terminal leaves the dispatch path. Verifier re-confirmed both
chords now reach the CEF first responder; `cargo check` passes.

FINDING 1: phase=2 criterion="suppressed chords demonstrably deliverable to CEF (cmd-w)"
evidence=gpui/src/main.rs:82296 ("Close Pane" -> CloseFocusedSurface) + gpui/src/main.rs:55264
(cmd-w binding) + gpui_macos platform.rs:312-382 in the vendored gpui (NSMenuItem gets the
cmd-w key equivalent from the keymap, selector handleGPUIMenuItem:). After the gated listener
propagates, [NSApp mainMenu] performKeyEquivalent: consumes cmd-w, the re-dispatched action is
no-oped by the gate, and the CEF first responder never receives the key — cmd-w becomes dead in
the Source view instead of closing the VSCode editor tab.
fix=make cmd-w (and any other non-allowlisted chord that a menu item holds) deliverable while
source_workarea_cef_owns_native_focus() is true. Acceptable shapes: re-run cx.set_menus on
Source-CEF focus transitions with non-allowlisted key equivalents stripped (restore them when
focus leaves), or export the Source-focus suppression state to GpuiCefAppKitHooks.m and hand
the key equivalent to the registered CEF view before menu dispatch. Audit every
MenuItem::action for non-allowlisted key equivalents, and update the CDXC comment at
gpui/src/main.rs:33141-33151 to describe the real dispatch path including the menu leg.

FINDING 2: phase=2 criterion="cmd-v does not run its Ghostex handler and reaches CEF"
evidence=gpui/src/terminal_element.rs:591-594 (platform+"v" -> paste_clipboard +
cx.stop_propagation) reached via the frame key listener at terminal_element.rs:1390-1398 when a
terminal element holds GPUI keyboard focus; nothing blurs GPUI focus when the CEF NSView
becomes first responder (gpui/src/main.rs:33100-33119 only reconciles sidebar border; the CEF
mouseDown swizzle in GpuiCefAppKitHooks.m:519-532 bypasses GPUI). With the Source companion
terminal GPUI-focused and Source CEF native-focused, the propagated cmd-v is pasted into the
companion terminal, propagate flips to false, performKeyEquivalent returns YES, and VSCode
never receives cmd-v.
fix=in gpui/src/main.rs only (terminal_*.rs stays do_not_touch): stop leaving GPUI keyboard
focus on a terminal element while Source CEF owns native focus — e.g. in
receive_first_responder_transition, when the new target is CefSurface(ProjectWorkarea(Source)),
move/blur GPUI window focus off terminal focus handles (restore on transition back), so the
terminal element leaves the dispatch path and propagated chords fall through. Re-verify cmd-v
and the other suppressed chords still reach the CEF view when the companion terminal was
previously focused, and that focus restores correctly when the user returns to the terminal.

## Handoff notes

(appended by the orchestrator as phases complete)

- Phase 1 COMPLETE: added responder-strict Source CEF focus detection in
  `TerminalWorkspaceView.swift` and a Source-view hotkey pass-through branch in
  `AppDelegate.swift` (after Cmd+Q, before the native-editable bypass); only the five
  `switch*View` action ids remain dispatchable while Source CEF owns focus; added
  `nativeHotkeys.sourceViewPassthrough` breadcrumbs. Verified with
  `CONFIGURATION=Debug native/macos/ghostexHost/build-ghostex-host.sh` (build succeeded).
- Phase 2 COMPLETE: added `source_workarea_cef_owns_native_focus()` in `gpui/src/main.rs`,
  a configured-hotkey allowlist for the five `switch*View` ids, and gated the
  non-allowlisted GPUI hotkey handlers with `cx.propagate()` so suppressed chords fall
  through to the CEF first responder. Workarea switching, quit/hide/minimize, and
  sidebar/palette bridge actions stay active. `cargo check` passed in `gpui/`.
