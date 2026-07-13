# Rust ghostex CLI port — full cutover plan

Goal: port `scripts/ghostex-cli.mjs` (7.5k lines) + `scripts/ghostex-cli-automations.mjs`
fully to Rust inside gxserver-rs, verify parity vs the Node CLI, cut over packaging
(gpui macOS/Linux/Windows apps + remote Linux package), delete the old JS, commit, push.
User cares about: gpui apps (macOS/Linux/Windows), Android, iOS, TUI, CLI.
User does NOT care about the legacy Swift/AppKit macOS app (but don't leave its build script
referencing deleted files — stub out its CLI staging).
Node keeps shipping in packages for now (user decision); only the CLI moves to Rust.

## Architecture

`gxserver-rs/src/ghostex_cli/` module tree, `src/bin/ghostex.rs` = thin entry calling
`ghostex_cli::run()`. New deps: crossterm (picker + Windows), tokio-tungstenite (CDP websocket).

Modules and status:

- [x] foundation: `mod.rs` (COMMANDS dispatch incl. bare-path open + bare `ghostex` → TUI,
      help gating list), `args.rs` (parseArgs/multiValueFlag/all parse* fns),
      `output.rs` (printJson, isFailedCliResult, usage texts), `rpc.rs`
      (callGxserverRpc, target resolution local/profile, tokens, health),
      `ssh_tunnel.rs` (ssh -L tunnels, port scan, idle kill, exit hooks)
- [x] `actions.rs` — sendGxserverCliAction switch, bridgeAction/resolvedSessionBridgeAction,
      dispatchGxserverRendererCommand, withRendererSessionTarget, sendGxserverSessionKey,
      terminalTextForCliKey, sendGxserverRenameCommand, saveGxserverCommand,
      createGxserverQuickTerminal/Session/AgentSession, ensureGxserverProjectForPath (mjs 1605-2060)
- [x] `sessions.rs` — fetchGxserverSessionList, live+persisted sqlite fallback, presentation
      merge, toCliSession, mobile summary (toMobileSessionList/WorkspaceGroups/SessionSummary),
      fetchMobileSidebarHud, attach metadata (mjs 2065-2450, 4598-4644, 5880-6005)
- [x] `selector.rs` — alias cache, sessionSelectorFromArgs, resolveCliSessionSelector,
      resolve{One,}ListedSessions, ranking, formatSessionMatches (mjs 6005-6180)
- [x] `attach.rs` + `picker.rs` — attach command build, zmx attach-or-resume, interactive
      picker (crossterm), session list printing/formatting (mjs 4823-4935, 5482-5570, 6178-6580)
- [x] `wait.rs` — read-text, wait-for-text (tail-window + regex semantics), send-message,
      fork-session, focus smart, sessionActionCommand (kill/sleep/wake) (mjs 5570-5880)
- [x] `launchers.rs` — TUI/TUI2/zehn/history/bd launch resolution (bundled roots, cargo
      fallback), interactive exec (mjs 4885-5390)
- [x] `skills.rs` — install-*-skill commands via agent-skills RPC + source resolution,
      per-skill usage texts (mjs 718-757, 5392-5460, usage fns 7189-7460)
- [x] `editors.rs` — floating-editor, prompt-editor, floating-monaco-editor, editor-daemon
      (unix socket client to GhostexEditor daemon), timeline logs (mjs 3231-4360)
- [x] `browser_mcp.rs` — MCP stdio server, CDP client over websocket, page discovery
      (ports 9223/9334?), snapshot/click/fill scripts, screenshot (mjs 757-1604)
- [x] `automations.rs` — port scripts/ghostex-cli-automations.mjs (98 lines, thin RPC)
- [x] `diagnostics.rs` — logs, screenshot, bundle, android-check (macOS-specific bits cfg-gated)

## Parity testing (before cutover) — DONE (see docs section in commit message)

- Side-by-side harness: run `node scripts/ghostex-cli.mjs <cmd>` vs `target/debug/ghostex <cmd>`,
  diff stdout/exit code. Read-only: sessions/ls (+--json + --mobile-summary), state, dump-state,
  help/usage texts, server status, logs, android-check, read-text, session selectors.
- Mutating commands against isolated daemon (GHOSTEX_GXSERVER_DEV_PORT + temp HOME):
  create-session/terminal/send-text/send-enter/rename/tag/pin/sleep/wake/kill/wait-for-text.
- JSON contract: mobile-summary fields (workspaceGroups/agents/quickActionsByProject/sortOrder)
  must match exactly (Android/iOS depend on it).
- Result: all compared commands byte-identical (JSON) / semantically identical (exec paths).

## Cutover (after parity) — DONE

- [x] package-remote-linux.mjs: build + stage Rust `bin/ghostex`; stop staging CLI/ dir;
      keep node payload; validators updated (release-ghostex.mjs list, build-macos-app.sh)
- [x] setup.rs: replace node-CLI wrapper heredoc with symlink to bin/ghostex; keep gx alias
- [x] gpui build-macos-app.sh: stage Rust ghostex binary instead of CLI mjs + launcher
- [x] gpui build-linux-app.sh / build-windows-app.ps1: stage ghostex(.exe) if they stage CLI
- [x] gpui src/main.rs: any CLI-install paths pointing at ghostex-cli.mjs → Rust binary
- [x] legacy native/macos build-ghostex-host.sh: stub out CLI staging (user doesn't care)
- [x] delete scripts/ghostex-cli.mjs, scripts/ghostex-cli-automations.mjs,
      scripts/ghostex-cli-launcher.sh; update all references (rg for them)
- [x] cargo test + release validator tests + node --check leftovers; commit + push

## Key invariants

- JSON error shape on failure: `{ error: message, ok: false }` printed to stdout with exit 1
  when --json, else message to stderr with exit 1.
- Bare `ghostex` (no args) launches TUI2 (herdr) directly.
- `ghostex <existing path>` behaves like `open`.
- Exit codes: assertOk/failOnNotOk semantics in bridgeAction.
- Mobile summary JSON field-for-field identical.
- wait-for-text: tail-window --lines semantics preserved exactly (see memory pitfalls).
- Windows: no unix-only APIs outside #[cfg(unix)]; interactive exec uses spawn+wait there.
