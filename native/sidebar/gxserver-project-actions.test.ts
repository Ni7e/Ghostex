import { describe, expect, test } from "vitest";
import type { GxserverProjectDomainState } from "../../shared/gxserver-protocol";
import {
  mergeGxserverAgentsIntoSidebarStore,
  mergeGxserverProjectActionsIntoCommandsStore,
  readGxserverGitPreferences,
} from "./gxserver-project-actions";

function project(
  projectId: string,
  overrides: Partial<GxserverProjectDomainState> = {},
): GxserverProjectDomainState {
  return {
    attentionRules: {},
    completionRules: {},
    createdAt: "2026-05-30T19:59:00.000Z",
    customAgentOrder: [],
    customAgents: [],
    customCommandOrder: ["dev", "ship"],
    customCommands: [
      {
        actionType: "terminal",
        closeTerminalOnExit: false,
        command: "bun run start",
        commandId: "dev",
        isDefault: true,
        name: "Dev",
        playCompletionSound: true,
      },
      {
        actionType: "terminal",
        closeTerminalOnExit: false,
        command: "npm run ship",
        commandId: "ship",
        isDefault: false,
        name: "Ship",
        playCompletionSound: true,
      },
    ],
    deletedDefaultCommandIds: ["test"],
    gitConfig: {},
    isFavorite: false,
    isPinned: false,
    launchSettings: {},
    name: projectId,
    notificationRules: {},
    previousSessionHistory: [],
    projectBoardConfig: {},
    projectId: projectId as GxserverProjectDomainState["projectId"],
    runtimeSettings: {},
    updatedAt: "2026-05-30T19:59:00.000Z",
    ...overrides,
  };
}

describe("gxserver project actions hydration", () => {
  test("restores action cache when migrated P-id project has an empty local store", () => {
    /*
    CDXC:ProjectActions 2026-05-30-23:59:
    Regression coverage for the first gxserver migration: legacy actions were imported into SQLite but the sidebar seeded empty local P-id command stores, making the Actions menu look blank until gxserver state rehydrates the cache.
    */
    const result = mergeGxserverProjectActionsIntoCommandsStore(
      {
        P3lv0: { commands: [], deletedDefaultCommandIds: [], order: [] },
      },
      [project("P3lv0")],
    );

    expect(result.changed).toBe(true);
    expect(result.restoredOwnerIds).toEqual(["P3lv0"]);
    expect(result.store.P3lv0?.commands.map((command) => command.commandId)).toEqual([
      "dev",
      "ship",
    ]);
    expect(result.store.P3lv0?.order).toEqual(["dev", "ship"]);
    expect(result.store.P3lv0?.deletedDefaultCommandIds).toEqual(["test"]);
  });

  test("does not overwrite non-empty local action edits", () => {
    const result = mergeGxserverProjectActionsIntoCommandsStore(
      {
        P3lv0: {
          commands: [
            {
              actionType: "terminal",
              closeTerminalOnExit: false,
              command: "pnpm dev",
              commandId: "dev",
              isDefault: true,
              name: "Local Dev",
              playCompletionSound: true,
            },
          ],
          deletedDefaultCommandIds: [],
          order: ["dev"],
        },
      },
      [project("P3lv0")],
    );

    expect(result.changed).toBe(false);
    expect(result.store.P3lv0?.commands[0]?.name).toBe("Local Dev");
  });

  test("hydrates worktree projects under their parent action owner", () => {
    const result = mergeGxserverProjectActionsIntoCommandsStore(
      {
        Pparent: { commands: [], deletedDefaultCommandIds: [], order: [] },
      },
      [project("Pchild")],
      { Pchild: "Pparent" },
    );

    expect(result.changed).toBe(true);
    expect(result.restoredOwnerIds).toEqual(["Pparent"]);
    expect(result.store.Pparent?.commands.length).toBe(2);
  });

  test("replaces stale local action cache when gxserver is authoritative", () => {
    /*
    CDXC:ProjectActions 2026-06-02-10:59:
    Regression coverage for the gxserver/native ownership split: once gxserver publishes project-domain actions, the native localStorage command cache is only a render cache and must not keep older local definitions visible.
    */
    const result = mergeGxserverProjectActionsIntoCommandsStore(
      {
        P3lv0: {
          commands: [
            {
              actionType: "terminal",
              closeTerminalOnExit: false,
              command: "pnpm dev",
              commandId: "dev",
              isDefault: true,
              name: "Local Dev",
              playCompletionSound: true,
            },
          ],
          deletedDefaultCommandIds: [],
          order: ["dev"],
        },
      },
      [project("P3lv0")],
      {},
      { mode: "replaceFromGxserver" },
    );

    expect(result.changed).toBe(true);
    expect(result.store.P3lv0?.commands.map((command) => command.commandId)).toEqual([
      "dev",
      "ship",
    ]);
    expect(result.store.P3lv0?.deletedDefaultCommandIds).toEqual(["test"]);
  });

  test("clears parent action cache when gxserver parent has empty action state", () => {
    const result = mergeGxserverProjectActionsIntoCommandsStore(
      {
        Pparent: {
          commands: [
            {
              actionType: "terminal",
              closeTerminalOnExit: false,
              command: "npm run ship",
              commandId: "ship",
              isDefault: false,
              name: "Ship",
              playCompletionSound: true,
            },
          ],
          deletedDefaultCommandIds: ["test"],
          order: ["ship"],
        },
      },
      [
        project("Pparent", {
          customCommandOrder: [],
          customCommands: [],
          deletedDefaultCommandIds: [],
        }),
      ],
      {},
      { mode: "replaceFromGxserver" },
    );

    expect(result.changed).toBe(true);
    expect(result.store.Pparent).toEqual({
      commands: [],
      deletedDefaultCommandIds: [],
      order: [],
    });
  });

  test("preserves local actions on startup when gxserver has no imported action content", () => {
    /*
    CDXC:ProjectActions 2026-06-17-07:40:
    Regression coverage for the titlebar Actions data-loss report: the first
    Mac app startup after an update must not replace a non-empty local Actions
    cache with an empty gxserver project row before native can mirror the local
    definitions back into gxserver.
    */
    const result = mergeGxserverProjectActionsIntoCommandsStore(
      {
        Pparent: {
          commands: [
            {
              actionType: "terminal",
              closeTerminalOnExit: false,
              command: "npm run ship",
              commandId: "ship",
              isDefault: false,
              name: "Ship",
              playCompletionSound: true,
            },
          ],
          deletedDefaultCommandIds: ["test"],
          order: ["ship"],
        },
      },
      [
        project("Pparent", {
          customCommandOrder: [],
          customCommands: [],
          deletedDefaultCommandIds: [],
        }),
      ],
      {},
      {
        mode: "replaceFromGxserver",
        preserveLocalWhenGxserverEmpty: true,
      },
    );

    expect(result.changed).toBe(false);
    expect(result.retainedLocalOwnerIds).toEqual(["Pparent"]);
    expect(result.store.Pparent?.commands.map((command) => command.commandId)).toEqual(["ship"]);
    expect(result.store.Pparent?.deletedDefaultCommandIds).toEqual(["test"]);
  });

  test("does not clear parent actions from an empty worktree child project", () => {
    const result = mergeGxserverProjectActionsIntoCommandsStore(
      {
        Pparent: {
          commands: [
            {
              actionType: "terminal",
              closeTerminalOnExit: false,
              command: "npm run ship",
              commandId: "ship",
              isDefault: false,
              name: "Ship",
              playCompletionSound: true,
            },
          ],
          deletedDefaultCommandIds: [],
          order: ["ship"],
        },
      },
      [
        project("Pchild", {
          customCommandOrder: [],
          customCommands: [],
          deletedDefaultCommandIds: [],
        }),
      ],
      { Pchild: "Pparent" },
      { mode: "replaceFromGxserver" },
    );

    expect(result.changed).toBe(false);
    expect(result.store.Pparent?.commands.map((command) => command.commandId)).toEqual(["ship"]);
  });
});

describe("gxserver shared sidebar state hydration", () => {
  test("restores empty custom agent cache from gxserver projects", () => {
    const result = mergeGxserverAgentsIntoSidebarStore([], [], [
      project("P3lv0", {
        customAgentOrder: ["custom-shipper"],
        customAgents: [
          {
            agentId: "custom-shipper",
            command: "ship-agent",
            isDefault: false,
            name: "Shipper",
          },
        ],
      }),
    ]);

    expect(result.changed).toBe(true);
    expect(result.agents[0]?.agentId).toBe("custom-shipper");
    expect(result.order).toEqual(["custom-shipper"]);
  });

  test("does not overwrite non-empty custom agent cache", () => {
    const result = mergeGxserverAgentsIntoSidebarStore(
      [
        {
          agentId: "local-agent",
          command: "local",
          isDefault: false,
          name: "Local",
        },
      ],
      ["local-agent"],
      [
        project("P3lv0", {
          customAgentOrder: ["server-agent"],
          customAgents: [
            {
              agentId: "server-agent",
              command: "server",
              isDefault: false,
              name: "Server",
            },
          ],
        }),
      ],
    );

    expect(result.changed).toBe(false);
    expect(result.agents[0]?.agentId).toBe("local-agent");
    expect(result.order).toEqual(["local-agent"]);
  });

  test("replaces stale local custom agents when gxserver is authoritative", () => {
    const result = mergeGxserverAgentsIntoSidebarStore(
      [
        {
          agentId: "local-agent",
          command: "local",
          isDefault: false,
          name: "Local",
        },
      ],
      ["local-agent"],
      [
        project("P3lv0", {
          customAgentOrder: ["server-agent"],
          customAgents: [
            {
              agentId: "server-agent",
              command: "server",
              isDefault: false,
              name: "Server",
            },
          ],
        }),
      ],
      { mode: "replaceFromGxserver" },
    );

    expect(result.changed).toBe(true);
    expect(result.agents[0]?.agentId).toBe("server-agent");
    expect(result.order).toEqual(["server-agent"]);
  });

  test("clears local custom agents when gxserver has no custom agents", () => {
    const result = mergeGxserverAgentsIntoSidebarStore(
      [
        {
          agentId: "local-agent",
          command: "local",
          isDefault: false,
          name: "Local",
        },
      ],
      ["local-agent"],
      [project("P3lv0", { customAgentOrder: [], customAgents: [] })],
      { mode: "replaceFromGxserver" },
    );

    expect(result.changed).toBe(true);
    expect(result.agents).toEqual([]);
    expect(result.order).toEqual([]);
  });

  test("reads git preferences imported into gxserver project config", () => {
    expect(
      readGxserverGitPreferences([
        project("P3lv0", {
          gitConfig: {
            confirmCommit: true,
            generateCommitBody: false,
            primaryAction: "push",
          },
        }),
      ]),
    ).toEqual({
      confirmCommit: true,
      generateCommitBody: false,
      primaryAction: "push",
    });
  });

  test("reads the newest explicit git preferences when mirrored project rows differ", () => {
    /*
    CDXC:NativeSidebarGit 2026-06-02-14:01:
    Local-first Git preference saves update gxserver project rows asynchronously. Prefer the newest explicit gitConfig row so one stale mirrored project cannot make native replacement sync revert the just-saved toggle.
    */
    expect(
      readGxserverGitPreferences([
        project("Pold", {
          gitConfig: {
            confirmCommit: false,
            generateCommitBody: true,
            primaryAction: "commit",
          },
          updatedAt: "2026-06-02T09:00:00.000Z",
        }),
        project("Pnew", {
          gitConfig: {
            confirmCommit: true,
            generateCommitBody: false,
            primaryAction: "pr",
          },
          updatedAt: "2026-06-02T10:00:00.000Z",
        }),
      ]),
    ).toEqual({
      confirmCommit: true,
      generateCommitBody: false,
      primaryAction: "pr",
    });
  });
});
