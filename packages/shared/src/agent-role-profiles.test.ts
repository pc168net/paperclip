import { describe, expect, it } from "vitest";
import { createAgentRoleProfileSchema } from "./index.js";

describe("agent role profile validators", () => {
  it("accepts a non-empty normalized managed-file manifest", () => {
    expect(createAgentRoleProfileSchema.parse({
      name: "Researcher",
      managedFiles: {
        "AGENTS.md": "Research carefully.",
        "guides/approach.md": "Cite primary sources.",
      },
    })).toMatchObject({
      name: "Researcher",
      managedFiles: {
        "AGENTS.md": "Research carefully.",
        "guides/approach.md": "Cite primary sources.",
      },
    });
  });

  it("rejects a manifest path that escapes the instruction root", () => {
    expect(createAgentRoleProfileSchema.safeParse({
      name: "Unsafe",
      managedFiles: { "../escape.md": "no" },
    }).success).toBe(false);
  });

  it("requires the V1 AGENTS.md instruction entry file", () => {
    expect(createAgentRoleProfileSchema.safeParse({
      name: "Missing entry",
      managedFiles: { "SOUL.md": "Focus" },
    }).success).toBe(false);
  });
});
