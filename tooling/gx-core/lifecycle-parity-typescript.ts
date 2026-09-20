/**
 * The TypeScript half of the lifecycle transition gate: drives the shipped
 * `GpuiSidebarRuntime.setSessionSleeping` through all three daemon answers, and then through all
 * three echoes, and returns what it called and what it left behind.
 *
 * Nothing is reimplemented. `setSessionSleeping`, `gxserverSleepWasDeclined`,
 * `resolveLocalProjectListTransitionFocusTarget`, `localProjectTransitionSessionIds`,
 * `isRunningLocalPresentationSession`, `patchPresentationSession` and
 * `focusMovedElsewhereDuringWake` all run as they ship. Three seams are replaced, and each one is
 * an edge rather than a decision:
 *
 * - `client.rpc` is the daemon. It records the call and returns the answer the case is about.
 * - `focusLocalWorkspaceSession` is the workspace bridge. It records which session was selected,
 *   which is exactly what `LifecycleFollowUp::Focus` carries.
 * - `publishPresentation` is the redraw.
 *
 * The echo is applied with the shipped reducer `reduceGxserverPresentationDelta`, which is what
 * `applyPresentationDelta` uses to decide the resulting row; the bookkeeping that wraps it there
 * (domain projects, attention guards, completion sounds) never touches `lifecycleState`.
 */
// First, so the client-storage adapter finds a `Storage` before any module reads one.
import { resetBrowserStorage } from './browser-shim';
import { reduceGxserverPresentationDelta } from '@/packages/shared/gxserver-presentation-cache';
import { createGxserverPresentationSidebarSessionKey } from '@/packages/shared/gxserver-presentation-sidebar-projection';
import { GpuiSidebarRuntime } from '@/apps/desktop/sidebar/gxserver-runtime/core';
import { buildLatestGroups } from './action-parity-typescript';

type Json = Record<string, any>;

/** What one starting state produced, in the shape the Rust dump is written in. */
export type LifecycleRun = {
  owned: true;
  rpc: { path: string; params: Json } | null;
  answers: Record<string, Json>;
  echo: Record<string, string | null>;
};

const SIDEBAR_SESSION_PREFIX = 'combined-session:';

function parseSidebarSessionId(id: string): { projectId: string; sessionId: string } | undefined {
  if (!id.startsWith(SIDEBAR_SESSION_PREFIX)) return undefined;
  const [projectId, sessionId] = id.slice(SIDEBAR_SESSION_PREFIX.length).split(':');
  if (!projectId || !sessionId) return undefined;
  return { projectId: decodeURIComponent(projectId), sessionId: decodeURIComponent(sessionId) };
}

function lifecycleOf(presentation: Json, projectId: string, sessionId: string): string | null {
  const row = (presentation?.sessions ?? []).find(
    (candidate: Json) => candidate.projectId === projectId && candidate.sessionId === sessionId
  );
  return row ? String(row.lifecycleState) : null;
}

/**
 * Runs one entry of the Rust dump's `lifecycle` list and returns the same four answers.
 *
 * `focus` names the starting focus the same way the Rust side does, and `elsewhereSessionId` is
 * the row `other` means, so both sides start from the identical state rather than from two
 * independently chosen rows.
 */
async function runOne(
  scenario: Json,
  entry: Json,
  latestGroups: unknown[],
  elsewhere: { projectId: string; sessionId: string } | undefined,
  answer: 'accepted' | 'declined' | 'failed'
): Promise<{ rpc: Json | null; focuses: Json[]; presentation: Json }> {
  const reference = parseSidebarSessionId(String(entry.sessionId));
  const runtime = Object.create(GpuiSidebarRuntime.prototype) as Json;
  runtime.browserTabs = [];
  runtime.latestGroups = latestGroups;
  // Shared, not cloned. `reduceGxserverPresentationDelta` and everything that reaches
  // `this.presentation` here build new objects and never mutate the one they are given, and a
  // deep clone of a recorded snapshot per run made this harness three times slower than the whole
  // rest of the gate put together.
  runtime.presentation = scenario.snapshot;
  runtime.focusedSessionId =
    entry.focus === 'self' || entry.focus === 'movesDuringCall'
      ? reference?.sessionId
      : entry.focus === 'other'
        ? elsewhere?.sessionId
        : undefined;
  const focuses: Json[] = [];
  let rpc: Json | null = null;
  runtime.client = {
    rpc(path: string, params: Json) {
      rpc = { path, params };
      // The user picks another session WHILE the daemon is answering. `setSessionSleeping` read
      // `focusedSessionId` before the await and reads it again after, so moving it here is what
      // really happens, and it is the only way to reach `focusMovedElsewhereDuringWake`.
      if (entry.focus === 'movesDuringCall') runtime.focusedSessionId = elsewhere?.sessionId;
      if (answer === 'failed') return Promise.reject(new Error('transport'));
      // `gxserverSleepWasDeclined` tests the PRESENCE of the field, so a declined answer carries
      // one and an accepted one carries none.
      return Promise.resolve(answer === 'declined' ? { declined: { reason: 'keepAwake' } } : {});
    },
  };
  runtime.focusLocalWorkspaceSession = (projectId: string, sessionId: string) => {
    focuses.push({
      follow: 'focus',
      session: `${SIDEBAR_SESSION_PREFIX}${encodeURIComponent(projectId)}:${encodeURIComponent(sessionId)}`,
    });
  };
  runtime.publishPresentation = () => {};
  await runtime.setSessionSleeping(String(entry.sessionId), entry.sleeping === true).catch(() => undefined);
  return { rpc, focuses, presentation: runtime.presentation };
}

export async function runTypeScriptLifecycle(scenario: Json, rustActions: Json): Promise<LifecycleRun[]> {
  resetBrowserStorage();
  const latestGroups = buildLatestGroups(scenario, undefined) as unknown[];
  const rows = (scenario.snapshot?.sessions ?? []) as Json[];
  const firstProjectId = rows[0] ? String(rows[0].projectId) : undefined;
  const elsewhereRow = [...rows].reverse().find((row) => String(row.projectId) !== firstProjectId) ?? rows.at(-1);
  const elsewhere = elsewhereRow
    ? { projectId: String(elsewhereRow.projectId), sessionId: String(elsewhereRow.sessionId) }
    : undefined;
  const out: LifecycleRun[] = [];
  for (const entry of (rustActions.lifecycle ?? []) as Json[]) {
    if (entry.owned !== true) {
      out.push({ owned: true, rpc: null, answers: {}, echo: {} } as LifecycleRun);
      continue;
    }
    const reference = parseSidebarSessionId(String(entry.sessionId));
    const answers: Record<string, Json> = {};
    let acceptedPresentation: Json | undefined;
    let acceptedRpc: Json | null = null;
    for (const answer of ['accepted', 'declined', 'failed'] as const) {
      const run = await runOne(scenario, entry, latestGroups, elsewhere, answer);
      answers[answer] = {
        state: reference ? lifecycleOf(run.presentation, reference.projectId, reference.sessionId) : null,
        focus: run.focuses,
      };
      if (answer === 'accepted') {
        acceptedPresentation = run.presentation;
        acceptedRpc = run.rpc;
      }
    }
    const echo: Record<string, string | null> = {};
    if (reference && acceptedPresentation) {
      const original = lifecycleOf(scenario.snapshot, reference.projectId, reference.sessionId);
      const row = rows.find(
        (candidate) =>
          String(candidate.projectId) === reference.projectId && String(candidate.sessionId) === reference.sessionId
      );
      if (row && original !== null) {
        // The three echo values are taken from the Rust dump rather than chosen again here, so
        // both sides are answering the same question. The third one is a value neither side
        // predicted, and which one that is depends on the row.
        const states = (entry.echo?.states ?? {}) as Record<string, string>;
        for (const [name, state] of [
          ['agrees', states.agrees],
          ['stillOld', states.stillOld],
          ['movedOn', states.movedOn],
        ] as const) {
          if (!state) continue;
          const echoed = reduceGxserverPresentationDelta(
            acceptedPresentation as any,
            { session: { ...row, lifecycleState: state } as any, type: 'sessionUpdated' } as any,
            Number(acceptedPresentation.revision ?? 0) + 1
          );
          echo[name] = lifecycleOf(echoed as any, reference.projectId, reference.sessionId);
        }
      }
    }
    out.push({ owned: true, rpc: acceptedRpc, answers, echo });
  }
  return out;
}

/**
 * The close half. Drives the shipped `transitionSession(sessionId, 'close')` through the four
 * answers and then through the three things the daemon can say about a row the client has already
 * taken away.
 *
 * `neverAnswered` is the case the original cannot resolve at all: its `rpc` is a bare `fetch` with
 * no timeout and no abort, so the promise `transitionSession` awaits simply never settles. The
 * harness therefore races it against a tick and reads the state at that point, which IS the
 * TypeScript's permanent answer: the row is gone and nothing will ever put it back.
 */
export async function runTypeScriptClose(scenario: Json, rustActions: Json): Promise<Json[]> {
  resetBrowserStorage();
  const latestGroups = buildLatestGroups(scenario, undefined) as unknown[];
  const rows = (scenario.snapshot?.sessions ?? []) as Json[];
  const firstProjectId = rows[0] ? String(rows[0].projectId) : undefined;
  const elsewhereRow = [...rows].reverse().find((row) => String(row.projectId) !== firstProjectId) ?? rows.at(-1);
  const elsewhere = elsewhereRow
    ? { projectId: String(elsewhereRow.projectId), sessionId: String(elsewhereRow.sessionId) }
    : undefined;
  const out: Json[] = [];
  for (const entry of (rustActions.close ?? []) as Json[]) {
    if (entry.owned !== true) {
      out.push({ owned: false });
      continue;
    }
    const reference = parseSidebarSessionId(String(entry.sessionId));
    const answers: Json = {};
    let acceptedRuntime: Json | undefined;
    let rpc: Json | null = null;
    let optimisticFocus: Json[] = [];
    let optimisticDrawn = true;
    for (const answer of ['accepted', 'failed', 'neverAnswered'] as const) {
      const runtime = Object.create(GpuiSidebarRuntime.prototype) as Json;
      runtime.browserTabs = [];
      runtime.latestGroups = latestGroups;
      runtime.presentation = scenario.snapshot;
      runtime.localFirstHiddenPresentationSessionKeys = new Set<string>();
      runtime.focusedSessionId =
        entry.focus === 'self' ? reference?.sessionId : entry.focus === 'other' ? elsewhere?.sessionId : undefined;
      const focuses: Json[] = [];
      runtime.focusLocalWorkspaceSession = (projectId: string, sessionId: string) => {
        focuses.push({
          follow: 'focus',
          session: `${SIDEBAR_SESSION_PREFIX}${encodeURIComponent(projectId)}:${encodeURIComponent(sessionId)}`,
        });
      };
      runtime.publishPresentation = () => {};
      runtime.client = {
        rpc(path: string, params: Json) {
          rpc = { path, params };
          if (answer === 'accepted') return Promise.resolve({ action: 'close', session: {} });
          if (answer === 'failed') return Promise.reject(new Error('transport'));
          return new Promise(() => {});
        },
      };
      // The optimistic half runs synchronously inside `transitionSession` before its await, so the
      // state a tick later is the state for every answer that has not arrived.
      const run = runtime.transitionSession(String(entry.sessionId), 'close');
      await Promise.race([run, new Promise((resolve) => setTimeout(resolve, 0))]);
      if (answer === 'accepted') {
        await run;
        acceptedRuntime = runtime;
        optimisticFocus = focuses;
        optimisticDrawn = closeRowIsDrawn(runtime, reference);
      }
      answers[answer] = { drawn: closeRowIsDrawn(runtime, reference) };
    }
    const echo: Json = {};
    const row = rows.find(
      (candidate) =>
        reference !== undefined &&
        String(candidate.projectId) === reference.projectId &&
        String(candidate.sessionId) === reference.sessionId
    );
    if (acceptedRuntime && reference && row) {
      for (const [name, delta] of [
        ['removed', { projectId: reference.projectId, sessionId: reference.sessionId, type: 'sessionRemoved' }],
        ['stillRunning', { session: { ...row, lifecycleState: 'running' }, type: 'sessionUpdated' }],
        ['stopped', { session: { ...row, lifecycleState: 'stopped' }, type: 'sessionUpdated' }],
      ] as const) {
        const echoed = Object.create(GpuiSidebarRuntime.prototype) as Json;
        echoed.localFirstHiddenPresentationSessionKeys = acceptedRuntime.localFirstHiddenPresentationSessionKeys;
        echoed.presentation = reduceGxserverPresentationDelta(
          acceptedRuntime.presentation as any,
          delta as any,
          Number(acceptedRuntime.presentation.revision ?? 0) + 1
        );
        echo[name] = { drawn: closeRowIsDrawn(echoed, reference) };
      }
    }
    out.push({
      owned: true,
      rpc,
      optimistic: { drawn: optimisticDrawn, focus: optimisticFocus },
      answers,
      echo,
    });
  }
  return out;
}

/**
 * Whether the sidebar would draw the row: `this.presentation` still holds it and the runtime's
 * own local-first hidden set does not name it. Those are the two things
 * `removePresentationSession` changes, and the second is the one nothing ever clears.
 */
function closeRowIsDrawn(runtime: Json, reference: { projectId: string; sessionId: string } | undefined): boolean {
  if (!reference) return false;
  const present = ((runtime.presentation?.sessions ?? []) as Json[]).some(
    (session) => session.projectId === reference.projectId && session.sessionId === reference.sessionId
  );
  // The shipped key builder, not a hand-rolled one: it joins with a NUL, and guessing a colon
  // here would have made every hidden row read as drawn and the whole close gate as passing.
  const hidden = (runtime.localFirstHiddenPresentationSessionKeys as Set<string> | undefined)?.has(
    createGxserverPresentationSidebarSessionKey(reference.projectId, reference.sessionId)
  );
  return present && !hidden;
}
