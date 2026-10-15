import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../../lib/v4/intelligence-repository", () => ({
  listHiringSignals: state.list,
  createHiringSignal: state.create,
  updateHiringSignal: state.update,
}));

import { GET, POST } from "../../app/api/v4/signals/route";
import { PATCH } from "../../app/api/v4/signals/[signalId]/route";

function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("oai-authenticated-user-id", "owner-a");
  headers.set("oai-authenticated-user-email", "owner@example.test");
  return new Request(`https://site.test${path}`, { ...init, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.list.mockResolvedValue([]);
  state.create.mockResolvedValue({ id: "signal-1", verifiedStatus: "unverified" });
  state.update.mockResolvedValue({ id: "signal-1", verifiedStatus: "suppressed" });
});

describe("Version 4 hiring signal routes", () => {
  it("lists owner-scoped QA and expiry states", async () => {
    state.list.mockResolvedValue([{ id: "signal-1", qaStatus: "expired", isExpired: true, sourceVerificationStatus: "not-live-verified" }]);
    const response = await GET(request("/api/v4/signals?companyId=company-1"));
    expect(response.status).toBe(200);
    expect(state.list).toHaveBeenCalledWith("owner-a", "company-1");
    expect((await response.json() as { signals: unknown[] }).signals[0]).toMatchObject({ qaStatus: "expired", isExpired: true, sourceVerificationStatus: "not-live-verified" });
  });

  it("validates signal type, source URL, and numeric scoring inputs", async () => {
    const base = { companyId: "company-1", type: "funding", summary: "Acme raised funding", discoveredAt: "2026-10-15", sourceUrl: "https://acme.test/news" };
    expect((await POST(request("/api/v4/signals", { method: "POST", body: JSON.stringify({ ...base, type: "untrusted-type" }) }))).status).toBe(400);
    expect((await POST(request("/api/v4/signals", { method: "POST", body: JSON.stringify({ ...base, sourceUrl: "http://acme.test/news" }) }))).status).toBe(400);
    expect((await POST(request("/api/v4/signals", { method: "POST", body: JSON.stringify({ ...base, functionRelevance: 500 }) }))).status).toBe(400);
    expect(state.create).not.toHaveBeenCalled();
  });

  it("passes unknown evidence explicitly and keeps primary sources unverified", async () => {
    const response = await POST(request("/api/v4/signals", { method: "POST", body: JSON.stringify({ companyId: "company-1", type: "funding", summary: "Acme raised funding", eventDate: "2026-10-10", discoveredAt: "2026-10-15", sourceUrl: "https://acme.test/news", sourceReliability: "primary" }) }));
    expect(response.status).toBe(201);
    expect(state.create).toHaveBeenCalledWith("owner-a", expect.objectContaining({ sourceReliability: "primary", dublinConnection: null }));
    expect((await response.json() as { signal: { verifiedStatus: string } }).signal.verifiedStatus).toBe("unverified");
  });

  it("supports owner-scoped corrections and suppression through PATCH", async () => {
    const response = await PATCH(request("/api/v4/signals/signal-1", { method: "PATCH", body: JSON.stringify({ correction: { summary: "Corrected hiring event", eventDate: "2026-10-11" }, suppressed: true }) }), { params: Promise.resolve({ signalId: "signal-1" }) });
    expect(response.status).toBe(200);
    expect(state.update).toHaveBeenCalledWith("owner-a", "signal-1", expect.objectContaining({ correction: { summary: "Corrected hiring event", eventDate: "2026-10-11" }, suppressed: true }));
  });

  it("requires an actual correction or suppression change", async () => {
    const response = await PATCH(request("/api/v4/signals/signal-1", { method: "PATCH", body: JSON.stringify({ ignored: true }) }), { params: Promise.resolve({ signalId: "signal-1" }) });
    expect(response.status).toBe(400);
    expect(state.update).not.toHaveBeenCalled();
  });
});
