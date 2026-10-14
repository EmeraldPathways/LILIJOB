import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShell } from "../../components/workbench/app-shell";
import { WORKBENCH_NAV } from "../../components/workbench/navigation";

describe("Dublin Tech Compass workspace", () => {
  it("exposes the four research tabs", () => {
    expect(WORKBENCH_NAV.map((item) => item.label)).toEqual([
      "Work Permit Companies",
      "Startups",
      "Fintech",
      "E-commerce",
    ]);
  });

  it("renders the split workspace controls and privacy copy", () => {
    const html = renderToStaticMarkup(
      <AppShell user={{ displayName: "Researcher", email: "researcher@example.com" }} initialCompanies={[]} />,
    );
    expect(html).toContain("Dublin Tech Compass");
    expect(html).toContain("Private workspace");
    expect(html).toContain("Refresh now");
    expect(html).toContain("Import file");
    expect(html).toContain("Find companies");
    expect(html).toContain("Refresh history");
    expect(html).toContain("AI helper");
    expect(html).toContain("Filter companies");
    expect(html).toContain("Research assistant");
  });

  it("renders a mobile category selector and an accessible split-workspace landmark", () => {
    const html = renderToStaticMarkup(
      <AppShell user={{ displayName: "Researcher", email: "researcher@example.com" }} initialCompanies={[]} />,
    );

    expect(html).toContain('aria-label="Research lens"');
    expect(html).toContain('aria-label="Company workspace"');
    expect(html).toContain('aria-label="Company profile"');
  });
});
