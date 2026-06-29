# Report 04: Browser Runtime Scope

## Summary

The Browser workarea is real CEF-backed browsing with GPUI-owned chrome. Some surrounding features are intentionally incomplete or inert: browser readiness, data import, durable profile behavior, blank popup transfer, and restored live page state.

## What is implemented

Browser currently supports:

- GPUI tab strips, split panes, drag/drop, close behavior, and address-only tabs.
- CEF-backed loaded pages keyed by `BrowserTabId`.
- Toolbar actions for back, forward, reload, feedback tool injection, zoom reset, profile menu, history menu, and DevTools.
- Runtime metadata updates from CEF: address, title, favicon URL.
- Popups with non-empty target URLs becoming loaded Browser tabs.
- Sanitized shell persistence for URLs/tab layout.
- Runtime favicon fetching and display.

## Evidence

- `gpui/src/main.rs`
  - `BrowserTabModel`
  - `BrowserRuntimeLifecycleInput`
  - `ensure_browser_surface_for_tab`
  - `browser_surface_for_rendered_leaf`
  - `perform_browser_toolbar_action`
  - `show_browser_profile_menu`
  - `import_browser_data_from_profile_menu`
  - `render_browser_workspace`
- `gpui/src/cef/macos.rs`
  - Browser metadata handlers.
  - Popup handling.
  - Browser host actions.

## What is not hooked up or not real yet

- Browser readiness contract exists but has no accepted `browserWorkareaId` from the active project snapshot.
- Browser readiness events reconcile against `None`, so they are effectively no-op.
- Browser data import is explicitly unsupported.
- Browser profiles exist as shell/profile ids, but durable cookies/history/import behavior is not implemented.
- Restored loaded tabs can render as restored placeholders if no CEF entity exists.
- Empty or whitespace popup targets are no-op, not converted into blank tabs or content-transfer flows.

## Why this looks over-complex

The real Browser runtime is the tab-owned CEF surface map. The separate Browser readiness contract does not appear to drive rendering or CEF creation. Profiles and import UI also imply more durable browser semantics than the runtime currently provides.

## Parallel-safe cleanup target

Make Browser explicitly one of two things:

1. A lightweight embedded browsing workarea with shell-only profiles and no import.
2. A durable browser profile system with real persistence/import requirements.

Until option 2 is required, keep option 1 small.

## Suggested implementation path

1. Remove or isolate `BrowserWorkareaRuntimeState` and Browser readiness parser if no active sender uses it.
2. Keep Browser surface creation owned only by selected loaded tab state.
3. Decide whether the profile menu should stay beta-only shell state or be hidden until durable profile directories are used.
4. Keep browser import as one explicit unsupported action, or remove the menu row.
5. Keep restored placeholders, but document them as shell-state restoration, not live browser session restore.

## Done when

- Browser has one clear runtime source of truth: `browser_surfaces` keyed by loaded tab id.
- No readiness store implies Browser mount authority.
- Profile/import UI does not suggest capabilities that are not implemented.
