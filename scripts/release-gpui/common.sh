#!/usr/bin/env bash
set -euo pipefail

release_gpui_repo_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd
}

release_gpui_require_version() {
  local version="${1:-}"
  if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Version must be MAJOR.MINOR.PATCH, got: ${version:-<empty>}" >&2
    exit 2
  fi
}

release_gpui_build_number() {
  local version="$1"
  local major minor patch
  IFS=. read -r major minor patch <<<"$version"
  printf '%d\n' "$((10#$major * 10000 + 10#$minor * 100 + 10#$patch))"
}

release_gpui_default_output() {
  local repo_root="$1"
  local version="$2"
  local platform="$3"
  printf '%s/build/release-gpui/%s/%s\n' "$repo_root" "$version" "$platform"
}

release_gpui_prepare_output() {
  local repo_root="$1"
  local output="$2"
  case "$output" in
    "$repo_root"/build/release-gpui/*) ;;
    *)
      echo "Release output must stay under $repo_root/build/release-gpui: $output" >&2
      exit 2
      ;;
  esac
  rm -rf "$output"
  mkdir -p "$output"
}

release_gpui_sha256() {
  local file="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    sha256sum "$file" | awk '{print $1}'
  fi
}

release_gpui_write_manifest() {
  local output="$1"
  local platform="$2"
  local version="$3"
  shift 3
  local manifest="$output/manifest.json"
  RELEASE_GPUI_MANIFEST_PLATFORM="$platform" \
  RELEASE_GPUI_MANIFEST_VERSION="$version" \
  RELEASE_GPUI_MANIFEST_OUTPUT="$output" \
  node - "$@" <<'JS'
const { createHash } = require("node:crypto");
const { readFileSync, statSync, writeFileSync } = require("node:fs");
const { basename, join } = require("node:path");

const output = process.env.RELEASE_GPUI_MANIFEST_OUTPUT;
const artifacts = process.argv.slice(2).map((file) => {
  const bytes = readFileSync(file);
  return {
    name: basename(file),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: statSync(file).size,
  };
});
writeFileSync(join(output, "manifest.json"), `${JSON.stringify({
  artifacts,
  platform: process.env.RELEASE_GPUI_MANIFEST_PLATFORM,
  schemaVersion: 1,
  version: process.env.RELEASE_GPUI_MANIFEST_VERSION,
}, null, 2)}\n`);
JS
}

release_gpui_require_command() {
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required command is missing: $command_name" >&2
    exit 1
  }
}
