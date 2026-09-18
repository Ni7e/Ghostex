import { nativeCall } from '@/packages/shared/native-runtime/bridge';
export type BrowserBackend = 'local' | 'session';
export function readBrowser(backend: BrowserBackend, key: string): string | null {
  return nativeCall('preferenceRead', { backend, key });
}
export function writeBrowser(backend: BrowserBackend, key: string, raw: string | null): void {
  nativeCall('preferenceWrite', { backend, key, raw });
}
export function scanBrowser(backend: BrowserBackend): [string, string][] {
  return nativeCall('preferenceScan', { backend });
}
export function subscribeBrowser(_callback: (backend: BrowserBackend, key: string | null) => void): void {}
export function installBrowserGuard(): void {}
