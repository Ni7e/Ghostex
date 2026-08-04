# GPUI multi-platform release

The canonical GPUI release is planned and dispatched with:

```bash
bun run release:gpui -- 6.9.0 --dry-run
bun run release:gpui -- 6.9.0
```

The dispatcher requires clean, pushed `main`, validates the local release
scope and configured secret names, selects Windows signing explicitly, and
starts `.github/workflows/release-gpui.yml`. The workflow's first remote step
revalidates the immutable source SHA, package/changelog version, platform
dependencies, and required secret values before installing dependencies. It
then runs typecheck/release tests once and fans out independent macOS, Debian
x64, Fedora x64, Windows x64, Windows ARM64, React Native Android, Linux gxserver
x64/ARM64, and Windows WSL bootstrap builds.

Each job uploads a manifest containing the exact filename, byte size, and
SHA-256 of every artifact. The publish job downloads and re-hashes all enabled
artifacts before creating the tag and release.

Platforms can be disabled without editing workflow code:

```bash
bun run release:gpui -- 6.9.0 --skip-linux-rpm --skip-windows-arm64
```

Nightly prereleases can include the notarized macOS build without advancing the
production Sparkle feed:

```bash
bun run release:gpui -- 6.9.0 --prerelease --skip-sparkle
```

Windows signing defaults to `auto`: it is enabled only when both Authenticode
secrets exist. Use `--windows-signing required` when unsigned output is
unacceptable, or `--windows-signing off` for explicitly unsigned beta builds.

The platform scripts can also be run directly when debugging a runner:

```bash
scripts/release-gpui/macos.sh 6.0.1
scripts/release-gpui/linux-deb.sh 6.0.1
scripts/release-gpui/linux-rpm.sh 6.0.1
scripts/release-gpui/android.sh 6.0.1
pwsh scripts/release-gpui/windows.ps1 -Version 6.0.1 -Arch x64
```

## Published artifacts

- macOS arm64: `ghostex-<version>-arm64.dmg`, plus the existing three sealed
  on-demand assets. This is GPUI packaged as `Ghostex.app` with bundle ID
  `com.madda.ghostex.host` and the primary `appcast.xml`, so it replaces the
  installed Swift-host app through Sparkle.
- Linux x64: `ghostex_<version>_amd64.deb` and
  `ghostex-<version>-1.x86_64.rpm`.
- Windows x64 and ARM64: a Velopack Setup EXE, portable ZIP, full update
  package, architecture-specific `releases.win-<arch>-stable.json` feed, and a
  delta package when a previous release exists. Installed and portable copies
  stay in their original mode when updating. The package carries CEF's DLLs
  and resources plus the matching Linux gxserver runtime for WSL2.
- Android: signed universal React Native `ghostex-android.apk`.
- Linux gxserver: `gxserver-linux-x64.tar.gz` and
  `gxserver-linux-arm64.tar.gz` static runtime archives.
- Windows WSL bootstraps: `gxserver-wsl-windows-x64.zip` and
  `gxserver-wsl-windows-arm64.zip`, each containing a checksum-pinned Linux
  runtime and PowerShell installer for an initialized WSL2 distribution.

The Sparkle feed is pushed to `main` only after the notarized DMG and all other
enabled assets are live. This prevents installed Ghostex copies from observing
an update whose enclosure is not downloadable yet.

Velopack feeds and packages are uploaded as assets on the same GitHub release.
The release remains a draft until every platform artifact is validated, so the
Windows updater cannot observe a feed before its referenced package is live.
This replaces the pre-release NSIS installer without an in-place NSIS migration;
an existing NSIS installation must install a Velopack Setup once before it can
receive automatic updates.

## Required GitHub Actions secrets

macOS:

- `APPLE_DEVELOPER_ID_P12_BASE64`
- `APPLE_DEVELOPER_ID_P12_PASSWORD`
- `APPLE_KEYCHAIN_PASSWORD`
- `APPLE_NOTARY_KEY_BASE64`
- `APPLE_NOTARY_KEY_ID`
- `APPLE_NOTARY_ISSUER_ID`
- `SPARKLE_PRIVATE_KEY`

Instead of the three `APPLE_NOTARY_KEY_*` secrets, notarization can use the
existing Apple ID profile contract:

- `APPLE_NOTARY_APPLE_ID`
- `APPLE_NOTARY_TEAM_ID`
- `APPLE_NOTARY_APP_PASSWORD`

Android:

- `ANDROID_RELEASE_KEYSTORE_BASE64`
- `ANDROID_RELEASE_STORE_PASSWORD`
- `ANDROID_RELEASE_KEY_ALIAS`
- `ANDROID_RELEASE_KEY_PASSWORD`

Windows:

- `WINDOWS_CODE_SIGN_PFX_BASE64`
- `WINDOWS_CODE_SIGN_PFX_PASSWORD`

The P12, App Store Connect `.p8`, Android keystore, and Sparkle private key must
never be committed. Store their base64 forms as repository or environment
secrets. The workflow reconstructs them only under the ephemeral runner's
temporary directory. Missing credentials fail in the first remote validation
step, before any long package build.

## Release preparation

Before dispatching:

1. Set `package.json` to the new semver.
2. Add the matching `CHANGELOG.md` section.
3. Commit and push all release-bound work to `main`.
4. Confirm the tag and GitHub release do not already exist.
5. Configure the required secrets and allow GitHub Actions read/write contents
   permission so the final job can push the release tag and generated appcast.

Do not duplicate typecheck/release tests locally; the gated prepare job runs
them before package fan-out.

## Publication recovery and finish

If every package succeeded but the publisher failed, reuse the source run
instead of rebuilding:

```bash
bun run release:actions:publish -- 6.9.0 \
  --source-run-id <run-id> <same scope/signing flags>
```

The publisher is idempotent. An already-public release is accepted only when
its prerelease state and every asset digest match the source artifacts. A
missing Sparkle push is repaired only when the tagged appcast commit is a
provably safe fast-forward.

After publication:

```bash
bun run release:homebrew -- 6.9.0
bun run release:verify -- 6.9.0 --dmg "<DMG_PATH from Homebrew>" --skip-repo
```

The Homebrew script updates and validates only the Ghostex cask, fetches the
DMG once, and the verifier reuses the cached bytes. GitHub file checks use the
authenticated Contents API so raw-CDN cache propagation cannot cause a false
failure.

The old `release:local` and resumable pipeline commands remain historical
recovery machinery under explicit `:legacy`/`:resumable` script names.

## Android release identity and same-version repair

The Android job always restores the pinned private `mobile/` React Native
submodule and builds application ID `io.ghostex`. Its manifest records
`source_kind: react-native-mobile`; the publisher rejects Android artifacts
without that identity. The retired Termux and iOS repositories live outside
the active checkout under `/Users/madda/dev/_active/ghostex-deprecated/`, and
there is no iOS/TestFlight release job.

Only when an existing public version explicitly needs its Android APK
corrected, dispatch the narrow replacement workflow:

```bash
gh workflow run release-replace-android.yml \
  --repo maddada/Ghostex --ref main -f version=<existing-version>
```

It rebuilds only React Native Android, replaces only
`ghostex-android.apk`, updates that checksum line in the existing release
notes, and verifies that every unrelated release asset digest stayed
unchanged. It does not touch Sparkle, Homebrew, tags, or desktop packages.
