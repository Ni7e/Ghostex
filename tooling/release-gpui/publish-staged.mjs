#!/usr/bin/env node
/*
 * One publish stage of a staged release: create the release if this stage is
 * first, otherwise amend it.
 *
 * CDXC:Release 2026-09-15 WHY:
 * The parent workflow cannot know at dispatch time which stage will finish
 * first, and two stages can finish within seconds of each other. So the
 * decision is made here, against live state, and the tag push is the arbiter:
 * assemble.mjs exits with LOST_CREATION_RACE when the remote tag appeared under
 * it, and this runner then falls through to the amend path, which waits for the
 * winner's release to become public before merging its own products in.
 * SEE-ALSO: publish-stage.mjs, assemble.mjs, amend-existing.mjs,
 * .github/workflows/release-gpui-publish.yml.
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readPublishPlan } from './publish-provenance.mjs';
import { LOST_CREATION_RACE_EXIT_CODE, resolvePublishStage } from './publish-stage.mjs';
const REPO = 'maddada/Ghostex';

const [version, artifactsRoot] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/u.test(version ?? '')) throw new Error('Version must be MAJOR.MINOR.PATCH');
if (!artifactsRoot || !existsSync(artifactsRoot)) throw new Error(`Artifact root is missing: ${artifactsRoot}`);
const stage = (process.env.GHOSTEX_RELEASE_STAGE ?? '').trim();
if (!stage) throw new Error('GHOSTEX_RELEASE_STAGE is required');

const plan = readPublishPlan({
  artifactsRoot,
  env: process.env,
  fileExists: existsSync,
  readTextFile: (file) => readFileSync(file, 'utf8'),
});
const resolved = resolvePublishStage({ plan, stage });
if (resolved.products.length === 0) {
  console.log(`Publish stage ${stage}: none of its products is in this release's scope; nothing to publish.`);
  process.exit(0);
}
console.log(
  `Publish stage ${stage}: ${resolved.ownProducts.join(', ')}` +
    (resolved.dependencies.length > 0 ? ` (embeds ${resolved.dependencies.join(', ')})` : '')
);

const tag = `v${version}`;
const here = path.dirname(fileURLToPath(import.meta.url));

function capture(command, args) {
  return spawnSync(command, args, { encoding: 'utf8' });
}

function remoteTagExists() {
  const result = capture('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
  return result.status === 0 && result.stdout.trim().length > 0;
}

/* Public or draft, either means another stage already owns the release. */
function liveReleaseState() {
  const result = capture('gh', ['release', 'list', '--repo', REPO, '--limit', '40', '--json', 'tagName,isDraft']);
  if (result.status !== 0) return { known: false };
  const match = JSON.parse(result.stdout || '[]').find((release) => release.tagName === tag);
  if (!match) return { known: true, exists: false };
  return { known: true, exists: true, draft: Boolean(match.isDraft) };
}

function runPublisher(script) {
  const result = spawnSync('node', [path.join(here, script), version, artifactsRoot], { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function fetchRemoteTag() {
  const result = spawnSync('git', ['fetch', '--force', 'origin', `refs/tags/${tag}:refs/tags/${tag}`], {
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`Could not fetch ${tag} from origin`);
}

/*
 * A remote tag without a visible release is a creator mid-flight (the draft
 * create is uploading) or a creator that died after pushing the tag. Wait for
 * the release; if it never appears, the amend publisher will report the tag
 * without a release as a hard stop rather than guessing.
 */
function waitForReleaseAfterTag() {
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const state = liveReleaseState();
    if (state.known && state.exists && !state.draft) return true;
    spawnSync('sleep', ['10']);
  }
  return false;
}

let mode;
const state = liveReleaseState();
if (state.known && state.exists) {
  mode = 'amend';
} else if (remoteTagExists()) {
  console.log(`${tag} exists on origin but no release is visible yet; waiting for the creating stage.`);
  if (!waitForReleaseAfterTag()) throw new Error(`${tag} exists on origin but no public release appeared for it`);
  mode = 'amend';
} else {
  mode = 'create';
}

if (mode === 'create') {
  console.log(`No ${tag} release yet; this stage creates it.`);
  const status = runPublisher('assemble.mjs');
  if (status === 0) process.exit(0);
  if (status !== LOST_CREATION_RACE_EXIT_CODE) process.exit(status);
  console.log(`Another stage created ${tag} first; amending it instead.`);
  if (!waitForReleaseAfterTag()) throw new Error(`${tag} was created by another stage but never became public`);
  mode = 'amend';
}

console.log(`${tag} exists; this stage amends it.`);
fetchRemoteTag();
process.exit(runPublisher('amend-existing.mjs'));
