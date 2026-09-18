import { spawn } from 'node:child_process';
import type { Zmx } from './zmx';

/** CDXC:Terminal 2026-09-17 DECISION:
 * User: the debugger is a standalone TUI with an optional Herdr wrapper.
 * Hand the real TTY to zmx, then restore the browser on detach; the session daemon outlives this client.
 */
export async function attach(zmx: Zmx, name: string): Promise<void> {
  const { binary } = await zmx.requireExisting(name);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ['attach', '--require-existing', name], { stdio: 'inherit', env: zmx.env() });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`zmx attach exited ${signal ?? code}`))
    );
  });
}
