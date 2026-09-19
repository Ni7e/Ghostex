import type { NativeSidebarPatch, NativeSidebarSnapshot } from '@/packages/shared/native-sidebar';

function equal(left: unknown, right: unknown): boolean {
  if (left === right || (left == null && right == null)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => equal(value, right[index]))
    );
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  return (
    Object.keys(a).every((key) => equal(a[key], b[key])) && Object.keys(b).every((key) => key in a || b[key] == null)
  );
}

function changedFields(current: object, previous?: object, omit: string[] = []): Record<string, unknown> {
  const next = current as Record<string, unknown>;
  const old = (previous ?? {}) as Record<string, unknown>;
  const changes: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(next), ...Object.keys(old)])) {
    if (!previous && next[key] === undefined) continue;
    if (!omit.includes(key) && (!previous || !equal(next[key], old[key]))) changes[key] = next[key] ?? null;
  }
  return changes;
}

/**
 * CDXC:Sidebar 2026-09-17 WHY:
 * Selection and activity updates must not repeatedly serialize every session, icon and settings value.
 * The ordered bridge starts with one snapshot, then sends field changes and explicit membership order.
 * SEE-ALSO: apps/desktop/src/app/native_sidebar/updates.rs.
 */
export function createNativeSidebarPublisher(post: (payload: string) => void) {
  let previous: NativeSidebarSnapshot | undefined;
  return {
    get snapshot() {
      return previous;
    },
    publish(next: NativeSidebarSnapshot) {
      if (!previous) {
        const payload = JSON.stringify(next);
        post(payload);
        previous = next;
        return {
          kind: 'snapshot',
          characters: payload.length,
          changedSessions: next.groups.reduce((count, group) => count + group.sessions.length, 0),
        };
      }
      const oldGroups = new Map(previous.groups.map((group) => [group.groupId, group]));
      const groups: NativeSidebarPatch['groups'] = [];
      for (const group of next.groups) {
        const old = oldGroups.get(group.groupId);
        const fields = changedFields(group, old, ['sessions']);
        const oldSessions = new Map(old?.sessions.map((session) => [session.sessionId, session]));
        const sessions = group.sessions.flatMap((session) => {
          const old = oldSessions.get(session.sessionId);
          // The projection reuses the object of an untouched row; nothing in it can differ.
          if (old === session) return [];
          const fields = changedFields(session, old);
          return Object.keys(fields).length ? [{ sessionId: session.sessionId, fields }] : [];
        });
        const order = group.sessions.map((session) => session.sessionId);
        const sessionOrder = equal(
          order,
          old?.sessions.map((session) => session.sessionId)
        )
          ? undefined
          : order;
        if (Object.keys(fields).length || sessions.length || sessionOrder)
          groups.push({ groupId: group.groupId, fields, sessions, sessionOrder });
      }
      const order = next.groups.map((group) => group.groupId);
      const groupOrder = equal(
        order,
        previous.groups.map((group) => group.groupId)
      )
        ? undefined
        : order;
      const fields = changedFields(next, previous, ['kind', 'version', 'groups', 'hud']);
      const hud = changedFields(next.hud, previous.hud);
      if (Object.keys(fields).length || Object.keys(hud).length || groups.length || groupOrder) {
        const patch: NativeSidebarPatch = { kind: 'patch', version: 1, fields, groups, groupOrder, hud };
        const payload = JSON.stringify(patch);
        post(payload);
        previous = next;
        return {
          kind: 'patch',
          characters: payload.length,
          changedSessions: groups.reduce((count, group) => count + group.sessions.length, 0),
        };
      }
      previous = next;
    },
  };
}
