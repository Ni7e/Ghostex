# Local start performance (`bun run start`, macOS)

Measured on the maintainer's M5 Pro (18 cores, 64GB, macOS 27) on 2026-09-22/23. The build half of the start (everything except install and launch) was run directly with the start's environment.

| Case | Before | After |
|---|---|---|
| Unchanged start, build half | nested items re-signed every run | ~5s, 19 of 20 signatures reused |
| One-line Rust edit in the app crate, build half | ~20s compile at opt-level 3 plus full re-signing | ~10s (6s compile) |
| Cold compile of the app crate | 315 CPU-seconds (opt-level 3) | 71 CPU-seconds (opt-level 0) |
| Dev bundle size | 1.7GB | 1.1GB |

## What the start does

`tooling/start-gpui.mjs` re-runs itself under `build/ghostex-gpui-local-start.lock`, then runs, on macOS:

1. `apps/desktop/scripts/build-macos-rust.sh` and `build-macos-sidebar.sh` in the background.
2. `prepare-macos-runtime.sh` in the foreground: zmx (Zig), code-server staging, Portless, gxserver (cargo), into `apps/desktop/runtime/macos/Web`.
3. `build-macos-app.sh` with the prebuilt Rust binaries: stages `apps/desktop/build/macos.noindex/Ghostex.app` and signs it with `codesign-gpui-app.sh`.
4. Closes the installed app, keeps or stops gxserver, syncs the bundle to `/Applications/Ghostex.app` with rsync, checks the signature, and opens it.

Every expensive step sits behind a content-hash stamp in `build/<arch>/build-cache/`.

## Decisions and why

- **opt-level 0 for the two leaf crates** (`CDXC:Build 2026-09-23 DECISION` in `build-macos-rust.sh`). For a one-line edit the rebuild took ~5s at opt-level 0, ~17s at 1 and ~20s at 3. opt-level 1 is not worth it. `--optimized` (or `GHOSTEX_START_OPTIMIZED=1`) restores release optimization for both crates. Incremental compilation stays on for local starts only.
- **code-server outside the bundle** (`CDXC:CodeEditor 2026-09-23 DECISION`). Its 5.5k files were re-sealed by the outer signature, verified, synced and malware-scanned on every start. The app resolves the folder named in `Web/local-start-code-server-root` right after the bundle candidates (`source_code_server_repo_root_candidates`). The start's process matching also covers that folder when it closes the installed app. The two newest folders are kept.
- **Copy only on source change.** Signing modifies staged binaries, so they never matched their sources and were re-copied unsigned and re-signed on every start. `stage_file_if_changed` / `stage_tree_if_changed` stamp the source identity instead.
- **Parallel inside-out signing** (`GHOSTEX_GPUI_SIGN_JOBS`, default 8). Local starts skip the post-sign strict deep verify because the start deep-verifies the installed copy right after the sync.
- **gxserver kept when unchanged.** The build identity hashes the whole staged package, so a match means the running daemon is already the code the start would launch.
- **Linux gxserver packages** stay in dev bundles because remote install reads them from there; they are rsynced instead of deleted and re-copied.
- **Installs stay in place, never hand-made.** On 2026-09-21 macOS App Management blocked the sync into `/Applications/Ghostex.app` halfway. An agent then hand-installed every later build as `Ghostex-new.app` and moved the old app aside as `Ghostex.old-<time>.app`, leaving five 1.7GB copies in two days. The start now probes write access before closing the app and stops with the App Management fix if it is blocked. It deletes leftover copies that carry the app's bundle id and are not running. It does not install by swapping in a new bundle because a kept gxserver and live zmx sessions run from files inside the installed one.
- **Incremental cache pruning** (`CDXC:Build 2026-09-23 DECISION` in `start-gpui.mjs`). Every build configuration gets its own rustc incremental cache and nothing removed old ones: 26GB across 387 caches on 2026-09-23. Each start keeps the newest cache per crate in every `incremental` folder of both targets and leaves anything touched in the last 30 minutes alone. The trade-off is that switching between configurations (for example `--optimized` and back) starts that configuration's cache from cold.
- Smaller items: the storage check and signing-identity probe run only in the locked child; app PIDs come from `lsappinfo` (~0.01s) instead of `osascript` + System Events (~0.27s) in the 100ms polls; the app icon is stamped; `reportCompressedSize` is off in `apps/desktop/vite.config.ts`.

## Rejected or deferred (checked 2026-09-22)

- **Other linkers.** Apple's ld-prime is the fastest macOS linker today. lld cannot link against the macOS 27 SDK yet (rust#162928), and wild and mold have no usable macOS backend.
- **Cranelift and the parallel front end (`-Zthreads`).** Nightly only. Cranelift also has macOS ABI problems with `objc_msgSend`.
- **sccache.** Keep it. Its low hit rate is expected, because incremental builds and bin crates are never cacheable; it pays off after a clean or a toolchain change.
- **Splitting the app crate.** At opt-level 0 a cold compile of the app crate is ~60s of single-threaded front-end work, which only splitting the ~170k-line crate into several crates would parallelize. That is the long-term fix, and a large refactor.
- **`taskpolicy -b` / `nice` on builds you wait for.** Background QoS slowed one measured job from 7.4s to 115s, and `nice` has no measurable effect on Apple silicon.

## Machine settings that help (user's choice, not repo changes)

- Privacy & Security > Developer Tools: add the terminal and Ghostex itself (agents build inside Ghostex sessions). This exempts their child processes from XProtect scans of freshly built build scripts; `sudo spctl developer-mode enable-terminal` makes the pane appear.
- Spotlight > Search Privacy: add `apps/desktop/target`, `server/target` and `build/` (`.metadata_never_index` no longer works; a `.noindex` folder suffix does).
- Time Machine: `sudo tmutil addexclusion -p /Applications/Ghostex.app` (cargo already excludes `target/`).
