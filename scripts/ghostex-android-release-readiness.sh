#!/usr/bin/env bash
set -euo pipefail

#
# CDXC:AndroidReleaseE2E 2026-05-17-18:36:
# Ghostex Android release validation spans this macOS repo and the Android
# submodule. Keep one top-level runner for the Mac-side `ghostex android-check`
# contract, root CLI tests, Android source gates, release lint, APK/AAB build,
# connected-device E2E/UI smoke checks so release readiness is not reconstructed
# from scattered notes. Use `--local` for source/build validation when adb is
# unavailable; the default command is intentionally final-release strict.
#
# CDXC:AndroidReleaseSurface 2026-05-17-19:19:
# The non-local runner is a final release proof, so it must require publish
# signing instead of accepting a locally unsigned release build. Keep unsigned
# verification only in `--local`, and make UI smoke install the release variant.
#
# CDXC:AndroidReleaseSurface 2026-05-17-19:26:
# Final release proof also needs the live Mac target and disposable-device
# confirmation. Preflight every required environment variable before long
# source/build checks so a missing release credential or device-safety opt-in
# fails immediately instead of after most of the verifier has already run.
#
# CDXC:AndroidReleaseCI 2026-05-17-20:58:
# Local and strict release verification must generate and verify the APK/AAB
# SHA256SUMS that CI uploads. Keep the checksum task in the root runner so
# artifact handoff evidence is produced before connected-device QA begins.
#
# CDXC:AndroidReleaseSurface 2026-05-17-21:03:
# Strict release proof should inspect the generated APK/AAB signatures after
# Gradle builds them, not only preflight that signing environment variables were
# set. Keep unsigned artifact checks limited to `--local`; final proof must
# verify the install and publish artifacts before device QA starts.
#
# CDXC:AndroidReleaseSurface 2026-05-17-21:14:
# Signature inspection is shared with signed CI release candidates through the
# Android-side `ghostex-android-verify-release-signatures.sh` helper. Keep the
# root strict runner delegating to that helper so local and CI proof inspect the
# same APK/AAB artifact set.
#
# CDXC:AndroidReleaseE2E 2026-05-17-20:57:
# Final release proof must always run the Mac-side `ghostex android-check
# --json` readiness contract. Keep `--skip-mac-check` limited to `--local`
# source/build validation so the strict path cannot accidentally omit the live
# Ghostex/zmx Mac verification step.
#
# CDXC:AndroidReleaseSurface 2026-05-17-21:01:
# Final release proof should reject missing or in-checkout publish keystores at
# the root runner preflight, before Mac CLI, Gradle, or adb work begins. Keep
# Gradle's signing gate too, but fail the documented release command early when
# the signing material is not a real external file.
#
# CDXC:AndroidReleaseSurface 2026-05-25-18:18:
# The Android source now lives at the `android` submodule path instead of
# `android/termux-app`. Keep the strict signing preflight and Gradle/device
# checks rooted at that submodule so release validation does not fail before it
# can reject in-checkout keystore paths.
#

usage() {
  cat <<'EOF'
Usage:
  scripts/ghostex-android-release-readiness.sh [--local] [--skip-mac-check] [--skip-root-cli-tests]

Runs the release proof:
  1. Mac-side `ghostex android-check --json` readiness.
  2. Root Ghostex CLI tests.
  3. Android harness shell syntax checks.
  4. Android unit tests, instrumentation compilation, release APK, release AAB,
     APK/AAB checksums, release lint, and Ghostex Android release gates.
  5. Connected-device live E2E against a Tailscale-reachable Mac.
  6. Connected-device first-run UI smoke on a disposable emulator/device.

Required for the default final-release proof:
  GHOSTEX_ANDROID_HOST=<tailscale-host-or-ip>
  GHOSTEX_ANDROID_USER=<ssh-user>
  GHOSTEX_ANDROID_CONFIRM_CLEAR_DATA=1
  GHOSTEX_ANDROID_REQUIRE_RELEASE_SIGNING=1
  GHOSTEX_ANDROID_SIGNING_STORE_FILE=<external-keystore-path>
  GHOSTEX_ANDROID_SIGNING_STORE_PASSWORD=<keystore-password>
  GHOSTEX_ANDROID_SIGNING_KEY_ALIAS=<release-key-alias>
  GHOSTEX_ANDROID_SIGNING_KEY_PASSWORD=<release-key-password>
  Android build-tools apksigner and JDK jarsigner available on PATH or through ANDROID_HOME/ANDROID_SDK_ROOT
  Optional: GHOSTEX_ANDROID_PASSWORD, GHOSTEX_ANDROID_PORT, GHOSTEX_ANDROID_SESSION_ID,
            GHOSTEX_ANDROID_DEVICE, GHOSTEX_ANDROID_ADB, GHOSTEX_ANDROID_UI_SMOKE_APK

Options:
  --local           Skip connected-device E2E/UI smoke. This is useful for
                    source/build validation but is not final release proof.
  --skip-mac-check  Only with --local, for validating Android source changes on
                    a machine that is not the target Mac.
  --skip-root-cli-tests
                    Only with --local. Use when the calling CI workflow already
                    passed the root release test suite in a separate gate.
EOF
}

local_only=0
skip_mac_check=0
skip_root_cli_tests=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)
      local_only=1
      ;;
    --skip-mac-check)
      skip_mac_check=1
      ;;
    --skip-root-cli-tests)
      skip_root_cli_tests=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ "$skip_mac_check" == "1" && "$local_only" != "1" ]]; then
  cat >&2 <<'EOF'
--skip-mac-check requires --local.
Final Ghostex Android release proof must run the Mac-side
`ghostex android-check --json` readiness contract.
EOF
  exit 2
fi

if [[ "$skip_root_cli_tests" == "1" && "$local_only" != "1" ]]; then
  echo "--skip-root-cli-tests requires --local." >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
android_root="$repo_root/android"

resolve_existing_file_path() {
  local file="$1"
  local dir
  local base
  dir="$(cd "$(dirname "$file")" && pwd -P)" || return 1
  base="$(basename "$file")"
  if [[ ! -f "$dir/$base" ]]; then
    return 1
  fi
  printf '%s/%s\n' "$dir" "$base"
}

if [[ "$local_only" != "1" ]]; then
  missing=()
  invalid=()
  [[ "${GHOSTEX_ANDROID_REQUIRE_RELEASE_SIGNING:-}" == "1" ]] || missing+=("GHOSTEX_ANDROID_REQUIRE_RELEASE_SIGNING=1")
  [[ -n "${GHOSTEX_ANDROID_SIGNING_STORE_FILE:-}" ]] || missing+=("GHOSTEX_ANDROID_SIGNING_STORE_FILE")
  [[ -n "${GHOSTEX_ANDROID_SIGNING_STORE_PASSWORD:-}" ]] || missing+=("GHOSTEX_ANDROID_SIGNING_STORE_PASSWORD")
  [[ -n "${GHOSTEX_ANDROID_SIGNING_KEY_ALIAS:-}" ]] || missing+=("GHOSTEX_ANDROID_SIGNING_KEY_ALIAS")
  [[ -n "${GHOSTEX_ANDROID_SIGNING_KEY_PASSWORD:-}" ]] || missing+=("GHOSTEX_ANDROID_SIGNING_KEY_PASSWORD")
  [[ -n "${GHOSTEX_ANDROID_HOST:-}" ]] || missing+=("GHOSTEX_ANDROID_HOST")
  [[ -n "${GHOSTEX_ANDROID_USER:-}" ]] || missing+=("GHOSTEX_ANDROID_USER")
  [[ "${GHOSTEX_ANDROID_CONFIRM_CLEAR_DATA:-}" == "1" ]] || missing+=("GHOSTEX_ANDROID_CONFIRM_CLEAR_DATA=1")

  if [[ "${#missing[@]}" -gt 0 ]]; then
    cat >&2 <<'EOF'
Final Ghostex Android release proof requires publish signing, a live SSH target,
and explicit disposable-device confirmation.
Set:
  GHOSTEX_ANDROID_HOST
  GHOSTEX_ANDROID_USER
  GHOSTEX_ANDROID_CONFIRM_CLEAR_DATA=1
  GHOSTEX_ANDROID_REQUIRE_RELEASE_SIGNING=1
  GHOSTEX_ANDROID_SIGNING_STORE_FILE
  GHOSTEX_ANDROID_SIGNING_STORE_PASSWORD
  GHOSTEX_ANDROID_SIGNING_KEY_ALIAS
  GHOSTEX_ANDROID_SIGNING_KEY_PASSWORD

Use --local for unsigned source/build validation.
EOF
    printf 'Missing or invalid:\n' >&2
    printf '  - %s\n' "${missing[@]}" >&2
    exit 2
  fi

  android_root_path="$(cd "$android_root" && pwd -P)"
  if ! signing_store_path="$(resolve_existing_file_path "$GHOSTEX_ANDROID_SIGNING_STORE_FILE")"; then
    invalid+=("GHOSTEX_ANDROID_SIGNING_STORE_FILE does not exist: $GHOSTEX_ANDROID_SIGNING_STORE_FILE")
    signing_store_dir="$(cd "$(dirname "$GHOSTEX_ANDROID_SIGNING_STORE_FILE")" 2>/dev/null && pwd -P || true)"
    if [[ -n "$signing_store_dir" ]]; then
      signing_store_candidate="$signing_store_dir/$(basename "$GHOSTEX_ANDROID_SIGNING_STORE_FILE")"
      case "$signing_store_candidate" in
        "$android_root_path" | "$android_root_path"/*)
          invalid+=("GHOSTEX_ANDROID_SIGNING_STORE_FILE must live outside the Android checkout: $GHOSTEX_ANDROID_SIGNING_STORE_FILE")
          ;;
      esac
    fi
  else
    case "$signing_store_path" in
      "$android_root_path" | "$android_root_path"/*)
        invalid+=("GHOSTEX_ANDROID_SIGNING_STORE_FILE must live outside the Android checkout: $GHOSTEX_ANDROID_SIGNING_STORE_FILE")
        ;;
    esac
  fi

  if [[ "${#invalid[@]}" -gt 0 ]]; then
    cat >&2 <<'EOF'
Final Ghostex Android release proof requires external publish signing material.
Use a keystore file that exists and is stored outside the Android checkout.
EOF
    printf 'Invalid release signing configuration:\n' >&2
    printf '  - %s\n' "${invalid[@]}" >&2
    exit 2
  fi
  export GHOSTEX_ANDROID_UI_SMOKE_BUILD="${GHOSTEX_ANDROID_UI_SMOKE_BUILD:-release}"
fi

run() {
  printf '\n+'
  printf ' %q' "$@"
  printf '\n'
  "$@"
}

if [[ "$skip_mac_check" != "1" ]]; then
  # CDXC:GhostexRustCli 2026-07-13: the CLI is the native Rust binary now.
  run cargo build --quiet --manifest-path "$repo_root/gxserver-rs/Cargo.toml" --bin ghostex
  run "$repo_root/gxserver-rs/target/debug/ghostex" android-check --json
fi

if [[ "$skip_root_cli_tests" != "1" ]]; then
  run cargo test --quiet --manifest-path "$repo_root/gxserver-rs/Cargo.toml" --lib ghostex_cli
fi

cd "$android_root"
run bash -n tools/ghostex-android-adb.sh tools/ghostex-android-device-e2e.sh tools/ghostex-android-ui-smoke.sh tools/ghostex-android-verify-release-signatures.sh
run ./gradlew --no-daemon \
  :app:testDebugUnitTest \
  :app:compileDebugAndroidTestJavaWithJavac \
  :app:assembleRelease \
  :app:bundleRelease \
  :app:verifyGhostexReleaseChecksums \
  :app:lintRelease

if [[ "$local_only" == "1" ]]; then
  cat <<'EOF'

Skipped connected-device E2E.
Skipped first-run UI smoke.
This --local pass is not final release proof. Run without --local after
connecting a phone/emulator and setting GHOSTEX_ANDROID_HOST,
GHOSTEX_ANDROID_USER, and GHOSTEX_ANDROID_CONFIRM_CLEAR_DATA=1.
EOF
  exit 0
fi

run tools/ghostex-android-verify-release-signatures.sh
run tools/ghostex-android-device-e2e.sh
run tools/ghostex-android-ui-smoke.sh
