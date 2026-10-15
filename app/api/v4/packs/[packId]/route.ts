import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { createApplicationPackRevision, getApplicationPack } from "../../../../../lib/v4/repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ packId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { packId } = await context.params;
  const pack = await getApplicationPack(user.userId, packId);
  return pack ? Response.json({ pack }) : Response.json({ error: { code: "NOT_FOUND", message: "Application pack not found." } }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ packId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { packId } = await context.params;
  const current = await getApplicationPack(user.userId, packId);
  if (!current) return Response.json({ error: { code: "NOT_FOUND", message: "Application pack not found." } }, { status: 404 });
  const body = await request.json().catch(() => null) as { payload?: unknown } | null;
  if (!body || !body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) return Response.json({ error: { code: "INVALID_PACK", message: "An editable pack payload is required." } }, { status: 400 });
  const revision = await createApplicationPackRevision(user.userId, packId, body.payload);
  return revision ? Response.json({ pack: revision }, { status: 201 }) : Response.json({ error: { code: "NOT_FOUND", message: "Application pack not found." } }, { status: 404 });
}
