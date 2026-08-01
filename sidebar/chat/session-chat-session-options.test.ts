import { describe, expect, it } from "vitest";
import {
  codexEffortChoices,
  reconcileSessionChatOptionsFromCommand,
  seedSessionChatOptionState,
  sessionChatOptionCommandNames,
  sessionChatOptionsPillLabel,
  sessionChatOptionTracksValue,
  sessionChatOptionValueLabel,
  sessionChatSessionOptionCatalog,
  setSessionChatOptionValue,
} from "./session-chat-session-options";
import { classifySessionChatSend } from "./session-chat-send-classification";
import { sessionChatSlashCommandsForAgent } from "./session-chat-slash-commands";

function catalogFor(agent: string) {
  const catalog = sessionChatSessionOptionCatalog(agent);
  if (!catalog) {
    throw new Error(`expected a catalog for ${agent}`);
  }
  return catalog;
}

describe("session chat session-option catalogs", () => {
  it("gives agents without a catalog no pills at all", () => {
    expect(sessionChatSessionOptionCatalog("grok")).toBeNull();
    expect(sessionChatSessionOptionCatalog("pi")).toBeNull();
    expect(sessionChatSessionOptionCatalog(null)).toBeNull();
    expect(sessionChatOptionCommandNames("grok")).toEqual([]);
  });

  it("shares one catalog between claude and openclaude", () => {
    expect(sessionChatSessionOptionCatalog("openclaude")).toBe(
      sessionChatSessionOptionCatalog("claude"),
    );
  });

  it("seeds claude from the catalog defaults", () => {
    const catalog = catalogFor("claude");
    const state = seedSessionChatOptionState(catalog);
    expect(state.model).toEqual({ value: "sonnet", source: "default" });
    expect(state.effort).toEqual({ value: "high", source: "default" });
    expect(sessionChatOptionValueLabel(catalog.model, state)).toBe("Sonnet 5");
  });

  it("varies claude's options by model", () => {
    const catalog = catalogFor("claude");
    const ids = (model: string) =>
      catalog.optionsForModel(model).map((descriptor) => descriptor.id);
    // Haiku has no effort tiers; only Opus offers fast mode; mode is always
    // available and sorts last.
    expect(ids("sonnet")).toEqual(["effort", "mode"]);
    expect(ids("haiku")).toEqual(["mode"]);
    expect(ids("opus")).toEqual(["effort", "fastMode", "mode"]);
  });

  it("delivers claude values as slash commands", () => {
    const catalog = catalogFor("claude");
    const model = catalog.model;
    if (model.dispatch.kind !== "command") {
      throw new Error("claude model must dispatch a command");
    }
    expect(model.dispatch.build("opus")).toBe("/model opus");
    const effort = catalog
      .optionsForModel("sonnet")
      .find((descriptor) => descriptor.id === "effort");
    if (effort?.dispatch.kind !== "command") {
      throw new Error("claude effort must dispatch a command");
    }
    expect(effort.dispatch.build("xhigh")).toBe("/effort xhigh");
    const fast = catalog
      .optionsForModel("opus")
      .find((descriptor) => descriptor.id === "fastMode");
    expect(fast?.dispatch).toEqual({ kind: "toggle-command", command: "/fast" });
  });

  it("cycles claude's mode with a real Shift+Tab keystroke", () => {
    const mode = catalogFor("claude")
      .optionsForModel("sonnet")
      .find((descriptor) => descriptor.id === "mode");
    expect(mode?.actionLabel).toBe("Cycle mode (Shift+Tab)");
    expect(mode?.dispatch).toEqual({
      kind: "key",
      key: "shift-tab",
      marker: "Sent Shift+Tab (mode cycle)",
    });
    // Keys carry no value, so they never label a pill.
    expect(mode && sessionChatOptionTracksValue(mode)).toBe(false);
  });

  it("routes codex model and effort through the agent picker", () => {
    const catalog = catalogFor("codex");
    expect(catalog.model.dispatch).toEqual({ kind: "agent-picker", command: "/model" });
    const effort = catalog
      .optionsForModel("gpt-5.6-sol")
      .find((descriptor) => descriptor.id === "effort");
    expect(effort?.dispatch).toEqual({ kind: "agent-picker", command: "/model" });
    // Agent-picker values are never claimed locally.
    expect(seedSessionChatOptionState(catalog)).toEqual({});
    expect(sessionChatOptionValueLabel(catalog.model, {})).toBeNull();
  });

  it("drops extra-high reasoning effort on codex luna only", () => {
    expect(codexEffortChoices("gpt-5.6-sol").map((choice) => choice.value)).toContain(
      "xhigh",
    );
    expect(codexEffortChoices("gpt-5.6-luna").map((choice) => choice.value)).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
    ]);
  });

  it("gives codex a plan-mode entry that types /plan", () => {
    const mode = catalogFor("codex")
      .optionsForModel("gpt-5.6-sol")
      .find((descriptor) => descriptor.id === "mode");
    if (mode?.dispatch.kind !== "command") {
      throw new Error("codex mode must dispatch a command");
    }
    expect(mode.dispatch.build("")).toBe("/plan");
    expect(mode.actionLabel).toBe("Switch to Plan mode");
    // …and the picker offers it too, so both routes classify identically.
    expect(
      sessionChatSlashCommandsForAgent("codex").map((command) => command.name),
    ).toEqual(expect.arrayContaining(["plan", "permissions"]));
  });

  it("classifies every dispatched pill command as a command marker", () => {
    for (const agent of ["claude", "codex"]) {
      const catalog = catalogFor(agent);
      const names = [
        ...sessionChatSlashCommandsForAgent(agent).map((command) => command.name),
        ...sessionChatOptionCommandNames(agent),
      ];
      const commands: string[] = [];
      if (catalog.model.dispatch.kind === "command") {
        commands.push(catalog.model.dispatch.build("opus"));
      }
      for (const choice of catalog.model.choices ?? []) {
        for (const descriptor of catalog.optionsForModel(choice.value)) {
          if (descriptor.dispatch.kind === "command") {
            commands.push(descriptor.dispatch.build(descriptor.choices?.[0]?.value ?? ""));
          } else if (descriptor.dispatch.kind !== "key") {
            commands.push(descriptor.dispatch.command);
          }
        }
      }
      expect(commands.length).toBeGreaterThan(0);
      for (const command of commands) {
        expect([command, classifySessionChatSend(command, names)]).toEqual([
          command,
          "command",
        ]);
      }
    }
  });

  it("reconciles a hand-typed command into the pills", () => {
    const catalog = catalogFor("claude");
    const seeded = seedSessionChatOptionState(catalog);
    const afterModel = reconcileSessionChatOptionsFromCommand(
      catalog,
      seeded,
      "/model opus",
    );
    expect(afterModel.model).toEqual({ value: "opus", source: "dispatched" });
    const afterEffort = reconcileSessionChatOptionsFromCommand(
      catalog,
      afterModel,
      "  /effort   max  ",
    );
    expect(afterEffort.effort).toEqual({ value: "max", source: "dispatched" });
    // Prose and unknown arguments leave the state untouched (identity).
    expect(reconcileSessionChatOptionsFromCommand(catalog, afterEffort, "hello")).toBe(
      afterEffort,
    );
    expect(
      reconcileSessionChatOptionsFromCommand(catalog, afterEffort, "/model nonsense"),
    ).toBe(afterEffort);
  });

  it("labels the options pill with known values joined by a middle dot", () => {
    const catalog = catalogFor("claude");
    let state = seedSessionChatOptionState(catalog);
    state = setSessionChatOptionValue(state, "model", "opus", "dispatched");
    const descriptors = catalog.optionsForModel("opus");
    expect(sessionChatOptionsPillLabel(descriptors, state)).toBe("High");
    state = setSessionChatOptionValue(state, "effort", "xhigh", "dispatched");
    expect(sessionChatOptionsPillLabel(descriptors, state)).toBe("Extra high");
    // Nothing known → the pill falls back to its own name.
    expect(sessionChatOptionsPillLabel(descriptors, {})).toBeNull();
  });

  it("keeps a stored value only when the catalog still offers it", () => {
    const catalog = catalogFor("claude");
    const kept = seedSessionChatOptionState(catalog, {
      model: { value: "fable", source: "dispatched" },
    });
    expect(kept.model).toEqual({ value: "fable", source: "dispatched" });
    const dropped = seedSessionChatOptionState(catalog, {
      model: { value: "retired-model", source: "dispatched" },
    });
    expect(dropped.model).toEqual({ value: "sonnet", source: "default" });
  });
});
