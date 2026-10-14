import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { sources } from "../../db/schema";

export async function listSources(ownerId: string, companyId?: string) {
  const db = getDb();
  const where = companyId
    ? and(eq(sources.ownerId, ownerId), eq(sources.companyId, companyId))
    : eq(sources.ownerId, ownerId);
  return db.select().from(sources).where(where).orderBy(desc(sources.checkedAt));
}
