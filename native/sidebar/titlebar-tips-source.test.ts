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

describe("native titlebar Tips & Tricks source", () => {
  test("uses highlighted features and guide actions", () => {
    /*
     * CDXC:TipsAndTricks 2026-06-16-10:04:
     * The Tips & Tricks header should not expose a bulk Read all button.
     * It should instead open Highlighted Features with a filled star and View
     * Ghostex Guide with guide wording while individual tips keep their per-row
     * read controls.
     */
    const menuSource = sourceBetween(
      titlebarHostSource,
      "function TitlebarTipsMenu",
      "function TitlebarTipsSection",
    );

    expect(menuSource).toContain("Highlighted Features");
    expect(menuSource).toContain("View Ghostex Guide");
    expect(menuSource).toContain("IconStarFilled");
    expect(menuSource).toContain("IconBook2");
    expect(menuSource).toContain("onOpenHighlightedFeatures");
    expect(menuSource).toContain("onViewGhostexGuide");
    expect(menuSource).not.toContain("Read all");
    expect(menuSource).not.toContain("onMarkAllRead");
    expect(menuSource).not.toContain("Run Setup Flow");
    expect(menuSource).not.toContain("titlebar-tips-summary");
    expect(titlebarHostSource).toContain('type: "openHighlightedFeatures"');
    expect(titlebarHostSource).toContain('type: "openWorkspaceWelcome"');
  });

  test("keeps tips actions equal width and clickable controls pointer based", () => {
    /*
     * CDXC:TipsAndTricks 2026-06-16-10:04:
     * The Tips & Tricks panel should make both header actions the same width,
     * remove the top-right unread text summary, and use pointer cursors for
     * clickable controls.
     */
    const stylesSource = sourceBetween(
      titlebarHostSource,
      ".titlebar-tips-menu",
      ".titlebar-resources-info-button",
    );

    expect(stylesSource).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(stylesSource).toContain("width: 320px;");
    expect(stylesSource).toContain(".titlebar-tips-panel button:not(:disabled)");
    expect(stylesSource).toContain("cursor: pointer;");
    expect(stylesSource).not.toContain(".titlebar-tips-summary");
  });

  test("does not render right-aligned section counts", () => {
    /*
     * CDXC:TipsAndTricks 2026-06-12-23:28:
     * macOS Tips & Tricks section headers should show labels only; the previous
     * right-side count looked like noisy chrome beside Read and Unread headings.
     */
    const sectionSource = sourceBetween(
      titlebarHostSource,
      "function TitlebarTipsSection",
      "function TitlebarNoticeRow",
    );

    expect(titlebarHostSource).toContain("headers read as labels only");
    expect(sectionSource).toContain("count > 0 ? children");
    expect(titlebarHostSource).not.toContain("titlebar-tips-section-count");
  });
});
