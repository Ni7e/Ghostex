---
name: ghostex-agent-orchestration
description: >-
  Use this skill when coordinating work across Ghostex panes or agent sessions
  through the Ghostex CLI: creating terminal or agent panes, listing sessions,
  checking agent status, sending messages to other agent sessions, reading the
  last lines from another session, focusing/sleeping/waking/killing sessions,
  or using Ghostex commands instead of raw zmx/tmux control.
---

# ghostex-agent-orchestration

Use this skill when a task needs Ghostex session coordination from the CLI.
Before choosing commands, run or read:

```bash
ghostex --help
```

Treat that help output as the source of truth for current command names,
selectors, flags, and aliases.

## Core Loop

1. Inspect the workspace and available sessions:

   ```bash
   ghostex sessions --json
   ghostex state
   ```

2. Pick stable selectors. Prefer session ids from JSON output. Titles and
   `project:title` selectors are acceptable for human-scale use, but exact ids
   are safer for automation.
3. Act through Ghostex CLI commands.
4. Verify with `ghostex sessions --json`, `ghostex read-text`, `ghostex wait-for`,
   or `ghostex assert-card`.

## Create Panes And Agents

- Create a terminal pane:

  ```bash
  ghostex create-session "Build watcher" --project-id <projectId> --group-id <groupId> --input "npm run dev"
  ```

- Create a configured agent pane:

  ```bash
  ghostex create-agent <agentId> --group-id <groupId>
  ```

- Create or reuse a visible configured agent session and send it a prompt:

  ```bash
  ghostex send-message <agentId> "Please investigate the failing test and report findings."
  ```

When project or group matters, pass explicit `--project-id` or `--group-id`
instead of relying on whichever project is currently focused in the UI.

## Message Other Agent Sessions

- Send a complete message and Enter:

  ```bash
  ghostex send-message <selector> "Status check: please summarize what you are doing and any blockers."
  ```

- Type without Enter, then send Enter separately:

  ```bash
  ghostex send-text <selector> "Please run the focused test."
  ghostex send-enter <selector>
  ```

- Press Enter in another session without typing new text:

  ```bash
  ghostex send-enter <selector>
  ```

- Send control keys:

  ```bash
  ghostex send-key <selector> ctrl-c
  ```

Use concise messages with the exact request, expected output, and whether the
other agent should keep working or stop after reporting back.

## Check Status And Read Output

- List sessions and statuses:

  ```bash
  ghostex sessions --json
  ```

- Read the last N lines from another session. Ghostex uses zmx under the hood
  for this, but agents should call the exposed Ghostex command:

  ```bash
  ghostex read-text <selector> --lines 80 --json
  ```

- Read only currently visible text when that matters:

  ```bash
  ghostex read-text <selector> --visible --json
  ```

- Wait for a sidebar card projection or assert its state:

  ```bash
  ghostex wait-for <selector> --timeout-ms 30000
  ghostex assert-card <selector> --visible true
  ```

## Manage Sessions

Use Ghostex commands for lifecycle and focus:

```bash
ghostex focus <selector> --json
ghostex sleep <selector> --json
ghostex wake <selector> --json
ghostex kill <selector> --json
```

Selectors can be an alias, session id, title, or `project:title`. Numeric
aliases come from the last `ghostex sessions` or `gx sessions` list.

## Boundaries

- Do not drive Ghostex panes through raw zmx/tmux commands when a Ghostex CLI
  command exists.
- Use `$ghostex-browser-use` for embedded CEF browser panes.
- Use `$ghostex-computer-use` for native macOS apps outside Ghostex.
