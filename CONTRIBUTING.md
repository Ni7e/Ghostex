## Contributing

Ghostex is moving quickly, and help is welcome on platform ports, missing agent CLI integrations, docs, testing, and feature polish.

Join the Discord: https://discord.gg/df7b3G92CS

### Web app source

The browser app lives in [maddada/ghostex-web](https://github.com/maddada/ghostex-web),
pinned here as the `apps/web` submodule. Initialize it before running the web commands:

```sh
git submodule update --init -- apps/web
bun install --frozen-lockfile
bun run web:typecheck
bun run web:build
```

Run these commands from the Ghostex root. The web app uses this checkout's shared UI,
contracts, and Bun dependencies. Commit and push web changes inside `apps/web` first,
then commit the updated submodule pointer here.

### Building from source

`bun run start` builds and launches the desktop app; `bun run build` only packages it. Both compile
the desktop crate (`apps/desktop/`, Rust 1.95.0 pinned by its `rust-toolchain.toml`) and the gxserver
crate (`server/`, your default `rustup` toolchain). Besides Bun, Rust, CMake, Ninja, and Zig 0.16, local
Rust builds require **sccache**:

```sh
brew install sccache
```

Windows builds also compile the native Code editor. Initialize
`.dependencies/code-server` and its nested VS Code submodule, and install the
Node version pinned in `.dependencies/code-server/.node-version`, Python 3,
Git for Windows with Git LFS, jq, and Visual Studio C++ Build Tools with a Windows
SDK and the matching x64/x86 or ARM64 Spectre libraries. Keep these tools on the build
shell's PATH; `PYTHON` and `npm_config_msvs_version` can select a specific Python
executable and Visual Studio installation. The Windows build invokes
`apps/desktop/scripts/build-windows-code-server.ps1` and reuses its output when
the editor sources and toolchain have not changed.

Both crates set `rustc-wrapper = "sccache"` in their `.cargo/config.toml`, so every `cargo` invocation
run from inside `apps/desktop/` or `server/` (the build scripts, `bun run release:preflight --cargo`,
rust-analyzer, your shell) compiles each dependency crate once and replays it from the local disk cache
afterwards, including after `cargo clean`. If sccache is missing, cargo fails with
`could not execute process 'sccache'` instead of silently building without it.

Cache location and size come from the user-level sccache config, because the sccache server is a
daemon that reads its configuration once at startup. Create
`~/Library/Application Support/Mozilla.sccache/config` (Linux: `~/.config/sccache/config`) with:

```toml
[cache.disk]
dir = "/Users/<you>/Library/Caches/Mozilla.sccache"
size = 21474836480 # 20 GiB; the default is 10 GiB
```

Then `sccache --stop-server` so the next build starts a server with the new settings, and check with
`sccache --show-stats` (it prints the cache location and max size; run it after a build to see hits).

The root `.cargo/config.toml` uses `line-tables-only` debug information for development builds
and their derived test profiles. This keeps file/line backtraces while reducing compiler output;
local-variable debug information is omitted. Incremental compilation keeps its existing settings.

On macOS, `python3 tooling/clean-build-caches.py` previews cleanup of a fixed list of generated
Rust, Zig, Xcode, and Android caches. Add `--apply` to clean, or `--install` to register a user
LaunchAgent that checks daily at 04:30 local time and at login. It removes trees unchanged for
14 days, or the oldest eligible trees above a combined 10 GiB cache budget, after at least six
hours without changes. Build locks, detected compiler activity, open files, and Git tracking
checks protect active work. This is a cache budget, not a hard limit on the entire checkout.
The latest scheduled result replaces `~/Library/Application Support/Ghostex/build-cache-cleanup/last-run.json`.
Time Machine snapshots and backup settings are not part of this maintenance job.
