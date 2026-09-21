/**
 * The gate for Full Reload over a set: which rows `fullReloadProjectZmxSessions` and
 * `fullReloadGroup` reload, in which order, and where a failed one stops the rest, against the
 * shipped TypeScript.
 *
 *   cargo run --release --example sidebar_reload_set_parity -- <out-dir>   # from packages/gx-core
 *   bun tooling/gx-core/reload-set-parity.ts compare <out-dir> [--inject <mutation>]
 *
 * The TypeScript half drives the shipped `handleSidebarMessage` over the SAME built presentation
 * and workspace session groups document the Rust half planned against, in the array order the app
 * really holds (`orderedPresentation`). The one edge replaced is `fullReloadSession`, which records
 * the row and resolves or rejects as the answer script says: the single-session reload is already
 * compared leg by leg by the action gate and the remote gate, so what this compares is the SET, the
 * ORDER and the STOP.
 *
 * A payload the Rust side does not answer goes to the old runtime whole; it is counted by whether
 * the TypeScript then reloads anything (`handOffsWork`) or not (`handOffsNothing`), and a hand-off
 * that does work is only possible where the old runtime holds rows the store does not.
 */
// First, so the client-storage adapter finds a `Storage` before any module reads one.
import { resetBrowserStorage } from './browser-shim';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GpuiSidebarRuntime } from '@/apps/desktop/sidebar/gxserver-runtime/core';
import { orderedPresentation } from './lifecycle-parity-typescript';

type Json = Record<string, any>;

/** Plausible port mistakes, applied to the Rust traces. */
const MUTATIONS: Record<string, (entry: Json, dump: Json) => Json> = {
  // The set reloaded in reverse, which is what reading a list the wrong way round looks like.
  'reverse-the-set': (entry) =>
    mapTraces(entry, (trace) => ({ ...trace, reloaded: [...(trace.reloaded as string[])].reverse() })),
  // The loop carries on past a reload that failed, which the TypeScript's missing `try` does not.
  'continue-after-a-failure': (entry) =>
    mapTraces(entry, (trace) => {
      const script = (trace.script ?? []) as boolean[];
      if (!script.includes(false)) return trace;
      const all = ((entry.plan ?? []) as Json[]).map((message) => message.sessionId);
      return { ...trace, reloaded: all };
    }),
  // A member the daemon no longer knows skipped rather than reloaded (and failed).
  'skip-stale-members': (entry) =>
    mapTraces(entry, (trace) => ({
      ...trace,
      reloaded: (trace.reloaded as string[]).filter((id) => !id.endsWith(':ghost')),
    })),
  // The last row of the set lost, which an off-by-one in the loop looks like.
  'drop-the-last-row': (entry) =>
    mapTraces(entry, (trace) =>
      (trace.script as boolean[]).includes(false)
        ? trace
        : { ...trace, reloaded: (trace.reloaded as string[]).slice(0, -1) }
    ),
  // A remote row reloaded as a local one, which is a reload of a row this computer does not have.
  'remote-rows-as-local': (entry) =>
    mapTraces(entry, (trace) => ({
      ...trace,
      reloaded: (trace.reloaded as string[]).map((id) =>
        id.replace(/^remote:[^:]+:session:([^:]+):(.+)$/u, 'combined-session:$1:$2')
      ),
    })),
  // The store refuses every set, so the old runtime does it all: no difference, and the counters
  // that say the Rust side answered anything collapse.
  'refuse-every-set': (entry) => ({ ...entry, owned: false, plan: null, traces: [] }),
  // `loaded` in place of `loaded_live`: a machine whose rows are the stored last-seen copy reads as
  // loaded, so its project reloads resolve the drawn rows and every one of them goes down a tunnel
  // that does not exist. The plan is the one the same payload gets on the streamed machine.
  'answer-a-last-seen-machine': (entry, dump) => {
    if (String(entry.presentation) !== 'lastSeen' || entry.owned === true) return entry;
    const groupId = String((entry.payload as Json)?.groupId ?? '');
    if (!groupId.startsWith(`remote:${String(dump.remoteMachine)}:`)) return entry;
    const twin = ((dump.entries ?? []) as Json[]).find(
      (other) =>
        String(other.presentation) === 'loaded' &&
        String((other.payload as Json)?.groupId ?? '') === groupId &&
        String((other.payload as Json)?.type) === String((entry.payload as Json)?.type)
    );
    return twin ? { ...entry, owned: twin.owned, plan: twin.plan, traces: twin.traces } : entry;
  },
};

function mapTraces(entry: Json, map: (trace: Json) => Json): Json {
  return { ...entry, traces: ((entry.traces ?? []) as Json[]).map(map) };
}

/** Runs one payload through the shipped runtime with `script` as each reload's outcome. */
async function runPayload(rust: Json, presentation: string, payload: Json, script: boolean[]): Promise<string[]> {
  const answers = [...script];
  const reloaded: string[] = [];
  const runtime = Object.create(GpuiSidebarRuntime.prototype) as Json;
  // `lastSeen` is this computer streamed with the remote machine held only as the stored copy the
  // sidebar draws, faded. `remoteLastSeenPresentations` is a different map from
  // `remotePresentations` and no action reads it, so the remote branch here resolves nothing, which
  // is the answer `loaded_live` keeps the store to.
  runtime.presentation = presentation === 'none' ? undefined : orderedPresentation(rust.localSnapshot as Json);
  runtime.remotePresentations = new Map(
    presentation === 'loaded' ? [[String(rust.remoteMachine), orderedPresentation(rust.remoteSnapshot as Json)]] : []
  );
  runtime.remoteLastSeenPresentations = new Map(
    presentation === 'lastSeen' ? [[String(rust.remoteMachine), orderedPresentation(rust.remoteSnapshot as Json)]] : []
  );
  runtime.workspaceGroups = rust.document;
  runtime.client = { rpc: () => Promise.resolve({}) };
  runtime.fullReloadSession = (sessionId: string) => {
    reloaded.push(sessionId);
    const ok = answers.length ? answers.shift()! : true;
    return ok ? Promise.resolve() : Promise.reject(new Error('the reload failed'));
  };
  await runtime.handleSidebarMessage(payload).catch(() => undefined);
  return reloaded;
}

async function compare([outDir, ...flags]: string[]) {
  if (!outDir) throw new Error('compare <out-dir> [--inject <mutation>]');
  resetBrowserStorage();
  const injectAt = flags.indexOf('--inject');
  const mutationName = injectAt >= 0 ? flags[injectAt + 1] : undefined;
  if (mutationName && !MUTATIONS[mutationName])
    throw new Error(`unknown mutation ${mutationName}; known: ${Object.keys(MUTATIONS)}`);
  const mutate = mutationName ? MUTATIONS[mutationName] : undefined;
  const rust = JSON.parse(readFileSync(join(outDir, 'rust-reload-sets.json'), 'utf8')) as Json;
  const differences: string[] = [];
  let setsOwned = 0;
  let setTraces = 0;
  let rowsReloaded = 0;
  let stops = 0;
  let emptySets = 0;
  let remoteRows = 0;
  let handOffsWork = 0;
  let handOffsNothing = 0;
  let lastSeenRefusals = 0;
  for (const [index, original] of ((rust.entries ?? []) as Json[]).entries()) {
    const entry = mutate ? mutate(original, rust) : original;
    const payload = entry.payload as Json;
    const presentation = String(entry.presentation);
    const where = `#${index} [${presentation}] ${payload.type} ${payload.groupId}`;
    // The LAST-SEEN probe: the remote machine's rows are the stored copy, so neither side may act.
    // Counted separately from the other refusals, because this is the one the store could not
    // reach until the copy was read back and the one a `loaded` in place of `loaded_live` would
    // silently answer.
    const lastSeenRemote =
      presentation === 'lastSeen' && String(payload.groupId ?? '').startsWith(`remote:${String(rust.remoteMachine)}:`);
    if (lastSeenRemote && entry.owned === true)
      differences.push(`${where}: answered a machine whose rows are the stored last-seen copy`);
    if (entry.owned !== true) {
      const reloaded = await runPayload(rust, presentation, payload, []);
      if (reloaded.length) handOffsWork += 1;
      else handOffsNothing += 1;
      if (lastSeenRemote && !reloaded.length) lastSeenRefusals += 1;
      continue;
    }
    setsOwned += 1;
    if (!((entry.plan ?? []) as Json[]).length) emptySets += 1;
    for (const trace of (entry.traces ?? []) as Json[]) {
      setTraces += 1;
      const script = (trace.script ?? []) as boolean[];
      if (script.includes(false)) stops += 1;
      const mine = (trace.reloaded ?? []) as string[];
      rowsReloaded += mine.length;
      remoteRows += mine.filter((id) => id.startsWith('remote:')).length;
      const theirs = await runPayload(rust, presentation, payload, script);
      if (JSON.stringify(mine) !== JSON.stringify(theirs))
        differences.push(
          `${where} script ${JSON.stringify(script)}: rust ${JSON.stringify(mine)} ts ${JSON.stringify(theirs)}`
        );
    }
  }
  console.log(
    `payloads ${(rust.entries ?? []).length} setsOwned ${setsOwned} setTraces ${setTraces} rowsReloaded ${rowsReloaded} stops ${stops} emptySets ${emptySets} remoteRows ${remoteRows} handOffsWork ${handOffsWork} handOffsNothing ${handOffsNothing} lastSeenRefusals ${lastSeenRefusals} differences ${differences.length}${
      mutationName ? ` (injected ${mutationName})` : ''
    }`
  );
  for (const difference of differences.slice(0, 30)) console.log(`  ${difference}`);
  if (differences.length > 30) console.log(`  ... and ${differences.length - 30} more`);
  // `handOffsWork` is NOT in the zero-check: with the store and the old runtime holding the same
  // rows, a refused set is one the TypeScript also answers with nothing, and a non-zero count would
  // be the finding rather than the coverage.
  const measured: [string, number][] = [
    ['setsOwned', setsOwned],
    ['setTraces', setTraces],
    ['rowsReloaded', rowsReloaded],
    ['stops', stops],
    ['emptySets', emptySets],
    ['remoteRows', remoteRows],
    ['handOffsNothing', handOffsNothing],
    ['lastSeenRefusals', lastSeenRefusals],
  ];
  const collapsed = measured.filter(([, count]) => count === 0);
  if (mutationName) {
    const noticed = differences.length > 0 || collapsed.length > 0;
    process.exitCode = noticed ? 0 : 1;
    if (!noticed)
      console.log(`  the injected mutation ${mutationName} produced NO difference and collapsed no counter`);
    else if (collapsed.length) console.log(`  collapsed: ${collapsed.map(([label]) => label).join(', ')}`);
    return;
  }
  if (handOffsWork)
    differences.push(`${handOffsWork} refused sets were answered with work by the TypeScript over the same rows`);
  if (!differences.length && collapsed.length) {
    console.log(`  ${collapsed.map(([label]) => label).join(', ')} counted nothing, so the gate is not measuring`);
    process.exitCode = 1;
    return;
  }
  if (handOffsWork) console.log(`  ${differences.at(-1)}`);
  process.exitCode = differences.length ? 1 : 0;
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'compare') await compare(rest);
else {
  console.error('usage: reload-set-parity.ts compare <out-dir> [--inject <mutation>]');
  process.exitCode = 2;
}
