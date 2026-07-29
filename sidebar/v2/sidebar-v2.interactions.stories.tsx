import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, waitFor, within } from "storybook/test";
import {
  expectMessage,
  findRequiredElement,
} from "../sidebar-app.interactions.helpers";
import type { SidebarStoryArgs } from "../sidebar-story-fixtures";
import {
  getSidebarStoryMessages,
  resetSidebarStoryMessages,
} from "../sidebar-story-harness";
import {
  DEFAULT_SIDEBAR_STORY_ARGS,
  SIDEBAR_STORY_ARG_TYPES,
  SIDEBAR_STORY_DECORATORS,
  renderSidebarStory,
} from "../sidebar-story-meta";
import {
  expectSettingsPatch,
  findSidebarV2Row,
  waitForSidebarV2,
} from "./sidebar-v2.story-helpers";

/*
 * CDXC:SidebarV2 2026-07-29:
 * Interaction coverage for the Inbox sidebar. The assertions are deliberately
 * about MESSAGES, not about local UI state: V2's core promise is that it drives
 * the host through exactly the same commands the classic sidebar sends, so the
 * host can never tell which sidebar the user is running.
 */

const meta = {
  title: "Sidebar/V2 Interactions",
  args: {
    ...DEFAULT_SIDEBAR_STORY_ARGS,
    fixture: "sidebar-v2-inbox",
    sidebarLifecycleCapabilities: "settleAndSnooze",
    sidebarV2Layout: "flat",
    sidebarVersion: "v2",
  },
  argTypes: SIDEBAR_STORY_ARG_TYPES,
  decorators: SIDEBAR_STORY_DECORATORS,
  render: renderSidebarStory,
} satisfies Meta<SidebarStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ActivatesSessionOnClick: Story = {
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    await waitForSidebarV2(storyRoot);
    resetSidebarStoryMessages();

    await step("focus an agent session from its inbox card", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-quick-idle");
      fireEvent.click(row, { detail: 1 });
      await expectMessage({ sessionId: "v2-quick-idle", type: "focusSession" });
    });

    await step("activate a browser session with the same command", async () => {
      resetSidebarStoryMessages();
      const row = await findSidebarV2Row(storyRoot, "v2-ghostex-browser");
      fireEvent.click(row, { detail: 1 });
      await expectMessage({ sessionId: "v2-ghostex-browser", type: "focusSession" });
    });
  },
};

export const FiltersByProjectScope: Story = {
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);
    const body = within(storyRoot);

    await step("open the scope menu with every project plus Quick", async () => {
      fireEvent.click(
        await findRequiredElement(root, ".sidebar-v2-scope-trigger", "scope trigger"),
      );
      await body.findByRole("menuitemradio", { name: /All projects/ });
      await body.findByRole("menuitemradio", { name: /Quick/ });
      await body.findByRole("menuitemradio", { name: /zmx/ });
    });

    /*
     * CDXC:SidebarV2ProjectIcons 2026-07-29:
     * The menu names projects, so it must show the icons the user gave them —
     * an image where there is one, the Tabler glyph where there is one, and the
     * folder ONLY for entries with no project behind them ("All projects").
     */
    await step("carry each project's own icon into the scope menu", async () => {
      const zmxItem = await body.findByRole("menuitemradio", { name: /zmx/ });
      expect(zmxItem.querySelector("img.sidebar-v2-project-icon")).toBeTruthy();
      const ghostexItem = await body.findByRole("menuitemradio", { name: /^ghostex/ });
      expect(
        ghostexItem.querySelector('.sidebar-v2-project-icon[data-icon-variant="tabler"]'),
      ).toBeTruthy();
      const allItem = await body.findByRole("menuitemradio", { name: /All projects/ });
      expect(allItem.querySelector("img.sidebar-v2-project-icon")).toBeNull();
    });

    await step("scope the inbox to a single project", async () => {
      fireEvent.click(await body.findByRole("menuitemradio", { name: /zmx/ }));
      await waitFor(() => {
        expect(root.querySelector('[data-session-id="v2-quick-idle"]')).toBeNull();
      });
      await findSidebarV2Row(storyRoot, "v2-zmx-done");
    });

    await step("show the scoped empty state when a project has no matches", async () => {
      fireEvent.click(
        await findRequiredElement(root, ".sidebar-v2-scope-trigger", "scope trigger"),
      );
      fireEvent.click(await body.findByRole("menuitemradio", { name: /All projects/ }));
      await findSidebarV2Row(storyRoot, "v2-quick-idle");
    });
  },
};

export const TogglesGroupByProject: Story = {
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    await waitForSidebarV2(storyRoot);
    const body = within(storyRoot);
    resetSidebarStoryMessages();

    await step("reach Sort & Filter from the V2 header", async () => {
      const sortAction = await findRequiredElement(
        storyRoot,
        '[data-reference-section="projects"] .reference-sidebar-section-sort-action',
        "Sort & Filter trigger",
      );
      fireEvent.click(sortAction);
      await body.findByRole("menuitemradio", { name: "Inbox sidebar (New)" });
    });

    await step("persist Group by Project through the settings pipeline", async () => {
      fireEvent.click(await body.findByRole("menuitemcheckbox", { name: "Group by Project" }));
      await expectSettingsPatch("sidebarV2Layout", "byProject");
    });
  },
};

/** Sorting is a V1-only concept, so the whole sort radio group leaves the menu
    while the Inbox is active — no lone, no-op radio, and no sort mode in the
    trigger's accessible name. */
export const HidesSortModesWhileTheInboxIsActive: Story = {
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    await waitForSidebarV2(storyRoot);
    const body = within(storyRoot);

    await step("name the trigger after the sidebar, not after a sort order", async () => {
      const sortAction = await findRequiredElement(
        storyRoot,
        '[data-reference-section="projects"] .reference-sidebar-section-sort-action',
        "Sort & Filter trigger",
      );
      expect(sortAction.getAttribute("aria-label")).toBe("Filter sessions: Inbox sidebar");
      fireEvent.click(sortAction);
      await body.findByRole("menuitemradio", { name: "Inbox sidebar (New)" });
    });

    await step("drop both sort radios, not just Manual Sorting", async () => {
      expect(body.queryByRole("menuitemradio", { name: "Manual Sorting" })).toBeNull();
      expect(body.queryByRole("menuitemradio", { name: "Last Active Sorting" })).toBeNull();
    });

    await step("keep the tag filters the inbox does honor", async () => {
      await body.findByRole("menuitemcheckbox", { name: "Favorite" });
    });
  },
};

/** Search filters the inbox exactly as it filters V1 — including the closed
    sessions the user can reopen. */
export const SearchIncludesPreviousSessions: Story = {
  play: async ({ canvasElement, step, userEvent }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);
    const body = within(storyRoot);

    await step("filter the inbox from the shared search row", async () => {
      await userEvent.click(await body.findByRole("button", { name: "Search" }));
      const input = await body.findByRole("textbox", {
        name: "Search current sessions and sessions to reopen",
      });
      await userEvent.click(input);
      await userEvent.keyboard("release");
      await waitFor(() => {
        expect(root.querySelector('[data-session-id="v2-zmx-done"]')).toBeNull();
      });
      await findSidebarV2Row(storyRoot, "v2-quick-idle");
    });

    await step("offer the matching closed sessions below the inbox", async () => {
      const previousGroup = await findRequiredElement(
        storyRoot,
        ".session-search-previous-group",
        "previous sessions result group",
      );
      expect(previousGroup.textContent).toContain("release retro notes");
      expect(previousGroup.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        root.getBoundingClientRect().top,
      );
    });
  },
};

export const RenamesFromTheRow: Story = {
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    await waitForSidebarV2(storyRoot);
    resetSidebarStoryMessages();

    await step("open the inline editor on double click", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-quick-idle");
      fireEvent.doubleClick(row);
      await findRequiredElement(row, ".sidebar-v2-row-rename-input", "rename input");
    });

    await step("commit the rename with the same message the modal posts", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-quick-idle");
      const input = await findRequiredElement(
        row,
        ".sidebar-v2-row-rename-input",
        "rename input",
      );
      fireEvent.change(input, { target: { value: "Renamed from the inbox" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await expectMessage({
        sessionId: "v2-quick-idle",
        title: "Renamed from the inbox",
        type: "renameSession",
      });
    });
  },
};

/*
 * CDXC:SidebarV2Lifecycle 2026-07-29:
 * The lifecycle affordances are asserted through the MESSAGES they post, never
 * through local state, because the UI is deliberately not optimistic: gxserver
 * owns the transition and answers with a presentation delta. A test that
 * asserted "the row moved" would be testing a behavior the client must not have.
 */
export const SettlesAndSnoozesFromHoverActions: Story = {
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);
    const body = within(storyRoot);
    resetSidebarStoryMessages();

    await step("settle an inbox card from its hover check", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-quick-idle");
      fireEvent.click(
        await findRequiredElement(row, '[aria-label="Settle session"]', "settle action"),
      );
      await expectMessage({ sessionId: "v2-quick-idle", type: "settleSession" });
    });

    await step("refuse a second click while the write is unanswered", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-quick-idle");
      const settle = await findRequiredElement(
        row,
        '[aria-label="Settle session"]',
        "settle action",
      );
      expect(settle).toBeDisabled();
    });

    await step("open the snooze presets from the clock button", async () => {
      resetSidebarStoryMessages();
      const row = await findSidebarV2Row(storyRoot, "v2-ghostex-pinned");
      fireEvent.click(
        await findRequiredElement(row, '[aria-label="Snooze session"]', "snooze action"),
      );
      await body.findByRole("menuitem", { name: /In 1 hour/ });
      await body.findByRole("menuitem", { name: /Tomorrow/ });
    });

    await step("snooze with a wake time strictly in the future", async () => {
      const preset = await body.findByRole("menuitem", { name: /Tomorrow/ });
      fireEvent.click(preset);
      await waitFor(() => {
        const message = getSidebarStoryMessages().find(
          (entry) => entry.type === "snoozeSession",
        );
        expect(message).toBeTruthy();
        expect(message).toMatchObject({ sessionId: "v2-ghostex-pinned" });
        const snoozedUntil = (message as { snoozedUntil?: string } | undefined)?.snoozedUntil;
        expect(typeof snoozedUntil).toBe("string");
        expect(Date.parse(snoozedUntil!)).toBeGreaterThan(Date.now());
      });
    });

    await step("un-settle from the settled shelf", async () => {
      resetSidebarStoryMessages();
      const row = await findSidebarV2Row(storyRoot, "v2-ghostex-settled");
      fireEvent.click(
        await findRequiredElement(row, '[aria-label="Un-settle session"]', "un-settle action"),
      );
      await expectMessage({ sessionId: "v2-ghostex-settled", type: "unsettleSession" });
    });

    await step("wake early from the snoozed shelf", async () => {
      resetSidebarStoryMessages();
      fireEvent.click(
        await findRequiredElement(
          root,
          '.sidebar-v2-shelf-header[data-tone="snoozed"]',
          "snoozed shelf header",
        ),
      );
      const row = await findSidebarV2Row(storyRoot, "v2-ghostex-snoozed");
      fireEvent.click(
        await findRequiredElement(row, '[aria-label="Wake session now"]', "wake action"),
      );
      await expectMessage({ sessionId: "v2-ghostex-snoozed", type: "unsnoozeSession" });
    });
  },
};

export const RunsLifecycleContextMenuActions: Story = {
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    await waitForSidebarV2(storyRoot);
    const body = within(storyRoot);
    resetSidebarStoryMessages();

    await step("offer Settle and Snooze on an inbox row", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-quick-idle");
      const bounds = row.getBoundingClientRect();
      fireEvent.contextMenu(row, {
        bubbles: true,
        clientX: bounds.left + 20,
        clientY: bounds.top + 10,
      });
      await body.findByRole("menuitem", { name: "Settle" });
      await body.findByRole("menuitem", { name: "Snooze" });
    });

    await step("expand the Snooze submenu instead of guessing a preset", async () => {
      fireEvent.click(await body.findByRole("menuitem", { name: "Snooze" }));
      const preset = await body.findByRole("menuitem", { name: /Next week/ });
      fireEvent.click(preset);
      await waitFor(() => {
        expect(
          getSidebarStoryMessages().some((entry) => entry.type === "snoozeSession"),
        ).toBe(true);
      });
    });

    await step("offer Un-settle on a settled row", async () => {
      resetSidebarStoryMessages();
      const row = await findSidebarV2Row(storyRoot, "v2-ghostex-settled-manual");
      const bounds = row.getBoundingClientRect();
      fireEvent.contextMenu(row, {
        bubbles: true,
        clientX: bounds.left + 20,
        clientY: bounds.top + 10,
      });
      fireEvent.click(await body.findByRole("menuitem", { name: "Un-settle" }));
      await expectMessage({
        sessionId: "v2-ghostex-settled-manual",
        type: "unsettleSession",
      });
    });
  },
};

/** An older gxserver publishes no capability block: the affordances are absent,
    not disabled, so a click can never reach an endpoint that does not exist. */
export const HidesLifecycleActionsWithoutCapabilities: Story = {
  args: { sidebarLifecycleCapabilities: "absent" },
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);
    const body = within(storyRoot);

    await step("render no settle or snooze hover action", async () => {
      await findSidebarV2Row(storyRoot, "v2-quick-idle");
      expect(root.querySelectorAll('[aria-label="Settle session"]')).toHaveLength(0);
      expect(root.querySelectorAll('[aria-label="Snooze session"]')).toHaveLength(0);
      expect(root.querySelectorAll('[aria-label="Un-settle session"]')).toHaveLength(0);
      expect(root.querySelectorAll('[aria-label="Wake session now"]')).toHaveLength(0);
    });

    await step("leave the lifecycle items out of the context menu", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-quick-idle");
      const bounds = row.getBoundingClientRect();
      fireEvent.contextMenu(row, {
        bubbles: true,
        clientX: bounds.left + 20,
        clientY: bounds.top + 10,
      });
      await body.findByRole("menuitem", { name: "Rename" });
      expect(body.queryByRole("menuitem", { name: "Settle" })).toBeNull();
      expect(body.queryByRole("menuitem", { name: "Snooze" })).toBeNull();
    });
  },
};

export const RunsSessionContextMenuActions: Story = {
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    await waitForSidebarV2(storyRoot);
    const body = within(storyRoot);
    resetSidebarStoryMessages();

    await step("open the session context menu from a right click", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-quick-idle");
      const bounds = row.getBoundingClientRect();
      fireEvent.contextMenu(row, {
        bubbles: true,
        clientX: bounds.left + 20,
        clientY: bounds.top + 10,
      });
      await body.findByRole("menuitem", { name: "Rename" });
    });

    await step("sleep the session through the shared host command", async () => {
      fireEvent.click(await body.findByRole("menuitem", { name: "Sleep" }));
      await expectMessage({
        sessionId: "v2-quick-idle",
        sleeping: true,
        type: "setSessionSleeping",
      });
    });

    await step("pin the session from the hover action slot", async () => {
      resetSidebarStoryMessages();
      const row = await findSidebarV2Row(storyRoot, "v2-quick-idle");
      const pinButton = await findRequiredElement(
        row,
        '[aria-label="Pin session"]',
        "pin action",
      );
      fireEvent.click(pinButton);
      await expectMessage({
        pinned: true,
        sessionId: "v2-quick-idle",
        type: "setSessionPinned",
      });
    });
  },
};

/*
 * CDXC:SidebarV2Git 2026-07-29:
 * The git line is pure presentation — it posts no messages — so this asserts
 * the two things that CAN regress silently: the badge's state (the class hook
 * every color rule keys off) and the absence of a third line for rows with no
 * git data. The latter is the promise that P3 did not make every card taller.
 */
export const RendersPullRequestStateOnCards: Story = {
  args: { sidebarLifecycleCapabilities: "settleSnoozeAndGit" },
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);

    await step("mark each badge with the review state that colors it", async () => {
      const openRow = await findSidebarV2Row(storyRoot, "v2-ghostex-working");
      const openBadge = await findRequiredElement(openRow, ".sidebar-v2-row-pr", "open PR badge");
      expect(openBadge.getAttribute("data-pr-state")).toBe("open");
      expect(openBadge.textContent).toBe("#128");
      expect(openBadge.getAttribute("title")).toBe("#128 · Open");

      const draftRow = await findSidebarV2Row(storyRoot, "v2-zmx-failed");
      const draftBadge = await findRequiredElement(
        draftRow,
        ".sidebar-v2-row-pr",
        "draft PR badge",
      );
      expect(draftBadge.getAttribute("data-pr-state")).toBe("draft");

      const closedRow = await findSidebarV2Row(storyRoot, "v2-zmx-done");
      const closedBadge = await findRequiredElement(
        closedRow,
        ".sidebar-v2-row-pr",
        "closed PR badge",
      );
      expect(closedBadge.getAttribute("data-pr-state")).toBe("closed");

      const mergedRow = await findSidebarV2Row(storyRoot, "v2-ghostex-settled-manual");
      const mergedBadge = await findRequiredElement(
        mergedRow,
        ".sidebar-v2-row-pr",
        "merged PR badge",
      );
      expect(mergedBadge.getAttribute("data-pr-state")).toBe("merged");
    });

    await step("hover text names the branch and the review state", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-ghostex-working");
      const git = await findRequiredElement(row, "[data-sidebar-v2-git]", "git meta line");
      expect(git.getAttribute("title")).toBe(
        "ghostex/sidebar-v2-inbox · #128 · Open · +412 −87",
      );
    });

    await step("give rows without git data no third line at all", async () => {
      for (const sessionId of ["v2-quick-idle", "v2-quick-approval", "v2-ghostex-browser"]) {
        const row = await findSidebarV2Row(storyRoot, sessionId);
        expect(row.querySelector("[data-sidebar-v2-git]")).toBeNull();
        expect(row.querySelector(".sidebar-v2-row-pr")).toBeNull();
      }
      const idleRow = await findSidebarV2Row(storyRoot, "v2-quick-idle");
      expect(idleRow.querySelector('[data-line="meta"]')?.getAttribute("data-meta")).toBe(
        "detail",
      );
      expect(
        idleRow.closest(".sidebar-v2-row-item")?.getAttribute("data-card-lines"),
      ).toBe("3");
    });

    await step("never let the git line steal a row click", async () => {
      resetSidebarStoryMessages();
      const row = await findSidebarV2Row(storyRoot, "v2-ghostex-working");
      const git = await findRequiredElement(row, "[data-sidebar-v2-git]", "git meta line");
      fireEvent.click(git, { bubbles: true, detail: 1 });
      await expectMessage({ sessionId: "v2-ghostex-working", type: "focusSession" });
      expect(root.querySelector(".sidebar-v2-row-rename-input")).toBeNull();
    });
  },
};
