import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  createInterview: vi.fn(),
  listInterviews: vi.fn(),
  getInterview: vi.fn(),
  createInterviewPackForInterview: vi.fn(),
  updateInterviewOutcome: vi.fn(),
  approveInterviewFollowUp: vi.fn(),
  updateInterviewPractice: vi.fn(),
}));

vi.mock("../../lib/v4/interview-repository", () => state);

import { GET as list, POST as create } from "../../app/api/v4/interviews/route";
import { PATCH as update } from "../../app/api/v4/interviews/[interviewId]/route";
import { PATCH as updatePractice, POST as createPack } from "../../app/api/v4/interviews/[interviewId]/pack/route";
import { POST as approveFollowUp } from "../../app/api/v4/interviews/[interviewId]/follow-up/approve/route";
import { GET as exportInterview } from "../../app/api/v4/interviews/[interviewId]/export/route";

function request(path: string, init: RequestInit = {}, authenticated = true) {
  const headers = new Headers(init.headers);
  if (authenticated) {
    headers.set("oai-authenticated-user-id", "owner-a");
    headers.set("oai-authenticated-user-email", "owner@example.test");
  }
  return new Request(`https://site.test${path}`, { ...init, headers });
}

const context = { params: Promise.resolve({ interviewId: "interview-a" }) };

beforeEach(() => {
  vi.clearAllMocks();
  state.createInterview.mockResolvedValue({ interview: { id: "interview-a" } });
  state.listInterviews.mockResolvedValue([]);
  state.getInterview.mockResolvedValue({ interview: { id: "interview-a" }, packs: [] });
  state.createInterviewPackForInterview.mockResolvedValue({ id: "pack-a", version: 1 });
  state.updateInterviewOutcome.mockResolvedValue({ interview: { id: "interview-a" } });
  state.approveInterviewFollowUp.mockResolvedValue({ interview: { id: "interview-a" } });
  state.updateInterviewPractice.mockResolvedValue({ id: "pack-a", version: 2 });
});

describe("Version 4 interview routes", () => {
  it("requires authentication and scopes list reads to the signed-in owner", async () => {
    expect((await list(request("/api/v4/interviews", {}, false))).status).toBe(401);
    expect((await list(request("/api/v4/interviews"))).status).toBe(200);
    expect(state.listInterviews).toHaveBeenCalledWith("owner-a");
  });

  it("rejects ambiguous local interview times and non-Dublin zones before saving", async () => {
    const ambiguous = await create(request("/api/v4/interviews", { method: "POST", body: JSON.stringify({ applicationId: "app-a", round: "Final", scheduledAt: "2026-10-25T01:30:00" }) }));
    const wrongZone = await create(request("/api/v4/interviews", { method: "POST", body: JSON.stringify({ applicationId: "app-a", round: "Final", scheduledAt: "2026-10-25T01:30:00Z", timezone: "America/New_York" }) }));
    expect(ambiguous.status).toBe(400);
    expect(wrongZone.status).toBe(400);
    expect(state.createInterview).not.toHaveBeenCalled();
  });

  it("rejects invalid source URLs and checked dates before generating a pack", async () => {
    const invalidUrl = await createPack(request("/api/v4/interviews/interview-a/pack", { method: "POST", body: JSON.stringify({ companyName: "Acme", roleTitle: "PM", jobSourceUrl: "javascript:alert(1)", checkedAt: "2026-10-15" }) }), context);
    const invalidDate = await createPack(request("/api/v4/interviews/interview-a/pack", { method: "POST", body: JSON.stringify({ companyName: "Acme", roleTitle: "PM", jobSourceUrl: "https://acme.test/job", checkedAt: "2026-02-30" }) }), context);
    expect(invalidUrl.status).toBe(400);
    expect(invalidDate.status).toBe(400);
    expect(state.createInterviewPackForInterview).not.toHaveBeenCalled();
  });

  it("saves outcomes and editable follow-up drafts for the authenticated owner without accepting client approval state", async () => {
    const response = await update(request("/api/v4/interviews/interview-a", {
      method: "PATCH",
      body: JSON.stringify({ outcome: "progressed", notes: "Recruiter will follow up", followUpDraft: { text: "Thanks for the conversation." }, approvalState: "approved" }),
    }), context);
    expect(response.status).toBe(200);
    expect(state.updateInterviewOutcome).toHaveBeenCalledWith("owner-a", "interview-a", {
      outcome: "progressed",
      notes: "Recruiter will follow up",
      followUpDraft: { text: "Thanks for the conversation." },
    });
  });

  it("requires the explicit owner-scoped approval route for follow-up drafts", async () => {
    expect((await approveFollowUp(request("/api/v4/interviews/interview-a/follow-up/approve", { method: "POST" }, false), context)).status).toBe(401);
    expect((await approveFollowUp(request("/api/v4/interviews/interview-a/follow-up/approve", { method: "POST" }), context)).status).toBe(200);
    expect(state.approveInterviewFollowUp).toHaveBeenCalledWith("owner-a", "interview-a");
  });

  it("saves practice answers and self-evaluation through the owner-scoped pack route", async () => {
    const practiceQas = [{ topic: "experimentation", answerDraft: "I led a test.", selfEvaluation: { relevance: 4, specificity: 3, impact: 5, reflection: "Clarify the baseline." } }];
    const response = await updatePractice(request("/api/v4/interviews/interview-a/pack", { method: "PATCH", body: JSON.stringify({ practiceQas }) }), context);
    expect(response.status).toBe(200);
    expect(state.updateInterviewPractice).toHaveBeenCalledWith("owner-a", "interview-a", practiceQas);
  });

  it("exports practice responses, outcome and follow-up approval state", async () => {
    state.getInterview.mockResolvedValue({
      interview: { id: "interview-a", round: "Final", timezone: "Europe/Dublin", outcome: "progressed", followUpDraft: { text: "Thanks for your time.", status: "approved" } },
      packs: [{ version: 2, generatedAt: "2026-10-15T12:00:00.000Z", sectionsJson: JSON.stringify({ practiceQas: [{ question: "Tell me about experimentation.", answerDraft: "I led a test.", selfEvaluation: { relevance: 4 } }] }) }],
    });
    const response = await exportInterview(request("/api/v4/interviews/interview-a/export"), context);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("Tell me about experimentation.");
    expect(html).toContain("I led a test.");
    expect(html).toContain("progressed");
    expect(html).toContain("approved");
  });
});
