import { and, asc, eq, inArray } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../../db";
import { companies, contacts, emailDeliveries, gmailConnections } from "../../../../db/schema";
import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { decryptToken, emailFromCompanyData, encryptToken, isGmailConfigured, validEmail } from "../../../../lib/email/core";
import { apiError, emailJson, hasSameOrigin, privateNoStore } from "../../../../lib/email/http";
import { GmailSendError, refreshGoogleAccessToken, sendGmailMessage } from "../../../../lib/email/google";

export const dynamic = "force-dynamic";

type PreparedMessage = {
  companyId: string;
  companyName: string;
  to: string | null;
};

type DeliveryResult = {
  companyId: string;
  companyName: string;
  to: string | null;
  status: string;
  error?: string;
};

function validatePayload(value: unknown): {
  companyIds: string[];
  subject: string;
  body: string;
  requestId: string;
} | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.companyIds) || body.companyIds.length < 1 || body.companyIds.length > 20) return null;
  if (body.companyIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 128)) return null;
  const companyIds = [...new Set(body.companyIds as string[])];
  if (!companyIds.length || companyIds.length > 20) return null;
  if (typeof body.subject !== "string" || !body.subject.trim() || body.subject.length > 200 || /[\r\n]/.test(body.subject)) return null;
  if (typeof body.body !== "string" || body.body.length > 20_000) return null;
  if (typeof body.requestId !== "string" || !body.requestId.trim() || body.requestId.length > 128 || /[\u0000-\u001f]/.test(body.requestId)) return null;
  return { companyIds, subject: body.subject.trim(), body: body.body, requestId: body.requestId.trim() };
}

function responseFor(results: DeliveryResult[]): Response {
  const sent = results.filter((item) => item.status === "sent").length;
  const failed = results.filter((item) => item.status === "failed").length;
  const unknown = results.filter((item) => item.status === "unknown").length;
  return emailJson({ sent, failed, unknown, results });
}

function storedStatus(status: string): string {
  return status === "processing" ? "unknown" : status;
}

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return privateNoStore(unauthorizedResponse());
  if (!hasSameOrigin(request)) return apiError("CROSS_ORIGIN", "This request must come from this site.", 403);
  if (!isGmailConfigured(env)) {
    return apiError("GMAIL_NOT_CONFIGURED", "Gmail is not configured. Ask the site administrator to finish setup.", 503);
  }

  let payload: ReturnType<typeof validatePayload>;
  try {
    payload = validatePayload(await request.json());
  } catch {
    payload = null;
  }
  if (!payload) return apiError("INVALID_EMAIL_REQUEST", "Provide 1–20 companies, a subject, a message, and a request ID.", 400);

  try {
    const db = getDb();
    const companyRows = await db.select({
      companyId: companies.id,
      companyName: companies.name,
      metadataJson: companies.metadataJson,
    }).from(companies).where(and(
      eq(companies.ownerId, user.userId),
      inArray(companies.id, payload.companyIds),
    ));
    if (companyRows.length !== payload.companyIds.length) {
      return apiError("COMPANY_NOT_FOUND", "One or more selected companies are unavailable.", 404);
    }
    const contactRows = await db.select({ companyId: contacts.companyId, email: contacts.email })
      .from(contacts).where(and(
        eq(contacts.ownerId, user.userId),
        inArray(contacts.companyId, payload.companyIds),
      )).orderBy(asc(contacts.createdAt), asc(contacts.id));
    const contactsByCompany = new Map<string, string[]>();
    for (const contact of contactRows) {
      if (!contact.email) continue;
      const emails = contactsByCompany.get(contact.companyId) ?? [];
      emails.push(contact.email);
      contactsByCompany.set(contact.companyId, emails);
    }

    const prepared: PreparedMessage[] = companyRows.map((company) => ({
      companyId: company.companyId,
      companyName: company.companyName,
      to: emailFromCompanyData(company.metadataJson, contactsByCompany.get(company.companyId) ?? []),
    }));
    const invalid = prepared.filter((item) => !validEmail(item.to));
    if (invalid.length) {
      const invalidIds = new Set(invalid.map((item) => item.companyId));
      return emailJson({
        sent: 0,
        failed: prepared.length,
        unknown: 0,
        results: prepared.map((item) => ({
          ...item,
          status: "failed",
          error: invalidIds.has(item.companyId)
            ? `No valid email address was found for ${item.companyName}.`
            : "No messages were sent because another selected company has no valid email address.",
        })),
      }, { status: 422 });
    }

    const [connection] = await db.select().from(gmailConnections)
      .where(eq(gmailConnections.ownerId, user.userId)).limit(1);
    if (!connection) return apiError("GMAIL_NOT_CONNECTED", "Connect a Gmail account before sending.", 409);

    const existingRows = await db.select().from(emailDeliveries).where(and(
      eq(emailDeliveries.ownerId, user.userId),
      eq(emailDeliveries.requestId, payload.requestId),
      inArray(emailDeliveries.companyId, payload.companyIds),
    ));
    const existingIds = new Set(existingRows.map((row) => row.companyId));
    const newRows: Array<{ id: string; company: PreparedMessage }> = [];
    const now = new Date().toISOString();
    for (const company of prepared) {
      if (existingIds.has(company.companyId)) continue;
      const id = `delivery_${crypto.randomUUID()}`;
      const inserted = await db.insert(emailDeliveries).values({
        id,
        ownerId: user.userId,
        requestId: payload.requestId,
        companyId: company.companyId,
        companyName: company.companyName,
        to: company.to!,
        subject: payload.subject,
        status: "processing",
        error: null,
        providerMessageId: null,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing().returning({ id: emailDeliveries.id });
      if (inserted.length) newRows.push({ id, company });
    }

    if (newRows.length) {
      let accessToken: string;
      try {
        const expiresAt = connection.accessTokenExpiresAt ? Date.parse(connection.accessTokenExpiresAt) : 0;
        if (Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000) {
          accessToken = await decryptToken(connection.encryptedAccessToken, env.GMAIL_TOKEN_ENCRYPTION_KEY!);
        } else if (connection.encryptedRefreshToken) {
          const refreshToken = await decryptToken(connection.encryptedRefreshToken, env.GMAIL_TOKEN_ENCRYPTION_KEY!);
          const refreshed = await refreshGoogleAccessToken({ refreshToken, env });
          accessToken = refreshed.access_token;
          const refreshTokenValue = refreshed.refresh_token
            ? await encryptToken(refreshed.refresh_token, env.GMAIL_TOKEN_ENCRYPTION_KEY!)
            : connection.encryptedRefreshToken;
          await db.update(gmailConnections).set({
            encryptedAccessToken: await encryptToken(accessToken, env.GMAIL_TOKEN_ENCRYPTION_KEY!),
            encryptedRefreshToken: refreshTokenValue,
            accessTokenExpiresAt: new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString(),
            updatedAt: new Date().toISOString(),
          }).where(eq(gmailConnections.ownerId, user.userId));
        } else {
          throw new Error("Missing refresh token.");
        }
      } catch {
        await Promise.all(newRows.map(({ id }) => db.update(emailDeliveries).set({
          status: "failed",
          error: "Gmail authorization needs attention. Reconnect Gmail and try again.",
          updatedAt: new Date().toISOString(),
        }).where(and(eq(emailDeliveries.ownerId, user.userId), eq(emailDeliveries.id, id)))));
        accessToken = "";
      }

      if (accessToken) {
        for (let index = 0; index < newRows.length; index += 2) {
          const group = newRows.slice(index, index + 2);
          await Promise.all(group.map(async ({ id, company }) => {
            try {
              const providerMessageId = await sendGmailMessage({
                accessToken,
                to: company.to!,
                subject: payload.subject,
                body: payload.body,
              });
              await db.update(emailDeliveries).set({
                status: "sent",
                providerMessageId,
                error: null,
                updatedAt: new Date().toISOString(),
              }).where(and(eq(emailDeliveries.ownerId, user.userId), eq(emailDeliveries.id, id)));
            } catch (error) {
              const outcome = error instanceof GmailSendError ? error.outcome : "unknown";
              const message = error instanceof GmailSendError
                ? error.message
                : "Gmail did not confirm delivery; it will not be retried automatically.";
              await db.update(emailDeliveries).set({
                status: outcome,
                error: message,
                updatedAt: new Date().toISOString(),
              }).where(and(eq(emailDeliveries.ownerId, user.userId), eq(emailDeliveries.id, id)));
            }
          }));
        }
      }
    }

    const rows = await db.select().from(emailDeliveries).where(and(
      eq(emailDeliveries.ownerId, user.userId),
      eq(emailDeliveries.requestId, payload.requestId),
      inArray(emailDeliveries.companyId, payload.companyIds),
    ));
    const byCompany = new Map(rows.map((row) => [row.companyId, row]));
    return responseFor(prepared.map((company) => {
      const row = byCompany.get(company.companyId);
      return {
        companyId: company.companyId,
        companyName: row?.companyName ?? company.companyName,
        to: row?.to ?? company.to,
        status: row ? storedStatus(row.status) : "unknown",
        ...(row?.error ? { error: row.error } : {}),
      };
    }));
  } catch {
    return emailJson({ error: { code: "EMAIL_SEND_FAILED", message: "Unable to process the email request." } }, { status: 500 });
  }
}
