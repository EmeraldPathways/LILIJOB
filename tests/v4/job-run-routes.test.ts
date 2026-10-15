import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), cancel: vi.fn(), retry: vi.fn() }));
vi.mock("../../lib/v4/job-repository", () => ({
  listJobDiscoveryRuns: state.list,
  getJobDiscoveryRun: state.get,
  cancelJobDiscoveryRun: state.cancel,
  retryJobDiscoveryRun: state.retry,
}));

import { GET as listRuns } from "../../app/api/v4/jobs/runs/route";
import { GET as getRun, POST as cancelRun } from "../../app/api/v4/jobs/runs/[runId]/route";
import { POST as retryRun } from "../../app/api/v4/jobs/runs/[runId]/retry/route";

function request(url: string, authenticated = true, method = "GET") {
  const headers = new Headers();
  if (authenticated) {
    headers.set("oai-authenticated-user-id", "owner-a");
    headers.set("oai-authenticated-user-email", "owner@example.test");
  }
  return new Request(`https://site.test${url}`, { method, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.list.mockResolvedValue([{ id: "run-1", ownerId: "owner-a" }]);
  state.get.mockResolvedValue({ id: "run-1", ownerId: "owner-a" });
  state.cancel.mockResolvedValue(true);
  state.retry.mockResolvedValue("run-2");
});

describe("Job Radar discovery run routes", () => {
  it("requires authentication and lists only the authenticated owner's runs", async () => {
    expect((await listRuns(request("/api/v4/jobs/runs", false))).status).toBe(401);
    expect((await listRuns(request("/api/v4/jobs/runs?limit=10"))).status).toBe(200);
    expect(state.list).toHaveBeenCalledWith("owner-a", 10);
  });

  it("keeps run reads, cancellation and retry owner-scoped", async () => {
    const context = { params: Promise.resolve({ runId: "run-1" }) };
    expect((await getRun(request("/api/v4/jobs/runs/run-1"), context)).status).toBe(200);
    expect(state.get).toHaveBeenCalledWith("owner-a", "run-1");
    expect((await cancelRun(request("/api/v4/jobs/runs/run-1", true, "POST"), context)).status).toBe(200);
    expect(state.cancel).toHaveBeenCalledWith("owner-a", "run-1");
    expect((await retryRun(request("/api/v4/jobs/runs/run-1/retry", true, "POST"), context)).status).toBe(201);
    expect(state.retry).toHaveBeenCalledWith("owner-a", "run-1");
  });

  it("returns conflict when cancellation or retry is unavailable", async () => {
    const context = { params: Promise.resolve({ runId: "run-1" }) };
    state.cancel.mockResolvedValue(false);
    state.retry.mockResolvedValue(null);
    expect((await cancelRun(request("/api/v4/jobs/runs/run-1", true, "POST"), context)).status).toBe(409);
    expect((await retryRun(request("/api/v4/jobs/runs/run-1/retry", true, "POST"), context)).status).toBe(409);
  });
});
