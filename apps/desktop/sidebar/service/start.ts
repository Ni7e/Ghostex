import { createGpuiSidebarRuntime } from '../gxserver-runtime';
import { currentGpuiRuntimeSettings } from '../gxserver-runtime/helpers/bootstrap';

export function startNativeSidebar(): void {
  if (!currentGpuiRuntimeSettings()) throw new Error('Native sidebar settings were not installed.');
  createGpuiSidebarRuntime().start();
}
