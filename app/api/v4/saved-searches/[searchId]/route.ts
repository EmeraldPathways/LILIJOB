import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { deleteSavedSearch } from "../../../../../lib/v4/saved-searches";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ searchId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { searchId } = await context.params;
  const deleted = await deleteSavedSearch(user.userId, searchId);
  if (!deleted) return Response.json({ error: { code: "NOT_FOUND", message: "Saved search not found." } }, { status: 404 });
  return Response.json({ deleted: true }, { headers: { "cache-control": "private, no-store" } });
}
