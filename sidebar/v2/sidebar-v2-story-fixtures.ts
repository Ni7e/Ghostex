import { createDefaultSidebarProjectDiffStats } from "../../shared/project-diff-stats";
import type { SidebarSessionItem } from "../../shared/session-grid-contract";
import type { SidebarV2SessionOverrides } from "../../shared/sidebar-v2-session";
import { createStorySession, type SidebarStoryGroup } from "../sidebar-story-fixture-helpers";

/*
 * CDXC:SidebarV2 2026-07-29:
 * Story fixtures for the Inbox sidebar. These exist because V2's whole point is
 * how a MIX of states reads at a glance — a fixture with one status per screen
 * proves nothing about the hierarchy the design is built to create.
 *
 * CDXC:SidebarV2Lifecycle 2026-07-29:
 * The lifecycle fields are now REAL contract fields that gxserver publishes, so
 * these fixtures stand in for server state rather than for a missing feature.
 * The set is chosen to cover every shape the partition can be handed:
 * auto-settled (override, no `settledAt`), manually settled (`settledAt`
 * stamped, recent activity), snoozed with a future wake, a spent snooze whose
 * retained fields drive the "Woke" indicator, and a snoozed session that raised
 * its hand and therefore belongs back in the inbox.
 *
 * CDXC:SidebarV2Git 2026-07-29:
 * The git/PR fixtures cover every shape the card line can be handed: branch
 * only, branch + open review + diff, a merged review parked on the settled
 * shelf (slim variant), a draft review, a closed review, a probe that found
 * nothing (branch null, 0/0, no PR), and sessions with no `gitStatus` at all.
 * The last two must render IDENTICALLY — no reserved blank line either way.
 */

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1_000).toISOString();
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1_000).toISOString();
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1_000).toISOString();
}

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1_000).toISOString();
}

type SidebarV2StorySessionExtras = SidebarV2SessionOverrides &
  Partial<
    Pick<
      SidebarSessionItem,
      /*
       * CDXC:SidebarV2Worktree 2026-07-29:
       * `cwd` joins the fixture surface because a worktree is the PAIR of a cwd
       * and a `ghostex/…` branch — a fixture that carries only the branch could
       * not exercise the cleanup prompt or "New session on <branch>".
       */
      | "cwd"
      | "gitStatus"
      | "isPinned"
      | "kind"
      | "lifecycleState"
      | "sessionKind"
      | "workingStartedAt"
    >
  >;

function withSidebarV2Fields(
  session: SidebarSessionItem,
  extras: SidebarV2StorySessionExtras,
): SidebarSessionItem {
  return { ...session, ...extras };
}

function createStoryProjectContext(
  projectId: string,
  overrides: Partial<NonNullable<SidebarStoryGroup["projectContext"]>> = {},
): NonNullable<SidebarStoryGroup["projectContext"]> {
  return {
    canRemoveProject: true,
    editor: {
      diffStats: createDefaultSidebarProjectDiffStats(),
      isOpen: false,
      isSleeping: false,
      projectId,
      status: "idle",
    },
    path: `/Users/story/dev/${projectId}`,
    theme: "plain-dark",
    ...overrides,
  };
}

/**
 * The main Inbox fixture: every status the V2 resolver can produce, plus a
 * pinned row, browser rows, a settled row (idle past the auto-settle window),
 * and a snoozed row, spread across a Quick collection and two projects so the
 * scope filter and grouped mode both have something to do.
 */
const SIDEBAR_V2_INBOX_GROUPS: SidebarStoryGroup[] = [
  {
    groupId: "v2-quick",
    /*
     * CDXC:SidebarV2 2026-07-29:
     * The ACTIVE group must be the one that owns the focused session
     * (`v2-ghostex-working` below), because that is the only shape the host ever
     * publishes: gxserver marks a project active and focuses a session inside
     * it. Marking a different group active here produced a fixture whose
     * "current session" lived in an inactive project, which no real snapshot can
     * express.
     */
    isActive: false,
    isChatCollection: true,
    kind: "workspace",
    sessions: [
      withSidebarV2Fields(
        createStorySession({
          activity: "attention",
          activityLabel: "Approval",
          agentIcon: "claude",
          alias: "Approve the migration plan",
          detail: "Claude Code",
          lastInteractionAt: minutesAgo(2),
          sessionId: "v2-quick-approval",
          shortcutLabel: "⌘⌥1",
        }),
        {
          createdAt: minutesAgo(12),
          /*
           * CDXC:SidebarV2Git 2026-07-29:
           * A probe that RAN and found nothing to say: detached HEAD, clean
           * tree, no PR. The card must look exactly like a card with no
           * `gitStatus` at all — an empty branch line is worse than none.
           */
          gitStatus: {
            additions: 0,
            branch: null,
            deletions: 0,
            updatedAt: minutesAgo(1),
          },
        },
      ),
      withSidebarV2Fields(
        createStorySession({
          agentIcon: "codex",
          alias: "Draft the release notes",
          detail: "OpenAI Codex",
          lastInteractionAt: hoursAgo(5),
          sessionId: "v2-quick-idle",
          shortcutLabel: "⌘⌥2",
        }),
        { createdAt: hoursAgo(6) },
      ),
    ],
    title: "Quick",
  },
  {
    groupId: "v2-project-ghostex",
    isActive: true,
    kind: "workspace",
    projectContext: createStoryProjectContext("ghostex"),
    sessions: [
      withSidebarV2Fields(
        createStorySession({
          alias: "Ghostex docs preview",
          detail: "https://ghostex.dev/docs",
          isVisible: true,
          lastInteractionAt: minutesAgo(9),
          sessionId: "v2-ghostex-browser",
          shortcutLabel: "⌘⌥1",
        }),
        { createdAt: hoursAgo(2), kind: "browser", sessionKind: "browser" },
      ),
      withSidebarV2Fields(
        createStorySession({
          activity: "working",
          agentIcon: "codex",
          alias: "Port the inbox sidebar",
          detail: "OpenAI Codex",
          isFocused: true,
          isVisible: true,
          lastInteractionAt: minutesAgo(7),
          sessionId: "v2-ghostex-working",
          shortcutLabel: "⌘⌥2",
        }),
        {
          createdAt: minutesAgo(40),
          /*
           * CDXC:SidebarV2Worktree 2026-07-29:
           * The only session in a managed `ghostex/…` checkout, so it is also
           * the fixture for the last-session cleanup prompt and for "New
           * session on <branch>".
           */
          cwd: "/Users/story/dev/worktrees/sidebar-v2-inbox",
          /* The full card line: worktree branch, open review, live diff. */
          gitStatus: {
            additions: 412,
            branch: "ghostex/sidebar-v2-inbox",
            deletions: 87,
            prNumber: 128,
            prState: "open",
            prUrl: "https://github.com/ghostex/ghostex/pull/128",
            updatedAt: minutesAgo(1),
          },
          workingStartedAt: minutesAgo(7),
        },
      ),
      withSidebarV2Fields(
        createStorySession({
          agentIcon: "claude",
          alias: "Pinned: release checklist",
          detail: "Claude Code",
          lastInteractionAt: minutesAgo(3),
          sessionId: "v2-ghostex-pinned",
          shortcutLabel: "⌘⌥3",
        }),
        {
          createdAt: daysAgo(2),
          /*
           * CDXC:SidebarV2Worktree 2026-07-29:
           * A session in the PROJECT'S OWN checkout, on a normal branch. This is
           * what most rows look like, and it is the case "New session on
           * <branch>" must not offer: the main working tree cannot be adopted as
           * a worktree, so the item would only ever produce a server refusal.
           */
          cwd: "/Users/story/dev/ghostex",
          /* Branch only: no review opened yet and nothing changed on it, so the
             line is one truncating branch label and nothing else. */
          gitStatus: {
            additions: 0,
            branch: "release/6.9",
            deletions: 0,
            updatedAt: minutesAgo(2),
          },
          isPinned: true,
        },
      ),
      withSidebarV2Fields(
        createStorySession({
          agentIcon: "gemini",
          alias: "Snoozed: dependency bump",
          detail: "Gemini CLI",
          lastInteractionAt: hoursAgo(4),
          sessionId: "v2-ghostex-snoozed",
          shortcutLabel: "⌘⌥4",
        }),
        {
          createdAt: hoursAgo(9),
          snoozedAt: minutesAgo(30),
          snoozedUntil: hoursFromNow(3),
        },
      ),
      /*
       * CDXC:SidebarV2Lifecycle 2026-07-29:
       * Settled by the SERVER SWEEP: `settledOverride: "settled"` with no
       * `settledAt`. That pairing is deliberate (see the plan's accepted
       * deviations) and is the shape most settled rows really have, so the
       * settled shelf's fallback to the activity clock for sorting and
       * labelling has to be exercised by a fixture, not assumed.
       */
      withSidebarV2Fields(
        createStorySession({
          agentIcon: "codex",
          alias: "Settled: old spike branch",
          detail: "OpenAI Codex",
          lastInteractionAt: daysAgo(6),
          sessionId: "v2-ghostex-settled",
          shortcutLabel: "⌘⌥5",
        }),
        { createdAt: daysAgo(9), settledOverride: "settled" },
      ),
      /*
       * Settled by an explicit user click: `settledAt` is stamped, and the row
       * is RECENT. Without the override it would sit in the inbox, so this
       * fixture proves the override alone parks it.
       */
      withSidebarV2Fields(
        createStorySession({
          agentIcon: "claude",
          alias: "Settled by hand: shipped the fix",
          detail: "Claude Code",
          lastInteractionAt: minutesAgo(25),
          sessionId: "v2-ghostex-settled-manual",
          shortcutLabel: "⌘⌥6",
        }),
        {
          createdAt: hoursAgo(3),
          /*
           * A MERGED review on a settled row: the slim shelf variant keeps the
           * badge and drops branch and diff, which is the one question you ask
           * of parked work.
           */
          gitStatus: {
            additions: 18,
            branch: "ghostex/fix-rename-race",
            deletions: 4,
            prNumber: 124,
            prState: "merged",
            prUrl: "https://github.com/ghostex/ghostex/pull/124",
            updatedAt: minutesAgo(18),
          },
          settledAt: minutesAgo(20),
          settledOverride: "settled",
        },
      ),
    ],
    title: "ghostex",
  },
  {
    groupId: "v2-project-zmx",
    isActive: false,
    kind: "workspace",
    projectContext: createStoryProjectContext("zmx"),
    sessions: [
      withSidebarV2Fields(
        createStorySession({
          alias: "Failed migration run",
          agentIcon: "codex",
          detail: "OpenAI Codex",
          isRunning: false,
          lastInteractionAt: minutesAgo(20),
          sessionId: "v2-zmx-failed",
          shortcutLabel: "⌘⌥1",
        }),
        {
          createdAt: minutesAgo(55),
          /* A DRAFT review: neutral pill, because a draft asks nothing of
             anyone and must not compete with the failed status above it. */
          gitStatus: {
            additions: 9,
            branch: "zmx/reflow-probe",
            deletions: 2,
            prNumber: 31,
            prState: "draft",
            prUrl: "https://github.com/ghostex/zmx/pull/31",
            updatedAt: minutesAgo(12),
          },
          lifecycleState: "error",
        },
      ),
      withSidebarV2Fields(
        createStorySession({
          alias: "Done: flaky test fix",
          agentIcon: "claude",
          detail: "Claude Code",
          lastInteractionAt: minutesAgo(4),
          sessionId: "v2-zmx-done",
          shortcutLabel: "⌘⌥2",
        }),
        {
          createdAt: hoursAgo(1),
          /* A CLOSED review: the work is over and did not land. */
          gitStatus: {
            additions: 3,
            branch: "zmx/flaky-test-fix",
            deletions: 3,
            prNumber: 28,
            prState: "closed",
            prUrl: "https://github.com/ghostex/zmx/pull/28",
            updatedAt: minutesAgo(6),
          },
        },
      ),
      withSidebarV2Fields(
        createStorySession({
          alias: "zmx changelog",
          detail: "https://github.com/ghostex/zmx",
          lastInteractionAt: hoursAgo(3),
          sessionId: "v2-zmx-browser",
          shortcutLabel: "⌘⌥3",
        }),
        { createdAt: hoursAgo(8), kind: "browser", sessionKind: "browser" },
      ),
      /*
       * CDXC:SidebarV2Lifecycle 2026-07-29:
       * The snooze EXPIRED. gxserver retains the spent fields for ~24h on
       * purpose, and the client derives the wake from them, so this row must be
       * back in the inbox — in its original creation-order position, since the
       * sort is static — carrying a "Woke" indicator as its only signal.
       */
      withSidebarV2Fields(
        createStorySession({
          agentIcon: "gemini",
          alias: "Woke: nightly benchmark",
          detail: "Gemini CLI",
          lastInteractionAt: hoursAgo(9),
          sessionId: "v2-zmx-woke",
          shortcutLabel: "⌘⌥4",
        }),
        {
          createdAt: hoursAgo(30),
          snoozedAt: hoursAgo(12),
          snoozedUntil: minutesAgo(45),
        },
      ),
      /*
       * The snooze is still in the future, but the agent RAISED ITS HAND: it is
       * blocked on the user, which outranks the user's own "not now". It must
       * leave the Snoozed shelf immediately, keep its loud attention status, and
       * still be marked as having come back early.
       */
      withSidebarV2Fields(
        createStorySession({
          activity: "attention",
          activityLabel: "Approval",
          agentIcon: "claude",
          alias: "Snoozed but blocked on you",
          detail: "Claude Code",
          lastInteractionAt: minutesAgo(6),
          sessionId: "v2-zmx-raised-hand",
          shortcutLabel: "⌘⌥5",
        }),
        {
          createdAt: hoursAgo(20),
          snoozedAt: hoursAgo(2),
          snoozedUntil: hoursFromNow(5),
        },
      ),
    ],
    title: "zmx",
  },
];

/** Projects registered but empty: exercises the "No sessions yet" state. */
const SIDEBAR_V2_EMPTY_GROUPS: SidebarStoryGroup[] = [
  {
    groupId: "v2-empty-project",
    isActive: true,
    kind: "workspace",
    projectContext: createStoryProjectContext("empty"),
    sessions: [],
    title: "empty-project",
  },
];

/**
 * The daemon is down: the sidebar holds nothing but the synthetic
 * `gxserver-unavailable` placeholder group. V2 must NOT render that placeholder
 * as a project; it must show the host's recovery block instead, exactly as the
 * classic sidebar does.
 */
const SIDEBAR_V2_GXSERVER_UNAVAILABLE_GROUPS: SidebarStoryGroup[] = [
  {
    groupId: "gxserver-unavailable",
    isActive: true,
    kind: "workspace",
    sessions: [],
    title: "",
  },
];

/*
 * CDXC:SidebarV2LogicalProjects 2026-07-29:
 * The cross-machine fixture. It is built around one repository that exists in
 * THREE physical places, because that is the only shape that can prove the
 * merge is keyed on the repository and not on the title or the path:
 *
 * - `v2-mm-local`: this Mac's clone, scp-style origin.
 * - `v2-mm-remote`: the same repository on "Build Box", reached through the
 *   HTTPS form of the same remote and checked out at a completely different
 *   path under a different title. Merging these two is the whole feature.
 * - `v2-mm-local-copy`: a SECOND local clone of the same repository, so the
 *   merge is proven not to be a remote-only special case.
 * - `v2-mm-notes`: a project with no git origin at all, which must never merge
 *   with anything and must not offer the grouping submenu.
 *
 * Each machine also carries a session idle for five days. The local window is
 * three days and Build Box states thirty, so the local one belongs on the
 * Settled shelf and the remote one must NOT — that pairing is the regression
 * test for applying one machine's window to another's rows.
 */
const SIDEBAR_V2_MULTI_MACHINE_GROUPS: SidebarStoryGroup[] = [
  {
    groupId: "v2-mm-local",
    isActive: true,
    kind: "workspace",
    projectContext: createStoryProjectContext("ghostex", {
      gitRemoteOriginUrl: "git@github.com:ghostex/ghostex.git",
      path: "/Users/story/dev/ghostex",
    }),
    sessions: [
      withSidebarV2Fields(
        createStorySession({
          activity: "working",
          agentIcon: "codex",
          alias: "Local: port the inbox",
          detail: "OpenAI Codex",
          isFocused: true,
          isVisible: true,
          lastInteractionAt: minutesAgo(4),
          sessionId: "v2-mm-local-working",
          shortcutLabel: "⌘⌥1",
        }),
        { createdAt: minutesAgo(30), workingStartedAt: minutesAgo(4) },
      ),
      withSidebarV2Fields(
        createStorySession({
          agentIcon: "claude",
          alias: "Local: five days idle",
          detail: "Claude Code",
          lastInteractionAt: daysAgo(5),
          sessionId: "v2-mm-local-idle",
          shortcutLabel: "⌘⌥2",
        }),
        { createdAt: daysAgo(6) },
      ),
    ],
    title: "ghostex",
  },
  {
    groupId: "v2-mm-remote",
    isActive: false,
    kind: "workspace",
    projectContext: createStoryProjectContext("ghostex-remote", {
      gitRemoteOriginUrl: "https://github.com/ghostex/Ghostex.git",
      path: "/home/build/src/ghostex-main",
    }),
    remoteMachineContext: { machineId: "build-box", machineName: "Build Box" },
    sessions: [
      withSidebarV2Fields(
        createStorySession({
          agentIcon: "codex",
          alias: "Build Box: nightly build",
          detail: "OpenAI Codex",
          lastInteractionAt: minutesAgo(11),
          sessionId: "v2-mm-remote-active",
          shortcutLabel: "⌘⌥1",
        }),
        { createdAt: minutesAgo(45) },
      ),
      withSidebarV2Fields(
        createStorySession({
          agentIcon: "gemini",
          alias: "Build Box: five days idle",
          detail: "Gemini CLI",
          lastInteractionAt: daysAgo(5),
          sessionId: "v2-mm-remote-idle",
          shortcutLabel: "⌘⌥2",
        }),
        { createdAt: daysAgo(6) },
      ),
    ],
    title: "ghostex-main",
  },
  {
    groupId: "v2-mm-local-copy",
    isActive: false,
    kind: "workspace",
    projectContext: createStoryProjectContext("ghostex-copy", {
      gitRemoteOriginUrl: "git@github.com:ghostex/ghostex.git",
      path: "/Users/story/dev/ghostex-review",
    }),
    sessions: [
      withSidebarV2Fields(
        createStorySession({
          agentIcon: "claude",
          alias: "Second clone: review pass",
          detail: "Claude Code",
          lastInteractionAt: minutesAgo(19),
          sessionId: "v2-mm-local-copy-review",
          shortcutLabel: "⌘⌥1",
        }),
        { createdAt: hoursAgo(3) },
      ),
    ],
    title: "ghostex-review",
  },
  {
    groupId: "v2-mm-notes",
    isActive: false,
    kind: "workspace",
    /* Probed and found to have no origin: never merges, never offers the menu. */
    projectContext: createStoryProjectContext("notes", { gitRemoteOriginUrl: null }),
    sessions: [
      withSidebarV2Fields(
        createStorySession({
          agentIcon: "codex",
          alias: "Notes: weekly plan",
          detail: "OpenAI Codex",
          lastInteractionAt: minutesAgo(33),
          sessionId: "v2-mm-notes-plan",
          shortcutLabel: "⌘⌥1",
        }),
        { createdAt: hoursAgo(4) },
      ),
    ],
    title: "notes",
  },
];

/*
 * CDXC:SidebarV2LogicalProjects 2026-07-29 (P5 fix round):
 * The MONOREPO fixture: two registered projects that are two sub-directories of
 * ONE repository checkout — same `origin`, same `gitRepositoryRootPath`,
 * different paths below it. It is the only shape that can tell the three
 * grouping modes apart from each other:
 *
 * - "Repository" (the default) merges them, because they share a repository.
 * - "Repository + path" SPLITS them, because they sit at different sub-paths of
 *   the shared root. Nothing else in the fixture set can prove this: in the
 *   multi-machine fixture every member is checked out AT its repository root,
 *   so its relative path is "" and the two modes agree by construction — which
 *   is precisely how "Repository + path" shipped inert.
 * - "Keep separate" splits them by physical checkout.
 *
 * A third project outside the monorepo (its own repository) is included so the
 * splits can be shown NOT to disturb unrelated rows.
 */
const SIDEBAR_V2_MONOREPO_ROOT = "/Users/story/dev/mono";
const SIDEBAR_V2_MONOREPO_ORIGIN = "git@github.com:ghostex/mono.git";

const SIDEBAR_V2_MONOREPO_GROUPS: SidebarStoryGroup[] = [
  {
    groupId: "v2-mono-web",
    isActive: true,
    kind: "workspace",
    projectContext: createStoryProjectContext("mono-web", {
      gitRemoteOriginUrl: SIDEBAR_V2_MONOREPO_ORIGIN,
      gitRepositoryRootPath: SIDEBAR_V2_MONOREPO_ROOT,
      path: `${SIDEBAR_V2_MONOREPO_ROOT}/apps/web`,
    }),
    sessions: [
      withSidebarV2Fields(
        createStorySession({
          activity: "working",
          agentIcon: "codex",
          alias: "web: ship the new nav",
          detail: "OpenAI Codex",
          isFocused: true,
          isVisible: true,
          lastInteractionAt: minutesAgo(3),
          sessionId: "v2-mono-web-working",
          shortcutLabel: "⌘⌥1",
        }),
        { createdAt: minutesAgo(40), workingStartedAt: minutesAgo(3) },
      ),
    ],
    title: "web",
  },
  {
    groupId: "v2-mono-api",
    isActive: false,
    kind: "workspace",
    projectContext: createStoryProjectContext("mono-api", {
      gitRemoteOriginUrl: SIDEBAR_V2_MONOREPO_ORIGIN,
      gitRepositoryRootPath: SIDEBAR_V2_MONOREPO_ROOT,
      path: `${SIDEBAR_V2_MONOREPO_ROOT}/services/api`,
    }),
    sessions: [
      withSidebarV2Fields(
        createStorySession({
          agentIcon: "claude",
          alias: "api: rate limit the webhook",
          detail: "Claude Code",
          lastInteractionAt: minutesAgo(14),
          sessionId: "v2-mono-api-review",
          shortcutLabel: "⌘⌥1",
        }),
        { createdAt: hoursAgo(2) },
      ),
    ],
    title: "api",
  },
  {
    /*
     * The SAME sub-path of the same monorepo on another machine. It is what
     * makes "Repository + path" distinguishable from "Keep separate": the two
     * `apps/web` checkouts stay merged under the former and split under the
     * latter, so the three modes produce three different lists.
     */
    groupId: "v2-mono-remote-web",
    isActive: false,
    kind: "workspace",
    projectContext: createStoryProjectContext("mono-remote-web", {
      gitRemoteOriginUrl: "https://github.com/ghostex/Mono.git",
      gitRepositoryRootPath: "/home/build/mono",
      path: "/home/build/mono/apps/web",
    }),
    remoteMachineContext: { machineId: "build-box", machineName: "Build Box" },
    sessions: [
      withSidebarV2Fields(
        createStorySession({
          agentIcon: "codex",
          alias: "Build Box: web smoke run",
          detail: "OpenAI Codex",
          lastInteractionAt: minutesAgo(9),
          sessionId: "v2-mono-remote-web-smoke",
          shortcutLabel: "⌘⌥1",
        }),
        { createdAt: hoursAgo(1) },
      ),
    ],
    title: "web (build box)",
  },
  {
    groupId: "v2-mono-outsider",
    isActive: false,
    kind: "workspace",
    projectContext: createStoryProjectContext("tooling", {
      gitRemoteOriginUrl: "git@github.com:ghostex/tooling.git",
      gitRepositoryRootPath: "/Users/story/dev/tooling",
      path: "/Users/story/dev/tooling",
    }),
    sessions: [
      withSidebarV2Fields(
        createStorySession({
          agentIcon: "gemini",
          alias: "tooling: bump the linter",
          detail: "Gemini CLI",
          lastInteractionAt: minutesAgo(26),
          sessionId: "v2-mono-outsider-task",
          shortcutLabel: "⌘⌥1",
        }),
        { createdAt: hoursAgo(5) },
      ),
    ],
    title: "tooling",
  },
];

export const SIDEBAR_V2_STORY_GROUPS = {
  "sidebar-v2-empty": SIDEBAR_V2_EMPTY_GROUPS,
  "sidebar-v2-gxserver-unavailable": SIDEBAR_V2_GXSERVER_UNAVAILABLE_GROUPS,
  "sidebar-v2-inbox": SIDEBAR_V2_INBOX_GROUPS,
  "sidebar-v2-monorepo": SIDEBAR_V2_MONOREPO_GROUPS,
  "sidebar-v2-multi-machine": SIDEBAR_V2_MULTI_MACHINE_GROUPS,
} as const;
