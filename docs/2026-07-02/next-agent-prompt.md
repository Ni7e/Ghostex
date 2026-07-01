# Prompt for the next agent thread (Batch 1)

Copy everything below the line into a fresh thread.

---

You are continuing the Ghostex → GPUI parity port. Set up context first, then implement Batch 1.

## Read these before doing anything

1. `docs/2026-07-02/gpui-parity-plan.md` — the verified roadmap. Batch 0 (foundations) is already implemented and building; its section lists deliberately deferred follow-ups so do not "fix" those unless your batch includes them.
2. `docs/2026-07-02/reports/g1-sessions-sidebar.md` — verified gap evidence with file:line refs for your batch. The other reports in `docs/2026-07-02/reports/` cover the remaining groups; consult them only when an item touches their area.

## Context you must not rediscover

- The app being ported lives in `gpui/` (Rust GPUI shell + CEF-hosted shared React surfaces + libghostty terminals). The hybrid architecture is final — no UI rewrites; parity = behavior completeness.
- Both apps share the same gxserver daemon; server-side behavior is free. Gaps live in: the GPUI sidebar runtime message switch (`gpui/sidebar/gxserver-runtime.ts:~2156` — unhandled messages silently no-op), the app-modal command handler (`gpui/src/main.rs` `handle_gpui_app_modal_sidebar_command`), the CEF bridge manifest (`gpui/src/cef/sidebar_bridge_manifest.rs`), and missing native services.
- IGNORE the stale trackers: `gpui/*PARITY_PROGRESS*.md` and `docs/gpui-*parity*.md`.
- `gpui/src/main.rs` is ~68k lines: always `rg` for symbols then read targeted ranges; never read whole files.

## Hard rules

- No CDXC comments. No logging code (logs come later). No tests in `gpui/` or the macOS app (repo policy).
- Never run `bun run start` or anything that restarts a running app unless the user asks.
- Verify with `cargo check` / `cargo build` in `gpui/`; ask the user to do visual verification runs.
- Follow AGENTS.md search routing (exclude `ghostty/**`, vendor trees, `node_modules`, `target/`, builds).
- Never add fallbacks where fixing the actual behavior is possible; no hitTest/overlay hacks (native child windows are the accepted overlay pattern).

## Your job: Batch 1 — Group 1 (Core session lifecycle & sidebar)

Work these in order, one compile-clean commit-sized chunk each. File anchors are in the g1 report.

1. **Add local project**: implement `pickWorkspaceFolder` — native folder picker (NSOpenPanel via ObjC shim in `gpui/native/macos/`, mirroring existing shim patterns) → call gxserver `/api/addProjectPath` for the LOCAL daemon (the existing Rust handler `main.rs` `/api/addProjectPath` path is remote-only; add the local route).
2. **Dead card/context actions** in the runtime switch (`gxserver-runtime.ts`): `copySessionDetails`, `fullReloadSession` (→ gxserver reload), `toggleCloseAfterDone`, `closeInactiveProjectSessions`, `sleepInactiveProjectSessions`, `wakeProjectSleepingSessions`.
3. **Clone-flow messages**: wire `cloneRepository`/`previewRepositoryClone`/`cancelRepositoryClone` for the LOCAL machine (today Rust requires `remoteMachineId` and errors otherwise — treat missing id as local), plus `browseRemoteProjectDirectories`/`addRemoteProjectPath` passthroughs.
4. **`searchPreviousSessionsByText`** → gxserver `/api/searchSessions`.
5. **Named session groups** — BLOCKED on user decision #1 (adopt macOS's client-side `shared/simple-grouped-session-workspace-state.ts` model vs drop sub-project groups). ASK THE USER before building. If adopting: wire `createGroup`/`createGroupFromSession`/`renameGroup`/`closeGroup`/`moveSessionToGroup`/`syncGroupOrder`/`fullReloadGroup` + client-side persistence and make `createSidebarGroups` respect user groups. If dropping: hide the dead group affordances instead.

Decisions #2 (pop-out panes) and #3 (restore eagerness) from the plan's decision list are needed for Batch 2 — ask the user for #1–#3 at the START of your session so nothing blocks later.

Batch 0 gave you working toasts (`upsert_gpui_app_toast` on the app entity / `type:"toast"` from the runtime via `postAppModalHostMessage`) — use them for user feedback on these flows like macOS does.

After each item: `cargo check`; for TS changes the sidebar bundles rebuild via the app's build (`gpui/vite.config.ts` entries); then ask the user to run the app and verify the specific flow side-by-side with the macOS app before moving on.

## When you finish Batch 1

1. Update `docs/2026-07-02/gpui-parity-plan.md`: mark Batch 1 items done (with one-line notes on anything deferred), same style as the Batch 0 status block.
2. Write `docs/2026-07-02/next-agent-prompt.md` (overwrite it) with the exact prompt for the NEXT agent thread to implement Batch 2 (Group 2: terminals — see the plan; it builds on Batch 0.3's recorded OSC state and 0.4's hotkey table). That prompt must have this same structure: read-first list, context, hard rules, ordered work items with file anchors from `docs/2026-07-02/reports/g2-terminals.md`, decisions needed, and — verbatim requirement — an instruction that the Batch 2 agent must in turn produce the Batch 3 handoff prompt the same way.
3. End your final message by pasting the full Batch 2 prompt inline so the user can copy it directly.
