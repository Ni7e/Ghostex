# GPUI Parity — Deferred / Out-of-Scope Tracker

Living document. Every parity batch appends items here that were consciously deferred or declared out of scope, so we can sweep them at the end instead of losing them. Keep entries short: what, why deferred, where the code hooks are, and what "done" would look like.

Format: `- [origin batch] item — reason — re-entry pointer`

## Deferred by user decision

- [Batch 2 / G2, Decision #2 2026-07-02] **Pop-out pane windows** — user: keep no-op for now, revisit later. macOS re-parents the surface into a real NSWindow (`native/macos/.../TerminalWorkspaceView` ~:16356-16553). GPUI `popOutPane` message stays a silent no-op. Done = a real GPUI window hosting the re-parented terminal surface with return-to-layout.

## Deferred from Batch 0 (see plan's Batch 0 status block for detail)

- [Batch 0.2] Rust-originated in-modal toasts still render inside the open modal window (remote-clone flow depends on it); toast action buttons unsupported.
- [Batch 0.3] SEARCH / MOUSE_OVER_LINK / DESKTOP_NOTIFICATION Ghostty action tags — land with Batch 2 UI.
- [Batch 0.4] Removed/remapped-away chords stay bound until relaunch; hardcoded base binds still registered alongside remaps.
- [Batch 0.5] Daemon bootstrap does not gate window creation; buildIdentity check + auto-restart on toolchainUnavailable replaced by warning toast; stop-control-plane API not ported.

## Deferred from Batch 1

(appended as Batch 1 lands)
