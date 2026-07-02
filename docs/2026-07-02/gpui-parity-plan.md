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

## 1. Core session lifecycle & sidebar — ✅ (Batch 1)

**STATUS: ✅ IMPLEMENTED 2026-07-02 (Batch 1; `cargo check` + vite bundle + repo `bun run typecheck` clean; runtime verification pending user side-by-side run).** Notes:

- 1.1 Add local project: `pickWorkspaceFolder` → runtime posts through the app-modal bridge → Rust `cx.prompt_for_paths` (GPUI-native NSOpenPanel; no new ObjC shim needed) → result script-injected back (`onWorkspaceFolderPicked`) → runtime calls **local** `/api/addProjectPath`, focuses + refreshes. Bonus: `pickRepositoryFolder` (clone modal destination picker) wired the same way → `repositoryFolderPicked` back to the modal.
- 1.2 Dead card/context actions: `copySessionDetails` (Rust clipboard via app-modal bridge), `toggleCloseAfterDone` (full macOS-parity 3-minute done-stability timer, client-side, persisted, countdown projection on cards, macOS toast copy), `closeInactiveProjectSessions` / `sleepInactiveProjectSessions` / `wakeProjectSleepingSessions` (same inactive definition as macOS: not sleeping, activity not working/attention; local + remote groups). Also `fullReloadSession`/`restartSession`/`fullReloadProjectZmxSessions`/`fullReloadGroup` — verified macOS reload is native detach+reattach (NOT a gxserver endpoint); GPUI implements it as sleep→wake through existing lifecycle paths (local sessions; zmx-only for the project bulk variant).
- 1.3 Clone flow: `cloneRepository`/`previewRepositoryClone`/`cancelRepositoryClone` now treat missing `remoteMachineId` as the LOCAL daemon (shared job handlers, dual local/remote RPC transport, same toast lifecycle incl. Cancel action + 700ms-equivalent poll). `browseRemoteProjectDirectories`/`addRemoteProjectPath` were already wired (remote-only by design).
- 1.4 `searchPreviousSessionsByText`: **instruction said `/api/searchSessions`, but verified macOS behavior launches a `gx f` terminal** ("Search by Text", active project). User chose macOS parity (= Decision #4 resolved: keep the launcher). GPUI creates an agent session with launch command `gx f`. Note: the Previous Sessions overlay's server-side query search already worked via `/api/listPreviousSessions`; no macOS sidebar code calls `/api/searchSessions` at all.
- 1.5 Named groups (**Decision #1: user chose to port the full model**, knowing shipped macOS exposes no group-creation UI): new `gpui/sidebar/workspace-session-groups.ts` client-side overlay (localStorage; ids `group-${n}`, max 20, macOS reducer semantics) + full runtime wiring (`createGroup`, `createGroupFromSession`, `renameGroup`, `closeGroup` incl. member close, `moveSessionToGroup` incl. DnD, `syncGroupOrder` incl. persistent project-section reordering, sub-group `syncSessionOrder`, `createSessionInGroup`, group sleep/wake, `fullReloadGroup`, focus routing) + sub-groups spliced into the presentation projection under their project. New shared-contract flag `canCreateSessionGroup` gates brand-new "New Group" (project header menu) and "Move to New Group" (card menu) affordances — macOS never sets the flag, so its UI is unchanged.
- Deferred edges recorded in `deferred-out-of-scope.md` (remote-session reload, delayed-send sleep exclusion, atuin prefix, remote-project groups).

Previously working ✅: create/fork/rename (incl. agent selection + launch settings), tags/pin/favorite, sleep/wake incl. group bulk, focus + session slots + project jump hotkeys (from sidebar focus), collapse/expand, intra-group DnD reorder, recents, per-session search overlay, presentation restore.

Original work items (all landed above):
- 🧭❌ **Named session groups** (L) — GPUI derives one group per project; the whole user-group model (`createGroup`, `createGroupFromSession`, `renameGroup`, `closeGroup`, `moveSessionToGroup`, `syncGroupOrder`, `fullReloadGroup`) silently no-ops. gxserver has no group storage — macOS keeps it client-side in `shared/simple-grouped-session-workspace-state.ts`. **Decision #1:** adopt that shared model + client persistence in GPUI, or officially drop sub-project groups (then hide the dead menu items).
- ❌ **Add local project** (M) — `pickWorkspaceFolder` no-ops; no folder picker exists. Native NSOpenPanel shim → `/api/addProjectPath` (the existing Rust handler is remote-only, `main.rs:22427`).
- ❌ Clone-flow messages (S, with G5's local-clone fix): `cloneRepository`, `previewRepositoryClone`, `cancelRepositoryClone`, `browseRemoteProjectDirectories`, `addRemoteProjectPath` → existing gxserver endpoints.
- ❌ Dead card/context actions (S each): `copySessionDetails`, `fullReloadSession`, `toggleCloseAfterDone`, `closeInactiveProjectSessions`, `sleepInactiveProjectSessions`, `wakeProjectSleepingSessions`.
- ❌ `searchPreviousSessionsByText` → `/api/searchSessions` (S).
- 🔎 Group affordances may render dead-but-visible; `restartSession` trigger site; startup auto-materialize (Group 0).

## 2. Terminal panes & tabs (incl. command panes) — ✅ (Batch 2)

**STATUS: ✅ IMPLEMENTED 2026-07-02 (Batch 2; `cargo check` + vite bundle + repo `bun run typecheck` clean; runtime verification pending user side-by-side run).** Notes:

- 2.1 Live OSC titles → tab labels: new `gpui/src/terminal_osc_title.rs` ports the shared `getVisibleTerminalTitle` trust rules (ghost/path-like/generic-agent/status-word/placeholder rejection); workspace + command tab labels prefer the live recorded OSC title over the model title at render time. PWD stays recorded-only — verified macOS accepts-and-ignores GHOSTTY_ACTION_PWD (TWV:1820), so there is nothing to render for parity.
- 2.2 Terminal BEL → attention: Rust forwards the rung mapped Agents session's gxserver identity over a new `onWorkspaceTerminalBell` bridge; the sidebar runtime gates on `showNotificationOnTerminalBell` and commits `/api/updateAgentActivity {event:"bell"}` like macOS (attention then flows back through the normal presentation channel). Local mapped Agents sessions only (see deferred).
- 2.3 MOUSE_OVER_LINK: dispatched into per-surface runtime OSC state; hovered links show a pointer cursor on the terminal body. OPEN_URL click was already live from Batch 0.3. Verified macOS's host neither changes the pointer nor shows a hover-URL overlay (the underline comes from libghostty's renderer), so GPUI is at-or-above parity. DESKTOP_NOTIFICATION deliberately NOT dispatched — verified macOS `handleAction` (TWV:1817–58) does not handle it either.
- 2.4 In-terminal search: START/END_SEARCH + SEARCH_TOTAL/SELECTED dispatched; `ghostty_surface_binding_action` FFI added; **Cmd+F** triggers `start_search` on the focused terminal surface (verified macOS chord — TWV:22943 uses plain Cmd+F at surface level; the g2 report's "ctrl+cmd+f" was GPUI's pre-existing Focus-mode bind, and there is no configurable hotkey id for terminal search). The bar (input + n/total count + prev/next/close) renders as a normal-layout chrome row above the terminal body, right-aligned — same discipline as the close-confirm banner, because GPUI elements cannot float above the AppKit terminal view. Needle → `search:<needle>`, Return/Shift+Return + buttons → `navigate_search:next/previous`, Escape/close → `end_search` + terminal refocus.
- 2.5 Chords: verified the Batch 0.4 configured table + dispatcher already covered nearly the whole g2 F2 list (palette, session search, settings/hotkeys, rotate, prev/next group, session slots, project jumps, action slots). Added: cmd+shift+]/[ session-cycle aliases (macOS `defaultHotkeyAliases` AD:6086; macOS DOES also bind cmd+tab, AD:5976, though the system app switcher usually owns it — ctrl-tab/ctrl-shift-tab remain GPUI extras); cmd+r now renames the focused mapped Agents session via the shared Rename modal when the command pane doesn't own focus (macOS `promptRenameFocusedNativeHotkeySession` parity).
- 2.6 Fork/Reload for Agents: new `onWorkspaceTerminalRuntimeAction` bridge; ctrl+shift+f / ctrl+shift+r (and palette rows) on a focused mapped Agents terminal run the runtime's existing card fork (`/api/forkSession` + focus follow-up) and full-reload (sleep→wake) paths; the Agents tab context menu gained "Fork Session"/"Reload Session" rows for mapped sessions (macOS pane-titlebar action parity).
- 2.7 Delayed Send for Agents: ctrl+shift+s opens the shared Delayed Send modal for the focused mounted Agents terminal via new `GW{u64}` bridge ids; schedule/cancel handlers gained an Agents fallback; firing presses Enter through the existing Ghostty Return keypath; active Agents timers hold Keep Awake like command timers. Timers are runtime-only (see deferred).
- 2.8 Sleeping-wake: press-any-key wake for the focused visible sleeping Agents tab (same alphanumeric filter as command panes, routed through placeholder activation incl. mapped gxserver wake); "Sleep Inactive Sessions" is reachable from the Resources titlebar glyph's new right-click menu → the runtime revalidates via the shared inactive filter across local + remote presentations.
- 2.9 Startup auto-materialize (Decision #3): the presentation focus state (focused + visible gxserver session ids) persists to `state/gpui-gxserver-presentation-focus-state.json` and seeds the relaunch bootstrap; after the first presentation hydrate the runtime re-attaches the previously focused running local session through the normal workspace focus bridge. Background/hidden and sleeping sessions stay lazy. Focused-session-only for now (see deferred).
- Pop-out stays a clean no-op (Decision #2). Runtime checks (CJK candidates, drop-path quoting, CEF↔Ghostty focus border, close-confirm copy) still need the user's side-by-side run, plus the new Batch 2 flows above.

Previously working ✅: splits/tabs/reorder/cross-pane drag, close scopes, close-confirm, IME (full NSTextInputClient), file drop, full-width rows/merge/rotate, command panes (pinned/floating/collapsed, scoped close, rename, full delayed-send system), sleeping placeholders + click-to-wake.

Original work items (all landed above except pop-out, by decision):
- ❌ **Ghostty action dispatcher** (Batch 0.3) then: in-terminal **search bar UI** (M, macOS `TerminalSearchBarView`), link-click + hover underline (S), live OSC title/pwd → tab labels (S/M), terminal BEL → bell/attention (S), optional scrollbar overlay + scroll-to-row (M).
- ❌ **Native hotkey table** (Batch 0.4) then register the missing chords; fix tab-cycle chords (`ctrl-tab` vs shared `cmd+tab`/alternates — 🔎 confirm macOS actually binds cmd+tab).
- 🧭❌ **Pop-out pane windows** (L) — full no-op today; macOS re-parents the surface into a real NSWindow (TWV:16356-16553). **Decision #2:** in scope?
- ❌ Fork/Reload session for focused Agents terminals (S/M) — universal `RuntimeNoOp` today; macOS has real titlebar/menu actions.
- ❌ Delayed Send via hotkey for Agents terminals (S) — command panes only today.
- 🟡 Agents sleeping bodies: add press-any-key wake (S); add "Sleep Inactive Sessions" titlebar batch route (S); 🔎 workspace tab overflow affordance.
- 🔎 Runtime checks: CJK candidate placement, drop-path quoting/multi-file join, focus-border across CEF↔Ghostty, close-confirm copy.

## 3. Prompt editor & prompts — ✅ (Batch 3)

**STATUS: ✅ IMPLEMENTED 2026-07-02 (Batch 3; `cargo check` + vite bundle clean; runtime verification pending user side-by-side run).** Notes:

- 3.1 First-prompt title Enter-submit: the GPUI runtime detects generating→done transitions on presentation snapshots/deltas via the shared `native/sidebar/first-prompt-title-submit` rules, dedupes once per session, keeps the card "Generating title" spinner up until after submit (same 1s settle delay as macOS), and presses a REAL Return through a new `postWorkspaceTerminalEnter` sidebar bridge → `send_return_key_to_mounted_agents_terminal_surface` — no tab selection, no focus steal (macOS `sendTerminalEnter` preserveFocus parity). Mounted active-tab only; background tabs skip (deferred).
- 3.2 Palette focusSession: new app-modal arm forwards the projected sidebar session id Rust→runtime over a first-party `onCommandPaletteSessionFocus` script bridge (pending queue included); the runtime validates the id shape (combined local project-session or remote presentation id) and reuses the reviewed `focusSession` routing — local materialize, sleeping wake, remote-shaped ids included.
- 3.3 Palette runSidebarCommand: selector-only forwarding (commandId + optional runMode) over `onCommandPaletteRunSidebarCommand`; the runtime resolves the trusted saved/HUD command and executes through the existing strict SidebarCommandAction bridge → `run_gpui_titlebar_action`. Renderer command text/URLs/paths never enter the path.
- 3.4 CLI bridge server: new `gpui/src/cli_bridge.rs` — loopback newline-JSON TCP on 58743, per-launch token at `~/.ghostex/cli/bridge-token` (0600 file in 0700 dir), constant-time auth, malformed/unauthenticated clients closed before command decode. **Verified post-gxserver-cutover the only CLI consumer of this bridge is `openFloatingEditor`** (every other `ghostex` command is daemon-owned), so the server scope is exactly that command. Bind failure (usually the macOS app already owning 58743) surfaces one honest toast and GPUI runs without a bridge.
- 3.5 Floating prompt editor host: the `FloatingPromptEditor` modal kind (registered by Batch 0.6) now opens as a real GPUI app-modal window (432×352, sized to the shared React editor panel) from CLI bridge commands. Rust reads the prompt draft file, cancels any previous active request, owns the saved/cancelled status-file handshake (a generic close resolves as saved because React live-writes drafts — macOS lifecycle-close contract), handles `floatingPromptEditorSave`/`Cancel`/`DraftUpdate`, and returns focus to the originating terminal (direct mounted-tab focus like macOS `focusTerminal`, else the menu-bar-activation sidebar focus route = macOS sidebar fallback). Monaco capability at attach is now gated on `promptEditorBackend=="monaco"` AND the bridge actually running, so the capability is never advertised unserviced.
- 3.6 Image paste/preview: `floatingPromptEditorPasteImage` resolves the clipboard (copied image files first, then bitmap data — macOS pasteboard order) into durable files under `~/.ghostex/i` with compact timestamp names and tilde display paths; `floatingPromptEditorLoadImagePreview` returns base64 data URLs for Chromium-renderable formats with a 10MB cap. TIFF/HEIC native re-encode deferred.
- 3.7 Cross-client prompt routing (receiving half): complete by construction — routed Ctrl+G opens travel the same zmx-leader-capability → CLI → localhost-bridge path as local ones, and the capability is only advertised while serviceable (3.4 + 3.5 + the attach gate).

Previously working ✅: pinned prompts, scratch pad, delayed send (command-pane scope; Agents scope landed in Batch 2.7).

Original work items (all landed above):
- ❌ **Floating prompt editor host** (L — the biggest single build in Phase A). macOS chain: server injects `ghostex n` as $EDITOR → CLI calls the app's localhost bridge (`HostProtocol.openFloatingEditor`) → prewarmed Monaco window + save/cancel status-file handshake. GPUI has only the attach-preference flag; no modal kind, no bridge endpoint, no window. Build: modal kind + CLI bridge endpoint (pairs with Phase B CLI-bridge server) + window lifecycle + return-focus. Until then, guard the `promptEditorBackend=monaco` setting so it isn't advertised unserviced.
- ❌ Image paste/preview (M) — blocked on the editor host; then wire `floatingPromptEditorImagePaste`.
- ❌ **First-prompt title Enter-submit** (S/M) — server generates titles, but GPUI never presses the staged Return (macOS: `shouldSubmitStagedFirstPromptTitleCommand` → `sendTerminalEnter`, `native-sidebar.tsx:4091,4164`). Port the transition detection; reuse the Delayed-Send Return keypath. Cheap, daily-visible.
- 🟡 Cross-client routing: sending half done; receiving half lands with the editor host.

## 4. Command palette, hotkeys & custom commands — ✅ (Batch 3 + Batch 0)

**STATUS: ✅ IMPLEMENTED 2026-07-02.** Palette `focusSession` and `runSidebarCommand` landed in Batch 3 (see Group 3 status block, items 3.2/3.3). Hotkey persistence + the native settings-driven table landed in Batch 0.1/0.4; the recorder → settings → live rebind loop still needs the user's runtime verification pass. `searchPreviousSessionsByText` was resolved as the `gx f` launcher (Decision #4, Batch 1.4).

Previously working ✅: palette opens (menu/sidebar-hotkey), command list, previous-sessions restore/delete, configure-actions modal, sidebar command execution end-to-end, icon picker.

Original work items (all landed):
- ~~❌ Palette `focusSession` (S)~~ — Batch 3.2.
- ~~❌ Palette `runSidebarCommand` (S/M)~~ — Batch 3.3.
- ~~❌ Hotkey persistence + native table~~ — Batch 0.1 + 0.4; runtime rebind-loop verify pending.
- ~~🧭 `searchPreviousSessionsByText`~~ — Decision #4 resolved (Batch 1.4 `gx f` launcher).

## 5. Git & worktrees — ✅ (Batch 4)

**STATUS: ✅ IMPLEMENTED 2026-07-02 (Batch 4; `cargo check` + vite bundle clean; a targeted tsc sweep of `gpui/sidebar` shows only the 10 pre-existing branded-type errors in untouched code; runtime verification pending user side-by-side run).** Notes:

- 4.1 Titlebar git menu: the `"git"` glyph (left/right click) opens an OS-owned NativeMenu — Status rows (Branch = click-to-copy, `Changes +A −D` = open commit screen, `Commits ↑a ↓b` = remote sync, disabled via the shared reason + delta check) then the Actions rows from the shared `buildSidebarGitMenuItems`, with the `resolveSidebarGitPrimaryActionState` split-primary label on the check-marked primary row (a native menu can't express the split button; macOS's button is also just a dropdown launcher). State flows runtime→Rust over a new manifest bridge fn `postTitlebarGitMenuState` (built in TS by the shared menu builders — single owner of labels/disabled gating; Rust validates against a fixed selector set + bounded strings). Selections flow Rust→runtime as fixed action selectors over a new `onTitlebarGitAction` script bridge (pending queue), scoped to the active group so remote-project groups route through the reviewed remote git path. Menu open also fires a quiet background `refresh`. The git glyph shows the existing badge dot when the repo is dirty or ahead/behind.
- 4.2 Worktree create round-trip FIXED — the modal opened (Batch 0.6 full-message forward) but its `requestProjectWorktrees`/`createProjectWorktree` sidebarCommands were silently dropped by the Rust app-modal command handler (`_ => {}`), and the runtime's `projectWorktreesResult` reply was posted to SidebarApp (which doesn't render the modal) instead of the modal window. Now: commands forward to the runtime over a typed field-allowlisted `onWorktreeModalCommand` bridge; the reply travels the macOS route (runtime → app-modal host → Rust → open modal window); `pickWorktreeImages` opens a native multi-file picker → `worktreeImageFilesPicked`.
- 4.3 Worktree delete: `promptDeleteWorktreeForGroup` (local + remote) ported — fresh `branch`/`status`/`remoteBranchExists` reads via gxserver typed ops, `worktreeDeleteDraft` built with the macOS branch-metadata rules, registered DeleteWorktree modal opened with the draft; `confirmDeleteWorktree` (local + remote) → existing `/api/deleteWorktreeProject` honoring `deleteLocalBranch`/`deleteRemoteBranch`, with persistent running toast, gxserver delete-warning toasts, project removal + parent-project focus. `commitWorktreeBeforeDelete` rides the same modal bridge into the existing commit-review path.
- 4.4 Git polling driver: ONE background driver (15s macOS-parity interval, per-project stagger) refreshes diff stats for all visible non-Quick local projects + all remote presentation projects, and refreshes the full `SidebarGitState` for the active LOCAL project each cycle → drives HUD, titlebar menu rows, and the badge. On-project-focus refresh already existed (`refreshGitStateForActiveProjectIfNeeded`). Dirty/ahead-behind surface = the titlebar git button badge dot (existing tips-unread pattern; check-in (b) resolved that way — see deferred for the macOS icon-swap/spinner delta).
- 4.5 Project diff stats: header +/- are real — tracked numstat vs HEAD, plus untracked `countFileLines` totals when `showUntrackedProjectDiffWhenNoTrackedChanges` is on and no tracked line changes exist (shared `resolveSidebarProjectDiffStats`), overlaid into `projectContext.editor.diffStats` pre-publish for local groups, remote groups, and the daemon-down remote-only projection.
- 4.6 Standalone gitFileDiff: resolved N/A-by-parity — the macOS titlebar git dropdown has NO changed-files list (Status + Actions only; its Changes row opens the commit modal, where per-file diff already works via `openSidebarGitChangedFileDiff`). The modal kind stays registered with no trigger, matching shipped macOS where the standalone trigger is equally dead.
- 4.7 verifies: (a) merge-back delete-after cleanup wired end-to-end (`confirmSidebarGitDirectMerge` → merge → `deleteWorktreeAfterCompletedGitAction`, local + remote, incl. parent focus + toasts); (b) `openExistingPullRequestInBrowser` → Rust `NativeProjectPathAction` subtype derives the PR URL from gxserver `prView` (never renderer URLs) and opens the browser; (c) local clone intact — missing `remoteMachineId` targets the local daemon (Batch 1.3).
- Deferred edges recorded in `deferred-out-of-scope.md` (menu presentation deltas, remote periodic full-state, attention-triggered stats refresh, badge-only indicator).

Previously working ✅ (now reachable): commit modal flow incl. multi-commit + blank-message generation, file-diff within commit, PR create/view + agent workflow, merge-to-main, worktree create/open backend, sync flows in runtime.

Original work items (all landed above):
- ~~❌ **Titlebar git menu** (M)~~ — Batch 4.1 (NativeMenu, not CEF popover — less new machinery).
- ~~❌ Toasts~~ — Batch 0.2.
- ~~❌ Worktree modals (S/M)~~ — kinds Batch 0.6; round-trip + delete handler Batch 4.2/4.3.
- ~~❌ **Local repository clone** (S/M)~~ — Batch 1.3 (re-verified in 4.7).
- ~~❌ Git-state refresh driver (M)~~ — Batch 4.4.
- ~~❌ Project diff stats (M)~~ — Batch 4.5.
- ~~❌ Standalone `gitFileDiff` modal registration (S)~~ — kind registered (Batch 0.6); trigger N/A by parity (Batch 4.6).
- ~~🔎 merge-back delete-after cleanup; `openExistingPullRequestInBrowser` bridge subtype~~ — code-verified in Batch 4.7; runtime confirmation in the user pass.

## 6. Settings — ✅ (Batch 5)

**STATUS: ✅ IMPLEMENTED 2026-07-02 (Batch 5; `cargo check` + vite bundle + repo `bun run typecheck` clean; runtime verification pending user side-by-side run).** Notes:

- 5.1 Patch persistence VERIFIED (Batch 0.1 handler confirmed, nothing rebuilt): both `updateSettingsPatch` arms merge onto the current stored snapshot exactly like macOS `saveSidebarSettingsPatch` (`{...settings, ...patch}`; `baseRevision` is ignored on BOTH platforms), honor the remoteMachines source gate with the exact shared-helper strings, write atomically with revision advance, and fan out (modal rehydrate carries the new revision + object so the modal never treats a save as lost; hotkeys rebind live via `cx.bind_keys`; Ghostty request maps + managed-config sync; gxserver agent policy; portless). Hotkey, theme/font/size/weight, remote machine-list, custom/hidden open-target, and projects-tab edits all ride this one path.
- 5.2 Open-target availability detection ported to Rust: verified the shared detection CANNOT run under the GPUI CEF sidebar (it lives in macOS-only `native-sidebar.tsx` and needs the `runNativeProcess` bridge). New startup scan (`start_gpui_workspace_open_target_availability_scan`, main.rs) builds the same zsh probe script as macOS (login-shell `command -v` per catalog command + app-bundle dir checks + mdfind fallback; the Rust catalog now carries `macos_app_names`), runs it with the 45s timeout, parses the same tab-separated output (first value wins per kind), and persists `workspaceOpenTargetAvailability` through the shared settings write + fan-out — comparison excludes `checkedAtMs` like macOS so unchanged machines never rewrite settings. Also verified the macOS manual re-scan host command has NO live sender in shipped macOS, so startup-only IS parity (deferred note).
- 5.3 sidebarSide live flip: the post-save fan-out now applies the saved side with the same flip work as the `moveSidebar` command (`apply_gpui_sidebar_side_from_saved_settings` — placement + divider-state cancel, no re-write). The Settings dropdown moves the sidebar immediately.
- 5.4 Ghostty live-apply VERIFIED + documented honestly (no fake reload): managed-config writes work and font-size reaches every new surface via the refreshed request maps, but theme/font-family/other config-backed keys load only at `GhosttyAppOwner` creation — and the two app owners are lazy-once per app run, so those edits reach terminals at relaunch (or a family's first-ever terminal). No `ghostty_app_update_config` FFI exists in the GPUI GhosttyKit wrapper; macOS live-reloads on a 3s debounce. Full contract in `deferred-out-of-scope.md`.
- 5.5 App Icon (**Decision #5 RESOLVED 2026-07-02: hide on GPUI**): the GPUI app-modal hydrate sets `hud.appIconPickerUnavailable: true`; the shared SettingsModal hides the App Icon section (same early-return pattern as the Power/keep-awake gate) and skips the `listAppIcons` request. macOS never sets the flag → unchanged.
- 5.6 Auto-sleep exclusions: the 🔎 verify FAILED (both were missing) → implemented. `createGpuiAutoSleepAgentSessionIds` now honors `autoSleepFavoriteAgentSessions` (presentation `isFavorite`) and `autoSleepRequireAgentResumeCommand` (excludes sessions with no daemon-published `agentSessionId`/`agentSessionPath`/`trustedResumeTitle`; gxserver sleep kills the zmx provider, so restorability is a real concern). The per-agent catalog-validation delta vs macOS `canRestoreNativeTerminalSession` is recorded in deferred. git-editor auto-sleep family recorded as out of scope (Decision #6 / Group 10).
- Runtime checks (item 7) pending the user's side-by-side run: settings edits persist across tabs; hotkey rebind applies live; Open In menu shows the machine's real IDEs after the startup scan; sidebarSide flips live; App Icon hidden on GPUI, visible on macOS; sounds preview + notification permission unchanged.

Previously working ✅: modal + all tabs render; full read/hydrate path (no key loss); bulk writes; integrations tab; remote tab actions; agents tab; managed Ghostty config actions (apply-recommended/reset/open); notifications permission; Keychain; sounds preview; App Shots settings.

Original work items (all landed/resolved above):
- ~~❌ **Batch 0.1** (`updateSettingsPatch`)~~ — landed Batch 0.1; end-to-end verified in Batch 5.1.
- ~~❌ Open-target availability detection (S/M)~~ — Batch 5.2 (Rust startup scan).
- ~~🧭 App Icon picker (S/M)~~ — Decision #5 resolved: hidden on GPUI (Batch 5.5).
- ~~🟡 Live-apply (S/M)~~ — sidebarSide live flip Batch 5.3; Ghostty reload documented as no-FFI/new-app-owner-only (Batch 5.4, deferred).
- ~~❌ git-editor auto-sleep family~~ — still tied to Decision #6 (Group 10); recorded in deferred.
- ~~🔎 New surfaces theme/font-family; auto-sleep exclusions~~ — verified 5.4 (config-at-app-owner-creation contract); exclusions implemented 5.6.

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
- ~~❌ Native CLI bridge server (M)~~ — ✅ landed in Batch 3.4 (`gpui/src/cli_bridge.rs`): 58743 + `bridge-token`, scoped to `openFloatingEditor` because the CLI's other commands are gxserver-owned post-cutover.
- ❌ CLI app activation targets "Ghostex" not "Ghostex GPUI" (S — parameterize/bundle-id).
- ❌ Runtime `ghostex://` handling (Group 0 item).

## 18. Support & polish — 🟡
- ❌ Logging + crash reporting (Group 0 item). ✅ App Shots. 🔎 vestigial `.ghostex-gpui` Info.plist home-dir keys (Rust uses `~/.ghostex`) — confirm nothing consumes them.

---

# Decisions I need from you (🧭)

1. ~~**Named session groups** (G1)~~ **RESOLVED 2026-07-02: port the full group model** (user chose this even after verification showed shipped macOS exposes no group-creation UI). Implemented in Batch 1.5.
2. ~~**Pop-out pane windows** (G2)~~ **RESOLVED 2026-07-02: out of scope for now** — tracked in `deferred-out-of-scope.md`; keep the affordance a clean no-op.
3. ~~**Restore eagerness** (G0/G1)~~ **RESOLVED 2026-07-02: auto-materialize previously-visible sessions on relaunch** (background/hidden ones stay lazy). Implemented in Batch 2.9 (focused-session-only first slice; multi-pane visible set tracked in `deferred-out-of-scope.md`).
4. ~~**zehn text-search launch** (G4/G8)~~ **RESOLVED 2026-07-02: keep macOS parity** — the Search row launches a `gx f` terminal (implemented in Batch 1.4); no `/api/searchSessions` UI path.
5. ~~**App Icon picker** (G6)~~ **RESOLVED 2026-07-02: hide the section on GPUI** (hud capability flag; macOS unchanged). Implemented in Batch 5.5; native icon swap tracked in `deferred-out-of-scope.md`.
6. **git-editor + automate surfaces** (G10): add both as distinct GPUI modes (with git-editor auto-sleep family), or fold permanently into Browser/skip?
7. **T3 runtime ownership** (G10): port the local T3 launcher into GPUI, or move runtime ownership into gxserver?
8. **Browser profile import** (G9): full named-profiles + cookie-import port (~L), or persistence-only for now?
9. **Desktop pet floating window** (G12): how much do you care, and when?
10. **Phone notifications** (G12): confirm this isn't an existing feature (none found outside iOS/).

---

# Suggested execution order (explicit next batches)

- **Batch 0 (foundations):** ✅ DONE 2026-07-02. updateSettingsPatch → toasts → Ghostty action dispatcher → native hotkey table → modal-kind sweep → daemon bootstrap.
- **Batch 1 (G1):** ✅ DONE 2026-07-02. add-local-project picker → dead card actions → clone messages → search-by-text launcher → named groups (full model).
- **Batch 2 (G2):** ✅ DONE 2026-07-02. OSC titles/bell/link-hover rendering → search-bar UI (Cmd+F) → chord sweep + tab-cycle aliases → fork/reload/delayed-send for Agents → press-any-key wake + titlebar batch sleep → startup auto-materialize (Decision #3) → pop-out stays no-op (Decision #2).
- **Batch 3 (G3+G4):** ✅ DONE 2026-07-02. first-prompt Enter-submit → palette focusSession/runSidebarCommand → CLI bridge server (58743; also closes the G17 bridge item) → floating prompt editor host → image paste/preview → routing receiving half.
- **Batch 4 (G5):** ✅ DONE 2026-07-02. titlebar git menu → worktree create round-trip fix + delete handler → git polling driver + diff stats → gitFileDiff resolved N/A-by-parity → merge-back/PR/local-clone verifies.
- **Batch 5 (G6):** ✅ DONE 2026-07-02. patch-persistence verify → open-target detection (Rust startup scan) → sidebarSide live flip → Ghostty live-apply contract documented → App Icon hidden (Decision #5) → auto-sleep favorite/require-resume exclusions.
- **Batch 6 (G7+G8):** completion sound + attention flash → progressive hook-status posting (or accept) → killTerminalDaemon parity → restore-row 🔎 verifies → T3 kill stubs stay blocked on Decision #7.
- Then G9–G14 in list order (each is now small), Phase B last — **except** consider pulling **G16 signing/updates** earlier if you want other machines/people on the GPUI build while the rest lands.

Verification protocol per batch: after each batch lands, run the app and walk the affected flows side-by-side with the macOS app before moving on (no automated tests in gpui/ per repo policy).
