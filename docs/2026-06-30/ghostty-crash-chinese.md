# Ghostty Renderer Crash With macOS Simplified Chinese Pinyin Input

Date: 2026-06-30

## Summary

Ghostex was crashing on macOS while users typed Simplified Chinese text through the built-in macOS Chinese Pinyin input method. The crash was easiest to trigger in a terminal pane, especially while typing into an interactive terminal program such as Claude Code, but the terminal program was not the root cause. The crash happened in Ghostex's embedded Ghostty renderer thread while Ghostty was rebuilding Metal renderer cells.

The immediate bug was an out-of-bounds slice access in Ghostty's generic renderer, in the preedit-specific shaper-cell catch-up path inside `ghostty/src/renderer/generic.zig`.

The bad access was:

```zig
while (run.offset + shaper_cells_unwrapped[shaper_cells_i].x < x) {
    shaper_cells_i += 1;
}
```

That loop indexed `shaper_cells_unwrapped[shaper_cells_i]` before proving that `shaper_cells_i` was still less than `shaper_cells_unwrapped.len`. During some IME/preedit renderer states, `shaper_cells_i` could equal the slice length, or could be advanced to the slice length by the loop. The next loop condition evaluation then indexed past the end of the slice. Zig's runtime safety checks correctly detected this and aborted the process with an `outOfBounds` panic.

The test fix changed the loop to:

```zig
while (shaper_cells_i < shaper_cells_unwrapped.len and
    run.offset + shaper_cells_unwrapped[shaper_cells_i].x < x)
{
    shaper_cells_i += 1;
}
```

After rebuilding `GhosttyKit.xcframework`, relinking Ghostex, reinstalling `/Applications/Ghostex.app`, and testing sustained Simplified Chinese Pinyin typing again, the user reported that the issue appeared fixed.

## User-Visible Symptom

The reported symptom was repeated Ghostex quits/crashes on macOS during Chinese text input.

The common pattern was:

1. Open a Ghostex terminal pane.
2. Use an interactive terminal prompt or program, often Claude Code.
3. Switch to the built-in macOS Simplified Chinese Pinyin input method.
4. Type Chinese text, sometimes for a while rather than just a single key.
5. Ghostex exits abruptly.

The crash was intermittent. It did not happen for every Chinese input session, every key, every candidate, or every Chinese character. Sometimes the same workflow worked normally. Sometimes it crashed quickly. This intermittent behavior is consistent with a renderer state bug that depends on a particular combination of preedit range, cursor position, row contents, shaping result, viewport dimensions, dirty-row state, and frame timing.

## Why Chinese Pinyin Input Exercises This Path

The built-in macOS Simplified Chinese Pinyin input method does not send only final committed Chinese text. While the user is typing, AppKit maintains marked text, also called preedit or composition text. That preedit state changes frequently before final commit.

For example, while entering Chinese through Pinyin, the input method can repeatedly update the active marked text as the user types Latin letters, extends the Pinyin sequence, selects candidates, or commits part of the composition. The important renderer fact is not the exact text. The important fact is that the terminal receives a stream of intermediate composition states that may differ in:

- UTF-8 byte length.
- Unicode codepoint count.
- terminal display width in cells.
- whether the visible composition contains narrow Latin input or wide CJK characters.
- whether the preedit range starts, ends, grows, shrinks, or clears at the cursor.

In a terminal renderer, this is more complex than ordinary committed text. The terminal grid has existing row contents, the cursor is at a cell coordinate, and the renderer overlays the preedit string at that cursor position without permanently modifying the terminal row. That means the renderer has to combine:

- the terminal row cells already present in the screen buffer.
- the cursor viewport x/y.
- the preedit codepoints and their terminal cell widths.
- the preedit range that should be hidden in the normal row renderer.
- the separately rendered preedit glyphs.
- the font shaper output for the row.

Sustained Simplified Chinese Pinyin typing produces many fast preedit updates. That makes it much more likely to hit the specific renderer state where the normal row renderer skips the preedit range and then needs to catch the font shaper index up to the first cell after that range.

## Why Claude Code Was A Trigger Context, Not The Cause

The crashes were often seen while typing into Claude Code because Claude Code is an interactive terminal application. It keeps the terminal focused at an input prompt, updates the screen often, and encourages longer text entry. That increases the number of frames where Ghostty must render a live preedit overlay.

The crash reports did not point at Claude Code, the shell, a pty read/write path, or terminal command handling. They pointed at the renderer thread:

```text
debug.FullPanic((function 'defaultPanic')).outOfBounds
renderer.generic.Renderer(renderer.Metal).rebuildRow
renderer.generic.Renderer(renderer.Metal).rebuildCells
renderer.generic.Renderer(renderer.Metal).updateFrame
```

So Claude Code was treated as a high-frequency reproducer, not a direct root cause.

## Crash Evidence

The first reports were from Ghostex 5.1.0 build 50100 on Apple Silicon macOS, with the built-in macOS Chinese input method active. The crash reports had the main thread labeled with Apple's SCIM input method:

```text
Thread 0:: (input method 86369 com.apple.inputmethod.SCIM)
```

That did not mean Apple's input method crashed Ghostex. It meant AppKit IME handling was active at the time of the crash. The triggered thread was the Ghostty renderer thread.

The repeated 5.1.0 signature was:

```text
Triggered by Thread: renderer
Exception Type: EXC_CRASH (SIGABRT)
Application Specific Information: abort() called

debug.FullPanic((function 'defaultPanic')).outOfBounds
renderer.generic.Renderer(renderer.Metal).rebuildCells + 22900
renderer.generic.Renderer(renderer.Metal).updateFrame + 7484
```

At that stage, the binary still had enough symbols to identify the function, but not enough source-line information to identify the exact line. The important facts were:

- the same renderer function and offset appeared in multiple reports.
- the exception was `SIGABRT`, not a random memory fault.
- the abort came from Zig's `outOfBounds` panic path.
- the crash happened on the renderer thread.
- the active input context was the macOS Chinese input method.

That made the preedit renderer path the most likely area to inspect.

## Suspected Path Before Line-Level Confirmation

The suspected data flow was:

```text
macOS AppKit marked text / preedit
-> Ghostex native terminal input bridge
-> Ghostty embedded surface preedit callback
-> Surface.preeditCallback
-> renderer_state.preedit
-> renderer updateFrame
-> rebuildCells
-> rebuildRow
-> preedit shaper-cell catch-up
-> out-of-bounds panic
```

The key source-level suspicion was the preedit-specific block in `rebuildRow`. The renderer skips the cells covered by the preedit range because the preedit text is rendered separately. Immediately after the range, it catches the shaper index up to the current terminal cell `x`.

That catch-up path had an unguarded index access:

```zig
while (run.offset + shaper_cells_unwrapped[shaper_cells_i].x < x) {
    shaper_cells_i += 1;
}
```

This was suspicious because nearby renderer loops already guarded `shaper_cells_i < shaped_cells.len` before indexing. This loop did not.

## Diagnostic Build

A diagnostic build was added to confirm the source-level hypothesis without logging user text.

The diagnostic path records only static event names and numeric/boolean metadata. It intentionally does not log raw terminal text, commands, URLs, file paths from terminal content, or the user's input text.

The diagnostic events include:

- `ghostty.preeditCallback.set`
- `ghostty.preeditCallback.clear`
- `ghostty.rebuildCells.preeditRange`
- `ghostty.rebuildCells.preeditShaperCatchupStart`
- `ghostty.rebuildCells.preeditShaperCatchupOutOfBoundsBeforeIndex`
- `ghostty.rebuildCells.preeditShaperCatchupOutOfBoundsAfterAdvance`

The metadata includes values such as:

- cursor x/y.
- screen rows/columns.
- preedit codepoint count.
- preedit width in terminal cells.
- preedit range start/end.
- shaper run offset and cell count.
- current shaper cell index.
- shaper cell slice length.

The diagnostics were wired through a Ghostex setting so the user could enable them only while reproducing the issue.

## Line-Level Confirmation

After the diagnostic-enabled Ghostex 5.2.0 build 50200 was tested, the user reproduced the crash at approximately 2026-06-30 18:12:20 +0400.

That crash report had source-line information and confirmed the exact crash site:

```text
Thread 61 Crashed:: renderer
debug.FullPanic((function 'defaultPanic')).outOfBounds
renderer.generic.Renderer(renderer.Metal).rebuildRow + 4004 (generic.zig:2793)
renderer.generic.Renderer(renderer.Metal).rebuildCells + 3828 (generic.zig:2454)
renderer.generic.Renderer(renderer.Metal).updateFrame + 3424 (generic.zig:1365)
renderer.Thread.renderCallback + 160 (Thread.zig:610)
```

The confirmed crashing source line was the unguarded loop condition:

```zig
while (run.offset + shaper_cells_unwrapped[shaper_cells_i].x < x) {
```

This directly matched the earlier hypothesis.

## How The Renderer State Fails

The relevant `rebuildRow` logic iterates over terminal row cells from left to right.

When there is no preedit state, rendering can process the row normally. The shaper iterator and `shaper_cells_i` generally advance as the renderer visits each `x` cell.

When there is preedit state on the current row, the renderer does something special:

1. It leaves ordinary cells before the preedit range alone.
2. It skips ordinary row rendering for cells inside the preedit range.
3. It renders the preedit glyphs separately.
4. When it reaches the first cell after the preedit range, it must move the font shaper index forward because the main row loop skipped several cells.

The first cell after the range is detected by:

```zig
if (x != range.x[1] + 1) break :preedit;
```

At that point the code finds the current shaping run and shapes it if needed. Then it tries to catch the shaper-cell index up:

```zig
const shaper_cells_unwrapped = shaper_cells.?;
while (run.offset + shaper_cells_unwrapped[shaper_cells_i].x < x) {
    shaper_cells_i += 1;
}
```

This assumes there is always a shaped cell at `shaper_cells_i` while the loop condition is evaluated. That assumption is not always valid.

The bad state can happen when the shaper output for the current run has no remaining shaped cells before the target `x`, or when advancing through the shaped cells reaches the end of the slice before finding a cell at or after `x`. Once `shaper_cells_i == shaper_cells_unwrapped.len`, the next condition check indexes one element past the slice.

In Zig safety-checked builds, that is not silent memory corruption. Zig calls the panic handler for an out-of-bounds slice index. Ghostex then aborts, producing the macOS crash report.

## Why It Was Intermittent

The crash required more than "Chinese input is enabled." It needed a particular renderer state.

Likely contributing factors included:

- live IME preedit state.
- cursor position on the row.
- terminal row contents before and after the cursor.
- whether the row was dirty and rebuilt that frame.
- preedit width in terminal cells.
- whether the preedit contained wide CJK characters or narrow Pinyin text.
- the current font shaping run boundaries.
- the number of shaped cells returned for the run.
- terminal pane width and wrapping behavior.
- frame timing between native input updates and renderer rebuilds.

This is why the issue could happen while typing a lot of Simplified Chinese Pinyin text, then disappear for the same user and same workflow for a while. More typing means more preedit updates and more chances to hit the failing combination, but each individual keystroke is not guaranteed to reproduce it.

## Why The Fix Is Correct

The fix adds the missing bounds guard to the catch-up loop:

```zig
while (shaper_cells_i < shaper_cells_unwrapped.len and
    run.offset + shaper_cells_unwrapped[shaper_cells_i].x < x)
{
    shaper_cells_i += 1;
}
```

This preserves the intended behavior while the index is valid: advance until the shaped cell reaches or passes the current terminal cell `x`.

It also handles the edge case: if there are no more shaped cells, stop advancing and let the later existing renderer logic handle the exhausted shaper-cell state.

There is already later logic in the same row renderer that recognizes when the shaped cells are exhausted:

```zig
if (shaper_cells != null and shaper_cells_i >= shaper_cells.?.len) {
    shaper_run = try run_iter.next(self.alloc);
    shaper_cells = null;
    shaper_cells_i = 0;
}
```

So the fix does not invent a new recovery path. It prevents the preedit catch-up loop from crashing before the existing exhaustion handling can run.

## Validation Performed

The fix was built and tested in a local Ghostex 5.2.0 build.

Important build details:

- `GhosttyKit.xcframework` had to be rebuilt from the modified `ghostty/src` source.
- The global `zig` binary was 0.16.0 and was not compatible with this Ghostty checkout.
- The correct Zig toolchain was `/opt/homebrew/opt/zig@0.15/bin/zig`, version 0.15.2.
- The Ghostty build needed explicit version overrides so it did not infer the parent Ghostex repository tag:

```text
-Dversion-string=1.3.2-dev
-Dlib-version-string=0.1.0-dev
```

After rebuilding `GhosttyKit.xcframework`, `bun run start` was run again. This time Xcode rebuilt the native app shell instead of reusing the cached app binary. The installed app at `/Applications/Ghostex.app` was then re-signed, resource-validated, and launched.

The installed binary was confirmed to include the diagnostic renderer event strings, showing that the diagnostic-enabled Ghostty renderer code was present in the app:

```text
ghostty.rebuildCells.preeditShaperCatchupStart
ghostty.rebuildCells.preeditShaperCatchupOutOfBoundsBeforeIndex
ghostty.rebuildCells.preeditShaperCatchupOutOfBoundsAfterAdvance
ghostty.rebuildCells.preeditRange
ghostty.preeditCallback.set
```

The user then tested the same Simplified Chinese Pinyin input workflow again and reported that the crash appeared fixed.

## Practical Root-Cause Statement

The crash was not caused by Claude Code and was not caused by Apple's Chinese input method crashing inside Ghostex.

The practical root cause was:

Ghostex forwarded macOS IME marked-text/preedit updates into the embedded Ghostty terminal renderer. During a renderer frame, Ghostty skipped the terminal cells covered by the preedit overlay and then tried to catch the font shaper index up to the first cell after the preedit range. That catch-up loop indexed the shaped-cell slice without first checking that the index was still in range. Sustained Simplified Chinese Pinyin input made this path frequent enough to hit an edge case where the index reached the end of the shaped-cell slice, causing Zig's bounds check to abort the app.

## Follow-Up Considerations

The minimal guard fixes the confirmed crash site. The diagnostics should remain available until there is enough confidence from real-world IME use, because the surrounding area is complex and depends on renderer/preedit/font-shaping state.

Useful follow-up checks:

- Keep the IME renderer diagnostics setting available for at least one release cycle.
- If another IME crash appears, compare whether it still lands in `rebuildRow` or moves to another preedit/cursor/grid access.
- Consider adding a focused renderer test or fuzz-style scenario around preedit ranges and shaped-cell exhaustion.
- Consider upstreaming the one-line bounds guard to Ghostty if the vendored code is still close enough to upstream.
