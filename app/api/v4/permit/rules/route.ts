import { env } from "cloudflare:workers";
import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { createPermitRule, listPermitRules } from "../../../../../lib/v4/intelligence-repository";
import { isOfficialPermitSourceUrl, isValidIsoDate, type PermitRuleProvenanceInput } from "../../../../../lib/v4/permit";

export const dynamic = "force-dynamic";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  return Response.json({ rules: await listPermitRules() });
}

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  if (!env.V4_PERMIT_RULE_ADMIN_ID || env.V4_PERMIT_RULE_ADMIN_ID !== user.userId) return Response.json({ error: { code: "FORBIDDEN", message: "Permit rule updates are restricted to the configured rules administrator." } }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.id !== "string" || !body.id.trim() || typeof body.ruleSet !== "string" || !body.ruleSet.trim() || !isValidIsoDate(body.effectiveFrom) || !isOfficialPermitSourceUrl(body.sourceUrl) || !Array.isArray(body.eligibleOccupations) || body.eligibleOccupations.length === 0 || body.eligibleOccupations.some((value) => typeof value !== "string" || !value.trim())) {
    return Response.json({ error: { code: "INVALID_RULE", message: "Rule ID, set, valid effective date, official HTTPS source URL, and occupations are required." } }, { status: 400 });
  }
  const effectiveTo = body.effectiveTo === undefined || body.effectiveTo === null ? null : body.effectiveTo;
  if (effectiveTo !== null && !isValidIsoDate(effectiveTo)) {
    return Response.json({ error: { code: "INVALID_RULE", message: "End date must be a valid YYYY-MM-DD date or null." } }, { status: 400 });
  }
  if (effectiveTo !== null && effectiveTo < body.effectiveFrom) {
    return Response.json({ error: { code: "INVALID_RULE", message: "End date cannot precede the start date." } }, { status: 400 });
  }
  if (body.salaryThreshold !== undefined && body.salaryThreshold !== null && (typeof body.salaryThreshold !== "number" || !Number.isFinite(body.salaryThreshold) || body.salaryThreshold < 0)) {
    return Response.json({ error: { code: "INVALID_RULE", message: "Salary threshold must be a non-negative number." } }, { status: 400 });
  }

  const rawProvenance = body.provenance === undefined ? {} : body.provenance;
  if (!record(rawProvenance)) return Response.json({ error: { code: "INVALID_RULE", message: "Rule provenance must be an object." } }, { status: 400 });
  if (rawProvenance.authority !== undefined && (typeof rawProvenance.authority !== "string" || !rawProvenance.authority.trim())) {
    return Response.json({ error: { code: "INVALID_RULE", message: "Source authority must be a non-empty string." } }, { status: 400 });
  }
  if (rawProvenance.title !== undefined && rawProvenance.title !== null && (typeof rawProvenance.title !== "string" || !rawProvenance.title.trim())) {
    return Response.json({ error: { code: "INVALID_RULE", message: "Source title must be a non-empty string or null." } }, { status: 400 });
  }
  if (rawProvenance.sourceCheckedAt !== undefined && rawProvenance.sourceCheckedAt !== null && !isValidIsoDate(rawProvenance.sourceCheckedAt)) {
    return Response.json({ error: { code: "INVALID_RULE", message: "Reported source-check date must be a valid YYYY-MM-DD date or null." } }, { status: 400 });
  }
  const authority = typeof rawProvenance.authority === "string" ? rawProvenance.authority.trim() : new URL(body.sourceUrl).hostname;
  const provenance: PermitRuleProvenanceInput = {
    authority,
    title: typeof rawProvenance.title === "string" ? rawProvenance.title.trim() : null,
    sourceCheckedAt: typeof rawProvenance.sourceCheckedAt === "string" ? rawProvenance.sourceCheckedAt : null,
  };
  const rule = await createPermitRule({
    id: body.id.trim(),
    ruleSet: body.ruleSet.trim(),
    effectiveFrom: body.effectiveFrom,
    effectiveTo,
    sourceUrl: body.sourceUrl,
    eligibleOccupations: body.eligibleOccupations.map((value) => (value as string).trim()),
    salaryThreshold: typeof body.salaryThreshold === "number" ? body.salaryThreshold : undefined,
    provenance,
  });
  return rule
    ? Response.json({ rule }, { status: 201 })
    : Response.json({ error: { code: "RULE_VERSION_EXISTS", message: "A rule already exists for this effective date; create a new dated version instead of replacing history." } }, { status: 409 });
}
