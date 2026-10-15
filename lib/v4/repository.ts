import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import {
  applicationEvents,
  applications,
  candidateDocuments,
  candidateProfiles,
  experienceEvidence,
  applicationPacks,
} from "../../db/schema";
import { canMoveApplication, isApplicationStage } from "./crm";

function now(): string {
  return new Date().toISOString();
}

function json(value: unknown, fallback: unknown): string {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
}

export type CandidateProfileInput = {
  name: string;
  targetFamilies?: unknown;
  constraints?: unknown;
  workAuthorization?: unknown;
  availability?: unknown;
  weightConfig?: unknown;
};

export type CandidateProfileUpdate = Partial<Omit<CandidateProfileInput, "name">> & {
  name?: string;
  isActive?: boolean;
};

export async function getCandidateProfile(ownerId: string, profileId: string) {
  const [profile] = await getDb()
    .select()
    .from(candidateProfiles)
    .where(and(eq(candidateProfiles.ownerId, ownerId), eq(candidateProfiles.id, profileId)))
    .limit(1);
  return profile ?? null;
}

export async function listCandidateProfiles(ownerId: string) {
  return getDb()
    .select()
    .from(candidateProfiles)
    .where(eq(candidateProfiles.ownerId, ownerId))
    .orderBy(asc(candidateProfiles.name));
}

export async function getOrCreateCandidateProfile(ownerId: string, input: CandidateProfileInput) {
  const name = input.name.trim();
  if (!name) throw new Error("Candidate profile name is required.");

  const db = getDb();
  const [existing] = await db
    .select()
    .from(candidateProfiles)
    .where(and(eq(candidateProfiles.ownerId, ownerId), eq(candidateProfiles.name, name)))
    .limit(1);
  if (existing) return existing;

  const timestamp = now();
  const id = `profile_${crypto.randomUUID()}`;
  try {
    await db.insert(candidateProfiles).values({
      id,
      ownerId,
      name,
      targetFamiliesJson: json(input.targetFamilies, []),
      constraintsJson: json(input.constraints, {}),
      workAuthorizationJson: json(input.workAuthorization, {}),
      availabilityJson: json(input.availability, {}),
      weightConfigJson: json(input.weightConfig, {}),
      isActive: true,
      approvedVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  } catch (error) {
    const [concurrent] = await db
      .select()
      .from(candidateProfiles)
      .where(and(eq(candidateProfiles.ownerId, ownerId), eq(candidateProfiles.name, name)))
      .limit(1);
    if (concurrent) return concurrent;
    throw error;
  }

  const created = await getCandidateProfile(ownerId, id);
  if (!created) throw new Error("Candidate profile was not persisted.");
  return created;
}

export async function updateCandidateProfile(ownerId: string, profileId: string, input: CandidateProfileUpdate) {
  const existing = await getCandidateProfile(ownerId, profileId);
  if (!existing) return null;
  const timestamp = now();
  const values: Partial<typeof candidateProfiles.$inferInsert> = {
    updatedAt: timestamp,
    approvedVersion: existing.approvedVersion + 1,
  };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error("Candidate profile name is required.");
    values.name = name;
  }
  if (input.targetFamilies !== undefined) values.targetFamiliesJson = json(input.targetFamilies, []);
  if (input.constraints !== undefined) values.constraintsJson = json(input.constraints, {});
  if (input.workAuthorization !== undefined) values.workAuthorizationJson = json(input.workAuthorization, {});
  if (input.availability !== undefined) values.availabilityJson = json(input.availability, {});
  if (input.weightConfig !== undefined) values.weightConfigJson = json(input.weightConfig, {});
  if (input.isActive !== undefined) values.isActive = input.isActive;

  await getDb()
    .update(candidateProfiles)
    .set(values)
    .where(and(eq(candidateProfiles.ownerId, ownerId), eq(candidateProfiles.id, profileId)));
  return getCandidateProfile(ownerId, profileId);
}

export type ExperienceEvidenceInput = {
  employer?: string;
  project?: string;
  title: string;
  statement: string;
  metric?: string;
  sourceDocumentId?: string;
  sourceSpan?: string;
  roleRelevance?: string;
  approved?: boolean;
};

export async function listExperienceEvidence(ownerId: string, profileId: string) {
  return getDb()
    .select()
    .from(experienceEvidence)
    .where(and(eq(experienceEvidence.ownerId, ownerId), eq(experienceEvidence.profileId, profileId)))
    .orderBy(desc(experienceEvidence.updatedAt));
}

export async function createExperienceEvidence(ownerId: string, profileId: string, input: ExperienceEvidenceInput) {
  if (!await getCandidateProfile(ownerId, profileId)) return null;
  if (!input.title.trim() || !input.statement.trim()) throw new Error("Evidence title and statement are required.");

  const timestamp = now();
  const id = `evidence_${crypto.randomUUID()}`;
  await getDb().insert(experienceEvidence).values({
    id,
    ownerId,
    profileId,
    employer: input.employer?.trim() || null,
    project: input.project?.trim() || null,
    title: input.title.trim(),
    statement: input.statement.trim(),
    metric: input.metric?.trim() || null,
    sourceDocumentId: input.sourceDocumentId?.trim() || null,
    sourceSpan: input.sourceSpan?.trim() || null,
    roleRelevance: input.roleRelevance?.trim() || null,
    approved: input.approved ?? false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const [created] = await getDb().select().from(experienceEvidence).where(and(eq(experienceEvidence.ownerId, ownerId), eq(experienceEvidence.id, id))).limit(1);
  return created ?? null;
}

export type CandidateDocumentInput = {
  profileId: string;
  type: string;
  originalFilename: string;
  objectKey: string;
  parsedText?: string;
  derived?: unknown;
  consentStatus?: string;
};

export async function listCandidateDocuments(ownerId: string, profileId: string) {
  return getDb()
    .select()
    .from(candidateDocuments)
    .where(and(eq(candidateDocuments.ownerId, ownerId), eq(candidateDocuments.profileId, profileId)))
    .orderBy(desc(candidateDocuments.createdAt));
}

export async function createCandidateDocument(ownerId: string, input: CandidateDocumentInput) {
  if (!await getCandidateProfile(ownerId, input.profileId)) return null;
  const filename = input.originalFilename.trim();
  const objectKey = input.objectKey.trim();
  if (!filename || !objectKey || !input.type.trim()) throw new Error("Document type, filename and private object key are required.");
  const timestamp = now();
  const id = `document_${crypto.randomUUID()}`;
  await getDb().insert(candidateDocuments).values({
    id,
    ownerId,
    profileId: input.profileId,
    type: input.type.trim(),
    originalFilename: filename,
    objectKey,
    parsedText: input.parsedText?.slice(0, 200_000) ?? null,
    derivedJson: json(input.derived, {}),
    consentStatus: input.consentStatus?.trim() || "pending",
    approvedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const [created] = await getDb().select().from(candidateDocuments).where(and(eq(candidateDocuments.ownerId, ownerId), eq(candidateDocuments.id, id))).limit(1);
  return created ?? null;
}

export type ApplicationInput = {
  companyId: string;
  title: string;
  dedupKey: string;
  jobId?: string;
  manualUrl?: string;
  stage?: string;
  cvDocumentId?: string;
  channel?: string;
  appliedAt?: string;
  followupDueAt?: string;
  nextAction?: string;
  notes?: string;
};

export async function listApplications(ownerId: string) {
  return getDb()
    .select()
    .from(applications)
    .where(eq(applications.ownerId, ownerId))
    .orderBy(desc(applications.updatedAt));
}

export async function getApplication(ownerId: string, applicationId: string) {
  const [application] = await getDb()
    .select()
    .from(applications)
    .where(and(eq(applications.ownerId, ownerId), eq(applications.id, applicationId)))
    .limit(1);
  return application ?? null;
}

export async function createApplication(ownerId: string, input: ApplicationInput) {
  const dedupKey = input.dedupKey.trim();
  const title = input.title.trim();
  if (!input.companyId.trim() || !title || !dedupKey) throw new Error("Company, title and deduplication key are required.");
  if (input.stage !== undefined && !isApplicationStage(input.stage)) throw new Error("Application stage is not recognized.");

  const db = getDb();
  const [existing] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.ownerId, ownerId), eq(applications.dedupKey, dedupKey)))
    .limit(1);
  if (existing) return { record: existing, created: false };

  const timestamp = now();
  const id = `application_${crypto.randomUUID()}`;
  try {
    await db.insert(applications).values({
      id,
      ownerId,
      companyId: input.companyId.trim(),
      title,
      dedupKey,
      jobId: input.jobId?.trim() || null,
      manualUrl: input.manualUrl?.trim() || null,
      stage: input.stage?.trim() || "Target",
      cvDocumentId: input.cvDocumentId?.trim() || null,
      channel: input.channel?.trim() || null,
      appliedAt: input.appliedAt ?? null,
      lastEventAt: timestamp,
      followupDueAt: input.followupDueAt ?? null,
      nextAction: input.nextAction?.trim() || null,
      notes: input.notes?.trim() || null,
      rejectionReason: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  } catch (error) {
    const [concurrent] = await db
      .select()
      .from(applications)
      .where(and(eq(applications.ownerId, ownerId), eq(applications.dedupKey, dedupKey)))
      .limit(1);
    if (concurrent) return { record: concurrent, created: false };
    throw error;
  }

  const record = await getApplication(ownerId, id);
  if (!record) throw new Error("Application was not persisted.");
  return { record, created: true };
}

export type ApplicationEventInput = {
  type: string;
  stageFrom?: string;
  stageTo?: string;
  note?: string;
  actor?: string;
  eventAt?: string;
  metadata?: unknown;
};

export async function createApplicationEvent(ownerId: string, applicationId: string, input: ApplicationEventInput) {
  if (!await getApplication(ownerId, applicationId)) return null;
  if (!input.type.trim()) throw new Error("Application event type is required.");
  const timestamp = now();
  const id = `application_event_${crypto.randomUUID()}`;
  await getDb().insert(applicationEvents).values({
    id,
    ownerId,
    applicationId,
    type: input.type.trim(),
    stageFrom: input.stageFrom?.trim() || null,
    stageTo: input.stageTo?.trim() || null,
    note: input.note?.trim() || null,
    actor: input.actor?.trim() || "user",
    eventAt: input.eventAt ?? timestamp,
    metadataJson: json(input.metadata, {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const [created] = await getDb().select().from(applicationEvents).where(and(eq(applicationEvents.ownerId, ownerId), eq(applicationEvents.id, id))).limit(1);
  return created ?? null;
}

export async function listApplicationEvents(ownerId: string, applicationId: string) {
  return getDb()
    .select()
    .from(applicationEvents)
    .where(and(eq(applicationEvents.ownerId, ownerId), eq(applicationEvents.applicationId, applicationId)))
    .orderBy(desc(applicationEvents.eventAt));
}

export class ApplicationTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplicationTransitionError";
  }
}

export async function updateApplicationStage(ownerId: string, applicationId: string, stage: string, note?: string) {
  const existing = await getApplication(ownerId, applicationId);
  if (!existing) return null;
  if (!canMoveApplication(existing.stage, stage)) throw new ApplicationTransitionError(`Cannot move an application from ${existing.stage} to ${stage}.`);
  if (existing.stage === stage && !note?.trim()) return existing;
  const timestamp = now();
  const changed = await getDb().update(applications).set({ stage, lastEventAt: timestamp, updatedAt: timestamp, ...(stage === "Applied" ? { appliedAt: existing.appliedAt ?? timestamp } : {}) }).where(and(
    eq(applications.ownerId, ownerId),
    eq(applications.id, applicationId),
    eq(applications.stage, existing.stage),
  )).returning({ id: applications.id });
  if (!changed.length) throw new ApplicationTransitionError("The application changed while this update was being saved. Reload and try again.");
  await createApplicationEvent(ownerId, applicationId, { type: "stage-change", stageFrom: existing.stage, stageTo: stage, note, eventAt: timestamp });
  return getApplication(ownerId, applicationId);
}

export async function listApplicationWithEvents(ownerId: string, applicationId: string) {
  const application = await getApplication(ownerId, applicationId);
  if (!application) return null;
  return { application, events: await listApplicationEvents(ownerId, applicationId) };
}

export async function createApplicationPack(ownerId: string, input: { applicationId: string; profileId?: string | null; sourceUrl: string; payload: unknown }) {
  const application = await getApplication(ownerId, input.applicationId);
  if (!application) return null;
  const [last] = await getDb().select({ version: applicationPacks.version }).from(applicationPacks).where(and(eq(applicationPacks.ownerId, ownerId), eq(applicationPacks.applicationId, input.applicationId))).orderBy(desc(applicationPacks.version)).limit(1);
  const timestamp = now();
  const id = `application_pack_${crypto.randomUUID()}`;
  const version = (last?.version ?? 0) + 1;
  await getDb().insert(applicationPacks).values({ id, ownerId, applicationId: input.applicationId, profileId: input.profileId ?? null, version, sourceUrl: input.sourceUrl, payloadJson: json(input.payload, {}), approvalState: "draft", approvedAt: null, createdAt: timestamp, updatedAt: timestamp });
  const [pack] = await getDb().select().from(applicationPacks).where(and(eq(applicationPacks.ownerId, ownerId), eq(applicationPacks.id, id))).limit(1);
  return pack ?? null;
}

export async function listApplicationPacks(ownerId: string, applicationId: string) {
  return getDb().select().from(applicationPacks).where(and(eq(applicationPacks.ownerId, ownerId), eq(applicationPacks.applicationId, applicationId))).orderBy(desc(applicationPacks.version));
}

export async function getApplicationPack(ownerId: string, packId: string) {
  const [pack] = await getDb().select().from(applicationPacks).where(and(eq(applicationPacks.ownerId, ownerId), eq(applicationPacks.id, packId))).limit(1);
  return pack ?? null;
}

export async function createApplicationPackRevision(ownerId: string, packId: string, payload: unknown) {
  const current = await getApplicationPack(ownerId, packId);
  if (!current) return null;
  return createApplicationPack(ownerId, { applicationId: current.applicationId, profileId: current.profileId, sourceUrl: current.sourceUrl, payload });
}
