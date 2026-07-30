import { describe, expect, test } from "vitest";
import {
  extractManagedTooltipPlacements,
  extractManagedTooltipPlacementUsages,
  missingManagedTooltipPlacements,
} from "./reference-contract-lib.mjs";

describe("release GPUI reference contract", () => {
  test("extracts defined and used managed tooltip placements", () => {
    const library = `
pub enum ManagedTooltipPlacement {
    #[default]
    Auto,
    Left,
    BelowLeft,
}
`;
    const application = `
let first = ManagedTooltipPlacement::Left;
let second = ManagedTooltipPlacement::Below;
`;

    expect([...extractManagedTooltipPlacements(library)]).toEqual([
      "Auto",
      "Left",
      "BelowLeft",
    ]);
    expect([...extractManagedTooltipPlacementUsages(application)]).toEqual([
      "Left",
      "Below",
    ]);

    const { missing } = missingManagedTooltipPlacements(library, [
      { path: "gpui/src/main.rs", source: application },
    ]);
    expect([...missing]).toEqual([["Below", ["gpui/src/main.rs"]]]);
  });
});
