import { describe, expect, it } from "vitest";
import { DEFAULT_RANKING_WEIGHTS, rankOpportunity, type RankingJob, type RankingProfile } from "../../lib/v4/ranking";

const profile: RankingProfile = {
  targetFamilies: ["Product Manager", "AI Product Manager"],
  skills: ["product strategy", "experimentation", "analytics", "payments"],
  domains: ["fintech", "ai"],
  seniority: "senior",
  constraints: {
    locations: ["Dublin", "Remote Ireland"],
    workModels: ["hybrid", "remote"],
    minimumSalary: 60_000,
    eligibility: "unknown",
  },
  interestCompanies: ["Acme Payments"],
  evidence: ["Led an experimentation programme that improved conversion by 18%.", "Owned payment product strategy."],
};

const job: RankingJob = {
  id: "job-1",
  companyId: "company-1",
  companyName: "Acme Payments",
  title: "Senior Product Manager, Payments",
  description: "Own payments product strategy, analytics and experimentation for our Dublin team.",
  requirements: ["product strategy", "analytics", "experimentation", "payments"],
  location: "Dublin",
  workModel: "hybrid",
  seniority: "senior",
  salaryMin: 70_000,
  freshnessDays: 2,
};

describe("Version 4 opportunity ranking", () => {
  it("is deterministic, bounded and exposes the configured dimensions", () => {
    const first = rankOpportunity(profile, job);
    const second = rankOpportunity(profile, job);
    expect(first).toEqual(second);
    expect(first.score).toBeGreaterThanOrEqual(0);
    expect(first.score).toBeLessThanOrEqual(100);
    expect(first.dimensions).toHaveProperty("skillsExperience");
    expect(first.dimensions).toHaveProperty("roleScope");
    expect(first.explanations.matched.some((item) => item.toLowerCase().includes("analytics"))).toBe(true);
    expect(first.score).toBeGreaterThan(70);
    expect(first.weights).toEqual(DEFAULT_RANKING_WEIGHTS);
  });

  it("flags a hard location mismatch separately from the heuristic score", () => {
    const result = rankOpportunity(profile, { ...job, location: "London", workModel: "onsite" });
    expect(result.hardConstraints.location.status).toBe("fail");
    expect(result.hardFailures).toContain("location");
    expect(result.explanations.gaps.join(" ")).toMatch(/location|remote/i);
  });

  it("keeps unknown salary and eligibility unknown instead of treating them as failures", () => {
    const result = rankOpportunity(profile, { ...job, salaryMin: undefined, salaryMax: undefined, eligibility: "unknown" });
    expect(result.hardConstraints.salary.status).toBe("unknown");
    expect(result.hardConstraints.eligibility.status).toBe("unknown");
    expect(result.hardFailures).not.toContain("salary");
    expect(result.hardFailures).not.toContain("eligibility");
  });

  it("does not invent a skill when the job and evidence do not support it", () => {
    const result = rankOpportunity(profile, { ...job, requirements: ["quantum computing"], description: "Build quantum computing systems." });
    expect(result.explanations.matched.join(" ")).not.toMatch(/quantum/i);
    expect(result.explanations.gaps.join(" ")).toMatch(/quantum/i);
  });
});
