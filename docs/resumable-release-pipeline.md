# Resumable release pipeline

> Historical pipeline. New GPUI releases use
> `docs/GPUI_RELEASE_ACTIONS.md` and `bun run release:actions`. The commands
> below remain available under explicit `:resumable` script names only.

Ghostex releases are staged as durable draft GitHub releases. Package builds are
independent workflow runs; assembly performs no builds. A workflow-only repair
can therefore run from current `main` while every package continues to target
the immutable application `source_sha`.

## Operator commands

```bash
bun run release:start:resumable -- 6.3.0
bun run release:status -- 6.3.0
bun run release:resume -- 6.3.0
bun run release:retry -- 6.3.0 macos-notarization
bun run release:retry -- 6.3.0 android
bun run release:assemble -- 6.3.0
bun run release:verify:resumable -- 6.3.0
```

An audited replacement is deliberately separate from retry. It requires the
currently staged checksum and an explicit confirmation flag:

```bash
bun run release:replace -- 6.3.0 ghostex-android.apk \
  --expect-sha <current-64-character-sha256> \
  --confirm-replace
```

This removes only that draft deliverable and its metadata, then marks its
package missing. It cannot operate on a public release.

`release:start:resumable` defaults `source_sha` to the current full commit. Override it
with `--source-sha <40-character-sha>`. The command creates or reuses draft
`v<version>`, prints every reuse/build decision, and dispatches the first ready
wave. Each newly staged package validates the durable state and automatically
dispatches work that has just become eligible; the final package dispatches
assembly. `release:resume` is a recovery command for interrupted or older runs,
and `--dry-run` prints its decision without dispatching.

For a non-production exercise, use:

```bash
bun run release:start:resumable -- 6.3.0 --channel test --skip-sparkle
```

The version must already be present at `source_sha` in `package.json` and
`CHANGELOG.md`.

## Workflows

- `release-build-android.yml`
- `release-build-gxserver-x64.yml`
- `release-build-gxserver-arm64.yml`
- `release-build-macos.yml`
- `release-assemble.yml`

Every workflow is independently dispatchable from `main`. Package workflows
check out `source_sha` as their application tree and separately check out the
current `main` release scripts as `.release-automation`. Artifact metadata
records both source and workflow revisions.

The macOS build overlaps its independent heavyweight work. GhosttyKit and the
complete bundled runtime build in parallel, the Rust/CEF build starts as soon
as GhosttyKit is ready, and the final signing job consumes their source-SHA-
bound tar artifacts. Tar packaging preserves executable modes and framework
symlinks that raw Actions artifact uploads would otherwise flatten.

The supported public deliverable allowlist is deliberately narrow:

- `ghostex-<version>-arm64.dmg`
- `ghostex-android.apk`
- `gxserver-linux-x64.tar.gz`
- `gxserver-linux-arm64.tar.gz`
- `bd-darwin-arm64.tar.gz`

Windows and Linux GPUI packages are not part of this pipeline. Assembly fails
if the draft contains an unrecognized deliverable or metadata sidecar.

## Durable state and idempotency

Each deliverable is uploaded to the draft together with
`<asset>.metadata.json`. Metadata includes version, source SHA, package,
architecture, checksum, size, workflow SHA, workflow run ID, and creation time.
`release-state.json` records the exact expected set, completed package runs,
macOS notarization state, and GitHub/Sparkle publication state.

Deliverables and metadata are immutable. Re-uploading identical bytes is a
successful reuse. A checksum mismatch fails with an explicit replacement
message; normal recovery never clobbers it. Only `release-state.json` is a
mutable control-plane asset, and staging jobs serialize its updates by version.
When gxserver packages are reused from a prior public release, both
architectures download, hash, upload, and verify concurrently; only their two
control-plane state writes remain serialized.

## macOS recovery

The macOS workflow has three boundaries:

1. Build/sign creates a signed, unstapled DMG and preserves it as a 90-day
   private Actions artifact.
2. Submit uses `notarytool submit --no-wait`, uploads the submission record, and
   writes the Apple submission ID plus signed-DMG run ID to release state before
   polling starts.
3. Poll/staple downloads the preserved DMG, queries the existing submission,
   staples and validates it, generates and verifies Sparkle metadata, then
   stages the final assets.

`release:retry -- <version> macos-notarization` dispatches stage 3 with the
saved run and submission IDs. The recovery stage passes App Store Connect
credentials directly to `notarytool`; it does not read or create a login
Keychain profile. The build/sign stage alone creates an ephemeral signing
Keychain on the clean GitHub runner.

## Publication order

Assembly revalidates the complete metadata/checksum allowlist, Android archive,
both gxserver architectures, the stapled DMG, Apple ticket, codesigning
assessment, and Sparkle signature. It then publishes the draft and re-reads all
live asset digests. The production appcast is committed and pushed only after
that succeeds. A failed Sparkle push is recovered by rerunning assembly; no
package workflow is involved.

Normal recovery never deletes a tag or draft release and never silently
replaces a mismatched staged package.
