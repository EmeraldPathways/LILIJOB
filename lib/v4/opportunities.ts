import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db";
import { companies, jobs } from "../../db/schema";
import { candidateProfiles, experienceEvidence, jobMatches, jobSnapshots } from "../../db/schema-v4";
import { rankOpportunity, type RankingProfile } from "./ranking";
import { selectInChunks } from "./query-utils";
import { parsePublishedSalary } from "./salary";

export const SCORING_VERSION = "v5-heuristic-2";
export const SCORING_CONFIG_VERSION = "v5-ranking-config-1";

function parsed<T>(value: string | null | undefined, fallback: T): T {
  try {
    const result = JSON.parse(value ?? "");
    return result as T;
  } catch {
    return fallback;
  }
}

function profileInput(profile: typeof candidateProfiles.$inferSelect, approvedEvidence: string[]): RankingProfile {
  const constraints = parsed<Record<string, unknown>>(profile.constraintsJson, {});
  const weights = parsed<Record<string, number>>(profile.weightConfigJson, {});
  const values = (key: string): string[] => Array.isArray(constraints[key]) ? constraints[key].filter((item): item is string => typeof item === "string") : [];
  return {
    targetFamilies: parsed<string[]>(profile.targetFamiliesJson, []),
    skills: values("skills"),
    domains: values("domains"),
    seniority: typeof constraints.seniority === "string" ? constraints.seniority : undefined,
    constraints: {
      locations: values("locations"),
      workModels: values("workModels"),
      minimumSalary: typeof constraints.minimumSalary === "number" ? constraints.minimumSalary : undefined,
      maximumSalary: typeof constraints.maximumSalary === "number" ? constraints.maximumSalary : undefined,
      eligibility: constraints.eligibility === "eligible" || constraints.eligibility === "ineligible" ? constraints.eligibility : "unknown",
    },
    interestCompanies: values("interestCompanies"),
    evidence: approvedEvidence,
    weights,
  };
}

export async function rankAndPersistOpportunities(ownerId: string, profileId: string) {
  const db = getDb();
  const [profile] = await db.select().from(candidateProfiles).where(and(eq(candidateProfiles.ownerId, ownerId), eq(candidateProfiles.id, profileId))).limit(1);
  if (!profile) return null;
  const jobRows = await db.select().from(jobs).where(eq(jobs.ownerId, ownerId)).orderBy(asc(jobs.title));
  const companyIds = [...new Set(jobRows.map((job) => job.companyId))];
  const companyRows = await selectInChunks(companyIds, (ids) => db.select({ id: companies.id, name: companies.name }).from(companies).where(and(eq(companies.ownerId, ownerId), inArray(companies.id, ids))));
  const companyNames = new Map(companyRows.map((company) => [company.id, company.name]));
  const evidenceRows = await db.select().from(experienceEvidence).where(and(eq(experienceEvidence.ownerId, ownerId), eq(experienceEvidence.profileId, profileId), eq(experienceEvidence.approved, true))).orderBy(desc(experienceEvidence.updatedAt));
  const approvedEvidence = evidenceRows.map((evidence) => [evidence.statement, evidence.metric].filter(Boolean).join(" — "));
  const rankingProfile = profileInput(profile, approvedEvidence);
  const snapshotRows = await selectInChunks(jobRows.map((job) => job.id), (ids) => db.select().from(jobSnapshots).where(and(eq(jobSnapshots.ownerId, ownerId), inArray(jobSnapshots.jobId, ids))).orderBy(desc(jobSnapshots.lastSeenAt)));
  const latestSnapshots = new Map<string, typeof snapshotRows[number]>();
  for (const snapshot of snapshotRows) if (!latestSnapshots.has(snapshot.jobId)) latestSnapshots.set(snapshot.jobId, snapshot);
  const existingMatches = await db.select().from(jobMatches).where(and(eq(jobMatches.ownerId, ownerId), eq(jobMatches.profileId, profileId))).orderBy(desc(jobMatches.scoredAt));
  const latestByJob = new Map<string, typeof existingMatches[number]>();
  for (const match of existingMatches) if (!latestByJob.has(match.jobId)) latestByJob.set(match.jobId, match);
  const scoringVersion = `${SCORING_VERSION}:profile-${profile.approvedVersion}:config-${SCORING_CONFIG_VERSION}`;
  const rows: Array<{ job: typeof jobRows[number]; companyName: string | null; match: typeof jobMatches.$inferSelect }> = [];
  for (const job of jobRows) {
    const snapshot = latestSnapshots.get(job.id);
    const requirements = (() => {
      try {
        const parsed = JSON.parse(snapshot?.requirementsJson ?? "[]") as unknown;
        return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
      } catch {
        return [];
      }
    })();
    const publishedSalary = parsePublishedSalary(snapshot?.payRange, snapshot?.currency);
    const annualSalary = publishedSalary?.period === "year" ? publishedSalary : undefined;
    const ranking = rankOpportunity(rankingProfile, {
      id: job.id,
      companyId: job.companyId,
      companyName: companyNames.get(job.companyId),
      title: job.title,
      description: snapshot?.description ?? undefined,
      requirements,
      location: snapshot?.location ?? job.location ?? undefined,
      workModel: snapshot?.workModel ?? undefined,
      seniority: snapshot?.seniority ?? undefined,
      salaryMin: annualSalary?.min,
      salaryMax: annualSalary?.max,
      freshnessDays: snapshot?.lastSeenAt ? Math.max(0, Math.floor((Date.now() - Date.parse(snapshot.lastSeenAt)) / 86_400_000)) : job.updatedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(job.updatedAt)) / 86_400_000)) : undefined,
    });
    const timestamp = new Date().toISOString();
    const previous = latestByJob.get(job.id);
    const evidenceIds = evidenceRows.filter((evidence) => ranking.evidenceUsed.includes([evidence.statement, evidence.metric].filter(Boolean).join(" — "))).map((evidence) => evidence.id);
    const explanationJson = JSON.stringify({ ...ranking.explanations, evidenceUsed: ranking.evidenceUsed, evidenceIds, profileVersion: profile.approvedVersion, scoringConfigVersion: SCORING_CONFIG_VERSION, salary: publishedSalary });
    const values = { id: `match_${ownerId}_${job.id}_${profileId}_${scoringVersion}`.slice(0, 180), ownerId, jobId: job.id, profileId, profileVersion: profile.approvedVersion, scoringConfigVersion: SCORING_CONFIG_VERSION, scoringVersion: scoringVersion, score: ranking.score, confidence: ranking.confidence, dimensionsJson: JSON.stringify(ranking.dimensions), hardConstraintsJson: JSON.stringify(ranking.hardConstraints), explanationJson, dismissed: previous?.dismissed ?? false, starred: previous?.starred ?? false, overrideScore: previous?.overrideScore ?? null, overrideReason: previous?.overrideReason ?? null, scoredAt: timestamp, createdAt: timestamp, updatedAt: timestamp };
    await db.insert(jobMatches).values(values).onConflictDoUpdate({ target: [jobMatches.ownerId, jobMatches.jobId, jobMatches.profileId, jobMatches.scoringVersion], set: { profileVersion: values.profileVersion, scoringConfigVersion: values.scoringConfigVersion, score: ranking.score, confidence: ranking.confidence, dimensionsJson: values.dimensionsJson, hardConstraintsJson: values.hardConstraintsJson, explanationJson: values.explanationJson, scoredAt: timestamp, updatedAt: timestamp } });
    const [match] = await db.select().from(jobMatches).where(and(eq(jobMatches.ownerId, ownerId), eq(jobMatches.jobId, job.id), eq(jobMatches.profileId, profileId), eq(jobMatches.scoringVersion, scoringVersion))).limit(1);
    if (match) rows.push({ job, companyName: companyNames.get(job.companyId) ?? null, match });
  }
  return rows.sort((a, b) => (b.match.overrideScore ?? b.match.score) - (a.match.overrideScore ?? a.match.score));
}

export async function updateOpportunityAction(ownerId: string, profileId: string, jobId: string, input: { starred?: boolean; dismissed?: boolean; overrideScore?: number | null; overrideReason?: string | null }) {
  const latest = await getDb().select({ id: jobMatches.id }).from(jobMatches).where(and(eq(jobMatches.ownerId, ownerId), eq(jobMatches.profileId, profileId), eq(jobMatches.jobId, jobId))).orderBy(desc(jobMatches.scoredAt)).limit(1);
  if (!latest.length) return null;
  const changed = await getDb().update(jobMatches).set({
    ...(input.starred === undefined ? {} : { starred: input.starred }),
    ...(input.dismissed === undefined ? {} : { dismissed: input.dismissed }),
    ...(input.overrideScore === undefined ? {} : { overrideScore: input.overrideScore === null ? null : Math.max(0, Math.min(100, Math.round(input.overrideScore))) }),
    ...(input.overrideReason === undefined ? {} : { overrideReason: input.overrideReason }),
    updatedAt: new Date().toISOString(),
  }).where(and(eq(jobMatches.ownerId, ownerId), eq(jobMatches.id, latest[0].id))).returning({ id: jobMatches.id });
  if (!changed.length) return null;
  const [match] = await getDb().select().from(jobMatches).where(eq(jobMatches.id, changed[0].id)).limit(1);
  return match ?? null;
}
