/**
 * Diffs the CALLS the Rust sidebar actions make against the calls the TypeScript they replace
 * makes, for every payload of every scenario.
 *
 *   bun tooling/gx-core/menu-parity.ts scenarios <frames.jsonl> <out-dir> [settings.json]
 *   cargo run --release --example sidebar_menu_parity   -- <out-dir>   # from packages/gx-core
 *   cargo run --release --example sidebar_action_parity -- <out-dir>   # from packages/gx-core
 *   bun tooling/gx-core/action-parity.ts compare <out-dir>
 *
 * **Why this gate exists and what it has to be able to do.** A sidebar action does not move the
 * sidebar, so no comparison of the drawn list can see a wrong one: the wrong native action, or the
 * right one carrying the wrong project id, produces exactly the same rows. The gate therefore
 * compares the calls, and it enumerates rather than samples: every project of the recording gets
 * every message type, every id shape that resolves to no project is probed, both text edges of the
 * two copy actions are probed, and every read-only command the real menus build is added on top.
 *
 * A gate that cannot fail is worse than none, so this one is proved discriminating by
 * `--inject <mutation>`, which mutates the Rust side after the fact and expects a non-zero
 * difference count.
 *
 * Recordings and dumps hold private data: keep <out-dir> outside the repository.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type Json = Record<string, any>;

/**
 * The mutations `--inject` can apply to the Rust side, each one a plausible port mistake. A
 * mutation is handed the entry as well as its calls, so a mistake that shows up as a MISSING call
 * can be injected too: a branch whose right answer is "no call at all" is exactly the one a diff
 * of two call lists is weakest on.
 */
const MUTATIONS: Record<string, (calls: Json[], entry: Json, dump: Json) => Json[]> = {
  // The right call with the wrong action name: what a copy-and-paste between the three
  // project-path actions looks like, and what no list comparison can see.
  'swap-finder-for-ide': (calls) =>
    calls.map((call) =>
      call.call === 'nativeProjectPathAction' && call.payload?.action === 'openWorkspaceProjectInFinder'
        ? { ...call, payload: { ...call.payload, action: 'openWorkspaceProjectInIde' } }
        : call
    ),
  // The text trimmed on the way to the clipboard: `normalizeNonEmptyString` tests the trim and
  // returns the original, and getting that backwards changes what the user pastes.
  'trim-copied-text': (calls) =>
    calls.map((call) => (call.call === 'copyText' ? { ...call, text: String(call.text).trim() } : call)),
  // The bridge payload built without one of its two fixed fields, which the native side would
  // then refuse; the action would simply not happen and nothing would say so.
  'drop-the-version-field': (calls) =>
    calls.map((call) =>
      call.call === 'nativeProjectPathAction'
        ? { ...call, payload: Object.fromEntries(Object.entries(call.payload).filter(([key]) => key !== 'version')) }
        : call
    ),
  // The remote leg answered as a local one.
  'remote-as-local': (calls) =>
    calls.map((call) =>
      call.call === 'nativeProjectPathAction' && String(call.payload?.action).startsWith('copyRemote')
        ? { ...call, payload: { ...call.payload, action: 'copyWorkspaceProjectPath' } }
        : call
    ),
  // The toast dropped, which is the one leg with no call at all to compare against.
  'drop-the-toast': (calls) => calls.filter((call) => call.call !== 'toast'),
  // A project the daemon parked as a Recent Project still resolving to a group. This is the one
  // mistake whose symptom is an EXTRA call where the right answer is none, and it is the reason
  // the dump carries a second variant with the first project parked.
  'parked-still-resolves': (calls, entry, dump) => {
    const parked = typeof dump.parkedProjectId === 'string' ? dump.parkedProjectId : undefined;
    if (entry.variant !== 'firstParked' || !parked || calls.length) return calls;
    const groupId = typeof entry.payload?.groupId === 'string' ? entry.payload.groupId : '';
    if (groupId !== `combined-project:${encodeURIComponent(parked)}`) return calls;
    const action = LOCAL_ACTION_BY_TYPE[String(entry.payload.type)];
    if (!action) return calls;
    return [
      {
        call: 'nativeProjectPathAction',
        payload: {
          action,
          projectId: parked,
          type: 'ghostex.gpui.sidebar.nativeProjectPathAction',
          version: 1,
        },
      },
    ];
  },
};

/**
 * The transition half's mutations. They act on a whole dump entry rather than on a call list,
 * because what they have to be able to break is a STATE the daemon then contradicts.
 */
/**
 * The close half's mutations. The first is the port's own deliberate difference removed, which
 * must show up as the gate's classification going to zero rather than as agreement.
 */
function mutateClose(name: string | undefined, entry: Json): Json {
  const clone = JSON.parse(JSON.stringify(entry)) as Json;
  switch (name) {
    // The row left missing after a call that never came home, which is what the TypeScript does
    // and what this port deliberately does not.
    case 'never-restore-the-row':
      if (clone.answers?.failed) clone.answers.failed.drawn = false;
      if (clone.answers?.neverAnswered) clone.answers.neverAnswered.drawn = false;
      return clone;
    // The row not taken away at all, so the click does nothing until the daemon answers.
    case 'close-is-not-optimistic':
      if (clone.optimistic) clone.optimistic.drawn = true;
      if (clone.answers?.accepted) clone.answers.accepted.drawn = true;
      return clone;
    // The row put back even when the daemon DID take the close, which would make every close
    // flicker and then depend on the removal delta to finish.
    case 'restore-after-an-accepted-close':
      if (clone.answers?.accepted) clone.answers.accepted.drawn = true;
      return clone;
    // The focus left on the row that is going away.
    case 'drop-the-close-focus':
      if (clone.optimistic) clone.optimistic.focus = [];
      return clone;
    // A daemon removal that does not retire the local hide, which is the leak that would make a
    // re-created session with the same id invisible for the rest of the run.
    case 'keep-the-hide-after-removal':
      if (clone.echo?.removed) clone.echo.removed.drawn = true;
      return clone;
    default:
      return clone;
  }
}

/** The fork half's mutations. */
function mutateFork(name: string | undefined, entry: Json): Json {
  const clone = JSON.parse(JSON.stringify(entry)) as Json;
  switch (name) {
    // A pane placed for a success envelope that carried no session id, which is the leg a port is
    // most likely to answer with a pane that has nothing behind it.
    case 'place-a-pane-with-no-session':
      if (clone.answers?.emptyFork) clone.answers.emptyFork = clone.answers.accepted;
      return clone;
    // The new pane appended beside whichever pane is focused instead of beside the row the fork
    // came from, which is the placement bug the TypeScript's own comment warns about.
    case 'forget-the-placement-target':
      for (const answer of Object.values(clone.answers ?? {}) as Json[][])
        for (const follow of answer) if (follow.follow === 'placePane') delete follow.placementTarget;
      return clone;
    // A failed fork that moves the user's project anyway when it should not have to.
    case 'always-activate':
      if (clone.request) clone.request.activate = `combined-project:x`;
      return clone;
    default:
      return clone;
  }
}

const FORK_MUTATIONS = ['place-a-pane-with-no-session', 'forget-the-placement-target', 'always-activate'];

const CLOSE_MUTATIONS = [
  'never-restore-the-row',
  'close-is-not-optimistic',
  'restore-after-an-accepted-close',
  'drop-the-close-focus',
  'keep-the-hide-after-removal',
];

const LIFECYCLE_MUTATIONS = [
  'patch-a-declined-sleep',
  'overlay-outlives-the-daemon',
  'drop-the-replacement-focus',
  'wake-steals-the-focus',
  'swap-sleep-and-wake',
  'drop-the-rpc-reason',
];

function mutateLifecycle(name: string | undefined, entry: Json): Json {
  const clone = JSON.parse(JSON.stringify(entry)) as Json;
  switch (name) {
    // The optimistic value applied before the daemon agreed, which is the 2026-08-19 KeepAwake
    // bug: a declined sleep publishing a row state the daemon never entered.
    case 'patch-a-declined-sleep':
      if (clone.answers?.declined) clone.answers.declined.state = clone.answers?.accepted?.state ?? null;
      return clone;
    // The overlay outliving a daemon row that moved somewhere else, which is the user-visible
    // "I put it to sleep and it came back" in reverse: the row says asleep for ever.
    case 'overlay-outlives-the-daemon':
      if (clone.echo) clone.echo.movedOn = clone.answers?.accepted?.state ?? null;
      return clone;
    // The sleep handing the focus to nobody.
    case 'drop-the-replacement-focus':
      if (clone.answers?.accepted) clone.answers.accepted.focus = [];
      return clone;
    // A wake taking the focus back after the user moved on, which is `movesDuringCall` and
    // nothing else: with the focus unchanged across the round trip the branch cannot be reached,
    // and this mutation found no difference at all until that case was added.
    case 'wake-steals-the-focus':
      if (clone.sleeping === false && clone.focus === 'movesDuringCall' && clone.answers?.accepted)
        clone.answers.accepted.focus = [{ follow: 'focus', session: clone.sessionId }];
      return clone;
    // The two calls swapped.
    case 'swap-sleep-and-wake':
      if (clone.request?.rpc?.path)
        clone.request.rpc.path =
          clone.request.rpc.path === '/api/sleepSession' ? '/api/wakeSession' : '/api/sleepSession';
      return clone;
    // The reason the daemon logs the call under.
    case 'drop-the-rpc-reason':
      if (clone.request?.rpc?.params) delete clone.request.rpc.params.reason;
      return clone;
    default:
      return clone;
  }
}

const LOCAL_ACTION_BY_TYPE: Record<string, string> = {
  copyWorkspaceProjectPathForGroup: 'copyWorkspaceProjectPath',
  openWorkspaceProjectInFinderForGroup: 'openWorkspaceProjectInFinder',
  openWorkspaceProjectInIdeForGroup: 'openWorkspaceProjectInIde',
};

async function compare([outDir, ...flags]: string[]) {
  if (!outDir) throw new Error('compare <out-dir> [--inject <mutation>]');
  const injectAt = flags.indexOf('--inject');
  const mutationName = injectAt >= 0 ? flags[injectAt + 1] : undefined;
  const mutate = mutationName ? (MUTATIONS[mutationName] ?? ((calls: Json[]) => calls)) : undefined;
  const known = [...Object.keys(MUTATIONS), ...LIFECYCLE_MUTATIONS, ...CLOSE_MUTATIONS, ...FORK_MUTATIONS];
  if (mutationName && !known.includes(mutationName)) {
    console.error(`unknown mutation ${mutationName}; one of ${known.join(', ')}`);
    process.exit(2);
  }
  const { runTypeScriptActions } = await import('./action-parity-typescript.ts');
  const { runTypeScriptLifecycle, runTypeScriptClose, runTypeScriptFork } =
    await import('./lifecycle-parity-typescript.ts');
  const names = readdirSync(outDir)
    .filter((name) => name.startsWith('scenario-') && name.endsWith('.json'))
    .sort();
  let payloads = 0;
  let rustCalls = 0;
  let tsCalls = 0;
  let transitions = 0;
  let closes = 0;
  let forks = 0;
  let overlayKept = 0;
  let closesRestored = 0;
  let stoppedUnhidden = 0;
  const differences: string[] = [];
  for (const name of names) {
    const rustPath = join(outDir, name.replace('scenario-', 'rust-actions-'));
    let rust: Json;
    try {
      rust = JSON.parse(readFileSync(rustPath, 'utf8')) as Json;
    } catch {
      differences.push(`${name}: no rust-actions dump beside it; run the sidebar_action_parity example`);
      continue;
    }
    const scenario = JSON.parse(readFileSync(join(outDir, name), 'utf8')) as Json;
    const ours = await runTypeScriptActions(scenario, rust);
    writeFileSync(join(outDir, name.replace('scenario-', 'ts-actions-')), JSON.stringify(ours), { mode: 0o600 });
    const entries = rust.entries as Json[];
    if (entries.length !== ours.length) {
      differences.push(`${name}: ${entries.length} payloads against ${ours.length} answers`);
      continue;
    }
    const theirFork = await runTypeScriptFork(scenario, rust);
    for (const [index, entry] of ((rust.fork ?? []) as Json[]).entries()) {
      if (entry.owned !== true) continue;
      forks += 1;
      const theirs = theirFork[index];
      if (!theirs) {
        differences.push(`${name} fork #${index}: the TypeScript side produced no answer`);
        continue;
      }
      const where = `${name} fork #${index} active=${entry.active}`;
      const mine = mutate ? mutateFork(mutationName, entry) : entry;
      if (canonical(mine.request?.rpc ?? null) !== canonical(theirs.rpc))
        differences.push(`${where} rpc: rust ${canonical(mine.request?.rpc ?? null)} ts ${canonical(theirs.rpc)}`);
      if (canonical(mine.request?.activate ?? null) !== canonical(theirs.activate))
        differences.push(
          `${where} activate: rust ${canonical(mine.request?.activate ?? null)} ts ${canonical(theirs.activate)}`
        );
      for (const answer of ['accepted', 'emptyFork', 'failed', 'neverAnswered']) {
        const left = mine.answers?.[answer] ?? null;
        const right = theirs.answers?.[answer] ?? null;
        if (canonical(left) !== canonical(right))
          differences.push(`${where} ${answer}: rust ${canonical(left)} ts ${canonical(right)}`);
      }
    }
    const theirClose = await runTypeScriptClose(scenario, rust);
    for (const [index, entry] of ((rust.close ?? []) as Json[]).entries()) {
      if (entry.owned !== true) continue;
      closes += 1;
      const theirs = theirClose[index];
      if (!theirs) {
        differences.push(`${name} close #${index}: the TypeScript side produced no answer`);
        continue;
      }
      const where = `${name} close #${index} focus=${entry.focus}`;
      const mine = mutate ? mutateClose(mutationName, entry) : entry;
      const myRpc = mine.request?.rpc ?? null;
      if (canonical(myRpc) !== canonical(theirs.rpc))
        differences.push(`${where} rpc: rust ${canonical(myRpc)} ts ${canonical(theirs.rpc)}`);
      if (canonical(mine.optimistic) !== canonical(theirs.optimistic))
        differences.push(`${where} optimistic: rust ${canonical(mine.optimistic)} ts ${canonical(theirs.optimistic)}`);
      for (const answer of ['accepted', 'failed', 'neverAnswered']) {
        const left = mine.answers?.[answer] ?? null;
        const right = theirs.answers?.[answer] ?? null;
        if (canonical(left) === canonical(right)) continue;
        // Declared difference 25: a close the daemon never confirmed puts the row back here and
        // leaves it missing there. Allowed in exactly that shape and for those two answers only.
        if ((answer === 'failed' || answer === 'neverAnswered') && left?.drawn === true && right?.drawn === false) {
          closesRestored += 1;
          continue;
        }
        differences.push(`${where} ${answer}: rust ${canonical(left)} ts ${canonical(right)}`);
      }
      for (const key of ['removed', 'stillRunning', 'stopped']) {
        const left = mine.echo?.[key] ?? null;
        const right = theirs.echo?.[key] ?? null;
        if (canonical(left) === canonical(right)) continue;
        // Declared difference 26: a daemon that still lists the row as STOPPED retires the local
        // hide here, because a stopped row the daemon keeps is one the user pinned, starred or
        // tagged and must be able to see. The TypeScript's hidden set is never cleared at all.
        if (key === 'stopped' && left?.drawn === true && right?.drawn === false) {
          stoppedUnhidden += 1;
          continue;
        }
        differences.push(`${where} echo.${key}: rust ${canonical(left)} ts ${canonical(right)}`);
      }
    }
    const theirLifecycle = await runTypeScriptLifecycle(scenario, rust);
    for (const [index, entry] of ((rust.lifecycle ?? []) as Json[]).entries()) {
      if (entry.owned !== true) continue;
      transitions += 1;
      const theirs = theirLifecycle[index];
      if (!theirs) {
        differences.push(`${name} lifecycle #${index}: the TypeScript side produced no answer`);
        continue;
      }
      const where = `${name} lifecycle #${index} ${entry.sleeping ? 'sleep' : 'wake'} focus=${entry.focus}`;
      const mine = mutate ? mutateLifecycle(mutationName, entry) : entry;
      const myRpc = mine.request?.rpc?.path ? mine.request.rpc : null;
      if (canonical(myRpc) !== canonical(theirs.rpc))
        differences.push(`${where} rpc: rust ${canonical(myRpc)} ts ${canonical(theirs.rpc)}`);
      for (const answer of ['accepted', 'declined', 'failed']) {
        const left = mine.answers?.[answer] ?? null;
        const right = theirs.answers?.[answer] ?? null;
        if (canonical(left) !== canonical(right))
          differences.push(`${where} ${answer}: rust ${canonical(left)} ts ${canonical(right)}`);
      }
      for (const key of ['agrees', 'stillOld', 'movedOn']) {
        const left = mine.echo?.[key] ?? null;
        const right = theirs.echo?.[key] ?? null;
        if (left === right) continue;
        // The one difference this port makes on purpose: the store's overlay records the value it
        // predicted FROM, so a daemon row that merely REPEATS that value leaves the prediction in
        // place. The TypeScript wrote the optimistic value into its copy of the row, so the same
        // repeat overwrites it and the row flickers back for as long as the real transition takes.
        // Allowed only in exactly that shape, and never for the other two echoes.
        if (key === 'stillOld' && left === (mine.answers?.accepted?.state ?? null)) {
          overlayKept += 1;
          continue;
        }
        differences.push(`${where} echo.${key}: rust ${String(left)} ts ${String(right)}`);
      }
    }
    for (const [index, entry] of entries.entries()) {
      payloads += 1;
      const mine = mutate ? mutate(entry.calls as Json[], entry, rust) : (entry.calls as Json[]);
      const theirs = ours[index]!;
      rustCalls += mine.length;
      tsCalls += theirs.length;
      const left = canonical(mine);
      const right = canonical(theirs);
      if (left !== right)
        differences.push(
          `${name} #${index} ${describe(entry.payload as Json)} [${entry.variant}]: rust ${left} ts ${right}`
        );
    }
  }
  console.log(
    `scenarios ${names.length} payloads ${payloads} rustCalls ${rustCalls} tsCalls ${tsCalls} transitions ${transitions} closes ${closes} forks ${forks} overlayKept ${overlayKept} closesRestored ${closesRestored} stoppedUnhidden ${stoppedUnhidden} differences ${differences.length}${
      mutationName ? ` (injected ${mutationName})` : ''
    }`
  );
  for (const difference of differences.slice(0, 40)) console.log(`  ${difference}`);
  if (differences.length > 40) console.log(`  … and ${differences.length - 40} more`);
  // With a mutation injected the gate is being tested. A mutation passes when it either creates a
  // difference OR collapses one of the classifications: undoing a difference this port makes on
  // purpose (`never-restore-the-row` is exactly that) makes the two sides AGREE, and a criterion
  // that only looked at the difference count would read that as the gate failing to notice.
  if (mutate) {
    const noticed = differences.length > 0 || overlayKept === 0 || closesRestored === 0 || stoppedUnhidden === 0;
    process.exitCode = noticed ? 0 : 1;
    if (!noticed)
      console.log(`  the injected mutation ${mutationName} produced NO difference and collapsed no classification`);
    return;
  }
  // A clean run whose classifications are all zero is a gate that stopped measuring: every one of
  // them counts a difference this port makes deliberately and on every row of a real recording.
  if (!differences.length && (overlayKept === 0 || closesRestored === 0 || stoppedUnhidden === 0)) {
    console.log('  a classification counted nothing, so the gate is not exercising what it claims');
    process.exitCode = 1;
    return;
  }
  process.exitCode = differences.length ? 1 : 0;
}

/**
 * A payload named without its content: a project path, a session title and a resume command line
 * all ride in these, and the difference lines are read and pasted into reports.
 */
function describe(payload: Json): string {
  const kind = String(payload.type ?? '?');
  if (typeof payload.groupId === 'string') return `${kind} group=${idShape(payload.groupId)}`;
  if (typeof payload.sessionId === 'string') return `${kind} session=${idShape(payload.sessionId)}`;
  return kind;
}

function idShape(id: string): string {
  if (!id) return 'empty';
  if (id.startsWith('remote:')) return 'remote';
  if (id.startsWith('combined-project:')) return 'project';
  if (id.startsWith('combined-session:')) return 'session';
  if (id.startsWith('gpui-wsg:')) return 'userGroup';
  return 'other';
}

/** Key order must not decide a difference, so both sides are written with sorted keys. */
function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Json)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, sortKeys(item)])
    );
  return value;
}

// Last, not first: `MUTATIONS` is a `const` and a top-level await above it runs in its temporal
// dead zone, so `--inject` would throw before it could inject anything.
const [mode, ...rest] = process.argv.slice(2);
if (mode === 'compare') await compare(rest);
else {
  console.error('usage: action-parity.ts compare <out-dir> [--inject <mutation>]');
  process.exit(2);
}
