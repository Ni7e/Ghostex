import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, waitFor } from "storybook/test";
import type { SidebarStoryArgs } from "../sidebar-story-fixtures";
import {
  DEFAULT_SIDEBAR_STORY_ARGS,
  SIDEBAR_STORY_ARG_TYPES,
  SIDEBAR_STORY_DECORATORS,
  renderSidebarStory,
} from "../sidebar-story-meta";
import { findSidebarV2Row, waitForSidebarV2 } from "./sidebar-v2.story-helpers";

/*
 * CDXC:SidebarV2 2026-07-29:
 * Visual stories for the Inbox sidebar. They render the REAL `SidebarApp`
 * through the shared harness with `sidebarVersion: "v2"`, so what Storybook
 * shows went through the same settings pipeline, message bridge, and store the
 * app uses — a standalone mount of the V2 tree would prove much less.
 */

const meta = {
  title: "Sidebar/V2 Inbox",
  args: {
    ...DEFAULT_SIDEBAR_STORY_ARGS,
    fixture: "sidebar-v2-inbox",
    /*
     * CDXC:SidebarV2Lifecycle 2026-07-29:
     * The default V2 story runs against a CURRENT gxserver. The degraded
     * old-daemon case is its own story (`WithoutLifecycleCapabilities`) rather
     * than the baseline, because the shelves are the point of this sidebar.
     *
     * CDXC:SidebarV2Git 2026-07-29:
     * "Current" now includes the git/PR probe, so the baseline shows the third
     * card line where the fixtures have one. The two degraded daemons get their
     * own stories: no capability block at all, and lifecycle without git.
     */
    sidebarLifecycleCapabilities: "settleSnoozeAndGit",
    sidebarV2Layout: "flat",
    sidebarVersion: "v2",
  },
  argTypes: SIDEBAR_STORY_ARG_TYPES,
  decorators: SIDEBAR_STORY_DECORATORS,
  render: renderSidebarStory,
} satisfies Meta<SidebarStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Mixed statuses in one screen: attention, working, done, receded idle, a
    pinned row floating on top, plus the Snoozed/Settled/Browser shelves. */
export const FlatInbox: Story = {
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);

    await step("float the pinned session above the rest of the inbox", async () => {
      const cards = [
        ...root.querySelectorAll('.sidebar-v2-row[data-variant="card"][data-session-id]'),
      ];
      expect(cards[0]?.getAttribute("data-session-id")).toBe("v2-ghostex-pinned");
    });

    await step("render every status hue the resolver can produce", async () => {
      const kinds = new Set(
        [...root.querySelectorAll(".sidebar-v2-status")].map((element) =>
          element.getAttribute("data-kind"),
        ),
      );
      expect(kinds.has("working")).toBe(true);
      expect(kinds.has("input")).toBe(true);
      expect(kinds.has("failed")).toBe(true);
      expect(kinds.has("done")).toBe(true);
      expect(kinds.has("idle")).toBe(true);
    });

    await step("paint attention amber, because Ghostex only knows 'act now'", async () => {
      /*
       * Ghostex publishes one `attention` activity with no approval-vs-input
       * split, so every attention row has to read as the loud one. Indigo is
       * reserved for a host that actually says `attentionKind: "input"`.
       */
      const attentionRow = await findSidebarV2Row(storyRoot, "v2-quick-approval");
      const status = attentionRow.querySelector(".sidebar-v2-status");
      expect(status?.getAttribute("data-hue")).toBe("amber");
      expect(
        [...root.querySelectorAll('.sidebar-v2-status[data-hue="indigo"]')].length,
      ).toBe(0);
    });

    await step("highlight exactly one current session", async () => {
      const activeRows = [...root.querySelectorAll('.sidebar-v2-row[data-active="true"]')];
      expect(activeRows.map((row) => row.getAttribute("data-session-id"))).toEqual([
        "v2-ghostex-working",
      ]);
    });

    await step("recede the resting rows and never the loud ones", async () => {
      const idleRow = await findSidebarV2Row(storyRoot, "v2-quick-idle");
      const workingRow = await findSidebarV2Row(storyRoot, "v2-ghostex-working");
      expect(idleRow.getAttribute("data-recede")).toBe("true");
      expect(workingRow.getAttribute("data-recede")).toBe("false");
    });
  },
};

/** The Snoozed shelf starts collapsed with its count in the header; Settled
    starts open. Expanding proves the count disappears once rows are visible. */
export const Shelves: Story = {
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);

    await step("collapse Snoozed and show its count in the header", async () => {
      const header = root.querySelector<HTMLElement>(
        '.sidebar-v2-shelf-header[data-tone="snoozed"]',
      );
      expect(header?.getAttribute("aria-expanded")).toBe("false");
      expect(header?.textContent).toContain("Snoozed (1)");
      expect(root.querySelector('[data-session-id="v2-ghostex-snoozed"]')).toBeNull();
    });

    await step("reveal snoozed rows as slim rows when expanded", async () => {
      const header = root.querySelector<HTMLElement>(
        '.sidebar-v2-shelf-header[data-tone="snoozed"]',
      );
      fireEvent.click(header!);
      const row = await findSidebarV2Row(storyRoot, "v2-ghostex-snoozed");
      expect(row.getAttribute("data-variant")).toBe("slim");
      expect(header?.textContent).toContain("Snoozed");
      expect(header?.textContent).not.toContain("(1)");
    });

    await step("park the long-idle session on the Settled shelf", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-ghostex-settled");
      expect(row.getAttribute("data-variant")).toBe("slim");
    });
  },
};

/**
 * CDXC:SidebarV2Lifecycle 2026-07-29:
 * The lifecycle shelves rendered from REAL server-owned state: a session parked
 * by the auto-settle sweep (override, no `settledAt`), one parked by an explicit
 * click (`settledAt` stamped, activity minutes old), and a snoozed session
 * stating when it comes back.
 */
export const LifecycleShelves: Story = {
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);

    await step("park both settle shapes on the Settled shelf", async () => {
      const autoSettled = await findSidebarV2Row(storyRoot, "v2-ghostex-settled");
      const handSettled = await findSidebarV2Row(storyRoot, "v2-ghostex-settled-manual");
      expect(autoSettled.getAttribute("data-variant")).toBe("slim");
      expect(handSettled.getAttribute("data-variant")).toBe("slim");
    });

    await step("offer un-settle on settled rows and wake on snoozed rows", async () => {
      const settledRow = await findSidebarV2Row(storyRoot, "v2-ghostex-settled");
      expect(settledRow.getAttribute("data-lifecycle-action")).toBe("unsettle");
      expect(settledRow.querySelector('[aria-label="Un-settle session"]')).toBeTruthy();

      fireEvent.click(
        root.querySelector<HTMLElement>('.sidebar-v2-shelf-header[data-tone="snoozed"]')!,
      );
      const snoozedRow = await findSidebarV2Row(storyRoot, "v2-ghostex-snoozed");
      expect(snoozedRow.getAttribute("data-lifecycle-action")).toBe("wake");
      expect(snoozedRow.querySelector('[aria-label="Wake session now"]')).toBeTruthy();
    });

    await step("state a snoozed row's return time instead of its last activity", async () => {
      const snoozedRow = await findSidebarV2Row(storyRoot, "v2-ghostex-snoozed");
      const wakeLabel = snoozedRow.querySelector('[data-lifecycle-label="wake"]');
      expect(wakeLabel?.textContent).toMatch(/^\d+[mhd]$/);
    });

    await step("offer settle and snooze on ordinary inbox cards", async () => {
      const inboxRow = await findSidebarV2Row(storyRoot, "v2-quick-idle");
      expect(inboxRow.getAttribute("data-lifecycle-action")).toBe("settle");
      expect(inboxRow.querySelector('[aria-label="Settle session"]')).toBeTruthy();
      expect(inboxRow.querySelector('[aria-label="Snooze session"]')).toBeTruthy();
    });

    await step("never offer settle to a session that is working or blocked", async () => {
      const workingRow = await findSidebarV2Row(storyRoot, "v2-ghostex-working");
      expect(workingRow.querySelector('[aria-label="Settle session"]')).toBeNull();
      // Snooze IS allowed while working: it changes visibility, not the agent.
      expect(workingRow.querySelector('[aria-label="Snooze session"]')).toBeTruthy();

      const blockedRow = await findSidebarV2Row(storyRoot, "v2-quick-approval");
      expect(blockedRow.querySelector('[aria-label="Settle session"]')).toBeNull();
      expect(blockedRow.querySelector('[aria-label="Snooze session"]')).toBeNull();
    });

    await step("keep lifecycle actions off browser rows", async () => {
      const browserRow = await findSidebarV2Row(storyRoot, "v2-ghostex-browser");
      expect(browserRow.getAttribute("data-lifecycle-action")).toBe("none");
      expect(browserRow.querySelector('[aria-label="Snooze session"]')).toBeNull();
    });
  },
};

/**
 * A spent snooze and an early hand-raise both put a row back in the inbox. The
 * sort is static, so the row returns to its original slot and the wake signal
 * has to carry the whole message on its own.
 */
export const WokeFromSnooze: Story = {
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;

    await waitForSidebarV2(storyRoot);

    await step("return an expired snooze to the inbox with a Woke badge", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-zmx-woke");
      expect(row.getAttribute("data-variant")).toBe("card");
      expect(row.getAttribute("data-woke")).toBe("true");
      const woke = row.querySelector('[data-lifecycle-label="woke"]');
      expect(woke?.textContent).toContain("Woke");
      expect(woke?.getAttribute("aria-label")).toBe("Woke from snooze");
    });

    await step("pull a still-snoozed session back the moment it is blocked on you", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-zmx-raised-hand");
      expect(row.getAttribute("data-variant")).toBe("card");
      expect(row.getAttribute("data-woke")).toBe("true");
    });

    await step("let the live status outrank the historical one", async () => {
      /*
       * A raised hand is an attention row first and a woken row second: its
       * slot must show the amber "act now" status, with the wake reduced to a
       * glyph beside it rather than a second competing label. Attention color
       * keys off data-hue, never data-kind.
       */
      const row = await findSidebarV2Row(storyRoot, "v2-zmx-raised-hand");
      const status = row.querySelector(".sidebar-v2-status");
      expect(status?.getAttribute("data-hue")).toBe("amber");
      expect(row.querySelector('[data-lifecycle-label="woke"]')).toBeNull();
      expect(row.querySelector('[data-lifecycle-mark="woke"]')).toBeTruthy();
    });
  },
};

/**
 * An un-upgraded gxserver (a remote machine on an older build) publishes no
 * capability block. Nothing may classify as settled or snoozed, and no
 * lifecycle control may render — a disabled button would still promise a
 * feature the daemon cannot serve.
 */
export const WithoutLifecycleCapabilities: Story = {
  args: { sidebarLifecycleCapabilities: "absent" },
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);

    await step("keep every shelf empty", async () => {
      await waitFor(() => {
        expect(
          root.querySelector('.sidebar-v2-shelf-header[data-tone="settled"]'),
        ).toBeNull();
      });
      expect(root.querySelector('.sidebar-v2-shelf-header[data-tone="snoozed"]')).toBeNull();
    });

    await step("show the would-be settled and snoozed rows in the inbox instead", async () => {
      const settledRow = await findSidebarV2Row(storyRoot, "v2-ghostex-settled");
      const snoozedRow = await findSidebarV2Row(storyRoot, "v2-ghostex-snoozed");
      expect(settledRow.getAttribute("data-variant")).toBe("card");
      expect(snoozedRow.getAttribute("data-variant")).toBe("card");
    });

    await step("render no lifecycle affordance anywhere", async () => {
      expect(root.querySelectorAll("[data-lifecycle-action]:not(.sidebar-v2-row)")).toHaveLength(0);
      expect(root.querySelectorAll('[aria-label="Settle session"]')).toHaveLength(0);
      expect(root.querySelectorAll('[aria-label="Snooze session"]')).toHaveLength(0);
      expect(root.querySelectorAll('[data-lifecycle-label="woke"]')).toHaveLength(0);
      expect(root.querySelectorAll('[data-lifecycle-mark="woke"]')).toHaveLength(0);
    });
  },
};

/**
 * CDXC:SidebarV2Git 2026-07-29:
 * The card's third line, across every shape gxserver can publish: a branch on
 * its own, a branch with an open review and a live diff, a merged review parked
 * on the settled shelf, a draft, and a closed one. The two silent cases —
 * a probe that found nothing, and a session with no git data at all — must
 * produce no line whatsoever.
 */
export const GitAndPullRequestCards: Story = {
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    await waitForSidebarV2(storyRoot);

    await step("state branch, review, and diff on the card's meta line", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-ghostex-working");
      const meta = row.querySelector<HTMLElement>('[data-line="meta"]');
      expect(meta?.getAttribute("data-meta")).toBe("git");
      expect(meta?.querySelector(".sidebar-v2-row-branch-name")?.textContent).toBe(
        "ghostex/sidebar-v2-inbox",
      );
      expect(meta?.querySelector(".sidebar-v2-row-pr")?.textContent).toBe("#128");
      expect(meta?.querySelector(".sidebar-v2-row-pr")?.getAttribute("data-pr-state")).toBe(
        "open",
      );
      expect(meta?.querySelector(".sidebar-v2-row-diff-added")?.textContent).toBe("+412");
      expect(meta?.querySelector(".sidebar-v2-row-diff-removed")?.textContent).toBe("−87");
    });

    await step("keep a card three lines with git, exactly as it was without", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-ghostex-working");
      expect(row.closest(".sidebar-v2-row-item")?.getAttribute("data-card-lines")).toBe("3");
    });

    await step("show a lone branch with no badge and no diff", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-ghostex-pinned");
      const meta = row.querySelector<HTMLElement>('[data-line="meta"]');
      expect(meta?.querySelector(".sidebar-v2-row-branch-name")?.textContent).toBe("release/6.9");
      expect(meta?.querySelector(".sidebar-v2-row-pr")).toBeNull();
      expect(meta?.querySelector(".sidebar-v2-row-diff")).toBeNull();
    });

    await step("color the draft and closed reviews by their own state", async () => {
      const draftRow = await findSidebarV2Row(storyRoot, "v2-zmx-failed");
      expect(
        draftRow.querySelector(".sidebar-v2-row-pr")?.getAttribute("data-pr-state"),
      ).toBe("draft");
      const closedRow = await findSidebarV2Row(storyRoot, "v2-zmx-done");
      expect(
        closedRow.querySelector(".sidebar-v2-row-pr")?.getAttribute("data-pr-state"),
      ).toBe("closed");
    });

    await step("keep only the PR badge on a slim settled row", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-ghostex-settled-manual");
      expect(row.getAttribute("data-variant")).toBe("slim");
      const badge = row.querySelector(".sidebar-v2-row-pr");
      expect(badge?.textContent).toBe("#124");
      expect(badge?.getAttribute("data-pr-state")).toBe("merged");
      expect(row.querySelector(".sidebar-v2-row-branch")).toBeNull();
      expect(row.querySelector(".sidebar-v2-row-diff")).toBeNull();
    });

    await step("render nothing for a probe that found nothing to say", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-quick-approval");
      expect(row.querySelector("[data-sidebar-v2-git]")).toBeNull();
      expect(row.querySelector('[data-line="meta"]')?.getAttribute("data-meta")).toBe("detail");
    });

    await step("leave a session without git data on its original card", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-quick-idle");
      expect(row.querySelector("[data-sidebar-v2-git]")).toBeNull();
      expect(row.querySelector('[data-line="meta"]')?.textContent).toContain("OpenAI Codex");
    });
  },
};

/**
 * CDXC:SidebarV2Git 2026-07-29:
 * A daemon upgraded to settle/snooze but not to the git probe. Its rows carry
 * no git data on the wire, and the sidebar must not render a branch line for
 * one anyway — this story pins that the capability, not the fixture, is what
 * decides.
 */
export const WithoutGitCapability: Story = {
  args: { sidebarLifecycleCapabilities: "settleAndSnooze" },
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);

    await step("render no branch, badge, or diff anywhere", async () => {
      await waitFor(() => {
        expect(root.querySelectorAll("[data-sidebar-v2-git]")).toHaveLength(0);
      });
      expect(root.querySelectorAll(".sidebar-v2-row-pr")).toHaveLength(0);
      expect(root.querySelectorAll(".sidebar-v2-row-diff")).toHaveLength(0);
    });

    await step("keep the card identical to a session with no git data", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-ghostex-working");
      const meta = row.querySelector<HTMLElement>('[data-line="meta"]');
      expect(meta?.getAttribute("data-meta")).toBe("detail");
      expect(meta?.textContent).toContain("OpenAI Codex");
      expect(row.closest(".sidebar-v2-row-item")?.getAttribute("data-card-lines")).toBe("3");
    });

    await step("keep the settle/snooze affordances the daemon does support", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-quick-idle");
      expect(row.querySelector('[aria-label="Settle session"]')).toBeTruthy();
    });
  },
};

/** Browser sessions get their own flat-mode section instead of the inbox. */
export const BrowserSection: Story = {
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);

    await step("list browser sessions under their own header", async () => {
      const header = root.querySelector<HTMLElement>(
        '.sidebar-v2-shelf-header[data-tone="browser"]',
      );
      expect(header?.textContent).toContain("Browser");
      await findSidebarV2Row(storyRoot, "v2-ghostex-browser");
      await findSidebarV2Row(storyRoot, "v2-zmx-browser");
    });

    await step("keep browser rows out of the agent inbox", async () => {
      const inboxIds = [
        ...root.querySelectorAll('.sidebar-v2-list > .sidebar-v2-row-item[data-variant="card"]'),
      ];
      expect(inboxIds.length).toBeGreaterThan(0);
    });
  },
};

/** Group by Project: collapsible project groups, browser rows above agent rows,
    and a per-project Settled shelf. */
export const ByProject: Story = {
  args: { sidebarV2Layout: "byProject" },
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);

    await step("render one group per project", async () => {
      await waitFor(() => {
        expect(root.querySelectorAll("[data-sidebar-v2-group-id]").length).toBe(3);
      });
    });

    await step("render browser rows above agent rows inside a project", async () => {
      const group = root.querySelector<HTMLElement>(
        '[data-sidebar-v2-group-id="v2-project-ghostex"]',
      );
      const rowIds = [...group!.querySelectorAll("[data-session-id]")].map((element) =>
        element.getAttribute("data-session-id"),
      );
      expect(rowIds[0]).toBe("v2-ghostex-browser");
    });

    await step("give each project its own Settled shelf", async () => {
      const group = root.querySelector<HTMLElement>(
        '[data-sidebar-v2-group-id="v2-project-ghostex"]',
      );
      expect(group!.querySelector('.sidebar-v2-shelf-header[data-tone="settled"]')).toBeTruthy();
    });

    await step("drop the project line: the group header already states it", async () => {
      const row = await findSidebarV2Row(storyRoot, "v2-ghostex-working");
      expect(row.querySelector('[data-line="project"]')).toBeNull();
      const status = row.querySelector<HTMLElement>(".sidebar-v2-status");
      expect(status?.closest('[data-line="title"]')).toBeTruthy();
      expect(row.closest(".sidebar-v2-row-item")?.getAttribute("data-card-lines")).toBe("2");
    });
  },
};

/** gxserver is down: the sidebar holds only the synthetic placeholder group.
    V2 must never render that as a project — it shows the same recovery block
    the classic sidebar shows. */
export const GxserverUnavailable: Story = {
  args: { fixture: "sidebar-v2-gxserver-unavailable" },
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);

    await step("keep the placeholder group out of the inbox", async () => {
      expect(root.querySelector('[data-sidebar-v2-group-id="gxserver-unavailable"]')).toBeNull();
      expect(root.querySelector(".sidebar-v2-row")).toBeNull();
    });

    await step("show the host recovery copy instead of an inbox empty state", async () => {
      /*
       * The copy is deliberately delayed by 20s while a cold start can still
       * recover (see SIDEBAR_GXSERVER_UNAVAILABLE_EMPTY_STATE_DELAY_MS), so this
       * waits past that window rather than asserting an instant message.
       */
      await waitFor(
        () => {
          expect(root.querySelector(".reference-sidebar-empty-state")?.textContent).toContain(
            "Unable to load sessions.",
          );
        },
        { timeout: 30_000 },
      );
      expect(root.querySelector(".sidebar-v2-empty-message")).toBeNull();
    });
  },
};

/** Nothing to show at all: the one moment a user could suspect V2 lost their
    sessions, so the escape hatch back to the classic sidebar lives here. */
export const EmptyInbox: Story = {
  args: { fixture: "sidebar-v2-empty" },
  play: async ({ canvasElement, step }) => {
    const storyRoot = canvasElement.ownerDocument.body;
    const root = await waitForSidebarV2(storyRoot);

    await step("explain the empty inbox and offer the way back", async () => {
      await waitFor(() => {
        expect(root.querySelector(".sidebar-v2-empty-message")?.textContent).toBe(
          "No sessions yet",
        );
      });
      expect(root.querySelector(".sidebar-v2-empty-action")?.textContent).toContain(
        "classic sidebar",
      );
    });
  },
};
