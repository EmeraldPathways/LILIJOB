import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../../../../db";
import { gmailConnections, outreachDrafts } from "../../../../../../db/schema";
import { candidateDocuments } from "../../../../../../db/schema-v4";
import { userFromRequest, unauthorizedResponse } from "../../../../../../lib/auth/require-user";
import { decryptToken, encryptToken, isGmailConfigured, validEmail } from "../../../../../../lib/email/core";
import { GmailSendError, refreshGoogleAccessToken, sendGmailMessage } from "../../../../../../lib/email/google";
import { canSendOutreach } from "../../../../../../lib/v4/outreach";
import { approveOutreachDraft, claimOutreachSend, getOutreachAttachment, getOutreachDraft, getOutreachRecipient, outreachDedupKey, outreachPayloadFingerprint, saveOutreachAttachment, settleOutreachEvent } from "../../../../../../lib/v4/outreach-repository";

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

  const approvedDraft = draft.approvalState === "approved" ? draft : await approveOutreachDraft(user.userId, draft.id);
  if (!approvedDraft || approvedDraft.approvalState !== "approved") return Response.json({ error: { code: "OUTREACH_NOT_APPROVED", message: "Approve the draft before sending." } }, { status: 409 });

  let accessToken: string;
  const db = getDb();
  const [connection] = await db.select().from(gmailConnections).where(eq(gmailConnections.ownerId, user.userId)).limit(1);
  if (!connection) return Response.json({ error: { code: "GMAIL_NOT_CONNECTED", message: "Connect a Gmail account before sending." } }, { status: 409 });
  const payloadFingerprint = outreachPayloadFingerprint({
    revision: approvedDraft.revision,
    sender: connection.googleEmail,
    to: recipientEmail,
    subject: approvedDraft.subject,
    body: approvedDraft.body,
    attachmentDocumentId: approvedDraft.attachmentDocumentId,
  });
  if (!approvedDraft.approvalFingerprint || approvedDraft.approvalFingerprint !== payloadFingerprint) {
    return Response.json({ error: { code: "OUTREACH_APPROVAL_STALE", message: "The reviewed payload changed or the sender account changed. Review and approve this draft again." } }, { status: 409 });
  }
  let attachments: Array<{ filename: string; mimeType: string; bytes: Uint8Array }> = [];
  if (approvedDraft.attachmentDocumentId) {
    if (!env.BUCKET) return Response.json({ error: { code: "ATTACHMENT_STORAGE_UNAVAILABLE", message: "Private attachment storage is not configured." } }, { status: 503 });
    const [document] = await db.select().from(candidateDocuments).where(and(eq(candidateDocuments.ownerId, user.userId), eq(candidateDocuments.id, approvedDraft.attachmentDocumentId))).limit(1);
    if (!document || !document.objectKey.startsWith(`private/${user.userId}/`)) return Response.json({ error: { code: "ATTACHMENT_NOT_FOUND", message: "The approved attachment is unavailable." } }, { status: 409 });
    const object = await env.BUCKET.get(document.objectKey);
    if (!object) return Response.json({ error: { code: "ATTACHMENT_NOT_FOUND", message: "The approved attachment is unavailable." } }, { status: 409 });
    if (object.size > 10 * 1024 * 1024) return Response.json({ error: { code: "ATTACHMENT_TOO_LARGE", message: "The approved attachment is too large for Gmail." } }, { status: 413 });
    const bytes = new Uint8Array(await object.arrayBuffer());
    const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((value) => value.toString(16).padStart(2, "0")).join("");
    const existingAttachment = await getOutreachAttachment(user.userId, draft.id, approvedDraft.attachmentDocumentId);
    if (existingAttachment && (existingAttachment.sha256 !== sha256 || existingAttachment.approvalFingerprint !== payloadFingerprint)) return Response.json({ error: { code: "ATTACHMENT_APPROVAL_STALE", message: "The attachment changed after approval. Review and approve the draft again." } }, { status: 409 });
    await saveOutreachAttachment(user.userId, { draftId: draft.id, documentId: approvedDraft.attachmentDocumentId, objectKey: document.objectKey, sha256, filename: document.originalFilename, mimeType: typeof object.httpMetadata?.contentType === "string" ? object.httpMetadata.contentType : "application/octet-stream", bytes: bytes.byteLength, approvalFingerprint: payloadFingerprint });
    attachments = [{ filename: document.originalFilename, mimeType: typeof object.httpMetadata?.contentType === "string" ? object.httpMetadata.contentType : "application/octet-stream", bytes }];
  }
  const dedupKey = outreachDedupKey(user.userId, draft.id, contactId);
  const reservation = await claimOutreachSend(user.userId, {
    draftId: draft.id,
    applicationId: draft.applicationId,
    dedupKey,
    payloadFingerprint,
    approvedBy: user.userId,
    approvedAt: approvedDraft.approvedAt,
  });
  if (!reservation.claimed) return Response.json({ event: reservation.event, deduplicated: true }, { status: reservation.event.sendState === "sent" ? 200 : 409 });
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
    const providerMessageId = await sendGmailMessage({ accessToken, to: recipientEmail!, subject: draft.subject, body: draft.body, attachments });
    const event = await settleOutreachEvent(user.userId, reservation.event.id, { sendState: "sent", providerMessageId });
    await db.update(outreachDrafts).set({ approvalState: "sent", updatedAt: new Date().toISOString() }).where(and(eq(outreachDrafts.ownerId, user.userId), eq(outreachDrafts.id, draft.id)));
    return Response.json({ event, deduplicated: false });
  } catch (error) {
    const outcome = error instanceof GmailSendError ? error.outcome : "unknown";
    const message = error instanceof GmailSendError ? error.message : "Gmail did not confirm delivery; it will not be retried automatically.";
    const event = await settleOutreachEvent(user.userId, reservation.event.id, { sendState: outcome, error: message });
    return Response.json({ error: { code: "GMAIL_SEND_FAILED", message }, event }, { status: outcome === "failed" ? 502 : 409 });
  }
}
