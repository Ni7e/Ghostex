import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import {
  formatProjectEditorDiffStatsLabel,
  formatProjectTooltipGitStats,
  getEmptyProjectNewSessionButtonLabel,
  getGroupContextMenuItemCount,
  getPinnedSessionDropGapKey,
  PINNED_SESSION_DROP_GAP_AFTER_LAST,
  shouldPreventGroupDragActivation,
  shouldTreatProjectAsEmptySessionGroup,
  shouldShowOpenProjectFolderIcon,
  shouldShowProjectEditorDiffStats,
} from "./session-group-section";

const sessionGroupSectionSource = readFileSync(
  new URL("./session-group-section.tsx", import.meta.url),
  "utf8",
);

const originalElement = globalThis.Element;
const hadOriginalElement = "Element" in globalThis;

class FakeElement extends EventTarget {
  public readonly children: FakeElement[] = [];
  public readonly attributes = new Map<string, string>();
  public readonly classNames = new Set<string>();
  public parentElement: FakeElement | undefined;

  constructor(public readonly tagName: string) {
    super();
  }

  public append(...children: FakeElement[]): void {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  public addClass(className: string): void {
    this.classNames.add(className);
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public contains(target: FakeElement | null): boolean {
    let current = target;
    while (current) {
      if (current === this) {
        return true;
      }
      current = current.parentElement ?? null;
    }
    return false;
  }

  public closest(selector: string): FakeElement | null {
    let current: FakeElement | undefined = this;
    while (current) {
      if (matchesGroupDragSelector(current, selector)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }
}

beforeAll(() => {
  Object.defineProperty(globalThis, "Element", {
    configurable: true,
    value: FakeElement,
  });
});

afterAll(() => {
  if (!hadOriginalElement) {
    delete (globalThis as { Element?: typeof Element }).Element;
    return;
  }

  Object.defineProperty(globalThis, "Element", {
    configurable: true,
    value: originalElement,
  });
});

function createFakeElement(tagName: string, className?: string): FakeElement {
  const element = new FakeElement(tagName);
  if (className) {
    element.addClass(className);
  }
  return element;
}

function matchesGroupDragSelector(element: FakeElement, selector: string): boolean {
  return selector
    .split(",")
    .map((part) => part.trim())
    .some((part) => {
      if (part.startsWith(".")) {
        return element.classNames.has(part.slice(1));
      }
      if (part === "[contenteditable='true']") {
        return element.attributes.get("contenteditable") === "true";
      }
      return element.tagName.toLowerCase() === part;
    });
}

describe("shouldTreatProjectAsEmptySessionGroup", () => {
  test("identifies an empty project group so it can render a new-session row", () => {
    expect(
      shouldTreatProjectAsEmptySessionGroup({
        hasProjectContext: true,
        sessionCount: 0,
      }),
    ).toBe(true);
  });

  test("does not treat non-project or non-empty groups as empty project groups", () => {
    expect(
      shouldTreatProjectAsEmptySessionGroup({
        hasProjectContext: false,
        sessionCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldTreatProjectAsEmptySessionGroup({
        hasProjectContext: true,
        sessionCount: 1,
      }),
    ).toBe(false);
  });
});

describe("empty project new-session row", () => {
  test("uses the requested visible button label", () => {
    expect(getEmptyProjectNewSessionButtonLabel()).toBe("New Session");
  });

  test("renders as a sleeping session-shaped button without a last-active timestamp", () => {
    /*
     * CDXC:ProjectGroups 2026-06-15-20:14:
     * Closing the last terminal leaves an empty project row. Source coverage
     * keeps that row session-shaped, timestamp-free, and wired to create a new
     * terminal instead of restoring the closed session.
     */
    const rowStart = sessionGroupSectionSource.indexOf(
      'data-empty-project-new-session-row="true"',
    );
    expect(rowStart).toBeGreaterThan(-1);
    const rowSource = sessionGroupSectionSource.slice(
      Math.max(0, rowStart - 600),
      rowStart + 1400,
    );

    expect(rowSource).toContain("group-empty-project-session-button");
    expect(rowSource).toContain('data-sleeping="true"');
    expect(rowSource).toContain('data-title-full-width="true"');
    expect(rowSource).toContain("getEmptyProjectNewSessionButtonLabel()");
    expect(rowSource).toContain("requestCreateProjectTerminal();");
    expect(rowSource).not.toContain("session-last-interaction-time");
  });
});

describe("shouldShowOpenProjectFolderIcon", () => {
  test("shows the open folder for empty expanded project rows", () => {
    /*
     * CDXC:ProjectHeaders 2026-06-16-02:27:
     * Empty expanded projects still have a visible body because they render the
     * New Session row, so the folder icon should show open even when the
     * project has no terminal sessions.
     */
    expect(
      shouldShowOpenProjectFolderIcon({
        isCollapsed: false,
        sessionCount: 0,
      }),
    ).toBe(true);
  });

  test("uses collapsed state for project folder icons regardless of sessions", () => {
    expect(
      shouldShowOpenProjectFolderIcon({
        isCollapsed: false,
        sessionCount: 1,
      }),
    ).toBe(true);
    expect(
      shouldShowOpenProjectFolderIcon({
        isCollapsed: true,
        sessionCount: 1,
      }),
    ).toBe(false);
  });
});

describe("formatProjectEditorDiffStatsLabel", () => {
  test("formats the compact changed-lines summary by default", () => {
    expect(
      formatProjectEditorDiffStatsLabel({
        additions: 9,
        deletions: 11,
        files: 1,
        isLoading: false,
        isRepo: true,
      }),
    ).toBe("+9 -11");
  });

  test("caps the compact project diff counts for stable sidebar width", () => {
    expect(
      formatProjectEditorDiffStatsLabel({
        additions: 12000,
        deletions: 10001,
        files: 120,
        isLoading: false,
        isRepo: true,
      }),
    ).toBe("+9999 -9999");
  });

  test("includes the capped file count when enabled", () => {
    expect(
      formatProjectEditorDiffStatsLabel(
        {
          additions: 12000,
          deletions: 10001,
          files: 120,
          isLoading: false,
          isRepo: true,
        },
        true,
      ),
    ).toBe("99 +9999 -9999");
  });
});

describe("formatProjectTooltipGitStats", () => {
  test("pluralizes changed files and changed lines in project and worktree tooltips", () => {
    expect(
      formatProjectTooltipGitStats({
        additions: 2,
        deletions: 6,
        files: 2,
        isLoading: false,
        isRepo: true,
      }),
    ).toBe("2 files changed  +2  -6 lines");
  });

  test("uses singular copy for one changed file and one added line", () => {
    expect(
      formatProjectTooltipGitStats({
        additions: 1,
        deletions: 0,
        files: 1,
        isLoading: false,
        isRepo: true,
      }),
    ).toBe("1 file changed  +1  -0 line");
  });

  test("uses singular line copy when the only changed line is a deletion", () => {
    expect(
      formatProjectTooltipGitStats({
        additions: 0,
        deletions: 1,
        files: 4,
        isLoading: false,
        isRepo: true,
      }),
    ).toBe("4 files changed  +0  -1 line");
  });
});

describe("shouldShowProjectEditorDiffStats", () => {
  test("hides the project git status when additions and deletions are both zero", () => {
    expect(
      shouldShowProjectEditorDiffStats({
        additions: 0,
        deletions: 0,
        files: 0,
        isLoading: false,
        isRepo: true,
      }),
    ).toBe(false);
  });

  test("shows the project git status when additions are nonzero", () => {
    expect(
      shouldShowProjectEditorDiffStats({
        additions: 1,
        deletions: 0,
        files: 1,
        isLoading: false,
        isRepo: true,
      }),
    ).toBe(true);
  });

  test("shows the project git status when deletions are nonzero", () => {
    expect(
      shouldShowProjectEditorDiffStats({
        additions: 0,
        deletions: 1,
        files: 1,
        isLoading: false,
        isRepo: true,
      }),
    ).toBe(true);
  });
});

describe("getGroupContextMenuItemCount", () => {
  test("counts compact worktree project actions with copy path instead of open", () => {
    expect(
      getGroupContextMenuItemCount({
        canFullReloadGroup: true,
        hasProjectContext: true,
        isWorktreeProject: true,
      }),
    ).toBe(5);
  });

  test("counts normal project and group actions separately", () => {
    expect(
      getGroupContextMenuItemCount({
        canFullReloadGroup: true,
        hasProjectContext: true,
        isWorktreeProject: false,
      }),
    ).toBe(6);
    expect(
      getGroupContextMenuItemCount({
        canFullReloadGroup: false,
        hasProjectContext: false,
        isWorktreeProject: false,
      }),
    ).toBe(3);
  });
});

describe("shouldPreventGroupDragActivation", () => {
  test("allows drag activation from the project header surface and title", () => {
    const header = createFakeElement("div", "group-head");
    const titleButton = createFakeElement("button", "group-title-button");
    const titleText = createFakeElement("span", "group-title");
    const spacer = createFakeElement("div", "group-title-spacer");
    titleButton.append(titleText);
    header.append(titleButton, spacer);

    expect(
      shouldPreventGroupDragActivation(
        titleText as unknown as EventTarget,
        header as unknown as Element,
      ),
    ).toBe(false);
    expect(
      shouldPreventGroupDragActivation(
        spacer as unknown as EventTarget,
        header as unknown as Element,
      ),
    ).toBe(false);
  });

  test("keeps project header controls out of drag activation", () => {
    const header = createFakeElement("div", "group-head");
    const actionCluster = createFakeElement("div", "group-header-actions");
    const actionButton = createFakeElement("button", "group-add-button");
    const titleInput = createFakeElement("input", "group-title-input");
    actionCluster.append(actionButton);
    header.append(actionCluster, titleInput);

    expect(
      shouldPreventGroupDragActivation(
        actionButton as unknown as EventTarget,
        header as unknown as Element,
      ),
    ).toBe(true);
    expect(
      shouldPreventGroupDragActivation(
        titleInput as unknown as EventTarget,
        header as unknown as Element,
      ),
    ).toBe(true);
  });

  test("ignores blocked-looking targets outside the drag surface", () => {
    const header = createFakeElement("div", "group-head");
    const externalActionCluster = createFakeElement("div", "group-header-actions");
    const externalActionButton = createFakeElement("button", "group-add-button");
    externalActionCluster.append(externalActionButton);

    expect(
      shouldPreventGroupDragActivation(
        externalActionButton as unknown as EventTarget,
        header as unknown as Element,
      ),
    ).toBe(false);
  });
});

describe("getPinnedSessionDropGapKey", () => {
  const visibleSessionIds = ["first", "second", "third"];

  test("maps before the first pinned target to the first visible gap", () => {
    expect(
      getPinnedSessionDropGapKey({
        dropTarget: {
          groupId: "project",
          kind: "session",
          position: "before",
          sessionId: "first",
        },
        groupId: "project",
        visibleSessionIds,
      }),
    ).toBe("before:first");
  });

  test("maps after a row to the next visible gap instead of a row pseudo-element", () => {
    expect(
      getPinnedSessionDropGapKey({
        dropTarget: {
          groupId: "project",
          kind: "session",
          position: "after",
          sessionId: "first",
        },
        groupId: "project",
        visibleSessionIds,
      }),
    ).toBe("before:second");
  });

  test("maps after the final row to the stable trailing gap", () => {
    expect(
      getPinnedSessionDropGapKey({
        dropTarget: {
          groupId: "project",
          kind: "session",
          position: "after",
          sessionId: "third",
        },
        groupId: "project",
        visibleSessionIds,
      }),
    ).toBe(PINNED_SESSION_DROP_GAP_AFTER_LAST);
  });

  test("ignores targets for another group", () => {
    expect(
      getPinnedSessionDropGapKey({
        dropTarget: {
          groupId: "other",
          kind: "session",
          position: "before",
          sessionId: "first",
        },
        groupId: "project",
        visibleSessionIds,
      }),
    ).toBeUndefined();
  });
});
