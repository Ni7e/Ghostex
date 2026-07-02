# Next agent prompt — Batch 7 (Groups 9+10: Browser panes + Editor & docs panes)

Copy everything below the line into a fresh agent thread.

---

You are continuing the Ghostex → GPUI parity port. Set up context first, then implement Batch 7.

## Read these before doing anything

1. `docs/2026-07-02/gpui-parity-plan.md` — the verified roadmap. Batch 0 (foundations), Batch 1 (Group 1), Batch 2 (Group 2), Batch 3 (Groups 3+4), Batch 4 (Group 5), Batch 5 (Group 6), and Batch 6 (Groups 7+8) are implemented and building; their status blocks list deliberately deferred follow-ups, so do not "fix" those unless your batch includes them.
2. `docs/2026-07-02/reports/g9-10-browser-editors.md` — verified gap evidence for your groups. NOTE the report predates Batches 0–6; known-stale points:
   - Its T3 kill-stub notes (10.8) are partially addressed: Batch 6.4 verified the Running Sessions modal renders NO dead-but-clickable T3 controls (Kill Server disabled without `t3Server`; no `t3Sessions` rows). The runtime-authority gap itself is real and is now an explicit FUTURE batch in the plan's execution order (Decision #7, user: "come back to it later") — do not resolve it inside Batch 7 unless the user opts in; only wire what needs no runtime authority (the t3BrowserAccess/t3ThreadId modals).
   - Monaco assets are now staged into `gpui/dist/sidebar/monaco/vs` by the vite build (Batch 6.5c) — if you touch modal-host surfaces, do not re-add staging.
   - Toasts, `updateSettingsPatch`, the daemon bootstrap, and the hotkey table all exist (Batch 0); the CLI bridge server exists (Batch 3.4).
3. `docs/2026-07-02/deferred-out-of-scope.md` — the running list of consciously deferred items. Append to it whenever you defer something; never silently drop scope.

## Context you must not rediscover

- The app being ported lives in `gpui/` (Rust GPUI shell + CEF-hosted React surfaces). The hybrid architecture is final — no UI rewrites; parity = behavior completeness.
- Already working in your groups (do not rebuild): browser tabs/splits/toolbar/address normalization (incl. Google fallback), per-tab history + OS NativeMenu back/forward dropdowns, favicons, DevTools (`host.show_dev_tools`), popup→shell-tab routing, Agentation + React Grab injection (pinned versions, github gate), CDP port exposure (default 9334); code-server runtime end-to-end (launch/health/theme-seed/settings-restart, `SourceCodeServerRuntimeOwner` main.rs ~:2642); T3 session create/focus + draft/thread URL routing through browser CEF (`gpui_create_local_t3_session` main.rs ~:53028); meo/Manage surface mounts and its bridge handles list/read/save.
- Batch 6 landed (do not rebuild): completion sound + flash on attention (runtime edge detection + `postSessionCompletionSound` native-audio bridge), progressive per-provider hook status, killTerminalDaemon = bulk-sleep parity (`sleepAllDaemonSessions` action), previous-session restore focus follow-up, Monaco asset staging in `gpui/vite.config.ts`, scanner drift test `shared/gpui-agents-hub-scanner-parity.test.ts`.
- Reusable patterns you will need:
  - Rust→runtime messages use the script-injection bridge pattern with pending queues (see `gpui_command_palette_session_focus_script` / `gpui_workspace_terminal_runtime_action_script` in main.rs and the matching installs in `installGpuiBridgeCallbacks` in `gpui/sidebar/gxserver-runtime.ts`).
  - Runtime→Rust pushes are manifest-registered `post*` functions (`gpui/src/cef/sidebar_bridge_manifest.rs`; adding one touches the manifest const + array size, the `cef/macos.rs` kind+event enums and `with_payload`, `cef/unsupported.rs`, and a `receive_*` arm in `receive_sidebar_bridge_event` in main.rs — Batch 6.1's `SessionCompletionSound` is the freshest complete example).
  - Modal-window→runtime commands go through `handle_gpui_app_modal_sidebar_command` (main.rs; unmatched commands are SILENTLY dropped by the trailing `_ => {}` — check your message actually has an arm); runtime→modal-window replies go `postAppModalHostMessage` → a `receive_app_modal_host_bridge_event` arm → `dispatch_open_gpui_app_modal_message`.
  - The GPUI sidebar runtime message switch is `handleSidebarMessage` in `gpui/sidebar/gxserver-runtime.ts`; unhandled messages silently no-op. The gxserver renderer-command switch is `handleGxserverRendererCommand` (~:1456-1517 in the report's coordinates) — it THROWS "Unsupported renderer command" for unknown commands.
  - Use toasts (`dispatch_gpui_app_modal_toast` from Rust, `type:"toast"` from the runtime) for user feedback like macOS does.
- IGNORE the stale trackers `gpui/SETTINGS_PARITY_PROGRESS.md`, `gpui/TITLEBAR_APP_MODAL_PARITY_PROGRESS.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`, and `docs/gpui-parity.md`.
- `gpui/src/main.rs` is ~2.7MB — rg for symbols then read targeted ranges; never read whole files. Same for `gpui/sidebar/gxserver-runtime.ts` (~500KB) and `native/sidebar/native-sidebar.tsx` (~47k lines).
- macOS references for your batch: per-profile CEF storage `GhostexCEFBridge.mm:797-835` + profiles store `NativeBrowserProfiles.swift`; permission prompt handler `GhostexCEFBridge.mm:1029-1091, 2273-2289`; browser-open renderer commands `native-sidebar.tsx:34613, 46073-46085, 50771` + CLI `ghostex-cli.mjs:173-174, 1652-1663`; code-server idle-stop `native-sidebar.tsx:43143-43154`; T3 modal triggers `AppDelegate.swift:16197-16198, 17763-17766`; Manage files bridge `TerminalWorkspaceView.swift:11382-11478` + gitBaseline `TWV:411-428, 11831` + scoping `TWV:11570-11591, 11925-11986`.

## Hard rules

- No CDXC comments. No logging code (logs come later). No tests in `gpui/` and none in the macOS app (repo policy — AGENTS.md; `shared/` and `gxserver-rs` tests are allowed).
- Never run `bun run start` or anything that restarts a running app unless the user asks.
- Verify with `cargo check` in `gpui/`; sidebar bundles build with `bunx vite build --config gpui/vite.config.ts` from the repo ROOT; if you touch `shared/`, `sidebar/`, or `native/sidebar/`, also run `bun run typecheck` (repo root). Note `gpui/sidebar` is type-checked by neither (vite only bundles); a targeted tsc there surfaces 10 pre-existing branded-type errors in untouched code — do not add new ones.
- Work one compile-clean commit-sized chunk at a time; after each item, ask the user to run the app and verify side-by-side with the macOS app before moving on.
- Follow AGENTS.md search routing (exclude `ghostty/**`, vendor trees, `node_modules/**`, `target/**`, builds).
- Never add fallbacks where correct behavior is possible; no hitTest/overlay hacks. Native OS-owned menus and native child windows ARE the accepted patterns for overlay surfaces.

## Decisions already made (do not re-ask)

- Pop-out pane windows (Decision #2): OUT OF SCOPE.
- Restore eagerness (#3), zehn text search (#4), App Icon picker (#5): resolved and landed.
- T3 runtime ownership (Decision #7): still OPEN by user choice, promoted to an explicit FUTURE batch (plan execution order). In Batch 7 wire only the T3 modals (no runtime authority needed); leave kill stubs and inventory as verified-honest stubs.

## Your job: Batch 7 — Groups 9+10 (Browser panes + Editor & docs panes)

Work these in order, one compile-clean commit-sized chunk each. File anchors are from the 2026-07-02 report (line numbers drift — rg for symbols).

1. **Browser profile persistence** (S code, high value — report 9.2 gap 1, plan §9). Per-profile CEF `cache_path` is deliberately empty (`cef/macos.rs:2298-2346`, CDXC at 2298): cookies/logins die with the app. Set persistent per-profile on-disk paths in `cef_request_context_for_profile` like macOS `GhostexCEFRequestContextForProfile` (GhostexCEFBridge.mm:797-835). Pick a GPUI-owned storage root (e.g. under `~/.ghostex`) and keep profile ids bounded. NOTE Decision #8 gates the LARGER named-profiles + Import Browser Data port (~940 lines Swift incl. Keychain Safe-Storage decrypt) — ask the user (decision below) whether Batch 7 is persistence-only or includes names/import.
2. **`openBrowser`/`openBrowserPane` renderer commands** (S/M — report 9.5, plan §9). `ghostex browser open` (and browser-use skill step 1) throws "Unsupported renderer command" (`gxserver-runtime.ts` `handleGxserverRendererCommand` ~:1456-1517). Add both commands incl. reuse semantics (`--reuse` exact / `--new` / `--project-*`); macOS executes at `native-sidebar.tsx:34613, 46073-46085, 50771`. Route pane creation through the existing Rust browser tab/pane paths (runtime→Rust bridge), never renderer-provided URLs straight into CEF without the existing address normalization.
3. **CEF permission handler** (S — report 9.6, plan §9). GPUI has no `OnShowPermissionPrompt` equivalent → code-server clipboard prompts can misbehave. Port macOS's rule: grant clipboard for the code-server trusted origin, deny others (`GhostexCEFBridge.mm:1029-1091, 2273-2289`, helper 1151). Lands in `gpui/src/cef/macos.rs`.
4. **CDP env-var name** (S — report 9.5). GPUI reads `GHOSTEX_GPUI_CEF_REMOTE_DEBUGGING_PORT` (cef/macos.rs ~:466, 2349-55); macOS/tooling use `GHOSTEX_CEF_REMOTE_DEBUGGING_PORT`. Honor the macOS name (keep the GPUI-specific one working if trivially cheap; do not break the 9333-9343 scan-range contract — GPUI default 9334 is inside it).
5. **code-server idle-stop** (S — report 10.7, plan §10). macOS stops code-server when EVERY editor surface sleeps (`native-sidebar.tsx:43143-43154`, called from all sleep paths); GPUI only hides the CEF view (main.rs ~:2067, 20465) and stops only on drop/relaunch/settings-restart (~:19507/19847/19950). Stop the process when all Source surfaces sleep; make sure the existing ensure/start path cleanly restarts it on next wake.
6. **t3BrowserAccess + t3ThreadId modal wiring** (S/M — report 10.8, plan §10; NOT gated on Decision #7). Both modals ship in the shared modal-host (modal-host.tsx :29-30, 97-98, 3176-3193) but GPUI never triggers them; macOS triggers at `AppDelegate.swift:16197-16198, 17763-17766`. Wire open triggers via the app-modal-host bridge + the submit callbacks. Check the submitted values flow to the same consumers as macOS (T3 session metadata / browser access grant), and remember unmatched modal commands are silently dropped — add the arms.
7. **meo/docs bridge completion** (M — report 10.9, plan §10). The GPUI `ghostexManageFiles` bridge supports only list/read/save (`gpui/sidebar/project-workarea-cef-bridge.ts:62-64` → main.rs ~:62408-62466); macOS's `ManageFilesBridge` also does rename/duplicate/delete/createFolder/move (`TWV:11382-11478`). Work: (a) add `gitBaseline` to read/save responses (bounded HEAD read ≤1MB, sanitized — macOS `TWV:411-428, 11831`) so meo's git gutter (`meo/editor.ts:20-26, 1434-1435`, gitDiffCore.ts) comes alive; (b) implement the five missing file ops (today "Unsupported Manage file action.", main.rs ~:62464); (c) 🔎 verify Docs-folder scoping allowlist + `.excalidraw` acceptance against macOS (`TWV:11570-11591, 11925-11986`).
8. 🔎 **verifies** (S — code-level now, runtime in the user pass): tab-hover close/favicon behavior (report 9.1 "UNSURE" — spot-check visually); Agentation injected-script version drift (diff GPUI script main.rs ~:48212-48360 vs macOS NativeBrowserReactGrab.swift:108-284); the `companion` surface concept (ShellFocusTarget, main.rs ~:6486) — confirm whether anything is reachable or record it.
9. **Decision #6 items if resolved** (L — git-editor + automate surfaces, report 10.10). ONLY if the user resolves Decision #6 now. git-editor = Browser-backed surface seeded with the project GitHub remote (`openProjectGitEditorSurface` native-sidebar.tsx:43730, paneKind `projectEditorGit` TWV:5453, restore TWV:12009-12018) + the `autoSleepGitEditor*` family (deferred item [5.6] has the Rust re-entry pointers); automate = ProjectEditorSurfaceMode "automate" pane over the shared daemon engine. If not resolved, carry as open and skip.
10. **Runtime checks (with the user).** Browser logins survive relaunch; `ghostex browser open` opens/reuses panes; code-server clipboard works without a prompt; code-server process exits when all Source surfaces sleep and returns on wake; T3 modals open and submit; meo git gutter renders and file ops work in Manage. Side-by-side with the macOS app.

## Decisions needed from the user

- Item 1: browser profiles — persistence-only now, or the full named-profiles + Import Browser Data port (Decision #8)?
- Item 9 / Decision #6: add git-editor + automate as distinct GPUI modes, fold permanently into Browser, or defer again?
- Decision #7 (T3 runtime ownership) stays a planned future batch — only touch it if the user resolves it now; item 6 does not depend on it.

## When you finish Batch 7

1. Update `docs/2026-07-02/gpui-parity-plan.md`: add a Batch 7 status block under Groups 9 and 10 with items done (one-line notes on anything deferred), same style as the Batch 0–6 status blocks, and update the "Suggested execution order" line. Append deferred items to `docs/2026-07-02/deferred-out-of-scope.md`.
2. Write `docs/2026-07-02/next-agent-prompt.md` (overwrite it) with the exact prompt for the NEXT agent thread to implement Batch 8 — Groups 11+12 (Kanban board & automations + Notifications, sounds & ambient): automations client wiring (engine + endpoints exist in `gxserver-rs/src/automations/`; the GPUI board bridge handles zero `automation*` actions → whole surface dead), bead↔conversation links + startWork (main.rs ~:62824 handles only `getState` with an empty context), `generateTitle` beads action (explicitly rejected today), drag-between-lanes end-to-end verify, terminal BEL→attention pipeline verify (Batch 2.2 landed the plumbing; Batch 6.1 landed the sound on the resulting attention edge), and the desktop-pet floating window (Decision #9) + phone-notifications confirm (Decision #10). Anchor it on plan §11/§12 and the matching `docs/2026-07-02/reports/` files. That prompt must have this same structure: read-first list, context (including what must not be rebuilt), hard rules, ordered work items with file anchors from `docs/2026-07-02/reports/`, decisions needed, and — verbatim requirement — an instruction that the Batch 8 agent must in turn write the Batch 9 prompt the same way.
3. End your final message by pasting the full Batch 8 prompt inline so the user can copy it.
