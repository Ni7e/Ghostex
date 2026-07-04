# Batch 12 prompt (git-editor mode + automate mode + T3 follow-ups + final deferred sweep)

This file IS the full prompt: an agent pointed at it should follow everything below as its instructions.

Decisions are ALREADY MADE (user, 2026-07-04) — do not re-ask:
- **Decision #6 RESOLVED: build BOTH** the git-editor mode and the automate mode as distinct GPUI surfaces.
- **macOS T3 migration: in scope** — move the macOS app onto the daemon's T3 API.
- Runtime verification is handled MANUALLY by the user — no verification work items; just tell the user what to test after each item lands.

## Read first

1. `docs/2026-07-02/gpui-parity-plan.md` — the roadmap. Batches 0–11 are implemented and building; their status blocks list deliberate deferrals — do not "fix" those unless listed below.
2. `docs/2026-07-02/deferred-out-of-scope.md` — the deferred tracker. Append whenever you defer something; never silently drop scope.
3. Old reports under `docs/2026-07-02/reports/` are stale — macOS behavioral reference only. Every `main.rs` line anchor has drifted (~3MB file) — always `rg` named symbols.

## Context you must not rediscover

- The app lives in `gpui/` (Rust GPUI shell + CEF-hosted React surfaces). Hybrid architecture is final; parity = behavior completeness. GPUI reuses the shared React sidebar + modal host via CEF; the GPUI titlebar is native Rust.
- Batch 11 landed the whole T3 daemon authority: `gxserver-rs/src/t3_runtime.rs` + `/api/t3Runtime/{status,start,stop,panes}` + health `t3Runtime` block; GPUI consumes it (rg `gpui_ensure_local_t3_runtime_started`, `gpui_report_t3_runtime_panes_to_gxserver`, `gpui_t3_server_info_from_gxserver_health`). The on-disk contract (`~/.ghostex/t3-runtime/…`, port 3774) is byte-compatible with the macOS in-app launcher.
- Automations backend is ALREADY live from Batch 8.1 (`run_gpui_project_board_automation_request` in main.rs; all `automation*` board actions work). The ONLY gap is entry: `openAutomationsPage` answers with an honest stub toast in `gpui/sidebar/gxserver-runtime.ts`, and no surface opens `tasks-placeholder.html?surface=automations`.
- Titlebar mode machinery: rg `TitlebarMode`, `titlebar_mode_switcher_items`, `titlebar_mode_available` in main.rs. Auto-sleep per mode: `project_editor_auto_sleep_duration` (main.rs) + `SharedSettingsAutoSleepTarget` (gpui/src/shared_settings.rs) — the `autoSleepGitEditor*` keys already exist in shared settings (macOS enforces them at `native-sidebar.tsx` ~:43004).
- macOS git-editor reference: the `git` project-editor mode in `native/sidebar/titlebar-host.tsx` (modes `agents|code|git|automate|tasks|manage`) and its GitHub-remote-seeded browser surface in the Swift host — rg `gitEditor` / the `git` mode handling in `AppDelegate.swift` + `TerminalWorkspaceView.swift` before designing.
- Reusable patterns (freshest examples): Rust→runtime script bridges with pending queues (`gpui_os_integration_command_script`); runtime→Rust manifest `post*` fns (`gpui/src/cef/sidebar_bridge_manifest.rs`, `postProjectBoardConversationResponse` model); Rust→open-modal dispatch (`dispatch_open_gpui_app_modal_message`); app-modal commands land in `handle_gpui_app_modal_sidebar_command` (unmatched commands silently drop); state files under `ghostex_home_root().join("state/gpui-*.json")`; daemon endpoint families follow the `/api/t3Runtime/*` example (protocol.rs `endpoint_for` + server.rs `route_http`, with tests).
- A parallel workstream owns GPUI-composited terminals: do NOT touch `gpui/src/terminal_ghostty_surface.rs`, `terminal_model.rs`, `ghostty_vt.rs`, `terminal_element.rs`, `gpui/src/cef/*`, `gpui/scripts/build-libghostty-vt.sh`.
- IGNORE the stale trackers `gpui/SETTINGS_PARITY_PROGRESS.md`, `gpui/TITLEBAR_APP_MODAL_PARITY_PROGRESS.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`, `docs/gpui-parity.md`.
- `gpui/src/main.rs` (~3MB), `gpui/sidebar/gxserver-runtime.ts` (~560KB), `native/sidebar/native-sidebar.tsx` (~47k lines): rg symbols, read targeted ranges, never whole files.

## Hard rules

- No CDXC comments. No tests in `gpui/` or the macOS app; `shared/` and `gxserver-rs` tests are allowed and expected.
- Never run `bun run start` or anything that restarts a running app.
- Verify per touched area: `cargo check` in `gpui/`; `cargo test` in `gxserver-rs/`; `bunx vite build --config gpui/vite.config.ts` from the repo ROOT when sidebar bundles change; `bun run typecheck` + touched shared tests when `shared/`, `sidebar/`, or `native/sidebar/` change; build the macOS app the normal way if you touch it (`bash native/macos/ghostexHost/build-ghostex-host.sh` — check the script's dev usage first).
- Work one compile-clean commit-sized chunk per item; after each, tell the user in one short list what to manually test.
- AGENTS.md search routing (exclude `ghostty/**`, vendor trees, `node_modules/**`, `target/**`, builds). No fallbacks where correct behavior is possible; no hitTest/overlay hacks; native menus/child windows are the accepted overlay patterns.

## Work items, in order

1. **Automate mode (M).** Wire the entry points to the already-live backend: a Kanban-slot URL variant carrying `surface=automations` (+ `scope=all` for the overview) and the macOS `showBetaFeatures` seed param (rg `setAutomationsExperimentalGateParam` in native/sidebar for the contract); add the titlebar `automate` mode (gated like macOS on `showBetaFeatures`), the sidebar Automations row, and the palette entry; replace the `openAutomationsPage` stub toast in `gxserver-runtime.ts` with the real open. macOS reference: `openAutomationsPage` in `native-sidebar.tsx`.
2. **Git-editor mode (M/L).** Distinct GPUI mode mirroring macOS: GitHub-remote-seeded browser surface (derive the URL from the active project's git remote the way macOS does — rg the git-editor URL construction in the Swift host / titlebar-host.tsx), its own surface lifecycle, and the `autoSleepGitEditor*` family wired into `SharedSettingsAutoSleepTarget` + `project_editor_auto_sleep_duration` (closes deferred [5.6]). Reuse the existing Browser CEF surface machinery — do not build a new webview stack.
3. **T3 follow-ups.** (a) Focus cold-start (S): `receive_sidebar_t3_session_focus_payload` runs the same `gpui_ensure_local_t3_runtime_started` + 30×500ms bearer poll as create/browser-access (closes deferred [11.1] focus note). (b) macOS migration (M/L): replace `NativeT3RuntimeLauncher` usage in the macOS app with `/api/t3Runtime/*` calls (start/stop/panes/status through `GxserverClient`), keeping the pane-heartbeat semantics by posting the live pane set; delete-or-bypass decisions stay conservative — the launcher code can remain but must no longer be the authority (closes deferred [11.1] macOS note). No tests in the macOS app.
4. **Final deferred sweep (S/M).** Walk `docs/2026-07-02/deferred-out-of-scope.md` end to end; close entries whose blockers have landed. Known candidates: [2.9] multi-pane auto-materialize; [3.5] prompt-editor prewarm; [10.3] `gpui.sidebar.focus` writers only if you touch those flows. Close only what genuinely fits.

## When you finish Batch 12

1. Update `docs/2026-07-02/gpui-parity-plan.md`: Batch 12 status blocks under the touched groups (same style as Batches 0–11), mark Decision #6 resolved (2026-07-04: build both), update the "Suggested execution order" line. Append deferrals to `docs/2026-07-02/deferred-out-of-scope.md`.
2. Give the user ONE consolidated manual-test checklist covering everything Batch 12 landed (plus the still-unverified Batch 10/11 runtime items listed in the plan's status blocks).
3. Write the exact prompt for the NEXT agent thread to implement Batch 13 into a NEW file, `docs/2026-07-02/batch-13-prompt.md` (also overwrite `docs/2026-07-02/next-agent-prompt.md` with a one-line pointer to it). Scope it from what actually remains. Same structure as this file: header stating the file IS the full prompt, read-first list, context (including what must not be rebuilt), hard rules, ordered work items with file anchors, decisions needed, and — verbatim requirement — an instruction that the Batch 13 agent must in turn write `docs/2026-07-02/batch-14-prompt.md` the same way and hand the user a short send-prompt for it.
4. End your final message with ONLY a very short send-prompt for the user to copy, for example: `Read docs/2026-07-02/batch-13-prompt.md and follow it exactly — it is your full prompt for Batch 13 of the GPUI parity port.` Do NOT paste the full Batch 13 prompt inline.
