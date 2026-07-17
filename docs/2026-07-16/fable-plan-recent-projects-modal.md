# Plan: Recent Projects popup modal (out of the sidebar)

## Overall goal

Remove the "Recent Projects" sections from the sidebar (both the local bottom section and the per-remote-machine bottom sections that were added on 2026-07-15) and replace them with a **Recent Projects popup modal** that is implemented the SAME WAY as the existing "Reopen a Session" (`previousSessions`) app modal:

- Same open path: `openAppModal(...)` from `sidebar/app-modal-host-bridge.ts`, rendered by `native/sidebar/modal-host.tsx` (native child window in the gpui app), and an in-page overlay host in `ghostex-web`.
- Same data path: the modal posts a request message over `vscode.postMessage` and the host answers with a result message (exactly like `requestPreviousSessions` → `previousSessionsResult`).
- Same look/feel chrome as the Reopen a Session modal (title header, close X, search field), but the **rows keep the exact current Recent Projects row look** (icon, title, path, running-session count, context menu with Restore / Copy Path / Open in Finder / Remove, click-to-restore).

Launch buttons:
- A new icon button (Tabler `IconHistory`, tooltip/aria-label "Recent Projects") **immediately to the left of the Add Project (+) button** in the local "Projects" section header.
- The same button in **each remote machine section header** (only while that machine is connected, i.e. gated the same way as its Add Project button), which opens the modal scoped to that machine.

Persistence requirement (mostly already true — verify, do not regress): recent projects and the still-running sessions inside them are owned by each machine's **gxserver-rs** (`/api/listRecentProjects`, `/api/closeProjectToRecent`, `/api/restoreRecentProject`, `/api/removeRecentProject`, sqlite `projects.isRecentProject` + `recentClosedAt`). No phase may introduce client-side persistence of recent projects in the gpui app, the macOS app, or the web app. **No gxserver-rs changes are needed or wanted in this plan** — the endpoints already exist.

## Repo rules for every worker

- Do NOT write any tests under `native/` (macOS app) or `gpui/` trees. Tests under `sidebar/` and `shared/` exist but you are not required to add new ones; keep existing ones compiling.
- Never add fallback code where fixing the actual behavior is possible. No try-this-then-degrade logic.
- Never run `bun run start` or anything that starts/restarts the Ghostex app.
- Other agents share this checkout. Do not revert, stash, or reformat files you did not change. Before editing a file, work from its current on-disk content. Do not delete stray git lock files' owners' work; a stale `.git/index.lock` itself may be deleted.
- Protocol/contract changes must be additive (new message types only; never change existing message shapes).
- Search routing: work only in the files listed for your phase; never search or edit `ghostty/**`, `tui/vendor/**`, `node_modules/**`.

## Pinned message contract (all phases use exactly this)

Additions to `shared/session-grid-contract-sidebar.ts`:

- `SidebarToExtensionMessage` gains:
  `{ type: "requestRecentProjects"; machineId?: string }`
  — `machineId` absent/undefined means the local machine; otherwise it is the saved remote machine id.
- `ExtensionToSidebarMessage` gains:
  `{ type: "recentProjectsResult"; machineId?: string; recentProjects: SidebarRecentProject[] }`
  — hosts echo the request's `machineId` verbatim so the modal can match responses; `recentProjects` is already-filtered to that machine (hosts do the filtering, the modal does not).

Addition to `sidebar/app-modal-host-bridge.ts`:

- `AppModalKind` gains `"recentProjects"`.
- `OpenAppModalMessage` gains the variant:
  `{ machineId?: string; machineName?: string; modal: "recentProjects"; type: "open" }`

Existing action messages are reused unchanged from the modal: `restoreRecentProject`, `copyRecentProjectPath`, `openRecentProjectInFinder`, `removeRecentProject` (all take `projectId`; remote rows carry machine-scoped project ids exactly as the old sidebar sections did).

## Reference files (read these before implementing)

- `sidebar/previous-sessions-modal.tsx` — the model to copy for modal structure, open/close, request/response wiring, loading timeout, Esc handling.
- `sidebar/sidebar-app.tsx` — current `RecentProjectsSection` (~line 6294), its render sites (~4689 local, ~6233 inside `RemoteMachineSidebarSection`), section header action buttons (~5784-5918), `restoreRecentProject`/context-menu handlers (~4126-4160), `openAppModal` call sites (~4290, ~4714).
- `native/sidebar/modal-host.tsx` — kind lists (~90, ~117, ~131), payload capture for `remoteProjectPicker` (~187, ~1198), `PreviousSessionsModal` render (~1147), `hasRequiredState` switch (~2740).
- `native/sidebar/native-sidebar.tsx` — `case "requestPreviousSessions"` (~47408) + `requestPreviousSessionsFromGxserver` (~15907), gxserver recents plumbing (`applyGxserverRecentProjects` ~9660, `restoreRecentProject` ~40100), remote recents source (`remote-recent-projects-source` module).
- `gpui/src/main.rs` — `GpuiAppModalKind` (~2340-2560: `from_modal_id`, `modal_id`, `window_title`, `window_size`, `locks_content_size`, `requires_sidebar_state`, `open_message`), `"requestPreviousSessions"` handler (~34397), remoteProjectPicker payload passthrough (~26280-26554).
- `ghostex-web/src/sidebar-runtime/sidebar-runtime.ts` — web host message handling (`restoreRecentProject`/`removeRecentProject` ~529), per-machine recents fetching (`refreshRecentProjects` ~190, `createWebRecentProjects`), connection registry `rpcForMachine`.
- `sidebar/recent-project-search.ts` — existing filter helpers to reuse for the modal search field.

## Phase 1: Shared contract, Recent Projects modal component, sidebar buttons, modal-host wiring

- depends_on: []
- parallel_ok: false
- goal: All shared TypeScript work: message contract additions, the new `RecentProjectsModal` component, removal of the sidebar Recent Projects sections, the two new header launch buttons, and rendering the new modal kind inside `native/sidebar/modal-host.tsx`.
- files: `shared/session-grid-contract-sidebar.ts`, `sidebar/app-modal-host-bridge.ts`, `sidebar/recent-projects-modal.tsx` (new), `sidebar/sidebar-app.tsx`, `native/sidebar/modal-host.tsx`, plus any `sidebar/*.stories.tsx` / fixture files that stop compiling because of removed props, and `sidebar/styles/*.css` if the modal needs styles that CSS-in-file classes don't already cover.
- do_not_touch: `gpui/src/**`, `ghostex-web/src/**`, `native/sidebar/native-sidebar.tsx`, `gxserver-rs/**`.
- approach:
  1. Add the pinned contract messages (see header) to `shared/session-grid-contract-sidebar.ts` and the pinned `AppModalKind`/`OpenAppModalMessage` additions to `sidebar/app-modal-host-bridge.ts`. Additive only.
  2. Create `sidebar/recent-projects-modal.tsx` modeled directly on `sidebar/previous-sessions-modal.tsx`: props `{ isOpen: boolean; machineId?: string; machineName?: string; onClose: () => void; vscode: WebviewApi }`. On open (and after a `removeRecentProject` action) post `{ type: "requestRecentProjects", machineId }`; listen for `recentProjectsResult` messages whose `machineId` matches and render that list. Same portal/overlay/header/search-field chrome as the previous-sessions modal; title "Recent Projects" plus the machine name when `machineName` is provided (e.g. "Recent Projects — devbox"). Reuse the row visuals from the current `RecentProjectsSection` in `sidebar-app.tsx` — extract the row markup (icon via project icon/dataUrl, title, path, session count badge, context menu) into a small exported component so the modal renders identical rows. Row click → post `restoreRecentProject` then `onClose()`. Context menu items: Restore, Copy Path, Open in Finder, Remove — posting the existing messages; Remove re-requests the list instead of optimistically mutating. Search filters with the helpers in `sidebar/recent-project-search.ts`. Esc closes. Show the same loading treatment/initial-load-timeout pattern the previous-sessions modal uses.
  3. In `sidebar/sidebar-app.tsx`: delete the local `<RecentProjectsSection>` render (~4689) and the remote one inside `RemoteMachineSidebarSection` (~6233), delete the now-unused `RecentProjectsSection` component and the `recentProjects`/`recentProjectContextMenuId`/`onRecentProjectContextMenu`/`onRestoreRecentProject` prop threading through `RemoteMachineSidebarSection`, and remove `groupRecentProjectsByMachine` usage if nothing else consumes it. Keep the top-level `restoreRecentProject` handlers only if still used; otherwise remove. The sidebar must no longer render any Recent Projects rows.
  4. Add the launch buttons in the shared section-header component (the one rendering Clone Repository / Add Project at ~5894-5917): a new optional `onShowRecentProjects` callback rendering a `SidebarFixedTooltipButton` with `IconHistory` (size 14, stroke 1.9), aria-label/tooltip "Recent Projects", placed immediately BEFORE the `onAddProject` button in the DOM so it appears to its left. Wire it:
     - Local Projects header: `dismissAppModalForSidebarNavigation("SettingsDismissal:recentProjects"); openAppModal({ modal: "recentProjects", type: "open" });`
     - Remote machine header (in `RemoteMachineSidebarSection`, gated like Add Project on `isConnected`): same but with `machineId: machine.id, machineName: machine.name`.
  5. Wire the modal into `native/sidebar/modal-host.tsx` exactly like `previousSessions`: add `"recentProjects"` to the modal-kind union (~90), the kind array (~131), the dialog-selector map (~117, point it at the modal's root dialog class); capture the open payload `{ machineId?, machineName? }` into state the way `remoteProjectPicker` does (~187, ~1198); render `<RecentProjectsModal>` beside `<PreviousSessionsModal>` (~1147) passing the captured payload; `hasRequiredState` returns true whenever the open payload object was captured (an empty payload with no machineId is valid — local machine).
  6. Do not add any new persistence. Storybook/fixture files that referenced removed props must be updated to compile.
- acceptance_criteria:
  - `bun run typecheck` passes from the repo root.
  - `rg -n "RecentProjectsSection" sidebar/ native/` finds no live render of a sidebar Recent Projects section (component deleted or only the extracted row component remains under a new name).
  - `rg -n "requestRecentProjects" shared/session-grid-contract-sidebar.ts` and `rg -n "recentProjectsResult" shared/session-grid-contract-sidebar.ts` both match.
  - `rg -n "recentProjects" sidebar/app-modal-host-bridge.ts` shows the new kind and open-message variant with optional `machineId`/`machineName`.
  - `sidebar/recent-projects-modal.tsx` exists, posts `requestRecentProjects` on open, and renders rows with icon/title/path/session count and the 4 context-menu actions.
  - The section header component renders the IconHistory button immediately before the Add Project button when `onShowRecentProjects` is provided, and both the local Projects header and connected remote machine headers pass it.
  - `native/sidebar/modal-host.tsx` renders the modal for kind `recentProjects` with payload passthrough.

## Phase 2: Host answers in native-sidebar (gpui + macOS sidebar host)

- depends_on: [1]
- parallel_ok: true
- goal: `native/sidebar/native-sidebar.tsx` answers `requestRecentProjects` for the local machine and for saved remote machines, delivering `recentProjectsResult` back to the surface that asked (main sidebar webview or a native modal-host window), mirroring how `requestPreviousSessions` is answered.
- files: `native/sidebar/native-sidebar.tsx` (plus a small helper module under `native/sidebar/` if you need one, e.g. beside `remote-recent-projects-source`).
- do_not_touch: `sidebar/**` component code (P1 owns it; you may read it), `gpui/src/**`, `ghostex-web/**`, `gxserver-rs/**`.
- approach:
  - Add `case "requestRecentProjects"` next to `case "requestPreviousSessions"` (~47408). For `machineId` undefined: build `SidebarRecentProject[]` from the existing local gxserver recents state (the same source that used to feed `hud.recentProjects` — `applyGxserverRecentProjects` / `createSidebarGxserverRecentProjects`; refresh from `/api/listRecentProjects` via the existing gxserver client before answering so the list is current). For a `machineId`: use the existing remote recents source (`remote-recent-projects-source`) to fetch that machine's recents and map them with their machine-scoped project ids exactly as the old remote sidebar sections did. Echo `machineId` in the result. Deliver the result over the same reply path `previousSessionsResult` uses so native modal-host windows receive it.
  - Verify (and fix if broken) that `restoreRecentProject` / `removeRecentProject` / `copyRecentProjectPath` / `openRecentProjectInFinder` messages posted FROM a modal-host window route into the existing handlers the same way the previous-sessions modal's reopen actions do. Do not duplicate handlers.
  - Keep `hud.recentProjects` population intact if other consumers remain (command palette, etc.); if nothing consumes it anymore leave the plumbing in place — do NOT rip it out in this phase.
  - Audit criterion: no new client-side persistence of recents; every read/write goes through the owning machine's gxserver `/api/*RecentProject*` endpoints.
- acceptance_criteria:
  - `bun run typecheck` passes from the repo root.
  - `rg -n "requestRecentProjects" native/sidebar/native-sidebar.tsx` shows the new case answering with `recentProjectsResult` for both local and machine-scoped requests.
  - The reply uses the same surface-reply mechanism as `previousSessionsResult` (point to the lines).
  - `rg -n "localStorage|writeFile|persist" ` over your diff shows no new recents persistence.

## Phase 3: gpui Rust modal kind + host answer + payload passthrough

- depends_on: [1]
- parallel_ok: true
- goal: The gpui app opens the Recent Projects modal as a native child window exactly like Previous Sessions, forwards the `machineId`/`machineName` payload, and answers `requestRecentProjects` from Rust.
- files: `gpui/src/main.rs` (and `gpui/src/cef/sidebar_bridge_manifest.rs` only if kind registration is required there — check how `previousSessions` appears in it).
- do_not_touch: `sidebar/**`, `native/sidebar/**` (read-only for you; P1/P2 own them), `ghostex-web/**`, `gxserver-rs/**`.
- approach:
  - Add `RecentProjects` to `GpuiAppModalKind`: `from_modal_id`/`modal_id` ("recentProjects"), `window_title` ("Ghostex Recent Projects"), `window_size` (reuse the `APP_MODAL_HOST_PREVIOUS_SESSIONS_WINDOW_*` dimensions), `locks_content_size` (include it alongside `PreviousSessions`), and every other exhaustive match on the enum until it compiles.
  - `open_message()`: include it with the plain `{modal, type}` group, then make the open-request path forward the sidebar's `machineId`/`machineName` fields into the open message the same way `remoteProjectPicker` forwards `remoteMachineId`/`remoteMachineName` (~26280-26554). The modal-host page reads them from the open message (P1's payload capture).
  - Add a `"requestRecentProjects"` handler next to `"requestPreviousSessions"` (~34397): `machineId` absent → call local gxserver `/api/listRecentProjects` and map to the `SidebarRecentProject` contract shape (camelCase JSON, no extra fields); `machineId` present → answer from the existing gpui remote-machine recents source (find how gpui currently populates remote `hud.recentProjects` for the sidebar and reuse that exact source). Reply as a transient `recentProjectsResult` sidebarState payload the same way `previousSessionsResult` is sent (~84332 note, ~84444). Echo `machineId`. On transport/token failure return an empty contract-shaped result without logging private data (same policy as previous sessions).
  - Confirm modal-window-posted `restoreRecentProject`/`removeRecentProject`/`copyRecentProjectPath`/`openRecentProjectInFinder` messages route to the existing gpui handlers (they should, via the shared modal-host message pipe used by previous-sessions reopen actions); fix routing if a kind allowlist blocks them.
  - Rebuild the gpui CEF web bundles so `gpui/runtime/macos/Web/modal-host.js` and `native-sidebar.js` pick up P1/P2 output: use the existing build path that regenerates `gpui/runtime/macos/Web` (see `gpui/vite.config.ts` and `gpui/scripts/prepare-macos-runtime.sh`) — build assets only; do NOT launch or restart the app.
- acceptance_criteria:
  - `cargo check` passes in `gpui/` (run from the `gpui/` directory).
  - `rg -n "RecentProjects" gpui/src/main.rs` shows the enum variant wired through `from_modal_id`, `window_title`, `window_size`, `locks_content_size`, and `open_message` payload passthrough of `machineId`/`machineName`.
  - `rg -n "requestRecentProjects" gpui/src/main.rs` shows the handler answering `recentProjectsResult` for local and remote machineIds.
  - `gpui/runtime/macos/Web/modal-host.js` and `native-sidebar.js` are rebuilt and contain the string `requestRecentProjects` (`rg -l "requestRecentProjects" gpui/runtime/macos/Web/`).

## Phase 4: ghostex-web modal host + request handling + deploy

- depends_on: [1]
- parallel_ok: true
- goal: The web app opens the same Recent Projects modal (same shared component, in-page overlay since the web has no native child windows), answers `requestRecentProjects` per machine from that machine's gxserver, and the built SPA is deployed to `ghostex-web/dist`.
- files: `ghostex-web/src/**` only.
- do_not_touch: `sidebar/**`, `shared/**`, `native/**`, `gpui/**`, `gxserver-rs/**`.
- approach:
  - App-modal shim: `openAppModal` posts to `window.webkit.messageHandlers.ghostexAppModalHost` and throws when absent. Install a shim in the web runtime before `SidebarApp` mounts that defines that handler. For `{modal: "recentProjects", type: "open", machineId?, machineName?}` dispatch a typed window CustomEvent (follow the existing `ghostex-web:*` event pattern in `ghostex-web/src/app/action-events.ts`); for `{type: "close"}` dispatch a close event; for any other modal kind `console.warn` and ignore (the web sidebar previously threw for those — warn-and-ignore is the correct web behavior, not a fallback).
  - Render `RecentProjectsModal` (import from `sidebar/recent-projects-modal.tsx` via the existing `@` alias) at the app root (agents-page or a sibling), driven by that event state, passing the web sidebar's `vscode`/messageSource bridge so the modal's `postMessage` lands in `sidebar-runtime.ts`'s message handler.
  - In `sidebar-runtime.ts` handle `case "requestRecentProjects"`: resolve the machine (undefined machineId = primary/local machine), call that machine's gxserver `/api/listRecentProjects` via the connection registry rpc, map with the existing `createWebRecentProjects` mapping (machine-scoped ids for non-primary machines, matching what the removed sections showed), and post `{ type: "recentProjectsResult", machineId, recentProjects }` back through the messageSource to the UI. Reuse — don't duplicate — the existing mapping helpers.
  - Web machineId mapping caution: the shared sidebar's remote machine header passes the saved-machine id from `SidebarRemoteMachine.id`. In the web runtime those machines are synthesized from connection states — make sure the id used by the header button round-trips to the right connection (this is the id `createRemoteMachineSettings` already assigns).
  - `restoreRecentProject`/`removeRecentProject` already route per machine (~529). `copyRecentProjectPath`: handle via `navigator.clipboard.writeText` if not already handled. `openRecentProjectInFinder`: not meaningful in a browser — have the runtime ignore it with a console.warn (do not crash), and it is acceptable for the shared modal to show the item.
  - Build and deploy: `bun run web:typecheck && bun run web:build` (gxserver serves `ghostex-web/dist` live, no restart needed).
- acceptance_criteria:
  - `bun run web:typecheck` and `bun run web:build` pass.
  - `rg -n "ghostexAppModalHost" ghostex-web/src/` shows the shim installed before SidebarApp mounts.
  - `rg -n "requestRecentProjects" ghostex-web/src/sidebar-runtime/sidebar-runtime.ts` shows per-machine answering with echoed machineId.
  - No recents persistence added in the web app (localStorage keys unchanged except existing ones).
  - `ghostex-web/dist` contains the fresh build (`rg -l "requestRecentProjects" ghostex-web/dist/assets/ | head -1` matches).

## Verifier notes

Beyond per-phase criteria, verify end-to-end in a real browser against `http://127.0.0.1:58744/` using CDP (Chrome debug port 9333; the faster-chrome-devtools workflow):
1. The sidebar shows NO Recent Projects section anywhere.
2. The Projects header shows the IconHistory button left of Add Project; clicking it opens the Recent Projects modal with real rows (this machine has recent projects, e.g. "2026-07-15 Hafid REST").
3. Rows show icon/title/path/session count with the previous look; search filters; Esc and the X close it.
4. If a remote machine section is present and connected, its header button opens the machine-scoped modal.
5. Restore from the modal restores the project into the sidebar (and Remove removes the row after refetch). Restore ONLY a project that is safe to restore, then close it back to recents via its existing UI if possible; if unsure, verify restore via gxserver API state instead of destructive UI clicking.
6. Confirm storage: `curl -s -H "Authorization: Bearer $(cat ~/.ghostex/gxserver/auth/token)" -X POST http://127.0.0.1:58744/api/listRecentProjects` returns the same projects the modal shows.
gpui cannot be relaunched — for gpui verify by code inspection + `cargo check` + rebuilt runtime assets only.

## Handoff notes

- **P1 COMPLETE (2026-07-16):** Pinned contract messages added to `shared/session-grid-contract-sidebar.ts` and `sidebar/app-modal-host-bridge.ts` exactly as specified. New `sidebar/recent-projects-modal.tsx` (searchable, machine-scoped, previous-sessions-style chrome, reuses recent-project row look, posts `requestRecentProjects` on open and after Remove). Both sidebar Recent Projects sections removed from `sidebar/sidebar-app.tsx`; IconHistory launch buttons added to the local Projects header and connected remote machine headers (left of Add Project). `native/sidebar/modal-host.tsx` renders kind `recentProjects` with `{machineId?, machineName?}` payload passthrough. Also touched `sidebar/styles/modals.css`. Repo-root `bun run typecheck` passes.
- **P2 COMPLETE (2026-07-16):** `native/sidebar/native-sidebar.tsx` now handles `case "requestRecentProjects"` (~47506) via `requestRecentProjectsFromGxserver(machineId?)` (~15995): local requests refresh from gxserver `/api/listRecentProjects` before answering; remote requests answer with machine-scoped project ids from the existing remote recents source; replies post `recentProjectsResult` over the same sidebar/modal-host reply path as `previousSessionsResult`. Typecheck + no-persistence audit pass; only that one file changed.
- **P3 COMPLETE (2026-07-16):** gpui `main.rs` gained `GpuiAppModalKind::RecentProjects` (fixed-size like PreviousSessions, title "Ghostex Recent Projects"), `machineId`/`machineName` open-message passthrough, a `requestRecentProjects` handler answering local (gxserver `/api/listRecentProjects`) and remote (existing remote recents source) with a transient `recentProjectsResult` payload, and routing for all four recent-project action messages from the modal window. `gpui/runtime/macos/Web` bundles (modal-host.js, native-sidebar.js) rebuilt. `cargo check` + rustfmt pass.
- **P4 COMPLETE (2026-07-16):** ghostex-web installed the `ghostexAppModalHost` shim (typed open/close window events; warn-and-ignore for unsupported kinds), mounted the shared `RecentProjectsModal` at the app root over the runtime's messageSource bridge, added machine-scoped `requestRecentProjects` answering via the connection registry (echoed machineId, reused web recents mapping), clipboard-based `copyRecentProjectPath`, warn-only `openRecentProjectInFinder`, and refetch-after-mutation. `bun run web:typecheck` + `web:build` pass; fresh build in `ghostex-web/dist`. Touched `ghostex-web/src/main.tsx`, `app/action-events.ts`, and runtime files.
