/**
 * The gate for a click on a row of another machine: the native action it opens, the attention
 * acknowledgement and the remote focus marks, against the shipped TypeScript.
 *
 *   cargo run --release --example sidebar_remote_focus_parity -- <out-dir>   # from packages/gx-core
 *   bun tooling/gx-core/remote-focus-parity.ts compare <out-dir> [--inject <mutation>]
 *
 * **What is compared.** Every case the Rust half enumerated (an id shape, a message, the group that
 * is active, a Default Agent View with its overrides) is run TWICE on the shipped runtime. The OLD
 * run is the path the store no longer takes: the command through `handleSidebarMessage`, whose
 * remote branch acknowledges, posts the open and moves the marks. The NEW run is what the store
 * now sends the runtime instead: the plan's `attentionAcknowledgement` through
 * `handleGpuiWorkspaceSessionAttentionAcknowledge`, then the tab selection the store's open sends
 * (`tabSelection`) through `handleGpuiWorkspaceTabSessionSelected`. Compared between the two:
 * the open payload (the old run's post against the plan's `nativeAction`, field for field), every
 * `/api/updateAgentActivity` call to the machine, every minimum-visible-window timer armed, the
 * row's attention state, the locally acknowledged events, every focus state the runtime posts to
 * Rust, every remote patch published (with the focus and the row's attention it carried, in
 * order), the runtime's `activeGroupId`, focused and visible sessions, and every toast (the
 * remembered session's write lands in an indexeddb store this harness cannot load, so it fails into
 * a toast on both sides; what it is given is the focused session, compared directly); then the timers fire on both sides and the machine calls and the row are
 * compared again. Only the bridge, the machine call and the patch builder are replaced.
 *
 * **Attention shapes.** The row is idle, in attention past its minimum visible window (cleared at
 * once), or in attention that entered a moment ago (a timer is armed and fires the clear), by case
 * index, so every other dimension meets every shape. `ackCleared`, `ackDeferred` and `ackIdle` are
 * in the zero-check.
 *
 * **Hand-offs.** A case the Rust planner refuses goes to the old runtime whole, unchanged. It is
 * counted by what the TypeScript then does: `handOffsOpen` when it still posts the native action,
 * `handOffsNothing` when it posts nothing. `lastSeenHandOffs` counts the hand-offs of a machine drawn
 * from its stored last-seen copy; the offline machine is one the store holds no rows for.
 *
 * **The active group is the RUNTIME's, reached the way the live host reaches it.** Each case
 * carries a history (`published`, `sentPublishLagging`, `tellAfterRemote`, `tellPending`): the Rust
 * half fed it to the `RuntimeActiveGroup` the host uses and planned from its answer (`hostGroupId`),
 * and both runs replay it through the runtime's own focus methods first. The group the runtime then
 * holds must be the case's `activeGroupId`, the host's group must name the same remote project, and
 * the group the NEW run leaves must be the plan's `focusGroup`, which is what the host tracks next.
 *
 * A gate that cannot fail is worse than none, so `--inject` mutates the Rust dump with a plausible
 * port mistake and the run must then show a difference or collapse a counter.
 */
// First, so the client-storage adapter finds a `Storage` before any module reads one.
import { resetBrowserStorage } from './browser-shim';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GpuiSidebarRuntime } from '@/apps/desktop/sidebar/gxserver-runtime/core';
import {
  GPUI_SIDEBAR_WORKSPACE_TAB_SESSION_SELECTED_MESSAGE_TYPE,
  GPUI_SIDEBAR_WORKSPACE_TAB_SESSION_SELECTED_MESSAGE_VERSION,
} from '@/apps/desktop/sidebar/gxserver-runtime/constants';
import {
  parseGpuiRemotePresentationGroupId,
  parseGpuiRemotePresentationSessionId,
} from '@/apps/desktop/sidebar/gxserver-runtime/helpers/remote-presentation';

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
  // The planner answers a machine whose rows are the stored last-seen copy, reading the agent off
  // those rows: the open then carries a `preferredInterface` the old runtime never sends.
  'answer-a-last-seen-machine': (entry) =>
    entry.lastSeenPlan ? { ...entry, owned: true, plan: entry.lastSeenPlan } : entry,
  // `keepView` planned from the core's own focus, which never follows a remote focus: the reviewed
  // bug, where every second click inside the active remote project sent a `keepView` the runtime
  // did not.
  'keepview-from-core-focus': (entry) => (entry.owned ? { ...entry, plan: entry.corePlan } : entry),
  // `keepView` planned from the runtime's last publish alone, which lags a click sent a moment ago
  // and a local click's tell.
  'keepview-from-the-last-publish': (entry) => (entry.owned ? { ...entry, plan: entry.publishedPlan } : entry),
  // The group of the last remote click believed even after a local click's tell went out.
  'keepview-ignores-a-later-tell': (entry) => (entry.owned ? { ...entry, plan: entry.ignoresTellPlan } : entry),
  // A blank agent id read as an agent, which gives the row the Default Agent View (the source
  // mutation of `PreferredInterfaceSettings::resolve` without its trim and empty check).
  'blank-agent-id-is-an-agent': (entry) =>
    withPlan(entry, (plan) => {
      const row = (entry.presentation.sessions as Json[]).find(
        (session) =>
          `remote:${entry.liveMachineIds[0]}:session:${session.projectId}:${session.sessionId}` ===
          entry.message.sessionId
      );
      if (plan.splitRight || typeof row?.agentId !== 'string' || row.agentId.trim() !== '') return plan;
      const value = String(entry.settings?.preferredAgentInterface ?? 'terminal');
      return {
        ...plan,
        preferredInterface: value,
        nativeAction: { ...plan.nativeAction, preferredInterface: value },
      };
    }),
  // No acknowledgement at all: a row in attention stays in attention after the click.
  'no-acknowledgement': (entry) => withPlan(entry, (plan) => ({ ...plan, attentionAcknowledgement: null })),
  // The raw ids on the bridge, which the runtime reads as a LOCAL row and acknowledges nothing on
  // the machine.
  'acknowledge-with-raw-ids': (entry) =>
    withPlan(entry, (plan) => ({
      ...plan,
      attentionAcknowledgement: {
        ...plan.attentionAcknowledgement,
        projectId: String(plan.attentionAcknowledgement.projectId).split(':').slice(3).join(':'),
        sessionId: String(plan.attentionAcknowledgement.sessionId).split(':').slice(4).join(':'),
      },
    })),
  // The session named on another machine than its project, which the runtime must refuse.
  'acknowledge-a-mismatched-pair': (entry) =>
    withPlan(entry, (plan) => ({
      ...plan,
      attentionAcknowledgement: {
        ...plan.attentionAcknowledgement,
        projectId: String(plan.attentionAcknowledgement.projectId).replace(/^remote:[^:]+:/, 'remote:elsewhere:'),
      },
    })),
  // The acknowledgement sent after the open, so the first patch publishes the new focus with the
  // row still in attention.
  'acknowledge-after-the-open': (entry) => withPlan(entry, (plan) => ({ ...plan, acknowledgeAfterOpen: true })),
  // The open's tab selection never moves the marks: the row is opened and never highlighted.
  'no-focus-marks': (entry) => withPlan(entry, (plan) => ({ ...plan, tabSelection: null })),
  // The marks put on the project named by the RAW project id, which the runtime refuses as a
  // mismatched pair.
  'marks-with-a-raw-project': (entry) =>
    withPlan(entry, (plan) => ({
      ...plan,
      tabSelection: {
        ...plan.tabSelection,
        projectId: String(plan.tabSelection.projectId).split(':').slice(3).join(':'),
      },
    })),
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

/** Everything one run left behind that the old path and the new one must agree on. */
type Run = {
  /** Every `openRemoteSessionTerminal` payload the runtime posted, in order. */
  opens: Json[];
  /** Every other native action, which this path must never post. */
  otherActions: string[];
  /** Every call to the machine, `path` plus body. */
  machineCalls: Json[];
  /** Every minimum-visible-window timer armed, by its delay, and the callbacks to fire them. */
  timers: number[];
  timerCallbacks: (() => void)[];
  /** Every focus state posted to Rust. */
  focusStates: Json[];
  /** Every remote patch published, with what it carried. */
  patches: Json[];
  toasts: Json[];
  /** `activeGroupId` once the history ran, before the click. */
  groupBefore: string | undefined;
  /** What the click left behind. */
  after: Json;
  /** After the timers fired. */
  afterTimers: Json;
  /** Whether the click changed the runtime's remote focus at all. */
  focusMarked: boolean;
};

const realSetRemoteFocus = GpuiSidebarRuntime.prototype.setRemotePresentationSessionFocus;
/** The row's attention, by case index. */
const ATTENTION_SHAPES = ['idle', 'cleared', 'deferred'] as const;
/** `GPUI_MIN_ATTENTION_VISIBLE_MS` is longer than this, so an entry this recent defers the clear. */
const RECENT_ATTENTION_MS = 50;

/** The runtime both runs start from: that machine's presentation, the settings, the history. */
function freshRuntime(entry: Json, shape: (typeof ATTENTION_SHAPES)[number], run: Run): Json {
  const target = parseGpuiRemotePresentationSessionId(String(entry.message.sessionId));
  const presentation = structuredClone(entry.presentation) as Json;
  if (shape !== 'idle' && target) {
    for (const session of presentation.sessions as Json[]) {
      if (session.projectId === target.projectId && session.sessionId === target.sessionId) {
        session.activity = 'attention';
        session.attention = { eventId: 'E1', enteredAt: '2026-09-21T00:00:00.000Z' };
      }
    }
  }
  const runtime = Object.create(GpuiSidebarRuntime.prototype) as Json;
  runtime.browserTabs = [];
  runtime.latestGroups = [];
  runtime.presentation = undefined;
  runtime.activeProjectId = undefined;
  runtime.activeGroupId = entry.startGroupId ?? undefined;
  runtime.focusedSessionId = undefined;
  runtime.visibleSessionIds = new Set<string>();
  runtime.domainProjects = [];
  // The machines this run's stream delivered carry the same presentation, which is what the Rust
  // half seeds too. The one the store holds nothing for, and the one it holds only as the stored
  // last-seen copy, are absent from this map, as they are from the shipped runtime's.
  runtime.remotePresentations = new Map(
    (entry.liveMachineIds as string[]).map((machineId) => [machineId, structuredClone(presentation)])
  );
  runtime.remoteSidebarHuds = new Map();
  // `createGpuiSidebarSettings` normalizes `runtimeSettings.settings`, not `runtimeSettings`.
  runtime.runtimeSettings = { settings: entry.settings };
  runtime.client = undefined;
  runtime.attentionEnteredAtBySessionKey = new Map<string, number>();
  runtime.attentionEventIdBySessionKey = new Map<string, string>();
  runtime.attentionAcknowledgementTimeoutsBySessionKey = new Map<string, number>();
  runtime.locallyAcknowledgedAttentionEventKeys = new Set<string>();
  runtime.locallyAcknowledgedAttentionEventKeyOrder = [];
  if (shape === 'deferred' && target) {
    runtime.attentionEnteredAtBySessionKey.set(String(entry.message.sessionId), PINNED_NOW_MS - RECENT_ATTENTION_MS);
  }
  runtime.requestRemoteGxserver = async (machineId: string, path: string, body: Json) => {
    run.machineCalls.push({ machineId, path, body });
    return {};
  };
  runtime.publishRemotePresentationPatch = () =>
    void run.patches.push({
      activeGroupId: runtime.activeGroupId ?? null,
      focusedSessionId: runtime.focusedSessionId ?? null,
      row: targetRow(runtime, entry),
    });
  runtime.publishPresentation = () => {};
  // The remembered session is written to an indexeddb-backed store this harness cannot load, so
  // its write fails into this toast on BOTH sides; the arguments it was given are the focused
  // session and project, which are compared directly.
  runtime.postSidebarActionToast = (kind: string, message: string) => void run.toasts.push({ kind, message });
  runtime.postSidebarSessionFocusConfirmation = () => {};
  runtime.focusBrowserTabProject = () => {};
  runtime.focusLocalWorkspaceSession = () => {};
  runtime.refreshSidebarHudFromClient = () => {};
  runtime.postLocalWorkspaceTerminalFocus = () => {};
  const window = (globalThis as Json).window as Json;
  window.setTimeout = (callback: () => void, delay: number) => {
    run.timers.push(delay);
    run.timerCallbacks.push(callback);
    return run.timerCallbacks.length;
  };
  window.clearTimeout = () => {};
  window.ghostexGpui = {
    ...(window.ghostexGpui as Json),
    postNativeProjectPathAction(payload: string) {
      // What reaches the bridge is JSON, so an `undefined` field is no field.
      const message = JSON.parse(payload) as Json;
      if (message.action === 'openRemoteSessionTerminal') run.opens.push(message);
      else run.otherActions.push(String(message.action));
      return true;
    },
    postGxserverPresentationFocusState(payload: string) {
      run.focusStates.push(JSON.parse(payload) as Json);
    },
    postBrowserTabFocus() {},
  };
  // The history, through the runtime's own focus methods.
  for (const step of (entry.historySteps ?? []) as Json[]) {
    if (step.step === 'remoteFocus') {
      realSetRemoteFocus.call(runtime as GpuiSidebarRuntime, parseGpuiRemotePresentationSessionId(step.sessionId)!);
    } else if (step.step === 'localTell') {
      runtime.handleGpuiWorkspaceTabSessionSelected({
        focusStamp: step.focusStamp,
        projectId: step.projectId,
        sessionId: step.sessionId,
        type: GPUI_SIDEBAR_WORKSPACE_TAB_SESSION_SELECTED_MESSAGE_TYPE,
        version: GPUI_SIDEBAR_WORKSPACE_TAB_SESSION_SELECTED_MESSAGE_VERSION,
        visibleSessionIds: [step.sessionId],
      });
    } else {
      throw new Error(`unknown history step ${step.step}`);
    }
  }
  // The history's own posts are not the click's.
  run.focusStates.length = 0;
  run.patches.length = 0;
  run.toasts.length = 0;
  run.groupBefore = runtime.activeGroupId;
  return runtime;
}

function targetRow(runtime: Json, entry: Json): Json | null {
  const target = parseGpuiRemotePresentationSessionId(String(entry.message.sessionId));
  if (!target) return null;
  const row = (runtime.remotePresentations.get(target.machineId)?.sessions as Json[] | undefined)?.find(
    (session) => session.projectId === target.projectId && session.sessionId === target.sessionId
  );
  return row ? { activity: row.activity, attention: row.attention ?? null } : null;
}

function state(runtime: Json, entry: Json, run: Run): Json {
  const target = parseGpuiRemotePresentationSessionId(String(entry.message.sessionId));
  return {
    activeGroupId: runtime.activeGroupId ?? null,
    focusedSessionId: runtime.focusedSessionId ?? null,
    visibleSessionIds: [...(runtime.visibleSessionIds as Set<string>)],
    toasts: structuredClone(run.toasts),
    row: targetRow(runtime, entry),
    acknowledgedEvents: [...(runtime.locallyAcknowledgedAttentionEventKeys as Set<string>)],
    enteredAt: [...(runtime.attentionEnteredAtBySessionKey as Map<string, number>).entries()],
    armed: [...(runtime.attentionAcknowledgementTimeoutsBySessionKey as Map<string, number>).keys()],
    machineCalls: structuredClone(run.machineCalls),
    timers: [...run.timers],
    focusStates: structuredClone(run.focusStates),
    patches: structuredClone(run.patches),
  };
}

function emptyRun(): Run {
  return {
    opens: [],
    otherActions: [],
    machineCalls: [],
    timers: [],
    timerCallbacks: [],
    focusStates: [],
    patches: [],
    toasts: [],
    groupBefore: undefined,
    after: {},
    afterTimers: {},
    focusMarked: false,
  };
}

async function finish(runtime: Json, entry: Json, run: Run): Promise<void> {
  // The machine call is fired and not awaited by the runtime; let it settle.
  await Promise.resolve();
  run.after = state(runtime, entry, run);
  run.focusMarked = run.focusStates.length > 0;
  for (const callback of run.timerCallbacks.splice(0)) callback();
  await Promise.resolve();
  run.afterTimers = state(runtime, entry, run);
}

/** The path the store no longer takes: the command through the shipped `handleSidebarMessage`. */
async function runOld(entry: Json, shape: (typeof ATTENTION_SHAPES)[number]): Promise<Run> {
  const run = emptyRun();
  const runtime = freshRuntime(entry, shape, run);
  await runtime.handleSidebarMessage(entry.message).catch(() => undefined);
  await finish(runtime, entry, run);
  return run;
}

/** What the store sends instead: the acknowledgement, then the open's tab selection. */
async function runNew(entry: Json, shape: (typeof ATTENTION_SHAPES)[number]): Promise<Run> {
  const run = emptyRun();
  const runtime = freshRuntime(entry, shape, run);
  const plan = entry.plan as Json;
  const acknowledge = () => {
    if (plan.attentionAcknowledgement)
      runtime.handleGpuiWorkspaceSessionAttentionAcknowledge(plan.attentionAcknowledgement);
  };
  if (!plan.acknowledgeAfterOpen) acknowledge();
  if (plan.tabSelection) {
    // The host's message (`dispatch_gpui_workspace_tab_session_selected`): the two scoped ids, and
    // the visible ids the remote branch does not read.
    runtime.handleGpuiWorkspaceTabSessionSelected({
      ...plan.tabSelection,
      type: GPUI_SIDEBAR_WORKSPACE_TAB_SESSION_SELECTED_MESSAGE_TYPE,
      version: GPUI_SIDEBAR_WORKSPACE_TAB_SESSION_SELECTED_MESSAGE_VERSION,
      visibleSessionIds: [plan.tabSelection.sessionId],
    });
  }
  if (plan.acknowledgeAfterOpen) acknowledge();
  await finish(runtime, entry, run);
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
    ackCleared: 0,
    ackDeferred: 0,
    ackIdle: 0,
    machineCalls: 0,
    focusMarks: 0,
    patchesCompared: 0,
    handOffsOpen: 0,
    handOffsNothing: 0,
    lastSeenHandOffs: 0,
    historyPublished: 0,
    historySentPublishLagging: 0,
    historyTellAfterRemote: 0,
    historyTellPending: 0,
    blankAgentRows: 0,
  };
  let index = 0;
  for (const raw of dump.entries as Json[]) {
    const entry = mutate(raw);
    const shape = ATTENTION_SHAPES[index % ATTENTION_SHAPES.length];
    index += 1;
    counters.cases += 1;
    const old = await runOld(entry, shape);
    const label = `${entry.message.type} ${entry.message.sessionId || '<empty>'} keepView=${
      entry.message.keepView ?? '-'
    } history=${entry.history} group=${entry.activeGroupId ?? '-'} attention=${shape} view=${
      entry.settings.preferredAgentInterface
    }/${JSON.stringify(entry.settings.preferredAgentInterfaceOverrides)}`;
    if (old.otherActions.length) differences.push(`${label}: the TypeScript posted ${old.otherActions.join(', ')}`);
    // The history must leave the runtime where the case says, and the host must read the same
    // remote project out of its own group, or the case is not testing what it claims.
    if (old.groupBefore !== (entry.activeGroupId ?? undefined))
      differences.push(`${label}: the history left the runtime on ${old.groupBefore ?? '-'}`);
    if (!sameRemoteProject(entry.hostGroupId, old.groupBefore))
      differences.push(
        `${label}: the host read ${entry.hostGroupId ?? '-'}, the runtime holds ${old.groupBefore ?? '-'}`
      );
    const historyCounter = `history${String(entry.history).charAt(0).toUpperCase()}${String(entry.history).slice(1)}`;
    if (!(historyCounter in counters)) throw new Error(`unknown history ${entry.history}`);
    (counters as Record<string, number>)[historyCounter] += 1;
    if (!entry.owned) {
      // Handed back: the command is sent on and the old runtime performs it whole, as before.
      if (entry.lastSeenPlan !== undefined && old.opens.length) counters.lastSeenHandOffs += 1;
      if (old.opens.length) counters.handOffsOpen += 1;
      else counters.handOffsNothing += 1;
      continue;
    }
    const plan = entry.plan as Json;
    if (/:R1:RS[34]$/.test(entry.message.sessionId)) counters.blankAgentRows += 1;
    if (plan.splitRight) counters.splits += 1;
    else counters.opens += 1;
    if (plan.keepView) counters.keepViews += 1;
    else counters.plainViews += 1;
    if (plan.preferredInterface === 'chat') counters.chatInterfaces += 1;
    else if (plan.preferredInterface === 'terminal') counters.terminalInterfaces += 1;
    else counters.noInterface += 1;
    if (old.opens.length !== 1) {
      differences.push(`${label}: the TypeScript posted ${old.opens.length} opens, the store planned 1`);
      continue;
    }
    const theirs = canonical(old.opens[0]);
    const ours = canonical(plan.nativeAction);
    if (theirs !== ours) differences.push(`${label}:\n  ts   ${theirs}\n  rust ${ours}`);
    const fresh = await runNew(entry, shape);
    if (fresh.opens.length || fresh.otherActions.length)
      differences.push(`${label}: the store's messages made the runtime post a native action`);
    // The group the click leaves is what the host tracks for the next one.
    if (fresh.after.activeGroupId !== entry.focusGroup)
      differences.push(
        `${label}: the click left ${fresh.after.activeGroupId ?? '-'}, the host tracks ${entry.focusGroup ?? '-'}`
      );
    for (const [when, a, b] of [
      ['after the click', old.after, fresh.after],
      ['after the timers', old.afterTimers, fresh.afterTimers],
    ] as const) {
      const left = canonical(a);
      const right = canonical(b);
      if (left !== right) differences.push(`${label}: ${when}\n  old ${left}\n  new ${right}`);
    }
    if (old.after.row?.activity === 'attention' && old.afterTimers.row?.activity === 'idle') counters.ackDeferred += 1;
    else if (shape !== 'idle' && old.after.row?.activity === 'idle') counters.ackCleared += 1;
    else if (shape === 'idle') counters.ackIdle += 1;
    counters.machineCalls += (old.afterTimers.machineCalls as Json[]).length;
    if (old.focusMarked) counters.focusMarks += 1;
    counters.patchesCompared += (old.after.patches as Json[]).length;
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

/** `focusChangesActiveProject` reads only the remote project a group id names. */
function sameRemoteProject(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = a ? parseGpuiRemotePresentationGroupId(a) : undefined;
  const right = b ? parseGpuiRemotePresentationGroupId(b) : undefined;
  return left?.machineId === right?.machineId && left?.projectId === right?.projectId;
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
