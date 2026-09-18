let sequence = 0;
const timers = new Map<number, { at: number; interval: number; callback: () => void }>();
function schedule(callback: (...args: any[]) => void, delay = 0, interval = 0, args: any[] = []): number {
  const id = ++sequence;
  timers.set(id, { at: Date.now() + Math.max(0, delay), interval, callback: () => callback(...args) });
  return id;
}
export const timerGlobals = {
  setTimeout: (callback: (...args: any[]) => void, delay = 0, ...args: any[]) => schedule(callback, delay, 0, args),
  setInterval: (callback: (...args: any[]) => void, delay = 0, ...args: any[]) => schedule(callback, delay, Math.max(1, delay), args),
  clearTimeout: (id: number) => { timers.delete(id); },
  clearInterval: (id: number) => { timers.delete(id); },
  requestAnimationFrame: (callback: (time: number) => void) => schedule(() => callback(Date.now()), 16),
  cancelAnimationFrame: (id: number) => { timers.delete(id); },
  queueMicrotask: (callback: () => void) => { void Promise.resolve().then(callback); },
};
export function tickNativeTimers(): void {
  const now = Date.now();
  for (const [id, timer] of [...timers]) {
    if (timer.at > now || !timers.has(id)) continue;
    if (timer.interval) timer.at = now + timer.interval;
    else timers.delete(id);
    timer.callback();
  }
}
