/**
 * The gate for the sidebar's two account pages: the agent launcher's (`agentAccounts`) and a
 * session row's Switch Account flyout (`sessionAccounts`). It drives the SHIPPED TypeScript
 * through the same scripts the Rust half ran and compares, event by event, what each side asked
 * the daemon, what it published into the menu, which launches it started and which account-switch
 * progress it posted.
 *
 *   cargo run --release --example sidebar_account_menu_parity -- <out-dir> [--inject <m>]  # gx-core
 *   bun tooling/gx-core/account-menu-parity.ts compare <out-dir> [--inject <m>]
 *
 * **The TypeScript side** is the REAL controller (`connectNativeSidebar` over the REAL
 * `createGpuiSidebarRuntime`), driven through `bridge.onNativeSidebarCommand`. Its account calls go
 * through the runtime's own `requestGroupAccounts` / `requestSessionAccounts` (so the per-session
 * account-switch transport is the shipped one), a local call through the runtime's REAL
 * `GpuiGxserverClient.rpc` over a scripted `fetch` (so its envelope and error reading run), and a
 * remote call through a scripted `requestRemoteGxserver` answered with what the Rust bridge shaping
 * lets through. A launch is the runtime's `handleSidebarMessage(runSidebarAgent)`, with the session
 * creation itself stubbed. Its sidebar store is hydrated from the SAME raw presentation through the
 * shipped projection, so a row's working state is derived, not handed over.
 *
 * Every answer is held until the script releases it, so a late answer, an answer overtaken by a
 * newer command and a failure all happen in the order the script says, on both sides.
 *
 * The enumeration half compares the four shared account text rules (`accountUsageLabel`,
 * `isWeeklyWindow`/`isFiveHourWindow`, `accountHeadlineWindows`, `maskAccountText`) and the
 * launcher row's detail line over thousands of built cases. The detail expression is inline in
 * `agent-launcher.ts`, so it is copied here; the scripts cover the shipped one end to end.
 *
 * Compare-side mutations (`--inject` here): swap-headline, round-half-away. Host mutations are the
 * Rust example's own `--inject` (see its header).
 *
 * Nothing here is private data: every account, name and figure is built by the Rust half.
 */
// First, so the client-storage adapter finds a `Storage` before any module reads one.
import { resetBrowserStorage } from './browser-shim';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGpuiSidebarRuntime, GpuiSidebarRuntime } from '@/apps/desktop/sidebar/gxserver-runtime/core';
import { GpuiGxserverClient } from '@/apps/desktop/sidebar/gxserver-runtime/client';
import { createGpuiSidebarHudState } from '@/apps/desktop/sidebar/gxserver-runtime/helpers/command-pane';
import { createGpuiSidebarSettings } from '@/apps/desktop/sidebar/gxserver-runtime/helpers/bootstrap';
import { createGpuiRemotePresentationSidebarGroups } from '@/apps/desktop/sidebar/gxserver-runtime/helpers/remote-presentation';
import { resolveGpuiSidebarAgentIcon } from '@/apps/desktop/sidebar/gxserver-runtime/helpers/presentation-projection';
import { connectNativeSidebar } from '@/apps/desktop/sidebar/native-sidebar/controller';
import { createGxserverPresentationSidebarGroups } from '@/packages/shared/gxserver-presentation-sidebar-projection';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import { writePrimaryAgentLauncherId } from '@/packages/core-ui/primary-agent-launcher';
import { accountUsageLabel } from '@/packages/shared/account-usage-label';
import { accountHeadlineWindows, isFiveHourWindow, isWeeklyWindow } from '@/packages/shared/account-usage-windows';
import { maskAccountText } from '@/packages/shared/account-display';
import type { AgentAccount } from '@/packages/shared/agent-accounts';

type Json = Record<string, any>;

const COMPARE_MUTATIONS = new Set(['swap-headline', 'round-half-away']);
/** Declared difference: an answer that is not an account list. */
const INVALID_ANSWER = 'gxserver returned an invalid account list.';

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** What the TypeScript side did, in order, in the Rust half's vocabulary. */
const events: Json[] = [];
/** Calls waiting for the script to answer them, in the order they were made. */
let pending: { resolve: (step: Json) => void }[] = [];

function installRecorders(): void {
  const window = (globalThis as Json).window as Json;
  window.webkit = {
    messageHandlers: new Proxy({} as Json, {
      get: () => ({
        postMessage: (message: Json) => {
          if (message?.type !== 'accountSwitchProgress') return;
          const event: Json = {
            event: 'progress',
            projectId: message.projectId,
            sessionId: message.sessionId,
            progress: message.progress ?? null,
          };
          if (message.machineId !== undefined) event.machineId = message.machineId;
          events.push(clone(event));
        },
      }),
    }),
  };
  window.ghostexGpui = {
    ...(window.ghostexGpui as Json),
    postNativeSidebarSnapshot: (payload: string) => {
      const parsed = JSON.parse(payload) as Json;
      if (parsed.kind === 'menu')
        events.push({ event: 'publish', ownerId: parsed.ownerId, close: parsed.close, items: parsed.items });
    },
    postNativeProjectPathAction: () => true,
  };
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
  window.setInterval = () => 1;
  window.clearInterval = () => {};
  const prototype = GpuiSidebarRuntime.prototype as Json;
  const handleSidebarMessage = prototype.handleSidebarMessage as (message: Json) => Promise<void>;
  prototype.handleSidebarMessage = function (this: Json, message: Json) {
    if (message?.type === 'runSidebarAgent') events.push({ event: 'launch', message: clone(message) });
    return handleSidebarMessage.call(this, message);
  };
  prototype.requestAgentSessionLaunch = async () => {};
  // The runtime's local client reaches the daemon through `fetch`; only the account path answers.
  (globalThis as Json).fetch = (url: string, init: Json) => {
    const path = new URL(url).pathname;
    if (path !== '/api/agentAccounts') return Promise.reject(new Error(`unexpected call ${path}`));
    events.push({ event: 'request', target: 'local', params: JSON.parse(String(init.body)).params });
    return new Promise((resolve) => {
      pending.push({
        resolve: (step) => {
          const status = Number(step.local?.status ?? 0);
          const body = String(step.local?.body ?? '');
          resolve({ ok: status >= 200 && status < 300, status, text: async () => body });
        },
      });
    });
  };
}

/** The sidebar store, hydrated from the Rust half's own presentation through the shipped projection. */
function hydrate(rust: Json, script: Json): void {
  const window = (globalThis as Json).window as Json;
  window.ghostexGpui.runtimeSettings = { debuggingMode: false, showBetaFeatures: false, settings: {} };
  const local = createGxserverPresentationSidebarGroups({
    presentation: rust.localSnapshot as never,
    resolveAgentIcon: resolveGpuiSidebarAgentIcon,
  } as never);
  const machine = String(rust.remoteMachineId);
  const remote = createGpuiRemotePresentationSidebarGroups({
    presentationsByMachineId: new Map([[machine, rust.remoteSnapshot as never]]),
    resolveAgentIcon: resolveGpuiSidebarAgentIcon,
    settings: createGpuiSidebarSettings({
      debuggingMode: false,
      showBetaFeatures: false,
      settings: { remoteMachines: [{ id: machine, name: 'Remote', sshHost: 'remote.invalid' }] },
    } as never),
  });
  sidebarStore.getState().applySidebarMessage({
    type: 'hydrate',
    revision: 7,
    groups: [...local, ...remote] as never,
    hud: createGpuiSidebarHudState({ runtimeSettings: window.ghostexGpui.runtimeSettings }) as never,
    pinnedPrompts: [],
    previousSessions: [],
  } as never);
  setHud({ agents: rust.agents });
  if (typeof script.primaryAgentId === 'string') writePrimaryAgentLauncherId(script.primaryAgentId);
}

function setHud(patch: { agents?: unknown; hideAccountEmails?: boolean }): void {
  const state = sidebarStore.getState() as Json;
  const hud = { ...state.hud };
  if (patch.agents !== undefined) hud.agents = clone(patch.agents);
  if (patch.hideAccountEmails !== undefined)
    hud.settings = { ...(hud.settings ?? {}), hideAccountEmails: patch.hideAccountEmails };
  (sidebarStore as Json).setState({ hud });
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function runTypeScript(rust: Json, script: Json): Promise<{ events: Json[]; unanswered: number }> {
  resetBrowserStorage();
  hydrate(rust, script);
  // `createGpuiSidebarRuntime`'s own facade, over an instance this harness can reach, because the
  // account calls read `client` and `requestRemoteGxserver` off the instance.
  const runtime = new GpuiSidebarRuntime() as Json;
  const facade: ReturnType<typeof createGpuiSidebarRuntime> = {
    applyWorkspaceGroupsFromHost: (state: unknown) => runtime.applyWorkspaceGroupsFromHost(state),
    persistWorkspaceGroups: () => runtime.persistWorkspaceGroups(),
    messageSource: runtime.messageSource,
    start: () => runtime.start(),
    startLocalGxserver: () => runtime.startLocalGxserver(),
    vscode: runtime.vscode,
  };
  const dispose = connectNativeSidebar(facade);
  await settle();
  runtime.client = new GpuiGxserverClient({ baseUrl: 'http://gate.invalid', authToken: 'gate' } as never);
  runtime.requestRemoteGxserver = (machineId: string, path: string, params: Json) => {
    events.push({ event: 'request', target: `remote:${machineId}`, params: clone(params), path });
    return new Promise((resolve, reject) => {
      pending.push({
        resolve: (step) =>
          'remote' in step ? resolve(clone(step.shaped)) : reject(new Error('Remote gxserver request failed.')),
      });
    });
  };
  events.length = 0;
  const calls: ({ resolve: (step: Json) => void } | undefined)[] = [];
  pending = [];
  const window = (globalThis as Json).window as Json;
  for (const step of (script.steps ?? []) as Json[]) {
    if (step.command) window.ghostexGpui.onNativeSidebarCommand(clone(step.command));
    else if (typeof step.hideAccountEmails === 'boolean') setHud({ hideAccountEmails: step.hideAccountEmails });
    else if (typeof step.answer === 'number') {
      const call = calls[step.answer];
      calls[step.answer] = undefined;
      call?.resolve(step);
    }
    await settle();
    calls.push(...pending);
    pending = [];
  }
  dispose();
  return { events: events.map((event) => clone(event)), unanswered: calls.filter(Boolean).length };
}

/** Both sides written the same way: absent booleans read `false`, key order never matters. */
function normalizeItem(item: Json): Json {
  const normalized: Json = {};
  for (const key of [
    'label',
    'icon',
    'iconColor',
    'color',
    'detail',
    'suffix',
    'imageDataUrl',
    'agentIcon',
    'menuOwner',
    'presentation',
    'menuStyle',
    'split',
  ])
    if (item[key] !== undefined && item[key] !== null) normalized[key] = item[key];
  for (const key of ['supportsChat', 'keepOpen', 'heading', 'checked', 'disabled', 'danger', 'separator', 'primary'])
    normalized[key] = item[key] === true;
  for (const key of ['command', 'onOpen', 'secondary']) if (item[key] != null) normalized[key] = item[key];
  if (Array.isArray(item.children)) normalized.children = item.children.map(normalizeItem);
  return normalized;
}

function canonical(value: unknown): string {
  const sort = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sort)
      : item && typeof item === 'object'
        ? Object.fromEntries(
            Object.entries(item as Json)
              .filter(([, inner]) => inner !== undefined)
              .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
              .map(([key, inner]) => [key, sort(inner)])
          )
        : item;
  return JSON.stringify(sort(value));
}

function normalizeEvents(list: Json[], counters: Record<string, number>, side: 'rust' | 'ts'): Json[] {
  return list
    .filter((event) => event.event !== 'overtaken')
    .map((event) => {
      if (event.event !== 'publish') return event;
      const items = ((event.items ?? []) as Json[]).map((item) => {
        const normalized = normalizeItem(item);
        // Declared difference 43: an answer that is not an account list reads as a named failure
        // here, where the TypeScript showed the engine's TypeError about `data.accounts`.
        if (
          side === 'ts' &&
          typeof normalized.label === 'string' &&
          /accounts|null|undefined/.test(normalized.label) &&
          /object|evaluating|Cannot read/.test(normalized.label)
        ) {
          counters.invalidAnswerDeclared += 1;
          normalized.label = INVALID_ANSWER;
        }
        return normalized;
      });
      return { ...event, items };
    });
}

function countCoverage(list: Json[], counters: Record<string, number>): void {
  for (const event of list) {
    counters.events += 1;
    if (event.event === 'request') {
      counters.requests += 1;
      counters[String(event.target).startsWith('remote:') ? 'remoteRequests' : 'localRequests'] += 1;
      if (event.params?.refresh === true) counters.refreshes += 1;
      if (event.params?.operation === 'select') counters.selects += 1;
    } else if (event.event === 'launch') {
      counters.launches += 1;
      if ('accountId' in (event.message ?? {})) counters.launchesWithAccount += 1;
    } else if (event.event === 'progress') {
      counters[event.progress === null ? 'progressCleared' : 'progressShown'] += 1;
      if (event.machineId) counters.remoteProgress += 1;
    } else if (event.event === 'publish') {
      if (event.close) counters.closes += 1;
      else counters.pages += 1;
      for (const item of (event.items ?? []) as Json[]) {
        counters.items += 1;
        const label = String(item.label ?? '');
        if (label.includes('•••')) counters.maskedLabels += 1;
        if (item.suffix === '· Default') counters.defaultSuffixes += 1;
        if (label === 'Reading accounts…') counters.readingHints += 1;
        if (label === 'Current CLI Login') counters.emptyStates += 1;
        if (label === 'Try Again') counters.errorPairs += 1;
        if (label === 'No saved accounts.') counters.noSavedAccounts += 1;
        if (item.checked === true) counters.checkedAccounts += 1;
        if (item.secondary && String(item.secondary.label) !== '') counters.accountCounts += 1;
        if (typeof item.detail === 'string' && item.detail !== '') counters.detailLines += 1;
      }
    }
  }
}

function compareUsage(
  rust: Json,
  mutation: string | undefined,
  differences: string[],
  counters: Record<string, number>
): void {
  for (const [index, entry] of ((rust.usage ?? []) as Json[]).entries()) {
    const where = `usage #${index} ${entry.kind}`;
    if (entry.kind === 'window') {
      counters.windows += 1;
      const window = entry.window as never;
      let round = entry.round as number;
      const used = (entry.window as Json).usedPercent as number;
      if (Math.abs(used % 1) === 0.5) counters.halfRounds += 1;
      if (mutation === 'round-half-away' && used < 0 && Math.abs(used % 1) === 0.5)
        round = Math.sign(used) * Math.round(Math.abs(used));
      // `String(...)`: the label is only ever read inside a template string.
      const theirs = {
        label: String(accountUsageLabel(window)),
        weekly: isWeeklyWindow(window),
        fiveHour: isFiveHourWindow(window),
        round: String(Math.round(used)),
      };
      const mine = { label: entry.label, weekly: entry.weekly, fiveHour: entry.fiveHour, round: String(round) };
      if (canonical(mine) !== canonical(theirs))
        differences.push(`${where} ${JSON.stringify(entry.window)}: rust ${canonical(mine)} ts ${canonical(theirs)}`);
    } else if (entry.kind === 'account') {
      counters.accounts += 1;
      const account = entry.account as AgentAccount;
      const headline = accountHeadlineWindows(account).map((window) => account.usage.indexOf(window));
      let mine = entry.headline as number[];
      if (mine.length >= 2 && mine[0] !== mine[1]) counters.twoWindowHeadlines += 1;
      if (mutation === 'swap-headline' && mine.length >= 2) mine = [...mine].reverse();
      // `agent-launcher.ts`, the row's detail line, copied: see the header.
      const provider = account.provider;
      const weekly = account.usage.filter((window) => !window.model).find(isWeeklyWindow);
      const percent = (window: (typeof account.usage)[number]) =>
        `${accountUsageLabel(window)}: ${Math.round(window.usedPercent)}%`;
      const usage =
        provider === 'claude'
          ? accountHeadlineWindows(account).map(percent)
          : [weekly ? percent(weekly) : null, account.resetCredits != null ? `${account.resetCredits}rs` : null];
      const detail = usage.filter(Boolean).join(' · ');
      if (canonical(mine) !== canonical(headline) || entry.detail !== detail)
        differences.push(
          `${where} ${JSON.stringify(account)}: rust ${canonical(mine)} ${JSON.stringify(entry.detail)} ts ${canonical(headline)} ${JSON.stringify(detail)}`
        );
    } else if (entry.kind === 'mask') {
      counters.masks += 1;
      const theirs = maskAccountText(String(entry.text));
      if (theirs !== entry.text) counters.masksChanged += 1;
      if (theirs !== entry.masked)
        differences.push(
          `${where} ${JSON.stringify(entry.text)}: rust ${JSON.stringify(entry.masked)} ts ${JSON.stringify(theirs)}`
        );
    }
  }
}

async function compare(args: string[]): Promise<void> {
  const outDir = args[0];
  const at = args.indexOf('--inject');
  const mutation = at >= 0 ? args[at + 1] : undefined;
  if (!outDir || (mutation !== undefined && !COMPARE_MUTATIONS.has(mutation))) {
    console.error(`usage: account-menu-parity.ts compare <out-dir> [--inject <${[...COMPARE_MUTATIONS].join('|')}>]`);
    process.exitCode = 2;
    return;
  }
  const rust = JSON.parse(readFileSync(join(outDir, 'account-menu-rust.json'), 'utf8')) as Json;
  installRecorders();
  const differences: string[] = [];
  const counters: Record<string, number> = Object.fromEntries(
    [
      'scripts',
      'events',
      'requests',
      'localRequests',
      'remoteRequests',
      'refreshes',
      'selects',
      'launches',
      'launchesWithAccount',
      'progressShown',
      'progressCleared',
      'remoteProgress',
      'pages',
      'closes',
      'items',
      'maskedLabels',
      'defaultSuffixes',
      'readingHints',
      'emptyStates',
      'errorPairs',
      'noSavedAccounts',
      'checkedAccounts',
      'accountCounts',
      'detailLines',
      'overtaken',
      'invalidAnswerDeclared',
      'windows',
      'halfRounds',
      'accounts',
      'twoWindowHeadlines',
      'masks',
      'masksChanged',
    ].map((key) => [key, 0])
  );
  const rustRuns = new Map(((rust.rust ?? []) as Json[]).map((run) => [String(run.name), run]));
  for (const script of (rust.scripts ?? []) as Json[]) {
    counters.scripts += 1;
    const mine = rustRuns.get(String(script.name));
    if (!mine) {
      differences.push(`${String(script.name)}: the Rust half ran no such script`);
      continue;
    }
    counters.overtaken += ((mine.events ?? []) as Json[]).filter((event) => event.event === 'overtaken').length;
    const theirs = await runTypeScript(rust, script);
    // The remote request carries its path on the TypeScript side only; the Rust half names it once.
    const theirEvents = normalizeEvents(
      theirs.events.map((event) => {
        if (event.event !== 'request') return event;
        if (event.path !== undefined && event.path !== '/api/agentAccounts')
          differences.push(`${String(script.name)}: a remote call to ${String(event.path)}`);
        const { path: _path, ...rest } = event;
        return rest;
      }),
      counters,
      'ts'
    );
    const myEvents = normalizeEvents((mine.events ?? []) as Json[], counters, 'rust');
    countCoverage(theirEvents, counters);
    const length = Math.max(myEvents.length, theirEvents.length);
    for (let index = 0; index < length; index += 1) {
      const left = canonical(myEvents[index] ?? null);
      const right = canonical(theirEvents[index] ?? null);
      if (left !== right) {
        differences.push(`${String(script.name)} event ${index}:\n    rust ${left}\n    ts   ${right}`);
        break;
      }
    }
    if (mine.unanswered !== theirs.unanswered)
      differences.push(`${String(script.name)}: unanswered rust ${mine.unanswered} ts ${theirs.unanswered}`);
  }
  compareUsage(rust, mutation, differences, counters);
  console.log(
    Object.entries(counters)
      .map(([key, value]) => `${key} ${value}`)
      .join(', ')
  );
  const zero = Object.entries(counters).filter(([key, value]) => value === 0 && key !== 'invalidAnswerDeclared');
  if (zero.length) differences.push(`coverage: ${zero.map(([key]) => key).join(', ')} reached nothing`);
  for (const difference of differences.slice(0, 20)) console.log(difference);
  console.log(`differences ${differences.length}`);
  if (differences.length) process.exitCode = 1;
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === 'compare') await compare(rest);
else {
  console.error('usage: account-menu-parity.ts compare <out-dir> [--inject <mutation>]');
  process.exit(2);
}
