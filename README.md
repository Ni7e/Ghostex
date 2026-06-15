> 2026-06-13 Notice: App is locked to new feature work for a bit. Current focus is fully on bug fixes, performance, polish, refactoring.

<p align="center">
  <img width="1200" height="630" alt="og" src="https://github.com/user-attachments/assets/8b0417ff-a320-43a2-a7e2-1a6c24f86c5c" />
</p>

<p align="center">
  <a href="https://github.com/maddada/Ghostex/releases"><img alt="GitHub Releases" src="https://img.shields.io/badge/Releases-DMGs%20%26%20APK-111827?logo=github&logoColor=white"></a>
  <a href="https://discord.gg/df7b3G92CS"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?logo=discord&logoColor=white"></a>
  <a href="https://ghostex.dev"><img alt="Website" src="https://img.shields.io/badge/Website-ghostex.dev-0EA5E9"></a>
</p>

# Ghostex

macOS Native Ghostty-based desktop app (Not using Electron or Tauri!) for running agent CLIs with persistent terminals, GUI panes, browser panes, notifications, mobile access, and a lightweight code editor.

Ghostex is built for developers who keep multiple agents and terminals alive at once. It combines low-RAM Ghostty terminals, native Swift UI, T3code GUI panes, Chromium CEF browser panes, and Android/iOS session access in one workspace.

> Looking for contributors. Join the Discord if you want to help: https://discord.gg/df7b3G92CS

## Install

### macOS

The Homebrew cask installs the correct Apple Silicon or Intel Mac build automatically.

```bash
brew trust maddada/tap && brew install --cask maddada/tap/ghostex --force
```

You can also download the latest DMG from GitHub Releases.

> Windows and Linux ports need contributors.

### Android and iOS

Use the mobile apps to connect live to your Ghostex agent CLI sessions. APKs are in Releases. Join discord for iOS app.

#### Click the button to get the app:

[![Download Android APK](https://img.shields.io/badge/Android-APK-3DDC84?logo=android&logoColor=white)](https://github.com/maddada/Ghostex/releases/download/v4.1.0/ghostex-android.apk) [![iPhone App Discord](https://img.shields.io/badge/iPhone-Test%20Flight-000000?logo=apple&logoColor=white)](https://discord.gg/df7b3G92CS)

<p>
  <img width="250" alt="Ghostex Android companion app" src="https://github.com/user-attachments/assets/e7af9c54-e8ef-4e0b-a934-8b2f9ea56c70" />
  <img width="250" alt="Ghostex iPhone companion app" src="https://github.com/user-attachments/assets/563dbb8a-5a9d-4db7-8946-1dfc383e09c8" />
</p>

## Gallery

### Architecture (client apps <-> gxserver daemon (local/remote machine) <-> zmx for persistence

<img width="3326" height="1514" alt="2026-06-12_Google Chrome_23-43-07@2x" src="https://github.com/user-attachments/assets/ecc84149-a9fc-4ec8-a387-af5ce35aa7be" />

### T3code GUI panes and supported terminal CLIs

<img width="3322" height="2060" alt="Ghostex T3code panes and supported terminal CLIs" src="https://github.com/user-attachments/assets/49862e2d-1edd-4647-8161-5afb25ed8341" />

### Rich prompt editor

Two prompt editor modes are included: Monaco-based and TUI-based.

<img width="2048" height="1270" alt="Ghostex rich prompt editor modes" src="https://github.com/user-attachments/assets/a94c00ea-d373-4d72-acc9-b6a16318b4b3" />

### Agent CLI support

Ghostex works with Claude Code, Codex CLI, OpenCode, Pi Agent, Gemini, Copilot, and other terminal-based agent CLIs.

<img width="1664" height="1035" alt="Ghostex supported agent CLIs" src="https://github.com/user-attachments/assets/932497a7-8b68-480f-ae05-13df08571e47" />

### Embedded Chromium browser with DevTools and profiles.

Chromium-based browser panes include DevTools, profiles, and MCP access.

<img width="1000" alt="Ghostex sidebar with terminal and browser panes" src="media/readme/ghostex-browser-pane.png" />

### Embedded VS Code based editor and Git + PRs manager

The fully featured VS Code-based editor loads on demand for file edits, PR checks, Markdown, and git workflows.

<img width="3327" height="2065" alt="Ghostex embedded code editor" src="https://github.com/user-attachments/assets/f1cc7d00-7098-44fe-bc29-590ae03ea8e9" />

### Notifications and status

Ghostex supports notifications, menu bar indicators, minimal floating counters, and session status at a glance.

<img width="331" height="309" alt="Ghostex notification indicator" src="https://github.com/user-attachments/assets/ad0f7af5-b0e9-4b24-988c-cb6bf02c6c9f" />

## Highlights

| Feature | What it gives you |
| --- | --- |
| Ghostty terminals | Lower RAM use, better battery life, and stable agent CLI sessions. |
| Native macOS shell | Swift UI for performance-sensitive desktop behavior. |
| T3code GUI panes | Graphical panes alongside terminal agents. |
| Chromium CEF browser | Embedded browser panes with DevTools, profiles, and MCP access. |
| Lightweight code editor | VS Code-based editor for Markdown, PR review, files, and git work. |
| Mobile access | Android and iOS apps for checking and controlling live sessions. |
| TUI mode | Use `ghostex` or `gx` to attach from another machine. |


## Comparison

| Feature | Ghostex | Codex app | cmux |
| --- | --- | --- | --- |
| Open source | Yes | - | Yes |
| Ghostty terminal | Yes | - | Yes |
| Built-in Computer use | Yes | Yes | - |
| Built-in Browser use | Yes | Yes | Yes |
| Use any model | Yes | - | Yes |
| Cross Model Orchestration | Yes | - | Yes |
| Rich Prompt Editor | Yes | N/A | - |
| iOS & Android | Yes | Yes | - |
| Pets | Yes | Yes | - |
| Appshots | Soon™ | Yes | - |
| Automations | Soon™ | Yes | - |

## Main Features

- First-launch preferences for common install defaults.
- Git workflows with Sync with Main, split Git menus, prompt-agent PR review, and persistent running toasts.
- First-prompt title generation for auto-naming new agent sessions.
- Pinned sessions and assigning tags to sessions.
- Auto-sleep for unused terminal, browser, and project panes.
- Live Android and iOS access to agent CLI sessions.
- SSH continuation with zmx, tmux, and zellij persistence.
- Rich prompt editor with image insert and preview support.
- Auto session naming for popular agents.
- App restart resumes existing agent CLI sessions.
- Menu bar working/done indicators and notification sounds for most agent CLIs.
- Multi-pane and multi-group project layouts.
- Scheduled messages and automation through the Ghostex CLI.

## Useful Extras

- Continue over SSH, then attach with `ghostex` or `gx`.
- Create worktrees and merge them back easily.
- Find previous threads by keyword and continue with context.
- Sync session titles and status into the UI.
- Run multiple panes and multiple groups per project with split and tab layouts.

## Contributing

Ghostex is moving quickly, and help is welcome on platform ports, missing agent CLI integrations, docs, testing, and feature polish.

Join the Discord: https://discord.gg/df7b3G92CS

## Credits

Ghostex builds on open source work from these projects and communities:

- [CEF Project](https://github.com/chromiumembedded/cef) — embedded Chromium browser panes
- [Agentation](https://github.com/benjitaylor/agentation) — browser annotation and feedback tooling
- [CMUX](https://github.com/manaflow-ai/cmux) — agent hook patterns and notification integration
- [T3 Code](https://github.com/pingdotgg/t3code) — GUI editor panes for coding agents
- [VS Code](https://github.com/microsoft/vscode) and [code-server](https://github.com/coder/code-server) — embedded IDE surfaces
- [zehn](https://github.com/al3rez/zehn) by [al3erz](https://github.com/al3rez) — searching sessions by prompt
- [vvterm](https://github.com/vivy-company/vvterm) — iOS companion app base
- [Termux](https://github.com/termux/termux-app) — Android companion app base
- [Codex on Linux](https://github.com/ilysenko/codex-desktop-linux) — pets implementation
- [Pierre Computer Company](https://github.com/pierrecomputer/pierre) — diffs and file rendering components
- [Beads](https://github.com/steveyegge/beads) by [Steve Yegge](https://github.com/steveyegge) — kanban project board
- [Beads Viewer](https://github.com/Dicklesworthstone/beads_viewer) by [doodlestein](https://github.com/Dicklesworthstone) — kanban view reference
