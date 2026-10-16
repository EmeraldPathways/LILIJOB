import { describe, expect, it, vi } from "vitest";
vi.mock("../../db", () => ({ getDb: () => { throw new Error("database not used by this test"); } }));
import { buildPdfExport } from "../../lib/v4/documents";
import { tailoredCvExportDocument, validateTailoredCv, type TailoredCvPayload } from "../../lib/v5/cv";

const payload: TailoredCvPayload = {
  roleTitle: "Product Manager",
  companyName: "North Star",
  sourceUrl: "https://north-star.example/careers/product-manager",
  summary: "Evidence-backed product experience.",
  evidenceReferences: ["evidence-1"],
  sections: [
    { heading: "Professional summary", paragraphs: ["Evidence-backed product experience."] },
    { heading: "Selected experience", items: ["Launch: improved conversion (25%)."] },
  ],
  requirements: [{ requirement: "Product", evidenceIds: ["evidence-1"], status: "supported" }],
  atsChecks: { wordCount: 7, hasRoleTitle: true, hasCompanyName: true, unsupportedNumericClaims: [], warnings: [] },
  generationVersion: "v5-cv-1",
};

describe("complete tailored CV workflow", () => {
  it("rejects unsupported numeric claims and preserves evidence references", () => {
    expect(validateTailoredCv(payload)).toEqual([]);
    expect(validateTailoredCv({ ...payload, atsChecks: { ...payload.atsChecks, unsupportedNumericClaims: ["99"] } }).join(" ")).toContain("numeric claims");
    expect(tailoredCvExportDocument(payload).sections[1]?.items?.[0]).toContain("25%");
  });

  it("renders a readable PDF signature from the complete payload", async () => {
    const bytes = await buildPdfExport(tailoredCvExportDocument(payload));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });
});
