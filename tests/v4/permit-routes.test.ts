import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  env: { V4_PERMIT_RULE_ADMIN_ID: undefined as string | undefined },
  rows: [] as unknown[][],
  listRules: vi.fn(),
  createRule: vi.fn(),
  saveEvaluation: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: state.env }));
vi.mock("../../db", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => state.rows.shift() ?? [] }) }) }),
  }),
}));
vi.mock("../../lib/v4/intelligence-repository", () => ({
  listPermitRules: state.listRules,
  createPermitRule: state.createRule,
  savePermitEvaluation: state.saveEvaluation,
}));

import { POST as evaluate } from "../../app/api/v4/permit/evaluate/route";
import { GET as listRules, POST as createRule } from "../../app/api/v4/permit/rules/route";

function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("oai-authenticated-user-id", "owner-a");
  headers.set("oai-authenticated-user-email", "owner@example.test");
  return new Request(`https://site.test${path}`, { ...init, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.env.V4_PERMIT_RULE_ADMIN_ID = undefined;
  state.rows = [];
  state.listRules.mockResolvedValue([]);
  state.createRule.mockResolvedValue({ id: "rule-1" });
  state.saveEvaluation.mockResolvedValue("evaluation-1");
});

describe("Version 4 permit routes", () => {
  it("keeps the rules registry readable but restricts global rule writes", async () => {
    expect((await listRules(new Request("https://site.test/api/v4/permit/rules"))).status).toBe(401);
    expect((await listRules(request("/api/v4/permit/rules"))).status).toBe(200);
    const denied = await createRule(request("/api/v4/permit/rules", { method: "POST", body: JSON.stringify({ id: "rule-1", ruleSet: "critical-skills", effectiveFrom: "2026-01-01", sourceUrl: "https://enterprise.gov.ie/rules", eligibleOccupations: ["Product Manager"] }) }));
    expect(denied.status).toBe(403);
    expect(state.createRule).not.toHaveBeenCalled();
  });

  it("does not evaluate a job belonging to another company or owner", async () => {
    state.rows = [[{ id: "company-1" }], []];
    const response = await evaluate(request("/api/v4/permit/evaluate", { method: "POST", body: JSON.stringify({ companyId: "company-1", jobId: "job-foreign", roleTitle: "Product Manager", relevantDate: "2026-10-15" }) }));
    expect(response.status).toBe(404);
    expect(state.saveEvaluation).not.toHaveBeenCalled();
  });

  it("allows the configured administrator to add a dated rule", async () => {
    state.env.V4_PERMIT_RULE_ADMIN_ID = "owner-a";
    const response = await createRule(request("/api/v4/permit/rules", { method: "POST", body: JSON.stringify({ id: "rule-1", ruleSet: "critical-skills", effectiveFrom: "2026-01-01", sourceUrl: "https://enterprise.gov.ie/rules", eligibleOccupations: ["Product Manager"], salaryThreshold: 50000 }) }));
    expect(response.status).toBe(201);
    expect(state.createRule).toHaveBeenCalledWith(expect.objectContaining({ effectiveFrom: "2026-01-01", salaryThreshold: 50000, provenance: expect.objectContaining({ authority: "enterprise.gov.ie", sourceCheckedAt: null }) }));
  });

  it("rejects malformed effective dates and source URLs outside official HTTPS domains", async () => {
    state.env.V4_PERMIT_RULE_ADMIN_ID = "owner-a";
    const post = (body: Record<string, unknown>) => createRule(request("/api/v4/permit/rules", { method: "POST", body: JSON.stringify(body) }));
    const base = { id: "rule-1", ruleSet: "critical-skills", effectiveFrom: "2026-10-15", sourceUrl: "https://enterprise.gov.ie/rules", eligibleOccupations: ["Product Manager"] };
    expect((await post({ ...base, effectiveFrom: "2026-02-30" })).status).toBe(400);
    expect((await post({ ...base, sourceUrl: "https://enterprise.gov.ie.evil.test/rules" })).status).toBe(400);
    expect(state.createRule).not.toHaveBeenCalled();
  });

  it("returns a conflict instead of overwriting an existing effective-date rule", async () => {
    state.env.V4_PERMIT_RULE_ADMIN_ID = "owner-a";
    state.createRule.mockResolvedValueOnce(null);
    const response = await createRule(request("/api/v4/permit/rules", { method: "POST", body: JSON.stringify({ id: "rule-1", ruleSet: "critical-skills", effectiveFrom: "2026-01-01", sourceUrl: "https://enterprise.gov.ie/rules", eligibleOccupations: ["Product Manager"] }) }));
    expect(response.status).toBe(409);
    expect(state.createRule).toHaveBeenCalledOnce();
  });

  it("labels absent evaluation evidence as unknown and never claims live source verification", async () => {
    state.rows = [[{ id: "company-1" }]];
    state.listRules.mockResolvedValue([{ id: "rule-1", ruleSet: "critical-skills", effectiveFrom: "2026-01-01", effectiveTo: null, sourceUrl: "https://enterprise.gov.ie/rules", rulesJson: JSON.stringify({ eligibleOccupations: ["Product Manager"], salaryThreshold: 50000, provenance: { authority: "Department of Enterprise", title: "Permits", sourceCheckedAt: null } }) }]);
    const response = await evaluate(request("/api/v4/permit/evaluate", { method: "POST", body: JSON.stringify({ companyId: "company-1", roleTitle: "Product Manager", relevantDate: "2026-10-15" }) }));
    const body = await response.json() as { result: { labels: string[]; provenance: { verificationStatus: string } } };
    expect(response.status).toBe(200);
    expect(body.result.labels).toContain("salary unknown");
    expect(body.result.labels).toContain("past sponsorship evidence unknown");
    expect(body.result.labels).toContain("current employer support unknown");
    expect(body.result.provenance.verificationStatus).toBe("not-live-verified");
  });
});
