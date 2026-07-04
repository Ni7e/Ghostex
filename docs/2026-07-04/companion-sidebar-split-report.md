# macOS Companion Sidebar Split Report

Date: 2026-07-04

## Summary

The current macOS companion sidepane is a single native pane shown beside Source, Browser, Kanban, Project, and Manage mode surfaces. Sidebar session clicks already retarget that one companion pane instead of closing the project-editor surface or switching back to Agents.

The requested behavior changes that model from one companion slot to an optional two-slot companion layout. The active terminal/session should continue to appear as it does today. When the companion is split, a second slot should show the second most recently active eligible terminal/session, when available. Sidebar clicks should replace the currently focused companion slot with the clicked terminal/session.

## Current Behavior

- Companion visibility is project-owned state.
  - The sidebar stores whether the companion pane is hidden on the project record as `projectEditorCompanionPaneHidden`.
  - The native titlebar toggle hides or restores the companion pane.

- Native companion state is single-slot.
  - `TerminalWorkspaceView` tracks one selected companion session id.
  - It also tracks one rendered companion session id so the old visible native surface can be moved offscreen when the companion retargets.

- Native layout is a single left companion pane plus the editor/workarea pane.
  - `projectEditorCompanionLayout(...)` computes:
    - one companion frame
    - one editor frame
    - one right separator
    - one resize handle between companion and editor
    - one selected session id
  - The companion session is laid out through the same native pane frame path as other panes, but with `paneFrameMode: .projectEditorCompanion`, which gives it the shorter companion titlebar.

- Sidebar session clicks already have a companion-specific path.
  - In project-editor modes with a visible companion, sidebar clicks update sidebar focus state and send `retargetProjectEditorCompanionSession` to native.
  - Native handles that by focusing the requested session as the companion pane.
  - This avoids running the normal Agents-mode pane selection path, which would disturb the editor surface.

- Companion titlebar chrome currently suppresses generic pane actions.
  - The selected companion titlebar uses companion chrome so the generic pane overflow menu is hidden.
  - The main app titlebar owns the companion hide/show button.

## Requested Behavior

- Add a companion titlebar split menu.
  - The menu button should live on the right side of the companion pane titlebar.
  - It should use the same grid/layout icon shown in the provided screenshot.
  - Initial menu items:
    - `Split vertical`
    - `Split horizontal`
  - When split:
    - show a check next to the active split mode
    - add `Unsplit`

- Support exactly one split.
  - A companion pane can become two companion panes.
  - Choosing the other split mode should change orientation, not add a third pane.
  - `Unsplit` should return to the current single companion behavior.

- Preserve the primary companion behavior.
  - The active terminal/session should continue to be the first companion pane, matching today’s behavior.

- Fill the second companion slot from recent activity.
  - The second slot should use the second most recently active eligible session when one exists.
  - It should not create a new terminal just to fill the slot.

- Retarget the focused companion slot from sidebar clicks.
  - With no split, sidebar clicks keep today’s behavior: replace the single companion pane.
  - With split enabled, clicking a terminal/session in the sidebar should replace the currently focused companion slot.
  - The other companion slot should remain unchanged unless it conflicts with the clicked session.

## Key Differences

| Area | Current | Requested |
| --- | --- | --- |
| Companion count | One visible companion pane | One or two visible companion panes |
| State shape | One companion session id | Split mode plus up to two companion session ids |
| Default companion choice | Focused/selected session | Focused/selected session plus second last-active eligible session |
| Sidebar click target | Always the single companion pane | Currently focused companion slot when split, otherwise single pane |
| Titlebar action | Companion titlebar hides generic pane action menu | Companion titlebar gets a dedicated split menu |
| Layout | Companion + editor separated by one vertical boundary | Companion area may be internally split, then separated from editor |
| Native frame ownership | Non-overlapping AppKit frames | Must remain non-overlapping AppKit frames, including any new internal divider |

## Implementation Direction

### 1. Extend companion state

Native currently needs to know only one companion session. The split version needs:

- split mode: none, vertical, or horizontal
- primary companion session id
- secondary companion session id, optional
- focused companion slot/session id
- rendered companion session ids for both slots so replaced surfaces can be moved offscreen cleanly

The split mode should likely be persisted at the same project level as `projectEditorCompanionPaneHidden`. The selected second slot can be recomputed from last-active metadata when first enabling split, then retained while the user retargets slots.

### 2. Add a companion-specific titlebar menu

The icon from the screenshot already exists in native titlebar code as the workspace pane action menu glyph. Reuse that icon and button styling instead of adding a new asset.

The new menu should be companion-specific, not the generic pane actions menu. It should emit native actions such as:

- set companion split mode to vertical
- set companion split mode to horizontal
- unsplit companion

These actions should update the native/sidebar-owned companion state, then republish layout.

### 3. Split the companion layout, not the main workspace layout

The existing `projectEditorCompanionLayout(...)` function should evolve from returning one companion frame to returning a companion layout model with one or two companion slot frames.

When split is off:

- keep the existing companion frame and editor frame behavior

When split is on:

- keep the existing outer companion width behavior
- split only inside that companion region
- lay out both companion sessions with `setFrame(..., paneFrameMode: .projectEditorCompanion)`
- add a real native divider/resize rail only if resizing between the two companion slots is desired
- keep the existing companion/editor resize handle unchanged

This keeps the implementation aligned with the native layout rule: normal AppKit sibling/child frames, no transparent overlap or broad hit-test routing.

### 4. Choose the second session from last-active metadata

The sidebar projection already carries durable activity metadata through fields like `lastInteractionAt` and terminal records carry `lastActivityAt`.

The second companion slot should be selected by:

1. Start with active project sessions.
2. Filter to eligible companion sessions:
   - not sleeping
   - not mounting
   - not popped out
   - not command-panel-only
   - has a native terminal/web surface
3. Exclude the primary companion session.
4. Sort by last activity descending.
5. Use the first remaining session, if any.

The user wording says "terminal", so implementation should decide whether to strictly filter to terminal sessions or preserve the current companion behavior that can also surface T3/browser-style web panes.

### 5. Update sidebar click retargeting

The current sidebar path for project-editor mode already avoids changing the main workspace layout. That path should remain the entry point.

The native handler for `retargetProjectEditorCompanionSession` should change as follows:

- no split: replace the single companion session, same as today
- split enabled:
  - identify the focused companion slot
  - replace that slot with the clicked session
  - if the clicked session is already in the other slot, swap or no-op rather than duplicate it
  - focus the clicked slot so keyboard input follows the user’s click

### 6. Keep focused-border behavior literal

The current native border logic tries to show focus only when keyboard input actually routes to that terminal/web pane. Split companion support should preserve that rule:

- focusing a companion slot should update the focused companion session id
- AppKit first responder should move to that slot’s native surface
- the focused border should only appear on the slot that owns keyboard input

## Main Files To Touch

- `native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift`
  - companion state
  - companion layout
  - companion titlebar controls
  - native menu action handling
  - focus and border behavior

- `native/macos/ghostexHost/Sources/ghostexHost/HostProtocol.swift`
  - typed host commands/events for companion split mode if routed through the bridge

- `native/macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift`
  - command dispatch if new split commands cross the native/sidebar bridge

- `native/sidebar/native-sidebar.tsx`
  - persisted project state for split mode
  - second-last-active session selection if kept in sidebar state
  - layout sync payload to native
  - companion retarget semantics for split mode

- `shared/native-ghostty-host-protocol.ts`
  - TypeScript side of any new bridge fields or commands

## Risks And Open Questions

- Split orientation naming needs to match user expectation.
  - Existing pane actions use `splitHorizontal` for sideways and `splitVertical` for downward. The new labels should be validated against visual behavior so `Split vertical` and `Split horizontal` do not feel reversed.

- "Terminal" may mean terminal-only, or it may mean any companion-eligible session.
  - Current companion logic can route terminal and web-pane sessions. The requested copy says terminal, so this should be clarified before restricting existing behavior.

- Persistence scope should be explicit.
  - The hidden companion preference is per project. Split mode probably belongs in the same project-level state, but selected secondary session may be better treated as transient derived state.

- Duplicate session handling matters.
  - If a user clicks a sidebar session already visible in the other companion slot, the UI should avoid rendering the same native surface in two places.

- Internal companion resize was not requested.
  - A fixed 50/50 split is the simplest interpretation. Adding a new internal divider ratio would be additional behavior and should only happen if desired.

## Recommended First Pass

Implement the smallest complete version:

1. Persist split mode as none, vertical, or horizontal.
2. Use a fixed 50/50 internal split inside the companion region.
3. Fill the second slot from second last-active eligible session when enabling split.
4. Add the companion titlebar grid menu with checkmarks and `Unsplit`.
5. Retarget sidebar clicks to the focused companion slot.
6. Preserve existing single-companion behavior when split mode is none.

This delivers the requested UX without changing the main workspace split model or adding a second internal resize system.
