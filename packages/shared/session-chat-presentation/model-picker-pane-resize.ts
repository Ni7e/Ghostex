/**
 * CDXC:SessionChat 2026-09-19 DECISION:
 * User: "when we show the quick picker then the user resizes the pane the quick picker is shown in, then lets hide the quick picker (dismiss it)".
 * Dismissal is the cancel path (no selection is kept), the same one an outside click and Escape already use; a blur only releases the held-key highlights and leaves the picker open.
 * The pane size measured when the picker opened is the baseline, and only a change of more than a pixel counts, so the first layout after opening and sub-pixel jitter never dismiss it.
 * Moving the pane without resizing it keeps the existing behaviour.
 */
export class ModelPickerPaneResize {
  private baseline: { width: number; height: number } | null = null;

  resized(size: { width: number; height: number }): boolean {
    if (!this.baseline) {
      this.baseline = { width: size.width, height: size.height };
      return false;
    }
    return Math.abs(size.width - this.baseline.width) > 1 || Math.abs(size.height - this.baseline.height) > 1;
  }
}
