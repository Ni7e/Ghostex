# Ghostex CLI Rust Port Plan

## Goal

Port the public `ghostex` / `gx` CLI from `scripts/ghostex-cli.mjs` and `scripts/ghostex-cli-automations.mjs` to Rust in one coordinated cutover.

The new implementation should live in a modular `ghostex-cli/` folder, ship with the existing `gxserver-rs` package, and remove the bundled Node CLI requirement for app and remote installs.

`gxserver` remains the daemon/headless entrypoint. `ghostex` and `gx` remain the user-facing product entrypoints.

## Non-Goals

- Do not do an incremental public-command migration where some user commands call Node and others call Rust.
- Do not keep a Node fallback for commands that should be owned by the Rust CLI.
- Do not merge all public CLI code into `gxserver-rs/src/cli.rs`; that file should stay focused on the daemon command surface.
- Do not change the public command contract unless the current behavior is clearly wrong and the change is explicitly called out.

## Target Shape

Create a new top-level Rust crate:

```text
ghostex-cli/
  Cargo.toml
  src/
    main.rs
    lib.rs
    command.rs
    args.rs
    output.rs
    env.rs
    paths.rs
    rpc/
      mod.rs
      client.rs
      target.rs
      remote_profiles.rs
      ssh_tunnel.rs
      credentials.rs
    commands/
      mod.rs
      sessions.rs
      workspace.rs
      input.rs
      lifecycle.rs
      automations.rs
      browser.rs
      browser_mcp.rs
      skills.rs
      tools.rs
      prompt_editor.rs
      evidence.rs
      android_check.rs
      help.rs
    selectors/
      mod.rs
      aliases.rs
      resolver.rs
      picker.rs
    tools/
      mod.rs
      launch.rs
      tui.rs
      tui2.rs
      zehn.rs
      history.rs
      beads.rs
    support/
      mod.rs
      logs.rs
      bundle.rs
      screenshot.rs
```

Update the Rust workspace/package flow so app and remote packages ship:

```text
bin/gxserver
bin/ghostex
bin/gx
```

`bin/gx` can be a symlink/hardlink/copy to `bin/ghostex`, depending on what each package format supports.

## Shared Code Boundary

Move shared daemon client concerns out of the Node CLI and into Rust modules that can be reused by `ghostex-cli` and, where appropriate, `gxserver-rs` tests:

- protocol constants and envelope helpers
- auth token path reading
- local daemon target resolution
- remote profile parsing from `~/.ghostex/clients/connections.json`
- direct/Tailscale target handling
- SSH gxserver status/start/forward/tunnel setup
- RPC request/response errors
- global session ref parsing
- project/session selector normalization

Prefer a shared internal crate or shared module dependency over copy-pasting between `ghostex-cli` and `gxserver-rs`.

## Command Parity Scope

The one-shot port must cover every command currently advertised by `ghostex --help`:

- bare `ghostex` / `gx`
- path open behavior
- `sessions`, `s`, `list-sessions`, `ls`
- `find`, `f`
- `history`, `h`
- `android-check`
- `attach`, `a`, `resume`, `r`
- `kill`, `k`, `sleep`, `wake`
- `focus`
- `floating-editor`, `fe`
- `floating-monaco-editor`, `fme`
- `prompt-editor`
- `state`, `dump-state`
- `open`, `o`
- `edit`, `e`
- `terminal`, `t`
- `create-session`
- `create-agent`
- `run-agent`
- `run-command`
- `click-button`
- `save-agent`
- `focus-session`
- `acknowledge-session-attention`, `ack-session-attention`
- `focus-group`
- `switch-project`
- `move-project`
- `add-project`
- `remove-project`
- `close-session`
- `restart-session`
- `fork-session`
- `reload-session`
- `rename-session`
- `sleep-session`
- `favorite-session`
- `pin-session`
- `send-text`
- `send-enter`
- `send-key`
- `send-message`, `message`, `msg`
- `read-text`, `read-messages`, `read-thread`
- `rename-command`
- `set-visible-count`
- `set-view-mode`
- `open-browser`
- `open-browser-pane`
- `browser`, `browser-devtools-mcp`, `browser-mcp`
- `bd`, `beads`
- `server`
- all install-skill helper commands
- `computer-use`
- `agent-orchestration`
- `generate-title`
- `manage-beads`
- `move-codex-session`
- `toggle-sidebar`
- `move-sidebar`
- `assert-card`
- `wait-for`
- `screenshot`
- `logs`
- `bundle`
- all automation commands from `scripts/ghostex-cli-automations.mjs`
- `help`, `-h`, `--help`

The Rust help output should be intentionally generated from the same command registry used by dispatch so command coverage cannot drift.

## One-Shot Work Plan

### 1. Freeze the Contract

- Snapshot `ghostex --help`, `gx server --help`, `gx browser --help`, and all skill-specific help output.
- Inventory every command alias, parser, flag, positional argument, JSON output shape, exit-code behavior, and side effect.
- Capture sample fixtures for successful and failing commands against a controlled gxserver instance.
- Mark commands that require macOS renderer state, browser CEF state, or installed app resources.

### 2. Build the Rust CLI Skeleton

- Create `ghostex-cli/Cargo.toml`.
- Add a `ghostex-cli` workspace member to the root/build flow.
- Implement the command registry, alias dispatch, global help, subcommand help, and JSON error formatting.
- Implement shared `--json`, `--timeout`, `--server`, `--token-stdin`, and `--token` handling.
- Preserve the current direct-entry behavior:
  - no args launches the TUI in an interactive terminal
  - no args in a non-interactive terminal prints/picks sessions as current behavior requires
  - unknown existing filesystem paths route to `open`
  - unknown non-path commands fail clearly

### 3. Port RPC and Remote Targeting

- Port local auth token reads from `~/.ghostex/gxserver/auth/token`.
- Port authenticated gxserver RPC requests and protocol mismatch handling.
- Port global ref routing: `S...:P...:G...` should target the owning server profile when local health does not match.
- Port profile loading from `~/.ghostex/clients/connections.json`.
- Port direct/Tailscale profile token reads through OS credential stores.
- Port SSH profile behavior:
  - run remote `gxserver status --json`
  - start remote gxserver when stopped
  - choose a safe local forward port
  - establish `ssh -N -L`
  - verify health through the tunnel
  - tear down CLI-owned tunnels after the command burst

### 4. Port Session and Workspace Commands

- Port `sessions` inventory formatting, grouping, aliases, and JSON mode.
- Port selector cache behavior and exact/substring title matching.
- Port `attach` picker and attach execution.
- Port session lifecycle commands: sleep, wake, kill, close, restart, fork, reload.
- Port workspace/project commands and renderer-command dispatch payloads.
- Port input commands: send text, enter, keys, messages, read text, rename.

### 5. Port Tool Launchers

- Port deterministic resource lookup for bundled tools:
  - `gxserver`
  - `ghostex-tui`
  - `ghostex-tui2`
  - `zehn`
  - `ghostex-history`
  - `bd`
- Preserve local development behavior where source checkouts prefer Cargo/Zig run paths when appropriate.
- Preserve installed app behavior where helper binaries are resolved from app resources, not user `PATH`.
- Preserve Accept All argument injection for `find` and `history`.

### 6. Port Browser, Prompt Editor, and Skills

- Port `browser` namespace help and dispatch.
- Port the browser MCP stdio server and CDP client behavior.
- Port prompt editor selection:
  - Monaco only when the zmx/client capability allows it
  - terminal-native editor otherwise
  - preserve environment-derived originating session logic
- Port skill install commands through `gxserver agent-skills install`.
- Keep bundled skill source resolution package-owned and deterministic.

### 7. Port Evidence and Support Commands

- Port `logs` with existing filtering behavior.
- Port `bundle` support collection.
- Port `screenshot`.
- Port `assert-card` and `wait-for`.
- Ensure output never adds persistent logging of user content, paths, command text, tokens, or raw terminal output.

### 8. Packaging Cutover

- Update macOS app packaging to build and stage `ghostex-cli` into `Contents/Resources/CLI`.
- Replace `scripts/ghostex-cli-launcher.sh` with launchers that exec the Rust `ghostex` binary, or symlink directly to it if signing/install flows allow that.
- Update Homebrew/DMG install paths so `ghostex` and `gx` point to the Rust CLI.
- Update remote Linux package builder to copy `bin/ghostex` and `bin/gx` instead of `CLI/ghostex-cli.mjs` and bundled Linux Node for CLI use.
- Keep Node only where another packaged subsystem still independently requires it.
- Update package validation to require Rust `ghostex`/`gx` binaries and reject stale Node CLI-only packages.

### 9. Remove Node CLI Runtime Dependency

- Delete `scripts/ghostex-cli.mjs` and `scripts/ghostex-cli-automations.mjs` only after parity tests pass.
- Remove package-copy code for `CLI/ghostex-cli.mjs`.
- Remove `ws` package staging if it is only used by the old CLI.
- Remove CLI-specific bundled Node requirements from remote gxserver packages.
- Leave a clear release note and migration note: public commands are unchanged, implementation is now native Rust.

### 10. Verification Gate

Run the full gate before deleting Node CLI code:

- `cargo fmt` for `ghostex-cli` and `gxserver-rs`
- `cargo test` for `ghostex-cli`
- `cargo test --manifest-path gxserver-rs/Cargo.toml`
- CLI parity fixture runner against the old Node CLI and new Rust CLI before removal
- app package build
- remote Linux package build for x64 and arm64
- package validation for macOS and Linux resources
- manual command smoke test:
  - `ghostex --help`
  - `gx --help`
  - `gx server status --json`
  - `gx sessions --json`
  - `gx attach --help`
  - `gx browser --help`
  - `gx browser mcp`
  - `gx bd --version`
  - `gx find --help`
  - `gx history --help`
  - representative renderer command
  - representative SSH profile command

## Recommended Module Responsibilities

### `command`

Owns the command registry, aliases, dispatch, and help generation.

It should be data-driven enough that aliases, help, and dispatch cannot drift.

### `args`

Owns argument parsing and compatibility quirks from the Node CLI.

Avoid introducing a parser that changes permissive flag behavior unless fixtures prove the change is acceptable.

### `rpc`

Owns daemon communication.

This layer should not know about terminal pickers, help text, or product workflows. It should expose typed helpers for:

- local target
- remote target
- health
- RPC POST
- session target resolution
- renderer command dispatch

### `selectors`

Owns user-facing target resolution:

- numeric aliases
- raw session ids
- global refs
- provider session names
- exact titles
- project-title selectors
- substring matches

This should be isolated because selector behavior is easy to break and used by many commands.

### `tools`

Owns finding and launching package-owned binaries.

No command module should independently search for `bd`, `zehn`, `ghostex-tui`, `ghostex-history`, or `gxserver`.

### `commands`

Owns product workflows. Each command module should mostly parse command-specific args, call `rpc`/`selectors`/`tools`, and format output.

### `support`

Owns user-facing evidence collection without leaking private data into persistent logs.

## Risk Areas

- Browser MCP parity is the largest behavioral port because it combines stdio JSON-RPC, CDP, DOM snapshots, screenshots, and stateful page selection.
- SSH profile behavior has many timing and cleanup edge cases.
- TUI launch behavior depends on exact environment and resource resolution.
- Prompt editor routing depends on zmx client capability and must not accidentally launch macOS-only Monaco from remote/mobile/TUI attaches.
- JSON output and exit codes are automation contracts for Android, agents, and scripts.
- Packaging must not accidentally ship macOS binaries inside Linux remote packages.

## Cutover Criteria

The Node CLI can be removed only when:

- every advertised command is implemented in Rust
- help output is intentionally equivalent
- JSON output fixtures match or have approved changes
- Android SSH commands still return the expected exit status and JSON shape
- remote SSH profile commands work without Node
- browser MCP starts and can list/select/navigate/snapshot/click/fill/screenshot a CEF page
- `gx` with no args launches the bundled TUI from an installed app and from a source checkout
- app and remote packages include `ghostex` and `gx` Rust binaries
- support-bundle logging rules are preserved

## Final Desired State

- `gxserver-rs` remains the daemon implementation and package owner.
- `ghostex-cli/` owns the public CLI implementation.
- `ghostex` and `gx` are native Rust binaries.
- `gxserver` is still directly available for server/headless use.
- App and remote packages no longer need Node for the public CLI.
- The public CLI command surface remains unchanged for users, agents, Android, and scripts.
