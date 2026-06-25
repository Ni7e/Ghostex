import { describe, expect, test } from "vitest";
import type { SidebarCommandButton } from "../../shared/sidebar-commands";
import {
  createGpuiSidebarCommandSessionIndicators,
  type GpuiCommandPaneSessionSummary,
} from "./phase1-gxserver-runtime";

const BASE_COMMAND = {
  closeTerminalOnExit: false,
  icon: "terminal",
  isDefault: false,
  playCompletionSound: true,
} satisfies Pick<
  SidebarCommandButton,
  "closeTerminalOnExit" | "icon" | "isDefault" | "playCompletionSound"
>;

describe("createGpuiSidebarCommandSessionIndicators", () => {
  test("matches terminal Actions by command id first and normalized title second", () => {
    const commands: SidebarCommandButton[] = [
      {
        ...BASE_COMMAND,
        actionType: "terminal",
        command: "npm run build",
        commandId: "build",
        name: "Build",
      },
      {
        ...BASE_COMMAND,
        actionType: "terminal",
        command: "12345678901234567890with-extra-command-text",
        commandId: "unnamed",
        name: "",
      },
      {
        ...BASE_COMMAND,
        actionType: "terminal",
        command: "npm run deploy",
        commandId: "deploy",
        name: "Deploy",
      },
      {
        ...BASE_COMMAND,
        actionType: "browser",
        commandId: "docs",
        name: "Docs",
        url: "https://example.invalid/docs",
      },
    ];
    const sessions: GpuiCommandPaneSessionSummary[] = [
      {
        commandId: "old-build",
        sessionId: "session-build",
        status: "idle",
        title: "  build  ",
      },
      {
        commandId: "unnamed",
        isActive: true,
        sessionId: "session-unnamed",
        status: "running",
        title: "12345678901234567890",
      },
      {
        sessionId: "session-deploy-title-only",
        status: "idle",
        title: "Deploy",
      },
      {
        commandId: "deploy",
        sessionId: "session-deploy-exact",
        status: "error",
        title: "Deploy",
      },
      {
        commandId: "docs",
        sessionId: "session-docs",
        status: "running",
        title: "Docs",
      },
    ];

    expect(createGpuiSidebarCommandSessionIndicators(commands, sessions)).toEqual([
      {
        commandId: "build",
        isActive: false,
        sessionId: "session-build",
        status: "idle",
        title: "  build  ",
      },
      {
        commandId: "unnamed",
        isActive: true,
        sessionId: "session-unnamed",
        status: "running",
        title: "12345678901234567890",
      },
      {
        commandId: "deploy",
        isActive: false,
        sessionId: "session-deploy-exact",
        status: "error",
        title: "Deploy",
      },
    ]);
  });
});
