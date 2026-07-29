import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, waitFor } from "storybook/test";
import type { SidebarStoryArgs } from "../sidebar-story-fixtures";
import { resetSidebarStoryMessages } from "../sidebar-story-harness";
import {
  DEFAULT_SIDEBAR_STORY_ARGS,
  SIDEBAR_STORY_ARG_TYPES,
  SIDEBAR_STORY_DECORATORS,
  renderSidebarStory,
} from "../sidebar-story-meta";
import {
  expectProjectGroupingOverridePatch,
  findSidebarV2Row,
  waitForSidebarV2,
} from "./sidebar-v2.story-helpers";

/*
 * CDXC:SidebarV2LogicalProjects 2026-07-29:
 * Cross-machine logical projects. The fixture puts ONE repository in three
 * physical places — this Mac, a second local clone, and a remote "Build Box" —
 * plus a non-git project that must never merge with anything.
 *
 * These stories run against the real `SidebarApp` through the shared harness,
 * so the merge they show is produced by the same projection, settings pipeline,
 * and view model the app runs. A standalone mount of the V2 tree could not
 * prove that the grouping override actually round-trips through settings.
 */

const LOCAL_OVERRIDE_KEY = "local:/Users/story/dev/ghostex";
const LOCAL_COPY_OVERRIDE_KEY = "local:/Users/story/dev/ghostex-review";
const REMOTE_OVERRIDE_KEY = "build-box:/home/build/src/ghostex-main";

/*
 * CDXC:SidebarV2LogicalProjects 2026-07-29 (P5 fix round):
 * The monorepo fixture's three checkouts: two sub-directories of one repository
 * on this Mac, and the same `apps/web` sub-directory on a remote machine.
 */
const MONO_WEB_OVERRIDE_KEY = "local:/Users/story/dev/mono/apps/web";
const MONO_API_OVERRIDE_KEY = "local:/Users/story/dev/mono/services/api";
const MONO_REMOTE_WEB_OVERRIDE_KEY = "build-box:/home/build/mono/apps/web";

const meta = {
  title: "Sidebar/V2 Logical Projects",
  args: {
    ...DEFAULT_SIDEBAR_STORY_ARGS,
    fixture: "sidebar-v2-multi-machine",
    sidebarLifecycleCapabilities: "settleSnoozeGitAndWorktree",
    sidebarV2Layout: "byProject",
    sidebarVersion: "v2",
  },
  argTypes: SIDEBAR_STORY_ARG_TYPES,
  decorators: SIDEBAR_STORY_DECORATORS,
  render: renderSidebarStory,
} satisfies Meta<SidebarStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

async function groupIds(root: HTMLElement): Promise<string[]> {
  return [...root.querySelectorAll("[data-sidebar-v2-group-id]")].map(
    (element) => element.getAttribute("data-sidebar-v2-group-id") ?? "",
  );
}

function groupTitles(root: HTMLElement): string[] {
  return [...root.querySelectorAll(".sidebar-v2-group-title")].map(
    (element) => element.textContent ?? "",
  );
}

/**
 * Opens a project group's grouping submenu and clicks one of its three options.
 * Every override story goes through the real menu rather than a seeded setting
 * where the CHANGE is what is under test.
 */
async function chooseGroupingMode(
  storyRoot: ParentNode,
  groupId: string,
  option: "Repository" | "Repository + path" | "Keep separate",
): Promise<void> {
  const header = (storyRoot as ParentNode).querySelector<HTMLElement>(
    `[data-sidebar-v2-group-id="${groupId}"] .sidebar-v2-group-header-row`,
  );
  expect(header).toBeTruthy();
  fireEvent.contextMenu(header!, { clientX: 40, clientY: 80 });
  await waitFor(() => {
    expect(storyRoot.querySelector(".sidebar-v2-session-context-menu")).toBeTruthy();
  });
  fireEvent.click(
    storyRoot.querySelector<HTMLElement>(
      ".sidebar-v2-session-context-menu .session-context-menu-item",
    )!,
  );
  await waitFor(() => {
    expect(storyRoot.querySelectorAll(".sidebar-v2-context-submenu-item").length).toBe(3);
  });
  const chosen = [
    ...storyRoot.querySelectorAll<HTMLElement>(".sidebar-v2-context-submenu-item"),
  ].find((item) => item.textContent === option);
  expect(chosen).toBeTruthy();
  fireEvent.click(chosen!);
}

/**
 * The headline: three checkouts of one repository read as ONE collapsible
 * project, titled by the shared repository name, with the non-git project left
 * on its own.
 */
export const MergesOneRepositoryAcrossMachines: Story = {
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);

    await step("collapse three checkouts into one group, keeping notes apart", async () => {
      await waitFor(async () => {
        expect(await groupIds(root)).toEqual(["v2-mm-local", "v2-mm-notes"]);
      });
      const merged = root.querySelector<HTMLElement>(
        '[data-sidebar-v2-group-id="v2-mm-local"]',
      );
      expect(
        merged!.querySelector(".sidebar-v2-group-header")?.getAttribute(
          "data-sidebar-v2-group-merged",
        ),
      ).toBe("true");
    });

    await step("title the merged group by the shared repository, not one member", async () => {
      const title = root.querySelector<HTMLElement>(
        '[data-sidebar-v2-group-id="v2-mm-local"] .sidebar-v2-group-title',
      );
      expect(title?.textContent).toBe("ghostex/ghostex");
    });

    await step("count every member's sessions on the merged header", async () => {
      const count = root.querySelector<HTMLElement>(
        '[data-sidebar-v2-group-id="v2-mm-local"] .sidebar-v2-group-count',
      );
      // 2 local + 2 remote + 1 second-clone.
      expect(count?.textContent).toBe("5");
    });

    await step("leave the non-git project unmerged and unmergeable", async () => {
      const notes = root.querySelector<HTMLElement>(
        '[data-sidebar-v2-group-id="v2-mm-notes"] .sidebar-v2-group-title',
      );
      expect(notes?.textContent).toBe("notes");
      expect(
        root.querySelector<HTMLElement>(
          '[data-sidebar-v2-group-id="v2-mm-notes"] .sidebar-v2-group-header',
        )?.getAttribute("data-sidebar-v2-group-merged"),
      ).toBe("false");
    });

    await step("render rows from both machines inside the one group", async () => {
      const merged = root.querySelector<HTMLElement>(
        '[data-sidebar-v2-group-id="v2-mm-local"]',
      );
      const rowIds = [...merged!.querySelectorAll(".sidebar-v2-row[data-session-id]")].map(
        (element) => element.getAttribute("data-session-id"),
      );
      expect(rowIds).toContain("v2-mm-local-working");
      expect(rowIds).toContain("v2-mm-remote-active");
      expect(rowIds).toContain("v2-mm-local-copy-review");
    });
  },
};

/**
 * Inside a merged group the only thing telling two rows apart is the machine
 * badge, so it has to be present on every remote row and absent on every local
 * one — a badge on a local row would read as "somewhere else" for the machine
 * the user is sitting at.
 */
export const BadgesRemoteRowsOnly: Story = {
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    await waitForSidebarV2(storyRoot);

    await step("badge a remote row with its machine name", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-mm-remote-active");
      const badge = row.querySelector<HTMLElement>("[data-sidebar-v2-machine]");
      expect(badge?.textContent).toContain("Build Box");
    });

    await step("leave local rows unbadged, on both local checkouts", async () => {
      for (const sessionId of ["v2-mm-local-working", "v2-mm-local-copy-review"]) {
        const row = await findSidebarV2Row(storyRoot, sessionId);
        expect(row.querySelector("[data-sidebar-v2-machine]")).toBeNull();
      }
    });
  },
};

/**
 * The recorded P2 minor, pinned: two sessions idle for exactly the same five
 * days, on machines whose daemons state different windows. The local machine
 * settles at three days, Build Box at thirty — so ONE of them parks and the
 * other must stay in the inbox.
 */
export const PartitionsEachMachineWithItsOwnWindow: Story = {
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);

    await step("park the local five-day-idle session on the Settled shelf", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-mm-local-idle");
      expect(row.getAttribute("data-variant")).toBe("slim");
      expect(
        row.closest("[data-sidebar-v2-group-id]")?.getAttribute("data-sidebar-v2-group-id"),
      ).toBe("v2-mm-local");
    });

    await step("keep the remote five-day-idle session in the inbox", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-mm-remote-idle");
      expect(row.getAttribute("data-variant")).toBe("card");
      expect(row.querySelector("[data-sidebar-v2-machine]")?.textContent).toContain("Build Box");
    });

    await step("state the shelf holds exactly the one local row", async () => {
      const shelf = root.querySelector<HTMLElement>(
        '[data-sidebar-v2-group-id="v2-mm-local"] .sidebar-v2-shelf-header[data-tone="settled"]',
      );
      expect(shelf).toBeTruthy();
      const settledRows = [
        ...root.querySelectorAll('.sidebar-v2-row[data-variant="slim"][data-session-id]'),
      ].map((element) => element.getAttribute("data-session-id"));
      expect(settledRows).toEqual(["v2-mm-local-idle"]);
    });
  },
};

/**
 * The scope filter lists LOGICAL projects. Offering the user two entries that
 * the grouped view already shows as one thing would make the two modes
 * disagree about how many projects exist.
 */
export const ScopeFilterListsLogicalProjects: Story = {
  args: { sidebarV2Layout: "flat" },
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);

    await step("offer one entry per logical project", async () => {
      fireEvent.click(root.querySelector<HTMLElement>(".sidebar-v2-scope-trigger")!);
      await waitFor(() => {
        expect(
          storyRoot.querySelectorAll(".sidebar-v2-scope-menu .sidebar-v2-scope-menu-item").length,
        ).toBeGreaterThan(0);
      });
      const labels = [
        ...storyRoot.querySelectorAll(".sidebar-v2-scope-menu .sidebar-v2-scope-menu-label"),
      ].map((element) => element.textContent);
      expect(labels).toEqual(["All projects", "ghostex/ghostex", "notes"]);
    });

    await step("count every machine's sessions under the merged entry", async () => {
      const counts = [
        ...storyRoot.querySelectorAll(".sidebar-v2-scope-menu .sidebar-v2-scope-menu-count"),
      ].map((element) => element.textContent);
      expect(counts).toEqual(["6", "5", "1"]);
    });

    await step("scope to the merged project and keep BOTH machines' rows", async () => {
      const items = [
        ...storyRoot.querySelectorAll<HTMLElement>(
          ".sidebar-v2-scope-menu .sidebar-v2-scope-menu-item",
        ),
      ];
      fireEvent.click(items[1]!);
      await findSidebarV2Row(storyRoot, "v2-mm-local-working");
      await findSidebarV2Row(storyRoot, "v2-mm-remote-active");
      await waitFor(() => {
        expect(root.querySelector('[data-session-id="v2-mm-notes-plan"]')).toBeNull();
      });
    });
  },
};

/**
 * A seeded "Keep separate" override on every member. The same three checkouts
 * must render as three groups again, each under its own title, with the machine
 * badge still telling the remote one apart.
 */
export const SeparateOverrideSplitsTheGroup: Story = {
  args: {
    sidebarProjectGroupingOverrides: {
      [LOCAL_COPY_OVERRIDE_KEY]: "separate",
      [LOCAL_OVERRIDE_KEY]: "separate",
      [REMOTE_OVERRIDE_KEY]: "separate",
    },
  },
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);

    await step("render one group per physical checkout again", async () => {
      await waitFor(async () => {
        expect(await groupIds(root)).toEqual([
          "v2-mm-local",
          "v2-mm-remote",
          "v2-mm-local-copy",
          "v2-mm-notes",
        ]);
      });
    });

    await step("restore each checkout's own title", async () => {
      const titles = [...root.querySelectorAll(".sidebar-v2-group-title")].map(
        (element) => element.textContent,
      );
      expect(titles).toEqual(["ghostex", "ghostex-main", "ghostex-review", "notes"]);
    });

    await step("mark no group as merged", async () => {
      const merged = [...root.querySelectorAll(".sidebar-v2-group-header")].map((element) =>
        element.getAttribute("data-sidebar-v2-group-merged"),
      );
      expect(merged).toEqual(["false", "false", "false", "false"]);
    });
  },
};

/**
 * The override UI end to end: open the merged group's menu, see the active
 * option checked, pick another, and watch the sidebar RE-GROUP off the settings
 * write it just made. Asserting only the outgoing patch would prove the button
 * fires; asserting the re-group proves the whole loop.
 */
export const GroupingOverrideMenuRegroupsTheList: Story = {
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);
    resetSidebarStoryMessages();

    await step("open the merged group's context menu", async () => {
      const header = root.querySelector<HTMLElement>(
        '[data-sidebar-v2-group-id="v2-mm-local"] .sidebar-v2-group-header-row',
      );
      fireEvent.contextMenu(header!, { clientX: 40, clientY: 80 });
      await waitFor(() => {
        expect(
          storyRoot.querySelector(".sidebar-v2-session-context-menu"),
        ).toBeTruthy();
      });
    });

    await step("offer exactly the grouping submenu", async () => {
      const items = [
        ...storyRoot.querySelectorAll(
          ".sidebar-v2-session-context-menu .session-context-menu-item",
        ),
      ].map((element) => element.textContent);
      expect(items).toEqual(["Group across machines"]);
    });

    await step("check the mode the group is currently using", async () => {
      fireEvent.click(
        storyRoot.querySelector<HTMLElement>(
          ".sidebar-v2-session-context-menu .session-context-menu-item",
        )!,
      );
      await waitFor(() => {
        expect(
          storyRoot.querySelectorAll(".sidebar-v2-context-submenu-item").length,
        ).toBe(3);
      });
      const options = [
        ...storyRoot.querySelectorAll<HTMLElement>(".sidebar-v2-context-submenu-item"),
      ];
      expect(options.map((option) => option.textContent)).toEqual([
        "Repository",
        "Repository + path",
        "Keep separate",
      ]);
      expect(options.map((option) => option.getAttribute("data-checked"))).toEqual([
        "true",
        "false",
        "false",
      ]);
    });

    await step("write 'separate' for EVERY member of the merged group", async () => {
      const options = [
        ...storyRoot.querySelectorAll<HTMLElement>(".sidebar-v2-context-submenu-item"),
      ];
      fireEvent.click(options[2]!);
      await expectProjectGroupingOverridePatch({
        [LOCAL_COPY_OVERRIDE_KEY]: "separate",
        [LOCAL_OVERRIDE_KEY]: "separate",
        [REMOTE_OVERRIDE_KEY]: "separate",
      });
    });

    await step("re-group the list off the settings write", async () => {
      await waitFor(
        async () => {
          expect(await groupIds(root)).toEqual([
            "v2-mm-local",
            "v2-mm-remote",
            "v2-mm-local-copy",
            "v2-mm-notes",
          ]);
        },
        { timeout: 20_000 },
      );
      const titles = [...root.querySelectorAll(".sidebar-v2-group-title")].map(
        (element) => element.textContent,
      );
      expect(titles).toEqual(["ghostex", "ghostex-main", "ghostex-review", "notes"]);
    });

    /*
     * CDXC:SidebarV2LogicalProjects 2026-07-29 (P5 fix round):
     * Splitting cost ONE click on the merged row, so re-merging must cost one
     * click on ANY split row. Choosing "Repository" on the second local clone —
     * a row the user never split explicitly — has to pull the whole repository
     * back together, not just re-merge that row with itself.
     */
    await step("re-merge the whole set from ONE split row", async () => {
      resetSidebarStoryMessages();
      await chooseGroupingMode(storyRoot, "v2-mm-local-copy", "Repository");
      await expectProjectGroupingOverridePatch({
        [LOCAL_COPY_OVERRIDE_KEY]: "repository",
        [LOCAL_OVERRIDE_KEY]: "repository",
        [REMOTE_OVERRIDE_KEY]: "repository",
      });
      await waitFor(
        async () => {
          expect(await groupIds(root)).toEqual(["v2-mm-local", "v2-mm-notes"]);
        },
        { timeout: 20_000 },
      );
      expect(groupTitles(root)).toEqual(["ghostex/ghostex", "notes"]);
    });
  },
};

/*
 * CDXC:SidebarV2LogicalProjects 2026-07-29 (P5 fix round):
 * The monorepo fixture. `apps/web` and `services/api` are two registered
 * projects inside ONE repository checkout, and `apps/web` also exists on a
 * remote machine — the only shape where the three grouping modes produce three
 * different lists. Before the daemon published a repository root, "Repository +
 * path" produced the same key as "Repository" for every project, so the option
 * was in the menu and could not change anything.
 */
const MONOREPO_ARGS = { fixture: "sidebar-v2-monorepo" } as const;

export const MonorepoSubProjectsMergeByDefault: Story = {
  args: MONOREPO_ARGS,
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);

    await step("collapse both sub-projects and the remote copy into one row", async () => {
      await waitFor(async () => {
        expect(await groupIds(root)).toEqual(["v2-mono-web", "v2-mono-outsider"]);
      });
      expect(groupTitles(root)).toEqual(["ghostex/mono", "tooling"]);
      expect(
        root
          .querySelector('[data-sidebar-v2-group-id="v2-mono-web"] .sidebar-v2-group-header')
          ?.getAttribute("data-sidebar-v2-group-merged"),
      ).toBe("true");
      expect(
        root.querySelector('[data-sidebar-v2-group-id="v2-mono-web"] .sidebar-v2-group-count')
          ?.textContent,
      ).toBe("3");
    });

    await step("hold every sub-project's rows in the merged group", async () => {
      const merged = root.querySelector<HTMLElement>(
        '[data-sidebar-v2-group-id="v2-mono-web"]',
      );
      const rowIds = [...merged!.querySelectorAll(".sidebar-v2-row[data-session-id]")].map(
        (element) => element.getAttribute("data-session-id"),
      );
      expect(rowIds).toContain("v2-mono-web-working");
      expect(rowIds).toContain("v2-mono-api-review");
      expect(rowIds).toContain("v2-mono-remote-web-smoke");
    });
  },
};

/**
 * The finding this fix round exists for: "Repository + path" must actually
 * re-group the list. `apps/web` and `services/api` split apart, while the two
 * `apps/web` checkouts — one local, one on Build Box — stay merged, because the
 * mode splits on the path BELOW the repository root, not on the machine.
 */
export const RepositoryPathOverrideSplitsSubProjects: Story = {
  args: MONOREPO_ARGS,
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);
    resetSidebarStoryMessages();

    await step("choose 'Repository + path' on the merged monorepo row", async () => {
      await chooseGroupingMode(storyRoot, "v2-mono-web", "Repository + path");
      await expectProjectGroupingOverridePatch({
        [MONO_API_OVERRIDE_KEY]: "repositoryPath",
        [MONO_REMOTE_WEB_OVERRIDE_KEY]: "repositoryPath",
        [MONO_WEB_OVERRIDE_KEY]: "repositoryPath",
      });
    });

    await step("split the two sub-projects into their own rows", async () => {
      await waitFor(
        async () => {
          expect(await groupIds(root)).toEqual([
            "v2-mono-web",
            "v2-mono-api",
            "v2-mono-outsider",
          ]);
        },
        { timeout: 20_000 },
      );
      expect(groupTitles(root)).toEqual(["ghostex/mono", "api", "tooling"]);
    });

    await step("keep the two apps/web checkouts merged with each other", async () => {
      const web = root.querySelector<HTMLElement>('[data-sidebar-v2-group-id="v2-mono-web"]');
      expect(
        web!.querySelector(".sidebar-v2-group-header")?.getAttribute(
          "data-sidebar-v2-group-merged",
        ),
      ).toBe("true");
      expect(web!.querySelector(".sidebar-v2-group-count")?.textContent).toBe("2");
      const webRowIds = [...web!.querySelectorAll(".sidebar-v2-row[data-session-id]")].map(
        (element) => element.getAttribute("data-session-id"),
      );
      expect(webRowIds).toContain("v2-mono-web-working");
      expect(webRowIds).toContain("v2-mono-remote-web-smoke");
      expect(webRowIds).not.toContain("v2-mono-api-review");
    });

    await step("move the api sub-project out on its own", async () => {
      const api = root.querySelector<HTMLElement>('[data-sidebar-v2-group-id="v2-mono-api"]');
      expect(
        api!.querySelector(".sidebar-v2-group-header")?.getAttribute(
          "data-sidebar-v2-group-merged",
        ),
      ).toBe("false");
      expect(
        [...api!.querySelectorAll(".sidebar-v2-row[data-session-id]")].map((element) =>
          element.getAttribute("data-session-id"),
        ),
      ).toEqual(["v2-mono-api-review"]);
    });

    await step("leave the unrelated repository untouched", async () => {
      expect(
        root
          .querySelector('[data-sidebar-v2-group-id="v2-mono-outsider"] .sidebar-v2-group-header')
          ?.getAttribute("data-sidebar-v2-group-merged"),
      ).toBe("false");
    });
  },
};

/**
 * "Keep separate" still means EVERY physical checkout on its own — including
 * the two `apps/web` copies that "Repository + path" keeps together. That
 * difference is what makes the two modes distinct rather than two spellings of
 * the same thing.
 */
export const SeparateOverrideSplitsEveryMonorepoCheckout: Story = {
  args: {
    ...MONOREPO_ARGS,
    sidebarProjectGroupingOverrides: {
      [MONO_API_OVERRIDE_KEY]: "separate",
      [MONO_REMOTE_WEB_OVERRIDE_KEY]: "separate",
      [MONO_WEB_OVERRIDE_KEY]: "separate",
    },
  },
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);

    await step("render one row per physical checkout", async () => {
      await waitFor(async () => {
        expect(await groupIds(root)).toEqual([
          "v2-mono-web",
          "v2-mono-api",
          "v2-mono-remote-web",
          "v2-mono-outsider",
        ]);
      });
      expect(groupTitles(root)).toEqual(["web", "api", "web (build box)", "tooling"]);
    });

    await step("mark no row as merged", async () => {
      expect(
        [...root.querySelectorAll(".sidebar-v2-group-header")].map((element) =>
          element.getAttribute("data-sidebar-v2-group-merged"),
        ),
      ).toEqual(["false", "false", "false", "false"]);
    });
  },
};

/**
 * A project with no git origin has nothing to merge ON, so the submenu must be
 * absent rather than present-and-inert: offering three options that all produce
 * the same single group is a promise the data cannot keep.
 */
export const NonGitProjectHasNoGroupingMenu: Story = {
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);

    await step("open nothing at all on the non-git group header", async () => {
      const header = root.querySelector<HTMLElement>(
        '[data-sidebar-v2-group-id="v2-mm-notes"] .sidebar-v2-group-header-row',
      );
      fireEvent.contextMenu(header!, { clientX: 40, clientY: 120 });
      await new Promise((resolve) => {
        window.setTimeout(resolve, 150);
      });
      expect(storyRoot.querySelector(".sidebar-v2-session-context-menu")).toBeNull();
    });
  },
};
