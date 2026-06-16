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
  test("uses features, setup, and changelog actions", () => {
    /*
     * CDXC:TipsAndTricks 2026-06-16-19:42:
     * The Tips & Tricks header should not expose a bulk Read all button.
     * It should instead open Features with a filled star, Setup Ghostex with guide wording, and Changelog as an in-project browser session while individual tips keep their per-row read controls.
     */
    const menuSource = sourceBetween(
      titlebarHostSource,
      "function TitlebarTipsMenu",
      "function TitlebarTipsSection",
    );

    expect(menuSource).toContain("Features");
    expect(menuSource).toContain("Setup Ghostex");
    expect(menuSource).toContain("Changelog");
    expect(menuSource).toContain("IconStarFilled");
    expect(menuSource).toContain("IconBook2");
    expect(menuSource).toContain("IconHistory");
    expect(menuSource).toContain("onOpenHighlightedFeatures");
    expect(menuSource).toContain("onViewGhostexGuide");
    expect(menuSource).toContain("onOpenChangelog");
    expect(menuSource).not.toContain(">Highlighted Features<");
    expect(menuSource).not.toContain(">View Ghostex Guide<");
    expect(menuSource).not.toContain("Open Highlighted Features");
    expect(menuSource).not.toContain("Read all");
    expect(menuSource).not.toContain("onMarkAllRead");
    expect(menuSource).not.toContain("Run Setup Flow");
    expect(menuSource).not.toContain("titlebar-tips-summary");
    expect(titlebarHostSource).toContain('type: "openHighlightedFeatures"');
    expect(titlebarHostSource).toContain('type: "openWorkspaceWelcome"');
    expect(titlebarHostSource).toContain('type: "openBrowserPane", url: GHOSTEX_CHANGELOG_URL');
    expect(titlebarHostSource).toContain("https://github.com/maddada/ghostex/releases");
  });

  test("keeps tips actions equal width and clickable controls pointer based", () => {
    /*
     * CDXC:TipsAndTricks 2026-06-16-19:42:
     * The Tips & Tricks panel should make all three header actions the same width, remove the top-right unread text summary, and use pointer cursors for clickable controls.
     */
    const stylesSource = sourceBetween(
      titlebarHostSource,
      ".titlebar-tips-menu",
      ".titlebar-resources-info-button",
    );

    expect(stylesSource).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(stylesSource).toContain("width: 390px;");
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
