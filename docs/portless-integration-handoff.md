<!--
CDXC:PortlessIntegration 2026-06-22-21:48:
Ghostex needs a local Portless integration plan that preserves every agreed product and technical decision so an orchestrator can assign short, sequential gxserver-rs/native/sidebar implementation phases without reopening the architecture.
-->

# Portless Integration Handoff

This is the source-of-truth implementation plan for adding Portless to Ghostex. Keep each phase small enough for one short-running sub-agent, and run phases sequentially.

Do not run `bun run start` unless the user explicitly asks.

## Settled Decisions

- Portless is managed by **`gxserver-rs`**, not the old TypeScript `gxserver`.
- Portless should be an exact pinned published `portless` dependency first, not a git submodule.
- Do not edit Portless source for the first implementation. If the published package cannot run unchanged with Ghostex's bundled Node, stop and report the blocker before adding a submodule, fork, extra Node runtime, or upstream patch layer.
- Run Portless with Ghostex's existing bundled code-server Node at `Web/code-server/lib/node`. Do not bundle another Node runtime.
- First version is local macOS `.localhost` only.
- No LAN, Tailscale, ngrok, remote gxserver, external already-running server adoption, full service-name editor, or per-project Portless toggle in the first version.
- Portless settings are global, not per project.
- Portless is enabled by default.
- HTTPS is the default protocol. HTTP is available through the global setting.
- Changing HTTPS/HTTP should immediately reconfigure the Portless service, prompting for admin permission if needed.
- Ghostex owns Portless's active state when the feature is enabled.
- Ghostex-managed Portless state lives under `~/.ghostex/gxserver/portless`, not `~/.portless`.
- The Portless state directory should stay user-owned so `gxserver-rs` can write routes. The root service only reads it.
- Portless's service label is global (`sh.portless.proxy` on macOS). If a standalone service already exists, Ghostex must ask before reconfiguring it.
- Once reconfigured for Ghostex, standalone `~/.portless` routes are not active through Ghostex's managed service.
- Removing the background proxy service only happens through explicit user action. Do not remove it on app quit, update, reinstall, or disable.
- Disable Portless should turn off Ghostex routing and clear Ghostex-managed routes, but should not uninstall the background service.
- `gxserver-rs` owns Portless state: global setting, setup state, stable slugs, desired live routes, and mirrored `routes.json`.
- Persist stable domain identities in gxserver SQLite.
- Generate/backfill stable domain slugs for every registered project and worktree, independent of whether Portless service setup is complete.
- Slugs are readable, generated once, persisted, and not silently renamed if the project/worktree display name changes.
- Slug collisions: the first project/worktree keeps the clean slug; later collisions get a persisted stable suffix. Do not reshuffle existing slugs.
- Project main domain example: `ghostex.localhost`.
- Worktree domain example: `ghostex.fix-ui.localhost`.
- Worktree suffix comes from stored worktree name first, branch last segment as fallback.
- Multiple live servers in the same project/worktree: one primary domain plus port fallback domains for extras.
- Primary selection order: prefer common frontend ports `3000`, `5173`, `5174`, `8080`, `8000`, then the lowest remaining port.
- Extra unnamed server example: `p8787.ghostex.fix-ui.localhost`.
- No explicit service-name editor in first version. Future named service domains like `api.ghostex.fix-ui.localhost` are out of scope.
- Routes are temporary. Active Portless routes exist only while the owning Ghostex session and listener process are live.
- Do not auto-register arbitrary external servers. Only Ghostex-launched servers qualify.
- "Ghostex-launched" means a dev-server listener under a Ghostex terminal/session process tree, including commands manually typed in a Ghostex terminal.
- Server-to-project mapping comes from the owning Ghostex session/project/worktree, not arbitrary cwd matching.
- Detect live servers with the existing listener scan approach plus Ghostex session process-tree ownership.
- Route syncing runs as a lightweight background task inside `gxserver-rs`.
- `gxserver-rs` should compute desired routes before service setup, but only mirror `routes.json` after the service is installed, active, and Ghostex-owned.
- Mirror Portless routes by directly writing `~/.ghostex/gxserver/portless/routes.json` from `gxserver-rs`, following Portless's lock-file convention.
- Use each active route's actual listener PID in `routes.json`, not persistent `pid: 0` aliases.
- `gxserver-rs` publishes Portless setup-needed/status state through the normal sidebar/status payload.
- Native macOS host performs admin-authorized service install/reconfigure/remove actions. Do not have `gxserver-rs` run `sudo` from the GUI daemon.
- Native host runs the bundled code-server Node plus Portless CLI with `PORTLESS_STATE_DIR=~/.ghostex/gxserver/portless`.
- The setup prompt is a native app-modal child window with React content, implemented like the Add Worktree modal. It is not an AppKit alert.
- Setup modal appears when Portless is enabled, a Ghostex-owned dev server is running, and service setup is missing or needs Ghostex reconfigure.
- Setup modal buttons: **Install** or **Reconfigure**, **Postpone**, **Disable**.
- **Postpone** suppresses this setup modal until Ghostex restarts.
- **Disable** turns off the global Portless setting.
- Setup failure keeps Portless enabled, marks setup failed, shows retry/disable actions, and suppresses repeated modal spam until retry or restart.
- Existing standalone service modal must ask before takeover. Buttons: **Reconfigure**, **Cancel**, **Disable**.
- Settings -> Projects must show a new **Global Settings** area above the project selector dropdown.
- Global Settings contains the Portless toggle, HTTPS/HTTP segmented control, setup status, and actions such as Install, Reconfigure, Retry, Disable, and explicit Remove background proxy where applicable.
- Project settings should show assigned project/worktree domains read-only in the first version. No slug edit/reset UI yet.
- Resources modal already has Dev Servers. Extend it so Ghostex-owned live servers show the Portless domain as the main link and raw `localhost:port` as secondary metadata.
- If setup is missing, Resources should still show raw `localhost:port` and expose Portless setup/status action.
- Persistent Portless logs must be structured and redacted only. Do not log project names, worktree names, paths, full URLs, hostnames, command text, environment values, tokens, secrets, or user-owned content.
- Add tests proving Portless logging does not write raw names, paths, URLs, hostnames, command text, or secrets.
- All implementation comments for important behavior must use the repo's `CDXC:<Area> yyyy-MM-dd-hh:mm:` format.

## Modal Copy

### First Setup

Title: `Set up Portless domains?`

Body:

`Ghostex found a running dev server. Portless gives it a stable local domain like https://ghostex.localhost, so you can run multiple apps and worktrees of the same project without conflicting ports.`

`Installing the Portless background proxy requires admin permission once so it can listen on standard local web ports. You can disable Portless if you do not want Ghostex to show this again.`

Buttons: `Install`, `Postpone`, `Disable`

### Existing Standalone Service

Title: `Reconfigure Portless for Ghostex?`

Body:

`Portless is already installed on this Mac. Ghostex needs to manage the Portless background proxy so it can create stable domains for your projects and worktrees.`

`Reconfiguring will point Portless at Ghostex's state directory. You can cancel, or disable Portless in Settings if you do not want Ghostex to show this again.`

Buttons: `Reconfigure`, `Cancel`, `Disable`

## Phase Plan

Each phase should be small. Avoid cross-phase refactors unless the current phase cannot work without them.

### Phase 1: Runtime Feasibility

- Add no app behavior yet.
- Verify the published `portless` package can be installed as an exact pinned dependency.
- Verify its built CLI can run under Ghostex's bundled code-server Node 22 path.
- Check basic commands such as version/help and a non-privileged dry/status path.
- If the Node `>=24` engine or runtime APIs block this, stop and report. Do not add a submodule, fork, extra Node runtime, or Portless source patch without a new decision.

Done when: there is a clear pass/fail note and, on pass, the exact dependency version is known.

### Phase 2: Package Portless With Ghostex

- Add the exact pinned `portless` dependency.
- Update macOS packaging/build validation so the Portless `dist/cli.js` payload is included in app resources.
- Reuse the existing bundled code-server Node resolver pattern.
- Add package-shape tests or source tests proving Ghostex packages Portless without adding another Node runtime.

Done when: packaged Ghostex has Portless CLI plus `Web/code-server/lib/node`, and validation fails if either is missing.

### Phase 3: Shared Settings Contract

- Add global Portless settings to shared settings/types:
  - enabled default `true`
  - protocol default `https`
- No per-project toggle.
- Add normalization tests for missing, legacy, invalid, HTTPS, and HTTP values.
- Add CDXC comments documenting default-on, global-only, and HTTPS default requirements.

Done when: settings normalize deterministically and old settings files remain valid.

### Phase 4: gxserver-rs Persistence Model

- Add SQLite persistence for Portless domain identities and setup/runtime state.
- Store project/worktree stable slugs separately from display names.
- Keep this under `gxserver-rs`; do not use TypeScript gxserver.
- Add migrations and tests.

Done when: gxserver-rs can create/read/update stable Portless metadata without touching Portless files.

### Phase 5: Slug Backfill And Allocation

- Backfill slugs for every registered project and worktree.
- Project slug: readable hostname-safe slug from the visible project identity at first assignment, with path basename as fallback if needed.
- Worktree suffix: stored worktree name first, branch last segment fallback.
- Persist generated slugs and never silently regenerate after renames.
- Implement collision handling where first clean slug wins and later conflicts receive stable suffixes.
- Add tests for project rename, worktree rename/branch change, collisions, and suffix stability.

Done when: domains are stable across repeated reads and name changes.

### Phase 6: Portless State Directory And Route Writer

- Add `~/.ghostex/gxserver/portless` to gxserver-rs paths.
- Ensure the directory is user-owned/writable by gxserver-rs.
- Implement direct `routes.json` sync using Portless's schema:
  - `hostname`
  - `port`
  - `pid`
- Follow Portless's route lock convention (`routes.lock`) to avoid concurrent writes.
- Do not use `pid: 0` for Ghostex live routes.
- Add tests for lock handling, stale route removal, atomic-ish writes, and cleanup when desired routes are empty.

Done when: gxserver-rs can mirror a desired route set into Portless state safely.

### Phase 7: Ghostex-Owned Listener Detection

- Build or extend a gxserver-rs process snapshot helper that:
  - lists live Ghostex session root PIDs
  - walks process trees
  - lists TCP listeners
  - maps listener PIDs back to owning Ghostex sessions
- Reuse the existing zmx process snapshot/process-tree parsing where practical.
- Do not adopt listeners only because their cwd is under a project path.
- Map each listener to the owning Ghostex session's project/worktree.
- Add tests for:
  - manual dev server typed inside Ghostex terminal
  - external Terminal/iTerm/VS Code listener ignored
  - sleeping/stopped session ignored
  - exited listener route removed

Done when: gxserver-rs can compute desired routes only for Ghostex-owned live server listeners.

### Phase 8: Route Naming And Primary Selection

- Convert detected Ghostex-owned listeners into desired Portless routes.
- For each project/worktree group, select primary by `3000`, `5173`, `5174`, `8080`, `8000`, then lowest port.
- Primary route uses the base project/worktree domain.
- Extra routes use `p<port>.<base-domain>`.
- Keep route identities temporary and tied to live server state.
- Add tests for single server, multiple servers, primary port preference, lowest-port fallback, worktree domains, and extra port fallback domains.

Done when: desired route computation exactly matches the agreed hostname rules.

### Phase 9: gxserver-rs Background Sync

- Add a lightweight background task in `gxserver-rs`.
- It computes desired routes when Portless is enabled.
- It only writes `routes.json` when setup is installed, active, and Ghostex-owned.
- It clears mirrored routes when Portless is disabled.
- It removes stale routes when the server/session is no longer live.
- It publishes setup-needed/setup-failed/status through the normal sidebar/status payload.
- Add tests or source tests for disabled, setup missing, setup active, and failed setup states.

Done when: route state updates without Resources being open and without relying on sidebar/native UI polling.

### Phase 10: Service Status And Ownership Detection

- Detect whether Portless service is:
  - missing
  - installed and Ghostex-owned
  - installed but standalone/non-Ghostex
  - installed but protocol/config mismatch
  - failed/unreachable
- On macOS, inspect `/Library/LaunchDaemons/sh.portless.proxy.plist` where possible.
- Ghostex-owned means it points at Ghostex's bundled Portless CLI and uses `PORTLESS_STATE_DIR=~/.ghostex/gxserver/portless`.
- Publish setup-needed when a Ghostex-owned dev server is running and setup is missing or takeover/reconfigure is needed.
- Add tests with plist fixtures.

Done when: UI can distinguish Install, Reconfigure, Retry, active, disabled, and standalone-service states.

### Phase 11: Native Admin Actions

- Add native macOS host actions for:
  - install Ghostex-managed Portless service
  - reconfigure existing service for Ghostex
  - retry failed setup
  - remove background proxy by explicit user action
- Use the existing admin-authorization pattern used by Ghostex native helpers, not `sudo` from `gxserver-rs`.
- Run bundled code-server Node plus Portless CLI.
- Always set `PORTLESS_STATE_DIR=~/.ghostex/gxserver/portless`.
- Support HTTPS/HTTP service config and protocol reconfigure.
- Return structured success/failure to React/gxserver-rs.
- Do not log paths, command text, hostnames, or full URLs persistently.

Done when: the native host can install/reconfigure/remove through explicit user action and report failures.

### Phase 12: Protocol Plumbing

- Extend shared host/sidebar/gxserver contracts for Portless status, desired route previews, actions, and admin results.
- Keep payloads metadata-only and privacy-safe.
- Ensure local Mac only. Remote gxserver should not show active Portless setup actions in first version.
- Add protocol/source tests.

Done when: sidebar React can render Portless state without reading Portless files directly.

### Phase 13: Add Worktree-Style React Modal

- Add a new native app-modal child window using the same modal host pattern as Add Worktree.
- Use the exact setup and reconfigure copy from this file.
- Buttons:
  - Install/Reconfigure calls native admin action.
  - Postpone suppresses until Ghostex restart.
  - Disable turns off global Portless setting.
  - Cancel on standalone reconfigure closes without takeover.
- Do not use an AppKit alert.
- Add source/UI tests for modal id, size if needed, copy, buttons, and postpone behavior.

Done when: setup prompts appear only through the React app-modal host and obey Postpone/Disable.

### Phase 14: Settings UI

- In Settings -> Projects, add a **Global Settings** area above the project selector dropdown.
- Include:
  - Portless toggle
  - HTTPS/HTTP segmented control
  - setup status
  - Install/Reconfigure/Retry/Disable actions as applicable
  - explicit Remove background proxy action when a Ghostex-managed service is installed
- Show assigned project/worktree domains as read-only summaries.
- Do not add slug editing/reset yet.
- Add tests/source tests for placement, defaults, actions, and read-only domain display.

Done when: users can see and control global Portless behavior from Projects settings.

### Phase 15: Resources Modal Integration

- Extend the existing Resources -> Dev Servers section.
- Only show Portless domains for Ghostex-owned live server listeners.
- Make the Portless domain the main link when setup is active.
- Show raw `localhost:port`, command name, and pid as secondary metadata.
- If setup is missing, show raw `localhost:port` plus setup/status action.
- Avoid duplicate raw/domain rows for the same server.
- Keep existing Stop behavior targeting only the live server process tree.
- Add tests for active domain row, setup-missing row, multiple servers, and external listener exclusion.

Done when: Resources teaches stable-domain usage without hiding raw local port details.

### Phase 16: Protocol Change And Failure UX

- Changing HTTPS/HTTP should immediately reconfigure service if installed.
- If admin permission is needed, prompt through the native React modal/action flow.
- If install/reconfigure fails:
  - keep Portless enabled
  - mark setup failed
  - show retry/disable actions
  - suppress repeated modal spam until retry or restart
- Disabling Portless:
  - clears Ghostex-managed routes
  - does not uninstall service
  - stops setup prompts
- Add tests for protocol change, failed setup, retry, disable, and explicit remove service behavior.

Done when: all setup states are recoverable and do not spam prompts.

### Phase 17: Privacy-Safe Logging

- Add structured Portless operational logs only if useful.
- Allowed fields: counts, booleans, enum states, protocol, setup state, route count, error codes, durations.
- Forbidden fields: project names, worktree names, paths, full URLs, hostnames, command text, env values, tokens, secrets, stdout/stderr content.
- Gate routine diagnostics behind Debugging Mode where appropriate.
- Add tests proving forbidden raw values do not appear in persisted logs.

Done when: support can debug setup state without exposing user-owned content.

### Phase 18: Final Verification Pass

- Run focused Rust tests for gxserver-rs Portless modules.
- Run focused TS/source tests for settings, modal, Resources, and protocol contracts.
- Verify no unrelated files were changed.
- Verify no broad search/imported-tree churn.
- Verify no extra Node runtime was introduced.
- Verify no TypeScript gxserver implementation was added.
- Verify no LAN/Tailscale/ngrok/remote/external-server adoption accidentally slipped in.
- Do not run `bun run start` unless the user explicitly asks.

Done when: the feature matches this handoff and the final agent can summarize exact tests run and any remaining manual verification.

