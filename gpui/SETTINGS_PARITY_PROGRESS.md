# GPUI Settings Parity Progress

<!--
CDXC:GPUISettingsParity 2026-06-24-10:41:
The GPUI settings parity effort must port the current macOS Settings UI/UX by reusing the same React settings components, sharing cross-platform code where appropriate, and coordinating implementation through one L-sized worker agent at a time. This file is the source-of-truth progress ledger for requirements, assigned slices, implemented behavior, remaining gaps, and validation deferrals for this goal.
-->

Source of truth:

- macOS settings model: `shared/ghostex-settings.ts`
- macOS settings UI: `sidebar/settings-modal.tsx`
- macOS modal host: `native/sidebar/modal-host.tsx`
- macOS settings persistence/fan-out: `native/sidebar/native-sidebar.tsx`
- macOS shared settings storage: `native/macos/ghostexHost/Sources/Shared/GhostexAppStorage.swift`
- GPUI app shell and CEF bridge: `gpui/src/main.rs`, `gpui/src/cef/*`, `gpui/sidebar/*`

Hard constraints:

- Use one implementation sub-agent at a time.
- The orchestrator tracks and reviews progress; implementation belongs to sub-agents.
- Reuse the exact existing React Settings components from the macOS app in GPUI.
- Share cross-platform code where it makes sense, avoiding macOS-only assumptions in shared modules.
- Do not add temporary or stub settings behavior.
- Do not run verification commands after each implementation slice unless the user asks.
- Do not run `bun run start` or restart the app unless the user asks.
- Preserve the native layout and hit-testing discipline: settings must use owned modal/window/surface bounds, not transparent overlays or broad hit-test routing.
- Keep persistent logs privacy-safe; settings/logging changes must not write project names, paths, URLs, command text, tokens, environment values, stdout/stderr, or user-owned content.
- Add/update `CDXC:` comments near important implemented requirements when code changes are made.

## L-Sized Work Queue

1. Shared GPUI settings service and path contract
   - Own reading, validation, atomic persistence, no-op unchanged writes, and in-memory revisioning for shared sidebar settings in GPUI.
   - Decide and document the GPUI shared-settings path contract relative to `~/.ghostex` and `.ghostex-gpui`.
   - Keep Rust parsing focused on fields GPUI consumes; avoid duplicating the full TypeScript settings schema.

2. GPUI modal host packaging and launch flow
   - Add a GPUI build/package path for the existing React modal host/settings UI.
   - Wire the GPUI titlebar Settings button and sidebar `openSettings` messages to an owned modal/window/surface.
   - Do not introduce transparent overlays, hidden interactive overlap, or global hit-test rerouting.

3. Settings hydration and `updateSettings` persistence bridge
   - Hydrate the modal host with current settings and a revision before rendering Settings.
   - Match macOS behavior that avoids saving default settings before real settings have hydrated.
   - Persist `updateSettings` back through the GPUI settings service and broadcast the resulting revision.

4. Live sidebar settings handoff
   - Replace hardcoded GPUI sidebar settings inputs with live normalized settings from the GPUI bridge.
   - Keep the current sidebar runtime debug/beta handoff working while moving toward the macOS host contract.

5. Core settings fan-out parity
   - Port side effects that directly affect GPUI runtime behavior: theme/chrome/sidebar side, terminal/Ghostty settings, auto-sleep, browser feedback tool, notifications, keep-awake, AppShots, and removed remote passwords.

6. Server and integration settings fan-out parity
   - Port gxserver agent settings, Portless settings/admin actions, code-server runtime settings, project/editor defaults, and related settings-driven status refreshes.

7. Settings action bridges
   - Implement GPUI equivalents for settings actions such as opening system preferences, installing CLI/hooks/skills, showing folder stats, Ghostty config/docs actions, Cua/GTE status/actions, Portless admin, sound preview, and OS integration actions.

8. Cross-platform cleanup, privacy proof, and documentation
   - Consolidate shared contracts, remove ad hoc settings reads replaced by the settings service, document the GPUI settings architecture, and add privacy-focused tests or source checks where persistent logging/storage behavior changes.

## Progress Log

### 2026-06-24-10:41 Orchestrator

- Created the settings parity coordination file from the active goal objective.
- Recorded the current macOS source-of-truth files and the GPUI implementation queue.
- No product implementation or verification commands were run in this step.

### 2026-06-24-10:50 Worker 1 - Shared GPUI Settings Service

- User-facing behavior delivered: GPUI now reads the existing shared sidebar settings file through one Rust service contract for runtime sidebar flags, Browser feedback tool selection, project-editor auto-sleep durations, and sidebar double-click reset width, preserving the current `GHOSTEX_HOME/state/native-sidebar-settings.json` source of truth and the existing `.ghostex` default root.
- High-level technical approach: added a focused GPUI Rust settings module that loads object-shaped shared settings snapshots, parses only the fields GPUI currently consumes, exposes a monotonic in-memory revision/hash snapshot, and provides a future `updateSettings` write path with JSON-object validation, state-directory creation, atomic temp-file rename, and byte-identical write skipping.
- Files touched: `gpui/src/shared_settings.rs`, `gpui/src/main.rs`, `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: Settings UI/modal packaging and launch flow are still unimplemented; no GPUI `updateSettings` bridge calls the new write path yet; settings side-effect fan-out beyond the current consumers remains future work.
- Validation: added focused local Rust unit tests for path selection and write/no-op behavior, but did not run tests or other verification commands per slice instructions.

### 2026-06-24-10:58 Worker 2 - GPUI Modal Host Packaging And Launch Flow

- User-facing behavior delivered: the GPUI Settings modal route opens Settings in the real shared React app-modal host instead of a GPUI-only or stub settings surface. Sidebar-origin app-modal/openSettings messages are routed to the same owned GPUI CEF modal window path, and the modal host entry is available beside the GPUI sidebar CEF bundle.
- High-level technical approach: reused `native/sidebar/modal-host.tsx` through `gpui/modal-host.html`, kept `modal-host.html` in the GPUI Vite CEF entry set, added a first-party CEF `ghostexAppModalHost` bridge for the bundled modal host and sidebar entries, opened/reused a centered GPUI window with an owned `CefSurface`, and sent a minimal Settings-compatible sidebar hydrate payload before the modal open message.
- Files touched: `gpui/src/main.rs`, `gpui/src/cef/macos.rs`, `gpui/SETTINGS_PARITY_PROGRESS.md`. This slice also relies on the current dirty `gpui/vite.config.ts`, `gpui/modal-host.html`, and `gpui/src/cef/unsupported.rs` modal-host bridge/package entry work already present in the worktree.
- Remaining gaps: `updateSettings` persistence/fan-out is not wired yet; Settings status/action bridges are still minimal; the minimal hydrate payload intentionally carries empty sidebar/project/status collections; command palette and hotkeys share the launcher but were not validated in this slice.
- Validation: not run per slice instructions; no build, test, app restart, or `bun run start` command was run.

### 2026-06-24-11:09 Stabilization - Settings Titlebar Modal Route

- User-facing behavior adjusted: the GPUI titlebar Settings glyph now opens the Settings/Hotkeys/Command Palette NativeMenu; choosing Settings still opens the shared React Settings modal through the owned GPUI CEF app-modal window.
- High-level technical approach: kept the existing shared modal-host launcher and minimal Settings hydrate payload, but routed titlebar menu items through typed GPUI actions so Settings is not the only reachable app-modal entry from the titlebar.
- Files touched: `gpui/src/main.rs`, `gpui/src/cef/macos.rs`, `gpui/modal-host.html`, `gpui/TITLEBAR_APP_MODAL_PARITY_PROGRESS.md`, and `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: `updateSettings` persistence/fan-out, Settings action bridges, and full settings side effects are still future slices.
- Validation: no verification commands were run; no build, test, format, typecheck, app launch/restart, browser automation, or `bun run start` command was run.

### 2026-06-24-11:14 Worker 3 - GPUI `updateSettings` Persistence Bridge

- User-facing behavior delivered: the real React Settings modal host can now save Settings through GPUI. Object-shaped `updateSettings` payloads are persisted to the shared sidebar settings store, open Settings windows receive a fresh `sidebarState` hydrate message with the saved settings object/revision, and mounted sidebar CEF runtime debug/beta flags refresh immediately after save.
- High-level technical approach: handled both direct app-modal `updateSettings` messages and the modal-host `sidebarCommand` wrapper, wrote settings through the central GPUI shared settings service object path, reused the saved snapshot to refresh project-editor auto-sleep scheduling and sidebar runtime settings, and tightened GPUI app-modal hydration to build from the shared settings service snapshot instead of rereading the JSON file ad hoc.
- Files touched: `gpui/src/main.rs`, `gpui/src/shared_settings.rs`, `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: Settings action/status bridges for Ghostty actions, installers, OS preferences, Portless admin actions, sound preview, and local status probes are still explicit GPUI no-ops; broader settings side-effect parity such as terminal/Ghostty/theme/notifications/keep-awake/gxserver fan-out remains for later slices.
- Validation: not run per slice instructions; no build, test, app restart, or `bun run start` command was run.

### 2026-06-24-11:19 Worker 3 - Settings Hydration And UpdateSettings Persistence Bridge

- User-facing behavior delivered: Settings saves now refresh the open GPUI Settings modal hydrate, the sidebar debug/beta runtime bridge, Manage availability/CEF visibility fallback, project-editor auto-sleep scheduling, and GPUI controls that read current settings during render, including Browser feedback/profile toolbar controls.
- High-level technical approach: reviewed the existing partial bridge and kept direct `{ type: "updateSettings", settings }` messages plus wrapped `{ type: "sidebarCommand", message: { type: "updateSettings", settings } }` messages on the same object-only persistence path. Successful saves reuse the shared settings service snapshot for post-save hydrate and repaint current GPUI-owned settings consumers without adding fallback/default writes, raw payload logging, or broad future settings side effects.
- Files touched: `gpui/src/main.rs`, `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: Settings action/status bridges, gxserver agent settings sync, Portless/code-server runtime sync, full Ghostty config generation/reload, Previous Sessions/daemon/resources, and broader settings fan-out remain future slices.
- Validation: no verification commands were run; no cargo check/test/fmt, bun/npm test/build/typecheck, app launch/restart, browser automation, or `bun run start` command was run.

### 2026-06-24-11:27 Worker 4A - GPUI Terminal/Ghostty Settings Fan-Out

- User-facing behavior delivered: new or recreated GPUI-owned embedded Ghostty terminal surfaces now use the saved Settings terminal font size for Agents, command, and startup terminal surfaces instead of always leaving embedded Ghostty to its font-size default.
- High-level technical approach: added a focused shared-settings terminal/Ghostty parse layer for `terminalFontSize`, mapped it to the existing `ghostty_surface_config_s.font_size` FFI field, threaded that config into GPUI Ghostty surface config request creation for the three owned terminal surface families, and refreshed existing request maps after `updateSettings` saves without logging raw settings or private terminal data.
- Files touched: `gpui/src/shared_settings.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/main.rs`, `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: only `terminalFontSize` is supported because it is the only current shared terminal setting with a safe direct field on the embedded surface FFI request. Font family, themes, scrollback, clipboard behavior, mouse behavior, and full Ghostty config-file generation/reload remain future work. Existing live Ghostty surfaces are not reloaded by this slice; updated request maps affect subsequent surface creation/recreation.
- Verification: no verification commands were run; no cargo check/test/fmt, bun/npm test/build/typecheck, app launch/restart, browser automation, or `bun run start` command was run.

### 2026-06-24-11:35 Worker 4 - Live GPUI Sidebar Settings Handoff

- User-facing behavior delivered: the mounted GPUI React SidebarApp now receives the saved shared Settings object through the sidebar-only CEF runtime bridge on initial install and Settings-save refresh, so sidebar HUD behavior such as completion bell/sound, close buttons, double-click actions, agent manager zoom, and sidebar theme can reflect saved preferences instead of hardcoded GPUI defaults. Manage availability remains gated only by strict boolean `debuggingMode` and `showBetaFeatures`.
- High-level technical approach: widened the sidebar runtime settings snapshot with a bounded serialized saved-settings payload, parsed that payload into `window.ghostexGpui.runtimeSettings.settings` in the renderer bridge/helper, serialized the snapshot from the central `shared_settings` service, refreshed the sidebar CEF when either booleans or saved settings change, and normalized the incoming object in TypeScript with `normalizeghostexSettings` before building `hud.settings` and settings-backed HUD fields.
- Files touched: `gpui/src/cef/macos.rs`, `gpui/src/cef/unsupported.rs`, `gpui/src/bin/ghostex_gpui_cef_helper.rs`, `gpui/src/main.rs`, `gpui/sidebar/phase1-active-project-context.ts`, `gpui/sidebar/phase1-gxserver-runtime.ts`, `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: broader settings fan-out is still not complete, including terminal/Ghostty config reloads, notification/keep-awake/AppShots behavior, gxserver/Portless/code-server settings sync, and Settings action/status bridges. The GPUI app-modal hydrate still carries a minimal HUD shell around the saved settings object.
- Validation: not run per slice instructions; no build, test, typecheck, format, app restart, browser automation, or `bun run start` command was run.

### 2026-06-24-11:36 Worker 5A - Settings Status And Action Bridge Parity

- User-facing behavior delivered: GPUI Settings status rows now receive real `sidebarState` responses instead of hanging on no-op commands. CLI status refresh reads PATH, Ghostex-owned skill files, Cua Driver presence, and T3 runtime presence; folder stats scans immediate child directories of the GPUI-resolved Ghostex home; OS Integration returns an honest unavailable Launch Services status; agent hook status returns a read-only command-presence snapshot plus an explicit gxserver/macOS limitation. Installer/system actions paired with these statuses now refresh the relevant status with an unsupported message instead of pretending success or leaving spinners active.
- High-level technical approach: replaced the relevant entries in the app-modal unsupported-command matcher with explicit GPUI sidebar-command branches, added contract-shaped Rust payload builders, and added a transient app-modal `sidebarState` dispatch path so status messages clear React loading states without replacing the stored full Settings hydrate snapshot.
- Files touched: `gpui/src/main.rs`, `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: GPUI still does not mutate CLI links, install/uninstall skills or hooks, install Cua Driver, inspect provider-specific hook configs through gxserver, prompt/check Cua privacy grants, open system preference panes, or own Launch Services defaults. OS Integration status is intentionally unavailable until a GPUI Launch Services bridge exists.
- Validation: not run per slice instructions; no cargo check/test/fmt, bun/npm test/build/typecheck, app launch/restart, browser automation, or `bun run start` command was run.

### 2026-06-24-11:39 Worker 5 - GPUI Gxserver Agent Settings Fan-Out

- User-facing behavior delivered: editing `agentAcceptAllEnabled` or `defaultPromptAgentId` in the GPUI Settings modal no longer remains local-only. After the shared Settings save succeeds, GPUI posts the gxserver-owned agent launch policy to local gxserver and keeps the saved local render cache visible if gxserver/token/network is unavailable.
- High-level technical approach: added focused Rust parsing for the two gxserver-owned agent settings with the same defaults and bounded normalization as the shared TypeScript settings schema, compared previous and next snapshots after `updateSettings`, reused the existing local gxserver bearer-token HTTP RPC helper for `/api/updateAgentSettings`, parsed successful RPC responses, and reconciled canonical daemon values back through the central shared settings service before refreshing modal/sidebar runtime state again.
- Files touched: `gpui/src/main.rs`, `gpui/src/shared_settings.rs`, `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: startup-time seeding from an unpersisted gxserver agent-settings record is still macOS-only; GPUI does not yet read `/api/readAgentSettings` on app startup to hydrate the render cache from daemon state before Settings opens. Broader code-server, full Portless/admin, notification, keep-awake, AppShots, and live Ghostty config reload fan-out remain future work.
- Validation: not run per slice instructions; no cargo check/test/fmt, bun/npm test/build/typecheck, app launch/restart, browser automation, or `bun run start` command was run.

### 2026-06-24-11:48 Worker 6 - GPUI Portless Settings/Status Bridge

- User-facing behavior delivered: GPUI Settings Portless enable/protocol changes now post contract-shaped metadata updates to local gxserver, the setup prompt Disable path persists `portlessEnabled: false` before sending `setEnabled false`, and Portless admin action messages record an honest failed admin result instead of pretending GPUI ran privileged setup/removal.
- High-level technical approach: replaced ad hoc Portless JSON request construction with bounded Rust enums/parsers for enabled default semantics, HTTP/HTTPS protocol, and the four admin actions; reused the existing localhost gxserver token/RPC helper for `/api/updatePortlessState`; parsed successful gxserver update results into the existing `hud.portless` sidebar hydrate shape so the open Settings modal refreshes from canonical status/presentation metadata.
- Files touched: `gpui/src/main.rs`, `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: GPUI still has no real native privileged Portless admin bridge, so install/reconfigure/retry/remove are recorded as failed metadata-only results; generic Settings hydration still uses a short health read and does not fetch full Portless presentation until an update RPC succeeds; code-server, notification, keep-awake, AppShots, and live Ghostty config reload fan-out remain future work.
- Validation: not run per slice instructions; no cargo check/test/fmt, bun/npm test/build/typecheck, app launch/restart, browser automation, or `bun run start` command was run.

### 2026-06-24-11:59 Worker 7 - Non-Privileged Settings Action Bridges

- User-facing behavior delivered: GPUI Settings no longer silently swallows the remaining immediate action buttons. Ghostty docs and macOS preference buttons use hardcoded OS-open targets; Open Ghostex Folder opens the GPUI-resolved support folder; completion sound previews use validated bundled sound filenames when a local asset/player is available; Ghostty recommended/default buttons mutate the shared Settings object and refresh consumers; notification permission, Ghostty config file, and gte install return explicit unsupported status/toast feedback instead of fake success.
- High-level technical approach: added transient app-modal message dispatch for sidebarState/toast responses, bounded OS opener helpers with fixed executables and suppressed stdio, validated completion sound asset resolution from app/sidebar resources or local repo media, central shared-settings helpers for the exact visible Ghostty keys React updates, and removed the handled commands from the unsupported no-op matcher.
- Files touched: `gpui/src/main.rs`, `gpui/src/shared_settings.rs`, `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: GPUI still does not own a real notification permission API, native notification delivery, a safe Ghostty config-file writer/reloader, packaged GPUI sound resources, or a bounded gte/Homebrew installer bridge. Custom transient status payloads are currently paired with visible toasts because the shared React modal does not yet render dedicated notification/sound/action status rows.
- Validation: not run per slice instructions; no cargo check/test/fmt, bun/npm test/build/typecheck, app launch/restart, browser automation, or `bun run start` command was run.

### 2026-06-24-12:10 Worker 8 - Packaged Completion Sound Assets

- User-facing behavior delivered: packaged macOS GPUI builds now include the existing completion MP3 files under the runtime-trusted `Contents/Resources/sidebar/sounds` directory, so Settings sound preview and test-agent-completion can find the same bundled assets that local GPUI runs find in `media/sounds`.
- High-level technical approach: kept Worker 7's runtime filename allowlist unchanged, added an explicit deterministic completion-sound asset list to the GPUI macOS packager, validated every expected repository source MP3 before any build/package work, and copied only those files into the sidebar resource sound directory after the sidebar bundle sync.
- Files touched: `gpui/scripts/build-macos-app.sh`, `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: no runtime behavior gap is expected for packaged sound asset discovery after packaging, but a full packaged app build and audio playback check were intentionally deferred. Broader non-sound Settings parity gaps such as notification permission, Ghostty config writing, gte install, code-server, Portless admin, and gxserver startup hydration remain outside this slice.
- Validation: ran `bash -n gpui/scripts/build-macos-app.sh` and a scoped source MP3 count; did not run build/test/typecheck, package the app, launch/restart the app, verify audio playback, or run `bun run start`.

### 2026-06-24-12:14 Worker 9 - GPUI Gxserver Agent Settings Startup Hydration

- User-facing behavior delivered: GPUI now reconciles gxserver-owned `agentAcceptAllEnabled` and `defaultPromptAgentId` during app startup and when Settings opens, so a persisted daemon policy can replace stale local render-cache values and an unpersisted daemon row is seeded from the current local Settings values.
- High-level technical approach: added a bounded `/api/readAgentSettings` RPC parser for `isPersisted` plus the two known settings, a pure seed/apply/no-op decision helper, a runtime in-flight guard to avoid concurrent first-row seeding, a stale-apply guard for saves that happen while hydration is in flight, and a background startup/open reconciliation path that reuses `update_gpui_gxserver_agent_settings`, `apply_gpui_gxserver_agent_settings_to_local_settings`, and `refresh_gpui_shared_settings_consumers_after_save`.
- Files touched: `gpui/src/main.rs`, `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: no broader gxserver fan-out was added; code-server runtime startup/restart, Ghostty config writing/reload, notification permission, Keep Awake, AppShots, Portless admin, installers, and unrelated settings slices remain outside this worker's scope.
- Validation: added focused unit tests for read response parsing and seed/apply decision logic, but did not run tests, cargo check/fmt, app launch/restart, browser automation, or `bun run start` per active slice constraints.

### 2026-06-24-12:22 Worker 9A - Settings Entry App-Modal Routes

- User-facing behavior delivered: GPUI can now open the shared Settings modal directly to Configure Agents, Configure Actions, and Open Targets from command-palette/app-modal bridge messages, titlebar Settings menu actions, and hotkey action ids.
- High-level technical approach: extended the GPUI app-modal kind mapping with the existing shared modal ids, kept them Settings-sized and sidebar-hydrated, reused the React modal host's modal-id-to-initial-tab logic, and triggered the same gxserver agent-settings reconciliation used by Settings-compatible opens.
- Files touched: `gpui/src/main.rs`, `gpui/TITLEBAR_APP_MODAL_PARITY_PROGRESS.md`, `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: no new Settings status/action bridges, native Open Target execution, code-server, Ghostty reload, Portless admin, notification, or installer parity was added in this slice.
- Validation: no verification commands were run; no cargo check/test/fmt, bun/npm build/typecheck/test, app launch/restart, browser automation, or `bun run start` command was run.

### 2026-06-24-12:24 Worker 10 - Bounded GPUI Ghostty Config File Parity

- User-facing behavior delivered: GPUI Settings now writes the bounded managed Ghostty config file for normal terminal setting saves, Apply recommended, and Reset Ghostty defaults, while Open Ghostty config creates/opens the selected config file instead of reporting unsupported. Status/toast copy is explicit when file writes or opens fail and does not expose raw paths.
- High-level technical approach: added a GPUI Rust Ghostty config helper that selects only the macOS Application Support candidates in order, defaults to `com.mitchellh.ghostty/config.ghostty` when none exist, atomically writes the selected file, ports the shared managed-key/keybind/palette merge semantics, and maps the shared terminal config-backed Settings fields into Ghostty lines with macOS-style formatting. The GPUI handler writes generated managed terminal lines only when config-backed terminal settings changed.
- Files touched: `gpui/src/shared_settings.rs`, `gpui/src/main.rs`, `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: no live embedded Ghostty reload was added because the current GPUI GhosttyKit wrapper exposes config load/create and surface/app lifecycle calls but no safe config reload/update FFI. Written config affects external Ghostty reloads and future/recreated GPUI surfaces.
- Validation: added focused Rust unit tests for path selection, managed config action merge semantics, generated terminal config merge formatting, and runtime-only image-paste change detection. `cargo test ghostty_ -- --nocapture` from `gpui/` was attempted but did not run tests because the crate currently fails to compile in an unrelated Project Board image response match in `gpui/src/main.rs`. `rustfmt --check src/shared_settings.rs` parses the file but still reports pre-existing formatting diffs outside the new Ghostty helper additions.

### 2026-06-24-12:26 Worker 10A - Agents Hub App-Modal Route

- User-facing behavior delivered: GPUI can now open Agents Hub from the shared command palette/app-modal bridge and the typed Settings utility menu, with the modal receiving the normal sidebar hydrate for settings-backed UI while requesting its filesystem catalog separately.
- High-level technical approach: added a production `agentsHub` app-modal route plus real Rust sidebarCommand handlers for catalog, file-content, save, and open actions. Catalog rows are metadata-only, selected files are validated against the current catalog before read/write/open, and OS opener calls use fixed executables with suppressed stdio.
- Files touched: `gpui/src/main.rs`, `gpui/TITLEBAR_APP_MODAL_PARITY_PROGRESS.md`, `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: no verification was run in this workflow, and GPUI still uses the OS default opener for external file edits rather than a user-configured editor command bridge.
- Validation: no verification commands were run; no cargo check/test/fmt, bun/npm build/typecheck/test, app launch/restart, browser automation, or `bun run start` command was run.

### 2026-06-24-12:37 Worker 10B - Agents Hub Default Editor Settings Bridge

- User-facing behavior delivered: GPUI Agents Hub external edit now follows the saved Settings default editor command instead of opening the selected file with the OS default app.
- High-level technical approach: added a focused Rust parser for `defaultEditorCommand` and `customDefaultEditorCommand`, including the `other` custom-command fallback to `code`, then reused that normalized command in the GPUI Agents Hub bridge after catalog validation. VS Code-compatible commands receive `--reuse-window <folder> --goto <file>:1:1`, Zed-compatible commands receive `--existing <folder> <file>:1:1`, and other commands receive `<folder> <file>`.
- Files touched: `gpui/src/shared_settings.rs`, `gpui/src/main.rs`, `gpui/TITLEBAR_APP_MODAL_PARITY_PROGRESS.md`, `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: no UI/runtime verification was run in this workflow; shell availability and editor CLI behavior were not exercised.
- Validation: no verification commands were run; no cargo check/test/fmt, bun/npm build/typecheck/test, app launch/restart, browser automation, or `bun run start` command was run.

### 2026-06-24-12:44 Worker 11 - Bounded macOS Attention Notification Parity

- User-facing behavior delivered: GPUI Settings now has a real macOS notification permission bridge for the permission button and test-agent-completion action. The permission path reads current macOS authorization, requests alert authorization only when status is not determined, reports denied permission with copy pointing users to the existing macOS Notification Settings action, and returns visible `notificationPermissionStatus` plus action/toast feedback. The test action keeps the existing completion sound preview behavior and, when `showMacOSAttentionNotifications` is enabled, sends one generic no-sound macOS banner with fixed safe title/body text.
- High-level technical approach: added a GPUI-local UserNotifications Objective-C shim compiled by `gpui/build.rs`, linked `UserNotifications`, mapped native authorization/delivery result codes into Rust enums, and kept Rust handlers limited to Settings status payloads and action feedback. The shim sets a foreground presentation delegate for banners but does not add project icons, session ids, click-to-focus routing, project/session names, paths, URLs, command text, terminal output, raw errors, or persistent logs.
- Files touched: `gpui/native/macos/GpuiSettingsNotifications.m`, `gpui/build.rs`, `gpui/src/main.rs`, `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: no global session attention notification routing, delivered-notification cleanup, click-to-focus behavior, project icon attachment, or running-app verification was added. Packaged/raw-binary notification identity and actual banner presentation still need runtime validation in a later app-verification pass.
- Validation: added focused pure Rust unit tests for notification permission payload/status mapping and test-action message mapping. Ran a scoped Objective-C syntax check for the new shim and `rustfmt --check gpui/build.rs`; did not run cargo check/test/fmt for the GPUI crate, app launch/restart, browser automation, or `bun run start`.

### 2026-06-24-12:50 Worker 11 - Titlebar Open In Settings Consumption

- User-facing behavior delivered: GPUI now consumes the existing shared Open Targets settings for the titlebar Open In folder control, so hidden built-ins, detected available targets, resolved commands/app names, and custom targets affect the native GPUI Open In menu and launcher.
- High-level technical approach: read the current shared settings snapshot at menu/launch time, ported only the shared Open In catalog/normalization needed by the titlebar runtime, kept Configure routed to the existing shared Open Targets Settings modal, and avoided adding new Settings persistence or logging behavior.
- Files touched: `gpui/src/main.rs`, `gpui/TITLEBAR_APP_MODAL_PARITY_PROGRESS.md`, `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: this slice did not add new settings fan-out, target detection refresh, or Settings UI changes; it only made the titlebar button honor the already-hydrated shared settings fields.
- Validation: no verification commands were run; no cargo check/test/fmt, bun/npm build/typecheck/test, app launch/restart, browser automation, or `bun run start` command was run.

### 2026-06-24-12:56 Worker 12 - GPUI CLI And Bundled Skill Actions

- User-facing behavior delivered: GPUI Settings now performs real bounded Ghostex CLI repair from packaged `Contents/Resources/CLI` resources when available, reports explicit unavailable status for unpackaged/development runs without bundled CLI resources, installs the four bundled Ghostex skills through fixed `ghostex <namespace> install-skill` commands, and uninstalls only the four known bundled skill directories under `~/agents/skills`.
- High-level technical approach: replaced the six Settings placeholders with one background action runner that dispatches refreshed `ghostexCliStatus`, action status, and toast payloads through the existing app-modal bridge. CLI repair writes wrapper files outside the app, includes the `CDXC:CliInstall 2026-06-12-09:31` marker, replaces only marked Ghostex wrappers, app-owned CLI symlinks, or broken symlinks, treats `ghostex` as required while allowing `gx` to be blocked, suppresses child stdout/stderr, and clears macOS execution-policy xattrs opportunistically. The GPUI macOS packager now stages the CLI module, public launchers, and bundled skill folders under `Contents/Resources/CLI`.
- Files touched: `gpui/src/main.rs`, `gpui/scripts/build-macos-app.sh`, `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: this slice did not implement Cua Driver install, Homebrew/gte install, Portless admin, Keep Awake, AppShots, code-server, Ghostty, notification, hook, or OS-default action work. Runtime validation from a packaged `.app` is still needed to prove the CLI wrappers and skill installer end-to-end on a real user PATH.
- Validation: ran `bash -n gpui/scripts/build-macos-app.sh` and a scoped CLI resource existence check successfully. `cargo check --manifest-path gpui/Cargo.toml --bin ghostex-gpui` did not reach the GPUI crate because the local Zed `gpui_util` dependency currently fails on unstable `slice_as_array` with this toolchain. `rustfmt --check --edition 2024 gpui/src/main.rs` parsed the touched Rust but exited with formatting diffs across existing GPUI module files. No app launch/restart, package build, broad test run, browser automation, or `bun run start` command was run.

### 2026-06-24-13:08 Worker 12 Follow-up - Strict CLI Execution Ownership

- Correction: tightened the Ghostex CLI ownership predicate used before bundled skill installs. Settings now accepts only marked wrappers containing `CDXC:CliInstall 2026-06-12-09:31` plus `ghostex-cli.mjs`, or app-owned command realpaths recognized by the CLI repair ownership helper; broad file text such as `Ghostex CLI` no longer authorizes execution.

### 2026-06-24-13:19 Worker 13 - Desktop Control / Cua Driver Settings Parity

- User-facing behavior delivered: GPUI Settings now runs the real Desktop Control install action using the official trycua Cua Driver installer, then attempts to install the bundled Ghostex Computer Use skill, and reports complete, failed, or driver-only partial setup through refreshed `ghostexCliStatus`, `settingsActionStatus`, and toast payloads.
- High-level technical approach: replaced the `installCuaDriver` placeholder with the existing bounded GPUI Settings action pipeline, ran `/bin/bash -lc 'curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh | /bin/bash'` with a ten-minute timeout and suppressed child output, reused the fixed Ghostex CLI skill helper for Computer Use, and added a read-only five-second `cua-driver check_permissions {"prompt":false}` status probe that parses Accessibility and Screen Recording booleans while mapping raw output to generic permission detail.
- Files touched: `gpui/src/main.rs`, `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: runtime validation against an installed Cua Driver and a packaged GPUI app was not performed, and the installer still depends on network availability plus the current PATH-visible `ghostex` command for the follow-up Computer Use skill install. Homebrew/gte install, Portless admin, Keep Awake, AppShots, code-server, Ghostty, OS Launch Services defaults, and notification routing remain outside this slice.
- Validation: added focused pure Rust tests for Cua permission parsing and sanitized status mapping. `cargo test --manifest-path gpui/Cargo.toml gpui_cua_permission -- --nocapture` did not reach the tests because the local Zed `gpui_util` dependency currently fails on unstable `slice_as_array`. `rustfmt --check --edition 2024 gpui/src/main.rs` parsed the touched Rust but exited with pre-existing formatting diffs across GPUI module files. No app launch/restart, browser automation, installer execution, Cua Driver permission prompt, or `bun run start` command was run.

### 2026-06-24-13:16 Worker 14 - Keep Awake Shared Settings Consumption

- User-facing behavior delivered: GPUI now honors the shared Keep Awake beta gate, titlebar hide preference, default duration normalization, and allow-display-sleep setting for the titlebar Keep Awake runtime slice.
- High-level technical approach: added a narrow Rust parser for `showBetaFeatures`, `hideKeepAwakeTitlebarControl`, `keepAwakeDefaultDurationMinutes`, and `keepAwakeAllowDisplaySleep`, matching the shared Settings defaults and strict boolean semantics without cloning the full TypeScript settings model.
- Files touched: `gpui/src/shared_settings.rs`, `gpui/src/main.rs`, `gpui/TITLEBAR_APP_MODAL_PARITY_PROGRESS.md`, and `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: this settings slice does not add the macOS-only Keep Awake automation settings for lid-close, external display, battery, low-power, user-switch, delayed-send, or working-session behavior to GPUI runtime.
- Validation: no verification commands were run; no cargo check/test/fmt, bun/npm build/typecheck/test, app launch/restart, browser automation, or `bun run start` command was run.

### 2026-06-24-13:28 Worker 14 - GPUI gte Homebrew Install Action

- User-facing behavior delivered: the GPUI Settings `installGte` action now runs the real fixed Homebrew install flow and reports only concise success or generic failure copy. Success says `gte installed from Homebrew.`; Homebrew missing, install failure, spawn failure, and timeout all report `gte install failed. Install Homebrew or run brew install maddada/tap/gte in a terminal.` without raw Homebrew output.
- High-level technical approach: replaced the unavailable placeholder with a background GPUI action that runs `/bin/zsh -lc` using the same Homebrew resolution order and `maddada/tap/gte` install command as macOS Settings, bounded to five minutes through the existing stdio-suppressed timeout helper. React supplies no command text, path, URL, or environment input, and the action does not change `promptEditorBackend`.
- Files touched: `gpui/src/main.rs`, `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: no runtime Homebrew install was executed in this worker, so packaged-app UI behavior and real Homebrew success/failure paths still need manual/runtime validation later. No dedicated gte status contract was added because this slice only wires the existing action.
- Validation: added focused pure Rust tests for fixed command construction and sanitized success/failure mapping. `git diff --check -- gpui/src/main.rs gpui/SETTINGS_PARITY_PROGRESS.md` passed. `cargo test --manifest-path gpui/Cargo.toml gpui_gte_ -- --nocapture` did not reach the tests because the local Zed `gpui_util` dependency fails on unstable `slice_as_array`; `rustfmt --check --edition 2024 gpui/src/main.rs` parsed but failed on pre-existing formatting diffs across GPUI module files. No app launch/restart, broad cargo check/test, browser automation, installer execution, or `bun run start` command was run.

### 2026-06-24-13:36 Worker 15 - Remote Machines Password Save/Remove Parity

- User-facing behavior delivered: GPUI Settings now handles the shared `saveRemoteMachinePassword` command for Remote Machines. Non-empty passwords are saved to macOS Keychain and mark the existing machine with `sshPasswordSaved: true`; empty passwords delete the Keychain item and remove the marker. Success and failure toasts use generic copy without machine names, hosts, users, paths, command text, raw OSStatus values, or password content.
- High-level technical approach: added bounded `remote-[a-z0-9_-]+` id validation, a GPUI-local Security/SecItem Objective-C shim using service `com.madda.ghostex.remote-ssh-password` and account `remoteMachineId`, Rust marker mutation through the central shared settings service, modal/sidebar refresh after marker writes, and silent best-effort cleanup for deleted saved Remote Machines after normal `updateSettings` saves.
- Files touched: `gpui/src/main.rs`, `gpui/native/macos/GpuiSettingsNotifications.m`, `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: no real Keychain write/delete was executed during validation, and no packaged app/UI runtime pass was run. Non-macOS GPUI builds report unsupported for explicit password saves without changing the settings marker.
- Validation: added focused pure Rust tests for id validation, settings-marker mutation, and removed-id detection. `xcrun clang -target arm64-apple-macos13.0 -fobjc-arc -fmodules -fsyntax-only gpui/native/macos/GpuiSettingsNotifications.m` passed with only the pre-existing notification deprecation warning. `cargo test --manifest-path gpui/Cargo.toml gpui_remote_machine -- --nocapture` did not reach the tests because the local Zed `gpui_util` dependency fails on unstable `slice_as_array`. No app launch/restart, browser automation, broad cargo check/test, real Keychain operation, or `bun run start` command was run.

### 2026-06-24-13:49 Worker 16 - Agents And Actions Metadata Writes

- User-facing behavior delivered: GPUI Settings can now save, delete, and reorder Agents and Actions from the shared Settings modal. Agent edits persist as shared daemon metadata, Actions persist for the active project owner, hidden default Agents can be restored, default Actions can be removed and restored, duplicate Action titles are rejected, and successful writes refresh the open Settings hydrate plus titlebar Actions without an app restart.
- High-level technical approach: reused the existing GPUI Settings hydrate normalizers for stored Agents and Actions, added bounded Rust handlers for the six shared metadata commands, fan-out wrote normalized Agent state to every known daemon project row, resolved worktree Action writes to the parent owner row, kept terminal-vs-browser Action validation strict, and used generic failure toasts without durable private data.
- Files touched: owned GPUI Rust entrypoint, one adjacent CEF compile-only clone fix, and this parity ledger.
- Remaining gaps: remote reconnect was not implemented. Runtime UI validation in a launched app was not performed.
- Validation: whitespace diff check passed for the owned files. The normal GPUI Rust check still stops in an external unstable dependency gate with the current toolchain, while a gated GPUI Rust check reached the local binary and passed with existing dead-code warnings only. No app launch/restart, browser automation, broad test run, or app refresh command was run.

### 2026-06-24-14:09 Worker 16 Follow-up - Pure Metadata Tests

- Added focused pure unit coverage for default Agent hide/restore, default Action deletion/restoration, worktree Action owner resolution, duplicate Action title rejection, and Agent/Action order-sync result payloads.
- Validation: the normal focused test command still stops in the external unstable dependency gate before local tests. The gated focused test command ran the five new tests successfully with existing dead-code warnings only. Scoped whitespace checks passed for the owned files and the compile-only adjacent CEF fix.

### 2026-06-24-15:19 Main - Remote Reconnect Command Parity

- User-facing behavior delivered: GPUI Settings now handles `reconnectRemoteMachine` from the shared Remote Machines tab. It starts the saved remote gxserver over SSH, reads the remote auth token, stores the token in macOS Keychain, opens an authenticated localhost tunnel, reports success/failure through Settings toasts, and opens the existing install-approval modal when gxserver is missing and approval has not been granted.
- High-level technical approach: added bounded shared-settings parsing for saved Remote Machine SSH fields, a macOS askpass helper that reads the saved SSH password from Keychain, Swift-parity SSH options/login-shell token command, marker-based token extraction and validation, delete-then-add Keychain token storage under `com.madda.ghostex.remote-gxserver-token`, checked tunnel health against `/api/health/server`, and runtime cleanup for replaced/dropped tunnel processes. The React command remains limited to machine id plus install approval; raw host/user/path/password/token/command/stdout/stderr data is not logged or returned.
- Files touched: `gpui/src/main.rs`, `gpui/native/macos/GpuiSettingsNotifications.m`, `gpui/SETTINGS_PARITY_PROGRESS.md`.
- Remaining gaps: approved remote install reports unavailable in GPUI until the GPUI app bundle stages target-matched remote gxserver package resources equivalent to the macOS app. Remote presentation subscriptions, remote project browse/add commands, and real UI/runtime SSH validation remain future slices.
- Validation: `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml gpui_remote -- --nocapture` passed seven focused tests. `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml --bin ghostex-gpui` passed with existing dead-code warnings. `xcrun clang -target arm64-apple-macos13.0 -fobjc-arc -fmodules -fsyntax-only gpui/native/macos/GpuiSettingsNotifications.m` passed with the existing notification deprecation warning. `git diff --check -- gpui/src/main.rs gpui/native/macos/GpuiSettingsNotifications.m gpui/SETTINGS_PARITY_PROGRESS.md` passed. No app launch/restart, browser automation, real SSH connection, real Keychain token write, package install, or `bun run start` command was run.
