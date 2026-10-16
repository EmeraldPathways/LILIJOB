import { env } from "cloudflare:workers";
import { runV4Migration } from "../../../../lib/v4/migration-runner";
import { runV5Migration } from "../../../../lib/v5/migration";
import { backfillV4ExistingData } from "../../../../lib/v4/backfill";

export const dynamic = "force-dynamic";

/** One-time, server-only migration endpoint. It is disabled without a token. */
export async function POST(request: Request) {
  if (!env.V4_MIGRATION_TOKEN) return new Response(null, { status: 404 });
  if (request.headers.get("authorization") !== `Bearer ${env.V4_MIGRATION_TOKEN}`) {
    return new Response(null, { status: 401 });
  }
  if (!env.DB) return Response.json({ error: "Database binding is unavailable." }, { status: 503 });

  try {
    const result = await runV4Migration(env.DB);
    const v5 = await runV5Migration(env.DB);
    const requestedBody = await request.clone().json().catch(() => null) as { ownerId?: unknown } | null;
    const ownerId = typeof requestedBody?.ownerId === "string" && requestedBody.ownerId.trim()
      ? requestedBody.ownerId.trim()
      : env.V4_MIGRATION_OWNER_ID;
    const backfill = ownerId ? await backfillV4ExistingData(ownerId) : undefined;
    return Response.json({ ...result, v5, ...(backfill ? { backfill } : {}) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Migration failed." }, { status: 500 });
  }
}
