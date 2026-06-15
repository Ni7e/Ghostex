import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const discoverModalSource = readFileSync(
  new URL("./discover-ghostex-modal.tsx", import.meta.url),
  "utf8",
);
const sidebarStylesSource = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("discover ghostex modal source", () => {
  test("uses README screenshots and matching README copy", () => {
    /*
    CDXC:DiscoverGhostex 2026-06-16-02:01:
    The Discover Ghostex tour should use README.md screenshots and fitting
    README copy so the modal shows real product surfaces instead of placeholder
    image boxes.
    */
    expect(discoverModalSource).toContain("../media/readme/ghostex-embedded-vscode-editor.png");
    expect(discoverModalSource).toContain("../media/readme/ghostex-agents-terminal-splits.png");
    expect(discoverModalSource).toContain("../media/readme/ghostex-chromium-design-mode.png");
    expect(discoverModalSource).toContain("../media/readme/ghostex-kanban-beads-board.png");
    expect(discoverModalSource).toContain("../media/readme/ghostex-rich-prompt-editor-ctrl-g.png");
    expect(discoverModalSource).toContain("Great for working with markdown");
    expect(discoverModalSource).toContain("Split your terminals and use keyboard hotkeys");
    expect(discoverModalSource).toContain("Design Mode, DevTools, Agent Browser Control, and profiles");
    expect(discoverModalSource).toContain("Dump notes into a Beads board");
    expect(discoverModalSource).toContain("image previews from Ctrl+G");
    expect(discoverModalSource).not.toContain("Image showing the feature");
    expect(discoverModalSource).not.toContain("Placeholder until screenshots are added");
  });

  test("keeps thumbnail labels balanced above fixed image tiles", () => {
    /*
    CDXC:DiscoverGhostex 2026-06-16-02:01:
    The bottom picture strip should keep equal tile widths, centered labels,
    and fixed visual slots so text does not appear scattered over the carousel.
    */
    const thumbnailButtonStyles = sourceBetween(
      sidebarStylesSource,
      ".ghostex-settings-shadcn .discover-ghostex-thumbnail-button {",
      ".ghostex-settings-shadcn .discover-ghostex-thumbnail-title {",
    );
    expect(thumbnailButtonStyles).toContain("grid-template-rows: 2.25rem minmax(0, 7.75rem);");
    expect(thumbnailButtonStyles).toContain("height: 10.5rem;");

    const thumbnailTitleStyles = sourceBetween(
      sidebarStylesSource,
      ".ghostex-settings-shadcn .discover-ghostex-thumbnail-title {",
      ".ghostex-settings-shadcn .discover-ghostex-thumbnail-visual {",
    );
    expect(thumbnailTitleStyles).toContain("align-items: center;");
    expect(thumbnailTitleStyles).toContain("justify-content: center;");
    expect(thumbnailTitleStyles).toContain("text-wrap: balance;");

    const thumbnailImageStyles = sourceBetween(
      sidebarStylesSource,
      ".ghostex-settings-shadcn .discover-ghostex-thumbnail-image {",
      ".ghostex-settings-shadcn .discover-ghostex-thumbnail-icon {",
    );
    expect(thumbnailImageStyles).toContain("object-fit: cover;");
    expect(thumbnailImageStyles).toContain("object-position: top center;");
  });
});
