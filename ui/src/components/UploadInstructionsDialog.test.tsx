// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { mergeUploadedInstructionPaths } from "./UploadInstructionsDialog";

describe("mergeUploadedInstructionPaths", () => {
  it("merges new uploaded file paths into existing pending files without duplicates", () => {
    const current = ["AGENTS.md", "wiki/overview.md"];
    const uploaded = ["wiki/guide.md", "wiki/faq.md"];

    const merged = mergeUploadedInstructionPaths(current, uploaded);
    expect(merged).toEqual(["AGENTS.md", "wiki/overview.md", "wiki/guide.md", "wiki/faq.md"]);
  });

  it("deduplicates paths already present in current files using Set", () => {
    const current = ["AGENTS.md", "wiki/guide.md"];
    const uploaded = ["wiki/guide.md", "wiki/new.md"];

    const merged = mergeUploadedInstructionPaths(current, uploaded);
    expect(merged).toEqual(["AGENTS.md", "wiki/guide.md", "wiki/new.md"]);
  });

  it("deduplicates paths within uploaded files list", () => {
    const current = ["AGENTS.md"];
    const uploaded = ["wiki/dup.md", "wiki/dup.md", "wiki/unique.md"];

    const merged = mergeUploadedInstructionPaths(current, uploaded);
    expect(merged).toEqual(["AGENTS.md", "wiki/dup.md", "wiki/unique.md"]);
  });

  it("handles empty arrays gracefully", () => {
    expect(mergeUploadedInstructionPaths([], [])).toEqual([]);
    expect(mergeUploadedInstructionPaths(["a.md"], [])).toEqual(["a.md"]);
    expect(mergeUploadedInstructionPaths([], ["b.md"])).toEqual(["b.md"]);
  });
});
