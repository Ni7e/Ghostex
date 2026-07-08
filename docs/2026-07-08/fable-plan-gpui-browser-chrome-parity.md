# Plan: GPUI browser tabs bar + address toolbar parity with the macOS app

Date: 2026-07-08

## Overall goal

The gpui app (`gpui/`) has a browser mode with a per-pane tabs bar and an
address toolbar. Its UI/UX must match the **macOS app's browser chrome as the
absolute source of truth**. The macOS implementation lives in
`native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift`
(abbreviated **TWV** below; ~line anchors given, they may drift slightly —
relocate by symbol name). The gpui implementation lives in
`gpui/src/main.rs` (~84k lines; **always relocate by `rg -n "fn <name>"`,
line numbers drift**).

This plan is a styling/behavior parity change. It does NOT restructure the
browser tab model, CEF surface management, drag-and-drop, splits, or
persistence.

## Repo rules every worker must follow

- **Do not write any tests** in `gpui/` (repo rule: no tests in the gpui app).
- **No fallback code**: fix behavior at the source, never add
  try-then-fall-back logic.
- Never run `bun run start`, `scripts/start-gpui.mjs`, or anything that
  launches/restarts the Ghostex or gpui app. Verification is code-level only:
  `cd gpui && cargo check` must pass.
- The repo has **uncommitted changes in multiple files** (including
  `gpui/src/main.rs`). Never run `git restore`, `git checkout --`,
  `git stash`, `git clean`, or any command that could discard work. Only edit
  the code regions this plan names.
- Preserve all `CDXC:` invariant doc comments in the code you touch. If your
  change makes part of a CDXC comment stale, update the comment text to
  describe the new behavior — do not delete the block. Key invariants that
  MUST survive:
  - Chrome is real, non-overlapping layout — no transparent overlays, no
    hit-test rerouting (CDXC:GPUIBrowserSplits / KeyboardFocus).
  - Tab-bar brightness is focus-invariant — appearance derives only from
    shell state + surface presence + active-in-own-group, never from
    `focused_pane` (CDXC:GPUIBrowserTabs 2026-06-22-17:13).
  - The favicon slot must keep distinguishing LoadedSurface vs
    RestoredPlaceholder (teal dot) vs AddressOnly (neutral dot)
    (CDXC:GPUIBrowserTabs 2026-06-22-16:48).
  - Closing the last tab resets to an AddressOnly placeholder, never an
    empty workspace (existing model behavior in `close_tab`).
  - Runtime page titles / favicon URLs stay memory-only; persistence stays
    sanitized (CDXC:GPUIBrowserFavicons / Metadata privacy).

## Intentional deviations from macOS (KEEP these gpui features; the verifier
must NOT flag them):

- Tab drag-to-reorder, drag-to-split (pane body drops), the insertion
  marker, and the end-of-strip drop target stay. macOS browser tabs have no
  drag, but removing this gpui feature is out of scope.
- The tab-strip overflow button (pane actions menu: "New Browser Tab in This
  Pane" / "Split Right…" / "Split Below…") stays, restyled to the macOS
  cluster chrome (Phase 1). macOS's browser strip has no overflow button, but
  it is the discoverable entry to gpui-only split actions.
- Tab selection stays on left mouse-DOWN (macOS selects on mouse-up; gpui
  selects on mouse-down because drag begins on the same gesture).
- The macOS "sticky active-tab proxy" (30px chevron pill when the active tab
  scrolls out of view) is out of scope. gpui's existing auto-scroll-to-active
  behavior stays.
- gpui's status-dot / URL-marker favicon fallbacks stay (invariant above).
- macOS's two-line attributed history menu rows, favicon icons in menu rows,
  and "Show More" paging are out of scope; only the open-in-new-tab behavior
  and header are ported (Phase 2).
- No beep on empty address commit (gpui has no NSSound path here); the
  restore behavior alone is ported.

## Source of truth: exact macOS values

### Tabs bar (TWV `TerminalSessionTitleBarView`, browser strip)
- Bar height 34 (`projectBrowserTabBarHeight`, TWV:2957). Sits ABOVE the
  toolbar. Background `#050608` at 0.96 alpha (TWV:27130). Bottom 1px
  separator `#252525` (TWV:27124).
- Tabs: flat rectangles, corner radius 0. Gap between tabs **2px**. Width:
  max **175**, min **170**; a single tab is `min(175, available)`; multiple
  tabs share evenly `(available - 2*(N-1)) / N` clamped to >= 170, then the
  strip scrolls horizontally (TWV:29054-29065).
- Tab fill: translucent WHITE overlay on the bar — active `white @ 0.13`,
  inactive `white @ 0.06`. **No hover fill change**; hover only reveals the
  close button (TWV:26099-26106, 26279-26315).
- Tab title: system font **13px regular** (same weight active and inactive),
  left-aligned, tail truncation. Color: active `white 0.96 @ 0.98`; inactive
  `white 0.78 @ 0.82` (TWV:25908, 26780-26797).
- Favicon/identity icon: 14×14 at leading padding **8**, gap to title **5**
  (TWV:25894-25897).
- Close button: **hover-only** (visible only while the tab is hovered),
  20×20, trailing inset 4, corner radius 0, background `#0e0e0e` (same
  normal and hover), "X" drawn as two 1.5pt strokes `#cfcfcf` inset ~5.8pt
  (glyph ~8.4px) (TWV:26763-26778, 26995-27050, 25582-25593).
- A sole placeholder ("New Tab") tab does not allow close; close is allowed
  when any other tab exists (`allowsClose: !tab.isPlaceholder ||
  session.tabs.count > 1`, TWV:6117).
- Middle-click (other mouse button) on a tab closes it (TWV:26560-26602).
- Tab tooltip = the tab title (TWV:27534).
- Right-pinned action cluster: buttons **42 wide × full bar height (34)**,
  square, background `#0e0e0e`, icon tint `#cfcfcf`, icon size ~15px, each
  button has a **1px left border `#252525`** (TWV:27234-27243, 29246-29331).
  The browser strip shows only the `plus` (new tab) button. Hover background
  `white @ 0.11` (TerminalTitleBarActionButton default, TWV:25596-25600).
- Double-click on empty tab-bar area creates a new browser tab
  (TWV:27879-27916).

### Address toolbar (TWV `WebPaneHostView`)
- Height 40, background pure black, no border of its own (TWV:30399, 30414).
- Buttons 28×28, horizontal padding 12, gap 10 (TWV:30400-30402).
- Left cluster: Back (chevron.left), Forward (chevron.right), Reload —
  **the Reload icon never changes while loading**; only the action and
  tooltip toggle to Stop Loading (TWV:30456, 31201, 31327-31350). There are
  **no history dropdown/toggle buttons attached to Back/Forward**.
- Button styling: **no hover or pressed background, no rounding** — tint is
  identical in all states: `white 0.86 @ 0.82`. Disabled tint is the same
  color **with alpha replaced by 0.4** (i.e. `white 0.86 @ 0.4`)
  (TWV:31885-31890, 25819-25823).
- Security icon 14×14 (`lock.fill` for https, else `globe`), tint
  `white 0.78 @ 0.9`, positioned **18px after** the left cluster; the
  address text starts 22px after the icon's x (= 8px gap after the 14px
  icon) (TWV:31175-31192, 31084-31086).
- Address field: height 20, vertically centered, borderless, no background,
  no focus ring, font 13 medium, text `white 0.94 @ 0.95`, placeholder
  "Search or enter address", middle-truncation, shows the FULL current URL
  (never the page title) (TWV:31089-31106).
- Address field right edge ends **14px before** the right cluster
  (TWV:31182).
- Right cluster visual order left→right: Zoom-reset (only when zoom ≠ 0,
  tooltip "Reset Page Zoom (N%)" where `N = round(1.2^zoomLevel * 100)`),
  Feedback tool (disabled on github.com hosts), History, Profile (only with
  Show Beta features), DevTools (TWV:31167-31173, 31250-31278).
- Empty address commit: do NOT navigate — restore the current URL into the
  field and return focus to page content (TWV:31361-31368). Non-empty
  normalization: has scheme → as-is; localhost/127.0.0.1 → `http://`;
  contains `.` and no space → `https://`; else Google search
  (TWV:31856-31873). (gpui's non-empty rules already match.)
- Selecting a History-menu entry opens the URL in a **NEW tab**, it does not
  navigate the current tab (TWV:4790-4797, 5756-5766). The menu has a
  disabled "History" header row followed by a separator (TWV:31471-31529).
- Escape while editing: restore current URL, refocus page content
  (TWV:31052-31057). (gpui already matches.)
- Commit (Enter): navigate, then move focus to the web content
  (TWV:31017-31051). (gpui already matches.)

## gpui code map (where to make the changes)

All in `gpui/src/main.rs` unless noted. Relocate every anchor with
`rg -n "<symbol>" gpui/src/main.rs` before editing.

- Constants block ~line 691-719: `BROWSER_TOOLBAR_*`, `BROWSER_TAB_*`,
  `BROWSER_HISTORY_*`.
- Tab strip renderers: `render_browser_tab_strip`, `render_browser_tab`,
  `render_browser_tab_icon`, `render_browser_tab_close_button`,
  `render_browser_tab_action_cluster`, `render_browser_tab_new_icon`,
  `render_browser_tab_overflow_icon`,
  `render_browser_tab_strip_end_drop_target`,
  `render_browser_tab_insertion_marker`, `BrowserTabDragPreview` render.
- Toolbar renderers: `render_browser_toolbar`,
  `render_browser_toolbar_button`, `render_browser_history_toggle_button`,
  `render_browser_address_field`, `titlebar_svg_icon`.
- Color helpers ~57258-57312 + ~58092-58189: `browser_toolbar_background`,
  `browser_toolbar_text_color`, `browser_toolbar_button_icon_color`,
  `browser_toolbar_disabled_icon_color`, `browser_toolbar_button_hover_color`,
  `browser_tab_bar_color`, `browser_tab_active_color`,
  `browser_tab_hover_color`, `browser_tab_action_cluster_color`,
  `browser_tab_separator_color`, `browser_tab_border_color`,
  `browser_tab_text_color`, `browser_tab_close_color`,
  `browser_tab_close_hover_color`.
- Address input plumbing: `sync_browser_address_inputs`,
  `commit_browser_address_for_pane`, `cancel_browser_address_edit_for_pane`,
  `normalize_address` (~59860, doc comment says it must mirror macOS).
- Menus: `show_browser_recent_history_menu`, `show_browser_history_menu`,
  `show_browser_pane_actions_menu`, `show_browser_tab_context_menu`
  (gpui_component NativeMenu).
- New/close tab: `add_browser_tab`, `close_browser_tab`,
  `open_browser_popup_tab`, model methods `add_address_placeholder_tab`,
  `add_loaded_popup_tab`, `close_tab` (~8319).
- Icon SVG assets in `gpui/assets/titlebar/` (`xmark.svg`, `reload.svg`,
  etc.), referenced by `BROWSER_ICON_*` constants ~line 617-796.

---

## Phase 1: Tabs bar parity

- depends_on: []
- parallel_ok: false
- goal: Make the gpui browser tab strip visually and behaviorally match the
  macOS browser tabs bar: macOS tab sizing (170-175px shared, 2px gaps, no
  per-tab right border), translucent-white tab fills with no hover fill,
  13px-regular titles with macOS colors, macOS favicon/title paddings,
  hover-only 20×20 close button with drawn-X styling and placeholder close
  suppression, middle-click close, tab tooltips, macOS-chrome action cluster
  (42px-wide square buttons on #0e0e0e with 1px #252525 left borders),
  and double-click-empty-area new tab.
- files: `gpui/src/main.rs` (tab-strip render functions, tab color helpers,
  `BROWSER_TAB_*` constants listed in the code map above).
- do_not_touch: `render_browser_toolbar*`, `render_browser_address_field`,
  `render_browser_history_toggle_button`, `normalize_address`,
  `commit_browser_address_for_pane`, `show_browser_recent_history_menu`,
  any file other than `gpui/src/main.rs`, anything under `native/`,
  `sidebar/`, `src/`, `shared/`. Do not change the tab model
  (`BrowserTabModel`, `BrowserTab`, drag/drop, splits) except where a task
  below explicitly names it.
- approach:
  1. **Constants**: replace `BROWSER_TAB_WIDTH: f32 = 184.0` with
     `BROWSER_TAB_MAX_WIDTH: f32 = 175.0`, `BROWSER_TAB_MIN_WIDTH: f32 =
     170.0`, `BROWSER_TAB_GAP: f32 = 2.0`. Update `BrowserTabDragPreview`
     and every other `BROWSER_TAB_WIDTH` use (drag preview uses the max
     width). Replace `BROWSER_TAB_CLOSE_SIZE: f32 = 18.0` with `20.0`.
  2. **Tab sizing**: tabs render at `w(BROWSER_TAB_MAX_WIDTH)` with
     `min_w(BROWSER_TAB_MIN_WIDTH)` and `flex_shrink()` so they compress
     from 175 to 170 before the strip scrolls, with `gap` of 2px between
     tabs (use the strip container's gap or per-tab margin; remove the
     `border_r_1` / `browser_tab_border_color` separator entirely — macOS
     tabs have gaps, not borders). If gpui's `overflow_x_scroll` container
     lays children at natural size and never shrinks them, compute the
     fitted width from the measured strip width (the pane leaf bounds are
     already known to the renderer via existing layout state); do NOT add
     overlays or hit-test tricks. The acceptance criterion is the sizing
     rule (175 max, 170 min, 2px gap, scroll on overflow), not a specific
     mechanism.
  3. **Fills**: `browser_tab_active_color()` → `white @ 0.13`
     (`gpui::white().opacity(0.13)` or hsla equivalent);
     inactive tabs get `white @ 0.06` (new helper
     `browser_tab_inactive_color()`), applied always — not only on hover.
     Delete the hover fill change (`browser_tab_hover_color` and its
     `.hover(...)` usage on tabs); hover must not alter the tab background.
     Keep the focus-invariance CDXC comment accurate.
  4. **Title**: `text_size(px(13.))`, `FontWeight::NORMAL` for active AND
     inactive (remove the SEMIBOLD-when-active branch). Rewrite
     `browser_tab_text_color(state, is_active)`: active →
     `white 0.96 @ 0.98`; inactive → `white 0.78 @ 0.82` for both Loaded
     and AddressOnly (drop the extra @0.46 dimming for AddressOnly — macOS
     does not distinguish; the favicon status dot already does, per the
     CDXC invariant which must keep working).
  5. **Paddings**: tab `pl` 11 → **8**; favicon-to-title gap (`ml` on the
     title div) 8 → **5**. Favicon slot stays 14×14 with all four existing
     render paths unchanged.
  6. **Close button**: rendered ONLY while the tab is hovered (use the
     div's hover state / gpui group-hover on the tab id — a real
     conditional child, no overlay), 20×20, corner radius 0, trailing
     inset 4 (adjust tab `pr` accordingly so the button sits 4px from the
     tab's right edge), background `#0e0e0e` in normal AND hover states.
     Replace the literal `"x"` text child with the `xmark.svg` asset via
     `titlebar_svg_icon(BROWSER_ICON_STOP, 8.5, rgb(0xcfcfcf))` (macOS
     draws two 1.5pt `#cfcfcf` strokes ≈ an 8.4px glyph). Update
     `browser_tab_close_color`/`browser_tab_close_hover_color` helpers to
     the new scheme (tint `#cfcfcf` constant; bg `#0e0e0e` constant) or
     replace them. Suppress the close button when the tab is `AddressOnly`
     AND it is the only tab in its pane's tab group (macOS placeholder
     rule). When the close button is not shown, the title simply extends —
     no reserved blank space needed beyond the existing `pr`.
  7. **Middle-click close**: add a middle-button handler
     (`MouseButton::Middle`, on mouse-up like macOS) on the tab div that
     calls the same `close_browser_tab` path, respecting the same
     sole-placeholder suppression as step 6.
  8. **Tooltip**: add a `Tooltip` (gpui_component tooltip, same pattern as
     the toolbar buttons) on each tab showing `display_title`.
  9. **Action cluster**: restyle `render_browser_tab_action_cluster`: the
     cluster is `2 × 42 = 84`px wide (update
     `BROWSER_TAB_ACTION_CLUSTER_WIDTH` to 84.0 and
     `BROWSER_TAB_ACTION_BUTTON_SIZE` semantics: buttons are **42 wide ×
     full bar height**, square, `rounded_none`), background `#0e0e0e`
     (`browser_tab_action_cluster_color` stays), each button gets a 1px
     LEFT border `#252525` (`browser_tab_separator_color`), remove the
     inner `gap` and the rounded hover pill. Icon tint `#cfcfcf`; hover
     background `white @ 0.11` covering the whole 42×34 button. Scale the
     drawn plus glyph to ~15px arm length (`render_browser_tab_new_icon`)
     and keep the three-dot overflow icon centered. New-tab fires on left
     mouse-DOWN, overflow menu on left mouse-UP (macOS behavior). Keep
     both buttons' existing actions and tooltips.
  10. **Double-click empty area**: on the end drop target
     (`render_browser_tab_strip_end_drop_target`), add a double-click
     handler that calls `add_browser_tab` for that pane (macOS
     double-click-empty-chrome behavior). Keep its drag/drop role intact.
  11. Update any CDXC comment whose prose now describes stale styling
     (e.g. mentions of 184px tabs or always-visible close), keeping the
     invariant statements intact.
  12. Do not touch the drag/drop handlers, insertion marker logic (its
     geometry may reference the new constants), scroll handle logic, or
     favicon pipeline beyond what is listed.
- acceptance_criteria:
  - `cd gpui && cargo check` exits 0 with no new warnings about unused
    browser tab helpers (delete helpers that became dead).
  - `rg -n "BROWSER_TAB_WIDTH" gpui/src/main.rs` returns nothing;
    `BROWSER_TAB_MAX_WIDTH = 175`, `BROWSER_TAB_MIN_WIDTH = 170`,
    `BROWSER_TAB_GAP = 2` exist and are used by `render_browser_tab` /
    the strip renderer.
  - In `render_browser_tab`: no `border_r`, no hover background change,
    active fill `white @ 0.13`, inactive fill `white @ 0.06`, title
    13px `FontWeight::NORMAL` in both states, text colors
    `0.96 @ 0.98` active / `0.78 @ 0.82` inactive, `pl` 8, icon-title
    gap 5, and a tooltip bound to the tab's display title.
  - `render_browser_tab_close_button` renders only under a hover
    condition, is 20×20 `rounded_none` with `#0e0e0e` background and an
    ~8.5px `#cfcfcf` xmark svg, and is suppressed for a sole AddressOnly
    tab; a `MouseButton::Middle` close handler exists on the tab.
  - `render_browser_tab_action_cluster` uses 42px-wide, bar-height,
    `rounded_none` buttons with 1px left border `#252525` on `#0e0e0e`,
    hover `white @ 0.11`; cluster width constant is 84.
  - The end drop target has a double-click handler invoking the pane's
    add-browser-tab path.
  - The tab-appearance code still derives ONLY from shell state + chrome
    status + active-in-group (no `focused_pane` reads added), and the
    favicon status-dot paths are unchanged.

## Phase 2: Address toolbar parity

- depends_on: [1]
- parallel_ok: false
- goal: Make the gpui browser toolbar match the macOS address toolbar:
  remove the gpui-only back/forward history dropdown toggles, make toolbar
  buttons stateless (no hover/pressed background) with macOS disabled alpha,
  keep the Reload icon fixed while loading (action/tooltip toggle only),
  correct the address-field spacers to 18/14, restore-instead-of-Google on
  empty address commit, zoom tooltip with live percent, and History-menu
  entries opening in a new tab with a disabled "History" header.
- files: `gpui/src/main.rs` (toolbar render functions, toolbar color
  helpers, `normalize_address`, `commit_browser_address_for_pane`,
  `show_browser_recent_history_menu` and related menu/action plumbing,
  `BROWSER_TOOLBAR_*` constants).
- do_not_touch: the tab-strip render functions and tab color helpers Phase 1
  changed (`render_browser_tab*`, `browser_tab_*` helpers), the tab model,
  drag/drop, CEF surface lifecycle, any file other than `gpui/src/main.rs`.
- approach:
  1. **Remove history toggles**: delete
     `render_browser_history_toggle_button` and its call sites in
     `render_browser_toolbar` (the 18×28 "v" buttons next to Back and
     Forward, and the sub-h_flex gap-2 pairing so Back/Forward become
     plain buttons at gap 10). Remove `show_browser_history_menu`
     (per-direction back/forward menu) and `BROWSER_HISTORY_TOGGLE_WIDTH`
     if nothing else uses them; keep the per-tab
     `BrowserNavigationHistory` model and `NavigateBrowserHistoryTo`
     action only if still referenced (the recent-history menu in step 7
     repurposes history entries; delete what becomes dead instead of
     leaving unused code). Update the CDXC:GPUIBrowserToolbar comments
     that describe the toggles.
  2. **Button states**: in `render_browser_toolbar_button`, remove the
     hover background entirely (macOS toolbar buttons have no hover or
     pressed chrome); enabled tint stays `white 0.86 @ 0.82`
     (current `0xdbdbdb @ 0.82` is the same value); change
     `browser_toolbar_disabled_icon_color()` to the same color with alpha
     **0.4** (macOS replaces alpha, not multiplies). Delete
     `browser_toolbar_button_hover_color` if now unused.
  3. **Reload/Stop**: keep `BROWSER_ICON_RELOAD` as the icon in BOTH
     states; while `runtime_is_loading` only the dispatched action
     (StopLoading) and tooltip ("Stop Loading") change. `xmark.svg`
     remains in use by Phase 1's close button.
  4. **Spacers**: left spacer between the button cluster and the address
     field group becomes exactly `BROWSER_TOOLBAR_ADDRESS_GAP` (18);
     right spacer becomes exactly `BROWSER_TOOLBAR_ADDRESS_RIGHT_GAP`
     (14). Remove the added `BROWSER_TOOLBAR_ITEM_GAP` from both spacer
     widths. The security-icon→text gap stays 8 (already correct).
  5. **Empty address commit**: change the commit path so an
     empty/whitespace input does NOT navigate: `normalize_address`
     returns `Option<String>` (or the commit path checks emptiness before
     normalizing), and empty input triggers the same restore path as
     Escape (`cancel_browser_address_edit_for_pane`: restore the tab's
     current URL into the field, refocus page content). The
     `DEFAULT_BROWSER_URL` fallback for empty input is removed from
     normalization; `DEFAULT_BROWSER_URL` itself stays for new-tab
     defaults. Non-empty rules are already macOS-identical — do not
     change them. Update the `normalize_address` doc comment.
  6. **Zoom tooltip**: the zoom-reset button tooltip becomes
     `"Reset Page Zoom (N%)"` with `N = (1.2f64.powf(zoom_level) * 100.0)
     .round() as i32` from the active tab's CEF zoom level (the
     `is_page_zoomed` plumbing already reads it).
  7. **History menu opens new tab**: in
     `show_browser_recent_history_menu`, selecting an entry must open the
     URL as a NEW loaded tab in that pane (reuse the existing loaded-tab
     creation path used by popups/`add_loaded_popup_tab` +
     `sync_active_browser_tab_to_surface`, or an equivalent existing
     shell method — do not add a parallel creation path), instead of
     dispatching `NavigateBrowserHistoryTo` on the current tab. Remove
     the current-row checkmark (macOS history rows are not checkable).
     Prepend a disabled "History" header item and a separator if the
     NativeMenu API supports disabled items (it renders disabled items
     for the pane-actions menu today); two-line rows/paging/favicons are
     explicitly out of scope.
  8. Address field display behavior (full URL, placeholder, 13px medium,
     no border/background, escape/commit focus handoff) already matches
     macOS — verify while in the code and leave unchanged.
  9. Update stale CDXC:GPUIBrowserToolbar prose (toggle removal, empty
     commit, hover removal) while keeping invariant statements.
- acceptance_criteria:
  - `cd gpui && cargo check` exits 0; no unused-code warnings from
    removed toggle/hover helpers.
  - `rg -n "render_browser_history_toggle_button|BROWSER_HISTORY_TOGGLE_WIDTH" gpui/src/main.rs`
    returns nothing.
  - `render_browser_toolbar_button` sets no hover background;
    `browser_toolbar_disabled_icon_color` has alpha 0.4;
    `browser_toolbar_button_hover_color` is gone or unused-free.
  - The toolbar reload button uses `BROWSER_ICON_RELOAD` regardless of
    loading state, with action/tooltip switching on `runtime_is_loading`.
  - The two toolbar spacers around the address field are exactly 18 and
    14 (no `BROWSER_TOOLBAR_ITEM_GAP` addend).
  - Empty/whitespace address commit restores the current URL and
    refocuses content; `rg -n "DEFAULT_BROWSER_URL" gpui/src/main.rs`
    shows no use inside address normalization.
  - Zoom-reset tooltip includes the computed percent.
  - Recent-history menu selection creates a new loaded tab (no
    `NavigateBrowserHistoryTo` dispatch from that menu; delete the action
    if it became fully dead) and the menu has a disabled "History" header.
  - Back/Forward buttons are plain 28×28 buttons with 10px gaps, enabled
    state still driven by the active tab's runtime can_go_back/forward.

## Handoff notes

- Phase 1 COMPLETE: tab sizing now 175 max / 170 min with 2px gaps,
  translucent white fills, 13px regular titles, macOS paddings, and tab
  tooltips in `gpui/src/main.rs`. Close chrome is hover-only (runtime hover
  tracking) using the xmark asset, suppressed for a sole AddressOnly
  placeholder; middle-click close and double-click-empty-strip new tab were
  added; the action cluster is 42px full-height square buttons with macOS
  colors. Verified with `cd gpui && cargo check`.
- Phase 2 COMPLETE: removed the Back/Forward history toggles and their
  menu/action plumbing; toolbar buttons are square/stateless with disabled
  alpha 0.4 and a static Reload icon while loading (action/tooltip toggle
  only); address spacers are 18/14; blank address commits restore/refocus
  instead of navigating; zoom tooltip shows the computed percent; the
  recent-history menu has a disabled "History" header and opens rows as new
  tabs. Verified with `cd gpui && cargo check`.
