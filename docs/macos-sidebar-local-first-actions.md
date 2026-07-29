# macOS Sidebar Local-First Actions

> **Status note (2026-07-29).** The local-first requirements below still apply,
> but to the active desktop client. The macOS Swift/AppKit app (`native/`,
> `src/`) is deprecated — kept in-tree for reference, not a development target.
> Implement and verify these behaviors in the gpui desktop app (`gpui/`, which
> mounts the shared sidebar from `sidebar/`), not in the Swift app.

<!--
CDXC:LocalFirstSidebar 2026-06-02-10:25:
macOS sidebar actions that directly change visible project/session rows must commit their visible UI result locally before waiting for gxserver, native AppKit, zmx, or browser-pane acknowledgements. The sidebar should reconcile later backend presentation without briefly reintroducing stale rows, keeping context menus open, or flashing an empty workarea.
-->

## Purpose

This document captures the agreed macOS behavior for sidebar actions that need to feel local-first during the gxserver presentation cutover.

The requirement is simple: when the user performs a sidebar action, the visible result should happen immediately in the macOS UI. gxserver remains the shared source of truth for backend state, zmx sessions, lifecycle, titles, and shared presentation, but the macOS client owns the short-lived optimistic view needed to keep the sidebar feeling native.

## Definition

An action is local-first when:

- The clicked menu item, button, drag, or card selection visibly commits in the sidebar immediately.
- Context menus/popovers close synchronously on selection.
- Stale gxserver snapshots or delayed deltas cannot reinsert rows the user just closed or removed.
- The main workarea does not flash empty while the new selected session or browser pane is being created.
- Backend failure is reported with a toast/log and reconciled explicitly; it should not be hidden behind fallback behavior.

This is not a separate state model. It is a small macOS overlay on top of gxserver presentation while the backend catches up.

## Reconciliation Rules

- Local suppression wins over stale presentation. If the user just closed or removed a row, an older gxserver snapshot must not make it reappear.
- Local visibility wins for macOS-only panes. Quick browser panes, Quick file rows, editor panes, T3 panes, and browser panes that gxserver does not own must still render from native state.
- gxserver presentation wins for shared terminal/agent sessions once its delta arrives.
- Local overlays should be small and expire naturally when gxserver publishes the matching final state.
- Do not show "tombstone" UI rows. A closed or removed item should either disappear, or in the specific last-project-session case remain as a normal sleeping session row.
- Do not add fallback branches that mask wrong ownership. If gxserver should own an action, fix the gxserver path or presentation delta.

## Actions

| Action | Required local-first behavior | Backend reconciliation |
| --- | --- | --- |
| Click a session card | Focus and select the session immediately. If the row came from gxserver presentation but has no native local record yet, materialize enough local state to focus it. | gxserver focus/attach state may update later; it must not block selection. |
| Create terminal/session | Avoid publishing an empty selected slot before the native terminal surface exists. The sidebar and workarea should move together. | zmx-backed sessions are born in gxserver, then native creates the terminal and publishes the focused layout. |
| Create browser pane | Browser card appears immediately beside the relevant workspace/Quick rows, and the web pane is focused immediately. | Browser panes are macOS-local pane records; gxserver should not be required before rendering them. |
| Create Quick browser tab | The new browser tab appears in the Quick/Chats sidebar section immediately. | Quick browser rows are local macOS panes and must be merged into the gxserver presentation adapter. |
| Create Quick terminal/chat | The Quick row appears immediately and focuses immediately. | If a terminal becomes gxserver-backed, later presentation replaces the local projection for that terminal row. |
| Open Quick file | The loose file row appears immediately in Quick and uses the shared Quick Files editor surface. | Quick file rows are macOS-local rows; closing the row handles file-tab cleanup and symlink cleanup. |
| Close a normal non-final project session | The session card disappears immediately. | macOS sends the gxserver transition/close and suppresses stale deltas until gxserver removes or stops presenting the session. |
| Close the last visible session in a normal project | The project must not disappear. The final session remains visible and becomes sleeping immediately. | macOS parks the session through gxserver sleep instead of removing the row. |
| Close a Quick terminal session | The one-off Quick container disappears immediately when it becomes empty. | Native stored project state is updated locally; no empty Quick terminal container should remain. |
| Close a browser/T3/local pane | The card and native pane close immediately. | These panes are native-owned; gxserver presentation should not be required to remove the row. |
| Sleep a session | The context menu closes immediately and the card marks sleeping immediately. | gxserver/zmx sleep runs afterward; stale presentation must not keep the row looking awake. |
| Wake a sleeping session | The row wakes/focuses immediately enough to show user intent without a dead click. | gxserver attach/wake metadata and native surface creation reconcile the final lifecycle. |
| Close project | The project group disappears from the active sidebar immediately and moves to Recent Projects where applicable. | gxserver may still publish live sessions for that project; macOS suppresses that project locally until it is restored. |
| Remove project | The project row disappears immediately. | Any later gxserver project/session deltas for that removed project must not reinsert it into the active sidebar. |
| Restore recent project | The project returns to the active sidebar immediately and local suppression is cleared. | gxserver presentation can then hydrate live rows. |
| Add project | The project row appears immediately, even before the first session exists. | gxserver `addProjectPath`/create/update publishes a project presentation delta, and snapshots include empty projects. |
| Reorder projects | Drag order updates immediately. Moving a main project carries its worktrees with it. | The persisted local order remains the macOS ordering source until shared project ordering is fully owned by gxserver. |
| Reorder worktrees | A worktree can only move into slots directly below its main project or below another worktree of that same project. | Any backend/shared order update must preserve the same family constraint. |
| Pin/favorite session or project | The icon/state should toggle immediately. | gxserver persists the shared pinned/favorite state and later presentation confirms it. |
| Rename session | The visible title should update immediately for user-owned renames where the session type allows it. Agent metadata may later correct agent-owned titles. | gxserver owns canonical title source/provenance and reconciles metadata-backed titles. |
| Session activity/status changes | Spinners and status badges should change without waiting for a full sidebar snapshot. A stale spinner must clear after the agreed title-activity window. | gxserver coalesces title/status deltas and projects stale title-derived working state to attention/idle instead of leaving a frozen spinner. |

## Quick/Chats Section

Quick/Chats is a mixed ownership section:

- Terminal/agent chat sessions are gxserver presentation rows when gxserver owns the session.
- Browser chats and browser tabs are local macOS browser panes.
- Loose file rows are local macOS editor rows.

The presentation adapter must merge these sources into one Quick/Chats group. It should prefer gxserver rows for matching terminal sessions and append local-only browser/file rows that gxserver does not know about.

## Project And Worktree Ordering

Project ordering is local-first until shared ordering is fully moved into gxserver.

Required ordering behavior:

- Main projects can be dragged within the Projects section.
- Moving a main project moves its worktree family with it.
- Worktrees cannot be dragged outside their parent project's family.
- Worktrees can only be placed below their main project or below another worktree for the same main project.
- Presentation sorting must preserve this macOS ordering contract instead of falling back to raw gxserver sort keys whenever local order exists.

## Failure Handling

Local-first does not mean silent failure.

- If an optimistic backend action fails, show a clear error and log the failed operation.
- Revert only the local optimistic change that failed, if reverting is the correct user-visible result.
- Do not broadly refresh or reconstruct the old native session tree as a recovery path.
- Do not use compatibility fallbacks that make incorrect ownership harder to detect.

## Implementation Notes

- Keep local overlays scoped to project/session ids and reasons.
- Prune local suppressions when gxserver publishes matching absence/removal.
- For project hides, suppress the project group rather than each child session.
- For session hides, suppress only the specific project/session pair.
- For Quick local panes, render from native workspace state because gxserver does not own those panes.
- For zmx-backed terminal creates, publish after gxserver identity and native pane creation have enough state to prevent an empty-workarea flash.
