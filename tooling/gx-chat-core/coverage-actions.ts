/**
 * The core's user-action inventory, read from the source of truth rather than restated.
 *
 * `ActionKind` in `packages/gx-chat-core/src/action.rs` is the one list of gestures the core
 * knows; `coverage.ts` reports which of them no recording reaches, and `synthetic-hostile.ts`
 * sends every one of them with nothing and then with parameters of the wrong type. Both read it
 * from here so a new gesture is covered by both the moment it is added.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');

/** The wire spellings inside the crate's `action_kinds!` table, in declaration order. */
export function actionKinds(): string[] {
  const source = readFileSync(join(ROOT, 'packages/gx-chat-core/src/action.rs'), 'utf8');
  const start = source.indexOf('action_kinds! {');
  if (start < 0) return [];
  const body = source.slice(start, source.indexOf('\n}', start));
  return [...body.matchAll(/=>\s*"([^"]+)"/g)].map((match) => match[1]!);
}

export const ACTION_KINDS: readonly string[] = actionKinds();
