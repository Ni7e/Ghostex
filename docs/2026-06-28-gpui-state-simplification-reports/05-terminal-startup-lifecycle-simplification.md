# Report 05: Terminal Startup and Lifecycle Simplification

## Summary

The terminal path is one of the most complete parts of GPUI: real GhosttyKit surfaces are mounted through AppKit host views. The complexity is mostly in lifecycle layers, especially startup, parking, reattach, command versus Agents identity, and placeholder transitions.

## What is implemented

Terminals currently have:

- GPUI-owned Agents and command-pane tab/split chrome.
- AppKit host `NSView` ownership for mounted terminal bodies.
- GhosttyKit surface creation and ownership.
- Startup owners and hidden startup hosts for Mounting Agents sessions.
- Running surface owners for Agents and command terminals.
- Parked owners for inactive/sleeping/popped-out/reattach paths.
- Native key forwarding by exact host view.
- IME committed text, preedit, candidate-window geometry.
- Mouse, scroll, pressure, capture-gated mouse-up-out.
- Clipboard read/write handoff and direct paste.
- Close-confirm, request-close, and process-exit cleanup.
- Settings-backed `terminalFontSize` in surface config.

## Evidence

- `gpui/src/terminal_surface_host.rs`
- `gpui/src/terminal_surface_lifecycle.rs`
- `gpui/src/terminal_native_view.rs`
- `gpui/src/terminal_ghostty_surface.rs`
- `gpui/src/ghostty_kit.rs`
- `gpui/native/macos/GpuiTerminalAppKitAdapter.m`
- `gpui/src/main.rs`
  - Agents terminal startup coordinator.
  - Startup host and Ghostty owner reconciliation.
  - Running owner parking and reattach.
  - Command terminal launch payload source.
  - Terminal input and mouse forwarding.

## What appears too complex or partially historical

- The terminal startup path has many stages before a tab becomes Running.
- Some comments state startup launch payload sources are empty until explicit producers are wired.
- Local gxserver sidebar attach creates Running tabs directly with attach payloads, bypassing the generic Mounting startup card.
- New Agents terminals enter Mounting state, while some real attach paths are immediately Running.
- Agents and command terminals share some runtime mechanisms but keep separate maps and lifecycle paths.
- Several modules have crate-level `#![allow(dead_code)]`, even though many pieces are now used.

## Why this looks over-complex

The code currently models several distinct cases through overlapping lifecycle machinery:

- Brand-new terminal startup.
- Sidebar-attached existing gxserver terminal.
- Sleeping wake.
- Popped-out reattach.
- Restored shell placeholder materialization.
- Failed startup retry.
- Command terminal action launch.

Some of these need real process launch, some need owner transfer, and some are just shell placeholder state. They should be easier to distinguish.

## Parallel-safe cleanup target

Separate terminal lifecycle into explicit lanes:

1. **New process lane**: creates a new Ghostty process from a launch payload.
2. **Attach lane**: uses an existing gxserver/remote attach command payload and becomes Running directly.
3. **Owner transfer lane**: moves an existing parked host/surface back to a visible body.
4. **Placeholder lane**: shell-only state with no runtime work.

## Suggested implementation path

1. Rename or extract startup types so they only describe the new-process lane.
2. Move parked owner reattach into its own module.
3. Keep command terminal and Agents terminal shared primitives generic, but isolate each product lane's state maps.
4. Remove `#![allow(dead_code)]` from terminal modules once unused helpers are deleted.
5. Add comments only where a state is intentionally placeholder-only or process-owning.

## Risks

- Terminal runtime is real and sensitive. Avoid changing AppKit/Ghostty ordering during the first cleanup.
- Remote attach and local gxserver attach depend on terminal launch payloads. Coordinate with remote runtime cleanup.

## Done when

- A new terminal, a sidebar attach, and a sleeping wake each follow a visibly separate code path.
- Placeholder state cannot accidentally imply process launch.
- Running/parked/startup owner maps have names that reflect their actual ownership.
