#!/bin/bash
# Builds the wasm module and its JavaScript glue into www/src/wasm. Pass --release for an optimized build.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# libghostty-vt as a static wasm32 archive: the desktop's build (apps/desktop/scripts/build-libghostty-vt.sh) with a wasm target. Built once; delete target/libghostty-vt-wasm to rebuild after a Ghostty sync.
vt_prefix="$PWD/target/libghostty-vt-wasm"
if [[ ! -f "$vt_prefix/lib/libghostty-vt.a" ]]; then
  zig="${GHOSTEX_ZIG:-/opt/homebrew/opt/zig@0.16/bin/zig}"
  [[ -x "$zig" ]] || zig="$(command -v zig)"
  ghostty="$PWD/../../.dependencies/ghostty"
  version="$(sed -n -E 's/^[[:space:]]*\.version[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "$ghostty/build.zig.zon" | head -n 1)"
  (cd "$ghostty" && "$zig" build -Dversion-string="$version" -Demit-lib-vt=true -Demit-lib-vt-shared=false \
    -Demit-xcframework=false -Doptimize=ReleaseSmall -Dtarget=wasm32-freestanding --prefix "$vt_prefix")
fi

if [[ "${1:-}" == "--release" ]]; then
  mode=release
  cargo build --target wasm32-unknown-unknown --release
else
  mode=debug
  cargo build --target wasm32-unknown-unknown
fi
(cd ../.. && bun apps/gpui-web/build-chat-bundle.mjs apps/gpui-web/www/public/chat-runtime.js)
wasm-bindgen "target/wasm32-unknown-unknown/$mode/ghostex_gpui_web.wasm" \
  --out-dir www/src/wasm --target web --no-typescript
