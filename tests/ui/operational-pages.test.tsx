import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RunTable } from "../../components/history/run-table";

describe("operational pages", () => {
  it("shows persisted run errors and a retry action", () => {
    const html = renderToStaticMarkup(<RunTable runs={[{
      id: "run-1",
      ownerId: "owner-1",
      kind: "refresh",
      status: "partial",
      category: "all",
      companyId: null,
      requestedBy: "user",
      total: 10,
      processed: 4,
      succeeded: 3,
      failed: 1,
      cursor: JSON.stringify({ remainingCompanyIds: ["co-5"] }),
      error: "One company timed out",
      startedAt: "2026-10-14T00:00:00.000Z",
      finishedAt: null,
      createdAt: "2026-10-14T00:00:00.000Z",
      updatedAt: "2026-10-14T00:00:00.000Z",
    }]} />);

    expect(html).toContain("One company timed out");
    expect(html).toContain("Retry");
  });
});
