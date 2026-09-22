#!/usr/bin/env bun
//
// Every field of the chat core's state, and every place that writes it.
//
//   bun tooling/gx-chat-core/state-audit.ts            # the report
//   bun tooling/gx-chat-core/state-audit.ts --all      # every field, not only the suspicious ones
//   bun tooling/gx-chat-core/state-audit.ts --json     # machine readable
//   bun tooling/gx-chat-core/state-audit.ts --roots    # only the structs declared in src/state/
//
// Why this exists: the expensive bug in this port is a field with no writer. The TypeScript keeps
// a piece of state and updates it; the Rust port declares the field, reads it everywhere, and
// never assigns it. Every replay gate stays green, because a recording only grades what some other
// rule already reaches, and a whole surface draws wrong. Five of them were found by hand
// (`state.extras.minimap`, `OptionStore::take_dirty`, `PickersState::model_menu_context`,
// `TranscriptViewState::working_directory`, `ComposerChromeState`'s refresh). This finds them in
// two seconds instead.
//
// What it does NOT do: it is a text search, not a borrow checker. A field name shared by two
// structs pools their writers, so a non-zero count is weaker evidence than a zero count. Zero is
// the signal worth acting on; `constructor-only` and `example-only` are worth reading.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const crate = join(root, 'packages/gx-chat-core');

const args = new Set(process.argv.slice(2));
const showAll = args.has('--all');
const asJson = args.has('--json');
const rootsOnly = args.has('--roots');

// ---------------------------------------------------------------------------
// 1. Read the crate, with comments and string contents blanked out.
//
// Blanking rather than deleting keeps every byte offset and every line number, so a hit found in
// the cleaned text can be reported against the real file.
// ---------------------------------------------------------------------------

type Source = { path: string; label: string; text: string; clean: string; lineStarts: number[] };

function listRustFiles(directory: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (entry === 'target' || entry === 'node_modules') continue;
        walk(full);
      } else if (entry.endsWith('.rs')) {
        found.push(full);
      }
    }
  };
  walk(directory);
  return found.sort();
}

/** Comments and the insides of string and char literals, replaced by spaces of the same width. */
function blankComments(text: string): string {
  const out = text.split('');
  let index = 0;
  const blankTo = (from: number, to: number) => {
    for (let at = from; at < to && at < out.length; at += 1) {
      if (out[at] !== '\n') out[at] = ' ';
    }
  };
  while (index < text.length) {
    const here = text[index];
    const next = text[index + 1];
    if (here === '/' && next === '/') {
      let end = text.indexOf('\n', index);
      if (end === -1) end = text.length;
      blankTo(index, end);
      index = end;
      continue;
    }
    if (here === '/' && next === '*') {
      let end = text.indexOf('*/', index + 2);
      end = end === -1 ? text.length : end + 2;
      blankTo(index, end);
      index = end;
      continue;
    }
    if (here === 'r' && (next === '"' || next === '#')) {
      // r"..." or r#"..."# with any number of hashes.
      let hashes = 0;
      let at = index + 1;
      while (text[at] === '#') {
        hashes += 1;
        at += 1;
      }
      if (text[at] === '"') {
        const terminator = '"' + '#'.repeat(hashes);
        let end = text.indexOf(terminator, at + 1);
        end = end === -1 ? text.length : end + terminator.length;
        blankTo(at + 1, end - terminator.length);
        index = end;
        continue;
      }
    }
    if (here === '"') {
      let at = index + 1;
      while (at < text.length) {
        if (text[at] === '\\') {
          at += 2;
          continue;
        }
        if (text[at] === '"') break;
        at += 1;
      }
      blankTo(index + 1, at);
      index = at + 1;
      continue;
    }
    if (here === "'") {
      // A char literal, or a lifetime. `'a'` and `'\n'` are literals; `'a` is a lifetime.
      if (next === '\\') {
        let at = index + 2;
        while (at < text.length && text[at] !== "'") at += 1;
        blankTo(index + 1, at);
        index = at + 1;
        continue;
      }
      if (text[index + 2] === "'") {
        blankTo(index + 1, index + 2);
        index = index + 3;
        continue;
      }
      index += 1;
      continue;
    }
    index += 1;
  }
  return out.join('');
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === '\n') starts.push(at + 1);
  }
  return starts;
}

function lineOf(source: Source, offset: number): number {
  let low = 0;
  let high = source.lineStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (source.lineStarts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

const sources: Source[] = [];
for (const directory of [join(crate, 'src'), join(crate, 'examples')]) {
  for (const path of listRustFiles(directory)) {
    const text = readFileSync(path, 'utf8');
    sources.push({
      path,
      label: relative(root, path),
      text,
      clean: blankComments(text),
      lineStarts: lineStartsOf(text),
    });
  }
}

// ---------------------------------------------------------------------------
// 2. Block ranges: every `impl` and every `struct`, found by brace matching.
// ---------------------------------------------------------------------------

/** The offset of the `}` that closes the `{` at `open`, or the end of the text. */
function matchBrace(clean: string, open: number): number {
  let depth = 0;
  for (let at = open; at < clean.length; at += 1) {
    if (clean[at] === '{') depth += 1;
    else if (clean[at] === '}') {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return clean.length;
}

type ImplBlock = { source: Source; trait: string | null; target: string; start: number; end: number };

const implBlocks: ImplBlock[] = [];
for (const source of sources) {
  const pattern = /\bimpl\b(?:\s*<[^{>]*>)?\s*([^{;]*?)\{/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source.clean)) !== null) {
    const header = match[1].replace(/\bwhere\b[\s\S]*$/, '').trim();
    const forSplit = header.split(/\bfor\b/);
    const targetText = forSplit.length > 1 ? forSplit.slice(1).join(' for ') : forSplit[0];
    const traitText = forSplit.length > 1 ? forSplit[0] : null;
    const target = (targetText.match(/([A-Za-z_][\w]*)/) || [])[1];
    if (!target) continue;
    const open = match.index + match[0].length - 1;
    implBlocks.push({
      source,
      trait: traitText ? ((traitText.match(/([A-Za-z_][\w]*)/) || [])[1] ?? null) : null,
      target,
      start: open,
      end: matchBrace(source.clean, open),
    });
  }
}

function implAt(source: Source, offset: number): ImplBlock | null {
  let best: ImplBlock | null = null;
  for (const block of implBlocks) {
    if (block.source !== source) continue;
    if (offset < block.start || offset > block.end) continue;
    if (!best || block.start > best.start) best = block;
  }
  return best;
}

// ---------------------------------------------------------------------------
// 3. The structs and their fields.
// ---------------------------------------------------------------------------

type Field = { name: string; type: string; line: number };
type Struct = {
  name: string;
  source: Source;
  line: number;
  fields: Field[];
  isState: boolean;
  start: number;
  end: number;
  /** `#[derive(Deserialize)]`: serde fills every field, so a textual writer is not required. */
  deserialize: boolean;
};

const structs = new Map<string, Struct>();
const duplicateNames = new Set<string>();

for (const source of sources) {
  const pattern =
    /(?:^|\n)\s*(?:pub(?:\s*\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)(?:\s*<[^>]*>)?\s*(?:where[\s\S]*?)?\{/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source.clean)) !== null) {
    const name = match[1];
    const open = match.index + match[0].length - 1;
    const end = matchBrace(source.clean, open);
    const body = source.clean.substring(open + 1, end);
    const fields: Field[] = [];
    let depth = 0;
    let fieldStart = 0;
    const pushField = (from: number, to: number) => {
      const raw = body.substring(from, to);
      const cleaned = raw.replace(/#\[[\s\S]*?\]/g, ' ').trim();
      const fieldMatch = cleaned.match(/^(?:pub(?:\s*\([^)]*\))?\s+)?([a-z_]\w*)\s*:\s*([\s\S]+)$/);
      if (!fieldMatch) return;
      fields.push({
        name: fieldMatch[1],
        type: fieldMatch[2].replace(/\s+/g, ' ').trim(),
        line: lineOf(source, open + 1 + from + raw.search(/\S/)),
      });
    };
    for (let at = 0; at < body.length; at += 1) {
      const here = body[at];
      if (here === '{' || here === '(' || here === '[' || here === '<') depth += 1;
      else if (here === '}' || here === ')' || here === ']' || here === '>') depth -= 1;
      else if (here === ',' && depth === 0) {
        pushField(fieldStart, at);
        fieldStart = at + 1;
      }
    }
    pushField(fieldStart, body.length);
    if (structs.has(name)) duplicateNames.add(name);
    const attributes = source.clean.substring(Math.max(0, match.index - 400), match.index);
    structs.set(name, {
      name,
      source,
      line: lineOf(source, match.index + match[0].indexOf('struct')),
      fields,
      isState: source.label.includes('/src/state/'),
      start: open,
      end,
      deserialize: /derive\s*\([^)]*\bDeserialize\b/.test(attributes.split('\n').slice(-12).join('\n')),
    });
  }
}

// ---------------------------------------------------------------------------
// 4. Which structs are audited: the ones in `src/state/`, plus everything they reach.
// ---------------------------------------------------------------------------

const audited = new Set<string>();
const reachedFrom = new Map<string, string>();
const queue: string[] = [];
for (const [name, struct] of structs) {
  if (struct.isState) {
    audited.add(name);
    queue.push(name);
  }
}
if (!rootsOnly) {
  while (queue.length > 0) {
    const name = queue.shift()!;
    const struct = structs.get(name);
    if (!struct) continue;
    for (const field of struct.fields) {
      for (const referenced of field.type.match(/[A-Za-z_]\w*/g) ?? []) {
        if (!structs.has(referenced) || audited.has(referenced)) continue;
        audited.add(referenced);
        reachedFrom.set(referenced, `${name}::${field.name}`);
        queue.push(referenced);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4b. Which methods of an audited struct anybody actually calls.
//
// A field whose only writer sits in a method nobody calls is exactly as dead as a field with no
// writer at all. `ComposerHistory::entries` was found that way: its `push` is the only writer and
// nothing in the crate calls it, so up-arrow recall could never produce a line. A bare name search
// cannot see that, because `push` is also `Vec::push` two hundred times over, so the call site is
// matched through the FIELD PATH that owns the struct (`.history.push(`, `history.push(`,
// `ComposerHistory::push(`) instead.
// ---------------------------------------------------------------------------

/** The offset of the `)` that closes the `(` at `open`. */
function matchParen(clean: string, open: number): number {
  let depth = 0;
  for (let at = open; at < clean.length; at += 1) {
    if (clean[at] === '(') depth += 1;
    else if (clean[at] === ')') {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return clean.length;
}

function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/^_/, '')
    .toLowerCase();
}

/** Every binding name a value of this struct is plausibly reached through. */
const receiversOf = new Map<string, Set<string>>();
for (const [name, struct] of structs) {
  if (!audited.has(name)) continue;
  for (const field of struct.fields) {
    for (const referenced of field.type.match(/[A-Za-z_]\w*/g) ?? []) {
      if (!structs.has(referenced)) continue;
      const set = receiversOf.get(referenced) ?? new Set<string>();
      set.add(field.name);
      receiversOf.set(referenced, set);
    }
  }
}
for (const name of audited) {
  const set = receiversOf.get(name) ?? new Set<string>();
  set.add(snakeCase(name));
  receiversOf.set(name, set);
}

type Method = { struct: string; name: string; source: Source; start: number; end: number };
const methods: Method[] = [];
for (const block of implBlocks) {
  if (block.trait !== null || !audited.has(block.target)) continue;
  const body = block.source.clean.substring(block.start, block.end);
  const pattern = /\bfn\s+([a-z_]\w*)\s*(?:<[^>]*>)?\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const parenOpen = block.start + match.index + match[0].length - 1;
    const parenClose = matchParen(block.source.clean, parenOpen);
    const braceOpen = block.source.clean.indexOf('{', parenClose);
    if (braceOpen === -1) continue;
    methods.push({
      struct: block.target,
      name: match[1],
      source: block.source,
      start: braceOpen,
      end: matchBrace(block.source.clean, braceOpen),
    });
  }
}

function methodAt(source: Source, offset: number): Method | null {
  let best: Method | null = null;
  for (const method of methods) {
    if (method.source !== source) continue;
    if (offset < method.start || offset > method.end) continue;
    if (!best || method.start > best.start) best = method;
  }
  return best;
}

/**
 * Method names the standard library also uses. A call through an unknown local receiver proves
 * nothing for these, because `entries.push(...)` on a `Vec` outnumbers `history.push(...)` on the
 * struct a hundred to one, and counting them hid `ComposerHistory::push`, whose absence of callers
 * is the whole bug.
 */
const AMBIGUOUS_METHODS = new Set([
  'push',
  'push_str',
  'insert',
  'remove',
  'clear',
  'extend',
  'retain',
  'take',
  'replace',
  'pop',
  'sort',
  'truncate',
  'drain',
  'entry',
  'append',
  'dedup',
  'reverse',
  'swap',
  'fill',
  'resize',
  'len',
  'is_empty',
  'get',
  'iter',
  'contains',
  'next',
  'last',
  'first',
  'count',
  'map',
  'filter',
  'as_str',
  'to_string',
  'clone',
  'default',
  'new',
  'push',
  'read',
  'write',
  'update',
  'value',
  'values',
  'keys',
]);

/** Whether this receiver name is some OTHER audited struct's field, and so not ours. */
function ownedElsewhere(struct: string, receiver: string): boolean {
  for (const [name, set] of receiversOf) {
    if (name !== struct && set.has(receiver)) return true;
  }
  return false;
}

type Site = { source: Source; offset: number };
const sitesOf = new Map<string, Site[]>();
for (const method of methods) {
  const key = `${method.struct}::${method.name}`;
  if (sitesOf.has(key)) continue;
  const receivers = receiversOf.get(method.struct) ?? new Set<string>();
  const patterns = [
    new RegExp(`\\b${escape(method.struct)}\\s*::\\s*${escape(method.name)}\\b`, 'g'),
    // Any receiver, filtered below: a value is reached through a local binding
    // (`picker.scroll(...)`) as often as through the field that owns it.
    new RegExp(`\\b([a-z_]\\w*)\\s*\\.\\s*${escape(method.name)}\\b`, 'g'),
  ];
  const sites: Site[] = [];
  for (const source of sources) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source.clean)) !== null) {
        const preceding = source.clean.substring(Math.max(0, match.index - 8), match.index);
        if (/\bfn\s+$/.test(preceding)) continue;
        const receiver = match[1];
        if (receiver !== undefined && !receivers.has(receiver)) {
          if (receiver === 'self') {
            const block = implAt(source, match.index);
            if (block && block.target !== method.struct) continue;
          } else if (ownedElsewhere(method.struct, receiver)) {
            continue;
          } else if (AMBIGUOUS_METHODS.has(method.name)) {
            continue;
          }
        }
        sites.push({ source, offset: match.index });
      }
    }
  }
  sitesOf.set(key, sites);
}

/** A method is reachable when some call site is outside every unreachable method. Fixpoint. */
const unreachable = new Set<string>();
for (let pass = 0; pass < 8; pass += 1) {
  let changed = false;
  for (const method of methods) {
    const key = `${method.struct}::${method.name}`;
    if (unreachable.has(key)) continue;
    const sites = sitesOf.get(key) ?? [];
    const live = sites.some((site) => {
      if (site.source === method.source && site.offset >= method.start && site.offset <= method.end) return false; // its own recursive call proves nothing
      const owner = methodAt(site.source, site.offset);
      return !owner || !unreachable.has(`${owner.struct}::${owner.name}`);
    });
    if (!live) {
      unreachable.add(key);
      changed = true;
    }
  }
  if (!changed) break;
}

/** `Struct::method` when the offset sits in an unreachable method, else null. */
function unreachableOwner(source: Source, offset: number): string | null {
  const owner = methodAt(source, offset);
  if (!owner) return null;
  const key = `${owner.struct}::${owner.name}`;
  return unreachable.has(key) ? key : null;
}

// ---------------------------------------------------------------------------
// 5. The writers.
// ---------------------------------------------------------------------------

type Writer = { label: string; line: number; kind: string; example: boolean; fn: string | null };

/**
 * The name of the `fn` the offset sits in, and how many times that name is called from outside
 * its own body. A field whose only writer is a method nobody calls is exactly as dead as a field
 * with no writer at all: `ComposerHistory::entries` was found that way, its `push` never called,
 * so up-arrow recall could never produce a line.
 */
function enclosingFunction(source: Source, offset: number): string | null {
  const before = source.clean.lastIndexOf('fn ', offset);
  if (before === -1) return null;
  const name = (source.clean.substring(before + 3, before + 80).match(/^\s*([a-z_]\w*)/) || [])[1];
  return name ?? null;
}

const callCounts = new Map<string, number>();
function callsOf(name: string): number {
  const cached = callCounts.get(name);
  if (cached !== undefined) return cached;
  const pattern = new RegExp(`\\b${escape(name)}\\s*(?:::\\s*<[^>]*>\\s*)?\\(`, 'g');
  let total = 0;
  for (const source of sources) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source.clean)) !== null) {
      // The definition itself is `fn name(`; every other occurrence is a call or a reference.
      const preceding = source.clean.substring(Math.max(0, match.index - 8), match.index);
      if (/\bfn\s+$/.test(preceding)) continue;
      total += 1;
    }
  }
  // A method reference handed to `map`/`filter_map` has no parentheses at the call site.
  if (total === 0) {
    const reference = new RegExp(`::\\s*${escape(name)}\\b|\\.\\s*${escape(name)}\\b(?!\\s*\\()`, 'g');
    for (const source of sources) {
      reference.lastIndex = 0;
      while (reference.exec(source.clean) !== null) total += 1;
    }
  }
  callCounts.set(name, total);
  return total;
}

const MUTATORS = [
  'push',
  'push_str',
  'insert',
  'remove',
  'clear',
  'extend',
  'retain',
  'take',
  'replace',
  'get_or_insert',
  'get_or_insert_with',
  'get_or_insert_default',
  'pop',
  'sort',
  'sort_by',
  'sort_by_key',
  'sort_unstable',
  'sort_unstable_by',
  'sort_unstable_by_key',
  'sort_by_cached_key',
  'truncate',
  'drain',
  'entry',
  'append',
  'dedup',
  'reverse',
  'swap',
  'fill',
  'resize',
  'splice',
  'extend_from_slice',
  'clone_from',
  'swap_remove',
  'split_off',
  'retain_mut',
  'rotate_left',
  'rotate_right',
];

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every top-level `key:` in the struct literal that opens at `open`, plus whether it ends in a
 * `..spread`. Nested literals are skipped by depth, so `Outer { a: Inner { b: 1 } }` yields `a`.
 */
function literalKeys(clean: string, open: number): { keys: Set<string>; spread: boolean } {
  const end = matchBrace(clean, open);
  const body = clean.substring(open + 1, end);
  const keys = new Set<string>();
  let depth = 0;
  let segmentStart = 0;
  const take = (from: number, to: number) => {
    const segment = body.substring(from, to).trim();
    const keyMatch = segment.match(/^([a-z_]\w*)\s*:/);
    if (keyMatch) keys.add(keyMatch[1]);
    else if (/^[a-z_]\w*$/.test(segment)) keys.add(segment); // shorthand `Foo { bar }`
  };
  for (let at = 0; at < body.length; at += 1) {
    const here = body[at];
    if (here === '{' || here === '(' || here === '[') depth += 1;
    else if (here === '}' || here === ')' || here === ']') depth -= 1;
    else if (here === ',' && depth === 0) {
      take(segmentStart, at);
      segmentStart = at + 1;
    }
  }
  take(segmentStart, body.length);
  return { keys, spread: /\.\.[^.]/.test(body) };
}

/** Every struct literal of `name` in the crate, with the keys it sets. */
type Literal = {
  source: Source;
  offset: number;
  keys: Set<string>;
  spread: boolean;
  inOwnDefault: boolean;
  constructorish: boolean;
};

const literalsByStruct = new Map<string, Literal[]>();
for (const source of sources) {
  const pattern = /\b(?:([A-Za-z_]\w*)\s*(?:::\s*<[^>]*>\s*)?|Self\s*)\{/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source.clean)) !== null) {
    const literalOpen = match.index + match[0].length - 1;
    let name = match[1];
    const isSelf = match[0].trimStart().startsWith('Self');
    if (isSelf) {
      const block = implAt(source, literalOpen);
      if (!block) continue;
      name = block.target;
    }
    if (!name || !structs.has(name)) continue;
    // A `struct Foo {` declaration is not a literal.
    const struct = structs.get(name)!;
    if (struct.source === source && struct.start === literalOpen) continue;
    const block = implAt(source, literalOpen);
    const inOwnDefault = !!block && block.target === name && block.trait === 'Default';
    const before = source.clean.lastIndexOf('fn ', literalOpen);
    const functionName =
      before === -1 ? '' : ((source.clean.substring(before + 3, before + 60).match(/^\s*([a-z_]\w*)/) || [])[1] ?? '');
    const constructorish = inOwnDefault || /^(new|default|empty|blank|fresh|initial)(_|$)/.test(functionName);
    const { keys, spread } = literalKeys(source.clean, literalOpen);
    const list = literalsByStruct.get(name) ?? [];
    list.push({ source, offset: literalOpen, keys, spread, inOwnDefault, constructorish });
    literalsByStruct.set(name, list);
  }
}

/**
 * Whether the receiver written just before `.field` can be this struct.
 *
 * A bare `\.field =` search pools every struct in the crate that happens to have a field of the
 * same name: `ComposerHistory::entries` read as "written" because `TimerTable::entries` and
 * `DeferredWorkStore::entries` are. The receiver is resolved instead: `self` inside an impl of the
 * struct, or a path segment named after a field that HOLDS the struct.
 */
function receiverMatches(struct: Struct, source: Source, offset: number): boolean {
  const before = source.clean.substring(Math.max(0, offset - 120), offset);
  const tail = before.match(/([A-Za-z_]\w*)\s*$/);
  if (!tail) return true; // cannot tell; keep it rather than invent a dead field
  const receiver = tail[1];
  if (receiver === 'self') {
    const block = implAt(source, offset);
    return !block || block.target === struct.name;
  }
  const receivers = receiversOf.get(struct.name);
  if (!receivers || receivers.size === 0) return true;
  if (receivers.has(receiver)) return true;
  // The receiver names some OTHER audited struct's field, so this write is not ours.
  for (const [name, set] of receiversOf) {
    if (name !== struct.name && set.has(receiver)) return false;
  }
  return true;
}

function writersOf(struct: Struct, field: Field): Writer[] {
  const writers: Writer[] = [];
  const name = escape(field.name);
  const assign = new RegExp(`\\.${name}\\b\\s*(?:\\[[^\\]\\n]*\\]\\s*)?(?:[-+*/%|&^]|<<|>>)?=(?!=)`, 'g');
  const mutate = new RegExp(`\\.${name}\\s*\\.\\s*(?:${MUTATORS.join('|')}|\\w+_mut)\\s*\\(`, 'g');
  // At least one `.` before the name: `&mut entries` is a bare local, not this field.
  const borrow = new RegExp(`&\\s*mut\\s+(?:[\\w:]+\\s*\\.\\s*)+${name}\\b`, 'g');
  for (const source of sources) {
    for (const [pattern, kind] of [
      [assign, 'assign'],
      [mutate, 'mutate'],
      [borrow, '&mut'],
    ] as const) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source.clean)) !== null) {
        const block = implAt(source, match.index);
        if (block && block.target === struct.name && block.trait === 'Default') continue;
        const dot = source.clean.indexOf(`.${field.name}`, match.index);
        const scoped = receiverMatches(
          struct,
          source,
          kind === '&mut' ? (dot === -1 ? match.index : dot) : match.index
        );
        writers.push({
          label: source.label,
          line: lineOf(source, match.index),
          kind: scoped ? kind : `${kind} (other struct)`,
          example: source.label.includes('/examples/'),
          fn: enclosingFunction(source, match.index),
        });
      }
    }
  }
  for (const literal of literalsByStruct.get(struct.name) ?? []) {
    if (literal.inOwnDefault) continue;
    if (!literal.keys.has(field.name)) continue;
    writers.push({
      label: literal.source.label,
      line: lineOf(literal.source, literal.offset),
      kind: literal.constructorish ? 'literal (constructor)' : 'literal',
      example: literal.source.label.includes('/examples/'),
      fn: enclosingFunction(literal.source, literal.offset),
    });
  }
  return writers;
}

// ---------------------------------------------------------------------------
// 6. The report.
// ---------------------------------------------------------------------------

type Verdict = 'no writer' | 'no reachable writer' | 'example only' | 'constructor only' | 'container' | 'written';
type Row = {
  struct: string;
  field: string;
  type: string;
  where: string;
  verdict: Verdict;
  note: string;
  writers: Writer[];
  reached: string | null;
};

const rows: Row[] = [];
const auditedNames = [...audited].sort();
const writersCache = new Map<string, Writer[]>();
for (const name of auditedNames) {
  const struct = structs.get(name);
  if (!struct) continue;
  for (const field of struct.fields) {
    writersCache.set(`${name}::${field.name}`, writersOf(struct, field));
  }
}

/** A field whose type is an audited struct that IS written is a container, not a dead field. */
function subFieldsWritten(type: string): boolean {
  for (const referenced of type.match(/[A-Za-z_]\w*/g) ?? []) {
    const inner = structs.get(referenced);
    if (!inner || !audited.has(referenced)) continue;
    for (const field of inner.fields) {
      const writers = writersCache.get(`${referenced}::${field.name}`) ?? [];
      if (writers.some((writer) => !writer.example && !writer.kind.includes('(other struct)'))) return true;
    }
  }
  return false;
}

for (const name of auditedNames) {
  const struct = structs.get(name);
  if (!struct) continue;
  for (const field of struct.fields) {
    const all = writersCache.get(`${name}::${field.name}`)!;
    // Prefer the writers whose receiver can actually be this struct; fall back to all of them
    // when none could be resolved, so an unusual access path never invents a dead field.
    const scoped = all.filter((writer) => !writer.kind.includes('(other struct)'));
    const writers = scoped.length > 0 ? scoped : all;
    const productionWriters = writers.filter((writer) => !writer.example);
    const updating = productionWriters.filter((writer) => !writer.kind.includes('constructor'));
    let verdict: Verdict = 'written';
    if (writers.length === 0) verdict = subFieldsWritten(field.type) ? 'container' : 'no writer';
    else if (productionWriters.length === 0) verdict = 'example only';
    else if (updating.length === 0) verdict = 'constructor only';
    else if (
      updating.every((writer) => writer.fn !== null && callsOf(writer.fn) === 0) ||
      updating.every((writer) => {
        const source = sources.find((candidate) => candidate.label === writer.label);
        if (!source) return false;
        const offset = source.lineStarts[writer.line - 1] ?? 0;
        return unreachableOwner(source, offset) !== null;
      })
    )
      verdict = 'no reachable writer';
    rows.push({
      struct: name,
      field: field.name,
      type: field.type.length > 46 ? field.type.slice(0, 43) + '...' : field.type,
      where: `${struct.source.label}:${field.line}`,
      verdict,
      note: struct.deserialize ? '[serde Deserialize fills it]' : '',
      writers,
      reached: reachedFrom.get(name) ?? null,
    });
  }
}

if (asJson) {
  console.log(JSON.stringify({ rows, duplicateNames: [...duplicateNames] }, null, 2));
  process.exit(0);
}

const byVerdict = (verdict: Row['verdict']) => rows.filter((row) => row.verdict === verdict);

console.log(
  `structs audited   ${auditedNames.length} (${[...audited].filter((name) => structs.get(name)?.isState).length} declared in src/state/)`
);
console.log(`fields audited    ${rows.length}`);
console.log(`no writer         ${byVerdict('no writer').length}`);
console.log(`no reachable wr.  ${byVerdict('no reachable writer').length} (the only writer is a method nobody calls)`);
console.log(`example only      ${byVerdict('example only').length}`);
console.log(`constructor only  ${byVerdict('constructor only').length}`);
console.log(
  `container         ${byVerdict('container').length} (the field holds a struct whose own fields are written)`
);
console.log(`written           ${byVerdict('written').length}`);
if (duplicateNames.size > 0) {
  console.log(
    `\nstruct names declared twice in the crate (their writers pool): ${[...duplicateNames].sort().join(', ')}`
  );
}

const print = (title: string, list: Row[]) => {
  if (list.length === 0) return;
  console.log(`\n--- ${title} (${list.length}) ---`);
  for (const row of list) {
    const reached = row.reached ? `   via ${row.reached}` : '';
    console.log(`  ${row.struct}::${row.field} ${row.note}`);
    console.log(`      ${row.where}   ${row.type}${reached}`);
    for (const writer of row.writers.slice(0, 4)) {
      const source = sources.find((candidate) => candidate.label === writer.label);
      const dead = source ? unreachableOwner(source, source.lineStarts[writer.line - 1] ?? 0) : null;
      const fn = writer.fn ? ` in fn ${writer.fn}()${dead ? `, and NOTHING CALLS ${dead}` : ''}` : '';
      console.log(`      writer: ${writer.label}:${writer.line} (${writer.kind})${fn}`);
    }
  }
};

print('FIELDS WITH NO WRITER', byVerdict('no writer'));
print('FIELDS WHOSE ONLY WRITER IS A METHOD NOBODY CALLS', byVerdict('no reachable writer'));
print('FIELDS WRITTEN ONLY BY EXAMPLE OR TEST CODE', byVerdict('example only'));
print('FIELDS WRITTEN ONLY WHERE THE STRUCT IS BUILT, NEVER UPDATED', byVerdict('constructor only'));
if (showAll) print('FIELDS WITH WRITERS', byVerdict('written'));

process.exit(
  byVerdict('no writer').length + byVerdict('no reachable writer').length + byVerdict('example only').length > 0 ? 1 : 0
);
