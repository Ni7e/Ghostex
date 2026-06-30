import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const groupPanelsSource = readFileSync(new URL("./styles/group-panels.css", import.meta.url), "utf8");
const manageSource = readFileSync(new URL("../native/sidebar/manage.tsx", import.meta.url), "utf8");
const meoStylesSource = readFileSync(new URL("../native/sidebar/meo/styles.css", import.meta.url), "utf8");
const overlaySurfaceSource = readFileSync(new URL("../components/ui/overlay-surface.ts", import.meta.url), "utf8");
const sessionOverlaysSource = readFileSync(new URL("./styles/session-overlays.css", import.meta.url), "utf8");
const themeSource = readFileSync(new URL("./styles/theme.css", import.meta.url), "utf8");
const tooltipPrimitiveSource = readFileSync(new URL("../components/ui/tooltip.tsx", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("tooltip radius source", () => {
  test("matches tooltip corners to the macOS sidebar top icon buttons", () => {
    /*
     * CDXC:Tooltips 2026-06-30-11:15:
     * Every app tooltip surface should use the same slight 5px radius as the
     * macOS sidebar top icon buttons. Shared Base UI tooltips get the token
     * through tooltipSurfaceStyle, while custom portaled or CSS-only tooltip
     * surfaces must opt into the same token instead of keeping square corners.
     */
    expect(groupPanelsSource).toMatch(
      /\.reference-sidebar-primary-icon-row\s+\.reference-sidebar-nav-icon-button \{[\s\S]*border-radius: 5px;/,
    );
    expect(themeSource).toContain("--ghostex-tooltip-radius: 5px;");
    expect(overlaySurfaceSource).toContain('borderRadius: "var(--ghostex-tooltip-radius, 5px)"');
    expect(tooltipPrimitiveSource).not.toContain("whitespace-pre-line rounded-none px-3");

    const tooltipRadiusDeclaration = "border-radius: var(--ghostex-tooltip-radius, 5px);";
    expect(sourceBetween(groupPanelsSource, ".sidebar-fixed-tooltip-popup {", "}")).toContain(
      tooltipRadiusDeclaration,
    );
    expect(sourceBetween(sessionOverlaysSource, ".session-local-tooltip-popup {", "}")).toContain(
      tooltipRadiusDeclaration,
    );
    expect(sourceBetween(sessionOverlaysSource, ".tooltip-popup {", "}")).toContain(
      tooltipRadiusDeclaration,
    );
    expect(
      sourceBetween(
        manageSource,
        ".manage-markdown-selection-toolbar button::after {\n    background:",
        "}",
      ),
    ).toContain(tooltipRadiusDeclaration);
    expect(sourceBetween(meoStylesSource, ".meo-git-blame-tooltip {", "}")).toContain(
      tooltipRadiusDeclaration,
    );
  });
});
