import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const titlebarHostSource = readFileSync(new URL("./titlebar-host.tsx", import.meta.url), "utf8");

describe("titlebar mode active state source", () => {
  test("uses an instant active pill while preserving the commented Motion restore point", () => {
    /*
     * CDXC:ModeSwitcher 2026-06-15-20:07:
     * Agents/Source/Browser/Kanban clicks should mark the clicked titlebar tab
     * active immediately. Keep the old Motion spring commented in source so it
     * can be restored without re-discovering the previous tuning.
     */
    expect(titlebarHostSource).not.toMatch(/^import \{ motion \} from "motion\/react";$/m);
    expect(titlebarHostSource).toContain('Previous Motion wiring:\n* import { motion } from "motion/react";');
    expect(titlebarHostSource).not.toMatch(/^const TITLEBAR_MODE_PILL_TRANSITION =/m);
    expect(titlebarHostSource).toContain("const TITLEBAR_MODE_PILL_TRANSITION = {");
    expect(titlebarHostSource).toContain('<span aria-hidden="true" className="titlebar-mode-tab-active" />');
    expect(titlebarHostSource).not.toMatch(/^\s*<motion\.div$/m);
    expect(titlebarHostSource).toContain("*   <motion.div");
    expect(titlebarHostSource).not.toContain('transition={{ type: "spring", bounce: 0.3, duration: 0.6 }}');
  });
});
