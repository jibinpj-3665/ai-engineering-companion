import { describe, expect, it } from "vitest";
import { safeInternalPath } from "../lib/navigation";

describe("safeInternalPath", () => {
  it("keeps same-origin paths", () => {
    expect(safeInternalPath("/documents?subject=3")).toBe("/documents?subject=3");
  });

  it("rejects absolute, protocol-relative and backslash redirects", () => {
    expect(safeInternalPath("https://evil.example")).toBe("/");
    expect(safeInternalPath("//evil.example")).toBe("/");
    expect(safeInternalPath("/\\evil.example")).toBe("/");
    expect(safeInternalPath("/\nevil")).toBe("/");
  });
});
