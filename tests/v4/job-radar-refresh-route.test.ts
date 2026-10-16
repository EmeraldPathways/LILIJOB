import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  company: { id: "company-a", website: "https://www.acme.test", domain: "acme.test", metadataJson: JSON.stringify({ original: { Careers: "https://jobs.greenhouse.io/acme" } }) },
  sources: [{ url: "https://jobs.greenhouse.io/acme", sourceType: "official-careers", provider: "official-careers" }],
  db: { select: vi.fn() },
  discover: vi.fn(),
  start: vi.fn(),
  updateCheckpoint: vi.fn(),
  getRun: vi.fn(),
  persist: vi.fn(),
  finish: vi.fn(),
}));

vi.mock("../../db", () => ({ getDb: () => state.db }));
vi.mock("../../lib/v4/job-radar", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/v4/job-radar")>()), discoverOfficialCareerPage: state.discover }));
vi.mock("../../lib/v4/job-repository", () => ({
  finishJobDiscoveryRun: state.finish,
  getJobDiscoveryRun: state.getRun,
  persistDiscoveredJobs: state.persist,
  startJobDiscoveryRun: state.start,
  updateJobDiscoveryCheckpoint: state.updateCheckpoint,
}));

import { companies, sources } from "../../db/schema";
import { POST } from "../../app/api/v4/jobs/refresh/route";

function request(body: unknown) {
  return new Request("https://site.test/api/v4/jobs/refresh", {
    method: "POST",
    headers: { "content-type": "application/json", "oai-authenticated-user-id": "owner-a", "oai-authenticated-user-email": "owner@example.test" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.company = { id: "company-a", website: "https://www.acme.test", domain: "acme.test", metadataJson: JSON.stringify({ original: { Careers: "https://jobs.greenhouse.io/acme" } }) };
  state.sources = [{ url: "https://jobs.greenhouse.io/acme", sourceType: "official-careers", provider: "official-careers" }];
  state.db.select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: () => {
        const rows = table === companies ? [state.company] : table === sources ? state.sources : [];
        return { limit: async () => rows, then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject) };
      },
    }),
  }));
  state.discover.mockResolvedValue({ status: "supported", sourceUrl: "https://jobs.greenhouse.io/acme", checkedAt: "2026-10-15T12:00:00.000Z", jobs: [] });
  state.start.mockResolvedValue("job-run-a");
  state.updateCheckpoint.mockResolvedValue(true);
  state.getRun.mockResolvedValue({ id: "job-run-a", status: "running" });
  state.persist.mockResolvedValue({ found: true, jobsCreated: 0, snapshotsCreated: 0, sourcesCreated: 0 });
  state.finish.mockResolvedValue(undefined);
});

describe("manual Job Radar refresh source scope", () => {
  it("rejects an unsaved caller-provided URL before any public fetch", async () => {
    const response = await POST(request({ companyId: "company-a", sourceUrl: "https://attacker.test/careers" }));
    expect(response.status).toBe(400);
    expect(state.discover).not.toHaveBeenCalled();
  });

  it("rejects a saved domain-marketplace or partner page as a career source", async () => {
    state.company.metadataJson = JSON.stringify({ original: { Careers: "https://go.acme.test/become-a-partner" } });
    state.sources = [{ url: "https://go.acme.test/become-a-partner", sourceType: "official-careers", provider: "official-careers" }];
    const response = await POST(request({ companyId: "company-a", sourceUrl: "https://go.acme.test/become-a-partner" }));
    expect(response.status).toBe(400);
    expect(state.discover).not.toHaveBeenCalled();
  });

  it("uses a saved official URL and constrains redirects to the company's saved site and ATS hosts", async () => {
    const response = await POST(request({ companyId: "company-a" }));
    expect(response.status).toBe(200);
    expect(state.discover).toHaveBeenCalledWith("https://jobs.greenhouse.io/acme", undefined, undefined, { allowedHosts: ["jobs.greenhouse.io", "acme.test", "www.acme.test"] });
    expect(state.start).toHaveBeenCalledWith("owner-a", expect.objectContaining({ companyId: "company-a", budget: { maxSources: 1, paidApiCostCents: 0 } }), ["https://jobs.greenhouse.io/acme"]);
  });
});
