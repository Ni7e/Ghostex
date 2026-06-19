import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildGxserverAgentSkillInstallCommand,
  createGxserverAgentSkillDiscoverySources,
  createGxserverAgentSkillInstallEnvironment,
  readGxserverAgentSkillStatus,
} from "../src/agent-skills.js";

test("agent skill install command delegates to npx skills for supported agents", () => {
  /*
  CDXC:AgentSkills 2026-06-19-08:25:
  Ghostex installs bundled agent skills through the external skills CLI with an
  explicit supported-agent list, so CLI/app setup no longer copies only one
  legacy shared folder and misses Claude Code's global skill directory.
  */
  const command = buildGxserverAgentSkillInstallCommand({
    packageSource: "/Applications/Ghostex.app/Contents/Resources/CLI/skills",
    skillNames: ["ghostex-browser-use"],
  });

  assert.deepEqual(command.slice(0, 8), [
    "npx",
    "--yes",
    "skills",
    "add",
    "/Applications/Ghostex.app/Contents/Resources/CLI/skills",
    "--skill",
    "ghostex-browser-use",
    "--global",
  ]);
  assert.ok(command.includes("--copy"));
  assert.ok(command.includes("-y"));
  assert.ok(command.includes("claude-code"));
  assert.ok(command.includes("codex"));
  assert.ok(command.includes("cursor"));
  assert.ok(command.includes("gemini-cli"));
  assert.ok(command.includes("opencode"));
  assert.ok(command.includes("pi"));
});

test("agent skill install environment removes profile overrides", () => {
  const env = createGxserverAgentSkillInstallEnvironment(
    { homeDir: "/tmp/ghostex-home" },
    {
      CLAUDE_CONFIG_DIR: "/tmp/profile",
      CLAUDE_PROFILE: "personal",
      CODEX_HOME: "/tmp/codex-profile",
      CODEX_PROFILE: "personal",
      PATH: "/usr/bin",
    },
  );

  assert.equal(env.HOME, "/tmp/ghostex-home");
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.CLAUDE_CONFIG_DIR, undefined);
  assert.equal(env.CLAUDE_PROFILE, undefined);
  assert.equal(env.CODEX_HOME, undefined);
  assert.equal(env.CODEX_PROFILE, undefined);
});

test("agent skill status checks global and repository skill roots", async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "gxserver-agent-skills-"));
  const repoDir = await mkdtemp(path.join(os.tmpdir(), "gxserver-agent-skills-repo-"));
  try {
    await writeSkill(path.join(homeDir, ".claude", "skills", "ghostex-browser-use"), "ghostex-browser-use");
    await writeSkill(path.join(homeDir, ".agents", "skills", "ghostex-computer-use"), "ghostex-computer-use");
    await writeSkill(
      path.join(homeDir, ".codex", "plugins", "cache", "plugin", "skills", "ghostex-generate-title"),
      "ghostex-generate-title",
    );
    await writeSkill(
      path.join(repoDir, ".agents", "skills", "ghostex-agent-orchestration"),
      "ghostex-agent-orchestration",
    );

    const roots = createGxserverAgentSkillDiscoverySources({ homeDir }, [repoDir]);
    const rootPaths = roots.map((root) => root.path);
    assert.ok(rootPaths.includes(path.join(homeDir, ".codex", "skills")));
    assert.ok(rootPaths.includes(path.join(homeDir, ".agents", "skills")));
    assert.ok(rootPaths.includes(path.join(homeDir, ".claude", "skills")));
    assert.ok(rootPaths.includes(path.join(homeDir, ".codex", "plugins", "cache")));
    assert.ok(rootPaths.includes(path.join(repoDir, ".agents", "skills")));
    assert.ok(rootPaths.includes(path.join(repoDir, ".claude", "skills")));
    assert.equal(rootPaths.includes(path.join(homeDir, "agents", "skills")), false);

    const status = await readGxserverAgentSkillStatus({ homeDir }, { repositoryPaths: [repoDir] });
    const byName = new Map(status.skills.map((skill) => [skill.skillName, skill]));

    assert.equal(byName.get("ghostex-browser-use")?.installed, true);
    assert.equal(byName.get("ghostex-computer-use")?.installed, true);
    assert.equal(byName.get("ghostex-agent-orchestration")?.installed, true);
    assert.equal(byName.get("ghostex-generate-title")?.installed, true);
    assert.equal(byName.get("ghostex-manage-beads")?.installed, false);
    assert.equal(byName.get("ghostex-browser-use")?.locations[0]?.providers[0], "claude");
  } finally {
    await rm(homeDir, { force: true, recursive: true });
    await rm(repoDir, { force: true, recursive: true });
  }
});

async function writeSkill(directoryPath: string, skillName: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true });
  await writeFile(path.join(directoryPath, "SKILL.md"), `# ${skillName}\n\nUse this skill for tests.\n`, "utf8");
}
