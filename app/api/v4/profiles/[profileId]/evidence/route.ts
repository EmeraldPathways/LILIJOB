import { userFromRequest, unauthorizedResponse } from "../../../../../../lib/auth/require-user";
import { createExperienceEvidence, getCandidateProfile, listExperienceEvidence } from "../../../../../../lib/v4/repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ profileId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { profileId } = await context.params;
  if (!await getCandidateProfile(user.userId, profileId)) return Response.json({ error: { code: "NOT_FOUND", message: "Candidate profile not found." } }, { status: 404 });
  return Response.json({ evidence: await listExperienceEvidence(user.userId, profileId) });
}

export async function POST(request: Request, context: { params: Promise<{ profileId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { profileId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.title !== "string" || typeof body.statement !== "string") {
    return Response.json({ error: { code: "INVALID_EVIDENCE", message: "Evidence title and statement are required." } }, { status: 400 });
  }
  try {
    const evidence = await createExperienceEvidence(user.userId, profileId, {
      title: body.title,
      statement: body.statement,
      employer: typeof body.employer === "string" ? body.employer : undefined,
      project: typeof body.project === "string" ? body.project : undefined,
      metric: typeof body.metric === "string" ? body.metric : undefined,
      sourceDocumentId: typeof body.sourceDocumentId === "string" ? body.sourceDocumentId : undefined,
      sourceSpan: typeof body.sourceSpan === "string" ? body.sourceSpan : undefined,
      roleRelevance: typeof body.roleRelevance === "string" ? body.roleRelevance : undefined,
      approved: body.approved === true,
    });
    return evidence ? Response.json({ evidence }, { status: 201 }) : Response.json({ error: { code: "NOT_FOUND", message: "Candidate profile not found." } }, { status: 404 });
  } catch (error) {
    return Response.json({ error: { code: "EVIDENCE_CREATE_FAILED", message: error instanceof Error ? error.message : "Unable to save evidence." } }, { status: 400 });
  }
}
