import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ get: vi.fn(), revision: vi.fn() }));
vi.mock("../../lib/v4/repository", () => ({ getApplicationPack: state.get, createApplicationPackRevision: state.revision }));

import { GET, PATCH } from "../../app/api/v4/packs/[packId]/route";
import { GET as exportPack } from "../../app/api/v4/packs/[packId]/export/route";
import { extractCandidateDocumentText } from "../../lib/v4/documents";

const pack = { id: "pack-1", ownerId: "owner-a", applicationId: "app-1", profileId: "profile-1", version: 1, sourceUrl: "https://acme.test/jobs/1", payloadJson: JSON.stringify({ jobTitle: "Product Manager", companyName: "Acme", tailoredSummary: "Original" }) };

function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("oai-authenticated-user-id", "owner-a");
  headers.set("oai-authenticated-user-email", "owner@example.test");
  return new Request(`https://site.test${path}`, { ...init, headers });
}

beforeEach(() => { vi.clearAllMocks(); state.get.mockResolvedValue(pack); state.revision.mockResolvedValue({ ...pack, id: "pack-2", version: 2, payloadJson: JSON.stringify({ ...JSON.parse(pack.payloadJson), tailoredSummary: "Edited" }) }); });

describe("Version 4 application pack routes", () => {
  it("enforces authentication and owner-scoped reads", async () => {
    expect((await GET(new Request("https://site.test/api/v4/packs/pack-1"), { params: Promise.resolve({ packId: "pack-1" }) })).status).toBe(401);
    state.get.mockResolvedValueOnce(null);
    expect((await GET(request("/api/v4/packs/pack-1"), { params: Promise.resolve({ packId: "pack-1" }) })).status).toBe(404);
  });

  it("saves edits as a new version and exposes a private printable export", async () => {
    const response = await PATCH(request("/api/v4/packs/pack-1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload: { ...JSON.parse(pack.payloadJson), tailoredSummary: "Edited" } }) }), { params: Promise.resolve({ packId: "pack-1" }) });
    expect(response.status).toBe(201);
    expect(state.revision).toHaveBeenCalledWith("owner-a", "pack-1", expect.objectContaining({ tailoredSummary: "Edited" }));
    const exported = await exportPack(request("/api/v4/packs/pack-1/export"), { params: Promise.resolve({ packId: "pack-1" }) });
    expect(exported.status).toBe(200);
    expect(await exported.text()).toContain("Product Manager");
  });

  it("exports the saved pack as a real PDF or DOCX attachment", async () => {
    const context = { params: Promise.resolve({ packId: "pack-1" }) };
    const pdf = await exportPack(request("/api/v4/packs/pack-1/export?format=pdf"), context);
    const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toContain('filename="application-pack-1.pdf"');
    expect(new TextDecoder().decode(pdfBytes.slice(0, 5))).toBe("%PDF-");
    expect((await extractCandidateDocumentText(pdfBytes, "application-pack.pdf")).text).toContain("Original");

    const docx = await exportPack(request("/api/v4/packs/pack-1/export?format=docx"), context);
    const docxBytes = new Uint8Array(await docx.arrayBuffer());
    expect(docx.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(docx.headers.get("content-disposition")).toContain('filename="application-pack-1.docx"');
    expect(docxBytes.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    expect((await extractCandidateDocumentText(docxBytes, "application-pack.docx")).text).toContain("Original");
    expect(state.get).toHaveBeenCalledWith("owner-a", "pack-1");
  });

  it("rejects unsupported export formats", async () => {
    const response = await exportPack(request("/api/v4/packs/pack-1/export?format=exe"), { params: Promise.resolve({ packId: "pack-1" }) });
    expect(response.status).toBe(400);
  });
});
