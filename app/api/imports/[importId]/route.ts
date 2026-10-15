import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { imports } from "../../../../db/schema";
import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ importId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { importId } = await context.params;
  try {
    const [row] = await getDb().select().from(imports).where(and(eq(imports.ownerId, user.userId), eq(imports.id, importId))).limit(1);
    if (!row) return Response.json({ error: { code: "NOT_FOUND", message: "Import not found." } }, { status: 404 });
    return Response.json({ import: { ...row, errors: parseErrors(row.errorsJson) } });
  } catch (error) {
    return Response.json({ error: { code: "IMPORT_UNAVAILABLE", message: error instanceof Error ? error.message : "Unable to load import." } }, { status: 500 });
  }
}

function parseErrors(value: string): Array<{ row?: number; message: string }> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is { row?: number; message: string } => Boolean(item && typeof item === "object" && "message" in item && typeof item.message === "string")) : [];
  } catch {
    return [{ message: "Import error details could not be decoded." }];
  }
}
