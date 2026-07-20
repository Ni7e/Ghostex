# Handoff: resize-dependent white line beside Browser panes

## Status

The attempted fix from Codex session `019f68ad-0407-78e3-83b7-55797b22e817` did **not** solve the user-visible issue. The July 16 session concluded that the line was gone, but on July 20 the user reported that it was still visible. The July 20 continuation attempts were interrupted or rolled back before any new investigation took place.

The failed fix is still present in the current source and was later committed as part of the large WIP commit `3c1e0eb33` (`wip: preserve local macOS work before main update`). It consists of two paint suppressions in `gpui/src/main.rs`:

1. The left border is omitted from the leftmost Browser leaf.
2. The white hover indicator is omitted from the outer project-editor companion divider while in Browser mode.

Because the issue persists with both changes active, neither change should be treated as proof of the root cause. Do not broadly revert `3c1e0eb33`; it contains many unrelated changes. If either failed-fix hunk is removed, do it surgically after re-reading the current file and confirming the behavior.

## Session metadata

- Session ID: `019f68ad-0407-78e3-83b7-55797b22e817`
- Original transcript: `/Users/madda/.codex/sessions/2026/07/16/rollout-2026-07-16T06-06-37-019f68ad-0407-78e3-83b7-55797b22e817.jsonl`
- Working directory: `/Users/madda/dev/_active/Ghostex`
- Initial session date: 2026-07-16
- User follow-up date: 2026-07-20
- Session-start branch/commit: `main` at `f504fc40f034d20a6c656977577a8037a459e456`
- Codex CLI/model recorded by the session: CLI `0.144.4`, `gpt-5.6-sol`, high reasoning effort
- Current repository `HEAD` while this handoff was written: `3c1e0eb33`

## Original user request and constraints

The user reported:

> there's a clear 1px white line on the left side of the browser panes that's bothering me. please remove this line.

They explicitly requested the `fix-after-finding-root-cause` workflow, but made one exception: no temporary logs were needed. They wanted Computer Use checks after every fix attempt and app rebuild.

Shortly after the first reproduction attempt, the user added the most important symptom detail:

> it has something to do with resizing the browser pane. when i resize then that line comes and goes away randomly

Repository constraints relevant to continuing the work:

- Do not add tests for the GPUI app.
- Do not add fallbacks or cosmetic compensating behavior instead of correcting the real owner of the bug.
- Preserve strict, non-overlapping normal layout ownership.
- Do not add hit-test overrides, window-level event routing, transparent interactive overlays, synthetic coordinate routing, or intentional overlap without first explaining the exception and obtaining explicit user approval.
- Do not run or restart the app unless the current user request authorizes it. The original session was authorized to rebuild after attempts; a new agent should confirm its current task scope.
- Preserve concurrent/unrelated work and never broadly restore, reset, clean, or revert the worktree.

## Exact symptom and UI boundary

The line is on the left side of the Browser content area, at the shared boundary between the project-editor companion pane and the Browser surface. It is intermittent and changes when the vertical companion/Browser divider is resized.

The relevant layout is:

```text
project-editor companion pane
    | companion pane right border
    | 5 px outer companion divider region
    | divider base line / delayed hover indicator
    | left border of the leftmost Browser leaf
    | Browser body containing the native CEF child view
```

Multiple independent owners can therefore paint or expose a vertical column at nearly the same x-coordinate:

- `render_project_editor_companion_pane` uses a full `.border_1()`.
- `render_project_editor_companion_divider` owns the real 5 px resize region and may paint a base line and a delayed pure-white hover line.
- `render_browser_leaf` owns Browser pane focus/attention borders.
- `CefSurface` and `CefElement` position a native CEF child view using GPUI layout bounds.
- `CefBrowser::set_bounds` rounds the x/y origin and width/height independently before passing the frame to AppKit.

## Worktree state recorded at the start

The July 16 session began with unrelated pending work already present:

- `gpui/scripts/prepare-macos-runtime.sh` modified
- `gpui/src/main.rs` modified
- `sidebar/styles/groups.css` modified
- `sidebar/styles/shadcn.generated.css` modified
- `tui2/.zig-cache/` untracked

The pre-existing `gpui/src/main.rs` diff included unrelated T3 performance logging and other work. The agent stated that it would preserve those changes. The final fix was not committed during the session; it was incorporated later into `3c1e0eb33` along with a large amount of unrelated work.

As of this handoff, `gpui/src/main.rs` is clean relative to current `HEAD`. The only pre-existing current status entries observed were a modified `android` entry and untracked `tui2/.zig-cache/`; this handoff document is the only file added by this summary task.

## What the session did

### 1. Initial UI access was disrupted by concurrent launches

The agent loaded the root-cause and Computer Use skills, checked `cua-driver`, listed Ghostex processes/windows, and captured the running GPUI window. The first window was showing a terminal pane rather than Browser mode. Attempts to switch panes collided with another in-repository GPUI build/launch, and the process exited or was replaced.

This mattered throughout the session: several verification captures were taken against changing PIDs, and one late wide-width verification was explicitly discarded because another launch replaced the app process.

### 2. The user supplied the resize clue

After the user explained that resizing caused the line to appear and disappear, the agent searched Browser layout, CEF bounds, scale-factor, rounding, and divider code in app-owned GPUI sources.

The first plausible hypothesis was a native geometry/rasterization mismatch:

- GPUI can lay out the Browser body at fractional logical coordinates.
- `gpui/src/cef/shell.rs` rounds the CEF native view's origin and its size independently.
- A resize changes the fractional part of the boundary, which is consistent with an intermittent one-pixel seam.

However, this hypothesis was not instrumented, measured, or disproved. The session moved to border-color inspection after looking at screenshots.

### 3. Browser mode was reproduced and pixels were sampled

The agent opened Browser mode, dragged the real companion divider, captured screenshots with `cua-driver`, and sampled horizontal rows with ImageMagick.

The pre-fix crop around the boundary included several distinct values, including:

- near-black shell/divider pixels
- a gray pixel around `#5A5A5A`
- a brighter gray pixel around `#878789`
- Browser content around `#22242A`

This showed that multiple painted layers were close together, but it did not by itself establish which view owned the user-reported intermittent white line.

### 4. First attempted fix: remove the left border from the leftmost Browser pane

The agent inspected history and found that commit `8a3ce3f3f` had changed Browser leaves from omitting the left border on the leftmost pane to using a full `.border_1()`.

It restored the prior leftmost-pane behavior:

```rust
let is_leftmost_pane =
    self.browser_tabs.rendered_leaf_order().first().copied() == Some(pane_id);

// ...

.border_t_1()
.border_r_1()
.border_b_1()
.when(!is_leftmost_pane, |this| this.border_l_1())
```

After a rebuild, a narrow-width capture looked clear. A wider resize then reproduced an almost pure-white pair of pixels (`#FEFEFE` and `#FFFFFF`). The agent correctly marked the first attempt insufficient.

### 5. Second theory: the pure-white delayed divider hover line

The divider hover color is exactly white:

```rust
fn sidebar_divider_hover_line_color() -> Hsla {
    rgb(0xffffff).into()
}
```

The outer companion divider has a delayed/fading hover indicator, which was consistent with the line appearing after a drag and disappearing depending on timing. The agent attempted to suppress this line only in Browser mode.

The first edit accidentally changed `render_project_editor_companion_split_divider`, which is the companion pane's internal horizontal split divider, rather than the outer vertical Browser/companion divider. This mistake explains why the next rebuild still showed the white line.

The agent later identified the two similarly named functions, restored the internal split-divider behavior, and applied the condition to the correct outer divider:

```rust
.when(hover_visible && mode != TitlebarMode::Browser, |this| {
    // white animated hover line
})
```

### 6. Companion pane border was considered but not changed

When a later wide capture contained an entire sampled column of pure white, the agent briefly attributed the remaining line to the companion pane's right-side focus outline. It inspected `render_project_editor_companion_pane`, which still uses a full `.border_1()`.

The agent then revised that conclusion: it realized the hover-line patch had been applied to the wrong divider function, corrected the divider patch, and did **not** change the companion pane border.

This is important for the next investigation: the session's commentary mentioned three possible paint owners, but the final implementation changed only two. The companion pane's full border remains active. Its normal focused color is gray rather than pure white in current code, so it should be tested as an owner rather than assumed to be the answer.

### 7. Final July 16 verification and conclusion

After the third rebuild, the agent reacquired the canonical Ghostex process, reopened Browser mode, and performed several divider drags. It captured narrow, wide, over-dragged, restored, and pointer-resting states.

The final averaged/sampled boundary data contained dark pixels rather than white. The agent concluded that the combination of:

- no left border on the leftmost Browser leaf, and
- no white hover indicator on the outer companion divider in Browser mode

had removed the line. It ran `git diff --check`, confirmed no diagnostic Browser-line logging had been added, and handed off the result as visually verified.

No tests were added, as required.

## Why the July 16 verification was not conclusive

The July 20 user report is the decisive evidence that the fix was incomplete. Several aspects of the July 16 procedure could have produced a false pass:

1. **The issue is intermittent.** A few successful widths cannot establish that all fractional layout positions are safe.
2. **The mouse/hover timing changed between captures.** Suppressing the hover line removed one visibly white state, but may have hidden a second issue during that specific pass.
3. **Processes were replaced during testing.** At least one verification run was discarded for this reason, and repeated rebuilds made process identity a persistent source of uncertainty.
4. **The final scan was not a proof of frame ownership.** Some ImageMagick commands averaged a full vertical crop down to one pixel per column. That can hide a seam that exists over only part of the height or appears transiently during/just after resize.
5. **The native geometry hypothesis was abandoned too early.** The agent searched the Rust bounds path but did not inspect or measure the complete macOS native-frame path.
6. **The exact user state may have differed.** Focus owner, page background, window backing scale, divider drag endpoint, and whether the pointer remained on the divider can all change the pixels at this boundary.

## Current code state of the failed fix

The two July 16 hunks are currently in `gpui/src/main.rs` and blamed to `3c1e0eb33`:

- `render_project_editor_companion_divider`: the animated hover line is gated with `mode != TitlebarMode::Browser`.
- `render_browser_leaf`: `is_leftmost_pane` is computed, and only non-leftmost leaves get `.border_l_1()`.

Other relevant current behavior:

- `render_project_editor_companion_pane` still uses `.border_1()` on all four sides.
- The project-editor surface wrapper intentionally omits its own outer border in Browser mode.
- `project_editor_companion_divider_background_color()` and `project_editor_companion_divider_line_color()` are currently fully transparent.
- The divider remains a real, exact 5 px layout region and resize target; the failed fix did not alter its hit area.
- Internal Browser split separators were preserved.

## Important unclosed technical path: CEF/AppKit resize geometry

The next agent should revisit the geometry path that was initially suspected but never resolved.

Relevant current code:

- `gpui/src/main.rs`
  - `render_browser_body`
  - `CefSurface::render`
  - `CefElement::prepaint`
- `gpui/src/cef/shell.rs`
  - `CefBrowser::set_bounds`
- `gpui/src/cef/macos.rs`
  - `set_native_view_frame`
- `gpui/native/macos/GpuiCefAppKitHooks.m`
  - `GhostexGpuiCEFSetNativeViewFrame`

`CefSurface::render` and `CefElement::prepaint` both call `set_bounds`. In `CefBrowser::set_bounds`, the logical origin and logical width are rounded separately:

```rust
let rect = cef::Rect {
    x: bounds.origin.x.as_f32().round() as i32,
    y: bounds.origin.y.as_f32().round() as i32,
    width: bounds.size.width.as_f32().round().max(0.0) as i32,
    height: bounds.size.height.as_f32().round().max(0.0) as i32,
};
```

The macOS adapter then passes those integer-valued logical coordinates to AppKit as point coordinates. `GhostexGpuiCEFSetNativeViewFrame` assigns them directly with `NSMakeRect`, after converting the y origin for an unflipped parent. The July 16 agent read the Rust macOS wrapper but did not inspect this Objective-C implementation.

This does not prove the bug is rounding. It is a concrete, still-open hypothesis that fits the resize-dependent appearance better than a permanently painted border. A useful falsifiable question is whether the white column appears exactly at widths where rounding `origin.x` and `size.width` separately makes the native CEF frame disagree with the GPUI Browser-body edge in backing pixels.

## Recommended continuation sequence

1. **Reproduce the issue in the current build before editing.** Use the exact user flow: Browser mode, companion visible, repeatedly drag the outer vertical companion divider through small one- or two-point increments until the line appears.
2. **Lock onto one app PID/window.** If another build replaces the process, discard the capture and reacquire before drawing conclusions.
3. **Capture the failure immediately and after hover has fully cleared.** Move the pointer away from the divider and wait beyond the hover delay/fade. If the line remains, it is not the already-suppressed hover indicator.
4. **Check focus variants.** Capture with Browser focused and with the companion focused. This distinguishes Browser and companion focus borders.
5. **Sample full-height columns without averaging away local defects.** Report exact white/near-white pixel coordinates and the y ranges where they occur. Compare several adjacent columns.
6. **Identify the owner before changing behavior.** Useful discriminators include temporarily assigning unmistakably different debug colors to the companion right border, divider region, Browser left edge/background, and CEF/page background one at a time. Remove every diagnostic color before handoff.
7. **Measure the actual frame relationship.** Compare the GPUI Browser-body bounds, the integer rectangle cached in `CefBrowser::set_bounds`, the NSView frame, and backing-pixel conversion at a failing width. The original user requested no logs, so prefer debugger/UI inspection or narrowly scoped temporary instrumentation only if the current user authorizes it.
8. **Implement the correction at the true owner.** Do not add another Browser-specific paint suppression unless the evidence proves that paint layer is itself wrong.
9. **Verify across a sweep of adjacent widths and timing states.** Include pointer-on-divider, pointer-away after fade, Browser focus, companion focus, and at least one internal Browser split so the solution does not erase legitimate separators.
10. **Clean failed attempts.** If the current two suppressions are proven irrelevant, remove them surgically. Preserve all unrelated hunks and do not revert the large WIP commit.

## Timeline

| Time (UTC) | Event |
| --- | --- |
| 2026-07-16 02:07 | User reported a clear 1 px white line at the left of Browser panes and requested root-cause-first visual verification without logs. |
| 02:08–02:10 | Agent checked the worktree and Computer Use, then encountered concurrent GPUI launches while trying to reach Browser mode. |
| 02:11 | User clarified that resizing makes the line appear and disappear randomly. |
| 02:11–02:13 | Agent traced Browser/CEF bounds, rounding, pane borders, and divider code; opened Browser mode and sampled boundary pixels. |
| 02:14 | First patch removed the left border from the leftmost Browser leaf; rebuild started. |
| 02:16–02:18 | Narrow state looked clear; wider drag reproduced `#FEFEFE/#FFFFFF`, proving the first patch insufficient. |
| 02:19 | Agent attempted to suppress the divider hover line but initially edited the wrong, internal split-divider function. |
| 02:21–02:23 | Second rebuild still showed a pure-white column; agent considered companion focus paint, found the wrong-function edit, restored internal behavior, and patched the correct outer divider. |
| 02:23–02:30 | Third rebuild and multiple drags appeared clear; one process-replaced pass was discarded, then a reacquired process passed the agent's final samples. |
| 02:30 | Agent declared the issue fixed and asked for the surgical change to be committed promptly. |
| 2026-07-18 | The two fix hunks were included in large WIP commit `3c1e0eb33`. |
| 2026-07-20 01:14 | User reported: “sadly the line is still visible for me, please check now.” |
| 01:14–01:26 | Three continuation attempts were interrupted or rolled back. No new tool calls, code changes, diagnosis, or verification were recorded. |

## Bottom line for the next agent

The previous agent successfully found and suppressed two real paint sources at the boundary, including an actual pure-white hover indicator, but the user's original intermittent seam remains. Treat the current patch as an incomplete experiment, not a finished fix. The most valuable next step is to reproduce the line in the current build while separating hover/focus paint from the native CEF frame edge, then prove which boundary owner creates the failing pixel before editing code.
