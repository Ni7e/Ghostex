# Plan: Match gpui browser tabs bar + address bar to the macOS app

## Overall goal

Make the browser tabs bar and address bar in the gpui app (`gpui/`) work and look
like the current macOS AppKit app. The macOS reference implementation lives in
`native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift`
(tab strip: `TerminalSessionTitleBarView` ~line 26858; per-browser address toolbar:
`WebPaneHostView` ~line 30123). The gpui browser implementation lives almost
entirely in `gpui/src/main.rs` plus the CEF host layer in `gpui/src/cef/shell.rs`.
Line numbers in this plan are approximate anchors; search for the symbol names.

Key structural differences to fix (established by code inspection):

1. macOS composes each browser area as: **tab strip on top → 40px address
   toolbar under it → page content**, and the toolbar belongs to the
   pane/tab, not the window. gpui currently renders ONE global toolbar above
   the whole browser split tree (`render_browser_workspace` ~49585 renders
   `render_browser_toolbar` then `render_browser_node`), with per-pane tab
   strips below it — i.e. address bar ABOVE tabs, and shared across panes.
2. macOS tracks CEF loading state (`navigationStateChangedHandler(canGoBack,
   canGoForward, isLoading)`) and the reload button toggles to a Stop button
   while loading. gpui has no load-state event for browser tabs at all
   (`BrowserPageMetadataEvent` in `gpui/src/cef/shell.rs` ~523 only has
   Address/Favicon/Title) and only a plain reload button.
3. Several address-field behaviors differ (focus/revert/commit/mirroring
   details, listed in Phase 3).
4. Colors/heights differ (macOS values listed in Phase 4).

What already matches and must NOT be rebuilt or regressed:
- `normalize_address` in `gpui/src/main.rs` (~59200) already implements the
  exact macOS search-vs-URL rules (scheme kept; localhost/127.0.0.1 → http;
  contains "." and no space → https; else Google search). Leave it as is.
- Tab drag/reorder/split, close button, favicon fetch, new-tab + overflow
  buttons, history/profile/devtools/zoom/feedback toolbar buttons, popup-to-
  tab, and shell-state persistence all exist and work in gpui. Preserve them.
- macOS has NO per-tab loading spinner and NO URL autocomplete. Do not add
  either.

## Rules for all workers (repo requirements)

- Do NOT write any tests in `gpui/` (or anywhere under the macOS app). If an
  existing test breaks because of your change, delete it.
- Never add fallback code where the correct fix is to make the primary path
  behave right. No try-this-then-fall-back logic.
- Never run the Ghostex app, `bun run start`, `cargo run`, or anything that
  launches/restarts the app. Build/typecheck only.
- `gpui/src/main.rs` is a ~83k-line single file; keep new code in the same
  style as its neighbors (free color functions, `const` layout tokens near
  ~688, methods on the `Ghostex` struct, comment style used nearby).
- The macOS Swift file is READ-ONLY reference material for every phase. Do
  not modify anything outside `gpui/`.
- Verify your work compiles with: `cd /Users/madda/dev/_active/Ghostex/gpui && cargo check`
  (use `cargo check --message-format short` if output is long). Warnings that
  existed before your change are fine; your change must add no errors.

## Phase 1: Per-pane address toolbar below the tab strip

- depends_on: []
- parallel_ok: false
- goal: Restructure the gpui browser chrome so each browser pane leaf renders
  its own address toolbar BELOW its tab strip and ABOVE the page body,
  matching macOS (tabs on top, address bar under them, one toolbar per
  browser pane). Remove the single global toolbar row above the split tree.
- files: `gpui/src/main.rs` only.
- do_not_touch: `gpui/src/cef/**`, `native/**`, `shared/**`, tab-strip
  drag/reorder logic (`handle_browser_tab_strip_drop`, `begin_browser_tab_drag`
  and friends) beyond what compiles, `normalize_address`.
- approach:
  - Today: `render_browser_workspace` (~49585) does
    `.child(self.render_browser_toolbar(cx)).child(self.render_browser_node(...))`.
    `render_browser_leaf` (~49757) renders tab strip + body. Move the toolbar
    into `render_browser_leaf` between the tab strip and the body, and delete
    the global toolbar child from `render_browser_workspace`.
  - `render_browser_toolbar` (~52795) and `render_browser_address_field`
    (~52990) currently read the focused pane's active tab via
    `active_browser_surface`/`active_address_value` and use the single
    `self.address_input: Entity<InputState>` (~21422). Parameterize the
    toolbar render path by `BrowserPaneId` (and that pane's active
    `BrowserTabId`) so each pane's toolbar shows and controls ITS OWN active
    tab: URL text, security icon, back/forward/reload enabled state, zoom
    button visibility, history scope, devtools target.
  - Replace the single `address_input` with per-pane input state: e.g.
    `browser_address_inputs: HashMap<BrowserPaneId, Entity<InputState>>` on
    the `Ghostex` struct, created lazily when a pane first renders its
    toolbar, each with its own `cx.subscribe` wiring (current subscription is
    set up near ~21715; commit path is `InputEvent::PressEnter` →
    `commit_browser_address` (~23595-ish, search for it) →
    `load_active_browser_cef_url`). Commit must target the pane that owns the
    input, not the globally focused pane. Remove entries when a pane is
    removed from the tree (tab close / split collapse paths call into
    `BrowserTabModel::close_tab` ~8438; hook cleanup where the model reports
    removed panes, or reconcile after mutations by retaining only pane ids
    still present in the tree).
  - Update every other reference to `self.address_input` (there are a handful:
    ~32872, ~33269, ~33299, ~52055) to resolve the correct pane's input.
    `sync_active_browser_tab_to_surface` (~33241 region) and
    `handle_browser_page_metadata_event`'s `AddressChanged` arm (~32820
    region) must update the input belonging to the pane that owns the tab
    (find it via the model's pane→tab mapping), not a global field.
  - `perform_browser_toolbar_action` (~32877 region, `BrowserToolbarAction`
    enum ~8994) must carry the pane id so back/forward/reload/zoom/devtools
    act on that pane's active surface. Existing hotkey/menu entry points that
    call these without a pane id should use the focused pane
    (`browser_tabs.focused_pane`), preserving current hotkey behavior.
  - Toolbar background: the workspace root currently sets
    `.bg(browser_toolbar_background())`; keep the overall background sane
    (the leaf now owns the toolbar row).
  - Keep all existing toolbar buttons (back+back-history, forward+forward-
    history, reload, address field, conditional zoom reset, feedback tool,
    history menu, beta-gated profile, devtools) working per-pane.
- acceptance_criteria:
  - `cd /Users/madda/dev/_active/Ghostex/gpui && cargo check` passes with no
    new errors.
  - `render_browser_workspace` no longer renders a toolbar; the toolbar is
    rendered inside `render_browser_leaf` strictly between the tab strip and
    the body (verifiable by reading the two functions).
  - There is no remaining single `address_input` field on the app struct;
    address input state is keyed per `BrowserPaneId`, with cleanup when panes
    go away (verifiable by reading the struct fields and the close paths).
  - Address commit (`PressEnter`) navigates the OWNING pane's active tab even
    when another pane is focused (verifiable by reading the subscription and
    commit code path — it must not consult the focused pane to pick the tab).
  - Each pane's toolbar reads back/forward/zoom state from that pane's active
    surface, not from `active_browser_surface` of the focused pane.

## Phase 2: CEF loading state + reload/stop toggle

- depends_on: [1]
- parallel_ok: false
- goal: Surface CEF loading state for browser tabs and make the reload button
  toggle to Stop while a page is loading, exactly like macOS
  (`reloadPage()` ~31094 toggles stop/reload based on `isPageLoading()`;
  state arrives via `navigationStateChangedHandler(canGoBack, canGoForward,
  isLoading)`). Do NOT add a per-tab spinner — macOS has none.
- files: `gpui/src/cef/shell.rs`, `gpui/src/main.rs`. If per-OS glue files
  (`gpui/src/cef/macos.rs`, `windows.rs`, `linux_x11.rs`) need signature
  updates to compile, update them minimally.
- do_not_touch: `native/**`, `shared/**`, the sidebar-specific load handlers
  (`GhostexGpuiSidebarProjectContextLoadHandler`,
  `GhostexGpuiProjectWorkareaBridgeLoadHandler` in shell.rs ~796/~832) —
  leave their behavior unchanged.
- approach:
  - shell.rs: extend `BrowserPageMetadataEvent` (~523) with a variant like
    `LoadingStateChanged { is_loading: bool, can_go_back: bool, can_go_forward: bool }`.
    Implement/attach a CEF `LoadHandler` whose `on_loading_state_change`
    forwards through the existing `page_metadata_handler` plumbing (~2096,
    ~2270) for browser-tab clients (the ones created with a page metadata
    handler). The macOS bridge equivalent is
    `navigationStateChangedHandler` in `GhostexCEFBridge.h` — same three
    values.
  - shell.rs: add `pub fn stop_load(&self)` (or `stop_loading`) on
    `CefBrowser` next to `reload` (~2564), calling the CEF browser-host stop.
  - main.rs: in `handle_browser_page_metadata_event` (~32812), handle the new
    variant: record `is_loading` (plus the two can_go flags) as runtime state
    reachable from the owning tab/pane — e.g. on the `CefSurface` entity or a
    runtime field next to `runtime_page_title` on `BrowserTab` — and notify so
    the toolbar re-renders.
  - main.rs toolbar: while the pane's active tab is loading, the reload
    button renders as Stop (use an existing X/close-style SVG from the
    `BROWSER_ICON_*`/titlebar asset set; macOS uses `xmark`) with tooltip
    "Stop Loading", and clicking it calls `stop_load`; otherwise it renders
    reload with tooltip "Reload" as today. Extend `BrowserToolbarAction` if
    that is the cleanest fit with the existing dispatch.
  - Back/forward enabled state may now also refresh from the event rather
    than only polling `can_go_back()`/`can_go_forward()` on render; keep
    whichever is simpler but make sure state stays fresh after navigations.
- acceptance_criteria:
  - `cd /Users/madda/dev/_active/Ghostex/gpui && cargo check` passes with no
    new errors.
  - `BrowserPageMetadataEvent` has a loading-state variant emitted from a CEF
    load handler `on_loading_state_change` for browser-tab clients
    (verifiable in shell.rs).
  - `CefBrowser` exposes a stop-load method calling the CEF host stop
    (verifiable in shell.rs).
  - The toolbar reload button code path renders Stop + dispatches stop while
    `is_loading` is true for that pane's active tab, reload otherwise
    (verifiable in main.rs).
  - No per-tab spinner or loading UI was added to the tab strip.
  - Sidebar load handlers in shell.rs are byte-for-byte unchanged in
    behavior.

## Phase 3: Address field behavior parity

- depends_on: [2]
- parallel_ok: false
- goal: Make the address field behave like macOS `WebPaneHostView`
  (~30430-31163): placeholder text, edit-vs-mirror rules, Escape revert,
  commit refocus, auto-focus on new tab creation, restored-URL seeding.
- files: `gpui/src/main.rs` only.
- do_not_touch: `gpui/src/cef/**`, `normalize_address` (already matches
  macOS), the history/profile/devtools/feedback buttons.
- approach: implement each of these observable behaviors, checking first
  whether gpui already does it (some may partially exist):
  1. Placeholder: the field shows "Search or enter address" when empty
     (macOS ~30872).
  2. Mirroring: when the user is NOT editing the field, URL changes
     (navigation, tab switch, `AddressChanged` events) update the field
     text. While the field is focused/being edited, incoming URL changes
     must NOT clobber the user's text (macOS `isEditingAddress` guard in
     `updateBrowserToolbarState` ~30962). Track an is-editing flag per pane
     input (focus/blur or edit events on `InputState`).
  3. Escape: pressing Escape while editing reverts the field text to the
     current URL of the pane's active tab and returns focus to the page
     content (macOS `cancelOperation` ~30784 region).
  4. Commit: pressing Enter navigates (existing path) AND returns focus to
     the browser content view, not the input (macOS ~30797-30818 refocuses
     after commit). gpui side: after commit, focus the pane's `CefSurface`
     (there are existing focus helpers used when clicking the page).
  5. New-tab auto-focus: when a new placeholder tab is created via the
     new-tab button, hotkey, or action (`add_browser_tab` ~33306 family,
     `add_address_placeholder_tab` model op ~8223), the owning pane's
     address field gets focus with the caret ready (macOS
     `focusAddressField(selectAll:false)` called at tab creation ~6368).
     Do not select-all.
  6. Restored/placeholder URL seeding: a restored-placeholder or
     address-only tab shows its persisted URL in the field when selected
     (macOS about:blank seeding ~30984-30988; gpui already has
     `active_address_value` ~8768 — verify it covers restored placeholders
     and wire it through the per-pane inputs from Phase 1).
  7. Security icon: https → lock icon, anything else → globe (macOS
     ~30972). gpui has `browser_security_icon_path` (~58800 region) —
     verify the scheme rule matches exactly and fix if not.
- acceptance_criteria:
  - `cd /Users/madda/dev/_active/Ghostex/gpui && cargo check` passes with no
    new errors.
  - Each of behaviors 1-7 above is implemented (or verified already
    present) in code, with the edit-guard (2), Escape revert (3), commit
    refocus (4), and new-tab focus (5) each traceable to a concrete code
    path in main.rs.
  - URL mirroring goes through the per-pane inputs from Phase 1 (no global
    input reintroduced).

## Phase 4: Visual parity (heights, colors, fonts)

- depends_on: [3]
- parallel_ok: false
- goal: Match the macOS browser chrome's measurements and colors in the gpui
  tab strip and address toolbar.
- files: `gpui/src/main.rs` only (layout consts ~688-720, color functions
  ~56385-56445 region, and the render functions that use them).
- do_not_touch: `gpui/src/cef/**`, layout/behavior logic from Phases 1-3
  (only sizes/colors/fonts change here).
- approach: apply these macOS reference values (sources:
  `TerminalWorkspaceView.swift` ~26880-26988, ~30166-30184, ~30507-30523,
  ~30866, ~2908):
  - Tab bar height: 34px (macOS `projectBrowserTabBarHeight = 34`; gpui
    `BROWSER_TAB_BAR_HEIGHT` is currently 32.0 at ~699). Adjust dependent
    paddings/drop-marker sizes that reference it so nothing clips.
  - Tab strip colors: background `#050608` at 0.96 alpha; tab-bar separator
    `#252525`; border `#586F95` at 0.24 alpha; tab title color `#E1E1E1`;
    action cluster (new-tab/overflow area) background `#0E0E0E` with a 1px
    `#252525` leading separator.
  - Address toolbar (height 40 and button size 28 already match — keep):
    background black; button icon tint white at 0.86 brightness, 0.82
    alpha (macOS `NSColor(white: 0.86, alpha: 0.82)`); security icon tint
    white 0.78 / alpha 0.9; address text white 0.94 / alpha 0.95; security
    icon 14x14; horizontal padding 12; item gap 10; address min width 180.
  - Address field font: 13px medium weight, middle truncation for long URLs
    if the input component supports it (macOS 13pt system medium,
    `.byTruncatingMiddle`).
  - Update the existing free color functions (`browser_tab_bar_color`
    ~56630, `browser_toolbar_background`, `browser_tab_active_color`,
    `browser_tab_text_color`, `browser_tab_border_color`,
    `browser_tab_action_cluster_color`, toolbar tint functions, etc.) rather
    than inlining rgb values at call sites. Hover/active tab shades: keep
    gpui's existing relative hover/active treatment but rebase it on the new
    base colors so hover is still distinguishable.
- acceptance_criteria:
  - `cd /Users/madda/dev/_active/Ghostex/gpui && cargo check` passes with no
    new errors.
  - `BROWSER_TAB_BAR_HEIGHT` is 34.0 and the listed color functions return
    the macOS values above (verifiable by reading the constants/functions).
  - Address field text size is 13px / medium weight.
  - No behavior code from Phases 1-3 was altered (colors/sizes/fonts only).

## Handoff notes

(appended by the orchestrator as phases complete)

### After Phase 1
Phase 1 moved the browser toolbar into each pane leaf between the tab strip
and the body, replaced the single `address_input` with per-`BrowserPaneId`
input/subscription maps, routed address commits and metadata mirroring
through the owning pane, and made toolbar actions (history, zoom, feedback,
profile, devtools) pane-scoped. All in `gpui/src/main.rs`; `cargo check`
passes. Later phases: toolbar render/dispatch paths are now parameterized by
pane id — keep that shape.

### After Phase 2
Phase 2 added a `LoadingStateChanged` variant emitted by a browser-tab CEF
LoadHandler in `gpui/src/cef/shell.rs`, `stop_load` through `CefBrowser` /
`CefSurface` / `BrowserToolbarAction::StopLoading`, runtime
loading/back/forward state stored on `BrowserTab`, and a reload button that
swaps to Stop Loading while loading. Only `gpui/src/cef/shell.rs` and
`gpui/src/main.rs` changed; `cargo check` passes.

### After Phase 3
Phase 3 added per-pane address edit tracking with guarded URL mirroring
while the field is focused, Escape revert + focus return to page content,
Enter commit that navigates the owning pane and schedules CEF content
refocus, and address-field auto-focus for new placeholder tabs. Restored /
address-only URL seeding preserved. Only `gpui/src/main.rs` changed;
`cargo check` passes.

### After Phase 4
Phase 4 set `BROWSER_TAB_BAR_HEIGHT` to 34.0, rebased tab strip / active /
hover / separator / border / title / action-cluster colors to the macOS
values, and confirmed toolbar sizing and the 13px medium address font. Only
`gpui/src/main.rs` changed; `cargo check` passes with pre-existing warnings
only.
