# Plan: gpui tabs / tab groups / highlighted tabs + first-responder pane border parity with macOS app

## Overall goal

Make the gpui app (`gpui/`) behave like the macOS AppKit app (`native/macos/ghostexHost/`) for:

1. The focused-terminal pane border. Today gpui draws a **blue** border (`0x3d8dde`) around the
   pane whose `WorkspaceModel.focused_pane` matches — pure model state. The macOS app instead
   drives the border from the **live AppKit first responder** ("the border means keyboard input
   routes to this pane") with a small state machine (attention > focused > none) and several
   edge cases. Port that behavior 1:1, including the edge cases, and remove the blue.
2. Tabs, tab groups, and highlighted (active / attention) tab behavior, so the gpui tab bar
   behaves and reads like the macOS one.

## Repo rules every worker MUST follow

- **NO tests** anywhere under `gpui/` or the macOS app. Do not add test code. If an existing
  test breaks because of your change, delete it.
- **No fallbacks.** Fix behavior at the source; never add "try A, fall back to B" logic to paper
  over an issue.
- **Never run** `bun run start` or anything that restarts the Ghostex app. Do not launch the gpui
  app UI. Validate with `cargo check` (run inside `gpui/`).
- `gpui/src/main.rs` has **uncommitted changes from other in-flight work** (command-terminal
  launch / gxserver restore, tagged `CDXC:GPUICommandPaneGxserverRestore`). Never run
  `git checkout`, `git restore`, `git reset`, or `git stash` on anything. Only make additive
  edits; do not refactor or reflow code you are not changing.
- `native/macos/**` and `ghostty/**` are **read-only reference** for this task. Do not edit them.
- Native layout discipline: do NOT add `hitTest` overrides, window pre-dispatch mouse routing,
  invisible overlays, or intentional overlap between interactive regions. Observing the first
  responder (KVO / `makeFirstResponder` override in an existing window subclass) is fine; input
  *routing* changes are not.
- Searching: prefer `rg -n "pattern" gpui/src native/macos/ghostexHost/Sources shared` and
  exclude `ghostty/**`, `tui/vendor/**`, `node_modules/**`, `target/**`.

## Reference: how the macOS app does it (source of truth)

All in `native/macos/ghostexHost/Sources/ghostexHost/` unless noted. Line numbers are approximate
— re-grep if drifted.

### Border object — `TerminalPaneBorderLayer` (`TerminalWorkspaceView.swift:33138`)

- Non-interactive layer (never participates in hit testing).
- Constants:
  - focused: `#737373` alpha `0.95`, width **1**, shadow opacity 0.18, shadowRadius 16, offset 0
  - attention: `#95D7F6` alpha 1.0, width **2**, shadow opacity 0.28
  - none: width 0 / no color (the commands-pane role has its own `#111111` width-2 inactive
    border; the gpui command pane already has its own border logic — leave it alone)
  - `focusedTopRightEdgeInset = 1` (top+right edges pulled in 1pt so the 1pt line isn't clipped)
- State machine `setState(isFocused:isAttention:)` (`:33280`): `attention > focused > none`.
  Attention border wins over focused border.

### Eligibility — `shouldShowFocusedPaneBorder` / `isFocusedPaneBorderEligible` (`TerminalWorkspaceView.swift:19993-20047`)

The border shows for session S iff ALL of:
- the app-level selected pane is S (`focusedSessionId == sessionId`), AND
- the **live first responder maps to S** (`currentResponderSessionId() == sessionId` — the
  responder view is inside S's terminal surface / placeholder / web pane view tree), AND
- the command pane does not own the responder (`!commandPanelOwnsResponder()`).

Consequences (plain-language rules to reproduce):
- Border shows even with a single pane (single-pane suppression was removed 2026-06-13; the
  border means "typing goes here").
- Border hides when typing belongs to non-terminal chrome: sidebar webview, titlebar, command
  palette, modals, project editor — any responder that maps to no session.
- Border hides when the first responder becomes nil (focus dropped to the window shell):
  `windowFirstResponderChanged` (`:7713-7736`) clears immediately.
- Border hides when the window resigns key — indirectly: the terminal surface resigns first
  responder, mapping fails, border clears.
- **Sidebar focus handoff** (`:19773-19888`): when the user clicks a session in the sidebar
  webview, the webview temporarily becomes first responder before the app focuses the target
  terminal. During that window the previously settled border is kept (not flickered off) until
  the queued focus lands on the target responder or a **350ms** timeout expires
  (`sidebarFocusBorderHandoffTimeoutMs = 350`).
- **Programmatic focus suppression** (`:7692-7712`): while the app itself is programmatically
  moving focus (`programmaticFocusDepth > 0`), first-responder-change handling returns early so
  layout-driven focus doesn't feed back (no border repaint churn, no focus re-emission).
- Attention: `attentionSessionIds` (from agent activity) drives the attention border on the pane
  whose visible tab/session has attention; focusing/creating that pane clears attention
  optimistically.
- macOS also defers first paint until pane geometry "settles" to stop CoreAnimation animating
  the border in from a stale frame (`:20079-20148`). gpui is immediate-mode — borders are drawn
  fresh each frame at the pane's current rect — so this mechanism has no gpui analog and must
  NOT be ported as machinery; just make sure eligibility is recomputed on every focus/layout
  mutation.

### First-responder observation (`AppDelegate.swift:14649-14669`, `:7300`; `TerminalWorkspaceView.swift:7691-7787`)

`ghostexFocusReportingWindow` overrides `makeFirstResponder` and fires a callback on every real
transition; the workspace view classifies the responder via `sessionId(containing:)`
(`TerminalWorkspaceView.swift:21029`) — walk terminal surface views, web pane views, and sleeping
placeholder views; anything else → nil.

### Tabs / tab groups (macOS)

- Tab state is owned by the shared layer; native renders `TabItem`s and emits events
  (`paneTabSelected`, `paneTabFocusRequested` on **double-click** → focus/zoom mode,
  `paneTabCloseRequested(scope:)`, `paneTabSleepRequested`, `paneTabReorderRequested`).
- Active tab styling (`TerminalTitleBarTabButton.tabBackgroundColor()`,
  `TerminalWorkspaceView.swift:26029-26070`): white overlay over near-black base `#050608`:
  selected `alpha 0.13`; inactive `alpha 0.06`; **inactive sleeping** `alpha 0.032`. A selected
  sleeping tab uses the full active highlight (0.13) — only *inactive* sleeping tabs are subdued.
  Split-pane focus does NOT change tab paint; active-tab styling follows tab selection only.
- Indicators: attention/done dot + border `#95D7F6`; working indicator amber `#F59E0B`.
- Tab reorder drop indicator: blue line `rgba(0.44, 0.68, 1.0, 0.95)`, width 2
  (`TerminalWorkspaceView.swift:25386-25388`).
- Keyboard (from `shared/ghostex-hotkeys.ts:368-392`): Next Tab = `cmd+tab`
  (alternate `cmd+shift+]`), Previous Tab = `cmd+shift+tab` (alternate `cmd+shift+[`), actions
  `focusNextSession` / `focusPreviousSession`. Traversal stays inside the active pane's tab
  group and **includes sleeping/placeholder tabs**.
- Attention clearing: cleared optimistically when the session's pane is focused or created;
  clicking the wrapper of an attention pane acknowledges/clears attention **without stealing
  terminal focus**; shared side enforces a 1.5s minimum visibility before authoritative clear.

## Reference: current gpui state

Everything below is in `gpui/src/main.rs` (81k lines) unless noted. Line numbers approximate.

- Pane tree: `WorkspaceModel` (`:10154`) → `WorkspaceNode` Split/Leaf, `WorkspaceLeaf`
  (`:9492`) holds `WorkspaceTabGroup { tabs, active_tab }` (`:9486`).
- The blue border: `render_workspace_leaf` (`:45539`, border at `:45558-45564`) uses
  `workspace_focused_pane_border_color()` (`:56138`, `rgb(0x3d8dde).opacity(0.82)`) when
  `self.agents_workspace.focused_pane == leaf.pane_id`, else `workspace_pane_border_color()`
  (`:56134`, `0x202020`). Same treatment duplicated for the project-editor companion pane
  (`:47021`) and browser pane (`:47747`).
- Focus notions:
  - `ShellFocusTarget` (`:7339`) — first-responder stand-in (`AgentsPane`, `CommandPane`,
    `BrowserSurface`, `BrowserPane`, `ProjectEditorSurface`, `ProjectEditorCompanion`), stored as
    `self.shell_focus` + `self.previous_non_command_focus`.
  - `WorkspaceModel.focused_pane` — per-workarea selected pane; mutated by clicks
    (`focus_agents_terminal_mount_slot` `:33201`), tab selection, keyboard nav.
  - One shared real gpui `FocusHandle`: `terminal_text_focus_handle` (declared `:20691`), the
    IME/text-input sink, `.track_focus` on agents body slot (`:46283`) and command body slot
    (`:44981`). GPUI-engine terminal views have their own element focus handles.
  - Native ghostty surfaces are AppKit `NSView`s (`gpui/src/terminal_native_view.rs`) mounted
    over gpui-measured rects; when the user types into one, the AppKit first responder is that
    NSView. CEF surfaces (sidebar, browser, modals) live in `gpui/src/cef/` and take AppKit
    first-responder status when clicked. There are existing AppKit hooks in the cef module
    (e.g. `GpuiCefAppKitHooks.m`) showing the pattern for ObjC-side interception bridged to Rust.
  - The command pane already has first-responder-ish border logic:
    `command_pane_group_has_first_responder_border` (`:6747`). Use it as a consistency
    reference; do not break it.
- Tab bar: `render_workspace_tab_bar` (`:45579`), `render_workspace_tab` (`:45644`), tone model
  `WorkspaceTabLifecycleVisualTone` (`:9078`), chrome signature (`:9131`). Colors:
  `workspace_tab_bar_color` `0x151515`, `workspace_tab_active_color` `0x242424`,
  `workspace_tab_hover_color` `0x1e1e1e` (`:55478-55486`). Tab ops on `WorkspaceModel`:
  `select_tab` (`:10422`), `cycle_tab_in_pane` (`:10517`), `close_tab*` (`:10536+`),
  `reorder_tab_within_pane` (`:11277`), drag/drop state `DraggedWorkspaceTab` (`:4962`),
  `toggle_focus_mode` (~`:10830`). Activity states already exist (`AgentTerminalActivity`
  Working/Attention) with tab badges (`render_workspace_tab_state_badge` `:45948`).

---

## Phase 1: First-responder tracking infrastructure in the gpui app

- depends_on: []
- parallel_ok: false
- goal: Give the gpui app a live, observed notion of "which surface owns the AppKit first
  responder", equivalent to macOS `ghostexFocusReportingWindow` + `sessionId(containing:)`.
  This phase is infrastructure only — no visual/border changes yet.
- files: `gpui/src/main.rs` (new state + plumbing), `gpui/src/terminal_native_view.rs`,
  `gpui/src/cef/` (ObjC hook file and its Rust bridge, following the existing
  `GpuiCefAppKitHooks.m` pattern), optionally a new small module `gpui/src/first_responder.rs`.
- do_not_touch: `render_workspace_leaf` border colors (Phase 2), tab rendering (Phase 3),
  `native/macos/**`, the command-pane gxserver-restore code paths in `main.rs`.
- approach:
  - Observe first-responder changes on the gpui app's NSWindow. Prefer KVO on
    `NSWindow.firstResponder` or a `makeFirstResponder` override if the app already subclasses
    the window in the hooks layer — mirror `ghostexFocusReportingWindow`
    (`AppDelegate.swift:14649`). Fire on every real transition, including to nil.
  - Classify the responder into a Rust enum, e.g.
    `FirstResponderTarget { TerminalSurface(TerminalSessionId), CefSurface(<which>), GpuiWindow, Other, None }`:
    responder view inside a mounted ghostty surface NSView → that surface's session id
    (`terminal_native_view.rs` knows the NSView↔session mapping); responder inside a CEF
    browser host view → which CEF surface (sidebar vs browser pane vs modal); responder is
    GPUI's own content view → `GpuiWindow` (keyboard then routes through gpui focus handles /
    `shell_focus`); anything else → `Other`; nil → `None`.
  - Deliver transitions to the app (main thread) and store as a field (e.g.
    `self.first_responder_target`) with a `cx.notify()` so renders can react. Log transitions
    behind the existing support-log/debug facility if one is handy.
  - Add a programmatic-focus suppression counter (RAII guard or explicit begin/end), analogous
    to `programmaticFocusDepth` (`TerminalWorkspaceView.swift:7692`): transitions occurring while
    the app itself moves focus (tab select, pane focus commands, terminal handoff in
    `set_shell_focus_with_terminal_handoff`) must not trigger downstream side effects (Phase 2
    consumes this). Store the flag; wire the guard around the existing programmatic focus paths.
- acceptance_criteria:
  - `cd gpui && cargo check` passes with no new warnings-as-errors.
  - A first-responder observation exists at the AppKit level (KVO or override) — show it in
    the ObjC/Rust bridge code — and it reports transitions to nil as well.
  - A classification function maps NSView responders to
    terminal-session / CEF-surface / gpui-window / other / none, using the real NSView↔session
    mapping from `terminal_native_view.rs` (not heuristics like view class names alone for
    terminal surfaces).
  - App state holds the current `FirstResponderTarget` and a programmatic-focus depth/guard;
    both are updated on the main thread.
  - No visual changes: `rg "0x3d8dde" gpui/src` still matches exactly the pre-existing site(s).
  - No `hitTest` overrides or event routing changes were added.

## Phase 2: Port the macOS pane border (visuals + eligibility + edge cases)

- depends_on: [1]
- parallel_ok: false
- goal: Replace the blue focused-pane border with the macOS first-responder border, 1:1:
  colors/widths/priority from `TerminalPaneBorderLayer`, eligibility from
  `isFocusedPaneBorderEligible`, plus the nil-responder, chrome-focus, command-pane,
  window-resigns-key, sidebar-handoff, and programmatic-suppression edge cases.
- files: `gpui/src/main.rs` (border color fns `:56134-56138`, `render_workspace_leaf`
  `:45539`, browser pane `:47747`, project-editor companion `:47021`, new eligibility helpers,
  sidebar-handoff state), `gpui/src/cef/` only if the sidebar-click handoff needs a signal from
  the sidebar bridge.
- do_not_touch: tab bar rendering / tone model (Phase 3), command-pane border logic
  (`command_pane_group_has_first_responder_border`), `native/macos/**`.
- approach:
  - Border constants (match macOS exactly):
    - focused: `#737373` at alpha `0.95`, 1px
    - attention: `#95D7F6` opaque, 2px, and attention WINS over focused
    - not eligible: no focus border — keep the existing neutral `workspace_pane_border_color()`
      (`0x202020`) as the structural pane edge, same as today's unfocused look.
    - Delete/replace `workspace_focused_pane_border_color()`'s blue; `0x3d8dde` must be gone.
    - gpui draws borders inside layout (no shadow primitive parity is required; if a cheap
      equivalent glow exists, skip it — geometry and colors are the parity target).
  - Eligibility for an agents leaf pane P with active session S — ALL of:
    1. `agents_workspace.focused_pane == P` (selected pane), and
    2. `shell_focus == ShellFocusTarget::AgentsPane(P)` (command pane / browser / editor does
       not own keyboard), and
    3. the live keyboard target maps to S: `first_responder_target` is
       `TerminalSurface(S)` for native mounts, or `GpuiWindow` with the relevant gpui focus
       handle focused (`terminal_text_focus_handle.is_focused(window)` for text-sink terminals,
       the engine view's handle for GPUI-engine terminals, and the placeholder case for
       non-running tabs — mirror macOS `isPlaceholderPaneSession` which allows placeholder
       panes), and
    4. the window is active/key (border clears when the app window resigns key).
  - Attention border: pane P shows the attention border when its **active tab's** session has
    `AgentTerminalActivity::Attention` (match macOS `attentionSessionIds` semantics), regardless
    of focus; attention > focused. Focusing the pane (or creating it) clears attention for that
    session optimistically.
  - Sidebar handoff: when a sidebar (CEF) click initiates focusing a session, the first
    responder transiently becomes the CEF view. Keep the previous pane's border during the
    handoff until the target terminal owns the responder, with a 350ms timeout — port
    `beginSidebarFocusBorderHandoff` / `setSidebarFocusBorderHandoffTarget` /
    `completeSidebarFocusBorderHandoffIfTargetFocused` / `cancelSidebarFocusBorderHandoff`
    semantics (`TerminalWorkspaceView.swift:19773-19888`). Hook the begin/target calls into the
    gpui code path that handles sidebar-initiated session focus.
  - Nil responder → border off immediately. Responder classified `Other`/`CefSurface` (outside
    a handoff) → border off.
  - Respect the Phase 1 programmatic-focus guard: responder transitions during app-driven focus
    moves must not emit focus-selection side effects; eligibility itself is recomputed from
    current state on render (immediate mode), so no repaint machinery is needed.
  - Apply the same eligibility treatment to the browser pane (`:47747`) and project-editor
    companion (`:47021`) borders, mirroring macOS: they get the focused border when they are
    the live keyboard target (macOS `:20040-20045`), with the same colors.
- acceptance_criteria:
  - `cd gpui && cargo check` passes.
  - `rg "0x3d8dde" gpui/src` returns nothing.
  - Focused border is `#737373` alpha 0.95 at 1px; attention border is `#95D7F6` at 2px;
    attention beats focused — verify in `render_workspace_leaf` and the border helper.
  - An eligibility helper implements rules 1-4 above (selected pane + shell focus + live
    responder mapping + window key), and is the ONLY thing deciding the focused border for
    agents leaves; `focused_pane` alone no longer lights the border.
  - Sidebar handoff state exists with a 350ms timeout and begin/complete/cancel transitions
    wired into the sidebar-initiated focus path.
  - Attention on the active tab's session shows the 2px `#95D7F6` pane border and clears on
    pane focus/create.
  - Browser pane and project-editor companion use the same colors + responder-aware condition.

## Phase 3: Tabs, tab groups, and highlighted-tab behavior parity

- depends_on: [2]
- parallel_ok: false
- goal: Make gpui tab bar behavior and highlight states match macOS: active/sleeping tab
  emphasis, attention/working indicator colors, double-click focus mode, next/prev-tab
  shortcuts including sleeping tabs, reorder drop-indicator color, attention acknowledgement
  semantics.
- files: `gpui/src/main.rs` (tab rendering `:45579-46161`, tone model `:9078-9131`, tab colors
  `:55478+`, keybindings/actions, `cycle_tab_in_pane` `:10517`, attention handling).
- do_not_touch: border eligibility code from Phase 2 (consume, don't rewrite),
  command-pane tabs, `native/macos/**`.
- approach:
  - Tab emphasis parity (macOS `tabBackgroundColor`, `TerminalWorkspaceView.swift:26029`):
    selected = strong highlight; inactive = subtle; **inactive sleeping** = extra subdued;
    a SELECTED sleeping tab gets the full active highlight (verify gpui's
    `WorkspaceTabLifecycleVisualTone` does this — macOS only subdues sleeping tabs that are not
    selected). Recreate the macOS relative emphasis with white overlays composited over the
    gpui tab-bar base `0x151515`: selected = white 0.13 over base, inactive = white 0.06,
    inactive sleeping = white 0.032 (macOS composites over `#050608`; use the same overlay
    alphas over gpui's base so relative emphasis matches).
  - Pane focus must NOT change tab paint (macOS keeps tab colors stable across split-pane focus
    changes; active-tab styling follows tab selection only). Verify gpui's
    `active_in_tab_group`-driven styling already guarantees this; fix if any focus-driven tint
    exists.
  - Indicator colors: attention/done indicator `#95D7F6`; working indicator `#F59E0B` — align
    the tab status dot / badge colors with these.
  - Double-click on a tab toggles focus mode for that pane/session (macOS
    `paneTabFocusRequested`), only for tabs where focus mode is allowed.
  - Next/Previous tab actions cycle within the active pane's tab group and INCLUDE
    sleeping/placeholder tabs (check `cycle_tab_in_pane` includes non-running sessions).
    Bindings to match `shared/ghostex-hotkeys.ts:368-392`: `cmd+tab` next / `cmd+shift+tab`
    previous, with alternates `cmd+shift+]` / `cmd+shift+[`. If the OS swallows `cmd+tab`
    before gpui sees it, still register it (macOS app registers it and receives it in-app) and
    ensure the alternates work; note the observed behavior in your completion summary.
  - Tab reorder drop indicator: match macOS blue line `rgba(112, 173, 255, 0.95)`
    (calibrated 0.44/0.68/1.0 → `#70ADFF` approx) at width 2 for the insertion marker.
  - Attention acknowledgement: clicking anywhere in a pane that has attention clears the
    attention state for that session; when that click is on the pane wrapper/chrome (not the
    terminal body), clear attention WITHOUT moving keyboard focus into the terminal (macOS
    `TerminalWorkspaceView.swift:7618-7680`). Keep a minimum-visibility floor only if gpui
    already has an attention timing model; do not invent new timing machinery.
- acceptance_criteria:
  - `cd gpui && cargo check` passes.
  - Tab background math: selected/inactive/inactive-sleeping use white overlay alphas
    0.13/0.06/0.032 over the tab-bar base; a selected sleeping tab gets the selected treatment.
  - Attention indicator color is `#95D7F6` and working indicator `#F59E0B` in the tab
    badges/dots.
  - Double-click on an eligible tab toggles focus mode.
  - Next/prev tab actions bound (`cmd+tab`, `cmd+shift+tab`, plus `cmd+shift+]`/`cmd+shift+[`)
    and cycle includes sleeping/placeholder tabs.
  - Reorder insertion marker uses the macOS blue (`~#70ADFF` at 0.95) width 2.
  - Wrapper-click on an attention pane clears attention without focusing the terminal.

## Handoff notes

(appended by the orchestrator after each phase completes)

### Phase 1 → Phase 2

Phase 1 added AppKit KVO first-responder observation on the GPUI NSWindow (including nil
transitions), bridged transitions into Rust, and stores a classified current first-responder
target on the app (classification uses exact terminal host ownership and CEF native-root
containment). It also added programmatic focus depth tracking around existing app-driven focus
handoffs. Relevant new symbols in `gpui/src/main.rs` and the cef/native bridge: search for
`first_responder` / `programmatic_focus_depth` / `GhostexGpuiInstallFirstResponderObserver` /
`GhostexGpuiNativeViewContainsResponder`. `cargo check` passes; `0x3d8dde` still present (Phase 2
removes it). Note: `gpui/src/main.rs` also carries unrelated uncommitted command-pane restore
work — leave it untouched.

### Phase 2 → Phase 3

Phase 2 replaced the blue focused-pane border with the macOS parity colors (focused `#737373`
@0.95 1px, attention `#95D7F6` 2px, attention wins), added a focused/attention border state
helper, implemented eligibility (selected pane + shell focus + live first-responder mapping +
active window) for Agents panes, applied the same treatment to the browser pane and
project-editor companion, and wired a 350ms sidebar focus-border handoff into the
sidebar-initiated session focus paths. `cargo check` passes; `rg "0x3d8dde" gpui/src` returns
nothing. Phase 3 must consume the attention/eligibility helpers, not rewrite them.

### Phase 3 (completed)

Phase 3 reworked tab fills to white overlays 0.13/0.06/0.032 over the tab-bar base, aligned
working/attention indicators to `#F59E0B`/`#95D7F6`, changed the tab reorder marker to `#70ADFF`
at 0.95 alpha 2px, and made pane chrome clicks clear active attention without focusing the
terminal. Also in scope per its diff: double-click focus mode and next/prev tab bindings —
verify these explicitly. `cargo check` passed.
