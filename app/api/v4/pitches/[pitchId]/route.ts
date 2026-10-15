import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { getSectorPitch, saveSectorPitchRevision } from "../../../../../lib/v4/pitch-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ pitchId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { pitchId } = await context.params;
  const pitch = await getSectorPitch(user.userId, pitchId);
  return pitch ? Response.json({ pitch }) : Response.json({ error: { code: "NOT_FOUND", message: "Pitch not found." } }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ pitchId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { pitchId } = await context.params;
  const body = await request.json().catch(() => null) as { payload?: unknown } | null;
  if (!body || !body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) return Response.json({ error: { code: "INVALID_PITCH", message: "An editable pitch payload is required." } }, { status: 400 });
  const pitch = await saveSectorPitchRevision(user.userId, pitchId, body.payload);
  return pitch ? Response.json({ pitch }, { status: 201 }) : Response.json({ error: { code: "NOT_FOUND", message: "Pitch not found." } }, { status: 404 });
}
