import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { collectPublicCompanyData } from "../../../../../lib/v4/collection";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = await request.json().catch(() => null) as { companyId?: unknown; sourceUrl?: unknown } | null;
  if (!body || typeof body.companyId !== "string" || !body.companyId.trim() || body.companyId.length > 128 || typeof body.sourceUrl !== "string" || !body.sourceUrl.trim() || body.sourceUrl.length > 2048) {
    return Response.json({ error: { code: "INVALID_PUBLIC_COLLECTION", message: "A saved company ID and official source URL are required." } }, { status: 400 });
  }
  try {
    const result = await collectPublicCompanyData(user.userId, body.companyId.trim(), body.sourceUrl.trim());
    if (result.status === "not-found") return Response.json({ error: { code: "NOT_FOUND", message: "Company not found." } }, { status: 404 });
    if (result.status === "unsupported") return Response.json({ error: { code: "UNSAVED_SOURCE", message: result.error } }, { status: 400 });
    return Response.json({ collection: result });
  } catch (error) {
    return Response.json({ error: { code: "PUBLIC_COLLECTION_FAILED", message: error instanceof Error ? error.message : "Public collection failed." } }, { status: 500 });
  }
}
