#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  installGxserverAgentSkills,
  readGxserverAgentSkillStatus,
} from "./agent-skills.js";
import { readGxserverBuildIdentity } from "./build-identity.js";
import {
  getGxserverStatus,
  startGxserverBackground,
  stopGxserverAndZmxSessions,
  stopGxserverControlPlane,
} from "./lifecycle.js";
import { getUnsupportedNodeMessage } from "./node-version.js";
import { runGxserverForeground } from "./server.js";

const GXSERVER_COLOR_DISABLING_ENVIRONMENT_KEYS = [
  "ANSI_COLORS_DISABLED",
  "NO_COLOR",
  "NODE_DISABLE_COLORS",
] as const;

removeGxserverColorDisablingEnvironment();

const cliDir = dirname(fileURLToPath(import.meta.url));
const version = await readPackageVersion(cliDir);
const buildIdentity = await readGxserverBuildIdentity(cliDir, version);

try {
  const unsupportedNodeMessage = getUnsupportedNodeMessage();
  if (unsupportedNodeMessage) {
    throw new Error(unsupportedNodeMessage);
  }

  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--foreground") {
    const result = await runGxserverForeground({ buildIdentity, version });
    if (result.reused) {
      console.log("gxserver is already running and uses the expected protocol.");
    }
  } else if (command === "start") {
    printStatus(await startGxserverBackground({ buildIdentity, version }), rest.includes("--json"));
  } else if (command === "stop") {
    printStatus(await stopGxserverControlPlane({ buildIdentity, version }), rest.includes("--json"));
  } else if (command === "stop-all") {
    printStatus(await stopGxserverAndZmxSessions({ buildIdentity, version }), rest.includes("--json"));
  } else if (command === "status") {
    printStatus(await getGxserverStatus({ buildIdentity, version }), rest.includes("--json"));
  } else if (command === "agent-skills") {
    await runAgentSkillsCommand(rest);
  } else if (command === "--version" || command === "version") {
    console.log(version);
  } else if (command === "--help" || command === "help") {
    printHelp();
  } else {
    throw new Error(`Unknown gxserver command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function printStatus(status: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  if (
    typeof status === "object" &&
    status !== null &&
    "message" in status &&
    typeof status.message === "string"
  ) {
    console.log(status.message);
    return;
  }
  console.log(String(status));
}

function printHelp(): void {
  console.log(`gxserver ${version}

Usage:
  gxserver           Run gxserver in the foreground
  gxserver start     Start gxserver in the background
  gxserver stop      Stop only the gxserver control plane
  gxserver stop-all  Stop gxserver and kill tracked zmx sessions
  gxserver status    Print gxserver runtime state
  gxserver agent-skills status [skill...] [--json]
  gxserver agent-skills install <skill...> --source <path> [--json]
  gxserver --version Print the gxserver package version
`);
}

async function runAgentSkillsCommand(args: readonly string[]): Promise<void> {
  /*
  CDXC:AgentSkills 2026-06-19-08:25:
  gxserver is the command owner for Ghostex agent skill setup. Keep direct status
  and install commands here so the app CLI can delegate without carrying
  filesystem discovery rules or external skills CLI argument construction.
  */
  const [subcommand = "status", ...rest] = args;
  const parsed = parseCliArgs(rest);
  if (subcommand === "help" || subcommand === "-h" || subcommand === "--help") {
    printAgentSkillsHelp();
    return;
  }
  if (subcommand === "status") {
    const result = await readGxserverAgentSkillStatus({ homeDir: process.env.HOME || os.homedir() }, {
      repositoryPaths: parsed.values.repository,
      skillNames: parsed.rest,
    });
    if (parsed.flags.has("json")) {
      printStatus(result, true);
    } else {
      printAgentSkillStatus(result);
    }
    return;
  }
  if (subcommand === "install") {
    const source = parsed.values.source?.[0] ?? parsed.values.packageSource?.[0];
    const result = await installGxserverAgentSkills({ homeDir: process.env.HOME || os.homedir() }, {
      agentIds: parsed.values.agent ?? parsed.values.agents,
      packageSource: source,
      repositoryPaths: parsed.values.repository,
      skillNames: parsed.rest,
    });
    if (parsed.flags.has("json")) {
      printStatus(result, true);
    } else {
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      printAgentSkillStatus(result);
    }
    return;
  }
  throw new Error(`Unknown gxserver agent-skills command: ${subcommand}`);
}

function printAgentSkillStatus(status: { skills: readonly { installed: boolean; locations: readonly { directoryPath: string }[]; skillName: string }[] }): void {
  for (const skill of status.skills) {
    const marker = skill.installed ? "installed" : "missing";
    console.log(`${skill.skillName}: ${marker}`);
    for (const location of skill.locations) {
      console.log(`  ${location.directoryPath}`);
    }
  }
}

function printAgentSkillsHelp(): void {
  console.log(`gxserver agent-skills

Usage:
  gxserver agent-skills status [skill...] [--repository path] [--json]
  gxserver agent-skills install <skill...> --source <skills-package-path> [--agent id...] [--json]
`);
}

function parseCliArgs(args: readonly string[]): {
  flags: Set<string>;
  rest: string[];
  values: Record<string, string[]>;
} {
  const flags = new Set<string>();
  const rest: string[] = [];
  const values: Record<string, string[]> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      rest.push(...args.slice(index + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      rest.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const equalsIndex = body.indexOf("=");
    const key = toCamelCase(equalsIndex >= 0 ? body.slice(0, equalsIndex) : body);
    if (equalsIndex >= 0) {
      pushArgValue(values, key, body.slice(equalsIndex + 1));
      continue;
    }
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags.add(key);
      continue;
    }
    pushArgValue(values, key, next);
    index += 1;
    if (key === "agent" || key === "agents") {
      while (index + 1 < args.length && !args[index + 1].startsWith("--")) {
        pushArgValue(values, key, args[index + 1]);
        index += 1;
      }
    }
  }
  return { flags, rest, values };
}

function pushArgValue(values: Record<string, string[]>, key: string, value: string): void {
  values[key] ??= [];
  values[key].push(value);
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

async function readPackageVersion(cliDir: string): Promise<string> {
  const packageJsonPath = resolve(cliDir, "..", "..", "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: string };
  return packageJson.version ?? "0.0.0";
}

function removeGxserverColorDisablingEnvironment(): void {
  /*
  CDXC:GxserverColorEnv 2026-06-07-00:38:
  gxserver owns color-capable terminal and agent provider lifecycles. Strip NO_COLOR-style variables at CLI process start so direct daemon launches cannot store or propagate color-disabled process.env snapshots.
  */
  for (const key of GXSERVER_COLOR_DISABLING_ENVIRONMENT_KEYS) {
    delete process.env[key];
  }
}
