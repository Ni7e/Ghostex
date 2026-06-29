# GPUI State and Simplification Reports

Date: 2026-06-28

This folder captures a static review of the `gpui/` project and splits the findings into independent cleanup tracks that can be worked in parallel.

## Review scope

- Reviewed `gpui/` source, build files, CEF integration, sidebar runtime, terminal runtime, native macOS shims, and existing GPUI architecture notes.
- Did not run the app, start development servers, or build the macOS app.
- Treat the findings as a codebase state picture and simplification plan, not a runtime QA result.

## Reports

1. [Main Rust shell modularization](./01-main-rs-modularization.md)
2. [CEF bridge ownership and helper drift](./02-cef-bridge-ownership-and-helper-drift.md)
3. [Project workarea readiness simplification](./03-project-workarea-readiness-simplification.md)
4. [Browser runtime scope](./04-browser-runtime-scope.md)
5. [Terminal startup and lifecycle simplification](./05-terminal-startup-lifecycle-simplification.md)
6. [Manage and Kanban bridge scope](./06-manage-kanban-bridge-scope.md)
7. [Settings and native service boundaries](./07-settings-native-services-boundaries.md)
8. [Remote, status, and modal scope](./08-remote-status-and-modal-scope.md)

## Parallel work model

These tracks are mostly separable:

- The `main.rs` split can begin with mechanical module extraction while other tracks remove dead or duplicated logic.
- The CEF bridge track should coordinate only with workarea and modal bridge changes.
- Browser cleanup can proceed independently from Source/Kanban/Manage because Browser already uses a separate shell and CEF-surface model.
- Terminal lifecycle cleanup should avoid overlapping with remote attach changes because remote attach feeds terminal launch payloads.
- Settings/native services cleanup can be done feature-by-feature with low impact on Browser or project workareas.

## Common simplification rule

Prefer deleting stale gates and proof layers over adding new fallback behavior. If a surface is real today, make the real ownership path obvious. If a feature is not real today, keep the placeholder/no-op explicit and small.
