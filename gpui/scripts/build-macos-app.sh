#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GPUI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$GPUI_DIR/.." && pwd)"
APP_NAME="GhostexGPUI"
APP_PATH="$GPUI_DIR/build/macos/$APP_NAME.app"
RUN_APP=0
SOUND_SRC_DIR="$REPO_ROOT/media/sounds"
SOUND_DEST_DIR="$APP_PATH/Contents/Resources/sidebar/sounds"
CLI_DIR="$APP_PATH/Contents/Resources/CLI"
WEB_DIR="$APP_PATH/Contents/Resources/Web"
WEB_SOURCE_DIR="$REPO_ROOT/native/macos/ghostexHost/Web"
GHOSTEX_REMOTE_GXSERVER_LINUX_X64_DEFAULT_PACKAGE="$REPO_ROOT/build/remote-gxserver-linux/x64/package"
GHOSTEX_REMOTE_GXSERVER_LINUX_ARM64_DEFAULT_PACKAGE="$REPO_ROOT/build/remote-gxserver-linux/arm64/package"
GHOSTEX_REMOTE_GXSERVER_LINUX_X64_STAGED_PACKAGE="$WEB_SOURCE_DIR/gxserver-linux-x64"
GHOSTEX_REMOTE_GXSERVER_LINUX_ARM64_STAGED_PACKAGE="$WEB_SOURCE_DIR/gxserver-linux-arm64"
GHOSTEX_REMOTE_GXSERVER_LINUX_X64_PACKAGE="${GHOSTEX_REMOTE_GXSERVER_LINUX_X64_PACKAGE:-}"
GHOSTEX_REMOTE_GXSERVER_LINUX_ARM64_PACKAGE="${GHOSTEX_REMOTE_GXSERVER_LINUX_ARM64_PACKAGE:-}"
GHOSTEX_REQUIRE_REMOTE_GXSERVER_LINUX_PACKAGES="${GHOSTEX_REQUIRE_REMOTE_GXSERVER_LINUX_PACKAGES:-0}"
case "$(printf '%s' "$GHOSTEX_REQUIRE_REMOTE_GXSERVER_LINUX_PACKAGES" | tr '[:upper:]' '[:lower:]')" in
	1 | true | yes | on)
		GHOSTEX_REQUIRE_REMOTE_GXSERVER_LINUX_PACKAGES=1
		;;
	*)
		GHOSTEX_REQUIRE_REMOTE_GXSERVER_LINUX_PACKAGES=0
		;;
esac

# CDXC:GPUISettingsSounds 2026-06-24-12:10:
# Packaged GPUI Settings must preview completion sounds and run test-agent-completion from the same trusted bundle path used by the runtime lookup. Keep the packaged asset set explicit and copy only repository-owned MP3s into Contents/Resources/sidebar/sounds so React-provided values cannot expand playback to arbitrary paths.
completion_sound_assets=(
	arcade.mp3
	arcadeboost.mp3
	coin-collect.mp3
	confirmation-001.mp3
	confirmation-002.mp3
	confirmation-003.mp3
	confirmation-004.mp3
	flawless-victory.mp3
	glass.mp3
	glimmer.mp3
	high-down.mp3
	high-up.mp3
	low-three-tone.mp3
	notification-pop.mp3
	phaser-up-5.mp3
	ping.mp3
	pingdouble.mp3
	power-up-5.mp3
	power-up-6.mp3
	power-up-8.mp3
	shamisen.mp3
	shamisenreverb.mp3
	success-chime.mp3
	three-tone-1.mp3
	three-tone-2.mp3
	tone-1.mp3
	two-tone-1.mp3
	two-tone-2.mp3
	voiceover-pack-female-congratulations.mp3
	voiceover-pack-female-mission-completed.mp3
	voiceover-pack-male-mission-completed.mp3
	voiceover-pack-male-you-win.mp3
	zap-two-tone.mp3
)

bundled_cli_skill_assets=(
	ghostex-browser-use
	ghostex-computer-use
	ghostex-agent-orchestration
	ghostex-generate-title
	ghostex-manage-beads
)

validate_completion_sound_assets() {
	local missing=0
	local asset

	if [[ ! -d "$SOUND_SRC_DIR" ]]; then
		echo "Missing GPUI completion sound source directory: $SOUND_SRC_DIR" >&2
		exit 1
	fi

	for asset in "${completion_sound_assets[@]}"; do
		if [[ ! -f "$SOUND_SRC_DIR/$asset" ]]; then
			echo "Missing GPUI completion sound asset: $SOUND_SRC_DIR/$asset" >&2
			missing=1
		fi
	done

	if [[ "$missing" == "1" ]]; then
		exit 1
	fi
}

validate_cli_resources() {
	local missing=0
	local skill_name

	if [[ ! -f "$REPO_ROOT/scripts/ghostex-cli.mjs" ]]; then
		echo "Missing GPUI CLI module: $REPO_ROOT/scripts/ghostex-cli.mjs" >&2
		missing=1
	fi
	if [[ ! -f "$REPO_ROOT/scripts/ghostex-cli-launcher.sh" ]]; then
		echo "Missing GPUI CLI launcher: $REPO_ROOT/scripts/ghostex-cli-launcher.sh" >&2
		missing=1
	fi

	for skill_name in "${bundled_cli_skill_assets[@]}"; do
		if [[ ! -f "$REPO_ROOT/skills/$skill_name/SKILL.md" ]]; then
			echo "Missing GPUI bundled CLI skill: $REPO_ROOT/skills/$skill_name/SKILL.md" >&2
			missing=1
		fi
	done

	if [[ "$missing" == "1" ]]; then
		exit 1
	fi
}

validate_portless_admin_runtime_resources() {
	local missing=0

	# CDXC:GPUIPortlessAdminRuntime 2026-06-24-14:28:
	# GPUI privileged Portless setup actions must use the same bundled Web/code-server Node and Web/portless CLI payload as the reviewed macOS helper. Package only those native-staged runtime resources into Contents/Resources/Web and fail packaging when they are absent instead of resolving user PATH, global npm, gxserver-rs, or source checkout commands at runtime.
	if [[ ! -x "$WEB_SOURCE_DIR/code-server/lib/node" ]]; then
		echo "Missing GPUI Portless admin Node runtime: $WEB_SOURCE_DIR/code-server/lib/node" >&2
		missing=1
	fi
	if [[ ! -f "$WEB_SOURCE_DIR/portless/dist/cli.js" ]]; then
		echo "Missing GPUI Portless CLI payload: $WEB_SOURCE_DIR/portless/dist/cli.js" >&2
		missing=1
	fi

	if [[ "$missing" == "1" ]]; then
		exit 1
	fi
}

validate_remote_gxserver_linux_package() {
	local package_dir="$1"
	local package_label="$2"
	local required_path file_output

	for required_path in \
		"bin/gxserver" \
		"bin/zmx" \
		"bin/zehn" \
		"bin/bd" \
		"code-server/lib/node" \
		"portless/dist/cli.js"; do
		if [[ ! -e "$package_dir/$required_path" ]]; then
			echo "Remote gxserver $package_label package is missing required resource: $required_path" >&2
			return 1
		fi
	done

	if [[ ! -f "$package_dir/CLI/ghostex-cli.mjs" && ! -f "$package_dir/cli/ghostex-cli.mjs" ]]; then
		echo "Remote gxserver $package_label package is missing Ghostex CLI entrypoint: CLI/ghostex-cli.mjs" >&2
		return 1
	fi

	for required_path in \
		"bin/gxserver" \
		"bin/zmx" \
		"bin/zehn" \
		"bin/bd" \
		"code-server/lib/node"; do
		file_output="$(file "$package_dir/$required_path")"
		if [[ "$file_output" == *"Mach-O"* ]]; then
			echo "Remote gxserver $package_label package contains a macOS binary at $required_path; Linux packages must not ship Mach-O payloads." >&2
			return 1
		fi
		if [[ "$file_output" != *"ELF"* ]]; then
			echo "Remote gxserver $package_label package must contain a native Linux ELF payload at $required_path." >&2
			return 1
		fi
		case "$package_label" in
			LINUX_X64)
				if [[ "$file_output" != *"x86-64"* && "$file_output" != *"x86_64"* ]]; then
					echo "Remote gxserver $package_label package has the wrong Linux ELF architecture at $required_path." >&2
					return 1
				fi
				;;
			LINUX_ARM64)
				if [[ "$file_output" != *"aarch64"* && "$file_output" != *"AArch64"* ]]; then
					echo "Remote gxserver $package_label package has the wrong Linux ELF architecture at $required_path." >&2
					return 1
				fi
				;;
		esac
	done
}

resolve_remote_gxserver_linux_package_source() {
	local configured_source="$1"
	local default_source="$2"
	local staged_source="$3"
	if [[ -n "$configured_source" ]]; then
		printf '%s\n' "$configured_source"
	elif [[ -d "$default_source" ]]; then
		printf '%s\n' "$default_source"
	elif [[ -d "$staged_source" ]]; then
		printf '%s\n' "$staged_source"
	fi
	return 0
}

stage_remote_gxserver_linux_package_if_available() {
	local configured_source="$1"
	local target_name="$2"
	local package_label="$3"
	local default_source="$4"
	local staged_source="$5"
	local source_dir target_dir

	source_dir="$(resolve_remote_gxserver_linux_package_source "$configured_source" "$default_source" "$staged_source")"
	target_dir="$WEB_DIR/$target_name"
	if [[ -z "$source_dir" ]]; then
		if [[ "$GHOSTEX_REQUIRE_REMOTE_GXSERVER_LINUX_PACKAGES" == "1" ]]; then
			echo "Missing $package_label remote gxserver package. Set GHOSTEX_REMOTE_GXSERVER_${package_label}_PACKAGE to a prebuilt Linux package directory." >&2
			exit 1
		fi
		return 0
	fi
	if [[ ! -d "$source_dir" ]]; then
		echo "Configured $package_label remote gxserver package is not a directory." >&2
		exit 1
	fi
	validate_remote_gxserver_linux_package "$source_dir" "$package_label" || exit 1
	# CDXC:GPUIRemoteMachines 2026-06-24-20:08:
	# GPUI remote gxserver install parity may stage only explicit prebuilt Linux packages into Contents/Resources/Web. Validate required gxserver/zmx/zehn/bd/Node/Portless/CLI resources and reject Mach-O or wrong-architecture payloads before copying, so runtime install never falls back to source checkout paths or uploads a host macOS package to Linux.
	rm -rf "$target_dir"
	mkdir -p "$target_dir"
	rsync -a --delete "$source_dir"/ "$target_dir"/
}

stage_remote_gxserver_linux_packages_if_available() {
	stage_remote_gxserver_linux_package_if_available "$GHOSTEX_REMOTE_GXSERVER_LINUX_X64_PACKAGE" "gxserver-linux-x64" "LINUX_X64" "$GHOSTEX_REMOTE_GXSERVER_LINUX_X64_DEFAULT_PACKAGE" "$GHOSTEX_REMOTE_GXSERVER_LINUX_X64_STAGED_PACKAGE"
	stage_remote_gxserver_linux_package_if_available "$GHOSTEX_REMOTE_GXSERVER_LINUX_ARM64_PACKAGE" "gxserver-linux-arm64" "LINUX_ARM64" "$GHOSTEX_REMOTE_GXSERVER_LINUX_ARM64_DEFAULT_PACKAGE" "$GHOSTEX_REMOTE_GXSERVER_LINUX_ARM64_STAGED_PACKAGE"
}

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

validate_completion_sound_assets
validate_cli_resources
validate_portless_admin_runtime_resources

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
rm -rf "$SOUND_DEST_DIR"
mkdir -p "$SOUND_DEST_DIR"
for asset in "${completion_sound_assets[@]}"; do
	install -m 0644 "$SOUND_SRC_DIR/$asset" "$SOUND_DEST_DIR/$asset"
done

# CDXC:GPUISettingsCliInstall 2026-06-24-12:56:
# GPUI Settings CLI repair may only link public wrappers to app-owned bundled resources. Stage the Node CLI module, public ghostex/gx launchers, and bundled Ghostex skills under Contents/Resources/CLI so packaged repairs and fixed `ghostex ... install-skill` actions do not depend on a source checkout.
rm -rf "$CLI_DIR"
mkdir -p "$CLI_DIR/skills"
install -m 0644 "$REPO_ROOT/scripts/ghostex-cli.mjs" "$CLI_DIR/ghostex-cli.mjs"
install -m 0755 "$REPO_ROOT/scripts/ghostex-cli-launcher.sh" "$CLI_DIR/ghostex"
install -m 0755 "$REPO_ROOT/scripts/ghostex-cli-launcher.sh" "$CLI_DIR/gx"
copy_cli_skill() {
	local skill_name="$1"
	mkdir -p "$CLI_DIR/skills/$skill_name"
	cp -R "$REPO_ROOT/skills/$skill_name/." "$CLI_DIR/skills/$skill_name/"
}
for skill_name in "${bundled_cli_skill_assets[@]}"; do
	copy_cli_skill "$skill_name"
done

# CDXC:GPUIPortlessAdminRuntime 2026-06-24-14:28:
# Stage the fixed privileged Portless runtime beside the GPUI app resources so Settings/setup admin actions never depend on developer-local Node, npm, source checkout paths, or gxserver-rs. Portless continues to reuse Web/code-server/lib/node and must not carry a second Node runtime.
rm -rf "$WEB_DIR/code-server" "$WEB_DIR/portless"
mkdir -p "$WEB_DIR/code-server/lib" "$WEB_DIR/portless"
install -m 0755 "$WEB_SOURCE_DIR/code-server/lib/node" "$WEB_DIR/code-server/lib/node"
rsync -a --delete "$WEB_SOURCE_DIR/portless/" "$WEB_DIR/portless/"
chmod 755 "$WEB_DIR/portless/dist/cli.js"
stage_remote_gxserver_linux_packages_if_available

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
	<!-- CDXC:GPUIOSIntegration 2026-06-24-13:15:
	GPUI packaging must mirror the Swift app Launch Services declarations so Settings can report the packaged app as an available editor, script handler, and ghostex:// target.
	Use LSHandlerRank Alternate here because app installation should only register GPUI as a candidate handler; explicit Settings actions own default-setting mutations.
	Helper app plists intentionally omit these declarations because only the main app bundle should register document and URL handling.
	-->
	<key>CFBundleDocumentTypes</key>
	<array>
		<dict>
			<key>CFBundleTypeExtensions</key>
			<array>
				<string>*</string>
			</array>
			<key>CFBundleTypeName</key>
			<string>Editable Files</string>
			<key>CFBundleTypeRole</key>
			<string>Editor</string>
			<key>LSHandlerRank</key>
			<string>Alternate</string>
			<key>LSItemContentTypes</key>
			<array>
				<string>public.text</string>
				<string>public.source-code</string>
				<string>public.script</string>
				<string>public.data</string>
			</array>
		</dict>
		<dict>
			<key>CFBundleTypeExtensions</key>
			<array>
				<string>command</string>
				<string>tool</string>
				<string>sh</string>
			</array>
			<key>CFBundleTypeName</key>
			<string>Script Files</string>
			<key>CFBundleTypeRole</key>
			<string>Shell</string>
			<key>LSHandlerRank</key>
			<string>Alternate</string>
			<key>LSItemContentTypes</key>
			<array>
				<string>public.shell-script</string>
				<string>public.unix-executable</string>
			</array>
		</dict>
	</array>
	<key>CFBundleURLTypes</key>
	<array>
		<dict>
			<key>CFBundleURLName</key>
			<string>Ghostex URL</string>
			<key>CFBundleURLSchemes</key>
			<array>
				<string>ghostex</string>
			</array>
		</dict>
	</array>
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
