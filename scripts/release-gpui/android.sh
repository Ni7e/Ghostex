#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
REPO_ROOT="$(release_gpui_repo_root)"
VERSION="${1:-}"
OUTPUT="${2:-$(release_gpui_default_output "$REPO_ROOT" "$VERSION" android)}"
release_gpui_require_version "$VERSION"
release_gpui_prepare_output "$REPO_ROOT" "$OUTPUT"

BUILD_NUMBER="$(release_gpui_build_number "$VERSION")"
: "${GHOSTEX_ANDROID_SIGNING_STORE_FILE:?Set GHOSTEX_ANDROID_SIGNING_STORE_FILE to an external release keystore}"
: "${GHOSTEX_ANDROID_SIGNING_STORE_PASSWORD:?Set GHOSTEX_ANDROID_SIGNING_STORE_PASSWORD}"
: "${GHOSTEX_ANDROID_SIGNING_KEY_ALIAS:?Set GHOSTEX_ANDROID_SIGNING_KEY_ALIAS}"
: "${GHOSTEX_ANDROID_SIGNING_KEY_PASSWORD:?Set GHOSTEX_ANDROID_SIGNING_KEY_PASSWORD}"

GHOSTEX_RELEASE_ANDROID_ONLY=1 "$SCRIPT_DIR/prepare-references.sh"
export GHOSTEX_ANDROID_VERSION_NAME="$VERSION"
export GHOSTEX_ANDROID_VERSION_CODE="$BUILD_NUMBER"
export GHOSTEX_ANDROID_APK_VERSION_TAG="v$VERSION"
export GHOSTEX_ANDROID_REQUIRE_RELEASE_SIGNING=1
"$REPO_ROOT/scripts/ghostex-android-release-readiness.sh" --local --skip-mac-check
"$REPO_ROOT/android/tools/ghostex-android-verify-release-signatures.sh"

APK_SOURCE="$(find "$REPO_ROOT/android/app/build/outputs/apk/release" -type f -name "ghostex-android_v${VERSION}_universal.apk" -print -quit)"
[[ -n "$APK_SOURCE" ]] || { echo "Signed universal Android APK was not produced" >&2; exit 1; }
APK="$OUTPUT/ghostex-android.apk"
cp "$APK_SOURCE" "$APK"
release_gpui_write_manifest "$OUTPUT" android "$VERSION" "$APK"
printf 'Built Android release payload in %s\n' "$OUTPUT"
