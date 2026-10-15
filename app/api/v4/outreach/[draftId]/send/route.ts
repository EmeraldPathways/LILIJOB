import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../../../../db";
import { gmailConnections, outreachDrafts } from "../../../../../../db/schema";
import { userFromRequest, unauthorizedResponse } from "../../../../../../lib/auth/require-user";
import { decryptToken, encryptToken, isGmailConfigured, validEmail } from "../../../../../../lib/email/core";
import { GmailSendError, refreshGoogleAccessToken, sendGmailMessage } from "../../../../../../lib/email/google";
import { canSendOutreach } from "../../../../../../lib/v4/outreach";
import { approveOutreachDraft, createOutreachEvent, getOutreachDraft, getOutreachEventByDedup, getOutreachRecipient, outreachDedupKey } from "../../../../../../lib/v4/outreach-repository";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { draftId } = await context.params;
  const draft = await getOutreachDraft(user.userId, draftId);
  if (!draft) return Response.json({ error: { code: "NOT_FOUND", message: "Outreach draft not found." } }, { status: 404 });
  const contactId = draft.contactId;
  if (!contactId) return Response.json({ error: { code: "CONTACT_REQUIRED", message: "A public contact is required before sending." } }, { status: 409 });
  const recipient = await getOutreachRecipient(user.userId, draft.companyId, contactId);
  const recipientEmail = recipient ? validEmail(recipient.contact.email) : null;
  if (!recipient || !canSendOutreach({ subject: draft.subject, body: draft.body, email: recipientEmail, doNotContact: Boolean(recipient.contact.doNotContact), approvalState: draft.approvalState as "draft" | "approved" | "sent" | "blocked" })) {
    return Response.json({ error: { code: "OUTREACH_NOT_APPROVED", message: "Review the draft, recipient and do-not-contact status before sending." } }, { status: 409 });
  }
  if (!isGmailConfigured(env)) return Response.json({ error: { code: "GMAIL_NOT_CONFIGURED", message: "Connect Gmail before sending an approved draft." } }, { status: 503 });

  const dedupKey = outreachDedupKey(user.userId, draft.id, contactId);
  const existingEvent = await getOutreachEventByDedup(user.userId, dedupKey);
  if (existingEvent) return Response.json({ event: existingEvent, deduplicated: true }, { status: existingEvent.sendState === "sent" ? 200 : 409 });
  const approvedDraft = draft.approvalState === "approved" ? draft : await approveOutreachDraft(user.userId, draft.id);
  if (!approvedDraft || approvedDraft.approvalState !== "approved") return Response.json({ error: { code: "OUTREACH_NOT_APPROVED", message: "Approve the draft before sending." } }, { status: 409 });

  let accessToken: string;
  const db = getDb();
  const [connection] = await db.select().from(gmailConnections).where(eq(gmailConnections.ownerId, user.userId)).limit(1);
  if (!connection) return Response.json({ error: { code: "GMAIL_NOT_CONNECTED", message: "Connect a Gmail account before sending." } }, { status: 409 });
  try {
    const expiresAt = connection.accessTokenExpiresAt ? Date.parse(connection.accessTokenExpiresAt) : 0;
    if (Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000) {
      accessToken = await decryptToken(connection.encryptedAccessToken, env.GMAIL_TOKEN_ENCRYPTION_KEY!);
    } else if (connection.encryptedRefreshToken) {
      const refreshToken = await decryptToken(connection.encryptedRefreshToken, env.GMAIL_TOKEN_ENCRYPTION_KEY!);
      const refreshed = await refreshGoogleAccessToken({ refreshToken, env });
      accessToken = refreshed.access_token;
      await db.update(gmailConnections).set({ encryptedAccessToken: await encryptToken(accessToken, env.GMAIL_TOKEN_ENCRYPTION_KEY!), accessTokenExpiresAt: new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString(), updatedAt: new Date().toISOString() }).where(eq(gmailConnections.ownerId, user.userId));
    } else {
      return Response.json({ error: { code: "GMAIL_RECONNECT_REQUIRED", message: "Reconnect Gmail before sending." } }, { status: 409 });
    }
    const providerMessageId = await sendGmailMessage({ accessToken, to: recipientEmail!, subject: draft.subject, body: draft.body });
    const result = await createOutreachEvent(user.userId, { draftId: draft.id, applicationId: draft.applicationId, providerMessageId, sendState: "sent", approvedBy: user.userId, approvedAt: approvedDraft.approvedAt, dedupKey });
    await db.update(outreachDrafts).set({ approvalState: "sent", updatedAt: new Date().toISOString() }).where(and(eq(outreachDrafts.ownerId, user.userId), eq(outreachDrafts.id, draft.id)));
    return Response.json({ event: result.event, deduplicated: false });
  } catch (error) {
    const outcome = error instanceof GmailSendError ? error.outcome : "unknown";
    const message = error instanceof GmailSendError ? error.message : "Gmail did not confirm delivery; it will not be retried automatically.";
    const result = await createOutreachEvent(user.userId, { draftId: draft.id, applicationId: draft.applicationId, sendState: outcome, error: message, approvedBy: user.userId, approvedAt: approvedDraft.approvedAt, dedupKey });
    return Response.json({ error: { code: "GMAIL_SEND_FAILED", message }, event: result.event }, { status: outcome === "failed" ? 502 : 409 });
  }
}
