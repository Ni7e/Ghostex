#!/usr/bin/env bash
set -euo pipefail

# CDXC:GPUILibghosttyVt 2026-07-03:
# Phase 1 of the GPUI cross-platform plan renders terminals as GPUI elements
# driven by libghostty-vt, so cargo builds must produce the static archive
# from the vendored Ghostty tree instead of depending on a manually built
# artifact. gpui/build.rs invokes this script with an install prefix inside
# OUT_DIR and links {prefix}/lib/libghostty-vt.a directly, mirroring how the
# GhosttyKit archive is linked.
#
# The vendored Ghostty build pins Zig 0.15.x (build.zig requireZig), while
# the machine default `zig` may be newer. Resolve a usable Zig explicitly:
# GHOSTEX_ZIG override first, then PATH, then mise installs. Do not silently
# build with a mismatched Zig; requireZig would fail anyway, so fail with a
# clear message instead.
#
# CDXC:iOSNativeTerminals 2026-05-22-11:17 (same workaround as
# scripts/build-ghostty-ios-vt-xcframework.sh):
# Xcode 26's macOS SDK exposes libSystem as arm64e-only in the TBD stub,
# which Zig 0.15.x cannot use for native aarch64 links (the libghostty-vt
# shared library link fails with undefined libc symbols). Redirect only
# macosx SDK discovery to the newest Command Line Tools SDK that still
# exports arm64 while leaving other xcrun queries on the default toolchain.

if [[ $# -ne 1 ]]; then
  echo "usage: $(basename "$0") <install-prefix>" >&2
  exit 64
fi
PREFIX="$1"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GHOSTTY_DIR="$ROOT_DIR/ghostty"
REQUIRED_ZIG_MINOR="0.15"

zig_matches() {
  local candidate="$1"
  [[ -x "$candidate" ]] || return 1
  local version
  version="$("$candidate" version 2>/dev/null)" || return 1
  [[ "$version" == "$REQUIRED_ZIG_MINOR".* ]]
}

find_zig() {
  if [[ -n "${GHOSTEX_ZIG:-}" ]]; then
    if zig_matches "$GHOSTEX_ZIG"; then
      printf '%s\n' "$GHOSTEX_ZIG"
      return 0
    fi
    echo "GHOSTEX_ZIG ($GHOSTEX_ZIG) is not a Zig $REQUIRED_ZIG_MINOR.x binary." >&2
    return 1
  fi

  local path_zig
  if path_zig="$(command -v zig 2>/dev/null)" && zig_matches "$path_zig"; then
    printf '%s\n' "$path_zig"
    return 0
  fi

  local candidate
  for candidate in "$HOME/.local/share/mise/installs/zig/$REQUIRED_ZIG_MINOR".*/bin/zig \
    "$HOME/.local/share/mise/installs/zig/$REQUIRED_ZIG_MINOR".*/zig; do
    if zig_matches "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  echo "No Zig $REQUIRED_ZIG_MINOR.x found. Install one (e.g. 'mise install zig@0.15.2') or set GHOSTEX_ZIG to a Zig $REQUIRED_ZIG_MINOR.x binary." >&2
  return 1
}

ZIG="$(find_zig)"
GHOSTTY_APP_VERSION="$(
  sed -n -E 's/^[[:space:]]*\.version[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "$GHOSTTY_DIR/build.zig.zon" \
    | head -n 1
)"
if [[ -z "$GHOSTTY_APP_VERSION" ]]; then
  echo "Could not resolve Ghostty app version from $GHOSTTY_DIR/build.zig.zon." >&2
  exit 1
fi

cd "$GHOSTTY_DIR"

if [[ "$(uname)" == "Darwin" ]]; then
  WRAPPER_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ghostex-xcrun.XXXXXX")"
  trap 'rm -rf "$WRAPPER_DIR"' EXIT
  MACOS_SDK="$(
    find /Library/Developer/CommandLineTools/SDKs -maxdepth 1 -type d -name 'MacOSX*.sdk' 2>/dev/null \
      | while IFS= read -r sdk; do
          if grep -q 'arm64-macos' "$sdk/usr/lib/libSystem.tbd" 2>/dev/null; then
            printf '%s\n' "$sdk"
          fi
        done \
      | sort -Vr \
      | head -n 1
  )"
  if [[ -z "$MACOS_SDK" ]]; then
    echo "No Command Line Tools macOS SDK with arm64 libSystem exports was found." >&2
    exit 1
  fi
  cat > "$WRAPPER_DIR/xcrun" <<EOF
#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--sdk" && "\${2:-}" == "macosx" && "\${3:-}" == "--show-sdk-path" ]]; then
  echo "$MACOS_SDK"
  exit 0
fi
/usr/bin/xcrun "\$@"
EOF
  chmod +x "$WRAPPER_DIR/xcrun"
  export PATH="$WRAPPER_DIR:$PATH"
fi

exec "$ZIG" build \
  -Dversion-string="$GHOSTTY_APP_VERSION" \
  -Demit-lib-vt=true \
  -Demit-xcframework=false \
  -Doptimize=ReleaseSafe \
  --prefix "$PREFIX"
