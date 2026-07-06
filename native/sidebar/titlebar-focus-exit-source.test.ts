import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const titlebarHostSource = readFileSync(new URL("./titlebar-host.tsx", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("titlebar focus exit source", () => {
  test("matches the active Agents mode tab styling", () => {
    /*
     * CDXC:SessionFocusMode 2026-06-13-18:39:
     * Exit focus should be visually identical to the active Agents titlebar tab,
     * so source coverage keeps it on the shared mode-tab DOM and prevents the
     * older standalone outlined-button skin from returning.
     */
    const focusExitRenderSource = sourceBetween(
      titlebarHostSource,
      ": projectState.isFocusModeActive ? (",
      "{/*\n             * CDXC:ReactTitlebar 2026-05-30-03:11:",
    );
    expect(focusExitRenderSource).toContain('className="titlebar-mode-tab titlebar-exit-focus-button"');
    expect(focusExitRenderSource).toContain('data-active="true"');
    expect(focusExitRenderSource).toContain('style={{ transformStyle: "preserve-3d" }}');
    expect(focusExitRenderSource).toContain('className="titlebar-mode-tab-active"');
    expect(focusExitRenderSource).toContain('className="titlebar-mode-tab-content"');
    expect(focusExitRenderSource).toContain('className="titlebar-mode-label"');
    expect(focusExitRenderSource).not.toContain("<Button");
    expect(focusExitRenderSource).not.toContain('variant="outline"');

    const focusExitStyleSource = sourceBetween(
      titlebarHostSource,
      "  .titlebar-exit-focus-button {",
      "  .titlebar-resource-button {",
    );
    expect(focusExitStyleSource).toContain("--titlebar-mode-tab-radius: 0;");
    expect(focusExitStyleSource).not.toContain("background: rgba(255,255,255,0.2)");
    expect(focusExitStyleSource).not.toContain("font: 720 12px");
  });
});
