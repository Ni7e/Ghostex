import { execFile } from "node:child_process";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  GxserverAgentSkillDiscoveryRoot,
  GxserverAgentSkillLocation,
  GxserverAgentSkillStatusRow,
  GxserverInstallAgentSkillsParams,
  GxserverInstallAgentSkillsResult,
  GxserverReadAgentSkillStatusParams,
  GxserverReadAgentSkillStatusResult,
} from "../protocol/index.js";
import type { GxserverPaths } from "./paths.js";

const execFileAsync = promisify(execFile);

export const GHOSTEX_AGENT_SKILL_NAMES = [
  "ghostex-browser-use",
  "ghostex-computer-use",
  "ghostex-agent-orchestration",
  "ghostex-generate-title",
  "ghostex-manage-beads",
] as const;

export const GHOSTEX_SKILLS_CLI_AGENT_IDS = [
  "claude-code",
  "codex",
  "cursor",
  "gemini-cli",
  "opencode",
  "pi",
  "antigravity",
  "antigravity-cli",
  "amp",
  "kiro-cli",
  "droid",
  "github-copilot",
  "qoder",
  "codebuddy",
  "rovodev",
  "hermes-agent",
] as const;

const AGENT_SKILL_INSTALL_ENV_OVERRIDES = [
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_PROFILE",
  "CODEX_HOME",
  "CODEX_PROFILE",
] as const;

const AGENT_SKILL_DISCOVERY_MAX_DEPTH = 8;

interface AgentSkillDiscoverySource {
  path: string;
  providers: readonly string[];
  sourceKind: GxserverAgentSkillDiscoveryRoot["sourceKind"];
}

interface GxserverAgentSkillInstallCommandInput {
  agentIds?: readonly string[];
  packageSource: string;
  skillNames: readonly string[];
}

export function buildGxserverAgentSkillInstallCommand(
  input: GxserverAgentSkillInstallCommandInput,
): readonly string[] {
  /*
  CDXC:AgentSkills 2026-06-19-08:25:
  Ghostex skill installs must use the external skills CLI instead of copying
  bundled folders itself. Pass explicit supported agent ids so a noninteractive
  install reaches Claude Code, Codex, and the other Ghostex-integrated agents
  without expanding into every third-party directory known by the upstream CLI.
  */
  const agentIds = normalizeAgentSkillAgentIds(input.agentIds);
  return [
    "npx",
    "--yes",
    "skills",
    "add",
    input.packageSource,
    "--skill",
    ...normalizeAgentSkillNames(input.skillNames),
    "--global",
    "--agent",
    ...agentIds,
    "--copy",
    "-y",
  ];
}

export function createGxserverAgentSkillInstallEnvironment(
  paths: Pick<GxserverPaths, "homeDir">,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const installEnvironment: NodeJS.ProcessEnv = { ...environment, HOME: paths.homeDir };
  for (const key of AGENT_SKILL_INSTALL_ENV_OVERRIDES) {
    delete installEnvironment[key];
  }
  return installEnvironment;
}

export async function installGxserverAgentSkills(
  paths: Pick<GxserverPaths, "homeDir">,
  params: GxserverInstallAgentSkillsParams,
): Promise<GxserverInstallAgentSkillsResult> {
  const packageSource = normalizePackageSource(params.packageSource);
  const skillNames = normalizeAgentSkillNames(params.skillNames);
  const command = buildGxserverAgentSkillInstallCommand({
    agentIds: params.agentIds,
    packageSource,
    skillNames,
  });
  const [executable, ...args] = command;
  const result = await execFileAsync(executable, args, {
    cwd: /^[a-z][a-z0-9+.-]*:/i.test(packageSource) ? undefined : path.dirname(packageSource),
    env: createGxserverAgentSkillInstallEnvironment(paths),
    maxBuffer: 10 * 1024 * 1024,
  });
  const status = await readGxserverAgentSkillStatus(paths, {
    repositoryPaths: params.repositoryPaths,
    skillNames,
  });
  return {
    ...status,
    installCommand: command,
    packageSource,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

export async function readGxserverAgentSkillStatus(
  paths: Pick<GxserverPaths, "homeDir">,
  params: GxserverReadAgentSkillStatusParams = {},
): Promise<GxserverReadAgentSkillStatusResult> {
  /*
  CDXC:AgentSkills 2026-06-19-08:25:
  Skill readiness must be derived from the same global and repository roots used
  by the external skills installer ecosystem, not Ghostex's older non-dot shared
  folder. Keep discovery centralized in gxserver so future clients do not probe
  different Claude/Codex/shared locations.
  */
  const skillNames = normalizeAgentSkillNames(params.skillNames);
  const roots = createGxserverAgentSkillDiscoverySources(paths, params.repositoryPaths);
  const locationsBySkill = new Map(skillNames.map((skillName) => [skillName, [] as GxserverAgentSkillLocation[]]));
  for (const root of roots) {
    for (const location of await discoverSkillLocations(root, skillNames)) {
      locationsBySkill.get(location.skillName)?.push(location);
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    homeDir: paths.homeDir,
    roots,
    skills: skillNames.map<GxserverAgentSkillStatusRow>((skillName) => {
      const locations = locationsBySkill.get(skillName) ?? [];
      return {
        installed: locations.length > 0,
        locations,
        skillName,
      };
    }),
    type: "agentSkillStatus",
  };
}

export function createGxserverAgentSkillDiscoverySources(
  paths: Pick<GxserverPaths, "homeDir">,
  repositoryPaths: readonly string[] = [],
): readonly GxserverAgentSkillDiscoveryRoot[] {
  const homeSources: readonly AgentSkillDiscoverySource[] = [
    {
      path: path.join(paths.homeDir, ".codex", "skills"),
      providers: ["codex"],
      sourceKind: "global",
    },
    {
      path: path.join(paths.homeDir, ".agents", "skills"),
      providers: ["agent-skills"],
      sourceKind: "global",
    },
    {
      path: path.join(paths.homeDir, ".claude", "skills"),
      providers: ["claude"],
      sourceKind: "global",
    },
    {
      path: path.join(paths.homeDir, ".codex", "plugins", "cache"),
      providers: ["codex", "agent-skills"],
      sourceKind: "pluginCache",
    },
  ];
  const repositorySources = repositoryPaths.flatMap((repositoryPath) => {
    const normalizedPath = normalizeExistingAbsolutePath(repositoryPath);
    if (!normalizedPath) {
      return [];
    }
    return [
      {
        path: path.join(normalizedPath, ".agents", "skills"),
        providers: ["agent-skills"],
        sourceKind: "repository" as const,
      },
      {
        path: path.join(normalizedPath, ".claude", "skills"),
        providers: ["claude"],
        sourceKind: "repository" as const,
      },
    ];
  });
  return uniqueSkillDiscoveryRoots([...homeSources, ...repositorySources]);
}

export function normalizeAgentSkillNames(skillNames: readonly string[] | undefined): readonly string[] {
  const normalized = (skillNames ?? GHOSTEX_AGENT_SKILL_NAMES)
    .map((skillName) => skillName.trim())
    .filter(Boolean);
  const valid = new Set(GHOSTEX_AGENT_SKILL_NAMES);
  const invalid = normalized.filter((skillName) => !valid.has(skillName as typeof GHOSTEX_AGENT_SKILL_NAMES[number]));
  if (invalid.length > 0) {
    throw new Error(`Unknown Ghostex agent skill: ${invalid.join(", ")}`);
  }
  return [...new Set(normalized)];
}

export function normalizeAgentSkillAgentIds(agentIds: readonly string[] | undefined): readonly string[] {
  const normalized = (agentIds && agentIds.length > 0 ? agentIds : GHOSTEX_SKILLS_CLI_AGENT_IDS)
    .flatMap((agentId) => String(agentId).split(","))
    .map((agentId) => agentId.trim())
    .filter(Boolean);
  return [...new Set(normalized)];
}

async function discoverSkillLocations(
  root: GxserverAgentSkillDiscoveryRoot,
  skillNames: readonly string[],
): Promise<Array<GxserverAgentSkillLocation & { skillName: string }>> {
  if (!(await isExistingDirectory(root.path))) {
    return [];
  }
  const wanted = new Set(skillNames);
  const matches: Array<GxserverAgentSkillLocation & { skillName: string }> = [];
  const seenRealPaths = new Set<string>();
  await walkSkillRoot(root, root.path, AGENT_SKILL_DISCOVERY_MAX_DEPTH, seenRealPaths, async (directoryPath, skillFilePath) => {
    const discoveredNames = await readSkillNameCandidates(directoryPath, skillFilePath);
    const skillName = discoveredNames.find((candidate) => wanted.has(candidate));
    if (!skillName) {
      return;
    }
    matches.push({
      directoryPath,
      providers: root.providers,
      rootPath: root.path,
      skillFilePath,
      skillName,
      sourceKind: root.sourceKind,
    });
  });
  return matches;
}

async function walkSkillRoot(
  root: GxserverAgentSkillDiscoveryRoot,
  directoryPath: string,
  remainingDepth: number,
  seenRealPaths: Set<string>,
  visitSkill: (directoryPath: string, skillFilePath: string) => Promise<void>,
): Promise<void> {
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(directoryPath);
  } catch {
    return;
  }
  if (seenRealPaths.has(resolvedPath)) {
    return;
  }
  seenRealPaths.add(resolvedPath);

  const skillFilePath = path.join(directoryPath, "SKILL.md");
  if (await isExistingFile(skillFilePath)) {
    await visitSkill(directoryPath, skillFilePath);
    return;
  }
  if (remainingDepth <= 0) {
    return;
  }
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }
    const childPath = path.join(directoryPath, entry.name);
    const childStat = await lstat(childPath).catch(() => undefined);
    if (!childStat) {
      continue;
    }
    if (childStat.isSymbolicLink() && root.sourceKind === "repository") {
      continue;
    }
    await walkSkillRoot(root, childPath, remainingDepth - 1, seenRealPaths, visitSkill);
  }
}

async function readSkillNameCandidates(directoryPath: string, skillFilePath: string): Promise<readonly string[]> {
  const candidates = new Set<string>([path.basename(directoryPath)]);
  const markdown = await readFile(skillFilePath, "utf8").catch(() => "");
  const frontmatterName = markdown.match(/^---\s*[\r\n](?<body>[\s\S]*?)[\r\n]---/)?.groups?.body.match(/^\s*name:\s*["']?(?<name>[^"'\r\n]+)["']?\s*$/m)?.groups?.name;
  if (frontmatterName?.trim()) {
    candidates.add(frontmatterName.trim());
  }
  const headingName = markdown.match(/^#\s+(?<name>.+?)\s*$/m)?.groups?.name;
  if (headingName?.trim()) {
    candidates.add(headingName.trim());
  }
  return [...candidates];
}

function normalizePackageSource(packageSource: string | undefined): string {
  const normalized = packageSource?.trim();
  if (!normalized) {
    throw new Error("Agent skill installs require --source <skills-package-path>.");
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) {
    return normalized;
  }
  return path.resolve(normalized);
}

function normalizeExistingAbsolutePath(candidate: string): string | undefined {
  const normalized = candidate.trim();
  if (!normalized) {
    return undefined;
  }
  return path.resolve(normalized);
}

async function isExistingDirectory(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

async function isExistingFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function uniqueSkillDiscoveryRoots(sources: readonly AgentSkillDiscoverySource[]): readonly GxserverAgentSkillDiscoveryRoot[] {
  const seen = new Set<string>();
  const roots: GxserverAgentSkillDiscoveryRoot[] = [];
  for (const source of sources) {
    const normalizedPath = path.resolve(source.path.replace(/^~(?=$|\/)/, os.homedir()));
    const key = `${source.sourceKind}:${normalizedPath}:${source.providers.join(",")}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    roots.push({
      path: normalizedPath,
      providers: source.providers,
      sourceKind: source.sourceKind,
    });
  }
  return roots;
}
