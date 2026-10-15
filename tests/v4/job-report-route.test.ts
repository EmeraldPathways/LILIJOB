import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ getJob: vi.fn(), insertValues: vi.fn() }));
vi.mock("../../lib/v4/job-repository", () => ({ getV4Job: state.getJob }));
vi.mock("../../db", () => ({ getDb: () => ({ insert: () => ({ values: state.insertValues }) }) }));

import { POST } from "../../app/api/v4/jobs/[jobId]/report/route";

function request(body: unknown, authenticated = true) {
  const headers = new Headers({ "content-type": "application/json" });
  if (authenticated) {
    headers.set("oai-authenticated-user-id", "owner-a");
    headers.set("oai-authenticated-user-email", "owner@example.test");
  }
  return new Request("https://site.test/api/v4/jobs/job-1/report", { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.getJob.mockResolvedValue({ job: { id: "job-1", url: "https://acme.test/jobs/1" } });
  state.insertValues.mockResolvedValue(undefined);
});

describe("Job Radar invalid-report persistence", () => {
  it("requires authentication and an owner-visible job", async () => {
    expect((await POST(request({ reason: "Closed" }, false), { params: Promise.resolve({ jobId: "job-1" }) })).status).toBe(401);
    state.getJob.mockResolvedValueOnce(null);
    expect((await POST(request({ reason: "Closed" }), { params: Promise.resolve({ jobId: "job-1" }) })).status).toBe(404);
    expect(state.insertValues).not.toHaveBeenCalled();
  });

  it("persists a bounded invalid-job reason in the owner's audit record", async () => {
    const response = await POST(request({ reason: "The employer says this role is closed." }), { params: Promise.resolve({ jobId: "job-1" }) });
    expect(response.status).toBe(201);
    expect(state.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "owner-a",
      actor: "owner-a",
      action: "job-invalid-reported",
      entityId: "job-1",
      detailsJson: expect.stringContaining("The employer says this role is closed."),
    }));
    expect((await POST(request({ reason: " " }), { params: Promise.resolve({ jobId: "job-1" }) })).status).toBe(400);
  });
});
