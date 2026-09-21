#!/usr/bin/env bash
#
# THE gate for the chat core. One command, one summary table.
#
#   bun tooling/gx-chat-core/run-gates.sh          # everything
#   tooling/gx-chat-core/run-gates.sh --fast       # skip the wasm build and clippy
#   tooling/gx-chat-core/run-gates.sh --regenerate # rebuild the recordings and fixtures first
#
# What it runs, in order:
#
#  1. `cargo build`, the wasm32 build, and clippy: the crate must stay platform neutral and warning
#     free (`docs/2026-09-21/rust-chat/AGENT-RULES.md`).
#  2. `document_roundtrip` over the 24 Chat Lab samples: every one of the document's 84 keys
#     deserializes and reserializes to the same value.
#  3. The full replay, on every recording under /tmp/gx-chat: the TypeScript brain and the Rust
#     core are fed the same inputs and their document sequences are diffed line by line.
#  4. The per-family checks that cover ground no recording reaches (`transcript_check`'s 58
#     projection cases, `extras_parity`'s invented table, `extras_check`'s wiring, `e1_check`,
#     `questions_check`, `question_exchange_check`, `composer_check`).
#
# Recordings hold the user's conversation. Nothing here prints a record's arguments or a
# document's contents: the report is counts and JSON pointers only.
#
# Two pointers are excluded from the document diff, and the reason is printed with the table:
#
#  * `/requests` is the QuickJS bridge's wire form, not the core's contract. Client storage rides
#    on it there (`composer('read')`, `composer('summary')`) and is an `Effect` here, and its ids
#    come off a counter the TypeScript shares with its timers. The Rust host consumes
#    `Vec<Effect>` and builds no `requests` array at all.
#  * `/revision` and `/nextWakeMs` are the two counters that only agree once EVERY publish and
#    EVERY timer agree, including the ones between two drains that no document can show. They are
#    reported separately below so the gap stays visible rather than being hidden by the exclusion.
#
# The replay is timezone dependent: `message-time.ts` groups rows by LOCAL midnight and the
# recordings were made on a machine at this offset, so the Rust half is given `date +%z` rather
# than UTC.

set -u

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
crate="$root/packages/gx-chat-core"
recordings="/tmp/gx-chat"
fast=0
regenerate=0
for argument in "$@"; do
  case "$argument" in
    --fast) fast=1 ;;
    --regenerate) regenerate=1 ;;
    *) echo "unknown option: $argument" >&2; exit 2 ;;
  esac
done

# `date +%z` is `+HHMM`; the core wants minutes east of UTC.
offset_text="$(date +%z)"
offset_sign="${offset_text:0:1}"
offset_minutes=$(( 10#${offset_text:1:2} * 60 + 10#${offset_text:3:2} ))
[ "$offset_sign" = "-" ] && offset_minutes=$(( -offset_minutes ))

rows=()
failures=0

record() {
  rows+=("$1|$2|$3")
  [ "$2" = "FAIL" ] && failures=$(( failures + 1 ))
  return 0
}

run() {
  local name="$1"; shift
  local output
  if output="$("$@" 2>&1)"; then
    record "$name" "ok" "$(printf '%s' "$output" | tail -n 1)"
  else
    record "$name" "FAIL" "$(printf '%s' "$output" | tail -n 1)"
    printf '%s\n' "$output" | sed 's/^/    /'
  fi
}

if [ "$regenerate" = "1" ]; then
  for generator in synthetic-recording synthetic-c synthetic-e1 synthetic-send synthetic-composer synthetic-b extras-parity; do
    run "generate $generator" bun "$root/tooling/gx-chat-core/$generator.ts"
  done
  run "generate samples" bun "$root/tooling/gx-chat-core/sample-document.ts"
fi

cd "$crate" || exit 2

run "cargo build" cargo build --all-targets
if [ "$fast" = "0" ]; then
  run "wasm32 build" cargo build --target wasm32-unknown-unknown
  run "clippy" cargo clippy --all-targets -- -D warnings
fi

# --- the document contract -------------------------------------------------
samples=("$recordings"/samples/*.json)
if [ -e "${samples[0]}" ]; then
  run "document_roundtrip" cargo run --release --quiet --example document_roundtrip -- "${samples[@]}"
else
  record "document_roundtrip" "skip" "no samples; run with --regenerate"
fi

# --- the full replay -------------------------------------------------------
shopt -s nullglob
for recording in "$recordings"/*.jsonl; do
  name="$(basename "$recording" .jsonl)"
  expected="$recordings/expected/$name.jsonl"
  if [ ! -f "$expected" ]; then
    run "replay-typescript $name" bun "$root/tooling/gx-chat-core/replay-typescript.ts" "$recording"
  fi
  rust="$(cargo run --release --quiet --example replay -- --utc-offset "$offset_minutes" "$recording" 2>&1)"
  queries="$(printf '%s' "$rust" | grep '^queries' | awk '{print $2}')"
  unanswered="$(printf '%s' "$rust" | grep '^requests' | awk '{print $2}')"
  record "replay $name queries" "$([ "${queries%%/*}" = "${queries##*/}" ] && echo ok || echo FAIL)" "$queries fingerprints"
  record "replay $name requests" "$([ "${unanswered:-0}" = "0" ] && echo ok || echo FAIL)" "$unanswered unanswered"
  if [ -s "$expected" ]; then
    diff_output="$(bun "$root/tooling/gx-chat-core/replay-diff.ts" "$name" \
      --ignore /requests,/revision,/nextWakeMs --limit 8 2>&1)"
    matched="$(printf '%s' "$diff_output" | grep '^matched' | awk '{print $2}')"
    strict="$(bun "$root/tooling/gx-chat-core/replay-diff.ts" "$name" --limit 0 2>&1 |
      grep '^matched' | awk '{print $2}')"
    status="$([ "${matched%%/*}" = "${matched##*/}" ] && echo ok || echo FAIL)"
    record "documents $name" "$status" "$matched documents (strict, with /requests: $strict)"
    [ "$status" = "FAIL" ] && printf '%s\n' "$diff_output" | sed -n '5,20p' | sed 's/^/    /'
  fi
done
shopt -u nullglob

# --- the per-family checks the recordings cannot reach ---------------------
run "transcript_check" cargo run --release --quiet --example transcript_check
run "extras_parity" cargo run --release --quiet --example extras_parity
run "extras_check" cargo run --release --quiet --example extras_check
run "e1_check" cargo run --release --quiet --example e1_check
run "questions_check" cargo run --release --quiet --example questions_check
run "question_exchange_check" cargo run --release --quiet --example question_exchange_check
run "composer_check" cargo run --release --quiet --example composer_check

# --- the table -------------------------------------------------------------
printf '\n%-34s %-6s %s\n' "gate" "result" "detail"
printf '%-34s %-6s %s\n' "----------------------------------" "------" "------------------------------------"
for row in "${rows[@]}"; do
  printf '%-34s %-6s %s\n' "${row%%|*}" "$(printf '%s' "$row" | cut -d'|' -f2)" "$(printf '%s' "$row" | cut -d'|' -f3-)"
done
printf '\nexcluded from the document diff: /requests (the QuickJS bridge wire form, not the core),\n'
printf 'plus /revision and /nextWakeMs (the publish and timer counters, shown strictly above).\n'
printf 'utc offset fed to the Rust replay: %s minutes (%s)\n' "$offset_minutes" "$offset_text"

exit $(( failures > 0 ))
