# Plan: GPUI titlebar Tips panel repositioning + real Resources React panel

Date: 2026-07-08
Planner: Fable (inline). Workers: Codex gpt-5.5 xhigh. Verifier: Fable high.

## Overall goal

Two user-facing changes in the GPUI app (`gpui/`):

1. The Tips panel that opens from the titlebar info button currently lands ~4-8px
   from the window top and overlaps the titlebar (its position is an accident of
   `snap_to_window_with_margin`, not an intentional anchor). Move it so its top
   edge sits exactly at the bottom of the titlebar. The titlebar is
   `TITLEBAR_HEIGHT = 35.0` tall (gpui/src/main.rs:456; the user measured 34px,
   which is `TITLEBAR_CONTROL_HEIGHT` = 34 at main.rs:457 — anchor to the actual
   titlebar bottom using the `TITLEBAR_HEIGHT` constant, never a new magic number).
2. The titlebar Resources button currently opens an OS `NativeMenu` built from a
   one-shot Rust `ps`/`lsof` snapshot. Replace it with the REAL Resources
   dropdown panel from the macOS app: the shared React `titlebar-host.html`
   document rendered with `?ghostexTitlebarPanel=resources` inside a CEF panel,
   hooked up with the same message contract the macOS app uses (process
   sampling round-trip, hidden-until-first-snapshot reveal, focus/sleep/quit
   actions, gxserver daemon controls, portless rows).

## Hard repo rules (apply to every phase)

- NO tests anywhere under `gpui/` or the macOS app. Do not add test files or
  test code. If an existing test breaks because of your change, delete it.
- NO fallbacks that hide problems. Fix root causes. If a contract can't be
  satisfied, stop and report BLOCKED rather than adding try-this-then-that logic.
- Never run `bun run start`, `scripts/start-gpui.mjs`, or anything that starts
  or restarts the Ghostex app.
- The worktree has UNRELATED uncommitted changes (e.g. sidebar/agents-hub-modal.tsx,
  gpui/scripts/build-macos-app.sh, parts of gpui/src/main.rs). Do not commit, do
  not revert, do not run `git restore`/`git checkout --`/`git clean`/`git stash`.
  Leave your changes uncommitted in the worktree.
- CDXC comments in this codebase are load-bearing contracts. When your change
  alters behavior a CDXC comment describes, UPDATE the comment text to describe
  the new behavior (keep the CDXC tag format). Do not delete contracts silently.
- Native layout discipline: no transparent overlays, no hitTest overrides, no
  hidden hit regions, no AppKit child windows. The CEF-surface-inside-anchored-
  GPUI-element pattern used by the existing Tips panel is the approved shape.
- Do not modify `/Users/madda/dev/_references/gpui-component` or
  `/Users/madda/dev/_references/zed` (local path dependencies). All changes go
  in this repository.
- Do not edit `native/sidebar/titlebar-host.tsx` or anything under
  `native/macos/` — the React resources panel and the macOS app must stay
  untouched; this task is Rust-side (gpui) work only. If you believe a React
  change is truly unavoidable, print BLOCKED and explain instead of editing.
- Line numbers in this plan were captured on 2026-07-08 from a dirty worktree.
  Treat them as approximate anchors: re-search for the named symbol before editing.

## Verification commands

- Compile proof for every phase: `cd /Users/madda/dev/_active/Ghostex/gpui && cargo check`
  (must exit 0; warnings about pre-existing code are fine, new warnings in your
  code are not).
- No React rebuild should be needed (no React files may change).

## Shared architecture reference (read before any phase)

### Tips panel today (the pattern Resources will mirror)

- Entity: `GpuiTitlebarTipsPanel` at gpui/src/main.rs:56495 — wraps an
  `Entity<CefSurface>`; `::new` (main.rs:56499) creates a `CefSurface` with id
  `TITLEBAR_TIPS_PANEL_ID` (main.rs:727), profile
  `TITLEBAR_TIPS_PANEL_CEF_PROFILE_ID` (main.rs:726), the app's parent NSView,
  URL from `titlebar_tips_panel_url()` (main.rs:60336 →
  `gpui_cef_html_entry_url("GHOSTEX_GPUI_TITLEBAR_HOST_URL", "titlebar-host.html")`
  + `?ghostexTitlebarPanel=tips` via `gpui_url_with_query_param`), bridge surface
  `AppModalHostBridgeSurface::Titlebar`, and the app-modal bridge event handler
  (`app_modal_host_bridge_event_handler`, main.rs:24207).
- Lazy creation/caching: `ensure_gpui_titlebar_tips_panel` (main.rs:24543);
  state fields `titlebar_tips_panel_open` / `titlebar_tips_panel`
  (main.rs:21562-21563). Open/close: `set_gpui_titlebar_tips_panel_open`
  (main.rs:24506) — on open pushes initial project state
  (`gpui_titlebar_tips_initial_project_state_update`, main.rs:24568), installs
  the unread-count probe, requests runtime status; on close calls
  `set_visible(false)` on the CEF surface (GPUI paint removal alone cannot hide
  a native child view).
- Rendering/positioning: `render_titlebar_tips_popover` (main.rs:53383) uses
  gpui-component `Popover::new(...).anchor(Anchor::BottomRight).appearance(false)`
  with a child div sized `TITLEBAR_DROPDOWN_TIPS_PANEL_WIDTH` (556, main.rs:463)
  × `TITLEBAR_DROPDOWN_READING_PANEL_HEIGHT` (650, main.rs:464). It is attached
  in `render_right_titlebar_controls` (main.rs:53118, an
  `h_flex().absolute().right_0().top(px(1.0)).h(px(TITLEBAR_CONTROL_HEIGHT))`
  strip) at main.rs:53143. Trigger: `GpuiTitlebarTipsTrigger` (main.rs:57071),
  34×42px button id `ghostex-gpui-titlebar-button-tips`.
- Why it lands at the wrong y: gpui-component `Popover::resolved_corner` for
  `Anchor::BottomRight` returns a point ABOVE the trigger
  (`trigger_bounds.origin.y - trigger_bounds.size.height`), so the 650px panel's
  desired top is ≈ −683; `snap_to_window_with_margin(px(8.))` then clamps the
  panel top to window-top + 8px, and `.bottom_1()` shifts content up 4 more.
  Nothing in Ghostex code sets the y position today.
- CEF child view frame follows GPUI element bounds automatically:
  `impl Render for CefSurface` (main.rs:56727) prepaints
  `surface.browser.set_bounds(bounds, scale_factor)` (main.rs:56752) →
  `CefBrowser::set_bounds` (gpui/src/cef/shell.rs:2420).
- Messaging today: panel → Rust goes through the single
  `window.webkit.messageHandlers.ghostexAppModalHost.postMessage` shim installed
  at V8 context creation (`install_app_modal_host_v8_bridge`, shell.rs:1333,
  installed in `on_context_created` shell.rs:920-957; JS name constant in
  gpui/src/cef/sidebar_bridge_manifest.rs:184), forwarded as process message
  `ghostex.gpui.appModalHost.message` (sidebar_bridge_manifest.rs:161, 1MB cap)
  and dispatched in `receive_app_modal_host_bridge_event` (main.rs:24890).
  Existing arms: `gpuiTitlebarTipsUnreadCount` (main.rs:24943),
  `closeTitlebarDropdownPanel` (main.rs:25069 → closes tips),
  `sidebarCommand` (main.rs:25034 → `handle_gpui_app_modal_sidebar_command`,
  main.rs:30328). Rust → panel: `execute_app_owned_script` injections, e.g.
  `dispatch_gpui_titlebar_tips_project_state_update` (main.rs:27402) calling
  `window.__ghostex_TITLEBAR__.setActiveProjectState(update)` with a
  `__ghostex_PENDING_TITLEBAR_PROJECT_STATE__` stash fallback.

### The React Resources panel (already built into the gpui bundle — do not edit)

- gpui/vite.config.ts:26 builds `titlebar-host.html` from
  `native/sidebar/titlebar-host.tsx` — the SAME document macOS uses. Loading it
  with `?ghostexTitlebarPanel=resources` renders the full Resources panel
  (`readTitlebarDropdownPanelKind`, titlebar-host.tsx:586-605 reads the query
  param; `resourcesPanelActive` at :2642; surface render at :5207-5237).
- Panel size: resources 656×650 (`TITLEBAR_DROPDOWN_RESOURCES_PANEL_WIDTH = 656`
  titlebar-host.tsx:571, height 650 = `TITLEBAR_DROPDOWN_READING_PANEL_HEIGHT`).
  Tips is 556×650.
- State it consumes (via `setActiveProjectState` pushes — `TitlebarProjectState`
  titlebar-host.tsx:303-346): `resourceGroups` (:213-242 shapes), `browserTabs`
  (:280-289, `{browserId, id, isActive, kind, projectId?, sessionId?, title, url}`),
  `codeEditorProjectIds` (awake embedded-Code project ids only), `portless`
  (sanitized health + nativeAdmin + `presentation.routePreviews`
  `{hostname, kind, port, projectId, protocol, sessionId}` + `liveListenerCount`
  + `routePreviewStatus`), `gxserverDaemon` (:291-301), `sessionPersistenceProvider`,
  `terminalDevServerOpenTarget`. The macOS payload builder to mirror field-for-field
  is `applyReactTitlebarProjectState` in
  native/macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift:7816-8276
  (resources sections: codeEditorProjectIds :8114, portless :8121, resourceGroups
  :8176, sessionPersistenceProvider :8228, terminalDevServerOpenTarget :8231,
  browserTabs :8240; browser tabs built in TerminalWorkspaceView.swift:6319-6366).
- Code IDE matching: `codeServerResourcePort()` reads
  `window.__ghostex_NATIVE_HOST__?.codeServerRuntime?.port` (default 3775,
  titlebar-host.tsx:175, 185-190) — the host must inject the real code-server
  port before/at document start.
- Process sampling is driven BY REACT through a generic host bridge:
  `runNativeProcess()` (titlebar-host.tsx:1329-1352) posts
  `{type:"runProcess", requestId, executable, args, cwd?, env?}` via
  `postNative()` → `window.webkit.messageHandlers.ghostexNativeHost.postMessage`
  (titlebar-host.tsx:1000-1002) and resolves from `processResult` host events
  delivered as `window` CustomEvent `"ghostex-native-host-event"`
  (`NativeHostEvent` shape at :143-151, listener :3248-3264). Invocations:
  `/bin/ps -axo pid=,ppid=,pcpu=,rss=,command=` (:1540-1546),
  `/usr/sbin/lsof -nP -iTCP -sTCP:LISTEN -F pcn` then
  `/usr/sbin/lsof -nP -a -d cwd -F pn -p <pids>` (:1548-1589), and
  `/bin/kill` with `-INT`/`-TERM` then recheck + `-KILL`
  (`terminateResourceProcesses`, :1603-1631). Poll loop every 5s while the
  resources panel is active (:3370-3403); guarded refresh at :3314-3368.
- Reveal contract: React posts `{kind:"resources", type:"titlebarDropdownPanelReady"}`
  once the first process snapshot commits (:3405-3416). macOS keeps the panel
  hidden until then (AppDelegate.swift:16467-16471 + 8409-8411). Mirror this.
- Outbound actions (all via `postNative` → `ghostexNativeHost`):
  - `{type:"focusResourceSessionFromTitlebar", sessionId}` (:3608-3623; closes panel after)
  - `{type:"sleepInactiveSessionsFromTitlebar", sessionIds}` (:3688-3696)
  - `{type:"quitResourcesFromTitlebar", projectIds, sessionIds}` (:3625-3686;
    PID kills happen separately via runProcess /bin/kill — the message only
    closes app-owned surfaces: sessions and embedded Code IDE views)
  - `{type:"startGxserverFromTitlebar"}` / `stopGxserverFromTitlebar` /
    `restartGxserverFromTitlebar` / `{type:"setGxserverAlwaysStartFromTitlebar", enabled}`
    (:3699-3711)
  - `{type:"openExternalUrl", url}` (dev-server row when open target is browser)
  - `{type:"closeTitlebarDropdownPanel"}`, `{kind, type:"titlebarDropdownPanelReady"}`,
    `{type:"titlebarBlankMouseDown"}`; `resizeTitlebarDropdownPanel` is
    deliberately ignored by hosts.
  - Via the `ghostexAppModalHost` `sidebarCommand` bridge (already installed in
    gpui): `openBrowserPane`, `runPortlessSettingsAdminAction`,
    `refreshDaemonSessions`, etc. (titlebar-host.tsx:1164-1179).
- IMPORTANT lifecycle fact: the resources document polls ps/lsof every 5s for
  as long as it exists, because its panel kind is static. macOS creates a fresh
  WKWebView per open and destroys it on close, so polling stops. The gpui port
  must therefore DESTROY the resources panel (drop the entity and close the CEF
  browser) on close, not hide-and-reuse like the tips panel does.

### Existing gpui native handlers to reuse (do not duplicate logic)

- Sleep inactive sessions: `dispatch_gpui_workspace_sleep_inactive_sessions`
  (main.rs:52476), currently reached via `SleepInactiveSessionsFromTitlebar`
  action (main.rs:55372).
- gxserver daemon: `start_gpui_local_gxserver_bootstrap`,
  `stop_gpui_local_gxserver_from_titlebar(restart: bool, ...)` (action arms near
  main.rs:55380-55396).
- Portless state: `gpui_sidebar_portless_state_with_presentation()`; health
  probe `gpui_probe_local_gxserver_health()`.
- Process termination pattern with PID-reuse guard:
  `terminate_gpui_resource_processes_in_background` (main.rs:52235).
- The old NativeMenu path this task replaces:
  `show_gpui_resources_titlebar_menu` (main.rs:52084),
  `present_gpui_resources_titlebar_menu` (main.rs:52108),
  `quit_gpui_titlebar_resource_bundle` (main.rs:52206),
  snapshot collector `gpui_collect_titlebar_resources_snapshot` (main.rs:73464)
  + `GpuiTitlebarResourcesSnapshot` (main.rs:73210) + helpers
  (`gpui_read_resource_process_samples` main.rs:73226, listening-server sampler,
  `gpui_titlebar_portless_status_label` main.rs:73635), field
  `titlebar_resources_menu_snapshot` (main.rs:21120), action
  `QuitGpuiTitlebarResourceBundle` (main.rs:1610 struct, arm main.rs:55377).
- Resources button click routing: `render_titlebar_icon_button` callers at
  main.rs:53144-53150 (id `"resources"`), left-click arm ~main.rs:53499-53504,
  right-click arm ~main.rs:53530-53542 — both currently call
  `show_gpui_resources_titlebar_menu(event.position, ...)`.

---

## Phase 1: Anchor the Tips panel directly below the titlebar

- depends_on: []
- parallel_ok: false
- goal: The Tips panel's top edge must sit exactly at the bottom edge of the
  titlebar (y = `TITLEBAR_HEIGHT`), right-aligned toward the window's right edge
  near its trigger, instead of overlapping the titlebar at window-top + margin.
  All existing behavior must survive: toggle from the info button, click-outside
  dismiss, Escape dismiss, CEF surface show/hide on open/close, unread badge,
  state pushes on open.
- files: `gpui/src/main.rs` (the `render_titlebar_tips_popover` /
  `GpuiTitlebarTipsTrigger` region and the open/close plumbing it calls).
- do_not_touch: `/Users/madda/dev/_references/**` (gpui-component/zed path deps),
  `native/**`, `gpui/src/cef/**`, the resources NativeMenu code, React sources.
- approach: Stop relying on gpui-component `Popover` for placement — its
  `Anchor::BottomRight` math resolves a corner ABOVE the trigger and the final
  position is an accident of `snap_to_window_with_margin(8)`. Replace the
  `Popover` in `render_titlebar_tips_popover` with the same primitives it wraps,
  owned directly by the app: keep the existing trigger element (clicking toggles
  `set_gpui_titlebar_tips_panel_open`), and when open render a
  `deferred(anchored() ... )` overlay with an explicit position so the panel's
  TOP edge is at `px(TITLEBAR_HEIGHT)` and its RIGHT edge aligns with the right
  titlebar controls (use `Anchor::TopRight`/`Corner::TopRight` positioning with
  the trigger's right-x, or right-align to the window edge minus the traffic-light-
  free right controls inset — match where the panel visually hangs today
  horizontally). Set a high paint priority like Popover does
  (`.with_priority(1)`) and keep `snap_to_window_with_margin(px(8.))` only as a
  horizontal safety clamp — with top = 35 the vertical clamp never engages.
  Reimplement dismissal explicitly on the panel container: `on_mouse_down_out`
  → close, and an Escape/Cancel key binding → close (this is what
  gpui-component Popover did; see
  /Users/madda/dev/_references/gpui-component/crates/ui/src/popover.rs:443-458
  for the reference behavior, but implement it in main.rs, do not import new
  library surface). Keep the 556×650 sizing, `overflow_hidden`,
  `bg(titlebar_background())`, and the `when_some(panel)` child exactly as today
  so `CefSurface` prepaint keeps syncing the native child view frame. Preserve
  focus behavior (`FirstResponderCefSurface::TitlebarTips` handling,
  main.rs:34324) — closing must still hide the native CEF view via
  `set_gpui_titlebar_tips_panel_open(false, ...)`. Update the
  CDXC:GPUITitlebarTips comments (main.rs:783, 21455, 24409) to describe the
  app-owned anchored overlay (still: shared React titlebar-host document, no
  AppKit child windows, no invisible overlays). Structure the open-panel
  rendering so Phase 3 can reuse the same anchored-below-titlebar container for
  the resources panel (e.g. a small helper fn taking id, width, open flag,
  close callback, and child) — but do not over-abstract; a parameterized private
  helper is enough.
- acceptance_criteria:
  - `cd gpui && cargo check` exits 0.
  - `rg -n "resolved_corner|Popover::new\(\"ghostex-gpui-titlebar-tips-popover\"" gpui/src/main.rs`
    shows the tips panel no longer uses gpui-component `Popover` for placement
    (or, if Popover is retained, show exactly how the final y provably equals
    `TITLEBAR_HEIGHT` — the accidental snap-margin position is not acceptable).
  - The code that positions the panel derives the top edge from the
    `TITLEBAR_HEIGHT` constant (grep proves no new hardcoded 34/35 literal).
  - Click-outside and Escape both close the panel (point to the exact handlers).
  - Open still pushes initial project state + runtime status and close still
    calls the CEF `set_visible(false)` path (point to call sites).

## Phase 2: `ghostexNativeHost` bridge for the titlebar-host CEF surface

- depends_on: [1]   # ordering only — same file (gpui/src/main.rs); no logical dependency
- parallel_ok: false
- goal: The React titlebar-host document's `postNative()` calls
  (`window.webkit.messageHandlers.ghostexNativeHost.postMessage`) currently
  no-op in gpui because only `ghostexAppModalHost` is installed. Install a
  `ghostexNativeHost` handler for the Titlebar CEF surface, route its messages
  to the app, implement the `runProcess` request/response round-trip with a
  strict executable allowlist, and dispatch `processResult` events back into the
  document as the `ghostex-native-host-event` CustomEvent. This unblocks the
  resources panel's ps/lsof sampling and its action messages (handled in
  Phase 3).
- files: `gpui/src/cef/shell.rs`, `gpui/src/cef/sidebar_bridge_manifest.rs`,
  `gpui/src/main.rs` (bridge dispatch + runProcess handling).
- do_not_touch: React sources (`native/sidebar/**`, `gpui/sidebar/**`,
  `sidebar/**`), `native/macos/**`, the tips popover render code Phase 1 owns
  (read it, don't restructure it), the resources NativeMenu code (Phase 3 owns
  its removal).
- approach: In the render-process shim where
  `window.webkit.messageHandlers.ghostexAppModalHost` is created
  (`install_app_modal_host_v8_bridge`, shell.rs:1333, called from
  `on_context_created` shell.rs:920-957), also create
  `window.webkit.messageHandlers.ghostexNativeHost` with a `postMessage`
  function for first-party surfaces (at minimum the Titlebar surface; installing
  for all three first-party entries is fine if simpler — unhandled types just
  log). Reuse the existing renderer→browser process-message channel
  (`ghostex.gpui.appModalHost.message`) but tag the payload with its bridge
  origin (e.g. wrap as `{bridge:"nativeHost", payload}` or add a second process
  message name constant in sidebar_bridge_manifest.rs following the existing
  naming/1MB-cap pattern) so `receive_app_modal_host_bridge_event`
  (main.rs:24890) can dispatch nativeHost messages to a new
  `receive_gpui_titlebar_native_host_message` handler. Remember the CDXC
  comments around the bridge install (gpui-cef-bridge-install-timing: the shim
  must be installed in `on_context_created` in BOTH render handler paths if two
  exist — mirror wherever `install_app_modal_host_v8_bridge` is installed).
  Implement in main.rs:
  - `runProcess {requestId, executable, args, cwd?, env?}`: validate against a
    fixed allowlist derived from the exact invocations in titlebar-host.tsx —
    `/bin/ps` (args must equal the sampling shape used by the panel),
    `/usr/sbin/lsof` (the two listing shapes: `-nP -iTCP -sTCP:LISTEN -F pcn`
    and `-nP -a -d cwd -F pn -p <comma-separated-pids>` with pids validated
    numeric), `/bin/kill` (first arg one of `-INT`/`-TERM`/`-KILL`, remaining
    args numeric pids), plus the `ps -o command= -p <pid>` recheck shape used by
    `terminateResourceProcesses` — read titlebar-host.tsx:1329-1631 and
    enumerate exactly; reject `cwd`/`env` unless the panel actually sends them.
    Any non-matching request returns an error `processResult` WITHOUT executing
    anything. Run allowed commands on the background executor (never block the
    UI thread), capture stdout/stderr/exit status, and reply by injecting an
    app-owned script that dispatches
    `window.dispatchEvent(new CustomEvent("ghostex-native-host-event", {detail: <NativeProcessResult>}))`
    — copy the exact `NativeProcessResult` field names from
    titlebar-host.tsx:143-151 and the resolver at :1329-1352 (do not guess;
    field-name mismatch silently breaks the panel). Use the existing
    `execute_app_owned_script`-style injection into the titlebar panel surface;
    JSON-encode via serde_json, never string-concatenate user data into JS.
  - `titlebarDropdownPanelReady {kind}` and `closeTitlebarDropdownPanel`: accept
    and route into overridable app handlers (Phase 3 wires resources; for now
    tips is unaffected — `closeTitlebarDropdownPanel` from the nativeHost bridge
    should behave like the existing appModalHost arm at main.rs:25069).
  - Unknown nativeHost message types: log at debug level and ignore (macOS
    parity: hosts ignore `resizeTitlebarDropdownPanel` and
    `titlebarBlankMouseDown` may be a no-op in gpui).
  Add a CDXC comment on the allowlist explaining the bound: the gpui
  ghostexNativeHost runProcess bridge executes only the fixed ps/lsof/kill
  shapes the shared Resources panel issues, mirroring macOS functionality
  without accepting arbitrary React-provided executables.
- acceptance_criteria:
  - `cd gpui && cargo check` exits 0.
  - `rg -n "ghostexNativeHost" gpui/src/cef gpui/src/main.rs` shows: shim
    creation in the on_context_created path(s), a manifest constant, and a
    main.rs dispatch arm.
  - The runProcess handler provably rejects a non-allowlisted executable (point
    to the validation code path returning an error processResult without
    spawning) and validates kill signals + numeric pids.
  - The processResult reply field names match titlebar-host.tsx `NativeProcessResult`
    exactly (quote both in the summary).
  - Process execution happens via the background executor (point to the spawn).

## Phase 3: Resources React panel — open, feed, act, and remove the NativeMenu

- depends_on: [1, 2]
- parallel_ok: false
- goal: Clicking (or right-clicking) the titlebar Resources button opens the
  real React Resources panel — the shared titlebar-host document with
  `?ghostexTitlebarPanel=resources` — in a CEF panel anchored below the titlebar
  exactly like the Phase 1 tips panel, sized 656×650, revealed only after the
  panel posts `titlebarDropdownPanelReady` (macOS parity), fed the full
  resources project-state payload, with every panel action handled natively.
  The old NativeMenu resources path is removed.
- files: `gpui/src/main.rs` (primary); `gpui/src/cef/shell.rs` /
  `sidebar_bridge_manifest.rs` only if a small hook from Phase 2 needs
  extension (e.g. surface-scoped event routing or browser close support).
- do_not_touch: React sources (`native/sidebar/**`, `gpui/sidebar/**`,
  `sidebar/**`), `native/macos/**`, `/Users/madda/dev/_references/**`.
- approach:
  1. Panel entity: add `GpuiTitlebarResourcesPanel` mirroring
     `GpuiTitlebarTipsPanel` (main.rs:56495-56574): new constants
     `TITLEBAR_RESOURCES_PANEL_CEF_PROFILE_ID = "titlebar-resources-panel"`,
     `TITLEBAR_RESOURCES_PANEL_ID = "ghostex-gpui-titlebar-resources-panel"`,
     `TITLEBAR_DROPDOWN_RESOURCES_PANEL_WIDTH: f32 = 656.0`; URL =
     `gpui_cef_html_entry_url(...titlebar-host.html)` +
     `ghostexTitlebarPanel=resources` (add a `titlebar_resources_panel_url()`
     beside `titlebar_tips_panel_url()`, main.rs:60336). Same bridge surface
     (`AppModalHostBridgeSurface::Titlebar`) and event handler wiring. If both
     panels can be open in overlapping lifetimes, make sure nativeHost/appModalHost
     events are routed to the right panel — simplest correct rule: opening one
     closes the other, and route titlebar-surface nativeHost messages by the
     originating browser id if the bridge provides it, else by which panel is open.
  2. Lifecycle (differs from tips ON PURPOSE): create the panel entity fresh on
     every open and DESTROY it on close (drop the entity and close/release the
     CEF browser — find the CefSurface/CefBrowser close path in
     gpui/src/cef/shell.rs; if no close exists yet, add a minimal app-owned
     close that tears down the browser and native view). Rationale: the
     resources document polls `ps`/`lsof` every 5s for its entire lifetime;
     macOS destroys the webview on close so polling stops — a hidden-but-alive
     gpui panel would sample forever. Do NOT solve this by patching React.
  3. Hidden-until-ready reveal (macOS parity, AppDelegate.swift:16467-16471 +
     8409-8411 + titlebar-host.tsx:3405-3416): on click, mark the trigger open
     immediately and create the panel with the CEF surface hidden
     (`set_visible(false)`); when the Phase 2 bridge delivers
     `titlebarDropdownPanelReady` with kind `resources`, render the anchored
     container (same below-titlebar helper as Phase 1, width 656) and
     `set_visible(true)`. Note the CEF browser loads and runs scripts while the
     native view is hidden, so the first ps snapshot completes before reveal.
     If the ready message never arrives (document failed), closing the panel
     must still tear everything down cleanly.
  4. State payload: at panel creation, inject document-start state the way the
     tips panel does, but with the FULL resources payload. Mirror
     `applyReactTitlebarProjectState` (AppDelegate.swift:7816-8276) field
     shapes for: `resourceGroups` (build from gpui's live workspace/session
     state: group `{groupId, isActive, projectName, projectPath, title, projectId?}`,
     sessions `{activity, isRunning, sessionId, title, agentIcon?, isSleeping?,
     lastInteractionAt?, projectId?, sessionKind?, sessionPersistenceName?,
     sessionPersistenceProvider?, terminalTitle?}`), `browserTabs` (from gpui's
     CEF web panes: `{browserId, id: "browser:<sessionId>", isActive,
     kind:"browser", sessionId, title, url}` and project-editor tabs
     `{browserId, id:"project-editor:<projectId>:<tabId>", isActive, kind,
     projectId, title, url}` — see TerminalWorkspaceView.swift:6319-6366 for
     the exact macOS shapes; use gpui's equivalents of these surfaces),
     `codeEditorProjectIds` (awake embedded-Code project ids only),
     `portless` (reuse `gpui_sidebar_portless_state_with_presentation()`),
     `gxserverDaemon` (running/alwaysStart status — reuse the health probe and
     whatever always-start setting gpui has; if gpui has no always-start
     setting, omit the toggle-relevant field the same way an unavailable state
     is represented on macOS rather than faking it),
     `sessionPersistenceProvider`, `terminalDevServerOpenTarget`. Also inject
     `window.__ghostex_NATIVE_HOST__ = {codeServerRuntime:{port: <real port>}}`
     (or merge into existing global) so `codeServerResourcePort()` matches the
     embedded Code IDE (titlebar-host.tsx:175-190) — gpui knows its code-server
     child; find where the code-server port/PID lives (the old snapshot code
     used the code-server child PID). Push live `setActiveProjectState` updates
     while the panel is open whenever the underlying gpui state changes — hook
     the same notification points that update the sidebar/tips (at minimum:
     session list changes, gxserver daemon status changes, portless state
     changes). Building this payload will be the bulk of the work; put it in a
     dedicated fn (e.g. `gpui_titlebar_resources_project_state_update`) with a
     CDXC comment mirroring the macOS payload contract.
  5. Actions (nativeHost messages from Phase 2's dispatch, resources arms):
     - `focusResourceSessionFromTitlebar {sessionId}`: focus/reveal that session
       in the gpui workspace (find gpui's existing focus-session-by-id path —
       the workspace can already focus sessions from the sidebar; reuse it),
       then close the panel (React also closes itself; host close must be
       idempotent).
     - `sleepInactiveSessionsFromTitlebar {sessionIds}`: reuse
       `dispatch_gpui_workspace_sleep_inactive_sessions` (main.rs:52476) —
       note the React panel sends explicit sessionIds; if the existing fn
       computes its own set, prefer honoring the explicit ids if it has (or can
       trivially take) an ids parameter, otherwise call the existing fn and
       leave a CDXC note on the accepted delta.
     - `quitResourcesFromTitlebar {projectIds, sessionIds}`: close/quit the
       named gpui sessions and close embedded Code IDE surfaces for the named
       projectIds (PID kills arrive separately via runProcess kill — do not
       duplicate them). Map to gpui's existing session-close and code-IDE
       surface teardown paths.
     - Daemon: `startGxserverFromTitlebar` → `start_gpui_local_gxserver_bootstrap`;
       `stopGxserverFromTitlebar` → `stop_gpui_local_gxserver_from_titlebar(false)`;
       `restartGxserverFromTitlebar` → `stop_gpui_local_gxserver_from_titlebar(true)`;
       `setGxserverAlwaysStartFromTitlebar {enabled}` → gpui's always-start
       setting mutation if one exists (search for the setting the gpui settings
       UI uses); after each, push an updated `gxserverDaemon` state so the panel
       buttons reflect reality.
     - `openExternalUrl {url}`: open in the default browser via gpui's existing
       external-URL open path; validate scheme http/https.
     - `closeTitlebarDropdownPanel` (kind resources) and click-outside/Escape
       from the Phase 1 anchored container: both destroy the panel (step 2).
     - `sidebarCommand` arms already flowing over ghostexAppModalHost
       (`handle_gpui_app_modal_sidebar_command`, main.rs:30328): make
       `openBrowserPane` work for the resources panel's dev-server/portless
       links — today it is gated by `gpui_titlebar_tips_browser_url_allowed`
       (main.rs:60351, docs/changelog only). Extend the gate for the resources
       case with a bounded rule: allow only http/https URLs whose host is
       localhost/127.0.0.1 or a portless route domain present in the CURRENT
       portless presentation state (validate against state, not free-form
       React input). `runPortlessSettingsAdminAction` should route to the same
       handler the gpui settings/portless UI already uses if present; if gpui
       has no such handler yet, opening the existing PortlessSetup modal
       (`OpenGpuiPortlessSetupModalFromTitlebar` behavior) is the correct
       action, not a stub.
  6. Button wiring + NativeMenu removal: point both the left-click and
     right-click arms of the `"resources"` titlebar button
     (main.rs:53499-53504 / 53530-53542) at the new panel toggle. Then remove
     the dead NativeMenu path: `show_gpui_resources_titlebar_menu`,
     `present_gpui_resources_titlebar_menu`, `quit_gpui_titlebar_resource_bundle`
     + `terminate_gpui_resource_processes_in_background` (if now unreferenced),
     `QuitGpuiTitlebarResourceBundle` action + its arm,
     `titlebar_resources_menu_snapshot` field, `GpuiTitlebarResourcesSnapshot`
     and the whole snapshot collector cluster (`gpui_collect_titlebar_resources_snapshot`,
     `gpui_read_resource_process_samples`, the lsof sampler,
     `gpui_titlebar_portless_status_label`) — but ONLY pieces that end up with
     zero remaining references; keep anything still used elsewhere (e.g.
     `SleepInactiveSessionsFromTitlebar`, daemon actions, portless helpers are
     shared — keep them). Update/replace the CDXC:GPUIResourcesTitlebar
     comments (main.rs:51974-51981, 53380-53386, 53412-53421) to describe the
     React panel port.
- acceptance_criteria:
  - `cd gpui && cargo check` exits 0.
  - `rg -n "ghostexTitlebarPanel=resources|titlebar_resources_panel_url" gpui/src/main.rs`
    shows the panel loads the shared document with the resources query param.
  - `rg -n "show_gpui_resources_titlebar_menu|GpuiTitlebarResourcesSnapshot" gpui/src`
    returns nothing (NativeMenu path fully removed).
  - Both click arms of the `"resources"` button open the React panel (point to
    the two call sites).
  - Reveal is gated on `titlebarDropdownPanelReady` kind==resources (point to
    the handler and the hidden-until-ready state), and close destroys the panel
    entity + CEF browser (point to the teardown; explain how the 5s ps/lsof
    poll provably stops on close).
  - The project-state payload fn emits all seven resources fields
    (`resourceGroups`, `browserTabs`, `codeEditorProjectIds`, `portless`,
    `gxserverDaemon`, `sessionPersistenceProvider`, `terminalDevServerOpenTarget`)
    and `__ghostex_NATIVE_HOST__.codeServerRuntime.port` is injected (quote the
    injection).
  - Every action listed in step 5 has a handler arm (enumerate each with its
    file:line in the summary), and `openBrowserPane` URL gating for resources
    validates against current portless/localhost state.
  - Panel width 656 comes from a named constant; top edge below the titlebar via
    the Phase 1 container/helper.

## Handoff notes

(appended by the orchestrator as phases complete)

### Phase 1 (COMPLETE)

- Tips panel no longer uses gpui-component `Popover`: it is an app-owned
  `deferred(anchored(...))` dropdown in gpui/src/main.rs whose top edge is
  computed from `TITLEBAR_HEIGHT` and whose right edge clamps near the trigger.
- Trigger toggle, 556×650 CEF child rendering, unread badge, focus handoff,
  click-outside + Escape close (via `set_gpui_titlebar_tips_panel_open(false)`),
  open-time state push / unread probe / runtime status, and close-time
  `set_visible(false)` all preserved. `cargo check` exits 0.
- Note for later phases: an unrelated concurrent agent is editing titlebar
  popup helper code (`titlebar_popup_*` fns) in the same worktree; if
  `cargo check` fails on symbols you did not touch, re-run it before treating
  it as your failure, and never modify that popup code.

### Phase 2 (COMPLETE)

- New manifest constants + a titlebar-only CEF V8 shim install
  `window.webkit.messageHandlers.ghostexNativeHost.postMessage`; CEF forwards
  the bounded main-frame JSON tagged as native-host. Files touched:
  gpui/src/cef/shell.rs, gpui/src/cef/sidebar_bridge_manifest.rs,
  gpui/src/cef/unsupported.rs, gpui/src/main.rs.
- Messages route through a `NativeHostMessage` wrapper into
  `receive_gpui_titlebar_native_host_message` in main.rs — Phase 3 adds its
  resources arms there.
- `runProcess` enforces exact ps/lsof/kill argument shapes (no cwd/env,
  validated kill signals, numeric PIDs); anything else returns an error
  processResult without spawning. Replies dispatch the
  `ghostex-native-host-event` CustomEvent with React's exact processResult
  fields: `exitCode`, `requestId`, `stderr`, `stdout`, `type`.
- `cargo check` exits 0.

### Phase 3 (COMPLETE)

- Added `GpuiTitlebarResourcesPanel` loading the shared titlebar-host document
  with `ghostexTitlebarPanel=resources` (constants
  `TITLEBAR_RESOURCES_PANEL_CEF_PROFILE_ID` / `TITLEBAR_RESOURCES_PANEL_ID` /
  `TITLEBAR_DROPDOWN_RESOURCES_PANEL_WIDTH`), with a CEF browser id hook for
  message routing.
- Both Resources button click arms open a fresh hidden-until-ready anchored
  panel, width 656, below `TITLEBAR_HEIGHT` (shared Phase 1 dropdown helper
  `render_titlebar_anchored_dropdown_panel`).
- Full resources project-state payload built and injected, including
  `window.__ghostex_NATIVE_HOST__.codeServerRuntime.port`.
- Focus/sleep/quit, gxserver daemon, openExternalUrl, close, openBrowserPane,
  and Portless action paths handled natively.
- Old Resources NativeMenu symbols removed. `cargo check` exits 0.
