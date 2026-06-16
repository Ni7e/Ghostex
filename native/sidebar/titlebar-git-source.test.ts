import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const titlebarHostSource = readFileSync(new URL("./titlebar-host.tsx", import.meta.url), "utf8");
const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");

describe("native titlebar Git source", () => {
  test("labels Git metadata rows before their values in the titlebar Git menu", () => {
    /*
     * CDXC:TitlebarGit 2026-06-16-13:31:
     * macOS titlebar Git metadata rows must put Branch:, Lines:, and Commits:
     * before their values, with inherited row typography so these labels match
     * the surrounding menu text.
     */
    expect(titlebarHostSource).toContain("CDXC:TitlebarGit 2026-06-16-13:31:");
    expect(titlebarHostSource).toContain('<span className="titlebar-git-meta-label">Branch:</span>');
    expect(titlebarHostSource).toMatch(
      /\.titlebar-git-stat-pair \{\s*align-items: center;\s*display: inline-flex;\s*gap: 6px;/,
    );
    expect(titlebarHostSource).toMatch(
      /\.titlebar-git-stat \{\s*font: inherit;\s*min-width: 38px;\s*text-align: left;\s*\}/,
    );
    expect(titlebarHostSource).not.toMatch(
      /\.titlebar-git-stat \{\s*font: inherit;\s*min-width: 42px;\s*text-align: right;\s*\}/,
    );
    expect(titlebarHostSource).toMatch(
      /<TitlebarGitStatPair\s+firstCount=\{git\.additions\}\s+label="Lines"\s+secondCount=\{git\.deletions\}\s+\/>/,
    );
    expect(titlebarHostSource).toMatch(
      /<span className="titlebar-git-meta-label">\{label\}:<\/span>\s*<span className=\{firstStatClassName\}>/,
    );
    expect(titlebarHostSource).toMatch(
      /\.titlebar-git-meta-label \{\s*color: var\(--titlebar-git-value-color\);\s*font: inherit;/,
    );
    expect(titlebarHostSource).not.toContain("titlebar-git-stat-label");
  });

  test("uses neutral arrow commit stats for remote sync", () => {
    /*
     * CDXC:TitlebarGit 2026-06-16-13:31:
     * The titlebar remote-sync row should visually match the changed-line stats
     * row spacing while using neutral down/up arrows, a Commits prefix label,
     * no slash divider, and the direct remote push/pull action.
     */
    expect(titlebarHostSource).toMatch(
      /<TitlebarGitStatPair\s+firstCount=\{git\.behindCount\}\s+firstPrefix="↓"\s+label="Commits"\s+secondCount=\{git\.aheadCount\}\s+secondPrefix="↑"\s+tone="commits"\s+\/>/,
    );
    expect(titlebarHostSource).toContain('data-tone={tone}');
    expect(titlebarHostSource).toMatch(
      /\.titlebar-git-stat-pair\[data-tone="commits"\] \.titlebar-git-stat \{\s*color: var\(--titlebar-git-value-color\);/,
    );
    expect(titlebarHostSource).toContain('onRunGitAction("syncRemote")');
    expect(titlebarHostSource).not.toContain("titlebarGitSyncMainLabel");
    expect(titlebarHostSource).not.toContain(" / +");
  });

  test("runs remote sync through fast-forward pull and push", () => {
    /*
     * CDXC:TitlebarGit 2026-06-16-07:31:
     * Clicking the titlebar sync row must pull from the upstream with
     * fast-forward-only semantics, then push remaining ahead commits through the
     * existing branch push helper.
     */
    expect(nativeSidebarSource).toContain('if (action === "syncRemote")');
    expect(nativeSidebarSource).toContain('action: "pullFastForward"');
    expect(nativeSidebarSource).toContain("await pushCurrentBranch();");
    expect(nativeSidebarSource).toContain("async function syncCurrentBranchWithRemote()");
  });
});
