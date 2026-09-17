import type { PickerControl } from './model-picker-input';

/** Keeps taps visible for 160ms while held keys remain lit until release. */
export class ModelPickerKeyFeedback {
  pressed: ReadonlySet<PickerControl> = new Set();
  private readonly held = new Map<string, PickerControl>();
  private readonly releases = new Map<PickerControl, ReturnType<typeof setTimeout>>();
  constructor(private readonly changed: (pressed: ReadonlySet<PickerControl>) => void) {}

  private update(pressed: ReadonlySet<PickerControl>) {
    if (pressed === this.pressed) return;
    this.pressed = pressed;
    this.changed(pressed);
  }

  private releaseAfterDelay(control: PickerControl) {
    clearTimeout(this.releases.get(control));
    this.releases.set(
      control,
      setTimeout(() => {
        this.releases.delete(control);
        const next = new Set(this.pressed);
        next.delete(control);
        this.update(next);
      }, 160)
    );
  }

  release(key: string) {
    const control = this.held.get(key);
    this.held.delete(key);
    if (control && ![...this.held.values()].includes(control)) this.releaseAfterDelay(control);
  }

  pulse(control: PickerControl) {
    clearTimeout(this.releases.get(control));
    this.releases.delete(control);
    this.update(this.pressed.has(control) ? this.pressed : new Set([...this.pressed, control]));
    if (![...this.held.values()].includes(control)) this.releaseAfterDelay(control);
  }

  press(key: string, control: PickerControl) {
    this.held.set(key, control);
    this.pulse(control);
  }

  blur() {
    this.dispose();
    this.update(new Set());
  }
  dispose() {
    this.held.clear();
    for (const timer of this.releases.values()) clearTimeout(timer);
    this.releases.clear();
  }
}
