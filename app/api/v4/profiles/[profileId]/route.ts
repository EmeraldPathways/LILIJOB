import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { getCandidateProfile, updateCandidateProfile } from "../../../../../lib/v4/repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ profileId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { profileId } = await context.params;
  const profile = await getCandidateProfile(user.userId, profileId);
  return profile ? Response.json({ profile }) : Response.json({ error: { code: "NOT_FOUND", message: "Candidate profile not found." } }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ profileId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { profileId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Array.isArray(body)) return Response.json({ error: { code: "INVALID_PROFILE", message: "Profile changes must be an object." } }, { status: 400 });
  try {
    const profile = await updateCandidateProfile(user.userId, profileId, {
      name: typeof body.name === "string" ? body.name : undefined,
      targetFamilies: body.targetFamilies,
      constraints: body.constraints,
      workAuthorization: body.workAuthorization,
      availability: body.availability,
      weightConfig: body.weightConfig,
      isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
    });
    return profile ? Response.json({ profile }) : Response.json({ error: { code: "NOT_FOUND", message: "Candidate profile not found." } }, { status: 404 });
  } catch (error) {
    return Response.json({ error: { code: "PROFILE_UPDATE_FAILED", message: error instanceof Error ? error.message : "Unable to update candidate profile." } }, { status: 400 });
  }
}
