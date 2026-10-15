import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanySheet } from "../../components/workbench/company-sheet";
import type { SheetCompany } from "../../lib/sheet/company-sheet";

const companies: SheetCompany[] = [
  {
    id: "co-1",
    name: "North Star",
    domain: "northstar.ie",
    website: "https://northstar.ie",
    locality: null,
    locationText: null,
    description: null,
    categories: [],
    enrichmentStatus: "queued",
    lastEnrichedAt: null,
    nextRefreshAt: null,
    employeeBand: null,
    permitSignal: "unknown",
    openRoles: 0,
    confidence: null,
    freshness: "unknown",
    importedData: { Name: "North Star", Notes: "" },
  },
  {
    id: "co-2",
    name: "Manual Works",
    domain: null,
    website: "https://manualworks.ie",
    locality: null,
    locationText: null,
    description: null,
    categories: [],
    enrichmentStatus: "queued",
    lastEnrichedAt: null,
    nextRefreshAt: null,
    employeeBand: null,
    permitSignal: "unknown",
    openRoles: 0,
    confidence: null,
    freshness: "unknown",
    sector: "Services",
  },
];

describe("company sheet markup", () => {
  it("renders searchable, filterable, selectable editable rows with accessible actions", () => {
    const html = renderToStaticMarkup(
      <CompanySheet
        companies={companies}
        selectedIds={["co-1"]}
        onSelectionChange={() => undefined}
        onSaveCell={async () => undefined}
        onOpenDetail={() => undefined}
      />,
    );

    expect(html).toContain('aria-label="Search all spreadsheet values"');
    expect(html).toContain('aria-label="Filter by column"');
    expect(html).toContain('aria-label="Filter by value"');
    expect(html).toContain('aria-label="Select all visible rows"');
    expect(html).toContain('aria-label="Select North Star"');
    expect(html).toContain('aria-label="View details for North Star"');
    expect(html).toContain('aria-label="Sort by Name"');
    expect(html).not.toContain('aria-label="Edit label Name"');
    expect(html).toContain('aria-label="Edit North Star — Name"');
    expect(html).toContain('data-origin="profile"');
    expect(html).toContain("Manual Works");
    expect(html).toContain("Profile value");
  });
});
