import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const watchModalSource = readFileSync(
  new URL("./watch-ghostex-video-modal.tsx", import.meta.url),
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

describe("watch ghostex video modal source", () => {
  test("copies the highlighted-feature shell but renders one filling Loom video", () => {
    /*
     * CDXC:GhostexTutorialVideo 2026-06-18-04:49:
     * The tutorial video modal should be a one-page copy of the Highlighted
     * Features shell. It must show the supplied video walkthrough, fill the
     * modal below the required title, and remove screenshot carousel behavior.
     *
     * CDXC:GhostexTutorialVideo 2026-06-18-05:35:
     * Third-party video embeds should keep strict-origin-when-cross-origin
     * referrer policy so the native HTTPS modal-host base URL can be used.
     *
     * CDXC:GhostexTutorialVideo 2026-06-18-05:49:
     * The walkthrough should use the editable Loom embed and the exact Ghostty
     * title requested for the single-page video modal.
     */
    expect(watchModalSource).toContain(
      "Please watch this video to understand how to use Ghostty! (1.5x recommended)",
    );
    expect(watchModalSource).toContain(
      "https://www.loom.com/embed/84a08f60871a4c57a589c057335ac25b",
    );
    expect(watchModalSource).toContain(
      "https://www.loom.com/share/84a08f60871a4c57a589c057335ac25b",
    );
    expect(watchModalSource).toContain('frameBorder="0"');
    expect(watchModalSource).toContain('referrerPolicy="strict-origin-when-cross-origin"');
    expect(watchModalSource).not.toContain("youtube");
    expect(watchModalSource).not.toContain("YouTube");
    expect(watchModalSource).not.toContain("Fnd1rwn0Ow4");
    expect(watchModalSource).toContain("disablePointerDismissal");
    expect(watchModalSource).toContain("showCloseButton={false}");
    expect(watchModalSource).toContain('aria-label="Close Ghostty tutorial video"');
    expect(watchModalSource).toContain("watch-ghostex-video-modal-dialog");
    expect(watchModalSource).toContain("watch-ghostex-video-frame");
    expect(watchModalSource).toContain("allowFullScreen");
    expect(watchModalSource).not.toContain("<img");
    expect(watchModalSource).not.toContain("IconChevronLeft");
    expect(watchModalSource).not.toContain("IconChevronRight");
    expect(watchModalSource).not.toContain("DISCOVER_GHOSTEX_FEATURES");
    expect(watchModalSource).not.toContain("ghostex-rich-prompt-editor-ctrl-g.png");

    const videoVisualStyles = sourceBetween(
      sidebarStylesSource,
      ".ghostex-settings-shadcn .watch-ghostex-video-visual {",
      ".ghostex-settings-shadcn .watch-ghostex-video-frame {",
    );
    expect(videoVisualStyles).toContain("align-items: stretch;");
    expect(videoVisualStyles).toContain("grid-template-columns: minmax(0, 1fr);");

    const videoFrameStyles = sourceBetween(
      sidebarStylesSource,
      ".ghostex-settings-shadcn .watch-ghostex-video-frame {",
      ".ghostex-settings-shadcn .discover-ghostex-feature-image {",
    );
    expect(videoFrameStyles).toContain("height: calc(100% - 1px);");
    expect(videoFrameStyles).toContain("width: calc(100% - 1px);");
    expect(videoFrameStyles).toContain("border-radius: var(--settings-radius-section);");
    expect(videoFrameStyles).toContain("box-shadow: 0 0 0 0.5px");
  });
});
