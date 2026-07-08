# Plan: gpui Agents view tab-split parity with the macOS app

## Overall goal

The gpui app (`gpui/src/main.rs`, one ~85k-line monolith) shows **empty split pane
areas** in the Agents view: a split exists where one side has no tabs — just a blank
dark pane with an empty tab bar. The macOS app never shows this. The user wants the
Agents view tab splitting and closely related behavior in the gpui app to work
**exactly** like the macOS app.

The macOS app is the **source of truth**. Its split logic lives in pure TypeScript:

- `shared/session-grid-contract-core.ts` — `SessionPaneLayoutNode` tree type (line 29):
  `leaf { sessionId }` | `tabs { sessionIds, activeSessionId }` | `split { children, direction, ratio? }`.
- `shared/simple-grouped-session-workspace-state.ts` (~5000 lines) — ALL mutation,
  collapse, normalization, and focus logic. Key functions (line numbers approximate):
  - `removeSessionFromPaneLayout` (:2874) — close/move-source collapse primitive. Empty
    leaf → removed; tabs with 0 ids → removed; tabs with 1 id → collapses to leaf; split
    with 0 children → removed; split with 1 child → unwrapped.
  - `normalizePaneLayout` / `normalizePaneLayoutNode` / `flattenPaneLayoutSplit`
    (:4018/:4061/:4103) — the general normalization pass: prunes session ids that no
    longer exist, collapses empties exactly as above, merges same-direction nested
    splits, and back-fills any visible session that ended up in no pane. **Run after
    every mutation and on every hydrate/restore** via `normalizeGroupSnapshot` (:2302).
    This is why an empty pane is structurally impossible on macOS.
  - `removeSessionInSimpleWorkspace` (:675) — close flow + focus replacement.
  - `getClosingPaneTabReplacementSessionId` (:2915) — same-pane close replacement:
    right sibling, else left.
  - `getClosingPaneSpatialReplacementSessionId` (:2937) — when a pane is destroyed and
    it held focus: prefer the collapsing branch's **sibling subtree** first
    (`getClosingPaneSiblingBranchCandidates` :3048), else nearest pane by geometry
    (shares-axis bonus + gap + center distance, `getPostClosePaneFocusScore` :3080).
  - `moveSessionInPaneLayoutInSimpleWorkspace` (:1796) — drag/move: remove from source
    first (collapses source), then insert; focus follows the moved session.
  - `getSamePaneSplitAnchorSessionId` (:3360) — dragging the ONLY tab of a pane onto
    its OWN edge is a **no-op** (no valid sibling anchor).
  - Native drop-zone hit test: edge band **0.24** of the pane rect per side
    (`native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift`
    `paneDropPlacement` :15962 — `x<=0.24 → left`, `x>=0.76 → right`, `y<=0.24 →
    bottom`, `y>=0.76 → top`, else center).

The gpui app already has most of the machinery (binary split tree `WorkspaceNode` =
`Split`/`Leaf`, drag-to-split, group-into-pane, collapse-on-close, resize rail,
persistence). The reported bug plus a few parity gaps remain; the phases below fix
them. gpui key symbols (all in `gpui/src/main.rs`, line numbers approximate — always
re-locate by symbol name, the file shifts):

- `WorkspaceModel` (:10271), `WorkspaceNode` (:10265), `WorkspaceSplit` (:10254),
  `WorkspaceLeaf` (:9576), `WorkspaceTabGroup` (:9570), `WorkspacePaneId` (:4852).
- `close_tab` (:10717), `remove_tab_for_move` (:11765), `collapse_empty_leaf` (:11776),
  `collapse_empty_workspace_leaf` (:14521), `workspace_empty_leaf_node` (:14553).
- `reconcile_with_sidebar_tab_sessions` (:11271) — **the bug site**, caller
  `reconcile_local_workspace_tabs_with_sidebar` (:31790).
- `group_tab_into_pane` (:11663), `split_tab_to_pane` (:11699),
  `reorder_tab_within_pane` (:11641), `insert_workspace_leaf_split` (:14468).
- Focus: `focused_pane`, `focus_pane` (:10546), `resolve_action_pane_id` (:11816),
  `workspace_close_focus_replacement_leaf_id` (:14416),
  `workspace_leaf_id_on_collapse_edge` (:14446), `first_workspace_leaf_id` (:14406).
- Rendering of the blank pane: `selected_agents_terminal_body_mount_candidate`
  (:10218, `EmptyWorkspacePlaceholder` branch :10239) →
  `render_terminal_body_slot` (:48651).
- Drop zones: `WorkspaceDropZone` (Center/Left/Right/Top/Bottom), drag payload
  `DraggedWorkspaceTab`, drop handlers around :43232-:43832 and :46725-:48272.

## Rules every worker MUST follow

1. **No tests.** Do not add any test code under `gpui/**` (repo rule: gpui is in flux,
   tests come later). Do not add tests to the macOS app trees either. If an existing
   test breaks because of your change, that's unexpected — stop and report BLOCKED.
2. **No fallbacks.** Fix root causes. Do not add defensive fallback rendering (e.g. "if
   pane empty, hide it in render") — the model must never contain a renderable empty
   pane in the first place (except the single intentional whole-empty-workspace leaf).
3. **Do not modify the macOS app** (`shared/`, `native/`, `src/`, `sidebar/`) — it is a
   read-only reference. Your only writable area is `gpui/src/main.rs` (and only if
   genuinely required, sibling `gpui/src/*.rs` files).
4. **Preserve the pre-existing uncommitted diff** in `gpui/src/main.rs` (a cosmetic
   change: Mounting placeholder renders blank/black, hunks near :48730, :48967, :58697).
   Never revert, reformat, or `git checkout`/`git restore` anything.
5. Never run the app, `bun run start`, or anything that restarts Ghostex. Verify by
   compilation: `cargo check` run from the `gpui/` directory must pass.
6. Match existing code style in `main.rs` (naming, comment density, CDXC comment
   convention only where the surrounding code uses it).
7. `gpui/src/main.rs` is ~85k lines / 3.3MB. Never read it whole; locate symbols with
   `rg -n "fn <name>" gpui/src/main.rs` and read targeted ranges.
8. There are THREE parallel pane systems in `main.rs`: Agents workspace (`Workspace*` /
   `agents_workspace`), Command pane (`CommandPane*`), Browser (`Browser*`). Only touch
   the Agents/`Workspace*` one unless a phase says otherwise.

---

## Phase 1: Empty-pane invariant — normalize the workspace tree like macOS

- depends_on: []
- parallel_ok: false
- goal: Make an empty split pane structurally impossible in the gpui Agents workspace,
  mirroring macOS `normalizePaneLayout`. Fix the production bug where
  `reconcile_with_sidebar_tab_sessions` prunes tabs from split leaves but never
  collapses leaves that end up empty, leaving a blank dark pane rendered (the user's
  screenshot). Also eliminate the follow-on ghost-state issues: focus pointing at an
  emptied leaf and the stale `active_tab = TerminalSessionId(0)` sentinel.
- files: `gpui/src/main.rs`
- do_not_touch: `shared/**`, `native/**`, `src/**`, `sidebar/**`, `gpui/src/terminal_*.rs`,
  Command-pane (`CommandPane*`) and Browser (`Browser*`) pane systems, the pre-existing
  uncommitted hunks listed in the rules.
- approach:
  1. Add a normalization method on `WorkspaceModel` (e.g.
     `normalize_workspace_tree(&mut self)` — pick a name consistent with file style)
     that enforces the macOS invariants over `self.root` in one pass, mirroring
     `normalizePaneLayoutNode` + `flattenPaneLayoutSplit` semantics adapted to the gpui
     model (gpui has no separate `leaf`-vs-`tabs` node; a `WorkspaceLeaf` with one tab
     is fine and must NOT be removed):
     - Remove any `WorkspaceTab` whose `session_id` is not present in
       `self.terminal_sessions` (dead reference pruning).
     - Remove any leaf whose `tab_group.tabs` is empty; replace its parent split with
       the sibling subtree (reuse/extend `collapse_empty_workspace_leaf`, iterating
       until no empty leaf remains, since collapses can cascade).
     - Unwrap any split left with effectively one child; keep behavior identical to
       the existing collapse helper.
     - EXCEPTION (baseline invariant, do not regress): if `terminal_sessions` is empty
       or every leaf would be removed, the tree must become exactly one empty leaf via
       `workspace_empty_leaf_node`, matching today's `close_tab` whole-empty behavior
       (:10727) and the reconcile all-empty branch (:11372).
     - Repair per-leaf `active_tab`: if it doesn't reference a tab in that leaf, set it
       to the first tab (macOS resolves stale active ids the same way). Never leave
       the `TerminalSessionId(0)` sentinel in a non-empty leaf.
     - Repair `focused_pane`: if it no longer refers to an existing leaf, or refers to
       an empty leaf while non-empty leaves exist, move focus using the existing
       collapse-focus helpers (`workspace_close_focus_replacement_leaf_id`, else
       `first_workspace_leaf_id`). Also call `clear_focus_mode_if_invalid`.
  2. Call this normalization at the end of `reconcile_with_sidebar_tab_sessions`
     (after the retain/sort loop at ~:11386-11417 and the target-pane assignment at
     ~:11419+), and make the method return whether it changed anything so reconcile's
     `changed` flag stays accurate (persistence and re-render depend on it).
  3. Audit every other `Workspace*` mutation path that removes or moves tabs
     (`close_tab`, `group_tab_into_pane`, `split_tab_to_pane`, scoped closes via
     `tab_session_ids_for_close_scope`, `merge_all_tabs_into_pane`,
     `rotate_panes_clockwise`, session-removal driven paths) and ensure each ends with
     the tree satisfying the invariant — either they already collapse correctly (most
     do) or route them through the new normalization. Prefer calling the single
     normalization over per-path ad-hoc fixes, but do not change their existing focus
     selection semantics in this phase.
  4. Fix `resolve_action_pane_id` (:11816) so actions never target an empty ghost
     leaf: it must only resolve to a leaf that exists AND (has tabs OR is the single
     whole-empty-workspace baseline leaf).
  5. On startup/hydrate: `GpuiShellLayoutState::load_or_default` (:14622) restores a
     persisted tree that may reference sessions that no longer exist. Ensure the
     normalization also runs when the workspace model is loaded/first reconciled so a
     stale persisted layout can never render an empty pane (macOS runs normalization
     on every hydrate). The reconcile call in step 2 may already guarantee this —
     verify the startup order and, if there is any render before the first reconcile,
     normalize at load too.
  6. Keep the diff surgical. Do not refactor unrelated code, do not touch rendering —
     with the model invariant enforced, `EmptyWorkspacePlaceholder` remains reachable
     only for the intentional single-empty-workspace leaf.
- acceptance_criteria:
  - `cargo check` (run from `gpui/`) completes with no errors and no new warnings
    relative to the pre-change baseline.
  - `reconcile_with_sidebar_tab_sessions` provably cannot leave an empty leaf in a
    multi-leaf tree: reading the function shows the normalization runs after all tab
    removal/assignment, and the normalization removes empty leaves recursively with
    cascade handling.
  - The whole-empty-workspace baseline is preserved: when no sessions remain, root is
    exactly one empty leaf (same behavior as `close_tab` :10727 today).
  - After normalization, no non-empty leaf has `active_tab` referencing a session not
    in its tabs, and `focused_pane` always refers to an existing leaf that has tabs
    (or the single baseline empty leaf).
  - `resolve_action_pane_id` cannot return an empty leaf while non-empty leaves exist.
  - The pre-existing uncommitted hunks (blank Mounting placeholder) are still present
    in `git diff gpui/src/main.rs`.
  - No test files added; no changes outside `gpui/src/main.rs`.

## Phase 2: Focus and selection parity with macOS

- depends_on: [1]
- parallel_ok: false
- goal: Make focus/selection behavior after closes and sidebar-driven session changes
  match the macOS app exactly: same-pane close replacement is right-then-left; when a
  focused pane is destroyed, focus prefers the collapsing branch's sibling subtree
  first and only then nearest-geometry; sessions newly surfaced from the sidebar land
  as tabs in the focused pane (never a synthesized split); selecting a session already
  in the tree selects that existing tab in place instead of relocating it.
- files: `gpui/src/main.rs`
- do_not_touch: same as Phase 1; also do not rework Phase 1's normalization — build on
  it.
- approach:
  1. Same-pane close replacement: gpui `WorkspaceTabGroup::remove_session` (:14241)
     already selects the tab now at the removed index, else last — verify this equals
     macOS right-then-left (`getAdjacentPaneTabSessionId` :3153) for all positions
     (middle, first, last). Adjust only if it diverges.
  2. Pane-destroy focus: compare gpui `collapse_empty_leaf` → 
     `workspace_close_focus_replacement_leaf_id` (:14416) +
     `workspace_leaf_id_on_collapse_edge` (:14446) against macOS
     `getClosingPaneSpatialReplacementSessionId` (:2937): macOS first tries candidates
     from the **sibling subtree of the collapsing branch**
     (`getClosingPaneSiblingBranchCandidates` :3048 — e.g. closing bottom-right of a
     2x2 nested split focuses top-right, not bottom-left), then falls back to nearest
     geometry with a shares-axis bonus (`getPostClosePaneFocusScore` :3080: prefer
     panes overlapping on the split axis, score by gap then center distance). Align
     gpui to sibling-branch-first, then the geometric fallback. Read the macOS
     functions in `shared/simple-grouped-session-workspace-state.ts` before writing
     code; replicate the candidate ordering faithfully in the gpui tree model.
  3. Sidebar-driven placement: in `reconcile_with_sidebar_tab_sessions`, sessions not
     yet in any leaf are assigned to a target pane. macOS default placement for a
     session without an explicit split intent is a **tab in the focused pane**
     (`getNextPaneLayoutForCreatedSession` no-placement branch :2534-2576, CDXC:
     SplitIntent: only explicit split actions create split leaves). Verify gpui's
     `target_pane_id` selection (~:11419) resolves to the focused pane (via the fixed
     `resolve_action_pane_id` from Phase 1) and that newly surfaced sessions are
     appended as tabs there — never creating a new split. Align if it diverges.
  4. Selecting a session that is already in the tree (sidebar click routing to
     `select_tab`/`focus_pane` or reconcile marking it active): macOS selects the
     existing tab in place, keeping the pane's other tabs (`CDXC:SidebarSessionFocus`,
     `focusSidebarSessionInSimpleWorkspace` :478 in the shared TS). Ensure gpui does
     not move/duplicate the session's tab when it's selected from elsewhere — it must
     only update that leaf's `active_tab` and `focused_pane`.
  5. Do not change drag/drop behavior in this phase (Phase 3 owns it).
- acceptance_criteria:
  - `cargo check` (from `gpui/`) passes with no errors and no new warnings.
  - Same-pane close replacement matches macOS right-then-left for first/middle/last
    tab positions (demonstrated by reading `remove_session` and citing the macOS
    equivalent; adjust code if needed).
  - Focus after destroying a focused pane resolves sibling-branch-first: the gpui
    focus-replacement code enumerates candidates from the collapsed split's sibling
    subtree before any other pane, then falls back to nearest-geometry with a
    shares-axis preference, mirroring `getClosingPaneSiblingBranchCandidates` and
    `getPostClosePaneFocusScore` semantics.
  - Newly surfaced sidebar sessions are added as tabs to the focused pane and can
    never create a split leaf from the reconcile path.
  - Selecting an already-placed session changes only `active_tab`/`focused_pane`; the
    tree shape is unchanged.
  - Pre-existing uncommitted hunks still intact; no test files; changes only in
    `gpui/src/main.rs`.

## Phase 3: Drag-and-drop parity with macOS

- depends_on: [2]
- parallel_ok: false
- goal: Make tab drag-and-drop in the gpui Agents workspace behave exactly like macOS:
  0.24 edge bands for drop placement, center = merge into target pane's tab group,
  edges = split beside target (horizontal for left/right, vertical for top/bottom, new
  pane placed after target for right/bottom), dragging the ONLY tab of a pane onto its
  own pane's edge is a no-op, source pane collapses when its last tab is dragged out,
  and focus follows the dragged tab.
- files: `gpui/src/main.rs`
- do_not_touch: same as Phase 1; do not rework Phases 1-2 logic — build on it.
- approach:
  1. Read the macOS references first: `paneDropPlacement` in
     `native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift`
     (:15962 — normalized local coords, `x<=0.24 → left`, `x>=0.76 → right`,
     `y<=0.24 → bottom`, `y>=0.76 → top`, else center; note Swift y-axis vs gpui
     y-axis: replicate the USER-VISIBLE behavior — the band nearest each visual edge
     maps to a split on that visual side),
     `moveSessionInPaneLayoutInSimpleWorkspace` (:1796) and
     `getSamePaneSplitAnchorSessionId` (:3360) in
     `shared/simple-grouped-session-workspace-state.ts`.
  2. In gpui, locate the drop-zone computation for `WorkspaceDropZone`
     (Center/Left/Right/Top/Bottom) in the `DragMoveEvent<DraggedWorkspaceTab>`
     handlers (~:43232-:43832) and the drop commit paths `group_tab_into_pane`
     (:11663) / `split_tab_to_pane` (:11699) / `reorder_tab_within_pane` (:11641).
  3. Set the edge-band fraction to 0.24 per side (center zone is the middle
     0.52 x 0.52 region), matching macOS. If gpui uses fixed-pixel bands or a
     different fraction, replace with the 0.24 fraction of the pane rect.
  4. No-op rule: when the dragged tab is the ONLY tab of its pane and the drop target
     is an edge of that SAME pane, do nothing (no split, no collapse, no focus
     change) — mirror `getSamePaneSplitAnchorSessionId` returning no anchor. Also make
     sure the drop-zone hover feedback does not advertise a split for this case if the
     existing code has per-zone visual feedback with a cheap way to suppress it;
     behavior (the commit path) is the must-have, feedback parity is best-effort.
  5. Verify (and fix if divergent): dragging the last tab out of a pane collapses the
     source pane (existing `collapse_empty_leaf` calls in `group_tab_into_pane` /
     `split_tab_to_pane`), a center drop inserts the tab into the target group and
     makes it active, an edge drop creates the split with the dragged tab on the
     dropped side, and after any successful move `focused_pane`/`active_tab` follow
     the dragged session (macOS sets `focusedSessionId: sourceSessionId`).
  6. Same-pane tab-strip reorder must never change the tree shape (verify
     `reorder_tab_within_pane` only permutes `tabs`).
- acceptance_criteria:
  - `cargo check` (from `gpui/`) passes with no errors and no new warnings.
  - Drop-zone geometry uses 0.24 edge fractions of the target pane rect on all four
    sides, center otherwise, and the visual side → split side mapping matches macOS
    user-visible behavior (drop near left edge → new pane on the left, etc.).
  - The single-tab-onto-own-edge no-op is implemented in the drop commit path: the
    model is provably unchanged in that case.
  - After a cross-pane move (center or edge), the dragged session is the active tab of
    its new pane and that pane is `focused_pane`; the emptied source pane is collapsed.
  - Reorder within a pane cannot alter the split tree.
  - Pre-existing uncommitted hunks still intact; no test files; changes only in
    `gpui/src/main.rs`.

## Handoff notes

### Phase 1 (COMPLETE)
Added an Agents workspace normalization pass in `gpui/src/main.rs` that prunes dead
tabs, collapses empty split leaves (cascading), repairs `active_tab`/`focused_pane`,
and preserves the single whole-empty baseline leaf. It is wired into reconcile,
restore/hydrate, close, merge, split/add, drag-move, and rollback paths.
`resolve_action_pane_id` now refuses ghost empty leaves. `cargo check` passes with
the same 61 pre-existing warnings. Note: `gpui/vite.config.ts` was modified by
something concurrent/unrelated during the phase and was intentionally left untouched
— it is NOT part of this work.

### Phase 2 (COMPLETE)
Pane-destroy focus now tries the collapsing split's sibling branch first, then falls
back to geometry scoring (shared-axis bonus, gap, center distance) mirroring macOS.
Verified (no change needed): same-pane close replacement is right-then-left, sidebar
selection of an already-placed session is in-place, and reconcile adds newly surfaced
sessions as tabs in the resolved focused pane without creating splits. `cargo check`
passes with only the pre-existing warnings.

### Phase 3 (COMPLETE)
Agents pane-body drop geometry now uses macOS-style 0.24 normalized edge bands with
visual left/right/top/bottom mapping. Single-tab drops onto their own pane edge are a
true no-op (before any tab removal, split insertion, focus change, or persistence),
with the invalid own-edge split hover feedback suppressed and suppressed edge drops
prevented from falling through as center merges. Drop feedback bands match the same
0.24 fraction. Same-pane tab reorder remains tree-shape-only. `cargo check` exits 0
with the pre-existing 61 warnings.

### Note for the verifier
Other agents are working concurrently in this same worktree. Unrelated modified files
you may see and must IGNORE: `gpui/vite.config.ts`, `gpui/scripts/build-macos-app.sh`,
`sidebar/agents-hub-modal.tsx`, `sidebar/styles/agents-hub.css`, other docs plan
files, and possibly Browser-pane (`Browser*`) code in `gpui/src/main.rs`. Verify only
this plan's phases; the plan's own changes are confined to the Agents/`Workspace*`
system in `gpui/src/main.rs`.
