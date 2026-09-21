import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import { createGpuiSidebarRuntime } from '../gxserver-runtime';
import { currentGpuiRuntimeSettings } from '../gxserver-runtime/helpers/bootstrap';
import { createGpuiSidebarHudState } from '../gxserver-runtime/helpers/command-pane';
import { installSessionChatRuntimeBroker } from '../session-chat-runtime/broker';
import { connectSidebarStoreFeed } from '../sidebar-store-feed';
import { connectNativeQuickAccess } from '../native-quick-access/controller';

export function startNativeSidebar(): void {
  const runtimeSettings = currentGpuiRuntimeSettings();
  if (!runtimeSettings) throw new Error('Native sidebar settings were not installed.');
  sidebarStore
    .getState()
    .applyHudChangedMessage({
      type: 'sidebarHudChanged',
      revision: 0,
      hud: createGpuiSidebarHudState({ runtimeSettings }),
    });
  installSessionChatRuntimeBroker();
  const runtime = createGpuiSidebarRuntime();
  connectSidebarStoreFeed(runtime.messageSource);
  connectNativeQuickAccess(runtime);
  runtime.start();
}
