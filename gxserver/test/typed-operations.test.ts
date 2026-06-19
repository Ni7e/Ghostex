import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildBeadsCommand,
  buildGitCommand,
  buildGitHubCommand,
  buildWorktreeCommand,
  GxserverTypedOperationError,
  isExpectedNonZeroTypedOperationResult,
  runBeadsAction,
  runGitAction,
  runProjectSetupCommand,
  runWorktreeAction,
  typedOperationLogLevel,
} from "../src/typed-operations.js";
import {
  normalizeExistingDirectoryPath,
  resolveBeadsCwdForTypedOperation,
  resolveProjectOperationDirectory,
} from "../src/project-paths.js";
import type { GxserverProjectDomainState, GxserverProjectId } from "../protocol/index.js";

test("Git command construction is allowlisted and keeps file paths project-relative", () => {
  const status = buildGitCommand({ action: "status", projectPath: "/repo" }, "/repo");
  assert.deepEqual(status, { args: ["status", "--short", "--branch"], cwd: "/repo", executable: "git" });

  const addAll = buildGitCommand({ action: "addAll", filePaths: ["src/index.ts"], projectPath: "/repo" }, "/repo");
  assert.deepEqual(addAll.args, ["add", "-A", "--", "src/index.ts"]);
  assert.deepEqual(addAll.resultCommand?.args, ["add", "-A", "--", "<1 files>"]);

  const commit = buildGitCommand(
    { action: "commit", messageBody: "Details", messageSubject: "Ship useful change", noVerify: true, projectPath: "/repo" },
    "/repo",
  );
  assert.deepEqual(commit.args, ["commit", "--no-verify", "-F", "-"]);
  assert.deepEqual(commit.resultCommand?.args, ["commit", "--no-verify", "-F", "<stdin>"]);
  assert.equal(commit.stdin, "Ship useful change\n\nDetails\n");

  assert.throws(
    () => buildGitCommand({ action: "countFileLines", filePaths: ["src/index.ts"], projectPath: "/repo" }, "/repo"),
    /handled by gxserver without spawning/,
  );

  const diff = buildGitCommand({ action: "diff", filePath: "src/index.ts", projectPath: "/repo" }, "/repo");
  assert.deepEqual(diff.args, ["diff", "--", "src/index.ts"]);

  const diffCached = buildGitCommand({ action: "diffCached", projectPath: "/repo" }, "/repo");
  assert.deepEqual(diffCached.args, ["diff", "--cached"]);

  const diffCachedNoExt = buildGitCommand({ action: "diffCachedNoExt", filePath: "src/index.ts", projectPath: "/repo" }, "/repo");
  assert.deepEqual(diffCachedNoExt.args, ["diff", "--cached", "--no-ext-diff", "--", "src/index.ts"]);

  const diffCachedStat = buildGitCommand({ action: "diffCachedStat", projectPath: "/repo" }, "/repo");
  assert.deepEqual(diffCachedStat.args, ["diff", "--cached", "--stat"]);

  const diffNoExt = buildGitCommand({ action: "diffNoExt", filePath: "src/index.ts", projectPath: "/repo" }, "/repo");
  assert.deepEqual(diffNoExt.args, ["diff", "--no-ext-diff", "--", "src/index.ts"]);

  const diffNoIndexAgainstNull = buildGitCommand(
    { action: "diffNoIndexAgainstNull", filePath: "src/index.ts", projectPath: "/repo" },
    "/repo",
  );
  assert.deepEqual(diffNoIndexAgainstNull.args, ["diff", "--no-index", "--no-ext-diff", "--", "/dev/null", "src/index.ts"]);

  const diffNumstat = buildGitCommand({ action: "diffNumstat", projectPath: "/repo" }, "/repo");
  assert.deepEqual(diffNumstat.args, ["diff", "--numstat", "HEAD"]);

  const getOriginRemoteUrl = buildGitCommand({ action: "getOriginRemoteUrl", projectPath: "/repo" }, "/repo");
  assert.deepEqual(getOriginRemoteUrl.args, ["remote", "get-url", "origin"]);

  const isInsideWorkTree = buildGitCommand({ action: "isInsideWorkTree", projectPath: "/repo" }, "/repo");
  assert.deepEqual(isInsideWorkTree.args, ["rev-parse", "--is-inside-work-tree"]);

  const isUntrackedFile = buildGitCommand({ action: "isUntrackedFile", filePath: "src/index.ts", projectPath: "/repo" }, "/repo");
  assert.deepEqual(isUntrackedFile.args, ["ls-files", "--others", "--exclude-standard", "--", "src/index.ts"]);

  const listRemotes = buildGitCommand({ action: "listRemotes", projectPath: "/repo" }, "/repo");
  assert.deepEqual(listRemotes.args, ["remote"]);

  const listUntracked = buildGitCommand({ action: "listUntracked", projectPath: "/repo" }, "/repo");
  assert.deepEqual(listUntracked.args, ["ls-files", "--others", "--exclude-standard", "-z"]);

  const statusPorcelain = buildGitCommand({ action: "statusPorcelain", projectPath: "/repo" }, "/repo");
  assert.deepEqual(statusPorcelain.args, ["status", "--porcelain"]);

  const upstreamCounts = buildGitCommand({ action: "upstreamCounts", projectPath: "/repo" }, "/repo");
  assert.deepEqual(upstreamCounts.args, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);

  const verifyRef = buildGitCommand({ action: "verifyRef", projectPath: "/repo", ref: "main" }, "/repo");
  assert.deepEqual(verifyRef.args, ["rev-parse", "--verify", "main"]);

  const checkout = buildGitCommand({ action: "checkout", branch: "main", projectPath: "/repo" }, "/repo");
  assert.deepEqual(checkout.args, ["checkout", "main"]);

  const checkoutNewBranch = buildGitCommand({ action: "checkoutNewBranch", branch: "feature/a", projectPath: "/repo" }, "/repo");
  assert.deepEqual(checkoutNewBranch.args, ["checkout", "-b", "feature/a"]);

  const deleteLocalBranch = buildGitCommand({ action: "deleteLocalBranch", branch: "feature/a", projectPath: "/repo" }, "/repo");
  assert.deepEqual(deleteLocalBranch.args, ["branch", "-d", "--", "feature/a"]);
  assert.deepEqual(deleteLocalBranch.resultCommand?.args, ["branch", "-d", "--", "<branch>"]);

  const deleteRemoteBranch = buildGitCommand(
    { action: "deleteRemoteBranch", branch: "feature/a", projectPath: "/repo", remoteName: "origin" },
    "/repo",
  );
  assert.deepEqual(deleteRemoteBranch.args, ["push", "origin", "--delete", "feature/a"]);
  assert.deepEqual(deleteRemoteBranch.resultCommand?.args, ["push", "<remote>", "--delete", "<branch>"]);

  const merge = buildGitCommand({ action: "merge", branch: "feature/a", projectPath: "/repo" }, "/repo");
  assert.deepEqual(merge.args, ["merge", "feature/a"]);

  const pullFastForward = buildGitCommand({ action: "pullFastForward", projectPath: "/repo" }, "/repo");
  assert.deepEqual(pullFastForward.args, ["pull", "--ff-only"]);

  const remoteBranchExists = buildGitCommand(
    { action: "remoteBranchExists", branch: "feature/a", projectPath: "/repo", remoteName: "origin" },
    "/repo",
  );
  assert.deepEqual(remoteBranchExists.args, ["ls-remote", "--exit-code", "--heads", "origin", "feature/a"]);
  assert.deepEqual(remoteBranchExists.resultCommand?.args, ["ls-remote", "--exit-code", "--heads", "<remote>", "<branch>"]);

  assert.throws(
    () => buildGitCommand({ action: "diff", filePath: "../secret", projectPath: "/repo" }, "/repo"),
    /filePath must be a relative path/,
  );
  assert.throws(
    () => buildGitCommand({ action: "addAll", filePaths: ["../secret"], projectPath: "/repo" }, "/repo"),
    /filePath must be a relative path/,
  );
  assert.throws(
    () => buildGitCommand({ action: "commit", messageSubject: "", projectPath: "/repo" }, "/repo"),
    /messageSubject must be a non-empty string/,
  );
  assert.throws(
    () => buildGitCommand({ action: "merge", branch: "../bad", projectPath: "/repo" }, "/repo"),
    /not an allowed Git ref/,
  );
  assert.throws(
    () => buildGitCommand({ action: "remoteBranchExists", branch: "feature/a", projectPath: "/repo", remoteName: "../bad" }, "/repo"),
    /remoteName is not an allowed Git remote name/,
  );
  assert.throws(() => buildGitCommand({ action: "archive" as never, projectPath: "/repo" }, "/repo"), /Unsupported Git action/);
});

test("typed Git countFileLines streams project-relative files without command metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-git-line-count-"));
  try {
    const repo = path.join(root, "repo");
    await mkdir(path.join(repo, "src"), { recursive: true });
    await writeFile(path.join(repo, "src", "a.ts"), "one\ntwo\nthree\n");
    await writeFile(path.join(repo, "src", "b.ts"), "one\n");

    const result = await runGitAction(
      { action: "countFileLines", filePaths: ["src/a.ts", "src/b.ts"], projectPath: repo },
      { cwd: repo, projects: [project("P3a91", repo)] },
    );
    assert.equal(result.action, "countFileLines");
    assert.equal(result.command, undefined);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "4");

    await assert.rejects(
      () =>
        runGitAction(
          { action: "countFileLines", filePaths: ["../secret"], projectPath: repo },
          { cwd: repo, projects: [project("P3a91", repo)] },
        ),
      /filePath must be a relative path/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("worktree command construction validates refs and constrains destructive paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-worktree-ops-"));
  try {
    const repo = path.join(root, "repo");
    const existingWorktree = path.join(root, "feature-a");
    await mkdir(repo);
    await mkdir(existingWorktree);
    const context = { cwd: repo, projects: [project("P3a91", repo)] };

    const create = buildWorktreeCommand(
      { action: "create", baseRef: "main", branch: "feature/a", projectPath: repo, worktreePath: path.join(root, "feature-b") },
      context,
    );
    assert.deepEqual(create.args, ["worktree", "add", path.join(root, "feature-b"), "-b", "feature/a", "main"]);

    const remove = buildWorktreeCommand({ action: "remove", projectPath: repo, worktreePath: existingWorktree }, context);
    assert.deepEqual(remove.args, ["worktree", "remove", "--", existingWorktree]);

    const prune = buildWorktreeCommand({ action: "prune", projectPath: repo }, context);
    assert.deepEqual(prune.args, ["worktree", "prune"]);

    assert.throws(
      () => buildWorktreeCommand({ action: "remove", projectPath: repo, worktreePath: repo }, context),
      /cannot be the source project/,
    );
    assert.throws(
      () => buildWorktreeCommand({ action: "switch", branch: "../bad", projectPath: repo }, context),
      /not an allowed Git ref/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("typed worktree list returns structured entries parsed by gxserver", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-worktree-list-"));
  try {
    const repo = path.join(root, "repo");
    const bin = path.join(root, "bin");
    await mkdir(repo);
    await makeExecutable(
      path.join(bin, "git"),
      [
        "#!/bin/sh",
        "if [ \"$1\" = worktree ] && [ \"$2\" = list ] && [ \"$3\" = --porcelain ]; then",
        "  printf 'worktree /tmp/repo\\nbranch refs/heads/main\\n\\nworktree /tmp/repo-feature\\nbranch refs/heads/feature/a\\n\\nworktree /tmp/repo-detached\\ndetached\\n'",
        "  exit 0",
        "fi",
        "exit 1",
      ].join("\n"),
    );

    const result = await runWorktreeAction(
      { action: "list", projectPath: repo },
      {
        cwd: repo,
        envPath: bin,
        projects: [project("P3a91", repo)],
      },
    );

    /*
    CDXC:WorktreeProjectRegistration 2026-06-02-13:01:
    Existing-worktree picker data should be structured by gxserver, not parsed by native. This protects the ownership split while leaving native with only UI filtering and selection.
    */
    assert.equal(result.action, "list");
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.worktrees, [
      { bare: false, branch: "main", detached: false, path: "/tmp/repo" },
      { bare: false, branch: "feature/a", detached: false, path: "/tmp/repo-feature" },
      { bare: false, branch: "detached", detached: true, path: "/tmp/repo-detached" },
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("typed worktree pathExists checks target availability inside gxserver", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-worktree-path-exists-"));
  try {
    const repo = path.join(root, "repo");
    const existingWorktreeTarget = path.join(root, "repo-feature");
    const missingWorktreeTarget = path.join(root, "repo-missing");
    await mkdir(repo);
    await mkdir(existingWorktreeTarget);

    /*
    CDXC:WorktreeProjectRegistration 2026-06-02-13:16:
    Worktree path availability is a gxserver-owned shared mutation precheck. It should not return shell command metadata because gxserver handles it directly without spawning `/bin/test` from native.
    */
    const existing = await runWorktreeAction(
      { action: "pathExists", projectPath: repo, worktreePath: existingWorktreeTarget },
      { cwd: repo, projects: [project("P3a91", repo)] },
    );
    assert.equal(existing.action, "pathExists");
    assert.equal(existing.command, undefined);
    assert.equal(existing.exitCode, 0);
    assert.equal(existing.stdout, "true");

    const missing = await runWorktreeAction(
      { action: "pathExists", projectPath: repo, worktreePath: missingWorktreeTarget },
      { cwd: repo, projects: [project("P3a91", repo)] },
    );
    assert.equal(missing.action, "pathExists");
    assert.equal(missing.command, undefined);
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.stdout, "false");

    await assert.rejects(
      () =>
        runWorktreeAction(
          { action: "pathExists", projectPath: repo, worktreePath: path.join(root, "..", "outside") },
          { cwd: repo, projects: [project("P3a91", repo)] },
        ),
      /must stay inside the source project worktree family directory/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("typed worktree ensureBeadsHooks installs bundled bd hooks in the common git directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-worktree-beads-hooks-"));
  try {
    const repo = path.join(root, "repo");
    const appWebRoot = path.join(root, "app-web");
    const gxserverRoot = path.join(appWebRoot, "gxserver");
    const bd = path.join(appWebRoot, "bin", "bd");
    const beadsPath = path.join(repo, ".beads");
    const hookLog = path.join(root, "hook.log");
    await mkdir(beadsPath, { recursive: true });
    runGitForTypedOperationsTest(repo, ["init"]);
    await makeExecutable(
      bd,
      `#!/bin/sh
if [ "$1" = "where" ]; then
  printf '%s\\n' '{"path":"${beadsPath}"}'
  exit 0
fi
if [ "$1" = "hooks" ] && [ "$2" = "run" ]; then
  printf '%s\\n' "$BEADS_DIR|$BD_GIT_HOOK|$3" >> ${shellSingleQuoteForTypedOperationsTest(hookLog)}
  exit 0
fi
exit 0
`,
    );

    const result = await runWorktreeAction(
      { action: "ensureBeadsHooks", projectPath: repo },
      {
        cwd: repo,
        projects: [project("P3a91", repo)],
        toolchain: { gxserverRoot, repoRoot: path.join(root, "source-root") },
      },
    );

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "installed");
    const hooksPath = path.join(repo, ".git", "ghostex-hooks");
    assert.equal(runGitForTypedOperationsTest(repo, ["config", "--get", "core.hooksPath"]).trim(), hooksPath);
    const preCommit = await readFile(path.join(hooksPath, "pre-commit"), "utf8");
    assert.match(preCommit, /BD_BIN=/);
    assert.match(preCommit, /BEADS_DIR_VALUE=/);
    assert.match(preCommit, /hooks run "\$HOOK_NAME"/);
    assert.match(preCommit, /HOOK_NAME='pre-commit'/);
    assert.doesNotMatch(preCommit, /bd sync|sync --flush-only/);
    assert.doesNotMatch(preCommit, /export -o \.beads\/issues\.jsonl/);
    assert.equal(preCommit.includes(bd), true);
    assert.equal(preCommit.includes(beadsPath), true);
    const postMerge = await readFile(path.join(hooksPath, "post-merge"), "utf8");
    assert.match(postMerge, /HOOK_NAME='post-merge'/);
    assert.match(postMerge, /hooks run "\$HOOK_NAME"/);
    assert.doesNotMatch(postMerge, /import -i \.beads\/issues\.jsonl/);
    const hookRun = spawnSync(path.join(hooksPath, "pre-commit"), [], { cwd: repo, encoding: "utf8" });
    assert.equal(hookRun.status, 0, hookRun.stderr || hookRun.stdout);
    assert.equal((await readFile(hookLog, "utf8")).trim(), `${beadsPath}|1|pre-commit`);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("typed worktree ensureBeadsHooks skips non-Beads repositories before resolving bd", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-worktree-beads-skip-"));
  try {
    const repo = path.join(root, "repo");
    await mkdir(repo, { recursive: true });
    runGitForTypedOperationsTest(repo, ["init"]);
    const result = await runWorktreeAction(
      { action: "ensureBeadsHooks", projectPath: repo },
      {
        cwd: repo,
        projects: [project("P3a92", repo)],
        toolchain: { gxserverRoot: path.join(root, "missing-gxserver"), repoRoot: path.join(root, "missing-source") },
      },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "skipped: no Beads workspace");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Project Board Beads launch directory only applies to board-scoped runBeadsAction calls", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-beads-dir-scope-"));
  try {
    const repo = path.join(root, "repo");
    const boardDir = path.join(root, "board-elsewhere");
    await mkdir(repo, { recursive: true });
    await mkdir(boardDir, { recursive: true });

    const withBeadsDir = (beadsDirectory: unknown): GxserverProjectDomainState => ({
      ...project("P3a91", repo),
      projectBoardConfig: { beadsDirectory },
    });
    const configured = withBeadsDir(boardDir);
    const normalizedBoardDir = normalizeExistingDirectoryPath(boardDir, "beadsDirectory");

    // Board-scoped board call -> `bd` runs in the configured external directory.
    assert.equal(
      resolveBeadsCwdForTypedOperation("/api/runBeadsAction", { projectBoardScope: true }, configured),
      normalizedBoardDir,
    );

    // Native Git commit gating probe (same endpoint, no board scope) -> stays on the project root.
    assert.equal(resolveBeadsCwdForTypedOperation("/api/runBeadsAction", {}, configured), undefined);
    assert.equal(
      resolveBeadsCwdForTypedOperation("/api/runBeadsAction", { projectBoardScope: false }, configured),
      undefined,
    );

    // Worktree/Git endpoints never use the board directory, even if the scope flag leaks in.
    assert.equal(
      resolveBeadsCwdForTypedOperation("/api/runWorktreeAction", { projectBoardScope: true }, configured),
      undefined,
    );

    // No configured directory (or blank) -> project-root fallback for board calls too.
    assert.equal(
      resolveBeadsCwdForTypedOperation("/api/runBeadsAction", { projectBoardScope: true }, project("P3a91", repo)),
      undefined,
    );
    assert.equal(
      resolveBeadsCwdForTypedOperation("/api/runBeadsAction", { projectBoardScope: true }, withBeadsDir("   ")),
      undefined,
    );

    // Invalid configured directory: a board call surfaces an error...
    const missing = withBeadsDir(path.join(root, "does-not-exist"));
    assert.throws(
      () => resolveBeadsCwdForTypedOperation("/api/runBeadsAction", { projectBoardScope: true }, missing),
      /beadsDirectory does not exist/,
    );
    // ...but a commit probe with the same bad config must NOT throw (it cannot break `git commit`).
    assert.equal(resolveBeadsCwdForTypedOperation("/api/runBeadsAction", {}, missing), undefined);

    // A file (not a directory) is rejected for board calls.
    const filePath = path.join(root, "not-a-dir");
    await writeFile(filePath, "x");
    assert.throws(
      () =>
        resolveBeadsCwdForTypedOperation("/api/runBeadsAction", { projectBoardScope: true }, withBeadsDir(filePath)),
      /beadsDirectory is not a directory/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("typed project setup command runs stored worktree command with redacted metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-project-setup-"));
  try {
    const sourceRepo = path.join(root, "repo");
    const worktreeRepo = path.join(root, "repo-feature");
    await mkdir(sourceRepo);
    await mkdir(worktreeRepo);
    const sourceProject: GxserverProjectDomainState = {
      ...project("P3a91", sourceRepo),
      gitConfig: {
        worktreeCommand: "pwd > setup-ran.txt && printf 'setup ok'",
      },
    };
    const targetProject = project("P4b22" as GxserverProjectId, worktreeRepo);

    const result = await runProjectSetupCommand(
      {
        action: "worktreeSetupCommand",
        projectId: targetProject.projectId,
        setupCommandProjectId: sourceProject.projectId,
      },
      {
        cwd: worktreeRepo,
        projects: [sourceProject, targetProject],
      },
    );

    assert.equal(result.action, "worktreeSetupCommand");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "setup ok");
    assert.deepEqual(result.command?.args, ["-lc", "<worktree setup command>"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("typed project setup command no-ops when stored worktree command is empty", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-project-setup-empty-"));
  try {
    const repo = path.join(root, "repo");
    await mkdir(repo);
    const result = await runProjectSetupCommand(
      { action: "worktreeSetupCommand", projectPath: repo },
      {
        cwd: repo,
        projects: [project("P3a91", repo)],
      },
    );

    assert.equal(result.action, "worktreeSetupCommand");
    assert.equal(result.command, undefined);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("typed project setup command rejects unregistered setup command project paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-project-setup-scope-"));
  try {
    const repo = path.join(root, "repo");
    const outside = path.join(root, "outside");
    await mkdir(repo);
    await mkdir(outside);

    await assert.rejects(
      () =>
        runProjectSetupCommand(
          {
            action: "worktreeSetupCommand",
            projectPath: repo,
            setupCommandProjectPath: outside,
          },
          {
            cwd: repo,
            projects: [project("P3a91", repo)],
          },
        ),
      /setupCommandProjectPath must be a registered gxserver project path/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("GitHub command construction is allowlisted", () => {
  const prView = buildGitHubCommand({ action: "prView", projectPath: "/repo" }, "/repo");
  assert.deepEqual(prView, {
    args: ["pr", "view", "--json", "number,state,title,url"],
    cwd: "/repo",
    executable: "gh",
  });

  const prCreate = buildGitHubCommand({ action: "prCreateFill", projectPath: "/repo" }, "/repo");
  assert.deepEqual(prCreate.args, ["pr", "create", "--fill"]);

  const version = buildGitHubCommand({ action: "version", projectPath: "/repo" }, "/repo");
  assert.deepEqual(version.args, ["--version"]);

  assert.throws(() => buildGitHubCommand({ action: "browse" as never, projectPath: "/repo" }, "/repo"), /Unsupported GitHub action/);
});

test("Beads command construction uses resolved bd and preserves current board allowlist", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-beads-ops-"));
  try {
    const repo = path.join(root, "repo");
    const appWebRoot = path.join(root, "app-web");
    const gxserverRoot = path.join(appWebRoot, "gxserver");
    const bd = path.join(appWebRoot, "bin", "bd");
    await mkdir(repo);
    await makeExecutable(bd);
    const context = {
      cwd: repo,
      projects: [project("P3a91", repo)],
      toolchain: { gxserverRoot, repoRoot: path.join(root, "source-root") },
    };

    const comment = await buildBeadsCommand({ action: "comment", comment: "moved to test", issueId: "gxserver-15" }, context);
    assert.deepEqual(comment, {
      args: ["comments", "add", "gxserver-15", "moved to test", "--json"],
      cwd: repo,
      executable: bd,
    });

    const status = await buildBeadsCommand({ action: "status", projectPath: repo }, context);
    assert.deepEqual(status?.args, ["status"]);

    const board = await buildBeadsCommand({ action: "board", projectPath: repo }, context);
    assert.deepEqual(board?.args, ["list", "--all", "--json"]);

    const storageExists = await buildBeadsCommand({ action: "storageExists", projectPath: repo }, context);
    assert.equal(storageExists, undefined);

    const update = await buildBeadsCommand({ action: "update", issueId: "gxserver-15", status: "backlog" }, context);
    assert.deepEqual(update?.args, ["update", "gxserver-15", "--status", "backlog", "--json"]);

    const create = await buildBeadsCommand({
      action: "create",
      dependsOnId: "gxserver-10",
      depType: "blocks",
      description: "Fix it",
      estimate: 60,
      labels: ["ui", "mac"],
      priority: "1",
      title: "Create from board",
    }, context);
    assert.deepEqual(create?.args, [
      "create",
      "--title", "Create from board",
      "--description", "Fix it",
      "--priority", "1",
      "--type", "task",
      "--estimate", "60",
      "--labels", "ui,mac",
      "--deps", "blocks:gxserver-10",
      "--json",
    ]);

    const deleteCommand = await buildBeadsCommand({ action: "delete", issueId: "gxserver-15" }, context);
    assert.deepEqual(deleteCommand?.args, ["delete", "gxserver-15", "--force", "--json"]);

    const setLabels = await buildBeadsCommand({ action: "setLabels", issueId: "gxserver-15", labels: ["test", "review"] }, context);
    assert.deepEqual(setLabels?.args, ["update", "gxserver-15", "--set-labels", "test", "--set-labels", "review", "--json"]);

    const depAdd = await buildBeadsCommand({ action: "depAdd", dependsOnId: "gxserver-10", depType: "blocks", issueId: "gxserver-15" }, context);
    assert.deepEqual(depAdd?.args, ["dep", "add", "gxserver-15", "gxserver-10", "--type", "blocks", "--json"]);

    const labelAdd = await buildBeadsCommand({ action: "addLabel", issueId: "gxserver-15", label: "frontend" }, context);
    assert.deepEqual(labelAdd?.args, ["label", "add", "gxserver-15", "frontend", "--json"]);

    const listAllLabels = await buildBeadsCommand({ action: "listAllLabels" }, context);
    assert.deepEqual(listAllLabels?.args, ["list", "--all", "--json"]);

    const configSet = await buildBeadsCommand({ action: "configSet", value: "backlog,test,review" }, context);
    assert.deepEqual(configSet?.args, ["config", "set", "status.custom", "backlog,test,review", "--json"]);

    const renamePrefix = await buildBeadsCommand({ action: "renamePrefix", value: "ZMUX" }, context);
    assert.deepEqual(renamePrefix?.args, ["rename-prefix", "zmux-", "--repair", "--json"]);

    await assert.rejects(
      () => buildBeadsCommand({ action: "update", issueId: "gxserver-15", status: "todo" as never }, context),
      /Unsupported Beads status/,
    );
    await assert.rejects(
      () => buildBeadsCommand({ action: "depAdd", dependsOnId: "gxserver-10", depType: "../bad", issueId: "gxserver-15" }, context),
      /depType contains unsupported characters/,
    );
    await assert.rejects(
      () =>
        runBeadsAction(
          { action: "list", projectPath: repo },
          {
            cwd: repo,
            envPath: "",
            projects: [project("P3a91", repo)],
            toolchain: {
              gxserverRoot: path.join(root, "missing-gxserver"),
              repoRoot: path.join(root, "missing-source-root"),
              resourcesPath: path.join(root, "missing-resources"),
            },
          },
        ),
      (error: unknown) => {
        assert.equal(error instanceof GxserverTypedOperationError, true);
        assert.equal((error as GxserverTypedOperationError).code, "dependencyUnavailable");
        assert.match((error as GxserverTypedOperationError).message, /Bundled bd was not found/);
        return true;
      },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Beads storageExists inspects project storage without requiring bd", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-beads-storage-"));
  try {
    const repo = path.join(root, "repo");
    await mkdir(repo);
    const missing = await runBeadsAction(
      { action: "storageExists", projectPath: repo },
      { cwd: repo, envPath: "", projects: [project("P3a91", repo)] },
    );
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.stdout, "false");
    assert.equal(missing.command, undefined);

    await mkdir(path.join(repo, ".beads"));
    const exists = await runBeadsAction(
      { action: "storageExists", projectPath: repo },
      { cwd: repo, envPath: "", projects: [project("P3a91", repo)] },
    );
    assert.equal(exists.exitCode, 0);
    assert.equal(exists.stdout, "true");
    assert.equal(exists.command, undefined);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Beads board reads live bd list output after create", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-beads-board-"));
  try {
    const repo = path.join(root, "repo");
    const appWebRoot = path.join(root, "app-web");
    const gxserverRoot = path.join(appWebRoot, "gxserver");
    const bd = path.join(appWebRoot, "bin", "bd");
    await mkdir(repo);
    await makeExecutable(
      bd,
      `#!/bin/sh
printf '%s\\n' '{"data":[{"id":"zmux-new","status":"open","title":"Created from board"}]}'
`,
    );
    const context = {
      beadsBoardLimits: { fileLimitBytes: 1024, responseLimitBytes: 1024, rowLimit: 10 },
      cwd: repo,
      projects: [project("P3a91", repo)],
      toolchain: { gxserverRoot, repoRoot: path.join(root, "source-root") },
    };

    const create = await runBeadsAction({ action: "create", title: "Created from board" }, context);
    assert.equal(create.exitCode, 0);

    const result = await runBeadsAction(
      { action: "board", projectPath: repo },
      context,
    );

    if (!("issues" in result)) {
      assert.fail("board action should return parsed issues");
    }
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.command?.args, ["list", "--all", "--json"]);
    assert.deepEqual(result.issues, [{ id: "zmux-new", status: "open", title: "Created from board" }]);
    assert.equal(result.stdout, JSON.stringify(result.issues));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Beads board reads reject oversized board state with typed errors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-beads-board-limits-"));
  try {
    const repo = path.join(root, "repo");
    const appWebRoot = path.join(root, "app-web");
    const gxserverRoot = path.join(appWebRoot, "gxserver");
    const bd = path.join(appWebRoot, "bin", "bd");
    await mkdir(repo);
    const context = {
      cwd: repo,
      projects: [project("P3a91", repo)],
      toolchain: { gxserverRoot, repoRoot: path.join(root, "source-root") },
    };

    await makeExecutable(
      bd,
      `#!/bin/sh
printf '%s\\n' '[{"id":"gxserver-1"},{"id":"gxserver-2"},{"id":"gxserver-3"}]'
`,
    );
    await assert.rejects(
      () =>
        runBeadsAction(
          { action: "board", projectPath: repo },
          { ...context, beadsBoardLimits: { fileLimitBytes: 1024, responseLimitBytes: 1024, rowLimit: 2 } },
        ),
      (error: unknown) => {
        assert.equal(error instanceof GxserverTypedOperationError, true);
        assert.equal((error as GxserverTypedOperationError).code, "badRequest");
        assert.match((error as GxserverTypedOperationError).message, /row limit/);
        assert.equal((error as GxserverTypedOperationError).details?.rowLimit, 2);
        return true;
      },
    );

    await makeExecutable(
      bd,
      `#!/bin/sh
printf '%s\\n' '[{"id":"gxserver-1","title":"response body is too large"}]'
`,
    );
    await assert.rejects(
      () =>
        runBeadsAction(
          { action: "board", projectPath: repo },
          { ...context, beadsBoardLimits: { fileLimitBytes: 1024, responseLimitBytes: 16, rowLimit: 10 } },
        ),
      (error: unknown) => {
        assert.equal(error instanceof GxserverTypedOperationError, true);
        assert.equal((error as GxserverTypedOperationError).code, "badRequest");
        assert.match((error as GxserverTypedOperationError).message, /serialized JSON limit/);
        assert.equal((error as GxserverTypedOperationError).details?.responseLimitBytes, 16);
        return true;
      },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Beads listAllLabels derives sorted counts from board list output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-beads-labels-"));
  try {
    const repo = path.join(root, "repo");
    const appWebRoot = path.join(root, "app-web");
    const gxserverRoot = path.join(appWebRoot, "gxserver");
    const bd = path.join(appWebRoot, "bin", "bd");
    await mkdir(repo);
    await makeExecutable(
      bd,
      `#!/bin/sh
printf '%s\\n' '{"data":[{"id":"gxserver-1","labels":["ui","mac"]},{"id":"gxserver-2","labels":["ui",""]},{"id":"gxserver-3","labels":["backend"]}]}'
`,
    );
    const result = await runBeadsAction(
      { action: "listAllLabels", projectPath: repo },
      {
        beadsBoardLimits: { fileLimitBytes: 1024, responseLimitBytes: 1024, rowLimit: 10 },
        cwd: repo,
        projects: [project("P3a91", repo)],
        toolchain: { gxserverRoot, repoRoot: path.join(root, "source-root") },
      },
    );

    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.command?.args, ["list", "--all", "--json"]);
    assert.equal(result.stdout, JSON.stringify([
      { count: 1, label: "backend" },
      { count: 1, label: "mac" },
      { count: 2, label: "ui" },
    ]));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("typed operation log levels keep expected probe misses out of warnings", () => {
  /*
  CDXC:GxserverLogs 2026-06-15-20:39:
  Expected negative probe results should remain visible when Debugging Mode is
  enabled, but they are not product warnings and should not persist when
  Debugging Mode is off.
  */
  const expectedProbeMiss = {
    action: "isInsideWorkTree" as const,
    exitCode: 1,
    stderr: "",
    stdout: "false",
  };
  assert.equal(isExpectedNonZeroTypedOperationResult(expectedProbeMiss), true);
  assert.equal(typedOperationLogLevel(expectedProbeMiss), "info");
  assert.equal(
    typedOperationLogLevel({
      action: "push" as const,
      exitCode: 1,
      stderr: "",
      stdout: "",
    }),
    "warn",
  );
  assert.equal(
    typedOperationLogLevel({
      action: "prView" as const,
      error: { code: "timeout", message: "Timed out.", timeoutMs: 50 },
      exitCode: 1,
      stderr: "",
      stdout: "",
    }),
    "warn",
  );
});

test("typed Git operations time out and return structured failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-typed-timeout-"));
  try {
    const repo = path.join(root, "repo");
    const bin = path.join(root, "bin");
    await mkdir(repo);
    /*
    CDXC:GxserverTypedOperations 2026-06-02-08:24:
    This timeout fixture intentionally replaces PATH with a temp bin containing only fake git. Use /bin/sleep so the test exercises typed-operation timeout handling instead of failing early because the stripped PATH cannot resolve sleep.
    */
    await makeExecutable(path.join(bin, "git"), "#!/bin/sh\n/bin/sleep 5\n");

    const startedAt = Date.now();
    const result = await runGitAction(
      { action: "status", projectPath: repo },
      {
        commandLimits: { timeoutMs: 50 },
        cwd: repo,
        envPath: bin,
        projects: [project("P3a91", repo)],
      },
    );

    assert.equal(result.exitCode, 1);
    assert.equal(result.error?.code, "timeout");
    assert.equal(result.error?.timeoutMs, 50);
    assert.match(result.error?.message ?? "", /timed out/);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.ok(Date.now() - startedAt < 2_000);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("typed Git commit sends stdin while returning redacted command metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-typed-commit-"));
  try {
    const repo = path.join(root, "repo");
    const bin = path.join(root, "bin");
    await mkdir(repo);
    await makeExecutable(
      path.join(bin, "git"),
      [
        "#!/bin/sh",
        "printf 'args:%s\\n' \"$*\"",
        "if [ \"$1\" = commit ]; then",
        "  stdin=$(/bin/cat)",
        "  printf 'stdin:%s\\n' \"$stdin\"",
        "fi",
      ].join("\n"),
    );

    const result = await runGitAction(
      {
        action: "commit",
        messageBody: "contains private body",
        messageSubject: "contains private subject",
        projectPath: repo,
      },
      {
        cwd: repo,
        envPath: bin,
        projects: [project("P3a91", repo)],
      },
    );

    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.command?.args, ["commit", "-F", "<stdin>"]);
    assert.match(result.stdout, /contains private subject/);
    assert.match(result.stdout, /contains private body/);
    assert.equal(JSON.stringify(result.command).includes("contains private"), false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("typed Git operations fail explicitly when stdout exceeds the byte cap", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-typed-output-cap-"));
  try {
    const repo = path.join(root, "repo");
    const bin = path.join(root, "bin");
    await mkdir(repo);
    await makeExecutable(path.join(bin, "git"), "#!/bin/sh\nprintf abcdef\n");

    const result = await runGitAction(
      { action: "status", projectPath: repo },
      {
        commandLimits: { stdoutLimitBytes: 4, timeoutMs: 5_000 },
        cwd: repo,
        envPath: bin,
        projects: [project("P3a91", repo)],
      },
    );

    assert.equal(result.exitCode, 1);
    assert.equal(result.error?.code, "stdoutLimitExceeded");
    assert.equal(result.error?.stream, "stdout");
    assert.equal(result.error?.limitBytes, 4);
    assert.equal(result.error?.capturedBytes, 4);
    assert.equal(result.stdout, "abcd");
    assert.equal(result.stderr, "");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("typed Git operations fail explicitly when stderr exceeds the byte cap", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-typed-stderr-cap-"));
  try {
    const repo = path.join(root, "repo");
    const bin = path.join(root, "bin");
    await mkdir(repo);
    await makeExecutable(path.join(bin, "git"), "#!/bin/sh\nprintf abcdef >&2\n");

    const result = await runGitAction(
      { action: "status", projectPath: repo },
      {
        commandLimits: { stderrLimitBytes: 4, timeoutMs: 5_000 },
        cwd: repo,
        envPath: bin,
        projects: [project("P3a91", repo)],
      },
    );

    assert.equal(result.exitCode, 1);
    assert.equal(result.error?.code, "stderrLimitExceeded");
    assert.equal(result.error?.stream, "stderr");
    assert.equal(result.error?.limitBytes, 4);
    assert.equal(result.error?.capturedBytes, 4);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "abcd");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("project path normalization expands tilde and rejects files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-project-paths-"));
  try {
    await mkdir(path.join(root, "repo"));
    await writeFile(path.join(root, "file.txt"), "not a directory");
    assert.equal(normalizeExistingDirectoryPath("~/repo", "path", root), path.join(root, "repo"));
    assert.throws(() => normalizeExistingDirectoryPath("~/file.txt", "path", root), /not a directory/);
    assert.throws(() => normalizeExistingDirectoryPath("relative", "path", root), /absolute path/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("project path resolution ignores unrelated missing legacy chat projects", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-project-path-resolution-"));
  try {
    const repo = path.join(root, "repo");
    const staleChat = path.join(root, "zmux", "chats", "2026-05-08-140732018-chat");
    await mkdir(repo);

    const result = resolveProjectOperationDirectory(
      [
        project("P4rpp" as GxserverProjectId, staleChat),
        project("P3a91" as GxserverProjectId, repo),
      ],
      { projectPath: repo },
    );

    assert.equal(result.cwd, repo);
    assert.equal(result.project.projectId, "P3a91");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

function project(projectId: GxserverProjectId, projectPath: string): GxserverProjectDomainState {
  return {
    attentionRules: {},
    completionRules: {},
    createdAt: "2026-05-30T14:53:00.000Z",
    customAgentOrder: [],
    customAgents: [],
    customCommandOrder: [],
    customCommands: [],
    deletedDefaultCommandIds: [],
    gitConfig: {},
    isFavorite: false,
    isPinned: false,
    launchSettings: {},
    name: "Repo",
    notificationRules: {},
    path: projectPath,
    previousSessionHistory: [],
    projectBoardConfig: {},
    projectId,
    runtimeSettings: {},
    updatedAt: "2026-05-30T14:53:00.000Z",
  };
}

async function makeExecutable(executablePath: string, contents = "#!/bin/sh\nprintf '{}'\n"): Promise<void> {
  await mkdir(path.dirname(executablePath), { recursive: true });
  await writeFile(executablePath, contents);
  await chmod(executablePath, 0o755);
}

function runGitForTypedOperationsTest(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function shellSingleQuoteForTypedOperationsTest(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
