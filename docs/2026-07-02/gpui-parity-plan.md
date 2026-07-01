# GPUI Parity Plan — macOS App → GPUI App

Date: 2026-07-02
Supersedes: `gpui-parity-group-order-draft.md` (order locked there; statuses below are now **code-verified**, not guesses).

Method: 10 parallel verification passes compared actual macOS app behavior (Swift host + `native/sidebar/` + `sidebar/` + `shared/` + `gxserver-rs/`) against actual GPUI code (`gpui/src/main.rs`, `gpui/src/cef/`, `gpui/sidebar/`, `gpui/native/macos/`). The old parity-tracker MDs were ignored entirely. Every status below has file:line evidence behind it (kept in the session's verification reports).

Legend: ✅ working · 🟡 partial · ❌ missing · 🔎 needs runtime verification · 🧭 needs your decision
Size: (S) hours · (M) ~a day · (L) multi-day

---

## The big picture

The port is structurally much further along than expected. Terminals, browser panes, code-server, remote gxserver (incl. SSH install + multi-server tunnels), keep-awake, lid-sleep helper, menu-bar status item, App Shots, agents hub, configure-agents, pinned prompts, scratch pad, delayed send (command panes), previous-sessions restore, kanban/manage surfaces — all genuinely work.

Nearly every real gap falls into one of **four repeating failure patterns**, which is great news — each pattern has one fix-site:

1. **Silent no-op message switches.** The GPUI sidebar runtime (`gpui/sidebar/gxserver-runtime.ts:2156-2453`) and the app-modal command handler (`main.rs:~25991-26647`) drop any unhandled message with no error. ~25 sidebar messages and several modal messages (incl. `focusSession`, `runSidebarCommand`, `updateSettingsPatch`, `toast`, all `automation*`, board `startWork`) currently vanish.
2. **Unregistered modal kinds.** `GpuiAppModalKind` (`main.rs:1309-1352`) omits `worktree`, `deleteWorktree`, `gitFileDiff`, `portlessSetup`, `discoverGhostex`, `floatingPromptEditor` — the React modals are all present in the CEF bundle but can't open.
3. **Missing entry points.** Logic is ported but unreachable: titlebar git button is a dead placeholder, only ~24 hardcoded native hotkeys exist (user hotkey config ignored when a terminal has focus), no main-project git entry.
4. **Missing native host services.** No local gxserver spawn/handshake, no `ghostex://`/file-open routing, no CLI bridge server (port 58743), no floating-prompt-editor host, no crash/log writer, no Sparkle.

The single most consequential one-line-cause finding: `ghostty_runtime_action_cb` is a stub returning `false` (`terminal_ghostty_surface.rs:1159-1164`) — that alone explains missing link-clicking, terminal bell, in-terminal search, and live tab titles.

---

## Batch 0 — Cross-cutting foundations (do first; unblocks most groups)

**STATUS: ✅ IMPLEMENTED 2026-07-02 (all six items; `cargo build` clean).** Scoped follow-ups deferred from Batch 0:

- 0.2: Rust-originated in-modal toasts (`dispatch_gpui_app_modal_toast`) still render inside the open modal window on purpose — the remote-clone flow's lifecycle depends on it. Toast action buttons unsupported (no GPUI producer sends them yet).
- 0.3: dispatcher handles OPEN_URL (live, http/https), SET_TITLE/PWD/RING_BELL (recorded in `agents_terminal_runtime_osc_states` / `command_terminal_runtime_osc_states`, `main.rs`). Batch 2 renders titles/pwd/bell and adds SEARCH/MOUSE_OVER_LINK/DESKTOP_NOTIFICATION tags with their UI.
- 0.4: chords removed/remapped-away stay bound until app relaunch (full keymap rebuild would drop gpui-component's own bindings); hardcoded base binds still registered, so an old default chord keeps working after a remap. Refine later if it bites.
- 0.5: bootstrap is async with status toasts (does not gate window creation like macOS); buildIdentity check + auto-restart on toolchainUnavailable deferred (an honest warning toast shows instead); stop-control-plane API not ported yet.
- 0.1 bonus: the `remoteMachines` source-gate was also added to the bulk `updateSettings` path (macOS parity).

These are not a "group" — each one unblocks items in 3+ groups below.

1. ❌ **`updateSettingsPatch` handler** (S/M) — add the arm to both app-modal handlers (`main.rs:~21858`, `~25991`): merge `message.patch` into the shared snapshot, write via `shared_settings::write_shared_sidebar_settings_object`, run the existing fan-out; honor `baseRevision` like macOS (`native-sidebar.tsx:47196-47201`). **Today nearly every granular Settings/Hotkeys/Ghostty/auto-sleep/open-target edit silently doesn't persist** — only the bulk buttons work. Highest value-per-line fix in the whole port.
2. ❌ **Render inbound `type:"toast"`** (M) — replace `"toast" => {}` (`main.rs:21925`) with a real GPUI toast surface. Unblocks feedback for every git/worktree/sync/clone/commit action.
3. ❌ **Ghostty runtime action dispatcher** (M) — replace the stub (`terminal_ghostty_surface.rs:1159`) with a real `match action.tag`: OPEN_URL (→ existing `gpui_open_url`), RING_BELL, SET_TITLE, PWD, START/END_SEARCH + totals, MOUSE_OVER_LINK, SCROLLBAR, DESKTOP_NOTIFICATION. All action structs are already bound in `ghostty_kit.rs`.
4. ❌ **Native settings-driven hotkey table** (M/L) — read normalized `shared/ghostex-hotkeys.ts` settings into Rust and register via `cx.bind_keys` (rebind on settings save). Today only ~24 hardcoded chords work while a terminal is focused; the whole configurable set (`cmd+shift+p`, `cmd+p`, `cmd+,`, `cmd+r`, `cmd+1..9`, `ctrl+shift+f/o/r/s`, group nav, …) is dead outside the sidebar. macOS reference: `installAppHotkeyEventMonitor` (`AppDelegate.swift:2301`).
5. ❌ **Local gxserver bootstrap + handshake at startup** (L) — spawn/reuse the bundled daemon before creating workspace surfaces; port the version/build/toolchain handshake with restart-on-mismatch (`GxserverClient.swift:174,444-529`); honest daemon-down/mismatch UI; never stop the daemon on quit. Today GPUI assumes an externally-started, protocol-matched daemon and shows generic RPC errors otherwise.
6. ❌ **Modal-kind registry sweep** (S each) — add `Worktree`, `DeleteWorktree`, `GitFileDiff`, `PortlessSetup`, `DiscoverGhostex`, `FloatingPromptEditor` to `GpuiAppModalKind` + `from_modal_id`/titles/sizes. (Each also needs its trigger/payload wiring, tracked in its group.)

---

## Group 0 — App shell & lifecycle (cross-cutting; not in the 18-group list but underlies all of them)

Beyond Batch 0 items 4–5:

- ❌ `ghostex://` URL + file-open routing (M): open-urls/open-files delegate via `.m` shim → `ghostex://terminal|open|edit` handlers + Finder Open-With + the `.command/.tool/.sh` Run/Edit dialog (macOS `AppDelegate.swift:1146,4798-4859`). GPUI can *register* as handler but handles nothing today.
- ❌ Crash + support-bundle logging (M): `std::panic::set_hook` → crash reports under `~/.ghostex/logs/`; sanitized size-capped writers for the GPUI flows macOS logs (remote install, sidebar refresh, terminal focus); writer-boundary tests per AGENTS.md.
- ❌ Native app menu bar (M): `cx.set_menus` — App (About/Check for Updates/Settings/Hide/Quit), File→Close Pane ⌘W, Edit clipboard set, Window→Minimize/Zoom (macOS `installMainMenu` AD:2533).
- 🟡 Window frame persistence (S/M): persist bounds + screen id, restore with multi-monitor logic (AD:3205-3260). Today always centered 1280×820. (Sidebar-width + full layout-tree persistence already ✅.)
- 🟡 Quit behavior (S/M): pre-quit CEF browser-state flush (protects browser logins; AD:1218-1242), will-terminate persistence flush, dock-reopen handling (today closing the one window leaves a windowless app).
- 🟡 Session-restore eagerness 🔎🧭: GPUI restores layout but terminals come back as "Materialize"-on-click placeholders. Verify whether macOS eagerly re-mounts, then auto-materialize previously-visible sessions (the startup launch-plan pipeline already exists: `main.rs:3944,3582`).
- 🟡 Titlebar completeness (M): full Resources dropdown (CPU/RAM, Portless rows, restart, bulk quit/sleep — deferred at `main.rs:43391`), editable session-title area, update slot (Phase B).
- 🔎 Pane-divider min-clamps + double-click reset parity (TWV:14025,15379); derive workspace bg from Ghostty config background (AD:2963); align default sidebar width (235 vs setting).

---

# Phase A — daily-driver parity (your locked order)

## 1. Core session lifecycle & sidebar — 🟡

Working ✅: create/fork/rename (incl. agent selection + launch settings), tags/pin/favorite, sleep/wake incl. group bulk, focus + session slots + project jump hotkeys (from sidebar focus), collapse/expand, intra-group DnD reorder, recents, per-session search overlay, presentation restore.

Work items:
- 🧭❌ **Named session groups** (L) — GPUI derives one group per project; the whole user-group model (`createGroup`, `createGroupFromSession`, `renameGroup`, `closeGroup`, `moveSessionToGroup`, `syncGroupOrder`, `fullReloadGroup`) silently no-ops. gxserver has no group storage — macOS keeps it client-side in `shared/simple-grouped-session-workspace-state.ts`. **Decision #1:** adopt that shared model + client persistence in GPUI, or officially drop sub-project groups (then hide the dead menu items).
- ❌ **Add local project** (M) — `pickWorkspaceFolder` no-ops; no folder picker exists. Native NSOpenPanel shim → `/api/addProjectPath` (the existing Rust handler is remote-only, `main.rs:22427`).
- ❌ Clone-flow messages (S, with G5's local-clone fix): `cloneRepository`, `previewRepositoryClone`, `cancelRepositoryClone`, `browseRemoteProjectDirectories`, `addRemoteProjectPath` → existing gxserver endpoints.
- ❌ Dead card/context actions (S each): `copySessionDetails`, `fullReloadSession`, `toggleCloseAfterDone`, `closeInactiveProjectSessions`, `sleepInactiveProjectSessions`, `wakeProjectSleepingSessions`.
- ❌ `searchPreviousSessionsByText` → `/api/searchSessions` (S).
- 🔎 Group affordances may render dead-but-visible; `restartSession` trigger site; startup auto-materialize (Group 0).

## 2. Terminal panes & tabs (incl. command panes) — 🟡→✅ core, with sharp edges

Working ✅: splits/tabs/reorder/cross-pane drag, close scopes, close-confirm, IME (full NSTextInputClient), file drop, full-width rows/merge/rotate, command panes (pinned/floating/collapsed, scoped close, rename, full delayed-send system), sleeping placeholders + click-to-wake.

Work items:
- ❌ **Ghostty action dispatcher** (Batch 0.3) then: in-terminal **search bar UI** (M, macOS `TerminalSearchBarView`), link-click + hover underline (S), live OSC title/pwd → tab labels (S/M), terminal BEL → bell/attention (S), optional scrollbar overlay + scroll-to-row (M).
- ❌ **Native hotkey table** (Batch 0.4) then register the missing chords; fix tab-cycle chords (`ctrl-tab` vs shared `cmd+tab`/alternates — 🔎 confirm macOS actually binds cmd+tab).
- 🧭❌ **Pop-out pane windows** (L) — full no-op today; macOS re-parents the surface into a real NSWindow (TWV:16356-16553). **Decision #2:** in scope?
- ❌ Fork/Reload session for focused Agents terminals (S/M) — universal `RuntimeNoOp` today; macOS has real titlebar/menu actions.
- ❌ Delayed Send via hotkey for Agents terminals (S) — command panes only today.
- 🟡 Agents sleeping bodies: add press-any-key wake (S); add "Sleep Inactive Sessions" titlebar batch route (S); 🔎 workspace tab overflow affordance.
- 🔎 Runtime checks: CJK candidate placement, drop-path quoting/multi-file join, focus-border across CEF↔Ghostty, close-confirm copy.

## 3. Prompt editor & prompts — ❌ the headline gap

Working ✅: pinned prompts, scratch pad, delayed send (command-pane scope).

Work items:
- ❌ **Floating prompt editor host** (L — the biggest single build in Phase A). macOS chain: server injects `ghostex n` as $EDITOR → CLI calls the app's localhost bridge (`HostProtocol.openFloatingEditor`) → prewarmed Monaco window + save/cancel status-file handshake. GPUI has only the attach-preference flag; no modal kind, no bridge endpoint, no window. Build: modal kind + CLI bridge endpoint (pairs with Phase B CLI-bridge server) + window lifecycle + return-focus. Until then, guard the `promptEditorBackend=monaco` setting so it isn't advertised unserviced.
- ❌ Image paste/preview (M) — blocked on the editor host; then wire `floatingPromptEditorImagePaste`.
- ❌ **First-prompt title Enter-submit** (S/M) — server generates titles, but GPUI never presses the staged Return (macOS: `shouldSubmitStagedFirstPromptTitleCommand` → `sendTerminalEnter`, `native-sidebar.tsx:4091,4164`). Port the transition detection; reuse the Delayed-Send Return keypath. Cheap, daily-visible.
- 🟡 Cross-client routing: sending half done; receiving half lands with the editor host.

## 4. Command palette, hotkeys & custom commands — 🟡

Working ✅: palette opens (menu/sidebar-hotkey), command list, previous-sessions restore/delete, configure-actions modal, sidebar command execution end-to-end, icon picker.

Work items:
- ❌ Palette `focusSession` (S) — selecting a running session does nothing (`main.rs:26647` fallthrough). Route to native focus/materialize.
- ❌ Palette `runSidebarCommand` (S/M) — resolve commandId+runMode → existing `run_gpui_titlebar_action` path.
- ❌ Hotkey persistence + native table — Batch 0.1 + 0.4; then verify recorder → settings → live rebind loop.
- 🧭 `searchPreviousSessionsByText` (S) — wire to `/api/searchSessions`, or confirm the text-search launch is retired (**Decision #4**).

## 5. Git & worktrees — 🟡 logic ported, entry points missing

Working ✅ (when reachable): commit modal flow incl. multi-commit + blank-message generation, file-diff within commit, PR create/view + agent workflow, merge-to-main, worktree create/open backend, sync flows in runtime.

Work items:
- ❌ **Titlebar git menu** (M) — the `"git"` button has no handler (`main.rs:43366-43438`). Build native menu from `buildSidebarGitMenuItems` (or CEF popover like tips), split primary label via `resolveSidebarGitPrimaryActionState`, route into the runtime's existing `runSidebarGitAction`. This is the reachability key for commit/push/PR/sync on main projects.
- ❌ Toasts — Batch 0.2 (all git feedback is invisible today).
- ❌ Worktree modals (S/M): register `worktree` + `deleteWorktree` kinds; add the missing `promptDeleteWorktreeForGroup` runtime handler (branch/status read → draft → modal → confirm → existing `/api/deleteWorktreeProject`).
- ❌ **Local repository clone** (S/M) — `cloneRepository` without `remoteMachineId` errors out ("remote machine unavailable", `main.rs:22571-90`). Treat missing id as local against the local daemon.
- ❌ Git-state refresh driver (M) — nothing ever posts `refreshGitState` in GPUI; add periodic/on-focus refresh for visible non-Quick projects + decide where dirty/ahead-behind surfaces.
- ❌ Project diff stats (M) — header +/- hardcoded to zeros (`gxserver-runtime.ts:10651`); port the numstat refresh loop + projection overlay.
- ❌ Standalone `gitFileDiff` modal registration (S) once a trigger exists (changed-files list in git menu).
- 🔎 merge-back delete-after cleanup; `openExistingPullRequestInBrowser` bridge subtype.

## 6. Settings — 🟡 (mostly one bug away)

Working ✅: modal + all tabs render; full read/hydrate path (no key loss); bulk writes; integrations tab; remote tab actions; agents tab; managed Ghostty config actions (apply-recommended/reset/open); notifications permission; Keychain; sounds preview; App Shots settings.

Work items:
- ❌ **Batch 0.1** (`updateSettingsPatch`) — restores persistence for effectively the whole modal.
- ❌ Open-target availability detection (S/M) — GPUI-only machines show just "Open Folder"; port the IDE detection scan (macOS `native-sidebar.tsx:8014-8098`) or verify the shared detection runs in the GPUI sidebar.
- 🧭 App Icon picker (S/M) — `listAppIcons`/`setAppIcon` unhandled. **Decision #5:** implement native icon swap or hide the section.
- 🟡 Live-apply (S/M): apply `sidebarSide` in the post-save fan-out (today the dropdown doesn't move the sidebar); document/decide live Ghostty reload for running surfaces (needs a GhosttyKit reload FFI — likely "new surfaces only" for now).
- ❌ git-editor auto-sleep family — tied to the git-editor surface decision (Group 10 / Decision #6).
- 🔎 New surfaces load theme/font-family (not just size) from managed config; auto-sleep favorite/require-resume exclusions in `createGpuiAutoSleepAgentSessionIds`.

## 7. Agents — ✅ mostly

Working ✅: agents hub (native Rust catalog scanner + all file actions), configure-agents + per-agent config + ordering, per-project policy reconcile, hook status/install/uninstall, server-side completion detection → indicators.

Work items:
- ❌ **Completion sound + flash on attention** (S) — nothing emits `playCompletionSound`; macOS plays `settings.completionSound` + flashes the card. Emit from the GPUI runtime on idle→attention transitions (dedupe by `attentionEventId`); shared listener already exists (`sidebar-app.tsx:1381`). (Same item referenced in Group 12.)
- 🟡 Progressive per-provider hook-status posting vs today's single 45s batch (S/M — or accept).
- 🔎 Monaco loads inside Agents Hub under CEF; add a shared fixture test so the Rust scanner doesn't drift from `agents.rs`.

## 8. Session history & search — 🟡

Working ✅: previous-sessions browse/filter/restore/delete (restore = real `/api/createSession` with `restoredFromSessionId`), daemon-sessions viewer + per-session kill, auto-refresh.

Work items:
- ❌ `killTerminalDaemon` stub (S/M) — implement daemon-stop parity.
- ❌ T3 kill stubs — blocked on T3 runtime authority (Group 10 / Decision #7).
- 🔎 Restore row-id always populated (silent no-op otherwise); restored session actually mounts a surface.
- 🧭 zehn text-search launch (Decision #4, shared with Group 4).

## 9. Browser panes — ✅ core, 🟡 profiles

Working ✅: tabs/splits/toolbar/address normalization (matches macOS contract incl. Google fallback), history menus, favicons, DevTools, popups→shell-tab routing, Agentation + React Grab injection (same pinned versions, github gate), CDP port exposed for browser-use.

Work items:
- ❌ **Profile persistence** (S code, high value) — per-profile `cache_path` is deliberately empty (`cef/macos.rs:2298-2346`): cookies/logins die with the app. Set per-profile on-disk paths like `GhostexCEFRequestContextForProfile`.
- 🧭❌ Named profiles + **Import Browser Data** (L) — generated "Profile N" only; the whole import stack (Chrome/Brave/Edge/Arc/Firefox + Keychain Safe-Storage decrypt, ~940 lines of Swift) is unported. **Decision #8:** how much of this matters?
- ❌ `openBrowser`/`openBrowserPane` renderer commands (S/M) — `ghostex browser open` (and agent browser-use step 1) throws "Unsupported renderer command" (`gxserver-runtime.ts:1456-1517`). Add handlers incl. reuse semantics.
- ❌ CEF permission handler (S) — grant clipboard for the code-server trusted origin like macOS (`GhostexCEFBridge.mm:1029-1091`).
- S: honor `GHOSTEX_CEF_REMOTE_DEBUGGING_PORT` (env-var name drift). 🔎 tab-hover close/favicon behavior.

## 10. Editor & docs panes — 🟡

Working ✅: code-server runtime (launch/health/theme-seed/settings-restart), t3 session create/focus + URL routing through browser CEF.

Work items:
- ❌ code-server idle-stop (S) — stop the process when every Source surface sleeps (macOS does; GPUI only hides the view).
- 🧭❌ **T3 runtime authority** (L) — GPUI owns no local T3 server process (kills are stubs; hibernation moot). **Decision #7:** port `NativeT3RuntimeLauncher` into GPUI vs move ownership into gxserver.
- ❌ t3BrowserAccess + t3ThreadId modal wiring (S/M) — modals present, never triggered.
- ❌ meo/docs bridge completion (M): add `gitBaseline` to read/save (git gutter is dead), implement `rename/duplicate/delete/createFolder/move` (all "Unsupported" today), 🔎 docs-folder scoping + `.excalidraw` acceptance.
- 🧭❌ **Missing surfaces** (M each): distinct **git-editor** mode (GitHub-remote-seeded browser surface + own auto-sleep family) and **automate** mode (automations UI pane). **Decision #6.**

## 11. Kanban board & automations — 🟡 board, ❌ automations/links

Working ✅: kanban board CRUD/status/comments via gxserver beads bridge; manage surface bridge routed.

Work items:
- ❌ **Automations client wiring** (M) — engine (`gxserver-rs/src/automations/`) + endpoints + UI all exist; GPUI's board bridge handles zero `automation*` actions → whole surface dead. Pure wiring: forward to the existing endpoints, live `automationGetState/GetAllState`, wire run-session/worktree navigation, confirm beta-features gate reachable.
- ❌ **Bead↔conversation links + startWork** (M/L) — the "work a ticket" flow is fully stubbed (`main.rs:62824` handles only `getState`, with an empty context). Implement startWork (launch/attach session, seed `buildAgentWorkPrompt`, create link), link lifecycle, live context.
- ❌ `generateTitle` beads action (S) — explicitly rejected today.
- 🔎 drag-between-lanes end-to-end; manage file responses (overlaps Group 10 meo items).

## 12. Notifications, sounds & ambient — 🟡

Working ✅: attention banners (rate-limited, click-to-jump), menu-bar status item (near-verbatim native port incl. Running Agents panel), App Shots, action-completion sound, reduce-motion support (GPUI is *ahead* of macOS here).

Work items:
- ❌ Agent-turn completion sound (S) — same fix as Group 7; today only action/command completion plays.
- ❌ Terminal BEL → attention (S) — lands with the Ghostty dispatcher (Batch 0.3); verify the pipeline after.
- 🧭❌ **Desktop pet floating window** (M/L) — GPUI pet is in-window bottom-right; macOS pet is a draggable, all-Spaces floating panel with activity bubbles + persisted position. Animation engine already ported — this is a windowing/presentation port. **Decision #9:** priority?
- 🔎 phone notifications: no push path found anywhere in scope — confirm it's not a feature (likely N/A).

## 13. Remote & portless — ✅ mostly (big surprise)

Working ✅: multi-server remote gxserver connections, full SSH install flow (probe/upload/install/token/Keychain/tunnel), presentation over tunnel, remote project picker, remote attach/resume, portless admin backend + settings sync.

Work items:
- ❌ Portless setup modal registration + first-launch prompt (S/M) — backend works; guided setup unreachable (`postponePortlessSetupPrompt` stubbed).
- 🔎 CI/build produces both Linux remote-gxserver packages (build validates their presence).

## 14. OS integration & power — ✅ mostly

Working ✅: keep-awake end-to-end (menu, caffeinate, auto-hold, power rules), lid-sleep privileged helper (real helper compiled + staged, XPC), Open In targets (menu + launch + configure), accessibility reduce-motion.

Work items:
- 🔎 `keepAwakeDeactivateOnUserSwitch` no-op — confirm macOS behavior, port if concrete (S).
- 🔎 lid-sleep XPC designated-requirement vs GPUI signing identity (matters once real signing lands in Phase B).

---

# Phase B — long-tail / pre-release

## 15. Onboarding & discovery — 🟡
- ✅ First-launch setup, Tips, Watch-video modals open manually.
- ❌ `discoverGhostex` modal kind (S); ❌ automatic first-run sequence (S/M): persisted first-run flag + auto-open chain (Highlighted Features → firstLaunchSetup), plus the portless first-run prompt (Group 13).

## 16. Updates & distribution — ❌ (blocks distributing the GPUI app at all)
- No Sparkle, no Developer-ID signing (ad-hoc only), no notarization, version hardcoded 0.1.0, titlebar update button permanently dead.
- Work (L total): Sparkle framework + keys + user driver; DevID sign + notarize + staple in `build-macos-app.sh`; GPUI appcast + `release-ghostex.mjs` extension; back `checkForUpdate`/`downloadUpdate`/`showUpdateDialogFromTitlebar`.

## 17. CLI & external entry points — 🟡
- ✅ gxserver-backed CLI commands work; CLI + skills staged into the bundle; `ghostex://` registered.
- ❌ Native CLI bridge server (M): serve port 58743 + write `bridge-token` (EDITOR-facing/legacy commands fail today; also the transport the floating prompt editor needs — build together with Group 3).
- ❌ CLI app activation targets "Ghostex" not "Ghostex GPUI" (S — parameterize/bundle-id).
- ❌ Runtime `ghostex://` handling (Group 0 item).

## 18. Support & polish — 🟡
- ❌ Logging + crash reporting (Group 0 item). ✅ App Shots. 🔎 vestigial `.ghostex-gpui` Info.plist home-dir keys (Rust uses `~/.ghostex`) — confirm nothing consumes them.

---

# Decisions I need from you (🧭)

1. **Named session groups** (G1): adopt macOS's client-side group model in GPUI, or drop sub-project groups (and hide the dead UI)?
2. **Pop-out pane windows** (G2): in scope for the GPUI app?
3. **Restore eagerness** (G0/G1): should terminals auto-materialize on relaunch (pending verification of exact macOS behavior)?
4. **zehn text-search launch** (G4/G8): restore "search previous sessions by text" as a first-class GPUI capability, or leave it CLI-only?
5. **App Icon picker** (G6): implement natively or hide the section?
6. **git-editor + automate surfaces** (G10): add both as distinct GPUI modes (with git-editor auto-sleep family), or fold permanently into Browser/skip?
7. **T3 runtime ownership** (G10): port the local T3 launcher into GPUI, or move runtime ownership into gxserver?
8. **Browser profile import** (G9): full named-profiles + cookie-import port (~L), or persistence-only for now?
9. **Desktop pet floating window** (G12): how much do you care, and when?
10. **Phone notifications** (G12): confirm this isn't an existing feature (none found outside iOS/).

---

# Suggested execution order (explicit next batches)

- **Batch 0 (foundations):** updateSettingsPatch → toasts → Ghostty action dispatcher → native hotkey table → modal-kind sweep → daemon bootstrap. (Order within batch = listed.)
- **Batch 1 (G1):** add-local-project picker → dead card actions → groups decision + implementation → clone messages.
- **Batch 2 (G2):** search-bar UI + link/bell/titles on top of the dispatcher → missing chords → fork/reload/delayed-send for Agents → sleeping-wake parity → (pop-out if in scope).
- **Batch 3 (G3+G4):** first-prompt Enter-submit (quick win) → palette focusSession/runSidebarCommand → floating prompt editor host (+ CLI bridge server from G17, built once, used by both).
- **Batch 4 (G5):** titlebar git menu → worktree modals + delete handler → local clone → git-state driver + diff stats.
- **Batch 5 (G6):** open-target detection → live-apply items → App Icon decision.
- Then G7–G14 in list order (each is now small), Phase B last — **except** consider pulling **G16 signing/updates** earlier if you want other machines/people on the GPUI build while the rest lands.

Verification protocol per batch: after each batch lands, run the app and walk the affected flows side-by-side with the macOS app before moving on (no automated tests in gpui/ per repo policy).
