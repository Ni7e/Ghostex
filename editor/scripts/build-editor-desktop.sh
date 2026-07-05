#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

bun editor/scripts/build-editor-web.mjs
cargo build --release --manifest-path editor/desktop/Cargo.toml

DIST="$ROOT/editor/dist/desktop"
mkdir -p "$DIST"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    cp "$ROOT/editor/desktop/target/release/ghostex-editor.exe" "$DIST/GhostexEditor.exe"
    ;;
  *)
    cp "$ROOT/editor/desktop/target/release/ghostex-editor" "$DIST/ghostex-editor"
    ;;
esac

mkdir -p "$DIST/web"
cp -R "$ROOT/editor/dist/web/." "$DIST/web/"
