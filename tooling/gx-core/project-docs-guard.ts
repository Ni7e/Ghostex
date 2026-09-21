/**
 * The TypeScript half of the project-documents gate: the interleavings and the launch orders for
 * the collections document (K5) and the Spaces document (K6).
 *
 * **Everything here is FROZEN, and the header used to say only half of it was.** The pending-push
 * guard the app had on 2026-09-21 was two halves in two files: the gxserver runtime's
 * `queueSidebar*ServerSync` / `pushSidebar*ToGxserver` / `forwardSidebar*FromGxserver`, which
 * suppress a forward while a push is outstanding, and the sidebar page's adopt, which took whatever
 * reached it. The page half was frozen in `project-collections-typescript.ts` that day; the runtime
 * half was deleted on 2026-09-21 as dead code (Rust is the only desktop writer of both documents
 * and nothing posts a local `updateSidebar*` message any more) and is frozen in
 * `project-docs-server-sync-typescript.ts`. What a clean run proves from here is that Rust still
 * matches the behaviour the app shipped on 2026-09-21, not that it matches the app.
 *
 * **The hand-off bridge half is gone with the machinery it drove.** The page posted its edited
 * document, the app took it and handed its held one back through a generated script, and the page's
 * next edit was computed from what came back. Every part of that (the two `persist*` message types,
 * the hand-back and request scripts, the routing arms and the `page_holds_newer` recovery) was
 * deleted on 2026-09-21 with the page that was its only other end, so the round trip is not
 * something this gate can still be asked about.
 *
 * **One deliberate deviation, named rather than left to be discovered.** The frozen
 * `forwardSidebar*FromGxserver` also drops an echo whose JSON equals the last one it forwarded.
 * That dedupe is not part of the guard, is invisible to the user, and is gone from the product for
 * these two documents; driving it here would compare Rust against a cache rather than against the
 * rule. The forward is therefore expressed as its two real parts: the pending suppression and the
 * adopt.
 *
 * **`stores: false` is gated by an ASSERTION, not by a comparison, and that is deliberate.** This
 * half models what the page and the runtime do with a document, not what the host writes to disk,
 * so a `store-the-spaces-document` mutation here produced no difference at all: the fifteenth
 * mutation-that-cannot-fail in this port, removed rather than left to look like coverage. The Rust
 * probe asserts instead that the Spaces document never produces a storage write, and reports
 * `collectionsStorageWrites` as the other half of that pair.
 *
 * Three edges are replaced and each one is an edge rather than a decision: `window.setTimeout` is a
 * manual queue, so "the booked push runs now" is an event in the script instead of a 400 ms wait;
 * the client's update call returns a promise the script resolves or rejects, which is the only way
 * an echo DURING a push is expressible; and client storage is the harness's shim.
 *
 *   cargo run --release --example project_docs_guard -- <out-dir>
 *   bun tooling/gx-core/project-docs-guard.ts <out-dir> [--inject <mutation>]
 */
// First, so the client-storage adapter finds a `Storage` before any module reads one.
import { resetBrowserStorage } from './browser-shim';
import { createFrozenCollectionsHolder, frozenAdoptCollections } from './project-collections-typescript';
import { FrozenProjectDocServerSync } from './project-docs-server-sync-typescript';
import {
  parseSidebarProjectCollectionsFromGxserver,
  serializeSidebarProjectCollectionsForGxserver,
  type SidebarProjectCollectionsState,
} from '@/packages/core-ui/project-collections';
import {
  parseSidebarSpacesFromGxserver,
  serializeSidebarSpacesForGxserver,
  type SidebarSpacesState,
} from '@/packages/core-ui/spaces';

type Json = Record<string, any>;

/** The manual timer queue: a booking is recorded, and the script decides when it fires. */
type Booking = { delay: number; run: () => void };

/**
 * The outcome, derived from what the TypeScript half can SEE rather than copied from the Rust rule:
 * whether the pending flag was up when the echo arrived, whether a push-back was booked, and
 * whether the held document moved. Without it the step loop compared the document, the pending flag
 * and the bookings only, so a port that reached the right document by the wrong outcome passed
 * while every live counter the run is judged on (echoesRefused, echoesAdopted, echoesPushedBack,
 * echoesAbsent) would have been wrong.
 */
type EchoOutcome = 'NoEcho' | 'IgnoredPending' | 'ScheduledPush' | 'Adopted' | 'IgnoredEqual';

/** One document type's half of the harness, so the two are driven by the same runner. */
type DocumentHarness = {
  /** What the page holds, in the wire shape the Rust dump records. */
  held: () => Json;
  /** A local edit, which is what `saveNativeCollections` / `metadata.updateSpaces` used to do. */
  edit: (wire: Json) => void;
  /** The daemon's echo, as the two real parts of the shipped forward. */
  echo: (wire: Json) => EchoOutcome;
  /** The booked push running now. */
  pushStart: () => void;
  pending: () => boolean;
};

/** The bookings made since the last step boundary, which is what a step compares. */
let bookings: Booking[] = [];
/**
 * The booking a `pushStart` fires. A new booking replaces the old one, which is what the shipped
 * `clearTimeout` does, so only the newest is ever outstanding.
 */
let outstanding: Booking | undefined;
let pushResolve: ((value: unknown) => void) | undefined;
let pushReject: ((error: unknown) => void) | undefined;

function installTimerQueue(): void {
  const win = globalThis as Json;
  win.window.setTimeout = (run: () => void, delay: number) => {
    const booking = { delay, run };
    bookings.push(booking);
    outstanding = booking;
    return bookings.length;
  };
  win.window.clearTimeout = () => {};
}

/** The collections half: the frozen server-sync fields and push, the frozen page adopt. */
function collectionsHarness(start: Json): DocumentHarness {
  resetBrowserStorage();
  const holder = createFrozenCollectionsHolder(parseSidebarProjectCollectionsFromGxserver(start)!);
  const sync = new FrozenProjectDocServerSync({
    client: {
      update: () =>
        new Promise((resolve, reject) => {
          pushResolve = resolve;
          pushReject = reject;
        }),
    },
    isState: () => true,
    messageSource: { postMessage: () => {} },
    messageType: 'sidebarProjectCollectionsChanged',
    stateKey: 'sidebarProjectCollections',
  });
  const post = (message: Json) => sync.queue(message.state);
  return {
    held: () => serializeSidebarProjectCollectionsForGxserver(holder.collections.local),
    edit: (wire: Json) => {
      holder.collections.local = parseSidebarProjectCollectionsFromGxserver(wire)!;
      sync.queue(wire);
    },
    echo: (wire: Json) => {
      if (sync.pending) return 'IgnoredPending';
      const before = JSON.stringify(serializeSidebarProjectCollectionsForGxserver(holder.collections.local));
      const bookedBefore = bookings.length;
      frozenAdoptCollections(holder, 'local', wire, post as Json);
      if (bookings.length > bookedBefore) return 'ScheduledPush';
      const after = JSON.stringify(serializeSidebarProjectCollectionsForGxserver(holder.collections.local));
      return after === before ? 'IgnoredEqual' : 'Adopted';
    },
    // The booked timer FIRING, which is the shipped callback: it clears the timeout id and then
    // pushes. Calling the push directly instead left the runtime believing a push was still booked,
    // so a failed one never re-booked its retry.
    pushStart: () => firePush(),
    pending: () => sync.pending === true,
  };
}

/**
 * The Spaces half. Its page adopt is `NativeSidebarMetadata.adoptSpaces`'s `local` leg, frozen here
 * because it is two lines and deleting it from the page is what this gate is about:
 * `const parsed = parse(value); if (parsed) this.spaces[id] = parsed;`
 */
function spacesHarness(start: Json): DocumentHarness {
  resetBrowserStorage();
  let held: SidebarSpacesState = parseSidebarSpacesFromGxserver(start) ?? { order: [], spaces: {} };
  const sync = new FrozenProjectDocServerSync({
    client: {
      update: () =>
        new Promise((resolve, reject) => {
          pushResolve = resolve;
          pushReject = reject;
        }),
    },
    isState: () => true,
    messageSource: { postMessage: () => {} },
    messageType: 'sidebarSpacesChanged',
    stateKey: 'sidebarSpaces',
  });
  return {
    held: () => serializeSidebarSpacesForGxserver(held),
    edit: (wire: Json) => {
      held = parseSidebarSpacesFromGxserver(wire) ?? held;
      sync.queue(wire);
    },
    echo: (wire: Json) => {
      if (sync.pending) return 'IgnoredPending';
      const before = JSON.stringify(serializeSidebarSpacesForGxserver(held));
      const parsed = parseSidebarSpacesFromGxserver(wire);
      if (parsed) held = parsed;
      return JSON.stringify(serializeSidebarSpacesForGxserver(held)) === before ? 'IgnoredEqual' : 'Adopted';
    },
    pushStart: () => firePush(),
    pending: () => sync.pending === true,
  };
}

/** Runs the booked push exactly as the shipped timer callback does. */
function firePush(): void {
  const booking = outstanding;
  outstanding = undefined;
  booking?.run();
}

/** Lets every queued microtask run, so a resolved push has finished before the next step. */
async function settle(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
}

/** One enumerated script, driven through the TypeScript half. */
async function runScript(
  harness: DocumentHarness,
  script: string[],
  documents: Json[]
): Promise<{ document: Json; pending: boolean; schedules: number[]; outcome: EchoOutcome | null }[]> {
  const steps: { document: Json; pending: boolean; schedules: number[]; outcome: EchoOutcome | null }[] = [];
  outstanding = undefined;
  for (const event of script) {
    bookings = [];
    let outcome: EchoOutcome | null = null;
    switch (event) {
      // A FRESH object per edit. The shipped `pushSidebar*ToGxserver` clears its pending flag only
      // when `latest === pushed`, which is object identity, and every real edit goes through a
      // serializer that builds a new object; handing the same reference twice made a second edit
      // during a push clear the flag, which is exactly the divergence the revision counter exists
      // to avoid and would have read as a port bug.
      case 'editA':
        harness.edit(structuredClone(documents[1]));
        break;
      case 'editB':
        harness.edit(structuredClone(documents[2]));
        break;
      case 'echoNone':
        // `serverState === undefined`: the shipped code never calls the forward at all.
        outcome = 'NoEcho';
        break;
      case 'echoEmpty':
        outcome = harness.echo(documents[0]);
        break;
      case 'echoA':
        outcome = harness.echo(documents[1]);
        break;
      case 'echoB':
        outcome = harness.echo(documents[2]);
        break;
      case 'pushStart':
        harness.pushStart();
        await settle();
        break;
      case 'pushOk':
        pushResolve?.(undefined);
        pushResolve = undefined;
        pushReject = undefined;
        await settle();
        break;
      case 'pushFail':
        pushReject?.(new Error('push failed'));
        pushResolve = undefined;
        pushReject = undefined;
        await settle();
        break;
    }
    steps.push({
      document: harness.held(),
      pending: harness.pending(),
      schedules: bookings.map((booking) => booking.delay),
      outcome,
    });
  }
  return steps;
}

/**
 * The launch half's reference, which is deliberately order-INDEPENDENT: whichever of the stored key
 * and the snapshot lands first, the daemon's copy is the echo that gets judged, and then the second
 * echo (an empty document, which is what a gxserver that has never stored this one sends) is
 * judged too. A host that re-read the side state instead of carrying the echo answers the first one
 * with its OWN document, which is the defect the mutation reproduces.
 */
async function referenceLaunch(
  kind: 'collections' | 'spaces',
  documents: Json[],
  storedIndex: number,
  firstEcho: Json
): Promise<{ afterFirst: Json; afterSecond: Json }> {
  const harness =
    kind === 'collections' ? collectionsHarness(documents[storedIndex]) : spacesHarness(documents[storedIndex]);
  bookings = [];
  const first = harness.echo(firstEcho);
  const afterFirst = { document: harness.held(), outcome: first };
  bookings = [];
  const second = harness.echo(documents[0]);
  return { afterFirst, afterSecond: { document: harness.held(), outcome: second } };
}

/** A key-order-insensitive comparison, because the two sides build their objects differently. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry as Json).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : entry
  );
}

/**
 * The mutations, each a plausible port mistake applied to the RUST dump. A mutation that produces
 * no difference is a gate that stopped measuring, which is why a run with one fails on that.
 */
function mutate(dump: Json, name: string): void {
  switch (name) {
    case 'settle-reads-the-side-state':
      // A1 itself: when the read lands after the snapshot, the host judges whatever the side state
      // holds, which the restore has just overwritten with this app's OWN stored document. The
      // recorded answer becomes "the stored document was the echo", which is the self-echo.
      for (const kind of ['collections', 'spaces'])
        for (const entry of dump[kind].launch as Json[]) if (!entry.storedFirst) entry.selfEcho = true;
      break;
    case 'adopt-an-empty-server-document':
      // The collections document's `PushBackFirstEcho` reduced to `Adopt`: a gxserver that has
      // never been written deletes every folder the user has.
      for (const entry of dump.collections.cases as Json[])
        for (const step of entry.steps as Json[])
          if (step.outcome === 'ScheduledPush') {
            step.outcome = 'Adopted';
            step.document = (dump.collections.documents as Json[])[0];
            step.pending = false;
            step.schedules = [];
          }
      break;
    case 'never-push-back':
      // The same rule in the other direction for the Spaces document, which must adopt an empty
      // echo because gxserver owns it outright: a port that gave it the collections rule. Written
      // as the WHOLE state a push-back leaves (the document not adopted, the flag up and the push
      // booked) rather than as the outcome alone, which was a state the real implementation cannot
      // reach and registered through the flag by accident.
      for (const entry of dump.spaces.cases as Json[])
        (entry.steps as Json[]).forEach((step, index) => {
          if (step.event !== 'echoEmpty' || step.outcome !== 'Adopted') return;
          step.outcome = 'ScheduledPush';
          step.pending = true;
          step.schedules = [400];
          step.document = index > 0 ? (entry.steps as Json[])[index - 1].document : step.document;
        });
      break;
    case 'write-the-store-before-the-settle':
      // V1 itself: the restore writes the stored document into the side state and the reconcile
      // then skips its own write, so the list draws the stored document while the guard holds the
      // daemon's.
      for (const kind of ['collections', 'spaces'])
        for (const entry of dump[kind].launch as Json[]) if (!entry.storedFirst) entry.sideStateMatchesHeld = false;
      break;
    case 'let-the-counter-go-backwards':
      // `CollectionsDocument::adopt` without its `Math.max`: the next new folder reuses a name that
      // is already on screen.
      for (const entry of dump.collections.cases as Json[])
        for (const step of entry.steps as Json[])
          if (step.document?.nextCollectionNumber > 1) step.document.nextCollectionNumber = 1;
      break;
    default:
      throw new Error(`unknown mutation ${name}`);
  }
}

async function main(): Promise<void> {
  const [outDir, ...flags] = process.argv.slice(2);
  if (!outDir) throw new Error('usage: project-docs-guard.ts <out-dir> [--inject <mutation>]');
  const injectAt = flags.indexOf('--inject');
  const inject = injectAt >= 0 ? flags[injectAt + 1] : undefined;
  const dump = JSON.parse(await Bun.file(`${outDir}/rust-project-docs.json`).text()) as Json;
  if (inject) mutate(dump, inject);
  installTimerQueue();

  let differences = 0;
  const shown: string[] = [];
  const counters: Json = {
    cases: 0,
    steps: 0,
    launchCases: 0,
  };
  for (const kind of ['collections', 'spaces'] as const) {
    const documents = dump[kind].documents as Json[];
    for (const entry of dump[kind].cases as Json[]) {
      counters.cases += 1;
      const start = documents[{ empty: 0, a: 1, b: 2 }[entry.start as 'empty' | 'a' | 'b']];
      const harness = kind === 'collections' ? collectionsHarness(start) : spacesHarness(start);
      const ours = await runScript(harness, entry.script as string[], documents);
      (entry.steps as Json[]).forEach((step, index) => {
        counters.steps += 1;
        const mine = ours[index];
        const theirs = {
          document: step.document,
          pending: step.pending,
          schedules: step.schedules,
          // `Unparsable` never occurs here: every echo in the enumeration is a real document.
          outcome: (step.outcome ?? null) as EchoOutcome | null,
        };
        if (canonical(mine) === canonical(theirs)) return;
        differences += 1;
        if (shown.length < 6)
          shown.push(
            `${kind} ${(entry.script as string[]).join(',')} step ${index} ${step.event}: rust ${canonical(theirs).slice(0, 240)} ts ${canonical(mine).slice(0, 240)}`
          );
      });
    }
    for (const entry of dump[kind].launch as Json[]) {
      counters.launchCases += 1;
      // The echo the host judges. Correct: the daemon's copy, carried from when it arrived.
      // Mutated: whatever the side state holds by then, which is this app's own stored document.
      const firstEcho = entry.selfEcho
        ? documents[entry.storedIndex as number]
        : documents[entry.serverIndex as number];
      const ours = await referenceLaunch(kind, documents, entry.storedIndex as number, firstEcho);
      // The SECOND echo is always the empty document, so comparing final states only let it erase
      // the distinction the first one made: five cases of thirty-six could tell the self-echo
      // defect from the fix, and none of them were Spaces. Both echoes are compared now, each with
      // the document it left AND the outcome it reached.
      const outcomes = entry.outcomes as string[];
      if (outcomes.length !== 2)
        throw new Error(`launch ${String(entry.name)} recorded ${outcomes.length} outcomes, not two`);
      const rust = {
        afterFirst: { document: entry.documentAfterFirst, outcome: outcomes[0] },
        afterSecond: { document: entry.document, outcome: outcomes[1] },
      };
      // The list draws from the SIDE STATE and a drop is planned from the held document, so the two
      // disagreeing is a sidebar that files a project into a folder the user cannot see. That is
      // what a restore writing the store before the settle really did, and it is the step no gate
      // in this port modelled at all until now.
      if (entry.sideStateMatchesHeld !== true) {
        differences += 1;
        if (shown.length < 12)
          shown.push(`${kind} launch ${entry.name}: the side state does not hold what the guard holds`);
      }
      if (canonical(rust) === canonical(ours)) continue;
      differences += 1;
      if (shown.length < 12)
        shown.push(
          `${kind} launch ${entry.name}: rust ${canonical(rust).slice(0, 260)} ts ${canonical(ours).slice(0, 260)}`
        );
    }
  }

  const summary = Object.entries(counters)
    .map(([name, value]) => `${name} ${value}`)
    .join(' ');
  console.log(`project docs: ${summary} differences ${differences}${inject ? ` (injected ${inject})` : ''}`);
  for (const line of shown) console.log(`  ${line}`);
  const zeroes = Object.entries(counters).filter(([, value]) => value === 0);
  if (!inject && zeroes.length > 0) {
    console.log(`  coverage counters at zero: ${zeroes.map(([name]) => name).join(', ')}`);
    process.exit(1);
  }
  if (inject) {
    if (differences === 0) {
      console.log('  the mutation produced no difference: the gate did not measure it');
      process.exit(1);
    }
    return;
  }
  if (differences > 0) process.exit(1);
}

await main();
