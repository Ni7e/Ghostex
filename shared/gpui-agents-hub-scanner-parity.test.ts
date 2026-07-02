import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

/**
 * The Agents Hub filesystem catalog has two scanner implementations: the
 * macOS Node helper script embedded in native-sidebar.tsx
 * (getAgentsHubCatalogNodeScript) and the GPUI native Rust port
 * (GpuiAgentsHubCatalogBuilder in gpui/src/main.rs). Repo policy forbids
 * tests inside gpui/, so this shared source test extracts every
 * home-relative catalog root/file path from BOTH sources and asserts the
 * sets stay identical. Adding, removing, or renaming a provider root on one
 * side without the other fails here.
 */

const macosSidebarSource = readFileSync(
  new URL("../native/sidebar/native-sidebar.tsx", import.meta.url),
  "utf8",
);
const gpuiMainSource = readFileSync(
  new URL("../gpui/src/main.rs", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function quotedSegments(argList: string): string[] {
  return [...argList.matchAll(/"([^"]*)"/g)].map((match) => match[1]!);
}

function macosCatalogHomePaths(): Set<string> {
  const catalogScript = sourceBetween(
    macosSidebarSource,
    "function getAgentsHubCatalogNodeScript",
    "function getProjectEditorAutoSleepTimeoutMs",
  );
  const paths = new Set<string>();
  // p("segment", ...) — the script's home-relative path helper.
  for (const match of catalogScript.matchAll(/(?<![A-Za-z0-9_.])p\(((?:\s*"[^"]*"\s*,?)+)\)/g)) {
    paths.add(quotedSegments(match[1]!).join("/"));
  }
  // path.join(home, "segment", ...) — the non-dot shared agents trees.
  for (const match of catalogScript.matchAll(/path\.join\(home,((?:\s*"[^"]*"\s*,?)+)\)/g)) {
    paths.add(quotedSegments(match[1]!).join("/"));
  }
  return paths;
}

function gpuiCatalogHomePaths(): Set<string> {
  const rustScanner = sourceBetween(
    gpuiMainSource,
    "struct GpuiAgentsHubCatalogBuilder",
    "fn gpui_empty_agents_hub_catalog_build",
  );
  const paths = new Set<string>();
  // builder.home_path(&["segment", ...]) — the Rust home-relative helper.
  for (const match of rustScanner.matchAll(/home_path\(&\[([^\]]*)\]/g)) {
    paths.add(quotedSegments(match[1]!).join("/"));
  }
  // home.join("agents").join("skills") — the non-dot shared agents trees.
  for (const match of rustScanner.matchAll(/home\s*\.join\("([^"]+)"\)((?:\s*\.join\("[^"]+"\))*)/g)) {
    const chain = [
      match[1]!,
      ...[...match[2]!.matchAll(/"([^"]+)"/g)].map((segment) => segment[1]!),
    ];
    paths.add(chain.join("/"));
  }
  return paths;
}

describe("GPUI Agents Hub scanner parity with the macOS catalog script", () => {
  test("both scanners reference the same home-relative catalog paths", () => {
    const macosPaths = macosCatalogHomePaths();
    const gpuiPaths = gpuiCatalogHomePaths();

    // Guard the extraction itself: a regex or boundary regression that
    // extracts nothing must fail loudly instead of passing on empty sets.
    expect(macosPaths.size).toBeGreaterThanOrEqual(20);
    expect(gpuiPaths.size).toBeGreaterThanOrEqual(20);
    for (const anchor of [
      ".claude/CLAUDE.md",
      ".codex/AGENTS.md",
      ".config/opencode/opencode.json",
      ".pi/agent/settings.json",
      "agents/skills",
      "agents/hooks",
    ]) {
      expect(macosPaths.has(anchor), `macOS scanner lost ${anchor}`).toBe(true);
      expect(gpuiPaths.has(anchor), `GPUI scanner lost ${anchor}`).toBe(true);
    }

    // The macOS script additionally names the bare shared-agents directory as
    // a profile containment root (path.join(home, "agents")); the Rust port
    // expresses that containment through its subtree roots, so the bare root
    // is the one accepted one-sided entry.
    const macosOnly = [...macosPaths]
      .filter((path) => !gpuiPaths.has(path) && path !== "agents")
      .sort();
    const gpuiOnly = [...gpuiPaths].filter((path) => !macosPaths.has(path)).sort();
    expect(macosOnly).toEqual([]);
    expect(gpuiOnly).toEqual([]);
  });
});
