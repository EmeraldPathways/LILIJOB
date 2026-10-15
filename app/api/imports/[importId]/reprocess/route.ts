import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { reprocessStoredImport } from "../../../../../lib/import/import-service";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ importId: string }> }) {
  const user = userFromRequest(_request);
  if (!user) return unauthorizedResponse();
  const { importId } = await context.params;
  try {
    const summary = await reprocessStoredImport(importId, user.userId);
    return Response.json({ summary }, { status: 201 });
  } catch (error) {
    return Response.json({ error: { code: "IMPORT_REPROCESS_FAILED", message: error instanceof Error ? error.message : "Unable to reprocess the stored file." } }, { status: 500 });
  }
}
