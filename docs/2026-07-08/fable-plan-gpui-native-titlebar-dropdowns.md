# Plan: Native gpui-component dropdowns for Git / Actions / Open In titlebar buttons (gpui app)

## Overall goal

The gpui app titlebar has three working buttons — **Git**, **Actions** (Quick Actions), and
**Open In** (open project in an app). Today their dropdowns open as OS-owned
`gpui_component::native_menu::NativeMenu` (NSMenu). Replace ONLY the presentation layer of these
three menus with in-app native menus built from the **gpui-component** crate
(`gpui_component::menu::PopupMenu` and friends), so they visually and behaviorally match the
macOS app's titlebar dropdown panels. All existing action dispatch (the `Box<dyn Action>` values,
bridge messages, process launches) must be reused unchanged. No webviews, no NSMenu, no new CEF
surfaces for these menus.

## Repo rules every worker MUST follow

- Do NOT write any tests in `gpui/**` (repo policy: no tests in the gpui app yet).
- No fallback code paths to paper over problems — fix the root cause directly.
- NEVER run `bun run start`, `scripts/start-gpui.mjs`, or anything that starts/restarts the app.
- Do not edit compiled bundles (`native/macos/ghostexHost/Web/**`), `ghostty/**`, `tui/vendor/**`,
  `node_modules/**`.
- Do not convert the OTHER NativeMenu call sites (Settings menu, Keep-Awake, Resources, tab
  context menus, pane-overflow menus). They are explicitly out of scope.
- Keep the macOS app (`native/**`, `sidebar/**` except where a phase explicitly says otherwise)
  untouched.
- Match surrounding code style in `gpui/src/main.rs` (single large file; helpers as
  `impl` methods or free functions near related code; comment style `// CDXC:<Tag> <date>:` is
  used for design-intent comments — follow it only where the neighboring code does).

## Key reference material (read before coding)

- gpui-component crate source (local path dep, `gpui/Cargo.toml:56`):
  `/Users/madda/dev/_references/gpui-component/crates/ui/src/menu/popup_menu.rs`,
  `.../menu/dropdown_menu.rs`, `.../menu/context_menu.rs`, `.../popover.rs`.
  - `PopupMenu` builder: `.menu`, `.menu_with_disabled`, `.menu_with_check`, `.menu_with_icon`,
    `.separator()`, `.label()`, `.min_w/.max_w/.max_h`, `.scrollable`, and — critical for this
    task — `menu_element`, `menu_element_with_check`, `menu_element_with_disabled`,
    `menu_element_with_icon` (`popup_menu.rs:514-608`) which take a
    `Fn(&mut Window, &mut App) -> impl IntoElement` builder for fully custom row rendering.
  - `DropdownMenu` trait (`dropdown_menu.rs`): `dropdown_menu_with_anchor(anchor, f)` attaches an
    anchored PopupMenu popover to a trigger element.
  - `ContextMenuExt::context_menu(f)` (`context_menu.rs:13`) attaches a right-click PopupMenu.
- The three current NativeMenu builders in `gpui/src/main.rs` (all logic to preserve lives here):
  - Git: `show_gpui_titlebar_git_menu` at `gpui/src/main.rs:52387`
  - Open In: `show_gpui_open_targets_menu` at `gpui/src/main.rs:52584`
  - Actions: `show_gpui_titlebar_actions_menu` at `gpui/src/main.rs:52613`
- The three trigger buttons:
  - Git button: `render_titlebar_git_button` `gpui/src/main.rs:53308` (opens menu on left AND
    right mouse-down, `:53341`, `:53349`)
  - Actions + Open In buttons: `render_titlebar_icon_button` `gpui/src/main.rs:53431`
    (ids `"actions"` and `"open-project"`, rendered at `:53152-53153`; left click runs the
    primary action, right click opens the menu — see `:53495-53533`)
- macOS reference implementation (the look/feel/content source of truth):
  - `native/sidebar/titlebar-host.tsx` — panel content `TitlebarDropdownPanelSurface`
    (`:4985-5483`), menu item `TitlebarPanelMenuItem` (`:5485-5510`), separator (`:5534`),
    git menu (`:5238-5347`), actions menu (`:5349-5404`), openIn menu (`:5451-5480`),
    CSS in the inline `<style>` block (`:8682-9047`), sizing constants (`:570-584`).
  - Shared contracts: `shared/sidebar-git.ts`, `shared/sidebar-commands.ts`,
    `shared/workspace-open-targets.ts`.

## Shared visual + behavioral spec (applies to all three menus)

Every phase must produce menus that follow this spec exactly. Phase 1 builds the shared helper;
phases 2–3 MUST reuse it rather than re-deriving styling.

Surface:
- Background `rgb(0x191919)` (macOS `--app-dropdown-background` Dark 1; app titlebar is
  `0x0e0e0e`), 1px border `white @ 0.14` alpha, rounded corners (6px), drop shadow, vertical
  padding ~5px (macOS `.titlebar-open-menu` chrome is 10px total).
- Compact menus (Actions, Open In) width 240px; Git menu width 300px.
- Content scrolls if taller than available space (`.max_h` + `.scrollable`).

Rows (standard item — Open In rows, Git action rows, Configure rows):
- min-height 30px, horizontal padding 8px, gap 10px between icon and label, font size 13px,
  regular weight, text `white @ 0.84`-ish (match existing `titlebar_text_color()`
  `gpui/src/main.rs:57438`).
- Hover background `white @ 0.08` (Git menu rows use `white @ 0.14`).
- Disabled rows: text `white @ 0.34`; Git rows keep label color but dim the icon to 0.42 opacity.
- Leading icon 16px; trailing check mark on the active/selected row where specified.

Section labels (Git menu "Status" / "Actions"): 11px, weight 600, muted color
(`white @ ~0.55`), height 22px, left padding 8px.

Separator: 1px line, `white @ ~0.10`, 4px vertical margins.

Placement & dismissal:
- Menu opens BELOW the trigger button, right-edge aligned with the button's right edge
  (macOS places panel at `x = anchor.maxX - width`, `y = below anchor + 6px gap`). Flip above if
  it would clip the window bottom.
- Clicking the trigger while its menu is open closes it (toggle).
- Dismiss on click outside and on Escape.
- While the menu is open the trigger button shows the active-segment background
  (`titlebar_active_segment_color()` `gpui/src/main.rs:57434`), same as the pressed state.
- Click behavior parity (already in gpui today — preserve it): Git opens the menu on left AND
  right click and never runs an action directly; Actions and Open In run the primary action on
  left click and open the menu on right click only.

Implementation constraints:
- Presentation must be `gpui_component::menu::PopupMenu` (use `menu_element*` builders for
  custom rows). Anchoring may use the `DropdownMenu` trait, `ContextMenuExt`, `Popover`, or a
  hand-rolled `anchored()`/`deferred()` overlay holding an `Entity<PopupMenu>` — pick ONE
  mechanism in Phase 1 that satisfies the placement/toggle/dismiss spec and reuse it for all
  three menus. If gpui-component's stock chrome (bg/border/padding) fights the spec, check the
  crate's theme/`ActiveTheme` hooks first; only wrap/override rendering as a last resort, and
  never fork the crate.
- Menu items must dispatch the SAME existing `Box<dyn Action>` values the NativeMenu code
  dispatches today (`RunGpuiTitlebarGitMenuAction`, `CopyGpuiTitlebarGitBranch`,
  `OpenGpuiTitlebarGitCommitScreen`, `RunGpuiTitlebarGitRemoteSync`, `RunGpuiTitlebarAction`,
  `ConfigureGpuiTitlebarActions`, `OpenGpuiWorkspaceInTarget`, etc.). Do not re-route dispatch.
- Remove each menu's NativeMenu construction once its PopupMenu replacement is wired; do not
  leave dead code. Keep the `native_menu::NativeMenu` import while other (out-of-scope) call
  sites still use it.

Build verification command for every phase (must pass with zero errors; warnings unrelated to
your change are acceptable):

```bash
cd /Users/madda/dev/_active/Ghostex/gpui && cargo check 2>&1 | tail -20
```

---

## Phase 1: Shared titlebar dropdown infrastructure + Open In menu

- depends_on: []
- parallel_ok: false
- goal: Build the single reusable mechanism for showing a spec-compliant
  `gpui_component::menu::PopupMenu` anchored under a titlebar button (placement, toggle,
  outside-click/Escape dismissal, open-state trigger highlight, shared styling), and convert the
  **Open In** menu to it end-to-end, removing its NativeMenu path.
- files: `gpui/src/main.rs` (you may add a new module file under `gpui/src/` if it keeps the
  code cleaner; register it from `main.rs`). Icon assets under `gpui/` asset dirs if needed.
- do_not_touch: the Git menu (`show_gpui_titlebar_git_menu`) and Actions menu
  (`show_gpui_titlebar_actions_menu`) NativeMenu bodies (phases 2–3 own them); all other
  NativeMenu call sites; `native/**`; `shared/**`; compiled bundles.
- approach:
  1. Read the "Shared visual + behavioral spec" section above and the gpui-component menu
     sources listed in "Key reference material". Decide the anchoring mechanism (DropdownMenu
     trait with a bottom-right anchor, or an anchored/deferred overlay holding
     `Entity<PopupMenu>`) — it must support: open from an arbitrary mouse-down handler (Phase 3
     needs left AND right click to open the Git menu, and Phase 2 needs right-click-only), the
     right-edge-below placement, toggle-close, Escape/outside dismissal, and trigger highlight
     while open. A small state field on the root view (e.g.
     `open_titlebar_popup: Option<(TitlebarPopupKind, Entity<PopupMenu>)>`) rendered as an
     anchored deferred layer from `render_right_titlebar_controls` is an acceptable design.
  2. Current Open In NativeMenu: `show_gpui_open_targets_menu` `gpui/src/main.rs:52584`. It
     iterates `gpui_visible_open_targets_from_current_settings` (used at `:52594`) and
     dispatches `OpenGpuiWorkspaceInTarget { target_index }` (`:52601`). Reproduce the SAME row
     list and dispatch in a PopupMenu:
     - One row per visible target: leading icon, target label, trailing check mark when the
       target is the active one (the same active-target notion used by the left-click primary
       action, `active_project_open_in_path` / `open_active_project_with_active_open_target`
       `:53495`, `:53036`). macOS reference rows: `native/sidebar/titlebar-host.tsx:5453-5464`
       (icon = folder-open for finder, editor brand icon otherwise, generic box icon fallback).
       For icons, reuse whatever icon assets/mapping the gpui app already has for open targets
       (check how the Open In BUTTON picks its icon near `:53153` and `:53121`); if the app has
       no per-target brand icons, add the needed SVGs to the gpui asset set by copying from the
       app's existing icon sources (`src/assets/` or the sidebar icon set) — do not invent new
       artwork and do not skip icons.
     - Separator, then a **Configure** row (settings/gear icon). macOS behavior: opens the
       Open-In-targets configuration UI (`titlebar-host.tsx:5466-5478` posts
       `{modal:"openTargets"}`). In gpui, find the existing equivalent surface: check how the
       current NativeMenu handles configure (if it already has such a row, keep its action), and
       check for an open-targets settings modal analogous to
       `open_gpui_settings_actions_modal_from_titlebar` (`:52641`). Wire to the existing gpui
       surface that edits open targets. If gpui genuinely has no surface for it, dispatch the
       action that opens the gpui settings modal on its closest tab and record that gap in the
       Handoff notes — do NOT build a new settings UI in this phase.
  3. Right-click on the `"open-project"` button (`:53512-53515`) must open this PopupMenu at the
     spec placement instead of calling the NativeMenu path; left click behavior unchanged.
     Delete the NativeMenu body of `show_gpui_open_targets_menu` (replace with the PopupMenu
     open) so no dead code remains.
  4. Styling per the shared spec: width 240, 30px rows, 13px font, hover white@0.08, disabled
     white@0.34, bg 0x191919, border white@0.14, section-free (this menu has no labels).
- acceptance_criteria:
  - `cd /Users/madda/dev/_active/Ghostex/gpui && cargo check` completes without errors.
  - `rg -n "NativeMenu" gpui/src/main.rs` (or the new module) shows NO NativeMenu usage inside
    the Open In menu path (`show_gpui_open_targets_menu` or its replacement); Git and Actions
    NativeMenu sites are untouched.
  - Code inspection: right-click on the `open-project` titlebar button opens a
    `gpui_component::menu::PopupMenu` (not NativeMenu, not a webview) anchored below the button,
    right-edge aligned with ~6px gap, with toggle-close on re-click and Escape/outside-click
    dismissal, and the trigger renders the active-segment background while open.
  - Code inspection: the menu enumerates exactly the targets from
    `gpui_visible_open_targets_from_current_settings`, each row dispatching
    `OpenGpuiWorkspaceInTarget { target_index }` with correct indices, a trailing check on the
    active target, per-target leading icons, then a separator and a Configure row wired to the
    existing gpui configuration surface for open targets.
  - Code inspection: left click on the button still calls
    `open_active_project_with_active_open_target` and does not open the menu.
  - Code inspection: the shared open/anchor/style helper is factored so Phases 2–3 can call it
    with different content (document its name and usage in Handoff notes).
  - Styling constants match the shared spec (verifier greps the new code for the 240px width,
    0x191919 background, 0.14-alpha border, 30px row min-height, 13px font).

## Phase 2: Quick Actions menu

- depends_on: [1]
- parallel_ok: false
- goal: Convert the titlebar **Actions** dropdown to the shared PopupMenu infrastructure with
  macOS-parity content: two-line rows (icon + action name + dimmed command/URL preview line,
  italic when unconfigured), check mark on the active action, "No Actions configured" empty
  state, and a Configure footer. Remove its NativeMenu path.
- files: `gpui/src/main.rs` (+ the Phase 1 module if one was created). If the Rust-side action
  model lacks the preview string, also the minimal bridge/payload code that populates it (see
  approach step 3) — which may touch the gpui sidebar payload builder in `sidebar/` for the
  gpui app only.
- do_not_touch: the Git menu NativeMenu body (`show_gpui_titlebar_git_menu`, Phase 3 owns it);
  all other NativeMenu call sites; `native/**`; macOS-only sidebar code.
- approach:
  1. Read the plan header sections and the Handoff notes for Phase 1; reuse its helper.
  2. Current site: `show_gpui_titlebar_actions_menu` `gpui/src/main.rs:52613`, action list from
     `configured_gpui_titlebar_actions` (`:52673`) sourced via
     `gpui_titlebar_actions_from_sidebar_command_buttons` (`:74955`). Rows dispatch
     `RunGpuiTitlebarAction { action_index }` (`:52705` runner) and the footer dispatches
     `ConfigureGpuiTitlebarActions` → `open_gpui_settings_actions_modal_from_titlebar`
     (`:52641`). Keep ALL of that dispatch.
  3. macOS-parity row content (`native/sidebar/titlebar-host.tsx:5349-5404`,
     `shared/sidebar-commands.ts:41-46`): each row is 44px min-height, top-aligned icon, first
     line = action name (13px), second line = preview (11px, `white @ 0.48`): the URL for
     browser actions, the command string for terminal actions, or the literal text
     "Set the command" rendered italic when the action is unconfigured (no command/url). Check
     the Rust `GpuiTitlebarAction`-ish struct for the fields needed (type, url, command,
     configured flag). If the preview string is not currently carried across the bridge, extend
     the existing payload/struct minimally to carry it (root-cause fix, no placeholder text).
     Use `PopupMenu::menu_element_with_check(...)` so the ACTIVE action (the one left-click
     runs — same index `run_active_gpui_titlebar_action` `:53501` uses) gets the trailing check.
     Per-row icons: reuse the existing mapping the Actions button uses
     (`titlebar_action_icon_path`, used near `:53121`).
  4. Empty state: when the action list is empty, a single disabled 30px row with the exact text
     "No Actions configured" (macOS `titlebar-host.tsx:5387`).
  5. Footer: separator + "Configure" row (gear icon, standard 30px row) dispatching
     `ConfigureGpuiTitlebarActions`.
  6. Trigger wiring: right-click on the `"actions"` button (`:53530-53533`) opens this menu via
     the shared helper; left click keeps `run_active_gpui_titlebar_action` (`:53501`). Delete
     the NativeMenu body.
  7. Width 240px; scroll if long.
- acceptance_criteria:
  - `cd /Users/madda/dev/_active/Ghostex/gpui && cargo check` completes without errors.
  - No NativeMenu usage remains in the Actions menu path; Git NativeMenu site untouched
    (verifier greps).
  - Code inspection: rows render name + preview second line with the macOS rules (URL for
    browser, command for terminal, italic "Set the command" when unconfigured), 44px min-height,
    11px dimmed preview, per-action icon, check on the active action, dispatch
    `RunGpuiTitlebarAction { action_index }` with correct indices.
  - Code inspection: empty list renders the disabled "No Actions configured" row; footer
    separator + Configure row dispatches `ConfigureGpuiTitlebarActions`.
  - Code inspection: right-click opens the shared-helper PopupMenu under the button; left click
    still runs the active action; toggle/dismiss/highlight behaviors come from the shared
    helper unchanged.

## Phase 3: Git Actions menu

- depends_on: [1, 2]
- parallel_ok: false
- goal: Convert the **Git** dropdown to the shared PopupMenu infrastructure with full macOS
  parity: "Status" section (Branch copy row, Changes row with green/red +/− stats, Commits row
  with ↑/↓ counts), separator, "Actions" section with the server-provided git action rows and
  their disabled states. Remove its NativeMenu path.
- files: `gpui/src/main.rs` (+ the Phase 1 module if one was created).
- do_not_touch: all other NativeMenu call sites; `native/**`; `shared/**`; the Actions and
  Open In menu code from phases 1–2 except where the shared helper is called.
- approach:
  1. Read the plan header sections and the Handoff notes for phases 1–2; reuse the helper.
  2. Current site: `show_gpui_titlebar_git_menu` `gpui/src/main.rs:52387`. State:
     `self.titlebar_git_menu_state: Option<GpuiTitlebarGitMenuState>` (struct at `:1677`) —
     carries `branch`, `additions`, `deletions`, `ahead_count`, `behind_count`, `is_busy`,
     `is_repo`, `has_working_tree_changes`, `sync_remote_disabled`, `primary_action`, and
     `rows: Vec<GpuiTitlebarGitMenuRow>` (label + disabled + primary per row, already computed
     by the sidebar from `shared/sidebar-git.ts`, so do NOT re-derive disable logic for the
     action rows — trust `row.disabled`). Existing dispatch to keep:
     `RunGpuiTitlebarGitMenuAction { row_index }` (`:1604`), `CopyGpuiTitlebarGitBranch`
     (`:1616`), `OpenGpuiTitlebarGitCommitScreen` (`:1620`), `RunGpuiTitlebarGitRemoteSync`
     (`:1624`).
  3. Menu structure (macOS reference `native/sidebar/titlebar-host.tsx:5238-5347`), width 300px,
     git-row hover `white @ 0.14`, rows as `menu_element*` items on an 18px-icon grid:
     - Section label "Status".
     - **Branch** row: git-commit icon, label "Branch", right-side value = branch name, or
       "(detached HEAD)" when `branch` is None. Click dispatches `CopyGpuiTitlebarGitBranch`
       (copies to clipboard). Disabled when not a repo.
     - **Changes** row: code icon, label "Changes", value = green `+{additions}`
       (rgb 74,222,128) and red `-{deletions}` (rgb 248,113,113). Click dispatches
       `OpenGpuiTitlebarGitCommitScreen`. Long branch names/values must truncate, not widen the
       300px menu.
     - **Commits** row: git-compare icon, label "Commits", value = `↑{ahead_count}
       ↓{behind_count}` (always shown, even ↑0 ↓0). Click dispatches
       `RunGpuiTitlebarGitRemoteSync`. Disabled when `sync_remote_disabled` OR
       `ahead_count == 0 && behind_count == 0` (macOS `titlebarGitRemoteSyncDisabledReason`,
       `titlebar-host.tsx:7834-7843`).
     - Separator, section label "Actions", then one row per `state.rows` entry: icon via
       `titlebar_git_action_icon_path` (`:57145`), `row.label`, disabled = `row.disabled`
       (dim icon to 0.42 opacity, keep label color per macOS git-menu CSS), click dispatches
       `RunGpuiTitlebarGitMenuAction { row_index }` with the row's original index.
     - When `titlebar_git_menu_state` is None or `!is_repo`, mirror whatever the current
       NativeMenu code does for that case (inspect `:52387-52462`) — keep that behavior, just
       rendered in the PopupMenu.
  4. macOS refreshes git state when the menu opens (`openGitMenuFromTitlebar` posts
     `refreshGitState` before showing, `titlebar-host.tsx:3581-3587`). Check whether the gpui
     open path already requests a refresh through the sidebar bridge; if not, send the
     equivalent existing refresh request (look for a git-state refresh script/message near the
     `TitlebarGitMenuState` bridge plumbing, `:31474`, `:31672`, `:81966`) when opening. Do not
     invent a new protocol message if one exists.
  5. Trigger wiring: BOTH left and right mouse-down on the git button (`:53341`, `:53349`) open
     this menu (toggle). The button's busy spinner and blue change-badge rendering
     (`render_titlebar_git_button` `:53308-53380`) stay as they are. Delete the NativeMenu body.
- acceptance_criteria:
  - `cd /Users/madda/dev/_active/Ghostex/gpui && cargo check` completes without errors.
  - `rg -n "NativeMenu::new" gpui/src/main.rs` no longer matches in any of the three titlebar
    menu paths (git/actions/open-in); remaining matches are only the out-of-scope call sites.
  - Code inspection: the Git PopupMenu renders Status label, Branch/Changes/Commits rows with
    the exact icons, labels, value formatting (green +N / red −N, ↑N ↓N always visible,
    "(detached HEAD)" for None branch), and dispatches
    `CopyGpuiTitlebarGitBranch` / `OpenGpuiTitlebarGitCommitScreen` /
    `RunGpuiTitlebarGitRemoteSync` respectively; Commits row disabled per
    `sync_remote_disabled || (ahead == 0 && behind == 0)`.
  - Code inspection: Actions section renders `state.rows` in order with
    `titlebar_git_action_icon_path` icons, `row.disabled` respected (0.42 icon dim), dispatching
    `RunGpuiTitlebarGitMenuAction { row_index }` with original indices; no disable logic is
    re-derived in Rust for those rows.
  - Code inspection: menu opens on both left and right click of the git button via the shared
    helper (300px wide, git hover 0.14), never runs a git action directly from the button, and
    a git-state refresh is requested on open (existing bridge message only).
  - Code inspection: none of the other NativeMenu call sites (settings, resources, keep-awake,
    tab context menus, pane overflow) were modified.

## Handoff notes

(Each phase appends 2–3 lines here when it completes: shared helper name/usage, any gaps or
decisions the next phase or the verifier needs.)

Phase 1: Shared helper/state lives in `GpuiTitlebarPopupKind`, `set_gpui_titlebar_popup_open`, `render_titlebar_popup_menu_panel`, and `titlebar_popup_standard_menu_row`; add new kind variants and builders in `build_gpui_titlebar_popup_menu` for Actions/Git.
Phase 1: Open In now uses `PopupMenu` rows from `gpui_visible_open_targets_from_current_settings`, icons from `titlebar_open_target_icon_for_id`, right-side checks, and the existing `OpenGpuiWorkspaceInTarget` / `OpenGpuiOpenTargetsModal` actions; no new assets or settings UI.
Phase 2: Actions now adds `GpuiTitlebarPopupKind::Actions`, `build_gpui_titlebar_actions_popup_menu`, and `render_titlebar_actions_button` on the same `set_gpui_titlebar_popup_open` / `render_titlebar_popup_menu_panel` helper path.
Phase 2: The menu renders visible Actions with 44px two-line rows from `titlebar_popup_action_menu_row`, per-action icons, URL/command preview text, italic `Set the command` for unconfigured rows, right-side checks for the configured active action, and the existing `RunGpuiTitlebarAction` / `ConfigureGpuiTitlebarActions` dispatch.
Phase 2: `RunGpuiTitlebarAction` menu indices now resolve against visible actions so unconfigured rows can route through the existing Settings path; command-palette positional hotkeys keep configured-only behavior via `run_configured_gpui_titlebar_action_index`.
Phase 3: Git now adds `GpuiTitlebarPopupKind::Git`, `build_gpui_titlebar_git_popup_menu`, and a window-anchored `render_titlebar_git_button` path on the same `set_gpui_titlebar_popup_open` / `render_titlebar_popup_menu_panel` helper.
Phase 3: The menu keeps the existing refresh selector on open and typed dispatch actions, renders Status plus Actions sections at 300px width, and uses Git-specific row helpers for colored change stats, commit counts, detached-head branch text, and disabled action icon dimming.
