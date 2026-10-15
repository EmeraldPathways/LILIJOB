import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "../../db";
import { applicationEvents, applications, companies, jobs } from "../../db/schema";
import { agentRuns, agentSteps, companySignals, dailyActionItems, interviews, jobDiscoveryRuns, jobMatches, recruitmentContacts } from "../../db/schema-v4";
import { createAgentStep, type AgentStep } from "./agent";
import { isActionItemStatus } from "./crm";

function dateNow(): string {
  return new Date().toISOString();
}

export async function getDashboardSummary(ownerId: string) {
  const db = getDb();
  const now = dateNow();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [highFit, newJobs, publicContacts, followups, upcomingInterviews, responses, signals, errors, stageCounts] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(jobMatches).innerJoin(jobs, and(eq(jobs.ownerId, jobMatches.ownerId), eq(jobs.id, jobMatches.jobId))).where(and(eq(jobMatches.ownerId, ownerId), gte(jobMatches.score, 70), eq(jobMatches.dismissed, false), eq(jobs.status, "open"), eq(jobs.confidence, "high"))),
    db.select({ count: sql<number>`count(*)` }).from(jobs).where(and(eq(jobs.ownerId, ownerId), gte(jobs.createdAt, weekAgo), eq(jobs.status, "open"), eq(jobs.confidence, "high"))),
    db.select({ count: sql<number>`count(*)` }).from(recruitmentContacts).where(and(eq(recruitmentContacts.ownerId, ownerId), inArray(recruitmentContacts.contactType, ["recruitment-specific", "public-named-recruiter", "public-relevant-hiring-manager"]), eq(recruitmentContacts.doNotContact, false))),
    db.select({ count: sql<number>`count(*)` }).from(applications).where(and(eq(applications.ownerId, ownerId), lte(applications.followupDueAt, now), inArray(applications.stage, ["Applied", "Follow-up", "Contacted"]))),
    db.select({ count: sql<number>`count(*)` }).from(interviews).where(and(eq(interviews.ownerId, ownerId), gte(interviews.scheduledAt, now))),
    db.select({ count: sql<number>`count(*)` }).from(applicationEvents).where(and(eq(applicationEvents.ownerId, ownerId), inArray(applicationEvents.type, ["reply-observed", "response"]))),
    db.select({ count: sql<number>`count(*)` }).from(companySignals).where(and(eq(companySignals.ownerId, ownerId), gte(companySignals.discoveredAt, weekAgo))),
    db.select({ count: sql<number>`count(*)` }).from(jobDiscoveryRuns).where(and(eq(jobDiscoveryRuns.ownerId, ownerId), inArray(jobDiscoveryRuns.status, ["failed", "partial"]))),
    db.select({ stage: applications.stage, count: sql<number>`count(*)` }).from(applications).where(eq(applications.ownerId, ownerId)).groupBy(applications.stage),
  ]);
  return {
    generatedAt: now,
    cards: { highFitLiveJobs: Number(highFit[0]?.count ?? 0), newlyVerifiedJobs: Number(newJobs[0]?.count ?? 0), publicRecruitmentContacts: Number(publicContacts[0]?.count ?? 0), followupsDue: Number(followups[0]?.count ?? 0), scheduledInterviews: Number(upcomingInterviews[0]?.count ?? 0), applicationResponses: Number(responses[0]?.count ?? 0), recentHiringSignals: Number(signals[0]?.count ?? 0) },
    dataQuality: { failedOrPartialJobRuns: Number(errors[0]?.count ?? 0) },
    funnel: Object.fromEntries(stageCounts.map((row) => [row.stage, Number(row.count)])),
  };
}

export async function listActionItems(ownerId: string) {
  return getDb().select().from(dailyActionItems).where(eq(dailyActionItems.ownerId, ownerId)).orderBy(asc(dailyActionItems.status), asc(dailyActionItems.priority), asc(dailyActionItems.dueAt));
}

export async function upsertActionItem(ownerId: string, input: { type: string; reason: string; dedupKey: string; priority?: number; companyId?: string; jobId?: string; applicationId?: string; interviewId?: string; dueAt?: string }) {
  if (!ownerId.trim() || !input.type.trim() || !input.reason.trim() || !input.dedupKey.trim()) throw new Error("Owner, type, reason and deduplication key are required.");
  const db = getDb();
  if (input.companyId && !(await db.select({ id: companies.id }).from(companies).where(and(eq(companies.ownerId, ownerId), eq(companies.id, input.companyId))).limit(1)).length) throw new Error("Company not found for this owner.");
  if (input.jobId && !(await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.ownerId, ownerId), eq(jobs.id, input.jobId))).limit(1)).length) throw new Error("Job not found for this owner.");
  if (input.applicationId && !(await db.select({ id: applications.id }).from(applications).where(and(eq(applications.ownerId, ownerId), eq(applications.id, input.applicationId))).limit(1)).length) throw new Error("Application not found for this owner.");
  if (input.interviewId && !(await db.select({ id: interviews.id }).from(interviews).where(and(eq(interviews.ownerId, ownerId), eq(interviews.id, input.interviewId))).limit(1)).length) throw new Error("Interview not found for this owner.");
  const [existing] = await db.select().from(dailyActionItems).where(and(eq(dailyActionItems.ownerId, ownerId), eq(dailyActionItems.dedupKey, input.dedupKey))).limit(1);
  const timestamp = dateNow();
  if (existing) {
    await db.update(dailyActionItems).set({ reason: input.reason, priority: input.priority ?? existing.priority, dueAt: input.dueAt ?? existing.dueAt, updatedAt: timestamp }).where(and(eq(dailyActionItems.ownerId, ownerId), eq(dailyActionItems.id, existing.id)));
    const [updated] = await db.select().from(dailyActionItems).where(eq(dailyActionItems.id, existing.id)).limit(1);
    return updated ?? existing;
  }
  const id = `action_${crypto.randomUUID()}`;
  try {
    await db.insert(dailyActionItems).values({ id, ownerId, type: input.type, priority: input.priority ?? 50, companyId: input.companyId ?? null, jobId: input.jobId ?? null, applicationId: input.applicationId ?? null, interviewId: input.interviewId ?? null, reason: input.reason, dueAt: input.dueAt ?? null, status: "open", dedupKey: input.dedupKey, createdAt: timestamp, updatedAt: timestamp });
  } catch (error) {
    const [raced] = await db.select().from(dailyActionItems).where(and(eq(dailyActionItems.ownerId, ownerId), eq(dailyActionItems.dedupKey, input.dedupKey))).limit(1);
    if (raced) return raced;
    throw error;
  }
  const [created] = await db.select().from(dailyActionItems).where(eq(dailyActionItems.id, id)).limit(1);
  return created ?? null;
}

export async function updateActionItem(ownerId: string, actionId: string, status: string) {
  if (!isActionItemStatus(status)) throw new Error("Use open, completed, snoozed or dismissed.");
  const changed = await getDb().update(dailyActionItems).set({ status, updatedAt: dateNow() }).where(and(eq(dailyActionItems.ownerId, ownerId), eq(dailyActionItems.id, actionId))).returning({ id: dailyActionItems.id });
  if (!changed.length) return null;
  const [item] = await getDb().select().from(dailyActionItems).where(eq(dailyActionItems.id, actionId)).limit(1);
  return item ?? null;
}

export async function generateActionReminders(ownerId: string, options: { now?: Date; upcomingDays?: number } = {}) {
  const db = getDb();
  const nowDate = options.now ?? new Date();
  const now = nowDate.toISOString();
  const upcoming = new Date(nowDate.getTime() + (options.upcomingDays ?? 7) * 86_400_000).toISOString();
  const [dueApplications, upcomingInterviews, highFitJobs] = await Promise.all([
    db.select().from(applications).where(and(eq(applications.ownerId, ownerId), lte(applications.followupDueAt, now), inArray(applications.stage, ["Applied", "Follow-up", "Contacted"]))),
    db.select().from(interviews).where(and(eq(interviews.ownerId, ownerId), gte(interviews.scheduledAt, now), lte(interviews.scheduledAt, upcoming))),
    db.select({ jobId: jobs.id, companyId: jobs.companyId, title: jobs.title }).from(jobMatches).innerJoin(jobs, and(eq(jobs.ownerId, jobMatches.ownerId), eq(jobs.id, jobMatches.jobId))).where(and(eq(jobMatches.ownerId, ownerId), gte(jobMatches.score, 70), eq(jobMatches.dismissed, false), eq(jobs.status, "open"), eq(jobs.confidence, "high"))),
  ]);
  const generated = await Promise.all([
    ...dueApplications.map((application) => upsertActionItem(ownerId, { type: "overdue-follow-up", reason: `Follow up on ${application.title} at the linked company.`, dedupKey: `followup:${application.id}:${application.followupDueAt}`, priority: 20, companyId: application.companyId, applicationId: application.id, dueAt: application.followupDueAt ?? undefined })),
    ...upcomingInterviews.map((interview) => upsertActionItem(ownerId, { type: "upcoming-interview", reason: `Prepare for the ${interview.round} interview.`, dedupKey: `interview:${interview.id}:${interview.scheduledAt}`, priority: 10, applicationId: interview.applicationId, interviewId: interview.id, dueAt: interview.scheduledAt ?? undefined })),
    ...highFitJobs.map((job) => upsertActionItem(ownerId, { type: "high-fit-job", reason: `Review the high-fit role: ${job.title}.`, dedupKey: `high-fit-job:${job.jobId}`, priority: 30, companyId: job.companyId, jobId: job.jobId })),
  ]);
  return generated;
}

export async function listAgentRuns(ownerId: string) {
  return getDb().select().from(agentRuns).where(eq(agentRuns.ownerId, ownerId)).orderBy(desc(agentRuns.createdAt));
}

export async function getAgentRun(ownerId: string, runId: string) {
  const [run] = await getDb().select().from(agentRuns).where(and(eq(agentRuns.ownerId, ownerId), eq(agentRuns.id, runId))).limit(1);
  if (!run) return null;
  const steps = await getDb().select().from(agentSteps).where(and(eq(agentSteps.ownerId, ownerId), eq(agentSteps.runId, runId))).orderBy(asc(agentSteps.stepIndex));
  return { run, steps };
}

export async function createAgentRun(ownerId: string, input: { request: string; scope?: unknown; authorisedTools?: string[]; budget?: unknown }) {
  const timestamp = dateNow();
  const id = `agent_run_${crypto.randomUUID()}`;
  await getDb().insert(agentRuns).values({ id, ownerId, request: input.request.trim(), scopeJson: JSON.stringify(input.scope ?? {}), authorisedToolsJson: JSON.stringify(input.authorisedTools ?? []), status: "queued", checkpointJson: "{}", budgetJson: JSON.stringify(input.budget ?? {}), costJson: "{}", createdAt: timestamp, updatedAt: timestamp });
  return getAgentRun(ownerId, id);
}

export async function appendAgentStep(ownerId: string, runId: string, step: AgentStep) {
  if (!await getAgentRun(ownerId, runId)) return null;
  const [existing] = await getDb().select().from(agentSteps).where(and(eq(agentSteps.ownerId, ownerId), eq(agentSteps.runId, runId), eq(agentSteps.stepIndex, step.stepIndex))).limit(1);
  if (existing) return existing;
  const timestamp = dateNow();
  const id = `agent_step_${crypto.randomUUID()}`;
  await getDb().insert(agentSteps).values({ id, ownerId, runId, stepIndex: step.stepIndex, tool: step.tool, status: step.status, inputJson: JSON.stringify(step.input ?? {}), outputJson: JSON.stringify(step.output ?? {}), evidenceJson: JSON.stringify(step.evidence), costCents: step.costCents, error: null, startedAt: timestamp, finishedAt: timestamp, createdAt: timestamp, updatedAt: timestamp });
  const [created] = await getDb().select().from(agentSteps).where(eq(agentSteps.id, id)).limit(1);
  return created ?? null;
}

export async function updateAgentRun(ownerId: string, runId: string, input: { status?: string; summary?: string | null; error?: string | null; checkpoint?: unknown; cost?: unknown }) {
  const values: Partial<typeof agentRuns.$inferInsert> = { updatedAt: dateNow() };
  if (input.status !== undefined) values.status = input.status;
  if (input.summary !== undefined) values.summary = input.summary;
  if (input.error !== undefined) values.error = input.error;
  if (input.checkpoint !== undefined) values.checkpointJson = JSON.stringify(input.checkpoint);
  if (input.cost !== undefined) values.costJson = JSON.stringify(input.cost);
  const changed = await getDb().update(agentRuns).set(values).where(and(eq(agentRuns.ownerId, ownerId), eq(agentRuns.id, runId))).returning({ id: agentRuns.id });
  if (!changed.length) return null;
  return getAgentRun(ownerId, runId);
}

export { createAgentStep };
