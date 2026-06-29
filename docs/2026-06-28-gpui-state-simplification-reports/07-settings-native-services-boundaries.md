# Report 07: Settings and Native Service Boundaries

## Summary

GPUI reuses shared React Settings/modals but implements many native service boundaries in Rust and Objective-C. These are useful, but they should stay narrow because they add significant surface area outside the core GPUI shell.

## What is implemented

### Shared settings

`gpui/src/shared_settings.rs` reads and writes the shared sidebar settings JSON. Rust parses only the GPUI fields it needs, including:

- Debugging Mode and Show Beta Features.
- Sidebar side and width.
- Browser feedback tool.
- Project editor auto-sleep.
- Keep Awake settings.
- App Shots settings.
- Notification settings.
- Some Ghostty terminal settings.
- gxserver agent policy render cache.

### Native services

Objective-C shims under `gpui/native/macos/` implement:

- CEF AppKit hooks and message pump.
- Terminal host AppKit views.
- UserNotifications and Keychain helpers.
- App Shots capture.
- Lid-sleep privileged helper client.
- Reduce Motion reads.
- Menu-bar status item and Running Agents dropdown.

## Evidence

- `gpui/src/shared_settings.rs`
- `gpui/build.rs`
- `gpui/native/macos/GpuiSettingsNotifications.m`
- `gpui/native/macos/GpuiAppShots.m`
- `gpui/native/macos/GpuiLidSleepHelperClient.m`
- `gpui/native/macos/GpuiAccessibilityDisplayOptions.m`
- `gpui/native/macos/GpuiMenuBarStatusItem.m`
- `gpui/src/main.rs`
  - Keep Awake runtime.
  - App Shots callbacks.
  - Notification handlers.
  - Menu-bar status handlers.
  - Pet overlay rendering.

## What appears partially hooked or intentionally limited

- Embedded Ghostty surfaces currently consume only supported FFI fields such as `terminalFontSize`; other Ghostty settings are config-file-backed for future or recreated surfaces.
- There is no claimed live embedded Ghostty config reload.
- `keepAwakeDeactivateOnUserSwitch` is parsed but currently no-op.
- Notification and App Shots paths are real, but they are peripheral to the GPUI shell and increase native shim maintenance.
- Menu-bar status and pet overlay are driven by sidebar status payloads and are not primary shell behavior.

## Why this looks over-complex

Settings and native services are spread across Rust, Objective-C, shared React modals, and TypeScript settings schemas. The current split is workable, but it is easy for Rust to accidentally duplicate the full TypeScript settings model or for native shims to grow beyond their exact boundary.

## Parallel-safe cleanup target

Create one settings/native-services ownership map:

- Field name.
- Rust consumes it or only passes it through.
- Native shim uses it or not.
- Live effect versus next-surface/restart effect.
- Unsupported/no-op status.

## Suggested implementation path

1. Move settings parsing helpers into smaller typed sections or modules.
2. Add explicit "live effect" comments for each GPUI-consumed setting.
3. Remove parsed fields that do not affect GPUI behavior unless they are needed for React Settings rendering.
4. Keep native services behind feature-specific functions, not a broad native bridge.
5. Keep each Objective-C shim compiled separately, but document which Rust module owns it.

## Done when

- Every GPUI-consumed setting has a clear current effect.
- No setting suggests live behavior that is not implemented.
- Native shims remain feature-specific and cannot become generic privileged/native side-effect channels.
