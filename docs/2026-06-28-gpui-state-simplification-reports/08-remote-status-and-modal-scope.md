# Report 08: Remote, Status, and Modal Scope

## Summary

Remote gxserver, status indicators, pet overlay, menu-bar dropdowns, and app modals are all present in GPUI. They are useful parity work, but they also expand `main.rs` far beyond the core shell, terminal, and CEF browser responsibilities.

## What is implemented

### App modals

GPUI opens the shared React modal host in a real CEF-backed GPUI window for:

- Settings.
- Hotkeys.
- Command Palette.
- Previous Sessions.
- Running Sessions.
- Agents Hub.
- Remote Setup.
- Remote Project Picker.
- Rename Session.
- Delayed Send.

### Remote gxserver

Runtime support exists for:

- Saved remote machine reconnect.
- SSH tunnel process ownership.
- Remote gxserver token/keychain handling.
- Remote presentation streams.
- Remote repository clone preview/start/cancel/polling.
- Remote attach sessions mapped to GPUI terminal tabs.
- Remote native actions such as copy path, PR browser open, editor open, and recent-project folder command copy.

### Status and pet surfaces

Runtime support exists for:

- Sidebar status payload parsing.
- Menu-bar status counts and Running Agents dropdown.
- Session attention notifications.
- Pet overlay state and animation.
- Status/pet activation callbacks into the sidebar runtime.

## Evidence

- `gpui/src/main.rs`
  - `GpuiAppModalKind`
  - `open_gpui_app_modal_from_titlebar`
  - remote gxserver connection and clone handlers
  - remote attach handlers
  - status/pet/menu-bar handlers
  - notification handlers
- `gpui/sidebar/gxserver-runtime.ts`
  - remote presentation and request handling
  - workspace terminal focus/lifecycle bridges
  - status/pet payload publishing
- `gpui/native/macos/GpuiMenuBarStatusItem.m`
- `gpui/native/macos/GpuiSettingsNotifications.m`

## What is not fully in scope or intentionally limited

- Previous Sessions text search is explicitly harmless/no-op.
- Running Sessions opens the shared modal, but full macOS Resources dropdown parity is separate work.
- Remote editor support is limited to reviewed fixed launchers. Some custom/unsupported editors remain unsupported.
- Remote App Shot insertion requires an already-mounted remote attach terminal and does not wake or create remote tabs.
- Some modal commands are intentionally ignored when no GPUI production bridge exists.

## Why this looks over-complex

These features are mostly independent from the core GPUI shell, but they currently share the same giant app state and modal command switch. That makes it difficult to answer whether a change is about shell layout, terminal runtime, gxserver, or React modal compatibility.

## Parallel-safe cleanup target

Separate feature groups by ownership:

- `app_modals`: CEF modal host and modal command handling.
- `remote_runtime`: saved-machine connections, remote requests, clone jobs, attach terminal plans.
- `status_surfaces`: menu-bar status, pet overlay, attention notifications.
- `sidebar_lifecycle`: workspace focus/lifecycle requests shared with gxserver.

## Suggested implementation path

1. Extract app modal open/bridge handling before changing modal behavior.
2. Move remote gxserver connection and request helpers into a remote module.
3. Move status/pet/menu-bar state into a presentation module that accepts already-sanitized sidebar payloads.
4. Replace large modal command switches with smaller feature-specific handlers.
5. Keep unsupported modal commands explicit, but near the feature that owns the command.

## Done when

- Remote, status, and modal logic can be understood without reading terminal or Browser code.
- The core shell app state only stores feature module state, not every feature map directly.
- Unsupported modal/remote/status commands are visible, intentional, and small.
