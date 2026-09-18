import { nativeCall } from './bridge';

export class NativeURLSearchParams {
  private pairs: [string, string][];
  constructor(value: string | Record<string, string> | [string, string][] = '', private changed?: () => void) {
    this.pairs = typeof value === 'string' ? nativeCall('queryParse', { value }) : Array.isArray(value) ? value : Object.entries(value);
  }
  append(key: string, value: string): void { this.pairs.push([String(key), String(value)]); this.changed?.(); }
  set(key: string, value: string): void { this.delete(key); this.append(key, value); }
  get(key: string): string | null { return this.pairs.find(([name]) => name === key)?.[1] ?? null; }
  getAll(key: string): string[] { return this.pairs.filter(([name]) => name === key).map(([, value]) => value); }
  has(key: string): boolean { return this.pairs.some(([name]) => name === key); }
  delete(key: string): void { this.pairs = this.pairs.filter(([name]) => name !== key); this.changed?.(); }
  toString(): string { return nativeCall('querySerialize', { pairs: this.pairs }); }
  entries(): IterableIterator<[string, string]> { return this.pairs[Symbol.iterator](); }
  [Symbol.iterator](): IterableIterator<[string, string]> { return this.entries(); }
}

export class NativeURL {
  private fields: Record<string, string>;
  searchParams: NativeURLSearchParams;
  constructor(value: string, base?: string) {
    this.fields = nativeCall('url', { value: String(value), base: base === undefined ? undefined : String(base) });
    this.searchParams = new NativeURLSearchParams(this.fields.search, () => this.update('search', this.searchParams.toString()));
  }
  private update(key: string, value: string): void { this.fields = nativeCall('url', { value: this.fields.href, key, replacement: value }); }
  get href(): string { return this.fields.href!; }
  get origin(): string { return this.fields.origin!; }
  get protocol(): string { return this.fields.protocol!; }
  set protocol(value: string) { this.update('protocol', value); }
  get hostname(): string { return this.fields.hostname!; }
  get host(): string { return this.fields.host!; }
  get port(): string { return this.fields.port!; }
  get pathname(): string { return this.fields.pathname!; }
  set pathname(value: string) { this.update('pathname', value); }
  get search(): string { return this.fields.search!; }
  get hash(): string { return this.fields.hash!; }
  toString(): string { return this.href; }
  toJSON(): string { return this.href; }
}
