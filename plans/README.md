# GPUI Parity Implementation Plans

Generated on 2026-06-26 from a read-only macOS-vs-GPUI parity audit. Planned at commit `5d9960dff`; the working tree was dirty when these plans were written, so every executor must run the drift checks in its plan and inspect current uncommitted changes before editing.

## Product Decisions

These decisions apply to every plan:

- GPUI must adhere 100% to the current macOS app behavior. The macOS app is the source of truth for user-facing behavior, persistence, errors, keyboard flows, support diagnostics, launch/session semantics, and edge cases.
- Do not invent fallbacks or downgrade behavior to make GPUI simpler. If macOS has durable behavior, GPUI should implement that behavior.
- It is acceptable to use GPUI-native components instead of AppKit/SwiftUI/WK child-window implementation details when that makes sense for GPUI. For dropdowns and menus, prefer GPUI popovers modeled after the Zed-style menu reference at `/Users/madda/.ghostex/i/260626234311.png`, while preserving macOS behavior.
- Persistent logs must obey the repository logging privacy rules. Never log project names, paths, URLs, queries, page titles, terminal titles, command text, stdout/stderr, tokens, cookies, credentials, environment values, or user text.
- When editing code, add or update concise `CDXC:<Area> yyyy-MM-dd-hh:mm:` comments for important user-facing requirements and technical decisions.
- Do not run `bun run start` or any app restart command unless the operator explicitly asks.

## Execution Order And Status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001 | Establish GPUI parity decision and verification baseline | P1 | M | - | TODO |
| 002 | Match macOS startup, gxserver bootstrap, window restore, and first-run flow | P1 | L | 001 | TODO |
| 003 | Match macOS support-bundle logging and Debugging Mode behavior | P1 | L | 001 | TODO |
| 004 | Match macOS terminal launch, restore, provider attach, and terminalReady handoff | P1 | L | 001, 003 | TODO |
| 005 | Match macOS sidebar session focus, gxserver launch plans, activity, and first-prompt flows | P1 | L | 004 | TODO |
| 006 | Match macOS terminal input, clipboard, drag/drop, and Ghostty settings behavior | P1 | L | 004 | TODO |
| 007 | Match macOS Browser profiles, cookies, import, project seeding, and history behavior | P1 | L | 001, 003 | TODO |
| 008 | Match macOS Source, Kanban, Manage workarea behavior | P2 | L | 005, 007 | TODO |
| 009 | Match macOS settings effects, appearance, and configuration persistence | P2 | M | 002, 006 | TODO |
| 010 | Match macOS command palette, modals, rename, prompt editor, Resources, and titlebar popovers | P2 | L | 005, 009 | TODO |
| 011 | Match macOS app menus, hotkeys, context menus, OS integration, and notifications | P2 | L | 004, 010 | TODO |
| 012 | Match macOS menu-bar and floating status indicators | P2 | M | 005, 011 | TODO |
| 013 | Build the final runtime parity verification suite | P1 | L | 002-012 | TODO |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED (with one-line rationale).

## Dependency Notes

- 001 comes first because every other plan needs the same product rule and verification baseline.
- 003 should land early because the later runtime plans need privacy-safe diagnostics while they are verified.
- 004 must precede session focus/activity plans because real terminal materialization and startup payloads are the foundation.
- 007 can run in parallel with terminal work after 001 and 003.
- 013 should run after implementation plans because it verifies the integrated behavior, not individual source-ledger evidence.

## Shared Verification Commands

Use the narrowest command that covers the files you changed, then run broader checks before handing off:

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| TypeScript typecheck | `bun run typecheck` | exit 0, no TypeScript errors |
| Targeted TS tests | `bun run test -- <test-file-or-pattern>` | exit 0, selected tests pass |
| Full TS tests | `bun run test` | exit 0, all Vitest tests pass |
| GPUI Rust tests | `cargo test --manifest-path gpui/Cargo.toml <filter>` | exit 0, selected tests pass |
| GPUI Rust full tests | `cargo test --manifest-path gpui/Cargo.toml` | exit 0, all GPUI tests pass |
| gxserver Rust tests | `cargo test --manifest-path gxserver-rs/Cargo.toml <filter>` | exit 0, selected tests pass |

Do not run app start/restart commands for manual UI verification unless the operator explicitly asks.

## Findings Considered And Rejected

- "Keep GPUI Browser profiles memory-backed": rejected by product decision. GPUI must match macOS durable CEF profiles/cookies/import.
- "Use NativeMenu for titlebar dropdown parity": rejected by product decision. Use GPUI popovers where GPUI-native UI makes sense, but preserve macOS behavior.
- "Keep Browser active-project identity separate because it is already documented that way": rejected as a product decision. The executor must inspect macOS behavior and make GPUI match it exactly, adjusting contracts as needed.
- "Hide Generate Name for local command tabs": rejected. Implement generated titles like macOS.
- "Skip menu-bar/floating status in GPUI": rejected. Implement GPUI behavior like the macOS app.

