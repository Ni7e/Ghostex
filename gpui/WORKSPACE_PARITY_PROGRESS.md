# GPUI Workspace Parity Progress

<!--
CDXC:GPUIWorkspaceParity 2026-06-22-05:07:
GPUI workspace parity is being ported from the current macOS app in small sequential agent slices. Keep this file as the coordination log so each agent records the exact user-facing behavior it changed, the files it touched, and the remaining gaps without editing the regular macOS app.

CDXC:GPUIWorkspaceParity 2026-06-23-14:19:
The orchestration log must now queue exactly one worker at a time, with no parallel planning workers. Future workers should receive larger bounded bundles when dependencies allow, while preserving phase order, privacy, no fallback/project-detection, non-overlap layout, and the current no-validation instruction.

CDXC:GPUIWorkspaceParity 2026-06-23-15:25:
Slice 203 is docs/progress reconciliation only. It moves Phase 1 to source-side handoff status after slices 200-202 and updates Phase 2 terminal handoff language without claiming app validation or resolving terminal runtime clipboard and physical-key blockers.

CDXC:GPUIRuntimeTransfer 2026-06-23-16:02:
Slice 211 keeps cross-surface runtime transfer out of completed parity. Source may represent visible-title, identity, tab, card, and placeholder movement among Agents, command, Browser, Source, Kanban, and Manage, but real runtime/process/content transfer needs an explicit product decision, mount/runtime contracts, privacy proof, and external running evidence.

CDXC:GPUIPhase10BlockerLedger 2026-06-23-16:06:
Slice 212 aligns the source-level Phase 10 blocker ledger with the docs table for Terminal lifecycle activation/reattach and cross-surface runtime/process/content transfer. This records blockers only and must not be read as runtime wake, reattach, process/content transfer, validation, persistence, or logging work.

CDXC:GPUIRuntimeTransfer 2026-06-23-17:25:
Slice 223 splits cross-surface transfer progress into source-only movement evidence and missing gates. Shell movement categories remain Agents/command visible-title placeholders, tab/group/card layout, project-editor identity-only Source/Kanban/gated Manage, Browser profile/tab shell identity preservation, and no-runtime-transfer privacy boundaries; real transfer still needs product, mount/runtime, family-specific, privacy, and running-evidence gates.

CDXC:GPUIProjectWorkareaReadiness 2026-06-23-16:17:
Slice 214 adds strict source-only Kanban/Manage readiness parser/store evidence. It accepts only the exact current active project plus exact Kanban/Manage surface identity and mounting/ready/loadFailed state, and it must not mount CEF web surfaces, perform file I/O, log/persist private details, accept URLs/paths/file names/file contents/failure details, probe fallbacks, replace placeholders, or run validation.

CDXC:GPUIBrowserWorkareaReadiness 2026-06-23-16:24:
Slice 215 adds strict source-only Browser active-project/readiness parser/store evidence outside Phase 1. It accepts only the exact current active project plus exact Browser workarea identity and loading/ready/loadFailed state, keeps browserWorkareaId rejected in the active-project snapshot, and must not mount/materialize CEF, create Browser tabs/profiles/popups, import data, log/persist private details, accept URLs/paths/titles/profile/cookie/history/import/content/failure details, probe fallbacks, replace placeholders, or run validation.

CDXC:GPUIManageFileWorkareaBridge 2026-06-23-16:35:
Slice 216 adds strict source-only Manage file/workarea operation request parser/store evidence separate from readiness. It accepts only the exact current Manage active-project/workarea identity plus operation-name string, stores only the privacy-safe allowlist decision category, and must not run file I/O, mount CEF/file bridges, log/persist private details, accept args/paths/file names/file contents/URLs/tokens/cookies/credentials/env/stdout/stderr/failure details/raw payloads/CEF state/bridge payloads, probe fallbacks, replace placeholders, or run validation.

CDXC:GPUIProjectSidebarBridge 2026-06-23-18:29:
Slice 231 adds the source-only sidebar-scoped safe external bridge into strict Source, Browser, Kanban/Manage readiness stores and the Manage operation-request store. It does not implement real Source CEF/code-server mount, Kanban/Manage CEF or file-bridge mounts, Browser workarea identity, placeholder replacement, privacy proof, validation, or external running evidence.

CDXC:GPUITerminalCloseConfirm 2026-06-23-18:48:
Slice 232 adds the source-side close-confirm UI surface contract for pending Agents and command terminals. The surface is generic, family-scoped, normal-layout only, and wires Keep Open to the existing cancel path; slice 237 supersedes the ABI gap with source-side `needs_confirm_quit` evidence, and slice 239 accepts close-confirm for the source-ledger purpose.

CDXC:GPUITerminalCloseConfirm 2026-06-23-20:04:
Slice 237 adds source-side GhosttyKit `ghostty_surface_needs_confirm_quit` ABI evidence and exact confirmed shell/session removal for GPUI close-confirm prompts. Slice 239 accepts this terminal evidence for the source-ledger purpose while validation remains globally blocked.

CDXC:GPUIWorkspaceParity 2026-06-23-17:30:
Slice 224 is a handoff/status consolidation only. It refreshes the docs queue after slices 218-223 so future work targets real product, bridge, mount, runtime, privacy, or external-evidence gates instead of more source-only ledger splitting, unless a concrete mismatch is found.

CDXC:GPUIWorkspaceParity 2026-06-23-20:44:
Slice 239 records new product decisions for the GPUI parity ledger: source-only runtime parity evidence may count for source-ledger acceptance, terminal source/runtime evidence is accepted as current parity for that ledger, and Kanban/Manage future web surfaces must use CEF while Manage keeps a separate file-bridge contract.

CDXC:GPUIPhase10BlockerLedger 2026-06-23-21:50:
This reconciliation records the newest source-ledger rule: source-only runtime parity is accepted for this effort, the user will runtime-check later, validation/app commands stay outside this agent workflow, and future web panes must target CEF only with Manage file bridge as a separate contract.

CDXC:GPUIProjectWorkareaRuntimeCefSurfaces 2026-06-24-10:12:
Real Source, Kanban, and Manage runtime surfaces are now the active implementation target for GPUI and must use CEF only. App-level wiring may own CefSurface entities and render them in normal layout only when a real runtime URL value plus the existing replacement gates exist; do not add WKWebView/WebKit, fake about:blank/localhost/app-resource-label URLs, temporary pages, hidden/offscreen mounts, fallback probes, private URL persistence/logging, validation commands, app launch/restart, or browser/visual automation.
-->

Source requirements: `../docs/gpui-workspace-area-parity-requirements.md`

Hard constraints:

- Only edit `./gpui` unless the user explicitly asks otherwise.
- Do not edit the regular macOS app.
- Run one subagent at a time only.
- Use `gpt-5.5` with `xhigh` reasoning for every subagent.
- Keep terminal placeholder paths for sleeping, restored, mounting, startup-failed, popped-out, missing, and unresolved runtime states; mounted Ghostty source paths are not running-app verified until validation is allowed.
- Keep Source, Kanban, and Manage as distinct colored placeholder panes only while real URL/process/file-bridge authority and replacement permission are absent; active runtime surface work must be CEF-only and normal-layout-only.
- Match the current macOS app's user-facing workspace behavior and presentation as the source of truth.
- Each agent must append a progress entry before finishing.

## Work Slices

1. Workspace layout model and terminal placeholders
   - Add a GPUI-owned workspace layout model for tabs, splits, leaves, active tab, split ratios, and focused pane.
   - Render Ghostty terminal panes as black placeholder surfaces with native-style tab chrome.
   - Keep multiple sessions in one tab group unless an explicit split action is used.

2. Native tab bar parity
   - Match always-visible tab bars, selected/inactive/sleeping visual states, close affordance, overflow preparation, and action-cluster placeholders.
   - Keep tab bar presentation stable across pane focus changes.

3. Sleeping, mounting, restored, and popped-out placeholders
   - Keep sleeping/restored/mounting/popped-out sessions represented in the layout tree.
   - Implement selected sleeping placeholder behavior without auto-waking.

4. Workspace drag, drop, reorder, and split semantics
   - Support same-strip reorder, center grouping, and left/right/top/bottom edge split intent.
   - Preserve sleeping/restored/unmounted tab identity during drag/drop.

5. Command pane bottom surface
   - Add separate command-pane layout state, pinned/floating/collapsed modes, resize rail, and command terminal black placeholders.
   - Limit command-pane split drops to left/right grouping/splitting.

6. Focus, close, and keyboard behavior
   - Implement directional focus, tab cycling inside focused tab groups, surface-aware close behavior, and reversible Focus mode.

7. Project editor shell and placeholders
   - Add Source, Browser, Kanban, and Manage mode shell behavior.
   - Render Source, Kanban, and Manage as distinct colored placeholder panes.
   - Keep Browser using the existing CEF browser surface for now.
   - Add optional left companion-pane layout behavior.

8. Browser tab strip placeholder parity
   - Add project-browser native tab strip model/presentation above the existing browser toolbar.
   - Preserve tab identity/state at the layout level while continuing to use the current CEF surface as the active browser body.

9. Persistence and polish pass
   - Persist layout-relevant user choices that the macOS app persists.
   - Reconcile visual constants, minimum sizes, reset behavior, and documentation gaps.

## Progress Log

### 2026-06-22-05:07 Main agent

- Created this coordination file and split the parity work into small sequential slices.
- No GPUI behavior has been changed yet in this log entry.

### 2026-06-22-05:16 Task slice 1

- Changed the GPUI Agents mode workspace from the prior browser-body rendering path to a GPUI-owned terminal workspace shell with a terminal session model, tab groups, active tab state, split-node data, split ratios, and focused pane state.
- Rendered the default Agents workspace as one native-style tabbed terminal pane with black Ghostty placeholder content, preserving multiple terminal sessions as ordered tabs in one pane instead of creating implicit split panes.
- Added recursive split rendering support with explicit split-handle layout regions and non-interactive visual separator children for later resize behavior.
- Kept the CEF sidebar mounted and left Browser mode on the existing CEF toolbar/body path, including hiding the browser native view while Agents mode is active.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run: `cargo fmt`; `cargo check`.
- Remaining gaps for later slices: real libghostty mounting, user-created split actions, native tab close/overflow/action affordances, drag/drop/reorder, sleeping/restored placeholders, command pane, keyboard focus traversal, project editor placeholders, browser tab-strip parity, and layout persistence.

### 2026-06-22-05:22 Task slice 2

- Improved the GPUI Agents terminal tab bar chrome while keeping libghostty as a black placeholder surface.
- Kept each pane's tab bar always visible and kept tab selected/inactive colors based on active tab state rather than pane focus.
- Reworked the tab bar into a horizontally scrollable tab strip plus fixed right-side pane action cluster placeholders.
- Added safe per-tab placeholders for terminal icon chrome, status dots, active/inactive styling, and inline no-op close affordances when more than one tab exists.
- Added a compact right-edge reveal marker so overflow behavior has a visible reserved affordance without implementing drag, measurement, or wake infrastructure.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run: `cargo fmt`; `cargo check`.
- Remaining gaps for later slices: real close behavior, tab overflow measurement/reveal behavior, sleeping/restored/mounting/popped-out tab states, drag/drop/reorder, command pane, keyboard shortcuts/focus traversal, project editor placeholders, browser tab-strip parity, real libghostty mounting, and persistence.

### 2026-06-22-05:28 Task slice 3

- Added explicit GPUI Agents terminal presentation states for running, sleeping, mounting, restored/unmounted, and popped-out placeholder sessions.
- Seeded all of those states into the default terminal tab group so every state remains represented in the tab/split layout tree instead of being removed from the tab strip.
- Rendered non-running selected tabs as active tabs with distinct placeholder body states and no-op wake/materialize/reattach affordances, while running sessions continue to render as a black Ghostty placeholder surface.
- Kept tab clicks presentation-only: selecting a sleeping/restored/mounting/popped-out tab focuses the pane and selects the placeholder without changing its state to running.
- Subdued inactive non-running tabs through state badges, icon/status colors, and lower-contrast text without tying tab-bar brightness to pane focus.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`.
- Remaining gaps for later slices: real wake/mount/materialize/reattach behavior, drag/drop/reorder, command pane, project editor placeholders, keyboard shortcuts/focus traversal, actual close behavior, tab overflow measurement/reveal behavior, real libghostty mounting, and persistence.

### 2026-06-22-05:31 Task slice 4

- Added bounded GPUI-native drag/drop for Agents workspace tabs using typed tab drag values, `on_drag`, `on_drag_move`, `can_drop`, and `on_drop`.
- Implemented same-tab-strip reorder only within the source tab group, including a drop-to-end strip target, while preserving the dragged session id and its presentation state record.
- Implemented pane-body center grouping and left/right/top/bottom edge split intent in the in-memory workspace layout model.
- Added split-tree mutation helpers that move the dragged tab into a new leaf for edge drops and collapse an emptied source leaf enough to keep the rendered layout tree valid.
- Added visible drag feedback: tab insertion markers for reorder, a drag preview for the tab, and non-interactive body feedback that distinguishes center grouping from edge splitting.
- Kept command-pane drag/drop, browser CEF drag behavior, real wake/mount, keyboard shortcuts, persistence, project editor placeholders, and libghostty rendering out of this slice.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`.
- Remaining gaps for later slices: persisted layout changes, real libghostty surfaces, real close behavior, command-pane drag/drop, keyboard focus traversal/shortcuts, browser/project editor drag behavior, and fuller visual validation in a running app.

### 2026-06-22-05:47 Task slice 5

- Added a separate GPUI command-pane shell model with command-session ids, active command tab state, pinned/floating/collapsed mode state, remembered last expanded mode, and in-memory height ratio.
- Rendered command terminals as black placeholder bodies in a bottom workspace surface that wraps Agents mode and the current non-Agents project/editor shell without adding command tabs to the normal Agents workspace tab tree.
- Implemented pinned mode as reserved bottom height, floating mode as a visible floating panel above the workspace with a compact bottom strip, and collapsed mode as only the compact bottom command strip while command sessions exist.
- Added compact command tab/titlebar chrome with command tabs, a new-command placeholder button, pin/float toggle, expand/collapse control, and close-panel control that collapses the shell.
- Added a real top resize rail with drag-to-resize, double-click reset, clamped height ratio, and no invisible overlay or hit-test routing.
- Added an F12 shell toggle for expand/collapse; true command focus and previous-workspace focus restoration remain deferred to the keyboard/focus slice.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`.
- Remaining gaps for later slices: real command process/session creation, command-pane tab close behavior, command-pane drag/drop and splits, command focus traversal/restoration, persistence, project editor placeholders, real libghostty mounting, and visual validation in a running app.

### 2026-06-22-05:53 Task slice 6

- Added Manage as a GPUI titlebar mode alongside Agents, Source, Browser, and Kanban.
- Added an in-memory GPUI project-editor shell for non-Agents modes so Source, Browser, Kanban, and Manage replace the main workspace area while the existing command-pane wrapper can still pin, float, or collapse around them.
- Added a simple optional left companion terminal placeholder with a real reserved divider region inside the project-editor shell, without collapse controls, resizing, persistence, routing, or focus restoration.
- Kept Browser on the existing GPUI toolbar plus CEF body path, but changed CEF browser visibility so the browser native surface is shown only when Browser mode is active.
- Rendered Source, Kanban, and Manage as distinct GPUI-colored placeholder panes that do not include or show CEF.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`.
- Remaining gaps for later slices: real code-server/source editor, Browser tab strip parity, Kanban CEF, Manage file bridge and feature gating, project-scoped routing, project-editor persistence, companion-pane resize/reset behavior, project-editor auto-sleep, command focus restoration, real libghostty mounting, and visual validation in a running app.

### 2026-06-22-05:56 Task slice 7

- Added an in-memory Browser tab model for Browser project-editor mode with stable tab ids, title/url state, active tab state, and an address-only placeholder state.
- Rendered a GPUI native-style Browser tab strip above the existing address toolbar while keeping exactly one active CEF browser body.
- Wired Browser tab selection so the active tab, toolbar URL state, address input, and existing CEF surface stay synchronized.
- Added an in-memory new-tab control that creates an address-only placeholder tab and clears the shared CEF body to `about:blank`.
- Added modest close behavior: multi-tab close removes the target and selects a neighboring tab when needed; closing the last tab leaves Browser mode on an address-only placeholder instead of removing the editor content.
- Kept Source, Kanban, and Manage colored placeholders unchanged and did not add multiple CEF views, window.open/history row behavior, GitHub remote seeding, persistence, auto-sleep, or real favicon loading.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`.
- Remaining gaps for later slices: one CEF view per Browser tab, Browser tab persistence/restoration, real sleeping/restored Browser tab lifecycle, history rows, window.open handling, project GitHub remote seeding, real favicon/title updates from page state, auto-sleep, and visual validation in a running app.

### 2026-06-22-06:10 Task slice 8

- Added shell-level GPUI actions and key bindings for placeholder workspace behavior: Ctrl-Tab/Ctrl-Shift-Tab tab cycling, Cmd-W surface-aware close, Ctrl-Cmd-F Agents Focus mode, Cmd-Alt arrows for modest directional focus, while preserving F12 command-pane toggle behavior.
- Added an explicit in-memory shell focus target so keyboard actions distinguish Agents panes, the command pane, Browser, project-editor surfaces, and focused project-editor companions without native hit-test routing or real runtime focus.
- Implemented Agents tab cycling within the focused tab group, including sleeping, mounting, restored/unmounted, and popped-out placeholder tabs without changing their presentation state to running.
- Implemented close behavior for the current placeholder shell: command focus closes the active command placeholder and collapses after the last command session, Browser mode closes the active browser tab, Agents mode closes the active workspace tab and collapses emptied split branches, and Source/Kanban/Manage only hide an explicitly focused companion placeholder.
- Added reversible render-time Agents Focus mode for focused tab groups, with sleeping-only panes excluded from Focus-mode eligibility when counting visible panes.
- Added modest directional focus traversal across rendered Agents leaves by leaf order, with the expanded command pane included as the terminal focus target.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`.
- Remaining gaps for later slices: real spatial focus geometry, real libghostty focus, real command process teardown, root-final workspace tab close/new-session behavior, command-pane split/tab layout parity, persisted Focus mode/layout changes, one CEF view per Browser tab, visual validation in a running app, and broader keyboard shortcut parity.

### 2026-06-22-06:22 Task slice 9

- Replaced the flat command-pane tab list with an in-memory command-pane layout tree made of command tab groups and horizontal left/right split nodes only.
- Kept command terminal sessions separate from Agents workspace terminal sessions by using command-only ids, drag payloads, drop feedback, layout helpers, and render paths.
- Rendered command tab groups recursively inside the existing bottom command-pane shell, with each command group owning its compact tab bar and black command terminal placeholder body.
- Implemented command tab selection within the containing command group, command tab cycling through the focused command group, and group-scoped command tab close buttons.
- Updated command close behavior so closing a tab selects a neighbor in the same command group, collapses empty split branches, and collapses/removes the command panel when the final command terminal placeholder closes.
- Added bounded command-pane drag/drop for expanded command groups: same-group strip drops reorder, center body drops group into the target command group, left/right body drops create horizontal command splits, and top/bottom intent is treated as center grouping.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`.
- Remaining gaps for later slices: real command processes and teardown, command layout persistence, command split resizing/reset behavior, workspace-to-command or command-to-workspace dragging, libghostty mounting, visual validation in a running app, and broader command-pane action parity.

### 2026-06-22-06:27 Task slice 10

- Normalized GPUI workspace presentation constants toward the macOS workspace shell: Agents tab bars are 36px high, workspace tabs remain 172px wide, command titlebars and collapsed command strips are 26px high, and workspace/command rails are 5px real layout siblings with 1px visual separators.
- Changed the command panel's in-memory height default/reset to derive a clamped ratio from the macOS 125px default command height, using a 5%-90% available-content range while preserving ratio-based drag updates.
- Kept the command resize rail as a real top row above command tabs and reduced the command panel's hard minimum height to the rail plus command titlebar so the rail does not need to overlap tabs.
- Changed the project-editor companion default from a fixed narrow pixel width to a 32% editor-area ratio with a practical minimum width, leaving real companion resizing/reset persistence deferred.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`.
- Remaining gaps for later slices: real command height persistence, command split resizing/reset behavior, project-editor companion resize/reset persistence, visual validation in a running app, real libghostty mounting, one CEF view per Browser tab, real CEF/file-bridge mounts, and broader workspace presentation polish.

### 2026-06-22-06:29 Task slice 11

- Added a GPUI-specific structured JSON shell-state file under the shared Ghostex home `state/` directory for placeholder workspace layout persistence.
- Restored active titlebar mode, shell focus, Agents tab/split tree with active/focused panes and Focus mode, command-pane mode/height/focused group/tree, Browser tab ids/active tab/address-only state, and project-editor companion visibility/width ratio on app creation.
- Kept persisted data privacy-conscious: terminal and command titles/content are regenerated from placeholder ids, command text/stdout/stderr/user paths/project paths/secrets are not written, and Browser tab URLs are sanitized to HTTP(S) values without query strings, fragments, credentials, or non-web schemes.
- Saved shell state after practical user-facing mutations: titlebar mode changes, Agents tab selection/close/drag-drop/focus mode/focus changes, command tab selection/close/drag-drop/mode/height changes, Browser tab/address changes, and project-editor companion visibility/focus changes.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`.
- Remaining gaps for later slices: real libghostty terminal persistence boundaries, real command processes/teardown, one CEF view per Browser tab with real page titles, CEF Kanban/Manage bridges, Source editor integration, command split resize persistence, and visual validation in a running app.

### 2026-06-22-06:39 Task slice 12

- Replaced the Agents pane new-terminal action placeholder with in-memory shell behavior that creates a new running placeholder terminal tab in the clicked pane group, selects it, focuses that pane, and persists the shell layout state.
- Replaced the single Agents split action placeholder with a deterministic right-side horizontal split that creates and selects a new running placeholder terminal session beside the clicked pane, clearing Focus mode only so the newly created split is visible.
- Added persisted Agents terminal session id tracking so newly created placeholder terminals restore without reusing ids.
- Kept the overflow pane-actions control as a no-op placeholder, but changed its tooltip to identify the deferred pane-actions menu gap.
- Preserved existing drag/drop split behavior, sleeping/restored/mounting/popped-out placeholder selection behavior, command pane behavior, Browser/project-editor placeholders, and libghostty-as-black-placeholder scope.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`.
- Remaining gaps for later slices: explicit vertical split controls, native pane action menus/dropdowns, real libghostty mounting, real terminal process creation/teardown, command text/content handling, and visual validation in a running app.

### 2026-06-22-06:51 Task slice 13

- Made Agents workspace split handles real draggable resize controls for the existing placeholder split tree: horizontal handles adjust left/right ratios, vertical handles adjust top/bottom ratios, and double-click resets the targeted split to the shell default `0.5` ratio.
- Captured split child dimensions from normal GPUI layout via each split container's rendered first/handle/second child bounds, keeping the 5px handles as real layout siblings with 1px visual separators and without adding invisible interactive overlays or native/root hit-test routing.
- Added matching command-pane split resize/reset behavior for command-only horizontal left/right split nodes.
- Persisted placeholder shell layout state after split resize drags finish and after reset mutations, while keeping behavior in memory only with no libghostty, command process, app launch, or visual automation work.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check` (caught builder-order issue for `on_children_prepainted`); `cargo fmt`; `cargo check`.
- Remaining gaps for later slices: explicit vertical split controls, native pane action menus/dropdowns, real libghostty mounting, real terminal/command process creation and teardown, visual validation in a running app, and broader spatial focus/command parity.

### 2026-06-22-06:58 Task slice 14

- Made the project-editor companion divider a real draggable resize control for Source, Browser, Kanban, and Manage shell modes while keeping it as the visible reserved layout sibling between companion and editor surfaces.
- Captured project-editor companion/editor widths from normal GPUI child layout and used those metrics to update the stored companion width ratio in memory during drag.
- Added double-click reset for the companion divider back toward the default `0.32` ratio, with companion/editor width clamps based on the existing practical minimum constants.
- Persisted GPUI shell state after companion resize drags finish and after reset mutations, while preserving command-pane wrapping, Browser CEF visibility behavior, and Source/Kanban/Manage colored placeholder panes.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`.
- Remaining gaps for later slices: real source editor integration, one CEF view per Browser tab, Kanban/Manage CEF bridges and gating, project-editor companion collapse controls, visual validation in a running app, and real libghostty mounting.

### 2026-06-22-07:05 Task slice 15

- Replaced the single shared Browser CEF entity with a runtime map of Browser tab ids to CEF surface entities, while keeping persisted Browser tab state limited to sanitized shell metadata.
- Made loaded Browser tabs lazily create their own CEF surface when selected or navigated, so ordinary tab switching reveals the tab-owned surface without reloading existing page state.
- Made address-only Browser tabs render an empty black GPUI body and avoid creating or showing a CEF surface, preventing stale page content from another tab from appearing in new-tab placeholders.
- Updated Browser tab close behavior to hide and remove the closed tab's CEF surface before selecting a neighbor; closing the final loaded tab leaves the shell on an address-only placeholder.
- Updated Browser CEF visibility so only the selected loaded Browser tab is visible in Browser mode and all Browser CEF surfaces are hidden in Agents, Source, Kanban, and Manage modes.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`.
- Remaining gaps for later slices: project GitHub remote seeding, window.open/history rows, real favicon/title updates from page state, persistence beyond the existing shell tab metadata, project-editor auto-sleep, app launch/visual validation, and real libghostty mounting.

### 2026-06-22-07:11 Task slice 16

- Added privacy-scoped Browser first-tab seeding for fresh/default GPUI shell state: the first loaded Browser tab now uses the current project's canonical GitHub remote when `.git/config` exposes a recognized GitHub remote, otherwise it falls back to `https://www.google.com`.
- Used the GPUI prototype project-root convention of the parent of `CARGO_MANIFEST_DIR`, added a small project-root helper for future routing replacement, and parsed `.git/config` directly without spawning external `git` commands.
- Canonicalized only common GitHub remote forms into `https://github.com/owner/repo`: HTTPS remotes, `git@github.com:owner/repo.git`, and `ssh://git@github.com/owner/repo.git`; non-GitHub remotes are ignored and credentials/query strings/fragments are not carried into the seeded URL.
- Preserved existing restored Browser tabs through the existing shell-state restore path, and left runtime new Browser tabs as address-only placeholders.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`.
- Remaining gaps for later slices: window.open/history rows, real favicon/title updates from page state, Browser tab persistence beyond sanitized shell metadata, project-editor auto-sleep, app launch/visual validation, and real libghostty mounting.

### 2026-06-22-07:14 Task slice 17

- Added a cef-rs `Client` plus `LifeSpanHandler` for GPUI Browser tab CEF surfaces so `target=_blank` and `window.open` requests are intercepted through `on_before_popup`.
- Forwarded the requested popup URL into the GPUI Browser shell and returned handled from the CEF callback so Chromium does not create a separate native CEF popup/window outside the Browser workspace.
- Added shell handling that creates and selects a Browser tab for the popup URL, switches to Browser mode, updates the address field, creates/shows that tab's own CEF surface through the existing per-tab map, and hides inactive Browser CEF surfaces.
- Preserved address-only new-tab behavior for explicit new-tab actions and empty popup requests, and kept Browser persistence on the existing sanitized metadata path so queries, fragments, credentials, non-web schemes, and private local paths are not written as persisted loaded URLs.
- Files touched: `gpui/src/main.rs`, `gpui/src/cef/macos.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run: from `gpui/`: `cargo fmt`; `cargo check`; from the repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Remaining gaps for later slices: app launch/visual validation was not run by instruction, script-created blank popup content transfer is not implemented beyond opening the requested URL/address-only tab, real favicon/title updates from page state, Browser history rows, project-editor auto-sleep, and real libghostty mounting.

### 2026-06-22-07:28 Task slice 18

- Extended the cef-rs GPUI Browser client with a `DisplayHandler` so main-frame address changes and page-title changes from CEF are forwarded into the shell through the existing foreground GPUI update path.
- Updated Browser tab runtime metadata handling: CEF address changes now update the reporting tab's in-memory URL and URL-derived fallback title, refresh the address field only when that tab is active, keep Browser CEF visibility scoped to the selected tab, and persist through the existing sanitized shell-state writer.
- Kept raw CEF page titles runtime-only by storing them separately from URL-derived fallback titles; title callbacks update the visible native Browser tab-strip label while the app is running but are not serialized into shell state.
- Preserved address-only new-tab behavior, popup-created Browser tabs, per-tab CEF surface ownership, and the existing layout/hit-testing model with no overlays or native hit-test routing.
- Files touched: `gpui/src/main.rs`, `gpui/src/cef/macos.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`. Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Remaining gaps for later slices: app launch/visual validation was not run by instruction, favicon image rendering/cache remains unimplemented, Browser history rows remain deferred, project-editor auto-sleep remains deferred, and real libghostty mounting remains deferred.

### 2026-06-22-07:30 Task slice 19

- Added shell-level project-editor lifecycle state for Source, Browser, Kanban, and Manage with independent awake versus sleeping/restored placeholder state.
- Implemented deterministic recency behavior instead of true timers: selecting, switching to, or activating a project-editor surface marks that mode awake and keeps only the three most recently used project-editor modes awake, sleeping older inactive modes.
- Rendered selected sleeping project-editor modes as clear GPUI placeholder bodies that activate back to awake state without resetting unrelated shell state, companion sizing, command-pane state, Browser tab metadata, or CEF surface entities.
- Gated Browser CEF visibility on Browser mode being awake; sleeping Browser state hides all Browser CEF child views, while waking Browser uses the existing selected-tab sync path to restore normal tab visibility.
- Persisted only enum-like lifecycle slugs and recency counters alongside the existing sanitized shell state; no source content, user paths, raw page titles, command text, tokens, or raw browser query strings are written.
- Left true timer-based auto-sleep deferred because GPUI timer plumbing is broader than this placeholder slice.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`. Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Remaining gaps for later slices: real timer-based auto-sleep settings remain deferred, real Source/Kanban/Manage surfaces remain colored placeholders, Browser CEF teardown/suspend is not implemented, app launch/visual validation was not run by instruction, Browser history/favicon work remains deferred, and real libghostty mounting remains deferred.

### 2026-06-22-07:46 Task slice 20

- Added same-strip GPUI drag/drop reorder for Browser tabs using a Browser-only typed drag payload, drag preview, per-tab insertion marker, and real end-of-strip drop target.
- Reordered the existing Browser tab records in place so `BrowserTabId`, active tab id, runtime page title, current URL, address-only state, and the tab-owned CEF surface entity map are preserved without reloading or recreating Browser surfaces.
- Persisted Browser tab order through the existing shell-state writer, which already serializes Browser tabs in vector order with sanitized URL metadata only.
- Hid all Browser CEF child surfaces for the duration of a Browser tab drag and restored the selected loaded tab through the normal visibility gate after drop or root mouse-up cancellation, without adding invisible overlays or native/root hit-test routing.
- Kept Browser tab body edge drops, cross-pane Browser splitting, Source/Kanban/Manage real surfaces, and libghostty terminal rendering out of this slice.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`. Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Remaining gaps for later slices: app launch/visual validation was not run by instruction, Browser body edge drops and Browser splitting remain deferred, Browser history/favicon work remains deferred, real Source/Kanban/Manage surfaces remain colored placeholders, and real libghostty mounting remains deferred.

### 2026-06-22-07:48 Task slice 21

- Added an explicit GPUI Agents Split Below pane action beside New Terminal and Split Right in the tab-bar action cluster.
- Reused the existing workspace split tree, vertical split axis, real split handles, placeholder terminal allocation, focus selection, and shell-state persistence path so the new lower pane appears selected with a running black placeholder terminal.
- Preserved Split Right and New Terminal behavior, widened the pane action cluster for the added icon, and kept the overflow/pane menu deferred.
- Cleared Agents Focus mode on successful explicit split creation so the new split is visible, matching the existing Split Right behavior without overlays, native/root hit-test routing, libghostty mounting, or regular macOS app edits.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`. Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Remaining gaps for later slices: native pane action menus/dropdowns, real libghostty mounting, real terminal/command process creation and teardown, app launch/visual validation was not run by instruction, and broader spatial focus/command parity.

### 2026-06-22-07:54 Task slice 22

- Added a GPUI shell-level previous non-command focus target so Agents panes, Browser, project-editor surfaces, and visible project-editor companions are remembered before command-pane focus takes over.
- Restored that remembered non-command focus when the command pane collapses through F12, command-pane chrome controls, or closing the final command placeholder, with stale panes, hidden companions, and inactive modes falling back to the current active mode's default surface.
- Persisted the remembered focus using only the existing enum/id shell-focus metadata and the same validation path as `shellFocus`; no terminal content, command text, paths, raw URLs, page titles, tokens, or secrets are added to shell state.
- Kept terminals and command terminals as placeholder surfaces and did not edit the regular macOS app or launch/restart the app.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`. Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Remaining gaps for later slices: real libghostty focus/mounting, real command process creation and teardown, visual validation in a running app, and broader spatial focus parity beyond the placeholder shell model.

### 2026-06-22-08:03 Task slice 23

- Added a command-tab drag active state to the GPUI shell so command-pane tab drags hide all Browser CEF child surfaces when Browser mode is active underneath the command panel.
- Reused the existing Browser CEF visibility gate so drop completion and root mouse-up cancellation restore only the selected loaded Browser tab through normal per-tab visibility logic.
- Preserved command-only drag/drop behavior: same-group tab-strip reorder, pane-body center grouping, left/right command splits, and top/bottom body drops treated as center grouping.
- Kept Browser tab drag hiding behavior on its existing flag and did not add overlays, broad hit-test routing, native/root mouse rerouting, regular macOS app edits, app launch, or real command processes.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`. Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Remaining gaps for later slices: visual validation in a running app was not run by instruction, real command process creation and teardown remain deferred, Browser body edge drops and Browser splitting remain deferred, and real libghostty mounting remains deferred.

### 2026-06-22-08:08 Task slice 24

- Wired the GPUI Browser toolbar Back and Forward buttons to the selected loaded Browser tab's existing owned CEF surface.
- Derived Back and Forward enabled state from CEF `can_go_back` and `can_go_forward`, keeping unavailable directions visually disabled and no-op.
- Changed Reload to call CEF `reload()` on the active loaded surface instead of reloading the shell-model URL, so Chromium keeps ownership of page history and reload semantics.
- Kept address-only Browser tabs unloaded for Back, Forward, and Reload by using only the existing active surface and avoiding the active-surface creation helper.
- Routed Browser toolbar clicks through typed toolbar actions that select Browser mode, mark Browser awake, set Browser shell focus, update Browser CEF visibility through the existing gate, repaint, and persist shell state.
- Preserved feedback/profile/appearance/devtools toolbar buttons as deferred no-op controls, including the existing disabled feedback tooltip behavior.
- Files touched: `gpui/src/main.rs`, `gpui/src/cef/macos.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt` (multiple runs); `cargo check` (multiple runs, final clean). Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md` (multiple runs, final clean).
- Remaining gaps for later slices: Browser history rows/dropdowns remain deferred, favicon image loading/cache remains deferred, app launch/visual validation was not run by instruction, Browser body edge drops and Browser splitting remain deferred, real Source/Kanban/Manage surfaces remain colored placeholders, and real libghostty mounting remains deferred.

### 2026-06-22-08:20 Task slice 25

- Added explicit GPUI project-editor companion hide and restore controls for Source, Browser, Kanban, and Manage.
- Added a compact companion-tabbar hide button that toggles only shell companion visibility, preserves the stored width ratio, wakes the active project-editor mode, focuses the main project-editor surface, persists shell state, repaints, and routes Browser CEF visibility through the existing gate.
- Added a visible left restore rail as a normal layout sibling in the hidden-companion branch before the editor surface; its button restores the companion at the previous width ratio, wakes the active mode, focuses the companion, persists shell state, and repaints.
- Routed focused project-editor companion Cmd-W through the same hide helper before mode-specific close handling, so Browser companion focus hides the companion while Browser surface focus still closes Browser tabs.
- Preserved Browser tab/surface identity, Source/Kanban/Manage placeholder identity, command-pane state, and terminal placeholder state; no regular macOS app edits, overlays, hidden hit areas, app launch, or real Source/Kanban/Manage/libghostty work were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`. Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md`.
- Remaining gaps for later slices: app launch/visual validation was not run by instruction, real Source/Kanban/Manage surfaces remain colored placeholders, Browser history rows/dropdowns and favicon work remain deferred, Browser body edge drops and Browser splitting remain deferred, and real libghostty mounting remains deferred.

### 2026-06-22-08:25 Task slice 26

- Changed GPUI titlebar mode selection so sleeping Source, Browser, Kanban, and Manage modes become active without being marked awake; their existing click-to-activate sleeping placeholder remains the body until explicitly activated.
- Kept already-awake project-editor selections refreshing lifecycle recency, preserving the deterministic three-awake-mode cap, and left Agents mode selection outside the project-editor lifecycle path.
- Preserved Browser sleep behavior on selection: sleeping Browser selection now routes through the Browser visibility gate so all Browser CEF child views remain hidden, while awake Browser selection still syncs the selected loaded tab surface.
- Added a subtle dot inside each sleeping project-editor titlebar tab's normal layout frame so sleeping state is visible before selection, including for an active sleeping tab, without adding titlebar text, overlays, hidden hit regions, or native/root hit-test routing.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`. Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md`.
- Remaining gaps for later slices: app launch/visual validation was not run by instruction, real auto-sleep timers remain deferred, real Source/Kanban/Manage surfaces remain colored placeholders, Browser teardown/suspend remains deferred, Browser history/favicon work remains deferred, Browser body edge drops and Browser splitting remain deferred, and real libghostty mounting remains deferred.

### 2026-06-22-08:35 Task slice 27

- Added real GPUI shell-level project-editor auto-sleep timers for Source, Browser, Kanban, and Manage, with independent runtime epochs so stale callbacks no-op after mode changes or wakes.
- Kept timer sleep scoped to inactive awake modes only: active project-editor modes do not auto-sleep, titlebar selection of a sleeping mode still does not wake it, and placeholder/body activation wakes only that selected mode.
- Reused the shared macOS settings keys at scheduling time: Source uses code-editor auto-sleep settings, Browser uses browser-session settings, and Kanban/Manage use project-editor settings, defaulting to enabled with a five-minute idle window for missing or malformed settings.
- Preserved placeholder and Browser identity on sleep: timer sleep only marks lifecycle state sleeping, persists shell state, repaints, and routes Browser through the existing CEF visibility gate without destroying tab metadata, CEF entities, companion layout, command-pane state, terminal placeholders, or colored placeholders.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`. Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md`.
- Remaining gaps for later slices: app launch/visual validation was not run by instruction, settings subscription/live policy rescheduling remains deferred, real Source/Kanban/Manage surfaces remain colored placeholders, Browser teardown/suspend remains deferred beyond visibility gating, Browser history/favicon work remains deferred, Browser body edge drops and Browser splitting remain deferred, and real libghostty mounting remains deferred.

### 2026-06-22-08:47 Task slice 28

- Added runtime-only GPUI layout bounds capture for rendered Agents workspace leaf panes and expanded command-pane groups using normal `on_children_prepainted` callbacks on the actual pane/group containers.
- Changed Cmd-Alt directional focus from rendered leaf-order traversal to spatial nearest-candidate selection for left, right, up, and down, with deterministic ranking by primary-axis distance, secondary-axis distance, squared distance, and render order.
- Included expanded command-pane groups as spatial focus candidates when command sessions exist, so moving down from a workspace pane can enter the command pane and moving up from command focus selects the closest workspace pane above.
- Kept sleeping, mounting, restored/unmounted, and popped-out Agents placeholders focusable through their rendered pane bounds, while Focus mode naturally limits candidates to the single rendered pane.
- Preserved the previous rendered-order traversal only when layout bounds are not available yet, and kept raw geometry runtime-only so shell focus persistence still goes through existing focus helpers.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`. Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md`.
- Remaining gaps for later slices: real libghostty focus/mounting, real command process focus/teardown, app launch/visual validation was not run by instruction, real Source/Kanban/Manage surfaces remain colored placeholders, Browser history/favicon/body edge-drop work remains deferred, and non-placeholder surface focus parity remains deferred.

### 2026-06-22-09:02 Task slice 29

- Replaced the flat Browser tab-strip shell with a Browser pane/split tree whose leaves own tab-id order and active selection while the metadata registry and per-tab CEF surface map remain keyed by stable `BrowserTabId`.
- Added Browser tab pane-body drag feedback for center grouping and left/right/top/bottom edge split intent as normal non-interactive body children, with Browser CEF surfaces hidden during the drag through the existing visibility gate.
- Implemented Browser center grouping and edge split drops, including splitting the active tab out of its own multi-tab group, while preserving tab ids, runtime page titles, current URLs, address-only state, and CEF entity ownership.
- Rendered only the focused Browser pane's selected loaded CEF surface; inactive split Browser panes keep their tab bars and black placeholder bodies for now so simultaneous multi-CEF body rendering stays deferred.
- Persisted Browser pane/split order, focused pane, active tab ids, and sanitized Browser tab metadata through the existing shell-state file, including migration from the prior flat Browser tab state without storing raw page titles, query strings, fragments, credentials, local paths, or command/user content.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`. Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md`.
- Remaining gaps for later slices: app launch/visual validation was not run by instruction, simultaneous visible CEF bodies for inactive Browser split panes remain deferred, Browser split resize controls remain deferred, Browser favicon/history/dropdown/menu work remains deferred, real Source/Kanban/Manage surfaces remain colored placeholders, and real libghostty mounting remains deferred.

### 2026-06-22-09:05 Task slice 30

- Made GPUI Browser split dividers real visible resize handles using the same normal-layout sibling pattern as Agents workspace and command-pane splits.
- Captured Browser split first/handle/second child metrics per rendered branch and used them to update the targeted split ratio while dragging, with existing 10%-90% split-ratio clamping.
- Added double-click reset to `0.5`, resize cursors for horizontal and vertical Browser split handles, and shell-state persistence after reset or completed resize drags so ratios restore through the Browser split tree.
- Preserved the slice boundary: no simultaneous visible CEF bodies, Browser history/favicon/dropdown/menu work, Source/Kanban/Manage real surfaces, libghostty mounting, regular macOS app edits, overlays, hidden drag regions, or native/root hit-test routing.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`. Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md`.
- Remaining gaps for later slices: app launch/visual validation was not run by instruction, simultaneous visible CEF bodies for inactive Browser split panes remain deferred, Browser history/favicon/dropdown/menu work remains deferred, real Source/Kanban/Manage surfaces remain colored placeholders, and real libghostty mounting remains deferred.

### 2026-06-22-09:11 Task slice 31

- Added CEF DisplayHandler favicon URL metadata plumbing for GPUI Browser tabs, forwarding a representative non-empty favicon URL as runtime metadata only.
- Stored favicon presence/representative URL on in-memory `BrowserTab` records, clearing it on explicit URL loads, CEF address changes, restored shell-state tabs, and address-only placeholder resets so stale icons do not cross pages.
- Rendered Browser tab chrome with a distinct deterministic shell favicon glyph/color state for loaded tabs that reported favicon metadata, while keeping generic loaded tabs and address-only placeholders visually separate.
- Preserved Browser split/reorder behavior by keeping favicon metadata on stable `BrowserTabId` tab records; no simultaneous visible CEF bodies, history/dropdowns/menus, bitmap image download/cache, Source/Kanban/Manage real surfaces, regular macOS app edits, or libghostty work were added.
- Files touched: `gpui/src/main.rs`, `gpui/src/cef/macos.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`. Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md`.
- Remaining gaps for later slices: full favicon bitmap download/cache/rendering remains deferred, app launch/visual validation was not run by instruction, simultaneous visible CEF bodies for inactive Browser split panes remain deferred, Browser history/dropdown/menu work remains deferred, real Source/Kanban/Manage surfaces remain colored placeholders, and real libghostty mounting remains deferred.

### 2026-06-22-09:18 Task slice 32

- Added Browser surface Ctrl-Tab and Ctrl-Shift-Tab cycling scoped to the focused Browser pane's tab group, including loaded and address-only tabs without crossing split panes.
- Reused the existing Browser selection sync so cycling marks Browser awake, keeps shell focus on Browser, refreshes the shared address toolbar, shows only the focused pane's selected loaded CEF surface, and persists shell state.
- Preserved current slice boundaries: no Browser history/dropdowns/menus, bitmap favicon cache, simultaneous visible CEF bodies, real Source/Kanban/Manage surfaces, regular macOS app edits, or libghostty work were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`. Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md`.
- Remaining gaps for later slices: app launch/visual validation was not run by instruction, simultaneous visible CEF bodies for inactive Browser split panes remain deferred, Browser history/dropdown/menu work remains deferred, full favicon bitmap download/cache/rendering remains deferred, real Source/Kanban/Manage surfaces remain colored placeholders, and real libghostty mounting remains deferred.

### 2026-06-22-09:24 Task slice 33

- Added runtime-only normal-layout bounds capture for rendered Browser split leaf panes using the actual Browser pane container.
- Routed Cmd-Alt directional focus in Browser mode to the nearest rendered Browser pane by spatial score, with Browser-only rendered-order fallback before bounds are available.
- Reused Browser pane focus/sync behavior so directional pane focus wakes Browser, keeps shell focus on Browser, updates the shared address toolbar, shows only the focused pane's selected loaded CEF surface, persists shell state, and repaints.
- Preserved inactive Browser split panes as focusable black placeholders and kept the slice boundary: no command-pane crossing, simultaneous visible CEF bodies, Browser history/dropdowns/menus, bitmap favicon cache, real Source/Kanban/Manage surfaces, regular macOS app edits, or libghostty work were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`. Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md`.
- Remaining gaps for later slices: app launch/visual validation was not run by instruction, simultaneous visible CEF bodies for inactive Browser split panes remain deferred, Browser history/dropdown/menu work remains deferred, full favicon bitmap download/cache/rendering remains deferred, real Source/Kanban/Manage surfaces remain colored placeholders, command-pane/project-editor cross-surface directional focus remains deferred, and real libghostty mounting remains deferred.

### 2026-06-22-09:32 Task slice 34

- Added runtime-only normal-layout bounds capture for the active project-editor main surface slot and visible companion pane.
- Routed Cmd-Alt directional focus in Source, Kanban, and Manage through spatial candidates for the visible companion, main placeholder surface, and expanded command-pane groups, with a deterministic companion/surface/command fallback before first-frame bounds exist.
- Extended Browser directional focus so Browser split panes still use nearest rendered Browser leaf geometry while also allowing movement into expanded command groups and back up to the nearest Browser pane or visible companion above.
- Kept hidden companion restore rails visible but outside the keyboard focus target set, and preserved the existing one-visible-CEF-body, colored placeholder, sleeping placeholder, and libghostty black-placeholder boundaries.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`. Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md`.
- Remaining gaps for later slices: app launch/visual validation was not run by instruction, simultaneous visible CEF bodies for inactive Browser split panes remain deferred, Browser history/dropdown/menu and full favicon bitmap work remain deferred, real Source/Kanban/Manage surfaces remain colored placeholders, and real libghostty mounting remains deferred.

### 2026-06-22-09:44 Task slice 35

- Split GPUI project-editor main-surface focus intent so Cmd-Alt directional focus can land on a selected sleeping Source, Browser, Kanban, or Manage placeholder without marking that mode awake.
- Kept body click / explicit placeholder activation on the existing wake path, so selected sleeping project-editor surfaces still wake only through body activation.
- Preserved Browser sleep behavior for keyboard focus: sleeping Browser focus stores shell focus and reruns the visibility gate, but it does not create, show, or sync a CEF surface until explicit activation.
- Kept awake project-editor main-surface focus on the existing activation helper so recency, Browser sync, visibility, and persistence behavior remain unchanged for already-awake modes.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`. Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md`.
- Remaining gaps for later slices: app launch/visual validation was not run by instruction, simultaneous visible CEF bodies for inactive Browser split panes remain deferred, Browser history/dropdown/menu and full favicon bitmap work remain deferred, real Source/Kanban/Manage CEF surfaces remain colored placeholders, and real libghostty mounting remains deferred.

### 2026-06-22-09:49 Task slice 36

- Added a runtime-only effective GPUI project-editor auto-sleep policy snapshot with per-mode enabled/duration state for Source, Browser, Kanban, and Manage, derived from shared settings without storing raw settings values.
- Started a lightweight fixed-interval GPUI background poll that compares the current effective policy to the stored snapshot and reschedules only when that effective policy changes, so unchanged timers are not repeatedly invalidated.
- Reused the existing epoch-based scheduling path so disabled modes invalidate pending timers, duration changes restart timers for inactive awake modes, and policy changes do not wake sleeping modes, immediately sleep active modes, destroy Browser CEF entities, or alter placeholder surfaces.
- Preserved the default policy for missing or malformed settings as enabled with five idle minutes, with no logging or persistence of settings values, paths, project names, browser titles, command text, tokens, or user content.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt`; `cargo check`. Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md`.
- Remaining gaps for later slices: no app launch/visual validation was run by instruction, real settings UI/native settings subscriptions/filesystem watchers remain deferred, real Source/Kanban/Manage surfaces remain colored placeholders, libghostty terminal surfaces remain black placeholders, Browser history/dropdowns/full favicon bitmaps remain deferred, and simultaneous visible CEF bodies remain deferred.

### 2026-06-22-09:55 Task slice 37

- Changed GPUI Browser CEF visibility from one focused/global active tab to the set of rendered Browser split leaves' active loaded tab ids.
- Rendered each Browser split pane with its own active loaded tab's existing CEF surface when Browser mode is active, Browser is awake, and Browser/command tab drags are not hiding native surfaces.
- Preserved restored/sleeping behavior by not creating CEF entities from visibility or render paths: active loaded tabs without an existing surface, and address-only tabs, remain black placeholders until normal selection or wake materializes them.
- Kept Browser toolbar actions scoped to the focused/global active Browser tab, kept Source/Kanban/Manage as colored placeholders, and kept libghostty terminal surfaces as black placeholders.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt` (passed); `cargo check` (passed). Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md` (passed).
- Remaining gaps for later slices: no app launch/visual validation was run by instruction, inactive restored loaded Browser tabs still do not materialize until normal selection/wake, Browser history/dropdowns/menus and full favicon bitmap rendering remain deferred, real Source/Kanban/Manage CEF surfaces remain colored placeholders, and real libghostty mounting remains deferred.

### 2026-06-22-10:04 Task slice 38

- Added a distinct GPUI Agents pane action for full-width secondary terminal creation, separate from the existing pane-local Split Below behavior.
- Implemented root-level Agents workspace mutation that keeps the existing split/tab tree as the top branch and appends a new bottom-row pane with a selected running black placeholder terminal.
- Cleared Agents Focus mode after successful bottom-row creation so the new row is visible, while preserving command-pane separation, existing split handles, shell-state persistence, and placeholder-only terminal behavior.
- Widened the Agents tab action cluster and added a compact bottom-row icon/tooltip without introducing menus, dropdowns, overlays, hidden hit areas, native hit-test routing, real libghostty mounting, or terminal process creation.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt` (passed); `cargo check` (passed). Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md` (passed).
- Remaining gaps for later slices: no app launch/visual validation was run by instruction, libghostty terminal surfaces remain black placeholders, real terminal process creation/teardown remains deferred, native pane menus/dropdowns remain deferred, and real Source/Kanban/Manage CEF surfaces remain colored placeholders.

### 2026-06-22-10:09 Task slice 39

- Added a small BrowserTabId-owned GPUI Browser navigation history model with loaded-tab initialization, address-commit append/truncate behavior, CEF address-change reconciliation, adjacent back/forward index movement, and a 50-entry cap.
- Persisted only sanitized loaded history URLs plus the current index through the existing GPUI shell-state path, rebuilding invalid or missing history from each tab's sanitized loaded URL and leaving address-only tabs history-empty.
- Added compact Back/Forward history toggles beside the existing Back/Forward toolbar buttons and an in-layout history panel below the Browser toolbar that shows up to eight rows around the active tab's current entry, highlights the current row, and loads selected rows through the active Browser tab/CEF path.
- Preserved existing Back, Forward, and Reload toolbar behavior: normal Back/Forward clicks still call CEF `go_back`/`go_forward` only when the active surface can navigate, while Reload still calls CEF `reload`.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt` (passed); `cargo check` (passed). Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md` (passed).
- Remaining gaps for later slices: no app launch, restart, or visual automation was run by instruction; Browser menus/dropdowns and full favicon bitmap rendering remain deferred; real Source/Kanban/Manage CEF surfaces remain colored placeholders; real libghostty mounting remains deferred.

### 2026-06-22-10:23 Task slice 40

- Changed GPUI Agents final-tab close focus so emptied split branches choose the next keyboard target from the pre-collapse sibling branch edge instead of falling back to the first surviving workspace leaf.
- Preserved same-pane close behavior through the existing right-then-left tab selection and kept the single-root-tab placeholder shell non-closeable.
- Kept collapse cleanup scoped to shell state: invalid Focus mode still clears through existing validation, persistence remains in caller paths, and no native app, overlay, hit-test, libghostty, process, or visual automation behavior was added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt` (passed); `cargo check` (passed). Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md` (passed).
- Remaining gaps for later slices: no app launch, restart, or visual automation was run by instruction; real libghostty mounting and real terminal process creation/teardown remain deferred.

### 2026-06-22-10:30 Task slice 41

- Gated the GPUI Manage titlebar segment behind strict shared-sidebar settings: only boolean `true` for both `debuggingMode` and `showBetaFeatures` allows selection.
- Kept Manage visible as a subdued disabled titlebar segment when unavailable; disabled clicks are consumed without changing active mode, lifecycle wake state, focus, Browser visibility, or persisted shell state.
- Normalized restored `activeMode: manage` shell state to Agents when Manage is unavailable, reusing the normal focus validation/default path.
- Preserved the existing colored Manage placeholder, project-editor lifecycle behavior, companion/command-pane layout participation, and placeholder-only boundary when Manage is allowed.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt` (passed); `cargo check` (passed). Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md` (passed).
- Remaining gaps for later slices: no app launch, restart, or visual automation was run by instruction; projectless Manage disablement remains deferred because the GPUI shell currently derives a project from the workspace and has no safe project-availability flag; real Manage CEF/file bridge and real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-10:47 Task slice 42

- Added runtime-only GPUI Browser favicon image state beside the existing runtime favicon URL marker, keyed by stable `BrowserTabId` tab records so reorder, split, and drag-preview paths preserve ownership without recreating CEF surfaces.
- Implemented capped safe `data:image/*` favicon decoding for PNG, JPEG, WebP, GIF, BMP, and ICO data URLs into GPUI `Image` objects, with unsafe/non-http(s) URLs ignored and data URL bytes never persisted.
- Rendered decoded favicon images inside the existing normal tab chrome icon slot, falling back to the deterministic URL-only `F` marker for safe HTTP(S) favicon metadata and then to the generic loaded/address-only dot.
- Cleared runtime favicon image state wherever runtime favicon URL state already clears: explicit loads, CEF address changes, history jumps, restored shell-state tabs, and the final-tab address-only reset.
- Preserved the slice boundary: no regular macOS app edits, no CEF bitmap callback, no HTTP(S) favicon downloading, no new dependency, no overlays, hidden hit regions, native hit-test routing, Browser history/menu/dropdown changes, Source/Kanban/Manage real surfaces, or libghostty work were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt` (passed); `cargo check` (passed). Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md` (passed).
- Remaining gaps for later slices: HTTP(S) favicon downloading remains deferred until there is a bounded non-logging fetch path; app launch, restart, and visual automation were not run by instruction; Browser menus/dropdowns remain deferred; real Source/Kanban/Manage CEF surfaces remain colored placeholders; real libghostty mounting remains deferred.

### 2026-06-22-11:05 Task slice 43

- Added a bounded GPUI Browser HTTP(S) favicon fetch/render path that stores only the safe scheme+authority marker on `BrowserTab` while keeping the raw fetch URL in runtime-only asset source state.
- Implemented a favicon-specific non-`AssetLogger` GPUI `Asset` loader using `cx.http_client()`, with safe URL validation, fragment stripping, redirect limit, capped body reads, supported MIME/magic checks, pre-decode dimension sniffing, post-decode frame/dimension checks, and sanitized error Display text that excludes raw URLs, bodies, headers, cookies, tokens, paths, titles, command text, stdout/stderr, and user content.
- Rendered fetched favicons inside the existing Browser tab icon slot with the same marker/generic fallback during loading and failures, while preserving capped `data:image/*` behavior, address-only clears, navigation clears, restored shell state, reorder/split ownership, and drag-preview rendering.
- Added a direct `futures = "0.3"` dependency for capped async body reads; no new HTTP or image dependency was added.
- Files touched: `gpui/src/main.rs`, `gpui/Cargo.toml`, `gpui/Cargo.lock`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt` (passed); `cargo check` (passed). Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/Cargo.toml gpui/Cargo.lock gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md` (passed).
- Remaining gaps for later slices: app launch, restart, and visual automation were not run by instruction; Browser menus/dropdowns remain deferred; real Source/Kanban/Manage CEF surfaces remain colored placeholders; real libghostty mounting remains deferred.

### 2026-06-22-11:15 Task slice 44

- Implemented the GPUI Agents far-right overflow as a `NativeMenu` opened at the click position, scoped by the clicked pane id, and dispatched through typed GPUI actions on the root render tree.
- Added pane/layout menu actions for New Terminal Tab in This Pane, Split Right with New Terminal, Split Below with New Terminal, Append Full-Width Terminal Row, and Enter/Exit Focus Mode when applicable, without adding per-tab close commands.
- Reused the existing placeholder-only shell mutations for menu selections and inline controls, preserving black terminal placeholders, shell-state persistence, pane focus/notification behavior, and Browser/CEF visibility boundaries with no libghostty mount, terminal process creation, command text/content, overlay, hidden hit region, or regular macOS app edit.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt` (passed); `cargo check` (passed). Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/Cargo.toml gpui/Cargo.lock gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md` (passed).
- Remaining gaps for later slices: app launch, restart, and visual automation were not run by instruction; real libghostty mounting and real terminal process creation/teardown remain deferred; real Source/Kanban/Manage CEF surfaces remain colored placeholders.

### 2026-06-22-11:23 Task slice 45

- Added right-click `NativeMenu` context menus to individual GPUI Agents workspace tabs, opened at the click position and scoped to the clicked pane id plus session id.
- Added typed GPUI tab actions for Select Tab and Close Tab, wired through root `.on_action` listeners and existing shell select/close model behavior so selection persists/notifies and close uses the current neighbor-selection/collapse/final-root guard rules.
- Kept the per-tab menu limited to tab commands only: no New Terminal, Split Right/Below, full-width bottom row, or Focus Mode actions were duplicated from the far-right pane overflow.
- Preserved placeholder-only terminal boundaries: no libghostty mount, terminal process creation/teardown, command text/content, Browser/CEF change, overlay, hidden hit region, hit-test routing, synthetic coordinate routing, or regular macOS app edit was added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt` (passed); `cargo check` (passed). Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/Cargo.toml gpui/Cargo.lock gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md` (passed).
- Remaining gaps for later slices: app launch, restart, and visual automation were not run by instruction; real libghostty mounting and real terminal process creation/teardown remain deferred; real Source/Kanban/Manage CEF surfaces remain colored placeholders.

### 2026-06-22-11:27 Task slice 46

- Added right-click `NativeMenu` context menus to individual GPUI Browser tabs, opened at the click position and scoped to the clicked Browser pane id plus Browser tab id.
- Added typed GPUI Browser tab actions for Select Tab and Close Tab, wired through root `.on_action` listeners and the existing Browser selection/close helpers so address sync, Browser wake behavior, CEF visibility, split/reorder state, favicon runtime state, history, and last-tab address-only placeholder semantics stay on the existing path.
- Kept the per-tab Browser menu limited to tab commands only: no Browser pane split/layout actions, toolbar profile/appearance/devtools actions, history rows, project-editor commands, overlays, hidden hit regions, hit-test routing, or synthetic coordinate routing were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt` (passed); `cargo check` (passed). Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/Cargo.toml gpui/Cargo.lock gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md` (passed).
- Remaining gaps for later slices: app launch, restart, and visual automation were not run by instruction; real Source/Kanban/Manage CEF surfaces remain colored placeholders; real libghostty mounting remains deferred.

### 2026-06-22-11:34 Task slice 47

- Added right-click `NativeMenu` context menus to individual GPUI command-pane tabs, opened at the click position and scoped to the clicked command group id plus command session id.
- Added typed GPUI command-tab actions for Select Tab and Close Tab, wired through root `.on_action` listeners and the existing command selection/close semantics so group focus, command-pane focus, persistence, notification, and final-placeholder collapse stay on the current paths.
- Kept collapsed-strip context-menu Select Tab aligned with collapsed-strip left-click behavior by carrying the expand requirement in the tab action and reusing the shared command-tab selection helper.
- Kept the per-tab command menu limited to tab commands only: no command creation, split/layout controls, pin/float/collapse controls, pane actions, overlays, hidden hit regions, hit-test routing, Browser/CEF changes, real command process creation/teardown, command text/content, or libghostty mount was added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt` (passed); `cargo check` (passed). Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/Cargo.toml gpui/Cargo.lock gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md` (passed).
- Remaining gaps for later slices: app launch, restart, and visual automation were not run by instruction; real command process creation/teardown, command text/content, and libghostty mounting remain deferred; real Source/Kanban/Manage CEF surfaces remain colored placeholders.

### 2026-06-22-11:43 Task slice 48

- Replaced the GPUI Browser Back/Forward in-layout history panel with click-position `NativeMenu` dropdowns opened from the existing compact history buttons.
- Added a typed GPUI `NavigateBrowserHistoryTo` action carrying only the history index, with menu labels regenerated from sanitized history URLs through the existing Browser URL display helper and selection routed through the existing active-history navigation path.
- Kept Back and Forward history direction-specific: Back omits the current row and offers entries behind the current index, while Forward omits the current row and offers entries ahead; opening the menu does not create Browser CEF surfaces.
- Removed the old `browser_history_panel` state, render hook, row renderer, and panel-specific color helpers so the obsolete in-layout panel can no longer render.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt` (passed); `cargo check` (passed). Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/Cargo.toml gpui/Cargo.lock gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md` (passed).
- Remaining gaps for later slices: app launch, restart, and visual automation were not run by instruction; real Source/Kanban/Manage CEF surfaces remain colored placeholders; real libghostty mounting remains deferred.

### 2026-06-22-11:59 Task slice 49

- Updated the GPUI Browser toolbar right-side run to follow current macOS parity: zoom reset when the active CEF surface is zoomed, Settings-selected feedback tool, History, beta-only Profile, and DevTools, with the removed Appearance control no longer rendering or reserving hit area.
- Kept feedback disabled on `github.com` and `*.github.com` with the required tooltip, and made enabled feedback clicks show a bounded placeholder notification naming Agentation or React Grab from shared settings until GPUI has an injector.
- Added a right-side History icon button backed by an OS-owned `NativeMenu` over the active tab's sanitized history rows, reusing the typed history navigation action and preserving the existing Back/Forward history menus.
- Hid Profile entirely when `showBetaFeatures` is not strict boolean `true`; when visible, it opens a bounded OS-owned placeholder menu with the native disabled `Beta Features:` label plus New Profile and Import Browser Data placeholder notifications, without creating profile persistence.
- Routed DevTools through a typed GPUI action and a real CEF host `toggle_dev_tools` wrapper for the active Browser surface, with no GPUI overlay, hidden hit region, hit-test routing, synthetic coordinate routing, or regular macOS app edits.
- Files touched: `gpui/src/main.rs`, `gpui/src/cef/macos.rs`, `gpui/assets/titlebar/history.svg`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt` (passed); `cargo check` (passed). Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/Cargo.toml gpui/Cargo.lock gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md gpui/assets/titlebar/history.svg` (passed).
- Remaining gaps for later slices: app launch, restart, and visual automation were not run by instruction; feedback injection and real browser profile persistence/import remain placeholder notifications; Source/Kanban/Manage remain colored placeholders; libghostty terminal surfaces remain black placeholders.

### 2026-06-22-12:09 Task slice 50

- Added fixed-width Browser tab-strip edge reveal markers between each pane's horizontally scrollable tab strip and fixed new-tab action cluster.
- Added the same fixed-width command tab edge reveal marker between expanded command group strips and controls, plus the collapsed command strip tabs and controls.
- Kept the reveal affordances as visible, non-interactive normal-layout sibling chrome with no overlays, hidden hit regions, broad hit-test routing, synthetic coordinate routing, Browser/CEF behavior changes, command process behavior, libghostty mounting, or regular macOS app edits.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt` (passed); `cargo check` (passed). Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/Cargo.toml gpui/Cargo.lock gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md gpui/assets/titlebar/history.svg` (passed).
- Remaining gaps for later slices: app launch, restart, and visual automation were not run by instruction; actual clipped-active-tab measurement/scroll-to-reveal behavior remains deferred; Source/Kanban/Manage remain colored placeholders; libghostty terminal surfaces remain black placeholders.

### 2026-06-22-12:17 Task slice 51

- Added GPUI Agents terminal placeholder activation for sleeping, restored/unmounted, and popped-out placeholder sessions: body click or the placeholder card button now selects/focuses the pane and changes that session presentation to Running so the black terminal placeholder surface appears.
- Kept tab selection presentation-only, so selecting sleeping/restored/mounting/popped-out tabs still does not auto-wake or mutate presentation state.
- Kept Mounting as a pending startup placeholder: activation only focuses/selects it and does not convert it to Running.
- Reused the existing GPUI shell-state persistence path so activated placeholder presentation state persists without creating libghostty surfaces, terminal processes, command text, overlays, hit-test routing, or regular macOS app edits.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt` (passed); `cargo check` (passed). Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/Cargo.toml gpui/Cargo.lock gpui/WORKSPACE_PARITY_PROGRESS.md docs/gpui-workspace-area-parity-requirements.md gpui/assets/titlebar/history.svg` (passed).
- Remaining gaps for later slices: app launch, restart, and visual automation were not run by instruction; Mounting still represents pending startup only; real libghostty mounting and real terminal process wake/materialize/reattach remain deferred; Source/Kanban/Manage remain colored placeholders.

### 2026-06-22-12:35 Task slice 52

- Added runtime-only `ScrollHandle` bookkeeping for GPUI Agents pane tab strips, Browser pane tab strips, expanded command group tab strips, and the collapsed command strip.
- Attached each handle to the existing horizontal `overflow_x_scroll()` tab-strip container while keeping the edge reveal affordances as visible non-interactive normal-layout siblings.
- Routed existing active-tab movement paths through `scroll_to_item(active index)`: tab click/context select, keyboard cycling, close-neighbor selection, new tab/session creation, Browser popup tabs, and Agents/Browser/command drag/drop reorder/group/split mutations.
- Preserved the placeholder shell boundaries: libghostty terminal surfaces stay black placeholders, Source/Kanban/Manage stay colored placeholders, scroll offsets are not persisted, and no overlays, hidden hit regions, hit-test routing, synthetic coordinate routing, or regular macOS app edits were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt` (passed); `cargo check` (passed). Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index `git diff --check` wrapper for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps for later slices: app launch, restart, and visual automation were not run by instruction; active-tab reveal is handle-driven but not visually validated in a running app; projectless Kanban/Manage disablement remains deferred because the GPUI shell has no independent project-availability signal yet; real Source/Kanban/Manage CEF surfaces remain colored placeholders; libghostty terminal surfaces remain black placeholders.

### 2026-06-22-12:45 Task slice 53

- Made GPUI F12 command-pane handling focus-aware: collapsed panes expand, focus the command pane, and scroll the active command tab; expanded panes with workspace, Browser, or project-editor focus now stay expanded and only move focus into the command pane; expanded panes collapse only when the command pane already owns shell focus.
- Preserved command-pane chrome control semantics so the slice changes only the keyboard F12 path.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt` (passed); `cargo check` (passed). Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index `git diff --check` wrapper for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed after rerun with a non-reserved shell variable).
- Remaining gaps for later slices: app launch, restart, and visual automation were not run by instruction; active-tab reveal and focus behavior were verified by Rust checks only, not in a running GPUI app; real command process creation/teardown, command text/content, and libghostty mounting remain deferred; real Source/Kanban/Manage CEF surfaces remain colored placeholders.

### 2026-06-22-12:51 Task slice 54

- Added GPUI Cmd+T and Cmd+N keybindings backed by shell actions: Cmd+T creates a running black terminal placeholder tab in the focused Agents pane when Agents is active, while Cmd+N switches/wakes Browser and creates an address-only Browser tab in the focused Browser pane.
- Changed normal Agents and Browser new-tab placement to insert immediately after the active tab in the clicked/focused pane instead of appending to the end, so keyboard and visible pane controls share the same placement rule.
- Kept the slice placeholder-only: no split actions, real CEF creation beyond existing Browser selection/sync, real libghostty terminals, Source/Kanban/Manage surfaces, regular macOS app edits, app launch, or restart were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt` (passed); `cargo check` (passed). Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index `git diff --check` wrapper for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps for later slices: behavior was verified by Rust checks only, not in a running GPUI app; Cmd+T outside Agents remains a documented no-op until GPUI has an explicit Agents-opening policy; real terminal/libghostty process creation and real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-13:00 Task slice 55

- Added GPUI Option/Alt+1 through Option/Alt+5 workarea switching keybindings backed by typed shell actions.
- Routed each hotkey through the same `set_active_mode` helper used by titlebar mode clicks, preserving titlebar availability gates, sleeping project-editor no-wake behavior, awake project-editor refresh, Browser visibility sync, focus defaults, and shell-state persistence.
- Mapped Alt+1 Agents, Alt+2 Source, Alt+3 Browser, Alt+4 Kanban, and Alt+5 Manage; unavailable Manage no-ops through the existing titlebar mode gate.
- Kept the slice scoped to keyboard workarea switching only: no real Source/Kanban/Manage surfaces, CEF bridges, libghostty terminals, overlays, hidden hit regions, hit-test routing, app launch, or restart were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt` (passed); `cargo check` (passed). Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index `git diff --check` wrapper for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed after rerun with a non-reserved shell variable).
- Remaining gaps for later slices: behavior will be verified by Rust checks only, not in a running GPUI app; real Source/Kanban/Manage CEF surfaces and real terminal/libghostty process creation remain deferred.

### 2026-06-22-13:10 Task slice 56

- Added placeholder GPUI drag/drop from Agents workspace tabs into expanded command-pane group bodies.
- Reused command-pane body drop feedback for workspace-tab hovers: center groups into the target command group, left/right creates a horizontal command split, and top/bottom intent behaves as center grouping.
- On drop, the command pane creates and selects a command-only placeholder session with the dragged Agents tab's visible title, then removes the Agents placeholder tab/session, focuses the command pane, scrolls active command/workspace tab strips, persists shell state, and notifies.
- Preserved the final-root Agents guard: if the dragged tab is the only remaining tab in the only Agents root leaf, the drop no-ops without moving the placeholder into commands.
- Preserved placeholder boundaries: no real terminal process transfer, libghostty mount/remount, command text, stdout/stderr, overlays, hidden hit regions, hit-test routing, regular macOS app edits, app launch, or app restart were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from `gpui/`: `cargo fmt` (passed); `cargo check` (passed). Commands run from repo root: `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index `git diff --check` wrapper for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps for later slices: real process/libghostty transfer, command process creation/teardown, command text/content capture, and visual validation in a running GPUI app remain deferred.

### 2026-06-22-13:17 Task slice 57

- Added GPUI Merge All Tabs parity for the Agents workspace as an Agents-only shell action and Ctrl+Shift+M keybinding.
- Added the Agents pane overflow `NativeMenu` item directly after Split Right/Split Below, scoped to the clicked pane id.
- Implemented the placeholder merge by collecting Agents workspace tabs in split-tree render order into the clicked/focused target pane, collapsing the Agents root to one leaf, preserving terminal session ids and presentation states, selecting the target pane's active session when possible, and clearing Agents Focus mode.
- Kept command-pane sessions, Browser tabs, Source/Kanban/Manage placeholders, project-editor state, real libghostty mounting, terminal process creation, command text/content, overlays, hidden hit regions, hit-test routing, app launch, and app restart out of this slice.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `cargo fmt --manifest-path gpui/Cargo.toml` (passed); `cargo check --manifest-path gpui/Cargo.toml` (failed before checking GPUI because repo-root stable ignored `gpui/rust-toolchain.toml` and hit unstable `slice_as_array` in the external GPUI reference crate); `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index `git diff --check` wrapper for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps for later slices: behavior was verified by Rust checks only, not in a running GPUI app; real terminal/libghostty merge behavior and visual validation in a running GPUI app remain deferred.

### 2026-06-22-13:28 Task slice 58

- Made GPUI Cmd+T shell-focus aware for terminal placeholders: command-pane focus adds a command-only placeholder to the focused command group, while focused Agents panes in Agents mode keep the existing running black terminal placeholder behavior.
- Added typed GPUI actions and keybindings for Cmd+D and Cmd+Shift+D focused terminal splits.
- Routed Agents-focused split hotkeys through the existing right/below placeholder split helpers, including their selection, focus, scroll, Focus-mode clearing, and persistence behavior.
- Added command-focused split behavior that maps both Cmd+D and Cmd+Shift+D to a new horizontal command-only placeholder split beside the focused command group, then expands/focuses the command pane, persists, and scrolls active command tabs.
- Kept Browser, Source, Kanban, Manage, real libghostty terminals, terminal processes, command text/content, overlays, hidden hit regions, hit-test routing, regular macOS app edits, app launch, and app restart out of this slice.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index `git diff --check` wrapper for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed after rerun with a non-reserved shell variable).
- Remaining gaps for later slices: behavior was verified by Rust checks only, not in a running GPUI app; real terminal/libghostty process creation and visual validation in a running GPUI app remain deferred.

### 2026-06-22-13:38 Task slice 59

- Added Browser leaf placeholder metadata so the body renderer knows whether the active tab is address-only or loaded, plus the loaded tab's safe URL-derived title and origin.
- Kept address-only Browser tabs as minimal blank/new-tab bodies while loaded Browser tabs with no tab-owned CEF surface render a visible restored/sleeping Browser placeholder card.
- Limited restored placeholder text to sanitized shell URL state: URL-derived host title plus scheme/authority origin only, with no runtime page titles, query strings, fragments, credentials, local paths, tokens, cookies, or user content.
- Preserved the existing activation path: Browser body click/focus still materializes the focused loaded tab, and render does not create or load CEF surfaces, overlays, hidden hit regions, hit-test routing, synthetic routing, regular macOS app changes, app launch, or app restart.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index `git diff --check` wrapper for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps for later slices: behavior was verified by Rust checks only, not in a running GPUI app; real visual validation, Browser profile persistence/import, feedback injection, Source/Kanban/Manage CEF surfaces, and libghostty terminal surfaces remain deferred.

### 2026-06-22-13:46 Task slice 60

- Added a GPUI Browser pane overflow button beside the existing Browser new-tab button in normal tab-strip action-cluster layout.
- Added a click-position OS-owned `NativeMenu` scoped to the clicked `BrowserPaneId` with pane/layout-only actions: New Browser Tab in This Pane, Split Right with Browser Tab, and Split Below with Browser Tab.
- Routed menu selections through typed GPUI root actions. New-tab focuses the clicked Browser pane and reuses the existing address-only add-tab path; split actions create and select a new address-only Browser tab in a new right/below pane through the existing Browser split helper.
- Preserved Browser visibility, wake/focus, scroll, and shell-state persistence flows while keeping new split tabs address-only, so menu actions do not create/load new CEF surfaces and do not add per-tab close/select, toolbar, history, profile, devtools, overlay, hidden hit-region, hit-test routing, regular macOS app, app launch, or app restart behavior.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index `git diff --check` wrapper for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps for later slices: behavior was verified by Rust checks only, not in a running GPUI app; visual validation, real multi-CEF Browser lifecycle expansion, Browser profile persistence/import, Source/Kanban/Manage CEF surfaces, and libghostty terminal surfaces remain deferred.

### 2026-06-22-14:02 Main audit

- Re-derived the active scope from `docs/gpui-workspace-area-parity-requirements.md` and the user constraints: libghostty terminal rendering remains a black placeholder surface, and Source/Kanban/Manage remain colored placeholder workspace panes until their real surfaces are intentionally implemented.
- Audited current GPUI evidence for the placeholder-shell parity surface: Agents workspace tab/split/persistence/placeholder activation paths, command-pane layout/focus/drag/close paths, Browser tab/split/CEF-visibility/restored-placeholder paths, project-editor companion/auto-sleep placeholder paths, and pane/tab `NativeMenu` scoping are all represented in `gpui/src/main.rs`.
- Re-ran the focused auditor after slice 60; it found no confirmed remaining small placeholder-shell parity gaps outside the intentionally deferred categories.
- Kept the broader goal active because full parity is not proven without app launch/visual validation and because real libghostty/process behavior, real Source/Kanban/Manage CEF/code-server/file-bridge surfaces, Browser profile persistence/import, feedback injection, and projectless availability signals remain intentionally outside the placeholder-shell completion boundary.
- Files touched: `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root for this audit: `date '+%Y-%m-%d-%H:%M'`; targeted `rg` evidence searches over `gpui/src/main.rs`; final verification commands are recorded in the next handoff.

### 2026-06-22-14:09 Task slice 61

- Added pure `#[cfg(test)]` model regression coverage inside `gpui/src/main.rs` without GPUI windows, CEF entities, filesystem writes, app launch, app restart, or regular macOS app edits.
- Covered Browser pane-menu split behavior from a single-tab Browser pane: the original loaded tab remains in the original pane, the new pane is focused with one address-only active tab, and the nearest pure CEF assertion verifies the new split tab is not loaded and has no placeholder CEF surface flag.
- Covered command-pane drag semantics: top/bottom edge intent groups into the existing command group, while left/right create a command split group in the expected order.
- Covered restored Browser placeholder privacy for a loaded URL with credentials, path, query, and fragment: the placeholder exposes only a URL-derived host title plus scheme/authority origin, ignores the runtime page title, and keeps credentials/query/fragment/path out of `safe_url`.
- Covered Agents placeholder drag/split identity for sleeping and restored/unmounted sessions: split moves preserve session presentation state and focus the new pane, while same-pane single-tab edge split remains guarded.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 4 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps for later slices: behavior was verified by pure Rust model tests only, not in a running GPUI app; visual validation, real multi-CEF Browser lifecycle expansion, Browser profile persistence/import, feedback injection, Source/Kanban/Manage CEF surfaces, and libghostty terminal surfaces remain deferred.

### 2026-06-22-14:12 Task slice 62

- Added pure shell-state round-trip regression coverage for Agents workspace persistence: tab/split layout, focused pane, valid Focus mode, split ratio, next ids, active tabs, and terminal presentation states restore while private terminal titles/content are omitted and placeholder titles are regenerated from ids.
- Added Browser shell-state persistence/privacy coverage: loaded tab URLs and history are sanitized in memory, credentials/query strings/fragments/non-web schemes are excluded from persisted JSON and restore, runtime page titles and favicon URL/image/fetch metadata are cleared, and address-only/non-web tabs restore without history.
- Added command-pane shell-state coverage: mode, last expanded mode, height ratio, focused group, split ratio/layout, active sessions, and next ids restore while command titles, command text, stdout/stderr, paths, and content fields are not persisted.
- Added project-editor shell-state coverage: companion visibility/width ratio plus lifecycle state and recency counters restore, while injected/raw project paths and surface content do not appear after restore/reserialize.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 8 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (first wrapper failed on zsh read-only variable `status`, passed after rerun with `check_status`).
- Remaining gaps for later slices: behavior was verified by pure Rust model tests only, not in a running GPUI app by instruction; visual validation, real multi-CEF Browser lifecycle expansion, Browser profile persistence/import, feedback injection, Source/Kanban/Manage CEF surfaces, libghostty terminal surfaces, and real process/content persistence boundaries remain deferred.

### 2026-06-22-14:20 Task slice 63

- Added pure GPUI model regression coverage for Agents close behavior: active multi-tab closes select the right-side neighbor in the same pane, and final-tab split-branch closes collapse the emptied branch while focusing the pre-collapse visually adjacent surviving pane from the close-focus helper.
- Added Focus mode eligibility coverage against the pure workspace helpers: sleeping-only split panes are not eligible, do not count toward visible Focus-mode availability, and keep Focus mode unavailable when only one non-sleeping pane remains.
- Added Merge All Tabs coverage for a split Agents workspace: merge collapses the tree into the requested pane, keeps tab ids in tree render order, preserves terminal presentation states, selects the target pane's active session, clears Focus mode, and leaves a separate command-pane model unchanged.
- Added command final-close coverage through `CommandPaneModel::close_session` and `close_active_session`: command closes select neighboring sessions when possible, collapse emptied split branches while sessions remain, and collapse/remove the panel when the final command session closes.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 12 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps for later slices: behavior was verified by pure Rust model tests only, not in a running GPUI app by instruction; visual validation, real libghostty terminal surfaces, real command process creation/teardown, real Source/Kanban/Manage CEF surfaces, Browser profile persistence/import, feedback injection, and broader non-placeholder parity remain deferred.

### 2026-06-22-14:28 Task slice 64

- Added pure GPUI helper regression coverage for Browser first-open GitHub remote seeding: common GitHub remote forms canonicalize to `https://github.com/owner/repo` while stripping `.git`, credentials, query strings, and fragments, and non-GitHub, non-web, unsafe, or local values are ignored.
- Added Git config parsing coverage that picks a recognized GitHub `origin` remote when present, falls back to the first recognized non-origin GitHub remote when origin is unsafe, and returns no URL when all remote values are unsafe or local.
- Added Manage availability coverage proving the placeholder titlebar mode requires strict boolean `true` for both `debuggingMode` and `showBetaFeatures`; missing keys, false values, numeric values, and string-like truthy values stay disabled.
- Added project-editor auto-sleep settings coverage for the helper-level contract: Source reads code-editor keys, Browser reads browser-session keys, Kanban and Manage share project-editor keys, missing or malformed settings default enabled with the default duration, disabled booleans return `None`, and idle minutes follow the current default/clamp behavior.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 15 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps for later slices: behavior is covered by pure Rust helper tests only, not in a running GPUI app by instruction; visual validation, real libghostty terminal surfaces, real command process creation/teardown, real Source/Kanban/Manage CEF surfaces, Browser profile persistence/import, feedback injection, and broader non-placeholder parity remain deferred.

### 2026-06-22-14:33 Task slice 65

- Added pure GPUI Browser toolbar/action regression coverage for placeholder-only behavior: feedback action disablement stays scoped to `github.com`/`*.github.com`, profile menu placeholder item ids are bounded to New Profile and Import Browser Data notifications, and disabled label/unknown ids no-op through an extracted helper.
- Added history action safety coverage: out-of-bounds target indices no-op without mutating loaded tab URL, title, history, or runtime page metadata, while valid history jumps update URL/title/current index and clear runtime-only page title/favicon state so stale private page metadata does not carry across entries.
- Extracted `browser_profile_placeholder_action_message` in `gpui/src/main.rs` only; runtime profile action behavior remains notification-only and no real profile persistence/import, CEF profile work, feedback injection, app launch, app restart, or regular macOS app edits were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 16 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps for later slices: behavior is covered by pure Rust helper/model tests only, not in a running GPUI app by instruction; visual validation, real Browser profile persistence/import, feedback injection, real Source/Kanban/Manage CEF surfaces, libghostty terminal surfaces, and broader non-placeholder parity remain deferred.

### 2026-06-22-14:42 Task slice 66

- Added pure GPUI regression coverage for Agents keyboard tab cycling: forward and reverse cycling are scoped to the requested pane and include running, sleeping, mounting, restored/unmounted, and popped-out placeholder tabs without changing their presentation states.
- Added pure Browser cycling coverage: cycling stays inside the focused Browser pane, moves between address-only and restored/loaded placeholder tabs, and does not create runtime page metadata or CEF placeholder-surface state.
- Added pure command-pane cycling coverage proving Ctrl-tab style cycling remains inside the focused command group and leaves neighboring command groups unchanged.
- Extracted tiny pure project-editor companion visibility transitions and covered hide/restore semantics: close hides only the companion, hidden companion focus validates back to the Browser surface, restore revalidates companion focus, and stored width plus lifecycle/recency state are preserved.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 20 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps for later slices: behavior is covered by pure Rust model/helper tests only, not in a running GPUI app by instruction; visual validation, real CEF/browser lifecycle expansion, real Source/Kanban/Manage CEF surfaces, libghostty terminal surfaces, real command processes/content, and broader non-placeholder parity remain deferred.

### 2026-06-22-14:50 Task slice 67

- Added pure GPUI regression coverage for project-editor lifecycle recency: marking Source awake updates only Source state/recency, refreshes an already-awake Source recency, and increments `next_lifecycle_recency` without changing Browser, Kanban, or Manage.
- Added awake-cap coverage proving that when Source, Browser, Kanban, and Manage would all be awake, the cap keeps the active Manage mode and more recent inactive modes awake while sleeping the least-recent inactive project-editor mode.
- Added sleeping/no-op coverage proving `mark_mode_sleeping` is idempotent and preserves recency/other modes, while Agents remains outside `project_editor_modes`, has no lifecycle entry, and does not mutate project-editor recency or lifecycle state.
- Added selected sleeping-mode placeholder parity coverage through pure focus validation: Source, Browser, Kanban, and Manage remain valid selected layout participants without waking, refreshing recency, creating windows, or touching CEF/runtime surfaces.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 25 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps for later slices: behavior is covered by pure Rust model/helper tests only, not in a running GPUI app by instruction; visual validation, real CEF/browser lifecycle expansion, real Source/Kanban/Manage CEF surfaces, libghostty terminal surfaces, real command processes/content, and broader non-placeholder parity remain deferred.

### 2026-06-22-14:56 Task slice 68

- Added pure GPUI regression coverage for user-resizable split ratio parity: Agents workspace splits, Browser splits, and command-pane splits clamp to the shared `0.1..0.9` shell bounds and double-click-style reset returns each split to `0.5`.
- Added missing split-id evidence for Agents, Browser, and command models: `split_ratio` returns `None`, set/reset return `false`, and serialized layout state remains unchanged.
- Added command-pane height evidence proving default and reset height derive from the 125px command height and clamp to the 5%-90% fraction bounds for small, normal, and very tall content heights.
- Added project-editor companion width evidence proving normal spans clamp against the companion minimum and editor minimum, while constrained spans preserve the practical companion minimum through resize and reset.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 27 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps for later slices: behavior is covered by pure Rust model/helper tests only, not in a running GPUI app by instruction; visual validation, real CEF/browser lifecycle expansion, real Source/Kanban/Manage CEF surfaces, libghostty terminal surfaces, real command processes/content, and broader non-placeholder parity remain deferred.

### 2026-06-22-15:05 Task slice 69

- Added pure GPUI shell-focus validation regression coverage for Agents, Browser, project-editor companion, command-pane, and persisted previous non-command focus paths without creating GPUI windows, CEF entities, filesystem writes, app launch, app restart, or regular macOS app edits.
- Covered Agents pane focus validation: existing pane ids are retained only in Agents mode, stale pane ids fall back to the focused Agents default pane, and Agents focus in Browser mode defaults to the Browser surface.
- Covered Browser and project-editor focus validation: BrowserSurface is the Browser-mode default and remains valid even while the Browser lifecycle is sleeping, wrong-mode Browser focus falls back to the active project-editor default, companion focus requires the matching active mode plus visible companion, and hidden Browser/Source companions fall back to their main surfaces.
- Covered command focus and restore parity: CommandPane focus is valid only while command sessions exist, and shell-state `previousNonCommandFocus` restores only valid non-command targets while stale, hidden, wrong-mode, or command-pane values fall back to shellFocus/default as appropriate.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 32 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps for later slices: behavior is covered by pure Rust model/helper tests only, not in a running GPUI app by instruction; visual validation, real CEF/browser lifecycle expansion, real Source/Kanban/Manage CEF surfaces, libghostty terminal surfaces, real command processes/content, and broader non-placeholder parity remain deferred.

### 2026-06-22-15:11 Task slice 70

- Added pure GPUI drag/drop regression coverage for Agents workspace reorder/group/edge-split parity, including same-pane reorder, center grouping into a target tab group, active-tab edge split into a new pane, split axis/order, and preservation of sleeping, restored/unmounted, popped-out, mounting, and running placeholder session identity.
- Added Browser drag/drop coverage proving same-pane reorder, center grouping, and own-pane edge split preserve stable `BrowserTabId` records, URL/state/history, runtime page title and favicon metadata, active selection, and the absence of synthetic CEF placeholder-surface creation.
- Added command-pane and drop-zone coverage proving same-group reorder stays in one group, top/bottom command drops group rather than vertically split, left/right creates command split groups only, workspace-to-command placeholder creation preserves the visible Agents title, the final-root Agents close guard stays false, workspace edge bands distinguish center/left/right/top/bottom, and command drop zones map top/bottom to center.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 35 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps for later slices: behavior is covered by pure Rust model/helper tests only, not in a running GPUI app by instruction; visual validation, real CEF/browser lifecycle expansion, real Source/Kanban/Manage CEF surfaces, libghostty terminal surfaces, real command processes/content, and broader non-placeholder parity remain deferred.

### 2026-06-22-15:19 Task slice 71

- Added pure GPUI directional-focus regression coverage without GPUI windows, CEF entities, libghostty surfaces, processes, runtime filesystem writes, app launch, app restart, or regular macOS app edits.
- Covered geometry-first Cmd-Alt focus ranking: `nearest_spatial_focus_target` follows rendered bounds rather than flat render order, rejects candidates outside the requested half-plane, and keeps deterministic order tie-breaks available.
- Covered Agents split-pane placeholder focusability: sleeping, mounting, restored/unmounted, and popped-out placeholder panes remain rendered directional-focus candidates from a running pane.
- Covered command-pane participation and exclusion: expanded command groups are directional candidates from workspace and project-editor surfaces, while collapsed or no-session command panes are omitted from fallback target lists.
- Covered project-editor scoping and no-geometry fallback ordering through pure helpers: Browser/Source targets stay scoped to the active project-editor mode instead of Agents, Left/Up use previous order, Right/Down use next order, and command targets are appended only when expanded with sessions.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 39 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps for later slices: behavior is covered by pure Rust helper/model tests only, not in a running GPUI app by instruction; visual validation, real CEF/browser lifecycle expansion, real Source/Kanban/Manage CEF surfaces, libghostty terminal surfaces, real command processes/content, and broader non-placeholder parity remain deferred.

### 2026-06-22-15:30 Task slice 72

- Matched GPUI titlebar Manage presentation to the current macOS gate: Agents, Source, Browser, and Kanban remain visible, while Manage is omitted from the switcher until Debugging Mode and Show Beta Features are both strict boolean true.
- Added a pure `titlebar_mode_switcher_modes` helper so rendering uses the same ordered list shape as the source-of-truth titlebar, with Manage inserted beside Kanban only when available.
- Preserved `set_active_mode`, hotkey, restored-state, and persistence safety through the existing `titlebar_mode_available` guard, so unavailable Manage still cannot become active even through non-render paths.
- Kept the existing colored Manage placeholder as the only Manage surface when the gate is open; no CEF, file bridge, libghostty, process, overlay, native macOS app, app launch, or app restart behavior was added.
- Added pure regression coverage for the titlebar mode list and expanded the strict Manage settings gate cases for missing, false, null, malformed value, string truthy, and numeric truthy settings.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (first run failed on an iterator/context lifetime in `render_mode_switcher`, then passed after switching to an explicit builder loop, 40 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps for later slices: behavior is covered by pure Rust helper/model tests only, not in a running GPUI app by instruction; visual validation, projectless Manage/Kanban availability signals, real Source/Kanban/Manage CEF surfaces, libghostty terminal surfaces, and broader non-placeholder parity remain deferred.

### 2026-06-22-15:39 Task slice 73

- Added GPUI shell-level Quick/projectless titlebar availability using a strict `GHOSTEX_GPUI_PROJECT_IS_QUICK=true` bridge until the GPUI project model exists; the signal is read only for availability and is not logged or persisted.
- Replaced the titlebar mode list with `TitlebarModeSwitcherItem` entries so Agents and Source remain selectable, Browser and Kanban stay visible but disabled in Quick context, and Manage stays hidden until Debugging Mode plus Show Beta Features are both true, then becomes visible but disabled in Quick context.
- Routed `set_active_mode`, Option workarea hotkeys, restored `activeMode`, and persisted `activeMode` through the same context availability guard so Browser, Kanban, and Manage are rejected in Quick/projectless context beyond rendering.
- Follow-up guarded direct Browser activation routes through the same titlebar availability check: address commits, toolbar commands, profile/feedback/devtools placeholders, history navigation, tab selection/focus, Cmd+N, pane-menu new/split actions, and popup callbacks now no-op in Quick/projectless context before mutating Browser state or assigning Browser active mode.
- Preserved placeholder boundaries: no real project routing, CEF, source editor, Manage file bridge, libghostty terminal surface, terminal process, overlay, hidden hit region, app launch, app restart, or regular macOS app edit was added.
- Added pure regression coverage for titlebar switcher item visibility/disabled states, Manage feature gating, and context-guard rejection for activation/restore/persisted active mode paths.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 42 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed after routing the runtime wrapper through the pure context helper to remove a dead-code warning, and passed again after the direct Browser activation guard follow-up); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps for later slices: behavior is covered by pure Rust helper/model tests only, not in a running GPUI app by instruction; the `GHOSTEX_GPUI_PROJECT_IS_QUICK` bridge should be replaced by real GPUI project/sidebar state later; visual validation, real Source/Kanban/Manage CEF surfaces, libghostty terminal surfaces, and broader non-placeholder parity remain deferred.

### 2026-06-22-15:55 Task slice 74

- Added command-pane tab to Agents pane-body placeholder transfer: hovering a command tab over an Agents pane body uses normal Agents group/split feedback, center drops group a new running Agents placeholder into the target pane, and left/right/top/bottom drops create a new Agents split pane with existing split semantics.
- Preserved placeholder boundaries and source removal order: the Agents placeholder receives only the command tab's visible title, no process/content/stdout/stderr/libghostty state is transferred, the command session is closed only after the Agents insertion succeeds, and final command-session close still collapses through existing command close semantics.
- Kept Agents tab strips out of scope for command drops; only Agents pane bodies accept the command-tab transfer in this slice.
- Added pure model regression coverage for center grouping, edge splitting, running placeholder/title preservation, focused/selected target pane behavior, final command-pane collapse after successful insertion, and failed insertion preserving the command source.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 43 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` with `diff_code` (passed).
- Remaining gaps for later slices: behavior is covered by pure Rust model tests only, not in a running GPUI app by instruction; visual validation, real libghostty terminal surfaces, real command process transfer/teardown, command text/stdout/stderr/content persistence, Source/Kanban/Manage CEF surfaces, code-server/file bridges, overlays, and broader non-placeholder parity remain deferred.

### 2026-06-22-16:04 Task slice 75

- Added command-pane tab to Agents tab-strip placeholder transfer: hovering a command tab over an Agents tab boundary or end target now uses the normal Agents insertion marker, while dropping inserts a new running Agents placeholder at that exact tab-strip index and selects/focuses the target Agents pane.
- Preserved command/Agents placeholder boundaries and source removal order: the inserted Agents tab receives only the command tab's visible title, no process/content/stdout/stderr/libghostty state or real Source/Kanban/Manage surface is transferred, command-tab drops do not reorder existing Agents tabs, and the command source closes only after the Agents insertion succeeds.
- Added a tab-strip-specific pure transfer helper with rollback if command close fails after insertion, plus pure regression coverage for requested-index insertion, end insertion, running presentation state, visible-title preservation, selected/focused target pane behavior, final command-pane collapse after successful insert, and failed insert preserving the command source.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 45 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` with `diff_code` (passed).
- Remaining gaps for later slices: behavior is covered by pure Rust model tests only, not in a running GPUI app by instruction; visual validation, real libghostty terminal surfaces, real command process transfer/teardown, command text/stdout/stderr/content persistence, Source/Kanban/Manage CEF surfaces, code-server/file bridges, overlays, native/root hit-test exceptions, app launch/restart, and broader non-placeholder parity remain deferred.

### 2026-06-22-16:18 Task slice 76

- Added Agents workspace tab to command-pane tab-strip placeholder transfer: hovering an Agents tab over an expanded command tab boundary or end target now uses the normal command insertion marker, while dropping inserts a command-only placeholder at that exact command tab-strip index.
- Preserved placeholder boundaries and source removal order: the command placeholder receives only the visible Agents tab title, no libghostty state, terminal content, command text, stdout/stderr, process state, Source/Kanban/Manage surface, CEF state, overlay, hidden hit region, or native/root hit-test routing is transferred, and the Agents source closes only after command insertion succeeds.
- Added requested-index command insertion and a transactional pure transfer helper with final-root Agents guard plus rollback if source close fails after insertion.
- Added pure regression coverage for requested-index insertion, end insertion, visible-title preservation, target command group focus/selection/expansion, final-root Agents guard/source preservation, source close after successful insert, invalid-target source preservation, and inserted-command rollback on source-close failure.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 48 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` with `diff_code` (passed).
- Remaining gaps for later slices: behavior is covered by pure Rust model tests only, not in a running GPUI app by instruction; visual validation, real libghostty terminal surfaces, real command process transfer/teardown, command text/stdout/stderr/content persistence, Source/Kanban/Manage CEF surfaces, code-server/file bridges, overlays, native/root hit-test exceptions, app launch/restart, and broader non-placeholder parity remain deferred.

### 2026-06-22-16:27 Task slice 77

- Added semantic placeholder status metadata for GPUI Agents terminal sessions: `idle`, `working`, and `attention` activity plus a `delayedSendActive` boolean. Delayed Send takes priority over attention, working, and idle; attention takes priority over working/idle through the activity vocabulary.
- Replaced running Agents tab-dot colors with semantic status colors: idle/agent green, working orange, attention `#95d7f6`, and delayed-send yellow, with inactive dots subdued while staying semantically colored. Sleeping, mounting, restored/unmounted, and popped-out tabs keep lifecycle colors.
- Seeded the default placeholder Agents workspace with visible running examples for idle, working, attention, and delayed-send status while keeping all terminal bodies placeholder-only and preserving lifecycle placeholder examples.
- Persisted only safe enum/boolean shell metadata for Agents tab status through the existing GPUI shell-state path; private terminal titles, deadlines, labels, command text, stdout/stderr, paths, tokens, and terminal content remain omitted/regenerated.
- Added pure regression coverage for status priority/color mapping, default seed status coverage, and shell-state round-trip/privacy boundaries for the new metadata.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed; run again after the warning cleanup); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, final run 50 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (first run passed with a dead-code warning, final run passed clean after using the status slug in the rendered tab-dot id); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` with `diff_code` (first attempt used zsh's read-only `status` variable, rerun passed).
- Remaining gaps for later slices: behavior is covered by pure Rust model/helper tests only, not in a running GPUI app by instruction; status remains placeholder shell metadata with no real agent process/status hook, delayed-send deadline/label storage, libghostty terminal surface, command/browser changes, Source/Kanban/Manage real surfaces, app launch/restart, or visual validation.

### 2026-06-22-16:40 Task slice 78

- Added semantic placeholder status metadata for GPUI command-pane terminal sessions: `idle`, `working`, and `attention` activity plus a `delayedSendActive` boolean. Delayed Send takes priority over attention, working, and idle; attention and working remain the safe command/sidebar activity vocabulary.
- Rendered command-pane tab dots from semantic command status instead of active/inactive only: idle keeps the command-specific blue, working uses orange, attention uses `#95d7f6`, and delayed-send uses yellow, with inactive dots subdued while preserving their semantic hue. Command drag previews carry the same semantic dot as the source command tab.
- Seeded the default command pane modestly with one idle blue command tab and one working command tab, keeping command terminal bodies as black placeholders and avoiding real command process/status hooks.
- Persisted only safe enum/boolean command status metadata through the GPUI shell-state command pane model; command text, stdout/stderr, terminal content, delayed-send deadlines/countdown labels, paths, tokens, and private titles remain omitted/regenerated.
- Added pure regression coverage for command status priority/color mapping, default command seed status coverage, and command shell-state round-trip/privacy boundaries for the new metadata.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 52 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` with `diff_code` (passed).
- Remaining gaps for later slices: behavior is covered by pure Rust model/helper tests only, not in a running GPUI app by instruction; status remains placeholder shell metadata with no real command process/status hook, delayed-send deadline/label storage, libghostty terminal surface, Source/Kanban/Manage real surfaces, app launch/restart, or visual validation.

### 2026-06-22-16:54 Task slice 79

- Added a render-only GPUI Browser tab chrome status derived from `BrowserTabState` plus runtime CEF surface presence: loaded tabs with a materialized surface stay Browser blue, restored loaded placeholders without a surface use restored teal, and address-only tabs remain neutral.
- Wired Browser tab rendering and drag previews to derive surface presence from `browser_surfaces.contains_key(&tab_id)` so restored/no-surface loaded tabs are visible as placeholders in tab chrome without adding persisted Browser metadata.
- Preserved favicon privacy and placeholder boundaries: runtime favicon URL/image/fetch state remains transient, restored placeholders and address-only tabs do not render or fetch runtime favicon state, Browser CEF surfaces are not created from render/chrome, Source/Kanban/Manage remain colored placeholders, and libghostty terminal surfaces remain black placeholders.
- Added pure regression coverage for Browser chrome-status classification, color mapping, and runtime favicon gating for loaded-with-surface, restored/no-surface loaded, and address-only tab states.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 54 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` with `diff_code` (passed).
- Remaining gaps for later slices: behavior is covered by pure Rust helper tests only, not in a running GPUI app by instruction; visual validation, real Browser lifecycle expansion beyond current placeholder materialization, real Source/Kanban/Manage CEF surfaces, libghostty terminal surfaces, app launch/restart, and broader non-placeholder parity remain deferred.

### 2026-06-22-17:02 Task slice 80

- Codified Agents workspace tab double-click Focus mode parity in a pure `WorkspaceModel` helper: the clicked tab is selected and its pane is focused before Focus mode is toggled.
- Routed `render_workspace_tab` double-click handling through the helper while keeping ordinary single-click selection unchanged.
- Preserved placeholder boundaries: sleeping-only panes can be selected/focused by double-click without waking/materializing, Focus mode still exits on a second double-click without mutating terminal presentation states, and helper calls against a different pane while Focus mode is active first select that pane and then exit Focus mode.
- Added pure regression coverage for enter/exit double-click behavior, sleeping-only no-wake behavior, and the active-Focus-mode different-pane helper semantics.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 57 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` with `diff_code` (passed).
- Remaining gaps for later slices: behavior is covered by pure Rust model tests only, not in a running GPUI app by instruction; real libghostty terminal surfaces, real terminal process lifecycle, real Source/Kanban/Manage CEF surfaces, visual validation, app launch/restart, and broader non-placeholder parity remain deferred.

### 2026-06-22-17:10 Task slice 81

- Codified Agents workspace tab chrome visual inputs with a pure signature: terminal presentation lifecycle, semantic tab status, and active membership inside the tab group.
- Routed Agents tab rendering through the shared signature helper so pane focus remains excluded from tab text/icon/dot/badge visual inputs while existing colors and placeholder behavior stay unchanged.
- Added pure regression coverage proving focused-pane changes do not alter tab chrome signatures, active vs inactive membership remains visible in the signature, sleeping/mounting/restored/popped-out lifecycle states remain distinct signature inputs, and running semantic statuses from slice 77 still appear.
- Preserved placeholder boundaries: no libghostty terminal processes/surfaces, CEF/code-server/Manage bridges, real Source/Kanban/Manage surfaces, overlays, hidden hit regions, native/root hit-test routing, app launch, app restart, or regular macOS app edits were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed; rerun after a warning cleanup); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 60 `src/main.rs` tests and 0 helper-bin tests; rerun after warning cleanup); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (first pass passed with a test-only dead-code warning, final rerun passed clean); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` with `diff_code` (passed).
- Remaining gaps for later slices: behavior is covered by pure Rust helper/model tests only, not in a running GPUI app by instruction; real libghostty terminal surfaces, real terminal process lifecycle, real Source/Kanban/Manage CEF surfaces, visual validation, app launch/restart, and broader non-placeholder parity remain deferred.

### 2026-06-22-17:17 Task slice 82

- Codified Browser native tab chrome visual inputs with a pure signature: `BrowserTabState`, render-only `BrowserTabChromeStatus` derived from per-tab CEF surface presence, and active membership inside the Browser pane's tab group.
- Routed Browser tab rendering through the signature helper so `BrowserTabModel.focused_pane` remains excluded from tab text/icon/status/active visual inputs while the existing Browser palette and slice 79 loaded/restored/address-only chrome behavior stay unchanged.
- Added pure regression coverage proving Browser pane focus changes do not alter tab chrome signatures, active vs inactive Browser tabs remain distinct signature inputs, and loaded+surface, loaded+no-surface/restored-placeholder, and address-only inputs remain distinct.
- Preserved placeholder boundaries: no new CEF lifecycle behavior, real terminal processes, libghostty surfaces, CEF/code-server/Manage bridges, Source/Kanban/Manage real surfaces, overlays, hidden hit regions, native/root hit-test routing, app launch, app restart, or regular macOS app edits were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 63 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` with `diff_code` (passed).
- Remaining gaps for later slices: behavior is covered by pure Rust helper/model tests only, not in a running GPUI app by instruction; visual validation, broader Browser lifecycle parity beyond current placeholder materialization, real Source/Kanban/Manage CEF surfaces, libghostty terminal surfaces, app launch/restart, and broader non-placeholder parity remain deferred.

### 2026-06-22-17:23 Task slice 83

- Codified command-pane native tab chrome visual inputs with a pure signature: semantic `CommandTerminalTabStatus` plus active membership inside the command tab group.
- Routed command tab rendering through the signature helper while preserving the existing command palette, status-dot opacity behavior, black command terminal placeholders, and command-only placeholder model behavior.
- Added pure regression coverage proving `CommandPaneModel.focused_group` changes do not alter command tab chrome signatures, active vs inactive command tabs remain distinct signature inputs, and idle/working/attention/delayed-send semantic command statuses remain distinct.
- Preserved placeholder boundaries: no real command process behavior, libghostty terminal surfaces, CEF/code-server/Manage bridges, Source/Kanban/Manage real surfaces, overlays, hidden hit regions, native/root hit-test routing, app launch, app restart, or regular macOS app edits were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 66 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` with `diff_code` (passed).
- Remaining gaps for later slices: behavior is covered by pure Rust helper/model tests only, not in a running GPUI app by instruction; real command process/session behavior, real libghostty terminal surfaces, visual validation, real Source/Kanban/Manage CEF surfaces, app launch/restart, and broader non-placeholder parity remain deferred.

### 2026-06-22-17:31 Task slice 84

- Codified Agents workspace tab lifecycle visual tone as a pure role derived from terminal presentation state plus active membership inside the tab group: selected running, inactive running, selected non-running, and inactive non-running.
- Routed Agents tab text, lifecycle icon glyphs, status dots, and lifecycle badges through the explicit tone while preserving the existing palette, opacity constants, black libghostty terminal placeholders, and colored Source/Kanban/Manage placeholders.
- Added pure regression coverage for running, sleeping, mounting, restored/unmounted, and popped-out tabs in both selected and inactive roles, proving selected non-running tabs use selected treatment while inactive non-running tabs stay subdued and keep lifecycle identity.
- Preserved placeholder boundaries: no real terminal processes, libghostty surfaces, CEF/code-server/Manage bridges, overlays, hidden hit regions, native/root hit-test routing, app launch, app restart, or regular macOS app edits were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 67 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` with `diff_code` (passed).
- Remaining gaps for later slices: behavior is covered by pure Rust helper/model tests only, not in a running GPUI app by instruction; real libghostty terminal surfaces, real terminal process lifecycle, visual validation, real Source/Kanban/Manage CEF surfaces, app launch/restart, and broader non-placeholder parity remain deferred.

### 2026-06-22-17:36 Task slice 85

- Codified Source, Kanban, and Manage GPUI project-editor placeholder identity with a pure `ProjectEditorPlaceholderSignature`: mode, title, message, and semantic color identity.
- Routed the active non-Browser project-editor placeholder renderer through the signature while preserving the existing Source teal, Kanban purple, and Manage pink palettes. Browser remains routed to CEF, and Agents/libghostty terminal bodies remain separate black placeholders.
- Added pure regression coverage proving Source, Kanban, and Manage have distinct placeholder signatures/color identities, while Browser and Agents are excluded from the non-Browser colored placeholder classifier.
- Preserved placeholder boundaries: no real Source/code-server, Kanban CEF, Manage CEF/file bridge, Browser CEF behavior change, libghostty terminal surface, app launch, app restart, or regular macOS app edit was added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed; rerun after warning cleanup); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (first run passed 69 `src/main.rs` tests and 0 helper-bin tests with one dead-code warning, final rerun passed 69 `src/main.rs` tests and 0 helper-bin tests without warnings); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (first wrapper attempt used zsh's read-only `status` variable and failed before checking, rerun passed).
- Remaining gaps for later slices: behavior is covered by pure Rust helper tests only, not in a running GPUI app by instruction; real Source/Kanban/Manage surfaces, visual validation, app launch/restart, real libghostty terminal surfaces, and broader non-placeholder parity remain deferred.

### 2026-06-22-17:45 Task slice 86

- Codified selected sleeping/restored project-editor placeholder identity with a pure `ProjectEditorSleepingPlaceholderSignature`: mode, badge label, title, message, action label, and semantic color identity.
- Routed the selected sleeping/restored project-editor body through the signature while preserving the existing text and palettes. Source, Browser, Kanban, and Manage stay distinct layout participants; Browser keeps the blue hidden-CEF identity, while Source/Kanban/Manage remain placeholder-only colored bodies.
- Added pure regression coverage proving Source, Browser, Kanban, and Manage sleeping signatures are distinct, Agents is excluded, and Browser sleeping identity remains separate from the active non-Browser `ProjectEditorPlaceholderSignature` classifier.
- Preserved placeholder boundaries: no real Source/code-server, Kanban CEF, Manage CEF/file bridge, Browser CEF behavior change, libghostty terminal surface, app launch, app restart, or regular macOS app edit was added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 71 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps for later slices: behavior is covered by pure Rust helper tests only, not in a running GPUI app by instruction; real Source/Kanban/Manage surfaces, visual validation, app launch/restart, real libghostty terminal surfaces, and broader non-placeholder parity remain deferred.

### 2026-06-22-17:51 Task slice 87

- Audited `docs/gpui-workspace-area-parity-requirements.md` against current `gpui/src/main.rs` and this progress log for remaining placeholder-shell workspace behavior only.
- Found no confirmed small missing placeholder-shell parity gap outside the categories already intentionally deferred or excluded by this slice.
- Checked current evidence for Agents tab/split/close/focus/drag/drop shell behavior, command-pane modes/layout/drag/drop/focus behavior, Browser tab/split/restored-placeholder/CEF-visibility shell behavior, project-editor companion/availability/sleeping-placeholder behavior, and placeholder persistence/privacy coverage.
- Files touched: `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `sed -n '1,240p' ~/.agents/main.md`; `git status --short`; `sed -n '1,260p' docs/gpui-workspace-area-parity-requirements.md`; `sed -n '1,260p' gpui/WORKSPACE_PARITY_PROGRESS.md`; `rg -n "^### 2026-06-22" gpui/WORKSPACE_PARITY_PROGRESS.md`; targeted `sed` and `rg` audits over `gpui/WORKSPACE_PARITY_PROGRESS.md`, `docs/gpui-workspace-area-parity-requirements.md`, and `gpui/src/main.rs`; `date '+%Y-%m-%d-%H:%M'`; `git diff --check -- gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps: real libghostty terminal surfaces and real terminal/command processes; real Source/code-server, Kanban CEF, and Manage CEF/file-bridge surfaces; Browser runtime/lifecycle expansion beyond the current CEF placeholder shell; Browser profile persistence/import and feedback injection; replacement of the temporary `GHOSTEX_GPUI_PROJECT_IS_QUICK` bridge with real GPUI project/sidebar state; app launch/restart and visual automation/validation; broader non-placeholder parity.

### 2026-06-22-18:00 Task slice 88

- Centralized GPUI project-scoped titlebar availability behind typed `GpuiProjectContext` and `ProjectScopedWorkareaAvailability` helpers so titlebar mode lists, action guards, restored active mode, and persisted active mode all derive availability from one typed source.
- Kept the temporary `GHOSTEX_GPUI_PROJECT_IS_QUICK=true` runtime bridge strict and isolated: only exact `true` maps to Quick/projectless context, missing or any other value maps to normal project context, and no `.git`, path, workspace-name, or fallback project detection was added.
- Preserved current behavior and slice boundaries: Agents and Source remain selectable, Browser and Kanban are disabled in Quick/projectless context, Manage remains gated by strict Debugging Mode plus Show Beta Features and is disabled without a project when visible, libghostty terminal bodies stay black placeholders, and Source/Kanban/Manage stay colored placeholders.
- Added pure regression coverage for typed titlebar availability snapshots, Quick/projectless activation/restore fallback to Agents, Manage mode-list hiding until the feature gate opens, and the strict env-bridge parser that can later be replaced by real GPUI project/sidebar state.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `sed -n '1,220p' ~/.agents/main.md`; `git status --short`; targeted `rg` and `sed` inspections over `gpui/src/main.rs` and `gpui/WORKSPACE_PARITY_PROGRESS.md`; `git diff -- gpui/src/main.rs | sed -n '1,260p'`; `date +%Y-%m-%d-%H:%M`; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 72 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps: replacement of the temporary `GHOSTEX_GPUI_PROJECT_IS_QUICK` bridge with real GPUI project/sidebar state; real libghostty terminal surfaces and real terminal/command processes; real Source/code-server, Kanban CEF, and Manage CEF/file-bridge surfaces; Browser runtime/lifecycle expansion beyond the current CEF placeholder shell; app launch/restart and visual automation/validation were not run by instruction; broader non-placeholder parity remains deferred.

### 2026-06-22-18:03 Task slice 89

- Audited the slice 88 project-context bridge gap and found no reliable GPUI-owned active project context exposed to Rust yet, so no code replacement was made.
- Verified the GPUI app still owns only `project_name`, `sidebar_url`, CEF sidebar surface state, Browser/project-editor shell state, and the typed titlebar availability helpers; it does not store or receive active project id/name/path/isQuick from the embedded sidebar.
- Verified `gpui/sidebar/phase1-main.tsx` mounts the real sidebar through the Storybook harness with the `combined-sparse-reference` fixture, and `sidebar/sidebar-story-harness.tsx` keeps fixture workspace updates inside the page via `window.postMessage`; the current GPUI CEF wrapper forwards Browser popup/page metadata only and has no JavaScript/process-message bridge for sidebar active-project context.
- Verified the current macOS/native source of truth still posts `activeProjectIsQuick` through the AppKit/native layout sync command, but that command is not connected to the GPUI prototype architecture.
- Kept the strict `GHOSTEX_GPUI_PROJECT_IS_QUICK=true` bridge unchanged and isolated rather than adding `.git`, path, project-name, fixture, or other fallback project detection.
- Files touched: `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `sed -n '1,240p' ~/.agents/main.md`; `git status --short`; `sed -n '1,260p' docs/gpui-workspace-area-parity-requirements.md`; `tail -n 260 gpui/WORKSPACE_PARITY_PROGRESS.md`; targeted `rg` and `sed` inspections over `gpui/src/main.rs`, `gpui/src/cef/macos.rs`, `gpui/sidebar/phase1-main.tsx`, `sidebar/sidebar-story-fixtures.ts`, `sidebar/sidebar-story-workspace.ts`, `sidebar/sidebar-story-harness.tsx`, and `native/sidebar/native-sidebar.tsx`; `date '+%Y-%m-%d-%H:%M'`; `git diff --check -- gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (first wrapper attempt used zsh's read-only `status` variable and failed before checking, rerun with `diff_code` passed).
- Remaining gaps: replacement of the temporary `GHOSTEX_GPUI_PROJECT_IS_QUICK` bridge still requires a real GPUI sidebar/project-state bridge; real libghostty terminal surfaces and real terminal/command processes; real Source/code-server, Kanban CEF, and Manage CEF/file-bridge surfaces; Browser runtime/lifecycle expansion beyond the current CEF placeholder shell; app launch/restart and visual automation/validation were not run by instruction; broader non-placeholder parity remains deferred.

### 2026-06-22-18:07 Task slice 90

- Performed the final focused placeholder-shell audit after slices 87-89 by comparing `docs/gpui-workspace-area-parity-requirements.md`, this progress log, and `gpui/src/main.rs`.
- Found no remaining small GPUI-only placeholder-shell parity gap that can be implemented without real libghostty/processes, real Source/code-server, Kanban/Manage CEF/file bridges, app launch/restart, or a real sidebar/project-state bridge.
- Rechecked the likely gap areas in code: Browser first-open GitHub seed, Browser history/favicons/NativeMenus, Browser split visibility and resizing, project-editor auto-sleep timers/settings, Agents/command-pane cross-drag, pane/tab native menus, tab edge-reveal chrome, sleeping/restored placeholder selection, and the strict temporary project-context env bridge.
- Files touched: `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: `sed -n '1,240p' ~/.agents/main.md`; `git status --short -- gpui docs/gpui-workspace-area-parity-requirements.md`; `sed -n '1,260p' docs/gpui-workspace-area-parity-requirements.md`; targeted `tail`, `rg`, and `sed` audits over `gpui/WORKSPACE_PARITY_PROGRESS.md` and `gpui/src/main.rs`; `date '+%Y-%m-%d-%H:%M'`; `git diff --check -- gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining deferred/blocker gaps: real libghostty terminal surfaces and real terminal/command process lifecycle; real Source/code-server, Kanban CEF, and Manage CEF/file-bridge surfaces; replacement of the temporary `GHOSTEX_GPUI_PROJECT_IS_QUICK` bridge with a real GPUI sidebar/project-state bridge; Browser profile persistence/import, feedback injection, and runtime lifecycle work beyond the current placeholder shell; app launch/restart and visual automation/validation were intentionally not run; broader non-placeholder parity remains deferred.

### 2026-06-22-19:25 Task slice 91

- Started Phase 1 real project/sidebar bridge work by adding a typed GPUI project snapshot and strict active-project sidebar contract parser in Rust, without wiring live CEF sidebar messages yet.
- The snapshot can carry active project id, display name, in-memory-only project path, Quick/projectless state, project-scoped feature availability, and future Source/Browser/Kanban/Manage surface ids. CDXC comments document that display names, paths, and surface ids are private runtime facts and must not be serialized or logged.
- Added a narrow allowlisted JSON contract for `ghostex.gpui.sidebar.activeProjectContext` version 1. The parser rejects malformed JSON, non-object messages, unknown keys, unsupported versions, unexpected message types, malformed field types, and inconsistent Quick/projectless payloads that include project ids, paths, surface ids, or enabled project-only workareas.
- Routed `ProjectScopedWorkareaAvailability` through the new typed feature-availability shape while keeping the existing strict `GHOSTEX_GPUI_PROJECT_IS_QUICK=true` env bridge intact as the temporary runtime source until live sidebar messages are connected.
- Added pure regression coverage for valid project snapshots, valid Quick/projectless snapshots, malformed/rejected messages, and the privacy-boundary JSON that omits raw project ids, display names, paths, and surface ids.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted `sed`, `rg`, and `git diff` review over `gpui/src/main.rs`, `gpui/src/cef/macos.rs`, `gpui/sidebar/phase1-main.tsx`, `sidebar/sidebar-story-harness.tsx`, and `gpui/WORKSPACE_PARITY_PROGRESS.md`; `date '+%Y-%m-%d-%H:%M'`; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 76 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed).
- Remaining gaps: live CEF sidebar-to-Rust message delivery is still not wired; `ProjectScopedWorkareaAvailability::current()` still uses the temporary env bridge at runtime; Browser first-tab GitHub seeding still contains the earlier `.git/config` helper and should be replaced with real snapshot project data in a later Phase 1 slice; real libghostty terminal surfaces, real Source/Kanban/Manage CEF surfaces, app launch/restart, and visual validation remain deferred by instruction.

### 2026-06-22-19:41 Task slice 92

- Added the live Phase 1 CEF sidebar-to-Rust active-project message path for the slice-91 contract while keeping runtime titlebar availability on the temporary strict env bridge.
- Sidebar CEF clients now attach a project-context handler and a sidebar-only load handler that sends a private renderer install message; ordinary Browser CEF clients do not attach this load handler, and non-sidebar clients leave the active-project message unhandled.
- The renderer helper installs only `window.ghostexGpui.postActiveProjectContext(json)` after receiving `ghostex.gpui.sidebar.installActiveProjectContextBridge`; the embedded GPUI sidebar posts a deterministic v1 active-project context with `projectPath: null` and retries briefly until the bridge is installed.
- GPUI stores the latest parsed `GpuiProjectSnapshot` in memory only; malformed payloads leave the existing snapshot unchanged; no raw JSON/project names/paths/URLs/titles/tokens/cookies/file contents are logged or persisted.
- Added pure regression coverage for replacing latest snapshot, preserving it on malformed payload, and proving stored sidebar snapshots do not replace the env bridge as availability source yet.
- Files touched: `gpui/src/main.rs`, `gpui/src/cef/macos.rs`, `gpui/src/cef/unsupported.rs`, `gpui/src/bin/ghostex_gpui_cef_helper.rs`, `gpui/sidebar/phase1-main.tsx`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted `sed`, `nl`, `rg`, and `git diff` review over the touched GPUI bridge files; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (first pass caught a render-process callback signature mismatch after the sidebar-only install correction, final pass succeeded with 78 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `bun run typecheck` (passed).
- Remaining gaps: `ProjectScopedWorkareaAvailability::current()` still uses `GHOSTEX_GPUI_PROJECT_IS_QUICK` instead of the live sidebar snapshot; active project changes do not yet update titlebar availability or fallback active modes; Browser first-tab GitHub seeding still contains the earlier `.git/config` helper and should be removed or replaced with snapshot-driven data; runtime CEF delivery has not been app-verified because app launch/restart is not allowed without user request; real libghostty and real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-19:50 Task slice 93

- Made App-owned runtime workarea availability prefer the latest valid in-memory sidebar `GpuiProjectSnapshot`, with `ProjectScopedWorkareaAvailability::current()` retained only as the strict env bridge fallback before the sidebar reports.
- Routed titlebar mode switcher rendering, App-owned Browser/workarea activation guards, persisted shell-state serialization, and active-mode coercion through the App helper so stored Quick/projectless snapshots disable Browser/Kanban/Manage even when the env fallback says a normal project exists.
- Valid sidebar context updates now coerce a newly unavailable active mode back through the existing Agents fallback, hide Browser CEF through the normal visibility gate, reschedule project-editor sleep polling, and persist only shell mode/focus state. Malformed payloads still leave the previous snapshot and active mode unchanged.
- Kept restore-time state construction on the env fallback because no live sidebar snapshot exists before App runtime delivery, and did not persist/log project ids, names, paths, URLs, titles, raw JSON, tokens, cookies, or user content.
- Replaced the slice-92 env-source regression with pure coverage for snapshot precedence over normal/quick env fallbacks, disabled active-mode fallback, and malformed-payload preservation.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted `sed`, `rg`, and `git diff` review over `gpui/src/main.rs`; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 81 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/src/cef/unsupported.rs gpui/src/bin/ghostex_gpui_cef_helper.rs gpui/sidebar/phase1-main.tsx gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: Browser first-tab GitHub seeding still contains the earlier `.git/config` helper and should be removed or replaced with snapshot-driven data; Phase 1 still uses a deterministic GPUI sidebar fixture payload rather than real active project state from the shared sidebar store; runtime CEF delivery has not been app-verified because app launch/restart is not allowed without user request; real libghostty and real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-19:55 Task slice 94

- Removed the fake Browser first-tab GitHub remote seed from GPUI. Fresh/default Browser shell state now uses only the static `DEFAULT_BROWSER_URL` until a future real sidebar/project snapshot contract carries an explicit browser start URL.
- Deleted the `.git/config` Browser seed helpers and the old canonical GitHub remote regression. `gpui/src/main.rs` no longer contains `github_remote`, `git_config`, `canonical_github`, `.git/config`, or `browser_github_remote` seed code.
- Updated CDXC comments for Browser defaults and parity tests to state that Phase 1 must not infer Browser start URLs from `.git`, filesystem paths, workspace names, fixture names, or sidebar titles.
- Added pure coverage proving `browser_shell_default_url()` returns the static default and `BrowserTabModel::shell_default()` seeds exactly one loaded tab with that URL, title, active tab, focused pane, and single-entry history.
- Left the separate GPUI project-title fallback from `GHOSTEX_GPUI_PROJECT_NAME` or the repo folder name unchanged for a later slice; this slice only removed Browser start-page inference.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted `sed`, `rg`, and `git diff` review over Browser default helpers/tests; `rg -n "GitHub remote seeding|browser_github_remote|canonical_github|github_remote|git_config|\\.git/config" gpui/src/main.rs` (no matches); `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 81 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/src/cef/unsupported.rs gpui/src/bin/ghostex_gpui_cef_helper.rs gpui/sidebar/phase1-main.tsx gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: Phase 1 still uses a deterministic GPUI sidebar fixture payload rather than real active project state from the shared sidebar store; the titlebar project label still falls back to env/repo-folder naming instead of the live sidebar snapshot; runtime CEF delivery has not been app-verified because app launch/restart is not allowed without user request; real libghostty and real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-20:00 Task slice 95

- Made the GPUI titlebar project label runtime-only sidebar snapshot state. Startup now shows the static neutral `Ghostex` label until a valid sidebar active-project payload is received.
- Valid sidebar payloads update `self.project_name` from the stored `GpuiProjectSnapshot.display_name` in memory only, after the strict active-project contract parser accepts the payload. Malformed payloads leave the previous label, snapshot, availability, and active mode unchanged.
- Removed the old titlebar label fallback that read `GHOSTEX_GPUI_PROJECT_NAME` and then inferred a label from the repo folder. `gpui/src/main.rs` no longer contains `fn project_name()`, `gpui_project_root()`, or `GHOSTEX_GPUI_PROJECT_NAME`.
- Added CDXC comments documenting that titlebar labels must not be derived from env vars, repo folders, `.git`, workspace names, fixture names, paths, URLs, sidebar titles, persistence, or logs.
- Added pure coverage for the static fallback label, snapshot display-name label, and malformed-payload label preservation.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted `sed`, `rg`, and `git diff` review over titlebar label helpers, payload handling, and project-name references; `git diff --check -- gpui/src/main.rs` (passed before full verification); `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 84 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/src/cef/macos.rs gpui/src/cef/unsupported.rs gpui/src/bin/ghostex_gpui_cef_helper.rs gpui/sidebar/phase1-main.tsx gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: Phase 1 still uses a deterministic GPUI sidebar fixture payload rather than real active project state from the shared sidebar store; runtime CEF delivery has not been app-verified because app launch/restart is not allowed without user request; real libghostty and real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-20:08 Task slice 96

- Replaced the deterministic GPUI sidebar active-project fixture with a payload derived from explicit `SidebarStoryWorkspace` state. The GPUI embed now posts the latest workspace-derived active-project context through the existing CEF bridge retry path.
- Added a pure `createGpuiSidebarActiveProjectContextPayload` helper. Active chat collections or groups without explicit `projectContext` emit Quick/projectless payloads; active non-chat groups with explicit `projectContext` emit project payloads using `projectContext.editor.projectId`, the active group title as display label, `projectPath: null`, enabled project workareas, and empty surface ids.
- Added an optional `SidebarStoryHarness.onWorkspaceChange` callback so the GPUI embed observes the current Storybook workspace and later workspace changes directly, without inferring project identity from fixture names, sidebar labels alone, paths, `.git`, URLs, logs, or persisted state.
- Added focused TypeScript coverage for chat collection to Quick/projectless, explicit active project group to project payload, and title-only group without `projectContext` to Quick/projectless.
- Files touched: `gpui/sidebar/phase1-active-project-context.ts`, `gpui/sidebar/phase1-active-project-context.test.ts`, `gpui/sidebar/phase1-main.tsx`, `sidebar/sidebar-story-harness.tsx`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted `sed`, `rg`, and `git diff` review over the new helper, tests, GPUI sidebar entry, and Storybook harness; `bun run test -- gpui/sidebar/phase1-active-project-context.test.ts` (passed, 3 tests); `bun run typecheck` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 84 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); tracked-file `git diff --check` over touched GPUI/sidebar files (passed); no-index whitespace checks for untracked helper/test/progress files returned the expected diff status with no whitespace output.
- Remaining gaps: runtime CEF delivery has not been app-verified because app launch/restart is not allowed without user request; real libghostty and real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-20:16 Task slice 97

- Added a pure GPUI Agents terminal-body mount candidate boundary for rendered `WorkspaceLeaf` bodies. The candidate records pane id, active selected session id, and real-terminal-surface eligibility without creating a libghostty surface, process, fallback mount, logging, or shell persistence changes.
- Routed the Agents body renderer through that boundary: only an active selected `TerminalSessionPresentationState::Running` session renders the empty future libghostty mount slot; sleeping, mounting, restored/unmounted, popped-out, missing-session, and inactive running tabs stay in placeholder/card behavior.
- Kept the mount slot as the normal terminal body child below the Agents tab bar, preserving the non-overlapping sibling layout needed for a later real libghostty adapter to attach to exact body bounds without hidden hit regions or hit-test routing.
- Added focused Rust coverage for active running eligibility, non-running selected placeholders, inactive running tabs in the same group, missing selected sessions, and split-leaf pane/session identity preservation.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted `sed`, `rg`, `git diff`, and `date` review over the allowed GPUI files; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 89 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps: no real libghostty adapter or terminal process lifecycle is mounted yet; command-pane terminal bodies still need their own real-terminal boundary later; runtime app launch/restart and visual automation/validation were not run by instruction; real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-20:25 Task slice 98

- Refined the slice-97 Agents terminal-body boundary into an explicit presentation classification: future libghostty mount slot, running black placeholder, lifecycle placeholder, and missing-session placeholder.
- Limited real-terminal-surface eligibility to the focused visible Agents pane when its selected active session is `TerminalSessionPresentationState::Running`; other visible running leaves remain empty black running placeholders with no lifecycle/card child.
- Routed the Agents body renderer through the classification slug so the single future mount slot is distinguishable from running placeholders while preserving existing click/drop handling, black placeholder visuals, and shell persistence behavior.
- Added CDXC comments documenting the Phase 2 one-pane rollout rule and the deferred all-visible-leaves expansion.
- Added focused Rust coverage for the only eligible focused running leaf, non-focused visible running leaves as running placeholders, focused sleeping leaves blocking other running leaves from mounting, Focus mode visibility, and non-running/missing selected-session placeholders.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted `sed`, `rg`, and `date` review over the allowed GPUI files; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 89 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps: no real libghostty adapter, terminal surface mount, terminal process lifecycle, native bridge, logging, or shell persistence change exists yet; all-visible-running-leaf terminal mounting is deferred to a later expansion slice; command-pane terminal bodies still need their own boundary; app launch/restart and visual automation/validation were not run by instruction; real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-20:29 Task slice 99

- Added a typed runtime mount-slot identity for the one-pane Agents libghostty boundary: focused rendered pane id plus selected running session id.
- Added a pure `WorkspaceModel` helper and validator that return exactly the current one-pane mount slot, or none when the focused rendered leaf is sleeping/non-running, hidden by Focus mode, missing, or stale.
- Added App-owned runtime-only terminal body bounds storage for Agents mount slots, cleared with the other per-render bounds and validated against the current model slot before storing.
- Added a non-interactive GPUI canvas probe only inside the `MountSlot` terminal body so future libghostty native attachment can use the exact body rectangle below the tab bar while the existing body div still owns click/drop behavior.
- Kept the slice boundary intact: no fake terminal surface, libghostty runtime, terminal process, fallback mount, native bridge, logging, persistence, overlay, hidden hit region, app launch, or regular macOS app edit was added.
- Added focused Rust coverage for one focused rendered running leaf, focused sleeping blocking other visible running leaves, Focus mode limiting slots to the focused rendered leaf, non-focused running leaves being excluded, and stale pane/session validation.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted `sed`, `rg`, `git diff`, and `date` review over the allowed GPUI files; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 94 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps: no real libghostty adapter, terminal surface mount, terminal process lifecycle, native bridge, logging, or shell persistence change exists yet; all-visible-running-leaf terminal mounting is still deferred; command-pane terminal bodies still need their own real-terminal boundary; app launch/restart and visual automation/validation were not run by instruction; real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-20:35 Task slice 100

- Added a compile-safe GPUI GhosttyKit/libghostty adapter boundary with real exported handle types, macOS surface config structs, runtime config callback shape, constants, and inert C ABI declarations for future `ghostty_init`, config creation/finalization, app lifecycle, and surface create/size/focus calls.
- Added repo-local GhosttyKit header/archive path and availability helpers for tests/build diagnostics without canonicalizing, logging, persisting, or emitting private paths from the helper.
- Updated `gpui/build.rs` so Cargo reruns when the repo-local GhosttyKit header or static archive changes, while intentionally avoiding speculative link args or any runtime libghostty calls.
- Kept the slice boundary intact: no terminal surface was mounted or faked, no terminal process or command text/content was created, no fallback mount, logging, persistence, overlay, hidden hit region, app launch, app automation, or regular macOS app edit was added.
- Added pure Rust coverage for repo-local bundle path shape, local header/archive availability, enum discriminants, opaque handle pointer shape, and C layout sanity for surface/runtime config structs.
- Files touched: `gpui/build.rs`, `gpui/src/ghostty_kit.rs`, `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted `sed`, `rg`, `nm`, `clang` layout inspection, `git diff`, and `date` review over the allowed GPUI files and required GhosttyKit header/archive references; main-agent targeted ABI comparison against `ghostty/include/ghostty.h`; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 100 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/build.rs gpui/src/main.rs gpui/src/ghostty_kit.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed for tracked content); no-index whitespace checks for untracked `gpui/src/ghostty_kit.rs` and `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps: no real libghostty runtime initialization, native mount attachment, terminal surface mount, terminal process lifecycle, command-pane terminal boundary, logging, persistence, or all-visible-running-leaf expansion exists yet; app launch/restart and visual automation/validation were not run by instruction; real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-20:46 Task slice 101

- Added an App-owned GPUI native terminal surface host synchronizer that stores an inert runtime attachment plan for exactly one validated Agents terminal mount slot plus its recorded body bounds.
- Wired the host plan into the existing per-render geometry path: terminal host plans are cleared when per-render bounds reset, and recomputed only after the mount-slot validator accepts the focused running slot and the canvas probe records exact body bounds.
- Kept the slice honest and inert: no real libghostty/AppKit child view was created, no GhosttyKit symbols were linked or called, and no fake terminal surface, process, command text/content, stdout/stderr persistence, logging, fallback mount, overlay, hidden hit region, app launch, or regular native macOS app edit was added.
- Added pure Rust coverage proving exact-bounds planning for one focused running Agents leaf, stale clearing for focused sleeping or missing sessions, identity changes when the selected running tab or focused running pane changes, exclusion of non-focused visible running leaves, and runtime-only geometry not entering shell-state persistence.
- Files touched: `gpui/src/main.rs`, `gpui/src/terminal_surface_host.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted `sed`, `rg`, and `date` review over `AgentsTerminalBodyMountSlotId`, `agents_terminal_mount_slot_bounds`, `render_terminal_body_slot`, `ghostty_kit`, and CEF native view sync patterns; main-agent targeted review of the new host field, sync path, host module, and tests; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 105 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/src/terminal_surface_host.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed for tracked content); no-index whitespace checks for untracked `gpui/src/terminal_surface_host.rs` and `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Remaining gaps: no real libghostty runtime initialization, native AppKit terminal view attachment, terminal surface mount, terminal process lifecycle, command-pane terminal boundary, logging, persistence, or all-visible-running-leaf expansion exists yet; app launch/restart and visual automation/validation were not run by instruction; real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-20:54 Task slice 102

- Extended the inert GPUI native terminal surface host into a pure reconciliation layer for the future AppKit terminal adapter. The host now compares the previous active attachment plan against the latest validated one-pane Agents mount-slot plan and emits typed runtime-only commands.
- Added command data for `AttachOrShow`, `MoveOrResize`, `HideAndDetach`, and `NoOp`. Each command carries only the validated `NativeTerminalSurfaceHostId`, `AgentsTerminalBodyMountSlotId`, and exact body `Bounds<Pixels>` through the attachment plan; it does not carry command text, terminal content, stdout/stderr, paths, URLs, titles, user text, logs, or persistence data.
- Preserved the one-pane rollout rule: unchanged plans emit only `NoOp`; same-host geometry changes emit only `MoveOrResize`; removed/sleeping/missing focused slots emit stale-host `HideAndDetach` and clear active state; identity changes emit old detach followed by new attach; non-focused visible running leaves still produce no command.
- Kept the slice boundary inert: no native view, GhosttyKit call/link, terminal surface, terminal process, fallback handle, persistent log, persistence field, overlay, hidden hit region, root/window hit-test routing, app launch/restart behavior, or regular native macOS app edit was added.
- Added focused Rust coverage for initial attach/show, unchanged no-op, same-host move/resize, removed-plan detach plus cleared state, identity-change detach/attach ordering, non-focused running leaf exclusion, and continued runtime-only omission of terminal geometry/host command state from shell persistence.
- Files touched: `gpui/src/terminal_surface_host.rs`, `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted `sed`, `rg`, `git diff`, and `date` review over `~/.agents/main.md`, `AgentsTerminalBodyMountSlotId`, `record_agents_terminal_mount_slot_bounds`, existing slice-101 tests, `gpui/src/terminal_surface_host.rs`, `gpui/src/main.rs`, and this progress log; main-agent targeted review of command payloads, ordering, updated tests, and progress; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 111 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/src/terminal_surface_host.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed for tracked content); no-index whitespace checks for untracked `gpui/src/terminal_surface_host.rs` and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: no real libghostty runtime initialization, native AppKit terminal view attachment/execution adapter, terminal surface mount, terminal process lifecycle, command-pane terminal boundary, persistent logging, persistence, or all-visible-running-leaf expansion exists yet; app launch/restart and visual automation/validation were not run by instruction; real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-21:01 Task slice 103

- Added a GPUI-local AppKit terminal adapter shim under `gpui/native/macos/` that can set the frame, show, hide, or focus an existing real `NSView*` supplied by future terminal code.
- Kept the shim separate from CEF naming and behavior. It does not create terminal views, overlays, hidden hit regions, hit-test routing, synthetic input routing, terminal processes, GhosttyKit calls/link flags, persistent logs, or fallback handles.
- Matched the CEF helper's coordinate discipline without coupling to CEF: the shim accepts exact GPUI terminal body bounds, converts Y only when the parent AppKit view is not flipped, and leaves future terminal views constrained to the measured body rectangle.
- Added pure Rust platform-command payload conversion helpers from the existing host reconciliation commands. The converted payloads carry only host id, slot id, and exact body bounds, and command execution remains unwired in the App until a future slice supplies a real terminal view pointer.
- Updated persistence coverage to keep geometry, host, and platform-command names out of shell-state output; Objective-C runtime execution is deferred and was not app-verified because no real terminal native view is wired yet.
- Files touched: `gpui/native/macos/GpuiTerminalAppKitAdapter.m`, `gpui/build.rs`, `gpui/src/terminal_surface_host.rs`, `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted `sed`, `rg`, `git diff`, and `date` review over `~/.agents/main.md`, `gpui/native/macos/GpuiCefAppKitHooks.m`, `gpui/build.rs`, `gpui/src/terminal_surface_host.rs`, slice-102 native terminal host tests in `gpui/src/main.rs`, CEF native-view coordinate handling, and this progress log; main-agent review of the new Objective-C shim, build-script hook, platform payload helpers, persistence guard, and progress entry; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 114 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/build.rs gpui/src/main.rs gpui/src/terminal_surface_host.rs gpui/native/macos/GpuiTerminalAppKitAdapter.m gpui/WORKSPACE_PARITY_PROGRESS.md` (passed for tracked content); no-index whitespace checks for untracked `gpui/native/macos/GpuiTerminalAppKitAdapter.m`, `gpui/src/terminal_surface_host.rs`, and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: no real terminal NSView pointer is wired, so AppKit shim execution is not run from the App yet; no real libghostty runtime initialization, native terminal attachment execution, terminal surface mount, terminal process lifecycle, command-pane terminal boundary, persistent logging, shell persistence, or all-visible-running-leaf expansion exists yet; app launch/restart and visual automation/validation were not run by instruction; real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-21:07 Task slice 104

- Added an unwired Rust-side GPUI terminal native-view execution boundary. The macOS-only executor requires a typed `RealTerminalNativeViewHandle` around a real non-null native terminal view pointer before it can call the AppKit shim.
- Declared the terminal AppKit shim externs for frame, show, hide, and focus behind the macOS cfg while keeping focus unused by current host reconciliation.
- Added a pure platform-operation conversion layer: attach/show maps to frame then show, move/resize maps to frame only, hide/detach maps to hide only, and no-op maps to no operations.
- Kept the App unwired because no real terminal `NSView` pointer exists yet. No fake views, dangling production handles, terminal process lifecycle, GhosttyKit calls/link flags, logging, persistence, overlays, hit-test routing, app launch/restart behavior, or regular native macOS app edits were added.
- Extended shell-state persistence guard coverage so native-view handle, AppKit executor, operation, and shim names remain absent from durable JSON alongside terminal geometry and command payload names.
- Files touched: `gpui/src/main.rs`, `gpui/src/terminal_surface_host.rs`, `gpui/src/terminal_native_view.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted `sed`, `rg`, `git status`, and `date` review over `~/.agents/main.md`, `gpui/src/terminal_surface_host.rs`, `gpui/native/macos/GpuiTerminalAppKitAdapter.m`, `gpui/build.rs`, slice-103 persistence tests in `gpui/src/main.rs`, CEF native-view FFI patterns, and this progress log; main-agent review of the new executor module, widened platform payload types, module registration, persistence guard, and progress entry; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 118 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/src/terminal_surface_host.rs gpui/src/terminal_native_view.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed for tracked content); no-index whitespace checks for untracked `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_surface_host.rs`, and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: no real terminal NSView pointer is wired, so the executor is not called from `GhostexGpuiApp`; no real libghostty runtime initialization, native terminal attachment execution from app state, terminal surface mount, terminal process lifecycle, command-pane terminal boundary, persistent logging, shell persistence, or all-visible-running-leaf expansion exists yet; app launch/restart and visual automation/validation were not run by instruction; real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-21:11 Task slice 105

- Added a pure GPUI Ghostty surface config request boundary that can build a `ghostty_surface_config_s` only from an opaque non-null NSView handle plus a finite positive scale factor.
- Mirrored the native Swift source-of-truth defaults for the inert request: macOS platform tag, `platform.macos.nsview` and `userdata` set to the same provided view pointer, `context = GHOSTTY_SURFACE_CONTEXT_WINDOW`, `font_size = 0.0`, no command, working directory, env vars, initial input, wait-after-command, or PTY write callback.
- Added an internal bridge from the existing `RealTerminalNativeViewHandle` to the config request boundary without calling AppKit, GhosttyKit, libghostty, or mounting/creating a terminal surface.
- Added focused Rust coverage for valid config fields, conservative scale-factor rejection, empty launch/privacy fields, and conversion from the real native-view handle boundary using test-only opaque handles. Existing host/executor tests continue to cover unchanged one-pane and AppKit operation behavior.
- Extended shell-state persistence guard coverage so Ghostty surface config names, launch fields, scale/font fields, and request-boundary type names remain absent from durable workspace JSON.
- Files touched: `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/terminal_native_view.rs`, `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted `sed`, `rg`, `git status`, and `date` review over `~/.agents/main.md`, `gpui/src/ghostty_kit.rs`, `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_surface_host.rs`, native Swift `GhostexGhosttySurfaceConfiguration.withCValue`, existing shell persistence tests, and this progress log; main-agent review of the config request builder, non-null handle accessor, module registration, persistence guard, and progress entry; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 122 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/src/terminal_native_view.rs gpui/src/terminal_ghostty_surface.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed for tracked content); no-index whitespace checks for untracked `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/terminal_native_view.rs`, and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: the builder is intentionally unwired because GPUI still has no real terminal NSView pointer from libghostty/AppKit creation; no `ghostty_surface_config_new`, `ghostty_surface_new`, `ghostty_app_new`, or other GhosttyKit/libghostty symbol is called; no link flags, terminal process lifecycle, command-pane terminal boundary, persistent logging, shell persistence, app launch/restart, visual automation/validation, or all-visible-running-leaf expansion exists yet; real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-21:17 Task slice 106

- Added a pure runtime terminal native-view lifecycle state for the one-pane Agents mount slot. It associates the current host/slot plan with either awaiting-real-view state or an explicit supplied real-view ready state, without creating views, manufacturing handles, calling AppKit, building Ghostty configs, calling GhosttyKit/libghostty, logging, or adding shell persistence.
- Added lifecycle decision helpers that consume host reconciliation commands and return high-level outcomes: awaiting attach/no-op/move decisions stay `NeedsRealNativeView`, ready states can return `CanExecuteWithRealView`, stale ready identities return `DetachStaleView`, and ready no-op stays `NoOp`.
- Wired `GhostexGpuiApp` to maintain this lifecycle state from the existing host sync path while discarding decisions and making no executor/config calls. With no real terminal NSView pointer in the App, production remains handle-free and cannot execute the native terminal adapter.
- Preserved the one-pane identity rules: selected/focused running slot changes clear old awaiting state and request a new real view, ready identity changes detach stale state first, removed/sleeping/missing focused slots clear lifecycle state, and non-focused visible running leaves remain ignored by the host.
- Added Rust coverage for awaiting attach, same-host no-op, move/resize while awaiting, awaiting identity changes, removal clearing, macOS test-only ready execution decisions, macOS ready stale detach, and shell-state omission of lifecycle/view/operation names plus pointer-like data.
- Files touched: `gpui/src/main.rs`, `gpui/src/terminal_surface_host.rs`, `gpui/src/terminal_surface_lifecycle.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted `sed`, `rg`, `git status`, `git diff`, and `date` review over `~/.agents/main.md`, `gpui/src/terminal_surface_host.rs`, `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_ghostty_surface.rs`, slice-105 persistence tests in `gpui/src/main.rs`, and this progress log; main-agent review of the lifecycle state module, app wiring, widened host-command visibility, persistence guard, and progress entry; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 129 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/src/terminal_surface_host.rs gpui/src/terminal_surface_lifecycle.rs gpui/WORKSPACE_PARITY_PROGRESS.md` (passed for tracked content); no-index whitespace checks for untracked `gpui/src/terminal_surface_host.rs`, `gpui/src/terminal_surface_lifecycle.rs`, and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: GPUI still has no real terminal NSView pointer, so lifecycle ready state is only exercised through test/macOS explicit handles; no AppKit executor call, Ghostty surface config creation, GhosttyKit/libghostty call, terminal process lifecycle, command-pane terminal boundary, persistent logging, shell persistence, app launch/restart, visual automation/validation, or all-visible-running-leaf expansion exists yet; real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-21:27 Task slice 107

- Refined the GPUI Agents terminal host sync so a visible focused running slot with temporarily empty per-render body bounds is classified as awaiting this frame's canvas record instead of being reconciled as a removed slot.
- Wired active Agents mode into host reconciliation as the visibility gate. Visible pre-layout resets preserve host/lifecycle identity; switching away from Agents or losing the focused one-pane running slot still clears stale state through the existing hide/detach path.
- Preserved one-pane rollout behavior: non-focused visible running leaves remain ignored, and recorded same-slot bounds later produce `NoOp` or `MoveOrResize` without identity loss.
- Extended shell-state omission coverage for the new host sync action names so the runtime pre-layout classification remains non-persistent.
- Added pure Rust coverage for hidden/no-current/awaiting/recorded host classification, same-slot pre-layout reset preserving active host and lifecycle state, later same-bounds no-op/needs-real-view, changed-bounds move/resize/needs-real-view, active mode not Agents clearing stale lifecycle, focused sleeping/missing/no-slot clearing stale lifecycle, and non-focused running bounds staying ignored.
- Files touched: `gpui/src/main.rs`, `gpui/src/terminal_surface_host.rs`, `gpui/src/terminal_surface_lifecycle.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted `sed`, `rg`, `git status`, `git diff`, and `date` review over `~/.agents/main.md`, `prepare_focus_bounds_for_render`, `record_agents_terminal_mount_slot_bounds`, `sync_agents_terminal_surface_host`, `WorkspaceModel::rendered_terminal_body_mount_slots`, slice-106 lifecycle tests, `gpui/src/terminal_surface_host.rs`, `gpui/src/terminal_surface_lifecycle.rs`, and this progress log; main-agent review of the active-mode visibility gate, pre-layout no-detach path, lifecycle preservation, stale clear cases, and unwired AppKit/Ghostty boundary usage; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 137 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed); no-index whitespace checks for untracked `gpui/src/terminal_surface_host.rs`, `gpui/src/terminal_surface_lifecycle.rs`, `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/ghostty_kit.rs`, `gpui/native/macos/GpuiTerminalAppKitAdapter.m`, and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: GPUI still has no real terminal NSView pointer, so lifecycle ready state remains test/macOS-only and production cannot execute AppKit or Ghostty work; no Ghostty surface config creation, GhosttyKit/libghostty call, terminal process lifecycle, command-pane terminal boundary, persistent logging, shell persistence, app launch/restart, visual automation/validation, or all-visible-running-leaf expansion was added; real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-21:46 Task slice 108

- Added the real GPUI AppKit terminal host-view ownership prerequisite while keeping it unwired from `GhostexGpuiApp`: the Objective-C adapter can now create one normal hidden black child `NSView` under an explicit parent using exact terminal body bounds, and destroy only that retained host view later.
- Kept the AppKit boundary strict: no overlays, broad `hitTest` overrides, synthetic event routing, transparent hidden hit regions, logging, GhosttyKit/libghostty calls, terminal process lifecycle, shell persistence, app launch, or regular native macOS app edit was added.
- Added a macOS-only Rust owner/factory boundary in `terminal_native_view.rs`. Creation requires a non-null parent native view handle and validated finite, non-negative platform bounds; the returned owner exposes a borrowed `RealTerminalNativeViewHandle` for future lifecycle/config work and Drop destroys only views created through that owner.
- Added pure Rust coverage for request parent/bounds validation and owned-vs-borrowed handle separation without calling the Objective-C create shim or instantiating AppKit in tests. Existing executor/operation mapping remains unchanged.
- Extended shell-state persistence guard coverage so the new host-view owner/factory/create/destroy names plus parent/created/native pointer-like fields remain absent from durable JSON.
- Files touched: `gpui/native/macos/GpuiTerminalAppKitAdapter.m`, `gpui/src/terminal_native_view.rs`, `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted reads of `~/.agents/main.md`, Phase 2 docs, slices 103-107, `gpui/src/terminal_native_view.rs`, `gpui/native/macos/GpuiTerminalAppKitAdapter.m`, `gpui/src/terminal_surface_host.rs`, `gpui/src/terminal_surface_lifecycle.rs`, `gpui/src/terminal_ghostty_surface.rs`, CEF AppKit coordinate helpers, and the native Swift source-of-truth Ghostty config path; main-agent review of the create/destroy retain ownership, ordinary child-view layout, Drop-only-owned destroy path, borrowed-handle separation, and absence of app/Ghostty execution wiring; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 140 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed for tracked touched files); no-index whitespace checks for untracked `gpui/src/terminal_native_view.rs`, `gpui/native/macos/GpuiTerminalAppKitAdapter.m`, `gpui/src/terminal_surface_host.rs`, `gpui/src/terminal_surface_lifecycle.rs`, and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: the owner/factory is intentionally not wired into `GhostexGpuiApp`, so production still does not create or execute a terminal host view; no Ghostty surface config creation from app state, GhosttyKit/libghostty call, terminal process lifecycle, command-pane terminal boundary, persistent logging, shell persistence, app launch/restart, visual automation/validation, or all-visible-running-leaf expansion was added; real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-21:54 Task slice 109

- Wired the macOS-only App-owned runtime host-view lifecycle for the current one-pane Agents terminal mount slot. `GhostexGpuiApp` now owns at most one runtime `OwnedTerminalHostNativeView` wrapper for that slot and keeps it out of shell-state persistence and logging.
- Creation is driven only by `NativeTerminalSurfaceLifecycleDecision::NeedsRealNativeView { plan }`. The app uses its existing parent `NSView*`, converts the plan's exact GPUI body bounds to platform bounds, creates the hidden host view through the slice-108 factory, and marks the lifecycle ready only with the owner's `RealTerminalNativeViewHandle` for the same plan.
- Null parent handles, invalid requests, or create failures leave lifecycle state awaiting a real view and do not invent fallback/fake views. Hidden/no-current-slot detach and stale-view detach paths drop only the matching app-owned host view; borrowed/test handles remain non-owning.
- Preserved the slice-107 pre-layout reset behavior: an empty command/decision batch while Agents is visible and awaiting the next body-bounds record keeps the owned hidden host view alive instead of treating the slot as removed.
- Kept the boundary narrow: no `NativeTerminalSurfaceAppKitExecutor` wiring, no show/focus calls, no `GhosttySurfaceConfigRequest` from app state, no GhosttyKit/libghostty calls, no terminal process lifecycle, no persistent logs, no shell persistence, no overlays, no hidden hit regions, no broad hit-test routing, and no app launch/restart.
- Added pure macOS Rust coverage for successful owned-view request creation and lifecycle-ready transition via a test-owned view path, hidden/no-current detach destruction, pre-layout empty-batch preservation, same-slot move/resize ownership refresh without hidden host recreation, null-parent/create-failure awaiting behavior, and shell-state omission of the new owner/helper names.
- Files touched: `gpui/src/main.rs`, `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_surface_lifecycle.rs`, `gpui/src/terminal_surface_host.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted reads of `~/.agents/main.md`, Phase 2 docs, slices 106-108, `gpui/src/main.rs`, `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_surface_lifecycle.rs`, `gpui/src/terminal_surface_host.rs`, and this progress log; `date '+%Y-%m-%d-%H:%M'`; main-agent review of the app-owned host-view field, decision/ownership helper, lifecycle ready transition, detach ownership guard, pre-layout preservation, same-slot move/resize owner-plan refresh, and absence of executor/Ghostty/process/log/persistence paths; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 145 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed for tracked content); no-index whitespace checks for untracked `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_surface_host.rs`, `gpui/src/terminal_surface_lifecycle.rs`, `gpui/native/macos/GpuiTerminalAppKitAdapter.m`, and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: the hidden host view is still not shown, focused, executed, or connected to Ghostty; no `NativeTerminalSurfaceAppKitExecutor`, `GhosttySurfaceConfigRequest` from app state, GhosttyKit/libghostty call, terminal process lifecycle, command-pane terminal surface, persistent logging, shell persistence, app launch/restart, visual automation/validation, or all-visible-running-leaf expansion was added; real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-22:10 Task slice 110

- Added the bounded AppKit frame-only execution path for the App-owned hidden terminal host view. `GhostexGpuiApp` now asks the ownership helper for frame operations after lifecycle reconciliation and executes only matching `SetFrame` work for same-slot `MoveOrResize` decisions whose real-view handle still matches the owned hidden child.
- Kept attach/show, hide/detach, and focus blocked from the `NativeTerminalSurfaceAppKitExecutor` in this slice. Initial attach still creates a hidden host view only through the owner path, same-slot move/resize refreshes the owner plan before frame work, and detach remains owner-drop-only with no hide operation.
- Added pure macOS Rust coverage for exactly one `SetFrame` on same-slot move/resize, no operation for attach/show, no operation for pre-layout empty batches while preserving the owner, detach dropping the owner without hide, non-matching borrowed/ready view decisions producing no operation, and shell-state omission of the new frame-only helper names.
- Files touched: `gpui/src/main.rs`, `gpui/src/terminal_native_view.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted reads of `~/.agents/main.md`, Phase 2 docs, slices 107-109, `gpui/src/main.rs`, `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_surface_host.rs`, `gpui/src/terminal_surface_lifecycle.rs`, and this progress log; `date '+%Y-%m-%d-%H:%M'`; main-agent review of the frame-only filtering, owned-host handle match guard, app call site, persistence guard, and absence of generic attach/show, hide, focus, GhosttyKit, process, logging, persistence, app launch, or regular native app paths; main-agent rerun at `2026-06-22-22:14` of `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 147 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed for tracked content); no-index whitespace checks for untracked `gpui/src/terminal_native_view.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`, `gpui/native/macos/GpuiTerminalAppKitAdapter.m`, `gpui/src/terminal_surface_host.rs`, `gpui/src/terminal_surface_lifecycle.rs`, `gpui/src/terminal_ghostty_surface.rs`, and `gpui/src/ghostty_kit.rs` returned the expected diff status with no whitespace output.
- Remaining gaps: the hidden host view still has no Ghostty/libghostty surface, terminal process lifecycle, command-pane terminal surface, focus path, attach/show execution, hide execution, persistent logging, shell persistence, app launch/restart, visual automation/validation, or all-visible-running-leaf expansion; real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-22:17 Task slice 111

- Added macOS-only runtime preparation of a `GhosttySurfaceConfigRequest` for the existing App-owned hidden terminal host view. `GhostexGpuiApp` now stores the prepared request only in memory, refreshes it after App-owned host-view reconciliation, clears it when no owner exists or the current GPUI window scale is invalid, and never persists or logs it.
- Passed the current `Window::scale_factor()` through both render/pre-layout host sync and the terminal body canvas bounds-record path. The app does not use a constant or fallback scale.
- Added a narrow helper in `terminal_native_view.rs` that converts `Option<&AppOwnedTerminalHostNativeView>` plus scale into `Result<Option<GhosttySurfaceConfigRequest>, GhosttySurfaceConfigRequestError>` by borrowing only the owned hidden host view's real native handle. The helper returns `Ok(None)` without an owner and `Err` for invalid scale.
- Kept the boundary runtime-only: no `to_ffi_config` call from `GhostexGpuiApp`, no `ghostty_surface_config_new`, `ghostty_surface_new`, `ghostty_app_new`, GhosttyKit/libghostty runtime call, terminal process, attach/show/hide/focus expansion, logging, persistence, fallback/fake surface, overlay, hidden hit region, broad hit-test routing, or synthetic coordinate routing was added.
- Added pure macOS Rust coverage for request creation from a test-owned host view with preserved `nsview` and scale, no request without an owner, invalid scale returning an error, and shell-state omission of the new runtime field/helper/config terms.
- Files touched: `gpui/src/main.rs`, `gpui/src/terminal_native_view.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted reads of `~/.agents/main.md`, Phase 2 docs, slices 108-110, `gpui/src/main.rs`, `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_ghostty_surface.rs`, and this progress log; `date '+%Y-%m-%d-%H:%M'`; main-agent review at `2026-06-22-22:24` of the current-scale plumbing, post-reconciliation config-request cache, helper boundary, persistence guard, test-only `to_ffi_config` usage, and absence of Ghostty/libghostty surface creation, process work, logging, persistence, app launch, or regular native app edits; main-agent rerun of `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 150 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/Cargo.toml gpui/Cargo.lock gpui/build.rs` (passed for tracked content); no-index whitespace checks for untracked `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_ghostty_surface.rs`, and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: the prepared request is not consumed to create any Ghostty/libghostty surface; the hidden host view still has no terminal process lifecycle, command-pane terminal surface, focus path, attach/show execution, hide execution, persistent logging, shell persistence, app launch/restart, visual automation/validation, or all-visible-running-leaf expansion; real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-22:39 Task slice 112

- Extended the GPUI GhosttyKit C ABI boundary with the real exported runtime/surface calls needed by this slice: app focus, surface content scale, and surface size, while keeping ABI layout/signature tests compile-time only.
- Added macOS build linking for the repo-local `ghostty-internal.a` archive by exact path, plus the system libraries/frameworks needed by the inspected native GhosttyKit embedding path. The GPUI test/check binaries now link cleanly against the real archive.
- Reworked `terminal_ghostty_surface.rs` from an inert config-request helper into safe owner boundaries for real Ghostty runtime state: default config load/finalize/free, app init/create/tick/focus/free with privacy-safe minimal callbacks, real surface create/free from the prepared request, and bounded content-scale/pixel-size/focus/size helpers. Unit coverage uses a fake function table and does not instantiate AppKit or a real terminal process.
- Wired `GhostexGpuiApp` to consume the prepared request for the App-owned focused one-pane Agents host view. Production now creates at most one real Ghostty surface for that slot, preserves it across same-slot frame updates, updates content scale and backing-pixel dimensions from exact body bounds/current scale, shows the App-owned host view only after surface creation succeeds, and drops/hides the surface when the owned host disappears or the slot is stale.
- Kept the scope narrow: no command/cwd/env/session lifecycle, command-pane terminals, all-visible-leaf expansion, focus/input wiring, close semantics, persistent logging, shell persistence, fallback terminal success path, app launch/restart, visual automation, or regular native macOS app edits were added.
- Extended durable shell-state privacy guards so the new Ghostty runtime owner/config/surface/function-table names, app/surface fields, raw Ghostty symbols, pointer-like runtime terms, and visibility helper names remain absent from persisted JSON.
- Files touched: `gpui/src/ghostty_kit.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/terminal_native_view.rs`, `gpui/src/main.rs`, `gpui/build.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted reads of `~/.agents/main.md`, Phase 2 docs, parity requirements for terminal/layout constraints, slices 108-111, `gpui/src/ghostty_kit.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_surface_host.rs`, `gpui/src/terminal_surface_lifecycle.rs`, `gpui/src/main.rs` around terminal host sync/runtime fields, `gpui/build.rs`, the repo-local GhosttyKit header and archive exports via `rg`, `nm`, `lipo`, and source-of-truth read-only Swift Ghostty runtime/surface setup; `date '+%Y-%m-%d-%H:%M'`; main-agent review at `2026-06-22-22:42` of the Ghostty owner/drop/show/update path, link flags, privacy guard coverage, and stale CDXC comments; main-agent updated stale comments in `gpui/build.rs` and `gpui/src/main.rs`; main-agent rerun of `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 156 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed for tracked content); no-index whitespace checks for untracked `gpui/src/ghostty_kit.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/terminal_native_view.rs`, and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: the real one-pane Ghostty surface is wired and compiles/links, but it was not launched or visually validated because app launch/restart was prohibited. Focus/input, full wakeup/event-loop scheduling, command/cwd/env/session lifecycle, close/process teardown, command-pane terminal surfaces, all-visible-running-leaf expansion, packaging/resource parity, persistent logging audit beyond shell-state JSON, app launch/restart, and visual automation/validation remain deferred; real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-22:45 Task slice 113

- Expanded the real Agents terminal mount-slot model from one focused pane to all rendered visible Agents leaves whose selected session is `Running`. Sleeping, mounting, restored/unmounted, popped-out, missing, inactive-tab, and hidden-by-Focus-mode sessions remain on the existing placeholder paths.
- Rendered and recorded a normal terminal body mount probe for every eligible visible running leaf, while keeping the visible body div as the click/drop owner and keeping body bounds runtime-only.
- Converted runtime terminal host, lifecycle, AppKit host-view, Ghostty surface config request, and Ghostty surface ownership to maps keyed by the stable Agents pane/session mount slot id. A single shared Ghostty app owner remains available for the app, same-slot resize preserves owners, and stale surfaces are dropped/hidden before their AppKit host views are released.
- Updated pure model and runtime tests for multiple visible split leaves, non-focused visible running eligibility, Focus-mode hiding, sleeping/missing exclusion, adding two slots, same-slot resize without recreation, removing one slot without disturbing another, selected-tab/session identity changes, and shell-state omission of runtime map/owner/surface/pointer terms.
- Files touched: `gpui/src/main.rs`, `gpui/src/terminal_surface_host.rs`, `gpui/src/terminal_surface_lifecycle.rs`, `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted reads of `~/.agents/main.md`, Phase 2 docs, parity requirements for terminal/layout constraints, slices 108-112, `gpui/src/main.rs`, `gpui/src/terminal_surface_host.rs`, `gpui/src/terminal_surface_lifecycle.rs`, `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_ghostty_surface.rs`; `date '+%Y-%m-%d-%H:%M'`; stale one-pane source scans with `rg`; `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` before test migration (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml --no-run` during test migration (passed after helper updates); main-agent review at `2026-06-22-22:58` of multi-slot host reconciliation, lifecycle decisions, AppKit host-view map ownership, Ghostty surface map sync, mount-slot candidate classification, and new tests; main-agent rerun of `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 156 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed for tracked content); no-index whitespace checks for untracked `gpui/src/terminal_surface_host.rs`, `gpui/src/terminal_surface_lifecycle.rs`, `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_ghostty_surface.rs`, and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: visual/app launch validation was not run because app launch/restart is prohibited for this task. Focus/input routing, command-pane terminal surfaces, command/cwd/env/session lifecycle, close/process teardown, full wakeup/event-loop scheduling, packaging/resource parity, persistent logging audit beyond shell-state JSON, and real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-23:04 Task slice 114

- Wired runtime-only Ghostty focus parity for real Agents terminal surfaces. The focused mount slot is selected only when GPUI is in Agents mode, shell focus targets a rendered Agents pane, and that pane's selected session is `Running`; command-pane focus, Browser/project-editor modes, sleeping/missing/stale selections, and Focus-mode hidden panes leave mounted surfaces unfocused.
- Made `GhosttySurfaceOwner` and the shared `GhosttyAppOwner` apply focus idempotently, so normal render/sync passes do not call Ghostty focus functions unless the focus state changes. The shared app focus is explicitly bounded to "GPUI has an active focused terminal surface" and does not infer NSApp activation or keyboard/mouse delivery.
- Hooked focus sync through shell-focus changes, command-pane focus transfer, and Ghostty surface create/drop reconciliation. Multiple mounted Agents surfaces remain mounted while focus moves between shell-focused running panes, and stale/non-current surfaces are unfocused or dropped through the existing map cleanup path.
- Updated CDXC comments that previously treated terminal focus as fully out of scope, while keeping keyboard/mouse input routing, command-pane terminal surfaces, process/session lifecycle, and AppKit first-responder handoff out of this slice.
- Extended tests for focused slot selection, two-surface focus moves without surface drops, command/non-Agents focus clearing, non-running selected tabs, Focus-mode hidden panes, stale/missing panes, idempotent Ghostty app/surface focus calls, and shell-state privacy guards for the new runtime focus helper names.
- Files touched: `gpui/src/main.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/terminal_native_view.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted reads of `~/.agents/main.md`, Phase 2 docs, parity requirements, slices 112-113, `gpui/src/main.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_surface_host.rs`, and `gpui/src/terminal_surface_lifecycle.rs`; `date '+%Y-%m-%d-%H:%M'`; main-agent review at `2026-06-22-23:08` of focused slot derivation, shell-focus sync hooks, idempotent app/surface focus state, stale comment scan, and new focus tests; main-agent rerun of `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 164 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed for tracked content); no-index whitespace checks for untracked `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/terminal_native_view.rs`, and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: keyboard input, mouse input, paste/selection/IME, AppKit first-responder handoff, command-pane terminal surfaces, command/cwd/env/session lifecycle, close/process teardown, persistent runtime ids, persistent logging audit beyond shell-state JSON, app launch/restart, and visual automation/validation remain deferred and were not run.

### 2026-06-22-23:17 Task slice 115

- Wired AppKit first-responder handoff for real mounted Agents terminal surfaces through the existing GPUI-owned terminal host NSView boundary. The Rust helper calls the existing AppKit adapter focus operation only for an `AppOwnedTerminalHostNativeView`, and generic attach/show/move/hide command mapping still never produces focus.
- Extended real terminal focus sync so the shell-focused visible running Agents slot focuses its Ghostty surface, shared Ghostty app, and exact AppKit host view when that slot has both a mounted Ghostty surface and an owned host view. The AppKit handoff stores only runtime slot plus host identity to avoid repeated `makeFirstResponder` calls during render sync, while running body clicks force one handoff even when shell focus already points at the same slot.
- Changed terminal body clicks so eligible running mount slots set shell focus to `AgentsPane(pane_id)` and trigger the real focus handoff. Non-running placeholder bodies and placeholder action buttons keep the existing activation path, so sleeping/restored/popped-out activation and Mounting/missing non-fabrication behavior remain unchanged.
- Updated CDXC comments for the new slice-115 focus contract, including the AppKit adapter boundary and the normal-layout/no-overlay/no-hit-test-routing requirement. No persistent logs, command/session lifecycle, command-pane terminal surfaces, runtime IDs, Source/Kanban/Manage surfaces, app launch/restart behavior, visual automation, or regular native macOS app code were added.
- Added focused Rust coverage for running body click vs placeholder activation classification, App-owned host focus identity selection, idempotent/forced AppKit handoff decisions, generic host-command focus exclusion, and shell-state privacy guards for new runtime focus helper/field names.
- Files touched: `gpui/src/main.rs`, `gpui/src/terminal_native_view.rs`, `gpui/native/macos/GpuiTerminalAppKitAdapter.m`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted reads of `~/.agents/main.md`, Phase 2 docs, parity focus requirements, slice 114, `gpui/src/main.rs`, `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/terminal_surface_host.rs`, `gpui/src/terminal_surface_lifecycle.rs`, and `gpui/native/macos/GpuiTerminalAppKitAdapter.m`; `date '+%Y-%m-%d-%H:%M'`; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); first `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` failed on unnecessary `Debug` derives for new focus/click helper types; after removing those derives, `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 168 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs` (passed); no-index whitespace checks for untracked `gpui/src/terminal_native_view.rs`, `gpui/native/macos/GpuiTerminalAppKitAdapter.m`, and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output. Main-agent review at `2026-06-22-23:20` checked the explicit AppKit focus operation, forced click handoff, stale focus identity clearing, absence of generic command focus, and absence of overlays/hit-test routing, then reran `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 168 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed); no-index whitespace checks for untracked `gpui/src/terminal_native_view.rs`, `gpui/native/macos/GpuiTerminalAppKitAdapter.m`, and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: app launch/restart and visual automation/validation were not run by instruction. Keyboard/mouse event translation, paste/selection/IME behavior, command-pane terminal surfaces, command/cwd/env/session lifecycle, close/process teardown, persistent runtime ids, persistent logging audit beyond shell-state JSON, and real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-23:24 Task slice 116

- Added a runtime-only Agents terminal session identity layer for GPUI. `AgentsTerminalRuntimeSessionRegistry` maps durable shell `TerminalSessionId` values to process-local `AgentsTerminalRuntimeSessionId` values, reconciles from the current workspace shell sessions, prunes removed sessions, and intentionally regenerates ids after app restore.
- Preserved `TerminalSessionId` as the stable shell/layout identity. Reorder, center grouping, edge split moves, Focus mode changes, selected-pane changes, persistence, and restore continue to use the shell ids and do not serialize runtime ids.
- Threaded runtime identity into the real Ghostty surface ownership path. `GhosttySurfaceOwner` now stores the runtime session id separately from `AgentsTerminalBodyMountSlotId`; AppKit host views and layout/body attachments remain keyed by mount slot. Surface sync drops and recreates an owner if a same-slot owner no longer matches the current runtime id.
- Kept the scope runtime-only: no terminal launch, cwd/env/command startup, process lifecycle, close/process teardown, command-pane terminal surface, persistent runtime id, persistent log, fallback terminal success path, NSView reparenting, overlay, hidden hit region, or input routing was added.
- Added focused Rust coverage for shell id stability through reorder/group/split/restore, registry identity stability across current-process layout/focus moves, stale runtime pruning after shell removal, restored shell state getting fresh runtime ids, Ghostty owner runtime identity storage with fake Ghostty functions, and shell-state omission of the new runtime identity field/type/helper names.
- Files touched: `gpui/src/main.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted reads of `~/.agents/main.md`, Phase 3 docs, parity requirements for Sleeping/Mounting/Popped-out, Drag/Drop/Reorder, and Focus/Close/Keyboard, slices 112-115, `gpui/src/main.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/terminal_surface_host.rs`, `gpui/src/terminal_surface_lifecycle.rs`, `gpui/src/terminal_native_view.rs`, and this progress log; `date '+%Y-%m-%d-%H:%M'`; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 172 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed); no-index whitespace checks for untracked `gpui/src/terminal_ghostty_surface.rs` and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output. Main-agent review at `2026-06-22-23:30` checked registry reconciliation/pruning, surface-owner runtime id separation from mount slots, shell-state privacy omissions, close-path shell session removal, and absence of process launch or persistence/logging changes, then reran `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 172 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed); no-index whitespace checks for untracked `gpui/src/terminal_ghostty_surface.rs` and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: app launch/restart and visual automation/validation were not run by instruction. Runtime ids are still identity plumbing only; wake/materialize behavior, mounting startup placeholders tied to a real runtime, command/cwd/env/session startup, close/process teardown, popped-out real reattach, command-pane terminal surfaces, keyboard/mouse event translation, paste/selection/IME behavior, persistent logging audit beyond shell-state JSON, and real Source/Kanban/Manage surfaces remain deferred.

### 2026-06-22-23:33 Task slice 117

- Replaced fake direct-running lifecycle transitions for Agents terminal wake/materialize/reattach activation with explicit `Mounting` transitions. Selecting sleeping/restored/popped-out tabs remains presentation-only; activating their placeholder selects/focuses the tab and moves it to pending startup/materialization without launching a process or fabricating `Running`.
- Changed new Agents shell session creation paths to start selected `Mounting` sessions when no runtime process has started. This covers new tab insertion, Split Right, Split Below, full-width bottom row, and command-to-Agents body/tab-strip transfers while preserving layout, focus, shell ids, rollback behavior, and command-pane-only placeholder behavior.
- Preserved real surface eligibility for existing `Running` sessions only. Rendered visible running Agents leaves still produce mount slots; `Mounting`, sleeping, restored/unmounted, popped-out, and missing selected sessions stay on lifecycle placeholders and do not create mount slots.
- Updated placeholder copy/action labels and CDXC comments so wake/materialize/reattach describe pending startup/materialization instead of black running placeholders or no-process fake success.
- Added focused Rust coverage for selection without transition, activation to `Mounting`, `Mounting` activation staying pending, `Running` activation staying real-mount eligible, new tab/split/bottom-row creation as `Mounting`, command-to-Agents transfers as `Mounting`, running-vs-mounting mount-slot eligibility, and shell-state JSON persisting only safe `presentationState:"mounting"` metadata while omitting private/runtime/process fields.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted reads of `~/.agents/main.md`, Phase 3 docs, parity requirements for Sleeping/Mounting/Popped-out, Drag/Drop/Reorder, and Focus/Close/Keyboard, slice 116, `gpui/src/main.rs`, and this progress log; `date '+%Y-%m-%d-%H:%M'`; targeted `rg`, `sed`, and `git diff` review of lifecycle helpers, render placeholder copy, new Agents tab/split/bottom-row helpers, command-to-Agents transfer helpers, shell-state persistence, and tests; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 176 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output. Main-agent review at `2026-06-22-23:40` checked activation state transitions, selected-tab no-wake behavior, new Agents tab/split/bottom-row Mounting creation, command-to-Agents Mounting transfers, Running-only mount-slot eligibility, Mounting exclusion from real surface creation, safe persistence of `presentationState:"mounting"`, and absence of process launch/input routing/logging changes, then reran `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 176 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: no actual terminal process launch, cwd/env/command startup, success/failure completion, close/process teardown, command-pane real terminal surface, app/visual launch, popped-out real reattach, keyboard/mouse event translation, paste/selection/IME behavior, persistent runtime ids, persistent logging audit beyond shell-state JSON, app launch/restart, or visual automation/validation was added.

### 2026-06-22-23:50 Task slice 118

- Added a first-class failed startup presentation state for Agents terminal shell sessions. The state has the safe `startup-failed` slug, retry placeholder copy, tab badge/chrome/body colors, and activation behavior that moves the same tab back to `Mounting` instead of fabricating `Running` or deleting the tab.
- Added a runtime-only Agents terminal startup coordinator keyed by private `AgentsTerminalRuntimeSessionId`. It records visible selected `Mounting` startup candidates, prunes records when shell sessions disappear or leave `Mounting`, and exposes a pure Ready/Failed result boundary: Ready promotes the matching current Mounting shell session to `Running`, Failed preserves it as the failed placeholder, and stale/wrong/non-Mounting results are ignored.
- Wired the coordinator into `sync_agents_terminal_surface_host` before the existing Running-only mount-slot path. This only creates/updates pending startup records; it does not launch a process, create fake Ghostty surfaces, mark success automatically, persist runtime ids, log anything, add overlays/hidden hit regions, or touch the regular macOS app.
- Preserved real mount-slot eligibility as Running-only. `Mounting` and `startup-failed` selected sessions stay lifecycle placeholders and never produce real terminal mount slots.
- Added focused Rust coverage for startup candidate creation, pruning on non-Mounting/removal, Ready and Failed result application, stale/wrong runtime id ignoring, failed activation retry to Mounting, failed placeholder mount-slot exclusion, tab/chrome/body non-running treatment, and shell-state persistence that stores only `presentationState:"startup-failed"` while omitting runtime/startup/private/error fields.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted reads of `~/.agents/main.md`, Phase 3 docs, parity requirements for Sleeping/Mounting/Popped-out, slices 116-117, `gpui/src/main.rs`, and this progress log; targeted `rg`/`sed` review of lifecycle state, runtime registry, mount-slot rendering, app terminal host sync, shell-state persistence, and adjacent tests; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 182 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output. Main-agent review at `2026-06-22-23:57` checked runtime-only startup candidate ownership, Ready/Failed result matching, failed-placeholder retry behavior, Running-only mount-slot eligibility, shell-state privacy omissions, and absence of process launch/logging/overlap changes; it also corrected a stale CDXC comment about default seeded tabs, then reran `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 182 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: no actual terminal process launch, cwd/env/command startup payload, runtime success/failure producer, close/process teardown, command-pane real terminal surface, popped-out real reattach, keyboard/mouse event translation, paste/selection/IME behavior, persistent runtime ids, persistent logging audit beyond shell-state JSON, app launch/restart, or visual automation/validation was added.

### 2026-06-22-23:58 Task slice 119

- Added a runtime-only Ghostty surface launch payload boundary for Phase 3 startup. `GhosttySurfaceConfigRequest` can now carry optional cwd, command, env vars, initial input, and wait-after-command launch data without making those values part of shell state, titles, logs, or raw `Debug` output.
- Added explicit interior-NUL rejection for each launch string category before FFI preparation. Launch-bearing configs are prepared through a scoped owner that keeps `CString` and `ghostty_env_var_s` storage alive for the duration of `ghostty_surface_new`; the old empty `to_ffi_config` inspection path remains safe only for no-launch requests.
- Kept current app behavior unchanged: existing prepared requests still have null launch fields, running surface creation remains tied only to already-running mount slots, and no startup process launch, Mounting promotion, startup result producer, command-pane surface, regular macOS app edit, persistent log, or app restart was added.
- Extended shell-state privacy guards for the new launch payload/request helper names and added focused Ghostty surface tests for empty defaults, launch-bearing scoped config fields, env var pointer/count population, wait-after-command propagation, interior-NUL rejection, redacted Debug output, and surface creation with scoped launch pointer lifetimes.
- Files touched: `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted reads of `~/.agents/main.md`, Phase 3 docs, parity requirements for Sleeping/Mounting/Popped-out, slices 117-118, `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/ghostty_kit.rs`, `gpui/src/main.rs` shell-state privacy tests, native Swift `GhostexGhosttySurfaceConfiguration.withCValue`, and this progress log; targeted `rg`, `sed`, and diff review of launch request/config code and privacy guards; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 186 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed). Main-agent review at `2026-06-23-00:07` checked scoped `CString`/env-var lifetime through `ghostty_surface_new`, launch-bearing `to_ffi_config` refusal, redacted Debug output, default null launch fields, owner call-site borrowing, shell-state privacy guards, and unchanged app startup behavior; then reran `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 186 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed); no-index whitespace checks for untracked `gpui/src/terminal_ghostty_surface.rs` and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: no actual terminal process launch, runtime launch payload source from app startup state, runtime success/failure producer, Mounting-to-Running wiring, close/process teardown, command-pane real terminal surface, popped-out real reattach, keyboard/mouse event translation, paste/selection/IME behavior, persistent runtime ids, persistent logging audit beyond shell-state JSON, app launch/restart, or visual automation/validation was added.

### 2026-06-23-00:10 Task slice 120

- Added a distinct runtime-only `AgentsTerminalStartupBodySlotId` and startup body geometry record for visible selected `Mounting` Agents terminal bodies. This stays separate from the Running-only `AgentsTerminalBodyMountSlotId`, so real Ghostty mount slots, host maps, surface owners, and automatic Running promotion remain unchanged.
- Rendered a paint-only body measurement canvas for visible selected `Mounting` terminal bodies while preserving the existing startup placeholder card plus the normal body click/drop owner. No hidden hit region, transparent overlay owner, broad hit-test routing, synthetic coordinate routing, process launch, Ghostty host/surface creation, logging, or persistence was added.
- Added App-owned startup body geometry storage keyed by startup slot id. The map records only current visible selected Mounting slots and prunes stale entries when sessions leave Mounting, fail, are removed, become hidden by Focus mode, switch away from Agents visibility, or are no longer selected.
- Extended the runtime-only startup coordinator so pending records track whether an exact current Mounting body bounds/scale record exists. Ready and Failed result semantics stay the same: Ready promotes the matching current Mounting shell session to Running, Failed preserves the failed placeholder, and stale results remain ignored.
- Added focused Rust coverage for Mounting startup slot eligibility versus Running mount slots, Focus-mode/non-selected/non-Mounting exclusions, startup geometry record/prune boundaries, coordinator geometry availability without result semantic changes, and shell-state omission of startup slot/bounds/geometry/private names plus numeric geometry.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted reads of `~/.agents/main.md`, Phase 3 docs, Sleeping/Mounting/Popped-out parity requirements, slices 118-119, `gpui/src/main.rs`, and this progress log; targeted `rg`, `sed`, and diff review of startup coordinator, body slot rendering, runtime geometry maps, shell-state privacy guards, and tests; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 191 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed). Main-agent review at `2026-06-23-00:20` checked startup slot separation from Running mount slots, Mounting-only render/geometry ownership, pruning on state/removal/Focus/selection/Agents visibility changes, host sync remaining Running-only, shell-state privacy omissions, and absence of process launch/logging/overlap/native-view changes; then reran `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 191 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: no actual terminal process launch, runtime launch payload source from app startup state, runtime success/failure producer, real Mounting-to-Running wiring beyond the existing test-only result boundary, close/process teardown, command-pane real terminal surface, popped-out real reattach, keyboard/mouse event translation, paste/selection/IME behavior, persistent runtime ids, persistent logging audit beyond shell-state JSON, app launch/restart, or visual automation/validation was added.

### 2026-06-23-00:22 Task slice 121

- Added a runtime-only Agents terminal startup launch-plan boundary in `gpui/src/main.rs`. Plans derive only from current pending visible selected `Mounting` startup records, matching runtime/session identity, active Agents visibility, and exact `AgentsTerminalStartupBodyGeometry`.
- Kept launch plans distinct from Running mount infrastructure. The plan payload carries only runtime session id, shell session id, pane id, `AgentsTerminalStartupBodySlotId`, bounds, and scale; it does not carry cwd, command, env, stdout/stderr, terminal content, process ids, logs, persisted fields, Ghostty hosts, Ghostty surfaces, `AgentsTerminalBodyMountSlotId`, or automatic Ready/Failed results.
- Wired `sync_agents_terminal_surface_host` so startup launch plans refresh after startup candidate sync and before the existing Running-only host reconciliation. The Running host/surface path remains keyed only by current visible selected `Running` mount slots.
- Added focused Rust coverage for no launch plan before matching geometry, exact plan identity/geometry when geometry exists, plan pruning when Agents is hidden, session state changes, tab selection changes, Focus mode hides the pane, shell sessions are removed, or runtime ids no longer match, Mounting launch plans not creating Running host plans, and shell-state JSON omission of launch-plan/runtime geometry/helper names plus numeric geometry.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted reads of `~/.agents/main.md`, Phase 3 docs, Sleeping/Mounting/Popped-out and Layout Ownership parity requirements, slices 116-120, `gpui/src/main.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/terminal_surface_host.rs`, and this progress log; `date '+%Y-%m-%d-%H:%M'`; targeted `rg`, `sed`, and diff review of startup coordinator, startup geometry maps, Running-only host sync, shell-state privacy guards, and tests; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); first `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` failed because one new test used `assert_eq!` on `AgentsTerminalBodyMountSlotId` without `Debug`; after changing that assertion to `is_empty()`, `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 194 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); after shortening an overlong test name, reran `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 194 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output. Main-agent review at `2026-06-23-00:29` checked launch-plan derivation from pending Mounting records and exact geometry, runtime/session identity matching, pruning on visibility/state/selection/Focus/removal/runtime mismatch, Running-only host reconciliation isolation, shell-state privacy omissions, and absence of process launch/native-view/logging/persistence changes; then reran `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 194 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: no actual terminal process launch, runtime launch payload source from app startup state, runtime success/failure producer beyond the existing explicit result boundary, automatic Mounting-to-Running promotion, close/process teardown, command-pane real terminal surface, popped-out real reattach, keyboard/mouse event translation, paste/selection/IME behavior, persistent runtime ids, persistent logging audit beyond shell-state JSON, app launch/restart, or visual automation/validation was added.

### 2026-06-23-00:40 Task slice 122

- Added a runtime-only startup native-host/config request boundary for Mounting Agents terminals. Current `AgentsTerminalStartupLaunchPlan` values now reconcile into separate hidden App-owned startup host NSViews keyed by `AgentsTerminalStartupBodySlotId`, never by `AgentsTerminalBodyMountSlotId`.
- Prepared empty `GhosttySurfaceConfigRequest` values from owned startup host views plus each launch plan's measured scale. This does not call `ghostty_surface_new`, create a `GhosttySurfaceOwner`, show or focus the startup host, apply Ready/Failed, promote to Running, launch a process, or invent cwd/command/env/path payloads.
- Kept startup pruning tied to the existing current launch-plan boundary: startup host/config state drops when Agents is hidden, sessions leave Mounting for Running or StartupFailed, selection changes, Focus mode hides the pane, shell sessions are removed, or runtime identity no longer matches the plan.
- Preserved Running isolation. Running host/surface maps and `AgentsTerminalBodyMountSlotId` reconciliation remain Running-only; Mounting startup config requests live in their own maps and cannot feed the Running Ghostty surface creation path.
- Updated CDXC comments that previously implied Mounting could never create any host state. The comments now distinguish forbidden Running host/surface state from the allowed hidden startup host/config request boundary.
- Added focused Rust coverage for missing launch plans producing no startup host/config, current launch plans creating exactly one hidden startup host/config with exact bounds and scale, pruning across visibility/state/selection/Focus/removal/runtime mismatch, Running map isolation, and shell-state JSON omission of startup host/config helper names, native pointer-like names, geometry, and scale.
- Files touched: `gpui/src/main.rs`, `gpui/src/terminal_native_view.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted reads of `~/.agents/main.md`, Phase 3 docs, Sleeping/Mounting/Popped-out and Layout Ownership parity requirements, slice 121 progress, `gpui/src/main.rs`, `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_ghostty_surface.rs`, and `gpui/src/terminal_surface_host.rs`; `date '+%Y-%m-%d-%H:%M'`; targeted `rg`/`sed` review of startup coordinator, startup launch plans, native host ownership, Ghostty config requests, Running host sync, and shell-state privacy tests; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); first `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` passed with 199 `src/main.rs` tests and 0 helper-bin tests but warned about an unnecessary `mut`; after removing it, reran `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 199 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); after refining stale Mounting host comments, reran `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 199 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/src/terminal_native_view.rs gpui/src/terminal_ghostty_surface.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed); no-index whitespace checks for untracked `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/terminal_surface_host.rs`, and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Main-agent review at `2026-06-23-03:22` checked startup host identity against `AgentsTerminalStartupBodySlotId`, hidden startup host creation from launch plans, empty config request preparation from launch-plan scale, stale-state pruning tests, Running host/surface map isolation, shell-state privacy omissions, and absence of process launch/show/focus/native input/persistence/logging changes; then reran `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 199 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/src/terminal_native_view.rs gpui/src/terminal_ghostty_surface.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed); no-index whitespace checks for untracked `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_ghostty_surface.rs`, and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: no actual terminal process launch, non-empty launch payload source from app startup state, runtime success/failure producer beyond the explicit test boundary, automatic Mounting-to-Running promotion, close/process teardown, command-pane real terminal surface, popped-out real reattach, keyboard/mouse event translation, paste/selection/IME behavior, persistent runtime ids, persistent logging audit beyond shell-state JSON, app launch/restart, or visual automation/validation was added.

### 2026-06-23-03:23 Task slice 123

- Hardened startup host/config lifetime across render-start geometry resets. Current pending Mounting records now derive runtime-only preservation keys, so a startup host/config previously created from a valid launch plan survives a temporary no-geometry sync only when the same `AgentsTerminalStartupBodySlotId` and runtime id remain current.
- Preserved the creation boundary: startup hosts are still created only from `AgentsTerminalStartupLaunchPlan` values with exact geometry. A pending record without a prior launch-created host/config does not create native host state, Ghostty config requests, processes, Ready/Failed transitions, Running mount slots, logs, persistence, show, or focus.
- Kept real stale pruning intact. Startup host/config state drops when Agents is hidden, sessions leave Mounting for Running or StartupFailed, selection changes, Focus mode hides the pane, shell sessions are removed, runtime identity no longer matches, the parent/bounds/config boundary is invalid, or no current pending preservation record exists.
- Preserved Running isolation. Running host/surface maps and `AgentsTerminalBodyMountSlotId` reconciliation remain untouched by startup preservation, and startup config requests remain empty launch payloads.
- Added CDXC comments for the startup host lifetime requirement and expanded shell-state privacy guards so lifetime-helper names plus runtime/native/geometry/scale values stay out of durable JSON.
- Files touched: `gpui/src/main.rs`, `gpui/src/terminal_native_view.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted reads of `~/.agents/main.md`, Phase 3 docs, Sleeping/Mounting/Popped-out and Layout Ownership parity requirements, slices 121-122, `gpui/src/main.rs`, `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_ghostty_surface.rs`, and `gpui/src/terminal_surface_host.rs`; `date '+%Y-%m-%d-%H:%M'`; targeted `rg`, `sed`, and diff review of startup coordinator, launch plans, host/config reconciliation, Running-only host sync, shell-state privacy guards, and tests; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 203 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/src/terminal_native_view.rs gpui/src/terminal_ghostty_surface.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed); no-index whitespace checks for untracked `gpui/src/terminal_native_view.rs` and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Main-agent review at `2026-06-23-03:31` checked preservation-key derivation from current pending Mounting records, no-host creation without prior launch geometry, preservation through no-geometry sync without another create attempt, pruning on real stale boundaries and invalid parent/bounds/config, Running host/surface map isolation, shell-state privacy omissions, and absence of process launch/show/focus/native input/persistence/logging changes; then reran `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 203 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/src/terminal_native_view.rs gpui/src/terminal_ghostty_surface.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed); no-index whitespace checks for untracked `gpui/src/terminal_native_view.rs` and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: no actual terminal process launch, non-empty launch payload source from app startup state, runtime success/failure producer beyond the explicit test boundary, automatic Mounting-to-Running promotion, close/process teardown, command-pane real terminal surface, popped-out real reattach, keyboard/mouse event translation, paste/selection/IME behavior, persistent runtime ids, persistent logging audit beyond shell-state JSON, app launch/restart, or visual automation/validation was added.

### 2026-06-23-03:33 Task slice 124

- Added a startup-owned Ghostty surface owner boundary in `gpui/src/terminal_ghostty_surface.rs`. `StartupGhosttySurfaceOwner` is keyed by `AgentsTerminalStartupBodySlotId` plus `AgentsTerminalRuntimeSessionId`, uses the same GhosttyKit surface create/free path from a prepared `GhosttySurfaceConfigRequest` and shared `GhosttyAppOwner`, updates content scale and pixel size from launch-plan bounds/scale, and has no mount-slot, focus, show, input, Ready/Failed, logging, persistence, or launch-payload exposure API.
- Wired macOS runtime-only startup surface ownership in `gpui/src/main.rs` with a separate `agents_terminal_startup_ghostty_surfaces` map keyed by `AgentsTerminalStartupBodySlotId`. Startup surfaces create only when both a startup config request and launch plan exist, preserve through same-slot/same-runtime geometry-gap preservation, update from the launch-created plan, and prune on stale visibility/state/selection/Focus/removal, runtime replacement, missing config request, invalid size/scale, app-owner errors, or host teardown.
- Preserved Running isolation. The existing `agents_terminal_ghostty_surfaces` map remains keyed by `AgentsTerminalBodyMountSlotId`, and Mounting startup state still does not feed `GhosttySurfaceOwner`, Running mount slots, focus sync, AppKit show/focus, input/IME/paste, close teardown, or `apply_agents_terminal_startup_result`.
- Added a native host survival predicate so startup surfaces are freed before a backing startup host NSView is dropped or replaced, including the missing-config prune path after startup config generation fails.
- Added focused Rust coverage for startup owner identity without `AgentsTerminalBodyMountSlotId`, fake Ghostty create/update/drop calls using exact bounds/scale, no focus calls, app sync create prerequisites, geometry-gap preservation, stale pruning, runtime replacement, invalid scale, app-owner errors, pre-host-reconcile drop ordering, Running map isolation, and shell-state omission of startup surface owner/map/helper names, pointer/native/Ghostty terms, geometry, runtime ids, and private launch payload strings.
- Files touched: `gpui/src/main.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/terminal_native_view.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted reads of `~/.agents/main.md`, Phase 3 docs, Sleeping/Mounting/Popped-out and Layout Ownership parity requirements, slices 121-123, `gpui/src/main.rs`, `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_ghostty_surface.rs`, and this progress log; `date '+%Y-%m-%d-%H:%M'`; targeted `rg`, `sed`, and diff review of startup host/config reconciliation, Ghostty surface owners, Running-only surface sync, shell-state privacy guards, and tests; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); first `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` failed because the new runtime-mismatch test expected an empty map instead of the valid replacement owner for a new matching launch plan; after fixing that assertion, `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml startup_ghostty_surface -- --nocapture` passed; `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` passed with 211 `src/main.rs` tests and 0 helper-bin tests; `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` passed; `git diff --check -- gpui/src/main.rs gpui/src/terminal_native_view.rs gpui/src/terminal_ghostty_surface.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` passed; no-index whitespace checks for untracked `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/terminal_native_view.rs`, and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Main-agent review at `2026-06-23-03:48` checked `StartupGhosttySurfaceOwner` identity separation from Running mount slots, create/update/free behavior from prepared startup config requests, absence of show/focus/input/result APIs, same-runtime geometry-gap preservation, pre-host-reconcile surface drops before startup host teardown, Running surface-map isolation, shell-state privacy omissions, and absence of persistent logging or launch-result promotion. Reran `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 211 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/src/terminal_ghostty_surface.rs gpui/src/terminal_native_view.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed); no-index whitespace checks for untracked `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/terminal_native_view.rs`, and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Remaining gaps: no actual terminal process launch, non-empty launch payload source from app startup state, runtime success/failure producer beyond the explicit test boundary, automatic Mounting-to-Running promotion, close/process teardown, command-pane real terminal surface, popped-out real reattach, keyboard/mouse event translation, paste/selection/IME behavior, persistent runtime ids, persistent logging audit beyond shell-state JSON, app launch/restart, or visual automation/validation was added.

### 2026-06-23-03:51 Task slice 125

- Inspected the GPUI startup coordinator/hidden-host/startup-surface path and the app-owned macOS terminal lifecycle source of truth. The macOS app sends `terminalReady` after a real `GhostexGhosttySurfaceView` is created and reports tty/pid from the surface model; the current GPUI GhosttyKit wrapper exposes surface create/update/free but no terminalReady-equivalent tty/pid or runtime failure signal.
- Added a runtime-only startup completion intent/result-producer boundary in `gpui/src/main.rs`. Current Mounting sessions now advertise an exact `AgentsTerminalStartupCompletionIntent` keyed by runtime session id, shell session id, and `AgentsTerminalStartupBodySlotId`; `produce_startup_result_from_runtime_signal(None)` returns no result, so hidden startup host/surface creation cannot infer success.
- Tightened Ready/Failed application so explicit results must match the current runtime/session/startup-slot intent. Stale runtime, stale shell session, stale startup slot, non-current Mounting state, or removed sessions are ignored and pruned as appropriate, and a successful result is one-shot.
- Preserved the startup/Running handoff boundary. Applying an explicit result drops startup geometry and macOS startup-owned Ghostty surface/config/host state, with the startup surface removed before the hidden host; Running mount slots/maps remain untouched until a later normal Running render/sync pass owns the visible mount.
- Extended Rust coverage for no automatic Mounting-to-Running promotion without a real/explicit signal, exact-signal production without auto-apply, stale runtime/session/slot result rejection, one-shot Ready transfer, Failed retry placeholder behavior without raw error details, Running map isolation before Ready, and shell-state omission of the new completion intent/signal/map/helper names.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted reads of `~/.agents/main.md`, Phase 3 docs, slices 121-124, `gpui/src/main.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/terminal_native_view.rs`, `gpui/src/ghostty_kit.rs`, native macOS `TerminalWorkspaceView.swift`/`HostProtocol.swift` readiness paths, and this progress log; targeted `rg`/`sed` review of startup coordinator, startup result tests, GhosttyKit FFI surface API, native `terminalReady`/`terminalError` flow, and shell-state privacy guards; `date '+%Y-%m-%d-%H:%M'`; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml agents_terminal_startup -- --nocapture` (passed, 28 startup tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 213 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/src/terminal_ghostty_surface.rs gpui/src/terminal_native_view.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed); no-index whitespace check for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md` (passed).
- Main-agent review at `2026-06-23-03:59` checked completion intent derivation from current Mounting records, inert `None` runtime-signal behavior, exact runtime/session/startup-slot result matching, stale result pruning, one-shot Ready/Failed application, startup-owned state cleanup order, Running map isolation, shell-state privacy omissions, and the absence of an automatic runtime caller. Reran `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 213 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/src/terminal_ghostty_surface.rs gpui/src/terminal_native_view.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed); no-index whitespace checks for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md`, `gpui/src/terminal_ghostty_surface.rs`, and `gpui/src/terminal_native_view.rs` returned the expected diff status with no whitespace output.
- Remaining gaps: no actual terminal process launch, non-empty launch payload source from app startup state, real runtime success/failure signal producer, automatic Mounting-to-Running promotion from a real signal, close/process teardown, command-pane real terminal surface, popped-out real reattach, keyboard/mouse event translation, paste/selection/IME behavior, persistent runtime ids, persistent logging audit beyond shell-state JSON, app launch/restart, or visual automation/validation was added.

### 2026-06-23-04:00 Task slice 126

- Inspected GPUI shell/session creation, command-to-Agents transfer, startup coordinator/config/surface preparation, and the regular native/sidebar createTerminal source-of-truth. GPUI currently has placeholder titles, semantic activity, delayed-send booleans, runtime ids, startup slots, and geometry, but no explicit cwd/command/env/initial-input/wait-after-command source from app startup state. The real native/sidebar source still carries those values through its createTerminal contract, not through GPUI.
- Added a runtime-only `AgentsTerminalStartupLaunchPayloadSource` boundary in `gpui/src/main.rs`. It is empty in production today, keyed for future explicit data by runtime session id, shell session id, and `AgentsTerminalStartupBodySlotId`, and validates future explicit values through `GhosttySurfaceLaunchPayload::try_new` so interior-NUL rejection stays at the writer/FFI boundary.
- Wired startup host config request preparation to ask only this source for launch payloads. A valid future explicit payload can attach only to the exact startup-owned config request for the matching runtime/session/startup slot; mismatched keys leave a default empty request, and invalid payloads skip the config request so the hidden startup host/surface boundary prunes without fallback.
- Preserved the current inert behavior: no GPUI title, status label, project name, workspace path, sidebar label, delayed-send flag, shell JSON, Running map, command-pane state, or fallback project detection is parsed into cwd, command, env, initial input, or wait-after-command. No process launch, Ready/Failed result, Running promotion, persistent id, persistent log, regular macOS app edit, native overlay, hidden hit region, broad hit-test route, app launch, or restart was added.
- Added focused Rust coverage for empty-source non-parsing, exact-key future explicit payload matching, mismatched-source default requests, invalid interior-NUL payload pruning without raw value leaks, startup config request redacted Debug output, Running mount-slot isolation, and shell-state omission of the new source/map/helper names plus private sample payload strings.
- Files touched: `gpui/src/main.rs`, `gpui/src/terminal_native_view.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted reads of `~/.agents/main.md`, GPUI startup/session/config/surface code, regular native/sidebar createTerminal source-of-truth, shared native Ghostty protocol, and this progress log; targeted `rg`/`sed` review of startup candidates, launch plans, host/config reconciliation, shell-state privacy tests, command/Agents transfer, delayed-send metadata, and launch payload helpers; `date +%Y-%m-%d-%H:%M`; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml agents_startup_launch_payload` (passed, 3 focused tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 216 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/src/terminal_ghostty_surface.rs gpui/src/terminal_native_view.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed); no-index whitespace checks for untracked `gpui/src/terminal_native_view.rs` and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Main-agent review at `2026-06-23-04:11` checked the production-empty launch payload source, exact runtime/session/startup-slot future payload keying, no title/status/project/sidebar/delayed-send parsing, invalid interior-NUL pruning without fallback, startup config request redaction, Running map isolation, and shell-state privacy omissions. I also updated an older CDXC comment that still described startup config requests as always carrying empty launch payloads. Reran `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 216 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/src/terminal_ghostty_surface.rs gpui/src/terminal_native_view.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed); no-index whitespace checks for untracked `gpui/WORKSPACE_PARITY_PROGRESS.md`, `gpui/src/terminal_native_view.rs`, and `gpui/src/terminal_ghostty_surface.rs` returned the expected diff status with no whitespace output.
- Remaining gaps: no actual terminal process launch, non-empty GPUI launch payload producer from explicit app startup state, real runtime success/failure signal producer, automatic Mounting-to-Running promotion from a real signal, close/process teardown, command-pane real terminal surface, popped-out real reattach, keyboard/mouse event translation, paste/selection/IME behavior, persistent runtime ids, persistent logging audit beyond shell-state JSON, app launch/restart, or visual automation/validation was added.

### 2026-06-23-04:13 Task slice 127

- Added GhosttyKit FFI declarations in `gpui/src/ghostty_kit.rs` for `ghostty_surface_process_exited`, `ghostty_surface_foreground_pid`, `ghostty_surface_tty_name`, `ghostty_string_s`, and `ghostty_string_free`, with ABI/signature coverage tied to the exported GhosttyKit header.
- Added a redacted Ghostty surface metadata snapshot API in `gpui/src/terminal_ghostty_surface.rs`. Startup and shared surface owners can now read process-exited, foreground-process-id-present, and tty-name-present booleans while immediately discarding/freeing raw tty strings and never exposing raw pids.
- Added a runtime-only startup readiness preparation boundary in `gpui/src/main.rs`. Startup-owned Ghostty surfaces are observed only for exact current startup completion intents; matching ready metadata creates a preparation record but does not produce/apply Ready, create Failed, promote Mounting to Running, drop startup ownership, or touch Running surface maps.
- Preserved privacy and lifecycle invariants: no process launch beyond existing startup surface creation, no fake success, no duplicate Running surface, no persistent runtime ids or metadata, no persistent logs, no raw tty/pid/path/command/env/stdout/stderr/terminal content, no fallback project detection, no regular macOS app edits, and no layout/hit-test changes.
- Added focused Rust coverage for FFI ABI/function signatures, redacted metadata snapshots, no automatic Mounting-to-Running promotion when ready metadata exists, stale/mismatched readiness rejection, startup-owner metadata observation without Running-map mutation, and shell-state omission of readiness helper/map/metadata names plus sample tty/pid values.
- Files touched: `gpui/src/main.rs`, `gpui/src/ghostty_kit.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands run from repo root: targeted reads of `~/.agents/main.md`, `AGENTS.md`, the GhosttyKit header, GPUI startup/surface/FFI code, tests, and this progress log; `date '+%Y-%m-%d-%H:%M'`; targeted `rg`/`sed` review of startup completion intents/results, startup Ghostty surfaces, GhosttyKit surface exports, shell-state privacy guards, and prior progress; `RUSTUP_TOOLCHAIN=1.95.0 cargo fmt --manifest-path gpui/Cargo.toml` (passed); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml ghosttykit -- --nocapture` (passed, 2 focused tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml metadata_snapshot -- --nocapture` (passed, 1 focused test); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml startup_readiness -- --nocapture` (passed, 3 focused tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo test --manifest-path gpui/Cargo.toml` (passed, 220 `src/main.rs` tests and 0 helper-bin tests); `RUSTUP_TOOLCHAIN=1.95.0 cargo check --manifest-path gpui/Cargo.toml` (passed); `git diff --check -- gpui/src/main.rs gpui/src/ghostty_kit.rs gpui/src/terminal_ghostty_surface.rs gpui/src/terminal_native_view.rs gpui/build.rs gpui/Cargo.toml gpui/Cargo.lock` (passed); no-index whitespace checks for untracked `gpui/src/ghostty_kit.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/terminal_native_view.rs`, and `gpui/WORKSPACE_PARITY_PROGRESS.md` returned the expected diff status with no whitespace output.
- Main-agent review at `2026-06-23-04:24` checked the GhosttyKit header/FFI signature match, `ghostty_string_s` free-at-boundary behavior, redacted metadata snapshot shape, exact runtime/session/startup-slot readiness preparation, absence of automatic Ready/Failed production or application, Running surface-map isolation, shell-state privacy omissions, and absence of new logs or layout/hit-test changes. Main-session fmt, targeted tests, full GPUI test/check, and whitespace checks were skipped per user instruction after worker completion.
- Remaining gaps: automatic Mounting-to-Running promotion remains intentionally deferred until startup surface/host ownership can be transferred into the Running path without dropping or recreating the process. Still missing actual terminal process launch beyond the existing startup surface path, non-empty GPUI launch payload producer from explicit app startup state, real runtime failure signal, close/process teardown, command-pane real terminal surface, popped-out real reattach, keyboard/mouse event translation, paste/selection/IME behavior, persistent runtime ids, persistent logging audit beyond shell-state JSON, app launch/restart, and visual automation/validation.

### 2026-06-23-04:25 Task slice 128

- Implemented the real ready startup handoff from startup-owned Ghostty/AppKit ownership into the normal Running maps without creating a duplicate Running surface. Ready metadata now derives an exact handoff plan only for the current visible selected Mounting session with matching runtime session id, shell session id, startup body slot id, launch plan, and resulting `AgentsTerminalBodyMountSlotId`.
- Added explicit owner conversion paths: `StartupGhosttySurfaceOwner` consumes itself into `GhosttySurfaceOwner` through `ManuallyDrop` so `ghostty_surface_free` is not called during promotion, and `AppOwnedTerminalStartupHostNativeView` consumes itself into `AppOwnedTerminalHostNativeView` only for the same pane/session identity and exact launch bounds.
- Wired the app sync order so startup readiness is sampled, then ready handoffs are attempted before Running host reconciliation. A successful transfer seeds Running mount-slot bounds from the startup launch plan, inserts the transferred host/surface into the Running maps, cleans startup geometry/config/host/surface state, removes any matched explicit launch payload, and lets the existing Running sync resize/show/focus through normal paths.
- Preserved strict failure behavior: if the current intent is stale, metadata mismatches, startup host/surface ownership is missing, or the target Running maps already contain that mount slot, the handoff returns false, leaves the shell session Mounting, and keeps startup state for the existing prune boundaries instead of faking Running.
- Tightened the app-level Ready result path on macOS so it also requires the exact owner-transfer handoff. Failed and stale-result cleanup still prune startup state without creating Running ownership.
- Added focused macOS Rust coverage for transferring the same startup host/surface without recreate/free/focus calls, rejecting Running-map collisions without promotion, and expanded shell-state privacy assertions for the new handoff/helper names.
- Files touched: `gpui/src/main.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/terminal_native_view.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md` and `AGENTS.md`; `git status --short`; `date +%Y-%m-%d-%H:%M`; targeted `rg`, `sed`, and `tail` review of GPUI startup coordinator, startup host/config reconciliation, startup Ghostty surface owners, Running host/surface sync, render body bounds recording, shell-state privacy tests, and this progress log.
- Verification skipped by explicit user override: `cargo fmt`, targeted tests, full GPUI tests, `cargo check`, `git diff --check`, no-index/whitespace checks, `bun run start`, app launch/restart, and visual/browser automation.
- Main-agent review at `2026-06-23-04:37` checked consuming startup host/surface conversions, exact handoff-plan matching, restore-on-failed-transfer behavior, no duplicate Running host/surface creation, Running lifecycle readiness through the existing reconcile path, startup cleanup after successful transfer, collision rejection without promotion, shell-state privacy omissions, and absence of new logs, fallbacks, overlays, hidden hit regions, or hit-test routing. Main-session fmt, targeted tests, full GPUI test/check, and whitespace checks remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Real runtime failure signal handling, close/process teardown, command-pane real terminal surfaces, popped-out real reattach, keyboard/mouse event translation, paste/selection/IME behavior, persistent logging audit beyond shell-state JSON, app launch/restart, and visual validation remain deferred.

### 2026-06-23-04:38 Task slice 129

- Implemented real runtime failure handling from startup Ghostty metadata in `gpui/src/main.rs`. Startup-owned surface metadata is sampled only from the current startup surface owner map entry whose key matches the owner, and a process-exited snapshot now produces the existing Failed result only after exact runtime session id, shell session id, startup body slot id, visible selected Mounting state, and current startup intent checks pass.
- Wired the macOS startup surface sync order so exited metadata is applied before ready handoff preparation while preserving slice 128 Ready behavior. Ready metadata still goes through the startup-to-Running owner transfer path, and Failed metadata never creates Running maps, host views, mount slots, fallback success, inferred launch values, overlays, hidden hit regions, hit-test routing, logs, or raw runtime/process/tty data surfaces.
- Factored failed-startup cleanup so the startup Ghostty surface is removed before the hidden AppKit startup host, then config request, geometry, and exact launch payload state are pruned. The shell session remains as the existing retryable `StartupFailed` placeholder without raw error text, pid, tty name, command, cwd/path, env, stdout/stderr, or terminal content.
- Added focused Rust test code for exact exited metadata failure, stale/mismatched metadata rejection, macOS startup surface failure cleanup with Running map isolation, and shell-state privacy assertions for the new failure producer/cleanup helper names. Tests were added but intentionally not run.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md` and `AGENTS.md`; `date +%Y-%m-%d-%H:%M`; `git status --short -- gpui`; targeted `rg`, `sed`, `nl`, and `tail` review of GPUI startup coordinator, startup host/config/surface ownership, ready handoff tests, shell-state privacy tests, and this progress log; read-only `git diff -- gpui/src/main.rs` review.
- Verification skipped by explicit user override: `cargo fmt`, targeted tests, full GPUI tests, `cargo check`, `git diff --check`, no-index/whitespace checks or equivalents, `bun run start`, app launch/restart, and visual/browser automation.
- Main-agent review at `2026-06-23-04:47` checked process-exited metadata production, exact current-intent matching, active Agents/current Mounting gates, failure-before-ready sync ordering, startup Ghostty-before-host cleanup, Running map isolation, shell-state privacy omissions, and absence of new logs, fallbacks, overlays, hidden hit regions, or hit-test routing. During review I corrected the non-mac completion cleanup helper so exact explicit launch payloads are removed there too instead of staying in runtime memory. Main-session fmt, targeted tests, full GPUI test/check, and whitespace checks remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Close/process teardown, command-pane real terminal surfaces, popped-out real reattach, keyboard/mouse event translation, paste/selection/IME behavior, persistent logging audit beyond shell-state JSON, app launch/restart, and visual validation remain deferred.

### 2026-06-23-04:49 Task slice 130

- Added the `ghostty_surface_request_close` GhosttyKit ABI in `gpui/src/ghostty_kit.rs`, wired it through the GPUI `GhosttyKitFunctionTable`, production wrapper, startup fake table, and signature/fake-call test coverage as code only.
- Added runtime-only close token ownership in `gpui/src/terminal_ghostty_surface.rs`. Real surface creation now passes an owner-held close token as `ghostty_surface_config_s.userdata` while the AppKit NSView stays available through `platform.macos.nsview`; the embedded close callback records only confirmation-needed or confirmed-close state in process memory with no logs, persistence, raw paths, commands, env, stdout/stderr, tty names, pids, runtime ids, or terminal content.
- Made Running `GhosttySurfaceOwner::request_close` idempotent and transferred the close token during startup-to-Running handoff so the callback pointer remains valid when a Ready startup surface becomes a Running owner without recreating the Ghostty surface.
- Routed Cmd-W and active mounted Agents tab close through `ghostty_surface_request_close` when an exact current Running Ghostty owner exists. Placeholder, non-mounted, or non-Running tabs keep the existing immediate shell close behavior.
- Consumed confirmed close callbacks before Running host reconciliation. Only exact current Running mount slots are eligible, removal goes through `WorkspaceModel::close_tab`, runtime ids are reconciled afterward, and the existing host/surface prune path drops the matching Ghostty surface before releasing its AppKit host. Confirmation-needed callbacks remain pending because GPUI has no close-confirm UI yet.
- Added focused Rust test code for idempotent request-close FFI calls, confirmation-needed callback preserving the shell tab, confirmed callback removing only the matching Running shell session while leaving unrelated Running/startup maps alone, and shell-state omission of close-token/helper names plus private close payload samples.
- Files touched: `gpui/src/ghostty_kit.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md` and `AGENTS.md`; `date '+%Y-%m-%d-%H:%M'`; `git status --short -- gpui/src/ghostty_kit.rs gpui/src/terminal_ghostty_surface.rs gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md`; targeted `rg`, `sed`, and `tail` review of the Ghostty header export, GPUI FFI declarations, Ghostty surface owner/config/callback code, app close/sync paths, fake Ghostty tables, shell-state privacy tests, and this progress log.
- Verification skipped by explicit user override: `cargo fmt`, targeted tests, full GPUI tests, `cargo check`, `git diff --check`, no-index/whitespace checks or equivalents, `bun run start`, app launch/restart, and visual/browser automation.
- Main-agent review at `2026-06-23-05:00` checked the `ghostty_surface_request_close` ABI binding, owner-held close-token userdata, startup-to-Running token transfer, idempotent close request behavior, confirmation-needed pending state, exact current Running-slot confirmed-close consumption, shell removal through `WorkspaceModel::close_tab`, startup map isolation, shell-state privacy omissions, and absence of new logs, fallbacks, overlays, hidden hit regions, or hit-test routing. Main-session fmt, targeted tests, full GPUI test/check, and whitespace checks remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. GPUI still needs close-confirm UI for confirmation-needed callbacks, broader Running process-exit policy beyond the close callback path, command-pane real terminal surfaces, popped-out real reattach, keyboard/mouse event translation, paste/selection/IME behavior, persistent logging audit beyond shell-state JSON, app launch/restart, and visual validation.

### 2026-06-23-05:03 Task slice 131

- Implemented real command-pane terminal mount slots for expanded visible active command sessions in `gpui/src/main.rs`. Command slots are keyed by command group id plus command session id, remain runtime-only, and do not enter Agents pane/session identity, Agents runtime registries, startup maps, startup launch payloads, or shell-state JSON.
- Generalized the runtime terminal host, lifecycle, AppKit host owner/focus identity, platform command payloads, and Ghostty surface owner in `gpui/src/terminal_surface_host.rs`, `gpui/src/terminal_surface_lifecycle.rs`, `gpui/src/terminal_native_view.rs`, and `gpui/src/terminal_ghostty_surface.rs` so Agents remains the default slot type while command surfaces instantiate the same pipeline with `CommandTerminalBodyMountSlotId`.
- Recorded command terminal body bounds from the command body element in `render_command_terminal_placeholder`, not from the command group/titlebar bounds. Command body bounds are cleared on the same render-start reset path as other runtime layout bounds and pruned against the current expanded active command slots.
- Added command-owned runtime maps for body bounds, host plans, lifecycle state, macOS AppKit host views, Ghostty config requests, Ghostty surfaces, Ghostty app ownership, and AppKit focus identity. Command host/surface sync uses empty Ghostty launch requests for now and never parses command titles/status/project paths into cwd, command, env, initial input, or wait-after-command.
- Wired command surface cleanup on active command tab changes, command close, command-to-Agents transfer, Agents-to-command insertion, command split/group drag moves, and command pane collapse. Stale command Ghostty surfaces are dropped before their AppKit host views are released through the shared host/lifecycle cleanup path.
- Added command focus mirroring so shell focus `CommandPane` focuses only the mounted surface for the focused command group’s active session, while Agents/Browser/project-editor focus clears command Ghostty/AppKit focus. Existing Agents focus behavior stays on the existing Agents path.
- Added focused Rust test code for command mount-slot inclusion/exclusion, body-bounds host plans excluding group/titlebar bounds, command host/lifecycle isolation and pruning on close/collapse, command focus targeting/clearing, macOS command surface-map key isolation, and shell-state JSON omission of command terminal runtime/helper names and private sample command payloads.
- Files touched: `gpui/src/main.rs`, `gpui/src/terminal_surface_host.rs`, `gpui/src/terminal_surface_lifecycle.rs`, `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md` and `AGENTS.md`; `date '+%Y-%m-%d-%H:%M'`; `git status --short -- gpui/src/main.rs gpui/src/terminal_surface_host.rs gpui/src/terminal_surface_lifecycle.rs gpui/src/terminal_native_view.rs gpui/src/terminal_ghostty_surface.rs gpui/WORKSPACE_PARITY_PROGRESS.md`; targeted `rg`, `sed`, and `tail` review of GPUI command-pane model/rendering, Agents terminal host/surface sync, shared terminal host/lifecycle/native-view/Ghostty owner helpers, existing terminal tests, shell-state privacy tests, and this progress log.
- Verification skipped by explicit user override: `cargo fmt`, targeted tests, full GPUI tests, `cargo check`, `git diff --check`, no-index/whitespace checks or equivalents, `bun run start`, app launch/restart, and visual/browser automation.
- Main-agent review at `2026-06-23-05:18` checked command slot inclusion/exclusion, command body-bound recording, generic host/lifecycle/native-view/surface owner isolation, command focus mirroring, shell-state privacy omissions, and absence of new logs, fallbacks, overlays, hidden hit regions, or hit-test routing. During review I removed eager command surface sync calls from command model-change handlers so AppKit/Ghostty reconciliation stays render/bounds-driven with the real window scale factor instead of previous-frame bounds and hardcoded `1.0` scale. Main-session fmt, targeted tests, full GPUI test/check, and whitespace checks remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Command surfaces still use an empty default launch request, and keyboard/mouse event translation, paste/selection/IME behavior, command close-confirm UI, command process policy beyond surface drop, popped-out real reattach, persistent logging audit beyond shell-state JSON, app launch/restart, and visual validation remain deferred.

### 2026-06-23-05:21 Task slice 132

- Implemented command-pane Ghostty close parity in `gpui/src/main.rs`. Command tab close requests now ask the exact current mounted command Ghostty surface to close before mutating command shell state; stale, inactive, collapsed, missing, and non-mounted command tabs continue through the existing placeholder `CommandPaneModel::close_session` path.
- Routed command tab close buttons, context-menu/action close, and focused Cmd-W with `ShellFocusTarget::CommandPane` through the mounted-surface request helper. Repeated requests stay idempotent through `GhosttySurfaceOwner::request_close`, and shell command sessions remain pending until a confirmed runtime close callback is consumed.
- Consumed confirmed command Ghostty close callbacks before command host reconciliation, mirroring the Agents close path while staying command-scoped. Only exact current command mount slots remove sessions via `CommandPaneModel::close_session`; confirmation-needed callbacks stay pending because GPUI still has no close-confirm UI.
- Preserved separation from Agents runtime maps, startup maps, shell-state JSON, logging, overlays, hidden hit regions, hit-test overrides, synthetic routing, and regular macOS/native app code. The existing render-start/body-canvas command host sync remains the only command host/surface cleanup path.
- Added focused Rust test code only for command request-close idempotence and pending shell state, confirmation-needed callbacks preserving command sessions, confirmed callbacks removing only the exact command session while unrelated Agents/command/startup maps remain untouched, and shell-state omission of command-close helper/token names plus private command-close sample values.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`; `git status --short -- gpui`; `date +%Y-%m-%d-%H:%M`; targeted `rg`, `sed`, and `tail` review of command/Agents close paths, command host/surface sync, Ghostty surface owner close APIs, existing fakes/tests, and this progress log; read-only `git diff -- gpui/src/main.rs` review from the initial dirty-worktree inspection.
- Verification skipped by explicit user override: `cargo fmt`, targeted tests, full GPUI tests, `cargo check`, `git diff --check`, no-index/whitespace checks or equivalents, `bun run start`, app launch/restart, and browser/visual automation.
- Main-agent review at `2026-06-23-05:27` checked exact current command-slot close request gating, idempotent mounted-surface handling without fallthrough shell deletion, command tab button/action/Cmd-W routing, confirmed callback consumption before command host reconciliation, command/Agents/startup map isolation in test code, shell-state privacy omissions, and absence of new logs, fallbacks, overlays, hidden hit regions, hit-test routing, app restart, or visual automation. Main-session fmt, targeted tests, full GPUI test/check, and whitespace checks remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Command surfaces still use an empty default launch request, and command close-confirm UI, command process policy beyond confirmed surface close, keyboard/mouse event translation, paste/selection/IME behavior, popped-out real reattach, persistent logging audit beyond shell-state JSON, app launch/restart, and visual validation remain deferred.

### 2026-06-23-05:30 Task slice 133

- Added a runtime-only boolean `GhosttySurfaceOwner::process_exited` query in `gpui/src/terminal_ghostty_surface.rs` so mounted cleanup can poll only redacted exit state without reading tty names, foreground pids, paths, command text, env, output, or terminal content.
- Implemented mounted Running Agents process-exit cleanup in `gpui/src/main.rs`. The helper considers only exact current Running mount slots with matching runtime session ids, removes exited shell sessions through `WorkspaceModel::close_tab`, reconciles runtime ids afterward, and leaves startup maps out of scope.
- Implemented mounted command process-exit cleanup in `gpui/src/main.rs`. The helper considers only exact current command body slots with matching command runtime identity and removes sessions through `CommandPaneModel::close_session` without touching Agents runtime maps, Agents startup maps, or close-confirm callback state.
- Wired both helpers after confirmed close consumption and before host command reconciliation. Existing render/bounds-driven host cleanup remains responsible for dropping stale Ghostty/AppKit ownership, with no eager `sync_command_terminal_surface_host(1.0)` call and no Ghostty close request for already-exited surfaces.
- Added focused Rust test code only for exact Agents exited-tab cleanup with startup state preserved, stale/inactive/non-current Agents exits ignored, exact command exited-session cleanup with unrelated command/Agents/startup state preserved, stale/inactive/non-current command exits ignored, and shell-state omission of new process-exit helper names plus private sample process/terminal values.
- Files touched: `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`; `git status --short -- gpui`; `date +%Y-%m-%d-%H:%M`; targeted `rg`, `sed`, and `tail` review of GPUI Ghostty surface metadata/close APIs, Agents and command host reconciliation, model close helpers, existing fake Ghostty test helpers, shell-state privacy tests, and this progress log.
- Verification skipped by explicit user override: `cargo fmt`, targeted tests, full GPUI tests, `cargo check`, `git diff --check`, no-index/whitespace checks or equivalents, `bun run start`, app launch/restart, and browser/visual automation.
- Main-agent review at `2026-06-23-05:36` checked the boolean-only process-exited query, exact current slot and runtime-id matching, no Ghostty close request for already-exited surfaces, Agents runtime reconciliation, startup/command/Agents map isolation, command final-session collapse through the command model, Agents final-root close guard preservation, shell-state privacy omissions, sync order before host reconciliation, and absence of new logs, fallbacks, overlays, hidden hit regions, hit-test routing, app restart, or visual automation. Main-session fmt, targeted tests, full GPUI test/check, and whitespace checks remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Command surfaces still use an empty default launch request, and command close-confirm UI, keyboard/mouse event translation, paste/selection/IME behavior, popped-out real reattach, persistent logging audit beyond shell-state JSON, app launch/restart, and visual validation remain deferred.

### 2026-06-23-05:39 Task slice 134

- Added runtime-only close-confirm pending state for mounted Running Agents Ghostty surfaces in `gpui/src/main.rs`. Pending entries are keyed only by the exact current `AgentsTerminalBodyMountSlotId` plus process-local surface owner identity, are populated by consuming confirmation-needed callbacks once, prune when the current slot/runtime owner no longer matches, and never enter shell-state JSON, launch payloads, durable ids, logs, command text, paths, env, stdout/stderr, tty names, pids, tokens, or terminal content.
- Added separate runtime-only close-confirm pending state for mounted command Ghostty surfaces. Command pending state is keyed by `CommandTerminalBodyMountSlotId` plus the transient command surface owner identity and stays isolated from Agents workspace maps, Agents runtime-session maps, and startup maps.
- Tightened confirmed-close consumption for both Agents and command surfaces so shell state is removed only when the current model slot, the map key, and the surface owner runtime identity still match. Confirmed callbacks still remove shell state only through the existing `WorkspaceModel::close_tab` and `CommandPaneModel::close_session` paths, and pending entries are cleared only after that existing callback path is consumed.
- Added explicit confirm/cancel model methods for both Agents and command pending state. Cancel clears only the matching runtime pending entry, resets the exact surface owner's process-local close-request latch so a later close can ask Ghostty again, and leaves the shell session mounted. Confirm validates the exact current mounted owner but returns `false` because `gpui/src/ghostty_kit.rs` currently exposes `ghostty_surface_request_close` and the close callback only, with no close-confirm or close-cancel ABI to bind without inventing fallback behavior.
- Added focused Rust test code only for confirmation-needed pending creation, exact-current confirm validation with the current ABI gap, confirmed-callback removal after pending state, cancel preserving shell state, stale/inactive/mismatched/final-root Agents surfaces ignored, stale/inactive/mismatched command surfaces ignored, command/Agents/startup map isolation, one-shot surface-token consumption, and shell-state privacy omissions for close-confirm helper names plus private samples.
- Files touched: `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md` and `AGENTS.md`; `git status --short`; `date '+%Y-%m-%d-%H:%M'`; targeted `rg`, `sed`, and `tail` review of `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/ghostty_kit.rs`, `gpui/src/main.rs`, existing close/process-exit tests, shell-state privacy tests, and this progress log.
- Verification skipped by explicit user override: `cargo fmt`, targeted tests, full GPUI tests, `cargo check`, `git diff --check`, no-index/whitespace checks or equivalents, `bun run start`, app launch/restart, and browser/visual automation.
- Main-agent review at `2026-06-23-05:50` checked close-confirm one-shot token consumption, exact current slot/runtime-owner matching, pending map pruning after confirmed close and process-exit cleanup, Agents/command/startup isolation, shell-state privacy omissions, absence of a Ghostty close-confirm ABI, and absence of new logs/fallbacks/overlays/hit-test routing/app restart/visual automation. During review I fixed cancel so it also clears the matched surface owner's runtime close-request latch, and expanded the cancel tests to prove a later close request calls Ghostty again. Main-session fmt, targeted tests, full GPUI test/check, and whitespace checks remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. No real GPUI close-confirm prompt was added; confirm actions cannot proceed until GhosttyKit exposes a close-confirm ABI through the GPUI binding; command surfaces still use an empty default launch request; keyboard/mouse event translation, paste/selection/IME behavior, popped-out real reattach, persistent logging audit beyond shell-state JSON, app launch/restart, and visual validation remain deferred.

### 2026-06-23-05:53 Task slice 135

- Added Ghostty input ABI scaffolding in `gpui/src/ghostty_kit.rs` for the existing embedded upstream exports only: key translation mods, key, key-is-binding, text, preedit, mouse captured/button/pos/scroll/pressure, and IME point. I intentionally did not add any invented close-confirm/cancel symbols and did not bind `ghostty_surface_binding_action` in this slice because the required scaffolding can stay primitive-only without action-string diagnostics risk.
- Added minimal Rust FFI aliases/structs for `ghostty_input_key_s`, binding flags, mouse state/button, and scroll mods, plus focused ABI layout/signature test code.
- Extended `GhosttyKitFunctionTable` and Running `GhosttySurfaceOwner` in `gpui/src/terminal_ghostty_surface.rs` with narrow wrappers for key, key-is-binding, text bytes, preedit bytes, mouse state, and IME point. The wrappers accept already-sanitized primitive values or borrowed byte slices, pass pointer/length only for text/preedit, and do not store, log, persist, translate GPUI events, or alter hit testing/layout.
- Updated fake Ghostty tables in `gpui/src/terminal_ghostty_surface.rs` and the startup fake table in `gpui/src/main.rs`. Fake state records only call names, counts, lengths, booleans, flags, and primitive mouse/key/IME values; raw text is not retained.
- Added focused Rust test code only for text/preedit length passing, key translation/key/key-is-binding wrapper calls, mouse captured/button/pos/scroll/pressure/IME point wrapper calls, and shell-state omission of new input ABI helper/type names plus private sample input strings.
- Files touched: `gpui/src/ghostty_kit.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md` and `AGENTS.md`; `git status --short`; `wc -l`; `date '+%Y-%m-%d-%H:%M'`; targeted `rg`, `sed`, and `tail` review of upstream `ghostty/src/apprt/embedded.zig`, the generated GhosttyKit header, GPUI FFI declarations, Ghostty surface owners, fake Ghostty tables, startup fake table, shell-state privacy guards, and this progress log.
- Verification skipped by explicit user override: `cargo fmt`, targeted tests, full GPUI tests, `cargo check`, `git diff --check`, no-index/whitespace checks or equivalents, `bun run start`, app launch/restart, browser/visual automation, and any equivalent formatting/check/test/whitespace command.
- Main-agent review at `2026-06-23-06:22` checked the input ABI typedefs against `ghostty/include/ghostty.h`, generated signature use sites, owner wrapper privacy boundaries, startup fake table isolation, shell-state omissions, and absence of event routing/logging/fallbacks/overlays/hit-test changes. During review I fixed zero-length text/preedit pointer handling: text now uses a stable non-null sentinel because Ghostty slices the pointer unconditionally, while preedit clear sends a null pointer with zero length to match Ghostty's AppKit path. Main-session fmt, targeted tests, full GPUI test/check, and whitespace checks remained skipped per user instruction.
- Remaining gaps: full GPUI event mapping from GPUI key, mouse, text/input, preedit, and IME events into Ghostty input primitives remains deferred. Paste/selection behavior, direct binding-action bridging, command launch payloads, command close-confirm UI, popped-out real reattach, persistent logging audit beyond shell-state JSON, app launch/restart, and visual validation remain deferred. No verification commands were run in this slice, so compile/test risk remains.

### 2026-06-23-06:30 Task slice 136

- Updated the GPUI sidebar active-project CEF payload so explicit project Manage availability derives only from strict boolean `workspace.options.debuggingMode === true` and `workspace.options.settings?.showBetaFeatures === true`.
- Kept Quick/projectless Manage unavailable, kept `projectPath` null at this slice boundary, kept `surfaceIds` empty, and did not add path, name, project, filesystem, or content heuristics to the payload. Slice 138 supersedes the project-path portion by allowing only explicit sidebar `projectContext.path` through as an in-memory-only payload field while keeping Quick and invalid paths null.
- Updated nearby Vitest source tests to cover project-payload Manage false by default, true only when both strict gates are boolean true, false when debugging is disabled or settings/beta flags are missing, and false for string-like truthy gate values.
- Files touched: `gpui/sidebar/phase1-active-project-context.ts`, `gpui/sidebar/phase1-active-project-context.test.ts`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Verification skipped by explicit user instruction: no fmt, tests, check, whitespace checks, app start/restart, or visual automation commands were run.
- Main-agent review at `2026-06-23-06:32` checked the strict Manage gate against the Rust titlebar/settings contract, Quick/projectless behavior, empty `surfaceIds`, the then-current null `projectPath` behavior superseded by slice 138, absence of path/name/filesystem/content heuristics, and malformed string-like truthy test coverage. I also adjusted the missing-settings test fixture so it omits the optional settings field instead of assigning `undefined`. Main-session fmt, targeted tests, full GPUI test/check, whitespace checks, app restart, and visual automation remained skipped per user instruction.

### 2026-06-23-06:36 Task slice 137

- Added a narrow runtime-only GPUI sidebar settings handoff for the active-project bridge. Rust now snapshots only strict booleans `debuggingMode` and `showBetaFeatures` from the shared sidebar settings file used by the titlebar Manage gate, passes them as two boolean CEF install-message arguments for sidebar clients, and exposes them as `window.ghostexGpui.runtimeSettings` alongside `postActiveProjectContext`.
- Kept ordinary Browser CEF tabs out of the sidebar bridge by leaving their sidebar handler and runtime settings unset. No general settings bus, paths, URLs, titles, project-name expansion, logs, persistence, or fallback project detection were added.
- Changed the Phase 1 sidebar sender to retain the latest workspace and recompute the active-project payload at send time with the installed runtime settings snapshot, so startup retries cannot replay a payload that was created before the bridge settings object existed.
- Updated the active-project payload builder and source tests so explicit runtime settings can be provided while preserving workspace-option fallback coverage. Manage is true only when both runtime booleans are strict `true`; missing, malformed, string-like truthy, stale workspace-only, and Quick/projectless cases keep Manage false.
- Files touched: `gpui/src/main.rs`, `gpui/src/cef/macos.rs`, `gpui/src/cef/unsupported.rs`, `gpui/src/bin/ghostex_gpui_cef_helper.rs`, `gpui/sidebar/phase1-main.tsx`, `gpui/sidebar/phase1-active-project-context.ts`, `gpui/sidebar/phase1-active-project-context.test.ts`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual automation commands were run.
- Main-agent review at `2026-06-23-06:44` checked the CEF install-message argument shape against the local cef-rs `ListValue` bool API, sidebar-only client wiring, Browser-surface call sites staying unset, send-time TypeScript payload recomputation, strict runtime-settings precedence over stale workspace settings, Quick/projectless handling, and absence of new logs, persistence, project/path/URL/title heuristics, app restart, or visual automation. Main-session fmt, targeted tests, full GPUI test/check, whitespace checks, app restart, and visual automation remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. The Phase 1 bridge currently snapshots runtime settings at sidebar CEF load time; later work still needs a privacy-safe settings refresh path if GPUI must react to Debugging Mode or Show Beta Features changes without reloading the sidebar. The bridge still carries placeholder-only surface ids and no real Source/Kanban/Manage surface bridge; later phases still need real project/sidebar state beyond this strict runtime settings handoff, real workarea bridges, app launch/visual validation, and broader parity signoff.

### 2026-06-23-06:46 Task slice 138

- Changed the GPUI sidebar active-project payload type so `projectPath` is `string | null` instead of always null.
- Project payloads now pass through only the explicit active group `projectContext.path` from `SidebarStoryWorkspace.groupMetadataById` as an in-memory-only contract value. Missing, non-string, and trim-empty path values produce `projectPath: null` without dropping the project payload, while Quick/projectless payloads still keep `projectPath: null`.
- Preserved the privacy boundary by not deriving the path from titles, fixtures, workspace names, `.git`, URLs, current browser state, filesystem probing, logs, or persistence, and by keeping `surfaceIds: {}` until explicit sidebar surface ids exist.
- Updated source tests to cover explicit path inclusion, unchanged non-empty pass-through, empty/missing/malformed paths becoming null while retaining project workareas, Quick/projectless null path behavior through existing Quick cases, and no invented surface ids.
- Files touched: `gpui/sidebar/phase1-active-project-context.ts`, `gpui/sidebar/phase1-active-project-context.test.ts`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual automation commands were run.
- Main-agent review at `2026-06-23-06:50` checked explicit path pass-through, malformed/missing path nulling without project-payload rejection, Quick/projectless null path behavior, unchanged empty `surfaceIds`, Rust contract compatibility with nullable `projectPath`, and absence of path/title/fixture/filesystem heuristics, logs, persistence, app restart, or visual automation. Main-session fmt, targeted tests, full GPUI test/check, whitespace checks, app restart, and visual automation remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. The Phase 1 bridge still carries placeholder-only surface ids, no privacy-safe settings refresh path after sidebar CEF load, no real Source/Kanban/Manage surface bridge, and no app launch/visual validation.

### 2026-06-23-06:56 Task slice 139

- Tightened GPUI Phase 1 project-change semantics in `gpui/src/main.rs`. The sidebar project snapshot store now returns `Changed` or `Unchanged` for valid payloads, preserves the prior snapshot on malformed payloads, and replaces runtime memory only when the parsed strict contract snapshot differs from the stored one.
- Updated the sidebar receive path so duplicate valid active-project payloads are accepted as bridge heartbeats but do not refresh the titlebar project label, coerce active mode availability, or notify GPUI. First valid payloads and real project/Quick replacements still drive the existing runtime project label and active-mode fallback path.
- Added focused Rust test code for duplicate valid payload no-op behavior, pointer-level evidence that unchanged payloads do not replace the stored snapshot, valid replacement reporting `Changed`, malformed payload preservation, and continued no-snapshot env fallback behavior. Tests were added as source only and were not run.
- Preserved the privacy and layout boundaries: no raw JSON, names, paths, ids, URLs, titles, tokens, cookies, terminal content, command text, stdout/stderr, logs, persistence, path/.git/name/project heuristics, fallback project detection, overlays, hidden hit regions, hit-test routing, synthetic coordinate routing, app restart, or visual automation were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, and this progress log; `git status --short -- gpui docs/gpui-workspace-area-missing-parity-phases.md docs/gpui-workspace-area-parity-requirements.md`; targeted `rg`, `sed`, `tail`, and read-only `git diff -- gpui/src/main.rs` review of the active-project bridge parser/store/receiver, titlebar label tests, availability fallback tests, and progress entries; `date '+%Y-%m-%d-%H:%M'`.
- Worker `019ef265-1050-7c43-b119-fe81f6cf2f44` (`McClintock`, gpt-5.5, xhigh, priority, `fork_context:false`) implemented the narrow `gpui/src/main.rs` slice and was closed after completion.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual automation commands were run.
- Main-agent review at `2026-06-23-06:56` checked the new store result enum, malformed-payload preservation, duplicate-payload no-op path, changed-payload replacement path, receive-handler gating for project label/mode coercion/notify, existing env fallback before first valid snapshot, test source shape, and absence of new logging, persistence, project heuristics, fallbacks, layout/input exceptions, app restart, or visual automation. Main-session fmt, targeted tests, full GPUI test/check, whitespace checks, app restart, and visual automation remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. The Phase 1 bridge still carries placeholder-only surface ids because no explicit sidebar surface identity contract is available, runtime settings are still snapshotted only at sidebar CEF load, real Source/Kanban/Manage surface bridges remain future phases, and app launch/visual validation remains deferred.

### 2026-06-23-08:21 Task slice 140

- Added a narrow sidebar runtime-settings refresh contract for Phase 1. The macOS CEF backend and renderer helper now recognize a second private browser-to-renderer message, `ghostex.gpui.sidebar.runtimeSettingsChanged`, carrying only the existing `debuggingMode` and `showBetaFeatures` booleans.
- The renderer-side bridge now updates only `window.ghostexGpui.runtimeSettings` and invokes the fixed optional `window.ghostexGpui.onRuntimeSettingsChanged(settings)` callback with that same two-boolean object. The initial install path still installs `postActiveProjectContext` plus the initial runtime settings snapshot, and ordinary Browser CEF tabs still do not receive the sidebar bridge.
- The Phase 1 sidebar entrypoint now installs the fixed callback before CEF bridge install, keeps the latest workspace and runtime settings in memory, and reposts the latest active-project payload only when the refreshed booleans differ. This prevents stale Manage availability once a caller refreshes the two settings booleans.
- Added the minimal `CefBrowser` and `CefSurface` forwarding method for runtime-settings refresh, with unsupported-platform stubs. No broad settings watcher, event bus, app restart, Browser-tab bridge, path/project/name inference, or logging/persistence path was added in this slice.
- Files touched: `gpui/src/cef/macos.rs`, `gpui/src/bin/ghostex_gpui_cef_helper.rs`, `gpui/src/cef/unsupported.rs`, `gpui/src/main.rs`, `gpui/sidebar/phase1-main.tsx`, `gpui/sidebar/phase1-active-project-context.ts`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: targeted `rg`, `sed`, and `tail` review of the sidebar runtime-settings TypeScript entrypoint, active-project payload types/comments, macOS CEF install/update message dispatch, renderer helper parity, unsupported CEF stubs, `CefSurface` forwarding, and this progress log; `date '+%Y-%m-%d-%H:%M'`.
- Worker `019ef269-7aba-7901-bb12-df9b67cf7065` (`Sartre`, gpt-5.5, xhigh, priority, `fork_context:false`) implemented the narrow sidebar runtime-settings refresh contract and was closed after completion.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual automation commands were run.
- Main-agent review at `2026-06-23-08:21` checked the private update-message name, two-boolean argument shape, renderer install/update split, fixed callback preservation across initial install, TS repost de-duplication, Browser CEF exclusion through sidebar-handler-gated load handlers, unsupported stubs, and absence of logging, persistence, raw JSON, path/title/project heuristics, broad settings/event bus behavior, app restart, or visual automation. Main-session fmt, targeted tests, full GPUI test/check, whitespace checks, app restart, and visual automation remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. A caller still needs to refresh the sidebar runtime settings when the shared settings file changes; this slice only adds the narrow CEF/JS refresh contract. The Phase 1 bridge still carries placeholder-only surface ids because no explicit sidebar surface identity contract is available, real Source/Kanban/Manage surface bridges remain future phases, and app launch/visual validation remains deferred.

### 2026-06-23-08:27 Task slice 141

- Added the runtime caller for the Phase 1 sidebar settings refresh path in `gpui/src/main.rs`. `GhostexGpuiApp` now stores the last installed/sent `SidebarRuntimeSettingsSnapshot`, seeds it once during app initialization, uses that same snapshot for initial sidebar CEF install, and uses it for runtime titlebar/workarea availability fallback.
- Reused the existing shared-settings polling loop to compare only `debuggingMode` and `showBetaFeatures`. Unchanged snapshots no-op; changed snapshots update the stored runtime state, refresh only the sidebar CEF surface through the slice-140 bridge contract when it exists, re-evaluate Manage titlebar availability, and fall back from unavailable active modes through the existing `coerce_active_mode_to_available_project_context` path.
- Restored shell-state active-mode coercion now receives caller-supplied availability derived from the initial sidebar runtime settings snapshot, so a persisted Manage mode cannot bypass the same strict debugging/beta gate that GPUI installs into the sidebar CEF bridge.
- Added focused source test code for the pure runtime settings refresh decision helper: unchanged snapshots return no update, changed snapshots return the next two-boolean snapshot. Tests were added as source only and were not run.
- Preserved privacy and layout boundaries: the poll reads only the shared sidebar settings object through the existing strict two-boolean parser, does not log or persist raw settings, paths, project names, URLs, titles, command text, stdout/stderr, tokens, cookies, file contents, terminal content, or raw JSON, and does not add project detection, broad settings/event buses, filesystem watchers, Browser CEF refreshes, overlays, hidden hit regions, hit-test routing, synthetic coordinate routing, app restart, or visual automation.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: targeted `rg`, `sed`, `tail`, `git status --short -- ...`, and `date '+%Y-%m-%d-%H:%M'` review of app state initialization, shell-state restore availability, runtime titlebar availability, existing settings polling, sidebar CEF initialization, runtime settings parsing helpers, new refresh decision tests, and this progress log.
- Worker `019ef2b7-208f-7660-96cb-3420bd933ec1` (`Bernoulli`, gpt-5.5, xhigh, priority, `fork_context:false`) implemented the narrow `gpui/src/main.rs` polling caller slice and was closed after completion.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual automation commands were run.
- Main-agent review at `2026-06-23-08:27` checked stored snapshot seeding, initial CEF install using the stored snapshot, runtime availability using the stored snapshot instead of independent settings reads, unchanged-poll no-op behavior, changed-poll sidebar-only refresh, active-mode coercion after settings changes, pure helper tests, and absence of logging, persistence, project heuristics, fallbacks, broad watchers/buses, Browser CEF refreshes, layout/input exceptions, app restart, or visual automation. Main-session fmt, targeted tests, full GPUI test/check, whitespace checks, app restart, and visual automation remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. The Phase 1 bridge still carries placeholder-only surface ids because no explicit sidebar surface identity contract is available, real Source/Kanban/Manage surface bridges remain future phases, and app launch/visual validation remains deferred.

### 2026-06-23-08:29 Task slice 142

- Documented the Phase 1 explicit surface-ID blocker. The sidebar contract does not currently expose first-party Source, Browser, Kanban, or Manage workarea surface IDs, so GPUI cannot populate those identities without new sidebar/native contract data.
- Confirmed the bridge must not map `projectContext.editor.projectId`, group IDs, project paths, titles, fixture names, `.git`, URLs, or filesystem facts into surface IDs because that would be a heuristic/fallback instead of an explicit identity.
- Existing Phase 1 bridge behavior remains correct with `surfaceIds: {}` until the sidebar/native contract exposes explicit identities.
- Files touched: `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks/verification skipped per user instruction: no fmt, tests, cargo check, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, visual/browser automation, or other verification commands were run.
- Remaining work can move to independent Phase 2/terminal-surface slices that do not depend on these surface IDs.

### 2026-06-23-08:36 Task slice 143

- Added the first narrow GPUI-to-Ghostty mouse input forwarding path for mounted Running Agents terminal bodies. The existing body div now forwards left mouse press, left mouse release, and body-level mouse move to the exact current `GhosttySurfaceOwner` for the rendered `AgentsTerminalBodyMountSlotId` when a real surface and recorded body bounds both still match.
- Added body-relative mouse coordinate helpers that use the runtime-only recorded terminal body bounds. Missing bounds, stale slot ids, out-of-bounds positions, non-current mount slots, missing surfaces, and non-macOS builds no-op without changing placeholder activation semantics.
- Added named Ghostty mouse constants for `GHOSTTY_MOUSE_RELEASE`, `GHOSTTY_MOUSE_PRESS`, `GHOSTTY_MOUSE_UNKNOWN`, and `GHOSTTY_MOUSE_LEFT` in the GhosttyKit FFI boundary, and kept this slice on zero modifier bits only.
- Added focused source tests for body-relative coordinate conversion and stale/missing/out-of-bounds no-op decisions. Tests were added as source only and were not run.
- Preserved privacy and layout boundaries: no mouse coordinates, terminal content, command text, stdout/stderr, paths, URLs, titles, tokens, cookies, raw input, or raw JSON are logged or persisted; no overlays, hidden hit regions, root/window hit-test routing, synthetic coordinate routing, native app edits outside `./gpui`, keyboard/text/IME mapping, scroll, pressure, capture policy, paste, selection, or command-pane mouse forwarding were added.
- Files touched: `gpui/src/main.rs`, `gpui/src/ghostty_kit.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: targeted `rg`, `sed`, `tail`, `git status --short -- gpui/src/main.rs gpui/src/ghostty_kit.rs gpui/WORKSPACE_PARITY_PROGRESS.md`, and `date '+%Y-%m-%d-%H:%M'` review of the Ghostty mouse constants, terminal body relative-position helper, mounted-surface forwarding helpers, render-body down/move/up handlers, source tests, and this progress log.
- Worker `019ef2bf-18b1-7f03-8404-2ea51dc389c0` (`Nash`, gpt-5.5, xhigh, priority, `fork_context:false`) implemented the narrow Phase 2 mouse input slice and was closed after completion.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual automation commands were run.
- Main-agent review at `2026-06-23-08:36` checked named Ghostty mouse constants, body-local coordinate conversion, current-slot and recorded-bounds gating, mounted-surface identity checks, existing focus-before-press behavior, placeholder activation preservation, mouse move wiring through the existing body element, source test shape, and absence of logging, persistence, raw input storage, layout/input exceptions, app restart, or visual automation. Main-session fmt, targeted tests, full GPUI test/check, whitespace checks, app restart, and visual automation remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Full terminal input parity still needs keyboard/text/IME mapping, modifier bits, scroll, pressure, mouse capture/release-outside policy, selection/drag semantics, paste, command-pane mouse forwarding, app launch/restart, and visual validation.

### 2026-06-23-09:35 Task slice 144

- Added narrow GPUI-to-Ghostty scroll-wheel forwarding for mounted Running Agents terminal bodies. The existing mounted body div now forwards scroll only for the rendered `AgentsTerminalBodyMountSlotId` when the slot is still current, recorded body bounds contain the event position, and the exact current `GhosttySurfaceOwner` still matches.
- Added a pure scroll-delta conversion helper in `gpui/src/main.rs`: GPUI pixel deltas pass through as raw Ghostty x/y deltas with Ghostty scroll precision bit 0 set, while GPUI line deltas pass through as raw line x/y deltas with zero scroll mods. Keyboard modifier mapping and momentum remain intentionally out of scope for this slice.
- The scroll path updates Ghostty's body-relative pointer position before calling `mouse_scroll`, consumes the GPUI scroll event only after successful forwarding, and leaves placeholders, stale slots, missing bounds, missing surfaces, and non-macOS builds as no-ops.
- Added focused source tests for pixel-delta precision-bit conversion and line-delta zero-mod conversion. Tests were added as source only and were not run.
- Preserved privacy and layout boundaries: no scroll coordinates, raw input, terminal content, command text, stdout/stderr, paths, URLs, titles, tokens, cookies, raw JSON, logs, persistence, overlays, hidden hit regions, root/window hit-test routing, synthetic coordinate routing, app restart, visual automation, keyboard/text/IME mapping, pressure, capture policy, paste, selection, drag-to-select, or command-pane mouse forwarding were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: targeted `rg`, `sed`, `tail`, `git status --short -- gpui/src/main.rs gpui/src/ghostty_kit.rs gpui/src/terminal_ghostty_surface.rs gpui/WORKSPACE_PARITY_PROGRESS.md`, and `date '+%Y-%m-%d-%H:%M'` review of the GPUI `ScrollWheelEvent`/`ScrollDelta` API, Ghostty scroll precision bit, scroll conversion helper, mounted-surface forwarding helper, render-body scroll handler, source tests, and this progress log.
- Worker `019ef2f6-d266-71d0-8ce3-6c00c3fd295d` (`Lovelace`, gpt-5.5, xhigh, priority, `fork_context:false`) implemented the narrow Phase 2 scroll input slice and was closed after completion.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual automation commands were run.
- Main-agent review at `2026-06-23-09:35` checked current-slot and body-boundary gating, exact mounted-surface matching, pointer-position update before scroll, pixel/line delta mod conversion, mounted-body-only hook placement, source test shape, and absence of logging, persistence, raw input storage, layout/input exceptions, app restart, or visual automation. Main-session fmt, targeted tests, full GPUI test/check, whitespace checks, app restart, and visual automation remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Full terminal input parity still needs keyboard/text/IME mapping, modifier bits, scroll momentum mapping, pressure, mouse capture/release-outside policy, selection/drag semantics, paste, command-pane mouse forwarding, app launch/restart, and visual validation.

### 2026-06-23-09:41 Task slice 145

- Added mounted command-pane terminal mouse and scroll forwarding in `gpui/src/main.rs`. Expanded command-pane active command body slots now mirror the Agents terminal input path: left press, left release, pointer movement, and wheel events forward only when the command mount slot is current, recorded command body bounds contain the event position, and the exact current `GhosttySurfaceOwner<CommandTerminalBodyMountSlotId>` still matches.
- Added command terminal focus handoff before press forwarding. Mounted command body clicks now focus the command group, keep shell focus on `CommandPane`, and force the existing command AppKit terminal focus sync path while preserving the prior command-pane placeholder focus, drag/drop, and canvas bounds ownership.
- Genericized the body-relative mouse coordinate helper for Agents and command terminal mount-slot maps, added command-specific wrapper calls, and renamed the shared wheel-delta converter so Agents and command bodies use the same pixel/line-to-Ghostty scroll translation.
- Added focused source tests for command body-relative coordinate conversion and missing/stale/out-of-bounds command no-op behavior. Tests were added as source only and were not run.
- Preserved privacy and layout boundaries: no mouse or scroll coordinates, raw input, terminal content, command text, stdout/stderr, paths, URLs, titles, tokens, cookies, raw JSON, logs, persistence, overlays, hidden hit regions, root/window hit-test routing, synthetic coordinate routing, app restart, visual automation, keyboard/text/IME mapping, pressure, capture policy, paste, or selection/drag-to-select behavior were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: targeted `rg`, `sed`, `tail`, `git status --short -- gpui/src/main.rs gpui/src/ghostty_kit.rs gpui/src/terminal_ghostty_surface.rs gpui/WORKSPACE_PARITY_PROGRESS.md`, and `date '+%Y-%m-%d-%H:%M'` review of command mount-slot state, command focus sync, command body render ownership, command input forwarding helpers, shared scroll conversion, source tests, and this progress log.
- Worker `019ef2fc-2310-7780-9353-50dc9d50c1a8` (`Zeno`, gpt-5.5, xhigh, priority, `fork_context:false`) implemented the larger Phase 2 command-pane input forwarding slice and was closed after completion.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual automation commands were run.
- Main-agent review at `2026-06-23-09:41` checked current-slot and command body-boundary gating, exact command mounted-surface matching, command group focus plus AppKit handoff before press forwarding, pointer-position update before button/scroll, shared pixel/line delta conversion, mounted-command-body-only hook placement, preservation of drag/drop/canvas ownership, source test shape, and absence of logging, persistence, raw input storage, layout/input exceptions, app restart, or visual automation. Main-session fmt, targeted tests, full GPUI test/check, whitespace checks, app restart, and visual automation remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Full terminal input parity still needs keyboard/text/IME mapping, modifier bits, scroll momentum mapping, pressure, mouse capture/release-outside policy, selection/drag semantics, paste, app launch/restart, and visual validation.

### 2026-06-23-09:49 Task slice 146

- Added bounded mouse modifier forwarding for mounted Agents and command terminal bodies in `gpui/src/main.rs`. GPUI mouse-event modifiers now map to Ghostty input modifier bits for pointer position and left button events: shift, control, alt, and platform map to Ghostty shift, ctrl, alt, and super; GPUI function remains intentionally ignored.
- Updated Agents and command terminal mouse position, button, and scroll forwarding helpers to accept GPUI modifiers. Mouse down, mouse up, and mouse move now pass mapped Ghostty modifier bits to `mouse_pos`/`mouse_button`, while scroll still keeps Ghostty `ScrollMods` precision-only and sends keyboard modifiers only through the pointer-position update before `mouse_scroll`.
- Added named local Ghostty mouse modifier constants and focused source tests for zero modifiers, single modifiers, combined modifiers, platform-to-super behavior, and ignored function modifier behavior. Tests were added as source only and were not run.
- Preserved privacy and layout boundaries: no modifier state, mouse or scroll coordinates, raw input, terminal content, command text, stdout/stderr, paths, URLs, titles, tokens, cookies, raw JSON, logs, persistence, overlays, hidden hit regions, root/window hit-test routing, synthetic coordinate routing, app restart, visual automation, keyboard/text/IME mapping, pressure, capture policy, paste, or selection/drag-to-select behavior were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: targeted `rg`, `sed`, `tail`, `git status --short -- gpui/src/main.rs gpui/src/ghostty_kit.rs gpui/src/terminal_ghostty_surface.rs gpui/WORKSPACE_PARITY_PROGRESS.md`, and `date '+%Y-%m-%d-%H:%M'` review of Ghostty `input.Mods` bit layout, GPUI `Modifiers`, terminal modifier constants, mapper helper, Agents and command forwarding call sites, scroll modifier separation, source tests, and this progress log.
- Worker `019ef302-c9d9-7d11-8074-9ddef307eabc` (`Gibbs`, gpt-5.5, xhigh, priority, `fork_context:false`) implemented the bounded Phase 2 mouse modifier forwarding slice and was closed after completion.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual automation commands were run.
- Main-agent review at `2026-06-23-09:49` checked modifier bit constants against Ghostty's shift/ctrl/alt/super bit order, GPUI `platform` to Ghostty `super` mapping, ignored `function`, all Agents and command mouse call sites passing `event.modifiers`, scroll retaining precision-only `ScrollMods`, source test shape, and absence of new logging, persistence, raw input storage, layout/input exceptions, app restart, or visual automation. Main-session fmt, targeted tests, full GPUI test/check, whitespace checks, app restart, and visual automation remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Full terminal input parity still needs keyboard/text/IME mapping, scroll momentum mapping, pressure, mouse capture/release-outside policy, selection/drag semantics, paste, app launch/restart, and visual validation.

### 2026-06-23-09:54 Task slice 147

- Added bounded pressure/force-click forwarding for mounted Agents and command terminal bodies in `gpui/src/main.rs`. GPUI `PressureStage::Zero`, `Normal`, and `Force` now map directly to Ghostty pressure stages none, normal, and deep.
- Added Agents and command pressure forwarding helpers that use the same current-slot, recorded body-bounds, exact-surface, and macOS/no-op gates as the existing pointer and scroll forwarding paths. Each pressure event updates Ghostty body-relative pointer position with mapped mouse modifiers before passing the raw GPUI pressure value through to `mouse_pressure`.
- Wired `.on_mouse_pressure` only inside the existing mounted-slot body branches for Agents and command terminal bodies. The handler does not default-stop the event, so placeholder activation, command focus, drag/drop ownership, and the existing normal body layout remain unchanged.
- Added focused source tests for the pure pressure-stage mapping helper. Tests were added as source only and were not run.
- Preserved privacy and layout boundaries: no pressure value, modifier state, mouse or scroll coordinates, raw input, terminal content, command text, stdout/stderr, paths, URLs, titles, tokens, cookies, raw JSON, logs, persistence, overlays, hidden hit regions, root/window hit-test routing, synthetic coordinate routing, app restart, visual automation, keyboard/text/IME mapping, capture policy, paste, or selection/drag-to-select behavior were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: targeted `rg`, `sed`, `tail`, `git status --short -- gpui/src/main.rs gpui/src/ghostty_kit.rs gpui/src/terminal_ghostty_surface.rs gpui/WORKSPACE_PARITY_PROGRESS.md`, and `date '+%Y-%m-%d-%H:%M'` review of GPUI `MousePressureEvent`/`PressureStage`, Ghostty pressure stage ABI, pressure constants, stage mapper, Agents and command pressure forwarding helpers, mounted body hook placement, source tests, and this progress log.
- Worker `019ef307-bee0-7633-be7a-e8c4725d36f3` (`Lorentz`, gpt-5.5, xhigh, priority, `fork_context:false`) implemented the bounded Phase 2 pressure forwarding slice and was closed after completion.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual automation commands were run.
- Main-agent review at `2026-06-23-09:54` checked direct GPUI-to-Ghostty pressure stage mapping, raw pressure pass-through without clamping/fallback behavior, current-slot and body-boundary gating, exact Agents and command mounted-surface matching, pointer-position update before pressure, mounted-body-only hook placement, source test shape, and absence of new logging, persistence, raw input storage, layout/input exceptions, app restart, or visual automation. Main-session fmt, targeted tests, full GPUI test/check, whitespace checks, app restart, and visual automation remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Full terminal input parity still needs keyboard/text/IME mapping, scroll momentum mapping, mouse capture/release-outside policy, selection/drag semantics, paste, app launch/restart, and visual validation.

### 2026-06-23-10:03 Task slice 148

- Added bounded Cmd+V paste routing for focused mounted terminal surfaces in `gpui/src/main.rs`. The new `PasteIntoFocusedTerminal` action reads the platform clipboard only at the action boundary, extracts only explicit string clipboard entries, and forwards bytes only to the exact focused mounted Agents or command Ghostty surface.
- Added strict surface-owner checks before paste delivery. Agents paste requires the focused current Agents mount slot plus the matching runtime session id from the Agents runtime registry; command paste requires the focused current command mount slot plus its transient command runtime identity. Stale, missing, inactive, non-mounted, non-macOS, Browser, Source, Kanban, Manage, companion, and placeholder focus paths no-op.
- Avoided GPUI `ClipboardItem::text()` in terminal paste because it can synthesize local file paths from external-path clipboard entries. Image-only, path-only, metadata-only, and empty clipboard data no-op without logging, persistence, fallback text, or conversion to terminal input.
- Added focused source-only helper tests for concatenating explicit string clipboard entries while ignoring external paths, and for rejecting empty/path-only clipboard data even though GPUI's convenience `text()` would produce path text for the path-only case. Tests were added as source only and were not run.
- Documented the scroll momentum decision from the input review: Ghostty has explicit momentum phases, but GPUI `TouchPhase` exposes only `Started`, `Moved`, and `Ended`, so no lossy momentum mapping was added in this slice.
- Preserved privacy and layout boundaries: no clipboard text, file paths, mouse/scroll/pressure values, raw input, terminal content, command text, stdout/stderr, URLs, titles, tokens, cookies, raw JSON, logs, persistence, overlays, hidden hit regions, root/window hit-test routing, synthetic coordinate routing, app restart, visual automation, keyboard/text/IME mapping beyond paste, capture policy, or selection/drag-to-select behavior were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`; targeted `rg`, `sed`, and `date '+%Y-%m-%d-%H:%M'` review of GPUI clipboard APIs, key binding/action dispatch examples, focused terminal surface helpers, Ghostty text forwarding, render comments, source-only paste helper tests, and this progress log.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual automation commands were run.
- Main-agent review at `2026-06-23-10:03` checked explicit-string-only clipboard extraction, external-path rejection, global Cmd+V action no-op gating through shell focus, exact Agents/command runtime owner matching before `send_text_bytes`, source test shape, updated CDXC comments, the no-lossy-scroll-momentum decision, and absence of new logging, persistence, raw input storage, layout/input exceptions, app restart, or visual automation. Main-session fmt, targeted tests, full GPUI test/check, whitespace checks, app restart, and visual automation remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Full terminal input parity still needs keyboard/text/IME mapping beyond paste, scroll momentum support only if GPUI exposes real momentum phases, mouse capture/release-outside policy, selection/drag semantics, app launch/restart, and visual validation.

### 2026-06-23-10:09 Task slice 149

- Added capture-gated mouse release-outside forwarding for mounted Agents and command terminal bodies in `gpui/src/main.rs`. The existing GPUI body elements now use `on_mouse_up_out(MouseButton::Left, ...)` only inside mounted-slot branches, preserving normal element ownership without overlays, hidden hit regions, root/window pre-dispatch routing, or synthetic coordinate routing.
- Added Agents and command helpers that require the slot is still current, require the Ghostty owner runtime identity still matches, and require `surface.mouse_captured()` before sending a left release with mapped GPUI modifiers. The release-outside path intentionally does not update `mouse_pos`, clamp outside coordinates, store last coordinates, or persist/log raw input.
- Kept in-body press/release/move/scroll/pressure behavior unchanged. The new path is only capture recovery for a mouse released outside a mounted terminal body after Ghostty has captured mouse input.
- No source tests were added in this slice because the behavior depends on real `GhosttySurfaceOwner::mouse_captured()` state and element-level `on_mouse_up_out` dispatch; existing pure coordinate/modifier tests remain source-only and unrun.
- Preserved privacy and layout boundaries: no mouse positions, modifiers, clipboard text, terminal content, command text, stdout/stderr, paths, URLs, titles, tokens, cookies, raw JSON, logs, persistence, overlays, hidden hit regions, root/window hit-test routing, synthetic coordinate routing, app restart, visual automation, keyboard/text/IME mapping, or selection/drag-to-select behavior were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `docs/gpui-workspace-area-parity-requirements.md`, and this progress log; targeted `rg`, `sed`, `git status --short -- ...`, and `date '+%Y-%m-%d-%H:%M'` review of GPUI `on_mouse_up_out`, `MouseUpEvent`, Ghostty `mouse_captured`/`mouse_button` wrappers, mounted Agents and command forwarding helpers, render hook placement, and this progress entry.
- Worker `019ef315-0954-7d20-aa9d-dc780d5197f4` (`Hypatia`, gpt-5.5, xhigh, priority, `fork_context:false`) implemented the narrow release-outside slice and was closed after completion.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual automation commands were run.
- Main-agent review at `2026-06-23-10:09` checked element-level `on_mouse_up_out` scope, capture-gated release behavior, no outside coordinate synthesis, exact Agents/command runtime owner matching, modifier mapping, unchanged in-body handlers, CDXC comments, and absence of new logging, persistence, raw input storage, layout/input exceptions, app restart, or visual automation. Main-session fmt, targeted tests, full GPUI test/check, whitespace checks, app restart, and visual automation remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Full terminal input parity still needs keyboard/text/IME mapping beyond paste, selection/drag semantics, app launch/restart, and visual validation.

### 2026-06-23-10:18 Task slice 150

- Added committed-character keyboard text forwarding for focused mounted Agents and command Ghostty terminal surfaces in `gpui/src/main.rs`. Root GPUI key-down handling now reads only `KeyDownEvent.keystroke.key_char`, forwards non-empty committed text only after exact focused terminal target and mounted-surface owner checks pass, and consumes the GPUI event only after Ghostty accepts the text bytes.
- Added an explicit terminal text target gate before surface delivery. Agents text requires Agents mode plus an Agents-pane shell focus target; command text requires command-pane focus; Browser, Source, Kanban, Manage, project-editor surface, companion, placeholder, stale, missing-surface, and non-macOS paths no-op without falling through to terminal helpers.
- Kept physical key and IME/preedit bridging deferred. GPUI `Keystroke` exposes committed `key_char` but not the native physical keycode Ghostty needs for honest `ghostty_input_key_s` translation, and this slice did not add GPUI `InputHandler`/preedit ownership.
- Added source-only helper tests for committed text extraction, Option-generated committed characters, rejection of missing/empty/Cmd/Super/Control cases, no fallback from physical `key`, and terminal-focus-only target selection. Tests were added as source only and were not run.
- Preserved privacy and layout boundaries: no typed text, key names, modifier state, clipboard text, terminal content, command text, stdout/stderr, paths, URLs, titles, tokens, cookies, raw JSON, logs, persistence, overlays, hidden hit regions, root/window hit-test routing, synthetic coordinate routing, app restart, visual automation, physical key mapping, IME/preedit handling, or selection/drag-to-select behavior were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`, this progress log, and targeted `rg`, `sed`, `git status --short -- gpui/src/main.rs gpui/WORKSPACE_PARITY_PROGRESS.md`, and `date '+%Y-%m-%d-%H:%M'` review of GPUI `KeyDownEvent`/`Keystroke`, committed-text helpers, focused terminal text delivery, root key-down hook placement, source-only helper tests, and this progress entry.
- Worker `019ef31c-8013-7bb3-be60-fb365756d869` (`Kierkegaard`, gpt-5.5, xhigh, priority, `fork_context:false`) implemented the committed-text forwarding slice and was closed after completion.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual automation commands were run.
- Main-agent review at `2026-06-23-10:18` checked committed-text-only extraction, Cmd/Super and Control rejection, Option-generated text preservation, no physical-key fallback, exact Agents/command focused-surface routing, explicit no-op target gate for Browser/project-editor focus, source test shape, updated CDXC comments, and absence of new logging, persistence, raw input storage, layout/input exceptions, app restart, or visual automation. Main-session fmt, targeted tests, full GPUI test/check, whitespace checks, app restart, and visual automation remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Full terminal input parity still needs honest physical key/binding forwarding if GPUI exposes native keycodes, IME/preedit ownership, selection/drag semantics beyond basic mouse events, app launch/restart, and visual validation.

### 2026-06-23-10:30 Task slice 151

- Added right and middle mouse button parity for mounted Agents and command Ghostty terminal bodies in `gpui/src/main.rs` and `gpui/src/ghostty_kit.rs`. The GPUI FFI constants now name Ghostty's upstream mouse button values for right and middle, and a pure mapper accepts only GPUI left/right/middle while rejecting navigation buttons.
- Generalized mounted terminal button forwarding so in-body press and release send the mapped Ghostty button instead of always sending left. Agents and command paths still require current mount slots, recorded body bounds, matching mounted-surface owner identity, matching runtime identity, and macOS support before updating pointer position and sending the button event.
- Generalized capture recovery for mouse-up-out. Mounted Agents and command bodies now send capture-gated left/right/middle releases without updating `mouse_pos`, clamping outside coordinates, storing last coordinates, or adding any window/root input routing.
- Wired mounted Agents and command body elements for right and middle down/up/up-out alongside the existing left handlers. Right and middle down focus the exact mounted terminal before forwarding; placeholders keep the existing left-click-only activation/focus behavior, and tab/chrome right-click context menus were not changed.
- Added source-only helper tests for left/right/middle button mapping and GPUI navigation back/forward rejection. Tests were added as source only and were not run.
- Preserved privacy and layout boundaries: no mouse positions, button state, modifiers, terminal content, command text, stdout/stderr, paths, URLs, titles, tokens, cookies, raw JSON, logs, persistence, overlays, hidden hit regions, root/window hit-test routing, synthetic coordinate routing, app restart, visual automation, keyboard/IME/preedit work, or selection/drag-to-select semantics were added.
- Files touched: `gpui/src/main.rs`, `gpui/src/ghostty_kit.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: targeted `rg`, `sed`, and `date '+%Y-%m-%d-%H:%M'` review of Ghostty upstream mouse button values, GPUI `MouseButton` variants, FFI constants, button mapper, Agents and command forwarding helpers, mounted body hook placement, source-only helper tests, touched-file status, and this progress entry.
- Worker `019ef326-15c6-7830-a5ed-842ae5338e5f` (`Godel`, gpt-5.5, xhigh, priority, `fork_context:false`) implemented the right/middle mouse-button slice and was closed after completion.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual automation commands were run.
- Main-agent review at `2026-06-23-10:30` checked upstream Ghostty enum values, GPUI left/right/middle/navigation mapping, exact Agents/command runtime owner matching, mounted-only right/middle hook placement, no placeholder right/middle activation behavior, no tab/chrome context-menu changes, capture-gated outside releases, source test shape, updated CDXC comments, and absence of new logging, persistence, raw input storage, layout/input exceptions, app restart, or visual automation. Main-session fmt, targeted tests, full GPUI test/check, whitespace checks, app restart, and visual automation remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Full terminal input parity still needs honest physical key/binding forwarding if GPUI exposes native keycodes, IME/preedit ownership, terminal selection/drag semantics beyond forwarding raw mouse button/move/pressure/scroll events, app launch/restart, and visual validation.

### 2026-06-23-10:36 Task slice 152

- Hardened the GPUI Ghostty runtime clipboard callback boundary in `gpui/src/ghostty_kit.rs` and `gpui/src/terminal_ghostty_surface.rs`. The FFI layer now names Ghostty's standard/selection clipboard discriminants plus paste, OSC 52 read, and OSC 52 write request discriminants from the embedded header.
- Kept runtime clipboard callbacks explicitly disabled/no-op until GPUI has a real app-thread clipboard bridge. The runtime config still installs the read/confirm/write callback pointers expected by Ghostty, but `supports_selection_clipboard` remains false, reads return false, and confirm/write callbacks ignore pointer payloads.
- Documented the blocker in CDXC comments: the embedded runtime callback userdata cannot safely access GPUI `App` clipboard APIs today, so this path must not synthesize clipboard access, retain raw clipboard bytes, or log/persist clipboard data.
- Added source-only tests for runtime config callback installation, disabled selection clipboard support, standard/selection read no-ops with null state, confirm/write no-ops with representative pointer payloads, fake-state non-mutation, and clipboard ABI constant values. Tests were added as source only and were not run.
- Preserved privacy and layout boundaries: no clipboard content, paths, terminal content, command text, stdout/stderr, URLs, titles, tokens, cookies, raw JSON, logs, persistence, overlays, hidden hit regions, root/window hit-test routing, synthetic coordinate routing, app restart, visual automation, keyboard/IME/preedit work, or fallback clipboard behavior were added.
- Files touched: `gpui/src/ghostty_kit.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`, Phase 2 docs, GPUI `InputHandler` references for the deferred IME path, Ghostty embedded clipboard callback expectations, and this progress log; targeted `rg`, `sed`, `git status --short -- ...`, and `date '+%Y-%m-%d-%H:%M'` review of clipboard ABI constants, runtime config, no-op callbacks, source-only tests, and this progress entry.
- Worker `019ef32f-43ad-7202-acd6-150a237cec8c` (`Heisenberg`, gpt-5.5, xhigh, priority, `fork_context:false`) implemented the clipboard callback boundary slice and was closed after completion.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual automation commands were run.
- Main-agent review at `2026-06-23-10:36` checked the named ABI values against `ghostty/include/ghostty.h`, disabled selection clipboard support, callback pointer installation without functional clipboard access, no-op read/confirm/write behavior, local-only representative clipboard test strings, fake-state non-mutation, CDXC comments, and absence of new logging, persistence, raw input storage, layout/input exceptions, app restart, or visual automation. Main-session fmt, targeted tests, full GPUI test/check, whitespace checks, app restart, and visual automation remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Real Ghostty runtime clipboard reads/writes still need an explicit GPUI app-thread clipboard bridge before they can be enabled; full terminal input parity still needs honest physical key/binding forwarding if GPUI exposes native keycodes, IME/preedit ownership through a focused GPUI input handler, terminal selection/drag semantics beyond forwarding raw mouse events, app launch/restart, and visual validation.

### 2026-06-23-10:52 Task slice 153

- Added bounded GPUI terminal IME/preedit text-service ownership in `gpui/src/main.rs`. The app now owns one terminal text `FocusHandle`, focused only through the existing mounted Agents and command terminal body focus paths, and stores only the focused runtime mount identity plus sanitized UTF-16 marked ranges.
- Registered GPUI `ElementInputHandler` from the existing mounted terminal body canvas paint callbacks for exact focused Agents and command mount slots. The registration uses the same body bounds already used for native surface geometry and does not add overlays, hidden hit regions, root/window hit-test routing, synthetic coordinate routing, or separate interactive ownership.
- Implemented `EntityInputHandler` for terminal text services. Committed IME text clears Ghostty preedit before forwarding final text bytes; preedit updates call `set_preedit_bytes` on the exact focused mounted Ghostty surface; unmark clears preedit; selected text reports a collapsed range; terminal document text and character-index queries return `None` so terminal content is not exposed.
- Added IME candidate bounds from exact focused Ghostty `ime_point` plus the mounted body bounds, rejecting invalid/non-finite points and avoiding title/path/content/cursor fallbacks.
- Added focused source-only helper tests for sanitized UTF-16 preedit ranges and body-relative IME candidate bounds. Tests were added as source only and were not run.
- Preserved privacy and layout boundaries: no raw typed text, preedit text, terminal content, command text, stdout/stderr, paths, URLs, titles, tokens, cookies, raw JSON, logs, persistence, overlays, hidden hit regions, root/window hit-test routing, synthetic coordinate routing, app restart, visual automation, or physical-key fallback behavior were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`, this progress log, GPUI `EntityInputHandler`/`ElementInputHandler`/`Window::handle_input` references, Zed terminal text-service precedent, and targeted `rg`, `sed`, `nl`, `git status --short -- ...`, `git diff -- ...`, `git diff --stat -- ...`, and `date '+%Y-%m-%d-%H:%M'` review of terminal focus handles, mounted body paint callbacks, preedit helpers, IME bounds helpers, source-only tests, and this progress entry.
- Worker `019ef336-34fe-7e01-95d9-aef55ef5a3c4` (`Avicenna`, gpt-5.5, xhigh, priority, `fork_context:false`) implemented the bounded IME/preedit slice and was closed after completion. Main agent adjusted commit ordering so final IME text clears preedit before sending committed text, then added pure helper tests.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual automation commands were run.
- Main-agent review at `2026-06-23-10:52` checked paint-phase `ElementInputHandler` registration through existing mounted body canvas callbacks, one shared terminal text focus handle, exact Agents/command mounted-surface gating, no raw text/preedit storage, preedit clear-before-commit ordering, collapsed selection/no document-text behavior, Ghostty `ime_point` bounds derivation, source test shape, CDXC comments, and absence of new logging, persistence, raw input storage, layout/input exceptions, app restart, or visual automation. Main-session fmt, targeted tests, full GPUI test/check, whitespace checks, app restart, and visual automation remained skipped per user instruction.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Full terminal input parity still needs honest physical key/binding forwarding if GPUI exposes native keycodes, terminal selection/drag semantics beyond forwarding raw mouse events, app launch/restart, and visual validation. Real Ghostty runtime clipboard reads/writes still need an explicit GPUI app-thread clipboard bridge before they can be enabled.

### 2026-06-23-11:04 Task slice 154

- Replaced the GPUI Browser feedback placeholder notification with a real selected-tool injection path. The toolbar still routes through the existing Browser right-action wake/focus guard, keeps `github.com` and `*.github.com` disabled before any injection attempt, and targets only the active tab-owned CEF surface.
- Added app-owned main-frame JavaScript execution to the GPUI CEF backend with a synthetic script URL and no page-data logging. The `CefSurface` wrapper forwards the injection script through this path and treats failure only as "no main frame/current surface available", not as page-side completion status.
- Added bounded Agentation and React Grab injection scripts in `gpui/src/main.rs`. Agentation uses pinned module URLs and auto-starts feedback mode without console/page diagnostics; React Grab uses the pinned native version URL with an SRI hash before activating feedback mode.
- Added source-only helper assertions for feedback boundaries: GitHub host disablement, non-GitHub eligibility, pinned Agentation module URLs, React Grab SRI use, and absence of console/location/title diagnostics in the generated scripts.
- During main-agent review, added matching no-op unsupported-backend `CefBrowser` methods so the platform stub keeps the same public API surface without changing non-macOS behavior.
- Preserved privacy and layout boundaries: no page URLs, browser titles, script bodies, JS errors, user content, cookies, tokens, paths, command text, terminal content, persistent logs, overlays, hidden hit regions, root/window hit-test routing, synthetic coordinate routing, app restart, or visual automation were added.
- Files touched: `gpui/src/main.rs`, `gpui/src/cef/macos.rs`, `gpui/src/cef/unsupported.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`, Phase 8 docs, native Browser feedback source-of-truth, GPUI CEF wrapper snippets, feedback toolbar/render snippets, generated injection helpers, unsupported CEF backend stubs, touched-file status, and this progress log using targeted `rg`, `sed`, `git diff`, `git status --short`, and `tail`.
- Worker `019ef34a-1d1f-7983-896f-e978b89116ec` (`Einstein`, gpt-5.5, xhigh, priority, `fork_context:false`) implemented the bounded Browser feedback-injection slice and was closed after completion. Main agent added unsupported-backend API stubs during review.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual/browser automation commands were run.
- Main-agent review checked toolbar action gating, GitHub disablement before injection, Settings-selected Agentation/React Grab script selection, active CEF surface ownership, CEF main-frame execution with no logging, React Grab SRI boundary, Agentation pinned module URLs, source-only helper assertions, unsupported-backend API parity, updated CDXC comments, and absence of new persistent logs, fallbacks, layout/input exceptions, app restart, or visual automation.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Browser profile creation/import persistence, Browser import flows, deeper Browser runtime sleep/suspend/teardown policy, script-created blank popup content transfer, app launch/restart, and visual validation remain deferred. Terminal physical key forwarding, terminal selection/drag semantics, and runtime clipboard bridging remain deferred as documented in prior slices.

### 2026-06-23-11:28 Task slice 155

- Added a shell-owned GPUI Browser profile model in `gpui/src/main.rs`. The model keeps a built-in Default profile plus generated `Profile N` ids, persists only generated numeric ids, active profile id, and next id, and avoids user-entered profile names, profile paths, imported browser data, cookies, credentials, history, page titles, URLs, command text, or local paths.
- Replaced the beta-only Browser profile placeholder actions with a real OS-owned NativeMenu. The menu lists checked generated profiles, then the disabled `Beta Features:` section label, `New Profile...`, and `Import Browser Data...`; the handler boundary repeats the beta/Browser availability gate so hidden Profile UI cannot be bypassed by stale or direct action dispatch.
- Wired `New Profile...` to create and select an app-generated profile, persist sanitized shell state, and show a bounded notification. Kept `Import Browser Data...` explicit but unsupported in GPUI: it reports that no cookies, credentials, or history were imported and does not read browser stores, touch CEF profile data, or persist shell state.
- Added per-tab Browser profile ownership for runtime CEF creation. New address-only tabs, pane splits, and popup tabs inherit the currently selected profile; existing loaded tab-owned CEF surfaces keep the profile they were created with; restored tabs receive the active generated profile without adding per-tab profile names or profile directories to shell state.
- Updated the macOS GPUI CEF backend in `gpui/src/cef/macos.rs` to honor generated profile strings. It now creates/caches per-profile CEF request contexts from sanitized slug-like profile segments under the existing GPUI CEF root cache, persists session cookies, and passes the request context into `browser_host_create_browser_sync` without logging profile names or filesystem paths.
- Preserved privacy and layout boundaries: no raw profile names, user-entered browser data, cookies, credentials, history imports, page titles, raw URLs, query strings, fragments, local paths, command text, terminal content, persistent logs, GPUI overlays, hidden hit regions, root/window hit-test routing, synthetic coordinate routing, app restart, or visual automation were added.
- Files touched: `gpui/src/main.rs`, `gpui/src/cef/macos.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`, Phase 8 docs, native Browser profile reference code, GPUI Browser profile/menu/tab/shell-state/CEF snippets, cef-rs request-context bindings, NativeMenu usage, touched-file status, and targeted diffs using `rg`, `sed`, `git diff`, `git status --short`, and `tail`.
- Worker `019ef354-aac3-7221-9076-32eaafea731a` (`Wegener`, gpt-5.5, xhigh, priority, `fork_context:false`) implemented the larger Browser profile slice and was closed after completion. Main agent added the beta/Browser handler guard during review.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual/browser automation commands were run.
- Main-agent review checked generated-only profile persistence, checked NativeMenu profile rows, New Profile behavior, unsupported import boundaries, active-profile inheritance for new tabs/popups/splits, restored-tab profile assignment, tab-owned CEF surface profile retention, sanitized CEF profile cache segments, request-context creation, CDXC comments, and absence of new persistent logs, fallbacks, layout/input exceptions, app restart, or visual automation.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. A real GPUI Browser data import flow remains deferred until there is an explicit compatible importer requirement; deeper Browser runtime sleep/suspend/teardown policy, script-created blank popup content transfer, app launch/restart, and visual validation remain deferred. Terminal physical key forwarding, terminal selection/drag semantics, and runtime clipboard bridging remain deferred as documented in prior slices.

### 2026-06-23-11:40 Task slice 156

- Centralized GPUI Browser runtime visibility policy in `gpui/src/main.rs`. `BrowserRuntimeLifecycleInput` now names the Browser-mode, wake/sleep, Browser-tab-drag, and command-tab-drag gates, and `BrowserRuntimeSurfacePolicy` distinguishes visible existing surfaces, hidden-held surfaces, and restored loaded placeholders that must not be materialized by visibility sync.
- Routed Browser surface creation and visibility sync through the policy helper. New CEF surfaces still come only from the selected loaded tab path, while the visibility loop toggles existing tab-owned CEF entities by rendered active loaded tab ids and never creates restored loaded tab surfaces or tears down hidden ones.
- Added CEF blur-on-hide in `gpui/src/cef/macos.rs`, with the unsupported backend exposing the same no-op API in `gpui/src/cef/unsupported.rs`. Hiding a Browser CEF child view for sleep, mode switch, Browser tab drag, or command-tab drag now releases Chromium focus and clears matching active native-view bookkeeping without destroying the CEF browser or adding hit-test/layout exceptions.
- Added source-only helper tests covering hide-and-hold lifecycle gates, rendered loaded existing-surface visibility across Browser splits, and restored loaded tabs remaining placeholders when they have no existing CEF surface. Tests were added as source only and were not run.
- Preserved privacy and layout boundaries: no browser data import, cookies, credentials, history, page titles, raw URLs, query strings, fragments, local paths, command text, terminal content, persistent logs, GPUI overlays, hidden hit regions, root/window hit-test routing, synthetic coordinate routing, app restart, or visual automation were added.
- Files touched: `gpui/src/main.rs`, `gpui/src/cef/macos.rs`, `gpui/src/cef/unsupported.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`, Phase 8 docs, this progress log, GPUI Browser lifecycle helpers, surface creation and visibility sync call sites, CEF native-view focus bookkeeping, unsupported backend stubs, source-only helper tests, touched-file status, and this progress entry using targeted `rg`, `sed`, `git status --short`, `tail`, and `date '+%Y-%m-%d-%H:%M'`.
- Worker `019ef364-fc8b-7282-82a3-ad943a37a7cd` (`Halley`, gpt-5.5, xhigh, priority, `fork_context:false`) implemented the Browser runtime lifecycle policy slice and was closed after completion.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual/browser automation commands were run.
- Main-agent review checked centralized lifecycle gates, existing-surface-only visibility, restored loaded placeholder behavior, selected-tab-only CEF materialization, CEF blur-on-hide active-view cleanup, unsupported-backend API parity, source-only helper assertions, updated CDXC comments, and absence of new persistent logs, fallbacks, layout/input exceptions, app restart, or visual automation.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. A real GPUI Browser data import flow remains deferred until there is an explicit compatible importer requirement; script-created blank popup content transfer, app launch/restart, and visual validation remain deferred. Terminal physical key forwarding, terminal selection/drag semantics, and runtime clipboard bridging remain deferred as documented in prior slices.

### 2026-06-23-11:47 Task slice 157

- Aligned GPUI Browser popup/content-transfer policy with native macOS CEF behavior. Empty or whitespace-only CEF popup targets are now handled as shell-boundary no-ops instead of creating address-only Browser tabs or attempting any fallback content transfer.
- Kept non-empty popup target URLs on the existing Browser tab path. They still create a selected loaded Browser tab, inherit the active generated Browser profile, wake Browser mode, focus the Browser surface, sync the active tab-owned CEF surface, scroll the focused Browser pane tab strip, and persist sanitized Browser shell state.
- Added a CEF callback guard in `gpui/src/cef/macos.rs` so empty target URLs return handled without dispatching the shell popup callback. The app model boundary in `gpui/src/main.rs` also rejects empty targets before tab allocation, active selection changes, Browser wake/focus, CEF surface creation, persistence, notification, import, or transfer side effects.
- Added source-only model tests covering empty popup no-op behavior without BrowserTabModel mutation and non-empty popup target creation as a loaded tab. Tests were added as source only and were not run.
- Preserved privacy and layout boundaries: no popup URL logging, page titles, page content, script bodies, cookies, credentials, history import, local paths, command text, terminal content, tokens, raw JSON, GPUI overlays, hidden hit regions, root/window hit-test routing, synthetic coordinate routing, app restart, or visual automation were added.
- Files touched: `gpui/src/main.rs`, `gpui/src/cef/macos.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`, Phase 8 docs, native macOS CEF popup policy snippets, GPUI popup model/callback code, source-only helper tests, touched-file status, and this progress entry using targeted `rg`, `sed`, `git status --short`, and `date '+%Y-%m-%d-%H:%M'`.
- Worker `019ef36e-99e8-7d30-b76e-05ee6d2655f2` (`Cicero`, gpt-5.5, xhigh, priority, `fork_context:false`) implemented the Browser popup/content-transfer slice and was closed after completion.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual/browser automation commands were run.
- Main-agent review checked empty-target no-op behavior at both CEF and shell-model boundaries, non-empty target tab creation, active generated profile inheritance, no address-only popup tab creation, no fallback content-transfer/import path, source-only helper assertions, updated CDXC comments, and absence of new persistent logs, fallbacks, layout/input exceptions, app restart, or visual automation.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. A real GPUI Browser data import flow remains deferred until there is an explicit compatible importer requirement; app launch/restart and visual validation remain deferred by user instruction. Terminal physical key forwarding, terminal selection/drag semantics, and runtime clipboard bridging remain deferred as documented in prior slices.

### 2026-06-23-11:53 Task slice 158

- Rechecked Ghostty physical/binding key forwarding for focused mounted Agents and command terminal surfaces and left runtime behavior unchanged because the current local GPUI app event API does not expose a stable physical key identity to app listeners.
- Documented the blocker in `gpui/src/main.rs`: `KeyDownEvent` exposes only `keystroke`, `is_held`, and `prefer_character_input`, while `Keystroke` exposes modifiers, layout-derived `key`, and committed `key_char`. GPUI's macOS backend uses `NSEvent.keyCode()` internally while constructing the keystroke, but drops that native keycode before app-level listeners run.
- Preserved the existing committed-text path instead of inventing a fake physical-key bridge from layout/display strings. Root key-down forwarding remains terminal-focus-only, exact mounted-surface-only, committed-character-only, and still no-ops for Browser/CEF/project-editor focus, placeholders, stale surfaces, missing surfaces, non-macOS builds, and physical-only key events.
- Preserved privacy and layout boundaries: no raw key text beyond the existing ephemeral committed-text path, command text, terminal content, stdout/stderr, paths, URLs, titles, tokens, clipboard content, raw JSON, persistent logs, GPUI overlays, hidden hit regions, root/window hit-test routing, synthetic coordinate routing, app restart, or visual automation were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`, GPUI terminal key/input comments, root key-down handler, Ghostty input ABI snippets, native macOS terminal key handling references, touched-file status, and this progress entry using targeted `rg`, `sed`, `git status --short`, and `date '+%Y-%m-%d-%H:%M'`.
- Worker `019ef375-9fe6-71a1-8a4d-f952c906cab0` (`Banach`, gpt-5.5, xhigh, priority, `fork_context:false`) investigated the physical/binding key slice, found the API blocker, updated the source comment, and was closed after completion.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual/browser automation commands were run.
- Main-agent review checked that no physical key mapping or behavior change was introduced from layout-derived `Keystroke.key`, the blocker comment states the local API shape, existing committed-text forwarding remains unchanged, and no new persistent logs, fallbacks, layout/input exceptions, app restart, or visual automation were added.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Honest Ghostty physical/binding key forwarding requires GPUI to expose a native keycode or UIEvents-code physical key identity to app code. Runtime clipboard bridging still needs an explicit GPUI app-thread clipboard bridge before it can be enabled. Browser data import remains deferred until there is an explicit compatible importer requirement; app launch/restart and visual validation remain deferred by user instruction.

### 2026-06-23-12:11 Task slice 159

- Rechecked the Ghostty runtime clipboard callback path for GPUI terminal parity. A worker first attempted a standard-clipboard bridge, but main-agent review found the bridge unsafe because Ghostty runtime config passes app-level callback userdata plus opaque request state while clipboard completion requires a concrete `ghostty_surface_t`. Casting that app-level userdata to a per-surface close token could complete a non-focused terminal's request through the wrong surface.
- Corrected the implementation back to an explicitly blocked runtime-callback boundary in `gpui/src/terminal_ghostty_surface.rs`. Runtime read callbacks return false, confirm/write callbacks ignore pointer payloads, selection clipboard remains unsupported, and the existing Cmd+V app-thread paste path remains the only active GPUI terminal clipboard path.
- Kept the newly bound `ghostty_surface_complete_clipboard_request` ABI in `gpui/src/ghostty_kit.rs` as future scaffold only, with comments clarifying it must not be used until there is a surface-scoped app-thread handoff that proves which terminal requested clipboard access.
- Updated app-thread drain comments in `gpui/src/main.rs` to describe the no-op-safe future boundary instead of claiming runtime clipboard is active. Source-only tests now assert runtime callbacks stay disabled for both app-level and surface-token userdata and do not enqueue reads/writes or touch fake clipboard completion state.
- Preserved privacy and layout boundaries: no runtime clipboard reads or writes, raw clipboard text/bytes, file-path synthesis, command text, terminal content, stdout/stderr, paths, URLs, titles, tokens, raw JSON, persistent logs, GPUI overlays, hidden hit regions, root/window hit-test routing, synthetic coordinate routing, app restart, or visual automation were added.
- Files touched: `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/main.rs`, `gpui/src/ghostty_kit.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`, Ghostty clipboard callback and completion signatures, GPUI runtime callback state, surface close-token userdata, app-thread clipboard paste helper, attempted runtime clipboard queue/drain code, source-only clipboard tests, touched-file status, and this progress entry using targeted `rg`, `sed`, `git status --short`, and `date '+%Y-%m-%d-%H:%M'`.
- Worker `019ef37a-0385-7873-b330-c2973e127b58` (`Ramanujan`, gpt-5.5, xhigh, priority, `fork_context:false`) implemented an attempted standard runtime clipboard bridge and was closed after completion. Main agent disabled the unsafe callback behavior during review and updated comments/tests to record the surface-identity blocker.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual/browser automation commands were run.
- Main-agent review checked runtime userdata shape, surface userdata shape, callback casts, app-thread clipboard access boundaries, selection clipboard support, explicit-string paste helper preservation, source-only test updates, CDXC comments, and absence of new persistent logs, active fallbacks, layout/input exceptions, app restart, or visual automation.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Real Ghostty runtime clipboard reads/writes remain blocked until Ghostty or GPUI exposes a surface-scoped callback handoff or another safe way to prove the requesting surface before app-thread clipboard access. Honest physical/binding key forwarding remains blocked by the missing native keycode/UIEvents-code identity in GPUI app events. Browser data import remains deferred until there is an explicit compatible importer requirement; app launch/restart and visual validation remain deferred by user instruction.

### 2026-06-23-12:22 Task slice 160

- Added an honest Phase 5 Source workarea runtime boundary in `gpui/src/main.rs` without fake-mounting code-server. Native macOS Source owns a supervised code-server launch plus readiness-gated navigation, while the current GPUI sidebar payload carries no ready code-server URL and sends an empty `surfaceIds` object, so GPUI must keep Source on the existing placeholder path.
- Added typed Source runtime identity keyed only by explicit sidebar snapshot facts: active project id plus `sourceWorkareaId`. Quick/projectless snapshots, Source-disabled snapshots, missing active-project snapshots, and current Phase 1 snapshots without `sourceWorkareaId` all stay blocked instead of deriving identity from paths, `.git`, labels, fixtures, workspace names, filesystem probes, or localhost constants.
- Split Source rendering out of the generic Kanban/Manage placeholder branch. The awake Source dispatch now evaluates the Source runtime boundary, but both blocked and future ready states still render the existing Source placeholder until a real code-server URL/bridge and CEF mount path are implemented; sleeping Source continues to use the existing sleeping placeholder path.
- Reconciled Source runtime identity only when the stored sidebar project snapshot changes. Changing the explicit active project/source identity clears any runtime-only code-server URL state, and malformed or duplicate sidebar payloads do not replace the stored snapshot or mutate Source runtime state.
- Added source-only tests proving current Phase 1 payloads remain blocked without explicit Source identity, explicit Source identity still requires a code-server URL bridge, and runtime-only URL state is represented only by safe booleans in the helper privacy boundary. Tests were added as source only and were not run.
- Preserved privacy and layout boundaries: no code-server process launch, localhost URL synthesis, CEF surface creation, project-path probing, editor buffer state, file contents, page titles, raw URLs, query strings, fragments, command text, terminal content, stdout/stderr, tokens, cookies, raw JSON logging, shell persistence of project ids/source ids/URLs, GPUI overlays, hidden hit regions, root/window hit-test routing, synthetic coordinate routing, app restart, or visual automation were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`, Phase 5 docs, GPUI Source/project snapshot/runtime/render snippets, native macOS code-server runtime launch and project-editor load snippets, sidebar active-project payload code, touched-file status, targeted `rg`/`sed` output, and `date '+%Y-%m-%d-%H:%M'`.
- Worker `019ef38d-9159-7430-a114-aaad7f156615` (`Archimedes`, gpt-5.5, xhigh, priority, `fork_context:false`) implemented the Source runtime boundary slice and was closed after completion.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual/browser automation commands were run.
- Main-agent review at `2026-06-23-12:22` checked native code-server launch/readiness ownership, absence of Source URL fallback, explicit `sourceWorkareaId` requirement, Quick/projectless blocking for real Source runtime while keeping Source selectable, render dispatch preserving existing placeholders, runtime-state clearing on identity change, source-only test shape, CDXC comments, and absence of new persistent logs, persistence of private Source facts, layout/input exceptions, app restart, or visual automation.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Real GPUI Source still needs an explicit sidebar/native bridge for a ready code-server URL or equivalent mount contract, plus the actual normal child CEF surface path and lifecycle/error handling after that contract exists. Kanban and Manage remain real-surface placeholders. Real Ghostty runtime clipboard and honest physical/binding key forwarding remain blocked as documented in prior slices.

### 2026-06-23-12:30 Task slice 161

- Added the explicit GPUI sidebar Source identity bridge in `gpui/sidebar/phase1-active-project-context.ts`. Active non-chat project payloads now pass `surfaceIds.sourceWorkareaId` from the existing `projectContext.editor.projectId` contract, matching the native project-editor key without deriving identity from project paths, `.git`, group ids, titles, fixture names, filesystem probes, URLs, or localhost constants.
- Kept Quick/projectless payloads and invalid project-editor metadata from inventing Source identity. During main-agent review, malformed/missing/empty editor project ids were corrected to emit the existing Quick/projectless payload instead of an invalid non-Quick payload with `activeProjectId: null`, so Rust does not reject a malformed project snapshot while GPUI pretends it was a valid project context.
- Kept Browser, Kanban, and Manage surface ids absent. This slice only allowlists `sourceWorkareaId` because the current sidebar/native state exposes a real Source/project-editor identity; no other workarea identity was synthesized.
- Updated Source comments and source-only tests in `gpui/src/main.rs` to reflect the new boundary: normal project payloads may provide Source identity, but real Source remains blocked by the missing code-server URL/ready bridge and must stay on the placeholder path until that bridge exists.
- Updated `gpui/sidebar/phase1-active-project-context.test.ts` source-only coverage for valid Source workarea ids, Quick/projectless surface ids, malformed editor ids, and absence of Browser/Kanban/Manage ids. Tests were added as source only and were not run.
- Preserved privacy and layout boundaries: no project-path-derived ids, source URL creation, localhost fallback, code-server launch, CEF surface creation, editor buffer state, file contents, raw URLs, query strings, fragments, page titles, command text, terminal content, stdout/stderr, tokens, cookies, persistent logging, GPUI overlays, hidden hit regions, root/window hit-test routing, synthetic coordinate routing, app restart, or visual automation were added.
- Files touched: `gpui/sidebar/phase1-active-project-context.ts`, `gpui/sidebar/phase1-active-project-context.test.ts`, `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`, sidebar project-context types, story workspace helpers, Source bridge TS helper/tests, GPUI Source runtime comments/tests, touched-file status, targeted `rg`/`sed` output, and `date '+%Y-%m-%d-%H:%M'`.
- Worker `019ef395-361e-7680-b6d5-a714faa349d3` (`Parfit`, gpt-5.5, xhigh, priority, `fork_context:false`) implemented the Source identity bridge slice and was closed after completion. Main agent corrected the malformed-editor-id branch during review.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, `git diff --check`, markdown/no-index whitespace checks, equivalent verification commands, `bun run start`, app launch/restart, or visual/browser automation commands were run.
- Main-agent review at `2026-06-23-12:30` checked explicit editor project id sourcing, Quick/projectless preservation, malformed editor id handling, no generated Browser/Kanban/Manage ids, Rust parser compatibility, updated Source comments/tests, CDXC comments, and absence of new persistence/logging of private Source facts, layout/input exceptions, app restart, or visual automation.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Real GPUI Source still needs an explicit ready code-server URL/bridge, plus a normal child CEF mount and lifecycle/error handling after that bridge exists. Kanban and Manage still need real workarea surfaces. Real Ghostty runtime clipboard and honest physical/binding key forwarding remain blocked as documented in prior slices.

### 2026-06-23-12:34 Task slice 162

- Added a GPUI-only Kanban/Manage real-surface readiness boundary in `gpui/src/main.rs`, matching the Source runtime pattern without mounting real surfaces.
- Kanban runtime identity now requires an explicit active project id plus `surfaceIds.kanbanBoardId`, then remains blocked until an explicit CEF readiness bridge exists.
- Manage runtime identity now requires an explicit active project id plus `surfaceIds.manageWorkspaceId`, then remains blocked until an explicit Manage CEF/file-bridge readiness contract exists.
- Wired the Kanban and Manage runtime states into sidebar project snapshot reconciliation so changed project/surface identity clears runtime-only readiness, and routed awake Kanban/Manage rendering through the boundary while preserving the existing colored placeholders for both blocked and future-ready states.
- Added source-only helper tests for missing Kanban/Manage surface ids, explicit identity with missing CEF/file bridge readiness, runtime-only ready booleans, privacy-safe shell-state boundaries, and identity-change readiness clearing. Tests were added as source only and were not run.
- Preserved privacy and layout boundaries: no synthesized surface ids, localhost URLs, filesystem probes, path/title/group-id derivation, CEF mounting, Manage file bridge, project facts in shell state, persistent logs, GPUI overlays, hidden hit regions, root/window hit-test routing, synthetic coordinate routing, app restart, or visual automation were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`, GPUI Source/project snapshot/runtime/render snippets, native/sidebar project-editor URL/readiness protocol snippets, project-scoped surface id parser helpers, Kanban/Manage runtime helper/tests, touched-file status, targeted `rg`/`sed` output, and `date '+%Y-%m-%d-%H:%M'`.
- Worker `019ef39d-c6cc-77a0-b4d1-f5ab9d061783` (`Russell`, gpt-5.5, xhigh, priority, `fork_context:false`) implemented the Kanban/Manage readiness boundary slice and was closed after completion.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, or browser/visual automation commands were run.
- Main-agent review at `2026-06-23-12:38` checked explicit surface id sourcing, identity-change readiness clearing, placeholder-only render dispatch, renamed Manage CEF/file-bridge block reason, source-only test shape, CDXC comments, and absence of new persistence/logging of private project/surface facts, layout/input exceptions, app restart, or visual automation.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Real GPUI Source still needs a ready code-server URL/bridge and mount path. Real GPUI Kanban and Manage still need explicit sidebar/native readiness contracts plus normal CEF/file-bridge mounting after those contracts exist.

### 2026-06-23-12:42 Task slice 163

- Audited bounded non-left terminal mouse-button parity for mounted GPUI Agents and command terminal bodies in `gpui/src/main.rs`; no executable source change was needed because the current local implementation already forwards right and middle press/release/up-out through the existing mounted body elements.
- Confirmed Agents mounted bodies wire right and middle `on_mouse_down`, `on_mouse_up`, and `on_mouse_up_out` alongside left. Right/middle down focuses the exact mounted Agents terminal before forwarding, in-body release uses recorded body bounds, and up-out stays element-scoped plus Ghostty-capture-gated without synthetic outside coordinates.
- Confirmed command mounted bodies mirror the same right and middle `on_mouse_down`, `on_mouse_up`, and `on_mouse_up_out` behavior while preserving command focus handoff, command-pane drop ownership, current command slot checks, exact surface/runtime identity checks, and mapped mouse modifiers.
- Confirmed the shared `MouseButton` mapper still accepts only GPUI left/right/middle as Ghostty left/right/middle values and rejects navigation buttons. Existing source-only helper tests already cover those mapper cases, so no additional tests were added.
- Preserved privacy and layout boundaries: no mouse position/button/modifier storage, terminal content, command text, stdout/stderr, paths, URLs, tokens, persistent logs, overlays, hidden hit regions, root/window pre-dispatch routing, global hit-test forwarding, broad outside-move capture, synthetic coordinate routing, app restart, visual automation, or fallback behavior was added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`, checked dirty worktree status, and used targeted `rg`, `sed`, `tail`, and `date '+%Y-%m-%d-%H:%M'` review of Ghostty mouse constants, the GPUI mouse-button mapper, Agents/command forwarding helpers, mounted body render hooks, source-only mapper tests, CDXC comments, and this progress entry.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent verification commands were run.
- Main-agent review at `2026-06-23-12:42` checked that non-left forwarding is already bounded to mounted terminal body elements, in-body events retain current-slot/recorded-bounds/exact-surface/modifier gates, release-outside remains Ghostty-capture-gated, placeholder activation and left behavior remain unchanged, and no persistent logging or layout/input-routing exception was introduced.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Terminal selection/drag semantics beyond forwarding raw mouse events remain a separate parity gap; real runtime clipboard and honest physical/binding key forwarding remain blocked as documented in prior slices.

### 2026-06-23-12:45 Task slice 164

- Audited mounted GPUI terminal selection/drag semantics for Agents and command terminal bodies in `gpui/src/main.rs`; no executable runtime change was needed because Ghostty owns terminal selection state and the mounted body already supplies the normal press + body-relative move + release stream.
- Confirmed Agents mounted bodies keep placeholder activation separate from Running terminal focus. Running bodies left/right/middle press through the body focus the exact mounted terminal and forward a Ghostty button press, body `on_mouse_move` forwards body-relative pointer movement during normal body delivery, in-body `on_mouse_up` forwards release, and `on_mouse_up_out` is capture-gated release only with no synthetic outside coordinates.
- Confirmed command mounted bodies mirror the same selection-relevant event shape while preserving command focus handoff, typed command/workspace tab drag-over/drop handlers, current command slot checks, exact surface/runtime identity checks, and mapped modifiers.
- Added CDXC source documentation recording that GPUI must not add selection text storage, stored raw drag coordinates, transparent overlays, hidden hit regions, global capture, root/window pre-dispatch routing, broad hit-test routing, or synthetic coordinate routing for this parity slice.
- Preserved privacy and layout boundaries: no terminal selection text, command text, terminal content, stdout/stderr, paths, URLs, tokens, persistent logs, overlays, hidden hit regions, root/window pre-dispatch routing, global capture, synthetic coordinate routing, app restart, visual automation, or fallback behavior was added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`, checked dirty worktree status, and used targeted `rg`, `sed`, `tail`, read-only `git diff` without `--check`, and `date '+%Y-%m-%d-%H:%M'` review of mounted Agents/command terminal body handlers, pointer-position helpers, capture-gated release helpers, placeholder activation, command focus handoff, typed tab drag/drop handlers, CDXC comments, and this progress entry.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent verification commands were run.
- Main-agent review at `2026-06-23-12:45` checked that body-internal terminal selection drag is represented by the current bounded Ghostty event stream, no runtime state or layout/input-routing exception was introduced, and the previous broad "terminal selection/drag semantics" gap is now narrowed to any future outside-body drag continuation/autoscroll behavior that would need an explicit safe normal-layout/capture contract.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Future terminal outside-body drag continuation or autoscroll remains deferred unless it can be implemented with an approved normal-layout/body-scoped contract and without root/window routing or synthetic coordinates. Real GPUI Source/Kanban/Manage surfaces remain blocked on explicit readiness/mount contracts.

### 2026-06-23-12:48 Task slice 165

- Audited the remaining Phase 8 GPUI Browser runtime gaps in `gpui/src/main.rs`, `gpui/src/cef/macos.rs`, `gpui/src/cef/unsupported.rs`, and this progress log: real Browser data import, blank-popup content transfer, deeper suspend/teardown, and app launch/visual validation remain the only Browser-runtime gaps from the recent slices.
- Added source-only Browser runtime policy helpers in `gpui/src/main.rs`: `BrowserPopupTargetPolicy` admits only non-empty popup targets as loaded Browser tabs, and `BrowserDataImportPolicy` allows only the existing fixed unsupported-import notification when profile actions are available.
- Routed the existing shell popup model and profile-menu import handler through those policies. Non-empty popup targets still create selected loaded Browser tabs with the active generated profile; empty/whitespace popup targets still no-op without address-only tabs, CEF surfaces, persistence, notifications, import, or content-transfer fallback; Import Browser Data still only shows the unsupported notification.
- Added the matching macOS CEF backend popup dispatch policy in `gpui/src/cef/macos.rs` so empty popup targets are handled before any shell callback crosses into GPUI app state, while non-empty targets continue to use the shell-owned Browser tab path.
- Added missing unsupported-backend API parity in `gpui/src/cef/unsupported.rs` by exposing a no-op `CefBrowser::focus`, matching the shared macOS Browser runtime API without adding a fallback browser or synthetic focus behavior.
- Added source-only helper coverage for the import/no-op popup policies in `gpui/src/main.rs`. Tests were added as source only and were not run.
- Preserved privacy and layout boundaries: no cookies, credentials, history, browser-store reads, local filesystem import, raw URL/title/page logging, page-content transfer, fallback importer, CEF teardown/suspend, overlays, hidden hit regions, root/window hit-test routing, app restart, or visual automation were added.
- Files touched: `gpui/src/main.rs`, `gpui/src/cef/macos.rs`, `gpui/src/cef/unsupported.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`, checked dirty GPUI status, used targeted `rg`, `sed`, `tail`, read-only `git diff` without `--check`, `git diff --stat`, and `date '+%Y-%m-%d-%H:%M'` to inspect Browser lifecycle/profile/import/popup code, CEF callback policy, unsupported backend stubs, source-only helper tests, and this progress entry.
- Worker `019ef3a9-b9c9-7491-960a-6af343250ea3` (`Nietzsche`, gpt-5.5, xhigh, priority, `fork_context:false`) implemented the Phase 8 Browser runtime policy slice and was closed after completion.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent verification commands were run.
- Main-agent review at `2026-06-23-12:48` checked shell popup/import policy call sites, CEF empty-target callback handling, unsupported-backend focus API parity, source-only helper assertions, CDXC comments, and absence of Browser import, popup content-transfer fallback, CEF teardown/suspend, persistent logging, layout/input exceptions, app restart, or visual automation.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Real GPUI Browser data import remains blocked until there is an explicit compatible importer requirement. Script-created blank popup content transfer remains blocked until there is an explicit safe source-of-truth contract for transferable content. Deeper CEF suspend/teardown remains deferred beyond the existing hide-and-hold lifecycle policy, and app launch/visual validation remains skipped by instruction.

### 2026-06-23-12:59 Task slice 166

- Added the GPUI sidebar Kanban/Manage surface-identity bridge in `gpui/sidebar/phase1-active-project-context.ts`. Valid project payloads now include a Kanban `kanbanBoardId` using the native project-editor id shape `project-editor:<encoded project id>:tasks`, derived only from explicit `projectContext.editor.projectId`.
- Kept Manage identity behind the existing strict gate. `manageWorkspaceId` is emitted only when Debugging Mode and Show Beta Features are both boolean true through the workspace/runtime-settings contract; Quick/projectless payloads, malformed editor ids, Browser ids, readiness, URLs, filesystem probes, group ids, titles, and fallback localhost state remain absent.
- Updated source-only sidebar coverage in `gpui/sidebar/phase1-active-project-context.test.ts` for native-shaped Kanban ids, gated Manage ids, and encoded project ids. Tests were edited as source only and were not run.
- Updated GPUI Rust readiness comments and source-only fixtures in `gpui/src/main.rs` so Kanban/Manage native-shaped ids are treated as runtime identity only. Valid identity still blocks at `MissingKanbanCefBridge` or `MissingManageCefAndFileBridge`; no CEF, Manage surface, file bridge, fallback URL, or persistence/logging of ids was added.
- Preserved privacy and layout boundaries: no project path derivation beyond the existing explicit in-memory path, no browser/project title ids, no source URL creation, no code-server launch, no CEF mount, no Manage file bridge, no persistent logging, no shell-state persistence of private ids, no overlays, no hidden hit regions, no root/window hit-test routing, no synthetic coordinates, no app restart, and no visual automation were added.
- Files touched: `gpui/sidebar/phase1-active-project-context.ts`, `gpui/sidebar/phase1-active-project-context.test.ts`, `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`, `AGENTS.md`, Phase 5-8/Project bridge progress, GPUI sidebar active-project bridge/tests, shared sidebar project-context type, native read-only project-editor id/source-of-truth snippets, GPUI Rust project snapshot parser/runtime readiness helpers/tests, touched-file status, and this progress entry using targeted `rg`, `sed`, `tail`, `git status --short`, and `date '+%Y-%m-%d-%H:%M'`.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Main-agent review at `2026-06-23-12:59` checked that ids derive only from explicit sidebar project id, Manage identity follows the strict feature gate, Quick/projectless and malformed project payloads still emit no surface ids, Browser ids remain absent, Rust readiness remains blocked without explicit CEF/file bridges, CDXC comments were updated, and no persistence/logging/layout/input-routing exception was introduced.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Real GPUI Kanban still needs an explicit CEF readiness/mount bridge. Real GPUI Manage still needs explicit CEF plus file-bridge readiness/mount contracts. Real Source remains blocked on code-server URL/ready bridge, Browser import/content-transfer/deeper suspend gaps remain blocked/deferred as documented, and app launch/visual validation remains skipped by instruction.

### 2026-06-23-13:01 Task slice 167

- Hardened the GPUI active-project snapshot contract in `gpui/src/main.rs` so surface ids must agree with explicit workarea availability. Rust now rejects Browser, Kanban, or Manage ids when the matching workarea is unavailable instead of preserving stale or speculative identity from a malformed sidebar payload.
- Kept the Source rule unchanged: Source availability is still mandatory for every accepted payload, but Source identity can remain absent while real Source stays blocked on its separate code-server URL/ready bridge.
- Added source-only malformed-contract cases for unavailable Browser/Kanban/Manage surface ids. Tests were edited as source only and were not run.
- Preserved privacy and layout boundaries: no ids were persisted to shell state, no paths/titles/URLs were derived, no CEF/code-server/Manage/file bridge was mounted, no persistent logs were added, and no overlays, hidden hit regions, root/window routing, synthetic coordinates, app restart, or visual automation were introduced.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`, the GPUI sidebar bridge/tests, native sidebar project-editor id helper, GPUI project snapshot parser/runtime fixtures, touched-file status, and this progress entry using targeted `sed`, `rg`, `tail`, `git status --short`, and `date '+%Y-%m-%d-%H:%M'`.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Main-agent review at `2026-06-23-13:01` checked that the new consistency check only rejects unavailable workarea ids, accepts the existing valid project/Quick payload shapes, keeps Source missing-id blocking behavior intact, and does not add persistence/logging/layout/input-routing exceptions.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Real GPUI Source/Kanban/Manage still need explicit readiness/mount contracts, terminal runtime clipboard and honest physical-key forwarding remain blocked on missing safe APIs, Browser import/content-transfer/deeper suspend gaps remain blocked/deferred, and app launch/visual validation remains skipped by instruction.

### 2026-06-23-13:04 Task slice 168

- Added a bounded Phase 10 GPUI shell-state migration in `gpui/src/main.rs`. The top-level restore path now accepts the original unversioned GPUI workspace shell-state object only when it has the known layout fields, while still rejecting malformed explicit versions and unknown future versions.
- Kept migration privacy-scoped to existing shell readers. Legacy Browser tabs restore through the current sanitized URL/history path, Browser profiles default when the old file has no profile block, ignored private extras are not carried into reserialized shell state, and no new persistent fields or logging were added.
- Added source-only tests for unversioned legacy layout restore, default Browser profile assignment, sanitized Browser URL/runtime metadata omission, ignored private extras, unknown future-version rejection, malformed-version rejection, rejection of unknown unversioned object shapes, and fail-closed handling for legacy-shaped objects with invalid model content. Tests were added as source only and were not run.
- Preserved privacy and layout boundaries: no terminal content, command text, stdout/stderr, project paths, file paths, raw URLs/query/fragment, page titles, profile names/paths, cookies, credentials, history import, tokens, raw JSON logging, CEF/code-server/Manage mounts, persistent logs, overlays, hidden hit regions, root/window routing, synthetic coordinates, app restart, or visual automation were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`, `AGENTS.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, the tail of this progress log, GPUI shell-state restore/serialize helpers, Browser profile/tab restore helpers, existing persistence tests, and touched-file status using targeted `rg`, `sed`, `tail`, `git status --short`, read-only `git diff` without `--check`, and `date '+%Y-%m-%d-%H:%M'`.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Main-agent review at `2026-06-23-13:09` checked that the migration is limited to the known unversioned shape, explicit bad versions still fail closed, profile-less legacy state uses Default only, Browser URL restore remains sanitized, private extra fields are ignored, CDXC comments were updated, and no persistence/logging/layout/input-routing exception was introduced.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Real GPUI Source/Kanban/Manage still need explicit readiness/mount contracts, terminal runtime clipboard and honest physical-key forwarding remain blocked on missing safe APIs, Browser import/content-transfer/deeper suspend gaps remain blocked/deferred, deeper Phase 10 cleanup/signoff remains pending, and app launch/visual validation remains skipped by instruction.

### 2026-06-23-13:14 Task slice 169

- Hardened current-version GPUI shell-state restore in `gpui/src/main.rs`. Explicit versioned v1 state now requires the current writer-owned top-level schema instead of silently defaulting missing Agents, command, Browser profile/tab, project-editor, active-mode, or focus sections.
- Kept the slice-168 legacy migration explicit and narrow. Unversioned original shell-state objects can still restore through the known legacy shape with default Browser profiles, but versioned v1 objects with malformed version fields, missing required sections, or malformed required sections now fail closed so `load_or_default` owns the optional-file fallback.
- Preserved intentional validation defaults for stale-but-typed focus ids: a parsed focus target that points at a removed pane still flows through the normal focus validator and falls back to the current mode's safe surface.
- Added source-only regression coverage for current-version required-section rejection, strict numeric version handling, stale typed focus validation, and current-version private-extra omission after restore/reserialize. Tests were added as source only and were not run.
- Preserved privacy and layout boundaries: no terminal content, command text, stdout/stderr, project paths, file paths, raw URLs/query/fragment, page titles, profile names/paths, cookies, credentials, tokens, raw JSON logging, persistent logs, CEF/code-server/Manage mounts, overlays, hidden hit regions, root/window routing, synthetic coordinates, app restart, or visual automation were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`, `AGENTS.md`, Phase 10 docs, recent progress tail, GPUI shell-state restore/serialize helpers, Browser profile/tab restore helpers, focus restore tests, touched-file status, and targeted source snippets using `rg`, `sed`, `tail`, `git status --short`, read-only `git diff` without `--check`, and `date '+%Y-%m-%d-%H:%M'`.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Main-agent review at `2026-06-23-13:15` checked that current v1 restore no longer defaults missing required sections, legacy unversioned migration remains scoped, Browser profile-less defaulting is legacy-only, private extras are ignored before writer-boundary serialization, CDXC comments were updated, and no persistence/logging/layout/input-routing exception was introduced.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Real GPUI Source/Kanban/Manage still need explicit readiness/mount contracts, terminal runtime clipboard and honest physical-key forwarding remain blocked on missing safe APIs, Browser import/content-transfer/deeper suspend gaps remain blocked/deferred, deeper Phase 10 cleanup/signoff remains pending, and app launch/visual validation remains skipped by instruction.

### 2026-06-23-13:23 Task slice 170

- Performed a bounded Phase 10 GPUI persistence/logging privacy re-audit. Targeted review found GPUI-owned `fs::write` calls only at the workspace shell-state writer and sidebar-width settings writer, plus CEF root metadata directory creation; GPUI-owned log-like output remains limited to opt-in `GHOSTEX_GPUI_TRACE` stderr diagnostics.
- Hardened the GPUI CEF persistence boundary in `gpui/src/cef/macos.rs`. Browser profile request contexts no longer configure per-profile `cache_path` and no longer request session-cookie persistence, so generated profile ids persist only as shell metadata without durable cookies, profile stores, page cache, history, URLs, titles, tokens, or page content.
- Kept CEF `root_cache_path` explicit to avoid Chromium's platform default user-data directory, but limited it to CEF installation metadata. CEF file logging is disabled with `LogSeverity::DISABLE`, and no `log_file` path or support-bundle log writer was added.
- Added Phase 10 CDXC comments at the GPUI shell-state writer, sidebar-width settings writer, CEF root/profile storage boundary, and opt-in trace boundary. The comments record that persistent GPUI data must stay limited to safe shell/settings/root-cache metadata and must not include private runtime data.
- Added source-only writer-boundary privacy evidence in `gpui/src/main.rs` covering private URL credentials/query/fragment, runtime page titles, favicon URLs/fetch sources, profile-cache terms, command/output/path samples, terminal content, and support-bundle log terms. Tests were added as source only and were not run.
- Preserved layout/input and missing-surface boundaries: no Source/Kanban/Manage surface, Browser import flow, app launch validation, fallback importer, overlay, hidden hit region, root/window hit-test routing, synthetic coordinate routing, or regular macOS app edit was added.
- Files touched: `gpui/src/main.rs`, `gpui/src/cef/macos.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Commands/read-only review performed from repo root: read `~/.agents/main.md`, `AGENTS.md`, Phase 10 docs, recent progress tail, GPUI shell-state/settings/trace snippets, GPUI CEF settings/request-context snippets, local `cef-rs` binding docs for cache/log/cookie settings, touched-file status, and targeted source/diff markers using `rg`, `sed`, `tail`, `ls`, `git status --short`, read-only `git diff` without `--check`, and `date '+%Y-%m-%d-%H:%M'`.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Main-agent review at `2026-06-23-13:24` checked the remaining write markers, CEF root/profile storage settings, trace call sites, shell/settings writer comments, source-only privacy evidence, and absence of new support-bundle logs, persistent private runtime data, fallback behavior, layout/input exceptions, app restart, or visual automation. During review, the CEF request-context hardening was narrowed to preserve normal in-memory cookieable scheme behavior while keeping per-profile disk cache paths empty and session-cookie persistence disabled.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Real GPUI Source/Kanban/Manage still need explicit readiness/mount contracts, terminal runtime clipboard and honest physical-key forwarding remain blocked on missing safe APIs, Browser import/content-transfer/deeper suspend gaps remain blocked/deferred, broader Phase 10 requirements reconciliation/signoff remains pending, and app launch/visual validation remains skipped by instruction.

### 2026-06-23-13:28 Task slice 171

- Added a Phase 10 reconciliation scaffold to the GPUI workspace-area requirements. The new checklist/table is intentionally not final parity signoff: it separates implemented/source-only behavior from explicit contract blockers, deferred product decisions, and validation skipped by user instruction.
- Reconciled the requirements doc against the missing-parity phases and recent progress entries. Terminal/Agents and command runtime work are marked source-only with runtime clipboard and honest physical-key forwarding still blocked on safe APIs; Browser runtime work is marked source-only with import, transferable blank-popup content, and deeper suspend/teardown still blocked or deferred; Source, Kanban, and Manage real surfaces remain blocked pending explicit readiness/mount contracts.
- Recorded Phase 10 migration, logging/privacy, layout/focus/sidebar, and sleep/wake/persistence status as source-only rather than verified. Visual validation and formatting/test/check validation are explicitly marked not verified because the user forbade app launch, automation, and validation commands.
- Files touched: `docs/gpui-workspace-area-parity-requirements.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: instruction/doc reads, progress tail reads, line-count review, targeted progress/status searches, and timestamp capture. Raw command arguments were not copied into this durable entry.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: this was a documentation reconciliation slice only, so compile/test/runtime risk remains unchanged. Real GPUI Source/Kanban/Manage surfaces still need explicit readiness/mount contracts, terminal runtime clipboard and honest physical-key forwarding remain blocked on missing safe APIs, Browser import/content-transfer/deeper suspend gaps remain blocked/deferred, and Phase 9 running-app visual validation remains pending explicit user approval.

### 2026-06-23-13:31 Task slice 172

- Updated the missing-parity phase plan so Phase 10 distinguishes source-only reconciliation progress from final parity signoff.
- Added an explicit Phase 10 status note that final signoff remains blocked until real Source, Kanban, and Manage surfaces have explicit readiness/mount contracts and are verified, terminal runtime clipboard and physical-key blockers are resolved or accepted as product differences, Browser import/content-transfer/suspend decisions are made, and running-app visual/interaction validation is allowed.
- Preserved the placeholder-removal rule: placeholder-only paths should stay until the corresponding real surface is verified, because removing them early would hide blocked parity work instead of completing it.
- Files touched: `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: instruction/doc reads, Phase 10 plan/status reads, targeted signoff/checklist searches, progress tail reads, touched-file status reads, and timestamp capture. Raw command arguments were not copied into this durable entry.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no implementation or validation changed in this slice. Final parity signoff remains blocked by the real Source/Kanban/Manage contracts, safe terminal API blockers, deferred Browser product decisions, and forbidden running-app/validation work.

### 2026-06-23-13:33 Task slice 173

- Performed a bounded Phase 10 remaining-parity cleanup audit against the allowed GPUI docs/progress surface.
- Corrected stale handoff intro wording in `docs/gpui-workspace-area-missing-parity-phases.md` so the earlier placeholder-shell pass is described as shell-level source-only capture, not completed parity or final signoff.
- Added a CDXC handoff comment recording that placeholder-only Source, Kanban, and Manage paths must remain until their real surfaces have explicit readiness/mount contracts and are verified.
- Left `docs/gpui-workspace-area-parity-requirements.md` unchanged because its Phase 10 status table already separates source-only work, blocked contracts, deferred product decisions, and forbidden validation.
- Files touched: `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: instruction reads, AGENTS read, Phase 10 status/plan reads, targeted stale-wording searches, recent progress tail reads, touched-file status reads, and timestamp capture.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no implementation or runtime behavior changed in this slice. Final parity signoff remains blocked by real Source/Kanban/Manage readiness and mount contracts, terminal runtime clipboard and honest physical-key API blockers, deferred Browser product decisions, and forbidden running-app/validation work.

### 2026-06-23-13:37 Task slice 174

- Performed a bounded GPUI source-only Phase 5/10 Source cleanup in `gpui/src/main.rs`. Source runtime readiness now mirrors the Kanban/Manage explicit-bridge pattern: explicit active-project/source identity is runtime identity only, while readiness is a separate in-memory Source bridge.
- Removed the URL-shaped Source runtime marker from the Source runtime surface/state. A ready Source surface now carries identity only, and the privacy-boundary JSON exposes only `hasActiveIdentity` and `hasReadinessBridge` booleans.
- Updated Source CDXC comments and source-only tests so Source remains blocked until an explicit Source readiness and mount contract exists. Tests now cover missing Source identity, explicit identity without readiness, manually bridged ready state, and identity-change clearing of readiness.
- Preserved privacy and layout boundaries: no code-server launch, URL parsing, fallback localhost behavior, filesystem probing, CEF mount, persisted private ids, raw URLs, paths, logs, overlays, hidden hit regions, root/window routing, or synthetic coordinate routing was added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: instruction reads, AGENTS read, Phase 5/10 doc reads, recent progress tail reads, targeted Source/Kanban/Manage runtime and test searches, focused source snippet reads, touched-file status reads, and timestamp capture.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Real GPUI Source still needs an explicit readiness/mount contract and normal child CEF mount path before replacing the placeholder. Real GPUI Kanban and Manage still need their explicit readiness/mount contracts, and Phase 9 running-app visual validation remains skipped by instruction.

### 2026-06-23-13:40 Task slice 175

- Reconciled the Phase 10 requirements table with the Source runtime cleanup from slice 174. The Source remaining-gap row now names an explicit Source readiness/mount contract instead of a ready code-server URL so the docs no longer imply raw URL-shaped readiness is acceptable.
- Files touched: `docs/gpui-workspace-area-parity-requirements.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: focused Source runtime/test reads, targeted Source readiness searches, recent progress tail reads, touched-file status reads, and timestamp capture.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no implementation or runtime behavior changed in this integration slice. Real GPUI Source still needs its explicit readiness/mount contract and child CEF mount, Kanban/Manage still need explicit readiness/mount contracts, and running-app validation remains skipped by instruction.

### 2026-06-23-13:42 Task slice 176

- Performed a bounded GPUI source-only Phase 6/7 Kanban/Manage lifecycle cleanup in `gpui/src/main.rs`. The project-scoped real-surface bridge now represents missing explicit bridge, mounting, ready, and load-failed enum states without storing failure details.
- Kept availability honest and placeholder-only. Only the ready lifecycle state returns `Ready`; missing, mounting, and failed states remain blocked with Kanban/Manage-specific enum reasons, and render still keeps both blocked and future-ready Kanban/Manage states on existing placeholders.
- Updated the privacy-boundary JSON for Kanban/Manage lifecycle state to safe booleans/enums only, including active-identity presence, bridge state, and ready status. No project ids, surface ids, paths, URLs, file names, page titles, tokens, raw payloads, error text, fallback URLs, persistent logs, or support-bundle logging were added.
- During final source review, removed one stale raw path sentinel from an adjacent Source privacy assertion. No Source runtime behavior changed.
- Added source-only coverage for missing explicit identity, explicit identity with missing bridge, mounting, load failed, ready, and identity-change lifecycle reset back to missing explicit bridge. Tests were edited as source only and were not run.
- Updated CDXC comments near the runtime, render path, and tests to record that Phase 6/7 startup and load-failure visibility is source-only until explicit real Kanban CEF, Manage CEF, and Manage file-bridge mount contracts exist.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: instruction reads, AGENTS read, Phase 6/7/10 doc reads, recent progress tail reads, targeted Kanban/Manage runtime/test/render symbol searches, focused source snippet reads, and timestamp capture.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Real GPUI Kanban still needs an explicit CEF readiness/mount contract before replacing the placeholder. Real GPUI Manage still needs explicit CEF plus file-bridge readiness/mount contracts, and running-app validation remains skipped by instruction.

### 2026-06-23-13:48 Task slice 177

- Reconciled the Phase 10 requirements table with the Kanban/Manage lifecycle cleanup from slice 176. The Kanban and Manage source-only state now names the missing, mounting, ready, and load-failed lifecycle bridge states instead of describing the boundary only as readiness.
- Files touched: `docs/gpui-workspace-area-parity-requirements.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: focused Kanban/Manage lifecycle runtime/test reads, targeted lifecycle/readiness searches, recent progress tail reads, touched-file status reads, and timestamp capture.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no implementation or runtime behavior changed in this integration slice. Real GPUI Kanban still needs its CEF readiness/mount contract, real GPUI Manage still needs CEF plus file-bridge readiness/mount contracts, and running-app validation remains skipped by instruction.

### 2026-06-23-13:50 Task slice 178

- Implemented a bounded GPUI source-only Phase 6/7 UI parity slice in `gpui/src/main.rs`. Kanban and Manage blocked runtime availability now routes through placeholder signatures so mounting and load-failed states have distinct static title/message copy while preserving the existing colored placeholder layout and color identities.
- Kept missing bridge, unavailable, missing identity, Quick/projectless, missing snapshot, and future-ready states on the normal placeholder copy until explicit real mount contracts exist. Ready still renders the default placeholder because real Kanban/Manage mount contracts are not present.
- Added source-only placeholder signature coverage for Kanban mounting, Kanban load failed, Manage mounting, Manage load failed, and ready/default block reasons. The lifecycle copy tests assert generic text and omit private ids, paths, URLs, tokens, raw surface ids, CEF/file-bridge detail terms, stack traces, and error detail markers.
- Preserved privacy and layout boundaries: no real CEF web surface, file bridge, fallback URL, real surface mount, shell-state persistence field, persistent log, raw failure detail, private project/surface id, path, title, command text, stdout/stderr, terminal content, overlay, hidden hit region, broad hit-test route, synthetic coordinate route, app launch, or browser/visual automation was added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: global/repo instruction reads, Phase 6/7/10 doc reads, recent progress tail reads, targeted GPUI runtime/placeholder/render/test symbol searches, focused source snippet reads, touched-file status reads, and timestamp capture.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Real GPUI Kanban still needs an explicit CEF readiness/mount contract before replacing the placeholder. Real GPUI Manage still needs explicit CEF plus file-bridge readiness/mount contracts, and running-app validation remains skipped by instruction.

### 2026-06-23-13:54 Task slice 179

- Performed main-agent review cleanup for the Kanban/Manage lifecycle placeholder copy from slice 178. Visible placeholder messages now avoid implementation-facing phrases such as source-only behavior, GPUI shell internals, and failure-storage details while still showing mounting and load-failed state to the user.
- Kept the privacy and no-mount requirements in CDXC comments and source-only assertions: lifecycle copy stays generic and must not include private project ids, surface ids, paths, URLs, tokens, stack traces, CEF/file-bridge detail terms, or error text.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: focused placeholder signature/render/test reads, targeted lifecycle-copy privacy searches, recent progress tail reads, touched-file status reads, and timestamp capture.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no runtime behavior changed in this review cleanup. Real GPUI Kanban still needs its CEF readiness/mount contract, real GPUI Manage still needs CEF plus file-bridge readiness/mount contracts, and running-app validation remains skipped by instruction.

### 2026-06-23-13:58 Task slice 180

- Implemented a bounded GPUI source-only Phase 7 Manage file/workarea bridge policy boundary in `gpui/src/main.rs`. The new helper accepts only explicit allowlisted operation names, returns safe operation/rejection categories, and serializes only boolean/count/kind facts for privacy-boundary shell-state review.
- Added source-only unit tests proving allowlisted operations are accepted; unknown, malformed, path-shaped, filename-shaped, URL-shaped, token-shaped, and raw-payload-shaped values are rejected without storing their submitted value; and privacy JSON exposes only accepted/rejected booleans, operation count, operation kind, or rejection kind.
- Preserved the Phase 7 boundaries: no CEF mount, CEF/browser work, file I/O, filesystem probing, `PathBuf` feature use, persistent logging, raw path/name/content/command/URL/payload/token/error storage, readiness promotion, placeholder render change, or fallback behavior was added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: global instruction read, targeted GPUI source/progress reads, focused runtime/test snippet reads, touched-file status read, and timestamp capture. Raw command arguments were not copied into this durable entry.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Real GPUI Manage still needs explicit CEF and file-bridge readiness/mount contracts before replacing the placeholder or performing real file operations.

### 2026-06-23-14:02 Task slice 181

- Performed main-agent review cleanup for the Phase 7 Manage file/workarea bridge policy boundary in `gpui/src/main.rs`. Credential-, password-, authorization-, and access-key-shaped operation names are now classified as private bridge input even when they are not valid operations.
- Updated source-only assertions so private bridge input is distinguished from ordinary unknown operations without storing the submitted value in privacy-boundary JSON.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: focused policy/test/progress reads, touched-file status read, and timestamp capture. Raw command arguments were not copied into this durable entry.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no verification commands were run in this cleanup slice, so compile/test risk remains. Real GPUI Manage still needs explicit CEF and file-bridge readiness/mount contracts before replacing the placeholder or performing real file operations.

### 2026-06-23-14:05 Task slice 182

- Implemented a bounded GPUI source-only Phase 7 Manage active-project routing hardening slice in `gpui/src/main.rs`. Added CDXC requirement comments and pure coverage that Manage is disabled in Quick/projectless context even when the debugging/beta gate is open, hidden and coerced to Agents when the gate is closed for a real project, and blocked by runtime availability when the active snapshot is Quick/projectless or Manage-unavailable.
- Extended the existing Manage lifecycle identity-change coverage so a real project id switch plus explicit Manage surface id switch resets lifecycle readiness to the missing explicit bridge and blocks readiness for the new identity until a fresh bridge exists.
- Preserved boundaries: no real runtime behavior, placeholder rendering, CEF web-surface mount, browser work, file bridge, file I/O, persistent logging, fallback surface, project inference, or shell-state private data behavior was added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: shared instruction read, touched-file status read, timestamp capture, targeted GPUI source/progress reads, and focused symbol searches. Raw command arguments were not copied into this durable entry.
- Verification skipped per explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Real GPUI Manage still needs explicit CEF plus file-bridge readiness/mount contracts before replacing the placeholder or performing real file operations.

### 2026-06-23-14:08 Task slice 183

- Implemented a bounded GPUI source-only Phase 7 Manage sleep/wake and error-state evidence slice in `gpui/src/main.rs`. Added CDXC requirements and pure coverage that shell-level Manage sleep/wake preserves the explicit project/workarea runtime identity while the lifecycle bridge remains separate.
- Covered the load-failed Manage bridge state across sleep and wake so shell lifecycle changes do not clear the failure, synthesize readiness, or store private project/workarea facts.
- Preserved boundaries: no real runtime behavior, placeholder rendering, CEF web-surface mount, browser work, file bridge, file I/O, persistent logging, fallback surface, project inference, or shell-state private data behavior was added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: targeted GPUI lifecycle/render/persistence/test reads and timestamp capture. Raw command arguments were not copied into this durable entry.
- Verification skipped per explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no verification commands were run in this slice, so compile/test risk remains. Real GPUI Manage still needs explicit CEF plus file-bridge readiness/mount contracts before replacing the placeholder or performing real file operations.

### 2026-06-23-14:10 Task slice 184

- Reconciled the Phase 7 documentation after the Manage source-only hardening slices. The requirements/status docs now call out operation allowlisting, project-context routing, lifecycle bridge state, and shell sleep/wake identity preservation as source-only progress while keeping real Manage blocked on explicit CEF plus file-bridge readiness/mount contracts.
- Preserved the non-signoff wording: documentation still states that real Manage has not replaced the placeholder and no file operations should occur until the required contracts exist.
- Files touched: `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: targeted Phase 7/status doc reads, recent progress tail read, and timestamp capture. Raw command arguments were not copied into this durable entry.
- Verification skipped per explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no verification commands were run in this documentation slice. Real GPUI Manage still needs explicit CEF plus file-bridge readiness/mount contracts before replacing the placeholder or performing real file operations.

### 2026-06-23-14:12 Task slice 185

- Reconciled the Phase 8 documentation with existing GPUI Browser source-only runtime work. The missing-parity plan now records generated profile persistence, feedback injection boundaries, tab-owned CEF identity, hide-and-hold visibility, popup target policy, and unsupported import policy as source-only progress.
- Kept unresolved Browser work explicit: real Browser import, script-created blank popup content transfer, and deeper CEF suspend/teardown remain deferred product/contract decisions rather than completed parity.
- Files touched: `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: targeted Phase 8/source/progress reads and timestamp capture. Raw command arguments were not copied into this durable entry.
- Verification skipped per explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no verification commands were run in this documentation slice. Browser import, blank-popup content transfer, and deeper CEF suspend/teardown still need explicit product/contract decisions before implementation.

### 2026-06-23-14:13 Task slice 186

- Added a bounded GPUI source-only Phase 8 Browser import-policy hardening slice in `gpui/src/main.rs`. The unsupported import notification is now documented and asserted as fixed category-only text with no profile paths, browser-store filenames, raw URLs, tokens, importer diagnostics, or failure details.
- Preserved the existing policy: Browser import remains unsupported until a compatible product/importer requirement exists, and no browser stores, cookies, credentials, history, profile directories, shell state, or CEF request-context data are read.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: targeted Browser import-policy source reads and timestamp capture. Raw command arguments were not copied into this durable entry.
- Verification skipped per explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no verification commands were run in this source-only slice. Real Browser import still needs an explicit compatible product/importer requirement before implementation.

### 2026-06-23-14:13 Task slice 187

- Added a Phase 9 handoff CDXC note in `docs/gpui-workspace-area-missing-parity-phases.md` recording the current explicit validation ban: no formatting, targeted tests, full GPUI test/check, whitespace checks, app restart, launch, or visual automation should be run by agents in this thread.
- Kept Phase 9 blocked under the persistent no-validation instruction rather than scheduling validation as a later agent workflow.
- Files touched: `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: timestamp capture. Raw command arguments were not copied into this durable entry.
- Verification skipped per explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: Phase 9 visual/interaction validation remains blocked by instruction; compile/test/runtime risk remains because validation was not run.

### 2026-06-23-14:15 Task slice 188

- Added a Phase 10 signoff blocker evidence gate to the requirements doc. The table separates Source/Kanban/Manage readiness and mount contracts, terminal clipboard and physical-key API blockers, Browser import/content-transfer/suspend decisions, and the Phase 9 validation ban.
- Made the placeholder rule harder to overclaim: placeholder-only Source, Kanban, and Manage paths stay until the corresponding real surface has explicit contract proof and running evidence, not just source-only assumptions or reconciled requirement notes.
- Updated the Phase 10 handoff plan to point cleanup/signoff work at the requirements evidence gate before retiring placeholder-only paths.
- Files touched: `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: shared instruction read, scoped status/progress reads, targeted Phase 10 blocker searches, touched-file status read, and timestamp capture. Raw command arguments were not copied into this durable entry.
- Verification skipped per explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: this was documentation-only. Final Phase 10 signoff remains blocked by real Source/Kanban/Manage readiness and mount contracts, terminal runtime clipboard and honest physical-key forwarding APIs, Browser import/content-transfer/suspend decisions, and the explicit ban on Phase 9 running-app validation.

### 2026-06-23-14:19 Task slice 189

- Performed a docs-only orchestration handoff cleanup for the GPUI workspace-area missing-parity plan.
- Updated the suggested orchestrator order and ground rules so future continuation runs exactly one worker at a time, with no parallel subagents or parallel read-only planning workers.
- Added guidance to give future workers larger bounded bundles when dependencies allow, while preserving phase order, privacy, no fallback/project-detection, non-overlap layout/input boundaries, and the current no-validation instruction.
- Kept blockers explicit: real Source/Kanban/Manage still require explicit readiness/mount contracts and running evidence, terminal runtime clipboard and physical-key APIs remain blockers or product decisions, Browser import/content-transfer/suspend decisions remain open, and Phase 9 visual/interaction validation remains blocked.
- Files touched: `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Verification skipped by explicit user instruction: no formatting, tests, checks, whitespace validation, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: this was documentation-only and does not change implementation or validation status. Real GPUI Source/Kanban/Manage, terminal API blockers, Browser runtime decisions, Phase 9 validation, and Phase 10 signoff remain unresolved.

### 2026-06-23-14:23 Task slice 190

- Implemented a bounded GPUI source-only terminal blocker hardening slice for runtime clipboard and physical-key forwarding parity.
- Hardened runtime clipboard boundaries so disabled Ghostty app-level callbacks remain no-op/false even with app-like or surface-like userdata, and app-thread drains deny queued reads and drop queued writes instead of authorizing GPUI clipboard access from focused terminal state alone.
- Added owner-local clipboard denial coverage that pending reads complete with empty data and writes do not invoke clipboard closures, without adding real runtime clipboard support, focus fallback routing, logging, persistence, app clipboard reads/writes, app launch, or visual automation.
- Tightened physical-key blocker comments and coverage so layout-only `KeyDownEvent` values without committed `key_char` remain rejected, and Control/platform physical-only cases stay blocked until GPUI exposes stable native keycode or UIEvents-code identity.
- Files touched: `gpui/src/main.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: shared instruction read, touched-file status reads, targeted GPUI source/progress reads, focused symbol searches, and timestamp capture. Raw command arguments were not copied into this durable entry.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run in this slice, so compile/test/runtime risk remains. Runtime clipboard is still blocked until a surface-scoped app-thread handoff proves requester identity, physical-key/binding forwarding still needs a stable native keycode or UIEvents-code identity, and broader Phase 10 signoff remains blocked by the existing real-surface, Browser, and validation gaps.

### 2026-06-23-14:28 Task slice 191

- Performed main-agent review cleanup for the terminal runtime clipboard blocker boundary in `gpui/src/main.rs`. Agents and command runtime clipboard drains now pass no-op closures and do not capture GPUI clipboard APIs while runtime clipboard is blocked.
- Kept denied runtime behavior unchanged: queued reads are denied through the owner-local surface completion path, queued writes are dropped, and no app clipboard read/write, focused-surface fallback, logging, persistence, app launch, or visual automation was added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: focused terminal clipboard source/test/progress reads and timestamp capture. Raw command arguments were not copied into this durable entry.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run in this cleanup slice, so compile/test/runtime risk remains. Runtime clipboard remains blocked until a surface-scoped app-thread handoff proves requester identity.

### 2026-06-23-14:30 Task slice 192

- Implemented a bounded GPUI source-only Phase 8 Browser runtime lifecycle and popup/content-transfer blocker hardening slice in `gpui/src/main.rs`.
- Tightened CDXC requirements comments around Browser hide-and-hold visibility, making clear that sleep, non-Browser mode, Browser tab drags, and command-tab drags only hide existing tab-owned CEF child views and must not imply CEF teardown, suspend, recreation, restored-surface materialization, shell-state writes, import, or popup content transfer.
- Hardened source-only Browser runtime policy coverage so HiddenHold has no visible CEF child view, RestoredPlaceholder applies only to active rendered loaded tabs without CEF surfaces while Browser is active and awake, inactive loaded tabs and address-only tabs stay HiddenHold, and empty popup targets do not create loaded or address-only tabs.
- Kept blank/script-created popup content transfer blocked: empty or whitespace popup targets still no-op without address-only fallback, notification, import, CEF surface creation, shell-state write, page-content copy, or transfer fallback, while non-empty targets are only trimmed as target identifiers before loaded-tab creation.
- Preserved Browser import as a fixed unsupported policy separate from popup and lifecycle decisions; no Browser import, blank-popup content transfer, CEF suspend/teardown, fallback address-only popup tabs, logs, persistence changes, app launch, visual automation, or regular macOS app edits were added.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: shared instruction read, touched-file status read, targeted GPUI Browser policy/test/progress source reads, and timestamp capture. Raw command arguments were not copied into this durable entry.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run in this slice, so compile/test/runtime risk remains. Real GPUI Browser import still needs a compatible importer requirement, script-created blank popup content transfer still needs an explicit safe transferable-content contract, and deeper CEF suspend/teardown remains deferred beyond hide-and-hold.

### 2026-06-23-14:36 Task slice 193

- Implemented a bounded GPUI source-only Phase 5 Source sleep/wake and readiness-blocker hardening slice in `gpui/src/main.rs`. Source readiness now has explicit missing/loading/ready/load-failed bridge states and blocker reasons while Source runtime identity remains separate from shell lifecycle.
- Added pure evidence that Source shell sleep/wake preserves the explicit Source runtime identity, loading/load-failed bridge blockers, project-editor companion state, and command-pane shell state without synthesizing readiness.
- Preserved boundaries: no Source/code-server/CEF mount, fallback localhost or project detection, real surface hide/suspend/wake, persistent logging, private project/workarea id persistence, paths, URLs, editor titles, command text, stdout/stderr, file contents, overlays, hidden hit regions, hit-test routing, app launch, visual automation, or regular macOS/native source edits were added.
- Updated Phase 5 docs/status so the Source sleep/wake status is named as source-only evidence while real Source remains blocked until explicit readiness/mount contracts and running evidence exist.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: shared instruction read, touched-file status read, timestamp capture, targeted GPUI Source/progress/doc reads, and focused source snippet reads. Raw command arguments were not copied into this durable entry.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run in this slice, so compile/test/runtime risk remains. Real GPUI Source still needs explicit readiness and normal child CEF/code-server mount contracts plus running evidence before replacing the placeholder or claiming real sleep/wake parity.

### 2026-06-23-14:41 Task slice 194

- Performed main-agent integration cleanup for the Phase 5 Source loading/load-failed blocker states in `gpui/src/main.rs`.
- Routed Source runtime availability through a Source-specific placeholder signature so loading and load-failed bridge blockers now show distinct static placeholder title/message copy while ready/default states keep the normal Source placeholder.
- Added source-only placeholder signature coverage proving the loading/load-failed copy is generic, private-detail-free, and non-mounting, and that ready/default Source blocker reasons do not replace the placeholder.
- Updated Phase 5 requirements/status docs to record this as blocker visibility only, not real Source parity or a readiness/mount substitute.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: focused Source placeholder/render/test/doc/progress reads and timestamp capture. Raw command arguments were not copied into this durable entry.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run in this slice, so compile/test/runtime risk remains. Real GPUI Source still needs explicit readiness and normal child CEF/code-server mount contracts plus running evidence before replacing the placeholder or claiming real Source sleep/wake or load-state parity.

### 2026-06-23-14:45 Task slice 195

- Implemented a bounded GPUI source-only Phase 6 Kanban sleep/wake and lifecycle-bridge blocker hardening slice in `gpui/src/main.rs`.
- Added pure evidence that shell-level Kanban sleep/wake preserves the explicit project/board runtime identity while mounting and load-failed CEF bridge states remain separate from shell lifecycle and do not synthesize readiness.
- Covered companion and command-pane preservation across Kanban sleep/wake by comparing shell state before and after lifecycle toggles, and kept privacy-boundary persisted evidence limited to safe enum/boolean shell facts.
- Updated Phase 6 docs/status so the Kanban evidence is documented as source-only blocker evidence, not real Kanban parity or a CEF readiness/mount substitute.
- Preserved boundaries: no real runtime behavior, CEF mount, CEF/browser work, fallback URL/project detection, persistent logging, private project/board id persistence, paths, URLs, titles, command text, stdout/stderr, overlays, hidden hit regions, hit-test routing, app launch, visual automation, or regular macOS/native source edits were added.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: shared instruction read, touched-file status read, timestamp capture, targeted GPUI Kanban/progress/doc reads, and focused source snippet reads. Raw command arguments were not copied into this durable entry.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run in this slice, so compile/test/runtime risk remains. Real GPUI Kanban still needs an explicit CEF readiness/mount contract plus running evidence before replacing the placeholder or claiming real sleep/wake parity.

### 2026-06-23-14:48 Task slice 196

- Implemented a bounded GPUI source-only Phase 7 Manage sleep/wake preservation cleanup in `gpui/src/main.rs`.
- Raised Manage to the Source/Kanban evidence bar: shell sleep/wake now has pure coverage that explicit project/workarea runtime identity, mounting/load-failed bridge blockers, companion layout state, and command-pane shell state survive lifecycle toggles without synthesizing readiness.
- Kept the evidence placeholder-only and privacy-boundary scoped: no CEF mount, file bridge mount, file I/O, fallback project or URL detection, persistent logging, private project/workarea id persistence, raw URLs, titles, command text, stdout/stderr, file contents, overlays, hidden hit regions, hit-test routing, app launch, visual automation, or regular macOS/native source edits were added.
- Updated Phase 7 and Phase 10 docs/status so Manage sleep/wake evidence is documented as source-only blocker evidence, not real Manage parity or a CEF/file-bridge readiness/mount substitute.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: shared instruction read, touched-file status read, timestamp capture, targeted GPUI Manage/progress/doc reads, focused source snippet reads, and source diff inspection. Raw command arguments were not copied into this durable entry.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run in this slice, so compile/test/runtime risk remains. Real GPUI Manage still needs explicit CEF plus file-bridge readiness/mount contracts and running evidence before replacing the placeholder or claiming real sleep/wake parity.

### 2026-06-23-14:52 Task slice 197

- Implemented a bounded GPUI source-only Phase 8 Browser sleep/wake hide-and-hold preservation evidence slice.
- Added pure coverage that Browser lifecycle sleep/wake preserves generated profile state, Browser tab/split shell state, companion layout state, and command-pane shell state while the visibility policy hides existing CEF surfaces through hide-and-hold.
- Kept deferred Browser gaps explicit: the evidence does not delete, suspend, recreate, or materialize CEF surfaces or restored tabs, and it does not add Browser import, blank-popup content transfer, fallback URLs, persistent logging, overlays, hidden hit regions, app launch, visual automation, or regular macOS/native source edits.
- Updated Phase 8 and Phase 10 docs/status so this is documented as source-only shell preservation evidence, not real Browser suspend/teardown parity.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: shared instruction read, touched-file status read, timestamp capture, targeted GPUI Browser/progress/doc reads, and focused source snippet reads. Raw command arguments were not copied into this durable entry.
- Verification skipped by explicit user instruction: no fmt, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run in this slice, so compile/test/runtime risk remains. Real GPUI Browser import still needs a compatible importer requirement, script-created blank popup content transfer still needs an explicit safe transferable-content contract, and deeper CEF suspend/teardown remains deferred beyond hide-and-hold.

### 2026-06-23-14:59 Task slice 198

- Performed a bounded docs-only Phase 10 blocker-map reconciliation after slices 193-197.
- Added handoff/status CDXC notes making clear that Source, Kanban, Manage, and Browser sleep/wake preservation evidence remains source-only blocker evidence, not real surface parity, runtime signoff, or Phase 9 validation.
- Files touched: `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: shared instruction read, scoped status/progress reads, targeted Phase 10 blocker searches, touched-file status read, and timestamp capture. Raw command arguments were not copied into this durable entry.
- Verification skipped by explicit user instruction: no formatting, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: this was reconciliation-only and does not mark Phase 10 complete. Real Source readiness/mount, Kanban CEF readiness/mount, Manage CEF plus file-bridge readiness/mount, terminal runtime clipboard and physical-key APIs/product decisions, Browser import, blank-popup content transfer, deeper CEF suspend/teardown, and Phase 9 validation remain blocked.

### 2026-06-23-15:02 Task slice 199

- Implemented a bounded source-only Phase 10 blocker-ledger bundle in `gpui/src/main.rs`.
- Added typed blocker areas, statuses, current source-only evidence, and missing signoff gates for Source readiness/mount, Kanban readiness/mount, Manage readiness/mount/file bridge, terminal runtime clipboard and physical-key blockers, Browser import/blank-popup/suspend decisions, and the Phase 9 validation ban.
- Added pure source-level coverage proving the ledger reports all current blockers, marks no blocked area complete, and keeps Source/Kanban/Manage/Browser sleep-wake evidence separate from real surface or runtime signoff gates.
- Updated the Phase 10 requirements and handoff docs to mention the source-level ledger as an executable guardrail only, without claiming parity or validation.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: shared instruction read, scoped status/progress reads, targeted source/doc searches, focused source/doc snippet reads, touched-file status read, and timestamp capture. Raw command arguments were not copied into this durable entry.
- Verification skipped by explicit user instruction: no formatting, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run in this slice, so compile/test/runtime risk remains. Real Source readiness/mount, Kanban CEF readiness/mount, Manage CEF plus file-bridge readiness/mount, terminal runtime clipboard and physical-key APIs/product decisions, Browser import, blank-popup content transfer, deeper CEF suspend/teardown, and Phase 9 validation remain blocked.

### 2026-06-23-15:12 Task slice 200

- Performed a bounded source/docs Phase 1 reconciliation after slice 199.
- Updated handoff and requirements status wording so the next orchestrator sees the current bridge state: the strict sidebar active-project bridge can carry explicit project context plus identity-only Source, Kanban, and gated Manage ids derived from the explicit project-editor identity.
- Kept the blocker boundary explicit. These ids are not readiness, URL, CEF, file-bridge, or mount contracts, and they do not unblock or accept the real Source, Kanban, or Manage surfaces.
- Refreshed the stale Rust project-snapshot CDXC comment that still described the snapshot as pre-bridge/future-id work. No runtime behavior changed, and the TypeScript bridge comment already matched the current identity-only boundary.
- Files touched: `docs/gpui-workspace-area-missing-parity-phases.md`, `docs/gpui-workspace-area-parity-requirements.md`, `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: shared instruction reads, scoped Phase 1/Phase 10 doc and progress reads, targeted bridge source/comment searches, focused source snippet reads, touched-file status reads, and timestamp capture. Raw command arguments were not copied into this durable entry.
- Verification skipped by explicit user instruction: no formatting, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run in this slice, so compile/test/runtime risk remains. Real Source readiness/mount, Kanban CEF readiness/mount, Manage CEF plus file-bridge readiness/mount, terminal runtime clipboard and physical-key APIs/product decisions, Browser import, blank-popup content transfer, deeper CEF suspend/teardown, and Phase 9 validation remain blocked.

### 2026-06-23-15:18 Task slice 201

- Implemented Phase 1 Browser surface-id contract hardening in `gpui/src/main.rs`.
- Removed Browser surface identity from the Rust active-project snapshot model and parser. The Phase 1 contract now accepts identity-only Source, Kanban, and gated Manage ids, while `browserWorkareaId` is rejected as an unexpected field even when Browser availability is true.
- Updated contract evidence so accepted active-project and privacy-boundary payloads no longer include Browser surface ids, and the rejection set covers the Browser-available `browserWorkareaId` case without adding TS bridge changes.
- Updated Phase 1 and Phase 10 docs/status to keep Browser identity/readiness on the blocker map and avoid claiming real Browser, Source, Kanban, or Manage parity.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: shared instruction reads, touched-file status reads, timestamp capture, targeted GPUI source/sidebar/doc/progress searches, and focused source/doc/progress snippet reads. Raw command arguments were not copied into this durable entry.
- Verification skipped by explicit user instruction: no formatting, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run in this slice, so compile/test/runtime risk remains. Browser identity/readiness still needs an explicit contract before any Browser surface id can enter the active-project snapshot. Real Source readiness/mount, Kanban CEF readiness/mount, Manage CEF plus file-bridge readiness/mount, terminal runtime clipboard and physical-key APIs/product decisions, Browser import, blank-popup content transfer, deeper CEF suspend/teardown, and Phase 9 validation remain blocked.

### 2026-06-23-15:22 Task slice 202

- Performed main-agent integration cleanup for the slice 201 Browser surface-id contract hardening.
- Updated the Phase 10 source-level blocker ledger so Browser active-project identity/readiness is an explicit missing gate alongside Browser import, blank-popup transfer, CEF suspend/teardown, privacy evidence, and running validation.
- Added source coverage that the Browser blocker remains incomplete while the identity/readiness gate is missing, so rejecting `browserWorkareaId` cannot be mistaken for Browser runtime signoff.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: focused source/doc/progress reads, touched-file status reads, targeted blocker-ledger searches, and timestamp capture. Raw command arguments were not copied into this durable entry.
- Verification skipped by explicit user instruction: no formatting, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run in this cleanup slice, so compile/test/runtime risk remains. Browser identity/readiness still needs an explicit contract, and real Source readiness/mount, Kanban CEF readiness/mount, Manage CEF plus file-bridge readiness/mount, terminal runtime clipboard and physical-key APIs/product decisions, Browser import, blank-popup content transfer, deeper CEF suspend/teardown, and Phase 9 validation remain blocked.

### 2026-06-23-15:25 Task slice 203

- Performed docs-only GPUI workspace parity reconciliation for moving out of Phase 1 source-only bridge work and updating Phase 2 terminal handoff status.
- Updated the missing-parity handoff so Phase 1 reflects the post-slice-202 source state: live strict active-project bridge, identity-only Source/Kanban/gated Manage ids, Browser id rejection, latest-valid snapshot preference over env fallback, malformed/duplicate payload protection, and titlebar availability/active-mode fallback source behavior are represented in source, while runtime verification and real readiness/mount contracts remain blockers.
- Updated Phase 2 terminal handoff language to record the source-side App-owned terminal host/native view/Ghostty surface pipeline for Agents visible running slots and command surfaces, all-visible rendered Agents leaves, runtime session registry, startup handoff, close/process-exit cleanup, focus mirroring, resize/frame reconciliation, input boundaries, and runtime-only privacy boundaries without claiming running-app parity.
- Reconciled Phase 10 requirements rows for Layout/sidebar and Terminal/command runtime so the table distinguishes source-only evidence from validation, Browser identity/readiness, Source/Kanban/Manage readiness/mount contracts, terminal runtime clipboard, and physical-key/binding blockers.
- Updated the progress-log constraint language so terminal rendering is no longer described as black-placeholder-only while placeholder paths remain required for unresolved terminal states.
- Files touched: `docs/gpui-workspace-area-missing-parity-phases.md`, `docs/gpui-workspace-area-parity-requirements.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: shared instruction read, touched-file status reads, timestamp capture, scoped docs/progress reads, and targeted GPUI progress/source searches. Raw command arguments were not copied into this durable entry.
- Verification skipped by explicit user instruction: no formatting, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: this was documentation/progress reconciliation only. Phase 1 is not runtime-verified; Browser identity/readiness remains a separate missing contract; real Source/Kanban/Manage readiness, mount, and Manage file-bridge contracts remain blocked; terminal runtime clipboard and physical-key/binding behavior remain unresolved blockers or product decisions; Phase 9 running-app validation remains blocked by instruction.

### 2026-06-23-15:31 Task slice 204

- Performed docs/progress-only reconciliation for Phase 3 Terminal Session Lifecycle and Phase 4 Command Terminal Runtime status.
- Updated the Phase 3 handoff so lifecycle work is no longer presented as wholly pending: process-local Agents runtime sessions, separation from shell `TerminalSessionId` values and mount slots, explicit startup launch payload boundaries, startup geometry/launch plans/hidden startup host/surface state, ready handoff into Running maps, retryable Failed placeholders without fallback success, mounted Running Agents close/process-exit cleanup, and shell-state privacy boundaries are documented as source-side status only.
- Kept Phase 3 blockers explicit: the real launch payload source/product contract, close-confirm UI/ABI, runtime clipboard handoff, physical-key/binding identity, wake/materialize scope, popped-out/reattach runtime behavior, and running-app validation remain unresolved or deferred.
- Updated the Phase 4 handoff so command runtime work is documented as source-side status: separate command host/native view/Ghostty pipeline, command-scoped body bounds, focus mirroring, command-only close request/confirmed close/process-exit cleanup, final-close collapse through the command model, command input boundaries, and Agents/startup map isolation.
- Kept Phase 4 blockers explicit: command launch payload policy, command status sources, runtime clipboard, physical-key/binding behavior, cross-surface runtime transfer decisions, and running-app validation remain pending.
- Reconciled the Phase 10 Terminal/Agents and Command pane runtime rows to mention the Phase 3/4 source-side lifecycle/runtime status and remaining blockers without claiming app verification or parity signoff.
- Files touched: `docs/gpui-workspace-area-missing-parity-phases.md`, `docs/gpui-workspace-area-parity-requirements.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: shared instruction read, touched-file status reads, scoped docs/progress reads, and targeted phase/status searches. Raw command arguments were not copied into this durable entry.
- Verification skipped by explicit user instruction: no formatting, tests, cargo check, typecheck, `bun test`, `git diff --check`, whitespace checks, `bun run start`, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: this was documentation/progress reconciliation only. Phase 3/4 remain unaccepted until the real launch payload and command status contracts, close-confirm UI/ABI, runtime clipboard handoff, physical-key/binding identity, and running-app evidence outside the current no-validation agent workflow are resolved; broader Source/Kanban/Manage, Browser, and Phase 9 blockers remain unchanged.

### 2026-06-23-15:37 Task slice 205

- Performed docs/progress-only reconciliation for Phase 5 Source, Phase 6 Kanban, and Phase 7 Manage as one larger source-only blocker handoff slice.
- Updated the missing-parity handoff so Source, Kanban, and Manage current status is explicit identity, lifecycle bridge state, static placeholder copy, privacy-boundary runtime JSON or decision-policy evidence, and shell sleep/wake preservation only, without presenting implementation signoff.
- Reconciled the Phase 10 Source/Kanban/Manage rows and blocker evidence to keep all three statuses `blocked pending explicit contract` and to name the remaining real Source CEF/code-server, Kanban CEF, Manage CEF/file-bridge, real hide/suspend/wake, placeholder replacement, and file-operation blockers.
- Preserved the no-fallback boundary: no fallback URLs, path probes, .git/project-name inference, synthetic readiness, runtime verification, source edits, regular macOS app edits, or validation work were added.
- Files touched: `docs/gpui-workspace-area-missing-parity-phases.md`, `docs/gpui-workspace-area-parity-requirements.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: shared instruction read, touched-file status read, timestamp capture, scoped Phase 5-7/Phase 10 docs and progress reads, and targeted phase/blocker searches. Raw command arguments were not copied into this durable entry.
- Verification skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo-based checks, whitespace checks, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: this was documentation/progress reconciliation only. Real GPUI Source needs explicit readiness and child CEF/code-server mount contracts; real Kanban needs an explicit CEF readiness/mount bridge; real Manage needs explicit CEF plus file-bridge readiness/mount contracts before replacing placeholders, performing file operations, or claiming real hide/suspend/wake parity. External running evidence remains required outside the current no-validation agent workflow.

### 2026-06-23-15:41 Task slice 206

- Performed docs/progress-only reconciliation for Phase 8 Browser runtime parity, Phase 9 validation handoff, and Phase 10 cleanup/signoff as one larger source-only blocker handoff slice.
- Updated the missing-parity handoff so Browser current source-only state records generated profile ids, active profile persistence, profile-owned tab/surface plumbing, beta-only Profile visibility, fixed unsupported import policy, feedback injection boundaries with GitHub disabled behavior, tab-owned CEF identity, hide-and-hold visibility, restored-placeholder rendering, popup target policy, shell sleep/wake preservation, and sanitized persistence without presenting runtime signoff.
- Reconciled the Phase 10 requirements Browser row, validation rows, and blocker evidence so Browser stays `implemented/source-only` and validation stays `not verified due user instruction`.
- Kept blockers explicit: Browser active-project identity/readiness has no contract and `browserWorkareaId` remains rejected; compatible import, blank-popup transferable content, deeper CEF suspend/teardown/materialization, Browser runtime/privacy evidence, and running validation blocked by persistent user instruction remain required before signoff.
- Files touched: `docs/gpui-workspace-area-missing-parity-phases.md`, `docs/gpui-workspace-area-parity-requirements.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: shared instruction read, touched-file status read, timestamp capture, scoped Phase 8-10 docs and progress reads, and targeted phase/status/blocker searches. Raw command arguments were not copied into this durable entry.
- Verification skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check, whitespace checks, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: this was documentation/progress reconciliation only. Final signoff remains blocked by real Source/Kanban/Manage readiness, mount, and file-bridge contracts; terminal runtime clipboard and physical-key blockers; Browser identity/import/content-transfer/suspend contracts; Browser runtime/privacy evidence; and the Phase 9 validation ban.

### 2026-06-23-15:44 Task slice 207

- Performed main-agent docs/progress cleanup to align the handoff with the user's persistent instruction to never run the validation/check step in this continuation.
- Updated Phase 9 and Phase 10 wording so formatting, tests, checks, typecheck, cargo check, whitespace checks, app launch/restart, browser automation, visual automation, and equivalent validation/app commands are not described as later queued agent work.
- Reframed running-app evidence as an external signoff blocker outside the current no-validation agent workflow while keeping Source/Kanban/Manage readiness, mount, and file-bridge contracts; terminal clipboard and physical-key blockers; and Browser identity/import/content-transfer/suspend blockers intact.
- Files touched: `docs/gpui-workspace-area-missing-parity-phases.md`, `docs/gpui-workspace-area-parity-requirements.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: scoped docs/progress searches, focused docs/progress snippet reads, touched-file status read, and timestamp capture. Raw command arguments were not copied into this durable entry.
- Verification skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check, whitespace checks, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: this was documentation/progress cleanup only. Final signoff remains blocked by real Source/Kanban/Manage readiness, mount, and file-bridge contracts; terminal runtime clipboard and physical-key blockers; Browser identity/import/content-transfer/suspend contracts; Browser runtime/privacy evidence; external running evidence; and the persistent Phase 9 validation ban.

### 2026-06-23-15:50 Task slice 208

- Cleaned up the source-level Phase 10 blocker ledger so Phase 9 and running-app evidence are represented as persistent external signoff blockers under the current no-validation agent workflow.
- Renamed stale validation-instruction/check-evidence gates to external running evidence, persistent no-validation agent-ban, and external validation/check evidence gates while preserving the `NotVerifiedDueInstruction` status and `ValidationSkippedByInstruction` evidence.
- Kept Source, Kanban, Manage, terminal, and Browser blocker semantics source-only and unchanged: explicit readiness/mount/file-bridge contracts, terminal clipboard and physical-key contracts, Browser identity/import/content-transfer/suspend/privacy gates, and external running evidence remain required before signoff.
- Review cleanup also aligned the Phase 10 missing-parity handoff sentence so it says external running evidence, not allowed validation.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: shared instruction read, touched-file status read, timestamp capture, scoped source/docs/progress reads, and targeted source/docs/progress searches. Raw command arguments were not copied into this durable entry.
- Verification skipped by persistent user instruction: no formatting, tests, checks, typecheck, cargo check, whitespace checks, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: final signoff remains blocked by real Source/Kanban/Manage readiness, mount, and file-bridge contracts; terminal runtime clipboard and physical-key blockers; Browser identity/import/content-transfer/suspend contracts; Browser runtime/privacy evidence; external running evidence; and the persistent no-validation agent ban.

### 2026-06-23-15:54 Task slice 209

- Reconciled Phase 3 Terminal Session Lifecycle docs with the current GPUI source evidence for explicit Agents placeholder activation.
- Documented that selecting sleeping, restored-unmounted, popped-out, and startup-failed Agents placeholders remains presentation-only, while activating the placeholder body/card is source-only shell evidence that moves those sessions to `Mounting` as wake/materialize/reattach/retry pending.
- Kept the acceptance boundary explicit: the source-only activation path does not fabricate `Running`, launch a process, mount libghostty, create terminal content, duplicate runtime sessions, persist runtime/private data, or prove real Ready success.
- Reconciled the Phase 10 Terminal/Agents runtime row, blocker evidence, and Sleeping/Mounting/Popped-Out requirements so real runtime wake/materialize/retry/reattach, popped-out reattach without duplicate runtime sessions, close-confirm UI/ABI proof, privacy evidence, and external running evidence remain blockers.
- Files touched: `docs/gpui-workspace-area-missing-parity-phases.md`, `docs/gpui-workspace-area-parity-requirements.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source inspected without edits: `gpui/src/main.rs` comments and pure source evidence around placeholder activation were already current, so no behavior or source-comment change was made.
- Read-only command categories used: shared instruction read, touched-file status read, timestamp capture, scoped source/docs/progress reads, and targeted source/docs/progress searches. Raw command arguments were not copied into this durable entry.
- Verification skipped by persistent user instruction: no formatting, tests, checks, typecheck, cargo check, whitespace checks, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: this was documentation/progress reconciliation only. Phase 3 still needs real runtime wake/materialize/retry/reattach, popped-out reattach without duplicated runtime sessions, close-confirm UI/ABI proof, privacy evidence, external running evidence, and eventual validation outside the current no-validation agent workflow before acceptance.

### 2026-06-23-15:58 Task slice 210

- Reconciled Phase 4 Command Terminal Runtime handoff around command launch and status source boundaries.
- Documented that command terminal surfaces are source-represented through a command-only host/native view/Ghostty pipeline with command-scoped body bounds, while the Ghostty launch request stays intentionally empty because no command launch payload policy/source exists yet.
- Documented that idle/working/attention/delayed-send command status is shell enum/boolean metadata for tab chrome and persistence only, not real process status and not a source for command text, cwd/env, stdout/stderr, terminal content, delayed-send deadlines, or launch data.
- Reconciled the Phase 10 Command pane runtime row so it names explicit launch payload, real command process/status source, close-confirm UI/ABI, runtime clipboard, physical-key identity, cross-surface runtime transfer, and external running-evidence blockers without claiming app verification.
- Files touched: `docs/gpui-workspace-area-missing-parity-phases.md`, `docs/gpui-workspace-area-parity-requirements.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source inspected without edits: `gpui/src/main.rs` comments and source evidence around command host sync, command tab status metadata, and shell-state privacy were already current.
- Read-only command categories used: shared instruction read, touched-file status read, timestamp capture, targeted GPUI source/doc/progress searches, and focused source/doc/progress snippet reads. Raw command arguments were not copied into this durable entry.
- Verification skipped by persistent user instruction: no formatting, tests, checks, typecheck, cargo check, whitespace checks, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: this was documentation/progress reconciliation only. Phase 4 still needs an explicit command launch payload contract/policy/source, real command process/status source, command close-confirm UI/ABI acceptance or proof, runtime clipboard handoff, physical-key identity contract, cross-surface runtime transfer decision, external running evidence, and eventual validation outside the current no-validation agent workflow before acceptance.

### 2026-06-23-16:02 Task slice 211

- Reconciled the cross-surface runtime transfer blocker across the GPUI parity docs/progress as one larger blocker-map slice covering Agents terminal runtime, Command pane terminal runtime, Browser, Source, Kanban, and Manage.
- Updated the Phase 10 requirements table and blocker evidence so cross-surface runtime transfer is a named deferred product decision, not hidden under command validation or Browser content-transfer wording.
- Documented the current source-only state consistently: title, identity, tab/group, card, and placeholder movement may be represented, but real runtime/process/content transfer stays blocked until explicit product and mount/runtime contracts exist.
- Preserved privacy boundaries: no transfer of Ghostty processes, CEF content, file-editor state, command payload/status, terminal buffers, clipboard callbacks, focus/key identity, private runtime data, user-owned content, paths, URLs, command text, stdout/stderr, tokens, cookies, or file contents is claimed.
- Files touched: `docs/gpui-workspace-area-missing-parity-phases.md`, `docs/gpui-workspace-area-parity-requirements.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source inspected without edits: `gpui/src/main.rs` comments around command-to-Agents and Agents-to-command transfer already stated visible-title/placeholder-only movement and rejected process/content/libghostty/CEF/code bridge transfer, so no source-comment or blocker-ledger edit was made.
- Read-only command categories used: shared instruction reads, touched-file status reads, scoped docs/progress reads, targeted source/doc/progress searches, source diff inspection, and focused source snippet reads. Raw command arguments were not copied into this durable entry.
- Verification skipped by persistent user instruction: no formatting, tests, checks, typecheck, cargo check, whitespace checks, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: this was documentation/progress reconciliation only. Cross-surface runtime/process/content transfer still needs an explicit product decision, per-surface mount/runtime contracts, privacy proof, external running evidence, and eventual validation outside the current no-validation agent workflow before it can be accepted.

### 2026-06-23-16:06 Task slice 212

- Aligned the source-level Phase 10 blocker ledger with the docs blocker table by adding explicit rows for Terminal lifecycle activation/reattach and Cross-surface runtime/process/content transfer.
- Added source-only ledger evidence for placeholder activation to `Mounting`, startup/Running handoff evidence, and shell-only title/identity/placeholder movement, while keeping these separate from real runtime wake, reattach, process/content transfer, privacy proof, and external running evidence.
- Updated nearby pure source assertions so the ledger order includes the new blocker areas and the missing gates cover real wake/materialize/retry/reattach contracts, popped-out no-duplicate proof, close-confirm UI/ABI proof, lifecycle privacy proof, product decision, per-surface mount/runtime contract, transfer privacy proof, and external running evidence.
- Updated the requirements and handoff docs to record slice 212 and state that the source-level ledger mirrors the Terminal lifecycle activation/reattach and Cross-surface runtime/process/content transfer blocker rows.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Read-only command categories used: shared instruction read, touched-file status read, timestamp capture, scoped source/docs/progress reads, and targeted source/docs/progress searches. Raw command arguments were not copied into this durable entry.
- Verification skipped by persistent user instruction: no formatting, tests, checks, typecheck, cargo check, whitespace checks, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining gaps: this was source-ledger and docs/progress alignment only. Terminal lifecycle still needs real runtime wake/materialize/retry/reattach, popped-out reattach without duplicate runtime sessions, close-confirm UI/ABI proof, lifecycle privacy proof, and external running evidence. Cross-surface runtime/process/content transfer still needs an explicit product decision, per-surface mount/runtime contracts, privacy proof, and external running evidence.

### 2026-06-23-16:10 Task slice 213

- Added a strict source-only GPUI Source readiness contract boundary in `gpui/src/main.rs`. The future message shape is v1 `ghostex.gpui.source.readiness` with only `activeProjectId`, `sourceWorkareaId`, and `state` (`loading`, `ready`, or `loadFailed`).
- Added a Source readiness store helper that updates `SourceWorkareaRuntimeState` only when the readiness identity exactly matches the current explicit active project/source identity. Stale project ids, stale source ids, Quick/projectless runtime state, malformed JSON, extra keys, unsupported states, and missing identity fields no-op or error without changing prior readiness.
- Kept readiness source-only. Ready availability remains evidence for the current explicit identity, but Source rendering still uses placeholders until a separate child CEF/code-server mount contract exists.
- Added pure source assertions for accepted strict payloads, rejected URL/path/code-server-shaped extra keys, malformed/extra-key/missing-identity payloads preserving prior runtime state, stale identity no-ops, Quick/projectless no-op behavior, privacy-safe runtime JSON, and Ready-to-placeholder signature behavior.
- Updated Phase 5 and Phase 10 docs to record that slice 213 adds no real Source mount, no code-server URL payload, no CEF creation, no logging or persistence of private details, no fallback localhost/path probing, and no placeholder replacement.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: shared instructions, touched-file status, existing Source runtime identity/readiness state, Source render placeholder path, active-project snapshot parser/store helpers, Source runtime privacy tests, Phase 5/10 docs, and recent progress entries.
- Verification skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run, so compile/test/runtime risk remains. Real GPUI Source still needs a separate child CEF/code-server mount contract, safe external bridge hookup into readiness, real hide/suspend/wake behavior, placeholder replacement proof, and external running evidence outside the current no-validation agent workflow.

### 2026-06-23-16:17 Task slice 214

- Added a strict source-only GPUI Kanban/Manage readiness contract boundary in `gpui/src/main.rs`. The future message shape is v1 `ghostex.gpui.projectWorkarea.readiness` with only `surface` (`kanban` or `manage`), `activeProjectId`, `surfaceId`, and `state` (`mounting`, `ready`, or `loadFailed`).
- Added a project-workarea readiness store helper that updates `ProjectScopedRealSurfaceRuntimeState` only when the message surface, active project id, and surface id exactly match the current explicit runtime identity. Stale project ids, stale surface ids, wrong surface kind, Quick/projectless or no-active runtime state, malformed JSON, extra keys, unsupported states/surfaces, and missing identity fields no-op or error without changing prior lifecycle state.
- Kept readiness source-only. Ready availability remains evidence for the current explicit Kanban/Manage identity, but Kanban and Manage rendering still use placeholders until separate Kanban CEF, Manage CEF, and Manage file-bridge mount contracts exist.
- Added pure source assertions for accepted strict Kanban/Manage payloads, rejected private keys (`url`, `path`, `fileName`, `fileContents`, `error`, and failure details), malformed/extra-key/missing-identity payloads preserving prior runtime state, stale identity no-ops, Quick/projectless no-op behavior, privacy-safe runtime JSON, and Ready-to-placeholder signature behavior.
- Updated Phase 6/7 and Phase 10 docs to record that slice 214 adds no real Kanban/Manage mount, no CEF/file-bridge creation, no file bridge or file I/O, no URLs/paths/file details/failure details, no logging or persistence of private details, no fallback probing, and no placeholder replacement.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: shared instructions, touched-file status, existing Source readiness parser/store pattern, `ProjectScopedRealSurfaceRuntimeState`, `ProjectScopedRealSurfaceKind`, `ProjectScopedRealSurfaceLifecycleBridgeState`, Kanban/Manage runtime privacy JSON, Kanban/Manage placeholder signature paths, Phase 6/7/10 docs, and recent progress entries.
- Verification skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run, so compile/test/runtime risk remains. Real GPUI Kanban still needs a separate CEF readiness/mount bridge, real hide/suspend/wake behavior, placeholder replacement proof, and external running evidence. Real GPUI Manage still needs separate CEF plus file-bridge readiness/mount contracts, real file-operation proof, real hide/suspend/wake behavior, placeholder replacement proof, and external running evidence outside the current no-validation agent workflow.

### 2026-06-23-16:24 Task slice 215

- Added a strict source-only GPUI Browser active-project/readiness contract boundary in `gpui/src/main.rs`. The future message shape is v1 `ghostex.gpui.browserWorkarea.readiness` with only `activeProjectId`, `browserWorkareaId`, and `state` (`loading`, `ready`, or `loadFailed`).
- Added a Browser readiness store helper that updates `BrowserWorkareaRuntimeState` only when the message active project id and Browser workarea id exactly match the current explicit Browser identity held by source-only runtime state. Stale project ids, stale Browser ids, Quick/projectless or no-active runtime state, malformed JSON, extra keys, unsupported states, and missing identity fields no-op or error without changing prior readiness state.
- Kept Phase 1 strict: `browserWorkareaId` remains rejected in the active-project snapshot. The Browser readiness boundary is separate source evidence, not a snapshot field, CEF mount/materialization contract, tab/profile/popup creation path, import path, or placeholder replacement.
- Added pure source assertions for accepted strict Browser payloads, rejected private keys and malformed payloads preserving prior runtime state, stale/no-active/Quick behavior, Phase 1 Browser-id rejection, privacy-safe runtime JSON, and evidence that Ready does not alter existing Browser CEF visibility/materialization policy.
- Updated Phase 8 and Phase 10 docs to record that slice 215 adds no real Browser bridge, no CEF creation/materialization/suspend/teardown, no Browser tab/profile/popup creation, no import or content transfer, no URLs/paths/titles/profile/cookie/history/import content/failure details, no logging or persistence of private details, no fallback probing, and no validation.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: shared instructions, touched-file status, existing Source readiness parser/store pattern, existing Kanban/Manage readiness parser/store pattern, Phase 1 active-project snapshot rejection tests, Browser CEF hide-and-hold/restored-placeholder policy helpers, Phase 8/10 docs, and recent progress entries.
- Verification skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run, so compile/test/runtime risk remains. Real GPUI Browser still needs a safe external identity/readiness bridge into the strict boundary, Browser runtime/privacy evidence, compatible import/product requirements, blank-popup transferable-content contract, deeper CEF suspend/teardown/materialization decisions, and external running evidence outside the current no-validation agent workflow.

### 2026-06-23-16:35 Task slice 216

- Added a strict source-only GPUI Manage file/workarea operation request contract boundary in `gpui/src/main.rs`. The future message shape is v1 `ghostex.gpui.manageFileWorkarea.operationRequest` with only `activeProjectId`, `manageWorkspaceId`, and an operation-name string.
- Added a Manage operation request store helper that records only the existing privacy-safe allowlist decision when the message active project id and Manage workspace id exactly match the current explicit Manage runtime identity. Stale project ids, stale workspace ids, Quick/projectless or no-active runtime state, wrong-surface runtime state, malformed JSON, extra keys, private-shaped operation values, and missing identity fields no-op or error without changing prior decision state.
- Kept request handling source-only. Accepted requests do not mark the Manage lifecycle bridge ready, do not replace the Manage placeholder, do not execute file operations, and do not mount CEF or file bridges.
- Added pure source assertions for accepted strict request payloads, malformed/extra-key/private-shaped payload rejection preserving prior state, stale/no-active/Quick/wrong-surface behavior, privacy JSON omitting ids/paths/file names/file contents/tokens/credentials/cookies/stdout/stderr/raw payloads, and evidence that accepted requests keep Manage readiness and placeholders blocked.
- Updated Phase 7 and Phase 10 docs to record that slice 216 adds no real Manage bridge, no file I/O, no CEF/file-bridge mount, no args/paths/file names/file contents/URLs/tokens/cookies/credentials/env/stdout/stderr/failure details/raw payloads/CEF state/bridge payloads, no logging or persistence of private details, no fallback probing, no placeholder replacement, and no validation.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: shared instructions, touched-file status, existing Manage operation allowlist policy, existing Kanban/Manage readiness parser/store pattern, `ProjectScopedRealSurfaceRuntimeState` and identity handling, Manage placeholder signature path, Phase 7/10 docs, and recent progress entries.
- Verification skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run, so compile/test/runtime risk remains. Real GPUI Manage still needs explicit CEF plus file-bridge readiness/mount contracts, project-scoped file-operation proof through the real bridge, real hide/suspend/wake behavior, placeholder replacement proof, privacy proof, and external running evidence outside the current no-validation agent workflow.

### 2026-06-23-16:46 Task slice 217

- Added a source-only Phase 4 command launch payload boundary in `gpui/src/main.rs`. `CommandTerminalLaunchPayloadSource` is runtime-only, empty in production, and keyed by exact `CommandTerminalBodyMountSlotId` plus the derived command runtime id.
- Wired command Ghostty config-request preparation to consult that boundary. Empty production source keeps current command requests payload-less; exact future explicit payloads may attach only after Ghostty launch-payload validation; invalid explicit payloads suppress/prune the config request instead of inferring launch data.
- Kept the boundary inert: no real command process/status source was implemented, no command text/cwd/env/initial input/wait policy/delayed-send deadline is inferred, and titles, status labels, project/workspace data, paths, stdout/stderr, terminal content, helper detection, runtime ids, Ghostty handles, and raw payload values are not logged or persisted.
- Added focused pure source assertions for empty-source behavior, exact-key attachment, stale slot/runtime mismatch, invalid payload pruning without raw leakage, and command shell-state JSON omitting source/helper names plus private payload samples.
- Updated Phase 4 and Phase 10 docs to record that this slice adds only the explicit source boundary. The remaining launch blocker is now the real product contract/policy/producer plus real command process/status behavior, not a fallback parser.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: shared instructions, existing Agents startup payload-source pattern, command mount slot/runtime id helpers, command host/native view/Ghostty config-request path, command shell-state serializer, existing startup payload-source tests, Phase 4 docs, and recent progress entries.
- Verification skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run, so compile/test/runtime risk remains. Phase 4 still needs the real command launch payload product contract/policy/producer, a real command process/status source, command close-confirm UI/ABI acceptance or proof, runtime clipboard handoff, physical-key identity contract, cross-surface runtime transfer decision, privacy proof, and external running evidence outside the current no-validation agent workflow.

### 2026-06-23-16:54 Task slice 218

- Reconciled the Phase 5 Source real-mount blocker ledger as a source/docs progress slice only. Source readiness parser/store evidence is now recorded as source-only current evidence, while the missing gates remain a safe external bridge, separate child CEF/code-server mount contract, real hide/suspend/wake proof, placeholder replacement proof, and external running evidence.
- Updated the Phase 10 requirements and missing-parity handoff to state that Phase 5 is blocked at the real mount step and only non-dependent work may proceed until the external bridge and child CEF/code-server mount contract exist.
- Preserved the no-fallback boundary: no URL/path/code-server payload expansion, localhost probing, project-name or `.git` inference, logging, persistence of private details, CEF creation, placeholder replacement, synthetic mount state, or Source CEF/code-server implementation was added.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: shared instructions, touched-file status, Source runtime identity/readiness state, strict Source readiness parser/store, Source placeholder render path, Phase 10 blocker ledger enums and assertions, Phase 5/10 docs, and recent progress entries.
- Verification skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run, so compile/test/runtime risk remains. Real GPUI Source still needs a safe external bridge into readiness, a separate child CEF/code-server mount contract, real hide/suspend/wake behavior, placeholder replacement proof, privacy proof, and external running evidence outside the current no-validation agent workflow.

### 2026-06-23-16:59 Task slice 219

- Reconciled the Phase 6 Kanban real-CEF blocker ledger as a source/docs progress slice only. Kanban project-workarea readiness parser/store evidence is now recorded as source-only current evidence, while the missing gates are separated into a safe external readiness bridge, CEF mount contract, placeholder replacement proof, real hide/suspend/wake proof, and external running evidence.
- Updated the Phase 10 requirements and missing-parity handoff to state that Phase 6 is blocked at the real CEF mount step and only non-dependent work may proceed until the external bridge and CEF mount contract exist.
- Preserved the no-fallback/no-implementation boundary: no URL/path/CEF payload expansion, fallback probes, project-name or `.git` inference, logging, persistence of private details, CEF creation, hidden surface creation, placeholder replacement, synthetic mount state, or Kanban CEF implementation was added.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: shared instructions, touched-file status, `ProjectScopedRealSurfaceRuntimeState`, strict project-workarea readiness parser/store, Kanban lifecycle bridge states, Kanban placeholder signature path, Phase 10 blocker ledger enums and assertions, Phase 6/10 docs, and recent progress entries.
- Verification skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run, so compile/test/runtime risk remains. Real GPUI Kanban still needs a safe external bridge into readiness, a separate CEF mount contract, real hide/suspend/wake behavior, placeholder replacement proof, privacy proof, and external running evidence outside the current no-validation agent workflow.

### 2026-06-23-17:09 Task slice 220

- Reconciled the Phase 7 Manage real CEF plus file-bridge blocker ledger as a source/docs/progress-only slice. Manage project-workarea readiness parser/store, lifecycle bridge states, operation request parser/store, operation allowlist, and sleep/wake preservation are now recorded as source-only current evidence only.
- Split the Manage missing gates into a safe external readiness bridge, normal CEF mount contract, separate file-bridge mount contract, placeholder replacement proof, project-scoped file-operation proof through the real bridge, real surface sleep/wake proof, file-bridge privacy proof, and external running evidence.
- Updated the Phase 10 requirements and missing-parity handoff to state that Phase 7 is blocked at the real Manage CEF plus file-bridge mount step, and only non-dependent reconciliation work may proceed until those gates exist.
- Preserved the no-fallback/no-implementation boundary: no URL/path/file payload expansion, fallback probes, project-name or `.git` inference, logging, persistence of private details, CEF creation, file-bridge creation, file I/O, placeholder replacement, synthetic mount state, or Manage surface implementation was added.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: shared and repository instructions, touched-file status, Phase 10 blocker ledger enums and assertions, strict project-workarea readiness parser/store evidence, Manage lifecycle bridge state evidence, Manage operation request parser/store evidence, Manage operation allowlist policy evidence, Phase 7/10 docs, and recent progress entries.
- Verification skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run, so compile/test/runtime risk remains. Real GPUI Manage still needs a safe external bridge into readiness, a normal CEF mount contract, a separate file-bridge mount contract, placeholder replacement proof, project-scoped file-operation proof through the real bridge, real hide/suspend/wake behavior, file-bridge privacy proof, and external running evidence outside the current no-validation agent workflow.

### 2026-06-23-17:15 Task slice 221

- Reconciled the Phase 8 Browser runtime blockers and Phase 10 Browser blocker ledger as a source/docs/progress-only slice.
- Split the Browser current evidence in `gpui/src/main.rs` into source-only profile/tab shell state, feedback injection boundary, active-project/readiness parser/store, unsupported import policy, blank-popup no-op policy, restored-placeholder/materialization no-op, hide-and-hold sleep/wake, and sanitized persistence boundary.
- Split the Browser missing gates into a safe external identity/readiness bridge into the strict helper, explicit Phase 1 `browserWorkareaId` product contract, compatible import product/importer requirement, blank-popup transferable-content contract, CEF materialization/suspend/teardown decision or proof, runtime privacy proof, and external running evidence.
- Updated Phase 8 and Phase 10 docs to state that source-only Browser state is evidence only and does not implement CEF mount/materialization, import, popup transfer, profile creation changes, feedback injection changes, logging, persistence, fallback probes, placeholder replacement, or broader message contracts.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: shared and repository instructions, touched-file status, Phase 10 blocker ledger enums and Browser assertions, strict Browser active-project/readiness parser/store evidence, Phase 1 `browserWorkareaId` rejection evidence, Browser profile/tab shell state evidence, feedback injection boundary evidence, unsupported import notification evidence, blank-popup no-op policy evidence, restored-placeholder and hide-and-hold policy evidence, sanitized Browser persistence evidence, Phase 8/10 docs, and recent progress entries.
- Verification skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run, so compile/test/runtime risk remains. Real GPUI Browser still needs a safe external identity/readiness bridge into the strict helper, a Phase 1 `browserWorkareaId` product contract, compatible import product/importer requirement, blank-popup transferable-content contract, explicit CEF materialization/suspend/teardown decision or proof, Browser runtime privacy proof, and external running evidence outside the current no-validation agent workflow.

### 2026-06-23-17:19 Task slice 222

- Reconciled the Phase 10 Terminal lifecycle activation/reattach and Terminal clipboard/physical-key blocker ledger as a source/docs/progress-only slice.
- Expanded the Terminal lifecycle current evidence in `gpui/src/main.rs` to distinguish source-only Agents host/native-view/Ghostty pipeline evidence, all-visible Agents mount slots, placeholder activation to `Mounting`, startup handoff, close/process-exit cleanup, focus/resize/input boundaries, source-only close-confirm state, and runtime-only privacy boundaries.
- Expanded the Terminal clipboard/physical-key current evidence to distinguish source-only command runtime isolation, command host/native-view/Ghostty pipeline evidence, runtime-only privacy boundaries, denied clipboard drain/no-op behavior, and committed-text-only key handling without native physical-key identity.
- Renamed the terminal missing gates so the blockers stay explicit: real runtime wake/materialize/retry/reattach contract, popped-out no-duplicate reattach proof, close-confirm UI/ABI proof, lifecycle privacy proof, surface-scoped app-thread clipboard handoff, native physical-key identity contract, terminal/command mac parity or accepted product decision, and external running evidence.
- Updated nearby pure source assertions so both terminal rows prove the expanded current evidence is source-only and remains blocked by missing runtime/API/product/evidence gates.
- Updated Phase 3, Phase 4, and Phase 10 docs to record the same evidence as blocker-ledger evidence only, not terminal runtime signoff, and preserved command launch/status blockers, cross-surface runtime transfer blockers, Browser/Source/Kanban/Manage blockers, and the Phase 9 validation ban.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: shared and repository instructions, touched-file status, Phase 10 blocker ledger enums and terminal assertions, existing Agents terminal host/native-view/Ghostty pipeline and all-visible mount-slot evidence, startup handoff evidence, close/process-exit cleanup evidence, focus/resize/input boundary evidence, command terminal runtime isolation and host/native-view/Ghostty evidence, runtime clipboard drain denied/no-op evidence, committed-text-only key boundary evidence, close-confirm source state, Phase 3/4/10 docs, and recent progress entries.
- Verification skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run, so compile/test/runtime risk remains. Terminal lifecycle still needs a real runtime wake/materialize/retry/reattach contract, popped-out reattach proof without duplicate runtime sessions, close-confirm UI/ABI proof, terminal lifecycle privacy proof, and external running evidence. Terminal clipboard and physical-key parity still need a surface-scoped app-thread clipboard handoff, native physical-key identity contract, terminal/command mac parity or accepted product decision, and external running evidence outside the current no-validation agent workflow.

### 2026-06-23-17:25 Task slice 223

- Reconciled the Phase 10 cross-surface runtime/process/content transfer blocker ledger as a source/docs/progress-only slice.
- Split the cross-surface current evidence in `gpui/src/main.rs` into source-only Agents/command visible-title placeholder movement, tab/group/card shell movement, identity-only Source/Kanban/gated Manage movement, Browser profile/tab shell identity preservation, and the explicit no-runtime-transfer privacy boundary.
- Split the cross-surface missing gates into an allowed-transfer-family product decision, per-source/per-target mount/runtime contracts, terminal runtime/process transfer contract if ever allowed, Browser CEF content transfer contract if ever allowed, Source file-editor/runtime transfer contract if ever allowed, Kanban/Manage CEF/file-bridge transfer contracts if ever allowed, runtime transfer privacy proof, and external running evidence.
- Updated nearby pure source assertions so the cross-surface row proves the expanded current evidence is source-only and remains deferred by missing product/mount/runtime/privacy/running-evidence gates.
- Updated Phase 4 and Phase 10 docs to record the same shell-only movement categories as evidence only, while preserving terminal, Browser, Source, Kanban, Manage, command launch/status, and Phase 9 validation blockers.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: shared and repository instructions, touched-file status, Phase 10 blocker ledger enums and cross-surface assertions, Phase 4 command cross-surface handoff notes, Phase 10 cross-surface blocker rows, requirements table cross-surface row, missing-parity Phase 4/10 handoff sections, and recent progress entries.
- Verification skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run, so compile/test/runtime risk remains. Cross-surface runtime/process/content transfer still needs the allowed-transfer-family product decision, per-source/per-target mount/runtime contracts, family-specific terminal/Browser/Source/Kanban/Manage transfer contracts if any family is allowed, runtime transfer privacy proof, and external running evidence outside the current no-validation agent workflow.

### 2026-06-23-17:30 Task slice 224

- Performed a consolidated handoff/status refresh after slices 218-223. This was documentation/progress-only and did not implement real surface, runtime transfer, clipboard, physical-key, Browser import, popup transfer, CEF lifecycle, file bridge, or validation behavior.
- Updated the missing-parity current status and suggested orchestrator order so the queue now points at real terminal runtime/API blockers, Source external bridge plus child CEF/code-server mount, Kanban external bridge plus CEF mount, Manage external bridge plus CEF/file bridge, Browser external bridge/product decisions/CEF lifecycle, cross-surface product/mount/runtime/privacy gates, and Phase 9 external evidence outside the no-validation workflow.
- Added consolidated CDXC handoff notes stating that slices 218-223 split source-only evidence from missing real gates, and that further source-only ledger splitting should not be treated as the main queue unless a concrete mismatch is found.
- Files touched: `docs/gpui-workspace-area-missing-parity-phases.md`, `docs/gpui-workspace-area-parity-requirements.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source/docs evidence inspected: shared and repository instructions, target docs/progress status sections, recent progress entries for slices 216-223, dirty-worktree status, and source-level Phase 10 blocker ledger comments covering Source, Kanban, Manage, Browser, Terminal lifecycle/input, and cross-surface transfer.
- Validation skipped by explicit user instruction: no formatting, tests, checks, typecheck, Rust formatting/check/test commands, whitespace checks, app launch/restart, browser/visual automation, or equivalent validation/app commands were run.
- Remaining blockers: real Source needs the safe external bridge, child CEF/code-server mount, placeholder replacement, hide/suspend/wake, privacy, and external running evidence; real Kanban needs the external bridge, CEF mount, placeholder replacement, hide/suspend/wake, privacy, and external evidence; real Manage needs the external bridge, CEF mount, file-bridge mount, project-scoped file-operation proof, placeholder replacement, hide/suspend/wake, privacy, and external evidence; terminal lifecycle/input still needs real wake/reattach, popped-out no-duplicate proof, close-confirm UI/ABI, lifecycle privacy, app-thread clipboard, native physical-key identity or accepted product difference, and external evidence; Browser still needs the external identity/readiness bridge, Phase 1 browserWorkareaId product contract, import/popup/CEF lifecycle decisions, privacy proof, and external evidence; cross-surface transfer still needs allowed-family product decisions, per-surface mount/runtime contracts, family-specific transfer contracts, privacy proof, and external evidence; Phase 9 remains blocked by the persistent no-validation instruction.

### 2026-06-23-17:36 Task slice 225

- Reconciled the Terminal lifecycle blocker map around startup metadata/readiness/failure/handoff evidence as a source/docs/progress-only slice.
- Updated `gpui/src/main.rs` so the Phase 10 Terminal lifecycle ledger names runtime-only startup Ghostty metadata readiness/failure snapshots, readiness handoff plans, process-exited failure results, and startup host/surface ownership transfer into Running maps as current source evidence.
- Split the former broad Terminal lifecycle missing gate into narrower sleeping wake/materialize, restored materialization, startup-failed retry beyond source-only activation, and popped-out reattach runtime gates, while preserving popped-out no-duplicate proof, close-confirm UI/ABI, lifecycle privacy proof, and external running evidence blockers.
- Updated nearby pure source assertions so the new startup evidence is proven source-only/runtime-only and the missing gates still keep Terminal lifecycle incomplete.
- Updated `docs/gpui-workspace-area-parity-requirements.md` and `docs/gpui-workspace-area-missing-parity-phases.md` so they no longer imply startup metadata handoff is wholly absent, while still stating it is not app-verified and does not clear remaining lifecycle/API/privacy/evidence blockers.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: shared and repository instructions, touched-file status, `AgentsTerminalStartupCoordinator`, startup Ghostty metadata snapshot preparation, `produce_failed_startup_result_from_surface_metadata`, `startup_readiness_handoff_plans`, `transfer_ready_agents_terminal_startup_handoff`, Phase 10 blocker ledger enums/assertions, Phase 2/3/10 handoff docs, and recent progress entries.
- Validation skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining blockers: Terminal lifecycle is not complete. Sleeping wake/materialize, restored materialization, startup-failed retry beyond source-only activation, popped-out reattach/no-duplicate proof, close-confirm UI/ABI proof, lifecycle privacy proof, and external running evidence remain blocked. Terminal clipboard and physical-key parity still need a surface-scoped app-thread clipboard handoff, native physical-key identity contract, terminal/command parity or accepted product decision, and external running evidence.

### 2026-06-23-17:44 Task slice 226

- Reconciled Terminal close-confirm evidence versus the still-missing confirm path as a source/docs/progress-only slice.
- Split the Phase 10 Terminal lifecycle close-confirm ledger in `gpui/src/main.rs` into source-only request-close pending callback handling, exact pending identity tracking, cancel handling, confirmed callback cleanup, Agents/command isolation, and privacy-boundary evidence.
- Split the close-confirm missing gate into a UI surface contract, GhosttyKit confirm-close ABI, and app/runtime acceptance proof, and updated nearby pure source assertions so those gates keep Terminal lifecycle blocked.
- Updated `docs/gpui-workspace-area-parity-requirements.md` and `docs/gpui-workspace-area-missing-parity-phases.md` so they credit the runtime-only callback/pending/cancel/confirmed-cleanup evidence without implying user-facing close-confirm parity or fake shell removal.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: shared and repository instructions, touched-file status, `AgentsTerminalCloseConfirmState`, `CommandTerminalCloseConfirmState`, `confirm_pending_agents_terminal_close`, `confirm_pending_command_terminal_close`, `cancel_pending_agents_terminal_close`, `cancel_pending_command_terminal_close`, confirmed-close consumption helpers, confirmation-needed sync/prune paths, Phase 10 blocker ledger enums/assertions, Phase 2/3/4/10 docs, and recent progress entries.
- Validation skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining blockers: Terminal lifecycle is not complete. Close-confirm still needs a real UI surface contract, GhosttyKit confirm-close ABI, app/runtime acceptance proof, and external running evidence; sleeping wake/materialize, restored materialization, startup-failed retry beyond source-only activation, popped-out reattach/no-duplicate proof, lifecycle privacy proof, runtime clipboard handoff, native physical-key identity, and terminal/command parity or accepted product decision also remain blocked.

### 2026-06-23-17:51 Task slice 227

- Reconciled Terminal clipboard and physical-key evidence versus the remaining runtime callback/API blockers as a source/docs/progress-only slice.
- Split the Phase 10 `TerminalClipboardPhysicalKeys` current evidence in `gpui/src/main.rs` into explicit-string Cmd+V paste, no file-path clipboard synthesis, runtime clipboard requester identity absence, denied runtime clipboard drain/no-op behavior, committed `key_char` forwarding, IME/preedit text-service delivery, and layout-only/no-native-physical-key rejection boundaries, while keeping Agents/command mounted-pipeline and privacy evidence source-only.
- Updated nearby Phase 10 assertions so the expanded evidence is classified as source-only and the row remains blocked by the surface-scoped app-thread runtime clipboard handoff, native physical-key identity contract, terminal/command parity or accepted product decision, and external running-evidence gates.
- Updated `docs/gpui-workspace-area-parity-requirements.md` and `docs/gpui-workspace-area-missing-parity-phases.md` to credit explicit app paste plus committed text/IME evidence without implying runtime clipboard callbacks, app-thread requester identity, native physical-key forwarding, or macOS input parity are complete.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: shared and repository instructions, dirty-worktree status, `terminal_clipboard_explicit_string_text`, `paste_into_focused_terminal_from_clipboard`, Agents and command runtime clipboard drains, `committed_terminal_text_from_key_down_event`, focused terminal text byte forwarding helpers, IME/preedit text-service helpers, Phase 10 blocker ledger enums/assertions, Phase 2/3/4/10 docs, and recent progress entries.
- Validation skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining blockers: runtime clipboard callbacks still need a surface-scoped app-thread requester handoff before Ghostty callbacks can read or write the app clipboard; physical-key/binding parity still needs a native keycode or UIEvents-code identity contract or an accepted terminal/command product difference; terminal/command input still needs external running evidence outside the current no-validation workflow.

### 2026-06-23-18:00 Task slice 228

- Implemented a concrete GPUI terminal activation/runtime guard so `Mounting` no longer always means "eligible for new startup".
- Added runtime-only startup eligibility to Agents terminal sessions. New terminal `Mounting` sessions and in-process failed-startup retry remain eligible for startup candidate discovery, while sleeping, restored-unmounted, popped-out placeholder activation, and restored shell-state `mounting` move or return to `Mounting` UI state without entering the hidden startup host/surface path.
- Updated startup candidate and startup body-slot discovery to use the eligibility guard, preventing blocked wake/materialize/reattach activations from accidentally creating a new Ghostty startup pipeline or duplicating a popped-out runtime.
- Added pure source coverage for the guard: sleeping/restored/popped-out activation and restored shell-state `mounting` produce no startup candidates or startup body slots, while startup-failed retry still produces one startup candidate.
- Updated the Phase 10 source ledger and requirements/missing-parity docs so the guard is credited as source evidence without clearing real sleeping wake/materialize, restored materialization, popped-out reattach/no-duplicate proof, close-confirm UI/ABI/app acceptance, lifecycle privacy proof, external running evidence, runtime clipboard handoff, or native physical-key blockers.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: terminal presentation states, placeholder activation, startup candidate discovery, startup body-slot discovery, startup coordinator sync, startup host/surface handoff paths, Phase 10 ledger assertions, parity requirements, missing-parity handoff, and recent progress entries.
- Validation skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining blockers: Terminal lifecycle is not complete. Real sleeping wake/materialize, restored materialization, popped-out reattach/no-duplicate runtime proof, failed-startup retry running evidence, close-confirm UI surface, GhosttyKit confirm-close ABI, app/runtime acceptance proof, lifecycle privacy proof, external running evidence, runtime clipboard handoff, native physical-key identity, and terminal/command parity or accepted product decision remain blocked.

### 2026-06-23-18:12 Task slice 229

- Reviewed and completed the restored-mounting startup-eligibility continuation as a source/docs/progress-only slice. No runtime behavior, fallback startup path, logging, persistence, or terminal content handling was added.
- Kept restored shell-state `presentationState:"mounting"` documented and asserted as presentation-only/non-startup-eligible because shell JSON intentionally does not persist whether Mounting came from new startup, failed retry, wake, materialize, or reattach.
- Preserved startup eligibility for new terminal `Mounting` sessions and in-process failed-startup retry through runtime-only transitions. Startup candidate and startup body-slot discovery remain gated by `TerminalSession::can_enter_startup_pipeline`.
- Updated the source comments, Phase 10 handoff comments, requirements table, and missing-parity handoff so slice 229 is distinct from slice 228 and does not overclaim real wake/materialize/reattach, duplicate-proof, privacy, close-confirm, or runtime acceptance.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: `TerminalSession::startup_eligible_when_mounting`, `TerminalSession::can_enter_startup_pipeline`, `terminal_session_from_shell_state`, visible selected Mounting startup candidate discovery, startup body-slot discovery, startup coordinator sync references, `agents_workspace_shell_state_round_trip_preserves_layout_without_terminal_content`, Phase 10 ledger comments/assertions, parity requirements, missing-parity handoff, and slice 228 progress wording.
- Validation skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining blockers: Terminal lifecycle is not complete. Real sleeping wake/materialize, restored materialization, failed-startup retry running evidence, popped-out reattach/no-duplicate proof, close-confirm UI surface, GhosttyKit confirm-close ABI, app/runtime acceptance proof, lifecycle privacy proof, external running evidence, runtime clipboard handoff, native physical-key identity, and terminal/command parity or accepted product decision remain blocked.

### 2026-06-23-18:19 Task slice 230

- Implemented source-only failed-startup retry attempt identity rotation for the GPUI Agents terminal runtime path.
- Added a process-local runtime registry rotation method and routed explicit `StartupFailed` placeholder activation through an app/runtime helper that rotates only after the same durable shell session becomes startup-eligible `Mounting`. The durable `TerminalSessionId`, tab, title, and presentation flow remain unchanged.
- Preserved non-startup activation behavior: sleeping, restored-unmounted, and popped-out placeholders can move to `Mounting` without becoming startup candidates, launch plans, completion intents, or retry runtime-attempt rotations.
- Added pure source coverage for retry rotation before startup sync/intent, non-startup placeholder activation preserving runtime identity and empty startup maps, and shell-state persistence omitting the new runtime-id rotation/helper names.
- Updated Phase 10 source ledger, requirements, and missing-parity docs to credit retry-attempt identity evidence while keeping real failed-startup retry running evidence, app/runtime acceptance, lifecycle privacy proof, and external running evidence blocked.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: shared and repository instructions, dirty-worktree status, runtime registry, placeholder activation, startup candidate/launch-plan/intent sync, shell-state omission tests, Phase 10 terminal lifecycle ledger assertions, requirements docs, missing-parity handoff, and slice 228/229 progress wording.
- Validation skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining blockers: Terminal lifecycle is not complete. Real failed-startup retry running evidence, sleeping wake/materialize, restored materialization, popped-out reattach/no-duplicate proof, close-confirm UI surface, GhosttyKit confirm-close ABI, app/runtime acceptance proof, lifecycle privacy proof, external running evidence, runtime clipboard handoff, native physical-key identity, and terminal/command parity or accepted product decision remain blocked.

### 2026-06-23-18:29 Task slice 231

- Implemented the GPUI sidebar-scoped safe external workarea bridge as source-only evidence. The existing private `window.ghostexGpui.postActiveProjectContext(json)` remains, and the sidebar namespace now has fixed one-string functions for Source readiness, Browser readiness, Kanban/Manage project-workarea readiness, and Manage file/workarea operation requests.
- Kept the bridge sidebar-only and allowlisted: ordinary Browser CEF clients still pass no sidebar bridge handler, receive no `window.ghostexGpui` bridge install path, and cannot choose arbitrary message names. CEF only classifies the private event kind and payload string; strict JSON parsing remains in the GPUI stores.
- Routed typed sidebar bridge events in `gpui/src/main.rs` into the existing strict stores. Source, Kanban/Manage, and Manage operation requests notify only on `Changed`; malformed, stale, duplicate, missing-identity, or private-shaped payloads no-op. Browser readiness is routed through its strict store but still has no invented Browser workarea identity because Phase 1 continues to reject `browserWorkareaId`.
- Updated source-only coverage for allowlisted/sidebar-scoped CEF bridge functions, typed event construction, bridge-install gating, strict store routing, private-shaped payload rejection, and Browser no-identity no-op behavior. Tests were added as source only and were not run.
- Updated Phase 10 ledger/docs/progress to credit the sidebar-scoped safe external bridge into strict readiness/operation stores while keeping Source CEF/code-server mount, Kanban/Manage CEF/file-bridge mounts, Browser identity/product contract, placeholder replacement, privacy proof, Phase 9 validation, and external running evidence blocked.
- Files touched: `gpui/src/cef/macos.rs`, `gpui/src/cef/unsupported.rs`, `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: shared and repository instructions, dirty-worktree status, sidebar CEF renderer/browser process bridge, unsupported CEF API surface, `CefSurface` construction for sidebar versus Browser clients, strict Source/Browser/project-workarea readiness stores, strict Manage operation request store, Phase 10 blocker ledger assertions, parity requirements docs, missing-parity handoff, and recent progress entries.
- Validation skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining blockers: real Source still needs child CEF/code-server mount, placeholder replacement proof, real hide/suspend/wake proof, privacy proof, and external running evidence; real Kanban still needs CEF mount, placeholder replacement proof, real hide/suspend/wake proof, privacy proof, and external running evidence; real Manage still needs CEF mount, file-bridge mount, project-scoped file-operation proof through the real bridge, placeholder replacement proof, real hide/suspend/wake proof, file-bridge privacy proof, and external running evidence; Browser still needs the explicit `browserWorkareaId` product contract, import/content-transfer/CEF materialization/suspend/teardown decisions, privacy proof, and external evidence; terminal lifecycle/input, cross-surface transfer, and Phase 9 validation blockers remain as previously documented.

### 2026-06-23-18:48 Task slice 232

- Inspected the GPUI Source boundary first. Source still has strict source-only readiness/bridge evidence, but no explicit child CEF/code-server mount contract carrying privacy-safe URL/profile data, so Source readiness and mount behavior were left unchanged.
- Implemented a source-side terminal close-confirm UI surface contract in `gpui/src/main.rs`. Pending Agents confirmations render only with the Agents workspace leaf that owns the exact current pending slot; pending command confirmations render only with the command pane leaf that owns the exact current pending slot.
- Kept the surface privacy-safe and honest: it uses generic copy, shows no session names, terminal titles, command text, paths, URLs, stdout/stderr, terminal content, or raw ids, wires Keep Open to the existing cancel path, and keeps the close/confirm action unavailable until GhosttyKit exposes confirm-close ABI. No fake shell removal was added.
- Added pure source signature coverage for generic/family-scoped close-confirm copy, Keep Open labeling, disabled confirm state, ABI tooltip, and private-example omission. Tests were added as source only and were not run.
- Updated Phase 10 ledger/docs/progress to credit only the source-side UI surface contract while keeping GhosttyKit confirm-close ABI, app/runtime acceptance proof, lifecycle privacy proof, external running evidence, Source/Kanban/Manage real-surface gates, Browser runtime/product gates, cross-surface transfer, clipboard, physical-key, and Phase 9 validation blockers.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: shared and repository instructions, dirty-worktree status, Source readiness/mount boundary tests and comments, Agents and command close-confirm state/cancel/confirm helpers, exact current pending slot handling, workspace and command leaf render paths, Phase 10 blocker ledger assertions, parity requirements docs, missing-parity handoff, and recent progress entries.
- Validation skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining blockers: real Source still needs child CEF/code-server mount, placeholder replacement proof, real hide/suspend/wake proof, privacy proof, and external running evidence. Terminal close-confirm still needs GhosttyKit confirm-close ABI, app/runtime acceptance proof, lifecycle privacy proof, and external running evidence; terminal sleeping wake/materialize, restored materialization, failed-startup retry running evidence, popped-out reattach/no-duplicate proof, runtime clipboard handoff, native physical-key identity, terminal/command parity or accepted product decision, cross-surface transfer, Browser runtime/product decisions, and Phase 9 validation remain blocked.

### 2026-06-23-19:07 Task slice 233

- Implemented the source-side terminal runtime clipboard handoff for mounted GPUI Ghostty surfaces in `gpui/src/main.rs`.
- Switched both Agents and command runtime clipboard drains from denied/no-op behavior to exact still-mounted owner handoff: current map keys are snapshotted, each current owner is re-fetched on the app thread, standard clipboard is authorized only for queued owner-local requests, reads use the explicit-string-only clipboard boundary, and writes wrap only runtime-provided text in a string ClipboardItem.
- Kept selection clipboard unsupported, avoided focus-as-requester identity, and added no persistent logs, persistence, private clipboard inspection, file-path synthesis, fallback routing, hit-test overrides, overlays, or hidden hit regions.
- Updated the Phase 10 source ledger and pure source assertions so `TerminalClipboardPhysicalKeys` now credits `SourceOnlyTerminalSurfaceScopedAppThreadRuntimeClipboardHandoff` and no longer lists the surface-scoped app-thread clipboard handoff as a missing gate.
- Added pure source helper coverage for explicit-string runtime reads and runtime-text-only writes without windows, terminal surfaces, app launches, real clipboard access, logs, or persistence. Tests were added as source only and were not run.
- Updated `docs/gpui-workspace-area-parity-requirements.md` and `docs/gpui-workspace-area-missing-parity-phases.md` to credit only the source-side standard clipboard handoff while keeping app/runtime acceptance, runtime clipboard running evidence, native physical-key identity, terminal/command parity or accepted product decision, lifecycle blockers, external running evidence, and Phase 9 validation blocked.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: shared and repository instructions, dirty-worktree status, `terminal_clipboard_explicit_string_text`, Agents and command runtime clipboard drain functions, `GhosttySurfaceOwner::drain_runtime_clipboard_requests`, GPUI ClipboardItem/read/write API shape, Phase 10 blocker ledger enums/assertions, Phase 2/3/4/10 docs, and recent progress entries.
- Validation skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining blockers: Terminal clipboard handoff still needs app/runtime acceptance and external running evidence outside the no-validation workflow. Native physical-key identity, terminal/command parity or accepted product decision, terminal sleeping wake/materialize, restored materialization, failed-startup retry running evidence, popped-out reattach/no-duplicate proof, GhosttyKit confirm-close ABI, lifecycle privacy proof, cross-surface transfer, Browser runtime/product decisions, real Source/Kanban/Manage mount gates, and Phase 9 validation remain blocked.

### 2026-06-23-19:19 Task slice 234

- Hardened the Phase 1 TypeScript active-project surface-id boundary so Browser workarea identity cannot be added through the exported payload type/helper. The exported surface-id type now rejects `browserWorkareaId`, and the helper constructs only Source, Kanban, and gated Manage ids for active-project payloads.
- Preserved existing behavior: valid project payloads still carry Source and Kanban identity, add Manage identity only when the strict Manage gates are open, keep Browser availability separate from Browser identity, and Quick/projectless payloads keep empty surface ids.
- Added source-only test assertions that helper-built and generated project payloads omit `browserWorkareaId`, including when Browser availability is true and Manage is enabled, plus a compile-time style guard proving a Browser id shape is not assignable to the exported surface-id type.
- Updated the Phase 1 parity docs to record this as TypeScript/Rust boundary hardening only, not validation, Browser identity product acceptance, or Browser readiness/mount parity.
- Files touched: `gpui/sidebar/phase1-active-project-context.ts`, `gpui/sidebar/phase1-active-project-context.test.ts`, `docs/gpui-workspace-area-missing-parity-phases.md`, `docs/gpui-workspace-area-parity-requirements.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: shared and repository instructions, active-project TypeScript payload helper, active-project TypeScript tests, Phase 1 missing-parity handoff, Phase 10 requirements table, Browser readiness separation notes, and recent progress entries.
- Validation skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining blockers: no validation commands were run, so compile/test/runtime risk remains. Browser identity/readiness stays separate from Phase 1 and still needs an explicit product contract before `browserWorkareaId` can ever be accepted in active-project snapshots; real Source/Kanban/Manage mount gates, Browser runtime/product decisions, terminal lifecycle/input acceptance, cross-surface transfer, and Phase 9 validation remain blocked as previously documented.

### 2026-06-23-19:26 Task slice 235

- Implemented the source-side restored-unmounted terminal materialization startup contract in `gpui/src/main.rs`. Explicit restored placeholder activation now becomes startup-eligible `Mounting` through the existing startup candidate/body-slot/launch-plan/completion-intent path, while tab selection alone remains presentation-only.
- Preserved the runtime-attempt identity boundary: failed-startup retry still rotates the process-local runtime id before retry startup sync/intent; restored-unmounted materialization keeps the current process-local runtime id for the durable shell session; sleeping wake and popped-out reattach remain non-startup-eligible and do not create startup maps.
- Kept restored shell-state `presentationState:"mounting"` presentation-only after restart, because shell JSON still does not persist startup eligibility or runtime attempt identity.
- Updated the Phase 10 source ledger and parity docs to credit only source-side restored-unmounted materialization via the startup pipeline, replacing the broad restored runtime-contract missing gate with a narrower restored running/app-acceptance evidence gate. Sleeping wake/materialize, popped-out reattach/no-duplicate, failed-startup retry running evidence, GhosttyKit confirm-close ABI, app/runtime acceptance, lifecycle privacy, external running evidence, runtime clipboard running evidence, physical-key identity, and Phase 9 validation remain blocked.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: shared and repository instructions, dirty-worktree status, `TerminalSessionPresentationState::activation_pending_state`, `WorkspaceModel::activate_terminal_placeholder_session`, `TerminalSession::set_presentation_state_with_startup_eligibility`, startup candidate/body-slot helpers, runtime-attempt identity helper, startup coordinator sync helpers, restored shell-state restore boundary, Phase 10 blocker ledger enums/assertions, Phase 2/3/10 docs, and recent progress entries.
- Validation skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining blockers: no validation commands were run, so compile/test/runtime risk remains. Terminal lifecycle still needs real sleeping wake/materialize, restored materialization running/app acceptance evidence beyond the source-side startup contract, failed-startup retry running evidence, popped-out reattach/no-duplicate proof, GhosttyKit confirm-close ABI, app/runtime acceptance proof, lifecycle privacy proof, external running evidence, runtime clipboard running evidence, native physical-key identity, and terminal/command parity or accepted product decisions. Real Source/Kanban/Manage mount gates, Browser runtime/product decisions, cross-surface transfer, and Phase 9 validation also remain blocked.

### 2026-06-23-19:41 Task slice 236

- Implemented the source-side runtime parked-owner contract for Agents terminal Sleeping wake and PoppedOutPlaceholder reattach.
- Added runtime-only parked owner maps and visible body-geometry capture for non-startup `Mounting` Agents placeholders. A Running Agents terminal can park its existing AppKit host view plus Ghostty surface owner when presentation becomes Sleeping or PoppedOutPlaceholder, and explicit placeholder activation can rekey that exact owner to the current Agents body mount slot and geometry.
- Kept wake/reattach out of startup: no startup candidates, startup body slots, launch plans, completion intents, runtime id rotation, fallback surface creation, hidden startup hosts, or fake Ready/Running occur unless the exact parked owner, durable shell session, process-local runtime id, pane/session slot, and current geometry match.
- Preserved duplicate-ownership safety in source: parking removes the owner from running host/native view and Ghostty surface maps; reattach removes it from the parked map and inserts it exactly once into running maps. Wrong runtime/session/slot, missing geometry, stale parked owners, or running-map collisions are rejected and leave the shell honestly Mounting except for pruning impossible stale parked entries.
- Kept restored-unmounted materialization on the slice 235 startup path and kept failed-startup retry runtime id rotation unchanged. Sleeping and popped-out activation remain non-startup-eligible.
- Added pure source coverage for exact parked-owner transfer without Ghostty surface recreation/free, runtime id preservation, map uniqueness, wrong runtime/slot rejection, and collision rejection. Tests were added as source only and were not run.
- Updated Phase 10 ledger/docs/progress to credit only source-side sleeping/popped-out parked-owner reattach evidence, replacing the broad sleeping/popped-out source missing gates with narrower running/app acceptance evidence gates. Restored running/app acceptance, failed-startup retry running evidence, GhosttyKit confirm-close ABI, app/runtime acceptance, lifecycle privacy, external running evidence, runtime clipboard running evidence, native physical-key identity, terminal/command product decision, and Phase 9 validation remain blocked.
- Files touched: `gpui/src/main.rs`, `gpui/src/terminal_native_view.rs`, `gpui/src/terminal_ghostty_surface.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: shared and repository instructions, dirty-worktree status, Agents terminal presentation states, startup eligibility guards, placeholder activation helpers, runtime registry, startup coordinator sync path, running host/native view maps, running Ghostty surface maps, native host ownership transfer patterns, Ghostty surface owner transfer patterns, Phase 10 blocker ledger enums/assertions, Phase 2/3/10 docs, and recent progress entries.
- Validation skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining blockers: no validation commands were run, so compile/test/runtime risk remains. Terminal lifecycle still needs sleeping wake and popped-out reattach running/app acceptance evidence for the source-side parked-owner contract, restored materialization running/app acceptance evidence beyond the source-side startup contract, failed-startup retry running evidence, GhosttyKit confirm-close ABI, app/runtime acceptance proof, lifecycle privacy proof, external running evidence, runtime clipboard running evidence, native physical-key identity, and terminal/command parity or accepted product decisions. Real Source/Kanban/Manage mount gates, Browser runtime/product decisions, cross-surface transfer, and Phase 9 validation also remain blocked.

### 2026-06-23-20:04 Task slice 237

- Implemented source-side GhosttyKit close-confirm ABI evidence for GPUI using the real embedded `ghostty_surface_needs_confirm_quit(ghostty_surface_t) -> bool` symbol.
- Bound the query in `gpui/src/ghostty_kit.rs` and `gpui/src/terminal_ghostty_surface.rs`, added a surface-owner boolean wrapper, and updated fake/test function tables without exposing process ids, tty names, commands, paths, runtime ids, or terminal content.
- Replaced the disabled close-confirm action with an enabled generic Close Terminal action for exact pending Agents and command surfaces. Confirm validates the pending state, current slot, runtime identity, mounted owner, and `needs_confirm_quit`, then removes only that exact shell/session through the existing model close path and clears the matching prompt. Keep Open remains the cancel path.
- Review follow-up kept Agents confirmation-needed sync on an immutable workspace borrow and made direct user confirmation mirror the callback close path side effects: Agents runtime ids reconcile, surviving focus/scroll state is restored, command focus falls back when the command pane empties, and shell layout persistence runs after exact model removal.
- Updated Phase 10 ledger/docs/progress to credit only source-side `needs_confirm_quit` ABI evidence plus exact confirmed shell/session removal. App/runtime acceptance proof, lifecycle privacy proof, external running evidence, runtime clipboard running evidence, native physical-key identity, terminal/command product decisions, real Source/Kanban/Manage mount gates, Browser runtime/product decisions, cross-surface transfer, and Phase 9 validation remain blocked.
- Files touched: `gpui/src/ghostty_kit.rs`, `gpui/src/terminal_ghostty_surface.rs`, `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: shared and repository instructions, dirty-worktree status, embedded GhosttyKit header declaration, upstream Swift `needsConfirmQuit`/`requestClose` behavior, GPUI GhosttyKit FFI/function table, Agents and command close-confirm state/render helpers, Phase 10 blocker ledger assertions, parity requirements docs, missing-parity handoff, and recent progress entries.
- Validation skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining blockers: no validation commands were run, so compile/test/runtime risk remains. Terminal lifecycle still needs sleeping wake and popped-out reattach running/app acceptance evidence for the source-side parked-owner contract, restored materialization running/app acceptance evidence beyond the source-side startup contract, failed-startup retry running evidence, app/runtime acceptance proof, lifecycle privacy proof, external running evidence, runtime clipboard running evidence, native physical-key identity, and terminal/command parity or accepted product decisions. Real Source/Kanban/Manage mount gates, Browser runtime/product decisions, cross-surface transfer, and Phase 9 validation also remain blocked.

### 2026-06-23-20:22 Task slice 238

<!--
CDXC:GPUIWorkspaceParityHandoff 2026-06-23-20:22:
This continuation re-audits Phase 1 and the current Phase 10 blocker ledger under the persistent no-validation workflow. Phase 1 active-project/sidebar state is source-complete enough to hand off; remaining meaningful work requires explicit product decisions, mount/runtime contracts, app/runtime acceptance evidence, privacy proof, or external running evidence, not more source-only ledger splitting.
-->

- Re-read Phase 1, the current orchestrator queue, recent progress, and the Phase 10 blocker ledger after slice 237.
- Confirmed Phase 1 still has no safe source-only continuation: Browser identity remains intentionally outside the active-project snapshot pending a product contract; real Source/Kanban/Manage surfaces remain blocked by explicit child CEF/file-bridge mount contracts and running evidence; the no-validation instruction still blocks fmt/tests/checks/app/runtime visual evidence.
- Rechecked likely non-dependent terminal work. Physical-key parity remains blocked because the GPUI app-level key event boundary exposes committed/layout text but not a stable native keycode or UIEvents-code identity. Source/Kanban/Manage/Browser/runtime-transfer work remains blocked by the documented mount/runtime/product contracts rather than a code-only gap.
- No worker was spawned for this audit because the current queue allows more source/docs work only for a concrete mismatch, and no concrete non-dependent source slice was identified. This is not a final blocked-goal decision; it records the current blocker state for the next continuation.
- Files touched: `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: `docs/gpui-workspace-area-missing-parity-phases.md`, `docs/gpui-workspace-area-parity-requirements.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`, Phase 10 blocker ledger enums/assertions in `gpui/src/main.rs`, terminal key-event source comments/helpers, and targeted Source/Kanban/Manage/Browser blocker references.
- Validation skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining blockers: next meaningful progress needs one of the missing explicit contracts or evidence sources: real Source child CEF/code-server mount contract, Kanban CEF mount contract, Manage CEF plus file-bridge contracts, Browser identity/import/content-transfer/CEF lifecycle product decisions, native physical-key identity or accepted terminal/command product difference, cross-surface transfer product/runtime contracts, or external running/validation evidence outside the current no-validation workflow.

### 2026-06-23-20:44 Task slice 239

<!--
CDXC:GPUIWorkspaceParity 2026-06-23-20:44:
This slice updates the GPUI parity source ledger and docs for the user's product decisions: accepted source/runtime evidence may satisfy source-ledger parity, terminal is accepted as working for that ledger, and Kanban/Manage must target CEF web-surface contracts.
-->

- Reclassified Phase 10 source-ledger policy so source-only runtime parity evidence may count when it matches current source/runtime contracts, while blockers remain for explicit missing contracts, product/API decisions, and forbidden validation/external evidence.
- Updated the Phase 10 source ledger in `gpui/src/main.rs`: Kanban and Manage future web-surface gates now use CEF mount contracts, cross-surface transfer names Kanban/Manage CEF/file-bridge contracts, terminal lifecycle evidence is accepted for the source-ledger purpose, and terminal clipboard/physical-key blockers now keep only physical-key identity plus terminal/command product acceptance as the remaining terminal-specific gaps.
- Updated parity requirements and missing-parity docs so future work targets Source CEF/code-server, Kanban CEF, Manage CEF, the separate Manage file bridge, Browser product/runtime decisions, cross-surface product/runtime decisions, physical-key identity/product acceptance, and validation/external evidence where still required.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run, so compile/test/runtime risk remains. Real Source still needs the CEF/code-server mount contract. Real Kanban needs a CEF mount contract. Real Manage needs CEF plus file-bridge contracts and real project-scoped file-operation proof. Browser still needs identity/import/content-transfer/CEF lifecycle product decisions. Cross-surface transfer still needs product/runtime contracts. Terminal physical-key identity needs a native identity contract or accepted product difference.

### 2026-06-23-21:28 Task slice 240

<!--
CDXC:GPUIProjectWorkareaParity 2026-06-23-21:28:
This review follow-up removes stale platform-specific web-surface wording from current GPUI Kanban/Manage source-ledger contracts. Kanban and Manage web panes target CEF, while Manage file bridging stays a separate contract and no real CEF mount implementation is claimed by this source-only slice.
-->

- Reviewed slice 239 and found stale project-scoped Kanban/Manage runtime block-reason names, comments, tests, and docs that still used the old platform-specific web-surface wording after the CEF product decision.
- Renamed the remaining GPUI project-scoped lifecycle blocker variants in `gpui/src/main.rs` to CEF terms: missing Kanban CEF bridge, missing Manage CEF/file bridge, Kanban CEF mounting/load-failed, and Manage CEF/file-bridge mounting/load-failed.
- Updated placeholder copy, CDXC comments, source-only tests, requirements docs, missing-parity docs, and older progress shorthand so current Kanban/Manage contracts consistently target CEF for web panes and keep Manage file bridge separate.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: slice 239 worker output, current dirty-worktree status for scoped files, targeted project-scoped runtime blocker references, Kanban/Manage readiness and lifecycle comments/tests, parity requirements rows, missing-parity handoff, and latest progress entries.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run, so compile/test/runtime risk remains. Real Source still needs a CEF/code-server mount contract. Real Kanban still needs a CEF mount contract and placeholder replacement proof. Real Manage still needs CEF plus file-bridge contracts, placeholder replacement proof, real project-scoped file-operation proof, and privacy proof. Browser product/runtime decisions, cross-surface runtime-transfer contracts, terminal native physical-key identity/product acceptance, and the global no-validation/external-evidence gap remain.

### 2026-06-23-21:32 Task slice 241

<!--
CDXC:GPUIKanbanCefMount 2026-06-23-21:32:
This source-only Phase 6 slice adds the Kanban CEF mount-request boundary keyed to the exact current Kanban runtime identity, while keeping real CEF materialization blocked because no explicit first-party bundled Kanban entrypoint exists in GPUI-owned source.
-->

- Added a strict source-side Kanban CEF mount request contract in `gpui/src/main.rs`. Runtime-ready Kanban can now form an in-memory request from the exact active project plus Kanban surface identity, but the request resolves to `missingFirstPartyEntrypoint` and cannot materialize CEF.
- Kept the Kanban render path placeholder-only. It constructs the source-side request boundary from current availability, but does not create CEF, load or synthesize a URL, create a hidden surface, probe localhost, use fixtures/fallbacks, or replace the visible placeholder.
- Added source-only assertions for the request boundary, privacy-safe summaries, blocked non-ready Kanban, and wrong-surface Manage rejection. These were added only as source; they were not run.
- Updated Phase 6 and Phase 10 docs/progress to record the new request boundary, the missing first-party entrypoint state, and the remaining real mount blockers.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: existing project-workarea readiness/lifecycle runtime state, Kanban placeholder render path, Browser CEF surface creation shape, sidebar bundle resolution, GPUI Vite/sidebar bundle entries, targeted GPUI-owned Kanban searches, Phase 6 handoff docs, requirements rows, and latest progress slices 239-240.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run, so compile/test/runtime risk remains. Real Kanban still needs an explicit first-party bundled entrypoint, a real CEF materialization path, placeholder replacement proof, real hide/suspend/wake proof, and running evidence. Real Source still needs CEF/code-server mounting. Real Manage still needs CEF plus file-bridge contracts, placeholder replacement proof, project-scoped file-operation proof, and privacy proof. Browser product/runtime decisions, cross-surface runtime-transfer contracts, terminal native physical-key identity/product acceptance, and the global no-validation/external-evidence gap remain.

### 2026-06-23-21:36 Task slice 242

<!--
CDXC:GPUIManageCefMount 2026-06-23-21:36:
This source-only Phase 7 slice adds the Manage CEF mount-request boundary keyed to the exact current Manage runtime identity, while keeping real CEF and file-bridge materialization blocked because no explicit first-party bundled Manage entrypoint or file-bridge mount contract exists in GPUI-owned source.
-->

- Added a strict source-side Manage CEF mount request contract in `gpui/src/main.rs`. Runtime-ready Manage can now form an in-memory request from the exact active project plus Manage surface identity, with separate typed states for `missingFirstPartyEntrypoint` and `missingFileBridgeMountContract`.
- Kept the Manage render path placeholder-only. It constructs the source-side request boundary from current availability, but does not create CEF, load or synthesize a URL, create a file bridge, create a hidden surface, probe localhost, use fixtures/fallbacks, run file I/O, or replace the visible placeholder.
- Added source-only assertions for the Manage request boundary, privacy-safe summaries, blocked non-ready Manage, wrong-surface Kanban rejection, and Phase 10 ledger evidence. These were added only as source; they were not run.
- Updated Phase 7 and Phase 10 docs/progress to record the new request boundary, the missing first-party entrypoint state, the separate missing file-bridge mount state, and the remaining real mount/file-operation blockers.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: existing project-workarea readiness/lifecycle runtime state, Manage operation-request boundary, Manage placeholder render path, Kanban CEF mount-request slice shape, Browser/Sidebar CEF bundle shape, GPUI-owned Manage searches, Phase 7 handoff docs, requirements rows, and latest progress slices 240-241.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run, so compile/test/runtime risk remains. Real Manage still needs an explicit first-party bundled entrypoint, a real CEF materialization path, a separate real file-bridge mount contract, placeholder replacement proof, project-scoped file-operation proof through the real bridge, real hide/suspend/wake proof, privacy proof, and running evidence. Real Source still needs CEF/code-server mounting. Real Kanban still needs first-party entrypoint/materialization, placeholder replacement, real hide/suspend/wake, and running evidence. Browser product/runtime decisions, cross-surface runtime-transfer contracts, terminal native physical-key identity/product acceptance, and the global no-validation/external-evidence gap remain.

### 2026-06-23-21:43 Task slice 243

<!--
CDXC:GPUISourceCefCodeServerMount 2026-06-23-21:43:
This source-only Phase 5 slice adds the Source CEF/code-server mount-request boundary keyed to the exact current Source runtime identity, while keeping real CEF/code-server materialization blocked because no explicit first-party code-server entrypoint, process contract, URL contract, or CEF materialization contract exists in GPUI-owned source.
-->

- Added a strict source-side Source CEF/code-server mount request contract in `gpui/src/main.rs`. Runtime-ready Source can now form an in-memory request from the exact active project plus Source workarea identity, with separate typed states for `missingFirstPartyEntrypoint`, `missingCodeServerProcessContract`, `missingCodeServerUrlContract`, and `missingCefCodeServerMaterializationContract`.
- Kept the Source render path placeholder-only. It constructs the source-side request boundary from current availability, but does not create CEF, start code-server, load or synthesize a URL, create a hidden surface, probe localhost, use paths/project names/.git/fixtures/fallbacks, log or persist private data, or replace the visible placeholder.
- Added source-only assertions for the Source request boundary, privacy-safe summaries, blocked non-ready Source, and Phase 10 ledger evidence. These were added only as source; they were not run.
- Updated Phase 5 and Phase 10 docs/progress to record the new request boundary, the missing first-party entrypoint, process, URL, and materialization states, and the remaining real mount blockers.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Source evidence inspected: existing Source readiness runtime state, Source placeholder render path, Kanban and Manage CEF mount-request slice shapes, targeted GPUI-owned code-server/Source searches, Phase 5 handoff docs, requirements rows, and latest progress slices 241-242.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: no validation commands were run, so compile/test/runtime risk remains. Real Source still needs an explicit first-party code-server entrypoint, a code-server process contract, an explicit code-server URL contract, a real CEF materialization path, placeholder replacement proof, real hide/suspend/wake proof, privacy proof, and running evidence. Real Kanban still needs first-party entrypoint/materialization, placeholder replacement, real hide/suspend/wake, and running evidence. Real Manage still needs first-party entrypoint/materialization, a separate real file-bridge mount contract, placeholder replacement, project-scoped file-operation proof through the real bridge, real hide/suspend/wake proof, privacy proof, and running evidence. Browser product/runtime decisions, cross-surface runtime-transfer contracts, terminal native physical-key identity/product acceptance, and the global no-validation/external-evidence gap remain.

### 2026-06-23-21:50 Task slice 244

<!--
CDXC:GPUIPhase10BlockerLedger 2026-06-23-21:50:
Source-only runtime parity is accepted for the current GPUI source-ledger effort, terminal is accepted as working for that ledger, and the user will runtime-check later. Validation/app commands remain not run and outside this agent workflow, while future web panes must target CEF only and Manage file bridge remains separate.
-->

- Reconciled the Phase 10 source-ledger map so external running evidence, runtime visual evidence, formatting/tests/checks/app launch validation, and equivalent validation are recorded as not run outside this agent workflow rather than as current source-ledger blockers.
- Narrowed the remaining explicit blockers to Source first-party/code-server/process/URL/CEF materialization contracts, Kanban first-party/CEF materialization contracts, Manage first-party/CEF/file-bridge contracts plus real project-scoped file-operation proof, Browser `browserWorkareaId`/import/popup-transfer/CEF lifecycle decisions, cross-surface transfer product/runtime/privacy contracts, and terminal native physical-key identity/product acceptance.
- Scrubbed current GPUI source/docs wording so future web panes target CEF only, with Manage file bridge documented as a separate contract. Replaced the stale non-CEF rejected Manage payload example with a CEF-state rejection shape without adding CEF behavior.
- Preserved privacy and no-fallback boundaries: no logs, persistence, URLs, paths, file names, command text/output, page titles, tokens, env, hidden mounts, localhost probes, fixtures, fake readiness, CEF materialization, file bridge, runtime behavior, or placeholder replacement were added.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining source-ledger blockers: explicit Source CEF/code-server contracts, Kanban first-party/CEF materialization, Manage first-party/CEF/file-bridge contracts and real file-operation proof, Browser identity/import/popup-transfer/CEF lifecycle decisions, cross-surface transfer product/runtime/privacy contracts, and terminal native physical-key identity/product acceptance.

### 2026-06-24-02:53 Task slice 245

<!--
CDXC:GPUISourceCefCodeServerMount 2026-06-24-02:53:
Source requests can now rely on the fixed app-resource code-server entrypoint and Node runtime resource labels for the source-ledger contract. This does not start code-server, issue a URL, mount CEF, create hidden surfaces, or replace the Source placeholder; those remain explicit contracts.
-->

- Repaired the interrupted Source entrypoint slice directly after worker Boyle disconnected before completion.
- Added a source-only app-resource entrypoint contract for Source CEF/code-server requests in `gpui/src/main.rs`, using only fixed resource identifiers for the packaged `Web/code-server/out/node/entry.js` entrypoint and `Web/code-server/lib/node` runtime.
- Updated the Source request privacy summary and source-only assertions so ready Source requests report an app-resource entrypoint, but still cannot start code-server, still have no code-server URL, still cannot mount CEF, and still have no materializable request.
- Updated the Phase 10 source-ledger map and docs so Source no longer blocks on discovering the first-party code-server entrypoint. Source still blocks on the code-server process contract, explicit URL contract, and CEF materialization contract.
- Preserved privacy and no-fallback boundaries: no absolute paths, user/project paths, raw URLs, ports, tokens, command args, stdout/stderr, env, process ids, logs, persistence, localhost probes, fixtures, hidden mounts, CEF creation, or placeholder replacement were added.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining source-ledger blockers: Source code-server process contract, Source code-server URL contract, Source CEF materialization contract, Kanban first-party/CEF materialization, Manage first-party/CEF/file-bridge contracts and real file-operation proof, Browser identity/import/popup-transfer/CEF lifecycle decisions, cross-surface transfer product/runtime/privacy contracts, and terminal native physical-key identity/product acceptance.

### 2026-06-24-02:59 Task slice 246

<!--
CDXC:GPUISourceCefCodeServerMount 2026-06-24-02:59:
This source-only Phase 5 slice adds the Source code-server app-resource process launch-plan contract behind the existing exact-runtime CEF/code-server mount request. It does not spawn code-server, allocate ports, issue URLs, probe localhost, create CEF, mount hidden surfaces, persist/log process details, carry cwd/args/env/pid/stdout/stderr/path payloads, or replace the Source placeholder.
-->

- Added a source-only app-resource code-server process launch-plan state in `gpui/src/main.rs`, formed only for a ready Source CEF/code-server mount request that already has the exact active project/source runtime identity plus fixed app-resource entrypoint and Node runtime contract.
- Ready Source requests now report `appResourceCodeServerLaunchPlan` instead of `missingCodeServerProcessContract`, with privacy JSON limited to safe labels and booleans. The request remains non-materializable because `missingCodeServerUrlContract` and `missingCefCodeServerMaterializationContract` remain present.
- Updated the Phase 10 source-ledger assertions and comments so Source no longer lists the code-server process contract as a missing gate, while still proving URL and CEF materialization are blocked and no URL/path/code-server payloads, localhost probes, logs, persistence, hidden mounts, CEF creation, or placeholder replacement are introduced.
- Updated Phase 5 and Phase 10 docs so Source current blockers are the explicit code-server URL contract and CEF materialization contract. CEF remains the only target for future web panes.
- Follow-up review tightened the combined Phase 5-7 source-only handoff wording so it no longer names the Source process contract as a current blocker after the non-spawning launch-plan evidence.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining source-ledger blockers: Source code-server URL contract, Source CEF materialization contract, Kanban first-party/CEF materialization, Manage first-party/CEF/file-bridge contracts and real file-operation proof, Browser identity/import/popup-transfer/CEF lifecycle decisions, cross-surface transfer product/runtime/privacy contracts, and terminal native physical-key identity/product acceptance.

### 2026-06-24-03:06 Task slice 247

<!--
CDXC:GPUISourceCefCodeServerMount 2026-06-24-03:06:
This source-only Phase 5 slice adds the Source code-server URL-boundary contract as source-ledger evidence only after exact ready Source runtime identity, fixed app-resource entrypoint, and non-spawning launch-plan evidence exist. It does not issue or store a runtime URL, allocate ports, expose hostname/query/fragment/token/path/project/process data, create CEF, mount hidden surfaces, log or persist private details, or replace the Source placeholder.
-->

- Added a source-ledger Source code-server URL-boundary state in `gpui/src/main.rs`, formed only for a ready Source CEF/code-server mount request that already has exact runtime identity, the fixed app-resource code-server entrypoint, and the non-spawning app-resource process launch-plan state.
- Ready Source requests now report `sourceLedgerCodeServerUrlContract` plus privacy booleans like `hasCodeServerUrlContract` and `hasIssuedRuntimeCodeServerUrl:false` instead of `missingCodeServerUrlContract`. The contract carries no raw URL, hostname, localhost/127.0.0.1 value, port, token, query string, fragment, path, project data, process data, CEF/code-server payload, page title, log, persistence field, or placeholder replacement permission.
- Kept `SourceCefCodeServerMaterializationState::MissingCefCodeServerMaterializationContract` as the remaining Source CEF/code-server gate. Ready Source requests remain non-materializable and the render path continues to show the Source placeholder without creating CEF or starting code-server.
- Updated Phase 10 source-ledger assertions and comments so Source no longer lists the code-server URL contract as a current source-ledger blocker; Source remains blocked on CEF materialization for this mount request.
- Updated Phase 5 and Phase 10 docs so future/current web panes remain CEF-targeted and Source current blockers no longer include the code-server URL contract.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining source-ledger blockers: Source CEF materialization contract, Kanban first-party/CEF materialization, Manage first-party/CEF/file-bridge contracts and real file-operation proof, Browser identity/import/popup-transfer/CEF lifecycle decisions, cross-surface transfer product/runtime/privacy contracts, and terminal native physical-key identity/product acceptance.

### 2026-06-24-03:12 Task slice 248

<!--
CDXC:GPUISourceCefCodeServerMount 2026-06-24-03:12:
This source-only Phase 5 slice adds the Source CEF-only materialization contract as source-ledger evidence after exact ready Source identity, fixed app-resource entrypoint, non-spawning launch plan, and source-ledger URL-boundary evidence exist. It does not instantiate a runtime CEF browser, issue or store a runtime URL, start code-server, allocate ports, mount hidden surfaces, persist/log private details, carry hostnames/query/fragment/tokens/paths/project/process/page-title/payload/file-content data, or replace the Source placeholder.
-->

- Added a CEF-only source-ledger Source materialization contract in `gpui/src/main.rs`, formed only for a ready Source CEF/code-server request that already has exact runtime identity, the fixed app-resource code-server entrypoint, the non-spawning app-resource launch-plan state, and the source-ledger URL-boundary contract.
- Ready Source requests now report `sourceLedgerCefMaterializationContract`, `materializationEngine:"cef"`, `hasSourceLedgerCefMaterializationContract:true`, and `hasInstantiatedRuntimeCefBrowser:false`. The request remains non-materializable at runtime because no runtime URL is issued and no CEF browser is instantiated in this slice.
- Updated the Source render comment and source-only assertions to keep the placeholder path explicit: `materializable_request()` still returns `None`, no CEF/code-server runtime surface is created, no hidden mount is created, and placeholder replacement is not performed.
- Updated the Phase 10 source ledger so Source Phase 5 is `accepted for source ledger` with no current Source CEF materialization missing gate. Runtime Source instantiation and visual/app evidence remain outside this no-validation workflow and will be checked later by the user.
- Updated the parity requirements and missing-parity handoff docs so Source CEF materialization is no longer listed as a current source-ledger blocker, while preserving the runtime caveat that actual CEF browser creation, runtime URL issuance, code-server startup, and placeholder replacement were not done.
- Follow-up review cleaned stale Source comments and requirements wording so they distinguish accepted source-ledger parity from runtime CEF/code-server instantiation that remains outside this workflow.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining source-ledger blockers: Kanban first-party/CEF materialization, Manage first-party/CEF/file-bridge contracts and real file-operation proof, Browser identity/import/popup-transfer/CEF lifecycle decisions, cross-surface transfer product/runtime/privacy contracts, and terminal native physical-key identity/product acceptance. No runtime/app validation was run, so compile/test/runtime risk remains outside this workflow.

### 2026-06-24-03:32 Task slice 249

<!--
CDXC:GPUIKanbanCefMount 2026-06-24-03:32:
This source-only Phase 6 slice adds a first-party CEF app-resource entrypoint contract for exact-identity Kanban mount requests. It does not create CEF, issue or store URLs, use non-CEF web engines, mount hidden surfaces, persist/log private details, carry paths/board names/page titles/CEF payloads, or replace the Kanban placeholder; the separate CEF materialization contract remains the Kanban gate.
-->

- Added a source-only first-party CEF entrypoint state for Kanban CEF mount requests in `gpui/src/main.rs`. Ready exact-identity Kanban requests now report a fixed `appResourceKanbanSurface` label plus `entrypointEngine:"cef"` instead of `missingFirstPartyEntrypoint`.
- Kept Kanban non-materializable by adding a separate missing CEF materialization state. `materializable_request()` still returns `None`, `canMountCef` remains false, no runtime CEF browser is instantiated, and the render path keeps the existing placeholder.
- Updated source-only assertions and the Phase 10 ledger so Kanban no longer lists the first-party CEF entrypoint as a current source-ledger blocker. The remaining Kanban source-ledger gate is `KanbanCefMaterializationContract`.
- Updated the parity requirements and missing-parity handoff docs so Kanban’s current blocker wording is CEF materialization only, with CEF-only/no-other-engine wording and no URL/path/board/page-title/payload/fallback/logging/persistence/hidden-surface/placeholder-replacement expansion.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining source-ledger blockers: Kanban CEF materialization, Manage first-party/CEF/file-bridge contracts and real file-operation proof, Browser identity/import/popup-transfer/CEF lifecycle decisions, cross-surface transfer product/runtime/privacy contracts, and terminal native physical-key identity/product acceptance. Runtime Source instantiation and all validation/app evidence remain outside this no-validation workflow for the user to check later.

### 2026-06-24-03:41 Task slice 250

<!--
CDXC:GPUIKanbanCefMount 2026-06-24-03:41:
This source-only slice adds a CEF-only source-ledger materialization contract for exact-identity Kanban requests after the fixed first-party CEF app-resource entrypoint exists, and adds a source-only first-party CEF app-resource entrypoint contract for exact-identity Manage requests. It does not instantiate runtime CEF, issue or store URLs, create file bridges, run file I/O, mount hidden surfaces, persist/log private details, carry paths/board names/page titles/file contents/operation args/CEF or file-bridge payloads, or replace placeholders.
-->

- Added a CEF-only source-ledger materialization contract for Kanban CEF mount requests in `gpui/src/main.rs`. Ready exact-identity Kanban requests now report `sourceLedgerCefMaterializationContract`, `materializationEngine:"cef"`, `hasSourceLedgerCefMaterializationContract:true`, and `hasInstantiatedRuntimeCefBrowser:false`.
- Kept Kanban runtime non-materializable: `materializable_request()` still returns `None`, `canMountCef` remains false, no runtime URL or CEF browser is created, and the render path keeps the existing placeholder.
- Added a source-only first-party CEF app-resource entrypoint label for Manage CEF mount requests while keeping `missingCefMaterializationContract` and `missingFileBridgeMountContract` separate. Manage still cannot mount CEF, mount a file bridge, materialize the surface, run file operations, or replace the placeholder.
- Updated the Phase 10 source ledger so Kanban is accepted for the source ledger with runtime caveats, and Manage no longer lists first-party CEF entrypoint as a current source-ledger blocker while still listing Manage CEF materialization, Manage file-bridge mount, and Manage project-scoped file-operation proof.
- Updated the parity requirements and missing-parity handoff docs so Kanban has no current Phase 6 source-ledger gate after the CEF-only materialization contract, and Manage remains blocked only on CEF materialization, separate file bridge, and real file-operation proof.
- Follow-up review removed retired Source/Kanban/Manage first-party/materialization gate variants from the Phase 10 missing-gate enum and corrected handoff wording so Source/Kanban runtime caveats are not current source-ledger blockers.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining source-ledger blockers: Manage CEF materialization, Manage file-bridge mount, Manage project-scoped file-operation proof, Browser identity/import/popup-transfer/CEF lifecycle decisions, cross-surface transfer product/runtime/privacy contracts, and terminal native physical-key identity/product acceptance. Runtime Source and Kanban instantiation plus all validation/app evidence remain outside this no-validation workflow for the user to check later.

### 2026-06-24-03:58 Task slice 251

<!--
CDXC:GPUIManageCefMount 2026-06-24-03:58:
This source-only Phase 7 slice retires the remaining Manage source-ledger gates with CEF-only materialization, source-only file-bridge mount, and project-scoped file-operation proof contracts after exact ready Manage identity and the fixed first-party CEF app-resource entrypoint exist. It does not instantiate runtime CEF, issue or store URLs, mount a runtime file bridge, run file I/O, create bridge payloads, use WKWebView, mount hidden surfaces, persist/log private details, carry paths/file names/file contents/operation args/page titles/CEF or file-bridge payloads, or replace the placeholder.
-->

- Added source-ledger Manage CEF materialization evidence in `gpui/src/main.rs`. Ready exact-identity Manage requests now report `sourceLedgerCefMaterializationContract`, `materializationEngine:"cef"`, `hasSourceLedgerCefMaterializationContract:true`, and `hasInstantiatedRuntimeCefBrowser:false`.
- Added source-only Manage file-bridge mount evidence and project-scoped file-operation proof evidence. Ready requests report `sourceLedgerFileBridgeMountContract`, `hasMountedRuntimeFileBridge:false`, `sourceLedgerProjectScopedFileOperationProof`, and `hasRunRuntimeFileOperation:false`; when no accepted operation is stored the proof is policy-only, and when a strict operation request has been stored it reports only safe decision/operation labels.
- Kept Manage runtime non-materializable: `materializable_request()` still returns `None`, `canMountCef`, `canMountFileBridge`, and `canMountManageSurface` remain false, no runtime URL/CEF/file bridge/file operation is created, and the render path keeps the existing placeholder.
- Updated the Phase 10 source ledger so Manage is `accepted for source ledger` with no current Manage missing gates. Runtime Manage instantiation, runtime file-bridge mounting, file-operation execution, placeholder replacement, and visual/app evidence remain outside this no-validation workflow and will be checked later by the user.
- Updated the parity requirements and missing-parity handoff docs so Manage no longer lists CEF materialization, file-bridge mount, or project-scoped file-operation proof as current source-ledger blockers, while preserving the runtime caveat that actual CEF browser creation, runtime file-bridge mounting, file I/O, validation/app commands, and placeholder replacement were not done.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining source-ledger blockers: Browser identity/import/popup-transfer/CEF lifecycle decisions, cross-surface transfer product/runtime/privacy contracts, and terminal native physical-key identity/product acceptance. Runtime Source, Kanban, and Manage instantiation plus all validation/app evidence remain outside this no-validation workflow for the user to check later.

### 2026-06-24-04:10 Task slice 252

<!--
CDXC:GPUIBrowserRuntimeParity 2026-06-24-04:10:
This source-only Phase 10 slice retires the Browser source-ledger gates with explicit contracts. Phase 1 continues to reject browserWorkareaId, Browser identity remains owned by the strict readiness boundary, compatible import remains unsupported/no-op, blank/script-created popups remain no-transfer, and lifecycle remains CEF-only hide-and-hold/restored-placeholder evidence without runtime CEF creation, URL issuance, suspend/teardown, hidden surfaces, fallback probes, private logging/persistence, opener data serialization, or placeholder replacement.
-->

- Added explicit Browser source-ledger evidence in `gpui/src/main.rs` for the Phase 1 identity rejection contract, compatible-import unsupported/no-op contract, blank/script-created popup no-transfer contract, and CEF-only hide-and-hold/restored-placeholder lifecycle contract.
- Updated the Phase 10 Browser ledger row to `accepted for source ledger` with no Browser missing gates, and removed the retired Browser missing-gate variants from the source-level enum/assertions.
- Updated the parity requirements and missing-parity handoff docs so Browser is accepted for the current source ledger while preserving the runtime caveat: no import data, URLs, profile paths, cookies, history, bookmarks, file paths, CEF payloads, opener data, fallback probes, runtime CEF browser, suspend/teardown, hidden mount, private logging/persistence, or placeholder replacement was added.
- Kept CEF as the only accepted web-pane target for Browser lifecycle language. No WKWebView/WebKit or non-CEF Browser web-pane path was introduced.
- Follow-up review corrected stale Browser blocker wording in source/docs comments so slice 252 is the current source-ledger state: Browser source-ledger gates are retired, while runtime Browser checks remain deferred to the user.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining source-ledger blockers: cross-surface transfer product/runtime/privacy contracts and terminal native physical-key identity/product acceptance. Runtime Source, Kanban, Manage, and Browser checks plus all validation/app evidence remain outside this no-validation workflow for the user to check later.

### 2026-06-24-04:15 Task slice 253

<!--
CDXC:GPUIPhase10BlockerLedger 2026-06-24-04:15:
This source-only Phase 10 slice retires the remaining source-ledger blockers by accepting current terminal physical-key/product behavior and cross-surface shell-only transfer behavior without changing runtime code. No native physical-key identity, runtime key forwarding, live transfer family, CEF/file/editor/process/content transfer, fallback, logging, persistence, validation, app launch, or browser automation was added.
-->

- Added explicit terminal source-ledger evidence in `gpui/src/main.rs` for the accepted physical-key/product behavior: GPUI still lacks native keycode/UIEvents-code identity, does not synthesize physical keys from layout-only key data, keeps Control/Cmd physical-key cases rejected by the existing committed-text helper, and leaves committed `key_char`, IME, preedit, and text-service paths as current behavior.
- Added explicit cross-surface source-ledger evidence for shell-only transfer: no live runtime/process/content transfer families are allowed in this pass, so per-source/target runtime contracts and terminal/Browser/Source/Kanban/Manage transfer contracts are intentionally not required unless future product work enables live transfer.
- Updated the Phase 10 ledger so `TerminalClipboardPhysicalKeys` and `CrossSurfaceRuntimeProcessContentTransfer` are `accepted for source ledger` with no missing gates, and removed the retired missing-gate variants from the source-level enum.
- Updated the parity requirements and missing-parity handoff docs so current status says no source-ledger blockers remain. Runtime Source, Kanban, Manage, and Browser checks plus validation remain deferred to the user/outside workflow.
- Follow-up review corrected stale Source/Kanban/Manage handoff comments that still described superseded source-ledger gates as missing, while preserving runtime caveats and placeholder behavior.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining source-ledger blockers: none. Runtime Source, Kanban, Manage, and Browser checks plus all validation/app evidence remain outside this no-validation workflow for the user to check later.

### 2026-06-24-04:29 Task slice 254

<!--
CDXC:GPUIPhase10BlockerLedger 2026-06-24-04:29:
This docs-only source-ledger wording reconciliation updates current Phase 10 guidance after slices 250, 252, and 253. No source-ledger blockers remain; Source, Kanban, Manage, and Browser runtime instantiation/checking remains deferred to the user/outside workflow, Browser Phase 1 still rejects browserWorkareaId by contract, import remains unsupported/no-op unless future importer work is explicitly requested, blank/script-created popup transfer remains no-transfer, Browser lifecycle remains CEF-only hide-and-hold/restored-placeholder evidence, terminal physical-key/product behavior is accepted without runtime key-forwarding changes, cross-surface transfer is accepted as shell-only/no-live-runtime-transfer, and validation/app commands are not queued.
-->

- Reconciled current Phase 10 requirements/commentary and handoff wording so retired Browser, Kanban, terminal physical-key, and cross-surface source-ledger gates are not presented as current blockers after slices 250, 252, and 253.
- Preserved runtime caveats: actual Source, Kanban, Manage, and Browser runtime instantiation/checking, placeholder replacement, Browser runtime CEF creation/suspend/teardown, import implementation, popup content transfer, and Manage file-bridge/file-operation execution remain outside this docs-only source-ledger workflow.
- Kept Browser Phase 1 identity wording strict: `browserWorkareaId` remains rejected by contract, Browser readiness stays in the separate source-only boundary, import remains unsupported/no-op unless future importer work is explicitly requested, blank/script-created popup transfer remains no-transfer, and Browser lifecycle remains CEF-only hide-and-hold/restored-placeholder evidence.
- Kept terminal and transfer wording aligned with slice 253: terminal physical-key/product behavior is accepted for the source ledger without runtime key-forwarding changes, and cross-surface transfer is accepted as shell-only/no-live-runtime-transfer without requiring live transfer contracts unless future product work enables them.
- Files touched: `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: no source-ledger blockers remain. Runtime Source, Kanban, Manage, and Browser checks plus all validation/app evidence remain deferred to the user/outside workflow; no validation/app commands are queued.

### 2026-06-24-04:34 Task slice 255

<!--
CDXC:GPUISourceCefCodeServerMount 2026-06-24-04:34:
This source-only Phase 5 slice adds a Source CEF/code-server runtime-parity plan after exact ready Source identity, the fixed app-resource entrypoint, non-spawning launch-plan evidence, source-ledger URL-boundary evidence, and CEF-only materialization evidence exist. The plan accepts only CEF as the web-pane engine and rejects non-CEF labels by source contract, while still not instantiating CEF, starting code-server, issuing runtime URLs, mounting hidden surfaces, logging or persisting private details, running validation, or replacing the placeholder.
-->

- Added a source-only Source CEF/code-server runtime-parity plan state in `gpui/src/main.rs`. Ready exact-identity Source requests now report `runtimeParityState:"sourceOnlyRuntimeParityPlan"`, `webPaneEngine:"cef"`, `hasCefOnlyWebPaneEngineContract:true`, `rejectsNonCefWebPaneEngines:true`, and `countsAsSourceOnlyRuntimeParity:true`.
- Kept runtime behavior unchanged: `canMountCef:false`, `canMaterializeSourceSurface:false`, `materializable_request()` remains `None`, no `CefBrowser` is instantiated, no code-server process starts, no runtime URL is issued or stored, no hidden surface is mounted, and the Source placeholder remains visible.
- Added source-only assertions for the new plan, including non-CEF engine-label rejection and privacy JSON limited to safe labels/booleans without project ids, Source ids, paths, URLs, code-server resource paths, CEF/code-server payloads, rejected engine labels, logging/persistence fields, hidden mounts, or placeholder replacement.
- Updated the Phase 10 source ledger so Source runtime-parity plan evidence is counted under `accepted for source ledger` without changing the no-validation/outside-workflow rows or claiming runtime instantiation.
- Updated the parity requirements and missing-parity handoff docs so Source source-only runtime parity acceptance is recorded while preserving the runtime caveat that actual CEF/code-server instantiation, runtime URL issuance, validation, and placeholder replacement remain deferred to the user/outside workflow.
- Parent review aligned the Phase 10 Source row with slice 255 so it no longer stops at the slice 248 materialization label.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: no source-ledger blockers remain. Runtime Source CEF/code-server instantiation/checking plus broader Source, Kanban, Manage, and Browser runtime checks and all validation/app evidence remain deferred to the user/outside workflow.

### 2026-06-24-04:49 Task slice 256

<!--
CDXC:GPUIKanbanCefMount 2026-06-24-04:49:
This source-only Phase 6 slice adds a Kanban CEF runtime-parity plan after exact ready Kanban identity, the fixed first-party CEF app-resource entrypoint, and CEF-only source-ledger materialization evidence exist. The plan accepts only CEF as the web-pane engine and rejects non-CEF labels by source contract, while still not instantiating CEF, issuing or storing runtime URLs, mounting hidden surfaces, logging or persisting private details, running validation, or replacing the placeholder.
-->

- Added a source-only Kanban CEF runtime-parity plan state in `gpui/src/main.rs`. Ready exact-identity Kanban requests now report `runtimeParityState:"sourceOnlyRuntimeParityPlan"`, `webPaneEngine:"cef"`, `hasCefOnlyWebPaneEngineContract:true`, `rejectsNonCefWebPaneEngines:true`, and `countsAsSourceOnlyRuntimeParity:true`.
- Kept runtime behavior unchanged: `canMountCef:false`, `materializable_request()` remains `None`, no `CefBrowser` is instantiated, no runtime URL is issued or stored, no hidden surface is mounted, and the Kanban placeholder remains visible.
- Added source-only assertions for the new Kanban plan, including non-CEF engine-label rejection and privacy JSON limited to safe labels/booleans without project ids, Kanban ids, board names, URLs, paths, CEF payloads, rejected engine labels, logging/persistence fields, hidden mounts, or placeholder replacement.
- Updated the Phase 10 source ledger so Kanban runtime-parity plan evidence is counted under `accepted for source ledger` without changing validation/outside-workflow rows or claiming runtime instantiation.
- Updated the parity requirements and missing-parity handoff docs so Kanban source-only runtime parity acceptance is recorded while preserving the runtime caveat that actual CEF instantiation, runtime URL issuance, validation, and placeholder replacement remain deferred to the user/outside workflow.
- Parent review aligned older Phase 6 Kanban handoff comments so they no longer stop at the slice 250 materialization label.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: no source-ledger blockers remain. Runtime Kanban CEF instantiation/checking plus broader Source, Manage, Browser, and validation/app evidence remain deferred to the user/outside workflow.

### 2026-06-24-04:55 Task slice 257

<!--
CDXC:GPUIManageCefMount 2026-06-24-04:55:
This source-only Phase 7 slice adds a Manage CEF/file-bridge runtime-parity plan after exact ready Manage identity, the fixed first-party CEF app-resource entrypoint, CEF-only materialization evidence, source-only file-bridge mount evidence, and project-scoped file-operation proof evidence exist. The plan accepts only CEF as the web-pane engine and rejects non-CEF labels by source contract, while still not instantiating CEF, issuing or storing runtime URLs, mounting a runtime file bridge, running file operations, creating CEF/file-bridge payloads, mounting hidden surfaces, logging or persisting private details, running validation, or replacing the placeholder.
-->

- Added a source-only Manage CEF/file-bridge runtime-parity plan state in `gpui/src/main.rs`. Ready exact-identity Manage requests now report `runtimeParityState:"sourceOnlyRuntimeParityPlan"`, `webPaneEngine:"cef"`, `hasCefOnlyWebPaneEngineContract:true`, `rejectsNonCefWebPaneEngines:true`, and `countsAsSourceOnlyRuntimeParity:true`.
- Kept runtime behavior unchanged: `canMountCef:false`, `canMountFileBridge:false`, `canMountManageSurface:false`, `materializable_request()` remains `None`, no `CefBrowser` is instantiated, no runtime URL is issued or stored, no runtime file bridge is mounted, no file operation runs, no CEF/file-bridge payload is created, no hidden surface is mounted, and the Manage placeholder remains visible.
- Added source-only assertions for the new Manage plan, including non-CEF engine-label rejection and privacy JSON limited to safe labels/booleans without project ids, Manage ids, URLs, paths, project paths, file names, file contents, operation args, page titles, CEF/file-bridge payloads, rejected engine labels, logging/persistence fields, hidden mounts, or placeholder replacement.
- Updated the Phase 10 source ledger wording so Manage runtime-parity plan evidence is counted under `accepted for source ledger` without changing validation/outside-workflow rows or claiming runtime CEF/file-bridge instantiation.
- Updated the parity requirements and missing-parity handoff docs so Manage source-only runtime parity acceptance is recorded while preserving the runtime caveat that actual CEF instantiation, runtime URL issuance, runtime file-bridge mounting, file-operation execution, validation, and placeholder replacement remain deferred to the user/outside workflow.
- Parent review aligned the Manage render comment with slice 257 so render remains explicitly placeholder-only after the source-only runtime-parity plan.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: no source-ledger blockers remain. Runtime Manage CEF/file-bridge instantiation/checking plus broader Source, Kanban, Browser, and validation/app evidence remain deferred to the user/outside workflow.

### 2026-06-24-05:06 Task slice 258

<!--
CDXC:GPUIBrowserRuntimeParity 2026-06-24-05:06:
This source-only Phase 8/10 slice adds Browser source-only runtime-parity acceptance with CEF as the only web-pane engine. It counts existing tab-owned CEF visibility plus Phase 1 Browser identity rejection, strict readiness, unsupported/no-op import, blank-popup no-transfer, and restored-placeholder contracts for the source ledger while rejecting WKWebView/WebKit/non-CEF labels and still not creating extra CEF surfaces, issuing runtime URLs, importing data, transferring popup content, suspending/tearing down CEF, mounting hidden surfaces, logging or persisting private details, running validation, or replacing restored placeholders.
-->

- Added a Browser CEF runtime-parity plan in `gpui/src/main.rs`. The plan reports `runtimeParityState:"sourceOnlyRuntimeParityPlan"`, `webPaneEngine:"cef"`, `hasCefOnlyWebPaneEngineContract:true`, `rejectsNonCefWebPaneEngines:true`, and `countsAsSourceOnlyRuntimeParity:true` only when the current source contracts prove Phase 1 Browser identity rejection, strict readiness ownership, unsupported import, blank-popup no-transfer, restored-placeholder behavior, and existing tab-owned CEF visibility.
- Kept runtime behavior unchanged: no new CEF surface is created, no runtime URL is issued, no Browser import runs, no blank-popup content is transferred, no CEF suspend/teardown is added, no hidden Browser surface is mounted, no private logging/persistence is added, and restored placeholders are not replaced by this source-only plan.
- Added source-only assertions for the Browser plan, including WKWebView/WebKit/non-CEF engine-label rejection and privacy JSON limited to safe labels/booleans without project ids, Browser ids, URLs, paths, tokens, cookies, history, bookmarks, profile paths, CEF payloads, opener data, fallbacks, hidden mounts, or private logging/persistence fields.
- Updated the Phase 10 source ledger so Browser runtime-parity plan evidence is counted under `accepted for source ledger` without changing validation/outside-workflow rows or claiming new runtime CEF creation.
- Updated the parity requirements and missing-parity handoff docs so Browser source-only runtime parity acceptance is recorded while preserving the runtime caveat that Browser runtime checking remains deferred to the user/outside workflow.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: no source-ledger blockers remain. Runtime Source, Kanban, Manage, and Browser checks plus all validation/app evidence remain deferred to the user/outside workflow.

### 2026-06-24-05:20 Task slice 259

<!--
CDXC:GPUISourcePlaceholderReplacement 2026-06-24-05:20:
This source-only Phase 5/10 slice adds a centralized Source placeholder-replacement preflight gate formed from existing Source CEF/code-server request/runtime-parity evidence. The gate is CEF-only and rejects WKWebView/WebKit/non-CEF labels, but current behavior still denies replacement because there is no runtime code-server process, issued runtime URL, instantiated CEF browser, normal-layout CEF surface, hidden mount, private payload, or explicit replacement permission.
-->

- Added `SourcePlaceholderReplacementPreflightGate` and state wiring in `gpui/src/main.rs`, formed only when the ready Source request already has the source-only runtime-parity plan.
- Ready Source requests now report the preflight state plus safe labels/booleans for CEF-only engine, runtime process, issued URL, runtime CEF browser, normal-layout CEF surface, hidden mount, private payload, replacement permission, and `canReplaceSourcePlaceholder:false`.
- Kept runtime behavior unchanged: no code-server process starts, no runtime URL is issued or stored, no CEF browser or normal-layout CEF surface is instantiated, no hidden mount or private payload is created, and the colored Source placeholder is not replaced.
- Added pure source assertions proving the gate exists for a ready Source request, remains CEF-only, rejects WKWebView/WebKit/non-CEF labels without retaining them in privacy JSON, and reports all current runtime/preflight requirements as false.
- Updated the Phase 10 source ledger and the parity requirements/handoff docs so the Source runtime progression is recorded as a centralized future replacement gate, not runtime instantiation or readiness.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: runtime Source CEF/code-server instantiation, issued runtime URL, normal-layout CEF surface, placeholder replacement permission, and user runtime validation remain deferred to future work/outside this workflow.

### 2026-06-24-05:22 Task slice 260

<!--
CDXC:GPUIKanbanPlaceholderReplacement 2026-06-24-05:22:
This source-only Phase 6/10 slice adds a centralized Kanban placeholder-replacement preflight gate formed from existing Kanban CEF mount request/runtime-parity evidence. The gate is CEF-only and rejects WKWebView/WebKit/non-CEF labels, but current behavior still denies replacement because there is no issued runtime URL, instantiated CEF browser, normal-layout CEF surface, hidden mount, private runtime data, or explicit replacement permission.
-->

- Added `KanbanPlaceholderReplacementPreflightGate` and state wiring in `gpui/src/main.rs`, formed only when the ready Kanban request already has the source-only runtime-parity plan.
- Ready Kanban requests now report the preflight state plus safe labels/booleans for CEF-only engine, issued runtime URL, runtime CEF browser, normal-layout CEF surface, hidden mount, private runtime data, replacement permission, and `canReplaceKanbanPlaceholder:false`.
- Kept runtime behavior unchanged: no runtime URL is issued or stored, no CEF browser or normal-layout CEF surface is instantiated, no hidden mount or private runtime data is created, and the colored Kanban placeholder is not replaced.
- Added pure source assertions proving the gate exists for a ready Kanban request, remains CEF-only, rejects WKWebView/WebKit/non-CEF labels without retaining them in privacy JSON, and reports all current runtime/preflight requirements as false.
- Updated the Phase 10 source ledger and the parity requirements/handoff docs so the Kanban runtime progression is recorded as a centralized future replacement gate, not runtime instantiation or validation.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: runtime Kanban CEF instantiation, issued runtime URL, normal-layout CEF surface, placeholder replacement permission, and user runtime validation remain deferred to future work/outside this workflow.

### 2026-06-24-05:27 Task slice 261

<!--
CDXC:GPUIManagePlaceholderReplacement 2026-06-24-05:27:
This source-only Phase 7/10 slice adds a centralized Manage placeholder-replacement preflight gate formed only from `ManageCefRuntimeParityState::SourceOnlyRuntimeParityPlan`. The gate is CEF-only and rejects WKWebView/WebKit/non-CEF labels, but current behavior still denies replacement because there is no issued runtime URL, instantiated CEF browser, normal-layout CEF surface, runtime file bridge, runtime file operation, CEF/file-bridge payload, hidden mount, private runtime data/logging/persistence, or explicit replacement permission.
-->

- Added `ManagePlaceholderReplacementPreflightGate` and state wiring in `gpui/src/main.rs`, formed only when the ready Manage request already has the source-only CEF/file-bridge runtime-parity plan.
- Ready Manage requests now report the preflight state plus safe labels/booleans for CEF-only engine, issued runtime URL, runtime CEF browser, normal-layout CEF surface, runtime file bridge, runtime file operation, CEF/file-bridge payload, hidden mount, private runtime data/logging/persistence, replacement permission, and `canReplaceManagePlaceholder:false`.
- Kept runtime behavior unchanged: no runtime URL is issued or stored, no CEF browser or normal-layout CEF surface is instantiated, no runtime file bridge is mounted, no file operation runs, no CEF/file-bridge payload or hidden mount is created, no private logging/persistence is added, and the colored Manage placeholder is not replaced.
- Added pure source assertions proving the gate exists for a ready Manage request, remains CEF-only, rejects `candidateEngine`, `WKWebView`, `WebKit`, and `nonCef` labels without retaining them in privacy JSON, denies replacement, exposes only safe JSON fields, and reports blocked requests with missing preflight gate fields.
- Updated the Phase 10 source ledger and the parity requirements/handoff docs so the Manage runtime progression is recorded as a centralized future replacement gate, not runtime CEF/file-bridge instantiation, file I/O, placeholder replacement, or validation.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: runtime Manage CEF instantiation, issued runtime URL, normal-layout CEF surface, runtime file-bridge mounting, project-scoped file-operation execution through the real bridge, placeholder replacement permission, and user runtime validation remain deferred to future work/outside this workflow.

### 2026-06-24-05:45 Task slice 262

<!--
CDXC:GPUIProjectWorkareaPaneEngine 2026-06-24-05:45:
This source-only Phase 10 slice adds a central GPUI project-workarea pane-engine policy for Source, Browser, Kanban, and Manage. The policy counts panes for this source-ledger runtime parity only when existing evidence exposes CEF as the web-pane engine, rejects WKWebView/WebKit/non-CEF/candidate labels without retaining rejected labels in safe JSON, and leaves runtime checking to the user without CEF instantiation, code-server startup, file-bridge mounting, file I/O, hidden surfaces, private logging/persistence, or placeholder replacement.
-->

- Added `ProjectWorkareaPaneEnginePolicy` in `gpui/src/main.rs`, formed only from existing Source runtime-parity/preflight evidence, Browser runtime-parity evidence, Kanban runtime-parity/preflight evidence, and Manage runtime-parity/preflight evidence.
- The central policy exposes only safe labels and booleans: all four panes report `cef`, source-only runtime parity is credited, unsupported engine labels are rejected without retained rejected-label JSON, runtime checking is marked user-deferred, and runtime/placeholder replacement booleans remain false.
- Kept runtime behavior unchanged: no runtime URL is issued or stored, no CEF browser or normal-layout CEF surface is instantiated, no code-server process is started, no runtime file bridge is mounted, no file operation runs, no CEF/file-bridge payload or hidden mount is created, no private logging/persistence is added, and no placeholder is replaced.
- Added pure source assertions proving the policy is CEF-only across Source, Browser, Kanban, and Manage, rejects `candidateEngine`, `WKWebView`, `WebKit`, `nonCef`, `non-CEF`, and related candidate labels without retaining them in safe JSON, and reports all current runtime/preflight replacement requirements as false.
- Updated the Phase 10 source ledger and parity requirements/handoff docs so the central all-panes CEF-only policy is recorded as source-ledger evidence while runtime checking remains deferred to the user/outside workflow.
- Parent review aligned the executable Phase 10 ledger enum/list/assertions with the slice 262 docs so the central pane-engine policy is tracked as its own accepted source-ledger area.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: user runtime checks and any future actual Source/Kanban/Manage/Browser runtime implementation remain outside this source-only slice; placeholders remain unreplaced until explicit runtime prerequisites are implemented and verified.

### 2026-06-24-05:58 Task slice 263

<!--
CDXC:GPUIProjectWorkareaCefSlots 2026-06-24-05:58:
This source-side runtime scaffold adds GPUI-owned Source/Kanban/Manage CEF surface ownership slots after the existing ready runtime-parity and placeholder-preflight evidence. The slots are CEF-only and normal-layout only, require a future issued runtime URL before any CefSurface can be created, keep Browser excluded because Browser owns tab-scoped CEF surfaces, and do not create URLs, CEF surfaces, hidden mounts, private runtime data, logging/persistence, file bridges, file I/O, or placeholder replacement.
-->

- Added typed Source/Kanban/Manage CEF surface ownership-slot decisions in `gpui/src/main.rs`, keyed only by privacy-safe surface kind and formed only from existing request/runtime-parity/preflight states.
- Added an app-owned in-memory slot map that refreshes on active project and workarea bridge state changes. The map stores only safe slot decisions and never holds Browser tab state, project ids, paths, URLs, payloads, or `Entity<CefSurface>`.
- Kept runtime behavior unchanged: current decisions report CEF-only engine, normal-layout child boundary required, issued runtime URL absent, no runtime CEF surface created, no file bridge or file operation, no hidden/offscreen mount, no private runtime data/logging/persistence, no placeholder swap permission, and no CefSurface creation permission.
- Added pure source assertions proving Source/Kanban/Manage slot decisions appear only after the ready runtime-parity plus preflight gates, reject missing runtime/preflight evidence, keep Browser out of the slot set, and emit only safe labels/booleans.
- Updated the parity requirements and missing-parity handoff docs so slice 263 is recorded as CEF ownership-slot scaffolding, not runtime instantiation or placeholder replacement.
- Parent review added the Phase 10 source-ledger row for the Source/Kanban/Manage CEF ownership-slot boundary so the scaffold is tracked separately from the central pane-engine policy.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: actual issued runtime URLs, Source/Kanban/Manage CefSurface creation, Source code-server startup, Manage runtime file bridge/file I/O, placeholder replacement permission, Browser runtime checking, and validation/app evidence remain deferred to future work/outside this workflow.

### 2026-06-24-06:13 Task slice 264

<!--
CDXC:GPUIProjectWorkareaRuntimeUrlIssuance 2026-06-24-06:13:
This source-side runtime URL issuance boundary adds typed Source/Kanban/Manage decisions after ready runtime-parity, placeholder-preflight, and ownership-slot evidence. The decisions are CEF-only and normal-layout-only, keep Browser excluded because Browser already owns tab-scoped CEF, require future real URL authority before issuing any runtime URL, and currently record no authority, no issued URL, no retained URL value, no CefSurface creation, no code-server/file-bridge/file-I/O payload, no hidden/offscreen mount, no private runtime data/logging/persistence, and no placeholder replacement.
-->

- Added typed Source/Kanban/Manage runtime URL issuance authority/state decisions in `gpui/src/main.rs`, keyed only by the existing safe CEF slot kind and derived from the ready runtime-parity, placeholder-preflight, and ownership-slot evidence.
- Added app-owned in-memory URL issuance bookkeeping refreshed with the CEF ownership-slot map. The map stores only safe labels/booleans and never stores URL values, project ids, paths, Browser state, payloads, logs, persistence, or `Entity<CefSurface>`.
- Kept runtime behavior unchanged: current decisions report real runtime URL authority absent, issued runtime URL absent, URL value absent/not retained, CefSurface creation disallowed, code-server/file-bridge/file-I/O payloads absent, hidden/offscreen mounts absent, private runtime data/logging/persistence absent, and placeholder replacement disallowed.
- Added pure source assertions proving Source/Kanban/Manage URL issuance decisions appear only after ready runtime-parity, placeholder-preflight, and ownership-slot evidence; reject missing runtime/preflight/slot evidence; keep Browser out; stay CEF-only and normal-layout-only; and emit only safe labels/booleans.
- Parent review extended the slice assertion to explicitly reject URL schemes, localhost/loopback labels, `about:blank`, and app-resource strings from the URL issuance privacy JSON.
- Added a Phase 10 source-ledger row for the runtime URL issuance boundary as accepted source-ledger evidence only, not runtime signoff.
- Updated the parity requirements and missing-parity handoff docs so slice 264 is recorded as source-side URL issuance boundary scaffolding, not runtime URL issuance, CEF instantiation, file-bridge work, or placeholder replacement.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: real Source/Kanban/Manage URL authority, actual issued runtime URLs, Source/Kanban/Manage CefSurface creation, Source code-server startup, Manage runtime file bridge/file I/O, placeholder replacement permission, Browser runtime checking, and validation/app evidence remain deferred to future work/outside this workflow.

### 2026-06-24-06:24 Task slice 265

<!--
CDXC:GPUIProjectWorkareaSourceStartupNavigationReadiness 2026-06-24-06:24:
This source-side Source startup navigation readiness boundary derives only from the Source runtime URL issuance decision. It mirrors macOS source truth as evidence only: Source/code-mode panes are CEF-backed and normal-layout-only, first code-server navigation remains deferred until a future runtime readiness gate succeeds and an issued runtime URL exists, Browser/Kanban/Manage do not use this Source startup wait, and current source records no direct Source navigation, URL value, URL scheme/host payload, code-server startup, CefSurface creation, hidden/offscreen mount, fallback probe, private payload, logging/persistence, placeholder replacement, validation, or app check.
-->

- Added typed Source startup navigation readiness state in `gpui/src/main.rs`, derived only from the existing Source runtime URL issuance decision and keyed only by the safe Source slot label.
- Added app-owned in-memory Source startup readiness bookkeeping refreshed beside the CEF slot and runtime URL issuance maps. It stores only safe labels/booleans and never stores URL values, project ids/names, paths, Browser/Kanban/Manage state, CEF/code-server payloads, logs, persistence, or `Entity<CefSurface>`.
- Kept runtime behavior unchanged: current Source navigation remains deferred, direct Source navigation is disallowed, no code-server startup or CefSurface creation occurs, non-code destinations are excluded from the Source readiness wait, and placeholders remain unreplaced.
- Added source assertions proving the boundary forms only from the Source runtime URL issuance decision, rejects missing/Kanban/Manage decisions, stays CEF-only and normal-layout-only, uses a safe blank-start label rather than an actual URL value, and emits no URL scheme/host/private payload strings in privacy JSON.
- Added a Phase 10 source-ledger row for Source startup navigation readiness as accepted evidence only, not runtime signoff.
- Updated the parity requirements and missing-parity handoff docs so slice 265 is recorded as Source startup navigation readiness scaffolding, not runtime navigation, URL issuance, CEF instantiation, or placeholder replacement.
- Parent review aligned the first Phase 5 Source summary with the new Source startup navigation readiness boundary so the docs no longer stop at placeholder preflight evidence.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: real Source runtime readiness gate execution, actual issued runtime URL, first Source code-server navigation, Source CefSurface creation, Source code-server startup, Source/Kanban/Manage runtime implementation, placeholder replacement permission, Browser runtime checking, and validation/app evidence remain deferred to future work/outside this workflow.

### 2026-06-24-06:37 Task slice 266

<!--
CDXC:GPUIProjectWorkareaSourceRuntimeCefSurfaceOwnerGate 2026-06-24-06:37:
This Source-only runtime CEF surface owner/creation gate is implementation prep after Source startup navigation readiness. It keeps Source CEF-only and normal-layout-only, wires refresh/render bookkeeping to the future owner slot, and keeps placeholder replacement blocked until runtime readiness, real URL authority, issued runtime URL, code-server process availability, CEF surface creation, and explicit replacement permission exist without storing URL values, project identity, private payloads, hidden mounts, logs, persistence, or a CefSurface entity.
-->

- Added `ProjectWorkareaSourceRuntimeCefSurfaceOwnerGate` in `gpui/src/main.rs`, derived only from the Source startup navigation readiness boundary and keyed only by the safe Source slot kind.
- Added app-owned in-memory Source owner-gate bookkeeping refreshed beside the Source startup navigation readiness boundary. It stores only safe labels/booleans and never stores URL values, project ids/names, paths, Browser/Kanban/Manage state, CEF/code-server payloads, logs, persistence, hidden mounts, or `Entity<CefSurface>`.
- Wired Source render through the new owner gate before the existing `materializable_request()` hook can matter, so the colored placeholder remains the only rendered Source body until the real runtime gate permits replacement.
- Kept runtime behavior unchanged: no runtime readiness success, URL authority, issued URL, code-server process, first Source navigation, CefSurface entity, normal-layout CEF child surface, hidden/offscreen mount, private runtime data/logging/persistence, replacement permission, or placeholder replacement was added.
- Added focused source assertions proving the gate is Source-only, CEF-only, normal-layout-only, rejects non-Source inputs, emits privacy JSON without URL schemes/hosts/private payloads, stores no CefSurface entity, and keeps render placeholder-only until the gate permits replacement.
- Added a Phase 10 source-ledger row for the Source runtime CEF surface owner gate as accepted evidence only, not runtime signoff.
- Updated the parity requirements and missing-parity handoff docs so slice 266 is recorded as Source runtime CEF surface owner/creation-gate scaffolding, not runtime CEF instantiation, URL issuance, code-server startup, or placeholder replacement.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: real Source runtime readiness gate execution, real URL authority, actual issued runtime URL, Source code-server startup, Source CefSurface creation, first Source code-server navigation, placeholder replacement permission, Source/Kanban/Manage runtime implementation, Browser runtime checking, and validation/app evidence remain deferred to future work/outside this workflow.

### 2026-06-24-06:49 Task slice 267

<!--
CDXC:GPUIProjectWorkareaKanbanRuntimeCefSurfaceOwnerGate 2026-06-24-06:49:
This Kanban-only runtime CEF surface owner/creation gate is implementation prep after the Kanban runtime URL issuance decision. It keeps Kanban CEF-only and normal-layout-only, wires refresh/render bookkeeping to the future owner slot, and keeps placeholder replacement blocked until real URL authority, issued runtime URL, CEF surface creation, and explicit replacement permission exist without storing URL values, project identity, private payloads, hidden mounts, logs, persistence, or a CefSurface entity.
-->

- Added `ProjectWorkareaKanbanRuntimeCefSurfaceOwnerGate` in `gpui/src/main.rs`, derived only from the existing Kanban `ProjectWorkareaRuntimeUrlIssuanceDecision` and keyed only by the safe Kanban slot kind.
- Added app-owned in-memory Kanban owner-gate bookkeeping refreshed beside the Source owner gate. It stores only safe labels/booleans and never stores URL values, project ids/names, paths, Browser/Source/Manage state, runtime payloads, logs, persistence, hidden mounts, or `Entity<CefSurface>`.
- Wired Kanban render through the new owner gate before the existing `materializable_request()` hook can matter, so the colored placeholder remains the only rendered Kanban body until the real runtime gate permits replacement.
- Kept runtime behavior unchanged: no URL authority, issued URL, CefSurface entity, normal-layout CEF child surface, hidden/offscreen mount, private runtime data/logging/persistence, replacement permission, or placeholder replacement was added.
- Added focused source assertions proving the gate is Kanban-only, CEF-only, normal-layout-only, rejects missing and non-Kanban decisions, emits privacy JSON without URL schemes/hosts/private payloads, stores no CefSurface entity, and keeps render placeholder-only until the gate permits replacement.
- Added a Phase 10 source-ledger row for the Kanban runtime CEF surface owner gate as accepted evidence only, not runtime signoff.
- Updated the parity requirements and missing-parity handoff docs so slice 267 is recorded as Kanban runtime CEF surface owner/creation-gate scaffolding, not runtime CEF instantiation, URL issuance, or placeholder replacement.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: real Kanban URL authority, actual issued runtime URL, Kanban CefSurface creation, placeholder replacement permission, Source/Kanban/Manage runtime implementation, Browser runtime checking, and validation/app evidence remain deferred to future work/outside this workflow.

### 2026-06-24-07:00 Task slice 268

<!--
CDXC:GPUIProjectWorkareaManageRuntimeCefSurfaceOwnerGate 2026-06-24-07:00:
This Manage-only runtime CEF/file-bridge owner/creation gate is implementation prep after the Manage runtime URL issuance decision. It keeps Manage CEF-only and normal-layout-only, wires refresh/render bookkeeping to the future owner slot, and keeps placeholder replacement blocked until real URL authority, issued runtime URL, CEF surface creation, runtime file-bridge mounting, runtime file-operation execution, and explicit replacement permission exist without storing URL values, project identity, private file/runtime payloads, hidden mounts, logs, persistence, or a CefSurface entity.
-->

- Added `ProjectWorkareaManageRuntimeCefSurfaceOwnerGate` in `gpui/src/main.rs`, derived only from the existing Manage `ProjectWorkareaRuntimeUrlIssuanceDecision` and keyed only by the safe Manage slot kind.
- Added app-owned in-memory Manage owner-gate bookkeeping refreshed beside the Source and Kanban owner gates. It stores only safe labels/booleans and never stores URL values, project ids/names, paths, Browser/Source/Kanban state, file names/contents/operations, runtime payloads, logs, persistence, hidden mounts, or `Entity<CefSurface>`.
- Wired Manage render through the new owner gate before the existing `materializable_request()` hook can matter, so the colored placeholder remains the only rendered Manage body until the real runtime gate permits replacement.
- Kept runtime behavior unchanged: no URL authority, issued URL, CefSurface entity, normal-layout CEF child surface, runtime file bridge, runtime file operation, CEF/file-bridge payload, hidden/offscreen mount, private runtime data/logging/persistence, replacement permission, or placeholder replacement was added.
- Added focused source assertions proving the gate is Manage-only, CEF-only, normal-layout-only, rejects missing and non-Manage decisions, emits privacy JSON without URL schemes/hosts/private file payloads, stores no CefSurface entity, and keeps render placeholder-only until the gate permits replacement.
- Added a Phase 10 source-ledger row for the Manage runtime CEF/file-bridge owner gate as accepted evidence only, not runtime signoff.
- Updated the parity requirements and missing-parity handoff docs so slice 268 is recorded as Manage runtime CEF/file-bridge owner/creation-gate scaffolding, not runtime CEF instantiation, URL issuance, file-bridge mounting, file operations, or placeholder replacement.
- Parent review aligned the standalone parity summary table with the executable Phase 10 ledger so the Manage runtime CEF/file-bridge owner gate is listed beside the Source and Kanban owner gates.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: real Manage URL authority, actual issued runtime URL, Manage CefSurface creation, runtime file-bridge mounting, file-operation execution, placeholder replacement permission, Source/Kanban/Manage runtime implementation, Browser runtime checking, and validation/app evidence remain deferred to future work/outside this workflow.

### 2026-06-24-07:10 Task slice 269

<!--
CDXC:GPUIWorkspaceParityHandoff 2026-06-24-07:10:
Slice 269 cleans up a current-state wording mismatch after slice 268. Source, Kanban, and Manage owner gates remain accepted source-ledger guardrails against premature replacement, not current source-ledger blockers or runtime CEF/file-bridge surfaces.
-->

- Performed the bounded source-only mismatch audit across the requested Phase 10 source, requirements, handoff, and progress files.
- Found and corrected one stale Phase 1 acceptance sentence that described the Source/Kanban/Manage owner gates as source-ledger blockers. The handoff now matches the slice 268 state: no current source-ledger blockers remain, and the owner gates are guardrails until future runtime CEF/file-bridge creation and placeholder replacement are deliberately implemented.
- Left the Source owner gate at slice 266, Kanban owner gate at slice 267, and Manage CEF/file-bridge owner gate at slice 268. The requirements summary table, blocker table, and executable Phase 10 ledger already listed the three owner-gate rows in that order with accepted source-ledger status and no missing gates.
- Files touched: `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining gaps: runtime Source/Kanban/Manage CEF/file-bridge instantiation, actual issued runtime URLs, placeholder replacement permission, Browser runtime checking, and validation/app evidence remain deferred to future work/outside this workflow.

### 2026-06-24-07:18 Task slice 270

<!--
CDXC:GPUIWorkspaceParityHandoff 2026-06-24-07:18:
Slice 270 records the latest requirement change: source-only CEF contracts are runtime parity for this pass, terminal is accepted as working, and runtime checks are user-side. Future web-pane work must stay CEF-only and must not add WKWebView/WebKit/non-CEF paths or fallback runtime probes.
-->

- Reconciled the parity requirements and handoff wording with the latest source-only runtime parity direction.
- Recorded that Source, Browser, Kanban, and Manage CEF-only source contracts are the current parity target for this workflow, while runtime execution/checking remains user-side rather than a queued agent blocker.
- Kept terminal accepted as working for the source-ledger purpose.
- Preserved the CEF-only rule for all panes and explicitly kept WKWebView/WebKit/non-CEF paths rejected.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining source-ledger state: no current source-ledger blockers remain after slice 268 plus this requirement update; user runtime checks are outside this agent workflow.

### 2026-06-24-07:23 Task slice 271

<!--
CDXC:GPUIWorkspaceParityHandoff 2026-06-24-07:23:
This bounded docs-only audit removes active handoff wording that still treated source-only CEF parity as insufficient for this pass. Source, Browser, Kanban, and Manage CEF-only source contracts remain the accepted runtime parity target, terminal remains accepted, runtime checks are user-side, and future web panes must stay CEF-only with WKWebView/WebKit/non-CEF paths rejected.
-->

- Audited only `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, and `gpui/WORKSPACE_PARITY_PROGRESS.md` for stale runtime-queue, source-only insufficiency, and non-CEF wording after slice 270.
- Updated active Phase 5, Phase 6, Phase 7, and Phase 10 handoff wording that said source-only status did not satisfy runtime acceptance or that runtime acceptance remained blocked. The docs now say Source, Browser, Kanban, and Manage CEF-only source contracts are runtime parity for this pass while real CEF/file-bridge instantiation, placeholder replacement, and runtime checks are user-side or future explicit work.
- Left historical caveats that only say runtime behavior was not changed, placeholders were not replaced, or validation was skipped.
- Files touched: `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining source-ledger state: no current source-ledger blockers remain; Source/Browser/Kanban/Manage CEF-only source contracts are accepted for this pass; future runtime web-pane work must be CEF-only and reject WKWebView/WebKit/non-CEF paths.

### 2026-06-24-07:25 Task slice 272

<!--
CDXC:GPUIProjectEditorPlaceholders 2026-06-24-07:25:
This source-only UI-copy slice removes stale visible placeholder wording that said Source, Kanban, or Manage parity was deferred. The placeholders now describe current GPUI shell representation for the source-only/CEF-only parity pass without mounting CEF, replacing placeholders, exposing private details, or adding WKWebView/WebKit/non-CEF paths.
-->

- Updated Source, Kanban, and Manage placeholder body copy in `gpui/src/main.rs` so visible text no longer says workspace parity is deferred after the source-only runtime-parity requirement update.
- Added a CDXC source comment explaining that the copy must stay generic, private-detail-free, non-mounting, and aligned with the current source-only/CEF-only parity pass.
- Updated the active Phase 10 handoff explanation so cleanup is no longer described as waiting for real surfaces to land; it now refers to accepted source-ledger contracts and avoiding fake runtime surfaces.
- Files touched: `gpui/src/main.rs`, `docs/gpui-workspace-area-missing-parity-phases.md`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining source-ledger state: no current source-ledger blockers remain; runtime checks are user-side; future web-pane implementation, if requested, must remain CEF-only.

### 2026-06-24-07:27 Task slice 273

<!--
CDXC:GPUIProjectEditorPlaceholders 2026-06-24-07:27:
This source-only UI-copy slice aligns Source, Kanban, and Manage placeholder titles with the accepted source-only/CEF-only parity direction. Titles must be user-facing mode names while remaining non-mounting, private-detail-free, and free of WKWebView/WebKit/non-CEF runtime paths.
-->

- Updated Source, Kanban, and Manage placeholder titles in `gpui/src/main.rs` from stale `... placeholder` copy to the user-facing mode names `Source`, `Kanban`, and `Manage`.
- Updated the directly affected local placeholder-signature assertions so the source documents the intended visible title strings.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining source-ledger state: no current source-ledger blockers remain; source-only/CEF-only parity remains accepted for this pass; runtime checks stay user-side; future web-pane implementation must remain CEF-only and reject WKWebView/WebKit/non-CEF paths.

### 2026-06-24-07:30 Task slice 274

<!--
CDXC:GPUIProjectEditorSleepingPlaceholder 2026-06-24-07:30:
This source-only UI-copy slice makes sleeping/restored Source, Browser, Kanban, and Manage card messages surface-oriented instead of placeholder-oriented. The copy must stay private-detail-free, non-mounting, and aligned with the current source-only/CEF-only parity pass without WKWebView/WebKit/non-CEF paths.
-->

- Updated Source, Browser, Kanban, and Manage sleeping/restored card body copy in `gpui/src/main.rs` from `Activate this placeholder...` wording to `Activate this surface to restore it.`, while keeping each mode's shell-state retention sentence.
- Updated the directly affected local sleeping-placeholder signature assertions so the source records the intended visible strings exactly.
- Added a CDXC source comment documenting that sleeping/restored visible copy must stay surface-oriented, private-detail-free, non-mounting, and CEF-only for this parity pass.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining source-ledger state: no current source-ledger blockers remain; source-only/CEF-only parity remains accepted for this pass; runtime checks stay user-side; future web-pane work must remain CEF-only and reject WKWebView/WebKit/non-CEF paths.

### 2026-06-24-07:33 Task slice 275

<!--
CDXC:GPUICommandPaneControls 2026-06-24-07:33:
This source-only UI-copy slice keeps command-pane control chrome command-oriented instead of placeholder-oriented. The new-command control remains non-launching and private-detail-free, creating only the existing source shell state without terminal/CEF runtime work.
-->

- Updated the command-pane new-command control tooltip in `gpui/src/main.rs` from `New command placeholder` to `New command`.
- Added a CDXC source comment near the command-pane controls documenting that visible command-pane chrome should be command-oriented while the source-only control remains non-launching and private-detail-free.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining source-ledger state: no current source-ledger blockers remain; source-only/CEF-only parity remains accepted for this pass; runtime checks stay user-side; command-pane terminal/command source evidence remains source-only and non-launching for this slice.

### 2026-06-24-07:35 Task slice 276

<!--
CDXC:GPUITerminalPresentationState 2026-06-24-07:35:
This source-only UI-copy slice keeps terminal presentation-state messages terminal-oriented instead of placeholder-oriented. Sleeping and mounting copy must honestly describe pending wake/materialization state while remaining non-launching, private-detail-free, and runtime-check deferred to the user.
-->

- Updated terminal Sleeping and Mounting presentation-state body copy in `gpui/src/main.rs` so visible messages no longer say `placeholder body` or `pending placeholder`.
- Preserved the runtime semantics: Sleeping still describes selected-but-sleeping state and activation into wake startup pending; Mounting still describes pending startup/materialization and focus-only clicking that does not mark the terminal running.
- Added a CDXC source comment documenting that terminal visible copy should remain terminal-oriented, source-only, non-launching, and private-detail-free.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Checks skipped by explicit user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining source-ledger state: no current source-ledger blockers remain; terminal remains accepted as working for this source-ledger pass; runtime checks stay user-side.

### 2026-06-24-07:38 Task slice 277

<!--
CDXC:GPUITerminalMissingSessionCopy 2026-06-24-07:38:
This source-only UI-copy slice keeps selected-terminal missing-session body copy terminal/surface-oriented and private-detail-free. Runtime checks remain user-side, validation/app commands stay deferred, and future web-pane work remains CEF-only with WKWebView/WebKit/non-CEF paths rejected.
-->

- Updated the selected-terminal missing-session body copy in `gpui/src/main.rs` so it describes the unavailable terminal session and terminal surface instead of implementation placeholder/mounting details.
- Added a nearby CDXC source comment documenting the terminal-oriented, private-detail-free, source-only/runtime-check-deferred copy requirement.
- Found no separate direct exact-string local assertions to update for this copy.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- No validation/app commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining source-ledger state: terminal remains accepted as working for this source-only parity pass; runtime checks stay user-side.

### 2026-06-24-07:41 Task slice 278

<!--
CDXC:GPUIWorkspaceParityHandoff 2026-06-24-07:41:
Slice 278 aligns GPUI source comments with the current source-only/CEF-only parity requirement. Source, Kanban, and Manage source-ledger contracts are accepted for this pass, future web-pane runtime replacement must be explicit and CEF-only, and runtime checks remain user-side with no WKWebView/WebKit/non-CEF path.
-->

- Updated stale CDXC/source comments in `gpui/src/main.rs` only, leaving behavior and tests unchanged.
- Reworded project-editor placeholder, sleeping-placeholder, Source lifecycle, Source readiness, project snapshot, Kanban/Manage readiness, Manage CEF/file-bridge, and Phase 10 ledger comments so accepted source-ledger CEF/file-bridge contracts are no longer described as blocked, missing, or merely waiting for a future source-ledger contract.
- Preserved the runtime caveats: no runtime code-server/CEF launch, no runtime URL issuance, no CEF/file-bridge creation, no file I/O, no placeholder replacement, no private URL/path/payload/log persistence, and no WKWebView/WebKit/non-CEF path.
- No validation/app commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.

### 2026-06-24-07:46 Task slice 279

<!--
CDXC:GPUIWorkspaceParityCommentCleanup 2026-06-24-07:46:
Slice 279 is source-only comment cleanup for GPUI Phase 10 ledger/test comments. Source, Browser, Kanban, and Manage source-ledger CEF contracts are accepted for this pass, terminal is accepted as working, runtime checks are user-side, and future web-pane runtime work must be explicit, CEF-only, normal-layout-only, privacy-safe, and reject WKWebView/WebKit/non-CEF paths.
-->

- Reworded owner-gate CDXC comments in `gpui/src/main.rs` so Source, Kanban, and Manage runtime CEF/file-bridge gates describe future prerequisites and replacement permissions instead of current source-ledger blocker or blocked-until wording.
- Reworded Browser runtime parity test comments so Browser source-ledger CEF contracts are accepted for this pass while runtime checking and any future CEF lifecycle work remain user-side/future explicit work.
- Preserved the no-runtime caveats: no CEF/file-bridge/runtime surface creation, no URL/file/private payload persistence or logging, no hidden/offscreen mounts, unsupported import remains no-op, blank popups do not transfer, restored placeholders remain placeholders, Browser stays hide-and-hold, and all future web panes are CEF-only with no WKWebView/WebKit/non-CEF path.
- Files touched: `gpui/src/main.rs`, `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- No validation/app commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.

### 2026-06-24-07:49 Task slice 280

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-07:49:
Slice 280 is docs-only alignment after the source-comment cleanup. Source, Browser, Kanban, and Manage source-ledger CEF contracts are accepted for this pass, terminal is accepted as working, runtime checks are user-side, and future web-pane runtime work must be explicit, CEF-only, normal-layout-only, privacy-safe, and reject WKWebView/WebKit/non-CEF paths.
-->

- Updated only `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded active Source, Kanban, and Manage owner-gate docs so slice 266-268 describe future runtime replacement prerequisites and explicit permission gates instead of current blocker/blocked-until wording.
- Reworded Browser runtime parity handoff docs so Browser source-ledger CEF contracts are accepted for this pass while unsupported import remains no-op, blank/script-created popups remain no-transfer, restored placeholders remain placeholders, hide-and-hold remains the accepted lifecycle policy, sanitized persistence and privacy/no logging/no persistence constraints remain intact, and runtime checks or future Browser CEF lifecycle changes remain user-side/future explicit work.
- This docs-only slice made no behavior or source code changes.
- No validation/app commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.

### 2026-06-24-07:55 Task slice 281

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-07:55:
Slice 281 is docs-only active Phase 5-7 handoff alignment. Source CEF/code-server, Kanban CEF, and Manage CEF/file-bridge source-ledger contracts are accepted after the 07:18 source-only/CEF-only requirement; active docs must not reopen those blockers while runtime instantiation, runtime URL issuance, file I/O, placeholder replacement, and runtime checks remain user-side or future explicit CEF-only work with no WKWebView/WebKit/non-CEF path.
-->

- Updated only `docs/gpui-workspace-area-missing-parity-phases.md`, `docs/gpui-workspace-area-parity-requirements.md`, and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reclassified stale active Phase 5-7 wording so historical Source mount, Kanban CEF mount, and Manage CEF/file-bridge blockers are described as superseded by accepted source-ledger contracts for this pass.
- Preserved the runtime caveats: no runtime CEF/code-server/file-bridge instantiation, no runtime URL issuance, no file I/O, no placeholder replacement, no runtime checks, and no WKWebView/WebKit/non-CEF path.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.

### 2026-06-24-08:02 Task slice 282

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-08:02:
Slice 282 is docs-only Phase 6 Kanban small-slice wording cleanup. Kanban source-ledger CEF contracts are accepted for this pass; readiness remains source-only and must not be widened into runtime CEF instantiation, runtime URL issuance, hidden mounts, placeholder replacement, fallback probes, logging/persistence/private payloads, or WKWebView/WebKit/non-CEF paths.
-->

- Updated only `docs/gpui-workspace-area-missing-parity-phases.md` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reclassified stale Phase 6 wording that implied the Kanban CEF mount contract was still missing or that lifecycle/readiness source evidence was not accepted for this pass.
- Preserved the runtime caveats: no runtime CEF browser, no runtime URL, no placeholder replacement, no hidden mount, no fallback probes, no logging/persistence/private payloads, and no WKWebView/WebKit/non-CEF path.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.

### 2026-06-24-08:04 Task slice 283

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-08:04:
Slice 283 is docs-only active Phase 1/2/4 acceptance wording cleanup. Phase 1 bridge contracts and Phase 2/4 terminal source evidence are accepted for the source-ledger pass, terminal is accepted as working, runtime proof remains user-side, validation/app/check commands stay banned, and future web panes remain CEF-only with no WKWebView/WebKit/non-CEF path.
-->

- Updated only `docs/gpui-workspace-area-missing-parity-phases.md` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reclassified stale active Phase 1 acceptance wording so project/sidebar bridge contracts are accepted source-ledger state while runtime/visual/app validation and real runtime surface work remain user-side or future explicit CEF-only work.
- Reclassified Phase 2 terminal wording so terminal source/runtime evidence is accepted as working for this pass while runtime proof remains user-side and privacy/no-persistence constraints remain intact.
- Reclassified Phase 4 command-terminal wording so command terminal source evidence remains separate from Agents and accepted for source-ledger purposes, while real command launch payload/status decisions, cross-surface runtime transfer, and runtime checks remain future product or user-side work.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.

### 2026-06-24-08:07 Task slice 284

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-08:07:
Slice 284 is docs-only Phase 2 heading cleanup. Active Phase 2 headings must reflect accepted terminal source evidence for this pass, with runtime proof remaining user-side, validation/app/check commands banned, and future web panes CEF-only with no WKWebView/WebKit/non-CEF path.
-->

- Updated only `docs/gpui-workspace-area-missing-parity-phases.md` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reclassified stale Phase 2 headings so `Remaining blockers and deferred pieces before acceptance:` now frames the list as user-side runtime proof, validation-forbidden evidence, and future terminal product decisions after accepted terminal source evidence.
- Reclassified `Acceptance remains pending:` as source-ledger invariants to preserve during later user-side runtime proof.
- This docs-only slice made no behavior or source code changes.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.

### 2026-06-24-08:09 Task slice 285

<!--
CDXC:GPUIKanbanLifecycle 2026-06-24-08:09:
Slice 285 is source-comment cleanup for Kanban lifecycle. Kanban source-ledger CEF contracts are accepted for this pass; source-only work counts as runtime parity here, terminal is accepted as working, runtime checks remain user-side, and sleep/wake/lifecycle remains separate from runtime CEF instantiation, runtime URL issuance, hidden mounts, placeholder replacement, real hide/suspend/wake proof, fallback probes, logging/persistence/private payloads, and WKWebView/WebKit/non-CEF paths.
-->

- Updated only `gpui/src/main.rs` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reclassified stale Kanban lifecycle/workarea CDXC wording that still treated shell sleep/wake as blocker evidence pending a separate CEF mount contract.
- Preserved behavior: source-only lifecycle comments now state accepted Kanban source-ledger CEF contracts while keeping runtime CEF instantiation, runtime URL issuance, hidden mounts, placeholder replacement, real hide/suspend/wake proof, fallback probes, logging/persistence/private payloads, and WKWebView/WebKit/non-CEF paths out of scope.
- Source-only work counts as runtime parity for this pass; terminal remains accepted as working and runtime checks stay user-side.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.

### 2026-06-24-08:13 Task slice 286

<!--
CDXC:GPUIProjectWorkareaLifecycle 2026-06-24-08:13:
Slice 286 is source-only Kanban/Manage lifecycle placeholder wording cleanup. Source-ledger CEF/file-bridge contracts are accepted for this pass; no source-ledger blockers remain, while runtime CEF/file-bridge instantiation, runtime URLs, placeholder replacement, runtime checks, and future web-pane work remain user-side or future explicit CEF-only work.
-->

- Updated only `gpui/src/main.rs` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded the Kanban/Manage placeholder lifecycle comment around project-scoped runtime availability so startup/load-failure and ready states are source-only/runtime-placeholder states after accepted CEF/file-bridge source-ledger contracts, with runtime CEF/file-bridge instantiation and placeholder replacement out of scope, user-side, or future explicit CEF-only work.
- Updated Source/Kanban/Manage Ready placeholder expect strings to say placeholders remain until explicit runtime placeholder replacement is permitted instead of implying missing mount contracts.
- No source-ledger blockers remain for this pass; runtime checks remain user-side.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.

### 2026-06-24-08:16 Task slice 287

<!--
CDXC:GPUIWorkspaceParityCommentCleanup 2026-06-24-08:16:
Slice 287 is source-only GPUI comment cleanup. Kanban source-ledger CEF contracts and Manage source-ledger CEF/file-bridge contracts are accepted for this pass; runtime CEF/file-bridge instantiation, runtime URL issuance, file I/O, explicit placeholder replacement permission, and runtime checks remain user-side/future explicit CEF-only work.
-->

- Updated only `gpui/src/main.rs` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded Kanban render comments so accepted source-ledger CEF contracts are no longer described as waiting for a materializable CEF path, future runtime CEF browser, or normal child CEF mount path.
- Reworded Manage sleep/wake test comments so accepted source-ledger CEF/file-bridge lifecycle contracts are no longer described as missing real CEF/file-bridge mount contracts or mounting/load-failed blockers.
- Reworded Source/Kanban/Manage placeholder signature test comments so loading, mounting, and load-failed states remain visible, generic, and non-mounting while ready/default placeholders remain until explicit runtime placeholder replacement is permitted.
- Preserved the prohibitions against CEF/file-bridge creation from these source paths, runtime URL issuance, file I/O, readiness synthesis, hidden mounts, fallback probes, private logging/persistence, non-CEF engines, and placeholder replacement.
- No source-ledger blockers remain for this pass; runtime checks and runtime CEF/file-bridge/placeholder replacement remain user-side or future explicit CEF-only work.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.

### 2026-06-24-08:19 Task slice 288

<!--
CDXC:GPUIWorkspaceParityCommentCleanup 2026-06-24-08:19:
Slice 288 is source/docs wording cleanup for remaining Kanban accepted-contract and sleep/wake phrasing. Kanban source-ledger CEF entrypoint, materialization, runtime-parity, lifecycle, and placeholder-preflight contracts are accepted for this pass; runtime checks plus runtime CEF/file-bridge/URL issuance/placeholder replacement remain user-side or future explicit CEF-only work.
-->

- Updated only `gpui/src/main.rs`, `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded remaining Kanban accepted-contract comments so source-ledger CEF entrypoint, materialization, and runtime-parity contracts are accepted for this pass instead of described as waiting for real CEF browser instantiation.
- Reworded Kanban sleep/wake comments so source-only lifecycle evidence preserves explicit project/board identity alongside accepted source-ledger lifecycle/CEF contract visibility without reopening source-ledger blockers.
- Preserved the prohibitions against non-CEF engines, runtime CEF creation, runtime URL issuance, private payloads, fallbacks, hidden mounts, logging/persistence, synthesized readiness, shell-state resets, and placeholder replacement without explicit future permission.
- No source-ledger blockers remain for this pass; runtime checks and runtime CEF/file-bridge/placeholder replacement remain user-side or future explicit CEF-only work.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.

### 2026-06-24-08:21 Task slice 289

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-08:21:
Slice 289 is docs/progress wording cleanup for Source Phase 5 accepted lifecycle state. Source loading/load-failed lifecycle visibility and static copy are accepted source-ledger evidence for this pass; runtime Source CEF/code-server instantiation, runtime URL issuance, first navigation, hide/suspend/wake proof, and placeholder replacement remain user-side or future explicit CEF-only work, and copy must not be promoted into runtime UI replacement or running-app evidence.

CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-08:21:
Review cleanup also reclassifies the remaining Phase 6 Kanban sleep/wake status sentence as accepted source-only lifecycle bridge state and copy instead of active bridge blockers. Runtime Kanban hide/suspend/wake proof, CEF instantiation, runtime URL issuance, and placeholder replacement remain user-side or future explicit CEF-only work.
-->

- Updated only `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded Source Phase 5 top-level requirements so accepted loading/load-failed lifecycle visibility and static placeholder copy are described as accepted source-ledger evidence while runtime Source work remains user-side or future explicit CEF-only work.
- Reworded the Source workarea table row to use lifecycle bridge states and copy for source-only loading/ready/load-failed evidence.
- Reworded the Phase 5 handoff status bullet so runtime Source hide/suspend/wake proof, CEF/code-server instantiation, runtime URL issuance, first navigation, and placeholder replacement are user-side or future explicit CEF-only work rather than active source-ledger blockers.
- Reworded the remaining Phase 6 Kanban sleep/wake status bullet so accepted lifecycle bridge states and copy are not described as active bridge blockers.
- No source-ledger blockers remain for this pass; runtime checks and runtime Source CEF/code-server/URL/navigation/placeholder replacement remain user-side or future explicit CEF-only work.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.

### 2026-06-24-08:24 Task slice 290

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-08:24:
Slice 290 is docs/progress wording cleanup for Phase 7 Manage small-slice status. Manage feature gating, project/workarea identity, availability/coercion, project-context routing, identity reset, lifecycle bridge states/copy, and shell sleep/wake identity preservation are accepted source-ledger evidence; runtime Manage CEF/file-bridge surface update/instantiation, runtime URL issuance, file I/O, placeholder replacement, hide/suspend/wake proof, and runtime checks remain user-side or future explicit CEF-only work.
-->

- Updated only `docs/gpui-workspace-area-missing-parity-phases.md` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded the Phase 7 Manage file/workarea bridge status to say `runtime bridge/file I/O not performed in this workflow` instead of treating no real bridge mount as an active source-ledger blocker.
- Reworded the Phase 7 Manage route active project context status so strict feature gating, explicit project/workarea identity, availability/coercion, project-context routing, and runtime identity reset are accepted source-ledger state for this pass.
- Reworded the Phase 7 Manage sleep/wake status so accepted source-only lifecycle bridge states/copy and shell sleep/wake identity preservation are source-ledger evidence for this pass.
- No source-ledger blockers remain for this pass; runtime Manage CEF/file-bridge/URL/file-I/O/placeholder replacement and runtime checks remain user-side or future explicit CEF-only work.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.

### 2026-06-24-08:27 Task slice 291

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-08:27:
Slice 291 is docs/progress wording cleanup for Phase 5 Source and Phase 6 Kanban small-slice and acceptance headings. Source CEF/code-server contracts and Kanban CEF contracts are accepted source-ledger state for this pass; runtime Source/Kanban CEF instantiation, runtime URL issuance, first Source navigation, hide/suspend/wake proof, placeholder replacement, and runtime checks remain user-side or future explicit CEF-only work.
-->

- Updated only `docs/gpui-workspace-area-missing-parity-phases.md` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded Phase 5 `Small slices` to `Small slices and source-ledger status`, changed `Mount the Source/code-server surface as a project-editor surface` to future explicit CEF runtime work only, and changed `Add Source sleep/wake` to future explicit CEF hide/suspend/wake proof.
- Reworded Phase 5 acceptance so current acceptance is Source CEF/code-server source-ledger parity, while `Source no longer shows the colored placeholder when awake and available`, runtime CEF/code-server instantiation, runtime URL issuance, first navigation, hide/suspend/wake proof, placeholder replacement, and runtime checks are future explicit CEF runtime/user-side work.
- Reworded Phase 6 `Small slices` to `Small slices and source-ledger status`, changed `Mount the bundled Kanban project board through a GPUI CEF surface` to future explicit CEF runtime work only, and changed `Add Kanban sleep/wake` to future explicit CEF hide/suspend/wake proof.
- Reworded Phase 6 acceptance so current acceptance is Kanban CEF source-ledger parity, while `Kanban is a real first-party project board surface when available`, runtime CEF instantiation, runtime URL issuance, hide/suspend/wake proof, placeholder replacement, and runtime checks are future explicit CEF runtime/user-side work.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: no source-ledger blockers remain; runtime Source/Kanban CEF/URL/navigation/hide-suspend-wake/placeholder replacement and runtime checks remain user-side or future explicit CEF-only work.

### 2026-06-24-08:32 Task slice 292

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-08:32:
Slice 292 is docs/progress wording cleanup for Phase 7 Manage small-slice and acceptance headings. Manage CEF/file-bridge source-ledger contracts are accepted for this pass; runtime Manage CEF/file-bridge instantiation, runtime URL issuance, file-operation execution, hide/suspend/wake proof, placeholder replacement, and runtime checks remain user-side or future explicit CEF-only work.
-->

- Updated only `docs/gpui-workspace-area-missing-parity-phases.md` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded Phase 7 `Small slices` to `Small slices and source-ledger status`, changed `Mount the bundled Manage page through a GPUI CEF surface` to future explicit CEF runtime/file-bridge work only, and preserved that the first-party CEF app-resource entrypoint, CEF materialization, source-only file-bridge mount, project-scoped file-operation proof, runtime-parity plan, and placeholder-preflight evidence already exist.
- Reworded Phase 7 Manage sleep/wake wording so real hide/suspend/wake proof applies only after future runtime CEF/file-bridge surface and bridge creation, while current lifecycle bridge states/copy and shell identity preservation remain accepted source-ledger evidence.
- Reworded Phase 7 acceptance so current acceptance is Manage CEF/file-bridge source-ledger parity with strict gating, project scope, hidden-when-gated, and disabled-without-project behavior preserved, while real Manage surface availability requires future runtime CEF browser instantiation, runtime URL issuance, runtime file-bridge mounting, project-scoped file-operation execution, and explicit placeholder replacement permission.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: no source-ledger blockers remain; runtime Manage CEF/file-bridge/URL/file-I/O/hide-suspend-wake/placeholder replacement and runtime checks remain user-side or future explicit CEF-only work.

### 2026-06-24-08:36 Task slice 293

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-08:36:
Slice 293 is docs/progress wording cleanup for Phase 8 Browser small-slice and acceptance wording. Browser generated profiles, active profile persistence, profile-owned tabs/surfaces, beta-only Profile visibility, unsupported/no-op import, Settings-selected feedback injection boundaries, tab-owned CEF identity, CEF-only hide-and-hold/restored-placeholder lifecycle, popup no-transfer behavior, shell sleep/wake preservation, sanitized persistence, strict readiness outside Phase 1, Phase 1 browserWorkareaId rejection, and existing tab-owned CEF visibility are accepted source-ledger state; runtime Browser checks and future importer/content-transfer/CEF lifecycle changes remain user-side or future explicit CEF-only work.
-->

- Updated only `docs/gpui-workspace-area-missing-parity-phases.md` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded Phase 8 `Small slices` to `Small slices and source-ledger status`.
- Reworded `Add Browser profile persistence`, `Add Browser feedback injection`, `Add runtime lifecycle management`, and `Recheck popup/content transfer` as accepted source-ledger state plus future explicit work only if requested, rather than queued implementation work.
- Kept `Add Browser import flow only if future importer work is explicitly requested` future-only with current unsupported/no-op behavior.
- Reworded Phase 8 acceptance so current acceptance is Browser CEF/source-ledger parity for this pass, while runtime Browser checks and future CEF lifecycle/importer/content-transfer work remain user-side or future explicit CEF-only work.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: no Browser source-ledger blocker remains; runtime Browser checks and future importer/content-transfer/CEF lifecycle changes remain user-side or future explicit CEF-only work.

### 2026-06-24-08:40 Task slice 294

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-08:40:
Slice 294 is docs/progress wording cleanup for Phase 3 terminal lifecycle and Phase 4 command terminal source-ledger labels. Terminal and command terminal source/runtime evidence remains accepted for this pass; runtime proof remains user-side, validation/app/check commands remain outside this workflow, and command launch payload plus real command status work remains future explicit product work.
-->

- Updated only `docs/gpui-workspace-area-missing-parity-phases.md` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded Phase 3 `Source-represented lifecycle slices` to `Accepted source-represented terminal lifecycle evidence` and changed the bullet labels from implementation-style work items to accepted evidence labels for shell/runtime identity, startup placeholder metadata handoff, close-confirm teardown, and placeholder activation/restored-materialization/parked-owner wake-reattach/retry evidence.
- Reworded Phase 4 `Accepted source-represented command-runtime slices` to `Accepted source-represented command terminal evidence` and changed the bullet labels from queued command implementation items to accepted evidence labels for command-body terminal mount evidence, the command config boundary with future launch/status decisions, semantic status metadata, and teardown/final-close collapse.
- Preserved the source-status details for startup geometry and launch plans, hidden startup host/surface ownership, metadata readiness/failure snapshots, ready handoff, restored materialization, parked-owner wake/reattach, close-confirm UI/ABI/exact removal, privacy boundaries, no validation/app proof, user-side runtime proof, accepted command terminal evidence, empty production command launch payload source, and future command launch/status product decisions.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: terminal and command source-ledger evidence remains accepted for this pass; runtime proof remains user-side; real command launch payload product contract/policy/producer and real command process/status source remain future explicit product work.

### 2026-06-24-08:39 Task slice 295

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-08:39:
Slice 295 aligns the remaining Source persistence label with the source-only runtime-parity rule. Source persistence privacy-boundary evidence is accepted for this source-ledger pass; runtime Source CEF/code-server instantiation, URL issuance, first navigation, hide/suspend/wake proof, placeholder replacement, runtime checks, and validation/app/check commands remain user-side or future explicit CEF-only work.
-->

- Updated only `docs/gpui-workspace-area-missing-parity-phases.md` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded the remaining Phase 5 Source lifecycle persistence bullet from queued work into accepted source-ledger evidence while preserving the privacy boundary: safe shell metadata only, no editor buffers, project paths, file paths, URLs, titles, code contents, code-server details, or load-failure details.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: Source source-ledger evidence remains accepted for this pass; runtime Source CEF/code-server instantiation, runtime URL issuance, first navigation, hide/suspend/wake proof, placeholder replacement, and runtime checks remain user-side or future explicit CEF-only work.

### 2026-06-24-08:41 Task slice 296

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-08:41:
Slice 296 is docs/progress cleanup for the Phase 3 popped-out parked-owner/reattach wording. The no-duplicate parked-owner/reattach contract remains accepted source-ledger evidence for this pass; running/app proof remains user-side outside the current no-validation workflow and is not a source-ledger blocker.
-->

- Updated only `docs/gpui-workspace-area-parity-requirements.md` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded the stale Phase 3 popped-out sentence so the exact parked-owner/no-duplicate reattach contract is accepted source-ledger evidence rather than a blocker.
- Clarified that running/app proof stays user-side outside this no-validation workflow and does not block the source ledger.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: terminal remains accepted as working/source-ledger state for this pass; runtime proof remains user-side; Source/Browser/Kanban/Manage runtime surfaces remain CEF-only.

### 2026-06-24-08:44 Task slice 297

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-08:44:
Slice 297 is docs-only Phase 10 guardrail wording cleanup. The Phase 10 table is source-ledger guardrail evidence with accepted evidence and runtime/user-side caveats, not current signoff blockers; Source, Browser, Kanban, and Manage remain CEF-only for this pass, terminal remains accepted as working, and runtime checks stay user-side.
-->

- Updated only `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded the Phase 10 table heading, intro, and headers from signoff/current-blocker framing to source-ledger guardrail evidence, accepted source-ledger evidence, and runtime/user-side caveats.
- Reworded the matching Phase 10 handoff reference so it points to the renamed guardrail table and does not imply current blockers.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: no current source-ledger blockers remain; Source/Browser/Kanban/Manage remain CEF-only source-ledger accepted for this pass; runtime checks remain user-side or future explicit CEF-only work.

### 2026-06-24-08:46 Task slice 298

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-08:46:
Slice 298 is source/docs/comment cleanup for current Phase 10 guardrail-ledger terminology. The mirrored source ledger/table is a source-level guardrail ledger/table with accepted evidence and runtime/user-side caveats, not current signoff blockers; source-only assumptions without explicit contracts still do not clear guardrails or authorize placeholder replacement, runtime signoff, or validation.
-->

- Updated only `docs/gpui-workspace-area-missing-parity-phases.md`, `docs/gpui-workspace-area-parity-requirements.md`, `gpui/src/main.rs`, and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded active Phase 10 references from source-level blocker ledger/table/map terminology to source-level guardrail ledger/table/map terminology while preserving explicitly historical blocker-map context.
- Updated GPUI Phase 10 CDXC comments so the current executable source ledger records accepted guardrail evidence and runtime/user-side caveats, with no current source-ledger blockers after slice 268.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: no current source-ledger blockers remain; Source/Browser/Kanban/Manage remain CEF-only source-ledger accepted for this pass; runtime checks and real runtime CEF/file-bridge/URL/placeholder-replacement work remain user-side or future explicit CEF-only work.

### 2026-06-24-08:51 Task slice 299

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-08:51:
Slice 299 narrows Phase 10 acceptance from final/runtime parity wording to source-ledger acceptance for this pass. Terminal and command pane evidence, Source/Browser/Kanban/Manage CEF-only source-ledger parity, and layout/focus/sleep/wake/persistence guardrails are accepted for the source ledger; runtime checks stay user-side, and future real web-pane work must be explicit, CEF-only, privacy-safe, normal-layout-only, and avoid fallback paths, private payloads, non-CEF paths, hidden overlap, and accidental placeholder replacement.
-->

- Updated only `docs/gpui-workspace-area-missing-parity-phases.md` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded Phase 10 acceptance so it no longer claims GPUI final/runtime parity with macOS workspace-area behavior.
- Stated the current acceptance as source-ledger evidence and guardrails for terminal, command pane, Browser, Source, Kanban, Manage, layout, focus, sleep/wake, and persistence, with source-only CEF parity accepted for Browser, Source, Kanban, and Manage and runtime checks remaining user-side.
- Preserved the future-work guardrails: real runtime web-pane work must be explicit, CEF-only, privacy-safe, normal-layout-only, and avoid fallback paths, WKWebView/WebKit/non-CEF paths, private payloads/logging/persistence, hidden or overlapping interactive surfaces, and accidental placeholder replacement.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: no current source-ledger blockers remain; Phase 10 is accepted as a source-ledger guardrail/evidence pass only, while runtime checks and real runtime CEF/file-bridge/URL/placeholder-replacement work remain user-side or future explicit CEF-only work.

### 2026-06-24-08:54 Task slice 300

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-08:54:
Slice 300 is docs-only placeholder-retirement wording cleanup for Phase 10. Placeholder-only paths remain until future runtime facts exist: the matching real runtime CEF/code-server, CEF, or CEF/file-bridge surface as applicable, a normal-layout child surface, issued runtime URL/authority where applicable, explicit placeholder replacement permission, and user/runtime proof; accepted source-ledger materialization contracts alone do not authorize removal.
-->

- Updated only `docs/gpui-workspace-area-parity-requirements.md`, `docs/gpui-workspace-area-missing-parity-phases.md`, and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded the early Phase 10 placeholder-retirement CDXC requirement so source-ledger materialization/runtime-parity/preflight/URL-boundary/owner-gate contracts remain accepted for this pass but cannot by themselves authorize placeholder removal.
- Reworded the active Phase 10 current-status and small-slices bullets so placeholder-only code paths stay until the matching runtime CEF/code-server, CEF, or CEF/file-bridge surface exists as applicable, normal-layout child ownership exists, URL authority/issued runtime URL exists where applicable, explicit replacement permission exists, and user/runtime proof exists.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: no current source-ledger blockers remain; source-only CEF parity for Source/Browser/Kanban/Manage remains accepted for this pass, while runtime checks and real runtime CEF/code-server/CEF/file-bridge/URL/placeholder-replacement work remain user-side or future explicit CEF-only work.

### 2026-06-24-08:56 Task slice 301

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-08:56:
Slice 301 is docs-only Suggested Orchestrator Order cleanup. User-side runtime-check wording must list only Source, Browser, Kanban, and Manage for this source-ledger pass because terminal is already accepted as working/source-ledger state; future web-pane runtime work remains CEF-only and must reject WKWebView/WebKit/non-CEF paths.
-->

- Updated only `docs/gpui-workspace-area-missing-parity-phases.md` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded Suggested Orchestrator Order item 2 so it asks the user to runtime-check only Source, Browser, Kanban, and Manage behavior.
- Recorded terminal as already accepted working/source-ledger state for this pass instead of listing it as remaining user runtime-check work.
- Preserved the validation/app/check command ban and the future CEF-only requirement for Source, Browser, Kanban, and Manage runtime paths.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: no current source-ledger blockers remain; Source/Browser/Kanban/Manage runtime checks remain user-side; terminal remains accepted as working/source-ledger state; future Source/Browser/Kanban/Manage runtime surfaces remain CEF-only with WKWebView/WebKit/non-CEF paths rejected.

### 2026-06-24-08:59 Task slice 302

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-08:59:
Slice 302 is docs-only Phase 10 current-status lifecycle wording cleanup. Source loading/ready/load-failed state and Manage lifecycle state/copy are accepted source-only lifecycle bridge evidence for this pass, not source-ledger blockers; runtime checks remain user-side and future Source/Browser/Kanban/Manage runtime work must be explicit, CEF-only, privacy-safe, normal-layout-only, and reject WKWebView/WebKit/non-CEF paths.
-->

- Updated only `docs/gpui-workspace-area-missing-parity-phases.md` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded the active Phase 10 Source current-status bullet so loading/ready/load-failed states are accepted source-only lifecycle bridge state/copy evidence instead of blocker states.
- Reworded the active Phase 10 Manage current-status bullet so lifecycle state/copy is accepted source-only lifecycle bridge evidence instead of blocker wording.
- Preserved the runtime caveat: Source/Browser/Kanban/Manage runtime checks remain user-side, and future Source/Browser/Kanban/Manage runtime work remains explicit CEF-only work with WKWebView/WebKit/non-CEF paths rejected.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: no current source-ledger blockers remain; Source/Browser/Kanban/Manage source-only CEF parity remains accepted for this pass; runtime Source/Browser/Kanban/Manage checks remain user-side; terminal remains accepted as working/source-ledger state.

### 2026-06-24-09:03 Task slice 303

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-09:03:
Slice 303 records the latest source-only parity requirement. Source-only implementation evidence is the runtime-parity unit for this pass, terminal is accepted as working, Source/Browser/Kanban/Manage panes must stay CEF-only for cross-platform parity, and WKWebView/WebKit/non-CEF names may appear only as rejected labels or guardrail evidence, never implementation targets or fallback paths.
-->

- Updated only `docs/gpui-workspace-area-parity-requirements.md`, `gpui/src/main.rs`, and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded the stale terminal clipboard/physical-key CDXC sentence so it no longer says terminal/command parity remains unresolved after slice 253 acceptance.
- Renamed the active Phase 10 status column from `Remaining gap` to `Runtime/user-side caveats` to match the current source-ledger acceptance model.
- Added source/docs comments recording that Source, Browser, Kanban, and Manage remain CEF-only and that WKWebView/WebKit/non-CEF paths are rejected labels or guardrail evidence only.
- Removed the Browser runtime-parity WKWebView-shaped source/privacy JSON capability and the matching helper/assertions so Browser exposes the accepted `cef` engine plus generic unsupported-engine rejection instead.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: no current source-ledger blockers remain; source-only CEF parity for Source/Browser/Kanban/Manage counts for this pass; terminal remains accepted as working; runtime Source/Browser/Kanban/Manage checks remain user-side.

### 2026-06-24-09:07 Task slice 304

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-09:07:
Slice 304 is a source-only docs/progress alignment for the Browser privacy JSON tightening. Browser runtime-parity evidence should expose only the accepted `cef` engine label plus generic unsupported-engine rejection; WKWebView/WebKit-specific capability fields must stay absent, and WKWebView/WebKit/non-CEF names remain rejected-label or guardrail evidence only.
-->

- Updated only `docs/gpui-workspace-area-parity-requirements.md` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Added the Browser runtime-parity CDXC requirement that privacy JSON exposes only the accepted `cef` engine plus generic unsupported-engine rejection, without WKWebView/WebKit-specific capability fields.
- Aligned the active Browser guardrail row to describe the tightened privacy JSON shape without claiming runtime CEF creation, import/content transfer, suspend/teardown, hidden surfaces, or restored-placeholder replacement.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: no current source-ledger blockers remain; source-only CEF parity for Source/Browser/Kanban/Manage counts for this pass; terminal remains accepted as working; runtime Source/Browser/Kanban/Manage checks remain user-side.

### 2026-06-24-09:09 Task slice 305

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-09:09:
Slice 305 is a source-only docs/progress alignment for the active Browser handoff after slice 304. Browser runtime-parity privacy JSON exposes only the accepted `cef` engine label plus generic unsupported-engine rejection, with no WKWebView/WebKit-specific capability fields; runtime checks remain user-side.
-->

- Updated only `docs/gpui-workspace-area-missing-parity-phases.md` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Added Browser runtime-parity CDXC comments to the missing-parity handoff that capture the tightened privacy JSON shape: accepted `cef` engine label plus generic unsupported-engine rejection only, with no WKWebView/WebKit-specific capability fields.
- Reworded the active Browser Phase 8 combined handoff and acceptance bullets so they mention the source-only CEF/privacy JSON shape while preserving existing tab-owned CEF visibility and avoiding any claim of runtime CEF creation.
- Reworded the Phase 10 current-status Browser and shared pane-engine bullets so active handoff state now matches slice 304 without changing historical context or queuing runtime checks.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: no current source-ledger blockers remain; Browser source-only CEF parity stays privacy-safe and CEF-only; source-only CEF parity for Source/Browser/Kanban/Manage counts for this pass; terminal remains accepted as working; runtime Source/Browser/Kanban/Manage checks remain user-side.

### 2026-06-24-09:12 Task slice 306

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-09:12:
Slice 306 is source-only Phase 10 status alignment for the Browser shell/runtime row. Browser runtime parity now records existing tab-owned CEF visibility, accepted `cef` engine evidence, generic unsupported-engine rejection, and no WKWebView/WebKit-specific capability fields; no runtime CEF creation, import transfer, suspend/teardown, hidden surface, private persistence/logging, restored-placeholder replacement, or agent-side runtime check was added.
-->

- Updated only `docs/gpui-workspace-area-parity-requirements.md` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded the Phase 10 status table `Browser shell/runtime` row so the source-only runtime-parity plan now names the tightened privacy JSON shape: accepted existing tab-owned CEF visibility, accepted `cef` engine label, generic unsupported-engine rejection, and no WKWebView/WebKit-specific capability fields.
- Preserved the Browser caveats: no runtime CEF creation, import/content transfer, runtime suspend/teardown, hidden surfaces, private logging/persistence, restored-placeholder replacement, active-project Browser identity widening, or agent-side runtime checks.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: no current source-ledger blockers remain; Browser source-only CEF parity stays privacy-safe and CEF-only; Source/Browser/Kanban/Manage runtime checks remain user-side; terminal remains accepted as working.

### 2026-06-24-09:15 Task slice 307

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-09:15:
Slice 307 is source-only Phase 10 pane-engine policy alignment. The shared Source/Browser/Kanban/Manage CEF-only policy now carries Browser privacy JSON evidence as accepted `cef` plus generic unsupported-engine rejection, with no WKWebView/WebKit-specific capability fields and no runtime CEF, URL, code-server, file-bridge, file I/O, hidden/private surface, placeholder replacement, or non-CEF path.
-->

- Updated only `docs/gpui-workspace-area-parity-requirements.md` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded the active Phase 10 `Project-workarea pane engine policy` row and the source-ledger guardrail `Project-workarea pane-engine policy` row so the shared Source/Browser/Kanban/Manage CEF-only evidence also records the Browser privacy JSON shape: accepted `cef` only, generic unsupported-engine rejection, and no WKWebView/WebKit-specific capability fields.
- Preserved the caveats: no runtime CEF creation, runtime URL issuance, code-server startup, file bridge, file I/O, hidden surfaces, private logging/persistence, CEF/file-bridge payloads, placeholder replacement, or WKWebView/WebKit/non-CEF paths were added.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: no current source-ledger blockers remain; Source/Browser/Kanban/Manage stay CEF-only for this source-ledger pass; Browser runtime-parity JSON stays privacy-safe; runtime checks remain user-side; terminal remains accepted as working.

### 2026-06-24-09:19 Task slice 308

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-09:19:
Slice 308 keeps the active progress ledger itself grepable for the latest CEF-only/source-only requirement. Slices 306 and 307 now carry CDXC comments that source-only runtime parity accepts CEF evidence only, Browser privacy JSON exposes accepted `cef` plus generic unsupported-engine rejection, terminal is accepted as working, and runtime checks stay user-side with no WKWebView/WebKit/non-CEF path.
-->

- Updated only `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Added missing CDXC progress comments to slices 306 and 307 so the active handoff records the tightened Browser privacy JSON shape and shared CEF-only Source/Browser/Kanban/Manage pane-engine policy in the same grepable requirement format as adjacent slices.
- Removed the stale exact WKWebView-shaped capability symbol name from progress prose now that the source/privacy JSON field itself is gone.
- Preserved scope: no runtime CEF creation, URL issuance, code-server startup, file bridge, file I/O, hidden surfaces, private logging/persistence, placeholder replacement, validation queueing, app launch/restart, or WKWebView/WebKit/non-CEF path was added.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: no current source-ledger blockers remain; source-only CEF parity for Source/Browser/Kanban/Manage counts for this pass; terminal remains accepted as working; runtime Source/Browser/Kanban/Manage checks remain user-side.

### 2026-06-24-09:22 Task slice 309

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-09:22:
Slice 309 aligns the Phase 1 active handoff with the latest source-only runtime-parity requirement. Phase 1 source-side bridge evidence counts as the source-only runtime-parity unit for this pass, while validation, app launch/restart, visual automation, and running-app proof remain user-side checks and Browser identity remains excluded from the active-project snapshot.
-->

- Updated only `docs/gpui-workspace-area-missing-parity-phases.md` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded the Phase 1 active handoff so source-side bridge evidence counts as the source-only runtime-parity unit for this pass instead of retaining stale `not runtime signoff` wording.
- Preserved the Phase 1 guardrails: `browserWorkareaId` remains invalid in the active-project snapshot, Browser readiness stays in the separate source-only boundary, and no Source/Kanban/Manage runtime CEF/file-bridge surface, placeholder replacement, fake project detection, fallback probing, hidden/overlapping hit region, private logging/persistence, WKWebView/WebKit path, or non-CEF path was added.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: no current Phase 1 source-ledger mismatch remains; source-only runtime parity remains accepted for this pass, terminal remains accepted as working, and runtime Source/Browser/Kanban/Manage checks remain user-side.

### 2026-06-24-09:24 Task slice 310

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-09:24:
Slice 310 is a source-only Phase 2 handoff wording fix. Terminal source/runtime evidence remains accepted as working for this pass, so Phase 2 keeps historical/runtime proof caveats without listing terminal as remaining user-side runtime-check work; Source/Browser/Kanban/Manage runtime checks remain user-side, future web panes stay CEF-only with WKWebView/WebKit/non-CEF paths rejected, and validation/app/check commands remain outside this workflow.
-->

- Updated only `docs/gpui-workspace-area-missing-parity-phases.md` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded the active Phase 2 terminal guardrails heading and the stale `User-side runtime checks outside this source-ledger slice` block so terminal is not queued as remaining runtime-check work for this pass.
- Preserved the technical caveats: terminal source/runtime evidence is accepted; no app launch, visual proof, interaction testing, or validation/check commands were run; physical-key behavior remains an accepted product difference without native physical-key forwarding; normal non-overlapping layout and no overlay/hit-test exceptions remain required; runtime/private terminal data stays out of shell-state JSON and persistent logs.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: no current Phase 2 terminal handoff wording mismatch remains; terminal remains accepted as working/source-ledger state for this pass; runtime Source/Browser/Kanban/Manage checks remain user-side and future web-pane runtime work remains CEF-only with WKWebView/WebKit/non-CEF paths rejected.

### 2026-06-24-09:27 Task slice 311

<!--
CDXC:GPUITerminalLifecycle 2026-06-24-09:27:
Slice 311 is a source-only Phase 3 terminal lifecycle handoff wording fix. Terminal is accepted as working for this pass, so Phase 3 preserves accepted source/runtime evidence, validation-forbidden caveats, clipboard/physical-key limits, explicit future launch-payload contracts, and no fallback startup/duplicate-owner rules without queuing terminal runtime proof/checks; Source/Browser/Kanban/Manage runtime checks remain user-side.
-->

- Updated only `docs/gpui-workspace-area-missing-parity-phases.md` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded the active Phase 3 terminal lifecycle handoff so accepted terminal source/runtime evidence is not listed as remaining user-side runtime proof/check work for this pass.
- Preserved the Phase 3 technical caveats: no validation/app/visual proof by agents, launch payload source remains an explicit future product contract, physical-key behavior remains an accepted product difference without native physical-key forwarding, clipboard handoff stays limited to exact still-mounted owners with standard clipboard, explicit-string reads, and runtime-text-only writes, and startup/reattach paths must not add fallback startup or duplicate-owner behavior.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: no current Phase 3 terminal lifecycle handoff wording mismatch remains; terminal remains accepted as working/source-ledger state for this pass; runtime Source/Browser/Kanban/Manage checks remain user-side and future web-pane runtime work remains CEF-only with WKWebView/WebKit/non-CEF paths rejected.

### 2026-06-24-09:29 Task slice 312

<!--
CDXC:GPUICommandTerminalRuntime 2026-06-24-09:29:
Slice 312 is a source-only Phase 4 command terminal handoff wording fix. Terminal and command terminal are accepted as working for this pass, so Phase 4 preserves explicit future command launch/status product decisions, exact clipboard handoff limits, physical-key product acceptance, and shell-only cross-surface transfer caveats without queuing command terminal runtime proof/checks; Source/Browser/Kanban/Manage runtime checks remain user-side.
-->

- Updated only `docs/gpui-workspace-area-missing-parity-phases.md` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Reworded the active Phase 4 command terminal handoff block so it no longer lists command close-confirm, running command-pane clipboard handoff, pinned/floating/collapsed/F12/tab/split/final-close behavior, or command/Agents isolation as active runtime proof/check work for this continuation.
- Preserved the Phase 4 technical caveats: future command launch payload policy/source and real command process/status remain explicit product decisions; GhosttyKit ABI/source evidence is accepted; clipboard handoff remains limited to exact still-mounted command owners, standard clipboard, explicit-string reads, runtime-text-only writes, no stale-owner use, and no private payload/logging/persistence; physical-key behavior remains accepted without native physical-key forwarding; cross-surface transfer remains shell-only unless future explicit product contracts are added.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, markdown whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: no current Phase 4 command terminal handoff wording mismatch remains; terminal and command terminal remain accepted as working/source-ledger state for this pass; runtime Source/Browser/Kanban/Manage checks remain user-side and future web-pane runtime work remains CEF-only with WKWebView/WebKit/non-CEF paths rejected.

### 2026-06-24-09:37 Task slice 313

<!--
CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-09:37:
Slice 313 records a progress-only source audit of the active Phase 8-10 handoff, requirements, and progress ledger. Source/Browser/Kanban/Manage source-only CEF parity counts for this pass, terminal and command terminal are accepted as working, runtime checks remain user-side, Phase 9 validation stays outside the agent workflow, and no concrete new source-ledger mismatch was found to patch.
-->

- Updated only `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Recorded that this source-only audit found the active Phase 8-10 handoff, requirements, and progress already aligned with the latest direction: Source/Browser/Kanban/Manage source-only CEF parity counts for this pass; terminal and command terminal are accepted as working; runtime checks remain user-side; Phase 9 validation remains outside the agent workflow; no concrete new source-ledger mismatch was found to patch.
- Preserved the accepted guardrails: no runtime checks, validation/app/check commands, app launch/restart, browser/visual automation, source-code edits, or requirements-doc edits were performed, and future web-pane runtime work remains CEF-only with WKWebView/WebKit/non-CEF paths rejected.
- Remaining state: no new source-ledger patch was needed; Source/Browser/Kanban/Manage source-only CEF parity remains accepted for this pass; terminal and command terminal remain accepted as working/source-ledger state; runtime checks remain user-side.

### 2026-06-24-10:12 Task slice 314

<!--
CDXC:GPUIProjectWorkareaRuntimeCefSurfaces 2026-06-24-10:12:
Slice 314 starts the permanent app-level Source/Kanban/Manage CEF runtime-surface wiring. GPUI now owns typed CefSurface storage for those slots and render/visibility helpers, but creation still requires a caller-provided real runtime URL value and existing replacement gates; absent URL authority keeps the placeholders without fake pages, WKWebView/WebKit, hidden mounts, fallback URLs, validation, app launch/restart, or visual automation.
-->

- Updated `gpui/src/main.rs` and `gpui/WORKSPACE_PARITY_PROGRESS.md`.
- Added app-owned Source/Kanban/Manage runtime CEF surface storage keyed by `ProjectWorkareaCefSurfaceSlotKey`, plus a real-runtime-URL wrapper that rejects blank, whitespace-mutated, non-navigable, and raw app-resource-label values instead of synthesizing URLs.
- Added helpers to create an owned `CefSurface` only from a real runtime URL at the visible replacement edge, prune stale owned workarea surfaces when gates disappear, show/hide existing surfaces through the normal active-mode visibility pass, and render the owned normal-layout CEF child before falling back to placeholders.
- Reworded the active gate/render comments and progress constraints so real CEF runtime surfaces are the implementation target, CEF is the only web-pane engine, and current placeholders mean real URL/process/file-bridge authority is absent rather than a temporary page or WebKit fallback path.
- No validation/app/check commands were run due to user instruction: no formatting, tests, checks, typecheck, cargo check/test/fmt, whitespace checks, `git diff --check`, app launch/restart, browser/visual automation, `bun run start`, or equivalent validation/app commands were run.
- Remaining state: Source/code-server still has no real navigable runtime URL/process authority in this slice, and Kanban/Manage still have no real existing navigable GPUI URL/resource authority or Manage file-bridge authority, so their placeholders remain until those facts exist.
