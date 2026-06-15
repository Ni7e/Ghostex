#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GPUI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$GPUI_DIR/.." && pwd)"
APP_NAME="GhostexGPUI"
APP_PATH="$GPUI_DIR/build/macos/$APP_NAME.app"
RUN_APP=0

while [[ $# -gt 0 ]]; do
	case "$1" in
		--run)
			RUN_APP=1
			shift
			;;
		*)
			echo "Unknown argument: $1" >&2
			exit 1
			;;
	esac
done

default_macos_arch() {
	if [[ "$(/usr/sbin/sysctl -in hw.optional.arm64 2>/dev/null || true)" == "1" ]]; then
		printf 'arm64\n'
		return
	fi
	uname -m
}

GHOSTEX_MACOS_ARCH="${GHOSTEX_MACOS_ARCH:-$(default_macos_arch)}"
case "$GHOSTEX_MACOS_ARCH" in
	arm64 | aarch64)
		GHOSTEX_MACOS_ARCH="arm64"
		RUST_TARGET_ARCH="aarch64"
		;;
	x86_64 | x64 | amd64)
		GHOSTEX_MACOS_ARCH="x86_64"
		RUST_TARGET_ARCH="x86_64"
		;;
	*)
		echo "Unsupported GHOSTEX_MACOS_ARCH: $GHOSTEX_MACOS_ARCH" >&2
		exit 1
		;;
esac

CEF_CACHE_DIR="$GPUI_DIR/build/cef-cache"
export CEF_PATH="$CEF_CACHE_DIR"

(
	cd "$REPO_ROOT"
	bun run build:sidebar-css
	bunx vite build --config "$GPUI_DIR/vite.config.ts"
)

(
	cd "$GPUI_DIR"
	cargo build --release --bins
)

CEF_FRAMEWORK="$(find "$CEF_CACHE_DIR" -path '*/Chromium Embedded Framework.framework' -type d -print -quit)"
if [[ -z "$CEF_FRAMEWORK" || ! -d "$CEF_FRAMEWORK" ]]; then
	echo "cef-rs did not produce a Chromium Embedded Framework under $CEF_CACHE_DIR" >&2
	exit 1
fi

rm -rf "$APP_PATH"
mkdir -p "$APP_PATH/Contents/MacOS" "$APP_PATH/Contents/Resources" "$APP_PATH/Contents/Frameworks"
cp "$GPUI_DIR/target/release/ghostex-gpui" "$APP_PATH/Contents/MacOS/$APP_NAME"
chmod 755 "$APP_PATH/Contents/MacOS/$APP_NAME"
rsync -a --delete "$CEF_FRAMEWORK" "$APP_PATH/Contents/Frameworks/"
rsync -a --delete "$GPUI_DIR/dist/sidebar/" "$APP_PATH/Contents/Resources/sidebar/"

cat >"$APP_PATH/Contents/Info.plist" <<EOF_PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleExecutable</key>
	<string>$APP_NAME</string>
	<key>CFBundleIdentifier</key>
	<string>com.madda.ghostex.gpui.phase1</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>Ghostex GPUI</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>0.1.0</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>GHOSTEXHomeDirectoryName</key>
	<string>.ghostex-gpui</string>
	<key>GHOSTEXSharedHomeDirectoryName</key>
	<string>.ghostex-gpui</string>
	<key>LSMinimumSystemVersion</key>
	<string>13.0</string>
	<key>NSHighResolutionCapable</key>
	<true/>
</dict>
</plist>
EOF_PLIST

helper_names=(
	"$APP_NAME Helper"
	"$APP_NAME Helper (Alerts)"
	"$APP_NAME Helper (GPU)"
	"$APP_NAME Helper (Plugin)"
	"$APP_NAME Helper (Renderer)"
)

for helper_name in "${helper_names[@]}"; do
	helper_app="$APP_PATH/Contents/Frameworks/$helper_name.app"
	helper_macos="$helper_app/Contents/MacOS"
	mkdir -p "$helper_macos"
	cp "$GPUI_DIR/target/release/ghostex-gpui-cef-helper" "$helper_macos/$helper_name"
	chmod 755 "$helper_macos/$helper_name"
	cat >"$helper_app/Contents/Info.plist" <<EOF_HELPER
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key>
	<string>$helper_name</string>
	<key>CFBundleIdentifier</key>
	<string>com.madda.ghostex.gpui.phase1.$(printf '%s' "$helper_name" | tr ' ()' '---')</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>$helper_name</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>0.1.0</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>LSUIElement</key>
	<string>1</string>
</dict>
</plist>
EOF_HELPER
done

# CDXC:GPUIPhase1 2026-06-14-15:25:
# The phase-1 shell now consumes Tauri's cef-rs CEF distribution instead of Ghostex's production CEF vendor tree. Build with a local CEF_PATH cache so cef-dll-sys downloads the version matching the Rust bindings, then package helper apps named after the GPUI executable because macOS CEF discovers helpers from the main bundle name.

# CDXC:GPUIPhase1 2026-06-14-13:05:
# The prototype rewrites helper app plists and copies the CEF framework into a new local bundle on every build. Re-sign the completed bundle ad hoc so macOS validates the nested helper apps and framework after packaging instead of running stale signatures from the source artifacts.
codesign --force --deep --sign - "$APP_PATH"

# CDXC:GPUIPhase1 2026-06-14-12:06:
# The phase-1 macOS app must be runnable as a real CEF bundle, not only as a Cargo binary. Package the CEF framework, helper apps, React sidebar bundle, and GPUI executable into one local .app so the runtime layout matches the production Chromium embedding contract.
printf 'Built %s for %s (%s)\n' "$APP_PATH" "$GHOSTEX_MACOS_ARCH" "$RUST_TARGET_ARCH"

if [[ "$RUN_APP" == "1" ]]; then
	open -n "$APP_PATH"
fi
