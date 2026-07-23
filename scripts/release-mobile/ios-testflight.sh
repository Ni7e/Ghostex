#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../release-gpui/common.sh
source "$SCRIPT_DIR/../release-gpui/common.sh"

VERSION="${1:-}"
release_gpui_require_version "$VERSION"
REPO_ROOT="$(release_gpui_repo_root)"
OUTPUT="${2:-$(release_gpui_default_output "$REPO_ROOT" "$VERSION" ios-testflight)}"
BUILD_NUMBER="$(release_gpui_build_number "$VERSION")"
MOBILE_ROOT="$REPO_ROOT/mobile"
BUNDLE_ID="com.maddada.ghostex.ios"
TEAM_ID="KTKP595G3B"

release_gpui_require_command bun
release_gpui_require_command pod
release_gpui_require_command xcodebuild
release_gpui_require_command xcrun
: "${GHOSTEX_IOS_PROFILE_NAME:?Missing installed App Store provisioning profile name}"
: "${APPLE_NOTARY_APPLE_ID:?Missing App Store Connect Apple ID}"
: "${APPLE_NOTARY_APP_PASSWORD:?Missing App Store Connect app-specific password}"

export GHOSTEX_RELEASE_VERSION="$VERSION"
export GHOSTEX_RELEASE_BUILD_NUMBER="$BUILD_NUMBER"

cd "$MOBILE_ROOT"
bunx expo prebuild --platform ios --no-install
pod install --project-directory=ios

ARCHIVE_PATH="$RUNNER_TEMP/Ghostex-$VERSION.xcarchive"
EXPORT_PATH="$RUNNER_TEMP/Ghostex-$VERSION-export"
EXPORT_OPTIONS="$RUNNER_TEMP/Ghostex-$VERSION-ExportOptions.plist"
cat > "$EXPORT_OPTIONS" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>signingStyle</key><string>manual</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>uploadSymbols</key><true/>
  <key>provisioningProfiles</key><dict>
    <key>$BUNDLE_ID</key><string>$GHOSTEX_IOS_PROFILE_NAME</string>
  </dict>
</dict></plist>
PLIST

xcodebuild \
  -workspace ios/Ghostex.xcworkspace \
  -scheme Ghostex \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE_PATH" \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY='Apple Distribution' \
  PROVISIONING_PROFILE_SPECIFIER="$GHOSTEX_IOS_PROFILE_NAME" \
  archive
xcodebuild -exportArchive -archivePath "$ARCHIVE_PATH" -exportPath "$EXPORT_PATH" -exportOptionsPlist "$EXPORT_OPTIONS"

IPA="$(find "$EXPORT_PATH" -maxdepth 1 -type f -name '*.ipa' -print -quit)"
[[ -n "$IPA" ]] || { echo "Xcode did not export an IPA" >&2; exit 1; }
INFO_PLIST="$RUNNER_TEMP/Ghostex-$VERSION-Info.plist"
unzip -p "$IPA" 'Payload/*.app/Info.plist' > "$INFO_PLIST"
ACTUAL_BUNDLE_ID="$(plutil -extract CFBundleIdentifier raw "$INFO_PLIST")"
ACTUAL_VERSION="$(plutil -extract CFBundleShortVersionString raw "$INFO_PLIST")"
ACTUAL_BUILD="$(plutil -extract CFBundleVersion raw "$INFO_PLIST")"
[[ "$ACTUAL_BUNDLE_ID" == "$BUNDLE_ID" ]] || { echo "IPA bundle ID is $ACTUAL_BUNDLE_ID, expected $BUNDLE_ID" >&2; exit 1; }
[[ "$ACTUAL_VERSION" == "$VERSION" ]] || { echo "IPA version is $ACTUAL_VERSION, expected $VERSION" >&2; exit 1; }
[[ "$ACTUAL_BUILD" == "$BUILD_NUMBER" ]] || { echo "IPA build is $ACTUAL_BUILD, expected $BUILD_NUMBER" >&2; exit 1; }

xcrun altool --validate-app --file "$IPA" --type ios --username "$APPLE_NOTARY_APPLE_ID" --password "$APPLE_NOTARY_APP_PASSWORD"
xcrun altool --upload-app --file "$IPA" --type ios --username "$APPLE_NOTARY_APPLE_ID" --password "$APPLE_NOTARY_APP_PASSWORD"

release_gpui_prepare_output "$REPO_ROOT" "$OUTPUT"
cp "$IPA" "$OUTPUT/Ghostex-$VERSION.ipa"
cat > "$OUTPUT/testflight-attestation.json" <<JSON
{
  "build_number": "$BUILD_NUMBER",
  "bundle_id": "$BUNDLE_ID",
  "distribution": "testflight",
  "marketing_version": "$VERSION",
  "status": "uploaded"
}
JSON
echo "Apple accepted Ghostex $VERSION ($BUILD_NUMBER) for TestFlight processing."
