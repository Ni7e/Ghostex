/**
 * CDXC:Drafts 2026-09-19 WHY:
 * A checkpoint is written for every edit that is not an append, so editing the middle of a long draft stored a full copy per keystroke: one 9 KB draft left 1,684 checkpoints (16 MB), filled the store's 32 MB budget, and from then on every draft save failed with "Draft recovery checkpoints has reached its storage budget."
 * Checkpoints of one draft that sit within a few keystrokes of each other carry the same recoverable text, so a run of them is kept as its first checkpoint (the anchor) plus its latest; a new run starts once the text has moved `RUN_DIVERGENCE` characters away from the anchor, which bounds what thinning can ever drop to less than that many characters of typing.
 */
export const RUN_DIVERGENCE = 200;

/** Characters that differ between two texts once their common start and end are set aside. */
export function divergence(a: string, b: string): number {
  const shorter = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < shorter && a.charCodeAt(prefix) === b.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (
    suffix < shorter - prefix &&
    a.charCodeAt(a.length - 1 - suffix) === b.charCodeAt(b.length - 1 - suffix)
  )
    suffix++;
  return Math.max(a.length, b.length) - prefix - suffix;
}

/** The run a draft's newest checkpoints belong to. */
export type CheckpointRun = { anchor: string; latest?: string };

/**
 * Add checkpoint `name` to `run`. Returns the run to keep and the checkpoint it makes redundant, if any.
 */
export function extendRun(
  run: CheckpointRun | undefined,
  name: string,
  text: string
): { run: CheckpointRun; superseded?: string } {
  if (!run || divergence(run.anchor, text) > RUN_DIVERGENCE) return { run: { anchor: text } };
  return { run: { anchor: run.anchor, latest: name }, superseded: run.latest };
}

/** The checkpoints of one draft, oldest first, that a run-by-run pass makes redundant. */
export function redundantCheckpoints(checkpoints: readonly { name: string; text: string }[]): string[] {
  const redundant: string[] = [];
  let run: CheckpointRun | undefined;
  for (const checkpoint of checkpoints) {
    const next = extendRun(run, checkpoint.name, checkpoint.text);
    run = next.run;
    if (next.superseded) redundant.push(next.superseded);
  }
  return redundant;
}
