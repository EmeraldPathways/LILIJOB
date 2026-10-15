import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  createDraft: vi.fn(),
  listDrafts: vi.fn(),
  getDraft: vi.fn(),
  getRecipient: vi.fn(),
  getEvent: vi.fn(),
  approveDraft: vi.fn(),
  createEvent: vi.fn(),
  gmailConfigured: true,
  env: { GMAIL_TOKEN_ENCRYPTION_KEY: "key", GOOGLE_CLIENT_ID: "client" as string | undefined, GOOGLE_CLIENT_SECRET: "secret" as string | undefined },
}));

vi.mock("cloudflare:workers", () => ({ env: state.env }));
vi.mock("../../db", () => ({ getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) }) }));
vi.mock("../../lib/v4/outreach-repository", () => ({
  createOutreachDraft: state.createDraft,
  listOutreachDrafts: state.listDrafts,
  getOutreachDraft: state.getDraft,
  getOutreachRecipient: state.getRecipient,
  getOutreachEventByDedup: state.getEvent,
  approveOutreachDraft: state.approveDraft,
  createOutreachEvent: state.createEvent,
  outreachDedupKey: () => "stable-dedup",
}));
vi.mock("../../lib/email/core", () => ({
  decryptToken: vi.fn(async (value: string) => value),
  encryptToken: vi.fn(async (value: string) => value),
  isGmailConfigured: () => state.gmailConfigured,
  validEmail: (value: string | null) => value && value.includes("@") ? value : null,
}));
vi.mock("../../lib/email/google", () => ({ refreshGoogleAccessToken: vi.fn(), sendGmailMessage: vi.fn(), GmailSendError: class GmailSendError extends Error { outcome = "unknown" as const; } }));

import { GET as listDrafts, POST as createDraft } from "../../app/api/v4/outreach/route";
import { POST as approveDraft } from "../../app/api/v4/outreach/[draftId]/approve/route";
import { POST as sendDraft } from "../../app/api/v4/outreach/[draftId]/send/route";

function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("oai-authenticated-user-id", "owner-a");
  headers.set("oai-authenticated-user-email", "owner@example.test");
  return new Request(`https://site.test${path}`, { ...init, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.env.GOOGLE_CLIENT_ID = "client";
  state.env.GOOGLE_CLIENT_SECRET = "secret";
  state.gmailConfigured = true;
  state.listDrafts.mockResolvedValue([]);
  state.createDraft.mockResolvedValue({ id: "draft-1", approvalState: "draft" });
});

describe("Version 4 outreach routes", () => {
  it("requires authentication and validates the individual recipient draft", async () => {
    expect((await listDrafts(new Request("https://site.test/api/v4/outreach"))).status).toBe(401);
    const invalid = await createDraft(request("/api/v4/outreach", { method: "POST", body: JSON.stringify({ companyId: "co-1" }) }));
    expect(invalid.status).toBe(400);
    expect(state.createDraft).not.toHaveBeenCalled();
  });

  it("creates a draft, keeps approval explicit and blocks a send before review", async () => {
    const created = await createDraft(request("/api/v4/outreach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId: "co-1", contactId: "contact-1", subject: "Hello", body: "Message" }) }));
    expect(created.status).toBe(201);
    state.getDraft.mockResolvedValue({ id: "draft-1", ownerId: "owner-a", companyId: "co-1", contactId: "contact-1", subject: "Hello", body: "Message", approvalState: "draft", applicationId: null });
    state.getRecipient.mockResolvedValue({ contact: { email: "talent@example.test", doNotContact: false }, company: { id: "co-1" } });
    const blocked = await sendDraft(request("/api/v4/outreach/draft-1/send", { method: "POST" }), { params: Promise.resolve({ draftId: "draft-1" }) });
    expect(blocked.status).toBe(409);
    expect(state.createEvent).not.toHaveBeenCalled();
  });

  it("does not allow an opted-out contact to be sent even after draft approval", async () => {
    state.getDraft.mockResolvedValue({ id: "draft-1", ownerId: "owner-a", companyId: "co-1", contactId: "contact-1", subject: "Hello", body: "Message", approvalState: "approved", applicationId: null });
    state.getRecipient.mockResolvedValue({ contact: { email: "talent@example.test", doNotContact: true }, company: { id: "co-1" } });
    const blocked = await sendDraft(request("/api/v4/outreach/draft-1/send", { method: "POST" }), { params: Promise.resolve({ draftId: "draft-1" }) });
    expect(blocked.status).toBe(409);
  });

  it("requires a configured Gmail provider after the approval boundary", async () => {
    state.getDraft.mockResolvedValue({ id: "draft-1", ownerId: "owner-a", companyId: "co-1", contactId: "contact-1", subject: "Hello", body: "Message", approvalState: "approved", applicationId: null });
    state.getRecipient.mockResolvedValue({ contact: { email: "talent@example.test", doNotContact: false }, company: { id: "co-1" } });
    state.gmailConfigured = false;
    const response = await sendDraft(request("/api/v4/outreach/draft-1/send", { method: "POST" }), { params: Promise.resolve({ draftId: "draft-1" }) });
    expect(response.status).toBe(503);
  });

  it("approves a draft only for the authenticated owner", async () => {
    state.approveDraft.mockResolvedValue({ id: "draft-1", approvalState: "approved" });
    const response = await approveDraft(request("/api/v4/outreach/draft-1/approve", { method: "POST" }), { params: Promise.resolve({ draftId: "draft-1" }) });
    expect(response.status).toBe(200);
    expect(state.approveDraft).toHaveBeenCalledWith("owner-a", "draft-1");
  });
});
