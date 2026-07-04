---
name: ghostex-fable-5.5-orchestration
description: >-
  Use this skill to execute a multi-phase coding task with a Fable-planned,
  Codex-implemented, Fable-verified pipeline inside Ghostex: the invoking
  session plans inline and writes a phase plan file, launches one Codex
  (gpt-5.5) worker pane per phase through the Ghostex CLI, then launches a
  Fable verifier pane that checks every acceptance criterion, and spawns
  targeted Codex fixer panes for any findings until verification passes or
  the fix loop cap is reached.
---

# ghostex-fable-5.5-orchestration

Plan → implement → verify → fix pipeline over Ghostex panes:

- **Planner:** the invoking session (you), inline. No planner pane.
- **Workers:** Codex `gpt-5.5` panes, one per phase.
- **Verifier:** one Fable (`claude-fable-5`) pane, reused across re-verification rounds.
- **Fixers:** additional Codex panes, one per independent verifier finding.

Use `$ghostex-agent-orchestration` conventions for all CLI interaction; run
`ghostex --help` when unsure about command shapes.

## Step 0: Efforts and context

1. Resolve efforts. If the skill args contain `fable=<effort>` and/or
   `codex=<effort>` (also accept `5.5=<effort>`), use them. Otherwise ask the
   user two questions before doing anything else:
   - Fable effort for the verifier: `low` | `medium` | `high` (default `high`)
   - Codex effort for workers/fixers: `low` | `medium` | `high` | `xhigh`
     (default `high`)
2. Get placement so panes land in the right project regardless of UI focus:

   ```bash
   ghostex state
   ghostex sessions --json
   ```

   Record `projectId` and `groupId` and pass them explicitly to every
   `create-session` call.

## Step 1: Plan inline, write the plan file

You are the planner. Explore the repo as needed, then write the plan to
`docs/<today YYYY-MM-DD>/fable-plan-<slug>.md`. Workers start with zero
context, so every phase must be self-contained. Required structure per phase:

```markdown
## Phase <n>: <title>
- depends_on: [<phase numbers>]        # empty list = can start immediately
- parallel_ok: true|false              # true only if files are disjoint from every phase it could overlap with in time
- goal: <one paragraph, concrete>
- files: <exact files/dirs to touch>
- do_not_touch: <files/areas that other phases own>
- approach: <enough detail that a fresh agent will not re-derive the design>
- acceptance_criteria:
  - <verifiable statement, ideally with the command that proves it>
```

Also include a short header section with the overall goal and any repo rules
the workers must follow (e.g. no tests in the macOS app or gpui trees, no
fallback-instead-of-fix). Show the user a one-line-per-phase summary of the
plan before launching workers.

## Step 2: Launch Codex workers per phase

Respect the dependency graph: launch a phase only when everything in its
`depends_on` has printed its COMPLETE sentinel. Launch phases concurrently
only when every currently-running phase involved is marked `parallel_ok: true`
with disjoint `files`. When in doubt, run sequentially.

### Pane launch sequence (use this exact shape for workers, fixers, and the verifier)

Do NOT rely on `create-session --input` to run anything: gxserver creates
session rows lazily and startup text never types on its own. Always pass
`--start` (materializes the live terminal immediately) and then send the agent
command as text plus a **separate** Enter:

```bash
ghostex create-session "P<n>: <short title>" --project-id <projectId> --group-id <groupId> --start --json
# record .session.sessionId from the output as <sessionId>

ghostex send-text <sessionId> "codex --model gpt-5.5 -c model_reasoning_effort=<codexEffort> --dangerously-bypass-approvals-and-sandbox 'Read Phase <n> in <plan-file path> and implement exactly that phase. Do not touch anything listed in do_not_touch. When every acceptance criterion passes, print PHASE <n> COMPLETE followed by a 5-line summary of what you changed. If you cannot proceed, print PHASE <n> BLOCKED: reason and stop.'"
sleep 1
ghostex send-enter <sessionId>
```

Why separate sends: a trailing Enter inside the same send burst gets swallowed
as pasted text by bracketed-paste TUIs (Claude Code especially), leaving the
message staged but never submitted. `send-text` + `send-enter` are independent
zmx sends and work on every server version. (`send-message` performs both, but
always verify submission when you use it.)

**Verify the launch/submission before moving on** — this applies to every
message you send into any pane, including the verifier:

```bash
sleep 8
ghostex read-text <sessionId> --lines 15
```

If the pane still shows your typed command/message sitting unsubmitted on the
composer/prompt line, run `ghostex send-enter <sessionId>` again and re-check.
If the pane shows only a shell prompt with no typed text, the send targeted a
dead terminal — re-run the launch sequence from `send-text`.

Keep the inline prompt on one line and free of apostrophes/backslashes so
shell quoting survives. Details that must be long belong in the plan file,
not the launch prompt.

For sequential phases, include a 2-3 line summary of what the previous phase
actually did (from its COMPLETE summary) by appending it to a
`## Handoff notes` section of the plan file before launching the next worker.

### Monitoring

Use the CLI's built-in sentinel monitor — do not hand-roll read-text polling
loops:

```bash
ghostex wait-for-text <sessionId> "^\s*(. )?PHASE <n> (COMPLETE|BLOCKED)" --timeout-seconds 2700
```

- `wait-for-text` polls the pane, matches the regex **per scrollback line**,
  cross-checks session liveness every poll, and exits `0` printing the matched
  line, or `1` with a reason on timeout / dead pane. Add `--json` for
  structured output, `--interval-seconds n` (default 20) and `--lines n`
  (default 200) to tune.
- ALWAYS anchor sentinel patterns to the line start (`^\s*` plus an optional
  bullet prefix): agents stream their reasoning into the pane, and an
  unanchored pattern will false-match a sentinel mentioned mid-sentence
  ("...then I should print PHASE 1 BLOCKED"). Note the bullet Codex prefixes
  final messages with is a non-ASCII `•` — match it with `.` (any char) or
  `(• )?`, never assume plain ASCII.
- On exit 1, diagnose before acting: `ghostex read-text <sessionId> --lines 100`
  for the scrollback and `ghostex sessions --json` for lifecycle state. If the
  worker is genuinely stuck, report to the user rather than killing blindly.
- On `BLOCKED`: read the reason, fix the plan or unblock it yourself if
  trivial (answer via the send-text/send-enter sequence), otherwise stop and
  ask the user.
- **Leave completed worker panes open.** Do not kill or sleep them; the user
  inspects and cleans up manually.

## Step 3: Fable verification

When all phases are COMPLETE, launch one Fable verifier pane using the same
pane launch sequence from Step 2 (`create-session --start`, `send-text`,
`send-enter`, verify submission), with this pane title and prompt:

```
Title: "Verify: <slug>"
Prompt: claude --model claude-fable-5 --effort <fableEffort> --dangerously-skip-permissions 'Read <plan-file path>. Independently verify every acceptance criterion in every phase against the actual working tree: read the code, run the proving commands, do not trust the handoff notes. End your reply with exactly one of: VERIFICATION PASSED, or VERIFICATION FAILED followed by numbered findings, one per line, formatted as FINDING <k>: phase=<n> criterion=<which> evidence=<file:line or command output> fix=<what a fixer agent must do>.'
```

Then monitor:

```bash
ghostex wait-for-text <verifierSessionId> "^\s*VERIFICATION (PASSED|FAILED)" --timeout-seconds 3600
```

## Step 4: Fix loop (max 3 rounds)

On `VERIFICATION FAILED`:

1. Parse the findings. Group findings that touch the same files into one
   fixer; independent findings get their own fixer panes (parallel only if
   files are disjoint).
2. Launch each fixer with the Step 2 pane launch sequence, title
   `"Fix <k>: <short>"`, prompt:

   ```
   codex --model gpt-5.5 -c model_reasoning_effort=<codexEffort> --dangerously-bypass-approvals-and-sandbox 'Read <plan-file path>. The verifier found this issue: <finding text>. Fix the root cause properly, no fallbacks or workarounds. When the relevant acceptance criteria pass, print FIX <k> COMPLETE with a short summary; if blocked print FIX <k> BLOCKED: reason.'
   ```

   Monitor each with
   `ghostex wait-for-text <fixerSessionId> "^\s*(. )?FIX <k> (COMPLETE|BLOCKED)" --timeout-seconds 2700`.

3. When all fixers are COMPLETE, **reuse the existing verifier pane** so it
   keeps its context — do not launch a new one. Send the re-verify request
   with the separate-Enter sequence and confirm it actually submitted (this
   is the send most prone to the staged-but-unsubmitted failure, because the
   verifier is an idle Claude Code composer):

   ```bash
   ghostex send-text <verifierSessionId> "Fixes applied for findings <list>. Re-verify only those findings, not the full plan. Same output format: VERIFICATION PASSED or VERIFICATION FAILED with findings."
   sleep 1
   ghostex send-enter <verifierSessionId>
   sleep 8
   ghostex read-text <verifierSessionId> --lines 10   # must show the agent working, not the staged message
   ```

   Then wait for the round verdict. The old verdict is still in scrollback, so
   never match plain `VERIFICATION (PASSED|FAILED)` right after sending —
   first confirm via `read-text` that the verifier is running again, then use
   a modest `--lines` window (e.g. `--lines 60`) so the stale verdict scrolls
   out of the match window before the new one lands, and sanity-check the
   verdict against the visible scrollback before acting on it.

4. Repeat at most **3 rounds total**. If findings survive round 3, stop and
   report the remaining findings to the user with the verifier pane id so
   they can inspect.

## Step 5: Final report

Tell the user: plan file path, per-phase outcome, verifier verdict, fix
rounds used, and the list of open panes (workers, fixers, verifier) they may
want to review or close.

## Boundaries

- All pane control goes through the Ghostex CLI, never raw zmx/tmux.
- Never restart the Ghostex app or run `bun run start`.
- Model/launch strings are pinned: workers/fixers `codex --model gpt-5.5`,
  verifier `claude --model claude-fable-5`. If a launch fails on a model or
  effort value, surface the exact error to the user instead of guessing an
  alternative model.
