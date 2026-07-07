#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
EDITOR_ROOT="$REPO_ROOT/editor"
MACOS_PACKAGE="$EDITOR_ROOT/macos"
DIST_DIR="$EDITOR_ROOT/dist"
WEB_DIST="$DIST_DIR/web"
APP_ROOT="$DIST_DIR/GhostexEditor.app"
CONTENTS_DIR="$APP_ROOT/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

cd "$REPO_ROOT"

bun editor/scripts/build-editor-web.mjs

if ! xcrun xcodebuild -version >/dev/null 2>&1; then
  for developer_dir in \
    "/Applications/Xcode.app/Contents/Developer" \
    "/Applications/Xcode-beta.app/Contents/Developer"; do
    if [[ -x "$developer_dir/usr/bin/xcodebuild" ]]; then
      export DEVELOPER_DIR="$developer_dir"
      break
    fi
  done
fi

swift build -c release --package-path "$MACOS_PACKAGE"
BIN_DIR="$(swift build -c release --package-path "$MACOS_PACKAGE" --show-bin-path)"
BUILT_BINARY="$BIN_DIR/GhostexEditor"

if [[ ! -x "$BUILT_BINARY" ]]; then
  echo "GhostexEditor binary was not produced at $BUILT_BINARY" >&2
  exit 1
fi
if [[ ! -f "$WEB_DIST/index.html" ]]; then
  echo "Editor web build did not produce $WEB_DIST/index.html" >&2
  exit 1
fi
if [[ ! -f "$WEB_DIST/monaco/vs/loader.js" ]]; then
  echo "Editor web build did not produce $WEB_DIST/monaco/vs/loader.js" >&2
  exit 1
fi

mkdir -p "$MACOS_DIR" "$RESOURCES_DIR/Web"
install -m 755 "$BUILT_BINARY" "$MACOS_DIR/GhostexEditor"
ditto "$WEB_DIST" "$RESOURCES_DIR/Web"

cat >"$CONTENTS_DIR/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleExecutable</key>
	<string>GhostexEditor</string>
	<key>CFBundleIdentifier</key>
	<string>com.madda.ghostex.host.editor</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>Ghostex Editor</string>
	<key>CFBundleDisplayName</key>
	<string>Ghostex Editor</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>LSMinimumSystemVersion</key>
	<string>13.0</string>
	<key>LSUIElement</key>
	<true/>
	<key>NSHighResolutionCapable</key>
	<true/>
</dict>
</plist>
PLIST

codesign --force --deep --sign - "$APP_ROOT"

echo "Built $APP_ROOT"
