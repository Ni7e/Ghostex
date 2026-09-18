export class NativeEvent {
  defaultPrevented = false;
  constructor(public type: string, init: Record<string, unknown> = {}) { Object.assign(this, init); }
  preventDefault(): void { this.defaultPrevented = true; }
  stopPropagation(): void {}
}

export class NativeEventTarget {
  private listeners = new Map<string, Map<any, boolean>>();
  addEventListener(type: string, callback: any, options?: { once?: boolean } | boolean): void {
    if (!callback) return;
    const listeners = this.listeners.get(type) ?? new Map();
    listeners.set(callback, typeof options === 'object' && !!options.once);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, callback: any): void { this.listeners.get(type)?.delete(callback); }
  dispatchEvent(event: NativeEvent): boolean {
    for (const [callback, once] of [...(this.listeners.get(event.type) ?? [])]) {
      if (once) this.removeEventListener(event.type, callback);
      if (typeof callback === 'function') callback.call(this, event);
      else callback.handleEvent(event);
    }
    return !event.defaultPrevented;
  }
}

export class NativeAbortSignal extends NativeEventTarget {
  aborted = false;
  reason?: Error;
  throwIfAborted(): void { if (this.aborted) throw this.reason; }
  static timeout(delay: number): NativeAbortSignal {
    const controller = new NativeAbortController();
    setTimeout(() => controller.abort(new Error('The request timed out.')), delay);
    return controller.signal;
  }
}
export class NativeAbortController {
  signal = new NativeAbortSignal();
  abort(reason = new Error('The request was cancelled.')): void {
    if (this.signal.aborted) return;
    this.signal.aborted = true;
    this.signal.reason = reason;
    this.signal.dispatchEvent(new NativeEvent('abort'));
  }
}
