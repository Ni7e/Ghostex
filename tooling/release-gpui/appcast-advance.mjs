/*
 * Sparkle feed advancement shared by the release publishers.
 *
 * CDXC:Release 2026-08-30 WHY:
 * `origin/main` moves while a multi-hour build runs, because several agents
 * share this checkout. 8.3.0 lost an entire dispatch to that: all eleven
 * products had built and publication was refused because an unrelated mobile
 * submodule bump landed while the runners worked.
 *
 * Drift is only safe to absorb when it is a pure fast-forward: the commit we
 * built is still in main's history, so nothing that went into these artifacts
 * was rewritten or rolled back. Divergence stays fatal, because then the
 * artifacts describe source that main no longer has.
 *
 * CDXC:Release 2026-09-15 WHY:
 * Lifted out of assemble.mjs so the amend publisher advances Sparkle the same
 * tolerant way. In a staged release the macOS stage frequently amends a release
 * another stage created, and by then main has usually moved.
 * SEE-ALSO: assemble.mjs, amend-existing.mjs, publish-stage.mjs.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    ...(options.env ? { env: options.env } : {}),
    ...(options.input === undefined ? {} : { input: options.input }),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed${result.stderr ? `\n${result.stderr}` : ''}`);
  }
  return result.stdout?.trim() ?? '';
}

export function appcastReferencesRelease(xml, buildNumber, version) {
  const build = String(buildNumber).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const hasBuildElement = new RegExp(`<sparkle:version>\\s*${build}\\s*</sparkle:version>`, 'u').test(xml);
  const hasBuildAttribute = new RegExp(`sparkle:version\\s*=\\s*["']${build}["']`, 'u').test(xml);
  return (hasBuildElement || hasBuildAttribute) && xml.includes(`ghostex-${version}-arm64.dmg`);
}

export function readLiveAppcast() {
  const response = spawnSync('gh', ['api', 'repos/maddada/Ghostex/contents/appcast.xml?ref=main'], {
    encoding: 'utf8',
  });
  if (response.status !== 0) return '';
  const encoded = JSON.parse(response.stdout).content?.replace(/\s/gu, '') ?? '';
  return Buffer.from(encoded, 'base64').toString('utf8');
}

export function resolveRemoteMain() {
  const remoteMain = run('git', ['ls-remote', 'origin', 'refs/heads/main'], { capture: true }).split(/\s+/)[0];
  if (!remoteMain) throw new Error('Could not resolve origin/main');
  return remoteMain;
}

export function classifyMainDrift(builtCommit) {
  const remoteMain = resolveRemoteMain();
  if (remoteMain === builtCommit) return { kind: 'unchanged', remoteMain };
  run('git', ['fetch', '--no-tags', 'origin', 'main']);
  if (spawnSync('git', ['merge-base', '--is-ancestor', builtCommit, remoteMain]).status !== 0) {
    throw new Error(
      `origin/main diverged from the built source during the build (${builtCommit} is not an ancestor of ${remoteMain}); refusing partial publication`
    );
  }
  return { kind: 'advanced', remoteMain };
}

/*
 * Build `origin/main`-plus-this-appcast without touching the runner's working
 * tree or index. Plumbing rather than cherry-pick: the final content of
 * appcast.xml is already known exactly, so there is nothing to merge and no
 * conflict to resolve, and every other path keeps whatever landed during the
 * build byte-for-byte.
 */
export function commitAppcastOnto({ appcastXml, message, parent }) {
  const blob = run('git', ['hash-object', '-w', '--stdin'], { capture: true, input: appcastXml });
  const indexDirectory = mkdtempSync(path.join(os.tmpdir(), 'ghostex-release-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(indexDirectory, 'index') };
  try {
    run('git', ['read-tree', parent], { capture: true, env });
    run('git', ['update-index', '--add', '--cacheinfo', `100644,${blob},appcast.xml`], { capture: true, env });
    const tree = run('git', ['write-tree'], { capture: true, env });
    return run('git', ['commit-tree', tree, '-p', parent, '-m', message], { capture: true });
  } finally {
    rmSync(indexDirectory, { force: true, recursive: true });
  }
}

/*
 * Advance the Sparkle feed on `main`. The tag is never moved to accommodate
 * drift: it keeps pointing at the exact commit that was built and signed. When
 * main has moved on, the appcast bump is replayed on top of it instead, so the
 * advance can never revert work that landed during the build.
 *
 * `main` can move again between resolving it and pushing, so a rejected push is
 * retried against the newer tip rather than treated as a failure.
 */
export function advanceMainWithAppcast({ appcastCommit, appcastXml, builtCommit, message, version }) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const drift = classifyMainDrift(builtCommit);
    if (drift.kind === 'unchanged') {
      run('git', ['push', 'origin', `${appcastCommit}:main`]);
      return 'fast-forward';
    }
    const replayed = commitAppcastOnto({ appcastXml, message, parent: drift.remoteMain });
    const push = spawnSync('git', ['push', 'origin', `${replayed}:main`], { encoding: 'utf8', stdio: 'pipe' });
    if (push.status === 0) {
      console.log(
        `origin/main advanced during the build; replayed the ${version} appcast bump onto ${drift.remoteMain.slice(0, 10)} as ${replayed.slice(0, 10)}.`
      );
      return 'replayed';
    }
    console.log(`origin/main moved again while advancing Sparkle; retrying (attempt ${attempt} of 3).`);
  }
  throw new Error(`Could not advance origin/main with the ${version} appcast bump after 3 attempts`);
}

/* Poll the Contents API until the feed carries this release, or give up. */
export function waitForLiveAppcast({ buildNumber, version, attempts = 12, sleepSeconds = 5 }) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const xml = readLiveAppcast();
    if (appcastReferencesRelease(xml, buildNumber, version)) return xml;
    spawnSync('sleep', [String(sleepSeconds)]);
  }
  throw new Error(`Live appcast did not advance to ${version} (${buildNumber})`);
}

export function releaseBuildNumber(version) {
  const [major, minor, patch] = version.split('.').map(Number);
  return major * 10000 + minor * 100 + patch;
}
