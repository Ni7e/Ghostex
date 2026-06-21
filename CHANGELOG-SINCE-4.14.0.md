# Changelog Since 4.14.0

Included versions: 4.14.2, 4.20.0, 4.20.1, 4.21.0, 4.21.1, 4.21.3, and 4.21.4.

## Major

- The command palette has more app commands, including previous sessions, pinned prompts, running sessions, Scratch Pad, Agents Hub, Actions, Open Targets, Hotkeys, setup, changelog, quick terminal, quick browser tab, Automations, and project actions.
- Session search is more focused. It now ranks visible session titles and previous sessions better, with fewer unrelated matches from hidden metadata.
- First-launch setup is simpler. It now focuses on Welcome, Agent Hooks, and Bundled Agent Skills.
- Tips and help entry points are clearer, including a Ghostty tutorial video and easier access to Docs, Features, Setup, and Changelog.
- Agent hook setup is easier to recover from. Settings can now uninstall Ghostex-owned hooks and bundled skills without touching user-managed setup.
- Settings is more reliable. Native Settings windows open more consistently, and fields, dropdowns, and color pickers keep focus while changes save.
- Settings > Integrations now keeps hook and skill install, update, and uninstall actions together.
- Global app actions moved into the far-right titlebar Settings menu, making the sidebar simpler.
- Browser panes handle appearance better. They support System, Light, and Dark behavior more consistently and open requested URLs more reliably.
- Browser pages now avoid unexpected dark or transparent backgrounds in more cases.
- Sidebar search, session drag-and-drop, section actions, right-click menus, and scrolling are easier to use.
- Project Board labels load faster, cards are easier to read, and first open now shows a loading overlay.
- Sleeping terminal splits now stay in place as wake placeholders instead of collapsing the layout.
- Focused-session actions such as Sleep, Wake, Close, and Close After Done are available from the command palette and Hotkeys.
- `ghostex create-agent` now starts the agent process after creating the session.
- Fresh agent panes are less likely to resume the wrong raw Ghostex session ID.
- Resources can show running terminal sessions even when their pane is not loaded.
- The experimental Rust gxserver path now covers more agent, hook, skill, log, session, and project operations.
- Source panes wait for code-server readiness before opening, and Source setting changes restart code-server less aggressively.
- Manage now has a beta project workarea for browsing files, previewing files, editing Markdown and text files, adding review notes, and drawing Excalidraw files.

## Minor

- The app bundle now includes the latest Highlighted Features screenshots.
- README images, download text, previous-session docs, and feature-gallery text were refreshed.
- Custom titlebar Actions are preserved better during startup.
- Old saved Action icon colors are cleaned up so titlebar icons match native chrome.
- Focused pane borders, pane tabs, and sidebar toggle chrome are cleaner.
- Selected sleeping tabs keep the active-tab look before wake.
- First-launch setup buttons are disabled when there is no setup action to run.
- Open Folder now opens the selected workspace folder itself in Finder.
- Delayed Send focuses the minutes field more reliably, and Enter schedules the timer from duration fields.
- Monaco prompt edits are preserved better if the native bridge closes before the normal save callback.
- Projects settings include a project removal control.
- Settings Actions editors can delete custom actions and default actions.
- Empty sidebars guide first-time users toward the Projects plus button.
- Highlighted Features navigation stops at the first and last item instead of wrapping.
- Browser panes use a light page canvas for transparent public pages.
- Option+Shift+S sleeps the focused terminal by default.
- Focused-session actions target command-pane terminals correctly.
- The Git commit review sidebar is quieter and easier to scan.
- Status menu right-click and Control-click actions work again from the macOS menu bar.
- Agent prompts send in smaller chunks so Cursor is less likely to turn them into paste chips.
- Titlebar Resources and update icons have cleaner alignment.
- Project Board title-generation diagnostics are safer.
- Debug and scroll diagnostics are cleaner while keeping private data redacted.
