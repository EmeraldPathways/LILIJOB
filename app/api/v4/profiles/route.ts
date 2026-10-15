import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { getOrCreateCandidateProfile, listCandidateProfiles } from "../../../../lib/v4/repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  try {
    return Response.json({ profiles: await listCandidateProfiles(user.userId) });
  } catch (error) {
    return Response.json({ error: { code: "PROFILE_LIST_FAILED", message: error instanceof Error ? error.message : "Unable to load candidate profiles." } }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.name !== "string" || !body.name.trim() || body.name.length > 120) {
    return Response.json({ error: { code: "INVALID_PROFILE", message: "A candidate profile name is required." } }, { status: 400 });
  }
  try {
    const profile = await getOrCreateCandidateProfile(user.userId, {
      name: body.name,
      targetFamilies: body.targetFamilies,
      constraints: body.constraints,
      workAuthorization: body.workAuthorization,
      availability: body.availability,
      weightConfig: body.weightConfig,
    });
    return Response.json({ profile }, { status: 201 });
  } catch (error) {
    return Response.json({ error: { code: "PROFILE_CREATE_FAILED", message: error instanceof Error ? error.message : "Unable to save candidate profile." } }, { status: 500 });
  }
}
