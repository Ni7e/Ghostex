#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
REPO_ROOT="$(release_gpui_repo_root)"
REFERENCES_ROOT="$(cd "$REPO_ROOT/../.." && pwd)/_references"

reference_url() {
  case "$1" in
    zed) printf '%s\n' "https://github.com/zed-industries/zed.git" ;;
    cef-rs) printf '%s\n' "https://github.com/tauri-apps/cef-rs.git" ;;
    gpui-component) printf '%s\n' "https://github.com/longbridge/gpui-component.git" ;;
    beads) printf '%s\n' "https://github.com/steveyegge/beads.git" ;;
  esac
}

reference_revision() {
  case "$1" in
    zed) printf '%s\n' "65e1c5af258d4c80036467d583691f3f9ded0897" ;;
    cef-rs) printf '%s\n' "0ddbc2accc06a3ac7f18e1543f752c3fb65161f2" ;;
    gpui-component) printf '%s\n' "0775df394083c1ed74f36f846b78868d1267398f" ;;
    beads) printf '%s\n' "672d942083a1fd0c8603fa1e77620c58ba9d47c8" ;;
  esac
}

mkdir -p "$REFERENCES_ROOT"
for name in zed cef-rs gpui-component beads; do
  if [[ "${GHOSTEX_RELEASE_ANDROID_ONLY:-0}" == "1" ]]; then
    break
  fi
  if [[ "${GHOSTEX_RELEASE_SKIP_GPUI_REFERENCES:-0}" == "1" && "$name" != "beads" ]]; then
    continue
  fi
  destination="$REFERENCES_ROOT/$name"
  revision="$(reference_revision "$name")"
  if [[ -d "$destination/.git" ]]; then
    current="$(git -C "$destination" rev-parse HEAD)"
    if [[ "$current" != "$revision" ]]; then
      cat >&2 <<EOF
GPUI reference $destination is at $current, expected $revision.
Refusing to alter an existing checkout because it may contain user work.
Use a clean CI checkout or update this reference manually.
EOF
      exit 1
    fi
    if [[ -n "$(git -C "$destination" status --porcelain --untracked-files=all)" ]]; then
      echo "GPUI reference checkout is dirty; refusing a non-reproducible release build: $destination" >&2
      exit 1
    fi
    continue
  fi
  if [[ -e "$destination" ]]; then
    echo "Reference path exists but is not a git checkout: $destination" >&2
    exit 1
  fi
  git clone --filter=blob:none --no-checkout "$(reference_url "$name")" "$destination"
  git -C "$destination" fetch --depth=1 origin "$revision"
  git -C "$destination" checkout --detach "$revision"
done

if [[ "${GHOSTEX_RELEASE_SKIP_SUBMODULES:-0}" != "1" ]]; then
  if [[ "${GHOSTEX_RELEASE_ANDROID_ONLY:-0}" == "1" ]]; then
    requested=(android)
  else
    requested=(code-server t3code zehn zmx)
  fi
  if [[ "${GHOSTEX_RELEASE_INCLUDE_ANDROID:-0}" == "1" && "${GHOSTEX_RELEASE_ANDROID_ONLY:-0}" != "1" ]]; then
    requested+=(android)
  fi
  git -C "$REPO_ROOT" submodule update --init --depth=1 -- "${requested[@]}"
  if [[ "${GHOSTEX_RELEASE_ANDROID_ONLY:-0}" != "1" ]]; then
    git -C "$REPO_ROOT/code-server" submodule update --init --depth=1 -- lib/vscode
  fi
fi

printf 'Prepared pinned GPUI references under %s\n' "$REFERENCES_ROOT"
