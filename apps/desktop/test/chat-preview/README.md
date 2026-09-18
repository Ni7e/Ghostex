# Chat Lab

Run `bun run chat:lab` from the repository root on macOS. It builds and opens **Ghostex Chat Lab**, a separate app with **GPUI chat on the left and React chat on the right** in equal-width panes. Your regular Ghostex app keeps its selected renderer and is not restarted.

The panes use the actual `NativeChatView` and `SessionChatView`, with the same sample fixture and simulated transport in `packages/shared/session-chat-preview/`. Both panes have identical whole-pixel widths; the divider takes the remaining pixel so native-frame rounding cannot change one pane's wrapping. They do not start an agent. Each composer has independent sample state so you can repeat the same interaction in each renderer.

The shared controls above both panes let you:

- Choose conversation, Markdown, working, compaction, question, approval, async questions, queue, or empty.
- Compare dark/light themes, 70–200% zoom, verbose mode, and simple mode.
- **Reset both** to restore the selected fixture and clear both sample composers.
- Type and send, stop the working indicator, answer the question, or edit the sample queue.
- Scroll independently, expand tool calls, and resize the window to compare wrapping and layout.
- Use **markdown** to compare inline-code chips, long identifiers, Unicode, explicit line breaks, and copying selections across styled text.
- Use **update** for the compact and expanded Codex update-choice card. **update-error** simulates a stale dialog when you choose Update now; Skip for now still succeeds. Neither sample installs anything.
- Use **links** to inspect file-opening requests, including relative paths, spaces, and line/column coordinates. The lab displays the requested target instead of opening a real project file.

Scenario and setting changes reset both conversations. Native code updates require quitting **Ghostex Chat Lab** and running `bun run chat:lab` again; React source changes reload through Vite. Use `bun run chat:lab --no-build` to launch an already built native binary.

Native chat renders with GPUI and runs its shared controller in QuickJS. Only the visible React reference pane uses CEF. The [standalone React reference](http://127.0.0.1:5188) remains available in a browser with the same controls.

Keep Chat Lab visible while comparing live changes. macOS suspends GPUI display frames when the window is fully covered; a background screenshot can then show an older native frame while the React pane has already updated. Bring the window into view before judging that comparison.

The sample transport does not provide real terminal actions, account changes, remote sessions, or uploads. Those integrations need a real session. This is a comparison tool, not a claim that all rendering and interaction differences have been resolved. Remaining differences include fractional-zoom wrapping, the transcript fade and composer overlay behavior, code blocks, and some composer actions.

The Markdown sample has been checked in Tart with real pointer selection and Cmd+C, including a drag starting just outside the text and copying across an explicit line break. Its shared inline-code sizing and 100% wrapping were compared in light and dark themes. Both transcripts were scrolled to the top and back at 1280×600, including composer collapse and expansion. Enter in the native async answer field submitted one answer and left the next question pending. These checks cover these fixtures, not every Markdown construct or real-session integration.

Status-card corners were checked in Tart in light and dark themes with the compaction and approval fixtures. Native panels now paint within the rounded shell instead of leaking square fills at its corners. The checks include cards with and without an action footer. Compaction progress color, tabular numeric sizing, elapsed color, and percentage weight were also compared after correction.

Final replies now place their native actions in the marker gutter, without adding footer height. React and GPUI use shared action-content rules, icon paths, and transcript end padding. The conversation fixture was compared at 100% in dark and light themes after correcting the extra footer and composer lead spacing. Native Copy was exercised by clicking, Enter, and Space; the guest clipboard preserved the complete reply and its Markdown formatting. Saving replies to Markdown is not yet implemented natively. Full keyboard-focus styling and hover transitions still need broader parity verification.

The update fixture was exercised in Tart at 100%: compact light/dark cards and the expanded light card were compared, including the failed-choice error inside the card and the blocked-composer prompt. Skip for now produces the same simulated reply in both renderers. Native file clicks for `src/chat.ts:42:8`, `/sample/My%20Project/chat.ts:9`, and `file:///sample/project/chat.ts:12` produced the same decoded `openFile` requests as React without invoking the macOS URL opener. File-reference artwork, colors, labels, and coordinates now come from shared presentation data. A real pointer click on the relative file reached the native host handler; dragging across the space-path label kept the previous request unchanged, and Cmd+C copied `File with spaces:9`. These checks verify the chat-to-host request, not a real Code/Docs destination or remote editor. Web links now share their icon, colors, and spacing as well; the light-theme sample was compared and a native pointer click produced the expected openLink request. Reference hover styling, multi-line web links, and broader Markdown reference cases remain unfinished.

The native scroll-to-bottom button now uses shared appearance data and the existing configured shortcut. In Tart, scrolling up revealed the button; clicking it returned to the last reply, hid the button, and expanded the composer. Keyboard activation and live-stream follow behavior still need verification.

The app is installed at `~/Applications/Ghostex Chat Lab.app`. Control state and logs live under `~/.local/share/ghostex/chat-preview/`. Each app process has its own native/CEF cache beneath `native-data/`; those disposable caches can be removed after quitting Chat Lab. Vite logs are in `vite.log`. The latest app's CEF inspector port is recorded in `inspector-port` (19588 when available), allowing an isolated `ghostex browser mcp --port PORT` connection.

GPUI's static DM Sans faces are generated from the bundled variable fonts by `tooling/chat-fonts.py` using Python's `fonttools` package. The generated fonts are checked in, so launching Chat Lab does not require Python font tooling.

For isolated testing in Tart, use `bun run chat:lab --package-only` to build the app without opening it on the host. The current VM comparison app lives at `/Users/admin/chat-parity-20260917/Ghostex Chat Lab.app` in `macos-sandbox`. Its state and caches are beside that bundle, separate from the guest's normal Ghostex installation. The guest serves a production React reference at port 5188, so both native and React changes require copying a fresh build into the guest. The comparison controls in the native window update both panes.
