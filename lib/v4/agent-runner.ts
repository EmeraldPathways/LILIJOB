import { and, asc, desc, eq, inArray, like } from "drizzle-orm";
import { getDb } from "../../db";
import { companies, sources } from "../../db/schema";
import { agentRuns, permitEvaluations } from "../../db/schema-v4";
import {
  AgentExecutionLimiter,
  canExecuteAgentTool,
  AGENT_TOOLS,
  createAgentStep,
  createDefaultAgentPlan,
  estimateAgentTokens,
  getAgentTool,
  normalizeAgentBudget,
  validateAgentPlan,
  validateAgentToolAllowlist,
  validateAgentToolArguments,
  type AgentBudget,
  type AgentPlanStep,
} from "./agent";
import { appendAgentStep, claimAgentStep, generateActionReminders, getAgentRun, listActionItems, updateAgentRun } from "./dashboard";
import { createApplication, getApplicationPack, listApplications, listCandidateProfiles, listExperienceEvidence, updateApplicationStage } from "./repository";
import { listRecruitmentContacts, listHiringSignals } from "./intelligence-repository";
import { buildApplicationPack } from "./packs";
import { buildInterviewPack } from "./interviews";
import { getInterview } from "./interview-repository";
import { rankAndPersistOpportunities } from "./opportunities";
import { discoverOfficialCareerPage, isSafePublicUrl } from "./job-radar";
import { getV4Job, listV4Jobs, persistDiscoveredJobs } from "./job-repository";

const MAX_CONCURRENT_RUNS_PER_OWNER = 2;
const MAX_RUN_STARTS_PER_MINUTE = 10;
const executionLimiter = new AgentExecutionLimiter({
  maxConcurrentPerOwner: MAX_CONCURRENT_RUNS_PER_OWNER,
  maxStartsPerMinute: MAX_RUN_STARTS_PER_MINUTE,
});
const inFlightRuns = new Map<string, Promise<Awaited<ReturnType<typeof getAgentRun>>>>();
const cancellationRequests = new Set<string>();

export class AgentExecutionLimitError extends Error {
  readonly status: number;

  constructor(readonly reason: "rate" | "concurrency") {
    super(reason === "rate" ? "Agent run rate limit exceeded. Try again shortly." : "Too many agent runs are already active for this account.");
    this.name = "AgentExecutionLimitError";
    this.status = reason === "rate" ? 429 : 429;
  }
}

type AgentUsage = { inputTokens: number; outputTokens: number; totalTokens: number; searches: number; estimatedCostCents: number; actualCostCents: number | null };
type AgentCheckpoint = {
  version: 1;
  plan: AgentPlanStep[];
  nextPlanIndex: number;
  attempts: Record<string, number>;
  cancelRequested?: boolean;
  pauseReason?: string;
  lastError?: string;
};

function keyFor(ownerId: string, runId: string): string {
  return `${ownerId}\u0000${runId}`;
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonArray(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseUsage(value: unknown): AgentUsage {
  const raw = parseObject(value);
  const inputTokens = finiteCount(raw.inputTokens);
  const outputTokens = finiteCount(raw.outputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: finiteCount(raw.totalTokens) || inputTokens + outputTokens,
    searches: finiteCount(raw.searches),
    estimatedCostCents: typeof raw.estimatedCostCents === "number" ? finiteCount(raw.estimatedCostCents) : finiteCount(raw.costCents),
    actualCostCents: typeof raw.actualCostCents === "number" && Number.isFinite(raw.actualCostCents) && raw.actualCostCents >= 0 ? Math.trunc(raw.actualCostCents) : null,
  };
}

function finiteCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function parseCheckpoint(value: unknown, request: string): AgentCheckpoint {
  const raw = parseObject(value);
  const rawPlan = Array.isArray(raw.plan) ? raw.plan : createDefaultAgentPlan(request);
  const validated = validateAgentPlan(rawPlan);
  return {
    version: 1,
    plan: validated.steps,
    nextPlanIndex: Math.max(0, Math.min(validated.steps.length, finiteCount(raw.nextPlanIndex))),
    attempts: parseObject(raw.attempts) as Record<string, number>,
    ...(raw.cancelRequested === true ? { cancelRequested: true } : {}),
    ...(typeof raw.pauseReason === "string" ? { pauseReason: raw.pauseReason } : {}),
    ...(typeof raw.lastError === "string" ? { lastError: raw.lastError } : {}),
    ...(validated.error ? { lastError: validated.error } : {}),
  };
}

function cleanOutput(output: unknown, maxTokens: number): { output: unknown; tokens: number } {
  const tokens = estimateAgentTokens(output);
  if (tokens <= maxTokens) return { output, tokens };
  let serialized: string;
  try { serialized = JSON.stringify(output); } catch { serialized = String(output); }
  const maxChars = Math.max(16, maxTokens * 4 - 48);
  const bounded = { truncated: true, preview: serialized.slice(0, maxChars) };
  return { output: bounded, tokens: estimateAgentTokens(bounded) };
}

function withinBudget(usage: AgentUsage, budget: AgentBudget, toolName: string, inputTokens: number): string | null {
  const tool = getAgentTool(toolName);
  if (!tool) return "The selected tool is not registered.";
  if (usage.searches + tool.searchUnits > budget.maxSearches) return "searches";
  if (usage.estimatedCostCents + tool.estimatedCostCents > budget.maxCostCents) return "cost";
  if (usage.totalTokens + inputTokens + tool.maxOutputTokens > budget.maxTokens) return "tokens";
  return null;
}

function safeLimit(value: unknown, fallback = 10): number {
  return typeof value === "number" && Number.isInteger(value) ? Math.max(1, Math.min(20, value)) : fallback;
}

function dateOrNow(value: unknown): string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : new Date().toISOString();
}

async function companyNameFor(ownerId: string, companyId: string): Promise<string> {
  const [company] = await getDb().select({ name: companies.name }).from(companies).where(and(eq(companies.ownerId, ownerId), eq(companies.id, companyId))).limit(1);
  return company?.name ?? "Company name needs confirmation";
}

async function executeRegisteredTool(ownerId: string, step: AgentPlanStep, usage: AgentUsage, budget: AgentBudget): Promise<{ output: Record<string, unknown>; evidence: string[] }> {
  const { tool, input } = step;
  const limit = safeLimit(input.limit);
  switch (tool) {
    case "search_companies": {
      const clauses = [eq(companies.ownerId, ownerId)];
      const query = typeof input.query === "string" ? input.query : "";
      if (query) clauses.push(like(companies.name, `%${query.replaceAll("%", "\\%")}%`));
      const results = await getDb().select({ id: companies.id, name: companies.name, domain: companies.domain, locality: companies.locality, website: companies.website }).from(companies).where(and(...clauses)).orderBy(asc(companies.name)).limit(limit);
      return { output: { count: results.length, companies: results }, evidence: results.flatMap((company) => company.website && isSafePublicUrl(company.website) ? [company.website] : []) };
    }
    case "search_jobs": {
      const jobs = await listV4Jobs(ownerId, {
        title: typeof input.title === "string" ? input.title : typeof input.query === "string" ? input.query : undefined,
        location: typeof input.location === "string" ? input.location : undefined,
        status: typeof input.status === "string" ? input.status : undefined,
      });
      const selected = jobs.slice(0, limit);
      return { output: { count: jobs.length, jobs: selected.map((job) => ({ id: job.id, companyId: job.companyId, title: job.title, url: job.url, status: job.status, confidence: job.confidence })) }, evidence: selected.flatMap((job) => job.url && isSafePublicUrl(job.url) ? [job.url] : []) };
    }
    case "refresh_jobs": {
      const companyId = String(input.companyId);
      const sourceUrl = String(input.sourceUrl);
      const [approvedSource] = await getDb().select({ id: sources.id, url: sources.url }).from(sources).where(and(eq(sources.ownerId, ownerId), eq(sources.companyId, companyId), eq(sources.url, sourceUrl))).limit(1);
      if (!approvedSource || !isSafePublicUrl(approvedSource.url)) return { output: { blocked: true, reason: "Refresh requires an owner-scoped, approved public source." }, evidence: [] };
      const result = await discoverOfficialCareerPage(approvedSource.url, async (url, init) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8_000);
        try { return await fetch(url, { ...init, signal: controller.signal }); } finally { clearTimeout(timeout); }
      });
      const persisted = result.jobs.length ? await persistDiscoveredJobs(ownerId, companyId, result) : { jobsCreated: 0 };
      return { output: { status: result.status, found: result.jobs.length, jobsCreated: persisted.jobsCreated, checkedAt: result.checkedAt, error: result.error ?? null }, evidence: [result.sourceUrl].filter(isSafePublicUrl) };
    }
    case "get_candidate_profile": {
      const profiles = await listCandidateProfiles(ownerId);
      const filtered = typeof input.profileId === "string" ? profiles.filter((profile) => profile.id === input.profileId) : profiles;
      const selected = filtered.slice(0, limit);
      return { output: { count: filtered.length, profiles: selected.map((profile) => ({ id: profile.id, name: profile.name, isActive: profile.isActive, targetFamilies: parseJsonArray(profile.targetFamiliesJson) })) }, evidence: [] };
    }
    case "rank_jobs": {
      const profiles = await listCandidateProfiles(ownerId);
      const profile = (typeof input.profileId === "string" ? profiles.find((item) => item.id === input.profileId) : profiles.find((item) => item.isActive)) ?? profiles[0];
      if (!profile) return { output: { count: 0, reason: "No candidate profile is available for ranking." }, evidence: [] };
      const ranked = await rankAndPersistOpportunities(ownerId, profile.id) ?? [];
      const selected = ranked.slice(0, limit);
      return { output: { count: ranked.length, profileId: profile.id, jobs: selected.map(({ job, companyName, match }) => ({ id: job.id, title: job.title, companyName, score: match.overrideScore ?? match.score, confidence: match.confidence, explanation: parseObject(match.explanationJson) })) }, evidence: selected.flatMap(({ job }) => job.url && isSafePublicUrl(job.url) ? [job.url] : []) };
    }
    case "get_job_sources": {
      const result = await getV4Job(ownerId, String(input.jobId));
      if (!result) return { output: { found: false }, evidence: [] };
      const sourceIds = [...new Set(result.snapshots.flatMap((snapshot) => snapshot.sourceId ? [snapshot.sourceId] : []))];
      const sourceRows = sourceIds.length ? await getDb().select({ id: sources.id, url: sources.url, title: sources.title, status: sources.status, checkedAt: sources.checkedAt }).from(sources).where(and(eq(sources.ownerId, ownerId), inArray(sources.id, sourceIds))) : [];
      return { output: { found: true, job: { id: result.job.id, title: result.job.title, url: result.job.url }, sources: sourceRows, snapshots: result.snapshots.slice(0, limit).map((snapshot) => ({ id: snapshot.id, state: snapshot.state, firstSeenAt: snapshot.firstSeenAt, lastSeenAt: snapshot.lastSeenAt, extractionConfidence: snapshot.extractionConfidence })) }, evidence: sourceRows.flatMap((source) => isSafePublicUrl(source.url) ? [source.url] : []) };
    }
    case "find_public_contacts": {
      const contacts = await listRecruitmentContacts(ownerId, typeof input.companyId === "string" ? input.companyId : undefined);
      const query = typeof input.query === "string" ? input.query.toLowerCase() : "";
      const filtered = contacts.filter((contact) => !contact.doNotContact && (!query || `${contact.name ?? ""} ${contact.role ?? ""}`.toLowerCase().includes(query)));
      const selected = filtered.slice(0, limit);
      return { output: { count: filtered.length, contacts: selected.map((contact) => ({ id: contact.id, companyId: contact.companyId, name: contact.name, role: contact.role, contactType: contact.contactType, emailAvailable: Boolean(contact.email), sourceUrl: contact.sourceUrl })) }, evidence: selected.flatMap((contact) => contact.sourceUrl && isSafePublicUrl(contact.sourceUrl) ? [contact.sourceUrl] : []) };
    }
    case "inspect_permit_evidence": {
      const clauses = [eq(permitEvaluations.ownerId, ownerId)];
      if (typeof input.companyId === "string") clauses.push(eq(permitEvaluations.companyId, input.companyId));
      if (typeof input.jobId === "string") clauses.push(eq(permitEvaluations.jobId, input.jobId));
      const evaluations = await getDb().select().from(permitEvaluations).where(and(...clauses)).orderBy(desc(permitEvaluations.evaluatedAt)).limit(limit);
      return { output: { count: evaluations.length, evaluations: evaluations.map((item) => ({ id: item.id, companyId: item.companyId, jobId: item.jobId, status: item.status, labels: parseJsonArray(item.labelsJson), explanation: item.explanation, sourceUrl: item.sourceUrl, evaluatedAt: item.evaluatedAt })) }, evidence: evaluations.flatMap((item) => item.sourceUrl && isSafePublicUrl(item.sourceUrl) ? [item.sourceUrl] : []) };
    }
    case "get_hiring_signals": {
      const signals = await listHiringSignals(ownerId, typeof input.companyId === "string" ? input.companyId : undefined);
      const selected = signals.slice(0, limit);
      return { output: { count: signals.length, signals: selected.map((signal) => ({ id: signal.id, companyId: signal.companyId, type: signal.type, summary: signal.summary, eventDate: signal.eventDate, confidence: signal.confidence, sourceUrl: signal.sourceUrl })) }, evidence: selected.flatMap((signal) => signal.sourceUrl && isSafePublicUrl(signal.sourceUrl) ? [signal.sourceUrl] : []) };
    }
    case "list_followups": {
      const dueBefore = dateOrNow(input.dueBefore);
      const applications = (await listApplications(ownerId)).filter((application) => application.followupDueAt && application.followupDueAt <= dueBefore && !["Rejected", "Withdrawn"].includes(application.stage));
      const selected = applications.slice(0, limit);
      return { output: { count: applications.length, applications: selected.map((application) => ({ id: application.id, title: application.title, stage: application.stage, dueAt: application.followupDueAt })) }, evidence: [] };
    }
    case "get_usage_budget":
      return { output: { budget, usage: { ...usage, actualCostCents: null } }, evidence: [] };
    case "prepare_application_pack": {
      const result = await getV4Job(ownerId, String(input.jobId));
      if (!result) return { output: { found: false, reason: "Job not found for this owner." }, evidence: [] };
      const companyName = await companyNameFor(ownerId, result.job.companyId);
      const profiles = await listCandidateProfiles(ownerId);
      const profile = (typeof input.profileId === "string" ? profiles.find((item) => item.id === input.profileId) : profiles.find((item) => item.isActive)) ?? profiles[0];
      const evidence = profile ? await listExperienceEvidence(ownerId, profile.id) : [];
      const requirements = result.snapshots.flatMap((snapshot) => parseJsonArray(snapshot.requirementsJson)).slice(0, 20);
      const latestSnapshot = result.snapshots[0];
      const pack = buildApplicationPack({
        jobTitle: result.job.title,
        companyName,
        requirements,
        jobSourceUrl: result.job.url ?? latestSnapshot?.sourceId ?? "https://example.invalid/source-needs-review",
        approvedEvidence: evidence.filter((item) => item.approved).map((item) => ({ id: item.id, statement: item.statement, metric: item.metric })),
        candidateSummary: profile?.name ?? "Candidate profile not selected",
      });
      return { output: { found: true, editable: true, pack }, evidence: result.job.url && isSafePublicUrl(result.job.url) ? [result.job.url] : [] };
    }
    case "draft_outreach": {
      const contacts = await listRecruitmentContacts(ownerId, String(input.companyId));
      const contact = typeof input.contactId === "string" ? contacts.find((item) => item.id === input.contactId && !item.doNotContact) : contacts.find((item) => !item.doNotContact);
      const jobs = typeof input.jobId === "string" ? await listV4Jobs(ownerId) : [];
      const job = jobs.find((item) => item.id === input.jobId);
      const companyName = await companyNameFor(ownerId, String(input.companyId));
      const subject = job ? `Question about the ${job.title} role` : `Question for ${companyName}`;
      const body = `Hello${contact?.name ? ` ${contact.name}` : ""},\n\nI am exploring opportunities at ${companyName}${job ? ` and noticed the ${job.title} role` : ""}. I would welcome a short conversation about the team's priorities if appropriate.\n\nBest,\n[Your name]`;
      return { output: { editable: true, sent: false, draft: { subject, body, contactId: contact?.id ?? null, jobId: job?.id ?? null } }, evidence: contact?.sourceUrl && isSafePublicUrl(contact.sourceUrl) ? [contact.sourceUrl] : [] };
    }
    case "create_action_items": {
      const created = await generateActionReminders(ownerId);
      const items = await listActionItems(ownerId);
      return { output: { count: created.length, items: items.slice(0, limit).map((item) => ({ id: item.id, type: item.type, reason: item.reason, dueAt: item.dueAt, status: item.status })) }, evidence: [] };
    }
    case "create_interview_pack": {
      const applications = await listApplications(ownerId);
      const application = typeof input.applicationId === "string" ? applications.find((item) => item.id === input.applicationId) : applications[0];
      if (!application) return { output: { editable: true, contextRequired: true, pack: buildInterviewPack({ companyName: "Company name needs confirmation", roleTitle: "Role details need confirmation", jobSourceUrl: null, checkedAt: null, companyFacts: [], requirements: [], approvedStories: [] }) }, evidence: [] };
      const companyName = await companyNameFor(ownerId, application.companyId);
      const jobs = await listV4Jobs(ownerId);
      const job = jobs.find((item) => item.id === application.jobId);
      const result = buildInterviewPack({ companyName, roleTitle: job?.title ?? application.title, jobSourceUrl: job?.url ?? null, checkedAt: job?.updatedAt ?? null, companyFacts: [], requirements: [], approvedStories: [] });
      return { output: { editable: true, applicationId: application.id, pack: result }, evidence: job?.url && isSafePublicUrl(job.url) ? [job.url] : [] };
    }
    case "export_documents": {
      const format = typeof input.format === "string" ? input.format : "html";
      const packIds = [...new Set([
        ...parseList(input.applicationPackIds),
        ...parseList(input.documentIds),
      ].filter((id): id is string => typeof id === "string"))];
      const interviewIds = [...new Set(parseList(input.interviewIds).filter((id): id is string => typeof id === "string"))];
      const exports: Array<{ id: string; kind: "application_pack" | "interview_pack"; format: string; url: string }> = [];
      const unavailableIds: string[] = [];
      for (const packId of packIds) {
        if (!await getApplicationPack(ownerId, packId)) {
          unavailableIds.push(packId);
          continue;
        }
        exports.push({ id: packId, kind: "application_pack", format, url: `/api/v4/packs/${encodeURIComponent(packId)}/export?format=${encodeURIComponent(format)}` });
      }
      for (const interviewId of interviewIds) {
        const interview = await getInterview(ownerId, interviewId);
        if (!interview || !interview.packs.length) {
          unavailableIds.push(interviewId);
          continue;
        }
        exports.push({ id: interviewId, kind: "interview_pack", format, url: `/api/v4/interviews/${encodeURIComponent(interviewId)}/export?format=${encodeURIComponent(format)}` });
      }
      if (!exports.length) return { output: { blocked: true, status: "unavailable", reason: "No selected saved application or interview packs are available for this owner.", unavailableCount: unavailableIds.length }, evidence: [] };
      return { output: { status: "download_ready", format, exports, unavailableCount: unavailableIds.length, unavailableIds }, evidence: [] };
    }
    case "create_application": {
      const jobId = String(input.jobId);
      const job = await getV4Job(ownerId, jobId);
      if (!job) return { output: { blocked: true, reason: "Job not found for this owner; no application record was created." }, evidence: [] };
      const existing = (await listApplications(ownerId)).find((application) => application.jobId === jobId);
      const result = existing
        ? { record: existing, created: false }
        : await createApplication(ownerId, {
          companyId: job.job.companyId,
          jobId,
          title: job.job.title,
          manualUrl: job.job.url ?? undefined,
          dedupKey: `agent-job:${jobId}`,
          stage: "Target",
          nextAction: "Review this application record and take any external apply action yourself.",
        });
      return { output: { created: result.created, applicationId: result.record.id, title: result.record.title, stage: result.record.stage, submitted: false }, evidence: job.job.url && isSafePublicUrl(job.job.url) ? [job.job.url] : [] };
    }
    case "update_application_stage": {
      const application = await updateApplicationStage(ownerId, String(input.applicationId), String(input.stage), typeof input.note === "string" ? input.note : undefined);
      if (!application) return { output: { found: false, reason: "Application not found for this owner; no stage was changed." }, evidence: [] };
      return { output: { updated: true, applicationId: application.id, stage: application.stage }, evidence: [] };
    }
    case "submit_application":
    case "send_outreach":
    case "schedule_communication":
      return { output: { reason: "External actions require approval in their dedicated workflow.", nextAction: "Open the related record, review it, and approve the individual action there." }, evidence: [] };
  }
}

async function persistRun(ownerId: string, runId: string, input: { status?: string; summary?: string | null; error?: string | null; checkpoint?: AgentCheckpoint; cost?: AgentUsage }, expectedStatuses: string[] = ["queued", "running"]) {
  return await updateAgentRun(ownerId, runId, { ...input, expectedStatuses }) ?? getAgentRun(ownerId, runId);
}

async function runAgentPlan(ownerId: string, runId: string) {
  const current = await getAgentRun(ownerId, runId);
  if (!current) return null;
  if (["completed", "blocked"].includes(current.run.status)) return current;
  const checkpoint = parseCheckpoint(current.run.checkpointJson, current.run.request);
  if (!checkpoint.plan.length || checkpoint.lastError && checkpoint.plan.length === 0) {
    return persistRun(ownerId, runId, { status: "failed", error: checkpoint.lastError ?? "The agent plan is invalid.", summary: "The server could not validate the stored agent plan.", checkpoint });
  }
  if (checkpoint.lastError) return persistRun(ownerId, runId, { status: "failed", error: checkpoint.lastError, summary: "The server could not validate the stored agent plan.", checkpoint });
  const allowlist = validateAgentToolAllowlist(parseList(current.run.authorisedToolsJson));
  if (allowlist.error) return persistRun(ownerId, runId, { status: "failed", error: allowlist.error, summary: "The stored agent permissions are invalid.", checkpoint });
  if (checkpoint.plan.some((step) => !allowlist.tools.includes(step.tool))) {
    return persistRun(ownerId, runId, { status: "blocked", error: "The plan contains a tool outside the server-authorized tool list.", summary: "The run was blocked because a planned tool was not authorized.", checkpoint });
  }
  let budget: AgentBudget;
  try { budget = normalizeAgentBudget(current.run.budgetJson ? JSON.parse(String(current.run.budgetJson)) : undefined); } catch (error) {
    return persistRun(ownerId, runId, { status: "failed", error: error instanceof Error ? error.message : "Invalid agent budget.", summary: "The stored agent budget is invalid.", checkpoint });
  }
  let usage = parseUsage(current.run.costJson);
  const started = await persistRun(ownerId, runId, { status: "running", checkpoint, cost: usage }, ["queued", "running"]);
  if (!started || started.run.status !== "running") return started;

  // A worker can finish storing a step and stop before advancing the run checkpoint.
  // Recover that result instead of invoking the same tool a second time.
  const savedAtCheckpoint = current.steps.find((step) => step.stepIndex === checkpoint.nextPlanIndex);
  if (["queued", "running"].includes(current.run.status) && savedAtCheckpoint?.status === "completed") {
    const outputTokens = estimateAgentTokens(parseObject(savedAtCheckpoint.outputJson));
    usage = { ...usage, outputTokens: usage.outputTokens + outputTokens, totalTokens: usage.totalTokens + outputTokens };
    checkpoint.nextPlanIndex += 1;
    delete checkpoint.pauseReason;
    const isComplete = checkpoint.nextPlanIndex >= checkpoint.plan.length;
    const recovered = await persistRun(ownerId, runId, {
      status: isComplete ? "completed" : "running",
      summary: isComplete ? `${checkpoint.plan.length} planned step${checkpoint.plan.length === 1 ? "" : "s"} completed within budget.` : undefined,
      checkpoint,
      cost: usage,
    }, ["running"]);
    if (isComplete) return recovered;
    if (!recovered || recovered.run.status !== "running") return recovered;
  } else if (current.run.status === "running" && savedAtCheckpoint?.status === "failed") {
    const failedOutput = parseObject(savedAtCheckpoint.outputJson);
    const error = typeof failedOutput.error === "string" ? failedOutput.error : "The persisted agent step failed.";
    const outputTokens = estimateAgentTokens(failedOutput);
    usage = { ...usage, outputTokens: usage.outputTokens + outputTokens, totalTokens: usage.totalTokens + outputTokens };
    checkpoint.attempts[String(checkpoint.nextPlanIndex)] = finiteCount(checkpoint.attempts[String(checkpoint.nextPlanIndex)]) + 1;
    checkpoint.lastError = error;
    return persistRun(ownerId, runId, { status: "failed", error, summary: `Step ${checkpoint.nextPlanIndex + 1} failed. Retry will resume from this step.`, checkpoint, cost: usage }, ["running"]);
  } else if (["queued", "running"].includes(current.run.status) && savedAtCheckpoint?.status === "blocked") {
    checkpoint.pauseReason = "tool_blocked";
    return persistRun(ownerId, runId, { status: "blocked", summary: "A requested tool was blocked before it could complete.", checkpoint, cost: usage }, ["running"]);
  }

  while (checkpoint.nextPlanIndex < checkpoint.plan.length) {
    const latest = await getAgentRun(ownerId, runId);
    if (!latest) return null;
    const latestCheckpoint = parseCheckpoint(latest.run.checkpointJson, latest.run.request);
    if (cancellationRequests.has(keyFor(ownerId, runId)) || latest.run.status === "cancelled" || latestCheckpoint.cancelRequested || latest.run.status !== "running") return latest;
    if (checkpoint.nextPlanIndex >= budget.maxSteps) {
      checkpoint.pauseReason = "budget";
      return persistRun(ownerId, runId, { status: "paused", summary: "The run paused at its configured step budget.", checkpoint, cost: usage }, ["running"]);
    }
    const step = checkpoint.plan[checkpoint.nextPlanIndex];
    const tool = getAgentTool(step.tool);
    if (!tool) return persistRun(ownerId, runId, { status: "failed", error: "The plan references an unregistered tool.", summary: "The server could not validate the stored agent plan.", checkpoint, cost: usage });
    const validatedInput = validateAgentToolArguments(step.tool, step.input);
    if (validatedInput.error) return persistRun(ownerId, runId, { status: "failed", error: validatedInput.error, summary: "The server rejected unsafe or malformed tool arguments.", checkpoint, cost: usage });
    step.input = validatedInput.input;
    const stepIndex = checkpoint.nextPlanIndex;

    if (!canExecuteAgentTool(step.tool, { approved: false })) {
      const blocked = createAgentStep(stepIndex, step.tool, step.input, {
        reason: "External actions remain blocked by the agent runner, even when client-supplied approval data is present.",
        nextAction: "Open the related record, review it, and approve the individual action in its dedicated workflow.",
      }, [], "blocked", 0);
      await appendAgentStep(ownerId, runId, blocked);
      checkpoint.pauseReason = "external_action_blocked";
      return persistRun(ownerId, runId, { status: "blocked", summary: "An external action was held for explicit approval in its dedicated workflow.", checkpoint, cost: usage });
    }

    const inputTokens = estimateAgentTokens({ request: current.run.request, tool: step.tool, input: step.input });
    const budgetReason = withinBudget(usage, budget, step.tool, inputTokens);
    if (budgetReason) {
      checkpoint.pauseReason = "budget";
      return persistRun(ownerId, runId, { status: "paused", summary: `The run paused because its ${budgetReason} budget is exhausted. Resume after adjusting the budget.`, checkpoint, cost: usage });
    }

    const claimed = await claimAgentStep(ownerId, runId, createAgentStep(stepIndex, step.tool, step.input, {}, [], "running", tool.estimatedCostCents));
    if (!claimed) return getAgentRun(ownerId, runId);
    usage = {
      ...usage,
      inputTokens: usage.inputTokens + inputTokens,
      totalTokens: usage.totalTokens + inputTokens,
      searches: usage.searches + tool.searchUnits,
      estimatedCostCents: usage.estimatedCostCents + tool.estimatedCostCents,
      actualCostCents: null,
    };
    const reserved = await persistRun(ownerId, runId, { status: "running", checkpoint, cost: usage }, ["running"]);
    if (!reserved || reserved.run.status !== "running") {
      await appendAgentStep(ownerId, runId, createAgentStep(stepIndex, step.tool, step.input, {}, [], "queued", tool.estimatedCostCents));
      return reserved;
    }

    try {
      const result = await executeRegisteredTool(ownerId, step, usage, budget);
      const bounded = cleanOutput(result.output, tool.maxOutputTokens);
      const outputTokens = bounded.tokens;
      usage = {
        ...usage,
        outputTokens: usage.outputTokens + outputTokens,
        totalTokens: usage.totalTokens + outputTokens,
        actualCostCents: null,
      };
      const resultIsBlocked = bounded.output && typeof bounded.output === "object" && (bounded.output as Record<string, unknown>).blocked === true;
      const stepStatus = resultIsBlocked ? "blocked" : "completed";
      const recorded = createAgentStep(stepIndex, step.tool, step.input, bounded.output, result.evidence, stepStatus, tool.estimatedCostCents);
      const saved = await appendAgentStep(ownerId, runId, recorded);
      if (!saved) throw new Error("The completed agent step could not be persisted.");
      if (resultIsBlocked) {
        checkpoint.pauseReason = "tool_blocked";
        return persistRun(ownerId, runId, { status: "blocked", summary: "A requested tool was blocked because its required owner-scoped source was unavailable.", checkpoint, cost: usage }, ["running"]);
      }
      const afterStep = await getAgentRun(ownerId, runId);
      if (!afterStep) return null;
      const afterStepCheckpoint = parseCheckpoint(afterStep.run.checkpointJson, afterStep.run.request);
      if (afterStep.run.status === "cancelled" || afterStepCheckpoint.cancelRequested || cancellationRequests.has(keyFor(ownerId, runId))) {
        if (afterStep.run.status !== "cancelled") return afterStep;
        checkpoint.nextPlanIndex += 1;
        checkpoint.cancelRequested = true;
        delete checkpoint.pauseReason;
        return await updateAgentRun(ownerId, runId, {
          summary: "The run was cancelled after the current safe step finished.",
          checkpoint,
          cost: usage,
          expectedStatuses: ["cancelled"],
        }) ?? getAgentRun(ownerId, runId);
      }
      if (afterStep.run.status !== "running") return afterStep;
      checkpoint.nextPlanIndex += 1;
      delete checkpoint.pauseReason;
      const isComplete = checkpoint.nextPlanIndex >= checkpoint.plan.length;
      const updated = await persistRun(ownerId, runId, {
        status: isComplete ? "completed" : "running",
        summary: isComplete ? `${checkpoint.plan.length} planned step${checkpoint.plan.length === 1 ? "" : "s"} completed within budget.` : undefined,
        checkpoint,
        cost: usage,
      }, ["running"]);
      if (!updated || updated.run.status !== "running" || isComplete) return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : "The tool failed to execute.";
      const attempt = finiteCount(checkpoint.attempts[String(checkpoint.nextPlanIndex)]) + 1;
      checkpoint.attempts[String(checkpoint.nextPlanIndex)] = attempt;
      checkpoint.lastError = message;
      const errorOutput = { error: message };
      const errorOutputTokens = estimateAgentTokens(errorOutput);
      usage = {
        ...usage,
        outputTokens: usage.outputTokens + errorOutputTokens,
        totalTokens: usage.totalTokens + errorOutputTokens,
        actualCostCents: null,
      };
      await appendAgentStep(ownerId, runId, createAgentStep(stepIndex, step.tool, step.input, errorOutput, [], "failed", tool.estimatedCostCents));
      const afterFailure = await getAgentRun(ownerId, runId);
      if (!afterFailure) return null;
      if (afterFailure.run.status !== "running" || parseCheckpoint(afterFailure.run.checkpointJson, afterFailure.run.request).cancelRequested) return afterFailure;
      return persistRun(ownerId, runId, { status: "failed", error: message, summary: `Step ${checkpoint.nextPlanIndex + 1} failed. Retry will resume from this step.`, checkpoint, cost: usage }, ["running"]);
    }
  }
  return persistRun(ownerId, runId, { status: "completed", summary: `${checkpoint.plan.length} planned steps completed within budget.`, checkpoint, cost: usage }, ["running"]);
}

export async function executeAgentRun(ownerId: string, runId: string) {
  const key = keyFor(ownerId, runId);
  const existing = inFlightRuns.get(key);
  if (existing) return existing;
  const current = await getAgentRun(ownerId, runId);
  if (!current) return null;
  if (["completed", "blocked", "failed", "cancelled"].includes(current.run.status)) return current;
  const slot = executionLimiter.acquire(ownerId, runId);
  if (!slot.allowed) throw new AgentExecutionLimitError(slot.reason);
  const task = runAgentPlan(ownerId, runId).finally(() => {
    inFlightRuns.delete(key);
    executionLimiter.release(ownerId, runId);
    cancellationRequests.delete(key);
  });
  inFlightRuns.set(key, task);
  return task;
}

export async function cancelAgentRun(ownerId: string, runId: string) {
  const current = await getAgentRun(ownerId, runId);
  if (!current || !["queued", "running", "paused"].includes(current.run.status)) return current;
  const key = keyFor(ownerId, runId);
  const checkpoint = parseCheckpoint(current.run.checkpointJson, current.run.request);
  checkpoint.cancelRequested = true;
  const cancelled = await updateAgentRun(ownerId, runId, { status: "cancelled", summary: "The run was cancelled. Resume to continue from the saved checkpoint.", checkpoint, expectedStatuses: [current.run.status] });
  if (cancelled) cancellationRequests.add(key);
  return cancelled ?? getAgentRun(ownerId, runId);
}

export async function resumeAgentRun(ownerId: string, runId: string, budgetOverride?: unknown) {
  const current = await getAgentRun(ownerId, runId);
  if (!current || !["cancelled", "paused"].includes(current.run.status)) return current;
  const checkpoint = parseCheckpoint(current.run.checkpointJson, current.run.request);
  delete checkpoint.cancelRequested;
  delete checkpoint.pauseReason;
  delete checkpoint.lastError;
  if (budgetOverride !== undefined) {
    const budget = normalizeAgentBudget(budgetOverride);
    await getDb().update(agentRuns).set({ budgetJson: JSON.stringify(budget), updatedAt: new Date().toISOString() }).where(and(
      eq(agentRuns.ownerId, ownerId),
      eq(agentRuns.id, runId),
      inArray(agentRuns.status, ["cancelled", "paused"]),
    ));
  }
  cancellationRequests.delete(keyFor(ownerId, runId));
  return await updateAgentRun(ownerId, runId, { status: "queued", summary: "The run is ready to resume from its saved checkpoint.", error: null, checkpoint, expectedStatuses: ["cancelled", "paused"] }) ?? getAgentRun(ownerId, runId);
}

export async function retryAgentRun(ownerId: string, runId: string) {
  const current = await getAgentRun(ownerId, runId);
  if (!current || current.run.status !== "failed") return current;
  const checkpoint = parseCheckpoint(current.run.checkpointJson, current.run.request);
  const currentAttempt = finiteCount(checkpoint.attempts[String(checkpoint.nextPlanIndex)]);
  if (currentAttempt >= 3) return updateAgentRun(ownerId, runId, { summary: "The failed step reached the retry limit.", error: checkpoint.lastError ?? "Retry limit reached.", checkpoint });
  delete checkpoint.lastError;
  return await updateAgentRun(ownerId, runId, { status: "queued", summary: "The failed step is ready to retry from its saved checkpoint.", error: null, checkpoint, expectedStatuses: ["failed"] }) ?? getAgentRun(ownerId, runId);
}

export const AGENT_EXECUTION_LIMITS = {
  maxConcurrentRunsPerOwner: MAX_CONCURRENT_RUNS_PER_OWNER,
  maxRunStartsPerMinute: MAX_RUN_STARTS_PER_MINUTE,
  registeredTools: AGENT_TOOLS.length,
} as const;
