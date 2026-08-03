#!/usr/bin/env bash
# CDXC:GPUIWindowsWslStart 2026-08-02:
# Build and stage the native Win32 GPUI app from a WSL-owned `bun run start`
# without routing any part of the workflow through PowerShell. Web resources
# build with WSL Bun; the pinned Windows Rust/MSVC/CMake/Ninja/Zig tools run
# through normal WSL Windows-process interop. Development staging keeps the
# flat CEF layout; release staging emits the native component bootstrap and a
# sealed CEF component asset.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GPUI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$GPUI_DIR/.." && pwd)"
APP_NAME="Ghostex"
APP_DIR="$GPUI_DIR/build/windows/$APP_NAME"
RELEASE_ARCH="${GHOSTEX_WINDOWS_ARCH:-x64}"
ON_DEMAND_COMPONENTS="${GHOSTEX_ON_DEMAND_ASSETS:-0}"
RELEASE_VERSION="${GHOSTEX_GPUI_MARKETING_VERSION:-$(node -p "require('$REPO_ROOT/package.json').version")}"
CMD_EXE="/mnt/c/Windows/System32/cmd.exe"

case "$RELEASE_ARCH" in
  x64)
    RUST_TARGET="x86_64-pc-windows-msvc"
    VS_ARCH="x64"
    ;;
  arm64)
    RUST_TARGET="aarch64-pc-windows-msvc"
    VS_ARCH="arm64"
    ;;
  *)
    echo "GHOSTEX_WINDOWS_ARCH must be x64 or arm64, got $RELEASE_ARCH" >&2
    exit 1
    ;;
esac

if [[ ! -x "$CMD_EXE" ]] || ! grep -qi microsoft /proc/sys/kernel/osrelease; then
  echo "build-windows-app-wsl.sh must run inside WSL2." >&2
  exit 1
fi

WINDOWS_PROFILE_RAW="$($CMD_EXE /d /s /c "echo %USERPROFILE%" | tr -d '\r' | tail -n 1)"
WINDOWS_PROFILE="$(wslpath -a -u "$WINDOWS_PROFILE_RAW")"
WINDOWS_TOOLS_ROOT="${GHOSTEX_WINDOWS_TOOLS_ROOT:-$WINDOWS_PROFILE/apps/ghostex-build-tools}"

first_existing_file() {
  local candidate
  for candidate in "$@"; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

VS_DEV_CMD="$(first_existing_file \
  "${GHOSTEX_WINDOWS_VS_DEV_CMD:-}" \
  "$WINDOWS_PROFILE/apps/vs-buildtools/Common7/Tools/VsDevCmd.bat" \
  /mnt/c/Program\ Files/Microsoft\ Visual\ Studio/2022/*/Common7/Tools/VsDevCmd.bat \
  /mnt/c/Program\ Files\ \(x86\)/Microsoft\ Visual\ Studio/2022/*/Common7/Tools/VsDevCmd.bat \
  || true)"
WINDOWS_CARGO="$(first_existing_file \
  "${GHOSTEX_WINDOWS_CARGO:-}" \
  "$WINDOWS_PROFILE/.cargo/bin/cargo.exe" \
  || true)"
WINDOWS_RUSTUP="$(first_existing_file \
  "${GHOSTEX_WINDOWS_RUSTUP:-}" \
  "$WINDOWS_PROFILE/.cargo/bin/rustup.exe" \
  || true)"
WINDOWS_CMAKE="$(first_existing_file \
  "${GHOSTEX_WINDOWS_CMAKE:-}" \
  "$WINDOWS_TOOLS_ROOT/cmake/cmake-4.4.2-windows-x86_64/bin/cmake.exe" \
  "/mnt/c/Program Files/CMake/bin/cmake.exe" \
  || true)"
WINDOWS_NINJA="$(first_existing_file \
  "${GHOSTEX_WINDOWS_NINJA:-}" \
  "$WINDOWS_TOOLS_ROOT/ninja/ninja.exe" \
  || true)"
WINDOWS_ZIG="$(first_existing_file \
  "${GHOSTEX_WINDOWS_ZIG:-}" \
  "$WINDOWS_TOOLS_ROOT/zig/zig-x86_64-windows-0.15.2/zig.exe" \
  || true)"

for required_name in VS_DEV_CMD WINDOWS_CARGO WINDOWS_RUSTUP WINDOWS_CMAKE WINDOWS_NINJA WINDOWS_ZIG; do
  required_path="${!required_name:-}"
  if [[ -z "$required_path" || ! -f "$required_path" ]]; then
    echo "Required Windows build tool $required_name is unavailable." >&2
    exit 1
  fi
done

if [[ "$($WINDOWS_ZIG version | tr -d '\r')" != "0.15.2" ]]; then
  echo "Ghostex requires Windows Zig 0.15.2 at $WINDOWS_ZIG." >&2
  exit 1
fi

CEF_CACHE="${GHOSTEX_WINDOWS_CEF_PATH:-$GPUI_DIR/build/cef-cache-windows}"
CARGO_OUTPUT_ROOT="${GHOSTEX_WINDOWS_CARGO_TARGET_DIR:-$GPUI_DIR/build/windows-target}"
ZIG_CACHE="${GHOSTEX_WINDOWS_ZIG_CACHE_DIR:-$GPUI_DIR/build/zig-global-cache-windows}"
mkdir -p "$CEF_CACHE" "$CARGO_OUTPUT_ROOT" "$ZIG_CACHE"

# Shared React/CEF resources are platform-independent and build directly in WSL.
(
  cd "$REPO_ROOT"
  bun run build:sidebar-css
  bunx vite build --config "$GPUI_DIR/vite.config.ts"
)

VS_DEV_CMD_WIN="$(wslpath -a -w "$VS_DEV_CMD")"
WINDOWS_CARGO_WIN="$(wslpath -a -w "$WINDOWS_CARGO")"
WINDOWS_RUSTUP_WIN="$(wslpath -a -w "$WINDOWS_RUSTUP")"
WINDOWS_CMAKE_DIR_WIN="$(wslpath -a -w "$(dirname "$WINDOWS_CMAKE")")"
WINDOWS_NINJA_DIR_WIN="$(wslpath -a -w "$(dirname "$WINDOWS_NINJA")")"
WINDOWS_CARGO_DIR_WIN="$(wslpath -a -w "$(dirname "$WINDOWS_CARGO")")"
WINDOWS_ZIG_WIN="$(wslpath -a -w "$WINDOWS_ZIG")"
CEF_CACHE_WIN="$(wslpath -a -w "$CEF_CACHE")"
CARGO_OUTPUT_ROOT_WIN="$(wslpath -a -w "$CARGO_OUTPUT_ROOT")"
ZIG_CACHE_WIN="$(wslpath -a -w "$ZIG_CACHE")"
GPUI_DIR_WIN="$(wslpath -a -w "$GPUI_DIR")"

# A generated batch file is the only reliable quoting boundary here. Passing a
# nested command string through WSL interop preserves literal `\"` characters,
# while separate `set` tokens lose cmd's protective quotes and append the space
# before `&&` to values such as CARGO_TARGET_DIR.
WINDOWS_BUILD_BATCH="$(mktemp "$GPUI_DIR/build/.windows-build.XXXXXX.cmd")"
WINDOWS_BUILD_BATCH_WIN="$(wslpath -a -w "$WINDOWS_BUILD_BATCH")"
cleanup_windows_build_batch() {
  rm -f -- "$WINDOWS_BUILD_BATCH"
}
trap cleanup_windows_build_batch EXIT
printf '%s\r\n' \
  '@echo off' \
  "set \"PATH=$WINDOWS_CARGO_DIR_WIN;$WINDOWS_CMAKE_DIR_WIN;$WINDOWS_NINJA_DIR_WIN;%PATH%\"" \
  "set \"CEF_PATH=$CEF_CACHE_WIN\"" \
  "set \"CARGO_TARGET_DIR=$CARGO_OUTPUT_ROOT_WIN\"" \
  "set \"GHOSTEX_ZIG=$WINDOWS_ZIG_WIN\"" \
  "set \"ZIG_GLOBAL_CACHE_DIR=$ZIG_CACHE_WIN\"" \
  "call \"$VS_DEV_CMD_WIN\" -arch=$VS_ARCH -host_arch=x64 >nul" \
  'if errorlevel 1 exit /b %errorlevel%' \
  "cd /d \"$GPUI_DIR_WIN\"" \
  'if errorlevel 1 exit /b %errorlevel%' \
  "\"$WINDOWS_RUSTUP_WIN\" target add $RUST_TARGET" \
  'if errorlevel 1 exit /b %errorlevel%' \
  "\"$WINDOWS_CARGO_WIN\" build --release --bins --target $RUST_TARGET" \
  'exit /b %errorlevel%' \
  >"$WINDOWS_BUILD_BATCH"
$CMD_EXE /d /c call "$WINDOWS_BUILD_BATCH_WIN"
cleanup_windows_build_batch
trap - EXIT

CEF_RELEASE="$(dirname "$(find "$CEF_CACHE" -type f -iname libcef.dll -print -quit)")"
if [[ -z "$CEF_RELEASE" || ! -f "$CEF_RELEASE/libcef.dll" ]]; then
  echo "cef-rs did not produce libcef.dll under $CEF_CACHE" >&2
  exit 1
fi
CEF_RESOURCES="$CEF_RELEASE"
if [[ ! -f "$CEF_RESOURCES/icudtl.dat" ]]; then
  CEF_RESOURCES="$(dirname "$CEF_RELEASE")/Resources"
fi
CEF_DISTRIBUTION_ROOT="$CEF_RELEASE"
if [[ ! -f "$CEF_DISTRIBUTION_ROOT/include/cef_version.h" ]]; then
  CEF_DISTRIBUTION_ROOT="$(dirname "$CEF_RELEASE")"
fi
CEF_VERSION_HEADER="$CEF_DISTRIBUTION_ROOT/include/cef_version.h"
if [[ ! -f "$CEF_VERSION_HEADER" ]]; then
  echo "Could not locate cef_version.h for $CEF_RELEASE" >&2
  exit 1
fi
CEF_COMPONENT_VERSION="$(sed -n 's/^#define CEF_VERSION "\([^"]*\)"$/\1/p' "$CEF_VERSION_HEADER" | head -n 1 | sed 's/[^A-Za-z0-9._-]/-/g')"
if [[ -z "$CEF_COMPONENT_VERSION" ]]; then
  echo "Could not resolve the CEF component version from $CEF_VERSION_HEADER" >&2
  exit 1
fi
if [[ ! -f "$CEF_RESOURCES/icudtl.dat" ]]; then
  echo "CEF resources with icudtl.dat were not found beside $CEF_RELEASE" >&2
  exit 1
fi

# The directory contains generated staging output only. Keep its inode stable
# so terminals whose cwd points here do not retain a deleted directory handle.
mkdir -p "$APP_DIR"
find "$APP_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +

RUST_RELEASE_DIR="$CARGO_OUTPUT_ROOT/$RUST_TARGET/release"
if [[ "$ON_DEMAND_COMPONENTS" == "1" ]]; then
  cp "$RUST_RELEASE_DIR/ghostex-gpui-cef-bootstrap.exe" "$APP_DIR/Ghostex.exe"
  cp "$RUST_RELEASE_DIR/ghostex-gpui.exe" "$APP_DIR/ghostex-gpui-runtime.exe"
else
  cp "$RUST_RELEASE_DIR/ghostex-gpui.exe" "$APP_DIR/Ghostex.exe"
fi
cp "$RUST_RELEASE_DIR/ghostex-gpui-cef-helper.exe" "$APP_DIR/"
LOCALES_DIR=""
for locale_candidate in "$CEF_RELEASE/locales" "$CEF_RESOURCES/locales"; do
  if [[ -d "$locale_candidate" ]]; then
    LOCALES_DIR="$locale_candidate"
    break
  fi
done
if [[ -z "$LOCALES_DIR" ]]; then
  echo "CEF locales were not found beside $CEF_RELEASE" >&2
  exit 1
fi
if [[ "$ON_DEMAND_COMPONENTS" != "1" ]]; then
  for source_root in "$CEF_RELEASE" "$CEF_RESOURCES"; do
    find "$source_root" -maxdepth 1 -type f \
      \( -iname '*.dll' -o -iname '*.pak' -o -iname '*.dat' -o -iname '*.bin' \) \
      -exec cp -f -- {} "$APP_DIR/" \;
  done
  for swiftshader_icd in "$CEF_RELEASE/vk_swiftshader_icd.json" "$CEF_RESOURCES/vk_swiftshader_icd.json"; do
    if [[ -f "$swiftshader_icd" ]]; then
      cp "$swiftshader_icd" "$APP_DIR/"
      break
    fi
  done
  cp -R "$LOCALES_DIR" "$APP_DIR/locales"
fi
mkdir -p "$APP_DIR/dist"
cp -R "$GPUI_DIR/dist/sidebar" "$APP_DIR/dist/sidebar"

COMPONENT_ROOT="${GHOSTEX_ON_DEMAND_COMPONENT_ROOT:-$REPO_ROOT/build/on-demand-components}"
COMPONENT_ASSET_DIR="${GHOSTEX_ON_DEMAND_COMPONENT_ASSET_DIR:-$COMPONENT_ROOT/assets}"
COMPONENT_MANIFEST="${GHOSTEX_ON_DEMAND_COMPONENTS_MANIFEST:-$COMPONENT_ROOT/components.json}"
if [[ "$ON_DEMAND_COMPONENTS" == "1" ]]; then
  CEF_STAGE="$(mktemp -d "$GPUI_DIR/build/cef-windows-component-XXXXXX")"
  CEF_ASSET="$COMPONENT_ASSET_DIR/cef-$CEF_COMPONENT_VERSION-windows-$RELEASE_ARCH.tar.gz"
  mkdir -p "$COMPONENT_ASSET_DIR"
  for source_root in "$CEF_RELEASE" "$CEF_RESOURCES"; do
    find "$source_root" -maxdepth 1 -type f \
      \( -iname '*.dll' -o -iname '*.pak' -o -iname '*.dat' -o -iname '*.bin' \) \
      -exec cp -f -- {} "$CEF_STAGE/" \;
  done
  for swiftshader_icd in "$CEF_RELEASE/vk_swiftshader_icd.json" "$CEF_RESOURCES/vk_swiftshader_icd.json"; do
    if [[ -f "$swiftshader_icd" ]]; then
      cp "$swiftshader_icd" "$CEF_STAGE/"
      break
    fi
  done
  cp -R "$LOCALES_DIR" "$CEF_STAGE/locales"
  "$REPO_ROOT/scripts/release-gpui/create-deterministic-tar.sh" "$CEF_STAGE" "$CEF_ASSET"
  rm -rf "$CEF_STAGE"
  node "$REPO_ROOT/scripts/release-gpui/publish-component.mjs" \
    --metadata-only \
    --component cef \
    --version "$CEF_COMPONENT_VERSION" \
    --asset-dir "$COMPONENT_ASSET_DIR" \
    --output "$COMPONENT_MANIFEST"
fi

stage_wsl_archive() {
  local source_archive="$1"
  local staged_name="$2"
  local staged_archive="$APP_DIR/resources/wsl/$staged_name"
  if [[ ! -f "$source_archive" ]]; then
    if [[ "${GHOSTEX_WINDOWS_REQUIRE_WSL_RUNTIME:-1}" == "0" ]]; then
      return 0
    fi
    echo "Required WSL runtime archive is missing: $source_archive" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$staged_archive")"
  cp "$source_archive" "$staged_archive"
  sha256sum "$staged_archive" | awk '{print $1}' >"$staged_archive.sha256"
}

WSL_GXSERVER_ARCHIVE="${GHOSTEX_WINDOWS_WSL_GXSERVER_ARCHIVE:-}"
WSL_CODE_SERVER_ARCHIVE="${GHOSTEX_WINDOWS_WSL_CODE_SERVER_ARCHIVE:-}"
# CDXC:T3CodeDisabled ghostex-mzp9: Keep the archive checks ready for a future
# re-enable; Source archives intentionally contain no T3 runtime today.
# if [[ -n "$WSL_CODE_SERVER_ARCHIVE" && -f "$WSL_CODE_SERVER_ARCHIVE" ]]; then
#   WSL_CODE_SERVER_LISTING="$(tar -tzf "$WSL_CODE_SERVER_ARCHIVE")"
#   grep -Eq '(^|/)t3code-server/dist/bin\.mjs$' <<<"$WSL_CODE_SERVER_LISTING"
#   grep -Eq '(^|/)t3code-server/lib/node$' <<<"$WSL_CODE_SERVER_LISTING"
# fi
stage_wsl_archive "$WSL_GXSERVER_ARCHIVE" "gxserver-linux-$RELEASE_ARCH.tar.gz"
if [[ "$ON_DEMAND_COMPONENTS" == "1" ]]; then
  if [[ -z "$WSL_CODE_SERVER_ARCHIVE" || ! -f "$WSL_CODE_SERVER_ARCHIVE" ]]; then
    echo "Required WSL Source archive is missing: $WSL_CODE_SERVER_ARCHIVE" >&2
    exit 1
  fi
  CODE_SERVER_COMMIT="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD:code-server)"
  CODE_SERVER_VERSION="$CODE_SERVER_COMMIT-p1"
  CODE_SERVER_STAGE="$(mktemp -d "$GPUI_DIR/build/code-server-windows-component-XXXXXX")"
  CODE_SERVER_ASSET="$COMPONENT_ASSET_DIR/code-server-$CODE_SERVER_VERSION-windows-$RELEASE_ARCH.tar.gz"
  cp "$WSL_CODE_SERVER_ARCHIVE" "$CODE_SERVER_STAGE/code-server-linux-$RELEASE_ARCH.tar.gz"
  "$REPO_ROOT/scripts/release-gpui/create-deterministic-tar.sh" "$CODE_SERVER_STAGE" "$CODE_SERVER_ASSET"
  rm -rf "$CODE_SERVER_STAGE"
  node "$REPO_ROOT/scripts/release-gpui/publish-component.mjs" \
    --metadata-only \
    --component code-server \
    --version "$CODE_SERVER_VERSION" \
    --asset-dir "$COMPONENT_ASSET_DIR" \
    --output "$COMPONENT_MANIFEST"
  ON_DEMAND_BUILD_MANIFEST="$COMPONENT_ROOT/windows-$RELEASE_ARCH-assets.json"
  node -e 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],JSON.stringify({assets:[],version:process.argv[2]},null,2)+"\n")' \
    "$ON_DEMAND_BUILD_MANIFEST" "$RELEASE_VERSION"
  mkdir -p "$APP_DIR/resources"
  node "$REPO_ROOT/scripts/release-gpui/on-demand-manifest.mjs" seal \
    --build-manifest "$ON_DEMAND_BUILD_MANIFEST" \
    --component-manifest "$COMPONENT_MANIFEST" \
    --output "$APP_DIR/resources/on-demand-resources.json" \
    --repo maddada/Ghostex
else
  stage_wsl_archive "$WSL_CODE_SERVER_ARCHIVE" "code-server-linux-$RELEASE_ARCH.tar.gz"
fi

echo "Staged $APP_DIR"
