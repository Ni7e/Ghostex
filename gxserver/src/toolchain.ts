import { access, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  GxserverToolAvailability,
  GxserverToolCapabilityStatus,
  GxserverToolName,
  GxserverToolResolutionSource,
} from "../protocol/index.js";

export interface GxserverToolchainLayoutOptions {
  envPath?: string;
  gxserverRoot?: string;
  platform?: NodeJS.Platform;
  repoRoot?: string;
  resourcesPath?: string;
  wsl?: boolean;
}

export interface GxserverResolvedTool {
  executablePath: string;
  source: GxserverToolResolutionSource;
  tool: GxserverToolName;
}

export class GxserverToolResolutionError extends Error {
  readonly status: GxserverToolCapabilityStatus;

  constructor(status: GxserverToolCapabilityStatus) {
    super(status.message);
    this.name = "GxserverToolResolutionError";
    this.status = status;
  }
}

const EXECUTABLE_ACCESS = fsConstants.X_OK;

/*
CDXC:GxserverToolchain 2026-05-30-14:18:
Ghostex-managed zmx sessions must use the pinned Ghostex zmx artifact because the pane refresh protocol lives in that forked binary. gxserver therefore resolves zmx only from submodule/build/app resources and treats a PATH zmx as invisible for managed sessions.

CDXC:GxserverToolchain 2026-05-30-14:18:
Previous-session text search must use Ghostex's reviewed zehn fork from the pinned submodule or packaged resources. Missing zehn can explain how to build/install the artifact, but gxserver must not silently substitute a PATH zehn.

CDXC:GxserverToolchain 2026-05-30-14:18:
Beads remains an upstream-owned tool rather than a Ghostex fork. Keep the Project board dependency explicit in toolchain status so clients can surface actionable setup or packaging guidance instead of hiding the missing dependency.

CDXC:GxserverToolchain 2026-06-08-10:46:
Project board should work on first open in packaged Ghostex without asking users to install Homebrew Beads. Resolve the full pinned upstream `bd` from app/gxserver resources.

CDXC:GxserverToolchain 2026-06-10-09:31:
Ghostex Project/Kanban and agent bead workflows must use the same pinned Beads binary so shell-installed `bd` versions cannot diverge from the app's embedded project-board database.
Treat missing staged or bundled Beads as a setup/build failure instead of falling back to PATH.
*/

export async function requireBundledZmx(options: GxserverToolchainLayoutOptions = {}): Promise<GxserverResolvedTool> {
  const status = await getZmxToolStatus(options);
  if (status.availability === "available" && status.executablePath && status.source) {
    return {
      executablePath: status.executablePath,
      source: status.source,
      tool: "zmx",
    };
  }
  throw new GxserverToolResolutionError(status);
}

export async function resolveBundledZehn(options: GxserverToolchainLayoutOptions = {}): Promise<GxserverToolCapabilityStatus> {
  return resolveBundledToolStatus("zehn", options);
}

export async function getZmxToolStatus(
  options: GxserverToolchainLayoutOptions = {},
): Promise<GxserverToolCapabilityStatus> {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return {
      availability: "unsupported",
      capability: "deferred",
      guidance:
        "Native Windows terminal persistence is deferred. Use macOS, Linux, or WSL for gxserver zmx-backed sessions.",
      message:
        "zmx is required for Ghostex-managed sessions on macOS, Linux, and WSL. Native Windows terminal backend support is deferred.",
      tool: "zmx",
    };
  }
  return resolveBundledToolStatus("zmx", options);
}

export async function getBdToolStatus(
  options: GxserverToolchainLayoutOptions = {},
): Promise<GxserverToolCapabilityStatus> {
  const bundled = await resolveBundledBdToolStatus(options);
  if (bundled.availability === "available") {
    return bundled;
  }
  if (bundled.availability === "notExecutable") {
    return bundled;
  }
  return {
    availability: "missing",
    candidatePaths: bundled.candidatePaths,
    capability: "beadsProjectBoard",
    guidance:
      "Packaged Ghostex builds include the pinned Beads CLI. For source checkouts, build/stage Beads into Ghostex app resources; in a repository, run `gx bd init` if the project has not been initialized.",
    message: "Bundled bd was not found in Ghostex resources.",
    tool: "bd",
  };
}

export async function getGxserverToolStatuses(
  options: GxserverToolchainLayoutOptions = {},
): Promise<readonly GxserverToolCapabilityStatus[]> {
  const [zmx, zehn, bd] = await Promise.all([
    getZmxToolStatus(options),
    resolveBundledZehn(options),
    getBdToolStatus(options),
  ]);
  return [zmx, zehn, bd];
}

export function describeTerminalBackendScope(options: GxserverToolchainLayoutOptions = {}): string {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return "Native Windows terminal backend support is deferred. macOS, Linux, and WSL use the bundled Ghostex zmx artifact.";
  }
  if (isWsl(options)) {
    return "WSL uses the bundled Ghostex zmx artifact for managed terminal persistence.";
  }
  return "macOS and Linux use the bundled Ghostex zmx artifact for managed terminal persistence.";
}

async function resolveBundledToolStatus(
  tool: Extract<GxserverToolName, "zmx" | "zehn">,
  options: GxserverToolchainLayoutOptions,
): Promise<GxserverToolCapabilityStatus> {
  const candidates = bundledToolCandidates(tool, options);
  const inspected = await Promise.all(candidates.map(inspectCandidate));
  const executable = inspected.find((candidate) => candidate.availability === "available");
  if (executable) {
    return {
      availability: "available",
      capability: tool === "zmx" ? "zmxLifecycle" : "previousSessionHistory",
      executablePath: executable.executablePath,
      message: `${tool} resolved from ${executable.source}.`,
      source: executable.source,
      tool,
    };
  }

  const nonExecutable = inspected.find((candidate) => candidate.availability === "notExecutable");
  const candidatePaths = candidates.map((candidate) => candidate.executablePath);
  if (nonExecutable) {
    return missingBundledToolStatus(tool, "notExecutable", candidatePaths, nonExecutable.executablePath);
  }
  return missingBundledToolStatus(tool, "missing", candidatePaths);
}

async function resolveBundledBdToolStatus(
  options: GxserverToolchainLayoutOptions,
): Promise<GxserverToolCapabilityStatus> {
  const candidates = bundledBdToolCandidates(options);
  const inspected = await Promise.all(candidates.map(inspectCandidate));
  const executable = inspected.find((candidate) => candidate.availability === "available");
  if (executable) {
    return {
      availability: "available",
      capability: "beadsProjectBoard",
      executablePath: executable.executablePath,
      message: `bd resolved from ${executable.source}. gxserver will use Ghostex's bundled Beads CLI.`,
      source: executable.source,
      tool: "bd",
    };
  }

  const candidatePaths = candidates.map((candidate) => candidate.executablePath);
  const nonExecutable = inspected.find((candidate) => candidate.availability === "notExecutable");
  if (nonExecutable) {
    return {
      availability: "notExecutable",
      candidatePaths,
      capability: "beadsProjectBoard",
      guidance:
        "Packaged Ghostex builds must place an executable pinned Beads CLI at the bundled bd resource path. Rebuild the app resources so Project board operations can run.",
      message: `Ghostex Project board requires bundled bd, but bundled bd exists and is not executable: ${nonExecutable.executablePath}.`,
      tool: "bd",
    };
  }
  return {
    availability: "missing",
    candidatePaths,
    capability: "beadsProjectBoard",
    message: "Bundled bd was not found in Ghostex resources.",
    tool: "bd",
  };
}

interface ToolCandidate {
  executablePath: string;
  source: GxserverToolResolutionSource;
}

function bundledToolCandidates(
  tool: Extract<GxserverToolName, "zmx" | "zehn">,
  options: GxserverToolchainLayoutOptions,
): readonly ToolCandidate[] {
  const gxserverRoot = options.gxserverRoot ?? defaultGxserverRoot();
  const repoRoot = options.repoRoot ?? path.resolve(gxserverRoot, "..");
  const resourcesPath = options.resourcesPath ?? defaultResourcesPath();
  const sourceRoot = options.repoRoot ?? defaultSourceRoot();

  return dedupeCandidates([
    /*
    CDXC:GxserverRustPort 2026-06-15-18:06:
    Phase 5 source-tree compatibility runs need the TypeScript daemon to resolve the same Ghostex-managed zmx artifact as Rust without consulting PATH. Honor an explicit source-root environment override only as another pinned development layout.
    */
    ...(sourceRoot
      ? [
          {
            executablePath: path.join(sourceRoot, tool, "zig-out", "bin", tool),
            source: "devSubmodule" as const,
          },
        ]
      : []),
    {
      executablePath: path.join(repoRoot, tool, "zig-out", "bin", tool),
      source: "devSubmodule",
    },
    {
      executablePath: path.join(gxserverRoot, "bin", tool),
      source: "gxserverBundle",
    },
    {
      executablePath: path.join(gxserverRoot, "..", "bin", tool),
      source: "appResource",
    },
    {
      executablePath: path.join(gxserverRoot, "..", "Web", "bin", tool),
      source: "appResource",
    },
    {
      executablePath: path.join(gxserverRoot, "..", "..", "Web", "bin", tool),
      source: "appResource",
    },
    ...(resourcesPath
      ? [
          {
            executablePath: path.join(resourcesPath, "Web", "bin", tool),
            source: "appResource" as const,
          },
          {
            executablePath: path.join(resourcesPath, "gxserver", "bin", tool),
            source: "gxserverBundle" as const,
          },
        ]
      : []),
  ]);
}

function bundledBdToolCandidates(options: GxserverToolchainLayoutOptions): readonly ToolCandidate[] {
  const gxserverRoot = options.gxserverRoot ?? defaultGxserverRoot();
  const repoRoot = options.repoRoot ?? path.resolve(gxserverRoot, "..");
  const inferredSourceRoot = path.resolve(gxserverRoot, "..", "..");
  const resourcesPath = options.resourcesPath ?? defaultResourcesPath();

  return dedupeCandidates([
    {
      executablePath: path.join(gxserverRoot, "bin", "bd"),
      source: "gxserverBundle",
    },
    {
      executablePath: path.join(gxserverRoot, "..", "bin", "bd"),
      source: "appResource",
    },
    {
      executablePath: path.join(gxserverRoot, "..", "Web", "bin", "bd"),
      source: "appResource",
    },
    {
      executablePath: path.join(gxserverRoot, "..", "..", "Web", "bin", "bd"),
      source: "appResource",
    },
    {
      executablePath: path.join(repoRoot, "native", "macos", "ghostexHost", "Web", "bin", "bd"),
      source: "appResource",
    },
    {
      executablePath: path.join(inferredSourceRoot, "native", "macos", "ghostexHost", "Web", "bin", "bd"),
      source: "appResource",
    },
    ...(resourcesPath
      ? [
          {
            executablePath: path.join(resourcesPath, "Web", "bin", "bd"),
            source: "appResource" as const,
          },
          {
            executablePath: path.join(resourcesPath, "gxserver", "bin", "bd"),
            source: "gxserverBundle" as const,
          },
        ]
      : []),
  ]);
}

function dedupeCandidates(candidates: readonly ToolCandidate[]): readonly ToolCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const resolved = path.resolve(candidate.executablePath);
    if (seen.has(resolved)) {
      return false;
    }
    seen.add(resolved);
    return true;
  });
}

async function inspectCandidate(candidate: ToolCandidate): Promise<
  | {
      availability: "available";
      executablePath: string;
      source: GxserverToolResolutionSource;
    }
  | {
      availability: "missing" | "notExecutable";
      executablePath: string;
    }
> {
  try {
    const fileStat = await stat(candidate.executablePath);
    if (!fileStat.isFile()) {
      return { availability: "missing", executablePath: candidate.executablePath };
    }
    await access(candidate.executablePath, EXECUTABLE_ACCESS);
    return {
      availability: "available",
      executablePath: candidate.executablePath,
      source: candidate.source,
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { availability: "missing", executablePath: candidate.executablePath };
    }
    return { availability: "notExecutable", executablePath: candidate.executablePath };
  }
}

function missingBundledToolStatus(
  tool: Extract<GxserverToolName, "zmx" | "zehn">,
  availability: Extract<GxserverToolAvailability, "missing" | "notExecutable">,
  candidatePaths: readonly string[],
  failedPath?: string,
): GxserverToolCapabilityStatus {
  const isZmx = tool === "zmx";
  const failure = availability === "notExecutable" ? `exists but is not executable: ${failedPath ?? tool}` : "was not found";
  const guidance = isZmx
    ? [
        "Build the pinned Ghostex zmx submodule before starting managed sessions:",
        "  git submodule update --init --recursive zmx",
        "  cd zmx && zig build -Doptimize=ReleaseSafe",
        "Packaged builds must place zmx in gxserver/app resources. PATH zmx is intentionally ignored.",
      ].join("\n")
    : [
        "Build the pinned Ghostex zehn submodule before using CLI search flows:",
        "  git submodule update --init zehn",
        "  cd zehn && zig build -Doptimize=ReleaseFast",
        "Packaged builds must place zehn in gxserver/app resources. PATH zehn is intentionally ignored.",
      ].join("\n");
  return {
    availability,
    candidatePaths,
    capability: isZmx ? "zmxLifecycle" : "previousSessionHistory",
    guidance,
    message: isZmx
      ? `Ghostex-managed zmx sessions require bundled zmx, but bundled zmx ${failure}.`
      : `Ghostex CLI search requires bundled zehn, but bundled zehn ${failure}.`,
    tool,
  };
}

function defaultGxserverRoot(): string {
  return path.resolve(fileURLToPath(import.meta.url), "..", "..");
}

function defaultResourcesPath(): string | undefined {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
}

function defaultSourceRoot(): string | undefined {
  const candidate = process.env.GHOSTEX_SOURCE_ROOT ?? process.env.ghostex_REPO_ROOT;
  return candidate && path.isAbsolute(candidate) ? candidate : undefined;
}

function isWsl(options: GxserverToolchainLayoutOptions): boolean {
  if (typeof options.wsl === "boolean") {
    return options.wsl;
  }
  if ((options.platform ?? process.platform) !== "linux") {
    return false;
  }
  return /microsoft|wsl/i.test(os.release());
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
