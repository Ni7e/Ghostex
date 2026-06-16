import { spawn } from "node:child_process";
import { createReadStream, statSync } from "node:fs";
import { chmod, mkdir, stat as statFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  GxserverBeadsAction,
  GxserverBeadsBoardResult,
  GxserverGitAction,
  GxserverGitHubAction,
  GxserverProjectDomainState,
  GxserverRunBeadsActionParams,
  GxserverRunGitActionParams,
  GxserverRunGitHubActionParams,
  GxserverRunProjectSetupCommandParams,
  GxserverRunWorktreeActionParams,
  GxserverTypedCommand,
  GxserverTypedOperationFailure,
  GxserverTypedOperationResult,
  GxserverWorktreeAction,
} from "../protocol/index.js";
import { normalizeGitWorktreeBranch, parseGitWorktreeListPorcelain } from "./git-worktrees.js";
import { getBdToolStatus, type GxserverToolchainLayoutOptions } from "./toolchain.js";

export const GXSERVER_TYPED_OPERATION_TIMEOUT_MS = 120_000;
export const GXSERVER_TYPED_OPERATION_STDOUT_LIMIT_BYTES = 4 * 1024 * 1024;
export const GXSERVER_TYPED_OPERATION_STDERR_LIMIT_BYTES = 4 * 1024 * 1024;
export const GXSERVER_BEADS_BOARD_FILE_LIMIT_BYTES = GXSERVER_TYPED_OPERATION_STDOUT_LIMIT_BYTES;
export const GXSERVER_BEADS_BOARD_RESPONSE_LIMIT_BYTES = GXSERVER_TYPED_OPERATION_STDOUT_LIMIT_BYTES;
export const GXSERVER_BEADS_BOARD_ROW_LIMIT = 5_000;
const GXSERVER_TYPED_OPERATION_KILL_GRACE_MS = 1_000;
const GXSERVER_BEADS_GIT_HOOK_NAMES = ["pre-commit", "post-merge", "post-checkout"] as const;
const GXSERVER_TYPED_OPERATION_COLOR_DISABLING_ENVIRONMENT_KEYS = [
  "ANSI_COLORS_DISABLED",
  "NO_COLOR",
  "NODE_DISABLE_COLORS",
] as const;
const EXPECTED_NONZERO_TYPED_OPERATION_ACTIONS = new Set([
  "diffNoIndexAgainstNull",
  "getOriginRemoteUrl",
  "isInsideWorkTree",
  "prView",
  "remoteBranchExists",
  "storageExists",
  "upstreamCounts",
  "verifyRef",
]);

export class GxserverTypedOperationError extends Error {
  readonly code: "badRequest" | "dependencyUnavailable" | "forbidden" | "notFound";
  readonly details?: Record<string, unknown>;

  constructor(
    code: "badRequest" | "dependencyUnavailable" | "forbidden" | "notFound",
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "GxserverTypedOperationError";
  }
}

export interface GxserverTypedOperationContext {
  abortSignal?: AbortSignal;
  beadsBoardLimits?: Partial<GxserverBeadsBoardLimits>;
  /**
   * Optional working directory for `bd` (Beads) invocations. When a project configures a
   * dedicated Beads launch directory (projectBoardConfig.beadsDirectory), the server resolves
   * it to an absolute, existing path and sets it here. `bd` walks up from its cwd to find the
   * `.beads` database, so pointing it at this directory is enough. Git operations keep using
   * `cwd` (the project root). Falls back to `cwd` when unset — see resolveBeadsCwd.
   */
  beadsCwd?: string;
  commandLimits?: Partial<GxserverTypedCommandLimits>;
  cwd: string;
  envPath?: string;
  projects: readonly GxserverProjectDomainState[];
  toolchain?: GxserverToolchainLayoutOptions;
}

function resolveBeadsCwd(context: GxserverTypedOperationContext): string {
  return context.beadsCwd ?? context.cwd;
}

export interface GxserverBeadsBoardLimits {
  fileLimitBytes: number;
  responseLimitBytes: number;
  rowLimit: number;
}

export interface GxserverTypedCommandLimits {
  stderrLimitBytes: number;
  stdoutLimitBytes: number;
  timeoutMs: number;
}

interface GxserverProcessCommand extends GxserverTypedCommand {
  resultCommand?: GxserverTypedCommand;
  stdin?: string;
}

/*
CDXC:GxserverTypedOperations 2026-05-30-14:53:
gxserver exposes Git, worktree, and Beads through typed allowlisted operations only. Remote clients may request these workflows, but they cannot provide arbitrary executables or arguments; gxserver constructs each command after validating project scope, paths, refs, statuses, and destructive worktree targets.

CDXC:GxserverTypedOperations 2026-05-30-23:41:
Typed Git, worktree, and Beads subprocesses must have bounded runtime and bounded stdout/stderr memory. Timeout, output-overrun, and client-abort termination are reported as structured operation failures instead of returning silently truncated successful output.

CDXC:GxserverTypedOperations 2026-05-30-23:08:
Beads board reads bypass the subprocess stdout cap because gxserver reads `.beads/issues.jsonl` directly for UI board state. Apply file-size, row-count, and serialized-response limits before returning `issues` so a remote Project board request cannot make gxserver load or JSON-encode unbounded board data.
*/
export function isExpectedNonZeroTypedOperationResult(result: GxserverTypedOperationResult): boolean {
  /*
  CDXC:GxserverLogs 2026-06-15-20:39:
  Several typed operations are probes where a non-zero exit code means "false"
  or "not configured" rather than a product warning, such as repository checks,
  missing upstreams, no matching remote branch, no current PR, or no Beads
  storage. Keep those visible under Debugging Mode as info-level diagnostics,
  but do not persist them as normal-mode warnings.
  */
  return result.exitCode !== 0 && !result.error && EXPECTED_NONZERO_TYPED_OPERATION_ACTIONS.has(result.action);
}

export function typedOperationLogLevel(result: GxserverTypedOperationResult): "info" | "warn" {
  if (result.exitCode === 0 || isExpectedNonZeroTypedOperationResult(result)) {
    return "info";
  }
  return "warn";
}

export function buildGitCommand(params: GxserverRunGitActionParams, cwd: string): GxserverProcessCommand {
  const action = normalizeGitAction(params.action);
  /*
  CDXC:GitOperations 2026-06-02-12:01:
  Shared repository mutations and inspections used by sidebar worktree merge flows belong to gxserver typed Git operations. Native owns toasts, confirmation UI, conflict-agent placement, and local focus, while gxserver owns the allowlisted checkout/merge/ref/status command execution.

  CDXC:GitOperations 2026-06-02-12:21:
  Sidebar project-header diff stats, changed-file previews, upstream badges, and GitHub editor detection are native UI, but the repository checks and Git diff/list/remote commands are shared backend inspections. Keep those Git commands in gxserver typed operations so native renders loading/local-first state without shelling out to Git for shared project data.

  CDXC:GitOperations 2026-06-02-12:52:
  Commit and push mutations are shared backend Git workflows after the gxserver/native split. Commit messages are user-authored content, so gxserver passes them over stdin with `git commit -F -` and returns only a redacted command summary to clients and logs.

  CDXC:WorktreeDelete 2026-06-10-22:56:
  Delete Worktree can optionally clean up the local branch and origin branch after
  the checkout is removed. Keep those branch probes and deletions in typed Git
  operations, use safe `branch -d`, and redact branch names from returned command
  metadata for the new cleanup actions.

  CDXC:TitlebarGit 2026-06-16-07:31:
  The macOS titlebar remote-sync action needs a typed pull path that updates the
  current branch only when Git can fast-forward it. Do not add a merge/rebase
  fallback; surface non-fast-forward or dirty-worktree failures to the caller.
  */
  switch (action) {
    case "addAll": {
      const filePaths = optionalRelativeFilePaths(params.filePaths);
      return {
        args: ["add", "-A", ...(filePaths.length > 0 ? ["--", ...filePaths] : [])],
        cwd,
        executable: "git",
        resultCommand:
          filePaths.length > 0
            ? { args: ["add", "-A", "--", `<${filePaths.length} files>`], cwd, executable: "git" }
            : undefined,
      };
    }
    case "branch":
      return { args: ["branch", "--show-current"], cwd, executable: "git" };
    case "checkout":
      return { args: ["checkout", normalizeGitRef(params.branch, "branch")], cwd, executable: "git" };
    case "checkoutNewBranch":
      return { args: ["checkout", "-b", normalizeGitRef(params.branch, "branch")], cwd, executable: "git" };
    case "deleteLocalBranch": {
      const branch = normalizeGitRef(params.branch, "branch");
      return {
        args: ["branch", "-d", "--", branch],
        cwd,
        executable: "git",
        resultCommand: { args: ["branch", "-d", "--", "<branch>"], cwd, executable: "git" },
      };
    }
    case "deleteRemoteBranch": {
      const remoteName = normalizeGitRemoteName(params.remoteName ?? "origin");
      const branch = normalizeGitRef(params.branch, "branch");
      return {
        args: ["push", remoteName, "--delete", branch],
        cwd,
        executable: "git",
        resultCommand: { args: ["push", "<remote>", "--delete", "<branch>"], cwd, executable: "git" },
      };
    }
    case "diff":
      return { args: ["diff", "--", ...optionalRelativeFilePath(params.filePath)], cwd, executable: "git" };
    case "diffCached":
      return { args: ["diff", "--cached"], cwd, executable: "git" };
    case "diffCachedNoExt":
      return { args: ["diff", "--cached", "--no-ext-diff", "--", normalizeRelativeFilePath(params.filePath)], cwd, executable: "git" };
    case "diffCachedStat":
      return { args: ["diff", "--cached", "--stat"], cwd, executable: "git" };
    case "diffNoExt":
      return { args: ["diff", "--no-ext-diff", "--", normalizeRelativeFilePath(params.filePath)], cwd, executable: "git" };
    case "diffNoIndexAgainstNull":
      return { args: ["diff", "--no-index", "--no-ext-diff", "--", "/dev/null", normalizeRelativeFilePath(params.filePath)], cwd, executable: "git" };
    case "diffNumstat":
      return { args: ["diff", "--numstat", "HEAD"], cwd, executable: "git" };
    case "getOriginRemoteUrl":
      return { args: ["remote", "get-url", "origin"], cwd, executable: "git" };
    case "isInsideWorkTree":
      return { args: ["rev-parse", "--is-inside-work-tree"], cwd, executable: "git" };
    case "isUntrackedFile":
      return { args: ["ls-files", "--others", "--exclude-standard", "--", normalizeRelativeFilePath(params.filePath)], cwd, executable: "git" };
    case "list":
      return {
        args: ["ls-files", "--cached", "--modified", "--others", "--exclude-standard"],
        cwd,
        executable: "git",
      };
    case "listRemotes":
      return { args: ["remote"], cwd, executable: "git" };
    case "listUntracked":
      return { args: ["ls-files", "--others", "--exclude-standard", "-z"], cwd, executable: "git" };
    case "status":
      return { args: ["status", "--short", "--branch"], cwd, executable: "git" };
    case "statusPorcelain":
      return { args: ["status", "--porcelain"], cwd, executable: "git" };
    case "upstreamCounts":
      return { args: ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], cwd, executable: "git" };
    case "merge":
      return { args: ["merge", normalizeGitRef(params.branch, "branch")], cwd, executable: "git" };
    case "commit": {
      const message = normalizeGitCommitMessage(params.messageSubject, params.messageBody);
      return {
        args: ["commit", ...(params.noVerify === true ? ["--no-verify"] : []), "-F", "-"],
        cwd,
        executable: "git",
        resultCommand: {
          args: ["commit", ...(params.noVerify === true ? ["--no-verify"] : []), "-F", "<stdin>"],
          cwd,
          executable: "git",
        },
        stdin: message,
      };
    }
    case "countFileLines":
      throw new GxserverTypedOperationError("badRequest", "countFileLines is handled by gxserver without spawning a subprocess.");
    case "pullFastForward":
      return { args: ["pull", "--ff-only"], cwd, executable: "git" };
    case "push":
      return { args: ["push"], cwd, executable: "git" };
    case "pushSetUpstream":
      return { args: ["push", "-u", "origin", normalizeGitRef(params.branch, "branch")], cwd, executable: "git" };
    case "remoteBranchExists": {
      const remoteName = normalizeGitRemoteName(params.remoteName ?? "origin");
      const branch = normalizeGitRef(params.branch, "branch");
      return {
        args: ["ls-remote", "--exit-code", "--heads", remoteName, branch],
        cwd,
        executable: "git",
        resultCommand: { args: ["ls-remote", "--exit-code", "--heads", "<remote>", "<branch>"], cwd, executable: "git" },
      };
    }
    case "verifyRef":
      return { args: ["rev-parse", "--verify", normalizeGitRef(params.ref, "ref")], cwd, executable: "git" };
  }
}

export function buildWorktreeCommand(params: GxserverRunWorktreeActionParams, context: GxserverTypedOperationContext): GxserverTypedCommand {
  const action = normalizeWorktreeAction(params.action);
  /*
  CDXC:WorktreeProjectRegistration 2026-06-02-11:45:
  Worktree create, list, remove, prune, and switch are gxserver-owned typed operations after the ownership split. Keep the allowlist here so native owns picker/layout/local-first UI but never shells out to `git worktree` for shared project mutations.
  */
  switch (action) {
    case "ensureBeadsHooks":
      throw new GxserverTypedOperationError("badRequest", "ensureBeadsHooks is handled by gxserver without spawning git worktree.");
    case "create": {
      const worktreePath = normalizeWorktreeTargetPath(params.worktreePath, context);
      const branch = normalizeOptionalGitRef(params.branch, "branch");
      const baseRef = normalizeOptionalGitRef(params.baseRef, "baseRef");
      return {
        args: ["worktree", "add", worktreePath, ...(branch ? ["-b", branch] : []), ...(baseRef ? [baseRef] : [])],
        cwd: context.cwd,
        executable: "git",
      };
    }
    case "list":
      return { args: ["worktree", "list", "--porcelain"], cwd: context.cwd, executable: "git" };
    case "pathExists":
      throw new GxserverTypedOperationError("badRequest", "pathExists is handled by gxserver without spawning a subprocess.");
    case "prune":
      return { args: ["worktree", "prune"], cwd: context.cwd, executable: "git" };
    case "remove": {
      const worktreePath = normalizeExistingWorktreePath(params.worktreePath, context);
      return {
        args: ["worktree", "remove", ...(params.force === true ? ["--force"] : []), "--", worktreePath],
        cwd: context.cwd,
        executable: "git",
      };
    }
    case "switch": {
      const branch = normalizeGitRef(params.branch, "branch");
      return { args: ["switch", branch], cwd: context.cwd, executable: "git" };
    }
  }
}

export async function buildBeadsCommand(
  params: GxserverRunBeadsActionParams,
  context: GxserverTypedOperationContext,
): Promise<GxserverTypedCommand | undefined> {
  const action = normalizeBeadsAction(params.action);
  if (action === "storageExists") {
    return undefined;
  }
  const bd = await requireBd(context);
  /*
  CDXC:ProjectBoard 2026-06-02-13:31:
  Project board Beads reads and mutations are gxserver-owned backend operations after the native/gxserver split. Keep the full board command surface as typed allowlisted `bd` actions here so the macOS WKWebView bridge only forwards requests and no longer constructs or runs Beads subprocesses.

  CDXC:ProjectBoard 2026-06-13:
  `bd` runs in the configured Beads launch directory (projectBoardConfig.beadsDirectory) when set, otherwise the project root. `bd` resolves its `.beads` database by walking up from this cwd, so pointing it here is sufficient. Git hook setup keeps using context.cwd (the repo).
  */
  const cwd = resolveBeadsCwd(context);
  switch (action) {
    case "board":
      return { args: ["list", "--all", "--json"], cwd, executable: bd };
    case "addLabel":
      return {
        args: ["label", "add", normalizeIssueId(params.issueId), normalizeRequiredText(params.label, "label"), "--json"],
        cwd,
        executable: bd,
      };
    case "close":
      return { args: ["close", normalizeIssueId(params.issueId), "--json"], cwd, executable: bd };
    case "comment":
      return {
        args: ["comments", "add", normalizeIssueId(params.issueId), normalizeRequiredText(params.comment, "comment"), "--json"],
        cwd,
        executable: bd,
      };
    case "configGet":
      return { args: ["config", "get", "status.custom", "--json"], cwd, executable: bd };
    case "configGetIssuePrefix":
      return { args: ["config", "get", "issue_prefix", "--json"], cwd, executable: bd };
    case "configSet":
      return {
        args: ["config", "set", "status.custom", normalizeRequiredText(params.value, "value"), "--json"],
        cwd,
        executable: bd,
      };
    case "renamePrefix":
      return {
        args: ["rename-prefix", normalizeBeadsRenamePrefix(params.value), "--repair", "--json"],
        cwd,
        executable: bd,
      };
    case "create":
      return {
        args: buildBeadsCreateArgs(params),
        cwd,
        executable: bd,
      };
    case "delete":
      return { args: ["delete", normalizeIssueId(params.issueId), "--force", "--json"], cwd, executable: bd };
    case "depAdd":
      return {
        args: [
          "dep",
          "add",
          normalizeIssueId(params.issueId),
          normalizeIssueId(params.dependsOnId),
          "--type",
          normalizeBeadsDependencyType(params.depType),
          "--json",
        ],
        cwd,
        executable: bd,
      };
    case "depRemove":
      return {
        args: ["dep", "remove", normalizeIssueId(params.issueId), normalizeIssueId(params.dependsOnId), "--json"],
        cwd,
        executable: bd,
      };
    case "list":
      return { args: ["list", "--all", "--json"], cwd, executable: bd };
    case "listAllLabels":
      return { args: ["label", "list-all", "--json"], cwd, executable: bd };
    case "removeLabel":
      return {
        args: ["label", "remove", normalizeIssueId(params.issueId), normalizeRequiredText(params.label, "label"), "--json"],
        cwd,
        executable: bd,
      };
    case "search":
      return { args: ["search", normalizeRequiredText(params.query, "query"), "--json"], cwd, executable: bd };
    case "setLabels":
      return {
        args: ["update", normalizeIssueId(params.issueId), ...buildBeadsSetLabelArgs(params.labels), "--json"],
        cwd,
        executable: bd,
      };
    case "show":
      return { args: ["show", normalizeIssueId(params.issueId), "--json"], cwd, executable: bd };
    case "status":
      return { args: ["status"], cwd, executable: bd };
    case "update":
      return { args: ["update", normalizeIssueId(params.issueId), ...buildBeadsUpdateArgs(params), "--json"], cwd, executable: bd };
    case "updateDescription":
      return {
        args: ["update", normalizeIssueId(params.issueId), "--description", String(params.description ?? ""), "--json"],
        cwd,
        executable: bd,
      };
    case "updateEstimate":
      return {
        args: ["update", normalizeIssueId(params.issueId), "--estimate", normalizeBeadsEstimate(params.estimate), "--json"],
        cwd,
        executable: bd,
      };
    case "updatePriority":
      return {
        args: ["update", normalizeIssueId(params.issueId), "--priority", normalizeRequiredText(params.priority, "priority"), "--json"],
        cwd,
        executable: bd,
      };
    case "updateStatus":
      return {
        args: ["update", normalizeIssueId(params.issueId), "--status", normalizeBeadsStatus(params.status), "--json"],
        cwd,
        executable: bd,
      };
    case "updateTitle":
      return {
        args: ["update", normalizeIssueId(params.issueId), "--title", normalizeRequiredText(params.title, "title"), "--json"],
        cwd,
        executable: bd,
      };
  }
}

export function buildGitHubCommand(params: GxserverRunGitHubActionParams, cwd: string): GxserverTypedCommand {
  const action = normalizeGitHubAction(params.action);
  /*
  CDXC:GitHubOperations 2026-06-02-13:18:
  Pull-request view/create is part of the shared project Git workflow, so gxserver owns the allowlisted `gh` execution while native owns review modals, success toasts, and opening the returned PR URL in a local browser pane.
  */
  switch (action) {
    case "prCreateFill":
      return { args: ["pr", "create", "--fill"], cwd, executable: "gh" };
    case "prView":
      return { args: ["pr", "view", "--json", "number,state,title,url"], cwd, executable: "gh" };
    case "version":
      return { args: ["--version"], cwd, executable: "gh" };
  }
}

export async function runGitAction(
  params: GxserverRunGitActionParams,
  context: GxserverTypedOperationContext,
): Promise<GxserverTypedOperationResult> {
  if (normalizeGitAction(params.action) === "countFileLines") {
    /*
    CDXC:GxserverTypedOperations 2026-06-02-12:35:
    Project-header untracked line totals are repository inspections even though native renders the UI. Count project-relative files inside gxserver and return only the numeric total so the macOS sidebar does not shell out to `wc` or expose file paths/content through command metadata.
    */
    return {
      action: "countFileLines",
      exitCode: 0,
      stderr: "",
      stdout: String(await countProjectFileLines(context.cwd, optionalRelativeFilePaths(params.filePaths))),
    };
  }
  const command = buildGitCommand(params, context.cwd);
  return {
    action: normalizeGitAction(params.action),
    command: command.resultCommand ?? command,
    ...(await runTypedCommand(command, commandOptions(context))),
  };
}

export async function runGitHubAction(
  params: GxserverRunGitHubActionParams,
  context: GxserverTypedOperationContext,
): Promise<GxserverTypedOperationResult> {
  const command = buildGitHubCommand(params, context.cwd);
  const action = normalizeGitHubAction(params.action);
  try {
    return { action, command, ...(await runTypedCommand(command, commandOptions(context))) };
  } catch (error) {
    return {
      action,
      command,
      exitCode: 1,
      stderr: error instanceof Error ? error.message : "GitHub CLI operation failed.",
      stdout: "",
    };
  }
}

export async function runWorktreeAction(
  params: GxserverRunWorktreeActionParams,
  context: GxserverTypedOperationContext,
): Promise<GxserverTypedOperationResult> {
  /*
  CDXC:WorktreeProjectRegistration 2026-06-02-13:01:
  Existing-worktree discovery is gxserver-owned, including parsing `git worktree list --porcelain`. Return structured worktree entries from the typed list operation so native owns only picker rendering and selection state.

  CDXC:WorktreeProjectRegistration 2026-06-02-13:16:
  Worktree target-path availability is part of the shared worktree creation decision. Check candidate paths inside gxserver typed operations instead of letting native shell out with `/bin/test`, while keeping native responsible for naming attempts and UI feedback.
  */
  const action = normalizeWorktreeAction(params.action);
  if (action === "ensureBeadsHooks") {
    return ensureBeadsGitHooks(context);
  }
  if (action === "pathExists") {
    const worktreePath = normalizeWorktreeTargetPath(params.worktreePath, context);
    const exists = await pathExists(worktreePath);
    return {
      action,
      exitCode: exists ? 0 : 1,
      stderr: "",
      stdout: exists ? "true" : "false",
    };
  }
  const command = buildWorktreeCommand(params, context);
  const result = { action, command, ...(await runTypedCommand(command, commandOptions(context))) };
  if (action !== "list" || result.exitCode !== 0) {
    return result;
  }
  return {
    ...result,
    worktrees: parseGitWorktreeListPorcelain(result.stdout).map((entry) => ({
      bare: entry.bare,
      branch: normalizeGitWorktreeBranch(entry.branch),
      detached: entry.detached,
      path: entry.path,
    })),
  };
}

async function ensureBeadsGitHooks(context: GxserverTypedOperationContext): Promise<GxserverTypedOperationResult> {
  /*
  CDXC:WorktreeBeads 2026-06-10-22:37:
  Worktrees created from the Project board must commit with the same Beads database as the parent checkout.
  Install local common-git-dir hooks that call Ghostex's bundled `bd hooks run` by absolute path and pin BEADS_DIR to the resolved Beads storage, so linked worktrees do not depend on stale PATH bd binaries or create split board state.
  */
  /*
  CDXC:ProjectBoard 2026-06-13:
  Worktree Beads hook setup stays on the project root (context.cwd) and never follows the
  configurable board launch directory — hook installation is a Git-commit path and must not be
  affected by the board setting. Only Project Board `bd` reads/writes use beadsCwd.
  */
  if (!(await beadsStorageDirectoryExists(context.cwd))) {
    return {
      action: "ensureBeadsHooks",
      exitCode: 0,
      stderr: "",
      stdout: "skipped: no Beads workspace",
    };
  }
  const bd = await requireBd(context);
  const where = await runTypedCommand({ args: ["where", "--json"], cwd: context.cwd, executable: bd }, commandOptions(context));
  if (where.exitCode !== 0) {
    return {
      action: "ensureBeadsHooks",
      exitCode: 0,
      stderr: "",
      stdout: "skipped: no Beads workspace",
    };
  }
  const beadsPath = await normalizeBeadsWhereDirectory(where.stdout);
  const commonGitDir = await resolveGitCommonDirectory(context);
  const hooksPath = path.join(commonGitDir, "ghostex-hooks");
  await mkdir(hooksPath, { recursive: true });
  for (const hookName of GXSERVER_BEADS_GIT_HOOK_NAMES) {
    const hookPath = path.join(hooksPath, hookName);
    await writeFile(hookPath, buildGhostexBeadsGitHookScript(hookName, bd, beadsPath), { mode: 0o755 });
    await chmod(hookPath, 0o755);
  }
  const config = await runTypedCommand(
    { args: ["config", "core.hooksPath", hooksPath], cwd: context.cwd, executable: "git" },
    commandOptions(context),
  );
  if (config.exitCode !== 0) {
    return {
      action: "ensureBeadsHooks",
      exitCode: config.exitCode,
      stderr: config.stderr,
      stdout: config.stdout || "Could not configure Git hooks path for Beads worktree support.",
    };
  }
  return {
    action: "ensureBeadsHooks",
    exitCode: 0,
    stderr: "",
    stdout: "installed",
  };
}

async function resolveGitCommonDirectory(context: GxserverTypedOperationContext): Promise<string> {
  const result = await runTypedCommand(
    { args: ["rev-parse", "--git-common-dir"], cwd: context.cwd, executable: "git" },
    commandOptions(context),
  );
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    throw new GxserverTypedOperationError("badRequest", result.stderr || "Could not resolve Git common directory.");
  }
  return path.resolve(context.cwd, result.stdout.trim());
}

async function normalizeBeadsWhereDirectory(stdout: string): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw new GxserverTypedOperationError("badRequest", "Beads where output was not valid JSON.");
  }
  const beadsPath = isRecord(parsed) && typeof parsed.path === "string" ? parsed.path : "";
  if (!path.isAbsolute(beadsPath)) {
    throw new GxserverTypedOperationError("badRequest", "Beads where output did not include an absolute storage path.");
  }
  const stats = await statFile(beadsPath);
  if (!stats.isDirectory()) {
    throw new GxserverTypedOperationError("badRequest", "Beads storage path is not a directory.");
  }
  return beadsPath;
}

function buildGhostexBeadsGitHookScript(
  hookName: (typeof GXSERVER_BEADS_GIT_HOOK_NAMES)[number],
  bd: string,
  beadsPath: string,
): string {
  return `#!/usr/bin/env sh
# Ghostex-managed Beads hook. This local file is generated under the common Git directory.
BD_BIN=${shellSingleQuote(bd)}
BEADS_DIR_VALUE=${shellSingleQuote(beadsPath)}
HOOK_NAME=${shellSingleQuote(hookName)}
if [ ! -x "$BD_BIN" ]; then
  echo "Warning: Ghostex bundled bd is missing; skipping Beads hook" >&2
  exit 0
fi
export BEADS_DIR="$BEADS_DIR_VALUE"
export BD_GIT_HOOK=1
export PATH="$(dirname "$BD_BIN"):$PATH"
run_bd_hook() {
  _bd_timeout=\${BEADS_HOOK_TIMEOUT:-300}
  _bd_used_perl=0
  if command -v timeout >/dev/null 2>&1; then
    timeout "$_bd_timeout" "$BD_BIN" hooks run "$HOOK_NAME" "$@"
    _bd_exit=$?
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$_bd_timeout" "$BD_BIN" hooks run "$HOOK_NAME" "$@"
    _bd_exit=$?
  elif command -v perl >/dev/null 2>&1; then
    _bd_used_perl=1
    perl -e 'alarm shift; exec @ARGV' "$_bd_timeout" "$BD_BIN" hooks run "$HOOK_NAME" "$@"
    _bd_exit=$?
  else
    echo >&2 "beads: hook '$HOOK_NAME' running without timeout; install coreutils or perl to enable BEADS_HOOK_TIMEOUT"
    "$BD_BIN" hooks run "$HOOK_NAME" "$@"
    _bd_exit=$?
  fi
  if [ $_bd_exit -eq 124 ] || { [ $_bd_used_perl -eq 1 ] && [ $_bd_exit -eq 142 ]; }; then
    echo >&2 "beads: hook '$HOOK_NAME' timed out after \${_bd_timeout}s; continuing without beads"
    _bd_exit=0
  fi
  if [ $_bd_exit -eq 3 ]; then
    echo >&2 "beads: database not initialized; skipping hook '$HOOK_NAME'"
    _bd_exit=0
  fi
  return $_bd_exit
}
run_bd_hook "$@"
exit $?
`;
}

export async function runProjectSetupCommand(
  params: GxserverRunProjectSetupCommandParams,
  context: GxserverTypedOperationContext,
): Promise<GxserverTypedOperationResult> {
  if (params.action !== "worktreeSetupCommand") {
    throw new GxserverTypedOperationError("badRequest", `Unsupported project setup action: ${String(params.action)}`);
  }
  const setupProject = resolveProjectSetupCommandProject(params, context);
  const commandText = normalizeProjectSetupCommand(setupProject.gitConfig.worktreeCommand);
  /*
  CDXC:GxserverTypedOperations 2026-06-03-04:08:
  Worktree setup commands are an explicit project metadata workflow, not a
  generic remote process bridge. Clients may choose the target project cwd and
  the registered project whose gitConfig owns the command, but gxserver reads
  the command text from stored metadata and returns only redacted command
  metadata so remote worktree setup stays inside the typed operation boundary.
  */
  if (!commandText) {
    return {
      action: "worktreeSetupCommand",
      exitCode: 0,
      stderr: "",
      stdout: "",
    };
  }
  const command: GxserverProcessCommand = {
    args: ["-lc", commandText],
    cwd: context.cwd,
    executable: "/bin/zsh",
    resultCommand: {
      args: ["-lc", "<worktree setup command>"],
      cwd: context.cwd,
      executable: "/bin/zsh",
    },
  };
  return {
    action: "worktreeSetupCommand",
    command: command.resultCommand,
    ...(await runTypedCommand(command, commandOptions(context))),
  };
}

export async function runBeadsAction(
  params: GxserverRunBeadsActionParams,
  context: GxserverTypedOperationContext,
): Promise<GxserverTypedOperationResult | GxserverBeadsBoardResult> {
  const action = normalizeBeadsAction(params.action);
  const command = await buildBeadsCommand(params, context);
  if (action === "board") {
    if (!command) {
      throw new GxserverTypedOperationError("badRequest", "No command was constructed for Beads board reads.");
    }
    /*
    CDXC:ProjectBoardBeads 2026-06-10-20:27:
    Board refreshes must read the same live Beads source as create/update operations. Use the pinned bd list command, then apply row and serialized-response limits before returning issues so daemon-backed Beads state cannot diverge from stale `.beads/issues.jsonl` exports.
    */
    const result = await runTypedCommand(command, commandOptions(context, { BD_JSON_ENVELOPE: "1" }));
    if (result.exitCode !== 0) {
      return {
        action,
        command,
        issues: [],
        ...result,
      };
    }
    const { issues, stdout } = parseBeadsBoardListOutput(result.stdout, resolveBeadsBoardLimits(context));
    return {
      action,
      command,
      exitCode: 0,
      issues,
      stderr: result.stderr,
      stdout,
    };
  }
  if (action === "storageExists") {
    /*
    CDXC:GxserverTypedOperations 2026-06-02-12:14:
    The macOS commit UI may need to know whether a registered project has tracked Beads storage before deciding to request `git commit --no-verify` for the precise missing-db hook failure. Keep that project filesystem probe in gxserver so native does not inspect shared project repository state directly.
    */
    const exists = await beadsStorageDirectoryExists(resolveBeadsCwd(context));
    return {
      action,
      exitCode: exists ? 0 : 1,
      stderr: "",
      stdout: String(exists),
    };
  }
  if (!command) {
    throw new GxserverTypedOperationError("badRequest", `No command was constructed for Beads action ${action}.`);
  }
  return { action, command, ...(await runTypedCommand(command, commandOptions(context, { BD_JSON_ENVELOPE: "1" }))) };
}

async function runTypedCommand(
  command: GxserverProcessCommand,
  options: {
    env?: Record<string, string>;
    limits?: Partial<GxserverTypedCommandLimits>;
    signal?: AbortSignal;
  } = {},
): Promise<{ error?: GxserverTypedOperationFailure; exitCode: number; stderr: string; stdout: string }> {
  const limits = resolveTypedCommandLimits(options.limits);
  return await new Promise((resolve, reject) => {
    const usesStdin = command.stdin !== undefined;
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      detached: process.platform !== "win32",
      env: typedOperationProcessEnvironment(options.env),
      stdio: [usesStdin ? "pipe" : "ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure: GxserverTypedOperationFailure | undefined;
    let killTimer: NodeJS.Timeout | undefined;

    const timeout = setTimeout(() => {
      failAndTerminate({
        code: "timeout",
        message: `Typed operation timed out after ${limits.timeoutMs}ms.`,
        timeoutMs: limits.timeoutMs,
      });
    }, limits.timeoutMs);
    timeout.unref();

    /*
    CDXC:GxserverTypedOperations 2026-06-02-13:38:
    Typed operations that do not send stdin should not open a stdin pipe, because fast-exiting Git commands can close it before Node writes the empty payload. Operations that do send user-authored stdin must convert pipe failures into structured gxserver command failures instead of leaking child-process errors to clients or tests.
    */
    if (usesStdin) {
      child.stdin?.on("error", (error: NodeJS.ErrnoException) => {
        failAndTerminate({
          code: "stdinFailed",
          message: error.code === "EPIPE" ? "Typed operation stdin closed before input was accepted." : "Typed operation stdin write failed.",
        });
      });
      child.stdin?.end(command.stdin);
    }

    const terminateChild = (signal: NodeJS.Signals): void => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      /*
      CDXC:GxserverTypedOperations 2026-06-02-08:24:
      Typed operation timeouts must stop the whole subprocess tree, not only the shell process. Detached POSIX children get their own process group so a fake git/script that starts a long-running child still returns a structured timeout within the bounded runtime.
      */
      if (process.platform !== "win32" && child.pid !== undefined) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // Fall through to the direct child kill for spawn races or platforms without process-group support.
        }
      }
      child.kill(signal);
    };

    const failAndTerminate = (nextFailure: GxserverTypedOperationFailure): void => {
      if (failure) {
        return;
      }
      failure = nextFailure;
      if (child.exitCode === null && child.signalCode === null) {
        terminateChild("SIGTERM");
        killTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            terminateChild("SIGKILL");
          }
        }, GXSERVER_TYPED_OPERATION_KILL_GRACE_MS);
        killTimer.unref();
      }
    };

    const abort = (): void => {
      failAndTerminate({
        code: "aborted",
        message: "Typed operation was aborted before the subprocess completed.",
      });
    };
    if (options.signal?.aborted) {
      abort();
    } else {
      options.signal?.addEventListener("abort", abort, { once: true });
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      if (failure) {
        return;
      }
      const nextBytes = stdoutBytes + chunk.byteLength;
      if (nextBytes > limits.stdoutLimitBytes) {
        const remaining = limits.stdoutLimitBytes - stdoutBytes;
        if (remaining > 0) {
          stdoutChunks.push(chunk.subarray(0, remaining));
        }
        stdoutBytes = nextBytes;
        failAndTerminate({
          capturedBytes: limits.stdoutLimitBytes,
          code: "stdoutLimitExceeded",
          limitBytes: limits.stdoutLimitBytes,
          message: `Typed operation stdout exceeded ${limits.stdoutLimitBytes} bytes.`,
          stream: "stdout",
        });
        return;
      }
      stdoutBytes = nextBytes;
      stdoutChunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (failure) {
        return;
      }
      const nextBytes = stderrBytes + chunk.byteLength;
      if (nextBytes > limits.stderrLimitBytes) {
        const remaining = limits.stderrLimitBytes - stderrBytes;
        if (remaining > 0) {
          stderrChunks.push(chunk.subarray(0, remaining));
        }
        stderrBytes = nextBytes;
        failAndTerminate({
          capturedBytes: limits.stderrLimitBytes,
          code: "stderrLimitExceeded",
          limitBytes: limits.stderrLimitBytes,
          message: `Typed operation stderr exceeded ${limits.stderrLimitBytes} bytes.`,
          stream: "stderr",
        });
        return;
      }
      stderrBytes = nextBytes;
      stderrChunks.push(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      options.signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      options.signal?.removeEventListener("abort", abort);
      resolve({
        ...(failure ? { error: failure } : {}),
        exitCode: failure ? 1 : (code ?? 1),
        stderr: Buffer.concat(stderrChunks).toString("utf8").trim(),
        stdout: Buffer.concat(stdoutChunks).toString("utf8").trim(),
      });
    });
  });
}

function commandOptions(
  context: GxserverTypedOperationContext,
  env: Record<string, string> = {},
): {
  env: Record<string, string>;
  limits?: Partial<GxserverTypedCommandLimits>;
  signal?: AbortSignal;
} {
  return {
    env: { ...(context.envPath ? { PATH: context.envPath } : {}), ...env },
    limits: context.commandLimits,
    signal: context.abortSignal,
  };
}

function typedOperationProcessEnvironment(env: Record<string, string> = {}): NodeJS.ProcessEnv {
  /*
  CDXC:TypedOperationsColorEnv 2026-06-07-00:38:
  Shared git, GitHub, worktree, and Beads commands run under gxserver but are still terminal-adjacent user workflows. Strip NO_COLOR-style keys from daemon and request-provided env values so typed operations do not propagate color-disabled environments.
  */
  const environment: NodeJS.ProcessEnv = { ...process.env, ...env };
  for (const key of GXSERVER_TYPED_OPERATION_COLOR_DISABLING_ENVIRONMENT_KEYS) {
    delete environment[key];
  }
  return environment;
}

function resolveTypedCommandLimits(limits?: Partial<GxserverTypedCommandLimits>): GxserverTypedCommandLimits {
  return {
    stderrLimitBytes: limits?.stderrLimitBytes ?? GXSERVER_TYPED_OPERATION_STDERR_LIMIT_BYTES,
    stdoutLimitBytes: limits?.stdoutLimitBytes ?? GXSERVER_TYPED_OPERATION_STDOUT_LIMIT_BYTES,
    timeoutMs: limits?.timeoutMs ?? GXSERVER_TYPED_OPERATION_TIMEOUT_MS,
  };
}

function resolveBeadsBoardLimits(context: GxserverTypedOperationContext): GxserverBeadsBoardLimits {
  const commandLimits = resolveTypedCommandLimits(context.commandLimits);
  return {
    fileLimitBytes: context.beadsBoardLimits?.fileLimitBytes ?? GXSERVER_BEADS_BOARD_FILE_LIMIT_BYTES,
    responseLimitBytes: context.beadsBoardLimits?.responseLimitBytes ?? Math.min(commandLimits.stdoutLimitBytes, GXSERVER_BEADS_BOARD_RESPONSE_LIMIT_BYTES),
    rowLimit: context.beadsBoardLimits?.rowLimit ?? GXSERVER_BEADS_BOARD_ROW_LIMIT,
  };
}

async function requireBd(context: GxserverTypedOperationContext): Promise<string> {
  const status = await getBdToolStatus(context.toolchain ?? {});
  if (status.availability === "available" && status.executablePath) {
    return status.executablePath;
  }
  throw new GxserverTypedOperationError("dependencyUnavailable", status.message, {
    guidance: status.guidance,
    tool: status.tool,
  });
}

function parseBeadsBoardListOutput(
  stdout: string,
  limits: GxserverBeadsBoardLimits,
): { issues: readonly Record<string, unknown>[]; stdout: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim() || "[]");
  } catch (error) {
    if (error instanceof GxserverTypedOperationError) {
      throw error;
    }
    throw new GxserverTypedOperationError("badRequest", "Beads board output was not valid JSON.");
  }
  const payload = isRecord(parsed) && Array.isArray(parsed.data) ? parsed.data : parsed;
  if (!Array.isArray(payload)) {
    throw new GxserverTypedOperationError("badRequest", "Beads board output must be a JSON array.");
  }
  const issues: Record<string, unknown>[] = [];
  const serializedIssues: string[] = [];
  let responseBytes = 2;
  let rowCount = 0;
  for (const item of payload) {
    if (!isRecord(item)) {
      continue;
    }
    rowCount += 1;
    if (rowCount > limits.rowLimit) {
      throw new GxserverTypedOperationError(
        "badRequest",
        `Beads board state exceeds the ${limits.rowLimit}-row limit; refusing to return oversized board data.`,
        { rowCount, rowLimit: limits.rowLimit },
      );
    }
    const serialized = JSON.stringify(item);
    const nextResponseBytes = responseBytes + Buffer.byteLength(serialized, "utf8") + (serializedIssues.length === 0 ? 0 : 1);
    if (nextResponseBytes > limits.responseLimitBytes) {
      throw new GxserverTypedOperationError(
        "badRequest",
        `Beads board response exceeds the ${limits.responseLimitBytes}-byte serialized JSON limit; refusing to return oversized board data.`,
        {
          capturedBytes: responseBytes,
          responseLimitBytes: limits.responseLimitBytes,
          rowCount,
        },
      );
    }
    responseBytes = nextResponseBytes;
    issues.push(item);
    serializedIssues.push(serialized);
  }
  return { issues, stdout: `[${serializedIssues.join(",")}]` };
}

async function beadsStorageDirectoryExists(cwd: string): Promise<boolean> {
  try {
    const stats = await statFile(path.join(cwd, ".beads"));
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function countProjectFileLines(cwd: string, filePaths: readonly string[]): Promise<number> {
  let total = 0;
  for (const filePath of filePaths) {
    total += await countProjectFileLineBreaks(cwd, filePath);
  }
  return total;
}

async function countProjectFileLineBreaks(cwd: string, filePath: string): Promise<number> {
  const absolutePath = path.resolve(cwd, filePath);
  if (!isPathInside(cwd, absolutePath)) {
    throw new GxserverTypedOperationError("forbidden", "filePath must stay inside the project.");
  }
  return await new Promise<number>((resolve, reject) => {
    let lines = 0;
    const stream = createReadStream(absolutePath);
    stream.on("data", (chunk: Buffer) => {
      for (let index = 0; index < chunk.length; index += 1) {
        if (chunk[index] === 10) {
          lines += 1;
        }
      }
    });
    stream.on("error", (error: NodeJS.ErrnoException) => {
      reject(
        new GxserverTypedOperationError(
          error.code === "ENOENT" ? "notFound" : "badRequest",
          error.message || "Could not count project file lines.",
        ),
      );
    });
    stream.on("end", () => resolve(lines));
  });
}

function buildBeadsUpdateArgs(params: GxserverRunBeadsActionParams): string[] {
  const args: string[] = [];
  if (params.status !== undefined) {
    args.push("--status", normalizeBeadsStatus(params.status));
  }
  if (params.title !== undefined) {
    args.push("--title", normalizeRequiredText(params.title, "title"));
  }
  if (params.description !== undefined) {
    args.push("--description", String(params.description));
  }
  if (params.priority !== undefined) {
    args.push("--priority", normalizeRequiredText(params.priority, "priority"));
  }
  if (params.estimate !== undefined) {
    if (!Number.isInteger(params.estimate) || params.estimate < 0) {
      throw new GxserverTypedOperationError("badRequest", "estimate must be a non-negative integer.");
    }
    args.push("--estimate", String(params.estimate));
  }
  if (params.labels !== undefined) {
    for (const label of params.labels) {
      args.push("--set-labels", normalizeRequiredText(label, "label"));
    }
  }
  if (args.length === 0) {
    throw new GxserverTypedOperationError("badRequest", "Beads update requires at least one typed field.");
  }
  return args;
}

function buildBeadsCreateArgs(params: GxserverRunBeadsActionParams): string[] {
  const args = [
    "create",
    "--title", normalizeRequiredText(params.title, "title"),
    "--description", String(params.description ?? ""),
    "--priority", normalizeRequiredText(params.priority ?? "2", "priority"),
    "--type", "task",
  ];
  if (params.estimate !== undefined) {
    args.push("--estimate", normalizeBeadsEstimate(params.estimate));
  }
  if (params.labels?.length) {
    args.push("--labels", params.labels.map((label) => normalizeRequiredText(label, "label")).join(","));
  }
  const dependsOnId = typeof params.dependsOnId === "string" ? params.dependsOnId.trim() : "";
  if (dependsOnId) {
    args.push("--deps", `${normalizeBeadsDependencyType(params.depType)}:${normalizeIssueId(dependsOnId)}`);
  }
  args.push("--json");
  return args;
}

function buildBeadsSetLabelArgs(labels: readonly string[] | undefined): string[] {
  const args: string[] = [];
  for (const label of labels ?? []) {
    args.push("--set-labels", normalizeRequiredText(label, "label"));
  }
  return args;
}

function normalizeBeadsEstimate(input: unknown): string {
  if (!Number.isInteger(input) || Number(input) < 0) {
    throw new GxserverTypedOperationError("badRequest", "estimate must be a non-negative integer.");
  }
  return String(input);
}

function normalizeBeadsDependencyType(input: unknown): string {
  const depType = typeof input === "string" && input.trim() ? input.trim() : "blocks";
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(depType)) {
    throw new GxserverTypedOperationError("badRequest", "depType contains unsupported characters.");
  }
  return depType;
}

function normalizeWorktreeTargetPath(input: unknown, context: GxserverTypedOperationContext): string {
  const worktreePath = normalizeAbsolutePath(input, "worktreePath");
  const familyRoot = path.dirname(context.cwd);
  if (!isPathInside(familyRoot, worktreePath)) {
    throw new GxserverTypedOperationError("forbidden", "worktreePath must stay inside the source project worktree family directory.");
  }
  if (worktreePath === context.cwd) {
    throw new GxserverTypedOperationError("forbidden", "worktreePath cannot be the source project directory.");
  }
  return worktreePath;
}

function normalizeExistingWorktreePath(input: unknown, context: GxserverTypedOperationContext): string {
  const worktreePath = normalizeWorktreeTargetPath(input, context);
  return normalizeExistingDirectoryPath(worktreePath, "worktreePath");
}

function normalizeAbsolutePath(input: unknown, field: string): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new GxserverTypedOperationError("badRequest", `${field} must be a non-empty absolute path or ~/ path.`);
  }
  const trimmed = input.trim();
  const expanded = trimmed === "~" ? os.homedir() : trimmed.startsWith("~/") ? path.join(os.homedir(), trimmed.slice(2)) : trimmed;
  if (!path.isAbsolute(expanded)) {
    throw new GxserverTypedOperationError("badRequest", `${field} must be absolute or start with ~/.`);
  }
  return path.resolve(expanded);
}

function normalizeExistingDirectoryPath(input: unknown, field: string): string {
  const directoryPath = normalizeAbsolutePath(input, field);
  try {
    if (!statSync(directoryPath).isDirectory()) {
      throw new GxserverTypedOperationError("badRequest", `${field} is not a directory.`);
    }
  } catch (error) {
    if (error instanceof GxserverTypedOperationError) {
      throw error;
    }
    throw new GxserverTypedOperationError("notFound", `${field} does not exist: ${directoryPath}`);
  }
  return directoryPath;
}

function optionalRelativeFilePath(input: unknown): string[] {
  if (input === undefined || input === null || input === "") {
    return [];
  }
  return [normalizeRelativeFilePath(input)];
}

function optionalRelativeFilePaths(input: unknown): string[] {
  if (input === undefined || input === null) {
    return [];
  }
  if (!Array.isArray(input)) {
    throw new GxserverTypedOperationError("badRequest", "filePaths must be an array of relative paths.");
  }
  if (input.length > 500) {
    throw new GxserverTypedOperationError("badRequest", "filePaths exceeds the 500-file limit.");
  }
  return input.map((filePath) => normalizeRelativeFilePath(filePath));
}

function normalizeRelativeFilePath(input: unknown): string {
  if (typeof input !== "string" || path.isAbsolute(input) || input.split(/[\\/]/).includes("..")) {
    throw new GxserverTypedOperationError("badRequest", "filePath must be a relative path inside the project.");
  }
  const normalized = input.replaceAll("\\", "/").replace(/^\/+/u, "").trim();
  if (!normalized) {
    throw new GxserverTypedOperationError("badRequest", "filePath must be a relative path inside the project.");
  }
  return normalized;
}

function normalizeGitCommitMessage(subjectInput: unknown, bodyInput: unknown): string {
  const subject = normalizeRequiredText(subjectInput, "messageSubject");
  const body = typeof bodyInput === "string" ? bodyInput.trim() : "";
  const message = body ? `${subject}\n\n${body}` : subject;
  if (Buffer.byteLength(message, "utf8") > 64 * 1024) {
    throw new GxserverTypedOperationError("badRequest", "Commit message exceeds the 65536-byte limit.");
  }
  return `${message}\n`;
}

function normalizeGitRef(input: unknown, field: string): string {
  const value = normalizeRequiredText(input, field);
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) || value.includes("..") || value.includes("//") || value.endsWith("/")) {
    throw new GxserverTypedOperationError("badRequest", `${field} is not an allowed Git ref.`);
  }
  return value;
}

function normalizeOptionalGitRef(input: unknown, field: string): string | undefined {
  if (input === undefined || input === null || input === "") {
    return undefined;
  }
  return normalizeGitRef(input, field);
}

function normalizeGitRemoteName(input: unknown): string {
  const value = normalizeRequiredText(input, "remoteName");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new GxserverTypedOperationError("badRequest", "remoteName is not an allowed Git remote name.");
  }
  return value;
}

function normalizeIssueId(input: unknown): string {
  const issueId = normalizeRequiredText(input, "issueId");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(issueId)) {
    throw new GxserverTypedOperationError("badRequest", "issueId contains unsupported characters.");
  }
  return issueId;
}

function normalizeBeadsStatus(input: unknown): string {
  const status = normalizeRequiredText(input, "status");
  if (!["backlog", "closed", "in_progress", "open", "review", "test"].includes(status)) {
    throw new GxserverTypedOperationError("badRequest", `Unsupported Beads status: ${status}`);
  }
  return status;
}

function normalizeBeadsRenamePrefix(input: unknown): string {
  const normalized = normalizeRequiredText(input, "value")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (!normalized || !/^[a-z]/u.test(normalized)) {
    throw new GxserverTypedOperationError("badRequest", "value must start with a letter after normalization.");
  }
  return `${normalized}-`;
}

function normalizeRequiredText(input: unknown, field: string): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new GxserverTypedOperationError("badRequest", `${field} must be a non-empty string.`);
  }
  return input.trim();
}

function normalizeGitAction(action: unknown): GxserverGitAction {
  if (
    action === "addAll" ||
    action === "branch" ||
    action === "commit" ||
    action === "countFileLines" ||
    action === "checkout" ||
    action === "checkoutNewBranch" ||
    action === "deleteLocalBranch" ||
    action === "deleteRemoteBranch" ||
    action === "diff" ||
    action === "diffCached" ||
    action === "diffCachedNoExt" ||
    action === "diffCachedStat" ||
    action === "diffNoExt" ||
    action === "diffNoIndexAgainstNull" ||
    action === "diffNumstat" ||
    action === "getOriginRemoteUrl" ||
    action === "isInsideWorkTree" ||
    action === "isUntrackedFile" ||
    action === "list" ||
    action === "listRemotes" ||
    action === "listUntracked" ||
    action === "merge" ||
    action === "pullFastForward" ||
    action === "push" ||
    action === "pushSetUpstream" ||
    action === "remoteBranchExists" ||
    action === "status" ||
    action === "statusPorcelain" ||
    action === "upstreamCounts" ||
    action === "verifyRef"
  ) {
    return action;
  }
  throw new GxserverTypedOperationError("badRequest", `Unsupported Git action: ${String(action)}`);
}

function resolveProjectSetupCommandProject(
  params: GxserverRunProjectSetupCommandParams,
  context: GxserverTypedOperationContext,
): GxserverProjectDomainState {
  if (typeof params.setupCommandProjectId === "string" && params.setupCommandProjectId.trim()) {
    const project = context.projects.find((candidate) => candidate.projectId === params.setupCommandProjectId);
    if (!project) {
      throw new GxserverTypedOperationError("notFound", `Project ${params.setupCommandProjectId} does not exist.`);
    }
    return project;
  }
  if (typeof params.setupCommandProjectPath === "string" && params.setupCommandProjectPath.trim()) {
    const setupPath = normalizeExistingDirectoryPath(params.setupCommandProjectPath, "setupCommandProjectPath");
    const project = context.projects.find(
      (candidate) =>
        typeof candidate.path === "string" &&
        normalizeExistingDirectoryPath(candidate.path, "project.path") === setupPath,
    );
    if (!project) {
      throw new GxserverTypedOperationError("forbidden", "setupCommandProjectPath must be a registered gxserver project path.");
    }
    return project;
  }
  const targetProject = context.projects.find(
    (candidate) =>
      typeof candidate.path === "string" &&
      normalizeExistingDirectoryPath(candidate.path, "project.path") ===
        normalizeExistingDirectoryPath(context.cwd, "project.path"),
  );
  if (!targetProject) {
    throw new GxserverTypedOperationError("forbidden", "Project setup command target must be a registered gxserver project.");
  }
  return targetProject;
}

function normalizeProjectSetupCommand(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  if (Buffer.byteLength(value, "utf8") > 16_384) {
    throw new GxserverTypedOperationError("badRequest", "worktreeCommand exceeds the 16384-byte limit.");
  }
  return value.trim();
}

function normalizeGitHubAction(action: unknown): GxserverGitHubAction {
  if (action === "prCreateFill" || action === "prView" || action === "version") {
    return action;
  }
  throw new GxserverTypedOperationError("badRequest", `Unsupported GitHub action: ${String(action)}`);
}

function normalizeWorktreeAction(action: unknown): GxserverWorktreeAction {
  if (
    action === "create" ||
    action === "ensureBeadsHooks" ||
    action === "list" ||
    action === "pathExists" ||
    action === "prune" ||
    action === "remove" ||
    action === "switch"
  ) {
    return action;
  }
  throw new GxserverTypedOperationError("badRequest", `Unsupported worktree action: ${String(action)}`);
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await statFile(candidatePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string";
}

function normalizeBeadsAction(action: unknown): GxserverBeadsAction {
  if (
    action === "addLabel" ||
    action === "board" ||
    action === "close" ||
    action === "comment" ||
    action === "configGet" ||
    action === "configGetIssuePrefix" ||
    action === "configSet" ||
    action === "create" ||
    action === "delete" ||
    action === "depAdd" ||
    action === "depRemove" ||
    action === "list" ||
    action === "listAllLabels" ||
    action === "renamePrefix" ||
    action === "removeLabel" ||
    action === "search" ||
    action === "setLabels" ||
    action === "show" ||
    action === "status" ||
    action === "storageExists" ||
    action === "update" ||
    action === "updateDescription" ||
    action === "updateEstimate" ||
    action === "updatePriority" ||
    action === "updateStatus" ||
    action === "updateTitle"
  ) {
    return action;
  }
  throw new GxserverTypedOperationError("badRequest", `Unsupported Beads action: ${String(action)}`);
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
