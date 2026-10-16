import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  db: { select: vi.fn() },
  company: { id: "company-a", ownerId: "owner-a", website: "https://acme.test", domain: "acme.test", metadataJson: JSON.stringify({ original: { Careers: "https://careers.acme.test/jobs" } }) },
  sources: [{ url: "https://careers.acme.test/jobs", sourceType: "official-careers", provider: "official-careers" }],
  discover: vi.fn(),
  start: vi.fn(),
  checkpoint: vi.fn(),
  persistJobs: vi.fn(),
  persistPublic: vi.fn(),
  finish: vi.fn(),
}));

vi.mock("../../db", () => ({ getDb: () => state.db }));
vi.mock("../../lib/v4/job-radar", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/v4/job-radar")>()), discoverOfficialCareerPageWithContent: state.discover }));
vi.mock("../../lib/v4/job-repository", () => ({
  finishJobDiscoveryRun: state.finish,
  persistDiscoveredJobs: state.persistJobs,
  startJobDiscoveryRun: state.start,
  updateJobDiscoveryCheckpoint: state.checkpoint,
}));
vi.mock("../../lib/v4/collection", () => ({ persistOfficialPublicFindings: state.persistPublic }));

import { companies, sources } from "../../db/schema";
import type { JobRadarResult } from "../../lib/v4/job-radar";

beforeEach(() => {
  vi.clearAllMocks();
  state.company = { id: "company-a", ownerId: "owner-a", website: "https://acme.test", domain: "acme.test", metadataJson: JSON.stringify({ original: { Careers: "https://careers.acme.test/jobs" } }) };
  state.sources = [{ url: "https://careers.acme.test/jobs", sourceType: "official-careers", provider: "official-careers" }];
  state.db.select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: () => {
        const rows = table === companies ? [state.company] : table === sources ? state.sources : [];
        return {
          limit: async () => rows,
          then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
        };
      },
    }),
  }));
  const result: JobRadarResult = { status: "partial", jobs: [{ externalId: null, title: "Product Manager", url: "https://acme.test/jobs/product-manager", description: null, location: null, workModel: null, employmentType: null, salary: null, postedAt: null, firstSeenAt: "2026-10-15T12:00:00.000Z", lastConfirmedAt: "2026-10-15T12:00:00.000Z", verified: false, sourceUrl: "https://careers.acme.test/jobs" }], sourceUrl: "https://careers.acme.test/jobs", checkedAt: "2026-10-15T12:00:00.000Z" };
  state.discover.mockResolvedValue({ result, fetchedPages: [{ sourceUrl: "https://careers.acme.test/jobs", contentType: "text/html", body: "<main>Official jobs page</main>" }] });
  state.start.mockResolvedValue("job-run-a");
  state.checkpoint.mockResolvedValue(true);
  state.persistJobs.mockResolvedValue({ found: true, jobsCreated: 1, snapshotsCreated: 1, sourcesCreated: 1 });
  state.persistPublic.mockResolvedValue({ contacts: [{}], signals: [{}], contactsCreated: 1, signalsCreated: 1 });
  state.finish.mockResolvedValue(undefined);
});

describe("scheduled Job Radar company worker", () => {
  it("uses only the owner's saved career URL and persists bounded jobs, public contacts, and signals", async () => {
    const { runScheduledJobRadarCompany } = await import("../../lib/v4/schedule/job-radar-worker");
    const outcome = await runScheduledJobRadarCompany("owner-a", "company-a");
    expect(state.discover).toHaveBeenCalledWith("https://careers.acme.test/jobs", expect.any(Function), expect.any(String), {
      allowedHosts: ["careers.acme.test", "acme.test"], maxRolePages: 3,
    });
    expect(state.start).toHaveBeenCalledWith("owner-a", expect.objectContaining({ budget: { maxSources: 1, maxRoleDetails: 3, paidApiCostCents: 0 } }), ["https://careers.acme.test/jobs"]);
    expect(state.persistJobs).toHaveBeenCalledWith("owner-a", "company-a", expect.objectContaining({ status: "partial" }));
    expect(state.persistPublic).toHaveBeenCalledWith("owner-a", expect.objectContaining({ companyId: "company-a", sourceUrl: "https://careers.acme.test/jobs", html: "<main>Official jobs page</main>" }));
    expect(outcome).toEqual({ status: "partial", jobsFound: 1, contactsFound: 1, signalsFound: 1 });
  });

  it("does not fetch a source when the selected company is not owned by the schedule owner", async () => {
    state.company = null as never;
    const { runScheduledJobRadarCompany } = await import("../../lib/v4/schedule/job-radar-worker");
    await expect(runScheduledJobRadarCompany("owner-b", "company-a")).resolves.toMatchObject({ status: "unavailable" });
    expect(state.discover).not.toHaveBeenCalled();
  });
});
