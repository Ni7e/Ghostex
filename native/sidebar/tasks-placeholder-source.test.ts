import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const tasksPlaceholderSource = readFileSync(new URL("./tasks-placeholder.tsx", import.meta.url), "utf8");

function sourceBetween(start: string, end: string): string {
  const startIndex = tasksPlaceholderSource.indexOf(start);
  const endIndex = tasksPlaceholderSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return tasksPlaceholderSource.slice(startIndex, endIndex);
}

function collectFunctionalUpdaterCalls(source: string, setterCallStart: string): string[] {
  const calls: string[] = [];
  let searchIndex = 0;
  while (searchIndex < source.length) {
    const startIndex = source.indexOf(setterCallStart, searchIndex);
    if (startIndex === -1) {
      break;
    }
    const openParenIndex = source.indexOf("(", startIndex);
    expect(openParenIndex).toBeGreaterThan(startIndex);
    let depth = 0;
    let endIndex = openParenIndex;
    for (; endIndex < source.length; endIndex += 1) {
      const char = source[endIndex];
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          endIndex += 1;
          break;
        }
      }
    }
    expect(depth).toBe(0);
    calls.push(source.slice(startIndex, endIndex));
    searchIndex = endIndex;
  }
  return calls;
}

describe("Project Board form event handling", () => {
  test("keeps Kanban swimlanes adjacent with a single separator", () => {
    /*
     * CDXC:ProjectBoardLanes 2026-06-19-09:59:
     * Kanban swimlanes should remove horizontal gutters to give cards more width while avoiding doubled borders where lanes touch.
     */
    const laneLayoutSource = sourceBetween(".project-board-lanes {", ".project-board-lane-header");

    expect(laneLayoutSource).toContain("gap: 0;");
    expect(laneLayoutSource).toContain(".project-board-lane + .project-board-lane");
    expect(laneLayoutSource).toContain("border-left-width: 0;");
  });

  test("uses brighter Kanban bead card surfaces than lane panels", () => {
    /*
     * CDXC:ProjectBoardCards 2026-06-19-09:14:
     * Kanban cards should stand out from the macOS Project board lanes before hover, so the card background token must stay visibly brighter than the lane panel token.
     */
    const variableSource = sourceBetween(":root {", "* { box-sizing: border-box; }");

    expect(variableSource).toContain("--project-board-panel: #171717;");
    expect(variableSource).toContain("--project-board-card: #242424;");
    expect(variableSource).toContain("--project-board-card-hover: #2b2b2b;");
  });

  test("prevents accidental text selection inside Kanban bead cards", () => {
    /*
     * CDXC:ProjectBoardCards 2026-06-13-13:55:
     * Kanban bead cards are draggable and right-clickable, so card text should not be user-selectable by accidental pointer movement.
     */
    const cardStyleSource = sourceBetween(".project-board-card {", ".project-board-card:hover");

    expect(cardStyleSource).toContain("user-select: none;");
  });

  test("renders Kanban bead context-menu Start work and Delete actions", () => {
    /*
     * CDXC:ProjectBoard 2026-06-13-13:37:
     * Right-clicking a Kanban bead card should expose Start work and Delete in the card context menu while reusing the existing ticket start/delete handlers.
     */
    const projectBoardSource = sourceBetween("function ProjectBoardApp()", "function TicketMetaFields(");
    const ticketCardSource = sourceBetween("function TicketCard(", "function ProjectBoardTicketContextMenu(");
    const contextMenuSource = sourceBetween("function ProjectBoardTicketContextMenu(", "function AutomationEmptyState(");

    expect(ticketCardSource).toContain("onContextMenu={(event) =>");
    expect(ticketCardSource).toContain("onOpenContextMenu(ticket");
    expect(projectBoardSource).toContain("void startTicketWork(contextMenuTicket)");
    expect(projectBoardSource).toContain("void deleteTicket(contextMenuTicket)");
    expect(projectBoardSource).toContain('"Start work"');
    expect(contextMenuSource).toContain('"Delete"');
  });

  test("reports sanitized focus-owner events for native Kanban focus arbitration", () => {
    /*
     * CDXC:ProjectBoardFocus 2026-06-12-08:44:
     * Kanban typing focus must notify native with event categories only so focus arbitration can protect board input without recording user text, paths, URLs, ticket titles, or command content.
     */
    const focusOwnerSource = sourceBetween(
      "function postProjectBoardFocusOwnerChanged",
      "function createEmptyDetailDraft()",
    );
    const focusEffectSource = sourceBetween(
      "useEffect(() => {\n    let lastPostedAt = 0;",
      "  const openNewTicket = useCallback",
    );

    expect(focusOwnerSource).toContain('action: "projectEditorFocusOwnerChanged"');
    expect(focusOwnerSource).toContain("event,");
    expect(focusOwnerSource).toContain("projectEditorId,");
    expect(focusOwnerSource).toContain("projectId,");
    expect(focusOwnerSource).not.toContain("projectPath");
    expect(focusOwnerSource).not.toContain("details");
    expect(focusOwnerSource).not.toContain("ticketTitle");
    expect(focusEffectSource).toContain('window.addEventListener("pointerdown", handlePointerDown, true)');
    expect(focusEffectSource).toContain('window.addEventListener("focusin", handleFocusIn, true)');
    expect(focusEffectSource).toContain('window.addEventListener("keydown", handleKeyDown, true)');
    expect(focusEffectSource).toContain('postFocusOwnerChanged("keydown", event.target)');
    expect(focusEffectSource).toContain('event !== "pointerdown" && !isProjectBoardEditableFocusTarget(target)');
  });

  test("snapshots form values before functional state updaters", () => {
    /*
     * CDXC:ProjectBoardForms 2026-06-09-15:36:
     * New automation and ticket text entry should keep the Kanban page mounted even when React defers functional state updaters.
     * Updater closures must use already-captured primitives instead of reading value or checked from the React event object.
     */
    const projectBoardSource = sourceBetween("function ProjectBoardApp()", "function TicketMetaFields(");
    const updaterCalls = [
      ...collectFunctionalUpdaterCalls(projectBoardSource, "setAutomationDraft((current) =>"),
      ...collectFunctionalUpdaterCalls(projectBoardSource, "setDetail((current) =>"),
      ...collectFunctionalUpdaterCalls(projectBoardSource, "setNewTicket((current) =>"),
    ];

    expect(updaterCalls).not.toHaveLength(0);
    expect(
      updaterCalls.filter((call) => /event\.(?:currentTarget|target)\.(?:checked|value)/u.test(call)),
    ).toEqual([]);
  });
});
