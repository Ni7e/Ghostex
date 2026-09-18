export type PickerDirection = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';
export type PickerControl = PickerDirection | 'Enter' | 'Escape';

const controls: Record<string, PickerControl> = {
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Enter: 'Enter',
  Escape: 'Escape',
  h: 'ArrowLeft',
  j: 'ArrowDown',
  k: 'ArrowUp',
  l: 'ArrowRight',
  ',': 'ArrowLeft',
  '.': 'ArrowRight',
};

/**
 * CDXC:SessionChat 2026-09-05 DECISION:
 * User: support H/J/K/L alongside arrows and light up the matching footer key when used.
 * Additional effort shortcuts remain unadvertised. Modifier chords belong to the application's configured hotkeys.
 */
export function modelPickerControlForKey(event: {
  key: string;
  isComposing?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): PickerControl | undefined {
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
  return controls[event.key] ?? controls[event.key.toLowerCase()];
}

export interface ModelPickerWheelInput {
  deltaX: number;
  deltaY: number;
  deltaMode?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  height: number;
  now: number;
}

export class ModelPickerWheelNavigation {
  private lastEvent = 0;
  private lastStep = -Infinity;
  private distance = 0;
  private direction: PickerDirection | null = null;

  update(event: ModelPickerWheelInput): PickerDirection | undefined {
    if (event.ctrlKey || event.metaKey) return;
    const unit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? event.height : 1;
    const dx = (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit;
    const dy = (event.shiftKey ? 0 : event.deltaY) * unit;
    if (!dx && !dy) return;
    const now = event.now;
    const horizontal = Math.abs(dx) > Math.abs(dy);
    const delta = horizontal ? dx : dy;
    const nextDirection = horizontal ? (delta > 0 ? 'ArrowRight' : 'ArrowLeft') : delta > 0 ? 'ArrowDown' : 'ArrowUp';
    if (now - this.lastEvent > 180 || nextDirection !== this.direction) {
      this.distance = 0;
      this.lastStep = -Infinity;
    }
    this.lastEvent = now;
    this.direction = nextDirection;
    this.distance += Math.abs(delta);
    if (this.distance < 40 || now - this.lastStep < 100 / 0.7) return;
    this.distance = 0;
    this.lastStep = now;
    return this.direction;
  }
}
