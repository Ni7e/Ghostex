#!/usr/bin/env node
/*
 * CDXC:ReleaseChangeAwarePlanning 2026-08-13:
 * Just-in-time wait for artifacts produced by *this* workflow run.
 *
 * This is what replaces the artificial `needs: gxserver_*` edges (§Q5). macOS,
 * Linux, Windows, and the WSL packagers never needed gxserver to *finish before
 * they start compiling* — they needed its tarball at the moment they stage a
 * package. Waiting here instead of in the job graph lets every platform's
 * compiler errors surface at t≈2 min instead of t≈22 min.
 *
 * The wait is bounded and fails with a named artifact list: a job that hangs to
 * its 150-minute timeout tells the operator nothing, and blocks a runner the
 * whole time.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyError } from "./failure-classification.mjs";
import { withRetryProfile } from "./retry.mjs";

export const DEFAULT_TIMEOUT_MINUTES = 45;
export const DEFAULT_POLL_SECONDS = 15;

/*
 * One transient `gh api` failure at minute 25 of a 45-minute poll must not kill a
 * platform job that is otherwise healthy. The listing is a pure observation, so a
 * failed poll is simply not an observation: the loop keeps going until either the
 * artifacts appear, the deadline passes, or the API has been unreachable this many
 * polls in a row — at which point something structural is wrong and failing loudly
 * beats waiting silently.
 */
export const MAX_CONSECUTIVE_LIST_FAILURES = 5;

export function parseAwaitArgs(argv) {
  const options = {
    dest: null,
    names: [],
    pollSeconds: DEFAULT_POLL_SECONDS,
    repo: process.env.GITHUB_REPOSITORY ?? "maddada/Ghostex",
    runId: process.env.GITHUB_RUN_ID ?? "",
    timeoutMinutes: DEFAULT_TIMEOUT_MINUTES,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--names") {
      options.names = String(value ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
    } else if (argument === "--dest") options.dest = value;
    else if (argument === "--run-id") options.runId = value;
    else if (argument === "--repo") options.repo = value;
    else if (argument === "--timeout-minutes") options.timeoutMinutes = Number(value);
    else if (argument === "--poll-seconds") options.pollSeconds = Number(value);
    else throw new Error(`Unknown option: ${argument}`);
    index += 1;
  }
  if (options.names.length === 0) throw new Error("--names <a,b> is required");
  if (!/^\d+$/u.test(String(options.runId))) throw new Error("--run-id (or GITHUB_RUN_ID) is required");
  if (!Number.isFinite(options.timeoutMinutes) || options.timeoutMinutes <= 0) {
    throw new Error("--timeout-minutes must be a positive number");
  }
  return options;
}

/* Names of every non-expired artifact currently uploaded by the run. */
export function listRunArtifacts({ repo, runId, run = spawnSync }) {
  const result = run("gh", ["api", `repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`gh api artifacts failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  const payload = JSON.parse(result.stdout);
  return new Set((payload.artifacts ?? []).filter((artifact) => !artifact.expired).map((artifact) => artifact.name));
}

export function missingArtifacts(names, available) {
  return names.filter((name) => !available.has(name));
}

function sleepSeconds(seconds) {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, seconds * 1000);
}

export async function awaitRunArtifacts(options, { list = listRunArtifacts, sleep = sleepSeconds } = {}) {
  const started = Date.now();
  const deadline = started + options.timeoutMinutes * 60_000;
  let pending = [...options.names];
  let announced = false;
  let consecutiveListFailures = 0;
  while (true) {
    let available = null;
    try {
      available = list({ repo: options.repo, runId: options.runId });
      consecutiveListFailures = 0;
    } catch (error) {
      consecutiveListFailures += 1;
      const message = error instanceof Error ? error.message : String(error);
      if (consecutiveListFailures >= MAX_CONSECUTIVE_LIST_FAILURES) {
        throw new Error(
          `Could not list run ${options.runId} artifacts ${consecutiveListFailures} times in a row ` +
            `(still waiting for ${pending.join(", ")}): ${message}`,
        );
      }
      process.stdout.write(
        `::warning::Artifact listing attempt ${consecutiveListFailures}/${MAX_CONSECUTIVE_LIST_FAILURES} ` +
          `failed, retrying: ${message}\n`,
      );
    }
    if (available) {
      pending = missingArtifacts(options.names, available);
      if (pending.length === 0) return { waitedMs: Date.now() - started };
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${options.timeoutMinutes} minutes waiting for run ${options.runId} artifacts: ${pending.join(", ")}`,
      );
    }
    if (!announced) {
      process.stdout.write(`::notice::Waiting for run artifacts: ${pending.join(", ")}\n`);
      announced = true;
    }
    sleep(options.pollSeconds);
  }
}

/*
 * The await step has already proved every named artifact exists, so the only ways
 * the download can fail are transport ones. Classification still owns the fatal
 * signatures (an integrity or Ghostex refusal is never retried); everything it
 * cannot name is retried here, because re-downloading an artifact that provably
 * exists is idempotent and the alternative is losing a whole platform job.
 */
export function classifyArtifactDownloadFailure(error) {
  const classification = classifyError(error);
  if (classification.category === "fatal") return classification;
  return { ...classification, retryable: true };
}

export async function downloadRunArtifacts({ dest, names, repo, retryOverrides = {}, run = spawnSync, runId }) {
  mkdirSync(dest, { recursive: true });
  for (const name of names) {
    await withRetryProfile(
      () => {
        const result = run(
          "gh",
          ["run", "download", String(runId), "--repo", repo, "--name", name, "--dir", path.join(dest, name)],
          { encoding: "utf8", stdio: ["ignore", "inherit", "pipe"] },
        );
        if (result.error) throw result.error;
        if (result.status !== 0) {
          throw new Error(`gh run download ${name} failed: ${(result.stderr ?? "").toString().trim()}`);
        }
        return result;
      },
      "github",
      { classify: classifyArtifactDownloadFailure, label: `gh run download ${name}`, ...retryOverrides },
    );
  }
}

async function main() {
  const options = parseAwaitArgs(process.argv.slice(2));
  const { waitedMs } = await awaitRunArtifacts(options);
  const seconds = Math.round(waitedMs / 1000);
  process.stdout.write(`Run artifacts available after ${seconds}s: ${options.names.join(", ")}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `- Awaited run artifacts (${options.names.join(", ")}): ${seconds}s\n`,
    );
  }
  if (options.dest) {
    await downloadRunArtifacts({
      dest: options.dest,
      names: options.names,
      repo: options.repo,
      runId: options.runId,
    });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
