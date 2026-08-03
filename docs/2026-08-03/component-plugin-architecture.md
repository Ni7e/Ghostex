# On-demand component and plugin architecture

Ghostex release bundles now contain the app shell plus a sealed
`on-demand-resources.json` schema-v2 manifest. The base release does not contain
T3 Code, code-server, a Node runtime, or CEF. T3 Code remains disabled behind
`T3CODE_ENABLED`; code-server and CEF are versioned components managed by the
native component store and Plugins window.

## Release and trust contract

- Reusable assets are published on immutable GitHub component tags:
  `cef-<version>` and `code-server-<version>`.
- Asset names include the component, component version, and platform. The
  sealed manifest records the GitHub repository, tag, SHA-256, and byte size.
- Platform builders create deterministic tarballs, seal their exact metadata,
  and invoke the idempotent publisher. Missing tags/assets are created; exact
  matches are no-ops; digest mismatches require a new component version.
- macOS CEF is signed with the app's Developer ID team before packaging. Every
  platform treats the checksum inside the signed app manifest as its trust
  anchor.

## Installation and cache layout

First launch installs required CEF with native progress and retry UI. Source is
optional and installs code-server—including its private Node runtime—when the
user requests it. App updates reuse unchanged component versions.

- macOS: `~/Library/Application Support/Ghostex/components/<name>/<version>/`
- Linux: `~/.local/share/ghostex/components/<name>/<version>/`
- Windows: `%LOCALAPPDATA%\Ghostex\components\<name>\<version>\`

The expected macOS base DMG is at most 300 MiB. First launch adds roughly
110–130 MiB for compressed CEF, and Source adds roughly 120–150 MiB when
installed. The Plugins window reports installed/cached sizes and owns optional
component removal.

## Verification and recovery

The macOS bundle validator requires manifest v2 and rejects legacy release
payloads. Final verification checks live component-tag size/digest values,
downloads and unpacks one component, prints installed-app and DMG sizes, and
enforces the 300 MiB DMG budget. Historical bundled-runtime releases remain
verifiable as explicit expected-difference warnings.

If a component tag exists but a sealed asset is missing, rerun the exact
`bun run release:component -- ...` command printed by preflight. This uploads
only the missing asset. Never replace an asset whose live digest differs;
correct the build, increment the component version, reseal the manifests, and
publish the new immutable tag.
