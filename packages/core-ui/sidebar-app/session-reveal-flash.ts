const pendingFlashes = new WeakMap<HTMLElement, () => void>();

/**
 * CDXC:Sessions 2026-09-16 DECISION:
 * User: revealing a session with the titlebar button should blink its outline twice, using #93c5fd in light mode and white in dark mode.
 * Wait for the reveal scroll to settle so both flashes are visible.
 */
export function flashRevealedSession(row: HTMLElement): void {
  pendingFlashes.get(row)?.();
  const ancestors: HTMLElement[] = [];
  for (let ancestor = row.parentElement; ancestor; ancestor = ancestor.parentElement) {
    ancestors.push(ancestor);
  }
  const readPositions = () => [
    row.getBoundingClientRect().top,
    ...ancestors.flatMap((ancestor) => [ancestor.scrollTop, ancestor.getBoundingClientRect().height]),
  ];
  let positions = readPositions();
  let didFinalScroll = false;
  let stableFrames = 0;
  let frameId = 0;
  let flash: Animation | undefined;
  const cancel = () => {
    window.cancelAnimationFrame(frameId);
    flash?.cancel();
    pendingFlashes.delete(row);
  };
  pendingFlashes.set(row, cancel);

  const waitForScroll = () => {
    if (!row.isConnected) {
      cancel();
      return;
    }
    const nextPositions = readPositions();
    stableFrames = nextPositions.every((position, index) => position === positions[index]) ? stableFrames + 1 : 0;
    positions = nextPositions;
    if (stableFrames < 3) {
      frameId = window.requestAnimationFrame(waitForScroll);
      return;
    }
    if (!didFinalScroll) {
      // Section expansion can move the target after the first reveal scroll.
      row.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      didFinalScroll = true;
      stableFrames = 0;
      frameId = window.requestAnimationFrame(waitForScroll);
      return;
    }
    flash = row.animate(
      [
        { outlineColor: 'transparent', offset: 0 },
        { outlineColor: 'light-dark(#93c5fd, #ffffff)', offset: 0.2 },
        { outlineColor: 'light-dark(#93c5fd, #ffffff)', offset: 0.55 },
        { outlineColor: 'transparent', offset: 1 },
      ].map((frame) => ({ ...frame, outlineStyle: 'solid', outlineWidth: '2px', outlineOffset: '-2px' })),
      { duration: 550, iterations: 2, easing: 'ease-in-out', pseudoElement: '::after' }
    );
    flash.onfinish = () => pendingFlashes.delete(row);
  };
  frameId = window.requestAnimationFrame(waitForScroll);
}
