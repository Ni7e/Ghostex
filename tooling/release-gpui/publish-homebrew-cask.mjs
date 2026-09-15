#!/usr/bin/env node
/*
 * Homebrew distribution of a published macOS release.
 *
 * Bumps `version` and `sha256` in two casks, touching nothing else:
 *   1. the official cask `Casks/g/ghostex.rb` in Homebrew/homebrew-cask, through a
 *      version-bump pull request opened from a fork under the token's account;
 *   2. the legacy personal tap `Casks/ghostex.rb` in maddada/homebrew-tap, pushed
 *      directly to `main` so existing `maddada/tap/ghostex` installs keep updating.
 *
 * Everything goes through `gh` and the GitHub REST API. No Homebrew command runs,
 * so the script behaves identically on a macOS workstation and on the ubuntu-24.04
 * publish runner. The local, brew-driven equivalent for the tap alone is
 * tooling/release-gpui-homebrew.mjs.
 *
 * CDXC:Release 2026-09-15 DECISION:
 * User: now that the `ghostex` cask is accepted into Homebrew/homebrew-cask, every
 * release must update the official cask automatically from CI, in the macOS publish
 * stage, and `brew install ghostex` is the advertised macOS Homebrew install path.
 * The personal tap is kept in sync as a courtesy for installs that predate the
 * official cask; it is no longer the primary path.
 *
 * CDXC:Release 2026-09-15 WHY:
 * `brew bump-cask-pr` was considered and rejected for CI: it needs the whole
 * homebrew-cask tap as a git clone (~620 MB), runs `brew audit`/`brew style` for a
 * cask on Linux, and decides fork and branch handling itself. The bump is two lines
 * of Ruby with a checksum the release already recorded, so the PR is opened with the
 * contents API instead and the maintainers' own CI performs the audit. The cask has
 * no `no_autobump!`, so BrewTestBot may also open a bump PR from the appcast
 * livecheck; whichever PR exists first wins and the other side skips, which is why
 * an existing open PR for the version is a success here, not a failure.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseProvenanceAssetName, validateReleaseProvenance } from './provenance.mjs';
import { withRetryProfile } from './retry.mjs';

const defaultRepo = 'maddada/Ghostex';
const officialCask = Object.freeze({
  label: 'Homebrew/homebrew-cask',
  repo: 'Homebrew/homebrew-cask',
  base: 'main',
  path: 'Casks/g/ghostex.rb',
});
const personalTap = Object.freeze({
  label: 'maddada/homebrew-tap',
  repo: 'maddada/homebrew-tap',
  base: 'main',
  path: 'Casks/ghostex.rb',
});
const sha256Pattern = /^[0-9a-f]{64}$/u;

export function assertVersion(version) {
  if (!/^\d+\.\d+\.\d+$/u.test(version ?? '')) {
    throw new Error(`--version must be MAJOR.MINOR.PATCH, got ${version || 'nothing'}`);
  }
  return version;
}

export function assertSha256(value, label) {
  if (!sha256Pattern.test(value ?? '')) {
    throw new Error(`${label} must be a 64-character lowercase sha256, got ${value || 'nothing'}`);
  }
  return value;
}

export function releaseAssetName(version) {
  return `ghostex-${assertVersion(version)}-arm64.dmg`;
}

export function releaseAssetUrl(version, repo = defaultRepo) {
  return `https://github.com/${repo}/releases/download/v${version}/${releaseAssetName(version)}`;
}

export function branchName(version) {
  return `ghostex-${assertVersion(version)}`;
}

export function pullRequestTitle(version) {
  return `ghostex ${assertVersion(version)}`;
}

export function pullRequestBody({ version, repo = defaultRepo }) {
  return [
    `Created by the Ghostex release workflow for [v${version}](https://github.com/${repo}/releases/tag/v${version}).`,
    '',
    '- Changes `version` and `sha256` only; the rest of the cask is unchanged.',
    `- \`sha256\` is the digest GitHub records for \`${releaseAssetName(version)}\` and matches the release provenance record.`,
    '',
    `Automation: https://github.com/${repo}/blob/main/tooling/release-gpui/publish-homebrew-cask.mjs`,
  ].join('\n');
}

export function caskVersion(cask) {
  const match = /^\s*version "([^"]+)"/mu.exec(cask);
  if (!match) throw new Error('The cask declares no version');
  return match[1];
}

/*
 * The two stanzas are rewritten in place. Every other byte, including the
 * indentation of the rewritten lines, has to survive untouched: the diff a
 * Homebrew maintainer sees must be the two lines and nothing else.
 */
export function bumpCask(cask, { sha256, version }) {
  assertVersion(version);
  assertSha256(sha256, 'sha256');
  const updated = cask
    .replace(/^(\s*)version "[^"]+"/mu, `$1version "${version}"`)
    .replace(/^(\s*)sha256 "[0-9a-f]+"/mu, `$1sha256 "${sha256}"`);
  if (!updated.includes(`version "${version}"`) || !updated.includes(`sha256 "${sha256}"`)) {
    throw new Error('Could not rewrite the cask version and sha256 stanzas');
  }
  const before = cask.split('\n');
  const after = updated.split('\n');
  if (before.length !== after.length) throw new Error('The cask bump changed the line count');
  const changed = before.map((line, index) => index).filter((index) => before[index] !== after[index]);
  const allowed = changed.every((index) => /^\s*(version|sha256) "/u.test(before[index]));
  if (!allowed || changed.length > 2) {
    throw new Error(
      `The cask bump touched lines other than version and sha256: ${changed.map((i) => i + 1).join(', ')}`
    );
  }
  return updated;
}

export function unifiedDiff(before, after, filePath, context = 3) {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length !== b.length) throw new Error('unifiedDiff expects a line-for-line rewrite');
  const changed = a.map((line, index) => index).filter((index) => a[index] !== b[index]);
  if (changed.length === 0) return '';
  const lines = [`--- a/${filePath}`, `+++ b/${filePath}`];
  let index = 0;
  while (index < changed.length) {
    const start = Math.max(0, changed[index] - context);
    let end = changed[index];
    while (index + 1 < changed.length && changed[index + 1] - end <= context * 2) {
      index += 1;
      end = changed[index];
    }
    end = Math.min(a.length - 1, end + context);
    lines.push(`@@ -${start + 1},${end - start + 1} +${start + 1},${end - start + 1} @@`);
    for (let line = start; line <= end; line += 1) {
      if (a[line] === b[line]) lines.push(` ${a[line]}`);
      else lines.push(`-${a[line]}`, `+${b[line]}`);
    }
    index += 1;
  }
  return `${lines.join('\n')}\n`;
}

function gh(args, options = {}) {
  const env = { ...process.env };
  if (options.token) {
    env.GH_TOKEN = options.token;
    env.GITHUB_TOKEN = options.token;
  }
  const result = spawnSync('gh', args, { encoding: 'utf8', env, input: options.input });
  if (result.error) throw new Error(`gh ${args.join(' ')} could not start: ${result.error.message}`);
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`gh ${args.join(' ')} failed: ${(result.stderr || result.stdout || 'unknown error').trim()}`);
  }
  return result;
}

function ghApi(endpoint, { allowNotFound = false, body, method = 'GET', token } = {}) {
  const args = ['api', '--method', method, endpoint];
  if (body !== undefined) args.push('--input', '-');
  return withRetryProfile(
    async () => {
      const result = gh(args, {
        allowFailure: true,
        input: body === undefined ? undefined : JSON.stringify(body),
        token,
      });
      if (result.status === 0) return result.stdout ? JSON.parse(result.stdout) : null;
      const message = (result.stderr || result.stdout || '').trim();
      if (allowNotFound && /HTTP 404/u.test(message)) return null;
      const error = new Error(`gh api ${method} ${endpoint} failed: ${message}`);
      error.ghostexHttpStatus = Number(/HTTP (\d{3})/u.exec(message)?.[1] ?? 0);
      throw error;
    },
    'github',
    { label: `gh api ${method} ${endpoint}` }
  );
}

function decodeContent(entry) {
  if (!entry || entry.type !== 'file' || typeof entry.content !== 'string') {
    throw new Error(`Unexpected contents API payload for ${entry?.path ?? 'unknown path'}`);
  }
  return Buffer.from(entry.content.replace(/\n/gu, ''), 'base64').toString('utf8');
}

async function readFile({ repo, path: filePath, ref, token, allowNotFound = false }) {
  const entry = await ghApi(`repos/${repo}/contents/${filePath}?ref=${encodeURIComponent(ref)}`, {
    allowNotFound,
    token,
  });
  if (!entry) return null;
  return { content: decodeContent(entry), sha: entry.sha };
}

async function writeFile({ branch, content, message, path: filePath, repo, sha, token }) {
  return ghApi(`repos/${repo}/contents/${filePath}`, {
    body: { branch, content: Buffer.from(content, 'utf8').toString('base64'), message, sha },
    method: 'PUT',
    token,
  });
}

function sha256FromGitHubMetadata(version, repo) {
  const result = gh(['release', 'view', `v${version}`, '--repo', repo, '--json', 'assets,isDraft,url'], {
    allowFailure: true,
  });
  if (result.status !== 0) {
    throw new Error(`v${version} is not a published release of ${repo}: ${(result.stderr || '').trim()}`);
  }
  const release = JSON.parse(result.stdout);
  if (release.isDraft) throw new Error(`v${version} is still a draft; refusing to publish it to Homebrew`);
  const asset = (release.assets ?? []).find((entry) => entry.name === releaseAssetName(version));
  if (!asset) {
    throw new Error(`v${version} carries no ${releaseAssetName(version)}; refusing to publish it to Homebrew`);
  }
  const digest =
    typeof asset.digest === 'string' && asset.digest.startsWith('sha256:') ? asset.digest.slice('sha256:'.length) : '';
  return sha256Pattern.test(digest) ? digest : null;
}

async function sha256FromDownload(version, repo) {
  const url = releaseAssetUrl(version, repo);
  process.stdout.write(`Hashing ${url}\n`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Could not download ${url}: HTTP ${response.status} ${response.statusText}`);
  }
  const hash = createHash('sha256');
  for await (const chunk of response.body) hash.update(chunk);
  return hash.digest('hex');
}

export async function resolveSha256({ repo, sha256, version }) {
  if (sha256) return { source: '--sha256', value: assertSha256(sha256.toLowerCase(), '--sha256') };
  const fromGitHub = sha256FromGitHubMetadata(version, repo);
  if (fromGitHub) return { source: 'GitHub release asset digest', value: fromGitHub };
  return { source: 'downloaded release asset', value: await sha256FromDownload(version, repo) };
}

/*
 * CDXC:Release 2026-08-13:
 * The cask may only advance when macOS is actually part of this release. A reused
 * DMG can only come from a same-version recovery whose cask update never happened,
 * so what matters is that these exact bytes are the ones the release recorded: the
 * published sha256 is cross-checked against the provenance record rather than
 * against GitHub's metadata alone. Mirrors tooling/release-gpui-homebrew.mjs.
 */
function verifyProvenance({ repo, sha256, version }) {
  const assetName = releaseProvenanceAssetName(version);
  const scratch = mkdtempSync(path.join(os.tmpdir(), `ghostex-${version}-provenance-`));
  const result = gh(['release', 'download', `v${version}`, '--repo', repo, '--pattern', assetName, '--dir', scratch], {
    allowFailure: true,
  });
  const file = path.join(scratch, assetName);
  if (result.status !== 0 || !existsSync(file)) {
    process.stdout.write(
      `v${version} carries no ${assetName} (released before change-aware planning); using the live DMG digest only.\n`
    );
    return;
  }
  const provenance = validateReleaseProvenance(JSON.parse(readFileSync(file, 'utf8')));
  const macos = provenance.products['macos-arm64'];
  if (!macos) {
    throw new Error(
      `Refusing to update Homebrew: v${version} published no macOS product, so the cask must not advance`
    );
  }
  const recorded = macos.artifacts.find((artifact) => artifact.name === releaseAssetName(version));
  if (!recorded) {
    throw new Error(`Refusing to update Homebrew: v${version} provenance records no ${releaseAssetName(version)}`);
  }
  if (recorded.sha256 !== sha256) {
    throw new Error(
      `Refusing to update Homebrew: live ${releaseAssetName(version)} digest ${sha256} does not match the recorded ${recorded.sha256}`
    );
  }
  process.stdout.write(
    `macOS was ${macos.action} for ${version} (${
      macos.action === 'built' ? 'this release' : `from ${macos.reusedFrom.tag ?? `run ${macos.reusedFrom.runId}`}`
    }); cask update authorized.\n`
  );
}

async function findOpenPullRequest({ version, token }) {
  const query = `repo:${officialCask.repo} is:pr is:open ghostex in:title`;
  const search = await ghApi(`search/issues?q=${encodeURIComponent(query)}&per_page=50`, { token });
  const pattern = new RegExp(`\\bghostex\\b.*\\b${version.replaceAll('.', '\\.')}\\b`, 'iu');
  return (search?.items ?? []).find((item) => pattern.test(item.title)) ?? null;
}

async function tokenLogin(token) {
  const user = await ghApi('user', { token });
  if (!user?.login) throw new Error('HOMEBREW_GITHUB_API_TOKEN does not identify a GitHub user');
  return user.login;
}

async function ensureFork({ owner, token }) {
  const fork = `${owner}/homebrew-cask`;
  const existing = await ghApi(`repos/${fork}`, { allowNotFound: true, token });
  if (existing) {
    if (!existing.fork || existing.parent?.full_name !== officialCask.repo) {
      throw new Error(`${fork} exists but is not a fork of ${officialCask.repo}`);
    }
    return fork;
  }
  process.stdout.write(`Forking ${officialCask.repo} to ${fork}.\n`);
  gh(['repo', 'fork', officialCask.repo, '--clone=false'], { token });
  // GitHub creates forks asynchronously; a large repository can take a minute.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const created = await ghApi(`repos/${fork}`, { allowNotFound: true, token });
    if (created) return fork;
  }
  throw new Error(`${fork} is still not visible a minute after forking; rerun once GitHub finishes the fork`);
}

async function syncFork({ fork, token }) {
  const result = await ghApi(`repos/${fork}/merge-upstream`, {
    body: { branch: officialCask.base },
    method: 'POST',
    token,
  });
  process.stdout.write(`${fork} ${officialCask.base}: ${result?.message ?? 'synced with upstream'}\n`);
}

async function ensureBranch({ fork, branch, token }) {
  const existing = await ghApi(`repos/${fork}/git/ref/heads/${branch}`, { allowNotFound: true, token });
  if (existing) {
    process.stdout.write(`Reusing existing branch ${fork}:${branch}.\n`);
    return;
  }
  const base = await ghApi(`repos/${fork}/git/ref/heads/${officialCask.base}`, { token });
  await ghApi(`repos/${fork}/git/refs`, {
    body: { ref: `refs/heads/${branch}`, sha: base.object.sha },
    method: 'POST',
    token,
  });
  process.stdout.write(`Created branch ${fork}:${branch} from ${base.object.sha.slice(0, 12)}.\n`);
}

async function publishOfficialCask({ dryRun, sha256, token, version }) {
  const live = await readFile({ path: officialCask.path, ref: officialCask.base, repo: officialCask.repo });
  const liveVersion = caskVersion(live.content);
  if (liveVersion === version) {
    const same = live.content.includes(`sha256 "${sha256}"`);
    process.stdout.write(
      `${officialCask.label} already ships ghostex ${version}${same ? '' : ' with a different sha256'}; nothing to do.\n`
    );
    if (!same) {
      throw new Error(
        `${officialCask.label} ghostex ${version} carries a different sha256 than ${releaseAssetName(version)}; ` +
          'a release must never republish the same version with different bytes'
      );
    }
    return;
  }
  const bumped = bumpCask(live.content, { sha256, version });
  const diff = unifiedDiff(live.content, bumped, officialCask.path);
  process.stdout.write(`${officialCask.label}: ${liveVersion} -> ${version}\n${diff}`);

  const open = await findOpenPullRequest({ version, token: dryRun ? undefined : token });
  if (open) {
    process.stdout.write(`An open pull request for ghostex ${version} already exists: ${open.html_url}\n`);
    return;
  }
  if (dryRun) {
    process.stdout.write(`Dry run: would open "${pullRequestTitle(version)}" against ${officialCask.repo}.\n`);
    return;
  }

  const owner = await tokenLogin(token);
  const fork = await ensureFork({ owner, token });
  await syncFork({ fork, token });
  const branch = branchName(version);
  await ensureBranch({ fork, branch, token });
  const onBranch = await readFile({ path: officialCask.path, ref: branch, repo: fork, token });
  if (onBranch.content === bumped) {
    process.stdout.write(`${fork}:${branch} already carries the bump.\n`);
  } else {
    if (caskVersion(onBranch.content) !== liveVersion) {
      throw new Error(
        `${fork}:${branch} is at ghostex ${caskVersion(onBranch.content)}, not ${liveVersion}; ` +
          'delete the stale branch and rerun'
      );
    }
    await writeFile({
      branch,
      content: bumped,
      message: pullRequestTitle(version),
      path: officialCask.path,
      repo: fork,
      sha: onBranch.sha,
      token,
    });
    process.stdout.write(`Committed the bump to ${fork}:${branch}.\n`);
  }
  const pull = await ghApi(`repos/${officialCask.repo}/pulls`, {
    body: {
      base: officialCask.base,
      body: pullRequestBody({ version }),
      head: `${owner}:${branch}`,
      maintainer_can_modify: true,
      title: pullRequestTitle(version),
    },
    method: 'POST',
    token,
  });
  process.stdout.write(`Opened ${pull.html_url}\n`);
}

async function publishPersonalTap({ dryRun, sha256, token, version }) {
  const live = await readFile({ path: personalTap.path, ref: personalTap.base, repo: personalTap.repo });
  const liveVersion = caskVersion(live.content);
  const bumped = liveVersion === version ? live.content : bumpCask(live.content, { sha256, version });
  if (bumped === live.content) {
    process.stdout.write(`${personalTap.label} already ships ghostex ${version}; nothing to push.\n`);
    return;
  }
  process.stdout.write(
    `${personalTap.label}: ${liveVersion} -> ${version}\n${unifiedDiff(live.content, bumped, personalTap.path)}`
  );
  if (dryRun) {
    process.stdout.write(`Dry run: would push the tap bump to ${personalTap.repo} ${personalTap.base}.\n`);
    return;
  }
  if (!token) {
    process.stdout.write(
      'Neither HOMEBREW_TAP_TOKEN nor HOMEBREW_GITHUB_API_TOKEN is configured; leaving the personal tap as is.\n'
    );
    return;
  }
  await writeFile({
    branch: personalTap.base,
    content: bumped,
    message: `chore: update Ghostex cask to ${version}`,
    path: personalTap.path,
    repo: personalTap.repo,
    sha: live.sha,
    token,
  });
  process.stdout.write(`Pushed ghostex ${version} to ${personalTap.repo}.\n`);
}

export function parseArguments(argv) {
  const options = { dryRun: false, publish: false, repo: defaultRepo };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--publish') {
      options.publish = true;
      continue;
    }
    if (argument === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    options[argument.slice(2)] = value;
    index += 1;
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const version = assertVersion(options.version);
  const dryRun = options.dryRun || !options.publish;
  const { source, value: sha256 } = await resolveSha256({ repo: options.repo, sha256: options.sha256, version });
  process.stdout.write(`${releaseAssetName(version)} sha256=${sha256} (from ${source})\n`);
  verifyProvenance({ repo: options.repo, sha256, version });

  const caskToken = process.env.HOMEBREW_GITHUB_API_TOKEN || '';
  if (!dryRun && !caskToken) {
    throw new Error(
      'HOMEBREW_GITHUB_API_TOKEN is not set. It must be a GitHub token for the account that owns the homebrew-cask ' +
        'fork, with contents and pull-request write access. See tooling/release-gpui/homebrew-cask-setup.md.'
    );
  }
  await publishOfficialCask({ dryRun, sha256, token: caskToken, version });
  await publishPersonalTap({
    dryRun,
    sha256,
    token: process.env.HOMEBREW_TAP_TOKEN || caskToken,
    version,
  });
  if (dryRun && !options.publish) process.stdout.write('Pass --publish to open the pull request and push the tap.\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
