# Chat Lab

Run `bun run chat:lab` from the repository root on macOS. It builds the current native chat and opens **Ghostex Chat Lab**, a separate GPUI app. Open [the React reference and shared controls](http://127.0.0.1:5188) beside it at the same window width.

The two windows use the actual `NativeChatView` and `SessionChatView`, with the same sample fixture and simulated transport in `packages/shared/session-chat-preview/`. They do not start an agent. Each composer has independent sample state so you can repeat the same interaction in each renderer.

The React page controls both windows:

- Choose conversation, working, compaction, question, queue, or empty.
- Compare dark/light themes, 70–200% zoom, verbose mode, and simple mode.
- **Reset both** restores the fixture and clears the two sample composers.
- Type and send, stop the working indicator, answer the question, or edit the sample queue.
- Scroll up and down, expand tool calls, and resize both windows to compare wrapping and layout.

Changes to scenarios/settings reset the sample conversation. Native code updates require quitting **Ghostex Chat Lab** and running `bun run chat:lab` again; React source changes reload through Vite. The launcher does not restart your regular Ghostex app. The native preview renders with GPUI and runs the shared controller in QuickJS. The React reference runs in your browser.

The sample transport intentionally does not provide real terminal actions, account changes, remote sessions, or uploads. Those app integrations are not exercised by this preview. Use a real session for those integration checks.

The preview app is installed at `~/Applications/Ghostex Chat Lab.app`. Its control state and native data live under `~/.local/share/ghostex/chat-preview/`; browser data uses the isolated `127.0.0.1:5188` origin. Vite logs are in `vite.log` in that directory. The native app can remain open while you work in the regular desktop app.
