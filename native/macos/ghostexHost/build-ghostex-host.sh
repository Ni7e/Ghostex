#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_PATH="$SCRIPT_DIR/ghostex.xcodeproj"
CONFIGURATION="${CONFIGURATION:-Debug}"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
WEB_DIR="$SCRIPT_DIR/Web"
CLI_DIR="$SCRIPT_DIR/CLI"
GHOSTTY_ROOT="${GHOSTTY_ROOT:-}"
ZMX_ROOT="${ZMX_ROOT:-$REPO_ROOT/zmx}"
ZEHN_ROOT="${ZEHN_ROOT:-$REPO_ROOT/zehn}"
GXSERVER_RS_ROOT="${GXSERVER_RS_ROOT:-$REPO_ROOT/gxserver-rs}"
BEADS_ROOT="${BEADS_ROOT:-${GHOSTEX_BEADS_ROOT:-}}"
TUI_ROOT="${TUI_ROOT:-$REPO_ROOT/tui}"
CODE_SERVER_ROOT="${CODE_SERVER_ROOT:-${GHOSTEX_CODE_SERVER_ROOT:-$REPO_ROOT/code-server}}"
CODE_SERVER_APP_NODE_VERSION="${CODE_SERVER_APP_NODE_VERSION:-}"
if [[ -z "$CODE_SERVER_APP_NODE_VERSION" && -f "$CODE_SERVER_ROOT/.node-version" ]]; then
	CODE_SERVER_APP_NODE_VERSION="$(tr -d '[:space:]' <"$CODE_SERVER_ROOT/.node-version")"
fi
CODE_SERVER_APP_NODE_VERSION="${CODE_SERVER_APP_NODE_VERSION:-22.22.1}"
CODE_SERVER_APP_NODE_MAJOR="${CODE_SERVER_APP_NODE_VERSION%%.*}"
CODE_SERVER_NODE_DOWNLOAD_BASE_URL="https://nodejs.org/dist/v$CODE_SERVER_APP_NODE_VERSION"
GHOSTEX_APP_VARIANT="${GHOSTEX_APP_VARIANT:-prod}"
case "$GHOSTEX_APP_VARIANT" in
	prod)
		;;
	dev)
		# CDXC:LocalStartSingleApp 2026-06-09-09:27: Ghostex-dev builds were removed because agents were invoking the dev app path by mistake. Fail before toolchain checks or Xcode generation so direct build commands cannot create Ghostex-dev outside `bun run start`.
		echo "Ghostex-dev builds were removed. Use GHOSTEX_APP_VARIANT=prod or unset it." >&2
		exit 1
		;;
	*)
		echo "Unsupported GHOSTEX_APP_VARIANT: $GHOSTEX_APP_VARIANT" >&2
		exit 1
		;;
esac

# CDXC:LocalStartArchitecture 2026-06-08-08:42: Apple Silicon local builds must produce Apple-native app resources even when the caller's shell is translated by Rosetta and `uname -m` reports x86_64. Use the physical arm64 capability as the default and keep GHOSTEX_MACOS_ARCH=x86_64 as the explicit Intel build path.
default_macos_arch() {
	if [[ "$(/usr/sbin/sysctl -in hw.optional.arm64 2>/dev/null || true)" == "1" ]]; then
		printf 'arm64\n'
		return 0
	fi
	uname -m
}

GHOSTEX_MACOS_ARCH="${GHOSTEX_MACOS_ARCH:-$(default_macos_arch)}"
case "$GHOSTEX_MACOS_ARCH" in
	arm64 | aarch64)
		GHOSTEX_MACOS_ARCH="arm64"
		;;
	x86_64 | x64 | amd64)
		GHOSTEX_MACOS_ARCH="x86_64"
		;;
	*)
		echo "Unsupported GHOSTEX_MACOS_ARCH: $GHOSTEX_MACOS_ARCH" >&2
		exit 1
		;;
esac
BUILD_CACHE_DIR="${GHOSTEX_BUILD_CACHE_DIR:-$REPO_ROOT/build/$GHOSTEX_MACOS_ARCH/build-cache}"

acquire_local_start_lock_if_needed() {
	if [[ "${GHOSTEX_START_LOCK_HELD:-}" == "1" || "${GHOSTEX_BUILD_LOCK_HELD:-}" == "1" ]]; then
		return 0
	fi
	local lock_file="$REPO_ROOT/build/ghostex-local-start.lock"
	mkdir -p "$(dirname "$lock_file")"
	# CDXC:LocalStartConcurrency 2026-06-11-18:59: Direct native builds mutate the same DerivedData app bundle that `bun run start` later mirrors into /Applications. Re-enter under the local-start lock unless the launcher already owns it, so a direct build cannot remove generated CEF payloads while another process installs the signed app.
	exec /usr/bin/lockf -k "$lock_file" /usr/bin/env GHOSTEX_BUILD_LOCK_HELD=1 /bin/bash "$0" "$@"
}

acquire_local_start_lock_if_needed "$@"

# CDXC:LocalStartFast 2026-06-07-16:23: Local starts should rebuild expensive bundled resources only when their runtime inputs change. Store content-hash stamps under build/<arch> so repeated `bun run start` calls do not churn source files or rely on generated folders that may be deleted by other build steps.
fingerprint_inputs() {
	"${GXSERVER_NODE_BIN:-node}" "$REPO_ROOT/scripts/fingerprint-build-inputs.mjs" "$@"
}

cache_stamp_path() {
	printf '%s/%s.sha256\n' "$BUILD_CACHE_DIR" "$1"
}

cache_matches() {
	local key="$1"
	local digest="$2"
	shift 2
	local stamp
	stamp="$(cache_stamp_path "$key")"
	if [[ ! -f "$stamp" || "$(<"$stamp")" != "$digest" ]]; then
		return 1
	fi
	local output_path
	for output_path in "$@"; do
		if [[ ! -e "$output_path" ]]; then
			return 1
		fi
	done
	return 0
}

write_cache_stamp() {
	local key="$1"
	local digest="$2"
	mkdir -p "$BUILD_CACHE_DIR"
	printf '%s\n' "$digest" >"$(cache_stamp_path "$key")"
}

binary_supports_macos_arch() {
	local binary_path="$1"
	local expected_arch="$2"
	local archs
	if [[ ! -f "$binary_path" ]]; then
		return 1
	fi
	archs="$(/usr/bin/lipo -archs "$binary_path" 2>/dev/null || true)"
	for arch in $archs; do
		if [[ "$arch" == "$expected_arch" ]]; then
			return 0
		fi
	done
	return 1
}

node_pty_prebuild_platform_dir() {
	case "$GHOSTEX_MACOS_ARCH" in
		arm64)
			printf 'darwin-arm64\n'
			;;
		x86_64)
			printf 'darwin-x64\n'
			;;
	esac
}

prune_node_pty_prebuilds() {
	local root="$1"
	local keep_platform prebuilds_dir platform_dir
	keep_platform="$(node_pty_prebuild_platform_dir)"
	if [[ ! -d "$root" ]]; then
		return 0
	fi
	# CDXC:ReleaseBundleSize 2026-06-08-19:49: macOS DMGs are built per architecture, so bundled app resources must keep only the matching node-pty darwin prebuild. Prune Windows/Linux and opposite-arch prebuild directories from generated code-server and T3 Code payloads to reduce download size without changing runtime behavior.
	while IFS= read -r -d '' prebuilds_dir; do
		while IFS= read -r -d '' platform_dir; do
			if [[ "$(basename "$platform_dir")" != "$keep_platform" ]]; then
				rm -rf "$platform_dir"
			fi
		done < <(find "$prebuilds_dir" -mindepth 1 -maxdepth 1 -type d -print0)
	done < <(find "$root" -path '*/node_modules/node-pty/prebuilds' -type d -print0)
}

node_pty_prebuilds_match_arch() {
	local root="$1"
	local keep_platform prebuilds_dir platform_dir
	keep_platform="$(node_pty_prebuild_platform_dir)"
	if [[ ! -d "$root" ]]; then
		return 1
	fi
	while IFS= read -r -d '' prebuilds_dir; do
		if [[ ! -d "$prebuilds_dir/$keep_platform" ]]; then
			return 1
		fi
		while IFS= read -r -d '' platform_dir; do
			if [[ "$(basename "$platform_dir")" != "$keep_platform" ]]; then
				return 1
			fi
		done < <(find "$prebuilds_dir" -mindepth 1 -maxdepth 1 -type d -print0)
	done < <(find "$root" -path '*/node_modules/node-pty/prebuilds' -type d -print0)
	return 0
}

remove_t3code_source_maps() {
	local target_dir="$1"
	if [[ ! -d "$target_dir" ]]; then
		return 0
	fi
	# CDXC:T3CodePackaging 2026-06-08-19:49: Release app bundles should not carry T3 Code source maps. They add installed size and download weight while the shipped server only needs compiled JS and production dependencies.
	find "$target_dir" -type f -name '*.map' -exec rm -f {} +
}

write_gxserver_shared_bd_launcher() {
	local launcher_path="$1"
	mkdir -p "$(dirname "$launcher_path")"
	# CDXC:ReleaseBundleSize 2026-06-08-19:49: Ghostex already ships the arch-specific Beads CLI once at Web/bin/bd. Keep gxserver's historical bin/bd entry as a tiny launcher to that shared app resource so Project board commands keep working without bundling the 127 MB bd binary twice.
	cat >"$launcher_path" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP_BD="$HERE/../../bin/bd"
exec "$APP_BD" "$@"
EOF
	chmod 755 "$launcher_path"
}

path_identity() {
	local candidate="$1"
	if [[ -e "$candidate" ]]; then
		stat -f '%m:%z:%N' "$candidate"
	else
		printf 'missing:%s\n' "$candidate"
	fi
}

code_server_node_distribution_arch() {
	case "$GHOSTEX_MACOS_ARCH" in
		arm64)
			printf 'arm64\n'
			;;
		x86_64)
			printf 'x64\n'
			;;
	esac
}

code_server_node_distribution_sha256() {
	local distribution_arch="$1"
	if [[ "$CODE_SERVER_APP_NODE_VERSION" == "22.22.1" ]]; then
		case "$distribution_arch" in
			arm64)
				printf '261da057fb25ff2912dd6abb7842fc915ddf7947a2cb3c8cce90875d2b9bb667\n'
				return 0
				;;
			x64)
				printf '91227fa5a3bfd988be1953c0384ceb98bd69a6a377a7416c40eb39779d6ab17f\n'
				return 0
				;;
		esac
	fi
	echo "Unsupported code-server Node distribution: v$CODE_SERVER_APP_NODE_VERSION darwin-$distribution_arch" >&2
	echo "Update code_server_node_distribution_sha256 before changing code-server/.node-version." >&2
	return 1
}

verify_sha256_file() {
	local file_path="$1"
	local expected_sha256="$2"
	local actual_sha256
	actual_sha256="$(shasum -a 256 "$file_path" | awk '{print $1}')"
	[[ "$actual_sha256" == "$expected_sha256" ]]
}

prepare_code_server_app_node_runtime() {
	local distribution_arch package_name cache_root extract_root tarball_path expected_sha256 node_bin
	distribution_arch="$(code_server_node_distribution_arch)"
	package_name="node-v$CODE_SERVER_APP_NODE_VERSION-darwin-$distribution_arch"
	cache_root="$BUILD_CACHE_DIR/code-server-node-runtime"
	extract_root="$cache_root/$package_name"
	tarball_path="$cache_root/$package_name.tar.xz"
	expected_sha256="$(code_server_node_distribution_sha256 "$distribution_arch")"
	node_bin="$extract_root/bin/node"

	# CDXC:CodeServerRuntime 2026-06-08-12:17: code-server owns Ghostex's app-bundled Node runtime. Cache the official per-architecture Node 22 distribution for build-time npm/node-gyp work, then stage the executable inside Web/code-server/lib/node so gxserver and code-server share one bundled Node instead of shipping duplicate runtimes.
	if [[ -x "$node_bin" ]] &&
		"$node_bin" -e "process.exit(process.versions.node === '$CODE_SERVER_APP_NODE_VERSION' ? 0 : 1)" >/dev/null 2>&1 &&
		binary_supports_macos_arch "$node_bin" "$GHOSTEX_MACOS_ARCH"; then
		printf '%s\n' "$node_bin"
		return 0
	fi

	mkdir -p "$cache_root"
	if [[ ! -f "$tarball_path" ]] || ! verify_sha256_file "$tarball_path" "$expected_sha256"; then
		echo "Downloading Node $CODE_SERVER_APP_NODE_VERSION for $GHOSTEX_MACOS_ARCH code-server runtime..." >&2
		curl -fsSL "$CODE_SERVER_NODE_DOWNLOAD_BASE_URL/$package_name.tar.xz" -o "$tarball_path"
	fi
	if ! verify_sha256_file "$tarball_path" "$expected_sha256"; then
		echo "Downloaded Node runtime checksum mismatch: $tarball_path" >&2
		exit 1
	fi

	rm -rf "$extract_root"
	tar -xJf "$tarball_path" -C "$cache_root"
	if [[ ! -x "$node_bin" ]]; then
		echo "Extracted Node runtime is missing executable: $node_bin" >&2
		exit 1
	fi
	if ! binary_supports_macos_arch "$node_bin" "$GHOSTEX_MACOS_ARCH"; then
		echo "Extracted Node runtime does not contain $GHOSTEX_MACOS_ARCH: $node_bin" >&2
		exit 1
	fi
	printf '%s\n' "$node_bin"
}

node_supports_t3code() {
	local candidate="$1"
	# CDXC:T3CodePackaging 2026-06-06-05:50: The packaged T3 Code server declares Node ^22.16 || ^23.11 || >=24.10; build packaging must reject older Node runtimes so released panes fail with setup guidance instead of a localhost startup error.
	"$candidate" -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit((major === 22 && minor >= 16) || (major === 23 && minor >= 11) || (major === 24 && minor >= 10) || major > 24 ? 0 : 1);' >/dev/null 2>&1
}

resolve_t3code_node() {
	local home
	home="$HOME"
	local candidates=(
		"${GXSERVER_NODE_BIN:-}"
		"/opt/homebrew/bin/node"
		"/usr/local/bin/node"
		"$home/.local/share/mise/shims/node"
		"$home/.local/bin/node"
		"$home/.asdf/shims/node"
	)
	local candidate
	for candidate in "${candidates[@]}"; do
		if [[ -n "$candidate" && -x "$candidate" ]] && node_supports_t3code "$candidate"; then
			printf '%s\n' "$candidate"
			return 0
		fi
	done
	candidate="$(command -v node || true)"
	if [[ -n "$candidate" && -x "$candidate" ]] && node_supports_t3code "$candidate"; then
		printf '%s\n' "$candidate"
		return 0
	fi
	return 1
}

resolve_t3code_root() {
	local configured="${T3CODE_ROOT:-${VSMUX_T3CODE_REPO_ROOT:-${ghostex_T3CODE_REPO_ROOT:-}}}"
	if [[ -n "$configured" ]]; then
		if [[ -f "$configured/apps/server/package.json" ]]; then
			(cd "$configured" && pwd)
			return 0
		fi
		return 1
	fi
	# CDXC:T3CodeSubmodule 2026-06-07-13:00: Package T3 Code from the root `t3code` submodule by default so app builds use the parent-pinned fork commit instead of unreviewed sibling checkouts.
	if [[ -f "$REPO_ROOT/t3code/apps/server/package.json" ]]; then
		(cd "$REPO_ROOT/t3code" && pwd)
		return 0
	fi
	return 1
}

resolve_code_server_root() {
	local configured="${CODE_SERVER_ROOT:-${GHOSTEX_CODE_SERVER_ROOT:-}}"
	if [[ -n "$configured" ]]; then
		if [[ -f "$configured/package.json" ]]; then
			(cd "$configured" && pwd)
			return 0
		fi
		return 1
	fi
	if [[ -f "$REPO_ROOT/code-server/package.json" ]]; then
		(cd "$REPO_ROOT/code-server" && pwd)
		return 0
	fi
	return 1
}

code_server_ci_arch() {
	case "$GHOSTEX_MACOS_ARCH" in
		arm64)
			printf 'arm64\n'
			;;
		x86_64)
			printf 'amd64\n'
			;;
	esac
}

code_server_vscode_target() {
	case "$GHOSTEX_MACOS_ARCH" in
		arm64)
			printf 'darwin-arm64\n'
			;;
		x86_64)
			printf 'darwin-x64\n'
			;;
	esac
}

code_server_vscode_ripgrep_bin() {
	local vscode_root="$1"
	printf '%s/node_modules/@vscode/ripgrep/bin/rg\n' "$vscode_root"
}

code_server_vscode_payload_digest() {
	local vscode_target="$1"
	local node_identity="$2"
	local npm_version="$3"
	local package_version="$4"
	local commit="$5"
	fingerprint_inputs \
		--value "code-server-vscode-payload-v1" \
		--value "arch=$GHOSTEX_MACOS_ARCH" \
		--value "target=$vscode_target" \
		--value "node=$node_identity" \
		--value "npm=$npm_version" \
		--value "version=$package_version" \
		--value "commit=$commit" \
		--path "$CODE_SERVER_ROOT/ci/build/build-vscode.sh" \
		--path "$CODE_SERVER_ROOT/patches" \
		--path "$CODE_SERVER_ROOT/package.json" \
		--path "$CODE_SERVER_ROOT/package-lock.json" \
		--path "$CODE_SERVER_ROOT/.node-version" \
		--path "$CODE_SERVER_ROOT/lib/vscode/package.json" \
		--path "$CODE_SERVER_ROOT/lib/vscode/package-lock.json" \
		--path "$CODE_SERVER_ROOT/lib/vscode/product.json" \
		--path "$CODE_SERVER_ROOT/lib/vscode/build/gulpfile.reh.ts" \
		--path "$CODE_SERVER_ROOT/lib/vscode/build/lib/copilot.ts" \
		--path "$CODE_SERVER_ROOT/lib/vscode/remote/package.json" \
		--path "$CODE_SERVER_ROOT/lib/vscode/remote/package-lock.json"
}

code_server_release_version() {
	"$CODE_SERVER_NODE_BIN" -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); process.stdout.write(String(pkg.version || '0.0.0'));" "$CODE_SERVER_ROOT/package.json"
}

ensure_code_server_payload() {
	local vscode_target="$1"
	local vscode_release_root="$CODE_SERVER_ROOT/lib/vscode-reh-web-$vscode_target"
	local vscode_ripgrep_bin payload_digest payload_cache_key node_identity npm_version package_version commit
	if [[ ! -f "$CODE_SERVER_ROOT/package.json" ]]; then
		echo "code-server source is missing: $CODE_SERVER_ROOT" >&2
		echo "Initialize the code-server submodule before building Ghostex." >&2
		exit 1
	fi
	if [[ ! -d "$CODE_SERVER_ROOT/node_modules" ]]; then
		echo "code-server node_modules are missing. Run: npm --prefix code-server install" >&2
		exit 1
	fi
	if [[ ! -f "$CODE_SERVER_ROOT/out/node/entry.js" ]]; then
		(
			cd "$CODE_SERVER_ROOT"
			env PATH="$CODE_SERVER_NODE_DIR:$PATH" "$CODE_SERVER_NPM_BIN" run build
		)
	fi
	if [[ ! -f "$CODE_SERVER_ROOT/lib/vscode/package.json" ]]; then
		echo "code-server VS Code submodule is missing. Run: git -C code-server submodule update --init lib/vscode" >&2
		exit 1
	fi
	if [[ ! -d "$CODE_SERVER_ROOT/lib/vscode/node_modules" ]]; then
		echo "code-server VS Code node_modules are missing. Run: npm --prefix code-server/lib/vscode install" >&2
		exit 1
	fi
	vscode_ripgrep_bin="$(code_server_vscode_ripgrep_bin "$vscode_release_root")"
	node_identity="$("$CODE_SERVER_NODE_BIN" -p 'process.version + ":" + process.versions.modules')"
	npm_version="$("$CODE_SERVER_NPM_BIN" --version 2>/dev/null || true)"
	package_version="$(code_server_release_version)"
	commit="$(git -C "$CODE_SERVER_ROOT" rev-parse HEAD 2>/dev/null || printf 'development')"
	payload_digest="$(code_server_vscode_payload_digest "$vscode_target" "$node_identity" "$npm_version" "$package_version" "$commit")"
	payload_cache_key="code-server-vscode-payload-$GHOSTEX_MACOS_ARCH"
	# CDXC:CodeServerRuntime 2026-06-09-17:06: Embedded VS Code search depends on @vscode/ripgrep/bin/rg. Rebuild the generated REH web payload when code-server packaging inputs change, server-main.js is missing, or ripgrep is missing/wrong-arch so `bun run start` and release builds cannot reuse a stale payload that opens but fails search.
	if ! cache_matches "$payload_cache_key" "$payload_digest" "$vscode_release_root/out/server-main.js" "$vscode_ripgrep_bin" ||
		! binary_supports_macos_arch "$vscode_ripgrep_bin" "$GHOSTEX_MACOS_ARCH"; then
		(
			cd "$CODE_SERVER_ROOT"
			env \
				PATH="$CODE_SERVER_NODE_DIR:$PATH" \
				OS=macos \
				ARCH="$(code_server_ci_arch)" \
				VSCODE_TARGET="$vscode_target" \
				VERSION="$(code_server_release_version)" \
				"$CODE_SERVER_NPM_BIN" run build:vscode
		)
	fi
	if [[ ! -f "$vscode_release_root/out/server-main.js" ]]; then
		echo "code-server VS Code release payload is missing: $vscode_release_root/out/server-main.js" >&2
		exit 1
	fi
	if [[ ! -f "$vscode_ripgrep_bin" ]]; then
		echo "code-server VS Code release payload is missing ripgrep: $vscode_ripgrep_bin" >&2
		exit 1
	fi
	if ! binary_supports_macos_arch "$vscode_ripgrep_bin" "$GHOSTEX_MACOS_ARCH"; then
		echo "code-server VS Code ripgrep binary does not contain $GHOSTEX_MACOS_ARCH: $vscode_ripgrep_bin" >&2
		exit 1
	fi
	write_cache_stamp "$payload_cache_key" "$payload_digest"
}

package_code_server_if_needed() {
	local target_dir="$WEB_DIR/code-server"
	local vscode_target package_digest node_identity npm_version vscode_release_root commit package_version
	vscode_target="$(code_server_vscode_target)"
	ensure_code_server_payload "$vscode_target"
	vscode_release_root="$CODE_SERVER_ROOT/lib/vscode-reh-web-$vscode_target"
	node_identity="$("$CODE_SERVER_NODE_BIN" -p 'process.version + ":" + process.versions.modules')"
	npm_version="$("$CODE_SERVER_NPM_BIN" --version 2>/dev/null || true)"
	package_version="$(code_server_release_version)"
	commit="$(git -C "$CODE_SERVER_ROOT" rev-parse HEAD 2>/dev/null || printf 'development')"
	package_digest="$(fingerprint_inputs \
		--value "code-server-package-v2" \
		--value "arch=$GHOSTEX_MACOS_ARCH" \
		--value "target=$vscode_target" \
		--value "node=$node_identity" \
		--value "npm=$npm_version" \
		--value "commit=$commit" \
		--value "entry=$(path_identity "$CODE_SERVER_ROOT/out/node/entry.js")" \
		--value "vscode=$(path_identity "$vscode_release_root/out/server-main.js")" \
		--value "ripgrep=$(path_identity "$(code_server_vscode_ripgrep_bin "$vscode_release_root")")" \
		--path "$CODE_SERVER_ROOT/ci/build/build-vscode.sh" \
		--path "$CODE_SERVER_ROOT/patches" \
		--path "$CODE_SERVER_ROOT/package.json" \
		--path "$CODE_SERVER_ROOT/package-lock.json" \
		--path "$CODE_SERVER_ROOT/.node-version" \
		--path "$CODE_SERVER_ROOT/src/browser")"
	# CDXC:CodeServerRuntime 2026-06-08-12:17: The app bundle must contain a self-contained code-server runtime at Web/code-server and the single shared Node executable at Web/code-server/lib/node. Missing code-server resources are build failures instead of installed-user Node prompts.
	if cache_matches "code-server-package-$GHOSTEX_MACOS_ARCH" "$package_digest" "$target_dir/out/node/entry.js" "$target_dir/lib/vscode/out/server-main.js" "$target_dir/lib/vscode/node_modules/@vscode/ripgrep/bin/rg" "$target_dir/lib/node" "$target_dir/node_modules" &&
		binary_supports_macos_arch "$target_dir/lib/node" "$GHOSTEX_MACOS_ARCH" &&
		binary_supports_macos_arch "$target_dir/lib/vscode/node_modules/@vscode/ripgrep/bin/rg" "$GHOSTEX_MACOS_ARCH"; then
		# CDXC:CodeServerRuntime 2026-06-08-16:23: Web/code-server is a shared staging directory reused by arm64 and x86_64 release passes. A per-arch cache stamp is only valid when the staged Node executable still contains the requested CPU slice; otherwise restage the package so app validation uses the matching runtime.
		echo "code-server package is current; skipping package rebuild."
		return 0
	fi

	rm -rf "$target_dir"
	mkdir -p "$target_dir"
	rsync -a --delete "$CODE_SERVER_ROOT/out/" "$target_dir/out/"
	mkdir -p "$target_dir/src/browser"
	if [[ -d "$CODE_SERVER_ROOT/src/browser/media" ]]; then
		rsync -a --delete "$CODE_SERVER_ROOT/src/browser/media/" "$target_dir/src/browser/media/"
	fi
	if [[ -d "$CODE_SERVER_ROOT/src/browser/pages" ]]; then
		rsync -a --delete "$CODE_SERVER_ROOT/src/browser/pages/" "$target_dir/src/browser/pages/"
	fi
	for browser_asset in robots.txt security.txt; do
		if [[ -f "$CODE_SERVER_ROOT/src/browser/$browser_asset" ]]; then
			cp "$CODE_SERVER_ROOT/src/browser/$browser_asset" "$target_dir/src/browser/$browser_asset"
		fi
	done
	"$CODE_SERVER_NODE_BIN" -e "const fs=require('fs'); const src=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); delete src.scripts; delete src.jest; delete src.devDependencies; src.version=process.argv[3]; src.commit=process.argv[4]; fs.writeFileSync(process.argv[2], JSON.stringify(src, null, 2) + '\n');" "$CODE_SERVER_ROOT/package.json" "$target_dir/package.json" "$package_version" "$commit"
	cp "$CODE_SERVER_ROOT/package-lock.json" "$target_dir/package-lock.json"
	if [[ -f "$CODE_SERVER_ROOT/.node-version" ]]; then
		cp "$CODE_SERVER_ROOT/.node-version" "$target_dir/.node-version"
	fi
	for root_asset in LICENSE README.md ThirdPartyNotices.txt; do
		if [[ -f "$CODE_SERVER_ROOT/$root_asset" ]]; then
			cp "$CODE_SERVER_ROOT/$root_asset" "$target_dir/$root_asset"
		fi
	done
	mkdir -p "$target_dir/bin"
	cp "$CODE_SERVER_ROOT/ci/build/code-server.sh" "$target_dir/bin/code-server"
	chmod 755 "$target_dir/bin/code-server"
	rsync -a --delete \
		--exclude '.cache/' \
		--exclude '.bin/' \
		"$CODE_SERVER_ROOT/node_modules/" "$target_dir/node_modules/"
	(
		cd "$target_dir"
		env PATH="$CODE_SERVER_NODE_DIR:$PATH" "$CODE_SERVER_NPM_BIN" prune --omit=dev --ignore-scripts --no-audit --no-fund
	)
	mkdir -p "$target_dir/lib"
	rsync -a --delete --exclude '/node' "$vscode_release_root/" "$target_dir/lib/vscode/"
	prune_node_pty_prebuilds "$target_dir"
	cp "$CODE_SERVER_NODE_BIN" "$target_dir/lib/node"
	chmod 755 "$target_dir/lib/node"
	"$target_dir/lib/node" "$target_dir/out/node/entry.js" --version >/dev/null
	write_cache_stamp "code-server-package-$GHOSTEX_MACOS_ARCH" "$package_digest"
}

resolve_beads_root() {
	local configured="${BEADS_ROOT:-${GHOSTEX_BEADS_ROOT:-}}"
	local candidate
	if [[ -n "$configured" ]]; then
		if [[ -f "$configured/go.mod" && -d "$configured/cmd/bd" ]]; then
			(cd "$configured" && pwd)
			return 0
		fi
		return 1
	fi
	# CDXC:ProjectBoardBeads 2026-06-08-10:46: Ghostex bundles upstream Beads without forking it. Prefer an explicit BEADS_ROOT for release automation, and keep the owner's local reference checkout as the default developer source for periodic pinned Beads updates.
	for candidate in \
		"$REPO_ROOT/beads" \
		"$HOME/dev/_references/beads"; do
		if [[ -f "$candidate/go.mod" && -d "$candidate/cmd/bd" ]]; then
			(cd "$candidate" && pwd)
			return 0
		fi
	done
	return 1
}

package_t3code_server() {
	local t3_root="$1"
	local node_bin="$2"
	local npm_bin="$3"
	local target_dir="$WEB_DIR/t3code-server"
	local node_identity npm_version package_digest expected_node_pty_prebuild

	# CDXC:T3CodePackaging 2026-06-06-05:50: T3 Code is a core advertised pane type, so release builds must ship the managed server runtime under Web/t3code-server instead of letting installed apps fall through to a developer-only source checkout and fail with a network-looking pane error.
	#
	# CDXC:LocalStartFast 2026-06-07-16:23: `bun run start` already treats T3 Code as a packaged runtime, so the build should not run the T3 monorepo build and production npm install on every app relaunch. Reuse the package when the T3 source tree, packager script, and selected Node/npm runtime are unchanged.
	#
	# CDXC:LocalStartReleaseParity 2026-06-09-09:07: Web/t3code-server is a shared staging directory reused by arm64 and x86_64 release/local-start passes. A per-arch cache stamp is valid only when the staged node-pty prebuild still matches GHOSTEX_MACOS_ARCH; otherwise rebuild so `bun run start` cannot copy Intel T3 native modules into an arm64 app.
	node_identity="$("$node_bin" -p 'process.version + ":" + process.versions.modules')"
	npm_version="$("$npm_bin" --version 2>/dev/null || true)"
	expected_node_pty_prebuild="$target_dir/node_modules/node-pty/prebuilds/$(node_pty_prebuild_platform_dir)/pty.node"
	package_digest="$(fingerprint_inputs \
		--value "t3code-package-v2" \
		--value "arch=$GHOSTEX_MACOS_ARCH" \
		--value "node=$node_identity" \
		--value "npm=$npm_version" \
		--path "$t3_root" \
		--path "$REPO_ROOT/scripts/build-t3code-if-needed.mjs" \
		--path "$REPO_ROOT/scripts/package-t3code-server.mjs")"
	if cache_matches "t3code-server-package-$GHOSTEX_MACOS_ARCH" "$package_digest" "$target_dir/dist/bin.mjs" "$target_dir/package.json" "$target_dir/node_modules" "$expected_node_pty_prebuild" &&
		node_pty_prebuilds_match_arch "$target_dir"; then
		echo "T3 Code package is current; skipping package rebuild."
		return 0
	fi

	env VSMUX_T3CODE_REPO_ROOT="$t3_root" ghostex_T3CODE_REPO_ROOT="$t3_root" PATH="$(dirname "$node_bin"):$PATH" bun "$REPO_ROOT/scripts/build-t3code-if-needed.mjs"
	rm -rf "$target_dir"
	mkdir -p "$target_dir"
	cp -R "$t3_root/apps/server/dist" "$target_dir/dist"
	"$node_bin" "$REPO_ROOT/scripts/package-t3code-server.mjs" \
		--source-root "$t3_root" \
		--target "$target_dir"
	(
		cd "$target_dir"
		env PATH="$(dirname "$node_bin"):$PATH" "$npm_bin" install --omit=dev --no-audit --no-fund
		prune_node_pty_prebuilds "$target_dir"
		remove_t3code_source_maps "$target_dir"
		env PATH="$(dirname "$node_bin"):$PATH" "$node_bin" dist/bin.mjs --help >/dev/null
	)
	write_cache_stamp "t3code-server-package-$GHOSTEX_MACOS_ARCH" "$package_digest"
}

build_zmx_if_needed() {
	local output_path="$ZMX_ROOT/zig-out/bin/zmx"
	local build_digest
	build_digest="$(fingerprint_inputs \
		--value "zmx-build-v1" \
		--value "target=$ZMX_TARGET" \
		--value "zig=$ZIG_VERSION" \
		--path "$ZMX_ROOT/src" \
		--path "$ZMX_ROOT/build.zig" \
		--path "$ZMX_ROOT/build.zig.zon")"
	if cache_matches "zmx-$GHOSTEX_MACOS_ARCH" "$build_digest" "$output_path"; then
		# CDXC:LocalStartArchitecture 2026-06-08-08:42: zmx writes every macOS target to zmx/zig-out/bin/zmx, so an old per-arch cache stamp is not enough to prove the shared output still contains the requested CPU slice. Verify the Mach-O architecture before skipping or Ghostex can launch Intel zmx from an arm64 app.
		if binary_supports_macos_arch "$output_path" "$GHOSTEX_MACOS_ARCH"; then
			echo "zmx is current; skipping Zig build."
			return 0
		fi
		echo "zmx cache is stale for $GHOSTEX_MACOS_ARCH; rebuilding Zig artifact."
	fi

	(
		cd "$ZMX_ROOT"
		# CDXC:ZmxPersistence 2026-05-20-10:23: Zig 0.15.2 currently resolves the native build runner through the selected macOS 26 Xcode SDK on this machine, which can fail before zmx compilation starts. Scope the Command Line Tools developer dir to the zmx submodule build only; the zmx artifact itself is still built for the explicit deployment target above.
		ZMX_BUILD_ENV=(env -u LDFLAGS ZIG="$ZIG_BIN")
		if [[ -z "${ZMX_BUILD_DEVELOPER_DIR:-}" && -d /Library/Developer/CommandLineTools ]]; then
			ZMX_BUILD_DEVELOPER_DIR=/Library/Developer/CommandLineTools
		fi
		if [[ -n "${ZMX_BUILD_DEVELOPER_DIR:-}" ]]; then
			ZMX_BUILD_ENV+=(DEVELOPER_DIR="$ZMX_BUILD_DEVELOPER_DIR")
		fi
		"${ZMX_BUILD_ENV[@]}" "$ZIG_BIN" build -Doptimize=ReleaseSafe -Dtarget="$ZMX_TARGET"
	)
	write_cache_stamp "zmx-$GHOSTEX_MACOS_ARCH" "$build_digest"
}

build_tui_if_needed() {
	local output_path="$TUI_ROOT/target/$TUI_CARGO_TARGET/release/ghostex-tui"
	local cargo_version build_digest
	cargo_version="$("$TUI_CARGO_BIN" --version 2>/dev/null || true)"
	build_digest="$(fingerprint_inputs \
		--value "ghostex-tui-build-v1" \
		--value "target=$TUI_CARGO_TARGET" \
		--value "cargo=$cargo_version" \
		--value "zig=$ZIG_VERSION" \
		--path "$TUI_ROOT/src" \
		--path "$TUI_ROOT/Cargo.toml" \
		--path "$TUI_ROOT/Cargo.lock")"
	if cache_matches "ghostex-tui-$GHOSTEX_MACOS_ARCH" "$build_digest" "$output_path"; then
		echo "ghostex-tui is current; skipping Cargo build."
		return 0
	fi

	env ZIG="$ZIG_BIN" "$TUI_CARGO_BIN" build --release --bin ghostex-tui --manifest-path "$TUI_ROOT/Cargo.toml" --target "$TUI_CARGO_TARGET"
	write_cache_stamp "ghostex-tui-$GHOSTEX_MACOS_ARCH" "$build_digest"
}

gxserver_rust_cargo_target() {
	case "$GHOSTEX_MACOS_ARCH" in
		arm64)
			printf 'aarch64-apple-darwin\n'
			;;
		x86_64)
			printf 'x86_64-apple-darwin\n'
			;;
	esac
}

resolve_gxserver_rust_cargo() {
	local cargo_bin="${GXSERVER_RUST_CARGO:-${CARGO:-}}"
	if [[ -z "$cargo_bin" ]]; then
		cargo_bin="$(command -v cargo || true)"
	fi
	if [[ -z "$cargo_bin" ]]; then
		cat >&2 <<EOF
Cargo is required to build bundled Rust gxserver.

Install Rust, then rerun this script:
  rustup toolchain install stable
EOF
		exit 1
	fi
	printf '%s\n' "$cargo_bin"
}

build_gxserver_rust_if_needed() {
	local cargo_bin cargo_target output_path cargo_version build_digest
	if [[ ! -f "$GXSERVER_RS_ROOT/Cargo.toml" ]]; then
		cat >&2 <<EOF
Rust gxserver source is missing:
  $GXSERVER_RS_ROOT

Initialize or provide gxserver-rs before building the app bundle.
EOF
		exit 1
	fi
	cargo_bin="$(resolve_gxserver_rust_cargo)"
	cargo_target="$(gxserver_rust_cargo_target)"
	output_path="$GXSERVER_RS_ROOT/target/$cargo_target/release/gxserver"
	cargo_version="$("$cargo_bin" --version 2>/dev/null || true)"
	build_digest="$(fingerprint_inputs \
		--value "gxserver-rs-build-v1" \
		--value "target=$cargo_target" \
		--value "cargo=$cargo_version" \
		--path "$GXSERVER_RS_ROOT/src" \
		--path "$GXSERVER_RS_ROOT/Cargo.toml" \
		--path "$GXSERVER_RS_ROOT/Cargo.lock")"
	if cache_matches "gxserver-rs-$GHOSTEX_MACOS_ARCH" "$build_digest" "$output_path" &&
		binary_supports_macos_arch "$output_path" "$GHOSTEX_MACOS_ARCH"; then
		echo "Rust gxserver is current; skipping Cargo build." >&2
		printf '%s\n' "$output_path"
		return 0
	fi

	"$cargo_bin" build --release --manifest-path "$GXSERVER_RS_ROOT/Cargo.toml" --target "$cargo_target"
	if ! binary_supports_macos_arch "$output_path" "$GHOSTEX_MACOS_ARCH"; then
		echo "Rust gxserver binary does not contain $GHOSTEX_MACOS_ARCH: $output_path" >&2
		exit 1
	fi
	write_cache_stamp "gxserver-rs-$GHOSTEX_MACOS_ARCH" "$build_digest"
	printf '%s\n' "$output_path"
}

build_zehn_if_needed() {
	local output_path="$ZEHN_ROOT/zig-out/bin/zehn"
	local build_digest
	build_digest="$(fingerprint_inputs \
		--value "zehn-build-v1" \
		--value "target=$ZEHN_TARGET" \
		--value "zig=$ZEHN_ZIG_VERSION" \
		--path "$ZEHN_ROOT/src" \
		--path "$ZEHN_ROOT/build.zig" \
		--path "$ZEHN_ROOT/build.zig.zon")"
	if cache_matches "zehn-$GHOSTEX_MACOS_ARCH" "$build_digest" "$output_path"; then
		# CDXC:LocalStartArchitecture 2026-06-08-08:42: zehn also emits to a shared zig-out/bin path across target switches. Check the Mach-O slice before reusing a cached artifact so bundled CLI search tools match the selected app architecture.
		if binary_supports_macos_arch "$output_path" "$GHOSTEX_MACOS_ARCH"; then
			echo "zehn is current; skipping Zig build."
			return 0
		fi
		echo "zehn cache is stale for $GHOSTEX_MACOS_ARCH; rebuilding Zig artifact."
	fi

	(
		cd "$ZEHN_ROOT"
		env ZIG="$ZEHN_ZIG_BIN" "$ZEHN_ZIG_BIN" build -Doptimize=ReleaseFast -Dtarget="$ZEHN_TARGET"
	)
	write_cache_stamp "zehn-$GHOSTEX_MACOS_ARCH" "$build_digest"
}

build_beads_if_needed() {
	local output_path="$REPO_ROOT/build/$GHOSTEX_MACOS_ARCH/beads/bd"
	local go_bin go_version go_mod_version goarch macos_target build_digest commit short_commit branch
	local -a build_env
	go_bin="${BEADS_GO:-$(command -v go || true)}"
	if [[ -z "$go_bin" ]]; then
		cat >&2 <<EOF
Go is required to build bundled Beads for the Project board.

Install Go, or set BEADS_GO to the Go executable that should build:
  BEADS_GO=/path/to/go bun run start
EOF
		exit 1
	fi
	go_version="$("$go_bin" version 2>/dev/null || true)"
	go_mod_version="$(sed -n 's/^go //p' "$BEADS_ROOT/go.mod" | head -1)"
	case "$GHOSTEX_MACOS_ARCH" in
		arm64)
			goarch="arm64"
			macos_target="15.0"
			;;
		x86_64)
			goarch="amd64"
			macos_target="13.0"
			;;
	esac
	build_digest="$(fingerprint_inputs \
		--value "beads-build-v1" \
		--value "target=darwin/$goarch" \
		--value "macos_target=$macos_target" \
		--value "go=$go_bin:$go_version" \
		--path "$BEADS_ROOT/cmd" \
		--path "$BEADS_ROOT/internal" \
		--path "$BEADS_ROOT/format" \
		--path "$BEADS_ROOT/plugins" \
		--path "$BEADS_ROOT/beads.go" \
		--path "$BEADS_ROOT/beads_nocgo.go" \
		--path "$BEADS_ROOT/go.mod" \
		--path "$BEADS_ROOT/go.sum")"
	if cache_matches "beads-$GHOSTEX_MACOS_ARCH" "$build_digest" "$output_path"; then
		if binary_supports_macos_arch "$output_path" "$GHOSTEX_MACOS_ARCH"; then
			echo "bd is current; skipping Beads build."
			return 0
		fi
		echo "bd cache is stale for $GHOSTEX_MACOS_ARCH; rebuilding Beads artifact."
	fi

	commit="$(git -C "$BEADS_ROOT" rev-parse HEAD 2>/dev/null || true)"
	short_commit="$(git -C "$BEADS_ROOT" rev-parse --short HEAD 2>/dev/null || true)"
	branch="$(git -C "$BEADS_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
	if [[ "$branch" == "HEAD" ]]; then
		branch=""
	fi
	mkdir -p "$(dirname "$output_path")"
	build_env=(
		env
		CGO_ENABLED=1
		GOOS=darwin
		GOARCH="$goarch"
		CC=clang
		CGO_CFLAGS="-arch $GHOSTEX_MACOS_ARCH -mmacosx-version-min=$macos_target"
		CGO_LDFLAGS="-arch $GHOSTEX_MACOS_ARCH -mmacosx-version-min=$macos_target"
	)
	if [[ -n "$go_mod_version" ]]; then
		build_env+=(GOTOOLCHAIN="go$go_mod_version")
	fi
	(
		cd "$BEADS_ROOT"
		"${build_env[@]}" "$go_bin" build \
			-tags gms_pure_go \
			-trimpath \
			-ldflags "-s -w -X main.Build=${short_commit:-dev} -X main.Commit=$commit -X main.Branch=$branch" \
			-o "$output_path" \
			./cmd/bd
	)
	/usr/bin/codesign -s - -f "$output_path" 2>/dev/null || true
	write_cache_stamp "beads-$GHOSTEX_MACOS_ARCH" "$build_digest"
}

gxserver_package_supports_macos_arch() {
	local target_dir="$1"
	local binary_path
	if [[ ! -x "$target_dir/bin/bd" ]]; then
		return 1
	fi
	for binary_path in \
		"$target_dir/bin/gxserver" \
		"$target_dir/bin/zmx" \
		"$target_dir/bin/zehn" \
		"$WEB_DIR/bin/bd"; do
		if ! binary_supports_macos_arch "$binary_path" "$GHOSTEX_MACOS_ARCH"; then
			return 1
		fi
	done
	return 0
}

package_gxserver_if_needed() {
	local package_dir="$REPO_ROOT/gxserver/dist/server-package"
	local target_dir="$WEB_DIR/gxserver"
	local rust_bin package_digest
	# CDXC:GxserverPackaging 2026-05-30-15:49: The macOS app bundles the same gxserver server package used by standalone installs. The app only starts/reuses gxserver through packaged resources and does not own shutdown, so app resources must include the gxserver daemon plus pinned zmx/zehn/bd artifacts.
	#
	# CDXC:LocalStartFast 2026-06-07-16:23: gxserver packaging should skip work when gxserver runtime sources, package metadata, packager code, bundled zmx/zehn/bd binaries, and generated protocol inputs are unchanged.
	#
	# CDXC:GxserverPackaging 2026-06-08-12:17: gxserver used to couple app packaging to code-server's bundled Node runtime. Phase 8 keeps code-server as a separate app resource and removes gxserver's Node ABI from the daemon package fingerprint.
	#
	# CDXC:ProjectBoardBeads 2026-06-08-10:46: Package the full upstream Beads CLI with gxserver so Project/Kanban opens without PATH setup. The app build stages exactly one `bd` binary for GHOSTEX_MACOS_ARCH, keeping arm and Intel app artifacts arch-specific instead of shipping a universal Beads binary.
	#
	# CDXC:GxserverRustPackaging 2026-06-16-10:35: Phase 8 macOS builds now package the Rust gxserver daemon by default while preserving generated TypeScript protocol exports. Keep Node as a build-time protocol compiler only; the app gxserver package must not depend on Node ABI metadata or a JavaScript database addon at runtime.
	rust_bin="$(build_gxserver_rust_if_needed)"
	package_digest="$(fingerprint_inputs \
		--value "gxserver-package-v5" \
		--value "arch=$GHOSTEX_MACOS_ARCH" \
		--value "rust=$(path_identity "$rust_bin")" \
		--path "$REPO_ROOT/gxserver/protocol" \
		--path "$REPO_ROOT/gxserver/package.json" \
		--path "$REPO_ROOT/gxserver/package-lock.json" \
		--path "$REPO_ROOT/gxserver/tsconfig.json" \
		--path "$REPO_ROOT/gxserver/scripts/package-gxserver.mjs" \
		--path "$GXSERVER_RS_ROOT/src" \
		--path "$GXSERVER_RS_ROOT/Cargo.toml" \
		--path "$GXSERVER_RS_ROOT/Cargo.lock" \
		--path "$WEB_DIR/bin/zmx" \
		--path "$WEB_DIR/bin/zehn" \
		--path "$WEB_DIR/bin/bd")"
	if cache_matches "gxserver-package-$GHOSTEX_MACOS_ARCH" "$package_digest" "$package_dir/build-identity.json" "$target_dir/build-identity.json" "$target_dir/bin/gxserver" "$target_dir/dist/protocol/index.js" "$target_dir/dist/protocol/index.d.ts" &&
		gxserver_package_supports_macos_arch "$target_dir"; then
		# CDXC:GxserverPackaging 2026-06-08-16:23: Web/gxserver is also shared across dual-architecture release passes. Do not accept a cache hit unless the staged gxserver, zmx, zehn, and bd binaries match the requested architecture, or Intel and arm64 DMGs can silently inherit the previous pass's native artifacts.
		echo "gxserver package is current; skipping package rebuild."
		return 0
	fi

	(
		cd "$REPO_ROOT/gxserver"
		echo "Packaging Rust gxserver with $rust_bin"
		env PATH="$GXSERVER_NODE_DIR:$PATH" "$GXSERVER_NPM_BIN" run build
		env PATH="$GXSERVER_NODE_DIR:$PATH" "$GXSERVER_NODE_BIN" scripts/package-gxserver.mjs --rust-bin "$rust_bin" --zmx-bin "$WEB_DIR/bin/zmx" --zehn-bin "$WEB_DIR/bin/zehn" --bd-bin "$WEB_DIR/bin/bd"
	)
	rm -rf "$target_dir"
	cp -R "$package_dir" "$target_dir"
	write_gxserver_shared_bd_launcher "$target_dir/bin/bd"
	write_cache_stamp "gxserver-package-$GHOSTEX_MACOS_ARCH" "$package_digest"
}

# CDXC:CodeServerRuntime 2026-06-08-12:17: code-server is the only bundled Node owner in the macOS app. Build code-server with Node 22 and stage that runtime inside Web/code-server/lib/node; gxserver Phase 8 packaging uses Rust and no longer depends on this Node runtime at daemon startup.
CODE_SERVER_NODE_BIN="$(prepare_code_server_app_node_runtime)"
CODE_SERVER_NODE_DIR="$(cd "$(dirname "$CODE_SERVER_NODE_BIN")" && pwd)"
CODE_SERVER_NPM_BIN="$CODE_SERVER_NODE_DIR/npm"
if [[ ! -x "$CODE_SERVER_NPM_BIN" ]]; then
	echo "npm is required in the cached code-server Node distribution: $CODE_SERVER_NPM_BIN" >&2
	exit 1
fi
CODE_SERVER_ROOT="$(resolve_code_server_root || true)"
if [[ -z "$CODE_SERVER_ROOT" ]]; then
	cat >&2 <<EOF
code-server source is required to package the embedded Source-tab runtime.

Set CODE_SERVER_ROOT or GHOSTEX_CODE_SERVER_ROOT to a code-server checkout, or place it at:
  $REPO_ROOT/code-server
EOF
	exit 1
fi
CODE_SERVER_NODE_VERSION="$("$CODE_SERVER_NODE_BIN" -p 'process.version')"
CODE_SERVER_NODE_MAJOR="$("$CODE_SERVER_NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if [[ "$CODE_SERVER_NODE_MAJOR" != "$CODE_SERVER_APP_NODE_MAJOR" ]]; then
	echo "Ghostex app code-server packaging must use bundled Node.js $CODE_SERVER_APP_NODE_MAJOR, got $CODE_SERVER_NODE_VERSION at $CODE_SERVER_NODE_BIN." >&2
	exit 1
fi

GXSERVER_NODE_BIN="$CODE_SERVER_NODE_BIN"
GXSERVER_NODE_DIR="$CODE_SERVER_NODE_DIR"
GXSERVER_NPM_BIN="$CODE_SERVER_NPM_BIN"
GXSERVER_NODE_VERSION="$("$GXSERVER_NODE_BIN" -p 'process.version')"
GXSERVER_NODE_MAJOR="$("$GXSERVER_NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if [[ "$GXSERVER_NODE_MAJOR" != "$CODE_SERVER_APP_NODE_MAJOR" ]]; then
	echo "Ghostex app gxserver packaging must use code-server's bundled Node.js $CODE_SERVER_APP_NODE_MAJOR, got $GXSERVER_NODE_VERSION at $GXSERVER_NODE_BIN." >&2
	exit 1
fi

T3CODE_NODE_BIN="${T3CODE_NODE:-$(resolve_t3code_node || true)}"
if [[ -z "$T3CODE_NODE_BIN" ]]; then
	cat >&2 <<EOF
Node.js 22.16+, 23.11+, or 24.10+ is required to package T3 Code for the macOS app.

Install a compatible Node runtime from https://nodejs.org or set T3CODE_NODE explicitly.
EOF
	exit 1
fi
T3CODE_NODE_DIR="$(cd "$(dirname "$T3CODE_NODE_BIN")" && pwd)"
T3CODE_NPM_BIN="${T3CODE_NPM:-$T3CODE_NODE_DIR/npm}"
if [[ ! -x "$T3CODE_NPM_BIN" ]]; then
	T3CODE_NPM_BIN="$(PATH="$T3CODE_NODE_DIR:$PATH" command -v npm || true)"
fi
if [[ -z "$T3CODE_NPM_BIN" || ! -x "$T3CODE_NPM_BIN" ]]; then
	echo "npm is required beside the selected T3 Code Node runtime: $T3CODE_NODE_BIN" >&2
	exit 1
fi
T3CODE_ROOT="$(resolve_t3code_root || true)"
if [[ -z "$T3CODE_ROOT" ]]; then
	cat >&2 <<EOF
T3 Code source is required to package the embedded runtime.

Set T3CODE_ROOT or VSMUX_T3CODE_REPO_ROOT to a t3code checkout, or place it at:
  $REPO_ROOT/t3code
EOF
	exit 1
fi
BEADS_ROOT="$(resolve_beads_root || true)"
if [[ -z "$BEADS_ROOT" ]]; then
	cat >&2 <<EOF
Beads source is required to package the embedded Project board CLI.

Set BEADS_ROOT or GHOSTEX_BEADS_ROOT to a Beads checkout, or place it at:
  $HOME/dev/_references/beads
EOF
	exit 1
fi

# CDXC:NativeBuild 2026-05-29-11:24: `bun run start` builds zmx and its Ghostty Zig dependency, which require Zig 0.15.2. A global Homebrew `zig` upgrade to 0.16 breaks the build API, so the local native build must choose the compatible Zig binary deliberately instead of inheriting the first PATH entry.
ZIG_BIN="${ZIG:-}"
if [[ -z "$ZIG_BIN" && -x /opt/homebrew/opt/zig@0.15/bin/zig ]]; then
	ZIG_BIN=/opt/homebrew/opt/zig@0.15/bin/zig
elif [[ -z "$ZIG_BIN" ]]; then
	ZIG_BIN="$(command -v zig || true)"
fi
if [[ -z "$ZIG_BIN" ]]; then
	cat >&2 <<EOF
Zig 0.15.2 is required to build Ghostex's native zmx/Ghostty dependency.

Install it, then rerun this script:
  brew install zig@0.15
EOF
	exit 1
fi
ZIG_VERSION="$("$ZIG_BIN" version 2>/dev/null || true)"
if [[ "$ZIG_VERSION" != "0.15.2" ]]; then
	cat >&2 <<EOF
Zig 0.15.2 is required to build Ghostex's native zmx/Ghostty dependency.

Selected Zig:
  $ZIG_BIN
  version: ${ZIG_VERSION:-unknown}

Install Homebrew's compatible keg or set ZIG explicitly:
  brew install zig@0.15
  ZIG=/opt/homebrew/opt/zig@0.15/bin/zig bun run start
EOF
	exit 1
fi
export ZIG="$ZIG_BIN"

DERIVED_DATA="${DERIVED_DATA:-$REPO_ROOT/build/$GHOSTEX_MACOS_ARCH}"
# CDXC:NativeBuild 2026-05-23-13:29: `bun run start` should not rely on Xcode's first matching macOS destination when both arm64 and x86_64 host destinations are present. Pin the destination to the requested build architecture so warning output stays actionable.
XCODE_DESTINATION="platform=macOS,arch=$GHOSTEX_MACOS_ARCH"
GHOSTEX_APP_NAME="${GHOSTEX_APP_NAME:-Ghostex}"
GHOSTEX_APP_DISPLAY_NAME="${GHOSTEX_APP_DISPLAY_NAME:-Ghostex}"
GHOSTEX_BUNDLE_ID="${GHOSTEX_BUNDLE_ID:-com.madda.ghostex.host}"
GHOSTEX_HOME_DIRECTORY_NAME="${GHOSTEX_HOME_DIRECTORY_NAME:-.ghostex}"
GHOSTEX_SHARED_HOME_DIRECTORY_NAME="${GHOSTEX_SHARED_HOME_DIRECTORY_NAME:-.ghostex}"
uses_removed_dev_app_value=false
case "$GHOSTEX_APP_NAME:$GHOSTEX_APP_DISPLAY_NAME:$GHOSTEX_BUNDLE_ID:$GHOSTEX_HOME_DIRECTORY_NAME:$GHOSTEX_SHARED_HOME_DIRECTORY_NAME" in
	*Ghostex-dev* | *"Ghostex Dev"* | *com.madda.ghostex-dev* | *.ghostex-dev*)
		uses_removed_dev_app_value=true
		;;
esac
if [[ "$uses_removed_dev_app_value" == "true" ]]; then
	# CDXC:LocalStartSingleApp 2026-06-09-09:27: Ghostex-dev app metadata overrides were removed with the dev start/build entry points. Refuse old names, bundle ids, and storage homes so direct build commands cannot recreate the alternate app under another flag.
	echo "Ghostex-dev builds were removed. Use the production Ghostex app metadata." >&2
	exit 1
fi
# CDXC:Distribution 2026-05-14-19:06: Ghostex is the public app name.
# Release builds should publish and self-update from the Ghostex GitHub
# repository while old ghostex repository URLs can continue to redirect.
GHOSTEX_SPARKLE_FEED_URL="${GHOSTEX_SPARKLE_FEED_URL:-https://raw.githubusercontent.com/maddada/Ghostex/main/appcast.xml}"
GHOSTEX_SPARKLE_PUBLIC_ED_KEY="${GHOSTEX_SPARKLE_PUBLIC_ED_KEY:-AGWDPeMqfhmbjt8Pbk+VTC9fDfXAYq+cZoLGCYuGn70=}"
GHOSTEX_LID_SLEEP_HELPER_LABEL="${GHOSTEX_LID_SLEEP_HELPER_LABEL:-$GHOSTEX_BUNDLE_ID.LidSleepHelper}"

# CDXC:AutoUpdate 2026-05-02-06:51: Sparkle update checks need an appcast URL
# and EdDSA public key in Info.plist. The default public key is read from the
# user's Sparkle keychain account, and release automation can still override
# either value if the appcast host or signing account changes.
export GHOSTEX_SPARKLE_FEED_URL
export GHOSTEX_SPARKLE_PUBLIC_ED_KEY

if [[ -z "$GHOSTTY_ROOT" ]]; then
	# CDXC:NativeHost 2026-04-27-06:06: Local start/build commands should discover the Ghostty checkout that contains the required xcframework so `bun start` launches the native host without per-shell setup.
	# CDXC:NativeHost 2026-05-17-00:13: The committed /ghostty source dependency is the default Ghostty root so clones keep the embedded terminal source in one repo and GitHub counts Ghostty's Zig source in the parent language breakdown. Older sibling checkout paths remain fallbacks for local worktrees during migration.
	for candidate in \
		"$REPO_ROOT/ghostty" \
		"$REPO_ROOT/../ghostty" \
		"$REPO_ROOT/../ghostty-ghostex-survival" \
		"$REPO_ROOT/../../_forks/ghostty" \
		"$HOME/dev/_active/ghostty"; do
		if [[ -f "$candidate/build.zig" ]]; then
			GHOSTTY_ROOT="$(cd "$candidate" && pwd)"
			break
		fi
	done
fi

if [[ -z "$GHOSTTY_ROOT" ]]; then
	cat >&2 <<EOF
Set GHOSTTY_ROOT to your local Ghostty checkout before building ghostexHost.

Expected to find:
  \$GHOSTTY_ROOT/macos/GhosttyKit.xcframework
EOF
	exit 1
fi

GHOSTTY_KIT="$GHOSTTY_ROOT/macos/GhosttyKit.xcframework"
CEF_ROOT="${CEF_ROOT:-}"

if [[ ! -d "$GHOSTTY_KIT" ]]; then
	cat >&2 <<EOF
GhosttyKit.xcframework is missing:
  $GHOSTTY_KIT

Build it first:
  cd "$GHOSTTY_ROOT"
  env DEVELOPER_DIR=/Library/Developer/CommandLineTools \\
    SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk \\
    GHOSTTY_METAL_DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \\
    "$ZIG_BIN" build -Demit-xcframework -Dxcframework-target=universal -Demit-macos-app=false
EOF
	exit 1
fi

if [[ -z "$CEF_ROOT" ]]; then
	# CDXC:ChromiumBrowserPanes 2026-05-04-16:38
	# Browser panes render through embedded Chromium, so the native host build
	# vendors CEF and its helper binary before Xcode resolves ObjC++ headers and
	# link paths. This is a build dependency, not a package-manager install.
	# CDXC:MacRelease 2026-05-14-18:37: Dual-architecture public releases must
	# vendor CEF for the requested target architecture so Intel builds are real
	# x86_64 apps and do not depend on the Apple Silicon host architecture.
	CEF_ROOT="$(GHOSTEX_MACOS_ARCH="$GHOSTEX_MACOS_ARCH" "$SCRIPT_DIR/vendor-cef.sh")"
else
	CEF_ROOT="$CEF_ROOT" GHOSTEX_MACOS_ARCH="$GHOSTEX_MACOS_ARCH" "$SCRIPT_DIR/vendor-cef.sh" >/dev/null
fi

if ! command -v xcodegen >/dev/null 2>&1; then
	cat >&2 <<EOF
xcodegen is required to generate the ghostex project.

Install it, then rerun this script:
  brew install xcodegen
EOF
	exit 1
fi

mkdir -p "$WEB_DIR"
cp "$REPO_ROOT/native/sidebar/floating-monaco-editor.html" "$WEB_DIR/floating-monaco-editor.html"
rm -rf "$WEB_DIR/cli"
rm -rf "$CLI_DIR"
mkdir -p "$CLI_DIR"
# CDXC:CliSessions 2026-05-10-03:28: Shells resolve the installed macOS
# executable as a terminal command. Bundle the Node CLI in app resources
# so main.swift can proxy command argv before the AppKit app starts.
# CDXC:CliBranding 2026-05-26-15:11: Public CLI commands are now `ghostex`
# and `gx`; the bundled script filename follows the long public CLI name while
# internal GHOSTEX_* environment names and storage paths remain implementation
# details. The macOS app bundle should ship executable `ghostex` and `gx`
# launchers automatically so Homebrew can install both public commands without
# asking users to add shell aliases by hand.
# CDXC:CliInstall 2026-06-07-13:53: The app CLI is not a web asset. Stage it under Contents/Resources/CLI so DMG and Homebrew installs can symlink public commands to one app-owned runtime while Web remains only the sidebar/runtime asset folder.
cp "$REPO_ROOT/scripts/ghostex-cli.mjs" "$CLI_DIR/ghostex-cli.mjs"
cp "$REPO_ROOT/scripts/ghostex-cli-launcher.sh" "$CLI_DIR/ghostex"
cp "$REPO_ROOT/scripts/ghostex-cli-launcher.sh" "$CLI_DIR/gx"
chmod 755 "$CLI_DIR/ghostex" "$CLI_DIR/gx"
# CDXC:BrowserAgentControl 2026-05-26-22:17: First launch and Settings install
# the Ghostex Browser Use skill only after the user explicitly chooses that skill.
# Bundle the skill beside the CLI so `ghostex browser install-skill` can copy the
# exact version that matches the installed `ghostex browser mcp`
# command into ~/agents/skills.
# CDXC:BrowserAgentControl 2026-05-27-01:59: Browser control is now documented
# through the `ghostex browser ...` namespace, so bundled CLI resources must
# continue shipping the skill used by `ghostex browser install-skill`.
# CDXC:ComputerAgentControl 2026-05-27-06:58: Bundle the public
# `$ghostex-browser-use`, `$ghostex-computer-use`,
# `$ghostex-agent-orchestration`, `$ghostex-generate-title`, and
# `$ghostex-manage-beads` skills so first-launch, Settings, and CLI installers
# can install Ghostex-named agent wrappers without relying on a source checkout,
# raw zmx, or the lower-level `$cua-driver` skill name.
# CDXC:AgentSkills 2026-05-28-10:38: Keep bundled Ghostex runtime skills under
# scripts/skills instead of .agents/skills. Codex discovers .agents/skills
# directly, so keeping installable source copies there duplicates the same skill
# beside the user's shared ~/agents/skills install.
# CDXC:AgentSkills 2026-05-28-13:12: Bundled Ghostex skill titles should match
# their invocation slugs exactly, such as ghostex-browser-use, so the skill picker
# does not show a separate marketing-style title from the actual `$skill-name`.
# CDXC:ProjectBoardBeads 2026-06-04-03:32: Bundle `$ghostex-manage-beads` with
# the app CLI resources so agents can install project-board bead workflow
# guidance from the same released Ghostex build that provides the other skills.
mkdir -p "$CLI_DIR/skills"
# CDXC:LocalStart 2026-06-15-02:34: Local starts can rerun after the generated CLI skill folders already exist. Merge each bundled skill into its destination instead of copying the source directory onto an existing directory path, which makes `bun run start` idempotent without deleting generated output.
copy_cli_skill() {
	local skill_name="$1"
	mkdir -p "$CLI_DIR/skills/$skill_name"
	cp -R "$REPO_ROOT/scripts/skills/$skill_name/." "$CLI_DIR/skills/$skill_name/"
}
copy_cli_skill "ghostex-browser-use"
copy_cli_skill "ghostex-computer-use"
copy_cli_skill "ghostex-agent-orchestration"
copy_cli_skill "ghostex-generate-title"
copy_cli_skill "ghostex-manage-beads"
# CDXC:ZmxPersistence 2026-05-20-09:57: zmx pane refresh is now a zmx IPC feature, so Ghostex must bundle the pinned submodule binary instead of depending on whichever zmx happens to be on PATH. Build the submodule for the requested macOS architecture and copy it into app resources where TerminalWorkspaceView can launch it directly.
if [[ ! -f "$ZMX_ROOT/build.zig" ]]; then
	cat >&2 <<EOF
zmx source is missing:
  $ZMX_ROOT

Initialize submodules before building:
  git submodule update --init --recursive zmx
EOF
	exit 1
fi
case "$GHOSTEX_MACOS_ARCH" in
	arm64)
		ZMX_TARGET="aarch64-macos.15.0"
		;;
	x86_64)
		ZMX_TARGET="x86_64-macos.13.0"
		;;
esac
build_zmx_if_needed
rm -rf "$WEB_DIR/bin"
mkdir -p "$WEB_DIR/bin"
cp "$ZMX_ROOT/zig-out/bin/zmx" "$WEB_DIR/bin/zmx"
chmod 755 "$WEB_DIR/bin/zmx"
# CDXC:GhostexTui 2026-06-07-12:13: The public installed `gx` command must open the TUI from any working directory, so the macOS app bundle ships the arch-specific Ghostex TUI beside pinned zmx/zehn/bd tools under Web/bin instead of relying on a source checkout or PATH fallback.
if [[ ! -f "$TUI_ROOT/Cargo.toml" ]]; then
	cat >&2 <<EOF
Ghostex TUI source is missing:
  $TUI_ROOT

Initialize or provide the TUI source before building the app bundle.
EOF
	exit 1
fi
case "$GHOSTEX_MACOS_ARCH" in
	arm64)
		TUI_CARGO_TARGET="aarch64-apple-darwin"
		;;
	x86_64)
		TUI_CARGO_TARGET="x86_64-apple-darwin"
		;;
esac
TUI_CARGO_BIN="${CARGO:-}"
if [[ -z "$TUI_CARGO_BIN" ]]; then
	TUI_CARGO_BIN="$(command -v cargo || true)"
fi
if [[ -z "$TUI_CARGO_BIN" ]]; then
	cat >&2 <<EOF
Cargo is required to build bundled ghostex-tui.

Install Rust, then rerun this script:
  rustup toolchain install stable
EOF
	exit 1
fi
build_tui_if_needed
cp "$TUI_ROOT/target/$TUI_CARGO_TARGET/release/ghostex-tui" "$WEB_DIR/bin/ghostex-tui"
chmod 755 "$WEB_DIR/bin/ghostex-tui"
# CDXC:AgentHistorySearch 2026-05-29-12:27: Ghostex bundles the pinned zehn submodule as Web/bin/zehn so `gx find` and `gx f` run the reviewed prompt-history search tool even when the user's PATH contains no zehn or a different zehn build. `gx s` is intentionally left as the existing sessions alias, and `gx search` is not a public alias.
if [[ ! -f "$ZEHN_ROOT/build.zig" ]]; then
	cat >&2 <<EOF
zehn source is missing:
  $ZEHN_ROOT

Initialize submodules before building:
  git submodule update --init zehn
EOF
	exit 1
fi
ZEHN_ZIG_BIN="${ZEHN_ZIG:-}"
if [[ -z "$ZEHN_ZIG_BIN" ]]; then
	ZEHN_ZIG_BIN="$(command -v zig || true)"
fi
if [[ -z "$ZEHN_ZIG_BIN" ]]; then
	cat >&2 <<EOF
Zig 0.16 or newer is required to build bundled zehn.

Install it, then rerun this script:
  brew install zig
EOF
	exit 1
fi
ZEHN_ZIG_VERSION="$("$ZEHN_ZIG_BIN" version 2>/dev/null || true)"
case "$ZEHN_ZIG_VERSION" in
	0.16.* | 0.17.* | 0.18.* | 0.19.* | 0.20.*)
		;;
	*)
		cat >&2 <<EOF
Zig 0.16 or newer is required to build bundled zehn.

Selected Zig:
  $ZEHN_ZIG_BIN
  version: ${ZEHN_ZIG_VERSION:-unknown}

Set ZEHN_ZIG explicitly if your compatible Zig binary is not first on PATH.
EOF
		exit 1
		;;
esac
case "$GHOSTEX_MACOS_ARCH" in
	arm64)
		ZEHN_TARGET="aarch64-macos.15.0"
		;;
	x86_64)
		ZEHN_TARGET="x86_64-macos.13.0"
		;;
esac
build_zehn_if_needed
cp "$ZEHN_ROOT/zig-out/bin/zehn" "$WEB_DIR/bin/zehn"
chmod 755 "$WEB_DIR/bin/zehn"
build_beads_if_needed
cp "$REPO_ROOT/build/$GHOSTEX_MACOS_ARCH/beads/bd" "$WEB_DIR/bin/bd"
chmod 755 "$WEB_DIR/bin/bd"
package_code_server_if_needed
package_gxserver_if_needed
package_t3code_server "$T3CODE_ROOT" "$T3CODE_NODE_BIN" "$T3CODE_NPM_BIN"
mkdir -p "$CLI_DIR/node_modules"
rsync -a --delete "$REPO_ROOT/node_modules/ws/" "$CLI_DIR/node_modules/ws/"
mkdir -p "$WEB_DIR/monaco/vs"
rsync -a --delete "$REPO_ROOT/node_modules/monaco-editor/min/vs/" "$WEB_DIR/monaco/vs/"
mkdir -p "$WEB_DIR/sounds"
# CDXC:NativeSound 2026-04-29-16:30: Bundle completion sound assets beside
# the native Web resources so AVFoundation playback works from installed apps
# without relying on repository-relative media paths.
rsync -a --delete "$REPO_ROOT/media/sounds/" "$WEB_DIR/sounds/"
NATIVE_WEB_CACHE_KEY="native-web-$GHOSTEX_MACOS_ARCH"
# CDXC:NativeWebBuild 2026-06-11-20:28: Native web HTML assembly lives in this host build script, not only in build-native-web-bundles.mjs. Include this script in the digest so output-template changes that remove stale per-host CSS rebuild the Web resources instead of trusting an older cache stamp.
NATIVE_WEB_DIGEST="$(fingerprint_inputs \
	--value "native-web-bundles-v2" \
	--path "$SCRIPT_DIR/build-ghostex-host.sh" \
	--path "$REPO_ROOT/scripts/build-native-web-bundles.mjs" \
	--path "$REPO_ROOT/native/sidebar" \
	--path "$REPO_ROOT/sidebar" \
	--path "$REPO_ROOT/shared" \
	--path "$REPO_ROOT/components" \
	--path "$REPO_ROOT/lib" \
	--path "$REPO_ROOT/src/assets" \
	--path "$REPO_ROOT/package.json" \
	--path "$REPO_ROOT/bun.lock")"
if cache_matches "$NATIVE_WEB_CACHE_KEY" "$NATIVE_WEB_DIGEST" "$WEB_DIR/index.html" "$WEB_DIR/modal-host.html" "$WEB_DIR/titlebar-host.html" "$WEB_DIR/tasks-placeholder.html" "$WEB_DIR/pet-host.html" "$WEB_DIR/native-sidebar.js" "$WEB_DIR/native-sidebar.css"; then
	echo "Native web bundles are current; skipping Bun bundle build."
else
# CDXC:NativeSidebarBuild 2026-04-27-09:32
# The native sidebar is loaded by WKWebView as a classic script, while
# Storybook imports some sidebar components as ES modules. Force the packaged
# native bundle to IIFE so exported Storybook symbols never leave top-level
# `export` syntax in /Applications/Ghostex.app and blank the app at startup.
# CDXC:ReactTitlebar 2026-05-09-17:11: The macOS titlebar chrome is now a
# React WKWebView bundle so future titlebar buttons and workspace dropdowns
# share the same web UI/runtime rather than AppKit button implementations.
# CDXC:ModeSwitcher 2026-05-15-12:38: Bundle the tasks-backed Project mode as
# a first-party React page so the titlebar switcher can open a placeholder
# workarea surface without depending on remote assets or an external browser.
# CDXC:ReactCompiler 2026-06-06-21:20: Build all native WKWebView React bundles
# through the repository helper so React Compiler runs before Bun bundles and
# the host still receives the same classic-script filenames it inlines below.
# CDXC:LocalStartFast 2026-06-07-16:23: Cache native web bundle generation by source content so no-op starts do not rewrite identical WKWebView assets, which would invalidate the signed app resources and force a pointless re-sign.
# CDXC:NativeWebBuild 2026-06-11-20:28: Host-specific CSS files are generated artifacts, and Bun may collapse shared CSS into native-sidebar.css for entries that import the same stylesheet. Remove stale per-host CSS before rebuilding so titlebar, modal, and pet HTML cannot inline an older #050505 modal surface after the source background changes to #0e0e0e.
rm -f "$WEB_DIR/modal-host.css" "$WEB_DIR/titlebar-host.css" "$WEB_DIR/tasks-placeholder.css" "$WEB_DIR/pet-host.css"
bun "$REPO_ROOT/scripts/build-native-web-bundles.mjs" \
	--outdir "$WEB_DIR" \
	"$REPO_ROOT/native/sidebar/native-sidebar.tsx" \
	"$REPO_ROOT/native/sidebar/modal-host.tsx" \
	"$REPO_ROOT/native/sidebar/titlebar-host.tsx" \
	"$REPO_ROOT/native/sidebar/tasks-placeholder.tsx" \
	"$REPO_ROOT/native/sidebar/pet-host.tsx"

WEB_DIR="$WEB_DIR" "$GXSERVER_NODE_BIN" <<'JS'
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const webDir = process.env.WEB_DIR;
const css = readFileSync(join(webDir, "native-sidebar.css"), "utf8");
const js = readFileSync(join(webDir, "native-sidebar.js"), "utf8");
const modalJs = readFileSync(join(webDir, "modal-host.js"), "utf8");
// CDXC:ReactTitlebar 2026-05-11-00:22: The titlebar now imports shadcn/sidebar
// CSS for its grouped Open In controls, so inline its generated stylesheet in
// the isolated titlebar WKWebView instead of relying on the sidebar HTML.
// CDXC:NativeWebBuild 2026-06-11-20:28: When Bun emits only the shared native-sidebar.css for entries that import the same stylesheet, titlebar and pet hosts must inline that fresh shared CSS instead of preserving or omitting stale per-host CSS.
const titlebarCssPath = join(webDir, "titlebar-host.css");
const titlebarCss = existsSync(titlebarCssPath) ? readFileSync(titlebarCssPath, "utf8") : css;
const titlebarJs = readFileSync(join(webDir, "titlebar-host.js"), "utf8");
const tasksPlaceholderCssPath = join(webDir, "tasks-placeholder.css");
const tasksPlaceholderCss = existsSync(tasksPlaceholderCssPath) ? readFileSync(tasksPlaceholderCssPath, "utf8") : "";
const tasksPlaceholderJs = readFileSync(join(webDir, "tasks-placeholder.js"), "utf8");
const petCssPath = join(webDir, "pet-host.css");
const petCss = existsSync(petCssPath) ? readFileSync(petCssPath, "utf8") : css;
const petJs = readFileSync(join(webDir, "pet-host.js"), "utf8");
// Inline script bodies must escape HTML script end tags that appear inside bundle strings.
const escapedJs = js.replace(/<\/script/gi, "<\\/script");
const escapedModalJs = modalJs.replace(/<\/script/gi, "<\\/script");
const escapedTitlebarJs = titlebarJs.replace(/<\/script/gi, "<\\/script");
const escapedTasksPlaceholderJs = tasksPlaceholderJs.replace(/<\/script/gi, "<\\/script");
const escapedPetJs = petJs.replace(/<\/script/gi, "<\\/script");
writeFileSync(join(webDir, "index.html"), `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <style>
${css}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
(() => {
try {
${escapedJs}
} catch (error) {
  window.__ghostex_BOOT_ERROR__ = {
    message: error && error.message ? String(error.message) : String(error),
    stack: error && error.stack ? String(error.stack) : ""
  };
  throw error;
}
})();
//# sourceURL=native-sidebar.js
    </script>
  </body>
</html>
`);
writeFileSync(join(webDir, "modal-host.html"), `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <style>
${css}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
(() => {
try {
${escapedModalJs}
} catch (error) {
  window.__ghostex_BOOT_ERROR__ = {
    message: error && error.message ? String(error.message) : String(error),
    stack: error && error.stack ? String(error.stack) : ""
  };
  throw error;
}
})();
//# sourceURL=modal-host.js
    </script>
  </body>
</html>
`);
writeFileSync(join(webDir, "titlebar-host.html"), `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <style>
${titlebarCss}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
(() => {
try {
${escapedTitlebarJs}
} catch (error) {
  window.__ghostex_BOOT_ERROR__ = {
    message: error && error.message ? String(error.message) : String(error),
    stack: error && error.stack ? String(error.stack) : ""
  };
  throw error;
}
})();
//# sourceURL=titlebar-host.js
    </script>
  </body>
</html>
`);
writeFileSync(join(webDir, "tasks-placeholder.html"), `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <style>
${tasksPlaceholderCss}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
(() => {
try {
${escapedTasksPlaceholderJs}
} catch (error) {
  window.__ghostex_BOOT_ERROR__ = {
    message: error && error.message ? String(error.message) : String(error),
    stack: error && error.stack ? String(error.stack) : ""
  };
  throw error;
}
})();
//# sourceURL=tasks-placeholder.js
    </script>
  </body>
</html>
`);
writeFileSync(join(webDir, "pet-host.html"), `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <style>
${petCss}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
(() => {
try {
${escapedPetJs}
} catch (error) {
  window.__ghostex_BOOT_ERROR__ = {
    message: error && error.message ? String(error.message) : String(error),
    stack: error && error.stack ? String(error.stack) : ""
  };
  throw error;
}
})();
//# sourceURL=pet-host.js
    </script>
  </body>
</html>
`);
JS
write_cache_stamp "$NATIVE_WEB_CACHE_KEY" "$NATIVE_WEB_DIGEST"
fi

# CDXC:PublicRelease 2026-04-27-05:36: Public builds must not encode a
# maintainer-specific Ghostty checkout path; project.yml reads GHOSTTY_ROOT
# from the caller's environment when XcodeGen resolves native host paths.
export GHOSTTY_ROOT
export GHOSTEX_APP_NAME
export GHOSTEX_APP_DISPLAY_NAME
export GHOSTEX_BUNDLE_ID
export GHOSTEX_LID_SLEEP_HELPER_LABEL
export GHOSTEX_HOME_DIRECTORY_NAME
export GHOSTEX_SHARED_HOME_DIRECTORY_NAME
export GHOSTEX_MACOS_ARCH
export CEF_ROOT
BUILT_PRODUCTS_DIR="$DERIVED_DATA/Build/Products/$CONFIGURATION"
APP_PATH="$BUILT_PRODUCTS_DIR/$GHOSTEX_APP_NAME.app"

remove_lid_sleep_helper_resources_copy() {
	local app_path="$1"
	local resources_helper="$app_path/Contents/Resources/$GHOSTEX_LID_SLEEP_HELPER_LABEL"
	if [[ -e "$resources_helper" ]]; then
		# CDXC:TitlebarKeepAwake 2026-05-29-19:12: Xcode copies the helper tool into Contents/Resources when ghostex depends on GhostexLidSleepHelper. Public releases install only the LaunchServices copy, and leaving the adhoc Resources binary breaks notarization.
		rm -f "$resources_helper"
	fi
}

copy_lid_sleep_helper() {
	local app_path="$1"
	local helper_source="$BUILT_PRODUCTS_DIR/$GHOSTEX_LID_SLEEP_HELPER_LABEL"
	local helper_dir="$app_path/Contents/Library/LaunchServices"
	# CDXC:TitlebarKeepAwake 2026-05-28-19:28: Bundle the narrow lid-sleep privileged helper inside the app. The main app installs it to launchd only after the user enables closed-lid keep-awake and approves macOS administrator authorization.
	mkdir -p "$helper_dir"
	cp "$helper_source" "$helper_dir/$GHOSTEX_LID_SLEEP_HELPER_LABEL"
	chmod 755 "$helper_dir/$GHOSTEX_LID_SLEEP_HELPER_LABEL"
	remove_lid_sleep_helper_resources_copy "$app_path"
}

copy_cef_runtime() {
	local app_path="$1"
	local frameworks_dir="$app_path/Contents/Frameworks"
	local helper_source="$SCRIPT_DIR/build/cef-$GHOSTEX_MACOS_ARCH/ghostex-cef-helper"
	local helper_version="${MARKETING_VERSION:-1}"
	mkdir -p "$frameworks_dir"
	rsync -a --delete "$CEF_ROOT/Release/Chromium Embedded Framework.framework" "$frameworks_dir/"
	local helper_names=(
		"ghostex Helper"
		"ghostex Helper (Alerts)"
		"ghostex Helper (GPU)"
		"ghostex Helper (Plugin)"
		"ghostex Helper (Renderer)"
	)
	local helper_name
	for helper_name in "${helper_names[@]}"; do
		local helper_app="$frameworks_dir/$helper_name.app"
		local helper_macos="$helper_app/Contents/MacOS"
		mkdir -p "$helper_macos"
		cp "$helper_source" "$helper_macos/$helper_name"
		chmod +x "$helper_macos/$helper_name"
		cat >"$helper_app/Contents/Info.plist" <<EOF_HELPER
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key>
	<string>$helper_name</string>
	<key>CFBundleIdentifier</key>
	<string>$GHOSTEX_BUNDLE_ID.$(printf '%s' "$helper_name" | tr ' ()' '---')</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>$helper_name</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
		<key>CFBundleShortVersionString</key>
	<string>$helper_version</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>LSBackgroundOnly</key>
	<true/>
</dict>
</plist>
EOF_HELPER
		done
}

local_adhoc_build_signing() {
	[[ "${GHOSTEX_CODE_SIGN_IDENTITY:--}" == "-" && "${GHOSTEX_CODE_SIGN_TIMESTAMP_FLAG:---timestamp=none}" == "--timestamp=none" ]]
}

local_start_build_signing() {
	[[ "${GHOSTEX_LOCAL_START:-}" == "1" ]]
}

local_start_build_cache_reusable() {
	local_start_build_signing || local_adhoc_build_signing
}

signature_matches_requested_identity() {
	local code_path="$1"
	local identity="${GHOSTEX_CODE_SIGN_IDENTITY:--}"
	local signature_details
	signature_details="$(codesign -dv --verbose=4 "$code_path" 2>&1 || true)"
	if [[ "$identity" == "-" ]]; then
		[[ "$signature_details" == *"Signature=adhoc"* ]]
	elif [[ "$identity" =~ ^[A-Fa-f0-9]{40}$ ]]; then
		[[ "$signature_details" != *"Signature=adhoc"* && "$signature_details" != *"TeamIdentifier=not set"* ]]
	else
		[[ "$signature_details" == *"Authority=$identity"* ]]
	fi
}

can_reuse_build_app_signature() {
	local_start_build_cache_reusable &&
		codesign --verify --deep --strict "$APP_PATH" >/dev/null 2>&1 &&
		signature_matches_requested_identity "$APP_PATH"
}

build_native_app_digest() {
	fingerprint_inputs \
		--value "native-app-v1" \
		--value "configuration=$CONFIGURATION" \
		--value "arch=$GHOSTEX_MACOS_ARCH" \
		--value "app=$GHOSTEX_APP_NAME|$GHOSTEX_APP_DISPLAY_NAME|$GHOSTEX_BUNDLE_ID|$GHOSTEX_HOME_DIRECTORY_NAME|$GHOSTEX_SHARED_HOME_DIRECTORY_NAME|$GHOSTEX_LID_SLEEP_HELPER_LABEL" \
		--value "sparkle=$GHOSTEX_SPARKLE_FEED_URL|$GHOSTEX_SPARKLE_PUBLIC_ED_KEY" \
		--value "cef-root=$(path_identity "$CEF_ROOT")" \
		--value "cef-helper=$(path_identity "$SCRIPT_DIR/build/cef-$GHOSTEX_MACOS_ARCH/ghostex-cef-helper")" \
		--value "ghostty-kit=$(path_identity "$GHOSTTY_KIT")" \
		--path "$SCRIPT_DIR/Sources" \
		--path "$SCRIPT_DIR/Resources" \
		--path "$SCRIPT_DIR/CEF" \
		--path "$SCRIPT_DIR/AppInfo.plist" \
		--path "$SCRIPT_DIR/HelperInfo.plist" \
		--path "$SCRIPT_DIR/project.yml" \
		--path "$SCRIPT_DIR/vendor-cef.sh"
}

sync_built_app_resources() {
	local resources_dir="$APP_PATH/Contents/Resources"
	mkdir -p "$resources_dir"
	rsync -a --delete "$WEB_DIR/" "$resources_dir/Web/"
	rsync -a --delete "$CLI_DIR/" "$resources_dir/CLI/"
}

sign_built_app_if_needed() {
	if can_reuse_build_app_signature; then
		echo "Built $GHOSTEX_APP_NAME signature is current; skipping build app re-sign."
		return 0
	fi
	# CDXC:MacOSPermissions 2026-06-16-02:27: Local starts now use a stable Apple signing identity when available so Screen Recording grants survive Ghostex rebuilds. Reuse cached app shells only when their existing signature matches the requested identity; a valid ad-hoc cdhash signature is not reusable for this permission-sensitive launch path.
	# CDXC:BetaDistribution 2026-06-06-01:04: The 4.0 beta release must run the Developer ID signing helper reliably from temporary release worktrees. Invoke the helper through bash explicitly because direct shebang execution can be killed by macOS provenance checks on this machine even though the same script succeeds under /bin/bash.
	/bin/bash "$SCRIPT_DIR/codesign-ghostex-host.sh" "$APP_PATH"
}

NATIVE_APP_CACHE_KEY="native-app-$GHOSTEX_APP_VARIANT-$GHOSTEX_MACOS_ARCH-$CONFIGURATION"
NATIVE_APP_DIGEST="$(build_native_app_digest)"
NATIVE_APP_REBUILT=0
if local_start_build_cache_reusable && cache_matches "$NATIVE_APP_CACHE_KEY" "$NATIVE_APP_DIGEST" "$APP_PATH/Contents/MacOS/$GHOSTEX_APP_NAME" "$APP_PATH/Contents/Frameworks/Chromium Embedded Framework.framework" "$APP_PATH/Contents/Frameworks/ghostex Helper.app" "$APP_PATH/Contents/Library/LaunchServices/$GHOSTEX_LID_SLEEP_HELPER_LABEL"; then
	# CDXC:LocalStartFast 2026-06-07-16:23: Debug/local starts should not invoke Xcode when native Swift/ObjC++, project metadata, CEF helper identity, and GhosttyKit identity are unchanged. Reuse the existing app shell, then sync current Web/CLI resources and let signature verification decide whether signing is needed.
	# CDXC:LocalStartFast 2026-06-15-10:46: Cached app shells must satisfy the same lid-sleep-helper bundle layout as freshly rebuilt shells. Remove any stale Contents/Resources helper copy before signing so `bun run start` does not fail when the valid helper is already in Contents/Library/LaunchServices.
	remove_lid_sleep_helper_resources_copy "$APP_PATH"
	echo "Native app shell is current; skipping Xcode build."
else
	mkdir -p "$SCRIPT_DIR/build"
	xcodegen generate --spec "$SCRIPT_DIR/project.yml"

	STALE_APP_PATH="$APP_PATH"
	if [[ -d "$STALE_APP_PATH/Contents/Frameworks" ]]; then
		# CDXC:ChromiumBrowserPanes 2026-05-04-17:00
		# CEF is copied after Xcode validation because the Spotify minimal framework
		# layout does not satisfy Xcode's generic framework validator. Incremental
		# builds must remove only the generated CEF payload before xcodebuild, then
		# copy and sign the runtime again after the app bundle is produced.
		# CDXC:Distribution 2026-05-15-15:16: Ghostex release builds must also
		# remove pre-rename zmux CEF helper bundles from incremental DerivedData
		# outputs so notarized DMGs do not ship obsolete helper app names.
		rm -rf \
			"$STALE_APP_PATH/Contents/Frameworks/Chromium Embedded Framework.framework" \
			"$STALE_APP_PATH"/Contents/Frameworks/ghostex\ Helper*.app \
			"$STALE_APP_PATH"/Contents/Frameworks/zmux\ Helper*.app
	fi

	xcodebuild \
		-project "$PROJECT_PATH" \
		-scheme ghostex \
		-configuration "$CONFIGURATION" \
		-destination "$XCODE_DESTINATION" \
		-derivedDataPath "$DERIVED_DATA" \
		ARCHS="$GHOSTEX_MACOS_ARCH" \
		ONLY_ACTIVE_ARCH=NO \
		build

	copy_cef_runtime "$APP_PATH"
	copy_lid_sleep_helper "$APP_PATH"
	NATIVE_APP_REBUILT=1
fi

sync_built_app_resources
sign_built_app_if_needed
if [[ "$NATIVE_APP_REBUILT" == "1" ]]; then
	write_cache_stamp "$NATIVE_APP_CACHE_KEY" "$NATIVE_APP_DIGEST"
fi

APP_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_PATH/Contents/Info.plist")"
printf '%s\n' "$APP_PATH" >"/tmp/ghostex-$APP_VERSION-$GHOSTEX_MACOS_ARCH-app-path"
if [[ -n "${GHOSTEX_BUILT_APP_PATH_FILE:-}" ]]; then
	mkdir -p "$(dirname "$GHOSTEX_BUILT_APP_PATH_FILE")"
	printf '%s\n' "$APP_PATH" >"$GHOSTEX_BUILT_APP_PATH_FILE"
fi

cat <<EOF

Built $GHOSTEX_APP_NAME.

Launch it from Xcode or with:
  open "$APP_PATH"
EOF
