#!/usr/bin/env node
/*
 * Prove that every patch under tooling/release-gpui/patches/ still applies to
 * the submodule it targets, before a release is dispatched.
 *
 * CDXC:Release 2026-09-15 WHY:
 * 9.5.1 lost its first dispatch 30 seconds into both code-server component
 * jobs: the ripgrep patch no longer applied after the code-server pin moved,
 * and nothing before dispatch had checked it. A patch is accepted when it
 * applies forward, or applies in reverse (already part of the checkout, which
 * is how the pinned first-party forks carry their patches).
 */

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
export const PATCH_DIRECTORY = path.join(repoRoot, 'tooling/release-gpui/patches');

/*
 * Patch file prefix -> submodule a release workflow applies the patch to.
 * Only code-server patches are applied at build time
 * (release-gpui-code-server.yml). The gpui-component and zed patches in the
 * same directory document changes already committed to the pinned first-party
 * forks and are applied by nothing, so they are reported as informational.
 */
export const PATCH_TARGETS = Object.freeze({
  'code-server': '.dependencies/code-server',
});

export function patchTarget(fileName) {
  const prefix = Object.keys(PATCH_TARGETS)
    .sort((left, right) => right.length - left.length)
    .find((candidate) => fileName.startsWith(`${candidate}-`));
  if (!prefix) return null;
  return { name: prefix, root: path.join(repoRoot, PATCH_TARGETS[prefix]) };
}

function gitApplies(root, patchPath, extra = []) {
  const result = spawnSync('git', ['-C', root, 'apply', '--check', ...extra, patchPath], { encoding: 'utf8' });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

/*
 * Returns [{ patch, target, status, detail }] with status `applies`,
 * `already-applied`, `unavailable` (target checkout absent), or `broken`.
 * `only` limits the check to the named targets (e.g. ['code-server']).
 */
export function checkPatches({ only = null } = {}) {
  const results = [];
  for (const fileName of readdirSync(PATCH_DIRECTORY)
    .filter((name) => name.endsWith('.patch'))
    .sort()) {
    const target = patchTarget(fileName);
    if (!target) {
      if (!only) {
        results.push({
          detail: 'not applied by any release workflow (documents a first-party fork change)',
          patch: fileName,
          status: 'not-applied',
          target: { name: 'none' },
        });
      }
      continue;
    }
    if (only && !only.includes(target.name)) continue;
    const patchPath = path.join(PATCH_DIRECTORY, fileName);
    if (!existsSync(path.join(target.root, '.git'))) {
      results.push({ detail: `${target.root} is not checked out`, patch: fileName, status: 'unavailable', target });
      continue;
    }
    const forward = gitApplies(target.root, patchPath);
    if (forward.ok) {
      results.push({ detail: 'applies cleanly', patch: fileName, status: 'applies', target });
      continue;
    }
    const reverse = gitApplies(target.root, patchPath, ['--reverse']);
    if (reverse.ok) {
      results.push({ detail: 'already applied in the checkout', patch: fileName, status: 'already-applied', target });
      continue;
    }
    results.push({ detail: forward.output || 'git apply --check failed', patch: fileName, status: 'broken', target });
  }
  return results;
}

function main() {
  const args = process.argv.slice(2);
  const onlyIndex = args.indexOf('--only');
  const only = onlyIndex >= 0 ? args[onlyIndex + 1].split(',').filter(Boolean) : null;
  const results = checkPatches({ only });
  let broken = 0;
  for (const result of results) {
    const marker =
      result.status === 'broken' ? 'FAIL' : ['unavailable', 'not-applied'].includes(result.status) ? 'SKIP' : 'PASS';
    if (result.status === 'broken') broken += 1;
    console.log(`${marker}  ${result.patch} -> ${result.target.name}: ${result.detail}`);
  }
  if (broken > 0) {
    console.error(`\n${broken} patch(es) no longer apply. Regenerate them against the current submodule pin.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
