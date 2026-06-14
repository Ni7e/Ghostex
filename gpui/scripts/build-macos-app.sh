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

CEF_ROOT="$REPO_ROOT/native/macos/ghostexHost/Vendor/cef-$GHOSTEX_MACOS_ARCH"
CEF_HELPER="$REPO_ROOT/native/macos/ghostexHost/build/cef-$GHOSTEX_MACOS_ARCH/ghostex-cef-helper"

if [[ ! -f "$CEF_ROOT/build/libcef_dll_wrapper/libcef_dll_wrapper.a" || ! -x "$CEF_HELPER" ]]; then
	echo "CEF artifacts are missing; preparing vendored CEF for $GHOSTEX_MACOS_ARCH..." >&2
	GHOSTEX_MACOS_ARCH="$GHOSTEX_MACOS_ARCH" "$REPO_ROOT/native/macos/ghostexHost/vendor-cef.sh" >/dev/null
fi

(
	cd "$REPO_ROOT"
	bun run build:sidebar-css
	bunx vite build --config "$GPUI_DIR/vite.config.ts"
)

(
	cd "$GPUI_DIR"
	cargo build --release
)

rm -rf "$APP_PATH"
mkdir -p "$APP_PATH/Contents/MacOS" "$APP_PATH/Contents/Resources" "$APP_PATH/Contents/Frameworks"
cp "$GPUI_DIR/target/release/ghostex-gpui" "$APP_PATH/Contents/MacOS/$APP_NAME"
chmod 755 "$APP_PATH/Contents/MacOS/$APP_NAME"
rsync -a --delete "$CEF_ROOT/Release/Chromium Embedded Framework.framework" "$APP_PATH/Contents/Frameworks/"
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
	"ghostex Helper"
	"ghostex Helper (Alerts)"
	"ghostex Helper (GPU)"
	"ghostex Helper (Plugin)"
	"ghostex Helper (Renderer)"
)

for helper_name in "${helper_names[@]}"; do
	helper_app="$APP_PATH/Contents/Frameworks/$helper_name.app"
	helper_macos="$helper_app/Contents/MacOS"
	mkdir -p "$helper_macos"
	cp "$CEF_HELPER" "$helper_macos/$helper_name"
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
	<key>LSBackgroundOnly</key>
	<true/>
</dict>
</plist>
EOF_HELPER
done

# CDXC:GPUIPhase1 2026-06-14-13:05:
# The prototype rewrites helper app plists and copies the CEF framework into a new local bundle on every build. Re-sign the completed bundle ad hoc so macOS validates the nested helper apps and framework after packaging instead of running stale signatures from the source artifacts.
codesign --force --deep --sign - "$APP_PATH"

# CDXC:GPUIPhase1 2026-06-14-12:06:
# The phase-1 macOS app must be runnable as a real CEF bundle, not only as a Cargo binary. Package the CEF framework, helper apps, React sidebar bundle, and GPUI executable into one local .app so the runtime layout matches the production Chromium embedding contract.
printf 'Built %s for %s (%s)\n' "$APP_PATH" "$GHOSTEX_MACOS_ARCH" "$RUST_TARGET_ARCH"

if [[ "$RUN_APP" == "1" ]]; then
	open -n "$APP_PATH"
fi
