import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ get: vi.fn(), revision: vi.fn() }));
vi.mock("../../lib/v4/pitch-repository", () => ({ getSectorPitch: state.get, saveSectorPitchRevision: state.revision }));

import { GET, PATCH } from "../../app/api/v4/pitches/[pitchId]/route";

function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("oai-authenticated-user-id", "owner-a");
  headers.set("oai-authenticated-user-email", "owner@example.test");
  return new Request(`https://site.test${path}`, { ...init, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.get.mockResolvedValue({ id: "pitch-1", ownerId: "owner-a", version: 1, payloadJson: "{}" });
  state.revision.mockResolvedValue({ id: "pitch-2", ownerId: "owner-a", version: 2, payloadJson: JSON.stringify({ intro: "Edited" }) });
});

describe("Version 4 sector pitch revisions", () => {
  it("keeps reads private and creates a new version for edits", async () => {
    expect((await GET(new Request("https://site.test/api/v4/pitches/pitch-1"), { params: Promise.resolve({ pitchId: "pitch-1" }) })).status).toBe(401);
    const response = await PATCH(request("/api/v4/pitches/pitch-1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload: { intro: "Edited" } }) }), { params: Promise.resolve({ pitchId: "pitch-1" }) });
    expect(response.status).toBe(201);
    expect(state.revision).toHaveBeenCalledWith("owner-a", "pitch-1", { intro: "Edited" });
  });
});
