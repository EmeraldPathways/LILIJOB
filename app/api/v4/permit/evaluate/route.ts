import { and, eq } from "drizzle-orm";
import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { getDb } from "../../../../../db";
import { companies, jobs } from "../../../../../db/schema";
import { evaluatePermit, isValidIsoDate, type PermitRule, type PermitRuleProvenanceInput } from "../../../../../lib/v4/permit";
import { listPermitRules, savePermitEvaluation } from "../../../../../lib/v4/intelligence-repository";

export const dynamic = "force-dynamic";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseRule(rule: { id: string; ruleSet: string; effectiveFrom: string; effectiveTo: string | null; sourceUrl: string; rulesJson: string }): PermitRule | null {
  try {
    const parsed = JSON.parse(rule.rulesJson) as Record<string, unknown>;
    const eligibleOccupations = Array.isArray(parsed.eligibleOccupations) ? parsed.eligibleOccupations.filter((value): value is string => typeof value === "string" && Boolean(value.trim())) : [];
    const rawProvenance = record(parsed.provenance) ? parsed.provenance : {};
    const provenance: PermitRuleProvenanceInput = {
      authority: typeof rawProvenance.authority === "string" ? rawProvenance.authority : null,
      title: typeof rawProvenance.title === "string" ? rawProvenance.title : null,
      sourceCheckedAt: typeof rawProvenance.sourceCheckedAt === "string" ? rawProvenance.sourceCheckedAt : null,
    };
    return {
      id: rule.id,
      ruleSet: rule.ruleSet,
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: rule.effectiveTo,
      sourceUrl: rule.sourceUrl,
      eligibleOccupations,
      salaryThreshold: typeof parsed.salaryThreshold === "number" ? parsed.salaryThreshold : undefined,
      provenance,
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.companyId !== "string" || !body.companyId.trim() || typeof body.roleTitle !== "string" || !body.roleTitle.trim() || !isValidIsoDate(body.relevantDate)) {
    return Response.json({ error: { code: "INVALID_EVALUATION", message: "Company, role, and a valid YYYY-MM-DD relevant date are required." } }, { status: 400 });
  }
  if (body.salary !== undefined && body.salary !== null && (typeof body.salary !== "number" || !Number.isFinite(body.salary) || body.salary < 0)) {
    return Response.json({ error: { code: "INVALID_EVALUATION", message: "Salary must be a non-negative number or null." } }, { status: 400 });
  }
  if (body.pastSponsorshipEvidence !== undefined && body.pastSponsorshipEvidence !== null && typeof body.pastSponsorshipEvidence !== "boolean") {
    return Response.json({ error: { code: "INVALID_EVALUATION", message: "Past sponsorship evidence must be true, false, or unknown." } }, { status: 400 });
  }
  if (body.currentSupportEvidence !== undefined && body.currentSupportEvidence !== null && typeof body.currentSupportEvidence !== "boolean") {
    return Response.json({ error: { code: "INVALID_EVALUATION", message: "Current support evidence must be true, false, or unknown." } }, { status: 400 });
  }
  const allowedDublinEvidence = ["office-address", "specific-job", "remote-from-Ireland", "unspecific-Irish-presence", "none", "unknown"];
  if (body.dublinEvidence !== undefined && (typeof body.dublinEvidence !== "string" || !allowedDublinEvidence.includes(body.dublinEvidence))) {
    return Response.json({ error: { code: "INVALID_EVALUATION", message: "Dublin evidence must be one of the supported evidence states." } }, { status: 400 });
  }

  const [company] = await getDb().select({ id: companies.id }).from(companies).where(and(eq(companies.ownerId, user.userId), eq(companies.id, body.companyId))).limit(1);
  if (!company) return Response.json({ error: { code: "COMPANY_NOT_FOUND", message: "Company not found." } }, { status: 404 });
  if (typeof body.jobId === "string") {
    const [job] = await getDb().select({ id: jobs.id, companyId: jobs.companyId }).from(jobs).where(and(eq(jobs.ownerId, user.userId), eq(jobs.id, body.jobId), eq(jobs.companyId, body.companyId))).limit(1);
    if (!job) return Response.json({ error: { code: "JOB_NOT_FOUND", message: "The job must belong to the selected company." } }, { status: 404 });
  }
  const rawRules = await listPermitRules();
  const rules = rawRules.flatMap((rawRule) => {
    const rule = parseRule(rawRule);
    return rule ? [rule] : [];
  });
  const input = {
    companyId: body.companyId.trim(),
    jobId: typeof body.jobId === "string" ? body.jobId : null,
    roleTitle: body.roleTitle.trim(),
    salary: typeof body.salary === "number" ? body.salary : null,
    relevantDate: body.relevantDate,
    dublinEvidence: typeof body.dublinEvidence === "string" ? body.dublinEvidence as "office-address" | "specific-job" | "remote-from-Ireland" | "unspecific-Irish-presence" | "none" | "unknown" : "unknown",
    pastSponsorshipEvidence: typeof body.pastSponsorshipEvidence === "boolean" ? body.pastSponsorshipEvidence : null,
    currentSupportEvidence: typeof body.currentSupportEvidence === "boolean" ? body.currentSupportEvidence : null,
  } as const;
  const result = evaluatePermit(input, rules);
  const evaluationId = await savePermitEvaluation(user.userId, input, result);
  return Response.json({ evaluationId, result });
}
