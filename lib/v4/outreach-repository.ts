import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { applications, companies, recruitmentContacts, outreachDrafts, outreachEvents } from "../../db/schema";
import { makeOutreachDedupKey } from "./outreach";

function now(): string {
  return new Date().toISOString();
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
    approvalState: "draft",
    approvedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return getOutreachDraft(ownerId, id);
}

export async function approveOutreachDraft(ownerId: string, draftId: string) {
  const draft = await getOutreachDraft(ownerId, draftId);
  if (!draft) return null;
  if (draft.approvalState === "sent") return draft;
  const timestamp = now();
  await getDb().update(outreachDrafts).set({ approvalState: "approved", approvedAt: timestamp, updatedAt: timestamp }).where(and(eq(outreachDrafts.ownerId, ownerId), eq(outreachDrafts.id, draftId)));
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

export function outreachDedupKey(ownerId: string, draftId: string, contactId: string | null): string {
  return makeOutreachDedupKey(ownerId, draftId, contactId);
}
