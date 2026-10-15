import { describe, expect, it, vi } from "vitest";
import { WorkbookParseError } from "../../lib/import/parse-workbook";

const { importWorkbook } = vi.hoisted(() => ({ importWorkbook: vi.fn() }));
vi.mock("../../db", () => ({ getDb: vi.fn() }));
vi.mock("../../lib/import/import-service", () => ({ importWorkbook }));

import { POST } from "../../app/api/imports/route";

describe("import upload API", () => {
  it("returns an actionable client error for an empty workbook", async () => {
    importWorkbook.mockRejectedValueOnce(new WorkbookParseError("This worksheet is empty. Add a header row and at least one company row."));
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1])], "empty.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));
    const request = new Request("https://site.test/api/imports", {
      method: "POST",
      headers: {
        "oai-authenticated-user-id": "owner-1",
        "oai-authenticated-user-email": "owner@example.test",
      },
      body: form,
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_WORKBOOK",
        message: "This worksheet is empty. Add a header row and at least one company row.",
      },
    });
  });
});
