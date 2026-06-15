import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const sidebarAppSource = readFileSync(new URL("./sidebar-app.tsx", import.meta.url), "utf8");

function sourceBetween(start: string, end: string): string {
  const startIndex = sidebarAppSource.indexOf(start);
  const endIndex = sidebarAppSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return sidebarAppSource.slice(startIndex, endIndex);
}

describe("sidebar overflow menu source", () => {
  test("puts Commands with the current hotkey first in the overflow menu", () => {
    /*
     * CDXC:CommandPalette 2026-06-13-10:42:
     * The sidebar overflow menu should start with Commands plus the current
     * command-palette hotkey so the app-wide command surface is discoverable
     * from the More control before secondary toggles such as Wake Pet.
     *
     * CDXC:CommandPalette 2026-06-16-00:26:
     * The menu label formats modifier words into compact symbols in product
     * code, so the source test should assert the formatter path instead of the
     * older raw template literal.
     */
    const overflowMenuSource = sourceBetween(
      "function renderFloatingOverflowMenu({",
      "function resolveSessionDropTargetFromPoint",
    );

    const firstCommandPaletteIndex = overflowMenuSource.indexOf("commandPaletteMenuLabel");
    expect(sidebarAppSource).toContain("getCommandPaletteOverflowMenuLabel");
    expect(sidebarAppSource).toContain('hotkeyLabel.replace("CMD"');
    expect(sidebarAppSource).toContain('replace("SHIFT"');
    expect(sidebarAppSource).toContain('return "CMD";');
    expect(sidebarAppSource).toContain('return "SHIFT";');
    expect(firstCommandPaletteIndex).toBeGreaterThanOrEqual(0);
    expect(firstCommandPaletteIndex).toBeLessThan(overflowMenuSource.indexOf("Wake Pet"));
    expect(firstCommandPaletteIndex).toBeLessThan(overflowMenuSource.indexOf("Pinned Prompts"));
    expect(overflowMenuSource).toContain("onOpenCommandPalette");
  });

  test("keeps Setup Flow above Discover Ghostex when hooks are missing", () => {
    /*
     * CDXC:FirstLaunchSetup 2026-06-16-00:56:
     * The overflow menu should keep the original first-launch setup flow as a
     * Setup Flow item directly above Discover Ghostex so onboarding tasks and
     * the replayable feature tour are both discoverable.
     *
     * CDXC:DiscoverGhostex 2026-06-16-00:26:
     * The overflow menu's help action is named Discover Ghostex and opens the
     * replayable feature tour. It must not become a hook-install notice when
     * agent hooks are missing because setup repair belongs to Settings and
     * first-launch onboarding.
     */
    const overflowMenuSource = sourceBetween(
      "function renderFloatingOverflowMenu({",
      "function resolveSessionDropTargetFromPoint",
    );

    expect(overflowMenuSource).toContain("Setup Flow");
    expect(overflowMenuSource).toContain("Discover Ghostex");
    expect(overflowMenuSource.indexOf("Setup Flow")).toBeLessThan(
      overflowMenuSource.indexOf("Discover Ghostex"),
    );
    expect(sidebarAppSource).toContain('modal: "firstLaunchSetup"');
    expect(sidebarAppSource).toContain('modal: "discoverGhostex"');
    expect(overflowMenuSource).not.toContain("hasMissingAgentHooks");
    expect(overflowMenuSource).not.toContain("sidebar-hook-warning-menu-item");
    expect(overflowMenuSource).not.toContain("Agent hooks");
  });
});
