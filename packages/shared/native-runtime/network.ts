import { nativePost } from './bridge';
import { NativeEvent, NativeEventTarget, type NativeAbortSignal } from './events';

let sequence = 0;
const requests = new Map<number, { resolve: (response: any) => void; reject: (error: Error) => void; cleanup: () => void }>();
const sockets = new Map<number, NativeWebSocket>();

export function nativeFetch(url: string, options: { method?: string; body?: string; headers?: Record<string, string>; signal?: NativeAbortSignal } = {}): Promise<any> {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    options.signal?.throwIfAborted();
    const abort = () => { requests.delete(id); nativePost({ kind: 'httpCancel', id }); reject(options.signal!.reason!); };
    options.signal?.addEventListener('abort', abort, { once: true });
    requests.set(id, { resolve, reject, cleanup: () => options.signal?.removeEventListener('abort', abort) });
    nativePost({ kind: 'http', id, url: String(url), method: options.method ?? 'GET', body: options.body, headers: options.headers });
  });
}

export class NativeWebSocket extends NativeEventTarget {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  readonly id = ++sequence;
  readyState = NativeWebSocket.CONNECTING;
  onopen?: (event: NativeEvent) => void;
  onmessage?: (event: NativeEvent) => void;
  onerror?: (event: NativeEvent) => void;
  onclose?: (event: NativeEvent) => void;
  constructor(url: string) { super(); sockets.set(this.id, this); nativePost({ kind: 'socketOpen', id: this.id, url: String(url) }); }
  send(data: string): void {
    if (this.readyState !== NativeWebSocket.OPEN) throw new Error('The connection is not open.');
    nativePost({ kind: 'socketSend', id: this.id, data });
  }
  close(): void { if (this.readyState >= NativeWebSocket.CLOSING) return; this.readyState = NativeWebSocket.CLOSING; nativePost({ kind: 'socketClose', id: this.id }); }
  receive(type: string, data?: string): void {
    if (type === 'open') this.readyState = NativeWebSocket.OPEN;
    if (type === 'close') { this.readyState = NativeWebSocket.CLOSED; sockets.delete(this.id); }
    const event = new NativeEvent(type, { data });
    this.dispatchEvent(event);
    const handler = ({ open: this.onopen, message: this.onmessage, error: this.onerror, close: this.onclose } as Record<string, typeof this.onopen>)[type];
    handler?.call(this, event);
  }
}

export function receiveNativeNetwork(message: any): void {
  if (message.kind === 'socket') { sockets.get(message.id)?.receive(message.type, message.data); return; }
  const request = requests.get(message.id);
  if (!request) return;
  requests.delete(message.id);
  request.cleanup();
  if (message.error) request.reject(new Error(message.error));
  else request.resolve({ ok: message.status >= 200 && message.status < 300, status: message.status,
    text: async () => message.body, json: async () => JSON.parse(message.body),
  });
}
