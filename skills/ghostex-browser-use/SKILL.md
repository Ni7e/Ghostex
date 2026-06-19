---
name: ghostex-browser-use
description: >-
  Use this skill when adding, configuring, or troubleshooting agent access to
  Ghostex embedded CEF browser panes through the Ghostex Browser Use MCP
  workflow. It covers CLI installation, MCP config, page selection, console
  logs, DOM snapshots, clicks, fills, key presses, screenshots, and the CEF
  remote debugging port used by `ghostex browser mcp`.
---

# ghostex-browser-use

Use this skill when a user wants an agent to see or control the browser pane
inside Ghostex, especially when they ask for Chrome DevTools-style capabilities
such as console logs, page snapshots, clicks, fills, navigation, or screenshots.

## Requirements

- Ghostex must be running before the MCP server can attach to CEF.
- A browser pane does not need to exist yet; create or reuse one with
  `ghostex browser open <url>`.
- The Ghostex CLI is bundled with the macOS app and auto-linked on app startup.
- The browser skill should be installed by the CLI: `ghostex browser install-skill`.

## MCP Server

Configure the agent to launch the MCP server over stdio:

```toml
[mcp_servers.ghostex-browser]
command = "ghostex"
args = ["browser", "mcp"]
```

If the CEF remote debugging port is not one of Ghostex's default ports, pass it
explicitly:

```toml
[mcp_servers.ghostex-browser]
command = "ghostex"
args = ["browser", "mcp", "--port", "9333"]
```

The same value can be provided as `GHOSTEX_CEF_REMOTE_DEBUGGING_PORT`.

## Workflow

1. Open or reuse a pane with `ghostex browser open <url>` when no suitable
   Ghostex browser pane exists yet.
2. List pages with `ghostex_list_pages`.
3. Select the intended pane with `ghostex_select_page` when multiple pages are
   open.
4. Use `ghostex_console_logs` before and after interactions when debugging
   runtime errors.
5. Use `ghostex_snapshot` to get stable element refs, then operate with
   `ghostex_click`, `ghostex_fill`, and `ghostex_press_key`.
6. Use `ghostex_evaluate` for focused inspection and `ghostex_screenshot` when
   visual evidence matters.

## Opening Panes

- Prefer `ghostex browser open <url>` for embedded browser panes. It defaults to
  the agent process cwd as the project path and reuses a same-origin pane in that
  project.
- Pass `--project-path "$PWD"` or `--project-id <id>` when opening a pane from a
  task tied to a specific Ghostex project/worktree.
- Keep the returned browser session id and the MCP page id from
  `ghostex_list_pages`; reuse them for follow-up work instead of opening another
  pane.
- Use `--reuse exact` for exact-URL reuse only, or `--new` when a separate pane
  is intentionally required.

## Notes

- The server connects directly to CEF's Chrome DevTools Protocol endpoint; do
  not add Playwright or a second browser automation runtime for Ghostex panes.
- Element refs from `ghostex_snapshot` are only valid for the current page
  state. Re-run `ghostex_snapshot` after navigation or major DOM changes.
- Console collection starts when the MCP server attaches to a page, so open the
  MCP server before reproducing errors when possible.
