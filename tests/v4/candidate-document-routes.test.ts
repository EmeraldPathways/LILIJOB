import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  env: { BUCKET: { put: vi.fn(), delete: vi.fn() } },
  create: vi.fn(),
  profile: vi.fn(),
  list: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: state.env }));
vi.mock("../../lib/v4/repository", () => ({
  createCandidateDocument: state.create,
  getCandidateProfile: state.profile,
  listCandidateDocuments: state.list,
}));

import { POST } from "../../app/api/v4/profiles/[profileId]/documents/route";
import { buildDocxExport } from "../../lib/v4/documents";

function request(path: string, form: FormData) {
  return new Request(`https://site.test${path}`, {
    method: "POST",
    headers: { "oai-authenticated-user-id": "owner-a", "oai-authenticated-user-email": "owner@example.test" },
    body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.profile.mockResolvedValue({ id: "profile-a", ownerId: "owner-a" });
  state.create.mockImplementation(async (_ownerId, input) => ({ id: "document-a", ...input }));
});

describe("candidate document upload route", () => {
  it("extracts DOCX text before saving metadata while retaining the private R2 object key", async () => {
    const blob = await buildDocxExport({
      title: "Jordan Riley",
      sections: [{ heading: "Experience", paragraphs: ["Led checkout experiments across three markets."] }],
    });
    const form = new FormData();
    form.append("file", new File([await blob.arrayBuffer()], "candidate.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    form.append("type", "master-cv");

    const response = await POST(request("/api/v4/profiles/profile-a/documents", form), { params: Promise.resolve({ profileId: "profile-a" }) });
    const body = await response.json() as { document: { id: string } };

    expect(response.status).toBe(201);
    expect(state.env.BUCKET.put).toHaveBeenCalledWith(expect.stringMatching(/^private\/owner-a\/candidate-documents\/.+\.docx$/), expect.any(ArrayBuffer), expect.any(Object));
    expect(state.create).toHaveBeenCalledWith("owner-a", expect.objectContaining({
      profileId: "profile-a",
      parsedText: expect.stringContaining("Led checkout experiments across three markets."),
      consentStatus: "pending",
      derived: expect.objectContaining({ parseStatus: "ready" }),
    }));
    expect(body.document.id).toBe("document-a");
  });

  it("rejects cross-owner profile access before storing the uploaded file", async () => {
    state.profile.mockResolvedValueOnce(null);
    const form = new FormData();
    form.append("file", new File(["resume text"], "candidate.txt", { type: "text/plain" }));

    const response = await POST(request("/api/v4/profiles/other-owner-profile/documents", form), { params: Promise.resolve({ profileId: "other-owner-profile" }) });

    expect(response.status).toBe(404);
    expect(state.env.BUCKET.put).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });

  it("rejects a supported extension when the upload bytes have another format", async () => {
    const form = new FormData();
    form.append("file", new File(["not a PDF"], "candidate.pdf", { type: "application/pdf" }));

    const response = await POST(request("/api/v4/profiles/profile-a/documents", form), { params: Promise.resolve({ profileId: "profile-a" }) });

    expect(response.status).toBe(415);
    expect(state.env.BUCKET.put).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });

  it("keeps a private PDF when automatic extraction needs manual review", async () => {
    const form = new FormData();
    form.append("file", new File(["%PDF-1.4\nprotected or damaged document"], "candidate.pdf", { type: "application/pdf" }));

    const response = await POST(request("/api/v4/profiles/profile-a/documents", form), { params: Promise.resolve({ profileId: "profile-a" }) });

    expect(response.status).toBe(201);
    expect(state.env.BUCKET.put).toHaveBeenCalledTimes(1);
    expect(state.create).toHaveBeenCalledWith("owner-a", expect.objectContaining({
      parsedText: undefined,
      derived: expect.objectContaining({ parseStatus: "needs-review" }),
    }));
  });
});
