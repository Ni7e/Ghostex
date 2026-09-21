/**
 * The gate for a click on a row of another machine: the one native action it posts, against the
 * shipped TypeScript.
 *
 *   cargo run --release --example sidebar_remote_focus_parity -- <out-dir>   # from packages/gx-core
 *   bun tooling/gx-core/remote-focus-parity.ts compare <out-dir> [--inject <mutation>]
 *
 * **What is compared.** For every case the Rust half enumerated (an id shape, a message, the group
 * that is active, and a Default Agent View with its overrides), the `openRemoteSessionTerminal`
 * payload the shipped `handleSidebarMessage` posts through the fixed native project-path bridge,
 * field for field, plus whether the attention was acknowledged before it. The only edges replaced
 * are that bridge (which is where the payload is read), the two marks the old runtime still owns
 * after the post, and its patch publish.
 *
 * **What is deliberately NOT compared, and counted instead.** The store does not take the remote
 * focus marks: `setRemotePresentationSessionFocus` and `publishRemotePresentationPatch` stay the
 * old runtime's until declared difference 16 closes, so the command is still sent on and those two
 * still run. They are counted as `tsFocusMarks`, which is in the zero-check, so the probe cannot
 * quietly stop seeing them.
 *
 * **Hand-offs.** A case the Rust planner refuses goes to the old runtime whole. It is counted by
 * what the TypeScript then does: `handOffsOpen` when it still posts the native action (a machine
 * the store holds no rows for, which is the one refusal that costs something), and
 * `handOffsNothing` when it posts nothing (a local row, a browser row, an id that does not parse).
 * Both must be non-zero, so the refusal list cannot silently grow into "refuse everything".
 *
 * A gate that cannot fail is worse than none, so `--inject` mutates the Rust dump with a plausible
 * port mistake and the run must then show a difference or collapse a counter.
 */
// First, so the client-storage adapter finds a `Storage` before any module reads one.
import { resetBrowserStorage } from './browser-shim';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GpuiSidebarRuntime } from '@/apps/desktop/sidebar/gxserver-runtime/core';

type Json = Record<string, any>;

const PINNED_NOW_MS = 1_790_000_000_000;

/**
 * Plausible port mistakes, applied to the Rust dump. Each rewrites the PLAN, so the comparison sees
 * what the wrong port would post rather than a changed label.
 */
const MUTATIONS: Record<string, (entry: Json) => Json> = {
  // The destination always switches to Agents, which is the 2026-09-11 decision undone.
  'keepview-always-false': (entry) => withPlan(entry, (plan) => setKeepView(plan, false)),
  // Every click keeps the destination's remembered view, so a click inside the active project
  // never opens Agents.
  'keepview-always-true': (entry) => withPlan(entry, (plan) => setKeepView(plan, true)),
  // The machine's Chats group read as "the same project", so a click on a chat row of the active
  // machine stops switching the view.
  'keepview-ignores-the-chats-group': (entry) =>
    !String(entry.activeGroupId ?? '').endsWith(':group:combined-chats')
      ? entry
      : withPlan(entry, (plan) => setKeepView(plan, false)),
  // Split Right carrying the focus click's two options, which would open a split in the agent's
  // Default Agent View and keep the destination's remembered view.
  'split-carries-the-interface': (entry) =>
    !entry.plan?.splitRight
      ? entry
      : withPlan(entry, (plan) => ({
          ...plan,
          preferredInterface: 'chat',
          nativeAction: { ...plan.nativeAction, preferredInterface: 'chat' },
        })),
  // The placement dropped, which turns Split Right into an ordinary click.
  'split-without-the-placement': (entry) =>
    !entry.plan?.splitRight
      ? entry
      : withPlan(entry, (plan) => {
          const { placement: _dropped, ...nativeAction } = plan.nativeAction;
          return { ...plan, nativeAction };
        }),
  // The per-agent override ignored, so every row opens in the global Default Agent View.
  'interface-from-the-default-only': (entry) =>
    withPlan(entry, (plan) => {
      if (plan.preferredInterface === null) return plan;
      const value = String(entry.settings?.preferredAgentInterface ?? 'terminal');
      return {
        ...plan,
        preferredInterface: value,
        nativeAction: { ...plan.nativeAction, preferredInterface: value },
      };
    }),
  // A row with no agent given the global default anyway, which is the extra attach-metadata
  // preview the shipped comment keeps off the plain-terminal path.
  'interface-for-a-row-without-an-agent': (entry) =>
    withPlan(entry, (plan) => {
      if (plan.preferredInterface !== null || plan.splitRight) return plan;
      const value = String(entry.settings?.preferredAgentInterface ?? 'terminal');
      return {
        ...plan,
        preferredInterface: value,
        nativeAction: { ...plan.nativeAction, preferredInterface: value },
      };
    }),
  // The RAW session id in the slot the bridge parses as a machine-scoped id, so Rust could not
  // identify the machine at all.
  'raw-id-for-the-open': (entry) =>
    withPlan(entry, (plan) => ({
      ...plan,
      nativeAction: {
        ...plan.nativeAction,
        projectId: String(plan.nativeAction.projectId).split(':').slice(3).join(':'),
      },
    })),
  // `keepView: false` written as a field instead of being absent, which the strict parser on the
  // other side reads as a different message.
  'keepview-false-is-a-field': (entry) =>
    withPlan(entry, (plan) =>
      plan.keepView ? plan : { ...plan, nativeAction: { ...plan.nativeAction, keepView: false } }
    ),
  // The planner refuses every remote click, so the old runtime does it all: no payload difference
  // at all, and every counter that says the Rust side answered anything collapses.
  'refuse-every-remote-click': (entry) => ({ ...entry, owned: false, plan: null }),
};

function withPlan(entry: Json, edit: (plan: Json) => Json): Json {
  return entry.plan ? { ...entry, plan: edit(entry.plan) } : entry;
}

function setKeepView(plan: Json, keepView: boolean): Json {
  const nativeAction = { ...plan.nativeAction };
  if (keepView) nativeAction.keepView = true;
  else delete nativeAction.keepView;
  return { ...plan, keepView, nativeAction };
}

type Run = {
  /** Every `openRemoteSessionTerminal` payload the runtime posted, in order. */
  opens: Json[];
  /** Every other native action, which this path must never post. */
  otherActions: string[];
  acknowledged: string[];
  focusMarks: number;
  patches: number;
};

/**
 * One case driven through the shipped `handleSidebarMessage`, with that machine's presentation and
 * the settings the Rust half was given.
 */
async function runCase(entry: Json): Promise<Run> {
  const run: Run = { opens: [], otherActions: [], acknowledged: [], focusMarks: 0, patches: 0 };
  const runtime = Object.create(GpuiSidebarRuntime.prototype) as Json;
  runtime.browserTabs = [];
  runtime.latestGroups = [];
  runtime.presentation = undefined;
  runtime.activeProjectId = undefined;
  runtime.activeGroupId = entry.activeGroupId ?? undefined;
  // Both loaded machines carry the same presentation, which is what the Rust half seeds too; the
  // one the store holds nothing for is simply absent from this map.
  runtime.remotePresentations = new Map(
    ['remote-msgckntd-ecz4w', 'remote-ab12'].map((machineId) => [machineId, entry.presentation])
  );
  runtime.remoteSidebarHuds = new Map();
  // `createGpuiSidebarSettings` normalizes `runtimeSettings.settings`, not `runtimeSettings`.
  runtime.runtimeSettings = { settings: entry.settings };
  runtime.client = undefined;
  runtime.acknowledgeSessionAttention = (sessionId: string) => void run.acknowledged.push(sessionId);
  runtime.setRemotePresentationSessionFocus = () => void (run.focusMarks += 1);
  runtime.publishRemotePresentationPatch = () => void (run.patches += 1);
  runtime.publishPresentation = () => {};
  runtime.postSidebarSessionFocusConfirmation = () => {};
  runtime.focusBrowserTabProject = () => {};
  runtime.focusLocalWorkspaceSession = () => {};
  const window = (globalThis as Json).window as Json;
  window.ghostexGpui = {
    ...(window.ghostexGpui as Json),
    postNativeProjectPathAction(payload: string) {
      // What reaches the bridge is JSON, so an `undefined` field is no field.
      const message = JSON.parse(payload) as Json;
      if (message.action === 'openRemoteSessionTerminal') run.opens.push(message);
      else run.otherActions.push(String(message.action));
      return true;
    },
    postBrowserTabFocus() {},
  };
  await runtime.handleSidebarMessage(entry.message).catch(() => undefined);
  return run;
}

async function compare([outDir, ...flags]: string[]) {
  if (!outDir) throw new Error('compare <out-dir> [--inject <mutation>]');
  resetBrowserStorage();
  (globalThis as Json).Date.now = () => PINNED_NOW_MS;
  const injectAt = flags.indexOf('--inject');
  const mutationName = injectAt >= 0 ? flags[injectAt + 1] : undefined;
  if (mutationName && !MUTATIONS[mutationName])
    throw new Error(`unknown mutation ${mutationName}; known: ${Object.keys(MUTATIONS)}`);
  const mutate = mutationName ? MUTATIONS[mutationName] : (entry: Json) => entry;

  const dump = JSON.parse(readFileSync(join(outDir, 'rust-remote-focus.json'), 'utf8')) as Json;
  const differences: string[] = [];
  const counters = {
    cases: 0,
    opens: 0,
    splits: 0,
    keepViews: 0,
    plainViews: 0,
    chatInterfaces: 0,
    terminalInterfaces: 0,
    noInterface: 0,
    acknowledgements: 0,
    tsFocusMarks: 0,
    handOffsOpen: 0,
    handOffsNothing: 0,
  };
  for (const raw of dump.entries as Json[]) {
    const entry = mutate(raw);
    counters.cases += 1;
    const run = await runCase(entry);
    const label = `${entry.message.type} ${entry.message.sessionId || '<empty>'} keepView=${
      entry.message.keepView ?? '-'
    } group=${entry.activeGroupId ?? '-'} view=${entry.settings.preferredAgentInterface}/${JSON.stringify(
      entry.settings.preferredAgentInterfaceOverrides
    )}`;
    if (run.otherActions.length) differences.push(`${label}: the TypeScript posted ${run.otherActions.join(', ')}`);
    counters.tsFocusMarks += run.focusMarks;
    if (!entry.owned) {
      if (run.opens.length) counters.handOffsOpen += 1;
      else counters.handOffsNothing += 1;
      continue;
    }
    const plan = entry.plan as Json;
    if (plan.splitRight) counters.splits += 1;
    else counters.opens += 1;
    if (plan.keepView) counters.keepViews += 1;
    else counters.plainViews += 1;
    if (plan.preferredInterface === 'chat') counters.chatInterfaces += 1;
    else if (plan.preferredInterface === 'terminal') counters.terminalInterfaces += 1;
    else counters.noInterface += 1;
    if (run.acknowledged.length) counters.acknowledgements += 1;
    if (run.opens.length !== 1) {
      differences.push(`${label}: the TypeScript posted ${run.opens.length} opens, the store planned 1`);
      continue;
    }
    const theirs = canonical(run.opens[0]);
    const ours = canonical(plan.nativeAction);
    if (theirs !== ours) differences.push(`${label}:\n  ts   ${theirs}\n  rust ${ours}`);
    // The acknowledgement rides with the command the store still sends on, so the two must agree
    // that it happens rather than on who does it.
    if (plan.acknowledgeAttention !== run.acknowledged.length > 0)
      differences.push(
        `${label}: acknowledgeAttention ${plan.acknowledgeAttention}, the TypeScript acknowledged ${run.acknowledged.length}`
      );
  }

  const zero = Object.entries(counters).filter(([, value]) => value === 0);
  console.log(`remote focus parity: ${counters.cases} cases, ${differences.length} differences`);
  console.log(
    Object.entries(counters)
      .map(([name, value]) => `  ${name} ${value}`)
      .join('\n')
  );
  for (const difference of differences.slice(0, 20)) console.log(`  ${difference}`);
  if (differences.length > 20) console.log(`  ... and ${differences.length - 20} more`);
  if (zero.length) {
    console.error(`coverage counters at zero: ${zero.map(([name]) => name).join(', ')}`);
    process.exit(1);
  }
  if (differences.length) process.exit(1);
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Json).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item
  );
}

const [command, ...rest] = process.argv.slice(2);
if (command !== 'compare') {
  console.error('usage: remote-focus-parity.ts compare <out-dir> [--inject <mutation>]');
  process.exit(2);
}
await compare(rest);
