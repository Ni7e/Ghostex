import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const sidebarAppSource = readFileSync(new URL("./sidebar-app.tsx", import.meta.url), "utf8");
const groupPanelsCssSource = readFileSync(
  new URL("./styles/group-panels.css", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("sidebar settings menu source", () => {
  test("moves the Commands Pane launcher onto Recent Projects", () => {
    const recentProjectsSource = sourceBetween(
      sidebarAppSource,
      'aria-label="Recent Projects"',
      '<GitCommitModal',
    );
    expect(recentProjectsSource).toContain("reference-sidebar-commands-pane-action");
    expect(recentProjectsSource).toContain("createFullWidthTerminalPane();");
    expect(groupPanelsCssSource).toContain(".reference-sidebar-commands-pane-action");
    expect(groupPanelsCssSource).toContain("pointer-events: auto;");
    expect(groupPanelsCssSource).toContain("cannot fall through to the drawer toggle");
    expect(sidebarAppSource).not.toContain("function SidebarReferenceSettingsButton(");
  });
});
