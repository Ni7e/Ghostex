# Ghostex Release Pipeline Optimization Plan

Date: 2026-07-02
Status: IMPLEMENTED 2026-07-02 (see "Implementation Status" at the end); CI workflow (section 9) deferred

Sources:

- `docs/2026-07-02 release/5.4.0-release-postmortem-and-skill-plan.md`
- `.agents/skills/ghostex-release-flow/SKILL.md`
- Direct inspection of `scripts/release-ghostex.mjs`, `gxserver-rs/package-remote-linux.mjs`,
  `native/macos/ghostexHost/build-ghostex-host.sh`,
  `native/macos/ghostexHost/Sources/ghostexHost/RemoteGxserverClient.swift`,
  `vitest.release.config.ts`, and measured staged bundle sizes.

## Verified Findings That Drive The Plan

- The release script is a linear 2,388-line monolith: `preflight -> bump -> build/sign/notarize -> Sparkle -> GitHub -> Android -> Homebrew`. It has heartbeat elapsed logging and a coarse `--resume`, but no per-phase durations, no phase state, and no way to re-enter at an arbitrary phase.
- There is **no CI at all** (`.github/workflows/` does not exist), so "CI builds the Linux packages" is net-new infrastructure, not a config tweak.
- `bun run release:test` with properly-excluded `vitest.release.config.ts` **already exists**. The broken root `bun run test` release gate is mostly a documentation/skill problem, not a missing tool.
- Measured staged bundle (`native/macos/ghostexHost/Web`, 1,522 MB uncompressed -> 828 MB UDZO DMG):
  - `code-server`: 460 MB
  - `t3code-server`: 363 MB
  - `gxserver-linux-x64`: 224 MB (Linux-only payload inside the macOS DMG)
  - `gxserver-linux-arm64`: 216 MB (same)
  - `bin`: 144 MB (of which `bin/bd` is 127 MB)
  - remainder: ~115 MB
- `RemoteGxserverClient.swift` tars the bundled loose Linux package tree into `gxserver.tar.gz` **at connect time** and scps it to the remote. The remote never talks to GitHub; the Mac is the source. The app ultimately consumes a tarball, not a loose tree.
- Each Linux payload already contains its own Linux `bd` (64-67 MB), so remotes are self-covered for `bd` regardless of what the Mac bundle ships.
- `Web/bin/bd` (127 MB) is the macOS binary used locally for the Project board. `build-ghostex-host.sh` already ships it once and writes a tiny launcher (`write_gxserver_shared_bd_launcher`, resolving `$HERE/../../bin/bd`) into the gxserver package -- a single resolution point that can be redirected.
- The release script already uploads GitHub release assets via `gh release upload` (DMG, APK), so publishing extra assets needs no new infrastructure.
- The live DMG is currently downloaded up to 3x per release (live Sparkle/asset validation, `brew fetch --force`, final verification curl).
- 5.4.0 bottlenecks from the postmortem: rediscovering the Linux cross-build recipe, a useless 5-minute root `bun run test`, late source edits after expensive work started ("moving-target release"), 16m35s Apple notarization (external, irreducible), and repeated ~828 MB network transfers.

## 1. New Script: `scripts/build-remote-gxserver-linux-release.sh`

- Encode the exact cross-build recipe from the postmortem:
  - Create Zig CC/AR wrappers in a temp dir; strip Rust-style `--target=` args; `zig cc -target x86_64-linux-gnu` / `aarch64-linux-gnu`; `zig ar`.
- Resolve toolchains explicitly and fail fast with an install hint if missing:
  - Zig 0.15.2 (mise path) for `ZMX_ZIG` / `TUI_ZIG`.
  - Zig 0.16.0 (Homebrew) for `ZEHN_ZIG`.
  - Discovered by version probe, not hardcoded paths alone.
- **Idempotency check first**: if both `build/remote-gxserver-linux/{x64,arm64}/package/build-identity.json` already have `sourceRevision == HEAD` and `sourceDirty == false`, print "up to date" and exit 0. This is the single biggest per-release saving after the first run.
- Build both arches (`--arch x64|arm64|all`), then validate build identity, required runtime files, and print per-arch fingerprints and durations.
- Wire up as `bun run gxserver:remote-linux:release` in `package.json`.

## 2. New Script: `scripts/release-preflight-fast.mjs`

- Checks, run **concurrently** where independent (target < 2 minutes wall clock):
  - Branch is `main`, worktree clean, `main == origin/main` (fetch first).
  - `v<version>` tag and GitHub release absent; Sparkle build number > live appcast top item.
  - `CHANGELOG.md` section for `<version>` exists with exactly `- Major` / `- Minor` top bullets plus sub-bullets (reuse `validateMajorMinorReleaseNotes` already exported from `release-ghostex.mjs`).
  - Subrepos (`android iOS tui crossplatform zmx`) clean and pushed.
  - Changed-file secret scan since previous tag.
  - `bun run typecheck`; `bun run release:test` (the good config); optional `--cargo` for gxserver-rs/gpui checks.
  - Remote Linux package freshness (same check as the builder's idempotency probe) with the exact fix command in the failure message.
  - Credential preflight: `gh auth` (with `env -u GH_TOKEN -u GITHUB_TOKEN`), signing identity, notary profile, Sparkle key match.
- **Freeze check**: after all checks pass, wait a short window (30-60 s) and confirm the worktree is *still* clean and HEAD unchanged. This directly addresses the moving-target problem that dominated the 5.4.0 release.
- Output: one concise PASS/FAIL table with per-check durations; exit non-zero on any failure.

## 3. Phase Framework + Timing In `scripts/release-ghostex.mjs`

- Introduce named phases matching the postmortem:
  - `preflight`
  - `prepare-remote-linux`
  - `publish-macos` (build/sign/DMG/notarize/staple/appcast + on-demand asset prep, see section 6)
  - `publish-android`
  - `publish-homebrew`
  - `verify-live`
- Add a phase state file, e.g. `release/state/v<version>.json`, recording each completed phase with its outputs (DMG path, SHA256, notary submission id, release URL, tap commit, on-demand asset SHAs) and duration.
- Add `--from <phase>` / `--only <phase>`: rerunning after a mid-release failure skips completed phases using the state file instead of the current all-or-nothing `--resume` heuristics. Keep `--resume` working as an alias for "resume from state".
- Wrap `logStep` in a timing recorder; print a **phase duration table at the end of every run** (and on failure, print durations so far). No more reconstructing bottlenecks from terminal scrollback.
- Make the preflight phase call the fast-preflight checks (shared module, not duplicated logic) and the idempotent Linux package builder.
- Keep `assertReleaseWithinOverallBudget` but make it phase-aware.

## 4. Kill Duplicate ~828 MB Downloads (Policy: Exactly One Live Download Per Release)

- `validateLiveSparkleAndAssets`: verify the GitHub asset via the **API digest** (`gh release view --json assets` SHA) against the local artifact SHA -- no download.
- Homebrew phase: keep `brew fetch --force --cask --arch=arm` as the *single* full live download (it proves the exact user install path), then locate brew's cached artifact and reuse it for the Sparkle EdDSA signature verification and final checksum instead of re-downloading.
- `release-final-verify.mjs` accepts `--dmg <path>` pointing at that cached file; only downloads if no verified local copy exists.

## 5. New Script: `scripts/release-final-verify.mjs`

- Codify the skill's whole "Final Verification" section as one command:
  - Clean/synced main; tag points at HEAD.
  - GitHub assets + digests (DMG, Android APK, and the three on-demand assets from section 6).
  - Live appcast top item: version, short version, URL, EdDSA signature, non-empty embedded notes containing expected release text.
  - Homebrew cask version/SHA/arm64-only/`:ventura` + `brew info` / `brew cat`.
  - `validate-macos-app-bundle.mjs` run.
  - Bundled-resources spot checks: code-server node, ripgrep, no `Web/bin/node`, launcher-based `bd` (per section 6), pruned node-pty prebuilds, no t3code source maps.
  - On-demand asset identity checks (section 6): assets exist live, digests match the sealed manifest.
  - Live Android APK checksum vs release notes.
  - Subrepo cleanliness.
- Print PASS/FAIL table + durations. This becomes the `verify-live` phase and is also runnable standalone after manual recovery.

## 6. Bundle Split: Three On-Demand Assets, Download-To-Mac Model

### Assets published per release (same GitHub Release page as the DMG, pinned to `v<appVersion>`)

| Asset | Uncompressed | Downloaded when |
| --- | --- | --- |
| `gxserver-linux-x64.tar.gz` | ~223 MB (~60-80 MB compressed) | First connect to an x64 remote |
| `gxserver-linux-arm64.tar.gz` | ~215 MB | First connect to an arm64 remote |
| `bd-darwin-arm64.tar.gz` | ~127 MB | First time the Project board needs `bd` locally |

- Version-pinned to the app's own release tag, never a "latest" location: payloads and app are built together (protocol, build identity), and old app versions keep working forever.
- Upload uses the existing `gh release upload` machinery in `release-ghostex.mjs` -- no new infrastructure.

### App-side download flow (shared component, used by both consumers)

- One shared "on-demand resource" path in the macOS host:
  - Check local cache at `~/Library/Application Support/Ghostex/<component>/<appVersion>/<arch>/`.
  - If missing, download from `github.com/maddada/Ghostex/releases/download/v<appVersion>/<asset>`.
  - Verify SHA256, unpack into cache, continue.
- SHA pinning stays tamper-proof: SHAs live in a small manifest (`on-demand-resources.json`) staged into the app bundle at build time, so it is sealed by codesigning/notarization; the app trusts only that manifest, never the network.
- Downloads happen once per app version; cache cleanup can prune older app-version directories.

### Remote connect path (`RemoteGxserverClient.swift`)

- Keep the existing working flow: **Mac downloads, then scp**. The remote never talks to GitHub, so remotes without GitHub access keep working, and the SSH install flow is untouched. Remote-side `curl` from GitHub was rejected: bigger rewrite, more failure modes, breaks isolated remotes.
- Since the client already builds `gxserver.tar.gz` on the fly from the loose tree, ship/upload the pre-built tarball directly where possible -- first connect skips the local tar step.
- Remote `bd` needs nothing: each Linux payload already bundles its own Linux `bd`, so remotes stay covered automatically.
- Connect UI gains a "Downloading server package..." state for the ~60-80 MB first-use download before the ssh upload starts (progress + clear failure message if github.com is unreachable -- one mode, not a fallback).

### Local `bd` path (Project board)

- `Web/bin/bd` (127 MB) leaves the bundle; the existing launcher script is the single resolution point and gets redirected to resolve the cache path (with the on-demand download triggered if absent).
- The gxserver package's `bin/bd` launcher (written by `write_gxserver_shared_bd_launcher`) keeps working -- it resolves to the cache instead of `../../bin/bd`.
- The macOS `bd` binary is **Developer ID codesigned (with timestamp) before tar+upload** -- signing moves from bundle-signing time to asset-prep time in the release script.
- Handle quarantine: after checksum verification, ensure the unpacked binary carries no `com.apple.quarantine` attribute so Gatekeeper does not block first execution.

### Dev builds unchanged

- `build-ghostex-host.sh` keeps bundling from local build output in dev; only **release** packaging stops embedding the three payloads. The dev loop is untouched.

### Explicitly not splitting

- `code-server` (460 MB) and `t3code-server` (363 MB) are core local functionality -- splitting them breaks offline first-run. Deduping their overlapping node_modules is a deferred idea only.

### Optional cheap add-on

- Keep the previous release's DMG in a local archive dir so `generate_appcast` emits Sparkle **delta updates** -- smaller updates for existing users at near-zero release cost.

### What this does NOT touch

- Apple signing/notarization: still one DMG (the sealed manifest travels inside it).
- Sparkle: same single-DMG appcast -- updates just get smaller.
- Homebrew: cask still points at the DMG.
- Android: unaffected.

### Ripple changes

- **Release script (section 3 phases)**: `publish-macos` gains an "asset prep" step -- sign macOS bd -> build 3 tarballs from validated packages -> compute SHAs -> stage manifest into app **before** signing/notarization -> upload the 3 assets alongside the DMG; phase state records their SHAs.
- **Validators**: `validate-macos-app-bundle.mjs` and the release-script bundle checks flip from "must contain `Web/gxserver-linux-{x64,arm64}` + 127 MB `Web/bin/bd`" to "must contain the launcher + sealed manifest, must NOT contain the fat payloads". Skill rules 16/22/23 rewritten accordingly.
- **`release-final-verify.mjs` (section 5)**: verify all 3 assets exist on the live release with digests matching the sealed manifest; spot-check one tarball download+unpack; verify the macOS bd signature (`codesign --verify`) inside it.
- **New skill (section 8)**: `references/on-demand-assets.md` documenting the asset scheme, manifest, cache layout, and recovery (re-upload a missing asset to an existing release via `--from publish-macos`-style resume).
- **Verification (section 10)**: end-to-end test after a `--no-push`-style build -- point the app at a locally-served asset dir, exercise first remote connect (download -> verify -> scp -> gxserver starts) and first Project-board `bd` use.

### Impact

- App on disk: **1.9 GB -> ~1.33 GB**; DMG: **828 MB -> roughly ~600 MB** (removed payloads compress to ~200 MB of the DMG).
- Faster: notary upload, GitHub upload, `brew fetch`, user installs, and every future Sparkle update -- permanently, for all users.
- Most users never pay any download cost; only remote users and Project-board users fetch what they need, once per app version.
- User-visible trade-off (needs explicit sign-off before implementation): first remote connect and first Project-board use require one download from github.com on the Mac, with a visible "downloading" state.

## 7. Fix The Test Gate (Mostly Documentation)

- Point the skill and preflight at `bun run typecheck` + `bun run release:test`; explicitly ban root `bun run test` from release flows.
- Optionally port the release-config excludes into the root `vitest.config` so root `test` stops discovering code-server/built bundles -- separate small commit, not release-critical.

## 8. New Skill: `.agents/skills/ghostex-release-operator/` (Local-Only, Gitignored Like The Current One)

- Short strict `SKILL.md`:
  - Trigger description (Ghostex public releases from this repo).
  - Hard rules: no stash, freeze before mechanical release, no Intel / `appcast-x86_64.xml` touches, Major/Minor changelog shape, resume via state file, never root `bun run test`.
  - 11-step checklist that calls the scripts:
    1. Inspect.
    2. Subrepo commits.
    3. Topic commits.
    4. Push.
    5. **Freeze + recheck.**
    6. Changelog/docs.
    7. `release-preflight-fast`.
    8. `build-remote-gxserver-linux-release.sh`.
    9. Credential preflight.
    10. `release:local -- <version>`.
    11. `release-final-verify`.
- References:
  - `references/standard-release.md` -- exact command sequence, changelog generation, final report shape.
  - `references/remote-linux-packages.md` -- exact cross-build recipe + build-identity verification + future CI-artifact path.
  - `references/recovery.md` -- phase-based resume, manual Homebrew finish, Android/notary/credential recovery.
  - `references/final-verification.md` -- what `release-final-verify` covers and how to run pieces manually.
  - `references/on-demand-assets.md` -- asset scheme, manifest, cache layout, re-upload recovery.
- Trim `ghostex-release-flow/SKILL.md` to a deprecation pointer at the new skill (keeping both full copies means two divergent sources of truth).

## 9. Optional Follow-Up (Proposed, Not Default): GitHub Actions Workflow

- `.github/workflows/remote-gxserver-linux.yml`: on push to main, build x64+arm64 packages on Ubuntu, upload artifacts keyed by commit SHA; preflight gains a "download CI artifact for HEAD" path.
- Flagged as opt-in since the repo currently has zero CI and the scripted local cross-build already gets this to 1-3 minutes (or ~0 via the idempotency check).

## 10. Verification Of The Implementation Itself (Before Handing To The Next Release Agent)

- Unit tests where they are allowed: extend `scripts/release-ghostex.test.mjs` for phase-state read/write, `--from` / `--only` selection, manifest rendering, and the single-download policy. (The macOS-app/gpui no-test rules do not cover `scripts/`.)
- Dry runs without publishing:
  - `release-preflight-fast` against current HEAD.
  - Linux builder twice (second run must no-op).
  - `release-final-verify` against the **live 5.4.0** release as a known-good target (with expected diffs for the not-yet-split bundle called out).
  - `release:local -- <version> --no-push`-style path for phase/timing output.
- On-demand asset end-to-end (per section 6): locally-served asset dir, first remote connect, first Project-board `bd` use.
- Update the postmortem doc with a "what was implemented" section and refresh `docs/2026-07-02/next-agent-prompt.md` so the next agent runs the faster flow.

## Implementation Order

1. Section 1 (Linux builder script) -- unblocks everything, biggest rediscovery cost eliminated.
2. Section 2 (fast preflight) + section 7 (test gate docs).
3. Section 3 (phases, state file, timing) in `release-ghostex.mjs`.
4. Section 4 (single-download policy) + section 5 (final verify script).
5. Section 6 (bundle split) -- largest change; needs user sign-off on the first-use download trade-off first.
6. Section 8 (new skill + references, deprecate old skill).
7. Section 10 (verification passes, doc updates).
8. Section 9 (CI) only if approved.

## Expected Impact

| Bottleneck (5.4.0) | After |
| --- | --- |
| Rediscovering Linux cross-build (longest controllable loss) | 1-3 min scripted, ~0 when packages already match HEAD |
| `bun run test` wasted ~5 min + noise | `release:test` gate, minutes, trustworthy |
| Late source edits after expensive work began | Freeze check fails fast in preflight, before anything expensive |
| 3x ~828 MB live downloads | 1x download (brew fetch), reused everywhere else |
| 828 MB DMG upload/notarize/fetch | ~600 MB after on-demand asset split |
| Bottlenecks invisible until postmortem | Per-phase duration table every run |
| Mid-release failure -> improvised recovery | State-file resume: `--from <phase>` |

Net: a clean release should drop from ~1 hour to ~30-35 minutes, with Apple notarization (10-20 min, external) as the irreducible floor.

## Open Decisions For The User

1. Bundle split (section 6): approve the first-use download trade-off (remote connect and Project board each need one github.com download per app version, on the Mac).
2. CI workflow (section 9): build now or defer.
3. Old skill: deprecation pointer vs. deleting `ghostex-release-flow` outright once the new skill is proven on a real release.

## Implementation Status (2026-07-02)

Everything except the optional CI workflow (section 9) was implemented in one pass. The user approved the bundle split trade-off by requesting implementation.

Shipped:

- `scripts/build-remote-gxserver-linux-release.sh` (`bun run gxserver:remote-linux:release`) — encoded cross-build recipe, dual Zig resolution, idempotent freshness check reusing the release script's resource list, `--check-only`. Verified: syntax, live freshness check correctly reports both packages stale vs HEAD.
- `scripts/release-preflight-fast.mjs` (`bun run release:preflight`) — 14 concurrent gates plus 45 s freeze window. Verified live: 0.7 s wall clock, correct FAILs on the current dirty repo (worktree, missing 5.5.0 changelog, stale Linux packages) and correct PASSes (Sparkle build number vs live feed, real EdDSA key match, secret scan).
- `scripts/release-ghostex.mjs` — six resumable phases with state file `build/release-state/v<version>.json`, `--from`/`--only`, phase timing table on every run (also on failure), single-download policy (GitHub API digests + local-DMG Sparkle signature verification; brew fetch is the one full download and its cache path feeds final verification), on-demand asset validation/upload/notes/resume.
- Bundle split: `build-ghostex-host.sh` gains `GHOSTEX_ON_DEMAND_ASSETS=1` (release-only) — tars `gxserver-linux-{x64,arm64}.tar.gz` + Developer ID-signed `bd-darwin-arm64.tar.gz` into `build/on-demand-assets/<version>/`, seals `Web/on-demand-resources.json`, replaces `Web/bin/bd` with the download launcher, embeds no Linux payloads. Launcher verified end-to-end (download via base-URL override, cache hit, tampered-asset rejection). Dev builds unchanged.
- Swift: `RemoteGxserverClient` prefers bundled loose packages (dev), otherwise downloads/verifies/caches the sealed tarball and scps it; emits `downloadingRemoteServerPackage` progress events through both AppDelegate dispatch paths. Full `xcodebuild` of the ghostex scheme succeeds.
- `scripts/validate-macos-app-bundle.mjs` — mode-aware (bundled vs on-demand shape, launcher checksum vs sealed manifest).
- `scripts/release-final-verify.mjs` (`bun run release:verify`) — codified final checklist with PASS/WARN/FAIL/SKIP table; `--dmg` reuse; verified live against v5.4.0 (release, appcast, cask, Android checksum all PASS; legacy bundled release correctly WARNs on on-demand assets).
- Skill: `.agents/skills/ghostex-release-operator/` (SKILL.md + 5 references) for fully autonomous releases; `ghostex-release-flow` marked deprecated with a pointer.
- Tests: `scripts/release-ghostex.test.mjs` extended (changelog extraction, on-demand notes section, phase-name stability) — 10/10 pass; `bun run typecheck` clean. One macOS source-contract assertion updated for the new install path; the other 15 `release:test` failures predate this work (stale contracts / concurrent uncommitted gpui+sidebar edits).

Deferred: GitHub Actions workflow for Linux packages (section 9), Sparkle delta updates, root vitest exclude port (section 7 optional half).
