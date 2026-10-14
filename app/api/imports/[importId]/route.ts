import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { imports } from "../../../../db/schema";
import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ importId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { importId } = await context.params;
  const [row] = await getDb().select().from(imports).where(and(eq(imports.ownerId, user.userId), eq(imports.id, importId))).limit(1);
  if (!row) return Response.json({ error: { code: "NOT_FOUND", message: "Import not found." } }, { status: 404 });
  return Response.json({ import: { ...row, errors: JSON.parse(row.errorsJson) } });
}
