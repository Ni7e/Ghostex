### Project Overview

Ghostex is a native macOS workarea for running, organizing, and resuming agent CLI sessions. It is built around low-overhead Ghostty terminals, a project-aware sidebar, embedded browser and code panes, and companion mobile apps for connecting to live sessions remotely.

The project is positioned as a free and open source alternative to Codex App for developers who work with multiple agent CLIs across multiple repositories. It focuses on keeping terminal sessions stable, persistent, easy to scan, and easy to reopen after the app or machine restarts.

#### What Ghostex Does

- Runs popular agent CLIs such as Codex, Claude Code, OpenCode, Gemini, Copilot, Cursor CLI, Amp CLI, and others in native Ghostty-backed terminal panes.
- Groups sessions by project so related agents, browsers, editor panes, actions, and history stay together.
- Preserves and restores terminal sessions through providers such as zmx, tmux, and zellij.
- Provides a rich prompt editor for agent CLIs, including image insert and preview support.
- Embeds Chromium browser panes with navigation, profiles, DevTools, and project-scoped browser sessions.
- Embeds lightweight VS Code/code-server panes for markdown, code review, git, and PR workflows.
- Shows session status through the sidebar, menu bar indicators, notification sounds, and an optional floating pet/status overlay.
- Exposes `ghostex` and `gx` CLI commands for listing, attaching, sleeping, waking, focusing, and managing sessions from a shell.
- Supports Android and iOS companion apps for live remote control of sessions running on the Mac.

### Main Product Areas

#### Native macOS Host

The macOS app shell owns the native window, title bar, pane layout, Ghostty terminal hosting, browser/editor hosting, menu bar integration, notifications, and Sparkle updates.

#### Sidebar and Workspace UI

The sidebar is a React/TypeScript interface for project groups, session cards, commands, settings, recent projects, previous sessions, project actions, worktrees, and project-board views. It is designed around quickly scanning many live agent sessions and switching between them.

### Terminal Sessions

Ghostex treats terminal sessions as durable work units. Sessions can be named automatically, slept to save memory, restored into the current layout, attached from the CLI, and backed by persistence providers so long-running agent work can survive restarts.

### Browser and Code Panes

Browser panes provide a Chromium-based workspace browser with profiles, DevTools, and persistent storage. Code panes provide a lightweight VS Code-style editor surface for repository work, markdown, diffs, git, and PR review without requiring the full IDE to be the main workspace.

### Mobile Companions

The Android and iOS apps connect to a Mac running Ghostex so users can attach to live sessions, create sessions, run actions, upload files, and inspect remote session state from a phone.

### CLI and Automation

The `ghostex` and `gx` commands expose session management outside the UI. They are used for attaching to sessions, sending or reading messages, waking or sleeping terminals, and integrating Ghostex into shell-based workflows.

## Repository Shape

- `native/` contains native host, sidebar, and platform-specific app code.
- `src/` contains shared frontend assets and supporting TypeScript code.
- `components/` and `lib/` contain reusable UI and utility code.
- `scripts/` contains development, release, build, CLI, and verification scripts.
- `docs/` contains handover notes, architecture notes, platform requirements, and implementation references.
- `crossplatform/` contains companion cross-platform/mobile-related code and supporting package metadata.
- `media/` contains app media such as icons and notification sounds.

## Development Entry Points

Common commands are defined in `package.json`:

- `bun run start` starts the native Ghostex host.
- `bun run build` builds the macOS host.
- `bun run typecheck` runs TypeScript checking.
- `bun run test` runs the Vitest suite.
- `bun run storybook` starts Storybook for sidebar/UI work.

## Project Goal

Ghostex aims to make agent-driven development feel like a stable local workspace instead of a collection of fragile terminal tabs. The core idea is that every agent session should be project-aware, resumable, inspectable, and reachable from the desktop app, shell, browser/editor panes, and mobile companions.
