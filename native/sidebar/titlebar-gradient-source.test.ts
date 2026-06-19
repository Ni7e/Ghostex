import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const titlebarHostSource = readFileSync(new URL("./titlebar-host.tsx", import.meta.url), "utf8");

describe("titlebar gradient source", () => {
  test("keeps the custom titlebar blended with the sidebar before darkening", () => {
    /*
     * CDXC:SidebarTitlebarColors 2026-06-19-13:26:
     * The custom titlebar should hold the sidebar top gradient stop for the
     * first 40% of its width, then fade to the sidebar bottom stop so the left
     * edge stays blended with the sidebar while the right side darkens.
     */
    expect(titlebarHostSource).toContain("const TITLEBAR_GRADIENT_BLEND_START_PERCENT = 40;");
    expect(titlebarHostSource).toContain(
      "${titlebarGradientColors.titlebarLeft} ${TITLEBAR_GRADIENT_BLEND_START_PERCENT}%",
    );
    expect(titlebarHostSource).toContain("${titlebarGradientColors.titlebarRight} 100%");
  });
});
