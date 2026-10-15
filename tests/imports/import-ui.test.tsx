import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ImportsPanel, type ImportRecord } from "../../components/workbench/imports-panel";

const records: ImportRecord[] = [
  {
    id: "imp-1",
    fileName: "dublin-fintech.xlsx",
    fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    status: "partial",
    rowCount: 318,
    acceptedCount: 316,
    duplicateCount: 2,
    errorCount: 1,
    errors: [{ row: 9, message: "Location is outside County Dublin" }],
    runId: "run-1",
    createdAt: "2026-10-14T22:00:00.000Z",
    updatedAt: "2026-10-14T22:10:00.000Z",
  },
];

describe("imports workspace", () => {
  it("renders persisted file status, row counts, errors, and linked run", () => {
    const html = renderToStaticMarkup(<ImportsPanel initialImports={records} />);

    expect(html).toContain("dublin-fintech.xlsx");
    expect(html).toContain("Partial");
    expect(html).toContain('aria-label="316 accepted"');
    expect(html).toContain('aria-label="2 duplicates"');
    expect(html).toContain("Location is outside County Dublin");
    expect(html).toContain("run-1");
    expect(html).toContain("Refresh imports");
    expect(html).toContain("Enrich companies one at a time");
    expect(html).toContain("Reprocess file");
  });

  it("renders a durable empty state", () => {
    const html = renderToStaticMarkup(<ImportsPanel initialImports={[]} />);

    expect(html).toContain("No imports yet");
    expect(html).toContain("Import a CSV or XLSX");
  });
});
