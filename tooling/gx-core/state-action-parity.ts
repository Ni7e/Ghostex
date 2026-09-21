/**
 * The gate for the three renderer commands the sidebar page answered itself with no Rust owner: a
 * row's Delayed Send (`sessionAction: delayedSend`), the agent launcher's run
 * (`projectAction: agent`) and a machine tab's Hide Machine (`machineAction` other than
 * Configure). It compares where the store's plan ENDS against where the shipped TypeScript's path
 * ends, edge by edge.
 *
 *   cargo run --release --example sidebar_state_action_parity -- <out-dir>   # from packages/gx-core
 *   bun tooling/gx-core/state-action-parity.ts compare <out-dir> [--inject <mutation>]
 *
 * **The TypeScript side** is the REAL controller (`connectNativeSidebar` over the REAL
 * `createGpuiSidebarRuntime`), driven through `bridge.onNativeSidebarCommand` with the command the
 * Rust entry answered. Its sidebar store is hydrated from the SAME raw presentation and host
 * timers the Rust side used, through the shipped projection (`createGxserverPresentationSidebarGroups`
 * with the runtime's own agent-icon resolver), and its HUD settings from the same saved machine
 * list through the shipped `createGpuiSidebarHudState`, so a port that derived a row or a list
 * differently is a difference here rather than an agreement about a handed-over answer. Every
 * edge is recorded: app-modal-host and native-host messages (whole), local and session storage
 * writes (key and value), the runtime's `handleSidebarMessage` (whole message, and it runs for
 * real except `requestAgentSessionLaunch`, which would create a session), bridge publishes, and
 * inbound sidebar messages.
 *
 * **The Rust side's ends are driven too, not merely compared as payloads.** An `openAppModal` is
 * the app-modal-host message itself. A `sidebarHostMessage` is handed to the REAL runtime's
 * `onSidebarHostMessage` (installed by `installGpuiBridgeCallbacks`) under the same recorders,
 * because that entry is the claim: that it performs the same storage write and the same
 * `handleSidebarMessage` the page's own path did. An `updateSettingsPatch` is the message the
 * bridge's `sidebarCommand` arm hands `handle_gpui_app_modal_update_settings_patch_message`, so
 * it is compared with the `message` of the TypeScript's `sidebarCommand` post, minus
 * `baseRevision`, which that function never reads (declared difference 42); the gate asserts the
 * TypeScript does carry one, so the drop is visible.
 *
 * Mutations (`--inject`), each of which must be caught:
 *   delayed-send-closes-first, drop-specific-agent, drop-close-after-done, null-agent-icon,
 *   refuse-delayed-send                                   (Delayed Send)
 *   run-through-post, configure-launches, account-id-null, launch-on-a-missing-group  (the run)
 *   raw-machine-list, hide-every-machine                  (Hide Machine)
 *
 * Nothing here is private data: every input is built.
 */
// First, so the client-storage adapter finds a `Storage` before any module reads one.
import { resetBrowserStorage } from './browser-shim';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGpuiSidebarRuntime, GpuiSidebarRuntime } from '@/apps/desktop/sidebar/gxserver-runtime/core';
import { createGpuiSidebarHudState } from '@/apps/desktop/sidebar/gxserver-runtime/helpers/command-pane';
import { createGpuiSidebarSettings } from '@/apps/desktop/sidebar/gxserver-runtime/helpers/bootstrap';
import { createGpuiRemotePresentationSidebarGroups } from '@/apps/desktop/sidebar/gxserver-runtime/helpers/remote-presentation';
import { resolveGpuiSidebarAgentIcon } from '@/apps/desktop/sidebar/gxserver-runtime/helpers/presentation-projection';
import { connectNativeSidebar } from '@/apps/desktop/sidebar/native-sidebar/controller';
import { createGxserverPresentationSidebarGroups } from '@/packages/shared/gxserver-presentation-sidebar-projection';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';

type Json = Record<string, any>;

const MUTATIONS = new Set([
  'delayed-send-closes-first',
  'drop-specific-agent',
  'drop-close-after-done',
  'null-agent-icon',
  'refuse-delayed-send',
  'run-through-post',
  'configure-launches',
  'account-id-null',
  'launch-on-a-missing-group',
  'raw-machine-list',
  'hide-every-machine',
]);

/** Every edge the route reached, in order. */
const edges: Json[] = [];

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** The edges a route could reach, all recorders. Installed once. */
function installRecorders(): void {
  const window = (globalThis as Json).window as Json;
  window.webkit = {
    messageHandlers: new Proxy({} as Json, {
      get: (_target, name) => ({
        postMessage: (message: Json) => edges.push({ edge: `webkit.${String(name)}`, message: clone(message) }),
      }),
    }),
  };
  window.ghostexGpui = {
    ...(window.ghostexGpui as Json),
    postNativeSidebarSnapshot: (payload: string) => {
      const parsed = JSON.parse(payload) as Json;
      if (parsed.kind !== 'snapshot' && parsed.kind !== 'clock')
        edges.push({ edge: 'sidebarSnapshot', kind: parsed.kind });
    },
    postNativeProjectPathAction: () => {
      edges.push({ edge: 'nativeProjectPathAction' });
      return true;
    },
  };
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
  window.setInterval = () => 1;
  window.clearInterval = () => {};
  for (const area of ['localStorage', 'sessionStorage']) {
    const storage = window[area] as Json;
    const setItem = storage.setItem.bind(storage);
    const removeItem = storage.removeItem.bind(storage);
    storage.setItem = (key: string, value: string) => {
      edges.push({ edge: `${area}.setItem`, key, value });
      setItem(key, value);
    };
    storage.removeItem = (key: string) => {
      edges.push({ edge: `${area}.removeItem`, key });
      removeItem(key);
    };
  }
  const prototype = GpuiSidebarRuntime.prototype as Json;
  const handleSidebarMessage = prototype.handleSidebarMessage as (message: Json) => Promise<void>;
  prototype.handleSidebarMessage = function (this: Json, message: Json) {
    edges.push({ edge: 'handleSidebarMessage', message: clone(message) });
    return handleSidebarMessage.call(this, message);
  };
  // The launch itself creates a session; the arm reaching it is the end this gate proves.
  prototype.requestAgentSessionLaunch = async (agentId: unknown, groupId: unknown, accountId: unknown) => {
    edges.push({ edge: 'requestAgentSessionLaunch', agentId, groupId, accountId: accountId ?? '(none)' });
  };
}

/**
 * Every entry of both storage areas. The client-storage adapter writes through the `Storage`
 * PROTOTYPE methods it captured on first use, which no instance recorder sees, so a write is found
 * by comparing the areas before and after the command instead.
 */
function storageEntries(): Map<string, string> {
  const window = (globalThis as Json).window as Json;
  const entries = new Map<string, string>();
  for (const area of ['localStorage', 'sessionStorage']) {
    const storage = window[area] as Json;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index) as string | null;
      if (key !== null) entries.set(`${area}:${key}`, String(storage.getItem(key)));
    }
  }
  return entries;
}

function storageChanges(before: Map<string, string>): Json[] {
  const after = storageEntries();
  const changes: Json[] = [];
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort())
    if (before.get(key) !== after.get(key)) changes.push({ edge: 'storage', key, value: after.get(key) ?? null });
  return changes;
}

/** The sidebar store, hydrated from the Rust side's own inputs through the shipped projection. */
function hydrate(rust: Json, savedRemoteMachines: unknown): void {
  const window = (globalThis as Json).window as Json;
  window.ghostexGpui.runtimeSettings = {
    debuggingMode: false,
    showBetaFeatures: false,
    settings: savedRemoteMachines === undefined ? {} : { remoteMachines: savedRemoteMachines },
  };
  const delayed = (rust.hostDelayedSends ?? {}) as Json;
  const close = (rust.hostCloseAfterDone ?? {}) as Json;
  const local = createGxserverPresentationSidebarGroups({
    presentation: rust.localSnapshot as never,
    resolveAgentIcon: resolveGpuiSidebarAgentIcon,
    resolveDelayedSend: (projectId, sessionId) => delayed[`combined-session:${projectId}:${sessionId}`],
    resolveCloseAfterDone: (projectId, sessionId) => close[`combined-session:${projectId}:${sessionId}`],
  });
  // The remote machine's groups through the runtime's own remote projection, which only draws a
  // machine the settings name, so it is given one regardless of the list under test.
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
  const runtimeSettings = window.ghostexGpui.runtimeSettings;
  sidebarStore.getState().applySidebarMessage({
    type: 'hydrate',
    revision: 7,
    groups: [...local, ...remote] as never,
    hud: createGpuiSidebarHudState({ runtimeSettings }) as never,
    pinnedPrompts: [],
    previousSessions: [],
  } as never);
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 3; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** The shipped path for one command: what it reached. */
async function runTypeScript(rust: Json, entry: Json): Promise<Json[]> {
  resetBrowserStorage();
  hydrate(rust, entry.savedRemoteMachines ?? undefined);
  const runtime = createGpuiSidebarRuntime();
  const inbound: Json[] = [];
  const source = runtime.messageSource as Json;
  const originalPost = source.postMessage?.bind(source);
  source.postMessage = (message: Json) => {
    inbound.push(message);
    originalPost?.(message);
  };
  const dispose = connectNativeSidebar(runtime);
  await settle();
  edges.length = 0;
  const before = storageEntries();
  ((globalThis as Json).window as Json).ghostexGpui.onNativeSidebarCommand(clone(entry.command));
  await settle();
  const reached = [...edges.map((edge) => ({ ...edge })), ...storageChanges(before)];
  for (const message of inbound) reached.push({ edge: 'inboundSidebarMessage', type: message?.type });
  dispose();
  return reached;
}

/** The Rust plan's ends, driven: one list of edges in the same vocabulary. */
async function runRust(rust: Json, entry: Json, calls: Json[]): Promise<Json[]> {
  const out: Json[] = [];
  for (const call of calls) {
    if (call.call === 'openAppModal') out.push({ edge: 'webkit.ghostexAppModalHost', message: clone(call.payload) });
    else if (call.call === 'closeAppModal')
      out.push({ edge: 'webkit.ghostexAppModalHost', message: { type: 'close' } });
    else if (call.call === 'updateSettingsPatch')
      out.push({ edge: 'updateSettingsPatch', message: clone(call.message) });
    else if (call.call === 'sidebarHostMessage' || call.call === 'handleSidebarMessage') {
      resetBrowserStorage();
      hydrate(rust, entry.savedRemoteMachines ?? undefined);
      const runtime = new GpuiSidebarRuntime() as Json;
      runtime.installGpuiBridgeCallbacks();
      await settle();
      edges.length = 0;
      const before = storageEntries();
      const window = (globalThis as Json).window as Json;
      if (call.call === 'sidebarHostMessage') window.ghostexGpui.onSidebarHostMessage(clone(call.message));
      else void runtime.handleSidebarMessage(clone(call.message));
      await settle();
      out.push(...edges.map((edge) => ({ ...edge })), ...storageChanges(before));
    } else out.push({ edge: `unknown:${String(call.call)}` });
  }
  return out;
}

/** The TypeScript's settings patch reaches the app as a `sidebarCommand`; its end reads `message`. */
function normalizeTheirs(theirs: Json[], counters: Json): Json[] {
  return theirs
    .filter((edge) => edge.edge !== 'handleSidebarMessage' || edge.message?.type !== 'updateSettingsPatch')
    .map((edge) => {
      if (edge.edge === 'webkit.ghostexAppModalHost' && edge.message?.type === 'sidebarCommand') {
        const message = { ...(edge.message.message as Json) };
        if ('baseRevision' in message) counters.baseRevisionDropped += 1;
        delete message.baseRevision;
        return { edge: 'updateSettingsPatch', message };
      }
      return edge;
    });
}

function mutate(name: string | undefined, entry: Json): Json {
  const copy = clone(entry);
  const calls = (copy.calls ?? []) as Json[];
  const open = calls.find((call) => call.call === 'openAppModal')?.payload as Json | undefined;
  const host = calls.find((call) => call.call === 'sidebarHostMessage') as Json | undefined;
  const patch = calls.find((call) => call.call === 'updateSettingsPatch') as Json | undefined;
  switch (name) {
    case 'delayed-send-closes-first':
      if (copy.kind === 'delayedSend' && copy.owned) copy.calls = [{ call: 'closeAppModal' }, ...calls];
      break;
    case 'drop-specific-agent':
      if (open) delete open.sendWhenSpecificAgentFinishes;
      break;
    case 'drop-close-after-done':
      if (open && 'closeAfterDoneActive' in open) open.closeAfterDoneActive = false;
      break;
    case 'null-agent-icon':
      if (open?.modal === 'delayedSend' && !('agentIcon' in open)) open.agentIcon = null;
      break;
    case 'refuse-delayed-send':
      if (copy.kind === 'delayedSend') {
        copy.owned = false;
        copy.calls = null;
      }
      break;
    case 'run-through-post':
      if (host) host.call = 'handleSidebarMessage';
      break;
    case 'configure-launches':
      if (open?.modal === 'configureAgents')
        copy.calls = [
          {
            call: 'sidebarHostMessage',
            message: { type: 'runSidebarAgent', groupId: copy.command.groupId, agentId: '' },
          },
        ];
      break;
    case 'account-id-null':
      if (host && !('accountId' in host.message)) host.message.accountId = null;
      break;
    case 'launch-on-a-missing-group':
      if (copy.kind === 'agent' && copy.owned && !calls.length && copy.command.agentId)
        copy.calls = [
          {
            call: 'sidebarHostMessage',
            message: { type: 'runSidebarAgent', groupId: copy.command.groupId, agentId: copy.command.agentId },
          },
        ];
      break;
    case 'raw-machine-list':
      if (patch && Array.isArray(copy.savedRemoteMachines))
        patch.message.patch.remoteMachines = copy.savedRemoteMachines;
      break;
    case 'hide-every-machine':
      if (patch) for (const machine of patch.message.patch.remoteMachines as Json[]) machine.disabled = true;
      break;
  }
  return copy;
}

/** Key order must not decide a difference. */
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

async function compare(args: string[]): Promise<void> {
  const outDir = args[0];
  const at = args.indexOf('--inject');
  const mutationName = at >= 0 ? args[at + 1] : undefined;
  if (!outDir || (mutationName !== undefined && !MUTATIONS.has(mutationName))) {
    console.error(`usage: state-action-parity.ts compare <out-dir> [--inject <${[...MUTATIONS].join('|')}>]`);
    process.exitCode = 2;
    return;
  }
  const rust = JSON.parse(readFileSync(join(outDir, 'state-action-rust.json'), 'utf8')) as Json;
  installRecorders();
  const differences: string[] = [];
  const counters: Record<string, number> = {
    entries: 0,
    handOffs: 0,
    delayedSends: 0,
    delayedSendDaemonLeg: 0,
    delayedSendHostLeg: 0,
    specificAgent: 0,
    closeAfterDoneArmed: 0,
    missingAgentIcon: 0,
    remoteRows: 0,
    agentRuns: 0,
    agentAccounts: 0,
    configureAgents: 0,
    agentNothing: 0,
    primaryAgentWrites: 0,
    machinePatches: 0,
    machinesDropped: 0,
    machinesRenumbered: 0,
    machinesHidden: 0,
    baseRevisionDropped: 0,
  };
  for (const [index, raw] of ((rust.entries ?? []) as Json[]).entries()) {
    counters.entries += 1;
    const entry = mutate(mutationName, raw);
    const where = `#${index} ${String(entry.kind)} tab=${String(entry.tab)} ${JSON.stringify(entry.command)}`;
    const theirs = normalizeTheirs(await runTypeScript(rust, entry), counters);
    if (entry.owned !== true) {
      // A hand-off: the command reaches the page, which answers it as it always did. The only
      // ones that may be handed off are Configure (the open family's) and a row no list draws.
      counters.handOffs += 1;
      const expected =
        (entry.kind === 'machine' && entry.command.action === 'configure') ||
        (entry.kind === 'delayedSend' && String(entry.command.sessionId).includes(':P9:'));
      if (!expected) differences.push(`${where}: the store handed off a command it owns`);
      continue;
    }
    const mine = await runRust(rust, entry, (entry.calls ?? []) as Json[]);
    if (canonical(mine) !== canonical(theirs))
      differences.push(`${where}:\n    rust ${canonical(mine)}\n    ts   ${canonical(theirs)}`);

    // Coverage, read off the TypeScript's side so a scenario that stopped reaching a shape shows.
    const open = theirs.find((edge) => edge.edge === 'webkit.ghostexAppModalHost')?.message as Json | undefined;
    if (entry.kind === 'delayedSend' && open?.modal === 'delayedSend') {
      counters.delayedSends += 1;
      if (open.sendWhenSpecificAgentFinishes) counters.specificAgent += 1;
      if (open.closeAfterDoneActive === true) counters.closeAfterDoneArmed += 1;
      if (!('agentIcon' in open)) counters.missingAgentIcon += 1;
      if (String(open.sessionId).startsWith('remote:')) counters.remoteRows += 1;
      const hostTimer = (rust.hostDelayedSends as Json)[String(open.sessionId)];
      if (
        open.delayedSendRemainingLabel !== undefined ||
        open.sendWhenAgentStopsActive ||
        open.sendWhenAllProjectSessionsStopActive
      )
        counters[
          hostTimer && hostTimer.remainingLabel === open.delayedSendRemainingLabel
            ? 'delayedSendHostLeg'
            : 'delayedSendDaemonLeg'
        ] += 1;
    }
    if (entry.kind === 'agent') {
      const launches = theirs.filter((edge) => edge.edge === 'requestAgentSessionLaunch');
      if (launches.length) counters.agentRuns += 1;
      if (launches.some((edge) => edge.accountId !== '(none)')) counters.agentAccounts += 1;
      if (open?.modal === 'configureAgents') counters.configureAgents += 1;
      if (!theirs.length) counters.agentNothing += 1;
      if (theirs.some((edge) => edge.edge === 'storage' && edge.value === entry.command.agentId))
        counters.primaryAgentWrites += 1;
    }
    if (entry.kind === 'machine') {
      const patch = theirs.find((edge) => edge.edge === 'updateSettingsPatch')?.message?.patch as Json | undefined;
      if (patch) {
        counters.machinePatches += 1;
        const savedList = Array.isArray(entry.savedRemoteMachines) ? (entry.savedRemoteMachines as unknown[]) : [];
        const list = (patch.remoteMachines ?? []) as Json[];
        if (list.length < savedList.length) counters.machinesDropped += 1;
        const savedIds = new Set(savedList.map((machine) => (machine as Json)?.id));
        if (list.some((machine) => !savedIds.has(machine.id))) counters.machinesRenumbered += 1;
        if (list.some((machine) => machine.id === entry.command.machineId && machine.disabled === true))
          counters.machinesHidden += 1;
      }
    }
  }
  console.log(
    `${Object.entries(counters)
      .map(([label, count]) => `${label} ${count}`)
      .join(' ')} differences ${differences.length}${mutationName ? ` (injected ${mutationName})` : ''}`
  );
  for (const difference of differences.slice(0, 12)) console.log(`  ${difference}`);
  if (differences.length > 12) console.log(`  ... and ${differences.length - 12} more`);
  const collapsed = Object.entries(counters).filter(([, count]) => count === 0);
  if (mutationName) {
    const noticed = differences.length > 0 || collapsed.length > 0;
    process.exitCode = noticed ? 0 : 1;
    if (!noticed)
      console.log(`  the injected mutation ${mutationName} produced NO difference and collapsed no counter`);
    else if (collapsed.length) console.log(`  collapsed: ${collapsed.map(([label]) => label).join(', ')}`);
    return;
  }
  if (collapsed.length) {
    console.log(`  ${collapsed.map(([label]) => label).join(', ')} counted nothing, so the gate is not measuring`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = differences.length ? 1 : 0;
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'compare') await compare(rest);
else {
  console.error('usage: state-action-parity.ts compare <out-dir> [--inject <mutation>]');
  process.exitCode = 2;
}
