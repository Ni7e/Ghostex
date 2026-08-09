#!/usr/bin/env bash
set -euo pipefail

SOURCE="${1:-}"
OUTPUT="${2:-}"
PLATFORM_MODE="${3:-}"
[[ -d "$SOURCE" ]] || { echo "Component staging directory is missing: $SOURCE" >&2; exit 2; }
[[ -n "$OUTPUT" ]] || { echo "Usage: create-deterministic-tar.sh SOURCE_DIR OUTPUT.tar.gz [--windows-component]" >&2; exit 2; }
[[ -z "$PLATFORM_MODE" || "$PLATFORM_MODE" == "--windows-component" ]] || {
  echo "Unknown deterministic tar platform mode: $PLATFORM_MODE" >&2
  exit 2
}

mkdir -p "$(dirname "$OUTPUT")"
OUTPUT="$(cd "$(dirname "$OUTPUT")" && pwd)/$(basename "$OUTPUT")"
ARCHIVE="$OUTPUT.tar.$$"
FILE_LIST="$OUTPUT.files.$$"
trap 'rm -f "$ARCHIVE" "$FILE_LIST"' EXIT

# Component versions are immutable, so retries from identical source must
# reproduce the same digest regardless of checkout/npm extraction timestamps
# or the build machine's local timezone. `touch -t` otherwise interprets this
# wall-clock value in local time, producing different tar headers across CI and
# developer machines.
TZ=UTC find "$SOURCE" -exec touch -h -t 200001010000 {} +
if [[ "$PLATFORM_MODE" == "--windows-component" ]]; then
  # DrvFs presents ordinary Windows files as executable depending on the WSL
  # mount configuration. Normalize archive modes so a Windows-hosted build and
  # a native Linux CI build produce the same immutable component digest.
  find "$SOURCE" -type f -exec chmod 0644 {} +
  find "$SOURCE" -type f \( -iname '*.dll' -o -iname '*.exe' \) -exec chmod 0755 {} +
fi
(
  cd "$SOURCE"
  find . -mindepth 1 ! -type d -print0 | LC_ALL=C sort -z >"$FILE_LIST"
  if tar --version 2>&1 | grep -qi bsdtar; then
    COPYFILE_DISABLE=1 tar --uid 0 --gid 0 --uname root --gname root --null -T "$FILE_LIST" -cf "$ARCHIVE"
  else
    tar --owner=0 --group=0 --numeric-owner --null --files-from "$FILE_LIST" -cf "$ARCHIVE"
  fi
)
gzip -n -c "$ARCHIVE" >"$OUTPUT"
