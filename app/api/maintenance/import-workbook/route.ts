import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { companies, imports } from "../../../../db/schema";
import { normalizeCompanyIdentity } from "../../../../lib/domain/normalize";
import { importWorkbook } from "../../../../lib/import/import-service";
import { buildImportPlan, parseWorkbook } from "../../../../lib/import/parse-workbook";

export const dynamic = "force-dynamic";

// A short-lived, file-bound maintenance operation. Disabled unless all four
// server-only settings are configured; no visitor identity is impersonated.
export async function POST(request: Request) {
  if (!env.ADMIN_IMPORT_TOKEN || !env.ADMIN_IMPORT_OWNER_ID || !env.ADMIN_IMPORT_SHA256 || !env.ADMIN_IMPORT_EXPIRES_AT || Date.now() >= Date.parse(env.ADMIN_IMPORT_EXPIRES_AT) || !Number.isFinite(Date.parse(env.ADMIN_IMPORT_EXPIRES_AT))) return new Response(null, {status:404});
  if (request.headers.get("authorization") !== `Bearer ${env.ADMIN_IMPORT_TOKEN}`) return new Response(null,{status:401});
  if (Number(request.headers.get("content-length")) > 10_000_000) return new Response(null,{status:413});
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 10_000_000) return new Response(null,{status:413});
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(value=>value.toString(16).padStart(2,"0")).join("");
  if (hash !== env.ADMIN_IMPORT_SHA256) return new Response(null,{status:403});
  const fileName = "LILI JOB HUNT DATA.xlsx";
  const ownerId = env.ADMIN_IMPORT_OWNER_ID;
  const previous = await getDb().select().from(imports).where(eq(imports.ownerId,ownerId));
  if (previous.some(row=>row.status === "stored" && row.fileName === fileName)) return Response.json({error:"Workbook already imported."},{status:409});
  const plan = buildImportPlan(await parseWorkbook(bytes,fileName));
  const summary = await importWorkbook(bytes,fileName,ownerId);
  const stored = await getDb().select().from(companies).where(eq(companies.ownerId,ownerId));
  const byName = new Map(stored.map(row=>[row.normalizedName,row]));
  const counts: Record<string,number> = {};
  let verifiedSourceRows = 0;
  for (const row of plan.rows) {
    const found = byName.get(normalizeCompanyIdentity({companyName:row.companyName}).normalizedName);
    if (!found) continue;
    const metadata = JSON.parse(found.metadataJson ?? "{}");
    const collection = (row.metadata.collections as string[] | undefined)?.[0];
    if (!collection) continue;
    const source = metadata.sheetRows?.[collection];
    if (source && Object.entries(row.original).every(([key,value])=>source[key]===value)) verifiedSourceRows++;
  }
  for (const row of stored) {
    const metadata = JSON.parse(row.metadataJson ?? "{}");
    for (const label of metadata.collections ?? []) counts[label]=(counts[label]??0)+1;
  }
  return Response.json({summary,verification:{companyCount:stored.length,verifiedSourceRows,expectedSourceRows:plan.rows.length,collections:counts,unenriched:stored.filter(row=>row.enrichmentStatus==="not-enriched").length}},{status:201});
}
