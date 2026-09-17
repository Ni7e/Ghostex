import { nativeCall, nativePost } from './bridge';
import { NativeEvent, NativeEventTarget, NativeAbortController, NativeAbortSignal } from './events';
import { nativeFetch, NativeWebSocket } from './network';
import { timerGlobals } from './timers';
import { NativeURL, NativeURLSearchParams } from './url';

/** CDXC:SessionChat 2026-09-17 DECISION: Keep shared TypeScript in QuickJS for now; chat and sidebar must run without CEF, including their background services and storage. */
export function installNativePlatform(): void {
  const events = new NativeEventTarget();
  Object.assign(globalThis, timerGlobals, {
    window: globalThis, Event: NativeEvent, CustomEvent: NativeEvent, MessageEvent: NativeEvent, EventTarget: NativeEventTarget,
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events),
    AbortController: NativeAbortController, AbortSignal: NativeAbortSignal, URL: NativeURL, URLSearchParams: NativeURLSearchParams,
    fetch: nativeFetch, WebSocket: NativeWebSocket,
    navigator: { userAgent: nativeCall('platform'), onLine: true },
    performance: { now: () => Date.now() },
    crypto: { randomUUID: () => nativeCall('uuid') },
    console: Object.fromEntries(['log', 'info', 'debug', 'warn', 'error'].map(level => [level, (...values: unknown[]) => nativePost({ kind: 'log', level, message: values.map(String).join(' ') })])),
    structuredClone: (value: unknown) => JSON.parse(JSON.stringify(value)),
    DOMException: class extends Error { constructor(message: string, name = 'Error') { super(message); this.name = name; } },
    TextEncoder: class { encode(value: string) { return new Uint8Array(nativeCall<number[]>('encode', { value })); } },
    TextDecoder: class { decode(value: Uint8Array) { return nativeCall('decode', { value: Array.from(value) }); } },
    btoa: (value: string) => nativeCall('base64Encode', { value }),
    atob: (value: string) => nativeCall('base64Decode', { value }),
  });
}
