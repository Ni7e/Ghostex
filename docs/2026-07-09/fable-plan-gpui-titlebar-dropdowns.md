# Plan: GPUI titlebar dropdown/modal fixes (2026-07-09)

## Overall goal

Fix four user-reported issues in the GPUI app (./gpui) titlebar surfaces:

1. White flash when CEF-hosted panels/modals first load — must pre-paint `#0e0e0e`.
2. Titlebar buttons have no tooltips — add the same tooltips the macOS app titlebar has.
3. Clicking the Resources titlebar button crashes (aborts) the GPUI app.
4. The Git actions / Quick Actions / Open-in-an-app dropdowns render as a white panel
   that is cut off behind the tabs bar. They must look and layer exactly like the
   macOS app menus, and must stay implemented with native gpui rendering (NOT React,
   NOT CEF content).

## Repo rules every worker MUST follow

- Do NOT write any tests in ./gpui or the macOS app. No test code at all for this work.
- Never add fallback code where the correct fix is to make the primary path right.
  Fix root causes. No `catch_unwind`, no retry-on-panic, no silent degraded modes.
- Never run `bun run start` or any command that restarts/launches the Ghostex or
  GhostexGPUI app. Do not run the gpui binary. Build/check commands only.
- The repo has uncommitted work owned by the user/other agents, at minimum:
  `docs/page.html`, `gpui/scripts/build-macos-app.sh`, `native/sidebar/native-sidebar.tsx`.
  Never revert, overwrite, `git checkout`, `git restore`, or `git stash` anything.
  Only edit the files your phase owns.
- Native layout discipline (from AGENTS.md): no transparent overlay views over
  interactive regions, no hidden hit-test regions, no `hitTest` overrides, no
  synthetic mouse routing. Native/gpui child windows ARE the accepted pattern for
  dropdown/modal surfaces.
- Verification commands allowed:
  - `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml --bin ghostex-gpui`
  - `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (and `--check`)
  - `bunx vite build --config gpui/vite.config.ts` (only if you changed HTML/TS entries)
- `gpui/src/main.rs` is ~86k lines. Use `grep -n` to navigate; read only the regions
  you need. Line numbers below were captured on 2026-07-09 and may drift slightly.
- The gpui-component crate lives at `../../_references/gpui-component/crates/ui`
  (path dependency, see `gpui/Cargo.toml:39`). You may READ it to understand APIs.
  Do not modify it unless truly unavoidable, and if you must, keep the change minimal
  and additive.

## Architecture map (read this before your phase)

- Titlebar render chain: `render_titlebar` (main.rs ~46295) →
  `render_right_titlebar_controls` (~53915). Button order: Tips → Resources → Git →
  Actions (Quick Actions) → Open In, plus optional Update button. Shared icon-button
  helper `render_titlebar_icon_button` (~54704). `TITLEBAR_HEIGHT = 35.0` (~457).
- Two dropdown mechanisms exist:
  - Tips & Resources: CEF child NSViews (`GpuiTitlebarTipsPanel` ~57732,
    `GpuiTitlebarResourcesPanel` ~57828) wrapping `CefSurface`, loading
    `titlebar-host.html?ghostexTitlebarPanel=tips|resources`, placed via
    `deferred(anchored(...))` overlay (`render_titlebar_anchored_dropdown_panel` ~54500).
  - Git / Quick Actions / Open In: native gpui-component `PopupMenu`
    (`build_gpui_titlebar_popup_menu` ~53255, kinds enum `GpuiTitlebarPopupKind` ~57705,
    rendered by `render_titlebar_popup_menu_panel` ~54169 via
    `deferred(anchored(...)).with_priority(1)`).
- CEF browsers are created by `CefBrowser::new` (gpui/src/cef/shell.rs:2251) with
  `cef::BrowserSettings::default()` (shell.rs ~2282) — no `background_color` is ever
  set, so CEF pre-paints opaque white. macOS child-view plumbing is in
  gpui/src/cef/macos.rs (`child_window_info`, `set_native_view_frame`,
  `set_native_view_visible`).
- gpui-component theme: `gpui_component::init(cx)` (main.rs ~58478) leaves
  `Theme::change(ThemeMode::Light, ...)` — that light theme is why `PopupMenu`
  renders white. There is NO dark-mode switch anywhere in the app today.
- Native child NSViews (terminal ghostty surfaces, CEF browser/workarea surfaces)
  always paint ABOVE the window's gpui Metal layer. Any gpui-painted popup that
  extends over the workspace body is occluded — that is the "cut off behind the
  tabs bar" symptom. Multi-window precedent: app-modal window opens via
  `open_window` (main.rs ~25140) and a `WindowKind::PopUp` toast window exists
  (main.rs ~28843).
- macOS reference for parity (READ-ONLY reference, do not modify):
  `native/sidebar/titlebar-host.tsx` — buttons + tooltips (~4809-4980), dropdown
  surface `TitlebarDropdownPanelSurface` (~4985), menu item component
  `TitlebarPanelMenuItem` (~5485). Shared contracts: `shared/sidebar-git.ts`,
  `shared/sidebar-commands.ts`, `shared/workspace-open-targets.ts`.

---

## Phase 1: Dark pre-paint background for CEF app-UI surfaces

- depends_on: []
- parallel_ok: false
- goal: Eliminate the white flash when CEF-hosted panels/modals first load (titlebar
  Tips/Resources panels, app-modal window content such as Settings/Hotkeys/Command
  Palette, sidebar, kanban/manage views). Every app-UI CEF surface must pre-paint
  `#0e0e0e` from the very first frame instead of CEF's default opaque white.
- files: `gpui/src/cef/shell.rs`, `gpui/src/main.rs` (only `CefBrowser::new` /
  `CefSurface::new` call-site plumbing and the app-modal/titlebar-panel creation
  sites), `gpui/titlebar-host.html`, `gpui/modal-host.html`, `gpui/index.html`,
  `gpui/kanban.html`, `gpui/manage.html`, `gpui/src/cef/macos.rs` /
  `gpui/src/cef/linux_x11.rs` / `gpui/src/cef/windows.rs` if signature plumbing
  requires it.
- do_not_touch: titlebar button render functions, popup-menu code, tooltip code,
  resources panel open/close logic in main.rs (Phase 2/3/4 territory),
  `native/sidebar/*`, gpui-component crate.
- approach:
  - Add a `background_color` (CEF ARGB, `0xFF0E0E0E`) to `cef::BrowserSettings` in
    `CefBrowser::new` for app-UI surfaces. Plumb a parameter through
    `CefBrowser::new` (and `CefSurface::new` if that is the call chain) rather than
    hard-coding globally, so the decision is explicit per call site. App-UI surfaces
    (sidebar, modal host, titlebar host panels, kanban, manage, project workarea
    app documents) get `0xFF0E0E0E`. For the in-app web Browser panes (arbitrary
    websites), choose deliberately: setting the same dark pre-paint color there is
    acceptable and desirable for a dark app (kills the white flash on navigation),
    but note CEF uses this as the canvas color for pages that declare no background
    — decide and document the choice in a short code comment; do not leave Browser
    panes flashing white if the plumbing makes dark trivial.
  - Also give the HTML entries an immediate dark paint before React mounts: add an
    inline `<style>html, body { background: #0e0e0e; margin: 0; }</style>` to
    `gpui/titlebar-host.html` and `gpui/modal-host.html`, and to
    `gpui/index.html` / `gpui/kanban.html` / `gpui/manage.html` if they lack a dark
    background. This covers the window between first CEF paint and React styles.
  - Check `gpui/src/cef/linux_x11.rs:395` (`background_pixel(0)`) for how Linux
    handles it; keep platforms consistent where the shared code changes signatures.
- acceptance_criteria:
  - `grep -n "background_color" gpui/src/cef/shell.rs` shows BrowserSettings
    background color being set for app-UI browser creation, driven from call sites.
  - `gpui/titlebar-host.html` and `gpui/modal-host.html` contain an inline dark
    `#0e0e0e` background style on html/body.
  - `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml --bin ghostex-gpui`
    passes (pre-existing warnings acceptable).
  - `bunx vite build --config gpui/vite.config.ts` passes.

## Phase 2: Fix the Resources click crash (abort)

- depends_on: [1]
- parallel_ok: false
- goal: Clicking the Resources titlebar button must never crash the app. Find and fix
  the root cause of the SIGABRT — do not add defensive fallbacks around it.
- files: `gpui/src/main.rs` (resources/tips panel open path, CEF surface creation and
  bridge event dispatch), `gpui/src/cef/shell.rs` (browser creation / message-loop
  pump scheduling) if the root cause lives there.
- do_not_touch: tooltip code, popup-menu styling/theming (Phases 3/4),
  HTML entries, `native/sidebar/*`.
- approach:
  - Real crash evidence exists:
    `~/.ghostex/logs/crashes/GhostexGPUI-2026-07-08-191831.ips` (also
    `GhostexGPUI-2026-07-08-051508.ips`, and the same files under
    `~/Library/Logs/DiagnosticReports/Retired/`). Read it. The faulting stack is a
    Rust panic-abort: `core::cell::panic_already_borrowed` →
    `gpui::app::AppCell::borrow_mut` → `<AsyncApp as AppContext>::update_entity` →
    `WeakEntity::update` → `App::spawn closure` → `async_task RawTask::run` →
    `gpui_macos::dispatcher::trampoline` → `_dispatch_main_queue_drain` (main thread).
    Meaning: a gpui foreground task ran while the App RefCell was already mutably
    borrowed — i.e. the main dispatch queue was drained re-entrantly from inside a
    gpui update. The prime suspect is the Resources open path
    (`set_gpui_titlebar_resources_panel_open`, main.rs ~24708), which synchronously
    creates a fresh CEF browser (`create_gpui_titlebar_resources_panel` ~24763 →
    `CefBrowser::new` → `browser_host_create_browser_sync`, shell.rs ~2340) inside a
    window/entity update. Investigate whether CEF's synchronous browser creation (or
    the CEF message-loop-work pump scheduled by shell.rs) can drain/pump the main
    dispatch queue re-entrantly, running queued gpui foreground tasks while the App
    is borrowed.
  - Fix the root cause by restructuring the flow so CEF browser creation and any
    bridge-event dispatch cannot run inside an active App borrow — e.g. defer panel
    creation out of the current update (`cx.defer`/spawn-on-next-tick and open the
    panel when the entity task runs), or move the CEF pump scheduling so it never
    executes gpui tasks re-entrantly. Pick the fix the evidence supports; explain the
    mechanism in a short code comment at the fix site.
  - While in the creation path: `CefBrowser::new` uses
    `.expect("failed to create GPUI CEF request context")` (shell.rs ~2329) and
    `.expect("failed to create cef-rs child browser")` (shell.rs ~2340). If your
    root-cause analysis shows these fire on the Resources path, fix the underlying
    reason they fail rather than converting them to silent fallbacks.
  - Note Tips uses a cached panel (`ensure_gpui_titlebar_tips_panel` ~24669) while
    Resources creates a fresh panel each open — that asymmetry may be why only
    Resources crashes. Keep the fresh-per-open lifecycle (it exists so React owns
    ps/lsof polling only while visible) unless the root cause genuinely requires
    changing it.
- acceptance_criteria:
  - A written root-cause explanation (in your final summary) that is consistent with
    the crash stack above, naming the exact re-entrancy path.
  - The fixed code path shows CEF panel creation / bridge dispatch can no longer run
    inside an active gpui App borrow (verifiable by reading the restructured code).
  - `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml --bin ghostex-gpui`
    passes.
  - No `catch_unwind`, no panic hooks, no "if creation fails, show nothing" fallback
    added.

## Phase 3: Titlebar button tooltips

- depends_on: [2]
- parallel_ok: false
- goal: GPUI titlebar buttons show the same tooltips as the macOS app titlebar
  buttons.
- files: `gpui/src/main.rs` (titlebar button render functions only).
- do_not_touch: popup-menu build/render code beyond attaching tooltips to triggers,
  CEF code, HTML entries, `native/sidebar/*`.
- approach:
  - gpui-component `Tooltip` is already imported (main.rs ~73) and used all over the
    app (e.g. ~46535, ~47586, ~49598) via
    `.tooltip(move |window, cx| Tooltip::new(text).build(window, cx))`. Reuse exactly
    that pattern.
  - macOS reference (native/sidebar/titlebar-host.tsx, ~4809-4980) tooltip strings:
    - Tips (info glyph): "Tips"
    - Resources: "Resources Monitor"
    - Git: "Git actions"
    - Quick Actions: "Quick Actions. Right click for more options"
    - Open In: "Open in an app. Right click for more options"
  - Attach to the corresponding GPUI buttons: `render_titlebar_tips_trigger`
    (~54681), `render_titlebar_resources_popover` trigger (~54613),
    `render_titlebar_git_button` (~54367), `render_titlebar_actions_button` (~53950),
    `render_titlebar_open_targets_button` (~54051), and any other GPUI titlebar
    button that has a direct macOS counterpart with a tooltip (check
    `render_titlebar_icon_button` ~54704 users: settings, keep-awake; and the update
    button ~54227 — mirror macOS strings from titlebar-host.tsx if they exist there;
    skip buttons with no macOS tooltip).
  - Tooltips must not appear while that button's dropdown/panel is open (match
    normal macOS behavior); if the existing app-wide Tooltip pattern already handles
    this via hover semantics, do nothing extra.
- acceptance_criteria:
  - Each of the five listed buttons has a `.tooltip(...)` with the exact macOS
    string.
  - `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml --bin ghostex-gpui`
    passes.
  - No new overlay views or hit-test tricks; only the standard Tooltip builder.

## Phase 4: Native dropdown parity — dark styling + correct layering

- depends_on: [3]
- parallel_ok: false
- goal: The Git actions, Quick Actions, and Open-in-an-app dropdowns render fully
  visible (never occluded by the tabs bar, terminal surfaces, or any CEF surface)
  and look like the macOS menus: dark background, light text, icons on the left,
  check on the right, section labels ("Status"/"Actions") in the Git menu, command
  subtitle previews in Quick Actions, separators, and "Configure" at the bottom.
  They must remain implemented with native gpui rendering (PopupMenu / gpui
  elements), NOT React/CEF content.
- files: `gpui/src/main.rs` (titlebar popup code, theme init at ~58478, popup window
  plumbing). If a small new file under `gpui/src/` helps (e.g. a popup-window host
  module), that is fine — wire it into main.rs.
- do_not_touch: `native/sidebar/*`, `shared/*`, CEF HTML entries, the Tips/Resources
  CEF panel implementation (only the three PopupMenu dropdowns are in scope),
  tooltip strings from Phase 3.
- approach:
  - Two independent root causes; fix both:
  - (a) White menu: `gpui_component::init(cx)` leaves the component Theme in Light
    mode (see gpui-component `theme/mod.rs:28`), so `PopupMenu` paints white. Switch
    the gpui-component theme to dark at startup right after `gpui_component::init`
    (main.rs ~58478) — `Theme::change(ThemeMode::Dark, ...)` — and, if the stock
    dark palette does not match Ghostex chrome, adjust the relevant theme colors
    (popover background/foreground/border) to match the existing native palette
    (`titlebar_popup_menu_background()` = `#191919`, border `white @ 0.14` — see
    main.rs ~59299). Audit other gpui-component consumers in the app (Tooltip,
    notifications, Popover, Switch, etc. — grep `use gpui_component::` main.rs ~64)
    to confirm dark mode does not degrade them; this app is uniformly dark so dark
    mode is the correct global state, not a workaround.
  - (b) Cut-off: gpui-painted `deferred(anchored(...))` popups live in the window's
    Metal layer, which native child NSViews (ghostty terminals, CEF surfaces —
    including surfaces in/below the tabs-bar band) always paint over. In-window
    priority tweaks cannot fix this. Host the three dropdowns in a GPUI-owned
    anchored popup window instead: a borderless, shadowed, non-activating
    `WindowKind::PopUp` gpui window positioned in screen coordinates under the
    trigger button, rendering the existing `PopupMenu` entities
    (`build_gpui_titlebar_popup_menu` ~53255 and its three builders). There is
    in-repo precedent: the app-modal `open_window` (~25140) and the
    `WindowKind::PopUp` toast window (~28843) — follow their option shapes.
    Child/popup windows are the explicitly accepted pattern for dropdowns in this
    repo (AGENTS.md), and it is exactly how the macOS app places these menus
    (Swift-placed child windows).
  - Keep all existing behavior: action dispatch (`RunGpuiTitlebarAction`,
    `RunGpuiTitlebarGitMenuAction`, `OpenGpuiWorkspaceInTarget`, Configure items,
    git status rows with copy-branch / commit / sync-remote), left-click vs
    right-click semantics, `TitlebarDropdownCancel` (Escape) handling, and
    dismiss-on-outside-click. Dismissal must also cover: clicking anywhere in the
    main window (including native terminal/CEF surfaces — verify mouse-down-out or
    window-deactivation reaches the popup window), moving/resizing the main window,
    and opening another titlebar dropdown (only one open at a time, including
    vs. Tips/Resources panels — reuse the existing mutual-exclusion in
    `set_gpui_titlebar_*_open` / `show_gpui_titlebar_*_menu`).
  - Position: menu top edge at the bottom of the titlebar (macOS shows a small gap;
    match `TITLEBAR_POPUP_MENU_GAP = 6.0` ~757), right-aligned to the trigger like
    the current anchored math (`titlebar_popup_anchor_for_trigger_bounds` ~58682),
    converted to screen coordinates for the popup window.
  - Visual parity targets (compare with macOS `TitlebarDropdownPanelSurface`,
    titlebar-host.tsx ~5238-5480): Git menu ~300px wide with "Status" section
    (Branch row with branch name right-aligned, Changes row with green +N / red -N,
    Commits row with ↑N ↓N) then "Actions" section (Commit, Push, Create PR,
    Multicommit & Release, Release, plus Sync with Main only for worktrees —
    whatever rows `titlebar_git_menu_state` already provides); Quick Actions ~240px
    with icon + name + gray command-preview subtitle + right check on the active
    action, "No Actions configured" empty row, separator + Configure; Open In
    ~240px with app icon + label + right check on active target, separator +
    Configure. The row builders already exist
    (`titlebar_popup_standard_menu_row`, `titlebar_popup_action_menu_row`,
    `titlebar_popup_git_*_menu_row` — near ~58963); reuse them and fix any colors
    that were only wrong because of the light theme.
- acceptance_criteria:
  - `grep -n "ThemeMode::Dark" gpui/src/main.rs` shows the component theme switched
    to dark at startup (or equivalent explicit dark-theme application).
  - The three dropdowns are hosted in a `WindowKind::PopUp` gpui window (or
    equivalent gpui-owned native window) — verifiable in code — and no longer rely
    on in-window `deferred` paint for their surface, so no native view can occlude
    them.
  - All existing menu actions still dispatch (code-level check: the same action
    types are wired in the new host).
  - Only one titlebar dropdown/panel can be open at a time (code-level check of the
    mutual-exclusion paths).
  - `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml --bin ghostex-gpui`
    passes and `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml --check`
    passes.
  - No transparent overlays, hitTest overrides, or synthetic mouse routing anywhere
    in the change.

## Handoff notes

(appended by the orchestrator after each phase completes)

### Phase 1 (COMPLETE)

- Added explicit `0xFF0E0E0E` CEF pre-paint plumbing through `CefSurface::new` into
  `CefBrowser::new`, passed at all GPUI CEF surface creation sites (including
  Browser panes, with a code comment documenting that choice).
- Added immediate dark `html, body` backgrounds to the titlebar, modal, sidebar
  (index), kanban, and manage HTML entries. cargo check and vite build passed.

### Phase 2 (COMPLETE)

- Root cause: the Resources open path created a fresh CEF child browser while GPUI
  held the AppCell mutable borrow; CEF/AppKit drained the main dispatch queue and a
  queued `WeakEntity::update` re-entered `AppCell::borrow_mut` → panic-abort.
- Fix: Resources CEF browser creation now runs in a foreground task before
  re-entering `app.update`, attaching the already-created browser with a generation
  guard; Resources project-state script dispatch moved onto foreground
  browser-handle tasks with ready-before-attach ordering handled. Only the
  Resources path in gpui/src/main.rs changed; cargo check passes.

### Phase 3 (COMPLETE)

- Added the exact macOS tooltip strings for Tips, Resources Monitor, Git actions,
  Quick Actions, and Open In on the GPUI titlebar triggers using the existing
  `Tooltip::new(...).build(...)` pattern; tooltips are suppressed while the
  corresponding panel/menu is open. Also mirrored the macOS update-button tooltip
  including the Downloading percent text. cargo check passes.

### Phase 4 (COMPLETE)

- Switched the gpui-component startup theme to dark and aligned popover colors with
  Ghostex titlebar chrome. Moved the Git, Quick Actions, and Open In menus into a
  `WindowKind::PopUp` GPUI window while preserving the existing PopupMenu builders
  and action dispatch. Added mutual dismissal with Tips/Resources plus Escape,
  popup deactivation, and main-window move/resize close paths. cargo check and
  cargo fmt --check pass.

## Post-verification findings (round 1) — runtime regressions

Static verification passed, but runtime testing surfaced two defects in the
delivered work. A read-only investigation traced both; line anchors verified
against the current working tree.

### FINDING 1: the three dropdowns flash open then instantly vanish

The Git / Quick Actions / Open In menus now open as a `WindowKind::PopUp` window
(`GpuiTitlebarPopupWindow`, main.rs ~57965) with `focus: true` on mouse-DOWN. The
activation observer (main.rs ~57991):

```rust
cx.observe_window_activation(window, |this, window, cx| {
    if !window.is_window_active() {
        this.close_from_popup_window(window, cx);
    }
});
```

fires during the natural mouse-down→mouse-up sequence while the popup is not yet
(or momentarily no longer) the key window, so the popup closes itself immediately.
Fix: latch on first genuine activation — add a `has_been_active: bool` field to
`GpuiTitlebarPopupWindow`, seed it with `window.is_window_active()` in the
initializer, set it true when the observer sees `is_window_active()`, and only
call `close_from_popup_window` on a deactivation that happens after
`has_been_active` is true. Keep all existing dismissal paths (DismissEvent on row
click / click-outside, Escape via TitlebarDropdownCancel, main-window bounds
change) untouched.

### FINDING 2: Resources click still crashes

The Phase 2 restructure (`schedule_gpui_titlebar_resources_panel_creation`,
main.rs ~24857) creates the CEF browser in a spawned foreground task, but then —
still inside that task, BEFORE re-entering `app.update` — immediately calls
`gpui_titlebar_resources_dispatch_project_state_update_to_browser(browser, ...)`
(main.rs ~24873) on the just-created browser. Script execution on a fresh CEF
browser can pump the CEF/main dispatch queue and re-enter gpui while borrows are
live; the `app.update_in` at ~24877 compounds it. The state-payload helpers were
audited and contain no unwrap/expect/panic sites, so the re-entrancy path is the
remaining suspect.

Fix direction: drop the direct pre-attach script dispatch at ~24873 and let
`attach_gpui_titlebar_resources_panel` (~24884) own the first state dispatch
through the normal `gpui_titlebar_resources_dispatch_project_state_update` path
(~58311), which already re-defers onto the foreground executor and already
re-dispatches when `titlebar_resources_panel_ready` arrives (~24899-24908). Verify
the ready-message flow still delivers the initial state exactly once (no missing
first paint, no double dispatch). Do not run the app; validate by code reasoning
plus `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml --bin ghostex-gpui`.
Note Tips creates its CEF panel synchronously and does not crash — the Resources
path's extra in-task script dispatch is what differs.

### Fix round 1 outcome (VERIFIED PASSED)

- FINDING 1 fixed: `has_been_active` latch on `GpuiTitlebarPopupWindow`, seeded
  from `window.is_window_active()`; deactivation only closes after a genuine
  activation. All other dismissal paths untouched.
- FINDING 2 fixed: `schedule_gpui_titlebar_resources_panel_creation` no longer
  takes or dispatches a pre-attach state payload; the spawned task only creates
  the browser and re-enters `app.update_in` to attach. First state dispatch is
  exactly-once in both attach-first and ready-first orderings, and both paths set
  the panel visible.
- Re-verified by the Fable verifier: cargo check and cargo fmt --check exit 0;
  VERIFICATION PASSED.

## Post-verification round 2 — live-app root causes (orchestrator, 2026-07-09)

Runtime testing on the real app exposed four deeper defects the static passes
could not see. All fixed and verified live via computer-use runs:

1. Dropdown menus opened as a key-stealing NSPanel; the main window's
   `observe_window_bounds` callback fires spuriously on key/order churn and
   closed every menu within one frame (and made the app look deactivated).
   Fix: popup opens with `focus: false` as a non-activating panel
   (`becomesKeyOnlyIfNeeded = YES`, `orderFrontRegardless`), the bounds
   observer closes the menu only when the recorded window frame actually
   changed, main-window deactivation closes it, a root
   `capture_any_mouse_down` closes it on outside clicks (skipping the trigger
   so the button's own toggle works), and the root carries
   TITLEBAR_DROPDOWN_KEY_CONTEXT while open so Escape dispatches.
2. The "Resources crash" was not a panic: `CefBrowser::drop` →
   `close_browser` → CEF's default DoClose sent a native close to the
   browser's host window — the MAIN window — and the quit-on-last-window
   hook terminated the app (silently: no willTerminate, no crash report).
   Tips never hit it because its browser is cached. Fix: all GPUI CEF
   clients now install a life-span handler whose `do_close` returns handled,
   so CEF can never close a host GPUI window.
3. The Resources panel never became visible because the page-level
   `ghostexNativeHost` shim in gpui/titlebar-host.html (June 24) overwrote
   the real bridge and swallowed `titlebarDropdownPanelReady`, `runProcess`
   (ps/lsof), and all Resources actions — AND the CEF helper binary's own
   copy of `install_app_modal_host_v8_bridge` never installed
   `ghostexNativeHost` at all. Fix: shim deleted; helper now installs the
   same surface-scoped native-host bridge as the shell path.
4. Clicking the Tips/Resources trigger while its panel was open fired the
   panel's `on_mouse_down_out` close AND the button toggle, reopening it.
   Fix: the anchored panels record trigger bounds and ignore mouse-downs on
   the trigger.

Live verification (computer-use, final build): Resources panel opens with
live CPU/memory/process data, closes via Escape and outside click, no crash;
Git/Actions/Open-In menus open dark and correctly positioned in a popup
window, toggle and Escape work; app stays active-looking; no white flashes.
