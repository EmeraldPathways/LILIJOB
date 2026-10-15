import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db";
import { applications, experienceEvidence } from "../../db/schema";
import { interviewPacks, interviews } from "../../db/schema-v4";
import { applyPracticeQaUpdates, buildInterviewPack, validateInterviewSchedule, type InterviewOutcome, type InterviewStory, type InterviewPack, type PracticeQaUpdate } from "./interviews";

export type InterviewFollowUpDraft = {
  text: string;
  status: "draft" | "approved";
  approvedAt: string | null;
  updatedAt: string | null;
};

const FOLLOW_UP_DRAFT_KIND = "interview-follow-up-draft-v1";

function now(): string {
  return new Date().toISOString();
}

function decodeFollowUpDraft(value: string | null): InterviewFollowUpDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.kind === FOLLOW_UP_DRAFT_KIND && typeof parsed.text === "string" && (parsed.status === "draft" || parsed.status === "approved")) {
      return {
        text: parsed.text,
        status: parsed.status,
        approvedAt: typeof parsed.approvedAt === "string" ? parsed.approvedAt : null,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      };
    }
  } catch {
    // Older records stored plain next-step text; keep it readable as a draft.
  }
  return { text: value, status: "draft", approvedAt: null, updatedAt: null };
}

function encodeFollowUpDraft(draft: InterviewFollowUpDraft | null): string | null {
  if (!draft) return null;
  return JSON.stringify({ kind: FOLLOW_UP_DRAFT_KIND, ...draft });
}

function presentInterview<T extends { nextSteps: string | null }>(interview: T) {
  const followUpDraft = decodeFollowUpDraft(interview.nextSteps);
  return { ...interview, nextSteps: followUpDraft?.text ?? interview.nextSteps, followUpDraft };
}

function assertOutcome(value: InterviewOutcome | null): void {
  if (value !== null && !["awaiting", "progressed", "offer", "rejected", "withdrawn"].includes(value)) throw new Error("Use an allowed interview outcome.");
}

export async function listInterviews(ownerId: string) {
  const rows = await getDb().select().from(interviews).where(eq(interviews.ownerId, ownerId)).orderBy(asc(interviews.scheduledAt));
  return rows.map(presentInterview);
}

export async function getInterview(ownerId: string, interviewId: string) {
  const [interview] = await getDb().select().from(interviews).where(and(eq(interviews.ownerId, ownerId), eq(interviews.id, interviewId))).limit(1);
  if (!interview) return null;
  const packs = await getDb().select().from(interviewPacks).where(and(eq(interviewPacks.ownerId, ownerId), eq(interviewPacks.interviewId, interviewId))).orderBy(desc(interviewPacks.version));
  return { interview: presentInterview(interview), packs };
}

export async function createInterview(ownerId: string, input: { applicationId: string; round: string; scheduledAt?: string; timezone?: string; format?: string; location?: string; interviewerInfo?: unknown }) {
  const scheduleError = validateInterviewSchedule(input.scheduledAt, input.timezone);
  if (scheduleError) throw new Error(scheduleError);
  if (!input.round.trim()) throw new Error("Interview round is required.");
  const [application] = await getDb().select({ id: applications.id }).from(applications).where(and(eq(applications.ownerId, ownerId), eq(applications.id, input.applicationId))).limit(1);
  if (!application) return null;
  const timestamp = now();
  const id = `interview_${crypto.randomUUID()}`;
  await getDb().insert(interviews).values({ id, ownerId, applicationId: input.applicationId, round: input.round.trim(), scheduledAt: input.scheduledAt ? new Date(input.scheduledAt).toISOString() : null, timezone: input.timezone?.trim() || "Europe/Dublin", format: input.format?.trim() || null, location: input.location?.trim() || null, interviewerInfoJson: JSON.stringify(input.interviewerInfo ?? {}), prepStatus: "not-started", createdAt: timestamp, updatedAt: timestamp });
  return getInterview(ownerId, id);
}

export async function createInterviewPackForInterview(ownerId: string, interviewId: string, input: { companyName: string; roleTitle: string; jobSourceUrl: string | null; checkedAt: string | null; companyFacts: string[]; requirements: string[]; approvedStories: InterviewStory[]; model?: string }) {
  const interview = await getInterview(ownerId, interviewId);
  if (!interview) return null;
  const storyIds = [...new Set(input.approvedStories.map((story) => story.id).filter((id) => id.trim()))];
  const evidenceRows = storyIds.length
    ? await getDb().select({ id: experienceEvidence.id, statement: experienceEvidence.statement, metric: experienceEvidence.metric })
      .from(experienceEvidence)
      .where(and(eq(experienceEvidence.ownerId, ownerId), eq(experienceEvidence.approved, true), inArray(experienceEvidence.id, storyIds)))
    : [];
  const evidenceById = new Map(evidenceRows.map((row) => [row.id, row]));
  const approvedStories = storyIds.flatMap((id) => {
    const row = evidenceById.get(id);
    return row ? [{ id: row.id, statement: row.statement, metric: row.metric }] : [];
  });
  const result = buildInterviewPack({ ...input, approvedStories });
  const nextVersion = (interview.packs[0]?.version ?? 0) + 1;
  const timestamp = now();
  const id = `interview_pack_${crypto.randomUUID()}`;
  await getDb().insert(interviewPacks).values({ id, ownerId, interviewId, version: nextVersion, sectionsJson: JSON.stringify(result), sourceMetaJson: JSON.stringify(result.sourceMeta), model: input.model ?? "deterministic-v4", generatedAt: timestamp, approvedAt: null, createdAt: timestamp, updatedAt: timestamp });
  await getDb().update(interviews).set({ prepStatus: "ready", updatedAt: timestamp }).where(and(eq(interviews.ownerId, ownerId), eq(interviews.id, interviewId)));
  const [pack] = await getDb().select().from(interviewPacks).where(and(eq(interviewPacks.ownerId, ownerId), eq(interviewPacks.id, id))).limit(1);
  return pack ?? null;
}

export async function updateInterviewOutcome(ownerId: string, interviewId: string, input: {
  outcome?: InterviewOutcome | null;
  notes?: string | null;
  followUpDraft?: { text: string } | null;
}) {
  const current = await getInterview(ownerId, interviewId);
  if (!current) return null;
  const timestamp = now();
  const update: Partial<typeof interviews.$inferInsert> = { updatedAt: timestamp };
  if (input.outcome !== undefined) {
    assertOutcome(input.outcome);
    update.outcome = input.outcome;
  }
  if (input.notes !== undefined) {
    if (input.notes !== null && (typeof input.notes !== "string" || input.notes.length > 10_000)) throw new Error("Interview notes must be no longer than 10,000 characters.");
    update.notes = input.notes;
  }
  if (input.followUpDraft !== undefined) {
    if (input.followUpDraft === null) update.nextSteps = null;
    else {
      const text = input.followUpDraft.text;
      if (typeof text !== "string" || !text.trim() || text.length > 10_000) throw new Error("Follow-up draft must contain 1 to 10,000 characters.");
      update.nextSteps = encodeFollowUpDraft({ text, status: "draft", approvedAt: null, updatedAt: timestamp });
    }
  }
  await getDb().update(interviews).set(update).where(and(eq(interviews.ownerId, ownerId), eq(interviews.id, interviewId)));
  return getInterview(ownerId, interviewId);
}

export async function approveInterviewFollowUp(ownerId: string, interviewId: string) {
  const current = await getInterview(ownerId, interviewId);
  if (!current) return null;
  const draft = current.interview.followUpDraft;
  if (!draft?.text.trim()) throw new Error("Save a follow-up draft before approving it.");
  if (draft.status === "approved") return current;
  const timestamp = now();
  await getDb().update(interviews).set({
    nextSteps: encodeFollowUpDraft({ ...draft, status: "approved", approvedAt: timestamp, updatedAt: timestamp }),
    updatedAt: timestamp,
  }).where(and(eq(interviews.ownerId, ownerId), eq(interviews.id, interviewId)));
  return getInterview(ownerId, interviewId);
}

export async function updateInterviewPractice(ownerId: string, interviewId: string, updates: PracticeQaUpdate[]) {
  const current = await getInterview(ownerId, interviewId);
  if (!current) return null;
  const latest = current.packs[0];
  if (!latest) return null;
  if (!updates.length) throw new Error("At least one practice response is required.");
  let parsed: unknown;
  try { parsed = JSON.parse(latest.sectionsJson); } catch { throw new Error("The current interview pack could not be read."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The current interview pack could not be read.");
  const sections = applyPracticeQaUpdates(parsed as InterviewPack, updates);
  const timestamp = now();
  const id = `interview_pack_${crypto.randomUUID()}`;
  await getDb().insert(interviewPacks).values({
    id,
    ownerId,
    interviewId,
    version: latest.version + 1,
    sectionsJson: JSON.stringify(sections),
    sourceMetaJson: latest.sourceMetaJson,
    model: latest.model,
    generatedAt: latest.generatedAt,
    approvedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await getDb().update(interviews).set({ prepStatus: "ready", updatedAt: timestamp }).where(and(eq(interviews.ownerId, ownerId), eq(interviews.id, interviewId)));
  const [pack] = await getDb().select().from(interviewPacks).where(and(eq(interviewPacks.ownerId, ownerId), eq(interviewPacks.id, id))).limit(1);
  return pack ?? null;
}
