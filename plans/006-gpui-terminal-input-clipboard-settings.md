# Plan 006: Match macOS terminal input, clipboard, drag/drop, and Ghostty settings behavior

> **Executor instructions**: Follow this plan step by step. Stop on STOP conditions.
>
> **Drift check (run first)**: `git diff --stat 5d9960dff..HEAD -- gpui/src/main.rs gpui/src/terminal_ghostty_surface.rs gpui/src/terminal_native_view.rs gpui/native/macos/GpuiTerminalAppKitAdapter.m gpui/src/shared_settings.rs native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift native/sidebar/native-sidebar.tsx shared/ghostty-terminal-settings.ts sidebar/settings-modal.tsx`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans/004-gpui-terminal-launch-restore.md
- **Category**: correctness
- **Planned at**: commit `5d9960dff`, 2026-06-26

## Why this matters

macOS terminal behavior includes native key delivery, mouse/scroll/pressure forwarding, clipboard read/write, image/file paste, drops, and live-ish Ghostty settings application. GPUI must match the behavior, not only the visible terminal chrome.

## Current state

- macOS terminal paste/drop handling is in `TerminalWorkspaceView.swift` around clipboard and drop code.
- GPUI terminal body currently has substantial mouse/key/mount handling in `gpui/src/main.rs` around the mounted body renderer.
- GPUI settings parser currently consumes only selected fields, including terminal font size: `gpui/src/shared_settings.rs:176`.
- Audit found GPUI lacks macOS image/file-to-Markdown paste/drop parity and full Ghostty settings application.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| GPUI terminal input tests | `cargo test --manifest-path gpui/Cargo.toml clipboard drop terminal_settings -- --nocapture` | relevant tests pass |
| Settings tests | `bun run test -- ghostty-terminal-settings settings-modal` | relevant tests pass |
| Typecheck | `bun run typecheck` | exit 0 |

## Scope

**In scope**:
- GPUI terminal clipboard read/write callbacks.
- GPUI terminal paste/drop handling.
- Ghostty terminal settings mapping and live/recreated surface application.
- Tests for privacy and behavior.

**Out of scope**:
- App-level Browser drag/drop.
- Prompt editor image handling, except where shared clipboard helpers can be reused.

## Steps

### Step 1: Port macOS paste/drop semantics

Inspect current macOS behavior for plain text, file URLs, image files, raw pasteboard images, and opt-out settings. Implement equivalent GPUI handling at the exact terminal host/body boundary. Register drag/drop only on exact terminal views, not broad overlays.

**Verify**: tests cover plain text, raw image, file-backed image, non-image file, setting disabled, and empty clipboard.

### Step 2: Preserve privacy in generated Markdown and logs

If image paste stores files under the macOS-equivalent location, do not log paths or generated Markdown. Persistent logs may record counts/booleans only.

**Verify**: logging/privacy test asserts example paths and Markdown content do not appear.

### Step 3: Match Ghostty settings behavior

Compare macOS settings fan-out and embedded Ghostty reload behavior. Expand GPUI surface config beyond font size to match macOS where GhosttyKit safely supports it. If a setting cannot be live-applied, match macOS user-facing timing as closely as possible and document the limitation in code comments.

**Verify**: tests prove settings-to-GPUI surface config for font family, theme, cursor, scrollback, clipboard, mouse, paste preview, and font size.

### Step 4: Verify native key/mouse/focus boundaries

Keep all input forwarding inside exact body/host bounds. Do not add window-level pre-dispatch or broad hit-test routing.

**Verify**: source tests or Rust model tests prove stale/missing mount slots no-op and placeholders keep activation semantics.

## Test plan

- Rust unit tests for clipboard/drop parsing and terminal settings mapping.
- TS settings tests if shared settings helpers change.
- Manual runtime checks only when operator permits: type, paste, drag image, drop file, change settings, verify existing and recreated terminals.

## Done criteria

- [ ] GPUI terminal paste/drop matches macOS behavior.
- [ ] GPUI applies Ghostty terminal settings like macOS, or has explicitly tested safe deferred behavior where macOS itself defers.
- [ ] No broad overlays or root hit-test routing were added.
- [ ] Targeted Rust and TS tests pass.

## STOP conditions

- Implementing image/file paste requires logging or persisting private paths outside macOS behavior.
- The GhosttyKit API cannot support a macOS-equivalent live setting without upstream work.
- A drag/drop fix appears to require invisible overlapping views.

## Maintenance notes

Future terminal input changes must preserve exact native layout ownership. Reviewers should inspect for private data in persistence and support logs.

