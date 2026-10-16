import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { applications, companies, gmailConnections, recruitmentContacts, outreachDrafts, outreachEvents } from "../../db/schema";
import { candidateDocuments, outreachAttachments } from "../../db/schema-v4";
import { makeOutreachDedupKey } from "./outreach";

function now(): string {
  return new Date().toISOString();
}

export type OutreachPayloadFingerprintInput = {
  revision: number;
  sender: string | null;
  to: string | null;
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  attachmentDocumentId?: string | null;
};

/** Stable, non-secret representation of the exact reviewed send payload. */
export function outreachPayloadFingerprint(input: OutreachPayloadFingerprintInput): string {
  return JSON.stringify({
    revision: input.revision,
    sender: input.sender?.trim().toLowerCase() ?? null,
    to: input.to?.trim().toLowerCase() ?? null,
    cc: [...(input.cc ?? [])].map((value) => value.trim().toLowerCase()).sort(),
    bcc: [...(input.bcc ?? [])].map((value) => value.trim().toLowerCase()).sort(),
    subject: input.subject,
    body: input.body,
    attachmentDocumentId: input.attachmentDocumentId ?? null,
  });
}

export async function listOutreachDrafts(ownerId: string) {
  return getDb().select().from(outreachDrafts).where(eq(outreachDrafts.ownerId, ownerId)).orderBy(desc(outreachDrafts.updatedAt));
}

export async function getOutreachDraft(ownerId: string, draftId: string) {
  const [draft] = await getDb().select().from(outreachDrafts).where(and(eq(outreachDrafts.ownerId, ownerId), eq(outreachDrafts.id, draftId))).limit(1);
  return draft ?? null;
}

export async function getOutreachRecipient(ownerId: string, companyId: string, contactId: string) {
  const [recipient] = await getDb().select({
    contact: recruitmentContacts,
    company: companies,
  }).from(recruitmentContacts).innerJoin(companies, and(eq(companies.ownerId, ownerId), eq(companies.id, recruitmentContacts.companyId))).where(and(
    eq(recruitmentContacts.ownerId, ownerId),
    eq(recruitmentContacts.companyId, companyId),
    eq(recruitmentContacts.id, contactId),
  )).limit(1);
  return recipient ?? null;
}

export async function createOutreachDraft(ownerId: string, input: {
  companyId: string;
  contactId: string;
  applicationId?: string;
  subject: string;
  body: string;
  generation?: unknown;
  attachmentDocumentId?: string;
}) {
  const recipient = await getOutreachRecipient(ownerId, input.companyId, input.contactId);
  if (!recipient) return null;
  if (input.attachmentDocumentId) {
    const [document] = await getDb().select({ id: candidateDocuments.id }).from(candidateDocuments).where(and(eq(candidateDocuments.ownerId, ownerId), eq(candidateDocuments.id, input.attachmentDocumentId))).limit(1);
    if (!document) return null;
  }
  if (input.applicationId && !await getDb().select({ id: applications.id }).from(applications).where(and(eq(applications.ownerId, ownerId), eq(applications.id, input.applicationId))).limit(1).then((rows) => rows[0])) return null;
  const timestamp = now();
  const id = `draft_${crypto.randomUUID()}`;
  await getDb().insert(outreachDrafts).values({
    id,
    ownerId,
    applicationId: input.applicationId ?? null,
    companyId: input.companyId,
    contactId: input.contactId,
    channel: "gmail",
    subject: input.subject.trim(),
    body: input.body,
    generationJson: JSON.stringify(input.generation ?? {}),
    attachmentDocumentId: input.attachmentDocumentId ?? null,
    revision: 1,
    approvalFingerprint: null,
    approvalState: "draft",
    approvedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return getOutreachDraft(ownerId, id);
}

export async function getOutreachAttachment(ownerId: string, draftId: string, documentId: string) {
  const [attachment] = await getDb().select().from(outreachAttachments).where(and(eq(outreachAttachments.ownerId, ownerId), eq(outreachAttachments.draftId, draftId), eq(outreachAttachments.documentId, documentId))).limit(1);
  return attachment ?? null;
}

export async function saveOutreachAttachment(ownerId: string, input: { draftId: string; documentId: string; objectKey: string; sha256: string; filename: string; mimeType: string; bytes: number; approvalFingerprint: string }) {
  const timestamp = now();
  await getDb().insert(outreachAttachments).values({ id: `attachment_${crypto.randomUUID()}`, ownerId, draftId: input.draftId, documentId: input.documentId, objectKey: input.objectKey, sha256: input.sha256, filename: input.filename, mimeType: input.mimeType, bytes: input.bytes, approvalFingerprint: input.approvalFingerprint, createdAt: timestamp, updatedAt: timestamp }).onConflictDoUpdate({ target: [outreachAttachments.ownerId, outreachAttachments.draftId, outreachAttachments.documentId], set: { objectKey: input.objectKey, sha256: input.sha256, filename: input.filename, mimeType: input.mimeType, bytes: input.bytes, approvalFingerprint: input.approvalFingerprint, updatedAt: timestamp } });
  return getOutreachAttachment(ownerId, input.draftId, input.documentId);
}

export async function approveOutreachDraft(ownerId: string, draftId: string) {
  const draft = await getOutreachDraft(ownerId, draftId);
  if (!draft) return null;
  if (draft.approvalState === "sent") return draft;
  const recipient = draft.contactId ? await getOutreachRecipient(ownerId, draft.companyId, draft.contactId) : null;
  const [connection] = await getDb().select({ googleEmail: gmailConnections.googleEmail }).from(gmailConnections).where(eq(gmailConnections.ownerId, ownerId)).limit(1);
  const approvalFingerprint = outreachPayloadFingerprint({
    revision: draft.revision,
    sender: connection?.googleEmail ?? null,
    to: recipient?.contact.email ?? null,
    subject: draft.subject,
    body: draft.body,
    attachmentDocumentId: draft.attachmentDocumentId,
  });
  const timestamp = now();
  await getDb().update(outreachDrafts).set({ approvalState: "approved", approvedAt: timestamp, approvalFingerprint, updatedAt: timestamp }).where(and(eq(outreachDrafts.ownerId, ownerId), eq(outreachDrafts.id, draftId)));
  return getOutreachDraft(ownerId, draftId);
}

export async function getOutreachEventByDedup(ownerId: string, dedupKey: string) {
  const [event] = await getDb().select().from(outreachEvents).where(and(eq(outreachEvents.ownerId, ownerId), eq(outreachEvents.dedupKey, dedupKey))).limit(1);
  return event ?? null;
}

export async function createOutreachEvent(ownerId: string, input: {
  draftId: string;
  applicationId?: string | null;
  providerMessageId?: string | null;
  threadId?: string | null;
  sendState: string;
  error?: string | null;
  responseCategory?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  dedupKey: string;
  payloadFingerprint?: string | null;
}) {
  const existing = await getOutreachEventByDedup(ownerId, input.dedupKey);
  if (existing) return { event: existing, created: false };
  const timestamp = now();
  const id = `outreach_event_${crypto.randomUUID()}`;
  await getDb().insert(outreachEvents).values({
    id,
    ownerId,
    draftId: input.draftId,
    applicationId: input.applicationId ?? null,
    providerMessageId: input.providerMessageId ?? null,
    threadId: input.threadId ?? null,
    sendState: input.sendState,
    error: input.error ?? null,
    dedupKey: input.dedupKey,
    payloadFingerprint: input.payloadFingerprint ?? null,
    responseCategory: input.responseCategory ?? null,
    approvedBy: input.approvedBy ?? null,
    approvedAt: input.approvedAt ?? null,
    sentAt: input.sendState === "sent" ? timestamp : null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const event = await getOutreachEventByDedup(ownerId, input.dedupKey);
  if (!event) throw new Error("Outreach event was not persisted.");
  return { event, created: true };
}

export async function claimOutreachSend(ownerId: string, input: {
  draftId: string;
  applicationId?: string | null;
  dedupKey: string;
  payloadFingerprint: string;
  approvedBy: string;
  approvedAt?: string | null;
}) {
  const timestamp = now();
  const id = `outreach_event_${crypto.randomUUID()}`;
  try {
    await getDb().insert(outreachEvents).values({
      id,
      ownerId,
      draftId: input.draftId,
      applicationId: input.applicationId ?? null,
      providerMessageId: null,
      threadId: null,
      sendState: "sending",
      error: null,
      dedupKey: input.dedupKey,
      payloadFingerprint: input.payloadFingerprint,
      responseCategory: null,
      approvedBy: input.approvedBy,
      approvedAt: input.approvedAt ?? null,
      sentAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const [event] = await getDb().select().from(outreachEvents).where(and(eq(outreachEvents.ownerId, ownerId), eq(outreachEvents.id, id))).limit(1);
    if (!event) throw new Error("Outreach send reservation was not persisted.");
    return { event, claimed: true };
  } catch (error) {
    const existing = await getOutreachEventByDedup(ownerId, input.dedupKey);
    if (existing) return { event: existing, claimed: false };
    throw error;
  }
}

export async function settleOutreachEvent(ownerId: string, eventId: string, input: {
  sendState: "sent" | "failed" | "unknown";
  providerMessageId?: string | null;
  threadId?: string | null;
  error?: string | null;
}) {
  const timestamp = now();
  const changed = await getDb().update(outreachEvents).set({
    sendState: input.sendState,
    providerMessageId: input.providerMessageId ?? null,
    threadId: input.threadId ?? null,
    error: input.error ?? null,
    sentAt: input.sendState === "sent" ? timestamp : null,
    updatedAt: timestamp,
  }).where(and(eq(outreachEvents.ownerId, ownerId), eq(outreachEvents.id, eventId))).returning({ id: outreachEvents.id });
  if (!changed.length) return null;
  const [event] = await getDb().select().from(outreachEvents).where(and(eq(outreachEvents.ownerId, ownerId), eq(outreachEvents.id, eventId))).limit(1);
  return event ?? null;
}

export function outreachDedupKey(ownerId: string, draftId: string, contactId: string | null): string {
  return makeOutreachDedupKey(ownerId, draftId, contactId);
}
