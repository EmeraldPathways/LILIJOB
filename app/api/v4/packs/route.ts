import { and, eq } from "drizzle-orm";
import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { isAIConfigured } from "../../../../lib/ai/client";
import { getDb } from "../../../../db";
import { applicationEvents, applications } from "../../../../db/schema";
import { candidateProfiles, experienceEvidence } from "../../../../db/schema-v4";
import { buildApplicationPack, buildApplicationPackWithAI } from "../../../../lib/v4/packs";
import { createApplicationPack } from "../../../../lib/v4/repository";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.jobTitle !== "string" || typeof body.companyName !== "string" || typeof body.jobSourceUrl !== "string") return Response.json({ error: { code: "INVALID_PACK", message: "Role, company and source URL are required." } }, { status: 400 });
  const profileId = typeof body.profileId === "string" ? body.profileId : null;
  let approvedEvidence: Array<{ id: string; statement: string; metric: string | null }> = [];
  if (profileId) {
    const [profile] = await getDb().select({ id: candidateProfiles.id }).from(candidateProfiles).where(and(eq(candidateProfiles.ownerId, user.userId), eq(candidateProfiles.id, profileId))).limit(1);
    if (!profile) return Response.json({ error: { code: "PROFILE_NOT_FOUND", message: "Candidate profile not found." } }, { status: 404 });
    const rows = await getDb().select({ id: experienceEvidence.id, statement: experienceEvidence.statement, metric: experienceEvidence.metric }).from(experienceEvidence).where(and(eq(experienceEvidence.ownerId, user.userId), eq(experienceEvidence.profileId, profileId), eq(experienceEvidence.approved, true)));
    approvedEvidence = rows;
  }
  const packInput = { jobTitle: body.jobTitle, companyName: body.companyName, requirements: Array.isArray(body.requirements) ? body.requirements.filter((value): value is string => typeof value === "string") : [], jobSourceUrl: body.jobSourceUrl, approvedEvidence, candidateSummary: typeof body.candidateSummary === "string" ? body.candidateSummary : "Product professional preparing an evidence-backed application." };
  let pack = buildApplicationPack(packInput);
  if (isAIConfigured() && body.useAI !== false) {
    try {
      pack = await buildApplicationPackWithAI({ ...packInput, usageOwnerId: user.userId });
    } catch (error) {
      pack = {
        ...pack,
        generation: {
          provider: "fallback",
          model: "gpt-5.6-luna",
          reasoningEffort: "low",
          warning: error instanceof Error ? `AI draft unavailable: ${error.message}` : "AI draft unavailable; deterministic copy was retained.",
        },
      };
    }
  }
  let savedPack;
  if (typeof body.applicationId === "string") {
    const [application] = await getDb().select({ id: applications.id }).from(applications).where(and(eq(applications.ownerId, user.userId), eq(applications.id, body.applicationId))).limit(1);
    if (!application) return Response.json({ error: { code: "APPLICATION_NOT_FOUND", message: "Application not found." } }, { status: 404 });
    savedPack = await createApplicationPack(user.userId, { applicationId: body.applicationId, profileId, sourceUrl: pack.sourceUrl, payload: pack });
    await getDb().insert(applicationEvents).values({ id: `application_event_${crypto.randomUUID()}`, ownerId: user.userId, applicationId: body.applicationId, type: "application-pack-generated", stageFrom: null, stageTo: null, note: "Evidence-constrained application pack generated; review before use.", actor: "user", eventAt: new Date().toISOString(), metadataJson: JSON.stringify({ sourceUrl: pack.sourceUrl, evidenceReferences: pack.evidenceReferences, generatedAt: pack.generatedAt, packId: savedPack?.id }), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  return Response.json({ pack, ...(savedPack ? { savedPack } : {}) });
}
