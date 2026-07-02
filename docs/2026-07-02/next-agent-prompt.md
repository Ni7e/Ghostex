# Next agent prompt — Batch 6 (Groups 7+8: Agents + Session history & search)

Copy everything below the line into a fresh agent thread.

---

You are continuing the Ghostex → GPUI parity port. Set up context first, then implement Batch 6.

## Read these before doing anything

1. `docs/2026-07-02/gpui-parity-plan.md` — the verified roadmap. Batch 0 (foundations), Batch 1 (Group 1: session lifecycle & sidebar), Batch 2 (Group 2: terminal panes & tabs), Batch 3 (Groups 3+4: prompts & palette), Batch 4 (Group 5: git & worktrees), and Batch 5 (Group 6: Settings) are implemented and building; their status blocks list deliberately deferred follow-ups, so do not "fix" those unless your batch includes them.
2. `docs/2026-07-02/reports/g7-8-agents-history.md` — verified gap evidence for your groups. NOTE the report predates Batches 0–5, so several of its findings are STALE:
   - Its cross-cutting "GPUI never bundles or starts a local gxserver" finding is addressed — the async daemon bootstrap landed in Batch 0.5 (`start_gpui_local_gxserver_bootstrap` in main.rs; spawn + health polling + honest toasts). Known deferred edges are in `deferred-out-of-scope.md`. Do not rebuild it.
   - F5 (first-prompt title staged-Enter path) landed in Batch 3.1 — the GPUI runtime detects transitions via the shared `native/sidebar/first-prompt-title-submit` rules and presses a real Return through `postWorkspaceTerminalEnter`. Your job on F5 is VERIFY-only (the report's "staged-Enter still live in gxserver?" question), not re-implementation.
   - F6 (`searchPreviousSessionsByText`) was resolved by Decision #4 and landed in Batch 1.4 as the macOS-parity `gx f` launcher — the report's "deliberate NO-OP" note is stale.
   The other reports in `docs/2026-07-02/reports/` cover the remaining groups; consult them only when an item touches them.
3. `docs/2026-07-02/deferred-out-of-scope.md` — the running list of consciously deferred items. Append to it whenever you defer something; never silently drop scope.

## Context you must not rediscover

- The app being ported lives in `gpui/` (Rust GPUI shell + CEF-hosted React surfaces). The hybrid architecture is final — no UI rewrites; parity = behavior completeness.
- Both apps share the React sidebar/modal surfaces. GPUI mounts the same production modal host (`gpui/modal-host.html` → `native/sidebar/modal-host.tsx`), so the Agents Hub, Configure Agents, Previous Sessions, and Daemon Sessions modals all render and open already.
- Already working in your groups (do not rebuild): Agents Hub incl. the native Rust catalog scanner + file actions (`GpuiAgentsHubCatalogBuilder`, main.rs ~:49500-50072); Configure Agents + per-agent config + ordering + per-project policy reconcile; hook status/install/uninstall over `/api/readAgentHookStatus` (one batched call today); server-side completion detection → sidebar indicators; attention banners with rate limits + menu-bar status item + click-to-jump; previous-sessions browse/filter/restore/delete (restore = real `/api/createSession` with `restoredFromSessionId`); daemon-sessions viewer with working `refreshDaemonSessions` + per-session `killDaemonSession`; auto-refresh.
- Batch 5 landed (do not rebuild): patch-persistence chain verified end-to-end, Rust open-target availability startup scan, sidebarSide live flip in the post-save fan-out, the honest Ghostty "config loads at app-owner creation" contract, App Icon hidden on GPUI (`hud.appIconPickerUnavailable`), auto-sleep favorite/require-resume exclusions in `createGpuiAutoSleepAgentSessionIds`.
- Reusable patterns you will need:
  - Rust→runtime messages use the script-injection bridge pattern with pending queues (see `gpui_titlebar_git_action_script` / `gpui_command_palette_run_sidebar_command_script` in main.rs and the matching installs in `installGpuiBridgeCallbacks` in `gpui/sidebar/gxserver-runtime.ts`).
  - Runtime→Rust pushes are manifest-registered `post*` functions (`gpui/src/cef/sidebar_bridge_manifest.rs`; adding one touches the manifest, the `cef/macos.rs` kind+event enums, `cef/unsupported.rs`, and a `receive_*` arm in `receive_sidebar_bridge_event` in main.rs).
  - Modal-window→runtime commands go through `handle_gpui_app_modal_sidebar_command` (main.rs; unmatched commands are SILENTLY dropped by the trailing `_ => {}` — check your message actually has an arm); runtime→modal-window replies go `postAppModalHostMessage` → a `receive_app_modal_host_bridge_event` arm → `dispatch_open_gpui_app_modal_message`.
  - The GPUI sidebar runtime message switch is `handleSidebarMessage` in `gpui/sidebar/gxserver-runtime.ts`; unhandled messages silently no-op.
  - Use toasts (`dispatch_gpui_app_modal_toast` from Rust, `type:"toast"` from the runtime) for user feedback like macOS does.
- The GPUI runtime already posts `sessionStatusIndicators` on presentation changes (`gxserver-runtime.ts` ~:1998-2012, payload builder ~:8920) and Rust edge-detects attention for banners with 20s/60s/8 rate limits (main.rs ~:27482-548). The shared SidebarApp completion-sound listener is at `sidebar/sidebar-app.tsx:1381-1413` (`playCompletionSound` message → sound + card flash).
- IGNORE the stale trackers `gpui/SETTINGS_PARITY_PROGRESS.md`, `gpui/TITLEBAR_APP_MODAL_PARITY_PROGRESS.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`, and `docs/gpui-parity.md`.
- `gpui/src/main.rs` is ~2.7MB — rg for symbols then read targeted ranges; never read whole files. Same for `gpui/sidebar/gxserver-runtime.ts` (~470KB) and `native/sidebar/native-sidebar.tsx` (~47k lines).
- macOS references for your batch: completion sound + flash `playNativeSessionCompletionSound` in `native/sidebar/native-sidebar.tsx` (+ its source test); per-provider hook probing order `native/sidebar/agent-hook-status-source.test.ts:22-60`; daemon-sessions modal message set `sidebar/daemon-sessions-modal.tsx` (~:160, 503, 542, 553, 390).

## Hard rules

- No CDXC comments. No logging code (logs come later). No tests in `gpui/` and none in the macOS app (repo policy — AGENTS.md; `shared/` and `gxserver-rs` tests are allowed).
- Never run `bun run start` or anything that restarts a running app unless the user asks.
- Verify with `cargo check` in `gpui/`; sidebar bundles build with `bunx vite build --config gpui/vite.config.ts` from the repo ROOT; if you touch `shared/`, `sidebar/`, or `native/sidebar/`, also run `bun run typecheck` (repo root). Note `gpui/sidebar` is type-checked by neither (vite only bundles); a targeted tsc there surfaces 10 pre-existing branded-type errors in untouched code — do not add new ones.
- Work one compile-clean commit-sized chunk at a time; after each item, ask the user to run the app and verify side-by-side with the macOS app before moving on.
- Follow AGENTS.md search routing (exclude `ghostty/**`, vendor trees, `node_modules/**`, `target/**`, builds).
- Never add fallbacks where correct behavior is possible; no hitTest/overlay hacks. Native OS-owned menus and native child windows ARE the accepted patterns for overlay surfaces.

## Decisions already made (do not re-ask)

- Pop-out pane windows (Decision #2): OUT OF SCOPE.
- Restore eagerness (Decision #3): resolved and landed (Batch 2.9).
- zehn text-search launch (Decision #4): resolved — `gx f` launcher, landed Batch 1.4.
- App Icon picker (Decision #5): resolved — hidden on GPUI (Batch 5.5).
- T3 runtime ownership (Decision #7): still OPEN — it BLOCKS the T3 kill stubs in your batch; keep them honest stubs and do not fake kills.

## Your job: Batch 6 — Groups 7+8 (Agents + Session history & search)

Work these in order, one compile-clean commit-sized chunk each. File anchors are from the 2026-07-02 reports (line numbers drift — rg for symbols).

1. **Completion sound + attention flash on idle→attention transitions (S — plan §7 first item; the same fix closes the §12 "agent-turn completion sound" item).** The shared SidebarApp already listens for `playCompletionSound` (`sidebar/sidebar-app.tsx:1381-1413`) and plays the sound + flashes the card; nothing in the GPUI runtime ever emits it (report F4; the Rust banner is deliberately sound-nil at main.rs ~:27520 — only action/command completion plays today, ~:20902). Emit `playCompletionSound` (sessionId + configured sound) from `gxserver-runtime.ts` where presentation snapshots/deltas transition a session into `attention`; respect the `completionSound`/`completionBellEnabled` settings; dedupe by `attentionEventId` so re-publishes don't re-fire; confirm acknowledgement-on-focus (`gxserver-runtime.ts` ~:10580-609) doesn't re-trigger. macOS reference: `playNativeSessionCompletionSound` (native-sidebar.tsx).
2. **Progressive per-provider hook-status posting (S/M — report F3, plan §7 🟡; or accept the batch).** GPUI does ONE batched `/api/readAgentHookStatus` call with a 45s timeout (main.rs ~:56363-80); macOS probes per-provider in priority order and posts partial results as they arrive (`agent-hook-status-source.test.ts:22-60`), so its Settings/Tips hook warnings populate progressively. Ask the user whether to port progressive posting or accept the batch (decision below); implement or record accordingly.
3. **`killTerminalDaemon` daemon-stop parity (S/M — report F8 gap 1, plan §8).** The Daemon Sessions modal posts `killTerminalDaemon` (`daemon-sessions-modal.tsx` ~:542); GPUI's arm is an honest stub toast ("GPUI cannot stop the shared Ghostex daemon… yet", main.rs ~:26299-304). Verify what macOS actually does (find its killTerminalDaemon handler in the macOS host), then port the stop path. IMPORTANT: Batch 0.5 deliberately never stops the daemon on quit, and during side-by-side testing the daemon is SHARED with the macOS app — confirm the stop semantics with the user before wiring a control that kills a daemon the other app is using (decision below). Related deferred item: Batch 0.5's "stop-control-plane API not ported".
4. **T3 kill stubs (report F8 gaps 2-3) stay blocked on Decision #7.** Keep `killT3RuntimeServer`/`killT3RuntimeSession` as honest stubs; verify the modal's T3 rows don't render dead-but-clickable kill controls when GPUI has no T3 runtime inventory. Record in `deferred-out-of-scope.md` if not already there.
5. **🔎 verifies (S — code-level now, runtime in the user pass).**
   - Restore rows: `gpui_gxserver_search_result_to_previous_session_item` (main.rs ~:56983-57017) always populates the canonical `gxserver:<projectId>:<sessionId>` row id (rows lacking it silently no-op on restore), and a restored session actually mounts a visible workspace surface.
   - F5 staleness check: confirm current gxserver uses the `renameCommand` renderer-command path for first-prompt titles and that Batch 3.1's staged-Enter path covers whichever agents still stage (report F5 uncertainty). Verify only — both paths exist in GPUI now.
   - Monaco loads inside Agents Hub under CEF (report F1; otherwise the shared textarea fallback renders — if the fallback shows, diagnose rather than accept, since GPUI CEF loads other Monaco surfaces).
6. **Agents Hub scanner drift protection (plan §7 🔎; decision below).** The Rust catalog scanner (`GpuiAgentsHubCatalogBuilder`, main.rs ~:49500-50072, roots hardcoded ~:49681-50069) mirrors gxserver's `agents.rs`. The plan wants a shared fixture test so the two don't drift — but repo policy forbids tests in `gpui/`. Agree placement with the user (e.g., a fixture under `shared/` exercised from the gxserver-rs test suite, or defer with a tracker entry); do exactly what's agreed — no test code inside `gpui/`.
7. **Runtime checks (with the user).** An attention transition plays the configured sound + flashes the card once (and not again on refocus/acknowledge); hook-status behavior per decision; previous-sessions restore mounts a surface; daemon-stop per decision; T3 rows honest. Side-by-side with the macOS app.

## Decisions needed from the user

- Item 2: progressive per-provider hook-status posting vs accepting the single 45s batch.
- Item 3: killTerminalDaemon semantics while the daemon is shared with the macOS app — confirm before wiring.
- Item 6: where the scanner drift fixture test may live given the no-tests-in-gpui policy (or defer it).
- Decision #7 (T3 runtime ownership) remains open — only unblock item 4 if the user resolves it now.

## When you finish Batch 6

1. Update `docs/2026-07-02/gpui-parity-plan.md`: add a Batch 6 status block under Groups 7 and 8 with items done (one-line notes on anything deferred), same style as the Batch 0–5 status blocks, and update the "Suggested execution order" line. Append deferred items to `docs/2026-07-02/deferred-out-of-scope.md`.
2. Write `docs/2026-07-02/next-agent-prompt.md` (overwrite it) with the exact prompt for the NEXT agent thread to implement Batch 7 — Groups 9+10 (Browser panes + Editor & docs panes): browser profile persistence (per-profile `cache_path`, `cef/macos.rs` ~:2298-2346), `openBrowser`/`openBrowserPane` renderer commands (`gxserver-runtime.ts` ~:1456-1517), the CEF clipboard permission for the code-server trusted origin (macOS `GhostexCEFBridge.mm:1029-1091`), honoring `GHOSTEX_CEF_REMOTE_DEBUGGING_PORT`, code-server idle-stop, t3BrowserAccess/t3ThreadId modal wiring, and meo/docs bridge completion (`gitBaseline`, rename/duplicate/delete/createFolder/move); Decisions #6 (git-editor + automate surfaces), #7 (T3 runtime), and #8 (browser profile import) gate the larger items — carry them as open decisions. Anchor it on plan §9/§10 and `docs/2026-07-02/reports/g9-10-browser-editors.md`. That prompt must have this same structure: read-first list, context (including what must not be rebuilt), hard rules, ordered work items with file anchors from `docs/2026-07-02/reports/`, decisions needed, and — verbatim requirement — an instruction that the Batch 7 agent must in turn write the Batch 8 prompt the same way.
3. End your final message by pasting the full Batch 7 prompt inline so the user can copy it.
