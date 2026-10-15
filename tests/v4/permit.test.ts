import { describe, expect, it } from "vitest";
import { evaluatePermit, selectPermitRule, type PermitRule } from "../../lib/v4/permit";

const rules: PermitRule[] = [
  { id: "old", ruleSet: "critical-skills", effectiveFrom: "2025-01-01", effectiveTo: "2026-05-31", sourceUrl: "https://enterprise.gov.ie/old", eligibleOccupations: ["product manager"], salaryThreshold: 60_000 },
  { id: "current", ruleSet: "critical-skills", effectiveFrom: "2026-06-01", effectiveTo: null, sourceUrl: "https://enterprise.gov.ie/current", eligibleOccupations: ["product manager"], salaryThreshold: 64_000, provenance: { authority: "Department of Enterprise", title: "Employment permits", sourceCheckedAt: null } },
];

describe("Version 4 permit reality", () => {
  it("selects the rule effective on the role date", () => {
    expect(selectPermitRule(rules, "2026-02-01")?.id).toBe("old");
    expect(selectPermitRule(rules, "2026-10-15")?.id).toBe("current");
  });

  it("keeps unknown salary and sponsorship separate from occupation potential", () => {
    const result = evaluatePermit({ roleTitle: "Product Manager", salary: null, relevantDate: "2026-10-15", dublinEvidence: "specific-job", pastSponsorshipEvidence: true, currentSupportEvidence: false }, rules);
    expect(result.status).toBe("cannot-determine");
    expect(result.labels).toContain("public evidence of past sponsorship");
    expect(result.labels).not.toContain("explicit employer statement of current support");
    expect(result.labels).toContain("insufficient information");
    expect(result.labels).toContain("salary unknown");
    expect(result.labels).toContain("current employer support not evidenced");
    expect(result.labels).toContain("user/legal confirmation required");
    expect(result.sourceUrl).toBe("https://enterprise.gov.ie/current");
    expect(result.provenance).toMatchObject({ authority: "Department of Enterprise", verificationStatus: "not-live-verified" });
    expect(result.refresh).toMatchObject({ status: "manual-review-required", liveVerificationPerformed: false });
  });

  it("marks a qualifying input as potential and still requires user/legal confirmation", () => {
    const result = evaluatePermit({ roleTitle: "Product Manager", salary: 70_000, relevantDate: "2026-10-15", dublinEvidence: "remote-from-Ireland", pastSponsorshipEvidence: false, currentSupportEvidence: true }, rules);
    expect(result.status).toBe("potential");
    expect(result.labels).toContain("potential occupation/salary eligibility");
    expect(result.labels).toContain("explicit employer statement of current support");
    expect(result.requiresConfirmation).toBe(true);
  });

  it("returns unknown rather than choosing between overlapping effective rules", () => {
    const overlapping: PermitRule[] = [
      ...rules,
      { id: "overlap", ruleSet: "critical-skills", effectiveFrom: "2026-09-01", effectiveTo: null, sourceUrl: "https://enterprise.gov.ie/overlap", eligibleOccupations: ["product manager"], salaryThreshold: 70_000 },
    ];
    expect(selectPermitRule(overlapping, "2026-10-15")).toBeNull();
    const result = evaluatePermit({ roleTitle: "Product Manager", salary: 80_000, relevantDate: "2026-10-15", dublinEvidence: "unknown", pastSponsorshipEvidence: null, currentSupportEvidence: null }, overlapping);
    expect(result.status).toBe("cannot-determine");
    expect(result.labels).toContain("applicable rule is unknown for this date");
    expect(result.provenance).toBeNull();
  });

  it("distinguishes a known salary miss from an unknown eligibility result", () => {
    const result = evaluatePermit({ roleTitle: "Product Manager", salary: 50_000, relevantDate: "2026-10-15", dublinEvidence: "none", pastSponsorshipEvidence: false, currentSupportEvidence: false }, rules);
    expect(result.status).toBe("not-evidenced");
    expect(result.labels).toContain("not evidenced");
    expect(result.labels).toContain("Dublin connection not evidenced");
  });

  it("rejects malformed calendar dates and non-official source URLs", async () => {
    const { isValidIsoDate, isOfficialPermitSourceUrl } = await import("../../lib/v4/permit");
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-10-15")).toBe(true);
    expect(isOfficialPermitSourceUrl("https://enterprise.gov.ie/permits")).toBe(true);
    expect(isOfficialPermitSourceUrl("https://enterprise.gov.ie.evil.test/permits")).toBe(false);
    expect(isOfficialPermitSourceUrl("http://enterprise.gov.ie/permits")).toBe(false);
  });
});
