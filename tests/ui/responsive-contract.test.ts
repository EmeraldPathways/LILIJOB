import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

describe("responsive workspace contract", () => {
  it("keeps mobile navigation, one-page scrolling, and filter-sheet primitives wired", () => {
    expect(css).toContain("@media (max-width: 820px)");
    expect(css).toContain(".mobile-select-wrap");
    expect(css).toContain(".workspace-grid { display: flex");
    expect(css).toContain("overflow: visible");
    expect(css).toContain(".company-detail-scroll { flex: none; overflow: visible");
    expect(css).toContain(".sheet-backdrop");
    expect(css).toContain(".topbar-settings");
  });
});
