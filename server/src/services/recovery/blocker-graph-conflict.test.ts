import { describe, expect, it } from "vitest";

import { HttpError } from "../../errors.js";
import { isBlockingRelationCycleError } from "./blocker-graph-conflict.js";

describe("isBlockingRelationCycleError", () => {
  it("recognizes only the exact blocker-cycle validation error", () => {
    expect(isBlockingRelationCycleError(
      new HttpError(422, "Blocking relations cannot contain cycles"),
    )).toBe(true);
    expect(isBlockingRelationCycleError(
      new HttpError(422, "Blocked-by issues must belong to the same company"),
    )).toBe(false);
    expect(isBlockingRelationCycleError(
      new Error("Blocking relations cannot contain cycles"),
    )).toBe(false);
  });
});
