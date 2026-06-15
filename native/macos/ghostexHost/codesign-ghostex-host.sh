#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:-}"
CODE_SIGN_IDENTITY="${GHOSTEX_CODE_SIGN_IDENTITY:--}"
# CDXC:Distribution 2026-04-27-08:37: Notarized Homebrew releases need Apple
# Developer ID signatures with a secure timestamp. Dev builds keep the older
# no-timestamp default unless the release command opts into --timestamp.
CODE_SIGN_TIMESTAMP_FLAG="${GHOSTEX_CODE_SIGN_TIMESTAMP_FLAG:---timestamp=none}"

if [[ -z "$APP_PATH" ]]; then
	echo "Usage: $0 /path/to/ghostex.app" >&2
	exit 2
fi

if [[ ! -d "$APP_PATH" ]]; then
	echo "App bundle does not exist: $APP_PATH" >&2
	exit 1
fi

if [[ -z "$CODE_SIGN_IDENTITY" ]]; then
	cat >&2 <<'EOF'
GHOSTEX_CODE_SIGN_IDENTITY cannot be empty.

Run local development with the default ad-hoc identity, or set:
  GHOSTEX_CODE_SIGN_IDENTITY="Developer ID Application: Name (TEAMID)"
EOF
	exit 1
fi

# CDXC:LocalStart 2026-05-26-08:40: `bun run start` is a local developer
# launch path, not a release signing path. Default to ad-hoc signing so the
# native app and bundled CEF runtime can be re-signed from shells that cannot
# access the Developer ID private key; release automation must opt into
# Developer ID by setting GHOSTEX_CODE_SIGN_IDENTITY explicitly.

echo "Signing $APP_PATH"
echo "Identity: $CODE_SIGN_IDENTITY"

FRAMEWORKS_PATH="$APP_PATH/Contents/Frameworks"
CEF_ENTITLEMENTS="$(mktemp -t ghostex-cef-entitlements.XXXXXX.plist)"
trap 'rm -f "$CEF_ENTITLEMENTS"' EXIT
cat >"$CEF_ENTITLEMENTS" <<'EOF_ENTITLEMENTS'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.cs.allow-jit</key>
	<true/>
	<key>com.apple.security.cs.allow-unsigned-executable-memory</key>
	<true/>
	<key>com.apple.security.cs.disable-library-validation</key>
	<true/>
</dict>
</plist>
EOF_ENTITLEMENTS

can_reuse_local_adhoc_signature() {
	[[ "$CODE_SIGN_IDENTITY" == "-" && "$CODE_SIGN_TIMESTAMP_FLAG" == "--timestamp=none" ]]
}

local_start_signing() {
	[[ "${GHOSTEX_LOCAL_START:-}" == "1" ]]
}

signature_matches_requested_identity() {
	local code_path="$1"
	local signature_details
	signature_details="$(codesign -dv --verbose=4 "$code_path" 2>&1 || true)"
	if [[ "$CODE_SIGN_IDENTITY" == "-" ]]; then
		[[ "$signature_details" == *"Signature=adhoc"* ]]
	elif [[ "$CODE_SIGN_IDENTITY" =~ ^[A-Fa-f0-9]{40}$ ]]; then
		[[ "$signature_details" != *"Signature=adhoc"* && "$signature_details" != *"TeamIdentifier=not set"* ]]
	else
		[[ "$signature_details" == *"Authority=$CODE_SIGN_IDENTITY"* ]]
	fi
}

can_reuse_local_signature() {
	local code_path="$1"
	(local_start_signing || can_reuse_local_adhoc_signature) &&
		codesign --verify --strict "$code_path" >/dev/null 2>&1 &&
		signature_matches_requested_identity "$code_path"
}

has_linker_signed_signature() {
	local code_path="$1"
	local signature_details
	signature_details="$(codesign -dv --verbose=4 "$code_path" 2>&1 || true)"
	[[ "$signature_details" == *linker-signed* ]]
}

requires_v8_runtime_entitlements() {
	local code_path="$1"
	[[ "$code_path" == "$APP_PATH/Contents/Resources/Web/code-server/lib/node" ]]
}

has_v8_runtime_entitlements() {
	local code_path="$1"
	local entitlements
	entitlements="$(codesign -d --entitlements :- "$code_path" 2>/dev/null || true)"
	[[ "$entitlements" == *"<key>com.apple.security.cs.allow-jit</key>"* ]] &&
		[[ "$entitlements" == *"<key>com.apple.security.cs.allow-unsigned-executable-memory</key>"* ]]
}

sign_plain_macho_if_needed() {
	local code_path="$1"
	# CDXC:CodeServerRuntime 2026-06-08-16:14: Release validation executes the app-bundled code-server Node runtime before DMG packaging. Sign Web/code-server/lib/node with the same V8 hardened-runtime entitlements as Chromium helpers so Node can allocate executable memory instead of trapping under Developer ID runtime enforcement.
	# CDXC:LocalStartFast 2026-06-07-16:23: Local ad-hoc starts should not force-sign plain Mach-O payloads that are already valid after incremental copies. Keep Developer ID and entitlement-bearing app/helper signing strict, but skip repeated local signatures for CEF dylibs and bundled tools that already have explicit reusable signatures.
	# CDXC:LocalStartFast 2026-06-07-17:32: Linker-signed Mach-O payloads can pass `codesign --verify` while still being denied when Node loads a bundled native module from the app bundle. Treat linker-signed payloads as unsigned for local starts so the preflight validates the same explicit signature the launched app will use.
	# CDXC:LocalStartFast 2026-06-07-17:40: Keep the linker-signed test in a helper instead of an inline negated pipeline so Bash evaluates the runtime-load blocker as a single boolean before deciding to skip signing.
	# CDXC:LocalStartFast 2026-06-07-17:45: Do not pipe `codesign -dv` into `grep -q` under pipefail; grep can exit before codesign finishes writing and make a real linker-signed payload look reusable. Capture the signature text first so local starts always re-sign runtime-loaded native modules.
	# CDXC:MacOSPermissions 2026-06-16-02:27: Certificate-signed local starts should keep the same fast nested-code reuse behavior as ad-hoc starts, but only when the existing signature already matches the requested identity. Re-sign old ad-hoc nested code once so the outer app keeps a stable Screen Recording TCC requirement across rebuilds.
	if can_reuse_local_signature "$code_path" &&
		! has_linker_signed_signature "$code_path" &&
		(! requires_v8_runtime_entitlements "$code_path" || has_v8_runtime_entitlements "$code_path"); then
		return 0
	fi
	if requires_v8_runtime_entitlements "$code_path"; then
		codesign \
			--force \
			--options runtime \
			--entitlements "$CEF_ENTITLEMENTS" \
			"$CODE_SIGN_TIMESTAMP_FLAG" \
			--sign "$CODE_SIGN_IDENTITY" \
			"$code_path"
	else
		codesign \
			--force \
			--options runtime \
			"$CODE_SIGN_TIMESTAMP_FLAG" \
			--sign "$CODE_SIGN_IDENTITY" \
			"$code_path"
	fi
}

if [[ -d "$FRAMEWORKS_PATH/Chromium Embedded Framework.framework" ]]; then
	# CDXC:ChromiumBrowserPanes 2026-05-04-16:38
	# CEF bundles nested dylibs and helper apps. Sign those concrete code
	# objects before the outer app so Developer ID and notarization validation
	# see a stable Chromium runtime instead of relying only on --deep traversal.
	find "$FRAMEWORKS_PATH/Chromium Embedded Framework.framework/Libraries" \
		-name '*.dylib' \
		-type f \
		-print0 2>/dev/null |
		while IFS= read -r -d '' dylib_path; do
			sign_plain_macho_if_needed "$dylib_path"
		done
	codesign \
		--force \
		--options runtime \
		"$CODE_SIGN_TIMESTAMP_FLAG" \
		--sign "$CODE_SIGN_IDENTITY" \
		"$FRAMEWORKS_PATH/Chromium Embedded Framework.framework"
fi

if [[ -d "$FRAMEWORKS_PATH" ]]; then
	find "$FRAMEWORKS_PATH" \
		-maxdepth 1 \
		-name 'ghostex Helper*.app' \
		-type d \
		-print0 |
		while IFS= read -r -d '' helper_app; do
			helper_name="$(basename "$helper_app" .app)"
			helper_executable="$helper_app/Contents/MacOS/$helper_name"
			if [[ -x "$helper_executable" ]]; then
				# CDXC:ChromiumBrowserPanes 2026-05-04-17:01
				# CEF renderer helpers run V8 JIT under the hardened runtime.
				# Sign helpers with Chromium-safe entitlements, matching the
				# Electrobun reference, so pages and DevTools do not fail with
				# V8 CodeRange reservation errors after Developer ID signing.
				codesign \
					--force \
					--options runtime \
					--entitlements "$CEF_ENTITLEMENTS" \
					"$CODE_SIGN_TIMESTAMP_FLAG" \
					--sign "$CODE_SIGN_IDENTITY" \
					"$helper_executable"
			fi
			codesign \
				--force \
				--options runtime \
				--entitlements "$CEF_ENTITLEMENTS" \
				"$CODE_SIGN_TIMESTAMP_FLAG" \
				--sign "$CODE_SIGN_IDENTITY" \
				"$helper_app"
		done
fi

RESOURCE_BIN_PATH="$APP_PATH/Contents/Resources/Web/bin"
if [[ -d "$RESOURCE_BIN_PATH" ]]; then
	# CDXC:Distribution 2026-05-21-10:39: The release app bundles executable
	# helper tools such as zmx under Web/bin. Notarization validates those
	# Mach-O files independently, so sign them with Developer ID, timestamp, and
	# hardened runtime before signing the outer app bundle.
	find "$RESOURCE_BIN_PATH" \
		-type f \
		-perm -111 \
		-print0 |
		while IFS= read -r -d '' resource_executable; do
			if file "$resource_executable" | grep -q 'Mach-O'; then
				sign_plain_macho_if_needed "$resource_executable"
			fi
	done
fi

sign_nested_resource_code() {
	local resource_path="$1"
	if [[ ! -d "$resource_path" ]]; then
		return 0
	fi

	# CDXC:BetaDistribution 2026-06-06-07:54: The 4.0 beta release bundles server runtimes with nested native Node modules and vendor tools. Apple notarization validates those Mach-O payloads independently, so sign each nested executable, module, dylib, or packaged vendor helper with Developer ID, secure timestamp, and hardened runtime before signing the outer app.
	find "$resource_path" \
		-type f \
		\( -perm -111 -o -name '*.node' -o -name '*.dylib' -o -name 'spawn-helper' \) \
		-print0 |
		while IFS= read -r -d '' resource_code; do
			if file "$resource_code" | grep -q 'Mach-O'; then
				sign_plain_macho_if_needed "$resource_code"
			fi
		done
}

sign_nested_resource_code "$APP_PATH/Contents/Resources/Web/gxserver"
sign_nested_resource_code "$APP_PATH/Contents/Resources/Web/t3code-server"
# CDXC:CodeServerRuntime 2026-06-08-12:17: code-server now carries the app-bundled Node runtime and VS Code native modules under Web/code-server. Sign that resource tree before the outer app so release notarization and local native-module preflights validate the same executable payload gxserver reuses.
sign_nested_resource_code "$APP_PATH/Contents/Resources/Web/code-server"

sign_lid_sleep_helper() {
	local helper_executable="$1"
	if [[ ! -f "$helper_executable" ]]; then
		return 0
	fi
	if ! file "$helper_executable" | grep -q 'Mach-O'; then
		return 0
	fi
	# CDXC:TitlebarKeepAwake 2026-05-29-19:12: The privileged lid-sleep helper must be Developer ID signed with hardened runtime and a secure timestamp before the outer app is signed. Release builds must not ship debug entitlements such as get-task-allow on this Mach-O.
	codesign \
		--force \
		--options runtime \
		"$CODE_SIGN_TIMESTAMP_FLAG" \
		--sign "$CODE_SIGN_IDENTITY" \
		"$helper_executable"
}

LAUNCH_SERVICES_PATH="$APP_PATH/Contents/Library/LaunchServices"
if [[ -n "${GHOSTEX_LID_SLEEP_HELPER_LABEL:-}" ]]; then
	sign_lid_sleep_helper "$LAUNCH_SERVICES_PATH/$GHOSTEX_LID_SLEEP_HELPER_LABEL"
fi
if [[ -d "$LAUNCH_SERVICES_PATH" ]]; then
	# CDXC:TitlebarKeepAwake 2026-05-28-19:28: The bundled lid-sleep helper is a standalone Mach-O that launchd installs as root after user approval. Sign it before the outer app so the helper and app retain a verifiable relationship for runtime authorization.
	find "$LAUNCH_SERVICES_PATH" \
		-type f \
		-perm -111 \
		-print0 |
		while IFS= read -r -d '' helper_executable; do
			sign_lid_sleep_helper "$helper_executable"
		done
fi
RESOURCES_LID_SLEEP_HELPER="$APP_PATH/Contents/Resources/${GHOSTEX_LID_SLEEP_HELPER_LABEL:-}"
if [[ -n "${GHOSTEX_LID_SLEEP_HELPER_LABEL:-}" && -e "$RESOURCES_LID_SLEEP_HELPER" ]]; then
	echo "Unexpected lid sleep helper copy in Contents/Resources. Remove it before signing: $RESOURCES_LID_SLEEP_HELPER" >&2
	exit 1
fi

codesign \
	--force \
	--deep \
	--options runtime \
	--entitlements "$CEF_ENTITLEMENTS" \
	"$CODE_SIGN_TIMESTAMP_FLAG" \
	--sign "$CODE_SIGN_IDENTITY" \
	"$APP_PATH"

codesign --verify --deep --strict --verbose=2 "$APP_PATH"
