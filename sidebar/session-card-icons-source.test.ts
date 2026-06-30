import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const sessionCardsCssSource = readFileSync(
  new URL("./styles/session-cards.css", import.meta.url),
  "utf8",
);

describe("session card icon source", () => {
  test("keeps tagged session leading icons mutually exclusive", () => {
    /*
     * CDXC:SidebarSessionAgentIcons 2026-06-30-00:12:
     * Tagged rows render both the tag glyph and the hidden agent glyph so hover
     * can swap identities without layout churn. CSS must keep the tag colored
     * and hide the underlying agent at rest, then hide the tag on hover/focus.
     */
    expect(sessionCardsCssSource).toContain(
      '.session-tag-colored-icon[data-session-tag="favorite"],\n.session-tag-agent-icon[data-session-tag="favorite"]',
    );
    expect(sessionCardsCssSource).toContain(
      '.session-frame[data-tagged="true"]:not(:hover):not(:has(.session:hover)):not(',
    );
    expect(sessionCardsCssSource).toContain(".session-floating-agent-icon,");
    expect(sessionCardsCssSource).toContain(".session-floating-agent-tabler-icon[data-agent-icon],");
    expect(sessionCardsCssSource).toContain(
      '.session-persistence-provider-badge[data-slot="floating"]',
    );
    expect(sessionCardsCssSource).toContain(
      "Tagged session rows have one leading slot. At rest, including when the row",
    );
    expect(sessionCardsCssSource).toContain(".session-frame[data-tagged=\"true\"]:is(");
    expect(sessionCardsCssSource).toContain(".session-tag-agent-icon");
    expect(sessionCardsCssSource).toContain("opacity: 0 !important;");
  });
});
