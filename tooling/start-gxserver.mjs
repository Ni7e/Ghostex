#!/usr/bin/env bun
/* CDXC:Build 2026-09-24 DECISION:
 * User: a fix that only needs gxserver should be testable without `bun run start`, which rebuilds, closes and reopens the whole app. `bun run start:server` rebuilds only the gxserver package, signs it like the start does, installs it into /Applications/Ghostex.app in place and restarts only the daemon; the open app reconnects to it.
 * zmx is never replaced here (a changed zmx needs the full start), and the app's outer signature stays stale until the next `bun run start` re-syncs the bundle.
 * SEE-ALSO: GHOSTEX_MACOS_GXSERVER_ONLY in apps/desktop/scripts/prepare-macos-runtime.sh; stopRunningGxserverControlPlaneBeforeLaunch in tooling/start-gpui.mjs; gpui_spawn_local_gxserver_launchd_job in apps/desktop/src/app/helpers/board_gxserver/gxserver_health_and_daemon.rs.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLocalStartCodeSignIdentity, resolveLocalStartCodeSignTimestampFlag } from './local-start-utils.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const localStartLockFile = path.join(repoRoot, 'build', 'ghostex-gpui-local-start.lock');
const runtimeGxserverDir = path.join(repoRoot, 'apps', 'desktop', 'runtime', 'macos', 'Web', 'gxserver');
const stageDir = path.join(repoRoot, 'build', 'start-server.noindex', 'gxserver');
const installedAppPath = '/Applications/Ghostex.app';
const installedGxserverDir = path.join(installedAppPath, 'Contents', 'Resources', 'Web', 'gxserver');
const installedCliPath = path.join(installedAppPath, 'Contents', 'Resources', 'CLI', 'ghostex');
const gxserverPort = 58744;
const baseUrl = `http://127.0.0.1:${gxserverPort}`;
const launchdLabel = 'com.madda.ghostex.gxserver';
const launchdTarget = `gui/${process.getuid?.() ?? 0}/${launchdLabel}`;
const protocolVersion = 1;

function fail(message) {
  console.error(`start:server: ${message}`);
  process.exit(1);
}

function step(message) {
  console.log(`==> ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    fail(`${command} ${args.join(' ')} failed:\n${`${result.stdout ?? ''}${result.stderr ?? ''}`.trim()}`);
  }
  return result;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (process.platform !== 'darwin') {
  fail('only macOS is supported; use `bun run start`.');
}
if (process.env.GHOSTEX_HOME?.trim()) {
  fail('GHOSTEX_HOME selects an isolated install; `bun run start:server` only updates /Applications/Ghostex.app.');
}
const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg !== '--optimized');
if (unknown.length > 0) {
  fail(`unknown argument ${unknown[0]}. Usage: bun run start:server [--optimized]`);
}
const optimized = args.includes('--optimized') || process.env.GHOSTEX_START_OPTIMIZED === '1';

// Same lock as `bun run start`, so the two can never write the installed app at once.
if (process.env.GHOSTEX_GPUI_START_LOCK_HELD !== '1') {
  mkdirSync(path.dirname(localStartLockFile), { recursive: true });
  const result = spawnSync('/usr/bin/lockf', ['-k', localStartLockFile, process.execPath, scriptPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, GHOSTEX_GPUI_START_LOCK_HELD: '1' },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

if (!existsSync(installedGxserverDir)) {
  fail(`${installedGxserverDir} does not exist. Run \`bun run start\` once first.`);
}
try {
  const probePath = path.join(installedGxserverDir, `.ghostex-install-probe-${process.pid}`);
  writeFileSync(probePath, '');
  rmSync(probePath, { force: true });
} catch (error) {
  fail(
    [
      `macOS will not let this command modify ${installedAppPath} (${error.code ?? error.message}).`,
      'Open System Settings > Privacy & Security > App Management and turn it on for the app this command runs in (Ghostex, or your terminal), then run it again.',
    ].join('\n')
  );
}
const signIdentity = resolveLocalStartCodeSignIdentity(process.env, installedAppPath);
const timestampFlag = resolveLocalStartCodeSignTimestampFlag(process.env);

step(`Building gxserver${optimized ? ' (optimized)' : ''}...`);
const build = spawnSync('/bin/bash', [path.join(repoRoot, 'apps', 'desktop', 'scripts', 'prepare-macos-runtime.sh')], {
  cwd: repoRoot,
  env: {
    ...process.env,
    GHOSTEX_APP_VARIANT: 'prod',
    GHOSTEX_LOCAL_START: '1',
    GHOSTEX_MACOS_GXSERVER_ONLY: '1',
    ...(optimized ? { GHOSTEX_START_OPTIMIZED: '1' } : {}),
  },
  stdio: 'inherit',
});
if (build.error) throw build.error;
if (build.status !== 0) fail('the gxserver build failed; nothing was installed.');

const expectedIdentity = readBuildIdentity(runtimeGxserverDir);
if (!expectedIdentity) fail(`the built package has no build identity in ${runtimeGxserverDir}.`);

const zmxVersion = (directory) =>
  run(path.join(directory, 'bin', 'zmx'), ['version'])
    .stdout.split('\n')
    .filter((line) => /^(zmx|wire_generation)\s/.test(line))
    .join(', ');
const builtZmx = zmxVersion(runtimeGxserverDir);
const installedZmx = zmxVersion(installedGxserverDir);
if (builtZmx !== installedZmx) {
  fail(
    `the staged zmx (${builtZmx}) differs from the installed one (${installedZmx}). A zmx change needs \`bun run start\`.`
  );
}

const token = readGxserverToken();
const before = token ? await health(token) : undefined;
if (before?.buildIdentity === expectedIdentity) {
  step(`gxserver pid ${before.pid} already runs this build; nothing to install.`);
  process.exit(0);
}

step('Signing the gxserver package...');
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(path.dirname(stageDir), { recursive: true });
cpSync(runtimeGxserverDir, stageDir, { recursive: true, preserveTimestamps: true });
for (const binary of ['gxserver', 'ghostex']) {
  const binaryPath = path.join(stageDir, 'bin', binary);
  run('/usr/bin/xattr', ['-c', binaryPath]);
  run(
    'codesign',
    signIdentity === '-'
      ? ['--force', '--sign', '-', binaryPath]
      : [
          '--force',
          '--options',
          'runtime',
          ...(timestampFlag ? [timestampFlag] : []),
          '--sign',
          signIdentity,
          binaryPath,
        ]
  );
}

step(`Installing into ${installedAppPath}...`);
// rsync writes each file beside its target and renames it, so the daemon still running from the old binary keeps its inode.
run('rsync', ['-a', '--delete', '--exclude', '/bin/zmx', `${stageDir}/`, `${installedGxserverDir}/`]);
run('rsync', ['-a', path.join(stageDir, 'bin', 'ghostex'), installedCliPath]);

const job = launchdJob();
if (job.program && job.program !== path.join(installedGxserverDir, 'bin', 'gxserver')) {
  fail(
    `launchd job ${launchdLabel} runs ${job.program}, not the installed app's gxserver. Restart it from the app instead.`
  );
}
if (before && token) {
  step(`Stopping gxserver pid ${before.pid}...`);
  await fetchJson('/api/control/stop', { method: 'POST', token });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && ((await health(token, 500)) || launchdJob().pid)) await sleep(200);
  if ((await health(token, 500)) || launchdJob().pid) fail('the old gxserver did not stop within 15s.');
}

step('Starting gxserver...');
if (!launchdJob().loaded) {
  const plistPath = path.join(homedir(), 'Library', 'LaunchAgents', `${launchdLabel}.plist`);
  if (!existsSync(plistPath)) fail(`${plistPath} is missing. Open Ghostex once so it registers its gxserver job.`);
  run('launchctl', ['bootstrap', `gui/${process.getuid()}`, plistPath]);
}
run('launchctl', ['kickstart', launchdTarget]);
const startDeadline = Date.now() + 40000;
let after;
while (Date.now() < startDeadline) {
  after = await health(readGxserverToken(), 500);
  if (after?.buildIdentity === expectedIdentity) break;
  await sleep(250);
}
if (after?.buildIdentity !== expectedIdentity) {
  fail(
    `gxserver did not come back with the new build (${after ? `running ${after.buildIdentity}` : 'unreachable'}). See ~/.local/state/ghostex/logs/gxserver/macos-launch.log.`
  );
}
step(`gxserver pid ${after.pid} runs ${expectedIdentity}.`);
console.log('The app keeps running; its outer code signature is stale until the next `bun run start`.');

function readBuildIdentity(directory) {
  try {
    return (
      JSON.parse(readFileSync(path.join(directory, 'build-identity.json'), 'utf8')).buildIdentity?.trim() || undefined
    );
  } catch {
    return undefined;
  }
}

function readGxserverToken() {
  const stateHome = process.env.XDG_STATE_HOME?.trim();
  const stateRoot = stateHome && path.isAbsolute(stateHome) ? stateHome : path.join(homedir(), '.local', 'state');
  const tokenPath = path.join(stateRoot, 'ghostex', 'gxserver', 'auth', 'token');
  return existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() || undefined : undefined;
}

async function health(token, timeoutMs = 1000) {
  if (!token) return undefined;
  const value = await fetchJson('/api/health/server', { method: 'GET', token, timeoutMs });
  return value?.product === 'gxserver' ? value : undefined;
}

async function fetchJson(pathname, { method, token, timeoutMs = 1000 }) {
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      headers: { authorization: `Bearer ${token}`, 'x-gxserver-protocol-version': String(protocolVersion) },
      method,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok ? await response.json() : undefined;
  } catch {
    return undefined;
  }
}

/** Only the first `pid` and `program` lines of `launchctl print` belong to the job itself. */
function launchdJob() {
  const result = run('launchctl', ['print', launchdTarget], { allowFailure: true });
  if (result.status !== 0) return { loaded: false };
  return {
    loaded: true,
    pid: result.stdout.match(/^\s*pid = (\d+)$/m)?.[1],
    program: result.stdout.match(/^\s*program = (.+)$/m)?.[1]?.trim(),
  };
}
