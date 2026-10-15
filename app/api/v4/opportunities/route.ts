import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { rankAndPersistOpportunities } from "../../../../lib/v4/opportunities";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const profileId = new URL(request.url).searchParams.get("profileId");
  if (!profileId) return Response.json({ error: { code: "PROFILE_REQUIRED", message: "Choose a candidate profile first." } }, { status: 400 });
  const opportunities = await rankAndPersistOpportunities(user.userId, profileId);
  return opportunities ? Response.json({ opportunities }) : Response.json({ error: { code: "PROFILE_NOT_FOUND", message: "Candidate profile not found." } }, { status: 404 });
}

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.profileId !== "string" || typeof body.jobId !== "string") return Response.json({ error: { code: "INVALID_OPPORTUNITY", message: "Profile and job IDs are required." } }, { status: 400 });
  const { updateOpportunityAction } = await import("../../../../lib/v4/opportunities");
  const match = await updateOpportunityAction(user.userId, body.profileId, body.jobId, { starred: typeof body.starred === "boolean" ? body.starred : undefined, dismissed: typeof body.dismissed === "boolean" ? body.dismissed : undefined, overrideScore: typeof body.overrideScore === "number" ? body.overrideScore : body.overrideScore === null ? null : undefined, overrideReason: typeof body.overrideReason === "string" ? body.overrideReason : body.overrideReason === null ? null : undefined });
  return match ? Response.json({ match }) : Response.json({ error: { code: "OPPORTUNITY_NOT_FOUND", message: "Rank this opportunity before changing it." } }, { status: 404 });
}
