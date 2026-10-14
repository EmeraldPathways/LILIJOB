import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { imports } from "../../../db/schema";
import { userFromRequest, unauthorizedResponse } from "../../../lib/auth/require-user";
import { importWorkbook } from "../../../lib/import/import-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const rows = await getDb().select().from(imports).where(eq(imports.ownerId, user.userId)).orderBy(desc(imports.createdAt));
  return Response.json({ imports: rows.map((row) => ({ ...row, errors: JSON.parse(row.errorsJson) })) });
}

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const form = await request.formData();
  const value = form.get("file");
  if (!(value instanceof File)) {
    return Response.json({ error: { code: "FILE_REQUIRED", message: "Upload a CSV or XLSX file." } }, { status: 400 });
  }
  const name = value.name.toLowerCase();
  if (!name.endsWith(".csv") && !name.endsWith(".xlsx")) {
    return Response.json({ error: { code: "UNSUPPORTED_FILE", message: "Only CSV and XLSX files are supported." } }, { status: 415 });
  }
  try {
    const summary = await importWorkbook(await value.arrayBuffer(), value.name, user.userId);
    return Response.json({ summary }, { status: 201 });
  } catch (error) {
    return Response.json({ error: { code: "IMPORT_FAILED", message: error instanceof Error ? error.message : "Unable to import file." } }, { status: 500 });
  }
}
