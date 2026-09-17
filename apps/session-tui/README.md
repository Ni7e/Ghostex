# Ghostex session debugger

A TUI with keyboard and mouse controls that works by itself or inside Herdr.

```sh
ghostex-debug
ghostex-debug --offline --direct
```

Spaces appear across the top. Projects and collections contain Browser, Pinned, Drafts, Sessions, Parked and Snoozed sections. The debugger imports Ghostex's actual sorting, space filtering, collection and compact-list logic. GPUI and this TUI share the section projection in `packages/core-ui/sidebar-app/project-session-sections.ts`.

| Key | Action |
| --- | --- |
| Up / Down, j / k | Select a row |
| Enter | Open a session or toggle a heading |
| Left / Right | Collapse / expand |
| Page Up / Page Down | Scroll |
| [ / ], 1..9, w | Change space |
| / | Search visible rows |
| n | Choose a project and agent or shell, then launch |
| z | Switch to the directly discovered zmx list |
| s / t | Open a Herdr split / tab |
| o | Switch activity / manual ordering |
| H | Show hidden projects and collections |
| g | Reload saved GPUI preferences |
| r | Refresh |
| ? / q | Help / quit |
| Ctrl+\ | Detach the attached terminal client |

The list refreshes every five seconds. Standalone attachment returns to the list when detached. In Herdr, Enter opens a terminal split.

Click a session to open it, a heading to collapse or expand it, or a space to switch to it. The mouse wheel scrolls the session list, menus and help. The action buttons along the bottom are clickable, including New, Spaces, Find, Split and Tab. Mouse tracking is disabled when handing the terminal to zmx and restored when you detach back to the list.

## Responsive layout

Spaces wrap onto additional lines when the terminal is narrow; mouse targets and list scrolling follow the wrapped layout. Launched Herdr panes use the session's displayed name.

## Floating debugger in Herdr

Press **F8** to show the debugger as an 85% width and height floating popup. Press **F8**, **Esc**, or click **Hide F8** to hide it. Reopening restores the selected space, row, search, ordering and collapsed sections. Opening a session creates a named terminal pane and closes the popup.

The F8 binding is installed in `~/.config/herdr/config.toml`. In an already running Herdr, apply it with `herdr server reload-config` from a Herdr terminal pane. You can also open the popup directly with `ghostex-debug --herdr-float`.

For another installation, add this to Herdr's config:

```toml
[[keys.command]]
key = "f8"
type = "plugin_action"
command = "ghostex.sessions.floating"
description = "Show Ghostex debugger"
```

Herdr recreates the popup process when reopened; the debugger saves its view before hiding. Session daemons continue running independently.

## Offline recovery

Direct discovery runs the Ghostex-compatible `zmx list` independently of gxserver. Attachment uses `zmx attach --require-existing` with the exact daemon name. A previously cached layout remains available when gxserver disconnects; a first offline launch opens the raw daemon list. Creating or waking sessions requires gxserver.

The debugger finds the bundled zmx automatically and remembers its path and namespace. It rejects upstream binaries lacking Ghostex's wire generation. Override discovery with `--zmx /path/to/zmx --zmx-dir /path/to/sockets`.

## Build and install

From the Ghostex repository root, with Bun installed:

```sh
bun run debug:sessions
bun run debug:sessions:build
mkdir -p ~/.local/bin
ln -s "$PWD/apps/session-tui/dist/ghostex-debug" ~/.local/bin/ghostex-debug
herdr plugin link "$PWD/apps/session-tui"
```

The compiled executable includes the runtime. Start `herdr`, then run this inside a Herdr terminal pane:

```sh
ghostex-debug
```

Herdr also runs the same executable through `herdr-plugin.toml`. To open the browser in a separate split, run `ghostex-debug --herdr-open` inside Herdr. The wrapper supplies the current pane automatically. Herdr split requests take `--target-pane`, while tab requests take `--workspace`; combining both on a split is rejected.

See the [Herdr plugin documentation](https://herdr.dev/docs/plugins/) for plugin installation and actions.

## Scope

This developer tool connects to local gxserver on macOS, Linux or WSL. It reads saved GPUI spaces, hidden items, section collapse and compact-list preferences. It does not mirror a desktop window's transient search, selected tag filters, focus, or app-local browser rows. Remote machine aggregation and native Windows wmx are not implemented.

`--url`, `--token-file`, `--space`, `--state-dir` and `--json` support explicit connection selection and inspection. The usual Ghostex XDG paths and `GHOSTEX_HOME` apply. Catalog caches use private permissions and contain session metadata, never the authentication token. UI changes remain local to the debugger; `g` reloads desktop preferences.
