#!/usr/bin/env bash
# CDXC:GPUILinuxX11Backend 2026-07-04:
# Linux packaging skeleton for the GPUI app, mirroring the shape of
# build-windows-app.ps1: build the sidebar bundle, build both Rust binaries,
# then stage a flat CEF-conventional layout. Written best-effort from macOS
# during P3 (Linux X11 bring-up) — NEEDS-DEVICE-VERIFY: never executed on
# real Linux hardware. Deliberately not yet covered here (macOS-script
# parity items to port as Linux support matures): completion sound assets,
# CLI resources, portless admin runtime, remote gxserver packages, updater
# integration, signing, desktop-entry/icon install, and package formats
# (deb/rpm/AppImage/flatpak).
#
# Layout contract (all beside the executable, per CEF Linux conventions —
# libcef.so, its .so companions, .pak/.dat/.bin resources, and locales/ must
# live in the executable directory; the executable reaches libcef.so through
# the $ORIGIN rpath emitted by gpui/build.rs):
#   build/linux/GhostexGPUI/
#     ghostex-gpui
#     ghostex-gpui-cef-helper          <- cef/linux_x11.rs sets this as
#                                         browser_subprocess_path (sibling)
#     libcef.so, libEGL.so, ...        <- CEF Release/ payload
#     icudtl.dat, *.pak, *.bin,
#     locales/                         <- CEF Resources/ payload
#     dist/sidebar/                    <- sidebar bundle; the /dist/sidebar/
#                                         path segment is load-bearing for the
#                                         CEF helper first-party URL check and
#                                         the sidebar_url() Linux arm.
#
# Runtime notes:
# - The app forces X11 app-wide (XWayland on Wayland desktops) and appends
#   --ozone-platform=x11 to Chromium itself (cef/linux_x11.rs); no launcher
#   flags are needed.
# - CEF's SUID chrome-sandbox binary is intentionally not staged: the app
#   initializes CEF with no_sandbox, matching the macOS/Windows builds.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GPUI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$GPUI_DIR/.." && pwd)"
APP_NAME="GhostexGPUI"
APP_DIR="$GPUI_DIR/build/linux/$APP_NAME"

# Same CEF cache location contract as build-macos-app.sh / the Windows
# script: cef-dll-sys's build script downloads the CEF binary distribution
# into CEF_PATH.
export CEF_PATH="$GPUI_DIR/build/cef-cache"

# 1) Sidebar bundle (same steps as the macOS script).
(
  cd "$REPO_ROOT"
  bun run build:sidebar-css
  bunx vite build --config "$GPUI_DIR/vite.config.ts"
)

# 2) Rust binaries (main app + CEF helper). Requires cmake and ninja
# (cef-dll-sys builds libcef_dll_wrapper), plus a Zig 0.15.x for
# libghostty-vt (GHOSTEX_ZIG override honored by gpui/build.rs).
(
  cd "$GPUI_DIR"
  cargo build --release --bins
)

# 3) Locate the extracted CEF distribution (versioned subdirectory created
# by cef-dll-sys under CEF_PATH).
CEF_RELEASE=""
while IFS= read -r candidate; do
  if [[ -f "$candidate/libcef.so" ]]; then
    CEF_RELEASE="$candidate"
    break
  fi
done < <(find "$CEF_PATH" -type d -name Release 2>/dev/null)
if [[ -z "$CEF_RELEASE" ]]; then
  echo "cef-rs did not produce a CEF Release directory with libcef.so under $CEF_PATH" >&2
  exit 1
fi
CEF_RESOURCES="$(dirname "$CEF_RELEASE")/Resources"
if [[ ! -f "$CEF_RESOURCES/icudtl.dat" ]]; then
  echo "CEF Resources directory with icudtl.dat not found at $CEF_RESOURCES" >&2
  exit 1
fi

# 4) Stage the app directory.
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"

cp "$GPUI_DIR/target/release/ghostex-gpui" "$APP_DIR/"
cp "$GPUI_DIR/target/release/ghostex-gpui-cef-helper" "$APP_DIR/"
cp -R "$CEF_RELEASE/." "$APP_DIR/"
cp -R "$CEF_RESOURCES/." "$APP_DIR/"
# no_sandbox runtime: the SUID sandbox helper stays out of the layout.
rm -f "$APP_DIR/chrome-sandbox"
mkdir -p "$APP_DIR/dist"
cp -R "$GPUI_DIR/dist/sidebar" "$APP_DIR/dist/sidebar"

echo "Staged $APP_DIR"
