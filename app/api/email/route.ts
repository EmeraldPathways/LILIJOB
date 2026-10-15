import { and, asc, desc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { companies, contacts, emailDeliveries, gmailConnections } from "../../../db/schema";
import { userFromRequest, unauthorizedResponse } from "../../../lib/auth/require-user";
import { emailFromCompanyData, isGmailConfigured } from "../../../lib/email/core";
import { emailJson, privateNoStore } from "../../../lib/email/http";

export const dynamic = "force-dynamic";

function sectorFromMetadata(metadataJson: string): string | null {
  try {
    const metadata = JSON.parse(metadataJson) as { sector?: unknown; original?: Record<string, unknown> };
    if (typeof metadata.sector === "string" && metadata.sector.trim()) return metadata.sector.trim();
    const originalSector = metadata.original?.Sector;
    return typeof originalSector === "string" && originalSector.trim() ? originalSector.trim() : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return privateNoStore(unauthorizedResponse());

  try {
    const db = getDb();
    const [connection] = await db.select().from(gmailConnections)
      .where(eq(gmailConnections.ownerId, user.userId)).limit(1);
    const rows = await db.select({
      companyId: companies.id,
      companyName: companies.name,
      metadataJson: companies.metadataJson,
      contactEmail: contacts.email,
    }).from(companies).leftJoin(contacts, and(
      eq(contacts.ownerId, user.userId),
      eq(contacts.companyId, companies.id),
    )).where(eq(companies.ownerId, user.userId))
      .orderBy(asc(companies.name), asc(contacts.createdAt), asc(contacts.id));

    const grouped = new Map<string, {
      companyId: string;
      companyName: string;
      metadataJson: string;
      contactEmails: string[];
    }>();
    for (const row of rows) {
      let item = grouped.get(row.companyId);
      if (!item) {
        item = {
          companyId: row.companyId,
          companyName: row.companyName,
          metadataJson: row.metadataJson,
          contactEmails: [],
        };
        grouped.set(row.companyId, item);
      }
      if (row.contactEmail) item.contactEmails.push(row.contactEmail);
    }
    const recipients = [...grouped.values()].map((company) => ({
      companyId: company.companyId,
      companyName: company.companyName,
      sector: sectorFromMetadata(company.metadataJson),
      email: emailFromCompanyData(company.metadataJson, company.contactEmails),
    }));

    const historyRows = await db.select().from(emailDeliveries)
      .where(eq(emailDeliveries.ownerId, user.userId))
      .orderBy(desc(emailDeliveries.createdAt)).limit(100);
    const history = historyRows.map((row) => ({
      id: row.id,
      companyName: row.companyName,
      to: row.to,
      subject: row.subject,
      status: row.status === "processing" ? "unknown" : row.status,
      ...(row.error ? { error: row.error } : {}),
      createdAt: row.createdAt,
    }));

    return emailJson({
      configured: isGmailConfigured(env),
      connected: Boolean(connection),
      ...(connection ? { email: connection.googleEmail } : {}),
      recipients,
      history,
    });
  } catch {
    return emailJson({ error: { code: "EMAIL_LOAD_FAILED", message: "Unable to load email settings." } }, { status: 500 });
  }
}
