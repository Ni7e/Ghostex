import { installNativePlatform } from '@/packages/shared/native-runtime/platform';
import { nativePost } from '@/packages/shared/native-runtime/bridge';
import { tickNativeTimers } from '@/packages/shared/native-runtime/timers';
import { receiveNativeNetwork } from '@/packages/shared/native-runtime/network';

installNativePlatform();
const scope = globalThis as any;
scope.nativeService = {
  async start(config: any) {
    const bridge: Record<string, any> = {
      runtimeSettings: config.runtimeSettings,
      gxserverBootstrap: config.gxserverBootstrap,
    };
    for (const name of config.bridgeFunctions) bridge[name] = (payload: string) => {
      nativePost({ kind: 'sidebar', name, payload }); return true;
    };
    scope.ghostexGpui = bridge;
    scope.webkit = { messageHandlers: {
      ghostexNativeHost: { postMessage: (message: unknown) => nativePost({ kind: 'nativeHost', message }) },
      ghostexAppModalHost: { postMessage: (message: unknown) => nativePost({ kind: 'modalHost', message }) },
    } };
    const { initializeClientStorage } = await import('@/packages/client-storage');
    await initializeClientStorage();
    const { startNativeSidebar } = await import('./start');
    startNativeSidebar();
  },
  receive: receiveNativeNetwork,
  tick: tickNativeTimers,
};
