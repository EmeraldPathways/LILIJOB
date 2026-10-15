import { and, eq } from "drizzle-orm";
import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { getDb } from "../../../../db";
import { candidateProfiles, experienceEvidence } from "../../../../db/schema-v4";
import { buildSectorPitch, PITCH_SECTORS } from "../../../../lib/v4/packs";
import { listSectorPitches, saveSectorPitch } from "../../../../lib/v4/pitch-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  return Response.json({ pitches: await listSectorPitches(user.userId) });
}

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.sector !== "string" || typeof body.companyName !== "string" || typeof body.role !== "string") return Response.json({ error: { code: "INVALID_PITCH", message: "Sector, company and role are required." } }, { status: 400 });
  if (!PITCH_SECTORS.includes(body.sector.toLowerCase())) return Response.json({ error: { code: "UNSUPPORTED_SECTOR", message: `Choose one of: ${PITCH_SECTORS.join(", ")}.` } }, { status: 400 });
  let approvedEvidence: Array<{ id: string; statement: string; metric: string | null }> = [];
  if (typeof body.profileId === "string") {
    const [profile] = await getDb().select({ id: candidateProfiles.id }).from(candidateProfiles).where(and(eq(candidateProfiles.ownerId, user.userId), eq(candidateProfiles.id, body.profileId))).limit(1);
    if (!profile) return Response.json({ error: { code: "PROFILE_NOT_FOUND", message: "Candidate profile not found." } }, { status: 404 });
    approvedEvidence = await getDb().select({ id: experienceEvidence.id, statement: experienceEvidence.statement, metric: experienceEvidence.metric }).from(experienceEvidence).where(and(eq(experienceEvidence.ownerId, user.userId), eq(experienceEvidence.profileId, body.profileId), eq(experienceEvidence.approved, true)));
  }
  const pitch = buildSectorPitch(body.sector, { companyName: body.companyName, role: body.role, companyFacts: Array.isArray(body.companyFacts) ? body.companyFacts.filter((value): value is string => typeof value === "string") : [], approvedEvidence });
  const saved = await saveSectorPitch(user.userId, { profileId: typeof body.profileId === "string" ? body.profileId : null, sector: body.sector, companyName: body.companyName, role: body.role, payload: pitch });
  return Response.json({ pitch, saved }, { status: 201 });
}
