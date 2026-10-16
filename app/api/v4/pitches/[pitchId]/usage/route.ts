import { userFromRequest, unauthorizedResponse } from "../../../../../../lib/auth/require-user";
import { recordPitchUsage } from "../../../../../../lib/v4/pitch-repository";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ pitchId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { pitchId } = await context.params;
  const body = await request.json().catch(() => null) as { variant?: unknown; applicationId?: unknown; outreachDraftId?: unknown; outcome?: unknown } | null;
  if (!body || typeof body.variant !== "string" || !body.variant.trim()) return Response.json({ error: { code: "INVALID_PITCH_USAGE", message: "A pitch variant is required." } }, { status: 400 });
  const usage = await recordPitchUsage(user.userId, pitchId, { variant: body.variant, applicationId: typeof body.applicationId === "string" ? body.applicationId : null, outreachDraftId: typeof body.outreachDraftId === "string" ? body.outreachDraftId : null, outcome: typeof body.outcome === "string" ? body.outcome : null });
  return usage ? Response.json({ usage }, { status: 201 }) : Response.json({ error: { code: "NOT_FOUND", message: "Pitch not found." } }, { status: 404 });
}
