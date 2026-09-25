/**
 * The app runtime port's meter (docs/2026-09-25/app-runtime-port/PLAN.md, step 0 item 5).
 *
 * Reads the `native.runtime.trace` log (gpui-runtime-trace.jsonl) and counts what still reaches the
 * old QuickJS runtime, per ledger row and family:
 *   runtime.entry  a script or command Rust sent into the runtime (named like `onWorkspaceTerminalBell`
 *                  or `onSidebarCommand:createSession`)
 *   runtime.post   a bridge post / nativeHost / modalHost message the runtime sent to Rust
 *   runtime.rpc    a gxserver call the runtime made
 *   gxRpc.rpc      a gxserver call a Rust executor made through gx_rpc (not counted against the meter)
 *
 * Usage:
 *   bun tooling/app-runtime-port/trace-meter.ts [log] [--family F3] [--rpc] [--sequence] [--expect-zero]
 *
 *   log            default: $GHOSTEX logs dir /gpui-runtime-trace.jsonl (~/.local/state/ghostex/logs)
 *   --family F3    only rows of that family (unmatched names are listed under "(no ledger row)")
 *   --rpc          also list runtime.rpc and gxRpc.rpc endpoints with their parameter names
 *   --sequence     print every line in order (endpoint + params), to diff old build against new
 *   --expect-zero  exit 1 when any runtime.entry / runtime.post for the selected rows was seen
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

type Line = { event: string; details: Record<string, unknown> };
type Row = { id: string; family: string; tokens: string[] };

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const family = option('--family');
const logPath =
  args.find((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--family') ??
  `${process.env.XDG_STATE_HOME ?? `${homedir()}/.local/state`}/ghostex/logs/gpui-runtime-trace.jsonl`;

const root = fileURLToPath(new URL('../../', import.meta.url));
const ledgerPath = `${root}docs/2026-09-25/app-runtime-port/LEDGER.md`;

/** Every ledger table row: its id, family, and the names in its Entry point cell. */
function readLedger(): Row[] {
  if (!existsSync(ledgerPath)) return [];
  const rows: Row[] = [];
  let columns: string[] = [];
  for (const line of readFileSync(ledgerPath, 'utf8').split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells[0] === 'ID') {
      columns = cells;
      continue;
    }
    if (!/^[A-Z]+\d+/.test(cells[0] ?? '')) continue;
    const entry = cells[columns.indexOf('Entry point')] ?? '';
    const ticked = [...entry.matchAll(/`([^`]+)`/g)].map(([, name]) => name);
    const tokens = (ticked.length ? ticked : [entry])
      .flatMap((text) => text.split(/[^A-Za-z0-9_.:-]+/))
      .flatMap((token) => [token, token.split('.').pop() ?? token])
      .filter(Boolean);
    rows.push({ id: cells[0], family: cells[columns.indexOf('Family')] ?? '?', tokens });
  }
  return rows;
}

function readLog(): Line[] {
  if (!existsSync(logPath)) {
    console.error(
      `No trace log at ${logPath}. Turn on "Show debug UI controls" and the "App runtime port trace" scenario.`
    );
    process.exit(2);
  }
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .flatMap((line) => {
      const json = line.slice(line.indexOf('{'));
      try {
        return [JSON.parse(json) as Line];
      } catch {
        return [];
      }
    });
}

const ledger = readLedger();
const lines = readLog();

/**
 * The ledger row a trace name belongs to: the full name, then the message type after `:` (an H row
 * for `handleSidebarMessage:createSession`), then the door before it (a C or R row for
 * `onWorktreeModalCommand:confirmDeleteWorktree`).
 */
function rowFor(name: string): Row | undefined {
  const candidates = [name, name.split(':').pop() ?? name, name.split(':')[0]];
  for (const candidate of candidates) {
    const row = ledger.find((entry) => entry.tokens.includes(candidate));
    if (row) return row;
  }
  return undefined;
}

const counts = new Map<string, { row?: Row; count: number }>();
const rpcs = new Map<string, number>();
for (const { event, details } of lines) {
  if (event === 'runtime.entry' || event === 'runtime.post') {
    const name = event === 'runtime.post' ? `${details.kind}:${details.name}` : String(details.name);
    const row = rowFor(event === 'runtime.post' ? String(details.name) : name);
    if (family && row?.family !== family && !(row === undefined && family === '?')) continue;
    const key = `${event} ${name}`;
    const held = counts.get(key) ?? { row, count: 0 };
    held.count++;
    counts.set(key, held);
  } else if (flag('--rpc') && (event === 'runtime.rpc' || event === 'gxRpc.rpc')) {
    const key = `${event} ${details.endpoint}(${(details.params as string[] | undefined)?.join(', ') ?? ''})`;
    rpcs.set(key, (rpcs.get(key) ?? 0) + 1);
  }
  if (flag('--sequence') && event.includes('rpc')) {
    console.log(`${event}\t${details.endpoint}\t${(details.params as string[] | undefined)?.join(',') ?? ''}`);
  }
}

const byFamily = new Map<string, number>();
const sorted = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
for (const [key, { row, count }] of sorted) {
  const label = row ? `${row.id} ${row.family}` : '(no ledger row)';
  byFamily.set(row?.family ?? '?', (byFamily.get(row?.family ?? '?') ?? 0) + count);
  console.log(`${String(count).padStart(6)}  ${label.padEnd(16)} ${key}`);
}
for (const [key, count] of [...rpcs.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(count).padStart(6)}  ${key}`);
}
const total = [...counts.values()].reduce((sum, { count }) => sum + count, 0);
console.log(
  `\nStill reaching the runtime${family ? ` (${family})` : ''}: ${total} line(s) from ${lines.length} traced.` +
    (byFamily.size
      ? ` By family: ${[...byFamily.entries()].map(([name, count]) => `${name} ${count}`).join(', ')}.`
      : '')
);
process.exit(flag('--expect-zero') && total > 0 ? 1 : 0);
